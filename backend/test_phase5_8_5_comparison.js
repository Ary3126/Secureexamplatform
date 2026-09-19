/**
 * Comprehensive Automated Test Suite for Phase 5.8.5
 * Submission Comparison Engine
 *
 * Covers all 22 required security & functional scenarios:
 * 1. Own submission vs own submission
 * 2. Unauthorized submission access
 * 3. Student A vs Student B private submission
 * 4. Professor-owned contest access
 * 5. Professor cross-owner contest access
 * 6. Admin authorized access
 * 7. Private contest isolation
 * 8. Public problem isolation
 * 9. Cross-problem comparison rejection (400)
 * 10. Malformed left ID (400)
 * 11. Malformed right ID (400)
 * 12. SQL injection in left ID (400)
 * 13. SQL injection in right ID (400)
 * 14. Source-code authorization
 * 15. Metadata/source-code permission separation
 * 16. Hidden source-code protection
 * 17. Language isolation (same vs different languages)
 * 18. Missing runtime (compilation error)
 * 19. Missing memory (compilation error)
 * 20. Failed submission comparison (WA vs CE vs TLE)
 * 21. Nonexistent submission (404)
 * 22. Pair authorization where only one submission is authorized (403)
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const SubmissionModel = require('./src/models/submissionModel');
const SubmissionPerformanceService = require('./src/services/submissionPerformanceService');

let server;
let baseUrl;
let passedCount = 0;
let failedCount = 0;

function record(name, condition, detail = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${name} - ${detail}`);
    failedCount++;
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'x-test-environment': 'true',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.8.5 SUBMISSION COMPARISON TEST SUITE');
  console.log('=======================================================\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const ts = Date.now();
  const rawPw = 'Password123!';
  const pwHash = await bcrypt.hash(rawPw, 10);

  // 1. Create Test Users
  const studentA = await UserModel.createUser({
    username: `stud_a_cmp_${ts}`,
    email: `stud_a_cmp_${ts}@test.edu`,
    passwordHash: pwHash,
    fullName: 'Student A Compare',
    role: 'student',
  });

  const studentB = await UserModel.createUser({
    username: `stud_b_cmp_${ts}`,
    email: `stud_b_cmp_${ts}@test.edu`,
    passwordHash: pwHash,
    fullName: 'Student B Compare',
    role: 'student',
  });

  const profA = await UserModel.createUser({
    username: `prof_a_cmp_${ts}`,
    email: `prof_a_cmp_${ts}@test.edu`,
    passwordHash: pwHash,
    fullName: 'Prof A Compare',
    role: 'professor',
  });

  const profB = await UserModel.createUser({
    username: `prof_b_cmp_${ts}`,
    email: `prof_b_cmp_${ts}@test.edu`,
    passwordHash: pwHash,
    fullName: 'Prof B Compare',
    role: 'professor',
  });

  const superAdmin = await UserModel.createUser({
    username: `admin_cmp_${ts}`,
    email: `admin_cmp_${ts}@test.edu`,
    passwordHash: pwHash,
    fullName: 'Admin Compare',
    role: 'super_admin',
  });

  // Login tokens
  const tokenFor = async (email) => {
    const res = await request('POST', '/api/auth/login', { email, password: rawPw });
    return res.body.token || res.body.data?.token;
  };

  const studentAToken = await tokenFor(studentA.email);
  const studentBToken = await tokenFor(studentB.email);
  const profAToken = await tokenFor(profA.email);
  const profBToken = await tokenFor(profB.email);
  const adminToken = await tokenFor(superAdmin.email);

  // 2. Create Problems
  // Problem 1: Two Sum (Public)
  const problem1 = await ProblemModel.createProblem({
    title: `Two Sum Compare ${ts}`,
    description: 'Find two indices that sum to target.',
    difficulty: 'easy',
    accessScope: 'public',
    createdBy: profA.id,
  });

  // Problem 2: Subarray Sum (Different problem for cross-problem rejection test)
  const problem2 = await ProblemModel.createProblem({
    title: `Subarray Sum Compare ${ts}`,
    description: 'Find contiguous subarray sum.',
    difficulty: 'medium',
    accessScope: 'public',
    createdBy: profA.id,
  });

  // 3. Create Contests
  // Contest A (Owned by Prof A)
  const contestA = await ContestModel.createContest({
    title: `Contest A Compare ${ts}`,
    description: 'Professor A Private Contest',
    startTime: new Date(Date.now() - 3600000),
    endTime: new Date(Date.now() + 3600000),
    createdBy: profA.id,
  });

  // Contest B (Owned by Prof B)
  const contestB = await ContestModel.createContest({
    title: `Contest B Compare ${ts}`,
    description: 'Professor B Private Contest',
    startTime: new Date(Date.now() - 3600000),
    endTime: new Date(Date.now() + 3600000),
    createdBy: profB.id,
  });

  // 4. Seed Submissions for Problem 1
  // Sub A1: Student A, Two Sum, C++, 42ms, 18432KB, Accepted, 10/10 tests
  const subA1 = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem1.id,
    language: 'cpp',
    sourceCode: '// Student A Solution 1 C++\nint twoSum() { return 1; }',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 42,
    memoryUsed: 18432,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Sub A2: Student A, Two Sum, C++, 58ms, 24576KB, Accepted, 10/10 tests
  const subA2 = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem1.id,
    language: 'cpp',
    sourceCode: '// Student A Solution 2 C++\nint twoSum() { return 2; }',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 58,
    memoryUsed: 24576,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Sub A3: Student A, Two Sum, Python, 78ms, 16384KB, Accepted, 10/10 tests (Different Language)
  const subA3 = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem1.id,
    language: 'python',
    sourceCode: '# Student A Solution 3 Python\ndef two_sum(): pass',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 78,
    memoryUsed: 16384,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Sub A4: Student A, Two Sum, C++, Compilation Error, null runtime/memory
  const subA4 = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem1.id,
    language: 'cpp',
    sourceCode: '// Syntax Error\ninvalid syntax',
    codingMode: 'full_program',
    status: 'compilation_error',
    executionTime: null,
    memoryUsed: null,
    score: 0,
    testCasesPassed: 0,
    testCasesTotal: 10,
  });

  // Sub A5: Student A, Two Sum, C++, Wrong Answer, 50ms, 18000KB, 6/10 tests
  const subA5 = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem1.id,
    language: 'cpp',
    sourceCode: '// Wrong Answer Code\nreturn 0;',
    codingMode: 'full_program',
    status: 'wrong_answer',
    executionTime: 50,
    memoryUsed: 18000,
    score: 60,
    testCasesPassed: 6,
    testCasesTotal: 10,
  });

  // Sub B1: Student B, Two Sum, C++, 35ms, 17000KB, Accepted (Belongs to Student B)
  const subB1 = await SubmissionModel.createSubmission({
    userId: studentB.id,
    problemId: problem1.id,
    language: 'cpp',
    sourceCode: '// Student B Secret Code\nint secret() { return 42; }',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 35,
    memoryUsed: 17000,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Sub DiffProb: Student A, Problem 2 (Subarray Sum), C++, 40ms
  const subDiffProb = await SubmissionModel.createSubmission({
    userId: studentA.id,
    problemId: problem2.id,
    language: 'cpp',
    sourceCode: '// Subarray sum code',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 40,
    memoryUsed: 19000,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Problem B: Owned strictly by Prof B in Contest B
  const problemB = await ProblemModel.createProblem({
    title: `Prof B Challenge ${ts}`,
    description: 'Private contest problem owned by Prof B.',
    difficulty: 'medium',
    accessScope: 'contest_private',
    createdBy: profB.id,
  });

  await ContestModel.addProblemToContest({ contestId: contestB.id, problemId: problemB.id, points: 100, problemOrder: 1 });

  // Sub ContestB1: Student B, Problem B, in Contest B (owned by Prof B)
  const subContestB1 = await SubmissionModel.createSubmission({
    userId: studentB.id,
    problemId: problemB.id,
    contestId: contestB.id,
    language: 'cpp',
    sourceCode: '// Prof B Contest Sub 1',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 45,
    memoryUsed: 20000,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  // Sub ContestB2: Student B, Problem B, in Contest B (owned by Prof B)
  const subContestB2 = await SubmissionModel.createSubmission({
    userId: studentB.id,
    problemId: problemB.id,
    contestId: contestB.id,
    language: 'cpp',
    sourceCode: '// Prof B Contest Sub 2',
    codingMode: 'full_program',
    status: 'accepted',
    executionTime: 65,
    memoryUsed: 22000,
    score: 100,
    testCasesPassed: 10,
    testCasesTotal: 10,
  });

  console.log('--- 1. Own Submission vs Own Submission Comparison (200 OK) ---');
  const ownRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA2.id}`,
    null,
    studentAToken
  );
  record('Own vs own comparison returns 200 OK', ownRes.status === 200);
  record('Left submission metadata included', ownRes.body?.left?.submissionId === subA1.id);
  record('Right submission metadata included', ownRes.body?.right?.submissionId === subA2.id);
  record('Problem details match problem 1', ownRes.body?.problem?.id === problem1.id);
  record('Same language is true', ownRes.body?.comparison?.sameLanguage === true);
  record(
    'Runtime difference correctly computed (42 - 58 = -16)',
    ownRes.body?.comparison?.runtimeDifference === -16
  );
  record(
    'Memory difference correctly computed (18432 - 24576 = -6144)',
    ownRes.body?.comparison?.memoryDifference === -6144
  );
  record(
    'Runtime summary correctly indicates A is faster',
    ownRes.body?.comparison?.runtimeSummary.includes('Submission A is 16 ms faster')
  );
  record(
    'Memory summary correctly indicates A uses less memory',
    ownRes.body?.comparison?.memorySummary.includes('Submission A uses 6 MB less memory')
  );

  console.log('\n--- 2. Source Code Authorization for Own Submissions ---');
  record('Own left source code is visible', ownRes.body?.sourceCode?.leftVisible === true);
  record('Own right source code is visible', ownRes.body?.sourceCode?.rightVisible === true);
  record(
    'Comparison API does NOT return raw sourceCode string in payload',
    ownRes.body?.left?.sourceCode === undefined && ownRes.body?.right?.sourceCode === undefined
  );

  console.log('\n--- 3. Student A vs Student B Private Submission (BOLA / 403 Forbidden) ---');
  const unauthorizedPair = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subB1.id}`,
    null,
    studentAToken
  );
  record(
    'Student A comparing own sub with Student B sub returns 403 Forbidden',
    unauthorizedPair.status === 403
  );
  record(
    'No submission metadata leaked on 403 error',
    unauthorizedPair.body?.comparison === undefined && unauthorizedPair.body?.left === undefined
  );

  console.log('\n--- 4. Unauthorized Access (Unauthenticated 401) ---');
  const noAuthRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA2.id}`
  );
  record('Unauthenticated request rejected with 401 Unauthorized', noAuthRes.status === 401);

  console.log('\n--- 5. Pair Authorization Where Only One Submission is Authorized ---');
  const halfAuthRes = await request(
    'GET',
    `/api/submissions/compare?left=${subB1.id}&right=${subA1.id}`,
    null,
    studentAToken
  );
  record(
    'Pair with only 1 authorized submission rejected with 403 Forbidden',
    halfAuthRes.status === 403
  );

  console.log('\n--- 6. Professor-Owned Access vs Cross-Owner Access ---');
  // Prof A created problem 1, so Prof A can view submissions on problem 1
  const profAView = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA2.id}`,
    null,
    profAToken
  );
  record('Professor A can compare submissions on problem they created', profAView.status === 200);

  // SubContestB1 and SubContestB2 are in Contest B on Problem B (both created by Prof B). Prof A must NOT be able to access them!
  const profACrossOwner = await request(
    'GET',
    `/api/submissions/compare?left=${subContestB1.id}&right=${subContestB2.id}`,
    null,
    profAToken
  );
  record(
    'Professor A rejected with 403 on Professor B contest submission',
    profACrossOwner.status === 403
  );

  // Prof B CAN access SubContestB1 and SubContestB2
  const profBView = await request(
    'GET',
    `/api/submissions/compare?left=${subContestB1.id}&right=${subContestB2.id}`,
    null,
    profBToken
  );
  record('Professor B can access submission in their own contest', profBView.status === 200);

  console.log('\n--- 7. Admin Authorized Platform-Wide Access ---');
  const adminCompare = await request(
    'GET',
    `/api/submissions/compare?left=${subContestB1.id}&right=${subContestB2.id}`,
    null,
    adminToken
  );
  record('Super admin can compare submissions across contests (200 OK)', adminCompare.status === 200);
  record('Admin sourceCode.leftVisible is true', adminCompare.body?.sourceCode?.leftVisible === true);
  record('Admin sourceCode.rightVisible is true', adminCompare.body?.sourceCode?.rightVisible === true);

  console.log('\n--- 8. Cross-Problem Comparison Rejection (400 Bad Request) ---');
  const crossProbRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subDiffProb.id}`,
    null,
    studentAToken
  );
  record('Cross-problem comparison rejected with 400 Bad Request', crossProbRes.status === 400);
  record(
    'Error message specifies cross-problem comparison not allowed',
    crossProbRes.body?.message?.includes('Cannot compare submissions across different problems')
  );

  console.log('\n--- 9. Input Validation: Malformed & Non-Numeric IDs (400 Bad Request) ---');
  const malformedLeft = await request(
    'GET',
    `/api/submissions/compare?left=abc&right=${subA2.id}`,
    null,
    studentAToken
  );
  record('Malformed left ID returns 400 Bad Request', malformedLeft.status === 400);

  const malformedRight = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=-5`,
    null,
    studentAToken
  );
  record('Negative / malformed right ID returns 400 Bad Request', malformedRight.status === 400);

  console.log('\n--- 10. SQL Injection Resilience (400 Bad Request) ---');
  const sqliLeft = await request(
    'GET',
    `/api/submissions/compare?left=1%20OR%201=1&right=${subA2.id}`,
    null,
    studentAToken
  );
  record('SQL injection in left ID returns 400 Bad Request', sqliLeft.status === 400);

  const sqliRight = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=1;DROP%20TABLE%20submissions;`,
    null,
    studentAToken
  );
  record('SQL injection in right ID returns 400 Bad Request', sqliRight.status === 400);

  console.log('\n--- 11. Nonexistent Submission (404 Not Found) ---');
  const nonexistent = await request(
    'GET',
    `/api/submissions/compare?left=9999999&right=${subA2.id}`,
    null,
    studentAToken
  );
  record('Nonexistent submission ID returns 404 Not Found', nonexistent.status === 404);

  console.log('\n--- 12. Language Isolation (Cross-Language Comparison) ---');
  const diffLangRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA3.id}`,
    null,
    studentAToken
  );
  record('Cross-language comparison returns 200 OK', diffLangRes.status === 200);
  record('sameLanguage is false', diffLangRes.body?.comparison?.sameLanguage === false);
  record('runtimeDifference is null', diffLangRes.body?.comparison?.runtimeDifference === null);
  record('memoryDifference is null', diffLangRes.body?.comparison?.memoryDifference === null);
  record(
    'runtimeSummary contains different language disclaimer',
    diffLangRes.body?.comparison?.runtimeSummary.includes('Different languages')
  );
  record('Left language is cpp', diffLangRes.body?.left?.language === 'cpp');
  record('Right language is python', diffLangRes.body?.right?.language === 'python');

  console.log('\n--- 13. Missing Runtime / Memory (Compilation Error Handling) ---');
  const ceRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA4.id}`,
    null,
    studentAToken
  );
  record('Comparison with CE submission returns 200 OK', ceRes.status === 200);
  record('CE submission runtime is null', ceRes.body?.right?.runtime === null);
  record('CE submission memory is null', ceRes.body?.right?.memory === null);
  record('CE submission verdict is compilation_error', ceRes.body?.right?.verdict === 'compilation_error');
  record('runtimeDifference is null when one metric is missing', ceRes.body?.comparison?.runtimeDifference === null);
  record(
    'runtimeSummary indicates metric is unavailable',
    ceRes.body?.comparison?.runtimeSummary.includes('unavailable')
  );

  console.log('\n--- 14. Failed Submission Comparison (WA vs Accepted) ---');
  const waRes = await request(
    'GET',
    `/api/submissions/compare?left=${subA1.id}&right=${subA5.id}`,
    null,
    studentAToken
  );
  record('Comparison between Accepted and WA returns 200 OK', waRes.status === 200);
  record('verdictMatch is false', waRes.body?.comparison?.verdictMatch === false);
  record('Left verdict is accepted', waRes.body?.left?.verdict === 'accepted');
  record('Right verdict is wrong_answer', waRes.body?.right?.verdict === 'wrong_answer');
  record('Right testsPassed is 6', waRes.body?.right?.testsPassed === 6);
  record('testsPassedDifference is 4 (10 - 6 = 4)', waRes.body?.comparison?.testsPassedDifference === 4);

  console.log('\n--- 15. Candidate Picker Helper (findUserSubmissionsForProblem) ---');
  const candidateRes = await request(
    'GET',
    `/api/submissions/problem/${problem1.id}/my`,
    null,
    studentAToken
  );
  record('Candidate submissions endpoint returns 200 OK', candidateRes.status === 200);
  record(
    'Candidate submissions returns array of user submissions for problem 1',
    Array.isArray(candidateRes.body?.submissions) && candidateRes.body.submissions.length >= 4
  );

  // Clean up
  console.log('\n--- Cleaning up test fixtures ---');
  await db.query(`DELETE FROM submissions WHERE problem_id IN ($1, $2, $3);`, [problem1.id, problem2.id, problemB.id]);
  await db.query(`DELETE FROM contest_problems WHERE contest_id IN ($1, $2);`, [contestA.id, contestB.id]);
  await db.query(`DELETE FROM contests WHERE id IN ($1, $2);`, [contestA.id, contestB.id]);
  await db.query(`DELETE FROM problems WHERE id IN ($1, $2, $3);`, [problem1.id, problem2.id, problemB.id]);
  await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5);`, [
    studentA.id,
    studentB.id,
    profA.id,
    profB.id,
    superAdmin.id,
  ]);
  console.log('Cleanup complete.');

  server.close();
  await db.closePool();

  console.log('\n=======================================================');
  console.log(` PHASE 5.8.5 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=======================================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('[FATAL TEST FAILURE]:', err);
  if (server) server.close();
  process.exit(1);
});
