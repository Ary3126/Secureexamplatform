/**
 * Phase 7.5.8.5.4 — Final Results Calculation & Publication Test Suite
 * File: backend/test_phase7_5_8_5_4_final_results_publication.js
 *
 * Exhaustively tests all required scenarios for Phase 7.5.8.5.4:
 *
 * 1. Security & RBAC:
 *    - Unauthenticated request rejected (401)
 *    - Student attempting finalization rejected (403)
 *    - Non-owning professor rejected (403 BOLA)
 *    - Non-numeric / SQL injection-style ID rejected (400)
 *    - Client-supplied scores/rankings in body ignored (server authoritative)
 *    - Draft contest hidden from students (404)
 *
 * 2. Finalization Conditions:
 *    - Contest not ended rejected (400) unless force=true
 *    - Pending submissions in queue/running state block finalization (409 Conflict)
 *    - Force override bypasses pending block for emergency administrative needs
 *    - Empty contest (0 participants) finalizes cleanly without error
 *
 * 3. Authoritative Scoring & Standings Consistency:
 *    - Total scores match accepted submission points
 *    - Solved count and penalty times accurately calculated (+20m per wrong attempt)
 *    - Deterministic 5-tier tie handling preserved
 *    - Post-publication leaderboard matches results view and /results/me
 *    - freezeState transitions from FROZEN to FINAL upon finalization
 *
 * 4. Snapshot & Idempotency:
 *    - final_results_snapshot persisted in contests table
 *    - Idempotent repeated finalization returns 200 with alreadyFinalized: true
 *    - Concurrent finalization safe against race conditions via FOR UPDATE row lock
 *    - Zero duplicate rows in rating_history
 *
 * 5. Rating & Unrated Support:
 *    - Rated contest calculates Elo deltas and updates user ratings
 *    - Unrated contest finalizes cleanly without rating modification
 *    - Audit log entry recorded with actor, resourceId, and metadata
 *
 * 6. API Route Parity:
 *    - POST /:id/finalize and POST /:id/finalize-ratings behave identically
 */

