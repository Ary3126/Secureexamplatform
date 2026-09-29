/**
 * Test Suite: Phase 7.5.7.6 - Eligibility & Access Validation Layer
 *
 * Verifies:
 *  1. Server-authoritative eligibility and access evaluation service
 *  2. Distinction between Student Eligibility (role, active account) and Contest Access (visibility, lifecycle, enrollment)
 *  3. GET /api/contests/:id/eligibility endpoint (auth, format, BOLA / IDOR defense)
 *  4. Visibility restrictions (draft hidden from non-managers with 403)
 *  5. State mapping (upcoming, running, ended, archived)
 *  6. Integration with POST /api/contests/:id/join and manager participant operations
 *  7. Unit test edge cases for contestAccessService
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { generateToken } = require('./src/services/authService');
const {
  validateStudentEligibility,
  validateContestAccess,
  evaluateContestAccessAndEligibility,
  validateTargetStudentForEnrollment,
} = require('./src/services/contestAccessService');

let server;
let port;
let baseUrl;

const pass = [];
const fail = [];

const record = (name, passed, details = '') => {
  if (passed) {
    pass.push(name);
    console.log(`  [PASS] ${name}`);
  } else {
    fail.push({ name, details });
    console.error(`  [FAIL] ${name} ${details ? '- ' + details : ''}`);
  }
};

const makeRequest = (method, path, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 7.5.7.6 ELIGIBILITY & ACCESS TEST SUITE');
  console.log('=======================================================\n');

  try {
    // 0. Start local HTTP test server
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const now = Date.now();
    const tag = `e76_${now}`;

    // 1. Seed test users
    const profOwnerRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, 'hash', 'Prof Owner', 'professor') RETURNING id, username, role`,
      [`prof_own_${tag}`, `prof_own_${tag}@test.com`]
    );
    const profOwner = profOwnerRes.rows[0];
    const tokenProfOwner = generateToken(profOwner);

    const profOtherRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, 'hash', 'Prof Other', 'professor') RETURNING id, username, role`,
      [`prof_oth_${tag}`, `prof_oth_${tag}@test.com`]
    );
    const profOther = profOtherRes.rows[0];
    const tokenProfOther = generateToken(profOther);

    const caRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, 'hash', 'Contest Admin', 'contest_admin') RETURNING id, username, role`,
      [`ca_${tag}`, `ca_${tag}@test.com`]
    );
    const ca = caRes.rows[0];
    const tokenCa = generateToken(ca);

    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, 'hash', 'Super Admin', 'super_admin') RETURNING id, username, role`,
      [`sa_${tag}`, `sa_${tag}@test.com`]
    );
    const sa = saRes.rows[0];
    const tokenSa = generateToken(sa);

    const student1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Active Student 1', 'student', true) RETURNING id, username, role, is_active`,
      [`stud1_${tag}`, `stud1_${tag}@test.com`]
    );
    const student1 = student1Res.rows[0];
    const tokenStudent1 = generateToken(student1);

    const student2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Active Student 2', 'student', true) RETURNING id, username, role, is_active`,
      [`stud2_${tag}`, `stud2_${tag}@test.com`]
    );
    const student2 = student2Res.rows[0];
    const tokenStudent2 = generateToken(student2);

    const inactiveStudentRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Inactive Student', 'student', false) RETURNING id, username, role, is_active`,
      [`inact_${tag}`, `inact_${tag}@test.com`]
    );
    const inactiveStudent = inactiveStudentRes.rows[0];

    // 2. Seed test contests
    // Draft Contest
    const draftContestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Draft Contest', $2, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', 'draft') RETURNING *`,
      [`Draft Contest ${tag}`, profOwner.id]
    );
    const draftContest = draftContestRes.rows[0];

    // Upcoming Contest (published, starts in +2 hours)
    const upcomingContestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Upcoming Contest', $2, NOW() + INTERVAL '2 hours', NOW() + INTERVAL '4 hours', 'published') RETURNING *`,
      [`Upcoming Contest ${tag}`, profOwner.id]
    );
    const upcomingContest = upcomingContestRes.rows[0];

    // Running Contest (published, started 1 hour ago, ends in 1 hour)
    const runningContestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Running Contest', $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'published') RETURNING *`,
      [`Running Contest ${tag}`, profOwner.id]
    );
    const runningContest = runningContestRes.rows[0];

    // Ended Contest (published, ended 1 hour ago)
    const endedContestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Ended Contest', $2, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour', 'published') RETURNING *`,
      [`Ended Contest ${tag}`, profOwner.id]
    );
    const endedContest = endedContestRes.rows[0];

    // Archived Contest
    const archivedContestRes = await db.query(
      `INSERT INTO contests (title, description, created_by, start_time, end_time, status)
       VALUES ($1, 'Archived Contest', $2, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours', 'archived') RETURNING *`,
      [`Archived Contest ${tag}`, profOwner.id]
    );
    const archivedContest = archivedContestRes.rows[0];

    // Enroll student1 in runningContest and endedContest
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`,
      [runningContest.id, student1.id]
    );
    await db.query(
      `INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)`,
      [endedContest.id, student1.id]
    );

    // ----------------------------------------------------
    // Section 1: Authentication & Format Validation
    // ----------------------------------------------------
    console.log('\n--- 1. Authentication & Input Validation ---');

    const resNoAuth = await makeRequest('GET', `/api/contests/${upcomingContest.id}/eligibility`);
    record('A1. Unauthenticated request rejected with 401 Unauthorized',
      resNoAuth.status === 401);

    const resBadToken = await makeRequest('GET', `/api/contests/${upcomingContest.id}/eligibility`, null, 'garbage_token');
    record('A2. Malformed token rejected with 401 Unauthorized',
      resBadToken.status === 401);

    const resNonNumericId = await makeRequest('GET', '/api/contests/abc/eligibility', null, tokenStudent1);
    record('A3. Non-numeric contest ID rejected with 400 Bad Request',
      resNonNumericId.status === 400 && resNonNumericId.body.message.includes('positive integer'));

    const resNegativeId = await makeRequest('GET', '/api/contests/-9/eligibility', null, tokenStudent1);
    record('A4. Negative contest ID rejected with 400 Bad Request',
      resNegativeId.status === 400);

    const resNonexistent = await makeRequest('GET', '/api/contests/999999/eligibility', null, tokenStudent1);
    record('A5. Nonexistent contest returns 404 Not Found',
      resNonexistent.status === 404 && resNonexistent.body.message.includes('not found'));

    // ----------------------------------------------------
    // Section 2: Visibility Restrictions & Draft Access
    // ----------------------------------------------------
    console.log('\n--- 2. Visibility Restrictions & Draft Access ---');

    const resStudentDraft = await makeRequest('GET', `/api/contests/${draftContest.id}/eligibility`, null, tokenStudent1);
    record('B1. Student cannot inspect draft contest eligibility (403 Forbidden)',
      resStudentDraft.status === 403 && resStudentDraft.body.message.includes('draft'));

    const resOtherProfDraft = await makeRequest('GET', `/api/contests/${draftContest.id}/eligibility`, null, tokenProfOther);
    record('B2. Non-owning professor cannot inspect draft contest eligibility (403 Forbidden)',
      resOtherProfDraft.status === 403);

    const resOwnerDraft = await makeRequest('GET', `/api/contests/${draftContest.id}/eligibility`, null, tokenProfOwner);
    record('B3. Contest owner can inspect draft contest (200 OK, allowed: true, canRegister: false)',
      resOwnerDraft.status === 200 &&
      resOwnerDraft.body.allowed === true &&
      resOwnerDraft.body.canRegister === false &&
      resOwnerDraft.body.runtimeState === 'draft');

    const resAdminDraft = await makeRequest('GET', `/api/contests/${draftContest.id}/eligibility`, null, tokenSa);
    record('B4. Super admin can inspect draft contest (200 OK, allowed: true)',
      resAdminDraft.status === 200 && resAdminDraft.body.allowed === true);

    // ----------------------------------------------------
    // Section 3: Student Eligibility (Role & Active Account)
    // ----------------------------------------------------
    console.log('\n--- 3. Student Eligibility (Role & Account Status) ---');

    const resStudUpcoming = await makeRequest('GET', `/api/contests/${upcomingContest.id}/eligibility`, null, tokenStudent2);
    record('C1. Active student returns eligible = true and canRegister = true on upcoming contest',
      resStudUpcoming.status === 200 &&
      resStudUpcoming.body.eligible === true &&
      resStudUpcoming.body.canRegister === true &&
      resStudUpcoming.body.canParticipate === false &&
      resStudUpcoming.body.isEnrolled === false &&
      resStudUpcoming.body.status.accountActive === true &&
      resStudUpcoming.body.status.validRole === true);

    const resProfUpcoming = await makeRequest('GET', `/api/contests/${upcomingContest.id}/eligibility`, null, tokenProfOther);
    record('C2. Professor account returns eligible = false and validRole = false',
      resProfUpcoming.status === 200 &&
      resProfUpcoming.body.eligible === false &&
      resProfUpcoming.body.canRegister === false &&
      resProfUpcoming.body.status.validRole === false &&
      resProfUpcoming.body.reasons.some((r) => r.includes('student accounts')));

    const resAdminUpcoming = await makeRequest('GET', `/api/contests/${upcomingContest.id}/eligibility`, null, tokenCa);
    record('C3. Contest Admin returns eligible = false and canRegister = false',
      resAdminUpcoming.status === 200 &&
      resAdminUpcoming.body.eligible === false &&
      resAdminUpcoming.body.canRegister === false);

    // ----------------------------------------------------
    // Section 4: Lifecycle & Enrollment State Mapping
    // ----------------------------------------------------
    console.log('\n--- 4. Lifecycle & Enrollment State Mapping ---');

    // Running contest - Enrolled student
    const resRunningEnrolled = await makeRequest('GET', `/api/contests/${runningContest.id}/eligibility`, null, tokenStudent1);
    record('D1. Running contest + Enrolled student -> canParticipate = true, canRegister = false, isEnrolled = true',
      resRunningEnrolled.status === 200 &&
      resRunningEnrolled.body.canParticipate === true &&
      resRunningEnrolled.body.canRegister === false &&
      resRunningEnrolled.body.isEnrolled === true &&
      resRunningEnrolled.body.runtimeState === 'running');

    // Running contest - Non-enrolled student (can register late, but cannot participate until registered)
    const resRunningNonEnrolled = await makeRequest('GET', `/api/contests/${runningContest.id}/eligibility`, null, tokenStudent2);
    record('D2. Running contest + Non-enrolled student -> canRegister = true (late join), canParticipate = false',
      resRunningNonEnrolled.status === 200 &&
      resRunningNonEnrolled.body.canRegister === true &&
      resRunningNonEnrolled.body.canParticipate === false &&
      resRunningNonEnrolled.body.isEnrolled === false &&
      resRunningNonEnrolled.body.runtimeState === 'running');

    // Ended contest - Enrolled student
    const resEndedEnrolled = await makeRequest('GET', `/api/contests/${endedContest.id}/eligibility`, null, tokenStudent1);
    record('D3. Ended contest + Enrolled student -> registrationOpen = false, canParticipate = false, isEnrolled = true',
      resEndedEnrolled.status === 200 &&
      resEndedEnrolled.body.canRegister === false &&
      resEndedEnrolled.body.canParticipate === false &&
      resEndedEnrolled.body.isEnrolled === true &&
      resEndedEnrolled.body.status.registrationOpen === false &&
      resEndedEnrolled.body.runtimeState === 'ended');

    // Ended contest - Non-enrolled student
    const resEndedNonEnrolled = await makeRequest('GET', `/api/contests/${endedContest.id}/eligibility`, null, tokenStudent2);
    record('D4. Ended contest + Non-enrolled student -> canRegister = false, registrationOpen = false',
      resEndedNonEnrolled.status === 200 &&
      resEndedNonEnrolled.body.canRegister === false &&
      resEndedNonEnrolled.body.status.registrationOpen === false);

    // Archived contest
    const resArchived = await makeRequest('GET', `/api/contests/${archivedContest.id}/eligibility`, null, tokenStudent2);
    record('D5. Archived contest -> allowed = true, canRegister = false, lifecycleValid = false',
      resArchived.status === 200 &&
      resArchived.body.allowed === true &&
      resArchived.body.canRegister === false &&
      resArchived.body.status.lifecycleValid === false &&
      resArchived.body.runtimeState === 'archived');

    // ----------------------------------------------------
    // Section 5: BOLA / IDOR Prevention
    // ----------------------------------------------------
    console.log('\n--- 5. BOLA / IDOR Prevention ---');

    // Student2 tries to pass student1's ID via query param
    const resIdorQuery = await makeRequest('GET', `/api/contests/${runningContest.id}/eligibility?userId=${student1.id}`, null, tokenStudent2);
    record('E1. Query param userId is strictly ignored; evaluates authenticated caller (isEnrolled = false)',
      resIdorQuery.status === 200 &&
      resIdorQuery.body.userId === student2.id &&
      resIdorQuery.body.isEnrolled === false);

    // ----------------------------------------------------
    // Section 6: Authoritative Enforcement in POST /join & Admin Operations
    // ----------------------------------------------------
    console.log('\n--- 6. Authoritative Enforcement in POST /join & Admin Ops ---');

    // 1. Inactive student cannot be added by admin
    const resAddInactive = await makeRequest(
      'POST',
      `/api/contests/${upcomingContest.id}/participants`,
      { userId: inactiveStudent.id },
      tokenProfOwner
    );
    record('F1. Admin cannot add inactive student account (400 Bad Request)',
      resAddInactive.status === 400 && resAddInactive.body.message.includes('inactive'));

    // 2. Professor self-enrollment rejected
    const resJoinProf = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenProfOther);
    record('F2. Professor self-enrollment rejected with 403 Forbidden',
      resJoinProf.status === 403 && resJoinProf.body.message.includes('student'));

    // 3. Valid active student self-enrollment allowed
    const resJoinValid = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent2);
    record('F3. Active eligible student can join upcoming contest (201 Created)',
      resJoinValid.status === 201 && resJoinValid.body.status === 'success');

    // 4. Duplicate enrollment rejected
    const resJoinDup = await makeRequest('POST', `/api/contests/${upcomingContest.id}/join`, {}, tokenStudent2);
    record('F4. Duplicate enrollment attempt gracefully rejected with 409 Conflict',
      resJoinDup.status === 409);

    // 5. Ended contest join rejected
    const resJoinEnded = await makeRequest('POST', `/api/contests/${endedContest.id}/join`, {}, tokenStudent2);
    record('F5. Joining ended contest rejected with 400 Bad Request',
      resJoinEnded.status === 400 && resJoinEnded.body.message.includes('already ended'));

    // 6. Archived contest join rejected
    const resJoinArchived = await makeRequest('POST', `/api/contests/${archivedContest.id}/join`, {}, tokenStudent2);
    record('F6. Joining archived contest rejected with 400 Bad Request',
      resJoinArchived.status === 400 && resJoinArchived.body.message.includes('archived'));

    // ----------------------------------------------------
    // Section 7: Direct Unit Tests for contestAccessService
    // ----------------------------------------------------
    console.log('\n--- 7. contestAccessService Unit Tests ---');

    // Unit 1: Null user
    const nullUserEval = validateStudentEligibility(null, upcomingContest);
    record('G1. validateStudentEligibility handles null user safely',
      nullUserEval.eligible === false && nullUserEval.accountActive === false);

    // Unit 2: Inactive user
    const inactUserEval = validateStudentEligibility({ id: 10, role: 'student', isActive: false }, upcomingContest);
    record('G2. validateStudentEligibility flags inactive account',
      inactUserEval.eligible === false && inactUserEval.accountActive === false);

    // Unit 3: Null contest
    const nullContestEval = validateContestAccess(student1, null);
    record('G3. validateContestAccess handles null contest safely',
      nullContestEval.allowed === false && nullContestEval.reasons.length > 0);

    // Unit 4: Future date evaluation (server authoritative time)
    const futureDate = new Date(Date.now() + 10 * 3600 * 1000);
    const evalFuture = evaluateContestAccessAndEligibility(student1, upcomingContest, false, futureDate);
    record('G4. evaluateContestAccessAndEligibility respects custom server time',
      evalFuture.allowed === true && evalFuture.status.alreadyEnrolled === false);

    // Unit 5: validateTargetStudentForEnrollment
    const targetNonStudent = validateTargetStudentForEnrollment({ id: 99, role: 'professor', isActive: true }, upcomingContest);
    record('G5. validateTargetStudentForEnrollment rejects non-student role',
      targetNonStudent.valid === false && targetNonStudent.statusCode === 400);

    const targetInactive = validateTargetStudentForEnrollment({ id: 99, role: 'student', isActive: false }, upcomingContest);
    record('G6. validateTargetStudentForEnrollment rejects inactive student',
      targetInactive.valid === false && targetInactive.statusCode === 400);

    const targetEndedContest = validateTargetStudentForEnrollment({ id: 99, role: 'student', isActive: true }, endedContest);
    record('G7. validateTargetStudentForEnrollment rejects ended contest',
      targetEndedContest.valid === false && targetEndedContest.statusCode === 409);

    // ----------------------------------------------------
    // Section 8: Security Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 8. Security Audit Logging ---');

    const auditDeniedRes = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 ORDER BY id DESC LIMIT 1`,
      [profOther.id]
    );
    record('H1. PRIVILEGED_ACTION_DENIED logged for unauthorized join attempt',
      auditDeniedRes.rows.length > 0 && auditDeniedRes.rows[0].outcome === 'denied');

    const auditJoinRes = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PARTICIPANT_JOINED' AND actor_id = $1 ORDER BY id DESC LIMIT 1`,
      [student2.id]
    );
    record('H2. PARTICIPANT_JOINED logged for successful enrollment',
      auditJoinRes.rows.length > 0 && auditJoinRes.rows[0].outcome === 'success');

  } catch (err) {
    console.error('Unexpected test exception:', err);
    record('Fatal Test Failure', false, err.message);
  } finally {
    if (server) {
      server.close();
    }
    await db.pool.end();
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.7.6 TEST SUMMARY: ${pass.length} PASSED, ${fail.length} FAILED`);
  console.log('=======================================================\n');

  if (fail.length > 0) {
    console.error('Failed tests:');
    fail.forEach((f) => console.error(` - ${f.name} ${f.details}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
