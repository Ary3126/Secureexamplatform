/**
 * Phase 7.5.10.5.6 — Problem Locking & Contest Immutability Security Test Suite
 * File: backend/test_phase_7_5_10_5_6_problem_locking_security.js
 *
 * Comprehensive security validation for Contest Problem Immutability & Lifecycle Locking:
 * A. Problem Addition Security (Draft, Upcoming, Running, Ended, Archived, RBAC, Validation)
 * B. Problem Removal Security (Draft, Upcoming, Running, Ended, Archived, RBAC, Non-attached)
 * C. Problem Reordering Security (Draft, Upcoming, Running, Ended, Archived, Payload Validation)
 * D. Duplicate Problem Protection (Single, Bulk, DB Constraint)
 * E. Problem Identity / Version Integrity (Editing/Rollback/Deletion Locked for Running Contest Problems)
 * F. Hidden Test Case Integrity (Add/Edit/Delete Test Cases Locked for Running Contest Problems)
 * G. Scoring / Penalty Immutability (Points Locked, ICPC Penalties Immutable, Malicious Payloads)
 * H. Generic Update Bypass (PUT/PATCH /api/contests/:id Defenses)
 * I. Running-State Protection (Comprehensive Problem & Configuration Freeze)
 * J. Ended / Finalized Protection (Reproducibility & Result-Locking)
 * K. BOLA / IDOR & Input Validation (Cross-professor, Private Problems, Malformed/Oversized IDs)
 * L. Concurrency & Race Protections (Concurrent Adds, Concurrent Duplicates, Reorders, Transition Race)
 * M. Database Constraints (Primary Key, Foreign Keys, Indexes)
 * N. Submission / Judge Consistency (Authoritative Points & Test Case Evaluation)
 * O. Audit Logging Integrity (Event Creation, Denial Logging, Redaction Verification)
 */

