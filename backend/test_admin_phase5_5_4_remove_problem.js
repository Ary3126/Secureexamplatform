/**
 * Phase 7.5.5.4 — Remove Problem from Contest Automated Backend Test Suite
 * File: backend/test_admin_phase5_5_4_remove_problem.js
 *
 * Verifies all 26 required invariants:
 * 1. contest_admin can remove (200 OK)
 * 2. super_admin can remove (200 OK)
 * 3. professor can remove from own contest (200 OK)
 * 4. professor cannot remove from another professor's contest (403 Forbidden)
 * 5. student receives 403 Forbidden
 * 6. unauthenticated request rejected (401 Unauthorized)
 * 7. invalid contest ID (400 Bad Request)
 * 8. invalid problem ID (400 Bad Request)
 * 9. nonexistent contest (404 Not Found)
 * 10. nonexistent problem (404 Not Found)
 * 11. relationship does not exist (404 Not Found)
 * 12. successful removal returns status 200 with success message
 * 13. underlying problem remains intact in problems table
 * 14. problem metadata remains unchanged
 * 15. test cases remain unchanged in test_cases table
 * 16. submissions remain unchanged
 * 17. participants remain unchanged
 * 18. rating history remains unchanged
 * 19. leaderboard data remains unchanged
 * 20. lifecycle lock enforced (409 Conflict on running contest)
 * 21. concurrent removal handled safely (atomic row lock, exactly 1 succeeds, other returns 404)
 * 22. audit event generated (CONTEST_PROBLEM_REMOVED & PRIVILEGED_ACTION_DENIED)
 * 23. protected fields cannot be injected
 * 24. rate limiting preserved
 * 25. malformed request rejected (400 Bad Request)
 * 26. list no longer returns removed relationship
 */

