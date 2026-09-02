const db = require('../config/db');

/**
 * UserSkillModel - Data Access Layer for User Skills State
 * Manages persistent user skill progress, levels, confidence, classifications, and counters.
 */
class UserSkillModel {
  /**
   * Retrieve all skill records for a specific user
   * @param {number} userId
   * @returns {Promise<Array>}
   */
  static async getUserSkills(userId) {
    const text = `
      SELECT 
        us.id,
        us.user_id AS "userId",
        us.topic_id AS "topicId",
        t.key AS "topicKey",
        t.name AS "topicName",
        t.category AS "category",
        t.description AS "topicDescription",
        CAST(us.score AS FLOAT) AS "score",
        us.level,
        CAST(us.confidence AS FLOAT) AS "confidence",
        us.classification,
        us.attempted_count AS "attemptedCount",
        us.solved_count AS "solvedCount",
        us.last_attempt_at AS "lastAttemptAt",
        us.last_solved_at AS "lastSolvedAt",
        us.calculation_version AS "calculationVersion",
        us.created_at AS "createdAt",
        us.updated_at AS "updatedAt"
      FROM user_skills us
      JOIN topics t ON us.topic_id = t.id
      WHERE us.user_id = $1
      ORDER BY us.score DESC, us.solved_count DESC, t.name ASC;
    `;
    const res = await db.query(text, [userId]);
    return res.rows;
  }

  /**
   * Retrieve a single user skill record by user and topic
   * @param {number} userId
   * @param {number} topicId
   * @returns {Promise<Object|null>}
   */
  static async getUserSkillByTopic(userId, topicId) {
    const text = `
      SELECT 
        us.id,
        us.user_id AS "userId",
        us.topic_id AS "topicId",
        t.key AS "topicKey",
        t.name AS "topicName",
        t.category AS "category",
        CAST(us.score AS FLOAT) AS "score",
        us.level,
        CAST(us.confidence AS FLOAT) AS "confidence",
        us.classification,
        us.attempted_count AS "attemptedCount",
        us.solved_count AS "solvedCount",
        us.last_attempt_at AS "lastAttemptAt",
        us.last_solved_at AS "lastSolvedAt",
        us.calculation_version AS "calculationVersion",
        us.created_at AS "createdAt",
        us.updated_at AS "updatedAt"
      FROM user_skills us
      JOIN topics t ON us.topic_id = t.id
      WHERE us.user_id = $1 AND us.topic_id = $2;
    `;
    const res = await db.query(text, [userId, topicId]);
    return res.rows[0] || null;
  }

  /**
   * Upsert a user skill record safely (idempotent, atomic on conflict)
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  static async upsertUserSkill({
    userId,
    topicId,
    score = 0.00,
    level = 'BEGINNER',
    confidence = 0.00,
    classification = 'UNASSESSED',
    attemptedCount = 0,
    solvedCount = 0,
    lastAttemptAt = null,
    lastSolvedAt = null,
    calculationVersion = 1,
  }) {
    const text = `
      INSERT INTO user_skills (
        user_id,
        topic_id,
        score,
        level,
        confidence,
        classification,
        attempted_count,
        solved_count,
        last_attempt_at,
        last_solved_at,
        calculation_version,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, topic_id) DO UPDATE SET
        score = EXCLUDED.score,
        level = EXCLUDED.level,
        confidence = EXCLUDED.confidence,
        classification = EXCLUDED.classification,
        attempted_count = EXCLUDED.attempted_count,
        solved_count = EXCLUDED.solved_count,
        last_attempt_at = COALESCE(EXCLUDED.last_attempt_at, user_skills.last_attempt_at),
        last_solved_at = COALESCE(EXCLUDED.last_solved_at, user_skills.last_solved_at),
        calculation_version = EXCLUDED.calculation_version,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id,
        user_id AS "userId",
        topic_id AS "topicId",
        CAST(score AS FLOAT) AS "score",
        level,
        CAST(confidence AS FLOAT) AS "confidence",
        classification,
        attempted_count AS "attemptedCount",
        solved_count AS "solvedCount",
        last_attempt_at AS "lastAttemptAt",
        last_solved_at AS "lastSolvedAt",
        calculation_version AS "calculationVersion",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;

    const values = [
      userId,
      topicId,
      score,
      level,
      confidence,
      classification,
      attemptedCount,
      solvedCount,
      lastAttemptAt,
      lastSolvedAt,
      calculationVersion,
    ];

    const res = await db.query(text, values);
    return res.rows[0];
  }

  /**
   * Get an aggregated summary of user skills
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  static async getUserSkillSummary(userId) {
    const text = `
      SELECT 
        COUNT(*)::INTEGER AS "totalTopicsTracked",
        COALESCE(SUM(solved_count), 0)::INTEGER AS "totalSolvedAcrossTopics",
        COALESCE(SUM(attempted_count), 0)::INTEGER AS "totalAttemptsAcrossTopics",
        COALESCE(AVG(score), 0)::FLOAT AS "averageSkillScore",
        COALESCE(MAX(score), 0)::FLOAT AS "highestSkillScore",
        COALESCE(AVG(confidence), 0)::FLOAT AS "averageConfidence",
        COUNT(CASE WHEN classification = 'STRENGTH' THEN 1 END)::INTEGER AS "strengthsCount",
        COUNT(CASE WHEN classification = 'NEEDS_PRACTICE' THEN 1 END)::INTEGER AS "needsPracticeCount",
        COUNT(CASE WHEN classification = 'DEVELOPING' THEN 1 END)::INTEGER AS "developingCount",
        COUNT(CASE WHEN classification = 'STABLE' THEN 1 END)::INTEGER AS "stableCount",
        COUNT(CASE WHEN classification = 'UNASSESSED' THEN 1 END)::INTEGER AS "unassessedCount"
      FROM user_skills
      WHERE user_id = $1;
    `;
    const res = await db.query(text, [userId]);
    return res.rows[0] || {
      totalTopicsTracked: 0,
      totalSolvedAcrossTopics: 0,
      totalAttemptsAcrossTopics: 0,
      averageSkillScore: 0,
      highestSkillScore: 0,
      averageConfidence: 0,
      strengthsCount: 0,
      needsPracticeCount: 0,
      developingCount: 0,
      stableCount: 0,
      unassessedCount: 0,
    };
  }
}

module.exports = UserSkillModel;
