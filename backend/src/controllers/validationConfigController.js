const ValidationConfigService = require('../services/validationConfigService');
const ProblemModel = require('../models/problemModel');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * Get validation configuration for a problem
 * @route GET /api/problems/:problemId/validation-config
 */
const getValidationConfig = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const problem = await ProblemModel.findProblemById(problemId);

    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem.createdBy)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'validation_config',
        resourceId: problemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'VALIDATION_CONFIG_VIEW' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view this problem validation configuration',
      });
    }

    const config = await ValidationConfigService.getConfig(problemId);
    return res.status(200).json({
      status: 'success',
      config,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create or update validation configuration for a problem
 * @route POST /api/problems/:problemId/validation-config
 * @route PUT  /api/problems/:problemId/validation-config
 */
const saveValidationConfig = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const problem = await ProblemModel.findProblemById(problemId);

    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem.createdBy)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only configure validation for problems you created',
      });
    }

    const config = await ValidationConfigService.saveConfig(problemId, req.body, req.user, req);

    return res.status(200).json({
      status: 'success',
      message: 'Problem validation configuration saved successfully',
      config,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete validation configuration for a problem (resets to default)
 * @route DELETE /api/problems/:problemId/validation-config
 */
const deleteValidationConfig = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const problem = await ProblemModel.findProblemById(problemId);

    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem.createdBy)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only delete validation configuration for problems you created',
      });
    }

    await ValidationConfigService.deleteConfig(problemId, req.user, req);

    return res.status(200).json({
      status: 'success',
      message: `Validation configuration for problem ${problemId} reset successfully`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getValidationConfig,
  saveValidationConfig,
  deleteValidationConfig,
};