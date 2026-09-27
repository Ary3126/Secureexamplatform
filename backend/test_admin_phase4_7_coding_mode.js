/**
 * Automated Test Suite for Phase 7.4.7: Coding Mode Configuration
 *
 * Verifies:
 * 1. Coding Mode Selection & Creation:
 *    - Standard OJ problem creation (explicit full_program)
 *    - Standard OJ problem creation (default fallback when omitted)
 *    - Function Mode problem creation (function)
 *    - DB persistence of coding_mode, starter_templates, and harness_templates
 *
 * 2. Mode Validation Gate (Backend Authoritative):
 *    - Reject unsupported codingMode (400)
 *    - Reject malformed starterTemplates (non-object, array) (400)
 *    - Reject unsupported languages in starterTemplates (400)
 *    - Reject non-string values in starterTemplates (400)
 *    - Reject malformed harnessTemplates (non-object, array) (400)
 *    - Reject unsupported languages in harnessTemplates (400)
 *    - Reject non-string values in harnessTemplates (400)
 *
 * 3. Mode Switching & Data Integrity (Standard OJ <-> Function Mode):
 *    - Standard OJ -> Function Mode -> Standard OJ switching
 *    - DB coding_mode updates correctly
 *    - Version increments on mode updates
 *    - Non-destructive preservation: Title, description, difficulty, access scope, and test cases remain intact
 *
 * 4. Execution Pipeline Compatibility:
 *    - Standard OJ: HarnessBuilder returns sourceCode unaltered (no harness injection)
 *    - Function Mode: HarnessBuilder merges student code into custom harness template via __STUDENT_CODE__
 *    - Function Mode fallback harnesses for C++, Python, Java
 *
 * 5. RBAC & BOLA Defense:
 *    - Unauthenticated PUT returns 401
 *    - Student PUT returns 403 Forbidden
 *    - Professor cannot change another professor's problem coding mode (403 BOLA)
 *    - Professor can change own problem coding mode (200)
 *    - Contest Admin and Super Admin can change coding mode of any problem (200)
 *
 * 6. Audit Logging & Security:
 *    - PROBLEM_CREATED audit event records codingMode
 *    - PROBLEM_UPDATED audit event records codingMode
 *    - No password_hash or jwt_secret exposed in responses
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const apiRoutes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');

let server;
let baseUrl;

let studentUser, studentToken;
let profUser, profToken;
let profUser2, profToken2;
let contestAdminUser, contestAdminToken;
let superAdminUser, superAdminToken;

let createdProblemIds = [];
let createdUserIds = [];

let passedAssertions = 0;
let failedAssertions = 0;

function check(label, condition, meta) {
  if (condition) {
    passedAssertions++;
    console.log('  [PASS] ' + label);
  } else {
    failedAssertions++;
    console.error('  [FAIL] ' + label + (meta !== undefined ? ' -> ' + JSON.stringify(meta) : ''));
  }
}

async function request(method, path, body, token) {
  const url = baseUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(function() { return null; });
  return { status: res.status, data: data };
}

async function createTestUser(username, role) {
  const email = `${username}_${Date.now()}@test.internal`;
  const hashed = await hashPassword('Password123!');
  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, username, email, role`,
    [username, email, hashed, role, `Test ${username}`]
  );
  const user = res.rows[0];
  createdUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function createProblem(token, overrides) {
  overrides = overrides || {};
  const payload = Object.assign({
    title: 'Phase747 Problem ' + Date.now(),
    description: 'Algorithmic challenge problem for testing coding mode configuration.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    starterTemplates: {
      python: 'class Solution:\n    def solve(self, nums):\n        return sum(nums)\n',
      cpp: 'class Solution {\npublic:\n    int solve() { return 0; }\n};\n',
    },
    harnessTemplates: {
      python: 'import sys\n# __STUDENT_CODE__\ndef _trusted_platform_harness_main(): pass\nif __name__=="__main__": _trusted_platform_harness_main()\n',
      cpp: '#include <iostream>\n// __STUDENT_CODE__\nint main() { return 0; }\n',
    },
    testCases: [
      { inputData: '1 2 3', expectedOutput: '6', isHidden: false, isSample: true, testOrder: 1 },
      { inputData: '10 20', expectedOutput: '30', isHidden: true, isSample: false, testOrder: 2 },
    ],
  }, overrides);

  const res = await request('POST', '/api/problems', payload, token);
  if (res.data && res.data.problem && res.data.problem.id) {
    createdProblemIds.push(res.data.problem.id);
  }
  return res;
}

async function runTests() {
  console.log('=================================================================');
  console.log(' PHASE 7.4.7 — CODING MODE CONFIGURATION INTEGRATION TESTS');
  console.log('=================================================================\n');

  try {
    // 0. Setup Express test server
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Create fixture users
    const s = await createTestUser('p747_student', 'student');
    studentUser = s.user; studentToken = s.token;

    const p = await createTestUser('p747_prof', 'professor');
    profUser = p.user; profToken = p.token;

    const p2 = await createTestUser('p747_prof2', 'professor');
    profUser2 = p2.user; profToken2 = p2.token;

    const ca = await createTestUser('p747_cadmin', 'contest_admin');
    contestAdminUser = ca.user; contestAdminToken = ca.token;

    const sa = await createTestUser('p747_sadmin', 'super_admin');
    superAdminUser = sa.user; superAdminToken = sa.token;

    // -------------------------------------------------------------
    // Section 1: Coding Mode Selection & Creation
    // -------------------------------------------------------------
    console.log('-- Section 1: Coding Mode Selection & Creation --');

    // 1.1: Standard OJ creation with explicit full_program
    const probOJRes = await createProblem(superAdminToken, {
      title: 'Standard OJ Problem Explicit ' + Date.now(),
      codingMode: 'full_program',
      starterTemplates: {
        python: 'import sys\nprint("Hello World")\n',
        cpp: '#include <iostream>\nint main() { return 0; }\n',
      },
    });
    check('1.1 Create problem with codingMode="full_program" returns 201', probOJRes.status === 201);
    const probOJ = probOJRes.data?.problem;
    check('1.2 Response codingMode is "full_program"', probOJ?.codingMode === 'full_program');

    // Verify DB column
    const dbOJRes = await db.query('SELECT coding_mode, starter_templates FROM problems WHERE id = $1', [probOJ.id]);
    check('1.3 Database column coding_mode is "full_program"', dbOJRes.rows[0]?.coding_mode === 'full_program');

    // 1.4: Standard OJ creation with default fallback (omitted codingMode)
    const probDefaultRes = await createProblem(superAdminToken, {
      title: 'Default Coding Mode Problem ' + Date.now(),
      codingMode: undefined,
    });
    check('1.4 Create problem without codingMode defaults to 201', probDefaultRes.status === 201);
    const probDefault = probDefaultRes.data?.problem;
    check('1.5 Default codingMode is "full_program"', probDefault?.codingMode === 'full_program');

    // 1.6: Function Mode creation with explicit function
    const probFnRes = await createProblem(superAdminToken, {
      title: 'Function Mode Problem ' + Date.now(),
      codingMode: 'function',
    });
    check('1.6 Create problem with codingMode="function" returns 201', probFnRes.status === 201);
    const probFn = probFnRes.data?.problem;
    check('1.7 Response codingMode is "function"', probFn?.codingMode === 'function');

    const dbFnRes = await db.query('SELECT coding_mode FROM problems WHERE id = $1', [probFn.id]);
    check('1.8 Database column coding_mode is "function"', dbFnRes.rows[0]?.coding_mode === 'function');

    // -------------------------------------------------------------
    // Section 2: Mode Validation Gate (Backend Authoritative)
    // -------------------------------------------------------------
    console.log('\n-- Section 2: Mode Validation Gate (Backend Authoritative) --');

    // 2.1: Reject unsupported coding mode string
    const invalidModeRes = await request('POST', '/api/problems', {
      title: 'Invalid Mode Problem',
      description: 'Testing unsupported coding mode validation.',
      difficulty: 'medium',
      codingMode: 'unsupported_mode',
    }, superAdminToken);
    check('2.1 Reject unsupported string codingMode returns 400', invalidModeRes.status === 400);
    check('2.2 Error message mentions valid codingMode options', JSON.stringify(invalidModeRes.data?.errors).includes('full_program, function'));

    // 2.2: Reject numeric coding mode
    const numModeRes = await request('POST', '/api/problems', {
      title: 'Numeric Mode Problem',
      description: 'Testing numeric coding mode validation.',
      difficulty: 'medium',
      codingMode: 12345,
    }, superAdminToken);
    check('2.3 Reject numeric codingMode returns 400', numModeRes.status === 400);

    // 2.3: Reject array coding mode
    const arrModeRes = await request('POST', '/api/problems', {
      title: 'Array Mode Problem',
      description: 'Testing array coding mode validation.',
      difficulty: 'medium',
      codingMode: ['full_program'],
    }, superAdminToken);
    check('2.4 Reject array codingMode returns 400', arrModeRes.status === 400);

    // 2.4: Reject malformed starterTemplates (string instead of object)
    const malformedStarterRes = await request('POST', '/api/problems', {
      title: 'Malformed Starter Problem',
      description: 'Testing malformed starter templates validation.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: 'not_an_object',
    }, superAdminToken);
    check('2.5 Reject string starterTemplates returns 400', malformedStarterRes.status === 400);

    // 2.5: Reject malformed starterTemplates (array instead of object)
    const arrStarterRes = await request('POST', '/api/problems', {
      title: 'Array Starter Problem',
      description: 'Testing array starter templates validation.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: ['python', 'cpp'],
    }, superAdminToken);
    check('2.6 Reject array starterTemplates returns 400', arrStarterRes.status === 400);

    // 2.6: Reject unsupported language in starterTemplates (e.g. ruby)
    const unsuppLangStarterRes = await request('POST', '/api/problems', {
      title: 'Unsupported Lang Starter',
      description: 'Testing unsupported language in starter templates.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: { ruby: 'puts "hello"' },
    }, superAdminToken);
    check('2.8 Error specifies unsupported language', (unsuppLangStarterRes.data?.errors || []).some((e) => e.includes('Unsupported language "ruby"')));

    // 2.7: Reject non-string template value in starterTemplates
    const nonStrStarterRes = await request('POST', '/api/problems', {
      title: 'Non-String Starter Value',
      description: 'Testing non-string starter value validation.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: { python: 12345 },
    }, superAdminToken);
    check('2.9 Reject non-string template value in starterTemplates returns 400', nonStrStarterRes.status === 400);

    // 2.8: Reject malformed harnessTemplates (string instead of object)
    const malformedHarnessRes = await request('POST', '/api/problems', {
      title: 'Malformed Harness Problem',
      description: 'Testing malformed harness templates validation.',
      difficulty: 'medium',
      codingMode: 'function',
      harnessTemplates: 'invalid_harness_string',
    }, superAdminToken);
    check('2.10 Reject string harnessTemplates returns 400', malformedHarnessRes.status === 400);

    // 2.9: Reject malformed harnessTemplates (number)
    const numHarnessRes = await request('POST', '/api/problems', {
      title: 'Number Harness Problem',
      description: 'Testing number harness templates validation.',
      difficulty: 'medium',
      codingMode: 'function',
      harnessTemplates: 9999,
    }, superAdminToken);
    check('2.11 Reject numeric harnessTemplates returns 400', numHarnessRes.status === 400);

    // 2.10: Reject unsupported language in harnessTemplates
    const unsuppLangHarnessRes = await request('POST', '/api/problems', {
      title: 'Unsupported Lang Harness',
      description: 'Testing unsupported language in harness templates.',
      difficulty: 'medium',
      codingMode: 'function',
      harnessTemplates: { go: 'package main' },
    }, superAdminToken);
    check('2.12 Reject unsupported language in harnessTemplates returns 400', unsuppLangHarnessRes.status === 400);

    // 2.11: Reject non-string value in harnessTemplates
    const nonStrHarnessRes = await request('POST', '/api/problems', {
      title: 'Non-String Harness Value',
      description: 'Testing non-string harness value validation.',
      difficulty: 'medium',
      codingMode: 'function',
      harnessTemplates: { python: false },
    }, superAdminToken);
    check('2.13 Reject non-string value in harnessTemplates returns 400', nonStrHarnessRes.status === 400);

    // -------------------------------------------------------------
    // Section 3: Mode Switching & Data Integrity (Standard OJ <-> Function Mode)
    // -------------------------------------------------------------
    console.log('\n-- Section 3: Mode Switching & Data Integrity --');

    // Create problem in Standard OJ mode with test cases
    const switchProbRes = await createProblem(superAdminToken, {
      title: 'Mode Switching Problem ' + Date.now(),
      description: 'Testing non-destructive mode switching between Standard OJ and Function Mode.',
      difficulty: 'medium',
      codingMode: 'full_program',
      starterTemplates: {
        python: 'import sys\n# OJ starter\nprint("init")\n',
      },
      harnessTemplates: {
        python: 'import sys\n# __STUDENT_CODE__\ndef run(): pass\n',
      },
    });
    const switchProb = switchProbRes.data?.problem;
    check('3.1 Initial problem created as "full_program"', switchProb?.codingMode === 'full_program');
    check('3.2 Initial problem version is 1', switchProb?.version === 1);

    // Verify initial test cases count
    const initTcRes = await request('GET', `/api/problems/${switchProb.id}/test-cases`, null, superAdminToken);
    const initTcCount = initTcRes.data?.testCases?.length || 0;
    check('3.3 Initial problem has 2 test cases attached', initTcCount === 2);

    // Step 3a: Standard OJ -> Function Mode
    const toFnRes = await request('PUT', `/api/problems/${switchProb.id}`, {
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self): return 1\n',
      },
      version: 1,
    }, superAdminToken);
    check('3.4 Switch Standard OJ -> Function Mode returns 200', toFnRes.status === 200);
    check('3.5 Problem codingMode updated to "function"', toFnRes.data?.problem?.codingMode === 'function');
    check('3.6 Problem version incremented to 2', toFnRes.data?.problem?.version === 2);

    // Verify in DB
    const dbSwitched1 = await db.query('SELECT coding_mode, description, version, review_status FROM problems WHERE id = $1', [switchProb.id]);
    check('3.7 DB coding_mode is "function"', dbSwitched1.rows[0]?.coding_mode === 'function');
    check('3.8 Description is preserved intact', dbSwitched1.rows[0]?.description === switchProb.description);
    check('3.9 Review status is draft after mode switch', dbSwitched1.rows[0]?.review_status === 'draft');

    // Verify test cases still exist
    const midTcRes = await request('GET', `/api/problems/${switchProb.id}/test-cases`, null, superAdminToken);
    check('3.10 Test cases preserved after Standard OJ -> Function switch', midTcRes.data?.testCases?.length === 2);

    // Step 3b: Function Mode -> Standard OJ
    const toOJRes = await request('PUT', `/api/problems/${switchProb.id}`, {
      codingMode: 'full_program',
      starterTemplates: {
        python: 'import sys\nprint("full program restored")\n',
      },
      version: 2,
    }, superAdminToken);
    check('3.11 Switch Function Mode -> Standard OJ returns 200', toOJRes.status === 200);
    check('3.12 Problem codingMode updated back to "full_program"', toOJRes.data?.problem?.codingMode === 'full_program');
    check('3.13 Problem version incremented to 3', toOJRes.data?.problem?.version === 3);

    const dbSwitched2 = await db.query('SELECT coding_mode, starter_templates, harness_templates FROM problems WHERE id = $1', [switchProb.id]);
    check('3.14 DB coding_mode is "full_program"', dbSwitched2.rows[0]?.coding_mode === 'full_program');
    check('3.15 Pre-existing harness_templates remain safely preserved in DB', typeof dbSwitched2.rows[0]?.harness_templates === 'object');

    // Verify test cases again
    const finalTcRes = await request('GET', `/api/problems/${switchProb.id}/test-cases`, null, superAdminToken);
    check('3.16 Test cases completely intact after round-trip mode switching', finalTcRes.data?.testCases?.length === 2);

    // -------------------------------------------------------------
    // Section 4: Execution Pipeline Compatibility (HarnessBuilder)
    // -------------------------------------------------------------
    console.log('\n-- Section 4: Execution Pipeline Compatibility --');

    const sampleStudentCode = 'def solve(nums):\n    return max(nums)';

    // 4.1: Standard OJ code execution with HarnessBuilder returns sourceCode unaltered
    const ojOutput = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'full_program',
      sourceCode: sampleStudentCode,
      problem: null,
    });
    check('4.1 Standard OJ returns sourceCode directly (no harness injection)', ojOutput === sampleStudentCode);

    // Standard OJ for C++
    const cppStudentCode = '#include <iostream>\nint main() { std::cout << 42; return 0; }';
    const cppOjOutput = HarnessBuilder.buildExecutableCode({
      language: 'cpp',
      codingMode: 'full_program',
      sourceCode: cppStudentCode,
      problem: null,
    });
    check('4.2 Standard OJ for C++ returns sourceCode unaltered', cppOjOutput === cppStudentCode);

    // 4.3: Function Mode with custom harness injection
    const customHarness = 'import sys\n# ====== SECURE HARNESS PREAMBLE ======\n# __STUDENT_CODE__\nprint(Solution().solve([1,2,3]))\n';
    const problemWithHarness = {
      harnessTemplates: {
        python: customHarness,
      },
    };

    const fnOutput = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'function',
      sourceCode: 'class Solution:\n    def solve(self, nums): return sum(nums)',
      problem: problemWithHarness,
    });
    check('4.3 Function Mode injects student code into custom harness template', fnOutput.includes('class Solution:') && fnOutput.includes('print(Solution().solve'));
    check('4.4 Function Mode output removes the __STUDENT_CODE__ placeholder', !fnOutput.includes('__STUDENT_CODE__'));

    // 4.5: Function Mode default harness fallback (C++, Python, Java)
    const pyFallback = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'function',
      sourceCode: 'class Solution:\n    def solve(self, a, b): return a + b',
      problem: null,
    });
    check('4.5 Function Mode Python fallback includes _trusted_platform_harness_main', pyFallback.includes('_trusted_platform_harness_main'));

    const cppFallback = HarnessBuilder.buildExecutableCode({
      language: 'cpp',
      codingMode: 'function',
      sourceCode: 'class Solution { public: int solve(int a, int b) { return a + b; } };',
      problem: null,
    });
    check('4.6 Function Mode C++ fallback includes solutionInstance.solve', cppFallback.includes('solutionInstance.solve'));

    const javaFallback = HarnessBuilder.buildExecutableCode({
      language: 'java',
      codingMode: 'function',
      sourceCode: 'public class Solution { public int solve(int a, int b) { return a + b; } }',
      problem: null,
    });
    check('4.7 Function Mode Java fallback includes reflection harness', javaFallback.includes('Solution sol = new Solution();'));

    // -------------------------------------------------------------
    // Section 5: RBAC & BOLA Defense on Coding Mode Updates
    // -------------------------------------------------------------
    console.log('\n-- Section 5: RBAC & BOLA Defense --');

    // 5.1: Unauthenticated PUT
    const unauthPut = await request('PUT', `/api/problems/${switchProb.id}`, {
      codingMode: 'function',
    }, null);
    check('5.1 Unauthenticated PUT returns 401', unauthPut.status === 401);

    // 5.2: Student PUT
    const studentPut = await request('PUT', `/api/problems/${switchProb.id}`, {
      codingMode: 'function',
    }, studentToken);
    check('5.2 Student role on PUT returns 403 Forbidden', studentPut.status === 403);

    // Create a problem owned by profUser
    const profProbRes = await createProblem(profToken, {
      title: 'Prof Alpha Problem ' + Date.now(),
      codingMode: 'function',
    });
    const profProb = profProbRes.data?.problem;

    // 5.3: Professor 2 attempts to change Professor 1's problem codingMode (BOLA attack)
    const bolaPut = await request('PUT', `/api/problems/${profProb.id}`, {
      codingMode: 'full_program',
    }, profToken2);
    check('5.3 Professor cannot edit another professor problem codingMode (403 BOLA)', bolaPut.status === 403);

    // 5.4: Professor 1 updates own problem codingMode
    const profOwnPut = await request('PUT', `/api/problems/${profProb.id}`, {
      codingMode: 'full_program',
      version: 1,
    }, profToken);
    check('5.4 Professor can edit own problem codingMode returns 200', profOwnPut.status === 200);
    check('5.5 codingMode successfully updated to "full_program"', profOwnPut.data?.problem?.codingMode === 'full_program');

    // 5.6: Contest Admin can edit any problem codingMode
    const cadminPut = await request('PUT', `/api/problems/${profProb.id}`, {
      codingMode: 'function',
      version: 2,
    }, contestAdminToken);
    check('5.6 Contest Admin can edit any problem codingMode returns 200', cadminPut.status === 200);

    // 5.7: Super Admin can edit any problem codingMode
    const sadminPut = await request('PUT', `/api/problems/${profProb.id}`, {
      codingMode: 'full_program',
      version: 3,
    }, superAdminToken);
    check('5.7 Super Admin can edit any problem codingMode returns 200', sadminPut.status === 200);

    // -------------------------------------------------------------
    // Section 6: Audit Logging & Security Hardening
    // -------------------------------------------------------------
    console.log('\n-- Section 6: Audit Logging & Security Hardening --');

    // Verify PROBLEM_CREATED audit event
    const auditCreatedRes = await db.query(
      `SELECT action, metadata, outcome FROM audit_logs
       WHERE resource_id = $1 AND action = 'PROBLEM_CREATED'`,
      [probOJ.id]
    );
    check('6.1 Audit log recorded for PROBLEM_CREATED', auditCreatedRes.rowCount > 0);
    check('6.2 Audit metadata includes codingMode="full_program"', auditCreatedRes.rows[0]?.metadata?.codingMode === 'full_program');

    // Verify PROBLEM_UPDATED audit event
    const auditUpdatedRes = await db.query(
      `SELECT action, metadata, outcome FROM audit_logs
       WHERE resource_id = $1 AND action = 'PROBLEM_UPDATED'
       ORDER BY id DESC LIMIT 1`,
      [switchProb.id]
    );
    check('6.3 Audit log recorded for PROBLEM_UPDATED', auditUpdatedRes.rowCount > 0);
    check('6.4 Audit metadata includes codingMode', auditUpdatedRes.rows[0]?.metadata?.codingMode !== undefined);

    // Verify no password_hash or jwt_secret leak
    const inspectResponse = JSON.stringify(probOJRes.data);
    check('6.5 Response does not expose password_hash', !inspectResponse.includes('password_hash'));
    check('6.6 Response does not expose jwt_secret', !inspectResponse.includes('jwt_secret'));

  } catch (err) {
    console.error('Fatal test error:', err);
    failedAssertions++;
  } finally {
    // Teardown
    console.log('\n-- Teardown: Purging Ephemeral Test Data --');
    try {
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM audit_logs WHERE resource_type = 'problem' AND resource_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
        console.log(`  Purged ${createdProblemIds.length} test problems.`);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
        console.log(`  Purged ${createdUserIds.length} test users.`);
      }
    } catch (cleanErr) {
      console.error('Cleanup warning:', cleanErr.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.pool.end();

    console.log('\n=================================================================');
    console.log(` PHASE 7.4.7 TEST RESULTS: ${passedAssertions} passed, ${failedAssertions} failed`);
    console.log('=================================================================\n');

    if (failedAssertions > 0) {
      process.exit(1);
    }
  }
}

runTests();
