/**
 * Phase 7.5.10.5.5 — Participant Enrollment State Security Test Suite
 * File: backend/test_phase_7_5_10_5_5_participant_enrollment_security.js
 *
 * Verifies all Phase 7.5.10.5.5 requirements:
 * A. Authentication:
 *    - Anonymous user blocked from join/enrollment/participants (401 Unauthorized)
 *    - Student authorized for self-enrollment (201 Created)
 *    - Professor / Admin blocked from self-enrollment as competitors (403 Forbidden)
 *    - Deactivated user token immediately blocked (401 Unauthorized)
 * B. Self-identity Protection & Spoofing Defense:
 *    - Student enrolling themselves strictly uses req.user.id
 *    - Body userId / studentId spoofing is strictly disregarded
 *    - Foreign student remains unenrolled
 *    - Mass assignment of role, status, joinedAt in body is ignored
 * C. BOLA / IDOR & Ownership Protections:
 *    - Student inspecting own enrollment status / eligibility (200 OK)
 *    - Student blocked from other student's private result details (403 Forbidden)
 *    - Student blocked from manager participant endpoints (403 Forbidden)
 *    - Non-owning Professor blocked from manager endpoints on foreign contest (403 Forbidden BOLA)
 *    - Contest Admin and Super Admin authorized platform-wide (200 OK)
 *    - Non-existent contest returns 404 Not Found
 *    - Non-existent participant on delete returns 404 Not Found
 * D. Lifecycle Restrictions:
 *    - Draft contest: self-enrollment rejected (400 Bad Request)
 *    - Upcoming contest: self-enrollment accepted (201 Created)
 *    - Running contest: self-enrollment accepted (201 Created late join)
 *    - Ended contest: self-enrollment rejected (400 Bad Request)
 *    - Archived contest: self-enrollment rejected (400 Bad Request)
 *    - Ended/Archived contest: manager add/remove rejected (409 Conflict)
 * E. Duplicate Enrollment & Concurrency:
 *    - Sequential duplicate self-enrollment returns 409 Conflict
 *    - Concurrent 2x simultaneous join: exactly 1 succeeds (201), 1 returns 409
 *    - Concurrent 5x simultaneous join: exactly 1 succeeds (201), 4 return 409
 *    - Concurrent 10x simultaneous join: exactly 1 succeeds (201), 9 return 409
 *    - Exactly 1 row in contest_participants table across all race conditions
 *    - Manager duplicate add returns 409 Conflict
 * F. Participant Removal & Dependency Preservation:
 *    - Manager removes participant without submissions (200 OK, deleted from DB)
 *    - Removed participant can no longer submit to running contest (403 Forbidden)
 *    - Manager blocked from removing participant with submissions (409 Conflict)
 *    - Participant record and submissions preserved intact in DB
 * G. Generic Update Bypass:
 *    - PUT/PATCH /api/contests/:id cannot enroll users or inject participant records
 * H. Submission & Execution Boundaries:
 *    - Enrolled student can submit and run code in running contest (201/200)
 *    - Unenrolled student blocked from submitting (403 Forbidden)
 *    - Unenrolled student blocked from interactive run (403 Forbidden)
 * I. Audit Logging Integrity:
 *    - PARTICIPANT_JOINED, PARTICIPANT_ADDED, PARTICIPANT_REMOVED logged
 *    - PRIVILEGED_ACTION_DENIED logged for unauthorized and BOLA attempts
 *    - Zero password hashes or JWT tokens in audit log metadata
 * J. Database Integrity & Input Validation:
 *    - Foreign key constraints prevent orphan participant rows
 *    - Primary key constraint prevents duplicate participant rows
 *    - Malformed, negative, decimal, and SQL injection IDs return 400 Bad Request
 *    - Teardown restores canonical database baseline (5 users, 1 contest, 5 problems, 33 submissions, 0 rating history)
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { getContestRuntimeState } = require('./src/services/contestService');
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

async function runParticipantEnrollmentSecurityTests() {
  let passed = 0;
  let failed = 0;

  function testAssert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  const trackedUserIds = [];
  const trackedContestIds = [];
  const trackedProblemIds = [];
  const trackedSubmissionIds = [];

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`\nParticipant Enrollment Security Suite running at ${baseUrl}\n`);

    const stamp = Date.now();
    const commonHash = await hashPassword('EnrollPass123!');

    // 1. Create Test Users
    // Student 1 (primary enroll tester)
    const stu1Res = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Enroll Student One', true, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_stu1_${stamp}`, `enr_stu1_${stamp}@codefrog.org`, commonHash]);
    const student1 = stu1Res.rows[0];
    const tokenStudent1 = generateToken(student1);
    trackedUserIds.push(student1.id);

    // Student 2 (target spoofing / BOLA tester)
    const stu2Res = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Enroll Student Two', true, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_stu2_${stamp}`, `enr_stu2_${stamp}@codefrog.org`, commonHash]);
    const student2 = stu2Res.rows[0];
    const tokenStudent2 = generateToken(student2);
    trackedUserIds.push(student2.id);

    // Student 3 (concurrency tester)
    const stu3Res = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Enroll Student Three', true, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_stu3_${stamp}`, `enr_stu3_${stamp}@codefrog.org`, commonHash]);
    const student3 = stu3Res.rows[0];
    const tokenStudent3 = generateToken(student3);
    trackedUserIds.push(student3.id);

    // Inactive Student
    const deactRes = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Deactivated Student', false, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_deact_${stamp}`, `enr_deact_${stamp}@codefrog.org`, commonHash]);
    const deactStudent = deactRes.rows[0];
    const tokenDeactStudent = generateToken(deactStudent);
    trackedUserIds.push(deactStudent.id);

    // Professor A (Owner)
    const profARes = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'professor', 'Prof Owner A', true, 1500, 1500)
      RETURNING id, username, email, role;
    `, [`enr_profA_${stamp}`, `enr_profA_${stamp}@codefrog.org`, commonHash]);
    const profA = profARes.rows[0];
    const tokenProfA = generateToken(profA);
    trackedUserIds.push(profA.id);

    // Professor B (Non-owner / BOLA)
    const profBRes = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'professor', 'Prof Foreign B', true, 1500, 1500)
      RETURNING id, username, email, role;
    `, [`enr_profB_${stamp}`, `enr_profB_${stamp}@codefrog.org`, commonHash]);
    const profB = profBRes.rows[0];
    const tokenProfB = generateToken(profB);
    trackedUserIds.push(profB.id);

    // Contest Admin
    const cAdminRes = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'contest_admin', 'Enroll Contest Admin', true, 1600, 1600)
      RETURNING id, username, email, role;
    `, [`enr_cadmin_${stamp}`, `enr_cadmin_${stamp}@codefrog.org`, commonHash]);
    const contestAdmin = cAdminRes.rows[0];
    const tokenContestAdmin = generateToken(contestAdmin);
    trackedUserIds.push(contestAdmin.id);

    // Super Admin
    const sAdminRes = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'super_admin', 'Enroll Super Admin', true, 1800, 1800)
      RETURNING id, username, email, role;
    `, [`enr_sadmin_${stamp}`, `enr_sadmin_${stamp}@codefrog.org`, commonHash]);
    const superAdmin = sAdminRes.rows[0];
    const tokenSuperAdmin = generateToken(superAdmin);
    trackedUserIds.push(superAdmin.id);

    // Use canonical Problem 1797 for contest attachment & submissions
    const testProblem = { id: 1797 };

    // 2. Create Contests for Lifecycle Testing
    // A: Draft Contest (Prof A)
    const draftCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Draft Contest', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', 'draft', true, $2)
      RETURNING id, title, status;
    `, [`Draft Contest ${stamp}`, profA.id]);
    const draftContest = draftCRes.rows[0];
    trackedContestIds.push(draftContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [draftContest.id, testProblem.id]);

    // B: Upcoming Published Contest (Prof A)
    const upcomingCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Upcoming Contest', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', 'published', true, $2)
      RETURNING id, title, status;
    `, [`Upcoming Contest ${stamp}`, profA.id]);
    const upcomingContest = upcomingCRes.rows[0];
    trackedContestIds.push(upcomingContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [upcomingContest.id, testProblem.id]);

    // C: Running Published Contest (Prof A)
    const runningCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Running Contest', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '30 minutes', 'published', true, $2)
      RETURNING id, title, status;
    `, [`Running Contest ${stamp}`, profA.id]);
    const runningContest = runningCRes.rows[0];
    trackedContestIds.push(runningContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [runningContest.id, testProblem.id]);

    // D: Ended Published Contest (Prof A)
    const endedCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Ended Contest', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'published', true, $2)
      RETURNING id, title, status;
    `, [`Ended Contest ${stamp}`, profA.id]);
    const endedContest = endedCRes.rows[0];
    trackedContestIds.push(endedContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [endedContest.id, testProblem.id]);

    // E: Archived Contest (Prof A)
    const archCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Archived Contest', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '3 hours', 'archived', true, $2)
      RETURNING id, title, status;
    `, [`Archived Contest ${stamp}`, profA.id]);
    const archivedContest = archCRes.rows[0];
    trackedContestIds.push(archivedContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [archivedContest.id, testProblem.id]);

    // F: Separate Race Contest for Concurrency Testing
    const raceCRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, 'Race Contest', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', 'published', true, $2)
      RETURNING id, title, status;
    `, [`Race Contest ${stamp}`, profA.id]);
    const raceContest = raceCRes.rows[0];
    trackedContestIds.push(raceContest.id);
    await db.query(`INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1);`, [raceContest.id, testProblem.id]);


    // =========================================================================
    // SECTION 1: AUTHENTICATION ENFORCEMENT
    // =========================================================================
    console.log('--- 1. Authentication Enforcement ---');

    // 1.1 Anonymous user blocked from POST /api/contests/:id/join
    const anonJoin = await request('POST', `/api/contests/${upcomingContest.id}/join`, {});
    testAssert(anonJoin.status === 401, '1.1 Anonymous request to join contest rejected with 401 Unauthorized');
    testAssert(anonJoin.data?.error === 'AUTHENTICATION_ERROR', '1.1 Standardized AUTHENTICATION_ERROR code returned');

    // 1.2 Anonymous user blocked from GET /api/contests/:id/enrollment
    const anonEnr = await request('GET', `/api/contests/${upcomingContest.id}/enrollment`);
    testAssert(anonEnr.status === 401, '1.2 Anonymous request to get enrollment status rejected with 401 Unauthorized');

    // 1.3 Anonymous user blocked from GET /api/contests/:id/eligibility
    const anonElig = await request('GET', `/api/contests/${upcomingContest.id}/eligibility`);
    testAssert(anonElig.status === 401, '1.3 Anonymous request to check eligibility rejected with 401 Unauthorized');

    // 1.4 Anonymous user blocked from GET /api/contests/:id/participants
    const anonPart = await request('GET', `/api/contests/${upcomingContest.id}/participants`);
    testAssert(anonPart.status === 401, '1.4 Anonymous request to list participants rejected with 401 Unauthorized');

    // 1.5 Anonymous user blocked from POST /api/contests/:id/participants
    const anonAdd = await request('POST', `/api/contests/${upcomingContest.id}/participants`, { userId: student1.id });
    testAssert(anonAdd.status === 401, '1.5 Anonymous request to add participant rejected with 401 Unauthorized');

    // 1.6 Anonymous user blocked from DELETE /api/contests/:id/participants/:userId
    const anonDel = await request('DELETE', `/api/contests/${upcomingContest.id}/participants/${student1.id}`);
    testAssert(anonDel.status === 401, '1.6 Anonymous request to delete participant rejected with 401 Unauthorized');

    // 1.7 Deactivated student blocked from joining
    const deactJoin = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenDeactStudent);
    testAssert(deactJoin.status === 401, '1.7 Deactivated student account token rejected with 401 Unauthorized');

    // 1.8 Professor blocked from competitor self-enrollment
    const profJoin = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenProfA);
    testAssert(profJoin.status === 403, '1.8 Professor attempting competitor self-enrollment rejected with 403 Forbidden');
    testAssert(profJoin.data?.message?.includes('reserved for students'), '1.8 Error cites self-enrollment reserved for students');

    // 1.9 Contest Admin blocked from competitor self-enrollment
    const cAdminJoin = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenContestAdmin);
    testAssert(cAdminJoin.status === 403, '1.9 Contest Admin attempting competitor self-enrollment rejected with 403 Forbidden');

    // 1.10 Super Admin blocked from competitor self-enrollment
    const sAdminJoin = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenSuperAdmin);
    testAssert(sAdminJoin.status === 403, '1.10 Super Admin attempting competitor self-enrollment rejected with 403 Forbidden');


    // =========================================================================
    // SECTION 2: SELF-IDENTITY PROTECTION & SPOOFING DEFENSE
    // =========================================================================
    console.log('\n--- 2. Self-Identity Protection & Spoofing Defense ---');

    // 2.1 Student 1 joins upcoming contest normally
    const stu1Join = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent1);
    testAssert(stu1Join.status === 201, '2.1 Authenticated student joins upcoming contest with 201 Created');
    testAssert(stu1Join.data?.participant?.userId === student1.id, '2.1 Server returns participant bound to student1.id');

    // 2.2 Student 2 attempts to spoof Student 1 in body payload
    const spoofPayload = {
      userId: student1.id,
      studentId: student1.id,
      participantId: student1.id,
      role: 'super_admin',
      status: 'approved',
      joinedAt: '2020-01-01T00:00:00.000Z',
    };
    const stu2SpoofJoin = await request('POST', `/api/contests/${raceContest.id}/join`, spoofPayload, tokenStudent2);
    testAssert(stu2SpoofJoin.status === 201, '2.2 Student 2 join request succeeds with 201 Created');
    testAssert(stu2SpoofJoin.data?.participant?.userId === student2.id, '2.2 Server authoritatively bounds enrollment to Student 2 (spoofed userId ignored)');

    // 2.3 Verify in database that Student 1 was NOT enrolled in raceContest
    const s1InRace = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [raceContest.id, student1.id]);
    testAssert(s1InRace.rowCount === 0, '2.3 Database confirms Student 1 was NOT enrolled via Student 2 spoofing');

    // 2.4 Verify in database that Student 2 enrollment used current server timestamp (injected 2020-01-01 ignored)
    const s2Row = await db.query('SELECT joined_at FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [raceContest.id, student2.id]);
    const s2JoinedYear = new Date(s2Row.rows[0].joined_at).getFullYear();
    testAssert(s2JoinedYear >= 2025, '2.4 Injected joinedAt ignored; server timestamp enforced');


    // =========================================================================
    // SECTION 3: BOLA / IDOR & RBAC CONTROLS
    // =========================================================================
    console.log('\n--- 3. BOLA / IDOR & RBAC Controls ---');

    // 3.1 Student 1 inspects own enrollment status
    const stu1Status = await request('GET', `/api/contests/${upcomingContest.id}/enrollment`, null, tokenStudent1);
    testAssert(stu1Status.status === 200, '3.1 Student 1 checks own enrollment status (200 OK)');
    testAssert(stu1Status.data?.isEnrolled === true, '3.1 Server confirms isEnrolled: true for Student 1');

    // 3.2 Student 2 inspects own enrollment status in contest they didn't join
    const stu2Status = await request('GET', `/api/contests/${upcomingContest.id}/enrollment`, null, tokenStudent2);
    testAssert(stu2Status.status === 200, '3.2 Student 2 checks own enrollment status (200 OK)');
    testAssert(stu2Status.data?.isEnrolled === false, '3.2 Server confirms isEnrolled: false for unenrolled Student 2');

    // 3.3 Student 1 blocked from manager GET /participants endpoint
    const stu1ListPart = await request('GET', `/api/contests/${upcomingContest.id}/participants`, null, tokenStudent1);
    testAssert(stu1ListPart.status === 403, '3.3 Student blocked from GET /participants (403 Forbidden)');

    // 3.4 Student 1 blocked from manager POST /participants endpoint
    const stu1AddPart = await request('POST', `/api/contests/${upcomingContest.id}/participants`, { userId: student2.id }, tokenStudent1);
    testAssert(stu1AddPart.status === 403, '3.4 Student blocked from POST /participants (403 Forbidden)');

    // 3.5 Student 1 blocked from manager DELETE /participants/:userId
    const stu1DelPart = await request('DELETE', `/api/contests/${upcomingContest.id}/participants/${student1.id}`, null, tokenStudent1);
    testAssert(stu1DelPart.status === 403, '3.5 Student blocked from DELETE /participants/:userId (403 Forbidden)');

    // 3.6 Non-owning Professor B blocked from Prof A's contest participants list (BOLA)
    const profBList = await request('GET', `/api/contests/${upcomingContest.id}/participants`, null, tokenProfB);
    testAssert(profBList.status === 403, '3.6 Non-owning Professor B blocked from GET /participants (403 Forbidden BOLA)');

    // 3.7 Non-owning Professor B blocked from adding participant to Prof A's contest (BOLA)
    const profBAdd = await request('POST', `/api/contests/${upcomingContest.id}/participants`, { userId: student2.id }, tokenProfB);
    testAssert(profBAdd.status === 403, '3.7 Non-owning Professor B blocked from POST /participants (403 Forbidden BOLA)');

    // 3.8 Non-owning Professor B blocked from removing participant from Prof A's contest (BOLA)
    const profBDel = await request('DELETE', `/api/contests/${upcomingContest.id}/participants/${student1.id}`, null, tokenProfB);
    testAssert(profBDel.status === 403, '3.8 Non-owning Professor B blocked from DELETE /participants/:userId (403 Forbidden BOLA)');

    // 3.9 Non-owning Professor B blocked from bulk add on Prof A's contest (BOLA)
    const profBBulkAdd = await request('POST', `/api/contests/${upcomingContest.id}/participants/bulk`, { userIds: [student2.id] }, tokenProfB);
    testAssert(profBBulkAdd.status === 403, '3.9 Non-owning Professor B blocked from bulk add (403 Forbidden BOLA)');

    // 3.10 Non-owning Professor B blocked from candidate student search on Prof A's contest (BOLA)
    const profBSearch = await request('GET', `/api/contests/${upcomingContest.id}/search-students`, null, tokenProfB);
    testAssert(profBSearch.status === 403, '3.10 Non-owning Professor B blocked from candidate search (403 Forbidden BOLA)');

    // 3.11 Owning Professor A authorized on own contest participants list
    const profAList = await request('GET', `/api/contests/${upcomingContest.id}/participants`, null, tokenProfA);
    testAssert(profAList.status === 200, '3.11 Owning Professor A authorized to list participants (200 OK)');
    testAssert(profAList.data?.participantCount >= 1, '3.11 Participant count matches enrolled student');

    // 3.12 Contest Admin authorized platform-wide on participants list
    const cAdminList = await request('GET', `/api/contests/${upcomingContest.id}/participants`, null, tokenContestAdmin);
    testAssert(cAdminList.status === 200, '3.12 Contest Admin authorized platform-wide on participants (200 OK)');

    // 3.13 Super Admin authorized platform-wide on participants list
    const sAdminList = await request('GET', `/api/contests/${upcomingContest.id}/participants`, null, tokenSuperAdmin);
    testAssert(sAdminList.status === 200, '3.13 Super Admin authorized platform-wide on participants (200 OK)');

    // 3.14 Student 1 blocked from Student 2 private result details (BOLA)
    const stu1ViewStu2 = await request('GET', `/api/contests/${raceContest.id}/participants/${student2.id}/results`, null, tokenStudent1);
    testAssert(stu1ViewStu2.status === 403, '3.14 Student 1 blocked from Student 2 private results (403 Forbidden BOLA)');

    // 3.15 Student 2 authorized on own result details
    const stu2ViewSelf = await request('GET', `/api/contests/${raceContest.id}/participants/${student2.id}/results`, null, tokenStudent2);
    testAssert(stu2ViewSelf.status === 200, '3.15 Student 2 authorized on own result details (200 OK)');


    // =========================================================================
    // SECTION 4: LIFECYCLE RESTRICTIONS
    // =========================================================================
    console.log('\n--- 4. Lifecycle Restrictions ---');

    // 4.1 Self-enrollment into draft contest rejected
    const draftJoin = await request('POST', `/api/contests/${draftContest.id}/join`, {}, tokenStudent1);
    testAssert(draftJoin.status === 400, '4.1 Joining draft contest rejected with 400 Bad Request');
    testAssert(draftJoin.data?.message?.includes('not yet published'), '4.1 Error explicitly notes contest not yet published');

    // 4.2 Self-enrollment into running contest succeeds (late join)
    const runningJoin = await request('POST', `/api/contests/${runningContest.id}/join`, {}, tokenStudent1);
    testAssert(runningJoin.status === 201, '4.2 Joining running contest succeeds with 201 Created (late join)');

    // 4.3 Self-enrollment into ended contest rejected
    const endedJoin = await request('POST', `/api/contests/${endedContest.id}/join`, {}, tokenStudent1);
    testAssert(endedJoin.status === 400, '4.3 Joining ended contest rejected with 400 Bad Request');
    testAssert(endedJoin.data?.message?.includes('already ended'), '4.3 Error explicitly notes contest already ended');

    // 4.4 Self-enrollment into archived contest rejected
    const archJoin = await request('POST', `/api/contests/${archivedContest.id}/join`, {}, tokenStudent1);
    testAssert(archJoin.status === 400, '4.4 Joining archived contest rejected with 400 Bad Request');
    testAssert(archJoin.data?.message?.includes('archived'), '4.4 Error explicitly notes contest is archived');

    // 4.5 Manager adding participant to ended contest rejected
    const mgrAddEnded = await request('POST', `/api/contests/${endedContest.id}/participants`, { userId: student1.id }, tokenProfA);
    testAssert(mgrAddEnded.status === 409, '4.5 Manager adding participant to ended contest rejected with 409 Conflict');

    // 4.6 Manager adding participant to archived contest rejected
    const mgrAddArch = await request('POST', `/api/contests/${archivedContest.id}/participants`, { userId: student1.id }, tokenProfA);
    testAssert(mgrAddArch.status === 409, '4.6 Manager adding participant to archived contest rejected with 409 Conflict');

    // 4.7 Manager removing participant from ended contest rejected
    const mgrDelEnded = await request('DELETE', `/api/contests/${endedContest.id}/participants/${student1.id}`, null, tokenProfA);
    testAssert(mgrDelEnded.status === 409, '4.7 Manager removing participant from ended contest rejected with 409 Conflict');

    // 4.8 Manager removing participant from archived contest rejected
    const mgrDelArch = await request('DELETE', `/api/contests/${archivedContest.id}/participants/${student1.id}`, null, tokenProfA);
    testAssert(mgrDelArch.status === 409, '4.8 Manager removing participant from archived contest rejected with 409 Conflict');


    // =========================================================================
    // SECTION 5: DUPLICATE ENROLLMENT & CONCURRENCY
    // =========================================================================
    console.log('\n--- 5. Duplicate Enrollment & Concurrency ---');

    // 5.1 Sequential repeat join on upcomingContest by Student 1 returns 409 Conflict
    const dupJoin1 = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent1);
    testAssert(dupJoin1.status === 409, '5.1 Sequential repeat join returns 409 Conflict');
    testAssert(dupJoin1.data?.message?.includes('already joined'), '5.1 Message confirms already joined');

    // 5.2 Sequential repeat join #2 returns 409 Conflict
    const dupJoin2 = await request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent1);
    testAssert(dupJoin2.status === 409, '5.2 Second sequential repeat join returns 409 Conflict');

    // 5.3 Database contains exactly 1 row for (upcomingContest.id, student1.id)
    const s1UpcomingRows = await db.query('SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [upcomingContest.id, student1.id]);
    testAssert(s1UpcomingRows.rows[0].count === 1, '5.3 Exactly 1 row in contest_participants after repeated joins');

    // 5.4 Concurrent 2x simultaneous join by Student 3
    const c2Promises = [
      request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent3),
      request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent3),
    ];
    const c2Results = await Promise.all(c2Promises);
    const c2Successes = c2Results.filter(r => r.status === 201).length;
    const c2Conflicts = c2Results.filter(r => r.status === 409).length;
    testAssert(c2Successes === 1, '5.4 Concurrency 2x: exactly 1 request succeeded (201 Created)');
    testAssert(c2Conflicts === 1, '5.4 Concurrency 2x: duplicate request safely rejected (409 Conflict)');

    // 5.5 Verify DB has exactly 1 row for Student 3
    const s3UpcomingRows = await db.query('SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [upcomingContest.id, student3.id]);
    testAssert(s3UpcomingRows.rows[0].count === 1, '5.5 Concurrency 2x: exactly 1 DB row persisted');

    // Create fresh test student for 5x concurrency
    const stu4Res = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Enroll Student Four', true, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_stu4_${stamp}`, `enr_stu4_${stamp}@codefrog.org`, commonHash]);
    const student4 = stu4Res.rows[0];
    const tokenStudent4 = generateToken(student4);
    trackedUserIds.push(student4.id);

    // 5.6 Concurrent 5x simultaneous join by Student 4
    const c5Promises = Array.from({ length: 5 }, () => request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent4));
    const c5Results = await Promise.all(c5Promises);
    const c5Successes = c5Results.filter(r => r.status === 201).length;
    const c5Conflicts = c5Results.filter(r => r.status === 409).length;
    testAssert(c5Successes === 1, '5.6 Concurrency 5x: exactly 1 request succeeded (201 Created)');
    testAssert(c5Conflicts === 4, '5.6 Concurrency 5x: 4 duplicate requests safely rejected (409 Conflict)');

    const s4UpcomingRows = await db.query('SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [upcomingContest.id, student4.id]);
    testAssert(s4UpcomingRows.rows[0].count === 1, '5.6 Concurrency 5x: exactly 1 DB row persisted');

    // Create fresh test student for 10x concurrency
    const stu5Res = await db.query(`
      INSERT INTO users (username, email, password_hash, role, full_name, is_active, current_rating, highest_rating)
      VALUES ($1, $2, $3, 'student', 'Enroll Student Five', true, 1200, 1200)
      RETURNING id, username, email, role;
    `, [`enr_stu5_${stamp}`, `enr_stu5_${stamp}@codefrog.org`, commonHash]);
    const student5 = stu5Res.rows[0];
    const tokenStudent5 = generateToken(student5);
    trackedUserIds.push(student5.id);

    // 5.7 Concurrent 10x simultaneous join by Student 5
    const c10Promises = Array.from({ length: 10 }, () => request('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent5));
    const c10Results = await Promise.all(c10Promises);
    const c10Successes = c10Results.filter(r => r.status === 201).length;
    const c10Conflicts = c10Results.filter(r => r.status === 409).length;
    testAssert(c10Successes === 1, '5.7 Concurrency 10x: exactly 1 request succeeded (201 Created)');
    testAssert(c10Conflicts === 9, '5.7 Concurrency 10x: 9 duplicate requests safely rejected (409 Conflict)');

    const s5UpcomingRows = await db.query('SELECT COUNT(*)::int AS count FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [upcomingContest.id, student5.id]);
    testAssert(s5UpcomingRows.rows[0].count === 1, '5.7 Concurrency 10x: exactly 1 DB row persisted');

    // 5.8 Manager repeat addition returns 409 Conflict
    const mgrDupAdd = await request('POST', `/api/contests/${upcomingContest.id}/participants`, { userId: student1.id }, tokenProfA);
    testAssert(mgrDupAdd.status === 409, '5.8 Manager duplicate addition returns 409 Conflict');


    // =========================================================================
    // SECTION 6: PARTICIPANT REMOVAL & DEPENDENCY PRESERVATION
    // =========================================================================
    console.log('\n--- 6. Participant Removal & Dependency Preservation ---');

    // 6.1 Remove non-enrolled user returns 404 Not Found
    const delNotEnrolled = await request('DELETE', `/api/contests/${upcomingContest.id}/participants/${student2.id}`, null, tokenProfA);
    testAssert(delNotEnrolled.status === 404, '6.1 Removing non-enrolled participant returns 404 Not Found');

    // 6.2 Manager removes enrolled participant (Student 3) who has zero submissions
    const delStu3 = await request('DELETE', `/api/contests/${upcomingContest.id}/participants/${student3.id}`, null, tokenProfA);
    testAssert(delStu3.status === 200, '6.2 Manager removes participant without submissions (200 OK)');

    // 6.3 Verify Student 3 is removed from database
    const s3AfterDel = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [upcomingContest.id, student3.id]);
    testAssert(s3AfterDel.rowCount === 0, '6.3 Database confirms Student 3 was cleanly deleted');

    // 6.4 Have Student 1 submit code to running contest
    const subRes = await request('POST', '/api/submissions', {
      contestId: runningContest.id,
      problemId: testProblem.id,
      language: 'javascript',
      sourceCode: 'console.log("3");',
    }, tokenStudent1);
    testAssert(subRes.status === 201, '6.4 Enrolled Student 1 submits to running contest (201 Created)');
    if (subRes.data?.submission?.id) {
      trackedSubmissionIds.push(subRes.data.submission.id);
    }

    // 6.5 Attempt to remove Student 1 from runningContest after submitting
    const delSubStudent = await request('DELETE', `/api/contests/${runningContest.id}/participants/${student1.id}`, null, tokenProfA);
    testAssert(delSubStudent.status === 409, '6.5 Removing participant with historical submissions rejected with 409 Conflict');
    testAssert(delSubStudent.data?.message?.includes('Historical submission records must be preserved'), '6.5 Error cites historical submission records must be preserved');

    // 6.6 Verify Student 1 participant row is strictly preserved in database
    const s1Preserved = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [runningContest.id, student1.id]);
    testAssert(s1Preserved.rowCount === 1, '6.6 Database confirms participant row preserved despite deletion attempt');

    // 6.7 Bulk remove handles mix of with-submissions and without-submissions
    // Enroll student2 in runningContest (no submissions)
    await request('POST', `/api/contests/${runningContest.id}/join`, {}, tokenStudent2);

    const bulkRemoveRes = await request('DELETE', `/api/contests/${runningContest.id}/participants/bulk`, {
      userIds: [student1.id, student2.id],
    }, tokenProfA);
    testAssert(bulkRemoveRes.status === 200, '6.7 Bulk remove request processed (200 OK)');
    testAssert(bulkRemoveRes.data?.summary?.blockedCount === 1, '6.7 Bulk remove blocked 1 user with submissions (Student 1)');
    testAssert(bulkRemoveRes.data?.summary?.removedCount === 1, '6.7 Bulk remove removed 1 user without submissions (Student 2)');


    // =========================================================================
    // SECTION 7: GENERIC UPDATE / MASS ASSIGNMENT BYPASS
    // =========================================================================
    console.log('\n--- 7. Generic Update / Mass Assignment Bypass ---');

    // 7.1 PUT /api/contests/:id with status: "enrolled" rejected by schema validator
    const putStatusBypass = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: `Draft Updated ${stamp}`,
      status: 'enrolled',
    }, tokenProfA);
    testAssert(putStatusBypass.status === 400, '7.1 PUT with status="enrolled" rejected with 400 Bad Request');
    testAssert(putStatusBypass.data?.errors?.some(e => e.includes('Invalid contest status')), '7.1 Error cites invalid contest status');

    // 7.2 PUT /api/contests/:id with valid fields + injected userId / isEnrolled
    const putBypass = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: `Draft Updated Safe ${stamp}`,
      userId: student2.id,
      isEnrolled: true,
      role: 'participant',
    }, tokenProfA);
    testAssert(putBypass.status === 200, '7.2 PUT metadata update succeeds with 200 OK');

    // 7.3 Verify student2 was NOT enrolled into draftContest
    const s2DraftCheck = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [draftContest.id, student2.id]);
    testAssert(s2DraftCheck.rowCount === 0, '7.3 Injected participant fields ignored; Student 2 remains unenrolled');

    // 7.4 PATCH /api/contests/:id with only non-whitelisted participants array rejected
    const patchOnlyBypass = await request('PATCH', `/api/contests/${draftContest.id}`, {
      participants: [{ userId: student2.id }],
    }, tokenProfA);
    testAssert(patchOnlyBypass.status === 400, '7.4 PATCH with only participants array rejected with 400 Bad Request');
    testAssert(patchOnlyBypass.data?.errors?.some(e => e.includes('Please provide at least one field to update')), '7.4 Error cites provide at least one valid field');

    // 7.5 PATCH /api/contests/:id with valid description + injected participantId
    const patchBypass = await request('PATCH', `/api/contests/${draftContest.id}`, {
      description: 'Updated draft description',
      participantId: student2.id,
    }, tokenProfA);
    testAssert(patchBypass.status === 200, '7.5 PATCH metadata update succeeds with 200 OK');

    const s2DraftCheck2 = await db.query('SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2', [draftContest.id, student2.id]);
    testAssert(s2DraftCheck2.rowCount === 0, '7.5 Injected participantId ignored; Student 2 remains unenrolled');


    // =========================================================================
    // SECTION 8: SUBMISSION & EXECUTION BOUNDARIES
    // =========================================================================
    console.log('\n--- 8. Submission & Execution Boundaries ---');

    // 8.1 Unenrolled Student 3 attempts submission to running contest
    const unenrolledSub = await request('POST', '/api/submissions', {
      contestId: runningContest.id,
      problemId: testProblem.id,
      language: 'javascript',
      sourceCode: 'console.log("hack");',
    }, tokenStudent3);
    testAssert(unenrolledSub.status === 403, '8.1 Unenrolled student submitting code rejected with 403 Forbidden');
    testAssert(unenrolledSub.data?.message?.includes('You must join the contest before you can submit code'), '8.1 Error cites must join contest before submitting');

    // 8.2 Unenrolled Student 3 attempts interactive run on running contest
    const unenrolledRun = await request('POST', '/api/submissions/run', {
      contestId: runningContest.id,
      problemId: testProblem.id,
      language: 'javascript',
      sourceCode: 'console.log("sample");',
    }, tokenStudent3);
    testAssert(unenrolledRun.status === 403, '8.2 Unenrolled student running sample code rejected with 403 Forbidden');
    testAssert(unenrolledRun.data?.message?.includes('You must join the contest before you can run sample code'), '8.2 Error cites must join contest before running code');

    // 8.3 Enrolled Student 1 submits to running contest
    const enrolledSub = await request('POST', '/api/submissions', {
      contestId: runningContest.id,
      problemId: testProblem.id,
      language: 'javascript',
      sourceCode: 'console.log("3");',
    }, tokenStudent1);
    testAssert(enrolledSub.status === 201, '8.3 Enrolled student submits successfully (201 Created)');
    if (enrolledSub.data?.submission?.id) {
      trackedSubmissionIds.push(enrolledSub.data.submission.id);
    }

    // 8.4 Enrolled Student 1 runs sample code on running contest
    const enrolledRun = await request('POST', '/api/submissions/run', {
      contestId: runningContest.id,
      problemId: testProblem.id,
      language: 'javascript',
      sourceCode: 'console.log("sample");',
    }, tokenStudent1);
    testAssert(enrolledRun.status === 200, '8.4 Enrolled student runs sample code successfully (200 OK)');


    // =========================================================================
    // SECTION 9: AUDIT LOGGING INTEGRITY
    // =========================================================================
    console.log('\n--- 9. Audit Logging Integrity ---');

    // 9.1 Check PARTICIPANT_JOINED audit log
    const joinLog = await db.query(`
      SELECT action, outcome, metadata
      FROM audit_logs
      WHERE action = 'PARTICIPANT_JOINED' AND actor_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `, [student1.id]);
    testAssert(joinLog.rowCount === 1, '9.1 PARTICIPANT_JOINED audit log exists');
    testAssert(joinLog.rows[0].outcome === 'success', '9.1 Audit outcome marked as success');

    // 9.2 Check PRIVILEGED_ACTION_DENIED for unauthorized professor join attempt
    const profDeniedLog = await db.query(`
      SELECT action, outcome, metadata
      FROM audit_logs
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `, [profA.id]);
    testAssert(profDeniedLog.rowCount === 1, '9.2 PRIVILEGED_ACTION_DENIED logged for unauthorized competitor join');
    testAssert(profDeniedLog.rows[0].outcome === 'denied', '9.2 Audit outcome marked as denied');

    // 9.3 Check zero passwords or JWTs in metadata
    const anySecrets = await db.query(`
      SELECT 1
      FROM audit_logs
      WHERE (metadata::text ILIKE '%password_hash%' OR metadata::text ILIKE '%jwt_token%')
        AND actor_id = ANY($1);
    `, [trackedUserIds]);
    testAssert(anySecrets.rowCount === 0, '9.3 Audit log metadata strictly excludes password_hash and jwt_token');


    // =========================================================================
    // SECTION 10: DATABASE INTEGRITY & INPUT BOUNDARIES
    // =========================================================================
    console.log('\n--- 10. Database Integrity & Input Boundaries ---');

    // 10.1 Malformed contest ID on join returns 400 Bad Request
    const badId1 = await request('POST', '/api/contests/abc/join', {}, tokenStudent1);
    testAssert(badId1.status === 400, '10.1 Non-integer contest ID on join returns 400 Bad Request');

    // 10.2 Negative contest ID on join returns 400 Bad Request
    const badId2 = await request('POST', '/api/contests/-1/join', {}, tokenStudent1);
    testAssert(badId2.status === 400, '10.2 Negative contest ID on join returns 400 Bad Request');

    // 10.3 Decimal contest ID on join returns 400 Bad Request
    const badId3 = await request('POST', '/api/contests/1.5/join', {}, tokenStudent1);
    testAssert(badId3.status === 400, '10.3 Decimal contest ID on join returns 400 Bad Request');

    // 10.4 SQL injection probe in contest ID returns 400 Bad Request
    const badId4 = await request('POST', '/api/contests/1%20OR%201=1/join', {}, tokenStudent1);
    testAssert(badId4.status === 400, '10.4 SQL injection probe in contest ID on join returns 400 Bad Request');

    // 10.5 Non-existent contest ID returns 404 Not Found
    const badId5 = await request('POST', '/api/contests/99999999/join', {}, tokenStudent1);
    testAssert(badId5.status === 404, '10.5 Non-existent contest ID on join returns 404 Not Found');

    // 10.6 Database Foreign Key constraint: inserting non-existent contest ID throws 23503
    let fkErrorThrown = false;
    try {
      await db.query('INSERT INTO contest_participants (contest_id, user_id) VALUES (99999999, $1)', [student1.id]);
    } catch (e) {
      if (e.code === '23503') fkErrorThrown = true;
    }
    testAssert(fkErrorThrown, '10.6 Database FK constraint 23503 prevents orphan contest reference in contest_participants');

    // 10.7 Database Foreign Key constraint: inserting non-existent user ID throws 23503
    let fkUserErrorThrown = false;
    try {
      await db.query('INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, 99999999)', [upcomingContest.id]);
    } catch (e) {
      if (e.code === '23503') fkUserErrorThrown = true;
    }
    testAssert(fkUserErrorThrown, '10.7 Database FK constraint 23503 prevents orphan user reference in contest_participants');

    // 10.8 Database Primary Key constraint: duplicate insert throws 23505
    let pkErrorThrown = false;
    try {
      await db.query('INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)', [upcomingContest.id, student1.id]);
    } catch (e) {
      if (e.code === '23505') pkErrorThrown = true;
    }
    testAssert(pkErrorThrown, '10.8 Database PK constraint 23505 prevents duplicate contest participant insertion');


    // =========================================================================
    // SECTION 11: TEARDOWN & CANONICAL BASELINE RESTORATION
    // =========================================================================
    console.log('\n--- 11. Teardown & Canonical Baseline Restoration ---');

    // Allow async submission background workers to complete before teardown
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Clean test submissions
    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1)', [trackedSubmissionIds]);
    }

    // Clean test contests
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1)', [trackedContestIds]);
    }

    // Clean test problems
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1)', [trackedProblemIds]);
    }

    // Clean test users & user skills
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM user_skill_history WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM user_skills WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1)', [trackedUserIds]);
    }

    // Execute canonical restoration script
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

    // Verify baseline counts
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

runParticipantEnrollmentSecurityTests();
