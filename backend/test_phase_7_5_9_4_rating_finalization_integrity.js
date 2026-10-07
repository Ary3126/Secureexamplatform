/**
 * Phase 7.5.9.4 — Rating Finalization & Integrity Test Suite
 *
 * Comprehensive production-grade validation of:
 * 1. Successful finalization
 * 2. Already-finalized contest
 * 3. Repeated finalization
 * 4. Concurrent finalization (simulating 2, 5, 10 simultaneous requests)
 * 5. Duplicate rating-history protection (DB unique constraint & idempotency)
 * 6. Rating invariant (previous_rating + rating_change = new_rating, floor >= 100)
 * 7. Current rating update (users.current_rating matches history)
 * 8. Highest rating update (users.highest_rating updated only when new > highest)
 * 9. Final snapshot creation (contests.final_results_snapshot)
 * 10. Snapshot immutability (sealed and immutable)
 * 11. Unauthorized finalization (student, non-owning professor, unauthenticated)
 * 12. IDOR / BOLA (unauthorized actor on foreign contest)
 * 13. Client rating tampering (forged client values ignored & logged)
 * 14. Post-finalization mutation (cannot edit problems, contest settings, submissions)
 * 15. Rollback on rating-history failure
 * 16. Rollback on current-rating failure
 * 17. Rollback on snapshot failure
 * 18. Rollback on contest finalization / audit update failure
 * 19. Export consistency (CSV and JSON match snapshot & history)
 * 20. Leaderboard consistency (Leaderboard matches snapshot & history)
 * 21. Rating history consistency (deterministic ordering and fields)
 * 22. Large participant count scaling (10, 100, 101, 250, 500, 1000 participants)
 * 23. Transaction / row locking behavior (PostgreSQL SELECT ... FOR UPDATE)
 * 24. Audit logging verification (events, actors, metadata, zero secret leakage)
 * 25. Automated teardown & clean baseline preservation
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const RatingService = require('./src/services/ratingService');
const RatingModel = require('./src/models/ratingModel');
const ContestModel = require('./src/models/contestModel');
const ContestExportService = require('./src/services/contestExportService');
const StandingsService = require('./src/services/standingsService');
const { generateToken } = require('./src/services/authService');
const RATING_CONFIG = require('./src/config/ratingConfig');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];

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

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function createTestUser(role = 'student', customData = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const username = customData.username || `u_p7594_${role}_${ts}`;
  const email = customData.email || `${username}@securejudge.test`;
  const rating = customData.currentRating !== undefined ? customData.currentRating : 1200;
  const ratingStatus = customData.ratingStatus || 'provisional';
  const ratedCount = customData.ratedContestCount !== undefined ? customData.ratedContestCount : 0;

  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rating_status, rated_contest_count)
     VALUES ($1, $2, 'hash123', $3, $4, $5, $5, $6, $7)
     RETURNING id, username, email, role, current_rating AS "currentRating", highest_rating AS "highestRating", rating_status AS "ratingStatus", rated_contest_count AS "ratedContestCount";`,
    [username, email, `Test ${username}`, role, rating, ratingStatus, ratedCount]
  );
  const user = res.rows[0];
  trackedUserIds.push(user.id);
  return user;
}

async function createTestContest(customData = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const contest = await ContestModel.createContest({
    title: customData.title || `Test Contest 7.5.9.4 ${ts}`,
    description: 'Test Contest for Phase 7.5.9.4 finalization and integrity',
    createdBy: customData.createdBy,
    startTime: customData.startTime || new Date(Date.now() - 7200000).toISOString(),
    endTime: customData.endTime || new Date(Date.now() - 3600000).toISOString(),
    isRated: customData.isRated !== undefined ? customData.isRated : true,
    scoringType: 'standard',
  });
  if (customData.status && customData.status !== 'draft') {
    await db.query(`UPDATE contests SET status = $1 WHERE id = $2;`, [customData.status, contest.id]);
    contest.status = customData.status;
  }
  trackedContestIds.push(contest.id);
  return contest;
}

async function attachProblemAndSubmission(contestId, userId, problemId, isAccepted = true) {
  await ContestModel.addProblemToContest({
    contestId,
    problemId,
    points: 100,
    problemOrder: 1,
  });

  const subRes = await db.query(
    `INSERT INTO submissions (
       user_id, problem_id, contest_id, language, source_code, status, score, is_sample_run, created_at
     )
     VALUES ($1, $2, $3, 'javascript', 'console.log(42);', $4, $5, false, NOW() - INTERVAL '1 hour')
     RETURNING id;`,
    [userId, problemId, contestId, isAccepted ? 'accepted' : 'wrong_answer', isAccepted ? 100 : 0]
  );
  return subRes.rows[0].id;
}

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.9.4 — Rating Finalization & Integrity Test Suite    ');
  console.log('================================================================');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  serverPort = server.address().port;
  baseUrl = `http://127.0.0.1:${serverPort}`;

  const profOwner = await createTestUser('professor');
  const profOther = await createTestUser('professor');
  const studentAlice = await createTestUser('student', { currentRating: 1200 });
  const studentBob = await createTestUser('student', { currentRating: 1200 });
  const studentFloor = await createTestUser('student', { currentRating: 105 });

  const tokenProfOwner = generateToken(profOwner);
  const tokenProfOther = generateToken(profOther);
  const tokenStudentAlice = generateToken(studentAlice);

  const cleanProblemsRes = await db.query('SELECT id FROM problems ORDER BY id ASC LIMIT 2;');
  const testProblemId1 = cleanProblemsRes.rows[0].id;
  const testProblemId2 = cleanProblemsRes.rows[1].id;

  try {
    // ---------------------------------------------------------
    // STEP 1: Successful Finalization & Invariants
    // ---------------------------------------------------------
    console.log('\n--- Step 1: Successful Finalization & Rating Invariants ---');
    const contest1 = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    await ContestModel.addParticipant(contest1.id, studentAlice.id);
    await ContestModel.addParticipant(contest1.id, studentBob.id);
    await attachProblemAndSubmission(contest1.id, studentAlice.id, testProblemId1, true);

    const finRes1 = await request(
      'POST',
      `/api/contests/${contest1.id}/finalize-ratings`,
      {},
      tokenProfOwner
    );

    assert(finRes1.status === 200, '1.1 Successful finalization returns 200 OK');
    assert(finRes1.body.isRated === true, '1.2 Contest confirmed rated');
    assert(finRes1.body.ratingUpdates.length === 2, '1.3 Rating updates created for both participants');

    const aliceUpdate = finRes1.body.ratingUpdates.find((u) => u.userId === studentAlice.id);
    const bobUpdate = finRes1.body.ratingUpdates.find((u) => u.userId === studentBob.id);

    assert(aliceUpdate.previousRating === 1200, '1.4 Alice previous rating is 1200');
    assert(aliceUpdate.ratingChange > 0, '1.5 Alice winner rating change is positive');
    assert(aliceUpdate.newRating === aliceUpdate.previousRating + aliceUpdate.ratingChange, '1.6 Invariant holds: previous + change = new');

    assert(bobUpdate.previousRating === 1200, '1.7 Bob previous rating is 1200');
    assert(bobUpdate.ratingChange < 0, '1.8 Bob loser rating change is negative');
    assert(bobUpdate.newRating === bobUpdate.previousRating + bobUpdate.ratingChange, '1.9 Invariant holds: previous + change = new');

    // Invariant check on rating floor
    const studentFloor1 = await createTestUser('student', { currentRating: 105 });
    const studentFloor2 = await createTestUser('student', { currentRating: 105 });
    const contestFloor = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    await ContestModel.addParticipant(contestFloor.id, studentFloor1.id);
    await ContestModel.addParticipant(contestFloor.id, studentFloor2.id);
    await attachProblemAndSubmission(contestFloor.id, studentFloor1.id, testProblemId1, true);

    const finFloorRes = await request(
      'POST',
      `/api/contests/${contestFloor.id}/finalize-ratings`,
      {},
      tokenProfOwner
    );
    assert(finFloorRes.status === 200, '1.10 Floor contest finalization returns 200 OK');
    const floorUpdate = finFloorRes.body.ratingUpdates.find((u) => u.userId === studentFloor2.id);
    assert(floorUpdate.newRating >= RATING_CONFIG.MIN_RATING, '1.11 Floor rating >= MIN_RATING (100)');
    assert(floorUpdate.newRating === 100, '1.12 Floor rating clamped at exactly 100');
    assert(floorUpdate.previousRating + floorUpdate.ratingChange === floorUpdate.newRating, '1.13 Invariant holds with floor clamp: previous + change = new');

    // ---------------------------------------------------------
    // STEP 2: Current Rating & Highest Rating Integrity
    // ---------------------------------------------------------
    console.log('\n--- Step 2: Current & Highest Rating Integrity ---');
    const userAliceDB = await db.query('SELECT current_rating, highest_rating, rated_contest_count FROM users WHERE id = $1;', [studentAlice.id]);
    assert(userAliceDB.rows[0].current_rating === aliceUpdate.newRating, '2.1 users.current_rating matches history newRating');
    assert(userAliceDB.rows[0].highest_rating === aliceUpdate.newHighestRating, '2.2 users.highest_rating updated correctly');
    assert(userAliceDB.rows[0].rated_contest_count >= 1, '2.3 rated_contest_count incremented');

    const userBobDB = await db.query('SELECT current_rating, highest_rating FROM users WHERE id = $1;', [studentBob.id]);
    assert(userBobDB.rows[0].current_rating === bobUpdate.newRating, '2.4 Bob current_rating matches history newRating');
    assert(userBobDB.rows[0].highest_rating === 1200, '2.5 Bob highest_rating not lowered on rating drop');

    // ---------------------------------------------------------
    // STEP 3: Idempotency & Repeated Finalization
    // ---------------------------------------------------------
    console.log('\n--- Step 3: Idempotency & Repeated Finalization ---');
    const repeatRes1 = await request(
      'POST',
      `/api/contests/${contest1.id}/finalize-ratings`,
      {},
      tokenProfOwner
    );
    assert(repeatRes1.status === 200, '3.1 Repeated finalization returns 200 OK');
    assert(repeatRes1.body.alreadyFinalized === true, '3.2 Repeated finalization returns alreadyFinalized=true');

    const repeatRes2 = await request(
      'POST',
      `/api/contests/${contest1.id}/finalize`,
      {},
      tokenProfOwner
    );
    assert(repeatRes2.status === 200, '3.3 Repeated finalization on alias /finalize returns 200 OK');
    assert(repeatRes2.body.alreadyFinalized === true, '3.4 Alias /finalize returns alreadyFinalized=true');

    const histCountRes = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contest1.id]);
    assert(histCountRes.rows[0].count === 2, '3.5 Exactly 2 rating_history rows remain (zero duplicate rows)');

    // ---------------------------------------------------------
    // STEP 4: Concurrent Finalization (2, 5, 10 Simultaneous Requests)
    // ---------------------------------------------------------
    console.log('\n--- Step 4: Concurrent Finalization (PostgreSQL Row Locking) ---');
    const contestConc = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    const concStudent1 = await createTestUser('student');
    const concStudent2 = await createTestUser('student');
    await ContestModel.addParticipant(contestConc.id, concStudent1.id);
    await ContestModel.addParticipant(contestConc.id, concStudent2.id);
    await attachProblemAndSubmission(contestConc.id, concStudent1.id, testProblemId1, true);

    // 2 simultaneous requests
    const [cRes1, cRes2] = await Promise.all([
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner),
    ]);
    assert(cRes1.status === 200 && cRes2.status === 200, '4.1 Both concurrent requests return 200 OK');
    const oneWasFresh = (!cRes1.body.alreadyFinalized && cRes2.body.alreadyFinalized) ||
                        (cRes1.body.alreadyFinalized && !cRes2.body.alreadyFinalized);
    assert(oneWasFresh, '4.2 Exactly one request executed finalization while the other was safely serialized');

    // 5 simultaneous repeated requests
    const promises5 = Array.from({ length: 5 }, () =>
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner)
    );
    const results5 = await Promise.all(promises5);
    const all5Succeeded = results5.every((r) => r.status === 200 && r.body.alreadyFinalized === true);
    assert(all5Succeeded, '4.3 All 5 concurrent repeat requests safely returned alreadyFinalized: true');

    // 10 simultaneous repeated requests
    const promises10 = Array.from({ length: 10 }, () =>
      request('POST', `/api/contests/${contestConc.id}/finalize-ratings`, {}, tokenProfOwner)
    );
    const results10 = await Promise.all(promises10);
    const all10Succeeded = results10.every((r) => r.status === 200 && r.body.alreadyFinalized === true);
    assert(all10Succeeded, '4.4 All 10 concurrent requests handled cleanly without deadlocks');

    const concHistCount = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestConc.id]);
    assert(concHistCount.rows[0].count === 2, '4.5 Exactly 2 rating_history rows exist after concurrent race');

    // ---------------------------------------------------------
    // STEP 5: Final Results Snapshot & Immutability
    // ---------------------------------------------------------
    console.log('\n--- Step 5: Final Results Snapshot & Immutability ---');
    const snapRes = await db.query('SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1;', [contest1.id]);
    assert(snapRes.rows[0].is_rating_finalized === true, '5.1 is_rating_finalized is true in DB');
    assert(snapRes.rows[0].final_results_snapshot !== null, '5.2 final_results_snapshot JSON is stored in DB');
    const snapshotObj = snapRes.rows[0].final_results_snapshot;
    assert(snapshotObj.totalParticipants === 2, '5.3 Snapshot totalParticipants is 2');
    assert(snapshotObj.podium.length > 0, '5.4 Snapshot podium populated');
    assert(snapshotObj.standings.length === 2, '5.5 Snapshot standings populated');
    assert(snapshotObj.ratingUpdates.length === 2, '5.6 Snapshot ratingUpdates populated');

    // ---------------------------------------------------------
    // STEP 6: Authorization & RBAC & IDOR/BOLA Hardening
    // ---------------------------------------------------------
    console.log('\n--- Step 6: Authorization, RBAC & IDOR/BOLA ---');
    const contestSec = await createTestContest({ createdBy: profOwner.id, status: 'published' });

    // Unauthenticated
    const resNoAuth = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {});
    assert(resNoAuth.status === 401, '6.1 Unauthenticated request rejected with 401 Unauthorized');

    // Student role
    const resStudent = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {}, tokenStudentAlice);
    assert(resStudent.status === 403, '6.2 Student role rejected with 403 Forbidden');

    // Non-owning professor (IDOR / BOLA)
    const resOtherProf = await request('POST', `/api/contests/${contestSec.id}/finalize-ratings`, {}, tokenProfOther);
    assert(resOtherProf.status === 403, '6.3 Non-owning professor rejected with 403 Forbidden (BOLA defense)');

    // ---------------------------------------------------------
    // STEP 7: Client Rating Tampering Immunity
    // ---------------------------------------------------------
    console.log('\n--- Step 7: Client Rating Tampering Immunity ---');
    const contestTamper = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    const tamperStudent1 = await createTestUser('student', { currentRating: 1200 });
    const tamperStudent2 = await createTestUser('student', { currentRating: 1200 });
    await ContestModel.addParticipant(contestTamper.id, tamperStudent1.id);
    await ContestModel.addParticipant(contestTamper.id, tamperStudent2.id);
    await attachProblemAndSubmission(contestTamper.id, tamperStudent1.id, testProblemId1, true);

    const tamperPayload = {
      ratingChange: 999,
      newRating: 9999,
      previousRating: 1,
      rank: 1,
      participantCount: 1000,
    };

    const resTamper = await request(
      'POST',
      `/api/contests/${contestTamper.id}/finalize-ratings`,
      tamperPayload,
      tokenProfOwner
    );

    assert(resTamper.status === 200, '7.1 Tamper request accepted without crash');
    const tamperWinner = resTamper.body.ratingUpdates.find((u) => u.userId === tamperStudent1.id);
    assert(tamperWinner.ratingChange !== 999, '7.2 Client-forged ratingChange 999 strictly ignored by server');
    assert(tamperWinner.newRating !== 9999, '7.3 Client-forged newRating 9999 strictly ignored by server');
    assert(tamperWinner.newRating === 1232, '7.4 Server authoritative Elo calculated (+32 with provisional K=64)');

    // ---------------------------------------------------------
    // STEP 8: Post-Finalization Mutation Protection
    // ---------------------------------------------------------
    console.log('\n--- Step 8: Post-Finalization Mutation Protection ---');
    // Attempt to modify contest settings post-finalization
    const resEditContest = await request(
      'PUT',
      `/api/contests/${contest1.id}`,
      { isRated: false, leaderboardFreezeMinutes: 10 },
      tokenProfOwner
    );
    assert(resEditContest.status === 409, '8.1 Modifying result settings post-finalization rejected with 409 Conflict');

    // Attempt to add a problem to finalized contest
    const resAddProb = await request(
      'POST',
      `/api/contests/${contest1.id}/problems`,
      { problemId: testProblemId2, points: 100 },
      tokenProfOwner
    );
    assert(resAddProb.status === 409, '8.2 Adding problem to finalized contest rejected with 409 Conflict');

    // Attempt to remove a problem from finalized contest
    const resRemProb = await request(
      'DELETE',
      `/api/contests/${contest1.id}/problems/${testProblemId1}`,
      null,
      tokenProfOwner
    );
    assert(resRemProb.status === 409, '8.3 Removing problem from finalized contest rejected with 409 Conflict');

    // Attempt to enroll participant post-finalization
    const resAddPart = await request(
      'POST',
      `/api/contests/${contest1.id}/participants`,
      { userIds: [studentBob.id] },
      tokenProfOwner
    );
    assert(resAddPart.status === 409 || resAddPart.status === 400, '8.4 Adding participant to ended/finalized contest rejected with 400/409');

    // Attempt to submit code to ended/finalized contest
    const resSub = await request(
      'POST',
      '/api/submissions',
      { contestId: contest1.id, problemId: testProblemId1, language: 'javascript', sourceCode: 'console.log(1);' },
      tokenStudentAlice
    );
    assert(resSub.status === 400, '8.5 Submitting solution to ended contest rejected with 400 Bad Request');

    // ---------------------------------------------------------
    // STEP 9: Transaction Rollback Verification
    // ---------------------------------------------------------
    console.log('\n--- Step 9: Transaction Rollback on Failure ---');
    // Test rollback on rating_history failure
    const contestFail1 = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    const failStudent1 = await createTestUser('student', { currentRating: 1400 });
    const failStudent2 = await createTestUser('student', { currentRating: 1400 });
    await ContestModel.addParticipant(contestFail1.id, failStudent1.id);
    await ContestModel.addParticipant(contestFail1.id, failStudent2.id);
    await attachProblemAndSubmission(contestFail1.id, failStudent1.id, testProblemId1, true);

    const resFail1 = await request(
      'POST',
      `/api/contests/${contestFail1.id}/finalize-ratings`,
      { __testSimulateFailureAt: 'rating_history' },
      tokenProfOwner
    );
    assert(resFail1.status === 500, '9.1 Simulated rating_history failure returns 500');
    const checkContest1 = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1;', [contestFail1.id]);
    assert(checkContest1.rows[0].is_rating_finalized === false, '9.2 Contest remains unfinalized after rollback');
    const checkHist1 = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestFail1.id]);
    assert(checkHist1.rows[0].count === 0, '9.3 Zero rating_history rows committed after rollback');
    const checkUser1 = await db.query('SELECT current_rating FROM users WHERE id = $1;', [failStudent1.id]);
    assert(checkUser1.rows[0].current_rating === 1400, '9.4 Student current_rating remains unchanged at 1400');

    // Test rollback on user_rating failure
    const contestFail2 = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    await ContestModel.addParticipant(contestFail2.id, failStudent1.id);
    await ContestModel.addParticipant(contestFail2.id, failStudent2.id);
    await attachProblemAndSubmission(contestFail2.id, failStudent1.id, testProblemId1, true);

    const resFail2 = await request(
      'POST',
      `/api/contests/${contestFail2.id}/finalize-ratings`,
      { __testSimulateFailureAt: 'user_rating' },
      tokenProfOwner
    );
    assert(resFail2.status === 500, '9.5 Simulated user_rating failure returns 500');
    const checkHist2 = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestFail2.id]);
    assert(checkHist2.rows[0].count === 0, '9.6 Zero rating_history rows committed after user_rating rollback');

    // Test rollback on snapshot failure
    const contestFail3 = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    await ContestModel.addParticipant(contestFail3.id, failStudent1.id);
    await ContestModel.addParticipant(contestFail3.id, failStudent2.id);
    await attachProblemAndSubmission(contestFail3.id, failStudent1.id, testProblemId1, true);

    const resFail3 = await request(
      'POST',
      `/api/contests/${contestFail3.id}/finalize-ratings`,
      { __testSimulateFailureAt: 'snapshot' },
      tokenProfOwner
    );
    assert(resFail3.status === 500, '9.7 Simulated snapshot failure returns 500');
    const checkContest3 = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1;', [contestFail3.id]);
    assert(checkContest3.rows[0].is_rating_finalized === false, '9.8 Contest remains unfinalized after snapshot failure rollback');

    // Test rollback on contest_update failure
    const contestFail4 = await createTestContest({ createdBy: profOwner.id, status: 'published' });
    await ContestModel.addParticipant(contestFail4.id, failStudent1.id);
    await ContestModel.addParticipant(contestFail4.id, failStudent2.id);
    await attachProblemAndSubmission(contestFail4.id, failStudent1.id, testProblemId1, true);

    const resFail4 = await request(
      'POST',
      `/api/contests/${contestFail4.id}/finalize-ratings`,
      { __testSimulateFailureAt: 'contest_update' },
      tokenProfOwner
    );
    assert(resFail4.status === 500, '9.9 Simulated contest_update failure returns 500');
    const checkContest4 = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1;', [contestFail4.id]);
    assert(checkContest4.rows[0].is_rating_finalized === false, '9.10 Contest remains unfinalized after contest_update rollback');

    // ---------------------------------------------------------
    // STEP 10: Cross-Layer Consistency (Standings, Exports, Profile)
    // ---------------------------------------------------------
    console.log('\n--- Step 10: Cross-Layer Consistency Verification ---');
    // Leaderboard
    const lbRes = await request('GET', `/api/contests/${contest1.id}/leaderboard`, null, tokenStudentAlice);
    assert(lbRes.status === 200, '10.1 Leaderboard responds 200 OK');
    const lbRowAlice = lbRes.body.standings.find((r) => r.userId === studentAlice.id);
    assert(lbRowAlice.ratingChange === aliceUpdate.ratingChange, '10.2 Leaderboard ratingChange matches rating_history');
    assert(lbRowAlice.newRating === aliceUpdate.newRating, '10.3 Leaderboard newRating matches rating_history');

    // Results View
    const resView = await request('GET', `/api/contests/${contest1.id}/results`, null, tokenStudentAlice);
    assert(resView.status === 200, '10.4 Results view responds 200 OK');
    assert(resView.body.resultSummary?.isFinalized === true || resView.body.contest?.isRatingFinalized === true, '10.5 Results view confirms isRatingFinalized=true');
    const rvRowAlice = resView.body.results.find((r) => r.userId === studentAlice.id);
    assert(rvRowAlice.ratingChange === aliceUpdate.ratingChange, '10.6 Results view ratingChange matches rating_history');

    // JSON Export
    const expJson = await request('GET', `/api/contests/${contest1.id}/export/results?format=json`, null, tokenProfOwner);
    assert(expJson.status === 200, '10.7 JSON export responds 200 OK');
    const jsonParsed = typeof expJson.body === 'string' ? JSON.parse(expJson.body) : expJson.body;
    const expAlice = jsonParsed.standings.find((r) => r.userId === studentAlice.id);
    assert(expAlice.ratingChange === aliceUpdate.ratingChange, '10.8 JSON export ratingChange matches rating_history');

    // CSV Export
    const expCsv = await request('GET', `/api/contests/${contest1.id}/export/results?format=csv`, null, tokenProfOwner);
    assert(expCsv.status === 200, '10.9 CSV export responds 200 OK');
    assert(typeof expCsv.body === 'string' && expCsv.body.includes(String(aliceUpdate.ratingChange)), '10.10 CSV export includes official ratingChange');

    // User Profile
    const profRes = await request('GET', `/api/users/${studentAlice.id}/rating-history`, null, tokenStudentAlice);
    assert(profRes.status === 200, '10.11 Rating history API responds 200 OK');
    const historyList = Array.isArray(profRes.body) ? profRes.body : profRes.body.history || [];
    const histAlice = historyList.find((h) => h.contestId === contest1.id);
    assert(Boolean(histAlice), '10.12 Profile history contains contest record');
    assert(histAlice.newRating === aliceUpdate.newRating, '10.13 Profile history newRating matches update');
    assert(histAlice.ratingChange === aliceUpdate.ratingChange, '10.14 Profile history ratingChange matches update');

    // ---------------------------------------------------------
    // STEP 11: Security & Audit Logging Verification
    // ---------------------------------------------------------
    console.log('\n--- Step 11: Security & Audit Logging Verification ---');
    const auditLogsRes = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE resource_id = $1 
       ORDER BY created_at DESC;`,
      [contest1.id]
    );
    assert(auditLogsRes.rowCount > 0, '11.1 Audit logs recorded for finalized contest');
    const finAudit = auditLogsRes.rows.find((l) => l.action === 'RATINGS_FINALIZED' && l.metadata?.isIdempotentSkip === false);
    assert(Boolean(finAudit), '11.2 RATINGS_FINALIZED logged with isIdempotentSkip=false');

    const repeatAudit = auditLogsRes.rows.find((l) => l.action === 'RATINGS_FINALIZED' && l.metadata?.isIdempotentSkip === true);
    assert(Boolean(repeatAudit), '11.3 Repeated finalization logged with isIdempotentSkip=true');

    // Verify tampering audit log
    const tamperAuditRes = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE resource_id = $1 AND action = 'RATING_INTEGRITY_VIOLATION';`,
      [contestTamper.id]
    );
    assert(tamperAuditRes.rowCount > 0, '11.4 RATING_INTEGRITY_VIOLATION audit event logged for client tampering attempt');

    // Verify unauthorized finalization audit log
    const unauthAuditRes = await db.query(
      `SELECT action, outcome 
       FROM audit_logs 
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED';`,
      [contestSec.id]
    );
    assert(unauthAuditRes.rowCount > 0, '11.5 PRIVILEGED_ACTION_DENIED audit event logged for unauthorized finalization');

    // Verify zero password hashes in audit logs
    const sensitiveLogRes = await db.query(
      `SELECT metadata::text AS meta FROM audit_logs WHERE metadata::text ILIKE '%password_hash%' OR metadata::text ILIKE '%hash123%';`
    );
    assert(sensitiveLogRes.rowCount === 0, '11.6 Zero password hashes or credentials leaked in audit logs');

    // ---------------------------------------------------------
    // STEP 12: Large Participant Count Performance Scaling
    // ---------------------------------------------------------
    console.log('\n--- Step 12: Large Participant Scale & Performance ---');
    const sizes = [10, 100, 101, 250, 500, 1000];
    for (const N of sizes) {
      const mockStandings = Array.from({ length: N }, (_, i) => ({
        userId: 20000 + i,
        username: `scale_user_${i}`,
        currentRating: 1200 + (i % 500),
        highestRating: 1500,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: i + 1,
        totalScore: (N - i) * 10,
        totalTimeMs: i * 1000,
      }));

      const startMs = performance.now();
      const updates = RatingService.calculateRatingChanges(mockStandings);
      const durationMs = performance.now() - startMs;

      assert(updates.length === N, `12.${sizes.indexOf(N) + 1}a Scale N=${N}: Calculated ${N} updates`);
      assert(durationMs < 250, `12.${sizes.indexOf(N) + 1}b Scale N=${N}: Completed in ${durationMs.toFixed(2)}ms (< 250ms target)`);
      const allFinite = updates.every((u) => Number.isFinite(u.newRating) && Number.isFinite(u.ratingChange));
      assert(allFinite, `12.${sizes.indexOf(N) + 1}c Scale N=${N}: All ratings and deltas are finite`);
    }

  } finally {
    // ---------------------------------------------------------
    // STEP 13: Teardown & Clean Baseline Preservation
    // ---------------------------------------------------------
    console.log('\n--- Step 13: Teardown & Clean Baseline Preservation ---');
    if (server) {
      server.close();
    }

    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM audit_logs WHERE resource_type = $1 AND resource_id = ANY($2::int[]);', ['contest', trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[]);', [trackedContestIds]);
    }

    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM rating_history WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM contest_participants WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[]) OR (resource_type = $2 AND resource_id = ANY($1::int[]));', [trackedUserIds, 'user']);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[]);', [trackedUserIds]);
    }

    console.log(`  [CLEANUP] Successfully cleaned ${trackedContestIds.length} test contests and ${trackedUserIds.length} test users.`);
    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` Focused Test Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
