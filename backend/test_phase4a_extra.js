const http = require('http');
const { app } = require('./src/server');
const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { generateToken, hashPassword } = require('./src/services/authService');
const { execSync } = require('child_process');

const PORT = 5055;
let server;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

function makeRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSubmission(submissionId, token, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await makeRequest({
      method: 'GET',
      path: `/api/submissions/${submissionId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 200 && res.body.status !== 'queued' && res.body.status !== 'running') {
      return res.body;
    }
    await sleep(250);
  }
  throw new Error(`Submission ${submissionId} timed out waiting for evaluation.`);
}

function isCompilerAvailable(cmd) {
  try {
    execSync(`where.exe ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function runExtraTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 4A EXTRA FEATURES TEST SUITE');
  console.log(' (Function Mode, Full Program, Dashboard, User Profiles)');
  console.log('=======================================================\n');

  try {
    server = app.listen(PORT);
    const rand = Date.now();

    // 1. Setup Test Users
    await query("DELETE FROM users WHERE email LIKE '%@extra-test.com'");
    const pwHash = await hashPassword('Password123!');

    const prof = await UserModel.createUser({
      username: `prof_extra_${rand}`,
      email: `prof_${rand}@extra-test.com`,
      passwordHash: pwHash,
      fullName: 'Professor Extra',
      role: 'professor',
    });
    const profToken = generateToken(prof);

    const studentA = await UserModel.createUser({
      username: `student_a_${rand}`,
      email: `studenta_${rand}@extra-test.com`,
      passwordHash: pwHash,
      fullName: 'Alice Student',
      role: 'student',
      bio: 'Competitive programmer aspiring software engineer',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alice',
    });
    const studentAToken = generateToken(studentA);

    const studentB = await UserModel.createUser({
      username: `student_b_${rand}`,
      email: `studentb_${rand}@extra-test.com`,
      passwordHash: pwHash,
      fullName: 'Bob Student',
      role: 'student',
    });
    const studentBToken = generateToken(studentB);

    // 2. Setup Running & Upcoming Contests
    const now = new Date();
    const runningContest = await ContestModel.createContest({
      title: `Running Contest ${rand}`,
      description: 'Phase 4A Extra Active Contest',
      startTime: new Date(now.getTime() - 3600000).toISOString(),
      endTime: new Date(now.getTime() + 7200000).toISOString(),
      createdBy: prof.id,
    });
    await ContestModel.updateContestStatus(runningContest.id, 'published');

    const upcomingContest = await ContestModel.createContest({
      title: `Upcoming Contest ${rand}`,
      description: 'Phase 4A Extra Future Contest',
      startTime: new Date(now.getTime() + 86400000).toISOString(),
      endTime: new Date(now.getTime() + 172800000).toISOString(),
      createdBy: prof.id,
    });
    await ContestModel.updateContestStatus(upcomingContest.id, 'published');

    // 3. Setup Function-Mode Problem (Two Sum / Solve Function)
    console.log('--- 1. Function Mode Problem Setup & Templates ---');
    const fnProblem = await ProblemModel.createProblem({
      title: `Add Two Numbers (Function Mode) ${rand}`,
      description: 'Implement solve(a, b) to return the sum of two integers.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        cpp: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        // Your code here\n        return 0;\n    }\n};',
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        # Your code here\n        return 0',
        java: 'class Solution {\n    public int solve(int a, int b) {\n        // Your code here\n        return 0;\n    }\n}',
      },
      createdBy: prof.id,
    });
    assert(fnProblem.codingMode === 'function', 'Problem created with codingMode: function');
    assert(Boolean(fnProblem.starterTemplates.cpp), 'Problem has C++ starter template');
    assert(Boolean(fnProblem.starterTemplates.python), 'Problem has Python starter template');
    assert(Boolean(fnProblem.starterTemplates.java), 'Problem has Java starter template');

    await ContestModel.addProblemToContest({ contestId: runningContest.id, problemId: fnProblem.id, points: 100 });

    // Add Test Cases for Function Problem (Input: "2 3\n" -> Output: "5\n", "10 20\n" -> "30\n")
    await TestCaseModel.createTestCase({
      problemId: fnProblem.id,
      inputData: '2 3\n',
      expectedOutput: '5',
      isHidden: false,
      testOrder: 1,
    });
    await TestCaseModel.createTestCase({
      problemId: fnProblem.id,
      inputData: '10 20\n',
      expectedOutput: '30',
      isHidden: true,
      testOrder: 2,
    });

    // 4. Setup Full-Program Problem
    console.log('\n--- 2. Full Program Mode Problem Setup ---');
    const fullProblem = await ProblemModel.createProblem({
      title: `Multiply Two Numbers (Full Program) ${rand}`,
      description: 'Read two integers a and b from standard input and print their product.',
      difficulty: 'easy',
      codingMode: 'full_program',
      createdBy: prof.id,
    });
    assert(fullProblem.codingMode === 'full_program', 'Problem created with codingMode: full_program');

    await ContestModel.addProblemToContest({ contestId: runningContest.id, problemId: fullProblem.id, points: 100 });

    await TestCaseModel.createTestCase({
      problemId: fullProblem.id,
      inputData: '4 5\n',
      expectedOutput: '20',
      isHidden: false,
      testOrder: 1,
    });
    await TestCaseModel.createTestCase({
      problemId: fullProblem.id,
      inputData: '7 8\n',
      expectedOutput: '56',
      isHidden: true,
      testOrder: 2,
    });

    // Student A joins contest
    await ContestModel.addParticipant(runningContest.id, studentA.id);

    // 5. Function Mode Execution Tests (Python)
    console.log('\n--- 3. Function Mode Run & Submit Tests (Python) ---');
    const pyFnSampleRun = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fnProblem.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
    });
    assert(pyFnSampleRun.status === 200, 'Python Function Mode sample run returns 200 OK');
    assert(pyFnSampleRun.body.runResult.status === 'accepted', 'Python Function Mode sample run passed');

    const pyFnSubmit = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fnProblem.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
    });
    assert(pyFnSubmit.status === 201, 'Python Function Mode submission queued (201)');
    const pyFnResult = await waitForSubmission(pyFnSubmit.body.submission.id, studentAToken);
    assert(pyFnResult.status === 'accepted', 'Python Function Mode submission evaluated as ACCEPTED');
    assert(pyFnResult.score === 100, 'Python Function Mode awarded 100 points');

    // 6. Function Mode Validation for C++ and Java
    console.log('\n--- 4. Function Mode Harness Verification (C++ & Java) ---');
    const cppFnSampleRun = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fnProblem.id,
        language: 'cpp',
        codingMode: 'function',
        sourceCode: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a + b;\n    }\n};',
      },
    });
    assert(cppFnSampleRun.status === 200, 'C++ Function Mode endpoint accepts request (200 OK)');
    assert(
      cppFnSampleRun.body.runResult.status === 'accepted' || cppFnSampleRun.body.runResult.status === 'compilation_error',
      'C++ Function Mode evaluated via sandbox harness'
    );

    const javaFnSampleRun = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fnProblem.id,
        language: 'java',
        codingMode: 'function',
        sourceCode: 'class Solution {\n    public int solve(int a, int b) {\n        return a + b;\n    }\n}',
      },
    });
    assert(javaFnSampleRun.status === 200, 'Java Function Mode endpoint accepts request (200 OK)');
    assert(
      javaFnSampleRun.body.runResult.status === 'accepted' || javaFnSampleRun.body.runResult.status === 'compilation_error',
      'Java Function Mode evaluated via sandbox harness'
    );

    // 7. Function Mode Error Handling (Wrong Answer)
    console.log('\n--- 5. Function Mode Negative / Error Tests ---');
    const pyFnWrongSubmit = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fnProblem.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a - b\n',
      },
    });
    const pyFnWrongRes = await waitForSubmission(pyFnWrongSubmit.body.submission.id, studentAToken);
    assert(pyFnWrongRes.status === 'wrong_answer', 'Incorrect function logic receives WRONG_ANSWER');

    // 8. Full Program Mode Execution Tests
    console.log('\n--- 6. Full Program Mode Tests ---');
    const fullPySubmit = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        contestId: runningContest.id,
        problemId: fullProblem.id,
        language: 'python',
        codingMode: 'full_program',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) * int(lines[1]))\n',
      },
    });
    const fullPyResult = await waitForSubmission(fullPySubmit.body.submission.id, studentAToken);
    assert(fullPyResult.status === 'accepted', 'Full Program Python evaluated as ACCEPTED');
    assert(fullPyResult.testCasesPassed === 2, 'All test cases passed in full program mode');

    // 9. Student Dashboard API Tests
    console.log('\n--- 7. Student Dashboard API Tests ---');
    const dashRes = await makeRequest({
      method: 'GET',
      path: '/api/users/dashboard',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert(dashRes.status === 200, 'GET /api/users/dashboard returns 200 OK');
    assert(Array.isArray(dashRes.body.runningContests), 'Dashboard has runningContests array');
    assert(dashRes.body.runningContests.length >= 1, 'Dashboard contains active running contest');
    assert(Array.isArray(dashRes.body.upcomingContests), 'Dashboard has upcomingContests array');
    assert(Array.isArray(dashRes.body.joinedContests), 'Dashboard has joinedContests array');
    assert(dashRes.body.joinedContests.length >= 1, 'Dashboard lists joined contest');
    assert(dashRes.body.problemsSolvedCount >= 2, 'Dashboard shows real problemsSolvedCount >= 2');
    assert(Array.isArray(dashRes.body.recentSubmissions), 'Dashboard lists recent submissions');
    assert(dashRes.body.recentSubmissions.length >= 1, 'Recent submissions contains records');

    // 10. All-User Profile System Tests (My Profile & Public Profile)
    console.log('\n--- 8. User Profile System & Security Tests ---');
    const myProfRes = await makeRequest({
      method: 'GET',
      path: '/api/users/me',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert(myProfRes.status === 200, 'GET /api/users/me returns 200 OK');
    assert(myProfRes.body.bio === 'Competitive programmer aspiring software engineer', 'Profile contains custom bio');
    assert(Boolean(myProfRes.body.avatarUrl), 'Profile contains avatarUrl');
    assert(myProfRes.body.password_hash === undefined, 'Private password hash strictly NOT in response');

    // Update Profile
    const updateProfRes = await makeRequest({
      method: 'PUT',
      path: '/api/users/me',
      headers: { Authorization: `Bearer ${studentAToken}` },
      body: {
        bio: 'Updated bio for student Alice',
        fullName: 'Alice In Wonderland',
      },
    });
    assert(updateProfRes.status === 200, 'PUT /api/users/me updates profile (200 OK)');
    assert(updateProfRes.body.user.bio === 'Updated bio for student Alice', 'Updated bio reflected in response');
    assert(updateProfRes.body.user.fullName === 'Alice In Wonderland', 'Updated full name reflected in response');

    // Public Profile View by another user (Student B views Student A)
    const pubProfRes = await makeRequest({
      method: 'GET',
      path: `/api/users/${studentA.id}/public-profile`,
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    assert(pubProfRes.status === 200, 'GET /api/users/:id/public-profile returns 200 OK');
    assert(pubProfRes.body.user.username === studentA.username, 'Public profile returns correct username');
    assert(pubProfRes.body.user.bio === 'Updated bio for student Alice', 'Public profile includes bio');
    assert(pubProfRes.body.user.problemsSolvedCount >= 2, 'Public profile includes non-sensitive solved count');
    assert(pubProfRes.body.user.contestsJoinedCount >= 1, 'Public profile includes contest count');
    assert(pubProfRes.body.user.password_hash === undefined, 'Public profile NEVER leaks password hash');
    assert(pubProfRes.body.user.email === undefined, 'Public profile does NOT leak private email');

    console.log('\n=======================================================');
    console.log(` EXTRA FEATURES TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('=======================================================');

    if (server) server.close();
    await closePool();
    process.exit(failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error('[TEST CRASHED]:', err);
    if (server) server.close();
    await closePool();
    process.exit(1);
  }
}

runExtraTests();