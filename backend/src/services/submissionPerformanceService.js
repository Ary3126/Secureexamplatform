const SubmissionModel = require('../models/submissionModel');
const RATE_LIMIT_CONFIG = require('../config/rateLimitConfig');

const DEFAULT_MIN_SAMPLE_SIZE = 5;

/**
 * Service for computing and formatting submission performance statistics and percentiles
 * against the authoritative eligible dataset of accepted solutions (Phase 5.8.2 & 5.8.3).
 */
class SubmissionPerformanceService {
  /**
   * Get configured minimum sample size for percentile validity
   * @returns {number}
   */
  static getMinSampleSize() {
    return RATE_LIMIT_CONFIG?.PERFORMANCE?.minPercentileSampleSize || DEFAULT_MIN_SAMPLE_SIZE;
  }

  /**
   * Pure deterministic percentile calculation engine.
   *
   * Exact Mathematical Definition (Phase 5.8.3):
   * - Population: N accepted, non-sample submissions for the same problem & language.
   * - Direction: Lower runtime/memory is better.
   * - Formula: Percentile = round((count_slower / N) * 100, 2)
   * - Ties: Submissions with identical values are not slower than target (deterministic strictly-slower proportion).
   * - Minimum Sample Protection: If N < minSampleSize, returns available=false, reason='insufficient_data'.
   * - Clamping: Output is strictly clamped between 0.00 and 100.00 and rounded to 2 decimal places.
   *
   * @param {Object} params
   * @param {number|null} params.targetValue - Submission metric (runtimeMs or memoryKb)
   * @param {number} params.totalCount - Total eligible population size N
   * @param {number} params.slowerCount - Count of population items with value > targetValue
   * @param {boolean} [params.isEligible=true] - Whether target submission is valid/accepted
   * @param {number} [params.minSampleSize] - Minimum population threshold
   * @returns {{ percentile: number|null, available: boolean, reason?: string }}
   */
  static calculatePercentile({ targetValue, totalCount, slowerCount, isEligible = true, minSampleSize = null }) {
    const threshold = minSampleSize || this.getMinSampleSize();

    if (!isEligible || targetValue === null || targetValue === undefined || targetValue < 0) {
      return {
        percentile: null,
        available: false,
        reason: 'submission_not_eligible',
      };
    }

    const count = Number(totalCount || 0);
    const slower = Number(slowerCount || 0);

    if (count < threshold) {
      return {
        percentile: null,
        available: false,
        reason: 'insufficient_data',
      };
    }

    const rawPercentile = (slower / count) * 100;
    const clamped = Math.min(100.0, Math.max(0.0, rawPercentile));
    const rounded = Math.round(clamped * 100) / 100;

    return {
      percentile: rounded,
      available: true,
    };
  }

