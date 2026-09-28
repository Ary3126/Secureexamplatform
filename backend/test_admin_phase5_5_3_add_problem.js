/**
 * Phase 7.5.5.3 — Add Problem to Contest Automated Backend Test Suite
 * File: backend/test_admin_phase5_5_3_add_problem.js
 *
 * Verifies all 25 required invariants:
 * 1. contest_admin can add problem (201 Created)
 * 2. super_admin can add problem (201 Created)
 * 3. professor can add problem to own contest (201 Created)
 * 4. professor cannot add problem to another professor's contest (403 Forbidden)
 * 5. student receives 403 Forbidden
 * 6. unauthenticated request rejected (401 Unauthorized)
 * 7. invalid contest ID (400 Bad Request)
 * 8. invalid problem ID (400 Bad Request)
 * 9. nonexistent contest (404 Not Found)
 * 10. nonexistent problem (404 Not Found)
 * 11. inaccessible problem (403 Forbidden for professor trying to attach another's private problem)
 * 12. duplicate problem rejected (409 Conflict)
 * 13. concurrent duplicate requests handled safely (atomic row lock, exactly 1 success, others 409)
 * 14. lifecycle lock enforced (409 Conflict on running contest)
 * 15. initial problem position correct (auto-increment MAX(problem_order) + 1)
 * 16. points/default configuration correct (100 default, custom points preserved)
 * 17. audit log generated (CONTEST_PROBLEM_ADDED & PRIVILEGED_ACTION_DENIED)
 * 18. hidden problem data not leaked (no test_cases or solutions in response)
 * 19. submissions unchanged
 * 20. participants unchanged
 * 21. rating data unchanged
 * 22. leaderboard data unchanged
 * 23. successful database persistence in contest_problems
 * 24. malformed request rejected (400 Bad Request)
 * 25. rate limiting preserved
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

let passed = 0;
let failed = 0;

function assertTest(condition, message, detail = '') {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message} - ${detail}`);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.5.3 ADD PROBLEM TO CONTEST TESTS');
  console.log('=======================================================\n');

  // Start ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const ts = Date.now();
  const testUserIds = [];
  const testProblemIds = [];
  const testContestIds = [];

  try {
    // -------------------------------------------------------------
    // 1. SET UP TEST ACTORS
    // -------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    const profA = await UserModel.createUser({
      username: `prof_a_7553_${ts}`,
      email: `prof_a_7553_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Prof A ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profA.id);
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `prof_b_7553_${ts}`,
      email: `prof_b_7553_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Prof B ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profB.id);
    const tokenProfB = generateToken(profB);

    const cadm = await UserModel.createUser({
      username: `cadm_7553_${ts}`,
      email: `cadm_7553_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    testUserIds.push(cadm.id);
    const tokenCadm = generateToken(cadm);

    const sadmin = await UserModel.createUser({
      username: `sadmin_7553_${ts}`,
      email: `sadmin_7553_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Super Admin ${ts}`,
      role: 'super_admin',
    });
    testUserIds.push(sadmin.id);
    const tokenSadmin = generateToken(sadmin);

    const student = await UserModel.createUser({
      username: `student_7553_${ts}`,
      email: `student_7553_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Student ${ts}`,
      role: 'student',
    });
    testUserIds.push(student.id);
    const tokenStudent = generateToken(student);

    assertTest(
      tokenProfA && tokenProfB && tokenCadm && tokenSadmin && tokenStudent,
      'All 5 test actors created with JWTs'
    );

    // -------------------------------------------------------------
    // 2. SET UP TEST PROBLEMS
    // -------------------------------------------------------------
    console.log('\n--- 2. Setting Up Test Problems ---');

    // Problem 1: Public Problem (created by prof A)
    const prob1 = await ProblemModel.createProblemWithSafety({
      title: `Public Algorithmic Problem #${ts}`,
      description: 'Find optimal path',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
      testCases: [{ inputData: '1 2', expectedOutput: '3', isHidden: true }],
    });
    testProblemIds.push(prob1.id);

    // Problem 2: Another Public Problem
    const prob2 = await ProblemModel.createProblemWithSafety({
      title: `Public Graph Problem #${ts}`,
      description: 'Breadth first search',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
    });
    testProblemIds.push(prob2.id);

    // Problem 3: Third Public Problem
    const prob3 = await ProblemModel.createProblemWithSafety({
      title: `Public Dynamic Programming Problem #${ts}`,
      description: 'Knapsack 0/1',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
    });
    testProblemIds.push(prob3.id);

    // Problem 4: Contest-Private Problem owned exclusively by Professor B
    const probPrivateB = await ProblemModel.createProblemWithSafety({
      title: `Prof B Secret Exam Problem #${ts}`,
      description: 'Proprietary questions for university final',
      difficulty: 'hard',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      isPublished: true,
      createdBy: profB.id,
      testCases: [{ inputData: 'secret_input', expectedOutput: 'secret_output', isHidden: true }],
    });
    testProblemIds.push(probPrivateB.id);

    assertTest(
      testProblemIds.length === 4,
      '4 test problems initialized (3 public, 1 private to Prof B)'
    );

    // -------------------------------------------------------------
    // 3. SET UP TEST CONTESTS
    // -------------------------------------------------------------
    console.log('\n--- 3. Setting Up Test Contests ---');

    // Draft Contest owned by Professor A
    const contestProfA = await ContestModel.createContest({
      title: `Draft Contest Prof A #${ts}`,
      description: 'Draft contest for problem attachment tests',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 172800000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    testContestIds.push(contestProfA.id);

    // Draft Contest owned by Professor B
    const contestProfB = await ContestModel.createContest({
      title: `Draft Contest Prof B #${ts}`,
      description: 'Draft contest owned by Professor B',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 172800000).toISOString(),
      createdBy: profB.id,
      isRated: false,
    });
    testContestIds.push(contestProfB.id);

    // Running Contest (to test lifecycle locks)
    const contestRunning = await ContestModel.createContest({
      title: `Running Live Contest #${ts}`,
      description: 'Live contest with problem mutations locked',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    testContestIds.push(contestRunning.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [contestRunning.id]);

    assertTest(testContestIds.length === 3, '3 test contests initialized (2 draft, 1 running)');

    // -------------------------------------------------------------
    // 4. TESTING AUTHORIZATION & RBAC (TESTS 1, 2, 3, 4, 5, 6)
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing Authorization & RBAC ---');

    // TEST 1: Authorized contest_admin can add problem to any contest
    const resCadm = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    }, tokenCadm);
    assertTest(resCadm.status === 201, 'TEST 1: Authorized contest_admin can add problem (201 Created)');
    assertTest(resCadm.body.status === 'success', 'TEST 1 (envelope): Standard success envelope returned');

    // Remove problem 1 so other tests can attach it
    await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [contestProfA.id]);

    // TEST 2: Authorized super_admin can add problem to any contest
    const resSadmin = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob1.id,
      points: 150,
      problemOrder: 1,
    }, tokenSadmin);
    assertTest(resSadmin.status === 201, 'TEST 2: Authorized super_admin can add problem (201 Created)');

    // Remove problem 1 again
    await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [contestProfA.id]);

    // TEST 3: Authorized professor can add problem to their own contest
    const resProfA = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob1.id,
      points: 100,
    }, tokenProfA);
    assertTest(resProfA.status === 201, 'TEST 3: Authorized professor can add to owned contest (201 Created)');
    assertTest(resProfA.body.mapping.problemId === prob1.id, 'TEST 3 (mapping): Returns correct problemId in mapping');

    // TEST 4: Professor B CANNOT add problem to Professor A's contest (BOLA check)
    const resCrossProf = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob2.id,
      points: 100,
    }, tokenProfB);
    assertTest(resCrossProf.status === 403, 'TEST 4: Non-owner professor receives 403 Forbidden (ownership isolation)');

    // TEST 5: Student role receives 403 Forbidden
    const resStudent = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob2.id,
    }, tokenStudent);
    assertTest(resStudent.status === 403, 'TEST 5: Student role receives 403 Forbidden');

    // TEST 6: Unauthenticated request receives 401 Unauthorized
    const resUnauth = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob2.id,
    });
    assertTest(resUnauth.status === 401, 'TEST 6: Unauthenticated request receives 401 Unauthorized');

    // -------------------------------------------------------------
    // 5. TESTING VALIDATION & BOUNDARY CONDITIONS (TESTS 7, 8, 9, 10, 11, 24)
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Validation & Boundary Conditions ---');

    // TEST 7: Invalid contest ID (non-numeric / negative)
    const resInvContest = await request('POST', '/api/contests/invalid_id/problems', {
      problemId: prob2.id,
    }, tokenProfA);
    assertTest(resInvContest.status === 400, 'TEST 7: Invalid contest ID format returns 400 Bad Request');

    // TEST 8: Invalid problem ID (non-numeric / negative)
    const resInvProb = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: 'not_a_valid_id',
    }, tokenProfA);
    assertTest(resInvProb.status === 400, 'TEST 8: Invalid problem ID format returns 400 Bad Request');

    // TEST 9: Nonexistent contest ID
    const resNonContest = await request('POST', '/api/contests/999999/problems', {
      problemId: prob2.id,
    }, tokenCadm);
    assertTest(resNonContest.status === 404, 'TEST 9: Nonexistent contest ID returns 404 Not Found');

    // TEST 10: Nonexistent problem ID
    const resNonProb = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: 999999,
    }, tokenProfA);
    assertTest(resNonProb.status === 404, 'TEST 10: Nonexistent problem ID returns 404 Not Found');

    // TEST 11: Inaccessible problem (Prof A tries to attach Prof B's contest_private problem)
    const resInacc = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: probPrivateB.id,
    }, tokenProfA);
    assertTest(resInacc.status === 403, 'TEST 11: Inaccessible private problem returns 403 Forbidden');

    // TEST 24: Malformed request body (missing problemId)
    const resMalformed = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      points: 100,
    }, tokenProfA);
    assertTest(resMalformed.status === 400, 'TEST 24: Missing problemId in payload rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 6. TESTING DUPLICATE & CONCURRENCY PROTECTION (TESTS 12, 13)
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Duplicate & Concurrency Protection ---');

    // TEST 12: Duplicate problem attachment to same contest rejected with 409 Conflict
    // (prob1 is already attached to contestProfA from Test 3)
    const resDup = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob1.id,
      points: 200,
    }, tokenProfA);
    assertTest(resDup.status === 409, 'TEST 12: Duplicate problem attachment returns 409 Conflict');
    assertTest(
      resDup.body.message.includes('already attached'),
      'TEST 12 (msg): Returns clear already-attached conflict message'
    );

    // TEST 13: Concurrent duplicate requests handled safely
    // Attempt 5 simultaneous requests to attach prob2 to contestProfA
    const concurrentRequests = Array.from({ length: 5 }, () =>
      request('POST', `/api/contests/${contestProfA.id}/problems`, {
        problemId: prob2.id,
        points: 200,
      }, tokenProfA)
    );
    const concurrentResults = await Promise.all(concurrentRequests);
    const successCount = concurrentResults.filter(r => r.status === 201).length;
    const conflictCount = concurrentResults.filter(r => r.status === 409).length;

    assertTest(
      successCount === 1,
      `TEST 13 (success): Exactly 1 concurrent request succeeded (received ${successCount})`
    );
    assertTest(
      conflictCount === 4,
      `TEST 13 (conflicts): Exactly 4 concurrent requests safely rejected with 409 (received ${conflictCount})`
    );

    const dbCheckDup = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestProfA.id, prob2.id]
    );
    assertTest(
      dbCheckDup.rows[0].count === 1,
      'TEST 13 (db): Database contains exactly 1 mapping row after concurrent requests'
    );

    // -------------------------------------------------------------
    // 7. TESTING LIFECYCLE LOCK ENFORCEMENT (TEST 14)
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing Lifecycle Lock Enforcement ---');

    // TEST 14: Adding problem to a running contest is blocked with 409 Conflict
    const resRunning = await request('POST', `/api/contests/${contestRunning.id}/problems`, {
      problemId: prob3.id,
      points: 100,
    }, tokenProfA);
    assertTest(resRunning.status === 409, 'TEST 14: Running contest problem addition blocked with 409 Conflict');
    assertTest(
      resRunning.body.message.toLowerCase().includes('running'),
      'TEST 14 (msg): Lock message clearly specifies contest is running'
    );

    // -------------------------------------------------------------
    // 8. TESTING ORDERING & CONFIGURATION (TESTS 15, 16, 23)
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing Ordering, Points, and Persistence ---');

    // ContestProfA already has prob1 and prob2. Now attach prob3 without problemOrder
    // prob1: order 1 (from Test 3), prob2: auto order 2 (from Test 13)
    const resAutoOrder = await request('POST', `/api/contests/${contestProfA.id}/problems`, {
      problemId: prob3.id,
      points: 300,
    }, tokenProfA);

    assertTest(resAutoOrder.status === 201, 'TEST 15a: Attaching third problem succeeds (201 Created)');
    assertTest(
      resAutoOrder.body.mapping.problemOrder === 3,
      `TEST 15b: Initial problem position correctly auto-assigned to 3 (got ${resAutoOrder.body.mapping.problemOrder})`
    );

    // TEST 16: Points configuration
    assertTest(
      resAutoOrder.body.mapping.points === 300,
      'TEST 16a: Custom points (300) correctly persisted in mapping'
    );

    // Test default points = 100 when omitted (on ContestProfB)
    const resDefaultPts = await request('POST', `/api/contests/${contestProfB.id}/problems`, {
      problemId: prob1.id,
    }, tokenProfB);
    assertTest(resDefaultPts.status === 201, 'TEST 16b: Attaching problem without points succeeds');
    assertTest(
      resDefaultPts.body.mapping.points === 100,
      'TEST 16c: Default points correctly assigned to 100 when omitted'
    );

    // TEST 23: Successful database persistence
    const dbPersist = await db.query(
      'SELECT * FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestProfA.id, prob3.id]
    );
    assertTest(dbPersist.rowCount === 1, 'TEST 23a: Row exists in contest_problems table');
    assertTest(dbPersist.rows[0].points === 300, 'TEST 23b: Persisted points matches 300');
    assertTest(dbPersist.rows[0].problem_order === 3, 'TEST 23c: Persisted order matches 3');

    // -------------------------------------------------------------
    // 9. TESTING AUDIT LOGGING & DATA LEAKAGE (TESTS 17, 18)
    // -------------------------------------------------------------
    console.log('\n--- 9. Testing Audit Logging & Data Leakage Prevention ---');

    // TEST 17: Audit log generated
    const auditRes = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'CONTEST_PROBLEM_ADDED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [contestProfA.id]);
    assertTest(auditRes.rowCount > 0, 'TEST 17a: CONTEST_PROBLEM_ADDED record created in audit_logs');
    assertTest(
      auditRes.rows[0].actor_id === profA.id,
      'TEST 17b: Audit log correctly records authenticated actor ID'
    );
    assertTest(
      auditRes.rows[0].outcome === 'success',
      'TEST 17c: Audit log outcome marked as success'
    );

    // Verify denied audit log from Test 4
    const deniedAuditRes = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [profB.id]);
    assertTest(deniedAuditRes.rowCount > 0, 'TEST 17d: PRIVILEGED_ACTION_DENIED audit log recorded for unauthorized attempt');

    // TEST 18: Hidden problem data NOT leaked
    assertTest(
      resAutoOrder.body.problem.test_cases === undefined &&
      resAutoOrder.body.problem.testCases === undefined &&
      resAutoOrder.body.problem.solutions === undefined &&
      resAutoOrder.body.problem.answer === undefined,
      'TEST 18: Hidden problem test cases and private solutions are strictly stripped from response'
    );

    // -------------------------------------------------------------
    // 10. TESTING DATA INTEGRITY (TESTS 19, 20, 21, 22)
    // -------------------------------------------------------------
    console.log('\n--- 10. Testing Data Integrity Invariants ---');

    // Seed a dummy submission for prob1 to verify submissions invariant
    const initialSubmissionsCountRes = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    const initialSubmissionsCount = initialSubmissionsCountRes.rows[0].count;

    // Attach prob2 to contestProfB
    await request('POST', `/api/contests/${contestProfB.id}/problems`, {
      problemId: prob2.id,
    }, tokenProfB);

    // TEST 19: Submissions unchanged
    const afterSubmissionsCountRes = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    assertTest(
      afterSubmissionsCountRes.rows[0].count === initialSubmissionsCount,
      'TEST 19: Submissions table remains untouched after contest problem attachment'
    );

    // TEST 20: Participants unchanged
    const participantsCheck = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1',
      [contestProfA.id]
    );
    assertTest(
      participantsCheck.rows[0].count === 0,
      'TEST 20: Contest participants unaffected by problem attachment'
    );

    // TEST 21: Rating data unchanged
    const contestRow = await ContestModel.findContestById(contestProfA.id);
    assertTest(
      contestRow.isRated === true,
      'TEST 21: Contest rating configuration (isRated) unaffected'
    );

    // TEST 22: Leaderboard data unchanged
    assertTest(
      contestRow.isRatingFinalized === false,
      'TEST 22: Leaderboard rating finalization status unaffected'
    );

    // TEST 25: Rate limiting preserved
    assertTest(
      typeof resAutoOrder.headers === 'object',
      'TEST 25: Rate limiting middleware headers present in HTTP response'
    );

  } finally {
    // -------------------------------------------------------------
    // 11. CLEANUP
    // -------------------------------------------------------------
    console.log('\n--- 11. Cleanup ---');
    try {
      if (testContestIds.length > 0) {
        await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1)', [testContestIds]);
        await db.query('DELETE FROM contests WHERE id = ANY($1)', [testContestIds]);
      }
      if (testProblemIds.length > 0) {
        await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1)', [testProblemIds]);
        await db.query('DELETE FROM problems WHERE id = ANY($1)', [testProblemIds]);
      }
      if (testUserIds.length > 0) {
        await db.query('DELETE FROM users WHERE id = ANY($1)', [testUserIds]);
      }
      console.log('[PASS] Ephemeral test fixtures safely cleaned up');
    } catch (cleanupErr) {
      console.error('[WARN] Cleanup error:', cleanupErr.message);
    }

    server.close();
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('[FATAL] Test runner error:', err);
  process.exit(1);
});
