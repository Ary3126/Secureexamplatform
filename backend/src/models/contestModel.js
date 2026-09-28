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
   * Find recent duplicate contest created by the same user to prevent rapid double-clicks
   * @param {Object} params - { title, createdBy, withinSeconds }
   * @returns {Promise<Object|null>}
   */
  static async findRecentDuplicate({ title, createdBy, withinSeconds = 3 }) {
    if (!title || !createdBy) return null;
    const text = `
      SELECT id, title, created_at AS "createdAt"
      FROM contests
      WHERE created_by = $1
        AND LOWER(TRIM(title)) = LOWER(TRIM($2))
        AND created_at >= NOW() - ($3 || ' seconds')::interval
      LIMIT 1;
    `;
    const res = await db.query(text, [createdBy, title, withinSeconds]);
    return res.rows[0] || null;
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
   * List all contests with optional search, status, runtimeState, filters, sorting, and pagination
   * @param {Object} options - { status, state, search, isRated, createdBy, user, sortBy, sortOrder, limit, offset }
   * @returns {Promise<Array<Object>>} Array with .totalCount property attached
   */
  static async findAllContests({
    status,
    state,
    search,
    isRated,
    createdBy,
    user = null,
    sortBy = 'startTime',
    sortOrder = 'DESC',
    limit = 50,
    offset = 0,
  } = {}) {
    const whereClauses = [];
    const values = [];

    // 1. RBAC & Privacy filter
    if (!user || user.role === 'student') {
      whereClauses.push("c.status = 'published'");
    } else if (user.role === 'professor') {
      values.push(user.id);
      whereClauses.push(`(c.status != 'draft' OR c.created_by = $${values.length})`);
    }

    // 2. Status filter
    if (status && status !== 'all') {
      values.push(status.toLowerCase());
      whereClauses.push(`c.status = $${values.length}`);
    }

    // 3. Runtime state filter (server-authoritative timestamps)
    if (state && state !== 'all') {
      const s = state.toLowerCase();
      if (s === 'upcoming') {
        whereClauses.push("c.status = 'published' AND c.start_time > CURRENT_TIMESTAMP");
      } else if (s === 'running') {
        whereClauses.push("c.status = 'published' AND c.start_time <= CURRENT_TIMESTAMP AND c.end_time > CURRENT_TIMESTAMP");
      } else if (s === 'ended') {
        whereClauses.push("c.status = 'published' AND c.end_time <= CURRENT_TIMESTAMP");
      } else if (s === 'draft') {
        whereClauses.push("c.status = 'draft'");
      } else if (s === 'archived') {
        whereClauses.push("c.status = 'archived'");
      }
    }

    // 4. Search query (title, description, ID, creator username)
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const term = search.trim();
      values.push(`%${term}%`);
      const strIdx = values.length;
      if (!isNaN(term) && Number.isInteger(parseFloat(term))) {
        values.push(parseInt(term, 10));
        whereClauses.push(`(c.id = $${values.length} OR c.title ILIKE $${strIdx} OR c.description ILIKE $${strIdx} OR u.username ILIKE $${strIdx})`);
      } else {
        whereClauses.push(`(c.title ILIKE $${strIdx} OR c.description ILIKE $${strIdx} OR u.username ILIKE $${strIdx})`);
      }
    }

    // 5. isRated filter
    if (isRated !== undefined && isRated !== null && isRated !== '' && isRated !== 'all') {
      const ratedBool = isRated === true || isRated === 'true';
      values.push(ratedBool);
      whereClauses.push(`c.is_rated = $${values.length}`);
    }

    // 6. Creator ID filter
    if (createdBy !== undefined && createdBy !== null && createdBy !== '' && !isNaN(parseInt(createdBy, 10))) {
      values.push(parseInt(createdBy, 10));
      whereClauses.push(`c.created_by = $${values.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 7. Whitelisted sorting
    const sortColMap = {
      startTime: 'c.start_time',
      endTime: 'c.end_time',
      createdAt: 'c.created_at',
      title: 'c.title',
      id: 'c.id',
      problemCount: 'COUNT(DISTINCT cp.problem_id)',
      participantCount: 'COUNT(DISTINCT part.user_id)',
    };
    const sortCol = sortColMap[sortBy] || 'c.start_time';
    const sortDir = sortOrder && String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const queryText = `
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
        COUNT(DISTINCT part.user_id)::int AS "participantCount",
        COUNT(*) OVER()::int AS "totalCount"
      FROM contests c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN contest_problems cp ON c.id = cp.contest_id
      LEFT JOIN contest_participants part ON c.id = part.contest_id
      ${whereSql}
      GROUP BY c.id, u.username 
      ORDER BY ${sortCol} ${sortDir} 
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res = await db.query(queryText, values);
    const rows = res.rows;

    let totalCount = 0;
    if (rows.length > 0) {
      totalCount = rows[0].totalCount || 0;
    } else if (offset > 0) {
      const countQuery = `
        SELECT COUNT(*)::int AS count
        FROM contests c
        LEFT JOIN users u ON c.created_by = u.id
        ${whereSql};
      `;
      const countRes = await db.query(countQuery, values.slice(0, values.length - 2));
      totalCount = countRes.rows[0]?.count || 0;
    }

    // Attach totalCount as a non-enumerable or direct property for array compatibility
    rows.totalCount = totalCount;
    return rows;
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
  static async addProblemToContestWithSafety({ contestId, problemId, points = 100, problemOrder }, actor = null, req = null) {
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

      // 4. Safe insert: auto-assign problem order if not specified
      let finalOrder = parseInt(problemOrder, 10);
      if (isNaN(finalOrder) || finalOrder <= 0) {
        const orderRes = await client.query(
          'SELECT COALESCE(MAX(problem_order), 0) + 1 AS "nextOrder" FROM contest_problems WHERE contest_id = $1',
          [contestId]
        );
        finalOrder = parseInt(orderRes.rows[0].nextOrder, 10);
      }

      const insertRes = await client.query(`
        INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
        VALUES ($1, $2, $3, $4)
        RETURNING contest_id AS "contestId", problem_id AS "problemId", points, problem_order AS "problemOrder";
      `, [contestId, problemId, points, finalOrder]);

      const mapping = insertRes.rows[0];

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEM_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { problemId, points, problemOrder: finalOrder },
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
      if (err.code === '23505') {
        return { success: false, duplicate: true };
      }
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
   * Safely update the order of problems attached to a contest with transactional row locking
   * @param {number|string} contestId
   * @param {Array<number|string>} orderedProblemIds - Array of problem IDs in the desired order
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<{success?: boolean, locked?: boolean, runtimeState?: string, message?: string, notFound?: boolean, invalid?: boolean, problems?: Array<Object>}>}
   */
  static async reorderContestProblemsWithSafety(contestId, orderedProblemIds, actor = null, req = null) {
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

      // 2. Fetch current attached problems under lock
      const currentRes = await client.query(`
        SELECT problem_id AS "problemId"
        FROM contest_problems
        WHERE contest_id = $1;
      `, [contestId]);

      const currentProblemIds = currentRes.rows.map(r => r.problemId);
      if (currentProblemIds.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, invalid: true, message: 'Contest has no attached problems to order' };
      }

      // 3. Validate count matches
      if (orderedProblemIds.length !== currentProblemIds.length) {
        await client.query('ROLLBACK');
        return {
          success: false,
          invalid: true,
          message: `Supplied problem count (${orderedProblemIds.length}) does not match contest attached problem count (${currentProblemIds.length})`,
        };
      }

      // 4. Validate all supplied IDs are positive integers and unique
      const seen = new Set();
      for (const rawId of orderedProblemIds) {
        const idNum = parseInt(rawId, 10);
        if (isNaN(idNum) || idNum <= 0) {
          await client.query('ROLLBACK');
          return { success: false, invalid: true, message: 'Invalid problem ID in ordering list' };
        }
        if (seen.has(idNum)) {
          await client.query('ROLLBACK');
          return { success: false, invalid: true, message: `Duplicate problem ID ${idNum} in ordering list` };
        }
        seen.add(idNum);
      }

      // 5. Validate that every current problem ID is present and no foreign problem IDs exist
      const currentSet = new Set(currentProblemIds);
      for (const id of seen) {
        if (!currentSet.has(id)) {
          await client.query('ROLLBACK');
          return {
            success: false,
            invalid: true,
            message: `Problem ID ${id} is not attached to this contest`,
          };
        }
      }

      // 6. Execute atomic ordering updates (1-indexed problem_order from 1 to N)
      for (let i = 0; i < orderedProblemIds.length; i++) {
        const probId = parseInt(orderedProblemIds[i], 10);
        const orderNum = i + 1;
        await client.query(`
          UPDATE contest_problems
          SET problem_order = $1
          WHERE contest_id = $2 AND problem_id = $3;
        `, [orderNum, contestId, probId]);
      }

      // 7. Retrieve updated problems list ordered by problem_order ASC, problem_id ASC
      const updatedRes = await client.query(`
        SELECT 
          p.id AS "problemId",
          p.title,
          p.description,
          p.difficulty,
          p.coding_mode AS "codingMode",
          p.starter_templates AS "starterTemplates",
          cp.problem_order AS "problemOrder",
          cp.points
        FROM contest_problems cp
        JOIN problems p ON cp.problem_id = p.id
        WHERE cp.contest_id = $1
        ORDER BY cp.problem_order ASC, p.id ASC;
      `, [contestId]);

      // 8. Audit log
      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_PROBLEMS_REORDERED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            problemCount: orderedProblemIds.length,
            orderedProblemIds: orderedProblemIds.map(id => parseInt(id, 10)),
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, problems: updatedRes.rows };
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