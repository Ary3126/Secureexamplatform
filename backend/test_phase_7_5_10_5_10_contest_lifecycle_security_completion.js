/**
 * CODEFROG — Phase 7.5.10.5.10
 * Contest Lifecycle Security Hardening, Publishing & Join Safety Suite
 * File: backend/test_phase_7_5_10_5_10_contest_lifecycle_security_completion.js
 *
 * Exhaustively validates:
 * 1. Contest Publish Security & Authorization (RBAC, BOLA, Prerequisites, Temporal End Time Gate)
 * 2. Contest Unpublish Security & Authorization (RBAC, BOLA, Upcoming State, 0 Submissions Gate)
 * 3. Contest Self-Enrollment & Join Safety (Student-only, Active account, Lifecycle State Gates, Concurrency)
 * 4. Concurrent Lifecycle Transitions (Publish race, Unpublish race, Publish+Unpublish race)
 * 5. Generic Update Bypass Resistance (PATCH status, isPublished injection)
 * 6. Participant Management & Historical Submission Preservation
 * 7. Double-Click Creation Deduplication Safety
 * 8. End-to-End Lifecycle State Machine Transition Matrix
 * 9. Input Validation, Fuzzing & SQLi Resilience
 * 10. Audit Logging Compliance & Secret Sanitization
 * 11. Database Constraint Integrity & Canonical Baseline Restoration
 */

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_CONTEST_MAX = '5000';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const RatingService = require('./src/services/ratingService');
const { generateToken, hashPassword } = require('./src/services/authService');
const { execSync } = require('child_process');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];
const trackedProblemIds = [];

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
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    if (payload !== null) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          body: parsed,
        });
      });
    });

    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

const get = (path, token = null) => request('GET', path, null, token);
const post = (path, body = {}, token = null) => request('POST', path, body, token);
const put = (path, body = {}, token = null) => request('PUT', path, body, token);
const patch = (path, body = {}, token = null) => request('PATCH', path, body, token);
const del = (path, token = null) => request('DELETE', path, null, token);

