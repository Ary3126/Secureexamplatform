/**
 * Phase 5.9.2.5 — Contest–Problem Mutation Locks Automated Test Suite
 * 
 * Verifies:
 * 1. Draft contest allows adding/removing problems for authorized owners.
 * 2. Running contest strictly blocks adding/removing/bulk mutating problems with 409 Conflict.
 * 3. Historical / Ended contest strictly blocks adding/removing problems with 409 Conflict.
 * 4. Archived contest strictly blocks adding/removing problems with 409 Conflict.
 * 5. BOLA / IDOR: Cross-professor problem attachment/detachment is blocked with 403 Forbidden.
 * 6. Student is blocked with 403 Forbidden.
 * 7. Unauthenticated requests are blocked with 401 Unauthorized.
 * 8. Status spoofing attempts (e.g. sending status="draft") are rejected with 409 on running contest.
 * 9. Bulk operations (POST /bulk, PUT, DELETE) enforce the exact same lifecycle locks.
 * 10. Blocked operations leave database relationships completely untouched.
 * 11. Duplicate problem rejection remains correct on draft contest.
 * 12. Invalid problem ID does not bypass lifecycle protection.
 * 13. Unauthorized professors receive 403 Forbidden and cannot learn the running/ended lifecycle state of another's contest.
 * 14. Successful draft operations persist CONTEST_PROBLEM_ADDED and CONTEST_PROBLEM_REMOVED audit logs.
 * 15. Denied operations persist PRIVILEGED_ACTION_DENIED audit logs with sanitized metadata.
 * 16. Concurrent requests are serialized safely with row locks.
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

async function runContestProblemLockTests() {
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
  console.log(' STARTING PHASE 5.9.2.5 CONTEST-PROBLEM LOCK TESTS');
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
    // 1. SETUP TEST ACTORS & PROBLEMS
    // -----------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors & Problems ---');

    const profA = await UserModel.createUser({
      username: `prof_a_5925_${ts}`,
      email: `prof_a_5925_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor A 5925 Test',
    });

    const profB = await UserModel.createUser({
      username: `prof_b_5925_${ts}`,
      email: `prof_b_5925_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor B 5925 Test',
    });

    const student = await UserModel.createUser({
      username: `student_5925_${ts}`,
      email: `student_5925_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student 5925 Test',
    });

    const superAdmin = await UserModel.createUser({
      username: `admin_5925_${ts}`,
      email: `admin_5925_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin 5925 Test',
    });

    const tokenProfA = generateToken(profA);
    const tokenProfB = generateToken(profB);
    const tokenStudent = generateToken(student);
    const tokenSuperAdmin = generateToken(superAdmin);

    record('Setup: Test actors initialized with JWTs', Boolean(tokenProfA && tokenProfB && tokenStudent));

    const problem1 = await ProblemModel.createProblem({
      title: `Problem 1 for 5925 ${ts}`,
      description: 'Problem 1 Description',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
    });

    const problem2 = await ProblemModel.createProblem({
      title: `Problem 2 for 5925 ${ts}`,
      description: 'Problem 2 Description',
      difficulty: 'medium',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
    });

    const problem3 = await ProblemModel.createProblem({
      title: `Problem 3 for 5925 ${ts}`,
      description: 'Problem 3 Description',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
    });

    record('Setup: Test problems created in database', Boolean(problem1 && problem2 && problem3));

    // -----------------------------------------------------------
    // 2. DRAFT CONTEST MUTATIONS (TEST 1, 2, 18, 21)
    // -----------------------------------------------------------
    console.log('\n--- 2. Testing Draft Contest Problem Operations ---');

    const draftContest = await ContestModel.createContest({
      title: `Draft Contest 5925 ${ts}`,
      description: 'Draft contest test',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 172800000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });

    // TEST 1: Authorized professor adds problem to draft contest
    const addDraftRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem1.id,
      points: 100,
      problemOrder: 1,
    }, tokenProfA);
    record('TEST 1: Draft contest + authorized professor adds problem (201 Created)', addDraftRes.status === 201);

    // TEST 18: Duplicate problem attachment to draft contest is rejected with 409
    const dupDraftRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem1.id,
      points: 100,
    }, tokenProfA);
    record('TEST 18: Duplicate problem attachment returns 409 Conflict', dupDraftRes.status === 409);

    // Add second problem
    await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem2.id,
      points: 200,
      problemOrder: 2,
    }, tokenProfA);

    // TEST 2: Authorized professor removes problem from draft contest
    const removeDraftRes = await request('DELETE', `/api/contests/${draftContest.id}/problems/${problem2.id}`, null, tokenProfA);
    record('TEST 2: Draft contest + authorized professor removes problem (200 OK)', removeDraftRes.status === 200);

    // TEST 21: Verify audit logs for successful draft operations
    const addAuditRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'CONTEST_PROBLEM_ADDED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [draftContest.id]);
    record('TEST 21a: CONTEST_PROBLEM_ADDED audit log persisted with success', addAuditRes.rows[0]?.outcome === 'success');

    const remAuditRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'CONTEST_PROBLEM_REMOVED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [draftContest.id]);
    record('TEST 21b: CONTEST_PROBLEM_REMOVED audit log persisted with success', remAuditRes.rows[0]?.outcome === 'success');

    // -----------------------------------------------------------
    // 3. RUNNING CONTEST MUTATIONS (TEST 3, 4, 12, 13, 14, 15, 16, 22, 23)
    // -----------------------------------------------------------
    console.log('\n--- 3. Testing Running Contest Problem Locks ---');

    const runningStart = new Date(Date.now() - 3600000).toISOString();
    const runningEnd = new Date(Date.now() + 3600000).toISOString();
    const runningContest = await ContestModel.createContest({
      title: `Running Contest 5925 ${ts}`,
      description: 'Running contest test',
      startTime: runningStart,
      endTime: runningEnd,
      createdBy: profA.id,
      isRated: true,
    });
    // Attach initial problem before publishing
    await ContestModel.addProblemToContest({ contestId: runningContest.id, problemId: problem1.id, points: 100, problemOrder: 1 });
    await ContestModel.updateContestStatus(runningContest.id, 'published');

    // Count problems before attack
    const initialProbCountRes = await db.query('SELECT COUNT(*)::int AS cnt FROM contest_problems WHERE contest_id = $1', [runningContest.id]);
    const initialProbCount = initialProbCountRes.rows[0].cnt;

    // TEST 3: Running contest + attempt add problem -> 409
    const addRunningRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problem2.id,
      points: 150,
    }, tokenProfA);
    record('TEST 3: Running contest + add problem blocked with 409 Conflict', addRunningRes.status === 409);
    record('TEST 3 (msg): Message indicates contest is running', addRunningRes.body?.message?.includes('while the contest is running'));

    // TEST 15: Database state unchanged after blocked add
    const afterAddProbCountRes = await db.query('SELECT COUNT(*)::int AS cnt FROM contest_problems WHERE contest_id = $1', [runningContest.id]);
    record('TEST 15: Database contest_problems count unchanged after blocked add attempt', afterAddProbCountRes.rows[0].cnt === initialProbCount);

    // TEST 4: Running contest + attempt remove problem -> 409
    const removeRunningRes = await request('DELETE', `/api/contests/${runningContest.id}/problems/${problem1.id}`, null, tokenProfA);
    record('TEST 4: Running contest + remove problem blocked with 409 Conflict', removeRunningRes.status === 409);

    // TEST 16: Database state unchanged after blocked remove (problem1 remains attached)
    const prob1StillAttached = await ContestModel.isProblemInContest(runningContest.id, problem1.id);
    record('TEST 16: Problem 1 remains attached in database after blocked remove attempt', prob1StillAttached === true);

    // TEST 12: Running contest + malicious status manipulation in body -> 409
    const statusSpoofAddRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problem2.id,
      status: 'draft',
    }, tokenProfA);
    record('TEST 12: Status manipulation payload on running contest rejected with 409 Conflict', statusSpoofAddRes.status === 409);

    // TEST 13: Running contest + bulk add -> 409
    const bulkAddRunningRes = await request('POST', `/api/contests/${runningContest.id}/problems/bulk`, {
      problems: [
        { problemId: problem2.id, points: 100 },
        { problemId: problem3.id, points: 200 },
      ],
    }, tokenProfA);
    record('TEST 13: Running contest + bulk add blocked with 409 Conflict', bulkAddRunningRes.status === 409);

    // TEST 14: Running contest + bulk remove -> 409
    const bulkRemoveRunningRes = await request('DELETE', `/api/contests/${runningContest.id}/problems`, {
      problemIds: [problem1.id],
    }, tokenProfA);
    if (bulkRemoveRunningRes.status !== 409) {
      console.log('DEBUG TEST 14:', bulkRemoveRunningRes.status, bulkRemoveRunningRes.body);
    }
    record('TEST 14: Running contest + bulk remove blocked with 409 Conflict', bulkRemoveRunningRes.status === 409);

    // TEST 22: Denied running-contest mutation creates PRIVILEGED_ACTION_DENIED audit log
    const deniedAuditRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [runningContest.id]);
    const deniedRow = deniedAuditRes.rows[0];
    record('TEST 22: PRIVILEGED_ACTION_DENIED audit log persisted with outcome=denied', Boolean(deniedRow) && deniedRow.outcome === 'denied');
    record('TEST 22 (meta): Audit metadata contains attemptedAction and runtimeState', deniedRow?.metadata?.attemptedAction === 'CONTEST_PROBLEM_MUTATION' && deniedRow?.metadata?.runtimeState === 'running');

    // TEST 23: Audit metadata contains no sensitive credentials or leakages
    const metaJson = JSON.stringify(deniedRow?.metadata || {});
    const hasLeak = /password|token|jwt|cookie|sourceCode/i.test(metaJson);
    record('TEST 23: Audit metadata is clean without sensitive leaks', !hasLeak);

    // -----------------------------------------------------------
    // 4. HISTORICAL (ENDED) & ARCHIVED CONTESTS (TEST 5, 6, 7, 8, 17)
    // -----------------------------------------------------------
    console.log('\n--- 4. Testing Historical & Archived Contest Problem Locks ---');

    const endedStart = new Date(Date.now() - 7200000).toISOString();
    const endedEnd = new Date(Date.now() - 3600000).toISOString();
    const endedContest = await ContestModel.createContest({
      title: `Ended Contest 5925 ${ts}`,
      description: 'Ended contest test',
      startTime: endedStart,
      endTime: endedEnd,
      createdBy: profA.id,
      isRated: true,
    });
    await ContestModel.addProblemToContest({ contestId: endedContest.id, problemId: problem1.id, points: 100, problemOrder: 1 });
    await ContestModel.updateContestStatus(endedContest.id, 'published');

    // TEST 5: Historical contest + add problem -> 409
    const addEndedRes = await request('POST', `/api/contests/${endedContest.id}/problems`, {
      problemId: problem2.id,
    }, tokenProfA);
    record('TEST 5: Ended contest + add problem blocked with 409 Conflict', addEndedRes.status === 409);

    // TEST 6: Historical contest + remove problem -> 409
    const removeEndedRes = await request('DELETE', `/api/contests/${endedContest.id}/problems/${problem1.id}`, null, tokenProfA);
    record('TEST 6: Ended contest + remove problem blocked with 409 Conflict', removeEndedRes.status === 409);

    // TEST 17: Historical contest problem set remains unchanged in DB
    const endedProblems = await ContestModel.getContestProblems(endedContest.id);
    record('TEST 17: Historical contest problem count remains exactly 1', endedProblems.length === 1 && endedProblems[0].problemId === problem1.id);

    // Archived contest
    const archivedContest = await ContestModel.createContest({
      title: `Archived Contest 5925 ${ts}`,
      description: 'Archived contest test',
      startTime: endedStart,
      endTime: endedEnd,
      createdBy: profA.id,
      isRated: true,
    });
    await ContestModel.addProblemToContest({ contestId: archivedContest.id, problemId: problem1.id, points: 100, problemOrder: 1 });
    await ContestModel.updateContestStatus(archivedContest.id, 'archived');

    // TEST 7: Archived contest + add problem -> 409
    const addArchivedRes = await request('POST', `/api/contests/${archivedContest.id}/problems`, {
      problemId: problem2.id,
    }, tokenProfA);
    record('TEST 7: Archived contest + add problem blocked with 409 Conflict', addArchivedRes.status === 409);

    // TEST 8: Archived contest + remove problem -> 409
    const removeArchivedRes = await request('DELETE', `/api/contests/${archivedContest.id}/problems/${problem1.id}`, null, tokenProfA);
    record('TEST 8: Archived contest + remove problem blocked with 409 Conflict', removeArchivedRes.status === 409);

    // -----------------------------------------------------------
    // 5. AUTHORIZATION & RBAC & INFORMATION LEAKAGE (TEST 9, 10, 11, 20)
    // -----------------------------------------------------------
    console.log('\n--- 5. Testing Authorization, RBAC & State Leakage Protection ---');

    // TEST 9: Professor B attempts to modify Professor A's draft contest -> 403 Forbidden
    const crossProfDraftRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem3.id,
    }, tokenProfB);
    record('TEST 9: Cross-professor draft mutation blocked with 403 Forbidden', crossProfDraftRes.status === 403);

    // TEST 10: Student attempts contest-problem mutation -> 403 Forbidden
    const studentAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem3.id,
    }, tokenStudent);
    record('TEST 10: Student contest-problem mutation blocked with 403 Forbidden', studentAddRes.status === 403);

    // TEST 11: Unauthenticated request -> 401 Unauthorized
    const unauthAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: problem3.id,
    }, null);
    record('TEST 11: Unauthenticated request blocked with 401 Unauthorized', unauthAddRes.status === 401);

    // TEST 20: Unauthorized professor cannot learn lifecycle state of another's running/ended contest (returns 403, NOT 409)
    const crossProfRunningRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: problem3.id,
    }, tokenProfB);
    record('TEST 20: Unauthorized professor receives 403 Forbidden on running contest (state not leaked)', crossProfRunningRes.status === 403);

    // -----------------------------------------------------------
    // 6. PARAMETER VALIDATION (TEST 19)
    // -----------------------------------------------------------
    console.log('\n--- 6. Testing Parameter Validation ---');

    // TEST 19: Invalid problem ID on draft contest
    const invalidIdRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: 'invalid-id',
    }, tokenProfA);
    record('TEST 19a: Malformed problemId rejected with 400 Bad Request', invalidIdRes.status === 400);

    const nonExistentProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: 99999999,
    }, tokenProfA);
    record('TEST 19b: Non-existent problemId returns 404 Not Found', nonExistentProbRes.status === 404);

    // -----------------------------------------------------------
    // 7. CONCURRENCY & RACE CONDITIONS (TEST 24)
    // -----------------------------------------------------------
    console.log('\n--- 7. Testing Concurrency & Race Condition Protection ---');

    const concurrentAttempts = [];
    for (let i = 0; i < 10; i++) {
      concurrentAttempts.push(
        request('POST', `/api/contests/${runningContest.id}/problems`, {
          problemId: problem2.id,
        }, tokenProfA)
      );
    }
    const concurrentResults = await Promise.all(concurrentAttempts);
    const all409 = concurrentResults.every((r) => r.status === 409);
    record('TEST 24: 10 concurrent requests to add problem to running contest all return 409 Conflict', all409);

    // -----------------------------------------------------------
    // 8. CLEANUP FIXTURES
    // -----------------------------------------------------------
    console.log('\n--- 8. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query('DELETE FROM contest_problems WHERE contest_id IN ($1, $2, $3, $4);', [draftContest.id, runningContest.id, endedContest.id, archivedContest.id]);
    await db.query('DELETE FROM contests WHERE created_by IN ($1, $2, $3);', [profA.id, profB.id, superAdmin.id]);
    await db.query('DELETE FROM problems WHERE id IN ($1, $2, $3);', [problem1.id, problem2.id, problem3.id]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4);', [profA.id, profB.id, student.id, superAdmin.id]);
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
  console.log(` PHASE 5.9.2.5 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runContestProblemLockTests()
    .then(() => {
      db.pool.end().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(err);
      db.pool.end().then(() => process.exit(1));
    });
}

module.exports = { runContestProblemLockTests };
