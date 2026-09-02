/**
 * Admin Routes - Protected administrative management routes
 * 
 * Strictly restricted to Super Admin role with rate limiting and audit integration.
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { mediumProtectionRateLimiter } = require('../middleware/rateLimitMiddleware');

// All admin routes require authentication and super_admin role
router.use(authenticate);
router.use(authorizeRoles('super_admin'));
router.use(mediumProtectionRateLimiter);

/**
 * @route GET /api/admin/overview-stats
 * Super Admin aggregated platform overview & health metrics
 */
router.get('/overview-stats', adminController.getOverviewStats);

/**
 * @route GET /api/admin/audit-logs
 * Super Admin inspection of platform audit history
 */
router.get('/audit-logs', adminController.getAuditLogs);

/**
 * @route GET /api/admin/users
 * Super Admin list users with bounded pagination and filtering
 */
router.get('/users', adminController.getUsers);

/**
 * @route GET /api/admin/users/:id
 * Super Admin get single user details
 */
router.get('/users/:id', adminController.getUserById);

/**
 * @route POST /api/admin/users
 * Super Admin create user with explicit role and status
 */
router.post('/users', adminController.createUser);

/**
 * @route PUT /api/admin/users/:id
 * Super Admin update user profile details (whitelisted fields only)
 */
router.put('/users/:id', adminController.updateUser);

/**
 * @route PATCH /api/admin/users/:id/role
 * Super Admin update user role with self-lockout protection
 */
router.patch('/users/:id/role', adminController.updateUserRole);

/**
 * @route PATCH /api/admin/users/:id/status
 * Super Admin update user status with self-lockout protection
 */
router.patch('/users/:id/status', adminController.updateUserStatus);

// ==========================================
// PHASE 5.9.6 PROBLEM REVIEW GOVERNANCE QUEUE
// ==========================================

const problemReviewController = require('../controllers/problemReviewController');
const problemQualityController = require('../controllers/problemQualityController');

/**
 * @route GET /api/admin/problem-reviews
 * Review queue dashboard for administrative oversight
 */
router.get('/problem-reviews', problemReviewController.getReviewQueue);

/**
 * @route GET /api/admin/problem-reviews/:id
 * Get single problem review detail from queue
 */
router.get('/problem-reviews/:id', problemReviewController.getReviewDetail);

// ============================================================
// PHASE 5.9.7 EDITORIAL INTELLIGENCE & REVIEW ANALYTICS
// ============================================================

/**
 * @route GET /api/admin/problem-review-analytics
 * Platform-wide problem review analytics & SLA metrics
 */
router.get('/problem-review-analytics', problemQualityController.getPlatformReviewAnalytics);

/**
 * @route GET /api/admin/reviewer-analytics
 * Reviewer workload and turnaround performance metrics
 */
router.get('/reviewer-analytics', problemQualityController.getReviewerAnalytics);

// ============================================================
// PHASE 5.9.10 PLATFORM RELIABILITY & OBSERVABILITY
// ============================================================

const adminSystemController = require('../controllers/adminSystemController');

/**
 * @route GET /api/admin/system/health
 * Deep subsystem health diagnostics (PostgreSQL, Judge, Storage, Node runtime)
 */
router.get('/system/health', adminSystemController.getSystemHealth);

/**
 * @route GET /api/admin/system/metrics
 * Real-time API performance metrics, latency percentiles & hotspots
 */
router.get('/system/metrics', adminSystemController.getSystemMetrics);

/**
 * @route GET /api/admin/system/incidents
 * Paginated platform incidents log
 */
router.get('/system/incidents', adminSystemController.getIncidents);

/**
 * @route PATCH /api/admin/system/incidents/:id/status
 * Update incident status (OPEN, INVESTIGATING, RESOLVED, DISMISSED)
 */
router.patch('/system/incidents/:id/status', adminSystemController.updateIncidentStatus);

module.exports = router;
