const crypto = require('crypto');
const { VALIDATION_LIMITS } = require('../validationConstants');

/**
 * BaseGenerator - Abstract class for constraint-aware test data generators
 */
class BaseGenerator {
  constructor(type) {
    this.type = type;
  }

  /**
   * Validate configuration payload against generator constraints
   * @param {Object} config
   * @throws {Error} If config parameters are invalid
   */
  validateConfig(config = {}) {
    // Abstract method
  }

  /**
   * Generate raw randomized test input string using deterministic PRNG
   * @param {Object} options - { prng, config, testIndex, totalTests }
   * @returns {string} Raw input string for student program
   */
  generate({ prng, config = {}, testIndex = 1, totalTests = 10 }) {
    throw new Error('Method generate() must be implemented by subclass');
  }

  /**
   * Generate a bounded set of deterministic edge-case test inputs
   * @param {Object} options - { config, prng, maxCases }
   * @returns {Array<string>} Array of raw input strings
   */
  generateEdgeCases({ config = {}, prng = null, maxCases = 20 }) {
    return [];
  }

  /**
   * Generate a bounded set of deterministic boundary-case test inputs
   * @param {Object} options - { config, prng, maxCases }
   * @returns {Array<string>} Array of raw input strings
   */
  generateBoundaryCases({ config = {}, prng = null, maxCases = 20 }) {
    return [];
  }

  /**
   * Ensure generated string respects maximum byte size
   * @param {string} inputStr
   * @returns {string}
   */
  enforceSizeLimit(inputStr) {
    const bytes = Buffer.byteLength(inputStr, 'utf8');
    if (bytes > VALIDATION_LIMITS.MAX_GENERATED_INPUT_BYTES) {
      throw new Error(
        `Generated input exceeded max size limit (${bytes} bytes > ${VALIDATION_LIMITS.MAX_GENERATED_INPUT_BYTES} bytes)`
      );
    }
    return inputStr;
  }

  /**
   * Compute normalized SHA-256 fingerprint of input string for cross-suite deduplication
   * @param {string} inputStr
   * @returns {string}
   */
  static computeFingerprint(inputStr) {
    if (!inputStr) return 'empty';
    const normalized = inputStr.trim().replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  }
}

module.exports = BaseGenerator;