  /**
   * Compute runtime and memory performance statistics and percentiles for a given submission
   * relative to all accepted submissions for the same problem and language.
   *
   * @param {Object} submission - Authoritative submission record from DB
   * @returns {Promise<Object|null>} Formatted performance statistics and percentiles payload
   */
  static async getPerformanceStats(submission) {
    if (!submission || !submission.problemId || !submission.language) {
      return null;
    }

    const minSampleSize = this.getMinSampleSize();

    const targetRuntime =
      submission.executionTime !== undefined && submission.executionTime !== null
        ? Number(submission.executionTime)
        : null;

    const targetMemory =
      submission.memoryUsed !== undefined && submission.memoryUsed !== null
        ? Number(submission.memoryUsed)
        : null;

    const isTargetEligible =
      submission.status === 'accepted' &&
      submission.isSampleRun !== true &&
      targetRuntime !== null &&
      targetRuntime >= 0 &&
      targetMemory !== null &&
      targetMemory >= 0;

    // 1. Fetch aggregate benchmark statistics and percentile counts concurrently (Phase 5.8.6)
    const contestScope = submission.contestId !== undefined ? submission.contestId : undefined;

    const statsPromise = SubmissionModel.getProblemPerformanceStats(
      submission.problemId,
      submission.language,
      contestScope
    );

    const countsPromise = isTargetEligible
      ? SubmissionModel.getSubmissionPercentileCounts(
          submission.problemId,
          submission.language,
          targetRuntime,
          targetMemory,
          contestScope
        )
      : Promise.resolve(null);

    const [statsRow, countsRow] = await Promise.all([statsPromise, countsPromise]);
    const sampleCount = Number(statsRow?.sample_count || 0);

    const totalPopulation = Number(countsRow?.total_count || sampleCount || 0);
    const slowerRuntimeCount = Number(countsRow?.slower_runtime_count || 0);
    const higherMemoryCount = Number(countsRow?.higher_memory_count || 0);

    // 3. Compute deterministic percentiles with threshold guard and tie-handling
    const runtimePercentileObj = this.calculatePercentile({
      targetValue: targetRuntime,
      totalCount: totalPopulation,
      slowerCount: slowerRuntimeCount,
      isEligible: isTargetEligible,
      minSampleSize,
    });

    const memoryPercentileObj = this.calculatePercentile({
      targetValue: targetMemory,
      totalCount: totalPopulation,
      slowerCount: higherMemoryCount,
      isEligible: isTargetEligible,
      minSampleSize,
    });

    return {
      submission: {
        id: submission.id,
        runtimeMs: targetRuntime,
        memoryKb: targetMemory,
      },
      runtime: {
        sampleCount,
        minMs: sampleCount > 0 && statsRow?.min_runtime !== null ? Number(statsRow.min_runtime) : null,
        maxMs: sampleCount > 0 && statsRow?.max_runtime !== null ? Number(statsRow.max_runtime) : null,
        averageMs:
          sampleCount > 0 && statsRow?.avg_runtime !== null
            ? Math.round(Number(statsRow.avg_runtime) * 100) / 100
            : null,
        medianMs:
          sampleCount > 0 && statsRow?.median_runtime !== null
            ? Math.round(Number(statsRow.median_runtime) * 100) / 100
            : null,
        percentile: runtimePercentileObj.percentile,
        available: runtimePercentileObj.available,
        slowerCount: slowerRuntimeCount,
        equalCount: Number(countsRow?.equal_runtime_count || 0),
        fasterCount: Number(countsRow?.faster_runtime_count || 0),
        ...(runtimePercentileObj.reason ? { reason: runtimePercentileObj.reason } : {}),
      },
      memory: {
        sampleCount,
        minKb: sampleCount > 0 && statsRow?.min_memory !== null ? Number(statsRow.min_memory) : null,
        maxKb: sampleCount > 0 && statsRow?.max_memory !== null ? Number(statsRow.max_memory) : null,
        averageKb:
          sampleCount > 0 && statsRow?.avg_memory !== null
            ? Math.round(Number(statsRow.avg_memory) * 100) / 100
            : null,
        medianKb:
          sampleCount > 0 && statsRow?.median_memory !== null
            ? Math.round(Number(statsRow.median_memory) * 100) / 100
            : null,
        percentile: memoryPercentileObj.percentile,
        available: memoryPercentileObj.available,
        higherMemoryCount: higherMemoryCount,
        equalMemoryCount: Number(countsRow?.equal_memory_count || 0),
        lowerMemoryCount: Number(countsRow?.lower_memory_count || 0),
        ...(memoryPercentileObj.reason ? { reason: memoryPercentileObj.reason } : {}),
      },
      percentiles: {
        runtime: runtimePercentileObj,
        memory: memoryPercentileObj,
      },
      scope: {
        problemId: submission.problemId,
        language: submission.language,
        acceptedOnly: true,
        sampleRunsExcluded: true,
        minSampleSize,
      },
    };
  }

  /**
   * Get runtime percentile and comparison metrics for an authorized submission.
   * @param {Object} submission
   * @returns {Promise<Object>}
   */
  static async getRuntimePercentile(submission) {
    const stats = await this.getPerformanceStats(submission);
    if (!stats) return { available: false, reason: 'invalid_submission' };

    const targetRuntime = stats.submission?.runtimeMs;
    const runtime = stats.runtime;

    return {
      value: targetRuntime,
      unit: 'ms',
      percentile: runtime.percentile,
      population: runtime.sampleCount,
      language: submission.language,
      comparisonDirection: 'lower_is_better',
      available: runtime.available,
      ...(runtime.reason ? { reason: runtime.reason } : {}),
    };
  }

