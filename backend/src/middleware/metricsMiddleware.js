const metricsService = require('../services/metricsService');

/**
 * Performance & Request Metrics Middleware (Phase 5.9.10)
 * 
 * Captures request latency and status codes using process.hrtime.bigint() for nanosecond precision.
 * Automatically classifies status codes and feeds metricsService on response finish.
 */
const metricsMiddleware = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    try {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1e6;

      const endpoint = req.baseUrl ? `${req.baseUrl}${req.path}` : (req.originalUrl || req.url);
      const role = req.user ? req.user.role : 'anonymous';
      const errorCategory = res.locals.errorCategory || (res.statusCode >= 400 ? (res.locals.errorCode || `HTTP_${res.statusCode}`) : null);

      metricsService.recordRequest({
        endpoint,
        method: req.method,
        statusCode: res.statusCode,
        durationMs,
        role,
        errorCategory,
      });
    } catch (err) {
      // Never crash the request pipeline if metrics recording encounters an unexpected issue
    }
  });

  next();
};

module.exports = {
  metricsMiddleware,
};
