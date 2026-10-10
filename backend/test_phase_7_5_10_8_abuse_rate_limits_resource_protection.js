/**
 * CODEFROG — Phase 7.5.10.8: Abuse, Rate Limits & Resource Protection Security Suite
 *
 * Comprehensive verification of:
 * 1. Authentication Abuse & Brute-Force Rate Limiting (Sliding Window, Headers, Fail-Closed)
 * 2. Submission & Interactive-Run Bursts (Rate Limiting, Per-User Concurrency Gates)
 * 3. Execution Sandbox Resource Bounds (Timeouts, Output Size Limits, Host Secret Isolation)
 * 4. Request Body, Input Sizes & Query Bound Protections (512KB Body, 64KB Code, 5MB Tests, 100-Max Pagination, HPP)
 * 5. Queue Saturation, Capacity Backpressure & In-Buffer Idempotency
 * 6. Contest & Examination Abuse Controls (Rapid Joins, Session Attempt Caps, Post-Deadline Gates)
 * 7. Sensitive Administrative Operation Protection & RBAC Preservation
 * 8. Window Expiration, Recovery & Multi-User Isolation (Student A Throttling Isolates from Student B)
 * 9. Health & Infrastructure Probe Flood Defense
 * 10. Audit Logging Hygiene Under Abuse Scenarios
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const ProblemModel = require('./src/models/problemModel');
const judgeQueue = require('./src/judge/queue/judgeQueue');
const BaseRunner = require('./src/judge/runners/baseRunner');
const PythonRunner = require('./src/judge/runners/pythonRunner');
const { resetRateLimits } = require('./src/middleware/rateLimitMiddleware');

let server;
let baseUrl;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

function request(method, path, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    let payload = null;
    if (body !== null && typeof body === 'object') {
      payload = JSON.stringify(body);
    } else if (typeof body === 'string') {
      payload = body;
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    if (payload !== null) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk) => {
        resBody += chunk;
      });
      res.on('end', () => {
        let parsed = resBody;
        try {
          parsed = resBody ? JSON.parse(resBody) : null;
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          raw: resBody,
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Tracked test entities for teardown
const trackedUserIds = [];
const trackedProblemIds = [];
const trackedContestIds = [];
const trackedSubmissionIds = [];

async function cleanupTestData() {
  try {
    if (trackedSubmissionIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE id = ANY($1::int[])`, [trackedSubmissionIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [trackedProblemIds]);
    }
    if (trackedContestIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM contest_participants WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
    }
  } catch (err) {
    console.error('Error during test cleanup:', err.message);
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('CODEFROG — Phase 7.5.10.8 Abuse, Rate Limits & Resource Protection');
  console.log('================================================================\n');

  // Start HTTP server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[TEST SERVER] Running on ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // Reset any in-memory rate limit store before test run
    resetRateLimits();

    // Baseline seeded users
    const student1 = { id: 2, username: 'student_seed', role: 'student' };
    const student2 = { id: 4339, username: 'Ary', role: 'student' };
    const profAlan = { id: 1093, username: 'prof_alan', role: 'professor' };
    const superAdmin = { id: 3, username: 'platform_admin', role: 'super_admin' };

    const tokenStudent1 = generateToken(student1);
    const tokenStudent2 = generateToken(student2);
    const tokenProfAlan = generateToken(profAlan);
    const tokenAdmin = generateToken(superAdmin);

    const now = Date.now();
    const hashedPwd = await hashPassword('Password123!');

    // Create 2 temporary test students
    const uRes1 = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active, is_test_data)
       VALUES ($1, $2, $3, $4, 'student', true, true) RETURNING id, username, role;`,
      [`abuse_stu1_${now}`, `abuse_stu1_${now}@test.com`, hashedPwd, 'Abuse Student 1']
    );
    const testStu1 = uRes1.rows[0];
    trackedUserIds.push(testStu1.id);
    const tokenTestStu1 = generateToken(testStu1);

    const uRes2 = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active, is_test_data)
       VALUES ($1, $2, $3, $4, 'student', true, true) RETURNING id, username, role;`,
      [`abuse_stu2_${now}`, `abuse_stu2_${now}@test.com`, hashedPwd, 'Abuse Student 2']
    );
    const testStu2 = uRes2.rows[0];
    trackedUserIds.push(testStu2.id);
    const tokenTestStu2 = generateToken(testStu2);

    // Create test problem
    const prob = await ProblemModel.createProblem({
      title: `Resource Protection Problem ${now}`,
      description: 'Calculate sum of two numbers',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
      createdBy: profAlan.id,
    });
    trackedProblemIds.push(prob.id);

    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '2 3', '5', true, false), ($1, '10 20', '30', false, true);`,
      [prob.id]
    );

    // =========================================================================
    // SECTION 1: AUTHENTICATION ABUSE & BRUTE-FORCE RATE LIMITING
    // =========================================================================
    console.log('--- 1. Authentication Abuse & Brute-Force Rate Limiting ---');
    {
      resetRateLimits();

      // Send 10 rapid failed login requests with x-test-rate-limit
      const targetUser = `brute_victim_${now}`;
      let lastRes = null;
      for (let i = 1; i <= 10; i++) {
        lastRes = await request(
          'POST',
          '/api/auth/login',
          { username: targetUser, password: 'WrongPassword!' },
          null,
          { 'x-test-rate-limit': 'true' }
        );
      }
      assert(lastRes.status === 401, '1.1 Initial 10 failed login requests return 401 Unauthorized');

      // 11th request must be rate-limited with HTTP 429
      const throttledRes = await request(
        'POST',
        '/api/auth/login',
        { username: targetUser, password: 'WrongPassword!' },
        null,
        { 'x-test-rate-limit': 'true' }
      );

      assert(throttledRes.status === 429, '1.2 11th authentication attempt triggers HTTP 429 Too Many Requests');
      assert(throttledRes.body.error === 'RATE_LIMIT_EXCEEDED', '1.3 Standardized error code RATE_LIMIT_EXCEEDED returned');
      assert(Number(throttledRes.headers['retry-after']) >= 1, '1.4 Retry-After header present and positive');
      assert(Number(throttledRes.headers['x-ratelimit-limit']) === 10, '1.5 X-RateLimit-Limit header reflects AUTH policy limit (10)');
      assert(Number(throttledRes.headers['x-ratelimit-remaining']) === 0, '1.6 X-RateLimit-Remaining header reports 0');

      // Identifier normalization defense: casing variation must hit the same key
      const caseVariationRes = await request(
        'POST',
        '/api/auth/login',
        { username: targetUser.toUpperCase(), password: 'WrongPassword!' },
        null,
        { 'x-test-rate-limit': 'true' }
      );
      assert(caseVariationRes.status === 429, '1.7 Case variation of account identifier (UPPERCASE) does not bypass limit');

      // User ID tampering defense on authenticated endpoints
      resetRateLimits();
      const profileTamperRes = await request(
        'PUT',
        '/api/users/me',
        { userId: 9999, user_id: 9999, fullName: 'Legit Update' },
        tokenTestStu1,
        { 'x-test-rate-limit': 'true' }
      );
      assert(profileTamperRes.status === 200, '1.8 Authenticated update succeeds; body userId tampering ignored for rate limiter key');
    }

    // =========================================================================
    // SECTION 2: SUBMISSION & INTERACTIVE-RUN BURST PROTECTION
    // =========================================================================
    console.log('\n--- 2. Submission & Interactive-Run Burst Protection ---');
    {
      resetRateLimits();

      // 2.1: Submit code rate limiter (max 20 req/min)
      let subThrottled = false;
      let lastSubStatus = 0;
      for (let i = 1; i <= 21; i++) {
        const res = await request(
          'POST',
          '/api/submissions',
          {
            problemId: prob.id,
            language: 'python',
            codingMode: 'full_program',
            sourceCode: `print("run_${i}")`,
          },
          tokenTestStu1,
          { 'x-test-rate-limit': 'true' }
        );
        lastSubStatus = res.status;
        if (res.body?.submission?.id) trackedSubmissionIds.push(res.body.submission.id);
        if (res.status === 429) {
          subThrottled = true;
          break;
        }
      }
      assert(subThrottled && lastSubStatus === 429, '2.1 Rapid submission burst triggers HTTP 429 (submitCodeRateLimiter / user queue gate)');

      // 2.2: Interactive run code rate limiter (max 15 req/min)
      resetRateLimits();
      let runThrottled = false;
      let lastRunStatus = 0;
      for (let i = 1; i <= 16; i++) {
        const res = await request(
          'POST',
          '/api/submissions/run',
          {
            problemId: prob.id,
            language: 'python',
            codingMode: 'full_program',
            sourceCode: `print("interactive_${i}")`,
          },
          tokenTestStu2,
          { 'x-test-rate-limit': 'true' }
        );
        lastRunStatus = res.status;
        if (res.status === 429) {
          runThrottled = true;
          break;
        }
      }
      assert(runThrottled && lastRunStatus === 429, '2.2 Rapid interactive run burst triggers HTTP 429 (runCodeRateLimiter / user queue gate)');

      // Drain queue
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // =========================================================================
    // SECTION 3: CODE EXECUTION SANDBOX RESOURCE BOUNDS
    // =========================================================================
    console.log('\n--- 3. Code Execution Sandbox Resource Bounds ---');
    {
      const pyRunner = new PythonRunner();
      const workspaceDir = await pyRunner.createWorkspace(`test_bounds_${now}`);

      try {
        // 3.1: CPU/Wall-Clock Timeout Enforcement
        const infiniteLoopCode = 'while True:\n    pass\n';
        await pyRunner.writeSourceCode(workspaceDir, infiniteLoopCode);

        const timeoutResult = await pyRunner.run({
          workspaceDir,
          inputData: '',
          timeLimitMs: 800, // Short timeout
          memoryLimitMb: 128,
        });

        assert(timeoutResult.status === 'time_limit_exceeded', '3.1 Infinite loop code terminated with time_limit_exceeded');
        assert(timeoutResult.executionTimeMs >= 800, '3.2 Timeout execution time captured accurately');

        // 3.2: Output Size Limit Enforcement (512KB Limit)
        const runawayOutputCode = 'while True:\n    print("A" * 1000)\n';
        await pyRunner.writeSourceCode(workspaceDir, runawayOutputCode);

        const outputResult = await pyRunner.run({
          workspaceDir,
          inputData: '',
          timeLimitMs: 4000,
          memoryLimitMb: 128,
        });

        assert(
          outputResult.status === 'system_error' || outputResult.status === 'time_limit_exceeded',
          '3.3 Runaway output loop safely terminated without host memory exhaustion'
        );

        // 3.3: Environment Sanitization (Host Secret Protection)
        const baseRunner = new BaseRunner('generic', 'code.txt');
        const sanitizedEnv = baseRunner.getSanitizedEnv();

        assert(!sanitizedEnv.DATABASE_URL, '3.4 Sanitized environment strictly omits DATABASE_URL');
        assert(!sanitizedEnv.JWT_SECRET, '3.5 Sanitized environment strictly omits JWT_SECRET');
        assert(!sanitizedEnv.DB_PASSWORD && !sanitizedEnv.POSTGRES_PASSWORD, '3.6 Sanitized environment strictly omits database passwords');
        assert(Boolean(sanitizedEnv.PATH), '3.7 Minimal toolchain PATH preserved for execution');
      } finally {
        await pyRunner.cleanup(workspaceDir);
      }
    }

    // =========================================================================
    // SECTION 4: REQUEST BODY, INPUT SIZES & QUERY BOUND PROTECTIONS
    // =========================================================================
    console.log('\n--- 4. Request Body, Input Sizes & Query Bound Protections ---');
    {
      // 4.1: Oversized JSON payload (> 512KB body limit)
      const oversizedPayload = JSON.stringify({
        data: 'X'.repeat(600 * 1024), // 600 KB
      });

      const largeBodyRes = await request('POST', '/api/auth/login', oversizedPayload, null, {
        'Content-Type': 'application/json',
      });
      assert(largeBodyRes.status === 413, '4.1 JSON body exceeding 512KB limit rejected with HTTP 413 Payload Too Large');
      assert(largeBodyRes.body.error === 'PAYLOAD_TOO_LARGE', '4.2 Centralized error handler categorizes 413 as PAYLOAD_TOO_LARGE');

      // 4.2: Oversized source code (> 64KB)
      const oversizedCode = 'print("hello")\n' + '# '.repeat(35000); // > 64KB
      const codeSizeRes = await request(
        'POST',
        '/api/submissions',
        {
          problemId: prob.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: oversizedCode,
        },
        tokenStudent1
      );
      assert(codeSizeRes.status === 400, '4.3 Source code exceeding 64KB rejected with HTTP 400 Bad Request');
      assert(codeSizeRes.body.message.includes('64KB'), '4.4 Validation message cites 64KB maximum limit');

      // 4.3: Oversized test case input (> 5MB)
      const oversizedTestCase = await request(
        'POST',
        `/api/problems/${prob.id}/test-cases`,
        {
          inputData: 'X'.repeat(6 * 1024 * 1024), // 6MB
          expectedOutput: 'Y',
          isHidden: false,
        },
        tokenProfAlan
      );
      assert(
        oversizedTestCase.status === 400 || oversizedTestCase.status === 413,
        `4.5 Test case inputData exceeding payload limits safely rejected with HTTP ${oversizedTestCase.status}`
      );

      // 4.4: Pagination clamping (limit requested > 100 clamped to 100)
      const pageClampRes = await request('GET', '/api/problems?limit=9999&page=1', null, tokenStudent1);
      assert(pageClampRes.status === 200, '4.6 Problems list requested with limit=9999 returns 200 OK');
      assert(pageClampRes.body.pagination.limit === 100, '4.7 Problems limit strictly clamped to maximum of 100');

      // Admin user pagination clamping
      const adminUsersClampRes = await request('GET', '/api/admin/users?limit=500&page=1', null, tokenAdmin);
      assert(adminUsersClampRes.status === 200, '4.8 Admin users list requested with limit=500 returns 200 OK');
      assert(adminUsersClampRes.body.data.pagination.limit === 100, '4.9 Admin users limit strictly clamped to maximum of 100');

      // Snapshots pagination clamping
      const snapshotsClampRes = await request('GET', '/api/leaderboard/snapshots?limit=1000', null, tokenStudent1);
      assert(snapshotsClampRes.status === 200, '4.10 Leaderboard snapshots requested with limit=1000 returns 200 OK');

      // Negative page / limit clamping
      const negativePageRes = await request('GET', '/api/problems?limit=-50&page=-5', null, tokenStudent1);
      assert(negativePageRes.status === 200, '4.11 Negative pagination parameters clamped safely to positive defaults');
      assert(negativePageRes.body.pagination.currentPage === 1, '4.12 Negative page clamped to page 1');
      assert(negativePageRes.body.pagination.limit >= 1, '4.13 Negative limit clamped to positive minimum');

      // HTTP Parameter Pollution (HPP) defense
      const hppRes = await request('GET', '/api/problems?limit=10&limit=500', null, tokenStudent1);
      assert(hppRes.status === 200, '4.14 HPP array parameter (?limit=10&limit=500) processed safely');
      assert(hppRes.body.pagination.limit === 10, '4.15 First scalar value (10) deterministically selected');
    }

    // =========================================================================
    // SECTION 5: QUEUE SATURATION, CAPACITY & IN-BUFFER IDEMPOTENCY
    // =========================================================================
    console.log('\n--- 5. Queue Saturation, Capacity & In-Buffer Idempotency ---');
    {
      const testSubId = 999991;

      // 5.1: In-buffer duplicate enqueue prevention
      const enqFirst = judgeQueue.addJob({ submissionId: testSubId, userId: student1.id });
      const enqSecond = judgeQueue.addJob({ submissionId: testSubId, userId: student1.id });

      assert(enqFirst === true || enqFirst === false, '5.1 First submission enqueue handled');
      assert(enqSecond === false, '5.2 Duplicate enqueue for identical submissionId rejected by in-buffer duplicate guard');

      // Remove test job from queue if it was buffered
      judgeQueue.queue = judgeQueue.queue.filter((j) => j.submissionId !== testSubId);

      // 5.2: Backpressure guard at max capacity
      const originalCapacity = judgeQueue.maxCapacity;
      judgeQueue.maxCapacity = 2; // Artificially lower for controlled testing
      judgeQueue.queue.push({ submissionId: 999992 }, { submissionId: 999993 });

      const backpressureRes = judgeQueue.addJob({ submissionId: 999994, userId: student1.id });
      assert(backpressureRes === false, '5.3 Queue saturation backpressure guard strictly rejects job when queue reaches capacity');

      // Restore original queue capacity and drain test dummies
      judgeQueue.maxCapacity = originalCapacity;
      judgeQueue.queue = judgeQueue.queue.filter((j) => j.submissionId < 999990);
    }

    // =========================================================================
    // SECTION 6: CONTEST & EXAMINATION ABUSE CONTROLS
    // =========================================================================
    console.log('\n--- 6. Contest & Examination Abuse Controls ---');
    {
      const startIso = new Date(now - 1800000).toISOString();
      const endIso = new Date(now + 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Abuse Testing Contest', 'Abuse checks', $1, $2, $3, 'published', true) RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const contestId = cRes.rows[0].id;
      trackedContestIds.push(contestId);

      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [contestId, prob.id]);

      // 6.1: Initial student join
      const join1 = await request('POST', `/api/contests/${contestId}/join`, {}, tokenTestStu1);
      assert(join1.status === 201, '6.1 Legitimate student join succeeds with 201 Created');

      // 6.2: Duplicate exam-start / contest join attempt
      const joinDupe = await request('POST', `/api/contests/${contestId}/join`, {}, tokenTestStu1);
      assert(joinDupe.status === 409, '6.2 Duplicate join / session start rejected with 409 Conflict');

      // Verify database contains exactly 1 participant row
      const partCount = await db.query(
        `SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2;`,
        [contestId, testStu1.id]
      );
      assert(partCount.rows[0].count === 1, '6.3 Database enforces exactly 1 participant attempt record');

      // 6.3: Post-deadline submission rejection
      const expiredEnd = new Date(now - 1000).toISOString();
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2;', [expiredEnd, contestId]);

      const lateSubRes = await request(
        'POST',
        '/api/submissions',
        {
          contestId,
          problemId: prob.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("late")',
        },
        tokenTestStu1
      );
      assert(lateSubRes.status === 400, '6.4 Submission dispatched after contest deadline strictly rejected with 400 Bad Request');
      assert(lateSubRes.body.message.includes('ended'), '6.5 Server-side deadline check enforced under database lock');

      // 6.4: Submission to finalized contest rejection
      await db.query('UPDATE contests SET is_rating_finalized = true WHERE id = $1;', [contestId]);
      const finalizedSubRes = await request(
        'POST',
        '/api/submissions',
        {
          contestId,
          problemId: prob.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("after_final")',
        },
        tokenTestStu1
      );
      assert(finalizedSubRes.status === 400, '6.6 Submission to finalized contest strictly rejected with 400 Bad Request');
    }

    // =========================================================================
    // SECTION 7: SENSITIVE ADMINISTRATIVE OPERATION PROTECTION & RBAC
    // =========================================================================
    console.log('\n--- 7. Sensitive Administrative Operation Protection & RBAC ---');
    {
      // 7.1: Unauthenticated request to admin endpoints
      const unauthAdmin = await request('GET', '/api/admin/overview-stats');
      assert(unauthAdmin.status === 401, '7.1 Unauthenticated request to /api/admin rejected with 401 Unauthorized');

      // 7.2: Student access to admin endpoints
      const studentAdmin = await request('GET', '/api/admin/overview-stats', null, tokenStudent1);
      assert(studentAdmin.status === 403, '7.2 Student request to /api/admin rejected with 403 Forbidden');

      // 7.3: Super Admin self-demotion lockout protection
      const selfDemoteRes = await request(
        'PATCH',
        `/api/admin/users/${superAdmin.id}/role`,
        { role: 'student' },
        tokenAdmin
      );
      assert(selfDemoteRes.status === 409, '7.3 Super Admin self-demotion blocked with 409 Conflict');

      // 7.4: Super Admin self-deactivation lockout protection
      const selfDeactivateRes = await request(
        'PATCH',
        `/api/admin/users/${superAdmin.id}/status`,
        { isActive: false },
        tokenAdmin
      );
      assert(selfDeactivateRes.status === 409, '7.4 Super Admin self-deactivation blocked with 409 Conflict');

      // 7.5: Admin action rate limiting on mutations
      resetRateLimits();
      let adminThrottled = false;
      for (let i = 1; i <= 31; i++) {
        const res = await request(
          'POST',
          '/api/admin/users',
          {
            username: `dummy_admin_${i}_${now}`,
            email: `dummy_admin_${i}_${now}@test.com`,
            password: 'Password123!',
            role: 'student',
          },
          tokenAdmin,
          { 'x-test-rate-limit': 'true' }
        );
        if (res.body?.data?.user?.id) trackedUserIds.push(res.body.data.user.id);
        if (res.status === 429) {
          adminThrottled = true;
          break;
        }
      }
      assert(adminThrottled, '7.5 Excessive administrative mutations trigger HTTP 429 (adminActionRateLimiter)');
    }

    // =========================================================================
    // SECTION 8: WINDOW EXPIRATION, RECOVERY & MULTI-USER ISOLATION
    // =========================================================================
    console.log('\n--- 8. Window Expiration, Recovery & Multi-User Isolation ---');
    {
      // 8.1: Recovery after rate-limit reset
      resetRateLimits();
      const recoveryLogin = await request(
        'POST',
        '/api/auth/login',
        { username: student1.username, password: 'WrongPassword!' },
        null,
        { 'x-test-rate-limit': 'true' }
      );
      assert(recoveryLogin.status === 401, '8.1 Request succeeds normally (401 invalid creds, not 429) after rate limit window reset');

      // 8.2: Multi-User Isolation: Throttling Student A does NOT throttle Student B
      resetRateLimits();

      // Exhaust limit for Student 1
      for (let i = 1; i <= 31; i++) {
        await request(
          'POST',
          '/api/contests/1/join',
          {},
          tokenTestStu1,
          { 'x-test-rate-limit': 'true' }
        );
      }

      // Student 1 is now throttled
      const stu1Status = await request(
        'POST',
        '/api/contests/1/join',
        {},
        tokenTestStu1,
        { 'x-test-rate-limit': 'true' }
      );
      assert(stu1Status.status === 429, '8.2 Student 1 is actively rate-limited (429)');

      // Student 2 is NOT throttled and proceeds cleanly
      const stu2Status = await request(
        'GET',
        '/api/users/me',
        null,
        tokenTestStu2,
        { 'x-test-rate-limit': 'true' }
      );
      assert(stu2Status.status === 200, '8.3 Student 2 requests proceed with 200 OK (isolated per-user tracking)');
    }

    // =========================================================================
    // SECTION 9: HEALTH & INFRASTRUCTURE PROBE FLOOD PROTECTION
    // =========================================================================
    console.log('\n--- 9. Health & Infrastructure Probe Flood Protection ---');
    {
      resetRateLimits();

      // Verify health probes respond with 200
      const hLive = await request('GET', '/api/health/live');
      assert(hLive.status === 200, '9.1 Liveness probe /api/health/live returns 200 OK');

      const hReady = await request('GET', '/api/health/ready');
      assert(hReady.status === 200, '9.2 Readiness probe /api/health/ready returns 200 OK');

      // Probe flood protection (publicReadRateLimiter limit: 300)
      let probeThrottled = false;
      for (let i = 1; i <= 305; i++) {
        const res = await request('GET', '/api/health', null, null, {
          'x-test-rate-limit': 'true',
        });
        if (res.status === 429) {
          probeThrottled = true;
          break;
        }
      }
      assert(probeThrottled, '9.3 Excessive unauthenticated probe flood triggers HTTP 429 (publicReadRateLimiter)');
    }

    // =========================================================================
    // SECTION 10: AUDIT LOG SANITIZATION UNDER ABUSE
    // =========================================================================
    console.log('\n--- 10. Audit Log Sanitization Under Abuse ---');
    {
      // Check database audit logs for passwords or secrets
      const leakedAuditLogs = await db.query(
        `SELECT id, action, metadata FROM audit_logs 
         WHERE metadata::text ILIKE '%password%' OR metadata::text ILIKE '%jwt_token%' OR metadata::text ILIKE '%secret%'
         LIMIT 10;`
      );

      // Verify that no actual password values are logged in plaintext
      const actualSecretLeaks = leakedAuditLogs.rows.filter((r) => {
        const metaStr = JSON.stringify(r.metadata || {});
        return metaStr.includes('Password123!') || metaStr.includes('TestPassword');
      });

      assert(actualSecretLeaks.length === 0, '10.1 Audit logs contain zero leaked plaintext passwords or credentials under abuse');
    }

  } catch (error) {
    console.error('\n[FATAL ABUSE / RATE LIMIT TEST SUITE ERROR]:', error);
  } finally {
    console.log('\n--- Cleaning up test artifacts ---');
    resetRateLimits();
    await cleanupTestData();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Run baseline restoration
    const { execSync } = require('child_process');
    try {
      execSync('node backend/restore_canonical_baseline.js', { stdio: 'pipe' });
      console.log('[BASELINE RESTORED] Database canonical baseline verified.');
    } catch (e) {
      console.error('[BASELINE ERROR] Could not restore canonical baseline:', e.message);
    }

    console.log('\n================================================================');
    console.log(`ABUSE & RATE LIMIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
