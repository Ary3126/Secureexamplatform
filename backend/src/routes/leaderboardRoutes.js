const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Apply medium protection rate limiter to all leaderboard queries
router.use(mediumProtectionRateLimiter);

/**
 * @route GET /api/leaderboard
 * @route GET /api/leaderboard/global
 * @route GET /api/leaderboard/college
 * Public / Protected: Fetch platform-wide or college-scoped standings with filters & pagination
 */
router.get('/', optionalAuthenticate, leaderboardController.getLeaderboard);
router.get('/global', optionalAuthenticate, leaderboardController.getLeaderboard);
router.get('/college', optionalAuthenticate, leaderboardController.getLeaderboard);

/**
 * @route GET /api/leaderboard/stats
 * Public: Fetch platform rating statistics and distribution histogram
 */
router.get('/stats', leaderboardController.getStatistics);

/**
 * @route POST /api/leaderboard/snapshots
 * Protected (Admin/Professor): Create a historical leaderboard snapshot
 */
router.post(
  '/snapshots',
  authenticate,
  authorizeRoles('professor', 'super_admin'),
  leaderboardController.createSnapshot
);

/**
 * @route GET /api/leaderboard/snapshots
 * Public / Protected: Fetch historical snapshot records
 */
router.get('/snapshots', optionalAuthenticate, leaderboardController.getSnapshots);

module.exports = router;
