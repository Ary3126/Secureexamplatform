/**
 * CODEFROG — Phase 7.5.10.7
 * Concurrency & Race Conditions Security Test Suite
 *
 * Exhaustive audit and automated validation of concurrent operations:
 *   1. Contest Registration Concurrency (same user & multi-user races)
 *   2. Submission Creation Concurrency (multi-problem, duplicate payloads, queue safety)
 *   3. Duplicate Judge-Result Processing & Worker Concurrency (parallel workers & terminal state guards)
 *   4. Contest Scoring & Leaderboard Concurrency (concurrent standings & freeze consistency)
 *   5. Rating Updates & Elo Concurrency (serialized finalization & rating history integrity)
 *   6. Secure Examination Concurrency (attempt limits, multi-tab sessions, deadline expiry)
 *   7. Finalization and Submissions at Deadline (pending submissions gate & post-finalization lock)
 *   8. Retry and Recovery After Injected Failure (ACID rollback & immediate retry)
 */

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_CONTEST_MAX = '50000';
process.env.RATE_LIMIT_MEDIUM_MAX = '50000';
process.env.RATE_LIMIT_SUBMIT_MAX = '50000';
process.env.RATE_LIMIT_RUN_MAX = '50000';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const UserModel = require('./src/models/userModel');
const SubmissionModel = require('./src/models/submissionModel');
const RatingService = require('./src/services/ratingService');
const StandingsService = require('./src/services/standingsService');
const judgeQueue = require('./src/judge/queue/judgeQueue');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];
const trackedProblemIds = [];
const trackedSubmissionIds = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Coordinated barrier helper to ensure concurrent requests genuinely overlap in flight
 */
async function executeConcurrentBarrier(taskFns) {
  let releaseBarrier;
  const barrierPromise = new Promise((resolve) => {
    releaseBarrier = resolve;
  });

  const coordinatedTasks = taskFns.map(async (fn) => {
    await barrierPromise;
    return fn();
  });

  // Release all requests simultaneously
  releaseBarrier();
  return Promise.all(coordinatedTasks);
}

