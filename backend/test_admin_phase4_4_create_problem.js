/**
 * Automated Test Suite for Phase 7.4.4: Create Problem — Full Workflow
 *
 * Verifies:
 * 1. RBAC & Route Authorization:
 *    - Unauthenticated POST /api/problems returns 401
 *    - Student role returns 403 Forbidden
 *    - Super Admin role succeeds with 201 Created
 *    - Professor role succeeds with 201 Created
 *    - Contest Admin role succeeds with 201 Created
 *
 * 2. Create Problem — Core Payload (Function Mode):
 *    - Creates problem with codingMode='function', starterTemplates, harnessTemplates, testCases
 *    - Response includes id, title, difficulty, codingMode, accessScope, version=1, review_status='draft'
 *    - Atomic transaction: problem row + test cases created together or not at all
 *
 * 3. Create Problem — Standard OJ (full_program) Mode:
 *    - Creates problem with codingMode='full_program' and OJ-style starter templates
 *    - Correct version=1, review_status='draft' on creation
 *
 * 4. Create Problem — Access Scope Enforcement:
 *    - Super Admin can publish to 'public' scope
 *    - Professor-created problem defaults to 'contest_private' even if 'public' requested
 *
 * 5. Input Validation Gate:
 *    - Missing title, short/long title, missing description, short description → 400
 *    - Invalid difficulty, codingMode, accessScope → 400
 *
 * 6. Test Cases Atomicity:
 *    - Problem created with sample test cases attached and retrievable
 *
 * 7. Audit Log:
 *    - PROBLEM_CREATED event logged in audit trail after successful creation
 *
 * 8. Security:
 *    - Response payloads never expose password_hash or sensitive tokens
 *    - No information leakage on error responses
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const adminRoutes = require('./src/routes/adminRoutes');
const problemRoutes = require('./src/routes/problemRoutes');
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

let createdProblemIds = [];
let createdUserIds = [];

let passedAssertions = 0;
let failedAssertions = 0;

function check(label, condition, meta = '') {
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${label}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${label} ${meta ? '-> ' + JSON.stringify(meta) : ''}`);
  }
}

async function request(method, path, body = null, token = null) {
  const url = baseUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function validFunctionPayload(suffix) {
  suffix = suffix || '';
  return {
    title: 'Phase744 Function Problem' + suffix,
    description: 'Given an array of integers, return the sum of all elements.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    starterTemplates: {
      python: 'class Solution:\n    def solve(self, nums):\n        return 0\n',
      cpp: 'class Solution {\npublic:\n    int solve(std::vector<int>& nums) { return 0; }\n};\n',
    },
    harnessTemplates: {
      python: 'import sys\n\n# __STUDENT_CODE__\n\ndef _main():\n    nums = [int(x) for x in sys.stdin.read().split()]\n    print(Solution().solve(nums))\n\nif __name__ == "__main__":\n    _main()\n',
      cpp: '#include <vector>\n// __STUDENT_CODE__\nint main() { return 0; }\n',
    },
    testCases: [
      { inputData: '1 2 3 4 5', expectedOutput: '15', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 1 },
    ],
  };
}

function validOJPayload(suffix) {
  suffix = suffix || '';
  return {
    title: 'Phase744 OJ Problem' + suffix,
    description: 'Read two integers from stdin and print their sum.',
    difficulty: 'easy',
    codingMode: 'full_program',
    accessScope: 'contest_private',
    starterTemplates: {
      python: 'import sys\ndef main():\n    a, b = map(int, sys.stdin.read().split())\n    print(a + b)\nif __name__ == "__main__":\n    main()\n',
    },
    testCases: [
      { inputData: '3 5', expectedOutput: '8', isSample: true, isHidden: false, timeLimitMs: 1500, memoryLimitMb: 128, testOrder: 1 },
    ],
  };
}

async function setup() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/problems', problemRoutes);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
  const addr = server.address();
  baseUrl = 'http://127.0.0.1:' + addr.port;

  const pw = await hashPassword('TestPass123!');

  const uStudentRes = await db.query(
    "INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,'student',$4,true) RETURNING id, username, role",
    ['p744_student', 'p744_student@test.example', pw, 'Phase744 Student']
  );
  studentUser = uStudentRes.rows[0];
  studentToken = generateToken(studentUser);
  createdUserIds.push(studentUser.id);

  const uProfRes = await db.query(
    "INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,'professor',$4,true) RETURNING id, username, role",
    ['p744_professor', 'p744_prof@test.example', pw, 'Phase744 Professor']
  );
  profUser = uProfRes.rows[0];
  profToken = generateToken(profUser);
  createdUserIds.push(profUser.id);

  const uContestAdminRes = await db.query(
    "INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,'contest_admin',$4,true) RETURNING id, username, role",
    ['p744_cadmin', 'p744_cadmin@test.example', pw, 'Phase744 Contest Admin']
  );
  contestAdminUser = uContestAdminRes.rows[0];
  contestAdminToken = generateToken(contestAdminUser);
  createdUserIds.push(contestAdminUser.id);

  const uSuperAdminRes = await db.query(
    "INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,'super_admin',$4,true) RETURNING id, username, role",
    ['p744_sadmin', 'p744_sadmin@test.example', pw, 'Phase744 Super Admin']
  );
  superAdminUser = uSuperAdminRes.rows[0];
  superAdminToken = generateToken(superAdminUser);
  createdUserIds.push(superAdminUser.id);
}

async function cleanup() {
  for (const id of createdProblemIds) {
    await db.query('DELETE FROM problems WHERE id = $1', [id]).catch(function() {});
  }
  for (const id of createdUserIds) {
    await db.query('DELETE FROM users WHERE id = $1', [id]).catch(function() {});
  }
  if (server) await new Promise(function(resolve) { server.close(resolve); });
}

async function runTests() {
  console.log('='.repeat(65));
  console.log(' PHASE 7.4.4 — CREATE PROBLEM INTEGRATION TESTS');
  console.log('='.repeat(65));

  // Section 1: RBAC & Authorization
  console.log('\n-- Section 1: RBAC & Route Authorization --');

  var r = await request('POST', '/api/problems', validFunctionPayload('_auth1'));
  check('1.1 Unauthenticated POST /api/problems returns 401', r.status === 401, r.data);

  r = await request('POST', '/api/problems', validFunctionPayload('_auth2'), studentToken);
  check('1.2 Student role returns 403 Forbidden', r.status === 403, r.data);

  r = await request('POST', '/api/problems', validFunctionPayload('_auth3'), superAdminToken);
  check('1.3 Super Admin role returns 201 Created', r.status === 201, r.data);
  if (r.status === 201 && r.data && r.data.problem) createdProblemIds.push(r.data.problem.id);

  r = await request('POST', '/api/problems', validOJPayload('_auth4'), profToken);
  check('1.4 Professor role returns 201 Created', r.status === 201, r.data);
  if (r.status === 201 && r.data && r.data.problem) createdProblemIds.push(r.data.problem.id);

  r = await request('POST', '/api/problems', validFunctionPayload('_auth5'), contestAdminToken);
  check('1.5 Contest Admin role returns 201 Created', r.status === 201, r.data);
  if (r.status === 201 && r.data && r.data.problem) createdProblemIds.push(r.data.problem.id);

  // Section 2: Core Create — Function Mode
  console.log('\n-- Section 2: Create Problem — Function Mode --');

  var payload2 = validFunctionPayload('_fn_core');
  r = await request('POST', '/api/problems', payload2, superAdminToken);
  check('2.1 POST /api/problems (Function) returns 201', r.status === 201, r.data);

  var prob = r.data && r.data.problem;
  if (prob) createdProblemIds.push(prob.id);

  check('2.2 Response contains positive integer problem.id', prob && typeof prob.id === 'number' && prob.id > 0, prob);
  check('2.3 Response title matches payload', prob && prob.title && prob.title.trim() === payload2.title.trim(), prob && prob.title);
  check('2.4 Response difficulty matches payload', prob && prob.difficulty === payload2.difficulty, prob && prob.difficulty);
  check('2.5 Response codingMode = "function"', prob && (prob.codingMode || prob.coding_mode) === 'function', prob);
  check('2.6 Response version = 1', prob && prob.version === 1, prob && prob.version);
  check('2.7 Response reviewStatus = "draft"', prob && (prob.reviewStatus || prob.review_status) === 'draft', prob);
  check('2.8 Response contains starterTemplates', prob && (prob.starterTemplates || prob.starter_templates), prob);

  // Section 3: Create Problem — Standard OJ Mode
  console.log('\n-- Section 3: Create Problem — Standard OJ Mode --');

  var payload3 = validOJPayload('_oj_core');
  r = await request('POST', '/api/problems', payload3, superAdminToken);
  check('3.1 POST /api/problems (OJ mode) returns 201', r.status === 201, r.data);

  var probOJ = r.data && r.data.problem;
  if (probOJ) createdProblemIds.push(probOJ.id);

  check('3.2 codingMode = "full_program"', probOJ && (probOJ.codingMode || probOJ.coding_mode) === 'full_program', probOJ);
  check('3.3 accessScope = "contest_private"', probOJ && (probOJ.accessScope || probOJ.access_scope) === 'contest_private', probOJ);
  check('3.4 version = 1 on OJ creation', probOJ && probOJ.version === 1, probOJ && probOJ.version);
  check('3.5 reviewStatus = "draft" on OJ creation', probOJ && (probOJ.reviewStatus || probOJ.review_status) === 'draft', probOJ);

  // Section 4: Access Scope Enforcement
  console.log('\n-- Section 4: Access Scope Enforcement --');

  var adminPublicPayload = Object.assign({}, validFunctionPayload('_scope_admin'), { accessScope: 'public' });
  r = await request('POST', '/api/problems', adminPublicPayload, superAdminToken);
  check('4.1 Super Admin can create "public" scope problem', r.status === 201, r.data);
  var probAdminPublic = r.data && r.data.problem;
  if (probAdminPublic) createdProblemIds.push(probAdminPublic.id);
  check('4.2 Super Admin problem has accessScope "public"', probAdminPublic && (probAdminPublic.accessScope || probAdminPublic.access_scope) === 'public', probAdminPublic);

  var profPublicPayload = Object.assign({}, validOJPayload('_scope_prof'), { accessScope: 'public' });
  r = await request('POST', '/api/problems', profPublicPayload, profToken);
  check('4.3 Professor request with accessScope="public" succeeds', r.status === 201, r.data);
  var probProfPublic = r.data && r.data.problem;
  if (probProfPublic) createdProblemIds.push(probProfPublic.id);
  check('4.4 Professor problem scope downgraded to "contest_private"', probProfPublic && (probProfPublic.accessScope || probProfPublic.access_scope) === 'contest_private', probProfPublic);

  // Section 5: Input Validation Gate
  console.log('\n-- Section 5: Input Validation Gate --');

  r = await request('POST', '/api/problems', { description: 'Valid description', difficulty: 'easy' }, superAdminToken);
  check('5.1 Missing title returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'AB', description: 'Valid description', difficulty: 'easy' }, superAdminToken);
  check('5.2 Short title (<3 chars) returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'A'.repeat(201), description: 'Valid description', difficulty: 'easy' }, superAdminToken);
  check('5.3 Long title (>200 chars) returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'Valid Title' , difficulty: 'easy' }, superAdminToken);
  check('5.4 Missing description returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Hi', difficulty: 'easy' }, superAdminToken);
  check('5.5 Short description (<5 chars) returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description text', difficulty: 'insane' }, superAdminToken);
  check('5.6 Invalid difficulty returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description text', difficulty: 'easy', codingMode: 'distributed' }, superAdminToken);
  check('5.7 Invalid codingMode returns 400', r.status === 400, r.data);

  r = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description text', difficulty: 'easy', accessScope: 'anonymous' }, superAdminToken);
  check('5.8 Invalid accessScope returns 400', r.status === 400, r.data);

  // Section 6: Test Cases Atomicity
  console.log('\n-- Section 6: Test Cases Atomicity --');

  var atomicPayload = Object.assign({}, validFunctionPayload('_atomic'), {
    testCases: [
      { inputData: '5 3', expectedOutput: '8', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 1 },
      { inputData: '10 20 30', expectedOutput: '60', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 2 },
    ],
  });
  r = await request('POST', '/api/problems', atomicPayload, superAdminToken);
  check('6.1 Problem with 2 test cases returns 201', r.status === 201, r.data);

  var probAtomic = r.data && r.data.problem;
  if (probAtomic) {
    createdProblemIds.push(probAtomic.id);

    var r2 = await request('GET', '/api/admin/problems/' + probAtomic.id, null, superAdminToken);
    check('6.2 Admin GET newly created problem returns 200', r2.status === 200, r2.data);

    var fetchedProb = r2.data && (r2.data.data && r2.data.data.problem || r2.data.problem);
    var sampleCases = fetchedProb && fetchedProb.sampleTestCases || [];
    check('6.3 Sample test cases retrievable after creation (count >= 2)', sampleCases.length >= 2, 'count=' + sampleCases.length);
    if (sampleCases.length >= 1) {
      check('6.4 First test case has correct inputData "5 3"', sampleCases[0].inputData === '5 3', sampleCases[0]);
      check('6.5 First test case has correct expectedOutput "8"', sampleCases[0].expectedOutput === '8', sampleCases[0]);
    }
  }

  // Section 7: Audit Log
  console.log('\n-- Section 7: Audit Log --');

  r = await request('POST', '/api/problems', validFunctionPayload('_audit'), superAdminToken);
  check('7.1 Create problem for audit check returns 201', r.status === 201, r.data);

  var probAudit = r.data && r.data.problem;
  if (probAudit) {
    createdProblemIds.push(probAudit.id);
    var auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1",
      [String(probAudit.id)]
    );
    check('7.2 PROBLEM_CREATED audit event in audit_logs', auditRes.rows.length > 0, auditRes.rows);
    if (auditRes.rows.length > 0) {
      var auditRow = auditRes.rows[0];
      check('7.3 Audit actor_id matches super admin', auditRow.actor_id === superAdminUser.id, auditRow);
      check('7.4 Audit outcome = "success"', auditRow.outcome === 'success', auditRow);
    }
  }

  // Section 8: Security
  console.log('\n-- Section 8: Security --');

  r = await request('POST', '/api/problems', validFunctionPayload('_sec1'), superAdminToken);
  check('8.1 Create problem returns 201 for security test', r.status === 201, r.data);
  var probSec = r.data && r.data.problem;
  if (probSec) {
    createdProblemIds.push(probSec.id);
    var responseStr = JSON.stringify(r.data);
    check('8.2 Response does not contain password_hash', !responseStr.includes('password_hash'), 'LEAKED');
    check('8.3 Response does not contain passwordHash', !responseStr.includes('passwordHash'), 'LEAKED');
    check('8.4 Response does not contain jwt_secret', !responseStr.includes('jwt_secret'), 'LEAKED');
    check('8.5 Response does not contain refresh_token', !responseStr.includes('refresh_token'), 'LEAKED');
  }

  r = await request('POST', '/api/problems', validFunctionPayload('_sec_unauth'));
  var unAuthStr = JSON.stringify(r.data);
  check('8.6 401 response does not leak pg or stack info', !unAuthStr.includes('pg') && !unAuthStr.includes('stack'), unAuthStr.slice(0, 200));

  r = await request('POST', '/api/problems', validFunctionPayload('_sec_403'), studentToken);
  var forbiddenStr = JSON.stringify(r.data);
  check('8.7 403 response does not expose SQL table names', !forbiddenStr.includes('FROM users') && !forbiddenStr.includes('INSERT INTO'), forbiddenStr.slice(0, 200));

  // Summary
  console.log('\n' + '='.repeat(65));
  console.log(' PHASE 7.4.4 TEST RESULTS: ' + passedAssertions + ' passed, ' + failedAssertions + ' failed');
  console.log('='.repeat(65));

  return failedAssertions === 0;
}

(async function() {
  try {
    await setup();
    var success = await runTests();
    await cleanup();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
    await cleanup().catch(function() {});
    process.exit(1);
  }
})();
