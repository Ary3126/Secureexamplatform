const SeededPRNG = require('./prng');
const generatorRegistry = require('./generators/generatorRegistry');
const BaseGenerator = require('./generators/baseGenerator');
const TrustedOracle = require('./oracle/trustedOracle');
const OutputComparator = require('../comparator');
const { VALIDATION_LIMITS } = require('./validationConstants');

/**
 * ValidationRunner - Unified orchestrator for Random, Edge-Case, and Boundary-Case Validation
 */
class ValidationRunner {
  /**
   * Run full validation suite (Random + Edge + Boundary) against student workspace
   * @param {Object} options - { runner, workspaceDir, problem, validationConfig, standardTestCases, submissionId, timeLimitMs, memoryLimitMb }
   * @returns {Promise<Object>} Comprehensive validation outcome
   */
  static async run({
    runner,
    workspaceDir,
    problem,
    validationConfig,
    standardTestCases = [],
    submissionId = 'val',
    timeLimitMs = 2000,
    memoryLimitMb = 256,
  }) {
    if (!validationConfig || !validationConfig.validationEnabled) {
      return {
        isEnabled: false,
        status: 'skipped',
      };
    }

    const problemId = problem?.id || 0;
    const generator = generatorRegistry.getGenerator(validationConfig.generatorType);
    const oracle = new TrustedOracle({ problem, validationConfig });

    // Global Deduplication Set across all validation tiers
    const seenFingerprints = new Set();
    let totalDuplicatesSkipped = 0;

    // Seed deduplication set with standard test cases
    for (const tc of standardTestCases) {
      if (tc.inputData) {
        seenFingerprints.add(BaseGenerator.computeFingerprint(tc.inputData));
      }
    }

    let maxExecutionTime = 0;
    let maxMemoryUsed = 0;

    // Stage tracking reports
    let randomReport = { totalGenerated: 0, executed: 0, passed: 0, status: 'disabled' };
    let edgeReport = { totalGenerated: 0, executed: 0, passed: 0, status: 'disabled' };
    let boundaryReport = { totalGenerated: 0, executed: 0, passed: 0, status: 'disabled' };

    try {
      await oracle.prepare();

      // ==========================================
      // STAGE 1: DETERMINISTIC RANDOMIZED VALIDATION
      // ==========================================
      if (validationConfig.randomEnabled) {
        const randomCount = Math.min(
          parseInt(validationConfig.randomTestCount, 10) || VALIDATION_LIMITS.DEFAULT_RANDOM_TESTS,
          VALIDATION_LIMITS.MAX_RANDOM_TESTS
        );

        randomReport.totalGenerated = randomCount;
        randomReport.status = 'running';

        for (let testIndex = 1; testIndex <= randomCount; testIndex++) {
          const seed = SeededPRNG.deriveTestSeed({
            problemId,
            submissionId,
            testIndex,
            salt: 'phase4b2',
          });
          const prng = new SeededPRNG(seed);

          let generatedInput;
          try {
            generatedInput = generator.generate({
              prng,
              config: validationConfig.generatorConfig || {},
              testIndex,
              totalTests: randomCount,
            });
          } catch (genErr) {
            console.error(`[RANDOM GENERATOR ERROR] Test ${testIndex} failed:`, genErr);
            return {
              isEnabled: true,
              isSuccess: false,
              status: 'system_error',
              errorMessage: `Random Test Generator Error: ${genErr.message}`,
              stage: 'random',
            };
          }

          // Deduplication Check
          const fp = BaseGenerator.computeFingerprint(generatedInput);
          if (seenFingerprints.has(fp)) {
            totalDuplicatesSkipped++;
            randomReport.passed++;
            continue;
          }
          seenFingerprints.add(fp);
          randomReport.executed++;

          // Execute test case evaluation
          const evalOutcome = await ValidationRunner.evaluateSingleCase({
            runner,
            workspaceDir,
            oracle,
            inputData: generatedInput,
            timeLimitMs,
            memoryLimitMb,
            stageName: 'randomized',
          });

          maxExecutionTime = Math.max(maxExecutionTime, evalOutcome.executionTime || 0);
          maxMemoryUsed = Math.max(maxMemoryUsed, evalOutcome.memoryUsed || 0);

          if (!evalOutcome.isMatch) {
            randomReport.status = 'failed';
            return {
              isEnabled: true,
              isSuccess: false,
              status: evalOutcome.status,
              errorMessage: evalOutcome.errorMessage,
              stage: 'random',
              executionTime: maxExecutionTime,
              memoryUsed: maxMemoryUsed,
              randomReport,
              edgeReport,
              boundaryReport,
              totalDuplicatesSkipped,
            };
          }

          randomReport.passed++;
        }

        randomReport.status = 'passed';
      }

      // ==========================================
      // STAGE 2: EDGE-CASE VALIDATION
      // ==========================================
      if (validationConfig.edgeEnabled) {
        edgeReport.status = 'running';

        let edgeCases = [];
        try {
          edgeCases = generator.generateEdgeCases({
            config: validationConfig.generatorConfig || {},
            maxCases: VALIDATION_LIMITS.MAX_EDGE_TESTS,
          });
        } catch (edgeErr) {
          console.error('[EDGE GENERATOR ERROR]', edgeErr);
          return {
            isEnabled: true,
            isSuccess: false,
            status: 'system_error',
            errorMessage: `Edge Case Generator Error: ${edgeErr.message}`,
            stage: 'edge',
          };
        }

        edgeReport.totalGenerated = edgeCases.length;

        for (let i = 0; i < edgeCases.length; i++) {
          const inputData = edgeCases[i];
          const fp = BaseGenerator.computeFingerprint(inputData);

          if (seenFingerprints.has(fp)) {
            totalDuplicatesSkipped++;
            edgeReport.passed++;
            continue;
          }
          seenFingerprints.add(fp);
          edgeReport.executed++;

          const evalOutcome = await ValidationRunner.evaluateSingleCase({
            runner,
            workspaceDir,
            oracle,
            inputData,
            timeLimitMs,
            memoryLimitMb,
            stageName: 'edge-case',
          });

          maxExecutionTime = Math.max(maxExecutionTime, evalOutcome.executionTime || 0);
          maxMemoryUsed = Math.max(maxMemoryUsed, evalOutcome.memoryUsed || 0);

          if (!evalOutcome.isMatch) {
            edgeReport.status = 'failed';
            return {
              isEnabled: true,
              isSuccess: false,
              status: evalOutcome.status,
              errorMessage: evalOutcome.errorMessage,
              stage: 'edge',
              executionTime: maxExecutionTime,
              memoryUsed: maxMemoryUsed,
              randomReport,
              edgeReport,
              boundaryReport,
              totalDuplicatesSkipped,
            };
          }

          edgeReport.passed++;
        }

        edgeReport.status = 'passed';
      }

      // ==========================================
      // STAGE 3: BOUNDARY-CASE VALIDATION
      // ==========================================
      if (validationConfig.boundaryEnabled) {
        boundaryReport.status = 'running';

        let boundaryCases = [];
        try {
          boundaryCases = generator.generateBoundaryCases({
            config: validationConfig.generatorConfig || {},
            maxCases: VALIDATION_LIMITS.MAX_BOUNDARY_TESTS,
          });
        } catch (boundErr) {
          console.error('[BOUNDARY GENERATOR ERROR]', boundErr);
          return {
            isEnabled: true,
            isSuccess: false,
            status: 'system_error',
            errorMessage: `Boundary Case Generator Error: ${boundErr.message}`,
            stage: 'boundary',
          };
        }

        boundaryReport.totalGenerated = boundaryCases.length;

        for (let i = 0; i < boundaryCases.length; i++) {
          const inputData = boundaryCases[i];
          const fp = BaseGenerator.computeFingerprint(inputData);

          if (seenFingerprints.has(fp)) {
            totalDuplicatesSkipped++;
            boundaryReport.passed++;
            continue;
          }
          seenFingerprints.add(fp);
          boundaryReport.executed++;

          const evalOutcome = await ValidationRunner.evaluateSingleCase({
            runner,
            workspaceDir,
            oracle,
            inputData,
            timeLimitMs,
            memoryLimitMb,
            stageName: 'boundary-case',
          });

          maxExecutionTime = Math.max(maxExecutionTime, evalOutcome.executionTime || 0);
          maxMemoryUsed = Math.max(maxMemoryUsed, evalOutcome.memoryUsed || 0);

          if (!evalOutcome.isMatch) {
            boundaryReport.status = 'failed';
            return {
              isEnabled: true,
              isSuccess: false,
              status: evalOutcome.status,
              errorMessage: evalOutcome.errorMessage,
              stage: 'boundary',
              executionTime: maxExecutionTime,
              memoryUsed: maxMemoryUsed,
              randomReport,
              edgeReport,
              boundaryReport,
              totalDuplicatesSkipped,
            };
          }

          boundaryReport.passed++;
        }

        boundaryReport.status = 'passed';
      }

      return {
        isEnabled: true,
        isSuccess: true,
        status: 'accepted',
        executionTime: maxExecutionTime,
        memoryUsed: maxMemoryUsed,
        randomReport,
        edgeReport,
        boundaryReport,
        totalDuplicatesSkipped,
      };
    } finally {
      await oracle.cleanup();
    }
  }

