const express = require('express');
const router = express.Router();
const contestController = require('../controllers/contestController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const {
  validateCreateContest,
  validateUpdateContest,
  validateAddProblemToContest,
  validateBulkAddContestProblems,
  validateRemoveProblemFromContest,
  validateReorderContestProblems,
  validateBulkAddParticipants,
  validateBulkRemoveParticipants,
} = require('../middleware/contestValidation');
const {
  contestActionRateLimiter,
  mediumProtectionRateLimiter,
} = require('../middleware/rateLimitMiddleware');

/**
 * @route GET /api/contests/:id/leaderboard
 * Public/authenticated live leaderboard and problem-by-problem standings
 */
router.get('/:id/leaderboard', optionalAuthenticate, mediumProtectionRateLimiter, contestController.getContestLeaderboard);

/**
 * @route GET /api/contests/:id/results
 * Public/authenticated authoritative contest results view
 */
router.get('/:id/results', optionalAuthenticate, mediumProtectionRateLimiter, contestController.getContestResults);

/**
 * @route GET /api/contests
 * List available contests with optional state filtering (Public / Protected)
 */
router.get('/', optionalAuthenticate, mediumProtectionRateLimiter, contestController.getAllContests);

/**
 * @route GET /api/contests/:id
 * Get contest details with attached problems and points (Public / Protected)
 */
router.get('/:id', optionalAuthenticate, mediumProtectionRateLimiter, contestController.getContestById);

// Remaining contest management routes require strict authentication
router.use(authenticate);

/**
 * @route POST /api/contests
 * Create a new contest in draft mode (professor, contest_admin, super_admin)
 */
router.post(
  '/',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateCreateContest,
  contestController.createContest
);

/**
 * @route PUT /api/contests/:id
 * Update contest metadata (ownership protected)
 */
router.put(
  '/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateUpdateContest,
  contestController.updateContest
);

/**
 * @route PATCH /api/contests/:id
 * Update contest metadata (ownership protected)
 */
router.patch(
  '/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateUpdateContest,
  contestController.updateContest
);

/**
 * @route DELETE /api/contests/:id
 * Delete a contest (ownership protected)
 */
router.delete(
  '/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.deleteContest
);

/**
 * @route POST /api/contests/:id/publish
 * Publish a draft contest (validates problems and dates)
 */
router.post(
  '/:id/publish',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.publishContest
);

/**
 * @route POST /api/contests/:id/unpublish
 * Unpublish an upcoming contest back to draft
 */
router.post(
  '/:id/unpublish',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.unpublishContest
);

/**
 * @route POST /api/contests/:id/archive
 * Archive a contest (preserves all data, marks immutable)
 */
router.post(
  '/:id/archive',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.archiveContest
);

/**
 * @route GET /api/contests/:id/problems
 * List contest problems (restricted to authorized managers)
 */
router.get(
  '/:id/problems',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  mediumProtectionRateLimiter,
  contestController.getContestProblems
);

/**
 * @route POST /api/contests/:id/problems
 * Assign a problem to a contest
 */
router.post(
  '/:id/problems',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateAddProblemToContest,
  contestController.addProblemToContest
);

/**
 * @route POST /api/contests/:id/problems/bulk
 * @route PUT /api/contests/:id/problems
 * Bulk assign/replace problems in a contest
 */
router.post(
  '/:id/problems/bulk',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateBulkAddContestProblems,
  contestController.bulkAddProblemsToContest
);
router.put(
  '/:id/problems',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.bulkAddProblemsToContest
);

/**
 * @route PUT /api/contests/:contestId/problems/order
 * @route PUT /api/contests/:id/problems/order
 * @route PATCH /api/contests/:contestId/problems/order
 * @route PATCH /api/contests/:id/problems/order
 * Reorder problems in a contest
 */
router.put(
  '/:contestId/problems/order',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateReorderContestProblems,
  contestController.reorderContestProblems
);
router.put(
  '/:id/problems/order',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateReorderContestProblems,
  contestController.reorderContestProblems
);
router.patch(
  '/:contestId/problems/order',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateReorderContestProblems,
  contestController.reorderContestProblems
);
router.patch(
  '/:id/problems/order',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateReorderContestProblems,
  contestController.reorderContestProblems
);

