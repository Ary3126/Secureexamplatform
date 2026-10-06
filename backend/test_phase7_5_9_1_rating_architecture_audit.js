/**
 * Phase 7.5.9.1 — Rating Management Architecture & Audit Test Suite
 *
 * Verifies:
 * 1. Elo Rating Algorithm & Determinism (Pairwise, Ties, K-Factors, Single Participant, Floor)
 * 2. Database Schema, Constraints, and Indexes (Unique constraints, FKs, Indexes)
 * 3. Transactional Finalization & Idempotency (ACID boundaries, Idempotent returns, Pending check)
 * 4. Authorization, RBAC & Parameter Sanitization (Role checks, Ownership, BOLA, ID validation)
 * 5. Full-Scale Participant Handling (No pagination cap on rating calculation)
 * 6. Cross-Layer Consistency (Standings, Leaderboard, Results, and Export integration)
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const RatingService = require('./src/services/ratingService');
const RATING_CONFIG = require('./src/config/ratingConfig');
const ContestModel = require('./src/models/contestModel');
const RatingModel = require('./src/models/ratingModel');
const StandingsService = require('./src/services/standingsService');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

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
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const username = customData.username || `u_${role}_${ts}`;
  const email = customData.email || `${username}@examforge.test`;
  const rating = customData.currentRating !== undefined ? customData.currentRating : 1200;
  const ratingStatus = customData.ratingStatus || 'provisional';
  const ratedCount = customData.ratedContestCount !== undefined ? customData.ratedContestCount : 0;

  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rating_status, rated_contest_count)
     VALUES ($1, $2, 'hash123', $3, $4, $5, $5, $6, $7)
     RETURNING id, username, email, role, current_rating AS "currentRating", highest_rating AS "highestRating", rating_status AS "ratingStatus", rated_contest_count AS "ratedContestCount";`,
    [username, email, `Test ${username}`, role, rating, ratingStatus, ratedCount]
  );
  return res.rows[0];
}

function loginUser(email, role = 'student', id = null) {
  const { generateToken } = require('./src/services/authService');
  return generateToken({ id, role });
}

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.9.1 — Rating Management Architecture & Audit Test   ');
  console.log('================================================================\n');

  try {
    // ---------------------------------------------------------
    // TEST SECTION 1: Algorithm & Determinism Verification
    // ---------------------------------------------------------
    console.log('--- Step 1: Elo Algorithm Math & Determinism ---');

    // 1.1 Single participant edge case: delta must be exactly 0
    const singleParticipant = [
      { userId: 1, username: 'p1', currentRating: 1400, highestRating: 1400, ratingStatus: 'provisional', ratedContestCount: 2, rank: 1 }
    ];
    const singleResult = RatingService.calculateRatingChanges(singleParticipant);
    assert(singleResult.length === 1, 'Single participant produces 1 rating change record');
    assert(singleResult[0].ratingChange === 0, 'Single participant rating delta is exactly 0');
    assert(singleResult[0].newRating === 1400, 'Single participant newRating equals previous rating');
    assert(singleResult[0].newRatedContestCount === 3, 'Single participant contest count incremented');

    // 1.2 Multi-participant pairwise Elo: win, loss, tie
    const twoEqualRated = [
      { userId: 10, username: 'alice', currentRating: 1200, highestRating: 1200, ratingStatus: 'rated', ratedContestCount: 10, rank: 1 },
      { userId: 11, username: 'bob', currentRating: 1200, highestRating: 1200, ratingStatus: 'rated', ratedContestCount: 10, rank: 2 },
    ];
    const twoResult = RatingService.calculateRatingChanges(twoEqualRated);
    assert(twoResult[0].ratingChange > 0, 'Winner gains rating (+16 with K=32)');
    assert(twoResult[1].ratingChange < 0, 'Loser drops rating (-16 with K=32)');
    assert(twoResult[0].ratingChange + twoResult[1].ratingChange === 0, 'Zero-sum rating conservation for equal K-factor participants');
    assert(twoResult[0].ratingChange === 16, 'Expected delta for equal rated opponents with K=32 is +16');

    // 1.3 Ties produce 0.5 actual score: symmetric zero change between equal rated opponents
    const tieEqualRated = [
      { userId: 20, username: 'charlie', currentRating: 1500, highestRating: 1500, ratingStatus: 'rated', ratedContestCount: 10, rank: 1 },
      { userId: 21, username: 'dave', currentRating: 1500, highestRating: 1500, ratingStatus: 'rated', ratedContestCount: 10, rank: 1 },
    ];
    const tieResult = RatingService.calculateRatingChanges(tieEqualRated);
    assert(tieResult[0].ratingChange === 0, 'Tied equal-rated participant 1 receives 0 delta');
    assert(tieResult[1].ratingChange === 0, 'Tied equal-rated participant 2 receives 0 delta');

    // 1.4 Provisional vs Rated K-factor scaling (64 vs 32)
    const provVsRated = [
      { userId: 30, username: 'eve_prov', currentRating: 1200, highestRating: 1200, ratingStatus: 'provisional', ratedContestCount: 1, rank: 1 },
      { userId: 31, username: 'frank_rated', currentRating: 1200, highestRating: 1200, ratingStatus: 'rated', ratedContestCount: 8, rank: 2 },
    ];
    const provVsRatedResult = RatingService.calculateRatingChanges(provVsRated);
    assert(provVsRatedResult[0].ratingChange === 32, 'Provisional winner gains +32 (K=64)');
    assert(provVsRatedResult[1].ratingChange === -16, 'Rated loser loses -16 (K=32)');

    // 1.5 Rating floor: cannot drop below MIN_RATING (100)
    const lowRated = [
      { userId: 40, username: 'winner', currentRating: 1800, highestRating: 1800, ratingStatus: 'rated', ratedContestCount: 10, rank: 1 },
      { userId: 41, username: 'floor_target', currentRating: 105, highestRating: 1200, ratingStatus: 'rated', ratedContestCount: 10, rank: 2 },
    ];
    const floorResult = RatingService.calculateRatingChanges(lowRated);
    assert(floorResult[1].newRating >= RATING_CONFIG.MIN_RATING, `Rating does not drop below floor of ${RATING_CONFIG.MIN_RATING}`);

    // 1.6 Determinism verification: same inputs produce identical outputs
    const runA = RatingService.calculateRatingChanges(twoEqualRated);
    const runB = RatingService.calculateRatingChanges(twoEqualRated);
    assert(JSON.stringify(runA) === JSON.stringify(runB), 'Rating calculation is 100% deterministic');

    // ---------------------------------------------------------
    // TEST SECTION 2: Database Schema & Integrity Constraints
    // ---------------------------------------------------------
    console.log('\n--- Step 2: Database Model & Constraints Audit ---');

    // 2.1 Verify unique constraint on rating_history (user_id, contest_id)
    const userA = await createTestUser('student');
    const profA = await createTestUser('professor');
    const contestA = await ContestModel.createContest({
      title: 'Audit DB Contest',
      description: 'Audit test contest',
      createdBy: profA.id,
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() - 600000).toISOString(),
      isRated: true,
      status: 'published',
    });

    const entry1 = await RatingModel.createRatingHistoryEntry(null, {
      userId: userA.id,
      contestId: contestA.id,
      previousRating: 1200,
      ratingChange: 15,
      newRating: 1215,
      rank: 1,
      participantCount: 5,
    });
    assert(entry1 !== null && entry1.userId === userA.id, 'First rating_history insertion succeeds');

    // 2.2 Re-inserting for same (userId, contestId) is blocked by ON CONFLICT DO NOTHING
    const entry2 = await RatingModel.createRatingHistoryEntry(null, {
      userId: userA.id,
      contestId: contestA.id,
      previousRating: 1200,
      ratingChange: 15,
      newRating: 1215,
      rank: 1,
      participantCount: 5,
    });
    assert(entry2 === null, 'Duplicate rating_history entry safely ignored by ON CONFLICT DO NOTHING');

    // 2.3 Verify indexes exist for rating queries
    const indexesRes = await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('users', 'rating_history', 'contests');`
    );
    const indexNames = indexesRes.rows.map(r => r.indexname);
    assert(indexNames.includes('idx_users_current_rating'), 'Index idx_users_current_rating exists on users');
    assert(indexNames.includes('idx_users_rating_desc_id_asc'), 'Index idx_users_rating_desc_id_asc exists on users');
    assert(indexNames.includes('idx_rating_history_user_id'), 'Index idx_rating_history_user_id exists on rating_history');
    assert(indexNames.includes('idx_rating_history_contest_id'), 'Index idx_rating_history_contest_id exists on rating_history');

    // ---------------------------------------------------------
    // TEST SECTION 3: Transactional Finalization & Idempotency
    // ---------------------------------------------------------
    console.log('\n--- Step 3: Transactional Finalization & Idempotency ---');

    // 3.1 Setup contest with 3 participants
    const s1 = await createTestUser('student', { currentRating: 1200 });
    const s2 = await createTestUser('student', { currentRating: 1200 });
    const s3 = await createTestUser('student', { currentRating: 1200 });

    const contestTx = await ContestModel.createContest({
      title: 'ACID Finalization Contest',
      description: 'Testing ACID finalization',
      createdBy: profA.id,
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      isRated: true,
    });
    await ContestModel.updateContest(contestTx.id, { status: 'published' });

    await ContestModel.addParticipant(contestTx.id, s1.id);
    await ContestModel.addParticipant(contestTx.id, s2.id);
    await ContestModel.addParticipant(contestTx.id, s3.id);

    // Initial finalization
    const finalize1 = await RatingService.finalizeContestRatings(contestTx.id, profA);
    assert(finalize1.isRated === true, 'Finalization succeeded for rated contest');
    assert(finalize1.ratingUpdates.length === 3, 'Calculated updates for all 3 participants');
    assert(finalize1.finalResultsSnapshot !== null, 'Sealed final_results_snapshot saved');

    // Check user records updated
    const s1After = await RatingModel.getUserRatingSummary(s1.id);
    assert(s1After.ratedContestCount === 1, 'Participant 1 rated contest count incremented');

    // 3.2 Repeated finalization must be strictly idempotent
    const finalize2 = await RatingService.finalizeContestRatings(contestTx.id, profA);
    assert(finalize2.alreadyFinalized === true, 'Repeated finalization returns alreadyFinalized=true');
    assert(finalize2.contestId === contestTx.id, 'Idempotent response contains contestId');
    assert(finalize2.ratingUpdates.length === 3, 'Idempotent response contains existing history records');

    const s1AfterRepeat = await RatingModel.getUserRatingSummary(s1.id);
    assert(s1AfterRepeat.currentRating === s1After.currentRating, 'Current rating remains unchanged on repeated finalization');
    assert(s1AfterRepeat.ratedContestCount === 1, 'Contest count not duplicated on repeated finalization');

    // 3.3 Unrated contest finalization: marks finalized, snapshot saved, no rating deltas
    const unratedContest = await ContestModel.createContest({
      title: 'Unrated Contest Audit',
      description: 'Testing unrated contest',
      createdBy: profA.id,
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      isRated: false,
    });
    await ContestModel.updateContest(unratedContest.id, { status: 'published' });
    await ContestModel.addParticipant(unratedContest.id, s1.id);

    const unratedFinalize = await RatingService.finalizeContestRatings(unratedContest.id, profA);
    assert(unratedFinalize.isRated === false, 'Unrated contest returns isRated=false');
    assert(unratedFinalize.ratingUpdates.length === 0, 'No rating updates generated for unrated contest');

    const s1AfterUnrated = await RatingModel.getUserRatingSummary(s1.id);
    assert(s1AfterUnrated.currentRating === s1After.currentRating, 'Participant rating unchanged after unrated contest finalization');

    // ---------------------------------------------------------
    // TEST SECTION 4: Authorization & Security Audit
    // ---------------------------------------------------------
    console.log('\n--- Step 4: Authorization & Security Audit ---');

    const studentToken = await loginUser(s1.email, 'student', s1.id);
    const profToken = await loginUser(profA.email, 'professor', profA.id);
    const profOther = await createTestUser('professor');
    const profOtherToken = await loginUser(profOther.email, 'professor', profOther.id);

    // 4.1 Student blocked from finalization endpoint
    const studentFinalizeRes = await request('POST', `/api/contests/${contestTx.id}/finalize-ratings`, {}, studentToken);
    assert(studentFinalizeRes.status === 403, 'Student blocked from POST /finalize-ratings with 403 Forbidden');

    // 4.2 Non-owning professor blocked from finalization endpoint
    const nonOwningRes = await request('POST', `/api/contests/${contestTx.id}/finalize-ratings`, {}, profOtherToken);
    assert(nonOwningRes.status === 403, 'Non-owning professor blocked from POST /finalize-ratings with 403 Forbidden');

    // 4.3 Parameter format validation on rating endpoints (prevents NaN / 500 error)
    const invalidIdRes = await request('GET', '/api/users/abc/rating', null, studentToken);
    assert(invalidIdRes.status === 400, 'Invalid string user ID returns 400 Bad Request');
    assert(invalidIdRes.body.message.includes('Invalid user ID format'), 'Error message clearly indicates invalid ID format');

    const invalidHistoryRes = await request('GET', '/api/users/not_an_int/rating-history', null, studentToken);
    assert(invalidHistoryRes.status === 400, 'Invalid string user ID on history endpoint returns 400 Bad Request');

    // 4.4 Non-existent user ID returns 404
    const notFoundRes = await request('GET', '/api/users/99999999/rating', null, studentToken);
    assert(notFoundRes.status === 404, 'Non-existent user ID returns 404 Not Found');

    const notFoundHistoryRes = await request('GET', '/api/users/99999999/rating-history', null, studentToken);
    assert(notFoundHistoryRes.status === 404, 'Non-existent user ID on history returns 404 Not Found');

    // 4.5 Valid 'me' and valid integer ID requests succeed
    const validMeRes = await request('GET', '/api/users/me/rating', null, studentToken);
    assert(validMeRes.status === 200, "GET /api/users/me/rating succeeds with 200 OK");
    assert(validMeRes.body.userId === s1.id, "GET /api/users/me/rating returns authenticated user's ID");

    const validHistoryRes = await request('GET', `/api/users/${s1.id}/rating-history`, null, studentToken);
    assert(validHistoryRes.status === 200, `GET /api/users/${s1.id}/rating-history succeeds with 200 OK`);
    assert(validHistoryRes.body.historyCount >= 1, 'Returns authenticated rating history entries');

    // ---------------------------------------------------------
    // TEST SECTION 5: Full-Scale Participant Handling (Audit Fix Verification)
    // ---------------------------------------------------------
    console.log('\n--- Step 5: Full-Scale Participant Handling Verification ---');

    // Verify RatingService.computeContestStandings passes isExport: true, limit: 'all'
    const standingsSample = await RatingService.computeContestStandings(contestTx.id);
    assert(Array.isArray(standingsSample), 'computeContestStandings returns array');
    assert(standingsSample.length === 3, 'All 3 participants returned without pagination slice');

    // ---------------------------------------------------------
    // TEST SECTION 6: Cross-Layer Consistency
    // ---------------------------------------------------------
    console.log('\n--- Step 6: Cross-Layer Consistency Verification ---');

    // 6.1 Contest Leaderboard reflects finalization and official rating updates
    const lbRes = await request('GET', `/api/contests/${contestTx.id}/leaderboard`);
    assert(lbRes.status === 200, 'Public contest leaderboard responds with 200 OK');
    assert(lbRes.body.contest.isRatingFinalized === true, 'Leaderboard confirms isRatingFinalized=true');
    assert(lbRes.body.contest.freezeState === 'FINAL', 'Leaderboard confirms freezeState=FINAL');
    assert(lbRes.body.standings.length === 3, 'Leaderboard standings populated');
    assert(lbRes.body.standings[0].ratingChange !== null, 'Leaderboard standings rows include official ratingChange');

    // 6.2 Contest Results endpoint reflects sealed snapshot
    const resultsRes = await request('GET', `/api/contests/${contestTx.id}/results`);
    assert(resultsRes.status === 200, 'Contest results responds with 200 OK');
    assert(resultsRes.body.contest.isRatingFinalized === true, 'Results view confirms isRatingFinalized=true');
    assert(resultsRes.body.results.length === 3, 'Results view contains full results list');
    assert(resultsRes.body.results[0].ratingChange !== null, 'Results rows contain official ratingChange');

    // 6.3 Participant Result Details contains consistent rating changes
    const participantDetailsRes = await request(
      'GET',
      `/api/contests/${contestTx.id}/participants/${s1.id}/results`,
      null,
      studentToken
    );
    assert(participantDetailsRes.status === 200, 'Participant result details responds with 200 OK');
    assert(participantDetailsRes.body.participant.currentRating === s1After.currentRating, 'Participant result details shows updated currentRating');
    assert(participantDetailsRes.body.participant.ratingChange !== null, 'Participant result details shows official ratingChange');

    console.log('\n================================================================');
    console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('================================================================');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await db.closePool();
  }
}

server = app.listen(0, () => {
  serverPort = server.address().port;
  baseUrl = `http://localhost:${serverPort}`;
  runTestSuite();
});
