const BaseGenerator = require('./baseGenerator');
const { VALIDATION_LIMITS } = require('../validationConstants');

/**
 * IntegerArrayGenerator - Generates constraint-aware, diverse integer arrays with edge & boundary suites
 */
class IntegerArrayGenerator extends BaseGenerator {
  constructor() {
    super('integer_array');
  }

  validateConfig(config = {}) {
    const minSize = config.minSize !== undefined ? Number(config.minSize) : 1;
    const maxSize = config.maxSize !== undefined ? Number(config.maxSize) : 20;
    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;

    if (isNaN(minSize) || isNaN(maxSize) || isNaN(minVal) || isNaN(maxVal)) {
      throw new Error('minSize, maxSize, minValue, and maxValue must be valid numbers');
    }
    if (minSize < 0) {
      throw new Error('minSize cannot be negative');
    }
    if (minSize > maxSize) {
      throw new Error(`minSize (${minSize}) cannot exceed maxSize (${maxSize})`);
    }
    if (maxSize > VALIDATION_LIMITS.MAX_ARRAY_SIZE) {
      throw new Error(`maxSize cannot exceed system limit of ${VALIDATION_LIMITS.MAX_ARRAY_SIZE}`);
    }
    if (minVal > maxVal) {
      throw new Error(`minValue (${minVal}) cannot exceed maxValue (${maxVal})`);
    }
    if (minVal < VALIDATION_LIMITS.MIN_INTEGER_VAL || maxVal > VALIDATION_LIMITS.MAX_INTEGER_VAL) {
      throw new Error(
        `Values must be within [${VALIDATION_LIMITS.MIN_INTEGER_VAL}, ${VALIDATION_LIMITS.MAX_INTEGER_VAL}]`
      );
    }
  }

  formatArray(elements, includeLengthHeader = false, delimiter = ' ') {
    let output = '';
    if (includeLengthHeader) {
      output += `${elements.length}\n`;
    }
    output += elements.join(delimiter) + '\n';
    return this.enforceSizeLimit(output);
  }

  generate({ prng, config = {}, testIndex = 1, totalTests = 10 }) {
    this.validateConfig(config);

    const minSize = config.minSize !== undefined ? Number(config.minSize) : 1;
    const maxSize = config.maxSize !== undefined ? Number(config.maxSize) : 20;
    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const includeLengthHeader = Boolean(config.includeLengthHeader);
    const delimiter = config.delimiter || ' ';

    let size;
    const slot = testIndex % 6;

    if (testIndex === 1) {
      size = minSize;
    } else if (testIndex === 2) {
      size = Math.min(maxSize, 2000);
    } else if (slot === 3) {
      size = Math.max(minSize, Math.floor((minSize + maxSize) / 2));
    } else {
      size = prng.nextInt(minSize, Math.min(maxSize, 200));
    }

    const elements = [];

    if (slot === 4) {
      const commonVal = (minVal <= 0 && maxVal >= 0) ? 0 : minVal;
      for (let i = 0; i < size; i++) elements.push(commonVal);
    } else if (slot === 5 && minVal < 0) {
      for (let i = 0; i < size; i++) elements.push(prng.nextInt(minVal, Math.min(-1, maxVal)));
    } else {
      for (let i = 0; i < size; i++) {
        if (i === 0) elements.push(minVal);
        else if (i === 1 && size > 1) elements.push(maxVal);
        else if (i === 2 && size > 2 && minVal <= 0 && maxVal >= 0) elements.push(0);
        else elements.push(prng.nextInt(minVal, maxVal));
      }
    }

    if (slot === 1 && elements.length > 1) {
      elements.sort((a, b) => a - b);
    } else if (slot === 2 && elements.length > 1) {
      elements.sort((a, b) => b - a);
    }

    return this.formatArray(elements, includeLengthHeader, delimiter);
  }

