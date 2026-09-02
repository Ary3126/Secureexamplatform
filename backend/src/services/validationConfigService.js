const db = require('../config/db');
const ProblemValidationConfigModel = require('../models/problemValidationConfigModel');
const ProblemModel = require('../models/problemModel');
const AuditLogger = require('./auditLogger');
const { GENERATOR_TYPES, VALIDATION_LIMITS } = require('../judge/validation/validationConstants');

/**
 * ValidationConfigService - Business logic and validation for Problem Validation Configurations
 */
class ValidationConfigService {
  /**
   * Validate incoming configuration values
   * @param {Object} data
   * @throws {Error} If validation fails
   */
  static validateConfigPayload(data = {}) {
    // 1. Validate randomTestCount
    if (data.randomTestCount !== undefined && data.randomTestCount !== null) {
      const count = Number(data.randomTestCount);
      if (!Number.isInteger(count) || count < VALIDATION_LIMITS.MIN_RANDOM_TESTS || count > VALIDATION_LIMITS.MAX_RANDOM_TESTS) {
        const err = new Error(
          `randomTestCount must be an integer between ${VALIDATION_LIMITS.MIN_RANDOM_TESTS} and ${VALIDATION_LIMITS.MAX_RANDOM_TESTS}`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // 2. Validate generatorType
    if (data.generatorType !== undefined && data.generatorType !== null) {
      const allowedTypes = Object.values(GENERATOR_TYPES);
      if (!allowedTypes.includes(data.generatorType)) {
        const err = new Error(
          `Invalid generatorType '${data.generatorType}'. Supported types: ${allowedTypes.join(', ')}`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Validate generatorConfig
    if (data.generatorConfig !== undefined && data.generatorConfig !== null) {
      if (typeof data.generatorConfig !== 'object' || Array.isArray(data.generatorConfig)) {
        const err = new Error('generatorConfig must be a valid JSON object');
        err.statusCode = 400;
        throw err;
      }
    }

    // 4. Validate validationMetadata
    if (data.validationMetadata !== undefined && data.validationMetadata !== null) {
      if (typeof data.validationMetadata !== 'object' || Array.isArray(data.validationMetadata)) {
        const err = new Error('validationMetadata must be a valid JSON object');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  /**
   * Get validation config for a problem (or safe defaults if not configured)
   * @param {number} problemId
   * @returns {Promise<Object>}
   */
  static async getConfig(problemId) {
    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      const err = new Error(`Problem with ID ${problemId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const config = await ProblemValidationConfigModel.findByProblemId(problemId);
    if (!config) {
      return {
        problemId: parseInt(problemId, 10),
        validationEnabled: false,
        randomEnabled: false,
        randomTestCount: VALIDATION_LIMITS.DEFAULT_RANDOM_TESTS,
        edgeEnabled: false,
        boundaryEnabled: false,
        generatorType: GENERATOR_TYPES.DEFAULT,
        generatorConfig: {},
        validationMetadata: {},
        isDefault: true,
      };
    }

    return config;
  }

  /**
   * Create or update validation configuration for a problem
   * @param {number} problemId
   * @param {Object} payload
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<Object>}
   */
  static async saveConfig(problemId, payload = {}, actor = null, req = null) {
    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      const err = new Error(`Problem with ID ${problemId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Validate payload values
    ValidationConfigService.validateConfigPayload(payload);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const saved = await ProblemValidationConfigModel.upsertConfig({
        problemId: parseInt(problemId, 10),
        validationEnabled: payload.validationEnabled !== undefined ? payload.validationEnabled : false,
        randomEnabled: payload.randomEnabled !== undefined ? payload.randomEnabled : false,
        randomTestCount: payload.randomTestCount !== undefined ? payload.randomTestCount : VALIDATION_LIMITS.DEFAULT_RANDOM_TESTS,
        edgeEnabled: payload.edgeEnabled !== undefined ? payload.edgeEnabled : false,
        boundaryEnabled: payload.boundaryEnabled !== undefined ? payload.boundaryEnabled : false,
        generatorType: payload.generatorType || GENERATOR_TYPES.DEFAULT,
        generatorConfig: payload.generatorConfig || {},
        validationMetadata: payload.validationMetadata || {},
      }, client);

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'VALIDATION_CONFIG_SAVED',
          resourceType: 'problem',
          resourceId: problemId,
          outcome: 'success',
          metadata: {
            validationEnabled: saved.validationEnabled,
            generatorType: saved.generatorType,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      console.log(`[VALIDATION CONFIG] Updated configuration for Problem ${problemId} (enabled: ${saved.validationEnabled}, type: ${saved.generatorType})`);
      return saved;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete validation configuration for a problem (resets to default)
   * @param {number} problemId
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<boolean>}
   */
  static async deleteConfig(problemId, actor = null, req = null) {
    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      const err = new Error(`Problem with ID ${problemId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const deleted = await ProblemValidationConfigModel.deleteByProblemId(problemId, client);

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'VALIDATION_CONFIG_DELETED',
          resourceType: 'problem',
          resourceId: problemId,
          outcome: 'success',
          client,
          req,
        });
      }

      await client.query('COMMIT');

      console.log(`[VALIDATION CONFIG] Removed custom validation configuration for Problem ${problemId}`);
      return deleted;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = ValidationConfigService;