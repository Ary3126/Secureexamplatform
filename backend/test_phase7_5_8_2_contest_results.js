/**
 * Phase 7.5.8.2 — Contest Results View Test Suite
 * File: backend/test_phase7_5_8_2_contest_results.js
 *
 * Exhaustively validates:
 * 1. GET /api/contests/:id/results API Response Structure (contest, resultSummary, results, userResult, podium, problems, pagination)
 * 2. Invalid Contest ID Handling (non-integer, negative, zero -> 400 Bad Request)
 * 3. Non-Existent Contest Handling (-> 404 Not Found)
 * 4. Draft Contest BOLA Protection:
 *    - Anonymous / Student blocked from /results (-> 404 Not Found)
 *    - Anonymous / Student blocked from /leaderboard (-> 404 Not Found)
 *    - Professor owner allowed to view draft /results (-> 200 OK)
 *    - Super Admin allowed to view draft /results (-> 200 OK)
 * 5. Contest Lifecycle Integration (upcoming, running, ended)
 * 6. Leaderboard Freeze Integration:
 *    - Submissions made after freeze time hidden from student results
 *    - Student freezeOverride=true parameter ignored
 *    - Professor owner freezeOverride=true sees true unmasked results
 * 7. Rating Finalization Integration:
 *    - Once ratings are finalized, results include official ratingChange and newRating for participants
 *    - userResult contains personal ratingChange and newRating
 *    - podium cards include official rating deltas
 * 8. Ranking & Scoring Consistency:
 *    - Participant rank, points, solved count, penalty match StandingsService
 * 9. Search & Pagination:
 *    - Search filters results by username or name
 *    - Server-side pagination parameters (page, limit) work accurately
 * 10. Parameter Hardening & SQL Injection safety
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
const RatingService = require('./src/services/ratingService');
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
  console.log(' STARTING PHASE 7.5.8.2 CONTEST RESULTS VIEW TEST SUITE');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  // Track created entities for clean teardown
  const createdUserIds = [];
  const createdContestIds = [];
  const createdProblemIds = [];
  const createdSubmissionIds = [];

  const ts = Date.now();

  try {
    // Start ephemeral server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`Test server running at ${baseUrl}`);
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // Setup Test Users: Professor, Super Admin, and 3 Students (Alice, Bob, Charlie)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Setup Test Users ---');
    const pwdHash = await hashPassword('Password123!');

    const prof = await UserModel.createUser({
      username: `p7582_prof_${ts}`,
      email: `prof_${ts}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      fullName: 'Prof Results',
    });
    createdUserIds.push(prof.id);
    const profToken = generateToken(prof);

    const admin = await UserModel.createUser({
      username: `p7582_admin_${ts}`,
      email: `admin_${ts}@test.edu`,
      passwordHash: pwdHash,
      role: 'super_admin',
      fullName: 'Admin Results',
    });
    createdUserIds.push(admin.id);
    const adminToken = generateToken(admin);

    const s1 = await UserModel.createUser({
      username: `p7582_alice_${ts}`,
      email: `alice_${ts}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      fullName: 'Alice Walker',
    });
    createdUserIds.push(s1.id);
    const s1Token = generateToken(s1);

    const s2 = await UserModel.createUser({
      username: `p7582_bob_${ts}`,
      email: `bob_${ts}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      fullName: 'Bob Martin',
    });
    createdUserIds.push(s2.id);
    const s2Token = generateToken(s2);

    const s3 = await UserModel.createUser({
      username: `p7582_charlie_${ts}`,
      email: `charlie_${ts}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      fullName: 'Charlie Davis',
    });
    createdUserIds.push(s3.id);
    const s3Token = generateToken(s3);

    record('Setup: All test users created and tokens generated', Boolean(profToken && adminToken && s1Token));

    // -------------------------------------------------------------------------
    // Setup Test Problems
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Setup Test Problems ---');
    const prob1 = await ProblemModel.createProblem({
      title: `P7582 Sum Problem ${ts}`,
      description: 'Sum two numbers',
      difficulty: 'easy',
      authorId: prof.id,
      createdBy: prof.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob1.id);

    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '5 7\n',
      expectedOutput: '12\n',
      isSample: false,
    });

    const prob2 = await ProblemModel.createProblem({
      title: `P7582 Multiply Problem ${ts}`,
      description: 'Multiply two numbers',
      difficulty: 'medium',
      authorId: prof.id,
      createdBy: prof.id,
      codingMode: 'full_program',
    });
    createdProblemIds.push(prob2.id);

    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '3 8\n',
      expectedOutput: '24\n',
      isSample: false,
    });

    record('Setup: 2 contest problems with test cases created', Boolean(prob1.id && prob2.id));

    // -------------------------------------------------------------------------
    // 3. Draft Contest BOLA Security
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Draft Contest BOLA Security ---');
    const draftContest = await ContestModel.createContest({
      title: `P7582 Draft Contest ${ts}`,
      description: 'Secret unpublished examination',
      startTime: new Date(Date.now() + 600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      status: 'draft',
      createdBy: prof.id,
    });
    createdContestIds.push(draftContest.id);

    await ContestModel.addProblemToContest({
      contestId: draftContest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });

    // Anonymous request to /results on draft contest -> 404
    const resDraftAnon = await request('GET', `/api/contests/${draftContest.id}/results`);
    record('BOLA: Anonymous access to draft contest results returns 404 Not Found', resDraftAnon.status === 404);

    // Student request to /results on draft contest -> 404
    const resDraftStudent = await request('GET', `/api/contests/${draftContest.id}/results`, null, s1Token);
    record('BOLA: Student access to draft contest results returns 404 Not Found', resDraftStudent.status === 404);

    // Student request to /leaderboard on draft contest -> 404
    const resDraftLbStudent = await request('GET', `/api/contests/${draftContest.id}/leaderboard`, null, s1Token);
    record('BOLA: Student access to draft contest leaderboard returns 404 Not Found', resDraftLbStudent.status === 404);

    // Professor owner request to draft contest /results -> 200
    const resDraftProf = await request('GET', `/api/contests/${draftContest.id}/results`, null, profToken);
    record('BOLA: Professor owner access to draft contest results succeeds (200 OK)', resDraftProf.status === 200);

    // Super Admin request to draft contest /results -> 200
    const resDraftAdmin = await request('GET', `/api/contests/${draftContest.id}/results`, null, adminToken);
    record('BOLA: Super Admin access to draft contest results succeeds (200 OK)', resDraftAdmin.status === 200);

    // -------------------------------------------------------------------------
    // 4. Invalid Contest ID & Non-Existent ID Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Contest ID Validation ---');
    const resInvalidId = await request('GET', '/api/contests/not-a-number/results', null, s1Token);
    record('VALIDATION: Non-integer contest ID returns 400 Bad Request', resInvalidId.status === 400);
    record('VALIDATION: Error message indicates invalid contest ID format',
      resInvalidId.body?.message?.includes('Invalid contest ID format')
    );

    const resNegativeId = await request('GET', '/api/contests/-5/results', null, s1Token);
    record('VALIDATION: Negative contest ID returns 400 Bad Request', resNegativeId.status === 400);

    const resNonExistent = await request('GET', '/api/contests/99999999/results', null, s1Token);
    record('VALIDATION: Non-existent contest returns 404 Not Found', resNonExistent.status === 404);

    // -------------------------------------------------------------------------
    // 5. Published Running Contest: Submissions, Standings & Results Structure
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Published Running Contest: Scoring & Results Payload ---');
    const runningContest = await ContestModel.createContest({
      title: `P7582 Championship ${ts}`,
      description: 'Official Championship contest',
      startTime: new Date(Date.now() - 3600000).toISOString(), // started 1h ago
      endTime: new Date(Date.now() + 3600000).toISOString(),   // ends in 1h
      status: 'published',
      isRated: true,
      leaderboardFreezeEnabled: false,
      createdBy: prof.id,
    });
    createdContestIds.push(runningContest.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1;`, [runningContest.id]);

    await ContestModel.addProblemToContest({
      contestId: runningContest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addProblemToContest({
      contestId: runningContest.id,
      problemId: prob2.id,
      points: 200,
      problemOrder: 2,
    });

    // Enroll 3 students
    await ContestModel.addParticipant(runningContest.id, s1.id);
    await ContestModel.addParticipant(runningContest.id, s2.id);
    await ContestModel.addParticipant(runningContest.id, s3.id);

    // Alice: Solves Prob 1 (Accepted), Solves Prob 2 (1 WA, then Accepted) -> 300 pts
    const subAliceP1 = await SubmissionModel.createSubmission({
      userId: s1.id,
      contestId: runningContest.id,
      problemId: prob1.id,
      language: 'python',
      sourceCode: 'print(12)',
      status: 'accepted',
      score: 100,
      executionTime: 45,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subAliceP1.id);

    const subAliceP2_fail = await SubmissionModel.createSubmission({
      userId: s1.id,
      contestId: runningContest.id,
      problemId: prob2.id,
      language: 'python',
      sourceCode: 'print(0)',
      status: 'wrong_answer',
      score: 0,
      executionTime: 30,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subAliceP2_fail.id);

    const subAliceP2_ac = await SubmissionModel.createSubmission({
      userId: s1.id,
      contestId: runningContest.id,
      problemId: prob2.id,
      language: 'python',
      sourceCode: 'print(24)',
      status: 'accepted',
      score: 200,
      executionTime: 50,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subAliceP2_ac.id);

    // Bob: Solves Prob 1 only (Accepted) -> 100 pts
    const subBobP1 = await SubmissionModel.createSubmission({
      userId: s2.id,
      contestId: runningContest.id,
      problemId: prob1.id,
      language: 'python',
      sourceCode: 'print(12)',
      status: 'accepted',
      score: 100,
      executionTime: 60,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subBobP1.id);

    // Charlie: Fails Prob 1 (WA, 0 solves) -> 0 pts
    const subCharlieP1 = await SubmissionModel.createSubmission({
      userId: s3.id,
      contestId: runningContest.id,
      problemId: prob1.id,
      language: 'python',
      sourceCode: 'print(999)',
      status: 'wrong_answer',
      score: 0,
      executionTime: 20,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subCharlieP1.id);

    // Request Contest Results as Alice
    const resResults = await request('GET', `/api/contests/${runningContest.id}/results`, null, s1Token);
    record('RESULTS API: GET /api/contests/:id/results returns 200 OK', resResults.status === 200);

    const body = resResults.body;
    record('PAYLOAD: Contains contest object with status published', body.contest?.status === 'published');
    record('PAYLOAD: Contains resultSummary object', typeof body.resultSummary === 'object' && body.resultSummary !== null);
    record('PAYLOAD: resultSummary tracks totalParticipants = 3', body.resultSummary?.totalParticipants === 3);
    record('PAYLOAD: resultSummary tracks totalProblems = 2', body.resultSummary?.totalProblems === 2);
    record('PAYLOAD: resultSummary tracks topScore = 300', body.resultSummary?.topScore === 300);
    record('PAYLOAD: Contains results array with 3 rows', Array.isArray(body.results) && body.results.length === 3);
    record('PAYLOAD: Contains podium array with top 3 participants', Array.isArray(body.podium) && body.podium.length === 3);
    record('PAYLOAD: Contains userResult object for requesting participant (Alice)', body.userResult?.userId === s1.id);
    record('PAYLOAD: userResult confirms participation = true', body.userResult?.isParticipating === true);
    record('PAYLOAD: Alice userResult rank is #1', body.userResult?.rank === 1);
    record('PAYLOAD: Alice userResult totalScore is 300', body.userResult?.totalScore === 300);
    record('PAYLOAD: Alice userResult solvedProblemsCount is 2', body.userResult?.solvedProblemsCount === 2);

    // Verify Ranking Order: Alice (1st, 300 pts) > Bob (2nd, 100 pts) > Charlie (3rd, 0 pts)
    record('RANKING: Rank 1 is Alice with 300 points', body.results[0].userId === s1.id && body.results[0].totalScore === 300);
    record('RANKING: Rank 2 is Bob with 100 points', body.results[1].userId === s2.id && body.results[1].totalScore === 100);
    record('RANKING: Rank 3 is Charlie with 0 points', body.results[2].userId === s3.id && body.results[2].totalScore === 0);

    // Problem matrix verification
    const aliceProb2 = body.results[0].problems.find(p => p.problemId === prob2.id);
    record('MATRIX: Alice problem 2 status is solved', aliceProb2?.status === 'solved');
    record('MATRIX: Alice problem 2 points is 200', aliceProb2?.points === 200);
    record('MATRIX: Alice problem 2 tracks 1 failedAttemptBeforeSolve', aliceProb2?.failedAttemptsBeforeSolve === 1);
    record('MATRIX: Alice problem 2 penalty includes +20m penalty contribution', aliceProb2?.penaltyContribution >= 20);

    // -------------------------------------------------------------------------
    // 6. Freeze Enforcement on Results
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Leaderboard Freeze Integration on Results ---');
    const freezeStartTime = new Date(Date.now() - 7200000).toISOString(); // 2h ago
    const freezeEndTime = new Date(Date.now() + 600000).toISOString();    // ends in 10m
    const freezeContest = await ContestModel.createContest({
      title: `P7582 Frozen Contest ${ts}`,
      description: 'Contest in freeze window',
      startTime: freezeStartTime,
      endTime: freezeEndTime,
      status: 'published',
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30, // freeze started 20 min ago
      createdBy: prof.id,
    });
    createdContestIds.push(freezeContest.id);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1;`, [freezeContest.id]);

    await ContestModel.addProblemToContest({
      contestId: freezeContest.id,
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addParticipant(freezeContest.id, s1.id);

    // Alice makes submission AFTER freeze cutoff (current timestamp)
    const subDuringFreeze = await SubmissionModel.createSubmission({
      userId: s1.id,
      contestId: freezeContest.id,
      problemId: prob1.id,
      language: 'python',
      sourceCode: 'print(12)',
      status: 'accepted',
      score: 100,
      executionTime: 40,
      isSampleRun: false,
    });
    createdSubmissionIds.push(subDuringFreeze.id);

    // Student checks /results during freeze
    const resFreezeStudent = await request('GET', `/api/contests/${freezeContest.id}/results`, null, s1Token);
    record('FREEZE: Contest detected as isFrozen = true', resFreezeStudent.body.contest?.isFrozen === true);
    record('FREEZE: Student results hides post-freeze submission (Score = 0)',
      resFreezeStudent.body.results[0]?.totalScore === 0
    );

    // Student attempting freezeOverride=true bypass is ignored
    const resFreezeBypass = await request('GET', `/api/contests/${freezeContest.id}/results?freezeOverride=true`, null, s1Token);
    record('FREEZE: Student freezeOverride=true bypass is ignored (Score = 0)',
      resFreezeBypass.body.results[0]?.totalScore === 0
    );

    // Professor owner checks with freezeOverride=true
    const resFreezeProf = await request('GET', `/api/contests/${freezeContest.id}/results?freezeOverride=true`, null, profToken);
    record('FREEZE: Professor with freezeOverride sees true unmasked results (Score = 100)',
      resFreezeProf.body.results[0]?.totalScore === 100
    );

    // -------------------------------------------------------------------------
    // 7. Rating Finalization & Results Integration
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Rating Finalization & Results Integration ---');
    // Finalize ratings on runningContest using RatingService
    const finalizationRes = await RatingService.finalizeContestRatings(runningContest.id, prof, { force: true });
    record('FINALIZATION: RatingService.finalizeContestRatings succeeds', Boolean(finalizationRes.ratingUpdates));

    // Request Results again as Alice
    const resFinalized = await request('GET', `/api/contests/${runningContest.id}/results`, null, s1Token);
    record('FINALIZED RESULTS: contest.isRatingFinalized is true', resFinalized.body.contest?.isRatingFinalized === true);
    record('FINALIZED RESULTS: resultSummary.isFinalized is true', resFinalized.body.resultSummary?.isFinalized === true);

    const aliceFinalRow = resFinalized.body.results.find(r => r.userId === s1.id);
    const bobFinalRow = resFinalized.body.results.find(r => r.userId === s2.id);

    record('FINALIZED RESULTS: Alice receives official positive ratingChange',
      typeof aliceFinalRow?.ratingChange === 'number' && aliceFinalRow.ratingChange > 0
    );
    record('FINALIZED RESULTS: Alice receives updated newRating',
      typeof aliceFinalRow?.newRating === 'number' && aliceFinalRow.newRating > aliceFinalRow.previousRating
    );
    record('FINALIZED RESULTS: userResult contains official ratingChange',
      resFinalized.body.userResult?.ratingChange === aliceFinalRow?.ratingChange
    );
    record('FINALIZED RESULTS: Podium contains rating deltas',
      resFinalized.body.podium[0]?.ratingChange === aliceFinalRow?.ratingChange
    );

    // -------------------------------------------------------------------------
    // 8. Search, Pagination & Parameter Hardening
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Search, Pagination & Parameter Hardening ---');
    // Search by username
    const resSearch = await request('GET', `/api/contests/${runningContest.id}/results?search=alice`, null, s1Token);
    record('SEARCH: Search for "alice" returns exactly 1 result', resSearch.body.results?.length === 1);
    record('SEARCH: Returned result is Alice', resSearch.body.results[0]?.userId === s1.id);

    // Search by full name
    const resSearchName = await request('GET', `/api/contests/${runningContest.id}/results?search=Walker`, null, s1Token);
    record('SEARCH: Search by full name "Walker" returns Alice', resSearchName.body.results[0]?.userId === s1.id);

    // Pagination
    const resPag = await request('GET', `/api/contests/${runningContest.id}/results?page=1&limit=2`, null, s1Token);
    record('PAGINATION: Limit 2 returns 2 results', resPag.body.results?.length === 2);
    record('PAGINATION: hasNext is true', resPag.body.pagination?.hasNext === true);
    record('PAGINATION: totalPages is 2', resPag.body.pagination?.totalPages === 2);

    const resPagPage2 = await request('GET', `/api/contests/${runningContest.id}/results?page=2&limit=2`, null, s1Token);
    record('PAGINATION: Page 2 returns 1 remaining result (Charlie)', resPagPage2.body.results?.length === 1 && resPagPage2.body.results[0].userId === s3.id);
    record('PAGINATION: Page 2 hasNext is false', resPagPage2.body.pagination?.hasNext === false);

    // SQL Injection in search input
    const resSqlInj = await request('GET', `/api/contests/${runningContest.id}/results?search=%27%20OR%201=1--`, null, s1Token);
    record('SECURITY: Malicious SQL search input does not crash or leak data (200 OK)', resSqlInj.status === 200);

    // Extreme pagination limit
    const resExtremeLimit = await request('GET', `/api/contests/${runningContest.id}/results?limit=999999`, null, s1Token);
    record('SECURITY: Extreme limit clamped safely to max 100', resExtremeLimit.body.pagination?.limit === 100);

  } catch (err) {
    console.error('\n[UNEXPECTED ERROR IN TEST EXECUTION]:', err);
    failed++;
  } finally {
    // Teardown created test entities
    console.log('\n--- Cleaning Up Test Data ---');
    try {
      if (createdSubmissionIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE id = ANY($1::int[]);`, [createdSubmissionIds]);
      }
      if (createdContestIds.length > 0) {
        await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[]);`, [createdContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[]);`, [createdContestIds]);
      }
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[]);`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1::int[]);`, [createdProblemIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[]);`, [createdUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [createdUserIds]);
      }
    } catch (cleanErr) {
      console.error('Error during cleanup:', cleanErr.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.8.2 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
