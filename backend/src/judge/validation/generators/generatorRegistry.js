const IntegerGenerator = require('./integerGenerator');
const IntegerArrayGenerator = require('./integerArrayGenerator');
const { GENERATOR_TYPES } = require('../validationConstants');

/**
 * GeneratorRegistry - Central registry for test data generators
 */
class GeneratorRegistry {
  constructor() {
    this.generators = new Map();

    const integerGen = new IntegerGenerator();
    const arrayGen = new IntegerArrayGenerator();

    this.generators.set(GENERATOR_TYPES.DEFAULT, integerGen);
    this.generators.set(GENERATOR_TYPES.INTEGER, integerGen);
    this.generators.set(GENERATOR_TYPES.RANGE_GENERATOR, integerGen);
    this.generators.set(GENERATOR_TYPES.INTEGER_ARRAY, arrayGen);
    this.generators.set(GENERATOR_TYPES.ARRAY_GENERATOR, arrayGen);
  }

  /**
   * Retrieve generator instance by name
   * @param {string} type
   * @returns {BaseGenerator}
   */
  getGenerator(type) {
    const key = (type || 'default').toLowerCase().trim();
    const gen = this.generators.get(key);
    if (!gen) {
      // Fallback to default integer generator
      return this.generators.get(GENERATOR_TYPES.DEFAULT);
    }
    return gen;
  }

  /**
   * Check if a generator type is registered
   * @param {string} type
   * @returns {boolean}
   */
  hasGenerator(type) {
    const key = (type || '').toLowerCase().trim();
    return this.generators.has(key);
  }
}

const generatorRegistry = new GeneratorRegistry();
module.exports = generatorRegistry;