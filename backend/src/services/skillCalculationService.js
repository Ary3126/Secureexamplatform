const db = require('../config/db');
const TopicModel = require('../models/topicModel');
const UserSkillModel = require('../models/userSkillModel');
const UserSkillHistoryModel = require('../models/userSkillHistoryModel');

/**
 * @typedef {Object} SkillEvidence
 * @property {number} topicId
 * @property {string} topicKey
 * @property {string} topicName
 * @property {number} problemId
 * @property {string} problemTitle
 * @property {string} problemDifficulty
 * @property {number} submissionId
 * @property {string} verdict
 * @property {boolean} isAccepted
 * @property {Date} timestamp
 */

/**
 * @typedef {Object} AggregatedEvidence
 * @property {number} distinctProblemsAttempted
 * @property {number} distinctProblemsSolved
 * @property {number} successfulEvidence
 * @property {number} failedEvidence
 * @property {number} totalAttempts
 * @property {number} recentEvidence
 * @property {Date|null} lastAttemptAt
 * @property {Date|null} lastSolvedAt
 * @property {Date|null} evidenceUpdatedAt
 */

/**
 * SkillCalculationService
 * 
 * Authoritative, deterministic skill scoring and confidence engine (Phase 5.7.3).
 * Separates measured performance (Skill Score: 0-100) from evidence strength (Confidence: 0-100).
 * 
 * 1. Skill Score: Evaluates problem difficulty, recency decay, attempt efficiency, and breadth limits.
 * 2. Confidence: Evaluates distinct problem diversity, volume, outcome consistency, and recency support.
 * 3. Evidence: Aggregates distinct problem metrics, preventing submission spam from inflating ratings.
 * 4. Versioning: Explicitly versioned with CALCULATION_VERSION = 3.
 */
class SkillCalculationService {
  /**
   * Current calculation algorithm version (Phase 5.7.3)
   */
  static CALCULATION_VERSION = 3;

  /**
   * Problem difficulty weights
   */
  static DIFFICULTY_WEIGHTS = Object.freeze({
    easy: 1.0,
    medium: 2.0,
    hard: 3.5,
  });

  /**
   * Base score points per solved problem unit
   */
  static BASE_PROBLEM_POINTS = 15.0;

  /**
   * Recency decay tiers for skill score (days elapsed -> multiplier)
   */
  static RECENCY_TIERS = Object.freeze([
    { maxDays: 14, weight: 1.00 },
    { maxDays: 45, weight: 0.90 },
    { maxDays: 90, weight: 0.80 },
    { maxDays: 180, weight: 0.70 },
    { maxDays: Infinity, weight: 0.60 },
  ]);

  /**
   * 1. DATA COLLECTION
   * Collects raw submission evidence for a user across a specific topic or all topics
   * 
   * @param {number} userId
   * @param {number|null} topicId - Optional filter by specific topic
   * @returns {Promise<Array<SkillEvidence>>}
   */
  static async collectSkillEvidence(userId, topicId = null) {
    let queryText = `
      SELECT 
        pt.topic_id AS "topicId",
        t.key AS "topicKey",
        t.name AS "topicName",
        p.id AS "problemId",
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        s.id AS "submissionId",
        s.status AS "verdict",
        (s.status = 'accepted') AS "isAccepted",
        s.created_at AS "timestamp"
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      JOIN problem_topics pt ON p.id = pt.problem_id
      JOIN topics t ON pt.topic_id = t.id
      WHERE s.user_id = $1 
        AND s.is_sample_run = false
        AND s.status NOT IN ('queued', 'running')
    `;

    const params = [userId];

    if (topicId) {
      params.push(topicId);
      queryText += ` AND pt.topic_id = $2`;
    }

    queryText += ` ORDER BY s.created_at ASC;`;

    const res = await db.query(queryText, params);
    return res.rows.map((row) => ({
      topicId: Number(row.topicId),
      topicKey: row.topicKey,
      topicName: row.topicName,
      problemId: Number(row.problemId),
      problemTitle: row.problemTitle,
      problemDifficulty: row.problemDifficulty,
      submissionId: Number(row.submissionId),
      verdict: row.verdict,
      isAccepted: Boolean(row.isAccepted),
      timestamp: new Date(row.timestamp),
    }));
  }