  /**
   * Run a single test case input through Oracle and student sandbox, returning outcome
   */
  static async evaluateSingleCase({
    runner,
    workspaceDir,
    oracle,
    inputData,
    timeLimitMs,
    memoryLimitMb,
    stageName = 'validation',
  }) {
    let expectedOutput;
    try {
      expectedOutput = await oracle.getExpectedOutput(inputData);
    } catch (oracleErr) {
      console.error(`[ORACLE FAILURE on ${stageName}]`, oracleErr);
      return {
        isMatch: false,
        status: 'system_error',
        errorMessage: `Validation Oracle Failure: ${oracleErr.message}`,
      };
    }

    const studentRun = await runner.run({
      workspaceDir,
      inputData,
      timeLimitMs,
      memoryLimitMb,
    });

    if (studentRun.status === 'time_limit_exceeded') {
      return {
        isMatch: false,
        status: 'time_limit_exceeded',
        errorMessage: `Time Limit Exceeded on ${stageName} validation test`,
        executionTime: studentRun.executionTimeMs,
        memoryUsed: studentRun.memoryUsedKb,
      };
    }

    if (studentRun.status === 'runtime_error') {
      return {
        isMatch: false,
        status: 'runtime_error',
        errorMessage: studentRun.stderr || `Runtime Error on ${stageName} validation test`,
        executionTime: studentRun.executionTimeMs,
        memoryUsed: studentRun.memoryUsedKb,
      };
    }

    if (studentRun.status === 'system_error') {
      return {
        isMatch: false,
        status: 'system_error',
        errorMessage: studentRun.stderr || `System Error on ${stageName} validation test`,
        executionTime: studentRun.executionTimeMs,
        memoryUsed: studentRun.memoryUsedKb,
      };
    }

    const comp = OutputComparator.compare(studentRun.stdout, expectedOutput);
    if (!comp.isMatch) {
      return {
        isMatch: false,
        status: 'wrong_answer',
        errorMessage: `Wrong Answer on ${stageName} validation test`,
        executionTime: studentRun.executionTimeMs,
        memoryUsed: studentRun.memoryUsedKb,
      };
    }

    return {
      isMatch: true,
      status: 'passed',
      executionTime: studentRun.executionTimeMs,
      memoryUsed: studentRun.memoryUsedKb,
    };
  }
}

module.exports = ValidationRunner;