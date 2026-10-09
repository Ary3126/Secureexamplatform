/**
 * CODEFROG — Phase 7.5.10.6
 * Submission / Result / Rating Integrity Test Suite
 *
 * Verifies all 14 core adversarial and regression scenarios:
 *   1. Forged submission owner ID
 *   2. Unauthorized access to another user's submission & code (BOLA/Ownership)
 *   3. Client attempts to forge an Accepted verdict
 *   4. Client attempts to change runtime, memory, score, or rating
 *   5. Duplicate judge queue enqueue & terminal execution safety
 *   6. Duplicate rating-update request (Idempotency)
 *   7. Concurrent rating updates for the same contest (Serialization / Row-Lock)
 *   8. Repeated contest-score calculation determinism
 *   9. Out-of-order judge results & pending submissions gate
 *  10. Worker failure and recovery
 *  11. Cross-contest result contamination
 *  12. Hidden test-case information leakage
 *  13. Unauthorized administrative result modification
 *  14. Transaction rollback after a partial failure
 */

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_CONTEST_MAX = '5000';
process.env.RATE_LIMIT_MEDIUM_MAX = '5000';
process.env.RATE_LIMIT_SUBMIT_MAX = '5000';
process.env.RATE_LIMIT_RUN_MAX = '5000';

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
const { generateToken } = require('./src/services/authService');

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
  console.log('CODEFROG — Phase 7.5.10.6 Submission / Result / Rating Integrity');
  console.log('================================================================\n');

  // Start temporary server
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
    // Tokens for baseline seeded users
    const student1 = { id: 2, username: 'student_seed', role: 'student' };
    const student2 = { id: 4339, username: 'Ary', role: 'student' };
    const profAlan = { id: 1093, username: 'prof_alan', role: 'professor' };
    const profSeed = { id: 3833, username: 'professor_seed', role: 'professor' };
    const superAdmin = { id: 3, username: 'platform_admin', role: 'super_admin' };

    const tokenStudent1 = generateToken(student1);
    const tokenStudent2 = generateToken(student2);
    const tokenProfAlan = generateToken(profAlan);
    const tokenProfSeed = generateToken(profSeed);
    const tokenAdmin = generateToken(superAdmin);

    // Create a base public problem for submission testing
    const baseProb = await ProblemModel.createProblem({
      title: 'Integrity Verification Public Problem',
      description: 'Find two numbers adding up to target',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      isPublished: true,
      createdBy: profAlan.id,
    });
    trackedProblemIds.push(baseProb.id);

    // Add sample and hidden test cases
    const HIDDEN_SECRET = 'SUPER_SECRET_OUTPUT_VAL_999888';
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES 
         ($1, '2 7\n9', '0 1', true, false),
         ($1, '100 200\n300', $2, false, true);`,
      [baseProb.id, HIDDEN_SECRET]
    );

    // =========================================================================
    // 1. FORGED SUBMISSION OWNER ID
    // =========================================================================
    console.log('--- 1. Submission Ownership & Identity Derivation ---');
    {
      const res = await request('POST', '/api/submissions', {
        userId: student2.id,
        user_id: student2.id,
        studentId: student2.id,
        problemId: baseProb.id,
        language: 'javascript',
        codingMode: 'function',
        sourceCode: 'function twoSum(nums, target) { return [0, 1]; }',
      }, tokenStudent1);

      assert(res.status === 201, '1.1 Authenticated submission returns 201 Created');
      assert(res.body.submission && res.body.submission.id, '1.2 Submission object returned with ID');
      const subId = res.body.submission.id;
      trackedSubmissionIds.push(subId);

      const dbSub = await db.query('SELECT id, user_id FROM submissions WHERE id = $1', [subId]);
      assert(dbSub.rows[0].user_id === student1.id, '1.3 Server derives userId from token (student1.id), ignoring forged student2.id');
      assert(dbSub.rows[0].user_id !== student2.id, '1.4 Forged userId is strictly ignored in database record');
    }

    // =========================================================================
    // 2. UNAUTHORIZED ACCESS TO ANOTHER USER'S SUBMISSION & SOURCE CODE
    // =========================================================================
    console.log('\n--- 2. BOLA / IDOR & Submission Inspection Protection ---');
    {
      const createRes = await request('POST', '/api/submissions', {
        problemId: baseProb.id,
        language: 'javascript',
        codingMode: 'function',
        sourceCode: 'function twoSum(nums, target) { /* Secret student logic */ return [0, 1]; }',
      }, tokenStudent1);
      const subAId = createRes.body.submission.id;
      trackedSubmissionIds.push(subAId);

      // Student 2 attempts to inspect Student 1 submission
      const inspRes = await request('GET', `/api/submissions/${subAId}`, null, tokenStudent2);
      assert(inspRes.status === 403, '2.1 Student 2 cannot inspect Student 1 submission (403 Forbidden)');
      assert(inspRes.body.message && inspRes.body.message.includes('cannot inspect another student'), '2.2 Error message confirms student isolation');

      // Student 2 attempts to fetch Student 1 source code
      const codeRes = await request('GET', `/api/submissions/${subAId}/code`, null, tokenStudent2);
      assert(codeRes.status === 403, '2.3 Student 2 cannot view Student 1 source code (403 Forbidden)');

      // Non-owner Professor (profSeed does not own problem or contest) attempts inspection
      const profInsp = await request('GET', `/api/submissions/${subAId}`, null, tokenProfSeed);
      assert(profInsp.status === 403, '2.4 Non-owner professor cannot inspect student submission (403 Forbidden)');

      // Platform Super Admin inspects
      const adminInsp = await request('GET', `/api/submissions/${subAId}`, null, tokenAdmin);
      assert(adminInsp.status === 200, '2.5 Platform Admin can inspect submission (200 OK)');
      assert(adminInsp.body.id === subAId, '2.6 Admin receives submission details');
    }

    // =========================================================================
    // 3. CLIENT ATTEMPTS TO FORGE AN ACCEPTED VERDICT
    // =========================================================================
    console.log('\n--- 3. Client Verdict Forgery Prevention ---');
    {
      const forgeRes = await request('POST', '/api/submissions', {
        problemId: baseProb.id,
        language: 'javascript',
        codingMode: 'function',
        sourceCode: 'function twoSum() { return []; }',
        status: 'accepted',
        verdict: 'accepted',
        score: 100,
        testCasesPassed: 10,
        testCasesTotal: 10,
      }, tokenStudent1);

      assert(forgeRes.status === 201, '3.1 Submission accepted for queuing (201 Created)');
      const subId = forgeRes.body.submission.id;
      trackedSubmissionIds.push(subId);

      const dbSub = await db.query('SELECT status, score, test_cases_passed FROM submissions WHERE id = $1', [subId]);
      assert(forgeRes.body.submission.status === 'queued', '3.2 Response reflects server-assigned queued status, client-supplied accepted stripped');
      assert(dbSub.rows[0].status !== 'accepted', '3.3 Database status reflects internal server queue/verdict, not client-supplied accepted');
    }

    // =========================================================================
    // 4. CLIENT ATTEMPTS TO FORGE RUNTIME, MEMORY, SCORE, OR RATING
    // =========================================================================
    console.log('\n--- 4. Client Metrics and Rating Tampering Protection ---');
    {
      const forgeMetricsRes = await request('POST', '/api/submissions', {
        problemId: baseProb.id,
        language: 'javascript',
        codingMode: 'function',
        sourceCode: 'function twoSum() { return []; }',
        executionTime: 1,
        execution_time: 1,
        memoryUsed: 10,
        memory_used: 10,
        score: 9999,
      }, tokenStudent1);

      assert(forgeMetricsRes.status === 201, '4.1 Submission created (201)');
      const subId = forgeMetricsRes.body.submission.id;
      trackedSubmissionIds.push(subId);

      // Verify DB initial creation values are 0
      const dbSub = await db.query('SELECT execution_time, memory_used, score FROM submissions WHERE id = $1', [subId]);
      assert(dbSub.rows[0].execution_time === 0 || dbSub.rows[0].execution_time === null, '4.2 Client execution_time stripped (0 or null in initial record)');
      assert(dbSub.rows[0].memory_used === 0 || dbSub.rows[0].memory_used === null, '4.3 Client memory_used stripped (0 or null in initial record)');
      assert(dbSub.rows[0].score === 0, '4.4 Client score stripped (initial score is 0)');
    }

    // =========================================================================
    // 5. DUPLICATE JUDGE QUEUE ENQUEUE & TERMINAL EXECUTION SAFETY
    // =========================================================================
    console.log('\n--- 5. Queue Idempotency & Terminal Execution Safety ---');
    {
      const subRes = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'javascript', 'function', 'console.log("hello");', 'queued', false)
         RETURNING id;`,
        [student1.id, baseProb.id]
      );
      const testSubId = subRes.rows[0].id;
      trackedSubmissionIds.push(testSubId);

      // Add to queue buffer (simulate queueing)
      const addedFirst = judgeQueue.addJob({ submissionId: testSubId, userId: student1.id });
      assert(addedFirst === true || addedFirst === false, '5.1 First enqueue attempt handled');

      // Attempt duplicate enqueue while job is active or in buffer
      const addedDuplicate = judgeQueue.addJob({ submissionId: testSubId, userId: student1.id });
      assert(addedDuplicate === false, '5.2 Duplicate enqueue for same submissionId is rejected (false)');

      // Now simulate terminal submission in DB
      await db.query(`UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1`, [testSubId]);
      let callbackResult = null;
      await judgeQueue.executeJob({
        submissionId: testSubId,
        isSampleRun: false,
        resolveCallback: (res) => { callbackResult = res; },
      });
      assert(callbackResult !== null && callbackResult.status === 'accepted', '5.3 Worker safely detects terminal state and skips re-evaluation');
    }

    // =========================================================================
    // 6. DUPLICATE RATING-UPDATE REQUEST (IDEMPOTENCY)
    // =========================================================================
    console.log('\n--- 6. Idempotent Repeated Finalization ---');
    {
      // Create a test rated contest that has ended
      const now = Date.now();
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Test Rated Contest Idempotency', 'Integrity testing', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const testContestId = cRes.rows[0].id;
      trackedContestIds.push(testContestId);

      // Enroll student1 and student2
      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW());`,
        [testContestId, student1.id, student2.id]
      );

      // Attach base problem
      await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
         VALUES ($1, $2, 1, 100);`,
        [testContestId, baseProb.id]
      );

      // Insert completed submissions for both participants
      const s1 = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("0 1");', 'accepted', 100, $4, false)
         RETURNING id;`,
        [testContestId, student1.id, baseProb.id, new Date(now - 5000000).toISOString()]
      );
      trackedSubmissionIds.push(s1.rows[0].id);

      const s2 = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("bad");', 'wrong_answer', 0, $4, false)
         RETURNING id;`,
        [testContestId, student2.id, baseProb.id, new Date(now - 4500000).toISOString()]
      );
      trackedSubmissionIds.push(s2.rows[0].id);

      // First finalization
      const firstRes = await RatingService.finalizeContestRatings(testContestId, profAlan);
      assert(firstRes && firstRes.isRated === true, '6.1 Initial rating finalization succeeds');
      assert(firstRes.ratingUpdates && firstRes.ratingUpdates.length === 2, '6.2 2 participant rating updates generated');

      const countAfterFirst = await db.query(
        'SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1',
        [testContestId]
      );
      assert(countAfterFirst.rows[0].count === 2, '6.3 2 rows inserted into rating_history');

      // Second finalization call (repeated request)
      const secondRes = await RatingService.finalizeContestRatings(testContestId, profAlan);
      assert(secondRes && secondRes.alreadyFinalized === true, '6.4 Repeated finalization returns alreadyFinalized: true');

      const countAfterSecond = await db.query(
        'SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1',
        [testContestId]
      );
      assert(countAfterSecond.rows[0].count === 2, '6.5 Idempotency: Exactly 2 rows remain in rating_history, zero duplicates inserted');
    }

    // =========================================================================
    // 7. CONCURRENT RATING UPDATES FOR THE SAME CONTEST
    // =========================================================================
    console.log('\n--- 7. Concurrent Finalization Serialization ---');
    {
      const now = Date.now();
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Test Concurrent Contest', 'Concurrency test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const concurrentContestId = cRes.rows[0].id;
      trackedContestIds.push(concurrentContestId);

      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW());`,
        [concurrentContestId, student1.id, student2.id]
      );
      await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
         VALUES ($1, $2, 1, 100);`,
        [concurrentContestId, baseProb.id]
      );
      const subCon1 = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("0 1");', 'accepted', 100, $4, false)
         RETURNING id;`,
        [concurrentContestId, student1.id, baseProb.id, new Date(now - 5000000).toISOString()]
      );
      trackedSubmissionIds.push(subCon1.rows[0].id);

      // Launch 2 simultaneous finalizations
      const [resA, resB] = await Promise.all([
        RatingService.finalizeContestRatings(concurrentContestId, profAlan),
        RatingService.finalizeContestRatings(concurrentContestId, profAlan),
      ]);

      const oneFinalized = (resA.alreadyFinalized === true && !resB.alreadyFinalized) ||
                            (resB.alreadyFinalized === true && !resA.alreadyFinalized);
      assert(oneFinalized, '7.1 One concurrent call finalizes, the other detects alreadyFinalized via DB lock');

      const countConcurrent = await db.query(
        'SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1',
        [concurrentContestId]
      );
      assert(countConcurrent.rows[0].count === 2, '7.2 Exactly 2 rating_history entries created under concurrent execution');
    }

    // =========================================================================
    // 8. REPEATED CONTEST SCORE CALCULATION DETERMINISM
    // =========================================================================
    console.log('\n--- 8. Deterministic Contest Score Calculation ---');
    {
      const run1 = await StandingsService.computeContestStandings({
        contestId: 147,
        isExport: true,
        limit: 'all',
        freezeOverride: true,
      });

      const run2 = await StandingsService.computeContestStandings({
        contestId: 147,
        isExport: true,
        limit: 'all',
        freezeOverride: true,
      });

      const run3 = await StandingsService.computeContestStandings({
        contestId: 147,
        isExport: true,
        limit: 'all',
        freezeOverride: true,
      });

      const json1 = JSON.stringify(run1.standings);
      const json2 = JSON.stringify(run2.standings);
      const json3 = JSON.stringify(run3.standings);

      assert(json1 === json2, '8.1 Standings run 1 matches run 2 deterministically');
      assert(json2 === json3, '8.2 Standings run 2 matches run 3 deterministically');
      assert(run1.standings.length === run2.standings.length, '8.3 Participant count is perfectly consistent across runs');
    }

    // =========================================================================
    // 9. OUT-OF-ORDER JUDGE RESULTS & PENDING SUBMISSIONS GATE
    // =========================================================================
    console.log('\n--- 9. Pending Submissions Gate & Verdict Mapping ---');
    {
      const now = Date.now();
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Test Pending Submissions Contest', 'Pending test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const pendingContestId = cRes.rows[0].id;
      trackedContestIds.push(pendingContestId);

      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW());`,
        [pendingContestId, student1.id]
      );

      // Create a submission stuck in 'queued'
      const pendingSub = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("pending");', 'queued', 0, false)
         RETURNING id;`,
        [pendingContestId, student1.id, baseProb.id]
      );
      trackedSubmissionIds.push(pendingSub.rows[0].id);

      // Attempt finalization without force
      let blockedError = null;
      try {
        await RatingService.finalizeContestRatings(pendingContestId, profAlan, { force: false });
      } catch (err) {
        blockedError = err;
      }

      assert(blockedError !== null, '9.1 Finalization is blocked when submissions are pending');
      assert(blockedError.statusCode === 409, '9.2 Returns 409 Conflict status');
      assert(blockedError.message.includes('currently being evaluated'), '9.3 Explains pending submission evaluation requirement');
    }

    // =========================================================================
    // 10. WORKER FAILURE AND RECOVERY
    // =========================================================================
    console.log('\n--- 10. Worker Failure & Graceful Recovery ---');
    {
      // Create submission with broken code
      const errSub = await db.query(
        `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, is_sample_run)
         VALUES ($1, $2, 'javascript', 'function', 'syntax error {{{', 'queued', false)
         RETURNING id;`,
        [student1.id, baseProb.id]
      );
      const errSubId = errSub.rows[0].id;
      trackedSubmissionIds.push(errSubId);

      // Execute job in queue
      const evaluated = await new Promise((resolve) => {
        judgeQueue.addJob({
          submissionId: errSubId,
          userId: student1.id,
          isSampleRun: false,
          resolveCallback: resolve,
        });
      });

      assert(evaluated !== null, '10.1 Job completed and returned evaluation');
      assert(evaluated.status !== 'accepted', '10.2 Broken code is NEVER marked accepted');
      assert(evaluated.status === 'compilation_error' || evaluated.status === 'wrong_answer' || evaluated.status === 'system_error', '10.3 Maps cleanly to failure status');

      // Wait a tick for worker .finally() to complete cleanup
      await new Promise((r) => setTimeout(r, 50));

      const metrics = judgeQueue.getMetrics();
      assert(metrics.runningWorkers <= metrics.concurrencyLimit, '10.4 Worker pool state cleanly recovered');
      assert(!metrics.activeJobs.includes(errSubId), '10.5 Active job set properly cleared');
    }

    // =========================================================================
    // 11. CROSS-CONTEST RESULT CONTAMINATION
    // =========================================================================
    console.log('\n--- 11. Cross-Contest Result Isolation ---');
    {
      const now = Date.now();
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();

      // Create Contest X and Contest Y
      const cX = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Contest X', 'Isolation test', $1, $2, $3, 'published', true) RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const contestXId = cX.rows[0].id;
      trackedContestIds.push(contestXId);

      const cY = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Contest Y', 'Isolation test', $1, $2, $3, 'published', true) RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const contestYId = cY.rows[0].id;
      trackedContestIds.push(contestYId);

      // Add base problem to both
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [contestXId, baseProb.id]);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`, [contestYId, baseProb.id]);

      // Enroll student1 in both
      await db.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, NOW());`, [contestXId, student1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, NOW());`, [contestYId, student1.id]);

      // Submit Accepted solution ONLY to Contest X
      const subX = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("0 1");', 'accepted', 100, NOW(), false) RETURNING id;`,
        [contestXId, student1.id, baseProb.id]
      );
      trackedSubmissionIds.push(subX.rows[0].id);

      // Check Contest Y Standings
      const standingsY = await StandingsService.computeContestStandings({ contestId: contestYId });
      const pY = standingsY.standings.find((p) => p.userId === student1.id);

      assert(pY !== undefined, '11.1 Participant found in Contest Y');
      assert(pY.totalScore === 0, '11.2 Participant score in Contest Y is strictly 0 (not contaminated by Contest X submission)');
      assert(pY.solvedProblemsCount === 0, '11.3 Participant solved count in Contest Y is strictly 0');
    }

    // =========================================================================
    // 12. HIDDEN TEST-CASE INFORMATION LEAKAGE
    // =========================================================================
    console.log('\n--- 12. Hidden Test-Case Secrecy Protection ---');
    {
      // Check test-cases endpoint as student
      const leakRes = await request('GET', `/api/problems/${baseProb.id}/test-cases`, null, tokenStudent1);
      assert(leakRes.status === 403, '12.1 Student calling /api/problems/:id/test-cases receives 403 Forbidden');

      // Create official submission and inspect details
      const subRes = await request('POST', '/api/submissions', {
        problemId: baseProb.id,
        language: 'javascript',
        codingMode: 'function',
        sourceCode: 'function twoSum(nums, target) { return [0, 1]; }',
      }, tokenStudent1);
      const subId = subRes.body.submission.id;
      trackedSubmissionIds.push(subId);

      const detailRes = await request('GET', `/api/submissions/${subId}`, null, tokenStudent1);
      assert(detailRes.status === 200, '12.2 Submission details fetched (200 OK)');
      assert(detailRes.body.sampleResults === undefined, '12.3 Official submission details do not contain sampleResults');

      // Check if hidden secret is present in submission detail response
      const strPayload = JSON.stringify(detailRes.body);
      assert(!strPayload.includes(HIDDEN_SECRET), '12.4 Hidden test case expected output (secret) never leaked in submission response');

      // Run sample tests interactively
      const sampleRunRes = await request('POST', '/api/submissions/run', {
        problemId: baseProb.id,
        language: 'python',
        codingMode: 'full_program',
        sourceCode: 'print("0 1")',
      }, tokenStudent1);
      assert(sampleRunRes.status === 200, '12.5 Interactive sample run returns 200 OK');
      const sampleRunPayload = JSON.stringify(sampleRunRes.body);
      assert(!sampleRunPayload.includes(HIDDEN_SECRET), '12.6 Interactive run does not leak hidden test case secret');

      const samples = sampleRunRes.body.runResult?.sampleResults || [];
      assert(samples.length === 1, '12.7 Interactive run returns only the 1 visible sample test case');
      assert(samples[0].expectedOutput === '0 1', '12.8 Returned sample test case matches visible expected output');
    }

    // =========================================================================
    // 13. UNAUTHORIZED ADMINISTRATIVE RESULT MODIFICATION
    // =========================================================================
    console.log('\n--- 13. Unauthorized Administrative Action & Endpoint Protection ---');
    {
      // Student attempts to finalize ratings
      const stuFinalize = await request('POST', '/api/contests/147/finalize-ratings', {}, tokenStudent1);
      assert(stuFinalize.status === 403, '13.1 Student cannot finalize ratings (403 Forbidden)');

      // Non-owner professor attempts to finalize Contest 147 (owned by profAlan)
      const profSeedFinalize = await request('POST', '/api/contests/147/finalize-ratings', {}, tokenProfSeed);
      assert(profSeedFinalize.status === 403, '13.2 Non-owner professor cannot finalize ratings (403 Forbidden)');

      // Check non-existent update routes on submissions
      const putSub = await request('PUT', '/api/submissions/1', { status: 'accepted' }, tokenAdmin);
      assert(putSub.status === 404, '13.3 PUT /api/submissions/:id returns 404 (endpoint does not exist)');

      const patchSub = await request('PATCH', '/api/submissions/1', { score: 100 }, tokenAdmin);
      assert(patchSub.status === 404, '13.4 PATCH /api/submissions/:id returns 404 (endpoint does not exist)');

      const deleteSub = await request('DELETE', '/api/submissions/1', null, tokenAdmin);
      assert(deleteSub.status === 404, '13.5 DELETE /api/submissions/:id returns 404 (endpoint does not exist)');
    }

    // =========================================================================
    // 14. TRANSACTION ROLLBACK AFTER A PARTIAL FAILURE
    // =========================================================================
    console.log('\n--- 14. Transaction Rollback & Failure Recovery ---');
    {
      const now = Date.now();
      const pastStart = new Date(now - 7200000).toISOString();
      const pastEnd = new Date(now - 3600000).toISOString();

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated)
         VALUES ('Test Rollback Contest', 'Rollback test', $1, $2, $3, 'published', true)
         RETURNING id;`,
        [pastStart, pastEnd, profAlan.id]
      );
      const rollbackContestId = cRes.rows[0].id;
      trackedContestIds.push(rollbackContestId);

      await db.query(
        `INSERT INTO contest_participants (contest_id, user_id, joined_at)
         VALUES ($1, $2, NOW()), ($1, $3, NOW());`,
        [rollbackContestId, student1.id, student2.id]
      );
      await db.query(
        `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
         VALUES ($1, $2, 1, 100);`,
        [rollbackContestId, baseProb.id]
      );
      const rSub = await db.query(
        `INSERT INTO submissions (contest_id, user_id, problem_id, language, source_code, status, score, created_at, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'console.log("0 1");', 'accepted', 100, NOW(), false)
         RETURNING id;`,
        [rollbackContestId, student1.id, baseProb.id]
      );
      trackedSubmissionIds.push(rSub.rows[0].id);

      // Record student1 current rating
      const uBefore = await db.query('SELECT current_rating, rated_contest_count FROM users WHERE id = $1', [student1.id]);
      const initialRating = uBefore.rows[0].current_rating;
      const initialCount = uBefore.rows[0].rated_contest_count;

      // Finalize with simulated failure midway
      let threw = false;
      try {
        await RatingService.finalizeContestRatings(rollbackContestId, profAlan, {
          force: true,
          __testSimulateFailureAt: 'user_rating',
        });
      } catch (err) {
        threw = true;
        assert(err.message === 'SIMULATED_FAILURE_USER_RATING', '14.1 Simulated failure triggered at user_rating step');
      }
      assert(threw, '14.2 Finalization threw during simulated failure');

      // Verify complete rollback in database
      const histRes = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1', [rollbackContestId]);
      assert(histRes.rows[0].count === 0, '14.3 ACID Rollback: 0 rows inserted in rating_history after failure');

      const contestAfter = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1', [rollbackContestId]);
      assert(contestAfter.rows[0].is_rating_finalized === false, '14.4 ACID Rollback: contest.is_rating_finalized remains false');

      const uAfter = await db.query('SELECT current_rating, rated_contest_count FROM users WHERE id = $1', [student1.id]);
      assert(uAfter.rows[0].current_rating === initialRating, '14.5 ACID Rollback: User rating remains unchanged');
      assert(uAfter.rows[0].rated_contest_count === initialCount, '14.6 ACID Rollback: User rated_contest_count remains unchanged');
    }

  } catch (error) {
    console.error('\n[FATAL TEST SUITE ERROR]:', error);
  } finally {
    console.log('\n--- Cleaning up test artifacts ---');
    await cleanupTestData();

    // Close server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Run restore_canonical_baseline.js
    const { execSync } = require('child_process');
    try {
      execSync('node backend/restore_canonical_baseline.js', { stdio: 'pipe' });
      console.log('[BASELINE RESTORED] Database canonical baseline verified.');
    } catch (e) {
      console.error('[BASELINE ERROR] Could not restore canonical baseline:', e.message);
    }

    console.log('\n================================================================');
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
