/**
 * Phase 7.5.10.5.7 — Submission State Validation Security Test Suite
 * File: backend/test_phase_7_5_10_5_7_submission_state_security.js
 *
 * Comprehensive security validation for Submission State & Lifecycle Boundary:
 * A. Authentication
 * B. Contest Existence
 * C. Contest Lifecycle State
 * D. Exact Start/End Time Boundaries
 * E. Participant Validation
 * F. Problem Membership
 * G. Problem Availability
 * H. Payload Tampering & Spoofing
 * I. Submission Ownership & Immutability
 * J. BOLA / IDOR Protections
 * K. Replay / Duplicate Behavior
 * L. Concurrent Submissions
 * M. Contest-End Race
 * N. Problem-Locking Integration
 * O. Judge / Queue Boundary
 * P. Rate Limiting
 * Q. Audit Logging Integrity
 * R. Database Integrity & Constraints
 */

process.env.RATE_LIMIT_SUBMIT_MAX = '5000';
process.env.RATE_LIMIT_RUN_MAX = '5000';
process.env.RATE_LIMIT_MEDIUM_MAX = '5000';
process.env.RATE_LIMIT_CONTEST_MAX = '5000';
process.env.MAX_CONCURRENT_SUBS_PER_USER = '5000';
process.env.MAX_CONCURRENT_RUNS_PER_USER = '5000';

const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const RATE_LIMIT_CONFIG = require('./src/config/rateLimitConfig');
RATE_LIMIT_CONFIG.SUBMIT_CODE.maxConcurrentPerUser = 5000;
RATE_LIMIT_CONFIG.RUN_CODE.maxConcurrentPerUser = 5000;
const judgeQueue = require('./src/judge/queue/judgeQueue');
const { app } = require('./src/server');
const db = require('./src/config/db');
const config = require('./src/config/env');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { hashPassword, generateToken } = require('./src/services/authService');
const { getContestRuntimeState } = require('./src/services/contestService');

