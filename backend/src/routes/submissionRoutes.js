const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submissionController');
const { authenticate } = require('../middleware/authMiddleware');
const { validateCreateSubmission } = require('../middleware/submissionValidation');
const {
  submitCodeRateLimiter,
  runCodeRateLimiter,
  mediumProtectionRateLimiter,
} = require('../middleware/rateLimitMiddleware');

router.use(authenticate);

/**
 * @route POST /api/submissions
 * Submit solution for official judge evaluation (protected with submitCodeRateLimiter)
 */
router.post('/', submitCodeRateLimiter, validateCreateSubmission, submissionController.submitSolution);

/**
 * @route POST /api/submissions/run
 * Run code interactively against visible sample test cases (protected with runCodeRateLimiter)
 */
router.post('/run', runCodeRateLimiter, validateCreateSubmission, submissionController.runSampleTests);

/**
 * @route GET /api/submissions/my
 * Get paginated submission history with search and filters for the authenticated user
 */
router.get('/my', mediumProtectionRateLimiter, submissionController.getMySubmissions);

/**
 * @route GET /api/submissions/analytics
 * Get student coding analytics and performance statistics
 */
router.get('/analytics', mediumProtectionRateLimiter, submissionController.getStudentAnalytics);

/**
 * @route GET /api/submissions/export
 * Export student''s own submission history as CSV
 */
router.get('/export', mediumProtectionRateLimiter, submissionController.exportSubmissionsCsv);

/**
 * @route GET /api/submissions/compare
 * Phase 5.8.5: Compare two submissions side-by-side
 */
router.get('/compare', mediumProtectionRateLimiter, submissionController.compareSubmissions);

/**
 * @route GET /api/submissions/problem/:problemId/my
 * Phase 5.8.5: Get user's recent submissions for candidate comparison picker
 */
router.get('/problem/:problemId/my', mediumProtectionRateLimiter, submissionController.getMySubmissionsForProblem);

/**
 * @route GET /api/submissions/:id/code
 * Get submitted source code securely (authorized for owner/admin only)
 */
router.get('/:id/code', mediumProtectionRateLimiter, submissionController.getSubmissionCode);

/**
 * @route GET /api/submissions/:id/performance/distribution
 * Get runtime and memory distribution histograms for a submission
 */
router.get('/:id/performance/distribution', mediumProtectionRateLimiter, submissionController.getSubmissionDistribution);

/**
 * @route GET /api/submissions/:id/performance
 * Get percentile and relative performance statistics for a submission
 */
router.get('/:id/performance', mediumProtectionRateLimiter, submissionController.getSubmissionPerformance);

/**
 * @route GET /api/submissions/:id
 * Get status and verdict of a specific submission
 */
router.get('/:id', mediumProtectionRateLimiter, submissionController.getSubmissionById);

module.exports = router;
