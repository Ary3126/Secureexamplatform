/**
 * CODEFROG Test Data Management & Permanent Deletion Service
 * File: backend/src/services/testDataService.js
 *
 * Core authoritative service for identifying, previewing, and permanently
 * deleting test-generated records while strictly protecting production data.
 */

const { pool, query } = require('../config/db');
const AuditLogger = require('./auditLogger');

// Protected canonical platform accounts and problems that can NEVER be deleted
const PROTECTED_USER_IDS = [2, 3, 1093, 3833, 4339];
const PROTECTED_USERNAMES = ['platform_admin', 'Ary', 'professor_seed', 'student_seed', 'admin', 'prof_alan'];
const PROTECTED_EMAILS = [
  'admin@securejudge.io',
  'patelary9054@gmail.com',
  'professor@university.edu',
  'student@university.edu',
  'prof@university.edu',
];
const PROTECTED_CONTEST_IDS = [147];
const PROTECTED_PROBLEM_IDS = [1914, 1797, 1798, 319, 320];

class TestDataService {
  /**
   * Get high-level summary of all test data in the system
   */
  static async getTestDataSummary() {
    const summaryQuery = `
      SELECT
        (SELECT COUNT(DISTINCT test_run_id) FROM users WHERE is_test_data = true AND test_run_id IS NOT NULL) AS test_run_count,
        (SELECT COUNT(*) FROM users WHERE is_test_data = true) AS test_user_count,
        (SELECT COUNT(*) FROM contests WHERE is_test_data = true) AS test_contest_count,
        (SELECT COUNT(*) FROM problems WHERE is_test_data = true) AS test_problem_count,
        (SELECT COUNT(*) FROM submissions WHERE is_test_data = true) AS test_submission_count,
        (SELECT COUNT(*) FROM users WHERE is_test_data = false) AS real_user_count,
        (SELECT COUNT(*) FROM contests WHERE is_test_data = false) AS real_contest_count,
        (SELECT COUNT(*) FROM problems WHERE is_test_data = false) AS real_problem_count
    `;

    const res = await query(summaryQuery);
    const row = res.rows[0];

    return {
      testRuns: parseInt(row.test_run_count, 10) || 0,
      testUsers: parseInt(row.test_user_count, 10) || 0,
      testContests: parseInt(row.test_contest_count, 10) || 0,
      testProblems: parseInt(row.test_problem_count, 10) || 0,
      testSubmissions: parseInt(row.test_submission_count, 10) || 0,
      realUsers: parseInt(row.real_user_count, 10) || 0,
      realContests: parseInt(row.real_contest_count, 10) || 0,
      realProblems: parseInt(row.real_problem_count, 10) || 0,
    };
  }

