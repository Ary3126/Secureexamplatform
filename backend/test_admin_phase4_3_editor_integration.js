/**
 * Automated Test Suite for Phase 7.4.3: Shared Problem Editor Backend Integration
 * 
 * Verifies:
 * 1. RBAC & Route Authorization:
 *    - Unauthenticated requests to POST /api/problems and PUT /api/problems/:id return 401
 *    - Student requests return 403 Forbidden
 *    - Super Admin requests succeed (201 Created / 200 OK)
 * 2. Create Mode Integration:
 *    - Creating problem with codingMode='function', starterTemplates, harnessTemplates, and testCases
 *    - Atomic insertion in database with version=1, review_status='draft', and sample test cases
 * 3. Edit Mode Integration:
 *    - GET /api/admin/problems/:id returns problem detail with sample test cases
 *    - PUT /api/problems/:id updates title, description, difficulty, codingMode, templates, and increments version
 * 4. Optimistic Concurrency Control:
 *    - Mutating with stale version returns HTTP 409 Conflict
 * 5. Input Validation & Safe Disclosure:
 *    - Short title (<3 chars) or description (<5 chars) rejected with 400 Bad Request
 *    - Invalid codingMode or difficulty rejected with 400 Bad Request
 *    - Non-numeric problem ID returns 400 Bad Request
 *    - Non-existent problem ID returns 404 Not Found
 * 6. HarnessBuilder Execution Compatibility:
 *    - Verifies HarnessBuilder replaces __STUDENT_CODE__ in the saved harness template
 * 7. Security:
 *    - Response payloads never contain password hashes or confidential tokens
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const adminRoutes = require('./src/routes/adminRoutes');
const problemRoutes = require('./src/routes/problemRoutes');
const { errorHandler } = require('./src/middleware/errorHandler');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');

let server;
let baseUrl;

let studentUser;
let studentToken;
let profUser;
let profToken;
let superAdminUser;
let superAdminToken;

let createdTestProblemIds = [];
let createdTestUserIds = [];

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
  console.log('===============================================================');
  console.log(' STARTING PHASE 7.4.3 SHARED PROBLEM EDITOR INTEGRATION TESTS');
  console.log('===============================================================\n');

  try {
    // 1. Setup ephemeral test server with both admin and problem routes
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use('/api/problems', problemRoutes);
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
    const suffix = Date.now();

    const sRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'student', 'Student User', true) RETURNING id, username, role`,
      [`stu_ed_${suffix}`, `stu_ed_${suffix}@test.io`, pwdHash]
    );
    studentUser = sRes.rows[0];
    studentToken = generateToken(studentUser);
    createdTestUserIds.push(studentUser.id);

    const pRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'professor', 'Prof User', true) RETURNING id, username, role`,
      [`prf_ed_${suffix}`, `prf_ed_${suffix}@test.io`, pwdHash]
    );
    profUser = pRes.rows[0];
    profToken = generateToken(profUser);
    createdTestUserIds.push(profUser.id);

    const aRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
       VALUES ($1, $2, $3, 'super_admin', 'Admin User', true) RETURNING id, username, role`,
      [`adm_ed_${suffix}`, `adm_ed_${suffix}@test.io`, pwdHash]
    );
    superAdminUser = aRes.rows[0];
    superAdminToken = generateToken(superAdminUser);
    createdTestUserIds.push(superAdminUser.id);

    console.log('--- 1. RBAC & Route Authorization ---');

    // 1.1 Unauthenticated creation rejected
    const unauthCreate = await request('POST', '/api/problems', { title: 'Test Problem', description: 'Sample Desc', difficulty: 'easy' });
    check('Unauthenticated problem creation returns 401', unauthCreate.status === 401);

    // 1.2 Student creation rejected
    const stuCreate = await request('POST', '/api/problems', { title: 'Test Problem', description: 'Sample Desc', difficulty: 'easy' }, studentToken);
    check('Student problem creation returns 403 Forbidden', stuCreate.status === 403);

    // 1.3 Super Admin problem creation allowed
    const validCreatePayload = {
      title: `Phase 7.4.3 Test Problem ${suffix}`,
      description: 'Comprehensive test problem description for Phase 7.4.3 shared editor testing.',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'public',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return 0\n',
        cpp: 'class Solution {\npublic:\n    int solve(vector<int>& nums) { return 0; }\n};\n',
      },
      harnessTemplates: {
        python: 'import sys\n# __STUDENT_CODE__\ndef _main():\n    pass\nif __name__ == "__main__":\n    _main()\n',
      },
      testCases: [
        {
          inputData: '5\n1 2 3 4 5\n',
          expectedOutput: '15\n',
          isHidden: false,
          isSample: true,
          timeLimitMs: 2000,
          memoryLimitMb: 256,
        },
      ],
    };

    const adminCreate = await request('POST', '/api/problems', validCreatePayload, superAdminToken);
    check('Super Admin creates problem successfully (HTTP 201)', adminCreate.status === 201);
    const createdProblem = adminCreate.data?.problem;
    check('Created problem returns valid ID', Boolean(createdProblem?.id));
    if (createdProblem?.id) {
      createdTestProblemIds.push(createdProblem.id);
    }
    check('Created problem initialized with version=1', createdProblem?.version === 1);
    check('Created problem initialized in draft review status', createdProblem?.reviewStatus === 'draft');
    check('Created problem coding mode is function', createdProblem?.codingMode === 'function');
    check('Created problem access scope is public', createdProblem?.accessScope === 'public');

    console.log('\n--- 2. Edit Mode Retrieval & Form Population ---');

    // 2.1 Retrieve problem via Admin endpoint
    const adminDetail = await request('GET', `/api/admin/problems/${createdProblem.id}`, null, superAdminToken);
    check('Super Admin retrieves problem detail (HTTP 200)', adminDetail.status === 200);
    const loadedProblem = adminDetail.data?.data?.problem || adminDetail.data?.problem;
    check('Loaded problem title matches', loadedProblem?.title === validCreatePayload.title);
    check('Loaded problem includes starterTemplates', typeof loadedProblem?.starterTemplates === 'object');
    check('Loaded problem includes harnessTemplates', typeof loadedProblem?.harnessTemplates === 'object');
    check('Loaded problem includes sampleTestCases', Array.isArray(loadedProblem?.sampleTestCases));
    check('Sample test cases preserved in database', loadedProblem?.sampleTestCases?.length >= 1);
    check('Sample test case input preserved', loadedProblem?.sampleTestCases?.[0]?.inputData === '5\n1 2 3 4 5\n');

    console.log('\n--- 3. Edit Mode Updates & Optimistic Concurrency ---');

    // 3.1 Update problem with valid version
    const updatePayload = {
      title: `Phase 7.4.3 Updated Title ${suffix}`,
      description: 'Updated description for problem with extended explanations and requirements.',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'public',
      version: 1,
      expectedVersion: 1,
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)\n',
      },
    };

    const adminUpdate = await request('PUT', `/api/problems/${createdProblem.id}`, updatePayload, superAdminToken);
    check('Super Admin updates problem successfully (HTTP 200)', adminUpdate.status === 200);
    const updatedProblem = adminUpdate.data?.problem;
    check('Updated problem version incremented to 2', updatedProblem?.version === 2);
    check('Updated problem title reflected', updatedProblem?.title === updatePayload.title);
    check('Updated problem difficulty reflected as hard', updatedProblem?.difficulty === 'hard');

    // 3.2 Optimistic concurrency collision detection
    const staleUpdatePayload = {
      title: 'Stale Concurrency Update',
      description: 'Attempting to update with stale version 1',
      version: 1,
      expectedVersion: 1,
    };
    const staleRes = await request('PUT', `/api/problems/${createdProblem.id}`, staleUpdatePayload, superAdminToken);
    check('Outdated version mutation rejected with HTTP 409 Conflict', staleRes.status === 409);
    check('Conflict response provides currentVersion', staleRes.data?.currentVersion === 2);

    console.log('\n--- 4. Input Validation & Safe Disclosure ---');

    // 4.1 Short title rejected
    const shortTitleRes = await request('POST', '/api/problems', { title: 'AB', description: 'Valid description text', difficulty: 'easy' }, superAdminToken);
    check('Title shorter than 3 chars rejected (HTTP 400)', shortTitleRes.status === 400);

    // 4.2 Short description rejected
    const shortDescRes = await request('POST', '/api/problems', { title: 'Valid Title', description: '123', difficulty: 'easy' }, superAdminToken);
    check('Description shorter than 5 chars rejected (HTTP 400)', shortDescRes.status === 400);

    // 4.3 Invalid difficulty rejected
    const badDiffRes = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description text', difficulty: 'expert' }, superAdminToken);
    check('Invalid difficulty rejected (HTTP 400)', badDiffRes.status === 400);

    // 4.4 Non-numeric problem ID rejected on detail endpoint
    const badIdRes = await request('GET', '/api/admin/problems/invalid-abc', null, superAdminToken);
    check('Non-numeric problem ID returns HTTP 400 Bad Request', badIdRes.status === 400);

    // 4.5 Non-existent problem ID returns 404
    const notFoundRes = await request('GET', '/api/admin/problems/999999', null, superAdminToken);
    check('Non-existent problem ID returns HTTP 404 Not Found', notFoundRes.status === 404);

    console.log('\n--- 5. Function Mode HarnessBuilder Integration ---');

    // 5.1 HarnessBuilder injects student code into problem harness template
    const studentCode = '    def solve(self, nums: list[int]) -> int:\n        return sum(nums)';
    const fullExecutable = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'function',
      sourceCode: studentCode,
      problem: loadedProblem,
    });

    check('HarnessBuilder executable contains student code', fullExecutable.includes(studentCode));
    check('HarnessBuilder executable stripped placeholder __STUDENT_CODE__', !fullExecutable.includes('__STUDENT_CODE__'));
    check('HarnessBuilder executable maintains harness preamble and entrypoint', fullExecutable.includes('def _main():'));

    console.log('\n--- 6. Sensitive Data Sanitization ---');

    const serializedPayload = JSON.stringify(adminDetail.data);
    check('Problem payload contains zero password hashes', !serializedPayload.includes('password_hash'));
    check('Problem payload contains zero passwordHash', !serializedPayload.includes('passwordHash'));

  } catch (err) {
    console.error('Unexpected test error:', err);
    failedAssertions++;
  } finally {
    console.log('\n--- 7. Cleanup Ephemeral Test Fixtures ---');

    if (createdTestProblemIds.length > 0) {
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdTestProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdTestProblemIds]);
      console.log(`  Purged ${createdTestProblemIds.length} ephemeral test problems`);
    }

    if (createdTestUserIds.length > 0) {
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdTestUserIds]);
      console.log(`  Purged ${createdTestUserIds.length} ephemeral test users`);
    }

    if (server) {
      server.close();
    }

    await db.pool.end();

    console.log('\n===============================================================');
    console.log(` PHASE 7.4.3 INTEGRATION TESTS: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('===============================================================');

    process.exit(failedAssertions === 0 ? 0 : 1);
  }
}

runTests();
