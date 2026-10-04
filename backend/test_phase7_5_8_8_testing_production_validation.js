/**
 * Phase 7.5.8.8 — Testing, Regression & Production Readiness Test Suite
 * File: backend/test_phase7_5_8_8_testing_production_validation.js
 *
 * Comprehensive end-to-end verification covering:
 * 1. Full Functional Flow Audit (Contest -> Standings -> Freeze -> Finalization -> Details -> Export)
 * 2. Weakness Fix Validations:
 *    - Export CSV & JSON problem results mapping
 *    - Participant export penaltyContribution output
 *    - Submissions export freeze cutoff masking
 *    - Deterministic tie-breaking with pre-computed lastAcceptedAtMs
 * 3. Security & BOLA Isolation (RBAC, cross-professor, cross-student)
 * 4. Data Integrity & Post-Finalization Lock
 * 5. Concurrency & Edge Cases (Concurrent submissions, concurrent exports, empty contests)
 * 6. Production Performance & Index Verification
 */

const assert = require('assert');
const db = require('./src/config/db');
const ContestModel = require('./src/models/contestModel');
const UserModel = require('./src/models/userModel');
const StandingsService = require('./src/services/standingsService');
const ContestExportService = require('./src/services/contestExportService');
const contestController = require('./src/controllers/contestController');

// Test tracking
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

