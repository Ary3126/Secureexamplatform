const db = require('../config/db');

class SubmissionModel {
  static async createSubmission({
    userId,
    contestId,
    problemId,
    language,
    codingMode = 'full_program',
    sourceCode,
    status = 'queued',
    score = 0,
    executionTime = null,
    memoryUsed = null,
    testCasesPassed = 0,
    testCasesTotal = 0,
    isSampleRun = false,
  }, client = null) {
    const text = `
      INSERT INTO submissions (
        user_id,
        contest_id,
        problem_id,
        language,
        coding_mode,
        source_code,
        status,
        score,
        execution_time,
        memory_used,
        test_cases_passed,
        test_cases_total,
        is_sample_run
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING 
        id, 
        user_id AS "userId", 
        contest_id AS "contestId", 
        problem_id AS "problemId", 
        language, 
        coding_mode AS "codingMode", 
        source_code AS "sourceCode", 
        status, 
        score, 
        execution_time AS "executionTime", 
        memory_used AS "memoryUsed", 
        error_message AS "errorMessage", 
        is_sample_run AS "isSampleRun", 
        test_cases_passed AS "testCasesPassed", 
        test_cases_total AS "testCasesTotal", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      userId,
      contestId,
      problemId,
      language,
      codingMode,
      sourceCode,
      status,
      score,
      executionTime,
      memoryUsed,
      testCasesPassed,
      testCasesTotal,
      isSampleRun,
    ];
    const res = await (client || db).query(text, values);
    return res.rows[0];
  }

  static async findSubmissionById(id, client = null) {
    const text = `
      SELECT 
        s.id,
        s.user_id AS "userId",
        s.contest_id AS "contestId",
        s.problem_id AS "problemId",
        s.language,
        s.coding_mode AS "codingMode",
        s.source_code AS "sourceCode",
        s.status,
        s.score,
        s.execution_time AS "executionTime",
        s.memory_used AS "memoryUsed",
        s.error_message AS "errorMessage",
        s.is_sample_run AS "isSampleRun",
        s.test_cases_passed AS "testCasesPassed",
        s.test_cases_total AS "testCasesTotal",
        s.validation_summary AS "validationSummary",
        s.created_at AS "createdAt",
        s.updated_at AS "updatedAt",
        u.username,
        u.full_name AS "userFullName",
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        p.created_by AS "problemCreatorId",
        c.title AS "contestTitle",
        c.created_by AS "contestCreatorId"
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      JOIN problems p ON s.problem_id = p.id
      LEFT JOIN contests c ON s.contest_id = c.id
      WHERE s.id = $1;
    `;
    const res = await (client || db).query(text, [id]);
    return res.rows[0] || null;
  }

  static async updateSubmission(id, {
    status,
    score,
    executionTime,
    memoryUsed,
    errorMessage,
    testCasesPassed,
    testCasesTotal,
    validationSummary,
  }, client = null) {
    const text = `
      UPDATE submissions
      SET 
        status = COALESCE($1, status),
        score = COALESCE($2, score),
        execution_time = COALESCE($3, execution_time),
        memory_used = COALESCE($4, memory_used),
        error_message = $5,
        test_cases_passed = COALESCE($6, test_cases_passed),
        test_cases_total = COALESCE($7, test_cases_total),
        validation_summary = COALESCE($8, validation_summary),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING 
        id, 
        user_id AS "userId", 
        contest_id AS "contestId", 
        problem_id AS "problemId", 
        language, 
        coding_mode AS "codingMode", 
        status, 
        score, 
        execution_time AS "executionTime", 
        memory_used AS "memoryUsed", 
        error_message AS "errorMessage", 
        is_sample_run AS "isSampleRun", 
        test_cases_passed AS "testCasesPassed", 
        test_cases_total AS "testCasesTotal", 
        validation_summary AS "validationSummary",
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [
      status,
      score !== undefined ? score : null,
      executionTime !== undefined ? executionTime : null,
      memoryUsed !== undefined ? memoryUsed : null,
      errorMessage !== undefined ? errorMessage : null,
      testCasesPassed !== undefined ? testCasesPassed : null,
      testCasesTotal !== undefined ? testCasesTotal : null,
      validationSummary !== undefined ? JSON.stringify(validationSummary) : null,
      id,
    ];
    const res = await (client || db).query(text, values);
    return res.rows[0] || null;
  }

