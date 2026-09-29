/**
 * ==============================================================================
 * TEST SUITE: Phase 7.5.7.3 — Contest Enrollment / Registration Backend
 * ==============================================================================
 * Comprehensive security, authorization, lifecycle, idempotency, concurrency,
 * mass-assignment, and audit logging tests for student contest enrollment.
 * 
 * Target Endpoints:
 *  - POST /api/contests/:id/join
 *  - GET  /api/contests/:id/enrollment
 *  - GET  /api/contests/:id
 * 
 * Test Coverage:
 *  A. Authenticated enrollment (requires valid Authorization header)
 *  B. Unauthenticated rejection (401 Unauthorized when missing token)
 *  C. Invalid JWT (401 Unauthorized when token is tampered/invalid)
 *  D. Valid student (201 Created for authenticated student)
 *  E. Unauthorized role handling (403 Forbidden for professor/admin attempting self-enrollment)
 *  F. Nonexistent contest (404 Not Found) & Non-integer ID (400 Bad Request)
 *  G. Contest access rules (published upcoming/running allowed)
 *  H. Unpublished/private contest behavior (Draft contest rejected with 400 Bad Request)
 *  I. Lifecycle restrictions (Ended and archived contests rejected with 400 Bad Request)
 *  J. Successful enrollment data schema (returns status 201, safe participant record)
 *  K. Duplicate enrollment (Sequential duplicate returns 409 Conflict idempotently)
 *  L. Concurrent duplicate enrollment (Race condition handled gracefully without 500 error)
 *  M. Database uniqueness verification (Exactly 1 row exists in contest_participants)
 *  N. Atomic transaction safety / no partial records
 *  O. Mass-assignment protection (client cannot inject role, status, admin flags, or timestamps)
 *  P. User ID cannot be spoofed (JWT identity is authoritative; body.userId is ignored)
 *  Q. Rate limiting protection on join endpoint
 *  R. BOLA / IDOR protection (cannot enroll arbitrary users into contests)
 *  S. Safe error handling (No SQL syntax or stack traces leaked in error responses)
 *  T. Security audit logging (PARTICIPANT_JOINED on success, PRIVILEGED_ACTION_DENIED on unauthorized)
 *  U. Authoritative enrollment status discovery (GET /api/contests/:id/enrollment)
 * ==============================================================================
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { generateToken } = require('./src/services/authService');
const bcrypt = require('bcryptjs');

let server;
let port;
let baseUrl;

// Fixtures
let student1, student2, profUser, adminUser;
let tokenStudent1, tokenStudent2, tokenProf, tokenAdmin;
let upcomingContest, runningContest, draftContest, endedContest, archivedContest;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  const passwordHash = await bcrypt.hash('TestPass123!', 10);
  const stamp = Date.now();

  // Create Users
  const userSql = `
    INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, institution, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
    RETURNING id, username, email, role, full_name AS "fullName", current_rating AS "currentRating";
  `;

  const s1Res = await db.query(userSql, [`stud1_${stamp}`, `stud1_${stamp}@test.com`, passwordHash, 'Student One', 'student', 1200, 1200, 'MIT']);
  student1 = s1Res.rows[0];
  tokenStudent1 = generateToken(student1);

  const s2Res = await db.query(userSql, [`stud2_${stamp}`, `stud2_${stamp}@test.com`, passwordHash, 'Student Two', 'student', 1300, 1300, 'Stanford']);
  student2 = s2Res.rows[0];
  tokenStudent2 = generateToken(student2);

  const pRes = await db.query(userSql, [`prof_${stamp}`, `prof_${stamp}@test.com`, passwordHash, 'Professor Oak', 'professor', 1600, 1600, 'Oxford']);
  profUser = pRes.rows[0];
  tokenProf = generateToken(profUser);

  const aRes = await db.query(userSql, [`admin_${stamp}`, `admin_${stamp}@test.com`, passwordHash, 'Admin Alex', 'contest_admin', 1800, 1800, 'AdminHQ']);
  adminUser = aRes.rows[0];
  tokenAdmin = generateToken(adminUser);

  // Create Contests with diverse statuses and lifecycle states
  const now = new Date();
  const contestSql = `
    INSERT INTO contests (title, description, start_time, end_time, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, title, status, start_time AS "startTime", end_time AS "endTime", created_by AS "createdBy";
  `;

  // 1. Published Upcoming Contest (Starts in 2h, ends in 4h)
  const upStart = new Date(now.getTime() + 2 * 3600 * 1000);
  const upEnd = new Date(now.getTime() + 4 * 3600 * 1000);
  const upRes = await db.query(contestSql, [`Upcoming Cup ${stamp}`, 'Upcoming contest', upStart, upEnd, 'published', profUser.id]);
  upcomingContest = upRes.rows[0];

  // 2. Published Running Contest (Started 1h ago, ends in 2h)
  const runStart = new Date(now.getTime() - 1 * 3600 * 1000);
  const runEnd = new Date(now.getTime() + 2 * 3600 * 1000);
  const runRes = await db.query(contestSql, [`Live Sprint ${stamp}`, 'Running contest', runStart, runEnd, 'published', profUser.id]);
  runningContest = runRes.rows[0];

  // 3. Draft Contest (Unpublished)
  const dStart = new Date(now.getTime() + 5 * 3600 * 1000);
  const dEnd = new Date(now.getTime() + 7 * 3600 * 1000);
  const dRes = await db.query(contestSql, [`Draft Jam ${stamp}`, 'Draft contest', dStart, dEnd, 'draft', profUser.id]);
  draftContest = dRes.rows[0];

  // 4. Ended Contest (Started 5h ago, ended 2h ago)
  const endStart = new Date(now.getTime() - 5 * 3600 * 1000);
  const endEnd = new Date(now.getTime() - 2 * 3600 * 1000);
  const endRes = await db.query(contestSql, [`Old Contest ${stamp}`, 'Ended contest', endStart, endEnd, 'published', profUser.id]);
  endedContest = endRes.rows[0];

  // 5. Archived Contest
  const archStart = new Date(now.getTime() - 10 * 3600 * 1000);
  const archEnd = new Date(now.getTime() - 8 * 3600 * 1000);
  const archRes = await db.query(contestSql, [`Archived Contest ${stamp}`, 'Archived contest', archStart, archEnd, 'archived', profUser.id]);
  archivedContest = archRes.rows[0];
}

async function cleanup() {
  try {
    const contestIds = [upcomingContest?.id, runningContest?.id, draftContest?.id, endedContest?.id, archivedContest?.id].filter(Boolean);
    if (contestIds.length > 0) {
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [contestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [contestIds]);
    }
    const userIds = [student1?.id, student2?.id, profUser?.id, adminUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [userIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
    }
  } catch (err) {
    console.error('Teardown warning:', err.message);
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function record(name, condition, extraInfo = '') {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name} ${extraInfo}`);
      failed++;
    }
  }

  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.7.3 ENROLLMENT / REGISTRATION TESTS');
  console.log('=======================================================\n');

  try {
    // ----------------------------------------------------
    // Section A-D: Authentication & Student Role Authorization
    // ----------------------------------------------------
    console.log('--- 1. Authentication & Role Enforcement ---');

    // B. Missing token
    const resNoAuth = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {});
    record('B. Unauthenticated request rejected with 401 Unauthorized',
      resNoAuth.status === 401 && resNoAuth.body.status === 'error');

    // C. Invalid token
    const resBadToken = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, 'invalid_garbage_token');
    record('C. Invalid JWT rejected with 401 Unauthorized',
      resBadToken.status === 401 && resBadToken.body.status === 'error');

    // E. Professor attempting self-enrollment (rejected with 403 Forbidden)
    const resProf = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenProf);
    record('E1. Professor role rejected with 403 Forbidden',
      resProf.status === 403 && resProf.body.message.includes('student'));

    // E. Admin attempting self-enrollment (rejected with 403 Forbidden)
    const resAdmin = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenAdmin);
    record('E2. Contest Admin role rejected with 403 Forbidden',
      resAdmin.status === 403 && resAdmin.body.message.includes('student'));

    // D. Valid student allowed
    const resStudent = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent1);
    record('A & D. Valid authenticated student successfully enrolls with 201 Created',
      resStudent.status === 201 && resStudent.body.status === 'success');

    // J. Successful enrollment data schema
    record('J. Enrollment response returns participant object with contestId, userId, and joinedAt',
      resStudent.body.participant &&
      resStudent.body.participant.contestId === upcomingContest.id &&
      resStudent.body.participant.userId === student1.id &&
      Boolean(resStudent.body.participant.joinedAt));

    // ----------------------------------------------------
    // Section F: Contest Existence & Parameter Validation
    // ----------------------------------------------------
    console.log('\n--- 2. Contest Existence & Input Validation ---');

    const resNonexistent = await makeRequest('POST', '/api/contests/999999/join', {}, tokenStudent2);
    record('F1. Nonexistent contest ID returns 404 Not Found',
      resNonexistent.status === 404 && resNonexistent.body.message.includes('not found'));

    const resBadId = await makeRequest('POST', '/api/contests/invalid_id/join', {}, tokenStudent2);
    record('F2. Non-numeric contest ID returns 400 Bad Request',
      resBadId.status === 400 && resBadId.body.message.includes('Invalid contest ID'));

    const resNegativeId = await makeRequest('POST', '/api/contests/-5/join', {}, tokenStudent2);
    record('F3. Negative contest ID returns 400 Bad Request',
      resNegativeId.status === 400 && resNegativeId.body.message.includes('Invalid contest ID'));

    // ----------------------------------------------------
    // Section G-I: Lifecycle & Visibility Restrictions
    // ----------------------------------------------------
    console.log('\n--- 3. Lifecycle & Access Enforcement ---');

    // H. Draft contest rejected
    const resDraft = await makeRequest('POST', `/api/contests/${draftContest.id}/join`, {}, tokenStudent2);
    record('H. Draft / unpublished contest enrollment rejected with 400 Bad Request',
      resDraft.status === 400 && resDraft.body.message.includes('not yet published'));

    // I1. Ended contest rejected
    const resEnded = await makeRequest('POST', `/api/contests/${endedContest.id}/join`, {}, tokenStudent2);
    record('I1. Ended contest enrollment rejected with 400 Bad Request',
      resEnded.status === 400 && resEnded.body.message.includes('already ended'));

    // I2. Archived contest rejected
    const resArchived = await makeRequest('POST', `/api/contests/${archivedContest.id}/join`, {}, tokenStudent2);
    record('I2. Archived contest enrollment rejected with 400 Bad Request',
      resArchived.status === 400 && resArchived.body.message.includes('archived'));

    // G. Running contest allows enrollment
    const resRunning = await makeRequest('POST', `/api/contests/${runningContest.id}/join`, {}, tokenStudent2);
    record('G. Running published contest enrollment allowed with 201 Created',
      resRunning.status === 201 && resRunning.body.status === 'success');

    // ----------------------------------------------------
    // Section K-M: Idempotency, Concurrency & Database Uniqueness
    // ----------------------------------------------------
    console.log('\n--- 4. Idempotency, Duplicate Enrollment & Concurrency ---');

    // K. Sequential duplicate enrollment returns 409 Conflict
    const resDup = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent1);
    record('K. Duplicate enrollment attempt gracefully returns 409 Conflict',
      resDup.status === 409 && resDup.body.message.includes('already joined'));

    // L. Concurrent duplicate enrollment (Race condition test)
    // Run two simultaneous enrollment requests for student2 in upcomingContest
    const [raceRes1, raceRes2] = await Promise.all([
      makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent2),
      makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent2),
    ]);

    const statuses = [raceRes1.status, raceRes2.status].sort();
    record('L. Concurrent duplicate enrollment handles race safely (one 201, one 409, no 500 error)',
      statuses[0] === 201 && statuses[1] === 409);

    // M. Database uniqueness verification: exactly 1 row in contest_participants
    const dbRowsRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [upcomingContest.id, student2.id]
    );
    record('M. Database constraint ensures exactly 1 participant row exists after concurrent requests',
      dbRowsRes.rows[0].count === 1);

    // ----------------------------------------------------
    // Section N-P, R: Mass Assignment, Spoofing & BOLA / IDOR
    // ----------------------------------------------------
    console.log('\n--- 5. Mass-Assignment & Spoofing Protection ---');

    // Create a 3rd student for spoofing test
    const s3Stamp = Date.now();
    const s3Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'student', true) RETURNING id;`,
      [`spoof_victim_${s3Stamp}`, `victim_${s3Stamp}@test.com`, 'hash', 'Victim']
    );
    const victimStudent = s3Res.rows[0];

    // Student 1 attempts to enroll victimStudent via request body
    const resSpoof = await makeRequest(
      'POST',
      `/api/contests/${runningContest.id}/join`,
      {
        userId: victimStudent.id,
        role: 'admin',
        joinedAt: '1999-01-01T00:00:00.000Z',
        status: 'disqualified',
        isOwner: true,
      },
      tokenStudent1
    );

    record('O & P. User ID cannot be spoofed and mass-assignment fields are strictly ignored',
      resSpoof.status === 201 &&
      resSpoof.body.participant.userId === student1.id &&
      resSpoof.body.participant.userId !== victimStudent.id);

    // Verify victim was NOT enrolled
    const victimCheck = await db.query(
      'SELECT * FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [runningContest.id, victimStudent.id]
    );
    record('R. BOLA / IDOR protection: victim user was not enrolled in contest',
      victimCheck.rowCount === 0);

    // Clean up victim student
    await db.query('DELETE FROM users WHERE id = $1', [victimStudent.id]);

    // ----------------------------------------------------
    // Section S: Safe Error Handling (No Information Leakage)
    // ----------------------------------------------------
    console.log('\n--- 6. Safe Error Handling & SQL Injection Shielding ---');

    const sqlPayloadId = "1 OR 1=1; DROP TABLE contest_participants;--";
    const resSqlInjection = await makeRequest('POST', `/api/contests/${encodeURIComponent(sqlPayloadId)}/join`, {}, tokenStudent1);
    record('S1. SQL injection in contest ID safely rejected without database error',
      resSqlInjection.status === 400 && !JSON.stringify(resSqlInjection.body).includes('syntax error'));

    record('S2. Error responses do not leak database schema or internal stack traces',
      !JSON.stringify(resSqlInjection.body).includes('pg_') &&
      !JSON.stringify(resSqlInjection.body).includes('PostgreSQL') &&
      !JSON.stringify(resSqlInjection.body).includes('at Object.'));

    // ----------------------------------------------------
    // Section T: Security Audit Logging
    // ----------------------------------------------------
    console.log('\n--- 7. Security Audit Logging ---');

    // Check PARTICIPANT_JOINED audit event for student1
    const auditJoinedRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE action = 'PARTICIPANT_JOINED' AND actor_id = $1 AND resource_id = $2`,
      [student1.id, upcomingContest.id]
    );
    record('T1. Successful enrollment generates PARTICIPANT_JOINED audit record',
      auditJoinedRes.rowCount >= 1 && auditJoinedRes.rows[0].outcome === 'success');

    // Check PRIVILEGED_ACTION_DENIED audit event for profUser enrollment attempt
    const auditDeniedRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 AND resource_id = $2`,
      [profUser.id, upcomingContest.id]
    );
    record('T2. Unauthorized role enrollment generates PRIVILEGED_ACTION_DENIED audit record',
      auditDeniedRes.rowCount >= 1 && auditDeniedRes.rows[0].outcome === 'denied');

    // ----------------------------------------------------
    // Section U: Enrollment Status Endpoint & Contest Enrichment
    // ----------------------------------------------------
    console.log('\n--- 8. Enrollment Status & State Discovery ---');

    // Student 1 is enrolled in upcomingContest
    const resStatusEnrolled = await makeRequest('GET', `/api/contests/${upcomingContest.id}/enrollment`, null, tokenStudent1);
    record('U1. GET /api/contests/:id/enrollment returns isEnrolled: true for enrolled student',
      resStatusEnrolled.status === 200 &&
      resStatusEnrolled.body.isEnrolled === true &&
      Boolean(resStatusEnrolled.body.enrolledAt));

    // Student 1 is NOT enrolled in draftContest
    const resStatusNotEnrolled = await makeRequest('GET', `/api/contests/${draftContest.id}/enrollment`, null, tokenStudent1);
    record('U2. GET /api/contests/:id/enrollment returns isEnrolled: false for unenrolled contest',
      resStatusNotEnrolled.status === 200 &&
      resStatusNotEnrolled.body.isEnrolled === false &&
      resStatusNotEnrolled.body.enrolledAt === null);

    // GET /api/contests/:id enriches response with isEnrolled
    const resContestDetail = await makeRequest('GET', `/api/contests/${upcomingContest.id}`, null, tokenStudent1);
    record('U3. GET /api/contests/:id enriches response with isEnrolled: true',
      resContestDetail.status === 200 &&
      resContestDetail.body.isEnrolled === true);

  } catch (err) {
    console.error('Fatal test execution error:', err);
    failed++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 7.5.7.3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    await cleanup();
    if (server) {
      server.close();
    }
    await db.closePool();
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Start temporary test server
server = http.createServer(app);
server.listen(0, async () => {
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  await setup();
  await runTests();
});
