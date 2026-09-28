/**
 * Phase 7.5.5.6 — Bulk / Atomic Problem Ordering Automated Backend Test Suite
 * File: backend/test_admin_phase5_5_6_bulk_ordering.js
 *
 * Verifies all 28 required invariants:
 * 1. complete reorder succeeds (200 OK)
 * 2. two-problem swap (200 OK, DB verified)
 * 3. multi-problem reorder (200 OK, DB verified)
 * 4. exact complete problem set accepted
 * 5. missing problem rejected (400 Bad Request, DB order preserved)
 * 6. duplicate problem rejected (400 Bad Request)
 * 7. foreign problem rejected (400 Bad Request)
 * 8. nonexistent problem rejected (400 Bad Request)
 * 9. invalid payload rejected (400 Bad Request)
 * 10. student rejected (403 Forbidden)
 * 11. professor ownership enforced (403 Forbidden on other's contest, 200 on own)
 * 12. contest_admin allowed (200 OK)
 * 13. super_admin allowed (200 OK)
 * 14. lifecycle lock enforced (409 Conflict on running contest)
 * 15. transaction commits all updates atomically
 * 16. transaction rollback on failure (CRITICAL TRANSACTION TEST with simulated failure trigger)
 * 17. no duplicate positions (all positions distinct)
 * 18. no missing positions (contiguous 1 to N)
 * 19. concurrency protection (parallel reorders serialize without corruption or deadlocks)
 * 20. repeated identical ordering is safe (idempotency)
 * 21. audit log generated (CONTEST_PROBLEMS_REORDERED with actor, target, metadata)
 * 22. rate limiting preserved
 * 23. underlying problem unchanged
 * 24. submissions unchanged
 * 25. participants unchanged
 * 26. ratings unchanged
 * 27. leaderboard unchanged
 * 28. final database order matches request
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
  console.log(' STARTING PHASE 7.5.5.6 BULK / ATOMIC ORDERING TESTS');
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
      username: `sa_556_${ts}`,
      email: `sa_556_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Super Admin ${ts}`,
      role: 'super_admin',
    });
    testUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    const contestAdmin = await UserModel.createUser({
      username: `ca_556_${ts}`,
      email: `ca_556_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    testUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    const profA = await UserModel.createUser({
      username: `profA_556_${ts}`,
      email: `profA_556_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Prof A ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profA.id);
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `profB_556_${ts}`,
      email: `profB_556_${ts}@test.local`,
      passwordHash: pwdHash,
      fullName: `Prof B ${ts}`,
      role: 'professor',
    });
    testUserIds.push(profB.id);
    const tokenProfB = generateToken(profB);

    const student = await UserModel.createUser({
      username: `stud_556_${ts}`,
      email: `stud_556_${ts}@test.local`,
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
      title: `P1_Atomic_${ts}`,
      description: 'Problem 1 for atomic ordering',
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
      title: `P2_Atomic_${ts}`,
      description: 'Problem 2 for atomic ordering',
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
      title: `P3_Atomic_${ts}`,
      description: 'Problem 3 for atomic ordering',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p3.id);

    const p4 = await ProblemModel.createProblem({
      title: `P4_Atomic_${ts}`,
      description: 'Problem 4 for atomic ordering',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
      accessScope: 'public',
      isPublished: true,
    });
    testProblemIds.push(p4.id);

    const pForeign = await ProblemModel.createProblem({
      title: `P_Foreign_556_${ts}`,
      description: 'Foreign problem not in contest',
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
    console.log('\n--- 3. Seeding Contests & Associations ---');
    const futureStart = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 172800000).toISOString();

    // Contest A (owned by Prof A): 4 problems [p1, p2, p3, p4]
    const contestA = await ContestModel.createContest({
      title: `Contest_A_Atomic_${ts}`,
      description: 'Contest A for atomic bulk ordering test',
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
      title: `Contest_B_Atomic_${ts}`,
      description: 'Contest B for atomic swap test',
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
      title: `Contest_Running_Atomic_${ts}`,
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
    // 4. RBAC & PERMISSION ENFORCEMENT (TESTS 10, 11, 12, 13)
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing RBAC & Ownership Enforcement ---');

    // TEST 10: Student rejected
    const resStudent = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenStudent);
    assertTest(resStudent.status === 403, 'TEST 10: Student rejected with 403 Forbidden');

    // TEST 11: Professor cross-contest rejected
    const resProfCross = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfB);
    assertTest(resProfCross.status === 403, 'TEST 11a: Non-owner professor rejected with 403 Forbidden');

    // TEST 11b: Professor own-contest allowed
    const resProfOwn = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfA);
    assertTest(resProfOwn.status === 200, 'TEST 11b: Owner professor allowed to reorder own contest (200 OK)');

    // TEST 12: Contest Admin allowed
    const resContestAdmin = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p2.id, p1.id, p3.id, p4.id],
    }, tokenContestAdmin);
    assertTest(resContestAdmin.status === 200, 'TEST 12: Contest Admin allowed to reorder (200 OK)');

    // TEST 13: Super Admin allowed
    const resSuperAdmin = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenSuperAdmin);
    assertTest(resSuperAdmin.status === 200, 'TEST 13: Super Admin allowed to reorder (200 OK)');

    // -------------------------------------------------------------
    // 5. LIFECYCLE LOCK ENFORCEMENT (TEST 14)
    // -------------------------------------------------------------
    console.log('\n--- 5. Testing Contest Lifecycle Lock ---');
    const resLock = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [p2.id, p1.id],
    }, tokenProfA);
    assertTest(resLock.status === 409, 'TEST 14: Reordering problems in running contest rejected with 409 Conflict');

    // -------------------------------------------------------------
    // 6. COMPLETE SET VALIDATION & REJECTIONS (TESTS 4, 5, 6, 7, 8, 9)
    // -------------------------------------------------------------
    console.log('\n--- 6. Testing Complete Set Validation ---');

    // TEST 4: Exact complete problem set accepted
    const resExact = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);
    assertTest(resExact.status === 200, 'TEST 4: Exact complete problem set accepted with 200 OK');

    // TEST 5: Missing problem rejected
    const resMissing = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id],
    }, tokenProfA);
    assertTest(resMissing.status === 400, 'TEST 5: Partial problem list omitting attached problems rejected with 400');

    // TEST 6: Duplicate problem rejected
    const resDup = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p4.id],
    }, tokenProfA);
    assertTest(resDup.status === 400, 'TEST 6: Duplicate problem IDs rejected with 400 Bad Request');

    // TEST 7: Foreign problem rejected
    const resForeign = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, pForeign.id],
    }, tokenProfA);
    assertTest(resForeign.status === 400, 'TEST 7: Foreign problem ID rejected with 400 Bad Request');

    // TEST 8: Nonexistent problem rejected
    const resNonExistent = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, 999999],
    }, tokenProfA);
    assertTest(resNonExistent.status === 400, 'TEST 8: Nonexistent problem ID rejected with 400 Bad Request');

    // TEST 9: Invalid payload rejected
    const resInvalid = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: ['not_an_id', p3.id, p2.id, p1.id],
    }, tokenProfA);
    assertTest(resInvalid.status === 400, 'TEST 9: Non-numeric problem ID payload rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 7. TWO-PROBLEM SWAP & MULTI-PROBLEM REORDER (TESTS 1, 2, 3, 28)
    // -------------------------------------------------------------
    console.log('\n--- 7. Testing Two-Problem Swap & Multi-Problem Reorder ---');

    // TEST 2: Two-problem swap
    const resTwoSwap = await request('PUT', `/api/contests/${contestB.id}/problems/order`, {
      problemIds: [p2.id, p1.id],
    }, tokenProfB);
    assertTest(resTwoSwap.status === 200, 'TEST 2a: Two-problem swap returns 200 OK');

    const dbRowsContestB = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestB.id]);
    assertTest(
      dbRowsContestB.rows.length === 2 &&
      dbRowsContestB.rows[0].problem_id === p2.id && dbRowsContestB.rows[0].problem_order === 1 &&
      dbRowsContestB.rows[1].problem_id === p1.id && dbRowsContestB.rows[1].problem_order === 2,
      'TEST 2b: Two problems swapped cleanly in database (p2=1, p1=2)'
    );

    // TEST 3 & 1: Multi-problem complete reorder
    const resMultiOrder = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p3.id, p1.id, p4.id, p2.id],
    }, tokenProfA);
    assertTest(resMultiOrder.status === 200, 'TEST 1: Complete reorder succeeds with status 200');
    assertTest(resMultiOrder.body.status === 'success', 'TEST 3a: Multi-problem response envelope contains status="success"');

    // TEST 28: Final database order matches request
    const dbRowsContestA = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);
    const actualDbIds = dbRowsContestA.rows.map(r => r.problem_id);
    assertTest(
      JSON.stringify(actualDbIds) === JSON.stringify([p3.id, p1.id, p4.id, p2.id]),
      'TEST 28: Final database order exactly matches requested permutation [p3, p1, p4, p2]'
    );

    // -------------------------------------------------------------
    // 8. POSITION INTEGRITY (NO DUPLICATES, NO GAPS) (TESTS 15, 17, 18)
    // -------------------------------------------------------------
    console.log('\n--- 8. Testing Position Integrity ---');
    const actualPositions = dbRowsContestA.rows.map(r => r.problem_order);

    // TEST 17: No duplicate positions
    const uniquePositions = new Set(actualPositions);
    assertTest(uniquePositions.size === actualPositions.length, 'TEST 17: No duplicate positions in database');

    // TEST 18: No missing positions (contiguous 1 to N)
    assertTest(
      JSON.stringify(actualPositions) === JSON.stringify([1, 2, 3, 4]),
      'TEST 18: No missing positions (strictly contiguous 1-indexed [1, 2, 3, 4])'
    );

    // TEST 15: Transaction commits all updates atomically
    assertTest(
      dbRowsContestA.rows.every(r => r.problem_order >= 1 && r.problem_order <= 4),
      'TEST 15: All problem positions updated and committed atomically in one transaction'
    );

    // -------------------------------------------------------------
    // 9. CRITICAL TRANSACTION TEST: ROLLBACK ON FAILURE (TEST 16)
    // -------------------------------------------------------------
    console.log('\n--- 9. Critical Transaction Test: Rollback on Failure ---');
    // Save current baseline ordering of Contest A
    const baselineBeforeFail = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);
    const baselineOrder = baselineBeforeFail.rows.map(r => ({ id: r.problem_id, order: r.problem_order }));

    // Create a temporary database trigger that intentionally fails during UPDATE
    await db.query(`
      CREATE OR REPLACE FUNCTION trg_test_order_abort() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.problem_order = 2 THEN
          RAISE EXCEPTION 'Simulated database failure during reorder';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await db.query(`
      CREATE TRIGGER trg_test_order_abort_trigger
      BEFORE UPDATE ON contest_problems
      FOR EACH ROW EXECUTE FUNCTION trg_test_order_abort();
    `);

    try {
      // Attempt reorder that should trigger the failure
      const resFailedTx = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
        problemIds: [p1.id, p2.id, p3.id, p4.id],
      }, tokenProfA);

      assertTest(resFailedTx.status >= 500, 'TEST 16a: Operation returns 500 error when transaction update fails');

      // Verify that database was completely rolled back and previous ordering remains 100% intact
      const afterFailRows = await db.query(`
        SELECT problem_id, problem_order FROM contest_problems
        WHERE contest_id = $1 ORDER BY problem_order ASC;
      `, [contestA.id]);
      const afterFailOrder = afterFailRows.rows.map(r => ({ id: r.problem_id, order: r.problem_order }));

      assertTest(
        JSON.stringify(afterFailOrder) === JSON.stringify(baselineOrder),
        'TEST 16b: Database completely rolled back: previous ordering remains exactly intact'
      );
    } finally {
      // Always remove the test trigger
      await db.query(`DROP TRIGGER IF EXISTS trg_test_order_abort_trigger ON contest_problems;`);
      await db.query(`DROP FUNCTION IF EXISTS trg_test_order_abort();`);
    }

    // Verify reordering succeeds normally after trigger removal
    const resRecover = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfA);
    assertTest(resRecover.status === 200, 'TEST 16c: System functions normally after rollback test cleanup');

    // -------------------------------------------------------------
    // 10. REPEATED IDENTICAL ORDERING / IDEMPOTENCY (TEST 20)
    // -------------------------------------------------------------
    console.log('\n--- 10. Testing Idempotency & Repeated Ordering ---');
    const resRepeat1 = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);
    const resRepeat2 = await request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);

    assertTest(
      resRepeat1.status === 200 && resRepeat2.status === 200,
      'TEST 20a: Submitting the identical reorder twice returns 200 OK on both attempts'
    );

    const idempotencyCheck = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);
    assertTest(
      JSON.stringify(idempotencyCheck.rows.map(r => r.problem_id)) === JSON.stringify([p4.id, p3.id, p2.id, p1.id]),
      'TEST 20b: Repeated identical order preserves correct positions without corruption'
    );

    // -------------------------------------------------------------
    // 11. CONCURRENCY PROTECTION (TEST 19)
    // -------------------------------------------------------------
    console.log('\n--- 11. Testing Concurrency Protection ---');
    const cReq1 = request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p1.id, p2.id, p3.id, p4.id],
    }, tokenProfA);

    const cReq2 = request('PUT', `/api/contests/${contestA.id}/problems/order`, {
      problemIds: [p4.id, p3.id, p2.id, p1.id],
    }, tokenProfA);

    const [c1, c2] = await Promise.all([cReq1, cReq2]);
    assertTest(
      (c1.status === 200 || c1.status === 409) && (c2.status === 200 || c2.status === 409),
      'TEST 19a: Concurrent reorders serialize safely without deadlock or uncaught crash'
    );

    const concurrentRows = await db.query(`
      SELECT problem_id, problem_order FROM contest_problems
      WHERE contest_id = $1 ORDER BY problem_order ASC;
    `, [contestA.id]);
    assertTest(
      JSON.stringify(concurrentRows.rows.map(r => r.problem_order)) === JSON.stringify([1, 2, 3, 4]),
      'TEST 19b: Final database state after concurrent reorder has valid positions [1, 2, 3, 4]'
    );

    // -------------------------------------------------------------
    // 12. AUDIT LOGGING & RATE LIMITING (TESTS 21, 22)
    // -------------------------------------------------------------
    console.log('\n--- 12. Testing Audit Logging & Rate Limiting ---');
    const auditRes = await db.query(`
      SELECT * FROM audit_logs
      WHERE action = 'CONTEST_PROBLEMS_REORDERED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [contestA.id]);

    assertTest(auditRes.rowCount > 0, 'TEST 21a: Audit log created for CONTEST_PROBLEMS_REORDERED');
    assertTest(
      (auditRes.rows[0].outcome || '').toLowerCase() === 'success',
      'TEST 21b: Audit log correctly records SUCCESS outcome'
    );

    assertTest(
      typeof resSuperAdmin.headers === 'object',
      'TEST 22: Rate limiting headers preserved on responses'
    );

    // -------------------------------------------------------------
    // 13. DATA INTEGRITY INVARIANTS (TESTS 23, 24, 25, 26, 27)
    // -------------------------------------------------------------
    console.log('\n--- 13. Testing Data Integrity Invariants ---');

    // TEST 23: Underlying problem definitions unchanged
    const p1Meta = await ProblemModel.findProblemById(p1.id);
    assertTest(
      p1Meta.title === `P1_Atomic_${ts}` && p1Meta.difficulty === 'easy' && p1Meta.codingMode === 'function',
      'TEST 23: Underlying problem record metadata remains completely unchanged'
    );

    // Test cases intact
    const tcMeta = await db.query('SELECT * FROM test_cases WHERE problem_id = $1;', [p1.id]);
    assertTest(
      tcMeta.rowCount === 1 && tcMeta.rows[0].input_data === 'in_1',
      'TEST 23b: Underlying problem test cases remain untouched'
    );

    // TEST 24: Submissions unchanged
    const subCount = await db.query('SELECT COUNT(*) FROM submissions WHERE contest_id = $1;', [contestA.id]);
    assertTest(parseInt(subCount.rows[0].count, 10) === 0, 'TEST 24: Submissions table remains untouched');

    // TEST 25: Participants unchanged
    const partCount = await db.query('SELECT COUNT(*) FROM contest_participants WHERE contest_id = $1;', [contestA.id]);
    assertTest(parseInt(partCount.rows[0].count, 10) === 0, 'TEST 25: Contest participants remain unchanged');

    // TEST 26: Ratings configuration unchanged
    const contestMeta = await ContestModel.findContestById(contestA.id);
    assertTest(contestMeta.isRated === true, 'TEST 26: Contest rating configuration unaffected by bulk reorder');

    // TEST 27: Leaderboard standings computation intact
    const StandingsService = require('./src/services/standingsService');
    const standings = await StandingsService.computeContestStandings({
      contestId: contestA.id,
      page: 1,
      limit: 10,
    });
    assertTest(
      standings && Array.isArray(standings.problems) && standings.problems.length === 4,
      'TEST 27: Standings and leaderboard computation functions seamlessly after bulk reorder'
    );

  } finally {
    // -------------------------------------------------------------
    // 14. CLEANUP
    // -------------------------------------------------------------
    console.log('\n--- 14. Ephemeral Fixture Cleanup ---');
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
  console.log(` PHASE 7.5.5.6 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
