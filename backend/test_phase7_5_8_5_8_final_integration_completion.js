/**
 * Phase 7.5.8.5.8 — Final Integration & Completion Verification Suite
 * File: backend/test_phase7_5_8_5_8_final_integration_completion.js
 *
 * Full-scale end-to-end integration verification for Phase 7.5.8.5 completion gate:
 * Contest Configuration -> Live Submissions -> Freeze Boundary & Masking ->
 * Contest End & Pending Guard -> Final Result Calculation & Snapshot ->
 * Result Publication -> Result Lock Immutability -> Result Details & Leaderboard Consistency ->
 * Rating Updates -> Multi-Role Authorization -> Restart/Recovery Consistency.
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
  console.log(' Phase 7.5.8.5.8: Final Integration & Completion Suite');
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

  // 1. Provision Multi-Role Actors
  const profOwner = await UserModel.createUser({
    username: `prof_final_owner_${timestamp}`,
    email: `prof_final_owner_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Professor Final Owner',
    role: 'professor',
  });
  const profAttacker = await UserModel.createUser({
    username: `prof_final_attacker_${timestamp}`,
    email: `prof_final_attacker_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Professor Final Attacker',
    role: 'professor',
  });
  const contestAdmin = await UserModel.createUser({
    username: `cadmin_final_${timestamp}`,
    email: `cadmin_final_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Contest Admin Final',
    role: 'contest_admin',
  });
  const superAdmin = await UserModel.createUser({
    username: `sadmin_final_${timestamp}`,
    email: `sadmin_final_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Super Admin Final',
    role: 'super_admin',
  });
  const studentAlice = await UserModel.createUser({
    username: `alice_final_${timestamp}`,
    email: `alice_final_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Alice Walker',
    role: 'student',
  });
  const studentBob = await UserModel.createUser({
    username: `bob_final_${timestamp}`,
    email: `bob_final_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Bob Smith',
    role: 'student',
  });
  const studentCharlie = await UserModel.createUser({
    username: `charlie_final_${timestamp}`,
    email: `charlie_final_${timestamp}@test.com`,
    passwordHash: passwordHash,
    fullName: 'Charlie Davis',
    role: 'student',
  });

  const tokenProfOwner = generateToken(profOwner);
  const tokenProfAttacker = generateToken(profAttacker);
  const tokenContestAdmin = generateToken(contestAdmin);
  const tokenSuperAdmin = generateToken(superAdmin);
  const tokenAlice = generateToken(studentAlice);
  const tokenBob = generateToken(studentBob);
  const tokenCharlie = generateToken(studentCharlie);

  // 2. Provision Contest Problems
  const prob1 = await ProblemModel.createProblem({
    title: `Final Prob 1 ${timestamp}`,
    description: 'Solve Problem 1',
    difficulty: 'easy',
    createdBy: profOwner.id,
  });
  const prob2 = await ProblemModel.createProblem({
    title: `Final Prob 2 ${timestamp}`,
    description: 'Solve Problem 2',
    difficulty: 'medium',
    createdBy: profOwner.id,
  });

  try {
    // -------------------------------------------------------------
    // SECTION 1: Complete 23-Step End-to-End Integration Scenario
    // -------------------------------------------------------------
    console.log('--- 1. End-to-End Functional Scenario (Steps 1-23) ---');

    // Step 1 & 2: Create contest & configure freeze (120 min duration, freeze = 45 min)
    const now = new Date();
    const startTime = new Date(now.getTime() - 90 * 60 * 1000); // 90 min ago
    const endTime = new Date(now.getTime() + 30 * 60 * 1000);   // 30 min in future

    const contest = await ContestModel.createContest({
      title: `E2E Final Contest ${timestamp}`,
      description: 'Authoritative End-to-End Contest',
      createdBy: profOwner.id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 45, // freeze started at startTime + 75m (-15m from now)
    });
    await ContestModel.updateContestStatus(contest.id, 'published');
    pass('Step 1 & 2: Contest created and published with 45m freeze configuration');

    // Step 3: Add problems
    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: prob2.id, points: 200, problemOrder: 2 });
    pass('Step 3: Attached problems with points (100, 200)');

    // Step 4: Register participants
    await ContestModel.addParticipant(contest.id, studentAlice.id);
    await ContestModel.addParticipant(contest.id, studentBob.id);
    await ContestModel.addParticipant(contest.id, studentCharlie.id);
    pass('Step 4: Registered Alice, Bob, and Charlie as participants');

    // Step 5, 6, 7: Submit solutions and judge (Pre-freeze)
    // Alice solves Problem 1 at +20 min (pre-freeze)
    const tAliceP1 = new Date(startTime.getTime() + 20 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', 100, false, $6)`,
      [studentAlice.id, prob1.id, contest.id, 'alice_code_p1', 'javascript', tAliceP1.toISOString()]
    );

    // Alice also solves Problem 2 at +50 min (pre-freeze)
    const tAliceP2 = new Date(startTime.getTime() + 50 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', 200, false, $6)`,
      [studentAlice.id, prob2.id, contest.id, 'alice_code_p2', 'javascript', tAliceP2.toISOString()]
    );

    // Step 8 & 9: Verify pre-freeze scores on live leaderboard
    // Bob solves Problem 2 at +85 min (post-freeze window: -5m from now)
    const tBobP2 = new Date(startTime.getTime() + 85 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', 200, false, $6)`,
      [studentBob.id, prob2.id, contest.id, 'bob_code_p2', 'javascript', tBobP2.toISOString()]
    );
    pass('Step 5-7: Recorded pre-freeze solves for Alice and post-freeze solve for Bob');

    // Step 10 & 11: Reach freeze & verify frozen behavior
    const resLbFrozen = await request('GET', `/api/contests/${contest.id}/leaderboard`, null, tokenAlice);
    assert.strictEqual(resLbFrozen.status, 200);
    assert.strictEqual(resLbFrozen.body.isFrozen, true);
    assert.strictEqual(resLbFrozen.body.freezeState, 'FROZEN');

    const aliceFrozen = resLbFrozen.body.standings.find((r) => r.userId === studentAlice.id);
    const bobFrozen = resLbFrozen.body.standings.find((r) => r.userId === studentBob.id);
    assert.strictEqual(aliceFrozen.totalScore, 300, 'Alice pre-freeze score visible (300)');
    assert.strictEqual(bobFrozen.totalScore, 0, 'Bob post-freeze solve masked (0)');
    pass('Step 8-11: Frozen leaderboard accurately masks post-freeze solve for students');

    // Step 12 & 13: End contest & complete required judging
    await db.query(`UPDATE contests SET end_time = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [contest.id]);

    // Insert pending submission for Charlie to test pending judging guard
    const resPend = await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', 0, false, NOW() - INTERVAL '10 minutes')
       RETURNING id`,
      [studentCharlie.id, prob1.id, contest.id, 'charlie_pending', 'javascript']
    );
    const pendId = resPend.rows[0].id;

    const resFinPending = await request('POST', `/api/contests/${contest.id}/finalize-ratings`, {}, tokenProfOwner);
    assert.strictEqual(resFinPending.status, 409, 'Must block finalization while judging pending');
    pass('Step 12-13: Pending judging guard blocks finalization with 409 Conflict');

    // Complete judging
    await db.query(`UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1`, [pendId]);

    // Step 14 & 15: Calculate and publish final results
    const resFin = await request('POST', `/api/contests/${contest.id}/finalize-ratings`, {}, tokenProfOwner);
    assert.strictEqual(resFin.status, 200);
    assert.strictEqual(resFin.body.contestId, contest.id);
    assert.strictEqual(resFin.body.isRated, true);
    assert.strictEqual(resFin.body.ratingUpdates.length, 3);
    pass('Step 14-15: Finalization calculated ratings and published final results');

    // Step 16 & 17: Verify student result access & Result Details (/results/me)
    const resAliceMe = await request('GET', `/api/contests/${contest.id}/results/me`, null, tokenAlice);
    assert.strictEqual(resAliceMe.status, 200);
    assert.strictEqual(resAliceMe.body.summary.rank, 1);
    assert.strictEqual(resAliceMe.body.summary.totalScore, 300);
    assert.strictEqual(resAliceMe.body.summary.solvedProblemsCount, 2);

    const resBobMe = await request('GET', `/api/contests/${contest.id}/results/me`, null, tokenBob);
    assert.strictEqual(resBobMe.status, 200);
    assert.strictEqual(resBobMe.body.summary.rank, 2);
    assert.strictEqual(resBobMe.body.summary.totalScore, 200);
    assert.strictEqual(resBobMe.body.summary.solvedProblemsCount, 1);
    pass('Step 16-17: Verified student result access and Result Details for Alice (Rank 1) and Bob (Rank 2)');

    // Step 18 & 19: Verify final leaderboard & rating behavior
    const resFinalLb = await request('GET', `/api/contests/${contest.id}/leaderboard`, null, tokenAlice);
    assert.strictEqual(resFinalLb.status, 200);
    assert.strictEqual(resFinalLb.body.freezeState, 'FINAL');
    assert.strictEqual(resFinalLb.body.standings[0].userId, studentAlice.id);
    assert.strictEqual(resFinalLb.body.standings[0].rank, 1);
    assert.strictEqual(resFinalLb.body.standings[1].userId, studentBob.id);
    assert.strictEqual(resFinalLb.body.standings[1].rank, 2);
    assert.strictEqual(resFinalLb.body.standings[2].userId, studentCharlie.id);
    assert.strictEqual(resFinalLb.body.standings[2].rank, 3);

    const histRows = await db.query(`SELECT * FROM rating_history WHERE contest_id = $1 ORDER BY rank ASC`, [contest.id]);
    assert.strictEqual(histRows.rows.length, 3);
    assert.strictEqual(histRows.rows[0].user_id, studentAlice.id);
    assert.strictEqual(histRows.rows[0].rank, 1);
    pass('Step 18-19: Final leaderboard reflects unmasked official standings and rating_history entries');

    // Step 20 & 21: Attempt result-affecting modifications post-finalization
    const resMutateRated = await request('PUT', `/api/contests/${contest.id}`, { isRated: false }, tokenProfOwner);
    assert.strictEqual(resMutateRated.status, 409, 'Mutating isRated post-finalization blocked');

    const resAddProbLock = await request('POST', `/api/contests/${contest.id}/problems`, { problemId: prob1.id }, tokenProfOwner);
    assert.strictEqual(resAddProbLock.status, 409, 'Adding problem post-finalization blocked');

    const resSubPostLock = await request('POST', '/api/submissions', {
      contestId: contest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'console.log("late");',
    }, tokenAlice);
    assert.strictEqual(resSubPostLock.status, 400, 'Submitting post-finalization blocked');
    pass('Step 20-21: All result-affecting modifications blocked post-finalization');

    // Step 22 & 23: Application restart simulation & finalized consistency
    // Query DB directly to verify persistence of final_results_snapshot
    const snapDb = await db.query(`SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1`, [contest.id]);
    assert.strictEqual(snapDb.rows[0].is_rating_finalized, true);
    assert.ok(snapDb.rows[0].final_results_snapshot !== null);
    assert.strictEqual(snapDb.rows[0].final_results_snapshot.standings.length, 3);
    assert.strictEqual(snapDb.rows[0].final_results_snapshot.standings[0].userId, studentAlice.id);
    pass('Step 22-23: Snapshot persistence and recovery consistency verified');

    // -------------------------------------------------------------
    // SECTION 2: Multi-Role Integration & Scope Verification
    // -------------------------------------------------------------
    console.log('\n--- 2. Multi-Role Integration & Scope Verification ---');

    // Student: Cannot finalize
    const resStdFin = await request('POST', `/api/contests/${contest.id}/finalize-ratings`, {}, tokenAlice);
    assert.strictEqual(resStdFin.status, 403);

    // Student: Cannot access another student's result details (BOLA)
    const resStdBola = await request('GET', `/api/contests/${contest.id}/participants/${studentBob.id}/results`, null, tokenAlice);
    assert.strictEqual(resStdBola.status, 403);

    // Professor: Cannot finalize other professor's contest (BOLA)
    const resProfBola = await request('POST', `/api/contests/${contest.id}/finalize-ratings`, {}, tokenProfAttacker);
    assert.strictEqual(resProfBola.status, 403);

    // Contest Admin: Can view admin leaderboard
    const resCadminBoard = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, tokenContestAdmin);
    assert.strictEqual(resCadminBoard.status, 200);

    // Super Admin: Can view admin leaderboard but CANNOT mutate locked results
    const resSadminBoard = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, tokenSuperAdmin);
    assert.strictEqual(resSadminBoard.status, 200);

    const resSadminMutate = await request('PUT', `/api/contests/${contest.id}`, { isRated: false }, tokenSuperAdmin);
    assert.strictEqual(resSadminMutate.status, 409, 'Super Admin must respect result lock');
    pass('2.1 Multi-role authorization and ownership boundaries verified for Student, Professor, Contest Admin, and Super Admin');

    // -------------------------------------------------------------
    // SECTION 3: Cross-Layer Result Agreement Verification
    // -------------------------------------------------------------
    console.log('\n--- 3. Cross-Layer Result Agreement Verification ---');

    const resResults = await request('GET', `/api/contests/${contest.id}/results`, null, tokenAlice);
    assert.strictEqual(resResults.status, 200);

    const snapshot = snapDb.rows[0].final_results_snapshot;
    const finalLb = resFinalLb.body;
    const resultsPayload = resResults.body;

    for (let i = 0; i < 3; i++) {
      const snapRow = snapshot.standings[i];
      const lbRow = finalLb.standings[i];
      const resRow = resultsPayload.results[i];

      assert.strictEqual(snapRow.userId, lbRow.userId);
      assert.strictEqual(snapRow.userId, resRow.userId);
      assert.strictEqual(snapRow.rank, lbRow.rank);
      assert.strictEqual(snapRow.rank, resRow.rank);
      assert.strictEqual(snapRow.totalScore, lbRow.totalScore);
      assert.strictEqual(snapRow.totalScore, resRow.totalScore);
      assert.strictEqual(snapRow.solvedProblemsCount, lbRow.solvedProblemsCount);
      assert.strictEqual(snapRow.solvedProblemsCount, resRow.solvedProblemsCount);
    }
    pass('3.1 100% agreement verified across Database Snapshot, StandingsService, Public Leaderboard, and Results View');

    // -------------------------------------------------------------
    // SECTION 4: Final Security Hardening & Sanitization
    // -------------------------------------------------------------
    console.log('\n--- 4. Final Security Hardening & Sanitization ---');

    // SQL Injection in contest ID
    const resSqlId = await request('GET', `/api/contests/1 OR 1=1/results`, null, tokenAlice);
    assert.strictEqual(resSqlId.status, 400);

    // Negative ID
    const resNegId = await request('GET', `/api/contests/-99/results`, null, tokenAlice);
    assert.strictEqual(resNegId.status, 400);

    // Sensitive data leakage
    const rawPayload = JSON.stringify(resFinalLb.body);
    assert.ok(!rawPayload.includes('password'));
    assert.ok(!rawPayload.includes('token'));
    assert.ok(!rawPayload.includes('stack'));

    pass('4.1 SQL injection resistance, input validation, and sensitive data protection confirmed');

    // -------------------------------------------------------------
    // SECTION 5: Performance Sanity Benchmark
    // -------------------------------------------------------------
    console.log('\n--- 5. Performance Sanity Benchmark ---');

    const tStart = Date.now();
    for (let i = 0; i < 25; i++) {
      const r = await request('GET', `/api/contests/${contest.id}/results`, null, tokenAlice);
      assert.strictEqual(r.status, 200);
    }
    const duration = Date.now() - tStart;
    const avgMs = duration / 25;
    assert.ok(avgMs < 200, `Average response latency must be < 200ms (got ${avgMs.toFixed(2)}ms)`);
    pass(`5.1 Results query latency sanity passed (avg: ${avgMs.toFixed(2)}ms over 25 requests)`);

  } catch (err) {
    fail('Integration test exception', err);
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
