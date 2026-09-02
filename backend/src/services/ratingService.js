const db = require('../config/db');
const ContestModel = require('../models/contestModel');
const RatingModel = require('../models/ratingModel');
const RATING_CONFIG = require('../config/ratingConfig');
const AuditLogger = require('./auditLogger');
const { getContestRuntimeState } = require('./contestService');

/**
 * Competitive Rating Service - Multi-participant Elo rating calculation, rank determination, and transactional finalization
 */
class RatingService {
  /**
   * Deterministic Pairwise Multi-Participant Elo Rating Algorithm
   * 
   * @param {Array<Object>} participants - Array of participant standings:
   *   { userId, username, currentRating, highestRating, ratingStatus, ratedContestCount, rank, totalScore, totalTimeMs }
   * @returns {Array<Object>} List of calculated rating updates
   */
  static calculateRatingChanges(participants) {
    const N = participants.length;
    if (N === 0) return [];

    // Single participant case: no rating delta possible
    if (N === 1) {
      const p = participants[0];
      const newRatedCount = (p.ratedContestCount || 0) + 1;
      const newStatus =
        newRatedCount >= RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD ? 'rated' : 'provisional';
      return [
        {
          userId: p.userId,
          username: p.username,
          previousRating: p.currentRating,
          ratingChange: 0,
          newRating: p.currentRating,
          newHighestRating: Math.max(p.highestRating || p.currentRating, p.currentRating),
          newRatingStatus: newStatus,
          newRatedContestCount: newRatedCount,
          rank: 1,
          participantCount: 1,
          performanceRating: p.currentRating,
        },
      ];
    }

    const results = [];

    for (let i = 0; i < N; i++) {
      const p = participants[i];
      let actualScoreSum = 0;
      let expectedScoreSum = 0;

      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const opponent = participants[j];

        // 1. Expected score against opponent j: E_ij = 1 / (1 + 10^((R_j - R_i) / 400))
        const exponent = (opponent.currentRating - p.currentRating) / 400.0;
        const expectedScore = 1.0 / (1.0 + Math.pow(10.0, exponent));
        expectedScoreSum += expectedScore;

        // 2. Actual outcome based on rank: 1.0 (win), 0.5 (tie), 0.0 (loss)
        if (p.rank < opponent.rank) {
          actualScoreSum += 1.0;
        } else if (p.rank === opponent.rank) {
          actualScoreSum += 0.5;
        } else {
          actualScoreSum += 0.0;
        }
      }

      // 3. Determine K-Factor: Provisional vs Rated
      const isProvisional =
        (p.ratedContestCount || 0) < RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD;
      const kFactor = isProvisional
        ? RATING_CONFIG.PROVISIONAL_K_FACTOR
        : RATING_CONFIG.RATED_K_FACTOR;

      // 4. Normalized Delta: Delta_R = round( (K / (N - 1)) * (Actual - Expected) )
      const rawDelta = (kFactor / (N - 1)) * (actualScoreSum - expectedScoreSum);
      const ratingChange = Math.round(rawDelta);

      // 5. Calculate new rating and highest rating
      const newRating = Math.max(RATING_CONFIG.MIN_RATING, p.currentRating + ratingChange);
      const newHighestRating = Math.max(p.highestRating || p.currentRating, newRating);
      const newRatedCount = (p.ratedContestCount || 0) + 1;
      const newStatus =
        newRatedCount >= RATING_CONFIG.PROVISIONAL_CONTEST_THRESHOLD ? 'rated' : 'provisional';

      // Performance rating approximation
      const performanceRating = Math.round(p.currentRating + ((actualScoreSum - (N - 1) / 2) / (N - 1)) * 400);

      results.push({
        userId: p.userId,
        username: p.username,
        previousRating: p.currentRating,
        ratingChange,
        newRating,
        newHighestRating,
        newRatingStatus: newStatus,
        newRatedContestCount: newRatedCount,
        rank: p.rank,
        participantCount: N,
        performanceRating,
      });
    }

