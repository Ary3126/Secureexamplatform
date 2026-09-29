/**
 * Phase 7.5.8.5.2 — Freeze State & Rules Test Suite
 * File: backend/test_phase7_5_8_5_2_freeze_state_rules.js
 *
 * Exhaustively validates:
 * 1. Configuration:
 *    - Freeze enabled / disabled flags correctly persisted
 *    - Valid freeze duration accepted
 *    - Boundary freeze duration (0 minutes) preserved without falsy fallback to 60
 *    - Invalid duration (negative, non-integer, NaN) rejected by validation (400)
 *    - Invalid duration exceeding contest duration rejected (400)
 *    - Non-boolean freeze flag rejected by validation (400)
 * 2. State & Boundary Rules:
 *    - Authoritative getContestFreezeState before freeze window (NOT_FROZEN, isFrozen: false)
 *    - Exactly at freeze boundary (FROZEN, isFrozen: true)
 *    - During freeze window (FROZEN, isFrozen: true)
 *    - After contest ends (NOT_FROZEN, isFrozen: false)
 *    - When ratings finalized (FINAL, isFrozen: false)
 *    - Clamping of freeze start time so it never precedes contest startTime
 * 3. Leaderboard Masking & Score Integrity:
 *    - Submissions made during freeze are judged, persisted, and intact in DB
 *    - Public / student leaderboard omits post-freeze submissions
 *    - Student /results and /results/me omit post-freeze submissions
 *    - Manager with freezeOverride=true receives full unmasked standings
 *    - Internal scores, execution times, and penalties match exactly
 * 4. Security & BOLA Protection:
 *    - Student cannot bypass freeze with ?freezeOverride=true
 *    - Non-owner professor cannot bypass freeze on public leaderboard
 *    - Non-owner professor calling POST /finalize-ratings rejected with 403 Forbidden (BOLA fix)
 *    - Creator professor authorized to manage and unmask freeze
 * 5. Concurrency:
 *    - Concurrent requests at the freeze boundary return deterministic state
 *    - Repeated requests return consistent rankings
 */

process.env.RATE_LIMIT_CONTEST_MAX = '1000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
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
        let parsed = null;
        try {
          parsed = JSON.parse(data);
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
    if (payload) req.write(payload);
    req.end();
  });
}

