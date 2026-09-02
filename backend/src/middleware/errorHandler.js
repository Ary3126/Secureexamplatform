const config = require('../config/env');
const IncidentModel = require('../models/incidentModel');

/**
 * 404 Not Found Middleware for unhandled routes
 */
const notFoundHandler = (req, res, next) => {
  const requestId = req.id || null;
  res.locals.errorCategory = 'NOT_FOUND';

  res.status(404).json({
    status: 'error',
    statusCode: 404,
    error: 'NOT_FOUND',
    message: 'Endpoint not found: ' + req.method + ' ' + req.originalUrl,
    requestId,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Global centralized error-handling middleware (Phase 5.9.10)
 * Strictly classifies errors, embeds correlation request IDs, and registers severe incidents.
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
  let errorCategory = err.code || err.error;

  // Map PostgreSQL error codes
  if (err.code === '22P02') {
    statusCode = 400;
    errorCategory = 'VALIDATION_ERROR';
    err.message = 'Invalid resource identifier format';
  } else if (err.code === '23505') {
    statusCode = 409;
    errorCategory = 'CONFLICT';
    err.message = 'Resource conflict: A record with these unique details already exists';
  } else if (err.code === 'ECONNREFUSED' || err.code === '57P01' || err.code === '08006' || err.code === '08001') {
    statusCode = 500;
    errorCategory = 'DATABASE_ERROR';
    err.message = 'Database connection failure';
  }

  // Derive standardized error category if not set
  if (!errorCategory) {
    if (statusCode === 400 || statusCode === 422) errorCategory = 'VALIDATION_ERROR';
    else if (statusCode === 401) errorCategory = 'AUTHENTICATION_ERROR';
    else if (statusCode === 403) errorCategory = 'AUTHORIZATION_ERROR';
    else if (statusCode === 404) errorCategory = 'NOT_FOUND';
    else if (statusCode === 409) errorCategory = 'CONFLICT';
    else if (statusCode === 429) errorCategory = 'RATE_LIMIT';
    else errorCategory = 'INTERNAL_ERROR';
  }

  res.locals.errorCategory = errorCategory;
  const requestId = req.id || null;

  // Internal server error logging
  if (config.nodeEnv !== 'test') {
    console.error(`[SERVER ERROR] [${requestId || 'no-id'}] ${req.method} ${req.originalUrl}:`, {
      message: err.message,
      statusCode,
      errorCategory,
      ...(config.nodeEnv === 'development' && { stack: err.stack }),
    });
  }

  // Determine safe client-facing message
  let clientMessage = err.message;
  if (statusCode === 500 && config.nodeEnv === 'production') {
    clientMessage = 'Internal Server Error';
  } else if (!err.isOperational && statusCode === 500) {
    clientMessage = config.nodeEnv === 'development' ? err.message : 'Internal Server Error';
  }

  // Strip connection strings or database credentials
  if (typeof clientMessage === 'string') {
    clientMessage = clientMessage
      .replace(/postgres:\/\/[^@]+@/gi, 'postgres://[REDACTED]@')
      .replace(/password=[^\s]+/gi, 'password=[REDACTED]');
  }

  // Asynchronously record severe internal server errors in system_incidents
  if (statusCode >= 500 && config.nodeEnv !== 'test') {
    IncidentModel.createIncident({
      category: errorCategory,
      severity: statusCode >= 500 ? 'HIGH' : 'MEDIUM',
      endpoint: req.originalUrl || req.url,
      requestId,
      message: err.message || 'Unhandled internal error',
      details: {
        statusCode,
        method: req.method,
        actorId: req.user?.id || null,
        actorRole: req.user?.role || null,
      },
    }).catch(() => {
      // Non-blocking
    });
  }

  const response = {
    status: 'error',
    statusCode,
    error: errorCategory,
    message: clientMessage,
    requestId,
    timestamp: new Date().toISOString(),
  };

  if (config.nodeEnv === 'development' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
