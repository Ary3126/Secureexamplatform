/**
 * Automated Verification Test Suite for Phase 5.8.2 — Runtime + Memory Statistics
 * 
 * Verifies:
 * 1. Target submission performance metric exposure (runtimeMs, memoryKb).
 * 2. Problem-wide accepted aggregate runtime statistics (min, max, avg, median).
 * 3. Problem-wide accepted aggregate memory statistics (min, max, avg, median).
 * 4. Exact continuous median calculations for odd sample sizes.
 * 5. Exact continuous median calculations for even sample sizes.
 * 6. Single comparable submission edge case (min = max = avg = median).
 * 7. Zero comparable submissions edge case (sampleCount = 0, null aggregates).
 * 8. Problem isolation (other problem submissions excluded).
 * 9. Language isolation (Python/Java excluded from C++ stats).
 * 10. Verdict isolation (failed/WA/TLE/CE submissions excluded).
 * 11. Sample run isolation (is_sample_run = true excluded).
 * 12. Strict server-side BOLA / IDOR protection.
 * 13. Professor RBAC verification for owned contests.
 * 14. SQL injection defense and parameter regex validation.
 * 15. Complete backward compatibility of GET /api/submissions/:id payload.
 */

const assert = require('assert');
const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionPerformanceService = require('./src/services/submissionPerformanceService');

let server = null;
let baseUrl = '';
let passedCount = 0;
let failedCount = 0;

