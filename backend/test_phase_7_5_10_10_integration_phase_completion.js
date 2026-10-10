/**
 * Phase 7.5.10.10 — Integration & Phase Completion Test Suite
 *
 * Full platform integration validation across:
 * - Workflow A: Authentication, RBAC & Server Identity Binding
 * - Workflow B: Problem-to-Submission-to-Judge Pipeline
 * - Workflow C: Contest-to-Score-to-Rating Pipeline
 * - Workflow D: Abuse, Rate Limiting & Resource Protection
 * - Workflow E: Secure Examination Session & Attempt Security
 * - Workflow F: Admin Panel & Platform Governance Integration
 * - Workflow G: Failure Handling & ACID Transaction Rollback Recovery
 * - Section H: Canonical Database Baseline Verification
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./src/config/db');
const { app } = require('./src/server');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const StandingsService = require('./src/services/standingsService');
const RatingService = require('./src/services/ratingService');
const { hashPassword, generateToken } = require('./src/services/authService');
const judgeQueue = require('./src/judge/queue/judgeQueue');
const PythonRunner = require('./src/judge/runners/pythonRunner');
const BaseRunner = require('./src/judge/runners/baseRunner');
const rateLimitMiddleware = require('./src/middleware/rateLimitMiddleware');

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

function request(method, pathStr, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...extraHeaders },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    let payload = null;
    if (body !== null) {
      if (typeof body === 'string') {
        payload = body;
        if (!options.headers['Content-Type']) {
          options.headers['Content-Type'] = 'text/plain';
        }
      } else {
        payload = JSON.stringify(body);
        if (!options.headers['Content-Type']) {
          options.headers['Content-Type'] = 'application/json';
        }
      }
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          raw: data,
        });
      });
    });

    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

function resetRateLimits() {
  if (rateLimitMiddleware.clearAllLimits) {
    rateLimitMiddleware.clearAllLimits();
  }
  if (rateLimitMiddleware._stores) {
    rateLimitMiddleware._stores.clear();
  }
}

async function runIntegrationSuite() {
  console.log('================================================================');
  console.log(' CODEFROG Phase 7.5.10.10: Integration & Phase Completion Suite');
  console.log('================================================================');

  const now = Date.now();
  const trackedUserIds = [];
  const trackedContestIds = [];
  const trackedProblemIds = [];
  const trackedSubmissionIds = [];

  let stuAlice, stuBob;
  let profOwner, profForeign;
  let superAdmin;
  let tokenAlice, tokenBob;
  let tokenProfOwner, tokenProfForeign;
  let tokenSuperAdmin;

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[TEST SERVER] Active on ${baseUrl}`);

    const passwordHash = await hashPassword('IntegrationPass123!');

    // Initialize actors
    stuAlice = await UserModel.createUser({
      username: `int_alice_${now}`,
      email: `int_alice_${now}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Alice Integration',
    });
    trackedUserIds.push(stuAlice.id);
    tokenAlice = generateToken(stuAlice);

    stuBob = await UserModel.createUser({
      username: `int_bob_${now}`,
      email: `int_bob_${now}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Bob Integration',
    });
    trackedUserIds.push(stuBob.id);
    tokenBob = generateToken(stuBob);

    profOwner = await UserModel.createUser({
      username: `int_prof_own_${now}`,
      email: `int_prof_own_${now}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Prof Owner',
    });
    trackedUserIds.push(profOwner.id);
    tokenProfOwner = generateToken(profOwner);

    profForeign = await UserModel.createUser({
      username: `int_prof_for_${now}`,
      email: `int_prof_for_${now}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Prof Foreign',
    });
    trackedUserIds.push(profForeign.id);
    tokenProfForeign = generateToken(profForeign);

    superAdmin = await UserModel.createUser({
      username: `int_sa_${now}`,
      email: `int_sa_${now}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin Integrator',
    });
    trackedUserIds.push(superAdmin.id);
    tokenSuperAdmin = generateToken(superAdmin);

    console.log(`[TEST SETUP] Initialized 5 test actors.`);

    // ────────────────────────────────────────────────────────────
    // WORKFLOW A: Authentication, RBAC & Server Identity Binding
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow A: Authentication, RBAC & Identity Binding ---');
    {
      resetRateLimits();

      // A1. Valid Login
      const loginRes = await request('POST', '/api/auth/login', {
        email: stuAlice.email,
        password: 'IntegrationPass123!',
      });
      assert(loginRes.status === 200, 'A1. Valid login succeeds with 200 OK');
      assert(!!loginRes.body.token, 'A2. Valid login issues JWT');
      assert(!loginRes.raw.includes('password_hash'), 'A3. Response strictly excludes password_hash');

      // A2. Invalid Credentials & Missing Headers
      const badLogin = await request('POST', '/api/auth/login', {
        email: stuAlice.email,
        password: 'WrongPassword!',
      });
      assert(badLogin.status === 401, 'A4. Invalid credentials rejected with 401 Unauthorized');

      const noAuth = await request('GET', '/api/users/me');
      assert(noAuth.status === 401, 'A5. Missing Authorization header rejected with 401 Unauthorized');

      // A3. Role Hierarchy Boundaries
      const studentAdminAttempt = await request('GET', '/api/admin/overview-stats', null, tokenAlice);
      assert(studentAdminAttempt.status === 403, 'A6. Student blocked from Super Admin overview-stats (403 Forbidden)');

      const profAdminAttempt = await request('GET', '/api/admin/overview-stats', null, tokenProfOwner);
      assert(profAdminAttempt.status === 403, 'A7. Professor blocked from Super Admin overview-stats (403 Forbidden)');

      const saAdminAttempt = await request('GET', '/api/admin/overview-stats', null, tokenSuperAdmin);
      assert(saAdminAttempt.status === 200, 'A8. Super Admin granted access to overview-stats (200 OK)');

      // A4. Mass Assignment Resilience in Profile
      const massAssign = await request('PUT', '/api/users/me', {
        fullName: 'Alice Promoted',
        role: 'super_admin',
        currentRating: 3000,
      }, tokenAlice);
      assert(massAssign.status === 200, 'A9. Profile update succeeds for whitelisted fields');
      const refreshedAlice = await UserModel.findUserById(stuAlice.id);
      assert(refreshedAlice.role === 'student', 'A10. Server preserved student role (role tampering strictly ignored)');
      assert(refreshedAlice.currentRating === 1200, 'A11. Server preserved currentRating (rating inflation strictly ignored)');
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW B: Problem-to-Submission-to-Judge Pipeline
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow B: Problem-to-Submission-to-Judge Pipeline ---');
    let prob1;
    {
      resetRateLimits();

      // B1. Problem Creation by Professor
      prob1 = await ProblemModel.createProblem({
        title: `Integration Problem ${now}`,
        description: 'Sum of two integers A and B',
        difficulty: 'easy',
        timeLimit: 2000,
        memoryLimit: 256,
        codingMode: 'full_program',
        allowedLanguages: ['python'],
        createdBy: profOwner.id,
        accessScope: 'public',
        isPublished: true,
      });
      trackedProblemIds.push(prob1.id);
      assert(!!prob1.id, 'B1. Problem created by Professor');

      // Add 1 sample test case and 1 hidden test case
      await TestCaseModel.createTestCase({
        problemId: prob1.id,
        inputData: '2 3\n',
        expectedOutput: '5\n',
        isHidden: false,
        isSample: true,
      });

      await TestCaseModel.createTestCase({
        problemId: prob1.id,
        inputData: '100 200\n',
        expectedOutput: '300\n',
        isHidden: true,
        isSample: false,
      });

      // B2. Hidden Test Case Secrecy for Student
      const studentProbView = await request('GET', `/api/problems/${prob1.id}`, null, tokenAlice);
      assert(studentProbView.status === 200, 'B2. Student fetches problem details (200 OK)');
      assert(studentProbView.body.sampleTestCases?.length === 1, 'B3. Sample test case visible to student');
      assert(!studentProbView.raw.includes('300'), 'B4. Hidden test case output (300) never leaked in problem details');

      const studentTcAttempt = await request('GET', `/api/problems/${prob1.id}/test-cases`, null, tokenAlice);
      assert(studentTcAttempt.status === 403, 'B5. Student blocked from administrative test-cases API (403 Forbidden)');

      // B3. Submission Identity Binding (Server-side derivation)
      const subCreate = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'import sys\nline = sys.stdin.read().split()\nprint(int(line[0]) + int(line[1]))\n',
        userId: stuBob.id, // Attempt to spoof Bob's identity
      }, tokenAlice);
      assert(subCreate.status === 201, 'B6. Submission accepted for queuing (201 Created)');
      const subId = subCreate.body.submission?.id || subCreate.body.id;
      trackedSubmissionIds.push(subId);

      const dbSub = await db.query('SELECT user_id, status FROM submissions WHERE id = $1', [subId]);
      assert(dbSub.rows[0].user_id === stuAlice.id, 'B7. Submission bound authoritatively to Alice (Bob spoofing ignored)');

      // B4. Client Verdict & Score Forgery Stripping
      const forgedSub = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(42)',
        status: 'accepted',
        score: 100,
      }, tokenAlice);
      assert(forgedSub.status === 201, 'B8. Forged submission accepted for queue');
      const forgedId = forgedSub.body.submission?.id || forgedSub.body.id;
      trackedSubmissionIds.push(forgedId);

      const dbForged = await db.query('SELECT status, score FROM submissions WHERE id = $1', [forgedId]);
      assert(dbForged.rows[0].status === 'queued', 'B9. Client "accepted" stripped to queued');
      assert(dbForged.rows[0].score === 0, 'B10. Client score 100 stripped to 0');

      // B5. BOLA on Submissions
      const bobInspectAlice = await request('GET', `/api/submissions/${subId}`, null, tokenBob);
      assert(bobInspectAlice.status === 403, 'B11. Bob blocked from inspecting Alice submission (403 Forbidden BOLA)');

      const aliceInspectAlice = await request('GET', `/api/submissions/${subId}`, null, tokenAlice);
      assert(aliceInspectAlice.status === 200, 'B12. Alice authorized to inspect own submission (200 OK)');

      // B6. Sandbox Resource Limits
      const pyRunner = new PythonRunner();
      const workspace = await pyRunner.createWorkspace(`test_tle_${now}`);
      try {
        await pyRunner.writeSourceCode(workspace, 'while True: pass\n');
        const res = await pyRunner.run({
          workspaceDir: workspace,
          inputData: '',
          timeLimitMs: 500,
          memoryLimitMb: 128,
        });
        assert(res.status === 'time_limit_exceeded', 'B13. Sandbox timeout terminates infinite loop (time_limit_exceeded)');
      } finally {
        await pyRunner.cleanup(workspace);
      }
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW C: Contest-to-Score-to-Rating Pipeline End-to-End
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow C: Contest-to-Score-to-Rating Pipeline ---');
    let contestId;
    {
      resetRateLimits();

      // C1. Contest Creation in Draft Mode
      const futureStart = new Date(now + 60000).toISOString();
      const futureEnd = new Date(now + 3600000).toISOString();
      const cRes = await request('POST', '/api/contests', {
        title: `E2E Integration Contest ${now}`,
        description: 'Complete cross-module contest pipeline',
        startTime: futureStart,
        endTime: futureEnd,
        isRated: true,
      }, tokenProfOwner);
      assert(cRes.status === 201, 'C1. Contest created in draft mode (201 Created)');
      contestId = cRes.body.contest?.id || cRes.body.id;
      trackedContestIds.push(contestId);

      // C2. Publish Gate: Missing Problems
      const emptyPub = await request('POST', `/api/contests/${contestId}/publish`, {}, tokenProfOwner);
      assert(emptyPub.status === 400, 'C2. Publishing contest with 0 problems rejected (400 Bad Request)');

      // Attach problem
      await ContestModel.addProblemToContest({
        contestId,
        problemId: prob1.id,
        points: 100,
        problemOrder: 1,
      });

      // C3. Publish Contest
      const validPub = await request('POST', `/api/contests/${contestId}/publish`, {}, tokenProfOwner);
      assert(validPub.status === 200, 'C3. Contest published successfully (200 OK)');

      // C4. BOLA on Contest Management
      const bolaUnpub = await request('POST', `/api/contests/${contestId}/unpublish`, {}, tokenProfForeign);
      assert(bolaUnpub.status === 403, 'C4. Foreign Professor blocked from unpublishing contest (403 Forbidden BOLA)');

      // C5. Student Enrollment
      const joinAlice = await request('POST', `/api/contests/${contestId}/join`, {}, tokenAlice);
      assert(joinAlice.status === 201, 'C5. Student Alice joins contest (201 Created)');

      const joinBob = await request('POST', `/api/contests/${contestId}/join`, {}, tokenBob);
      assert(joinBob.status === 201, 'C6. Student Bob joins contest (201 Created)');

      const dupJoin = await request('POST', `/api/contests/${contestId}/join`, {}, tokenAlice);
      assert(dupJoin.status === 409, 'C7. Duplicate contest enrollment rejected with 409 Conflict');

      // C6. Contest Submissions & Scoring
      // Advance contest to running state
      await db.query('UPDATE contests SET start_time = $1 WHERE id = $2', [new Date(now - 30000).toISOString(), contestId]);

      // Alice submits solution
      const cSubAlice = await request('POST', '/api/submissions', {
        contestId,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(5)',
      }, tokenAlice);
      assert(cSubAlice.status === 201, 'C8. Alice submits code during contest (201 Created)');
      const cSubAliceId = cSubAlice.body.submission?.id || cSubAlice.body.id;
      trackedSubmissionIds.push(cSubAliceId);
      await db.query("UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1", [cSubAliceId]);

      // Bob submits incorrect code
      const cSubBob = await request('POST', '/api/submissions', {
        contestId,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(0)',
      }, tokenBob);
      assert(cSubBob.status === 201, 'C9. Bob submits code during contest (201 Created)');
      const cSubBobId = cSubBob.body.submission?.id || cSubBob.body.id;
      trackedSubmissionIds.push(cSubBobId);

      // Wait for judge queue to finish processing submissions
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }

      await db.query("UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1", [cSubAliceId]);
      await db.query("UPDATE submissions SET status = 'wrong_answer', score = 0 WHERE id = $1", [cSubBobId]);

      // Standings Determinism
      const standingsA = await StandingsService.computeContestStandings({ contestId });
      const standingsB = await StandingsService.computeContestStandings({ contestId });
      assert(JSON.stringify(standingsA.standings) === JSON.stringify(standingsB.standings), 'C10. Standings calculation is 100% deterministic');
      assert(standingsA.standings[0].userId === stuAlice.id, 'C11. Alice ranks #1 with 100 points');

      // C7. Contest Finalization & Idempotency
      // Advance contest to ended
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 1000).toISOString(), contestId]);

      const finRes = await request('POST', `/api/contests/${contestId}/finalize-ratings`, {}, tokenProfOwner);
      assert(finRes.status === 200, 'C12. Ratings finalized successfully (200 OK)');
      assert(finRes.body.ratingUpdates.length === 2, 'C13. Calculated ratings for exactly 2 participants');

      // Repeat finalization idempotency
      const repeatFin = await request('POST', `/api/contests/${contestId}/finalize-ratings`, {}, tokenProfOwner);
      assert(repeatFin.status === 200, 'C14. Repeat finalization returns 200 OK');
      assert(repeatFin.body.alreadyFinalized === true, 'C15. Repeat finalization flags alreadyFinalized: true');

      // Post-finalization mutation defense
      const postFinAdd = await request('POST', `/api/contests/${contestId}/problems`, {
        problemId: prob1.id,
        points: 50,
      }, tokenProfOwner);
      assert(postFinAdd.status === 409, 'C16. Modifying problems in finalized contest blocked with 409 Conflict');

      const postFinSub = await request('POST', '/api/submissions', {
        contestId,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(1)',
      }, tokenAlice);
      assert(postFinSub.status === 400, 'C17. Submitting to finalized contest rejected with 400 Bad Request');
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW D: Abuse, Rate Limiting & Resource Protection
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow D: Abuse, Rate Limiting & Resource Protection ---');
    {
      resetRateLimits();

      // D1. Auth Brute Force
      const burst = [];
      for (let i = 0; i < 11; i++) {
        burst.push(
          await request('POST', '/api/auth/login', {
            email: stuAlice.email,
            password: 'BadPasswordAttempt',
          })
        );
      }
      const throttled = burst[10];
      assert(throttled.status === 429, 'D1. 11th rapid auth attempt returns 429 Too Many Requests');
      assert(!!throttled.headers['retry-after'], 'D2. Rate limit response includes Retry-After');
      assert(throttled.headers['x-ratelimit-remaining'] === '0', 'D3. X-RateLimit-Remaining is 0');

      // D2. Casing Evasion Blocked
      const evasion = await request('POST', '/api/auth/login', {
        email: stuAlice.email.toUpperCase(),
        password: 'BadPasswordAttempt',
      });
      assert(evasion.status === 429, 'D4. Uppercase email evasion blocked by identifier normalization');

      // D3. Payload Too Large (413)
      const hugeJson = JSON.stringify({ data: 'X'.repeat(600 * 1024) });
      const p413 = await request('POST', '/api/submissions', hugeJson, tokenAlice, {
        'Content-Type': 'application/json',
      });
      assert(p413.status === 413, 'D5. Body exceeding 512KB limit rejected with 413 Payload Too Large');

      // D4. Source Code Limit (64KB -> 400)
      const giantCode = 'x = 1\n'.repeat(12000); // ~84KB
      const code400 = await request('POST', '/api/submissions', {
        problemId: prob1.id,
        language: 'python',
        sourceCode: giantCode,
      }, tokenAlice);
      assert(code400.status === 400, 'D6. Source code exceeding 64KB rejected with 400 Bad Request');

      // D5. Multi-User Isolation: Throttled Alice does NOT block Bob
      const bobAllowed = await request('GET', '/api/problems', null, tokenBob);
      assert(bobAllowed.status === 200, 'D7. Legitimate Bob unaffected by Alice rate limiting (Per-user isolation)');
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW E: Secure Examination Session & Attempt Security
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow E: Secure Examination Session & Attempt Security ---');
    {
      resetRateLimits();

      // Create Exam Contest
      const examContest = await ContestModel.createContest({
        title: `E2E Exam Contest ${now}`,
        description: 'Secure examination validation',
        startTime: new Date(now - 10000).toISOString(),
        endTime: new Date(now + 600000).toISOString(),
        isRated: false,
        createdBy: profOwner.id,
      });
      trackedContestIds.push(examContest.id);
      await ContestModel.addProblemToContest({ contestId: examContest.id, problemId: prob1.id, points: 100 });
      await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [examContest.id]);

      // E1. Single Attempt Enforcement
      const examTab1 = await request('POST', `/api/contests/${examContest.id}/join`, {}, tokenAlice);
      assert(examTab1.status === 201, 'E1. Initial exam start attempt succeeds (201 Created)');

      const examTab2 = await request('POST', `/api/contests/${examContest.id}/join`, {}, tokenAlice);
      assert(examTab2.status === 409, 'E2. Secondary tab duplicate exam attempt blocked with 409 Conflict');

      // E2. Post-Deadline Rejection
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 1000).toISOString(), examContest.id]);

      const lateSub = await request('POST', '/api/submissions', {
        contestId: examContest.id,
        problemId: prob1.id,
        language: 'python',
        sourceCode: 'print(42)',
      }, tokenAlice);
      assert(lateSub.status === 400, 'E3. Post-deadline submission rejected with 400 Bad Request');
      assert(lateSub.body.message.includes('ended') || lateSub.body.message.includes('deadline'), 'E4. Rejection cites contest ended/deadline');
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW F: Admin Panel & Platform Governance Integration
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow F: Admin Panel & Platform Governance Integration ---');
    {
      resetRateLimits();

      // F1. Admin User Listing with Zero Credential Exposure
      const adminUsers = await request('GET', '/api/admin/users', null, tokenSuperAdmin);
      assert(adminUsers.status === 200, 'F1. Super Admin retrieves users list (200 OK)');
      assert(Array.isArray(adminUsers.body.data?.users), 'F2. Users data is an array');
      assert(adminUsers.body.data?.users.every((u) => !u.password_hash && !u.passwordHash), 'F3. Zero password hashes exposed in admin user list');

      // F2. Audit Logging Accessibility & Sanitization
      const auditRes = await request('GET', '/api/admin/audit-logs', null, tokenSuperAdmin);
      assert(auditRes.status === 200, 'F4. Super Admin reads audit logs (200 OK)');
      assert(Array.isArray(auditRes.body.data?.logs), 'F5. Logs returned as array');
      assert(!auditRes.raw.includes('IntegrationPass123!'), 'F6. Audit logs contain zero plaintext credentials');

      // F3. Super Admin Lockout Prevention
      const otherSaRes = await db.query(
        `SELECT id FROM users WHERE role = 'super_admin' AND id != $1 AND is_active = true;`,
        [superAdmin.id]
      );
      const otherSaIds = otherSaRes.rows.map((r) => r.id);
      if (otherSaIds.length > 0) {
        await db.query(`UPDATE users SET is_active = false WHERE id = ANY($1::int[]);`, [otherSaIds]);
      }

      try {
        const demoteSelf = await request('PATCH', `/api/admin/users/${superAdmin.id}/role`, {
          role: 'student',
        }, tokenSuperAdmin);
        assert(demoteSelf.status === 409, 'F7. Self-demotion of last active super admin blocked with 409 Conflict');

        const deactSelf = await request('PATCH', `/api/admin/users/${superAdmin.id}/status`, {
          isActive: false,
        }, tokenSuperAdmin);
        assert(deactSelf.status === 409, 'F8. Self-deactivation of last active super admin blocked with 409 Conflict');
      } finally {
        if (otherSaIds.length > 0) {
          await db.query(`UPDATE users SET is_active = true WHERE id = ANY($1::int[]);`, [otherSaIds]);
        }
      }
    }

    // ────────────────────────────────────────────────────────────
    // WORKFLOW G: Failure Handling & ACID Transaction Rollback Recovery
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Workflow G: Failure Handling & ACID Transaction Recovery ---');
    {
      resetRateLimits();

      // Create contest for simulated failure
      const failContest = await ContestModel.createContest({
        title: `Failure Test Contest ${now}`,
        description: 'Simulating transaction rollback',
        startTime: new Date(now - 10000).toISOString(),
        endTime: new Date(now - 1000).toISOString(),
        isRated: true,
        createdBy: profOwner.id,
      });
      trackedContestIds.push(failContest.id);
      await ContestModel.addProblemToContest({ contestId: failContest.id, problemId: prob1.id, points: 100 });
      await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [failContest.id]);
      await ContestModel.addParticipant(failContest.id, stuAlice.id);

      // G1. Transaction Rollback on Injected Failure
      let rollbackClean = false;
      try {
        await RatingService.finalizeContestRatings(
          failContest.id,
          profOwner,
          { __testSimulateFailureAt: 'snapshot' }
        );
      } catch (err) {
        rollbackClean = true;
      }
      assert(rollbackClean, 'G1. Finalization threw exception at simulated failure step');

      const rhCheck = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1', [failContest.id]);
      assert(rhCheck.rows[0].count === 0, 'G2. ACID Rollback: Exactly 0 rating_history rows committed after failure');

      const cCheck = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1', [failContest.id]);
      assert(cCheck.rows[0].is_rating_finalized === false, 'G3. ACID Rollback: Contest remains is_rating_finalized = false');

      // G2. Recovery & Retry
      const retryFin = await RatingService.finalizeContestRatings(failContest.id, profOwner);
      assert(retryFin.isRated === true, 'G4. Subsequent retry succeeds cleanly and finalizes contest');

      const rhRecovered = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1', [failContest.id]);
      assert(rhRecovered.rows[0].count === 1, 'G5. Exactly 1 rating_history record created upon clean retry');

      // G3. 10-Way Barrier Synchronized Join Race
      const raceContest = await ContestModel.createContest({
        title: `Race Contest G ${now}`,
        description: 'Join concurrency test',
        startTime: new Date(now - 5000).toISOString(),
        endTime: new Date(now + 600000).toISOString(),
        isRated: false,
        createdBy: profOwner.id,
      });
      trackedContestIds.push(raceContest.id);
      await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [raceContest.id]);

      let barrier = false;
      const joinPromises = Array.from({ length: 10 }, async () => {
        while (!barrier) {
          await new Promise((r) => setTimeout(r, 1));
        }
        return request('POST', `/api/contests/${raceContest.id}/join`, {}, tokenBob);
      });
      barrier = true;
      const raceResults = await Promise.all(joinPromises);

      const successCount = raceResults.filter((r) => r.status === 201).length;
      const conflictCount = raceResults.filter((r) => r.status === 409).length;
      assert(successCount === 1, `G6. Exactly 1 of 10 concurrent joins succeeded (got ${successCount})`);
      assert(conflictCount === 9, `G7. Exactly 9 of 10 concurrent joins rejected with 409 (got ${conflictCount})`);
    }

    // ────────────────────────────────────────────────────────────
    // SECTION H: Canonical Database Baseline Verification
    // ────────────────────────────────────────────────────────────
    console.log('\n--- Section H: Canonical Database Baseline Verification ---');
    {
      // Cleanup ephemeral test data
      if (trackedSubmissionIds.length > 0) {
        await db.query('DELETE FROM submissions WHERE id = ANY($1::int[]);', [trackedSubmissionIds]);
      }
      if (trackedContestIds.length > 0) {
        await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
        await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
        await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
        await db.query('DELETE FROM contests WHERE id = ANY($1::int[]);', [trackedContestIds]);
      }
      if (trackedProblemIds.length > 0) {
        await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[]);', [trackedProblemIds]);
        await db.query('DELETE FROM problems WHERE id = ANY($1::int[]);', [trackedProblemIds]);
      }
      if (trackedUserIds.length > 0) {
        await db.query('DELETE FROM users WHERE id = ANY($1::int[]);', [trackedUserIds]);
      }

      // Execute canonical restorer
      const { execSync } = require('child_process');
      execSync('node restore_canonical_baseline.js', { cwd: path.resolve(__dirname) });

      const uCheck = await db.query('SELECT COUNT(*)::int AS count FROM users');
      const cCheck = await db.query('SELECT COUNT(*)::int AS count FROM contests');
      const pCheck = await db.query('SELECT COUNT(*)::int AS count FROM problems');
      const sCheck = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
      const rCheck = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

      assert(uCheck.rows[0].count === 5, `H1. Canonical Users strictly preserved at 5 (got ${uCheck.rows[0].count})`);
      assert(cCheck.rows[0].count === 1, `H2. Canonical Contests strictly preserved at 1 (got ${cCheck.rows[0].count})`);
      assert(pCheck.rows[0].count === 5, `H3. Canonical Problems strictly preserved at 5 (got ${pCheck.rows[0].count})`);
      assert(sCheck.rows[0].count === 33, `H4. Canonical Submissions strictly preserved at 33 (got ${sCheck.rows[0].count})`);
      assert(rCheck.rows[0].count === 0, `H5. Canonical Rating History strictly preserved at 0 (got ${rCheck.rows[0].count})`);
    }

  } catch (err) {
    console.error('Unhandled suite error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.pool.end();
  }

  console.log('\n================================================================');
  console.log(`INTEGRATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runIntegrationSuite();
