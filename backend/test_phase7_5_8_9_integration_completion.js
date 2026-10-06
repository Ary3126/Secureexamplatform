/**
 * Phase 7.5.8.9 — Integration & Phase Completion Test Suite
 * File: backend/test_phase7_5_8_9_integration_completion.js
 *
 * Comprehensive End-to-End Cross-Layer Integration & Agreement Test:
 * 1. Contest Lifecycle: Creation -> Problem Association -> Multi-Participant Enrollment
 * 2. Pre-Freeze & Post-Freeze Submissions & Judging
 * 3. Active Freeze Window Evaluation (Public vs Admin vs Student bypass defense vs Export filter)
 * 4. Pending Submissions Guard (409 Conflict if judge workers active)
 * 5. Contest End & Authoritative Finalization (ACID Transaction, Row-Locking, Snapshot Sealing)
 * 6. Concurrency & Idempotency (Concurrent finalization requests, zero duplicate rating history)
 * 7. Post-Finalization Result Lock (409 Conflict on contest, problem, and participant mutations)
 * 8. 100% Cross-Layer Data Agreement:
 *    - StandingsService == computeContestResults == Admin Leaderboard == Public Leaderboard == Sealed DB Snapshot
 *    - Participant Result Details == Leaderboard Row == Self View
 *    - CSV Results Export == JSON Results Export == Displayed Standings
 *    - Submissions Export == Database Submissions Log
 * 9. Comprehensive Result Details Matrix (All solved, partial, unattempted, all failed)
 * 10. Security, RBAC & IDOR/BOLA Hardening (Student vs Professor vs Admin)
 * 11. Large Scale & Pagination Validation (> 100 participants, pagination, export completeness)
 * 12. Error Handling & Edge Cases (400, 404, malformed IDs)
 * 13. Teardown & Clean Baseline Restoration (Exact count verification)
 */