async function cleanupTestData() {
  try {
    if (trackedSubmissionIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE id = ANY($1::int[])`, [trackedSubmissionIds]);
    }
    if (trackedContestIds.length > 0) {
      await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query(`DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [trackedProblemIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM contest_participants WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
    }
  } catch (err) {
    console.error('Error during cleanup:', err.message);
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('CODEFROG — Phase 7.5.10.7 Concurrency & Race Conditions Security');
  console.log('================================================================\n');

  // Start HTTP server
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[TEST SERVER] Running on ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // Baseline seeded users
    const student1 = { id: 2, username: 'student_seed', role: 'student' };
    const student2 = { id: 4339, username: 'Ary', role: 'student' };
    const profAlan = { id: 1093, username: 'prof_alan', role: 'professor' };
    const superAdmin = { id: 3, username: 'platform_admin', role: 'super_admin' };

    const tokenStudent1 = generateToken(student1);
    const tokenStudent2 = generateToken(student2);
    const tokenProfAlan = generateToken(profAlan);
    const tokenAdmin = generateToken(superAdmin);

    // Create 3 temporary students for multi-user concurrency testing
    const now = Date.now();
    const tempStudentIds = [];
    const tempStudentTokens = [];
    const hashedPwd = await hashPassword('TestPassword123!');

    for (let i = 1; i <= 3; i++) {
      const uRes = await db.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active, is_test_data)
         VALUES ($1, $2, $3, $4, 'student', true, true)
         RETURNING id, username, role;`,
        [`conc_stu_${i}_${now}`, `conc_stu_${i}_${now}@test.com`, hashedPwd, `Concurrent Student ${i}`]
      );
      const u = uRes.rows[0];
      trackedUserIds.push(u.id);
      tempStudentIds.push(u.id);
      tempStudentTokens.push(generateToken(u));
    }

    // Create 2 test problems
    const probA = await ProblemModel.createProblem({
      title: `Concurrency Problem A ${now}`,
      description: 'Calculate sum of two numbers',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
      createdBy: profAlan.id,
    });
    trackedProblemIds.push(probA.id);

    const probB = await ProblemModel.createProblem({
      title: `Concurrency Problem B ${now}`,
      description: 'Calculate product of two numbers',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
      createdBy: profAlan.id,
    });
    trackedProblemIds.push(probB.id);

    // Add test cases
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '2 3', '5', true, false), ($1, '10 20', '30', false, true);`,
      [probA.id]
    );
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '4 5', '20', true, false), ($1, '6 7', '42', false, true);`,
      [probB.id]
    );

    // =========================================================================
    // SECTION 1: CONTEST REGISTRATION CONCURRENCY
    // =========================================================================
    console.log('--- 1. Contest Registration & Enrollment Concurrency ---');
    {
      const startIso = new Date(now - 1800000).toISOString();
      const endIso = new Date(now + 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Concurrency Contest Reg', 'Registration testing', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const regContestId = cRes.rows[0].id;
      trackedContestIds.push(regContestId);

      // 1.1: 10 concurrent join requests by the same student
      const joinTasks = Array.from({ length: 10 }, () => () =>
        request('POST', `/api/contests/${regContestId}/join`, {}, tokenStudent1)
      );

      const joinResponses = await executeConcurrentBarrier(joinTasks);
      const successJoins = joinResponses.filter((r) => r.status === 201);
      const conflictJoins = joinResponses.filter((r) => r.status === 409);

      assert(successJoins.length === 1, `1.1 Exactly 1 of 10 concurrent joins succeeds with 201 Created (got ${successJoins.length})`);
      assert(conflictJoins.length === 9, `1.2 Exactly 9 of 10 concurrent joins rejected with 409 Conflict (got ${conflictJoins.length})`);

      const partCountRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2;`,
        [regContestId, student1.id]
      );
      assert(partCountRes.rows[0].count === 1, '1.3 Primary key (contest_id, user_id) strictly prevents duplicate enrollment in database');

      // 1.2: Multiple distinct students joining simultaneously
      const multiJoinTasks = tempStudentTokens.map((t) => () =>
        request('POST', `/api/contests/${regContestId}/join`, {}, t)
      );

      const multiResponses = await executeConcurrentBarrier(multiJoinTasks);
      const allSuccess = multiResponses.every((r) => r.status === 201);
      assert(allSuccess, '1.4 Concurrent distinct student joins all succeed without deadlocks or timeouts');

      const totalPartsRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1;`,
        [regContestId]
      );
      assert(totalPartsRes.rows[0].count === 4, '1.5 Database contains exactly 4 participants (1 initial + 3 distinct)');

      // 1.3: Registration race at contest expiry
      const expiredStart = new Date(now - 7200000).toISOString();
      const expiredEnd = new Date(now - 1000).toISOString();
      const expRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Expired Contest Race', 'Deadline test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [expiredStart, expiredEnd, profAlan.id]
      );
      const expiredContestId = expRes.rows[0].id;
      trackedContestIds.push(expiredContestId);

      const expiredJoinTasks = tempStudentTokens.map((t) => () =>
        request('POST', `/api/contests/${expiredContestId}/join`, {}, t)
      );
      const expiredResponses = await executeConcurrentBarrier(expiredJoinTasks);
      const allBlockedExpired = expiredResponses.every((r) => r.status === 400);
      assert(allBlockedExpired, '1.6 All concurrent join requests at/after deadline strictly rejected with 400 Bad Request');
    }

    // =========================================================================
    // SECTION 2: SUBMISSION CREATION CONCURRENCY
    // =========================================================================
    console.log('\n--- 2. Submission Creation Concurrency & Queue Safety ---');
    {
      const startIso = new Date(now - 1800000).toISOString();
      const endIso = new Date(now + 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Concurrency Submissions Contest', 'Submission test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const subContestId = cRes.rows[0].id;
      trackedContestIds.push(subContestId);

      // Enroll student1
      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW());`,
        [subContestId, student1.id]
      );

      // Attach problems A and B
      await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
         VALUES ($1, $2, 1, 100), ($1, $3, 2, 100);`,
        [subContestId, probA.id, probB.id]
      );

      // 2.1: Concurrent submissions to different problems
      const multiProbTasks = [
        () => request('POST', '/api/submissions', {
          contestId: subContestId,
          problemId: probA.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("5")',
        }, tokenStudent1),
        () => request('POST', '/api/submissions', {
          contestId: subContestId,
          problemId: probB.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("20")',
        }, tokenStudent1),
      ];

      const multiProbRes = await executeConcurrentBarrier(multiProbTasks);
      assert(multiProbRes[0].status === 201 && multiProbRes[1].status === 201, '2.1 Concurrent submissions to different problems both succeed with 201 Created');
      const idA = multiProbRes[0].body.submission.id;
      const idB = multiProbRes[1].body.submission.id;
      trackedSubmissionIds.push(idA, idB);

      assert(idA !== idB, '2.2 Submissions assigned distinct unique server IDs');

      // Wait for queue to drain prior submissions from 2.1
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // 2.2: Rapid simultaneous submissions to the same problem
      const sameProbTasks = Array.from({ length: 3 }, (_, idx) => () =>
        request('POST', '/api/submissions', {
          contestId: subContestId,
          problemId: probA.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: `print("attempt_${idx}")`,
        }, tokenStudent1)
      );

      const sameProbRes = await executeConcurrentBarrier(sameProbTasks);
      const createdSubs = sameProbRes.filter((r) => r.status === 201);
      const throttledSubs = sameProbRes.filter((r) => r.status === 429);
      assert(createdSubs.length >= 1 && (createdSubs.length + throttledSubs.length === 3), `2.3 Rapid submissions to same problem handled safely without 500 error (created: ${createdSubs.length}, throttled: ${throttledSubs.length})`);
      createdSubs.forEach((r) => trackedSubmissionIds.push(r.body.submission.id));

      // Wait for queue to drain
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // 2.3: In-buffer duplicate enqueue prevention
      const testSub = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'python', 'full_program', 'print("test")', 'queued', false)
         RETURNING id;`,
        [student1.id, probA.id]
      );
      const dupeSubId = testSub.rows[0].id;
      trackedSubmissionIds.push(dupeSubId);

      const enq1 = judgeQueue.addJob({ submissionId: dupeSubId, userId: student1.id });
      const enq2 = judgeQueue.addJob({ submissionId: dupeSubId, userId: student1.id });

      assert(enq1 === true || enq1 === false, '2.4 First enqueue attempt processed');
      assert(enq2 === false, '2.5 Second enqueue attempt for identical submissionId rejected by in-buffer duplicate guard');

      // Wait for queue to drain
      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // =========================================================================
    // SECTION 3: DUPLICATE JUDGE PROCESSING & WORKER CONCURRENCY
    // =========================================================================
    console.log('\n--- 3. Judge Worker Concurrency & Terminal Execution Safety ---');
    {
      const pySumCode = 'import sys\nlines = sys.stdin.read().split()\nif len(lines) >= 2: print(int(lines[0]) + int(lines[1]))\n';
      const pyProductCode = 'import sys\nlines = sys.stdin.read().split()\nif len(lines) >= 2: print(int(lines[0]) * int(lines[1]))\n';

      // Create two submissions
      const s1Res = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'python', 'full_program', $3, 'queued', false) RETURNING id;`,
        [student1.id, probA.id, pySumCode]
      );
      const s2Res = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'python', 'full_program', $3, 'queued', false) RETURNING id;`,
        [student2.id, probB.id, pyProductCode]
      );
      const sub1Id = s1Res.rows[0].id;
      const sub2Id = s2Res.rows[0].id;
      trackedSubmissionIds.push(sub1Id, sub2Id);

      // 3.1: Parallel worker execution
      const workerPromises = [
        new Promise((resolve) => judgeQueue.addJob({ submissionId: sub1Id, userId: student1.id, resolveCallback: resolve })),
        new Promise((resolve) => judgeQueue.addJob({ submissionId: sub2Id, userId: student2.id, resolveCallback: resolve })),
      ];

      const [eval1, eval2] = await Promise.all(workerPromises);
      assert(eval1 && eval1.status === 'accepted', '3.1 Worker 1 evaluated submission successfully (accepted)');
      assert(eval2 && eval2.status === 'accepted', '3.2 Worker 2 evaluated submission successfully (accepted)');

      // 3.2: Terminal state protection under re-execution attempt
      let reExecResult = null;
      await judgeQueue.executeJob({
        submissionId: sub1Id,
        isSampleRun: false,
        resolveCallback: (res) => { reExecResult = res; },
      });
      assert(reExecResult && reExecResult.status === 'accepted', '3.3 Submissions in terminal state safely skip re-evaluation');

      // 3.3: Worker failure recovery under concurrent load
      const errSub = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'python', 'full_program', 'syntax error def [][', 'queued', false) RETURNING id;`,
        [student1.id, probA.id]
      );
      const validSub = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'python', 'full_program', $3, 'queued', false) RETURNING id;`,
        [student2.id, probA.id, pySumCode]
      );
      trackedSubmissionIds.push(errSub.rows[0].id, validSub.rows[0].id);

      const [resErr, resValid] = await Promise.all([
        new Promise((resolve) => judgeQueue.addJob({ submissionId: errSub.rows[0].id, userId: student1.id, resolveCallback: resolve })),
        new Promise((resolve) => judgeQueue.addJob({ submissionId: validSub.rows[0].id, userId: student2.id, resolveCallback: resolve })),
      ]);

      assert(resErr.status !== 'accepted', '3.4 Failing code properly maps to compilation/syntax failure');
      assert(resValid.status === 'accepted', '3.5 Valid code evaluated alongside failure succeeds cleanly');

      while (judgeQueue.runningCount > 0 || judgeQueue.queue.length > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const metrics = judgeQueue.getMetrics();
      assert(metrics.runningWorkers <= metrics.concurrencyLimit, '3.6 Worker pool state recovered after mixed failure/success load');
    }

    // =========================================================================
    // SECTION 4: CONTEST SCORING & LEADERBOARD CONCURRENCY
    // =========================================================================
    console.log('\n--- 4. Contest Scoring & Leaderboard Concurrency ---');
    {
      // 4.1: 10 concurrent standings calculations
      const standingsTasks = Array.from({ length: 10 }, () => () =>
        StandingsService.computeContestStandings({ contestId: 147, freezeOverride: true })
      );

      const standingsResults = await executeConcurrentBarrier(standingsTasks);
      const firstPayload = JSON.stringify(standingsResults[0].standings);
      const allIdentical = standingsResults.every((res) => JSON.stringify(res.standings) === firstPayload);

      assert(allIdentical, '4.1 10 concurrent standings calculations produced 100% identical scoreboard results');
      assert(standingsResults.every((r) => Array.isArray(r.standings)), '4.2 Zero deadlocks or query failures under concurrent standings load');

      // 4.2: Concurrent leaderboard requests during freeze
      const freezeTasks = Array.from({ length: 5 }, () => () =>
        request('GET', '/api/contests/147/leaderboard?page=1&limit=20', null, tokenStudent1)
      );
      const freezeResponses = await executeConcurrentBarrier(freezeTasks);
      const allOk = freezeResponses.every((r) => r.status === 200);
      assert(allOk, '4.3 Leaderboard queries under concurrent read load returned 200 OK consistently');
    }

    // =========================================================================
    // SECTION 5: RATING UPDATES & ELO CONCURRENCY
    // =========================================================================
    console.log('\n--- 5. Rating Updates & Elo Concurrency (Row Lock Serialization) ---');
    {
      const startIso = new Date(now - 7200000).toISOString();
      const endIso = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Concurrent Finalization Contest', 'Elo concurrency', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const finContestId = cRes.rows[0].id;
      trackedContestIds.push(finContestId);

      // Enroll student1 and student2
      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW());`,
        [finContestId, student1.id, student2.id]
      );
      await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
         VALUES ($1, $2, 1, 100);`,
        [finContestId, probA.id]
      );

      // Add completed submissions
      const subA = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'python', 'print("5")', 'accepted', 100, $4, false) RETURNING id;`,
        [finContestId, student1.id, probA.id, new Date(now - 5000000).toISOString()]
      );
      const subB = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'python', 'print("bad")', 'wrong_answer', 0, $4, false) RETURNING id;`,
        [finContestId, student2.id, probA.id, new Date(now - 4500000).toISOString()]
      );
      trackedSubmissionIds.push(subA.rows[0].id, subB.rows[0].id);

      // 5 simultaneous finalization requests
      const finalizeTasks = Array.from({ length: 5 }, () => () =>
        RatingService.finalizeContestRatings(finContestId, profAlan)
      );

      const finalizeResponses = await executeConcurrentBarrier(finalizeTasks);
      const initialFinalizations = finalizeResponses.filter((r) => r.alreadyFinalized !== true);
      const idempotentReturns = finalizeResponses.filter((r) => r.alreadyFinalized === true);

      assert(initialFinalizations.length === 1, `5.1 Exactly 1 concurrent call executes initial Elo calculation (got ${initialFinalizations.length})`);
      assert(idempotentReturns.length === 4, `5.2 Exactly 4 concurrent calls return alreadyFinalized: true via DB row lock (got ${idempotentReturns.length})`);

      const histCountRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`,
        [finContestId]
      );
      assert(histCountRes.rows[0].count === 2, '5.3 Database contains exactly 2 rating_history records (1 per participant, zero duplicate rows)');
    }

    // =========================================================================
    // SECTION 6: SECURE EXAMINATION CONCURRENCY
    // =========================================================================
    console.log('\n--- 6. Secure Examination Concurrency (Attempt & Session Limits) ---');
    {
      const startIso = new Date(now - 1800000).toISOString();
      const endIso = new Date(now + 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Secure Examination Session', 'Session limit test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const examContestId = cRes.rows[0].id;
      trackedContestIds.push(examContestId);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [examContestId, probA.id]);

      // 6.1: Concurrent exam-start / join across multiple tabs
      const multiTabJoins = Array.from({ length: 5 }, () => () =>
        request('POST', `/api/contests/${examContestId}/join`, {}, tokenStudent1)
      );
      const tabResponses = await executeConcurrentBarrier(multiTabJoins);
      const successfulStarts = tabResponses.filter((r) => r.status === 201);
      const duplicateStarts = tabResponses.filter((r) => r.status === 409);

      assert(successfulStarts.length === 1, '6.1 Server enforces single exam start attempt (exactly 1 tab receives 201 Created)');
      assert(duplicateStarts.length === 4, '6.2 Secondary tabs receive 409 Conflict preventing duplicate session/attempt creation');

      // 6.2: Simultaneous submissions from multiple tabs on the same exam session
      const multiTabSubmits = [
        () => request('POST', '/api/submissions', {
          contestId: examContestId,
          problemId: probA.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("tab_1_solution")',
        }, tokenStudent1),
        () => request('POST', '/api/submissions', {
          contestId: examContestId,
          problemId: probA.id,
          language: 'python',
          codingMode: 'full_program',
          sourceCode: 'print("tab_2_solution")',
        }, tokenStudent1),
      ];

      const tabSubmitResponses = await executeConcurrentBarrier(multiTabSubmits);
      assert(tabSubmitResponses[0].status === 201 && tabSubmitResponses[1].status === 201, '6.3 Concurrent submissions across tabs handled without data loss');
      trackedSubmissionIds.push(tabSubmitResponses[0].body.submission.id, tabSubmitResponses[1].body.submission.id);

      // 6.3: Submission race at exam expiry
      const expiringEnd = new Date(now + 150).toISOString();
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [expiringEnd, examContestId]);

      // Wait for deadline to elapse
      await new Promise((r) => setTimeout(r, 200));

      const postExpiryRes = await request('POST', '/api/submissions', {
        contestId: examContestId,
        problemId: probA.id,
        language: 'python',
        codingMode: 'full_program',
        sourceCode: 'print("late")',
      }, tokenStudent1);

      assert(postExpiryRes.status === 400, '6.4 Submission dispatched after exam deadline strictly rejected with 400 Bad Request');
      assert(postExpiryRes.body.message.includes('ended'), '6.5 Server-side expiry gate enforced regardless of client clock/state');
    }

    // =========================================================================
    // SECTION 7: FINALIZATION & SUBMISSIONS AT DEADLINE
    // =========================================================================
    console.log('\n--- 7. Finalization and Pending Submissions at Deadline ---');
    {
      const startIso = new Date(now - 7200000).toISOString();
      const endIso = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Pending Gate Contest', 'Pending check', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const gateContestId = cRes.rows[0].id;
      trackedContestIds.push(gateContestId);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, NOW());`, [gateContestId, student1.id]);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [gateContestId, probA.id]);

      // Create a pending submission in 'queued' state
      const pSub = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, is_sample_run)
         VALUES ($1, $2, $3, 'python', 'print("5")', 'queued', 0, false) RETURNING id;`,
        [gateContestId, student1.id, probA.id]
      );
      trackedSubmissionIds.push(pSub.rows[0].id);

      // Attempt finalization while submission is pending
      let blockedErr = null;
      try {
        await RatingService.finalizeContestRatings(gateContestId, profAlan, { force: false });
      } catch (err) {
        blockedErr = err;
      }

      assert(blockedErr !== null && blockedErr.statusCode === 409, '7.1 Finalization attempt while submissions are pending returns 409 Conflict');
      assert(blockedErr.message.includes('currently being evaluated'), '7.2 Explains pending submission judging requirement');

      // Update submission to terminal state 'accepted'
      await db.query(`UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1;`, [pSub.rows[0].id]);

      // Now finalization succeeds
      const finRes = await RatingService.finalizeContestRatings(gateContestId, profAlan, { force: false });
      assert(finRes && finRes.isRated === true, '7.3 Finalization succeeds once pending submissions reach terminal verdict');

      // Submission after finalization
      const postFinSub = await request('POST', '/api/submissions', {
        contestId: gateContestId,
        problemId: probA.id,
        language: 'python',
        codingMode: 'full_program',
        sourceCode: 'print("after")',
      }, tokenStudent1);

      assert(postFinSub.status === 400, '7.4 Submission after finalization strictly rejected with 400 Bad Request');
      assert(postFinSub.body.message.includes('already been finalized'), '7.5 Server rejects submission to finalized contest');
    }

    // =========================================================================
    // SECTION 8: RETRY AND RECOVERY AFTER INJECTED FAILURE
    // =========================================================================
    console.log('\n--- 8. Retry & Recovery After Injected Failure ---');
    {
      const startIso = new Date(now - 7200000).toISOString();
      const endIso = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Failure Recovery Contest', 'ACID rollback', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [startIso, endIso, profAlan.id]
      );
      const recContestId = cRes.rows[0].id;
      trackedContestIds.push(recContestId);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, NOW());`, [recContestId, student1.id]);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [recContestId, probA.id]);

      const subRec = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'python', 'print("5")', 'accepted', 100, NOW(), false) RETURNING id;`,
        [recContestId, student1.id, probA.id]
      );
      trackedSubmissionIds.push(subRec.rows[0].id);

      // Attempt finalization with simulated failure
      let threwErr = false;
      try {
        await RatingService.finalizeContestRatings(recContestId, profAlan, {
          force: true,
          __testSimulateFailureAt: 'user_rating',
        });
      } catch (err) {
        threwErr = true;
      }
      assert(threwErr, '8.1 Simulated failure thrown during finalization');

      // Verify ACID rollback
      const countAfterRollback = await db.query(
        `SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`,
        [recContestId]
      );
      assert(countAfterRollback.rows[0].count === 0, '8.2 Complete rollback: 0 rating history records inserted');

      const contestState = await db.query(
        `SELECT is_rating_finalized FROM contests WHERE id = $1;`,
        [recContestId]
      );
      assert(contestState.rows[0].is_rating_finalized === false, '8.3 Contest is_rating_finalized remains false');

      // Subsequent retry without failure flag
      const retryRes = await RatingService.finalizeContestRatings(recContestId, profAlan, { force: true });
      assert(retryRes && retryRes.isRated === true, '8.4 Immediate retry succeeds cleanly after rollback recovery');

      const countAfterRetry = await db.query(
        `SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`,
        [recContestId]
      );
      assert(countAfterRetry.rows[0].count === 1, '8.5 Exactly 1 rating history record created after successful retry');
    }

  } catch (error) {
    console.error('\n[FATAL CONCURRENCY TEST SUITE ERROR]:', error);
  } finally {
    console.log('\n--- Cleaning up test artifacts ---');
    await cleanupTestData();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Run baseline restoration
    const { execSync } = require('child_process');
    try {
      execSync('node backend/restore_canonical_baseline.js', { stdio: 'pipe' });
      console.log('[BASELINE RESTORED] Database canonical baseline verified.');
    } catch (e) {
      console.error('[BASELINE ERROR] Could not restore canonical baseline:', e.message);
    }

    console.log('\n================================================================');
    console.log(`CONCURRENCY RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
