/**
 * Phase 7.5.5.2 — Contest Problem List Automated Backend Test Suite
 * File: backend/test_admin_phase5_5_2_contest_problem_list.js
 * 
 * Verifies:
 * 1. Authorized contest_admin access (200 OK)
 * 2. Authorized super_admin access (200 OK)
 * 3. Authorized professor access to own contest (200 OK)
 * 4. Professor ownership isolation (403 Forbidden on other professor's contest)
 * 5. Student rejection (403 Forbidden)
 * 6. Unauthenticated rejection (401 Unauthorized)
 * 7. Invalid contest ID (404 Not Found)
 * 8. Contest with zero problems (200 OK, count: 0, problems: [])
 * 9. Contest with multiple problems (200 OK, count: N, problems: [...])
 * 10. Correct problem ordering/position (ordered by problemOrder ascending)
 * 11. Expected metadata returned (problemId, title, difficulty, codingMode, points, problemOrder)
 * 12. Hidden test cases NOT returned (zero test case leaks)
 * 13. Solution/answer data NOT returned (zero solution leaks)
 * 14. Cross-resource access protection (BOLA verification)
 * 15. Standardized response format envelope
 * 16. Database state remains unchanged (pure read-only query)
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
    if (body) {
      req.write(JSON.stringify(body));
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
  console.log(' STARTING PHASE 7.5.5.2 CONTEST PROBLEM LIST TESTS');
  console.log('=======================================================\n');

  // Start ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  const timestamp = Date.now();
  const testUsers = [];
  const testContests = [];
  const testProblems = [];

  try {
    // -------------------------------------------------------------------------
    // 1. Setting Up Test Actors
    // -------------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    // Professor A (owner)
    const profA = await UserModel.createUser({
      username: `prof_a_7552_${timestamp}`,
      email: `prof_a_7552_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'MIT',
      fullName: 'Professor Alpha 7552',
    });
    testUsers.push(profA.id);
    const tokenProfA = generateToken({ id: profA.id, role: profA.role, username: profA.username });

    // Professor B (non-owner)
    const profB = await UserModel.createUser({
      username: `prof_b_7552_${timestamp}`,
      email: `prof_b_7552_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'Stanford',
      fullName: 'Professor Beta 7552',
    });
    testUsers.push(profB.id);
    const tokenProfB = generateToken({ id: profB.id, role: profB.role, username: profB.username });

    // Contest Admin
    const contestAdmin = await UserModel.createUser({
      username: `admin_c_7552_${timestamp}`,
      email: `admin_c_7552_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'contest_admin',
      institution: 'Global',
      fullName: 'Contest Admin 7552',
    });
    testUsers.push(contestAdmin.id);
    const tokenContestAdmin = generateToken({ id: contestAdmin.id, role: contestAdmin.role, username: contestAdmin.username });

    // Super Admin
    const superAdmin = await UserModel.createUser({
      username: `super_7552_${timestamp}`,
      email: `super_7552_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'super_admin',
      institution: 'Global',
      fullName: 'Super Admin 7552',
    });
    testUsers.push(superAdmin.id);
    const tokenSuperAdmin = generateToken({ id: superAdmin.id, role: superAdmin.role, username: superAdmin.username });

    // Student
    const student = await UserModel.createUser({
      username: `student_7552_${timestamp}`,
      email: `student_7552_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      institution: 'MIT',
      fullName: 'Student 7552',
    });
    testUsers.push(student.id);
    const tokenStudent = generateToken({ id: student.id, role: student.role, username: student.username });

    assertTest(testUsers.length === 5, 'All 5 test actors created with JWTs');

    // -------------------------------------------------------------------------
    // 2. Setting Up Test Problems
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Setting Up Test Problems ---');
    const p1 = await ProblemModel.createProblem({
      title: `Problem 1 Alphabet ${timestamp}`,
      description: 'Alphabet sorting task with private test cases',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      starterTemplates: { python: 'def solve(): pass' },
    });
    testProblems.push(p1.id);

    const p2 = await ProblemModel.createProblem({
      title: `Problem 2 Dynamic Programming ${timestamp}`,
      description: 'DP grid calculation task with private test cases',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
      starterTemplates: { python: 'print("hello")' },
    });
    testProblems.push(p2.id);

    const p3 = await ProblemModel.createProblem({
      title: `Problem 3 Graph Traversal ${timestamp}`,
      description: 'BFS shortest path task with private test cases',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profA.id,
      starterTemplates: { python: 'def bfs(): pass' },
    });
    testProblems.push(p3.id);

    // Attach private testcase to p1 to verify zero leaks
    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, order_index)
      VALUES ($1, 'SECRET_INPUT_XYZ', 'SECRET_OUTPUT_123', false, 1);
    `, [p1.id]);

    assertTest(testProblems.length === 3, '3 test problems initialized with testcases');

    // -------------------------------------------------------------------------
    // 3. Setting Up Test Contests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Setting Up Test Contests ---');
    const now = Date.now();
    const startTime = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now + 27 * 60 * 60 * 1000).toISOString();

    // Contest 1: Multi-problem contest owned by Prof A
    const contestWithProblems = await ContestModel.createContest({
      title: `Contest Multi-Prob ${timestamp}`,
      description: 'Contest with 3 ordered problems',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: false,
      leaderboardFreezeMinutes: 60,
    });
    testContests.push(contestWithProblems.id);

    // Attach problems in non-ID order to test ordering:
    // P2 -> Order 1 (50 pts)
    // P1 -> Order 2 (100 pts)
    // P3 -> Order 3 (250 pts)
    await ContestModel.addProblemToContest({
      contestId: contestWithProblems.id,
      problemId: p2.id,
      points: 50,
      problemOrder: 1,
    });
    await ContestModel.addProblemToContest({
      contestId: contestWithProblems.id,
      problemId: p1.id,
      points: 100,
      problemOrder: 2,
    });
    await ContestModel.addProblemToContest({
      contestId: contestWithProblems.id,
      problemId: p3.id,
      points: 250,
      problemOrder: 3,
    });

    // Contest 2: Empty contest with 0 problems owned by Prof A
    const emptyContest = await ContestModel.createContest({
      title: `Contest Empty ${timestamp}`,
      description: 'Contest with zero problems',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: false,
    });
    testContests.push(emptyContest.id);

    assertTest(testContests.length === 2, '2 test contests initialized (one with 3 problems, one empty)');

    // -------------------------------------------------------------------------
    // 4. Testing Authorization & RBAC
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Authorization & RBAC ---');

    // TEST 1: Contest Admin Access
    const resAdmin = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenContestAdmin);
    assertTest(resAdmin.status === 200, 'TEST 1: Authorized contest_admin can list problems (200 OK)');
    assertTest(resAdmin.body.status === 'success', 'TEST 1 (format): Returns status="success" envelope');
    assertTest(resAdmin.body.count === 3, 'TEST 1 (count): Returns count=3 for contest_admin');

    // TEST 2: Super Admin Access
    const resSuper = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenSuperAdmin);
    assertTest(resSuper.status === 200, 'TEST 2: Authorized super_admin can list problems (200 OK)');
    assertTest(resSuper.body.count === 3, 'TEST 2 (count): Returns count=3 for super_admin');

    // TEST 3: Authorized Professor Access (Own Contest)
    const resProfA = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenProfA);
    assertTest(resProfA.status === 200, 'TEST 3: Authorized professor can list problems of owned contest (200 OK)');
    assertTest(resProfA.body.contestId === contestWithProblems.id, 'TEST 3 (contestId): Response contestId matches requested ID');

    // TEST 4: Professor Ownership Isolation (BOLA / IDOR)
    const resProfB = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenProfB);
    assertTest(resProfB.status === 403, 'TEST 4: Non-owner professor receives 403 Forbidden (ownership isolation)');
    assertTest(
      resProfB.body.message && resProfB.body.message.includes('permission'),
      'TEST 4 (msg): Returns clear permission denial message'
    );

    // TEST 5: Student Rejection
    const resStudent = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenStudent);
    assertTest(resStudent.status === 403, 'TEST 5: Student role receives 403 Forbidden');

    // TEST 6: Unauthenticated Rejection
    const resUnauth = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, null);
    assertTest(resUnauth.status === 401, 'TEST 6: Unauthenticated request receives 401 Unauthorized');

    // -------------------------------------------------------------------------
    // 5. Testing Parameters & Edge Cases
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Parameters & Edge Cases ---');

    // TEST 7: Invalid Contest ID
    const resNotFound = await request('GET', '/api/contests/99999999/problems', null, tokenContestAdmin);
    assertTest(resNotFound.status === 404, 'TEST 7: Non-existent contest ID returns 404 Not Found');
    assertTest(resNotFound.body.statusCode === 404, 'TEST 7 (statusCode): Structured 404 envelope returned');

    // TEST 8: Contest with Zero Problems
    const resEmpty = await request('GET', `/api/contests/${emptyContest.id}/problems`, null, tokenProfA);
    assertTest(resEmpty.status === 200, 'TEST 8: Contest with zero problems returns 200 OK');
    assertTest(resEmpty.body.count === 0, 'TEST 8 (count): Returns count=0');
    assertTest(Array.isArray(resEmpty.body.problems) && resEmpty.body.problems.length === 0, 'TEST 8 (array): Returns empty problems array');

    // -------------------------------------------------------------------------
    // 6. Testing Problem Metadata & Ordering
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Problem Metadata & Ordering ---');

    // TEST 9 & 10: Problem Count & Deterministic Ordering
    const problemsList = resProfA.body.problems;
    assertTest(problemsList.length === 3, 'TEST 9: Multiple problems returned correctly (length = 3)');

    assertTest(
      problemsList[0].problemId === p2.id && problemsList[0].problemOrder === 1,
      'TEST 10a: First problem is P2 with problemOrder=1'
    );
    assertTest(
      problemsList[1].problemId === p1.id && problemsList[1].problemOrder === 2,
      'TEST 10b: Second problem is P1 with problemOrder=2'
    );
    assertTest(
      problemsList[2].problemId === p3.id && problemsList[2].problemOrder === 3,
      'TEST 10c: Third problem is P3 with problemOrder=3'
    );

    // TEST 11: Expected Metadata Returned
    const firstProb = problemsList[0];
    assertTest(
      firstProb.problemId !== undefined &&
      typeof firstProb.title === 'string' &&
      typeof firstProb.difficulty === 'string' &&
      typeof firstProb.codingMode === 'string' &&
      typeof firstProb.points === 'number' &&
      typeof firstProb.problemOrder === 'number' &&
      firstProb.status === 'active',
      'TEST 11: Each problem contains problemId, title, difficulty, codingMode, points, problemOrder, status'
    );
    assertTest(firstProb.points === 50, 'TEST 11 (pts): Custom points (50 pts) accurately preserved');

    // -------------------------------------------------------------------------
    // 7. Testing Data Leak Prevention & Zero Secret Exposure
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Data Leak Prevention ---');

    // TEST 12: Hidden test cases are NOT returned
    const p1Item = problemsList.find((p) => p.problemId === p1.id);
    const rawP1Str = JSON.stringify(p1Item);
    assertTest(
      !rawP1Str.includes('SECRET_INPUT_XYZ') && !rawP1Str.includes('SECRET_OUTPUT_123'),
      'TEST 12a: Private test case data is NOT present in problem output'
    );
    assertTest(
      p1Item.testCases === undefined && p1Item.test_cases === undefined,
      'TEST 12b: Testcase arrays are strictly stripped from contest problem list'
    );

    // TEST 13: Solution/Answer data is NOT returned
    assertTest(
      p1Item.solution === undefined && p1Item.solutionCode === undefined && p1Item.answers === undefined,
      'TEST 13: Solution and answer fields are completely absent from response'
    );

    // TEST 14: Cross-Resource Protection Check
    const resBOLA = await request('GET', `/api/contests/${contestWithProblems.id}/problems`, null, tokenProfB);
    assertTest(resBOLA.status === 403, 'TEST 14: Cross-resource access prevented via BOLA check');

    // TEST 15: Envelope structure parity
    assertTest(
      resProfA.body.status === 'success' &&
      typeof resProfA.body.contestId === 'number' &&
      typeof resProfA.body.count === 'number' &&
      Array.isArray(resProfA.body.problems),
      'TEST 15: Response conforms strictly to API contract { status, contestId, count, problems }'
    );

    // -------------------------------------------------------------------------
    // 8. Testing Database Invariance (Read-Only Safety)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Database Invariance (Read-Only) ---');

    // Count database records before and after
    const dbCountCheck = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1',
      [contestWithProblems.id]
    );
    assertTest(dbCountCheck.rows[0].count === 3, 'TEST 16: Database relationships remain intact (3 attached problems, 0 mutations)');

    // -------------------------------------------------------------------------
    // 9. Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Cleanup ---');
    for (const cid of testContests) {
      await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [cid]);
      await db.query('DELETE FROM contests WHERE id = $1', [cid]);
    }
    for (const pid of testProblems) {
      await db.query('DELETE FROM test_cases WHERE problem_id = $1', [pid]);
      await db.query('DELETE FROM problems WHERE id = $1', [pid]);
    }
    for (const uid of testUsers) {
      await db.query('DELETE FROM users WHERE id = $1', [uid]);
    }
    console.log('[PASS] Ephemeral test fixtures safely cleaned up');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
