const SystemHealthService = require('../services/systemHealthService');
const { testConnection } = require('../config/db');

/**
 * Health & Infrastructure Probes Controller (Phase 5.9.10)
 */

/**
 * Standard health check endpoint (backward compatible)
 * @route GET /api/health
 */
const getHealthStatus = async (req, res) => {
  try {
    const dbStatus = await testConnection();
    if (dbStatus.isConnected) {
      return res.status(200).json({
        server: 'OK',
        database: 'OK',
      });
    }

    return res.status(500).json({
      server: 'OK',
      database: 'FAIL',
      message: 'Database connection failed',
    });
  } catch (error) {
    return res.status(500).json({
      server: 'OK',
      database: 'FAIL',
      message: 'Health check encountered an internal error',
    });
  }
};

/**
 * Kubernetes / Container Liveness Probe (process is running)
 * @route GET /api/health/live
 */
const getLiveness = (req, res) => {
  return res.status(200).json({
    status: 'LIVE',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Kubernetes / Container Readiness Probe (dependencies are operational)
 * @route GET /api/health/ready
 */
const getReadiness = async (req, res) => {
  try {
    const readiness = await SystemHealthService.getReadiness();
    if (readiness.isReady) {
      return res.status(200).json(readiness);
    }
    return res.status(503).json(readiness);
  } catch (error) {
    return res.status(503).json({
      isReady: false,
      status: 'NOT_READY',
      message: 'Readiness probe failed',
      timestamp: new Date().toISOString(),
    });
  }
};

module.exports = {
  getHealthStatus,
  getLiveness,
  getReadiness,
};
