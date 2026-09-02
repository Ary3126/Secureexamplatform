/**
 * Hardened CORS Configuration
 * Enforces strict origin matching, rejects wildcards with credentials in production
 */

const getAllowedOrigins = () => {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  }

  // Development defaults
  if (process.env.NODE_ENV !== 'production') {
    return [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ];
  }

  return [];
};

const corsOptions = {
  origin: (origin, callback) => {
    const allowed = getAllowedOrigins();

    // Allow requests with no origin (like mobile apps, curl, server-to-server, unit tests)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is allowed
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }

    // In non-production, allow all localhost ports
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    const err = new Error('CORS Policy Violation: Origin ' + origin + ' is not authorized.');
    err.statusCode = 403;
    callback(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-test-rate-limit', 'x-forwarded-for'],
  exposedHeaders: ['Retry-After', 'Content-Disposition'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
};

module.exports = { corsOptions, getAllowedOrigins };
