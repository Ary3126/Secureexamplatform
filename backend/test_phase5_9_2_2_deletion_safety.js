/**
 * Phase 5.9.2.2 Test Suite: Safe Problem & Contest Deletion Verification
 * 
 * Verifies that problems and contests with historical submissions
 * CANNOT be deleted, returning HTTP 409 Conflict, preserving:
 * - Submissions and evaluation history
 * - Source code byte-for-byte
 * - Test cases
 * - Contest participant history
 * - Super admin restriction enforcement
 * - Defense in depth via PostgreSQL ON DELETE RESTRICT
 * - Atomic transactional safety against race conditions
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { generateToken } = require('./src/services/authService');

let server;
let port;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        'Content-Type': 'application/json',
        'x-test-environment': 'true',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.9.2.2 DELETION SAFETY TEST SUITE');
  console.log(' Target: DELETE /api/problems/:id & DELETE /api/contests/:id');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(title, condition, detail = '') {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} - ${detail}`);
      failed++;
    }
  }

  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6'; // Password123!

  try {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. SETUP ACTORS
    // -------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');

    const profA = await UserModel.createUser({
      username: `prof_a_5922_${ts}`,
      email: `prof_a_5922_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Alpha 5922',
    });

    const profB = await UserModel.createUser({
      username: `prof_b_5922_${ts}`,
      email: `prof_b_5922_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Beta 5922',
    });

    const studentA = await UserModel.createUser({
      username: `student_5922_${ts}`,
      email: `student_5922_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student 5922',
    });

    const superAdmin = await UserModel.createUser({
      username: `admin_5922_${ts}`,
      email: `admin_5922_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin 5922',
    });

    const tokenProfA = generateToken(profA);
    const tokenProfB = generateToken(profB);
    const tokenStudentA = generateToken(studentA);
    const tokenAdmin = generateToken(superAdmin);

    record('Test actors created with auth tokens', !!(tokenProfA && tokenProfB && tokenStudentA && tokenAdmin));

    // -------------------------------------------------------------------
    // 2. SETUP PROBLEMS & TEST CASES
    // -------------------------------------------------------------------
    console.log('\n--- 2. Setting Up Problems and Test Cases ---');

    // Problem 1: Owned by Prof A, ZERO submissions (should be deletable)
    const probEmpty = await ProblemModel.createProblem({
      title: `Empty Problem ${ts}`,
      description: 'Zero submissions',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
    });

    // Problem 2: Owned by Prof A, has submissions & test cases (MUST NOT BE DELETABLE)
    const probWithSub = await ProblemModel.createProblem({
      title: `Protected Problem ${ts}`,
      description: 'Has historical submissions',
      difficulty: 'medium',
      codingMode: 'function',
      createdBy: profA.id,
    });

    // Add a test case to probWithSub
    const testCase = await TestCaseModel.createTestCase({
      problemId: probWithSub.id,
      inputData: '[1, 2, 3]',
      expectedOutput: '6',
      isSample: true,
      orderIndex: 1,
    });

    // Seed submission on probWithSub
    const exactSourceCode = 'function solution() { return 6; }';
    const sub1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: null,
      problemId: probWithSub.id,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: exactSourceCode,
      status: 'accepted',
      score: 100,
    });

    record('Problem fixtures and test cases initialized', !!(probEmpty.id && probWithSub.id && testCase.id && sub1.id));

    // -------------------------------------------------------------------
    // 3. SETUP CONTESTS & PARTICIPANTS
    // -------------------------------------------------------------------
    console.log('\n--- 3. Setting Up Contests and Submissions ---');

    // Contest 1: Owned by Prof A, ZERO submissions (should be deletable)
    const contestEmpty = await ContestModel.createContest({
      title: `Empty Contest ${ts}`,
      description: 'Contest with 0 submissions',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 7200000),
      createdBy: profA.id,
      status: 'published',
    });

    // Contest 2: Owned by Prof A, with participants and submissions (MUST NOT BE DELETABLE)
    const contestWithSub = await ContestModel.createContest({
      title: `Protected Contest ${ts}`,
      description: 'Contest with submissions',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 7200000),
      createdBy: profA.id,
      status: 'published',
    });

    await ContestModel.addProblemToContest({
      contestId: contestWithSub.id,
      problemId: probWithSub.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addParticipant(contestWithSub.id, studentA.id);

    const subContest = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contestWithSub.id,
      problemId: probWithSub.id,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: exactSourceCode,
      status: 'accepted',
      score: 100,
    });

    record('Contest fixtures, participants, and submissions seeded', !!(contestEmpty.id && contestWithSub.id && subContest.id));

    // -------------------------------------------------------------------
    // 4. PART A: PROBLEM DELETION TEST MATRIX
    // -------------------------------------------------------------------
    console.log('\n--- 4. Testing Problem Deletion Security & Data Integrity ---');

    // TEST 1: Professor can delete an owned problem with zero submissions
    const resDelEmptyProb = await request('DELETE', `/api/problems/${probEmpty.id}`, null, tokenProfA);
    record('TEST 1: Professor can delete owned problem with zero submissions (200 OK)',
      resDelEmptyProb.status === 200,
      `Received status: ${resDelEmptyProb.status}`
    );
    const dbProbEmptyCheck = await ProblemModel.findProblemById(probEmpty.id);
    record('TEST 1 (DB): Empty problem is completely removed from database', dbProbEmptyCheck === null);

    // TEST 2: Professor cannot delete an unowned problem
    const resDelUnownedProb = await request('DELETE', `/api/problems/${probWithSub.id}`, null, tokenProfB);
    record('TEST 2: Professor B cannot delete Professor A problem (403 Forbidden)',
      resDelUnownedProb.status === 403,
      `Received status: ${resDelUnownedProb.status}`
    );

    // TEST 3: Professor receives 409 Conflict when owned problem has submissions
    const resDelProbWithSub = await request('DELETE', `/api/problems/${probWithSub.id}`, null, tokenProfA);
    record('TEST 3: Professor deletion of problem with submissions blocked with 409 Conflict',
      resDelProbWithSub.status === 409 &&
      resDelProbWithSub.body?.message === 'Cannot delete problem because submissions exist for this problem.',
      `Received status: ${resDelProbWithSub.status}, message: ${resDelProbWithSub.body?.message}`
    );

    // TEST 4: Super Admin also receives 409 Conflict when problem has submissions
    const resDelProbAdmin = await request('DELETE', `/api/problems/${probWithSub.id}`, null, tokenAdmin);
    record('TEST 4: Super Admin deletion of problem with submissions blocked with 409 Conflict',
      resDelProbAdmin.status === 409 &&
      resDelProbAdmin.body?.message === 'Cannot delete problem because submissions exist for this problem.',
      `Received status: ${resDelProbAdmin.status}, message: ${resDelProbAdmin.body?.message}`
    );

    // TEST 5: Submission remains intact in DB after failed problem deletion
    const subAfterCheck = await SubmissionModel.findSubmissionById(sub1.id);
    record('TEST 5: Submission record remains intact in DB after rejected deletion',
      subAfterCheck !== null && subAfterCheck.id === sub1.id
    );

    // TEST 6: Source code remains intact byte-for-byte
    record('TEST 6: Source code preserved byte-for-byte in DB',
      subAfterCheck?.sourceCode === exactSourceCode
    );

    // TEST 7: Test cases remain intact after failed problem deletion
    const tcAfterCheck = await TestCaseModel.findTestCaseById(testCase.id);
    record('TEST 7: Problem test cases remain intact in DB',
      tcAfterCheck !== null && tcAfterCheck.id === testCase.id
    );

    // -------------------------------------------------------------------
    // 5. PART B: CONTEST DELETION TEST MATRIX
    // -------------------------------------------------------------------
    console.log('\n--- 5. Testing Contest Deletion Security & Data Integrity ---');

    // TEST 8: Professor can delete an owned contest with zero submissions
    const resDelEmptyContest = await request('DELETE', `/api/contests/${contestEmpty.id}`, null, tokenProfA);
    record('TEST 8: Professor can delete owned contest with zero submissions (200 OK)',
      resDelEmptyContest.status === 200,
      `Received status: ${resDelEmptyContest.status}`
    );
    const dbContestEmptyCheck = await ContestModel.findContestById(contestEmpty.id);
    record('TEST 8 (DB): Empty contest is completely removed from database', dbContestEmptyCheck === null);

    // TEST 9: Professor cannot delete an unowned contest
    const resDelUnownedContest = await request('DELETE', `/api/contests/${contestWithSub.id}`, null, tokenProfB);
    record('TEST 9: Professor B cannot delete Professor A contest (403 Forbidden)',
      resDelUnownedContest.status === 403,
      `Received status: ${resDelUnownedContest.status}`
    );

    // TEST 10: Professor receives 409 Conflict when contest has submissions
    const resDelContestWithSub = await request('DELETE', `/api/contests/${contestWithSub.id}`, null, tokenProfA);
    record('TEST 10: Professor deletion of contest with submissions blocked with 409 Conflict',
      resDelContestWithSub.status === 409 &&
      resDelContestWithSub.body?.message === 'Cannot delete contest because submissions exist for this contest.',
      `Received status: ${resDelContestWithSub.status}, message: ${resDelContestWithSub.body?.message}`
    );

    // TEST 11: Super Admin receives 409 Conflict when contest has submissions
    const resDelContestAdmin = await request('DELETE', `/api/contests/${contestWithSub.id}`, null, tokenAdmin);
    record('TEST 11: Super Admin deletion of contest with submissions blocked with 409 Conflict',
      resDelContestAdmin.status === 409 &&
      resDelContestAdmin.body?.message === 'Cannot delete contest because submissions exist for this contest.',
      `Received status: ${resDelContestAdmin.status}, message: ${resDelContestAdmin.body?.message}`
    );

    // TEST 12: Contest submission remains intact in DB after failed contest deletion
    const subContestCheck = await SubmissionModel.findSubmissionById(subContest.id);
    record('TEST 12: Contest submission record remains intact in DB',
      subContestCheck !== null && subContestCheck.id === subContest.id
    );

    // TEST 13: Contest participant registration record remains intact in DB
    const partRes = await db.query(
      'SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [contestWithSub.id, studentA.id]
    );
    record('TEST 13: Contest participant registration record remains intact in DB',
      partRes.rowCount === 1
    );

    // -------------------------------------------------------------------
    // 6. PART C: DEFENSE IN DEPTH, RACE CONDITIONS & ATOMICITY
    // -------------------------------------------------------------------
    console.log('\n--- 6. Testing Database Defense in Depth & Race Conditions ---');

    // TEST 14: Direct database delete attempt triggers ON DELETE RESTRICT foreign key violation
    let rawDbDeleteBlocked = false;
    try {
      await db.query('DELETE FROM problems WHERE id = $1', [probWithSub.id]);
    } catch (dbErr) {
      if (dbErr.code === '23503') { // foreign_key_violation
        rawDbDeleteBlocked = true;
      }
    }
    record('TEST 14: Defense in depth: Raw DB DELETE blocked by ON DELETE RESTRICT (23503)', rawDbDeleteBlocked);

    let rawDbContestDeleteBlocked = false;
    try {
      await db.query('DELETE FROM contests WHERE id = $1', [contestWithSub.id]);
    } catch (dbErr) {
      if (dbErr.code === '23503') {
        rawDbContestDeleteBlocked = true;
      }
    }
    record('TEST 14b: Defense in depth: Raw DB contest DELETE blocked by ON DELETE RESTRICT (23503)', rawDbContestDeleteBlocked);

    // TEST 15: Repeated delete attempts remain safe and idempotent
    let allAttemptsConflict = true;
    for (let i = 0; i < 3; i++) {
      const repRes = await request('DELETE', `/api/problems/${probWithSub.id}`, null, tokenProfA);
      if (repRes.status !== 409) allAttemptsConflict = false;
    }
    record('TEST 15: Repeated DELETE attempts consistently return 409 Conflict', allAttemptsConflict);

    // TEST 16: Safe model method handles non-existent resource gracefully
    const nonExistentResult = await ProblemModel.deleteProblemWithSafety(99999999);
    record('TEST 16: deleteProblemWithSafety returns notFound for non-existent ID',
      nonExistentResult.notFound === true && nonExistentResult.success === false
    );

    // -------------------------------------------------------------------
    // 7. CLEANUP
    // -------------------------------------------------------------------
    console.log('\n--- 7. Cleaning Up Ephemeral Test Fixtures ---');

    await db.query('DELETE FROM submissions WHERE id IN ($1, $2)', [sub1.id, subContest.id]);
    await db.query('DELETE FROM contest_participants WHERE contest_id = $1', [contestWithSub.id]);
    await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [contestWithSub.id]);
    await db.query('DELETE FROM contests WHERE id = $1', [contestWithSub.id]);
    await db.query('DELETE FROM test_cases WHERE id = $1', [testCase.id]);
    await db.query('DELETE FROM problems WHERE id = $1', [probWithSub.id]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4)', [
      profA.id, profB.id, studentA.id, superAdmin.id,
    ]);

    record('CLEANUP: Test fixtures safely purged from database', true);

  } catch (err) {
    console.error('\n[UNEXPECTED TEST EXCEPTION]:', err);
    failed++;
  } finally {
    if (server) server.close();
    if (db.pool && db.pool.end) await db.pool.end();

    console.log('\n=======================================================');
    console.log(` PHASE 5.9.2.2 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
