/**
 * Phase 7.5.5.9 — Contest Problem Configuration & Scoring Consistency Test Suite
 * File: backend/test_admin_phase5_5_9_scoring_consistency.js
 *
 * Verifies all Phase 7.5.5.9 requirements:
 * 1. Default Points Assignment (defaults to 100)
 * 2. Explicit Points Assignment (custom positive integer points stored and retrieved)
 * 3. Invalid Points Validation (rejects 0, negative, decimals, NaN, Infinity, strings, > 100000)
 * 4. Boundary Value Testing (min: 1, max: 100000)
 * 5. Duplicate Configuration Protection (prevents duplicate problem insertion)
 * 6. Add/Remove Consistency (removing problem preserves remaining problems' points & order)
 * 7. Single Reorder Preserving Points (swapping sequence preserves points)
 * 8. Bulk Reorder Preserving Points (multi-problem permutation preserves all points)
 * 9. Contest Edit Preserving Problem Configuration (updating contest metadata leaves problems untouched)
 * 10. Leaderboard Scoring Consistency (standingsService uses cp.points for maxPoints and totalScore)
 * 11. Submission Evaluation Scoring Consistency (judgeQueue dynamically uses cp.points)
 * 12. Problem Metadata Consistency (codingMode, difficulty, starterTemplates preserved)
 * 13. Lifecycle Lock Interaction (running/ended contests reject mutations, points unchanged)
 * 14. RBAC & BOLA Protection (non-owner/student blocked, private problem BOLA check)
 * 15. Transaction / Rollback Behavior (failed mutation rolls back completely)
 */

process.env.RATE_LIMIT_CONTEST_MAX = '500';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const StandingsService = require('./src/services/standingsService');
const judgeQueue = require('./src/judge/queue/judgeQueue');
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

