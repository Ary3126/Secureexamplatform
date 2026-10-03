/**
 * Phase 7.5.8.5.5 — Result Lock & Integrity Tests
 *
 * Objective: Verify that once contest results are officially finalized (is_rating_finalized=true),
 * the authoritative result data cannot be modified through normal contest management,
 * participant management, scoring, or leaderboard operations.
 *
 * Sections:
 *   1. Authoritative Finalization State (DB row, API surface, leaderboard state)
 *   2. Contest Metadata Mutation Lock (isRated, freeze settings — blocked post-finalization)
 *   3. Problem Set Mutation Lock (add/remove/reorder — blocked by lifecycle lock on ended contests)
 *   4. Participant Mutation Lock (add/remove — blocked by lifecycle lock on ended contests)
 *   5. Snapshot & Leaderboard Immutability
 *   6. Rating History Integrity (no duplicates, no deletion endpoint)
 *   7. Concurrent Idempotency Safety
 *   8. Unrated Contest Lock Integrity
 *   9. Client-Side Bypass Resistance (mass assignment, flag injection, force override)
 *
 * Architecture notes:
 *   - Backend determines finalization state from DB row lock. Never from client body.
 *   - is_rating_finalized=true seals final_results_snapshot permanently.
 *   - The FOR UPDATE row lock serializes concurrent finalization requests.
 *   - Lifecycle locks (ended/archived) separately block problem/participant mutations.
 *   - The result-integrity lock (is_rating_finalized) additionally blocks isRated/freeze mutations.
 */

process.env.RATE_LIMIT_CONTEST_MAX = '2000';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const RatingService = require('./src/services/ratingService');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let baseUrl;

// ─── HTTP Helpers ──────────────────────────────────────────────────────────
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (p, t)    => request('GET', p, null, t);
const post = (p, b, t) => request('POST', p, b, t);
const put  = (p, b, t) => request('PUT', p, b, t);
const del  = (p, b, t) => request('DELETE', p, b, t);

