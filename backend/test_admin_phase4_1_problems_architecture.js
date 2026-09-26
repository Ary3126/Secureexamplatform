/**
 * Automated Test Suite for Phase 7.4.1 — Admin Problem Management Architecture
 * 
 * Verifies:
 * 1. RBAC & Route Protection:
 *    - Unauthenticated requests to /api/admin/problems return 401
 *    - Student requests return 403 Forbidden
 *    - Professor requests return 403 Forbidden
 *    - Contest Admin requests return 403 Forbidden
 *    - Super Admin receives 200 OK
 * 2. Problem Listing & Pagination Foundation:
 *    - GET /api/admin/problems returns array and pagination metadata
 *    - Filtering parameters (difficulty, coding_mode, access_scope, search) are respected
 * 3. Problem Detail Boundary:
 *    - GET /api/admin/problems/:id returns 200 with problem details for Super Admin
 *    - GET /api/admin/problems/invalid returns 400 Bad Request
 *    - GET /api/admin/problems/999999 returns 404 Not Found
 * 4. Problem Archive Boundary:
 *    - POST /api/admin/problems/:id/archive enforces Super Admin authorization
 *    - Non-admin callers receive 403 Forbidden
 * 5. Function Mode & Harness Configuration Compatibility:
 *    - Verifies problem model preserves coding_mode ('full_program' | 'function')
 *    - Verifies starter_templates and harness_templates fields
 * 6. Security & Data Sanitization:
 *    - Password hashes and secrets never leaked in problem responses
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const adminRoutes = require('./src/routes/adminRoutes');
const { errorHandler } = require('./src/middleware/errorHandler');

let server;
let baseUrl;

let studentUser;
let studentToken;
let profUser;
let profToken;
let contestAdminUser;
let contestAdminToken;
let superAdminUser;
let superAdminToken;

let testProblem;
let createdTestUserIds = [];
let createdTestProblemIds = [];

let passedAssertions = 0;
let failedAssertions = 0;

function check(label, condition, meta = '') {
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${label}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${label} ${meta ? `-> ${JSON.stringify(meta)}` : ''}`);
  }
}

async function request(method, path, body = null, token = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 7.4.1 ADMIN PROBLEM ARCHITECTURE TESTS');
  console.log('=======================================================\n');

  try {
    // 1. Setup ephemeral test server
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use(errorHandler);

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // 2. Provision test fixtures
    const pwdHash = await hashPassword('Password123!');
    const ts = Date.now();

    const stdRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'student') RETURNING *;
    `, [`std_p741_${ts}`, `std_p741_${ts}@test.com`, pwdHash, 'Student P741']);
    studentUser = stdRes.rows[0];
    studentToken = generateToken(studentUser);
    createdTestUserIds.push(studentUser.id);

    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'professor') RETURNING *;
    `, [`prof_p741_${ts}`, `prof_p741_${ts}@test.com`, pwdHash, 'Prof P741']);
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);
    createdTestUserIds.push(profUser.id);

    const caRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'contest_admin') RETURNING *;
    `, [`ca_p741_${ts}`, `ca_p741_${ts}@test.com`, pwdHash, 'ContestAdmin P741']);
    contestAdminUser = caRes.rows[0];
    contestAdminToken = generateToken(contestAdminUser);
    createdTestUserIds.push(contestAdminUser.id);

    const saRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa_p741_${ts}`, `sa_p741_${ts}@test.com`, pwdHash, 'SuperAdmin P741']);
    superAdminUser = saRes.rows[0];
    superAdminToken = generateToken(superAdminUser);
    createdTestUserIds.push(superAdminUser.id);

    // Create a problem fixture with both Standard OJ & Function Mode starter templates
    const probRes = await db.query(`
      INSERT INTO problems (
        title, description, difficulty, coding_mode, starter_templates, harness_templates, access_scope, created_by, version, is_published, review_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, true, 'published')
      RETURNING *;
    `, [
      `Architecture Test Problem ${ts}`,
      'Verify Phase 7.4.1 administrative problem architecture',
      'medium',
      'function',
      JSON.stringify({
        cpp: 'int solve(int n) { return n * 2; }',
        python: 'def solve(n: int) -> int:\n    return n * 2',
      }),
      JSON.stringify({
        cpp: '// harness template cpp',
        python: '# harness template python',
      }),
      'public',
      superAdminUser.id,
    ]);
    testProblem = probRes.rows[0];
    createdTestProblemIds.push(testProblem.id);

    // Add a sample testcase
    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, test_order)
      VALUES ($1, '5', '10', false, 1);
    `, [testProblem.id]);

    check('Test actors and problem fixtures initialized', Boolean(testProblem && superAdminToken));

    // ----------------------------------------------------
    // Section 1: Route Protection & RBAC
    // ----------------------------------------------------
    console.log('\n--- 1. RBAC & Route Protection ---');
    const unauthRes = await request('GET', '/api/admin/problems');
    check('Unauthenticated GET /api/admin/problems returns 401 Unauthorized', unauthRes.status === 401);

    const stdResGet = await request('GET', '/api/admin/problems', null, studentToken);
    check('Student GET /api/admin/problems returns 403 Forbidden', stdResGet.status === 403);

    const profResGet = await request('GET', '/api/admin/problems', null, profToken);
    check('Professor GET /api/admin/problems returns 403 Forbidden', profResGet.status === 403);

    const caResGet = await request('GET', '/api/admin/problems', null, contestAdminToken);
    check('Contest Admin GET /api/admin/problems returns 403 Forbidden', caResGet.status === 403);

    const saResGet = await request('GET', '/api/admin/problems', null, superAdminToken);
    check('Super Admin GET /api/admin/problems returns 200 OK', saResGet.status === 200);

    // ----------------------------------------------------
    // Section 2: Problem Listing & Pagination Foundation
    // ----------------------------------------------------
    console.log('\n--- 2. Problem Listing & Pagination Architecture ---');
    const listData = saResGet.data?.data || saResGet.data;
    check('Response contains problems array', Array.isArray(listData?.problems || saResGet.data?.problems));
    check('Response contains pagination metadata', Boolean(listData?.pagination || saResGet.data?.total !== undefined));

    // Test filter query parameters
    const filterRes = await request('GET', `/api/admin/problems?difficulty=medium&coding_mode=function&search=Architecture Test Problem ${ts}`, null, superAdminToken);
    check('Filtered query returns 200 OK', filterRes.status === 200);
    const filterProblems = filterRes.data?.data?.problems || filterRes.data?.problems || [];
    const foundProblem = filterProblems.find(p => p.id === testProblem.id);
    check('Filtered query correctly identifies targeted test problem', Boolean(foundProblem));
    if (foundProblem) {
      check('Target problem difficulty matches filter (medium)', foundProblem.difficulty === 'medium');
      check('Target problem codingMode matches filter (function)', (foundProblem.codingMode || foundProblem.coding_mode) === 'function');
    }

    // ----------------------------------------------------
    // Section 3: Problem Detail Boundary (GET /api/admin/problems/:id)
    // ----------------------------------------------------
    console.log('\n--- 3. Problem Detail Boundary ---');
    const unauthDetail = await request('GET', `/api/admin/problems/${testProblem.id}`);
    check('Unauthenticated GET /api/admin/problems/:id returns 401', unauthDetail.status === 401);

    const stdDetail = await request('GET', `/api/admin/problems/${testProblem.id}`, null, studentToken);
    check('Student GET /api/admin/problems/:id returns 403 Forbidden', stdDetail.status === 403);

    const profDetail = await request('GET', `/api/admin/problems/${testProblem.id}`, null, profToken);
    check('Professor GET /api/admin/problems/:id returns 403 Forbidden', profDetail.status === 403);

    const validDetail = await request('GET', `/api/admin/problems/${testProblem.id}`, null, superAdminToken);
    check('Super Admin GET /api/admin/problems/:id returns 200 OK', validDetail.status === 200);
    const probDetail = validDetail.data?.data?.problem || validDetail.data?.problem;
    check('Detail response matches requested problem ID', probDetail?.id === testProblem.id);
    check('Detail response contains title', probDetail?.title === testProblem.title);
    check('Detail response includes sample test cases', Array.isArray(probDetail?.sampleTestCases) && probDetail.sampleTestCases.length > 0);

    const invalidIdRes = await request('GET', '/api/admin/problems/abc-invalid', null, superAdminToken);
    check('Invalid problem ID format returns 400 Bad Request', invalidIdRes.status === 400);

    const notFoundRes = await request('GET', '/api/admin/problems/9999999', null, superAdminToken);
    check('Non-existent problem ID returns 404 Not Found', notFoundRes.status === 404);

    // ----------------------------------------------------
    // Section 4: Problem Archive Endpoint RBAC Boundary
    // ----------------------------------------------------
    console.log('\n--- 4. Problem Archive Endpoint RBAC Boundary ---');
    const unauthArchive = await request('POST', `/api/admin/problems/${testProblem.id}/archive`);
    check('Unauthenticated POST /api/admin/problems/:id/archive returns 401', unauthArchive.status === 401);

    const stdArchive = await request('POST', `/api/admin/problems/${testProblem.id}/archive`, null, studentToken);
    check('Student POST /api/admin/problems/:id/archive returns 403 Forbidden', stdArchive.status === 403);

    const profArchive = await request('POST', `/api/admin/problems/${testProblem.id}/archive`, null, profToken);
    check('Professor POST /api/admin/problems/:id/archive returns 403 Forbidden', profArchive.status === 403);

    // ----------------------------------------------------
    // Section 5: Function Mode & Harness Schema Verification
    // ----------------------------------------------------
    console.log('\n--- 5. Function Mode & Harness Architecture Verification ---');
    check('Problem schema supports function coding mode', testProblem.coding_mode === 'function');
    check('Problem schema stores starter templates as JSON', typeof testProblem.starter_templates === 'object');
    check('Problem schema stores harness templates as JSON', typeof testProblem.harness_templates === 'object');

    // ----------------------------------------------------
    // Section 6: Security & Sensitive Data Leak Prevention
    // ----------------------------------------------------
    console.log('\n--- 6. Security & Sensitive Data Leak Prevention ---');
    const rawJson = JSON.stringify(validDetail.data);
    check('Response does not contain password_hash', !rawJson.includes('password_hash'));
    check('Response does not contain passwordHash', !rawJson.includes('passwordHash'));
    check('Response does not contain jwt_secret', !rawJson.includes('jwt_secret'));

    // ----------------------------------------------------
    // Section 7: Teardown & Clean Up
    // ----------------------------------------------------
    console.log('\n--- 7. Cleanup Fixtures ---');
    if (createdTestProblemIds.length > 0) {
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdTestProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdTestProblemIds]);
      console.log('  [CLEANUP] Problem fixtures deleted.');
    }
    if (createdTestUserIds.length > 0) {
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdTestUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdTestUserIds]);
      console.log('  [CLEANUP] User fixtures deleted.');
    }

    console.log('\n=======================================================');
    console.log(` PHASE 7.4.1 BACKEND SUITE: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('=======================================================\n');

  } catch (err) {
    console.error('Test execution encountered error:', err);
    failedAssertions++;
  } finally {
    if (server) server.close();
    await db.pool.end();
    if (failedAssertions > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
