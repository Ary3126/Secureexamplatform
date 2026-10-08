/**
 * CODEFROG — Phase 7.5.10.5.8
 * Freeze / Finalization State Security Test Suite
 *
 * Comprehensive production-grade validation of:
 *   A. Server-authoritative contest end
 *   B. Freeze authorization
 *   C. Freeze lifecycle validity
 *   D. Unfreeze protection
 *   E. Finalization prerequisites
 *   F. Invalid lifecycle transitions
 *   G. Concurrent finalization
 *   H. Idempotent/repeated finalization
 *   I. Immutable final snapshot
 *   J. Rating finalization integrity
 *   K. Post-finalization mutation
 *   L. Submission-after-finalization
 *   M. Participant mutation
 *   N. Problem/test-case mutation
 *   O. Leaderboard/standings integrity
 *   P. Export/report integrity
 *   Q. Audit logging
 *   R. Database integrity
 *   S. Transaction rollback/failure recovery
 *   T. BOLA/IDOR
 *   U. RBAC
 *   V. Generic update bypass
 */

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_CONTEST_MAX = '5000';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const UserModel = require('./src/models/userModel');
const RatingService = require('./src/services/ratingService');
const { getContestRuntimeState, getContestFreezeState } = require('./src/services/contestService');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];
const trackedProblemIds = [];

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
    const payload = body ? JSON.stringify(body) : null;
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
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

const get = (p, t) => request('GET', p, null, t);
const post = (p, b, t) => request('POST', p, b, t);
const put = (p, b, t) => request('PUT', p, b, t);
const patch = (p, b, t) => request('PATCH', p, b, t);
const del = (p, b, t) => request('DELETE', p, b, t);

