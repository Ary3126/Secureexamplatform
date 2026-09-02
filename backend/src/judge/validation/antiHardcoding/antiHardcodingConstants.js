/**
 * Anti-Hardcoding & Suspicious Solution Detection Constants (Phase 4B.4)
 */
const SUSPICION_LEVELS = Object.freeze({
  LOW: 'LOW',         // Score 0 - 29: Normal competitive programming code
  MEDIUM: 'MEDIUM',   // Score 30 - 59: Notable patterns, standard verdict preserved
  HIGH: 'HIGH',       // Score 60 - 100: Highly suspicious test-specific hardcoding
});

const SUSPICION_WEIGHTS = Object.freeze({
  EXCESSIVE_BRANCHING: 25,       // Chained exact equality branches on input values
  HARDCODED_MAP: 35,             // Large dictionary/map literals matching test pairs
  CONSTANT_CORRELATION: 20,      // High proportion of constants matching known test inputs
  UNKNOWN_TEST_FAILURE: 40,      // Passes known standard tests, fails all generated unknown tests
  PERTURBATION_FAILURE: 25,      // Output breaks when input is slightly perturbed
});

const ANTI_HARDCODING_LIMITS = Object.freeze({
  MAX_SOURCE_ANALYSIS_BYTES: 128 * 1024, // 128 KB max source analyzed
  MAX_EXTRA_VALIDATION_TESTS: 5,        // Extra tests triggered for HIGH suspicion
  MAX_ANALYSIS_TIME_MS: 1000,            // 1s max static analysis timeout
  LOW_THRESHOLD: 30,
  HIGH_THRESHOLD: 60,
});

module.exports = {
  SUSPICION_LEVELS,
  SUSPICION_WEIGHTS,
  ANTI_HARDCODING_LIMITS,
};