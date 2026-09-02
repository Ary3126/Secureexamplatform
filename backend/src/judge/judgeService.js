const languageRegistry = require('./runners');
const OutputComparator = require('./comparator');
const HarnessBuilder = require('./harness/harnessBuilder');
const ProblemValidationConfigModel = require('../models/problemValidationConfigModel');
const SubmissionValidationRunModel = require('../models/submissionValidationRunModel');
const ValidationRunner = require('./validation/validationRunner');
const AntiHardcodingService = require('./validation/antiHardcoding/antiHardcodingService');
const { ValidationRun, VALIDATION_STAGES } = require('./validation/validationRun');
const SecurityPreconditions = require('./security/securityPreconditions');
const SecurityLogger = require('./security/securityLogger');

/**
 * JudgeService - Complete Evaluation Engine & Validation-Run Orchestrator (Phase 4A + Phase 4B.1-4B.5)
 */
class JudgeService {
  /**
   * Evaluate a submission through the unified, observable validation pipeline
   * @param {Object} options - { submissionId, language, codingMode, sourceCode, testCases, problem, validationConfig, problemPoints, isSampleRun }
   * @returns {Promise<Object>} Final evaluation verdict, metrics, and security validation summary
   */
  static async evaluateSubmission({
    submissionId,
    language,
    codingMode = 'function',
    sourceCode,
    testCases = [],
    problem = null,
    validationConfig = null,
    problemPoints = 100,
    isSampleRun = false,
  }) {
        // 0. Enforce Fail-Closed Security Preconditions
    try {
      SecurityPreconditions.validate({
        submissionId,
        language,
        sourceCode,
      });
    } catch (preErr) {
      SecurityLogger.warnViolation('PRECONDITION_FAILED', {
        submissionId,
        error: preErr.message,
      });
      return {
        status: 'system_error',
        score: 0,
        executionTime: 0,
        memoryUsed: 0,
        errorMessage: preErr.message,
        testCasesPassed: 0,
        testCasesTotal: testCases.length,
        sampleResults: [],
      };
    }

    const runner = languageRegistry.getRunner(language);

    if (!runner) {
      return {
        status: 'system_error',
        score: 0,
        executionTime: 0,
        memoryUsed: 0,
        errorMessage: `Language '${language}' is not supported by judge engine.`,
        testCasesPassed: 0,
        testCasesTotal: testCases.length,
        sampleResults: [],
      };
    }

    if (!testCases || testCases.length === 0) {
      return {
        status: 'system_error',
        score: 0,
        executionTime: 0,
        memoryUsed: 0,
        errorMessage: 'Problem has no configured test cases for evaluation.',
        testCasesPassed: 0,
        testCasesTotal: 0,
        sampleResults: [],
      };
    }

    // 1. Load validation configuration if not explicitly provided
    let activeValidationConfig = validationConfig;
    if (!activeValidationConfig && problem && problem.id) {
      try {
        activeValidationConfig = await ProblemValidationConfigModel.findByProblemId(problem.id);
      } catch (err) {
        console.warn(`[JUDGE SERVICE] Could not load validation config for problem ${problem.id}:`, err.message);
      }
    }

    // 2. Initialize ValidationRun State Machine & Audit Abstraction
    const valRun = new ValidationRun({
      submissionId,
      problemId: problem?.id || 0,
      validationConfig: activeValidationConfig,
    });

    let workspaceDir = null;
    try {
      // 3. Create isolated temporary workspace
      workspaceDir = await runner.createWorkspace(submissionId);

      // 4. STAGE: COMPILATION / SYNTAX VALIDATION
      valRun.startStage(VALIDATION_STAGES.COMPILATION);

      const executableSourceCode = HarnessBuilder.buildExecutableCode({
        language,
        codingMode,
        sourceCode,
        problem,
      });
      await runner.writeSourceCode(workspaceDir, executableSourceCode);

      const compileResult = await runner.compile({ workspaceDir });
      valRun.endStage(VALIDATION_STAGES.COMPILATION);

      if (!compileResult.isSuccess) {
        // Compilation failure -> Stop early with COMPILATION_ERROR
        valRun.setVerdict('compilation_error', compileResult.errorMessage, VALIDATION_STAGES.COMPILATION);
        await JudgeService.recordValidationRun(valRun);

        return {
          status: 'compilation_error',
          score: 0,
          executionTime: 0,
          memoryUsed: 0,
          errorMessage: compileResult.errorMessage,
          testCasesPassed: 0,
          testCasesTotal: testCases.length,
          sampleResults: [],
          validationSummary: (activeValidationConfig && activeValidationConfig.validationEnabled) ? valRun.toSummary() : undefined,
        };
      }

      // 5. STAGE: STANDARD TEST SUITE
      valRun.startStage(VALIDATION_STAGES.STANDARD);
      valRun.standardTotal = testCases.length;

      const sampleResults = [];
      let standardFailed = false;

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const timeLimit = testCase.timeLimitMs || 2000;
        const memoryLimit = testCase.memoryLimitMb || 256;

        const runResult = await runner.run({
          workspaceDir,
          inputData: testCase.inputData || '',
          timeLimitMs: timeLimit,
          memoryLimitMb: memoryLimit,
        });

        valRun.updateResourceMetrics(runResult.executionTimeMs, runResult.memoryUsedKb);

        // Check for runtime errors, timeouts, or system failures
        if (runResult.status === 'time_limit_exceeded') {
          standardFailed = true;
          valRun.setVerdict('time_limit_exceeded', `Time Limit Exceeded on test case ${i + 1}`, VALIDATION_STAGES.STANDARD);
          if (isSampleRun) {
            sampleResults.push({
              testCaseId: testCase.id,
              input: testCase.inputData,
              expectedOutput: testCase.expectedOutput,
              actualOutput: runResult.stdout,
              status: 'time_limit_exceeded',
              executionTime: runResult.executionTimeMs,
              errorMessage: 'Time Limit Exceeded',
            });
            continue;
          }
          break;
        }

        if (runResult.status === 'runtime_error') {
          standardFailed = true;
          valRun.setVerdict('runtime_error', runResult.stderr || `Runtime Error on test case ${i + 1}`, VALIDATION_STAGES.STANDARD);
          if (isSampleRun) {
            sampleResults.push({
              testCaseId: testCase.id,
              input: testCase.inputData,
              expectedOutput: testCase.expectedOutput,
              actualOutput: runResult.stdout,
              status: 'runtime_error',
              executionTime: runResult.executionTimeMs,
              errorMessage: runResult.stderr || 'Runtime Error',
            });
            continue;
          }
          break;
        }

        if (runResult.status === 'system_error') {
          standardFailed = true;
          valRun.setVerdict('system_error', runResult.stderr || `System Error on test case ${i + 1}`, VALIDATION_STAGES.STANDARD);
          if (isSampleRun) {
            sampleResults.push({
              testCaseId: testCase.id,
              input: testCase.inputData,
              expectedOutput: testCase.expectedOutput,
              actualOutput: runResult.stdout,
              status: 'system_error',
              executionTime: runResult.executionTimeMs,
              errorMessage: runResult.stderr || 'System Error',
            });
            continue;
          }
          break;
        }

        // Compare standard outputs
        const comp = OutputComparator.compare(runResult.stdout, testCase.expectedOutput);

        if (comp.isMatch) {
          valRun.standardPassed++;
          if (isSampleRun) {
            sampleResults.push({
              testCaseId: testCase.id,
              input: testCase.inputData,
              expectedOutput: testCase.expectedOutput,
              actualOutput: runResult.stdout,
              status: 'passed',
              executionTime: runResult.executionTimeMs,
              errorMessage: null,
            });
          }
        } else {
          standardFailed = true;
          valRun.setVerdict('wrong_answer', `Wrong Answer on test case ${i + 1}`, VALIDATION_STAGES.STANDARD);

          if (isSampleRun) {
            sampleResults.push({
              testCaseId: testCase.id,
              input: testCase.inputData,
              expectedOutput: testCase.expectedOutput,
              actualOutput: runResult.stdout,
              status: 'wrong_answer',
              executionTime: runResult.executionTimeMs,
              errorMessage: comp.diffSummary || 'Outputs do not match',
            });
            continue;
          }
          break;
        }
      }

      valRun.endStage(VALIDATION_STAGES.STANDARD);

      // 6. ENHANCED VALIDATION PIPELINE (Random + Edge + Boundary + Anti-Hardcoding)
      let validationOutcome = null;

      if (!valRun.shouldStopEarly() && activeValidationConfig?.validationEnabled && !isSampleRun) {
        valRun.startStage(VALIDATION_STAGES.RANDOM);

        validationOutcome = await ValidationRunner.run({
          runner,
          workspaceDir,
          problem,
          validationConfig: activeValidationConfig,
          standardTestCases: testCases,
          submissionId,
          timeLimitMs: 2000,
          memoryLimitMb: 256,
        });

        valRun.endStage(VALIDATION_STAGES.RANDOM);

        if (validationOutcome.isEnabled) {
          valRun.updateResourceMetrics(validationOutcome.executionTime, validationOutcome.memoryUsed);

          if (validationOutcome.randomReport) {
            valRun.randomTotal = validationOutcome.randomReport.totalGenerated;
            valRun.randomPassed = validationOutcome.randomReport.passed;
          }
          if (validationOutcome.edgeReport) {
            valRun.edgeTotal = validationOutcome.edgeReport.totalGenerated;
            valRun.edgePassed = validationOutcome.edgeReport.passed;
          }
          if (validationOutcome.boundaryReport) {
            valRun.boundaryTotal = validationOutcome.boundaryReport.totalGenerated;
            valRun.boundaryPassed = validationOutcome.boundaryReport.passed;
          }

          if (!validationOutcome.isSuccess) {
            const failStage = (validationOutcome.stage || 'RANDOM').toUpperCase();
            valRun.setVerdict(validationOutcome.status, validationOutcome.errorMessage, failStage);
          }
        }
      }

      // 7. ANTI-HARDCODING & SUSPICIOUS SOLUTION DETECTION
      if (valRun.finalStatus !== 'compilation_error' && !isSampleRun) {
        valRun.startStage(VALIDATION_STAGES.SUSPICION_ANALYSIS);

        const ahReport = await AntiHardcodingService.evaluate({
          runner,
          workspaceDir,
          problem,
          validationConfig: activeValidationConfig,
          standardTestCases: testCases,
          sourceCode,
          language,
          standardPassed: valRun.standardPassed,
          totalStandard: testCases.length,
          validationOutcome,
          submissionId,
        });

        valRun.endStage(VALIDATION_STAGES.SUSPICION_ANALYSIS);

        valRun.suspicionScore = ahReport.suspicionScore;
        valRun.suspicionLevel = ahReport.suspicionLevel;
        valRun.isFlagged = ahReport.isFlagged;
        valRun.antiHardcodingReport = ahReport;

        if (ahReport.failureDetails) {
          valRun.setVerdict(
            ahReport.failureDetails.status || 'wrong_answer',
            ahReport.failureDetails.errorMessage || 'Wrong Answer on validation test',
            VALIDATION_STAGES.ADDITIONAL_VALIDATION
          );
        }
      }

      // 8. STAGE: FINALIZATION
      valRun.startStage(VALIDATION_STAGES.FINALIZATION);

      if (valRun.finalStatus === 'running') {
        valRun.setVerdict('accepted');
      }

      valRun.endStage(VALIDATION_STAGES.FINALIZATION);

      // 9. Compute Score
      const finalScore = valRun.finalStatus === 'accepted'
        ? problemPoints
        : Math.floor((valRun.standardPassed / testCases.length) * problemPoints * (valRun.failureStage && valRun.failureStage !== 'STANDARD' ? 0.5 : 1));

      // 10. Persist Validation Run Audit Record
      await JudgeService.recordValidationRun(valRun);

      return {
        status: valRun.finalStatus,
        score: finalScore,
        executionTime: valRun.maxExecutionTimeMs,
        memoryUsed: valRun.maxMemoryUsedKb,
        errorMessage: valRun.failureReason,
        testCasesPassed: valRun.standardPassed,
        testCasesTotal: testCases.length,
        sampleResults,
        validationSummary: (activeValidationConfig && activeValidationConfig.validationEnabled) ? valRun.toSummary() : undefined,
      };
    } catch (err) {
      console.error(`[JUDGE SERVICE EXCEPTION] Submission ${submissionId} evaluation failed:`, err);
      valRun.setVerdict('system_error', `Internal Judge Engine Failure: ${err.message}`, valRun.currentStage);
      await JudgeService.recordValidationRun(valRun);

      return {
        status: 'system_error',
        score: 0,
        executionTime: 0,
        memoryUsed: 0,
        errorMessage: `Internal Judge Engine Failure: ${err.message}`,
        testCasesPassed: 0,
        testCasesTotal: testCases.length,
        sampleResults: [],
        validationSummary: (activeValidationConfig && activeValidationConfig.validationEnabled) ? valRun.toSummary() : undefined,
      };
    } finally {
      if (workspaceDir && runner.cleanup) {
        await runner.cleanup(workspaceDir);
      }
    }
  }

  /**
   * Safely persist validation run details to PostgreSQL
   * @param {ValidationRun} valRun
   */
  static async recordValidationRun(valRun) {
    if (!valRun || !valRun.submissionId) return;

    // Check if submissionId is numeric integer ID
    const numSubId = parseInt(valRun.submissionId, 10);
    if (isNaN(numSubId) || numSubId <= 0) return;

    try {
      await SubmissionValidationRunModel.createValidationRun({
        submissionId: numSubId,
        problemId: valRun.problemId,
        currentStage: valRun.currentStage,
        finalStatus: valRun.finalStatus,
        standardPassed: valRun.standardPassed,
        standardTotal: valRun.standardTotal,
        randomPassed: valRun.randomPassed,
        randomTotal: valRun.randomTotal,
        edgePassed: valRun.edgePassed,
        edgeTotal: valRun.edgeTotal,
        boundaryPassed: valRun.boundaryPassed,
        boundaryTotal: valRun.boundaryTotal,
        suspicionScore: valRun.suspicionScore,
        suspicionLevel: valRun.suspicionLevel,
        isFlagged: valRun.isFlagged,
        failureStage: valRun.failureStage,
        failureReason: valRun.failureReason,
        executionTimeMs: valRun.maxExecutionTimeMs,
        memoryUsedKb: valRun.maxMemoryUsedKb,
        stageDurations: valRun.stageDurations,
        validationDetails: valRun.toSummary(),
      });
    } catch (dbErr) { /* ignore DB constraint warning on ephemeral mock IDs */ }
  }
}

module.exports = JudgeService;