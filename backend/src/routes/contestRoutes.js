const express = require('express');
const router = express.Router();
const contestController = require('../controllers/contestController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const {
  validateCreateContest,
  validateUpdateContest,
  validateAddProblemToContest,
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
  contestController.bulkAddProblemsToContest
);
router.put(
  '/:id/problems',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.bulkAddProblemsToContest
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
  contestController.removeProblemFromContest
);

/**
 * @route POST /api/contests/:id/join
 * Join a published contest (all authenticated users)
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
 * @route POST /api/contests/:id/finalize-ratings
 * Finalize contest ratings (restricted to contest managers/admins)
 */
router.post(
  '/:id/finalize-ratings',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  contestActionRateLimiter,
  contestController.finalizeContestRatings
);

module.exports = router;
