/**
 * ==============================================================================
 * TEST SUITE: Phase 7.5.7.4 — Manual Participant Management Backend
 * ==============================================================================
 * Comprehensive functional, security, RBAC, lifecycle, concurrency,
 * and historical data preservation tests for manual participant management.
 * 
 * Target Endpoints:
 *  - POST   /api/contests/:id/participants
 *  - DELETE /api/contests/:id/participants/:userId
 *  - GET    /api/contests/:id/search-students
 * 
 * Test Coverage:
 *  A. Authenticated access (401 when token missing or invalid)
 *  B. Student rejection (403 Forbidden for students attempting management)
 *  C. Professor ownership & BOLA isolation (403 for non-owning professor)
 *  D. Admin permissions (Contest Admin & Super Admin manage across contests)
 *  E. Input validation (invalid/negative contest ID, student ID)
 *  F. Target user validation (nonexistent user 404, non-student role 400, inactive user 400)
 *  G. Duplicate enrollment protection (409 Conflict)
 *  H. Concurrency & race condition safety (concurrent add of same student)
 *  I. Lifecycle enforcement (ended and archived contests reject add/remove with 409)
 *  J. Historical submission dependency protection (cannot remove participant with existing submissions)
 *  K. Successful participant addition (201 Created with participant details)
 *  L. Successful participant removal (200 OK and row deleted from database)
 *  M. Candidate student search endpoint (returns active students not yet enrolled)
 *  N. SQL injection shielding & safe error envelopes
 *  O. Sensitive data shielding (no password hashes or secrets in responses)
 *  P. Security audit logging (PARTICIPANT_ADDED, PARTICIPANT_REMOVED, PRIVILEGED_ACTION_DENIED)
 * ==============================================================================
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const ContestModel = require('./src/models/contestModel');
const { generateToken } = require('./src/services/authService');
const bcrypt = require('bcryptjs');

let server;
let port;
let baseUrl;

// Test fixtures
let stamp;
let profA, profB, contestAdmin, superAdmin, student1, student2, student3, inactiveStudent, profStudent;
let tokenProfA, tokenProfB, tokenContestAdmin, tokenSuperAdmin, tokenStudent1;
let contestProfA, contestProfB, runningContest, endedContest, archivedContest;
let problem1;

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
  stamp = Date.now();

  // Create Users
  const userSql = `
    INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, institution, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, username, email, role, full_name AS "fullName", current_rating AS "currentRating", is_active AS "isActive";
  `;

  const pARes = await db.query(userSql, [`prof_a_${stamp}`, `prof_a_${stamp}@test.com`, passwordHash, 'Professor Alice', 'professor', 1500, 1500, 'MIT', true]);
  profA = pARes.rows[0];
  tokenProfA = generateToken(profA);

  const pBRes = await db.query(userSql, [`prof_b_${stamp}`, `prof_b_${stamp}@test.com`, passwordHash, 'Professor Bob', 'professor', 1500, 1500, 'Stanford', true]);
  profB = pBRes.rows[0];
  tokenProfB = generateToken(profB);

  const caRes = await db.query(userSql, [`ca_${stamp}`, `ca_${stamp}@test.com`, passwordHash, 'Admin Charlie', 'contest_admin', 1700, 1700, 'AdminHQ', true]);
  contestAdmin = caRes.rows[0];
  tokenContestAdmin = generateToken(contestAdmin);

  const saRes = await db.query(userSql, [`sa_${stamp}`, `sa_${stamp}@test.com`, passwordHash, 'Super Dave', 'super_admin', 1900, 1900, 'SuperHQ', true]);
  superAdmin = saRes.rows[0];
  tokenSuperAdmin = generateToken(superAdmin);

  const s1Res = await db.query(userSql, [`stud_1_${stamp}`, `stud_1_${stamp}@test.com`, passwordHash, 'Student Alpha', 'student', 1200, 1200, 'MIT', true]);
  student1 = s1Res.rows[0];
  tokenStudent1 = generateToken(student1);

  const s2Res = await db.query(userSql, [`stud_2_${stamp}`, `stud_2_${stamp}@test.com`, passwordHash, 'Student Beta', 'student', 1300, 1300, 'Harvard', true]);
  student2 = s2Res.rows[0];

  const s3Res = await db.query(userSql, [`stud_3_${stamp}`, `stud_3_${stamp}@test.com`, passwordHash, 'Student Gamma', 'student', 1400, 1400, 'Caltech', true]);
  student3 = s3Res.rows[0];

  const inactRes = await db.query(userSql, [`inact_${stamp}`, `inact_${stamp}@test.com`, passwordHash, 'Inactive Student', 'student', 1100, 1100, 'None', false]);
  inactiveStudent = inactRes.rows[0];

  // User with non-student role (e.g. professor) to test adding non-students
  const nonStudRes = await db.query(userSql, [`prof_cand_${stamp}`, `prof_cand_${stamp}@test.com`, passwordHash, 'Candidate Prof', 'professor', 1600, 1600, 'Oxford', true]);
  profStudent = nonStudRes.rows[0];

  // Create Contests
  const now = new Date();
  const contestSql = `
    INSERT INTO contests (title, description, start_time, end_time, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, title, status, start_time AS "startTime", end_time AS "endTime", created_by AS "createdBy";
  `;

  // 1. Contest owned by Prof A (Draft)
  const cARes = await db.query(contestSql, [`ProfA Contest ${stamp}`, 'Contest owned by Prof A', new Date(now.getTime() + 3600000), new Date(now.getTime() + 7200000), 'draft', profA.id]);
  contestProfA = cARes.rows[0];

  // 2. Contest owned by Prof B (Draft)
  const cBRes = await db.query(contestSql, [`ProfB Contest ${stamp}`, 'Contest owned by Prof B', new Date(now.getTime() + 3600000), new Date(now.getTime() + 7200000), 'draft', profB.id]);
  contestProfB = cBRes.rows[0];

  // 3. Running Contest owned by Prof A
  const cRunRes = await db.query(contestSql, [`Running Contest ${stamp}`, 'Running contest', new Date(now.getTime() - 1800000), new Date(now.getTime() + 1800000), 'published', profA.id]);
  runningContest = cRunRes.rows[0];

  // 4. Ended Contest owned by Prof A
  const cEndRes = await db.query(contestSql, [`Ended Contest ${stamp}`, 'Ended contest', new Date(now.getTime() - 7200000), new Date(now.getTime() - 3600000), 'published', profA.id]);
  endedContest = cEndRes.rows[0];

  // 5. Archived Contest owned by Prof A
  const cArchRes = await db.query(contestSql, [`Archived Contest ${stamp}`, 'Archived contest', new Date(now.getTime() - 10800000), new Date(now.getTime() - 7200000), 'archived', profA.id]);
  archivedContest = cArchRes.rows[0];

  // Create Problem attached to running contest
  const probSql = `
    INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by)
    VALUES ($1, $2, 'easy', 'full_program', 'public', $3)
    RETURNING id;
  `;
  const probRes = await db.query(probSql, [`Problem for ${stamp}`, 'Test problem', profA.id]);
  problem1 = probRes.rows[0];

  await db.query(
    'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)',
    [runningContest.id, problem1.id]
  );
}

async function cleanup() {
  try {
    const contestIds = [contestProfA?.id, contestProfB?.id, runningContest?.id, endedContest?.id, archivedContest?.id].filter(Boolean);
    if (contestIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[])', [contestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [contestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [contestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [contestIds]);
    }
    if (problem1?.id) {
      await db.query('DELETE FROM problems WHERE id = $1', [problem1.id]);
    }
    const userIds = [profA?.id, profB?.id, contestAdmin?.id, superAdmin?.id, student1?.id, student2?.id, student3?.id, inactiveStudent?.id, profStudent?.id].filter(Boolean);
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
  console.log(' STARTING PHASE 7.5.7.4 MANUAL PARTICIPANT MGMT TESTS');
  console.log('=======================================================\n');

  try {
    // ----------------------------------------------------
    // Section 1: Authentication & RBAC Authorization
    // ----------------------------------------------------
    console.log('--- 1. Authentication & Role-Based Access Control ---');

    // Unauthenticated request
    const resNoAuth = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student1.id });
    record('A1. Unauthenticated add participant rejected with 401 Unauthorized',
      resNoAuth.status === 401);

    const resNoAuthDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/${student1.id}`);
    record('A2. Unauthenticated remove participant rejected with 401 Unauthorized',
      resNoAuthDel.status === 401);

    // Student role rejection
    const resStudAdd = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student2.id }, tokenStudent1);
    record('B1. Student role cannot add participants (403 Forbidden)',
      resStudAdd.status === 403);

    const resStudDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/${student2.id}`, null, tokenStudent1);
    record('B2. Student role cannot remove participants (403 Forbidden)',
      resStudDel.status === 403);

    // BOLA: Professor B cannot manage Professor A's contest
    const resBolaAdd = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student1.id }, tokenProfB);
    record('C1. Non-owning professor cannot add participant to another contest (403 BOLA)',
      resBolaAdd.status === 403 && resBolaAdd.body.message.includes('permission'));

    const resBolaDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/${student1.id}`, null, tokenProfB);
    record('C2. Non-owning professor cannot remove participant from another contest (403 BOLA)',
      resBolaDel.status === 403 && resBolaDel.body.message.includes('permission'));

    // Admin permissions: Contest Admin and Super Admin can manage
    const resCaAdd = await makeRequest('POST', `/api/contests/${contestProfB.id}/participants`, { userId: student1.id }, tokenContestAdmin);
    record('D1. Contest Admin can add participant to any contest (201 Created)',
      resCaAdd.status === 201 && resCaAdd.body.status === 'success');

    const resSaAdd = await makeRequest('POST', `/api/contests/${contestProfB.id}/participants`, { userId: student2.id }, tokenSuperAdmin);
    record('D2. Super Admin can add participant to any contest (201 Created)',
      resSaAdd.status === 201 && resSaAdd.body.status === 'success');

    // ----------------------------------------------------
    // Section 2: Input & Target Student Validation
    // ----------------------------------------------------
    console.log('\n--- 2. Input & Target Student Validation ---');

    // Nonexistent contest
    const resNonexistContest = await makeRequest('POST', '/api/contests/999999/participants', { userId: student1.id }, tokenProfA);
    record('E1. Nonexistent contest returns 404 Not Found',
      resNonexistContest.status === 404);

    // Non-integer contest ID
    const resBadContestId = await makeRequest('POST', '/api/contests/bad_id/participants', { userId: student1.id }, tokenProfA);
    record('E2. Malformed contest ID returns 400 Bad Request',
      resBadContestId.status === 400);

    // Non-integer student ID
    const resBadStudId = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: 'not_an_id' }, tokenProfA);
    record('E3. Malformed student ID returns 400 Bad Request',
      resBadStudId.status === 400);

    // Missing student ID
    const resMissingStudId = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, {}, tokenProfA);
    record('E4. Missing student ID returns 400 Bad Request',
      resMissingStudId.status === 400);

    // Nonexistent student
    const resNonexistStud = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: 999999 }, tokenProfA);
    record('F1. Nonexistent target student returns 404 Not Found',
      resNonexistStud.status === 404 && resNonexistStud.body.message.includes('not found'));

    // Adding non-student account (e.g. professor)
    const resNonStud = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: profStudent.id }, tokenProfA);
    record('F2. Adding non-student role as participant rejected with 400 Bad Request',
      resNonStud.status === 400 && resNonStud.body.message.includes('Only student accounts'));

    // Adding inactive student account
    const resInactStud = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: inactiveStudent.id }, tokenProfA);
    record('F3. Adding inactive student rejected with 400 Bad Request',
      resInactStud.status === 400 && resInactStud.body.message.includes('inactive'));

    // ----------------------------------------------------
    // Section 3: Successful Addition & Duplicate Protection
    // ----------------------------------------------------
    console.log('\n--- 3. Successful Addition & Duplicate Protection ---');

    // Professor A adds Student 1 to owned contest
    const resAddSuccess = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student1.id }, tokenProfA);
    record('K1. Professor A successfully adds Student 1 to owned contest (201 Created)',
      resAddSuccess.status === 201 &&
      resAddSuccess.body.participant.userId === student1.id &&
      resAddSuccess.body.participant.contestId === contestProfA.id);

    // Response includes sanitized metadata
    record('K2. Add response includes student profile details and hides sensitive fields',
      resAddSuccess.body.participant.username === student1.username &&
      resAddSuccess.body.participant.passwordHash === undefined);

    // Duplicate add attempt
    const resAddDup = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student1.id }, tokenProfA);
    record('G. Duplicate participant addition returns 409 Conflict',
      resAddDup.status === 409 && resAddDup.body.message.includes('already enrolled'));

    // ----------------------------------------------------
    // Section 4: Concurrency Protection (Race Condition)
    // ----------------------------------------------------
    console.log('\n--- 4. Concurrency & Race Protection ---');

    // Two parallel requests adding Student 2 to Prof A contest simultaneously
    const [raceRes1, raceRes2] = await Promise.all([
      makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student2.id }, tokenProfA),
      makeRequest('POST', `/api/contests/${contestProfA.id}/participants`, { userId: student2.id }, tokenProfA),
    ]);

    const statuses = [raceRes1.status, raceRes2.status].sort();
    record('H1. Concurrent add requests handle race safely (one 201, one 409, 0 unhandled 500s)',
      statuses[0] === 201 && statuses[1] === 409);

    // Database check: exactly 1 row
    const countRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [contestProfA.id, student2.id]
    );
    record('H2. Database maintains exactly 1 participant row after race condition',
      countRes.rows[0].count === 1);

    // ----------------------------------------------------
    // Section 5: Contest Lifecycle Restrictions
    // ----------------------------------------------------
    console.log('\n--- 5. Contest Lifecycle Restrictions ---');

    // Ended contest: add participant rejected
    const resEndedAdd = await makeRequest('POST', `/api/contests/${endedContest.id}/participants`, { userId: student3.id }, tokenProfA);
    record('I1. Adding participant to ended contest rejected with 409 Conflict',
      resEndedAdd.status === 409 && resEndedAdd.body.message.includes('ended'));

    // Ended contest: remove participant rejected
    const resEndedDel = await makeRequest('DELETE', `/api/contests/${endedContest.id}/participants/${student1.id}`, null, tokenProfA);
    record('I2. Removing participant from ended contest rejected with 409 Conflict',
      resEndedDel.status === 409 && resEndedDel.body.message.includes('ended'));

    // Archived contest: add participant rejected
    const resArchAdd = await makeRequest('POST', `/api/contests/${archivedContest.id}/participants`, { userId: student3.id }, tokenProfA);
    record('I3. Adding participant to archived contest rejected with 409 Conflict',
      resArchAdd.status === 409 && resArchAdd.body.message.includes('archived'));

    // Archived contest: remove participant rejected
    const resArchDel = await makeRequest('DELETE', `/api/contests/${archivedContest.id}/participants/${student1.id}`, null, tokenProfA);
    record('I4. Removing participant from archived contest rejected with 409 Conflict',
      resArchDel.status === 409 && resArchDel.body.message.includes('archived'));

    // Running contest: manual add is allowed (e.g. late entry approved by organizer)
    const resRunAdd = await makeRequest('POST', `/api/contests/${runningContest.id}/participants`, { userId: student3.id }, tokenProfA);
    record('I5. Adding participant to active running contest succeeds (201 Created)',
      resRunAdd.status === 201 && resRunAdd.body.participant.userId === student3.id);

    // ----------------------------------------------------
    // Section 6: Historical Data & Submission Dependency Protection
    // ----------------------------------------------------
    console.log('\n--- 6. Historical Submissions Dependency Protection ---');

    // Add Student 1 to runningContest and insert a submission
    await makeRequest('POST', `/api/contests/${runningContest.id}/participants`, { userId: student1.id }, tokenProfA);

    await db.query(`
      INSERT INTO submissions (contest_id, problem_id, user_id, language, source_code, status, score, coding_mode)
      VALUES ($1, $2, $3, 'javascript', 'console.log("hello");', 'accepted', 100, 'full_program')
    `, [runningContest.id, problem1.id, student1.id]);

    // Attempt to remove Student 1 from runningContest (must be blocked because submissions exist!)
    const resDelBlocked = await makeRequest('DELETE', `/api/contests/${runningContest.id}/participants/${student1.id}`, null, tokenProfA);
    record('J1. Removing participant with existing submissions is blocked with 409 Conflict',
      resDelBlocked.status === 409 && resDelBlocked.body.message.includes('submitted solutions'));

    // Verify participant row remains intact
    const partStillExists = await ContestModel.findParticipant(runningContest.id, student1.id);
    record('J2. Participant row remains untouched in database when removal is blocked',
      Boolean(partStillExists));

    // Remove Student 3 from runningContest (Student 3 has NO submissions, removal must succeed)
    const resDelNoSub = await makeRequest('DELETE', `/api/contests/${runningContest.id}/participants/${student3.id}`, null, tokenProfA);
    record('J3. Removing participant without submissions succeeds (200 OK)',
      resDelNoSub.status === 200 && resDelNoSub.body.userId === student3.id);

    // Verify Student 3 is gone from runningContest
    const part3Gone = await ContestModel.findParticipant(runningContest.id, student3.id);
    record('J4. Removed participant is deleted from database',
      part3Gone === null);

    // ----------------------------------------------------
    // Section 7: Successful Removal & Nonexistent Participant
    // ----------------------------------------------------
    console.log('\n--- 7. Removal Edge Cases ---');

    // Remove Student 1 from contestProfA (has no submissions)
    const resDelSuccess = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/${student1.id}`, null, tokenProfA);
    record('L1. Removing unenrolled/submission-free participant returns 200 OK',
      resDelSuccess.status === 200 && resDelSuccess.body.userId === student1.id);

    // Attempting to remove again (now nonexistent in this contest)
    const resDelNotFound = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/${student1.id}`, null, tokenProfA);
    record('L2. Removing participant not in contest returns 404 Not Found',
      resDelNotFound.status === 404 && resDelNotFound.body.message.includes('not found in this contest'));

    // ----------------------------------------------------
    // Section 8: Candidate Student Search Endpoint
    // ----------------------------------------------------
    console.log('\n--- 8. Candidate Student Search ---');

    // Search active students not yet enrolled in contestProfA
    // (Student 2 is enrolled; Student 1 and Student 3 are NOT enrolled)
    const resSearch = await makeRequest('GET', `/api/contests/${contestProfA.id}/search-students?search=${stamp}`, null, tokenProfA);
    record('M1. Candidate student search returns status 200 OK with students list',
      resSearch.status === 200 && Array.isArray(resSearch.body.students));

    const returnedUsernames = resSearch.body.students.map((s) => s.username);
    record('M2. Candidate search strictly excludes already enrolled student',
      !returnedUsernames.includes(student2.username));

    record('M3. Candidate search includes available unenrolled student',
      returnedUsernames.includes(student1.username) || returnedUsernames.includes(student3.username));

    record('M4. Candidate search excludes inactive students',
      !returnedUsernames.includes(inactiveStudent.username));

    record('M5. Candidate search excludes non-student roles',
      !returnedUsernames.includes(profStudent.username));

    // ----------------------------------------------------
    // Section 9: Security Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 9. Security Audit Logging ---');

    // Check PARTICIPANT_ADDED audit log
    const auditAddRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE action = 'PARTICIPANT_ADDED' AND actor_id = $1 AND resource_id = $2`,
      [profA.id, contestProfA.id]
    );
    record('P1. PARTICIPANT_ADDED audit record successfully persisted in audit_logs',
      auditAddRes.rowCount >= 1 && auditAddRes.rows[0].outcome === 'success');

    // Check PARTICIPANT_REMOVED audit log
    const auditDelRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE action = 'PARTICIPANT_REMOVED' AND actor_id = $1 AND resource_id = $2`,
      [profA.id, contestProfA.id]
    );
    record('P2. PARTICIPANT_REMOVED audit record successfully persisted in audit_logs',
      auditDelRes.rowCount >= 1 && auditDelRes.rows[0].outcome === 'success');

    // Check PRIVILEGED_ACTION_DENIED audit log for BOLA attempts
    const auditDeniedRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 AND resource_id = $2`,
      [profB.id, contestProfA.id]
    );
    record('P3. PRIVILEGED_ACTION_DENIED audit record persisted for unauthorized BOLA attempts',
      auditDeniedRes.rowCount >= 1 && auditDeniedRes.rows[0].outcome === 'denied');

    // ----------------------------------------------------
    // Section 10: Safe Error Handling & SQL Injection Shielding
    // ----------------------------------------------------
    console.log('\n--- 10. Safe Error Handling & Injection Shielding ---');

    const sqlPayloadId = "1 OR 1=1; DROP TABLE contest_participants;--";
    const resSql = await makeRequest('POST', `/api/contests/${encodeURIComponent(sqlPayloadId)}/participants`, { userId: student1.id }, tokenProfA);
    record('N1. SQL injection in contest ID safely rejected with 400 Bad Request',
      resSql.status === 400 && !JSON.stringify(resSql.body).includes('syntax error'));

    record('N2. Error responses do not leak database schema details or stack traces',
      !JSON.stringify(resSql.body).includes('PostgreSQL') &&
      !JSON.stringify(resSql.body).includes('at Object.'));

  } catch (err) {
    console.error('Fatal test execution error:', err);
    failed++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 7.5.7.4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
