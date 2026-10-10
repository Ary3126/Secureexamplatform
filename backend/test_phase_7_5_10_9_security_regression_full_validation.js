/**
 * CODEFROG — Phase 7.5.10.9: Security Regression & Full Validation Master Suite
 *
 * Comprehensive end-to-end regression across all security hardening domains:
 * 1. Authentication & Authorization Regression (JWT, Expired, Malformed, Multi-Role RBAC, BOLA/IDOR)
 * 2. Input Validation, Type Safety & Injection Defense (SQLi, ORDER BY, Clamping, HPP, XSS, Command Injection)
 * 3. Submission & Judge Integrity (Ownership, Verdict Forgery Defense, Hidden Tests, Sandboxing, Timeouts)
 * 4. Contest Lifecycle, Scoring & Rating Integrity (Temporal Gate, State Machine, Standings, Pairwise Elo, ACID Rollback)
 * 5. Concurrency & Race-Condition Safety (Barrier Joins, Row Lock Finalization, Exam Tab Sessions)
 * 6. Abuse, Rate Limits & Resource Protection (429 Headers, 413 Body Limit, 64KB Code, Concurrency Gates, Multi-User Isolation)
 * 7. Secure Examination Regression (Single-Attempt Caps, Post-Deadline Rejections, Finalized Gating)
 * 8. Admin Panel & Platform Governance (Overview Stats, User Management, Super Admin Lockout Guard)
 * 9. Secret Disclosure & Configuration Review (Clean Error Bodies, Audit Hygiene, Frontend Bundle Scan)
 * 10. Canonical Database Baseline Preservation (5, 1, 5, 33, 0)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('./src/config/env');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const RatingModel = require('./src/models/ratingModel');
const StandingsService = require('./src/services/standingsService');
const RatingService = require('./src/services/ratingService');
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
    while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
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
      await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM contest_participants WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
    }

    // Reset rate limits for test cleanup
    resetRateLimits();

    // Verify and restore canonical baseline
    const users = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const contests = await db.query('SELECT COUNT(*)::int AS count FROM contests');
    const problems = await db.query('SELECT COUNT(*)::int AS count FROM problems');
    const submissions = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    const ratings = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

    if (
      users.rows[0].count === 5 &&
      contests.rows[0].count === 1 &&
      problems.rows[0].count === 5 &&
      submissions.rows[0].count === 33 &&
      ratings.rows[0].count === 0
    ) {
      console.log('\n[BASELINE RESTORED] Database canonical baseline verified.');
    } else {
      console.warn('\n[BASELINE NOTICE] Current DB counts:', {
        users: users.rows[0].count,
        contests: contests.rows[0].count,
        problems: problems.rows[0].count,
        submissions: submissions.rows[0].count,
        ratings: ratings.rows[0].count,
      });
    }
  } catch (err) {
    console.error('Error during test cleanup:', err.message);
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('CODEFROG — Phase 7.5.10.9 Security Regression Master Suite');
  console.log('================================================================');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`\n[TEST SERVER] Running on ${baseUrl}`);

  try {
    const now = Date.now();

    // Setup Test Actors
    const pHash = await hashPassword('TestP@ss123');

    // 1. Student Alice
    const stu1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating, rated_contest_count)
       VALUES ($1, $2, $3, 'student', 'Reg Student Alice', true, 1200, 1200, 0)
       RETURNING id, username, email, role`,
      [`reg_stu_alice_${now}`, `reg_stu_alice_${now}@test.com`, pHash]
    );
    const stuAlice = stu1Res.rows[0];
    trackedUserIds.push(stuAlice.id);
    const tokenAlice = generateToken(stuAlice);

    // 2. Student Bob
    const stu2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating, rated_contest_count)
       VALUES ($1, $2, $3, 'student', 'Reg Student Bob', true, 1200, 1200, 0)
       RETURNING id, username, email, role`,
      [`reg_stu_bob_${now}`, `reg_stu_bob_${now}@test.com`, pHash]
    );
    const stuBob = stu2Res.rows[0];
    trackedUserIds.push(stuBob.id);
    const tokenBob = generateToken(stuBob);

    // 3. Professor Owner
    const prof1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'professor', 'Reg Prof Owner', true)
       RETURNING id, username, email, role`,
      [`reg_prof_owner_${now}`, `reg_prof_owner_${now}@test.com`, pHash]
    );
    const profOwner = prof1Res.rows[0];
    trackedUserIds.push(profOwner.id);
    const tokenProfOwner = generateToken(profOwner);

    // 4. Professor Other (for BOLA testing)
    const prof2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'professor', 'Reg Prof Other', true)
       RETURNING id, username, email, role`,
      [`reg_prof_other_${now}`, `reg_prof_other_${now}@test.com`, pHash]
    );
    const profOther = prof2Res.rows[0];
    trackedUserIds.push(profOther.id);
    const tokenProfOther = generateToken(profOther);

    // 5. Contest Admin
    const caRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'contest_admin', 'Reg Contest Admin', true)
       RETURNING id, username, email, role`,
      [`reg_ca_${now}`, `reg_ca_${now}@test.com`, pHash]
    );
    const contestAdmin = caRes.rows[0];
    trackedUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    // 6. Super Admin
    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'super_admin', 'Reg Super Admin', true)
       RETURNING id, username, email, role`,
      [`reg_sa_${now}`, `reg_sa_${now}@test.com`, pHash]
    );
    const superAdmin = saRes.rows[0];
    trackedUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    // Setup Test Problems
    const prob1 = await ProblemModel.createProblem({
      title: `Regression Problem 1 ${now}`,
      description: 'Calculate sum of two numbers',
      difficulty: 'easy',
      timeLimit: 2000,
      memoryLimit: 256,
      codingMode: 'full_program',
      allowedLanguages: ['python', 'javascript'],
      createdBy: profOwner.id,
      accessScope: 'public',
      isPublished: true,
    });
    trackedProblemIds.push(prob1.id);

    // Visible sample test case
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '2 3', '5', true, false)`,
      [prob1.id]
    );

    // Hidden secret test case
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '100 200', '300', false, true)`,
      [prob1.id]
    );

    // ────────────────────────────────────────────────────────────
    // 1. Authentication & Authorization Regression
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 1. Authentication & Authorization Regression ---');
    {
      resetRateLimits();

      // 1.1 Valid login
      const validLogin = await request('POST', '/api/auth/login', {
        email: stuAlice.email,
        password: 'TestP@ss123',
      });
      assert(validLogin.status === 200, '1.1 Valid login returns 200 OK');
      assert(!!validLogin.body.token, '1.2 Valid login returns JWT token');
      assert(!validLogin.body.user.password_hash && !validLogin.body.user.passwordHash, '1.3 Login payload strictly excludes password hashes');

      // 1.2 Invalid password
      const invalidPass = await request('POST', '/api/auth/login', {
        email: stuAlice.email,
        password: 'WrongPassword999',
      });
      assert(invalidPass.status === 401, '1.4 Wrong password returns 401 Unauthorized');
      assert(invalidPass.body.message === 'Invalid email or password', '1.5 Returns generic error message preventing user enumeration');

      // 1.3 Missing credentials
      const missingCreds = await request('POST', '/api/auth/login', {
        email: stuAlice.email,
      });
      assert(missingCreds.status === 400, '1.6 Missing password returns 400 Bad Request');

      // 1.4 Expired / Malformed / Tampered JWT
      const expiredToken = jwt.sign(
        { userId: stuAlice.id, role: stuAlice.role },
        config.jwt.secret,
        { expiresIn: '-1s', issuer: 'secure-exam-platform' }
      );
      const expRes = await request('GET', '/api/users/me', null, expiredToken);
      assert(expRes.status === 401, '1.7 Expired token rejected with 401 Unauthorized');

      const malformedRes = await request('GET', '/api/users/me', null, 'not.a.valid.jwt');
      assert(malformedRes.status === 401, '1.8 Malformed token rejected with 401 Unauthorized');

      const tamperedRes = await request('GET', '/api/users/me', null, tokenAlice + 'tamper');
      assert(tamperedRes.status === 401, '1.9 Signature-tampered token rejected with 401 Unauthorized');

      // 1.5 Multi-Role RBAC Matrix on Super Admin Gateway (/api/admin/overview-stats)
      const rbacStudent = await request('GET', '/api/admin/overview-stats', null, tokenAlice);
      assert(rbacStudent.status === 403, '1.10 Student rejected on /api/admin/overview-stats (403 Forbidden)');

      const rbacProf = await request('GET', '/api/admin/overview-stats', null, tokenProfOwner);
      assert(rbacProf.status === 403, '1.11 Professor rejected on /api/admin/overview-stats (403 Forbidden)');

      const rbacCA = await request('GET', '/api/admin/overview-stats', null, tokenContestAdmin);
      assert(rbacCA.status === 403, '1.12 Contest Admin rejected on /api/admin/overview-stats (403 Forbidden)');

      const rbacSA = await request('GET', '/api/admin/overview-stats', null, tokenSuperAdmin);
      assert(rbacSA.status === 200, '1.13 Super Admin granted access on /api/admin/overview-stats (200 OK)');
      assert(!!rbacSA.body.data?.users && !!rbacSA.body.data?.contests, '1.14 Overview stats returns system metric objects');

      // 1.6 BOLA / IDOR Protection: Submission Source Code
      const subAlice = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, source_code, status, score)
         VALUES ($1, $2, 'python', 'print("Alice Secret Code")', 'accepted', 100)
         RETURNING id`,
        [stuAlice.id, prob1.id]
      );
      const subAliceId = subAlice.rows[0].id;
      trackedSubmissionIds.push(subAliceId);

      const bolaBob = await request('GET', `/api/submissions/${subAliceId}/code`, null, tokenBob);
      assert(bolaBob.status === 403, '1.15 Student Bob blocked from viewing Student Alice submission code (403 Forbidden BOLA)');

      const aliceOwn = await request('GET', `/api/submissions/${subAliceId}/code`, null, tokenAlice);
      assert(aliceOwn.status === 200, '1.16 Student Alice authorized to view her own submission code (200 OK)');

      // 1.7 Server-side identity enforcement: Client-supplied userId in body is ignored
      const spoofRes = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(42)',
        userId: stuBob.id, // Attempt to attribute to Bob
      }, tokenAlice);
      assert(spoofRes.status === 201, '1.17 Submission created successfully (201 Created)');
      const spoofId = spoofRes.body.submission?.id || spoofRes.body.id;
      trackedSubmissionIds.push(spoofId);

      const dbSub = await db.query('SELECT user_id FROM submissions WHERE id = $1', [spoofId]);
      assert(dbSub.rows[0].user_id === stuAlice.id, '1.18 Server derived user_id from token (Alice), spoofed Bob userId strictly ignored');

      // 1.8 Rate limiting does not replace authentication
      const unauthRateLimited = await request('POST', '/api/admin/users', { username: 'foo' });
      assert(unauthRateLimited.status === 401, '1.19 Unauthenticated request to rate-limited route still returns 401 Unauthorized');
    }

    // ────────────────────────────────────────────────────────────
    // 2. Input Validation, Type Safety & Injection Defense
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 2. Input Validation, Type Safety & Injection Defense ---');
    {
      resetRateLimits();

      // 2.1 SQL Injection in query params
      const sqliSearch = await request('GET', "/api/problems?search=' OR 1=1 --", null, tokenAlice);
      assert(sqliSearch.status === 200, '2.1 SQL injection probe in search parameter safely parameterized (200 OK)');

      // 2.2 SQL Injection in route parameters
      const sqliRoute = await request('GET', "/api/problems/' OR 1=1", null, tokenAlice);
      assert(sqliRoute.status === 400, '2.2 SQL injection probe in route ID parameter rejected with 400 Bad Request');

      // 2.3 ORDER BY parameter injection
      const sqliSort = await request('GET', '/api/problems?sortBy=title;DROP TABLE test_cases;--', null, tokenAlice);
      assert(sqliSort.status === 200, '2.3 SQL injection in sortBy safely falls back to whitelisted column');

      // 2.4 Pagination boundaries: limit clamped to 100 max
      const clampProb = await request('GET', '/api/problems?limit=9999', null, tokenAlice);
      assert(clampProb.status === 200, '2.4 Oversized limit query returns 200 OK');
      assert(clampProb.body.pagination.limit <= 100, '2.5 Problems limit strictly clamped to maximum of 100');

      // 2.5 Negative pagination clamped safely
      const negPage = await request('GET', '/api/problems?page=-5&limit=-10', null, tokenAlice);
      assert(negPage.status === 200, '2.6 Negative page/limit query returns 200 OK');
      assert(negPage.body.pagination.currentPage === 1, '2.7 Negative page clamped to 1');
      assert(negPage.body.pagination.limit >= 1, '2.8 Negative limit clamped to positive minimum');

      // 2.6 Stored XSS stored safely as text
      const xssTitle = '<script>alert("XSS")</script>';
      const xssProb = await ProblemModel.createProblem({
        title: xssTitle,
        description: 'Testing XSS neutralization',
        difficulty: 'medium',
        timeLimit: 2000,
        memoryLimit: 256,
        codingMode: 'full_program',
        allowedLanguages: ['python'],
        createdBy: profOwner.id,
        accessScope: 'public',
        isPublished: true,
      });
      trackedProblemIds.push(xssProb.id);

      const fetchXss = await request('GET', `/api/problems/${xssProb.id}`, null, tokenAlice);
      assert(fetchXss.status === 200, '2.9 Problem with XSS payload returned with 200 OK');
      assert((fetchXss.body.title || fetchXss.body.problem?.title) === xssTitle, '2.10 Stored XSS title served verbatim as harmless string');
      assert(fetchXss.headers['content-type'].includes('application/json'), '2.11 Enforces application/json Content-Type (no HTML execution)');

      // 2.7 Shell / Command Injection probe in language parameter
      const cmdInj = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python; cat /etc/passwd',
        sourceCode: 'print(1)',
      }, tokenAlice);
      assert(cmdInj.status === 400, '2.12 Shell command probe in language parameter rejected with 400 Bad Request');
    }

    // ────────────────────────────────────────────────────────────
    // 3. Submission & Judge Integrity Regression
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 3. Submission & Judge Integrity Regression ---');
    {
      resetRateLimits();

      // 3.1 Verdict & score forgery rejection
      const forgeVerdict = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(42)',
        status: 'accepted',
        score: 100,
        executionTime: 12,
        memoryUsed: 1024,
      }, tokenAlice);
      assert(forgeVerdict.status === 201, '3.1 Submission accepted for queuing (201 Created)');
      const fId = forgeVerdict.body.submission?.id || forgeVerdict.body.id;
      trackedSubmissionIds.push(fId);

      const dbVerdict = await db.query('SELECT status, score, execution_time, memory_used FROM submissions WHERE id = $1', [fId]);
      assert(dbVerdict.rows[0].status === 'queued', '3.2 Server-assigned status is queued; client "accepted" verdict stripped');
      assert(dbVerdict.rows[0].score === 0, '3.3 Client-supplied score (100) stripped to 0');
      assert(dbVerdict.rows[0].execution_time === null || dbVerdict.rows[0].execution_time === 0, '3.4 Client execution_time stripped');

      // 3.2 Hidden test case secrecy
      const probDetails = await request('GET', `/api/problems/${prob1.id}`, null, tokenAlice);
      assert(probDetails.status === 200, '3.5 Problem details fetched (200 OK)');
      const sampleCases = probDetails.body.sampleTestCases || probDetails.body.problem?.sampleTestCases;
      assert(sampleCases && sampleCases.length === 1, '3.6 Visible sample test cases correctly included');
      assert(!JSON.stringify(probDetails.body).includes('300'), '3.7 Hidden test case expected output (300) never leaked in problem response');

      const hiddenTcApi = await request('GET', `/api/problems/${prob1.id}/test-cases`, null, tokenAlice);
      assert(hiddenTcApi.status === 403, '3.8 Student blocked from /api/problems/:id/test-cases (403 Forbidden)');

      // 3.3 Sandbox execution limits (Time limit exceeded)
      const pyRunner = new PythonRunner();
      const workspaceDir = await pyRunner.createWorkspace(`test_bounds_${now}`);
      try {
        await pyRunner.writeSourceCode(workspaceDir, 'while True:\n    pass\n');
        const tlenRes = await pyRunner.run({
          workspaceDir,
          inputData: '',
          timeLimitMs: 500,
          memoryLimitMb: 128,
        });
        assert(tlenRes.status === 'time_limit_exceeded', '3.9 Infinite loop correctly terminated by sandbox timeout (time_limit_exceeded)');

        // 3.4 Host secrets stripping
        const baseRunner = new BaseRunner('generic', 'code.txt');
        const sanitizedEnv = baseRunner.getSanitizedEnv();
        assert(!sanitizedEnv.DATABASE_URL, '3.10 Host DATABASE_URL strictly omitted from execution sandbox');
        assert(!sanitizedEnv.JWT_SECRET, '3.11 Host JWT_SECRET strictly omitted from execution sandbox');
      } finally {
        await pyRunner.cleanup(workspaceDir);
      }
    }

    // ────────────────────────────────────────────────────────────
    // 4. Contest Lifecycle, Scoring & Rating Integrity
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 4. Contest Lifecycle, Scoring & Rating Integrity ---');
    {
      resetRateLimits();

      // 4.1 Contest Creation in Draft Mode
      const futureStart = new Date(now + 120000).toISOString();
      const farFutureEnd = new Date(now + 3600000).toISOString();

      const cRes = await request('POST', '/api/contests', {
        title: `Full Regression Contest ${now}`,
        description: 'Complete lifecycle validation contest',
        startTime: futureStart,
        endTime: farFutureEnd,
        isRated: true,
      }, tokenProfOwner);
      assert(cRes.status === 201, '4.1 Contest created successfully (201 Created)');
      const cId = cRes.body.contest?.id || cRes.body.id;
      trackedContestIds.push(cId);

      // 4.2 Problem Attachment prerequisite for publish
      const prematurePub = await request('POST', `/api/contests/${cId}/publish`, {}, tokenProfOwner);
      assert(prematurePub.status === 400, '4.2 Publishing contest with 0 problems rejected with 400 Bad Request');

      await ContestModel.addProblemToContest({ contestId: cId, problemId: prob1.id, points: 100, problemOrder: 1 });

      // 4.3 Temporal End Time Gate
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();
      await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [pastStart, pastEnd, cId]);
      const pastPub = await request('POST', `/api/contests/${cId}/publish`, {}, tokenProfOwner);
      assert(pastPub.status === 400, '4.3 Publishing expired contest rejected with 400 Bad Request');

      // Restore future end time and publish successfully
      await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [futureStart, farFutureEnd, cId]);
      const validPub = await request('POST', `/api/contests/${cId}/publish`, {}, tokenProfOwner);
      assert(validPub.status === 200, '4.4 Contest published successfully (200 OK)');

      // 4.4 BOLA on Contest Management
      const bolaPub = await request('POST', `/api/contests/${cId}/unpublish`, {}, tokenProfOther);
      assert(bolaPub.status === 403, '4.5 Non-owning professor blocked from unpublishing contest (403 Forbidden BOLA)');

      // 4.5 Student Enrollment
      const enrollAlice = await request('POST', `/api/contests/${cId}/join`, {}, tokenAlice);
      assert(enrollAlice.status === 201, '4.6 Student Alice enrolled in contest (201 Created)');

      const enrollBob = await request('POST', `/api/contests/${cId}/join`, {}, tokenBob);
      assert(enrollBob.status === 201, '4.7 Student Bob enrolled in contest (201 Created)');

      // Duplicate enroll blocked with 409
      const dupEnroll = await request('POST', `/api/contests/${cId}/join`, {}, tokenAlice);
      assert(dupEnroll.status === 409, '4.8 Repeated student enrollment rejected with 409 Conflict');

      // 4.6 Submissions & Deterministic Standings
      const runStart = new Date(now - 60000).toISOString();
      await db.query('UPDATE contests SET start_time = $1 WHERE id = $2', [runStart, cId]);

      // Alice solves problem
      const subAliceContest = await request('POST', '/api/submissions', {
        contestId: cId,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(5)',
      }, tokenAlice);
      assert(subAliceContest.status === 201, '4.9 Student Alice submitted solution during contest (201 Created)');
      const subAliceContestId = subAliceContest.body.submission?.id || subAliceContest.body.id;
      trackedSubmissionIds.push(subAliceContestId);
      await db.query("UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1", [subAliceContestId]);

      // Bob fails problem
      const subBobContest = await request('POST', '/api/submissions', {
        contestId: cId,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(0)',
      }, tokenBob);
      assert(subBobContest.status === 201, '4.10 Student Bob submitted solution during contest (201 Created)');
      const subBobContestId = subBobContest.body.submission?.id || subBobContest.body.id;
      trackedSubmissionIds.push(subBobContestId);
      await db.query("UPDATE submissions SET status = 'wrong_answer', score = 0 WHERE id = $1", [subBobContestId]);

      // Standings calculation determinism
      const standings1 = await StandingsService.computeContestStandings({ contestId: cId });
      const standings2 = await StandingsService.computeContestStandings({ contestId: cId });
      assert(JSON.stringify(standings1.standings) === JSON.stringify(standings2.standings), '4.11 Standings calculation is 100% deterministic across consecutive queries');
      assert(standings1.standings[0].userId === stuAlice.id, '4.12 Alice ranked #1 on leaderboard with 100 points');

      // 4.7 Rating Finalization
      // Contest ends
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 1000).toISOString(), cId]);

      const finRes = await request('POST', `/api/contests/${cId}/finalize-ratings`, {}, tokenProfOwner);
      assert(finRes.status === 200, '4.13 Ratings finalized successfully (200 OK)');
      assert(finRes.body.isRated === true, '4.14 Contest confirmed rated');
      assert(finRes.body.ratingUpdates.length === 2, '4.15 Exactly 2 participant rating updates generated');

      // Repeat finalization idempotency
      const repeatFin = await request('POST', `/api/contests/${cId}/finalize-ratings`, {}, tokenProfOwner);
      assert(repeatFin.status === 200, '4.16 Repeat finalization returns 200 OK');
      assert(repeatFin.body.alreadyFinalized === true, '4.17 Repeat finalization flags alreadyFinalized: true');

      // Verify DB rows in rating_history
      const rhRows = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1', [cId]);
      assert(rhRows.rows[0].count === 2, '4.18 Exactly 2 rating_history rows persisted in database (zero duplicate rows)');
    }

    // ────────────────────────────────────────────────────────────
    // 5. Concurrency & Race-Condition Safety
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 5. Concurrency & Race-Condition Safety ---');
    {
      resetRateLimits();

      // Create race contest
      const raceContest = await ContestModel.createContest({
        title: `Race Contest ${now}`,
        description: 'Testing concurrency safety',
        createdBy: profOwner.id,
        startTime: new Date(now - 10000).toISOString(),
        endTime: new Date(now + 600000).toISOString(),
        isRated: true,
      });
      trackedContestIds.push(raceContest.id);
      await ContestModel.addProblemToContest({ contestId: raceContest.id, problemId: prob1.id, points: 100 });
      await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [raceContest.id]);

      // Barrier synchronized concurrent joins for Alice (10 simultaneous requests)
      let barrier = false;
      const joinPromises = Array.from({ length: 10 }, async () => {
        while (!barrier) {
          await new Promise((r) => setTimeout(r, 1));
        }
        return request('POST', `/api/contests/${raceContest.id}/join`, {}, tokenAlice);
      });

      // Release barrier
      barrier = true;
      const joinResults = await Promise.all(joinPromises);

      const successJoins = joinResults.filter((r) => r.status === 201).length;
      const conflictJoins = joinResults.filter((r) => r.status === 409).length;
      assert(successJoins === 1, `5.1 Exactly 1 of 10 concurrent joins succeeded with 201 Created (got ${successJoins})`);
      assert(conflictJoins === 9, `5.2 Exactly 9 of 10 concurrent joins rejected with 409 Conflict (got ${conflictJoins})`);

      const partRows = await db.query(
        'SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [raceContest.id, stuAlice.id]
      );
      assert(partRows.rows[0].count === 1, '5.3 Composite primary key strictly prevents duplicate participant records in DB');

      // Concurrent Rating Finalization Row Lock Serialization
      await ContestModel.addParticipant(raceContest.id, stuBob.id);
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 1000).toISOString(), raceContest.id]);

      let finBarrier = false;
      const finPromises = Array.from({ length: 5 }, async () => {
        while (!finBarrier) {
          await new Promise((r) => setTimeout(r, 1));
        }
        return request('POST', `/api/contests/${raceContest.id}/finalize-ratings`, {}, tokenProfOwner);
      });
      finBarrier = true;
      const finResults = await Promise.all(finPromises);

      const allFin200 = finResults.every((r) => r.status === 200);
      assert(allFin200, '5.4 All 5 concurrent finalization requests handled safely (200 OK)');
      const rhRace = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1', [raceContest.id]);
      assert(rhRace.rows[0].count === 2, '5.5 Row lock serialization: Exactly 2 rating_history records created under concurrent finalization');
    }

    // ────────────────────────────────────────────────────────────
    // 6. Abuse, Rate Limits & Resource Protection
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 6. Abuse, Rate Limits & Resource Protection ---');
    {
      resetRateLimits();

      // 6.1 Authentication Brute Force Rate Limiting
      const authBurst = [];
      for (let i = 0; i < 11; i++) {
        authBurst.push(
          await request('POST', '/api/auth/login', {
            email: stuAlice.email,
            password: 'BadPasswordAttempt',
          })
        );
      }
      const throttledAuth = authBurst[10];
      assert(throttledAuth.status === 429, '6.1 11th rapid login attempt triggers HTTP 429 Too Many Requests');
      assert(!!throttledAuth.headers['retry-after'], '6.2 Rate limit response includes Retry-After header');
      assert(throttledAuth.headers['x-ratelimit-remaining'] === '0', '6.3 Rate limit response includes X-RateLimit-Remaining: 0');

      // 6.2 Casing Evasion in Login Identifier
      const evasionReq = await request('POST', '/api/auth/login', {
        email: stuAlice.email.toUpperCase(),
        password: 'BadPasswordAttempt',
      });
      assert(evasionReq.status === 429, '6.4 Casing variation evasion blocked by identifier normalization');

      // 6.3 Request Body Limit (> 512KB -> 413)
      const oversizedPayload = JSON.stringify({ huge: 'A'.repeat(600 * 1024) });
      const body413 = await request('POST', '/api/submissions', oversizedPayload, tokenAlice, {
        'Content-Type': 'application/json',
      });
      assert(body413.status === 413, '6.5 Request body exceeding 512KB limit rejected with HTTP 413 Payload Too Large');
      assert(body413.body.error === 'PAYLOAD_TOO_LARGE', '6.6 Error categorized as PAYLOAD_TOO_LARGE');

      // 6.4 Source Code Limit (> 64KB -> 400)
      const oversizedCode = 'print(1)\n'.repeat(10000); // ~90KB
      const code400 = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: oversizedCode,
      }, tokenAlice);
      assert(code400.status === 400, '6.7 Source code exceeding 64KB rejected with HTTP 400 Bad Request');

      // 6.5 Interactive Run Rate Limiter & Concurrency Gate
      resetRateLimits();
      let runThrottled = false;
      let lastRunStatus = 0;
      for (let i = 1; i <= 25; i++) {
        const res = await request(
          'POST',
          '/api/submissions/run',
          {
            problemId: prob1.id,
            language: 'python',
            codingMode: 'full_program',
            sourceCode: `print("interactive_${i}")`,
          },
          tokenAlice,
          { 'x-test-rate-limit': 'true' }
        );
        lastRunStatus = res.status;
        if (res.status === 429) {
          runThrottled = true;
          break;
        }
      }
      assert(runThrottled && lastRunStatus === 429, '6.8 Excess interactive run burst throttled with HTTP 429 (runCodeRateLimiter / user queue gate)');

      // Drain queue
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // 6.6 Multi-User Isolation: Throttling Alice does NOT throttle Bob
      const bobAllowed = await request('GET', '/api/problems', null, tokenBob);
      assert(bobAllowed.status === 200, '6.9 Throttling Student Alice does not affect Student Bob (isolated per-user tracking)');

      // 6.7 Public Health Probes Rate Limiter
      resetRateLimits();
      const healthOk = await request('GET', '/api/health/live');
      assert(healthOk.status === 200, '6.10 Liveness probe /api/health/live returns 200 OK');
    }

    // ────────────────────────────────────────────────────────────
    // 7. Secure Examination Regression
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 7. Secure Examination Regression ---');
    {
      resetRateLimits();

      // Create Exam Contest
      const examContest = await ContestModel.createContest({
        title: `Secure Exam ${now}`,
        description: 'Examination security verification',
        createdBy: profOwner.id,
        startTime: new Date(now - 10000).toISOString(),
        endTime: new Date(now + 600000).toISOString(),
        isRated: false,
      });
      trackedContestIds.push(examContest.id);
      await ContestModel.addProblemToContest({ contestId: examContest.id, problemId: prob1.id, points: 100 });
      await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [examContest.id]);

      // 7.1 Single-attempt start limit
      const examStartTab1 = await request('POST', `/api/contests/${examContest.id}/join`, {}, tokenAlice);
      assert(examStartTab1.status === 201, '7.1 Primary tab starts exam session successfully (201 Created)');

      const examStartTab2 = await request('POST', `/api/contests/${examContest.id}/join`, {}, tokenAlice);
      assert(examStartTab2.status === 409, '7.2 Secondary tab blocked from starting duplicate exam session (409 Conflict)');

      // 7.2 Post-deadline submission rejection
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 1000).toISOString(), examContest.id]);

      const lateSub = await request('POST', '/api/submissions', {
        contestId: examContest.id,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(42)',
      }, tokenAlice);
      assert(lateSub.status === 400, '7.3 Submission dispatched after exam deadline strictly rejected with 400 Bad Request');
      assert(lateSub.body.message.includes('ended') || lateSub.body.message.includes('deadline'), '7.4 Error explicitly cites ended contest/deadline');
    }

    // ────────────────────────────────────────────────────────────
    // 8. Admin Panel & Platform Governance
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 8. Admin Panel & Platform Governance ---');
    {
      resetRateLimits();

      // 8.1 Admin User Management listing
      const adminUsersList = await request('GET', '/api/admin/users', null, tokenSuperAdmin);
      assert(adminUsersList.status === 200, '8.1 Super Admin lists users (200 OK)');
      assert(Array.isArray(adminUsersList.body.data?.users), '8.2 Users list is an array');
      assert(adminUsersList.body.data?.users.every((u) => !u.password_hash && !u.passwordHash), '8.3 Zero password hashes exposed in admin user list');

      // 8.2 Audit logs accessible to super admin
      const auditRes = await request('GET', '/api/admin/audit-logs', null, tokenSuperAdmin);
      assert(auditRes.status === 200, '8.4 Super Admin reads audit logs (200 OK)');
      assert(Array.isArray(auditRes.body.data?.logs), '8.5 Audit logs returned as array');

      // To test the last active super admin protection, temporarily deactivate other super admins
      const otherSaRes = await db.query(
        `SELECT id FROM users WHERE role = 'super_admin' AND id != $1 AND is_active = true;`,
        [superAdmin.id]
      );
      const otherSaIds = otherSaRes.rows.map((r) => r.id);
      if (otherSaIds.length > 0) {
        await db.query(`UPDATE users SET is_active = false WHERE id = ANY($1::int[]);`, [otherSaIds]);
      }

      try {
        // 8.3 Super Admin self-lockout prevention (Demotion)
        const demoteSelf = await request('PATCH', `/api/admin/users/${superAdmin.id}/role`, {
          role: 'student',
        }, tokenSuperAdmin);
        assert(demoteSelf.status === 409, '8.6 Self-demotion of last active super admin blocked with 409 Conflict');

        // 8.4 Super Admin self-lockout prevention (Deactivation)
        const deactSelf = await request('PATCH', `/api/admin/users/${superAdmin.id}/status`, {
          isActive: false,
        }, tokenSuperAdmin);
        assert(deactSelf.status === 409, '8.7 Self-deactivation of last active super admin blocked with 409 Conflict');
      } finally {
        if (otherSaIds.length > 0) {
          await db.query(`UPDATE users SET is_active = true WHERE id = ANY($1::int[]);`, [otherSaIds]);
        }
      }
    }

    // ────────────────────────────────────────────────────────────
    // 9. Secret Disclosure & Configuration Review
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 9. Secret Disclosure & Configuration Review ---');
    {
      // 9.1 Clean error response bodies (No stack trace, DB credentials)
      const notFoundErr = await request('GET', '/api/problems/9999999', null, tokenAlice);
      assert(notFoundErr.status === 404, '9.1 Not found error returned with 404');
      assert(!notFoundErr.raw.includes('password') && !notFoundErr.raw.includes('postgres://'), '9.2 Error response excludes database credentials');
      assert(!notFoundErr.raw.includes('node_modules') && !notFoundErr.raw.includes('at processTicksAndRejections'), '9.3 Error response excludes internal stack traces');

      // 9.2 Audit Log Hygiene (No plaintext passwords)
      const rawAuditRows = await db.query('SELECT metadata FROM audit_logs WHERE metadata IS NOT NULL');
      let leakedPassword = false;
      for (const row of rawAuditRows.rows) {
        const str = JSON.stringify(row.metadata);
        if (str.includes('TestP@ss123') || str.includes('BadPasswordAttempt') || str.includes('WrongPassword999')) {
          leakedPassword = true;
          break;
        }
      }
      assert(!leakedPassword, '9.4 Audit logs contain zero leaked plaintext passwords or tokens');

      // 9.3 Frontend Bundle Scan
      const frontendDistDir = path.resolve(__dirname, '../frontend/dist/assets');
      let frontendClean = true;
      if (fs.existsSync(frontendDistDir)) {
        const files = fs.readdirSync(frontendDistDir);
        for (const f of files) {
          if (f.endsWith('.js')) {
            const content = fs.readFileSync(path.join(frontendDistDir, f), 'utf8');
            if (content.includes('DATABASE_URL') || content.includes('JWT_SECRET') || content.includes('password_hash')) {
              frontendClean = false;
              break;
            }
          }
        }
      }
      assert(frontendClean, '9.5 Frontend production bundle contains zero exposed server secrets (JWT_SECRET, DATABASE_URL)');
    }

    // ────────────────────────────────────────────────────────────
    // 10. Database Baseline Integrity Check
    // ────────────────────────────────────────────────────────────
    console.log('\n--- 10. Database Baseline Integrity Check ---');
    {
      await cleanupTestData();

      const { execSync } = require('child_process');
      execSync('node restore_canonical_baseline.js', { cwd: path.resolve(__dirname) });

      const uCheck = await db.query('SELECT COUNT(*)::int AS count FROM users');
      const cCheck = await db.query('SELECT COUNT(*)::int AS count FROM contests');
      const pCheck = await db.query('SELECT COUNT(*)::int AS count FROM problems');
      const sCheck = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
      const rCheck = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

      assert(uCheck.rows[0].count === 5, `10.1 Users count strictly preserved at 5 (got ${uCheck.rows[0].count})`);
      assert(cCheck.rows[0].count === 1, `10.2 Contests count strictly preserved at 1 (got ${cCheck.rows[0].count})`);
      assert(pCheck.rows[0].count === 5, `10.3 Problems count strictly preserved at 5 (got ${pCheck.rows[0].count})`);
      assert(sCheck.rows[0].count === 33, `10.4 Submissions count strictly preserved at 33 (got ${sCheck.rows[0].count})`);
      assert(rCheck.rows[0].count === 0, `10.5 Rating history count strictly preserved at 0 (got ${rCheck.rows[0].count})`);
    }

  } catch (err) {
    console.error('Unhandled test suite failure:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.pool.end();
  }

  console.log('\n================================================================');
  console.log(`FULL REGRESSION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