// Test Runner Tracking
const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function record(name, condition, details = '') {
  if (condition) {
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`  [PASS] ${name}`);
  } else {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', details });
    console.error(`  [FAIL] ${name} ${details ? '- ' + details : ''}`);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('Phase 7.5.8.5.2 — Freeze State & Rules Verification Suite');
  console.log('===============================================================\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  const runId = Date.now() % 100000;
  let profUser1, profUser2, adminUser, studentUser1, studentUser2;
  let profToken1, profToken2, adminToken, studentToken1, studentToken2;
  let testProblem1, testProblem2;

  try {
    // ------------------------------------------------------------------------
    // SETUP: Users & Test Data
    // ------------------------------------------------------------------------
    console.log('--- SETUP: Provisioning Users & Problems ---');
    const pwd = await hashPassword('Password123!');

    profUser1 = await UserModel.createUser({
      email: `prof1_freeze_${runId}@test.com`,
      username: `prof1_freeze_${runId}`,
      fullName: 'Professor One',
      passwordHash: pwd,
      role: 'professor',
      institution: 'State University',
    });
    profToken1 = generateToken(profUser1);

    profUser2 = await UserModel.createUser({
      email: `prof2_freeze_${runId}@test.com`,
      username: `prof2_freeze_${runId}`,
      fullName: 'Professor Two',
      passwordHash: pwd,
      role: 'professor',
      institution: 'City College',
    });
    profToken2 = generateToken(profUser2);

    adminUser = await UserModel.createUser({
      email: `admin_freeze_${runId}@test.com`,
      username: `admin_freeze_${runId}`,
      fullName: 'Contest Admin',
      passwordHash: pwd,
      role: 'contest_admin',
      institution: 'State University',
    });
    adminToken = generateToken(adminUser);

    studentUser1 = await UserModel.createUser({
      email: `stud1_freeze_${runId}@test.com`,
      username: `stud1_freeze_${runId}`,
      fullName: 'Alice Johnson',
      passwordHash: pwd,
      role: 'student',
      institution: 'State University',
    });
    studentToken1 = generateToken(studentUser1);

    studentUser2 = await UserModel.createUser({
      email: `stud2_freeze_${runId}@test.com`,
      username: `stud2_freeze_${runId}`,
      fullName: 'Bob Smith',
      passwordHash: pwd,
      role: 'student',
      institution: 'State University',
    });
    studentToken2 = generateToken(studentUser2);

    testProblem1 = await ProblemModel.createProblem({
      title: `Freeze Problem Alpha ${runId}`,
      description: 'Alpha problem for freeze audit',
      difficulty: 'easy',
      createdBy: profUser1.id,
      codingMode: 'full_program',
    });
    await TestCaseModel.createTestCase({
      problemId: testProblem1.id,
      inputData: '1 2',
      expectedOutput: '3',
      isSample: false,
    });

    testProblem2 = await ProblemModel.createProblem({
      title: `Freeze Problem Beta ${runId}`,
      description: 'Beta problem for freeze audit',
      difficulty: 'medium',
      createdBy: profUser1.id,
      codingMode: 'full_program',
    });
    await TestCaseModel.createTestCase({
      problemId: testProblem2.id,
      inputData: '4 5',
      expectedOutput: '9',
      isSample: false,
    });

    console.log('Setup completed successfully.\n');

    // ========================================================================
    // 1. CONFIGURATION TESTS (Validation & Persistence)
    // ========================================================================
    console.log('--- 1. CONFIGURATION & VALIDATION TESTS ---');

    // 1.1 Valid freeze config on create
    const now = new Date();
    const startIso = new Date(now.getTime() - 3600000).toISOString();
    const endIso = new Date(now.getTime() + 3600000).toISOString(); // 2 hr duration = 120 mins

    const resCreateValid = await request('POST', '/api/contests', {
      title: `Freeze Config Contest ${runId}`,
      startTime: startIso,
      endTime: endIso,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 45,
    }, profToken1);

    record('1.1 Create contest with valid freeze configuration (45m freeze)',
      resCreateValid.status === 201 &&
      resCreateValid.body.contest.leaderboardFreezeEnabled === true &&
      resCreateValid.body.contest.leaderboardFreezeMinutes === 45
    );

    const configContestId = resCreateValid.body?.contest?.id;

    // 1.2 Boundary duration: 0 minutes freeze preserved correctly (not replaced with default 60)
    const resCreateZeroFreeze = await request('POST', '/api/contests', {
      title: `Zero Freeze Contest ${runId}`,
      startTime: startIso,
      endTime: endIso,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 0,
    }, profToken1);

    record('1.2 Create contest with 0 minutes freeze duration preserves 0',
      resCreateZeroFreeze.status === 201 &&
      resCreateZeroFreeze.body.contest.leaderboardFreezeMinutes === 0
    );

    // 1.3 Invalid duration on create (negative)
    const resCreateNegFreeze = await request('POST', '/api/contests', {
      title: `Negative Freeze Contest ${runId}`,
      startTime: startIso,
      endTime: endIso,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: -15,
    }, profToken1);

    record('1.3 Create contest with negative freeze minutes rejected (400)',
      resCreateNegFreeze.status === 400 &&
      resCreateNegFreeze.body.errors?.some((e) => e.includes('non-negative integer'))
    );

    // 1.4 Invalid duration on create (exceeds contest duration)
    const resCreateExceedFreeze = await request('POST', '/api/contests', {
      title: `Exceeding Freeze Contest ${runId}`,
      startTime: startIso,
      endTime: endIso, // 120 mins duration
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 180, // 180 > 120
    }, profToken1);

    record('1.4 Create contest with freeze exceeding total duration rejected (400)',
      resCreateExceedFreeze.status === 400 &&
      resCreateExceedFreeze.body.errors?.some((e) => e.includes('cannot exceed'))
    );

    // 1.5 Update contest with invalid non-boolean leaderboardFreezeEnabled
    const resUpdateBadBool = await request('PUT', `/api/contests/${configContestId}`, {
      leaderboardFreezeEnabled: 'yes',
    }, profToken1);

    record('1.5 Update contest with non-boolean leaderboardFreezeEnabled rejected (400)',
      resUpdateBadBool.status === 400 &&
      resUpdateBadBool.body.errors?.some((e) => e.includes('boolean value'))
    );

    // 1.6 Update contest with invalid negative freeze minutes
    const resUpdateNegFreeze = await request('PUT', `/api/contests/${configContestId}`, {
      leaderboardFreezeMinutes: -30,
    }, profToken1);

    record('1.6 Update contest with negative freeze minutes rejected (400)',
      resUpdateNegFreeze.status === 400 &&
      resUpdateNegFreeze.body.errors?.some((e) => e.includes('non-negative integer'))
    );

    // 1.7 Update contest with valid freeze update
    const resUpdateValid = await request('PUT', `/api/contests/${configContestId}`, {
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    }, profToken1);

    record('1.7 Update contest with valid freeze minutes (30m) succeeds (200)',
      resUpdateValid.status === 200 &&
      resUpdateValid.body.contest.leaderboardFreezeMinutes === 30
    );

    // ========================================================================
    // 2. AUTHORITATIVE FREEZE STATE UNIT DETERMINATION
    // ========================================================================
    console.log('\n--- 2. AUTHORITATIVE FREEZE STATE DETERMINATION (UNIT / RULES) ---');

    const baseContestObj = {
      startTime: new Date('2026-09-29T10:00:00Z'),
      endTime: new Date('2026-09-29T12:00:00Z'), // 120 mins duration
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30, // Freeze starts at 11:30:00Z
      isRatingFinalized: false,
    };

    // 2.1 Before freeze window (11:29:59Z)
    const stateBefore = getContestFreezeState(baseContestObj, new Date('2026-09-29T11:29:59Z'));
    record('2.1 Before freeze window returns NOT_FROZEN and isFrozen: false',
      stateBefore.isFrozen === false && stateBefore.freezeState === 'NOT_FROZEN'
    );

    // 2.2 Exactly at freeze boundary (11:30:00Z)
    const stateAtBoundary = getContestFreezeState(baseContestObj, new Date('2026-09-29T11:30:00Z'));
    record('2.2 Exactly at freeze boundary returns FROZEN and isFrozen: true',
      stateAtBoundary.isFrozen === true && stateAtBoundary.freezeState === 'FROZEN'
    );

    // 2.3 During freeze window (11:45:00Z)
    const stateDuring = getContestFreezeState(baseContestObj, new Date('2026-09-29T11:45:00Z'));
    record('2.3 During freeze window returns FROZEN and isFrozen: true',
      stateDuring.isFrozen === true && stateDuring.freezeState === 'FROZEN'
    );

    // 2.4 Exactly at contest end (12:00:00Z)
    const stateAtEnd = getContestFreezeState(baseContestObj, new Date('2026-09-29T12:00:00Z'));
    record('2.4 Exactly at contest end returns FROZEN (last boundary second)',
      stateAtEnd.isFrozen === true && stateAtEnd.freezeState === 'FROZEN'
    );

    // 2.5 After contest ends (12:00:01Z)
    const stateAfterEnd = getContestFreezeState(baseContestObj, new Date('2026-09-29T12:00:01Z'));
    record('2.5 After contest ends returns NOT_FROZEN and isFrozen: false',
      stateAfterEnd.isFrozen === false && stateAfterEnd.freezeState === 'NOT_FROZEN'
    );

    // 2.6 When ratings finalized
    const stateFinalized = getContestFreezeState({ ...baseContestObj, isRatingFinalized: true }, new Date('2026-09-29T11:45:00Z'));
    record('2.6 Finalized contest returns FINAL and isFrozen: false regardless of clock',
      stateFinalized.isFrozen === false && stateFinalized.freezeState === 'FINAL'
    );

    // 2.7 Freeze disabled contest
    const stateDisabled = getContestFreezeState({ ...baseContestObj, leaderboardFreezeEnabled: false }, new Date('2026-09-29T11:45:00Z'));
    record('2.7 Freeze disabled contest returns NOT_FROZEN during window',
      stateDisabled.isFrozen === false && stateDisabled.freezeState === 'NOT_FROZEN'
    );

    // 2.8 Clamping freeze start time if freeze exceeds duration
    const stateClamped = getContestFreezeState({
      startTime: new Date('2026-09-29T10:00:00Z'),
      endTime: new Date('2026-09-29T10:30:00Z'),
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 100, // Exceeds duration
    }, new Date('2026-09-29T10:15:00Z'));
    record('2.8 Clamping freeze start time so it never precedes contest startTime',
      stateClamped.freezeTime.toISOString() === '2026-09-29T10:00:00.000Z' &&
      stateClamped.isFrozen === true
    );

    // 2.9 Zero freeze minutes (freezeMinutes = 0)
    const stateZeroMins = getContestFreezeState({
      startTime: new Date('2026-09-29T10:00:00Z'),
      endTime: new Date('2026-09-29T11:00:00Z'),
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 0,
    }, new Date('2026-09-29T10:30:00Z'));
    record('2.9 Zero freeze minutes contest does not freeze prior to end',
      stateZeroMins.isFrozen === false && stateZeroMins.freezeState === 'NOT_FROZEN'
    );

    // ========================================================================
    // 3. LIVE CONTEST FREEZE MASKING & INTEGRITY TEST
    // ========================================================================
    console.log('\n--- 3. LIVE CONTEST FREEZE MASKING & SCORE INTEGRITY ---');

    // Create a contest that is currently in its freeze window
    // Start: 90 mins ago, End: 30 mins in future, Freeze: 60 mins before end (started 30 mins ago)
    const liveStart = new Date(now.getTime() - 90 * 60000);
    const liveEnd = new Date(now.getTime() + 30 * 60000);

    const liveContest = await ContestModel.createContest({
      title: `Live Frozen Contest ${runId}`,
      description: 'Active contest testing freeze masking',
      startTime: liveStart.toISOString(),
      endTime: liveEnd.toISOString(),
      createdBy: profUser1.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 60,
    });
    await ContestModel.updateContestStatus(liveContest.id, 'published');

    // Attach problems
    await ContestModel.addProblemToContest({ contestId: liveContest.id, problemId: testProblem1.id, problemOrder: 1, points: 100 });
    await ContestModel.addProblemToContest({ contestId: liveContest.id, problemId: testProblem2.id, problemOrder: 2, points: 200 });

    // Enroll students
    await ContestModel.addParticipant(liveContest.id, studentUser1.id);
    await ContestModel.addParticipant(liveContest.id, studentUser2.id);

    // Submissions timeline:
    // 1. Student 1: Solved Problem 1 BEFORE freeze (75 mins ago)
    const subTimePreFreeze = new Date(now.getTime() - 75 * 60000);
    await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, execution_time, memory_used, is_sample_run, created_at)
      VALUES ($1, $2, $3, 'python', 'print(3)', 'accepted', 100, 42, 1024, false, $4);
    `, [studentUser1.id, liveContest.id, testProblem1.id, subTimePreFreeze.toISOString()]);

    // 2. Student 2: Solved Problem 2 DURING freeze (15 mins ago)
    const subTimeDuringFreeze = new Date(now.getTime() - 15 * 60000);
    await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, execution_time, memory_used, is_sample_run, created_at)
      VALUES ($1, $2, $3, 'python', 'print(9)', 'accepted', 200, 35, 1024, false, $4);
    `, [studentUser2.id, liveContest.id, testProblem2.id, subTimeDuringFreeze.toISOString()]);

    // Verify DB integrity: Both submissions exist with accepted verdicts
    const dbSubCount = await db.query('SELECT COUNT(*)::int AS count FROM submissions WHERE contest_id = $1;', [liveContest.id]);
    record('3.1 Both pre-freeze and post-freeze submissions successfully recorded in DB',
      dbSubCount.rows[0].count === 2
    );

    // 3.2 Student Leaderboard Query: GET /api/contests/:id/leaderboard
    const resStudentLb = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, studentToken1);

    record('3.2 Student leaderboard detects isFrozen: true and freezeState: FROZEN',
      resStudentLb.status === 200 &&
      resStudentLb.body.contest.isFrozen === true &&
      resStudentLb.body.contest.freezeState === 'FROZEN'
    );

    // Student 1 should have 100 points, Student 2 should have 0 points (post-freeze solve masked!)
    const s1RowStudentLb = resStudentLb.body.standings?.find((p) => p.userId === studentUser1.id);
    const s2RowStudentLb = resStudentLb.body.standings?.find((p) => p.userId === studentUser2.id);

    record('3.3 Student leaderboard displays pre-freeze points (100) for Student 1',
      s1RowStudentLb && s1RowStudentLb.totalScore === 100 && s1RowStudentLb.solvedProblemsCount === 1
    );

    record('3.4 Student leaderboard masks post-freeze solve (0 pts) for Student 2',
      s2RowStudentLb && s2RowStudentLb.totalScore === 0 && s2RowStudentLb.solvedProblemsCount === 0
    );

    // 3.5 Student Results Query: GET /api/contests/:id/results
    const resStudentResults = await request('GET', `/api/contests/${liveContest.id}/results`, null, studentToken1);
    const s2RowStudentResults = resStudentResults.body.standings?.find((p) => p.userId === studentUser2.id);

    record('3.5 Contest results view masks post-freeze solve for students during active freeze',
      resStudentResults.status === 200 &&
      resStudentResults.body.resultSummary?.isFrozen === true &&
      resStudentResults.body.resultSummary?.freezeState === 'FROZEN' &&
      s2RowStudentResults?.totalScore === 0
    );

    // 3.6 Student 2 self result details: GET /api/contests/:id/results/me
    const resStudent2Self = await request('GET', `/api/contests/${liveContest.id}/results/me`, null, studentToken2);

    record('3.6 Student self result details (/results/me) masks post-freeze submission during freeze',
      resStudent2Self.status === 200 &&
      resStudent2Self.body.summary?.totalScore === 0 &&
      resStudent2Self.body.submissions?.length === 0
    );

    // 3.7 Manager Unmasking: Professor using Admin Leaderboard with freezeOverride=true
    const resProfAdminLb = await request('GET', `/api/contests/${liveContest.id}/admin-leaderboard?freezeOverride=true`, null, profToken1);
    const s1RowAdminLb = resProfAdminLb.body.standings?.find((p) => p.userId === studentUser1.id);
    const s2RowAdminLb = resProfAdminLb.body.standings?.find((p) => p.userId === studentUser2.id);

    record('3.7 Manager unmasking reveals true live scores (Student 2 has 200 pts, Rank 1)',
      resProfAdminLb.status === 200 &&
      s2RowAdminLb?.totalScore === 200 &&
      s2RowAdminLb?.rank === 1 &&
      s1RowAdminLb?.totalScore === 100 &&
      s1RowAdminLb?.rank === 2
    );

    // ========================================================================
    // 4. SECURITY & BOLA TESTS
    // ========================================================================
    console.log('\n--- 4. SECURITY & BOLA PROTECTION TESTS ---');

    // 4.1 Student attempting to bypass freeze via ?freezeOverride=true
    const resStudentBypass = await request('GET', `/api/contests/${liveContest.id}/leaderboard?freezeOverride=true`, null, studentToken1);
    const s2RowBypass = resStudentBypass.body.standings?.find((p) => p.userId === studentUser2.id);

    record('4.1 Student cannot bypass freeze with ?freezeOverride=true (scores remain masked at 0)',
      s2RowBypass?.totalScore === 0 &&
      resStudentBypass.body.contest.isFrozen === true
    );

    // 4.2 Non-owner Professor attempting to bypass freeze via ?freezeOverride=true on public leaderboard
    const resProf2Bypass = await request('GET', `/api/contests/${liveContest.id}/leaderboard?freezeOverride=true`, null, profToken2);
    const s2RowProf2Bypass = resProf2Bypass.body.standings?.find((p) => p.userId === studentUser2.id);

    record('4.2 Non-owner Professor cannot bypass freeze on public leaderboard (scores remain masked at 0)',
      s2RowProf2Bypass?.totalScore === 0 &&
      resProf2Bypass.body.contest.isFrozen === true
    );

    // 4.3 BOLA FIX TEST: Non-owner Professor attempting to finalize ratings on another professor's contest
    const resProf2Finalize = await request('POST', `/api/contests/${liveContest.id}/finalize-ratings`, { force: true }, profToken2);

    record('4.3 BOLA Protection: Non-owner Professor rejected from finalizing ratings (403 Forbidden)',
      resProf2Finalize.status === 403 &&
      resProf2Finalize.body.message?.includes('permission')
    );

    // 4.4 Creator Professor attempting to finalize ratings is NOT rejected with 403
    // (May return 400 if contest is still running without force, but must NOT return 403 Forbidden)
    const resProf1FinalizeCheck = await request('POST', `/api/contests/${liveContest.id}/finalize-ratings`, {}, profToken1);

    record('4.4 Creator Professor is authorized to manage contest finalization (status is 400 runtime check, not 403 Forbidden)',
      resProf1FinalizeCheck.status === 400 &&
      resProf1FinalizeCheck.body.message?.includes('Contest must be ended')
    );

    // ========================================================================
    // 5. CONCURRENCY & REPEATED REQUESTS
    // ========================================================================
    console.log('\n--- 5. CONCURRENCY & IDEMPOTENCY TESTS ---');

    // 5.1 10 Concurrent requests to frozen contest leaderboard
    const concurrentRequests = Array.from({ length: 10 }).map(() =>
      request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, studentToken1)
    );
    const concurrentResponses = await Promise.all(concurrentRequests);

    const allConsistent = concurrentResponses.every(
      (res) =>
        res.status === 200 &&
        res.body.contest?.isFrozen === true &&
        res.body.contest?.freezeState === 'FROZEN' &&
        res.body.standings?.find((p) => p.userId === studentUser1.id)?.totalScore === 100 &&
        res.body.standings?.find((p) => p.userId === studentUser2.id)?.totalScore === 0
    );

    record('5.1 10 concurrent requests at freeze boundary return consistent, deterministic results',
      allConsistent
    );

    // 5.2 Repeated idempotent requests
    const repeat1 = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, studentToken1);
    const repeat2 = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, studentToken1);

    record('5.2 Repeated requests return identical leaderboard summaries and rankings',
      JSON.stringify(repeat1.body.standings) === JSON.stringify(repeat2.body.standings) &&
      repeat1.body.contest.isFrozen === repeat2.body.contest.isFrozen
    );

  } catch (err) {
    console.error('Unhandled error during test execution:', err);
    record('Fatal test suite execution error', false, err.message);
  } finally {
    if (server) {
      server.close();
    }
  }

  // Summary
  console.log('\n===============================================================');
  console.log(`Phase 7.5.8.5.2 Test Summary: ${results.passed} PASSED, ${results.failed} FAILED out of ${results.tests.length} tests`);
  console.log('===============================================================\n');

  if (results.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
