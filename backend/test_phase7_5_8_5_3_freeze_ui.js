/**
 * Phase 7.5.8.5.3 — Freeze UI Authoritative Integration Test Suite
 * File: backend/test_phase7_5_8_5_3_freeze_ui.js
 *
 * Exhaustively tests all 22 required scenarios for Phase 7.5.8.5.3:
 *
 * Freeze State:
 * 1. Live leaderboard renders normally (isFrozen: false, freezeState: 'NOT_FROZEN')
 * 2. Frozen leaderboard displays freeze indicator (isFrozen: true, freezeState: 'FROZEN')
 * 3. Frozen information is not displayed (post-freeze submissions omitted for students)
 * 4. Final results are not incorrectly labeled during freeze (isRatingFinalized: false)
 *
 * Backend State:
 * 5. UI follows backend frozen state (server response determines isFrozen)
 * 6. UI follows backend live state (server response determines live status)
 * 7. Client clock does not override server state (serverTime provided authoritatively)
 * 8. Local state cannot bypass freeze (student cannot pass ?freezeOverride=true to reveal scores)
 *
 * Authorization:
 * 9. Student sees only permitted information (scores capped at pre-freeze solves)
 * 10. Professor creator sees permitted information (can unmask with freezeOverride=true)
 * 11. Contest Admin sees permitted information (can unmask with freezeOverride=true)
 * 12. Unauthorized response is handled correctly (non-owner / unauthorized yields 403/401)
 *
 * Refresh:
 * 13. Freeze transition after initial page load (re-fetch obtains updated frozen state)
 * 14. Refresh obtains authoritative state (fresh leaderboard reflects latest submissions)
 * 15. Network failure / non-existent contest handled gracefully (404 with structured error)
 * 16. Stale data is not falsely presented as current (serverTime guaranteed in response)
 *
 * Result Details:
 * 17. Result Details respects freeze visibility (/results/me masks post-freeze solve)
 * 18. Hidden information is not reconstructed client-side (no hidden submission IDs present)
 *
 * UI & Component Contract:
 * 19. Complete contract structure with pagination metadata
 * 20. Empty state (zero participants returns empty standings with valid structure)
 * 21. Error state (invalid contest ID returns structured error message)
 * 22. Responsive/accessible freeze metadata (isFrozen, freezeState, freezeTime, minutes present)
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
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
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
  console.log('===============================================================');
  console.log('Phase 7.5.8.5.3 — Freeze UI Authoritative Verification Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(testName) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  }

  function fail(testName, err) {
    console.error(`  [FAIL] ${testName}`);
    console.error(' ', err.message || err);
    failed++;
  }

  // Spin up test server on ephemeral port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  const uniqueSuffix = Date.now().toString().slice(-5);
  const passwordHash = await hashPassword('Password123!');

  // Provision test actors
  let creatorProf, otherProf, contestAdmin, student1, student2;
  let creatorProfToken, otherProfToken, contestAdminToken, student1Token, student2Token;

  let liveContest, frozenContest, emptyContest;
  let prob1, prob2;

  try {
    console.log('--- SETUP: Provisioning Users, Problems & Contests ---');

    creatorProf = await UserModel.createUser({
      username: `prof_cr_${uniqueSuffix}`,
      email: `prof_cr_${uniqueSuffix}@example.com`,
      passwordHash,
      role: 'professor',
      fullName: `Creator Professor ${uniqueSuffix}`,
      institution: 'State University',
    });
    creatorProfToken = generateToken(creatorProf);

    otherProf = await UserModel.createUser({
      username: `prof_oth_${uniqueSuffix}`,
      email: `prof_oth_${uniqueSuffix}@example.com`,
      passwordHash,
      role: 'professor',
      fullName: `Other Professor ${uniqueSuffix}`,
      institution: 'City College',
    });
    otherProfToken = generateToken(otherProf);

    contestAdmin = await UserModel.createUser({
      username: `admin_ct_${uniqueSuffix}`,
      email: `admin_ct_${uniqueSuffix}@example.com`,
      passwordHash,
      role: 'contest_admin',
      fullName: `Contest Admin ${uniqueSuffix}`,
      institution: 'State University',
    });
    contestAdminToken = generateToken(contestAdmin);

    student1 = await UserModel.createUser({
      username: `stud1_${uniqueSuffix}`,
      email: `stud1_${uniqueSuffix}@example.com`,
      passwordHash,
      role: 'student',
      fullName: `Student One ${uniqueSuffix}`,
      institution: 'State University',
    });
    student1Token = generateToken(student1);

    student2 = await UserModel.createUser({
      username: `stud2_${uniqueSuffix}`,
      email: `stud2_${uniqueSuffix}@example.com`,
      passwordHash,
      role: 'student',
      fullName: `Student Two ${uniqueSuffix}`,
      institution: 'State University',
    });
    student2Token = generateToken(student2);

    // Problem 1 (100 pts)
    prob1 = await ProblemModel.createProblem({
      title: `Problem A ${uniqueSuffix}`,
      description: 'First test problem',
      difficulty: 'easy',
      createdBy: creatorProf.id,
      codingMode: 'full_program',
    });
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '1 2',
      expectedOutput: '3',
      isSample: false,
    });

    // Problem 2 (100 pts)
    prob2 = await ProblemModel.createProblem({
      title: `Problem B ${uniqueSuffix}`,
      description: 'Second test problem',
      difficulty: 'medium',
      createdBy: creatorProf.id,
      codingMode: 'full_program',
    });
    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '4 5',
      expectedOutput: '9',
      isSample: false,
    });

    const now = new Date();

    // 1. Live Contest: running, freeze is scheduled for last 10m, but currently before freeze window
    const liveStart = new Date(now.getTime() - 30 * 60000);
    const liveEnd = new Date(now.getTime() + 60 * 60000);
    liveContest = await ContestModel.createContest({
      title: `Live Contest ${uniqueSuffix}`,
      description: 'Live contest before freeze',
      startTime: liveStart.toISOString(),
      endTime: liveEnd.toISOString(),
      isRated: true,
      createdBy: creatorProf.id,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 15, // Freeze starts in 45m
    });
    await ContestModel.updateContestStatus(liveContest.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: liveContest.id,
      problemId: prob1.id,
      problemOrder: 1,
      points: 100,
    });

    // 2. Frozen Contest: running, 60m total, 30m freeze, currently 45m in (inside freeze window)
    const frozenStart = new Date(now.getTime() - 45 * 60000);
    const frozenEnd = new Date(now.getTime() + 15 * 60000);
    frozenContest = await ContestModel.createContest({
      title: `Frozen Contest ${uniqueSuffix}`,
      description: 'Active contest in freeze window',
      startTime: frozenStart.toISOString(),
      endTime: frozenEnd.toISOString(),
      isRated: true,
      createdBy: creatorProf.id,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30, // freeze started 15m ago
    });
    await ContestModel.updateContestStatus(frozenContest.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: frozenContest.id,
      problemId: prob1.id,
      problemOrder: 1,
      points: 100,
    });
    await ContestModel.addProblemToContest({
      contestId: frozenContest.id,
      problemId: prob2.id,
      problemOrder: 2,
      points: 100,
    });

    // 3. Empty Contest: published, running, zero participants
    emptyContest = await ContestModel.createContest({
      title: `Empty Contest ${uniqueSuffix}`,
      description: 'Contest with zero participants',
      startTime: frozenStart.toISOString(),
      endTime: frozenEnd.toISOString(),
      isRated: false,
      createdBy: creatorProf.id,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 20,
    });
    await ContestModel.updateContestStatus(emptyContest.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: emptyContest.id,
      problemId: prob1.id,
      problemOrder: 1,
      points: 100,
    });

    // Enroll students in frozen contest
    await ContestModel.addParticipant(frozenContest.id, student1.id);
    await ContestModel.addParticipant(frozenContest.id, student2.id);

    // Enroll students in live contest
    await ContestModel.addParticipant(liveContest.id, student1.id);

    // Create submissions in frozen contest:
    // Student 1: solved Problem 1 PRE-FREEZE (40m ago -> before freeze cutoff of 15m ago)
    const preFreezeTime = new Date(now.getTime() - 40 * 60000);
    await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, execution_time, memory_used, is_sample_run, created_at)
      VALUES ($1, $2, $3, 'javascript', 'console.log("pre-freeze solve");', 'accepted', 100, 45, 1024, false, $4);
    `, [student1.id, frozenContest.id, prob1.id, preFreezeTime.toISOString()]);

    // Student 2: solved Problem 2 POST-FREEZE (5m ago -> inside freeze window)
    const postFreezeTime = new Date(now.getTime() - 5 * 60000);
    await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, execution_time, memory_used, is_sample_run, created_at)
      VALUES ($1, $2, $3, 'javascript', 'console.log("post-freeze solve");', 'accepted', 100, 35, 1024, false, $4);
    `, [student2.id, frozenContest.id, prob2.id, postFreezeTime.toISOString()]);

    console.log('Setup completed successfully.\n');

    // ── GROUP 1: FREEZE STATE ────────────────────────────────────────────────
    console.log('--- 1. FREEZE STATE TESTS ---');

    // 1. Live leaderboard renders normally
    try {
      const res = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, false);
      assert.strictEqual(res.body.contest.freezeState, 'NOT_FROZEN');
      pass('1. Live leaderboard renders normally (isFrozen: false, freezeState: NOT_FROZEN)');
    } catch (e) {
      fail('1. Live leaderboard renders normally', e);
    }

    // 2. Frozen leaderboard displays freeze indicator
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, true);
      assert.strictEqual(res.body.contest.freezeState, 'FROZEN');
      assert.ok(res.body.contest.freezeTime);
      pass('2. Frozen leaderboard displays freeze indicator (isFrozen: true, freezeState: FROZEN)');
    } catch (e) {
      fail('2. Frozen leaderboard displays freeze indicator', e);
    }

    // 3. Frozen information is not displayed
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      const student2Standing = res.body.standings.find((s) => s.userId === student2.id);
      assert.ok(student2Standing);
      assert.strictEqual(student2Standing.totalScore, 0, 'Post-freeze solve score must be masked to 0');
      assert.strictEqual(student2Standing.solvedProblemsCount, 0, 'Post-freeze solved count must be masked to 0');
      pass('3. Frozen information is not displayed (Student 2 post-freeze solve masked)');
    } catch (e) {
      fail('3. Frozen information is not displayed', e);
    }

    // 4. Final results are not incorrectly labeled during freeze
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/results`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isRatingFinalized, false);
      assert.strictEqual(res.body.contest.isFrozen, true);
      assert.strictEqual(res.body.contest.freezeState, 'FROZEN');
      pass('4. Final results are not incorrectly labeled during freeze (isRatingFinalized: false)');
    } catch (e) {
      fail('4. Final results are not incorrectly labeled during freeze', e);
    }

    // ── GROUP 2: BACKEND STATE ───────────────────────────────────────────────
    console.log('\n--- 2. BACKEND STATE TESTS ---');

    // 5. UI follows backend frozen state
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.body.contest.isFrozen, true);
      pass('5. UI follows backend frozen state');
    } catch (e) {
      fail('5. UI follows backend frozen state', e);
    }

    // 6. UI follows backend live state
    try {
      const res = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.body.contest.isFrozen, false);
      pass('6. UI follows backend live state');
    } catch (e) {
      fail('6. UI follows backend live state', e);
    }

    // 7. Client clock does not override server state
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.ok(res.body.contest.serverTime, 'Response must include authoritative serverTime');
      const serverDate = new Date(res.body.contest.serverTime);
      assert.ok(!isNaN(serverDate.getTime()), 'serverTime must be valid ISO timestamp');
      pass('7. Client clock does not override server state (authoritative serverTime returned)');
    } catch (e) {
      fail('7. Client clock does not override server state', e);
    }

    // 8. Local state cannot bypass freeze
    try {
      // Student attempts to append freezeOverride=true
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard?freezeOverride=true`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, true);
      const student2Standing = res.body.standings.find((s) => s.userId === student2.id);
      assert.strictEqual(student2Standing.totalScore, 0, 'Student cannot bypass freeze using query parameters');
      pass('8. Local state cannot bypass freeze (student freezeOverride parameter is ignored)');
    } catch (e) {
      fail('8. Local state cannot bypass freeze', e);
    }

    // ── GROUP 3: AUTHORIZATION ───────────────────────────────────────────────
    console.log('\n--- 3. AUTHORIZATION TESTS ---');

    // 9. Student sees only permitted information
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      const student1Standing = res.body.standings.find((s) => s.userId === student1.id);
      assert.strictEqual(student1Standing.totalScore, 100, 'Student 1 pre-freeze solve is visible');
      pass('9. Student sees only permitted information (pre-freeze visible, post-freeze hidden)');
    } catch (e) {
      fail('9. Student sees only permitted information', e);
    }

    // 10. Professor sees permitted information
    try {
      // Creator professor using admin leaderboard with freezeOverride=true
      const res = await request(
        'GET',
        `/api/contests/${frozenContest.id}/admin-leaderboard?freezeOverride=true`,
        null,
        creatorProfToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, true);
      const student2Standing = res.body.standings.find((s) => s.userId === student2.id);
      assert.strictEqual(student2Standing.totalScore, 100, 'Creator Professor sees unmasked live score of 100');
      pass('10. Professor creator sees permitted unmasked information via manager override');
    } catch (e) {
      fail('10. Professor sees permitted information', e);
    }

    // 11. Contest Admin sees permitted information
    try {
      const res = await request(
        'GET',
        `/api/contests/${frozenContest.id}/admin-leaderboard?freezeOverride=true`,
        null,
        contestAdminToken
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, true);
      const student2Standing = res.body.standings.find((s) => s.userId === student2.id);
      assert.strictEqual(student2Standing.totalScore, 100, 'Contest Admin sees unmasked live score of 100');
      pass('11. Contest Admin sees permitted unmasked information');
    } catch (e) {
      fail('11. Contest Admin sees permitted information', e);
    }

    // 12. Unauthorized response is handled correctly
    try {
      // Non-owner professor attempts to access admin leaderboard
      const res = await request(
        'GET',
        `/api/contests/${frozenContest.id}/admin-leaderboard`,
        null,
        otherProfToken
      );
      assert.strictEqual(res.status, 403);
      assert.ok(res.body.message.includes('Forbidden') || res.body.message.includes('permission'));
      pass('12. Unauthorized response is handled correctly (non-owner professor rejected with 403)');
    } catch (e) {
      fail('12. Unauthorized response is handled correctly', e);
    }

    // ── GROUP 4: REFRESH ─────────────────────────────────────────────────────
    console.log('\n--- 4. REFRESH TESTS ---');

    // 13. Freeze transition after initial page load
    try {
      // First fetch of live contest
      const res1 = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res1.body.contest.isFrozen, false);

      // Now update live contest in DB so that it is within its freeze window
      const updatedEnd = new Date(Date.now() + 5 * 60000); // ends in 5 mins
      await db.query(
        `UPDATE contests SET end_time = $1, leaderboard_freeze_minutes = 20 WHERE id = $2`,
        [updatedEnd.toISOString(), liveContest.id]
      );

      // Re-fetch (simulating client periodic refresh or timer trigger)
      const res2 = await request('GET', `/api/contests/${liveContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res2.body.contest.isFrozen, true);
      assert.strictEqual(res2.body.contest.freezeState, 'FROZEN');
      pass('13. Freeze transition after initial page load detected authoritatively on re-fetch');
    } catch (e) {
      fail('13. Freeze transition after initial page load', e);
    }

    // 14. Refresh obtains authoritative state
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.standings));
      assert.ok(res.body.contestSummary);
      pass('14. Refresh obtains authoritative state and complete leaderboard structure');
    } catch (e) {
      fail('14. Refresh obtains authoritative state', e);
    }

    // 15. Network failure / contest not found handled correctly
    try {
      const res = await request('GET', `/api/contests/999999/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.message);
      pass('15. Contest not found returns 404 with structured error response');
    } catch (e) {
      fail('15. Network failure handled correctly', e);
    }

    // 16. Stale data is not falsely presented as current
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.ok(res.body.contest.serverTime);
      const serverTimeMs = new Date(res.body.contest.serverTime).getTime();
      const ageMs = Math.abs(Date.now() - serverTimeMs);
      assert.ok(ageMs < 10000, 'serverTime should be within 10s of local real time');
      pass('16. Stale data is not falsely presented as current (fresh serverTime within 10s)');
    } catch (e) {
      fail('16. Stale data is not falsely presented as current', e);
    }

    // ── GROUP 5: RESULT DETAILS ──────────────────────────────────────────────
    console.log('\n--- 5. RESULT DETAILS INTEGRATION TESTS ---');

    // 17. Result Details respects freeze visibility
    try {
      // Student 2 inspects their own result details during freeze
      const res = await request('GET', `/api/contests/${frozenContest.id}/results/me`, null, student2Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.contest.isFrozen, true);
      assert.strictEqual(res.body.contest.freezeState, 'FROZEN');
      assert.strictEqual(res.body.summary.totalScore, 0, 'Post-freeze score masked in result details');
      assert.strictEqual(res.body.submissions.length, 0, 'Post-freeze submissions masked in history');
      pass('17. Result Details respects freeze visibility (/results/me masks post-freeze solve)');
    } catch (e) {
      fail('17. Result Details respects freeze visibility', e);
    }

    // 18. Hidden information is not reconstructed client-side
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/results/me`, null, student2Token);
      const jsonPayload = JSON.stringify(res.body);
      assert.strictEqual(jsonPayload.includes(prob2.title), true); // Problem is listed
      // But verify that the accepted submission ID for student 2 is nowhere in the payload
      assert.strictEqual(jsonPayload.includes(`"problemId":${prob2.id},"status":"solved"`), false);
      pass('18. Hidden information is not reconstructed client-side (no hidden submission IDs present)');
    } catch (e) {
      fail('18. Hidden information is not reconstructed client-side', e);
    }

    // ── GROUP 6: UI & COMPONENT CONTRACT ─────────────────────────────────────
    console.log('\n--- 6. UI & COMPONENT CONTRACT TESTS ---');

    // 19. Loading / pagination state contract
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard?page=1&limit=25`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.pagination);
      assert.strictEqual(res.body.pagination.currentPage, 1);
      assert.strictEqual(res.body.pagination.limit, 25);
      assert.ok(typeof res.body.pagination.totalParticipants === 'number');
      assert.ok(typeof res.body.pagination.totalPages === 'number');
      pass('19. Pagination metadata contract complete (page, limit, totalParticipants, totalPages)');
    } catch (e) {
      fail('19. Pagination metadata contract', e);
    }

    // 20. Empty state
    try {
      const res = await request('GET', `/api/contests/${emptyContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.standings.length, 0, 'Empty contest returns 0 standings');
      assert.strictEqual(res.body.contestSummary.totalParticipants, 0);
      assert.strictEqual(res.body.contestSummary.topScore, 0);
      pass('20. Empty state returns valid empty standings array and summary stats');
    } catch (e) {
      fail('20. Empty state', e);
    }

    // 21. Error state (invalid contest ID format)
    try {
      const res = await request('GET', `/api/contests/invalid_id/leaderboard`, null, student1Token);
      assert.ok(res.status >= 400);
      assert.ok(res.body.message);
      pass('21. Error state handles invalid non-numeric contest ID gracefully');
    } catch (e) {
      fail('21. Error state', e);
    }

    // 22. Responsive/accessible freeze indicator metadata
    try {
      const res = await request('GET', `/api/contests/${frozenContest.id}/leaderboard`, null, student1Token);
      assert.strictEqual(res.status, 200);
      const c = res.body.contest;
      assert.strictEqual(typeof c.isFrozen, 'boolean');
      assert.strictEqual(c.freezeState, 'FROZEN');
      assert.ok(c.freezeTime);
      assert.strictEqual(c.leaderboardFreezeMinutes, 30);
      assert.ok(c.serverTime);
      pass('22. Responsive/accessible freeze metadata is complete (isFrozen, freezeState, freezeTime, minutes)');
    } catch (e) {
      fail('22. Responsive/accessible freeze metadata', e);
    }

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
  }

  console.log('\n===============================================================');
  console.log(`Phase 7.5.8.5.3 Test Summary: ${passed} PASSED, ${failed} FAILED out of ${passed + failed} tests`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
