const SourceNormalizer = require('./sourceNormalizer');
const { SUSPICION_WEIGHTS } = require('./antiHardcodingConstants');

// Common non-suspicious competitive programming constants to ignore
const SAFE_COMPETITIVE_CONSTANTS = new Set([
  0, 1, -1, 2, 3, 10, 100, 1000, 10000, 100000, 1000000,
  1000000007, // Standard modulo 10^9 + 7
  998244353,  // Standard NTT modulo
  1000000009, // Modulo alternative
  2147483647, // 32-bit INT_MAX
  -2147483648,// 32-bit INT_MIN
]);

/**
 * StaticAnalyzer - Performs fast, AST-free deterministic structural analysis to detect hardcoded test mappings
 */
class StaticAnalyzer {
  /**
   * Run static analysis on source code against known test cases
   * @param {Object} options - { sourceCode, language, standardTestCases }
   * @returns {Object} { staticScore, signals, matchedDetails }
   */
  static analyze({ sourceCode = '', language = 'python', standardTestCases = [] }) {
    const normalized = SourceNormalizer.normalize(sourceCode, language);
    const signals = [];
    let staticScore = 0;

    if (!normalized || normalized.length === 0) {
      return { staticScore: 0, signals: [], matchedDetails: {} };
    }

    // 1. Extract Known Test Constants from standard test cases
    const knownTestConstants = new Set();
    const testPairs = [];

    for (const tc of standardTestCases) {
      const inNums = (tc.inputData || '').match(/-?\b\d+\b/g) || [];
      const outNums = (tc.expectedOutput || '').match(/-?\b\d+\b/g) || [];

      inNums.forEach((n) => {
        const num = Number(n);
        if (!SAFE_COMPETITIVE_CONSTANTS.has(num)) {
          knownTestConstants.add(num);
        }
      });

      if (inNums.length > 0 && outNums.length > 0) {
        testPairs.push({ inNums: inNums.map(Number), outNum: Number(outNums[0]) });
      }
    }

    // 2. Signal A: Exact Equality Branching Matching Test Inputs
    // Detects repeated `if (x == ...)` / `elif (x == ...)` / `else if (x == ...)`
    const equalityMatches = normalized.match(/(?:if|elif|else\s+if)\s*\([^)]*==[^)]*\)|(?:if|elif)\s+[^:\n]+==/g) || [];
    const comparedNumbers = (normalized.match(/==\s*(-?\d+)/g) || []).map((m) => Number(m.replace('==', '').trim()));
    const matchingTestNumbers = comparedNumbers.filter((n) => knownTestConstants.has(n));

    if (equalityMatches.length >= 2 && matchingTestNumbers.length >= 2) {
      signals.push({
        name: 'EXCESSIVE_EXACT_BRANCHING',
        weight: SUSPICION_WEIGHTS.EXCESSIVE_BRANCHING,
        description: `Detected ${equalityMatches.length} exact-input conditional branches matching ${matchingTestNumbers.length} known test inputs.`,
      });
      staticScore += SUSPICION_WEIGHTS.EXCESSIVE_BRANCHING;
    }

    // 3. Signal B: Hardcoded Output Mapping / Dictionary Literals
    // Detects dict literals like `{ (10, 20): 30, (55, 45): 100 }` or `{ "10 20": 30 }`
    const dictLiteralMatches = normalized.match(/\{[^{}]*:[^{}]*\}/g) || [];
    if (dictLiteralMatches.length > 0) {
      let mapMatchCount = 0;
      for (const dictStr of dictLiteralMatches) {
        for (const pair of testPairs) {
          if (dictStr.includes(String(pair.outNum)) && pair.inNums.some((n) => dictStr.includes(String(n)))) {
            mapMatchCount++;
          }
        }
      }

      if (mapMatchCount >= 2) {
        signals.push({
          name: 'HARDCODED_OUTPUT_MAPPING',
          weight: SUSPICION_WEIGHTS.HARDCODED_MAP,
          description: `Detected hardcoded dictionary/lookup structure matching ${mapMatchCount} known test input-output pairs.`,
        });
        staticScore += SUSPICION_WEIGHTS.HARDCODED_MAP;
      }
    }

    // 4. Signal C: High Known-Test Constant Correlation
    // Checks if source code is populated with numbers specifically from the test suite
    const sourceLiterals = SourceNormalizer.extractNumericLiterals(normalized);
    const matchedConstants = new Set();

    for (const lit of sourceLiterals) {
      if (knownTestConstants.has(lit)) {
        matchedConstants.add(lit);
      }
    }

    if (knownTestConstants.size >= 2 && matchedConstants.size >= 2) {
      const correlationRatio = matchedConstants.size / knownTestConstants.size;
      if (correlationRatio >= 0.5) {
        signals.push({
          name: 'HIGH_CONSTANT_CORRELATION',
          weight: SUSPICION_WEIGHTS.CONSTANT_CORRELATION,
          description: `Source contains ${matchedConstants.size} constants matching ${Math.round(correlationRatio * 100)}% of problem test cases.`,
        });
        staticScore += SUSPICION_WEIGHTS.CONSTANT_CORRELATION;
      }
    }

    return {
      staticScore: Math.min(staticScore, 100),
      signals,
      matchedDetails: {
        totalEqualityBranches: equalityMatches.length,
        matchedTestConstants: Array.from(matchedConstants),
      },
    };
  }
}

module.exports = StaticAnalyzer;