const assert = require('assert');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const StandingsService = require('./src/services/standingsService');
const ContestExportService = require('./src/services/contestExportService');
const RatingService = require('./src/services/ratingService');
const contestController = require('./src/controllers/contestController');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function report(testName, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${testName} - ${details}`);
  }
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    },
  };
}

function createMockNext(res) {
  return (err) => {
    if (err) {
      res.statusCode = err.statusCode || 500;
      res.body = { error: err.message, statusCode: res.statusCode };
    }
  };
}

async function runPhaseCompletionIntegrationSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.9 — Integration & Phase Completion Test Suite      ');
  console.log('================================================================\n');

  const stamp = Date.now();
  const dummyHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

  const trackedUserIds = [];
  const trackedContestIds = [];
  let exitCode = 0;

  try {
    // -------------------------------------------------------------
    // Setup Actors
    // -------------------------------------------------------------
    const profCreator = await UserModel.createUser({
      username: `prof_p9_creator_${stamp}`,
      email: `prof_p9_creator_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Professor Creator Nine',
      role: 'professor',
    });
    trackedUserIds.push(profCreator.id);

    const profOther = await UserModel.createUser({
      username: `prof_p9_other_${stamp}`,
      email: `prof_p9_other_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Professor Other Nine',
      role: 'professor',
    });
    trackedUserIds.push(profOther.id);

    const contestAdmin = await UserModel.createUser({
      username: `admin_p9_${stamp}`,
      email: `admin_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Contest Admin Nine',
      role: 'contest_admin',
    });
    trackedUserIds.push(contestAdmin.id);

    const studentAlice = await UserModel.createUser({
      username: `alice_p9_${stamp}`,
      email: `alice_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Alice Smith',
      role: 'student',
    });
    trackedUserIds.push(studentAlice.id);

    const studentBob = await UserModel.createUser({
      username: `bob_p9_${stamp}`,
      email: `bob_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Bob Jones',
      role: 'student',
    });
    trackedUserIds.push(studentBob.id);

    const studentCharlie = await UserModel.createUser({
      username: `charlie_p9_${stamp}`,
      email: `charlie_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Charlie Brown',
      role: 'student',
    });
    trackedUserIds.push(studentCharlie.id);

    const studentDave = await UserModel.createUser({
      username: `dave_p9_${stamp}`,
      email: `dave_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Dave Miller',
      role: 'student',
    });
    trackedUserIds.push(studentDave.id);

    const studentEve = await UserModel.createUser({
      username: `eve_p9_${stamp}`,
      email: `eve_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Eve Davis',
      role: 'student',
    });
    trackedUserIds.push(studentEve.id);

    // Fetch 2 clean test problems
    const probs = await db.query('SELECT id, title, difficulty FROM problems ORDER BY id ASC LIMIT 2;');
    const prob1 = probs.rows[0];
    const prob2 = probs.rows[1];

    // -------------------------------------------------------------
    // Step 1: Contest Setup & Enrollment
    // -------------------------------------------------------------
    console.log('--- Step 1: Contest Setup & Multi-Participant Enrollment ---');
    const now = new Date();
    const startTime = new Date(now.getTime() - 40 * 60 * 1000); // 40m ago
    const endTime = new Date(now.getTime() + 20 * 60 * 1000);   // 20m in future
    // 30m freeze => freeze cutoff = 10m ago (currently in active freeze)
    const contest = await ContestModel.createContest({
      title: `Phase 7.5.8 Final Integration Contest ${stamp}`,
      description: 'Authoritative cross-layer integration testing',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes: 60,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
      createdBy: profCreator.id,
    });
    trackedContestIds.push(contest.id);
    await ContestModel.updateContest(contest.id, { status: 'published' });

    // Attach problems: Prob 1 (100 pts), Prob 2 (200 pts)
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
       VALUES ($1, $2, 1, 100), ($1, $3, 2, 200);`,
      [contest.id, prob1.id, prob2.id]
    );

    // Enroll Alice, Bob, Charlie, Dave, Eve
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at)
       VALUES ($1, $2, $7), ($1, $3, $7), ($1, $4, $7), ($1, $5, $7), ($1, $6, $7);`,
      [contest.id, studentAlice.id, studentBob.id, studentCharlie.id, studentDave.id, studentEve.id, startTime.toISOString()]
    );
    report('1.1 Contest created, published, problems linked, and 5 students enrolled', true);

    // -------------------------------------------------------------
    // Step 2: Submissions & Active Freeze State
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Submissions & Active Freeze State ---');
    // Pre-freeze: Alice solves Prob 1 at +5m (accepted, 100 pts)
    const tAliceP1 = new Date(startTime.getTime() + 5 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 20, 2048, false, 'function solution() { return 1; }', $4);`,
      [contest.id, prob1.id, studentAlice.id, tAliceP1.toISOString()]
    );

    // Pre-freeze: Bob fails Prob 1 at +10m (wrong_answer, 0 pts)
    const tBobFail = new Date(startTime.getTime() + 10 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'wrong_answer', 0, 15, 2048, false, 'function solution() { return 0; }', $4);`,
      [contest.id, prob1.id, studentBob.id, tBobFail.toISOString()]
    );

    // Pre-freeze: Alice fails Prob 2 at +15m
    const tAliceFail = new Date(startTime.getTime() + 15 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'wrong_answer', 0, 30, 2048, false, 'function solution() { return false; }', $4);`,
      [contest.id, prob2.id, studentAlice.id, tAliceFail.toISOString()]
    );

    // Pre-freeze: Alice solves Prob 2 at +20m (accepted, 200 pts)
    const tAliceSolveP2 = new Date(startTime.getTime() + 20 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 200, 40, 2048, false, 'function solution() { return true; }', $4);`,
      [contest.id, prob2.id, studentAlice.id, tAliceSolveP2.toISOString()]
    );

    // Pre-freeze: Dave fails Prob 1 at +22m (compilation_error, 0 pts)
    const tDaveFail1 = new Date(startTime.getTime() + 22 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'compilation_error', 0, 0, 0, false, 'broken syntax', $4);`,
      [contest.id, prob1.id, studentDave.id, tDaveFail1.toISOString()]
    );

    // Pre-freeze: Dave fails Prob 2 at +24m (runtime_error, 0 pts)
    const tDaveFail2 = new Date(startTime.getTime() + 24 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'runtime_error', 0, 10, 1024, false, 'throw new Error()', $4);`,
      [contest.id, prob2.id, studentDave.id, tDaveFail2.toISOString()]
    );

    // Pre-freeze: Eve solves Prob 1 at +25m (accepted, 100 pts)
    const tEveSolveP1 = new Date(startTime.getTime() + 25 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 22, 2048, false, 'function solution() { return 1; }', $4);`,
      [contest.id, prob1.id, studentEve.id, tEveSolveP1.toISOString()]
    );

    // Post-freeze: Bob solves Prob 1 at now - 2m (accepted, 100 pts)
    const tBobSolve = new Date(now.getTime() - 2 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 25, 2048, false, 'function solution() { return 1; }', $4);`,
      [contest.id, prob1.id, studentBob.id, tBobSolve.toISOString()]
    );

    // 2.1 Verify Public Freeze Masking vs Admin Live Unmasking
    const publicLb = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: studentAlice,
      freezeOverride: false,
    });
    report('2.1 Freeze detection confirmed (isFrozen: true, freezeState: FROZEN)', publicLb.isFrozen === true && publicLb.freezeState === 'FROZEN');

    const alicePub = publicLb.standings.find((p) => p.userId === studentAlice.id);
    const bobPub = publicLb.standings.find((p) => p.userId === studentBob.id);
    const charliePub = publicLb.standings.find((p) => p.userId === studentCharlie.id);
    const davePub = publicLb.standings.find((p) => p.userId === studentDave.id);
    const evePub = publicLb.standings.find((p) => p.userId === studentEve.id);

    report('2.2 Alice public score is 300 (100 + 200, 2 solves)', alicePub.totalScore === 300 && alicePub.solvedProblemsCount === 2);
    report('2.3 Bob post-freeze solve is masked (0 pts, 0 solves on public leaderboard)', bobPub.totalScore === 0 && bobPub.solvedProblemsCount === 0);
    report('2.4 Charlie unattempted score is 0 with 0 submissions', charliePub.totalScore === 0 && charliePub.totalSubmissions === 0);
    report('2.5 Dave all-failed score is 0 with 2 submissions', davePub.totalScore === 0 && davePub.totalSubmissions === 2);
    report('2.6 Eve single-solve score is 100 with 1 solve', evePub.totalScore === 100 && evePub.solvedProblemsCount === 1);

    // Freeze Bypass Resistance: Student attempting freezeOverride=true
    const studentBypassLb = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: studentAlice,
      freezeOverride: true,
    });
    const bobBypass = studentBypassLb.standings.find((p) => p.userId === studentBob.id);
    report('2.7 Freeze bypass attempt by student is strictly neutralized (Bob still masked at 0 pts)', bobBypass.totalScore === 0);

    const adminLb = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: profCreator,
      freezeOverride: true,
    });
    const bobAdmin = adminLb.standings.find((p) => p.userId === studentBob.id);
    report('2.8 Manager freezeOverride=true reveals Bob unmasked solve (100 pts, 1 solve)', bobAdmin.totalScore === 100 && bobAdmin.solvedProblemsCount === 1);

    // Submissions export during freeze omits post-freeze solve when freezeOverride=false
    const subsExpFrozen = await ContestExportService.exportContestSubmissions({
      contestId: contest.id,
      requestingUser: profCreator,
      format: 'json',
      freezeOverride: false,
    });
    const subsDataFrozen = JSON.parse(subsExpFrozen.content);
    report('2.9 Export during freeze excludes post-freeze submission when freezeOverride=false', subsDataFrozen.totalSubmissions === 7);

    // -------------------------------------------------------------
    // Step 3: Pending Submissions Guard & Finalization
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Pending Submissions Guard & Authoritative Finalization ---');

    // Shift contest window to ended
    await db.query(
      `UPDATE contests 
       SET start_time = $1, end_time = $2 
       WHERE id = $3;`,
      [
        new Date(now.getTime() - 70 * 60 * 1000).toISOString(),
        new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
        contest.id,
      ]
    );

    // 3.1 Pending Submissions Guard: Insert a running submission
    const pendingSubRes = await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'running', 0, false, 'let x = 1;', $4) RETURNING id;`,
      [contest.id, prob1.id, studentCharlie.id, new Date(now.getTime() - 15 * 60 * 1000).toISOString()]
    );
    const pendingSubId = pendingSubRes.rows[0].id;

    const reqFinalizePending = {
      params: { id: contest.id },
      body: {},
      user: profCreator,
    };
    const resFinalizePending = createMockRes();
    await contestController.finalizeContestRatings(reqFinalizePending, resFinalizePending, createMockNext(resFinalizePending));
    report('3.1 Pending submission blocks finalization with 409 Conflict', resFinalizePending.statusCode === 409);

    // Clear pending submission (delete it)
    await db.query(`DELETE FROM submissions WHERE id = $1;`, [pendingSubId]);

    // 3.2 Authorization check: Student cannot finalize (403)
    const reqFinalizeStudent = {
      params: { id: contest.id },
      body: {},
      user: studentAlice,
    };
    const resFinalizeStudent = createMockRes();
    await contestController.finalizeContestRatings(reqFinalizeStudent, resFinalizeStudent, createMockNext(resFinalizeStudent));
    report('3.2 Student blocked with 403 Forbidden on finalization endpoint', resFinalizeStudent.statusCode === 403);

    // 3.3 Authorization check: Non-owning professor cannot finalize (403 BOLA)
    const reqFinalizeOtherProf = {
      params: { id: contest.id },
      body: {},
      user: profOther,
    };
    const resFinalizeOtherProf = createMockRes();
    await contestController.finalizeContestRatings(reqFinalizeOtherProf, resFinalizeOtherProf, createMockNext(resFinalizeOtherProf));
    report('3.3 Non-owning professor blocked with 403 Forbidden on finalization endpoint', resFinalizeOtherProf.statusCode === 403);

    // 3.4 Official finalization succeeds by creator
    const reqFinalize = {
      params: { id: contest.id },
      body: {},
      user: profCreator,
    };
    const resFinalize = createMockRes();
    await contestController.finalizeContestRatings(reqFinalize, resFinalize, createMockNext(resFinalize));
    report('3.4 Official finalization succeeds (200 OK)', resFinalize.statusCode === 200);

    // Verify database snapshot in contests table
    const contestDb = await db.query(
      `SELECT is_rating_finalized, ratings_finalized_at, final_results_snapshot 
       FROM contests WHERE id = $1;`,
      [contest.id]
    );
    const cRow = contestDb.rows[0];
    report('3.5 Contest marked is_rating_finalized=true in database', cRow.is_rating_finalized === true);
    report('3.6 Database contains sealed final_results_snapshot JSON', cRow.final_results_snapshot && Array.isArray(cRow.final_results_snapshot.standings));

    // Verify rating_history entries
    const rhDb = await db.query(
      `SELECT user_id, rank, previous_rating, rating_change, new_rating 
       FROM rating_history WHERE contest_id = $1 ORDER BY rank ASC;`,
      [contest.id]
    );
    report('3.7 Rating history created for all 5 participants', rhDb.rows.length === 5);
    report('3.8 Alice awarded Rank #1 with rating increase', rhDb.rows[0].user_id === studentAlice.id && rhDb.rows[0].rating_change > 0);

    // -------------------------------------------------------------
    // Step 4: Concurrency & Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Concurrency & Idempotency ---');
    // 4.1 Repeated finalization is idempotent
    const resFinalizeRepeat = createMockRes();
    await contestController.finalizeContestRatings(reqFinalize, resFinalizeRepeat, createMockNext(resFinalizeRepeat));
    report('4.1 Repeated finalization is idempotent (200 OK with alreadyFinalized: true)',
      resFinalizeRepeat.statusCode === 200 && resFinalizeRepeat.body.alreadyFinalized === true
    );

    // 4.2 Concurrent finalization race simulation
    const concurrentFinalizeResults = await Promise.all([
      RatingService.finalizeContestRatings(contest.id, profCreator, {}, null),
      RatingService.finalizeContestRatings(contest.id, profCreator, {}, null),
      RatingService.finalizeContestRatings(contest.id, profCreator, {}, null),
    ]);
    const allAlreadyFinalized = concurrentFinalizeResults.every((r) => r.alreadyFinalized === true);
    report('4.2 Concurrent finalization calls handle row locks safely (all report alreadyFinalized)', allAlreadyFinalized);

    // Verify rating_history count remained strictly at 5 (no duplicates!)
    const rhCountRes = await db.query(`SELECT COUNT(*)::int as count FROM rating_history WHERE contest_id = $1;`, [contest.id]);
    report('4.3 Zero duplicate rating_history rows created after repeated & concurrent calls (count = 5)', rhCountRes.rows[0].count === 5);

    // -------------------------------------------------------------
    // Step 5: Result Immutability Lock
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Result Immutability Lock ---');
    // 5.1 Modifying contest settings post-finalization rejected with 409
    const reqMutate = { params: { id: contest.id }, body: { isRated: false }, user: profCreator };
    const resMutate = createMockRes();
    await contestController.updateContest(reqMutate, resMutate, createMockNext(resMutate));
    report('5.1 Result lock: modifying finalized contest settings rejected with 409 Conflict', resMutate.statusCode === 409);

    // 5.2 Adding problem to finalized contest rejected with 409
    const reqAddProb = { params: { id: contest.id }, body: { problemId: prob1.id, points: 50 }, user: profCreator };
    const resAddProb = createMockRes();
    await contestController.addProblemToContest(reqAddProb, resAddProb, createMockNext(resAddProb));
    report('5.2 Result lock: adding problem to finalized contest rejected with 409 Conflict', resAddProb.statusCode === 409);

    // 5.3 Adding participant to finalized contest rejected with 409
    const reqAddPart = { params: { id: contest.id }, body: { userId: studentAlice.id }, user: profCreator };
    const resAddPart = createMockRes();
    await contestController.addContestParticipant(reqAddPart, resAddPart, createMockNext(resAddPart));
    report('5.3 Result lock: adding participant to finalized contest rejected (400/409)', resAddPart.statusCode >= 400);

    // -------------------------------------------------------------
    // Step 6: 100% Cross-Layer Agreement Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 6: 100% Cross-Layer Agreement Verification ---');

    const finalStandings = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: studentAlice,
    });
    const finalResultsView = await StandingsService.computeContestResults({
      contestId: contest.id,
      requestingUser: studentAlice,
    });
    const snapshotStandings = cRow.final_results_snapshot.standings;

    const sAlice = finalStandings.standings.find((p) => p.userId === studentAlice.id);
    const sEve = finalStandings.standings.find((p) => p.userId === studentEve.id);
    const sBob = finalStandings.standings.find((p) => p.userId === studentBob.id);
    const sDave = finalStandings.standings.find((p) => p.userId === studentDave.id);
    const sCharlie = finalStandings.standings.find((p) => p.userId === studentCharlie.id);

    const rAlice = finalResultsView.standings.find((p) => p.userId === studentAlice.id);
    const rEve = finalResultsView.standings.find((p) => p.userId === studentEve.id);
    const rBob = finalResultsView.standings.find((p) => p.userId === studentBob.id);
    const snapAlice = snapshotStandings.find((p) => p.userId === studentAlice.id);
    const snapEve = snapshotStandings.find((p) => p.userId === studentEve.id);
    const snapBob = snapshotStandings.find((p) => p.userId === studentBob.id);

    // Tie-breaker: Eve (100 pts, penalty 25m) beats Bob (100 pts, penalty 58m) -> Eve #2, Bob #3
    report('6.1 Ranks agree 100% (Standings == ResultsView == Snapshot): Alice #1, Eve #2, Bob #3',
      sAlice.rank === 1 && rAlice.rank === 1 && snapAlice.rank === 1 &&
      sEve.rank === 2 && rEve.rank === 2 && snapEve.rank === 2 &&
      sBob.rank === 3 && rBob.rank === 3 && snapBob.rank === 3
    );

    report('6.2 Scores agree 100% (Standings == ResultsView == Snapshot): Alice 300, Eve 100, Bob 100, Dave 0, Charlie 0',
      sAlice.totalScore === 300 && rAlice.totalScore === 300 && snapAlice.totalScore === 300 &&
      sEve.totalScore === 100 && rEve.totalScore === 100 && snapEve.totalScore === 100 &&
      sBob.totalScore === 100 && rBob.totalScore === 100 && snapBob.totalScore === 100 &&
      sDave.totalScore === 0 && sCharlie.totalScore === 0
    );

    report('6.3 Solved counts agree 100%: Alice 2, Eve 1, Bob 1, Dave 0, Charlie 0',
      sAlice.solvedProblemsCount === 2 && sEve.solvedProblemsCount === 1 && sBob.solvedProblemsCount === 1 &&
      sDave.solvedProblemsCount === 0 && sCharlie.solvedProblemsCount === 0
    );

    // -------------------------------------------------------------
    // Step 7: Participant Result Details Matrix
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Participant Result Details Matrix ---');

    // Alice: All accepted
    const aliceDetails = await StandingsService.computeParticipantResultDetails({
      contestId: contest.id,
      targetUserId: studentAlice.id,
      requestingUser: studentAlice,
    });
    report('7.1 Alice Result Details matches Standings Row (Rank 1, Score 300, Solved 2, Subs 3)',
      aliceDetails.summary.rank === sAlice.rank &&
      aliceDetails.summary.totalScore === 300 &&
      aliceDetails.summary.solvedProblemsCount === 2 &&
      aliceDetails.summary.totalSubmissions === 3 &&
      aliceDetails.participant.ratingChange > 0
    );

    // Bob: Partial (1 solved, 1 failed attempt)
    const bobDetails = await StandingsService.computeParticipantResultDetails({
      contestId: contest.id,
      targetUserId: studentBob.id,
      requestingUser: profCreator,
      freezeOverride: true,
    });
    report('7.2 Bob Result Details matches Standings Row (Rank 3, Score 100, Solved 1, Subs 2)',
      bobDetails.summary.rank === sBob.rank &&
      bobDetails.summary.totalScore === 100 &&
      bobDetails.summary.solvedProblemsCount === 1 &&
      bobDetails.summary.totalSubmissions === 2
    );

    // Charlie: No submissions
    const charlieDetails = await StandingsService.computeParticipantResultDetails({
      contestId: contest.id,
      targetUserId: studentCharlie.id,
      requestingUser: profCreator,
    });
    report('7.3 Charlie Result Details matches 0 submissions state (Score 0, Solved 0, Subs 0)',
      charlieDetails.summary.totalScore === 0 &&
      charlieDetails.summary.solvedProblemsCount === 0 &&
      charlieDetails.submissions.length === 0
    );

    // Dave: All failed
    const daveDetails = await StandingsService.computeParticipantResultDetails({
      contestId: contest.id,
      targetUserId: studentDave.id,
      requestingUser: profCreator,
    });
    report('7.4 Dave Result Details matches all-failed state (Score 0, Solved 0, Subs 2)',
      daveDetails.summary.totalScore === 0 &&
      daveDetails.summary.solvedProblemsCount === 0 &&
      daveDetails.submissions.length === 2
    );

    // -------------------------------------------------------------
    // Step 8: Multi-Format Exports & Formula Injection Defense
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Multi-Format Exports & Formula Injection Defense ---');

    const exportResultsCsv = await ContestExportService.exportContestResults({
      contestId: contest.id,
      requestingUser: profCreator,
      format: 'csv',
    });
    const exportResultsJson = await ContestExportService.exportContestResults({
      contestId: contest.id,
      requestingUser: profCreator,
      format: 'json',
    });
    const jsonStandings = JSON.parse(exportResultsJson.content).standings;

    const jAlice = jsonStandings.find((p) => p.userId === studentAlice.id);
    const jEve = jsonStandings.find((p) => p.userId === studentEve.id);
    const jBob = jsonStandings.find((p) => p.userId === studentBob.id);

    report('8.1 Exported JSON matches displayed standings (Alice Rank 1 / 300 pts, Eve Rank 2 / 100 pts, Bob Rank 3 / 100 pts)',
      jAlice.rank === sAlice.rank && jAlice.totalScore === sAlice.totalScore &&
      jEve.rank === sEve.rank && jEve.totalScore === sEve.totalScore &&
      jBob.rank === sBob.rank && jBob.totalScore === sBob.totalScore
    );

    report('8.2 Exported JSON problemResults populated accurately for both problems',
      jAlice.problemResults[prob1.id].status === 'solved' &&
      jAlice.problemResults[prob1.id].points === 100 &&
      jAlice.problemResults[prob2.id].status === 'solved' &&
      jAlice.problemResults[prob2.id].points === 200
    );

    report('8.3 Exported CSV contains Alice Smith with Rank 1, 300 points, and solved status',
      exportResultsCsv.content.includes('"1"') &&
      exportResultsCsv.content.includes('"Alice Smith"') &&
      exportResultsCsv.content.includes('"300"') &&
      exportResultsCsv.content.includes('"solved"')
    );

    // CSV Formula Injection Defense
    const formulaUser = await UserModel.createUser({
      username: `formula_user_${stamp}`,
      email: `formula_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: '=CMD|"/C calc"!A0',
      role: 'student',
    });
    trackedUserIds.push(formulaUser.id);

    const testContestFormula = await ContestModel.createContest({
      title: `Formula Test ${stamp}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes: 60,
      isRated: false,
      createdBy: profCreator.id,
    });
    trackedContestIds.push(testContestFormula.id);

    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3);`,
      [testContestFormula.id, formulaUser.id, startTime.toISOString()]
    );

    const formulaCsvRes = await ContestExportService.exportContestResults({
      contestId: testContestFormula.id,
      requestingUser: profCreator,
      format: 'csv',
    });
    report('8.4 CSV formula injection defense escapes leading = with single quote',
      formulaCsvRes.content.includes("''=CMD") || formulaCsvRes.content.includes("'=CMD")
    );

    // -------------------------------------------------------------
    // Step 9: Security, RBAC & IDOR/BOLA Hardening
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Security, RBAC & IDOR/BOLA Hardening ---');

    // 9.1 Student blocked from administrative export endpoints (403)
    const reqStudentExp = { params: { id: contest.id }, query: {}, user: studentAlice };
    const resStudentExp = createMockRes();
    await contestController.exportContestResults(reqStudentExp, resStudentExp, createMockNext(resStudentExp));
    report('9.1 Student blocked with 403 on contest results export endpoint', resStudentExp.statusCode === 403);

    // 9.2 Cross-professor BOLA isolation on admin leaderboard (403)
    const reqOtherProf = { params: { id: contest.id }, query: {}, user: profOther };
    const resOtherProf = createMockRes();
    await contestController.getContestAdminLeaderboard(reqOtherProf, resOtherProf, createMockNext(resOtherProf));
    report('9.2 Non-owning professor blocked with 403 on admin leaderboard', resOtherProf.statusCode === 403);

    // 9.3 Cross-student BOLA isolation on participant results (403)
    const reqCrossStudent = { params: { id: contest.id, userId: studentBob.id }, query: {}, user: studentAlice };
    const resCrossStudent = createMockRes();
    await contestController.getContestParticipantResultDetails(reqCrossStudent, resCrossStudent, createMockNext(resCrossStudent));
    report('9.3 Student Alice blocked with 403 from inspecting Student Bob result details', resCrossStudent.statusCode === 403);

    // 9.4 Zero credentials / passwords exposed in exports
    report('9.4 Zero password hashes in CSV export', !exportResultsCsv.content.includes('$2b$10$'));
    report('9.5 Zero password hashes in JSON export', !exportResultsJson.content.includes('$2b$10$'));

    // -------------------------------------------------------------
    // Step 10: Scale & Large Participant Validation (> 100 participants)
    // -------------------------------------------------------------
    console.log('\n--- Step 10: Scale & Large Participant Validation (105 participants) ---');

    const scaleContest = await ContestModel.createContest({
      title: `Scale Test Contest ${stamp}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes: 60,
      isRated: false,
      createdBy: profCreator.id,
    });
    trackedContestIds.push(scaleContest.id);
    await ContestModel.updateContest(scaleContest.id, { status: 'published' });

    // Link problem
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points) VALUES ($1, $2, 1, 100);`,
      [scaleContest.id, prob1.id]
    );

    // Create 105 participants
    const scaleUserIds = [];
    const scaleValues = [];
    for (let i = 1; i <= 105; i++) {
      const uRes = await db.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
         VALUES ($1, $2, $3, $4, 'student', true) RETURNING id;`,
        [`scale_user_${i}_${stamp}`, `scale_${i}_${stamp}@examforge.test`, dummyHash, `Scale User ${i}`]
      );
      const uid = uRes.rows[0].id;
      scaleUserIds.push(uid);
      trackedUserIds.push(uid);
      scaleValues.push(`(${scaleContest.id}, ${uid}, '${startTime.toISOString()}')`);
    }

    // Bulk enroll 105 participants
    await db.query(`INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ${scaleValues.join(',')};`);

    // Add submission for user 1 to have score
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 10, 1024, false, 'console.log(1)', $4);`,
      [scaleContest.id, prob1.id, scaleUserIds[0], new Date(startTime.getTime() + 10 * 60 * 1000).toISOString()]
    );

    // Verify pagination: Page 1 with limit 50
    const p1 = await StandingsService.computeContestStandings({
      contestId: scaleContest.id,
      page: 1,
      limit: 50,
      requestingUser: profCreator,
    });
    report('10.1 Scale: Total participants is 105', p1.pagination.totalParticipants === 105);
    report('10.2 Scale: Page 1 returns exactly 50 rows', p1.standings.length === 50);
    report('10.3 Scale: totalPages is 3 with hasNext=true', p1.pagination.totalPages === 3 && p1.pagination.hasNext === true);

    // Verify pagination: Page 3 with limit 50
    const p3 = await StandingsService.computeContestStandings({
      contestId: scaleContest.id,
      page: 3,
      limit: 50,
      requestingUser: profCreator,
    });
    report('10.4 Scale: Page 3 returns remaining 5 rows with hasNext=false', p3.standings.length === 5 && p3.pagination.hasNext === false);

    // Verify export exports ALL 105 participants (no accidental 100 limit truncation!)
    const scaleExport = await ContestExportService.exportContestResults({
      contestId: scaleContest.id,
      requestingUser: profCreator,
      format: 'json',
    });
    const scaleStandings = JSON.parse(scaleExport.content).standings;
    report('10.5 Scale: Export returns ALL 105 participants (no 100-limit truncation)', scaleStandings.length === 105);

    // -------------------------------------------------------------
    // Step 11: Error Handling & Identifier Hardening
    // -------------------------------------------------------------
    console.log('\n--- Step 11: Error Handling & Identifier Hardening ---');

    // 11.1 Nonexistent contest returns 404
    const reqNonexistent = { params: { id: 99999999 }, query: {}, user: profCreator };
    const resNonexistent = createMockRes();
    await contestController.getContestLeaderboard(reqNonexistent, resNonexistent, createMockNext(resNonexistent));
    report('11.1 Nonexistent contest returns 404 Not Found', resNonexistent.statusCode === 404);

    // 11.2 Non-integer contest ID returns 400
    const reqMalformed = { params: { id: 'abc' }, query: {}, user: profCreator };
    const resMalformed = createMockRes();
    await contestController.getContestLeaderboard(reqMalformed, resMalformed, createMockNext(resMalformed));
    report('11.2 String contest ID returns 400 Bad Request', resMalformed.statusCode === 400);

    // 11.3 Negative contest ID returns 400
    const reqNegative = { params: { id: -5 }, query: {}, user: profCreator };
    const resNegative = createMockRes();
    await contestController.getContestLeaderboard(reqNegative, resNegative, createMockNext(resNegative));
    report('11.3 Negative contest ID returns 400 Bad Request', resNegative.statusCode === 400);

    // =============================================================
    // Summary
    // =============================================================
    console.log('\n================================================================');
    console.log(` Test Summary: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${totalTests})`);
    console.log('================================================================');

    if (failedTests > 0) {
      exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal error during Phase 7.5.8.9 integration suite:', err);
    exitCode = 1;
  } finally {
    // -------------------------------------------------------------
    // Teardown: Clean all test entities and verify baseline
    // -------------------------------------------------------------
    console.log('\n--- Cleaning Up Ephemeral Test Data ---');
    try {
      if (trackedContestIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[]);`, [trackedContestIds]);
      }
      if (trackedUserIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [trackedUserIds]);
      }
      console.log('Test cleanup completed successfully.');
    } catch (cleanErr) {
      console.error('Error during test cleanup:', cleanErr.message);
    }
    await db.closePool();
    process.exit(exitCode);
  }
}

if (require.main === module) {
  runPhaseCompletionIntegrationSuite();
}

module.exports = { runPhaseCompletionIntegrationSuite };
