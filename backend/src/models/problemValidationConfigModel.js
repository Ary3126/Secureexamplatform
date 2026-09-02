const db = require('../config/db');

/**
 * ProblemValidationConfigModel - Encapsulates all database operations for problem_validation_configs
 */
class ProblemValidationConfigModel {
  /**
   * Find validation configuration for a specific problem
   * @param {number} problemId
   * @returns {Promise<Object|null>}
   */
  static async findByProblemId(problemId) {
    const text = `
      SELECT 
        id,
        problem_id AS "problemId",
        validation_enabled AS "validationEnabled",
        random_enabled AS "randomEnabled",
        random_test_count AS "randomTestCount",
        edge_enabled AS "edgeEnabled",
        boundary_enabled AS "boundaryEnabled",
        generator_type AS "generatorType",
        generator_config AS "generatorConfig",
        reference_solution AS "referenceSolution",
        validation_metadata AS "validationMetadata",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM problem_validation_configs
      WHERE problem_id = $1;
    `;
    const res = await db.query(text, [problemId]);
    return res.rows[0] || null;
  }

  /**
   * Create or update validation configuration for a problem (UPSERT)
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  static async upsertConfig({
    problemId,
    validationEnabled = false,
    randomEnabled = false,
    randomTestCount = 10,
    edgeEnabled = false,
    boundaryEnabled = false,
    generatorType = 'default',
    generatorConfig = {},
    referenceSolution = {},
    validationMetadata = {},
  }, client = null) {
    const text = `
      INSERT INTO problem_validation_configs (
        problem_id,
        validation_enabled,
        random_enabled,
        random_test_count,
        edge_enabled,
        boundary_enabled,
        generator_type,
        generator_config,
        reference_solution,
        validation_metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (problem_id)
      DO UPDATE SET
        validation_enabled = EXCLUDED.validation_enabled,
        random_enabled = EXCLUDED.random_enabled,
        random_test_count = EXCLUDED.random_test_count,
        edge_enabled = EXCLUDED.edge_enabled,
        boundary_enabled = EXCLUDED.boundary_enabled,
        generator_type = EXCLUDED.generator_type,
        generator_config = EXCLUDED.generator_config,
        reference_solution = EXCLUDED.reference_solution,
        validation_metadata = EXCLUDED.validation_metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING 
        id,
        problem_id AS "problemId",
        validation_enabled AS "validationEnabled",
        random_enabled AS "randomEnabled",
        random_test_count AS "randomTestCount",
        edge_enabled AS "edgeEnabled",
        boundary_enabled AS "boundaryEnabled",
        generator_type AS "generatorType",
        generator_config AS "generatorConfig",
        reference_solution AS "referenceSolution",
        validation_metadata AS "validationMetadata",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `;
    const values = [
      problemId,
      Boolean(validationEnabled),
      Boolean(randomEnabled),
      parseInt(randomTestCount, 10) || 10,
      Boolean(edgeEnabled),
      Boolean(boundaryEnabled),
      generatorType || 'default',
      JSON.stringify(generatorConfig || {}),
      JSON.stringify(referenceSolution || {}),
      JSON.stringify(validationMetadata || {}),
    ];
    const res = await (client || db).query(text, values);
    return res.rows[0];
  }

  /**
   * Delete validation configuration for a problem
   * @param {number} problemId
   * @param {Object|null} client
   * @returns {Promise<boolean>}
   */
  static async deleteByProblemId(problemId, client = null) {
    const text = 'DELETE FROM problem_validation_configs WHERE problem_id = $1 RETURNING id;';
    const res = await (client || db).query(text, [problemId]);
    return res.rowCount > 0;
  }
}

module.exports = ProblemValidationConfigModel;