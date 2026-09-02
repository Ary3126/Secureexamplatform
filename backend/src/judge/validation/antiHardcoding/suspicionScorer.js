const { SUSPICION_LEVELS, ANTI_HARDCODING_LIMITS } = require('./antiHardcodingConstants');

/**
 * SuspicionScorer - Aggregates independent static and behavioral signals into an objective suspicion rating
 */
class SuspicionScorer {
  /**
   * Score submission suspicion based on combined static and behavioral evidence
   * @param {Object} options - { staticResult, behavioralResult }
   * @returns {Object} Final suspicion report
   */
  static score({ staticResult = { staticScore: 0, signals: [] }, behavioralResult = { behavioralScore: 0, signals: [] } }) {
    const staticScore = staticResult.staticScore || 0;
    const behavioralScore = behavioralResult.behavioralScore || 0;
    const combinedScore = Math.min(staticScore + behavioralScore, 100);

    const allSignals = [...(staticResult.signals || []), ...(behavioralResult.signals || [])];

    let suspicionLevel = SUSPICION_LEVELS.LOW;
    if (combinedScore >= ANTI_HARDCODING_LIMITS.HIGH_THRESHOLD) {
      suspicionLevel = SUSPICION_LEVELS.HIGH;
    } else if (combinedScore >= ANTI_HARDCODING_LIMITS.LOW_THRESHOLD) {
      suspicionLevel = SUSPICION_LEVELS.MEDIUM;
    }

    const isFlagged = suspicionLevel === SUSPICION_LEVELS.HIGH || (
      suspicionLevel === SUSPICION_LEVELS.MEDIUM &&
      staticResult.signals?.length > 0 &&
      behavioralResult.signals?.length > 0
    );

    return {
      suspicionScore: combinedScore,
      suspicionLevel,
      signals: allSignals,
      isFlagged,
      staticScore,
      behavioralScore,
      shouldTriggerAdditionalValidation: suspicionLevel === SUSPICION_LEVELS.HIGH,
    };
  }
}

module.exports = SuspicionScorer;