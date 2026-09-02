const GlobalRankingService = require('../services/globalRankingService');
const AuditLogger = require('../services/auditLogger');

/**
 * Leaderboard Controller - Exposes endpoints for Global & College Standings (Phase 5.6)
 */
const leaderboardController = {
  /**
   * Get Global or College Leaderboard
   * @route GET /api/leaderboard
   * @route GET /api/leaderboard/global
   * @route GET /api/leaderboard/college
   */
  async getLeaderboard(req, res, next) {
    try {
      const {
        scope = 'global',
        institution = '',
        status = 'all',
        tier = 'all',
        search = '',
        page = 1,
        limit = 50,
      } = req.query;

      const requestingUserId = req.user ? req.user.id : null;

      const data = await GlobalRankingService.getLeaderboard({
        scope,
        institution,
        status,
        tier,
        search,
        page: parseInt(page, 10) || 1,
        limit: Math.max(1, Math.min(parseInt(limit, 10) || 50, 100)),
        requestingUserId,
      });

      return res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get Platform Rating Statistics & Distribution
   * @route GET /api/leaderboard/stats
   */
  async getStatistics(req, res, next) {
    try {
      const stats = await GlobalRankingService.getPlatformStatistics();
      return res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a Leaderboard Snapshot (Admin / Professor / System)
   * @route POST /api/leaderboard/snapshots
   */
  async createSnapshot(req, res, next) {
    try {
      const { scope = 'global', institution = '' } = req.body;
      const snapshot = await GlobalRankingService.createLeaderboardSnapshot({
        scope,
        institution,
      }, req.user, req);

      return res.status(201).json(snapshot);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Fetch Leaderboard Snapshots
   * @route GET /api/leaderboard/snapshots
   */
  async getSnapshots(req, res, next) {
    try {
      const { scope = 'global', institution = '', date = null, limit = 50 } = req.query;
      const snapshots = await GlobalRankingService.getSnapshots({
        scope,
        institution,
        date,
        limit: parseInt(limit, 10) || 50,
      });
      return res.status(200).json({ snapshots });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = leaderboardController;
