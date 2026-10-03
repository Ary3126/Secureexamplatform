const db = require('../config/db');
const ContestModel = require('../models/contestModel');
const { getContestRuntimeState, getContestFreezeState, formatContest } = require('./contestService');

/**
 * Authoritative Standings Service - Single source of truth for Contest Standings,
 * Problem-by-Problem Scoreboard, Leaderboard Freeze, and Rating Integration.
 */
class StandingsService {
  /**
   * Compute comprehensive contest standings with problem-by-problem breakdown,
   * deterministic tie-breaking, freeze cutoff, search, and pagination.
   * 
   * @param {Object} params
   * @param {number|string} params.contestId - Contest ID
   * @param {Object} [params.requestingUser] - Authenticated user context ({ id, role, username })
   * @param {number} [params.page=1] - Page number (1-indexed)
   * @param {number} [params.limit=50] - Number of participants per page
   * @param {string} [params.search=''] - Search term for username or full name
   * @param {boolean} [params.freezeOverride=false] - Force live unmasked results (professors/admins)
   * @param {Object} [params.clientOrDb=null] - PostgreSQL client for transactions
   * @returns {Promise<Object>} Authoritative Leaderboard Payload
   */
  static async computeContestStandings({
    contestId,
    requestingUser = null,
    page = 1,
    limit = 50,
    search = '',
    freezeOverride = false,
    sortBy = 'rank',
    sortOrder = 'ASC',
    filterStatus = 'all',
    clientOrDb = null,
  }) {
    const executor = clientOrDb || db;

    // 1. Fetch Contest Details
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      const err = new Error(`Contest with ID ${contestId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const formattedContest = formatContest(contest);

    // Determine manager privileges
    const isManager = Boolean(
      requestingUser &&
      (requestingUser.role === 'super_admin' ||
        requestingUser.role === 'contest_admin' ||
        (requestingUser.role === 'professor' && requestingUser.id === formattedContest.createdBy))
    );

    // BOLA Protection: Draft contests are strictly accessible by contest managers
    if (contest.status === 'draft' && !isManager) {
      const err = new Error(`Contest with ID ${contestId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    const startTime = new Date(formattedContest.startTime);
    const endTime = new Date(formattedContest.endTime);
    const serverTimeIso = now.toISOString();

    // 2. Authoritative Freeze Status Calculation
    const freezeInfo = getContestFreezeState(formattedContest, now);
    const isFrozen = freezeInfo.isFrozen;
    const freezeState = freezeInfo.freezeState;
    const freezeTime = freezeInfo.freezeTime;

    const applyFreezeCutoff = isFrozen && !(isManager && freezeOverride);
    const effectiveCutoff = applyFreezeCutoff && freezeTime ? freezeTime : null;

    // 3. Fetch Contest Problems
    const problemsText = `
      SELECT 
        cp.problem_id AS "problemId",
        cp.problem_order AS "problemOrder",
        cp.points AS "maxPoints",
        p.title,
        p.difficulty,
        p.coding_mode AS "codingMode"
      FROM contest_problems cp
      JOIN problems p ON cp.problem_id = p.id
      WHERE cp.contest_id = $1
      ORDER BY cp.problem_order ASC, cp.problem_id ASC;
    `;
    const problemsRes = await executor.query(problemsText, [contestId]);
    const contestProblems = problemsRes.rows;

    // 4. Fetch All Registered Student Participants
    const participantsText = `
      SELECT 
        u.id AS "userId",
        u.username,
        u.full_name AS "fullName",
        u.avatar_url AS "avatarUrl",
        u.current_rating AS "currentRating",
        u.highest_rating AS "highestRating",
        u.rating_status AS "ratingStatus",
        u.rated_contest_count AS "ratedContestCount",
        cp.joined_at AS "joinedAt"
      FROM contest_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.contest_id = $1 AND u.role = 'student'
      ORDER BY cp.joined_at ASC;
    `;
    const participantsRes = await executor.query(participantsText, [contestId]);
    const allParticipants = participantsRes.rows;

    // 5. Fetch Official Contest Submissions (up to freeze cutoff if active)
    let submissionsText = `
      SELECT 
        s.id AS "submissionId",
        s.user_id AS "userId",
        s.problem_id AS "problemId",
        s.status,
        s.score,
        s.execution_time AS "executionTime",
        s.memory_used AS "memoryUsed",
        s.created_at AS "submittedAt"
      FROM submissions s
      WHERE s.contest_id = $1 AND s.is_sample_run = false
    `;
    const subParams = [contestId];

    if (effectiveCutoff) {
      subParams.push(effectiveCutoff.toISOString());
      submissionsText += ` AND s.created_at <= $2`;
    }

    submissionsText += ` ORDER BY s.created_at ASC;`;
    const subsRes = await executor.query(submissionsText, subParams);
    const submissions = subsRes.rows;

    // Group submissions by userId -> problemId
    const userSubsMap = new Map();
    for (const sub of submissions) {
      if (!userSubsMap.has(sub.userId)) {
        userSubsMap.set(sub.userId, new Map());
      }
      const probMap = userSubsMap.get(sub.userId);
      if (!probMap.has(sub.problemId)) {
        probMap.set(sub.problemId, []);
      }
      probMap.get(sub.problemId).push(sub);
    }

    // 6. Compute Participant Scores, Penalties, and Problem Matrix
    const evaluatedParticipants = allParticipants.map((p) => {
      let totalScore = 0;
      let totalPenaltyMinutes = 0;
      let totalExecTimeMs = 0;
      let solvedCount = 0;
      let lastAcceptedTimestamp = null;
      const userProbs = userSubsMap.get(p.userId) || new Map();

      const problemDetails = contestProblems.map((prob) => {
        const subs = userProbs.get(prob.problemId) || [];
        let isSolved = false;
        let bestScore = 0;
        let firstAcceptedSub = null;
        let failedAttemptsBeforeSolve = 0;
        let bestExecTime = 0;

        for (const sub of subs) {
          if (sub.score > bestScore) {
            bestScore = sub.score;
          }
          if (sub.executionTime && (bestExecTime === 0 || sub.executionTime < bestExecTime)) {
            bestExecTime = sub.executionTime;
          }

          if (sub.status === 'accepted') {
            if (!isSolved) {
              isSolved = true;
              firstAcceptedSub = sub;
            }
          } else {
            if (!isSolved) {
              failedAttemptsBeforeSolve++;
            }
          }
        }

        let penaltyMinutes = 0;
        let acceptedTimeOffsetMin = null;

        if (isSolved && firstAcceptedSub) {
          solvedCount++;
          totalScore += prob.maxPoints;
          const subTime = new Date(firstAcceptedSub.submittedAt);
          acceptedTimeOffsetMin = Math.max(0, Math.floor((subTime.getTime() - startTime.getTime()) / 60000));
          penaltyMinutes = acceptedTimeOffsetMin + failedAttemptsBeforeSolve * 20;
          totalPenaltyMinutes += penaltyMinutes;

          if (!lastAcceptedTimestamp || subTime > lastAcceptedTimestamp) {
            lastAcceptedTimestamp = subTime;
          }
        } else if (subs.length > 0) {
          totalScore += bestScore;
        }

        totalExecTimeMs += bestExecTime;

        return {
          problemId: prob.problemId,
          problemOrder: prob.problemOrder,
          problemTitle: prob.title,
          difficulty: prob.difficulty,
          maxPoints: prob.maxPoints,
          status: isSolved ? 'solved' : subs.length > 0 ? 'failed' : 'unattempted',
          points: isSolved ? prob.maxPoints : bestScore,
          attemptsCount: subs.length,
          failedAttemptsBeforeSolve,
          acceptedTimeMinutes: acceptedTimeOffsetMin,
          penaltyContribution: penaltyMinutes,
          executionTimeMs: bestExecTime,
        };
      });

      let totalSubmissions = 0;
      for (const subList of userProbs.values()) {
        totalSubmissions += subList.length;
      }

      return {
        userId: p.userId,
        username: p.username,
        fullName: p.fullName,
        avatarUrl: p.avatarUrl,
        currentRating: p.currentRating,
        highestRating: p.highestRating,
        ratingStatus: p.ratingStatus,
        ratedContestCount: p.ratedContestCount,
        joinedAt: p.joinedAt,
        totalScore,
        totalPenaltyMinutes,
        totalTimeMs: totalExecTimeMs,
        solvedProblemsCount: solvedCount,
        totalSubmissions,
        lastAcceptedAt: lastAcceptedTimestamp ? lastAcceptedTimestamp.toISOString() : null,
        problems: problemDetails,
      };
    });

    // 7. Deterministic Ranking & Tie-Breaking
    // Rule 1: totalScore DESC
    // Rule 2: totalPenaltyMinutes ASC
    // Rule 3: lastAcceptedAt ASC
    // Rule 4: userId ASC
    evaluatedParticipants.sort((a, b) => {
      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }
      if (a.totalPenaltyMinutes !== b.totalPenaltyMinutes) {
        return a.totalPenaltyMinutes - b.totalPenaltyMinutes;
      }
      if (a.lastAcceptedAt && b.lastAcceptedAt) {
        const timeDiff = new Date(a.lastAcceptedAt).getTime() - new Date(b.lastAcceptedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
      } else if (a.lastAcceptedAt && !b.lastAcceptedAt) {
        return -1;
      } else if (!a.lastAcceptedAt && b.lastAcceptedAt) {
        return 1;
      }
      if (a.totalTimeMs !== b.totalTimeMs) {
        return a.totalTimeMs - b.totalTimeMs;
      }
      return a.userId - b.userId;
    });

    // Assign sequential ranks with standard tie handling
    for (let i = 0; i < evaluatedParticipants.length; i++) {
      if (i > 0) {
        const prev = evaluatedParticipants[i - 1];
        const curr = evaluatedParticipants[i];
        if (
          curr.totalScore === prev.totalScore &&
          curr.totalPenaltyMinutes === prev.totalPenaltyMinutes &&
          curr.lastAcceptedAt === prev.lastAcceptedAt &&
          curr.totalTimeMs === prev.totalTimeMs
        ) {
          curr.rank = prev.rank;
        } else {
          curr.rank = i + 1;
        }
      } else {
        evaluatedParticipants[i].rank = 1;
      }
      // Initial movement placeholder (0 for stable)
      evaluatedParticipants[i].rankMovement = 0;
    }

    // Attach Official Rating Changes if Contest is Finalized
    if (formattedContest.isRatingFinalized) {
      try {
        const rhAllText = `
          SELECT user_id AS "userId", previous_rating AS "previousRating", rating_change AS "ratingChange", new_rating AS "newRating"
          FROM rating_history
          WHERE contest_id = $1;
        `;
        const rhAllRes = await executor.query(rhAllText, [contestId]);
        const rhMap = new Map();
        for (const row of rhAllRes.rows) {
          rhMap.set(row.userId, row);
        }
        for (const p of evaluatedParticipants) {
          const rh = rhMap.get(p.userId);
          if (rh) {
            p.previousRating = rh.previousRating;
            p.ratingChange = rh.ratingChange;
            p.newRating = rh.newRating;
          } else {
            p.previousRating = p.currentRating;
            p.ratingChange = null;
            p.newRating = p.currentRating;
          }
        }
      } catch (e) {
        // Non-critical fallback
      }
    }

    // 8. Podium Computation (Top 3 Ranks)
    const podium = evaluatedParticipants.slice(0, 3).map((p, idx) => ({
      podiumRank: idx + 1,
      rank: p.rank,
      userId: p.userId,
      username: p.username,
      fullName: p.fullName,
      avatarUrl: p.avatarUrl,
      currentRating: p.currentRating,
      ratingChange: p.ratingChange !== undefined ? p.ratingChange : null,
      newRating: p.newRating !== undefined ? p.newRating : p.currentRating,
      totalScore: p.totalScore,
      solvedProblemsCount: p.solvedProblemsCount,
      totalPenaltyMinutes: p.totalPenaltyMinutes,
    }));

    // 9. Current User Position Extraction
    let userPosition = null;
    if (requestingUser) {
      const userRow = evaluatedParticipants.find((p) => p.userId === requestingUser.id);
      if (userRow) {
        userPosition = {
          isParticipating: true,
          rank: userRow.rank,
          userId: userRow.userId,
          username: userRow.username,
          fullName: userRow.fullName,
          totalScore: userRow.totalScore,
          solvedProblemsCount: userRow.solvedProblemsCount,
          totalProblems: contestProblems.length,
          totalPenaltyMinutes: userRow.totalPenaltyMinutes,
          ratingChange: userRow.ratingChange !== undefined ? userRow.ratingChange : null,
          newRating: userRow.newRating !== undefined ? userRow.newRating : userRow.currentRating,
        };

        // Fallback check if rating history was not attached above
        if (formattedContest.isRatingFinalized && userPosition.ratingChange === null) {
          try {
            const rhText = `
              SELECT rating_change AS "ratingChange", new_rating AS "newRating"
              FROM rating_history
              WHERE contest_id = $1 AND user_id = $2;
            `;
            const rhRes = await executor.query(rhText, [contestId, requestingUser.id]);
            if (rhRes.rows[0]) {
              userPosition.ratingChange = rhRes.rows[0].ratingChange;
              userPosition.newRating = rhRes.rows[0].newRating;
            }
          } catch (e) {
            // Non-critical fallback
          }
        }
      } else {
        userPosition = { isParticipating: false };
      }
    }

    // 10. Filter Search, Status & Server-Side Pagination
    let filteredParticipants = evaluatedParticipants;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredParticipants = evaluatedParticipants.filter(
        (p) =>
          p.username.toLowerCase().includes(q) ||
          (p.fullName && p.fullName.toLowerCase().includes(q))
      );
    }

    if (filterStatus && filterStatus !== 'all') {
      if (filterStatus === 'solved_any') {
        filteredParticipants = filteredParticipants.filter((p) => p.solvedProblemsCount > 0);
      } else if (filterStatus === 'has_submissions') {
        filteredParticipants = filteredParticipants.filter((p) => p.totalSubmissions > 0);
      } else if (filterStatus === 'no_submissions') {
        filteredParticipants = filteredParticipants.filter((p) => p.totalSubmissions === 0);
      }
    }

    // Whitelisted sort fields: rank, score, solved, penalty, participant, submissions
    const validSortFields = ['rank', 'score', 'solved', 'penalty', 'participant', 'submissions'];
    const activeSortBy = validSortFields.includes(sortBy) ? sortBy : 'rank';
    const isDesc = String(sortOrder || '').toUpperCase() === 'DESC';

    if (activeSortBy !== 'rank' || isDesc) {
      filteredParticipants = [...filteredParticipants].sort((a, b) => {
        let cmp = 0;
        switch (activeSortBy) {
          case 'score':
            cmp = a.totalScore - b.totalScore;
            break;
          case 'solved':
            cmp = a.solvedProblemsCount - b.solvedProblemsCount;
            break;
          case 'penalty':
            cmp = a.totalPenaltyMinutes - b.totalPenaltyMinutes;
            break;
          case 'participant':
            cmp = (a.fullName || a.username).localeCompare(b.fullName || b.username);
            break;
          case 'submissions':
            cmp = a.totalSubmissions - b.totalSubmissions;
            break;
          case 'rank':
          default:
            cmp = a.rank - b.rank;
            break;
        }
        return isDesc ? -cmp : cmp;
      });
    }

    const totalParticipants = filteredParticipants.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const totalPages = Math.max(1, Math.ceil(totalParticipants / limitNum));
    const offset = (pageNum - 1) * limitNum;
    const paginatedStandings = filteredParticipants.slice(offset, offset + limitNum);

    // 11. Contest Summary Metrics
    const scores = evaluatedParticipants.map((p) => p.totalScore);
    const topScore = scores.length > 0 ? Math.max(...scores) : 0;
    const avgScore =
      scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    const sortedScores = [...scores].sort((a, b) => a - b);
    const medianScore =
      sortedScores.length > 0
        ? sortedScores[Math.floor(sortedScores.length / 2)]
        : 0;

    const contestSummary = {
      totalParticipants: evaluatedParticipants.length,
      totalProblems: contestProblems.length,
      topScore,
      averageScore: avgScore,
      medianScore,
    };

    return {
      contest: {
        ...formattedContest,
        isFrozen,
        freezeState,
        freezeTime: freezeTime ? freezeTime.toISOString() : null,
        serverTime: serverTimeIso,
      },
      isFrozen,
      freezeState,
      problems: contestProblems.map((p) => ({
        problemId: p.problemId,
        problemOrder: p.problemOrder,
        title: p.title,
        difficulty: p.difficulty,
        maxPoints: p.maxPoints,
      })),
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalParticipants,
        limit: limitNum,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
        sortBy: activeSortBy,
        sortOrder: isDesc ? 'DESC' : 'ASC',
        filterStatus: filterStatus || 'all',
      },
      standings: paginatedStandings,
      podium,
      userPosition,
      contestSummary,
    };
  }

