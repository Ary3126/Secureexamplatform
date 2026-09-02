const db = require('../config/db');

/**
 * ProblemQualityModel - Database operations for Problem Quality Snapshots
 */
class ProblemQualityModel {
  /**
   * Save or update an immutable quality snapshot for a specific problem version
   */
  static async saveQualitySnapshot({ problemId, problemVersion, qualityScore, qualityLevel, breakdown, checklist }, client = null) {
    const text = `
      INSERT INTO problem_quality_snapshots (
        problem_id, problem_version, quality_score, quality_level, breakdown, checklist, evaluated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (problem_id, problem_version)
      DO UPDATE SET
        quality_score = EXCLUDED.quality_score,
        quality_level = EXCLUDED.quality_level,
        breakdown = EXCLUDED.breakdown,
        checklist = EXCLUDED.checklist,
        evaluated_at = CURRENT_TIMESTAMP
      RETURNING 
        id,
        problem_id AS "problemId",
        problem_version AS "problemVersion",
        quality_score AS "qualityScore",
        quality_level AS "qualityLevel",
        breakdown,
        checklist,
        evaluated_at AS "evaluatedAt";
    `;
    const res = await (client || db).query(text, [
      problemId,
      problemVersion,
      qualityScore,
      qualityLevel,
      JSON.stringify(breakdown || {}),
      JSON.stringify(checklist || []),
    ]);
    return res.rows[0];
  }

  /**
   * Find quality snapshot for a specific version
   */
  static async findByProblemAndVersion(problemId, versionNumber, client = null) {
    const text = `
      SELECT 
        id,
        problem_id AS "problemId",
        problem_version AS "problemVersion",
        quality_score AS "qualityScore",
        quality_level AS "qualityLevel",
        breakdown,
        checklist,
        evaluated_at AS "evaluatedAt"
      FROM problem_quality_snapshots
      WHERE problem_id = $1 AND problem_version = $2;
    `;
    const res = await (client || db).query(text, [problemId, versionNumber]);
    return res.rows[0] || null;
  }

  /**
   * Get quality evaluation history across all versions of a problem
   */
  static async getHistoryByProblemId(problemId, client = null) {
    const text = `
      SELECT 
        id,
        problem_id AS "problemId",
        problem_version AS "problemVersion",
        quality_score AS "qualityScore",
        quality_level AS "qualityLevel",
        breakdown,
        checklist,
        evaluated_at AS "evaluatedAt"
      FROM problem_quality_snapshots
      WHERE problem_id = $1
      ORDER BY problem_version DESC;
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rows;
  }
}

module.exports = ProblemQualityModel;
