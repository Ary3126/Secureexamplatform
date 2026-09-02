const db = require('../config/db');
const AuditLogger = require('../services/auditLogger');
const {
  getContestRuntimeState,
  isLifecycleMutationLocked,
  getLifecycleLockMessage,
  getProblemMutationLockMessage,
} = require('../services/contestService');

/**
 * Contest Model - Encapsulates all database operations for the contests table (Phase 3 & Phase 5.4)
 */
class ContestModel {
  /**
   * Create a new contest record
   * @param {Object} contestData - { title, description, startTime, endTime, createdBy, isRated }
   * @param {Object|null} client - Optional database client
   * @returns {Promise<Object>}
   */
  static async createContest({ title, description, startTime, endTime, createdBy, isRated = true, leaderboardFreezeEnabled = false, leaderboardFreezeMinutes = 60 }, client = null) {
    const text = `
      INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated, leaderboard_freeze_enabled, leaderboard_freeze_minutes)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)
      RETURNING 
        id, 
        title, 
        description, 
        start_time AS "startTime", 
        end_time AS "endTime", 
        status, 
        is_rated AS "isRated",
        is_rating_finalized AS "isRatingFinalized",
        ratings_finalized_at AS "ratingsFinalizedAt",
        leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
        leaderboard_freeze_minutes AS "leaderboardFreezeMinutes",
        created_by AS "createdBy", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [title.trim(), description ? description.trim() : null, startTime, endTime, createdBy, isRated, leaderboardFreezeEnabled, leaderboardFreezeMinutes];
    const res = await (client || db).query(text, values);
    return res.rows[0];
  }

  /**
   * Create a contest within an atomic transaction and audit log
   */
  static async createContestWithSafety(params, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const contest = await ContestModel.createContest(params, client);

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_CREATED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'success',
          metadata: { title: contest.title, isRated: contest.isRated },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return contest;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Find contest by ID
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  static async findContestById(id) {
    const text = `
      SELECT 
        c.id, 
        c.title, 
        c.description, 
        c.start_time AS "startTime", 
        c.end_time AS "endTime", 
        c.status, 
        c.is_rated AS "isRated",
        c.is_rating_finalized AS "isRatingFinalized",
        c.ratings_finalized_at AS "ratingsFinalizedAt",
        c.leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
        c.leaderboard_freeze_minutes AS "leaderboardFreezeMinutes",
        c.created_by,
        c.created_by AS "createdBy", 
        u.username AS "creatorUsername",
        c.created_at AS "createdAt", 
        c.updated_at AS "updatedAt"
      FROM contests c
      LEFT JOIN users u ON c.created_by = u.id
      WHERE c.id = $1;
    `;
    const res = await db.query(text, [id]);
    return res.rows[0] || null;
  }

  /**
   * List all contests with optional status filter and pagination
   * @param {Object} options - { status, limit, offset }
   * @returns {Promise<Array<Object>>}
   */
  static async findAllContests({ status, limit = 50, offset = 0 } = {}) {
    let queryText = `
      SELECT 
        c.id, 
        c.title, 
        c.description, 
        c.start_time AS "startTime", 
        c.end_time AS "endTime", 
        c.status, 
        c.is_rated AS "isRated",
        c.is_rating_finalized AS "isRatingFinalized",
        c.ratings_finalized_at AS "ratingsFinalizedAt",
        c.leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
        c.leaderboard_freeze_minutes AS "leaderboardFreezeMinutes",
        c.created_by,
        c.created_by AS "createdBy", 
        u.username AS "creatorUsername",
        c.created_at AS "createdAt", 
        c.updated_at AS "updatedAt",
        COUNT(DISTINCT cp.problem_id)::int AS "problemCount",
        COUNT(DISTINCT part.user_id)::int AS "participantCount"
      FROM contests c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN contest_problems cp ON c.id = cp.contest_id
      LEFT JOIN contest_participants part ON c.id = part.contest_id
    `;
    const values = [];

    if (status) {
      values.push(status.toLowerCase());
      queryText += ` WHERE c.status = $${values.length}`;
    }

    queryText += ` GROUP BY c.id, u.username ORDER BY c.start_time DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const res = await db.query(queryText, values);
    return res.rows;
  }