function record(name, condition, extra = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name} - ${extra}`);
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
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.8.2 AUTOMATED TEST SUITE');
  console.log(' Runtime + Memory Performance Statistics Verification');
  console.log('=======================================================\n');

  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

  try {
    // Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. SETUP TEST USERS, CONTEST & PROBLEMS
    // -------------------------------------------------------------------
    console.log('--- 1. Test Setup (Users, Contest, Problems) ---');

    const prof = await UserModel.createUser({
      username: `prof_582_${ts}`,
      email: `prof_582_${ts}@test.edu`,
      passwordHash,
      fullName: 'Professor 582',
      role: 'professor',
    });

    const studentA = await UserModel.createUser({
      username: `alice_582_${ts}`,
      email: `alice_582_${ts}@test.edu`,
      passwordHash,
      fullName: 'Alice 582',
      role: 'student',
    });

    const studentB = await UserModel.createUser({
      username: `bob_582_${ts}`,
      email: `bob_582_${ts}@test.edu`,
      passwordHash,
      fullName: 'Bob 582',
      role: 'student',
    });

    const studentC = await UserModel.createUser({
      username: `charlie_582_${ts}`,
      email: `charlie_582_${ts}@test.edu`,
      passwordHash,
      fullName: 'Charlie 582',
      role: 'student',
    });

    const contest = await ContestModel.createContest({
      title: `Phase 5.8.2 Contest ${ts}`,
      description: 'Performance statistics test contest',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 7200000),
      createdBy: prof.id,
      status: 'published',
    });

    const problem1 = await ProblemModel.createProblem({
      title: `Problem 1 Perf 582 ${ts}`,
      description: 'Target problem for performance stats',
      difficulty: 'medium',
      codingMode: 'function',
      timeLimit: 2000,
      memoryLimit: 256,
      createdBy: prof.id,
    });

    const problem2 = await ProblemModel.createProblem({
      title: `Problem 2 Perf 582 ${ts}`,
      description: 'Secondary problem for isolation tests',
      difficulty: 'hard',
      codingMode: 'full_program',
      timeLimit: 2000,
      memoryLimit: 256,
      createdBy: prof.id,
    });

    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: problem1.id, points: 100, problemOrder: 1 });
    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: problem2.id, points: 200, problemOrder: 2 });
    await ContestModel.addParticipant(contest.id, studentA.id);
    await ContestModel.addParticipant(contest.id, studentB.id);
    await ContestModel.addParticipant(contest.id, studentC.id);

    // Auth logins
    const aliceLogin = await request('POST', '/api/auth/login', { email: studentA.email, password: 'Password123!' });
    const aliceToken = aliceLogin.body.token;

    const bobLogin = await request('POST', '/api/auth/login', { email: studentB.email, password: 'Password123!' });
    const bobToken = bobLogin.body.token;

    const profLogin = await request('POST', '/api/auth/login', { email: prof.email, password: 'Password123!' });
    const profToken = profLogin.body.token;

    record('Test users, contest, and problems initialized', !!aliceToken && !!bobToken && !!profToken);

    // -------------------------------------------------------------------
    // 2. ODD SAMPLE DATASET (3 Accepted C++ Submissions for Problem 1)
    // -------------------------------------------------------------------
    console.log('\n--- 2. Odd Sample Dataset (3 Submissions: Runtimes=[20, 50, 110], Memory=[1024, 2048, 4096]) ---');

    // Sub 1: Alice (20ms, 1024KB)
    const sub1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// Alice sub 1',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(sub1.id, {
      status: 'accepted',
      score: 100,
      executionTime: 20,
      memoryUsed: 1024,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    // Sub 2: Bob (50ms, 2048KB)
    const sub2 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// Bob sub 2',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(sub2.id, {
      status: 'accepted',
      score: 100,
      executionTime: 50,
      memoryUsed: 2048,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    // Sub 3: Charlie (110ms, 4096KB)
    const sub3 = await SubmissionModel.createSubmission({
      userId: studentC.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// Charlie sub 3',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(sub3.id, {
      status: 'accepted',
      score: 100,
      executionTime: 110,
      memoryUsed: 4096,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    // Fetch Alice's submission via API
    const resOdd = await request('GET', `/api/submissions/${sub1.id}`, null, aliceToken);
    record('Alice fetches submission 1 with 200 OK', resOdd.status === 200);
    record('Response contains performanceStats object', typeof resOdd.body.performanceStats === 'object' && resOdd.body.performanceStats !== null);

    const statsOdd = resOdd.body.performanceStats;
    record('Target runtime is 20 ms', statsOdd.submission.runtimeMs === 20);
    record('Target memory is 1024 KB', statsOdd.submission.memoryKb === 1024);
    record('Eligible sampleCount is 3', statsOdd.runtime.sampleCount === 3 && statsOdd.memory.sampleCount === 3);
    record('Runtime min is 20 ms', statsOdd.runtime.minMs === 20);
    record('Runtime max is 110 ms', statsOdd.runtime.maxMs === 110);
    record('Runtime average is 60.00 ms ((20+50+110)/3)', statsOdd.runtime.averageMs === 60);
    record('Runtime median is 50.00 ms (middle value for odd dataset)', statsOdd.runtime.medianMs === 50);

    record('Memory min is 1024 KB', statsOdd.memory.minKb === 1024);
    record('Memory max is 4096 KB', statsOdd.memory.maxKb === 4096);
    record('Memory average is 2389.33 KB ((1024+2048+4096)/3)', statsOdd.memory.averageKb === 2389.33);
    record('Memory median is 2048 KB (middle value for odd dataset)', statsOdd.memory.medianKb === 2048);

    record('Scope problemId is correct', statsOdd.scope.problemId === problem1.id);
    record('Scope language is cpp', statsOdd.scope.language === 'cpp');
    record('Scope flags acceptedOnly=true and sampleRunsExcluded=true', statsOdd.scope.acceptedOnly === true && statsOdd.scope.sampleRunsExcluded === true);

    // -------------------------------------------------------------------
    // 3. EVEN SAMPLE DATASET (Add 4th Submission: Runtime=80, Memory=3072)
    // -------------------------------------------------------------------
    console.log('\n--- 3. Even Sample Dataset (4 Submissions: Runtimes=[20, 50, 80, 110], Memory=[1024, 2048, 3072, 4096]) ---');

    const sub4 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// Alice sub 4',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(sub4.id, {
      status: 'accepted',
      score: 100,
      executionTime: 80,
      memoryUsed: 3072,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const resEven = await request('GET', `/api/submissions/${sub4.id}`, null, aliceToken);
    const statsEven = resEven.body.performanceStats;

    record('Eligible sampleCount is 4', statsEven.runtime.sampleCount === 4);
    record('Runtime min remains 20 ms', statsEven.runtime.minMs === 20);
    record('Runtime max remains 110 ms', statsEven.runtime.maxMs === 110);
    record('Runtime average is 65.00 ms ((20+50+80+110)/4)', statsEven.runtime.averageMs === 65);
    record('Runtime median is 65.00 ms (continuous interpolation (50+80)/2)', statsEven.runtime.medianMs === 65);

    record('Memory min is 1024 KB', statsEven.memory.minKb === 1024);
    record('Memory max is 4096 KB', statsEven.memory.maxKb === 4096);
    record('Memory average is 2560.00 KB ((1024+2048+3072+4096)/4)', statsEven.memory.averageKb === 2560);
    record('Memory median is 2560.00 KB ((2048+3072)/2)', statsEven.memory.medianKb === 2560);

    // -------------------------------------------------------------------
    // 4. DATASET ISOLATION & FILTERING INTEGRITY
    // -------------------------------------------------------------------
    console.log('\n--- 4. Dataset Isolation (Problem, Language, Verdict, Sample Runs) ---');

    // 4a. Different problem submission (Problem 2: 999ms, 9999KB)
    const subOtherProblem = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem2.id,
      language: 'cpp',
      sourceCode: '// Other problem sub',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(subOtherProblem.id, {
      status: 'accepted',
      score: 200,
      executionTime: 999,
      memoryUsed: 9999,
    });

    // 4b. Different language submission (Problem 1, Python: 300ms, 15000KB)
    const subOtherLang = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'python',
      sourceCode: '# Python sub',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(subOtherLang.id, {
      status: 'accepted',
      score: 100,
      executionTime: 300,
      memoryUsed: 15000,
    });

    // 4c. Failed verdict submission (Problem 1, C++, Wrong Answer: 2500ms)
    const subFailedVerdict = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// WA sub',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(subFailedVerdict.id, {
      status: 'wrong_answer',
      score: 0,
      executionTime: 2500,
      memoryUsed: 50000,
    });

    // 4d. Sample run submission (Problem 1, C++, is_sample_run=true: 5ms)
    const subSampleRun = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// Sample run',
      isSampleRun: true,
    });
    await SubmissionModel.updateSubmission(subSampleRun.id, {
      status: 'accepted',
      executionTime: 5,
      memoryUsed: 512,
    });

    // Re-query Alice's submission for Problem 1 C++
    const resIso = await request('GET', `/api/submissions/${sub1.id}`, null, aliceToken);
    const statsIso = resIso.body.performanceStats;

    record('PROBLEM ISOLATION: Problem 2 submissions excluded from Problem 1 stats', statsIso.runtime.maxMs === 110);
    record('LANGUAGE ISOLATION: Python submissions excluded from C++ stats', statsIso.runtime.maxMs === 110);
    record('VERDICT ISOLATION: Failed/WA submissions excluded from accepted stats', statsIso.runtime.maxMs === 110);
    record('SAMPLE RUN ISOLATION: Sample runs excluded from official stats', statsIso.runtime.minMs === 20 && statsIso.runtime.sampleCount === 4);

    // Query the Python submission
    const resPython = await request('GET', `/api/submissions/${subOtherLang.id}`, null, bobToken);
    record('Python submission returns stats scoped to python only', resPython.body.performanceStats.runtime.sampleCount === 1 && resPython.body.performanceStats.runtime.averageMs === 300);

    // -------------------------------------------------------------------
    // 5. EDGE STATES: ZERO AND SINGLE COMPARABLE SAMPLES
    // -------------------------------------------------------------------
    console.log('\n--- 5. Edge States: Zero and Single Comparable Samples ---');

    // Create a Java submission for Problem 1 with compilation_error (0 accepted Java samples)
    const subJavaFailed = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'java',
      sourceCode: '// Java CE',
      isSampleRun: false,
    });
    await SubmissionModel.updateSubmission(subJavaFailed.id, {
      status: 'compilation_error',
      errorMessage: 'Syntax error: class expected',
    });

    const resJavaZero = await request('GET', `/api/submissions/${subJavaFailed.id}`, null, aliceToken);
    const statsZero = resJavaZero.body.performanceStats;

    record('ZERO SAMPLES: sampleCount is 0 when no accepted solutions exist', statsZero.runtime.sampleCount === 0);
    record('ZERO SAMPLES: runtime aggregates return null safely', statsZero.runtime.minMs === null && statsZero.runtime.medianMs === null && statsZero.runtime.averageMs === null && statsZero.runtime.maxMs === null);
    record('ZERO SAMPLES: memory aggregates return null safely', statsZero.memory.minKb === null && statsZero.memory.medianKb === null && statsZero.memory.averageKb === null && statsZero.memory.maxKb === null);
    record('ZERO SAMPLES: target runtime is 0 or null for failed submission', statsZero.submission.runtimeMs === 0 || statsZero.submission.runtimeMs === null);

    // Single sample for Problem 2
    const resSingle = await request('GET', `/api/submissions/${subOtherProblem.id}`, null, bobToken);
    const statsSingle = resSingle.body.performanceStats;

    record('SINGLE SAMPLE: sampleCount is 1', statsSingle.runtime.sampleCount === 1);
    record('SINGLE SAMPLE: min == max == avg == median for runtime (999ms)', 
      statsSingle.runtime.minMs === 999 &&
      statsSingle.runtime.maxMs === 999 &&
      statsSingle.runtime.averageMs === 999 &&
      statsSingle.runtime.medianMs === 999
    );
    record('SINGLE SAMPLE: min == max == avg == median for memory (9999KB)',
      statsSingle.memory.minKb === 9999 &&
      statsSingle.memory.maxKb === 9999 &&
      statsSingle.memory.averageKb === 9999 &&
      statsSingle.memory.medianKb === 9999
    );

    // -------------------------------------------------------------------
    // 6. SECURITY, BOLA/IDOR & BACKWARD COMPATIBILITY
    // -------------------------------------------------------------------
    console.log('\n--- 6. Security, BOLA/IDOR & Compatibility ---');

    // Student B attempts to access Student A's submission
    const resBOLA = await request('GET', `/api/submissions/${sub1.id}`, null, bobToken);
    record('BOLA PROTECTION: Student B cannot inspect Student A submission (403)', resBOLA.status === 403);
    record('BOLA PROTECTION: No performanceStats leaked on 403', !resBOLA.body.performanceStats);

    // Professor can access Student A's submission
    const resProf = await request('GET', `/api/submissions/${sub1.id}`, null, profToken);
    record('PROFESSOR RBAC: Contest Creator Professor can inspect submission (200)', resProf.status === 200);
    record('Professor receives complete performanceStats payload', typeof resProf.body.performanceStats === 'object');

    // Malformed ID
    const resBadId = await request('GET', '/api/submissions/xyz-not-an-id', null, aliceToken);
    record('Malformed non-numeric ID rejected with 400 Bad Request', resBadId.status === 400);

    // SQL injection payload
    const resSqli = await request('GET', '/api/submissions/1%20OR%201=1', null, aliceToken);
    record('SQL injection payload safely rejected with 400 Bad Request', resSqli.status === 400);

    // Backward compatibility checks on existing response fields
    record('COMPATIBILITY: id is preserved', resOdd.body.id === sub1.id);
    record('COMPATIBILITY: problemTitle is preserved', resOdd.body.problemTitle === `Problem 1 Perf 582 ${ts}`);
    record('COMPATIBILITY: sourceCode is preserved', resOdd.body.sourceCode === '// Alice sub 1');
    record('COMPATIBILITY: status is preserved', resOdd.body.status === 'accepted');
    record('COMPATIBILITY: score is preserved', resOdd.body.score === 100);
    record('COMPATIBILITY: executionTime is preserved', resOdd.body.executionTime === 20);
    record('COMPATIBILITY: memoryUsed is preserved', resOdd.body.memoryUsed === 1024);

  } catch (err) {
    console.error('[UNEXPECTED TEST FAILURE]:', err);
    failedCount++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 5.8.2 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    if (server) {
      server.close();
    }
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
