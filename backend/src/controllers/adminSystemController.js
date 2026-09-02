const SystemHealthService = require('../services/systemHealthService');
const metricsService = require('../services/metricsService');
const IncidentModel = require('../models/incidentModel');

/**
 * Super Admin System Reliability & Observability Controller (Phase 5.9.10)
 * Strictly restricted to Super Admin role.
 */

/**
 * Deep Subsystem Health Diagnostics
 * @route GET /api/admin/system/health
 */
const getSystemHealth = async (req, res, next) => {
  try {
    const health = await SystemHealthService.getFullHealthDiagnostics();
    return res.status(200).json({
      status: 'success',
      data: health,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Real-time API Performance Metrics & Latency Percentiles
 * @route GET /api/admin/system/metrics
 */
const getSystemMetrics = async (req, res, next) => {
  try {
    const timeWindowMs = parseInt(req.query.windowMs, 10) || 3600000;
    const summary = metricsService.getMetricsSummary(timeWindowMs);
    return res.status(200).json({
      status: 'success',
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Paginated Platform Incidents Log
 * @route GET /api/admin/system/incidents
 */
const getIncidents = async (req, res, next) => {
  try {
    const { category, severity, status, search, page, limit } = req.query;
    const result = await IncidentModel.findIncidents({
      category,
      severity,
      status,
      search,
      page,
      limit,
    });
    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update Incident Status
 * @route PATCH /api/admin/system/incidents/:id/status
 */
const updateIncidentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: `Status is invalid. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updated = await IncidentModel.updateStatus(id, status);
    if (!updated) {
      return res.status(404).json({
        status: 'error',
        message: `Incident #${id} not found`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: updated,
      message: `Incident status updated to ${status}`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSystemHealth,
  getSystemMetrics,
  getIncidents,
  updateIncidentStatus,
};