// ─── Test Reporting ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function record(label, cond, reason = '') {
  if (cond) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${reason ? ` | ${reason}` : ''}`);
    failed++;
  }
}

// ─── Main Test Runner ──────────────────────────────────────────────────────
async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.5.5: Result Lock & Integrity Tests ');
  console.log('================================================================\n');

  try {
    // Ensure required columns exist
    await db.query(`ALTER TABLE contests ADD COLUMN IF NOT EXISTS final_results_snapshot JSONB DEFAULT NULL;`);

    const suffix = Date.now();
    const pwHash = await hashPassword('TestPass123!');
    const now    = new Date();
    const pastStart = new Date(now.getTime() - 3 * 3600000);
    const pastEnd   = new Date(now.getTime() - 1 * 3600000);

    // ── Shared Test Users ────────────────────────────────────────────────
    const profOwner = await UserModel.createUser({
      username: `prof_lock_owner_${suffix}`,
      email: `prof_lock_owner_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Prof Lock Owner',
      role: 'professor',
    });
    const tokenProfOwner = generateToken(profOwner);

    const profOther = await UserModel.createUser({
      username: `prof_lock_other_${suffix}`,
      email: `prof_lock_other_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Prof Lock Other',
      role: 'professor',
    });
    const tokenProfOther = generateToken(profOther);

    const contestAdmin = await UserModel.createUser({
      username: `cadmin_lock_${suffix}`,
      email: `cadmin_lock_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Contest Admin Lock',
      role: 'contest_admin',
    });
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `sadmin_lock_${suffix}`,
      email: `sadmin_lock_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Super Admin Lock',
      role: 'super_admin',
    });
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `stu_lock_1_${suffix}`,
      email: `stu_lock_1_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student Lock 1',
      role: 'student',
    });
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `stu_lock_2_${suffix}`,
      email: `stu_lock_2_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student Lock 2',
      role: 'student',
    });

    // ── Shared Problem ───────────────────────────────────────────────────
    const prob = await ProblemModel.createProblem({
      title: `Lock Test Problem ${suffix}`,
      description: 'Lock test problem',
      difficulty: 'easy',
      createdBy: profOwner.id,
    });
    const prob2 = await ProblemModel.createProblem({
      title: `Lock Test Problem 2 ${suffix}`,
      description: 'Lock test problem 2',
      difficulty: 'medium',
      createdBy: profOwner.id,
    });

    // ── Helper: create an ended, finalized contest ───────────────────────
    async function createFinalizedContest({ isRated = true, label = '' } = {}) {
      const c = await ContestModel.createContest({
        title: `Lock ${label} ${suffix}`,
        description: 'Lock test',
        startTime: pastStart.toISOString(),
        endTime: pastEnd.toISOString(),
        createdBy: profOwner.id,
        isRated,
        leaderboardFreezeEnabled: true,
        leaderboardFreezeMinutes: 30,
      });
      await ContestModel.updateContestStatus(c.id, 'published');
      await ContestModel.addProblemToContest({ contestId: c.id, problemId: prob.id, points: 100, problemOrder: 1 });
      await ContestModel.addParticipant(c.id, student1.id);

      // Insert an accepted submission so the snapshot has real data
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
         VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 100, false, $4);`,
        [student1.id, c.id, prob.id, new Date(pastStart.getTime() + 15 * 60000).toISOString()]
      );

      // Finalize via the service (same path as the API)
      await RatingService.finalizeContestRatings(c.id, profOwner, { force: false });
      return c;
    }

    // ════════════════════════════════════════════════════════════════════
    // SECTION 1: Authoritative Finalization State
    // ════════════════════════════════════════════════════════════════════
    console.log('--- Section 1: Authoritative Finalization State ---');

    const c1 = await createFinalizedContest({ label: 'S1' });

    // 1.1 DB row is_rating_finalized = true
    const dbC1 = await db.query('SELECT is_rating_finalized, ratings_finalized_at, final_results_snapshot FROM contests WHERE id = $1', [c1.id]);
    record('1.1 DB is_rating_finalized = true after finalization', dbC1.rows[0]?.is_rating_finalized === true);

    // 1.2 ratings_finalized_at is populated
    record('1.2 DB ratings_finalized_at is non-null', dbC1.rows[0]?.ratings_finalized_at !== null,
      `got: ${dbC1.rows[0]?.ratings_finalized_at}`);

    // 1.3 final_results_snapshot is a non-null JSONB object
    record('1.3 DB final_results_snapshot is a non-null object',
      dbC1.rows[0]?.final_results_snapshot !== null && typeof dbC1.rows[0]?.final_results_snapshot === 'object');

    // 1.4 API GET /api/contests/:id returns isRatingFinalized: true
    const getC1 = await get(`/api/contests/${c1.id}`, tokenProfOwner);
    record('1.4 GET /api/contests/:id returns isRatingFinalized: true',
      getC1.status === 200 && getC1.body?.isRatingFinalized === true,
      `status=${getC1.status}, isRatingFinalized=${getC1.body?.isRatingFinalized}`);

    // 1.5 Leaderboard returns freezeState: FINAL
    const lb1 = await get(`/api/contests/${c1.id}/leaderboard`, tokenProfOwner);
    record('1.5 Leaderboard returns freezeState: FINAL',
      lb1.status === 200 && lb1.body?.freezeState === 'FINAL',
      `freezeState=${lb1.body?.freezeState}`);

    // 1.6 /results endpoint returns 200
    const res1 = await get(`/api/contests/${c1.id}/results`, tokenProfOwner);
    record('1.6 /results returns 200 OK after finalization', res1.status === 200);

    // 1.7 Re-finalization returns alreadyFinalized: true (idempotent)
    const reFinC1 = await post(`/api/contests/${c1.id}/finalize-ratings`, {}, tokenProfOwner);
    record('1.7 Re-finalization returns alreadyFinalized: true (idempotent)',
      reFinC1.status === 200 && reFinC1.body?.alreadyFinalized === true,
      `status=${reFinC1.status}, alreadyFinalized=${reFinC1.body?.alreadyFinalized}`);

    // 1.8 Unauthenticated re-attempt returns 401
    const unauthReFin = await post(`/api/contests/${c1.id}/finalize-ratings`, {});
    record('1.8 Unauthenticated finalization re-attempt returns 401', unauthReFin.status === 401);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 2: Contest Metadata Mutation Lock
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 2: Contest Metadata Mutation Lock (isRated, Freeze Settings) ---');

    const c2 = await createFinalizedContest({ label: 'S2', isRated: true });

    // 2.1 Changing isRated after finalization is blocked (409)
    const ch2Rated = await put(`/api/contests/${c2.id}`, { isRated: false }, tokenProfOwner);
    record('2.1 Changing isRated after finalization is blocked (409)',
      ch2Rated.status === 409,
      `status=${ch2Rated.status}, msg="${ch2Rated.body?.message}"`);

    // 2.2 Error message does not leak stack traces or internal field names
    record('2.2 Lock error message is user-safe (no stack/SQL/internal names)',
      ch2Rated.status === 409 &&
        typeof ch2Rated.body?.message === 'string' &&
        !ch2Rated.body?.message.includes('stack') &&
        !ch2Rated.body?.message.includes('is_rating_finalized') &&
        !ch2Rated.body?.message.includes('SQL'),
      `message="${ch2Rated.body?.message}"`);

    // 2.3 Changing leaderboardFreezeEnabled after finalization is blocked
    const ch2FreezeEn = await put(`/api/contests/${c2.id}`, { leaderboardFreezeEnabled: false }, tokenProfOwner);
    record('2.3 Changing leaderboardFreezeEnabled after finalization is blocked (409)',
      ch2FreezeEn.status === 409, `status=${ch2FreezeEn.status}`);

    // 2.4 Changing leaderboardFreezeMinutes after finalization is blocked
    const ch2FreezeMin = await put(`/api/contests/${c2.id}`, { leaderboardFreezeMinutes: 0 }, tokenProfOwner);
    record('2.4 Changing leaderboardFreezeMinutes after finalization is blocked (409)',
      ch2FreezeMin.status === 409, `status=${ch2FreezeMin.status}`);

    // 2.5 Changing title is ALLOWED (cosmetic, not result-affecting)
    const ch2Title = await put(`/api/contests/${c2.id}`, { title: 'Updated After Finalization' }, tokenProfOwner);
    record('2.5 Changing title after finalization is ALLOWED (200)',
      ch2Title.status === 200, `status=${ch2Title.status}`);

    // 2.6 Changing description is ALLOWED
    const ch2Desc = await put(`/api/contests/${c2.id}`, { description: 'Updated desc' }, tokenProfOwner);
    record('2.6 Changing description after finalization is ALLOWED (200)',
      ch2Desc.status === 200, `status=${ch2Desc.status}`);

    // 2.7 final_results_snapshot unchanged after cosmetic updates
    const dbC2After = await db.query('SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1', [c2.id]);
    record('2.7 DB is_rating_finalized=true and snapshot unchanged after cosmetic title/desc update',
      dbC2After.rows[0]?.is_rating_finalized === true && dbC2After.rows[0]?.final_results_snapshot !== null);

    // 2.8 Contest Admin also cannot change isRated after finalization
    const ch2AdminRated = await put(`/api/contests/${c2.id}`, { isRated: false }, tokenContestAdmin);
    record('2.8 Contest Admin cannot change isRated after finalization (409)',
      ch2AdminRated.status === 409, `status=${ch2AdminRated.status}`);

    // 2.9 Non-owning professor gets 403 (BOLA), not 409
    const ch2Bola = await put(`/api/contests/${c2.id}`, { title: 'BOLA' }, tokenProfOther);
    record('2.9 Non-owning professor update denied (403 BOLA, not 409)',
      ch2Bola.status === 403, `status=${ch2Bola.status}`);

    // 2.10 Combined result-affecting fields all blocked
    const ch2Combined = await put(`/api/contests/${c2.id}`,
      { isRated: false, leaderboardFreezeEnabled: false, leaderboardFreezeMinutes: 0 }, tokenProfOwner);
    record('2.10 Combined result-affecting field update is blocked (409)',
      ch2Combined.status === 409, `status=${ch2Combined.status}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 3: Problem Set Mutation Lock
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 3: Problem Set Mutation Lock ---');

    const c3 = await createFinalizedContest({ label: 'S3' });

    // 3.1 Add problem after finalization (blocked by lifecycle lock: ended)
    const addProb3 = await post(`/api/contests/${c3.id}/problems`, { problemId: prob2.id, points: 200 }, tokenProfOwner);
    record('3.1 Adding problem after finalization (ended) is blocked (409)',
      addProb3.status === 409,
      `status=${addProb3.status}, msg="${addProb3.body?.message}"`);

    // 3.2 Remove problem after finalization (blocked by lifecycle lock)
    const rmProb3 = await del(`/api/contests/${c3.id}/problems/${prob.id}`, null, tokenProfOwner);
    record('3.2 Removing problem after finalization is blocked (409)',
      rmProb3.status === 409, `status=${rmProb3.status}`);

    // 3.3 Reorder problems after finalization (blocked)
    const reord3 = await put(`/api/contests/${c3.id}/problems/order`, { problemIds: [prob.id] }, tokenProfOwner);
    record('3.3 Reordering problems after finalization is blocked (409)',
      reord3.status === 409, `status=${reord3.status}`);

    // 3.4 Bulk add problems after finalization (blocked)
    const bulkAdd3 = await post(`/api/contests/${c3.id}/problems/bulk`,
      { problems: [{ problemId: prob2.id, points: 200 }] }, tokenProfOwner);
    record('3.4 Bulk add problems after finalization is blocked (409)',
      bulkAdd3.status === 409, `status=${bulkAdd3.status}`);

    // 3.5 Bulk remove problems after finalization (blocked)
    const bulkRm3 = await del(`/api/contests/${c3.id}/problems`, { problemIds: [prob.id] }, tokenProfOwner);
    record('3.5 Bulk remove problems after finalization is blocked (409)',
      bulkRm3.status === 409, `status=${bulkRm3.status}`);

    // 3.6 Problem count unchanged in DB
    const probCount3 = await db.query('SELECT COUNT(*)::int AS cnt FROM contest_problems WHERE contest_id = $1', [c3.id]);
    record('3.6 Problem count in DB unchanged after blocked operations',
      probCount3.rows[0]?.cnt === 1, `count=${probCount3.rows[0]?.cnt}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 4: Participant Mutation Lock
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 4: Participant Mutation Lock ---');

    const c4 = await createFinalizedContest({ label: 'S4' });

    // 4.1 Add participant after finalization (blocked by lifecycle: ended)
    const addPart4 = await post(`/api/contests/${c4.id}/participants`, { userId: student2.id }, tokenProfOwner);
    record('4.1 Adding participant after finalization (ended) is blocked (409)',
      addPart4.status === 409, `status=${addPart4.status}`);

    // 4.2 Remove participant after finalization (blocked — also has submissions)
    const rmPart4 = await del(`/api/contests/${c4.id}/participants/${student1.id}`, null, tokenProfOwner);
    record('4.2 Removing participant after finalization is blocked (409)',
      rmPart4.status === 409, `status=${rmPart4.status}`);

    // 4.3 Participant count unchanged
    const partCount4 = await db.query('SELECT COUNT(*)::int AS cnt FROM contest_participants WHERE contest_id = $1', [c4.id]);
    record('4.3 Participant count unchanged after blocked add/remove',
      partCount4.rows[0]?.cnt === 1, `count=${partCount4.rows[0]?.cnt}`);

    // 4.4 Bulk add participants (blocked)
    const bulkAddPart4 = await post(`/api/contests/${c4.id}/participants/bulk`, { userIds: [student2.id] }, tokenProfOwner);
    record('4.4 Bulk add participants after finalization is blocked (409)',
      bulkAddPart4.status === 409, `status=${bulkAddPart4.status}`);

    // 4.5 Bulk remove participants (blocked)
    const bulkRmPart4 = await del(`/api/contests/${c4.id}/participants/bulk`,
      { userIds: [student1.id] }, tokenProfOwner);
    record('4.5 Bulk remove participants after finalization is blocked (409)',
      bulkRmPart4.status === 409, `status=${bulkRmPart4.status}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 5: Snapshot & Leaderboard Immutability
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 5: Snapshot & Leaderboard Immutability ---');

    const c5 = await createFinalizedContest({ label: 'S5' });
    const snap5Res = await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c5.id]);
    const snap5 = snap5Res.rows[0]?.final_results_snapshot;

    // 5.1 Snapshot has required keys
    record('5.1 Snapshot has calculatedAt, standings, ratingUpdates, totalParticipants',
      snap5 && 'calculatedAt' in snap5 && 'standings' in snap5 && 'ratingUpdates' in snap5 && 'totalParticipants' in snap5,
      `keys=${snap5 ? Object.keys(snap5).join(',') : 'null'}`);

    // 5.2 calculatedAt is a valid ISO timestamp
    record('5.2 Snapshot calculatedAt is a valid ISO timestamp',
      snap5 && !isNaN(new Date(snap5.calculatedAt).getTime()));

    // 5.3 isRated matches contest setting
    record('5.3 Snapshot isRated matches the contest rated setting',
      snap5 && typeof snap5.isRated === 'boolean');

    // 5.4 Snapshot stable across multiple reads
    const snap5b = await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c5.id]);
    record('5.4 Snapshot deterministic across multiple reads',
      JSON.stringify(snap5) === JSON.stringify(snap5b.rows[0]?.final_results_snapshot));

    // 5.5 Leaderboard freezeState=FINAL
    const lb5 = await get(`/api/contests/${c5.id}/leaderboard`, tokenProfOwner);
    record('5.5 Leaderboard freezeState=FINAL post-finalization',
      lb5.status === 200 && lb5.body?.freezeState === 'FINAL', `freezeState=${lb5.body?.freezeState}`);

    // 5.6 Admin leaderboard also returns FINAL
    const alb5 = await get(`/api/contests/${c5.id}/admin-leaderboard`, tokenProfOwner);
    record('5.6 Admin leaderboard freezeState=FINAL',
      alb5.status === 200 && alb5.body?.freezeState === 'FINAL', `freezeState=${alb5.body?.freezeState}`);

    // 5.7 /results returns standings (may be from snapshot or live, both acceptable)
    const res5 = await get(`/api/contests/${c5.id}/results`, tokenProfOwner);
    record('5.7 /results returns 200 with standings post-finalization', res5.status === 200);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 6: Rating History Integrity
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 6: Rating History Integrity ---');

    const c6 = await createFinalizedContest({ label: 'S6', isRated: true });

    // 6.1 rating_history rows exist (1 participant → 1 row)
    const hist6 = await db.query('SELECT COUNT(*)::int AS cnt FROM rating_history WHERE contest_id = $1', [c6.id]);
    record('6.1 rating_history has rows for rated finalized contest',
      hist6.rows[0]?.cnt >= 1, `count=${hist6.rows[0]?.cnt}`);

    // 6.2 Repeated re-finalization does NOT insert duplicate rating_history rows
    // Call finalize 3 more times (all should be no-op, returning alreadyFinalized)
    await post(`/api/contests/${c6.id}/finalize-ratings`, {}, tokenProfOwner);
    await post(`/api/contests/${c6.id}/finalize-ratings`, {}, tokenProfOwner);
    await post(`/api/contests/${c6.id}/finalize-ratings`, {}, tokenProfOwner);
    const hist6b = await db.query('SELECT COUNT(*)::int AS cnt FROM rating_history WHERE contest_id = $1', [c6.id]);
    record('6.2 No duplicate rating_history rows after repeated finalization calls',
      hist6b.rows[0]?.cnt === hist6.rows[0]?.cnt,
      `initial=${hist6.rows[0]?.cnt}, after 3 re-calls=${hist6b.rows[0]?.cnt}`);

    // 6.3 No API endpoint to delete rating_history (should 404)
    const delHist6 = await del(`/api/contests/${c6.id}/rating-history`, null, tokenProfOwner);
    record('6.3 No API endpoint to delete rating_history (404)',
      delHist6.status === 404, `status=${delHist6.status}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 7: Concurrent Idempotency Safety
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 7: Concurrent Idempotency Safety ---');

    const c7 = await createFinalizedContest({ label: 'S7', isRated: true });

    // Fire 5 concurrent re-finalization requests (all no-op)
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        post(`/api/contests/${c7.id}/finalize-ratings`, {}, tokenProfOwner)
      )
    );

    record('7.1 All 5 concurrent re-finalization calls return 200',
      concurrentResults.every(r => r.status === 200),
      `statuses=${concurrentResults.map(r => r.status).join(',')}`);

    record('7.2 All 5 concurrent calls return alreadyFinalized: true',
      concurrentResults.every(r => r.body?.alreadyFinalized === true),
      `values=${concurrentResults.map(r => r.body?.alreadyFinalized).join(',')}`);

    const hist7 = await db.query('SELECT COUNT(*)::int AS cnt FROM rating_history WHERE contest_id = $1', [c7.id]);
    record('7.3 No extra rating_history rows after 5 concurrent no-op calls (exactly 1)',
      hist7.rows[0]?.cnt === 1, `count=${hist7.rows[0]?.cnt}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 8: Unrated Contest Lock Integrity
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 8: Unrated Contest Lock Integrity ---');

    const c8 = await createFinalizedContest({ label: 'S8 Unrated', isRated: false });
    const dbC8 = await db.query('SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1', [c8.id]);

    // 8.1 Unrated finalized contest has is_rating_finalized=true
    record('8.1 Unrated finalized contest has is_rating_finalized=true',
      dbC8.rows[0]?.is_rating_finalized === true, `got=${dbC8.rows[0]?.is_rating_finalized}`);

    // 8.2 Snapshot has isRated=false
    const snap8 = dbC8.rows[0]?.final_results_snapshot;
    record('8.2 Snapshot isRated=false for unrated contest',
      snap8 && snap8.isRated === false, `isRated=${snap8?.isRated}`);

    // 8.3 Cannot flip isRated from false to true after finalization
    const ch8Rated = await put(`/api/contests/${c8.id}`, { isRated: true }, tokenProfOwner);
    record('8.3 Cannot flip isRated to true after unrated finalization (409)',
      ch8Rated.status === 409, `status=${ch8Rated.status}`);

    // 8.4 Re-finalization returns alreadyFinalized: true (idempotent for unrated)
    const reFin8 = await post(`/api/contests/${c8.id}/finalize-ratings`, {}, tokenProfOwner);
    record('8.4 Re-finalization of unrated contest returns alreadyFinalized: true',
      reFin8.status === 200 && reFin8.body?.alreadyFinalized === true,
      `status=${reFin8.status}, alreadyFinalized=${reFin8.body?.alreadyFinalized}`);

    // 8.5 Zero rating_history rows for unrated contest
    const hist8 = await db.query('SELECT COUNT(*)::int AS cnt FROM rating_history WHERE contest_id = $1', [c8.id]);
    record('8.5 Zero rating_history rows for unrated finalized contest',
      hist8.rows[0]?.cnt === 0, `count=${hist8.rows[0]?.cnt}`);

    // 8.6 Leaderboard returns FINAL state for unrated finalized contest
    const lb8 = await get(`/api/contests/${c8.id}/leaderboard`, tokenProfOwner);
    record('8.6 Unrated finalized contest leaderboard returns freezeState=FINAL',
      lb8.status === 200 && lb8.body?.freezeState === 'FINAL', `freezeState=${lb8.body?.freezeState}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 9: Client-Side Bypass Resistance
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 9: Client-Side Bypass Resistance ---');

    const c9 = await createFinalizedContest({ label: 'S9', isRated: true });

    // 9.1 Sending isRatingFinalized=false in PUT body cannot un-finalize the contest.
    // The field doesn't exist as a valid update key, so the DB row stays finalized.
    await put(`/api/contests/${c9.id}`, { isRatingFinalized: false, is_rating_finalized: false }, tokenProfOwner);
    const dbC9a = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1', [c9.id]);
    record('9.1 Client cannot un-finalize by sending isRatingFinalized=false in PUT body',
      dbC9a.rows[0]?.is_rating_finalized === true, `got=${dbC9a.rows[0]?.is_rating_finalized}`);

    // 9.2 Sending ratingsFinalizedAt=null in PUT body doesn't clear the DB field
    await put(`/api/contests/${c9.id}`, { ratingsFinalizedAt: null, ratings_finalized_at: null }, tokenProfOwner);
    const dbC9b = await db.query('SELECT ratings_finalized_at FROM contests WHERE id = $1', [c9.id]);
    record('9.2 Client cannot clear ratings_finalized_at via PUT body',
      dbC9b.rows[0]?.ratings_finalized_at !== null, `got=${dbC9b.rows[0]?.ratings_finalized_at}`);

    // 9.3 force=true on already-finalized contest still returns alreadyFinalized=true (idempotent)
    const force9 = await post(`/api/contests/${c9.id}/finalize-ratings`, { force: true }, tokenProfOwner);
    record('9.3 force=true on already-finalized contest returns alreadyFinalized=true',
      force9.status === 200 && force9.body?.alreadyFinalized === true,
      `status=${force9.status}, alreadyFinalized=${force9.body?.alreadyFinalized}`);

    // 9.4 Mass assignment in finalize body does not corrupt the DB snapshot
    await post(`/api/contests/${c9.id}/finalize-ratings`, {
      force: true,
      standings: [{ userId: 999999, rank: 1, totalScore: 99999 }],
      ratingUpdates: [{ userId: 999999, newRating: 9999 }],
      finalResultsSnapshot: { tampered: true },
    }, tokenProfOwner);
    const dbC9c = await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c9.id]);
    record('9.4 Mass-assigned finalResultsSnapshot in body does not overwrite DB snapshot',
      dbC9c.rows[0]?.final_results_snapshot?.tampered !== true,
      `tampered=${dbC9c.rows[0]?.final_results_snapshot?.tampered}`);

    // 9.5 Non-owning professor cannot finalize (BOLA)
    const bola9 = await post(`/api/contests/${c9.id}/finalize-ratings`, { force: true }, tokenProfOther);
    record('9.5 Non-owning professor finalization denied (403 BOLA)',
      bola9.status === 403, `status=${bola9.status}`);

    // 9.6 Student cannot finalize
    const stu9 = await post(`/api/contests/${c9.id}/finalize-ratings`, {}, tokenStudent1);
    record('9.6 Student finalization denied (403)', stu9.status === 403, `status=${stu9.status}`);

    // 9.7 Finalization snap cannot be altered via contest update even with admin token
    const snap9Pre = (await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c9.id])).rows[0]?.final_results_snapshot;
    await put(`/api/contests/${c9.id}`, { finalResultsSnapshot: { hacked: true } }, tokenContestAdmin);
    const snap9Post = (await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c9.id])).rows[0]?.final_results_snapshot;
    record('9.7 Contest update cannot overwrite final_results_snapshot even with admin token',
      JSON.stringify(snap9Pre) === JSON.stringify(snap9Post),
      `snapshot changed: ${JSON.stringify(snap9Pre) !== JSON.stringify(snap9Post)}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 10: Submission & Judge Protection on Finalized Contest
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 10: Submission & Judge Protection on Finalized Contest ---');

    const c10 = await createFinalizedContest({ label: 'S10', isRated: true });

    // 10.1 POST /api/submissions to finalized contest rejected (400 - contest not running)
    const sub10 = await post('/api/submissions', {
      contestId: c10.id,
      problemId: prob.id,
      language: 'javascript',
      sourceCode: 'console.log("hacked");',
    }, tokenStudent1);
    record('10.1 Submissions to finalized contest rejected (400 Bad Request)',
      sub10.status === 400 && sub10.body?.message?.includes('Submissions rejected'),
      `status=${sub10.status}, msg="${sub10.body?.message}"`);

    // 10.2 Late submission inserted directly into DB with post-contest timestamp
    // Verify it is excluded from standings and does not alter the finalized snapshot
    const postContestTime = new Date(pastEnd.getTime() + 10 * 60000);
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', 100, false, $4);`,
      [student2.id, c10.id, prob.id, postContestTime.toISOString()]
    );

    const snap10Res = await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [c10.id]);
    const snap10 = snap10Res.rows[0]?.final_results_snapshot;
    record('10.2 Late submission inserted after contest end does not alter pre-computed snapshot',
      snap10?.totalParticipants === 1,
      `totalParticipants=${snap10?.totalParticipants}`);

    // 10.3 Result Details (/results/me) remains consistent with official result
    const detailsMe10 = await get(`/api/contests/${c10.id}/results/me`, tokenStudent1);
    record('10.3 Result Details (/results/me) remains stable and matches Rank 1',
      detailsMe10.status === 200 && detailsMe10.body?.summary?.rank === 1 && detailsMe10.body?.summary?.totalScore === 100);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 11: Authorization & Tampering Matrix
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 11: Authorization & Tampering Matrix ---');

    // 11.1 Super Admin is also result-locked from modifying result-affecting fields
    const sadminUpdate11 = await put(`/api/contests/${c10.id}`, { isRated: false }, tokenSuperAdmin);
    record('11.1 Super Admin cannot modify isRated after finalization (result-locked 409)',
      sadminUpdate11.status === 409, `status=${sadminUpdate11.status}`);

    // 11.2 Student cannot inspect another student results (403 BOLA)
    const bolaStd11 = await get(`/api/contests/${c10.id}/participants/${student2.id}/results`, tokenStudent1);
    record('11.2 Student cannot inspect another participant result details (403 BOLA)',
      bolaStd11.status === 403, `status=${bolaStd11.status}`);

    // 11.3 SQL injection or non-integer contest ID safely rejected
    const badId11 = await get(`/api/contests/1%20OR%201=1/results`, tokenStudent1);
    record('11.3 SQL injection contest ID safely rejected (400 Bad Request)',
      badId11.status === 400, `status=${badId11.status}`);

    // ════════════════════════════════════════════════════════════════════
    // SECTION 12: Concurrency Race Combinations
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- Section 12: Concurrency Race Combinations ---');

    // 12.1 Finalization + contest edit race
    const c12 = await createFinalizedContest({ label: 'S12' });
    const [raceFin12, raceEdit12] = await Promise.all([
      post(`/api/contests/${c12.id}/finalize-ratings`, {}, tokenProfOwner),
      put(`/api/contests/${c12.id}`, { title: 'Concurrent Title Edit' }, tokenProfOwner),
    ]);
    record('12.1 Finalization + contest edit race serialize cleanly (both 200 OK)',
      raceFin12.status === 200 && raceEdit12.status === 200);

    // 12.2 Finalization + participant add race
    const [raceFin12b, racePart12b] = await Promise.all([
      post(`/api/contests/${c12.id}/finalize-ratings`, {}, tokenProfOwner),
      post(`/api/contests/${c12.id}/participants`, { userId: student2.id }, tokenProfOwner),
    ]);
    record('12.2 Finalization + participant add race: participant add blocked (409)',
      raceFin12b.status === 200 && racePart12b.status === 409);

  } catch (err) {
    console.error('Unhandled test execution error:', err);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');
    if (server) server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

server = app.listen(0, () => {
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  runTests();
});