process.env.RATE_LIMIT_CONTEST_MAX = '5000';
process.env.RATE_LIMIT_MEDIUM_MAX = '5000';

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
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runProblemLockingSecurityTests() {
  let passed = 0;
  let failed = 0;

  function testAssert(condition, message) {
    if (condition) {
      passed++;
      console.log(`  [PASS] ${message}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${message}`);
    }
  }

  const trackedUserIds = [];
  const trackedContestIds = [];
  const trackedProblemIds = [];
  const trackedSubmissionIds = [];

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  console.log(`\n================================================================`);
  console.log(` PHASE 7.5.10.5.6 PROBLEM LOCKING & CONTEST IMMUTABILITY TESTS `);
  console.log(` Server listening at: ${baseUrl}`);
  console.log(`================================================================\n`);

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------
    const hashedPw = await hashPassword('TestSecurePass123!');

    // Users
    // 1. Professor Alan (Owning Professor)
    const profAlanRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'professor', 'Alan Professor', true, true) RETURNING id;`,
      [`prof_alan_${Date.now()}`, `alan_${Date.now()}@test.edu`, hashedPw]
    );
    const profAlanId = profAlanRes.rows[0].id;
    trackedUserIds.push(profAlanId);
    const profAlanToken = generateToken({ id: profAlanId, role: 'professor' });

    // 2. Professor Bob (Non-owning Professor)
    const profBobRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'professor', 'Bob Professor', true, true) RETURNING id;`,
      [`prof_bob_${Date.now()}`, `bob_${Date.now()}@test.edu`, hashedPw]
    );
    const profBobId = profBobRes.rows[0].id;
    trackedUserIds.push(profBobId);
    const profBobToken = generateToken({ id: profBobId, role: 'professor' });

    // 3. Student Charlie
    const studentRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'student', 'Charlie Student', true, true) RETURNING id;`,
      [`student_charlie_${Date.now()}`, `charlie_${Date.now()}@test.edu`, hashedPw]
    );
    const studentId = studentRes.rows[0].id;
    trackedUserIds.push(studentId);
    const studentToken = generateToken({ id: studentId, role: 'student' });

    // 4. Contest Admin Dana
    const adminRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'contest_admin', 'Dana Admin', true, true) RETURNING id;`,
      [`admin_dana_${Date.now()}`, `dana_${Date.now()}@test.edu`, hashedPw]
    );
    const adminId = adminRes.rows[0].id;
    trackedUserIds.push(adminId);
    const adminToken = generateToken({ id: adminId, role: 'contest_admin' });

    // 5. Super Admin Evan
    const superRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name, is_active, is_test_data)
       VALUES ($1, $2, $3, 'super_admin', 'Evan Admin', true, true) RETURNING id;`,
      [`super_evan_${Date.now()}`, `evan_${Date.now()}@test.edu`, hashedPw]
    );
    const superId = superRes.rows[0].id;
    trackedUserIds.push(superId);
    const superToken = generateToken({ id: superId, role: 'super_admin' });

    // Problems
    // Problem 1 (Alan's public published problem)
    const p1Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem One', 'Description 1', 'easy', 'full_program', 'public', true, $1, true) RETURNING id;
    `, [profAlanId]);
    const p1Id = p1Res.rows[0].id;
    trackedProblemIds.push(p1Id);

    // Add sample & hidden test case to Problem 1
    const tc1Res = await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden, test_order)
      VALUES ($1, '1 2', '3', true, false, 1) RETURNING id;
    `, [p1Id]);
    const tc1Id = tc1Res.rows[0].id;

    const tc2Res = await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden, test_order)
      VALUES ($1, '10 20', '30', false, true, 2) RETURNING id;
    `, [p1Id]);
    const tc2Id = tc2Res.rows[0].id;

    // Problem 2 (Alan's public published problem)
    const p2Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Two', 'Description 2', 'medium', 'full_program', 'public', true, $1, true) RETURNING id;
    `, [profAlanId]);
    const p2Id = p2Res.rows[0].id;
    trackedProblemIds.push(p2Id);

    // Problem 3 (Alan's public published problem)
    const p3Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Three', 'Description 3', 'hard', 'full_program', 'public', true, $1, true) RETURNING id;
    `, [profAlanId]);
    const p3Id = p3Res.rows[0].id;
    trackedProblemIds.push(p3Id);

    // Problem 4 (Bob's private unpublished problem)
    const p4Res = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, is_published, created_by, is_test_data)
      VALUES ('Problem Four (Private)', 'Secret', 'hard', 'full_program', 'contest_private', false, $1, true) RETURNING id;
    `, [profBobId]);
    const p4Id = p4Res.rows[0].id;
    trackedProblemIds.push(p4Id);

    // Contests
    // 1. Draft Contest (Alan)
    const now = Date.now();
    const draftRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Alan Draft Contest', 'Desc', $1, $2, 'draft', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const draftContestId = draftRes.rows[0].id;
    trackedContestIds.push(draftContestId);

    // 2. Upcoming Contest (Alan, published)
    const upcomingRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Alan Upcoming Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const upcomingContestId = upcomingRes.rows[0].id;
    trackedContestIds.push(upcomingContestId);

    // Attach Problem 1 to Upcoming Contest
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [upcomingContestId, p1Id]);

    // 3. Running Contest (Alan, published, started in the past, ends in the future)
    const runningRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Alan Running Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now - 1800000).toISOString(), new Date(now + 1800000).toISOString(), profAlanId]);
    const runningContestId = runningRes.rows[0].id;
    trackedContestIds.push(runningContestId);

    // Attach Problem 1 & Problem 2 to Running Contest
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [runningContestId, p1Id]);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 200, 2)`, [runningContestId, p2Id]);

    // Enroll Student Charlie into Running Contest
    await db.query(`INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`, [runningContestId, studentId]);

    // 4. Ended Contest (Alan, published, ended in the past)
    const endedRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Alan Ended Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(now - 7200000).toISOString(), new Date(now - 3600000).toISOString(), profAlanId]);
    const endedContestId = endedRes.rows[0].id;
    trackedContestIds.push(endedContestId);

    // Attach Problem 1 to Ended Contest
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [endedContestId, p1Id]);

    // 5. Finalized Contest (Alan, ended + is_rating_finalized = true)
    const finalizedRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, is_rating_finalized, created_by, is_test_data)
      VALUES ('Alan Finalized Contest', 'Desc', $1, $2, 'published', true, true, $3, true) RETURNING id;
    `, [new Date(now - 14400000).toISOString(), new Date(now - 10800000).toISOString(), profAlanId]);
    const finalizedContestId = finalizedRes.rows[0].id;
    trackedContestIds.push(finalizedContestId);

    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [finalizedContestId, p1Id]);

    // 6. Archived Contest (Alan, status = 'archived')
    const archivedRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Alan Archived Contest', 'Desc', $1, $2, 'archived', true, $3, true) RETURNING id;
    `, [new Date(now - 28800000).toISOString(), new Date(now - 25200000).toISOString(), profAlanId]);
    const archivedContestId = archivedRes.rows[0].id;
    trackedContestIds.push(archivedContestId);

    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [archivedContestId, p1Id]);

    // =============================================================
    // SECTION A: PROBLEM ADDITION SECURITY
    // =============================================================
    console.log('\n--- SECTION A: Problem Addition Security ---');

    // A1: Owning Professor adds problem to draft contest
    const resA1 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p1Id, points: 100 }, profAlanToken);
    testAssert(resA1.status === 201, 'A1. Owning professor can add problem to draft contest (201 Created)');

    // A2: Owning Professor adds second problem to draft contest with custom points & order
    const resA2 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p2Id, points: 250, problemOrder: 2 }, profAlanToken);
    testAssert(resA2.status === 201 && resA2.data.mapping.points === 250 && resA2.data.mapping.problemOrder === 2, 'A2. Owning professor can add problem with points & order (201 Created)');

    // A3: Owning Professor adds problem to published upcoming contest
    const resA3 = await request('POST', `/api/contests/${upcomingContestId}/problems`, { problemId: p2Id, points: 150 }, profAlanToken);
    testAssert(resA3.status === 201, 'A3. Owning professor can add problem to upcoming contest before start (201 Created)');

    // A4: Student attempts to add problem -> 403 Forbidden
    const resA4 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p3Id }, studentToken);
    testAssert(resA4.status === 403, 'A4. Student blocked from adding problems to contest (403 Forbidden)');

    // A5: Anonymous attempts to add problem -> 401 Unauthorized
    const resA5 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p3Id }, null);
    testAssert(resA5.status === 401, 'A5. Anonymous blocked from adding problems (401 Unauthorized)');

    // A6: Non-owning professor attempts to add problem -> 403 Forbidden
    const resA6 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p3Id }, profBobToken);
    testAssert(resA6.status === 403, 'A6. Non-owning professor blocked from modifying foreign contest (403 Forbidden)');

    // A7: Contest admin can add problem to any professor's draft contest -> 201 Created
    const resA7 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p3Id, points: 300 }, adminToken);
    testAssert(resA7.status === 201, 'A7. Contest admin authorized to add problem to draft contest (201 Created)');

    // A8: Super admin can add problem to any professor's draft contest -> 201 Created (tested after deleting p3 from draft)
    await db.query(`DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`, [draftContestId, p3Id]);
    const resA8 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p3Id, points: 300 }, superToken);
    testAssert(resA8.status === 201, 'A8. Super admin authorized to add problem to draft contest (201 Created)');

    // A9: Problem addition rejected on RUNNING contest -> 409 Conflict
    const resA9 = await request('POST', `/api/contests/${runningContestId}/problems`, { problemId: p3Id }, profAlanToken);
    testAssert(resA9.status === 409, 'A9. Problem addition rejected on RUNNING contest (409 Conflict)');

    // A10: Problem addition rejected on ENDED contest -> 409 Conflict
    const resA10 = await request('POST', `/api/contests/${endedContestId}/problems`, { problemId: p3Id }, profAlanToken);
    testAssert(resA10.status === 409, 'A10. Problem addition rejected on ENDED contest (409 Conflict)');

    // A11: Problem addition rejected on ARCHIVED contest -> 409 Conflict
    const resA11 = await request('POST', `/api/contests/${archivedContestId}/problems`, { problemId: p3Id }, profAlanToken);
    testAssert(resA11.status === 409, 'A11. Problem addition rejected on ARCHIVED contest (409 Conflict)');

    // A12: Bulk problem addition (`POST /api/contests/:id/problems/bulk`) on draft -> 200 OK
    const resA12 = await request('POST', `/api/contests/${draftContestId}/problems/bulk`, {
      problems: [
        { problemId: p1Id, points: 100, problemOrder: 1 },
        { problemId: p2Id, points: 200, problemOrder: 2 },
      ]
    }, profAlanToken);
    testAssert(resA12.status === 200, 'A12. Bulk problem addition on draft contest succeeds (200 OK)');

    // A13: Bulk problem addition on RUNNING contest -> 409 Conflict
    const resA13 = await request('POST', `/api/contests/${runningContestId}/problems/bulk`, {
      problems: [{ problemId: p3Id, points: 100 }]
    }, profAlanToken);
    testAssert(resA13.status === 409, 'A13. Bulk problem addition rejected on RUNNING contest (409 Conflict)');

    // A14: Bulk problem addition on ENDED contest -> 409 Conflict
    const resA14 = await request('POST', `/api/contests/${endedContestId}/problems/bulk`, {
      problems: [{ problemId: p3Id, points: 100 }]
    }, profAlanToken);
    testAssert(resA14.status === 409, 'A14. Bulk problem addition rejected on ENDED contest (409 Conflict)');

    // A15: PUT `/api/contests/:id/problems` on RUNNING contest -> 409 Conflict
    const resA15 = await request('PUT', `/api/contests/${runningContestId}/problems`, {
      problems: [{ problemId: p3Id, points: 100 }]
    }, profAlanToken);
    testAssert(resA15.status === 409, 'A15. PUT /api/contests/:id/problems rejected on RUNNING contest (409 Conflict)');

    // A16: Invalid points (negative, zero, oversized) -> 400 Bad Request
    const resA16Neg = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p1Id, points: -50 }, profAlanToken);
    const resA16Over = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p1Id, points: 9999999 }, profAlanToken);
    testAssert(resA16Neg.status === 400 && resA16Over.status === 400, 'A16. Invalid points rejected (400 Bad Request)');

    // A17: Invalid problem order (<=0, non-int) -> 400 Bad Request
    const resA17 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p1Id, problemOrder: 0 }, profAlanToken);
    testAssert(resA17.status === 400, 'A17. Invalid problemOrder <= 0 rejected (400 Bad Request)');

    // A18: Non-existent problem ID -> 404 Not Found
    const resA18 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: 999999 }, profAlanToken);
    testAssert(resA18.status === 404, 'A18. Non-existent problem ID rejected (404 Not Found)');

    // =============================================================
    // SECTION B: PROBLEM REMOVAL SECURITY
    // =============================================================
    console.log('\n--- SECTION B: Problem Removal Security ---');

    // B1: Owning professor removes problem from draft contest -> 200 OK
    const resB1 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p3Id}`, null, profAlanToken);
    testAssert(resB1.status === 200, 'B1. Owning professor removes problem from draft contest (200 OK)');

    // B2: Owning professor removes problem from upcoming contest -> 200 OK
    const resB2 = await request('DELETE', `/api/contests/${upcomingContestId}/problems/${p2Id}`, null, profAlanToken);
    testAssert(resB2.status === 200, 'B2. Owning professor removes problem from upcoming contest (200 OK)');

    // B3: Student attempts to remove problem -> 403 Forbidden
    const resB3 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p2Id}`, null, studentToken);
    testAssert(resB3.status === 403, 'B3. Student blocked from removing problems (403 Forbidden)');

    // B4: Anonymous attempts to remove problem -> 401 Unauthorized
    const resB4 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p2Id}`, null, null);
    testAssert(resB4.status === 401, 'B4. Anonymous blocked from removing problems (401 Unauthorized)');

    // B5: Non-owning professor attempts to remove problem -> 403 Forbidden
    const resB5 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p2Id}`, null, profBobToken);
    testAssert(resB5.status === 403, 'B5. Non-owning professor blocked from removing problem (403 Forbidden)');

    // B6: Remove problem not attached to contest -> 404 Not Found
    const resB6 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p3Id}`, null, profAlanToken);
    testAssert(resB6.status === 404, 'B6. Remove unattached problem returns 404 Not Found');

    // B7: Single problem removal on RUNNING contest -> 409 Conflict
    const resB7 = await request('DELETE', `/api/contests/${runningContestId}/problems/${p1Id}`, null, profAlanToken);
    testAssert(resB7.status === 409, 'B7. Single problem removal rejected on RUNNING contest (409 Conflict)');

    // B8: Single problem removal on ENDED contest -> 409 Conflict
    const resB8 = await request('DELETE', `/api/contests/${endedContestId}/problems/${p1Id}`, null, profAlanToken);
    testAssert(resB8.status === 409, 'B8. Single problem removal rejected on ENDED contest (409 Conflict)');

    // B9: Single problem removal on ARCHIVED contest -> 409 Conflict
    const resB9 = await request('DELETE', `/api/contests/${archivedContestId}/problems/${p1Id}`, null, profAlanToken);
    testAssert(resB9.status === 409, 'B9. Single problem removal rejected on ARCHIVED contest (409 Conflict)');

    // B10: Bulk problem removal (`DELETE /api/contests/:id/problems`) on RUNNING contest -> 409 Conflict
    const resB10 = await request('DELETE', `/api/contests/${runningContestId}/problems`, { problemIds: [p1Id] }, profAlanToken);
    testAssert(resB10.status === 409, 'B10. Bulk problem removal rejected on RUNNING contest (409 Conflict)');

    // B11: Bulk problem removal on ENDED contest -> 409 Conflict
    const resB11 = await request('DELETE', `/api/contests/${endedContestId}/problems`, { problemIds: [p1Id] }, profAlanToken);
    testAssert(resB11.status === 409, 'B11. Bulk problem removal rejected on ENDED contest (409 Conflict)');

    // B12: Bulk problem removal on ARCHIVED contest -> 409 Conflict
    const resB12 = await request('DELETE', `/api/contests/${archivedContestId}/problems`, null, profAlanToken);
    testAssert(resB12.status === 409, 'B12. Bulk problem removal rejected on ARCHIVED contest (409 Conflict)');

    // =============================================================
    // SECTION C: PROBLEM REORDERING SECURITY
    // =============================================================
    console.log('\n--- SECTION C: Problem Reordering Security ---');

    // Setup Draft Contest with 3 problems: p1, p2, p3
    await db.query(`DELETE FROM contest_problems WHERE contest_id = $1`, [draftContestId]);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [draftContestId, p1Id]);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 200, 2)`, [draftContestId, p2Id]);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 300, 3)`, [draftContestId, p3Id]);

    // C1: Owning professor reorders problems in draft contest -> 200 OK
    const resC1 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p3Id, p1Id, p2Id]
    }, profAlanToken);
    testAssert(resC1.status === 200 && resC1.data.problems[0].problemId === p3Id, 'C1. Owning professor reorders problems in draft contest (200 OK)');

    // C2: Reorder problems in upcoming contest -> 200 OK (attach p2 to upcoming first)
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 200, 2) ON CONFLICT DO NOTHING`, [upcomingContestId, p2Id]);
    const resC2 = await request('PUT', `/api/contests/${upcomingContestId}/problems/order`, {
      problemIds: [p2Id, p1Id]
    }, profAlanToken);
    testAssert(resC2.status === 200, 'C2. Owning professor reorders problems in upcoming contest (200 OK)');

    // C3: Reorder via PATCH `/api/contests/:id/problems/order` -> 200 OK
    const resC3 = await request('PATCH', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p2Id, p3Id]
    }, profAlanToken);
    testAssert(resC3.status === 200, 'C3. Reorder via PATCH /problems/order succeeds (200 OK)');

    // C4: Student attempts to reorder -> 403 Forbidden
    const resC4 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p2Id, p3Id]
    }, studentToken);
    testAssert(resC4.status === 403, 'C4. Student blocked from reordering problems (403 Forbidden)');

    // C5: Non-owning professor attempts to reorder -> 403 Forbidden
    const resC5 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p2Id, p3Id]
    }, profBobToken);
    testAssert(resC5.status === 403, 'C5. Non-owning professor blocked from reordering problems (403 Forbidden)');

    // C6: Reorder on RUNNING contest -> 409 Conflict
    const resC6 = await request('PUT', `/api/contests/${runningContestId}/problems/order`, {
      problemIds: [p2Id, p1Id]
    }, profAlanToken);
    testAssert(resC6.status === 409, 'C6. Problem reordering rejected on RUNNING contest (409 Conflict)');

    // C7: Reorder on ENDED contest -> 409 Conflict
    const resC7 = await request('PUT', `/api/contests/${endedContestId}/problems/order`, {
      problemIds: [p1Id]
    }, profAlanToken);
    testAssert(resC7.status === 409, 'C7. Problem reordering rejected on ENDED contest (409 Conflict)');

    // C8: Reorder on ARCHIVED contest -> 409 Conflict
    const resC8 = await request('PUT', `/api/contests/${archivedContestId}/problems/order`, {
      problemIds: [p1Id]
    }, profAlanToken);
    testAssert(resC8.status === 409, 'C8. Problem reordering rejected on ARCHIVED contest (409 Conflict)');

    // C9: Reorder with missing problem ID -> 400 Bad Request
    const resC9 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p2Id] // missing p3Id
    }, profAlanToken);
    testAssert(resC9.status === 400, 'C9. Reorder missing attached problem ID rejected (400 Bad Request)');

    // C10: Reorder with foreign / unattached problem ID -> 400 Bad Request
    const resC10 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p2Id, p4Id] // p4Id is not attached
    }, profAlanToken);
    testAssert(resC10.status === 400, 'C10. Reorder containing unattached problem ID rejected (400 Bad Request)');

    // C11: Reorder with duplicate problem ID in array -> 400 Bad Request
    const resC11 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: [p1Id, p1Id, p2Id]
    }, profAlanToken);
    testAssert(resC11.status === 400, 'C11. Reorder containing duplicate problem IDs rejected (400 Bad Request)');

    // C12: Reorder with non-array or empty array -> 400 Bad Request
    const resC12 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, {
      problemIds: []
    }, profAlanToken);
    testAssert(resC12.status === 400, 'C12. Reorder with empty problem array rejected (400 Bad Request)');

    // =============================================================
    // SECTION D: DUPLICATE PROBLEM PROTECTION
    // =============================================================
    console.log('\n--- SECTION D: Duplicate Problem Protection ---');

    // D1: Single problem addition of already-attached problem -> 409 Conflict
    const resD1 = await request('POST', `/api/contests/${draftContestId}/problems`, {
      problemId: p1Id,
      points: 100
    }, profAlanToken);
    testAssert(resD1.status === 409, 'D1. Adding already-attached problem returns 409 Conflict');

    // D2: Bulk add with duplicate problem IDs in the request body -> 400 Bad Request
    const resD2 = await request('POST', `/api/contests/${draftContestId}/problems/bulk`, {
      problems: [
        { problemId: p1Id, points: 100 },
        { problemId: p1Id, points: 200 },
      ]
    }, profAlanToken);
    testAssert(resD2.status === 400, 'D2. Bulk add with duplicate problem IDs in payload rejected (400 Bad Request)');

    // =============================================================
    // SECTION E: PROBLEM IDENTITY / VERSION INTEGRITY
    // =============================================================
    console.log('\n--- SECTION E: Problem Identity / Version Integrity ---');

    // Problem 1 is attached to RUNNING contest (runningContestId)
    // E1: Attempt to modify problem (PUT /api/problems/:id) attached to RUNNING contest -> 409 Conflict
    const resE1 = await request('PUT', `/api/problems/${p1Id}`, {
      title: 'Malicious Problem Mutation',
      description: 'Modified during running contest',
    }, profAlanToken);
    testAssert(resE1.status === 409, 'E1. Problem modification rejected while problem is in RUNNING contest (409 Conflict)');

    // Create a version snapshot for Problem 1 so rollback is testable
    await db.query(`
      INSERT INTO problem_versions (problem_id, version_number, title, description, difficulty, coding_mode, starter_templates, harness_templates, function_config, access_scope, test_cases_snapshot, change_summary, source_action, created_by)
      VALUES ($1, 1, 'Problem One', 'Description 1', 'easy', 'full_program', '{}', '{}', '{}', 'public', '[]', 'initial', 'create', $2)
      ON CONFLICT DO NOTHING;
    `, [p1Id, profAlanId]);

    // E2: Attempt to rollback problem version while attached to RUNNING contest -> 409 Conflict
    const resE2 = await request('POST', `/api/problems/${p1Id}/versions/1/rollback`, {
      changeSummary: 'Malicious rollback during contest'
    }, profAlanToken);
    testAssert(resE2.status === 409, 'E2. Problem version rollback rejected while problem is in RUNNING contest (409 Conflict)');

    // E3: Attempt to delete problem while attached to RUNNING contest -> 409 Conflict
    const resE3 = await request('DELETE', `/api/problems/${p1Id}`, null, profAlanToken);
    testAssert(resE3.status === 409, 'E3. Problem deletion rejected while problem is in RUNNING contest (409 Conflict)');

    // E4: Modifying problem 3 (only in draft contest, not running) succeeds -> 200 OK
    const resE4 = await request('PUT', `/api/problems/${p3Id}`, {
      title: 'Problem Three Updated',
      description: 'Valid update before any contest starts',
    }, profAlanToken);
    testAssert(resE4.status === 200, 'E4. Modifying problem attached only to draft contest succeeds (200 OK)');

    // =============================================================
    // SECTION F: HIDDEN TEST CASE INTEGRITY
    // =============================================================
    console.log('\n--- SECTION F: Hidden Test Case Integrity ---');

    // F1: Add test case to Problem 1 (in RUNNING contest) -> 409 Conflict
    const resF1 = await request('POST', `/api/problems/${p1Id}/test-cases`, {
      inputData: '5 5',
      expectedOutput: '10',
      isHidden: true,
    }, profAlanToken);
    testAssert(resF1.status === 409, 'F1. Adding test case rejected while problem is in RUNNING contest (409 Conflict)');

    // F2: Update existing test case for Problem 1 -> 409 Conflict
    const resF2 = await request('PUT', `/api/test-cases/${tc1Id}`, {
      expectedOutput: '999',
    }, profAlanToken);
    testAssert(resF2.status === 409, 'F2. Modifying test case rejected while problem is in RUNNING contest (409 Conflict)');

    // F3: Delete existing test case for Problem 1 -> 409 Conflict
    const resF3 = await request('DELETE', `/api/test-cases/${tc2Id}`, null, profAlanToken);
    testAssert(resF3.status === 409, 'F3. Deleting test case rejected while problem is in RUNNING contest (409 Conflict)');

    // F4: Add test case to Problem 3 (in draft contest) -> 201 Created
    const resF4 = await request('POST', `/api/problems/${p3Id}/test-cases`, {
      inputData: '100',
      expectedOutput: '200',
      isHidden: false,
    }, profAlanToken);
    testAssert(resF4.status === 201, 'F4. Adding test case to problem in draft contest succeeds (201 Created)');

    // =============================================================
    // SECTION G: SCORING / PENALTY IMMUTABILITY
    // =============================================================
    console.log('\n--- SECTION G: Scoring / Penalty Immutability ---');

    // G1: Verify points for problems attached to running contest
    const resG1 = await request('GET', `/api/contests/${runningContestId}/problems`, null, profAlanToken);
    testAssert(
      resG1.status === 200 &&
      resG1.data.problems.find(p => p.problemId === p1Id).points === 100 &&
      resG1.data.problems.find(p => p.problemId === p2Id).points === 200,
      'G1. Running contest problems reflect authorized configured points'
    );

    // G2: Malicious payload targeting scoringMode, penalty, points via generic update
    const resG2 = await request('PUT', `/api/contests/${runningContestId}`, {
      scoringMode: 'icpc_modified',
      penalty: 0,
      points: 9999,
    }, profAlanToken);
    testAssert(resG2.status === 400, 'G2. Generic update with unwhitelisted scoring fields rejected (400 Bad Request)');

    // G3: Malicious payload targeting duration
    const resG3 = await request('PUT', `/api/contests/${runningContestId}`, {
      duration: 999999,
    }, profAlanToken);
    testAssert(resG3.status === 400, 'G3. Generic update with malicious duration rejected (400 Bad Request)');

    // =============================================================
    // SECTION H: GENERIC UPDATE BYPASS
    // =============================================================
    console.log('\n--- SECTION H: Generic Update Bypass ---');

    // H1: PUT /api/contests/:id with valid title + ignored problemIds
    const resH1 = await request('PUT', `/api/contests/${runningContestId}`, {
      title: 'Alan Running Contest - Renamed',
      problemIds: [p3Id],
    }, profAlanToken);
    testAssert(resH1.status === 200, 'H1. Cosmetic update succeeds while unwhitelisted problemIds are ignored');

    // Verify attached problems did not change
    const checkH1 = await db.query('SELECT problem_id FROM contest_problems WHERE contest_id = $1 ORDER BY problem_id', [runningContestId]);
    testAssert(
      checkH1.rows.length === 2 && checkH1.rows[0].problem_id === p1Id && checkH1.rows[1].problem_id === p2Id,
      'H1b. Problem set remains strictly unchanged in database'
    );

    // H2: Attempt to change startTime on RUNNING contest -> 409 Conflict
    const resH2 = await request('PUT', `/api/contests/${runningContestId}`, {
      startTime: new Date(now - 3600000).toISOString(),
    }, profAlanToken);
    testAssert(resH2.status === 409, 'H2. Changing startTime on RUNNING contest rejected (409 Conflict)');

    // H3: Attempt to change endTime on RUNNING contest -> 409 Conflict
    const resH3 = await request('PUT', `/api/contests/${runningContestId}`, {
      endTime: new Date(now + 7200000).toISOString(),
    }, profAlanToken);
    testAssert(resH3.status === 409, 'H3. Changing endTime on RUNNING contest rejected (409 Conflict)');

    // H4: Attempt to change isRated on RUNNING contest -> 409 Conflict
    const resH4 = await request('PUT', `/api/contests/${runningContestId}`, {
      isRated: false,
    }, profAlanToken);
    testAssert(resH4.status === 409, 'H4. Changing isRated on RUNNING contest rejected (409 Conflict)');

    // H5: Attempt to set status: 'archived' on RUNNING contest -> 409 Conflict
    const resH5 = await request('PUT', `/api/contests/${runningContestId}`, {
      status: 'archived',
    }, profAlanToken);
    testAssert(resH5.status === 409, 'H5. Archiving RUNNING contest via generic update rejected (409 Conflict)');

    // H6: Attempt to publish draft via generic update -> 400 Bad Request
    const resH6 = await request('PUT', `/api/contests/${draftContestId}`, {
      status: 'published',
    }, profAlanToken);
    testAssert(resH6.status === 400, 'H6. Publishing contest via generic update rejected (400 Bad Request)');

    // =============================================================
    // SECTION I: RUNNING-STATE PROTECTION SUMMARY
    // =============================================================
    console.log('\n--- SECTION I: Running-State Protection ---');
    testAssert(resA9.status === 409, 'I1. Problem addition locked in running state');
    testAssert(resB7.status === 409, 'I2. Problem removal locked in running state');
    testAssert(resC6.status === 409, 'I3. Problem reordering locked in running state');
    testAssert(resE1.status === 409, 'I4. Problem text/statement mutation locked in running state');
    testAssert(resF1.status === 409 && resF2.status === 409 && resF3.status === 409, 'I5. Problem test cases completely locked in running state');
    testAssert(resH2.status === 409 && resH3.status === 409, 'I6. Contest duration / timeline locked in running state');
    testAssert(resH4.status === 409, 'I7. Contest rating status locked in running state');

    // =============================================================
    // SECTION J: ENDED / FINALIZED PROTECTION
    // =============================================================
    console.log('\n--- SECTION J: Ended / Finalized Protection ---');

    // J1: Problem addition on ended contest -> 409 Conflict
    const resJ1 = await request('POST', `/api/contests/${endedContestId}/problems`, { problemId: p2Id }, profAlanToken);
    testAssert(resJ1.status === 409, 'J1. Adding problem to ended contest rejected (409 Conflict)');

    // J2: Problem removal on ended contest -> 409 Conflict
    const resJ2 = await request('DELETE', `/api/contests/${endedContestId}/problems/${p1Id}`, null, profAlanToken);
    testAssert(resJ2.status === 409, 'J2. Removing problem from ended contest rejected (409 Conflict)');

    // J3: Problem reordering on ended contest -> 409 Conflict
    const resJ3 = await request('PUT', `/api/contests/${endedContestId}/problems/order`, { problemIds: [p1Id] }, profAlanToken);
    testAssert(resJ3.status === 409, 'J3. Reordering problems in ended contest rejected (409 Conflict)');

    // J4: Modifying isRated on finalized contest -> 409 Conflict
    const resJ4 = await request('PUT', `/api/contests/${finalizedContestId}`, { isRated: false }, profAlanToken);
    testAssert(resJ4.status === 409, 'J4. Modifying isRated on finalized contest rejected (409 Conflict)');

    // J5: Modifying leaderboard freeze on finalized contest -> 409 Conflict
    const resJ5 = await request('PUT', `/api/contests/${finalizedContestId}`, { leaderboardFreezeMinutes: 30 }, profAlanToken);
    testAssert(resJ5.status === 409, 'J5. Modifying leaderboard freeze on finalized contest rejected (409 Conflict)');

    // =============================================================
    // SECTION K: BOLA / IDOR & INPUT VALIDATION
    // =============================================================
    console.log('\n--- SECTION K: BOLA / IDOR & Input Validation ---');

    // K1: Professor Bob attempts to add problem to Professor Alan's contest -> 403 Forbidden
    const resK1 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p1Id }, profBobToken);
    testAssert(resK1.status === 403, 'K1. Cross-professor problem addition rejected (403 Forbidden)');

    // K2: Professor Bob attempts to remove problem from Professor Alan's contest -> 403 Forbidden
    const resK2 = await request('DELETE', `/api/contests/${draftContestId}/problems/${p1Id}`, null, profBobToken);
    testAssert(resK2.status === 403, 'K2. Cross-professor problem removal rejected (403 Forbidden)');

    // K3: Professor Bob attempts to reorder Professor Alan's contest -> 403 Forbidden
    const resK3 = await request('PUT', `/api/contests/${draftContestId}/problems/order`, { problemIds: [p1Id, p2Id, p3Id] }, profBobToken);
    testAssert(resK3.status === 403, 'K3. Cross-professor problem reorder rejected (403 Forbidden)');

    // K4: Professor Alan attempts to attach Professor Bob's private unpublished problem -> 403 Forbidden
    const resK4 = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: p4Id }, profAlanToken);
    testAssert(resK4.status === 403, 'K4. Attaching other professor private unpublished problem rejected (403 Forbidden)');

    // K5: Non-existent contest ID -> 404 Not Found
    const resK5 = await request('POST', `/api/contests/999999/problems`, { problemId: p1Id }, profAlanToken);
    testAssert(resK5.status === 404, 'K5. Non-existent contest ID returns 404 Not Found');

    // K6: Malformed contest IDs (string, negative, decimal) -> 400 Bad Request
    const resK6a = await request('POST', `/api/contests/invalid/problems`, { problemId: p1Id }, profAlanToken);
    const resK6b = await request('POST', `/api/contests/-5/problems`, { problemId: p1Id }, profAlanToken);
    const resK6c = await request('POST', `/api/contests/1.5/problems`, { problemId: p1Id }, profAlanToken);
    testAssert(resK6a.status === 400 && resK6b.status === 400 && resK6c.status === 400, 'K6. Malformed contest IDs rejected (400 Bad Request)');

    // K7: Malformed problem IDs (string, negative, decimal) -> 400 Bad Request
    const resK7a = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: 'invalid' }, profAlanToken);
    const resK7b = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: -10 }, profAlanToken);
    const resK7c = await request('POST', `/api/contests/${draftContestId}/problems`, { problemId: 3.14 }, profAlanToken);
    testAssert(resK7a.status === 400 && resK7b.status === 400 && resK7c.status === 400, 'K7. Malformed problem IDs rejected (400 Bad Request)');

    // =============================================================
    // SECTION L: CONCURRENCY & RACE CONDITIONS
    // =============================================================
    console.log('\n--- SECTION L: Concurrency & Race Conditions ---');

    // Create a fresh draft contest for concurrency testing
    const concDraftRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Concurrency Draft', 'Desc', $1, $2, 'draft', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const concDraftId = concDraftRes.rows[0].id;
    trackedContestIds.push(concDraftId);

    // L1: Concurrent additions of two distinct problems -> both succeed with no collision
    const [concAdd1, concAdd2] = await Promise.all([
      request('POST', `/api/contests/${concDraftId}/problems`, { problemId: p1Id, points: 100 }, profAlanToken),
      request('POST', `/api/contests/${concDraftId}/problems`, { problemId: p2Id, points: 200 }, profAlanToken),
    ]);
    testAssert(concAdd1.status === 201 && concAdd2.status === 201, 'L1. Concurrent distinct problem additions both succeed (201 Created)');

    const countL1 = await db.query('SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1', [concDraftId]);
    testAssert(countL1.rows[0].count === 2, 'L1b. Exactly 2 problem mappings in database');

    // L2: Concurrent additions of the identical problem -> one succeeds (201), other gets 409 Conflict
    await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [concDraftId]);
    const [dupAdd1, dupAdd2] = await Promise.all([
      request('POST', `/api/contests/${concDraftId}/problems`, { problemId: p1Id, points: 100 }, profAlanToken),
      request('POST', `/api/contests/${concDraftId}/problems`, { problemId: p1Id, points: 100 }, profAlanToken),
    ]);
    const dupStatuses = [dupAdd1.status, dupAdd2.status].sort();
    testAssert(dupStatuses[0] === 201 && dupStatuses[1] === 409, 'L2. Concurrent duplicate problem additions: exactly one 201 and one 409');

    const countL2 = await db.query('SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1 AND problem_id = $2', [concDraftId, p1Id]);
    testAssert(countL2.rows[0].count === 1, 'L2b. Exactly 1 row in database (no duplicate association)');

    // L3: Concurrent reorders -> deterministic outcome under row locking
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 200, 2) ON CONFLICT DO NOTHING`, [concDraftId, p2Id]);
    const [reord1, reord2] = await Promise.all([
      request('PUT', `/api/contests/${concDraftId}/problems/order`, { problemIds: [p1Id, p2Id] }, profAlanToken),
      request('PUT', `/api/contests/${concDraftId}/problems/order`, { problemIds: [p2Id, p1Id] }, profAlanToken),
    ]);
    testAssert(reord1.status === 200 && reord2.status === 200, 'L3. Concurrent reorders handled safely without corruption (200 OK)');

    // L4: Race condition: Contest transitioning to running vs Problem addition
    // Create an upcoming contest starting in 1 second
    const raceContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Race Contest', 'Desc', $1, $2, 'published', true, $3, true) RETURNING id;
    `, [new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 3600000).toISOString(), profAlanId]);
    const raceContestId = raceContestRes.rows[0].id;
    trackedContestIds.push(raceContestId);

    // Wait 1.1s so it becomes running
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Now attempt to add problem
    const raceAddRes = await request('POST', `/api/contests/${raceContestId}/problems`, { problemId: p1Id }, profAlanToken);
    testAssert(raceAddRes.status === 409, 'L4. Problem addition rejected once start_time has arrived (409 Conflict)');

    // =============================================================
    // SECTION M: DATABASE INTEGRITY
    // =============================================================
    console.log('\n--- SECTION M: Database Integrity ---');

    // M1: Primary key constraint enforces uniqueness at database layer
    let dbDupError = false;
    try {
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [draftContestId, p1Id]);
      await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 2)`, [draftContestId, p1Id]);
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        dbDupError = true;
      }
    }
    testAssert(dbDupError, 'M1. Primary key (contest_id, problem_id) prevents duplicate entries at DB level (23505)');

    // M2: Foreign key cascades on contest deletion
    const tempContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by, is_test_data)
      VALUES ('Cascade Contest', 'Desc', $1, $2, 'draft', true, $3, true) RETURNING id;
    `, [new Date(now + 3600000).toISOString(), new Date(now + 7200000).toISOString(), profAlanId]);
    const tempContestId = tempContestRes.rows[0].id;

    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)`, [tempContestId, p1Id]);
    await db.query(`DELETE FROM contests WHERE id = $1`, [tempContestId]);

    const checkCascade = await db.query(`SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1`, [tempContestId]);
    testAssert(checkCascade.rows[0].count === 0, 'M2. Foreign key cascade cleans up contest_problems on contest deletion');

    // M3: Verify indexes exist on contest_problems
    const idxRes = await db.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'contest_problems';
    `);
    const idxNames = idxRes.rows.map(r => r.indexname);
    testAssert(
      idxNames.includes('contest_problems_pkey') &&
      idxNames.includes('idx_contest_problems_contest') &&
      idxNames.includes('idx_contest_problems_problem'),
      'M3. Required indexes exist on contest_problems table'
    );

    // =============================================================
    // SECTION N: SUBMISSION / JUDGE CONSISTENCY
    // =============================================================
    console.log('\n--- SECTION N: Submission / Judge Consistency ---');

    // Charlie submits to Problem 1 in the running contest
    const subRes = await request('POST', `/api/submissions`, {
      problemId: p1Id,
      contestId: runningContestId,
      language: 'python',
      sourceCode: 'a, b = map(int, input().split())\nprint(a + b)\n',
    }, studentToken);

    testAssert(subRes.status === 201, 'N1. Enrolled student submits to running contest problem (201 Created)');
    if (subRes.data?.submission?.id) {
      trackedSubmissionIds.push(subRes.data.submission.id);
    }

    // Verify configured points lookup for contest problem
    const configuredPts = await ContestModel.getContestProblemPoints(runningContestId, p1Id);
    testAssert(configuredPts === 100, 'N2. Judge queue resolves configured points (100) from contest_problems');

    // =============================================================
    // SECTION O: AUDIT INTEGRITY
    // =============================================================
    console.log('\n--- SECTION O: Audit Integrity ---');

    // O1: Check CONTEST_PROBLEM_ADDED audit log
    const auditAdd = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'CONTEST_PROBLEM_ADDED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [draftContestId]);
    testAssert(auditAdd.rows.length > 0 && auditAdd.rows[0].actor_id === profAlanId, 'O1. CONTEST_PROBLEM_ADDED audit log recorded with actor and resource');

    // O2: Check CONTEST_PROBLEM_REMOVED audit log
    const auditRem = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'CONTEST_PROBLEM_REMOVED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [draftContestId]);
    testAssert(auditRem.rows.length > 0 && auditRem.rows[0].actor_id === profAlanId, 'O2. CONTEST_PROBLEM_REMOVED audit log recorded');

    // O3: Check CONTEST_PROBLEMS_REORDERED audit log
    const auditReord = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'CONTEST_PROBLEMS_REORDERED' AND resource_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [draftContestId]);
    testAssert(auditReord.rows.length > 0 && auditReord.rows[0].actor_id === profAlanId, 'O3. CONTEST_PROBLEMS_REORDERED audit log recorded');

    // O4: Check PRIVILEGED_ACTION_DENIED audit log for locked mutation attempt
    const auditDenied = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1
      ORDER BY id DESC LIMIT 1;
    `, [profAlanId]);
    testAssert(auditDenied.rows.length > 0, 'O4. PRIVILEGED_ACTION_DENIED logged for locked mutation attempts');

    // O5: Verify no sensitive keys leaked in metadata
    const allRecentLogs = await db.query(`
      SELECT metadata FROM audit_logs 
      WHERE actor_id = ANY($1) 
      ORDER BY id DESC LIMIT 20;
    `, [trackedUserIds]);

    let sensitiveLeak = false;
    for (const row of allRecentLogs.rows) {
      const metaStr = JSON.stringify(row.metadata || {}).toLowerCase();
      if (metaStr.includes('password') || metaStr.includes('secret') || metaStr.includes('bearer')) {
        sensitiveLeak = true;
        break;
      }
    }
    testAssert(!sensitiveLeak, 'O5. Zero sensitive tokens or passwords leaked in audit metadata');

    // -------------------------------------------------------------
    // TEARDOWN & CANONICAL DATABASE RESTORATION
    // -------------------------------------------------------------
    console.log('\n--- TEARDOWN & CANONICAL DATABASE RESTORATION ---');
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1)', [trackedSubmissionIds]);
    }
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1)', [trackedContestIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM problem_versions WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1)', [trackedProblemIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM user_skill_history WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM user_skills WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1)', [trackedUserIds]);
    }

    // Canonical restoration
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM submissions WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914) OR (contest_id IS NOT NULL AND contest_id != 147)');
      await client.query('DELETE FROM rating_history WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR contest_id != 147');
      await client.query('DELETE FROM contest_participants WHERE contest_id != 147 OR user_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM contest_problems WHERE contest_id != 147');
      await client.query('DELETE FROM contests WHERE id != 147');
      await client.query('DELETE FROM test_cases WHERE problem_id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM saved_problems WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM problems WHERE id NOT IN (319, 320, 1797, 1798, 1914)');
      await client.query('DELETE FROM user_skill_history WHERE user_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM user_skills WHERE user_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM audit_logs WHERE actor_id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('DELETE FROM users WHERE id NOT IN (2, 3, 1093, 3833, 4339)');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Baseline counts verification
    const uCnt = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const cCnt = await db.query('SELECT COUNT(*)::int AS count FROM contests');
    const pCnt = await db.query('SELECT COUNT(*)::int AS count FROM problems');
    const sCnt = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    const rCnt = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

    console.log(`Baseline Verification: Users=${uCnt.rows[0].count}, Contests=${cCnt.rows[0].count}, Problems=${pCnt.rows[0].count}, Submissions=${sCnt.rows[0].count}, Rating History=${rCnt.rows[0].count}`);

    testAssert(uCnt.rows[0].count === 5, 'Baseline Users == 5');
    testAssert(cCnt.rows[0].count === 1, 'Baseline Contests == 1');
    testAssert(pCnt.rows[0].count === 5, 'Baseline Problems == 5');
    testAssert(sCnt.rows[0].count === 33, 'Baseline Submissions == 33');
    testAssert(rCnt.rows[0].count === 0, 'Baseline Rating History == 0');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runProblemLockingSecurityTests();
