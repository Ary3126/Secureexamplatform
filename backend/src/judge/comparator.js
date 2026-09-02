/**
 * Output Comparator - Compares user program output against expected test case output
 */
class OutputComparator {
  /**
   * Normalize text by standardizing line endings and trimming trailing whitespace per line
   * @param {string} text
   * @returns {string}
   */
  static normalize(text) {
    if (text === null || text === undefined) return '';
    return text
      .toString()
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  }

  /**
   * Compare actual vs expected output
   * @param {string} actual
   * @param {string} expected
   * @returns {{ isMatch: boolean, actualNormalized: string, expectedNormalized: string }}
   */
  static compare(actual, expected) {
    const actualNorm = this.normalize(actual);
    const expectedNorm = this.normalize(expected);

    const isMatch = actualNorm === expectedNorm;

    return {
      isMatch,
      actualNormalized: actualNorm,
      expectedNormalized: expectedNorm,
    };
  }
}

module.exports = OutputComparator;