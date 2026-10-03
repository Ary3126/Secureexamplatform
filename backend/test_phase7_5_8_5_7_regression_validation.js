/**
 * Phase 7.5.8.5.7 — Testing & Regression Verification Suite
 * File: backend/test_phase7_5_8_5_7_regression_validation.js
 *
 * Full-scope integration, consistency, concurrency, security, and performance
 * sanity validation for the Contest Freeze & Final Results workflow.
 */

process.env.RATE_LIMIT_CONTEST_MAX = '5000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { getContestFreezeState } = require('./src/services/contestService');
const RatingService = require('./src/services/ratingService');
const StandingsService = require('./src/services/standingsService');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

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
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let testPassed = 0;
let testFailed = 0;

function pass(name) {
  testPassed++;
  console.log(`  [PASS] ${name}`);
}

function fail(name, err) {
  testFailed++;
  console.error(`  [FAIL] ${name}:`, err.message || err);
}

async function run() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.5.7: Comprehensive Testing & Regression Suite');
  console.log('================================================================\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const passwordHash = await hashPassword('SecurePass123!');

  // Provision users
  const profOwner = await UserModel.createUser({
    username: `prof_reg_owner_${timestamp}`,
    email: `prof_reg_owner_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Professor Reg Owner',
    role: 'professor',
  });
  const profOther = await UserModel.createUser({
    username: `prof_reg_other_${timestamp}`,
    email: `prof_reg_other_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Professor Reg Other',
    role: 'professor',
  });
  const contestAdmin = await UserModel.createUser({
    username: `cadmin_reg_${timestamp}`,
    email: `cadmin_reg_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Contest Admin Reg',
    role: 'contest_admin',
  });
  const student1 = await UserModel.createUser({
    username: `stu1_reg_${timestamp}`,
    email: `stu1_reg_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Student Reg One',
    role: 'student',
  });
  const student2 = await UserModel.createUser({
    username: `stu2_reg_${timestamp}`,
    email: `stu2_reg_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Student Reg Two',
    role: 'student',
  });
  const student3 = await UserModel.createUser({
    username: `stu3_reg_${timestamp}`,
    email: `stu3_reg_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Student Reg Three',
    role: 'student',
  });

  const tokenProfOwner = generateToken(profOwner);
  const tokenProfOther = generateToken(profOther);
  const tokenContestAdmin = generateToken(contestAdmin);
  const tokenStudent1 = generateToken(student1);
  const tokenStudent2 = generateToken(student2);
  const tokenStudent3 = generateToken(student3);

  // Provision problems
  const probA = await ProblemModel.createProblem({
    title: `Reg Prob A ${timestamp}`,
    description: 'Solve problem A',
    difficulty: 'easy',
    createdBy: profOwner.id,
  });
  const probB = await ProblemModel.createProblem({
    title: `Reg Prob B ${timestamp}`,
    description: 'Solve problem B',
    difficulty: 'medium',
    createdBy: profOwner.id,
  });

  try {
    // -------------------------------------------------------------
    // SECTION 1: Full Lifecycle Scenarios A through F
    // -------------------------------------------------------------
    console.log('--- 1. Full Lifecycle Scenarios A through F ---');

    // Scenario A: Contest Configured -> Runs -> Submissions -> Standings
    // 120 min duration: started 90 min ago, ends in 30 min.
    // Freeze is 45 min before end -> starts at 120 - 45 = 75 min from start (15 min ago).
    const now = new Date();
    const startTimeA = new Date(now.getTime() - 90 * 60 * 1000); // 90 min ago
    const endTimeA = new Date(now.getTime() + 30 * 60 * 1000);   // 30 min left

    const contestA = await ContestModel.createContest({
      title: `Scenario A Contest ${timestamp}`,
      description: 'End to end lifecycle test contest',
      createdBy: profOwner.id,
      startTime: startTimeA.toISOString(),
      endTime: endTimeA.toISOString(),
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 45, // frozen since -15 min from now
    });
    await ContestModel.updateContestStatus(contestA.id, 'published');

    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: probA.id, points: 100, problemOrder: 1 });
    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: probB.id, points: 200, problemOrder: 2 });

    await ContestModel.addParticipant(contestA.id, student1.id);
    await ContestModel.addParticipant(contestA.id, student2.id);
    await ContestModel.addParticipant(contestA.id, student3.id);

    // Pre-freeze submission for Student 1 (solve prob A, 100 pts) at 20 min into contest (-70 min from now)
    const tPreFreeze = new Date(startTimeA.getTime() + 20 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', 100, false, $6)`,
      [student1.id, probA.id, contestA.id, 'code_s1_a', 'javascript', tPreFreeze.toISOString()]
    );

    // Scenario B: Post-freeze submission for Student 2 (solve prob B, 200 pts) at 85 min into contest (-5 min from now, during freeze window)
    const tPostFreeze = new Date(startTimeA.getTime() + 85 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', 200, false, $6)`,
      [student2.id, probB.id, contestA.id, 'code_s2_b', 'javascript', tPostFreeze.toISOString()]
    );

    // Check Scenario B: Leaderboard during freeze masks Student 2
    const resLbFrozen = await request('GET', `/api/contests/${contestA.id}/leaderboard`, null, tokenStudent1);
    assert.strictEqual(resLbFrozen.status, 200);
    assert.strictEqual(resLbFrozen.body.isFrozen, true);
    assert.strictEqual(resLbFrozen.body.freezeState, 'FROZEN');

    const s1RowFrozen = resLbFrozen.body.standings.find((r) => r.userId === student1.id);
    const s2RowFrozen = resLbFrozen.body.standings.find((r) => r.userId === student2.id);
    assert.strictEqual(s1RowFrozen.totalScore, 100);
    assert.strictEqual(s2RowFrozen.totalScore, 0, 'Student 2 post-freeze solve must be masked to 0');
    pass('1.1 Scenario A & B: Contest running with active freeze masks post-freeze solves on public leaderboard');

    // Scenario C: Contest ends -> Pending judging guard blocks finalization
    // Transition contest to ended
    await db.query(`UPDATE contests SET end_time = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [contestA.id]);

    // Insert a pending submission for Student 3
    const resPending = await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', 0, false, NOW() - INTERVAL '10 minutes')
       RETURNING id`,
      [student3.id, probA.id, contestA.id, 'code_s3_pending', 'javascript']
    );
    const pendingSubId = resPending.rows[0].id;

    // Attempt to finalize while judging pending -> expect 409 Conflict
    const resFinPending = await request('POST', `/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfOwner);
    assert.strictEqual(resFinPending.status, 409, 'Must block finalization while judging pending');
    assert.strictEqual(resFinPending.body.error, 'CONFLICT');
    pass('1.2 Scenario C: Pending judging submission blocks finalization with 409 Conflict');

    // Complete judging
    await db.query(
      `UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1`,
      [pendingSubId]
    );

    // Scenario D: Authoritative finalization & publication
    const resFinSuccess = await request('POST', `/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfOwner);
    assert.strictEqual(resFinSuccess.status, 200);
    assert.strictEqual(resFinSuccess.body.contestId, contestA.id);
    assert.ok(resFinSuccess.body.ratingUpdates.length > 0);
    pass('1.3 Scenario D: Finalization succeeds and calculates official rating updates');

    // Scenario E: Result lock blocks mutations post-finalization
    const resMutateRated = await request('PUT', `/api/contests/${contestA.id}`, { isRated: false }, tokenProfOwner);
    assert.strictEqual(resMutateRated.status, 409, 'Mutating isRated post-finalization must return 409');

    const resAddProb = await request('POST', `/api/contests/${contestA.id}/problems`, { problemId: probA.id }, tokenProfOwner);
    assert.strictEqual(resAddProb.status, 409, 'Adding problem post-finalization must return 409');

    // Harmless metadata edit (e.g. title) should succeed
    const resEditTitle = await request('PUT', `/api/contests/${contestA.id}`, { title: 'Updated Title Post-Final' }, tokenProfOwner);
    assert.strictEqual(resEditTitle.status, 200, 'Harmless metadata edit must succeed');
    pass('1.4 Scenario E: Result-lock blocks result-affecting mutations while permitting metadata updates');

    // Scenario F: Repeated finalization is idempotent with zero side effects
    const resFinRepeat = await request('POST', `/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfOwner);
    assert.strictEqual(resFinRepeat.status, 200);
    assert.strictEqual(resFinRepeat.body.alreadyFinalized, true);

    const checkHist = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1`, [contestA.id]);
    assert.strictEqual(checkHist.rows[0].count, 3, 'Zero duplicate rows created on repeated finalization');
    pass('1.5 Scenario F: Repeated finalization returns idempotent no-op without duplicate rating history');

    // -------------------------------------------------------------
    // SECTION 2: Cross-Layer Result Consistency Verification
    // -------------------------------------------------------------
    console.log('\n--- 2. Cross-Layer Result Consistency Verification ---');

    // 1. Leaderboard Endpoint
    const resLbFinal = await request('GET', `/api/contests/${contestA.id}/leaderboard`, null, tokenStudent1);
    assert.strictEqual(resLbFinal.status, 200);
    assert.strictEqual(resLbFinal.body.freezeState, 'FINAL');
    const lbStandings = resLbFinal.body.standings;

    // 2. Results Endpoint
    const resResultsFinal = await request('GET', `/api/contests/${contestA.id}/results`, null, tokenStudent1);
    assert.strictEqual(resResultsFinal.status, 200);
    const resultsStandings = resResultsFinal.body.results;

    // 3. Admin Leaderboard
    const resAdminLb = await request('GET', `/api/contests/${contestA.id}/admin-leaderboard`, null, tokenProfOwner);
    assert.strictEqual(resAdminLb.status, 200);
    const adminStandings = resAdminLb.body.standings;

    // 4. Student 1 Result Details (/results/me)
    const resMe = await request('GET', `/api/contests/${contestA.id}/results/me`, null, tokenStudent1);
    assert.strictEqual(resMe.status, 200);
    const s1Details = resMe.body;

    // 5. Database Snapshot
    const resSnap = await db.query(`SELECT final_results_snapshot FROM contests WHERE id = $1`, [contestA.id]);
    const snapshotStandings = resSnap.rows[0].final_results_snapshot.standings;

    // Verify consistency across all 5 views
    assert.strictEqual(lbStandings.length, 3);
    assert.strictEqual(resultsStandings.length, 3);
    assert.strictEqual(adminStandings.length, 3);
    assert.strictEqual(snapshotStandings.length, 3);

    for (let i = 0; i < 3; i++) {
      const uId = lbStandings[i].userId;
      assert.strictEqual(resultsStandings[i].userId, uId, `Rank ${i + 1} user mismatch between LB and Results`);
      assert.strictEqual(adminStandings[i].userId, uId, `Rank ${i + 1} user mismatch between LB and Admin LB`);
      assert.strictEqual(snapshotStandings[i].userId, uId, `Rank ${i + 1} user mismatch between LB and Snapshot`);

      assert.strictEqual(lbStandings[i].totalScore, resultsStandings[i].totalScore);
      assert.strictEqual(lbStandings[i].rank, resultsStandings[i].rank);
      assert.strictEqual(lbStandings[i].solvedProblemsCount, resultsStandings[i].solvedProblemsCount);
    }

    assert.strictEqual(lbStandings[0].userId, student2.id);
    assert.strictEqual(lbStandings[0].totalScore, 200);
    assert.strictEqual(lbStandings[0].rank, 1);

    assert.strictEqual(lbStandings[1].userId, student1.id);
    assert.strictEqual(lbStandings[1].totalScore, 100);
    assert.strictEqual(lbStandings[1].rank, 2);

    assert.strictEqual(lbStandings[2].userId, student3.id);
    assert.strictEqual(lbStandings[2].totalScore, 100);
    assert.strictEqual(lbStandings[2].rank, 3);

    assert.strictEqual(s1Details.summary.rank, 2);
    assert.strictEqual(s1Details.summary.totalScore, 100);
    assert.strictEqual(s1Details.summary.solvedProblemsCount, 1);

    pass('2.1 Cross-layer consistency verified across DB Snapshot, Standings, Leaderboard, Results, Admin Leaderboard, and Result Details');

    // -------------------------------------------------------------
    // SECTION 3: Freeze State Boundary & Clock Resilience
    // -------------------------------------------------------------
    console.log('\n--- 3. Freeze State Boundary & Clock Resilience ---');

    const baseT = new Date('2026-10-01T10:00:00Z');
    const contestTiming = {
      startTime: baseT,
      endTime: new Date('2026-10-01T12:00:00Z'), // 120 min duration
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 60, // freeze starts at 11:00:00Z
      isRatingFinalized: false,
    };

    // Before freeze
    const stBefore = getContestFreezeState(contestTiming, new Date('2026-10-01T10:59:59Z'));
    assert.strictEqual(stBefore.isFrozen, false);
    assert.strictEqual(stBefore.freezeState, 'NOT_FROZEN');

    // Freeze boundary second
    const stBoundary = getContestFreezeState(contestTiming, new Date('2026-10-01T11:00:00Z'));
    assert.strictEqual(stBoundary.isFrozen, true);
    assert.strictEqual(stBoundary.freezeState, 'FROZEN');

    // During freeze window
    const stDuring = getContestFreezeState(contestTiming, new Date('2026-10-01T11:30:00Z'));
    assert.strictEqual(stDuring.isFrozen, true);
    assert.strictEqual(stDuring.freezeState, 'FROZEN');

    // End boundary second
    const stEndBoundary = getContestFreezeState(contestTiming, new Date('2026-10-01T12:00:00Z'));
    assert.strictEqual(stEndBoundary.isFrozen, true);
    assert.strictEqual(stEndBoundary.freezeState, 'FROZEN');

    // After contest end before finalization
    const stAfterEnd = getContestFreezeState(contestTiming, new Date('2026-10-01T12:00:01Z'));
    assert.strictEqual(stAfterEnd.isFrozen, false);
    assert.strictEqual(stAfterEnd.freezeState, 'NOT_FROZEN');

    // Finalized contest
    const contestFinalized = { ...contestTiming, isRatingFinalized: true };
    const stFinal = getContestFreezeState(contestFinalized, new Date('2026-10-01T11:30:00Z'));
    assert.strictEqual(stFinal.isFrozen, false);
    assert.strictEqual(stFinal.freezeState, 'FINAL');

    pass('3.1 Freeze boundary conditions accurately computed across all 6 time states');

    // -------------------------------------------------------------
    // SECTION 4: Security Regression & Authorization Hardening
    // -------------------------------------------------------------
    console.log('\n--- 4. Security Regression & Authorization Hardening ---');

    // Unauthenticated access
    const resAnonFin = await request('POST', `/api/contests/${contestA.id}/finalize-ratings`, {});
    assert.strictEqual(resAnonFin.status, 401);

    // Student BOLA attempt on another participant
    const resStuBola = await request(
      'GET',
      `/api/contests/${contestA.id}/participants/${student2.id}/results`,
      null,
      tokenStudent1
    );
    assert.strictEqual(resStuBola.status, 403, 'Student BOLA must return 403');

    // Professor BOLA attempt on non-owned contest
    const resProfBola = await request(
      'GET',
      `/api/contests/${contestA.id}/admin-leaderboard`,
      null,
      tokenProfOther
    );
    assert.strictEqual(resProfBola.status, 403, 'Non-owner professor must return 403');

    // SQL Injection in path parameter
    const resSqlInj = await request('GET', `/api/contests/' OR '1'='1/results`, null, tokenStudent1);
    assert.strictEqual(resSqlInj.status, 400);

    // Sensitive data exposure check
    const rawResStr = JSON.stringify(resLbFinal.body);
    assert.ok(!rawResStr.includes('password_hash'));
    assert.ok(!rawResStr.includes('jwt_secret'));

    pass('4.1 Authentication, RBAC, BOLA, SQL injection, and sensitive data protection verified');

    // -------------------------------------------------------------
    // SECTION 5: Concurrency & Stress Handling
    // -------------------------------------------------------------
    console.log('\n--- 5. Concurrency & Stress Handling ---');

    // Provision a new contest for concurrent finalization testing
    const startTimeConc = new Date(now.getTime() - 60 * 60 * 1000);
    const endTimeConc = new Date(now.getTime() - 10 * 60 * 1000);
    const contestConc = await ContestModel.createContest({
      title: `Concurrent Test Contest ${timestamp}`,
      description: 'Concurrency stress test',
      createdBy: profOwner.id,
      startTime: startTimeConc.toISOString(),
      endTime: endTimeConc.toISOString(),
      isRated: true,
      leaderboardFreezeEnabled: false,
    });
    await ContestModel.updateContestStatus(contestConc.id, 'published');
    await ContestModel.addParticipant(contestConc.id, student1.id);
    await ContestModel.addParticipant(contestConc.id, student2.id);

    // Launch 5 concurrent finalization requests simultaneously
    const finPromises = [
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
    ];
    const finResults = await Promise.all(finPromises);

    // All should return 200 OK
    for (const r of finResults) {
      assert.strictEqual(r.status, 200);
    }
    const executedCount = finResults.filter((r) => r.body.alreadyFinalized !== true).length;
    const skippedCount = finResults.filter((r) => r.body.alreadyFinalized === true).length;

    assert.strictEqual(executedCount, 1, 'Exactly one concurrent call executes calculation');
    assert.strictEqual(skippedCount, 4, 'Remaining concurrent calls receive idempotent skip');

    // Check database rating_history integrity
    const histConc = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1`, [contestConc.id]);
    assert.strictEqual(histConc.rows[0].count, 2, 'Exactly 2 rating updates recorded (one per participant)');
    pass('5.1 5 concurrent finalization calls serialize safely with zero race condition side effects');

    // -------------------------------------------------------------
    // SECTION 6: Performance Sanity Verification
    // -------------------------------------------------------------
    console.log('\n--- 6. Performance Sanity Verification ---');

    // Benchmark 20 consecutive leaderboard requests
    const tStartLb = Date.now();
    for (let i = 0; i < 20; i++) {
      const res = await request('GET', `/api/contests/${contestA.id}/leaderboard`, null, tokenStudent1);
      assert.strictEqual(res.status, 200);
    }
    const durationLb = Date.now() - tStartLb;
    const avgLbMs = durationLb / 20;
    assert.ok(avgLbMs < 200, `Average leaderboard response must be < 200ms (got ${avgLbMs.toFixed(2)}ms)`);
    pass(`6.1 Leaderboard query latency sanity passed (avg: ${avgLbMs.toFixed(2)}ms over 20 requests)`);

    // Benchmark 20 consecutive results requests
    const tStartRes = Date.now();
    for (let i = 0; i < 20; i++) {
      const res = await request('GET', `/api/contests/${contestA.id}/results`, null, tokenStudent1);
      assert.strictEqual(res.status, 200);
    }
    const durationRes = Date.now() - tStartRes;
    const avgResMs = durationRes / 20;
    assert.ok(avgResMs < 200, `Average results response must be < 200ms (got ${avgResMs.toFixed(2)}ms)`);
    pass(`6.2 Results query latency sanity passed (avg: ${avgResMs.toFixed(2)}ms over 20 requests)`);

  } catch (err) {
    fail('Test execution exception', err);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n================================================================');
  console.log(` Test Summary: ${testPassed} PASSED, ${testFailed} FAILED`);
  console.log('================================================================\n');

  if (testFailed > 0) {
    process.exit(1);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
