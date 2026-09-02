const db = require('../config/db');

/**
 * SubmissionValidationRunModel - Manages database operations for submission_validation_runs
 */
class SubmissionValidationRunModel {
  /**
   * Record the creation or start of a validation run
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  static async createValidationRun({
    submissionId,
    problemId,
    currentStage = 'INITIALIZING',
    finalStatus = 'running',
    standardPassed = 0,
    standardTotal = 0,
    randomPassed = 0,
    randomTotal = 0,
    edgePassed = 0,
    edgeTotal = 0,
    boundaryPassed = 0,
    boundaryTotal = 0,
    suspicionScore = 0,
    suspicionLevel = 'LOW',
    isFlagged = false,
    failureStage = null,
    failureReason = null,
    executionTimeMs = 0,
    memoryUsedKb = 0,
    stageDurations = {},
    validationDetails = {},
  }) {
    const text = `
      INSERT INTO submission_validation_runs (
        submission_id,
        problem_id,
        current_stage,
        final_status,
        standard_passed,
        standard_total,
        random_passed,
        random_total,
        edge_passed,
        edge_total,
        boundary_passed,
        boundary_total,
        suspicion_score,
        suspicion_level,
        is_flagged,
        failure_stage,
        failure_reason,
        execution_time_ms,
        memory_used_kb,
        stage_durations,
        validation_details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *;
    `;
    const values = [
      submissionId,
      problemId,
      currentStage,
      finalStatus,
      standardPassed,
      standardTotal,
      randomPassed,
      randomTotal,
      edgePassed,
      edgeTotal,
      boundaryPassed,
      boundaryTotal,
      suspicionScore,
      suspicionLevel,
      isFlagged,
      failureStage,
      failureReason,
      executionTimeMs,
      memoryUsedKb,
      JSON.stringify(stageDurations || {}),
      JSON.stringify(validationDetails || {}),
    ];
    const res = await db.query(text, values);
    return res.rows[0];
  }

  /**
   * Find validation run details for a submission
   * @param {number} submissionId
   * @returns {Promise<Object|null>}
   */
  static async findBySubmissionId(submissionId) {
    const text = `
      SELECT *
      FROM submission_validation_runs
      WHERE submission_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = await db.query(text, [submissionId]);
    return res.rows[0] || null;
  }
}

module.exports = SubmissionValidationRunModel;