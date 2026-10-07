const ProblemModel = require('../models/problemModel');
const TestCaseModel = require('../models/testCaseModel');
const ProblemQualityModel = require('../models/problemQualityModel');
const { evaluateProblemQuality, findProblemSimilarities } = require('../services/problemQualityService');
const { getReviewAnalytics, getReviewerPerformanceAnalytics } = require('../services/reviewAnalyticsService');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * Check if user is authorized to inspect problem quality / editorial data
 */
function canAccessProblemQuality(user, problem) {
  if (!user || !problem) return false;
  if (user.role === 'super_admin') return true;
  const authorId = problem.created_by || problem.createdBy;
  if (user.id === authorId) return true;
  if (user.role === 'professor' || user.role === 'contest_admin') return true;
  return false;
}

/**
 * Evaluate Problem Quality & Retrieve Breakdown
 * @route GET /api/problems/:id/quality
 */
const getProblemQuality = async (req, res, next) => {
  try {
    const problemId = Number(req.params.id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(req.params.id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemQuality(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_QUALITY_EVALUATED' },
        req,
      });
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to view problem quality analytics' });
    }

    // Fetch test cases for problem (including hidden test cases for coverage calculations)
    const testCases = await TestCaseModel.findTestCasesByProblemId(problemId, { includeHidden: true });

    // Fetch validation config if any
    const validationConfig = await ProblemModel.findValidationConfigByProblemId ? await ProblemModel.findValidationConfigByProblemId(problemId) : null;

    // Fetch existing accessible problems for similarity calculation
    const existingProblems = await ProblemModel.findAllProblems({ userRole: req.user.role, userId: req.user.id, limit: 100 });
    const similarityResult = findProblemSimilarities(problem, existingProblems);

    // Evaluate Quality
    const qualityEvaluation = evaluateProblemQuality(problem, testCases, validationConfig, similarityResult.highestSimilarityScore / 100);

    // Persist quality snapshot for the current version
    await ProblemQualityModel.saveQualitySnapshot({
      problemId,
      problemVersion: problem.version || 1,
      qualityScore: qualityEvaluation.qualityScore,
      qualityLevel: qualityEvaluation.qualityLevel,
      breakdown: qualityEvaluation.breakdown,
      checklist: qualityEvaluation.checklist,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_QUALITY_EVALUATED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: {
        problemVersion: problem.version || 1,
        qualityScore: qualityEvaluation.qualityScore,
        qualityLevel: qualityEvaluation.qualityLevel,
      },
      req,
    });

    return res.status(200).json({
      status: 'success',
      problemId,
      version: problem.version || 1,
      qualityScore: qualityEvaluation.qualityScore,
      qualityLevel: qualityEvaluation.qualityLevel,
      breakdown: qualityEvaluation.breakdown,
      summary: qualityEvaluation.summary,
      similarity: similarityResult,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Structured 12-Item Editorial Checklist
 * @route GET /api/problems/:id/editorial-checklist
 */
const getEditorialChecklist = async (req, res, next) => {
  try {
    const problemId = Number(req.params.id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(req.params.id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemQuality(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const testCases = await TestCaseModel.findTestCasesByProblemId(problemId, { includeHidden: true });
    const existingProblems = await ProblemModel.findAllProblems({ userRole: req.user.role, userId: req.user.id, limit: 100 });
    const similarityResult = findProblemSimilarities(problem, existingProblems);

    const qualityEvaluation = evaluateProblemQuality(problem, testCases, null, similarityResult.highestSimilarityScore / 100);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'EDITORIAL_CHECKLIST_EVALUATED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { problemVersion: problem.version || 1 },
      req,
    });

    return res.status(200).json({
      status: 'success',
      problemId,
      version: problem.version || 1,
      qualityScore: qualityEvaluation.qualityScore,
      qualityLevel: qualityEvaluation.qualityLevel,
      checklist: qualityEvaluation.checklist,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Duplicate / Similarity Assessment
 * @route GET /api/problems/:id/similarity
 */
const getProblemSimilarity = async (req, res, next) => {
  try {
    const problemId = Number(req.params.id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(req.params.id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemQuality(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const existingProblems = await ProblemModel.findAllProblems({ userRole: req.user.role, userId: req.user.id, limit: 100 });
    const similarityResult = findProblemSimilarities(problem, existingProblems);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_SIMILARITY_CHECKED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: {
        problemVersion: problem.version || 1,
        highestSimilarityScore: similarityResult.highestSimilarityScore,
        similarityLevel: similarityResult.similarityLevel,
      },
      req,
    });

    return res.status(200).json({
      status: 'success',
      problemId,
      version: problem.version || 1,
      ...similarityResult,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Review Analytics for a specific problem
 * @route GET /api/problems/:id/review-analytics
 */
const getProblemReviewAnalytics = async (req, res, next) => {
  try {
    const problemId = Number(req.params.id);
    if (!Number.isInteger(problemId) || problemId <= 0 || !/^\d+$/.test(String(req.params.id).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemQuality(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const analytics = await getReviewAnalytics({ problemId });

    return res.status(200).json({
      status: 'success',
      problemId,
      analytics,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Platform-Wide Review Analytics (Super Admin)
 * @route GET /api/admin/problem-review-analytics
 */
const getPlatformReviewAnalytics = async (req, res, next) => {
  try {
    const analytics = await getReviewAnalytics({});

    await AuditLogger.logAction({
      actor: req.user,
      action: 'REVIEW_ANALYTICS_ACCESSED',
      resourceType: 'system',
      outcome: 'success',
      req,
    });

    return res.status(200).json({
      status: 'success',
      analytics,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reviewer Workload & Turnaround Analytics (Super Admin)
 * @route GET /api/admin/reviewer-analytics
 */
const getReviewerAnalytics = async (req, res, next) => {
  try {
    const reviewerMetrics = await getReviewerPerformanceAnalytics();

    await AuditLogger.logAction({
      actor: req.user,
      action: 'REVIEWER_ANALYTICS_ACCESSED',
      resourceType: 'system',
      outcome: 'success',
      req,
    });

    return res.status(200).json({
      status: 'success',
      count: reviewerMetrics.length,
      reviewers: reviewerMetrics,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProblemQuality,
  getEditorialChecklist,
  getProblemSimilarity,
  getProblemReviewAnalytics,
  getPlatformReviewAnalytics,
  getReviewerAnalytics,
};