  /**
   * Generate structural and value edge cases for integer array problems
   */
  generateEdgeCases({ config = {}, prng = null, maxCases = 20 }) {
    this.validateConfig(config);

    const minSize = config.minSize !== undefined ? Number(config.minSize) : 1;
    const maxSize = config.maxSize !== undefined ? Number(config.maxSize) : 20;
    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const includeLengthHeader = Boolean(config.includeLengthHeader);
    const delimiter = config.delimiter || ' ';

    const cases = [];

    // Helper to push if size is valid
    const addArrayCase = (arr) => {
      if (arr.length >= minSize && arr.length <= maxSize) {
        cases.push(this.formatArray(arr, includeLengthHeader, delimiter));
      }
    };

    // 1. Single-element arrays
    addArrayCase([minVal]);
    addArrayCase([maxVal]);
    if (minVal <= 0 && maxVal >= 0) addArrayCase([0]);
    if (minVal <= 1 && maxVal >= 1) addArrayCase([1]);

    // 2. Minimum size array (if minSize > 1)
    if (minSize > 1) {
      addArrayCase(Array(minSize).fill(minVal));
      addArrayCase(Array(minSize).fill(maxVal));
    }

    // 3. Small boundary array (min, max)
    if (minSize <= 2 && maxSize >= 2) {
      addArrayCase([minVal, maxVal]);
      addArrayCase([maxVal, minVal]);
    }

    // 4. All zero array
    const sampleMidSize = Math.max(minSize, Math.min(maxSize, 5));
    if (minVal <= 0 && maxVal >= 0) {
      addArrayCase(Array(sampleMidSize).fill(0));
    }

    // 5. All equal duplicate values
    addArrayCase(Array(sampleMidSize).fill(minVal));
    addArrayCase(Array(sampleMidSize).fill(maxVal));

    // 6. Alternating min and max values
    const altArr = [];
    for (let i = 0; i < sampleMidSize; i++) {
      altArr.push(i % 2 === 0 ? minVal : maxVal);
    }
    addArrayCase(altArr);

    // 7. One extreme value among zeros
    if (sampleMidSize >= 3 && minVal <= 0 && maxVal >= 0) {
      const extremeArr = Array(sampleMidSize).fill(0);
      extremeArr[Math.floor(sampleMidSize / 2)] = maxVal;
      addArrayCase(extremeArr);

      const extremeArrMin = Array(sampleMidSize).fill(0);
      extremeArrMin[Math.floor(sampleMidSize / 2)] = minVal;
      addArrayCase(extremeArrMin);
    }

    // 8. Sorted ascending and sorted descending
    if (sampleMidSize >= 3) {
      const sortedAsc = [];
      const step = Math.floor((maxVal - minVal) / sampleMidSize) || 1;
      for (let i = 0; i < sampleMidSize; i++) {
        sortedAsc.push(Math.min(maxVal, minVal + i * step));
      }
      addArrayCase(sortedAsc);
      addArrayCase([...sortedAsc].reverse());
    }

    return cases.slice(0, maxCases);
  }

  /**
   * Generate boundary cases strictly targeting extreme domain limits for integer arrays
   */
  generateBoundaryCases({ config = {}, prng = null, maxCases = 20 }) {
    this.validateConfig(config);

    const minSize = config.minSize !== undefined ? Number(config.minSize) : 1;
    const maxSize = config.maxSize !== undefined ? Number(config.maxSize) : 20;
    const minVal = config.minValue !== undefined ? Number(config.minValue) : -1000;
    const maxVal = config.maxValue !== undefined ? Number(config.maxValue) : 1000;
    const includeLengthHeader = Boolean(config.includeLengthHeader);
    const delimiter = config.delimiter || ' ';

    const cases = [];
    const addArrayCase = (arr) => {
      cases.push(this.formatArray(arr, includeLengthHeader, delimiter));
    };

    // 1. Min Size + Min Values
    addArrayCase(Array(minSize).fill(minVal));

    // 2. Min Size + Max Values
    addArrayCase(Array(minSize).fill(maxVal));

    // 3. Max Size (bounded safely to prevent excessive memory/timeouts)
    const boundedMaxSize = Math.min(maxSize, 2000);

    // Max Size + All Min Values
    addArrayCase(Array(boundedMaxSize).fill(minVal));

    // Max Size + All Max Values
    addArrayCase(Array(boundedMaxSize).fill(maxVal));

    // Max Size + Alternating Boundary Values
    const maxAlt = [];
    for (let i = 0; i < boundedMaxSize; i++) {
      maxAlt.push(i % 2 === 0 ? minVal : maxVal);
    }
    addArrayCase(maxAlt);

    // Max Size + All Zeros (if zero is in range)
    if (minVal <= 0 && maxVal >= 0) {
      addArrayCase(Array(boundedMaxSize).fill(0));
    }

    return cases.slice(0, maxCases);
  }
}

module.exports = IntegerArrayGenerator;