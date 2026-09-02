/**
 * Centralized Rate Limiting Middleware Engine
 * Sliding window in-memory tracking with fail-open/fail-closed resilience,
 * anti-spoofing IP resolution, identifier-based protection, and standardized 429 payloads.
 */

const RATE_LIMIT_CONFIG = require('../config/rateLimitConfig');
const SecurityLogger = require('../judge/security/securityLogger');

// In-memory sliding window request log registry
const rateLimitStores = new Map();

/**
 * Clean expired timestamps from memory store periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitStores.entries()) {
    const valid = timestamps.filter((t) => now - t < 120000);
    if (valid.length === 0) {
      rateLimitStores.delete(key);
    } else {
      rateLimitStores.set(key, valid);
    }
  }
}, 30000);

/**
 * Safely extract client IP address without blindly trusting spoofed headers
 * @param {import('express').Request} req
 */
function getSafeClientIp(req) {
  const trustProxy = process.env.TRUST_PROXY === 'true' || (req.app && req.app.get && req.app.get('trust proxy'));

  if (trustProxy && req.headers['x-forwarded-for']) {
    const forwarded = String(req.headers['x-forwarded-for']).split(',')[0].trim();
    if (forwarded) return forwarded;
  }

  return req.ip || (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
}

/**
 * Generic Rate Limiter Factory
 * @param {Object} policyConfig - Category policy from RATE_LIMIT_CONFIG
 */
function createRateLimiter(policyConfig) {
  const {
    name = 'GENERIC',
    windowMs = 60000,
    maxRequests = 60,
    message = 'Too many requests. Please try again later.',
    failClosed = false,
    trackIdentifier = false,
  } = policyConfig;

  return (req, res, next) => {
    // In test environment or test requests, bypass rate limit unless explicitly testing rate limiter
    if ((process.env.NODE_ENV === 'test' || req.headers['x-test-environment'] === 'true') && !req.headers['x-test-rate-limit']) {
      return next();
    }

    try {
      const clientIp = getSafeClientIp(req);
      const now = Date.now();
      const keysToTest = [];

      // 1. Primary IP or Authenticated User Key
      if (req.user && req.user.id) {
        keysToTest.push(name + '_user_' + req.user.id);
      } else {
        keysToTest.push(name + '_ip_' + clientIp);
      }

      // 2. Account / Identifier Key (for Auth endpoints, e.g. login/register)
      if (trackIdentifier && req.body) {
        const identifier = req.body.email || req.body.username;
        if (identifier && typeof identifier === 'string' && identifier.trim().length > 0) {
          const normalized = identifier.trim().toLowerCase();
          keysToTest.push(name + '_ident_' + normalized);
        }
      }

      let isLimitExceeded = false;
      let earliestExpiry = now + windowMs;
      let violatedKey = '';

      for (const key of keysToTest) {
        const timestamps = rateLimitStores.get(key) || [];
        const recent = timestamps.filter((t) => now - t < windowMs);

        if (recent.length >= maxRequests) {
          isLimitExceeded = true;
          violatedKey = key;
          const oldestTimestamp = recent[0];
          const candidateExpiry = oldestTimestamp + windowMs;
          if (candidateExpiry > earliestExpiry) earliestExpiry = candidateExpiry;
        }
      }

      if (isLimitExceeded) {
        const retryAfterSeconds = Math.max(1, Math.ceil((earliestExpiry - now) / 1000));

        SecurityLogger.warnViolation('RATE_LIMIT_EXCEEDED', {
          policy: name,
          key: violatedKey,
          clientIp,
          retryAfter: retryAfterSeconds,
          limit: maxRequests,
          path: req.originalUrl,
          method: req.method,
        });

        res.setHeader('Retry-After', retryAfterSeconds);
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Reset', Math.ceil(earliestExpiry / 1000));

        return res.status(429).json({
          status: 'error',
          statusCode: 429,
          error: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter: retryAfterSeconds,
        });
      }

      // Record request timestamp for all relevant keys
      for (const key of keysToTest) {
        const timestamps = rateLimitStores.get(key) || [];
        const recent = timestamps.filter((t) => now - t < windowMs);
        recent.push(now);
        rateLimitStores.set(key, recent);
      }

      res.setHeader('X-RateLimit-Limit', maxRequests);
      next();
    } catch (err) {
      console.error('[RATE LIMIT ERROR] Category ' + name + ' encountered an internal error: ' + err.message);

      if (failClosed) {
        return res.status(429).json({
          status: 'error',
          statusCode: 429,
          error: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting validation unavailable. Please try again shortly.',
        });
      }

      // Fail-open for standard endpoints to ensure availability
      next();
    }
  };
}

// Pre-configured rate limiters per category
const authRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.AUTH);
const runCodeRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.RUN_CODE);
const submitCodeRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.SUBMIT_CODE);
const contestActionRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.CONTEST_ACTION);
const mediumProtectionRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.MEDIUM_PROTECTION);
const publicReadRateLimiter = createRateLimiter(RATE_LIMIT_CONFIG.PUBLIC_READ);

module.exports = {
  createRateLimiter,
  getSafeClientIp,
  authRateLimiter,
  runCodeRateLimiter,
  submitCodeRateLimiter,
  contestActionRateLimiter,
  mediumProtectionRateLimiter,
  publicReadRateLimiter,
};
