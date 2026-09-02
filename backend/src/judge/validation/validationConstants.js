/**
 * Validation Categories and Constants for Phase 4B
 */
const VALIDATION_MODES = Object.freeze({
  STANDARD: 'STANDARD',
  EDGE: 'EDGE',
  BOUNDARY: 'BOUNDARY',
  RANDOM: 'RANDOM',
});

const GENERATOR_TYPES = Object.freeze({
  DEFAULT: 'default',
  INTEGER: 'integer',
  INTEGER_ARRAY: 'integer_array',
  RANGE_GENERATOR: 'range_generator',
  ARRAY_GENERATOR: 'array_generator',
  STRING_GENERATOR: 'string_generator',
  MATRIX_GENERATOR: 'matrix_generator',
  GRAPH_GENERATOR: 'graph_generator',
  TREE_GENERATOR: 'tree_generator',
  CUSTOM_SCRIPT: 'custom_script',
  REGEX_PATTERN: 'regex_pattern',
});

const VALIDATION_LIMITS = Object.freeze({
  MIN_RANDOM_TESTS: 1,
  MAX_RANDOM_TESTS: 50,
  DEFAULT_RANDOM_TESTS: 10,
  MAX_EDGE_TESTS: 20,
  MAX_BOUNDARY_TESTS: 20,
  MAX_TOTAL_VALIDATION_TESTS: 70,
  MAX_GENERATED_INPUT_BYTES: 256 * 1024, // 256 KB max single test input
  MAX_TOTAL_GENERATED_BYTES: 5 * 1024 * 1024, // 5 MB max total per validation run
  GENERATION_TIMEOUT_MS: 5000, // 5 seconds max total generation time
  MAX_ARRAY_SIZE: 100000, // Max 100k elements
  MIN_INTEGER_VAL: -1000000000, // -10^9
  MAX_INTEGER_VAL: 1000000000,  // 10^9
});

module.exports = {
  VALIDATION_MODES,
  GENERATOR_TYPES,
  VALIDATION_LIMITS,
};