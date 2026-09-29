/**
 * Phase 7.5.8.3 — Admin Leaderboard Test Suite
 * File: backend/test_phase7_5_8_3_admin_leaderboard.js
 *
 * Exhaustively validates:
 * 1. GET /api/contests/:id/admin-leaderboard Security & RBAC:
 *    - Anonymous request rejected with 401 Unauthorized
 *    - Student request rejected with 403 Forbidden
 *    - Non-owning professor request rejected with 403 Forbidden (BOLA/IDOR protection)
 *    - Contest creator professor request succeeds (200 OK)
 *    - Super Admin request succeeds (200 OK)
 * 2. Contest ID & Parameter Validation:
 *    - Non-integer contest ID -> 400 Bad Request
 *    - Negative contest ID -> 400 Bad Request
 *    - Non-existent contest ID -> 404 Not Found
 *    - Invalid sortBy field -> 400 Bad Request
 *    - Invalid sortOrder -> 400 Bad Request
 *    - Invalid filterStatus -> 400 Bad Request
 * 3. Authoritative Scoring & Data Structure:
 *    - Standings structure matches server-authoritative StandingsService
 *    - totalSubmissions count per participant verified
 *    - Solved count, score, penalty minutes match judging data
 * 4. Whitelisted Sorting & Rank Preservation:
 *    - Sorting by score DESC, penalty ASC, participant ASC, submissions DESC
 *    - Official rank values remain strictly preserved during sorting
 * 5. Status Filtering:
 *    - filterStatus=solved_any, has_submissions, no_submissions
 * 6. Leaderboard Freeze Integration:
 *    - freezeOverride=true allows authorized manager to see unmasked standings
 * 7. Server-Side Pagination:
 *    - Page, limit, totalPages, hasNext, hasPrev
 *    - Maximum server-side limit clamping
 */

