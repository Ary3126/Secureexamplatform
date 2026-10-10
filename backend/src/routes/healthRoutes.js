const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');
const { publicReadRateLimiter } = require('../middleware/rateLimitMiddleware');

/**
 * Health & Infrastructure Probes Routes (Phase 5.9.10 + Phase 7.5.10.8)
 * 
 * Unauthenticated endpoints designed for load balancers, orchestrators, and uptime probes.
 * Protected with publicReadRateLimiter to prevent resource exhaustion from probe floods.
 */

// Legacy health check
router.get('/health', publicReadRateLimiter, healthController.getHealthStatus);

// Liveness probe (process is running)
router.get('/health/live', publicReadRateLimiter, healthController.getLiveness);

// Readiness probe (database and subsystems are operational)
router.get('/health/ready', publicReadRateLimiter, healthController.getReadiness);

module.exports = router;