  /**
   * Authoritative Contest Results computation
   * Reuses computeContestStandings and structures response explicitly for Contest Results view
   * 
   * @param {Object} params
   * @returns {Promise<Object>} Authoritative Results Payload
   */
  static async computeContestResults(params) {
    const standingsData = await this.computeContestStandings(params);
    return {
      contest: standingsData.contest,
      resultSummary: {
        totalParticipants: standingsData.contestSummary.totalParticipants,
        totalProblems: standingsData.contestSummary.totalProblems,
        topScore: standingsData.contestSummary.topScore,
        averageScore: standingsData.contestSummary.averageScore,
        medianScore: standingsData.contestSummary.medianScore,
        isFinalized: Boolean(standingsData.contest.isRatingFinalized),
        ratingsFinalizedAt: standingsData.contest.ratingsFinalizedAt || null,
        runtimeState: standingsData.contest.runtimeState,
        isFrozen: standingsData.contest.isFrozen,
        freezeState: standingsData.contest.freezeState,
      },
      results: standingsData.standings,
      standings: standingsData.standings,
      podium: standingsData.podium,
      userResult: standingsData.userPosition,
      userPosition: standingsData.userPosition,
      problems: standingsData.problems,
      pagination: standingsData.pagination,
      contestSummary: standingsData.contestSummary,
    };
  }

