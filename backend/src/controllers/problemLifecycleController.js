const db = require('../config/db');
const ProblemModel = require('../models/problemModel');
const TestCaseModel = require('../models/testCaseModel');
const ProblemLifecycleModel = require('../models/problemLifecycleModel');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * Authorization helper for problem lifecycle operations
 */
function canAccessProblemLifecycle(user, problem) {
  if (!user || !problem) return false;
  if (user.role === 'super_admin') return true;
  const authorId = problem.created_by || problem.createdBy;
  if (user.id === authorId) return true;
  const scope = (problem.access_scope || problem.accessScope || 'public').toLowerCase();
  if (scope === 'public' && (user.role === 'professor' || user.role === 'contest_admin')) return true;
  return false;
}

/**
 * Compare Two Problem Versions
 * @route GET /api/problems/:id/versions/compare
 */
const compareVersions = async (req, res, next) => {
  try {
    const problemId = parseInt(req.params.id, 10);
    const { v1, v2 } = req.query;

    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    if (!v1 || !v2 || !/^\d+$/.test(String(v1).trim()) || !/^\d+$/.test(String(v2).trim())) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Both v1 and v2 parameters must be positive integers' });
    }

    const version1 = parseInt(v1, 10);
    const version2 = parseInt(v2, 10);

    if (version1 <= 0 || version2 <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Both v1 and v2 parameters must be positive integers' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemLifecycle(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'VERSION_COMPARED' },
        req,
      });
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: Unauthorized access to problem version history' });
    }

    const diff = await ProblemLifecycleModel.compareVersions(problemId, version1, version2);
    if (!diff) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `One or both versions (v${version1}, v${version2}) do not exist for Problem #${problemId}` });
    }

    await AuditLogger.logAction({
      actor: req.user,
      action: 'VERSION_COMPARED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { v1: version1, v2: version2, hasChanges: diff.hasChanges },
      req,
    });

    return res.status(200).json({
      status: 'success',
      diff,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Rollback / Restore Problem to a Previous Version Snapshot
 * @route POST /api/problems/:id/versions/:v/rollback
 */
const rollbackVersion = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const problemId = parseInt(req.params.id, 10);
    const targetVersion = parseInt(req.params.v, 10);
    const { changeSummary } = req.body || {};

    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }
    if (isNaN(targetVersion) || targetVersion <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Target version must be a positive integer' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const currentProblem = probRes.rows[0];

    // Authorization: Owner or Super Admin
    if (!canManageResource(req.user, currentProblem)) {
      await client.query('ROLLBACK');
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'VERSION_RESTORED', targetVersion },
        req,
      });
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to rollback this problem' });
    }

    // Fetch target version snapshot
    const verRes = await client.query(
      'SELECT * FROM problem_versions WHERE problem_id = $1 AND version_number = $2',
      [problemId, targetVersion]
    );

    if (verRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Target version v${targetVersion} not found for Problem #${problemId}` });
    }

    const snapshot = verRes.rows[0];
    const currentVersionNum = parseInt(currentProblem.version, 10) || 1;
    const newVersionNum = currentVersionNum + 1;

    // Rollback creates a NEW version and invalidates existing review approval
    const updateText = `
      UPDATE problems
      SET 
        title = $2,
        description = $3,
        difficulty = $4,
        coding_mode = $5,
        starter_templates = $6,
        harness_templates = $7,
        function_config = $8,
        access_scope = $9,
        version = $10,
        is_published = false,
        published_at = NULL,
        review_status = 'draft',
        approved_version = NULL,
        approved_by = NULL,
        approved_at = NULL,
        scheduled_publish_at = NULL,
        scheduled_publish_by = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
    `;

    const updatedProbRes = await client.query(updateText, [
      problemId,
      snapshot.title,
      snapshot.description,
      snapshot.difficulty,
      snapshot.coding_mode,
      JSON.stringify(snapshot.starter_templates || {}),
      JSON.stringify(snapshot.harness_templates || {}),
      JSON.stringify(snapshot.function_config || {}),
      snapshot.access_scope || 'contest_private',
      newVersionNum,
    ]);
    const updatedProblem = updatedProbRes.rows[0];

    // Revoke any existing active reviews
    await client.query(
      `UPDATE problem_reviews SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE problem_id = $1 AND status IN ('pending', 'in_review', 'changes_requested')`,
      [problemId]
    );

    // Restore test cases from snapshot
    const targetTestCases = Array.isArray(snapshot.test_cases_snapshot) ? snapshot.test_cases_snapshot : [];
    await client.query('DELETE FROM test_cases WHERE problem_id = $1', [problemId]);

    for (let idx = 0; idx < targetTestCases.length; idx++) {
      const tc = targetTestCases[idx];
      await client.query(
        `INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, time_limit_ms, memory_limit_mb, test_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          problemId,
          tc.inputData || tc.input_data || '',
          tc.expectedOutput || tc.expected_output || '',
          Boolean(tc.isHidden ?? tc.is_hidden),
          tc.timeLimitMs || tc.time_limit_ms || 2000,
          tc.memoryLimitMb || tc.memory_limit_mb || 256,
          tc.testOrder || tc.test_order || (idx + 1),
        ]
      );
    }

    // Persist new version snapshot representing the rollback state
    const summary = changeSummary || `Rolled back from v${currentVersionNum} to v${targetVersion}`;
    await client.query(
      `INSERT INTO problem_versions (
        problem_id, version_number, title, description, difficulty, coding_mode, starter_templates, harness_templates, function_config, access_scope, test_cases_snapshot, validation_config_snapshot, change_summary, source_action, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'rollback', $14, CURRENT_TIMESTAMP)`,
      [
        problemId,
        newVersionNum,
        snapshot.title,
        snapshot.description,
        snapshot.difficulty,
        snapshot.coding_mode,
        JSON.stringify(snapshot.starter_templates || {}),
        JSON.stringify(snapshot.harness_templates || {}),
        JSON.stringify(snapshot.function_config || {}),
        snapshot.access_scope,
        JSON.stringify(targetTestCases),
        JSON.stringify(snapshot.validation_config_snapshot || {}),
        summary,
        req.user.id,
      ]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'VERSION_RESTORED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: {
        restoredFromVersion: targetVersion,
        newVersion: newVersionNum,
        previousVersion: currentVersionNum,
        changeSummary: summary,
      },
      client,
      req,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_VERSION_CREATED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { version: newVersionNum, sourceAction: 'rollback' },
      client,
      req,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} successfully rolled back from v${currentVersionNum} to v${targetVersion} as new version v${newVersionNum}`,
      problem: {
        id: updatedProblem.id,
        title: updatedProblem.title,
        version: newVersionNum,
        restoredFromVersion: targetVersion,
        reviewStatus: 'draft',
        isPublished: false,
        testCasesRestoredCount: targetTestCases.length,
      },
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Unpublish / Withdraw a Published Problem
 * @route POST /api/problems/:id/unpublish
 */
const unpublishProblem = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    if (!canManageResource(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to unpublish this problem' });
    }

    if (!problem.is_published && problem.review_status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Problem is not currently published' });
    }

    // Dependency check: Cannot unpublish if in running contest
    const impact = await ProblemLifecycleModel.getDependencyImpact(problemId, client);
    if (!impact.canUnpublish) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot unpublish problem while it is active in running contest(s)',
        blockingReasons: impact.blockingReasons,
      });
    }

    await client.query(
      `UPDATE problems 
       SET is_published = false, review_status = 'withdrawn', access_scope = 'contest_private', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_UNPUBLISHED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { version: problem.version, previousStatus: 'published' },
      client,
      req,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} has been unpublished / withdrawn from the public bank`,
      problemId,
      isPublished: false,
      reviewStatus: 'withdrawn',
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Archive Problem
 * @route POST /api/problems/:id/archive
 */
const archiveProblem = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    if (!canManageResource(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden: You do not have permission to archive this problem' });
    }

    if (problem.review_status === 'archived') {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Problem is already archived' });
    }

    // Check dependency impact
    const impact = await ProblemLifecycleModel.getDependencyImpact(problemId, client);
    if (!impact.canArchive) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot archive problem attached to active or upcoming contests',
        blockingReasons: impact.blockingReasons,
      });
    }

    await client.query(
      `UPDATE problems 
       SET is_published = false, review_status = 'archived', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_ARCHIVED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { version: problem.version, previousStatus: problem.review_status },
      client,
      req,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} has been archived`,
      problemId,
      reviewStatus: 'archived',
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Restore Problem from Archive
 * @route POST /api/problems/:id/restore-archive
 */
const restoreArchivedProblem = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    await client.query('BEGIN');

    const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (probRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }
    const problem = probRes.rows[0];

    if (!canManageResource(req.user, problem)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    if (problem.review_status !== 'archived') {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Problem is not currently in archived state' });
    }

    await client.query(
      `UPDATE problems SET review_status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [problemId]
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PROBLEM_RESTORED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { version: problem.version, previousStatus: 'archived' },
      client,
      req,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} restored from archive to draft state`,
      problemId,
      reviewStatus: 'draft',
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * Schedule Publication for Approved Problem
 * @route POST /api/problems/:id/schedule-publish
 */
const schedulePublication = async (req, res, next) => {
  try {
    const problemId = parseInt(req.params.id, 10);
    const { scheduledPublishAt } = req.body;

    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    if (!scheduledPublishAt || isNaN(Date.parse(scheduledPublishAt))) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Valid ISO timestamp for scheduledPublishAt is required' });
    }

    const schedDate = new Date(scheduledPublishAt);
    if (schedDate <= new Date()) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'scheduledPublishAt must be in the future' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canManageResource(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    // Must be approved for current version
    const isApproved = problem.reviewStatus === 'approved' && problem.approvedVersion === problem.version;
    if (!isApproved) {
      return res.status(422).json({
        status: 'error',
        statusCode: 422,
        message: 'Cannot schedule publication: Problem requires approved peer review for its current version',
        reviewStatus: problem.reviewStatus,
        version: problem.version,
        approvedVersion: problem.approvedVersion,
      });
    }

    const scheduled = await ProblemLifecycleModel.schedulePublish(problemId, schedDate, req.user.id);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PUBLICATION_SCHEDULED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { scheduledPublishAt: schedDate.toISOString(), version: problem.version },
      req,
    });

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} scheduled for publication at ${schedDate.toISOString()}`,
      scheduled,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel Scheduled Publication
 * @route DELETE /api/problems/:id/schedule-publish
 */
const cancelScheduledPublication = async (req, res, next) => {
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canManageResource(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const cancelled = await ProblemLifecycleModel.cancelScheduledPublish(problemId);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PUBLICATION_SCHEDULE_CANCELLED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { version: problem.version },
      req,
    });

    return res.status(200).json({
      status: 'success',
      message: `Scheduled publication cancelled for Problem #${problemId}`,
      cancelled,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Execute Scheduled Publication (Server/Admin Trigger)
 * @route POST /api/problems/:id/execute-publish
 */
const executeScheduledPublication = async (req, res, next) => {
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canManageResource(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    // Execute via problem publish safety mechanism
    const publishResult = await ProblemModel.publishProblemWithSafety(problemId, req.user, req);

    if (publishResult.validationFailed) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PUBLICATION_EXECUTION_FAILED',
        resourceType: 'problem',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { reason: publishResult.errors?.[0] || 'validation failed', version: problem.version },
        req,
      });
      return res.status(422).json({
        status: 'error',
        statusCode: 422,
        message: 'Problem publication validation failed',
        errors: publishResult.errors || [],
      });
    }

    if (publishResult.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem #${problemId} not found`,
      });
    }

    await ProblemLifecycleModel.cancelScheduledPublish(problemId);

    return res.status(200).json({
      status: 'success',
      message: `Problem #${problemId} published successfully via scheduled execution`,
      problem: publishResult.problem,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get Problem Dependency & Impact Analysis
 * @route GET /api/problems/:id/dependencies
 */
const getProblemDependencies = async (req, res, next) => {
  try {
    const problemId = parseInt(req.params.id, 10);
    if (isNaN(problemId) || problemId <= 0) {
      return res.status(400).json({ status: 'error', statusCode: 400, message: 'Invalid problem ID format' });
    }

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: `Problem #${problemId} not found` });
    }

    if (!canAccessProblemLifecycle(req.user, problem)) {
      return res.status(403).json({ status: 'error', statusCode: 403, message: 'Forbidden' });
    }

    const impact = await ProblemLifecycleModel.getDependencyImpact(problemId);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'DEPENDENCY_IMPACT_CHECKED',
      resourceType: 'problem',
      resourceId: problemId,
      outcome: 'success',
      metadata: { impactLevel: impact.impactLevel, activeContestsCount: impact.metrics.activeContestsCount },
      req,
    });

    return res.status(200).json({
      status: 'success',
      impact,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  compareVersions,
  rollbackVersion,
  unpublishProblem,
  archiveProblem,
  restoreArchivedProblem,
  schedulePublication,
  cancelScheduledPublication,
  executeScheduledPublication,
  getProblemDependencies,
};
