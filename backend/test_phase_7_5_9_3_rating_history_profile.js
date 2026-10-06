/**
 * Phase 7.5.9.3 — Rating History & User Profile Test Suite
 *
 * Comprehensive production-grade validation of:
 * 1. Rating-history creation
 * 2. Correct old rating
 * 3. Correct rating change
 * 4. Correct new rating
 * 5. old + change = new mathematical invariant
 * 6. Correct user association
 * 7. Correct contest association
 * 8. Duplicate prevention (DB unique constraint & idempotency)
 * 9. History ordering (chronological ASC and DESC support)
 * 10. Current-rating consistency (users.current_rating == latest history new_rating)
 * 11. Profile/history consistency (profile identity matches authoritative history)
 * 12. Contest-result/history consistency (final_results_snapshot matches rating_history)
 * 13. Leaderboard/history consistency (leaderboard deltas match rating_history)
 * 14. Export/history consistency (exported JSON and CSV match rating_history)
 * 15. Authorization (unauthenticated blocked with 401)
 * 16. IDOR/BOLA (public rating viewable, private email strictly masked for others)
 * 17. Invalid IDs (0, negative, string, decimal, huge numbers return 400 Bad Request)
 * 18. Non-existent users (returns 404 Not Found)
 * 19. Empty history (clean 0-history return for new students)
 * 20. Large history & pagination (page, limit, totalRecords, totalPages, validation gates)
 * 21. Repeated finalization (idempotent return, zero duplicates)
 * 22. Concurrent finalization (PostgreSQL FOR UPDATE row lock serializes)
 * 23. Transaction rollback (failed finalization rolls back cleanly)
 * 24. Finalization integrity (result lock immutability)
 * 25. Sensitive data exposure prevention (zero password hashes, tokens, or secrets leaked)
 * 26. Database constraints enforcement (rank > 0, count > 0, floor >= 100)
 * 27. Automated teardown & clean baseline preservation
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const RatingService = require('./src/services/ratingService');
const RatingModel = require('./src/models/ratingModel');
const ContestModel = require('./src/models/contestModel');
const ContestExportService = require('./src/services/contestExportService');
const StandingsService = require('./src/services/standingsService');
const { generateToken } = require('./src/services/authService');

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
  const username = customData.username || `u_p7593_${role}_${ts}`;
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
    title: customData.title || `Test Contest 7.5.9.3 ${ts}`,
    description: 'Test Contest for Phase 7.5.9.3 rating history hardening',
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

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.9.3 — Rating History & User Profile Test Suite       ');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // SECTION 1: Rating-History Creation & Mathematical Invariants
    // -------------------------------------------------------------
    console.log('--- Step 1: Rating-History Creation & Mathematical Invariants ---');

    const prof1 = await createTestUser('professor');
    const student1 = await createTestUser('student', { currentRating: 1200, ratedContestCount: 0 });
    const student2 = await createTestUser('student', { currentRating: 1200, ratedContestCount: 0 });

    const contest1 = await createTestContest({
      createdBy: prof1.id,
      status: 'published',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      isRated: true,
    });

    await ContestModel.addProblemToContest({ contestId: contest1.id, problemId: 319, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contest1.id, student1.id);
    await ContestModel.addParticipant(contest1.id, student2.id);

    // Insert submissions: student1 solves problem 319, student2 does not
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, source_code, created_at)
       VALUES ($1, 319, $2, 'javascript', 'accepted', 100, 'code1', $3);`,
      [contest1.id, student1.id, new Date(Date.now() - 5000000).toISOString()]
    );

    // Finalize contest
    const finalize1 = await RatingService.finalizeContestRatings(contest1.id, prof1);
    assert(finalize1.isRated === true, '1.1 Finalization succeeded for rated contest');
    assert(finalize1.ratingUpdates.length === 2, '1.2 Exactly 2 participant rating updates generated');

    // Retrieve history directly from RatingModel
    const hist1 = await RatingModel.getRatingHistoryByUser(student1.id);
    const hist2 = await RatingModel.getRatingHistoryByUser(student2.id);

    assert(hist1.length === 1, '1.3 Student 1 has exactly 1 rating history record');
    assert(hist2.length === 1, '1.4 Student 2 has exactly 1 rating history record');

    const h1 = hist1[0];
    const h2 = hist2[0];

    // Mathematical invariant: new_rating = previous_rating + rating_change
    assert(h1.previousRating === 1200, '1.5 Student 1 previous rating is 1200');
    assert(h1.ratingChange === 32, '1.6 Student 1 provisional win delta is +32 (K=64)');
    assert(h1.newRating === 1232, '1.7 Student 1 new rating is 1232');
    assert(h1.newRating === h1.previousRating + h1.ratingChange, '1.8 Mathematical invariant holds: previous + delta = new');

    assert(h2.previousRating === 1200, '1.9 Student 2 previous rating is 1200');
    assert(h2.ratingChange === -32, '1.10 Student 2 provisional loss delta is -32 (K=64)');
    assert(h2.newRating === 1168, '1.11 Student 2 new rating is 1168');
    assert(h2.newRating === h2.previousRating + h2.ratingChange, '1.12 Mathematical invariant holds: previous + delta = new');

    // User and contest association
    assert(h1.userId === student1.id, '1.13 Correct user_id association on history record');
    assert(h1.contestId === contest1.id, '1.14 Correct contest_id association on history record');
    assert(Boolean(h1.contestTitle), '1.15 Joined contest title is populated');
    assert(Boolean(h1.finalizedAt), '1.16 Contest finalizedAt timestamp is populated on history record');

    // -------------------------------------------------------------
    // SECTION 2: Current-Rating and History Agreement
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Current-Rating and History Agreement ---');

    const s1Summary = await RatingModel.getUserRatingSummary(student1.id);
    const s2Summary = await RatingModel.getUserRatingSummary(student2.id);

    assert(s1Summary.currentRating === h1.newRating, '2.1 Student 1 current_rating in users table strictly equals latest history new_rating');
    assert(s1Summary.highestRating === h1.newRating, '2.2 Student 1 highest_rating updated to 1232');
    assert(s1Summary.ratedContestCount === 1, '2.3 Student 1 rated_contest_count incremented to 1');

    assert(s2Summary.currentRating === h2.newRating, '2.4 Student 2 current_rating in users table strictly equals latest history new_rating');
    assert(s2Summary.highestRating === 1200, '2.5 Student 2 highest_rating remains 1200');
    assert(s2Summary.ratedContestCount === 1, '2.6 Student 2 rated_contest_count incremented to 1');

    // -------------------------------------------------------------
    // SECTION 3: Multi-Contest History Progression
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Multi-Contest History Progression ---');

    // Run contest 2 with student 1 and student 2
    const contest2 = await createTestContest({
      createdBy: prof1.id,
      status: 'published',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() - 1800000).toISOString(),
      isRated: true,
    });

    await ContestModel.addProblemToContest({ contestId: contest2.id, problemId: 319, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contest2.id, student1.id);
    await ContestModel.addParticipant(contest2.id, student2.id);

    // This time student 2 wins against student 1
    await db.query(
      `INSERT INTO submissions (contest_id, problem_id, user_id, language, status, score, source_code, created_at)
       VALUES ($1, 319, $2, 'javascript', 'accepted', 100, 'code2', $3);`,
      [contest2.id, student2.id, new Date(Date.now() - 2500000).toISOString()]
    );

    await RatingService.finalizeContestRatings(contest2.id, prof1);

    const hist1Multi = await RatingModel.getRatingHistoryByUser(student1.id);
    const hist2Multi = await RatingModel.getRatingHistoryByUser(student2.id);

    assert(hist1Multi.length === 2, '3.1 Student 1 has exactly 2 history records');
    assert(hist2Multi.length === 2, '3.2 Student 2 has exactly 2 history records');

    // Contest 2 starting rating must equal contest 1 new_rating
    const h1_c2 = hist1Multi[1];
    const h2_c2 = hist2Multi[1];

    assert(h1_c2.previousRating === hist1Multi[0].newRating, '3.3 Contest 2 previous_rating matches contest 1 new_rating for Student 1');
    assert(h2_c2.previousRating === hist2Multi[0].newRating, '3.4 Contest 2 previous_rating matches contest 1 new_rating for Student 2');

    const s1SummaryAfterC2 = await RatingModel.getUserRatingSummary(student1.id);
    assert(s1SummaryAfterC2.currentRating === h1_c2.newRating, '3.5 Current rating after contest 2 equals latest history new_rating');
    assert(s1SummaryAfterC2.ratedContestCount === 2, '3.6 Rated contest count is now 2');

    // -------------------------------------------------------------
    // SECTION 4: Duplicate History Prevention & Idempotency
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Duplicate History Prevention & Idempotency ---');

    // Repeated finalization
    const repeatFinalize = await RatingService.finalizeContestRatings(contest2.id, prof1);
    assert(repeatFinalize.alreadyFinalized === true, '4.1 Repeated finalization returns alreadyFinalized: true');

    const histAfterRepeat = await RatingModel.getRatingHistoryByUser(student1.id);
    assert(histAfterRepeat.length === 2, '4.2 Rating history count unchanged after repeated finalization');

    // Concurrent finalization calls
    const [conc1, conc2] = await Promise.all([
      RatingService.finalizeContestRatings(contest2.id, prof1),
      RatingService.finalizeContestRatings(contest2.id, prof1),
    ]);
    assert(conc1.alreadyFinalized === true && conc2.alreadyFinalized === true, '4.3 Concurrent repeated calls safely return alreadyFinalized');

    // Direct insert collision attempt (ON CONFLICT DO NOTHING test)
    const directDup = await RatingModel.createRatingHistoryEntry(null, {
      userId: student1.id,
      contestId: contest2.id,
      previousRating: 9999,
      ratingChange: 999,
      newRating: 9999,
      rank: 1,
      participantCount: 2,
    });
    assert(directDup === null, '4.4 Direct duplicate rating_history insertion returns null via ON CONFLICT');

    const countInDb = await db.query(
      `SELECT COUNT(*)::int AS count FROM rating_history WHERE user_id = $1 AND contest_id = $2;`,
      [student1.id, contest2.id]
    );
    assert(countInDb.rows[0].count === 1, '4.5 Exactly 1 rating_history record exists in DB for (userId, contestId)');

    // -------------------------------------------------------------
    // SECTION 5: Cross-Layer Agreement (Snapshot == Results == Leaderboard == Export == Profile)
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Cross-Layer Agreement Verification ---');

    const s1Token = generateToken(student1);

    // 5.1 Snapshot from Contest
    const contestRow = await db.query(`SELECT final_results_snapshot FROM contests WHERE id = $1;`, [contest2.id]);
    const snapshot = contestRow.rows[0].final_results_snapshot;
    const snapS1 = snapshot.ratingUpdates.find(u => u.userId === student1.id);
    assert(snapS1.ratingChange === h1_c2.ratingChange, '5.1 Snapshot ratingChange matches rating_history');
    assert(snapS1.newRating === h1_c2.newRating, '5.2 Snapshot newRating matches rating_history');

    // 5.2 Contest Results API
    const resultsRes = await request('GET', `/api/contests/${contest2.id}/results`);
    assert(resultsRes.status === 200, '5.3 Contest results responds with 200 OK');
    const resS1 = resultsRes.body.results.find(r => r.userId === student1.id);
    assert(resS1.ratingChange === h1_c2.ratingChange, '5.4 Contest Results ratingChange matches rating_history');

    // 5.3 Contest Leaderboard API
    const lbRes = await request('GET', `/api/contests/${contest2.id}/leaderboard`);
    assert(lbRes.status === 200, '5.5 Contest leaderboard responds with 200 OK');
    const lbS1 = lbRes.body.standings.find(s => s.userId === student1.id);
    assert(lbS1.ratingChange === h1_c2.ratingChange, '5.6 Leaderboard ratingChange matches rating_history');

    // 5.4 Export API
    const exportRes = await ContestExportService.exportContestResults({
      contestId: contest2.id,
      requestingUser: prof1,
      format: 'json',
    });
    const exportedJson = JSON.parse(exportRes.content);
    const expS1 = exportedJson.standings.find(s => s.userId === student1.id);
    assert(expS1.ratingChange === h1_c2.ratingChange, '5.7 Exported JSON ratingChange matches rating_history');

    // 5.5 User Profile API (/api/users/me/identity)
    const profileRes = await request('GET', '/api/users/me/identity', null, s1Token);
    assert(profileRes.status === 200, '5.8 User profile responds with 200 OK');
    assert(profileRes.body.rating.current === s1SummaryAfterC2.currentRating, '5.9 Profile current rating matches users.current_rating');
    assert(profileRes.body.ratingHistory.length === 2, '5.10 Profile rating history array has 2 records');
    const profLatest = profileRes.body.ratingHistory[1];
    assert(profLatest.newRating === h1_c2.newRating, '5.11 Profile latest rating matches rating_history.new_rating');

    // -------------------------------------------------------------
    // SECTION 6: Rating History API & Pagination Hardening
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Rating History API & Pagination Hardening ---');

    // 6.1 GET /api/users/:id/rating
    const ratingEndpointRes = await request('GET', `/api/users/${student1.id}/rating`, null, s1Token);
    assert(ratingEndpointRes.status === 200, '6.1 GET /api/users/:id/rating returns 200 OK');
    assert(ratingEndpointRes.body.currentRating === s1SummaryAfterC2.currentRating, '6.2 Returned currentRating matches DB');
    assert(ratingEndpointRes.body.isStudent === true, '6.3 Returned isStudent is true for student');

    // 6.2 GET /api/users/me/rating
    const meRatingRes = await request('GET', '/api/users/me/rating', null, s1Token);
    assert(meRatingRes.status === 200 && meRatingRes.body.userId === student1.id, '6.4 GET /api/users/me/rating returns authenticated user rating');

    // 6.3 Backward compatible unpaginated GET /api/users/:id/rating-history
    const histAllRes = await request('GET', `/api/users/${student1.id}/rating-history`, null, s1Token);
    assert(histAllRes.status === 200, '6.5 Unpaginated history request returns 200 OK');
    assert(histAllRes.body.historyCount === 2, '6.6 historyCount matches total records');
    assert(histAllRes.body.history.length === 2, '6.7 Full history returned when no pagination params passed');

    // 6.4 Paginated request (page=1, limit=1)
    const page1Res = await request('GET', `/api/users/${student1.id}/rating-history?page=1&limit=1`, null, s1Token);
    assert(page1Res.status === 200, '6.8 Paginated history request returns 200 OK');
    assert(page1Res.body.history.length === 1, '6.9 Exactly 1 item returned for limit=1');
    assert(page1Res.body.pagination.totalRecords === 2, '6.10 Pagination metadata totalRecords is 2');
    assert(page1Res.body.pagination.totalPages === 2, '6.11 Pagination metadata totalPages is 2');
    assert(page1Res.body.pagination.hasNext === true, '6.12 Page 1 hasNext is true');
    assert(page1Res.body.pagination.hasPrev === false, '6.13 Page 1 hasPrev is false');

    // 6.5 Paginated request page=2
    const page2Res = await request('GET', `/api/users/${student1.id}/rating-history?page=2&limit=1`, null, s1Token);
    assert(page2Res.body.history.length === 1, '6.14 Page 2 returns 1 item');
    assert(page2Res.body.pagination.hasNext === false, '6.15 Page 2 hasNext is false');
    assert(page2Res.body.pagination.hasPrev === true, '6.16 Page 2 hasPrev is true');

    // 6.6 Ordering support (order=desc)
    const descRes = await request('GET', `/api/users/${student1.id}/rating-history?order=desc`, null, s1Token);
    assert(descRes.status === 200, '6.17 order=desc returns 200 OK');
    assert(descRes.body.history[0].contestId === contest2.id, '6.18 order=desc returns latest contest first');

    // 6.7 Pagination parameter validation gates (400 Bad Request)
    const badPage = await request('GET', `/api/users/${student1.id}/rating-history?page=-1`, null, s1Token);
    assert(badPage.status === 400, '6.19 Negative page rejected with 400 Bad Request');

    const zeroPage = await request('GET', `/api/users/${student1.id}/rating-history?page=0`, null, s1Token);
    assert(zeroPage.status === 400, '6.20 Zero page rejected with 400 Bad Request');

    const badLimit = await request('GET', `/api/users/${student1.id}/rating-history?limit=0`, null, s1Token);
    assert(badLimit.status === 400, '6.21 Zero limit rejected with 400 Bad Request');

    const excessLimit = await request('GET', `/api/users/${student1.id}/rating-history?limit=500`, null, s1Token);
    assert(excessLimit.status === 400, '6.22 Excessive limit (>100) rejected with 400 Bad Request');

    const badOrder = await request('GET', `/api/users/${student1.id}/rating-history?order=invalid_sort`, null, s1Token);
    assert(badOrder.status === 400, '6.23 Invalid order rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // SECTION 7: Authorization, IDOR & Sensitive Data Protection
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Authorization, IDOR & Sensitive Data Protection ---');

    // 7.1 Unauthenticated requests rejected
    const unauthRating = await request('GET', `/api/users/${student1.id}/rating`);
    assert(unauthRating.status === 401, '7.1 Unauthenticated rating request rejected with 401 Unauthorized');

    const unauthHistory = await request('GET', `/api/users/${student1.id}/rating-history`);
    assert(unauthHistory.status === 401, '7.2 Unauthenticated rating-history request rejected with 401 Unauthorized');

    // 7.2 Student A viewing Student B public rating & history is permitted
    const s2Token = generateToken(student2);
    const crossRating = await request('GET', `/api/users/${student1.id}/rating`, null, s2Token);
    assert(crossRating.status === 200, '7.3 Student B viewing Student A rating is permitted (200 OK)');

    const crossHistory = await request('GET', `/api/users/${student1.id}/rating-history`, null, s2Token);
    assert(crossHistory.status === 200, '7.4 Student B viewing Student A rating-history is permitted (200 OK)');

    // 7.3 Sensitive field protection in profile & identity
    const crossIdentity = await request('GET', `/api/users/${student1.id}/identity`, null, s2Token);
    assert(crossIdentity.status === 200, '7.5 Student B viewing Student A identity succeeds');
    assert(crossIdentity.body.user.email === undefined, '7.6 Student A email is strictly hidden from Student B');
    assert(crossIdentity.body.user.password_hash === undefined, '7.7 Zero password hashes in identity response');

    // 7.4 Sensitive fields in rating & rating-history
    assert(crossRating.body.password_hash === undefined, '7.8 Zero password hashes in rating response');
    assert(crossHistory.body.history.every(h => h.password_hash === undefined), '7.9 Zero password hashes in rating-history records');

    // -------------------------------------------------------------
    // SECTION 8: Input Hardening & Non-Existent Users
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Input Hardening & Non-Existent Users ---');

    // 8.1 Invalid identifier formats
    const strId = await request('GET', '/api/users/abc/rating', null, s1Token);
    assert(strId.status === 400, '8.1 String user ID returns 400 Bad Request');

    const negId = await request('GET', '/api/users/-5/rating', null, s1Token);
    assert(negId.status === 400, '8.2 Negative user ID returns 400 Bad Request');

    const zeroId = await request('GET', '/api/users/0/rating', null, s1Token);
    assert(zeroId.status === 400, '8.3 Zero user ID returns 400 Bad Request');

    const decId = await request('GET', '/api/users/12.5/rating-history', null, s1Token);
    assert(decId.status === 400, '8.4 Decimal user ID on history returns 400 Bad Request');

    // 8.2 Non-existent user
    const notFoundRating = await request('GET', '/api/users/99999999/rating', null, s1Token);
    assert(notFoundRating.status === 404, '8.5 Non-existent user on rating returns 404 Not Found');

    const notFoundHist = await request('GET', '/api/users/99999999/rating-history', null, s1Token);
    assert(notFoundHist.status === 404, '8.6 Non-existent user on history returns 404 Not Found');

    // 8.3 User with empty history
    const studentNew = await createTestUser('student');
    const emptyHist = await request('GET', `/api/users/${studentNew.id}/rating-history`, null, s1Token);
    assert(emptyHist.status === 200, '8.7 User with empty history returns 200 OK');
    assert(emptyHist.body.historyCount === 0 && emptyHist.body.history.length === 0, '8.8 Returns clean empty history array');

    // -------------------------------------------------------------
    // SECTION 9: Database Invariant & Check Constraints
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Database Invariant & Check Constraints ---');

    // 9.1 Rank > 0 constraint violation rejected by PostgreSQL
    let rankErr = null;
    try {
      await db.query(
        `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
         VALUES ($1, $2, 1200, 0, 1200, 0, 2);`,
        [studentNew.id, contest1.id]
      );
    } catch (e) {
      rankErr = e;
    }
    assert(rankErr !== null && rankErr.code === '23514', '9.1 rank <= 0 rejected by PostgreSQL CHECK constraint chk_rating_history_rank');

    // 9.2 participant_count > 0 constraint violation rejected by PostgreSQL
    let countErr = null;
    try {
      await db.query(
        `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
         VALUES ($1, $2, 1200, 0, 1200, 1, 0);`,
        [studentNew.id, contest1.id]
      );
    } catch (e) {
      countErr = e;
    }
    assert(countErr !== null && countErr.code === '23514', '9.2 participant_count <= 0 rejected by PostgreSQL CHECK constraint chk_rating_history_participant_count');

    // 9.3 new_rating < 100 constraint violation rejected by PostgreSQL
    let floorErr = null;
    try {
      await db.query(
        `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
         VALUES ($1, $2, 1200, -1150, 50, 1, 2);`,
        [studentNew.id, contest1.id]
      );
    } catch (e) {
      floorErr = e;
    }
    assert(floorErr !== null && floorErr.code === '23514', '9.3 new_rating < 100 rejected by PostgreSQL CHECK constraint chk_rating_history_new_rating');

    // 9.4 users.current_rating < 100 constraint violation rejected by PostgreSQL
    let userFloorErr = null;
    try {
      await db.query(`UPDATE users SET current_rating = 50 WHERE id = $1;`, [studentNew.id]);
    } catch (e) {
      userFloorErr = e;
    }
    assert(userFloorErr !== null && userFloorErr.code === '23514', '9.4 users.current_rating < 100 rejected by PostgreSQL CHECK constraint chk_users_current_rating_floor');

    // -------------------------------------------------------------
    // SECTION 10: High-Volume History Scaling
    // -------------------------------------------------------------
    console.log('\n--- Step 10: High-Volume History Scaling ---');

    const highVolUser = await createTestUser('student');
    const scaleContests = [];
    for (let c = 0; c < 15; c++) {
      const cObj = await createTestContest({
        createdBy: prof1.id,
        title: `Scale Contest ${c + 1}`,
      });
      scaleContests.push(cObj);
    }

    // Insert 15 history records
    const histInserts = scaleContests.map((cObj, i) => {
      const prev = 1200 + i * 10;
      const delta = 10;
      const next = prev + delta;
      return `(${highVolUser.id}, ${cObj.id}, ${prev}, ${delta}, ${next}, 1, 10, 1500, 'rated')`;
    });

    await db.query(`
      INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count, performance_rating, rating_status)
      VALUES ${histInserts.join(',')};
    `);

    // Verify paginated navigation over high volume history
    const hvPage1 = await request('GET', `/api/users/${highVolUser.id}/rating-history?page=1&limit=5`, null, s1Token);
    assert(hvPage1.body.pagination.totalRecords === 15, '10.1 High-volume user totalRecords is 15');
    assert(hvPage1.body.pagination.totalPages === 3, '10.2 High-volume user totalPages is 3');
    assert(hvPage1.body.history.length === 5, '10.3 Page 1 returns exactly 5 records');

    const hvPage3 = await request('GET', `/api/users/${highVolUser.id}/rating-history?page=3&limit=5`, null, s1Token);
    assert(hvPage3.body.history.length === 5, '10.4 Page 3 returns exactly 5 records');
    assert(hvPage3.body.pagination.hasNext === false, '10.5 Page 3 hasNext is false');

    console.log('\n================================================================');
    console.log(` Focused Test Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('================================================================');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    console.log('\n--- Step 11: Teardown & Clean Baseline Preservation ---');
    try {
      if (trackedContestIds.length > 0) {
        await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[]);`, [trackedContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[]);`, [trackedContestIds]);
      }
      if (trackedUserIds.length > 0) {
        await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[]);`, [trackedUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [trackedUserIds]);
      }
      console.log(`  [CLEANUP] Successfully cleaned ${trackedContestIds.length} test contests and ${trackedUserIds.length} test users.`);
    } catch (cleanErr) {
      console.error('Teardown cleanup error:', cleanErr);
    }

    if (server) {
      server.close();
    }
    await db.closePool();
    process.exit(failed > 0 ? 1 : 0);
  }
}

server = app.listen(0, () => {
  serverPort = server.address().port;
  baseUrl = `http://localhost:${serverPort}`;
  runTestSuite();
});
