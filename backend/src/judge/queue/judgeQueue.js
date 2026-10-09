const EventEmitter = require('events');
const SubmissionModel = require('../../models/submissionModel');
const TestCaseModel = require('../../models/testCaseModel');
const ProblemModel = require('../../models/problemModel');
const ContestModel = require('../../models/contestModel');
const JudgeService = require('../judgeService');
const SecurityLogger = require('../security/securityLogger');
const RATE_LIMIT_CONFIG = require('../../config/rateLimitConfig');

const MAX_QUEUE_CAPACITY = 500;
const DEFAULT_MAX_USER_CONCURRENCY = 3;

/**
 * JudgeQueue - In-process asynchronous job queue with concurrency control, idempotency guards,
 * backpressure protection, per-user submission limits, and worker management.
 */
class JudgeQueue extends EventEmitter {
  constructor(concurrency = 2) {
    super();
    this.concurrency = concurrency;
    this.runningCount = 0;
    this.queue = [];
    this.activeSubmissions = new Set();
    this.userActiveJobs = new Map();
    this.maxCapacity = MAX_QUEUE_CAPACITY;
    this.maxConcurrentPerUser = DEFAULT_MAX_USER_CONCURRENCY;
  }

  /**
   * Enqueue a submission for evaluation with duplicate job, backpressure, and per-user abuse protection
   * @param {Object} job - { submissionId, userId, isSampleRun, resolveCallback }
   */
  addJob({ submissionId, userId = null, isSampleRun = false, resolveCallback = null }) {
    // 1. Backpressure guard: protect backend from memory exhaustion under flood
    if (this.queue.length >= this.maxCapacity) {
      SecurityLogger.warnViolation('QUEUE_BACKPRESSURE_LIMIT', {
        queueSize: this.queue.length,
        maxCapacity: this.maxCapacity,
        submissionId,
      });
      const err = new Error('Judge Queue is currently at maximum capacity (' + this.maxCapacity + ' jobs). Please try again later.');
      if (resolveCallback) resolveCallback({ status: 'system_error', errorMessage: err.message });
      return false;
    }

    // 2. Idempotency: avoid queueing if currently running or already in queue buffer
    const isAlreadyQueued = this.queue.some((job) => job.submissionId === submissionId);
    if (this.activeSubmissions.has(submissionId) || isAlreadyQueued) {
      console.warn('[JUDGE QUEUE] Submission ' + submissionId + ' is already active or queued. Skipping duplicate enqueue.');
      return false;
    }

    // 3. Per-User Submission Flooding / Concurrency Limit
    if (userId) {
      const currentActive = this.userActiveJobs.get(userId) || 0;
      const userLimit = isSampleRun
        ? RATE_LIMIT_CONFIG.RUN_CODE.maxConcurrentPerUser
        : RATE_LIMIT_CONFIG.SUBMIT_CODE.maxConcurrentPerUser;

      if (currentActive >= userLimit) {
        SecurityLogger.warnViolation('QUEUE_USER_CONCURRENCY_LIMIT', {
          userId,
          currentActive,
          userLimit,
          submissionId,
        });
        const err = new Error('You have ' + currentActive + ' submissions currently running or queued. Please wait for them to finish before submitting again.');
        if (resolveCallback) resolveCallback({ status: 'system_error', errorMessage: err.message });
        return false;
      }

      this.userActiveJobs.set(userId, currentActive + 1);
    }

    this.queue.push({
      submissionId,
      userId,
      isSampleRun,
      resolveCallback,
      enqueuedAt: Date.now(),
    });

    this.processNext();
    return true;
  }

