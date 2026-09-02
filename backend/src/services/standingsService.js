const db = require('../config/db');
const ContestModel = require('../models/contestModel');
const { getContestRuntimeState, formatContest } = require('./contestService');

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
    const now = new Date();
    const startTime = new Date(formattedContest.startTime);
    const endTime = new Date(formattedContest.endTime);
    const serverTimeIso = now.toISOString();

    // 2. Freeze Status Calculation
    const freezeMinutes = formattedContest.leaderboardFreezeMinutes || 60;
    const freezeTime = new Date(endTime.getTime() - freezeMinutes * 60000);
    const isFrozen =
      formattedContest.leaderboardFreezeEnabled &&
      now >= freezeTime &&
      now <= endTime &&
      !formattedContest.isRatingFinalized;

    // Determine if submissions should be filtered by freeze cutoff
    const isManager =
      requestingUser &&
      (requestingUser.role === 'super_admin' ||
        requestingUser.role === 'contest_admin' ||
        (requestingUser.role === 'professor' && requestingUser.id === formattedContest.createdBy));

    const applyFreezeCutoff = isFrozen && !(isManager && freezeOverride);
    const effectiveCutoff = applyFreezeCutoff ? freezeTime : null;

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

    // 8. Podium Computation (Top 3 Ranks)
    const podium = evaluatedParticipants.slice(0, 3).map((p, idx) => ({
      podiumRank: idx + 1,
      rank: p.rank,
      userId: p.userId,
      username: p.username,
      fullName: p.fullName,
      avatarUrl: p.avatarUrl,
      currentRating: p.currentRating,
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
          ratingChange: null, // Populated below if rating finalized
        };

        // If contest ratings are finalized, attach official rating change from rating_history
        if (formattedContest.isRatingFinalized) {
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

    // 10. Filter Search & Server-Side Pagination
    let filteredParticipants = evaluatedParticipants;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredParticipants = evaluatedParticipants.filter(
        (p) =>
          p.username.toLowerCase().includes(q) ||
          (p.fullName && p.fullName.toLowerCase().includes(q))
      );
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
        freezeTime: freezeTime.toISOString(),
        serverTime: serverTimeIso,
      },
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
      },
      standings: paginatedStandings,
      podium,
      userPosition,
      contestSummary,
    };
  }
}

module.exports = StandingsService;
