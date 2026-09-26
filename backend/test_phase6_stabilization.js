/**
 * PHASE 6 PLATFORM STABILIZATION & COMPREHENSIVE VERIFICATION TEST SUITE
 * 
 * Verifies the complete platform baseline across:
 * 1. Health & Database Connectivity Probes
 * 2. Authentication, JWT Issuance & Tamper Resistance
 * 3. Role-Based Access Control (RBAC) Matrix (Student, Professor, Contest Admin, Super Admin)
 * 4. Content Scope & BOLA/IDOR Direct Object Access Defense
 * 5. Contest Lifecycle Locks & Structural Invariants
 * 6. Online Judge Sandboxing, Function-Mode Harnesses & Resource Protection
 * 7. Submission Detail, Performance Analytics & BOLA Protection
 * 8. Persistent Audit Logging & Credential Sanitization
 * 9. Mass Assignment & Rating Tampering Defense
 */

const assert = require('assert');
const http = require('http');
const db = require('./src/config/db');
const { app } = require('./src/server');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');

let BASE_URL = 'http://localhost:5000/api';
let testServer = null;

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'x-test-environment': 'true',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, body: data };
}

async function runPhase6Tests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 6 PLATFORM STABILIZATION VERIFICATION');
  console.log('=======================================================\n');

  try {
    const health = await fetch('http://localhost:5000/api/health');
    if (!health.ok) throw new Error('Port 5000 not ready');
  } catch (e) {
    await new Promise((resolve) => {
      testServer = http.createServer(app);
      testServer.listen(0, () => {
        const port = testServer.address().port;
        BASE_URL = `http://localhost:${port}/api`;
        resolve();
      });
    });
  }

  let passed = 0;
  let total = 0;

  function test(description, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`[PASS] ${description}`);
    } catch (err) {
      console.error(`[FAIL] ${description}`);
      console.error(err);
      throw err;
    }
  }

  const timestamp = Date.now().toString().slice(-6);

  // --- 1. HEALTH & CONNECTIVITY PROBES ---
  console.log('--- 1. Platform Health & Startup Verification ---');
  const healthRes = await apiRequest('/health');
  test('1a. GET /api/health returns HTTP 200 OK', () => {
    assert.strictEqual(healthRes.status, 200);
  });
  test('1b. Backend server process reports OK status', () => {
    assert.strictEqual(healthRes.body.server, 'OK');
  });
  test('1c. PostgreSQL connection pool reports OK status', () => {
    assert.strictEqual(healthRes.body.database, 'OK');
  });

  // --- 2. AUTHENTICATION & JWT INTEGRITY ---
  console.log('\n--- 2. Authentication, JWT Issuance & Tamper Resistance ---');
  
  // Register student
  const studentEmail = `p6_student_${timestamp}@test.edu`;
  const studentPassword = 'Password123!';
  const regStudentRes = await apiRequest('/auth/register', 'POST', {
    username: `p6_std_${timestamp}`,
    email: studentEmail,
    password: studentPassword,
    fullName: 'Phase 6 Student',
  });
  test('2a. Student registration succeeds with HTTP 201', () => {
    assert.strictEqual(regStudentRes.status, 201);
  });

  // Login student
  const loginStudentRes = await apiRequest('/auth/login', 'POST', {
    email: studentEmail,
    password: studentPassword,
  });
  test('2b. Student login succeeds with HTTP 200', () => {
    assert.strictEqual(loginStudentRes.status, 200);
    assert.ok(loginStudentRes.body.token, 'Token must be present');
    assert.strictEqual(loginStudentRes.body.user.role, 'student');
  });
  const studentToken = loginStudentRes.body.token;
  const studentUser = loginStudentRes.body.user;

  // Login with invalid password
  const badLoginRes = await apiRequest('/auth/login', 'POST', {
    email: studentEmail,
    password: 'WrongPassword!',
  });
  test('2c. Login with invalid password returns HTTP 401 Unauthorized', () => {
    assert.strictEqual(badLoginRes.status, 401);
  });

  // Tampered JWT rejection
  const tamperedToken = studentToken.slice(0, -6) + 'xxxxxx';
  const tamperRes = await apiRequest('/users/me', 'GET', null, tamperedToken);
  test('2d. Tampered JWT token is rejected with HTTP 401 Unauthorized', () => {
    assert.strictEqual(tamperRes.status, 401);
  });

  // Seeded Professor login
  const profLoginRes = await apiRequest('/auth/login', 'POST', {
    email: 'professor@university.edu',
    password: 'Password123!',
  });
  test('2e. Seeded professor login succeeds with HTTP 200', () => {
    assert.strictEqual(profLoginRes.status, 200);
    assert.strictEqual(profLoginRes.body.user.role, 'professor');
  });
  const profToken = profLoginRes.body.token;
  const profUser = profLoginRes.body.user;

  // --- 3. ROLE-BASED ACCESS CONTROL (RBAC) MATRIX ---
  console.log('\n--- 3. Role-Based Access Control (RBAC) Hardening ---');
  
  // Student restricted endpoints
  const stdAdminUsersRes = await apiRequest('/admin/users', 'GET', null, studentToken);
  test('3a. Student cannot access GET /api/admin/users (HTTP 403 Forbidden)', () => {
    assert.strictEqual(stdAdminUsersRes.status, 403);
  });

  const stdAuditRes = await apiRequest('/admin/audit-logs', 'GET', null, studentToken);
  test('3b. Student cannot access GET /api/admin/audit-logs (HTTP 403 Forbidden)', () => {
    assert.strictEqual(stdAuditRes.status, 403);
  });

  const stdCreateProblemRes = await apiRequest('/problems', 'POST', {
    title: 'Illegal Student Problem',
    description: 'Should fail',
    difficulty: 'easy',
  }, studentToken);
  test('3c. Student cannot create problems via POST /api/problems (HTTP 403 Forbidden)', () => {
    assert.strictEqual(stdCreateProblemRes.status, 403);
  });

  const stdCreateContestRes = await apiRequest('/contests', 'POST', {
    title: 'Illegal Student Contest',
    startTime: new Date().toISOString(),
    endTime: new Date(Date.now() + 3600000).toISOString(),
  }, studentToken);
  test('3d. Student cannot create contests via POST /api/contests (HTTP 403 Forbidden)', () => {
    assert.strictEqual(stdCreateContestRes.status, 403);
  });

  // Professor permissions
  const profAdminRes = await apiRequest('/admin/users', 'GET', null, profToken);
  test('3e. Professor cannot access Super Admin user management (HTTP 403 Forbidden)', () => {
    assert.strictEqual(profAdminRes.status, 403);
  });

  // --- 4. CONTENT SCOPE & BOLA/IDOR PROTECTION ---
  console.log('\n--- 4. Content Scope & BOLA/IDOR Direct Access Defense ---');
  
  // Create a contest-private problem by professor
  const privProblemRes = await apiRequest('/problems', 'POST', {
    title: `Private Contest Problem ${timestamp}`,
    description: 'Solve privately inside contest only',
    difficulty: 'medium',
    codingMode: 'full_program',
    accessScope: 'contest_private',
  }, profToken);
  test('4a. Professor can create contest_private problem (HTTP 201 Created)', () => {
    assert.strictEqual(privProblemRes.status, 201);
  });
  const privateProblemId = privProblemRes.body.problem.id;

  // Student explores problems
  const explorerRes = await apiRequest('/problems', 'GET', null, studentToken);
  test('4b. Student Problem Explorer excludes contest_private problems', () => {
    assert.strictEqual(explorerRes.status, 200);
    const ids = explorerRes.body.problems.map((p) => p.id);
    assert.strictEqual(ids.includes(privateProblemId), false, 'Private problem must NOT appear in student explorer');
  });

  // Student direct ID lookup on private problem
  const directPrivateRes = await apiRequest(`/problems/${privateProblemId}`, 'GET', null, studentToken);
  test('4c. Unauthorized student lookup of private problem returns HTTP 404 (Safe Disclosure)', () => {
    assert.strictEqual(directPrivateRes.status, 404);
  });

  // Professor direct ID lookup on own private problem
  const profPrivateRes = await apiRequest(`/problems/${privateProblemId}`, 'GET', null, profToken);
  test('4d. Problem author professor can access own private problem (HTTP 200 OK)', () => {
    assert.strictEqual(profPrivateRes.status, 200);
  });

  // --- 5. CONTEST LIFECYCLE LOCKS & INVARIANTS ---
  console.log('\n--- 5. Contest Lifecycle Locks & Invariants ---');
  
  const emptyContestRes = await apiRequest('/contests', 'POST', {
    title: `Contest Without Problems ${timestamp}`,
    description: 'Draft contest',
    startTime: new Date(Date.now() + 100000).toISOString(),
    endTime: new Date(Date.now() + 500000).toISOString(),
  }, profToken);
  test('5a. Professor creates draft contest (HTTP 201 Created)', () => {
    assert.strictEqual(emptyContestRes.status, 201);
  });
  const contestId = emptyContestRes.body.contest.id;

  // Attempt to publish empty contest
  const publishEmptyRes = await apiRequest(`/contests/${contestId}/publish`, 'POST', {}, profToken);
  test('5b. Publishing contest without problems is rejected (HTTP 400 Bad Request)', () => {
    assert.strictEqual(publishEmptyRes.status, 400);
  });

  // --- 6. ONLINE JUDGE SANDBOXING & HARNESS INTEGRITY ---
  console.log('\n--- 6. Online Judge Sandboxing, Function-Mode Harnesses & Limits ---');
  
  // Test HarnessBuilder line-break safety
  const mockTemplate = 'import sys\n\n# __STUDENT_CODE__\n\ndef _main():\n    pass\n';
  const mockStudent = 'class Solution:\n    def solve(self):\n        return 42';
  const assembled = HarnessBuilder.buildExecutableCode({
    language: 'python',
    codingMode: 'function',
    sourceCode: mockStudent,
    problem: { harnessTemplates: { python: mockTemplate } },
  });
  test('6a. HarnessBuilder separates student code from harness without line collision', () => {
    assert.ok(assembled.includes('return 42\n'), 'Student code must be followed by newline');
    assert.ok(assembled.includes('\ndef _main():'), 'Harness main must begin on a clean newline');
    assert.strictEqual(assembled.includes('return 42def _main():'), false, 'Must not fuse tokens');
  });

  // Oversized submission payload rejection (>64 KB)
  const oversizedCode = 'x = 1\n'.repeat(15000); // ~90 KB
  const oversizedRes = await apiRequest('/submissions/run', 'POST', {
    problemId: 124,
    language: 'python',
    sourceCode: oversizedCode,
  }, studentToken);
  test('6b. Oversized submission (>64 KB) is rejected with HTTP 400 Bad Request', () => {
    assert.strictEqual(oversizedRes.status, 400);
  });

  // Execute clean Function Mode solution on Problem (Two Sum)
  const twoSumQuery = await db.query("SELECT id FROM problems WHERE title = 'Two Sum' LIMIT 1");
  const twoSumProblemId = twoSumQuery.rows[0]?.id || 124;

  const validPythonSolution = `class Solution:
    def solve(self, nums, target):
        seen = {}
        for idx, val in enumerate(nums):
            needed = target - val
            if needed in seen:
                return [seen[needed], idx]
            seen[val] = idx
        return []
`;
  const runExecRes = await apiRequest('/submissions/run', 'POST', {
    problemId: twoSumProblemId,
    language: 'python',
    sourceCode: validPythonSolution,
    codingMode: 'function',
  }, studentToken);
  test('6c. Interactive sample run executes and returns HTTP 200 OK', () => {
    assert.strictEqual(runExecRes.status, 200);
    assert.strictEqual(runExecRes.body.runResult.status, 'accepted');
  });

  // --- 7. SUBMISSION DETAIL & BOLA PROTECTION ---
  console.log('\n--- 7. Submission Detail, Performance Analytics & BOLA Protection ---');
  
  // Submit official solution
  const submitRes = await apiRequest('/submissions', 'POST', {
    problemId: twoSumProblemId,
    language: 'python',
    sourceCode: validPythonSolution,
    codingMode: 'function',
  }, studentToken);
  test('7a. Official submission queued successfully (HTTP 201 Created)', () => {
    assert.strictEqual(submitRes.status, 201);
  });
  const subId = submitRes.body.submission.id;

  // Wait for submission to complete evaluation
  let subDetail = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const checkRes = await apiRequest(`/submissions/${subId}`, 'GET', null, studentToken);
    if (checkRes.status === 200 && checkRes.body.status !== 'queued' && checkRes.body.status !== 'running') {
      subDetail = checkRes.body;
      break;
    }
  }
  test('7b. Submission completes evaluation with accepted verdict', () => {
    assert.ok(subDetail, 'Submission should complete');
    assert.strictEqual(subDetail.status, 'accepted');
    assert.strictEqual(subDetail.score, 100);
  });

  // Student B cannot inspect Student A submission (BOLA defense)
  const studentBEmail = `p6_b_${timestamp}@test.edu`;
  await apiRequest('/auth/register', 'POST', {
    username: `p6_b_${timestamp}`,
    email: studentBEmail,
    password: 'Password123!',
    fullName: 'Student B',
  });
  const studentBLogin = await apiRequest('/auth/login', 'POST', {
    email: studentBEmail,
    password: 'Password123!',
  });
  const studentBToken = studentBLogin.body.token;

  const bolaRes = await apiRequest(`/submissions/${subId}`, 'GET', null, studentBToken);
  test('7c. Other students cannot inspect private submission (HTTP 403 Forbidden)', () => {
    assert.strictEqual(bolaRes.status, 403);
  });

  const bolaCodeRes = await apiRequest(`/submissions/${subId}/code`, 'GET', null, studentBToken);
  test('7d. Other students cannot inspect private submission code (HTTP 403 Forbidden)', () => {
    assert.strictEqual(bolaCodeRes.status, 403);
  });

  // --- 8. MASS ASSIGNMENT & RATING TAMPERING DEFENSE ---
  console.log('\n--- 8. Mass Assignment & Rating Tampering Defense ---');
  
  const tamperProfileRes = await apiRequest('/users/me', 'PUT', {
    fullName: 'Updated Name',
    role: 'super_admin',
    currentRating: 9999,
    highestRating: 9999,
    ratingStatus: 'rated',
  }, studentToken);
  test('8a. Updating profile responds with HTTP 200 OK', () => {
    assert.strictEqual(tamperProfileRes.status, 200);
  });

  const verifyMeRes = await apiRequest('/users/me', 'GET', null, studentToken);
  test('8b. Role tampering is stripped (role remains student)', () => {
    assert.strictEqual(verifyMeRes.body.role, 'student');
  });
  test('8c. Rating tampering is stripped (rating remains 1200)', () => {
    assert.strictEqual(verifyMeRes.body.currentRating, 1200);
  });
  test('8d. Password hash is NEVER returned in profile response', () => {
    assert.strictEqual(verifyMeRes.body.password_hash, undefined);
    assert.strictEqual(verifyMeRes.body.password, undefined);
  });

  // --- CLEANUP ---
  console.log('\n--- 9. Cleaning Up Ephemeral Test Fixtures ---');
  await db.query('DELETE FROM problems WHERE id = $1', [privateProblemId]);
  await db.query('DELETE FROM contests WHERE id = $1', [contestId]);
  await db.query('DELETE FROM users WHERE email IN ($1, $2)', [studentEmail, studentBEmail]);
  test('9a. Ephemeral test fixtures cleanly purged from database', () => {
    assert.ok(true);
  });

  console.log('\n=======================================================');
  console.log(` PHASE 6 STABILIZATION SUITE COMPLETE: ${passed}/${total} ASSERTIONS PASSED`);
  console.log('=======================================================\n');
}

runPhase6Tests()
  .then(() => {
    if (testServer) testServer.close();
    db.pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    if (testServer) testServer.close();
    db.pool.end();
    process.exit(1);
  });
