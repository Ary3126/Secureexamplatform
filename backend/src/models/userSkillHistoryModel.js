const db = require('../config/db');

/**
 * UserSkillHistoryModel
 * 
 * Manages append-oriented time-series historical snapshots of user skill progress (Phase 5.7.4).
 * Enforces duplicate snapshot suppression, bounded time-window queries, and deterministic trend calculations.
 */
class UserSkillHistoryModel {
  /**
   * Stability threshold for determining meaningful score change (Phase 5.7.4)
   * Any change within [-1.00, 1.00] points is considered 'stable'.
   */
  static STABILITY_THRESHOLD = 1.00;

  /**
   * Maximum allowed query limit for history pagination to prevent unbounded queries
   */
  static MAX_QUERY_LIMIT = 100;

  /**
   * Record a historical snapshot of user skill state.
   * Suppresses unnecessary duplicate snapshots when metrics remain unchanged.
   * 
   * @param {Object} data
   * @returns {Promise<Object>} Persisted snapshot or existing snapshot if duplicate
   */
  static async recordSnapshot({
    userSkillId,
    userId,
    topicId,
    score,
    level,
    confidence,
    classification = 'UNASSESSED',
    attemptedCount,
    solvedCount,
    distinctProblemsAttempted = 0,
    distinctProblemsSolved = 0,
    calculationVersion = 3,
    triggerSubmissionId = null,
  }) {
    // 1. Check the most recent snapshot for this user and topic
    const latestQuery = `
      SELECT 
        id,
        user_skill_id AS "userSkillId",
        user_id AS "userId",
        topic_id AS "topicId",
        CAST(score AS FLOAT) AS "score",
        level,
        CAST(confidence AS FLOAT) AS "confidence",
        classification,
        attempted_count AS "attemptedCount",
        solved_count AS "solvedCount",
        distinct_problems_attempted AS "distinctProblemsAttempted",
        distinct_problems_solved AS "distinctProblemsSolved",
        calculation_version AS "calculationVersion",
        trigger_submission_id AS "triggerSubmissionId",
        recorded_at AS "recordedAt"
      FROM user_skill_history
      WHERE user_id = $1 AND topic_id = $2
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1;
    `;
    const latestRes = await db.query(latestQuery, [userId, topicId]);
    const latest = latestRes.rows[0];

    // 2. Suppress duplicate snapshots if all metrics are identical
    if (latest) {
      const scoreDiff = Math.abs(Number(latest.score) - Number(score));
      const confDiff = Math.abs(Number(latest.confidence) - Number(confidence));
      const classDiff = latest.classification !== classification;
      const attDiff = Number(latest.attemptedCount) !== Number(attemptedCount);
      const solDiff = Number(latest.solvedCount) !== Number(solvedCount);
      const levelDiff = latest.level !== level;
      const dAttDiff = Number(latest.distinctProblemsAttempted) !== Number(distinctProblemsAttempted);
      const dSolDiff = Number(latest.distinctProblemsSolved) !== Number(distinctProblemsSolved);

      if (
        scoreDiff < 0.01 &&
        confDiff < 0.01 &&
        !classDiff &&
        !attDiff &&
        !solDiff &&
        !levelDiff &&
        !dAttDiff &&
        !dSolDiff
      ) {
        return {
          ...latest,
          isDuplicateSuppressed: true,
        };
      }
    }

    // 3. Persist new append-only historical snapshot with server-authoritative timestamp
    const insertQuery = `
      INSERT INTO user_skill_history (
        user_skill_id,
        user_id,
        topic_id,
        score,
        level,
        confidence,
        classification,
        attempted_count,
        solved_count,
        distinct_problems_attempted,
        distinct_problems_solved,
        calculation_version,
        trigger_submission_id,
        recorded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
      RETURNING 
        id,
        user_skill_id AS "userSkillId",
        user_id AS "userId",
        topic_id AS "topicId",
        CAST(score AS FLOAT) AS "score",
        level,
        CAST(confidence AS FLOAT) AS "confidence",
        classification,
        attempted_count AS "attemptedCount",
        solved_count AS "solvedCount",
        distinct_problems_attempted AS "distinctProblemsAttempted",
        distinct_problems_solved AS "distinctProblemsSolved",
        calculation_version AS "calculationVersion",
        trigger_submission_id AS "triggerSubmissionId",
        recorded_at AS "recordedAt";
    `;

    const values = [
      userSkillId,
      userId,
      topicId,
      score,
      level,
      confidence,
      classification,
      attemptedCount,
      solvedCount,
      distinctProblemsAttempted,
      distinctProblemsSolved,
      calculationVersion,
      triggerSubmissionId,
    ];

    const res = await db.query(insertQuery, values);
    return {
      ...res.rows[0],
      isDuplicateSuppressed: false,
    };
  }

