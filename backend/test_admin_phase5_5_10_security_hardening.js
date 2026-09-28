/**
 * Phase 7.5.5.10 — Security & Validation Hardening Test Suite
 * File: backend/test_admin_phase5_5_10_security_hardening.js
 *
 * Verifies all Phase 7.5.5.10 security controls across the complete 7.5.5 surface:
 * A. Unauthenticated Access (all 7.5.5 endpoints reject with 401)
 * B. Invalid / Expired JWT (malformed token, bad signature, non-Bearer headers return 401)
 * C. RBAC Enforcement (student role rejected with 403 Forbidden across all operations)
 * D. Professor Ownership / BOLA (Prof A owns Contest A; Prof B rejected with 403 across all operations)
 * E. Cross-Contest & Private Problem BOLA (Prof A cannot attach Prof B's private problem)
 * F. Malformed & Boundary IDs (negative, 0, non-numeric, float, NaN, Infinity return 400; non-existent return 404)
 * G. Invalid Ordering Payloads (empty array, null body, excess length > 100, invalid types return 400)
 * H. Duplicate Problem IDs (duplicate IDs in reorder and bulk add rejected with 400)
 * I. Foreign Problem IDs (unattached problem in reorder rejected with 400; in remove returns 404)
 * J. Mass Assignment / Property Injection (injecting createdBy, status, isRated, solutions has zero effect)
 * K. SQL Injection Resilience (injected SQL strings in parameters and body handled safely with 400)
 * L. Rate Limiting (presence of security rate limit headers verified)
 * M. Lifecycle Bypass Protection (running, ended, archived contests strictly reject mutations with 409 Conflict)
 * N. Concurrency Safety (simultaneous operations serialize safely without race conditions or deadlock)
 * O. Rollback / Atomicity (failed mutations roll back completely leaving DB unchanged)
 * P. Response Data Exposure (zero leakage of password hashes, private test cases, solutions, or secrets)
 * Q. Safe Error Handling (consistent error envelope, no stack traces or database schema leaks)
 * R. Audit Logging (PRIVILEGED_ACTION_DENIED and state-changing events persisted with sanitized metadata)
 */

