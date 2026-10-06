const db = require('../config/db');
const RATING_CONFIG = require('../config/ratingConfig');

/**
 * Rating Model - Encapsulates database operations for competitive ratings and rating_history
 */
class RatingModel {
  /**
   * Insert a record into rating_history (Idempotent with ON CONFLICT DO NOTHING)
   */
  static async createRatingHistoryEntry(clientOrDb, {
    userId,
    contestId,
    previousRating,
    ratingChange,
    newRating,
    rank,
    participantCount,
    performanceRating = 1200,
    ratingStatus = 'provisional',
  }) {
    const executor = clientOrDb || db;
    const text = `
      INSERT INTO rating_history (
        user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count, performance_rating, rating_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, contest_id) DO NOTHING
      RETURNING 
        id, 
        user_id AS "userId", 
        contest_id AS "contestId", 
        previous_rating AS "previousRating", 
        rating_change AS "ratingChange", 
        new_rating AS "newRating", 
        rank, 
        participant_count AS "participantCount", 
        performance_rating AS "performanceRating", 
        rating_status AS "ratingStatus", 
        created_at AS "createdAt";
    `;
    const values = [
      userId,
      contestId,
      previousRating,
      ratingChange,
      newRating,
      rank,
      participantCount,
      performanceRating,
      ratingStatus,
    ];
    const res = await executor.query(text, values);
    return res.rows[0] || null;
  }

  /**
   * Retrieve rating history for a specific user ordered chronologically
   */
  static async getRatingHistoryByUser(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId <= 0) return [];

    const text = `
      SELECT 
        rh.id,
        rh.user_id AS "userId",
        rh.contest_id AS "contestId",
        c.title AS "contestTitle",
        rh.previous_rating AS "previousRating",
        rh.rating_change AS "ratingChange",
        rh.new_rating AS "newRating",
        rh.rank,
        rh.participant_count AS "participantCount",
        rh.performance_rating AS "performanceRating",
        rh.rating_status AS "ratingStatus",
        rh.created_at AS "createdAt"
      FROM rating_history rh
      JOIN contests c ON rh.contest_id = c.id
      WHERE rh.user_id = $1
      ORDER BY rh.created_at ASC, rh.id ASC;
    `;
    const res = await db.query(text, [numId]);
    return res.rows;
  }

  /**
   * Get rating summary for a user
   */
  static async getUserRatingSummary(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId <= 0) return null;

    const text = `
      SELECT 
        id,
        username,
        full_name AS "fullName",
        current_rating AS "currentRating",
        highest_rating AS "highestRating",
        rating_status AS "ratingStatus",
        rated_contest_count AS "ratedContestCount"
      FROM users
      WHERE id = $1;
    `;
    const res = await db.query(text, [numId]);
    return res.rows[0] || null;
  }

  /**
   * Calculate competitive global rank among students with deterministic tie-breaker
   */
  static async getGlobalRank(userId) {
    const numId = Number(userId);
    if (!Number.isInteger(numId) || numId <= 0) return null;

    const userRes = await db.query(
      `SELECT current_rating, id FROM users WHERE id = $1 AND role = 'student'`,
      [numId]
    );

    if (!userRes.rows[0]) return null;

    const { current_rating } = userRes.rows[0];

    const rankRes = await db.query(
      `
      SELECT COUNT(*)::int + 1 AS rank
      FROM users
      WHERE role = 'student' 
        AND is_active = true
        AND (current_rating > $1 OR (current_rating = $1 AND id < $2));
      `,
      [current_rating, userId]
    );

    return rankRes.rows[0] ? rankRes.rows[0].rank : 1;
  }

  /**
   * Check if a contest has already had its ratings finalized
   */
  static async isContestRatingFinalized(contestId) {
    const text = `SELECT is_rating_finalized FROM contests WHERE id = $1;`;
    const res = await db.query(text, [contestId]);
    return res.rows[0] ? res.rows[0].is_rating_finalized : false;
  }

  /**
   * Update user rating attributes inside a transaction
   */
  static async updateUserRating(clientOrDb, userId, {
    currentRating,
    highestRating,
    ratingStatus,
    ratedContestCount,
  }) {
    const executor = clientOrDb || db;
    const text = `
      UPDATE users
      SET 
        current_rating = $1,
        highest_rating = GREATEST(highest_rating, $2),
        rating_status = $3,
        rated_contest_count = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, username, current_rating AS "currentRating", highest_rating AS "highestRating", rating_status AS "ratingStatus", rated_contest_count AS "ratedContestCount";
    `;
    const values = [currentRating, highestRating, ratingStatus, ratedContestCount, userId];
    const res = await executor.query(text, values);
    return res.rows[0] || null;
  }
}

module.exports = RatingModel;
