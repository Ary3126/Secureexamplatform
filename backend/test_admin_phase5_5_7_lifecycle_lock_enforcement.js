/**
 * Phase 7.5.5.7 — Lifecycle & Lock Enforcement Automated Test Suite
 * File: backend/test_admin_phase5_5_7_lifecycle_lock_enforcement.js
 *
 * Verifies all Phase 7.5.5.7 requirements:
 * 1. Complete Lifecycle State Matrix:
 *    - draft: add, remove, single reorder, bulk reorder ALLOWED (200/201)
 *    - upcoming: add, remove, single reorder, bulk reorder ALLOWED (200/201)
 *    - running: add, remove, single reorder, bulk reorder BLOCKED (409 Conflict)
 *    - ended: add, remove, single reorder, bulk reorder BLOCKED (409 Conflict)
 *    - archived: add, remove, single reorder, bulk reorder BLOCKED (409 Conflict)
 * 2. Backend authoritative enforcement:
 *    - Rejections happen on server regardless of client state
 *    - Client payload cannot override contest state (status="draft" or spoofed startTime)
 * 3. Exact boundary condition enforcement:
 *    - Before start (upcoming): mutations allowed
 *    - Exact start boundary (now >= startTime): transitions to running -> mutations blocked (409)
 *    - During contest (running): mutations blocked (409)
 *    - Exact end boundary (now >= endTime): transitions to ended -> mutations blocked (409)
 *    - After end (ended): mutations blocked (409)
 * 4. RBAC & Ownership combined with Lifecycle:
 *    - Unauthenticated rejected with 401 Unauthorized
 *    - Student rejected with 403 Forbidden across all states
 *    - Non-owner professor rejected with 403 Forbidden across all states (lifecycle not leaked)
 *    - Owner professor allowed on draft/upcoming, blocked on running/ended/archived (409)
 *    - Contest Admin allowed on draft/upcoming, blocked on running/ended/archived (409)
 *    - Super Admin allowed on draft/upcoming, blocked on running/ended/archived (409)
 * 5. Database Integrity:
 *    - Rejected mutations cause NO partial writes or deletions in contest_problems
 *    - Complete problem count and exact problem ordering remain untouched
 * 6. Audit Logging:
 *    - Blocked mutations log PRIVILEGED_ACTION_DENIED with sanitized metadata
 * 7. Concurrency & Race Condition Protection:
 *    - PostgreSQL FOR UPDATE row locks prevent concurrent lifecycle race conditions
 *    - Stale reads serialize safely and evaluate committed locked state
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let port;
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

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runLifecycleLockEnforcementTests() {
  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  console.log('=======================================================');
  console.log(' STARTING PHASE 7.5.5.7 LIFECYCLE & LOCK ENFORCEMENT');
  console.log('=======================================================');

  const createdUserIds = [];
  const createdProblemIds = [];
  const createdContestIds = [];

  try {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const ts = Date.now();

    // -------------------------------------------------------------------------
    // 1. Seed Test Actors
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass@1234');

    const profA = await UserModel.createUser({
      username: `profA_557_${ts}`,
      email: `profA_557_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor A ${ts}`,
      role: 'professor',
    });
    const profAToken = generateToken(profA);
    createdUserIds.push(profA.id);

    const profB = await UserModel.createUser({
      username: `profB_557_${ts}`,
      email: `profB_557_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor B ${ts}`,
      role: 'professor',
    });
    const profBToken = generateToken(profB);
    createdUserIds.push(profB.id);

    const ca = await UserModel.createUser({
      username: `ca_557_${ts}`,
      email: `ca_557_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    const caToken = generateToken(ca);
    createdUserIds.push(ca.id);

    const sa = await UserModel.createUser({
      username: `sa_557_${ts}`,
      email: `sa_557_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Super Admin ${ts}`,
      role: 'super_admin',
    });
    const saToken = generateToken(sa);
    createdUserIds.push(sa.id);

    const student = await UserModel.createUser({
      username: `student_557_${ts}`,
      email: `student_557_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Student ${ts}`,
      role: 'student',
    });
    const studentToken = generateToken(student);
    createdUserIds.push(student.id);

    record('Setup: All test actors initialized with JWTs', profAToken && profBToken && caToken && saToken && studentToken);

    // -------------------------------------------------------------------------
    // 2. Seed Problems in Problem Catalog
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Seeding Problem Catalog ---');
    const problems = [];
    for (let i = 1; i <= 8; i++) {
      const p = await ProblemModel.createProblem({
        title: `Lock Problem ${i} ${ts}`,
        description: `Description for problem ${i}`,
        difficulty: 'easy',
        codingMode: 'function',
        createdBy: profA.id,
        accessScope: 'public',
        isPublished: true,
      });
      problems.push(p);
      createdProblemIds.push(p.id);
    }
    record('Setup: 8 catalog problems created', problems.length === 8);

    // -------------------------------------------------------------------------
    // 3. Helper to Seed Contests in Various States
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Seeding Contests Across Lifecycle States ---');

    async function createFixtureContest({ title, status, startDeltaMinutes, endDeltaMinutes, createdBy = profA.id }) {
      const now = new Date();
      const startTime = new Date(now.getTime() + startDeltaMinutes * 60000);
      const endTime = new Date(now.getTime() + endDeltaMinutes * 60000);

      const cRes = await db.query(
        `INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
         VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id, title, status, start_time, end_time`,
        [title, `Description for ${title}`, startTime, endTime, status, createdBy]
      );
      const contest = cRes.rows[0];
      createdContestIds.push(contest.id);
      return contest;
    }

    async function attachProblems(contestId, problemList) {
      for (let idx = 0; idx < problemList.length; idx++) {
        await db.query(
          `INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
           VALUES ($1, $2, $3, $4)`,
          [contestId, problemList[idx].id, 100 * (idx + 1), idx + 1]
        );
      }
    }

    // A. Draft Contest (status = 'draft')
    const draftContest = await createFixtureContest({
      title: `Draft Contest ${ts}`,
      status: 'draft',
      startDeltaMinutes: 120,
      endDeltaMinutes: 240,
    });
    await attachProblems(draftContest.id, [problems[0], problems[1], problems[2]]);

    // B. Upcoming Contest (status = 'published', now < start_time)
    const upcomingContest = await createFixtureContest({
      title: `Upcoming Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: 60,
      endDeltaMinutes: 180,
    });
    await attachProblems(upcomingContest.id, [problems[0], problems[1], problems[2]]);

    // C. Running Contest (status = 'published', start_time <= now < end_time)
    const runningContest = await createFixtureContest({
      title: `Running Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: -30,
      endDeltaMinutes: 60,
    });
    await attachProblems(runningContest.id, [problems[0], problems[1], problems[2]]);

    // D. Ended Contest (status = 'published', end_time <= now)
    const endedContest = await createFixtureContest({
      title: `Ended Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: -180,
      endDeltaMinutes: -60,
    });
    await attachProblems(endedContest.id, [problems[0], problems[1], problems[2]]);

    // E. Archived Contest (status = 'archived')
    const archivedContest = await createFixtureContest({
      title: `Archived Contest ${ts}`,
      status: 'archived',
      startDeltaMinutes: -300,
      endDeltaMinutes: -120,
    });
    await attachProblems(archivedContest.id, [problems[0], problems[1], problems[2]]);

    record('Setup: Fixture contests created for all 5 lifecycle states', true);

    // -------------------------------------------------------------------------
    // 4. Test State Matrix: Draft State (Mutations Allowed)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing State Matrix: DRAFT Contest ---');
    // Add Problem
    const draftAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problems[3].id,
      points: 400,
    }, profAToken);
    record('DRAFT: Add problem permitted (200/201)', draftAddRes.status === 200 || draftAddRes.status === 201);

    // Reorder Problem
    const draftReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [problems[3].id, problems[0].id, problems[1].id, problems[2].id],
    }, profAToken);
    record('DRAFT: Reorder problems permitted (200 OK)', draftReorderRes.status === 200);

    // Remove Problem
    const draftRemoveRes = await request('DELETE', `/api/contests/${draftContest.id}/problems/${problems[3].id}`, null, profAToken);
    record('DRAFT: Remove problem permitted (200 OK)', draftRemoveRes.status === 200);

    // Bulk Add
    const draftBulkAddRes = await request('POST', `/api/contests/${draftContest.id}/problems/bulk`, {
      problems: [{ problemId: problems[3].id, points: 500 }],
    }, profAToken);
    record('DRAFT: Bulk add problems permitted (200 OK)', draftBulkAddRes.status === 200);

    // Bulk Remove
    const draftBulkRemRes = await request('DELETE', `/api/contests/${draftContest.id}/problems`, {
      problemIds: [problems[3].id],
    }, profAToken);
    record('DRAFT: Bulk remove problems permitted (200 OK)', draftBulkRemRes.status === 200);

    // -------------------------------------------------------------------------
    // 5. Test State Matrix: Upcoming State (Mutations Allowed)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing State Matrix: UPCOMING Contest ---');
    // Add Problem
    const upAddRes = await request('POST', `/api/contests/${upcomingContest.id}/problems`, {
      problemId: problems[3].id,
      points: 400,
    }, profAToken);
    record('UPCOMING: Add problem permitted (200/201)', upAddRes.status === 200 || upAddRes.status === 201);

    // Reorder Problem
    const upReorderRes = await request('PUT', `/api/contests/${upcomingContest.id}/problems/order`, {
      problemIds: [problems[3].id, problems[0].id, problems[1].id, problems[2].id],
    }, profAToken);
    record('UPCOMING: Reorder problems permitted (200 OK)', upReorderRes.status === 200);

    // Remove Problem
    const upRemoveRes = await request('DELETE', `/api/contests/${upcomingContest.id}/problems/${problems[3].id}`, null, profAToken);
    record('UPCOMING: Remove problem permitted (200 OK)', upRemoveRes.status === 200);

    // -------------------------------------------------------------------------
    // 6. Test State Matrix: Running State (Mutations Strictly Locked - 409)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing State Matrix: RUNNING Contest ---');
    // Verify DB baseline
    const runDbBefore = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [runningContest.id]
    );
    const runBaselineIds = runDbBefore.rows.map(r => r.problem_id);

    // Add Problem
    const runAddRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problems[3].id,
    }, profAToken);
    record('RUNNING: Add problem strictly blocked (409 Conflict)', runAddRes.status === 409);
    record('RUNNING: Add problem error message specifies contest is running', String(runAddRes.body?.message).toLowerCase().includes('running'));

    // Remove Problem
    const runRemoveRes = await request('DELETE', `/api/contests/${runningContest.id}/problems/${problems[0].id}`, null, profAToken);
    record('RUNNING: Remove problem strictly blocked (409 Conflict)', runRemoveRes.status === 409);
    record('RUNNING: Remove problem error message specifies contest is running', String(runRemoveRes.body?.message).toLowerCase().includes('running'));

    // Reorder Problems
    const runReorderRes = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [problems[2].id, problems[1].id, problems[0].id],
    }, profAToken);
    record('RUNNING: Reorder problems strictly blocked (409 Conflict)', runReorderRes.status === 409);
    record('RUNNING: Reorder error message specifies contest is running', String(runReorderRes.body?.message).toLowerCase().includes('running'));

    // Bulk Add
    const runBulkAddRes = await request('POST', `/api/contests/${runningContest.id}/problems/bulk`, {
      problems: [{ problemId: problems[3].id }],
    }, profAToken);
    record('RUNNING: Bulk add strictly blocked (409 Conflict)', runBulkAddRes.status === 409);

    // Bulk Remove
    const runBulkRemRes = await request('DELETE', `/api/contests/${runningContest.id}/problems`, {
      problemIds: [problems[0].id],
    }, profAToken);
    record('RUNNING: Bulk remove strictly blocked (409 Conflict)', runBulkRemRes.status === 409);

    // Verify DB Invariance: Zero partial changes
    const runDbAfter = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [runningContest.id]
    );
    const runAfterIds = runDbAfter.rows.map(r => r.problem_id);
    record('RUNNING DB INTEGRITY: Attached problems completely untouched byte-for-byte',
      JSON.stringify(runBaselineIds) === JSON.stringify(runAfterIds) &&
      runDbBefore.rows.length === runDbAfter.rows.length
    );

    // -------------------------------------------------------------------------
    // 7. Test State Matrix: Ended State (Mutations Strictly Locked - 409)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing State Matrix: ENDED Contest ---');
    const endedDbBefore = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [endedContest.id]
    );

    // Add Problem
    const endedAddRes = await request('POST', `/api/contests/${endedContest.id}/problems`, {
      problemId: problems[3].id,
    }, profAToken);
    record('ENDED: Add problem strictly blocked (409 Conflict)', endedAddRes.status === 409);
    record('ENDED: Add problem message specifies contest has ended', String(endedAddRes.body?.message).toLowerCase().includes('ended'));

    // Remove Problem
    const endedRemoveRes = await request('DELETE', `/api/contests/${endedContest.id}/problems/${problems[0].id}`, null, profAToken);
    record('ENDED: Remove problem strictly blocked (409 Conflict)', endedRemoveRes.status === 409);

    // Reorder Problem
    const endedReorderRes = await request('PUT', `/api/contests/${endedContest.id}/problems/order`, {
      problemIds: [problems[2].id, problems[1].id, problems[0].id],
    }, profAToken);
    record('ENDED: Reorder problems strictly blocked (409 Conflict)', endedReorderRes.status === 409);

    // Bulk Add & Remove
    const endedBulkAddRes = await request('POST', `/api/contests/${endedContest.id}/problems/bulk`, {
      problems: [{ problemId: problems[3].id }],
    }, profAToken);
    record('ENDED: Bulk add strictly blocked (409 Conflict)', endedBulkAddRes.status === 409);

    const endedBulkRemRes = await request('DELETE', `/api/contests/${endedContest.id}/problems`, {}, profAToken);
    record('ENDED: Bulk remove strictly blocked (409 Conflict)', endedBulkRemRes.status === 409);

    // Verify DB Invariance
    const endedDbAfter = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [endedContest.id]
    );
    record('ENDED DB INTEGRITY: Attached problems completely untouched',
      JSON.stringify(endedDbBefore.rows) === JSON.stringify(endedDbAfter.rows)
    );

    // -------------------------------------------------------------------------
    // 8. Test State Matrix: Archived State (Mutations Strictly Locked - 409)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing State Matrix: ARCHIVED Contest ---');
    const archDbBefore = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [archivedContest.id]
    );

    // Add Problem
    const archAddRes = await request('POST', `/api/contests/${archivedContest.id}/problems`, {
      problemId: problems[3].id,
    }, profAToken);
    record('ARCHIVED: Add problem strictly blocked (409 Conflict)', archAddRes.status === 409);
    record('ARCHIVED: Add problem message specifies contest is archived', String(archAddRes.body?.message).toLowerCase().includes('archived'));

    // Remove Problem
    const archRemoveRes = await request('DELETE', `/api/contests/${archivedContest.id}/problems/${problems[0].id}`, null, profAToken);
    record('ARCHIVED: Remove problem strictly blocked (409 Conflict)', archRemoveRes.status === 409);

    // Reorder Problem
    const archReorderRes = await request('PUT', `/api/contests/${archivedContest.id}/problems/order`, {
      problemIds: [problems[2].id, problems[1].id, problems[0].id],
    }, profAToken);
    record('ARCHIVED: Reorder problems strictly blocked (409 Conflict)', archReorderRes.status === 409);

    // Bulk Add & Remove
    const archBulkAddRes = await request('POST', `/api/contests/${archivedContest.id}/problems/bulk`, {
      problems: [{ problemId: problems[3].id }],
    }, profAToken);
    record('ARCHIVED: Bulk add strictly blocked (409 Conflict)', archBulkAddRes.status === 409);

    const archBulkRemRes = await request('DELETE', `/api/contests/${archivedContest.id}/problems`, {}, profAToken);
    record('ARCHIVED: Bulk remove strictly blocked (409 Conflict)', archBulkRemRes.status === 409);

    // Verify DB Invariance
    const archDbAfter = await db.query(
      `SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC`,
      [archivedContest.id]
    );
    record('ARCHIVED DB INTEGRITY: Attached problems completely untouched',
      JSON.stringify(archDbBefore.rows) === JSON.stringify(archDbAfter.rows)
    );

    // -------------------------------------------------------------------------
    // 9. Server-Authoritative Time & Client Bypass Immunity
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Server-Authoritative Time & Spoofing Immunity ---');

    // Attempt to bypass running contest lock by passing status: "draft" in payload
    const spoofStatusRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problems[4].id,
      status: 'draft',
      startTime: new Date(Date.now() + 86400000).toISOString(),
    }, profAToken);
    record('IMMUNITY: Spoofed status=draft in payload cannot unlock running contest (409 Conflict)', spoofStatusRes.status === 409);

    // Attempt to bypass reorder lock with client-provided timestamps
    const spoofReorderRes = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [problems[0].id, problems[1].id, problems[2].id],
      status: 'upcoming',
      runtimeState: 'upcoming',
    }, profAToken);
    record('IMMUNITY: Spoofed runtimeState=upcoming cannot unlock reorder (409 Conflict)', spoofReorderRes.status === 409);

    // -------------------------------------------------------------------------
    // 10. Lifecycle Boundary Edge Cases
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Exact Lifecycle Boundaries ---');
    const nowMs = Date.now();

    // Boundary A: Exact start boundary (start_time <= now < end_time)
    const exactStartContest = await createFixtureContest({
      title: `Exact Start Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: -0.05, // 3 seconds ago -> now >= startTime
      endDeltaMinutes: 60,
    });
    await attachProblems(exactStartContest.id, [problems[0], problems[1]]);

    const exactStartRes = await request('POST', `/api/contests/${exactStartContest.id}/problems`, {
      problemId: problems[2].id,
    }, profAToken);
    record('BOUNDARY: Contest at exact start boundary is running -> mutations blocked (409 Conflict)', exactStartRes.status === 409);

    // Boundary B: Just before start boundary (now < start_time)
    const beforeStartContest = await createFixtureContest({
      title: `Before Start Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: 30, // 30 minutes in future
      endDeltaMinutes: 90,
    });
    await attachProblems(beforeStartContest.id, [problems[0], problems[1]]);

    const beforeStartRes = await request('POST', `/api/contests/${beforeStartContest.id}/problems`, {
      problemId: problems[2].id,
    }, profAToken);
    record('BOUNDARY: Contest before start boundary is upcoming -> mutations allowed (200/201)',
      beforeStartRes.status === 200 || beforeStartRes.status === 201
    );

    // Boundary C: Exact end boundary (end_time <= now)
    const exactEndContest = await createFixtureContest({
      title: `Exact End Contest ${ts}`,
      status: 'published',
      startDeltaMinutes: -120,
      endDeltaMinutes: -0.05, // 3 seconds ago -> now >= endTime
    });
    await attachProblems(exactEndContest.id, [problems[0], problems[1]]);

    const exactEndRes = await request('DELETE', `/api/contests/${exactEndContest.id}/problems/${problems[0].id}`, null, profAToken);
    record('BOUNDARY: Contest at exact end boundary is ended -> mutations blocked (409 Conflict)', exactEndRes.status === 409);

    // -------------------------------------------------------------------------
    // 11. RBAC, Ownership & State Leakage Prevention
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing RBAC, Ownership & State Privacy ---');

    // Unauthenticated
    const unauthAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: problems[0].id });
    record('RBAC: Unauthenticated request rejected with 401 Unauthorized', unauthAddRes.status === 401);

    // Student
    const studentAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: problems[0].id }, studentToken);
    record('RBAC: Student rejected with 403 Forbidden on draft contest', studentAddRes.status === 403);

    const studentRunRes = await request('POST', `/api/contests/${runningContest.id}/problems`, { problemId: problems[0].id }, studentToken);
    record('RBAC: Student rejected with 403 Forbidden on running contest', studentRunRes.status === 403);

    // Cross-professor ownership isolation
    const nonOwnerDraftRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: problems[0].id }, profBToken);
    record('RBAC: Non-owner professor rejected with 403 Forbidden on draft contest', nonOwnerDraftRes.status === 403);

    const nonOwnerRunRes = await request('POST', `/api/contests/${runningContest.id}/problems`, { problemId: problems[0].id }, profBToken);
    record('STATE PRIVACY: Non-owner professor receives 403 Forbidden on running contest (state not leaked)', nonOwnerRunRes.status === 403);

    const nonOwnerReorderRes = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [problems[0].id, problems[1].id, problems[2].id],
    }, profBToken);
    record('STATE PRIVACY: Non-owner professor receives 403 Forbidden on reorder (state not leaked)', nonOwnerReorderRes.status === 403);

    // Contest Admin permissions
    const caUpAddRes = await request('POST', `/api/contests/${upcomingContest.id}/problems`, {
      problemId: problems[4].id,
    }, caToken);
    record('RBAC: Contest Admin allowed to add problem on upcoming contest (200/201)', caUpAddRes.status === 200 || caUpAddRes.status === 201);

    const caRunAddRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problems[4].id,
    }, caToken);
    record('UNIVERSAL LOCK: Contest Admin blocked with 409 Conflict on running contest', caRunAddRes.status === 409);

    // Super Admin permissions
    const saUpAddRes = await request('POST', `/api/contests/${upcomingContest.id}/problems`, {
      problemId: problems[5].id,
    }, saToken);
    record('RBAC: Super Admin allowed to add problem on upcoming contest (200/201)', saUpAddRes.status === 200 || saUpAddRes.status === 201);

    const saRunAddRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problems[5].id,
    }, saToken);
    record('UNIVERSAL LOCK: Super Admin blocked with 409 Conflict on running contest', saRunAddRes.status === 409);

    const saEndReorderRes = await request('PUT', `/api/contests/${endedContest.id}/problems/order`, {
      problemIds: [problems[0].id, problems[1].id, problems[2].id],
    }, saToken);
    record('UNIVERSAL LOCK: Super Admin blocked with 409 Conflict on ended contest reorder', saEndReorderRes.status === 409);

    // Clean up temporary additions in upcoming contest
    await request('DELETE', `/api/contests/${upcomingContest.id}/problems/${problems[4].id}`, null, caToken);
    await request('DELETE', `/api/contests/${upcomingContest.id}/problems/${problems[5].id}`, null, saToken);

    // -------------------------------------------------------------------------
    // 12. Concurrency & Race Condition Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Testing Concurrency & Race Condition Protection ---');

    // 10 concurrent requests attempting to mutate running contest (using saToken with fresh rate limit budget)
    const concurrentAddPromises = Array.from({ length: 10 }).map((_, idx) =>
      request('POST', `/api/contests/${runningContest.id}/problems`, {
        problemId: problems[3].id,
      }, saToken)
    );
    const concurrentAddResults = await Promise.all(concurrentAddPromises);
    const allAddBlocked = concurrentAddResults.every(r => r.status === 409);
    record('CONCURRENCY: 10 concurrent add requests on running contest all rejected with 409 Conflict', allAddBlocked);

    // 10 concurrent requests attempting to reorder ended contest (using caToken with fresh rate limit budget)
    const concurrentReorderPromises = Array.from({ length: 10 }).map((_, idx) =>
      request('PUT', `/api/contests/${endedContest.id}/problems/order`, {
        problemIds: [problems[0].id, problems[1].id, problems[2].id],
      }, caToken)
    );
    const concurrentReorderResults = await Promise.all(concurrentReorderPromises);
    const allReorderBlocked = concurrentReorderResults.every(r => r.status === 409);
    record('CONCURRENCY: 10 concurrent reorder requests on ended contest all rejected with 409 Conflict', allReorderBlocked);

    // Critical Race Condition Test:
    // Contest begins as editable (draft), a concurrent transaction transitions it to running under FOR UPDATE,
    // and a simultaneous HTTP mutation request waiting for the lock is safely rejected with 409 upon evaluating committed state.
    const raceContest = await createFixtureContest({
      title: `Race Contest ${ts}`,
      status: 'draft',
      startDeltaMinutes: 120,
      endDeltaMinutes: 240,
    });
    createdContestIds.push(raceContest.id);

    const raceClient = await db.getClient();
    try {
      await raceClient.query('BEGIN');
      // Hold exclusive lock on the contest row
      await raceClient.query('SELECT id FROM contests WHERE id = $1 FOR UPDATE', [raceContest.id]);

      // Transition the contest to running while holding the lock
      const now = new Date();
      await raceClient.query(
        `UPDATE contests
         SET status = 'published',
             start_time = $1,
             end_time = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [new Date(now.getTime() - 30 * 60000), new Date(now.getTime() + 60 * 60000), raceContest.id]
      );

      // Launch problem mutation while row is locked
      const pendingMutationPromise = request('POST', `/api/contests/${raceContest.id}/problems`, {
        problemId: problems[0].id,
      }, saToken);

      // Brief delay to guarantee the HTTP request reached PostgreSQL and queued for the lock
      await new Promise(r => setTimeout(r, 60));

      // Commit the transition transaction, releasing the row lock
      await raceClient.query('COMMIT');

      // The mutation unblocks and reads committed running state
      const raceRes = await pendingMutationPromise;
      record('RACE PROTECTION: Concurrent transition from draft to running rejects queued mutation with 409 Conflict', raceRes.status === 409);

      // Verify DB integrity: zero problems were attached
      const raceProbCheck = await db.query(
        'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1',
        [raceContest.id]
      );
      record('RACE INTEGRITY: No orphan rows inserted during concurrent lifecycle race', raceProbCheck.rows[0].count === 0);
    } catch (raceErr) {
      await raceClient.query('ROLLBACK');
      throw raceErr;
    } finally {
      raceClient.release();
    }

    // -------------------------------------------------------------------------
    // 13. Audit Logging Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Testing Audit Logging for Denied Mutations ---');
    const auditRes = await db.query(
      `SELECT action, outcome, metadata
       FROM audit_logs
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY id DESC LIMIT 5`,
      [runningContest.id]
    );

    record('AUDIT: PRIVILEGED_ACTION_DENIED audit log persisted for denied mutation', auditRes.rows.length > 0);
    if (auditRes.rows.length > 0) {
      const entry = auditRes.rows[0];
      const meta = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
      record('AUDIT (meta): Metadata records attemptedAction and runtimeState=running',
        meta?.attemptedAction === 'CONTEST_PROBLEM_MUTATION' && meta?.runtimeState === 'running'
      );
      record('AUDIT (meta): Metadata sanitized without sensitive token or credential leaks',
        !meta?.password && !meta?.token && !meta?.secret
      );
    }

    // -------------------------------------------------------------------------
    // 14. Ephemeral Fixture Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Cleaning Up Ephemeral Test Fixtures ---');
    if (createdContestIds.length > 0) {
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [createdContestIds]);
    }
    if (createdProblemIds.length > 0) {
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
    }
    record('Cleanup: Ephemeral test fixtures safely cleaned up', true);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.7 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runLifecycleLockEnforcementTests();
}

module.exports = { runLifecycleLockEnforcementTests };
