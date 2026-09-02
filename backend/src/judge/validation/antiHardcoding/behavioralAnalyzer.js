const { SUSPICION_WEIGHTS } = require('./antiHardcodingConstants');

/**
 * BehavioralAnalyzer - Evaluates execution generalization across known vs unknown dynamic test suites
 */
class BehavioralAnalyzer {
  /**
   * Analyze execution behavior to detect test-case memorization / failure on unseen inputs
   * @param {Object} options - { standardPassed, totalStandard, validationOutcome }
   * @returns {Object} { behavioralScore, signals }
   */
  static analyze({ standardPassed = 0, totalStandard = 0, validationOutcome = null }) {
    const signals = [];
    let behavioralScore = 0;

    if (!validationOutcome || !validationOutcome.isEnabled) {
      return { behavioralScore: 0, signals: [] };
    }

    // 1. Signal D: Known Tests Pass 100%, but Generated Unknown Tests Fail
    const allKnownPassed = totalStandard > 0 && standardPassed === totalStandard;
    const isValidationFailed = validationOutcome.isSuccess === false;

    if (allKnownPassed && isValidationFailed) {
      const failedStage = validationOutcome.stage || 'random';
      signals.push({
        name: 'UNKNOWN_TEST_FAILURE_DISCREPANCY',
        weight: SUSPICION_WEIGHTS.UNKNOWN_TEST_FAILURE,
        description: `Passed all ${totalStandard} pre-configured tests, but immediately failed on unseen ${failedStage} validation test.`,
      });
      behavioralScore += SUSPICION_WEIGHTS.UNKNOWN_TEST_FAILURE;
    }

    return {
      behavioralScore: Math.min(behavioralScore, 100),
      signals,
    };
  }
}

module.exports = BehavioralAnalyzer;