  /**
   * Find contests joined by a specific user
   * @param {number|string} userId
   * @returns {Promise<Array<Object>>}
   */
  static async findJoinedContestsByUser(userId) {
    const text = `
      SELECT 
        c.id, 
        c.title, 
        c.description, 
        c.start_time AS "startTime", 
        c.end_time AS "endTime", 
        c.status, 
        c.is_rated AS "isRated",
        c.is_rating_finalized AS "isRatingFinalized",
        c.ratings_finalized_at AS "ratingsFinalizedAt",
        c.leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
        c.leaderboard_freeze_minutes AS "leaderboardFreezeMinutes",
        c.created_by,
        c.created_by AS "createdBy", 
        u.username AS "creatorUsername",
        cp.joined_at AS "joinedAt",
        COUNT(DISTINCT prob.problem_id)::int AS "problemCount"
      FROM contest_participants cp
      JOIN contests c ON cp.contest_id = c.id
      JOIN users u ON c.created_by = u.id
      LEFT JOIN contest_problems prob ON c.id = prob.contest_id
      WHERE cp.user_id = $1
      GROUP BY c.id, u.username, cp.joined_at
      ORDER BY c.start_time DESC;
    `;
    const res = await db.query(text, [userId]);
    return res.rows;
  }

  /**
   * Update contest details with lifecycle mutation locks and transactional row-level locking
   * @param {number|string} id
   * @param {Object} updateData
   * @returns {Promise<{success?: boolean, contest?: Object, locked?: boolean, runtimeState?: string, message?: string, notFound?: boolean}>}
   */
  static async updateContestWithSafety(id, { title, description, startTime, endTime, isRated, leaderboardFreezeEnabled, leaderboardFreezeMinutes, status }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Acquire exclusive row lock on contest
      const checkRes = await client.query(`
        SELECT 
          id, 
          title, 
          description, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          status, 
          created_by AS "createdBy"
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [id]);

      if (checkRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      const lockedContest = checkRes.rows[0];
      const runtimeState = getContestRuntimeState(lockedContest);

      // Check if lifecycle-defining fields are present in update
      const isLifecycleMutating = startTime !== undefined || endTime !== undefined || status !== undefined;

      if (isLifecycleMutating && isLifecycleMutationLocked(runtimeState)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getLifecycleLockMessage(runtimeState),
        };
      }

      const text = `
        UPDATE contests
        SET 
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          start_time = COALESCE($3, start_time),
          end_time = COALESCE($4, end_time),
          is_rated = COALESCE($5, is_rated),
          leaderboard_freeze_enabled = COALESCE($6, leaderboard_freeze_enabled),
          leaderboard_freeze_minutes = COALESCE($7, leaderboard_freeze_minutes),
          status = COALESCE($8, status),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING 
          id, 
          title, 
          description, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          status, 
          is_rated AS "isRated",
          is_rating_finalized AS "isRatingFinalized",
          ratings_finalized_at AS "ratingsFinalizedAt",
          leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
          leaderboard_freeze_minutes AS "leaderboardFreezeMinutes",
          created_by AS "createdBy", 
          created_at AS "createdAt", 
          updated_at AS "updatedAt";
      `;
      const values = [
        title !== undefined ? title.trim() : null,
        description !== undefined ? description.trim() : null,
        startTime || null,
        endTime || null,
        isRated !== undefined ? isRated : null,
        leaderboardFreezeEnabled !== undefined ? leaderboardFreezeEnabled : null,
        leaderboardFreezeMinutes !== undefined ? leaderboardFreezeMinutes : null,
        status || null,
        id,
      ];

      const res = await client.query(text, values);
      const updated = res.rows[0] || null;

      if (actor && updated) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_UPDATED',
          resourceType: 'contest',
          resourceId: updated.id,
          outcome: 'success',
          metadata: { title: updated.title, isRated: updated.isRated },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, contest: updated };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update contest details (delegates to updateContestWithSafety)
   */
  static async updateContest(id, updateData) {
    const result = await ContestModel.updateContestWithSafety(id, updateData);
    if (result.locked) {
      const err = new Error(result.message);
      err.statusCode = 409;
      err.isLocked = true;
      err.runtimeState = result.runtimeState;
      throw err;
    }
    return result.contest;
  }

  /**
   * Publish a contest inside an atomic transaction with row locking and audit logging
   */
  static async publishContestWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(
        'SELECT id, status FROM contests WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      if (cRes.rows[0].status !== 'draft') {
        await client.query('ROLLBACK');
        return { success: false, invalidStatus: true, currentStatus: cRes.rows[0].status };
      }

      const pCountRes = await client.query(
        'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1',
        [id]
      );
      const problemCount = pCountRes.rows[0]?.count || 0;
      if (problemCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, noProblems: true };
      }

      const updateRes = await client.query(
        `UPDATE contests SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1
         RETURNING id, title, description, start_time AS "startTime", end_time AS "endTime", status, is_rated AS "isRated", created_by AS "createdBy";`,
        [id]
      );

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PUBLISHED',
          resourceType: 'contest',
          resourceId: id,
          outcome: 'success',
          metadata: { problemCount },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, contest: updateRes.rows[0], problemCount };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Update contest status (draft -> published)
   */
  static async updateContestStatus(id, status, client = null) {
    const text = `
      UPDATE contests
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING 
        id, 
        title, 
        description, 
        start_time AS "startTime", 
        end_time AS "endTime", 
        status, 
        is_rated AS "isRated",
        is_rating_finalized AS "isRatingFinalized",
        ratings_finalized_at AS "ratingsFinalizedAt",
        created_by AS "createdBy", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const res = await (client || db).query(text, [status, id]);
    return res.rows[0] || null;
  }

  /**
   * Check if a contest has any historical submissions
   * Uses an efficient indexed SELECT EXISTS query
   * @param {number|string} contestId
   * @param {Object|null} client
   * @returns {Promise<boolean>}
   */
  static async hasSubmissions(contestId, client = null) {
    const text = `
      SELECT EXISTS (
        SELECT 1
        FROM submissions
        WHERE contest_id = $1
      ) AS has_submissions;
    `;
    const res = await (client || db).query(text, [contestId]);
    return Boolean(res.rows[0]?.has_submissions);
  }

  /**
   * Safely delete a contest with atomic transaction, row-level locking, and audit logging
   * Prevents race condition where concurrent submission is created during deletion
   * @param {number|string} id
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<{success: boolean, hasSubmissions?: boolean, notFound?: boolean}>}
   */
  static async deleteContestWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock the contest row for update
      const cRes = await client.query(
        'SELECT id FROM contests WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      // 2. Authoritative check under row lock
      const subRes = await client.query(
        'SELECT EXISTS (SELECT 1 FROM submissions WHERE contest_id = $1) AS has_submissions',
        [id]
      );

      if (subRes.rows[0]?.has_submissions) {
        await client.query('ROLLBACK');
        return { success: false, hasSubmissions: true };
      }

      // 3. Safe deletion of dependent mappings
      await client.query('DELETE FROM contest_problems WHERE contest_id = $1', [id]);
      await client.query('DELETE FROM contest_participants WHERE contest_id = $1', [id]);
      await client.query('DELETE FROM contests WHERE id = $1', [id]);

      // 4. Audit log on same transaction client before COMMIT
      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_DELETED',
          resourceType: 'contest',
          resourceId: id,
          outcome: 'success',
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete contest (delegates to deleteContestWithSafety)
   */
  static async deleteContest(id) {
    const result = await ContestModel.deleteContestWithSafety(id);
    return result.success;
  }

  // ==========================================
  // CONTEST PROBLEMS RELATIONSHIP METHODS
  // ==========================================

  /**
   * Safely add a problem to a contest with transactional row locking & lifecycle checks
   * @param {Object} params - { contestId, problemId, points, problemOrder }
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<{success?: boolean, mapping?: Object, locked?: boolean, runtimeState?: string, message?: string, duplicate?: boolean, notFound?: boolean, resource?: string}>}
   */
  static async addProblemToContestWithSafety({ contestId, problemId, points = 100, problemOrder = 1 }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock contest row for update to guarantee authoritative runtimeState
      const cRes = await client.query(`
        SELECT id, start_time AS "startTime", end_time AS "endTime", status
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [contestId]);

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'contest' };
      }

      const lockedContest = cRes.rows[0];
      const runtimeState = getContestRuntimeState(lockedContest);

      if (isLifecycleMutationLocked(runtimeState)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getProblemMutationLockMessage(runtimeState),
        };
      }

      // 2. Check if problem exists
      const pRes = await client.query('SELECT id FROM problems WHERE id = $1', [problemId]);
      if (pRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'problem' };
      }

      // 3. Check if duplicate
      const existRes = await client.query(
        'SELECT 1 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
        [contestId, problemId]
      );
      if (existRes.rowCount > 0) {
        await client.query('ROLLBACK');
        return { success: false, duplicate: true };
      }

      // 4. Safe insert
      const insertRes = await client.query(`
        INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
        VALUES ($1, $2, $3, $4)
        RETURNING contest_id AS "contestId", problem_id AS "problemId", points, problem_order AS "problemOrder";
      `, [contestId, problemId, points, problemOrder]);

      const mapping = insertRes.rows[0];

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEM_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { problemId, points, problemOrder },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, mapping };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Safely remove a problem from a contest with transactional row locking & lifecycle checks
   * @param {number|string} contestId
   * @param {number|string} problemId
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<{success?: boolean, locked?: boolean, runtimeState?: string, message?: string, notFound?: boolean, resource?: string}>}
   */
  static async removeProblemFromContestWithSafety(contestId, problemId, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock contest row for update
      const cRes = await client.query(`
        SELECT id, start_time AS "startTime", end_time AS "endTime", status
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [contestId]);

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'contest' };
      }

      const lockedContest = cRes.rows[0];
      const runtimeState = getContestRuntimeState(lockedContest);

      if (isLifecycleMutationLocked(runtimeState)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getProblemMutationLockMessage(runtimeState),
        };
      }

