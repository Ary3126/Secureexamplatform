const StaticAnalyzer = require('./staticAnalyzer');
const BehavioralAnalyzer = require('./behavioralAnalyzer');
const SuspicionScorer = require('./suspicionScorer');
const SeededPRNG = require('../prng');
const generatorRegistry = require('../generators/generatorRegistry');
const TrustedOracle = require('../oracle/trustedOracle');
const ValidationRunner = require('../validationRunner');
const { ANTI_HARDCODING_LIMITS, SUSPICION_LEVELS } = require('./antiHardcodingConstants');

/**
 * AntiHardcodingService - Complete orchestration service for static analysis, behavioral generalization, and targeted verification
 */
class AntiHardcodingService {
  /**
   * Run anti-hardcoding evaluation on a submission
   * @param {Object} options - { runner, workspaceDir, problem, validationConfig, standardTestCases, sourceCode, language, standardPassed, totalStandard, validationOutcome, submissionId }
   * @returns {Promise<Object>} Anti-hardcoding evaluation and flag details
   */
  static async evaluate({
    runner,
    workspaceDir,
    problem,
    validationConfig,
    standardTestCases = [],
    sourceCode = '',
    language = 'python',
    standardPassed = 0,
    totalStandard = 0,
    validationOutcome = null,
    submissionId = 'ah_eval',
  }) {
    // 1. Run Static Analysis
    const staticResult = StaticAnalyzer.analyze({
      sourceCode,
      language,
      standardTestCases,
    });

    // 2. Run Behavioral Analysis
    const behavioralResult = BehavioralAnalyzer.analyze({
      standardPassed,
      totalStandard,
      validationOutcome,
    });

    // 3. Compute Initial Suspicion Score
    const initialReport = SuspicionScorer.score({ staticResult, behavioralResult });

    let finalReport = { ...initialReport };
    let extraValidationOutcome = null;

    // 4. Additional Targeted Validation for HIGH suspicion solutions that currently pass
    if (
      initialReport.shouldTriggerAdditionalValidation &&
      validationConfig &&
      validationConfig.validationEnabled &&
      validationOutcome?.isSuccess !== false
    ) {
      const problemId = problem?.id || 0;
      const generator = generatorRegistry.getGenerator(validationConfig.generatorType);
      const oracle = new TrustedOracle({ problem, validationConfig });

      try {
        await oracle.prepare();
        let extraPassed = 0;
        let extraFailed = 0;
        let failureDetails = null;

        for (let i = 1; i <= ANTI_HARDCODING_LIMITS.MAX_EXTRA_VALIDATION_TESTS; i++) {
          const seed = SeededPRNG.deriveTestSeed({
            problemId,
            submissionId,
            testIndex: 900 + i,
            salt: 'anti_hardcode_verify',
          });
          const prng = new SeededPRNG(seed);

          const generatedInput = generator.generate({
            prng,
            config: validationConfig.generatorConfig || {},
            testIndex: 900 + i,
            totalTests: ANTI_HARDCODING_LIMITS.MAX_EXTRA_VALIDATION_TESTS,
          });

          const singleOutcome = await ValidationRunner.evaluateSingleCase({
            runner,
            workspaceDir,
            oracle,
            inputData: generatedInput,
            timeLimitMs: 2000,
            memoryLimitMb: 256,
            stageName: 'anti-hardcoding-verification',
          });

          if (!singleOutcome.isMatch) {
            extraFailed++;
            failureDetails = singleOutcome;
            break;
          } else {
            extraPassed++;
          }
        }

        extraValidationOutcome = {
          triggered: true,
          totalExecuted: extraPassed + extraFailed,
          passed: extraPassed,
          failed: extraFailed,
        };

        if (extraFailed > 0) {
          // Confirmed hardcoded failure on unseen inputs
          finalReport.isFlagged = true;
          finalReport.suspicionLevel = SUSPICION_LEVELS.HIGH;
          finalReport.failureDetails = failureDetails;
        } else {
          // Passed unseen tests -> mitigate suspicion (likely legitimate lookup/optimization)
          finalReport.suspicionScore = Math.max(0, finalReport.suspicionScore - 30);
          if (finalReport.suspicionScore < ANTI_HARDCODING_LIMITS.HIGH_THRESHOLD) {
            finalReport.suspicionLevel = SUSPICION_LEVELS.MEDIUM;
            finalReport.isFlagged = false;
          }
        }
      } catch (err) {
        console.warn('[ANTI-HARDCODING EXTRA VALIDATION WARNING]', err.message);
      } finally {
        await oracle.cleanup();
      }
    }

    return {
      suspicionScore: finalReport.suspicionScore,
      suspicionLevel: finalReport.suspicionLevel,
      signals: finalReport.signals,
      isFlagged: finalReport.isFlagged,
      additionalValidation: extraValidationOutcome,
      failureDetails: finalReport.failureDetails || null,
    };
  }
}

module.exports = AntiHardcodingService;