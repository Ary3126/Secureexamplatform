const db = require('../config/db');
const ProblemModel = require('../models/problemModel');
const ProblemReviewModel = require('../models/problemReviewModel');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * ProblemReviewController - Phase 5.9.6 Secure Problem Review, Approval & Publication Governance
 */

/**
 * Helper: Check if user is problem owner
 */
function isProblemAuthor(user, problem) {
  if (!user || !problem) return false;
  const authorId = problem.created_by || problem.createdBy || problem.problemAuthorId;
  return user.id === authorId;
}

/**
 * Helper: Check if user can view review
 */
function canViewReview(user, problem, review) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (isProblemAuthor(user, problem)) return true;
  if (review && review.reviewerId === user.id) return true;
  if (user.role === 'professor' || user.role === 'contest_admin') return true;
  return false;
}

/**
 * Submit problem for review
 * @route POST /api/problems/:id/review-request
 */
const requestReview = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // Authorization: Owner or Super Admin
    if (!canManageResource(req.user, problem)) {
      await client.query('ROLLBACK');
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_REVIEW_REQUESTED' },
        req,
      });
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You can only submit your own problems for review' });
    }

    if (problem.is_published && problem.review_status === 'published') {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Problem is already published. Edit to create a new draft before requesting review.' });
    }

    // Revoke any previous pending/in-review requests
    await client.query(
      `UPDATE problem_reviews SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE problem_id = $1 AND status IN ('pending', 'in_review')`,
      [problemId]
    );

    // Update problem review_status to review_requested
    const currentVersion = parseInt(problem.version, 10) || 1;
    await client.query(
      `UPDATE problems 
       SET review_status = 'review_requested', approved_version = NULL, approved_by = NULL, approved_at = NULL, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [problemId]
    );

    // Create new review record
    const review = await ProblemReviewModel.createReviewRequest({
      problemId,
      problemVersion: currentVersion,
      submittedBy: req.user.id,
    }, client);

    if (req.body?.comment && typeof req.body.comment === 'string' && req.body.comment.trim()) {
      await ProblemReviewModel.addComment({
        reviewId: review.id,
        authorId: req.user.id,
        commentType: 'general',
        comment: req.body.comment.trim(),
      }, client);
    }

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_REVIEW_REQUESTED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { problemVersion: currentVersion, reviewId: review.id },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(201).json({
      status: 'success',
      message: `Problem #${problemId} (v${currentVersion}) submitted for peer review`,
      review,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Start reviewing a problem
 * @route POST /api/problems/:id/review/start
 */
const startReview = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // Self-review protection: Author cannot be reviewer
    if (isProblemAuthor(req.user, problem)) {
      await client.query('ROLLBACK');
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_REVIEW_STARTED', reason: 'self_review_prohibited' },
        req,
      });
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: Authors cannot review or approve their own problems' });
    }

    const activeReview = await ProblemReviewModel.findActiveReviewForProblem(problemId, client);
    if (!activeReview) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'No pending review request found for this problem' });
    }

    // Update review and problem status
    const updatedReview = await ProblemReviewModel.startReview(activeReview.id, req.user.id, client);
    await client.query(
      `UPDATE problems SET review_status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_REVIEW_STARTED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { reviewId: activeReview.id, problemVersion: activeReview.problemVersion },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'success',
      message: 'Review session started',
      review: updatedReview || activeReview,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Request changes on a problem
 * @route POST /api/problems/:id/review/request-changes
 */
const requestChanges = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    const comment = req.body.comment || req.body.note || req.body.decisionReason;

    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Change request feedback comment is required' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // Self-action protection
    if (isProblemAuthor(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: Authors cannot request changes on their own review' });
    }

    const activeReview = await ProblemReviewModel.findActiveReviewForProblem(problemId, client);
    if (!activeReview) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'No active review found to request changes on' });
    }

    const updatedReview = await ProblemReviewModel.recordDecision(activeReview.id, req.user.id, 'changes_requested', comment.trim(), client);
    await ProblemReviewModel.addComment({
      reviewId: activeReview.id,
      authorId: req.user.id,
      commentType: 'change_request',
      comment: comment.trim(),
    }, client);

    await client.query(
      `UPDATE problems SET review_status = 'changes_requested', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_CHANGES_REQUESTED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { reviewId: activeReview.id, problemVersion: activeReview.problemVersion },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'success',
      message: 'Changes requested successfully',
      review: updatedReview,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Reject a problem review
 * @route POST /api/problems/:id/review/reject
 */
const rejectReview = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    const reason = req.body.reason || req.body.comment || req.body.note;

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Rejection reason is required' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // Self-action protection
    if (isProblemAuthor(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: Authors cannot reject their own problem' });
    }

    const activeReview = await ProblemReviewModel.findActiveReviewForProblem(problemId, client);
    if (!activeReview) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'No active review found to reject' });
    }

    const updatedReview = await ProblemReviewModel.recordDecision(activeReview.id, req.user.id, 'rejected', reason.trim(), client);
    await ProblemReviewModel.addComment({
      reviewId: activeReview.id,
      authorId: req.user.id,
      commentType: 'rejection_reason',
      comment: reason.trim(),
    }, client);

    await client.query(
      `UPDATE problems SET review_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_REJECTED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { reviewId: activeReview.id, problemVersion: activeReview.problemVersion },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'success',
      message: 'Problem review marked as rejected',
      review: updatedReview,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Approve a problem review (Enforces Self-Approval Defense & Version-Bound Verification)
 * @route POST /api/problems/:id/review/approve
 */
const approveReview = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    const { note } = req.body || {};

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // 1. Self-Approval Protection
    if (isProblemAuthor(req.user, problem)) {
      await client.query('ROLLBACK');
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_APPROVED', reason: 'self_approval_prohibited' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Authors are strictly prohibited from approving their own problems',
      });
    }

    const activeReview = await ProblemReviewModel.findActiveReviewForProblem(problemId, client);
    if (!activeReview) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'No active review found to approve' });
    }

    // 2. Version-Bound Review Verification
    const currentVersion = parseInt(problem.version, 10) || 1;
    const reviewVersion = parseInt(activeReview.problemVersion, 10);
    if (currentVersion !== reviewVersion) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: `Conflict: Review of version ${reviewVersion} is stale. Problem was modified to version ${currentVersion}.`,
        currentVersion,
        reviewVersion,
      });
    }

    // 3. Record Approval Decision
    const updatedReview = await ProblemReviewModel.recordDecision(activeReview.id, req.user.id, 'approved', note ? note.trim() : 'Approved for publication', client);

    if (note && typeof note === 'string' && note.trim()) {
      await ProblemReviewModel.addComment({
        reviewId: activeReview.id,
        authorId: req.user.id,
        commentType: 'approval_note',
        comment: note.trim(),
      }, client);
    }

    // 4. Update problem review_status and approved_version
    await client.query(
      `UPDATE problems 
       SET review_status = 'approved', approved_version = $2, approved_by = $3, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [problemId, currentVersion, req.user.id]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_APPROVED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { reviewId: activeReview.id, problemVersion: currentVersion, reviewerId: req.user.id },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} (v${currentVersion}) approved for publication`,
      review: updatedReview,
      approvedVersion: currentVersion,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Resubmit problem after requested changes / rejection
 * @route POST /api/problems/:id/review/resubmit
 */
const resubmitReview = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    const { comment } = req.body || {};

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    // Authorization: Owner or Super Admin
    if (!canManageResource(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You can only resubmit your own problems' });
    }

    const currentVersion = parseInt(problem.version, 10) || 1;

    // Revoke previous active reviews
    await client.query(
      `UPDATE problem_reviews SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE problem_id = $1 AND status IN ('pending', 'in_review', 'changes_requested')`,
      [problemId]
    );

    // Update problem review_status to review_requested
    await client.query(
      `UPDATE problems 
       SET review_status = 'review_requested', approved_version = NULL, approved_by = NULL, approved_at = NULL, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [problemId]
    );

    const review = await ProblemReviewModel.createReviewRequest({
      problemId,
      problemVersion: currentVersion,
      submittedBy: req.user.id,
    }, client);

    if (comment && typeof comment === 'string' && comment.trim()) {
      await ProblemReviewModel.addComment({
        reviewId: review.id,
        authorId: req.user.id,
        commentType: 'author_response',
        comment: comment.trim(),
      }, client);
    }

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_RESUBMITTED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { reviewId: review.id, problemVersion: currentVersion },
      client,
      req,
    });

    await client.query('COMMIT');
    return res.status(201).json({
      status: 'success',
      message: `Problem #${problemId} (v${currentVersion}) resubmitted for review`,
      review,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Get all reviews for a problem
 * @route GET /api/problems/:id/reviews
 */
const getProblemReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    const problemId = Number(id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canViewReview(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to view reviews for this problem' });
    }

    const reviews = await ProblemReviewModel.findReviewsByProblemId(problemId);
    return res.status(200).json({
      status: 'success',
      count: reviews.length,
      reviews,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get review detail by reviewId
 * @route GET /api/problems/:id/reviews/:reviewId
 * @route GET /api/admin/problem-reviews/:reviewId
 */
const getReviewDetail = async (req, res, next) => {
  try {
    const rawReviewId = req.params.reviewId || req.params.id;
    const reviewId = Number(rawReviewId);
    if (!Number.isInteger(reviewId) || reviewId <= 0 || !/^\d+$/.test(String(rawReviewId).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid review ID format' });
    }

    const review = await ProblemReviewModel.findReviewById(reviewId);
    if (!review) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Review #${reviewId} not found` });
    }

    if (!canViewReview(req.user, review)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to view this review' });
    }

    const comments = await ProblemReviewModel.findReviewComments(reviewId);
    return res.status(200).json({
      status: 'success',
      review: {
        ...review,
        comments,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Add a comment to a review
 * @route POST /api/problems/:id/reviews/:reviewId/comments
 */
const addReviewComment = async (req, res, next) => {
  try {
    const { id, reviewId } = req.params;
    const rId = Number(reviewId);
    if (!Number.isInteger(rId) || rId <= 0 || !/^\d+$/.test(String(reviewId).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid review ID format' });
    }
    const { comment, commentType = 'general' } = req.body;

    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Comment text is required' });
    }

    const review = await ProblemReviewModel.findReviewById(rId);
    if (!review) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Review #${rId} not found` });
    }

    if (!canViewReview(req.user, review)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to comment on this review' });
    }

    const allowedTypes = ['general', 'change_request', 'rejection_reason', 'approval_note', 'author_response'];
    const safeType = allowedTypes.includes(commentType) ? commentType : 'general';

    const newComment = await ProblemReviewModel.addComment({
      reviewId: rId,
      authorId: req.user.id,
      commentType: safeType,
      comment: comment.trim(),
    });

    return res.status(201).json({
      status: 'success',
      message: 'Comment added successfully',
      comment: newComment,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get review queue for reviewer / admin dashboard
 * @route GET /api/admin/problem-reviews
 */
const getReviewQueue = async (req, res, next) => {
  try {
    const { status, difficulty, authorId, search, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;

    const result = await ProblemReviewModel.findReviewQueue({
      status,
      difficulty,
      authorId,
      search,
      limit: parsedLimit,
      offset,
    });

    return res.status(200).json({
      status: 'success',
      count: result.reviews.length,
      total: result.total,
      page: parsedPage,
      totalPages: Math.ceil(result.total / parsedLimit) || 1,
      reviews: result.reviews,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Version difference comparison between submitted review version and current problem draft
 * @route GET /api/problems/:id/reviews/:reviewId/diff
 */
const getReviewVersionDiff = async (req, res, next) => {
  try {
    const { id, reviewId } = req.params;
    const pId = Number(id);
    const rId = Number(reviewId);
    if (!Number.isInteger(pId) || pId <= 0 || !/^\d+$/.test(String(id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    if (!Number.isInteger(rId) || rId <= 0 || !/^\d+$/.test(String(reviewId).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid review ID format' });
    }

    const problem = await ProblemModel.findProblemById(pId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${pId} not found` });
    }

    if (!canViewReview(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const review = await ProblemReviewModel.findReviewById(rId);
    if (!review) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Review #${rId} not found` });
    }

    const isStale = problem.version !== review.problemVersion;

    return res.status(200).json({
      status: 'success',
      diff: {
        problemId: pId,
        reviewId: rId,
        submittedVersion: review.problemVersion,
        currentVersion: problem.version,
        isStale,
        titleChanged: false, // current draft vs review version
        currentProblem: {
          title: problem.title,
          difficulty: problem.difficulty,
          codingMode: problem.codingMode,
          version: problem.version,
          reviewStatus: problem.reviewStatus,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requestReview,
  startReview,
  requestChanges,
  rejectReview,
  approveReview,
  resubmitReview,
  getProblemReviews,
  getReviewDetail,
  addReviewComment,
  getReviewQueue,
  getReviewVersionDiff,
};