  /**
   * Process next available job in the queue
   */
  async processNext() {
    if (this.runningCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    this.runningCount++;
    this.activeSubmissions.add(job.submissionId);

    this.executeJob(job)
      .catch((err) => {
        console.error('[JUDGE WORKER ERROR] Job ' + job.submissionId + ' failed:', err);
      })
      .finally(() => {
        this.runningCount--;
        this.activeSubmissions.delete(job.submissionId);

        // Decrement user active job count
        if (job.userId) {
          const current = this.userActiveJobs.get(job.userId) || 1;
          if (current <= 1) {
            this.userActiveJobs.delete(job.userId);
          } else {
            this.userActiveJobs.set(job.userId, current - 1);
          }
        }

        this.processNext();
      });
  }

  /**
   * Execute evaluation workflow for a single submission
   * @param {Object} job
   */
  async executeJob(job) {
    const { submissionId, isSampleRun, resolveCallback } = job;

    try {
      const submission = await SubmissionModel.findSubmissionById(submissionId);
      if (!submission) {
        console.warn('[JUDGE WORKER] Submission ' + submissionId + ' not found in database.');
        if (resolveCallback) resolveCallback(null);
        return;
      }

      // Guard: do not re-evaluate submissions that are already in a terminal state
      const TERMINAL_STATUSES = [
        'accepted',
        'wrong_answer',
        'time_limit_exceeded',
        'memory_limit_exceeded',
        'compilation_error',
        'runtime_error',
        'system_error',
      ];
      if (!isSampleRun && TERMINAL_STATUSES.includes(submission.status)) {
        console.warn(`[JUDGE WORKER] Submission ${submissionId} is already in terminal state '${submission.status}'. Skipping duplicate execution.`);
        if (resolveCallback) resolveCallback(submission);
        return;
      }

      // 1. Mark submission status as running
      await SubmissionModel.updateSubmission(submissionId, {
        status: 'running',
      });

      // 2. Fetch test cases (sample runs use only visible; official submissions use all test cases)
      const problem = await ProblemModel.findProblemById(submission.problemId);
      const includeHidden = !isSampleRun;
      const testCases = await TestCaseModel.findTestCasesByProblemId(submission.problemId, {
        includeHidden,
      });

      // 2b. Determine problem points (authoritative contest_problems points if in a contest, otherwise default 100)
      let problemPoints = 100;
      if (submission.contestId) {
        try {
          const configuredPoints = await ContestModel.getContestProblemPoints(
            submission.contestId,
            submission.problemId
          );
          if (configuredPoints && Number.isInteger(Number(configuredPoints)) && Number(configuredPoints) > 0) {
            problemPoints = Number(configuredPoints);
          }
        } catch (cpErr) {
          console.warn(`[JUDGE QUEUE] Error resolving contest problem points: ${cpErr.message}`);
        }
      }

      // 3. Perform isolated evaluation through Enhanced Validation Pipeline
      const verdictResult = await JudgeService.evaluateSubmission({
        submissionId: submission.id,
        language: submission.language,
        codingMode: submission.codingMode || (problem ? problem.codingMode : 'full_program'),
        sourceCode: submission.sourceCode,
        problem,
        testCases,
        problemPoints,
        isSampleRun,
      });

      // 4. Update submission in database with validation summary
      const updatedSubmission = await SubmissionModel.updateSubmission(submissionId, {
        status: verdictResult.status,
        score: verdictResult.score,
        executionTime: verdictResult.executionTime,
        memoryUsed: verdictResult.memoryUsed,
        errorMessage: verdictResult.errorMessage,
        testCasesPassed: verdictResult.testCasesPassed,
        testCasesTotal: verdictResult.testCasesTotal,
        validationSummary: verdictResult.validationSummary,
      });

      // Attach sample result diagnostics if present
      if (isSampleRun && verdictResult.sampleResults) {
        updatedSubmission.sampleResults = verdictResult.sampleResults;
      }

      this.emit('submission:evaluated', {
        submissionId,
        verdict: verdictResult,
        updatedSubmission,
      });

      // Asynchronously trigger Phase 5.7.1 skill recalculation hook without blocking judge worker
      if (!isSampleRun && updatedSubmission) {
        setImmediate(async () => {
          try {
            const SkillCalculationService = require('../../services/skillCalculationService');
            await SkillCalculationService.processSubmissionEvent(submissionId);
          } catch (skillErr) {
            console.warn('[SKILL ENGINE HOOK WARNING] Failed to calculate skills for submission ' + submissionId + ':', skillErr.message);
          }
        });
      }

      if (resolveCallback) {
        resolveCallback(updatedSubmission);
      }
    } catch (err) {
      console.error('[JUDGE WORKER EXCEPTION] Error processing submission ' + submissionId + ':', err);
      await SubmissionModel.updateSubmission(submissionId, {
        status: 'system_error',
        errorMessage: 'Internal Judge Worker Failure: ' + err.message,
      });
      if (resolveCallback) {
        resolveCallback({ status: 'system_error', errorMessage: err.message });
      }
    }
  }

  /**
   * Get queue status metrics
   */
  getMetrics() {
    return {
      queuedJobs: this.queue.length,
      runningWorkers: this.runningCount,
      activeJobs: Array.from(this.activeSubmissions),
      userActiveCount: Object.fromEntries(this.userActiveJobs.entries()),
      concurrencyLimit: this.concurrency,
      maxCapacity: this.maxCapacity,
    };
  }
}

// Singleton judge queue
const judgeQueue = new JudgeQueue(2);

module.exports = judgeQueue;