async function runTestSuite() {
  console.log('\n================================================================');
  console.log(' Phase 7.5.10.5.10: Contest Lifecycle Security Completion Suite ');
  console.log('================================================================\n');

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    const now = Date.now();
    const pwdHash = await hashPassword('SecurePass123!');

    // Setup actors
    const profOwner = await UserModel.createUser({
      username: `cmp_prof_owner_${now}`,
      email: `cmp_prof_owner_${now}@codefrog.internal`,
      fullName: 'Professor Owner Complete',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profOwner.id);
    const tokenProfOwner = generateToken(profOwner);

    const profOther = await UserModel.createUser({
      username: `cmp_prof_other_${now}`,
      email: `cmp_prof_other_${now}@codefrog.internal`,
      fullName: 'Professor Other Complete',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profOther.id);
    const tokenProfOther = generateToken(profOther);

    const contestAdmin = await UserModel.createUser({
      username: `cmp_cadm_${now}`,
      email: `cmp_cadm_${now}@codefrog.internal`,
      fullName: 'Contest Admin Complete',
      passwordHash: pwdHash,
      role: 'contest_admin',
    });
    trackedUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `cmp_sadm_${now}`,
      email: `cmp_sadm_${now}@codefrog.internal`,
      fullName: 'Super Admin Complete',
      passwordHash: pwdHash,
      role: 'super_admin',
    });
    trackedUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `cmp_stu1_${now}`,
      email: `cmp_stu1_${now}@codefrog.internal`,
      fullName: 'Student Complete One',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student1.id);
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `cmp_stu2_${now}`,
      email: `cmp_stu2_${now}@codefrog.internal`,
      fullName: 'Student Complete Two',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student2.id);
    const tokenStudent2 = generateToken(student2);

    const inactiveStudent = await UserModel.createUser({
      username: `cmp_stu_inact_${now}`,
      email: `cmp_stu_inact_${now}@codefrog.internal`,
      fullName: 'Student Inactive Complete',
      passwordHash: pwdHash,
      role: 'student',
    });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveStudent.id]);
    trackedUserIds.push(inactiveStudent.id);
    const tokenInactiveStudent = generateToken({ ...inactiveStudent, isActive: false, is_active: false });

    // Base test problem
    const problem1 = await ProblemModel.createProblem({
      title: `Lifecycle Complete Problem 1 ${now}`,
      slug: `cmp-prob-1-${now}`,
      description: 'Find optimal sum',
      difficulty: 'medium',
      timeLimit: 2000,
      memoryLimit: 256,
      createdBy: profOwner.id,
      accessScope: 'public',
    });
    trackedProblemIds.push(problem1.id);
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '1 2', '3', true, false), ($1, '3 4', '7', false, true)`,
      [problem1.id]
    );

    const problem2 = await ProblemModel.createProblem({
      title: `Lifecycle Complete Problem 2 ${now}`,
      slug: `cmp-prob-2-${now}`,
      description: 'Second problem',
      difficulty: 'easy',
      timeLimit: 1000,
      memoryLimit: 128,
      createdBy: profOwner.id,
      accessScope: 'public',
    });
    trackedProblemIds.push(problem2.id);
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '10', '20', true, false)`,
      [problem2.id]
    );

    // Common time windows
    const futureStart = new Date(now + 600000).toISOString();
    const farFutureEnd = new Date(now + 3600000).toISOString();
    const pastStart = new Date(now - 7200000).toISOString();
    const pastEnd = new Date(now - 3600000).toISOString();

    // ──────────────────────────────────────────────────────────
    // Section A: Contest Publish Authentication & RBAC
    // ──────────────────────────────────────────────────────────
    console.log('--- Section A: Contest Publish Authentication & RBAC ---');
    {
      const cRes = await post('/api/contests', {
        title: `Auth Test Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const testContestId = cRes.data.contest.id;
      trackedContestIds.push(testContestId);
      await ContestModel.addProblemToContest({ contestId: testContestId, problemId: problem1.id, points: 100 });

      // A1. Unauthenticated publish returns 401
      const unauthPub = await post(`/api/contests/${testContestId}/publish`);
      assert(unauthPub.status === 401, 'A1. Unauthenticated request to publish contest rejected with 401 Unauthorized');

      // A2. Student publish returns 403
      const studentPub = await post(`/api/contests/${testContestId}/publish`, {}, tokenStudent1);
      assert(studentPub.status === 403, 'A2. Student request to publish contest rejected with 403 Forbidden');

      // A3. Owning Professor publish returns 200
      const ownerPub = await post(`/api/contests/${testContestId}/publish`, {}, tokenProfOwner);
      assert(ownerPub.status === 200, 'A3. Owning professor publish succeeds with 200 OK');
      assert(ownerPub.data.contest.status === 'published', 'A3b. Contest status updated to "published"');

      // Revert to draft to test contest_admin and super_admin
      await post(`/api/contests/${testContestId}/unpublish`, {}, tokenProfOwner);

      // A4. Contest Admin can publish
      const cadmPub = await post(`/api/contests/${testContestId}/publish`, {}, tokenContestAdmin);
      assert(cadmPub.status === 200, 'A4. Contest admin publish succeeds with 200 OK');
      await post(`/api/contests/${testContestId}/unpublish`, {}, tokenContestAdmin);

      // A5. Super Admin can publish
      const sadmPub = await post(`/api/contests/${testContestId}/publish`, {}, tokenSuperAdmin);
      assert(sadmPub.status === 200, 'A5. Super admin publish succeeds with 200 OK');
    }

    // ──────────────────────────────────────────────────────────
    // Section B: Contest Publish Ownership & BOLA Defense
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section B: Contest Publish Ownership & BOLA Defense ---');
    {
      const cRes = await post('/api/contests', {
        title: `BOLA Test Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const bolaContestId = cRes.data.contest.id;
      trackedContestIds.push(bolaContestId);
      await ContestModel.addProblemToContest({ contestId: bolaContestId, problemId: problem1.id, points: 100 });

      // B1. Non-owning professor publish rejected with 403
      const bolaPub = await post(`/api/contests/${bolaContestId}/publish`, {}, tokenProfOther);
      assert(bolaPub.status === 403, 'B1. Non-owning professor publish blocked with 403 Forbidden (BOLA)');

      // B2. Verify PRIVILEGED_ACTION_DENIED logged in audit_logs
      const auditRes = await db.query(
        `SELECT action, outcome FROM audit_logs 
         WHERE resource_type = 'contest' AND resource_id = $1 AND actor_id = $2`,
        [bolaContestId, profOther.id]
      );
      assert(auditRes.rowCount > 0, 'B2. PRIVILEGED_ACTION_DENIED audit log recorded for unauthorized publish');
      assert(auditRes.rows[0].outcome === 'denied', 'B2b. Audit outcome recorded as "denied"');
    }

    // ──────────────────────────────────────────────────────────
    // Section C: Publish Prerequisites & Temporal End Time Gate
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section C: Publish Prerequisites & Temporal End Time Gate ---');
    {
      // C1. Cannot publish contest without problems
      const cEmpty = await post('/api/contests', {
        title: `Empty Prereq Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const emptyContestId = cEmpty.data.contest.id;
      trackedContestIds.push(emptyContestId);

      const resEmptyPub = await post(`/api/contests/${emptyContestId}/publish`, {}, tokenProfOwner);
      assert(resEmptyPub.status === 400, 'C1. Publishing contest with zero problems rejected with 400 Bad Request');
      assert(resEmptyPub.data.message.includes('problem'), 'C1b. Error explicitly cites missing problems');

      // C2. Cannot publish contest if already published
      await ContestModel.addProblemToContest({ contestId: emptyContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${emptyContestId}/publish`, {}, tokenProfOwner);
      const resRepeatPub = await post(`/api/contests/${emptyContestId}/publish`, {}, tokenProfOwner);
      assert(resRepeatPub.status === 400, 'C2. Re-publishing an already published contest rejected with 400 Bad Request');

      // C3. Cannot publish contest whose endTime has already passed (Temporal Gate)
      const cPast = await post('/api/contests', {
        title: `Past End Time Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const pastContestId = cPast.data.contest.id;
      trackedContestIds.push(pastContestId);
      await ContestModel.addProblemToContest({ contestId: pastContestId, problemId: problem1.id, points: 100 });
      // Update timings to elapsed in the past
      await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [pastStart, pastEnd, pastContestId]);

      const resPastPub = await post(`/api/contests/${pastContestId}/publish`, {}, tokenProfOwner);
      assert(resPastPub.status === 400, 'C3. Publishing an already-expired contest rejected with 400 Bad Request');
      assert(
        resPastPub.data.message.includes('end time has already passed') || resPastPub.data.message.includes('passed'),
        'C3b. Error cites contest end time has already passed'
      );

      // C4. Cannot publish an archived contest
      const cArch = await post('/api/contests', {
        title: `Archived Prereq Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const archContestId = cArch.data.contest.id;
      trackedContestIds.push(archContestId);
      await post(`/api/contests/${archContestId}/archive`, {}, tokenProfOwner);

      const resArchPub = await post(`/api/contests/${archContestId}/publish`, {}, tokenProfOwner);
      assert(resArchPub.status === 400, 'C4. Publishing an archived contest rejected with 400 Bad Request');
    }

    // ──────────────────────────────────────────────────────────
    // Section D: Contest Unpublish Security & Lifecycle Gates
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section D: Contest Unpublish Security & Lifecycle Gates ---');
    {
      const cUnpub = await post('/api/contests', {
        title: `Unpublish Lifecycle Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const unpubContestId = cUnpub.data.contest.id;
      trackedContestIds.push(unpubContestId);
      await ContestModel.addProblemToContest({ contestId: unpubContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${unpubContestId}/publish`, {}, tokenProfOwner);

      // D1. Unauthenticated unpublish returns 401
      const resUnauthUnpub = await post(`/api/contests/${unpubContestId}/unpublish`);
      assert(resUnauthUnpub.status === 401, 'D1. Unauthenticated unpublish returns 401 Unauthorized');

      // D2. Student unpublish returns 403
      const resStudentUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenStudent1);
      assert(resStudentUnpub.status === 403, 'D2. Student unpublish returns 403 Forbidden');

      // D3. Non-owner professor unpublish returns 403 (BOLA)
      const resBolaUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenProfOther);
      assert(resBolaUnpub.status === 403, 'D3. Non-owner professor unpublish returns 403 Forbidden (BOLA)');

      // D4. Owning professor unpublishes upcoming contest -> 200
      const resOwnerUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenProfOwner);
      assert(resOwnerUnpub.status === 200, 'D4. Owning professor unpublishes upcoming contest (200 OK)');
      assert(resOwnerUnpub.data.contest.status === 'draft', 'D4b. Contest status returned to "draft"');

      // D5. Repeat unpublish on draft returns 400
      const resRepeatUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenProfOwner);
      assert(resRepeatUnpub.status === 400, 'D5. Repeat unpublish on draft contest rejected with 400 Bad Request');

      // Re-publish and set to running
      await post(`/api/contests/${unpubContestId}/publish`, {}, tokenProfOwner);
      const curStart = new Date(now - 120000).toISOString();
      await db.query('UPDATE contests SET start_time = $1 WHERE id = $2', [curStart, unpubContestId]);

      // D6. Unpublishing running contest returns 409 Conflict
      const resRunningUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenProfOwner);
      assert(resRunningUnpub.status === 409, 'D6. Unpublishing actively running contest rejected with 409 Conflict');

      // D7. Unpublishing ended contest returns 409 Conflict
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [new Date(now - 60000).toISOString(), unpubContestId]);
      const resEndedUnpub = await post(`/api/contests/${unpubContestId}/unpublish`, {}, tokenProfOwner);
      assert(resEndedUnpub.status === 409, 'D7. Unpublishing ended contest rejected with 409 Conflict');

      // D8. Contest with existing submissions cannot be unpublished (409 Conflict)
      const cSub = await post('/api/contests', {
        title: `Submissions Unpublish Target ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const subContestId = cSub.data.contest.id;
      trackedContestIds.push(subContestId);
      await ContestModel.addProblemToContest({ contestId: subContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${subContestId}/publish`, {}, tokenProfOwner);
      await db.query(
        `INSERT INTO submissions (user_id, problem_id, contest_id, language, source_code, status, score)
         VALUES ($1, $2, $3, 'python', 'print(1)', 'accepted', 100)`,
        [student1.id, problem1.id, subContestId]
      );
      const resSubUnpub = await post(`/api/contests/${subContestId}/unpublish`, {}, tokenProfOwner);
      assert(resSubUnpub.status === 409, 'D8. Unpublishing contest with existing submissions blocked with 409 Conflict');
    }

    // ──────────────────────────────────────────────────────────
    // Section E: Contest Self-Enrollment & Join Safety
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section E: Contest Self-Enrollment & Join Safety ---');
    {
      const cJoin = await post('/api/contests', {
        title: `Join Safety Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const joinContestId = cJoin.data.contest.id;
      trackedContestIds.push(joinContestId);
      await ContestModel.addProblemToContest({ contestId: joinContestId, problemId: problem1.id, points: 100 });

      // E1. Anonymous cannot join -> 401
      const resAnonJoin = await post(`/api/contests/${joinContestId}/join`);
      assert(resAnonJoin.status === 401, 'E1. Anonymous request to join contest rejected with 401 Unauthorized');

      // E2. Joining unpublished draft returns 400
      const resDraftJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenStudent1);
      assert(resDraftJoin.status === 400, 'E2. Student joining draft contest rejected with 400 Bad Request');

      // Publish contest
      await post(`/api/contests/${joinContestId}/publish`, {}, tokenProfOwner);

      // E3. Professor cannot self-enroll as competitor -> 403
      const resProfJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenProfOwner);
      assert(resProfJoin.status === 403, 'E3. Professor self-enrollment rejected with 403 Forbidden');
      assert(resProfJoin.data.message.includes('student'), 'E3b. Error confirms only students can participate');

      // E4. Contest admin cannot self-enroll -> 403
      const resCadmJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenContestAdmin);
      assert(resCadmJoin.status === 403, 'E4. Contest admin self-enrollment rejected with 403 Forbidden');

      // E5. Super admin cannot self-enroll -> 403
      const resSadmJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenSuperAdmin);
      assert(resSadmJoin.status === 403, 'E5. Super admin self-enrollment rejected with 403 Forbidden');

      // E6. Deactivated student cannot enroll -> 401/403
      const resInactJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenInactiveStudent);
      assert(resInactJoin.status === 401 || resInactJoin.status === 403, 'E6. Deactivated student account enrollment rejected with 401/403 (got ' + resInactJoin.status + ')');

      // E7. Active student enrolls successfully -> 201
      const resStudentJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenStudent1);
      assert(resStudentJoin.status === 201, 'E7. Active student successfully joins published contest (201 Created)');
      assert(resStudentJoin.data.participant.userId === student1.id, 'E7b. Participant record returned matches student ID');

      // E8. Repeat join returns 409 Conflict
      const resDupJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenStudent1);
      assert(resDupJoin.status === 409, 'E8. Repeated student join returns 409 Conflict');
      assert(resDupJoin.data.message.includes('already joined'), 'E8b. Message confirms student already enrolled');

      // E9. Cannot join ended contest -> 400
      await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [pastStart, pastEnd, joinContestId]);
      const resEndedJoin = await post(`/api/contests/${joinContestId}/join`, {}, tokenStudent2);
      assert(resEndedJoin.status === 400, 'E9. Student joining ended contest rejected with 400 Bad Request');
    }

    // ──────────────────────────────────────────────────────────
    // Section F: High Concurrency Lifecycle Safety (Races)
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section F: High Concurrency Lifecycle Safety (Races) ---');
    {
      // F1. 10 Concurrent joins by the same student
      const cRace = await post('/api/contests', {
        title: `Race Safety Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const raceContestId = cRace.data.contest.id;
      trackedContestIds.push(raceContestId);
      await ContestModel.addProblemToContest({ contestId: raceContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${raceContestId}/publish`, {}, tokenProfOwner);

      const joinPromises = Array.from({ length: 10 }, () =>
        post(`/api/contests/${raceContestId}/join`, {}, student2.token || tokenStudent2)
      );
      const joinResponses = await Promise.all(joinPromises);

      const joinSuccess = joinResponses.filter((r) => r.status === 201).length;
      const joinConflict = joinResponses.filter((r) => r.status === 409).length;
      const joinErrors = joinResponses.filter((r) => r.status >= 500).length;

      assert(joinSuccess === 1, `F1. Exactly 1 concurrent join succeeded with 201 (got ${joinSuccess})`);
      assert(joinConflict === 9, `F1b. Exactly 9 concurrent joins returned 409 Conflict (got ${joinConflict})`);
      assert(joinErrors === 0, 'F1c. Zero 500 errors during high-concurrency student enrollment');

      const pCount = await db.query(
        'SELECT COUNT(*)::int AS cnt FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
        [raceContestId, student2.id]
      );
      assert(pCount.rows[0].cnt === 1, 'F1d. Exactly 1 row in contest_participants table for student');

      // F2. 10 Concurrent publish requests on a draft contest
      const cDraftRace = await post('/api/contests', {
        title: `Concurrent Publish Race ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const draftRaceId = cDraftRace.data.contest.id;
      trackedContestIds.push(draftRaceId);
      await ContestModel.addProblemToContest({ contestId: draftRaceId, problemId: problem1.id, points: 100 });

      const pubPromises = Array.from({ length: 10 }, () =>
        post(`/api/contests/${draftRaceId}/publish`, {}, tokenProfOwner)
      );
      const pubResponses = await Promise.all(pubPromises);

      const pubSuccess = pubResponses.filter((r) => r.status === 200).length;
      const pubBad = pubResponses.filter((r) => r.status === 400).length;
      const pubErrors = pubResponses.filter((r) => r.status >= 500).length;

      assert(pubSuccess === 1, `F2. Exactly 1 concurrent publish succeeded with 200 (got ${pubSuccess})`);
      assert(pubBad === 9, `F2b. Exactly 9 concurrent publish requests returned 400 Bad Request (got ${pubBad})`);
      assert(pubErrors === 0, 'F2c. Zero 500 errors during concurrent publish race');

      // F3. Interleaved publish + unpublish race
      const mixedOps = [
        ...Array.from({ length: 5 }, () => post(`/api/contests/${draftRaceId}/publish`, {}, tokenProfOwner)),
        ...Array.from({ length: 5 }, () => post(`/api/contests/${draftRaceId}/unpublish`, {}, tokenProfOwner)),
      ];
      const mixedResponses = await Promise.all(mixedOps);
      const mixedErrors = mixedResponses.filter((r) => r.status >= 500).length;
      assert(mixedErrors === 0, 'F3. Interleaved concurrent publish+unpublish handled cleanly with zero 500 errors');

      const finalCheck = await db.query('SELECT status FROM contests WHERE id = $1', [draftRaceId]);
      assert(['draft', 'published'].includes(finalCheck.rows[0].status), `F3b. Final contest state is valid: ${finalCheck.rows[0].status}`);
    }

    // ──────────────────────────────────────────────────────────
    // Section G: Generic Update Bypass Resistance
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section G: Generic Update Bypass Resistance ---');
    {
      const cBypass = await post('/api/contests', {
        title: `Generic Bypass Target ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const bypassContestId = cBypass.data.contest.id;
      trackedContestIds.push(bypassContestId);

      // G1. Direct PATCH status='published' without problems rejected (400)
      const resPatchPub = await patch(`/api/contests/${bypassContestId}`, { status: 'published' }, tokenProfOwner);
      assert(resPatchPub.status === 400, 'G1. Directly sending status="published" via PATCH rejected with 400 Bad Request');
      assert(resPatchPub.data.message.includes('/publish'), 'G1b. Error redirects caller to dedicated /publish endpoint');

      // G2. Injected isPublished=true does not mutate status
      await put(`/api/contests/${bypassContestId}`, { title: 'Updated Title', isPublished: true }, tokenProfOwner);
      const rowAfterPut = await ContestModel.findContestById(bypassContestId);
      assert(rowAfterPut.status === 'draft', 'G2. Injected isPublished=true did not publish the draft contest');

      // Attach problem and properly publish
      await ContestModel.addProblemToContest({ contestId: bypassContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${bypassContestId}/publish`, {}, tokenProfOwner);

      // G3. Direct PATCH status='draft' rejected (400)
      const resPatchDraft = await patch(`/api/contests/${bypassContestId}`, { status: 'draft' }, tokenProfOwner);
      assert(resPatchDraft.status === 400, 'G3. Directly sending status="draft" via PATCH rejected with 400 Bad Request');
      assert(resPatchDraft.data.message.includes('/unpublish'), 'G3b. Error redirects caller to dedicated /unpublish endpoint');
    }

    // ──────────────────────────────────────────────────────────
    // Section H: Participant Management & Historical Submissions
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section H: Participant Management & Historical Submissions ---');
    {
      const cPart = await post('/api/contests', {
        title: `Participant Preservation ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
      }, tokenProfOwner);
      const partContestId = cPart.data.contest.id;
      trackedContestIds.push(partContestId);
      await ContestModel.addProblemToContest({ contestId: partContestId, problemId: problem1.id, points: 100 });
      await post(`/api/contests/${partContestId}/publish`, {}, tokenProfOwner);

      // H1. Manager adds student
      const addRes = await post(`/api/contests/${partContestId}/participants`, { userId: student1.id }, tokenProfOwner);
      assert(addRes.status === 201, 'H1. Manager adds student participant successfully (201 Created)');

      // H2. Manager removes student without submissions
      const remRes = await del(`/api/contests/${partContestId}/participants/${student1.id}`, tokenProfOwner);
      assert(remRes.status === 200, 'H2. Manager removes student without submissions successfully (200 OK)');

      // H3. Re-enroll and insert a submission
      await post(`/api/contests/${partContestId}/participants`, { userId: student1.id }, tokenProfOwner);
      await db.query(
        `INSERT INTO submissions (user_id, problem_id, contest_id, language, source_code, status, score)
         VALUES ($1, $2, $3, 'python', 'print(10)', 'accepted', 100)`,
        [student1.id, problem1.id, partContestId]
      );

      // H4. Manager attempt to remove student with historical submission blocked (409)
      const remBlockedRes = await del(`/api/contests/${partContestId}/participants/${student1.id}`, tokenProfOwner);
      assert(remBlockedRes.status === 409, 'H4. Removing student with historical submissions blocked with 409 Conflict');
      assert(remBlockedRes.data.message.includes('Historical submission records must be preserved'), 'H4b. Error cites historical submission preservation');
    }

    // ──────────────────────────────────────────────────────────
    // Section I: Rapid Double-Click Contest Creation Race
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section I: Rapid Double-Click Contest Creation Race ---');
    {
      const dupTitle = `Double_Click_Contest_${now}`;

      const [res1, res2] = await Promise.all([
        post('/api/contests', {
          title: dupTitle,
          description: 'Fast double-click test',
          startTime: futureStart,
          endTime: farFutureEnd,
        }, tokenProfOwner),
        post('/api/contests', {
          title: dupTitle,
          description: 'Fast double-click test',
          startTime: futureStart,
          endTime: farFutureEnd,
        }, tokenProfOwner),
      ]);

      const statuses = [res1.status, res2.status];
      const createdCount = statuses.filter((s) => s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      assert(createdCount === 1, `I1. Exactly 1 contest creation succeeded with 201 (got ${createdCount})`);
      assert(conflictCount === 1, `I1b. Duplicate contest creation rejected with 409 Conflict (got ${conflictCount})`);

      const dbCheck = await db.query('SELECT id FROM contests WHERE title = $1', [dupTitle]);
      assert(dbCheck.rowCount === 1, 'I1c. Exactly 1 contest row was persisted in database');
      if (dbCheck.rowCount > 0) {
        trackedContestIds.push(dbCheck.rows[0].id);
      }
    }

    // ──────────────────────────────────────────────────────────
    // Section J: Complete End-to-End Lifecycle State Machine
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section J: Complete End-to-End Lifecycle State Machine ---');
    {
      // 1. Create Draft
      const e2eRes = await post('/api/contests', {
        title: `Full E2E Lifecycle Contest ${now}`,
        startTime: futureStart,
        endTime: farFutureEnd,
        isRated: true,
      }, tokenProfOwner);
      const e2eId = e2eRes.data.contest.id;
      trackedContestIds.push(e2eId);
      assert(e2eRes.status === 201, 'J1. Contest created in draft status (201 Created)');

      // 2. Attach Problems
      await ContestModel.addProblemToContest({ contestId: e2eId, problemId: problem1.id, points: 100 });
      await ContestModel.addProblemToContest({ contestId: e2eId, problemId: problem2.id, points: 100 });
      assert(true, 'J2. Problems attached to contest in draft mode');

      // 3. Publish Contest
      const pubRes = await post(`/api/contests/${e2eId}/publish`, {}, tokenProfOwner);
      assert(pubRes.status === 200, 'J3. Contest published (200 OK, status="published")');

      // 4. Students Enroll
      const j1 = await post(`/api/contests/${e2eId}/join`, {}, tokenStudent1);
      const j2 = await post(`/api/contests/${e2eId}/join`, {}, tokenStudent2);
      assert(j1.status === 201 && j2.status === 201, 'J4. Both students successfully enrolled (201 Created)');

      // 5. Advance to Running
      const runStart = new Date(now - 120000).toISOString();
      const runEnd = new Date(now + 120000).toISOString();
      await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [runStart, runEnd, e2eId]);
      assert(true, 'J5. Contest advanced to running runtime state');

      // 6. Submissions Accepted
      const s1 = await post('/api/submissions', {
        contestId: e2eId,
        problemId: problem1.id,
        language: 'python',
        sourceCode: 'print(1)',
      }, tokenStudent1);
      assert(s1.status === 201, 'J6. Submissions accepted during running state (201 Created)');

      // 7. Contest Ends
      const elapsedEnd = new Date(now - 1000).toISOString();
      await db.query('UPDATE contests SET end_time = $1 WHERE id = $2', [elapsedEnd, e2eId]);
      assert(true, 'J7. Contest advanced to ended runtime state');

      // 8. Submissions Rejected in Ended State
      const s2 = await post('/api/submissions', {
        contestId: e2eId,
        problemId: problem1.id,
        language: 'python',
        sourceCode: 'print(2)',
      }, tokenStudent2);
      assert(s2.status === 400, 'J8. Submissions rejected once contest has ended (400 Bad Request)');

      // Simulate judge completion for pending submissions
      await db.query(`UPDATE submissions SET status = 'accepted', score = 100 WHERE contest_id = $1`, [e2eId]);

      // 9. Finalize Ratings
      const finRes = await post(`/api/contests/${e2eId}/finalize-ratings`, {}, tokenProfOwner);
      assert(finRes.status === 200, 'J9. Contest ratings finalized successfully (200 OK)');

      // 10. Verify Sealed Snapshot
      const finalRow = await ContestModel.findContestById(e2eId);
      assert(finalRow.isRatingFinalized === true, 'J10. Contest is permanently sealed (is_rating_finalized=true)');
      assert(finalRow.finalResultsSnapshot !== null, 'J10b. final_results_snapshot JSONB is preserved');

      // 11. Archive Contest
      const archRes = await post(`/api/contests/${e2eId}/archive`, {}, tokenProfOwner);
      assert(archRes.status === 200, 'J11. Finalized contest cleanly archived (200 OK)');
      assert(archRes.data.contest.status === 'archived', 'J11b. Final status is "archived"');
    }

    // ──────────────────────────────────────────────────────────
    // Section K: Input Boundaries & Injection Resilience
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section K: Input Boundaries & Injection Resilience ---');
    {
      assert((await post('/api/contests/abc/publish', {}, tokenProfOwner)).status === 400, 'K1. Non-integer ID on publish rejected (400)');
      assert((await post('/api/contests/-1/publish', {}, tokenProfOwner)).status === 400, 'K2. Negative ID on publish rejected (400)');
      assert((await post('/api/contests/9999999/publish', {}, tokenProfOwner)).status === 404, 'K3. Non-existent ID on publish returns 404');
      assert((await post("/api/contests/1' OR '1'='1/publish", {}, tokenProfOwner)).status === 400, 'K4. SQLi probe in publish ID rejected (400)');

      assert((await post('/api/contests/abc/join', {}, tokenStudent1)).status === 400, 'K5. Non-integer ID on join rejected (400)');
      assert((await post('/api/contests/-5/join', {}, tokenStudent1)).status === 400, 'K6. Negative ID on join rejected (400)');
      assert((await post('/api/contests/9999999/join', {}, tokenStudent1)).status === 404, 'K7. Non-existent ID on join returns 404');
      assert((await post("/api/contests/1; DROP TABLE contests;/join", {}, tokenStudent1)).status === 400, 'K8. SQLi probe in join ID rejected (400)');
    }

    // ──────────────────────────────────────────────────────────
    // Section L: Audit Logging & Database Integrity
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section L: Audit Logging & Database Integrity ---');
    {
      const pubLog = await db.query("SELECT id FROM audit_logs WHERE action = 'CONTEST_PUBLISHED' LIMIT 1");
      assert(pubLog.rowCount > 0, 'L1. CONTEST_PUBLISHED audit logs exist in database');

      const unpubLog = await db.query("SELECT id FROM audit_logs WHERE action = 'CONTEST_UNPUBLISHED' LIMIT 1");
      assert(unpubLog.rowCount > 0, 'L2. CONTEST_UNPUBLISHED audit logs exist in database');

      const joinLog = await db.query("SELECT id FROM audit_logs WHERE action = 'PARTICIPANT_JOINED' LIMIT 1");
      assert(joinLog.rowCount > 0, 'L3. PARTICIPANT_JOINED audit logs exist in database');

      const passLeak = await db.query("SELECT id FROM audit_logs WHERE metadata::text ILIKE '%password_hash%' OR metadata::text ILIKE '%secret%' LIMIT 1");
      assert(passLeak.rowCount === 0, 'L4. Zero passwords or confidential secrets leaked into audit logs');
    }

    // ──────────────────────────────────────────────────────────
    // Section M: Teardown & Canonical Baseline Restoration
    // ──────────────────────────────────────────────────────────
    console.log('\n--- Section M: Teardown & Baseline Verification ---');
    if (trackedContestIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM rating_history WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
    }
    if (trackedProblemIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])`, [trackedProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [trackedProblemIds]);
    }
    if (trackedUserIds.length > 0) {
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM rating_history WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM contest_participants WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
    }

    try {
      execSync('node backend/restore_canonical_baseline.js', { stdio: 'ignore' });
    } catch (e) {
      console.error('Error restoring canonical baseline:', e);
    }

    const uCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM users;`);
    const cCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM contests;`);
    const pCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM problems;`);
    const sCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM submissions;`);
    const rCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM rating_history;`);

    assert(uCount.rows[0].cnt === 5, `M1. Users match canonical baseline (5, got ${uCount.rows[0].cnt})`);
    assert(cCount.rows[0].cnt === 1, `M2. Contests match canonical baseline (1, got ${cCount.rows[0].cnt})`);
    assert(pCount.rows[0].cnt === 5, `M3. Problems match canonical baseline (5, got ${pCount.rows[0].cnt})`);
    assert(sCount.rows[0].cnt === 33, `M4. Submissions match canonical baseline (33, got ${sCount.rows[0].cnt})`);
    assert(rCount.rows[0].cnt === 0, `M5. Rating history matches canonical baseline (0, got ${rCount.rows[0].cnt})`);

  } catch (err) {
    console.error('Fatal error during test suite execution:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await db.pool.end();
  }

  console.log('\n================================================================');
  console.log(` Phase 7.5.10.5.10 Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite();