  /**
   * Get memory percentile and comparison metrics for an authorized submission.
   * @param {Object} submission
   * @returns {Promise<Object>}
   */
  static async getMemoryPercentile(submission) {
    const stats = await this.getPerformanceStats(submission);
    if (!stats) return { available: false, reason: 'invalid_submission' };

    const rawKb = stats.submission?.memoryKb;
    const memory = stats.memory;
    const valueMb = rawKb !== null && rawKb !== undefined ? Math.round((rawKb / 1024) * 10) / 10 : null;

    return {
      value: valueMb,
      unit: 'MB',
      rawKb,
      percentile: memory.percentile,
      population: memory.sampleCount,
      language: submission.language,
      comparisonDirection: 'lower_is_better',
      available: memory.available,
      ...(memory.reason ? { reason: memory.reason } : {}),
    };
  }

  /**
   * Get structured relative performance metrics matching Section 14 specification.
   * @param {Object} submission
   * @returns {Promise<Object>}
   */
  static async getRelativePerformance(submission) {
    const stats = await this.getPerformanceStats(submission);
    if (!stats) {
      return {
        available: false,
        reason: 'invalid_submission',
      };
    }

    // Phase 5.8.6 Optimization: Extract directly from stats without redundant re-queries
    const targetRuntime = stats.submission?.runtimeMs;
    const targetMemoryKb = stats.submission?.memoryKb;
    const targetMemoryMb =
      targetMemoryKb !== null && targetMemoryKb !== undefined
        ? Math.round((targetMemoryKb / 1024) * 10) / 10
        : null;

    const runtimeAvailable = Boolean(stats.runtime?.available);
    const memoryAvailable = Boolean(stats.memory?.available);
    const isAvailable = runtimeAvailable && memoryAvailable;

    return {
      available: isAvailable,
      submissionId: submission.id,
      problemId: submission.problemId,
      language: submission.language,
      runtime: {
        value: targetRuntime,
        unit: 'ms',
        percentile: stats.runtime.percentile,
        population: stats.runtime.sampleCount,
        language: submission.language,
        comparisonDirection: 'lower_is_better',
        available: runtimeAvailable,
        ...(stats.runtime.reason ? { reason: stats.runtime.reason } : {}),
      },
      memory: {
        value: targetMemoryMb,
        unit: 'MB',
        rawKb: targetMemoryKb,
        percentile: stats.memory.percentile,
        population: stats.memory.sampleCount,
        language: submission.language,
        comparisonDirection: 'lower_is_better',
        available: memoryAvailable,
        ...(stats.memory.reason ? { reason: stats.memory.reason } : {}),
      },
      ...(!isAvailable ? { reason: stats.runtime.reason || stats.memory.reason || 'insufficient_data' } : {}),
    };
  }

