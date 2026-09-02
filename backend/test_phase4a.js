const http = require('http');
const { app, startServer } = require('./src/server');
const { closePool } = require('./src/config/db');

let serverInstance;
let port;
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failedCount++;
  }
}

function makeRequest({ method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const serializedBody = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };

    if (serializedBody) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
    }

    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (serializedBody) {
      req.write(serializedBody);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSubmission(submissionId, token, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await makeRequest({
      method: 'GET',
      path: `/api/submissions/${submissionId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.body && res.body.status && res.body.status !== 'queued' && res.body.status !== 'running') {
      return res;
    }
    await sleep(400);
  }
  return await makeRequest({
    method: 'GET',
    path: `/api/submissions/${submissionId}`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 4A AUTOMATED TEST SUITE');
  console.log(' (Online Judge, Language Runner, Test Cases, Sandbox)');
  console.log('=======================================================\n');

  try {
    const rand = Math.floor(Math.random() * 90000) + 10000;

    // 1. Register users (1 professor, 2 students)
    const profEmail = `prof_p4a_${rand}@university.edu`;
    const student1Email = `student1_p4a_${rand}@university.edu`;
    const student2Email = `student2_p4a_${rand}@university.edu`;

    await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { username: `prof_p4a_${rand}`, email: profEmail, password: 'Password123!', fullName: 'Prof Phase4A' },
    });
    const { query } = require('./src/config/db');
    await query("UPDATE users SET role = 'professor' WHERE email = $1", [profEmail]);

    await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { username: `student1_p4a_${rand}`, email: student1Email, password: 'Password123!', fullName: 'Student One' },
    });
    await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { username: `student2_p4a_${rand}`, email: student2Email, password: 'Password123!', fullName: 'Student Two' },
    });

    const profLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: profEmail, password: 'Password123!' },
    });
    const profToken = profLogin.body.token;

    const student1Login = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: student1Email, password: 'Password123!' },
    });
    const student1Token = student1Login.body.token;

    const student2Login = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: student2Email, password: 'Password123!' },
    });
    const student2Token = student2Login.body.token;

    // 2. Professor creates a problem
    console.log('--- 1. Problem & Test Case Setup Tests ---');
    const probRes = await makeRequest({
      method: 'POST',
      path: '/api/problems',
      headers: { Authorization: `Bearer ${profToken}` },
      body: {
        title: `Add Two Numbers ${rand}`,
        description: 'Read two integers a and b from standard input and print their sum.',
        difficulty: 'easy',
        accessScope: 'public',
      },
    });
    assert(probRes.status === 201, 'Professor creates problem for contest (201 Created)');
    const problemId = probRes.body.problem.id;

    // 3. Test case management permissions
    const studentAddTc = await makeRequest({
      method: 'POST',
      path: `/api/problems/${problemId}/test-cases`,
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { inputData: '2 3\n', expectedOutput: '5', isHidden: false },
    });
    assert(studentAddTc.status === 403, 'Student cannot add test cases (403 Forbidden)');

    // Add visible sample test case
    const sampleTcRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${problemId}/test-cases`,
      headers: { Authorization: `Bearer ${profToken}` },
      body: { inputData: '5 7\n', expectedOutput: '12', isHidden: false, testOrder: 1 },
    });
    assert(sampleTcRes.status === 201, 'Professor adds visible sample testcase (201 Created)');

    // Add hidden test case 1
    const hiddenTc1 = await makeRequest({
      method: 'POST',
      path: `/api/problems/${problemId}/test-cases`,
      headers: { Authorization: `Bearer ${profToken}` },
      body: { inputData: '100 250\n', expectedOutput: '350', isHidden: true, testOrder: 2 },
    });
    assert(hiddenTc1.status === 201, 'Professor adds hidden testcase 1 (201 Created)');

    // Add hidden test case 2
    const hiddenTc2 = await makeRequest({
      method: 'POST',
      path: `/api/problems/${problemId}/test-cases`,
      headers: { Authorization: `Bearer ${profToken}` },
      body: { inputData: '-10 25\n', expectedOutput: '15', isHidden: true, testOrder: 3 },
    });
    assert(hiddenTc2.status === 201, 'Professor adds hidden testcase 2 (201 Created)');

    // 4. Test case isolation in public problem API
    console.log('\n--- 2. Public API Information Leak Prevention Tests ---');
    const studentViewProb = await makeRequest({
      method: 'GET',
      path: `/api/problems/${problemId}`,
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentViewProb.status === 200, 'Student views problem details (200 OK)');
    assert(Array.isArray(studentViewProb.body.sampleTestCases), 'Problem response includes sampleTestCases array');
    assert(studentViewProb.body.sampleTestCases.length === 1, 'Only visible sample test cases returned to student (length = 1)');
    assert(studentViewProb.body.sampleTestCases[0].expectedOutput === '12', 'Sample test case data matches visible test case');

    const studentGetAdminTc = await makeRequest({
      method: 'GET',
      path: `/api/problems/${problemId}/test-cases`,
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(studentGetAdminTc.status === 403, 'Student blocked from administrative testcase list endpoint (403 Forbidden)');

    // 5. Contest Setup (Running Contest)
    console.log('\n--- 3. Contest Setup & Timing Enforcement Tests ---');
    const now = new Date();
    const contestStart = new Date(now.getTime() - 1000 * 60 * 30); // 30 min ago
    const contestEnd = new Date(now.getTime() + 1000 * 60 * 60); // in 1 hour

    const contestRes = await makeRequest({
      method: 'POST',
      path: '/api/contests',
      headers: { Authorization: `Bearer ${profToken}` },
      body: {
        title: `Phase 4A Coding Contest ${rand}`,
        description: 'Online Judge Live Examination',
        startTime: contestStart.toISOString(),
        endTime: contestEnd.toISOString(),
      },
    });
    const contestId = contestRes.body.contest.id;

    // Attach problem to contest
    await makeRequest({
      method: 'POST',
      path: `/api/contests/${contestId}/problems`,
      headers: { Authorization: `Bearer ${profToken}` },
      body: { problemId: problemId, points: 100 },
    });

    // Try submitting to draft contest
    const draftSub = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: 'print(12)' },
    });
    assert(draftSub.status === 400, 'Submission to unpublished draft contest rejected (400 Bad Request)');

    // Publish contest
    await makeRequest({
      method: 'POST',
      path: `/api/contests/${contestId}/publish`,
      headers: { Authorization: `Bearer ${profToken}` },
    });

    // Try submitting without joining
    const nonPartSub = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: 'print(12)' },
    });
    assert(nonPartSub.status === 403, 'Non-participant submission rejected (403 Forbidden)');

    // Student 1 joins contest
    await makeRequest({
      method: 'POST',
      path: `/api/contests/${contestId}/join`,
      headers: { Authorization: `Bearer ${student1Token}` },
    });

    // 6. Interactive Sample Run Tests
    console.log('\n--- 4. Interactive Sample Run (Run vs Submit) Tests ---');
    const sampleRunRes = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        contestId,
        problemId,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\na, b = int(lines[0]), int(lines[1])\nprint(a + b)',
      },
    });
    assert(sampleRunRes.status === 200, 'Interactive sample test execution returns 200 OK');
    assert(sampleRunRes.body.runResult.status === 'accepted', 'Sample run evaluated as accepted on sample test case');
    assert(sampleRunRes.body.runResult.sampleResults.length === 1, 'Sample results contains exactly 1 sample test');
    assert(sampleRunRes.body.runResult.sampleResults[0].status === 'passed', 'Sample test case 1 status is passed');

    // 7. Official Submissions & Verdict Evaluation Tests
    console.log('\n--- 5. Verdict Evaluation: Correct Solution (ACCEPTED) ---');
    const correctCode = 'import sys\nlines = sys.stdin.read().split()\na, b = int(lines[0]), int(lines[1])\nprint(a + b)\n';
    const subRes1 = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        contestId,
        problemId,
        language: 'python',
        sourceCode: correctCode,
      },
    });
    assert(subRes1.status === 201, 'Official submission enqueued (201 Created)');
    assert(subRes1.body.submission.status === 'queued', 'Initial status is queued');
    const sub1Id = subRes1.body.submission.id;

    // Poll for verdict
    const polled1 = await pollSubmission(sub1Id, student1Token);
    assert(polled1.body.status === 'accepted', 'Correct code evaluated with verdict: ACCEPTED');
    assert(polled1.body.score === 100, 'Accepted submission awarded 100 points');
    assert(polled1.body.testCasesPassed === 3, 'All 3 test cases passed');
    assert(polled1.body.executionTime >= 0, 'Execution time measured in ms');

    console.log('\n--- 6. Verdict Evaluation: Output Mismatch (WRONG_ANSWER) ---');
    const wrongCode = 'print(100)\n';
    const subRes2 = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: wrongCode },
    });
    const polled2 = await pollSubmission(subRes2.body.submission.id, student1Token);
    assert(polled2.body.status === 'wrong_answer', 'Wrong output evaluated with verdict: WRONG_ANSWER');
    assert(polled2.body.score === 0, 'Zero score awarded for failing test cases');

    console.log('\n--- 7. Verdict Evaluation: Syntax Error (COMPILATION_ERROR) ---');
    const syntaxErrCode = 'def invalid_syntax(\n';
    const subRes3 = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: syntaxErrCode },
    });
    const polled3 = await pollSubmission(subRes3.body.submission.id, student1Token);
    assert(polled3.body.status === 'compilation_error', 'Invalid syntax evaluated with verdict: COMPILATION_ERROR');
    assert(polled3.body.errorMessage !== null, 'Sanitized compiler error message stored');
    assert(!polled3.body.errorMessage.includes('C:\\Users'), 'Host filesystem paths stripped from compiler error');

    console.log('\n--- 8. Verdict Evaluation: Crash / Division by Zero (RUNTIME_ERROR) ---');
    const runtimeErrCode = 'x = 1 / 0\n';
    const subRes4 = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: runtimeErrCode },
    });
    const polled4 = await pollSubmission(subRes4.body.submission.id, student1Token);
    assert(polled4.body.status === 'runtime_error', 'Crashing code evaluated with verdict: RUNTIME_ERROR');
    assert(polled4.body.errorMessage.includes('ZeroDivisionError'), 'Error message contains runtime exception details');

    console.log('\n--- 9. Verdict Evaluation: Infinite Loop (TIME_LIMIT_EXCEEDED) ---');
    const timeoutCode = 'while True:\n    pass\n';
    const subRes5 = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: timeoutCode },
    });
    const polled5 = await pollSubmission(subRes5.body.submission.id, student1Token);
    assert(polled5.body.status === 'time_limit_exceeded', 'Infinite loop evaluated with verdict: TIME_LIMIT_EXCEEDED');

    // 8. Sandbox & Security Isolation Tests
    console.log('\n--- 10. Security & Isolation Tests (CRITICAL) ---');
    
    // Security Test A: Attempt to read .env or backend server code
    const exploitCode1 = `
import os
try:
    with open('.env', 'r') as f:
        print("EXPLOIT_LEAKED_ENV:" + f.read())
except Exception as e:
    print("BLOCKED_FILE_NOT_FOUND")
`;
    const subResSec1 = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: exploitCode1 },
    });
    const secOutput1 = subResSec1.body.runResult.sampleResults[0].actualOutput;
    assert(secOutput1.includes('BLOCKED_FILE_NOT_FOUND'), 'Submitted code CANNOT read host .env file');
    assert(!secOutput1.includes('EXPLOIT_LEAKED_ENV'), 'No backend secrets leaked from host filesystem');

    // Security Test B: Attempt to read PostgreSQL environment variables
    const exploitCode2 = `
import os
db_user = os.environ.get('PGUSER', 'NONE')
db_pass = os.environ.get('PGPASSWORD', 'NONE')
jwt_sec = os.environ.get('JWT_SECRET', 'NONE')
print(f"ENV_CHECK: user={db_user}, pass={db_pass}, jwt={jwt_sec}")
`;
    const subResSec2 = await makeRequest({
      method: 'POST',
      path: '/api/submissions/run',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: { contestId, problemId, language: 'python', sourceCode: exploitCode2 },
    });
    const secOutput2 = subResSec2.body.runResult.sampleResults[0].actualOutput;
    assert(secOutput2.includes('user=NONE, pass=NONE, jwt=NONE'), 'Process environment sanitized: NO database or JWT credentials accessible');

    // 9. Submission Access & Privacy Authorization
    console.log('\n--- 11. Submission Privacy & History Authorization Tests ---');
    const student2Inspect1 = await makeRequest({
      method: 'GET',
      path: `/api/submissions/${sub1Id}`,
      headers: { Authorization: `Bearer ${student2Token}` },
    });
    assert(student2Inspect1.status === 403, 'Student B CANNOT inspect Student A submission (403 Forbidden)');

    const student1History = await makeRequest({
      method: 'GET',
      path: `/api/submissions/my?contestId=${contestId}`,
      headers: { Authorization: `Bearer ${student1Token}` },
    });
    assert(student1History.status === 200, 'Student views own submission history (200 OK)');
    assert(student1History.body.count >= 4, 'History contains official submissions for student');

    console.log('\n=======================================================');
    console.log(` PHASE 4A TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================');

  } catch (err) {
    console.error('[TEST SUITE CRASHED]:', err);
    failedCount++;
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
    await closePool();
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

// Start test server
const appInstance = app.listen(0, () => {
  serverInstance = appInstance;
  port = appInstance.address().port;
  runTests();
});