/**
 * @route DELETE /api/contests/:id/problems
 * Bulk remove/clear problems from a contest
 */
router.delete(
  '/:id/problems',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.bulkRemoveProblemsFromContest
);

/**
 * @route DELETE /api/contests/:contestId/problems/:problemId
 * Remove a problem from a contest
 */
router.delete(
  '/:contestId/problems/:problemId',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateRemoveProblemFromContest,
  contestController.removeProblemFromContest
);

/**
 * @route GET /api/contests/:id/enrollment
 * Check current user enrollment status in a contest (Authenticated)
 */
router.get('/:id/enrollment', mediumProtectionRateLimiter, contestController.getMyEnrollmentStatus);

/**
 * @route GET /api/contests/:id/eligibility
 * Check current user contest eligibility and access evaluation (Authenticated)
 */
router.get('/:id/eligibility', mediumProtectionRateLimiter, contestController.getContestEligibility);

/**
 * @route POST /api/contests/:id/join
 * Join / Enroll in a published contest (Students only)
 */
router.post('/:id/join', contestActionRateLimiter, contestController.joinContest);

/**
 * @route GET /api/contests/:id/participants
 * List contest participants (restricted to managers)
 */
router.get(
  '/:id/participants',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  mediumProtectionRateLimiter,
  contestController.getContestParticipants
);

/**
 * @route GET /api/contests/:id/admin-leaderboard
 * Dedicated Admin Leaderboard with freeze override, participant inspection, sorting, and manager RBAC
 */
router.get(
  '/:id/admin-leaderboard',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  mediumProtectionRateLimiter,
  contestController.getContestAdminLeaderboard
);

/**
 * @route GET /api/contests/:id/results/me
 * Get current student's own contest result details
 */
router.get(
  '/:id/results/me',
  mediumProtectionRateLimiter,
  contestController.getMyContestResultDetails
);

/**
 * @route GET /api/contests/:id/participants/:userId/results
 * Get participant contest result details (authorized for student self or contest managers)
 */
router.get(
  '/:id/participants/:userId/results',
  mediumProtectionRateLimiter,
  contestController.getContestParticipantResultDetails
);

/**
 * @route GET /api/contests/:id/search-students
 * Search available students eligible to be added to this contest
 */
router.get(
  '/:id/search-students',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  mediumProtectionRateLimiter,
  contestController.searchContestCandidateStudents
);

/**
 * @route POST /api/contests/:id/participants
 * Manually add a participant to a contest (Manager only)
 */
router.post(
  '/:id/participants',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.addContestParticipant
);

/**
 * @route POST /api/contests/:id/participants/bulk
 * Bulk add participants to a contest (Manager only)
 */
router.post(
  '/:id/participants/bulk',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateBulkAddParticipants,
  contestController.bulkAddContestParticipants
);

/**
 * @route DELETE /api/contests/:id/participants/bulk
 * @route DELETE /api/contests/:id/participants
 * @route POST /api/contests/:id/participants/bulk-remove
 * Bulk remove participants from a contest (Manager only)
 */
router.delete(
  '/:id/participants/bulk',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateBulkRemoveParticipants,
  contestController.bulkRemoveContestParticipants
);
router.delete(
  '/:id/participants',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateBulkRemoveParticipants,
  contestController.bulkRemoveContestParticipants
);
router.post(
  '/:id/participants/bulk-remove',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  validateBulkRemoveParticipants,
  contestController.bulkRemoveContestParticipants
);

/**
 * @route DELETE /api/contests/:id/participants/:userId
 * Manually remove a participant from a contest (Manager only)
 */
router.delete(
  '/:id/participants/:userId',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.removeContestParticipant
);

/**
 * @route POST /api/contests/:id/finalize-ratings
 * @route POST /api/contests/:id/finalize
 * Finalize contest results and calculate ratings (restricted to contest managers/admins)
 */
router.post(
  '/:id/finalize-ratings',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.finalizeContestRatings
);

router.post(
  '/:id/finalize',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.finalizeContestRatings
);

module.exports = router;
