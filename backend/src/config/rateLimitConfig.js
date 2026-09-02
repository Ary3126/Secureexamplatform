/**
 * Centralized Rate Limit Configuration
 * Defines tiered policies, windows, limits, and fail behavior across API categories
 */

const RATE_LIMIT_CONFIG = {
  // 1. High Protection: Authentication & Credentials (Login, Register, Password Reset)
  AUTH: {
    name: 'AUTH',
    windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 10,
    message: 'Too many authentication attempts. Please try again later.',
    failClosed: true, // Strictly block if rate limit store fails
    trackIdentifier: true, // Track both IP and normalized email/username
  },

  // 2. High Protection: Interactive Code Run (Flooding & Compute Abuse Defense)
  RUN_CODE: {
    name: 'RUN_CODE',
    windowMs: parseInt(process.env.RATE_LIMIT_RUN_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_RUN_MAX, 10) || 15,
    message: 'Too many code execution requests. Please wait before running again.',
    failClosed: true,
    maxConcurrentPerUser: parseInt(process.env.MAX_CONCURRENT_RUNS_PER_USER, 10) || 2,
  },

  // 3. High Protection: Code Submission for Official Judge Evaluation
  SUBMIT_CODE: {
    name: 'SUBMIT_CODE',
    windowMs: parseInt(process.env.RATE_LIMIT_SUBMIT_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_SUBMIT_MAX, 10) || 20,
    message: 'Submission rate limit reached. Please wait before submitting again.',
    failClosed: true,
    maxConcurrentPerUser: parseInt(process.env.MAX_CONCURRENT_SUBS_PER_USER, 10) || 2,
  },

  // 4. High Protection: Contest Management & Action Endpoints (Join, Publish, Finalize)
  CONTEST_ACTION: {
    name: 'CONTEST_ACTION',
    windowMs: parseInt(process.env.RATE_LIMIT_CONTEST_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_CONTEST_MAX, 10) || 30,
    message: 'Too many contest action requests. Please slow down.',
    failClosed: false,
  },

  // 5. Medium Protection: Problems, Leaderboards, Profiles, Analytics
  MEDIUM_PROTECTION: {
    name: 'MEDIUM_PROTECTION',
    windowMs: parseInt(process.env.RATE_LIMIT_MEDIUM_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MEDIUM_MAX, 10) || 120,
    message: 'Request rate limit exceeded. Please try again later.',
    failClosed: false, // Fail open to prioritize availability for regular browsing
  },

  // 6. Public Read: Informational & Health APIs
  PUBLIC_READ: {
    name: 'PUBLIC_READ',
    windowMs: parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS, 10) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX, 10) || 300,
    message: 'Too many requests. Please try again later.',
    failClosed: false,
  },

  // Default Request and Payload Configuration
  LIMITS: {
    maxJsonBodyBytes: '512kb',
    maxUrlEncodedBytes: '512kb',
    maxSourceCodeBytes: 64 * 1024, // 64 KB
    apiTimeoutMs: parseInt(process.env.API_REQUEST_TIMEOUT_MS, 10) || 30000, // 30s
    maxPaginationLimit: 100,
    defaultPaginationLimit: 20,
  },

  // Performance and Percentile Benchmark Configuration (Phase 5.8.3)
  PERFORMANCE: {
    minPercentileSampleSize: parseInt(process.env.MIN_PERCENTILE_SAMPLE_SIZE, 10) || 5,
  },
};

module.exports = RATE_LIMIT_CONFIG;
