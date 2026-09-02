const BaseGenerator = require('./baseGenerator');
const { VALIDATION_LIMITS } = require('../validationConstants');

/**
 * IntegerGenerator - Deterministic, constraint-aware integer test generator with edge & boundary suites
 */
class IntegerGenerator extends BaseGenerator {
  constructor() {
    super('integer');
  }

  validateConfig(config = {}) {
    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const count = config.count !== undefined ? Number(config.count) : 2;

    if (isNaN(minVal) || isNaN(maxVal)) {
      throw new Error('minValue and maxValue must be valid numbers');
    }
    if (minVal > maxVal) {
      throw new Error(`minValue (${minVal}) cannot exceed maxValue (${maxVal})`);
    }
    if (minVal < VALIDATION_LIMITS.MIN_INTEGER_VAL || maxVal > VALIDATION_LIMITS.MAX_INTEGER_VAL) {
      throw new Error(
        `Values must be within [${VALIDATION_LIMITS.MIN_INTEGER_VAL}, ${VALIDATION_LIMITS.MAX_INTEGER_VAL}]`
      );
    }
    if (count < 1 || count > 100) {
      throw new Error('Integer count must be between 1 and 100');
    }
  }

  generate({ prng, config = {}, testIndex = 1, totalTests = 10 }) {
    this.validateConfig(config);

    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const count = config.count !== undefined ? Number(config.count) : 2;
    const delimiter = config.delimiter || ' ';

    const values = [];

    for (let c = 0; c < count; c++) {
      const slot = (testIndex + c) % 6;
      let val;

      switch (slot) {
        case 1:
          val = minVal;
          break;
        case 2:
          val = maxVal;
          break;
        case 3:
          val = (minVal <= 0 && maxVal >= 0) ? 0 : prng.nextInt(minVal, maxVal);
          break;
        case 4:
          val = (minVal < 0) ? prng.nextInt(minVal, Math.min(-1, maxVal)) : prng.nextInt(minVal, maxVal);
          break;
        case 5:
          const smallMax = Math.min(100, maxVal);
          const smallMin = Math.max(1, minVal);
          val = (smallMin <= smallMax) ? prng.nextInt(smallMin, smallMax) : prng.nextInt(minVal, maxVal);
          break;
        default:
          val = prng.nextInt(minVal, maxVal);
          break;
      }

      values.push(val);
    }

    const output = values.join(delimiter) + '\n';
    return this.enforceSizeLimit(output);
  }

  /**
   * Generate controlled edge cases (min, min+1, -1, 0, 1, max-1, max) respecting constraints
   */
  generateEdgeCases({ config = {}, prng = null, maxCases = 20 }) {
    this.validateConfig(config);

    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const count = config.count !== undefined ? Number(config.count) : 2;
    const delimiter = config.delimiter || ' ';

    // Filter valid candidate single values within [minVal, maxVal]
    const candidates = [];
    const addIfValid = (v) => {
      if (v >= minVal && v <= maxVal && !candidates.includes(v)) {
        candidates.push(v);
      }
    };

    addIfValid(minVal);
    if (minVal + 1 <= maxVal) addIfValid(minVal + 1);
    addIfValid(-1);
    addIfValid(0);
    addIfValid(1);
    if (maxVal - 1 >= minVal) addIfValid(maxVal - 1);
    addIfValid(maxVal);

    const cases = [];

    if (count === 1) {
      for (const c of candidates) {
        cases.push(`${c}\n`);
      }
    } else {
      // Create high-value edge pairs
      const edgePairs = [
        [minVal, maxVal],
        [maxVal, minVal],
        [minVal, minVal],
        [maxVal, maxVal],
      ];

      if (candidates.includes(0)) {
        edgePairs.push([0, 0], [minVal, 0], [0, maxVal], [0, minVal], [maxVal, 0]);
      }
      if (candidates.includes(-1) && candidates.includes(1)) {
        edgePairs.push([-1, 1], [1, -1], [-1, -1], [1, 1]);
      }
      if (candidates.includes(minVal + 1)) {
        edgePairs.push([minVal, minVal + 1], [minVal + 1, minVal]);
      }
      if (candidates.includes(maxVal - 1)) {
        edgePairs.push([maxVal - 1, maxVal], [maxVal, maxVal - 1]);
      }

      for (const pair of edgePairs) {
        let vals = [...pair];
        // If count > 2, pad with 0 or minVal
        while (vals.length < count) {
          vals.push(candidates.includes(0) ? 0 : minVal);
        }
        cases.push(vals.slice(0, count).join(delimiter) + '\n');
      }
    }

    return cases.slice(0, maxCases).map((c) => this.enforceSizeLimit(c));
  }

  /**
   * Generate boundary cases strictly targeting extreme domain limits
   */
  generateBoundaryCases({ config = {}, prng = null, maxCases = 20 }) {
    this.validateConfig(config);

    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const count = config.count !== undefined ? Number(config.count) : 2;
    const delimiter = config.delimiter || ' ';

    const cases = [];

    if (count === 1) {
      cases.push(`${minVal}\n`, `${maxVal}\n`);
      if (minVal <= 0 && maxVal >= 0) cases.push(`0\n`);
    } else {
      const boundaryPairs = [
        [minVal, minVal],
        [maxVal, maxVal],
        [minVal, maxVal],
        [maxVal, minVal],
      ];

      if (minVal <= 0 && maxVal >= 0) {
        boundaryPairs.push([0, 0], [minVal, 0], [maxVal, 0], [0, minVal], [0, maxVal]);
      }

      for (const pair of boundaryPairs) {
        let vals = [...pair];
        while (vals.length < count) {
          vals.push(pair[0]);
        }
        cases.push(vals.slice(0, count).join(delimiter) + '\n');
      }
    }

    return cases.slice(0, maxCases).map((c) => this.enforceSizeLimit(c));
  }
}

module.exports = IntegerGenerator;