  /**
   * List distinct test runs with aggregated counts
   */
  static async getTestRuns({ page = 1, limit = 20, search = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let searchClause = '';
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      searchClause = `WHERE tr.test_run_id ILIKE $${params.length}`;
    }

    const runsSql = `
      WITH all_runs AS (
        SELECT test_run_id FROM users WHERE is_test_data = true AND test_run_id IS NOT NULL
        UNION
        SELECT test_run_id FROM contests WHERE is_test_data = true AND test_run_id IS NOT NULL
        UNION
        SELECT test_run_id FROM problems WHERE is_test_data = true AND test_run_id IS NOT NULL
      ),
      aggregated AS (
        SELECT
          ar.test_run_id,
          (SELECT COUNT(*) FROM users u WHERE u.test_run_id = ar.test_run_id AND u.is_test_data = true) AS user_count,
          (SELECT COUNT(*) FROM contests c WHERE c.test_run_id = ar.test_run_id AND c.is_test_data = true) AS contest_count,
          (SELECT COUNT(*) FROM problems p WHERE p.test_run_id = ar.test_run_id AND p.is_test_data = true) AS problem_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.test_run_id = ar.test_run_id AND s.is_test_data = true) AS submission_count,
          (
            SELECT MIN(c_at) FROM (
              SELECT created_at AS c_at FROM users WHERE test_run_id = ar.test_run_id
              UNION ALL
              SELECT created_at FROM contests WHERE test_run_id = ar.test_run_id
              UNION ALL
              SELECT created_at FROM problems WHERE test_run_id = ar.test_run_id
            ) t
          ) AS earliest_created_at
        FROM all_runs ar
      )
      SELECT tr.*, COUNT(*) OVER() AS total_count
      FROM aggregated tr
      ${searchClause}
      ORDER BY tr.earliest_created_at DESC NULLS LAST, tr.test_run_id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(limitNum, offset);

    const res = await query(runsSql, params);
    const total = res.rows.length > 0 ? parseInt(res.rows[0].total_count, 10) : 0;

    const runs = res.rows.map((r) => ({
      testRunId: r.test_run_id,
      userCount: parseInt(r.user_count, 10) || 0,
      contestCount: parseInt(r.contest_count, 10) || 0,
      problemCount: parseInt(r.problem_count, 10) || 0,
      submissionCount: parseInt(r.submission_count, 10) || 0,
      createdAt: r.earliest_created_at,
    }));

    return {
      runs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * List paginated test records by entity type ('users' | 'contests' | 'problems')
   */
  static async getTestRecords(type, { page = 1, limit = 20, search = '', runId = '' } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['is_test_data = true'];
    const params = [];

    if (runId && runId.trim()) {
      params.push(runId.trim());
      conditions.push(`test_run_id = $${params.length}`);
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      if (type === 'users') {
        conditions.push(`(username ILIKE $${params.length} OR email ILIKE $${params.length})`);
      } else if (type === 'contests') {
        conditions.push(`title ILIKE $${params.length}`);
      } else if (type === 'problems') {
        conditions.push(`title ILIKE $${params.length}`);
      }
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    let sql = '';
    if (type === 'users') {
      sql = `
        SELECT 
          u.id, u.username, u.email, u.role, u.test_run_id, u.created_at, u.is_active,
          (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id) AS submission_count,
          (SELECT COUNT(*) FROM contest_participants cp WHERE cp.user_id = u.id) AS participant_count,
          (SELECT COUNT(*) FROM rating_history rh WHERE rh.user_id = u.id) AS rating_count,
          COUNT(*) OVER() AS total_count
        FROM users u
        ${whereClause}
        ORDER BY u.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    } else if (type === 'contests') {
      sql = `
        SELECT 
          c.id, c.title, c.status, c.is_rated, c.test_run_id, c.created_at,
          (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count,
          (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_id = c.id) AS participant_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.contest_id = c.id) AS submission_count,
          COUNT(*) OVER() AS total_count
        FROM contests c
        ${whereClause}
        ORDER BY c.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    } else if (type === 'problems') {
      sql = `
        SELECT 
          p.id, p.title, p.difficulty, p.coding_mode, p.access_scope, p.review_status, p.test_run_id, p.created_at,
          (SELECT COUNT(*) FROM test_cases tc WHERE tc.problem_id = p.id) AS test_case_count,
          (SELECT COUNT(*) FROM contest_problems cp WHERE cp.problem_id = p.id) AS contest_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) AS submission_count,
          COUNT(*) OVER() AS total_count
        FROM problems p
        ${whereClause}
        ORDER BY p.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
    } else {
      throw new Error(`Invalid record type: ${type}`);
    }

    params.push(limitNum, offset);

    const res = await query(sql, params);
    const total = res.rows.length > 0 ? parseInt(res.rows[0].total_count, 10) : 0;

    return {
      type,
      records: res.rows.map((r) => {
        const item = { ...r };
        delete item.total_count;
        return item;
      }),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * Calculate dependency counts and verify deletion safety for a single record
   */
  static async getPreview(type, id) {
    const numId = parseInt(id, 10);
    if (!numId || numId <= 0) {
      return { success: false, statusCode: 400, message: 'Invalid ID format' };
    }

    if (type === 'users') {
      const uRes = await query('SELECT * FROM users WHERE id = $1', [numId]);
      if (uRes.rows.length === 0) {
        return { success: false, statusCode: 404, message: 'User not found' };
      }
      const u = uRes.rows[0];

      // Check protection
      const isProtected =
        !u.is_test_data ||
        PROTECTED_USER_IDS.includes(u.id) ||
        PROTECTED_USERNAMES.includes(u.username) ||
        PROTECTED_EMAILS.includes(u.email);

      if (isProtected) {
        return {
          success: true,
          canDelete: false,
          reason: 'Protected real/production user account. Deletion strictly blocked.',
          entity: { id: u.id, name: u.username, role: u.role, type: 'user', isTestData: false },
          dependentCounts: {},
        };
      }

      // Check if user created real contests or problems
      const realContests = await query(
        'SELECT id, title FROM contests WHERE created_by = $1 AND is_test_data = false',
        [numId]
      );
      const realProblems = await query(
        'SELECT id, title FROM problems WHERE created_by = $1 AND is_test_data = false',
        [numId]
      );

      if (realContests.rows.length > 0 || realProblems.rows.length > 0) {
        return {
          success: true,
          canDelete: false,
          reason: 'User created production contests or problems. Deletion blocked to protect production data integrity.',
          entity: { id: u.id, name: u.username, role: u.role, type: 'user', isTestData: true },
          dependentCounts: {
            realContestsCreated: realContests.rows.length,
            realProblemsCreated: realProblems.rows.length,
          },
        };
      }

      const countsRes = await query(`
        SELECT
          (SELECT COUNT(*) FROM submissions WHERE user_id = $1) AS submissions,
          (SELECT COUNT(*) FROM contest_participants WHERE user_id = $1) AS contest_participants,
          (SELECT COUNT(*) FROM rating_history WHERE user_id = $1) AS rating_history,
          (SELECT COUNT(*) FROM user_skills WHERE user_id = $1) AS user_skills,
          (SELECT COUNT(*) FROM saved_problems WHERE user_id = $1) AS saved_problems,
          (SELECT COUNT(*) FROM audit_logs WHERE actor_id = $1) AS audit_logs
      `, [numId]);

      const c = countsRes.rows[0];
      return {
        success: true,
        canDelete: true,
        entity: {
          id: u.id,
          name: u.username,
          email: u.email,
          role: u.role,
          testRunId: u.test_run_id,
          createdAt: u.created_at,
          type: 'user',
          isTestData: true,
        },
        dependentCounts: {
          submissions: parseInt(c.submissions, 10) || 0,
          contestParticipants: parseInt(c.contest_participants, 10) || 0,
          ratingHistory: parseInt(c.rating_history, 10) || 0,
          userSkills: parseInt(c.user_skills, 10) || 0,
          savedProblems: parseInt(c.saved_problems, 10) || 0,
          auditLogs: parseInt(c.audit_logs, 10) || 0,
        },
      };
    }

    if (type === 'contests') {
      const cRes = await query('SELECT * FROM contests WHERE id = $1', [numId]);
      if (cRes.rows.length === 0) {
        return { success: false, statusCode: 404, message: 'Contest not found' };
      }
      const c = cRes.rows[0];

      if (!c.is_test_data || PROTECTED_CONTEST_IDS.includes(c.id)) {
        return {
          success: true,
          canDelete: false,
          reason: 'Protected real/production contest. Deletion strictly blocked.',
          entity: { id: c.id, name: c.title, type: 'contest', isTestData: false },
          dependentCounts: {},
        };
      }

      // Check if real users participated or submitted
      const realUsersInContest = await query(`
        SELECT COUNT(DISTINCT u.id) AS count
        FROM contest_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.contest_id = $1 AND u.is_test_data = false
      `, [numId]);

      const realSubmissions = await query(`
        SELECT COUNT(*) AS count
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        WHERE s.contest_id = $1 AND u.is_test_data = false
      `, [numId]);

      const realCount = parseInt(realUsersInContest.rows[0].count, 10) || 0;
      const realSubCount = parseInt(realSubmissions.rows[0].count, 10) || 0;

      if (realCount > 0 || realSubCount > 0) {
        return {
          success: true,
          canDelete: false,
          reason: `Contest contains participations or submissions from ${realCount} real user accounts. Cannot delete.`,
          entity: { id: c.id, name: c.title, type: 'contest', isTestData: true },
          dependentCounts: { realParticipants: realCount, realSubmissions: realSubCount },
        };
      }

      const countsRes = await query(`
        SELECT
          (SELECT COUNT(*) FROM contest_problems WHERE contest_id = $1) AS contest_problems,
          (SELECT COUNT(*) FROM contest_participants WHERE contest_id = $1) AS participants,
          (SELECT COUNT(*) FROM submissions WHERE contest_id = $1) AS submissions,
          (SELECT COUNT(*) FROM rating_history WHERE contest_id = $1) AS rating_history
      `, [numId]);

      const cnt = countsRes.rows[0];
      return {
        success: true,
        canDelete: true,
        entity: {
          id: c.id,
          name: c.title,
          status: c.status,
          testRunId: c.test_run_id,
          createdAt: c.created_at,
          type: 'contest',
          isTestData: true,
        },
        dependentCounts: {
          contestProblems: parseInt(cnt.contest_problems, 10) || 0,
          participants: parseInt(cnt.participants, 10) || 0,
          submissions: parseInt(cnt.submissions, 10) || 0,
          ratingHistory: parseInt(cnt.rating_history, 10) || 0,
        },
      };
    }

    if (type === 'problems') {
      const pRes = await query('SELECT * FROM problems WHERE id = $1', [numId]);
      if (pRes.rows.length === 0) {
        return { success: false, statusCode: 404, message: 'Problem not found' };
      }
      const p = pRes.rows[0];

      const isProtected = !p.is_test_data || PROTECTED_PROBLEM_IDS.includes(p.id);
      if (isProtected) {
        return {
          success: true,
          canDelete: false,
          reason: 'Protected real/production problem. Deletion strictly blocked.',
          entity: { id: p.id, name: p.title, type: 'problem', isTestData: false },
          dependentCounts: {},
        };
      }

      // Check if linked to real contests
      const realContests = await query(`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM contest_problems cp
        JOIN contests c ON cp.contest_id = c.id
        WHERE cp.problem_id = $1 AND c.is_test_data = false
      `, [numId]);

      // Check if submitted by real users
      const realSubmissions = await query(`
        SELECT COUNT(*) AS count
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        WHERE s.problem_id = $1 AND u.is_test_data = false
      `, [numId]);

      const realContestCount = parseInt(realContests.rows[0].count, 10) || 0;
      const realSubCount = parseInt(realSubmissions.rows[0].count, 10) || 0;

      if (realContestCount > 0 || realSubCount > 0) {
        return {
          success: true,
          canDelete: false,
          reason: `Problem is referenced by ${realContestCount} production contest(s) or has ${realSubCount} submission(s) from real users. Cannot delete.`,
          entity: { id: p.id, name: p.title, type: 'problem', isTestData: true },
          dependentCounts: { realContests: realContestCount, realSubmissions: realSubCount },
        };
      }

      const countsRes = await query(`
        SELECT
          (SELECT COUNT(*) FROM test_cases WHERE problem_id = $1) AS test_cases,
          (SELECT COUNT(*) FROM contest_problems WHERE problem_id = $1) AS contest_problems,
          (SELECT COUNT(*) FROM submissions WHERE problem_id = $1) AS submissions,
          (SELECT COUNT(*) FROM problem_versions WHERE problem_id = $1) AS problem_versions,
          (SELECT COUNT(*) FROM problem_reviews WHERE problem_id = $1) AS reviews
      `, [numId]);

      const cnt = countsRes.rows[0];
      return {
        success: true,
        canDelete: true,
        entity: {
          id: p.id,
          name: p.title,
          difficulty: p.difficulty,
          testRunId: p.test_run_id,
          createdAt: p.created_at,
          type: 'problem',
          isTestData: true,
        },
        dependentCounts: {
          testCases: parseInt(cnt.test_cases, 10) || 0,
          contestProblems: parseInt(cnt.contest_problems, 10) || 0,
          submissions: parseInt(cnt.submissions, 10) || 0,
          problemVersions: parseInt(cnt.problem_versions, 10) || 0,
          reviews: parseInt(cnt.reviews, 10) || 0,
        },
      };
    }

    return { success: false, statusCode: 400, message: `Unsupported preview type: ${type}` };
  }

  /**
   * Preview aggregated dependencies for an entire test run
   */
  static async getTestRunPreview(runId) {
    if (!runId || typeof runId !== 'string' || runId.trim() === '') {
      return { success: false, statusCode: 400, message: 'Valid testRunId required' };
    }

    const cleanRunId = runId.trim();

    const countsRes = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE test_run_id = $1 AND is_test_data = true) AS users,
        (SELECT COUNT(*) FROM contests WHERE test_run_id = $1 AND is_test_data = true) AS contests,
        (SELECT COUNT(*) FROM problems WHERE test_run_id = $1 AND is_test_data = true) AS problems,
        (SELECT COUNT(*) FROM submissions WHERE test_run_id = $1 AND is_test_data = true) AS submissions,
        (
          SELECT COUNT(*) FROM contest_participants cp
          JOIN contests c ON cp.contest_id = c.id
          WHERE c.test_run_id = $1 AND c.is_test_data = true
        ) AS participants,
        (
          SELECT COUNT(*) FROM rating_history rh
          JOIN contests c ON rh.contest_id = c.id
          WHERE c.test_run_id = $1 AND c.is_test_data = true
        ) AS rating_history,
        (
          SELECT COUNT(*) FROM test_cases tc
          JOIN problems p ON tc.problem_id = p.id
          WHERE p.test_run_id = $1 AND p.is_test_data = true
        ) AS test_cases
    `, [cleanRunId]);

    const row = countsRes.rows[0];
    const totalUsers = parseInt(row.users, 10) || 0;
    const totalContests = parseInt(row.contests, 10) || 0;
    const totalProblems = parseInt(row.problems, 10) || 0;

    if (totalUsers === 0 && totalContests === 0 && totalProblems === 0) {
      return { success: false, statusCode: 404, message: `No test records found for test run ID: "${cleanRunId}"` };
    }

    // Verify no protected data matches this test run ID
    const protectedMatch = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($2::int[]))) AS protected_users,
        (SELECT COUNT(*) FROM contests WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($3::int[]))) AS protected_contests,
        (SELECT COUNT(*) FROM problems WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($4::int[]))) AS protected_problems
    `, [cleanRunId, PROTECTED_USER_IDS, PROTECTED_CONTEST_IDS, PROTECTED_PROBLEM_IDS]);

    const pRow = protectedMatch.rows[0];
    const hasProtected =
      parseInt(pRow.protected_users, 10) > 0 ||
      parseInt(pRow.protected_contests, 10) > 0 ||
      parseInt(pRow.protected_problems, 10) > 0;

    if (hasProtected) {
      return {
        success: true,
        canDelete: false,
        reason: 'Test run references protected production records. Deletion cannot proceed.',
        runId: cleanRunId,
        dependentCounts: {},
      };
    }

    return {
      success: true,
      canDelete: true,
      runId: cleanRunId,
      dependentCounts: {
        users: totalUsers,
        contests: totalContests,
        problems: totalProblems,
        submissions: parseInt(row.submissions, 10) || 0,
        participants: parseInt(row.participants, 10) || 0,
        ratingHistory: parseInt(row.rating_history, 10) || 0,
        testCases: parseInt(row.test_cases, 10) || 0,
      },
    };
  }

  /**
   * Permanently delete a test user and all dependent records in a transaction
   */
  static async deleteTestUser(userId, actorId, { skipAuditIfNoActor = false } = {}) {
    const numId = parseInt(userId, 10);
    if (!numId || numId <= 0) {
      return { success: false, statusCode: 400, message: 'Invalid user ID format' };
    }

    // 1. Fetch user & check protection
    const uRes = await query('SELECT * FROM users WHERE id = $1', [numId]);
    if (uRes.rows.length === 0) {
      return { success: false, statusCode: 404, message: `User #${numId} not found` };
    }
    const user = uRes.rows[0];

    const isProtected =
      !user.is_test_data ||
      PROTECTED_USER_IDS.includes(user.id) ||
      PROTECTED_USERNAMES.includes(user.username) ||
      PROTECTED_EMAILS.includes(user.email);

    if (isProtected) {
      return {
        success: false,
        statusCode: 403,
        message: 'Forbidden: Cannot delete real/production user account. Only records marked as test data can be deleted.',
      };
    }

    // Check if user created any real contest or problem
    const realContests = await query(
      'SELECT id FROM contests WHERE created_by = $1 AND is_test_data = false',
      [numId]
    );
    const realProblems = await query(
      'SELECT id FROM problems WHERE created_by = $1 AND is_test_data = false',
      [numId]
    );

    if (realContests.rows.length > 0 || realProblems.rows.length > 0) {
      return {
        success: false,
        statusCode: 409,
        message: 'Conflict: User created production contests or problems. Deletion blocked.',
      };
    }

    const client = await pool.connect();
    let deletedRecords = 0;

    try {
      await client.query('BEGIN');

      // Delete submission validation runs
      const svrRes = await client.query(`
        DELETE FROM submission_validation_runs 
        WHERE submission_id IN (SELECT id FROM submissions WHERE user_id = $1)
      `, [numId]);
      deletedRecords += svrRes.rowCount;

      // Delete submissions (respecting ON DELETE RESTRICT from other tables)
      const subRes = await client.query('DELETE FROM submissions WHERE user_id = $1', [numId]);
      deletedRecords += subRes.rowCount;

      // Delete rating history
      const rhRes = await client.query('DELETE FROM rating_history WHERE user_id = $1', [numId]);
      deletedRecords += rhRes.rowCount;

      // Delete contest participations
      const cpRes = await client.query('DELETE FROM contest_participants WHERE user_id = $1', [numId]);
      deletedRecords += cpRes.rowCount;

      // Delete user skill history & skills
      await client.query('DELETE FROM user_skill_history WHERE user_id = $1', [numId]);
      await client.query('DELETE FROM user_skills WHERE user_id = $1', [numId]);

      // Delete saved problems
      await client.query('DELETE FROM saved_problems WHERE user_id = $1', [numId]);

      // Delete leaderboard snapshots
      await client.query('DELETE FROM leaderboard_snapshots WHERE user_id = $1', [numId]);

      // Delete test contests created by this test user
      const userContests = await client.query(
        'SELECT id FROM contests WHERE created_by = $1 AND is_test_data = true',
        [numId]
      );
      if (userContests.rows.length > 0) {
        const cIds = userContests.rows.map((r) => r.id);
        await client.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [cIds]);
        await client.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [cIds]);
        await client.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[])', [cIds]);
        await client.query('DELETE FROM contests WHERE id = ANY($1::int[])', [cIds]);
      }

      // Delete test problems created by this test user
      const userProblems = await client.query(
        'SELECT id FROM problems WHERE created_by = $1 AND is_test_data = true',
        [numId]
      );
      if (userProblems.rows.length > 0) {
        const pIds = userProblems.rows.map((r) => r.id);
        await client.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [pIds]);
        await client.query('DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])', [pIds]);
        await client.query('DELETE FROM problem_validation_configs WHERE problem_id = ANY($1::int[])', [pIds]);
        await client.query('DELETE FROM problem_quality_snapshots WHERE problem_id = ANY($1::int[])', [pIds]);
        await client.query('DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])', [pIds]);
        await client.query('DELETE FROM problems WHERE id = ANY($1::int[])', [pIds]);
      }

      // Nullify or delete audit logs
      await client.query('DELETE FROM audit_logs WHERE actor_id = $1', [numId]);

      // Finally delete user
      await client.query('DELETE FROM users WHERE id = $1', [numId]);
      deletedRecords += 1;

      await client.query('COMMIT');

      // Audit Log
      if (AuditLogger && AuditLogger.logAction && (!skipAuditIfNoActor || actorId)) {
        await AuditLogger.logAction({
          actor: actorId ? { id: actorId, role: 'admin' } : { id: 3, role: 'super_admin' },
          action: 'TEST_DATA_DELETED',
          resourceType: 'user',
          resourceId: numId,
          outcome: 'success',
          metadata: {
            deletedUsername: user.username,
            testRunId: user.test_run_id,
            totalDependentRecordsRemoved: deletedRecords,
          },
        }).catch((e) => console.warn('[AUDIT LOG WARNING]:', e.message));
      }

      return {
        success: true,
        statusCode: 200,
        message: `Test user "${user.username}" (#${numId}) and ${deletedRecords - 1} dependent records permanently deleted.`,
        deletedRecords,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE TEST USER ERROR]:', err);
      return { success: false, statusCode: 500, message: `Failed to delete test user: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Permanently delete a test contest and all dependent records in a transaction
   */
  static async deleteTestContest(contestId, actorId, { skipAuditIfNoActor = false } = {}) {
    const numId = parseInt(contestId, 10);
    if (!numId || numId <= 0) {
      return { success: false, statusCode: 400, message: 'Invalid contest ID format' };
    }

    const cRes = await query('SELECT * FROM contests WHERE id = $1', [numId]);
    if (cRes.rows.length === 0) {
      return { success: false, statusCode: 404, message: `Contest #${numId} not found` };
    }
    const contest = cRes.rows[0];

    if (!contest.is_test_data || PROTECTED_CONTEST_IDS.includes(contest.id)) {
      return {
        success: false,
        statusCode: 403,
        message: 'Forbidden: Cannot delete real/production contest. Only records marked as test data can be deleted.',
      };
    }

    // Verify no real student participated or submitted in this contest
    const realUsersInContest = await query(`
      SELECT COUNT(DISTINCT u.id) AS count
      FROM contest_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.contest_id = $1 AND u.is_test_data = false
    `, [numId]);

    const realSubmissions = await query(`
      SELECT COUNT(*) AS count
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.contest_id = $1 AND u.is_test_data = false
    `, [numId]);

    const realCount = parseInt(realUsersInContest.rows[0].count, 10) || 0;
    const realSubCount = parseInt(realSubmissions.rows[0].count, 10) || 0;

    if (realCount > 0 || realSubCount > 0) {
      return {
        success: false,
        statusCode: 409,
        message: `Conflict: Contest contains participations or submissions from real users (${realCount} participants, ${realSubCount} submissions). Deletion blocked.`,
      };
    }

    const client = await pool.connect();
    let deletedRecords = 0;

    try {
      await client.query('BEGIN');

      // 1. Delete submission validation runs for submissions in this contest
      const svrRes = await client.query(`
        DELETE FROM submission_validation_runs
        WHERE submission_id IN (SELECT id FROM submissions WHERE contest_id = $1)
      `, [numId]);
      deletedRecords += svrRes.rowCount;

      // 2. Delete contest submissions (resolving ON DELETE RESTRICT on contests_id)
      const subRes = await client.query('DELETE FROM submissions WHERE contest_id = $1', [numId]);
      deletedRecords += subRes.rowCount;

      // 3. Delete rating history for this contest
      const rhRes = await client.query('DELETE FROM rating_history WHERE contest_id = $1', [numId]);
      deletedRecords += rhRes.rowCount;

      // 4. Delete contest participants
      const cpRes = await client.query('DELETE FROM contest_participants WHERE contest_id = $1', [numId]);
      deletedRecords += cpRes.rowCount;

      // 5. Delete contest problems relationships
      const cprobRes = await client.query('DELETE FROM contest_problems WHERE contest_id = $1', [numId]);
      deletedRecords += cprobRes.rowCount;

      // 6. Delete contest audit logs
      await client.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = $1`, [numId]);

      // 7. Delete the contest itself
      await client.query('DELETE FROM contests WHERE id = $1', [numId]);
      deletedRecords += 1;

      await client.query('COMMIT');

      // Audit Log
      if (AuditLogger && AuditLogger.logAction && (!skipAuditIfNoActor || actorId)) {
        await AuditLogger.logAction({
          actor: actorId ? { id: actorId, role: 'admin' } : { id: 3, role: 'super_admin' },
          action: 'TEST_DATA_DELETED',
          resourceType: 'contest',
          resourceId: numId,
          outcome: 'success',
          metadata: {
            deletedTitle: contest.title,
            testRunId: contest.test_run_id,
            totalDependentRecordsRemoved: deletedRecords,
          },
        }).catch((e) => console.warn('[AUDIT LOG WARNING]:', e.message));
      }

      return {
        success: true,
        statusCode: 200,
        message: `Test contest "${contest.title}" (#${numId}) and ${deletedRecords - 1} dependent records permanently deleted.`,
        deletedRecords,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE TEST CONTEST ERROR]:', err);
      return { success: false, statusCode: 500, message: `Failed to delete test contest: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Permanently delete a test problem and all dependent records in a transaction
   */
  static async deleteTestProblem(problemId, actorId, { skipAuditIfNoActor = false } = {}) {
    const numId = parseInt(problemId, 10);
    if (!numId || numId <= 0) {
      return { success: false, statusCode: 400, message: 'Invalid problem ID format' };
    }

    const pRes = await query('SELECT * FROM problems WHERE id = $1', [numId]);
    if (pRes.rows.length === 0) {
      return { success: false, statusCode: 404, message: `Problem #${numId} not found` };
    }
    const problem = pRes.rows[0];

    const isProtected = !problem.is_test_data || PROTECTED_PROBLEM_IDS.includes(problem.id);
    if (isProtected) {
      return {
        success: false,
        statusCode: 403,
        message: 'Forbidden: Cannot delete real/production problem. Only records marked as test data can be deleted.',
      };
    }

    // Verify problem is not used in any real contest
    const realContests = await query(`
      SELECT COUNT(DISTINCT c.id) AS count
      FROM contest_problems cp
      JOIN contests c ON cp.contest_id = c.id
      WHERE cp.problem_id = $1 AND c.is_test_data = false
    `, [numId]);

    // Verify problem has no submissions from real users
    const realSubmissions = await query(`
      SELECT COUNT(*) AS count
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.problem_id = $1 AND u.is_test_data = false
    `, [numId]);

    const realContestCount = parseInt(realContests.rows[0].count, 10) || 0;
    const realSubCount = parseInt(realSubmissions.rows[0].count, 10) || 0;

    if (realContestCount > 0 || realSubCount > 0) {
      return {
        success: false,
        statusCode: 409,
        message: `Conflict: Problem is used in ${realContestCount} production contest(s) or has ${realSubCount} submission(s) from real users. Deletion blocked.`,
      };
    }

    const client = await pool.connect();
    let deletedRecords = 0;

    try {
      await client.query('BEGIN');

      // 1. Delete submission validation runs
      const svrRes = await client.query(`
        DELETE FROM submission_validation_runs
        WHERE problem_id = $1 OR submission_id IN (SELECT id FROM submissions WHERE problem_id = $1)
      `, [numId]);
      deletedRecords += svrRes.rowCount;

      // 2. Delete submissions for this problem (resolving ON DELETE RESTRICT on problem_id)
      const subRes = await client.query('DELETE FROM submissions WHERE problem_id = $1', [numId]);
      deletedRecords += subRes.rowCount;

      // 3. Delete contest problems relationships
      const cpRes = await client.query('DELETE FROM contest_problems WHERE problem_id = $1', [numId]);
      deletedRecords += cpRes.rowCount;

      // 4. Delete test cases
      const tcRes = await client.query('DELETE FROM test_cases WHERE problem_id = $1', [numId]);
      deletedRecords += tcRes.rowCount;

      // 5. Delete validation configs & snapshots
      await client.query('DELETE FROM problem_validation_configs WHERE problem_id = $1', [numId]);
      await client.query('DELETE FROM problem_quality_snapshots WHERE problem_id = $1', [numId]);

      // 6. Delete reviews and comments
      await client.query(`
        DELETE FROM problem_review_comments 
        WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id = $1)
      `, [numId]);
      await client.query('DELETE FROM problem_reviews WHERE problem_id = $1', [numId]);

      // 7. Delete problem versions
      await client.query('DELETE FROM problem_versions WHERE problem_id = $1', [numId]);

      // 8. Delete topics and saved problems
      await client.query('DELETE FROM problem_topics WHERE problem_id = $1', [numId]);
      await client.query('DELETE FROM saved_problems WHERE problem_id = $1', [numId]);

      // 9. Delete audit logs
      await client.query(`DELETE FROM audit_logs WHERE resource_type = 'problem' AND resource_id = $1`, [numId]);

      // 10. Delete the problem itself
      await client.query('DELETE FROM problems WHERE id = $1', [numId]);
      deletedRecords += 1;

      await client.query('COMMIT');

      // Audit Log
      if (AuditLogger && AuditLogger.logAction && (!skipAuditIfNoActor || actorId)) {
        await AuditLogger.logAction({
          actor: actorId ? { id: actorId, role: 'admin' } : { id: 3, role: 'super_admin' },
          action: 'TEST_DATA_DELETED',
          resourceType: 'problem',
          resourceId: numId,
          outcome: 'success',
          metadata: {
            deletedTitle: problem.title,
            testRunId: problem.test_run_id,
            totalDependentRecordsRemoved: deletedRecords,
          },
        }).catch((e) => console.warn('[AUDIT LOG WARNING]:', e.message));
      }

      return {
        success: true,
        statusCode: 200,
        message: `Test problem "${problem.title}" (#${numId}) and ${deletedRecords - 1} dependent records permanently deleted.`,
        deletedRecords,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE TEST PROBLEM ERROR]:', err);
      return { success: false, statusCode: 500, message: `Failed to delete test problem: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Permanently delete ALL records belonging to a test run in a single transaction
   */
  static async deleteTestRun(runId, actorId, { skipAuditIfNoActor = false } = {}) {
    if (!runId || typeof runId !== 'string' || runId.trim() === '') {
      return { success: false, statusCode: 400, message: 'Valid testRunId required' };
    }

    const cleanRunId = runId.trim();

    // Verify run exists
    const checkRes = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE test_run_id = $1 AND is_test_data = true) AS users,
        (SELECT COUNT(*) FROM contests WHERE test_run_id = $1 AND is_test_data = true) AS contests,
        (SELECT COUNT(*) FROM problems WHERE test_run_id = $1 AND is_test_data = true) AS problems,
        (SELECT COUNT(*) FROM submissions WHERE test_run_id = $1 AND is_test_data = true) AS submissions
    `, [cleanRunId]);

    const row = checkRes.rows[0];
    const uCount = parseInt(row.users, 10) || 0;
    const cCount = parseInt(row.contests, 10) || 0;
    const pCount = parseInt(row.problems, 10) || 0;
    const sCount = parseInt(row.submissions, 10) || 0;

    if (uCount === 0 && cCount === 0 && pCount === 0 && sCount === 0) {
      return { success: false, statusCode: 404, message: `Test run "${cleanRunId}" not found or has no test records.` };
    }

    // Verify NO protected records match this test run ID
    const protUsers = await query(`
      SELECT id, username FROM users WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($2::int[]))
    `, [cleanRunId, PROTECTED_USER_IDS]);

    const protContests = await query(`
      SELECT id, title FROM contests WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($2::int[]))
    `, [cleanRunId, PROTECTED_CONTEST_IDS]);

    const protProblems = await query(`
      SELECT id, title FROM problems WHERE test_run_id = $1 AND (is_test_data = false OR id = ANY($2::int[]))
    `, [cleanRunId, PROTECTED_PROBLEM_IDS]);

    if (protUsers.rows.length > 0 || protContests.rows.length > 0 || protProblems.rows.length > 0) {
      return {
        success: false,
        statusCode: 403,
        message: 'Forbidden: Test run contains protected production records. Deletion strictly blocked.',
      };
    }

    const client = await pool.connect();
    let totalDeleted = 0;

    try {
      await client.query('BEGIN');

      // 1. Gather IDs belonging to this test run
      const uRes = await client.query('SELECT id FROM users WHERE test_run_id = $1 AND is_test_data = true', [cleanRunId]);
      const userIds = uRes.rows.map((r) => r.id);

      const cRes = await client.query('SELECT id FROM contests WHERE test_run_id = $1 AND is_test_data = true', [cleanRunId]);
      const contestIds = cRes.rows.map((r) => r.id);

      const pRes = await client.query('SELECT id FROM problems WHERE test_run_id = $1 AND is_test_data = true', [cleanRunId]);
      const problemIds = pRes.rows.map((r) => r.id);

      // 2. Delete submission validation runs
      const svrRes = await client.query(`
        DELETE FROM submission_validation_runs
        WHERE submission_id IN (
          SELECT id FROM submissions 
          WHERE test_run_id = $1 
             OR (ARRAY_LENGTH($2::int[], 1) > 0 AND user_id = ANY($2::int[]))
             OR (ARRAY_LENGTH($3::int[], 1) > 0 AND contest_id = ANY($3::int[]))
             OR (ARRAY_LENGTH($4::int[], 1) > 0 AND problem_id = ANY($4::int[]))
        )
      `, [cleanRunId, userIds, contestIds, problemIds]);
      totalDeleted += svrRes.rowCount;

      // 3. Delete submissions
      const subRes = await client.query(`
        DELETE FROM submissions 
        WHERE test_run_id = $1 
           OR (ARRAY_LENGTH($2::int[], 1) > 0 AND user_id = ANY($2::int[]))
           OR (ARRAY_LENGTH($3::int[], 1) > 0 AND contest_id = ANY($3::int[]))
           OR (ARRAY_LENGTH($4::int[], 1) > 0 AND problem_id = ANY($4::int[]))
      `, [cleanRunId, userIds, contestIds, problemIds]);
      totalDeleted += subRes.rowCount;

      // 4. Delete rating history for these contests / users
      if (contestIds.length > 0 || userIds.length > 0) {
        const rhRes = await client.query(`
          DELETE FROM rating_history 
          WHERE (ARRAY_LENGTH($1::int[], 1) > 0 AND contest_id = ANY($1::int[]))
             OR (ARRAY_LENGTH($2::int[], 1) > 0 AND user_id = ANY($2::int[]))
        `, [contestIds, userIds]);
        totalDeleted += rhRes.rowCount;
      }

      // 5. Delete contest participants
      if (contestIds.length > 0 || userIds.length > 0) {
        const cpRes = await client.query(`
          DELETE FROM contest_participants 
          WHERE (ARRAY_LENGTH($1::int[], 1) > 0 AND contest_id = ANY($1::int[]))
             OR (ARRAY_LENGTH($2::int[], 1) > 0 AND user_id = ANY($2::int[]))
        `, [contestIds, userIds]);
        totalDeleted += cpRes.rowCount;
      }

      // 6. Delete contest problems
      if (contestIds.length > 0 || problemIds.length > 0) {
        const cpRes = await client.query(`
          DELETE FROM contest_problems 
          WHERE (ARRAY_LENGTH($1::int[], 1) > 0 AND contest_id = ANY($1::int[]))
             OR (ARRAY_LENGTH($2::int[], 1) > 0 AND problem_id = ANY($2::int[]))
        `, [contestIds, problemIds]);
        totalDeleted += cpRes.rowCount;
      }

      // 7. Delete problem test cases, validation configs, versions, reviews
      if (problemIds.length > 0) {
        const tcRes = await client.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [problemIds]);
        totalDeleted += tcRes.rowCount;
        await client.query('DELETE FROM problem_validation_configs WHERE problem_id = ANY($1::int[])', [problemIds]);
        await client.query('DELETE FROM problem_quality_snapshots WHERE problem_id = ANY($1::int[])', [problemIds]);
        await client.query(`
          DELETE FROM problem_review_comments 
          WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id = ANY($1::int[]))
        `, [problemIds]);
        await client.query('DELETE FROM problem_reviews WHERE problem_id = ANY($1::int[])', [problemIds]);
        await client.query('DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])', [problemIds]);
        await client.query('DELETE FROM problem_topics WHERE problem_id = ANY($1::int[])', [problemIds]);
        await client.query('DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])', [problemIds]);
      }

      // 8. Delete contests
      if (contestIds.length > 0) {
        await client.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[])`, [contestIds]);
        const delCRes = await client.query('DELETE FROM contests WHERE id = ANY($1::int[])', [contestIds]);
        totalDeleted += delCRes.rowCount;
      }

      // 9. Delete problems
      if (problemIds.length > 0) {
        await client.query(`DELETE FROM audit_logs WHERE resource_type = 'problem' AND resource_id = ANY($1::int[])`, [problemIds]);
        const delPRes = await client.query('DELETE FROM problems WHERE id = ANY($1::int[])', [problemIds]);
        totalDeleted += delPRes.rowCount;
      }

      // 10. Delete user skills, skill history, saved problems, snapshots
      if (userIds.length > 0) {
        await client.query('DELETE FROM user_skill_history WHERE user_id = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM user_skills WHERE user_id = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM saved_problems WHERE user_id = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM leaderboard_snapshots WHERE user_id = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [userIds]);
        const delURes = await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
        totalDeleted += delURes.rowCount;
      }

      await client.query('COMMIT');

      // Audit Log
      if (AuditLogger && AuditLogger.logAction && (!skipAuditIfNoActor || actorId)) {
        await AuditLogger.logAction({
          actor: actorId ? { id: actorId, role: 'admin' } : { id: 3, role: 'super_admin' },
          action: 'TEST_DATA_DELETED',
          resourceType: 'test_run',
          resourceId: null,
          outcome: 'success',
          metadata: {
            testRunId: cleanRunId,
            deletedUsers: userIds.length,
            deletedContests: contestIds.length,
            deletedProblems: problemIds.length,
            totalRecordsRemoved: totalDeleted,
          },
        }).catch((e) => console.warn('[AUDIT LOG WARNING]:', e.message));
      }

      return {
        success: true,
        statusCode: 200,
        message: `Test run "${cleanRunId}" permanently purged (${totalDeleted} records removed across users, contests, problems, and submissions).`,
        deletedCounts: {
          users: userIds.length,
          contests: contestIds.length,
          problems: problemIds.length,
          totalRecords: totalDeleted,
        },
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE TEST RUN ERROR]:', err);
      return { success: false, statusCode: 500, message: `Failed to delete test run: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Helper to manually tag legacy test fixture records if needed
   */
  static async tagLegacyTestData() {
    const res = await query(`
      WITH tagged_users AS (
        UPDATE users 
        SET is_test_data = true, 
            test_run_id = COALESCE(substring(username from '\\d{10,13}'), 'legacy_test_run')
        WHERE is_test_data = false
          AND id NOT IN (2, 3, 3833, 4339)
          AND username NOT IN ('platform_admin', 'Ary', 'professor_seed', 'student_seed', 'admin')
          AND email NOT IN ('admin@securejudge.io', 'patelary9054@gmail.com', 'professor@university.edu', 'student@university.edu')
          AND (
            username ~ '_\\d{10,13}$' 
            OR username ~ '^[a-z]+_\\d{5,}$'
            OR username ~ '^test_' 
            OR username ~ '^prof_sec_' 
            OR username ~ '^student\\d*_' 
            OR username ~ '^stud_' 
            OR username ~ '^admin_' 
            OR username ~ '^super_' 
            OR username ~ '^cadmin_' 
            OR username ~ '^sadmin_' 
            OR username ~ '^p7582_' 
            OR username ~ '^p8_' 
            OR username ~ '^p9_' 
            OR username ~ '^ca_bulk_' 
            OR username ~ '^sa_bulk_' 
            OR email LIKE '%@test.com' 
            OR email LIKE '%@test.edu' 
            OR email LIKE '%@examforge.test'
          )
        RETURNING id
      ),
      tagged_contests AS (
        UPDATE contests
        SET is_test_data = true,
            test_run_id = COALESCE(substring(title from '\\d{10,13}'), 'legacy_test_run')
        WHERE is_test_data = false
          AND (
            title ~ '\\d{10,13}'
            OR title ILIKE '%Test Contest%'
            OR title ILIKE '%Phase 7.5.8%'
            OR title ILIKE '%Phase 5.8.2%'
            OR title ILIKE '%Skill Test Contest%'
            OR title ILIKE '%ACID Finalization%'
            OR title ILIKE '%Unrated Contest Audit%'
            OR title ILIKE '%Audit DB Contest%'
            OR created_by IN (SELECT id FROM users WHERE is_test_data = true)
          )
        RETURNING id
      ),
      tagged_problems AS (
        UPDATE problems
        SET is_test_data = true,
            test_run_id = COALESCE(substring(title from '\\d{10,13}'), 'legacy_test_run')
        WHERE is_test_data = false
          AND id != 1914
          AND title NOT ILIKE '%You are given a sorted array%'
          AND (
            title ~ '\\d{10,13}'
            OR title ILIKE '%Sec Problem%'
            OR title ILIKE '%Reg Prob%'
            OR title ILIKE '%Final Prob%'
            OR title ILIKE '%Problem Security%'
            OR title ILIKE '%Problem Export%'
            OR title ILIKE '%Anti-Hardcoding Problem%'
            OR title ILIKE '%Problem 57%'
            OR title ILIKE '%Problem 58%'
            OR title ILIKE '%Hard Problem 57%'
            OR title ILIKE '%Knapsack 57%'
            OR title ILIKE '%Two Sum 57%'
            OR title ILIKE '%Private Exam Problem Secret%'
            OR title ILIKE '%Public Algorithmic Challenge%'
            OR created_by IN (SELECT id FROM users WHERE is_test_data = true)
          )
        RETURNING id
      )
      SELECT
        (SELECT COUNT(*) FROM tagged_users) AS users_tagged,
        (SELECT COUNT(*) FROM tagged_contests) AS contests_tagged,
        (SELECT COUNT(*) FROM tagged_problems) AS problems_tagged
    `);

    // Tag submissions
    const subRes = await query(`
      UPDATE submissions
      SET is_test_data = true,
          test_run_id = 'legacy_test_run'
      WHERE is_test_data = false
        AND (
          user_id IN (SELECT id FROM users WHERE is_test_data = true)
          OR contest_id IN (SELECT id FROM contests WHERE is_test_data = true)
          OR problem_id IN (SELECT id FROM problems WHERE is_test_data = true)
        )
      RETURNING id
    `);

    const r = res.rows[0];
    return {
      usersTagged: parseInt(r.users_tagged, 10) || 0,
      contestsTagged: parseInt(r.contests_tagged, 10) || 0,
      problemsTagged: parseInt(r.problems_tagged, 10) || 0,
      submissionsTagged: subRes.rowCount || 0,
    };
  }
}

module.exports = TestDataService;