    return results;
  }

  /**
   * Calculate final contest standings for a contest
   */
  static async computeContestStandings(contestId, clientOrDb = null) {
    const StandingsService = require('./standingsService');
    const result = await StandingsService.computeContestStandings({
      contestId,
      limit: 10000,
      freezeOverride: true,
      clientOrDb,
    });
    return result.standings;
  }

  /**
   * Finalize ratings for a completed contest inside an ACID transaction (Idempotent)
   * 
   * @param {number|string} contestId
   * @param {Object} operatorUser - { id, role }
   * @param {Object} options - { force: boolean }
   * @returns {Promise<Object>} Finalization results
   */
  static async finalizeContestRatings(contestId, operatorUser = null, options = {}, req = null) {
    const force = Boolean(options && options.force);
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Fetch and row-lock the contest to prevent concurrent duplicate finalization
      const contestRes = await client.query(
        `SELECT * FROM contests WHERE id = $1 FOR UPDATE;`,
        [contestId]
      );

      if (!contestRes.rows[0]) {
        await client.query('ROLLBACK');
        const err = new Error(`Contest with ID ${contestId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const contest = contestRes.rows[0];

      // 2. Verify contest status and rated flag
      if (contest.status !== 'published') {
        await client.query('ROLLBACK');
        const err = new Error('Cannot finalize ratings: Contest is in draft status');
        err.statusCode = 400;
        throw err;
      }

      if (!contest.is_rated) {
        await client.query('ROLLBACK');
        const err = new Error('This contest is unrated; ratings cannot be calculated');
        err.statusCode = 400;
        throw err;
      }

      // 3. Timing Check (Contest must be ended unless force = true for administrative tests)
      const runtimeState = getContestRuntimeState(contest);
      if (runtimeState !== 'ended' && !force) {
        await client.query('ROLLBACK');
        const err = new Error(`Cannot finalize ratings while contest is '${runtimeState}'. Contest must be ended.`);
        err.statusCode = 400;
        throw err;
      }

      // 4. IDEMPOTENCY CHECK: If already finalized, return existing rating history without recalculating
      if (contest.is_rating_finalized) {
        const existingHistory = await client.query(
          `SELECT * FROM rating_history WHERE contest_id = $1 ORDER BY rank ASC;`,
          [contestId]
        );
        await client.query('COMMIT');
        return {
          alreadyFinalized: true,
          message: 'Ratings have already been calculated and applied for this contest.',
          contestId: contest.id,
          finalizedAt: contest.ratings_finalized_at,
          ratingUpdates: existingHistory.rows,
        };
      }

      // 5. Compute deterministic standings
      const standings = await this.computeContestStandings(contestId, client);

      if (standings.length === 0) {
        // Mark as finalized even if 0 participants to close contest lifecycle
        await client.query(
          `UPDATE contests SET is_rating_finalized = true, ratings_finalized_at = CURRENT_TIMESTAMP WHERE id = $1;`,
          [contestId]
        );

        if (operatorUser) {
          await AuditLogger.logAction({
            actor: operatorUser,
            action: 'RATINGS_FINALIZED',
            resourceType: 'contest',
            resourceId: contest.id,
            outcome: 'success',
            metadata: { participantCount: 0, isIdempotentSkip: false },
            client,
            req,
          });
        }

        await client.query('COMMIT');
        return {
          message: 'Contest finalized with 0 participants. No rating updates needed.',
          contestId: contest.id,
          ratingUpdates: [],
        };
      }

      // 6. Calculate pairwise Elo deltas
      const ratingUpdates = this.calculateRatingChanges(standings);

      // 7. Persist updates and rating history for each participant
      for (const update of ratingUpdates) {
        // Update user record
        await RatingModel.updateUserRating(client, update.userId, {
          currentRating: update.newRating,
          highestRating: update.newHighestRating,
          ratingStatus: update.newRatingStatus,
          ratedContestCount: update.newRatedContestCount,
        });

        // Insert rating history entry
        await RatingModel.createRatingHistoryEntry(client, {
          userId: update.userId,
          contestId: contest.id,
          previousRating: update.previousRating,
          ratingChange: update.ratingChange,
          newRating: update.newRating,
          rank: update.rank,
          participantCount: update.participantCount,
          performanceRating: update.performanceRating,
          ratingStatus: update.newRatingStatus,
        });
      }

      // 8. Mark contest as finalized
      await client.query(
        `UPDATE contests SET is_rating_finalized = true, ratings_finalized_at = CURRENT_TIMESTAMP WHERE id = $1;`,
        [contestId]
      );

      if (operatorUser) {
        await AuditLogger.logAction({
          actor: operatorUser,
          action: 'RATINGS_FINALIZED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'success',
          metadata: { participantCount: ratingUpdates.length, isIdempotentSkip: false },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      return {
        message: `Successfully calculated and applied rating updates for ${ratingUpdates.length} participants`,
        contestId: contest.id,
        finalizedAt: new Date().toISOString(),
        ratingUpdates,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = RatingService;
