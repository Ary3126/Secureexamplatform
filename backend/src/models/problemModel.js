const db = require('../config/db');
const AuditLogger = require('../services/auditLogger');

/**
 * Problem Model - Encapsulates all database operations for problems
 */
class ProblemModel {
  /**
   * Create a new problem
   * @param {Object} problemData
   * @param {Object|null} client - Optional transaction client
   */
  static async createProblem({
    title,
    description,
    difficulty,
    codingMode = 'full_program',
    starterTemplates = {},
    harnessTemplates = {},
    functionConfig = {},
    allowedLanguages = ['python', 'cpp', 'java', 'javascript', 'c'],
    accessScope = 'contest_private',
    createdBy,
    isPublished = undefined,
  }, client = null) {
    const effectiveMode = (codingMode || 'full_program').toLowerCase();
    const effectiveScope = (accessScope || 'contest_private').toLowerCase();
    const isPub = isPublished !== undefined ? Boolean(isPublished) : (effectiveScope === 'public');
    const text = `
      INSERT INTO problems (
        title, description, difficulty, coding_mode, starter_templates, harness_templates, function_config, allowed_languages, access_scope, created_by, version, is_published, published_at, review_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, 'draft')
      RETURNING 
        id, 
        title, 
        description, 
        difficulty, 
        coding_mode,
        coding_mode AS "codingMode",
        starter_templates,
        starter_templates AS "starterTemplates",
        harness_templates,
        harness_templates AS "harnessTemplates",
        function_config,
        function_config AS "functionConfig",
        allowed_languages,
        allowed_languages AS "allowedLanguages",
        access_scope,
        access_scope AS "accessScope",
        version,
        is_published AS "isPublished",
        published_at AS "publishedAt",
        review_status AS "reviewStatus",
        approved_version AS "approvedVersion",
        approved_by AS "approvedBy",
        approved_at AS "approvedAt",
        created_by,
        created_by AS "createdBy", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      title.trim(),
      description.trim(),
      difficulty.toLowerCase(),
      effectiveMode,
      JSON.stringify(starterTemplates || {}),
      JSON.stringify(harnessTemplates || {}),
      JSON.stringify(functionConfig || {}),
      JSON.stringify(Array.isArray(allowedLanguages) && allowedLanguages.length > 0 ? allowedLanguages : ['python', 'cpp', 'java', 'javascript', 'c']),
      effectiveScope,
      createdBy,
      isPub,
      isPub ? new Date() : null,
    ];
    const res = await (client || db).query(text, values);
    return res.rows[0];
  }

  /**
   * Create a problem with atomic transaction and optional test cases + audit logging
   */
  static async createProblemWithSafety({
    title,
    description,
    difficulty,
    codingMode = 'full_program',
    starterTemplates = {},
    harnessTemplates = {},
    functionConfig = {},
    allowedLanguages = ['python', 'cpp', 'java', 'javascript', 'c'],
    accessScope = 'contest_private',
    createdBy,
    isPublished = undefined,
    testCases = [],
  }, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const problem = await ProblemModel.createProblem({
        title,
        description,
        difficulty,
        codingMode,
        starterTemplates,
        harnessTemplates,
        functionConfig,
        allowedLanguages,
        accessScope,
        createdBy,
        isPublished,
      }, client);

      if (Array.isArray(testCases) && testCases.length > 0) {
        for (let i = 0; i < testCases.length; i++) {
          const tc = testCases[i];
          await client.query(
            `INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, time_limit_ms, memory_limit_mb, test_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              problem.id,
              tc.inputData || '',
              tc.expectedOutput || '',
              tc.isHidden !== undefined ? tc.isHidden : true,
              tc.timeLimitMs || 2000,
              tc.memoryLimitMb || 256,
              tc.testOrder || (i + 1),
            ]
          );
        }
      }

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_CREATED',
          resourceType: 'problem',
          resourceId: problem.id,
          outcome: 'success',
          metadata: { difficulty: problem.difficulty, codingMode: problem.codingMode, accessScope: problem.accessScope },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return problem;
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
   * Check if a user is authorized to view or practice a problem
   * (Public problems: anyone; Contest-private: enrolled participants or creator or admins)
   */
  static async isUserAuthorizedForProblem(problem, user = null) {
    if (!problem) return false;

    const isPublished = problem.isPublished !== undefined
      ? problem.isPublished
      : (problem.is_published !== undefined ? problem.is_published : false);

    // Draft / unpublished protection: only super_admin, contest_admin, or creator can view unpublished drafts
    if (!isPublished) {
      if (!user) return false;
      if (user.role === 'super_admin' || user.role === 'contest_admin') return true;
      if (problem.createdBy === user.id || problem.created_by === user.id) return true;
      return false;
    }

    const scope = (problem.accessScope || problem.access_scope || 'public').toLowerCase();
    if (scope === 'public') return true;
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'contest_admin') return true;
    if (problem.createdBy === user.id || problem.created_by === user.id) return true;

    // Check if user is enrolled participant in a published contest containing this problem
    const text = `
      SELECT 1 
      FROM contest_problems cp
      JOIN contests c ON cp.contest_id = c.id
      LEFT JOIN contest_participants cpart ON c.id = cpart.contest_id AND cpart.user_id = $2
      WHERE cp.problem_id = $1
        AND (c.created_by = $2 OR (c.status = 'published' AND cpart.user_id = $2))
      LIMIT 1;
    `;
    const res = await db.query(text, [problem.id, user.id]);
    return (res.rowCount || 0) > 0;
  }

  /**
   * Find a problem by ID with user status and bookmark flag
   */
  static async findProblemById(id, userId = null) {
    const text = `
      SELECT 
        p.id, 
        p.title, 
        p.description, 
        p.difficulty, 
        p.coding_mode,
        p.coding_mode AS "codingMode",
        p.starter_templates,
        p.starter_templates AS "starterTemplates",
        p.harness_templates,
        p.harness_templates AS "harnessTemplates",
        p.function_config,
        p.function_config AS "functionConfig",
        p.allowed_languages,
        p.allowed_languages AS "allowedLanguages",
        p.access_scope,
        p.access_scope AS "accessScope",
        p.version,
        p.is_published AS "isPublished",
        p.published_at AS "publishedAt",
        p.review_status AS "reviewStatus",
        p.approved_version AS "approvedVersion",
        p.approved_by AS "approvedBy",
        p.approved_at AS "approvedAt",
        p.created_by,
        p.created_by AS "createdBy", 
        u.username AS "creatorUsername",
        u.full_name AS "creatorFullName",
        p.created_at AS "createdAt", 
        p.updated_at AS "updatedAt",
        COUNT(DISTINCT s.id)::int AS "totalSubmissions",
        COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END)::int AS "acceptedSubmissions",
        CASE 
          WHEN COUNT(DISTINCT s.id) > 0 THEN 
            ROUND((COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END)::numeric / COUNT(DISTINCT s.id)::numeric) * 100, 1)
          ELSE 0.0
        END AS "acceptanceRate",
        CASE 
          WHEN $2::int IS NOT NULL AND COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = $2 THEN s.id END) > 0 THEN 'solved'
          WHEN $2::int IS NOT NULL AND COUNT(DISTINCT CASE WHEN s.user_id = $2 THEN s.id END) > 0 THEN 'attempted'
          ELSE 'unsolved'
        END AS "userStatus",
        CASE 
          WHEN $2::int IS NOT NULL AND sp.user_id IS NOT NULL THEN true 
          ELSE false 
        END AS "isSaved"
      FROM problems p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN submissions s ON p.id = s.problem_id AND s.is_sample_run = false
      LEFT JOIN saved_problems sp ON p.id = sp.problem_id AND sp.user_id = $2
      WHERE p.id = $1
      GROUP BY p.id, u.username, u.full_name, sp.user_id;
    `;
    const res = await db.query(text, [id, userId]);
    return res.rows[0] || null;
  }

  /**
   * Advanced Problem Discovery & Explorer Query with Search, Filters, Sorting, and Pagination
   */
  static async findAllProblems({
    search,
    difficulty,
    codingMode,
    status,
    saved,
    sortBy = 'newest',
    limit = 20,
    offset = 0,
    userId = null,
    userRole = null,
    accessScope = null,
  } = {}) {
    const values = [];
    const conditions = [];

    // 0. Visibility Scoping (HackerRank-Style Public vs Contest-Private)
    if (!userRole || userRole === 'student') {
      // Normal students & unauthenticated visitors strictly see published public platform problems
      conditions.push(`p.access_scope = 'public' AND p.is_published = true`);
    } else if (userRole === 'professor') {
      // Professors see published public problems plus problems they created
      if (userId) {
        values.push(userId);
        conditions.push(`((p.access_scope = 'public' AND p.is_published = true) OR p.created_by = $${values.length})`);
      } else {
        conditions.push(`p.access_scope = 'public' AND p.is_published = true`);
      }
    } else if (userRole === 'super_admin' || userRole === 'contest_admin') {
      // Platform Admins can see all, or filter by requested scope if provided
      if (accessScope && accessScope.toLowerCase() !== 'all') {
        values.push(accessScope.toLowerCase());
        conditions.push(`p.access_scope = $${values.length}`);
      }
    }

    // 1. Search Query (matches title, description, or exact numeric ID)
    if (search && search.trim()) {
      const term = search.trim();
      if (!isNaN(term) && parseInt(term, 10) > 0) {
        values.push(parseInt(term, 10));
        values.push(`%${term}%`);
        conditions.push(`(p.id = $${values.length - 1} OR p.title ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
      } else {
        values.push(`%${term}%`);
        conditions.push(`(p.title ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
      }
    }

    // 2. Difficulty Filter
    if (difficulty && difficulty.toLowerCase() !== 'all') {
      values.push(difficulty.toLowerCase());
      conditions.push(`p.difficulty = $${values.length}`);
    }

    // 3. Coding Mode Filter
    if (codingMode && codingMode.toLowerCase() !== 'all') {
      values.push(codingMode.toLowerCase());
      conditions.push(`p.coding_mode = $${values.length}`);
    }

    // 4. Saved/Bookmarked Filter
    if (saved === true || saved === 'true') {
      if (userId) {
        values.push(userId);
        conditions.push(`EXISTS (SELECT 1 FROM saved_problems sp_f WHERE sp_f.problem_id = p.id AND sp_f.user_id = $${values.length})`);
      }
    }

    let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Group By & Having (For Status Filter: solved, attempted, unsolved)
    let havingClause = '';
    if (status && status.toLowerCase() !== 'all' && userId) {
      const st = status.toLowerCase();
      values.push(userId);
      const userParam = `$${values.length}`;

      if (st === 'solved') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) > 0`;
      } else if (st === 'attempted') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) = 0 AND COUNT(DISTINCT CASE WHEN s.user_id = ${userParam} THEN s.id END) > 0`;
      } else if (st === 'unsolved') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) = 0`;
      }
    }

    // Sorting Logic
    let orderClause = 'ORDER BY p.created_at DESC';
    switch (sortBy?.toLowerCase()) {
      case 'oldest':
        orderClause = 'ORDER BY p.created_at ASC';
        break;
      case 'difficulty_asc':
        orderClause = `ORDER BY CASE p.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 ELSE 4 END ASC, p.id ASC`;
        break;
      case 'difficulty_desc':
        orderClause = `ORDER BY CASE p.difficulty WHEN 'hard' THEN 1 WHEN 'medium' THEN 2 WHEN 'easy' THEN 3 ELSE 4 END ASC, p.id DESC`;
        break;
      case 'title_asc':
        orderClause = 'ORDER BY p.title ASC';
        break;
      case 'title_desc':
        orderClause = 'ORDER BY p.title DESC';
        break;
      case 'acceptance_rate':
        orderClause = 'ORDER BY "acceptanceRate" DESC NULLS LAST, "totalSubmissions" DESC';
        break;
      default:
        orderClause = 'ORDER BY p.id DESC';
        break;
    }

    // Main Query
    const userSelectParam = userId ? `$${values.length + 1}` : 'NULL::int';
    if (userId) values.push(userId);

    const limitParam = `$${values.length + 1}`;
    values.push(limit);

    const offsetParam = `$${values.length + 1}`;
    values.push(offset);

    const queryText = `
      SELECT 
        p.id, 
        p.title, 
        p.description, 
        p.difficulty, 
        p.coding_mode AS "codingMode",
        p.starter_templates AS "starterTemplates",
        p.harness_templates AS "harnessTemplates",
        p.function_config AS "functionConfig",
        p.allowed_languages AS "allowedLanguages",
        p.access_scope AS "accessScope",
        p.version,
        p.is_published AS "isPublished",
        p.published_at AS "publishedAt",
        p.review_status AS "reviewStatus",
        p.created_by AS "createdBy", 
        u.username AS "creatorUsername",
        p.created_at AS "createdAt", 
        p.updated_at AS "updatedAt",
        COUNT(DISTINCT s.id)::int AS "totalSubmissions",
        COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END)::int AS "acceptedSubmissions",
        CASE 
          WHEN COUNT(DISTINCT s.id) > 0 THEN 
            ROUND((COUNT(DISTINCT CASE WHEN s.status = 'accepted' THEN s.id END)::numeric / COUNT(DISTINCT s.id)::numeric) * 100, 1)
          ELSE 0.0
        END AS "acceptanceRate",
        CASE 
          WHEN ${userSelectParam} IS NOT NULL AND COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userSelectParam} THEN s.id END) > 0 THEN 'solved'
          WHEN ${userSelectParam} IS NOT NULL AND COUNT(DISTINCT CASE WHEN s.user_id = ${userSelectParam} THEN s.id END) > 0 THEN 'attempted'
          ELSE 'unsolved'
        END AS "userStatus",
        CASE 
          WHEN ${userSelectParam} IS NOT NULL AND sp.user_id IS NOT NULL THEN true 
          ELSE false 
        END AS "isSaved"
      FROM problems p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN submissions s ON p.id = s.problem_id AND s.is_sample_run = false
      LEFT JOIN saved_problems sp ON p.id = sp.problem_id AND sp.user_id = ${userSelectParam}
      ${whereClause}
      GROUP BY p.id, u.username, sp.user_id
      ${havingClause}
      ${orderClause}
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const res = await db.query(queryText, values);
    return res.rows;
  }

  /**
   * Count total problems matching filters for server-side pagination
   */
  static async countAllProblems({
    search,
    difficulty,
    codingMode,
    status,
    saved,
    userId = null,
    userRole = null,
    accessScope = null,
  } = {}) {
    const values = [];
    const conditions = [];

    // 0. Visibility Scoping (HackerRank-Style Public vs Contest-Private)
    if (!userRole || userRole === 'student') {
      conditions.push(`p.access_scope = 'public' AND p.is_published = true`);
    } else if (userRole === 'professor') {
      if (userId) {
        values.push(userId);
        conditions.push(`((p.access_scope = 'public' AND p.is_published = true) OR p.created_by = $${values.length})`);
      } else {
        conditions.push(`p.access_scope = 'public' AND p.is_published = true`);
      }
    } else if (userRole === 'super_admin' || userRole === 'contest_admin') {
      if (accessScope && accessScope.toLowerCase() !== 'all') {
        values.push(accessScope.toLowerCase());
        conditions.push(`p.access_scope = $${values.length}`);
      }
    }

    if (search && search.trim()) {
      const term = search.trim();
      if (!isNaN(term) && parseInt(term, 10) > 0) {
        values.push(parseInt(term, 10));
        values.push(`%${term}%`);
        conditions.push(`(p.id = $${values.length - 1} OR p.title ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
      } else {
        values.push(`%${term}%`);
        conditions.push(`(p.title ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
      }
    }

    if (difficulty && difficulty.toLowerCase() !== 'all') {
      values.push(difficulty.toLowerCase());
      conditions.push(`p.difficulty = $${values.length}`);
    }

    if (codingMode && codingMode.toLowerCase() !== 'all') {
      values.push(codingMode.toLowerCase());
      conditions.push(`p.coding_mode = $${values.length}`);
    }

    if (saved === true || saved === 'true') {
      if (userId) {
        values.push(userId);
        conditions.push(`EXISTS (SELECT 1 FROM saved_problems sp_f WHERE sp_f.problem_id = p.id AND sp_f.user_id = $${values.length})`);
      }
    }

    let whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    let havingClause = '';
    if (status && status.toLowerCase() !== 'all' && userId) {
      const st = status.toLowerCase();
      values.push(userId);
      const userParam = `$${values.length}`;

      if (st === 'solved') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) > 0`;
      } else if (st === 'attempted') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) = 0 AND COUNT(DISTINCT CASE WHEN s.user_id = ${userParam} THEN s.id END) > 0`;
      } else if (st === 'unsolved') {
        havingClause = `HAVING COUNT(DISTINCT CASE WHEN s.status = 'accepted' AND s.user_id = ${userParam} THEN s.id END) = 0`;
      }
    }

    const queryText = `
      SELECT COUNT(*) AS total FROM (
        SELECT p.id
        FROM problems p
        LEFT JOIN submissions s ON p.id = s.problem_id AND s.is_sample_run = false
        ${whereClause}
        GROUP BY p.id
        ${havingClause}
      ) AS filtered_problems;
    `;

    const res = await db.query(queryText, values);
    return parseInt(res.rows[0]?.total || 0, 10);
  }

  /**
   * Update problem details
   */
  static async updateProblem(id, {
    title,
    description,
    difficulty,
    codingMode,
    starterTemplates,
    harnessTemplates,
    functionConfig,
    allowedLanguages,
    accessScope,
  }, client = null) {
    const text = `
      UPDATE problems
      SET 
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        difficulty = COALESCE($3, difficulty),
        coding_mode = COALESCE($4, coding_mode),
        starter_templates = COALESCE($5, starter_templates),
        harness_templates = COALESCE($6, harness_templates),
        function_config = COALESCE($7, function_config),
        allowed_languages = COALESCE($8, allowed_languages),
        access_scope = COALESCE($9, access_scope),
        version = version + 1,
        is_published = false,
        review_status = 'draft',
        approved_version = NULL,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING 
        id, 
        title, 
        description, 
        difficulty, 
        coding_mode,
        coding_mode AS "codingMode",
        starter_templates,
        starter_templates AS "starterTemplates",
        harness_templates,
        harness_templates AS "harnessTemplates",
        function_config,
        function_config AS "functionConfig",
        allowed_languages,
        allowed_languages AS "allowedLanguages",
        access_scope,
        access_scope AS "accessScope",
        version,
        is_published AS "isPublished",
        published_at AS "publishedAt",
        review_status AS "reviewStatus",
        approved_version AS "approvedVersion",
        approved_by AS "approvedBy",
        approved_at AS "approvedAt",
        created_by,
        created_by AS "createdBy", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      title ? title.trim() : null,
      description ? description.trim() : null,
      difficulty ? difficulty.toLowerCase() : null,
      codingMode ? codingMode.toLowerCase() : null,
      starterTemplates ? JSON.stringify(starterTemplates) : null,
      harnessTemplates ? JSON.stringify(harnessTemplates) : null,
      functionConfig ? JSON.stringify(functionConfig) : null,
      allowedLanguages ? JSON.stringify(allowedLanguages) : null,
      accessScope ? accessScope.toLowerCase() : null,
      id,
    ];
    const res = await (client || db).query(text, values);
    return res.rows[0] || null;
  }

  /**
   * Update problem details inside an atomic transaction with row locking, optimistic concurrency, and audit logging.
   * Optionally replaces sample test cases if testCases array is provided (Edit Problem workflow).
   * Hidden/judge test cases are never modified by this method.
   */
  static async updateProblemWithSafety(id, updateData, actor = null, req = null, expectedVersion = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const probRes = await client.query('SELECT id, version, review_status FROM problems WHERE id = $1 FOR UPDATE', [id]);
      if (probRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }

      // Immutability check: cannot modify problem if it is attached to an actively running contest
      if (actor) {
        const runningContest = await client.query(`
          SELECT c.id, c.title
          FROM contest_problems cp
          JOIN contests c ON cp.contest_id = c.id
          WHERE cp.problem_id = $1
            AND c.status = 'published'
            AND CURRENT_TIMESTAMP >= c.start_time
            AND CURRENT_TIMESTAMP < c.end_time
          LIMIT 1;
        `, [id]);
        if (runningContest.rowCount > 0) {
          await client.query('ROLLBACK');
          return {
            locked: true,
            contestId: runningContest.rows[0].id,
            message: `Cannot modify problem while it is active in running contest "${runningContest.rows[0].title}" (#${runningContest.rows[0].id}). Problem configuration is locked during contest execution.`,
          };
        }
      }

      const currentVer = parseInt(probRes.rows[0].version, 10) || 1;
      if (expectedVersion !== undefined && expectedVersion !== null) {
        const expVer = parseInt(expectedVersion, 10);
        if (!isNaN(expVer) && currentVer !== expVer) {
          await client.query('ROLLBACK');
          return { conflict: true, currentVersion: currentVer };
        }
      }

      // Extract testCases from updateData before passing the rest to updateProblem
      const { testCases, ...problemFields } = updateData;

      const updatedProblem = await ProblemModel.updateProblem(id, problemFields, client);

      // Atomically replace sample test cases if provided in the update payload.
      // Only sample (non-hidden) test cases created via the editor are replaced.
      // Hidden judge test cases (is_hidden = true) are never touched.
      if (Array.isArray(testCases) && testCases.length > 0) {
        // Delete only the sample test cases (isSample=true, isHidden=false) for this problem
        await client.query(
          `DELETE FROM test_cases WHERE problem_id = $1 AND is_hidden = false`,
          [id]
        );

        // Insert new sample test cases
        for (let i = 0; i < testCases.length; i++) {
          const tc = testCases[i];
          await client.query(
            `INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, time_limit_ms, memory_limit_mb, test_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              tc.inputData || '',
              tc.expectedOutput || '',
              false, // always sample/non-hidden for editor-authored test cases
              tc.timeLimitMs || 2000,
              tc.memoryLimitMb || 256,
              tc.testOrder || (i + 1),
            ]
          );
        }
      }

      // Phase 5.9.6: Revoke/supersede open review requests on draft mutation
      await client.query(
        `UPDATE problem_reviews 
         SET status = 'revoked', updated_at = CURRENT_TIMESTAMP 
         WHERE problem_id = $1 AND status IN ('pending', 'in_review')`,
        [id]
      );

      if (actor && updatedProblem) {
        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_UPDATED',
          resourceType: 'problem',
          resourceId: updatedProblem.id,
          outcome: 'success',
          metadata: {
            difficulty: updatedProblem.difficulty,
            codingMode: updatedProblem.codingMode,
            accessScope: updatedProblem.accessScope,
            version: updatedProblem.version,
            reviewStatus: updatedProblem.reviewStatus,
            sampleTestCasesUpdated: Array.isArray(testCases) && testCases.length > 0,
          },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return updatedProblem;
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
   * Publish a problem with safety validation gate, version snapshotting, transaction atomicity, and audit logging
   */
  static async publishProblemWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock problem row
      const probRes = await client.query('SELECT * FROM problems WHERE id = $1 FOR UPDATE', [id]);
      if (probRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }
      const problem = probRes.rows[0];

      // 2. Fetch test cases under transaction
      const tcRes = await client.query(
        'SELECT * FROM test_cases WHERE problem_id = $1 ORDER BY test_order ASC, id ASC',
        [id]
      );
      const testCases = tcRes.rows;

      // 3. Fetch validation config under transaction
      const pvcRes = await client.query(
        'SELECT * FROM problem_validation_configs WHERE problem_id = $1',
        [id]
      );
      const validationConfig = pvcRes.rows[0] || null;

      // 4. Publish validation gate checks
      const validationErrors = [];
      if (!problem.title || !problem.title.trim()) {
        validationErrors.push('Problem title cannot be empty');
      }
      if (!problem.description || !problem.description.trim()) {
        validationErrors.push('Problem statement / description cannot be empty');
      }
      if (!['easy', 'medium', 'hard'].includes((problem.difficulty || '').toLowerCase())) {
        validationErrors.push('Problem must have a valid difficulty (easy, medium, or hard)');
      }
      if (!['full_program', 'function'].includes((problem.coding_mode || '').toLowerCase())) {
        validationErrors.push('Problem must have a valid coding mode (full_program or function)');
      }

      if (problem.coding_mode === 'function') {
        const fnConfig = problem.function_config || {};
        if (!fnConfig.functionName || !String(fnConfig.functionName).trim()) {
          validationErrors.push('Function-mode problems must configure a valid function name');
        }
        if (!fnConfig.returnType || !String(fnConfig.returnType).trim()) {
          validationErrors.push('Function-mode problems must configure a return type');
        }

        const starters = problem.starter_templates || {};
        const harnesses = problem.harness_templates || {};
        const supportedLangs = ['python', 'cpp', 'java', 'javascript'];
        const hasAnyStarter = supportedLangs.some(lang => starters[lang] && starters[lang].trim());
        const hasAnyHarness = supportedLangs.some(lang => harnesses[lang] && harnesses[lang].trim());
        if (!hasAnyStarter) {
          validationErrors.push('Function-mode problems must provide starter templates for at least one supported language');
        }
        if (!hasAnyHarness) {
          validationErrors.push('Function-mode problems must provide harness templates for at least one supported language');
        }
      }

      if (testCases.length === 0) {
        validationErrors.push('Problem must have at least one test case before publication');
      } else {
        const hasSample = testCases.some(tc => !tc.is_hidden || tc.is_sample);
        if (!hasSample) {
          validationErrors.push('Problem must have at least one visible sample test case');
        }
        for (let i = 0; i < testCases.length; i++) {
          const tc = testCases[i];
          if (tc.input_data === undefined || tc.input_data === null || tc.expected_output === undefined || tc.expected_output === null) {
            validationErrors.push(`Test case #${i + 1} is missing input or expected output`);
          }
        }
      }

      // 4b. Phase 5.9.6 Review Approval Gate Check
      const currentVersion = parseInt(problem.version, 10) || 1;
      const isAdmin = actor && (actor.role === 'super_admin' || actor.role === 'contest_admin');
      const isApproved = (problem.review_status === 'approved' && parseInt(problem.approved_version, 10) === currentVersion) || isAdmin;
      if (!isApproved) {
        if (problem.review_status !== 'approved') {
          validationErrors.push(`Problem publication requires an approved review (current status: ${problem.review_status || 'draft'})`);
        } else if (parseInt(problem.approved_version, 10) !== currentVersion) {
          validationErrors.push(`Approved review is for version ${problem.approved_version}, but current problem is version ${currentVersion}. Please resubmit for review.`);
        }
      }

      if (validationErrors.length > 0) {
        await client.query('ROLLBACK');
        return { validationFailed: true, errors: validationErrors };
      }

      // 5. Increment version and set published
      const updateRes = await client.query(
        `UPDATE problems 
         SET is_published = true, published_at = CURRENT_TIMESTAMP, review_status = 'published', access_scope = 'public', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING 
           id, title, description, difficulty, 
           coding_mode AS "codingMode", 
           starter_templates AS "starterTemplates", 
           harness_templates AS "harnessTemplates", 
           function_config,
           function_config AS "functionConfig",
           allowed_languages,
           allowed_languages AS "allowedLanguages",
           access_scope AS "accessScope", 
           version, is_published AS "isPublished", published_at AS "publishedAt",
           review_status AS "reviewStatus", approved_version AS "approvedVersion",
           approved_by AS "approvedBy", approved_at AS "approvedAt",
           created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id]
      );
      const updatedProblem = updateRes.rows[0];

      // 6. Create immutable problem version snapshot
      const testCasesSnapshot = testCases.map(tc => ({
        id: tc.id,
        inputData: tc.input_data,
        expectedOutput: tc.expected_output,
        isHidden: tc.is_hidden,
        isSample: tc.is_sample,
        timeLimitMs: tc.time_limit_ms,
        memoryLimitMb: tc.memory_limit_mb,
        testOrder: tc.test_order,
      }));

      const validationConfigSnapshot = validationConfig ? {
        validationEnabled: validationConfig.validation_enabled,
        randomEnabled: validationConfig.random_enabled,
        randomTestCount: validationConfig.random_test_count,
        edgeEnabled: validationConfig.edge_enabled,
        boundaryEnabled: validationConfig.boundary_enabled,
        generatorType: validationConfig.generator_type,
        generatorConfig: validationConfig.generator_config,
        referenceSolution: validationConfig.reference_solution,
        validationMetadata: validationConfig.validation_metadata,
      } : null;

      await client.query(
        `INSERT INTO problem_versions (
           problem_id, version_number, title, description, difficulty, coding_mode,
           starter_templates, harness_templates, function_config, allowed_languages, access_scope, test_cases_snapshot,
           validation_config_snapshot, change_summary, source_action, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'published', $15)
         ON CONFLICT (problem_id, version_number) DO UPDATE
         SET 
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           difficulty = EXCLUDED.difficulty,
           coding_mode = EXCLUDED.coding_mode,
           starter_templates = EXCLUDED.starter_templates,
           harness_templates = EXCLUDED.harness_templates,
           function_config = EXCLUDED.function_config,
           allowed_languages = EXCLUDED.allowed_languages,
           access_scope = EXCLUDED.access_scope,
           test_cases_snapshot = EXCLUDED.test_cases_snapshot,
           validation_config_snapshot = EXCLUDED.validation_config_snapshot,
           change_summary = EXCLUDED.change_summary,
           source_action = EXCLUDED.source_action,
           created_at = CURRENT_TIMESTAMP`,
        [
          id,
          currentVersion,
          problem.title,
          problem.description,
          problem.difficulty,
          problem.coding_mode,
          JSON.stringify(problem.starter_templates || {}),
          JSON.stringify(problem.harness_templates || {}),
          JSON.stringify(problem.function_config || {}),
          JSON.stringify(problem.allowed_languages || ['python', 'cpp', 'java', 'javascript', 'c']),
          'public',
          JSON.stringify(testCasesSnapshot),
          JSON.stringify(validationConfigSnapshot || {}),
          `Published version ${currentVersion}`,
          actor ? actor.id : null,
        ]
      );

      // 7. Persistent audit logs
      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_PUBLISHED',
          resourceType: 'problem',
          resourceId: id,
          outcome: 'success',
          metadata: { version: currentVersion, testCasesCount: testCases.length },
          client,
          req,
        });

        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_VERSION_CREATED',
          resourceType: 'problem',
          resourceId: id,
          outcome: 'success',
          metadata: { version: currentVersion },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, problem: updatedProblem, version: currentVersion };
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
   * Clone a problem into a new independent draft with copied test cases & validation configs
   */
  static async cloneProblemWithSafety(sourceProblemId, { title = null, accessScope = 'contest_private' } = {}, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const sourceRes = await client.query('SELECT * FROM problems WHERE id = $1', [sourceProblemId]);
      if (sourceRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { notFound: true };
      }
      const src = sourceRes.rows[0];

      const clonedTitle = title && title.trim() ? title.trim() : `Copy of ${src.title}`;
      const effectiveScope = (accessScope && accessScope.toLowerCase() === 'public' && (actor?.role === 'super_admin' || actor?.role === 'contest_admin'))
        ? 'public'
        : 'contest_private';

      // 1. Create cloned problem entity
      const newProbRes = await client.query(
        `INSERT INTO problems (
           title, description, difficulty, coding_mode, starter_templates, harness_templates, function_config, allowed_languages, access_scope, created_by, version, is_published, published_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, false, null)
         RETURNING 
           id, title, description, difficulty, 
           coding_mode AS "codingMode", 
           starter_templates AS "starterTemplates", 
           harness_templates AS "harnessTemplates", 
           function_config,
           function_config AS "functionConfig",
           allowed_languages,
           allowed_languages AS "allowedLanguages",
           access_scope AS "accessScope", 
           version, is_published AS "isPublished", published_at AS "publishedAt",
           review_status AS "reviewStatus", approved_version AS "approvedVersion",
           approved_by AS "approvedBy", approved_at AS "approvedAt",
           created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          clonedTitle,
          src.description,
          src.difficulty,
          src.coding_mode,
          JSON.stringify(src.starter_templates || {}),
          JSON.stringify(src.harness_templates || {}),
          JSON.stringify(src.function_config || {}),
          JSON.stringify(src.allowed_languages || ['python', 'cpp', 'java', 'javascript', 'c']),
          effectiveScope,
          actor ? actor.id : src.created_by,
        ]
      );
      const clonedProblem = newProbRes.rows[0];

      // 2. Clone test cases
      const tcRes = await client.query('SELECT * FROM test_cases WHERE problem_id = $1 ORDER BY test_order ASC, id ASC', [sourceProblemId]);
      for (const tc of tcRes.rows) {
        await client.query(
          `INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, is_sample, time_limit_ms, memory_limit_mb, test_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            clonedProblem.id,
            tc.input_data,
            tc.expected_output,
            tc.is_hidden,
            tc.is_sample,
            tc.time_limit_ms || 2000,
            tc.memory_limit_mb || 256,
            tc.test_order || 1,
          ]
        );
      }

      // 3. Clone validation config if exists
      const pvcRes = await client.query('SELECT * FROM problem_validation_configs WHERE problem_id = $1', [sourceProblemId]);
      if (pvcRes.rowCount > 0) {
        const pvc = pvcRes.rows[0];
        await client.query(
          `INSERT INTO problem_validation_configs (
             problem_id, validation_enabled, random_enabled, random_test_count, edge_enabled, boundary_enabled,
             generator_type, generator_config, reference_solution, validation_metadata
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (problem_id) DO NOTHING`,
          [
            clonedProblem.id,
            pvc.validation_enabled,
            pvc.random_enabled,
            pvc.random_test_count,
            pvc.edge_enabled,
            pvc.boundary_enabled,
            pvc.generator_type,
            JSON.stringify(pvc.generator_config || {}),
            JSON.stringify(pvc.reference_solution || {}),
            JSON.stringify(pvc.validation_metadata || {}),
          ]
        );
      }

      // 4. Record audit log
      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_CLONED',
          resourceType: 'problem',
          resourceId: clonedProblem.id,
          outcome: 'success',
          metadata: { sourceProblemId: parseInt(sourceProblemId, 10), clonedProblemId: clonedProblem.id, clonedTitle: clonedProblem.title },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return { success: true, problem: clonedProblem };
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
   * List all immutable revision records for a problem
   */
  static async findProblemVersions(problemId, client = null) {
    const text = `
      SELECT 
        pv.id,
        pv.problem_id AS "problemId",
        pv.version_number AS "versionNumber",
        pv.title,
        pv.difficulty,
        pv.coding_mode AS "codingMode",
        pv.access_scope AS "accessScope",
        jsonb_array_length(pv.test_cases_snapshot)::int AS "testCasesCount",
        pv.change_summary AS "changeSummary",
        pv.source_action AS "sourceAction",
        pv.created_by AS "createdBy",
        u.username AS "creatorUsername",
        pv.created_at AS "createdAt"
      FROM problem_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.problem_id = $1
      ORDER BY pv.version_number DESC;
    `;
    const res = await (client || db).query(text, [problemId]);
    return res.rows;
  }

  /**
   * Get specific version snapshot details including immutable test cases snapshot
   */
  static async findProblemVersionByNumber(problemId, versionNumber, client = null) {
    const text = `
      SELECT 
        pv.id,
        pv.problem_id AS "problemId",
        pv.version_number AS "versionNumber",
        pv.title,
        pv.description,
        pv.difficulty,
        pv.coding_mode AS "codingMode",
        pv.starter_templates AS "starterTemplates",
        pv.harness_templates AS "harnessTemplates",
        pv.function_config AS "functionConfig",
        pv.allowed_languages AS "allowedLanguages",
        pv.access_scope AS "accessScope",
        pv.test_cases_snapshot AS "testCasesSnapshot",
        pv.validation_config_snapshot AS "validationConfigSnapshot",
        pv.change_summary AS "changeSummary",
        pv.source_action AS "sourceAction",
        pv.created_by AS "createdBy",
        u.username AS "creatorUsername",
        pv.created_at AS "createdAt"
      FROM problem_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.problem_id = $1 AND pv.version_number = $2;
    `;
    const res = await (client || db).query(text, [problemId, versionNumber]);
    return res.rows[0] || null;
  }

  /**
   * Check if a problem has any historical submissions
   * Uses an efficient indexed SELECT EXISTS query
   * @param {number|string} problemId
   * @param {Object|null} client
   * @returns {Promise<boolean>}
   */
  static async hasSubmissions(problemId, client = null) {
    const text = `
      SELECT EXISTS (
        SELECT 1
        FROM submissions
        WHERE problem_id = $1
      ) AS has_submissions;
    `;
    const res = await (client || db).query(text, [problemId]);
    return Boolean(res.rows[0]?.has_submissions);
  }

  /**
   * Safely delete a problem with atomic transaction, row-level locking, and audit logging
   * Prevents race condition where concurrent submission is created during deletion
   * @param {number|string} id
   * @param {Object|null} actor
   * @param {import('express').Request|null} req
   * @returns {Promise<{success: boolean, hasSubmissions?: boolean, notFound?: boolean}>}
   */
  static async deleteProblemWithSafety(id, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock the problem row for update so concurrent submission creation cannot proceed
      const probRes = await client.query(
        'SELECT id FROM problems WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (probRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true };
      }

      // Check if problem is attached to an actively running contest
      if (actor) {
        const runningContest = await client.query(`
          SELECT c.id, c.title
          FROM contest_problems cp
          JOIN contests c ON cp.contest_id = c.id
          WHERE cp.problem_id = $1
            AND c.status = 'published'
            AND CURRENT_TIMESTAMP >= c.start_time
            AND CURRENT_TIMESTAMP < c.end_time
          LIMIT 1;
        `, [id]);
        if (runningContest.rowCount > 0) {
          await client.query('ROLLBACK');
          return {
            success: false,
            locked: true,
            contestId: runningContest.rows[0].id,
            message: `Cannot delete problem while it is active in running contest "${runningContest.rows[0].title}" (#${runningContest.rows[0].id}).`,
          };
        }
      }

      // 2. Authoritative check under row lock
      const subRes = await client.query(
        'SELECT EXISTS (SELECT 1 FROM submissions WHERE problem_id = $1) AS has_submissions',
        [id]
      );

      if (subRes.rows[0]?.has_submissions) {
        await client.query('ROLLBACK');
        return { success: false, hasSubmissions: true };
      }

      // 3. Safe deletion of related test_cases and validation configs
      await client.query('DELETE FROM test_cases WHERE problem_id = $1', [id]);
      await client.query('DELETE FROM problem_validation_configs WHERE problem_id = $1', [id]);
      await client.query('DELETE FROM saved_problems WHERE problem_id = $1', [id]);
      await client.query('DELETE FROM problems WHERE id = $1', [id]);

      // 4. Record audit log on the same transaction client before COMMIT
      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'PROBLEM_DELETED',
          resourceType: 'problem',
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
   * Delete a problem (delegates to deleteProblemWithSafety)
   */
  static async deleteProblem(id) {
    const result = await ProblemModel.deleteProblemWithSafety(id);
    return result.success;
  }
}

module.exports = ProblemModel;