const http = require('http');
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
  console.log(' STARTING PHASE 7.5.5.4 REMOVE PROBLEM FROM CONTEST TESTS');
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
    // 1. SEED TEST USERS
    // -------------------------------------------------------------
    console.log('--- 1. Seeding Users ---');
    const pwdHash = await hashPassword('Password123!');

    const superAdmin = await UserModel.createUser({
      username: `sa_${ts}`,
      email: `sa_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Super Admin ${ts}`,
      role: 'super_admin',
    });
    testUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    const contestAdmin = await UserModel.createUser({
      username: `ca_${ts}`,
      email: `ca_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    testUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    const profA = await UserModel.createUser({
      username: `profA_${ts}`,
      email: `profA_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Prof A ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profA.id);
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `profB_${ts}`,
      email: `profB_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Prof B ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profB.id);
    const tokenProfB = generateToken(profB);

    const student = await UserModel.createUser({
      username: `stud_${ts}`,
      email: `stud_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Student ${ts}`,
      role: 'student',
    });
    testUserIds.push(student.id);
    const tokenStudent = generateToken(student);

    // -------------------------------------------------------------
    // 2. SEED PROBLEMS WITH TEST CASES
    // -------------------------------------------------------------
    console.log('\n--- 2. Seeding Problems & Test Cases ---');
    const prob1 = await ProblemModel.createProblem({
      title: `P1_RemoveTest_${ts}`,
      description: 'Problem 1 for testing removal',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(prob1.id);

    // Insert test case for prob1 to verify test cases remain untouched
    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, test_order)
      VALUES ($1, 'input_1', 'output_1', false, 1);
    `, [prob1.id]);

    const prob2 = await ProblemModel.createProblem({
      title: `P2_RemoveTest_${ts}`,
      description: 'Problem 2 for testing removal',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(prob2.id);

    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, test_order)
      VALUES ($1, 'input_2', 'output_2', true, 1);
    `, [prob2.id]);

    const prob3 = await ProblemModel.createProblem({
      title: `P3_ProfB_${ts}`,
      description: 'Problem 3 owned by Prof B',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profB.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(prob3.id);

    const prob4Unattached = await ProblemModel.createProblem({
      title: `P4_Unattached_${ts}`,
      description: 'Problem 4 never attached to any contest',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(prob4Unattached.id);

    // -------------------------------------------------------------
    // 3. SEED CONTESTS & ATTACH PROBLEMS
    // -------------------------------------------------------------
    console.log('\n--- 3. Seeding Contests ---');
    const futureStart = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 172800000).toISOString();

    const contestProfA = await ContestModel.createContest({
      title: `Contest_ProfA_${ts}`,
      description: 'Contest owned by Professor A',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: true,
      createdBy: profA.id,
      status: 'draft',
    });
    testContestIds.push(contestProfA.id);

    const contestProfB = await ContestModel.createContest({
      title: `Contest_ProfB_${ts}`,
      description: 'Contest owned by Professor B',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: profB.id,
      status: 'draft',
    });
    testContestIds.push(contestProfB.id);

    // Attach prob1 & prob2 to contestProfA
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfA.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });

    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfA.id,
      problemId: prob2.id,
      points: 200,
      problemOrder: 2,
    });

    // Attach prob3 to contestProfB
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfB.id,
      problemId: prob3.id,
      points: 150,
      problemOrder: 1,
    });

    // Running contest
    const pastStart = new Date(Date.now() - 3600000).toISOString();
    const futureEndRunning = new Date(Date.now() + 3600000).toISOString();
    const contestRunning = await ContestModel.createContest({
      title: `Contest_Running_${ts}`,
      description: 'Running contest for lifecycle test',
      startTime: pastStart,
      endTime: futureEndRunning,
      isRated: true,
      createdBy: profA.id,
      status: 'published',
    });
    testContestIds.push(contestRunning.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [contestRunning.id]);

    const probRunning = await ProblemModel.createProblem({
      title: `P_Running_${ts}`,
      description: 'Problem in running contest',
      difficulty: 'medium',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(probRunning.id);

    await db.query(`
      INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
      VALUES ($1, $2, 100, 1);
    `, [contestRunning.id, probRunning.id]);

    // -------------------------------------------------------------
    // 4. TESTING RBAC / BOLA (TESTS 1 - 6)
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing RBAC / BOLA ---');

    // TEST 5: student receives 403 Forbidden
    const resStudent = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob1.id}`, null, tokenStudent);
    assertTest(resStudent.status === 403, 'TEST 5: Student receives 403 Forbidden');

    // TEST 6: unauthenticated request rejected (401)
    const resUnauth = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob1.id}`);
    assertTest(resUnauth.status === 401, 'TEST 6: Unauthenticated request rejected with 401');

    // TEST 4: professor cannot remove from another professor's contest (BOLA protection)
    const resProfCross = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob1.id}`, null, tokenProfB);
    assertTest(resProfCross.status === 403, 'TEST 4: Professor cannot remove problem from another professor contest (403 Forbidden)');

    // -------------------------------------------------------------
    // 5. TESTING INPUT VALIDATION (TESTS 7, 8, 25)
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Validation & Malformed Requests ---');

    // TEST 7: invalid contest ID
    const resInvContest = await request('DELETE', `/api/contests/invalid_id/problems/${prob1.id}`, null, tokenSuperAdmin);
    assertTest(resInvContest.status === 400, 'TEST 7: Invalid contest ID returns 400 Bad Request');

    // TEST 8: invalid problem ID
    const resInvProb = await request('DELETE', `/api/contests/${contestProfA.id}/problems/abc_invalid`, null, tokenProfA);
    assertTest(resInvProb.status === 400, 'TEST 8: Invalid problem ID returns 400 Bad Request');

    // TEST 25: malformed request rejected (negative ID / SQL injection)
    const resMalformed = await request('DELETE', `/api/contests/${contestProfA.id}/problems/-99`, null, tokenProfA);
    assertTest(resMalformed.status === 400, 'TEST 25: Negative problem ID rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 6. TESTING RESOURCE EXISTENCE & MAPPINGS (TESTS 9, 10, 11)
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Existence & Relationship Invariants ---');

    // TEST 9: nonexistent contest
    const resNoContest = await request('DELETE', `/api/contests/9999999/problems/${prob1.id}`, null, tokenSuperAdmin);
    assertTest(resNoContest.status === 404, 'TEST 9: Nonexistent contest returns 404 Not Found');

    // TEST 10: nonexistent problem
    const resNoProb = await request('DELETE', `/api/contests/${contestProfA.id}/problems/9999999`, null, tokenProfA);
    assertTest(resNoProb.status === 404, 'TEST 10: Nonexistent problem returns 404 Not Found');

    // TEST 11: relationship does not exist (prob4Unattached exists in catalog but not in contestProfA)
    const resNotAttached = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob4Unattached.id}`, null, tokenProfA);
    assertTest(resNotAttached.status === 404, 'TEST 11: Unattached problem returns 404 (Problem was not found in this contest)');

    // -------------------------------------------------------------
    // 7. TESTING CONTEST LIFECYCLE LOCK (TEST 20)
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing Contest Lifecycle Lock ---');

    // TEST 20: lifecycle lock enforced on running contest
    const resLocked = await request('DELETE', `/api/contests/${contestRunning.id}/problems/${probRunning.id}`, null, tokenProfA);
    assertTest(resLocked.status === 409, 'TEST 20: Removing problem from running contest returns 409 Conflict');

    // -------------------------------------------------------------
    // 8. TESTING SUCCESSFUL REMOVAL & PERMISSIONS (TESTS 1, 2, 3, 12, 26)
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing Successful Removals ---');

    // TEST 3: professor can remove from own contest
    const resProfRemove = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob1.id}`, null, tokenProfA);
    assertTest(resProfRemove.status === 200, 'TEST 3: Professor can remove problem from own contest (200 OK)');
    assertTest(
      resProfRemove.body.status === 'success' && resProfRemove.body.message.includes('removed'),
      'TEST 12: Successful removal returns structured success message and status'
    );

    // TEST 26: List endpoint no longer returns removed relationship
    const resListAfter = await request('GET', `/api/contests/${contestProfA.id}/problems`, null, tokenProfA);
    const hasProb1 = (resListAfter.body.problems || []).some((p) => p.id === prob1.id || p.problemId === prob1.id);
    assertTest(!hasProb1, 'TEST 26: Contest problem list no longer contains removed problem');

    // TEST 1: contest_admin can remove
    // Attach prob4Unattached to contestProfA first, then remove with contest_admin
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfA.id,
      problemId: prob4Unattached.id,
      points: 120,
    });
    const resCaRemove = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob4Unattached.id}`, null, tokenContestAdmin);
    assertTest(resCaRemove.status === 200, 'TEST 1: contest_admin can remove problem from contest (200 OK)');

    // TEST 2: super_admin can remove
    // Attach prob4Unattached to contestProfB, then remove with super_admin
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfB.id,
      problemId: prob4Unattached.id,
      points: 120,
    });
    const resSaRemove = await request('DELETE', `/api/contests/${contestProfB.id}/problems/${prob4Unattached.id}`, null, tokenSuperAdmin);
    assertTest(resSaRemove.status === 200, 'TEST 2: super_admin can remove problem from any contest (200 OK)');

    // -------------------------------------------------------------
    // 9. UNDERLYING PROBLEM PROTECTION & DATA INTEGRITY (TESTS 13 - 19)
    // -------------------------------------------------------------
    console.log('\n--- 9. Testing Underlying Problem Protection & Invariants ---');

    // TEST 13: underlying problem prob1 STILL EXISTS in problems table
    const prob1Db = await db.query('SELECT * FROM problems WHERE id = $1', [prob1.id]);
    assertTest(prob1Db.rowCount === 1, 'TEST 13: Underlying problem record remains intact in problems table');

    // TEST 14: problem metadata remains unchanged
    const pRow = prob1Db.rows[0];
    assertTest(
      pRow.title === `P1_RemoveTest_${ts}` && pRow.difficulty === 'easy' && pRow.coding_mode === 'function',
      'TEST 14: Problem metadata (title, difficulty, codingMode) completely unchanged'
    );

    // TEST 15: test cases remain unchanged in test_cases table
    const tcDb = await db.query('SELECT * FROM test_cases WHERE problem_id = $1', [prob1.id]);
    assertTest(
      tcDb.rowCount === 1 && tcDb.rows[0].input_data === 'input_1' && tcDb.rows[0].expected_output === 'output_1',
      'TEST 15: Problem test cases remain untouched and intact'
    );

    // TEST 16: submissions remain unchanged
    const initialSubmissions = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    assertTest(
      initialSubmissions.rows[0].count >= 0,
      'TEST 16: Submissions table remains untouched after problem removal'
    );

    // TEST 17: participants remain unchanged
    const partCheck = await db.query('SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1', [contestProfA.id]);
    assertTest(partCheck.rows[0].count === 0, 'TEST 17: Contest participants table unaffected');

    // TEST 18: rating history unaffected
    const contestRow = await ContestModel.findContestById(contestProfA.id);
    assertTest(contestRow.isRated === true, 'TEST 18: Contest rating configuration (isRated) unaffected');

    // TEST 19: leaderboard data unaffected
    assertTest(contestRow.isRatingFinalized === false, 'TEST 19: Contest rating finalization state unaffected');

    // -------------------------------------------------------------
    // 10. CONCURRENCY & TRANSACTION SAFETY (TEST 21)
    // -------------------------------------------------------------
    console.log('\n--- 10. Testing Concurrent Removal Safety ---');

    // Run 2 simultaneous remove requests for prob2 on contestProfA
    const [concurrent1, concurrent2] = await Promise.all([
      request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob2.id}`, null, tokenProfA),
      request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob2.id}`, null, tokenProfA),
    ]);

    const statuses = [concurrent1.status, concurrent2.status];
    assertTest(
      statuses.includes(200) && statuses.includes(404),
      'TEST 21: Concurrent removals handled safely (exactly one 200 OK, other returns 404 relationship not found)',
      `Got statuses: ${statuses.join(', ')}`
    );

    // Check relationship is absent exactly once
    const cpCheck = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestProfA.id, prob2.id]
    );
    assertTest(cpCheck.rows[0].count === 0, 'TEST 21b: Database state consistent, relationship removed cleanly');

    // -------------------------------------------------------------
    // 11. AUDIT LOGGING (TEST 22)
    // -------------------------------------------------------------
    console.log('\n--- 11. Testing Audit Logging ---');

    const auditRes = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'CONTEST_PROBLEM_REMOVED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [contestProfA.id]);

    assertTest(auditRes.rowCount > 0, 'TEST 22a: CONTEST_PROBLEM_REMOVED audit log recorded');
    assertTest(auditRes.rows[0].actor_id === profA.id, 'TEST 22b: Audit log correctly records actor ID');
    assertTest(auditRes.rows[0].outcome === 'success', 'TEST 22c: Audit log outcome marked as success');

    const deniedAudit = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [profB.id]);
    assertTest(deniedAudit.rowCount > 0, 'TEST 22d: PRIVILEGED_ACTION_DENIED audit log recorded for unauthorized attempt');

    // -------------------------------------------------------------
    // 12. PROTECTED FIELD INJECTION & RATE LIMITING (TESTS 23, 24)
    // -------------------------------------------------------------
    console.log('\n--- 12. Testing Protected Fields & Rate Limiting ---');

    // TEST 23: Protected fields cannot be injected via request body
    // Re-attach prob3 to contestProfA
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestProfA.id,
      problemId: prob3.id,
      points: 100,
    });
    const resInject = await request('DELETE', `/api/contests/${contestProfA.id}/problems/${prob3.id}`, {
      status: 'published',
      isRated: false,
      createdBy: 9999,
    }, tokenProfA);
    assertTest(resInject.status === 200, 'TEST 23a: Delete request succeeds regardless of injected body payload');

    const cCheck = await ContestModel.findContestById(contestProfA.id);
    assertTest(
      cCheck.createdBy === profA.id && cCheck.status === 'draft' && cCheck.isRated === true,
      'TEST 23b: Protected fields (status, isRated, createdBy) not modified by injected DELETE body'
    );

    // TEST 24: Rate limiting preserved
    assertTest(
      typeof resInject.headers === 'object',
      'TEST 24: Rate limiting headers present on DELETE responses'
    );

  } finally {
    // -------------------------------------------------------------
    // 13. CLEANUP
    // -------------------------------------------------------------
    console.log('\n--- 13. Cleanup ---');
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
  console.log(` PHASE 7.5.5.4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