  /**
   * Deterministic bucket range generator for runtime and memory histograms.
   *
   * Rules:
   * - Strict integer bounds: [min, max]
   * - Contiguous: bucket[i+1].min = bucket[i].max + 1
   * - Zero gaps, zero overlaps
   * - Outlier protection: If maxVal > medianVal * 3.5 and maxVal > minVal + 50,
   *   allocates K normal buckets up to P_cap and 1 explicit overflow bucket [P_cap + 1, maxVal].
   *
   * @param {number} minVal - Minimum observed metric value
   * @param {number} maxVal - Maximum observed metric value
   * @param {number} medianVal - Median observed metric value
   * @param {string} unit - Metric unit ('ms' or 'KB')
   * @param {number} [targetBucketCount=6] - Target number of normal buckets
   * @returns {Array<Object>} Generated bucket definitions
   */
  static generateBucketRanges(minVal, maxVal, medianVal, unit = 'ms', targetBucketCount = 6) {
    const min = Math.max(0, Math.floor(Number(minVal) || 0));
    const max = Math.max(min, Math.ceil(Number(maxVal) || min));
    const median = Math.max(min, Number(medianVal) || min);

    // Case 1: All values identical
    if (min === max) {
      return [
        {
          index: 0,
          min,
          max,
          label: `${min} ${unit}`,
          isOverflow: false,
        },
      ];
    }

    // Case 2: Very small range (e.g. min=10, max=13)
    const totalSpan = max - min + 1;
    if (totalSpan <= targetBucketCount) {
      const buckets = [];
      for (let i = 0; i < totalSpan; i++) {
        const val = min + i;
        buckets.push({
          index: i,
          min: val,
          max: val,
          label: `${val} ${unit}`,
          isOverflow: false,
        });
      }
      return buckets;
    }

    // Case 3: Outlier detection & capped normal range
    let cap = max;
    let hasOverflow = false;
    const outlierThreshold = Math.max(min + 20, Math.round(median * 3.5));

    if (max > outlierThreshold && max > min + 50) {
      cap = outlierThreshold;
      hasOverflow = true;
    }

    const normalSpan = cap - min + 1;
    const K = targetBucketCount;
    const baseWidth = Math.floor(normalSpan / K);
    const remainder = normalSpan % K;

    const buckets = [];
    let currentMin = min;

    for (let i = 0; i < K; i++) {
      const width = baseWidth + (i < remainder ? 1 : 0);
      const currentMax = currentMin + width - 1;
      buckets.push({
        index: i,
        min: currentMin,
        max: currentMax,
        label: `${currentMin}–${currentMax} ${unit}`,
        isOverflow: false,
      });
      currentMin = currentMax + 1;
    }

    // Append overflow bucket if outliers exist
    if (hasOverflow) {
      buckets.push({
        index: K,
        min: currentMin,
        max,
        label: `>${cap} ${unit}`,
        isOverflow: true,
      });
    }

    return buckets;
  }

