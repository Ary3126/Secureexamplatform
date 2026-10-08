const TestCaseModel = require('../models/testCaseModel');
const ProblemModel = require('../models/problemModel');
const ContestModel = require('../models/contestModel');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * Test Case Controller - Handles test case CRUD operations with ownership checks
 */

/**
 * Add a test case to a problem
 * @route POST /api/problems/:problemId/test-cases
 */
const createTestCase = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const problemIdNum = Number(problemId);
    if (!Number.isInteger(problemIdNum) || problemIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid problem identifier format',
      });
    }
    const parsedProblemId = problemIdNum;

    const problem = await ProblemModel.findProblemById(parsedProblemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: problem.id,
        outcome: 'denied',
        metadata: { attemptedAction: 'TEST_CASE_CREATED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to add test cases to this problem',
      });
    }

    // Test case immutability check: cannot add test cases while problem is in a running contest
    const runningContestCheck = await ContestModel.getActiveRunningContestForProblem(parsedProblemId);
    if (runningContestCheck.isLocked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: parsedProblemId,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'TEST_CASE_CREATE_DURING_RUNNING_CONTEST',
          contestId: runningContestCheck.contestId,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: runningContestCheck.message,
        contestId: runningContestCheck.contestId,
      });
    }

    const { inputData, expectedOutput, isHidden, isSample, timeLimitMs, memoryLimitMb, testOrder } = req.body;

    const testCase = await TestCaseModel.createTestCaseWithSafety({
      problemId: parsedProblemId,
      inputData,
      expectedOutput,
      isHidden,
      isSample,
      timeLimitMs,
      memoryLimitMb,
      testOrder,
    }, req.user, req);

    return res.status(201).json({
      message: 'Test case created successfully',
      testCase,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all test cases for a problem (Administrative only)
 * @route GET /api/problems/:problemId/test-cases
 */
const getTestCases = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const problemIdNum = Number(problemId);
    if (!Number.isInteger(problemIdNum) || problemIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid problem identifier format',
      });
    }
    const parsedProblemId = problemIdNum;

    const problem = await ProblemModel.findProblemById(parsedProblemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: parsedProblemId,
        outcome: 'denied',
        metadata: { attemptedAction: 'TEST_CASES_VIEW' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view administrative test cases',
      });
    }

    const testCases = await TestCaseModel.findTestCasesByProblemId(parsedProblemId, { includeHidden: true });

    return res.status(200).json({
      count: testCases.length,
      testCases,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get specific test case by ID (Administrative only)
 * @route GET /api/test-cases/:id
 */
const getTestCaseById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const testCaseIdNum = Number(id);
    if (!Number.isInteger(testCaseIdNum) || testCaseIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid test case identifier format',
      });
    }
    const parsedId = testCaseIdNum;

    const testCase = await TestCaseModel.findTestCaseById(parsedId);
    if (!testCase) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Test case with ID ${id} not found`,
      });
    }

    // Cross-resource verification: Ensure test case belongs to problem if problemId is in route
    if (req.params.problemId) {
      const routeProbId = Number(req.params.problemId);
      if (!Number.isInteger(routeProbId) || routeProbId <= 0 || routeProbId !== testCase.problemId) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Test case with ID ${id} does not belong to problem ${req.params.problemId}`,
        });
      }
    }

    const problem = await ProblemModel.findProblemById(testCase.problemId);
    if (!canManageResource(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'test_case',
        resourceId: parsedId,
        outcome: 'denied',
        metadata: { attemptedAction: 'TEST_CASE_VIEW' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view this test case',
      });
    }

    return res.status(200).json({
      testCase,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a test case
 * @route PUT /api/test-cases/:id
 */
const updateTestCase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const testCaseIdNum = Number(id);
    if (!Number.isInteger(testCaseIdNum) || testCaseIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid test case identifier format',
      });
    }
    const parsedId = testCaseIdNum;

    const testCase = await TestCaseModel.findTestCaseById(parsedId);
    if (!testCase) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Test case with ID ${id} not found`,
      });
    }

    // Cross-resource verification: Ensure test case belongs to problem if problemId is in route
    if (req.params.problemId) {
      const routeProbId = Number(req.params.problemId);
      if (!Number.isInteger(routeProbId) || routeProbId <= 0 || routeProbId !== testCase.problemId) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Test case with ID ${id} does not belong to problem ${req.params.problemId}`,
        });
      }
    }

    const problem = await ProblemModel.findProblemById(testCase.problemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Parent problem with ID ${testCase.problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'test_case',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'TEST_CASE_UPDATED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to modify this test case',
      });
    }

    // Test case immutability check: cannot modify test case while parent problem is in a running contest
    const runningContestCheck = await ContestModel.getActiveRunningContestForProblem(testCase.problemId);
    if (runningContestCheck.isLocked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'test_case',
        resourceId: parsedId,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'TEST_CASE_UPDATE_DURING_RUNNING_CONTEST',
          problemId: testCase.problemId,
          contestId: runningContestCheck.contestId,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: runningContestCheck.message,
        contestId: runningContestCheck.contestId,
      });
    }

    const updated = await TestCaseModel.updateTestCaseWithSafety(parsedId, req.body, req.user, req);

    if (updated && updated.locked) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: updated.message,
        contestId: updated.contestId,
      });
    }

    return res.status(200).json({
      message: 'Test case updated successfully',
      testCase: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a test case
 * @route DELETE /api/test-cases/:id
 */
const deleteTestCase = async (req, res, next) => {
  try {
    const { id } = req.params;
    const testCaseIdNum = Number(id);
    if (!Number.isInteger(testCaseIdNum) || testCaseIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid test case identifier format',
      });
    }
    const parsedId = testCaseIdNum;

    const testCase = await TestCaseModel.findTestCaseById(parsedId);
    if (!testCase) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Test case with ID ${id} not found`,
      });
    }

    // Cross-resource verification: Ensure test case belongs to problem if problemId is in route
    if (req.params.problemId) {
      const routeProbId = Number(req.params.problemId);
      if (!Number.isInteger(routeProbId) || routeProbId <= 0 || routeProbId !== testCase.problemId) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Test case with ID ${id} does not belong to problem ${req.params.problemId}`,
        });
      }
    }

    const problem = await ProblemModel.findProblemById(testCase.problemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Parent problem with ID ${testCase.problemId} not found`,
      });
    }

    if (!canManageResource(req.user, problem)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'test_case',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'TEST_CASE_DELETED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to delete this test case',
      });
    }

    // Test case immutability check: cannot delete test case while parent problem is in a running contest
    const delRunningCheck = await ContestModel.getActiveRunningContestForProblem(testCase.problemId);
    if (delRunningCheck.isLocked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'test_case',
        resourceId: parsedId,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'TEST_CASE_DELETE_DURING_RUNNING_CONTEST',
          problemId: testCase.problemId,
          contestId: delRunningCheck.contestId,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: delRunningCheck.message,
        contestId: delRunningCheck.contestId,
      });
    }

    const deleteResult = await TestCaseModel.deleteTestCaseWithSafety(parsedId, req.user, req, testCase.problemId);
    if (deleteResult && deleteResult.locked) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: deleteResult.message,
        contestId: deleteResult.contestId,
      });
    }

    return res.status(200).json({
      message: 'Test case deleted successfully',
      deletedTestCaseId: parsedId,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTestCase,
  getTestCases,
  getTestCaseById,
  updateTestCase,
  deleteTestCase,
};