      // 2. Delete relationship
      const delRes = await client.query(
        'DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2 RETURNING problem_id;',
        [contestId, problemId]
      );

      if (delRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'mapping' };
      }

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEM_REMOVED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { problemId },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Safely bulk add problems to a contest
   */
  static async bulkAddProblemsWithSafety(contestId, problems = [], actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(`
        SELECT id, start_time AS "startTime", end_time AS "endTime", status
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [contestId]);

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'contest' };
      }

      const lockedContest = cRes.rows[0];
      const runtimeState = getContestRuntimeState(lockedContest);

      if (isLifecycleMutationLocked(runtimeState)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getProblemMutationLockMessage(runtimeState),
        };
      }

      const mappings = [];
      for (const item of problems) {
        const { problemId, points = 100, problemOrder = 1 } = item;
        const pRes = await client.query('SELECT id FROM problems WHERE id = $1', [problemId]);
        if (pRes.rowCount > 0) {
          const insertRes = await client.query(`
            INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (contest_id, problem_id) DO UPDATE SET points = EXCLUDED.points, problem_order = EXCLUDED.problem_order
            RETURNING contest_id AS "contestId", problem_id AS "problemId", points, problem_order AS "problemOrder";
          `, [contestId, problemId, points, problemOrder]);
          mappings.push(insertRes.rows[0]);
        }
      }

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEM_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { bulk: true, problemCount: mappings.length },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, mappings };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Safely bulk remove/clear problems from a contest
   */
  static async bulkRemoveProblemsWithSafety(contestId, problemIds = null, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(`
        SELECT id, start_time AS "startTime", end_time AS "endTime", status
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [contestId]);

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'contest' };
      }

      const lockedContest = cRes.rows[0];
      const runtimeState = getContestRuntimeState(lockedContest);

      if (isLifecycleMutationLocked(runtimeState)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getProblemMutationLockMessage(runtimeState),
        };
      }

      if (Array.isArray(problemIds) && problemIds.length > 0) {
        await client.query(
          'DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = ANY($2::int[]);',
          [contestId, problemIds]
        );
      } else {
        await client.query('DELETE FROM contest_problems WHERE contest_id = $1;', [contestId]);
      }

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEM_REMOVED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { bulk: true },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  static async addProblemToContest({ contestId, problemId, points = 100, problemOrder = 1 }) {
    const text = `
      INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
      VALUES ($1, $2, $3, $4)
      RETURNING contest_id AS "contestId", problem_id AS "problemId", points, problem_order AS "problemOrder";
    `;
    const res = await db.query(text, [contestId, problemId, points, problemOrder]);
    return res.rows[0];
  }

  static async removeProblemFromContest(contestId, problemId) {
    const text = 'DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2 RETURNING problem_id;';
    const res = await db.query(text, [contestId, problemId]);
    return res.rowCount > 0;
  }

  static async isProblemInContest(contestId, problemId) {
    const text = 'SELECT 1 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2;';
    const res = await db.query(text, [contestId, problemId]);
    return (res.rowCount || 0) > 0;
  }

  static async getContestProblems(contestId) {
    const text = `
      SELECT 
        p.id AS "problemId",
        p.title,
        p.description,
        p.difficulty,
        p.coding_mode,
        p.coding_mode AS "codingMode",
        p.starter_templates,
        p.starter_templates AS "starterTemplates",
        cp.problem_order AS "problemOrder",
        cp.points
      FROM contest_problems cp
      JOIN problems p ON cp.problem_id = p.id
      WHERE cp.contest_id = $1
      ORDER BY cp.problem_order ASC, p.id ASC;
    `;
    const res = await db.query(text, [contestId]);
    return res.rows;
  }

  static async countContestProblems(contestId) {
    const text = 'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1;';
    const res = await db.query(text, [contestId]);
    return res.rows[0] ? res.rows[0].count : 0;
  }

  // ==========================================
  // CONTEST PARTICIPANTS METHODS
  // ==========================================

  static async addParticipant(contestId, userId) {
    const text = `
      INSERT INTO contest_participants (contest_id, user_id)
      VALUES ($1, $2)
      RETURNING contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt";
    `;
    const res = await db.query(text, [contestId, userId]);
    return res.rows[0];
  }

  static async findParticipant(contestId, userId) {
    const text = `
      SELECT contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt"
      FROM contest_participants
      WHERE contest_id = $1 AND user_id = $2;
    `;
    const res = await db.query(text, [contestId, userId]);
    return res.rows[0] || null;
  }

  static async getContestParticipants(contestId) {
    const text = `
      SELECT 
        u.id AS "userId",
        u.username,
        u.full_name AS "fullName",
        cp.joined_at AS "joinedAt"
      FROM contest_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.contest_id = $1
      ORDER BY cp.joined_at ASC;
    `;
    const res = await db.query(text, [contestId]);
    return res.rows;
  }
}

module.exports = ContestModel;