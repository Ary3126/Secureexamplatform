/**
 * Automated Test Suite for Phase 7.5.7.5: Bulk Participant Operations
 * File: backend/test_admin_phase5_7_5_bulk_participants.js
 *
 * Comprehensive tests covering:
 *  A. Authentication enforcement (401 Unauthorized for missing/invalid token)
 *  B. Role-Based Access Control (403 Forbidden for student role)
 *  C. Broken Object Level Authorization (BOLA defense: non-owning professor blocked with 403)
 *  D. Privileged admin execution (Contest Admin & Super Admin authorized)
 *  E. Input & payload validation (nonexistent contest, invalid IDs, empty array, oversized batch > 100)
 *  F. Bulk add functional operations & structured reporting (added, alreadyEnrolled, invalid)
 *  G. Deduplication within request payload
 *  H. Mixed batch handling (active students, professors, inactive users, nonexistent IDs)
 *  I. Bulk remove functional operations (removal of submission-free participants)
 *  J. Historical submission dependency preservation (cannot remove participants with contest submissions)
 *  K. Lifecycle restrictions (ended and archived contests reject bulk mutations with 409)
 *  L. Concurrency & race condition safety (concurrent overlapping bulk requests)
 *  M. Security audit logging (BULK_PARTICIPANTS_ADDED, BULK_PARTICIPANTS_REMOVED, PRIVILEGED_ACTION_DENIED)
 *  N. Safe error envelopes & SQL injection shielding
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

// Ephemeral test fixtures
let stamp;
let profA, profB, contestAdmin, superAdmin;
let student1, student2, student3, student4, student5, inactiveStudent, profUser;
let tokenProfA, tokenProfB, tokenContestAdmin, tokenSuperAdmin, tokenStudent1;
let contestProfA, contestProfB, runningContest, endedContest, archivedContest;
let problem1;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function record(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
  }
}

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const jsonBody = body !== null && body !== undefined ? JSON.stringify(body) : null;
    if (jsonBody !== null) {
      headers['Content-Length'] = Buffer.byteLength(jsonBody);
    }

    const req = http.request(
      url,
      { method, headers },
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
    if (jsonBody !== null) req.write(jsonBody);
    req.end();
  });
}

async function setup() {
  const passwordHash = await bcrypt.hash('TestPass123!', 10);
  stamp = Date.now();

  const userSql = `
    INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, institution, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, username, role, email;
  `;

  // 1. Owning Professor
  const profARes = await db.query(userSql, [`prof_bulk_a_${stamp}`, `prof_bulk_a_${stamp}@uni.edu`, passwordHash, 'Prof Bulk A', 'professor', 1500, 1500, 'MIT', true]);
  profA = profARes.rows[0];

  // 2. Non-owning Professor
  const profBRes = await db.query(userSql, [`prof_bulk_b_${stamp}`, `prof_bulk_b_${stamp}@uni.edu`, passwordHash, 'Prof Bulk B', 'professor', 1500, 1500, 'Stanford', true]);
  profB = profBRes.rows[0];

  // 3. Contest Admin
  const caRes = await db.query(userSql, [`ca_bulk_${stamp}`, `ca_bulk_${stamp}@exam.edu`, passwordHash, 'Contest Admin Bulk', 'contest_admin', 1600, 1600, 'AdminHQ', true]);
  contestAdmin = caRes.rows[0];

  // 4. Super Admin
  const saRes = await db.query(userSql, [`sa_bulk_${stamp}`, `sa_bulk_${stamp}@exam.edu`, passwordHash, 'Super Admin Bulk', 'super_admin', 1800, 1800, 'GlobalHQ', true]);
  superAdmin = saRes.rows[0];

  // 5. Students
  const s1Res = await db.query(userSql, [`stud_b1_${stamp}`, `stud_b1_${stamp}@uni.edu`, passwordHash, 'Student Bulk 1', 'student', 1250, 1300, 'MIT', true]);
  student1 = s1Res.rows[0];

  const s2Res = await db.query(userSql, [`stud_b2_${stamp}`, `stud_b2_${stamp}@uni.edu`, passwordHash, 'Student Bulk 2', 'student', 1350, 1400, 'MIT', true]);
  student2 = s2Res.rows[0];

  const s3Res = await db.query(userSql, [`stud_b3_${stamp}`, `stud_b3_${stamp}@uni.edu`, passwordHash, 'Student Bulk 3', 'student', 1450, 1500, 'MIT', true]);
  student3 = s3Res.rows[0];

  const s4Res = await db.query(userSql, [`stud_b4_${stamp}`, `stud_b4_${stamp}@uni.edu`, passwordHash, 'Student Bulk 4', 'student', 1200, 1200, 'MIT', true]);
  student4 = s4Res.rows[0];

  const s5Res = await db.query(userSql, [`stud_b5_${stamp}`, `stud_b5_${stamp}@uni.edu`, passwordHash, 'Student Bulk 5', 'student', 1300, 1300, 'MIT', true]);
  student5 = s5Res.rows[0];

  // 6. Inactive Student
  const inRes = await db.query(userSql, [`inact_stud_${stamp}`, `inact_stud_${stamp}@uni.edu`, passwordHash, 'Inactive Student', 'student', 1200, 1200, 'MIT', false]);
  inactiveStudent = inRes.rows[0];

  // 7. Non-student user (Professor as candidate)
  profUser = profB;

  // Generate tokens
  tokenProfA = generateToken(profA);
  tokenProfB = generateToken(profB);
  tokenContestAdmin = generateToken(contestAdmin);
  tokenSuperAdmin = generateToken(superAdmin);
  tokenStudent1 = generateToken(student1);

  // Create Contests
  const contestSql = `
    INSERT INTO contests (title, description, start_time, end_time, status, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, title, status, start_time AS "startTime", end_time AS "endTime", created_by AS "createdBy";
  `;
  const now = new Date();

  // Contest A owned by Prof A (Draft)
  const cARes = await db.query(contestSql, [`Draft Contest ${stamp}`, 'Draft contest for Prof A', new Date(now.getTime() + 3600000), new Date(now.getTime() + 7200000), 'draft', profA.id]);
  contestProfA = cARes.rows[0];

  // Contest B owned by Prof B (Draft)
  const cBRes = await db.query(contestSql, [`ProfB Contest ${stamp}`, 'Contest owned by Prof B', new Date(now.getTime() + 3600000), new Date(now.getTime() + 7200000), 'draft', profB.id]);
  contestProfB = cBRes.rows[0];

  // Running Contest owned by Prof A
  const cRunRes = await db.query(contestSql, [`Running Contest ${stamp}`, 'Running contest', new Date(now.getTime() - 1800000), new Date(now.getTime() + 1800000), 'published', profA.id]);
  runningContest = cRunRes.rows[0];

  // Ended Contest owned by Prof A
  const cEndRes = await db.query(contestSql, [`Ended Contest ${stamp}`, 'Ended contest', new Date(now.getTime() - 7200000), new Date(now.getTime() - 3600000), 'published', profA.id]);
  endedContest = cEndRes.rows[0];

  // Archived Contest owned by Prof A
  const cArchRes = await db.query(contestSql, [`Archived Contest ${stamp}`, 'Archived contest', new Date(now.getTime() - 10800000), new Date(now.getTime() - 7200000), 'archived', profA.id]);
  archivedContest = cArchRes.rows[0];

  // Create Problem attached to running contest
  const probSql = `
    INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by)
    VALUES ($1, $2, 'easy', 'full_program', 'public', $3)
    RETURNING id;
  `;
  const probRes = await db.query(probSql, [`Bulk Problem for ${stamp}`, 'Test problem', profA.id]);
  problem1 = probRes.rows[0];

  await db.query(
    'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)',
    [runningContest.id, problem1.id]
  );
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.7.5 BULK PARTICIPANT TESTS');
  console.log('=======================================================\n');

  try {
    // ----------------------------------------------------
    // Section 1: Authentication & Role-Based Access Control
    // ----------------------------------------------------
    console.log('--- 1. Authentication & Role-Based Access Control ---');

    const resUnauthAdd = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student1.id] });
    record('A1. Unauthenticated bulk add rejected with 401 Unauthorized', resUnauthAdd.status === 401);

    const resUnauthDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student1.id] });
    record('A2. Unauthenticated bulk remove rejected with 401 Unauthorized', resUnauthDel.status === 401);

    const resStudentAdd = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student2.id] }, tokenStudent1);
    record('B1. Student role cannot bulk add participants (403 Forbidden)', resStudentAdd.status === 403);

    const resStudentDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student2.id] }, tokenStudent1);
    record('B2. Student role cannot bulk remove participants (403 Forbidden)', resStudentDel.status === 403);

    // BOLA defense: Non-owning professor cannot bulk add or remove in another professor's contest
    const resBolaAdd = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfB);
    record('C1. Non-owning professor cannot bulk add to another contest (403 BOLA defense)', resBolaAdd.status === 403);

    const resBolaDel = await makeRequest('DELETE', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfB);
    record('C2. Non-owning professor cannot bulk remove from another contest (403 BOLA defense)', resBolaDel.status === 403);

    // Privileged roles: Contest Admin and Super Admin
    const resCaAdd = await makeRequest('POST', `/api/contests/${contestProfB.id}/participants/bulk`, { userIds: [student1.id] }, tokenContestAdmin);
    record('D1. Contest Admin can bulk add to any contest (201 Created)', resCaAdd.status === 201 && resCaAdd.body?.summary?.addedCount === 1);

    const resSaAdd = await makeRequest('POST', `/api/contests/${contestProfB.id}/participants/bulk`, { userIds: [student2.id] }, tokenSuperAdmin);
    record('D2. Super Admin can bulk add to any contest (201 Created)', resSaAdd.status === 201 && resSaAdd.body.summary.addedCount === 1);

    const resCaDel = await makeRequest('DELETE', `/api/contests/${contestProfB.id}/participants/bulk`, { userIds: [student1.id] }, tokenContestAdmin);
    record('D3. Contest Admin can bulk remove from any contest (200 OK)', resCaDel.status === 200 && resCaDel.body.summary.removedCount === 1);

    const resSaDel = await makeRequest('DELETE', `/api/contests/${contestProfB.id}/participants/bulk`, { userIds: [student2.id] }, tokenSuperAdmin);
    record('D4. Super Admin can bulk remove from any contest (200 OK)', resSaDel.status === 200 && resSaDel.body.summary.removedCount === 1);

    // ----------------------------------------------------
    // Section 2: Input Validation & Boundaries
    // ----------------------------------------------------
    console.log('\n--- 2. Input Validation & Boundaries ---');

    const res404 = await makeRequest('POST', '/api/contests/999999/participants/bulk', { userIds: [student1.id] }, tokenProfA);
    record('E1. Nonexistent contest returns 404 Not Found', res404.status === 404);

    const resBadId = await makeRequest('POST', '/api/contests/abc/participants/bulk', { userIds: [student1.id] }, tokenProfA);
    record('E2. Malformed contest ID returns 400 Bad Request', resBadId.status === 400);

    const resEmptyArray = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [] }, tokenProfA);
    record('E3. Empty userIds array returns 400 Bad Request', resEmptyArray.status === 400);

    const resNonArray = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: 'invalid' }, tokenProfA);
    record('E4. Non-array userIds returns 400 Bad Request', resNonArray.status === 400);

    const resBadUserIds = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: [-1, 'invalid'] }, tokenProfA);
    record('E5. Negative / invalid user IDs return 400 Bad Request', resBadUserIds.status === 400);

    // Oversized batch (> 100 items)
    const oversizedBatch = Array.from({ length: 101 }, (_, i) => i + 1);
    const resOversized = await makeRequest('POST', `/api/contests/${contestProfA.id}/participants/bulk`, { userIds: oversizedBatch }, tokenProfA);
    record('E6. Oversized batch (>100 items) rejected with 400 Bad Request', resOversized.status === 400);

    // ----------------------------------------------------
    // Section 3: Bulk Add Operations & Structured Results
    // ----------------------------------------------------
    console.log('\n--- 3. Bulk Add Operations & Structured Results ---');

    // Add Student 1 and Student 2
    const resAddValid = await makeRequest(
      'POST',
      `/api/contests/${contestProfA.id}/participants/bulk`,
      { userIds: [student1.id, student2.id] },
      tokenProfA
    );
    record('F1. Valid bulk add returns 201 Created with summary',
      resAddValid.status === 201 &&
      resAddValid.body?.summary?.addedCount === 2 &&
      resAddValid.body?.added?.length === 2);

    record('F2. Response hides sensitive password hashes or secrets',
      resAddValid.body?.added &&
      !resAddValid.body?.added[0]?.passwordHash &&
      !resAddValid.body?.added[0]?.password_hash);

    // Duplicate IDs inside same request: [student3, student3, student3]
    const resInternalDup = await makeRequest(
      'POST',
      `/api/contests/${contestProfA.id}/participants/bulk`,
      { userIds: [student3.id, student3.id, student3.id] },
      tokenProfA
    );
    record('G. Duplicate IDs within request payload are safely deduplicated (1 added, not 3)',
      resInternalDup.status === 201 &&
      resInternalDup.body.summary.addedCount === 1 &&
      resInternalDup.body.summary.totalRequested === 1);

    // Verify DB count
    const countCheck = await db.query(
      'SELECT COUNT(*) FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
      [contestProfA.id, student3.id]
    );
    record('G2. Exactly 1 participant row exists in database after deduplicated add',
      parseInt(countCheck.rows[0].count, 10) === 1);

    // Mixed batch:
    // student1 (already enrolled)
    // student4 (new valid student)
    // inactiveStudent (inactive)
    // profB (non-student role)
    // 999999 (non-existent user)
    const resMixed = await makeRequest(
      'POST',
      `/api/contests/${contestProfA.id}/participants/bulk`,
      { userIds: [student1.id, student4.id, inactiveStudent.id, profB.id, 999999] },
      tokenProfA
    );
    record('H1. Mixed batch processes successfully (status 201 Created)', resMixed.status === 201);
    record('H2. Mixed batch reports 1 added (student4)', resMixed.body.summary.addedCount === 1);
    record('H3. Mixed batch reports 1 alreadyEnrolled (student1)', resMixed.body.summary.alreadyEnrolledCount === 1);
    record('H4. Mixed batch reports 3 invalid (inactive, non-student, nonexistent)', resMixed.body.summary.invalidCount === 3);

    // When 0 added (only already-enrolled and invalid), returns 200 OK
    const resZeroAdded = await makeRequest(
      'POST',
      `/api/contests/${contestProfA.id}/participants/bulk`,
      { userIds: [student1.id, student2.id] },
      tokenProfA
    );
    record('H5. Bulk add with 0 new additions returns status 200 OK with alreadyEnrolled details',
      resZeroAdded.status === 200 &&
      resZeroAdded.body.summary.addedCount === 0 &&
      resZeroAdded.body.summary.alreadyEnrolledCount === 2);

    // ----------------------------------------------------
    // Section 4: Bulk Remove Operations & Historical Dependency Protection
    // ----------------------------------------------------
    console.log('\n--- 4. Bulk Remove Operations & Submission Protection ---');

    // Add student1 and student2 to running contest
    await makeRequest('POST', `/api/contests/${runningContest.id}/participants/bulk`, { userIds: [student1.id, student2.id] }, tokenProfA);

    // Record submission for student1 in running contest
    await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, coding_mode, source_code, status, score)
      VALUES ($1, $2, $3, 'javascript', 'full_program', 'console.log("ok");', 'accepted', 100)
    `, [student1.id, runningContest.id, problem1.id]);

    // Attempt bulk remove of:
    // student1 (has submissions -> must be blocked)
    // student2 (no submissions -> must be removed)
    // student5 (not enrolled -> must be reported as notEnrolled)
    const resBulkRemove = await makeRequest(
      'DELETE',
      `/api/contests/${runningContest.id}/participants/bulk`,
      { userIds: [student1.id, student2.id, student5.id] },
      tokenProfA
    );

    record('J1. Bulk remove returns status 200 OK with per-item breakdown', resBulkRemove.status === 200);
    record('J2. Submission user is blocked from removal (blockedCount = 1)',
      resBulkRemove.body.summary.blockedCount === 1 &&
      resBulkRemove.body.blockedWithSubmissions[0].userId === student1.id);
    record('J3. Unenrolled student is categorized as notEnrolled (notEnrolledCount = 1)',
      resBulkRemove.body.summary.notEnrolledCount === 1 &&
      resBulkRemove.body.notEnrolled[0].userId === student5.id);
    record('J4. Submission-free student is successfully removed (removedCount = 1)',
      resBulkRemove.body.summary.removedCount === 1 &&
      resBulkRemove.body.removed[0].userId === student2.id);

    // Verify database state: student1 remains enrolled, student2 is deleted
    const checkS1 = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [runningContest.id, student1.id]);
    record('J5. Database retains participant row for student with submissions', checkS1.rowCount === 1);

    const checkS2 = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [runningContest.id, student2.id]);
    record('J6. Database deletes participant row for submission-free student', checkS2.rowCount === 0);

    // Alternative route test: DELETE /api/contests/:id/participants
    const resAltDelete = await makeRequest(
      'DELETE',
      `/api/contests/${contestProfA.id}/participants`,
      { userIds: [student4.id] },
      tokenProfA
    );
    record('J7. Standard DELETE /api/contests/:id/participants also supported',
      resAltDelete.status === 200 && resAltDelete.body.summary.removedCount === 1);

    // ----------------------------------------------------
    // Section 5: Contest Lifecycle Restrictions
    // ----------------------------------------------------
    console.log('\n--- 5. Contest Lifecycle Restrictions ---');

    const resEndAdd = await makeRequest('POST', `/api/contests/${endedContest.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfA);
    record('K1. Bulk add to ended contest rejected with 409 Conflict', resEndAdd.status === 409);

    const resEndDel = await makeRequest('DELETE', `/api/contests/${endedContest.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfA);
    record('K2. Bulk remove from ended contest rejected with 409 Conflict', resEndDel.status === 409);

    const resArchAdd = await makeRequest('POST', `/api/contests/${archivedContest.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfA);
    record('K3. Bulk add to archived contest rejected with 409 Conflict', resArchAdd.status === 409);

    const resArchDel = await makeRequest('DELETE', `/api/contests/${archivedContest.id}/participants/bulk`, { userIds: [student1.id] }, tokenProfA);
    record('K4. Bulk remove from archived contest rejected with 409 Conflict', resArchDel.status === 409);

    // Active running contest permits bulk addition
    const resRunAdd = await makeRequest('POST', `/api/contests/${runningContest.id}/participants/bulk`, { userIds: [student5.id] }, tokenProfA);
    record('K5. Bulk add to active running contest succeeds (201 Created)', resRunAdd.status === 201);

    // ----------------------------------------------------
    // Section 6: Concurrency & Race Protection
    // ----------------------------------------------------
    console.log('\n--- 6. Concurrency & Race Protection ---');

    // Create fresh contest for concurrency test
    const cConcRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, status, created_by)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hour', 'draft', $3)
       RETURNING id;`,
      [`Concurrency Contest ${stamp}`, 'Testing concurrent bulk add', profA.id]
    );
    const concContestId = cConcRes.rows[0].id;

    // Concurrent requests containing overlapping students: student1, student2, student3
    const [concRes1, concRes2] = await Promise.all([
      makeRequest('POST', `/api/contests/${concContestId}/participants/bulk`, { userIds: [student1.id, student2.id] }, tokenProfA),
      makeRequest('POST', `/api/contests/${concContestId}/participants/bulk`, { userIds: [student2.id, student3.id] }, tokenProfA),
    ]);

    record('L1. Concurrent bulk adds complete without 500 error (both succeed with status 200/201)',
      (concRes1.status === 201 || concRes1.status === 200) &&
      (concRes2.status === 201 || concRes2.status === 200));

    // Verify student2 has exactly 1 database row
    const concDbCheck = await db.query(
      'SELECT user_id, COUNT(*) FROM contest_participants WHERE contest_id = $1 GROUP BY user_id',
      [concContestId]
    );
    const totalAdded = concDbCheck.rowCount;
    const allCountsAreOne = concDbCheck.rows.every((r) => parseInt(r.count, 10) === 1);
    record('L2. Exactly 1 row per student in database after concurrent overlapping batch adds',
      totalAdded === 3 && allCountsAreOne);

    // Repeated identical request
    const resRepeat = await makeRequest('POST', `/api/contests/${concContestId}/participants/bulk`, { userIds: [student1.id, student2.id] }, tokenProfA);
    record('L3. Repeated identical bulk request is idempotent and handles already-enrolled students safely (200 OK)',
      resRepeat.status === 200 && resRepeat.body.summary.alreadyEnrolledCount === 2);

    // ----------------------------------------------------
    // Section 7: Security Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 7. Security Audit Logging ---');

    const auditAdd = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'BULK_PARTICIPANTS_ADDED' AND resource_id = $1 ORDER BY id DESC LIMIT 1`,
      [concContestId]
    );
    record('M1. BULK_PARTICIPANTS_ADDED audit record successfully persisted in PostgreSQL',
      auditAdd.rowCount === 1 && auditAdd.rows[0].outcome === 'success');

    const auditDel = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'BULK_PARTICIPANTS_REMOVED' AND resource_id = $1 ORDER BY id DESC LIMIT 1`,
      [runningContest.id]
    );
    record('M2. BULK_PARTICIPANTS_REMOVED audit record successfully persisted in PostgreSQL',
      auditDel.rowCount === 1 && auditDel.rows[0].outcome === 'success');

    const auditDenied = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 ORDER BY id DESC LIMIT 1`,
      [profB.id]
    );
    record('M3. PRIVILEGED_ACTION_DENIED audit record persisted for unauthorized BOLA attempt',
      auditDenied.rowCount === 1 && auditDenied.rows[0].outcome === 'denied');

    // ----------------------------------------------------
    // Section 8: Safe Error Handling & SQL Injection Shielding
    // ----------------------------------------------------
    console.log('\n--- 8. Safe Error Handling & Injection Shielding ---');

    const resSqlInj = await makeRequest('POST', "/api/contests/1' OR '1'='1/participants/bulk", { userIds: [student1.id] }, tokenProfA);
    record('N1. SQL injection in contest ID safely rejected with 400 Bad Request', resSqlInj.status === 400);

    record('N2. Error envelopes do not leak database schema or internal stack traces',
      typeof resSqlInj.body.message === 'string' &&
      !resSqlInj.body.stack &&
      !JSON.stringify(resSqlInj.body).includes('syntax error'));

  } catch (err) {
    console.error('Fatal test execution error:', err);
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 7.5.7.5 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================\n');

    await db.closePool();
    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

server = app.listen(0, async () => {
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  await setup();
  await runTests();
});
