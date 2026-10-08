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
   * Create a contest within an atomic transaction with advisory locking and audit log
   * Prevents rapid double-clicks and concurrent duplicate creation race conditions
   */
  static async createContestWithSafety(params, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Acquire transaction-level advisory lock on (createdBy) to serialize concurrent contest creation by the same user
      if (params.createdBy) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contest_create_${params.createdBy}`]);
      }

      // Check for accidental duplicate submission within 3 seconds by the same user with the same title under lock
      if (params.title && params.createdBy) {
        const dupRes = await client.query(`
          SELECT id, title, created_at AS "createdAt"
          FROM contests
          WHERE created_by = $1
            AND LOWER(TRIM(title)) = LOWER(TRIM($2))
            AND created_at >= NOW() - interval '3 seconds'
          LIMIT 1;
        `, [params.createdBy, params.title]);

        if (dupRes.rowCount > 0) {
          await client.query('ROLLBACK');
          return {
            duplicate: true,
            message: 'A contest with this title was just created. Please wait a moment before resubmitting.',
            duplicateContestId: dupRes.rows[0].id,
          };
        }
      }

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
        c.final_results_snapshot AS "finalResultsSnapshot",
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
   * Update contest details with lifecycle mutation locks, finalization locks, and transactional row-level locking
   *
   * Result Integrity: After finalization (is_rating_finalized=true), fields that would affect
   * the official result record (isRated, leaderboardFreezeEnabled, leaderboardFreezeMinutes)
   * are blocked. The authoritative finalization state is read from the DB row lock, never from
   * client-supplied request body values.
   *
   * @param {number|string} id
   * @param {Object} updateData
   * @returns {Promise<{success?: boolean, contest?: Object, locked?: boolean, resultLocked?: boolean, runtimeState?: string, message?: string, notFound?: boolean}>}
   */
  static async updateContestWithSafety(id, { title, description, startTime, endTime, isRated, leaderboardFreezeEnabled, leaderboardFreezeMinutes, status }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Acquire exclusive row lock on contest.
      // Reading is_rating_finalized here under the FOR UPDATE lock gives us the authoritative
      // finalization state to enforce result immutability in the checks below.
      const checkRes = await client.query(`
        SELECT 
          id, 
          title, 
          description, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          status, 
          is_rated AS "isRated",
          created_by AS "createdBy",
          is_rating_finalized AS "isRatingFinalized",
          leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
          leaderboard_freeze_minutes AS "leaderboardFreezeMinutes"
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

      if (runtimeState === 'archived') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: getLifecycleLockMessage(runtimeState),
        };
      }

      // RESULT INTEGRITY CHECK: After finalization, certain fields are result-locked.
      // The authoritative finalization state comes from the DB row lock above, NOT from any
      // client-supplied body field. This is a server-side enforcement point.
      //
      // Blocked after finalization:
      //   - isRated: Changing rated status after final results are published would be misleading
      //     and would invalidate the official record of whether Elo changes were applied.
      //   - leaderboardFreezeEnabled / leaderboardFreezeMinutes: Freeze settings no longer affect
      //     the finalized leaderboard (freezeState=FINAL), but changing them could create confusion.
      //
      // Allowed after finalization:
      //   - title / description: Cosmetic metadata-only changes do not affect result integrity.
      //   - status=archived: A valid lifecycle close operation (ending the contest's public lifecycle).
      const isResultMutating = isRated !== undefined || leaderboardFreezeEnabled !== undefined || leaderboardFreezeMinutes !== undefined;
      const isArchiveOnly = status === 'archived' && title === undefined && description === undefined && startTime === undefined && endTime === undefined && isRated === undefined && leaderboardFreezeEnabled === undefined && leaderboardFreezeMinutes === undefined;

      if (lockedContest.isRatingFinalized && isResultMutating) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          resultLocked: true,
          runtimeState,
          message: 'Cannot modify result-affecting contest settings after final results have been published.',
        };
      }

      if (runtimeState === 'running' && isRated !== undefined && Boolean(isRated) !== Boolean(lockedContest.isRated)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: 'Cannot modify rated status while the contest is running.',
        };
      }

      // Check if lifecycle-defining fields are present in update
      const isLifecycleMutating = startTime !== undefined || endTime !== undefined || status !== undefined;

      // Special case: archiving an ended or draft contest is a valid lifecycle transition
      const isArchiveTransition = status === 'archived' && startTime === undefined && endTime === undefined && (runtimeState === 'ended' || runtimeState === 'draft');

      if (isLifecycleMutating && isLifecycleMutationLocked(runtimeState) && !isArchiveTransition) {
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
        const auditAction = status === 'archived' ? 'CONTEST_ARCHIVED' : 'CONTEST_UPDATED';
        await AuditLogger.logAction({
          actor,
          action: auditAction,
          resourceType: 'contest',
          resourceId: updated.id,
          outcome: 'success',
          metadata: {
            title: updated.title,
            isRated: updated.isRated,
            status: updated.status,
            leaderboardFreezeEnabled: updated.leaderboardFreezeEnabled,
            leaderboardFreezeMinutes: updated.leaderboardFreezeMinutes,
          },
          client,
          req,
        });

        // Audit freeze/unfreeze actions explicitly
        if (
          leaderboardFreezeEnabled !== undefined &&
          Boolean(lockedContest.leaderboardFreezeEnabled) !== Boolean(updated.leaderboardFreezeEnabled)
        ) {
          const freezeAction = updated.leaderboardFreezeEnabled ? 'CONTEST_FREEZE_ENABLED' : 'CONTEST_FREEZE_DISABLED';
          await AuditLogger.logAction({
            actor,
            action: freezeAction,
            resourceType: 'contest',
            resourceId: updated.id,
            outcome: 'success',
            metadata: {
              freezeEnabled: updated.leaderboardFreezeEnabled,
              freezeMinutes: updated.leaderboardFreezeMinutes,
            },
            client,
            req,
          });
        }
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
   * Unpublish a contest (published upcoming -> draft) inside an atomic transaction with row locking
   * Only permitted if:
   * 1. Contest exists
   * 2. Current status is 'published'
   * 3. RuntimeState is 'upcoming' (not running, ended, or archived)
   * 4. Contest has ZERO submissions
   */
  static async unpublishContestWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(
        'SELECT id, title, status, start_time AS "startTime", end_time AS "endTime", created_by AS "createdBy" FROM contests WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      const currentContest = cRes.rows[0];
      if (currentContest.status !== 'published') {
        await client.query('ROLLBACK');
        return {
          success: false,
          invalidStatus: true,
          currentStatus: currentContest.status,
          message: `Cannot unpublish contest: Contest is currently in '${currentContest.status}' status (must be published).`,
        };
      }

      const runtimeState = getContestRuntimeState(currentContest);
      if (runtimeState !== 'upcoming') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState,
          message: `Cannot unpublish contest while it is '${runtimeState}'. Only upcoming contests may be unpublished.`,
        };
      }

      // Check if any submissions exist
      const subRes = await client.query(
        'SELECT EXISTS (SELECT 1 FROM submissions WHERE contest_id = $1) AS has_submissions',
        [id]
      );
      if (subRes.rows[0]?.has_submissions) {
        await client.query('ROLLBACK');
        return {
          success: false,
          hasSubmissions: true,
          message: 'Cannot unpublish contest: Submissions already exist for this contest.',
        };
      }

      const updateRes = await client.query(
        `UPDATE contests 
         SET status = 'draft', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1
         RETURNING 
           id, title, description, start_time AS "startTime", end_time AS "endTime", 
           status, is_rated AS "isRated", is_rating_finalized AS "isRatingFinalized",
           ratings_finalized_at AS "ratingsFinalizedAt", leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
           leaderboard_freeze_minutes AS "leaderboardFreezeMinutes", created_by AS "createdBy",
           created_at AS "createdAt", updated_at AS "updatedAt";`,
        [id]
      );

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_UNPUBLISHED',
          resourceType: 'contest',
          resourceId: id,
          outcome: 'success',
          metadata: { previousStatus: 'published', previousRuntimeState: runtimeState },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, contest: updateRes.rows[0] };
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
   * Archive a contest inside an atomic transaction with row locking
   * Permitted for ended or draft contests. Actively running contests CANNOT be archived.
   * Preserves all submissions, participants, standings, ratings, and problem records.
   */
  static async archiveContestWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(
        'SELECT id, title, status, start_time AS "startTime", end_time AS "endTime", created_by AS "createdBy" FROM contests WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      const currentContest = cRes.rows[0];
      if (currentContest.status === 'archived') {
        await client.query('ROLLBACK');
        return {
          success: false,
          alreadyArchived: true,
          message: 'Contest is already archived.',
        };
      }

      const runtimeState = getContestRuntimeState(currentContest);
      if (runtimeState === 'running') {
        await client.query('ROLLBACK');
        return {
          success: false,
          running: true,
          message: 'Cannot archive an actively running contest.',
        };
      }

      const updateRes = await client.query(
        `UPDATE contests 
         SET status = 'archived', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1
         RETURNING 
           id, title, description, start_time AS "startTime", end_time AS "endTime", 
           status, is_rated AS "isRated", is_rating_finalized AS "isRatingFinalized",
           ratings_finalized_at AS "ratingsFinalizedAt", leaderboard_freeze_enabled AS "leaderboardFreezeEnabled",
           leaderboard_freeze_minutes AS "leaderboardFreezeMinutes", created_by AS "createdBy",
           created_at AS "createdAt", updated_at AS "updatedAt";`,
        [id]
      );

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'CONTEST_ARCHIVED',
          resourceType: 'contest',
          resourceId: id,
          outcome: 'success',
          metadata: { previousStatus: currentContest.status, previousRuntimeState: runtimeState },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, contest: updateRes.rows[0] };
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
        'SELECT id, status, start_time AS "startTime", end_time AS "endTime", is_rating_finalized AS "isRatingFinalized" FROM contests WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      const currentContest = cRes.rows[0];

      // Finalized contest immutability: once finalized, a contest and its results cannot be deleted
      if (currentContest.isRatingFinalized) {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          finalized: true,
          message: 'Cannot delete contest: Contest results have already been finalized and are permanently immutable.',
        };
      }

      const runtimeState = getContestRuntimeState(currentContest);
      if (runtimeState === 'running') {
        await client.query('ROLLBACK');
        return {
          success: false,
          running: true,
          message: 'Cannot delete an actively running contest.',
        };
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
        WHERE contest_id = $1
        FOR UPDATE;
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

      // 6. Execute atomic bulk ordering update in a single statement (safe against position collisions)
      const whenClauses = [];
      const queryParams = [contestId];
      const validProblemIds = [];

      for (let i = 0; i < orderedProblemIds.length; i++) {
        const probId = parseInt(orderedProblemIds[i], 10);
        const orderNum = i + 1;
        validProblemIds.push(probId);
        queryParams.push(probId, orderNum);
        const idParamIdx = queryParams.length - 1;
        const orderParamIdx = queryParams.length;
        whenClauses.push(`WHEN problem_id = $${idParamIdx}::int THEN $${orderParamIdx}::int`);
      }

      queryParams.push(validProblemIds);
      const arrayParamIdx = queryParams.length;

      const updateQuery = `
        UPDATE contest_problems
        SET problem_order = (CASE 
          ${whenClauses.join('\n          ')}
        END)::int
        WHERE contest_id = $1 AND problem_id = ANY($${arrayParamIdx}::int[]);
      `;

      await client.query(updateQuery, queryParams);

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

      // Verify final ordering invariant before committing
      const rows = updatedRes.rows;
      if (rows.length !== orderedProblemIds.length) {
        await client.query('ROLLBACK');
        return { success: false, invalid: true, message: 'Final ordering count mismatch' };
      }
      for (let i = 0; i < rows.length; i++) {
        const expectedId = parseInt(orderedProblemIds[i], 10);
        const expectedOrder = i + 1;
        if (rows[i].problemId !== expectedId || rows[i].problemOrder !== expectedOrder) {
          await client.query('ROLLBACK');
          return { success: false, invalid: true, message: 'Final ordering verification failed' };
        }
      }

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

  static async isProblemInContest(contestId, problemId, client = null) {
    const text = 'SELECT 1 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2;';
    const res = await (client || db).query(text, [contestId, problemId]);
    return (res.rowCount || 0) > 0;
  }

  static async getContestProblemPoints(contestId, problemId) {
    const text = 'SELECT points FROM contest_problems WHERE contest_id = $1 AND problem_id = $2;';
    const res = await db.query(text, [contestId, problemId]);
    return res.rows[0] ? res.rows[0].points : null;
  }

  /**
   * Check if a problem is attached to an actively running contest
   * @param {number|string} problemId
   * @param {Object|null} client - Optional transaction client
   * @returns {Promise<{ isLocked: boolean, contestId?: number, contestTitle?: string, message?: string }>}
   */
  static async getActiveRunningContestForProblem(problemId, client = null) {
    const text = `
      SELECT c.id, c.title, c.start_time AS "startTime", c.end_time AS "endTime"
      FROM contest_problems cp
      JOIN contests c ON cp.contest_id = c.id
      WHERE cp.problem_id = $1
        AND c.status = 'published'
        AND CURRENT_TIMESTAMP >= c.start_time
        AND CURRENT_TIMESTAMP < c.end_time
      LIMIT 1;
    `;
    const res = await (client || db).query(text, [problemId]);
    if (res.rowCount > 0) {
      const contest = res.rows[0];
      return {
        isLocked: true,
        contestId: contest.id,
        contestTitle: contest.title,
        message: `Cannot modify problem or its test cases while it is active in running contest "${contest.title}" (#${contest.id}). Problem configuration is locked during contest execution.`,
      };
    }
    return { isLocked: false };
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

  static async removeParticipant(contestId, userId) {
    const text = `
      DELETE FROM contest_participants
      WHERE contest_id = $1 AND user_id = $2
      RETURNING contest_id AS "contestId", user_id AS "userId";
    `;
    const res = await db.query(text, [contestId, userId]);
    return res.rowCount > 0;
  }

  /**
   * Safely join a contest with transactional row locking, lifecycle verification, and duplicate resilience
   * @param {number|string} contestId
   * @param {number|string} userId
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   */
  static async joinContestWithSafety(contestId, userId, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(`
        SELECT 
          id, 
          status, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          is_rating_finalized AS "isRatingFinalized"
        FROM contests
        WHERE id = $1
        FOR UPDATE;
      `, [contestId]);

      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      const contest = cRes.rows[0];

      if (contest.status === 'archived') {
        await client.query('ROLLBACK');
        return { success: false, archived: true, message: 'Cannot join contest: Contest is archived' };
      }

      if (contest.status !== 'published') {
        await client.query('ROLLBACK');
        return { success: false, notPublished: true, message: 'Cannot join contest: Contest is not yet published' };
      }

      if (contest.isRatingFinalized) {
        await client.query('ROLLBACK');
        return { success: false, finalized: true, message: 'Cannot join contest: Contest has already been finalized' };
      }

      const runtimeState = getContestRuntimeState(contest);
      if (runtimeState === 'ended') {
        await client.query('ROLLBACK');
        return { success: false, ended: true, message: 'Cannot join contest: Contest has already ended' };
      }

      if (runtimeState === 'archived') {
        await client.query('ROLLBACK');
        return { success: false, archived: true, message: 'Cannot join contest: Contest is archived' };
      }

      // Check if already enrolled under row lock
      const existingRes = await client.query(`
        SELECT contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt"
        FROM contest_participants
        WHERE contest_id = $1 AND user_id = $2;
      `, [contestId, userId]);

      if (existingRes.rowCount > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          alreadyJoined: true,
          participant: existingRes.rows[0],
        };
      }

      const insRes = await client.query(`
        INSERT INTO contest_participants (contest_id, user_id)
        VALUES ($1, $2)
        RETURNING contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt";
      `, [contestId, userId]);

      const participant = insRes.rows[0];

      if (actor && AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor,
          action: 'PARTICIPANT_JOINED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: { userId, contestId },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, participant };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rb) {}
      if (err.code === '23505') {
        const p = await ContestModel.findParticipant(contestId, userId);
        return { success: false, alreadyJoined: true, participant: p || { contestId, userId } };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Safely add a single participant with transactional row locking, role/status verification, and duplicate resilience
   * @param {Object} params - { contestId, targetUserId }
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   */
  static async addParticipantWithSafety({ contestId, targetUserId }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(`
        SELECT 
          id, 
          status, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          is_rating_finalized AS "isRatingFinalized"
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

      if (lockedContest.isRatingFinalized) {
        await client.query('ROLLBACK');
        return { success: false, locked: true, finalized: true, message: 'Cannot add participants: Contest has already been finalized' };
      }

      if (runtimeState === 'archived' || lockedContest.status === 'archived') {
        await client.query('ROLLBACK');
        return { success: false, locked: true, runtimeState: 'archived', message: 'Cannot add participants: Contest is archived' };
      }

      if (runtimeState === 'ended') {
        await client.query('ROLLBACK');
        return { success: false, locked: true, runtimeState: 'ended', message: 'Cannot add participants: Contest has already ended' };
      }

      // Verify student user
      const uRes = await client.query(`
        SELECT id, username, full_name AS "fullName", email, role, is_active AS "isActive"
        FROM users
        WHERE id = $1;
      `, [targetUserId]);

      if (uRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'student' };
      }

      const studentUser = uRes.rows[0];
      if (studentUser.role !== 'student') {
        await client.query('ROLLBACK');
        return { success: false, invalidRole: true, studentUser };
      }

      if (!studentUser.isActive) {
        await client.query('ROLLBACK');
        return { success: false, inactive: true, studentUser };
      }

      // Check duplicate
      const existing = await client.query(`
        SELECT contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt"
        FROM contest_participants
        WHERE contest_id = $1 AND user_id = $2;
      `, [contestId, targetUserId]);

      if (existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return { success: false, duplicate: true, studentUser, participant: existing.rows[0] };
      }

      const insRes = await client.query(`
        INSERT INTO contest_participants (contest_id, user_id)
        VALUES ($1, $2)
        RETURNING contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt";
      `, [contestId, targetUserId]);

      const participant = insRes.rows[0];

      if (actor && AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor,
          action: 'PARTICIPANT_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            studentId: targetUserId,
            studentUsername: studentUser.username,
            contestId,
            runtimeState,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return {
        success: true,
        participant: {
          contestId: participant.contestId,
          userId: participant.userId,
          joinedAt: participant.joinedAt,
          username: studentUser.username,
          fullName: studentUser.fullName,
          email: studentUser.email,
        },
      };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rb) {}
      if (err.code === '23505') {
        const p = await ContestModel.findParticipant(contestId, targetUserId);
        return { success: false, duplicate: true, participant: p || { contestId, userId: targetUserId } };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Safely remove a single participant with transactional row locking, dependency preservation, and audit logging
   * @param {Object} params - { contestId, targetUserId }
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   */
  static async removeParticipantWithSafety({ contestId, targetUserId }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const cRes = await client.query(`
        SELECT 
          id, 
          status, 
          start_time AS "startTime", 
          end_time AS "endTime", 
          is_rating_finalized AS "isRatingFinalized"
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

      if (lockedContest.isRatingFinalized) {
        await client.query('ROLLBACK');
        return { success: false, locked: true, finalized: true, message: 'Cannot remove participants: Contest has already been finalized' };
      }

      if (runtimeState === 'archived' || lockedContest.status === 'archived') {
        await client.query('ROLLBACK');
        return { success: false, locked: true, runtimeState: 'archived', message: 'Cannot remove participants: Contest is archived' };
      }

      if (runtimeState === 'ended') {
        await client.query('ROLLBACK');
        return { success: false, locked: true, runtimeState: 'ended', message: 'Cannot remove participants: Contest has already ended' };
      }

      // Check if enrolled
      const enrolledRes = await client.query(`
        SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2;
      `, [contestId, targetUserId]);

      if (enrolledRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, resource: 'participant' };
      }

      // Check historical submissions under the transaction!
      const subRes = await client.query(`
        SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2 LIMIT 1;
      `, [contestId, targetUserId]);

      if (subRes.rowCount > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          hasSubmissions: true,
          message: 'Cannot remove participant: User has submitted solutions in this contest. Historical submission records must be preserved.',
        };
      }

      await client.query(`
        DELETE FROM contest_participants WHERE contest_id = $1 AND user_id = $2;
      `, [contestId, targetUserId]);

      if (actor && AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor,
          action: 'PARTICIPANT_REMOVED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            studentId: targetUserId,
            contestId,
            runtimeState,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (rb) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Bulk add participants with transaction atomicity, row-level locking, and duplicate resilience
   * @param {number|string} contestId
   * @param {Array<number|string>} userIds
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   */
  static async bulkAddParticipantsWithSafety(contestId, userIds = [], actor = null, req = null) {
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

      if (runtimeState === 'archived' || lockedContest.status === 'archived') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState: 'archived',
          message: 'Cannot add participants: Contest is archived',
        };
      }

      if (runtimeState === 'ended') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState: 'ended',
          message: 'Cannot add participants: Contest has already ended',
        };
      }

      // Deduplicate and filter positive integer IDs
      const uniqueUserIds = [...new Set(
        userIds
          .map((id) => (typeof id === 'object' && id !== null ? Number(id.userId || id.id || id.studentId) : Number(id)))
          .filter((id) => Number.isInteger(id) && id > 0)
      )];

      if (uniqueUserIds.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, validationError: true, message: 'No valid participant user IDs provided' };
      }

      // Batch query all requested user accounts
      const usersRes = await client.query(`
        SELECT id, username, full_name AS "fullName", email, role, is_active AS "isActive"
        FROM users
        WHERE id = ANY($1::int[]);
      `, [uniqueUserIds]);

      const userMap = new Map(usersRes.rows.map((u) => [u.id, u]));

      // Batch query already enrolled participants for this contest
      const enrolledRes = await client.query(`
        SELECT user_id AS "userId"
        FROM contest_participants
        WHERE contest_id = $1 AND user_id = ANY($2::int[]);
      `, [contestId, uniqueUserIds]);

      const enrolledSet = new Set(enrolledRes.rows.map((r) => r.userId));

      const added = [];
      const alreadyEnrolled = [];
      const invalid = [];
      const toInsert = [];

      for (const uid of uniqueUserIds) {
        const u = userMap.get(uid);
        if (!u) {
          invalid.push({ userId: uid, reason: 'User not found' });
        } else if (u.role !== 'student') {
          invalid.push({ userId: uid, username: u.username, reason: 'User is not a student account' });
        } else if (!u.isActive) {
          invalid.push({ userId: uid, username: u.username, reason: 'Student account is inactive' });
        } else if (enrolledSet.has(uid)) {
          alreadyEnrolled.push({ userId: uid, username: u.username, reason: 'Already enrolled in this contest' });
        } else {
          toInsert.push(u);
        }
      }

      // Perform inserts with ON CONFLICT DO NOTHING for concurrency safety
      for (const u of toInsert) {
        const insRes = await client.query(`
          INSERT INTO contest_participants (contest_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT (contest_id, user_id) DO NOTHING
          RETURNING contest_id AS "contestId", user_id AS "userId", joined_at AS "joinedAt";
        `, [contestId, u.id]);

        if (insRes.rowCount > 0) {
          added.push({
            contestId,
            userId: u.id,
            username: u.username,
            fullName: u.fullName,
            email: u.email,
            joinedAt: insRes.rows[0].joinedAt,
          });
        } else {
          // Concurrent addition race won by another transaction
          alreadyEnrolled.push({ userId: u.id, username: u.username, reason: 'Already enrolled in this contest' });
        }
      }

      // Log security audit for bulk addition
      if (added.length > 0 && actor) {
        await AuditLogger.logAction({
          actor,
          action: 'BULK_PARTICIPANTS_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            contestId,
            totalRequested: uniqueUserIds.length,
            addedCount: added.length,
            alreadyEnrolledCount: alreadyEnrolled.length,
            invalidCount: invalid.length,
            addedStudentIds: added.map((a) => a.userId),
            runtimeState,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      return {
        success: true,
        summary: {
          totalRequested: uniqueUserIds.length,
          addedCount: added.length,
          alreadyEnrolledCount: alreadyEnrolled.length,
          invalidCount: invalid.length,
        },
        added,
        alreadyEnrolled,
        invalid,
      };
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
   * Bulk remove participants with submission dependency preservation and transactional safety
   * @param {number|string} contestId
   * @param {Array<number|string>} userIds
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   */
  static async bulkRemoveParticipantsWithSafety(contestId, userIds = [], actor = null, req = null) {
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

      if (runtimeState === 'archived' || lockedContest.status === 'archived') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState: 'archived',
          message: 'Cannot remove participants: Contest is archived',
        };
      }

      if (runtimeState === 'ended') {
        await client.query('ROLLBACK');
        return {
          success: false,
          locked: true,
          runtimeState: 'ended',
          message: 'Cannot remove participants: Contest has already ended',
        };
      }

      const uniqueUserIds = [...new Set(
        userIds
          .map((id) => (typeof id === 'object' && id !== null ? Number(id.userId || id.id) : Number(id)))
          .filter((id) => Number.isInteger(id) && id > 0)
      )];

      if (uniqueUserIds.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, validationError: true, message: 'No valid participant user IDs provided' };
      }

      // Check current participant enrollment
      const enrolledRes = await client.query(`
        SELECT cp.user_id AS "userId", u.username
        FROM contest_participants cp
        LEFT JOIN users u ON u.id = cp.user_id
        WHERE cp.contest_id = $1 AND cp.user_id = ANY($2::int[]);
      `, [contestId, uniqueUserIds]);

      const enrolledMap = new Map(enrolledRes.rows.map((r) => [r.userId, r.username || 'unknown']));

      // Check historical submissions to protect academic integrity and foreign keys
      const subsRes = await client.query(`
        SELECT DISTINCT user_id AS "userId"
        FROM submissions
        WHERE contest_id = $1 AND user_id = ANY($2::int[]);
      `, [contestId, uniqueUserIds]);

      const subsSet = new Set(subsRes.rows.map((r) => r.userId));

      const removed = [];
      const blockedWithSubmissions = [];
      const notEnrolled = [];
      const toDelete = [];

      for (const uid of uniqueUserIds) {
        if (!enrolledMap.has(uid)) {
          notEnrolled.push({ userId: uid, reason: 'User is not enrolled in this contest' });
        } else if (subsSet.has(uid)) {
          blockedWithSubmissions.push({
            userId: uid,
            username: enrolledMap.get(uid),
            reason: 'Cannot remove participant: User has submitted solutions in this contest. Historical submission records must be preserved.',
          });
        } else {
          toDelete.push(uid);
        }
      }

      if (toDelete.length > 0) {
        const delRes = await client.query(`
          DELETE FROM contest_participants
          WHERE contest_id = $1 AND user_id = ANY($2::int[])
          RETURNING user_id AS "userId";
        `, [contestId, toDelete]);

        for (const row of delRes.rows) {
          removed.push({
            userId: row.userId,
            username: enrolledMap.get(row.userId),
          });
        }
      }

      if (removed.length > 0 && actor) {
        await AuditLogger.logAction({
          actor,
          action: 'BULK_PARTICIPANTS_REMOVED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            contestId,
            totalRequested: uniqueUserIds.length,
            removedCount: removed.length,
            blockedCount: blockedWithSubmissions.length,
            notEnrolledCount: notEnrolled.length,
            removedUserIds: removed.map((r) => r.userId),
            runtimeState,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');

      return {
        success: true,
        summary: {
          totalRequested: uniqueUserIds.length,
          removedCount: removed.length,
          blockedCount: blockedWithSubmissions.length,
          notEnrolledCount: notEnrolled.length,
        },
        removed,
        blockedWithSubmissions,
        notEnrolled,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  static async searchAvailableStudents(contestId, { search = '', limit = 10 } = {}) {
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const values = [contestId];
    let whereClause = `
      WHERE u.role = 'student' 
        AND u.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM contest_participants cp 
          WHERE cp.contest_id = $1 AND cp.user_id = u.id
        )
    `;

    if (search && typeof search === 'string' && search.trim().length > 0) {
      values.push(`%${search.trim().toLowerCase()}%`);
      const searchIdx = values.length;
      whereClause += ` AND (
        LOWER(u.username) LIKE $${searchIdx}
        OR LOWER(u.full_name) LIKE $${searchIdx}
        OR LOWER(u.email) LIKE $${searchIdx}
        OR LOWER(COALESCE(u.institution, '')) LIKE $${searchIdx}
      )`;
    }

    values.push(parsedLimit);
    const limitIdx = values.length;

    const query = `
      SELECT 
        u.id, 
        u.username, 
        u.full_name AS "fullName", 
        u.email, 
        u.institution, 
        u.current_rating AS "currentRating"
      FROM users u
      ${whereClause}
      ORDER BY u.username ASC
      LIMIT $${limitIdx};
    `;

    const res = await db.query(query, values);
    return res.rows;
  }


  static async getContestParticipants(contestId, options = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'joinedAt',
      sortOrder = 'ASC',
      all = false,
    } = options || {};

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;

    const values = [contestId];
    let whereClause = `WHERE cp.contest_id = $1`;

    if (search && typeof search === 'string' && search.trim().length > 0) {
      values.push(`%${search.trim().toLowerCase()}%`);
      const searchParamIdx = values.length;
      whereClause += ` AND (
        LOWER(u.username) LIKE $${searchParamIdx} 
        OR LOWER(u.full_name) LIKE $${searchParamIdx} 
        OR LOWER(u.email) LIKE $${searchParamIdx}
        OR LOWER(COALESCE(u.institution, '')) LIKE $${searchParamIdx}
      )`;
    }

    // 1. Total count query
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM contest_participants cp
      JOIN users u ON cp.user_id = u.id
      ${whereClause};
    `;
    const countRes = await db.query(countSql, values);
    const total = countRes.rows[0]?.total || 0;

    // 2. Sort column mapping with strict whitelist
    const SORT_MAP = {
      joinedat: 'cp.joined_at',
      joined_at: 'cp.joined_at',
      username: 'u.username',
      fullname: 'u.full_name',
      full_name: 'u.full_name',
      email: 'u.email',
      currentrating: 'u.current_rating',
      current_rating: 'u.current_rating',
      userid: 'u.id',
      user_id: 'u.id',
      id: 'u.id',
    };

    const normalizedSortBy = String(sortBy || 'joinedAt').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const sortCol = SORT_MAP[normalizedSortBy] || 'cp.joined_at';
    const orderDirection = String(sortOrder).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // 3. Paginated data query
    let dataSql = `
      SELECT 
        u.id AS "userId",
        u.username,
        u.full_name AS "fullName",
        u.email,
        u.institution,
        u.current_rating AS "currentRating",
        u.highest_rating AS "highestRating",
        u.rating_status AS "ratingStatus",
        u.avatar_url AS "avatarUrl",
        cp.joined_at AS "joinedAt"
      FROM contest_participants cp
      JOIN users u ON cp.user_id = u.id
      ${whereClause}
      ORDER BY ${sortCol} ${orderDirection}, u.id ASC
    `;

    if (!all) {
      values.push(parsedLimit);
      const limitParamIdx = values.length;
      values.push(offset);
      const offsetParamIdx = values.length;
      dataSql += ` LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;
    }

    dataSql += `;`;

    const dataRes = await db.query(dataSql, values);

    return {
      participants: dataRes.rows,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    };
  }
}

module.exports = ContestModel;