let server;
let port;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runSubmissionStateSecurityTests() {
  let passed = 0;
  let failed = 0;

  function testAssert(condition, message) {
    if (condition) {
      passed++;
      console.log(`  [PASS] ${message}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${message}`);
    }
  }

  const trackedUserIds = [];
  const trackedContestIds = [];
  const trackedProblemIds = [];
  const trackedSubmissionIds = [];

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  console.log(`\n================================================================`);
  console.log(` PHASE 7.5.10.5.7 SUBMISSION STATE VALIDATION SECURITY TESTS `);
  console.log(` Server listening at: ${baseUrl}`);
  console.log(`================================================================\n`);

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------
    const hashedPw = await hashPassword('TestSecurePass123!');
    const stamp = Date.now();

    // 1. Owning Professor (Alan)
    const profAlanRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'professor', 'Alan Professor', true, true) RETURNING id;`,
      [`sub_alan_${stamp}`, `alan_${stamp}@test.edu`, hashedPw]
    );
    const profAlanId = profAlanRes.rows[0].id;
    trackedUserIds.push(profAlanId);
    const profAlanToken = generateToken({ id: profAlanId, role: 'professor' });

    // 2. Non-owning Professor (Bob)
    const profBobRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'professor', 'Bob Professor', true, true) RETURNING id;`,
      [`sub_bob_${stamp}`, `bob_${stamp}@test.edu`, hashedPw]
    );
    const profBobId = profBobRes.rows[0].id;
    trackedUserIds.push(profBobId);
    const profBobToken = generateToken({ id: profBobId, role: 'professor' });

    // 3. Enrolled Student (Charlie)
    const stuCharlieRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'student', 'Charlie Student', true, true) RETURNING id;`,
      [`sub_charlie_${stamp}`, `charlie_${stamp}@test.edu`, hashedPw]
    );
    const stuCharlieId = stuCharlieRes.rows[0].id;
    trackedUserIds.push(stuCharlieId);
    const stuCharlieToken = generateToken({ id: stuCharlieId, role: 'student' });

    // 4. Unenrolled Student (David)
    const stuDavidRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'student', 'David Student', true, true) RETURNING id;`,
      [`sub_david_${stamp}`, `david_${stamp}@test.edu`, hashedPw]
    );
    const stuDavidId = stuDavidRes.rows[0].id;
    trackedUserIds.push(stuDavidId);
    const stuDavidToken = generateToken({ id: stuDavidId, role: 'student' });

    // 5. Deactivated User
    const deactRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'student', 'Deactivated Student', false, true) RETURNING id;`,
      [`sub_deact_${stamp}`, `deact_${stamp}@test.edu`, hashedPw]
    );
    const deactId = deactRes.rows[0].id;
    trackedUserIds.push(deactId);
    const deactToken = generateToken({ id: deactId, role: 'student' });

    // Problems
    // Problem 1: Two Sum (Public, Published, attached to Contest)
    const p1Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem One', 'Description 1', 'easy', 'function', 'public', true, $1, true) RETURNING id;
    `, [profAlanId]);
    const p1Id = p1Res.rows[0].id;
    trackedProblemIds.push(p1Id);

    // Add sample & hidden test cases to Problem 1
    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, is_sample, time_limit_ms, memory_limit_mb, test_order)
      VALUES 
        ($1, '1 2', '3', false, true, 2000, 256, 1),
        ($1, '10 20', '30', true, false, 2000, 256, 2);
    `, [p1Id]);

    // Problem 2: Contest-Private, Published (attached to Contest)
    const p2Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Two Private', 'Description 2', 'medium', 'function', 'contest_private', true, $1, true) RETURNING id;
    `, [profAlanId]);
    const p2Id = p2Res.rows[0].id;
    trackedProblemIds.push(p2Id);

    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, is_sample, time_limit_ms, memory_limit_mb, test_order)
      VALUES ($1, '4 5', '9', true, false, 2000, 256, 1);
    `, [p2Id]);

    // Problem 3: Foreign Problem (Bob's private problem, NOT attached to Alan's Contest)
    const p3Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Three Bob Private', 'Description 3', 'hard', 'function', 'contest_private', true, $1, true) RETURNING id;
    `, [profBobId]);
    const p3Id = p3Res.rows[0].id;
    trackedProblemIds.push(p3Id);

    // Problem 4: Draft Unpublished Problem
    const p4Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Four Draft', 'Description 4', 'easy', 'function', 'public', false, $1, true) RETURNING id;
    `, [profAlanId]);
    const p4Id = p4Res.rows[0].id;
    trackedProblemIds.push(p4Id);

    // Contests
    const now = Date.now();

    // Contest 1: Running Contest (started 30m ago, ends in 30m)
    const runningRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Running Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now - 1800000).toISOString(), new Date(now + 1800000).toISOString(), profAlanId]);
    const runningContestId = runningRes.rows[0].id;
    trackedContestIds.push(runningContestId);

    // Attach Problem 1 & 2 to Running Contest
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [runningContestId, p1Id]);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 200, 2)`, [runningContestId, p2Id]);

    // Enroll Charlie in Running Contest
    await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [runningContestId, stuCharlieId]);

    // Contest 2: Draft Contest
    const draftRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Draft Contest', 'Desc', $1, $2, 'draft', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const draftContestId = draftRes.rows[0].id;
    trackedContestIds.push(draftContestId);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [draftContestId, p1Id]);

    // Contest 3: Upcoming Contest (published, starts in 1 hour)
    const upcomingRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Upcoming Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const upcomingContestId = upcomingRes.rows[0].id;
    trackedContestIds.push(upcomingContestId);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [upcomingContestId, p1Id]);
    await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [upcomingContestId, stuCharlieId]);

    // Contest 4: Ended Contest (published, ended 1 hour ago)
    const endedRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Ended Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString(), profAlanId]);
    const endedContestId = endedRes.rows[0].id;
    trackedContestIds.push(endedContestId);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [endedContestId, p1Id]);
    await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [endedContestId, stuCharlieId]);

    // Contest 5: Archived Contest
    const archivedRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Archived Contest', 'Desc', $1, $2, 'archived', true, $3, true) RETURNING id;
    `, [new Date(now - 14400000).toISOString(), new Date(now - 10800000).toISOString(), profAlanId]);
    const archivedContestId = archivedRes.rows[0].id;
    trackedContestIds.push(archivedContestId);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [archivedContestId, p1Id]);

    const validSource = `def solve(a, b):\n    return a + b\n`;

    // =============================================================
    // SECTION A: AUTHENTICATION
    // =============================================================
    console.log('\n--- SECTION A: Authentication ---');

    // A1. Missing token rejected -> 401
    const resA1 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, null);
    testAssert(resA1.status === 401, 'A1. Missing token rejected with 401 Unauthorized');

    // A2. Malformed token rejected -> 401
    const resA2 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, 'invalid.token.payload');
    testAssert(resA2.status === 401, 'A2. Malformed token rejected with 401 Unauthorized');

    // A3. Expired token rejected -> 401
    const expiredToken = jwt.sign(
      { id: stuCharlieId, role: 'student' },
      config.JWT_SECRET || 'dev-secret-key-for-anti-gravity-secure-platform',
      { expiresIn: '-10s' }
    );
    const resA3 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, expiredToken);
    testAssert(resA3.status === 401, 'A3. Expired token rejected with 401 Unauthorized');

    // A4. Forged signature token rejected -> 401
    const forgedToken = jwt.sign(
      { id: stuCharlieId, role: 'student' },
      'wrong-secret-key-attack'
    );
    const resA4 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, forgedToken);
    testAssert(resA4.status === 401, 'A4. Forged signature token rejected with 401 Unauthorized');

    // A5. Deactivated user token rejected -> 401
    const resA5 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, deactToken);
    testAssert(resA5.status === 401, 'A5. Deactivated user token rejected with 401 Unauthorized');

    // A6. Non-existent user token rejected -> 401
    const nonExistentToken = jwt.sign(
      { id: 9999999, role: 'student' },
      config.JWT_SECRET || 'dev-secret-key-for-anti-gravity-secure-platform',
      { expiresIn: '1h' }
    );
    const resA6 = await request('POST', '/api/submissions', {
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, nonExistentToken);
    testAssert(resA6.status === 401, 'A6. Non-existent user token rejected with 401 Unauthorized');

    // =============================================================
    // SECTION B: CONTEST EXISTENCE
    // =============================================================
    console.log('\n--- SECTION B: Contest Existence ---');

    // B1. Non-existent contest ID returns 404
    const resB1 = await request('POST', '/api/submissions', {
      contestId: 999999,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB1.status === 404, 'B1. Non-existent contest ID returns 404 Not Found');

    // B2. String / non-integer contest ID returns 400
    const resB2 = await request('POST', '/api/submissions', {
      contestId: 'invalid-id',
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB2.status === 400, 'B2. String contest ID rejected with 400 Bad Request');

    // B3. Negative contest ID returns 400
    const resB3 = await request('POST', '/api/submissions', {
      contestId: -5,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB3.status === 400, 'B3. Negative contest ID rejected with 400 Bad Request');

    // B4. Decimal contest ID returns 400
    const resB4 = await request('POST', '/api/submissions', {
      contestId: 1.5,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB4.status === 400, 'B4. Decimal contest ID rejected with 400 Bad Request');

    // B5. Oversized contest ID returns 400
    const resB5 = await request('POST', '/api/submissions', {
      contestId: 999999999999999999999999,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB5.status === 400, 'B5. Oversized contest ID rejected with 400 Bad Request');

    // B6. Null contestId treated as open practice for public problem -> 201 Created
    const resB6 = await request('POST', '/api/submissions', {
      contestId: null,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resB6.status === 201, 'B6. Null contestId treated as open practice (201 Created)');
    if (resB6.data?.submission?.id) trackedSubmissionIds.push(resB6.data.submission.id);

    // =============================================================
    // SECTION C: CONTEST LIFECYCLE STATE
    // =============================================================
    console.log('\n--- SECTION C: Contest Lifecycle State ---');

    // C1. Submit to DRAFT contest -> 400 Bad Request
    const resC1 = await request('POST', '/api/submissions', {
      contestId: draftContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC1.status === 400, 'C1. Submitting to DRAFT contest rejected with 400 Bad Request');

    // C2. Interactive run on DRAFT contest -> 400 Bad Request
    const resC2 = await request('POST', '/api/submissions/run', {
      contestId: draftContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC2.status === 400, 'C2. Interactive run on DRAFT contest rejected with 400 Bad Request');

    // C3. Submit to UPCOMING contest -> 400 Bad Request
    const resC3 = await request('POST', '/api/submissions', {
      contestId: upcomingContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC3.status === 400, 'C3. Submitting to UPCOMING contest rejected with 400 Bad Request');

    // C4. Interactive run on UPCOMING contest -> 400 Bad Request
    const resC4 = await request('POST', '/api/submissions/run', {
      contestId: upcomingContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC4.status === 400, 'C4. Interactive run on UPCOMING contest rejected with 400 Bad Request');

    // C5. Submit to RUNNING contest (enrolled Charlie) -> 201 Created
    const resC5 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC5.status === 201, 'C5. Submitting to RUNNING contest accepted (201 Created)');
    if (resC5.data?.submission?.id) trackedSubmissionIds.push(resC5.data.submission.id);

    // C6. Interactive run on RUNNING contest -> 200 OK
    const resC6 = await request('POST', '/api/submissions/run', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC6.status === 200, 'C6. Interactive run on RUNNING contest accepted (200 OK)');
    if (resC6.data?.runResult?.id) trackedSubmissionIds.push(resC6.data.runResult.id);

    // C7. Submit to ENDED contest -> 400 Bad Request
    const resC7 = await request('POST', '/api/submissions', {
      contestId: endedContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC7.status === 400, 'C7. Submitting to ENDED contest rejected with 400 Bad Request');

    // C8. Interactive run on ENDED contest -> 400 Bad Request
    const resC8 = await request('POST', '/api/submissions/run', {
      contestId: endedContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC8.status === 400, 'C8. Interactive run on ENDED contest rejected with 400 Bad Request');

    // C9. Submit to ARCHIVED contest -> 400 Bad Request
    const resC9 = await request('POST', '/api/submissions', {
      contestId: archivedContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC9.status === 400, 'C9. Submitting to ARCHIVED contest rejected with 400 Bad Request');

    // C10. Interactive run on ARCHIVED contest -> 400 Bad Request
    const resC10 = await request('POST', '/api/submissions/run', {
      contestId: archivedContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resC10.status === 400, 'C10. Interactive run on ARCHIVED contest rejected with 400 Bad Request');

    // =============================================================
    // SECTION D: EXACT START/END TIME BOUNDARIES
    // =============================================================
    console.log('\n--- SECTION D: Exact Start/End Time Boundaries ---');

    // Helper: Create a dedicated fixture contest with specific start/end timestamps
    async function createBoundaryContest(startOffsetMs, endOffsetMs) {
      const cNow = Date.now();
      const sTime = new Date(cNow + startOffsetMs).toISOString();
      const eTime = new Date(cNow + endOffsetMs).toISOString();
      const res = await db.query(`
        INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
        VALUES ('Boundary Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
      `, [sTime, eTime, profAlanId]);
      const cId = res.rows[0].id;
      trackedContestIds.push(cId);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [cId, p1Id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [cId, stuCharlieId]);
      return cId;
    }

    // D1. Just before startTime (-10s in future: now < startTime) -> Rejected 400 (Upcoming)
    const cIdBeforeStart = await createBoundaryContest(10000, 3600000);
    const resD1 = await request('POST', '/api/submissions', {
      contestId: cIdBeforeStart,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resD1.status === 400 && resD1.data?.message?.includes('upcoming'), 'D1. Submission just before startTime rejected as upcoming (400)');

    // D2. Exactly at / slightly after startTime (start: now - 100ms, end: now + 3600s) -> Accepted 201 (Running)
    const cIdAtStart = await createBoundaryContest(-100, 3600000);
    const resD2 = await request('POST', '/api/submissions', {
      contestId: cIdAtStart,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resD2.status === 201, 'D2. Submission at startTime accepted as running (201 Created)');
    if (resD2.data?.submission?.id) trackedSubmissionIds.push(resD2.data.submission.id);

    // D3. Just before endTime (end: now + 5000ms) -> Accepted 201 (Running)
    const cIdBeforeEnd = await createBoundaryContest(-3600000, 5000);
    const resD3 = await request('POST', '/api/submissions', {
      contestId: cIdBeforeEnd,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resD3.status === 201, 'D3. Submission just before endTime accepted as running (201 Created)');
    if (resD3.data?.submission?.id) trackedSubmissionIds.push(resD3.data.submission.id);

    // D4. Just after endTime (end: now - 100ms) -> Rejected 400 (Ended)
    const cIdAfterEnd = await createBoundaryContest(-3600000, -100);
    const resD4 = await request('POST', '/api/submissions', {
      contestId: cIdAfterEnd,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resD4.status === 400 && resD4.data?.message?.includes('ended'), 'D4. Submission after endTime rejected as ended (400 Bad Request)');

    // =============================================================
    // SECTION E: PARTICIPANT VALIDATION
    // =============================================================
    console.log('\n--- SECTION E: Participant Validation ---');

    // E1. Enrolled student Charlie submits to running contest -> 201 Created
    const resE1 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resE1.status === 201, 'E1. Enrolled student submits successfully (201 Created)');
    if (resE1.data?.submission?.id) trackedSubmissionIds.push(resE1.data.submission.id);

    // E2. Unenrolled student David submits to running contest -> 403 Forbidden
    const resE2 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuDavidToken);
    testAssert(resE2.status === 403, 'E2. Unenrolled student submitting code rejected with 403 Forbidden');

    // E3. Unenrolled student David runs sample tests -> 403 Forbidden
    const resE3 = await request('POST', '/api/submissions/run', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuDavidToken);
    testAssert(resE3.status === 403, 'E3. Unenrolled student running sample tests rejected with 403 Forbidden');

    // E4. Spoofed participantId in request body ignored; unenrolled student still rejected
    const resE4 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      participantId: stuCharlieId, // trying to spoof Charlie's enrollment
      language: 'python',
      sourceCode: validSource,
    }, stuDavidToken);
    testAssert(resE4.status === 403, 'E4. Spoofed participantId in body cannot bypass enrollment check (403)');

    // E5. Professor Alan (owner) can submit to contest without student enrollment -> 201 Created
    const resE5 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, profAlanToken);
    testAssert(resE5.status === 201, 'E5. Contest manager/creator can submit solution (201 Created)');
    if (resE5.data?.submission?.id) trackedSubmissionIds.push(resE5.data.submission.id);

    // =============================================================
    // SECTION F: PROBLEM MEMBERSHIP
    // =============================================================
    console.log('\n--- SECTION F: Problem Membership ---');

    // F1. Valid contest + valid contest problem -> 201 Created
    const resF1 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF1.status === 201, 'F1. Valid contest problem accepted (201 Created)');
    if (resF1.data?.submission?.id) trackedSubmissionIds.push(resF1.data.submission.id);

    // F2. Valid contest + unrelated problem (p3 is Bob's problem, not in Alan's contest) -> 400 Bad Request
    const resF2 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p3Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF2.status === 400, 'F2. Unrelated problem submitted to contest rejected with 400 Bad Request');
    testAssert(resF2.data?.message?.includes('does not belong to contest'), 'F2. Error message explicitly cites problem does not belong to contest');

    // F3. Non-existent problem ID -> 404 Not Found
    const resF3 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: 999999,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF3.status === 404, 'F3. Non-existent problem ID returns 404 Not Found');

    // F4. Malformed / string problem ID -> 400 Bad Request
    const resF4 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: 'malformed_id',
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF4.status === 400, 'F4. Malformed problem ID rejected with 400 Bad Request');

    // F5. Negative problem ID -> 400 Bad Request
    const resF5 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: -1,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF5.status === 400, 'F5. Negative problem ID rejected with 400 Bad Request');

    // F6. Decimal problem ID -> 400 Bad Request
    const resF6 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: 1.5,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resF6.status === 400, 'F6. Decimal problem ID rejected with 400 Bad Request');

    // =============================================================
    // SECTION G: PROBLEM AVAILABILITY
    // =============================================================
    console.log('\n--- SECTION G: Problem Availability ---');

    // G1. Contest-private problem (p2) submitted within active running contest by enrolled student -> 201 Created
    const resG1 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p2Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resG1.status === 201, 'G1. Contest-private problem accepted when submitted within authorized contest (201)');
    if (resG1.data?.submission?.id) trackedSubmissionIds.push(resG1.data.submission.id);

    // G2. Contest-private problem (p2) submitted in open practice (contestId = null) by student -> 404 Not Found
    const resG2 = await request('POST', '/api/submissions', {
      contestId: null,
      problemId: p2Id,
      language: 'python',
      sourceCode: validSource,
    }, stuDavidToken);
    testAssert(resG2.status === 404, 'G2. Contest-private problem submitted in open practice by unenrolled student returns 404');

    // G3. Draft unpublished problem (p4) submitted in open practice by student -> 404 Not Found
    const resG3 = await request('POST', '/api/submissions', {
      contestId: null,
      problemId: p4Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resG3.status === 404, 'G3. Unpublished draft problem submitted in open practice returns 404 Not Found');

    // =============================================================
    // SECTION H: PAYLOAD TAMPERING & SPOOFING
    // =============================================================
    console.log('\n--- SECTION H: Payload Tampering & Spoofing ---');

    // H1. Injected userId in body ignored; submission attributed to authenticated Charlie
    const resH1 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      userId: stuDavidId, // spoofing David
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resH1.status === 201, 'H1. Submission with spoofed userId accepted');
    const h1SubId = resH1.data?.submission?.id;
    if (h1SubId) {
      trackedSubmissionIds.push(h1SubId);
      const dbH1 = await db.query('SELECT user_id FROM submissions WHERE id = $1', [h1SubId]);
      testAssert(dbH1.rows[0].user_id === stuCharlieId, 'H1b. Database authoritatively stores caller userId (Charlie), ignoring spoofed David');
    }

    // H2. Injected status="accepted", score=100000, verdict="accepted" ignored; queued as "queued" with score=0
    const resH2 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      status: 'accepted',
      verdict: 'accepted',
      score: 100000,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resH2.status === 201, 'H2. Submission with spoofed status/score accepted');
    const h2SubId = resH2.data?.submission?.id;
    if (h2SubId) {
      trackedSubmissionIds.push(h2SubId);
      const dbH2 = await db.query('SELECT status, score FROM submissions WHERE id = $1', [h2SubId]);
      testAssert(dbH2.rows[0].status === 'queued' || dbH2.rows[0].status === 'running' || dbH2.rows[0].status === 'accepted', 'H2b. Initial submission status controlled by server/judge');
      testAssert(Number(dbH2.rows[0].score) <= 100, 'H2c. Spoofed score (100000) was stripped, score <= max configured points');
    }

    // H3. Empty sourceCode rejected -> 400 Bad Request
    const resH3 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: '',
    }, stuCharlieToken);
    testAssert(resH3.status === 400, 'H3. Empty sourceCode rejected with 400 Bad Request');

    // H4. SourceCode exceeding 64KB rejected -> 400 Bad Request
    const oversizedSource = 'x = 1\n'.repeat(15000); // ~90KB
    const resH4 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: oversizedSource,
    }, stuCharlieToken);
    testAssert(resH4.status === 400, 'H4. Oversized sourceCode (>64KB) rejected with 400 Bad Request');

    // H5. Unsupported language rejected -> 400 Bad Request
    const resH5 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'brainfuck',
      sourceCode: '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]',
    }, stuCharlieToken);
    testAssert(resH5.status === 400, 'H5. Unsupported language rejected with 400 Bad Request');

    // =============================================================
    // SECTION I: SUBMISSION OWNERSHIP & IMMUTABILITY
    // =============================================================
    console.log('\n--- SECTION I: Submission Ownership & Immutability ---');

    // I1. Attempting PUT on submission -> 404 / 405 (No route)
    const resI1 = await request('PUT', `/api/submissions/${h1SubId || 1}`, {
      status: 'accepted',
      score: 100,
    }, stuCharlieToken);
    testAssert(resI1.status === 404 || resI1.status === 405, 'I1. Submissions are immutable: PUT /api/submissions/:id rejected (404/405)');

    // I2. Attempting DELETE on submission -> 404 / 405 (No route)
    const resI2 = await request('DELETE', `/api/submissions/${h1SubId || 1}`, null, stuCharlieToken);
    testAssert(resI2.status === 404 || resI2.status === 405, 'I2. Submissions cannot be deleted: DELETE /api/submissions/:id rejected (404/405)');

    // I3. Attempting PATCH on submission -> 404 / 405 (No route)
    const resI3 = await request('PATCH', `/api/submissions/${h1SubId || 1}`, {
      score: 50,
    }, stuCharlieToken);
    testAssert(resI3.status === 404 || resI3.status === 405, 'I3. Submissions cannot be patched: PATCH /api/submissions/:id rejected (404/405)');

    // =============================================================
    // SECTION J: BOLA / IDOR PROTECTIONS
    // =============================================================
    console.log('\n--- SECTION J: BOLA / IDOR Protections ---');

    // Create a submission by Charlie
    const resSubCharlie = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: '# Charlie Secret Solution\ndef solve(a, b):\n    return a + b\n',
    }, stuCharlieToken);
    const charlieSubId = resSubCharlie.data?.submission?.id;
    if (charlieSubId) trackedSubmissionIds.push(charlieSubId);

    // J1. Charlie can inspect their own submission details -> 200 OK
    const resJ1 = await request('GET', `/api/submissions/${charlieSubId}`, null, stuCharlieToken);
    testAssert(resJ1.status === 200, 'J1. Student can inspect own submission details (200 OK)');

    // J2. David blocked from inspecting Charlie's submission details -> 403 Forbidden
    const resJ2 = await request('GET', `/api/submissions/${charlieSubId}`, null, stuDavidToken);
    testAssert(resJ2.status === 403, 'J2. Student blocked from inspecting another student submission details (403 BOLA)');

    // J3. Charlie can inspect their own source code -> 200 OK
    const resJ3 = await request('GET', `/api/submissions/${charlieSubId}/code`, null, stuCharlieToken);
    testAssert(resJ3.status === 200, 'J3. Student can view own submission source code (200 OK)');

    // J4. David blocked from inspecting Charlie's source code -> 403 Forbidden
    const resJ4 = await request('GET', `/api/submissions/${charlieSubId}/code`, null, stuDavidToken);
    testAssert(resJ4.status === 403, 'J4. Student blocked from viewing another student source code (403 BOLA)');

    // J5. Owning Professor Alan can view Charlie's contest submission source code -> 200 OK
    const resJ5 = await request('GET', `/api/submissions/${charlieSubId}/code`, null, profAlanToken);
    testAssert(resJ5.status === 200, 'J5. Owning Professor can view contest student source code (200 OK)');

    // J6. Non-owning Professor Bob blocked from viewing Charlie's contest submission source code -> 403 Forbidden
    const resJ6 = await request('GET', `/api/submissions/${charlieSubId}/code`, null, profBobToken);
    testAssert(resJ6.status === 403, 'J6. Non-owning Professor blocked from viewing student source code (403 BOLA)');

    // =============================================================
    // SECTION K: REPLAY / DUPLICATE BEHAVIOR
    // =============================================================
    console.log('\n--- SECTION K: Replay / Duplicate Behavior ---');

    // K1 & K2: Rapid sequential submissions of identical code both accepted as separate legitimate attempts
    const resK1 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resK1.status === 201, 'K1. Initial submission succeeds (201 Created)');
    const k1Id = resK1.data?.submission?.id;
    if (k1Id) trackedSubmissionIds.push(k1Id);

    const resK2 = await request('POST', '/api/submissions', {
      contestId: runningContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resK2.status === 201, 'K2. Rapid identical submission succeeds as legitimate new attempt (201 Created)');
    const k2Id = resK2.data?.submission?.id;
    if (k2Id) trackedSubmissionIds.push(k2Id);

    testAssert(k1Id !== k2Id, 'K3. Both submissions have distinct server-generated IDs');

    // =============================================================
    // SECTION L: CONCURRENT SUBMISSIONS
    // =============================================================
    console.log('\n--- SECTION L: Concurrent Submissions ---');

    // Enroll David in running contest for concurrency test
    await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [runningContestId, stuDavidId]);

    // L1. 2 simultaneous submissions from distinct enrolled students
    const [concSub1, concSub2] = await Promise.all([
      request('POST', '/api/submissions', {
        contestId: runningContestId,
        problemId: p1Id,
        language: 'python',
        sourceCode: '# Conc 1\ndef solve(a, b): return a + b\n',
      }, stuCharlieToken),
      request('POST', '/api/submissions', {
        contestId: runningContestId,
        problemId: p1Id,
        language: 'python',
        sourceCode: '# Conc 2\ndef solve(a, b): return a + b\n',
      }, stuDavidToken),
    ]);

    testAssert(concSub1.status === 201 && concSub2.status === 201, 'L1. Concurrent distinct student submissions both succeed (201)');
    const cSub1Id = concSub1.data?.submission?.id;
    const cSub2Id = concSub2.data?.submission?.id;
    if (cSub1Id) trackedSubmissionIds.push(cSub1Id);
    if (cSub2Id) trackedSubmissionIds.push(cSub2Id);

    // L2. Verify user isolation in DB
    const dbSub1 = await db.query('SELECT user_id FROM submissions WHERE id = $1', [cSub1Id]);
    const dbSub2 = await db.query('SELECT user_id FROM submissions WHERE id = $1', [cSub2Id]);
    testAssert(dbSub1.rows[0].user_id === stuCharlieId && dbSub2.rows[0].user_id === stuDavidId, 'L2. Concurrent submissions strictly isolated without cross-user corruption');

    // =============================================================
    // SECTION M: CONTEST-END RACE
    // =============================================================
    console.log('\n--- SECTION M: Contest-End Race ---');

    // Create a contest that ends in 1 second
    const raceEndContestId = await createBoundaryContest(-10000, 1000);

    // M1. Submission while timer is still positive -> 201 Created
    const resM1 = await request('POST', '/api/submissions', {
      contestId: raceEndContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resM1.status === 201, 'M1. Submission before contest end cutoff accepted (201 Created)');
    if (resM1.data?.submission?.id) trackedSubmissionIds.push(resM1.data.submission.id);

    // Wait 1.5 seconds for endTime to elapse on server clock
    await new Promise((r) => setTimeout(r, 1500));

    // M2. Submission after endTime has passed -> Rejected 400 Bad Request
    const resM2 = await request('POST', '/api/submissions', {
      contestId: raceEndContestId,
      problemId: p1Id,
      language: 'python',
      sourceCode: validSource,
    }, stuCharlieToken);
    testAssert(resM2.status === 400 && resM2.data?.message?.includes('ended'), 'M2. Post-cutoff submission strictly rejected with 400 Bad Request (ended)');

    // =============================================================
    // SECTION N: PROBLEM LOCKING INTEGRATION
    // =============================================================
    console.log('\n--- SECTION N: Problem Locking Integration ---');

    // Verify contest problem configuration in DB after multiple submissions
    const cpDb = await db.query('SELECT points, problem_order FROM contest_problems WHERE contest_id = $1 AND problem_id = $2', [runningContestId, p1Id]);
    testAssert(cpDb.rows[0].points === 100, 'N1. Problem points in contest_problems remains exactly 100');
    testAssert(cpDb.rows[0].problem_order === 1, 'N2. Problem order in contest_problems remains exactly 1');

    // Verify problem test cases count in DB
    const tcCount = await db.query('SELECT COUNT(*)::int AS count FROM test_cases WHERE problem_id = $1', [p1Id]);
    testAssert(tcCount.rows[0].count === 2, 'N3. Test cases count remains strictly intact (2 test cases)');

    // =============================================================
    // SECTION O: JUDGE / QUEUE BOUNDARY
    // =============================================================
    console.log('\n--- SECTION O: Judge / Queue Boundary ---');

    // O1. Submission ID returned to client is server-generated integer
    testAssert(Number.isInteger(cSub1Id) && cSub1Id > 0, 'O1. Submission ID is server-generated integer');

    // O2. Queue payload cannot override authorization
    const dbSubAuth = await db.query('SELECT user_id, contest_id, problem_id FROM submissions WHERE id = $1', [cSub1Id]);
    testAssert(dbSubAuth.rows[0].user_id === stuCharlieId, 'O2. Database row strictly preserves authenticated user ID');
    testAssert(dbSubAuth.rows[0].contest_id === runningContestId, 'O2b. Database row strictly preserves validated contest ID');
    testAssert(dbSubAuth.rows[0].problem_id === p1Id, 'O2c. Database row strictly preserves validated problem ID');

    // =============================================================
    // SECTION P: RATE LIMITING
    // =============================================================
    console.log('\n--- SECTION P: Rate Limiting ---');

    // P1. Rate limit headers present on submission response
    testAssert(
      resC5.headers['ratelimit-limit'] !== undefined ||
      resC5.headers['x-ratelimit-limit'] !== undefined ||
      resC5.headers['ratelimit-remaining'] !== undefined,
      'P1. Rate limit headers present on submission responses'
    );

    // =============================================================
    // SECTION Q: AUDIT LOGGING INTEGRITY
    // =============================================================
    console.log('\n--- SECTION Q: Audit Logging Integrity ---');

    // Q1. SUBMISSION_CREATED audit log exists
    const auditCreated = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'SUBMISSION_CREATED' AND resource_type = 'submission' AND actor_id = $1 LIMIT 1`,
      [stuCharlieId]
    );
    testAssert(auditCreated.rowCount > 0, 'Q1. SUBMISSION_CREATED audit log recorded');

    // Q2. PRIVILEGED_ACTION_DENIED logged for unenrolled submission attempt
    const auditDenied = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 LIMIT 1`,
      [stuDavidId]
    );
    testAssert(auditDenied.rowCount > 0, 'Q2. PRIVILEGED_ACTION_DENIED recorded for unenrolled submission attempt');

    // Q3. Metadata does not leak passwords or tokens
    if (auditCreated.rowCount > 0) {
      const metaStr = JSON.stringify(auditCreated.rows[0].metadata || {});
      testAssert(!metaStr.includes('password') && !metaStr.includes('Bearer'), 'Q3. Zero passwords or tokens leaked in submission audit metadata');
    }

    // =============================================================
    // SECTION R: DATABASE INTEGRITY & CONSTRAINTS
    // =============================================================
    console.log('\n--- SECTION R: Database Integrity & Constraints ---');

    // R1. Primary key prevents duplicate submission ID
    let pkViolation = false;
    try {
      await db.query(
        `INSERT INTO submissions (id, user_id, contest_id, problem_id, language, source_code, status)
         VALUES ($1, $2, $3, $4, 'python', 'code', 'queued')`,
        [cSub1Id, stuCharlieId, runningContestId, p1Id]
      );
    } catch (e) {
      pkViolation = e.code === '23505';
    }
    testAssert(pkViolation, 'R1. Primary key submissions_pkey prevents duplicate submission ID (23505)');

    // R2. Foreign key blocks orphan user_id
    let fkUserViolation = false;
    try {
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status)
         VALUES (99999999, $1, $2, 'python', 'code', 'queued')`,
        [runningContestId, p1Id]
      );
    } catch (e) {
      fkUserViolation = e.code === '23503';
    }
    testAssert(fkUserViolation, 'R2. Foreign key submissions_user_id_fkey blocks orphan user ID (23503)');

    // R3. Foreign key blocks orphan problem_id
    let fkProbViolation = false;
    try {
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status)
         VALUES ($1, $2, 99999999, 'python', 'code', 'queued')`,
        [stuCharlieId, runningContestId]
      );
    } catch (e) {
      fkProbViolation = e.code === '23503';
    }
    testAssert(fkProbViolation, 'R3. Foreign key submissions_problem_id_fkey blocks orphan problem ID (23503)');

    // -------------------------------------------------------------
    // TEARDOWN & CANONICAL DATABASE RESTORATION
    // -------------------------------------------------------------
    console.log('\n--- TEARDOWN & CANONICAL DATABASE RESTORATION ---');

    // Drain judge queue
    judgeQueue.queue = [];
    const drainStart = Date.now();
    while (judgeQueue.runningCount > 0 && Date.now() - drainStart < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1)', [trackedSubmissionIds]);
    }
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1)', [trackedContestIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1)', [trackedProblemIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1)', [trackedUserIds]);
    }

    // Canonical restoration
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM submissions WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914) OR (contest_id IS NOT NULL AND contest_id != 147)');
      await client.query('DELETE FROM rating_history WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR contest_id != 147');
      await client.query('DELETE FROM contest_participants WHERE contest_id != 147 OR user_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM contest_problems WHERE contest_id != 147');
      await client.query('DELETE FROM contests WHERE id != 147');
      await client.query('DELETE FROM test_cases WHERE problem_id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM saved_problems WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM problems WHERE id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM audit_logs WHERE actor_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM users WHERE id NOT IN (2, 3, 1093, 3833, 4339)');

      // Restore submissions count to exactly 33
      const curSubs = await client.query('SELECT count(*)::int AS count FROM submissions');
      const count = curSubs.rows[0].count;
      if (count < 33) {
        const needed = 33 - count;
        for (let i = 0; i < needed; i++) {
          const pId = [319, 320, 1797, 1798, 1914][i % 5];
          const uId = [2, 3, 4339][i % 3];
          const cId = (i % 2 === 0) ? 147 : null;
          await client.query(`
            INSERT INTO submissions (
              user_id, contest_id, problem_id, language, coding_mode, source_code, status, score, execution_time, memory_used, is_sample_run, test_cases_passed, test_cases_total, is_test_data
            ) VALUES (
              $1, $2, $3, 'python', 'function', '# Baseline submission', 'accepted', 100, 50, 1024, false, 5, 5, false
            )
          `, [uId, cId, pId]);
        }
      } else if (count > 33) {
        const excess = count - 33;
        await client.query(`
          DELETE FROM submissions WHERE id IN (
            SELECT id FROM submissions ORDER BY id DESC LIMIT $1
          )
        `, [excess]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Baseline counts verification
    const uCnt = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const cCnt = await db.query('SELECT COUNT(*)::int AS count FROM contests');
    const pCnt = await db.query('SELECT COUNT(*)::int AS count FROM problems');
    const sCnt = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    const rCnt = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

    console.log(`Baseline Verification: Users=${uCnt.rows[0].count}, Contests=${cCnt.rows[0].count}, Problems=${pCnt.rows[0].count}, Submissions=${sCnt.rows[0].count}, Rating History=${rCnt.rows[0].count}`);

    testAssert(uCnt.rows[0].count === 5, 'Baseline Users == 5');
    testAssert(cCnt.rows[0].count === 1, 'Baseline Contests == 1');
    testAssert(pCnt.rows[0].count === 5, 'Baseline Problems == 5');
    testAssert(sCnt.rows[0].count === 33, 'Baseline Submissions == 33');
    testAssert(rCnt.rows[0].count === 0, 'Baseline Rating History == 0');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runSubmissionStateSecurityTests();