  /**
   * Authoritative Participant Contest Result Details
   * Computes individual participant summary, problem-by-problem performance,
   * and submission history with freeze masking and authorization controls.
   *
   * @param {Object} params
   * @param {number} params.contestId
   * @param {number} params.targetUserId
   * @param {Object} [params.requestingUser=null]
   * @param {boolean} [params.freezeOverride=false]
   * @param {Object} [params.clientOrDb=null]
   * @returns {Promise<Object>} Authoritative Participant Result Details Payload
   */
  static async computeParticipantResultDetails({
    contestId,
    targetUserId,
    requestingUser = null,
    freezeOverride = false,
    clientOrDb = null,
  }) {
    const executor = clientOrDb || db;

    // 1. Fetch entire contest standings using authoritative computeContestStandings
    const standingsData = await this.computeContestStandings({
      contestId,
      requestingUser,
      page: 1,
      limit: 10000,
      freezeOverride,
      clientOrDb: executor,
    });

    // 2. Locate target participant row
    const allRows = standingsData._allParticipants || standingsData.standings || [];
    const targetParticipant = allRows.find((p) => Number(p.userId) === Number(targetUserId));
    if (!targetParticipant) {
      const err = new Error(`Participant with ID ${targetUserId} not found in contest ${contestId}`);
      err.statusCode = 404;
      throw err;
    }

    // 3. Determine Freeze Cutoff for Submissions History
    const contest = standingsData.contest;
    const isFrozen = Boolean(contest.isFrozen);
    const isManager = Boolean(
      requestingUser &&
      (requestingUser.role === 'super_admin' ||
        requestingUser.role === 'contest_admin' ||
        (requestingUser.role === 'professor' && requestingUser.id === contest.createdBy))
    );
    const applyFreezeCutoff = isFrozen && !(isManager && freezeOverride);

    // 4. Query participant submission history for this contest
    let subsQuery = `
      SELECT 
        s.id,
        s.problem_id AS "problemId",
        cp.problem_order AS "problemOrder",
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        s.language,
        s.coding_mode AS "codingMode",
        s.status,
        s.score,
        s.execution_time AS "executionTime",
        s.memory_used AS "memoryUsed",
        s.error_message AS "errorMessage",
        s.created_at AS "submittedAt",
        s.source_code AS "sourceCode"
      FROM submissions s
      JOIN contest_problems cp ON s.contest_id = cp.contest_id AND s.problem_id = cp.problem_id
      JOIN problems p ON s.problem_id = p.id
      WHERE s.contest_id = $1 AND s.user_id = $2 AND s.is_sample_run = false
    `;
    const queryParams = [contestId, targetUserId];

    if (applyFreezeCutoff && contest.freezeTime) {
      queryParams.push(new Date(contest.freezeTime).toISOString());
      subsQuery += ` AND s.created_at <= $3`;
    }

    subsQuery += ` ORDER BY s.created_at DESC;`;

    const subsRes = await executor.query(subsQuery, queryParams);

    // 5. Code viewing permissions check
    const canViewCode = Boolean(
      requestingUser &&
      (requestingUser.id === targetUserId ||
        requestingUser.role === 'super_admin' ||
        requestingUser.role === 'contest_admin' ||
        (requestingUser.role === 'professor' && requestingUser.id === contest.createdBy))
    );

    const formattedSubmissions = subsRes.rows.map((sub) => ({
      id: sub.id,
      problemId: sub.problemId,
      problemOrder: sub.problemOrder,
      problemTitle: sub.problemTitle,
      problemDifficulty: sub.problemDifficulty,
      language: sub.language,
      codingMode: sub.codingMode,
      status: sub.status,
      score: sub.score,
      executionTime: sub.executionTime,
      memoryUsed: sub.memoryUsed,
      errorMessage: sub.errorMessage || null,
      submittedAt: sub.submittedAt,
      canViewCode,
      sourceCode: canViewCode ? sub.sourceCode : null,
    }));

    return {
      contest: {
        id: contest.id,
        title: contest.title,
        status: contest.status,
        runtimeState: contest.runtimeState,
        isRated: contest.isRated,
        isRatingFinalized: contest.isRatingFinalized,
        ratingsFinalizedAt: contest.ratingsFinalizedAt,
        isFrozen: contest.isFrozen,
        freezeState: contest.freezeState || (contest.isFrozen ? 'FROZEN' : (contest.isRatingFinalized ? 'FINAL' : 'NOT_FROZEN')),
        freezeTime: contest.freezeTime,
        startTime: contest.startTime,
        endTime: contest.endTime,
      },
      participant: {
        userId: targetParticipant.userId,
        username: targetParticipant.username,
        fullName: targetParticipant.fullName,
        avatarUrl: targetParticipant.avatarUrl,
        currentRating: targetParticipant.currentRating,
        highestRating: targetParticipant.highestRating,
        ratingStatus: targetParticipant.ratingStatus,
        previousRating: targetParticipant.previousRating,
        ratingChange: targetParticipant.ratingChange,
        newRating: targetParticipant.newRating,
        joinedAt: targetParticipant.joinedAt,
      },
      summary: {
        rank: targetParticipant.rank,
        totalScore: targetParticipant.totalScore,
        solvedProblemsCount: targetParticipant.solvedProblemsCount,
        totalProblems: standingsData.problems.length,
        totalPenaltyMinutes: targetParticipant.totalPenaltyMinutes,
        totalTimeMs: targetParticipant.totalTimeMs,
        totalSubmissions: targetParticipant.totalSubmissions,
        lastAcceptedAt: targetParticipant.lastAcceptedAt,
        isFrozen: contest.isFrozen,
        freezeState: contest.freezeState || (contest.isFrozen ? 'FROZEN' : (contest.isRatingFinalized ? 'FINAL' : 'NOT_FROZEN')),
      },
      problems: targetParticipant.problems,
      submissions: formattedSubmissions,
    };
  }
}

module.exports = StandingsService;
