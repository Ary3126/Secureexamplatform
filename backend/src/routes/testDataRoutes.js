/**
 * Admin Test Data Management & Permanent Deletion Routes
 * File: backend/src/routes/testDataRoutes.js
 *
 * Restricted strictly to platform administrators (super_admin, contest_admin)
 */

const express = require('express');
const router = express.Router();
const TestDataController = require('../controllers/testDataController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// Security Gate: Authentication, Admin RBAC, Rate Limiting
router.use(authenticate);
router.use(authorizeRoles('super_admin', 'contest_admin'));
router.use(mediumProtectionRateLimiter);

// 1. Overview & Aggregations
router.get('/summary', TestDataController.getSummary);
router.get('/runs', TestDataController.getRuns);
router.get('/', TestDataController.getRecords);

// 2. Pre-Deletion Dependency Previews
router.get('/preview', TestDataController.getPreview);
router.get('/runs/:runId/preview', TestDataController.getRunPreview);

// 3. Permanent Deletion Endpoints
router.delete('/users/:id', TestDataController.deleteUser);
router.delete('/contests/:id', TestDataController.deleteContest);
router.delete('/problems/:id', TestDataController.deleteProblem);
router.delete('/runs/:runId', TestDataController.deleteRun);

// 4. Maintenance / Legacy Tagging
router.post('/tag-legacy', TestDataController.tagLegacy);

module.exports = router;
