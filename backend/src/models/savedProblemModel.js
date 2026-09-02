const db = require('../config/db');

/**
 * SavedProblemModel - Encapsulates all bookmark/saved problem operations
 */
class SavedProblemModel {
  /**
   * Save a problem for a user (idempotent ON CONFLICT DO NOTHING)
   */
  static async saveProblem(userId, problemId) {
    const text = `
      INSERT INTO saved_problems (user_id, problem_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, problem_id) DO NOTHING
      RETURNING user_id AS "userId", problem_id AS "problemId", created_at AS "createdAt";
    `;
    const res = await db.query(text, [userId, problemId]);
    return res.rows[0] || { userId, problemId, isSaved: true };
  }

  /**
   * Unsave / Remove bookmark for a user
   */
  static async unsaveProblem(userId, problemId) {
    const text = `
      DELETE FROM saved_problems
      WHERE user_id = $1 AND problem_id = $2
      RETURNING user_id AS "userId", problem_id AS "problemId";
    `;
    const res = await db.query(text, [userId, problemId]);
    return res.rowCount > 0;
  }

  /**
   * Check if a problem is saved by a user
   */
  static async isProblemSaved(userId, problemId) {
    if (!userId || !problemId) return false;
    const text = `
      SELECT 1 FROM saved_problems
      WHERE user_id = $1 AND problem_id = $2
      LIMIT 1;
    `;
    const res = await db.query(text, [userId, problemId]);
    return res.rowCount > 0;
  }

  /**
   * Find saved problems for a user with problem details and pagination
   */
  static async findSavedProblemsByUser(userId, { limit = 20, offset = 0 } = {}) {
    const text = `
      SELECT 
        p.id,
        p.title,
        p.description,
        p.difficulty,
        p.coding_mode AS "codingMode",
        sp.created_at AS "savedAt",
        COUNT(DISTINCT s.id)::int AS "totalSubmissions",
        COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END)::int AS "acceptedSubmissions",
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = $1 THEN s.id END) > 0 THEN 'solved'
          WHEN COUNT(DISTINCT CASE WHEN s.user_id = $1 THEN s.id END) > 0 THEN 'attempted'
          ELSE 'unsolved'
        END AS "userStatus",
        true AS "isSaved"
      FROM saved_problems sp
      JOIN problems p ON sp.problem_id = p.id
      LEFT JOIN submissions s ON p.id = s.problem_id AND s.is_sample_run = false
      WHERE sp.user_id = $1
      GROUP BY p.id, sp.created_at
      ORDER BY sp.created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const res = await db.query(text, [userId, limit, offset]);
    return res.rows;
  }

  /**
   * Count total saved problems for a user
   */
  static async countSavedProblemsByUser(userId) {
    const text = `
      SELECT COUNT(*)::int AS count
      FROM saved_problems
      WHERE user_id = $1;
    `;
    const res = await db.query(text, [userId]);
    return res.rows[0] ? res.rows[0].count : 0;
  }
}

module.exports = SavedProblemModel;
