/**
 * Automated Verification Test Suite for Phase 5.8.3 — Percentile Performance Engine
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');
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
  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

  try {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    console.log('--- 1. Unit Tests: SubmissionPerformanceService.calculatePercentile ---');
    {
      const p1 = SubmissionPerformanceService.calculatePercentile({ targetValue: 42, slowerCount: 874, totalCount: 1000 });
      record('UNIT: 874/1000 slower yields exactly 87.40%', p1.percentile === 87.4 && p1.available === true);

      const p2 = SubmissionPerformanceService.calculatePercentile({ targetValue: 2048, slowerCount: 721, totalCount: 1000 });
      record('UNIT: 721/1000 yields exactly 72.10%', p2.percentile === 72.1 && p2.available === true);

      const p3 = SubmissionPerformanceService.calculatePercentile({ targetValue: 20, slowerCount: 4, totalCount: 5 });
      record('UNIT: 4/5 slower yields 80.00%', p3.percentile === 80 && p3.available === true);

      const p4 = SubmissionPerformanceService.calculatePercentile({ targetValue: 110, slowerCount: 0, totalCount: 5 });
      record('UNIT: 0/5 slower yields 0.00%', p4.percentile === 0 && p4.available === true);

      const p5 = SubmissionPerformanceService.calculatePercentile({ targetValue: 50, slowerCount: 0, totalCount: 5 });
      record('UNIT: 5 identical submissions yields 0.00%', p5.percentile === 0 && p5.available === true);

      const p6 = SubmissionPerformanceService.calculatePercentile({ targetValue: 20, slowerCount: 3, totalCount: 4, minSampleSize: 5 });
      record('UNIT: N=4 under minSampleSize=5 yields null', p6.percentile === null && p6.available === false && p6.reason === 'insufficient_data');

      const p7 = SubmissionPerformanceService.calculatePercentile({ targetValue: 20, slowerCount: 0, totalCount: 0 });
      record('UNIT: Zero sample size yields null', p7.percentile === null && p7.available === false);
    }

    const professor = await UserModel.createUser({
      username: `prof_perc_${ts}`,
      email: `prof_perc_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Percentile',
    });

    const studentA = await UserModel.createUser({
      username: `student_a_${ts}`,
      email: `student_a_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Alice',
    });

    const studentB = await UserModel.createUser({
      username: `student_b_${ts}`,
      email: `student_b_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Bob',
    });

    const contest = await ContestModel.createContest({
      title: `Percentile Contest ${ts}`,
      description: 'Benchmarking Percentile Engine',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 86400000).toISOString(),
      createdBy: professor.id,
    });

    const problem1 = await ProblemModel.createProblem({
      contestId: contest.id,
      title: `Percentile Target Problem 1 ${ts}`,
      description: 'Solve this array problem',
      difficulty: 'easy',
      createdBy: professor.id,
    });

    const problem2 = await ProblemModel.createProblem({
      contestId: contest.id,
      title: `Isolated Problem 2 ${ts}`,
      description: 'Other problem',
      difficulty: 'medium',
      createdBy: professor.id,
    });

    const loginResA = await request('POST', '/api/auth/login', {
      email: studentA.email,
      password: 'Password123!',
    });
    const tokenA = loginResA.body?.token || loginResA.body?.data?.token;

    const loginResB = await request('POST', '/api/auth/login', {
      email: studentB.email,
      password: 'Password123!',
    });
    const tokenB = loginResB.body?.token || loginResB.body?.data?.token;

    const loginProf = await request('POST', '/api/auth/login', {
      email: professor.email,
      password: 'Password123!',
    });
    const tokenProf = loginProf.body?.token || loginProf.body?.data?.token;

    record('Setup: Users, contest, and problems initialized', !!tokenA && !!tokenB && !!tokenProf);

    console.log('\n--- 3. Under-Threshold Dataset (3 Submissions, MinSampleSize=5) ---');
    const sub1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sub1',
    });
    await SubmissionModel.updateSubmission(sub1.id, {
      status: 'accepted',
      score: 100,
      executionTime: 20,
      memoryUsed: 1024,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const sub2 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sub2',
    });
    await SubmissionModel.updateSubmission(sub2.id, {
      status: 'accepted',
      score: 100,
      executionTime: 50,
      memoryUsed: 2048,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const sub3 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sub3',
    });
    await SubmissionModel.updateSubmission(sub3.id, {
      status: 'accepted',
      score: 100,
      executionTime: 110,
      memoryUsed: 4096,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const resUnder = await request('GET', `/api/submissions/${sub1.id}`, null, tokenA);
    const perfUnder = resUnder.body?.performanceStats;

    record('THRESHOLD: Runtime percentile is null when N=3 < 5', perfUnder?.runtime?.percentile === null);
    record('THRESHOLD: Runtime available is false when N=3', perfUnder?.runtime?.available === false);
    record('THRESHOLD: Runtime reason is insufficient_data', perfUnder?.runtime?.reason === 'insufficient_data');
    record('THRESHOLD: Memory percentile is null when N=3 < 5', perfUnder?.memory?.percentile === null);
    record('THRESHOLD: Memory available is false when N=3', perfUnder?.memory?.available === false);
    record('THRESHOLD: Memory reason is insufficient_data', perfUnder?.memory?.reason === 'insufficient_data');
    record('THRESHOLD: Scope minSampleSize is 5', perfUnder?.scope?.minSampleSize === 5);

    console.log('\n--- 4. Meet-Threshold Dataset (5 Submissions: Runtimes=[20, 40, 50, 80, 110], Memory=[1024, 1536, 2048, 3072, 4096]) ---');
    const sub4 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sub4',
    });
    await SubmissionModel.updateSubmission(sub4.id, {
      status: 'accepted',
      score: 100,
      executionTime: 40,
      memoryUsed: 1536,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const sub5 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sub5',
    });
    await SubmissionModel.updateSubmission(sub5.id, {
      status: 'accepted',
      score: 100,
      executionTime: 80,
      memoryUsed: 3072,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const res1 = await request('GET', `/api/submissions/${sub1.id}`, null, tokenA);
    const perf1 = res1.body?.performanceStats;

    record('FASTEST: Runtime available is true when N=5', perf1?.runtime?.available === true);
    record('FASTEST: Runtime percentile is 80.00% (4/5 slower)', perf1?.runtime?.percentile === 80);
    record('FASTEST: Slower count is 4', perf1?.runtime?.slowerCount === 4);
    record('FASTEST: Equal count is 1', perf1?.runtime?.equalCount === 1);
    record('FASTEST: Faster count is 0', perf1?.runtime?.fasterCount === 0);
    record('FASTEST: Memory available is true when N=5', perf1?.memory?.available === true);
    record('FASTEST: Memory percentile is 80.00% (4/5 higher)', perf1?.memory?.percentile === 80);
    record('FASTEST: Higher memory count is 4', perf1?.memory?.higherMemoryCount === 4);

    const res2 = await request('GET', `/api/submissions/${sub2.id}`, null, tokenB);
    const perf2 = res2.body?.performanceStats;
    record('MIDDLE: Runtime percentile is 40.00% (2/5 slower)', perf2?.runtime?.percentile === 40);
    record('MIDDLE: Memory percentile is 40.00% (2/5 higher)', perf2?.memory?.percentile === 40);

    const res3 = await request('GET', `/api/submissions/${sub3.id}`, null, tokenA);
    const perf3 = res3.body?.performanceStats;
    record('SLOWEST: Runtime percentile is 0.00% (0/5 slower)', perf3?.runtime?.percentile === 0);
    record('SLOWEST: Memory percentile is 0.00% (0/5 higher)', perf3?.memory?.percentile === 0);

    console.log('\n--- 5. Tie-Handling Tests (Add 2 Equal Submissions at 50ms/2048KB, N=7) ---');
    const subTie1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// subTie1',
    });
    await SubmissionModel.updateSubmission(subTie1.id, {
      status: 'accepted',
      score: 100,
      executionTime: 50,
      memoryUsed: 2048,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const subTie2 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// subTie2',
    });
    await SubmissionModel.updateSubmission(subTie2.id, {
      status: 'accepted',
      score: 100,
      executionTime: 50,
      memoryUsed: 2048,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const resTieA = await request('GET', `/api/submissions/${sub2.id}`, null, tokenB);
    const perfTieA = resTieA.body?.performanceStats;

    const resTieB = await request('GET', `/api/submissions/${subTie1.id}`, null, tokenA);
    const perfTieB = resTieB.body?.performanceStats;

    record('TIES: Slower count for 50ms submission is 2', perfTieA?.runtime?.slowerCount === 2);
    record('TIES: Equal count for 50ms submission is 3', perfTieA?.runtime?.equalCount === 3);
    record('TIES: Faster count for 50ms submission is 2', perfTieA?.runtime?.fasterCount === 2);
    record('TIES: Runtime percentile is 28.57% (2/7)', perfTieA?.runtime?.percentile === 28.57);
    record('TIES: Memory percentile is 28.57% (2/7)', perfTieA?.memory?.percentile === 28.57);
    record('TIES: Distinct tied submissions share identical percentile', perfTieA?.runtime?.percentile === perfTieB?.runtime?.percentile);

    console.log('\n--- 6. Language & Problem Isolation ---');
    let pySub1 = null;
    for (let i = 0; i < 5; i++) {
      const sub = await SubmissionModel.createSubmission({
        userId: studentA.id,
        contestId: contest.id,
        problemId: problem1.id,
        language: 'python',
        sourceCode: `# py_sub_${i}`,
      });
      await SubmissionModel.updateSubmission(sub.id, {
        status: 'accepted',
        score: 100,
        executionTime: 100 + i * 50,
        memoryUsed: 8192 + i * 1024,
        testCasesPassed: 10,
        testCasesTotal: 10,
      });
      if (i === 0) pySub1 = sub;
    }

    const resCpp = await request('GET', `/api/submissions/${sub1.id}`, null, tokenA);
    const perfCpp = resCpp.body?.performanceStats;
    record('LANGUAGE ISOLATION: C++ sampleCount remains 7', perfCpp?.runtime?.sampleCount === 7);

    const resPy = await request('GET', `/api/submissions/${pySub1.id}`, null, tokenA);
    const perfPy = resPy.body?.performanceStats;
    record('LANGUAGE ISOLATION: Python sampleCount is 5', perfPy?.runtime?.sampleCount === 5);
    record('LANGUAGE ISOLATION: Python runtime percentile is 80.00%', perfPy?.runtime?.percentile === 80);

    const p2sub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem2.id,
      language: 'cpp',
      sourceCode: '// p2sub',
    });
    await SubmissionModel.updateSubmission(p2sub.id, {
      status: 'accepted',
      score: 100,
      executionTime: 10,
      memoryUsed: 512,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const resP2 = await request('GET', `/api/submissions/${p2sub.id}`, null, tokenA);
    const perfP2 = resP2.body?.performanceStats;
    record('PROBLEM ISOLATION: Problem 2 sampleCount is 1 (< 5)', perfP2?.runtime?.sampleCount === 1);
    record('PROBLEM ISOLATION: Problem 2 percentile is null', perfP2?.runtime?.percentile === null);

    console.log('\n--- 7. Verdict & Sample-Run Isolation ---');
    const waSub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// waSub',
    });
    await SubmissionModel.updateSubmission(waSub.id, {
      status: 'wrong_answer',
      score: 0,
      executionTime: 15,
      memoryUsed: 512,
      testCasesPassed: 2,
      testCasesTotal: 10,
    });

    const sampleSub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sampleSub',
      isSampleRun: true,
    });
    await SubmissionModel.updateSubmission(sampleSub.id, {
      status: 'accepted',
      score: 100,
      executionTime: 10,
      memoryUsed: 512,
      testCasesPassed: 2,
      testCasesTotal: 2,
    });

    const resWA = await request('GET', `/api/submissions/${waSub.id}`, null, tokenA);
    const perfWA = resWA.body?.performanceStats;
    record('VERDICT ISOLATION: Non-accepted submission percentile is null', perfWA?.runtime?.percentile === null);
    record('VERDICT ISOLATION: Non-accepted reason is submission_not_eligible', perfWA?.runtime?.reason === 'submission_not_eligible');
    record('VERDICT ISOLATION: Non-accepted memory reason is submission_not_eligible', perfWA?.memory?.reason === 'submission_not_eligible');

    const resFinalCpp = await request('GET', `/api/submissions/${sub1.id}`, null, tokenA);
    const perfFinalCpp = resFinalCpp.body?.performanceStats;
    record('SAMPLE RUN ISOLATION: sample_run excluded from sampleCount', perfFinalCpp?.runtime?.sampleCount === 7);

    console.log('\n--- 8. Security, BOLA & RBAC Authorization ---');
    const resBola = await request('GET', `/api/submissions/${sub1.id}`, null, tokenB);
    record('BOLA PROTECTION: Student B forbidden (403) from Student A submission', resBola.status === 403);
    record('BOLA PROTECTION: No performanceStats leaked on 403', !resBola.body?.performanceStats);

    const resProf = await request('GET', `/api/submissions/${sub1.id}`, null, tokenProf);
    record('PROFESSOR RBAC: Contest owner gets 200 OK', resProf.status === 200);
    record('PROFESSOR RBAC: Professor receives percentile payload', resProf.body?.performanceStats?.runtime?.percentile !== undefined);

    const resNonNum = await request('GET', '/api/submissions/abc', null, tokenA);
    record('SECURITY: Non-numeric ID returns 400 Bad Request', resNonNum.status === 400);

    const resSqli = await request('GET', '/api/submissions/1%20OR%201=1', null, tokenA);
    record('SECURITY: SQL injection payload returns 400 Bad Request', resSqli.status === 400);

    const res404 = await request('GET', '/api/submissions/9999999', null, tokenA);
    record('SECURITY: Non-existent ID returns 404 Not Found', res404.status === 404);

    console.log('\n--- 10. Java Isolation & Multi-Language Isolation ---');
    let javaSub1 = null;
    for (let i = 0; i < 5; i++) {
      const sub = await SubmissionModel.createSubmission({
        userId: studentA.id,
        contestId: contest.id,
        problemId: problem1.id,
        language: 'java',
        sourceCode: `// java_sub_${i}`,
      });
      await SubmissionModel.updateSubmission(sub.id, {
        status: 'accepted',
        score: 100,
        executionTime: 200 + i * 30,
        memoryUsed: 16384 + i * 2048,
        testCasesPassed: 10,
        testCasesTotal: 10,
      });
      if (i === 0) javaSub1 = sub;
    }

    const resJava = await request('GET', `/api/submissions/${javaSub1.id}/performance`, null, tokenA);
    record('JAVA ISOLATION: Java population is 5', resJava.body?.runtime?.population === 5);
    record('JAVA ISOLATION: Java runtime percentile is 80.00%', resJava.body?.runtime?.percentile === 80);
    record('JAVA ISOLATION: Java language is java', resJava.body?.runtime?.language === 'java');
    record('JAVA ISOLATION: C++ population remains isolated at 7', perfFinalCpp?.runtime?.sampleCount === 7);

    console.log('\n--- 11. Dedicated Relative Performance API (GET /api/submissions/:id/performance) ---');
    const resPerf = await request('GET', `/api/submissions/${sub1.id}/performance`, null, tokenA);
    record('PERF API: 200 OK returned', resPerf.status === 200);
    record('PERF API: available is true', resPerf.body?.available === true);
    record('PERF API: runtime value is 20ms', resPerf.body?.runtime?.value === 20);
    record('PERF API: runtime unit is ms', resPerf.body?.runtime?.unit === 'ms');
    record('PERF API: runtime percentile is 85.71% (6/7 slower)', resPerf.body?.runtime?.percentile === 85.71);
    record('PERF API: runtime comparisonDirection is lower_is_better', resPerf.body?.runtime?.comparisonDirection === 'lower_is_better');
    record('PERF API: memory unit is MB', resPerf.body?.memory?.unit === 'MB');
    record('PERF API: memory percentile is 85.71% (6/7 higher)', resPerf.body?.memory?.percentile === 85.71);
    record('PERF API: memory comparisonDirection is lower_is_better', resPerf.body?.memory?.comparisonDirection === 'lower_is_better');

    // Unauthenticated request
    const resPerfUnauth = await request('GET', `/api/submissions/${sub1.id}/performance`);
    record('PERF API: 401 Unauthorized when missing token', resPerfUnauth.status === 401);

    // BOLA unauthorized student
    const resPerfBola = await request('GET', `/api/submissions/${sub1.id}/performance`, null, tokenB);
    record('PERF API: 403 Forbidden for unauthorized student', resPerfBola.status === 403);

    // Malformed ID
    const resPerfMalformed = await request('GET', '/api/submissions/invalid_id/performance', null, tokenA);
    record('PERF API: 400 Bad Request on malformed ID', resPerfMalformed.status === 400);

    // Non-existent ID
    const resPerf404 = await request('GET', '/api/submissions/9999999/performance', null, tokenA);
    record('PERF API: 404 Not Found on missing submission', resPerf404.status === 404);

    console.log('\n--- 12. Professor Cross-Contest Isolation ---');
    const otherProf = await UserModel.createUser({
      username: `prof_other_${ts}`,
      email: `prof_other_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Other Professor',
    });
    const loginOtherProf = await request('POST', '/api/auth/login', {
      email: otherProf.email,
      password: 'Password123!',
    });
    const tokenOtherProf = loginOtherProf.body?.token || loginOtherProf.body?.data?.token;

    const resCrossProf = await request('GET', `/api/submissions/${sub1.id}/performance`, null, tokenOtherProf);
    record('PROFESSOR ISOLATION: Unrelated professor receives 403 Forbidden on private contest submission', resCrossProf.status === 403);

    console.log('\n--- 13. High-Concurrency Stress Test ---');
    const concurrentRequests = Array.from({ length: 10 }, () =>
      request('GET', `/api/submissions/${sub1.id}/performance`, null, tokenA)
    );
    const concurrentResponses = await Promise.all(concurrentRequests);
    const all200 = concurrentResponses.every((r) => r.status === 200 && r.body?.available === true);
    const allIdenticalPercentile = concurrentResponses.every((r) => r.body?.runtime?.percentile === 85.71);
    record('CONCURRENCY: 10 concurrent requests return 200 OK without race condition', all200);
    record('CONCURRENCY: All concurrent requests return identical deterministic percentile (85.71%)', allIdenticalPercentile);

  } catch (err) {
    console.error('\n[UNEXPECTED TEST FAILURE]:', err);
    failedCount++;
  } finally {
    if (server) {
      server.close();
    }
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }

    console.log('\n=======================================================');
    console.log(` PHASE 5.8.3 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