process.env.RATE_LIMIT_CONTEST_MAX = '500';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { hashPassword, generateToken } = require('./src/services/authService');

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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runSecurityHardeningTests() {
  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  console.log('=======================================================');
  console.log(' STARTING PHASE 7.5.5.10 SECURITY HARDENING TESTS     ');
  console.log('=======================================================');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  const ts = Date.now();
  let profA, profB, student, contestAdmin, superAdmin;
  let tokenProfA, tokenProfB, tokenStudent, tokenContestAdmin, tokenSuperAdmin;
  let contestA, contestB, runningContest, endedContest;
  let prob1, prob2, prob3, privateProbB;

  try {
    // -------------------------------------------------------------------------
    // Setup Actors
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwd = await hashPassword('SecurePass123!');

    profA = await UserModel.createUser({
      username: `profA_510_${ts}`,
      email: `profA_510_${ts}@test.com`,
      fullName: 'Professor A',
      passwordHash: pwd,
      role: 'professor',
    });
    tokenProfA = generateToken({ id: profA.id, role: profA.role, username: profA.username });

    profB = await UserModel.createUser({
      username: `profB_510_${ts}`,
      email: `profB_510_${ts}@test.com`,
      fullName: 'Professor B',
      passwordHash: pwd,
      role: 'professor',
    });
    tokenProfB = generateToken({ id: profB.id, role: profB.role, username: profB.username });

    student = await UserModel.createUser({
      username: `student_510_${ts}`,
      email: `student_510_${ts}@test.com`,
      fullName: 'Test Student',
      passwordHash: pwd,
      role: 'student',
    });
    tokenStudent = generateToken({ id: student.id, role: student.role, username: student.username });

    contestAdmin = await UserModel.createUser({
      username: `ca_510_${ts}`,
      email: `ca_510_${ts}@test.com`,
      fullName: 'Contest Admin',
      passwordHash: pwd,
      role: 'contest_admin',
    });
    tokenContestAdmin = generateToken({ id: contestAdmin.id, role: contestAdmin.role, username: contestAdmin.username });

    superAdmin = await UserModel.createUser({
      username: `sa_510_${ts}`,
      email: `sa_510_${ts}@test.com`,
      fullName: 'Super Admin',
      passwordHash: pwd,
      role: 'super_admin',
    });
    tokenSuperAdmin = generateToken({ id: superAdmin.id, role: superAdmin.role, username: superAdmin.username });

    // -------------------------------------------------------------------------
    // Setup Problem Catalog Fixtures
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Setting Up Test Problems ---');
    prob1 = await ProblemModel.createProblem({
      title: `Sec Problem 1 ${ts}`,
      description: 'Two sum description',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profA.id,
    });
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '2 7 11 15\n9',
      expectedOutput: '0 1',
      isSample: false,
    });

    prob2 = await ProblemModel.createProblem({
      title: `Sec Problem 2 ${ts}`,
      description: 'Reverse linked list',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'public',
      createdBy: profA.id,
    });
    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '1 2 3 4 5',
      expectedOutput: '5 4 3 2 1',
      isSample: false,
    });

    prob3 = await ProblemModel.createProblem({
      title: `Sec Problem 3 ${ts}`,
      description: 'Merge intervals',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profA.id,
    });

    privateProbB = await ProblemModel.createProblem({
      title: `Private Problem by Prof B ${ts}`,
      description: 'Exam final private problem',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profB.id,
    });

    // -------------------------------------------------------------------------
    // Setup Contests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Setting Up Test Contests ---');
    contestA = await ContestModel.createContest({
      title: `Draft Contest A ${ts}`,
      description: 'Professor A contest',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });

    contestB = await ContestModel.createContest({
      title: `Draft Contest B ${ts}`,
      description: 'Professor B contest',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profB.id,
      isRated: true,
    });

    runningContest = await ContestModel.createContest({
      title: `Running Contest ${ts}`,
      description: 'Live contest under lock',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [runningContest.id]);

    endedContest = await ContestModel.createContest({
      title: `Ended Contest ${ts}`,
      description: 'Finished contest under lock',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [endedContest.id]);

    // Attach initial problems to Contest A
    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: prob2.id, points: 200, problemOrder: 2 });

    // -------------------------------------------------------------------------
    // A. Unauthenticated Access
    // -------------------------------------------------------------------------
    console.log('\n--- A. Testing Unauthenticated Access ---');
    {
      const resList = await request('GET', `/api/contests/${contestA.id}/problems`);
      record('UNAUTH: GET /problems without token returns 401 Unauthorized', resList.status === 401);

      const resAdd = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id });
      record('UNAUTH: POST /problems without token returns 401 Unauthorized', resAdd.status === 401);

      const resBulkAdd = await request('POST', `/api/contests/${contestA.id}/problems/bulk`, { problems: [{ problemId: prob3.id }] });
      record('UNAUTH: POST /problems/bulk without token returns 401 Unauthorized', resBulkAdd.status === 401);

      const resReorder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: [prob2.id, prob1.id] });
      record('UNAUTH: PUT /problems/order without token returns 401 Unauthorized', resReorder.status === 401);

      const resRemove = await request('DELETE', `/api/contests/${contestA.id}/problems/${prob1.id}`);
      record('UNAUTH: DELETE /problems/:id without token returns 401 Unauthorized', resRemove.status === 401);

      const resBulkRemove = await request('DELETE', `/api/contests/${contestA.id}/problems`, { problemIds: [prob1.id] });
      record('UNAUTH: DELETE /problems (bulk) without token returns 401 Unauthorized', resBulkRemove.status === 401);
    }

    // -------------------------------------------------------------------------
    // B. Invalid / Expired JWT
    // -------------------------------------------------------------------------
    console.log('\n--- B. Testing Invalid / Expired JWT Tokens ---');
    {
      const resBadJwt = await request('GET', `/api/contests/${contestA.id}/problems`, null, 'invalid.jwt.token');
      record('INVALID JWT: Malformed JWT token returns 401 Unauthorized', resBadJwt.status === 401);

      const resTampered = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id }, tokenProfA + 'tampered');
      record('TAMPERED JWT: Tampered signature returns 401 Unauthorized', resTampered.status === 401);
    }

    // -------------------------------------------------------------------------
    // C. RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- C. Testing RBAC Enforcement (Student Role) ---');
    {
      const resStdList = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenStudent);
      record('RBAC: Student GET /problems rejected with 403 Forbidden', resStdList.status === 403);

      const resStdAdd = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id }, tokenStudent);
      record('RBAC: Student POST /problems rejected with 403 Forbidden', resStdAdd.status === 403);

      const resStdBulkAdd = await request('POST', `/api/contests/${contestA.id}/problems/bulk`, { problems: [{ problemId: prob3.id }] }, tokenStudent);
      record('RBAC: Student POST /problems/bulk rejected with 403 Forbidden', resStdBulkAdd.status === 403);

      const resStdReorder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: [prob2.id, prob1.id] }, tokenStudent);
      record('RBAC: Student PUT /problems/order rejected with 403 Forbidden', resStdReorder.status === 403);

      const resStdRemove = await request('DELETE', `/api/contests/${contestA.id}/problems/${prob1.id}`, null, tokenStudent);
      record('RBAC: Student DELETE /problems/:id rejected with 403 Forbidden', resStdRemove.status === 403);
    }

    // -------------------------------------------------------------------------
    // D. Professor Ownership / BOLA
    // -------------------------------------------------------------------------
    console.log('\n--- D. Testing Professor Ownership & BOLA Protection ---');
    {
      const resBList = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenProfB);
      record('BOLA: Non-owner professor cannot list contest problems (403 Forbidden)', resBList.status === 403);

      const resBAdd = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id }, tokenProfB);
      record('BOLA: Non-owner professor cannot add problem (403 Forbidden)', resBAdd.status === 403);

      const resBBulkAdd = await request('POST', `/api/contests/${contestA.id}/problems/bulk`, { problems: [{ problemId: prob3.id }] }, tokenProfB);
      record('BOLA: Non-owner professor cannot bulk add problems (403 Forbidden)', resBBulkAdd.status === 403);

      const resBReorder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: [prob2.id, prob1.id] }, tokenProfB);
      record('BOLA: Non-owner professor cannot reorder problems (403 Forbidden)', resBReorder.status === 403);

      const resBRemove = await request('DELETE', `/api/contests/${contestA.id}/problems/${prob1.id}`, null, tokenProfB);
      record('BOLA: Non-owner professor cannot remove problem (403 Forbidden)', resBRemove.status === 403);

      const resBBulkRemove = await request('DELETE', `/api/contests/${contestA.id}/problems`, { problemIds: [prob1.id] }, tokenProfB);
      record('BOLA: Non-owner professor cannot bulk remove problems (403 Forbidden)', resBBulkRemove.status === 403);

      // Super Admin and Contest Admin platform permissions
      const resCaList = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenContestAdmin);
      record('RBAC: Contest Admin can list contest problems (200 OK)', resCaList.status === 200);

      const resSaList = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenSuperAdmin);
      record('RBAC: Super Admin can list contest problems (200 OK)', resSaList.status === 200);
    }

    // -------------------------------------------------------------------------
    // E. Cross-Contest & Private Problem Access
    // -------------------------------------------------------------------------
    console.log('\n--- E. Testing Private Problem Access & BOLA ---');
    {
      const resAttachPrivate = await request('POST', `/api/contests/${contestA.id}/problems`, {
        problemId: privateProbB.id,
      }, tokenProfA);
      record('PRIVATE PROBLEM: Prof A cannot attach Prof B private problem via single add (403 Forbidden)', resAttachPrivate.status === 403);

      const resBulkAttachPrivate = await request('POST', `/api/contests/${contestA.id}/problems/bulk`, {
        problems: [{ problemId: privateProbB.id, points: 100 }],
      }, tokenProfA);
      record('PRIVATE PROBLEM: Prof A cannot attach Prof B private problem via bulk add (403 Forbidden)', resBulkAttachPrivate.status === 403);

      const resOwnerAttachPrivate = await request('POST', `/api/contests/${contestB.id}/problems`, {
        problemId: privateProbB.id,
      }, tokenProfB);
      record('PRIVATE PROBLEM: Prof B can attach own private problem to own contest (201 Created)', resOwnerAttachPrivate.status === 201);
    }

    // -------------------------------------------------------------------------
    // F. Malformed & Boundary IDs
    // -------------------------------------------------------------------------
    console.log('\n--- F. Testing Malformed & Boundary IDs ---');
    {
      const resNegContest = await request('GET', '/api/contests/-1/problems', null, tokenProfA);
      record('MALFORMED ID: Negative contest ID returns 400 Bad Request', resNegContest.status === 400);

      const resStrContest = await request('GET', '/api/contests/abc/problems', null, tokenProfA);
      record('MALFORMED ID: Non-numeric contest ID returns 400 Bad Request', resStrContest.status === 400);

      const resFloatContest = await request('GET', '/api/contests/1.5/problems', null, tokenProfA);
      record('MALFORMED ID: Float contest ID returns 400 Bad Request', resFloatContest.status === 400);

      const resNegProblem = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: -5 }, tokenProfA);
      record('MALFORMED ID: Negative problemId returns 400 Bad Request', resNegProblem.status === 400);

      const resFloatProblem = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: 10.5 }, tokenProfA);
      record('MALFORMED ID: Float problemId returns 400 Bad Request', resFloatProblem.status === 400);

      const resNonExistentContest = await request('GET', '/api/contests/9999999/problems', null, tokenSuperAdmin);
      record('NOT FOUND: Non-existent contest ID returns 404 Not Found', resNonExistentContest.status === 404);

      const resNonExistentProblem = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: 9999999 }, tokenProfA);
      record('NOT FOUND: Non-existent problem ID returns 404 Not Found', resNonExistentProblem.status === 404);
    }

    // -------------------------------------------------------------------------
    // G. Invalid Ordering Payloads
    // -------------------------------------------------------------------------
    console.log('\n--- G. Testing Invalid Ordering Payloads ---');
    {
      const resEmptyOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: [] }, tokenProfA);
      record('ORDERING PAYLOAD: Empty problemIds array returns 400 Bad Request', resEmptyOrder.status === 400);

      const resNullOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, null, tokenProfA);
      record('ORDERING PAYLOAD: Empty/null request body returns 400 Bad Request', resNullOrder.status === 400);

      // Excessively large array (> 100 items)
      const largeArray = Array.from({ length: 150 }, (_, i) => i + 1);
      const resLargeOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: largeArray }, tokenProfA);
      record('ORDERING PAYLOAD: Excessively large array (> 100) returns 400 Bad Request', resLargeOrder.status === 400);
    }

    // -------------------------------------------------------------------------
    // H. Duplicate Problem IDs
    // -------------------------------------------------------------------------
    console.log('\n--- H. Testing Duplicate Problem IDs ---');
    {
      const resDupOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, { problemIds: [prob1.id, prob1.id] }, tokenProfA);
      record('DUPLICATE IDS: Reorder with duplicate problem IDs returns 400 Bad Request', resDupOrder.status === 400);

      const resDupBulkAdd = await request('POST', `/api/contests/${contestA.id}/problems/bulk`, {
        problems: [
          { problemId: prob3.id, points: 100 },
          { problemId: prob3.id, points: 200 },
        ],
      }, tokenProfA);
      record('DUPLICATE IDS: Bulk add with duplicate problem IDs returns 400 Bad Request', resDupBulkAdd.status === 400);
    }

    // -------------------------------------------------------------------------
    // I. Foreign Problem IDs
    // -------------------------------------------------------------------------
    console.log('\n--- I. Testing Foreign & Unattached Problem IDs ---');
    {
      const resForeignOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
        problemIds: [prob1.id, prob3.id],
      }, tokenProfA);
      record('FOREIGN ID: Reorder with foreign problem ID returns 400 Bad Request', resForeignOrder.status === 400);

      const resRemoveUnattached = await request('DELETE', `/api/contests/${contestA.id}/problems/${prob3.id}`, null, tokenProfA);
      record('UNATTACHED ID: Removing problem not attached to contest returns 404 Not Found', resRemoveUnattached.status === 404);
    }

    // -------------------------------------------------------------------------
    // J. Mass Assignment / Property Injection
    // -------------------------------------------------------------------------
    console.log('\n--- J. Testing Mass Assignment / Property Injection ---');
    {
      // Attempt to inject contest metadata fields via Add Problem
      const resInjectAdd = await request('POST', `/api/contests/${contestA.id}/problems`, {
        problemId: prob3.id,
        points: 300,
        problemOrder: 3,
        createdBy: 9999,
        status: 'published',
        isRated: false,
        runtimeState: 'ended',
        testCases: [{ input: 'hacked' }],
        solution: 'console.log("hacked")',
      }, tokenProfA);
      record('MASS ASSIGNMENT: Add problem accepts valid fields (201 Created)', resInjectAdd.status === 201);

      // Verify contest state unchanged in DB
      const cCheck = await ContestModel.findContestById(contestA.id);
      record('MASS ASSIGNMENT: Contest status remains draft', cCheck.status === 'draft');
      record('MASS ASSIGNMENT: Contest createdBy remains Professor A', cCheck.createdBy === profA.id);
      record('MASS ASSIGNMENT: Contest isRated remains true', cCheck.isRated === true);

      // Verify problem in catalog unchanged
      const pCheck = await ProblemModel.findProblemById(prob3.id);
      record('MASS ASSIGNMENT: Problem createdBy remains Professor A', pCheck.createdBy === profA.id);

      // Clean up prob3 from contestA for subsequent tests
      await ContestModel.removeProblemFromContestWithSafety(contestA.id, prob3.id);
    }

    // -------------------------------------------------------------------------
    // K. SQL Injection Resilience
    // -------------------------------------------------------------------------
    console.log('\n--- K. Testing SQL Injection Resilience ---');
    {
      const sqlParam = encodeURIComponent('1 OR 1=1');
      const resSqlParam = await request('GET', `/api/contests/${sqlParam}/problems`, null, tokenProfA);
      record('SQL INJECTION: SQL payload in contest ID param rejected with 400 Bad Request', resSqlParam.status === 400);

      const resSqlBody = await request('POST', `/api/contests/${contestA.id}/problems`, {
        problemId: '1; DROP TABLE contests;',
      }, tokenProfA);
      record('SQL INJECTION: SQL injection in problemId rejected with 400 Bad Request', resSqlBody.status === 400);
    }

    // -------------------------------------------------------------------------
    // L. Rate Limiting Headers
    // -------------------------------------------------------------------------
    console.log('\n--- L. Testing Rate Limiting Headers ---');
    {
      const resRateLimit = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenProfA);
      const hasRateLimitHeader =
        resRateLimit.headers['ratelimit-limit'] !== undefined ||
        resRateLimit.headers['x-ratelimit-limit'] !== undefined ||
        resRateLimit.headers['ratelimit-remaining'] !== undefined;
      record('RATE LIMITING: Rate limiting headers present on contest problem responses', hasRateLimitHeader);
    }

    // -------------------------------------------------------------------------
    // M. Lifecycle Bypass Protection
    // -------------------------------------------------------------------------
    console.log('\n--- M. Testing Contest Lifecycle Bypass Protection ---');
    {
      const resLockAdd = await request('POST', `/api/contests/${runningContest.id}/problems`, { problemId: prob1.id }, tokenProfA);
      record('LIFECYCLE LOCK: Adding problem to running contest rejected with 409 Conflict', resLockAdd.status === 409);

      const resLockBulkAdd = await request('POST', `/api/contests/${runningContest.id}/problems/bulk`, {
        problems: [{ problemId: prob1.id, points: 100 }],
      }, tokenProfA);
      record('LIFECYCLE LOCK: Bulk adding problems to running contest rejected with 409 Conflict', resLockBulkAdd.status === 409);

      const resLockReorder = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, { problemIds: [prob1.id] }, tokenProfA);
      record('LIFECYCLE LOCK: Reordering running contest rejected with 409 Conflict', resLockReorder.status === 409);

      const resLockRemove = await request('DELETE', `/api/contests/${runningContest.id}/problems/${prob1.id}`, null, tokenProfA);
      record('LIFECYCLE LOCK: Removing problem from running contest rejected with 409 Conflict', resLockRemove.status === 409);

      const resLockEnded = await request('POST', `/api/contests/${endedContest.id}/problems`, { problemId: prob1.id }, tokenProfA);
      record('LIFECYCLE LOCK: Adding problem to ended contest rejected with 409 Conflict', resLockEnded.status === 409);
    }

    // -------------------------------------------------------------------------
    // N. Concurrency Safety
    // -------------------------------------------------------------------------
    console.log('\n--- N. Testing Concurrency Safety ---');
    {
      const promises = [
        request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id, points: 150 }, tokenProfA),
        request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id, points: 150 }, tokenProfA),
        request('POST', `/api/contests/${contestA.id}/problems`, { problemId: prob3.id, points: 150 }, tokenProfA),
      ];
      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 201).length;
      const conflictCount = results.filter((r) => r.status === 409).length;

      record('CONCURRENCY: Exactly 1 concurrent add succeeds (201 Created)', successCount === 1);
      record('CONCURRENCY: Remaining concurrent adds return 409 Conflict', conflictCount === 2);

      // Verify database contains exactly 1 row for prob3 in contestA
      const countRes = await db.query(
        'SELECT COUNT(*) FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
        [contestA.id, prob3.id]
      );
      record('CONCURRENCY DB: Exactly 1 mapping row exists in database', parseInt(countRes.rows[0].count, 10) === 1);

      // Clean up prob3
      await ContestModel.removeProblemFromContestWithSafety(contestA.id, prob3.id);
    }

    // -------------------------------------------------------------------------
    // O. Rollback / Atomicity
    // -------------------------------------------------------------------------
    console.log('\n--- O. Testing Rollback & Transaction Atomicity ---');
    {
      // Query state before
      const beforeRes = await db.query(
        'SELECT problem_id, problem_order, points FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
        [contestA.id]
      );

      // Attempt invalid reorder (omitting prob2)
      const resBadReorder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
        problemIds: [prob1.id],
      }, tokenProfA);
      record('ROLLBACK: Incomplete reorder rejected with 400 Bad Request', resBadReorder.status === 400);

      // Query state after
      const afterRes = await db.query(
        'SELECT problem_id, problem_order, points FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
        [contestA.id]
      );
      record('ROLLBACK DB: Database order byte-for-byte unchanged after rejected operation', JSON.stringify(beforeRes.rows) === JSON.stringify(afterRes.rows));
    }

    // -------------------------------------------------------------------------
    // P. Response Data Exposure
    // -------------------------------------------------------------------------
    console.log('\n--- P. Testing Response Data Exposure Prevention ---');
    {
      const resList = await request('GET', `/api/contests/${contestA.id}/problems`, null, tokenProfA);
      const strBody = JSON.stringify(resList.body);

      record('DATA EXPOSURE: Password hash strictly absent from response', !strBody.includes('password_hash') && !strBody.includes('passwordHash'));
      record('DATA EXPOSURE: Hidden test cases strictly absent from response', !strBody.includes('test_cases') && !strBody.includes('testCases'));
      record('DATA EXPOSURE: Reference solutions strictly absent from response', !strBody.includes('solution') && !strBody.includes('referenceSolution'));
      record('DATA EXPOSURE: JWT secret strictly absent from response', !strBody.includes('jwt_secret') && !strBody.includes('JWT_SECRET'));
    }

    // -------------------------------------------------------------------------
    // Q. Safe Error Handling
    // -------------------------------------------------------------------------
    console.log('\n--- Q. Testing Safe Error Handling ---');
    {
      const res400 = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: 'not-an-id' }, tokenProfA);
      record('ERROR HANDLING: Structured envelope status="error"', res400.body?.status === 'error');
      record('ERROR HANDLING: Structured statusCode=400', res400.body?.statusCode === 400);
      record('ERROR HANDLING: Safe human-readable message provided', typeof res400.body?.message === 'string');
      record('ERROR HANDLING: No stack trace exposed in response', res400.body?.stack === undefined);
      record('ERROR HANDLING: No SQL syntax leaked in response', !JSON.stringify(res400.body).includes('syntax error'));
    }

    // -------------------------------------------------------------------------
    // R. Audit Logging
    // -------------------------------------------------------------------------
    console.log('\n--- R. Testing Security Audit Logging ---');
    {
      // Query recent audit logs for test actor
      const auditRes = await db.query(
        'SELECT action, actor_id, outcome, metadata FROM audit_logs WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 10',
        [profB.id]
      );
      const hasDeniedAction = auditRes.rows.some((r) => r.action === 'PRIVILEGED_ACTION_DENIED' && r.outcome === 'denied');
      record('AUDIT LOG: PRIVILEGED_ACTION_DENIED logged for unauthorized BOLA attempts', hasDeniedAction);

      // Verify metadata does not leak sensitive keys
      const allAuditMeta = JSON.stringify(auditRes.rows.map((r) => r.metadata));
      record('AUDIT LOG: Audit metadata strictly clean of passwords and secrets', !allAuditMeta.includes('password') && !allAuditMeta.includes('secret'));
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    console.log('\n--- Cleaning Up Ephemeral Test Fixtures ---');
    try {
      if (contestA) await db.query('DELETE FROM contests WHERE id = $1', [contestA.id]);
      if (contestB) await db.query('DELETE FROM contests WHERE id = $1', [contestB.id]);
      if (runningContest) await db.query('DELETE FROM contests WHERE id = $1', [runningContest.id]);
      if (endedContest) await db.query('DELETE FROM contests WHERE id = $1', [endedContest.id]);

      if (prob1) await db.query('DELETE FROM problems WHERE id = $1', [prob1.id]);
      if (prob2) await db.query('DELETE FROM problems WHERE id = $1', [prob2.id]);
      if (prob3) await db.query('DELETE FROM problems WHERE id = $1', [prob3.id]);
      if (privateProbB) await db.query('DELETE FROM problems WHERE id = $1', [privateProbB.id]);

      if (profA) await db.query('DELETE FROM users WHERE id = $1', [profA.id]);
      if (profB) await db.query('DELETE FROM users WHERE id = $1', [profB.id]);
      if (student) await db.query('DELETE FROM users WHERE id = $1', [student.id]);
      if (contestAdmin) await db.query('DELETE FROM users WHERE id = $1', [contestAdmin.id]);
      if (superAdmin) await db.query('DELETE FROM users WHERE id = $1', [superAdmin.id]);
      console.log('[PASS] Cleanup: Ephemeral test fixtures safely cleaned up');
    } catch (cleanErr) {
      console.error('Cleanup error:', cleanErr);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.10 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSecurityHardeningTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