  static async findSubmissionsByUser(userId, {
    search,
    verdict,
    language,
    contestId,
    problemId,
    timeRange = 'all',
    sortBy = 'newest',
    limit = 20,
    offset = 0,
  } = {}) {
    let whereClauses = ['s.user_id = $1', 's.is_sample_run = false'];
    let values = [userId];
    let paramIndex = 2;

    if (search && search.trim()) {
      whereClauses.push(`(p.title ILIKE $${paramIndex} OR CAST(s.id AS TEXT) ILIKE $${paramIndex})`);
      values.push(`%${search.trim()}%`);
      paramIndex++;
    }

    if (verdict && verdict.trim() && verdict.toLowerCase() !== 'all') {
      whereClauses.push(`s.status = $${paramIndex}`);
      values.push(verdict.trim().toLowerCase());
      paramIndex++;
    }

    if (language && language.trim() && language.toLowerCase() !== 'all') {
      whereClauses.push(`LOWER(s.language) = LOWER($${paramIndex})`);
      values.push(language.trim().toLowerCase());
      paramIndex++;
    }

    if (contestId) {
      if (contestId === 'practice') {
        whereClauses.push('s.contest_id IS NULL');
      } else {
        whereClauses.push(`s.contest_id = $${paramIndex}`);
        values.push(parseInt(contestId, 10));
        paramIndex++;
      }
    }

    if (problemId) {
      whereClauses.push(`s.problem_id = $${paramIndex}`);
      values.push(parseInt(problemId, 10));
      paramIndex++;
    }

    if (timeRange && timeRange !== 'all') {
      if (timeRange === 'today') {
        whereClauses.push("s.created_at >= CURRENT_DATE");
      } else if (timeRange === 'week') {
        whereClauses.push("s.created_at >= CURRENT_DATE - INTERVAL '7 days'");
      } else if (timeRange === 'month') {
        whereClauses.push("s.created_at >= CURRENT_DATE - INTERVAL '30 days'");
      }
    }

    let orderBy = 's.created_at DESC';
    if (sortBy === 'oldest') {
      orderBy = 's.created_at ASC';
    } else if (sortBy === 'runtime_asc') {
      orderBy = 's.execution_time ASC NULLS LAST';
    } else if (sortBy === 'memory_asc') {
      orderBy = 's.memory_used ASC NULLS LAST';
    } else if (sortBy === 'score_desc') {
      orderBy = 's.score DESC, s.created_at DESC';
    }

    values.push(limit);
    const limitParam = `$${paramIndex++}`;
    values.push(offset);
    const offsetParam = `$${paramIndex++}`;

    const text = `
      SELECT 
        s.id,
        s.user_id AS "userId",
        s.contest_id AS "contestId",
        s.problem_id AS "problemId",
        s.language,
        s.coding_mode AS "codingMode",
        s.status,
        s.score,
        s.execution_time AS "executionTime",
        s.memory_used AS "memoryUsed",
        s.test_cases_passed AS "testCasesPassed",
        s.test_cases_total AS "testCasesTotal",
        s.created_at AS "createdAt",
        p.title AS "problemTitle",
        p.difficulty AS "problemDifficulty",
        c.title AS "contestTitle"
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      LEFT JOIN contests c ON s.contest_id = c.id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam};
    `;

    const res = await db.query(text, values);
    return res.rows;
  }