  /**
   * Resolve difficulty weight safely
   * @param {string} difficulty
   * @returns {number}
   */
  static calculateDifficultyWeight(difficulty) {
    if (!difficulty || typeof difficulty !== 'string') {
      return this.DIFFICULTY_WEIGHTS.easy;
    }
    const normalized = difficulty.trim().toLowerCase();
    return this.DIFFICULTY_WEIGHTS[normalized] || this.DIFFICULTY_WEIGHTS.easy;
  }

  /**
   * Calculate deterministic recency decay multiplier for skill scoring
   * @param {Date|string|number} date
   * @param {Date} referenceDate
   * @returns {number}
   */
  static calculateRecencyWeight(date, referenceDate = new Date()) {
    if (!date) return 0.60;
    const itemTime = new Date(date).getTime();
    if (isNaN(itemTime)) return 0.60;

    const refTime = new Date(referenceDate).getTime();
    const daysElapsed = Math.max(0, (refTime - itemTime) / (1000 * 60 * 60 * 24));

    for (const tier of this.RECENCY_TIERS) {
      if (daysElapsed <= tier.maxDays) {
        return tier.weight;
      }
    }
    return 0.60;
  }

  /**
   * Calculate attempt efficiency factor for a solved problem
   * @param {number} attempts
   * @returns {number}
   */
  static calculateAttemptEfficiency(attempts) {
    if (!attempts || attempts <= 2) return 1.00;
    if (attempts <= 5) return 0.90;
    return 0.80;
  }

