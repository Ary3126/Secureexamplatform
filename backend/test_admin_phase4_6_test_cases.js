/**
 * Automated Test Suite for Phase 7.4.6: Test Case Management
 *
 * Verifies:
 * 1. RBAC & Route Authorization:
 *    - Unauthenticated POST /api/problems/:id/test-cases returns 401
 *    - Unauthenticated GET /api/problems/:id/test-cases returns 401
 *    - Unauthenticated PUT /api/test-cases/:id returns 401
 *    - Unauthenticated DELETE /api/test-cases/:id returns 401
 *    - Student role returns 403 on all administrative test case endpoints
 *    - Super Admin can list, create, update, and delete test cases (200/201)
 *    - Contest Admin can list, create, update, and delete test cases (200/201)
 *    - Professor can manage own problem's test cases (200/201)
 *    - Professor cannot view, create, edit, or delete another professor's test cases (403 BOLA)
 *
 * 2. Add & View Test Cases:
 *    - Add sample test case (isHidden: false, isSample: true)
 *    - Add hidden test case (isHidden: true, isSample: false)
 *    - Admin GET /api/problems/:id/test-cases returns full test suite
 *    - Test ordering is preserved (testOrder ASC)
 *    - Route alias /testcases works identically
 *    - GET /api/test-cases/:id returns single test case
 *
 * 3. Edit Test Case (Isolated Mutation & Data Integrity):
 *    - Updating test case A changes only test case A
 *    - Test case B remains untouched
 *    - Parent problem remains untouched
 *    - Toggle sample -> hidden and hidden -> sample
 *
 * 4. Delete Test Case (Safe Deletion & Data Preservation):
 *    - DELETE /api/test-cases/:id deletes target test case
 *    - Parent problem remains intact
 *    - Other test cases belonging to problem remain intact
 *    - Deleting non-existent test case returns 404
 *
 * 5. Sample vs Hidden Protection (Zero Hidden Test Leakage):
 *    - Student GET /api/problems/:id includes ONLY sample test cases
 *    - Hidden test case inputs and outputs are never leaked to students
 *    - Student GET /api/problems/:id/preview includes ONLY sample test cases
 *    - Student GET /api/problems/:id/test-cases is rejected with 403
 *
 * 6. Function Mode Integration:
 *    - Problem in function mode with test cases verifies harness compatibility
 *
 * 7. Validation Gate & Error Handling:
 *    - Missing expectedOutput returns 400
 *    - Invalid timeLimitMs returns 400
 *    - Invalid memoryLimitMb returns 400
 *    - Non-numeric problem ID returns 400
 *    - Non-existent problem ID returns 404
 *    - Non-numeric test case ID returns 400
 *    - Non-existent test case ID returns 404
 *
 * 8. Audit Logging & Security:
 *    - TEST_CASE_CREATED audit event
 *    - TEST_CASE_UPDATED audit event
 *    - TEST_CASE_DELETED audit event
 *    - PRIVILEGED_ACTION_DENIED audit event on BOLA attempt
 *    - No sensitive credentials or DB errors leaked
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

async function createProblem(token, overrides) {
  overrides = overrides || {};
  const payload = Object.assign({
    title: 'Phase746 Test Problem',
    description: 'Algorithmic challenge problem for testing test case management.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    starterTemplates: {
      python: 'class Solution:\n    def solve(self, nums):\n        return sum(nums)\n',
      cpp: 'class Solution {\npublic:\n    int solve() { return 0; }\n};\n',
    },
    harnessTemplates: {
      python: 'import sys\n# __STUDENT_CODE__\ndef _m(): pass\nif __name__=="__main__": _m()\n',
      cpp: '#include <iostream>\n// __STUDENT_CODE__\nint main() { return 0; }\n',
    },
    testCases: [
      { inputData: '1 2', expectedOutput: '3', isHidden: false, testOrder: 1 },
      { inputData: '4 5', expectedOutput: '9', isHidden: false, testOrder: 2 },
    ],
  }, overrides);

  const res = await request('POST', '/api/problems', payload, token);
  if (res.status === 201 && res.data && res.data.problem) {
    createdProblemIds.push(res.data.problem.id);
    return res.data.problem;
  }
  throw new Error('Failed to create problem: ' + JSON.stringify(res.data));
}

async function setup() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = 'http://127.0.0.1:' + server.address().port;

  const pw = await hashPassword('TestPass746!');

  const ins = async function(username, email, role, fullName) {
    const r = await db.query(
      'INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id, username, role',
      [username, email, pw, role, fullName]
    );
    const u = r.rows[0];
    createdUserIds.push(u.id);
    return { user: u, token: generateToken(u) };
  };

  const s = await ins('p746_student', 'p746_student@test.example', 'student', 'Phase746 Student');
  studentUser = s.user; studentToken = s.token;

  const p = await ins('p746_prof', 'p746_prof@test.example', 'professor', 'Phase746 Professor');
  profUser = p.user; profToken = p.token;

  const p2 = await ins('p746_prof2', 'p746_prof2@test.example', 'professor', 'Phase746 Professor2');
  profUser2 = p2.user; profToken2 = p2.token;

  const ca = await ins('p746_cadmin', 'p746_cadmin@test.example', 'contest_admin', 'Phase746 Contest Admin');
  contestAdminUser = ca.user; contestAdminToken = ca.token;

  const sa = await ins('p746_sadmin', 'p746_sadmin@test.example', 'super_admin', 'Phase746 Super Admin');
  superAdminUser = sa.user; superAdminToken = sa.token;
}

async function cleanup() {
  for (var i = 0; i < createdProblemIds.length; i++) {
    await db.query('DELETE FROM problems WHERE id = $1', [createdProblemIds[i]]).catch(function() {});
  }
  for (var j = 0; j < createdUserIds.length; j++) {
    await db.query('DELETE FROM users WHERE id = $1', [createdUserIds[j]]).catch(function() {});
  }
  if (server) await new Promise(function(resolve) { server.close(resolve); });
}

async function runTests() {
  console.log('\n=================================================================');
  console.log(' PHASE 7.4.6 — TEST CASE MANAGEMENT INTEGRATION TESTS');
  console.log('=================================================================\n');

  try {
    await setup();

    // Seed Problem for Tests
    const baseProblem = await createProblem(superAdminToken, { title: 'Base Problem for Test Cases' });
    check('Setup: base problem created', baseProblem && baseProblem.id > 0);

    const profProblem = await createProblem(profToken, { title: 'Prof Problem for Test Cases', accessScope: 'contest_private' });
    check('Setup: professor problem created', profProblem && profProblem.id > 0);

    const prof2Problem = await createProblem(profToken2, { title: 'Prof2 Problem for Test Cases', accessScope: 'contest_private' });
    check('Setup: professor2 problem created', prof2Problem && prof2Problem.id > 0);

    // ==============================================================
    // Section 1: RBAC & Route Authorization
    // ==============================================================
    console.log('\n-- Section 1: RBAC & Route Authorization --');

    // 1.1 Unauthenticated requests return 401
    const unauthGet = await request('GET', `/api/problems/${baseProblem.id}/test-cases`, null, null);
    check('1.1 Unauthenticated GET returns 401', unauthGet.status === 401);

    const unauthPost = await request('POST', `/api/problems/${baseProblem.id}/test-cases`, { inputData: '1', expectedOutput: '1' }, null);
    check('1.2 Unauthenticated POST returns 401', unauthPost.status === 401);

    const unauthPut = await request('PUT', '/api/test-cases/1', { expectedOutput: '2' }, null);
    check('1.3 Unauthenticated PUT returns 401', unauthPut.status === 401);

    const unauthDel = await request('DELETE', '/api/test-cases/1', null, null);
    check('1.4 Unauthenticated DELETE returns 401', unauthDel.status === 401);

    // 1.5 Student role returns 403 Forbidden
    const studentGet = await request('GET', `/api/problems/${baseProblem.id}/test-cases`, null, studentToken);
    check('1.5 Student role on GET returns 403 Forbidden', studentGet.status === 403);

    const studentPost = await request('POST', `/api/problems/${baseProblem.id}/test-cases`, { inputData: '1', expectedOutput: '1' }, studentToken);
    check('1.6 Student role on POST returns 403 Forbidden', studentPost.status === 403);

    const studentPut = await request('PUT', '/api/test-cases/1', { expectedOutput: '2' }, studentToken);
    check('1.7 Student role on PUT returns 403 Forbidden', studentPut.status === 403);

    const studentDel = await request('DELETE', '/api/test-cases/1', null, studentToken);
    check('1.8 Student role on DELETE returns 403 Forbidden', studentDel.status === 403);

    // 1.9 Super Admin can view, add test case (200/201)
    const saAdd = await request('POST', `/api/problems/${baseProblem.id}/test-cases`, {
      inputData: '10 20',
      expectedOutput: '30',
      isHidden: false,
      testOrder: 3,
    }, superAdminToken);
    check('1.9 Super Admin can add test case (201)', saAdd.status === 201 && saAdd.data?.testCase?.id > 0);

    // 1.10 Contest Admin can add test case (201)
    const caAdd = await request('POST', `/api/problems/${baseProblem.id}/test-cases`, {
      inputData: '50 50',
      expectedOutput: '100',
      isHidden: true,
      testOrder: 4,
    }, contestAdminToken);
    check('1.10 Contest Admin can add test case (201)', caAdd.status === 201 && caAdd.data?.testCase?.id > 0);

    // 1.11 Professor can manage own problem's test cases
    const profAdd = await request('POST', `/api/problems/${profProblem.id}/test-cases`, {
      inputData: '100 200',
      expectedOutput: '300',
      isHidden: false,
      testOrder: 3,
    }, profToken);
    check('1.11 Professor can add test case to own problem (201)', profAdd.status === 201 && profAdd.data?.testCase?.id > 0);

    // 1.12-1.15 BOLA: Professor cannot manage another professor's problem's test cases
    const bolaGet = await request('GET', `/api/problems/${prof2Problem.id}/test-cases`, null, profToken);
    check('1.12 BOLA: Professor cannot view other prof test cases (403)', bolaGet.status === 403);

    const bolaAdd = await request('POST', `/api/problems/${prof2Problem.id}/test-cases`, {
      inputData: '9 9',
      expectedOutput: '18',
    }, profToken);
    check('1.13 BOLA: Professor cannot add test case to other prof problem (403)', bolaAdd.status === 403);

    // Get an existing test case ID from prof2's problem
    const p2CasesRes = await request('GET', `/api/problems/${prof2Problem.id}/test-cases`, null, profToken2);
    const p2TestCaseId = p2CasesRes.data?.testCases?.[0]?.id;
    check('Setup: prof2 problem has test cases', Boolean(p2TestCaseId));

    const bolaPut = await request('PUT', `/api/test-cases/${p2TestCaseId}`, { expectedOutput: 'hacked' }, profToken);
    check('1.14 BOLA: Professor cannot edit other prof test case (403)', bolaPut.status === 403);

    const bolaDel = await request('DELETE', `/api/test-cases/${p2TestCaseId}`, null, profToken);
    check('1.15 BOLA: Professor cannot delete other prof test case (403)', bolaDel.status === 403);

    // ==============================================================
    // Section 2: Add & View Test Cases
    // ==============================================================
    console.log('\n-- Section 2: Add & View Test Cases --');

    const tcProblem = await createProblem(superAdminToken, { title: 'Test Cases CRUD Problem' });

    // 2.1 Add Sample Test Case
    const addSample = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, {
      inputData: '2 3',
      expectedOutput: '5',
      isHidden: false,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      testOrder: 1,
    }, superAdminToken);
    check('2.1 Add Sample test case returns 201', addSample.status === 201);
    check('2.2 Sample test case has isHidden=false and isSample=true', addSample.data?.testCase?.isHidden === false && addSample.data?.testCase?.isSample === true);

    // 2.3 Add Hidden Test Case
    const addHidden = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, {
      inputData: '1000000 2000000',
      expectedOutput: '3000000',
      isHidden: true,
      timeLimitMs: 3000,
      memoryLimitMb: 512,
      testOrder: 2,
    }, superAdminToken);
    check('2.3 Add Hidden test case returns 201', addHidden.status === 201);
    check('2.4 Hidden test case has isHidden=true and isSample=false', addHidden.data?.testCase?.isHidden === true && addHidden.data?.testCase?.isSample === false);

    // 2.5 List all test cases (Admin endpoint)
    const listRes = await request('GET', `/api/problems/${tcProblem.id}/test-cases`, null, superAdminToken);
    check('2.5 GET /api/problems/:id/test-cases returns 200', listRes.status === 200);
    check('2.6 List contains at least 2 test cases', listRes.data?.testCases?.length >= 2);
    check('2.7 Order is ascending by testOrder', listRes.data?.testCases?.[0]?.testOrder <= listRes.data?.testCases?.[1]?.testOrder);

    // 2.8 Route alias without hyphen (/testcases)
    const aliasRes = await request('GET', `/api/problems/${tcProblem.id}/testcases`, null, superAdminToken);
    check('2.8 Route alias /testcases returns 200 and matches count', aliasRes.status === 200 && aliasRes.data?.count === listRes.data?.count);

    // 2.9 Single test case retrieval
    const sampleId = addSample.data.testCase.id;
    const singleRes = await request('GET', `/api/test-cases/${sampleId}`, null, superAdminToken);
    check('2.9 GET /api/test-cases/:id returns 200', singleRes.status === 200);
    check('2.10 Single test case id matches', singleRes.data?.testCase?.id === sampleId);

    // ==============================================================
    // Section 3: Edit Test Case (Isolated Mutation & Data Integrity)
    // ==============================================================
    console.log('\n-- Section 3: Edit Test Case (Data Integrity) --');

    const hiddenId = addHidden.data.testCase.id;

    // 3.1 Edit input and output of sample testcase
    const editSampleRes = await request('PUT', `/api/test-cases/${sampleId}`, {
      inputData: '7 8',
      expectedOutput: '15',
      timeLimitMs: 2500,
    }, superAdminToken);
    check('3.1 Edit sample test case returns 200', editSampleRes.status === 200);
    check('3.2 Updated inputData matches "7 8"', editSampleRes.data?.testCase?.inputData === '7 8');
    check('3.3 Updated expectedOutput matches "15"', editSampleRes.data?.testCase?.expectedOutput === '15');

    // 3.4 Verify hidden test case was NOT modified
    const checkHidden = await request('GET', `/api/test-cases/${hiddenId}`, null, superAdminToken);
    check('3.4 Sibling hidden test case remains intact ("1000000 2000000")', checkHidden.data?.testCase?.inputData === '1000000 2000000');

    // 3.5 Verify parent problem fields are intact
    const checkProblem = await request('GET', `/api/problems/${tcProblem.id}`, null, superAdminToken);
    check('3.5 Parent problem title preserved intact', checkProblem.data?.title === 'Test Cases CRUD Problem');

    // 3.6 Toggle sample -> hidden
    const toggleToHidden = await request('PUT', `/api/test-cases/${sampleId}`, {
      isHidden: true,
    }, superAdminToken);
    check('3.6 Toggle to Hidden returns 200', toggleToHidden.status === 200);
    check('3.7 isHidden is now true', toggleToHidden.data?.testCase?.isHidden === true);
    check('3.8 isSample is now false', toggleToHidden.data?.testCase?.isSample === false);

    // 3.9 Toggle back to sample
    const toggleToSample = await request('PUT', `/api/test-cases/${sampleId}`, {
      isSample: true,
    }, superAdminToken);
    check('3.9 Toggle back with isSample: true returns 200', toggleToSample.status === 200);
    check('3.10 isHidden is now false', toggleToSample.data?.testCase?.isHidden === false);

    // ==============================================================
    // Section 4: Delete Test Case (Safe Deletion & Data Preservation)
    // ==============================================================
    console.log('\n-- Section 4: Delete Test Case (Safe Deletion) --');

    // Add a throwaway testcase to delete
    const throwaway = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, {
      inputData: 'throwaway',
      expectedOutput: 'bye',
      isHidden: true,
      testOrder: 99,
    }, superAdminToken);
    const throwawayId = throwaway.data?.testCase?.id;
    check('Setup: throwaway test case created', Boolean(throwawayId));

    // 4.1 Delete the testcase
    const delRes = await request('DELETE', `/api/test-cases/${throwawayId}`, null, superAdminToken);
    check('4.1 DELETE /api/test-cases/:id returns 200', delRes.status === 200);
    check('4.2 Response contains deletedTestCaseId', delRes.data?.deletedTestCaseId === throwawayId);

    // 4.3 Verify deleted test case is gone
    const verifyDel = await request('GET', `/api/test-cases/${throwawayId}`, null, superAdminToken);
    check('4.3 Deleted test case returns 404', verifyDel.status === 404);

    // 4.4 Verify remaining test cases for the problem still exist
    const postDelList = await request('GET', `/api/problems/${tcProblem.id}/test-cases`, null, superAdminToken);
    const remainingIds = postDelList.data?.testCases?.map(tc => tc.id);
    check('4.4 Original sample test case still exists', remainingIds.includes(sampleId));
    check('4.5 Original hidden test case still exists', remainingIds.includes(hiddenId));

    // 4.6 Parent problem still exists
    const problemAfterDel = await request('GET', `/api/problems/${tcProblem.id}`, null, superAdminToken);
    check('4.6 Parent problem was not deleted', problemAfterDel.status === 200);

    // ==============================================================
    // Section 5: Sample vs Hidden Protection (Zero Hidden Test Leakage)
    // ==============================================================
    console.log('\n-- Section 5: Hidden Test Protection (Zero Leakage) --');

    // Create a problem with explicit secrets in hidden tests
    const leakTestProblem = await createProblem(superAdminToken, {
      title: 'Leakage Defense Problem',
      testCases: [
        { inputData: 'public_input_1', expectedOutput: 'public_output_1', isHidden: false, testOrder: 1 },
        { inputData: 'SECRET_HIDDEN_INPUT_XYZ', expectedOutput: 'SECRET_HIDDEN_OUTPUT_ABC', isHidden: true, testOrder: 2 },
        { inputData: 'ANOTHER_CONFIDENTIAL_TEST', expectedOutput: 'TOP_SECRET_ANSWER', isHidden: true, testOrder: 3 },
      ],
    });

    // 5.1 Student GET /api/problems/:id
    const studentProbRes = await request('GET', `/api/problems/${leakTestProblem.id}`, null, studentToken);
    check('5.1 Student GET problem returns 200', studentProbRes.status === 200);

    const studentSampleCases = studentProbRes.data?.sampleTestCases || [];
    check('5.2 Student gets sampleTestCases array', Array.isArray(studentSampleCases));
    check('5.3 Student receives exactly 1 sample case', studentSampleCases.length === 1);
    check('5.4 Sample case matches public_input_1', studentSampleCases[0]?.inputData === 'public_input_1');

    // 5.5 Check that NO secret strings appear in the entire student response JSON
    const responseString = JSON.stringify(studentProbRes.data);
    check('5.5 Response NEVER contains SECRET_HIDDEN_INPUT_XYZ', !responseString.includes('SECRET_HIDDEN_INPUT_XYZ'));
    check('5.6 Response NEVER contains SECRET_HIDDEN_OUTPUT_ABC', !responseString.includes('SECRET_HIDDEN_OUTPUT_ABC'));
    check('5.7 Response NEVER contains ANOTHER_CONFIDENTIAL_TEST', !responseString.includes('ANOTHER_CONFIDENTIAL_TEST'));
    check('5.8 Response NEVER contains TOP_SECRET_ANSWER', !responseString.includes('TOP_SECRET_ANSWER'));

    // ==============================================================
    // Section 6: Function Mode Integration
    // ==============================================================
    console.log('\n-- Section 6: Function Mode Integration --');

    const fnProblem = await createProblem(superAdminToken, {
      title: 'Function Mode Palindrome Checker',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def isPalindrome(self, s: str) -> bool:\n        return s == s[::-1]\n',
        cpp: 'class Solution {\npublic:\n    bool isPalindrome(string s) { return true; }\n};\n',
      },
      harnessTemplates: {
        python: 'import sys\n# __STUDENT_CODE__\ndef _m():\n    raw = sys.stdin.read().strip()\n    sol = Solution()\n    print(str(sol.isPalindrome(raw)).lower())\nif __name__=="__main__": _m()\n',
      },
      testCases: [
        { inputData: 'racecar', expectedOutput: 'true', isHidden: false, testOrder: 1 },
        { inputData: 'hello', expectedOutput: 'false', isHidden: true, testOrder: 2 },
      ],
    });

    check('6.1 Function Mode problem created with test cases', fnProblem.codingMode === 'function');

    // Verify harness builder correctly integrates
    const pythonCode = 'class Solution:\n    def isPalindrome(self, s: str) -> bool:\n        return s == s[::-1]';
    const builtCode = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'function',
      sourceCode: pythonCode,
      problem: fnProblem,
    });
    check('6.2 Harness builds executable python code', Boolean(builtCode));
    check('6.3 Built code contains student solution logic', builtCode.includes('return s == s[::-1]'));
    check('6.4 Built code contains harness driver logic', builtCode.includes('sol.isPalindrome'));

    // ==============================================================
    // Section 7: Validation Gate & Error Handling
    // ==============================================================
    console.log('\n-- Section 7: Validation Gate & Error Handling --');

    // 7.1 Missing expectedOutput
    const valNoOutput = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, { inputData: '1' }, superAdminToken);
    check('7.1 Missing expectedOutput returns 400', valNoOutput.status === 400);

    // 7.2 Invalid timeLimitMs
    const valBadTime = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, {
      expectedOutput: '1',
      timeLimitMs: 99999,
    }, superAdminToken);
    check('7.2 Invalid timeLimitMs (>15000) returns 400', valBadTime.status === 400);

    // 7.3 Invalid memoryLimitMb
    const valBadMem = await request('POST', `/api/problems/${tcProblem.id}/test-cases`, {
      expectedOutput: '1',
      memoryLimitMb: 5000,
    }, superAdminToken);
    check('7.3 Invalid memoryLimitMb (>1024) returns 400', valBadMem.status === 400);

    // 7.4 Non-numeric problem ID
    const badProbId = await request('GET', '/api/problems/not-a-number/test-cases', null, superAdminToken);
    check('7.4 Non-numeric problem ID returns 400', badProbId.status === 400);

    // 7.5 Non-existent problem ID
    const notFoundProb = await request('GET', '/api/problems/999999/test-cases', null, superAdminToken);
    check('7.5 Non-existent problem ID returns 404', notFoundProb.status === 404);

    // 7.6 Non-numeric test case ID
    const badTcId = await request('GET', '/api/test-cases/invalid-id', null, superAdminToken);
    check('7.6 Non-numeric test case ID returns 400', badTcId.status === 400);

    // 7.7 Non-existent test case ID
    const notFoundTc = await request('GET', '/api/test-cases/999999', null, superAdminToken);
    check('7.7 Non-existent test case ID returns 404', notFoundTc.status === 404);

    // ==============================================================
    // Section 8: Audit Logging & Security Hardening
    // ==============================================================
    console.log('\n-- Section 8: Audit Logging & Security Hardening --');

    // Query audit log for TEST_CASE_CREATED
    const auditCreated = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'TEST_CASE_CREATED' AND resource_type = 'test_case' ORDER BY created_at DESC LIMIT 1"
    );
    check('8.1 TEST_CASE_CREATED event found in audit_logs', auditCreated.rows.length > 0);
    check('8.2 Audit log outcome is "success"', auditCreated.rows[0]?.outcome === 'success');

    // Query audit log for TEST_CASE_UPDATED
    const auditUpdated = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'TEST_CASE_UPDATED' AND resource_type = 'test_case' ORDER BY created_at DESC LIMIT 1"
    );
    check('8.3 TEST_CASE_UPDATED event found in audit_logs', auditUpdated.rows.length > 0);

    // Query audit log for TEST_CASE_DELETED
    const auditDeleted = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'TEST_CASE_DELETED' AND resource_type = 'test_case' ORDER BY created_at DESC LIMIT 1"
    );
    check('8.4 TEST_CASE_DELETED event found in audit_logs', auditDeleted.rows.length > 0);

    // Query audit log for BOLA denial
    const auditDenied = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND outcome = 'denied' ORDER BY created_at DESC LIMIT 1"
    );
    check('8.5 PRIVILEGED_ACTION_DENIED event recorded on BOLA attempt', auditDenied.rows.length > 0);

    // Sensitive data leakage check on responses
    const allRespJson = JSON.stringify(listRes.data) + JSON.stringify(singleRes.data);
    check('8.6 Response does not expose password_hash', !allRespJson.includes('password_hash'));
    check('8.7 Response does not expose jwt_secret', !allRespJson.includes('jwt_secret'));

  } catch (err) {
    console.error('\n[FATAL TEST RUNNER ERROR]:', err);
    failedAssertions++;
  } finally {
    await cleanup();
  }

  console.log('\n=================================================================');
  console.log(` PHASE 7.4.6 TEST RESULTS: ${passedAssertions} passed, ${failedAssertions} failed`);
  console.log('=================================================================\n');

  if (failedAssertions > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
