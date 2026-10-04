/**
 * Contest Export & Reporting Service
 * File: backend/src/services/contestExportService.js
 *
 * Implements authoritative export of contest results, participant summaries,
 * and submissions in standard CSV and JSON formats.
 *
 * Key guarantees:
 * - Reuses authoritative StandingsService and database queries (no duplicate scoring logic).
 * - Enforces CSV formula injection defense (neutralizes `=+-@\t\r` prefixes).
 * - Excludes sensitive information (no passwords, hashes, tokens, or infrastructure secrets).
 * - Memory efficient with zero N+1 database queries.
 */

const db = require('../config/db');
const ContestModel = require('../models/contestModel');
const StandingsService = require('./standingsService');
const { getContestFreezeState, formatContest } = require('./contestService');

/**
 * Escapes a cell value for standard RFC 4180 CSV compliance
 * and neutralizes spreadsheet formula injection (CSV Injection).
 *
 * @param {any} val
 * @returns {string} Escaped CSV string
 */
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);

  // Formula injection defense: prefix dangerous leading characters with a single quote
  // Neutralizes leading formula triggers including whitespace-padded attempts
  if (/^\s*[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
}

class ContestExportService {
  /**
   * Export Contest Results / Leaderboard Standings
   *
   * @param {Object} options
   * @param {number} options.contestId
   * @param {Object} [options.requestingUser=null]
   * @param {string} [options.format='csv'] - 'csv' | 'json'
   * @param {boolean} [options.freezeOverride=false]
   * @returns {Promise<{ content: string, contentType: string, filename: string, rowCount: number }>}
   */
  static async exportContestResults({
    contestId,
    requestingUser = null,
    format = 'csv',
    freezeOverride = false,
  }) {
    const normFormat = String(format || 'csv').trim().toLowerCase();
    if (!['csv', 'json'].includes(normFormat)) {
      const err = new Error("Invalid export format. Allowed formats: 'csv', 'json'");
      err.statusCode = 400;
      throw err;
    }

    // Compute authoritative standings without pagination limit
    const standingsData = await StandingsService.computeContestStandings({
      contestId,
      requestingUser,
      freezeOverride,
      isExport: true,
      limit: 'all',
    });

    const contest = standingsData.contest;
    const problems = standingsData.problems || [];
    const standings = standingsData.standings || [];
    const contestSummary = standingsData.contestSummary || {};

    if (normFormat === 'json') {
      const jsonPayload = {
        contest: {
          id: contest.id,
          title: contest.title,
          status: contest.status,
          runtimeState: contest.runtimeState,
          isRated: contest.isRated,
          isRatingFinalized: contest.isRatingFinalized,
          ratingsFinalizedAt: contest.ratingsFinalizedAt,
          isFrozen: contest.isFrozen,
          freezeState: contest.freezeState,
          startTime: contest.startTime,
          endTime: contest.endTime,
        },
        exportedAt: new Date().toISOString(),
        totalParticipants: standings.length,
        summary: contestSummary,
        problems: problems.map((p) => ({
          problemId: p.problemId,
          problemOrder: p.problemOrder,
          title: p.title,
          difficulty: p.difficulty,
          maxPoints: p.maxPoints,
        })),
        standings: standings.map((row) => {
          let problemResults = row.problemResults;
          if (!problemResults && Array.isArray(row.problems)) {
            problemResults = {};
            for (const pr of row.problems) {
              problemResults[pr.problemId] = {
                points: pr.points || 0,
                status: pr.status || 'unattempted',
                attemptsCount: pr.attemptsCount || 0,
                penaltyContribution: pr.penaltyContribution || 0,
                acceptedTimeMinutes: pr.acceptedTimeMinutes ?? null,
                solved: pr.status === 'solved',
              };
            }
          }
          return {
            rank: row.rank,
            userId: row.userId,
            username: row.username,
            fullName: row.fullName,
            totalScore: row.totalScore,
            solvedProblemsCount: row.solvedProblemsCount,
            totalPenaltyMinutes: row.totalPenaltyMinutes,
            totalSubmissions: row.totalSubmissions,
            ratingChange: row.ratingChange ?? null,
            problemResults: problemResults || {},
          };
        }),
      };

      return {
        content: JSON.stringify(jsonPayload, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `contest_${contestId}_results_${Date.now()}.json`,
        rowCount: standings.length,
      };
    }

    // CSV format generation
    const headers = [
      'Rank',
      'User ID',
      'Username',
      'Full Name',
      'Total Score',
      'Problems Solved',
      'Penalty Time (min)',
      'Total Submissions',
    ];

    // Append dynamic problem columns
    problems.forEach((p) => {
      headers.push(`P${p.problemOrder}: ${p.title} (Points)`);
      headers.push(`P${p.problemOrder}: ${p.title} (Status)`);
    });

    if (contest.isRated) {
      headers.push('Rating Change');
    }

    const csvRows = [headers.map(escapeCsv).join(',')];

    for (const row of standings) {
      const problemMap = Array.isArray(row.problems)
        ? new Map(row.problems.map((prob) => [prob.problemId, prob]))
        : new Map();

      const rowData = [
        row.rank,
        row.userId,
        row.username,
        row.fullName || '',
        row.totalScore,
        row.solvedProblemsCount,
        row.totalPenaltyMinutes,
        row.totalSubmissions,
      ];

      // Add problem results
      problems.forEach((p) => {
        const pr = problemMap.get(p.problemId) || row.problemResults?.[p.problemId];
        if (pr) {
          rowData.push(pr.points || 0);
          rowData.push(pr.status || 'unattempted');
        } else {
          rowData.push(0);
          rowData.push('unattempted');
        }
      });

      if (contest.isRated) {
        rowData.push(row.ratingChange !== null && row.ratingChange !== undefined ? row.ratingChange : '');
      }

      csvRows.push(rowData.map(escapeCsv).join(','));
    }

    return {
      content: csvRows.join('\r\n'),
      contentType: 'text/csv; charset=utf-8',
      filename: `contest_${contestId}_results_${Date.now()}.csv`,
      rowCount: standings.length,
    };
  }

  /**
   * Export All Participants Summary Report
   *
   * @param {Object} options
   * @param {number} options.contestId
   * @param {Object} [options.requestingUser=null]
   * @param {string} [options.format='csv']
   * @param {boolean} [options.freezeOverride=false]
   * @returns {Promise<{ content: string, contentType: string, filename: string, rowCount: number }>}
   */
  static async exportAllParticipants({
    contestId,
    requestingUser = null,
    format = 'csv',
    freezeOverride = false,
  }) {
    const normFormat = String(format || 'csv').trim().toLowerCase();
    if (!['csv', 'json'].includes(normFormat)) {
      const err = new Error("Invalid export format. Allowed formats: 'csv', 'json'");
      err.statusCode = 400;
      throw err;
    }

    const standingsData = await StandingsService.computeContestStandings({
      contestId,
      requestingUser,
      freezeOverride,
      isExport: true,
      limit: 'all',
    });

    const contest = standingsData.contest;
    const standings = standingsData.standings || [];

    if (normFormat === 'json') {
      const jsonPayload = {
        contestId: contest.id,
        contestTitle: contest.title,
        exportedAt: new Date().toISOString(),
        totalParticipants: standings.length,
        participantCount: standings.length,
        participants: standings.map((p) => ({
          userId: p.userId,
          username: p.username,
          fullName: p.fullName,
          rank: p.rank,
          score: p.totalScore,
          solvedCount: p.solvedProblemsCount,
          penaltyMinutes: p.totalPenaltyMinutes,
          submissionsCount: p.totalSubmissions,
          currentRating: p.currentRating,
          ratingChange: p.ratingChange ?? null,
        })),
      };

      return {
        content: JSON.stringify(jsonPayload, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `contest_${contestId}_participants_${Date.now()}.json`,
        rowCount: standings.length,
      };
    }

    const headers = [
      'Rank',
      'User ID',
      'Username',
      'Full Name',
      'Score',
      'Solved Problems',
      'Penalty (min)',
      'Submissions Count',
      'Current Rating',
      'Rating Change',
    ];

    const csvRows = [headers.map(escapeCsv).join(',')];

    for (const p of standings) {
      csvRows.push(
        [
          p.rank,
          p.userId,
          p.username,
          p.fullName || '',
          p.totalScore,
          p.solvedProblemsCount,
          p.totalPenaltyMinutes,
          p.totalSubmissions,
          p.currentRating || '',
          p.ratingChange ?? '',
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    return {
      content: csvRows.join('\r\n'),
      contentType: 'text/csv; charset=utf-8',
      filename: `contest_${contestId}_participants_${Date.now()}.csv`,
      rowCount: standings.length,
    };
  }

  /**
   * Export Individual Participant Performance Details
   *
   * @param {Object} options
   * @param {number} options.contestId
   * @param {number} options.targetUserId
   * @param {Object} [options.requestingUser=null]
   * @param {string} [options.format='csv']
   * @param {boolean} [options.freezeOverride=false]
   * @returns {Promise<{ content: string, contentType: string, filename: string, rowCount: number }>}
   */
  static async exportParticipantDetails({
    contestId,
    targetUserId,
    requestingUser = null,
    format = 'csv',
    freezeOverride = false,
  }) {
    const normFormat = String(format || 'csv').trim().toLowerCase();
    if (!['csv', 'json'].includes(normFormat)) {
      const err = new Error("Invalid export format. Allowed formats: 'csv', 'json'");
      err.statusCode = 400;
      throw err;
    }

    const details = await StandingsService.computeParticipantResultDetails({
      contestId,
      targetUserId,
      requestingUser,
      freezeOverride,
    });

    const participant = details.participant;
    const summary = details.summary;
    const problems = details.problems || [];
    const submissions = details.submissions || [];

    if (normFormat === 'json') {
      const jsonPayload = {
        contest: details.contest,
        participant: {
          userId: participant.userId,
          username: participant.username,
          fullName: participant.fullName,
          currentRating: participant.currentRating,
          ratingChange: participant.ratingChange,
        },
        summary,
        problems,
        submissions: submissions.map((s) => ({
          submissionId: s.id,
          problemId: s.problemId,
          problemOrder: s.problemOrder,
          problemTitle: s.problemTitle,
          language: s.language,
          status: s.status,
          score: s.score,
          executionTime: s.executionTime,
          memoryUsed: s.memoryUsed,
          submittedAt: s.submittedAt,
        })),
        exportedAt: new Date().toISOString(),
      };

      return {
        content: JSON.stringify(jsonPayload, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `contest_${contestId}_participant_${targetUserId}_${Date.now()}.json`,
        rowCount: submissions.length,
      };
    }

    // CSV representation with sections
    const lines = [];

    // Section 1: Overview
    lines.push(escapeCsv('=== PARTICIPANT SUMMARY ==='));
    lines.push(['Rank', 'User ID', 'Username', 'Full Name', 'Total Score', 'Solved Problems', 'Total Penalty (min)', 'Total Submissions'].map(escapeCsv).join(','));
    lines.push([
      summary.rank,
      participant.userId,
      participant.username,
      participant.fullName || '',
      summary.totalScore,
      summary.solvedProblemsCount,
      summary.totalPenaltyMinutes,
      summary.totalSubmissions,
    ].map(escapeCsv).join(','));

    lines.push(''); // Blank line separator

    // Section 2: Problem Performance
    lines.push(escapeCsv('=== PROBLEM PERFORMANCE ==='));
    lines.push(['Problem Order', 'Problem Title', 'Difficulty', 'Status', 'Points', 'Attempts', 'Penalty (min)', 'Accepted Time (min)'].map(escapeCsv).join(','));
    for (const pr of problems) {
      lines.push([
        pr.problemOrder,
        pr.problemTitle,
        pr.problemDifficulty,
        pr.status,
        pr.points,
        pr.attemptsCount,
        pr.penaltyContribution ?? pr.penaltyContributionMinutes ?? 0,
        pr.acceptedTimeMinutes ?? '',
      ].map(escapeCsv).join(','));
    }

    lines.push(''); // Blank line separator

    // Section 3: Submissions Log
    lines.push(escapeCsv('=== SUBMISSIONS LOG ==='));
    lines.push(['Submission ID', 'Problem Order', 'Problem Title', 'Language', 'Verdict', 'Score', 'Execution Time (ms)', 'Memory (KB)', 'Submitted At'].map(escapeCsv).join(','));
    for (const sub of submissions) {
      lines.push([
        sub.id,
        sub.problemOrder,
        sub.problemTitle,
        sub.language,
        sub.status,
        sub.score,
        sub.executionTime || 0,
        sub.memoryUsed || 0,
        sub.submittedAt ? new Date(sub.submittedAt).toISOString() : '',
      ].map(escapeCsv).join(','));
    }

    return {
      content: lines.join('\r\n'),
      contentType: 'text/csv; charset=utf-8',
      filename: `contest_${contestId}_participant_${targetUserId}_${Date.now()}.csv`,
      rowCount: submissions.length,
    };
  }

  /**
   * Export Contest Submissions Report
   *
   * @param {Object} options
   * @param {number} options.contestId
   * @param {Object} [options.requestingUser=null]
   * @param {string} [options.format='csv']
   * @param {boolean} [options.freezeOverride=false]
   * @returns {Promise<{ content: string, contentType: string, filename: string, rowCount: number }>}
   */
  static async exportContestSubmissions({
    contestId,
    requestingUser = null,
    format = 'csv',
    freezeOverride = false,
  }) {
    const normFormat = String(format || 'csv').trim().toLowerCase();
    if (!['csv', 'json'].includes(normFormat)) {
      const err = new Error("Invalid export format. Allowed formats: 'csv', 'json'");
      err.statusCode = 400;
      throw err;
    }

    // Verify contest existence
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      const err = new Error(`Contest with ID ${contestId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const formattedContest = formatContest(contest);
    const freezeInfo = getContestFreezeState(formattedContest, new Date());
    const isFrozen = freezeInfo.isFrozen;
    const freezeTime = freezeInfo.freezeTime;

    const isManager = Boolean(
      requestingUser &&
      (requestingUser.role === 'super_admin' ||
        requestingUser.role === 'contest_admin' ||
        (requestingUser.role === 'professor' && requestingUser.id === formattedContest.createdBy))
    );

    const applyFreezeCutoff = isFrozen && !(isManager && freezeOverride);

    // Efficient indexed query joining submissions with contest problems and user details
    let subsQuery = `
      SELECT 
        s.id AS "submissionId",
        s.problem_id AS "problemId",
        cp.problem_order AS "problemOrder",
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        s.user_id AS "userId",
        u.username,
        u.full_name AS "fullName",
        s.language,
        s.status AS "verdict",
        s.score,
        s.execution_time AS "executionTimeMs",
        s.memory_used AS "memoryUsedBytes",
        s.created_at AS "submittedAt"
      FROM submissions s
      JOIN contest_problems cp ON s.contest_id = cp.contest_id AND s.problem_id = cp.problem_id
      JOIN problems p ON s.problem_id = p.id
      JOIN users u ON s.user_id = u.id
      WHERE s.contest_id = $1 AND s.is_sample_run = false
    `;
    const queryParams = [contestId];

    if (applyFreezeCutoff && freezeTime) {
      queryParams.push(freezeTime.toISOString());
      subsQuery += ` AND s.created_at <= $2`;
    }

    subsQuery += ` ORDER BY s.created_at DESC;`;

    const res = await db.query(subsQuery, queryParams);
    const submissions = res.rows;

    if (normFormat === 'json') {
      const jsonPayload = {
        contestId: contest.id,
        contestTitle: contest.title,
        exportedAt: new Date().toISOString(),
        totalSubmissions: submissions.length,
        submissions: submissions.map((s) => ({
          submissionId: s.submissionId,
          problemId: s.problemId,
          problemOrder: s.problemOrder,
          problemTitle: s.problemTitle,
          problemDifficulty: s.problemDifficulty,
          userId: s.userId,
          username: s.username,
          fullName: s.fullName,
          language: s.language,
          verdict: s.verdict,
          score: s.score,
          executionTimeMs: s.executionTimeMs,
          memoryUsedBytes: s.memoryUsedBytes,
          submittedAt: s.submittedAt,
        })),
      };

      return {
        content: JSON.stringify(jsonPayload, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `contest_${contestId}_submissions_${Date.now()}.json`,
        rowCount: submissions.length,
      };
    }

    const headers = [
      'Submission ID',
      'Problem ID',
      'Problem Order',
      'Problem Title',
      'Difficulty',
      'User ID',
      'Username',
      'Full Name',
      'Language',
      'Verdict',
      'Score',
      'Execution Time (ms)',
      'Memory Used (bytes)',
      'Submitted At',
    ];

    const csvRows = [headers.map(escapeCsv).join(',')];

    for (const s of submissions) {
      csvRows.push(
        [
          s.submissionId,
          s.problemId,
          s.problemOrder,
          s.problemTitle,
          s.problemDifficulty,
          s.userId,
          s.username,
          s.fullName || '',
          s.language,
          s.verdict,
          s.score,
          s.executionTimeMs || 0,
          s.memoryUsedBytes || 0,
          s.submittedAt ? new Date(s.submittedAt).toISOString() : '',
        ]
          .map(escapeCsv)
          .join(',')
      );
    }

    return {
      content: csvRows.join('\r\n'),
      contentType: 'text/csv; charset=utf-8',
      filename: `contest_${contestId}_submissions_${Date.now()}.csv`,
      rowCount: submissions.length,
    };
  }
}

module.exports = ContestExportService;