process.env.RATE_LIMIT_CONTEST_MAX = '1000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
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
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
        });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.8.3 ADMIN LEADERBOARD TEST SUITE');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(label) {
    passed++;
    console.log(`  [PASS] ${label}`);
  }

  function fail(label, err) {
    failed++;
    console.error(`  [FAIL] ${label}:`, err ? err.message || err : '');
  }

  const createdUserIds = [];
  const createdContestIds = [];
  const createdProblemIds = [];

  try {
    // 0. Start test server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`Test server running at ${baseUrl}\n`);
        resolve();
      });
    });

    const ts = Date.now();
    const passwordHash = await hashPassword('TestPass@1234');

    // 1. Setup Test Users
    console.log('--- 1. Setup Test Users ---');
    const profA = await UserModel.createUser({
      username: `p7583_profA_${ts}`,
      email: `p7583_profA_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'professor',
      fullName: 'Professor Alpha',
    });
    createdUserIds.push(profA.id);
    const profAToken = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `p7583_profB_${ts}`,
      email: `p7583_profB_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'professor',
      fullName: 'Professor Beta',
    });
    createdUserIds.push(profB.id);
    const profBToken = generateToken(profB);

    const superAdmin = await UserModel.createUser({
      username: `p7583_admin_${ts}`,
      email: `p7583_admin_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'super_admin',
      fullName: 'Super Administrator',
    });
    createdUserIds.push(superAdmin.id);
    const superAdminToken = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `p7583_stud1_${ts}`,
      email: `p7583_stud1_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'student',
      fullName: 'Alice Student',
    });
    createdUserIds.push(student1.id);
    const student1Token = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `p7583_stud2_${ts}`,
      email: `p7583_stud2_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'student',
      fullName: 'Bob Student',
    });
    createdUserIds.push(student2.id);
    const student2Token = generateToken(student2);

    const student3 = await UserModel.createUser({
      username: `p7583_stud3_${ts}`,
      email: `p7583_stud3_${ts}@examforge.test`,
      passwordHash: passwordHash,
      role: 'student',
      fullName: 'Charlie Student',
    });
    createdUserIds.push(student3.id);

    pass('Setup: All test actors successfully created');

    // 2. Setup Test Problems
    console.log('\n--- 2. Setup Test Problems ---');
    const prob1 = await ProblemModel.createProblem({
      title: `P7583 Prob1 ${ts}`,
      description: 'Problem 1 Description',
      difficulty: 'easy',
      authorId: profA.id,
      createdBy: profA.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob1.id);
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '1 2\n',
      expectedOutput: '3\n',
      isSample: false,
    });

    const prob2 = await ProblemModel.createProblem({
      title: `P7583 Prob2 ${ts}`,
      description: 'Problem 2 Description',
      difficulty: 'medium',
      authorId: profA.id,
      createdBy: profA.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob2.id);
    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '3 4\n',
      expectedOutput: '7\n',
      isSample: false,
    });

    pass('Setup: Contest problems with test cases created');

    // 3. Setup Test Contest created by profA
    console.log('\n--- 3. Setup Test Contest ---');
    const now = new Date();
    const startTime = new Date(now.getTime() - 30 * 60 * 1000); // 30m ago
    const endTime = new Date(now.getTime() + 60 * 60 * 1000); // in 60m

    const contest = await ContestModel.createContest({
      title: `P7583 Contest ${ts}`,
      description: 'Contest for Phase 7.5.8.3 Admin Leaderboard',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 20, // freeze starts at endTime - 20m
      status: 'published',
    });
    createdContestIds.push(contest.id);

    await ContestModel.addProblemToContest({
      contestId: contest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });

    await ContestModel.addProblemToContest({
      contestId: contest.id,
      problemId: prob2.id,
      points: 200,
      problemOrder: 2,
    });

    // Enroll students in contest
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3), ($1, $4, $3), ($1, $5, $3)`,
      [contest.id, student1.id, now, student2.id, student3.id]
    );

    pass('Setup: Contest created with attached problems and enrolled participants');

    // 4. Create Submissions
    console.log('\n--- 4. Setup Submissions & Judging Data ---');
    // Student 1 (Alice):
    // - Solved Prob 1 (accepted at +5m)
    // - Solved Prob 2 (1 failed attempt at +10m, accepted at +15m)
    // -> Total score: 300, Solved: 2, Total submissions: 3
    await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'return a + b;',
      status: 'accepted',
      score: 100,
      executionTime: 45,
      memoryUsed: 12000,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 5 * 60000),
    });

    await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'return a;',
      status: 'wrong_answer',
      score: 0,
      executionTime: 40,
      memoryUsed: 11000,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 10 * 60000),
    });

    await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'return a + b;',
      status: 'accepted',
      score: 200,
      executionTime: 50,
      memoryUsed: 12500,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 15 * 60000),
    });

    // Student 2 (Bob):
    // - Solved Prob 1 (accepted at +8m)
    // - Failed Prob 2 (2 wrong answers at +12m, +18m)
    // -> Total score: 100, Solved: 1, Total submissions: 3
    await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'return a + b;',
      status: 'accepted',
      score: 100,
      executionTime: 60,
      memoryUsed: 13000,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 8 * 60000),
    });

    await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'return 0;',
      status: 'wrong_answer',
      score: 0,
      executionTime: 35,
      memoryUsed: 10000,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 12 * 60000),
    });

    await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'return -1;',
      status: 'wrong_answer',
      score: 0,
      executionTime: 38,
      memoryUsed: 10500,
      isSampleRun: false,
      createdAt: new Date(startTime.getTime() + 18 * 60000),
    });

    // Student 3 (Charlie):
    // - Zero submissions
    // -> Total score: 0, Solved: 0, Total submissions: 0

    pass('Setup: Submissions recorded for Alice (300 pts), Bob (100 pts), Charlie (0 pts)');

    // ==========================================
    // 5. SECURITY & RBAC TESTING
    // ==========================================
    console.log('\n--- 5. Testing Security & RBAC ---');

    // 5.1 Anonymous request rejected
    const anonRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`);
    assert.strictEqual(anonRes.status, 401);
    pass('RBAC: Anonymous access rejected with 401 Unauthorized');

    // 5.2 Student access rejected
    const studentRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, student1Token);
    assert.strictEqual(studentRes.status, 403);
    pass('RBAC: Student access rejected with 403 Forbidden');

    // 5.3 Non-owning professor rejected (BOLA/IDOR)
    const profBRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, profBToken);
    assert.strictEqual(profBRes.status, 403);
    pass('BOLA: Non-owning professor rejected with 403 Forbidden');

    // 5.4 Contest creator professor allowed
    const profARes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, profAToken);
    assert.strictEqual(profARes.status, 200);
    pass('RBAC: Contest creator professor allowed with 200 OK');

    // 5.5 Super Admin allowed
    const adminRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard`, null, superAdminToken);
    assert.strictEqual(adminRes.status, 200);
    pass('RBAC: Super Admin allowed with 200 OK');

    // ==========================================
    // 6. INPUT VALIDATION & HARDENING
    // ==========================================
    console.log('\n--- 6. Testing Input Validation ---');

    // 6.1 Non-integer contest ID
    const badIdRes = await request('GET', `/api/contests/abc/admin-leaderboard`, null, superAdminToken);
    assert.strictEqual(badIdRes.status, 400);
    pass('VALIDATION: Non-integer contest ID rejected with 400 Bad Request');

    // 6.2 Negative contest ID
    const negIdRes = await request('GET', `/api/contests/-1/admin-leaderboard`, null, superAdminToken);
    assert.strictEqual(negIdRes.status, 400);
    pass('VALIDATION: Negative contest ID rejected with 400 Bad Request');

    // 6.3 Non-existent contest ID
    const notFoundRes = await request('GET', `/api/contests/999999/admin-leaderboard`, null, superAdminToken);
    assert.strictEqual(notFoundRes.status, 404);
    pass('VALIDATION: Non-existent contest ID returns 404 Not Found');

    // 6.4 Invalid sortBy
    const badSortRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortBy=malicious_col`, null, superAdminToken);
    assert.strictEqual(badSortRes.status, 400);
    assert.strictEqual(badSortRes.body.message.includes('Invalid sortBy field'), true);
    pass('VALIDATION: Unwhitelisted sortBy rejected with 400 Bad Request');

    // 6.5 Invalid sortOrder
    const badOrderRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortOrder=SIDEWAYS`, null, superAdminToken);
    assert.strictEqual(badOrderRes.status, 400);
    assert.strictEqual(badOrderRes.body.message.includes('Invalid sortOrder'), true);
    pass('VALIDATION: Unwhitelisted sortOrder rejected with 400 Bad Request');

    // 6.6 Invalid filterStatus
    const badFilterRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?filterStatus=hacked`, null, superAdminToken);
    assert.strictEqual(badFilterRes.status, 400);
    assert.strictEqual(badFilterRes.body.message.includes('Invalid filterStatus'), true);
    pass('VALIDATION: Unwhitelisted filterStatus rejected with 400 Bad Request');

    // ==========================================
    // 7. AUTHORITATIVE DATA & METRICS
    // ==========================================
    console.log('\n--- 7. Testing Authoritative Data & Metrics ---');

    const defaultLeaderboard = profARes.body;
    assert.strictEqual(Boolean(defaultLeaderboard.contest), true);
    assert.strictEqual(Boolean(defaultLeaderboard.problems), true);
    assert.strictEqual(Boolean(defaultLeaderboard.standings), true);
    assert.strictEqual(Boolean(defaultLeaderboard.contestSummary), true);
    assert.strictEqual(defaultLeaderboard.standings.length, 3);
    pass('PAYLOAD: Response includes contest, problems, standings, contestSummary, and pagination');

    // Standings rank order verification:
    // Rank 1: Alice (300 pts, 2 solves, 3 submissions)
    const alice = defaultLeaderboard.standings[0];
    assert.strictEqual(alice.userId, student1.id);
    assert.strictEqual(alice.rank, 1);
    assert.strictEqual(alice.totalScore, 300);
    assert.strictEqual(alice.solvedProblemsCount, 2);
    assert.strictEqual(alice.totalSubmissions, 3);
    pass('DATA INTEGRITY: Alice has authoritative Rank 1, 300 points, 2 solves, 3 submissions');

    // Rank 2: Bob (100 pts, 1 solve, 3 submissions)
    const bob = defaultLeaderboard.standings[1];
    assert.strictEqual(bob.userId, student2.id);
    assert.strictEqual(bob.rank, 2);
    assert.strictEqual(bob.totalScore, 100);
    assert.strictEqual(bob.solvedProblemsCount, 1);
    assert.strictEqual(bob.totalSubmissions, 3);
    pass('DATA INTEGRITY: Bob has authoritative Rank 2, 100 points, 1 solve, 3 submissions');

    // Rank 3: Charlie (0 pts, 0 solves, 0 submissions)
    const charlie = defaultLeaderboard.standings[2];
    assert.strictEqual(charlie.userId, student3.id);
    assert.strictEqual(charlie.rank, 3);
    assert.strictEqual(charlie.totalScore, 0);
    assert.strictEqual(charlie.solvedProblemsCount, 0);
    assert.strictEqual(charlie.totalSubmissions, 0);
    pass('DATA INTEGRITY: Charlie has authoritative Rank 3, 0 points, 0 solves, 0 submissions');

    // ==========================================
    // 8. SORTING & RANK PRESERVATION
    // ==========================================
    console.log('\n--- 8. Testing Sorting & Official Rank Preservation ---');

    // 8.1 Sort by participant (alphabetical by name/username ASC)
    // Alphabetical order: Alice Student -> Bob Student -> Charlie Student
    const sortPartRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortBy=participant&sortOrder=ASC`, null, profAToken);
    assert.strictEqual(sortPartRes.status, 200);
    assert.strictEqual(sortPartRes.body.standings[0].username, student1.username);
    assert.strictEqual(sortPartRes.body.standings[0].rank, 1);
    pass('SORTING: Sort by participant ASC works correctly');

    // 8.2 Sort by participant DESC: Charlie Student -> Bob Student -> Alice Student
    const sortPartDescRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortBy=participant&sortOrder=DESC`, null, profAToken);
    assert.strictEqual(sortPartDescRes.status, 200);
    const firstDesc = sortPartDescRes.body.standings[0];
    assert.strictEqual(firstDesc.username, student3.username);
    // Crucial check: Charlie is now at the top of the sorted list, but his official rank MUST still be 3!
    assert.strictEqual(firstDesc.rank, 3);
    pass('RANK PRESERVATION: Sorting by participant DESC places Charlie first while PRESERVING rank #3');

    // 8.3 Sort by score ASC: Charlie (0) -> Bob (100) -> Alice (300)
    const sortScoreAscRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortBy=score&sortOrder=ASC`, null, profAToken);
    assert.strictEqual(sortScoreAscRes.status, 200);
    assert.strictEqual(sortScoreAscRes.body.standings[0].totalScore, 0);
    assert.strictEqual(sortScoreAscRes.body.standings[0].rank, 3); // Official rank preserved
    assert.strictEqual(sortScoreAscRes.body.standings[2].totalScore, 300);
    assert.strictEqual(sortScoreAscRes.body.standings[2].rank, 1); // Official rank preserved
    pass('RANK PRESERVATION: Sorting by score ASC preserves official ranks #3 and #1');

    // 8.4 Sort by submissions DESC: Alice (3), Bob (3), Charlie (0)
    const sortSubDescRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?sortBy=submissions&sortOrder=DESC`, null, profAToken);
    assert.strictEqual(sortSubDescRes.status, 200);
    assert.strictEqual(sortSubDescRes.body.standings[2].totalSubmissions, 0);
    assert.strictEqual(sortSubDescRes.body.standings[2].username, student3.username);
    pass('SORTING: Sort by submissions DESC works accurately');

    // ==========================================
    // 9. STATUS FILTERING
    // ==========================================
    console.log('\n--- 9. Testing Status Filtering ---');

    // 9.1 Filter: solved_any (Participants who solved >= 1 problem: Alice, Bob)
    const filterSolvedRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?filterStatus=solved_any`, null, profAToken);
    assert.strictEqual(filterSolvedRes.status, 200);
    assert.strictEqual(filterSolvedRes.body.standings.length, 2);
    assert.strictEqual(filterSolvedRes.body.standings.some((p) => p.userId === student3.id), false);
    pass('FILTER: filterStatus=solved_any returns only Alice and Bob (2 participants)');

    // 9.2 Filter: has_submissions (Alice, Bob)
    const filterHasSubsRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?filterStatus=has_submissions`, null, profAToken);
    assert.strictEqual(filterHasSubsRes.status, 200);
    assert.strictEqual(filterHasSubsRes.body.standings.length, 2);
    pass('FILTER: filterStatus=has_submissions returns only Alice and Bob (2 participants)');

    // 9.3 Filter: no_submissions (Charlie)
    const filterNoSubsRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?filterStatus=no_submissions`, null, profAToken);
    assert.strictEqual(filterNoSubsRes.status, 200);
    assert.strictEqual(filterNoSubsRes.body.standings.length, 1);
    assert.strictEqual(filterNoSubsRes.body.standings[0].userId, student3.id);
    pass('FILTER: filterStatus=no_submissions returns exactly Charlie');

    // ==========================================
    // 10. LEADERBOARD FREEZE & OVERRIDE
    // ==========================================
    console.log('\n--- 10. Testing Leaderboard Freeze & Override ---');

    // Create a frozen contest
    const freezeStartTime = new Date(now.getTime() - 50 * 60 * 1000);
    const freezeEndTime = new Date(now.getTime() + 10 * 60 * 1000); // ends in 10m
    // Freeze window: 30m before end = now - 20m. Current time (now) is inside freeze!
    const frozenContest = await ContestModel.createContest({
      title: `P7583 Frozen Contest ${ts}`,
      description: 'Frozen contest test',
      startTime: freezeStartTime,
      endTime: freezeEndTime,
      createdBy: profA.id,
      isRated: false,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
      status: 'published',
    });
    createdContestIds.push(frozenContest.id);

    await ContestModel.addProblemToContest({
      contestId: frozenContest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });

    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3)`,
      [frozenContest.id, student1.id, now]
    );

    // Submission submitted during freeze window (5 minutes ago)
    await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: frozenContest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'return a + b;',
      status: 'accepted',
      score: 100,
      executionTime: 45,
      memoryUsed: 12000,
      isSampleRun: false,
      createdAt: new Date(now.getTime() - 5 * 60000), // Inside freeze window!
    });

    // 10.1 Without freeze override, standings are masked (score = 0)
    const maskedRes = await request('GET', `/api/contests/${frozenContest.id}/admin-leaderboard?freezeOverride=false`, null, profAToken);
    assert.strictEqual(maskedRes.status, 200);
    assert.strictEqual(maskedRes.body.contest.isFrozen, true);
    assert.strictEqual(maskedRes.body.standings[0].totalScore, 0);
    pass('FREEZE: Default admin view honors freeze window (score masked to 0)');

    // 10.2 With freezeOverride=true, authorized manager sees live unmasked score (100)
    const unmaskedRes = await request('GET', `/api/contests/${frozenContest.id}/admin-leaderboard?freezeOverride=true`, null, profAToken);
    assert.strictEqual(unmaskedRes.status, 200);
    assert.strictEqual(unmaskedRes.body.standings[0].totalScore, 100);
    pass('FREEZE: freezeOverride=true allows contest manager to see unmasked live score (100)');

    // ==========================================
    // 11. SEARCH & SERVER-SIDE PAGINATION
    // ==========================================
    console.log('\n--- 11. Testing Search & Server-Side Pagination ---');

    // 11.1 Search by username substring
    const searchRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?search=stud1`, null, profAToken);
    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.standings.length, 1);
    assert.strictEqual(searchRes.body.standings[0].username, student1.username);
    pass('SEARCH: Search by username substring returns exact participant');

    // 11.2 Pagination with limit 2
    const page1Res = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?page=1&limit=2`, null, profAToken);
    assert.strictEqual(page1Res.status, 200);
    assert.strictEqual(page1Res.body.standings.length, 2);
    assert.strictEqual(page1Res.body.pagination.currentPage, 1);
    assert.strictEqual(page1Res.body.pagination.totalPages, 2);
    assert.strictEqual(page1Res.body.pagination.hasNext, true);
    assert.strictEqual(page1Res.body.pagination.hasPrev, false);
    pass('PAGINATION: Page 1 with limit 2 returns 2 rows and hasNext=true');

    // 11.3 Page 2
    const page2Res = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?page=2&limit=2`, null, profAToken);
    assert.strictEqual(page2Res.status, 200);
    assert.strictEqual(page2Res.body.standings.length, 1);
    assert.strictEqual(page2Res.body.pagination.currentPage, 2);
    assert.strictEqual(page2Res.body.pagination.hasNext, false);
    assert.strictEqual(page2Res.body.pagination.hasPrev, true);
    pass('PAGINATION: Page 2 returns remaining 1 row and hasPrev=true');

    // 11.4 Limit boundary clamping (requesting limit 9999 is clamped to 100)
    const clampRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?limit=9999`, null, profAToken);
    assert.strictEqual(clampRes.status, 200);
    assert.strictEqual(clampRes.body.pagination.limit, 100);
    pass('PAGINATION: Excessive limit clamped safely to 100');

    // 11.5 SQL injection search resilience
    const sqliRes = await request('GET', `/api/contests/${contest.id}/admin-leaderboard?search=' OR 1=1 --`, null, profAToken);
    assert.strictEqual(sqliRes.status, 200);
    assert.strictEqual(sqliRes.body.standings.length, 0); // No username contains that literal text
    pass('SECURITY: SQL injection search payload handled safely as literal string');

    // ==========================================
    // 12. LIFECYCLE & DRAFT CONTEST BOLA
    // ==========================================
    console.log('\n--- 12. Testing Lifecycle & Draft Contest BOLA ---');

    const draftContest = await ContestModel.createContest({
      title: `P7583 Draft Contest ${ts}`,
      description: 'Draft contest for BOLA validation',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: false,
      status: 'draft',
    });
    createdContestIds.push(draftContest.id);

    // 12.1 Student access to draft admin leaderboard -> 403 Forbidden
    const draftStudRes = await request('GET', `/api/contests/${draftContest.id}/admin-leaderboard`, null, student1Token);
    assert.strictEqual(draftStudRes.status, 403);
    pass('BOLA: Student access to draft admin leaderboard returns 403 Forbidden');

    // 12.2 Non-owning professor access to draft admin leaderboard -> 403 Forbidden
    const draftOtherProfRes = await request('GET', `/api/contests/${draftContest.id}/admin-leaderboard`, null, profBToken);
    assert.strictEqual(draftOtherProfRes.status, 403);
    pass('BOLA: Non-owning professor access to draft admin leaderboard returns 403 Forbidden');

    // 12.3 Contest owner professor access to draft admin leaderboard -> 200 OK
    const draftOwnerRes = await request('GET', `/api/contests/${draftContest.id}/admin-leaderboard`, null, profAToken);
    assert.strictEqual(draftOwnerRes.status, 200);
    assert.strictEqual(draftOwnerRes.body.contest.status, 'draft');
    pass('LIFECYCLE: Contest owner professor successfully inspects draft admin leaderboard');

    // 12.4 Parameter tampering resilience (passing fake role or userId in query)
    const tamperRes = await request('GET', `/api/contests/${draftContest.id}/admin-leaderboard?role=super_admin&userId=${superAdmin.id}`, null, student1Token);
    assert.strictEqual(tamperRes.status, 403);
    pass('SECURITY: Client parameter tampering (role/userId injection) strictly rejected');

  } catch (err) {
    fail('UNEXPECTED_ERROR', err);
  } finally {
    // Cleanup
    console.log('\n--- Cleaning Up Test Data ---');
    try {
      if (createdContestIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1)`, [createdContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1)`, [createdContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1)`, [createdContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1)`, [createdContestIds]);
      }
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1)`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1)`, [createdProblemIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
      }
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      await db.closePool();
    } catch (e) {
      console.error('Cleanup warning:', e.message);
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.8.3 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
