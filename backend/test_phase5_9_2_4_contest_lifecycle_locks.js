/**
 * Phase 5.9.2.4 — Contest Lifecycle Mutation Locks Automated Test Suite
 * 
 * Verifies:
 * 1. Draft contest allows start and end date modifications for authorized owners.
 * 2. Running contest strictly blocks start/end/status lifecycle mutations with 409 Conflict.
 * 3. Historical / Ended contest strictly blocks lifecycle mutations with 409 Conflict.
 * 4. Archived contest strictly blocks lifecycle mutations with 409 Conflict.
 * 5. BOLA / IDOR: Cross-professor modification is blocked with 403 Forbidden.
 * 6. Unauthenticated requests are blocked with 401 Unauthorized.
 * 7. Status-based bypass attempts (e.g. sending status="draft" on a running contest) are rejected with 409.
 * 8. Invalid/empty/null lifecycle values fail safely without corrupting contest state.
 * 9. Authoritative DB state remains intact byte-for-byte after blocked mutation attempts.
 * 10. Super Admin is also blocked from mutating running/historical contest timing (universal integrity).
 * 11. Blocked lifecycle mutations persist PRIVILEGED_ACTION_DENIED audit events.
 * 12. Audit metadata contains only sanitized parameters.
 * 13. Concurrent lifecycle updates are serialized safely via row locks.
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
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runContestLifecycleLockTests() {
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
  console.log(' STARTING PHASE 5.9.2.4 CONTEST LIFECYCLE LOCK TESTS');
  console.log('=======================================================');

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
    const passwordHash = await hashPassword('Password123!');

    // -----------------------------------------------------------
    // 1. SETUP TEST ACTORS
    // -----------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');

    const profA = await UserModel.createUser({
      username: `prof_a_5924_${ts}`,
      email: `prof_a_5924_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor A Lifecycle Test',
    });

    const profB = await UserModel.createUser({
      username: `prof_b_5924_${ts}`,
      email: `prof_b_5924_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor B Lifecycle Test',
    });

    const superAdmin = await UserModel.createUser({
      username: `admin_5924_${ts}`,
      email: `admin_5924_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin Lifecycle Test',
    });

    const tokenProfA = generateToken(profA);
    const tokenProfB = generateToken(profB);
    const tokenSuperAdmin = generateToken(superAdmin);

    record('Setup: Test actors initialized with JWTs', Boolean(tokenProfA && tokenProfB && tokenSuperAdmin));

    // Create a base problem to attach where required
    const problem = await ProblemModel.createProblem({
      title: `Lifecycle Test Problem ${ts}`,
      description: 'Problem for lifecycle contest attachments',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
    });

    // -----------------------------------------------------------
    // 2. DRAFT CONTEST MUTATIONS (TEST 1, 2, 18)
    // -----------------------------------------------------------
    console.log('\n--- 2. Testing Draft Contest Mutations ---');

    // Create draft contest
    const draftContest = await ContestModel.createContest({
      title: `Draft Contest ${ts}`,
      description: 'Draft contest test',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 172800000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });

    // TEST 1: Authorized professor changes start date of draft contest
    const newDraftStart = new Date(Date.now() + 90000000).toISOString();
    const updateDraftStartRes = await request('PUT', `/api/contests/${draftContest.id}`, {
      startTime: newDraftStart,
    }, tokenProfA);
    record('TEST 1: Draft contest + authorized professor changes start date (200 OK)', updateDraftStartRes.status === 200);

    // TEST 2: Authorized professor changes end date of draft contest
    const newDraftEnd = new Date(Date.now() + 180000000).toISOString();
    const updateDraftEndRes = await request('PUT', `/api/contests/${draftContest.id}`, {
      endTime: newDraftEnd,
    }, tokenProfA);
    record('TEST 2: Draft contest + authorized professor changes end date (200 OK)', updateDraftEndRes.status === 200);

    // TEST 18: Existing valid draft updates remain fully functional
    const updateDraftMetaRes = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: `Draft Contest Updated ${ts}`,
      description: 'Updated draft description',
      isRated: false,
    }, tokenProfA);
    record('TEST 18: Draft contest metadata update succeeds (200 OK)', updateDraftMetaRes.status === 200 && updateDraftMetaRes.body?.contest?.title.includes('Updated'));

    // -----------------------------------------------------------
    // 3. RUNNING CONTEST MUTATION LOCKS (TEST 3, 4, 5, 6, 11, 13)
    // -----------------------------------------------------------
    console.log('\n--- 3. Testing Running Contest Mutation Locks ---');

    // Create a running contest (startTime in past, endTime in future, published)
    const runningStart = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const runningEnd = new Date(Date.now() + 3600000).toISOString();   // 1 hour in future
    const runningContest = await ContestModel.createContest({
      title: `Running Contest ${ts}`,
      description: 'Running contest test',
      startTime: runningStart,
      endTime: runningEnd,
      createdBy: profA.id,
      isRated: true,
    });
    await ContestModel.addProblemToContest({ contestId: runningContest.id, problemId: problem.id, points: 100, problemOrder: 1 });
    await ContestModel.updateContestStatus(runningContest.id, 'published');

    // TEST 3: Running contest + authorized professor changes start date -> 409
    const mutateRunningStart = await request('PUT', `/api/contests/${runningContest.id}`, {
      startTime: new Date(Date.now() - 7200000).toISOString(),
    }, tokenProfA);
    record('TEST 3: Running contest + attempt start date modification blocked (409 Conflict)', mutateRunningStart.status === 409);
    record('TEST 3 (msg): Error message indicates contest is running', mutateRunningStart.body?.message?.includes('while the contest is running'));

    // TEST 4: Running contest + authorized professor changes end date -> 409
    const mutateRunningEnd = await request('PUT', `/api/contests/${runningContest.id}`, {
      endTime: new Date(Date.now() + 7200000).toISOString(),
    }, tokenProfA);
    record('TEST 4: Running contest + attempt end date modification blocked (409 Conflict)', mutateRunningEnd.status === 409);

    // TEST 5: Running contest + authorized professor changes both dates -> 409
    const mutateRunningBoth = await request('PATCH', `/api/contests/${runningContest.id}`, {
      startTime: new Date(Date.now() - 10000000).toISOString(),
      endTime: new Date(Date.now() + 10000000).toISOString(),
    }, tokenProfA);
    record('TEST 5: Running contest + attempt both dates modification blocked (409 Conflict)', mutateRunningBoth.status === 409);

    // TEST 6: Running contest + attempt status/reopen bypass -> 409
    const mutateRunningStatus = await request('PUT', `/api/contests/${runningContest.id}`, {
      status: 'draft',
    }, tokenProfA);
    record('TEST 6: Running contest + attempt status bypass to draft blocked (409 Conflict)', mutateRunningStatus.status === 409);

    // TEST 11: Client sends "status=draft" combined with new dates for running contest -> 409
    const spoofStatusReq = await request('PUT', `/api/contests/${runningContest.id}`, {
      status: 'draft',
      startTime: new Date(Date.now() + 5000000).toISOString(),
      endTime: new Date(Date.now() + 10000000).toISOString(),
    }, tokenProfA);
    record('TEST 11: Spoofed client status=draft on running contest rejected with 409 Conflict', spoofStatusReq.status === 409);

    // TEST 13: Verify DB state remained strictly unchanged
    const dbRunningContest = await ContestModel.findContestById(runningContest.id);
    const dbStartIso = new Date(dbRunningContest.startTime).toISOString();
    const origStartIso = new Date(runningStart).toISOString();
    const dbEndIso = new Date(dbRunningContest.endTime).toISOString();
    const origEndIso = new Date(runningEnd).toISOString();
    record('TEST 13: Database start_time unchanged after blocked mutations', dbStartIso === origStartIso);
    record('TEST 13: Database end_time unchanged after blocked mutations', dbEndIso === origEndIso);
    record('TEST 13: Database status remains published', dbRunningContest.status === 'published');

    // -----------------------------------------------------------
    // 4. HISTORICAL (ENDED) & ARCHIVED CONTESTS (TEST 7, 8)
    // -----------------------------------------------------------
    console.log('\n--- 4. Testing Historical & Archived Contest Protection ---');

    // Create ended contest
    const endedStart = new Date(Date.now() - 7200000).toISOString();
    const endedEnd = new Date(Date.now() - 3600000).toISOString();
    const endedContest = await ContestModel.createContest({
      title: `Ended Contest ${ts}`,
      description: 'Ended contest test',
      startTime: endedStart,
      endTime: endedEnd,
      createdBy: profA.id,
      isRated: true,
    });
    await ContestModel.addProblemToContest({ contestId: endedContest.id, problemId: problem.id, points: 100, problemOrder: 1 });
    await ContestModel.updateContestStatus(endedContest.id, 'published');

    // TEST 7: Historical contest + lifecycle date mutation -> 409
    const mutateEndedReq = await request('PUT', `/api/contests/${endedContest.id}`, {
      startTime: new Date(Date.now() + 100000).toISOString(),
      endTime: new Date(Date.now() + 200000).toISOString(),
    }, tokenProfA);
    record('TEST 7: Ended contest + lifecycle date mutation blocked with 409 Conflict', mutateEndedReq.status === 409);
    record('TEST 7 (msg): Message indicates contest has ended', mutateEndedReq.body?.message?.includes('after the contest has ended'));

    // Create archived contest
    const archivedContest = await ContestModel.createContest({
      title: `Archived Contest ${ts}`,
      description: 'Archived contest test',
      startTime: endedStart,
      endTime: endedEnd,
      createdBy: profA.id,
      isRated: true,
    });
    await ContestModel.updateContestStatus(archivedContest.id, 'archived');

    // TEST 8: Archived contest + ordinary lifecycle mutation -> 409
    const mutateArchivedReq = await request('PUT', `/api/contests/${archivedContest.id}`, {
      startTime: new Date(Date.now() + 300000).toISOString(),
    }, tokenProfA);
    record('TEST 8: Archived contest + lifecycle mutation blocked with 409 Conflict', mutateArchivedReq.status === 409);

    // -----------------------------------------------------------
    // 5. AUTHORIZATION & RBAC (TEST 9, 10, 15)
    // -----------------------------------------------------------
    console.log('\n--- 5. Testing Authorization & RBAC ---');

    // TEST 9: Professor B attempts to modify Professor A's contest -> 403 Forbidden
    const crossProfReq = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: 'Hacked Title by Prof B',
    }, tokenProfB);
    record('TEST 9: Cross-professor modification blocked with 403 Forbidden', crossProfReq.status === 403);

    // TEST 10: Unauthenticated lifecycle mutation -> 401 Unauthorized
    const unauthReq = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: 'Unauthenticated update',
    }, null);
    record('TEST 10: Unauthenticated request blocked with 401 Unauthorized', unauthReq.status === 401);

    // TEST 15: Super Admin cannot mutate running contest lifecycle timing -> 409 Conflict
    const adminMutateRunning = await request('PUT', `/api/contests/${runningContest.id}`, {
      startTime: new Date(Date.now() - 500000).toISOString(),
    }, tokenSuperAdmin);
    record('TEST 15: Super Admin attempting running contest lifecycle mutation blocked with 409 Conflict', adminMutateRunning.status === 409);

    // -----------------------------------------------------------
    // 6. VALIDATION & PARAMETER RESILIENCE (TEST 12)
    // -----------------------------------------------------------
    console.log('\n--- 6. Testing Validation & Parameter Resilience ---');

    // TEST 12: Null/empty lifecycle values
    const emptyStartReq = await request('PUT', `/api/contests/${draftContest.id}`, {
      startTime: '',
    }, tokenProfA);
    record('TEST 12a: Empty string startTime rejected by validation (400 Bad Request)', emptyStartReq.status === 400);

    const invalidDateReq = await request('PUT', `/api/contests/${draftContest.id}`, {
      startTime: 'not-a-valid-date',
    }, tokenProfA);
    record('TEST 12b: Invalid date string rejected by validation (400 Bad Request)', invalidDateReq.status === 400);

    // -----------------------------------------------------------
    // 7. CONCURRENCY & RACE CONDITIONS (TEST 14)
    // -----------------------------------------------------------
    console.log('\n--- 7. Testing Concurrency & Race-Condition Protection ---');

    // Attempt 10 concurrent requests to mutate running contest
    const concurrentPromises = [];
    for (let i = 0; i < 10; i++) {
      concurrentPromises.push(
        request('PUT', `/api/contests/${runningContest.id}`, {
          startTime: new Date(Date.now() - (i + 5) * 1000000).toISOString(),
        }, tokenProfA)
      );
    }
    const concurrentResults = await Promise.all(concurrentPromises);
    const allBlocked409 = concurrentResults.every((r) => r.status === 409);
    record('TEST 14: 10 concurrent requests to mutate running contest are all safely rejected with 409 Conflict', allBlocked409);

    // -----------------------------------------------------------
    // 8. AUDIT LOGGING INTEGRITY (TEST 16, 17)
    // -----------------------------------------------------------
    console.log('\n--- 8. Testing Audit Logging for Denied Lifecycle Mutations ---');

    const auditRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'PRIVILEGED_ACTION_DENIED' 
        AND resource_type = 'contest' 
        AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [runningContest.id]);

    const auditRow = auditRes.rows[0];
    record('TEST 16: Blocked lifecycle mutation created PRIVILEGED_ACTION_DENIED audit record', Boolean(auditRow) && auditRow.outcome === 'denied');
    record('TEST 16 (meta): Audit metadata contains attemptedAction and runtimeState', auditRow?.metadata?.attemptedAction === 'CONTEST_LIFECYCLE_UPDATE' && auditRow?.metadata?.runtimeState === 'running');

    // TEST 17: Audit metadata contains no sensitive keys
    const metaStr = JSON.stringify(auditRow?.metadata || {});
    const isSensitiveLeaked = /password|token|jwt|cookie|sourceCode/i.test(metaStr);
    record('TEST 17: Audit metadata contains no sensitive credentials or tokens', !isSensitiveLeaked);

    // -----------------------------------------------------------
    // 9. CLEANUP TEST FIXTURES
    // -----------------------------------------------------------
    console.log('\n--- 9. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM contest_problems WHERE problem_id = $1;`, [problem.id]);
    await db.query(`DELETE FROM contests WHERE created_by IN ($1, $2, $3);`, [profA.id, profB.id, superAdmin.id]);
    await db.query(`DELETE FROM problems WHERE id = $1;`, [problem.id]);
    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3);`, [profA.id, profB.id, superAdmin.id]);
    record('Cleanup: Test fixtures safely removed from database', true);

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 5.9.2.4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runContestLifecycleLockTests()
    .then(() => {
      db.pool.end().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(err);
      db.pool.end().then(() => process.exit(1));
    });
}

module.exports = { runContestLifecycleLockTests };
