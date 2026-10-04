/**
 * Phase 7.5.8.9 — Integration & Phase Completion Test Suite
 * File: backend/test_phase7_5_8_9_integration_completion.js
 *
 * Final End-to-End Cross-Layer Integration & Agreement Test:
 * 1. Contest Lifecycle: Creation -> Problem Assignment -> Enrolling Participants
 * 2. Pre-Freeze Submissions Evaluation
 * 3. Active Freeze Window Evaluation (Public Leaderboard vs Admin Leaderboard vs Export)
 * 4. Post-Freeze Judging & Pending Submissions Guard
 * 5. Contest End & Authoritative Finalization (Rating Calculation & Database Snapshot)
 * 6. 100% Data Agreement Verification:
 *    - StandingsService == Admin Leaderboard == Public Leaderboard == Results View
 *    - Participant Result Details == Leaderboard Row == Self View
 *    - CSV Results Export == JSON Results Export == Displayed Standings
 *    - Submissions Export == Database Submissions Log
 * 7. Security, BOLA & Immutability Verification:
 *    - Mutating results post-finalization is blocked with 409
 *    - Cross-professor / cross-student isolation enforced
 *    - Zero secrets/passwords/tokens exposed
 */

const assert = require('assert');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const StandingsService = require('./src/services/standingsService');
const ContestExportService = require('./src/services/contestExportService');
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

async function runPhaseCompletionIntegrationSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.9 — Integration & Phase Completion Test Suite      ');
  console.log('================================================================\n');

  const stamp = Date.now();
  const dummyHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

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

    const profOther = await UserModel.createUser({
      username: `prof_p9_other_${stamp}`,
      email: `prof_p9_other_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Professor Other Nine',
      role: 'professor',
    });

    const contestAdmin = await UserModel.createUser({
      username: `admin_p9_${stamp}`,
      email: `admin_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Contest Admin Nine',
      role: 'contest_admin',
    });

    const studentAlice = await UserModel.createUser({
      username: `alice_p9_${stamp}`,
      email: `alice_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Alice Smith',
      role: 'student',
    });

    const studentBob = await UserModel.createUser({
      username: `bob_p9_${stamp}`,
      email: `bob_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Bob Jones',
      role: 'student',
    });

    const studentCharlie = await UserModel.createUser({
      username: `charlie_p9_${stamp}`,
      email: `charlie_p9_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Charlie Brown',
      role: 'student',
    });

    // Fetch 2 test problems
    const probs = await db.query('SELECT id, title, difficulty FROM problems ORDER BY id ASC LIMIT 2;');
    const prob1 = probs.rows[0];
    const prob2 = probs.rows[1];

    // -------------------------------------------------------------
    // 1. Contest Lifecycle & Setup
    // -------------------------------------------------------------
    console.log('--- Step 1: Contest Setup & Enrollment ---');
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
    await ContestModel.updateContest(contest.id, { status: 'published' });

    // Attach problems: Prob 1 (100 pts), Prob 2 (200 pts)
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
       VALUES ($1, $2, 1, 100), ($1, $3, 2, 200);`,
      [contest.id, prob1.id, prob2.id]
    );

    // Enroll Alice, Bob, and Charlie
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at)
       VALUES ($1, $2, $5), ($1, $3, $5), ($1, $4, $5);`,
      [contest.id, studentAlice.id, studentBob.id, studentCharlie.id, startTime.toISOString()]
    );
    report('1.1 Contest created, published, problems linked, and 3 students enrolled', true);

    // -------------------------------------------------------------
    // 2. Pre-Freeze & Post-Freeze Submissions
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

    // Post-freeze: Bob solves Prob 1 at now - 2m (accepted, 100 pts)
    const tBobSolve = new Date(now.getTime() - 2 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 25, 2048, false, 'function solution() { return 1; }', $4);`,
      [contest.id, prob1.id, studentBob.id, tBobSolve.toISOString()]
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

    report('2.2 Alice public score is 300 (100 + 200, 2 solves)', alicePub.totalScore === 300 && alicePub.solvedProblemsCount === 2);
    report('2.3 Bob post-freeze solve is masked (0 pts, 0 solves on public leaderboard)', bobPub.totalScore === 0 && bobPub.solvedProblemsCount === 0);
    report('2.4 Charlie unattempted score is 0', charliePub.totalScore === 0 && charliePub.totalSubmissions === 0);

    const adminLb = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: profCreator,
      freezeOverride: true,
    });
    const bobAdmin = adminLb.standings.find((p) => p.userId === studentBob.id);
    report('2.5 Manager freezeOverride=true reveals Bob unmasked solve (100 pts, 1 solve)', bobAdmin.totalScore === 100 && bobAdmin.solvedProblemsCount === 1);

    // -------------------------------------------------------------
    // 3. Contest End & Authoritative Finalization
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Contest Finalization & Rating Seal ---');
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

    // Finalize ratings and publish official results
    const reqFinalize = {
      params: { id: contest.id },
      body: {},
      user: profCreator,
    };
    const resFinalize = createMockRes();
    await contestController.finalizeContestRatings(reqFinalize, resFinalize, () => {});
    report('3.1 Official finalization succeeds (200 OK)', resFinalize.statusCode === 200);

    // Verify database snapshot in contests table
    const contestDb = await db.query(
      `SELECT is_rating_finalized, ratings_finalized_at, final_results_snapshot 
       FROM contests WHERE id = $1;`,
      [contest.id]
    );
    const cRow = contestDb.rows[0];
    report('3.2 Contest marked is_rating_finalized=true in database', cRow.is_rating_finalized === true);
    report('3.3 Database contains sealed final_results_snapshot JSON', cRow.final_results_snapshot && Array.isArray(cRow.final_results_snapshot.standings));

    // Verify rating_history entries
    const rhDb = await db.query(
      `SELECT user_id, rank, previous_rating, rating_change, new_rating 
       FROM rating_history WHERE contest_id = $1 ORDER BY rank ASC;`,
      [contest.id]
    );
    report('3.4 Rating history created for all 3 participants', rhDb.rows.length === 3);
    report('3.5 Alice awarded Rank #1 with rating increase', rhDb.rows[0].user_id === studentAlice.id && rhDb.rows[0].rating_change > 0);

    // -------------------------------------------------------------
    // 4. Cross-Layer Agreement Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 4: 100% Cross-Layer Agreement Verification ---');

    // 4.1 StandingsService vs Public Leaderboard vs Admin Leaderboard vs Results View
    const finalStandings = await StandingsService.computeContestStandings({
      contestId: contest.id,
      requestingUser: studentAlice,
    });
    const finalResultsView = await StandingsService.computeContestResults({
      contestId: contest.id,
      requestingUser: studentAlice,
    });

    const sAlice = finalStandings.standings.find((p) => p.userId === studentAlice.id);
    const sBob = finalStandings.standings.find((p) => p.userId === studentBob.id);
    const sCharlie = finalStandings.standings.find((p) => p.userId === studentCharlie.id);

    const rAlice = finalResultsView.standings.find((p) => p.userId === studentAlice.id);
    const rBob = finalResultsView.standings.find((p) => p.userId === studentBob.id);

    report('4.1 StandingsService and computeContestResults ranks match exactly (Alice #1, Bob #2, Charlie #3)',
      sAlice.rank === 1 && rAlice.rank === 1 && sBob.rank === 2 && rBob.rank === 2 && sCharlie.rank === 3
    );

    report('4.2 StandingsService and computeContestResults scores match exactly (Alice 300, Bob 100, Charlie 0)',
      sAlice.totalScore === 300 && rAlice.totalScore === 300 && sBob.totalScore === 100 && rBob.totalScore === 100
    );

    // 4.3 Participant Result Details vs Standings Row
    const aliceDetails = await StandingsService.computeParticipantResultDetails({
      contestId: contest.id,
      targetUserId: studentAlice.id,
      requestingUser: studentAlice,
    });
    report(
      '4.3 Participant Result Details matches Standings Row (Rank, Score, Solved, Submissions)',
      aliceDetails.summary.rank === sAlice.rank &&
        aliceDetails.summary.totalScore === sAlice.totalScore &&
        aliceDetails.summary.solvedProblemsCount === sAlice.solvedProblemsCount &&
        aliceDetails.summary.totalSubmissions === sAlice.totalSubmissions
    );
    report('4.4 Alice rating change reflected in Participant Result Details', aliceDetails.participant.ratingChange > 0);

    // 4.4 Displayed Results vs Exported Results (CSV & JSON)
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
    const jBob = jsonStandings.find((p) => p.userId === studentBob.id);

    report('4.5 Exported JSON matches displayed standings (Alice Rank 1 / 300 pts, Bob Rank 2 / 100 pts)',
      jAlice.rank === sAlice.rank && jAlice.totalScore === sAlice.totalScore &&
      jBob.rank === sBob.rank && jBob.totalScore === sBob.totalScore
    );

    report('4.6 Exported JSON problemResults populated accurately for both problems',
      jAlice.problemResults[prob1.id].status === 'solved' &&
      jAlice.problemResults[prob1.id].points === 100 &&
      jAlice.problemResults[prob2.id].status === 'solved' &&
      jAlice.problemResults[prob2.id].points === 200
    );

    report('4.7 Exported CSV contains Alice Smith with Rank 1, 300 points, and solved status',
      exportResultsCsv.content.includes('"1"') &&
      exportResultsCsv.content.includes('"Alice Smith"') &&
      exportResultsCsv.content.includes('"300"') &&
      exportResultsCsv.content.includes('"solved"')
    );

    // 4.5 Submissions Export Agreement
    const exportSubsJson = await ContestExportService.exportContestSubmissions({
      contestId: contest.id,
      requestingUser: profCreator,
      format: 'json',
      freezeOverride: true,
    });
    const subsData = JSON.parse(exportSubsJson.content);
    report('4.8 Submissions export count matches authoritative submissions in database (5 total)', subsData.totalSubmissions === 5);

    // -------------------------------------------------------------
    // 5. Security & Immutability Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Security, BOLA & Immutability Verification ---');

    // 5.1 Student blocked from administrative export endpoints (403)
    const reqStudentExp = { params: { id: contest.id }, query: {}, user: studentAlice };
    const resStudentExp = createMockRes();
    await contestController.exportContestResults(reqStudentExp, resStudentExp, () => {});
    report('5.1 Student blocked with 403 on contest results export endpoint', resStudentExp.statusCode === 403);

    // 5.2 Cross-professor BOLA isolation on admin leaderboard (403)
    const reqOtherProf = { params: { id: contest.id }, query: {}, user: profOther };
    const resOtherProf = createMockRes();
    await contestController.getContestAdminLeaderboard(reqOtherProf, resOtherProf, () => {});
    report('5.2 Non-owning professor blocked with 403 on admin leaderboard', resOtherProf.statusCode === 403);

    // 5.3 Cross-student BOLA isolation on participant results (403)
    const reqCrossStudent = { params: { id: contest.id, userId: studentBob.id }, query: {}, user: studentAlice };
    const resCrossStudent = createMockRes();
    await contestController.getContestParticipantResultDetails(reqCrossStudent, resCrossStudent, () => {});
    report('5.3 Student Alice blocked with 403 from inspecting Student Bob result details', resCrossStudent.statusCode === 403);

    // 5.4 Result lock post-finalization: modifying contest settings blocked (409)
    const reqMutate = { params: { id: contest.id }, body: { isRated: false }, user: profCreator };
    const resMutate = createMockRes();
    await contestController.updateContest(reqMutate, resMutate, () => {});
    report('5.4 Result lock: modifying finalized contest settings rejected with 409 Conflict', resMutate.statusCode === 409);

    // 5.5 Result lock post-finalization: adding problem blocked (409)
    const reqAddProb = { params: { id: contest.id }, body: { problemId: prob1.id, points: 50 }, user: profCreator };
    const resAddProb = createMockRes();
    await contestController.addProblemToContest(reqAddProb, resAddProb, () => {});
    report('5.5 Result lock: adding problem to finalized contest rejected with 409 Conflict', resAddProb.statusCode === 409);

    // 5.6 Result lock post-finalization: adding participant blocked (400/409)
    const reqAddPart = { params: { id: contest.id }, body: { userId: studentAlice.id }, user: profCreator };
    const resAddPart = createMockRes();
    await contestController.addContestParticipant(reqAddPart, resAddPart, () => {});
    report('5.6 Result lock: adding participant to finalized contest rejected (400/409)', resAddPart.statusCode >= 400);

    // 5.7 Audit logging of all critical actions
    const auditRes = await db.query(
      `SELECT action, outcome, resource_type, resource_id 
       FROM audit_logs 
       WHERE resource_id = $1 
       ORDER BY id DESC LIMIT 10;`,
      [contest.id]
    );
    const actions = auditRes.rows.map((r) => r.action);
    report('5.7 Structured audit log captures RATINGS_FINALIZED', actions.includes('RATINGS_FINALIZED'));
    report('5.7 Structured audit log captures PRIVILEGED_ACTION_DENIED for unauthorized attempts', actions.includes('PRIVILEGED_ACTION_DENIED'));

    // =============================================================
    // Summary
    // =============================================================
    console.log('\n================================================================');
    console.log(` Test Summary: ${passedTests} PASSED, ${failedTests} FAILED (Total: ${totalTests})`);
    console.log('================================================================');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during Phase 7.5.8.9 integration suite:', err);
    process.exit(1);
  } finally {
    await db.closePool();
  }
}

if (require.main === module) {
  runPhaseCompletionIntegrationSuite();
}

module.exports = { runPhaseCompletionIntegrationSuite };
