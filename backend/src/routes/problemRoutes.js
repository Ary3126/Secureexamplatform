const express = require('express');
const router = express.Router();
const problemController = require('../controllers/problemController');
const validationConfigController = require('../controllers/validationConfigController');
const problemReviewController = require('../controllers/problemReviewController');
const problemQualityController = require('../controllers/problemQualityController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { validateCreateProblem, validateUpdateProblem } = require('../middleware/contestValidation');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Medium protection rate limiter for problem queries
router.use(mediumProtectionRateLimiter);

/**
 * @route GET /api/problems
 * List all problems with search, filtering, sorting, and server-side pagination (Public / Protected)
 */
router.get('/', optionalAuthenticate, problemController.getAllProblems);

/**
 * @route GET /api/problems/saved
 * List user's saved/bookmarked problems (Protected)
 */
router.get('/saved', authenticate, problemController.getSavedProblems);

/**
 * @route GET /api/problems/:id
 * Get problem details by ID (Public / Protected with BOLA authorization)
 */
router.get('/:id', optionalAuthenticate, problemController.getProblemById);

/**
 * @route POST /api/problems
 * Create problem (allowed for professor, contest_admin, super_admin)
 */
router.post(
  '/',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateCreateProblem,
  problemController.createProblem
);

/**
 * @route POST /api/problems/:id/bookmark
 * @route POST /api/problems/:id/save
 * Bookmark / Save problem
 */
router.post('/:id/bookmark', authenticate, problemController.bookmarkProblem);
router.post('/:id/save', authenticate, problemController.bookmarkProblem);

/**
 * @route DELETE /api/problems/:id/bookmark
 * @route DELETE /api/problems/:id/save
 * Remove bookmark from problem
 */
router.delete('/:id/bookmark', authenticate, problemController.unbookmarkProblem);
router.delete('/:id/save', authenticate, problemController.unbookmarkProblem);

/**
 * @route PUT /api/problems/:id
 * Update problem details (ownership protected)
 */
router.put(
  '/:id',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateUpdateProblem,
  problemController.updateProblem
);

/**
 * @route POST /api/problems/:id/publish
 * Publish problem with validation gate (ownership protected)
 */
router.post(
  '/:id/publish',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.publishProblem
);

/**
 * @route GET /api/problems/:id/preview
 * Preview problem as student sees it (strictly excludes hidden tests)
 */
router.get(
  '/:id/preview',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.previewProblem
);

/**
 * @route POST /api/problems/:id/clone
 * Clone problem into a new independent draft (ownership protected)
 */
router.post(
  '/:id/clone',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.cloneProblem
);

const problemLifecycleController = require('../controllers/problemLifecycleController');

// ============================================================
// PHASE 5.9.8 PROBLEM LIFECYCLE, ROLLBACK & OPERATIONS ROUTES
// ============================================================

/**
 * @route GET /api/problems/:id/versions/compare
 * Compare two problem version snapshots
 */
router.get(
  '/:id/versions/compare',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.compareVersions
);

/**
 * @route GET /api/problems/:id/versions
 * List all immutable version snapshots for a problem
 */
router.get(
  '/:id/versions',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.getProblemVersions
);

/**
 * @route GET /api/problems/:id/versions/:versionNumber
 * Get details of a specific problem version snapshot
 */
router.get(
  '/:id/versions/:versionNumber',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.getProblemVersionDetail
);

/**
 * @route POST /api/problems/:id/versions/:v/rollback
 * Rollback / Restore problem to a previous version
 */
router.post(
  '/:id/versions/:v/rollback',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.rollbackVersion
);

/**
 * @route POST /api/problems/:id/unpublish
 * Unpublish / Withdraw problem from public problem bank
 */
router.post(
  '/:id/unpublish',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.unpublishProblem
);

router.post(
  '/:id/withdraw',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.unpublishProblem
);

/**
 * @route POST /api/problems/:id/archive
 * Archive problem
 */
router.post(
  '/:id/archive',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.archiveProblem
);

/**
 * @route POST /api/problems/:id/restore-archive
 * Restore archived problem back to draft
 */
router.post(
  '/:id/restore-archive',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.restoreArchivedProblem
);

/**
 * @route POST /api/problems/:id/schedule-publish
 * Schedule future publication for approved problem
 */
router.post(
  '/:id/schedule-publish',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.schedulePublication
);

/**
 * @route DELETE /api/problems/:id/schedule-publish
 * Cancel scheduled publication
 */
router.delete(
  '/:id/schedule-publish',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.cancelScheduledPublication
);

/**
 * @route POST /api/problems/:id/execute-publish
 * Execute scheduled publication
 */
router.post(
  '/:id/execute-publish',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.executeScheduledPublication
);

/**
 * @route GET /api/problems/:id/dependencies
 * Get problem usage dependencies and impact analysis
 */
router.get(
  '/:id/dependencies',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.getProblemDependencies
);

router.get(
  '/:id/impact-analysis',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemLifecycleController.getProblemDependencies
);

// ============================================================
// PHASE 5.9.6 PROBLEM REVIEW & APPROVAL GOVERNANCE ROUTES
// ============================================================

/**
 * @route POST /api/problems/:id/review-request
 * Submit problem for peer review
 */
router.post(
  '/:id/review-request',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.requestReview
);

/**
 * @route POST /api/problems/:id/review/start
 * Start review session on a submitted problem
 */
router.post(
  '/:id/review/start',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.startReview
);

/**
 * @route POST /api/problems/:id/review/request-changes
 * Request changes on a problem under review
 */
router.post(
  '/:id/review/request-changes',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.requestChanges
);

/**
 * @route POST /api/problems/:id/review/reject
 * Reject a problem under review
 */
router.post(
  '/:id/review/reject',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.rejectReview
);

/**
 * @route POST /api/problems/:id/review/approve
 * Approve problem for publication (enforces self-approval defense & version-binding)
 */
router.post(
  '/:id/review/approve',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.approveReview
);

/**
 * @route POST /api/problems/:id/review/resubmit
 * Resubmit problem after requested changes
 */
router.post(
  '/:id/review/resubmit',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.resubmitReview
);

/**
 * @route GET /api/problems/:id/reviews
 * Get all review history for a problem
 */
router.get(
  '/:id/reviews',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.getProblemReviews
);

/**
 * @route GET /api/problems/:id/reviews/:reviewId
 * Get specific review detail with dialogue comments
 */
router.get(
  '/:id/reviews/:reviewId',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.getReviewDetail
);

/**
 * @route POST /api/problems/:id/reviews/:reviewId/comments
 * Add persistent comment/dialogue to a review
 */
router.post(
  '/:id/reviews/:reviewId/comments',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.addReviewComment
);

/**
 * @route GET /api/problems/:id/reviews/:reviewId/diff
 * Compare submitted version vs current problem draft
 */
router.get(
  '/:id/reviews/:reviewId/diff',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemReviewController.getReviewVersionDiff
);

// ============================================================
// PHASE 5.9.7 PROBLEM QUALITY & EDITORIAL INTELLIGENCE ROUTES
// ============================================================

/**
 * @route GET /api/problems/:id/quality
 * Evaluate problem quality score and category breakdown
 */
router.get(
  '/:id/quality',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemQualityController.getProblemQuality
);

/**
 * @route GET /api/problems/:id/editorial-checklist
 * Get structured 12-item editorial checklist
 */
router.get(
  '/:id/editorial-checklist',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemQualityController.getEditorialChecklist
);

/**
 * @route GET /api/problems/:id/similarity
 * Run duplicate / similarity detection against accessible problem bank
 */
router.get(
  '/:id/similarity',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemQualityController.getProblemSimilarity
);

/**
 * @route GET /api/problems/:id/review-analytics
 * Get review turnaround, rates, and SLA metrics for a problem
 */
router.get(
  '/:id/review-analytics',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemQualityController.getProblemReviewAnalytics
);

/**
 * @route DELETE /api/problems/:id
 * Delete problem (ownership protected)
 */
router.delete(
  '/:id',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  problemController.deleteProblem
);

// ==========================================
// PHASE 4B.1 VALIDATION CONFIGURATION ROUTES
// ==========================================

/**
 * @route GET /api/problems/:problemId/validation-config
 * Get validation configuration for a problem
 */
router.get(
  '/:problemId/validation-config',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validationConfigController.getValidationConfig
);

/**
 * @route POST /api/problems/:problemId/validation-config
 * @route PUT  /api/problems/:problemId/validation-config
 * Create / Update validation configuration for a problem
 */
router.post(
  '/:problemId/validation-config',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validationConfigController.saveValidationConfig
);

router.put(
  '/:problemId/validation-config',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validationConfigController.saveValidationConfig
);

/**
 * @route DELETE /api/problems/:problemId/validation-config
 * Reset validation configuration for a problem
 */
router.delete(
  '/:problemId/validation-config',
  authenticate,
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validationConfigController.deleteValidationConfig
);

module.exports = router;