async function createTestUser(prefix, role = 'student', initialRating = 1200) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const username = `${prefix}_${suffix}`;
  const email = `${username}@codefrog.test`;
  const pwHash = await hashPassword('TestPass123!');

  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rated_contest_count, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 0, true)
     RETURNING id, username, email, role, current_rating;`,
    [username, email, pwHash, `${prefix} User`, role, initialRating]
  );
  const user = res.rows[0];
  trackedUserIds.push(user.id);
  const token = generateToken(user);
  return { ...user, token };
}

async function createTestContest(creatorId, overrides = {}) {
  const now = Date.now();
  const startTime = overrides.startTime || new Date(now - 3600000).toISOString();
  const endTime = overrides.endTime || new Date(now - 60000).toISOString();
  const title = overrides.title || `Contest_${now}_${Math.floor(Math.random() * 10000)}`;

  const res = await db.query(
    `INSERT INTO contests (title, description, start_time, end_time, created_by, status, is_rated, leaderboard_freeze_enabled, leaderboard_freeze_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *;`,
    [
      title,
      overrides.description || 'Test contest description',
      startTime,
      endTime,
      creatorId,
      overrides.status || 'published',
      overrides.isRated !== undefined ? overrides.isRated : true,
      overrides.leaderboardFreezeEnabled !== undefined ? overrides.leaderboardFreezeEnabled : false,
      overrides.leaderboardFreezeMinutes !== undefined ? overrides.leaderboardFreezeMinutes : 60,
    ]
  );
  const contest = res.rows[0];
  trackedContestIds.push(contest.id);
  return contest;
}

async function createTestProblem(creatorId, overrides = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const title = overrides.title || `Problem_${suffix}`;
  const res = await db.query(
    `INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     RETURNING *;`,
    [
      title,
      'Test problem description',
      overrides.difficulty || 'easy',
      overrides.codingMode || 'function',
      overrides.accessScope || 'public',
      creatorId,
    ]
  );
  const prob = res.rows[0];
  trackedProblemIds.push(prob.id);
  return prob;
}

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.5.8: Freeze / Finalization State Security Suite ');
  console.log('================================================================\n');

  try {
    // 0. Setup Actors
    const profOwner = await createTestUser('prof_owner', 'professor');
    const profOther = await createTestUser('prof_other', 'professor');
    const contestAdmin = await createTestUser('c_admin', 'contest_admin');
    const superAdmin = await createTestUser('s_admin', 'super_admin');
    const student1 = await createTestUser('stu_one', 'student', 1200);
    const student2 = await createTestUser('stu_two', 'student', 1200);
    const student3 = await createTestUser('stu_three', 'student', 1200);

    const baseProblem1 = await createTestProblem(profOwner.id, { title: 'Problem 1' });
    const baseProblem2 = await createTestProblem(profOwner.id, { title: 'Problem 2' });

    // ──────────────────────────────────────────────────────────
    // Section A: Server-Authoritative Contest End
    // ──────────────────────────────────────────────────────────
    console.log('--- Section A: Server-Authoritative Contest End ---');
    {
      const now = Date.now();
      // Running contest: ends in 5 seconds
      const runningContest = await createTestContest(profOwner.id, {
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 10000).toISOString(),
        status: 'published',
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [runningContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [runningContest.id, student1.id]);

      // Just before endTime: accepted
      const subBefore = await post('/api/submissions', {
        contestId: runningContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
      }, student1.token);
      assert(subBefore.status === 201, 'A.1 Submission accepted before contest endTime (201)');

      // Contest ended 5 ms ago
      const endedContest = await createTestContest(profOwner.id, {
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now - 5).toISOString(),
        status: 'published',
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [endedContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [endedContest.id, student1.id]);

      // Exactly at / immediately after endTime: rejected
      const subEnded = await post('/api/submissions', {
        contestId: endedContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
      }, student1.token);
      assert(subEnded.status === 400, 'A.2 Submission rejected when now >= endTime (400 Bad Request)');
      assert(subEnded.body.message && subEnded.body.message.includes('ended'), 'A.3 Error states contest is ended');

      // Client attempting to forge status or timestamp
      const subForged = await post('/api/submissions', {
        contestId: endedContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
        contestStatus: 'running',
        runtimeState: 'running',
        submittedAt: new Date(now - 10000).toISOString(),
      }, student1.token);
      assert(subForged.status === 400, 'A.4 Client-forged status/timestamp disregarded; server rejects post-end submission (400)');
    }

    // ──────────────────────────────────────────────────────────
    // Section B: Freeze Authorization
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section B: Freeze Authorization ---');
    {
      const now = Date.now();
      const upcomingContest = await createTestContest(profOwner.id, {
        startTime: new Date(now + 3600000).toISOString(),
        endTime: new Date(now + 7200000).toISOString(),
        status: 'published',
      });

      // Anonymous cannot configure freeze
      const anonFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeEnabled: true, leaderboardFreezeMinutes: 30 });
      assert(anonFreeze.status === 401, 'B.1 Anonymous request to modify freeze rejected (401 Unauthorized)');

      // Student cannot configure freeze
      const stuFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeEnabled: true, leaderboardFreezeMinutes: 30 }, student1.token);
      assert(stuFreeze.status === 403, 'B.2 Student request to modify freeze rejected (403 Forbidden)');

      // Non-owning professor cannot configure freeze (BOLA)
      const otherProfFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeEnabled: true, leaderboardFreezeMinutes: 30 }, profOther.token);
      assert(otherProfFreeze.status === 403, 'B.3 Non-owning professor request to modify freeze rejected (403 Forbidden BOLA)');

      // Owning professor can configure freeze
      const ownerFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeEnabled: true, leaderboardFreezeMinutes: 30 }, profOwner.token);
      assert(ownerFreeze.status === 200, 'B.4 Owning professor can configure freeze (200 OK)');
      assert(ownerFreeze.body.contest.leaderboardFreezeEnabled === true, 'B.5 Freeze enabled updated in response');
      assert(ownerFreeze.body.contest.leaderboardFreezeMinutes === 30, 'B.6 Freeze minutes updated to 30');

      // Contest Admin can configure freeze
      const adminFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeMinutes: 45 }, contestAdmin.token);
      assert(adminFreeze.status === 200, 'B.7 Contest admin can configure freeze (200 OK)');
      assert(adminFreeze.body.contest.leaderboardFreezeMinutes === 45, 'B.8 Freeze minutes updated by contest admin');

      // Super Admin can configure freeze
      const sAdminFreeze = await put(`/api/contests/${upcomingContest.id}`, { leaderboardFreezeMinutes: 15 }, superAdmin.token);
      assert(sAdminFreeze.status === 200, 'B.9 Super admin can configure freeze (200 OK)');
      assert(sAdminFreeze.body.contest.leaderboardFreezeMinutes === 15, 'B.10 Freeze minutes updated by super admin');
    }

    // ──────────────────────────────────────────────────────────
    // Section C: Freeze Lifecycle Validity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section C: Freeze Lifecycle Validity ---');
    {
      const now = Date.now();
      // Contest started 1 hour ago, ends in 10 minutes, freeze last 30 minutes (now is frozen)
      const frozenContest = await createTestContest(profOwner.id, {
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 600000).toISOString(),
        status: 'published',
        leaderboardFreezeEnabled: true,
        leaderboardFreezeMinutes: 30,
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [frozenContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [frozenContest.id, student1.id]);

      const freezeState = getContestFreezeState(frozenContest, new Date());
      assert(freezeState.isFrozen === true, 'C.1 Contest freeze state is active (isFrozen === true)');
      assert(freezeState.freezeState === 'FROZEN', 'C.2 freezeState is FROZEN');

      // Submissions continue to be accepted during freeze!
      const subInFreeze = await post('/api/submissions', {
        contestId: frozenContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
      }, student1.token);
      assert(subInFreeze.status === 201, 'C.3 Submissions are accepted during leaderboard freeze (201 Created)');

      // Public leaderboard reflects frozen status
      const pubLb = await get(`/api/contests/${frozenContest.id}/leaderboard`, student1.token);
      assert(pubLb.status === 200, 'C.4 Public leaderboard accessible during freeze');
      assert(pubLb.body.freezeState === 'FROZEN', 'C.5 Public leaderboard declares freezeState === FROZEN');

      // Admin leaderboard allows live freeze override
      const adminLb = await get(`/api/contests/${frozenContest.id}/admin-leaderboard?freezeOverride=true`, profOwner.token);
      assert(adminLb.status === 200, 'C.6 Admin leaderboard accessible to manager (200 OK)');
      assert(Array.isArray(adminLb.body.standings), 'C.7 Admin leaderboard returns unmasked live standings array');

      // Freeze cannot alter contest runtimeState
      const rState = getContestRuntimeState(frozenContest);
      assert(rState === 'running', 'C.8 Freeze does not alter runtimeState; remains running');
    }

    // ──────────────────────────────────────────────────────────
    // Section D: Unfreeze Protection
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section D: Unfreeze Protection ---');
    {
      const now = Date.now();
      const endedFrozen = await createTestContest(profOwner.id, {
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
        status: 'published',
        leaderboardFreezeEnabled: true,
        leaderboardFreezeMinutes: 30,
      });

      // Unauthorized cannot unfreeze
      const unauthUnfreeze = await put(`/api/contests/${endedFrozen.id}`, { leaderboardFreezeEnabled: false }, student1.token);
      assert(unauthUnfreeze.status === 403, 'D.1 Student cannot unfreeze contest (403 Forbidden)');

      // Finalize contest
      await RatingService.finalizeContestRatings(endedFrozen.id, profOwner, { force: true });

      // After finalization, changing freeze settings is strictly blocked
      const finalizedUnfreeze = await put(`/api/contests/${endedFrozen.id}`, { leaderboardFreezeEnabled: false }, profOwner.token);
      assert(finalizedUnfreeze.status === 409, 'D.2 Unfreezing/modifying freeze settings post-finalization rejected with 409 Conflict');
    }

    // ──────────────────────────────────────────────────────────
    // Section E: Finalization Prerequisites
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section E: Finalization Prerequisites ---');
    {
      const now = Date.now();
      // 1. Draft contest
      const draftContest = await createTestContest(profOwner.id, {
        status: 'draft',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      const finDraft = await post(`/api/contests/${draftContest.id}/finalize-ratings`, {}, profOwner.token);
      assert(finDraft.status === 400, 'E.1 Draft contest finalization rejected (400 Bad Request)');

      // 2. Upcoming contest
      const upcomingContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now + 3600000).toISOString(),
        endTime: new Date(now + 7200000).toISOString(),
      });
      const finUpcoming = await post(`/api/contests/${upcomingContest.id}/finalize-ratings`, {}, profOwner.token);
      assert(finUpcoming.status === 400, 'E.2 Upcoming contest finalization rejected (400 Bad Request)');

      // 3. Running contest (without force)
      const runningContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 3600000).toISOString(),
      });
      const finRunning = await post(`/api/contests/${runningContest.id}/finalize-ratings`, {}, profOwner.token);
      assert(finRunning.status === 400, 'E.3 Running contest finalization rejected without force (400 Bad Request)');

      // 4. Ended contest with pending submissions
      const endedWithPending = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [endedWithPending.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [endedWithPending.id, student1.id]);
      // Insert a queued submission
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'code', 'queued', false);`,
        [student1.id, endedWithPending.id, baseProblem1.id]
      );
      const finPending = await post(`/api/contests/${endedWithPending.id}/finalize-ratings`, {}, profOwner.token);
      assert(finPending.status === 409, 'E.4 Ended contest with queued judge submission rejected (409 Conflict)');

      // Clean up queued submission
      await db.query(`DELETE FROM submissions WHERE contest_id = $1`, [endedWithPending.id]);

      // 5. Clean ended contest -> succeeds
      const finClean = await post(`/api/contests/${endedWithPending.id}/finalize-ratings`, {}, profOwner.token);
      assert(finClean.status === 200, 'E.5 Clean ended contest with 0 pending submissions finalizes successfully (200 OK)');
    }

    // ──────────────────────────────────────────────────────────
    // Section F: Invalid Lifecycle Transitions
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section F: Invalid Lifecycle Transitions ---');
    {
      const now = Date.now();
      const finalizedContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(finalizedContest.id, profOwner);

      // Cannot publish finalized contest
      const pubAttempt = await post(`/api/contests/${finalizedContest.id}/publish`, {}, profOwner.token);
      assert(pubAttempt.status === 400, 'F.1 Cannot publish an ended/finalized contest (400 Bad Request)');

      // Cannot unpublish finalized contest
      const unpubAttempt = await post(`/api/contests/${finalizedContest.id}/unpublish`, {}, profOwner.token);
      assert(unpubAttempt.status === 409, 'F.2 Cannot unpublish an ended/finalized contest (409 Conflict)');

      // Cannot revert finalized contest to draft or running via PUT
      const revertDraft = await put(`/api/contests/${finalizedContest.id}`, { status: 'draft' }, profOwner.token);
      assert(revertDraft.status === 400 || revertDraft.status === 409, 'F.3 Reverting finalized contest to draft rejected (400/409)');

      // Cannot delete finalized contest even if 0 submissions exist!
      const delFinalized = await del(`/api/contests/${finalizedContest.id}`, null, profOwner.token);
      assert(delFinalized.status === 409, 'F.4 Deleting finalized contest is strictly rejected with 409 Conflict');
      assert(delFinalized.body.message && delFinalized.body.message.includes('finalized'), 'F.5 Error message specifies contest is finalized');
    }

    // ──────────────────────────────────────────────────────────
    // Section G: Concurrent Finalization
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section G: Concurrent Finalization ---');
    {
      const now = Date.now();
      const raceContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [raceContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [raceContest.id, student1.id]);

      // 2 simultaneous requests
      const [res1, res2] = await Promise.all([
        post(`/api/contests/${raceContest.id}/finalize-ratings`, {}, profOwner.token),
        post(`/api/contests/${raceContest.id}/finalize-ratings`, {}, profOwner.token),
      ]);
      assert(res1.status === 200 && res2.status === 200, 'G.1 Both concurrent requests return 200 OK');
      const executed = [res1, res2].filter((r) => !r.body.alreadyFinalized);
      const idempotents = [res1, res2].filter((r) => r.body.alreadyFinalized);
      assert(executed.length === 1 && idempotents.length === 1, 'G.2 Exactly one executed finalization while other safely returned alreadyFinalized: true');

      // 5 simultaneous repeat requests
      const raceContest5 = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(raceContest5.id, profOwner);
      const responses5 = await Promise.all(
        Array(5).fill(0).map(() => post(`/api/contests/${raceContest5.id}/finalize-ratings`, {}, profOwner.token))
      );
      assert(responses5.every((r) => r.status === 200 && r.body.alreadyFinalized === true), 'G.3 All 5 concurrent repeat requests return 200 OK with alreadyFinalized: true');

      // 10 simultaneous requests
      const raceContest10 = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(raceContest10.id, profOwner);
      const responses10 = await Promise.all(
        Array(10).fill(0).map(() => post(`/api/contests/${raceContest10.id}/finalize-ratings`, {}, profOwner.token))
      );
      assert(responses10.every((r) => r.status === 200), 'G.4 10 simultaneous requests safely handled without deadlocks');
    }

    // ──────────────────────────────────────────────────────────
    // Section H: Idempotent / Repeated Finalization
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section H: Idempotent / Repeated Finalization ---');
    {
      const now = Date.now();
      const repeatContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [repeatContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [repeatContest.id, student2.id]);

      const firstFin = await post(`/api/contests/${repeatContest.id}/finalize-ratings`, {}, profOwner.token);
      assert(firstFin.status === 200 && !firstFin.body.alreadyFinalized, 'H.1 First finalization succeeds (200 OK)');

      const repeatFin = await post(`/api/contests/${repeatContest.id}/finalize-ratings`, {}, profOwner.token);
      assert(repeatFin.status === 200 && repeatFin.body.alreadyFinalized === true, 'H.2 Repeated finalization returns 200 OK with alreadyFinalized: true');

      const aliasFin = await post(`/api/contests/${repeatContest.id}/finalize`, {}, profOwner.token);
      assert(aliasFin.status === 200 && aliasFin.body.alreadyFinalized === true, 'H.3 Alias /finalize endpoint returns 200 OK with alreadyFinalized: true');

      // Rating history row count check
      const rhCount = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1`, [repeatContest.id]);
      assert(rhCount.rows[0].count === 1, 'H.4 Exactly 1 rating_history entry exists (zero duplicate rows)');
    }

    // ──────────────────────────────────────────────────────────
    // Section I: Immutable Final Snapshot
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section I: Immutable Final Snapshot ---');
    {
      const now = Date.now();
      const snapContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [snapContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [snapContest.id, student1.id]);

      await RatingService.finalizeContestRatings(snapContest.id, profOwner);

      const dbRow = await db.query(`SELECT final_results_snapshot FROM contests WHERE id = $1`, [snapContest.id]);
      const snap = dbRow.rows[0].final_results_snapshot;
      assert(Boolean(snap), 'I.1 final_results_snapshot column is populated in database');
      assert(snap.totalParticipants === 1, 'I.2 Snapshot has totalParticipants: 1');
      assert(Array.isArray(snap.standings), 'I.3 Snapshot contains standings array');

      // Attempt to overwrite snapshot via PUT
      await put(`/api/contests/${snapContest.id}`, {
        finalResultsSnapshot: { totalParticipants: 999, corrupted: true },
        title: 'Updated Title',
      }, profOwner.token);

      const dbRowAfter = await db.query(`SELECT final_results_snapshot, title FROM contests WHERE id = $1`, [snapContest.id]);
      assert(dbRowAfter.rows[0].final_results_snapshot.totalParticipants === 1, 'I.4 Snapshot cannot be overwritten via generic API');
      assert(dbRowAfter.rows[0].title === 'Updated Title', 'I.5 Allowed cosmetic title update succeeded');
    }

    // ──────────────────────────────────────────────────────────
    // Section J: Rating Finalization Integrity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section J: Rating Finalization Integrity ---');
    {
      const now = Date.now();
      const ratedContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [ratedContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2), ($1, $3)`, [ratedContest.id, student1.id, student2.id]);
      // student1 submits correct
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, is_sample_run, created_at)
         VALUES ($1, $2, $3, 'javascript', 'c1', 'accepted', false, $4);`,
        [student1.id, ratedContest.id, baseProblem1.id, new Date(now - 5000000).toISOString()]
      );

      // Attempt client rating tampering
      const tamperRes = await post(`/api/contests/${ratedContest.id}/finalize-ratings`, {
        ratingChange: 9999,
        newRating: 5000,
        rank: 1,
      }, profOwner.token);

      assert(tamperRes.status === 200, 'J.1 Tamper request completed safely (200 OK)');
      const updates = tamperRes.body.ratingUpdates;
      assert(updates.length === 2, 'J.2 Exactly 2 rating updates calculated');
      const winnerUpdate = updates.find((u) => u.userId === student1.id);
      assert(winnerUpdate.newRating !== 5000, 'J.3 Client-forged newRating (5000) was strictly ignored');
      assert(winnerUpdate.ratingChange !== 9999, 'J.4 Client-forged ratingChange (9999) was strictly ignored');
      assert(winnerUpdate.previousRating + winnerUpdate.ratingChange === winnerUpdate.newRating, 'J.5 Elo invariant verified: prev + delta = new');

      // Check user record updated
      const uRes = await db.query(`SELECT current_rating, highest_rating FROM users WHERE id = $1`, [student1.id]);
      assert(uRes.rows[0].current_rating === winnerUpdate.newRating, 'J.6 users.current_rating matches newRating');
      assert(uRes.rows[0].highest_rating >= winnerUpdate.newRating, 'J.7 users.highest_rating updated appropriately');
    }

    // ──────────────────────────────────────────────────────────
    // Section K: Post-Finalization Mutation
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section K: Post-Finalization Mutation ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // Attempt to modify isRated
      const mutIsRated = await put(`/api/contests/${finContest.id}`, { isRated: false }, profOwner.token);
      assert(mutIsRated.status === 409, 'K.1 Attempting to modify isRated post-finalization rejected with 409 Conflict');

      // Attempt to modify freeze settings
      const mutFreeze = await put(`/api/contests/${finContest.id}`, { leaderboardFreezeEnabled: false }, profOwner.token);
      assert(mutFreeze.status === 409, 'K.2 Attempting to modify freeze settings post-finalization rejected with 409 Conflict');

      // Attempt to modify startTime/endTime
      const mutDates = await put(`/api/contests/${finContest.id}`, { startTime: new Date(now - 100000).toISOString() }, profOwner.token);
      assert(mutDates.status === 409, 'K.3 Attempting to modify startTime post-finalization rejected with 409 Conflict');

      // Archiving finalized contest is permitted as valid lifecycle closure
      const archiveRes = await post(`/api/contests/${finContest.id}/archive`, {}, profOwner.token);
      assert(archiveRes.status === 200, 'K.4 Archiving finalized contest permitted as valid closure (200 OK)');
    }

    // ──────────────────────────────────────────────────────────
    // Section L: Submission After Finalization
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section L: Submission After Finalization ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [finContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [finContest.id, student1.id]);
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // Standard submission
      const subAttempt = await post('/api/submissions', {
        contestId: finContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
      }, student1.token);
      assert(subAttempt.status === 400, 'L.1 Submission to finalized contest rejected (400 Bad Request)');
      assert(subEnded(subAttempt), 'L.2 Error message reflects finalization or ended state');

      // Interactive run
      const runAttempt = await post('/api/submissions/run', {
        contestId: finContest.id,
        problemId: baseProblem1.id,
        language: 'javascript',
        sourceCode: 'function solve() { return true; }',
      }, student1.token);
      assert(runAttempt.status === 400, 'L.3 Interactive run on finalized contest rejected (400 Bad Request)');
    }

    function subEnded(res) {
      return res.body && res.body.message && (res.body.message.includes('finalized') || res.body.message.includes('ended'));
    }

    // ──────────────────────────────────────────────────────────
    // Section M: Participant Mutation
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section M: Participant Mutation ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // Student join
      const joinAttempt = await post(`/api/contests/${finContest.id}/join`, {}, student1.token);
      assert(joinAttempt.status === 400, 'M.1 Student join on finalized contest rejected (400 Bad Request)');

      // Manager add participant
      const addPart = await post(`/api/contests/${finContest.id}/participants`, { userId: student2.id }, profOwner.token);
      assert(addPart.status === 409, 'M.2 Adding participant to finalized contest rejected with 409 Conflict');

      // Manager bulk add participants
      const bulkAddPart = await post(`/api/contests/${finContest.id}/participants/bulk`, { userIds: [student2.id, student3.id] }, profOwner.token);
      assert(bulkAddPart.status === 409, 'M.3 Bulk adding participants to finalized contest rejected with 409 Conflict');

      // Manager remove participant
      const remPart = await del(`/api/contests/${finContest.id}/participants/${student2.id}`, null, profOwner.token);
      assert(remPart.status === 409, 'M.4 Removing participant from finalized contest rejected with 409 Conflict');

      // Manager bulk remove participants
      const bulkRemPart = await del(`/api/contests/${finContest.id}/participants/bulk`, { userIds: [student2.id] }, profOwner.token);
      assert(bulkRemPart.status === 409, 'M.5 Bulk removing participants from finalized contest rejected with 409 Conflict');
    }

    // ──────────────────────────────────────────────────────────
    // Section N: Problem / Test-Case Mutation
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section N: Problem / Test-Case Mutation ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [finContest.id, baseProblem1.id]);
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // Add problem to contest
      const addProb = await post(`/api/contests/${finContest.id}/problems`, { problemId: baseProblem2.id, points: 100 }, profOwner.token);
      assert(addProb.status === 409, 'N.1 Adding problem to finalized contest rejected with 409 Conflict');

      // Remove problem from contest
      const remProb = await del(`/api/contests/${finContest.id}/problems/${baseProblem1.id}`, null, profOwner.token);
      assert(remProb.status === 409, 'N.2 Removing problem from finalized contest rejected with 409 Conflict');

      // Reorder problems in contest
      const reorderProb = await put(`/api/contests/${finContest.id}/problems/order`, { problemIds: [baseProblem1.id] }, profOwner.token);
      assert(reorderProb.status === 409, 'N.3 Reordering problems in finalized contest rejected with 409 Conflict');

      // Bulk add problems
      const bulkAddProb = await post(`/api/contests/${finContest.id}/problems/bulk`, { problems: [{ problemId: baseProblem2.id, points: 50 }] }, profOwner.token);
      assert(bulkAddProb.status === 409, 'N.4 Bulk adding problems to finalized contest rejected with 409 Conflict');

      // Bulk remove problems
      const bulkRemProb = await del(`/api/contests/${finContest.id}/problems`, { problemIds: [baseProblem1.id] }, profOwner.token);
      assert(bulkRemProb.status === 409, 'N.5 Bulk removing problems from finalized contest rejected with 409 Conflict');

      // Problem attached to contest with submissions cannot be deleted
      await db.query(
        `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, is_sample_run)
         VALUES ($1, $2, $3, 'javascript', 'code', 'accepted', false);`,
        [student1.id, finContest.id, baseProblem1.id]
      );
      const delProb = await del(`/api/problems/${baseProblem1.id}`, null, profOwner.token);
      assert(delProb.status === 409, 'N.6 Deleting problem with contest submissions rejected with 409 Conflict');
    }

    // ──────────────────────────────────────────────────────────
    // Section O: Leaderboard / Standings Integrity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section O: Leaderboard / Standings Integrity ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [finContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [finContest.id, student1.id]);
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // Public leaderboard
      const lbRes = await get(`/api/contests/${finContest.id}/leaderboard`, student1.token);
      assert(lbRes.status === 200, 'O.1 Leaderboard responds 200 OK');
      assert(lbRes.body.freezeState === 'FINAL', 'O.2 Leaderboard freezeState is FINAL');
      assert(lbRes.body.contest.isRatingFinalized === true, 'O.3 Leaderboard confirms contest.isRatingFinalized === true');

      // Results endpoint
      const resView = await get(`/api/contests/${finContest.id}/results`, student1.token);
      assert(resView.status === 200, 'O.4 Results endpoint responds 200 OK');
      assert(resView.body.resultSummary?.isFinalized === true || resView.body.isRatingFinalized === true || resView.body.contest?.isRatingFinalized === true, 'O.5 Results view confirms finalization status');

      // Student results me endpoint
      const myRes = await get(`/api/contests/${finContest.id}/results/me`, student1.token);
      assert(myRes.status === 200, 'O.6 Student results/me endpoint responds 200 OK');

      // Repeated reads return exact same deterministic standings
      const lbRes2 = await get(`/api/contests/${finContest.id}/leaderboard`, student1.token);
      assert(JSON.stringify(lbRes.body.standings) === JSON.stringify(lbRes2.body.standings), 'O.7 Leaderboard standings are deterministic across repeated reads');
    }

    // ──────────────────────────────────────────────────────────
    // Section P: Export / Report Integrity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section P: Export / Report Integrity ---');
    {
      const now = Date.now();
      const finContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [finContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [finContest.id, student1.id]);
      await RatingService.finalizeContestRatings(finContest.id, profOwner);

      // JSON export
      const jsonExp = await get(`/api/contests/${finContest.id}/export/results?format=json`, profOwner.token);
      assert(jsonExp.status === 200, 'P.1 JSON results export responds 200 OK');
      assert(jsonExp.body.contest && jsonExp.body.contest.isRatingFinalized === true, 'P.2 Export confirms finalized contest state');

      // CSV export
      const csvExp = await get(`/api/contests/${finContest.id}/export/results?format=csv`, profOwner.token);
      assert(csvExp.status === 200, 'P.3 CSV results export responds 200 OK');

      // CSV Formula injection defense test
      const formulaUser = await createTestUser('=cmd|/C calc!A0', 'student');
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [finContest.id, formulaUser.id]);
      const csvExp2 = await get(`/api/contests/${finContest.id}/export/participants?format=csv`, profOwner.token);
      assert(csvExp2.status === 200, 'P.4 Participants export responds 200 OK');
      assert(typeof csvExp2.body === 'string' && csvExp2.body.includes("'="), 'P.5 CSV formula injection neutralized with leading quote');

      // Export is read-only (state not mutated)
      const afterExport = await db.query(`SELECT is_rating_finalized FROM contests WHERE id = $1`, [finContest.id]);
      assert(afterExport.rows[0].is_rating_finalized === true, 'P.6 Export did not mutate finalization status');
    }

    // ──────────────────────────────────────────────────────────
    // Section Q: Audit Logging
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section Q: Audit Logging ---');
    {
      const now = Date.now();
      const auditContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(auditContest.id, profOwner);

      // Query audit logs for finalization event
      const logs = await db.query(
        `SELECT * FROM audit_logs WHERE resource_id = $1 AND action = 'RATINGS_FINALIZED' ORDER BY created_at DESC;`,
        [auditContest.id]
      );
      assert(logs.rowCount >= 1, 'Q.1 Audit log entry recorded for RATINGS_FINALIZED');
      assert(logs.rows[0].actor_id === profOwner.id, 'Q.2 Actor ID correctly recorded in audit log');
      assert(logs.rows[0].outcome === 'success', 'Q.3 Outcome correctly recorded as success');

      // Repeat finalization audit log
      await post(`/api/contests/${auditContest.id}/finalize-ratings`, {}, profOwner.token);
      const repeatLogs = await db.query(
        `SELECT * FROM audit_logs WHERE resource_id = $1 AND action = 'RATINGS_FINALIZED' ORDER BY created_at DESC;`,
        [auditContest.id]
      );
      assert(repeatLogs.rows[0].metadata && repeatLogs.rows[0].metadata.isIdempotentSkip === true, 'Q.4 Repeat finalization logged with isIdempotentSkip: true');

      // Zero credential leaks in audit logs
      const allContestLogs = await db.query(`SELECT metadata FROM audit_logs WHERE resource_id = $1;`, [auditContest.id]);
      const leaked = allContestLogs.rows.some((r) => JSON.stringify(r.metadata).includes('password') || JSON.stringify(r.metadata).includes('TestPass123!'));
      assert(!leaked, 'Q.5 Zero passwords or secret credentials leaked in audit logs');
    }

    // ──────────────────────────────────────────────────────────
    // Section R: Database Integrity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section R: Database Integrity ---');
    {
      const now = Date.now();
      const dbContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(dbContest.id, profOwner);

      // Verify unique constraint on rating_history (user_id, contest_id)
      let uqViolated = false;
      try {
        await db.query(
          `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
           VALUES ($1, $2, 1200, 10, 1210, 1, 1);`,
          [student1.id, dbContest.id]
        );
        // Second insert must fail with 23505
        await db.query(
          `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
           VALUES ($1, $2, 1200, 10, 1210, 1, 1);`,
          [student1.id, dbContest.id]
        );
      } catch (err) {
        if (err.code === '23505') uqViolated = true;
      }
      assert(uqViolated, 'R.1 Database unique constraint (uq_rating_history_user_contest) blocks duplicate rating entries (code 23505)');

      // Verify check constraints on rating_history
      let chkViolated = false;
      try {
        await db.query(
          `INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
           VALUES ($1, $2, 1200, -1150, 50, 0, 0);`,
          [student2.id, dbContest.id]
        );
      } catch (err) {
        if (err.code === '23514') chkViolated = true;
      }
      assert(chkViolated, 'R.2 Database check constraint (chk_rating_history_rank / min rating) blocks invalid values (code 23514)');
    }

    // ──────────────────────────────────────────────────────────
    // Section S: Transaction Rollback / Failure Recovery
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section S: Transaction Rollback / Failure Recovery ---');
    {
      const now = Date.now();
      const failContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [failContest.id, baseProblem1.id]);
      await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [failContest.id, student1.id]);

      // Simulated failure at snapshot creation
      let simFailed = false;
      try {
        await RatingService.finalizeContestRatings(failContest.id, profOwner, {
          force: true,
          __testSimulateFailureAt: 'snapshot',
        });
      } catch (err) {
        simFailed = true;
      }
      assert(simFailed, 'S.1 Simulated snapshot failure throws during finalization');

      // Verify rollback
      const afterRollback = await db.query(`SELECT is_rating_finalized FROM contests WHERE id = $1`, [failContest.id]);
      assert(afterRollback.rows[0].is_rating_finalized === false, 'S.2 Contest remains unfinalized after rollback');
      const rhRollback = await db.query(`SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1`, [failContest.id]);
      assert(rhRollback.rows[0].count === 0, 'S.3 Zero rating_history rows committed after rollback');

      // Retry without simulation succeeds cleanly
      const retryRes = await RatingService.finalizeContestRatings(failContest.id, profOwner, { force: true });
      assert(retryRes.isRated === true, 'S.4 Retry after failure succeeds cleanly');
      const afterRetry = await db.query(`SELECT is_rating_finalized FROM contests WHERE id = $1`, [failContest.id]);
      assert(afterRetry.rows[0].is_rating_finalized === true, 'S.5 Contest marked finalized after clean retry');
    }

    // ──────────────────────────────────────────────────────────
    // Section T: BOLA / IDOR
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section T: BOLA / IDOR ---');
    {
      const now = Date.now();
      const profContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });

      // Professor Other cannot finalize Professor Owner's contest
      const bolaFin = await post(`/api/contests/${profContest.id}/finalize-ratings`, {}, profOther.token);
      assert(bolaFin.status === 403, 'T.1 Non-owning professor finalization denied (403 BOLA)');

      // Professor Other cannot export Professor Owner's contest results
      const bolaExp = await get(`/api/contests/${profContest.id}/export/results`, profOther.token);
      assert(bolaExp.status === 403, 'T.2 Non-owning professor results export denied (403 BOLA)');

      // Student 1 cannot inspect Student 2's detailed result endpoint
      const bolaStu = await get(`/api/contests/${profContest.id}/participants/${student2.id}/results`, student1.token);
      assert(bolaStu.status === 403, 'T.3 Student inspecting another student result details denied (403 BOLA)');
    }

    // ──────────────────────────────────────────────────────────
    // Section U: RBAC
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section U: RBAC ---');
    {
      const now = Date.now();
      const rbacContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });

      // Anonymous cannot finalize
      const anonFin = await post(`/api/contests/${rbacContest.id}/finalize-ratings`, {});
      assert(anonFin.status === 401, 'U.1 Anonymous finalization denied (401 Unauthorized)');

      // Student cannot finalize
      const stuFin = await post(`/api/contests/${rbacContest.id}/finalize-ratings`, {}, student1.token);
      assert(stuFin.status === 403, 'U.2 Student finalization denied (403 Forbidden)');

      // Contest Admin can finalize
      const cadmFin = await post(`/api/contests/${rbacContest.id}/finalize-ratings`, {}, contestAdmin.token);
      assert(cadmFin.status === 200, 'U.3 Contest admin finalization permitted (200 OK)');

      // Super Admin can finalize
      const sAdminContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      const sadmFin = await post(`/api/contests/${sAdminContest.id}/finalize-ratings`, {}, superAdmin.token);
      assert(sadmFin.status === 200, 'U.4 Super admin finalization permitted (200 OK)');
    }

    // ──────────────────────────────────────────────────────────
    // Section V: Generic Update Bypass Resistance
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section V: Generic Update Bypass Resistance ---');
    {
      const now = Date.now();
      const bypassContest = await createTestContest(profOwner.id, {
        status: 'published',
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
      });
      await RatingService.finalizeContestRatings(bypassContest.id, profOwner);

      // Mass assignment attack: attempt to un-finalize via PUT body
      const massRes = await put(`/api/contests/${bypassContest.id}`, {
        isRatingFinalized: false,
        ratingsFinalizedAt: null,
        finalResultsSnapshot: null,
        is_rating_finalized: false,
        ratings_finalized_at: null,
        final_results_snapshot: null,
      }, profOwner.token);

      const checkRow = await db.query(`SELECT is_rating_finalized, ratings_finalized_at, final_results_snapshot FROM contests WHERE id = $1`, [bypassContest.id]);
      assert(checkRow.rows[0].is_rating_finalized === true, 'V.1 Mass assignment cannot clear is_rating_finalized');
      assert(checkRow.rows[0].ratings_finalized_at !== null, 'V.2 Mass assignment cannot clear ratings_finalized_at');
      assert(checkRow.rows[0].final_results_snapshot !== null, 'V.3 Mass assignment cannot clear final_results_snapshot');
    }

    // ──────────────────────────────────────────────────────────
    // Teardown & Canonical Baseline Verification
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Teardown & Baseline Verification ---');
    if (trackedContestIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [trackedProblemIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM contest_participants WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
    }
    console.log(`  [CLEANUP] Cleaned test resources: ${trackedContestIds.length} contests, ${trackedProblemIds.length} problems, ${trackedUserIds.length} users.`);

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await db.pool.end();
  }

  console.log('\n================================================================');
  console.log(` Phase 7.5.10.5.8 Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Start HTTP test server on an ephemeral port
server = app.listen(0, async () => {
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  await runTests();
});
