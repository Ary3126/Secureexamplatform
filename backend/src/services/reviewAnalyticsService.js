const db = require('../config/db');

/**
 * ReviewAnalyticsService - Review Pipeline Intelligence, Turnaround Benchmarks & SLA Aging
 */

/**
 * Calculate median value from an array of numbers
 */
function calculateMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate SLA Status based on age in hours
 */
function calculateSlaStatus(ageHours) {
  if (ageHours < 24) return 'ON_TIME';
  if (ageHours <= 48) return 'AT_RISK';
  return 'OVERDUE';
}

/**
 * Get Review Analytics for a specific problem or globally across the platform
 */
async function getReviewAnalytics({ problemId = null, authorId = null, client = null } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (problemId) {
    conditions.push(`r.problem_id = $${idx++}`);
    values.push(problemId);
  }
  if (authorId) {
    conditions.push(`r.submitted_by = $${idx++}`);
    values.push(authorId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const queryText = `
    SELECT 
      r.id,
      r.problem_id AS "problemId",
      r.problem_version AS "problemVersion",
      r.submitted_by AS "submittedBy",
      r.reviewer_id AS "reviewerId",
      r.status,
      r.decision_reason AS "decisionReason",
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt",
      EXTRACT(EPOCH FROM (r.updated_at - r.created_at)) / 3600.0 AS "durationHours",
      EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 3600.0 AS "ageHours"
    FROM problem_reviews r
    ${whereClause}
    ORDER BY r.created_at DESC;
  `;

  const res = await (client || db).query(queryText, values);
  const reviews = res.rows;

  const totalReviews = reviews.length;
  const statusCounts = {
    pending: 0,
    in_review: 0,
    changes_requested: 0,
    rejected: 0,
    approved: 0,
    revoked: 0,
  };

  const completedDurations = [];
  const activeSlaDistribution = {
    ON_TIME: 0,
    AT_RISK: 0,
    OVERDUE: 0,
  };

  let oldestPendingReview = null;
  let maxPendingAge = -1;

  for (const r of reviews) {
    const st = r.status || 'pending';
    if (statusCounts[st] !== undefined) {
      statusCounts[st]++;
    }

    const duration = parseFloat(r.durationHours) || 0;
    const age = parseFloat(r.ageHours) || 0;

    if (['approved', 'rejected', 'changes_requested'].includes(st)) {
      completedDurations.push(duration);
    }

    if (['pending', 'in_review'].includes(st)) {
      const sla = calculateSlaStatus(age);
      activeSlaDistribution[sla]++;

      if (age > maxPendingAge) {
        maxPendingAge = age;
        oldestPendingReview = {
          reviewId: r.id,
          problemId: r.problemId,
          version: r.problemVersion,
          status: r.status,
          ageHours: Math.round(age * 10) / 10,
          slaStatus: sla,
        };
      }
    }
  }

  const decidedCount = statusCounts.approved + statusCounts.rejected + statusCounts.changes_requested;
  const approvalRate = decidedCount > 0 ? Math.round((statusCounts.approved / decidedCount) * 1000) / 10 : 0.0;
  const rejectionRate = decidedCount > 0 ? Math.round((statusCounts.rejected / decidedCount) * 1000) / 10 : 0.0;
  const changesRequestedRate = decidedCount > 0 ? Math.round((statusCounts.changes_requested / decidedCount) * 1000) / 10 : 0.0;

  const avgDurationHours = completedDurations.length > 0
    ? Math.round((completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length) * 10) / 10
    : 0.0;

  const medianDurationHours = Math.round(calculateMedian(completedDurations) * 10) / 10;
  const backlog = statusCounts.pending + statusCounts.in_review;

  return {
    totalReviews,
    statusCounts,
    decidedCount,
    rates: {
      approvalRate,
      rejectionRate,
      changesRequestedRate,
    },
    timing: {
      avgDurationHours,
      medianDurationHours,
      completedReviewsCount: completedDurations.length,
    },
    backlog: {
      totalActiveBacklog: backlog,
      oldestPendingReview,
      slaDistribution: activeSlaDistribution,
    },
  };
}

/**
 * Get Reviewer Performance & Workload Analytics
 */
async function getReviewerPerformanceAnalytics(client = null) {
  const queryText = `
    SELECT 
      u.id AS "reviewerId",
      u.username,
      u.full_name AS "fullName",
      u.role,
      COUNT(r.id)::int AS "totalAssigned",
      COUNT(CASE WHEN r.status = 'in_review' THEN 1 END)::int AS "activeWorkload",
      COUNT(CASE WHEN r.status = 'approved' THEN 1 END)::int AS "approvedCount",
      COUNT(CASE WHEN r.status = 'rejected' THEN 1 END)::int AS "rejectedCount",
      COUNT(CASE WHEN r.status = 'changes_requested' THEN 1 END)::int AS "changesRequestedCount",
      COUNT(CASE WHEN r.status IN ('approved', 'rejected', 'changes_requested') THEN 1 END)::int AS "completedReviews",
      COALESCE(ROUND(AVG(CASE WHEN r.status IN ('approved', 'rejected', 'changes_requested') THEN EXTRACT(EPOCH FROM (r.updated_at - r.created_at)) / 3600.0 END)::numeric, 1), 0.0) AS "avgTurnaroundHours"
    FROM users u
    JOIN problem_reviews r ON u.id = r.reviewer_id
    WHERE u.role IN ('professor', 'contest_admin', 'super_admin')
    GROUP BY u.id, u.username, u.full_name, u.role
    ORDER BY "completedReviews" DESC, "activeWorkload" DESC;
  `;

  const res = await (client || db).query(queryText);
  return res.rows;
}

module.exports = {
  calculateMedian,
  calculateSlaStatus,
  getReviewAnalytics,
  getReviewerPerformanceAnalytics,
};
