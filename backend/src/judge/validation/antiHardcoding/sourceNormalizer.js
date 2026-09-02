const { ANTI_HARDCODING_LIMITS } = require('./antiHardcodingConstants');

/**
 * SourceNormalizer - Safely sanitizes and normalizes source code for AST-free structural analysis
 */
class SourceNormalizer {
  /**
   * Normalize source code: strip comments and normalize whitespace
   * @param {string} sourceCode
   * @param {string} language
   * @returns {string} Cleaned normalized source representation
   */
  static normalize(sourceCode = '', language = 'python') {
    if (!sourceCode || typeof sourceCode !== 'string') return '';

    // Enforce size limit to prevent regex DOS
    const safeSource = sourceCode.slice(0, ANTI_HARDCODING_LIMITS.MAX_SOURCE_ANALYSIS_BYTES);
    const lang = (language || '').toLowerCase();

    let cleaned = safeSource;

    if (lang === 'python') {
      // Strip Python triple-quoted docstrings/comments
      cleaned = cleaned.replace(/"""[\s\S]*?"""/g, ' ');
      cleaned = cleaned.replace(/'''[\s\S]*?'''/g, ' ');
      // Strip Python single line comments
      cleaned = cleaned.replace(/#[^\r\n]*/g, ' ');
    } else {
      // C++ / Java / generic C-style
      // Strip block comments /* ... */
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ' ');
      // Strip line comments // ...
      cleaned = cleaned.replace(/\/\/[^\r\n]*/g, ' ');
    }

    // Normalize multiple whitespaces and newlines
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/\r?\n+/g, '\n');

    return cleaned.trim();
  }

  /**
   * Extract all numeric integer and float literals from source code
   * @param {string} normalizedSource
   * @returns {Array<number>}
   */
  static extractNumericLiterals(normalizedSource = '') {
    const matches = normalizedSource.match(/-?\b\d+(\.\d+)?\b/g) || [];
    return matches.map(Number).filter((n) => !isNaN(n));
  }
}

module.exports = SourceNormalizer;