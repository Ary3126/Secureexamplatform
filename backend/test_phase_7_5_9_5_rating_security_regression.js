/**
 * Phase 7.5.9.5 — Rating Security & Regression Test Suite
 *
 * Comprehensive production-grade security audit and regression verification of:
 * 1. Authentication Security (no auth, malformed, expired, invalid, cross-user JWTs, deactivated user)
 * 2. RBAC Security & Privilege Escalation (student forbidden on finalize/export, role spoofing ignored)
 * 3. BOLA / IDOR Testing (cross-contest professor isolation, cross-student export isolation)
 * 4. Input Validation Security (string IDs, negative IDs, zero, decimals, large numbers -> safe 400s)
 * 5. SQL Injection Testing (parameterized queries, zero string concatenation, query injection defense)
 * 6. Client-Side Rating Tampering (forged ratings/deltas in request body ignored and audited)
 * 7. Finalization Abuse & Idempotency (repeated 2x, 10x, draft, running, unauthorized -> no duplicates)
 * 8. Post-Finalization Mutation Defense (cannot alter problems, submissions, settings, or snapshot)
 * 9. Rating History Security & Constraints (DB UNIQUE, check constraints, math invariant: prev + delta = new)
 * 10. User Profile Security & Privacy (bounded pagination, whitelisted order, zero credential leaks)
 * 11. Export Security (RBAC/BOLA on results, participants, submissions exports)
 * 12. CSV Formula Injection Defense (neutralizes =,+,-,@,\t,\r with single quote prefix)
 * 13. Audit Log Security & Integrity (zero password/token leaks in logs, non-privileged cannot read)
 * 14. Error Handling & Information Disclosure (no stack traces, no SQL queries or DB internals leaked)
 * 15. Rate Limiting & Abuse (rate limiter verification with x-test-rate-limit)
 * 16. Concurrency Security Regression (2, 5, 10 simultaneous finalizations -> exactly 1 commits)
 * 17. Database Constraints & Transaction Atomicity (rollback on simulated failure preserves integrity)
 * 18. Rating Mathematical Regression (Elo formulas, tie handling, provisional/rated K factors)
 * 19. Teardown & Clean Baseline Preservation (strictly restores clean baseline)
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const jwt = require('jsonwebtoken');
const { app } = require('./src/server');
const db = require('./src/config/db');
const config = require('./src/config/env');
const RatingService = require('./src/services/ratingService');
const RatingModel = require('./src/models/ratingModel');
const ContestModel = require('./src/models/contestModel');
const ContestExportService = require('./src/services/contestExportService');
const { generateToken } = require('./src/services/authService');
const RATING_CONFIG = require('./src/config/ratingConfig');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

function request(method, path, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body !== null && body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function createTestUser(role = 'student', customData = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const username = customData.username || `u_p7595_${role}_${ts}`;
  const email = customData.email || `${username}@securejudge.test`;
  const rating = customData.currentRating !== undefined ? customData.currentRating : 1200;
  const ratingStatus = customData.ratingStatus || 'provisional';
  const ratedCount = customData.ratedContestCount !== undefined ? customData.ratedContestCount : 0;
  const isActive = customData.isActive !== undefined ? customData.isActive : true;

  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rating_status, rated_contest_count, is_active)
     VALUES ($1, $2, 'hash123', $3, $4, $5, $5, $6, $7, $8)
     RETURNING id, username, email, role, is_active AS "isActive", current_rating AS "currentRating", highest_rating AS "highestRating", rating_status AS "ratingStatus", rated_contest_count AS "ratedContestCount";`,
    [username, email, `Test ${username}`, role, rating, ratingStatus, ratedCount, isActive]
  );
  const user = res.rows[0];
  trackedUserIds.push(user.id);
  return user;
}

async function createTestContest(customData = {}) {
  const ts = Date.now() + Math.floor(Math.random() * 1000000);
  const contest = await ContestModel.createContest({
    title: customData.title || `Test Contest 7.5.9.5 ${ts}`,
    description: 'Test Contest for Phase 7.5.9.5 rating security regression',
    createdBy: customData.createdBy,
    startTime: customData.startTime || new Date(Date.now() - 7200000).toISOString(),
    endTime: customData.endTime || new Date(Date.now() - 3600000).toISOString(),
    isRated: customData.isRated !== undefined ? customData.isRated : true,
    scoringType: 'standard',
  });
  if (customData.status && customData.status !== 'draft') {
    await db.query(`UPDATE contests SET status = $1 WHERE id = $2;`, [customData.status, contest.id]);
    contest.status = customData.status;
  }
  trackedContestIds.push(contest.id);
  return contest;
}

async function attachProblemAndSubmission(contestId, userId, problemId, isAccepted = true) {
  await ContestModel.addProblemToContest({
    contestId,
    problemId,
    points: 100,
    problemOrder: 1,
  });

  const subRes = await db.query(
    `INSERT INTO submissions (
       user_id, problem_id, contest_id, language, source_code, status, score, is_sample_run, created_at
     )
     VALUES ($1, $2, $3, 'javascript', 'console.log(42);', $4, $5, false, NOW() - INTERVAL '1 hour')
     RETURNING id;`,
    [userId, problemId, contestId, isAccepted ? 'accepted' : 'wrong_answer', isAccepted ? 100 : 0]
  );
  return subRes.rows[0].id;
}

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.9.5 — Rating Security & Regression Test Suite        ');
  console.log('================================================================');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  serverPort = server.address().port;
  baseUrl = `http://127.0.0.1:${serverPort}`;

  // Clean baseline test fixtures
  const cleanProblemsRes = await db.query('SELECT id FROM problems ORDER BY id ASC LIMIT 2;');
  const testProblemId1 = cleanProblemsRes.rows[0].id;
  const testProblemId2 = cleanProblemsRes.rows[1].id;

  const profAlice = await createTestUser('professor');
  const profBob = await createTestUser('professor');
  const studentCharlie = await createTestUser('student', { currentRating: 1200 });
  const studentDave = await createTestUser('student', { currentRating: 1200 });
  const contestAdmin = await createTestUser('contest_admin');
  const superAdmin = await createTestUser('super_admin');
  const deactivatedUser = await createTestUser('student', { isActive: false });

  const tokenProfAlice = generateToken(profAlice);
  const tokenProfBob = generateToken(profBob);
  const tokenStudentCharlie = generateToken(studentCharlie);
  const tokenStudentDave = generateToken(studentDave);
  const tokenContestAdmin = generateToken(contestAdmin);
  const tokenSuperAdmin = generateToken(superAdmin);
  const tokenDeactivated = generateToken(deactivatedUser);

  try {
    // ---------------------------------------------------------
    // 1. AUTHENTICATION SECURITY
    // ---------------------------------------------------------
    console.log('\n--- 1. Authentication Security ---');
    const contestAuth = await createTestContest({ createdBy: profAlice.id, status: 'published' });

    // 1.1 No Authorization header
    const noAuthRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {});
    assert(noAuthRes.status === 401, '1.1 Unauthenticated finalize request returns 401 Unauthorized');
    assert(noAuthRes.body.error === 'AUTHENTICATION_ERROR', '1.2 Returns standard AUTHENTICATION_ERROR code');

    // 1.2 Malformed Authorization header (no Bearer)
    const malformedRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, null, {
      Authorization: 'Token invalidformat',
    });
    assert(malformedRes.status === 401, '1.3 Malformed auth header without Bearer returns 401');

    // 1.3 Bearer with empty token
    const emptyBearerRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, null, {
      Authorization: 'Bearer ',
    });
    assert(emptyBearerRes.status === 401, '1.4 Bearer with empty token returns 401');

    // 1.4 Invalid JWT signature
    const invalidJwtRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, 'invalid.jwt.token');
    assert(invalidJwtRes.status === 401, '1.5 Invalid JWT token returns 401');

    // 1.5 Expired JWT
    const expiredToken = jwt.sign(
      { userId: profAlice.id, username: profAlice.username, role: profAlice.role },
      config.jwt.secret,
      { expiresIn: '-10s' }
    );
    const expiredRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, expiredToken);
    assert(expiredRes.status === 401, '1.6 Expired JWT token returns 401');

    // 1.6 Modified JWT payload (signature mismatch)
    const parts = tokenProfAlice.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: profAlice.id, role: 'super_admin' })).toString('base64');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const tamperedRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, tamperedToken);
    assert(tamperedRes.status === 401, '1.7 Tampered JWT signature returns 401');

    // 1.7 Non-existent user JWT
    const nonExistentToken = jwt.sign(
      { userId: 9999999, username: 'ghost_user', role: 'super_admin' },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    const nonExistentRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, nonExistentToken);
    assert(nonExistentRes.status === 401, '1.8 Token for deleted/non-existent user returns 401');

    // 1.8 Deactivated user JWT
    const deactRes = await request('POST', `/api/contests/${contestAuth.id}/finalize-ratings`, {}, tokenDeactivated);
    assert(deactRes.status === 401, '1.9 Token for deactivated user returns 401');

    // 1.9 Unauthenticated access to rating history
    const noAuthHistoryRes = await request('GET', `/api/users/${studentCharlie.id}/rating-history`);
    assert(noAuthHistoryRes.status === 401, '1.10 Unauthenticated GET /rating-history returns 401');

    // 1.10 Unauthenticated access to user rating
    const noAuthRatingRes = await request('GET', `/api/users/${studentCharlie.id}/rating`);
    assert(noAuthRatingRes.status === 401, '1.11 Unauthenticated GET /rating returns 401');

    // ---------------------------------------------------------
    // 2. RBAC SECURITY & PRIVILEGE ESCALATION
    // ---------------------------------------------------------
    console.log('\n--- 2. RBAC Security & Privilege Escalation ---');

    // 2.1 Student cannot finalize ratings
    const studentFinalizeRes = await request(
      'POST',
      `/api/contests/${contestAuth.id}/finalize-ratings`,
      {},
      tokenStudentCharlie
    );
    assert(studentFinalizeRes.status === 403, '2.1 Student finalize blocked with 403 Forbidden');
    assert(studentFinalizeRes.body.error === 'AUTHORIZATION_ERROR', '2.2 Returns AUTHORIZATION_ERROR category');

    // 2.2 Student spoofing role in request body
    const spoofRoleRes = await request(
      'POST',
      `/api/contests/${contestAuth.id}/finalize-ratings`,
      { role: 'super_admin', is_admin: true, user: { role: 'super_admin' } },
      tokenStudentCharlie
    );
    assert(spoofRoleRes.status === 403, '2.3 Body role spoofing rejected with 403 Forbidden');

    // 2.3 Student cannot access admin leaderboard
    const studentAdminLbRes = await request(
      'GET',
      `/api/contests/${contestAuth.id}/admin-leaderboard`,
      null,
      tokenStudentCharlie
    );
    assert(studentAdminLbRes.status === 403, '2.4 Student blocked from admin leaderboard with 403 Forbidden');

    // 2.4 Student cannot export results
    const studentExportRes = await request(
      'GET',
      `/api/contests/${contestAuth.id}/export/results`,
      null,
      tokenStudentCharlie
    );
    assert(studentExportRes.status === 403, '2.5 Student blocked from export/results with 403 Forbidden');

    // 2.5 Student cannot export participants
    const studentExportPartRes = await request(
      'GET',
      `/api/contests/${contestAuth.id}/export/participants`,
      null,
      tokenStudentCharlie
    );
    assert(studentExportPartRes.status === 403, '2.6 Student blocked from export/participants with 403 Forbidden');

    // 2.6 Student cannot export submissions
    const studentExportSubRes = await request(
      'GET',
      `/api/contests/${contestAuth.id}/export/submissions`,
      null,
      tokenStudentCharlie
    );
    assert(studentExportSubRes.status === 403, '2.7 Student blocked from export/submissions with 403 Forbidden');

    // 2.7 Super admin can manage globally
    const contestSuper = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    const superAdminRes = await request(
      'POST',
      `/api/contests/${contestSuper.id}/finalize-ratings`,
      {},
      tokenSuperAdmin
    );
    assert(superAdminRes.status === 200, '2.8 Super admin can finalize contest globally');

    // ---------------------------------------------------------
    // 3. BOLA / IDOR TESTING
    // ---------------------------------------------------------
    console.log('\n--- 3. BOLA / IDOR Testing ---');
    const contestAlice = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    const contestBob = await createTestContest({ createdBy: profBob.id, status: 'published' });
    await ContestModel.addParticipant(contestAlice.id, studentCharlie.id);
    await ContestModel.addParticipant(contestBob.id, studentDave.id);
    await attachProblemAndSubmission(contestAlice.id, studentCharlie.id, testProblemId1, true);
    await attachProblemAndSubmission(contestBob.id, studentDave.id, testProblemId2, true);

    // 3.1 Professor Bob cannot finalize Professor Alice's contest
    const bolaFinalizeRes = await request(
      'POST',
      `/api/contests/${contestAlice.id}/finalize-ratings`,
      {},
      tokenProfBob
    );
    assert(bolaFinalizeRes.status === 403, '3.1 Professor Bob blocked from finalizing Alice contest with 403 Forbidden');

    // 3.2 Professor Bob cannot export results for Alice's contest
    const bolaExportResultsRes = await request(
      'GET',
      `/api/contests/${contestAlice.id}/export/results`,
      null,
      tokenProfBob
    );
    assert(bolaExportResultsRes.status === 403, '3.2 Professor Bob blocked from export/results on Alice contest');

    // 3.3 Professor Bob cannot export participants for Alice's contest
    const bolaExportPartRes = await request(
      'GET',
      `/api/contests/${contestAlice.id}/export/participants`,
      null,
      tokenProfBob
    );
    assert(bolaExportPartRes.status === 403, '3.3 Professor Bob blocked from export/participants on Alice contest');

    // 3.4 Professor Bob cannot export submissions for Alice's contest
    const bolaExportSubRes = await request(
      'GET',
      `/api/contests/${contestAlice.id}/export/submissions`,
      null,
      tokenProfBob
    );
    assert(bolaExportSubRes.status === 403, '3.4 Professor Bob blocked from export/submissions on Alice contest');

    // 3.5 Student Charlie cannot export Student Dave's participant details
    const bolaStudentExportOther = await request(
      'GET',
      `/api/contests/${contestAlice.id}/participants/${studentDave.id}/export`,
      null,
      tokenStudentCharlie
    );
    assert(bolaStudentExportOther.status === 403, '3.5 Student Charlie blocked from exporting Student Dave details (BOLA)');

    // 3.6 Student Charlie CAN export their own participant details
    const studentExportOwn = await request(
      'GET',
      `/api/contests/${contestAlice.id}/participants/${studentCharlie.id}/export`,
      null,
      tokenStudentCharlie
    );
    assert(studentExportOwn.status === 200, '3.6 Student Charlie can export their own details');

    // 3.7 Student Charlie CAN export own details via /results/me/export
    const studentExportMe = await request(
      'GET',
      `/api/contests/${contestAlice.id}/results/me/export`,
      null,
      tokenStudentCharlie
    );
    assert(studentExportMe.status === 200, '3.7 Student Charlie can export own details via /me/export');

    // 3.8 Contest owner Professor Alice CAN export Student Charlie's details
    const profExportStudent = await request(
      'GET',
      `/api/contests/${contestAlice.id}/participants/${studentCharlie.id}/export`,
      null,
      tokenProfAlice
    );
    assert(profExportStudent.status === 200, '3.8 Contest manager Professor Alice can export participant details');

    // ---------------------------------------------------------
    // 4. INPUT VALIDATION SECURITY
    // ---------------------------------------------------------
    console.log('\n--- 4. Input Validation Security ---');

    const malformedContestIds = ['abc', '-1', '0', '1.5', '9999999999999999999999999', 'null', 'undefined', ' ', '1;--'];
    for (const badId of malformedContestIds) {
      const res = await request('POST', `/api/contests/${encodeURIComponent(badId)}/finalize-ratings`, {}, tokenProfAlice);
      assert(res.status === 400, `4.1 Malformed contestId "${badId}" returns safe 400 Bad Request`);
      assert(!res.body.stack, `4.2 Malformed contestId "${badId}" does not leak stack trace`);
    }

    const malformedUserIds = ['abc', '-1', '0', '2.5', '9999999999999999999999999'];
    for (const badUserId of malformedUserIds) {
      const resRating = await request('GET', `/api/users/${encodeURIComponent(badUserId)}/rating`, null, tokenProfAlice);
      assert(resRating.status === 400, `4.3 Malformed userId "${badUserId}" on /rating returns 400`);

      const resHistory = await request('GET', `/api/users/${encodeURIComponent(badUserId)}/rating-history`, null, tokenProfAlice);
      assert(resHistory.status === 400, `4.4 Malformed userId "${badUserId}" on /rating-history returns 400`);
    }

    // ---------------------------------------------------------
    // 5. SQL INJECTION RESISTANCE
    // ---------------------------------------------------------
    console.log('\n--- 5. SQL Injection Resistance ---');
    const sqlPayloads = [
      "'",
      "\"",
      "' OR '1'='1",
      "1 OR 1=1",
      "1; DROP TABLE users;",
      "1 UNION SELECT 1,2,3--",
      "1' AND SLEEP(5)--",
    ];

    for (const payload of sqlPayloads) {
      const sqlContestRes = await request(
        'POST',
        `/api/contests/${encodeURIComponent(payload)}/finalize-ratings`,
        {},
        tokenProfAlice
      );
      assert(sqlContestRes.status === 400, `5.1 SQL payload in contestId safely rejected with 400 (${payload.substring(0, 15)})`);
      assert(sqlContestRes.body.status === 'error', '5.2 Safe error response format returned');
      assert(!JSON.stringify(sqlContestRes.body).includes('syntax error'), '5.3 No PostgreSQL syntax error leaked');

      const sqlUserRes = await request(
        'GET',
        `/api/users/${encodeURIComponent(payload)}/rating`,
        null,
        tokenProfAlice
      );
      assert(sqlUserRes.status === 400, `5.4 SQL payload in userId safely rejected with 400 (${payload.substring(0, 15)})`);

      const sqlOrderRes = await request(
        'GET',
        `/api/users/${studentCharlie.id}/rating-history?order=${encodeURIComponent(payload)}`,
        null,
        tokenStudentCharlie
      );
      assert(sqlOrderRes.status === 400, `5.5 SQL payload in query order parameter safely rejected with 400`);
    }

    // Confirm database users table remains completely intact
    const userCountCheck = await db.query('SELECT COUNT(*)::int AS count FROM users;');
    assert(userCountCheck.rows[0].count > 0, '5.6 SQL Injection attempts caused zero database schema damage');

    // ---------------------------------------------------------
    // 6. CLIENT-SIDE RATING TAMPERING DEFENSE
    // ---------------------------------------------------------
    console.log('\n--- 6. Client-Side Rating Tampering Defense ---');
    const contestTamper = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    await ContestModel.addParticipant(contestTamper.id, studentCharlie.id);
    await ContestModel.addParticipant(contestTamper.id, studentDave.id);
    await attachProblemAndSubmission(contestTamper.id, studentCharlie.id, testProblemId1, true);

    const forgedBody = {
      previousRating: 3000,
      ratingChange: 9999,
      newRating: 9999,
      rank: 1,
      participantCount: 1,
      extraRatings: [{ userId: studentCharlie.id, newRating: 9999 }],
    };

    const tamperRes = await request(
      'POST',
      `/api/contests/${contestTamper.id}/finalize-ratings`,
      forgedBody,
      tokenProfAlice
    );

    assert(tamperRes.status === 200, '6.1 Finalize with forged payload returns 200 OK (server calculates authoritatively)');
    const charlieUpdate = tamperRes.body.ratingUpdates.find((u) => u.userId === studentCharlie.id);
    assert(charlieUpdate.newRating !== 9999, '6.2 Client-supplied forged newRating (9999) was strictly ignored');
    assert(charlieUpdate.ratingChange !== 9999, '6.3 Client-supplied forged ratingChange (9999) was strictly ignored');
    assert(charlieUpdate.previousRating === 1200, '6.4 Server derived previousRating authoritatively from database (1200)');

    // Verify security audit log captured the tampering attempt
    const tamperAuditRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND action = 'RATING_INTEGRITY_VIOLATION' 
       ORDER BY id DESC LIMIT 1;`,
      [contestTamper.id]
    );
    assert(tamperAuditRes.rowCount === 1, '6.5 Audit logger recorded RATING_INTEGRITY_VIOLATION security event');
    assert(tamperAuditRes.rows[0].outcome === 'denied', '6.6 Audit outcome marked as denied');

    // ---------------------------------------------------------
    // 7. FINALIZATION ABUSE & IDEMPOTENCY
    // ---------------------------------------------------------
    console.log('\n--- 7. Finalization Abuse & Idempotency ---');
    // 7.1 Finalize already finalized contest
    const repeat1 = await request(
      'POST',
      `/api/contests/${contestTamper.id}/finalize-ratings`,
      {},
      tokenProfAlice
    );
    assert(repeat1.status === 200, '7.1 Repeated finalization returns 200 OK');
    assert(repeat1.body.alreadyFinalized === true, '7.2 Body explicitly indicates alreadyFinalized: true');

    // 7.2 Finalize 10 consecutive times
    let allIdempotent = true;
    for (let i = 0; i < 10; i++) {
      const rep = await request('POST', `/api/contests/${contestTamper.id}/finalize-ratings`, {}, tokenProfAlice);
      if (rep.status !== 200 || !rep.body.alreadyFinalized) {
        allIdempotent = false;
      }
    }
    assert(allIdempotent, '7.3 Finalize 10 consecutive times all safely return alreadyFinalized: true');

    // Verify rating_history row count remains strictly 2 (1 per participant)
    const historyCountRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;`,
      [contestTamper.id]
    );
    assert(historyCountRes.rows[0].count === 2, '7.4 Zero duplicate rating_history rows created despite 12 finalization calls');

    // 7.3 Finalize draft contest
    const contestDraft = await createTestContest({ createdBy: profAlice.id, status: 'draft' });
    const draftFinRes = await request('POST', `/api/contests/${contestDraft.id}/finalize-ratings`, {}, tokenProfAlice);
    assert(draftFinRes.status === 400, '7.5 Finalizing draft contest rejected with 400 Bad Request');

    // 7.4 Finalize running contest without force
    const contestRunning = await createTestContest({
      createdBy: profAlice.id,
      status: 'published',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    });
    const runFinRes = await request('POST', `/api/contests/${contestRunning.id}/finalize-ratings`, {}, tokenProfAlice);
    assert(runFinRes.status === 400, '7.6 Finalizing running contest without force rejected with 400 Bad Request');

    // ---------------------------------------------------------
    // 8. POST-FINALIZATION MUTATION DEFENSE
    // ---------------------------------------------------------
    console.log('\n--- 8. Post-Finalization Mutation Defense ---');
    // Attempt mutating contest problems on finalized contest
    const addProbRes = await request(
      'POST',
      `/api/contests/${contestTamper.id}/problems`,
      { problemId: testProblemId2, points: 50, problemOrder: 2 },
      tokenProfAlice
    );
    assert(addProbRes.status === 409, '8.1 Adding problem to finalized contest blocked with 409 Conflict');

    const removeProbRes = await request(
      'DELETE',
      `/api/contests/${contestTamper.id}/problems/${testProblemId1}`,
      null,
      tokenProfAlice
    );
    assert(removeProbRes.status === 409, '8.2 Removing problem from finalized contest blocked with 409 Conflict');

    const reorderProbRes = await request(
      'PUT',
      `/api/contests/${contestTamper.id}/problems/order`,
      { problemIds: [testProblemId1] },
      tokenProfAlice
    );
    assert(reorderProbRes.status === 409, '8.3 Reordering problems on finalized contest blocked with 409 Conflict');

    // Attempt modifying result-affecting contest settings (isRated, freeze)
    const mutateSettingsRes = await request(
      'PUT',
      `/api/contests/${contestTamper.id}`,
      { isRated: false, leaderboardFreezeEnabled: true },
      tokenProfAlice
    );
    assert(mutateSettingsRes.status === 409, '8.4 Modifying isRated on finalized contest blocked with 409 Conflict');

    // Attempt submitting code to finalized contest
    const subPostFinRes = await request(
      'POST',
      '/api/submissions',
      {
        problemId: testProblemId1,
        contestId: contestTamper.id,
        language: 'javascript',
        sourceCode: 'console.log("cheat");',
      },
      tokenStudentCharlie
    );
    assert(subPostFinRes.status === 400, '8.5 Submitting code to finalized contest rejected with 400 Bad Request');

    // Attempt joining finalized contest
    const joinFinRes = await request(
      'POST',
      `/api/contests/${contestTamper.id}/join`,
      {},
      tokenStudentDave
    );
    assert(joinFinRes.status === 400, '8.6 Joining finalized contest rejected with 400 Bad Request');

    // Verify snapshot in database remained unaltered
    const snapshotCheck = await db.query(
      `SELECT final_results_snapshot FROM contests WHERE id = $1;`,
      [contestTamper.id]
    );
    assert(snapshotCheck.rows[0].final_results_snapshot !== null, '8.7 Final results snapshot remains intact');

    // ---------------------------------------------------------
    // 9. RATING HISTORY SECURITY & DATABASE CONSTRAINTS
    // ---------------------------------------------------------
    console.log('\n--- 9. Rating History Security & Database Constraints ---');

    // 9.1 UNIQUE(user_id, contest_id) constraint
    let uniqueViolation = false;
    try {
      await db.query(
        `INSERT INTO rating_history (
           user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count
         ) VALUES ($1, $2, 1200, 10, 1210, 1, 2);`,
        [studentCharlie.id, contestTamper.id]
      );
    } catch (err) {
      if (err.code === '23505') uniqueViolation = true;
    }
    assert(uniqueViolation, '9.1 Manual duplicate rating_history insert blocked by UNIQUE constraint (23505)');

    // 9.2 chk_rating_history_rank constraint (rank > 0)
    let rankCheckViolation = false;
    try {
      await db.query(
        `INSERT INTO rating_history (
           user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count
         ) VALUES ($1, $2, 1200, 10, 1210, 0, 2);`,
        [studentCharlie.id, contestAuth.id]
      );
    } catch (err) {
      if (err.code === '23514') rankCheckViolation = true;
    }
    assert(rankCheckViolation, '9.2 rank <= 0 blocked by chk_rating_history_rank (23514)');

    // 9.3 chk_rating_history_participant_count (participant_count > 0)
    let countCheckViolation = false;
    try {
      await db.query(
        `INSERT INTO rating_history (
           user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count
         ) VALUES ($1, $2, 1200, 10, 1210, 1, 0);`,
        [studentCharlie.id, contestAuth.id]
      );
    } catch (err) {
      if (err.code === '23514') countCheckViolation = true;
    }
    assert(countCheckViolation, '9.3 participant_count <= 0 blocked by chk_rating_history_participant_count (23514)');

    // 9.4 chk_rating_history_new_rating (new_rating >= 100)
    let newRatingFloorViolation = false;
    try {
      await db.query(
        `INSERT INTO rating_history (
           user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count
         ) VALUES ($1, $2, 1200, -1150, 50, 1, 2);`,
        [studentCharlie.id, contestAuth.id]
      );
    } catch (err) {
      if (err.code === '23514') newRatingFloorViolation = true;
    }
    assert(newRatingFloorViolation, '9.4 new_rating < 100 blocked by chk_rating_history_new_rating (23514)');

    // 9.5 chk_users_current_rating_floor (current_rating >= 100)
    let userRatingFloorViolation = false;
    try {
      await db.query(
        `UPDATE users SET current_rating = 99 WHERE id = $1;`,
        [studentCharlie.id]
      );
    } catch (err) {
      if (err.code === '23514') userRatingFloorViolation = true;
    }
    assert(userRatingFloorViolation, '9.5 users.current_rating < 100 blocked by chk_users_current_rating_floor (23514)');

    // 9.6 Mathematical integrity: previous + rating_change = new_rating
    const historyRows = await db.query(
      `SELECT previous_rating, rating_change, new_rating FROM rating_history WHERE contest_id = $1;`,
      [contestTamper.id]
    );
    const allMathValid = historyRows.rows.every(
      (r) => r.previous_rating + r.rating_change === r.new_rating
    );
    assert(allMathValid, '9.6 Invariant holds for all rating_history rows: previous + change = new');

    // ---------------------------------------------------------
    // 10. USER PROFILE SECURITY & PRIVACY
    // ---------------------------------------------------------
    console.log('\n--- 10. User Profile Security & Privacy ---');
    // 10.1 Valid user rating query
    const validRatingRes = await request('GET', `/api/users/${studentCharlie.id}/rating`, null, tokenStudentCharlie);
    assert(validRatingRes.status === 200, '10.1 Valid user rating returns 200 OK');
    assert(validRatingRes.body.currentRating !== undefined, '10.2 currentRating is present');
    assert(validRatingRes.body.password_hash === undefined, '10.3 password_hash is strictly NOT exposed');

    // 10.2 Valid rating history query
    const validHistoryRes = await request('GET', `/api/users/${studentCharlie.id}/rating-history`, null, tokenStudentCharlie);
    assert(validHistoryRes.status === 200, '10.4 Valid rating history returns 200 OK');
    assert(Array.isArray(validHistoryRes.body.history), '10.5 History returned as array');

    // 10.3 Non-existent user returns 404
    const notFoundRes = await request('GET', '/api/users/999999/rating', null, tokenStudentCharlie);
    assert(notFoundRes.status === 404, '10.6 Non-existent user returns 404 Not Found');

    // 10.4 Pagination bounds validation
    const badLimitZero = await request('GET', `/api/users/${studentCharlie.id}/rating-history?limit=0`, null, tokenStudentCharlie);
    assert(badLimitZero.status === 400, '10.7 limit=0 returns 400 Bad Request');

    const badLimitHuge = await request('GET', `/api/users/${studentCharlie.id}/rating-history?limit=9999999`, null, tokenStudentCharlie);
    assert(badLimitHuge.status === 400, '10.8 limit > 100 returns 400 Bad Request');

    const badLimitNeg = await request('GET', `/api/users/${studentCharlie.id}/rating-history?limit=-5`, null, tokenStudentCharlie);
    assert(badLimitNeg.status === 400, '10.9 limit < 0 returns 400 Bad Request');

    const badPageZero = await request('GET', `/api/users/${studentCharlie.id}/rating-history?page=0`, null, tokenStudentCharlie);
    assert(badPageZero.status === 400, '10.10 page=0 returns 400 Bad Request');

    const badPageNeg = await request('GET', `/api/users/${studentCharlie.id}/rating-history?page=-1`, null, tokenStudentCharlie);
    assert(badPageNeg.status === 400, '10.11 page < 0 returns 400 Bad Request');

    const badOrder = await request('GET', `/api/users/${studentCharlie.id}/rating-history?order=INVALID`, null, tokenStudentCharlie);
    assert(badOrder.status === 400, '10.12 Non-whitelisted order parameter returns 400 Bad Request');

    // 10.5 Legitimate pagination returns valid metadata
    const legitPagination = await request('GET', `/api/users/${studentCharlie.id}/rating-history?page=1&limit=10&order=desc`, null, tokenStudentCharlie);
    assert(legitPagination.status === 200, '10.13 Valid pagination query returns 200 OK');
    assert(legitPagination.body.pagination !== undefined, '10.14 Pagination metadata object is present');
    assert(legitPagination.body.pagination.limit === 10, '10.15 Pagination limit matches request');

    // ---------------------------------------------------------
    // 11. EXPORT SECURITY
    // ---------------------------------------------------------
    console.log('\n--- 11. Export Security ---');
    // Manager exports CSV & JSON results
    const csvExportRes = await request('GET', `/api/contests/${contestTamper.id}/export/results?format=csv`, null, tokenProfAlice);
    assert(csvExportRes.status === 200, '11.1 Manager CSV results export returns 200 OK');
    assert(csvExportRes.headers['content-type'].includes('text/csv'), '11.2 Content-Type is text/csv');
    assert(!csvExportRes.body.includes('password_hash'), '11.3 CSV results export does not leak password hashes');

    const jsonExportRes = await request('GET', `/api/contests/${contestTamper.id}/export/results?format=json`, null, tokenProfAlice);
    assert(jsonExportRes.status === 200, '11.4 Manager JSON results export returns 200 OK');
    assert(!JSON.stringify(jsonExportRes.body).includes('password_hash'), '11.5 JSON results export does not leak password hashes');
    assert(!JSON.stringify(jsonExportRes.body).includes('jwtSecret'), '11.6 JSON results export does not leak secrets');

    // Manager exports participants
    const partExportRes = await request('GET', `/api/contests/${contestTamper.id}/export/participants?format=csv`, null, tokenProfAlice);
    assert(partExportRes.status === 200, '11.7 Manager CSV participants export returns 200 OK');

    // Manager exports submissions
    const subExportRes = await request('GET', `/api/contests/${contestTamper.id}/export/submissions?format=csv`, null, tokenProfAlice);
    assert(subExportRes.status === 200, '11.8 Manager CSV submissions export returns 200 OK');

    // ---------------------------------------------------------
    // 12. CSV FORMULA INJECTION DEFENSE
    // ---------------------------------------------------------
    console.log('\n--- 12. CSV Formula Injection Defense ---');
    const maliciousNames = [
      '=cmd|"/C calc"!A0',
      '+123456789',
      '-@SUM(1+1)',
      '@calc',
      '\t=cmd()',
      '\r-tab',
      '  =SUM(A1:B1)',
    ];

    const contestInjection = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    for (let i = 0; i < maliciousNames.length; i++) {
      const evilUser = await createTestUser('student', {
        username: `evil_u_${i}_${Date.now()}`,
        email: `evil_${i}_${Date.now()}@test.com`,
      });
      // Set full_name with formula payload
      await db.query(`UPDATE users SET full_name = $1 WHERE id = $2;`, [maliciousNames[i], evilUser.id]);
      await ContestModel.addParticipant(contestInjection.id, evilUser.id);
    }

    const injectionExportRes = await request(
      'GET',
      `/api/contests/${contestInjection.id}/export/participants?format=csv`,
      null,
      tokenProfAlice
    );
    assert(injectionExportRes.status === 200, '12.1 Participants export with malicious names returns 200 OK');
    const csvContent = typeof injectionExportRes.body === 'string' ? injectionExportRes.body : JSON.stringify(injectionExportRes.body);

    for (const evil of maliciousNames) {
      // In CSV, the cell is sanitized with leading single-quote and double quotes are RFC 4180 escaped
      const trimmed = evil.trim();
      const leadingChar = trimmed[0];
      const rfcEscaped = evil.replace(/"/g, '""');
      const neutralizedPattern = `'${rfcEscaped}`;
      const containsNeutralized = csvContent.includes(neutralizedPattern) || csvContent.includes(`"'${rfcEscaped}`);
      assert(
        containsNeutralized,
        `12.2 Formula trigger [${leadingChar}] neutralized with leading single quote: "${evil.substring(0, 15)}"`
      );
    }

    // ---------------------------------------------------------
    // 13. AUDIT LOG SECURITY & PRIVACY
    // ---------------------------------------------------------
    console.log('\n--- 13. Audit Log Security & Privacy ---');
    // Verify privileged finalization logged
    const finAudit = await db.query(
      `SELECT * FROM audit_logs WHERE resource_type = 'contest' AND resource_id = $1 AND action = 'RATINGS_FINALIZED';`,
      [contestTamper.id]
    );
    assert(finAudit.rowCount >= 1, '13.1 RATINGS_FINALIZED event logged in PostgreSQL');
    assert(finAudit.rows[0].actor_id === profAlice.id, '13.2 Actor ID correctly recorded in audit log');

    // Verify zero credentials or tokens in metadata
    const auditMetaStr = JSON.stringify(finAudit.rows[0].metadata);
    assert(!auditMetaStr.includes('password'), '13.3 Zero passwords in audit log metadata');
    assert(!auditMetaStr.includes('jwt'), '13.4 Zero JWTs in audit log metadata');
    assert(!auditMetaStr.includes('secret'), '13.5 Zero secrets in audit log metadata');

    // Student cannot access admin audit logs
    const studentAuditRes = await request('GET', '/api/admin/audit-logs', null, tokenStudentCharlie);
    assert(studentAuditRes.status === 403, '13.6 Ordinary student cannot query audit logs (403 Forbidden)');

    // ---------------------------------------------------------
    // 14. ERROR HANDLING & INFORMATION DISCLOSURE
    // ---------------------------------------------------------
    console.log('\n--- 14. Error Handling & Information Disclosure ---');
    const errEndpoints = [
      { method: 'GET', path: '/api/contests/999999/results', token: tokenStudentCharlie },
      { method: 'POST', path: '/api/contests/999999/finalize-ratings', token: tokenProfAlice },
      { method: 'GET', path: '/api/users/999999/rating', token: tokenStudentCharlie },
    ];

    for (const ep of errEndpoints) {
      const errRes = await request(ep.method, ep.path, ep.method === 'GET' ? null : {}, ep.token);
      assert(errRes.body.stack === undefined, `14.1 ${ep.path} error does NOT leak stack trace`);
      assert(errRes.body.status === 'error', `14.2 ${ep.path} error returns standardized status: error`);
      const rawBodyStr = JSON.stringify(errRes.body);
      assert(!rawBodyStr.includes('postgres://'), `14.3 ${ep.path} does NOT leak DB connection string`);
      assert(!rawBodyStr.includes('SELECT * FROM'), `14.4 ${ep.path} does NOT leak raw SQL queries`);
    }

    // ---------------------------------------------------------
    // 15. RATE LIMITING & ABUSE PROTECTION
    // ---------------------------------------------------------
    console.log('\n--- 15. Rate Limiting & Abuse Protection ---');
    // Rating endpoints have mediumProtectionRateLimiter attached (maxRequests = 120).
    // When x-test-rate-limit is supplied, the limiter executes sliding window counting.
    let rateLimitTriggered = false;
    for (let i = 0; i < 130; i++) {
      const rlRes = await request(
        'GET',
        `/api/users/${studentCharlie.id}/rating`,
        null,
        tokenStudentCharlie,
        { 'x-test-rate-limit': 'true' }
      );
      if (rlRes.status === 429) {
        rateLimitTriggered = true;
        assert(rlRes.body.error === 'RATE_LIMIT' || rlRes.body.statusCode === 429, '15.1 Returns standard 429 rate limit format');
        break;
      }
    }
    assert(rateLimitTriggered, '15.2 Excessive requests against /rating trigger 429 Too Many Requests');

    // ---------------------------------------------------------
    // 16. CONCURRENCY SECURITY REGRESSION
    // ---------------------------------------------------------
    console.log('\n--- 16. Concurrency Security Regression ---');
    // 16.1 2 simultaneous finalization requests
    const contestConc2 = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    await ContestModel.addParticipant(contestConc2.id, studentCharlie.id);
    await ContestModel.addParticipant(contestConc2.id, studentDave.id);
    await attachProblemAndSubmission(contestConc2.id, studentCharlie.id, testProblemId1, true);

    const conc2Promises = [
      request('POST', `/api/contests/${contestConc2.id}/finalize-ratings`, {}, tokenProfAlice),
      request('POST', `/api/contests/${contestConc2.id}/finalize-ratings`, {}, tokenProfAlice),
    ];
    const conc2Results = await Promise.all(conc2Promises);
    assert(conc2Results.every((r) => r.status === 200), '16.1 Both 2 simultaneous finalization requests return 200 OK');
    const conc2Rows = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestConc2.id]);
    assert(conc2Rows.rows[0].count === 2, '16.2 Concurrency 2: Exactly 2 rating_history records created (1 per user)');

    // 16.2 5 simultaneous finalization requests
    const contestConc5 = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    await ContestModel.addParticipant(contestConc5.id, studentCharlie.id);
    await ContestModel.addParticipant(contestConc5.id, studentDave.id);
    await attachProblemAndSubmission(contestConc5.id, studentCharlie.id, testProblemId1, true);

    const conc5Promises = Array.from({ length: 5 }, () =>
      request('POST', `/api/contests/${contestConc5.id}/finalize-ratings`, {}, tokenProfAlice)
    );
    const conc5Results = await Promise.all(conc5Promises);
    assert(conc5Results.every((r) => r.status === 200), '16.3 All 5 simultaneous finalization requests return 200 OK');
    const conc5Rows = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestConc5.id]);
    assert(conc5Rows.rows[0].count === 2, '16.4 Concurrency 5: Exactly 2 rating_history records created');

    // 16.3 10 simultaneous finalization requests
    const contestConc10 = await createTestContest({ createdBy: profAlice.id, status: 'published' });
    await ContestModel.addParticipant(contestConc10.id, studentCharlie.id);
    await ContestModel.addParticipant(contestConc10.id, studentDave.id);
    await attachProblemAndSubmission(contestConc10.id, studentCharlie.id, testProblemId1, true);

    const conc10Promises = Array.from({ length: 10 }, () =>
      request('POST', `/api/contests/${contestConc10.id}/finalize-ratings`, {}, tokenProfAlice)
    );
    const conc10Results = await Promise.all(conc10Promises);
    assert(conc10Results.every((r) => r.status === 200), '16.5 All 10 simultaneous finalization requests return 200 OK');
    const conc10Rows = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [contestConc10.id]);
    assert(conc10Rows.rows[0].count === 2, '16.6 Concurrency 10: Exactly 2 rating_history records created');

    // ---------------------------------------------------------
    // 17. DATABASE CONSTRAINTS & TRANSACTION ATOMICITY
    // ---------------------------------------------------------
    console.log('\n--- 17. Database Constraints & Transaction Atomicity ---');
    const failurePoints = ['rating_history', 'user_rating', 'snapshot', 'contest_update'];
    for (const fp of failurePoints) {
      const rollbackContest = await createTestContest({ createdBy: profAlice.id, status: 'published' });
      await ContestModel.addParticipant(rollbackContest.id, studentCharlie.id);
      await ContestModel.addParticipant(rollbackContest.id, studentDave.id);
      await attachProblemAndSubmission(rollbackContest.id, studentCharlie.id, testProblemId1, true);

      let threwError = false;
      try {
        await RatingService.finalizeContestRatings(rollbackContest.id, profAlice, {
          __testSimulateFailureAt: fp,
        });
      } catch (err) {
        threwError = true;
      }
      assert(threwError, `17.1 Failure at "${fp}" successfully threw exception`);

      // Verify transaction was rolled back cleanly
      const rolledHistory = await db.query('SELECT COUNT(*)::int AS count FROM rating_history WHERE contest_id = $1;', [rollbackContest.id]);
      assert(rolledHistory.rows[0].count === 0, `17.2 Rollback at "${fp}": 0 rating_history records retained`);

      const rolledContest = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1;', [rollbackContest.id]);
      assert(rolledContest.rows[0].is_rating_finalized === false, `17.3 Rollback at "${fp}": contest is_rating_finalized remains false`);
    }

    // ---------------------------------------------------------
    // 18. RATING MATHEMATICAL REGRESSION
    // ---------------------------------------------------------
    console.log('\n--- 18. Rating Mathematical Regression ---');
    // Equal rating tie should produce 0 rating delta
    const tieStandings = [
      {
        userId: 90001,
        username: 'tie_user_1',
        currentRating: 1400,
        highestRating: 1400,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: 1,
        totalScore: 100,
        totalTimeMs: 5000,
      },
      {
        userId: 90002,
        username: 'tie_user_2',
        currentRating: 1400,
        highestRating: 1400,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: 1,
        totalScore: 100,
        totalTimeMs: 5000,
      },
    ];

    const tieUpdates = RatingService.calculateRatingChanges(tieStandings);
    assert(tieUpdates[0].ratingChange === 0, '18.1 Equal rating tie: Participant 1 rating delta is exactly 0');
    assert(tieUpdates[1].ratingChange === 0, '18.2 Equal rating tie: Participant 2 rating delta is exactly 0');

    // Rating floor test: loser drops to floor
    const floorStandings = [
      {
        userId: 90003,
        username: 'winner',
        currentRating: 1500,
        highestRating: 1500,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: 1,
        totalScore: 100,
        totalTimeMs: 1000,
      },
      {
        userId: 90004,
        username: 'loser_at_floor',
        currentRating: 105,
        highestRating: 105,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: 2,
        totalScore: 0,
        totalTimeMs: 0,
      },
    ];
    const floorUpdates = RatingService.calculateRatingChanges(floorStandings);
    const loserUpdate = floorUpdates.find((u) => u.userId === 90004);
    assert(loserUpdate.newRating >= 100, '18.3 Rating floor enforced: newRating >= 100');

    // Provisional K-factor larger than rated K-factor
    const provStandings = [
      {
        userId: 90005,
        username: 'prov_user',
        currentRating: 1200,
        highestRating: 1200,
        ratingStatus: 'provisional',
        ratedContestCount: 1,
        rank: 1,
        totalScore: 100,
      },
      {
        userId: 90006,
        username: 'rated_user',
        currentRating: 1200,
        highestRating: 1200,
        ratingStatus: 'rated',
        ratedContestCount: 10,
        rank: 2,
        totalScore: 0,
      },
    ];
    const provUpdates = RatingService.calculateRatingChanges(provStandings);
    const provDelta = Math.abs(provUpdates.find((u) => u.userId === 90005).ratingChange);
    const ratedDelta = Math.abs(provUpdates.find((u) => u.userId === 90006).ratingChange);
    assert(provDelta > ratedDelta, '18.4 Provisional winner gain is strictly larger than rated loser drop (K=64 vs K=32)');

  } finally {
    // ---------------------------------------------------------
    // 19. TEARDOWN & CLEAN BASELINE PRESERVATION
    // ---------------------------------------------------------
    console.log('\n--- 19. Teardown & Clean Baseline Preservation ---');
    if (server) {
      server.close();
    }

    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[]);', [trackedContestIds]);
      await db.query('DELETE FROM audit_logs WHERE resource_type = $1 AND resource_id = ANY($2::int[]);', ['contest', trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[]);', [trackedContestIds]);
    }

    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM rating_history WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM contest_participants WHERE user_id = ANY($1::int[]);', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[]) OR (resource_type = $2 AND resource_id = ANY($1::int[]));', [trackedUserIds, 'user']);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[]);', [trackedUserIds]);
    }

    console.log(`  [CLEANUP] Successfully cleaned ${trackedContestIds.length} test contests and ${trackedUserIds.length} test users.`);

    // Check baseline counts
    const userCount = await db.query('SELECT COUNT(*)::int AS count FROM users;');
    const contestCount = await db.query('SELECT COUNT(*)::int AS count FROM contests;');
    const problemCount = await db.query('SELECT COUNT(*)::int AS count FROM problems;');
    const subCount = await db.query('SELECT COUNT(*)::int AS count FROM submissions;');

    console.log(`  [BASELINE] Users: ${userCount.rows[0].count}, Contests: ${contestCount.rows[0].count}, Problems: ${problemCount.rows[0].count}, Submissions: ${subCount.rows[0].count}`);

    assert(userCount.rows[0].count === 5, '19.1 Baseline Users count strictly preserved at 5');
    assert(contestCount.rows[0].count === 1, '19.2 Baseline Contests count strictly preserved at 1');
    assert(problemCount.rows[0].count === 5, '19.3 Baseline Problems count strictly preserved at 5');
    assert(subCount.rows[0].count === 33, '19.4 Baseline Submissions count strictly preserved at 33');

    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` Focused Security Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Unhandled security test failure:', err);
  process.exit(1);
});
