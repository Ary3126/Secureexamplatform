/**
 * Request Timeout Middleware
 * Protects server resources by timing out hanging HTTP requests
 */

const RATE_LIMIT_CONFIG = require('../config/rateLimitConfig');

function createTimeoutMiddleware(timeoutMs = RATE_LIMIT_CONFIG.LIMITS.apiTimeoutMs) {
  return (req, res, next) => {
    // Skip timeout in testing mode unless explicitly configured
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-timeout']) {
      return next();
    }

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          status: 'error',
          statusCode: 504,
          error: 'GATEWAY_TIMEOUT',
          message: 'Request timed out waiting for server to respond. Please try again.',
        });
      }
    }, timeoutMs);

    // Clear timeout on response completion or close
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = {
  createTimeoutMiddleware,
  timeoutMiddleware: createTimeoutMiddleware(),
};