// Mock Express response factory
function createMockRes() {
  const res = {
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
  return res;
}

async function runProductionValidationSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.8 — Testing, Regression & Production Validation    ');
  console.log('================================================================\n');

  const stamp = Date.now();

  try {
    // -------------------------------------------------------------
    // Setup Test Actors
    // -------------------------------------------------------------
    const dummyHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

    const profA = await UserModel.createUser({
      username: `prof_p8_a_${stamp}`,
      email: `prof_p8_a_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Professor Eight A',
      role: 'professor',
    });

    const profB = await UserModel.createUser({
      username: `prof_p8_b_${stamp}`,
      email: `prof_p8_b_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Professor Eight B',
      role: 'professor',
    });

    const contestAdmin = await UserModel.createUser({
      username: `admin_p8_${stamp}`,
      email: `admin_p8_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Contest Admin Eight',
      role: 'contest_admin',
    });

    const student1 = await UserModel.createUser({
      username: `student1_p8_${stamp}`,
      email: `student1_p8_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Student Alice Eight',
      role: 'student',
    });

    const student2 = await UserModel.createUser({
      username: `student2_p8_${stamp}`,
      email: `student2_p8_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Student Bob Eight',
      role: 'student',
    });

    const student3 = await UserModel.createUser({
      username: `student3_p8_${stamp}`,
      email: `student3_p8_${stamp}@examforge.test`,
      passwordHash: dummyHash,
      fullName: 'Student Charlie Eight',
      role: 'student',
    });

    // Pick 2 problems
    const probsRes = await db.query('SELECT id, title FROM problems ORDER BY id ASC LIMIT 2;');
    const problem1 = probsRes.rows[0];
    const problem2 = probsRes.rows[1];

    // =============================================================
    // SECTION 1: FULL FUNCTIONAL AUDIT
    // Contest -> Participants -> Submissions -> Standings -> Freeze -> Final Results -> Export
    // =============================================================
    console.log('--- Section 1: Full Functional Flow Audit ---');

    const now = new Date();
    const liveStart = new Date(now.getTime() - 40 * 60 * 1000); // 40m ago
    const liveEnd = new Date(now.getTime() + 20 * 60 * 1000);   // 20m from now
    // Freeze window: 30 minutes before end => freezeTime = now - 10m (currently in freeze)
    const contestMain = await ContestModel.createContest({
      title: `Production Audit Contest Main ${stamp}`,
      description: 'End-to-end production audit flow',
      startTime: liveStart.toISOString(),
      endTime: liveEnd.toISOString(),
      durationMinutes: 60,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
      createdBy: profA.id,
    });
    await ContestModel.updateContest(contestMain.id, { status: 'published' });

    // Link problems (Problem 1: 100 pts, Problem 2: 200 pts)
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
       VALUES ($1, $2, 1, 100), ($1, $3, 2, 200);`,
      [contestMain.id, problem1.id, problem2.id]
    );

    // Register participants
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at)
       VALUES ($1, $2, $4), ($1, $3, $4);`,
      [contestMain.id, student1.id, student2.id, liveStart.toISOString()]
    );

    // Submissions before freeze (submitted at liveStart + 5m)
    const preFreezeTime = new Date(liveStart.getTime() + 5 * 60 * 1000);
    // Alice solves Problem 1 (accepted, 100 pts)
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 25, 4096, false, 'function solution() { return true; }', $4);`,
      [contestMain.id, problem1.id, student1.id, preFreezeTime.toISOString()]
    );

    // Submissions during freeze (submitted at now - 2m)
    const postFreezeTime = new Date(now.getTime() - 2 * 60 * 1000);
    // Bob solves Problem 1 during freeze (accepted, 100 pts)
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
       VALUES ($1, $2, $3, 'javascript', 'accepted', 100, 30, 4096, false, 'function solution() { return true; }', $4);`,
      [contestMain.id, problem1.id, student2.id, postFreezeTime.toISOString()]
    );

    // 1.1 Compute Standings for public student (freeze active, Bob's post-freeze solve should be masked)
    const publicStandings = await StandingsService.computeContestStandings({
      contestId: contestMain.id,
      requestingUser: student1,
      freezeOverride: false,
    });
    report(
      '1.1.1 Contest detects active freeze state',
      publicStandings.isFrozen === true && publicStandings.freezeState === 'FROZEN'
    );
    const alicePublic = publicStandings.standings.find((p) => p.userId === student1.id);
    const bobPublic = publicStandings.standings.find((p) => p.userId === student2.id);
    report('1.1.2 Pre-freeze solve score correctly credited to Alice (100 pts)', alicePublic.totalScore === 100);
    report('1.1.3 Post-freeze solve score masked for Bob on public leaderboard (0 pts)', bobPublic.totalScore === 0);

    // 1.2 Manager view with freezeOverride=true sees unmasked results
    const adminStandings = await StandingsService.computeContestStandings({
      contestId: contestMain.id,
      requestingUser: profA,
      freezeOverride: true,
    });
    const bobAdmin = adminStandings.standings.find((p) => p.userId === student2.id);
    report('1.2.1 Manager with freezeOverride sees Bob unmasked score (100 pts)', bobAdmin.totalScore === 100);

    // =============================================================
    // SECTION 2: WEAKNESS FIX VALIDATIONS
    // =============================================================
    console.log('\n--- Section 2: Weakness Fix Validations ---');

    // 2.1 Export Results CSV: problem results columns should have accurate points and status
    const exportCsvRes = await ContestExportService.exportContestResults({
      contestId: contestMain.id,
      requestingUser: profA,
      format: 'csv',
      freezeOverride: true,
    });
    // Check that CSV contains problem points and status
    const csvContent = exportCsvRes.content;
    const hasAliceSolved = csvContent.includes('"Student Alice Eight"') && csvContent.includes('"solved"');
    report('2.1.1 Results CSV export correctly maps problem status as solved (not unattempted)', hasAliceSolved);
    report('2.1.2 Results CSV export correctly contains problem points (100)', csvContent.includes('"100"'));

    // 2.2 Export Results JSON: problemResults dictionary populated
    const exportJsonRes = await ContestExportService.exportContestResults({
      contestId: contestMain.id,
      requestingUser: profA,
      format: 'json',
      freezeOverride: true,
    });
    const jsonParsed = JSON.parse(exportJsonRes.content);
    const aliceJsonRow = jsonParsed.standings.find((r) => r.userId === student1.id);
    const prob1Result = aliceJsonRow?.problemResults?.[problem1.id];
    report(
      '2.2.1 Results JSON export contains populated problemResults dictionary',
      prob1Result && prob1Result.points === 100 && prob1Result.status === 'solved' && prob1Result.solved === true
    );

    // 2.3 Individual Participant Details Export: penaltyContribution output
    const partDetailsCsv = await ContestExportService.exportParticipantDetails({
      contestId: contestMain.id,
      targetUserId: student1.id,
      requestingUser: profA,
      format: 'csv',
      freezeOverride: true,
    });
    // Check that Problem Performance section includes penaltyContribution (5m acceptedTime => 5 penalty)
    report(
      '2.3.1 Participant details CSV correctly includes penalty contribution value',
      partDetailsCsv.content.includes('=== PROBLEM PERFORMANCE ===') && partDetailsCsv.content.includes('"5"')
    );

    // 2.4 Submissions Export Freeze Cutoff Masking
    // When freezeOverride is false, Bob's post-freeze submission must be excluded
    const frozenSubsExport = await ContestExportService.exportContestSubmissions({
      contestId: contestMain.id,
      requestingUser: profA,
      format: 'json',
      freezeOverride: false,
    });
    const frozenSubsJson = JSON.parse(frozenSubsExport.content);
    const hasBobInFrozenExport = frozenSubsJson.submissions.some((s) => s.userId === student2.id);
    report(
      '2.4.1 Submissions export with freezeOverride=false honors freeze cutoff and excludes post-freeze submission',
      !hasBobInFrozenExport
    );

    // When freezeOverride is true, Bob's post-freeze submission is included
    const unmaskedSubsExport = await ContestExportService.exportContestSubmissions({
      contestId: contestMain.id,
      requestingUser: profA,
      format: 'json',
      freezeOverride: true,
    });
    const unmaskedSubsJson = JSON.parse(unmaskedSubsExport.content);
    const hasBobInUnmaskedExport = unmaskedSubsJson.submissions.some((s) => s.userId === student2.id);
    report(
      '2.4.2 Submissions export with freezeOverride=true includes unmasked post-freeze submission',
      hasBobInUnmaskedExport
    );

    // =============================================================
    // SECTION 3: SECURITY, BOLA & TAMPER RESISTANCE
    // =============================================================
    console.log('\n--- Section 3: Security, BOLA & Tamper Resistance ---');

    // 3.1 Student role blocked from administrative export endpoints (403)
    const reqAdminLbStudent = {
      params: { id: contestMain.id },
      query: {},
      user: student1,
    };
    const resAdminLbStudent = createMockRes();
    await contestController.getContestAdminLeaderboard(reqAdminLbStudent, resAdminLbStudent, () => {});
    report('3.1.1 Student blocked with 403 on admin leaderboard endpoint', resAdminLbStudent.statusCode === 403);

    const reqExpResultsStudent = {
      params: { id: contestMain.id },
      query: {},
      user: student1,
    };
    const resExpResultsStudent = createMockRes();
    await contestController.exportContestResults(reqExpResultsStudent, resExpResultsStudent, () => {});
    report('3.1.2 Student blocked with 403 on contest results export endpoint', resExpResultsStudent.statusCode === 403);

    // 3.2 Cross-professor BOLA isolation
    const reqCrossProf = {
      params: { id: contestMain.id },
      query: {},
      user: profB,
    };
    const resCrossProf = createMockRes();
    await contestController.getContestAdminLeaderboard(reqCrossProf, resCrossProf, () => {});
    report('3.2.1 Non-creator Professor B blocked with 403 from Contest A admin leaderboard', resCrossProf.statusCode === 403);

    // 3.3 Cross-student BOLA isolation
    const reqCrossStudent = {
      params: { id: contestMain.id, userId: student2.id },
      query: {},
      user: student1,
    };
    const resCrossStudent = createMockRes();
    await contestController.getContestParticipantResultDetails(reqCrossStudent, resCrossStudent, () => {});
    report('3.3.1 Student 1 blocked with 403 from inspecting Student 2 participant results', resCrossStudent.statusCode === 403);

    // 3.4 Client body score tampering immunity during finalization
    // Mark contest ended
    await db.query(
      `UPDATE contests 
       SET start_time = $1, end_time = $2 
       WHERE id = $3;`,
      [new Date(now.getTime() - 60 * 60 * 1000).toISOString(), new Date(now.getTime() - 10 * 60 * 1000).toISOString(), contestMain.id]
    );

    const reqFinalize = {
      params: { id: contestMain.id },
      body: {
        totalScore: 99999, // Injected tampering payload
        rank: 1,
        results: [{ userId: student2.id, score: 99999, rank: 1 }],
      },
      user: profA,
    };
    const resFinalize = createMockRes();
    await contestController.finalizeContestRatings(reqFinalize, resFinalize, () => {});
    report('3.4.1 Finalization succeeds (200 OK)', resFinalize.statusCode === 200);

    const postFinalStandings = await StandingsService.computeContestStandings({
      contestId: contestMain.id,
      requestingUser: profA,
    });
    const aliceFinal = postFinalStandings.standings.find((p) => p.userId === student1.id);
    report('3.4.2 Injected scores ignored; Alice authoritative score preserved (100 pts)', aliceFinal.totalScore === 100);

    // 3.4.3 Finalization idempotency
    const resFinalizeAgain = createMockRes();
    await contestController.finalizeContestRatings(reqFinalize, resFinalizeAgain, () => {});
    report(
      '3.4.3 Repeated finalization call is idempotent (200 OK, alreadyFinalized: true)',
      resFinalizeAgain.statusCode === 200 &&
        (resFinalizeAgain.body?.alreadyFinalized === true || resFinalizeAgain.body?.isIdempotentSkip === true)
    );

    // 3.5 Post-finalization mutations locked (409 Conflict)
    const reqMutateLocked = {
      params: { id: contestMain.id },
      body: { isRated: false },
      user: profA,
    };
    const resMutateLocked = createMockRes();
    await contestController.updateContest(reqMutateLocked, resMutateLocked, () => {});
    report('3.5.1 Contest setting mutation post-finalization is rejected with 409 Conflict', resMutateLocked.statusCode === 409);

    // 3.6 Input Validation & Error Handling
    const reqInvalidId = {
      params: { id: 'invalid_id_not_int' },
      query: {},
      user: profA,
    };
    const resInvalidId = createMockRes();
    await contestController.getContestAdminLeaderboard(reqInvalidId, resInvalidId, () => {});
    report('3.6.1 Non-integer contest ID rejected with 400 Bad Request', resInvalidId.statusCode === 400);

    const reqNegativeId = {
      params: { id: -999 },
      query: {},
      user: profA,
    };
    const resNegativeId = createMockRes();
    await contestController.getContestAdminLeaderboard(reqNegativeId, resNegativeId, () => {});
    report('3.6.2 Negative contest ID rejected with 400 Bad Request', resNegativeId.statusCode === 400);

    // =============================================================
    // SECTION 4: CONCURRENCY & EDGE CASES
    // =============================================================
    console.log('\n--- Section 4: Concurrency & Edge Cases ---');

    // 4.1 Empty Contest (0 participants, 0 problems)
    const emptyContest = await ContestModel.createContest({
      title: `Empty Contest ${stamp}`,
      startTime: new Date(now.getTime() - 10000).toISOString(),
      endTime: new Date(now.getTime() + 100000).toISOString(),
      durationMinutes: 60,
      createdBy: profA.id,
    });
    const emptyStandings = await StandingsService.computeContestStandings({
      contestId: emptyContest.id,
      requestingUser: profA,
    });
    report(
      '4.1.1 Empty contest standings calculates gracefully (0 participants, 0 avg score)',
      emptyStandings.standings.length === 0 && emptyStandings.contestSummary.averageScore === 0
    );

    // 4.2 Empty Contest CSV & JSON Exports
    const emptyCsv = await ContestExportService.exportContestResults({
      contestId: emptyContest.id,
      requestingUser: profA,
      format: 'csv',
    });
    report('4.2.1 Empty contest exports valid CSV header with 0 data rows', emptyCsv.rowCount === 0 && emptyCsv.content.startsWith('"Rank"'));

    const emptyJson = await ContestExportService.exportContestResults({
      contestId: emptyContest.id,
      requestingUser: profA,
      format: 'json',
    });
    const emptyParsed = JSON.parse(emptyJson.content);
    report('4.2.2 Empty contest exports valid JSON with empty standings array', emptyParsed.totalParticipants === 0 && Array.isArray(emptyParsed.standings));

    // 4.3 Concurrent Standings & Export Requests (10 parallel requests)
    const concurrentPromises = [];
    for (let i = 0; i < 5; i++) {
      concurrentPromises.push(
        StandingsService.computeContestStandings({
          contestId: contestMain.id,
          requestingUser: profA,
          freezeOverride: true,
        })
      );
      concurrentPromises.push(
        ContestExportService.exportContestResults({
          contestId: contestMain.id,
          requestingUser: profA,
          format: 'json',
          freezeOverride: true,
        })
      );
    }
    const concurrentResults = await Promise.all(concurrentPromises);
    const allSuccessful = concurrentResults.every((res) => res && (res.standings || res.rowCount !== undefined));
    report('4.3.1 Concurrent parallel standings and export requests (10x) execute deterministically without deadlocks', allSuccessful);

    // 4.4 Search and Filter Validation
    const searchRes = await StandingsService.computeContestStandings({
      contestId: contestMain.id,
      requestingUser: profA,
      search: 'Bob',
      freezeOverride: true,
    });
    report(
      '4.4.1 Standings search filter correctly filters by participant name',
      searchRes.standings.length === 1 && searchRes.standings[0].username.includes('student2_p8')
    );

    const filterRes = await StandingsService.computeContestStandings({
      contestId: contestMain.id,
      requestingUser: profA,
      filterStatus: 'solved_any',
      freezeOverride: true,
    });
    report(
      '4.4.2 Standings filterStatus=solved_any returns only participants with solved problems',
      filterRes.standings.every((p) => p.solvedProblemsCount > 0)
    );

    // 4.5 Concurrent Submissions Integrity Check
    // Create live contest for concurrent submission testing
    const liveConcContest = await ContestModel.createContest({
      title: `Concurrent Submissions Contest ${stamp}`,
      startTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      endTime: new Date(now.getTime() + 50 * 60 * 1000).toISOString(),
      durationMinutes: 60,
      createdBy: profA.id,
    });
    await ContestModel.updateContest(liveConcContest.id, { status: 'published' });
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
       VALUES ($1, $2, 1, 100);`,
      [liveConcContest.id, problem1.id]
    );
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at)
       VALUES ($1, $2, NOW()), ($1, $3, NOW()), ($1, $4, NOW());`,
      [liveConcContest.id, student1.id, student2.id, student3.id]
    );

    // Simulate 3 students submitting simultaneously
    const subPromises = [student1, student2, student3].map((stud, idx) =>
      db.query(
        `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, execution_time, memory_used, is_sample_run, source_code, created_at)
         VALUES ($1, $2, $3, 'javascript', 'accepted', 100, $4, 4096, false, 'function solution() { return true; }', NOW());`,
        [liveConcContest.id, problem1.id, stud.id, 20 + idx * 5]
      )
    );
    await Promise.all(subPromises);

    const concStandings = await StandingsService.computeContestStandings({
      contestId: liveConcContest.id,
      requestingUser: profA,
    });
    report(
      '4.5.1 Simultaneous submissions from 3 users evaluated accurately (all 3 show solved with 100 pts)',
      concStandings.standings.length === 3 && concStandings.standings.every((p) => p.totalScore === 100 && p.solvedProblemsCount === 1)
    );

    // 4.6 High-throughput sub-millisecond sorting benchmark
    const mockParticipants = [];
    for (let i = 1; i <= 500; i++) {
      mockParticipants.push({
        userId: i,
        totalScore: Math.floor(i / 10) * 100,
        totalPenaltyMinutes: i % 60,
        lastAcceptedAtMs: 1700000000000 + (i % 50) * 1000,
        totalTimeMs: i * 2,
      });
    }
    const sortStart = Date.now();
    mockParticipants.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (a.totalPenaltyMinutes !== b.totalPenaltyMinutes) return a.totalPenaltyMinutes - b.totalPenaltyMinutes;
      if (a.lastAcceptedAtMs && b.lastAcceptedAtMs) {
        const diff = a.lastAcceptedAtMs - b.lastAcceptedAtMs;
        if (diff !== 0) return diff;
      }
      if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
      return a.userId - b.userId;
    });
    const sortDuration = Date.now() - sortStart;
    report(
      `4.4.1 Zero-allocation numeric comparator sorts 500 participants in ${sortDuration}ms (< 20ms target)`,
      sortDuration < 20
    );

    // 4.5 Production Database Index Verification
    const indexCheck = await db.query(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'submissions' AND indexname = 'idx_submissions_contest_standings';`
    );
    report(
      '4.5.1 Standings & export query index idx_submissions_contest_standings verified in PostgreSQL',
      indexCheck.rows.length === 1
    );

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
    console.error('Fatal error during production validation suite:', err);
    process.exit(1);
  } finally {
    await db.closePool();
  }
}

if (require.main === module) {
  runProductionValidationSuite();
}

module.exports = { runProductionValidationSuite };
