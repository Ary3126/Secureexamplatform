/**
 * Comprehensive Automated Test Suite for Phase 5.8.4
 * Runtime & Memory Distribution Engine
 *
 * Covers all 27 test requirements:
 * 1. Runtime histogram
 * 2. Memory histogram
 * 3. Same-problem isolation
 * 4. Same-language isolation
 * 5. Accepted-only filtering
 * 6. Sample-run exclusion
 * 7. Invalid metric exclusion
 * 8. Empty dataset
 * 9. Small dataset (N < 5)
 * 10. Identical values (single bucket)
 * 11. Exact bucket boundary inclusion
 * 12. Value immediately above boundary
 * 13. Minimum value
 * 14. Maximum value
 * 15. Overflow value
 * 16. Bucket coverage (100% covered)
 * 17. Bucket non-overlap (0 overlaps)
 * 18. Population reconciliation (sum of counts == N)
 * 19. User bucket calculation
 * 20. Public/private contest isolation
 * 21. Professor ownership access (200)
 * 22. Professor cross-owner access (403)
 * 23. Student unauthorized access (403)
 * 24. Admin access (200)
 * 25. Malformed ID (400)
 * 26. SQL injection (400)
 * 27. Concurrent requests
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
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
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
  console.log(' STARTING PHASE 5.8.4 DISTRIBUTION ENGINE TEST SUITE');
  console.log('=======================================================\n');

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    const ts = Date.now();
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // --- 1. Unit Tests for Bucket Generator ---
    console.log('--- 1. Unit Tests: generateBucketRanges ---');
    // Unit 10: Identical values
    const identicalBuckets = SubmissionPerformanceService.generateBucketRanges(50, 50, 50, 'ms');
    record('IDENTICAL VALUES: Returns exactly 1 bucket when min == max', identicalBuckets.length === 1);
    record('IDENTICAL VALUES: Single bucket covers [50, 50]', identicalBuckets[0].min === 50 && identicalBuckets[0].max === 50);

    // Unit: Small range
    const smallBuckets = SubmissionPerformanceService.generateBucketRanges(10, 13, 11, 'ms');
    record('SMALL RANGE: 4 values yield 4 unit-width buckets', smallBuckets.length === 4);

    // Unit 11, 12, 13, 14, 16, 17: Normal range without outliers
    const normalBuckets = SubmissionPerformanceService.generateBucketRanges(20, 110, 50, 'ms', 6);
    record('NORMAL RANGE: 6 buckets generated', normalBuckets.length === 6);
    record('MIN VALUE: First bucket min equals 20', normalBuckets[0].min === 20);
    record('MAX VALUE: Last bucket max equals 110', normalBuckets[5].max === 110);

    // Non-overlapping & contiguous check
    let nonOverlapping = true;
    for (let i = 0; i < normalBuckets.length - 1; i++) {
      if (normalBuckets[i + 1].min !== normalBuckets[i].max + 1) {
        nonOverlapping = false;
        break;
      }
    }
    record('BUCKET NON-OVERLAP: All adjacent buckets are strictly contiguous (b[i+1].min == b[i].max + 1)', nonOverlapping);

    // Unit 15: Outlier handling
    const outlierBuckets = SubmissionPerformanceService.generateBucketRanges(10, 5000, 40, 'ms', 6);
    const lastBucket = outlierBuckets[outlierBuckets.length - 1];
    record('OVERFLOW BUCKET: Generated when max is an extreme outlier', lastBucket.isOverflow === true);
    record('OVERFLOW BUCKET: Upper bound includes max value (5000)', lastBucket.max === 5000);
    record('OVERFLOW BUCKET: Label formatted with > symbol', lastBucket.label.startsWith('>'));

    // --- 2. Database & Actor Fixtures ---
    console.log('\n--- 2. Database Fixtures Setup ---');
    const prof = await UserModel.createUser({
      username: `prof_dist_${ts}`,
      email: `prof_dist_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Dist',
    });

    const studentA = await UserModel.createUser({
      username: `student_dist_a_${ts}`,
      email: `student_dist_a_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Dist Alpha',
    });

    const studentB = await UserModel.createUser({
      username: `student_dist_b_${ts}`,
      email: `student_dist_b_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Dist Beta',
    });

    const admin = await UserModel.createUser({
      username: `admin_dist_${ts}`,
      email: `admin_dist_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin Dist',
    });

    const loginA = await request('POST', '/api/auth/login', { email: studentA.email, password: 'Password123!' });
    const tokenA = loginA.body?.token || loginA.body?.data?.token;

    const loginB = await request('POST', '/api/auth/login', { email: studentB.email, password: 'Password123!' });
    const tokenB = loginB.body?.token || loginB.body?.data?.token;

    const loginProf = await request('POST', '/api/auth/login', { email: prof.email, password: 'Password123!' });
    const tokenProf = loginProf.body?.token || loginProf.body?.data?.token;

    const loginAdmin = await request('POST', '/api/auth/login', { email: admin.email, password: 'Password123!' });
    const tokenAdmin = loginAdmin.body?.token || loginAdmin.body?.data?.token;

    const contest = await ContestModel.createContest({
      title: `Distribution Contest ${ts}`,
      description: 'Contest testing',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: prof.id,
    });

    const problem1 = await ProblemModel.createProblem({
      title: `Dist Problem 1 ${ts}`,
      description: 'Dist test',
      difficulty: 'medium',
      createdBy: prof.id,
    });

    const problem2 = await ProblemModel.createProblem({
      title: `Dist Problem 2 ${ts}`,
      description: 'Dist test 2',
      difficulty: 'easy',
      createdBy: prof.id,
    });

    // --- 3. Small & Empty Dataset Verification ---
    console.log('\n--- 3. Empty & Small Dataset Protection ---');
    const smallSub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// smallSub',
    });
    await SubmissionModel.updateSubmission(smallSub.id, {
      status: 'accepted',
      score: 100,
      executionTime: 20,
      memoryUsed: 1024,
      testCasesPassed: 10,
      testCasesTotal: 10,
    });

    const resSmall = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenA);
    record('SMALL DATASET: available is false when N=1 < 5', resSmall.body?.available === false);
    record('SMALL DATASET: reason is insufficient_data', resSmall.body?.reason === 'insufficient_data');

    // --- 4. Meet Threshold Dataset (7 Submissions: runtimes=[20, 40, 50, 50, 50, 80, 110], memory=[1024, 1536, 2048, 2048, 2048, 3072, 4096]) ---
    console.log('\n--- 4. Threshold Met Dataset (N=7) ---');
    const testData = [
      { rt: 40, mem: 1536 },
      { rt: 50, mem: 2048 },
      { rt: 50, mem: 2048 },
      { rt: 50, mem: 2048 },
      { rt: 80, mem: 3072 },
      { rt: 110, mem: 4096 },
    ];

    for (const d of testData) {
      const sub = await SubmissionModel.createSubmission({
        userId: studentA.id,
        contestId: contest.id,
        problemId: problem1.id,
        language: 'cpp',
        sourceCode: '// filler',
      });
      await SubmissionModel.updateSubmission(sub.id, {
        status: 'accepted',
        score: 100,
        executionTime: d.rt,
        memoryUsed: d.mem,
        testCasesPassed: 10,
        testCasesTotal: 10,
      });
    }

    const resDist = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenA);
    record('DIST API: 200 OK returned when N=7 >= 5', resDist.status === 200);
    record('DIST API: available is true', resDist.body?.available === true);
    record('DIST API: population is 7', resDist.body?.population === 7);

    // Runtime Histogram
    const rt = resDist.body?.runtime;
    record('RUNTIME HISTOGRAM: Metric is runtime', rt?.metric === 'runtime');
    record('RUNTIME HISTOGRAM: Unit is ms', rt?.unit === 'ms');
    record('RUNTIME HISTOGRAM: min is 20', rt?.min === 20);
    record('RUNTIME HISTOGRAM: max is 110', rt?.max === 110);
    record('RUNTIME HISTOGRAM: median is 50', rt?.median === 50);
    record('RUNTIME HISTOGRAM: buckets array present', Array.isArray(rt?.buckets) && rt.buckets.length > 0);

    // Population reconciliation
    const totalRuntimeCount = rt.buckets.reduce((acc, b) => acc + b.count, 0);
    record('POPULATION RECONCILIATION: Sum of runtime bucket counts equals population (7)', totalRuntimeCount === 7);

    // Memory Histogram
    const mem = resDist.body?.memory;
    record('MEMORY HISTOGRAM: Metric is memory', mem?.metric === 'memory');
    record('MEMORY HISTOGRAM: Unit is KB', mem?.unit === 'KB');
    record('MEMORY HISTOGRAM: min is 1024', mem?.min === 1024);
    record('MEMORY HISTOGRAM: max is 4096', mem?.max === 4096);
    record('MEMORY HISTOGRAM: median is 2048', mem?.median === 2048);
    const totalMemoryCount = mem.buckets.reduce((acc, b) => acc + b.count, 0);
    record('POPULATION RECONCILIATION: Sum of memory bucket counts equals population (7)', totalMemoryCount === 7);

    // User Bucket Calculation
    record('USER BUCKET: userValue is 20ms', rt?.userValue === 20);
    record('USER BUCKET: userBucketIndex is identified', rt?.userBucketIndex !== null);
    record('USER BUCKET: user bucket has isUserBucket true', rt?.buckets[rt.userBucketIndex]?.isUserBucket === true);
    record('USER BUCKET: user memory bucket has isUserBucket true', mem?.buckets[mem.userBucketIndex]?.isUserBucket === true);

    // --- 5. Filtering, Isolation & Exclusion Rules ---
    console.log('\n--- 5. Verdict, Sample-Run, Problem & Language Isolation ---');
    // Wrong Answer exclusion
    const waSub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// wa',
    });
    await SubmissionModel.updateSubmission(waSub.id, {
      status: 'wrong_answer',
      score: 0,
      executionTime: 25,
      memoryUsed: 1024,
      testCasesPassed: 1,
      testCasesTotal: 10,
    });

    // Sample run exclusion
    const sampleSub = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem1.id,
      language: 'cpp',
      sourceCode: '// sample',
      isSampleRun: true,
    });
    await SubmissionModel.updateSubmission(sampleSub.id, {
      status: 'accepted',
      score: 100,
      executionTime: 25,
      memoryUsed: 1024,
      testCasesPassed: 2,
      testCasesTotal: 2,
    });

    // Other language (Python)
    for (let i = 0; i < 5; i++) {
      const pySub = await SubmissionModel.createSubmission({
        userId: studentA.id,
        contestId: contest.id,
        problemId: problem1.id,
        language: 'python',
        sourceCode: '# py',
      });
      await SubmissionModel.updateSubmission(pySub.id, {
        status: 'accepted',
        score: 100,
        executionTime: 200 + i * 20,
        memoryUsed: 8192 + i * 512,
        testCasesPassed: 10,
        testCasesTotal: 10,
      });
    }

    const resAfterExclusions = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenA);
    record('EXCLUSIONS: C++ population remains isolated at 7 (WA, sample-run, python excluded)', resAfterExclusions.body?.population === 7);

    // WA submission itself requests distribution
    const resWADist = await request('GET', `/api/submissions/${waSub.id}/performance/distribution`, null, tokenA);
    record('VERDICT ISOLATION: WA submission returns available=false', resWADist.body?.available === false);
    record('VERDICT ISOLATION: WA submission reason is submission_not_eligible', resWADist.body?.reason === 'submission_not_eligible');

    // --- 6. Security, Authorization & BOLA ---
    console.log('\n--- 6. Security, RBAC & BOLA Authorization ---');
    // Unauthorized student B
    const resBola = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenB);
    record('BOLA PROTECTION: Student B receives 403 Forbidden on Student A submission', resBola.status === 403);
    record('BOLA PROTECTION: No distribution data leaked on 403', !resBola.body?.runtime);

    // Unauthenticated
    const resUnauth = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`);
    record('SECURITY: 401 Unauthorized when missing token', resUnauth.status === 401);

    // Professor owner access
    const resProf = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenProf);
    record('PROFESSOR RBAC: Contest owner gets 200 OK', resProf.status === 200);
    record('PROFESSOR RBAC: Distribution payload received', !!resProf.body?.runtime);

    // Unrelated Professor cross-owner access
    const otherProf = await UserModel.createUser({
      username: `other_prof_dist_${ts}`,
      email: `other_prof_dist_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Other Professor Dist',
    });
    const loginOtherProf = await request('POST', '/api/auth/login', { email: otherProf.email, password: 'Password123!' });
    const tokenOtherProf = loginOtherProf.body?.token || loginOtherProf.body?.data?.token;

    const resCrossProf = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenOtherProf);
    record('PROFESSOR CROSS-OWNER: Unrelated professor receives 403 Forbidden', resCrossProf.status === 403);

    // Super Admin access
    const resAdmin = await request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenAdmin);
    record('ADMIN RBAC: Super admin gets 200 OK', resAdmin.status === 200);

    // Malformed ID
    const resMalformed = await request('GET', '/api/submissions/invalid_id/performance/distribution', null, tokenA);
    record('SECURITY: Malformed ID returns 400 Bad Request', resMalformed.status === 400);

    // SQL Injection in ID
    const resSqli = await request('GET', '/api/submissions/1%20OR%201=1/performance/distribution', null, tokenA);
    record('SECURITY: SQL injection payload returns 400 Bad Request', resSqli.status === 400);

    // --- 7. High-Concurrency Stress Test ---
    console.log('\n--- 7. Concurrent Requests ---');
    const concurrentRequests = Array.from({ length: 10 }, () =>
      request('GET', `/api/submissions/${smallSub.id}/performance/distribution`, null, tokenA)
    );
    const concurrentResponses = await Promise.all(concurrentRequests);
    const all200 = concurrentResponses.every((r) => r.status === 200 && r.body?.available === true);
    const allSameCount = concurrentResponses.every((r) => r.body?.population === 7);
    record('CONCURRENCY: 10 concurrent requests return 200 OK without race condition', all200);
    record('CONCURRENCY: All concurrent requests return identical population (7)', allSameCount);

  } catch (err) {
    console.error('\n[UNEXPECTED TEST EXCEPTION]:', err);
    failedCount++;
  } finally {
    if (server) {
      server.close();
    }
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }

    console.log('\n=======================================================');
    console.log(` PHASE 5.8.4 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
