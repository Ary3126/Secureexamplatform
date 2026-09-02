const SecurityLogger = require('../judge/security/securityLogger');

// In-memory sliding window rate tracker
const requestLogs = new Map();

/**
 * Clean expired entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of requestLogs.entries()) {
    const valid = timestamps.filter((t) => now - t < 60000);
    if (valid.length === 0) {
      requestLogs.delete(key);
    } else {
      requestLogs.set(key, valid);
    }
  }
}, 30000);

/**
 * Submission Rate Limiter Middleware
 * Allows maxRequests within windowMs per user (or client IP)
 */
function createSubmissionRateLimiter({ windowMs = 10000, maxRequests = 10 } = {}) {
  return (req, res, next) => {
    // In test environment, allow high throughput unless explicitly testing rate limiter
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const key = (req.user && req.user.id) ? `user_${req.user.id}` : `ip_${req.ip || req.connection.remoteAddress}`;
    const now = Date.now();

    const timestamps = requestLogs.get(key) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);

    if (recent.length >= maxRequests) {
      SecurityLogger.warnViolation('RATE_LIMIT_EXCEEDED', {
        key,
        requestCount: recent.length,
        limit: maxRequests,
      });

      const retryAfterSeconds = Math.ceil((recent[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds > 0 ? retryAfterSeconds : 1);

      return res.status(429).json({
        status: 'error',
        statusCode: 429,
        message: `Too many submissions. Rate limit exceeded. Please wait ${retryAfterSeconds > 0 ? retryAfterSeconds : 1}s before retrying.`,
      });
    }

    recent.push(now);
    requestLogs.set(key, recent);
    next();
  };
}

module.exports = {
  createSubmissionRateLimiter,
  submissionRateLimiter: createSubmissionRateLimiter({ windowMs: 10000, maxRequests: 10 }),
};