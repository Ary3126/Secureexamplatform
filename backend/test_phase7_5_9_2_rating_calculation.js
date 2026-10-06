/**
 * Phase 7.5.9.2 — Rating Calculation & Edge-Case Hardening Test Suite
 *
 * Comprehensive validation of:
 * A. Tie handling (two, three, multiple tie groups, all tied, same score + penalty + time vs different penalty)
 * B. Missing results (missing score, missing penalty, missing rank, missing problem results)
 * C. Incomplete results (null, undefined, string numbers, NaN/Infinity poisoning prevention)
 * D. No-result participants (unattempted, failed-only, zero accepted problems)
 * E. Rating eligibility & Gates (draft, running, pending judge queue, student role exclusivity)
 * F. Mathematical correctness (pairwise Elo, equal/large diffs: 100, 400, 800, 1200+, zero-sum, provisional K=64 vs rated K=32)
 * G. Rating floor (MIN_RATING = 100)
 * H. Small / Special Contests (0 participants, 1 participant, 2 participants, unrated contests)
 * J. Large participant counts (10, 100, 101, 250, 500, 1,000 participants without pagination cap)
 * K. Order independence & determinism (shuffled orders produce identical results)
 * L. Concurrency & Idempotency (ACID row lock, repeated finalization)
 * M. Duplicate history prevention (DB unique constraint ON CONFLICT)
 * N. Client tampering & security (client fields ignored, RBAC enforcement)
 * O. Data integrity (newRating = previousRating + ratingChange)
 * P. Automated Teardown & Baseline verification
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const RatingService = require('./src/services/ratingService');
const RATING_CONFIG = require('./src/config/ratingConfig');
const ContestModel = require('./src/models/contestModel');
const RatingModel = require('./src/models/ratingModel');
const StandingsService = require('./src/services/standingsService');
const { generateToken } = require('./src/services/authService');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const createdUserIds = [];
const createdContestIds = [];

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
  const username = customData.username || `u_p7592_${role}_${ts}`;
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
  createdUserIds.push(user.id);
  return user;
}

async function createTestContest(customData = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const contest = await ContestModel.createContest({
    title: customData.title || `Test Contest 7.5.9.2 ${ts}`,
    description: 'Test Contest for Phase 7.5.9.2 rating hardening',
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
  createdContestIds.push(contest.id);
  return contest;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.9.2 — Rating Calculation & Edge-Case Hardening Test ');
  console.log('================================================================\n');

  try {
    // ---------------------------------------------------------
    // TEST SECTION A: Tie Handling
    // ---------------------------------------------------------
    console.log('--- Step A: Tie Handling ---');

    // A.1 Two participants tied with equal rating
    const twoTied = [
      { userId: 101, currentRating: 1400, rank: 1, ratedContestCount: 10 },
      { userId: 102, currentRating: 1400, rank: 1, ratedContestCount: 10 },
    ];
    const resA1 = RatingService.calculateRatingChanges(twoTied);
    assert(resA1[0].ratingChange === 0, 'Two tied equal-rated participants: participant 1 receives 0 delta');
    assert(resA1[1].ratingChange === 0, 'Two tied equal-rated participants: participant 2 receives 0 delta');

    // A.2 Three participants tied with equal rating
    const threeTied = [
      { userId: 103, currentRating: 1500, rank: 1, ratedContestCount: 8 },
      { userId: 104, currentRating: 1500, rank: 1, ratedContestCount: 8 },
      { userId: 105, currentRating: 1500, rank: 1, ratedContestCount: 8 },
    ];
    const resA2 = RatingService.calculateRatingChanges(threeTied);
    assert(resA2.every(p => p.ratingChange === 0), 'Three tied equal-rated participants all receive 0 delta');

    // A.3 Multiple groups of tied participants (e.g. 2 tied for 1st, 2 tied for 3rd)
    const multiGroupTied = [
      { userId: 106, currentRating: 1200, rank: 1, ratedContestCount: 10 },
      { userId: 107, currentRating: 1200, rank: 1, ratedContestCount: 10 },
      { userId: 108, currentRating: 1200, rank: 3, ratedContestCount: 10 },
      { userId: 109, currentRating: 1200, rank: 3, ratedContestCount: 10 },
    ];
    const resA3 = RatingService.calculateRatingChanges(multiGroupTied);
    assert(resA3[0].ratingChange === resA3[1].ratingChange, 'Participants tied at 1st receive identical deltas');
    assert(resA3[2].ratingChange === resA3[3].ratingChange, 'Participants tied at 3rd receive identical deltas');
    assert(resA3[0].ratingChange > 0 && resA3[2].ratingChange < 0, '1st place gain rating, 3rd place lose rating');
    const sumA3 = resA3.reduce((acc, p) => acc + p.ratingChange, 0);
    assert(sumA3 === 0, 'Zero-sum conservation holds across multiple tied groups');

    // A.4 All participants tied in a large group (10 participants)
    const tenTied = Array.from({ length: 10 }, (_, i) => ({
      userId: 110 + i,
      currentRating: 1300,
      rank: 1,
      ratedContestCount: 10,
    }));
    const resA4 = RatingService.calculateRatingChanges(tenTied);
    assert(resA4.every(p => p.ratingChange === 0), 'All 10 tied participants receive exactly 0 delta');

    // A.5 Tie-breaking with lastAcceptedAtMs (Fallback Ranking)
    // Same score, same penalty, different lastAcceptedAtMs: earlier solve gets rank 1, later solve gets rank 2
    const timeTied = [
      { userId: 121, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 20, lastAcceptedAtMs: 10000, ratedContestCount: 10 },
      { userId: 122, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 20, lastAcceptedAtMs: 20000, ratedContestCount: 10 },
    ];
    const resA5 = RatingService.calculateRatingChanges(timeTied);
    assert(resA5[0].userId === 121 && resA5[0].rank === 1, 'Earlier accepted solve gets rank 1');
    assert(resA5[1].userId === 122 && resA5[1].rank === 2, 'Later accepted solve gets rank 2');
    assert(resA5[0].ratingChange > 0 && resA5[1].ratingChange < 0, 'Winner gains rating and loser loses rating when tie broken by time');

    // A.6 Same score, same penalty, EXACT SAME submission time: true tie with same rank
    const exactSameTime = [
      { userId: 123, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 20, lastAcceptedAtMs: 15000, ratedContestCount: 10 },
      { userId: 124, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 20, lastAcceptedAtMs: 15000, ratedContestCount: 10 },
    ];
    const resA6 = RatingService.calculateRatingChanges(exactSameTime);
    assert(resA6[0].rank === 1 && resA6[1].rank === 1, 'Identical score, penalty, and timestamp produce shared rank 1');
    assert(resA6[0].ratingChange === 0 && resA6[1].ratingChange === 0, 'True tied participants receive 0 rating delta');

    // A.7 Same score, different penalty: lower penalty gets rank 1
    const diffPenalty = [
      { userId: 125, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 40, ratedContestCount: 10 },
      { userId: 126, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 10, ratedContestCount: 10 },
    ];
    const resA7 = RatingService.calculateRatingChanges(diffPenalty);
    assert(resA7[0].userId === 126 && resA7[0].rank === 1, 'Lower penalty user gets rank 1');
    assert(resA7[1].userId === 125 && resA7[1].rank === 2, 'Higher penalty user gets rank 2');

    // ---------------------------------------------------------
    // TEST SECTION B: Missing & Incomplete Results
    // ---------------------------------------------------------
    console.log('\n--- Step B: Missing & Incomplete Results ---');

    // B.1 Missing rank is dynamically computed from score/penalty fallback
    const missingRank = [
      { userId: 201, currentRating: 1200, totalScore: 300, totalPenaltyMinutes: 20, ratedContestCount: 10 },
      { userId: 202, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 10, ratedContestCount: 10 },
    ];
    const resB1 = RatingService.calculateRatingChanges(missingRank);
    assert(resB1[0].rank === 1 && resB1[1].rank === 2, 'Missing ranks dynamically assigned based on score fallback');
    assert(resB1[0].ratingChange > 0, 'Participant with higher score gains rating');

    // B.2 Missing totalScore and totalPenaltyMinutes default safely without NaN
    const missingScores = [
      { userId: 203, currentRating: 1200, rank: 1, ratedContestCount: 10 },
      { userId: 204, currentRating: 1200, rank: 2, ratedContestCount: 10 },
    ];
    const resB2 = RatingService.calculateRatingChanges(missingScores);
    assert(!isNaN(resB2[0].newRating) && !isNaN(resB2[1].newRating), 'Calculated ratings are valid numbers when scores missing');

    // B.3 Missing penalty defaults to 0 safely
    const missingPenalty = [
      { userId: 205, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: null, ratedContestCount: 10 },
      { userId: 206, currentRating: 1200, totalScore: 100, totalPenaltyMinutes: 20, ratedContestCount: 10 },
    ];
    const resB3 = RatingService.calculateRatingChanges(missingPenalty);
    assert(resB3[0].userId === 205 && resB3[0].rank === 1, 'Null penalty treated as 0 penalty, beating 20 penalty');

    // ---------------------------------------------------------
    // TEST SECTION C: Incomplete Results & Type Coercion
    // ---------------------------------------------------------
    console.log('\n--- Step C: Incomplete Results & Type Coercion ---');

    // C.1 String rating input prevention: does NOT string-concatenate
    const stringRating = [
      { userId: 301, currentRating: '1500', rank: 1, ratedContestCount: '10' },
      { userId: 302, currentRating: '1200', rank: 2, ratedContestCount: '10' },
    ];
    const resC1 = RatingService.calculateRatingChanges(stringRating);
    assert(typeof resC1[0].newRating === 'number', 'New rating is a JavaScript number');
    assert(resC1[0].newRating < 2000, 'String rating did not produce concatenated string');
    assert(resC1[0].newRatedContestCount === 11, 'Rated contest count incremented numerically');

    // C.2 NaN rating input sanitized without poisoning opponents
    const nanRating = [
      { userId: 303, currentRating: NaN, rank: 1 },
      { userId: 304, currentRating: 1200, rank: 2, ratedContestCount: 10 },
    ];
    const resC2 = RatingService.calculateRatingChanges(nanRating);
    assert(!isNaN(resC2[0].newRating), 'NaN participant rating safely defaulted');
    assert(!isNaN(resC2[1].newRating), 'Opponent of NaN participant not poisoned with NaN');

    // C.3 Null and non-object elements filtered out
    const withNulls = [
      null,
      undefined,
      { userId: 305, currentRating: 1200, rank: 1, ratedContestCount: 10 },
      'invalid_string',
      { userId: 306, currentRating: 1200, rank: 2, ratedContestCount: 10 },
    ];
    const resC3 = RatingService.calculateRatingChanges(withNulls);
    assert(resC3.length === 2, 'Null/non-object elements safely filtered out');

    // C.4 No Infinity or NaN in outputs under extreme conditions
    const extremeTest = [
      { userId: 307, currentRating: 100, rank: 1, ratedContestCount: 1 },
      { userId: 308, currentRating: 3000, rank: 2, ratedContestCount: 50 },
    ];
    const resC4 = RatingService.calculateRatingChanges(extremeTest);
    assert(resC4.every(p => Number.isFinite(p.newRating) && Number.isFinite(p.ratingChange)), 'No NaN or Infinity under 2900 rating spread');

    // ---------------------------------------------------------
    // TEST SECTION D: No-Result Participants
    // ---------------------------------------------------------
    console.log('\n--- Step D: No-Result Participants ---');

    // D.1 Unattempted participants (0 score, 0 solves) tie at the bottom
    const mixedResults = [
      { userId: 401, currentRating: 1200, rank: 1, totalScore: 200, ratedContestCount: 10 },
      { userId: 402, currentRating: 1200, rank: 2, totalScore: 0, ratedContestCount: 10 },
      { userId: 403, currentRating: 1200, rank: 2, totalScore: 0, ratedContestCount: 10 },
    ];
    const resD1 = RatingService.calculateRatingChanges(mixedResults);
    assert(resD1[0].ratingChange > 0, 'Active winner gains rating');
    assert(resD1[1].ratingChange === resD1[2].ratingChange, 'Both unattempted participants receive identical deltas');
    assert(resD1[1].ratingChange < 0, 'Unattempted participants lose rating against active winner');

    // D.2 Contest where every participant has no result: all tie, delta = 0
    const allNoResult = [
      { userId: 404, currentRating: 1200, rank: 1, totalScore: 0, ratedContestCount: 10 },
      { userId: 405, currentRating: 1200, rank: 1, totalScore: 0, ratedContestCount: 10 },
      { userId: 406, currentRating: 1200, rank: 1, totalScore: 0, ratedContestCount: 10 },
    ];
    const resD2 = RatingService.calculateRatingChanges(allNoResult);
    assert(resD2.every(p => p.ratingChange === 0), 'All-no-result contest produces 0 delta for all equal-rated participants');

    // ---------------------------------------------------------
    // TEST SECTION E: Server-Authoritative Eligibility & Gates
    // ---------------------------------------------------------
    console.log('\n--- Step E: Server-Authoritative Eligibility & Gates ---');

    const profE = await createTestUser('professor');
    const profEToken = generateToken(profE);
    const studentE = await createTestUser('student');

    // E.1 Draft contest finalization rejected (400)
    const draftContest = await createTestContest({
      title: 'Draft Contest Eligibility',
      createdBy: profE.id,
      status: 'draft',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() - 1800000).toISOString(),
    });
    const draftRes = await request('POST', `/api/contests/${draftContest.id}/finalize-ratings`, {}, profEToken);
    assert(draftRes.status === 400, 'Draft contest finalization rejected with 400 Bad Request');

    // E.2 Running contest finalization rejected without force (400)
    const runningContest = await createTestContest({
      title: 'Running Contest Eligibility',
      createdBy: profE.id,
      status: 'published',
      startTime: new Date(Date.now() - 1800000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    });
    const runningRes = await request('POST', `/api/contests/${runningContest.id}/finalize-ratings`, {}, profEToken);
    assert(runningRes.status === 400, 'Running contest finalization rejected with 400 Bad Request');

    // E.3 Pending judging submissions check blocks finalization (409 Conflict)
    const pendingContest = await createTestContest({
      title: 'Pending Submissions Contest',
      createdBy: profE.id,
      status: 'published',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
    });
    // Insert a pending submission
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, source_code, language, status)
       VALUES ($1, $2, 319, 'test', 'python', 'queued');`,
      [studentE.id, pendingContest.id]
    );
    const pendingRes = await request('POST', `/api/contests/${pendingContest.id}/finalize-ratings`, {}, profEToken);
    assert(pendingRes.status === 409, 'Contest with pending/running submissions blocked with 409 Conflict');
    // Clean up the pending submission so contest can be cleanly handled
    await db.query(`DELETE FROM submissions WHERE contest_id = $1;`, [pendingContest.id]);

    // ---------------------------------------------------------
    // TEST SECTION F: Mathematical Correctness & Zero-Sum
    // ---------------------------------------------------------
    console.log('\n--- Step F: Mathematical Correctness & Zero-Sum ---');

    // F.1 Equal rating match: winner +16, loser -16 (K=32)
    const eqMatch = [
      { userId: 501, currentRating: 1500, rank: 1, ratedContestCount: 10 },
      { userId: 502, currentRating: 1500, rank: 2, ratedContestCount: 10 },
    ];
    const resF1 = RatingService.calculateRatingChanges(eqMatch);
    assert(resF1[0].ratingChange === 16, 'Equal rated winner delta is +16');
    assert(resF1[1].ratingChange === -16, 'Equal rated loser delta is -16');
    assert(resF1[0].ratingChange + resF1[1].ratingChange === 0, 'Zero-sum property verified');

    // F.2 100-point difference match (32 * (1 - 1/(1 + 10^(-0.25))) = 11.518 -> rounds to 12)
    const diff100Match = [
      { userId: 503, currentRating: 1500, rank: 1, ratedContestCount: 10 },
      { userId: 504, currentRating: 1400, rank: 2, ratedContestCount: 10 },
    ];
    const resF2 = RatingService.calculateRatingChanges(diff100Match);
    assert(resF2[0].ratingChange === 12, '1500 beats 1400 yields expected +12 delta');
    assert(resF2[1].ratingChange === -12, '1400 loses to 1500 yields expected -12 delta');

    // F.3 400-point difference match (Expected score = 1 / (1 + 10^1) = 0.0909 for underdog)
    const diff400Match = [
      { userId: 505, currentRating: 1600, rank: 1, ratedContestCount: 10 },
      { userId: 506, currentRating: 1200, rank: 2, ratedContestCount: 10 },
    ];
    const resF3 = RatingService.calculateRatingChanges(diff400Match);
    assert(resF3[0].ratingChange === 3, '1600 beats 1200 yields +3 delta');
    assert(resF3[1].ratingChange === -3, '1200 loses to 1600 yields -3 delta');

    // F.4 Underdog win with large difference (800+ point difference)
    const underdogMatch = [
      { userId: 507, currentRating: 1000, rank: 1, ratedContestCount: 10 },
      { userId: 508, currentRating: 1800, rank: 2, ratedContestCount: 10 },
    ];
    const resF4 = RatingService.calculateRatingChanges(underdogMatch);
    assert(resF4[0].ratingChange >= 30, 'Underdog win produces large positive delta (>= 30)');
    assert(resF4[1].ratingChange <= -30, 'Favorite loss produces large negative delta (<= -30)');

    // F.5 1200+ point difference: no underflow or precision crash
    const diff1200Match = [
      { userId: 509, currentRating: 1000, rank: 1, ratedContestCount: 10 },
      { userId: 510, currentRating: 2400, rank: 2, ratedContestCount: 10 },
    ];
    const resF5 = RatingService.calculateRatingChanges(diff1200Match);
    assert(resF5[0].ratingChange === 32, '1400-point upset yields maximum K=32 delta');
    assert(resF5[1].ratingChange === -32, '1400-point favorite upset loss yields -32 delta');

    // F.6 Provisional (K=64) vs Rated (K=32) K-factor scaling
    const kFactorMatch = [
      { userId: 511, currentRating: 1200, rank: 1, ratedContestCount: 2 }, // Provisional
      { userId: 512, currentRating: 1200, rank: 2, ratedContestCount: 10 }, // Rated
    ];
    const resF6 = RatingService.calculateRatingChanges(kFactorMatch);
    assert(resF6[0].ratingChange === 32, 'Provisional winner gains +32 (K=64)');
    assert(resF6[1].ratingChange === -16, 'Rated loser loses -16 (K=32)');

    // ---------------------------------------------------------
    // TEST SECTION G: Rating Floor
    // ---------------------------------------------------------
    console.log('\n--- Step G: Rating Floor ---');

    const nearFloor = [
      { userId: 601, currentRating: 105, rank: 1, ratedContestCount: 10 },
      { userId: 602, currentRating: 105, rank: 2, ratedContestCount: 10 },
    ];
    const resG = RatingService.calculateRatingChanges(nearFloor);
    assert(resG[1].newRating >= RATING_CONFIG.MIN_RATING, `Rating does not drop below MIN_RATING (${RATING_CONFIG.MIN_RATING})`);
    assert(resG[1].newRating === 100, 'Rating floored at exactly 100');

    // ---------------------------------------------------------
    // TEST SECTION H & I: Small & Special Contests
    // ---------------------------------------------------------
    console.log('\n--- Step H & I: Small & Special Contests ---');

    // H.1 Single participant produces 0 delta
    const single = [{ userId: 701, currentRating: 1450, rank: 1, ratedContestCount: 3 }];
    const resH = RatingService.calculateRatingChanges(single);
    assert(resH.length === 1, 'Single participant returns 1 record');
    assert(resH[0].ratingChange === 0, 'Single participant delta is exactly 0');
    assert(resH[0].newRatedContestCount === 4, 'Single participant contest count incremented to 4');

    // H.2 Zero participants array returns empty array
    const resI1 = RatingService.calculateRatingChanges([]);
    assert(Array.isArray(resI1) && resI1.length === 0, 'Empty participants array returns empty array');

    // H.3 Null and undefined inputs return empty array without throwing
    const resI2 = RatingService.calculateRatingChanges(null);
    assert(Array.isArray(resI2) && resI2.length === 0, 'null input returns empty array');
    const resI3 = RatingService.calculateRatingChanges(undefined);
    assert(Array.isArray(resI3) && resI3.length === 0, 'undefined input returns empty array');

    // H.4 Zero participants in contest finalization (closes contest lifecycle safely)
    const emptyContest = await createTestContest({
      title: 'Empty Contest Finalization',
      createdBy: profE.id,
      status: 'published',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
    });
    const emptyFinalize = await RatingService.finalizeContestRatings(emptyContest.id, profE);
    assert(emptyFinalize.ratingUpdates.length === 0, 'Zero participants contest finalized with 0 updates');
    assert(emptyFinalize.finalResultsSnapshot.totalParticipants === 0, 'Snapshot reflects 0 participants');

    // H.5 Unrated contest finalization: record standings & snapshot without rating changes
    const unratedContest = await createTestContest({
      title: 'Unrated Contest Finalization',
      createdBy: profE.id,
      status: 'published',
      isRated: false,
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
    });
    const sUnrated = await createTestUser('student', { currentRating: 1200 });
    await ContestModel.addParticipant(unratedContest.id, sUnrated.id);

    const unratedFinalize = await RatingService.finalizeContestRatings(unratedContest.id, profE);
    assert(unratedFinalize.isRated === false, 'Unrated contest returns isRated: false');
    assert(unratedFinalize.ratingUpdates.length === 0, 'Unrated contest produces 0 rating updates');
    const sUnratedSummary = await RatingModel.getUserRatingSummary(sUnrated.id);
    assert(sUnratedSummary.currentRating === 1200, 'Student rating unchanged after unrated contest finalization');
    const unratedHistory = await RatingModel.getRatingHistoryByUser(sUnrated.id);
    assert(unratedHistory.length === 0, 'Zero rating history records created for unrated contest');

    // ---------------------------------------------------------
    // TEST SECTION J: Large Participant Sets (10, 100, 101, 250, 500, 1000)
    // ---------------------------------------------------------
    console.log('\n--- Step J: Large Participant Sets ---');

    function generateParticipantRoster(n) {
      return Array.from({ length: n }, (_, i) => ({
        userId: 10000 + i,
        username: `competitor_${i + 1}`,
        currentRating: 1000 + (i % 50) * 10,
        highestRating: 1500,
        ratingStatus: i % 2 === 0 ? 'rated' : 'provisional',
        ratedContestCount: i % 2 === 0 ? 10 : 2,
        rank: Math.floor(i / 2) + 1,
        totalScore: (n - i) * 10,
        totalTimeMs: i * 500,
      }));
    }

    const sizes = [10, 100, 101, 250, 500, 1000];
    for (const size of sizes) {
      const roster = generateParticipantRoster(size);
      const start = performance.now();
      const calculated = RatingService.calculateRatingChanges(roster);
      const duration = performance.now() - start;

      assert(calculated.length === size, `N = ${size}: Processed all ${size} participants without truncation`);
      assert(duration < 250, `N = ${size}: Executed in ${duration.toFixed(2)}ms (< 250ms target)`);
      assert(calculated.every(p => Number.isFinite(p.newRating)), `N = ${size}: All calculated new ratings are finite`);
    }

    // ---------------------------------------------------------
    // TEST SECTION K: Order Independence & Determinism
    // ---------------------------------------------------------
    console.log('\n--- Step K: Order Independence & Determinism ---');

    // Test order independence with 4 diverse participants across permutations [A, B, C, D], [D, B, A, C], [C, A, D, B]
    const pA = { userId: 801, currentRating: 1200, rank: 1, ratedContestCount: 10 };
    const pB = { userId: 802, currentRating: 1300, rank: 2, ratedContestCount: 10 };
    const pC = { userId: 803, currentRating: 1400, rank: 3, ratedContestCount: 10 };
    const pD = { userId: 804, currentRating: 1500, rank: 4, ratedContestCount: 10 };

    const order1 = [pA, pB, pC, pD];
    const order2 = [pD, pB, pA, pC];
    const order3 = [pC, pA, pD, pB];

    const out1 = RatingService.calculateRatingChanges(order1);
    const out2 = RatingService.calculateRatingChanges(order2);
    const out3 = RatingService.calculateRatingChanges(order3);

    const map1 = new Map(out1.map(p => [p.userId, p.ratingChange]));
    const map2 = new Map(out2.map(p => [p.userId, p.ratingChange]));
    const map3 = new Map(out3.map(p => [p.userId, p.ratingChange]));

    let permIdentical = true;
    for (const id of [801, 802, 803, 804]) {
      if (map1.get(id) !== map2.get(id) || map1.get(id) !== map3.get(id)) {
        permIdentical = false;
      }
    }
    assert(permIdentical, 'Input permutations [A,B,C,D], [D,B,A,C], [C,A,D,B] produce 100% identical rating changes');

    // Shuffled larger roster
    const sampleRoster = generateParticipantRoster(50);
    const initialRun = RatingService.calculateRatingChanges(sampleRoster);

    let allIdentical = true;
    for (let r = 0; r < 5; r++) {
      const shuffled = [...sampleRoster].sort(() => Math.random() - 0.5);
      const repeatRun = RatingService.calculateRatingChanges(shuffled);

      const initialMap = new Map(initialRun.map(p => [p.userId, p.ratingChange]));
      for (const p of repeatRun) {
        if (initialMap.get(p.userId) !== p.ratingChange) {
          allIdentical = false;
          break;
        }
      }
    }
    assert(allIdentical, '5 consecutive randomized order runs produced 100% identical rating changes');

    // ---------------------------------------------------------
    // TEST SECTION L & M: Concurrent & Repeated Finalization
    // ---------------------------------------------------------
    console.log('\n--- Step L & M: Concurrent & Repeated Finalization ---');

    const profLM = await createTestUser('professor');
    const sLM1 = await createTestUser('student', { currentRating: 1200 });
    const sLM2 = await createTestUser('student', { currentRating: 1200 });

    const contestLM = await createTestContest({
      title: 'Concurrency & Duplicate History Contest',
      createdBy: profLM.id,
      status: 'published',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      isRated: true,
    });
    await ContestModel.addParticipant(contestLM.id, sLM1.id);
    await ContestModel.addParticipant(contestLM.id, sLM2.id);

    // L.1 Concurrent finalization calls serialized by row-level FOR UPDATE
    const [cRes1, cRes2] = await Promise.all([
      RatingService.finalizeContestRatings(contestLM.id, profLM),
      RatingService.finalizeContestRatings(contestLM.id, profLM),
    ]);

    const hasInitial = (cRes1.ratingUpdates && !cRes1.alreadyFinalized) || (cRes2.ratingUpdates && !cRes2.alreadyFinalized);
    const hasIdempotent = cRes1.alreadyFinalized || cRes2.alreadyFinalized;
    assert(hasInitial && hasIdempotent, 'Concurrent requests: one executes finalization, the other receives alreadyFinalized');

    // L.2 Repeated finalization returns alreadyFinalized (idempotency)
    const repeatedCall = await RatingService.finalizeContestRatings(contestLM.id, profLM);
    assert(repeatedCall.alreadyFinalized === true, 'Repeated call returns alreadyFinalized: true');

    // M.1 Duplicate history check in database
    const historyRows = await db.query(
      `SELECT * FROM rating_history WHERE contest_id = $1;`,
      [contestLM.id]
    );
    assert(historyRows.rowCount === 2, 'Exactly 2 rating_history rows exist in database (no duplicates)');

    // ---------------------------------------------------------
    // TEST SECTION N: Client Tampering & Security
    // ---------------------------------------------------------
    console.log('\n--- Step N: Client Tampering & Security ---');

    const sLM1Token = generateToken(sLM1);
    const profLMToken = generateToken(profLM);

    // N.1 Client submitting custom rating delta / score / rank ignored by server
    const tamperRes = await request(
      'POST',
      `/api/contests/${contestLM.id}/finalize-ratings`,
      {
        customScore: 9999,
        customRank: 1,
        customRatingChange: 500,
        customRating: 2500,
      },
      profLMToken
    );
    assert(tamperRes.status === 200, 'Endpoint accepts request without error');
    assert(tamperRes.body.alreadyFinalized === true, 'Server ignores client fields and returns authoritative cached snapshot');

    // N.2 Student cannot call finalization (403 Forbidden)
    const studentTamperRes = await request(
      'POST',
      `/api/contests/${contestLM.id}/finalize-ratings`,
      { customRating: 2500 },
      sLM1Token
    );
    assert(studentTamperRes.status === 403, 'Student blocked with 403 Forbidden from finalization');

    // ---------------------------------------------------------
    // TEST SECTION O: Current-Rating and History Consistency
    // ---------------------------------------------------------
    console.log('\n--- Step O: Current-Rating and History Consistency ---');

    const sLM1Summary = await RatingModel.getUserRatingSummary(sLM1.id);
    const sLM1History = await RatingModel.getRatingHistoryByUser(sLM1.id);
    assert(sLM1History.length === 1, 'Participant 1 has exactly 1 rating history record');
    const h1 = sLM1History[0];
    assert(
      sLM1Summary.currentRating === h1.previousRating + h1.ratingChange,
      `User current rating (${sLM1Summary.currentRating}) matches previousRating (${h1.previousRating}) + delta (${h1.ratingChange})`
    );
    assert(sLM1Summary.currentRating === h1.newRating, 'User current rating equals history newRating');

    console.log('\n================================================================');
    console.log(` Focused Test Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('================================================================');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    // ---------------------------------------------------------
    // TEST SECTION P: Automated Teardown & Baseline Protection
    // ---------------------------------------------------------
    console.log('\n--- Step P: Automated Teardown & Baseline Protection ---');
    try {
      if (createdContestIds.length > 0) {
        await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[]);`, [createdContestIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [createdUserIds]);
      }
      console.log(`  [CLEANUP] Successfully cleaned ${createdContestIds.length} test contests and ${createdUserIds.length} test users.`);
    } catch (cleanupErr) {
      console.error('Teardown cleanup error:', cleanupErr);
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