  /**
   * Compute authoritative runtime and memory distribution histograms for an authorized submission.
   *
   * Reuses getProblemPerformanceStats, getMinSampleSize, and calculatePercentile.
   * Executes single PostgreSQL aggregation query for all bucket counts.
   *
   * @param {Object} submission
   * @returns {Promise<Object>}
   */
  static async getPerformanceDistribution(submission) {
    if (!submission || !submission.problemId || !submission.language) {
      return { available: false, reason: 'invalid_submission' };
    }

    const minSampleSize = this.getMinSampleSize();
    const contestScope = submission.contestId !== undefined ? submission.contestId : undefined;

    // 1. Fetch benchmark aggregates via single optimized query
    const statsRow = await SubmissionModel.getProblemPerformanceStats(
      submission.problemId,
      submission.language,
      contestScope
    );

    const sampleCount = Number(statsRow?.sample_count || 0);

    if (sampleCount < minSampleSize) {
      return {
        available: false,
        reason: 'insufficient_data',
        sampleCount,
        minSampleSize,
      };
    }

    const targetRuntime =
      submission.executionTime !== undefined && submission.executionTime !== null
        ? Number(submission.executionTime)
        : null;

    const targetMemory =
      submission.memoryUsed !== undefined && submission.memoryUsed !== null
        ? Number(submission.memoryUsed)
        : null;

    const isEligible =
      submission.status === 'accepted' &&
      submission.isSampleRun !== true &&
      targetRuntime !== null &&
      targetRuntime >= 0 &&
      targetMemory !== null &&
      targetMemory >= 0;

    if (!isEligible) {
      return {
        available: false,
        reason: 'submission_not_eligible',
        sampleCount,
      };
    }

    // 2. Extract aggregate values
    const minRuntime = Number(statsRow.min_runtime);
    const maxRuntime = Number(statsRow.max_runtime);
    const avgRuntime = Math.round(Number(statsRow.avg_runtime) * 100) / 100;
    const medianRuntime = Math.round(Number(statsRow.median_runtime) * 100) / 100;

    const minMemory = Number(statsRow.min_memory);
    const maxMemory = Number(statsRow.max_memory);
    const avgMemory = Math.round(Number(statsRow.avg_memory) * 100) / 100;
    const medianMemory = Math.round(Number(statsRow.median_memory) * 100) / 100;

    // 3. Generate authoritative deterministic bucket boundaries
    const runtimeBuckets = this.generateBucketRanges(minRuntime, maxRuntime, medianRuntime, 'ms');
    const memoryBuckets = this.generateBucketRanges(minMemory, maxMemory, medianMemory, 'KB');

    // 4. Phase 5.8.6 Optimization: Execute distribution bucket counts and percentile counts concurrently
    const [countsRow, percentileCountsRow] = await Promise.all([
      SubmissionModel.getDistributionBucketCounts(
        submission.problemId,
        submission.language,
        runtimeBuckets,
        memoryBuckets,
        contestScope
      ),
      SubmissionModel.getSubmissionPercentileCounts(
        submission.problemId,
        submission.language,
        targetRuntime,
        targetMemory,
        contestScope
      ),
    ]);

    // 5. Compute percentiles directly from percentileCountsRow without re-querying stats
    const runtimePercentileObj = this.calculatePercentile({
      targetValue: targetRuntime,
      totalCount: sampleCount,
      slowerCount: Number(percentileCountsRow?.slower_runtime_count || 0),
      isEligible: true,
      minSampleSize,
    });

    const memoryPercentileObj = this.calculatePercentile({
      targetValue: targetMemory,
      totalCount: sampleCount,
      slowerCount: Number(percentileCountsRow?.higher_memory_count || 0),
      isEligible: true,
      minSampleSize,
    });

    // 6. Map counts, percentages, and user bucket flags
    let userRuntimeBucketIndex = null;
    const formattedRuntimeBuckets = runtimeBuckets.map((b, idx) => {
      const count = Number(countsRow[`r_b${idx}`] || 0);
      const percentage = sampleCount > 0 ? Math.round((count / sampleCount) * 1000) / 10 : 0;
      const isUserBucket = targetRuntime !== null && targetRuntime >= b.min && targetRuntime <= b.max;
      if (isUserBucket) {
        userRuntimeBucketIndex = idx;
      }
      return {
        index: idx,
        min: b.min,
        max: b.max,
        label: b.label,
        count,
        percentage,
        isUserBucket,
        isOverflow: b.isOverflow,
      };
    });

    let userMemoryBucketIndex = null;
    const formattedMemoryBuckets = memoryBuckets.map((b, idx) => {
      const count = Number(countsRow[`m_b${idx}`] || 0);
      const percentage = sampleCount > 0 ? Math.round((count / sampleCount) * 1000) / 10 : 0;
      const isUserBucket = targetMemory !== null && targetMemory >= b.min && targetMemory <= b.max;
      if (isUserBucket) {
        userMemoryBucketIndex = idx;
      }

      // Readable MB formatting for memory labels
      const minMb = (b.min / 1024).toFixed(1);
      const maxMb = (b.max / 1024).toFixed(1);
      const formattedLabel = b.isOverflow
        ? `>${(b.min / 1024).toFixed(1)} MB`
        : b.min === b.max
        ? `${minMb} MB`
        : `${minMb}–${maxMb} MB`;

      return {
        index: idx,
        min: b.min,
        max: b.max,
        label: formattedLabel,
        rawLabel: b.label,
        count,
        percentage,
        isUserBucket,
        isOverflow: b.isOverflow,
      };
    });

    return {
      available: true,
      submissionId: submission.id,
      problemId: submission.problemId,
      language: submission.language,
      population: sampleCount,
      runtime: {
        metric: 'runtime',
        unit: 'ms',
        userValue: targetRuntime,
        userBucketIndex: userRuntimeBucketIndex,
        min: minRuntime,
        max: maxRuntime,
        average: avgRuntime,
        median: medianRuntime,
        percentile: runtimePercentileObj.percentile,
        buckets: formattedRuntimeBuckets,
      },
      memory: {
        metric: 'memory',
        unit: 'KB',
        userValue: targetMemory,
        userBucketIndex: userMemoryBucketIndex,
        userValueMb: targetMemory !== null ? Math.round((targetMemory / 1024) * 10) / 10 : null,
        min: minMemory,
        max: maxMemory,
        average: avgMemory,
        median: medianMemory,
        percentile: memoryPercentileObj.percentile,
        buckets: formattedMemoryBuckets,
      },
    };
  }