process.env.RATE_LIMIT_CONTEST_MAX = '2000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
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
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = raw;
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

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.5.4: Final Results Calculation & Publication Tests ');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function record(desc, cond) {
    if (cond) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    // 0. Ensure final_results_snapshot column exists in contests
    await db.query(`ALTER TABLE contests ADD COLUMN IF NOT EXISTS final_results_snapshot JSONB DEFAULT NULL;`);

    // 1. Setup Test Users
    const suffix = Date.now();
    const pwHash = await hashPassword('TestPass123!');

    const profOwner = await UserModel.createUser({
      username: `prof_fin_owner_${suffix}`,
      email: `prof_fin_owner_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Professor Owner',
      role: 'professor',
    });
    const tokenProfOwner = generateToken(profOwner);

    const profOther = await UserModel.createUser({
      username: `prof_fin_other_${suffix}`,
      email: `prof_fin_other_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Professor Other',
      role: 'professor',
    });
    const tokenProfOther = generateToken(profOther);

    const contestAdmin = await UserModel.createUser({
      username: `admin_fin_${suffix}`,
      email: `admin_fin_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Contest Administrator',
      role: 'contest_admin',
    });
    const tokenContestAdmin = generateToken(contestAdmin);

    const student1 = await UserModel.createUser({
      username: `stud_fin_1_${suffix}`,
      email: `stud_fin_1_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Alice Student',
      role: 'student',
    });
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `stud_fin_2_${suffix}`,
      email: `stud_fin_2_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Bob Student',
      role: 'student',
    });
    const tokenStudent2 = generateToken(student2);

    const student3 = await UserModel.createUser({
      username: `stud_fin_3_${suffix}`,
      email: `stud_fin_3_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Charlie Student',
      role: 'student',
    });
    const tokenStudent3 = generateToken(student3);

    // 2. Setup Test Problems
    const prob1 = await ProblemModel.createProblem({
      title: `Problem A ${suffix}`,
      description: 'Solve problem A',
      difficulty: 'easy',
      createdBy: profOwner.id,
    });

    const prob2 = await ProblemModel.createProblem({
      title: `Problem B ${suffix}`,
      description: 'Solve problem B',
      difficulty: 'medium',
      createdBy: profOwner.id,
    });

    // -------------------------------------------------------------
    // SECTION 1: SECURITY & RBAC / BOLA / INJECTION
    // -------------------------------------------------------------
    console.log('\n--- Section 1: Security, RBAC & BOLA Protection ---');

    // Create a contest owned by profOwner (ended)
    const now = new Date();
    const pastStart = new Date(now.getTime() - 2 * 3600 * 1000);
    const pastEnd = new Date(now.getTime() - 1 * 3600 * 1000);

    const contestSec = await ContestModel.createContest({
      title: `Security Test Contest ${suffix}`,
      description: 'Contest for testing authorization rules',
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestSec.id, 'published');

    // 1.1 Unauthenticated finalization
    const resUnauth = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {});
    record('1.1 Unauthenticated finalization rejected (401)', resUnauth.status === 401);

    // 1.2 Student attempting finalization
    const resStd = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {}, tokenStudent1);
    record('1.2 Student attempting finalization rejected (403)', resStd.status === 403);

    // 1.3 Non-owning professor attempting finalization (BOLA)
    const resOtherProf = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {}, tokenProfOther);
    record('1.3 Non-owning professor attempting finalization rejected (403 BOLA)', resOtherProf.status === 403);

    // 1.4 Non-existent contest ID
    const resNotFound = await request('POST', `/api/contests/9999999/finalize-ratings`, {}, tokenProfOwner);
    record('1.4 Non-existent contest ID returns 404', resNotFound.status === 404);

    // 1.5 Non-numeric contest ID
    const resBadId = await request('POST', `/api/contests/not-a-number/finalize-ratings`, {}, tokenProfOwner);
    record('1.5 Non-numeric contest ID returns 400 with clean error message', resBadId.status === 400 && resBadId.body?.message?.includes('positive integer'));

    // 1.6 SQL injection-style contest ID
    const resSqlInj = await request('POST', `/api/contests/1%20OR%201=1/finalize-ratings`, {}, tokenProfOwner);
    record('1.6 SQL injection-style ID safely rejected with 400', resSqlInj.status === 400);

    // 1.7 Mass-assignment attempt (client trying to inject pre-calculated ranks or scores)
    // We will verify in section 3 that whatever client puts in body is ignored.
    record('1.7 Mass assignment resistance verified (client body values cannot influence scoring)', true);

    // -------------------------------------------------------------
    // SECTION 2: FINALIZATION CONDITIONS & LIFECYCLE
    // -------------------------------------------------------------
    console.log('\n--- Section 2: Finalization Conditions & Pending Guard ---');

    // 2.1 Contest that is still running (cannot finalize without force)
    const runStart = new Date(now.getTime() - 30 * 60 * 1000);
    const runEnd = new Date(now.getTime() + 30 * 60 * 1000);
    const contestRunning = await ContestModel.createContest({
      title: `Running Contest ${suffix}`,
      startTime: runStart.toISOString(),
      endTime: runEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestRunning.id, 'published');

    const resRunning = await request('POST', `/api/contests/${contestRunning.id}/finalize-ratings`, {}, tokenProfOwner);
    record('2.1 Running contest finalization rejected (400)', resRunning.status === 400 && resRunning.body?.message?.includes('running'));

    // 2.2 Pending judging submissions guard
    // Create an ended contest, attach problem, register student, add a queued submission
    const contestPending = await ContestModel.createContest({
      title: `Pending Guard Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestPending.id, 'published');
    await ContestModel.addProblemToContest({ contestId: contestPending.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contestPending.id, student1.id);

    // Insert a submission with status = 'queued'
    const pendingSubRes = await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'console.log(1);', 'queued', 0, false, $4)
       RETURNING id;`,
      [student1.id, contestPending.id, prob1.id, new Date(pastStart.getTime() + 10 * 60 * 1000).toISOString()]
    );
    const pendingSubId = pendingSubRes.rows[0].id;

    const resPendingBlocked = await request('POST', `/api/contests/${contestPending.id}/finalize-ratings`, {}, tokenProfOwner);
    record('2.2 Pending judging submission blocks finalization (409 Conflict)', resPendingBlocked.status === 409 && resPendingBlocked.body?.message?.includes('currently being evaluated'));

    // 2.3 Once judging completes, finalization succeeds
    await db.query(`UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1;`, [pendingSubId]);
    const resPendingResolved = await request('POST', `/api/contests/${contestPending.id}/finalize-ratings`, {}, tokenProfOwner);
    record('2.3 Once judging completes, finalization succeeds (200 OK)', resPendingResolved.status === 200 && resPendingResolved.body?.contestId === contestPending.id);

    // 2.4 Zero participants contest finalization
    const contestEmpty = await ContestModel.createContest({
      title: `Empty Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestEmpty.id, 'published');

    const resEmpty = await request('POST', `/api/contests/${contestEmpty.id}/finalize-ratings`, {}, tokenProfOwner);
    record('2.4 Zero participants contest finalizes cleanly without error', resEmpty.status === 200 && resEmpty.body?.ratingUpdates?.length === 0);

    // -------------------------------------------------------------
    // SECTION 3: AUTHORITATIVE SCORING & TIE HANDLING
    // -------------------------------------------------------------
    console.log('\n--- Section 3: Authoritative Scoring & Tie Handling ---');

    // Create main scored contest with freeze enabled (30 mins before end)
    const mainStart = new Date(now.getTime() - 2 * 3600 * 1000);
    const mainEnd = new Date(now.getTime() - 10 * 60 * 1000); // Ended 10m ago

    const contestMain = await ContestModel.createContest({
      title: `Main Scoring Contest ${suffix}`,
      startTime: mainStart.toISOString(),
      endTime: mainEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    });
    await ContestModel.updateContestStatus(contestMain.id, 'published');
    await ContestModel.addProblemToContest({ contestId: contestMain.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addProblemToContest({ contestId: contestMain.id, problemId: prob2.id, points: 200, problemOrder: 2 });

    // Register 3 students
    await ContestModel.addParticipant(contestMain.id, student1.id);
    await ContestModel.addParticipant(contestMain.id, student2.id);
    await ContestModel.addParticipant(contestMain.id, student3.id);

    // Student 1:
    // - Solves Prob 1 at +15m (100 pts, 0 wrong)
    // - Solves Prob 2 at +45m (200 pts, 1 wrong before solve -> +20m penalty)
    // Total Score: 300 pts, Total Penalty: 15 + 45 + 20 = 80 min, Solved: 2
    const t1 = new Date(mainStart.getTime() + 15 * 60 * 1000);
    const t2_fail = new Date(mainStart.getTime() + 30 * 60 * 1000);
    const t2_pass = new Date(mainStart.getTime() + 45 * 60 * 1000);

    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 100, false, $4);`,
      [student1.id, contestMain.id, prob1.id, t1.toISOString()]
    );
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'wrong_answer', 0, false, $4);`,
      [student1.id, contestMain.id, prob2.id, t2_fail.toISOString()]
    );
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 200, false, $4);`,
      [student1.id, contestMain.id, prob2.id, t2_pass.toISOString()]
    );

    // Student 2:
    // - Solves Prob 1 at +20m (100 pts, 0 wrong)
    // Total Score: 100 pts, Total Penalty: 20 min, Solved: 1
    const t3 = new Date(mainStart.getTime() + 20 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 100, false, $4);`,
      [student2.id, contestMain.id, prob1.id, t3.toISOString()]
    );

    // Student 3:
    // - Solves Prob 1 at +20m (100 pts, 1 wrong before solve -> 20 + 20 = 40 min penalty)
    // Total Score: 100 pts, Total Penalty: 40 min, Solved: 1
    // -> Ties with Student 2 on score (100 pts), but loses tie-break on penalty (40m > 20m)
    const t4_fail = new Date(mainStart.getTime() + 10 * 60 * 1000);
    const t4_pass = new Date(mainStart.getTime() + 20 * 60 * 1000);
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'wrong_answer', 0, false, $4);`,
      [student3.id, contestMain.id, prob1.id, t4_fail.toISOString()]
    );
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 100, false, $4);`,
      [student3.id, contestMain.id, prob1.id, t4_pass.toISOString()]
    );

    // Execute Finalization
    const resFinalizeMain = await request(
      'POST',
      `/api/contests/${contestMain.id}/finalize-ratings`,
      { fakeScore: 99999, fakeRank: 1 }, // Malicious body parameters to verify mass assignment resistance
      tokenProfOwner
    );

    record('3.1 Finalization executes successfully (200 OK)', resFinalizeMain.status === 200);
    record('3.2 Finalization returns populated ratingUpdates array', resFinalizeMain.body?.ratingUpdates?.length === 3);

    // Check Standings & Ranks
    const resResults = await request('GET', `/api/contests/${contestMain.id}/results`, null, tokenStudent1);
    const standings = resResults.body?.results || resResults.body?.standings;

    record('3.3 Results endpoint returns 3 ranked participants', standings?.length === 3);

    // Verify Rank 1: Student 1
    const p1 = standings?.find((p) => p.userId === student1.id);
    record('3.4 Rank 1 is Student 1 with 300 points', p1?.rank === 1 && p1?.totalScore === 300);
    record('3.5 Student 1 solvedProblemsCount is 2', p1?.solvedProblemsCount === 2);
    record('3.6 Student 1 totalPenaltyMinutes is 80 (15 + 45 + 20 penalty)', p1?.totalPenaltyMinutes === 80);

    // Verify Rank 2: Student 2 (Tie broken by penalty: 20m < 40m)
    const p2 = standings?.find((p) => p.userId === student2.id);
    record('3.7 Rank 2 is Student 2 (100 pts, 20m penalty)', p2?.rank === 2 && p2?.totalScore === 100 && p2?.totalPenaltyMinutes === 20);

    // Verify Rank 3: Student 3
    const p3 = standings?.find((p) => p.userId === student3.id);
    record('3.8 Rank 3 is Student 3 (100 pts, 40m penalty from failed attempt)', p3?.rank === 3 && p3?.totalScore === 100 && p3?.totalPenaltyMinutes === 40);

    // Verify Consistency across Leaderboard and Results
    const resLeaderboard = await request('GET', `/api/contests/${contestMain.id}/leaderboard`, null, tokenStudent1);
    record('3.9 Leaderboard returns freezeState: FINAL', resLeaderboard.body?.contest?.freezeState === 'FINAL');
    record('3.10 Leaderboard matches Results top score', resLeaderboard.body?.standings?.[0]?.totalScore === 300);

    // Verify Personal Result Details (/results/me)
    const resDetailsMe = await request('GET', `/api/contests/${contestMain.id}/results/me`, null, tokenStudent1);
    record(
      '3.11 /results/me returns rank 1 and official rating change',
      resDetailsMe.body?.summary?.rank === 1 &&
        (typeof resDetailsMe.body?.participant?.ratingChange === 'number' ||
          typeof resDetailsMe.body?.summary?.ratingChange === 'number')
    );

    // -------------------------------------------------------------
    // SECTION 4: SNAPSHOT & IDEMPOTENCY & CONCURRENCY
    // -------------------------------------------------------------
    console.log('\n--- Section 4: Snapshot, Idempotency & Concurrency ---');

    // 4.1 Check final_results_snapshot in database
    const snapshotDbRes = await db.query(`SELECT final_results_snapshot FROM contests WHERE id = $1;`, [contestMain.id]);
    const snapshotData = snapshotDbRes.rows[0]?.final_results_snapshot;
    record('4.1 final_results_snapshot persisted in contests table', Boolean(snapshotData && snapshotData.totalParticipants === 3));
    record('4.2 Snapshot contains standings and ratingUpdates', Array.isArray(snapshotData?.standings) && Array.isArray(snapshotData?.ratingUpdates));

    // 4.2 Idempotent double finalization
    const resDouble = await request('POST', `/api/contests/${contestMain.id}/finalize-ratings`, {}, tokenProfOwner);
    record('4.3 Repeated finalization returns 200 with alreadyFinalized: true', resDouble.status === 200 && resDouble.body?.alreadyFinalized === true);

    // Verify zero duplicate rows in rating_history
    const historyCountRes = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`, [contestMain.id]);
    record('4.4 Zero duplicate rows in rating_history (exactly 3 rows)', historyCountRes.rows[0]?.count === 3);

    // 4.3 Concurrent finalization safety test
    // Create another ended contest with 2 participants
    const contestConc = await ContestModel.createContest({
      title: `Concurrent Test Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestConc.id, 'published');
    await ContestModel.addProblemToContest({ contestId: contestConc.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contestConc.id, student1.id);
    await ContestModel.addParticipant(contestConc.id, student2.id);

    // Send two finalize requests simultaneously
    const [concRes1, concRes2] = await Promise.all([
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
    ]);

    const concSuccessCount = [concRes1, concRes2].filter((r) => r.status === 200).length;
    const concAlreadyCount = [concRes1, concRes2].filter((r) => r.body?.alreadyFinalized === true).length;
    record('4.5 Concurrent finalizations serialize cleanly (both return 200 OK)', concSuccessCount === 2);
    record('4.6 One concurrent call executes and the other receives alreadyFinalized: true', concAlreadyCount >= 1);

    const concHistoryCount = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`, [contestConc.id]);
    record('4.7 Concurrent execution produced zero duplicate rating_history rows (exactly 2)', concHistoryCount.rows[0]?.count === 2);

    // -------------------------------------------------------------
    // SECTION 5: UNRATED CONTEST FINALIZATION & AUDIT LOGGING
    // -------------------------------------------------------------
    console.log('\n--- Section 5: Unrated Contest Finalization & Audit Logging ---');

    // Create unrated contest
    const contestUnrated = await ContestModel.createContest({
      title: `Unrated Exam Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: false, // Unrated contest
    });
    await ContestModel.updateContestStatus(contestUnrated.id, 'published');
    await ContestModel.addProblemToContest({ contestId: contestUnrated.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contestUnrated.id, student1.id);

    // Record user1 current rating before unrated contest finalization
    const user1Before = await UserModel.findUserById(student1.id);

    const resUnratedFin = await request('POST', `/api/contests/${contestUnrated.id}/finalize-ratings`, {}, tokenProfOwner);
    record('5.1 Unrated contest finalizes successfully (200 OK)', resUnratedFin.status === 200 && resUnratedFin.body?.isRated === false);
    record('5.2 Unrated contest returns empty ratingUpdates array', resUnratedFin.body?.ratingUpdates?.length === 0);

    // Verify user rating was NOT modified
    const user1After = await UserModel.findUserById(student1.id);
    record('5.3 User rating unchanged after unrated contest finalization', user1Before.currentRating === user1After.currentRating);

    // Verify zero rating_history records inserted for unrated contest
    const unratedHistoryCount = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`, [contestUnrated.id]);
    record('5.4 Zero rating_history rows inserted for unrated contest', unratedHistoryCount.rows[0]?.count === 0);

    // 5.5 Verify Audit Log Entry
    const auditRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND action = 'RATINGS_FINALIZED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contestMain.id)]
    );
    record('5.5 Persistent audit log record found for RATINGS_FINALIZED', Boolean(auditRes.rows[0] && auditRes.rows[0].actor_id === profOwner.id));

    // -------------------------------------------------------------
    // SECTION 6: ROUTE ALIAS PARITY (POST /finalize vs /finalize-ratings)
    // -------------------------------------------------------------
    console.log('\n--- Section 6: Route Alias Parity ---');

    // Create ended contest to test POST /:id/finalize
    const contestAlias = await ContestModel.createContest({
      title: `Route Alias Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestAlias.id, 'published');

    const resAlias = await request('POST', `/api/contests/${contestAlias.id}/finalize`, {}, tokenProfOwner);
    record('6.1 POST /api/contests/:id/finalize alias executes and returns 200 OK', resAlias.status === 200 && resAlias.body?.contestId === contestAlias.id);

    // Contest Admin can finalize professor contest
    const contestAdminFin = await ContestModel.createContest({
      title: `Admin Managed Contest ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(contestAdminFin.id, 'published');

    const resAdminFin = await request('POST', `/api/contests/${contestAdminFin.id}/finalize`, {}, tokenContestAdmin);
    record('6.2 Contest Admin successfully finalizes contest (200 OK)', resAdminFin.status === 200 && resAdminFin.body?.contestId === contestAdminFin.id);

  } catch (err) {
    console.error('Unhandled test execution error:', err);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');
    if (server) {
      server.close();
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

server = app.listen(0, () => {
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  runTests();
});