  /**
   * 2. EVIDENCE AGGREGATION (Phase 5.7.3)
   * Aggregates raw submission evidence into a structured, explainable summary.
   * Prevents submission spamming from inflating distinct problem metrics.
   * 
   * @param {Array<SkillEvidence>} evidenceList
   * @param {Date} referenceDate
   * @returns {AggregatedEvidence}
   */
  static aggregateEvidence(evidenceList = [], referenceDate = new Date()) {
    if (!evidenceList || evidenceList.length === 0) {
      return {
        distinctProblemsAttempted: 0,
        distinctProblemsSolved: 0,
        successfulEvidence: 0,
        failedEvidence: 0,
        totalAttempts: 0,
        recentEvidence: 0,
        lastAttemptAt: null,
        lastSolvedAt: null,
        evidenceUpdatedAt: null,
      };
    }

    const refTime = new Date(referenceDate).getTime();
    const problemMap = new Map();
    let successfulEvidence = 0;
    let failedEvidence = 0;
    let lastAttemptAt = null;
    let lastSolvedAt = null;

    for (const ev of evidenceList) {
      const pId = ev.problemId;
      if (!problemMap.has(pId)) {
        problemMap.set(pId, {
          problemId: pId,
          attempts: 0,
          isSolved: false,
          lastAttemptAt: null,
          lastSolvedAt: null,
        });
      }

      const pData = problemMap.get(pId);
      pData.attempts += 1;

      if (!pData.lastAttemptAt || ev.timestamp > pData.lastAttemptAt) {
        pData.lastAttemptAt = ev.timestamp;
      }
      if (!lastAttemptAt || ev.timestamp > lastAttemptAt) {
        lastAttemptAt = ev.timestamp;
      }

      if (ev.isAccepted) {
        successfulEvidence += 1;
        pData.isSolved = true;
        if (!pData.lastSolvedAt || ev.timestamp > pData.lastSolvedAt) {
          pData.lastSolvedAt = ev.timestamp;
        }
        if (!lastSolvedAt || ev.timestamp > lastSolvedAt) {
          lastSolvedAt = ev.timestamp;
        }
      } else {
        failedEvidence += 1;
      }
    }

    let distinctProblemsSolved = 0;
    let recentEvidence = 0;

    for (const pData of problemMap.values()) {
      if (pData.isSolved) {
        distinctProblemsSolved += 1;
        if (pData.lastSolvedAt) {
          const daysSinceSolve = Math.max(0, (refTime - new Date(pData.lastSolvedAt).getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceSolve <= 90) {
            recentEvidence += 1;
          }
        }
      }
    }

    return {
      distinctProblemsAttempted: problemMap.size,
      distinctProblemsSolved,
      successfulEvidence,
      failedEvidence,
      totalAttempts: evidenceList.length,
      recentEvidence,
      lastAttemptAt,
      lastSolvedAt,
      evidenceUpdatedAt: lastAttemptAt || new Date(),
    };
  }

  /**
   * Aggregate problem outcomes from raw submission evidence for skill score calculation.
   * Deduplicates multiple attempts on the same problem to prevent farming.
   * 
   * @param {Array<SkillEvidence>} evidenceList
   * @param {Date} referenceDate
   * @returns {Array<Object>}
   */
  static aggregateProblemOutcomes(evidenceList = [], referenceDate = new Date()) {
    const problemMap = new Map();

    for (const ev of evidenceList) {
      if (!problemMap.has(ev.problemId)) {
        problemMap.set(ev.problemId, {
          problemId: ev.problemId,
          difficulty: ev.problemDifficulty,
          difficultyWeight: this.calculateDifficultyWeight(ev.problemDifficulty),
          attempts: 0,
          failedAttempts: 0,
          isSolved: false,
          lastAttemptAt: null,
          lastSolvedAt: null,
        });
      }

      const pData = problemMap.get(ev.problemId);
      pData.attempts += 1;

      if (!pData.lastAttemptAt || ev.timestamp > pData.lastAttemptAt) {
        pData.lastAttemptAt = ev.timestamp;
      }

      if (ev.isAccepted) {
        pData.isSolved = true;
        if (!pData.lastSolvedAt || ev.timestamp > pData.lastSolvedAt) {
          pData.lastSolvedAt = ev.timestamp;
        }
      } else {
        pData.failedAttempts += 1;
      }
    }

    const aggregated = [];
    for (const pData of problemMap.values()) {
      let problemPoints = 0.00;

      if (pData.isSolved) {
        const basePoints = this.BASE_PROBLEM_POINTS * pData.difficultyWeight;
        const efficiency = this.calculateAttemptEfficiency(pData.attempts);
        const recency = this.calculateRecencyWeight(pData.lastSolvedAt || pData.lastAttemptAt, referenceDate);
        problemPoints = basePoints * efficiency * recency;
      }

      aggregated.push({
        ...pData,
        problemPoints,
      });
    }

    return aggregated;
  }

  /**
   * Calculate accuracy factor to reward clean solves and mitigate excessive failed spam
   * @param {number} solvedCount
   * @param {number} failedCount
   * @returns {number}
   */
  static calculateAccuracyFactor(solvedCount, failedCount) {
    if (solvedCount === 0) return 0.00;
    const factor = solvedCount / (solvedCount + 0.15 * failedCount);
    return Math.max(0.60, Math.min(1.00, factor));
  }

  /**
   * Calculate breadth ceiling to require multi-problem depth for high skill tiers
   * @param {number} solvedCount
   * @returns {number}
   */
  static calculateBreadthCap(solvedCount) {
    if (solvedCount <= 0) return 0.00;
    if (solvedCount >= 4) return 100.00;
    return Math.min(100.00, 15.00 + 20.00 * solvedCount);
  }

  /**
   * Determine skill level based on 0-100 bounded score
   * @param {number} score
   * @returns {string}
   */
  static calculateLevel(score) {
    if (score >= 90.0) return 'EXPERT';
    if (score >= 70.0) return 'ADVANCED';
    if (score >= 45.0) return 'PROFICIENT';
    if (score >= 20.0) return 'DEVELOPING';
    return 'BEGINNER';
  }

  /**
   * 3. CONFIDENCE CALCULATION ENGINE (Phase 5.7.3)
   * Evaluates evidence records and produces a deterministic 0-100 bounded confidence metric.
   * Measures the volume, diversity, quality, and recency of authoritative evidence.
   * 
   * @param {Array<SkillEvidence>} evidenceList
   * @param {Date} referenceDate
   * @returns {number} Bounded confidence value (0.00 - 100.00)
   */
  static calculateConfidence(evidenceList = [], referenceDate = new Date()) {
    if (!evidenceList || evidenceList.length === 0) {
      return 0.00;
    }

    const evidence = this.aggregateEvidence(evidenceList, referenceDate);
    if (evidence.totalAttempts === 0) {
      return 0.00;
    }

    const dSol = evidence.distinctProblemsSolved;
    const dAtt = evidence.distinctProblemsAttempted;
    const aTot = evidence.totalAttempts;

    // 1. Problem Diversity Component (up to 50 pts) - 4 solves reaches 50 pts
    const diversityComponent = Math.min(50.00, 12.50 * dSol);

    // 2. Attempt & Solve Volume Component (up to 25 pts)
    // - Distinct attempted problems: up to 15 pts (5 problems = 15 pts)
    // - Submissions volume with strict cap: up to 10 pts (diminishing return to prevent spam)
    const distinctAttemptContrib = Math.min(15.00, 3.00 * dAtt);
    const submissionVolumeContrib = Math.min(10.00, 1.00 * aTot);
    const volumeComponent = Math.min(25.00, distinctAttemptContrib + submissionVolumeContrib);

    // 3. Evidence Quality / Outcome Consistency Component (up to 15 pts)
    const solveRatio = dAtt > 0 ? (dSol / dAtt) : 0.00;
    const qualityScaling = Math.min(1.0, dSol / 2.0); // requires at least 2 solves to reach max scaling
    const qualityComponent = 15.00 * solveRatio * qualityScaling;

    // 4. Recency Support Component (up to 10 pts)
    let recencyComponent = 0.00;
    if (dSol > 0 && evidence.lastSolvedAt) {
      const refTime = new Date(referenceDate).getTime();
      const lastSolvedTime = new Date(evidence.lastSolvedAt).getTime();
      const daysElapsed = Math.max(0, (refTime - lastSolvedTime) / (1000 * 60 * 60 * 24));

      if (daysElapsed <= 30) {
        recencyComponent = 10.00;
      } else if (daysElapsed <= 90) {
        recencyComponent = 7.00;
      } else if (daysElapsed <= 180) {
        recencyComponent = 4.00;
      } else {
        recencyComponent = 2.00;
      }
    }

    const rawConfidence = diversityComponent + volumeComponent + qualityComponent + recencyComponent;
    const boundedConfidence = Math.min(100.00, Math.max(0.00, rawConfidence));

    return Number.isFinite(boundedConfidence) ? Math.round(boundedConfidence * 100) / 100 : 0.00;
  }

  /**
   * Centralized Deterministic Classification Thresholds (Phase 5.7.5)
   */
  static CLASSIFICATION_THRESHOLDS = {
    MIN_CONFIDENCE_STRENGTH: 45.00,       // Minimum confidence required to confirm a genuine STRENGTH
    MIN_SCORE_STRENGTH: 65.00,            // Score threshold for STRENGTH (Proficient/Advanced/Expert)
    HIGH_SCORE_STRENGTH: 80.00,           // Exceptional score threshold
    HIGH_SCORE_MIN_CONFIDENCE: 40.00,     // Confidence required for exceptional score
    MIN_CONFIDENCE_NEEDS_PRACTICE: 30.00, // Minimum confidence required to confirm NEEDS_PRACTICE
    MAX_SCORE_NEEDS_PRACTICE: 35.00,      // Score below which skill is marked as NEEDS_PRACTICE
    DECLINING_NEEDS_PRACTICE_SCORE: 50.00,// Score threshold under declining trend
    MIN_CONFIDENCE_ASSESSED: 25.00,       // Minimum confidence to transition from UNASSESSED
    SCORE_STABLE_MIN: 40.00,              // Lower bound for STABLE
    SCORE_STABLE_MAX: 65.00,              // Upper bound for STABLE
  };

  /**
   * Deterministically classify a user's skill state into STRENGTH, NEEDS_PRACTICE, DEVELOPING, STABLE, or UNASSESSED.
   * 
   * @param {Object} params
   * @param {number} params.score
   * @param {number} params.confidence
   * @param {number} params.attemptedCount
   * @param {number} params.solvedCount
   * @param {string} [params.trendDirection='stable']
   * @returns {string}
   */
  static classifySkill({
    score = 0.00,
    confidence = 0.00,
    attemptedCount = 0,
    solvedCount = 0,
    trendDirection = 'stable',
  }) {
    const numScore = Number(score) || 0.00;
    const numConfidence = Number(confidence) || 0.00;
    const numAtt = Number(attemptedCount) || 0;
    const numSol = Number(solvedCount) || 0;

    // 1. Unassessed check: no evaluated activity recorded
    if (numAtt === 0 && numSol === 0) {
      return 'UNASSESSED';
    }

    // 2. Low-confidence safeguard: prevent hasty classifications on minimal evidence
    if (numConfidence < this.CLASSIFICATION_THRESHOLDS.MIN_CONFIDENCE_ASSESSED) {
      return 'DEVELOPING';
    }

    // 3. STRENGTH check: High score + strong confidence + non-declining progress
    if (
      (numScore >= this.CLASSIFICATION_THRESHOLDS.MIN_SCORE_STRENGTH &&
        numConfidence >= this.CLASSIFICATION_THRESHOLDS.MIN_CONFIDENCE_STRENGTH &&
        trendDirection !== 'declining') ||
      (numScore >= this.CLASSIFICATION_THRESHOLDS.HIGH_SCORE_STRENGTH &&
        numConfidence >= this.CLASSIFICATION_THRESHOLDS.HIGH_SCORE_MIN_CONFIDENCE)
    ) {
      return 'STRENGTH';
    }

    // 4. NEEDS_PRACTICE check:
    // Requires genuine evidence of struggle (e.g. failing attempts, declining trend, or multiple attempts with low score)
    const hasStruggleEvidence = (numAtt > numSol) || (trendDirection === 'declining') || (numAtt >= 3 && numScore < this.CLASSIFICATION_THRESHOLDS.MAX_SCORE_NEEDS_PRACTICE);

    if (
      hasStruggleEvidence &&
      ((numScore < this.CLASSIFICATION_THRESHOLDS.MAX_SCORE_NEEDS_PRACTICE &&
        numConfidence >= this.CLASSIFICATION_THRESHOLDS.MIN_CONFIDENCE_NEEDS_PRACTICE) ||
      (numScore < this.CLASSIFICATION_THRESHOLDS.DECLINING_NEEDS_PRACTICE_SCORE &&
        numConfidence >= this.CLASSIFICATION_THRESHOLDS.MIN_CONFIDENCE_NEEDS_PRACTICE &&
        trendDirection === 'declining'))
    ) {
      return 'NEEDS_PRACTICE';
    }

    // 5. STABLE check: Middle tier score + sufficient confidence + flat trend
    if (
      numScore >= this.CLASSIFICATION_THRESHOLDS.SCORE_STABLE_MIN &&
      numScore < this.CLASSIFICATION_THRESHOLDS.SCORE_STABLE_MAX &&
      numConfidence >= this.CLASSIFICATION_THRESHOLDS.MIN_CONFIDENCE_NEEDS_PRACTICE &&
      trendDirection === 'stable'
    ) {
      return 'STABLE';
    }

    // 6. DEVELOPING (Default state for active progression)
    return 'DEVELOPING';
  }

  /**
   * Build aggregated user-level classification summary across topics
   * 
   * @param {Array<Object>} skillsList
   * @returns {Object}
   */
  static buildSkillClassificationSummary(skillsList = []) {
    const strengths = [];
    const needsPractice = [];
    const developing = [];
    const stable = [];
    const unassessed = [];

    for (const sk of skillsList) {
      const classification = sk.classification || 'UNASSESSED';
      const item = {
        topicId: sk.topicId,
        topicKey: sk.topicKey,
        topicName: sk.topicName,
        category: sk.category,
        score: sk.score,
        level: sk.level,
        confidence: sk.confidence,
        classification,
        solvedCount: sk.solvedCount,
        attemptedCount: sk.attemptedCount,
      };

      if (classification === 'STRENGTH') strengths.push(item);
      else if (classification === 'NEEDS_PRACTICE') needsPractice.push(item);
      else if (classification === 'STABLE') stable.push(item);
      else if (classification === 'DEVELOPING') developing.push(item);
      else unassessed.push(item);
    }

    return {
      strengthsCount: strengths.length,
      needsPracticeCount: needsPractice.length,
      developingCount: developing.length,
      stableCount: stable.length,
      unassessedCount: unassessed.length,
      strengths,
      needsPractice,
      developing,
      stable,
      unassessed,
    };
  }

  /**
   * 4. SKILL & CONFIDENCE EVALUATION (Phase 5.7.3 & Phase 5.7.5)
   * Evaluates evidence records and produces separate, deterministic 0-100 bounded Skill Score, Confidence, and Classification.
   * 
   * @param {Array<SkillEvidence>} evidenceList
   * @param {Object|null} existingSkill
   * @param {Date} referenceDate
   * @param {string} [trendDirection='stable']
   * @returns {Object}
   */
  static calculateSkill(evidenceList = [], existingSkill = null, referenceDate = new Date(), trendDirection = 'stable') {
    const evidence = this.aggregateEvidence(evidenceList, referenceDate);

    if (!evidenceList || evidenceList.length === 0) {
      return {
        score: 0.00,
        level: 'BEGINNER',
        confidence: 0.00,
        classification: 'UNASSESSED',
        attemptedCount: 0,
        solvedCount: 0,
        lastAttemptAt: null,
        lastSolvedAt: null,
        evidence,
        calculationVersion: this.CALCULATION_VERSION,
      };
    }

    const confidence = this.calculateConfidence(evidenceList, referenceDate);
    const attemptedCount = evidence.totalAttempts;
    const solvedCount = evidence.distinctProblemsSolved;
    const problemOutcomes = this.aggregateProblemOutcomes(evidenceList, referenceDate);

    let rawSolvedPoints = 0.0;
    let failedAttemptsCount = 0;

    for (const outcome of problemOutcomes) {
      if (outcome.isSolved) {
        rawSolvedPoints += outcome.problemPoints;
      }
      failedAttemptsCount += outcome.failedAttempts;
    }

    // 0 solved problems strictly yields 0 score
    if (solvedCount === 0) {
      const classification = this.classifySkill({
        score: 0.00,
        confidence,
        attemptedCount,
        solvedCount: 0,
        trendDirection,
      });

      return {
        score: 0.00,
        level: 'BEGINNER',
        confidence,
        classification,
        attemptedCount,
        solvedCount: 0,
        lastAttemptAt: evidence.lastAttemptAt,
        lastSolvedAt: null,
        evidence,
        calculationVersion: this.CALCULATION_VERSION,
      };
    }

    // Accuracy and quality multiplier for skill score
    const accuracyMultiplier = this.calculateAccuracyFactor(solvedCount, failedAttemptsCount);
    const breadthCap = this.calculateBreadthCap(solvedCount);

    const rawScore = rawSolvedPoints * accuracyMultiplier;
    const boundedScore = Math.min(100.00, Math.max(0.00, Math.min(rawScore, breadthCap)));
    
    // Stable rounding to 2 decimal places with NaN / Infinity safety
    const roundedScore = Number.isFinite(boundedScore) ? Math.round(boundedScore * 100) / 100 : 0.00;
    const level = this.calculateLevel(roundedScore);
    const classification = this.classifySkill({
      score: roundedScore,
      confidence,
      attemptedCount,
      solvedCount,
      trendDirection,
    });

    return {
      score: roundedScore,
      level,
      confidence,
      classification,
      attemptedCount,
      solvedCount,
      lastAttemptAt: evidence.lastAttemptAt,
      lastSolvedAt: evidence.lastSolvedAt,
      evidence,
      calculationVersion: this.CALCULATION_VERSION,
    };
  }

  /**
   * 5. PERSISTENCE
   * Persists calculated skill and confidence state to the database with stale calculation protection
   * and records an append-only historical snapshot (suppressing duplicates).
   * 
   * @param {number} userId
   * @param {number} topicId
   * @param {Object} calculatedData
   * @param {number|null} [triggerSubmissionId=null]
   * @returns {Promise<Object>}
   */
  static async persistSkill(userId, topicId, calculatedData, triggerSubmissionId = null) {
    // Check for stale calculation race condition
    const existing = await UserSkillModel.getUserSkillByTopic(userId, topicId);
    if (
      existing &&
      existing.lastAttemptAt &&
      calculatedData.lastAttemptAt &&
      new Date(existing.lastAttemptAt).getTime() > new Date(calculatedData.lastAttemptAt).getTime()
    ) {
      // Existing record has newer activity, skip overwriting with stale calculation
      return existing;
    }

    const classification = calculatedData.classification || 'UNASSESSED';

    const savedSkill = await UserSkillModel.upsertUserSkill({
      userId,
      topicId,
      score: calculatedData.score,
      level: calculatedData.level,
      confidence: calculatedData.confidence,
      classification,
      attemptedCount: calculatedData.attemptedCount,
      solvedCount: calculatedData.solvedCount,
      lastAttemptAt: calculatedData.lastAttemptAt,
      lastSolvedAt: calculatedData.lastSolvedAt,
      calculationVersion: calculatedData.calculationVersion || this.CALCULATION_VERSION,
    });

    // Record historical progress snapshot (Phase 5.7.4 & 5.7.5)
    try {
      const historyResult = await UserSkillHistoryModel.recordSnapshot({
        userSkillId: savedSkill.id,
        userId,
        topicId,
        score: calculatedData.score,
        level: calculatedData.level,
        confidence: calculatedData.confidence,
        classification,
        attemptedCount: calculatedData.attemptedCount,
        solvedCount: calculatedData.solvedCount,
        distinctProblemsAttempted: calculatedData.evidence?.distinctProblemsAttempted || 0,
        distinctProblemsSolved: calculatedData.evidence?.distinctProblemsSolved || 0,
        calculationVersion: calculatedData.calculationVersion || this.CALCULATION_VERSION,
        triggerSubmissionId,
      });
      savedSkill.historySnapshotId = historyResult.id;
      savedSkill.isDuplicateSuppressed = historyResult.isDuplicateSuppressed;
    } catch (histErr) {
      console.warn(`[SKILL HISTORY WARNING] Failed to record snapshot for user ${userId}, topic ${topicId}:`, histErr.message);
    }

    return savedSkill;
  }

  /**
   * Recalculate and persist skill for a single user and topic
   * 
   * @param {number} userId
   * @param {number} topicId
   * @param {Date} referenceDate
   * @param {number|null} [triggerSubmissionId=null]
   * @returns {Promise<Object>}
   */
  static async recalculateUserTopicSkill(userId, topicId, referenceDate = new Date(), triggerSubmissionId = null) {
    const evidence = await this.collectSkillEvidence(userId, topicId);
    const existingSkill = await UserSkillModel.getUserSkillByTopic(userId, topicId);
    const trend = await UserSkillHistoryModel.getTopicTrend(userId, topicId);
    const calculated = this.calculateSkill(evidence, existingSkill, referenceDate, trend?.direction || 'stable');
    return await this.persistSkill(userId, topicId, calculated, triggerSubmissionId);
  }

  /**
   * Recalculate all skills for a user across all active topics
   * 
   * @param {number} userId
   * @param {Date} referenceDate
   * @param {number|null} [triggerSubmissionId=null]
   * @returns {Promise<Array<Object>>}
   */
  static async recalculateAllUserSkills(userId, referenceDate = new Date(), triggerSubmissionId = null) {
    const allEvidence = await this.collectSkillEvidence(userId);
    
    // Group evidence by topicId
    const evidenceByTopic = new Map();
    for (const ev of allEvidence) {
      if (!evidenceByTopic.has(ev.topicId)) {
        evidenceByTopic.set(ev.topicId, []);
      }
      evidenceByTopic.get(ev.topicId).push(ev);
    }

    // Process all topics concurrently
    const topicPromises = Array.from(evidenceByTopic.entries()).map(async ([topicId, evidenceList]) => {
      const trend = await UserSkillHistoryModel.getTopicTrend(userId, topicId);
      const calculated = this.calculateSkill(evidenceList, null, referenceDate, trend?.direction || 'stable');
      return await this.persistSkill(userId, topicId, calculated, triggerSubmissionId);
    });

    return await Promise.all(topicPromises);
  }

  /**
   * 6. BACKGROUND EVENT PROCESSOR
   * Asynchronously handles post-evaluation submission events to update user skills, confidence, and history
   * 
   * @param {number} submissionId
   */
  static async processSubmissionEvent(submissionId) {
    try {
      const subRes = await db.query(
        `SELECT id, user_id AS "userId", problem_id AS "problemId", is_sample_run AS "isSampleRun" 
         FROM submissions 
         WHERE id = $1;`,
        [submissionId]
      );

      if (!subRes.rows[0]) return;
      const sub = subRes.rows[0];

      if (sub.isSampleRun) return;

      // Ensure problem has topics tagged; if none exist, attempt auto-tagging
      let topics = await TopicModel.getTopicsByProblemId(sub.problemId);
      if (topics.length === 0) {
        const probRes = await db.query(`SELECT title, description FROM problems WHERE id = $1;`, [sub.problemId]);
        if (probRes.rows[0]) {
          await TopicModel.autoTagProblemByKeywords(sub.problemId, probRes.rows[0].title, probRes.rows[0].description);
          topics = await TopicModel.getTopicsByProblemId(sub.problemId);
        }
      }

      // Recalculate skill, confidence, and history for each associated topic
      for (const topic of topics) {
        await this.recalculateUserTopicSkill(sub.userId, topic.id, new Date(), sub.id);
      }
    } catch (err) {
      console.warn(`[SKILL CALCULATION EVENT WARNING] Failed to process submission ${submissionId}:`, err.message);
    }
  }
}

module.exports = SkillCalculationService;