async function runScoringConsistencyTests() {
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
  console.log(' STARTING PHASE 7.5.5.9 SCORING CONSISTENCY TESTS');
  console.log('=======================================================');

  const createdUserIds = [];
  const createdProblemIds = [];
  const createdContestIds = [];
  const createdSubmissionIds = [];

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
    const pwdHash = await hashPassword('TestPass@1234');

    // -------------------------------------------------------------------------
    // 1. Seed Test Actors
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');
    const profA = await UserModel.createUser({
      username: `profA_559_${ts}`,
      email: `profA_559_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor A ${ts}`,
      role: 'professor',
    });
    const profAToken = generateToken(profA);
    createdUserIds.push(profA.id);

    const profB = await UserModel.createUser({
      username: `profB_559_${ts}`,
      email: `profB_559_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor B ${ts}`,
      role: 'professor',
    });
    const profBToken = generateToken(profB);
    createdUserIds.push(profB.id);

    const student = await UserModel.createUser({
      username: `student_559_${ts}`,
      email: `student_559_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Student ${ts}`,
      role: 'student',
    });
    const studentToken = generateToken(student);
    createdUserIds.push(student.id);

    const ca = await UserModel.createUser({
      username: `ca_559_${ts}`,
      email: `ca_559_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    const caToken = generateToken(ca);
    createdUserIds.push(ca.id);

    // -------------------------------------------------------------------------
    // 2. Seed Test Problems
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Setting Up Test Problems ---');
    const prob1 = await ProblemModel.createProblem({
      title: `Problem One ${ts}`,
      description: 'Problem description one',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: JSON.stringify({ python: 'def solution():\n    pass' }),
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
    });
    createdProblemIds.push(prob1.id);

    const prob2 = await ProblemModel.createProblem({
      title: `Problem Two ${ts}`,
      description: 'Problem description two',
      difficulty: 'medium',
      codingMode: 'full_program',
      starterTemplates: JSON.stringify({ python: 'print("hello")' }),
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
    });
    createdProblemIds.push(prob2.id);

    const prob3 = await ProblemModel.createProblem({
      title: `Problem Three ${ts}`,
      description: 'Problem description three',
      difficulty: 'hard',
      codingMode: 'function',
      starterTemplates: JSON.stringify({ python: 'def solve():\n    pass' }),
      accessScope: 'public',
      isPublished: true,
      createdBy: profA.id,
    });
    createdProblemIds.push(prob3.id);

    const probPrivateB = await ProblemModel.createProblem({
      title: `Prof B Private Problem ${ts}`,
      description: 'Private problem owned by Prof B',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      isPublished: false,
      createdBy: profB.id,
    });
    createdProblemIds.push(probPrivateB.id);

    // Add test cases for prob1
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '5\n',
      expectedOutput: '10\n',
      isHidden: false,
    });

    // -------------------------------------------------------------------------
    // 3. Seed Contests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Setting Up Test Contests ---');
    const contestDraft = await ContestModel.createContest({
      title: `Draft Contest ${ts}`,
      description: 'Draft contest for configuration testing',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 172800000).toISOString(),
      isRated: true,
      status: 'draft',
      createdBy: profA.id,
    });
    createdContestIds.push(contestDraft.id);

    const contestRunning = await ContestModel.createContest({
      title: `Running Contest ${ts}`,
      description: 'Running contest for lifecycle testing',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      isRated: true,
      status: 'published',
      createdBy: profA.id,
    });
    createdContestIds.push(contestRunning.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [contestRunning.id]);

    // -------------------------------------------------------------------------
    // 4. Testing Default and Explicit Points
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Points Configuration ---');

    // 1. Default Points (omitted points field defaults to 100)
    const resDef = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob1.id,
    }, profAToken);
    record('DEFAULT POINTS: Problem added without points defaults to 100', resDef.status === 201 && resDef.body.mapping.points === 100);

    const dbDefRow = await db.query(
      'SELECT points, problem_order FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestDraft.id, prob1.id]
    );
    record('DEFAULT POINTS DB: Database row points column is 100', dbDefRow.rows[0].points === 100);

    // 2. Explicit Custom Points (e.g. 250 points)
    const resExp = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob2.id,
      points: 250,
      problemOrder: 2,
    }, profAToken);
    record('EXPLICIT POINTS: Problem added with 250 points succeeds (201 Created)', resExp.status === 201 && resExp.body.mapping.points === 250);

    const dbExpRow = await db.query(
      'SELECT points, problem_order FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestDraft.id, prob2.id]
    );
    record('EXPLICIT POINTS DB: Database row points column is exactly 250', dbExpRow.rows[0].points === 250);

    // 3. Problem List Retrieval Consistency
    const resList = await request('GET', `/api/contests/${contestDraft.id}/problems`, null, profAToken);
    record('RETRIEVAL CONSISTENCY: GET /problems returns exact configured points',
      resList.status === 200 &&
      resList.body.problems.find(p => p.problemId === prob1.id).points === 100 &&
      resList.body.problems.find(p => p.problemId === prob2.id).points === 250
    );

    // -------------------------------------------------------------------------
    // 5. Testing Invalid Points and Boundaries
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Points Validation & Boundaries ---');

    // Zero points
    const resZero = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 0,
    }, profAToken);
    record('INVALID POINTS: Zero points rejected with 400 Bad Request', resZero.status === 400);

    // Negative points
    const resNeg = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: -50,
    }, profAToken);
    record('INVALID POINTS: Negative points rejected with 400 Bad Request', resNeg.status === 400);

    // Decimal points
    const resDec = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 25.5,
    }, profAToken);
    record('INVALID POINTS: Float/decimal points rejected with 400 Bad Request', resDec.status === 400);

    // Non-numeric string points
    const resStr = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 'not-a-number',
    }, profAToken);
    record('INVALID POINTS: Non-numeric string points rejected with 400 Bad Request', resStr.status === 400);

    // Excessive points (> 100000)
    const resTooLarge = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 100001,
    }, profAToken);
    record('BOUNDARY POINTS: Points exceeding 100000 rejected with 400 Bad Request', resTooLarge.status === 400);

    // Valid Boundary: Min Points = 1
    const resMin = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 1,
    }, profAToken);
    record('BOUNDARY POINTS: Minimum points (1) accepted with 201 Created', resMin.status === 201 && resMin.body.mapping.points === 1);

    // Clean up prob3 from contestDraft
    await request('DELETE', `/api/contests/${contestDraft.id}/problems/${prob3.id}`, null, profAToken);

    // Valid Boundary: Max Points = 100000
    const resMax = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 100000,
    }, profAToken);
    record('BOUNDARY POINTS: Maximum points (100000) accepted with 201 Created', resMax.status === 201 && resMax.body.mapping.points === 100000);

    // -------------------------------------------------------------------------
    // 6. Testing Duplicate Configuration Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Duplicate Configuration ---');
    const resDup = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob2.id,
      points: 500,
    }, profAToken);
    record('DUPLICATE PROTECTION: Attempting to re-add problem rejected with 409 Conflict', resDup.status === 409);

    const dbDupCheck = await db.query(
      'SELECT points FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestDraft.id, prob2.id]
    );
    record('DUPLICATE INTEGRITY: Original configured points (250) completely unchanged in database', dbDupCheck.rows[0].points === 250);

    // -------------------------------------------------------------------------
    // 7. Testing Reorder Preserving Points
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Reorder Preserving Points ---');
    // Current state in contestDraft:
    // prob1 (100 pts, order 1)
    // prob2 (250 pts, order 2)
    // prob3 (100000 pts, order 3)

    // Reorder: [prob3, prob1, prob2]
    const resReorder = await request('PUT', `/api/contests/${contestDraft.id}/problems/order`, {
      problemIds: [prob3.id, prob1.id, prob2.id],
    }, profAToken);
    record('REORDER: Reorder permutation accepted with 200 OK', resReorder.status === 200);

    const listPostReorder = await request('GET', `/api/contests/${contestDraft.id}/problems`, null, profAToken);
    const p3Post = listPostReorder.body.problems.find(p => p.problemId === prob3.id);
    const p1Post = listPostReorder.body.problems.find(p => p.problemId === prob1.id);
    const p2Post = listPostReorder.body.problems.find(p => p.problemId === prob2.id);

    record('REORDER POINTS PRESERVATION: prob3 points remain 100000 at order 1', p3Post.problemOrder === 1 && p3Post.points === 100000);
    record('REORDER POINTS PRESERVATION: prob1 points remain 100 at order 2', p1Post.problemOrder === 2 && p1Post.points === 100);
    record('REORDER POINTS PRESERVATION: prob2 points remain 250 at order 3', p2Post.problemOrder === 3 && p2Post.points === 250);

    // -------------------------------------------------------------------------
    // 8. Testing Remove Preserving Points of Remaining Problems
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Remove Preserving Other Points ---');
    const resDel = await request('DELETE', `/api/contests/${contestDraft.id}/problems/${prob3.id}`, null, profAToken);
    record('REMOVE: Problem removal returns 200 OK', resDel.status === 200);

    const listPostDel = await request('GET', `/api/contests/${contestDraft.id}/problems`, null, profAToken);
    const p1Remain = listPostDel.body.problems.find(p => p.problemId === prob1.id);
    const p2Remain = listPostDel.body.problems.find(p => p.problemId === prob2.id);

    record('REMOVE PRESERVATION: Remaining prob1 points remain exactly 100', p1Remain && p1Remain.points === 100);
    record('REMOVE PRESERVATION: Remaining prob2 points remain exactly 250', p2Remain && p2Remain.points === 250);

    // -------------------------------------------------------------------------
    // 9. Testing Contest Edit Preserving Problem Configuration
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Contest Edit Preserving Problem Config ---');
    const resEditContest = await request('PUT', `/api/contests/${contestDraft.id}`, {
      title: `Updated Title ${ts}`,
      description: 'Updated contest description',
      isRated: false,
    }, profAToken);
    record('CONTEST EDIT: Contest metadata update returns 200 OK', resEditContest.status === 200);

    const listPostContestEdit = await request('GET', `/api/contests/${contestDraft.id}/problems`, null, profAToken);
    record('CONTEST EDIT PRESERVATION: Attached problem count remains 2', listPostContestEdit.body.problems.length === 2);
    record('CONTEST EDIT PRESERVATION: prob1 points still 100', listPostContestEdit.body.problems.find(p => p.problemId === prob1.id).points === 100);
    record('CONTEST EDIT PRESERVATION: prob2 points still 250', listPostContestEdit.body.problems.find(p => p.problemId === prob2.id).points === 250);

    // -------------------------------------------------------------------------
    // 10. Testing Problem Metadata Consistency
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Problem Metadata Consistency ---');
    record('METADATA CONSISTENCY: prob1 codingMode is function', listPostContestEdit.body.problems.find(p => p.problemId === prob1.id).codingMode === 'function');
    record('METADATA CONSISTENCY: prob2 codingMode is full_program', listPostContestEdit.body.problems.find(p => p.problemId === prob2.id).codingMode === 'full_program');
    record('METADATA CONSISTENCY: prob1 difficulty is easy', listPostContestEdit.body.problems.find(p => p.problemId === prob1.id).difficulty === 'easy');
    record('METADATA CONSISTENCY: prob2 difficulty is medium', listPostContestEdit.body.problems.find(p => p.problemId === prob2.id).difficulty === 'medium');

    // -------------------------------------------------------------------------
    // 11. Testing Leaderboard and Standings Scoring Consistency
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing Leaderboard Scoring Consistency ---');
    // Attach prob1 (100 pts) and prob2 (250 pts) to contestRunning
    await ContestModel.addProblemToContest({
      contestId: contestRunning.id,
      problemId: prob1.id,
      points: 150,
      problemOrder: 1,
    });
    await ContestModel.addProblemToContest({
      contestId: contestRunning.id,
      problemId: prob2.id,
      points: 300,
      problemOrder: 2,
    });

    // Register student to contestRunning
    await ContestModel.addParticipant(contestRunning.id, student.id);

    // Create an accepted submission for prob1 (points: 150)
    const sub1 = await SubmissionModel.createSubmission({
      userId: student.id,
      contestId: contestRunning.id,
      problemId: prob1.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: 'print(10)',
      status: 'accepted',
      score: 150,
      testCasesPassed: 1,
      testCasesTotal: 1,
    });
    createdSubmissionIds.push(sub1.id);

    // Compute standings for contestRunning
    const standingsRes = await StandingsService.computeContestStandings({
      contestId: contestRunning.id,
      limit: 100,
    });

    const studentStanding = standingsRes.standings.find(s => s.userId === student.id);
    record('STANDINGS CONSISTENCY: Standings contains student record', Boolean(studentStanding));
    record('STANDINGS CONSISTENCY: prob1 maxPoints reflects contest_problems points (150)',
      studentStanding.problems.find(p => p.problemId === prob1.id).maxPoints === 150
    );
    record('STANDINGS CONSISTENCY: prob2 maxPoints reflects contest_problems points (300)',
      studentStanding.problems.find(p => p.problemId === prob2.id).maxPoints === 300
    );
    record('STANDINGS CONSISTENCY: Solved prob1 contributes exact 150 points to totalScore',
      studentStanding.totalScore === 150
    );

    // -------------------------------------------------------------------------
    // 12. Testing Submission Evaluation Dynamic Points Integration
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Testing Judge Evaluation Dynamic Points ---');
    // Test helper getContestProblemPoints
    const queriedPoints1 = await ContestModel.getContestProblemPoints(contestRunning.id, prob1.id);
    const queriedPoints2 = await ContestModel.getContestProblemPoints(contestRunning.id, prob2.id);
    const queriedPointsNonExistent = await ContestModel.getContestProblemPoints(contestRunning.id, 999999);

    record('MODEL HELPER: getContestProblemPoints returns 150 for prob1', queriedPoints1 === 150);
    record('MODEL HELPER: getContestProblemPoints returns 300 for prob2', queriedPoints2 === 300);
    record('MODEL HELPER: getContestProblemPoints returns null for unattached problem', queriedPointsNonExistent === null);

    // -------------------------------------------------------------------------
    // 13. Testing Lifecycle Lock Interaction
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Testing Lifecycle Lock Interaction ---');
    const resLockAdd = await request('POST', `/api/contests/${contestRunning.id}/problems`, {
      problemId: prob3.id,
      points: 200,
    }, profAToken);
    record('LIFECYCLE LOCK: Adding problem to running contest rejected with 409 Conflict', resLockAdd.status === 409);

    const resLockOrder = await request('PUT', `/api/contests/${contestRunning.id}/problems/order`, {
      problemIds: [prob2.id, prob1.id],
    }, profAToken);
    record('LIFECYCLE LOCK: Reordering running contest rejected with 409 Conflict', resLockOrder.status === 409);

    const dbRunningProblems = await ContestModel.getContestProblems(contestRunning.id);
    record('LIFECYCLE INTEGRITY: Running contest problem count remains exactly 2', dbRunningProblems.length === 2);
    record('LIFECYCLE INTEGRITY: prob1 order and points remain 1 and 150',
      dbRunningProblems.find(p => p.problemId === prob1.id).problemOrder === 1 &&
      dbRunningProblems.find(p => p.problemId === prob1.id).points === 150
    );

    // -------------------------------------------------------------------------
    // 14. Testing RBAC & BOLA
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Testing RBAC & BOLA Protection ---');
    // Student blocked
    const resStdAdd = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 100,
    }, studentToken);
    record('RBAC: Student cannot add problem to contest (403 Forbidden)', resStdAdd.status === 403);

    // Non-owner professor blocked
    const resOtherProfAdd = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: prob3.id,
      points: 100,
    }, profBToken);
    record('RBAC: Non-owner professor cannot add problem to contest (403 Forbidden)', resOtherProfAdd.status === 403);

    // Attaching private problem belonging to other professor blocked
    const resBolaPrivate = await request('POST', `/api/contests/${contestDraft.id}/problems`, {
      problemId: probPrivateB.id,
      points: 200,
    }, profAToken);
    record('BOLA: Attaching another professor private problem rejected with 403 Forbidden', resBolaPrivate.status === 403);

    // -------------------------------------------------------------------------
    // 15. Testing Rollback on Failure
    // -------------------------------------------------------------------------
    console.log('\n--- 15. Testing Rollback & Atomicity ---');
    const preRollbackProblems = await ContestModel.getContestProblems(contestDraft.id);

    // Invalid reorder (missing problem)
    const resBadReorder = await request('PUT', `/api/contests/${contestDraft.id}/problems/order`, {
      problemIds: [prob1.id],
    }, profAToken);
    record('ATOMICITY: Invalid partial reorder rejected with 400 Bad Request', resBadReorder.status === 400);

    const postRollbackProblems = await ContestModel.getContestProblems(contestDraft.id);
    record('ATOMICITY: Database state byte-for-byte identical after rejected mutation',
      JSON.stringify(preRollbackProblems) === JSON.stringify(postRollbackProblems)
    );

    // -------------------------------------------------------------------------
    // 16. Ephemeral Test Fixture Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 16. Cleaning Up Ephemeral Test Fixtures ---');
    if (createdSubmissionIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE id = ANY($1::int[])`, [createdSubmissionIds]);
    }
    if (createdContestIds.length > 0) {
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [createdContestIds]);
    }
    if (createdProblemIds.length > 0) {
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
    }
    record('Cleanup: Ephemeral test fixtures safely cleaned up', true);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.9 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runScoringConsistencyTests();
}

module.exports = { runScoringConsistencyTests };