  static async countSubmissionsByUser(userId, {
    search,
    verdict,
    language,
    contestId,
    problemId,
    timeRange = 'all',
  } = {}) {
    let whereClauses = ['s.user_id = $1', 's.is_sample_run = false'];
    let values = [userId];
    let paramIndex = 2;

    if (search && search.trim()) {
      whereClauses.push(`(p.title ILIKE $${paramIndex} OR CAST(s.id AS TEXT) ILIKE $${paramIndex})`);
      values.push(`%${search.trim()}%`);
      paramIndex++;
    }

    if (verdict && verdict.trim() && verdict.toLowerCase() !== 'all') {
      whereClauses.push(`s.status = $${paramIndex}`);
      values.push(verdict.trim().toLowerCase());
      paramIndex++;
    }

    if (language && language.trim() && language.toLowerCase() !== 'all') {
      whereClauses.push(`LOWER(s.language) = LOWER($${paramIndex})`);
      values.push(language.trim().toLowerCase());
      paramIndex++;
    }

    if (contestId) {
      if (contestId === 'practice') {
        whereClauses.push('s.contest_id IS NULL');
      } else {
        whereClauses.push(`s.contest_id = $${paramIndex}`);
        values.push(parseInt(contestId, 10));
        paramIndex++;
      }
    }

    if (problemId) {
      whereClauses.push(`s.problem_id = $${paramIndex}`);
      values.push(parseInt(problemId, 10));
      paramIndex++;
    }

    if (timeRange && timeRange !== 'all') {
      if (timeRange === 'today') {
        whereClauses.push("s.created_at >= CURRENT_DATE");
      } else if (timeRange === 'week') {
        whereClauses.push("s.created_at >= CURRENT_DATE - INTERVAL '7 days'");
      } else if (timeRange === 'month') {
        whereClauses.push("s.created_at >= CURRENT_DATE - INTERVAL '30 days'");
      }
    }

    const text = `
      SELECT COUNT(*)::INTEGER AS total
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      LEFT JOIN contests c ON s.contest_id = c.id
      WHERE ${whereClauses.join(' AND ')};
    `;

    const res = await db.query(text, values);
    return res.rows[0]?.total || 0;
  }

