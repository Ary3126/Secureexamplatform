const crypto = require('crypto');

/**
 * Deterministic PRNG & Seed Generator for Reproducible Randomized Testing
 */
class SeededPRNG {
  /**
   * Initialize PRNG with a 32-bit unsigned integer seed
   * @param {number|string} seed
   */
  constructor(seed) {
    if (typeof seed === 'string') {
      this.state = SeededPRNG.hashStringToSeed(seed);
    } else {
      this.state = (seed >>> 0) || 123456789;
    }
  }

  /**
   * Mulberry32 32-bit PRNG generator step
   * @returns {number} Float in range [0, 1)
   */
  nextFloat() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Return a pseudo-random integer between min and max (inclusive)
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const range = high - low + 1;
    return low + Math.floor(this.nextFloat() * range);
  }

  /**
   * Return a randomly chosen element from an array
   * @param {Array} array
   * @returns {*}
   */
  choice(array) {
    if (!array || array.length === 0) return null;
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * In-place deterministic Fisher-Yates shuffle
   * @param {Array} array
   * @returns {Array}
   */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Hash arbitrary strings (e.g. problemId + submissionId + testIndex) to a stable 32-bit uint seed
   * @param {string} str
   * @returns {number} 32-bit uint seed
   */
  static hashStringToSeed(str) {
    const hash = crypto.createHash('sha256').update(String(str)).digest();
    return hash.readUInt32BE(0);
  }

  /**
   * Generate reproducible seed for a specific problem test case run
   * @param {Object} param0 - { problemId, submissionId, testIndex, salt }
   * @returns {number} 32-bit uint seed
   */
  static deriveTestSeed({ problemId, submissionId = 'val', testIndex = 1, salt = 'phase4b2' }) {
    const compositeKey = `prob:${problemId}::sub:${submissionId}::idx:${testIndex}::salt:${salt}`;
    return SeededPRNG.hashStringToSeed(compositeKey);
  }
}

module.exports = SeededPRNG;