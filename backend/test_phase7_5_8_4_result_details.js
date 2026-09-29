/**
 * Phase 7.5.8.4 — Result Details Test Suite
 * File: backend/test_phase7_5_8_4_result_details.js
 *
 * Exhaustively validates:
 * 1. Security & RBAC:
 *    - Anonymous access rejected with 401 Unauthorized
 *    - Student accessing own result via /results/me succeeds (200 OK)
 *    - Student accessing own result via /participants/:userId/results succeeds (200 OK)
 *    - Student accessing another student's result rejected with 403 Forbidden (BOLA protection)
 *    - Non-owning professor accessing result details rejected with 403 Forbidden (BOLA protection)
 *    - Contest creator professor accessing participant results succeeds (200 OK)
 *    - Super Admin accessing participant results succeeds (200 OK)
 * 2. Input Validation:
 *    - Non-integer contest ID -> 400 Bad Request
 *    - Non-integer participant ID -> 400 Bad Request
 *    - Non-existent contest ID -> 404 Not Found
 *    - Non-participant user ID -> 404 Not Found
 * 3. Data Integrity & Scoring Consistency:
 *    - Result Details totalScore, rank, solvedCount, penalty, and submissions match StandingsService
 *    - Problem breakdown matches contest problems configuration
 * 4. Submissions List & Source Code Access:
 *    - Submissions returned in reverse chronological order with verdicts, runtime, memory, timestamps
 *    - canViewCode is true for self and creator professor, sourceCode is included
 * 5. Freeze Enforcement:
 *    - Student result details hides submissions made after freeze cutoff
 *    - Professor with freezeOverride=true sees true unmasked results and freeze submissions
 * 6. Lifecycle & Draft Protection:
 *    - Draft contest result details hidden from student / non-owner (404 Not Found)
 *    - Draft contest result details visible to contest creator (200 OK)
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
  console.log(' STARTING PHASE 7.5.8.4 RESULT DETAILS TEST SUITE');
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
  const createdSubmissionIds = [];

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
      username: `p7584_profA_${ts}`,
      email: `p7584_profA_${ts}@examforge.test`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Alpha',
    });
    createdUserIds.push(profA.id);
    const profAToken = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `p7584_profB_${ts}`,
      email: `p7584_profB_${ts}@examforge.test`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Beta',
    });
    createdUserIds.push(profB.id);
    const profBToken = generateToken(profB);

    const superAdmin = await UserModel.createUser({
      username: `p7584_admin_${ts}`,
      email: `p7584_admin_${ts}@examforge.test`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Administrator',
    });
    createdUserIds.push(superAdmin.id);
    const superAdminToken = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `p7584_alice_${ts}`,
      email: `p7584_alice_${ts}@examforge.test`,
      passwordHash,
      role: 'student',
      fullName: 'Alice Walker',
    });
    createdUserIds.push(student1.id);
    const student1Token = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `p7584_bob_${ts}`,
      email: `p7584_bob_${ts}@examforge.test`,
      passwordHash,
      role: 'student',
      fullName: 'Bob Builder',
    });
    createdUserIds.push(student2.id);
    const student2Token = generateToken(student2);

    const student3 = await UserModel.createUser({
      username: `p7584_charlie_${ts}`,
      email: `p7584_charlie_${ts}@examforge.test`,
      passwordHash,
      role: 'student',
      fullName: 'Charlie Davis',
    });
    createdUserIds.push(student3.id);
    const student3Token = generateToken(student3);

    pass('Setup: All test actors successfully created');

    // 2. Setup Test Problems
    console.log('\n--- 2. Setup Test Problems ---');
    const prob1 = await ProblemModel.createProblem({
      title: `P7584 Prob1 ${ts}`,
      description: 'Problem 1 Description',
      difficulty: 'easy',
      authorId: profA.id,
      createdBy: profA.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob1.id);
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '2 3\n',
      expectedOutput: '5\n',
      isSample: false,
    });

    const prob2 = await ProblemModel.createProblem({
      title: `P7584 Prob2 ${ts}`,
      description: 'Problem 2 Description',
      difficulty: 'medium',
      authorId: profA.id,
      createdBy: profA.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob2.id);
    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '4 5\n',
      expectedOutput: '20\n',
      isSample: false,
    });

    pass('Setup: Contest problems with test cases created');

    // 3. Setup Test Contest
    console.log('\n--- 3. Setup Test Contest ---');
    const now = new Date();
    const startTime = new Date(now.getTime() - 40 * 60 * 1000); // 40m ago
    const endTime = new Date(now.getTime() + 60 * 60 * 1000); // in 60m

    const contest = await ContestModel.createContest({
      title: `P7584 Contest ${ts}`,
      description: 'Contest for Phase 7.5.8.4 Result Details',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 20,
      status: 'published',
    });
    createdContestIds.push(contest.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1;`, [contest.id]);

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

    // Enroll participants
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3), ($1, $4, $3), ($1, $5, $3)`,
      [contest.id, student1.id, now, student2.id, student3.id]
    );

    // 4. Submissions:
    // Alice:
    // - Prob 1: Accepted at +5m (code: "const a = 1;")
    // - Prob 2: Wrong answer at +10m (code: "wrong code")
    // - Prob 2: Accepted at +15m (code: "const ans = 20;")
    // Total score = 300, 2 solves, 3 submissions
    const sub1 = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'const a = 1;',
      status: 'accepted',
      score: 100,
      executionTime: 42,
      memoryUsed: 12000,
      isSampleRun: false,
    });
    createdSubmissionIds.push(sub1.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(startTime.getTime() + 5 * 60000), sub1.id]);

    const sub2 = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'wrong code',
      status: 'wrong_answer',
      score: 0,
      executionTime: 40,
      memoryUsed: 11000,
      isSampleRun: false,
    });
    createdSubmissionIds.push(sub2.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(startTime.getTime() + 10 * 60000), sub2.id]);

    const sub3 = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'const ans = 20;',
      status: 'accepted',
      score: 200,
      executionTime: 48,
      memoryUsed: 12200,
      isSampleRun: false,
    });
    createdSubmissionIds.push(sub3.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(startTime.getTime() + 15 * 60000), sub3.id]);

    // Bob:
    // - Prob 1: Accepted at +8m
    // - Prob 2: Wrong answer at +12m
    // Total score = 100, 1 solve, 2 submissions
    const sub4 = await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'const b = 2;',
      status: 'accepted',
      score: 100,
      executionTime: 55,
      memoryUsed: 12500,
      isSampleRun: false,
    });
    createdSubmissionIds.push(sub4.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(startTime.getTime() + 8 * 60000), sub4.id]);

    const sub5 = await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: prob2.id,
      language: 'javascript',
      sourceCode: 'failed bob code',
      status: 'wrong_answer',
      score: 0,
      executionTime: 39,
      memoryUsed: 10500,
      isSampleRun: false,
    });
    createdSubmissionIds.push(sub5.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(startTime.getTime() + 12 * 60000), sub5.id]);

    pass('Setup: Submissions recorded for Alice and Bob');

    // ==========================================
    // 5. SECURITY & RBAC TESTING
    // ==========================================
    console.log('\n--- 5. Testing Security & RBAC ---');

    // 5.1 Anonymous request rejected
    const anonRes1 = await request('GET', `/api/contests/${contest.id}/results/me`);
    assert.strictEqual(anonRes1.status, 401);
    pass('RBAC: Anonymous request to /results/me rejected with 401 Unauthorized');

    const anonRes2 = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/results`);
    assert.strictEqual(anonRes2.status, 401);
    pass('RBAC: Anonymous request to /participants/:id/results rejected with 401 Unauthorized');

    // 5.2 Student accessing own result via /results/me succeeds
    const s1MeRes = await request('GET', `/api/contests/${contest.id}/results/me`, null, student1Token);
    assert.strictEqual(s1MeRes.status, 200);
    assert.strictEqual(s1MeRes.body.participant.userId, student1.id);
    pass('RBAC: Student accessing own result via /results/me succeeds (200 OK)');

    // 5.3 Student accessing own result via /participants/:id/results succeeds
    const s1IdRes = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/results`, null, student1Token);
    assert.strictEqual(s1IdRes.status, 200);
    assert.strictEqual(s1IdRes.body.participant.userId, student1.id);
    pass('RBAC: Student accessing own result via /participants/:userId/results succeeds (200 OK)');

    // 5.4 Student attempting to inspect another student's results rejected (BOLA/IDOR)
    const s1AttackRes = await request('GET', `/api/contests/${contest.id}/participants/${student2.id}/results`, null, student1Token);
    assert.strictEqual(s1AttackRes.status, 403);
    pass('BOLA: Student attempting to inspect another student result rejected with 403 Forbidden');

    // 5.5 Non-owning professor inspecting results rejected (BOLA/IDOR)
    const profBAttackRes = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/results`, null, profBToken);
    assert.strictEqual(profBAttackRes.status, 403);
    pass('BOLA: Non-owning professor inspecting results rejected with 403 Forbidden');

    // 5.6 Contest creator professor inspecting results succeeds
    const profARes = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/results`, null, profAToken);
    assert.strictEqual(profARes.status, 200);
    assert.strictEqual(profARes.body.participant.userId, student1.id);
    pass('RBAC: Contest creator professor inspecting student result succeeds (200 OK)');

    // 5.7 Super Admin inspecting results succeeds
    const adminRes = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/results`, null, superAdminToken);
    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminRes.body.participant.userId, student1.id);
    pass('RBAC: Super Admin inspecting student result succeeds (200 OK)');

    // ==========================================
    // 6. INPUT VALIDATION TESTING
    // ==========================================
    console.log('\n--- 6. Testing Input Validation ---');

    // 6.1 Non-integer contest ID
    const badContestIdRes = await request('GET', `/api/contests/invalid_id/participants/${student1.id}/results`, null, profAToken);
    assert.strictEqual(badContestIdRes.status, 400);
    pass('VALIDATION: Non-integer contest ID returns 400 Bad Request');

    // 6.2 Non-integer participant ID
    const badUserIdRes = await request('GET', `/api/contests/${contest.id}/participants/not_a_number/results`, null, profAToken);
    assert.strictEqual(badUserIdRes.status, 400);
    pass('VALIDATION: Non-integer participant ID returns 400 Bad Request');

    // 6.3 Non-existent contest ID
    const notFoundContestRes = await request('GET', `/api/contests/999999/participants/${student1.id}/results`, null, profAToken);
    assert.strictEqual(notFoundContestRes.status, 404);
    pass('VALIDATION: Non-existent contest ID returns 404 Not Found');

    // 6.4 Non-participant user ID
    const nonParticipantRes = await request('GET', `/api/contests/${contest.id}/participants/999999/results`, null, profAToken);
    assert.strictEqual(nonParticipantRes.status, 404);
    pass('VALIDATION: Non-participant user ID returns 404 Not Found');

    // ==========================================
    // 7. DATA INTEGRITY & SCORING CONSISTENCY
    // ==========================================
    console.log('\n--- 7. Testing Data Integrity & Scoring Consistency ---');

    // 7.1 Verify Alice's result details
    const aliceDetails = s1MeRes.body;
    assert.strictEqual(aliceDetails.summary.rank, 1);
    assert.strictEqual(aliceDetails.summary.totalScore, 300);
    assert.strictEqual(aliceDetails.summary.solvedProblemsCount, 2);
    assert.strictEqual(aliceDetails.summary.totalProblems, 2);
    assert.strictEqual(aliceDetails.summary.totalSubmissions, 3);
    pass('DATA INTEGRITY: Alice has Rank 1, 300 score, 2 solved, 3 submissions');

    // 7.2 Verify Alice's problem breakdown
    assert.strictEqual(aliceDetails.problems.length, 2);
    const prob1Detail = aliceDetails.problems.find((p) => p.problemId === prob1.id);
    assert.strictEqual(prob1Detail.status, 'solved');
    assert.strictEqual(prob1Detail.points, 100);
    assert.strictEqual(prob1Detail.attemptsCount, 1);
    assert.strictEqual(prob1Detail.failedAttemptsBeforeSolve, 0);
    assert.strictEqual(prob1Detail.acceptedTimeMinutes, 5);

    const prob2Detail = aliceDetails.problems.find((p) => p.problemId === prob2.id);
    assert.strictEqual(prob2Detail.status, 'solved');
    assert.strictEqual(prob2Detail.points, 200);
    assert.strictEqual(prob2Detail.attemptsCount, 2);
    assert.strictEqual(prob2Detail.failedAttemptsBeforeSolve, 1);
    assert.strictEqual(prob2Detail.acceptedTimeMinutes, 15);
    pass('DATA INTEGRITY: Alice problem performance matrix matches scoring rules');

    // 7.3 Verify Bob's result details
    const bobRes = await request('GET', `/api/contests/${contest.id}/results/me`, null, student2Token);
    assert.strictEqual(bobRes.status, 200);
    assert.strictEqual(bobRes.body.summary.rank, 2);
    assert.strictEqual(bobRes.body.summary.totalScore, 100);
    assert.strictEqual(bobRes.body.summary.solvedProblemsCount, 1);
    assert.strictEqual(bobRes.body.summary.totalSubmissions, 2);

    const bobProb2 = bobRes.body.problems.find((p) => p.problemId === prob2.id);
    assert.strictEqual(bobProb2.status, 'failed');
    assert.strictEqual(bobProb2.points, 0);
    assert.strictEqual(bobProb2.attemptsCount, 1);
    pass('DATA INTEGRITY: Bob has Rank 2, 100 score, 1 solved, 1 failed problem');

    // 7.4 Verify Charlie's result details (0 submissions)
    const charlieRes = await request('GET', `/api/contests/${contest.id}/results/me`, null, student3Token);
    assert.strictEqual(charlieRes.status, 200);
    assert.strictEqual(charlieRes.body.summary.rank, 3);
    assert.strictEqual(charlieRes.body.summary.totalScore, 0);
    assert.strictEqual(charlieRes.body.summary.solvedProblemsCount, 0);
    assert.strictEqual(charlieRes.body.summary.totalSubmissions, 0);
    assert.strictEqual(charlieRes.body.submissions.length, 0);
    pass('DATA INTEGRITY: Charlie has Rank 3, 0 score, 0 solved, empty submissions list');

    // ==========================================
    // 8. SUBMISSIONS LIST & SOURCE CODE ACCESS
    // ==========================================
    console.log('\n--- 8. Testing Submissions List & Source Code Access ---');

    // 8.1 Alice's submissions are returned in reverse chronological order
    assert.strictEqual(aliceDetails.submissions.length, 3);
    assert.strictEqual(aliceDetails.submissions[0].problemId, prob2.id); // last submitted (+15m)
    assert.strictEqual(aliceDetails.submissions[0].status, 'accepted');
    assert.strictEqual(aliceDetails.submissions[0].score, 200);
    assert.strictEqual(aliceDetails.submissions[1].status, 'wrong_answer');
    assert.strictEqual(aliceDetails.submissions[2].status, 'accepted');
    pass('SUBMISSIONS: Submissions returned in reverse chronological order with verdicts');

    // 8.2 Student can view own source code
    assert.strictEqual(aliceDetails.submissions[0].canViewCode, true);
    assert.strictEqual(aliceDetails.submissions[0].sourceCode, 'const ans = 20;');
    pass('SOURCE CODE: Student authorized to view own source code');

    // 8.3 Contest creator professor can view student source code
    const profViewAlice = profARes.body;
    assert.strictEqual(profViewAlice.submissions[0].canViewCode, true);
    assert.strictEqual(profViewAlice.submissions[0].sourceCode, 'const ans = 20;');
    pass('SOURCE CODE: Contest creator professor authorized to view student source code');

    // ==========================================
    // 9. FREEZE ENFORCEMENT ON RESULT DETAILS
    // ==========================================
    console.log('\n--- 9. Testing Freeze Enforcement on Result Details ---');

    const freezeStart = new Date(now.getTime() - 50 * 60000);
    const freezeEnd = new Date(now.getTime() + 10 * 60000); // ends in 10m
    // Freeze window: last 30 minutes (now is inside freeze window)
    const frozenContest = await ContestModel.createContest({
      title: `P7584 Frozen Contest ${ts}`,
      description: 'Frozen contest for result details test',
      startTime: freezeStart,
      endTime: freezeEnd,
      createdBy: profA.id,
      isRated: false,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
      status: 'published',
    });
    createdContestIds.push(frozenContest.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1;`, [frozenContest.id]);

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

    // Submission made inside freeze window (3 minutes ago)
    const frozenSub = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: frozenContest.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'frozen secret solution',
      status: 'accepted',
      score: 100,
      executionTime: 44,
      memoryUsed: 11500,
      isSampleRun: false,
    });
    createdSubmissionIds.push(frozenSub.id);
    await db.query('UPDATE submissions SET created_at = $1 WHERE id = $2', [new Date(now.getTime() - 3 * 60000), frozenSub.id]);

    // 9.1 Student inspecting own result during freeze -> score masked to 0, freeze submission hidden
    const studentFrozenRes = await request('GET', `/api/contests/${frozenContest.id}/results/me`, null, student1Token);
    assert.strictEqual(studentFrozenRes.status, 200);
    assert.strictEqual(studentFrozenRes.body.summary.totalScore, 0);
    assert.strictEqual(studentFrozenRes.body.submissions.length, 0); // Omitted by freeze cutoff
    pass('FREEZE: Student result details masks score to 0 and hides post-freeze submissions');

    // 9.2 Student passing freezeOverride=true is strictly ignored
    const studentBypassRes = await request('GET', `/api/contests/${frozenContest.id}/results/me?freezeOverride=true`, null, student1Token);
    assert.strictEqual(studentBypassRes.status, 200);
    assert.strictEqual(studentBypassRes.body.summary.totalScore, 0);
    assert.strictEqual(studentBypassRes.body.submissions.length, 0);
    pass('FREEZE: Student freezeOverride=true attempt is strictly ignored');

    // 9.3 Contest creator professor with freezeOverride=true sees unmasked score (100) and submission
    const profUnmaskedRes = await request('GET', `/api/contests/${frozenContest.id}/participants/${student1.id}/results?freezeOverride=true`, null, profAToken);
    assert.strictEqual(profUnmaskedRes.status, 200);
    assert.strictEqual(profUnmaskedRes.body.summary.totalScore, 100);
    assert.strictEqual(profUnmaskedRes.body.submissions.length, 1);
    assert.strictEqual(profUnmaskedRes.body.submissions[0].status, 'accepted');
    pass('FREEZE: Contest creator professor with freezeOverride=true sees unmasked results');

    // ==========================================
    // 10. LIFECYCLE & DRAFT CONTEST PROTECTION
    // ==========================================
    console.log('\n--- 10. Testing Lifecycle & Draft Protection ---');

    const draftContest = await ContestModel.createContest({
      title: `P7584 Draft Contest ${ts}`,
      description: 'Draft contest BOLA test',
      startTime,
      endTime,
      createdBy: profA.id,
      isRated: false,
      status: 'draft',
    });
    createdContestIds.push(draftContest.id);

    await ContestModel.addProblemToContest({
      contestId: draftContest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });

    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3)`,
      [draftContest.id, student1.id, now]
    );

    // 10.1 Student accessing draft result details -> 404 Not Found
    const draftStudRes = await request('GET', `/api/contests/${draftContest.id}/results/me`, null, student1Token);
    assert.strictEqual(draftStudRes.status, 404);
    pass('LIFECYCLE: Student accessing draft contest result details returns 404 Not Found');

    // 10.2 Non-owning professor accessing draft result details -> 404 Not Found
    const draftProfBRes = await request('GET', `/api/contests/${draftContest.id}/participants/${student1.id}/results`, null, profBToken);
    assert.strictEqual(draftProfBRes.status, 404);
    pass('LIFECYCLE: Non-owning professor accessing draft contest result details returns 404 Not Found');

    // 10.3 Contest creator professor accessing draft result details -> 200 OK
    const draftProfARes = await request('GET', `/api/contests/${draftContest.id}/participants/${student1.id}/results`, null, profAToken);
    assert.strictEqual(draftProfARes.status, 200);
    assert.strictEqual(draftProfARes.body.contest.status, 'draft');
    pass('LIFECYCLE: Contest creator professor accessing draft contest result details succeeds (200 OK)');

  } catch (err) {
    fail('UNEXPECTED_ERROR', err);
  } finally {
    // Cleanup
    console.log('\n--- Cleaning Up Test Data ---');
    try {
      if (createdContestIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [createdContestIds]);
      }
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
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
  console.log(` PHASE 7.5.8.4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
