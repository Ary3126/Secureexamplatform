const CppRunner = require('./cppRunner');
const PythonRunner = require('./pythonRunner');
const JavaRunner = require('./javaRunner');
const DockerRunner = require('./dockerRunner');

/**
 * Language Registry - Manages language runners and supports dynamic extension
 */
class LanguageRegistry {
  constructor() {
    this.runners = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    this.register('cpp', new CppRunner());
    this.register('python', new PythonRunner());
    this.register('java', new JavaRunner());
  }

  /**
   * Register a custom language runner
   * @param {string} language
   * @param {BaseRunner} runnerInstance
   */
  register(language, runnerInstance) {
    this.runners.set(language.toLowerCase(), runnerInstance);
  }

  /**
   * Get runner instance by language
   * @param {string} language
   * @returns {BaseRunner|null}
   */
  getRunner(language) {
    if (!language) return null;
    const baseRunner = this.runners.get(language.toLowerCase());
    if (!baseRunner) return null;

    if (process.env.USE_DOCKER === 'true') {
      return new DockerRunner(language.toLowerCase(), baseRunner);
    }

    return baseRunner;
  }

  /**
   * Check if a language is supported
   * @param {string} language
   * @returns {boolean}
   */
  isSupported(language) {
    if (!language) return false;
    return this.runners.has(language.toLowerCase());
  }

  /**
   * List all supported language keys
   * @returns {Array<string>}
   */
  getSupportedLanguages() {
    return Array.from(this.runners.keys());
  }
}

// Singleton registry instance
const registry = new LanguageRegistry();

module.exports = registry;