  /**
   * Phase 5.8.5: Compare two submissions side-by-side.
   *
   * Enforces:
   * 1. Same-problem requirement.
   * 2. Honest language-isolated comparison (no cross-language superiority claims).
   * 3. Independent metadata vs source-code viewing permissions.
   * 4. Safe metric difference calculations and human-readable summaries.
   *
   * @param {Object} submissionLeft - Authoritative left submission record
   * @param {Object} submissionRight - Authoritative right submission record
   * @param {Object} user - Authenticated viewer { id, role }
   * @returns {Promise<Object>}
   */
  static async compareSubmissions(submissionLeft, submissionRight, user) {
    if (!submissionLeft || !submissionRight) {
      const err = new Error('Both submissions must be provided for comparison');
      err.statusCode = 400;
      throw err;
    }

    // 1. Same-Problem Validation
    if (Number(submissionLeft.problemId) !== Number(submissionRight.problemId)) {
      const err = new Error(
        `Cannot compare submissions across different problems. Both submissions must belong to problem ID ${submissionLeft.problemId}.`
      );
      err.statusCode = 400;
      throw err;
    }

    // 2. Build metadata for Left
    const leftAccepted = submissionLeft.status === 'accepted';
    const leftRuntime = leftAccepted && submissionLeft.executionTime !== null ? Number(submissionLeft.executionTime) : null;
    const leftMemory = leftAccepted && submissionLeft.memoryUsed !== null ? Number(submissionLeft.memoryUsed) : null;

    const leftMeta = {
      submissionId: submissionLeft.id,
      verdict: submissionLeft.status,
      language: submissionLeft.language,
      codingMode: submissionLeft.codingMode || 'full_program',
      runtime: leftRuntime,
      memory: leftMemory,
      memoryMb: leftMemory !== null ? Math.round((leftMemory / 1024) * 10) / 10 : null,
      testsPassed: submissionLeft.testCasesPassed ?? (leftAccepted ? submissionLeft.testCasesTotal : 0),
      testsTotal: submissionLeft.testCasesTotal ?? 0,
      score: submissionLeft.score ?? 0,
      submittedAt: submissionLeft.createdAt,
    };

    // 3. Build metadata for Right
    const rightAccepted = submissionRight.status === 'accepted';
    const rightRuntime = rightAccepted && submissionRight.executionTime !== null ? Number(submissionRight.executionTime) : null;
    const rightMemory = rightAccepted && submissionRight.memoryUsed !== null ? Number(submissionRight.memoryUsed) : null;

    const rightMeta = {
      submissionId: submissionRight.id,
      verdict: submissionRight.status,
      language: submissionRight.language,
      codingMode: submissionRight.codingMode || 'full_program',
      runtime: rightRuntime,
      memory: rightMemory,
      memoryMb: rightMemory !== null ? Math.round((rightMemory / 1024) * 10) / 10 : null,
      testsPassed: submissionRight.testCasesPassed ?? (rightAccepted ? submissionRight.testCasesTotal : 0),
      testsTotal: submissionRight.testCasesTotal ?? 0,
      score: submissionRight.score ?? 0,
      submittedAt: submissionRight.createdAt,
    };

    // Optional percentiles enrichment for accepted submissions
    if (leftAccepted) {
      try {
        const leftPerf = await this.getRelativePerformance(submissionLeft);
        if (leftPerf && leftPerf.available) {
          leftMeta.runtimePercentile = leftPerf.runtime?.percentile ?? null;
          leftMeta.memoryPercentile = leftPerf.memory?.percentile ?? null;
          leftMeta.population = leftPerf.population ?? null;
        }
      } catch (e) {}
    }

    if (rightAccepted) {
      try {
        const rightPerf = await this.getRelativePerformance(submissionRight);
        if (rightPerf && rightPerf.available) {
          rightMeta.runtimePercentile = rightPerf.runtime?.percentile ?? null;
          rightMeta.memoryPercentile = rightPerf.memory?.percentile ?? null;
          rightMeta.population = rightPerf.population ?? null;
        }
      } catch (e) {}
    }

    // 4. Language & Metric Comparisons
    const sameLanguage =
      String(submissionLeft.language || '').toLowerCase() === String(submissionRight.language || '').toLowerCase();

    let runtimeDifference = null;
    let memoryDifference = null;
    let memoryDifferenceMb = null;
    let runtimeSummary = 'Unavailable';
    let memorySummary = 'Unavailable';

    if (sameLanguage) {
      if (leftMeta.runtime !== null && rightMeta.runtime !== null) {
        runtimeDifference = leftMeta.runtime - rightMeta.runtime; // Negative means Left is faster
        if (runtimeDifference < 0) {
          runtimeSummary = `Submission A is ${Math.abs(runtimeDifference)} ms faster`;
        } else if (runtimeDifference > 0) {
          runtimeSummary = `Submission B is ${runtimeDifference} ms faster`;
        } else {
          runtimeSummary = 'Identical runtime';
        }
      } else {
        runtimeSummary = 'Runtime comparison unavailable (non-accepted or missing metric)';
      }

      if (leftMeta.memory !== null && rightMeta.memory !== null) {
        memoryDifference = leftMeta.memory - rightMeta.memory;
        const diffMb = Math.round((Math.abs(memoryDifference) / 1024) * 10) / 10;
        memoryDifferenceMb = Math.round((memoryDifference / 1024) * 10) / 10;
        if (memoryDifference < 0) {
          memorySummary = `Submission A uses ${diffMb} MB less memory`;
        } else if (memoryDifference > 0) {
          memorySummary = `Submission B uses ${diffMb} MB less memory`;
        } else {
          memorySummary = 'Identical memory usage';
        }
      } else {
        memorySummary = 'Memory comparison unavailable (non-accepted or missing metric)';
      }
    } else {
      runtimeSummary = `Different languages (${submissionLeft.language.toUpperCase()} vs ${submissionRight.language.toUpperCase()}) — direct runtime comparison not applicable`;
      memorySummary = `Different languages (${submissionLeft.language.toUpperCase()} vs ${submissionRight.language.toUpperCase()}) — direct memory comparison not applicable`;
    }

    const testsPassedDifference =
      leftMeta.testsPassed !== null && rightMeta.testsPassed !== null
        ? leftMeta.testsPassed - rightMeta.testsPassed
        : null;

    // 5. Independent Source Code Visibility Permissions
    const canViewCode = (sub) => {
      if (!user) return false;
      if (user.role === 'super_admin') return true;
      if (user.role === 'professor') {
        return (
          sub.contestCreatorId === user.id ||
          sub.problemCreatorId === user.id ||
          sub.userId === user.id
        );
      }
      if (user.role === 'student') {
        return sub.userId === user.id;
      }
      return false;
    };

    const sourceCode = {
      leftVisible: canViewCode(submissionLeft),
      rightVisible: canViewCode(submissionRight),
    };

    return {
      problem: {
        id: submissionLeft.problemId,
        title: submissionLeft.problemTitle || `Problem #${submissionLeft.problemId}`,
        difficulty: submissionLeft.problemDifficulty || 'easy',
      },
      left: leftMeta,
      right: rightMeta,
      comparison: {
        sameProblem: true,
        sameLanguage,
        verdictMatch: leftMeta.verdict === rightMeta.verdict,
        runtimeDifference,
        runtimeSummary,
        memoryDifference,
        memoryDifferenceMb,
        memorySummary,
        testsPassedDifference,
      },
      sourceCode,
    };
  }
}

module.exports = SubmissionPerformanceService;
