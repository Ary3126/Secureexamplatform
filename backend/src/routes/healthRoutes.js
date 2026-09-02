const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

/**
 * Health & Infrastructure Probes Routes (Phase 5.9.10)
 * 
 * Unauthenticated endpoints designed for load balancers, orchestrators, and uptime probes.
 */

// Legacy health check
router.get('/health', healthController.getHealthStatus);

// Liveness probe (process is running)
router.get('/health/live', healthController.getLiveness);

// Readiness probe (database and subsystems are operational)
router.get('/health/ready', healthController.getReadiness);

module.exports = router;