  static async getUserSubmissionStreak(userId) {
    const text = `
      SELECT DISTINCT DATE(created_at AT TIME ZONE 'UTC') AS submission_date
      FROM submissions
      WHERE user_id = $1 AND is_sample_run = false
      ORDER BY submission_date DESC;
    `;
    const res = await db.query(text, [userId]);
    const dates = res.rows.map((r) => new Date(r.submission_date).toISOString().split('T')[0]);

    if (dates.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    let isCurrentActive = dates[0] === todayStr || dates[0] === yesterdayStr;

    for (let i = 0; i < dates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diffDays = Math.round((prev - curr) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          tempStreak++;
        } else {
          if (tempStreak > longestStreak) longestStreak = tempStreak;
          tempStreak = 1;
        }
      }
    }

    if (tempStreak > longestStreak) longestStreak = tempStreak;

    if (isCurrentActive) {
      currentStreak = 1;
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diffDays = Math.round((prev - curr) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
    };
  }

  static async getUserAnalytics(userId) {
    const totalSubmissionsText = `
      SELECT 
        COUNT(*)::INTEGER AS total_submissions,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END)::INTEGER AS accepted_submissions,
        COUNT(CASE WHEN status = 'wrong_answer' THEN 1 END)::INTEGER AS wa_submissions,
        COUNT(CASE WHEN status = 'time_limit_exceeded' THEN 1 END)::INTEGER AS tle_submissions,
        COUNT(CASE WHEN status = 'memory_limit_exceeded' THEN 1 END)::INTEGER AS mle_submissions,
        COUNT(CASE WHEN status = 'compilation_error' THEN 1 END)::INTEGER AS ce_submissions,
        COUNT(CASE WHEN status = 'runtime_error' THEN 1 END)::INTEGER AS re_submissions,
        COUNT(DISTINCT problem_id)::INTEGER AS attempted_problems,
        COUNT(DISTINCT CASE WHEN status = 'accepted' THEN problem_id END)::INTEGER AS solved_problems
      FROM submissions
      WHERE user_id = $1 AND is_sample_run = false;
    `;
    const totalsRes = await db.query(totalSubmissionsText, [userId]);
    const t = totalsRes.rows[0] || {};

    const difficultyText = `
      SELECT 
        p.difficulty,
        COUNT(DISTINCT p.id)::INTEGER AS solved_count
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      WHERE s.user_id = $1 AND s.status = 'accepted' AND s.is_sample_run = false
      GROUP BY p.difficulty;
    `;
    const diffRes = await db.query(difficultyText, [userId]);
    const difficultyMap = { easy: 0, medium: 0, hard: 0 };
    diffRes.rows.forEach((r) => {
      const d = (r.difficulty || 'easy').toLowerCase();
      if (difficultyMap[d] !== undefined) difficultyMap[d] = Number(r.solved_count);
    });

    const langText = `
      SELECT 
        LOWER(language) AS language,
        COUNT(*)::INTEGER AS count
      FROM submissions
      WHERE user_id = $1 AND is_sample_run = false
      GROUP BY LOWER(language)
      ORDER BY count DESC;
    `;
    const langRes = await db.query(langText, [userId]);

    const streak = await this.getUserSubmissionStreak(userId);

    const totalSubs = Number(t.total_submissions || 0);
    const acceptedSubs = Number(t.accepted_submissions || 0);
    const accuracyRate = totalSubs > 0 ? Math.round((acceptedSubs / totalSubs) * 1000) / 10 : 0;

    return {
      totalSubmissions: totalSubs,
      acceptedSubmissions: acceptedSubs,
      solvedProblems: Number(t.solved_problems || 0),
      attemptedProblems: Number(t.attempted_problems || 0),
      accuracyRate,
      streak,
      verdictCounts: {
        accepted: acceptedSubs,
        wrongAnswer: Number(t.wa_submissions || 0),
        timeLimitExceeded: Number(t.tle_submissions || 0),
        memoryLimitExceeded: Number(t.mle_submissions || 0),
        compilationError: Number(t.ce_submissions || 0),
        runtimeError: Number(t.re_submissions || 0),
      },
      difficultyBreakdown: difficultyMap,
      languageDistribution: langRes.rows.map((r) => ({
        language: r.language,
        count: Number(r.count),
      })),
    };
  }

  static async getUserTopicConstellations(userId) {
    const TOPIC_DEFINITIONS = [
      { id: 'arrays', name: 'Arrays & Hashing', keywords: ['array', 'hash', 'map', 'set', 'two sum', 'duplicate', 'matrix'] },
      { id: 'strings', name: 'Strings & Parsing', keywords: ['string', 'palindrome', 'anagram', 'parentheses', 'roman', 'substring', 'prefix'] },
      { id: 'algorithms', name: 'Searching & Sorting', keywords: ['sort', 'binary search', 'search', 'merge', 'quick', 'median', 'kth'] },
      { id: 'dynamic_programming', name: 'Dynamic Programming', keywords: ['dynamic', 'dp', 'knapsack', 'fibonacci', 'subsequence', 'climbing', 'coin'] },
      { id: 'trees_graphs', name: 'Trees & Graphs', keywords: ['tree', 'graph', 'dfs', 'bfs', 'trie', 'node', 'path', 'cycle', 'island'] },
      { id: 'math', name: 'Math & Number Theory', keywords: ['math', 'prime', 'gcd', 'lcm', 'factorial', 'geometry', 'bitwise', 'power'] },
    ];

    const solvedText = `
      SELECT DISTINCT p.id, p.title, p.description
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      WHERE s.user_id = $1 AND s.status = 'accepted' AND s.is_sample_run = false;
    `;
    const solvedRes = await db.query(solvedText, [userId]);
    const solvedProblems = solvedRes.rows;

    const topicCounts = {};
    TOPIC_DEFINITIONS.forEach((t) => {
      topicCounts[t.id] = { count: 0 };
    });

    for (const prob of solvedProblems) {
      const combined = `${prob.title || ''} ${prob.description || ''}`.toLowerCase();
      let matchedAny = false;

      for (const topic of TOPIC_DEFINITIONS) {
        const matches = topic.keywords.some((k) => combined.includes(k));
        if (matches ) {
          topicCounts[topic.id].count += 1;
          matchedAny = true;
        }
      }

      if (!matchedAny) {
        topicCounts['math'].count += 1;
      }
    }

    const totalSolved = solvedProblems.length;
    return TOPIC_DEFINITIONS.map((t) => {
      const count = topicCounts[t.id].count;
      const percentage = totalSolved > 0 ? Math.min(100, Math.round((count / totalSolved) * 100)) : 0;
      return {
        id: t.id,
        name: t.name,
        count,
        percentage,
        active: count > 0,
      };
    });
  }


  static async countSolvedProblemsByUser(userId) {
    const text = `
      SELECT COUNT(DISTINCT problem_id)::INTEGER AS count
      FROM submissions
      WHERE user_id = $1 AND status = 'accepted' AND is_sample_run = false;
    `;
    const res = await db.query(text, [userId]);
    return res.rows[0]?.count || 0;
  }

  static async countTotalSubmissionsByUser(userId) {
    const text = `
      SELECT COUNT(*)::INTEGER AS count
      FROM submissions
      WHERE user_id = $1 AND is_sample_run = false;
    `;
    const res = await db.query(text, [userId]);
    return res.rows[0]?.count || 0;
  }

  static async findLatestAttemptedProblem(userId) {
    const text = `
      SELECT 
        p.id, 
        p.title, 
        p.difficulty, 
        s.status, 
        s.created_at AS "attemptedAt"
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      WHERE s.user_id = $1 AND s.is_sample_run = false
      ORDER BY s.created_at DESC
      LIMIT 1;
    `;
    const res = await db.query(text, [userId]);
    return res.rows[0] || null;
  }

  static async getStudentAnalytics(userId, options = {}) {
    const raw = await this.getUserAnalytics(userId);
    const timeRange = options.timeRange || 'all';

    const activityQuery = `
      SELECT 
        DATE(created_at) AS date,
        COUNT(*)::INTEGER AS count,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END)::INTEGER AS accepted
      FROM submissions
      WHERE user_id = $1 AND is_sample_run = false
      GROUP BY DATE(created_at)
      ORDER BY date ASC;
    `;
    const activityRes = await db.query(activityQuery, [userId]);

    return {
      summary: {
        totalSubmissions: raw.totalSubmissions,
        acceptedSubmissions: raw.acceptedSubmissions,
        acceptanceRate: raw.accuracyRate,
        uniqueProblemsSolved: raw.solvedProblems,
        attemptedProblems: raw.attemptedProblems,
        currentStreak: raw.streak?.currentStreak || 0,
        maxStreak: raw.streak?.maxStreak || 0,
      },
      verdictDistribution: {
        accepted: raw.verdictCounts?.accepted || 0,
        wrong_answer: raw.verdictCounts?.wrongAnswer || 0,
        time_limit_exceeded: raw.verdictCounts?.timeLimitExceeded || 0,
        memory_limit_exceeded: raw.verdictCounts?.memoryLimitExceeded || 0,
        compilation_error: raw.verdictCounts?.compilationError || 0,
        runtime_error: raw.verdictCounts?.runtimeError || 0,
      },
      languageDistribution: raw.languageDistribution || [],
      difficultyBreakdown: raw.difficultyBreakdown || { easy: 0, medium: 0, hard: 0 },
      difficultyDistribution: raw.difficultyBreakdown || { easy: 0, medium: 0, hard: 0 },
      activityTimeline: activityRes.rows || [],
      timeRange,
      ...raw,
    };
  }

  static async getSolvedProblemTopics(userId) {
    return this.getUserTopicConstellations(userId);
  }

  static async findSubmissionsForExport(userId) {
    const text = `
      SELECT 
        s.id,
        s.problem_id AS "problemId",
        p.title AS "problemTitle",
        p.difficulty,
        p.coding_mode AS "codingMode",
        s.language,
        s.status AS verdict,
        s.score,
        s.execution_time AS "executionTimeMs",
        s.memory_used AS "memoryUsedKb",
        s.created_at AS "submittedAt",
        s.created_at AS "createdAt",
        s.source_code AS "sourceCode",
        c.title AS "contestTitle"
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      LEFT JOIN contests c ON s.contest_id = c.id
      WHERE s.user_id = $1 AND s.is_sample_run = false
      ORDER BY s.created_at DESC;
    `;
    const res = await db.query(text, [userId]);
    return res.rows;
  }

  static async getProblemPerformanceStats(problemId, language, contestId = undefined) {
    let contestFilter = '';
    const params = [problemId, language];

    if (contestId !== undefined) {
      if (contestId === null || contestId === 'practice') {
        contestFilter = ' AND contest_id IS NULL';
      } else {
        params.push(Number(contestId));
        contestFilter = ` AND contest_id = $${params.length}`;
      }
    }

    const text = `
      SELECT 
        COUNT(*)::INTEGER AS sample_count,
        MIN(execution_time)::INTEGER AS min_runtime,
        MAX(execution_time)::INTEGER AS max_runtime,
        ROUND(AVG(execution_time)::NUMERIC, 2)::FLOAT AS avg_runtime,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY execution_time)::FLOAT AS median_runtime,
        MIN(memory_used)::INTEGER AS min_memory,
        MAX(memory_used)::INTEGER AS max_memory,
        ROUND(AVG(memory_used)::NUMERIC, 2)::FLOAT AS avg_memory,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY memory_used)::FLOAT AS median_memory
      FROM submissions
      WHERE problem_id = $1 
        AND LOWER(language) = LOWER($2)
        AND status = 'accepted' 
        AND is_sample_run = false
        AND execution_time IS NOT NULL 
        AND memory_used IS NOT NULL${contestFilter};
    `;
    const res = await db.query(text, params);
    return res.rows[0] || null;
  }

  static async getSubmissionPercentileCounts(problemId, language, executionTime, memoryUsed, contestId = undefined) {
    const params = [
      problemId,
      language,
      executionTime !== null && executionTime !== undefined ? Number(executionTime) : -1,
      memoryUsed !== null && memoryUsed !== undefined ? Number(memoryUsed) : -1,
    ];

    let contestFilter = '';
    if (contestId !== undefined) {
      if (contestId === null || contestId === 'practice') {
        contestFilter = ' AND contest_id IS NULL';
      } else {
        params.push(Number(contestId));
        contestFilter = ` AND contest_id = $${params.length}`;
      }
    }

    const text = `
      SELECT 
        COUNT(*)::INTEGER AS total_count,
        COUNT(*) FILTER (WHERE execution_time > $3)::INTEGER AS slower_runtime_count,
        COUNT(*) FILTER (WHERE execution_time = $3)::INTEGER AS equal_runtime_count,
        COUNT(*) FILTER (WHERE execution_time < $3)::INTEGER AS faster_runtime_count,
        COUNT(*) FILTER (WHERE memory_used > $4)::INTEGER AS higher_memory_count,
        COUNT(*) FILTER (WHERE memory_used = $4)::INTEGER AS equal_memory_count,
        COUNT(*) FILTER (WHERE memory_used < $4)::INTEGER AS lower_memory_count
      FROM submissions
      WHERE problem_id = $1 
        AND LOWER(language) = LOWER($2)
        AND status = 'accepted' 
        AND is_sample_run = false
        AND execution_time IS NOT NULL 
        AND memory_used IS NOT NULL${contestFilter};
    `;
    const res = await db.query(text, params);
    return res.rows[0] || null;
  }

  static async getDistributionBucketCounts(problemId, language, runtimeBuckets = [], memoryBuckets = [], contestId = undefined) {
    const params = [problemId, language];
    const selectClauses = [];

    runtimeBuckets.forEach((b, idx) => {
      params.push(b.min);
      const minParam = `$${params.length}`;
      params.push(b.max);
      const maxParam = `$${params.length}`;
      selectClauses.push(`COUNT(*) FILTER (WHERE execution_time >= ${minParam} AND execution_time <= ${maxParam})::INTEGER AS r_b${idx}`);
    });

    memoryBuckets.forEach((b, idx) => {
      params.push(b.min);
      const minParam = `$${params.length}`;
      params.push(b.max);
      const maxParam = `$${params.length}`;
      selectClauses.push(`COUNT(*) FILTER (WHERE memory_used >= ${minParam} AND memory_used <= ${maxParam})::INTEGER AS m_b${idx}`);
    });

    if (selectClauses.length === 0) {
      return {};
    }

    let contestFilter = '';
    if (contestId !== undefined) {
      if (contestId === null || contestId === 'practice') {
        contestFilter = ' AND contest_id IS NULL';
      } else {
        params.push(Number(contestId));
        contestFilter = ` AND contest_id = $${params.length}`;
      }
    }

    const text = `
      SELECT 
        COUNT(*)::INTEGER AS total_count,
        ${selectClauses.join(',\n        ')}
      FROM submissions
      WHERE problem_id = $1 
        AND LOWER(language) = LOWER($2)
        AND status = 'accepted' 
        AND is_sample_run = false
        AND execution_time IS NOT NULL 
        AND memory_used IS NOT NULL${contestFilter};
    `;

    const res = await db.query(text, params);
    return res.rows[0] || {};
  }

  /**
   * Phase 5.8.5: Find user's submissions for a specific problem
   */
  static async findUserSubmissionsForProblem(userId, problemId, limit = 20) {
    const text = `
      SELECT 
        s.id,
        s.user_id AS "userId",
        s.problem_id AS "problemId",
        s.contest_id AS "contestId",
        s.language,
        s.coding_mode AS "codingMode",
        s.status,
        s.score,
        s.execution_time AS "executionTime",
        s.memory_used AS "memoryUsed",
        s.test_cases_passed AS "testCasesPassed",
        s.test_cases_total AS "testCasesTotal",
        s.created_at AS "createdAt"
      FROM submissions s
      WHERE s.user_id = $1 
        AND s.problem_id = $2 
        AND s.is_sample_run = false
      ORDER BY s.created_at DESC
      LIMIT $3;
    `;
    const res = await db.query(text, [userId, problemId, limit]);
    return res.rows;
  }
}

module.exports = SubmissionModel;