  /**
   * Retrieve bounded historical snapshots for a user
   * 
   * @param {Object} params
   * @param {number} params.userId
   * @param {number|null} [params.topicId]
   * @param {number} [params.limit=20]
   * @param {number} [params.offset=0]
   * @param {string|Date|null} [params.startDate]
   * @param {string|Date|null} [params.endDate]
   * @param {string} [params.order='DESC']
   * @returns {Promise<Array>}
   */
  static async getHistory({
    userId,
    topicId = null,
    limit = 20,
    offset = 0,
    startDate = null,
    endDate = null,
    order = 'DESC',
  }) {
    const safeLimit = Math.min(this.MAX_QUERY_LIMIT, Math.max(1, parseInt(limit, 10) || 20));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let queryText = `
      SELECT 
        ush.id,
        ush.user_skill_id AS "userSkillId",
        ush.user_id AS "userId",
        ush.topic_id AS "topicId",
        t.key AS "topicKey",
        t.name AS "topicName",
        t.category AS "topicCategory",
        CAST(ush.score AS FLOAT) AS "score",
        ush.level,
        CAST(ush.confidence AS FLOAT) AS "confidence",
        ush.classification,
        ush.attempted_count AS "attemptedCount",
        ush.solved_count AS "solvedCount",
        ush.distinct_problems_attempted AS "distinctProblemsAttempted",
        ush.distinct_problems_solved AS "distinctProblemsSolved",
        ush.calculation_version AS "calculationVersion",
        ush.trigger_submission_id AS "triggerSubmissionId",
        ush.recorded_at AS "recordedAt"
      FROM user_skill_history ush
      JOIN topics t ON ush.topic_id = t.id
      WHERE ush.user_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (topicId) {
      params.push(topicId);
      queryText += ` AND ush.topic_id = $${paramIndex++}`;
    }

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!isNaN(parsedStart.getTime())) {
        params.push(parsedStart);
        queryText += ` AND ush.recorded_at >= $${paramIndex++}`;
      }
    }

    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!isNaN(parsedEnd.getTime())) {
        params.push(parsedEnd);
        queryText += ` AND ush.recorded_at <= $${paramIndex++}`;
      }
    }

    queryText += ` ORDER BY ush.recorded_at ${safeOrder}, ush.id ${safeOrder} LIMIT $${paramIndex++} OFFSET $${paramIndex++};`;
    params.push(safeLimit, safeOffset);

    const res = await db.query(queryText, params);
    return res.rows;
  }

  /**
   * Derive deterministic trend analysis for a specific user and topic
   * 
   * @param {number} userId
   * @param {number} topicId
   * @returns {Promise<Object>}
   */
  static async getTopicTrend(userId, topicId) {
    const queryText = `
      SELECT 
        ush.id,
        CAST(ush.score AS FLOAT) AS "score",
        ush.level,
        CAST(ush.confidence AS FLOAT) AS "confidence",
        ush.classification,
        ush.attempted_count AS "attemptedCount",
        ush.solved_count AS "solvedCount",
        ush.distinct_problems_attempted AS "distinctProblemsAttempted",
        ush.distinct_problems_solved AS "distinctProblemsSolved",
        ush.calculation_version AS "calculationVersion",
        ush.recorded_at AS "recordedAt"
      FROM user_skill_history ush
      WHERE ush.user_id = $1 AND ush.topic_id = $2
      ORDER BY ush.recorded_at DESC, ush.id DESC
      LIMIT 2;
    `;
    const res = await db.query(queryText, [userId, topicId]);
    const rows = res.rows;

    if (rows.length === 0) {
      return {
        currentScore: 0.00,
        previousScore: 0.00,
        absoluteChange: 0.00,
        percentageChange: 0.00,
        currentConfidence: 0.00,
        previousConfidence: 0.00,
        confidenceChange: 0.00,
        direction: 'stable',
        confidenceDirection: 'stable',
        status: 'no_data',
        totalSnapshots: 0,
        latestRecordedAt: null,
      };
    }

    const latest = rows[0];
    if (rows.length === 1) {
      return {
        currentScore: latest.score,
        previousScore: latest.score,
        absoluteChange: 0.00,
        percentageChange: 0.00,
        currentConfidence: latest.confidence,
        previousConfidence: latest.confidence,
        confidenceChange: 0.00,
        direction: 'stable',
        confidenceDirection: 'stable',
        status: 'initial',
        totalSnapshots: 1,
        latestRecordedAt: latest.recordedAt,
      };
    }

    const previous = rows[1];
    const rawScoreDiff = latest.score - previous.score;
    const absoluteChange = Number.isFinite(rawScoreDiff) ? Math.round(rawScoreDiff * 100) / 100 : 0.00;
    
    let percentageChange = 0.00;
    if (previous.score > 0) {
      const rawPct = ((latest.score - previous.score) / previous.score) * 100.0;
      percentageChange = Number.isFinite(rawPct) ? Math.round(rawPct * 100) / 100 : 0.00;
    }

    const rawConfDiff = latest.confidence - previous.confidence;
    const confidenceChange = Number.isFinite(rawConfDiff) ? Math.round(rawConfDiff * 100) / 100 : 0.00;

    let direction = 'stable';
    if (absoluteChange > this.STABILITY_THRESHOLD) {
      direction = 'improving';
    } else if (absoluteChange < -this.STABILITY_THRESHOLD) {
      direction = 'declining';
    }

    let confidenceDirection = 'stable';
    if (confidenceChange > this.STABILITY_THRESHOLD) {
      confidenceDirection = 'improving';
    } else if (confidenceChange < -this.STABILITY_THRESHOLD) {
      confidenceDirection = 'declining';
    }

    return {
      currentScore: latest.score,
      previousScore: previous.score,
      absoluteChange,
      percentageChange,
      currentConfidence: latest.confidence,
      previousConfidence: previous.confidence,
      confidenceChange,
      direction,
      confidenceDirection,
      status: direction,
      totalSnapshots: rows.length,
      latestRecordedAt: latest.recordedAt,
    };
  }

  /**
   * Derive aggregated trend summary across all active topics for a user in a single optimized window query (Phase 5.7.7)
   * Eliminates N+1 query loops.
   * 
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  static async getUserOverallTrends(userId) {
    const windowQuery = `
      WITH ranked_history AS (
        SELECT 
          ush.id,
          ush.topic_id AS "topicId",
          t.key AS "topicKey",
          t.name AS "topicName",
          CAST(ush.score AS FLOAT) AS "score",
          ush.level,
          CAST(ush.confidence AS FLOAT) AS "confidence",
          ush.classification,
          ush.attempted_count AS "attemptedCount",
          ush.solved_count AS "solvedCount",
          ush.distinct_problems_attempted AS "distinctProblemsAttempted",
          ush.distinct_problems_solved AS "distinctProblemsSolved",
          ush.calculation_version AS "calculationVersion",
          ush.recorded_at AS "recordedAt",
          ROW_NUMBER() OVER (PARTITION BY ush.topic_id ORDER BY ush.recorded_at DESC, ush.id DESC) AS rn
        FROM user_skill_history ush
        JOIN topics t ON ush.topic_id = t.id
        WHERE ush.user_id = $1
      )
      SELECT *
      FROM ranked_history
      WHERE rn <= 2
      ORDER BY "topicName" ASC, "recordedAt" DESC, id DESC;
    `;

    const res = await db.query(windowQuery, [userId]);
    const rows = res.rows;

    // Group by topicId
    const snapshotsByTopic = new Map();
    for (const row of rows) {
      if (!snapshotsByTopic.has(row.topicId)) {
        snapshotsByTopic.set(row.topicId, {
          topicId: row.topicId,
          topicKey: row.topicKey,
          topicName: row.topicName,
          snapshots: [],
        });
      }
      snapshotsByTopic.get(row.topicId).snapshots.push(row);
    }

    const topicTrends = [];
    let improvingCount = 0;
    let decliningCount = 0;
    let stableCount = 0;

    for (const { topicId, topicKey, topicName, snapshots } of snapshotsByTopic.values()) {
      let trend;
      if (snapshots.length === 1) {
        const latest = snapshots[0];
        trend = {
          currentScore: latest.score,
          previousScore: latest.score,
          absoluteChange: 0.00,
          percentageChange: 0.00,
          currentConfidence: latest.confidence,
          previousConfidence: latest.confidence,
          confidenceChange: 0.00,
          direction: 'stable',
          confidenceDirection: 'stable',
          status: 'initial',
          totalSnapshots: 1,
          latestRecordedAt: latest.recordedAt,
        };
      } else {
        const latest = snapshots[0];
        const previous = snapshots[1];
        const rawScoreDiff = latest.score - previous.score;
        const absoluteChange = Number.isFinite(rawScoreDiff) ? Math.round(rawScoreDiff * 100) / 100 : 0.00;

        let percentageChange = 0.00;
        if (previous.score > 0) {
          const rawPct = ((latest.score - previous.score) / previous.score) * 100.0;
          percentageChange = Number.isFinite(rawPct) ? Math.round(rawPct * 100) / 100 : 0.00;
        }

        const rawConfDiff = latest.confidence - previous.confidence;
        const confidenceChange = Number.isFinite(rawConfDiff) ? Math.round(rawConfDiff * 100) / 100 : 0.00;

        let direction = 'stable';
        if (absoluteChange > this.STABILITY_THRESHOLD) {
          direction = 'improving';
        } else if (absoluteChange < -this.STABILITY_THRESHOLD) {
          direction = 'declining';
        }

        let confidenceDirection = 'stable';
        if (confidenceChange > this.STABILITY_THRESHOLD) {
          confidenceDirection = 'improving';
        } else if (confidenceChange < -this.STABILITY_THRESHOLD) {
          confidenceDirection = 'declining';
        }

        trend = {
          currentScore: latest.score,
          previousScore: previous.score,
          absoluteChange,
          percentageChange,
          currentConfidence: latest.confidence,
          previousConfidence: previous.confidence,
          confidenceChange,
          direction,
          confidenceDirection,
          status: direction,
          totalSnapshots: snapshots.length,
          latestRecordedAt: latest.recordedAt,
        };
      }

      topicTrends.push({
        topicId,
        topicKey,
        topicName,
        ...trend,
      });

      if (trend.direction === 'improving') improvingCount++;
      else if (trend.direction === 'declining') decliningCount++;
      else stableCount++;
    }

    let overallDirection = 'stable';
    if (improvingCount > decliningCount) {
      overallDirection = 'improving';
    } else if (decliningCount > improvingCount) {
      overallDirection = 'declining';
    }

    return {
      overallDirection,
      improvingCount,
      decliningCount,
      stableCount,
      totalTopicsTracked: topicTrends.length,
      topicTrends,
    };
  }
}

module.exports = UserSkillHistoryModel;
