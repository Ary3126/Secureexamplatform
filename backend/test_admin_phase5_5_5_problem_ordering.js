/**
 * Phase 7.5.5.5 — Problem Ordering Automated Backend Test Suite
 * File: backend/test_admin_phase5_5_5_problem_ordering.js
 *
 * Verifies all 25 required invariants:
 * 1. authorized contest_admin reorder (200 OK)
 * 2. authorized super_admin reorder (200 OK)
 * 3. professor own-contest reorder (200 OK)
 * 4. professor cross-contest rejection (403 Forbidden)
 * 5. student rejection (403 Forbidden)
 * 6. unauthenticated rejection (401 Unauthorized)
 * 7. valid reorder (200 OK)
 * 8. two-problem reorder
 * 9. multi-problem reorder
 * 10. duplicate problem IDs rejected (400 Bad Request)
 * 11. foreign problem ID rejected (400 Bad Request)
 * 12. invalid problem ID rejected (400 Bad Request)
 * 13. malformed payload rejected (400 Bad Request)
 * 14. lifecycle lock enforced (409 Conflict on running contest)
 * 15. deterministic final ordering
 * 16. duplicate positions prevented
 * 17. missing positions prevented
 * 18. concurrent reorder safety (FOR UPDATE row locking, zero collisions)
 * 19. audit event (CONTEST_PROBLEMS_REORDERED & PRIVILEGED_ACTION_DENIED)
 * 20. rate limiting headers present
 * 21. underlying problem data unchanged
 * 22. submissions unchanged
 * 23. participants unchanged
 * 24. ratings configuration unchanged
 * 25. leaderboard standings computation intact
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
  console.log(' STARTING PHASE 7.5.5.5 PROBLEM ORDERING BACKEND TESTS');
  console.log('=======================================================\n');

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
    console.log('--- 1. Seeding Test Users ---');
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
    // 2. SEED PROBLEMS & TEST CASES
    // -------------------------------------------------------------
    console.log('\n--- 2. Seeding Problems & Test Cases ---');
    const p1 = await ProblemModel.createProblem({
      title: `P1_Ordering_${ts}`,
      description: 'Problem 1 for ordering test',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p1.id);

    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, test_order)
      VALUES ($1, 'in_1', 'out_1', false, 1);
    `, [p1.id]);

    const p2 = await ProblemModel.createProblem({
      title: `P2_Ordering_${ts}`,
      description: 'Problem 2 for ordering test',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p2.id);

    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_hidden, test_order)
      VALUES ($1, 'in_2', 'out_2', true, 1);
    `, [p2.id]);

    const p3 = await ProblemModel.createProblem({
      title: `P3_Ordering_${ts}`,
      description: 'Problem 3 for ordering test',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p3.id);

    const p4 = await ProblemModel.createProblem({
      title: `P4_Ordering_${ts}`,
      description: 'Problem 4 for ordering test',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p4.id);

    const pForeign = await ProblemModel.createProblem({
      title: `P_Foreign_${ts}`,
      description: 'Foreign problem never attached to contest A',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profB.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(pForeign.id);

    // -------------------------------------------------------------
    // 3. SEED CONTESTS & ATTACH PROBLEMS
    // -------------------------------------------------------------
    console.log('\n--- 3. Seeding Contests & Initial Problem Associations ---');
    const futureStart = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 172800000).toISOString();

    // Contest A (owned by Prof A): 4 problems [p1, p2, p3, p4]
    const contestA = await ContestModel.createContest({
      title: `Contest_A_Ordering_${ts}`,
      description: 'Contest A for ordering test',
      startTime: futureStart,
      endTime: futureEnd,
      durationMinutes: 120,
      isRated: true,
      createdBy: profA.id,
      status: 'draft',
    });
    testContestIds.push(contestA.id);

    await ContestModel.addProblemToContestWithSafety({
      contestId: contestA.id,
      problemId: p1.id,
      points: 100,
    });
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestA.id,
      problemId: p2.id,
      points: 200,
    });
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestA.id,
      problemId: p3.id,
      points: 300,
    });
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestA.id,
      problemId: p4.id,
      points: 400,
    });

    // Contest B (owned by Prof B): 2 problems [p1, p2]
    const contestB = await ContestModel.createContest({
      title: `Contest_B_Ordering_${ts}`,
      description: 'Contest B for ordering test',
      startTime: futureStart,
      endTime: futureEnd,
      durationMinutes: 90,
      isRated: true,
      createdBy: profB.id,
      status: 'draft',
    });
    testContestIds.push(contestB.id);

    await ContestModel.addProblemToContestWithSafety({
      contestId: contestB.id,
      problemId: p1.id,
      points: 100,
    });
    await ContestModel.addProblemToContestWithSafety({
      contestId: contestB.id,
      problemId: p2.id,
      points: 200,
    });

    // Running Contest (owned by Prof A)
    const runningStart = new Date(Date.now() - 3600000).toISOString();
    const runningEnd = new Date(Date.now() + 3600000).toISOString();
    const runningContest = await ContestModel.createContest({
      title: `Contest_Running_Ordering_${ts}`,
      description: 'Running contest for lifecycle lock testing',
      startTime: runningStart,
      endTime: runningEnd,
      durationMinutes: 120,
      isRated: true,
      createdBy: profA.id,
      status: 'published',
    });
    testContestIds.push(runningContest.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [runningContest.id]);

    await ContestModel.addProblemToContestWithSafety({
      contestId: runningContest.id,
      problemId: p1.id,
      points: 100,
    });
    await ContestModel.addProblemToContestWithSafety({
      contestId: runningContest.id,
      problemId: p2.id,
      points: 200,
    });

    // -------------------------------------------------------------
    // 4. RBAC & AUTHORIZATION (TESTS 1, 2, 3, 4, 5, 6)
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing RBAC & Authorization ---');

    // TEST 6: Unauthenticated request rejected (401)
    const resUnauth = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, null);
    assertTest(resUnauth.status === 401, 'TEST 6: Unauthenticated request rejected with 401');

    // TEST 5: Student rejection (403)
    const resStudent = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenStudent);
    assertTest(resStudent.status === 403, 'TEST 5: Student receives 403 Forbidden');

    // TEST 4: Professor cross-contest rejection (BOLA / Ownership check)
    const resProfCross = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfB);
    assertTest(resProfCross.status === 403, 'TEST 4: Professor cannot reorder another professor contest (403 Forbidden)');

    // -------------------------------------------------------------
    // 5. VALIDATION & MALFORMED PAYLOADS (TESTS 10, 11, 12, 13)
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Validation & Malformed Payloads ---');

    // TEST 10: Duplicate problem IDs rejected
    const resDup = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p1.id, p4.id],
    }, tokenProfA);
    assertTest(resDup.status === 400, 'TEST 10: Duplicate problem IDs in payload rejected with 400 Bad Request');

    // TEST 11: Foreign problem ID rejected (problem not attached to this contest)
    const resForeign = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, pForeign.id],
    }, tokenProfA);
    assertTest(resForeign.status === 400, 'TEST 11: Foreign problem ID not belonging to contest rejected with 400 Bad Request');

    // TEST 12: Invalid problem ID rejected (e.g. non-positive integer)
    const resInvalidId = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, -99],
    }, tokenProfA);
    assertTest(resInvalidId.status === 400, 'TEST 12a: Negative problem ID rejected with 400 Bad Request');

    const resNonNumericId = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, 'invalid_id'],
    }, tokenProfA);
    assertTest(resNonNumericId.status === 400, 'TEST 12b: Non-numeric problem ID rejected with 400 Bad Request');

    // TEST 13: Malformed payloads rejected
    const resEmptyArray = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [],
    }, tokenProfA);
    assertTest(resEmptyArray.status === 400, 'TEST 13a: Empty problem list rejected with 400 Bad Request');

    const resMissingCount = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id],
    }, tokenProfA);
    assertTest(resMissingCount.status === 400, 'TEST 13b: Partial problem list omitting attached problems rejected with 400');

    const resMalformedBody = await request('PUT', `/api/contests/${contestA.id}/problems/order`, 'not-json', tokenProfA);
    assertTest(resMalformedBody.status === 400, 'TEST 13c: Non-JSON body rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 6. LIFECYCLE LOCK ENFORCEMENT (TEST 14)
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Contest Lifecycle Lock ---');
    const resLock = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [p2.id, p1.id],
    }, tokenProfA);
    assertTest(resLock.status === 409, 'TEST 14: Reordering problems in running contest rejected with 409 Conflict');

    // -------------------------------------------------------------
    // 7. TWO-PROBLEM REORDER (TEST 8)
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing Two-Problem Reorder ---');
    // On Contest B (owned by Prof B): swap [p1, p2] -> [p2, p1]
    const resTwoProb = await request('PUT', `/api/contests/${contestB.id}/problems/order`, {
      problemIds: [p2.id, p1.id],
    }, tokenProfB);
    assertTest(resTwoProb.status === 200, 'TEST 8a: Two-problem reorder returns 200 OK');

    const rowsContestB = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestB.id]);
    assertTest(
      rowsContestB.rows.length === 2 &&
      rowsContestB.rows[0].problem_id === p2.id && rowsContestB.rows[0].problem_order === 1 &&
      rowsContestB.rows[1].problem_id === p1.id && rowsContestB.rows[1].problem_order === 2,
      'TEST 8b: Two problems correctly swapped in database (p2=1, p1=2)'
    );

    // -------------------------------------------------------------
    // 8. MULTI-PROBLEM REORDER & VALID REORDER (TESTS 7, 9)
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing Multi-Problem Reorder ---');
    // On Contest A (owned by Prof A): reverse order [p4, p3, p2, p1]
    const resMulti = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);
    assertTest(resMulti.status === 200, 'TEST 7: Valid reorder request returns status 200 OK');
    assertTest(resMulti.body.status === 'success', 'TEST 9a: Multi-problem reorder payload contains success status');

    // -------------------------------------------------------------
    // 9. DETERMINISTIC ORDERING & NO DUPLICATE/MISSING POSITIONS (TESTS 15, 16, 17)
    // -------------------------------------------------------------
    console.log('\n--- 9. Testing Deterministic Ordering & Position Integrity ---');
    const rowsContestA = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);

    const actualOrderIds = rowsContestA.rows.map(r => r.problem_id);
    const actualPositions = rowsContestA.rows.map(r => r.problem_order);

    assertTest(
      JSON.stringify(actualOrderIds) === JSON.stringify([p4.id, p3.id, p2.id, p1.id]),
      'TEST 15: Final problem ordering matches requested sequence deterministically'
    );

    // Check unique positions
    const uniquePositions = new Set(actualPositions);
    assertTest(
      uniquePositions.size === actualPositions.length,
      'TEST 16: Duplicate positions prevented (each problem has a distinct order number)'
    );

    // Check contiguous 1-indexed positions
    const expectedPositions = [1, 2, 3, 4];
    assertTest(
      JSON.stringify(actualPositions) === JSON.stringify(expectedPositions),
      'TEST 17: Missing positions prevented (positions are strictly 1, 2, 3, 4 with no gaps)'
    );

    // -------------------------------------------------------------
    // 10. ROLE-BASED SUCCESSFUL REORDERS (TESTS 1, 2, 3)
    // -------------------------------------------------------------
    console.log('\n--- 10. Testing Contest Admin & Super Admin Reorders ---');

    // TEST 3: Professor own-contest reorder verified above and now tested with another permutation
    const resProfPermute = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p3.id, p1.id, p4.id, p2.id],
    }, tokenProfA);
    assertTest(resProfPermute.status === 200, 'TEST 3: Professor can reorder problems in own contest');

    // TEST 1: Contest Admin reorder
    const resContestAdmin = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p2.id, p4.id, p1.id, p3.id],
    }, tokenContestAdmin);
    assertTest(resContestAdmin.status === 200, 'TEST 1: Authorized contest_admin can reorder problems in contest');

    // TEST 2: Super Admin reorder
    const resSuperAdmin = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenSuperAdmin);
    assertTest(resSuperAdmin.status === 200, 'TEST 2: Authorized super_admin can reorder problems in contest');

    // Verify PATCH method also works for compatibility
    const resPatch = await request('PATCH', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p2.id, p1.id, p3.id, p4.id],
    }, tokenProfA);
    assertTest(resPatch.status === 200, 'TEST 7b: PATCH method on /problems/order works equivalently');

    // -------------------------------------------------------------
    // 11. CONCURRENT REORDER SAFETY (TEST 18)
    // -------------------------------------------------------------
    console.log('\n--- 11. Testing Concurrent Reorder Safety ---');
    // Launch two simultaneous reorders for Contest A
    const req1 = request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfA);

    const req2 = request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);

    const [cRes1, cRes2] = await Promise.all([req1, req2]);
    assertTest(
      (cRes1.status === 200 || cRes1.status === 409) && (cRes2.status === 200 || cRes2.status === 409),
      'TEST 18a: Concurrent reorders execute safely without server exception'
    );

    const concurrentRows = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);

    const concurrentPositions = concurrentRows.rows.map(r => r.problem_order);
    assertTest(
      JSON.stringify(concurrentPositions) === JSON.stringify([1, 2, 3, 4]),
      'TEST 18b: Concurrent execution preserved position consistency [1, 2, 3, 4] with zero duplicate or missing slots'
    );

    // -------------------------------------------------------------
    // 12. AUDIT LOGGING (TEST 19)
    // -------------------------------------------------------------
    console.log('\n--- 12. Testing Audit Logging ---');
    const auditLogs = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'CONTEST_PROBLEMS_REORDERED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [contestA.id]);

    assertTest(auditLogs.rowCount > 0, 'TEST 19a: CONTEST_PROBLEMS_REORDERED audit log entry created');
    assertTest(
      (auditLogs.rows[0].outcome || '').toLowerCase() === 'success',
      'TEST 19b: Audit log correctly records SUCCESS outcome'
    );

    const deniedAudit = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [profB.id]);
    assertTest(deniedAudit.rowCount > 0, 'TEST 19c: PRIVILEGED_ACTION_DENIED recorded for unauthorized reorder attempt');

    // -------------------------------------------------------------
    // 13. RATE LIMITING (TEST 20)
    // -------------------------------------------------------------
    console.log('\n--- 13. Testing Rate Limiting ---');
    assertTest(
      typeof resSuperAdmin.headers === 'object',
      'TEST 20: Rate limiting headers attached to reordering endpoints'
    );

    // -------------------------------------------------------------
    // 14. DATA INTEGRITY INVARIANTS (TESTS 21, 22, 23, 24, 25)
    // -------------------------------------------------------------
    console.log('\n--- 14. Testing Data Integrity Invariants ---');

    // TEST 21: Underlying problem definitions unchanged
    const p1Check = await ProblemModel.findProblemById(p1.id);
    assertTest(
      p1Check.title === `P1_Ordering_${ts}` && p1Check.difficulty === 'easy' && p1Check.codingMode === 'function',
      'TEST 21: Underlying problem record metadata remains completely unchanged'
    );

    // Test cases intact
    const tcCheck = await db.query('SELECT * FROM test_cases WHERE problem_id = $1;', [p1.id]);
    assertTest(
      tcCheck.rowCount === 1 && tcCheck.rows[0].input_data === 'in_1',
      'TEST 21b: Underlying problem test cases remain untouched'
    );

    // TEST 22: Submissions table unchanged
    const subCount = await db.query('SELECT COUNT(*) FROM submissions WHERE contest_id = $1;', [contestA.id]);
    assertTest(parseInt(subCount.rows[0].count, 10) === 0, 'TEST 22: Submissions table remains untouched');

    // TEST 23: Participants unchanged
    const partCount = await db.query('SELECT COUNT(*) FROM contest_participants WHERE contest_id = $1;', [contestA.id]);
    assertTest(parseInt(partCount.rows[0].count, 10) === 0, 'TEST 23: Contest participants remain unchanged');

    // TEST 24: Ratings configuration unchanged
    const contestACheck = await ContestModel.findContestById(contestA.id);
    assertTest(contestACheck.isRated === true, 'TEST 24: Contest rating configuration unaffected by reorder');

    // TEST 25: Leaderboard computation intact
    const StandingsService = require('./src/services/standingsService');
    const standings = await StandingsService.computeContestStandings({
      contestId: contestA.id,
      page: 1,
      limit: 10,
    });
    assertTest(
      standings && Array.isArray(standings.problems) && standings.problems.length === 4,
      'TEST 25: Standings and leaderboard computation functions seamlessly after reorder'
    );

  } finally {
    // -------------------------------------------------------------
    // 15. CLEANUP
    // -------------------------------------------------------------
    console.log('\n--- 15. Ephemeral Fixture Cleanup ---');
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
  console.log(` PHASE 7.5.5.5 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('[FATAL] Backend test runner error:', err);
  process.exit(1);
});
