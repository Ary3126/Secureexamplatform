const express = require('express');
const router = express.Router();
const testCaseController = require('../controllers/testCaseController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { validateCreateTestCase } = require('../middleware/submissionValidation');
router.use('/problems/:problemId/test-cases', authenticate);
router.use('/problems/:problemId/testcases', authenticate);
router.use('/test-cases', authenticate);

/**
 * @route POST /api/problems/:problemId/test-cases
 * Add test case to a problem (professor, contest_admin, super_admin)
 */
router.post(
  '/problems/:problemId/test-cases',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateCreateTestCase,
  testCaseController.createTestCase
);
router.post(
  '/problems/:problemId/testcases',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateCreateTestCase,
  testCaseController.createTestCase
);

/**
 * @route GET /api/problems/:problemId/test-cases
 * Get all test cases for a problem (Administrative only)
 */
router.get(
  '/problems/:problemId/test-cases',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.getTestCases
);

/**
 * @route PUT /api/test-cases/:id
 * Update test case (professor, contest_admin, super_admin)
 */
router.put(
  '/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.updateTestCase
);

/**
 * @route DELETE /api/test-cases/:id
 * Delete test case (professor, contest_admin, super_admin)
 */
router.delete(
  '/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.deleteTestCase
);

module.exports = router;