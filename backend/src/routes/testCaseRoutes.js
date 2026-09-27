const express = require('express');
const router = express.Router();
const testCaseController = require('../controllers/testCaseController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { validateCreateTestCase, validateUpdateTestCase } = require('../middleware/submissionValidation');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Medium protection rate limiter for test-case endpoints
router.use(mediumProtectionRateLimiter);

router.use('/problems/:problemId/test-cases', authenticate);
router.use('/problems/:problemId/testcases', authenticate);
router.use('/test-cases', authenticate);

/**
 * @route POST /api/problems/:problemId/test-cases
 * @route POST /api/problems/:problemId/testcases
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
 * @route GET /api/problems/:problemId/testcases
 * Get all test cases for a problem (Administrative only)
 */
router.get(
  '/problems/:problemId/test-cases',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.getTestCases
);
router.get(
  '/problems/:problemId/testcases',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.getTestCases
);

/**
 * @route GET /api/test-cases/:id
 * Get single test case by ID (Administrative only)
 */
router.get(
  '/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.getTestCaseById
);
router.get(
  '/problems/:problemId/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.getTestCaseById
);

/**
 * @route PUT /api/test-cases/:id
 * @route PUT /api/problems/:problemId/test-cases/:id
 * Update test case (professor, contest_admin, super_admin)
 */
router.put(
  '/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateUpdateTestCase,
  testCaseController.updateTestCase
);
router.put(
  '/problems/:problemId/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  validateUpdateTestCase,
  testCaseController.updateTestCase
);

/**
 * @route DELETE /api/test-cases/:id
 * @route DELETE /api/problems/:problemId/test-cases/:id
 * Delete test case (professor, contest_admin, super_admin)
 */
router.delete(
  '/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.deleteTestCase
);
router.delete(
  '/problems/:problemId/test-cases/:id',
  authorizeRoles('professor', 'contest_admin', 'super_admin'),
  testCaseController.deleteTestCase
);

module.exports = router;