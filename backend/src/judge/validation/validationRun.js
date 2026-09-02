/**
 * ValidationRun - Lightweight internal abstraction and deterministic state machine for submission validation lifecycle
 */
const VALIDATION_STAGES = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  COMPILATION: 'COMPILATION',
  STANDARD: 'STANDARD',
  RANDOM: 'RANDOM',
  EDGE: 'EDGE',
  BOUNDARY: 'BOUNDARY',
  SUSPICION_ANALYSIS: 'SUSPICION_ANALYSIS',
  ADDITIONAL_VALIDATION: 'ADDITIONAL_VALIDATION',
  FINALIZATION: 'FINALIZATION',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

// Deterministic Verdict Priority Order (Higher priority overrides lower)
const VERDICT_PRIORITY = Object.freeze({
  system_error: 60,
  compilation_error: 50,
  time_limit_exceeded: 40,
  memory_limit_exceeded: 40,
  runtime_error: 30,
  wrong_answer: 20,
  accepted: 10,
  running: 0,
  queued: 0,
});

class ValidationRun {
  /**
   * Initialize a new validation run lifecycle
   * @param {Object} options - { submissionId, problemId, validationConfig }
   */
  constructor({ submissionId, problemId, validationConfig = null }) {
    this.submissionId = submissionId;
    this.problemId = problemId;
    this.validationConfig = validationConfig;
    this.currentStage = VALIDATION_STAGES.INITIALIZING;
    this.finalStatus = 'running';
    this.failureStage = null;
    this.failureReason = null;

    this.standardPassed = 0;
    this.standardTotal = 0;
    this.randomPassed = 0;
    this.randomTotal = 0;
    this.edgePassed = 0;
    this.edgeTotal = 0;
    this.boundaryPassed = 0;
    this.boundaryTotal = 0;

    this.suspicionScore = 0;
    this.suspicionLevel = 'LOW';
    this.isFlagged = false;
    this.antiHardcodingReport = null;

    this.maxExecutionTimeMs = 0;
    this.maxMemoryUsedKb = 0;

    this.stageStartTimes = new Map();
    this.stageDurations = {};
    this.createdAt = new Date();
  }

  /**
   * Transition state machine into a new stage
   * @param {string} stageName
   */
  startStage(stageName) {
    this.currentStage = stageName;
    this.stageStartTimes.set(stageName, Date.now());
  }

  /**
   * Conclude a stage and record its execution duration in milliseconds
   * @param {string} stageName
   */
  endStage(stageName) {
    const startTime = this.stageStartTimes.get(stageName);
    if (startTime) {
      this.stageDurations[stageName] = Date.now() - startTime;
    }
  }

  /**
   * Update performance metrics with high-water mark tracking
   * @param {number} timeMs
   * @param {number} memKb
   */
  updateResourceMetrics(timeMs = 0, memKb = 0) {
    this.maxExecutionTimeMs = Math.max(this.maxExecutionTimeMs, timeMs || 0);
    this.maxMemoryUsedKb = Math.max(this.maxMemoryUsedKb, memKb || 0);
  }

  /**
   * Deterministically assign verdict based on priority rules
   * @param {string} candidateStatus
   * @param {string} errorMessage
   * @param {string} stage
   */
  setVerdict(candidateStatus, errorMessage = null, stage = null) {
    const currentPriority = VERDICT_PRIORITY[this.finalStatus] || 0;
    const candidatePriority = VERDICT_PRIORITY[candidateStatus] || 0;

    if (candidatePriority >= currentPriority || this.finalStatus === 'running') {
      this.finalStatus = candidateStatus;
      if (errorMessage) this.failureReason = errorMessage;
      if (stage) this.failureStage = stage;
    }
  }

  /**
   * Determine if the pipeline should stop early due to a definitive student or system failure
   * @returns {boolean}
   */
  shouldStopEarly() {
    return this.finalStatus !== 'running' && this.finalStatus !== 'accepted';
  }

  /**
   * Convert run metrics into client-facing and database-compatible validation summary object
   * @returns {Object}
   */
  toSummary() {
    return {
      validationEnabled: Boolean(this.validationConfig?.validationEnabled),
      generatorType: this.validationConfig?.generatorType || 'default',
      stages: {
        standard: this.standardTotal > 0 && this.standardPassed === this.standardTotal ? 'passed' : (this.failureStage === 'STANDARD' ? 'failed' : 'pending'),
        random: this.validationConfig?.randomEnabled ? (this.randomTotal > 0 && this.randomPassed === this.randomTotal ? 'passed' : (this.failureStage === 'RANDOM' ? 'failed' : 'pending')) : 'disabled',
        edge: this.validationConfig?.edgeEnabled ? (this.edgeTotal > 0 && this.edgePassed === this.edgeTotal ? 'passed' : (this.failureStage === 'EDGE' ? 'failed' : 'pending')) : 'disabled',
        boundary: this.validationConfig?.boundaryEnabled ? (this.boundaryTotal > 0 && this.boundaryPassed === this.boundaryTotal ? 'passed' : (this.failureStage === 'BOUNDARY' ? 'failed' : 'pending')) : 'disabled',
      },
            randomValidation: this.validationConfig?.randomEnabled ? {
        totalGenerated: this.randomTotal,
        passed: this.randomPassed,
        status: (this.randomTotal > 0 && this.randomPassed === this.randomTotal) ? 'passed' : (this.failureStage === 'RANDOM' ? 'failed' : 'pending'),
      } : null,
      edgeValidation: this.validationConfig?.edgeEnabled ? {
        totalGenerated: this.edgeTotal,
        passed: this.edgePassed,
        status: (this.edgeTotal > 0 && this.edgePassed === this.edgeTotal) ? 'passed' : (this.failureStage === 'EDGE' ? 'failed' : 'pending'),
      } : null,
      boundaryValidation: this.validationConfig?.boundaryEnabled ? {
        totalGenerated: this.boundaryTotal,
        passed: this.boundaryPassed,
        status: (this.boundaryTotal > 0 && this.boundaryPassed === this.boundaryTotal) ? 'passed' : (this.failureStage === 'BOUNDARY' ? 'failed' : 'pending'),
      } : null,
      metrics: {
        standard: { passed: this.standardPassed, total: this.standardTotal },
        random: { passed: this.randomPassed, total: this.randomTotal },
        edge: { passed: this.edgePassed, total: this.edgeTotal },
        boundary: { passed: this.boundaryPassed, total: this.boundaryTotal },
      },
      antiHardcoding: this.antiHardcodingReport ? {
        suspicionScore: this.antiHardcodingReport.suspicionScore,
        suspicionLevel: this.antiHardcodingReport.suspicionLevel,
        signals: this.antiHardcodingReport.signals,
        isFlagged: this.antiHardcodingReport.isFlagged,
      } : null,
      stageDurations: this.stageDurations,
      failureStage: this.failureStage,
    };
  }
}

module.exports = {
  ValidationRun,
  VALIDATION_STAGES,
  VERDICT_PRIORITY,
};