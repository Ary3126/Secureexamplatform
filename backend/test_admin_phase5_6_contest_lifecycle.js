/**
 * Phase 7.5.6 — Contest Lifecycle Management Automated Test Suite
 * File: backend/test_admin_phase5_6_contest_lifecycle.js
 *
 * Verifies all Phase 7.5.6 requirements:
 * A. Lifecycle state calculation (draft, upcoming, running, ended, archived)
 * B. Valid transitions (draft -> published, upcoming -> draft, ended -> archived, draft -> archived)
 * C. Invalid transitions (running -> draft, ended -> draft, running -> archive, archived mutation, publish without problems, double publish, double archive)
 * D. Server-authoritative time (reject/ignore client spoofed state / runtimeState)
 * E. Start boundary (before start, exact start)
 * F. End boundary (before end, exact end)
 * G. RBAC (unauthenticated 401, student 403)
 * H. Professor ownership (owner allowed, non-owner 403 BOLA blocked)
 * I. Contest Admin permissions (allowed across all contests)
 * J. Super Admin permissions (allowed across all contests)
 * K. Unauthorized lifecycle mutation handling and denial logging
 * L. Publish / unpublish behavior (upcoming unpublishes cleanly; submission existence blocks unpublish)
 * M. Archive behavior (ended archives cleanly; preserves submissions, participants, standings, ratings, problems)
 * N. Archived contest protection (locked against update, problem add/remove/reorder)
 * O. Configuration locking (running/ended contests locked against schedule changes)
 * P. Concurrency / race protection (concurrent lifecycle transitions serialize via row locking)
 * Q. Lifecycle + problem mutation interaction (running locks problem mutations)
 * R. Transaction rollback (failed operations leave DB in exact prior state)
 * S. Audit logging (CONTEST_PUBLISHED, CONTEST_UNPUBLISHED, CONTEST_ARCHIVED, PRIVILEGED_ACTION_DENIED)
 * T. Safe errors (standard error envelopes without SQL/internal leaks)
 */
const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { hashPassword, generateToken } = require('./src/services/authService');
const { getContestRuntimeState, isContestEditable, getAvailableLifecycleActions } = require('./src/services/contestService');

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
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runContestLifecycleTests() {
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

  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.6 CONTEST LIFECYCLE MANAGEMENT TEST SUITE');
  console.log('=======================================================\n');

  let prof1, prof2, contestAdmin, superAdmin, student;
  let prof1Token, prof2Token, contestAdminToken, superAdminToken, studentToken;
  let prob1, prob2;

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const pwdHash = await hashPassword('LifecyclePass123!');
    const stamp = Date.now();

    // 1. Seed users
    prof1 = await UserModel.createUser({
      username: `prof_life1_${stamp}`,
      email: `prof_life1_${stamp}@example.com`,
      fullName: 'Professor Lifecycle One',
      passwordHash: pwdHash,
      role: 'professor',
    });
    prof1Token = generateToken(prof1);

    prof2 = await UserModel.createUser({
      username: `prof_life2_${stamp}`,
      email: `prof_life2_${stamp}@example.com`,
      fullName: 'Professor Lifecycle Two',
      passwordHash: pwdHash,
      role: 'professor',
    });
    prof2Token = generateToken(prof2);

    contestAdmin = await UserModel.createUser({
      username: `admin_life_${stamp}`,
      email: `admin_life_${stamp}@example.com`,
      fullName: 'Contest Admin Lifecycle',
      passwordHash: pwdHash,
      role: 'contest_admin',
    });
    contestAdminToken = generateToken(contestAdmin);

    superAdmin = await UserModel.createUser({
      username: `super_life_${stamp}`,
      email: `super_life_${stamp}@example.com`,
      fullName: 'Super Admin Lifecycle',
      passwordHash: pwdHash,
      role: 'super_admin',
    });
    superAdminToken = generateToken(superAdmin);

    student = await UserModel.createUser({
      username: `stud_life_${stamp}`,
      email: `stud_life_${stamp}@example.com`,
      fullName: 'Student Lifecycle',
      passwordHash: pwdHash,
      role: 'student',
    });
    studentToken = generateToken(student);

    // 2. Seed problems
    prob1 = await ProblemModel.createProblem({
      title: `Life Prob 1 ${stamp}`,
      description: 'Problem 1 for lifecycle tests',
      difficulty: 'Easy',
      createdBy: prof1.id,
      cpuTimeLimit: 1000,
      memoryLimit: 256,
    });

    prob2 = await ProblemModel.createProblem({
      title: `Life Prob 2 ${stamp}`,
      description: 'Problem 2 for lifecycle tests',
      difficulty: 'Medium',
      createdBy: prof1.id,
      cpuTimeLimit: 1500,
      memoryLimit: 512,
    });

    // =======================================================
    // A. LIFECYCLE STATE CALCULATION
    // =======================================================
    console.log('\n--- A. Lifecycle State Calculation ---');

    const now = new Date();
    const pastStart = new Date(now.getTime() - 7200000).toISOString();
    const pastEnd = new Date(now.getTime() - 3600000).toISOString();
    const futureStart = new Date(now.getTime() + 3600000).toISOString();
    const futureEnd = new Date(now.getTime() + 7200000).toISOString();

    const draftState = getContestRuntimeState({ status: 'draft', startTime: futureStart, endTime: futureEnd });
    record('Calculates "draft" when status is draft regardless of times', draftState === 'draft');

    const upcomingState = getContestRuntimeState({ status: 'published', startTime: futureStart, endTime: futureEnd });
    record('Calculates "upcoming" when status is published and startTime in future', upcomingState === 'upcoming');

    const runningState = getContestRuntimeState({ status: 'published', startTime: pastStart, endTime: futureEnd });
    record('Calculates "running" when status is published and now between start & end', runningState === 'running');

    const endedState = getContestRuntimeState({ status: 'published', startTime: pastStart, endTime: pastEnd });
    record('Calculates "ended" when status is published and endTime in past', endedState === 'ended');

    const archivedState = getContestRuntimeState({ status: 'archived', startTime: futureStart, endTime: futureEnd });
    record('Calculates "archived" when status is archived regardless of times', archivedState === 'archived');

    // Helper functions
    record('isContestEditable returns editable: true for draft', isContestEditable({ status: 'draft' }).editable === true);
    record('isContestEditable returns editable: true for upcoming', isContestEditable({ status: 'published', startTime: futureStart, endTime: futureEnd }).editable === true);
    record('isContestEditable returns editable: false for running', isContestEditable({ status: 'published', startTime: pastStart, endTime: futureEnd }).editable === false);
    record('isContestEditable returns editable: false for ended', isContestEditable({ status: 'published', startTime: pastStart, endTime: pastEnd }).editable === false);
    record('isContestEditable returns editable: false for archived', isContestEditable({ status: 'archived' }).editable === false);

    // =======================================================
    // B. VALID TRANSITIONS
    // =======================================================
    console.log('\n--- B. Valid Transitions ---');

    // Create draft contest with 1 problem
    const c1 = await ContestModel.createContest({
      title: `Valid Transitions Contest ${stamp}`,
      description: 'Testing valid lifecycle transitions',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    await ContestModel.addProblemToContest({ contestId: c1.id, problemId: prob1.id, points: 100 });

    // Transition 1: draft -> published (upcoming)
    const pubRes = await request('POST', `/api/contests/${c1.id}/publish`, null, prof1Token);
    record('Transition draft -> published succeeds (HTTP 200)', pubRes.status === 200 && pubRes.body?.contest?.status === 'published');
    record('Published contest evaluates runtimeState="upcoming"', pubRes.body?.contest?.runtimeState === 'upcoming');

    // Transition 2: upcoming -> draft (unpublish)
    const unpubRes = await request('POST', `/api/contests/${c1.id}/unpublish`, null, prof1Token);
    record('Transition upcoming -> draft via unpublish succeeds (HTTP 200)', unpubRes.status === 200 && unpubRes.body?.contest?.status === 'draft');
    record('Unpublished contest evaluates runtimeState="draft"', unpubRes.body?.contest?.runtimeState === 'draft');

    // Transition 3: draft -> archived
    const archDraftRes = await request('POST', `/api/contests/${c1.id}/archive`, null, prof1Token);
    record('Transition draft -> archived succeeds (HTTP 200)', archDraftRes.status === 200 && archDraftRes.body?.contest?.status === 'archived');
    record('Archived contest evaluates runtimeState="archived"', archDraftRes.body?.contest?.runtimeState === 'archived');

    // Transition 4: ended -> archived
    const cEnded = await ContestModel.createContest({
      title: `Ended Contest For Archive ${stamp}`,
      description: 'Ended contest to test archive transition',
      startTime: pastStart,
      endTime: pastEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [cEnded.id]);
    await ContestModel.addProblemToContest({ contestId: cEnded.id, problemId: prob1.id, points: 100 });

    const archEndedRes = await request('POST', `/api/contests/${cEnded.id}/archive`, null, prof1Token);
    record('Transition ended -> archived succeeds (HTTP 200)', archEndedRes.status === 200 && archEndedRes.body?.contest?.status === 'archived');
    record('Archived ended contest evaluates runtimeState="archived"', archEndedRes.body?.contest?.runtimeState === 'archived');

    // =======================================================
    // C. INVALID TRANSITIONS
    // =======================================================
    console.log('\n--- C. Invalid Transitions ---');

    // Setup running contest
    const cRunning = await ContestModel.createContest({
      title: `Running Contest Test ${stamp}`,
      description: 'Running contest to test blocked transitions',
      startTime: pastStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [cRunning.id]);
    await ContestModel.addProblemToContest({ contestId: cRunning.id, problemId: prob1.id, points: 100 });

    // Invalid 1: running -> draft (unpublish running contest)
    const unpubRunRes = await request('POST', `/api/contests/${cRunning.id}/unpublish`, null, prof1Token);
    record('Unpublishing a running contest is rejected (HTTP 409 Conflict)', unpubRunRes.status === 409);
    record('Unpublishing running contest returns clear message', String(unpubRunRes.body?.message).includes('running'));

    // Invalid 2: ended -> draft (unpublish ended contest)
    const unpubEndedRes = await request('POST', `/api/contests/${cEnded.id}/unpublish`, null, prof1Token);
    record('Unpublishing an ended/archived contest is rejected (HTTP 400 or 409)', [400, 409].includes(unpubEndedRes.status));

    // Invalid 3: running -> archive (archive actively running contest)
    const archRunRes = await request('POST', `/api/contests/${cRunning.id}/archive`, null, prof1Token);
    record('Archiving an actively running contest is rejected (HTTP 409 Conflict)', archRunRes.status === 409);
    record('Archiving running contest mentions actively running', String(archRunRes.body?.message).includes('running'));

    // Invalid 4: archived -> draft / upcoming (unpublish archived contest)
    const unpubArchRes = await request('POST', `/api/contests/${cEnded.id}/unpublish`, null, prof1Token);
    record('Unpublishing an archived contest is rejected (HTTP 400)', unpubArchRes.status === 400);

    // Invalid 5: publish without problems
    const cEmpty = await ContestModel.createContest({
      title: `Empty Draft Contest ${stamp}`,
      description: 'Draft with no problems',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    const pubEmptyRes = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, prof1Token);
    record('Publishing draft with 0 problems is rejected (HTTP 400 Bad Request)', pubEmptyRes.status === 400);
    record('Publish error indicates at least one problem is required', String(pubEmptyRes.body?.message).toLowerCase().includes('problem'));

    // Invalid 6: double publish
    await ContestModel.addProblemToContest({ contestId: cEmpty.id, problemId: prob1.id, points: 100 });
    const pubFirst = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, prof1Token);
    record('First publish succeeds (HTTP 200)', pubFirst.status === 200);
    const pubSecond = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, prof1Token);
    record('Second publish on already published contest is rejected (HTTP 400)', pubSecond.status === 400);

    // Invalid 7: double archive
    const archSecond = await request('POST', `/api/contests/${cEnded.id}/archive`, null, prof1Token);
    record('Second archive on already archived contest is rejected (HTTP 400)', archSecond.status === 400);

    // =======================================================
    // D. SERVER-AUTHORITATIVE TIME
    // =======================================================
    console.log('\n--- D. Server-Authoritative Time ---');

    // Client attempting to submit { state: 'running' } or { runtimeState: 'running' }
    const spoofAttempt = await request('PATCH', `/api/contests/${cEmpty.id}`, {
      state: 'running',
      runtimeState: 'running',
      status: 'running', // invalid DB status
    }, prof1Token);
    record('Attempting to force invalid or spoofed state is rejected (HTTP 400/409)', [400, 409].includes(spoofAttempt.status));

    // Verify contest runtimeState remains strictly derived
    const verifySpoofRes = await request('GET', `/api/contests/${cEmpty.id}`, null, prof1Token);
    const resolvedState = verifySpoofRes.body?.runtimeState || verifySpoofRes.body?.contest?.runtimeState;
    record('Contest runtimeState remains authoritative (upcoming, not client-forced)', resolvedState === 'upcoming');

    // =======================================================
    // E. START BOUNDARY
    // =======================================================
    console.log('\n--- E. Start Boundary ---');

    const exactNow = new Date();
    // 1. Before start: startTime is 1 second in the future
    const boundaryStartFuture = new Date(exactNow.getTime() + 1000).toISOString();
    const boundaryEndFuture = new Date(exactNow.getTime() + 60000).toISOString();
    const beforeState = getContestRuntimeState({
      status: 'published',
      startTime: boundaryStartFuture,
      endTime: boundaryEndFuture,
    });
    record('Exact boundary: before start evaluates to "upcoming"', beforeState === 'upcoming');

    // 2. Exact start: now >= startTime
    const exactStart = new Date(exactNow.getTime() - 10).toISOString();
    const exactStartRunning = getContestRuntimeState({
      status: 'published',
      startTime: exactStart,
      endTime: boundaryEndFuture,
    });
    record('Exact boundary: now >= startTime evaluates to "running"', exactStartRunning === 'running');

    // =======================================================
    // F. END BOUNDARY
    // =======================================================
    console.log('\n--- F. End Boundary ---');

    // 1. Before end: endTime is 1 second in future
    const boundaryEndJustFuture = new Date(exactNow.getTime() + 1000).toISOString();
    const duringState = getContestRuntimeState({
      status: 'published',
      startTime: exactStart,
      endTime: boundaryEndJustFuture,
    });
    record('Exact boundary: before end evaluates to "running"', duringState === 'running');

    // 2. Exact end: now >= endTime
    const exactEndPast = new Date(exactNow.getTime() - 10).toISOString();
    const endedBoundaryState = getContestRuntimeState({
      status: 'published',
      startTime: exactStart,
      endTime: exactEndPast,
    });
    record('Exact boundary: now >= endTime evaluates to "ended"', endedBoundaryState === 'ended');

    // =======================================================
    // G. RBAC
    // =======================================================
    console.log('\n--- G. RBAC ---');

    // Unauthenticated
    const unauthPub = await request('POST', `/api/contests/${cEmpty.id}/publish`);
    record('Unauthenticated publish returns 401 Unauthorized', unauthPub.status === 401);

    const unauthUnpub = await request('POST', `/api/contests/${cEmpty.id}/unpublish`);
    record('Unauthenticated unpublish returns 401 Unauthorized', unauthUnpub.status === 401);

    const unauthArch = await request('POST', `/api/contests/${cEmpty.id}/archive`);
    record('Unauthenticated archive returns 401 Unauthorized', unauthArch.status === 401);

    // Student role
    const studPub = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, studentToken);
    record('Student publish returns 403 Forbidden', studPub.status === 403);

    const studUnpub = await request('POST', `/api/contests/${cEmpty.id}/unpublish`, null, studentToken);
    record('Student unpublish returns 403 Forbidden', studUnpub.status === 403);

    const studArch = await request('POST', `/api/contests/${cEmpty.id}/archive`, null, studentToken);
    record('Student archive returns 403 Forbidden', studArch.status === 403);

    // =======================================================
    // H. PROFESSOR OWNERSHIP & BOLA
    // =======================================================
    console.log('\n--- H. Professor Ownership & BOLA ---');

    // Prof2 trying to publish/unpublish/archive Prof1's contest
    const bolaPub = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, prof2Token);
    record('Non-owner professor publish returns 403 Forbidden (BOLA)', bolaPub.status === 403);

    const bolaUnpub = await request('POST', `/api/contests/${cEmpty.id}/unpublish`, null, prof2Token);
    record('Non-owner professor unpublish returns 403 Forbidden (BOLA)', bolaUnpub.status === 403);

    const bolaArch = await request('POST', `/api/contests/${cEmpty.id}/archive`, null, prof2Token);
    record('Non-owner professor archive returns 403 Forbidden (BOLA)', bolaArch.status === 403);

    // =======================================================
    // I. CONTEST ADMIN PERMISSIONS
    // =======================================================
    console.log('\n--- I. Contest Admin Permissions ---');

    // Contest Admin unpublishing Prof1's contest
    const caUnpub = await request('POST', `/api/contests/${cEmpty.id}/unpublish`, null, contestAdminToken);
    record('Contest Admin can unpublish another professor’s upcoming contest (HTTP 200)', caUnpub.status === 200);

    // Contest Admin republishing Prof1's contest
    const caPub = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, contestAdminToken);
    record('Contest Admin can publish another professor’s draft contest (HTTP 200)', caPub.status === 200);

    // =======================================================
    // J. SUPER ADMIN PERMISSIONS
    // =======================================================
    console.log('\n--- J. Super Admin Permissions ---');

    // Super Admin unpublishing Prof1's contest
    const saUnpub = await request('POST', `/api/contests/${cEmpty.id}/unpublish`, null, superAdminToken);
    record('Super Admin can unpublish another professor’s upcoming contest (HTTP 200)', saUnpub.status === 200);

    // Super Admin republishing Prof1's contest
    const saPub = await request('POST', `/api/contests/${cEmpty.id}/publish`, null, superAdminToken);
    record('Super Admin can publish another professor’s draft contest (HTTP 200)', saPub.status === 200);

    // =======================================================
    // K. UNAUTHORIZED LIFECYCLE MUTATION
    // =======================================================
    console.log('\n--- K. Unauthorized Lifecycle Mutation ---');

    // Check that BOLA violation created an audit log entry with outcome 'denied'
    const auditRes = await db.query(
      `SELECT action, outcome, resource_id, actor_id, metadata 
       FROM audit_logs 
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY id DESC LIMIT 5`,
      [cEmpty.id]
    );
    record('Audit log records PRIVILEGED_ACTION_DENIED for unauthorized lifecycle attempt', auditRes.rows.length > 0);
    record('Audit log records outcome="denied"', auditRes.rows[0]?.outcome === 'denied');

    // =======================================================
    // L. PUBLISH / UNPUBLISH BEHAVIOR & SUBMISSION CHECK
    // =======================================================
    console.log('\n--- L. Publish / Unpublish Behavior ---');

    // Contest with submissions cannot be unpublished
    // Let's create an upcoming contest with a submission
    const cSubTest = await ContestModel.createContest({
      title: `Upcoming Contest With Submissions ${stamp}`,
      description: 'Testing unpublish block when submissions exist',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    await ContestModel.addProblemToContest({ contestId: cSubTest.id, problemId: prob1.id, points: 100 });
    await ContestModel.publishContestWithSafety(cSubTest.id, prof1);

    // Insert mock submission directly to DB
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, source_code, language, status, execution_time, memory_used)
       VALUES ($1, $2, $3, 'print(1)', 'python', 'accepted', 10, 1024)`,
      [student.id, prob1.id, cSubTest.id]
    );

    const unpubWithSubRes = await request('POST', `/api/contests/${cSubTest.id}/unpublish`, null, prof1Token);
    record('Unpublishing contest with existing submissions is blocked (HTTP 409 Conflict)', unpubWithSubRes.status === 409);
    record('Unpublishing block error message cites existing submissions', String(unpubWithSubRes.body?.message).includes('Submissions already exist'));

    // =======================================================
    // M. ARCHIVE BEHAVIOR (PRESERVATION)
    // =======================================================
    console.log('\n--- M. Archive Behavior & Data Preservation ---');

    // End the contest with submissions and archive it
    await db.query("UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3", [pastStart, pastEnd, cSubTest.id]);
    const archPreserveRes = await request('POST', `/api/contests/${cSubTest.id}/archive`, null, prof1Token);
    record('Archiving ended contest succeeds (HTTP 200)', archPreserveRes.status === 200 && archPreserveRes.body?.contest?.status === 'archived');

    // Verify all submissions and problems still exist
    const subCountRes = await db.query('SELECT COUNT(*) AS count FROM submissions WHERE contest_id = $1', [cSubTest.id]);
    record('Archived contest preserves submissions intact', parseInt(subCountRes.rows[0].count, 10) === 1);

    const probCountRes = await db.query('SELECT COUNT(*) AS count FROM contest_problems WHERE contest_id = $1', [cSubTest.id]);
    record('Archived contest preserves contest_problems intact', parseInt(probCountRes.rows[0].count, 10) === 1);

    // =======================================================
    // N. ARCHIVED CONTEST PROTECTION (IMMUTABILITY)
    // =======================================================
    console.log('\n--- N. Archived Contest Protection ---');

    // 1. Mutation of details
    const patchArchRes = await request('PATCH', `/api/contests/${cSubTest.id}`, { title: 'New Title' }, prof1Token);
    record('Archived contest detail mutation is blocked (HTTP 409 Conflict)', patchArchRes.status === 409);

    // 2. Add problem
    const addProbArchRes = await request('POST', `/api/contests/${cSubTest.id}/problems`, { problemId: prob2.id, points: 50 }, prof1Token);
    record('Adding problem to archived contest is blocked (HTTP 409 Conflict)', addProbArchRes.status === 409);

    // 3. Remove problem
    const delProbArchRes = await request('DELETE', `/api/contests/${cSubTest.id}/problems/${prob1.id}`, null, prof1Token);
    record('Removing problem from archived contest is blocked (HTTP 409 Conflict)', delProbArchRes.status === 409);

    // 4. Reorder problem
    const reorderArchRes = await request('PUT', `/api/contests/${cSubTest.id}/problems/order`, {
      problemIds: [prob1.id],
    }, prof1Token);
    record('Reordering problems on archived contest is blocked (HTTP 409 Conflict)', reorderArchRes.status === 409);

    // =======================================================
    // O. CONFIGURATION LOCKING
    // =======================================================
    console.log('\n--- O. Configuration Locking ---');

    // Running contest cannot update schedule or status
    const lockRunningRes = await request('PATCH', `/api/contests/${cRunning.id}`, {
      startTime: futureStart,
    }, prof1Token);
    record('Running contest cannot modify startTime (HTTP 409 Conflict)', lockRunningRes.status === 409);

    const lockStatusRunningRes = await request('PATCH', `/api/contests/${cRunning.id}`, {
      status: 'draft',
    }, prof1Token);
    record('Running contest cannot revert status to draft (HTTP 409 Conflict)', lockStatusRunningRes.status === 409);

    // Ended contest cannot update schedule
    const lockEndedRes = await request('PATCH', `/api/contests/${cEnded.id}`, {
      endTime: futureEnd,
    }, prof1Token);
    record('Ended/archived contest cannot modify endTime (HTTP 409 Conflict)', lockEndedRes.status === 409);

    // =======================================================
    // P. CONCURRENCY & RACE PROTECTION
    // =======================================================
    console.log('\n--- P. Concurrency & Race Protection ---');

    // Simultaneous unpublish calls on an upcoming contest
    const cRace = await ContestModel.createContest({
      title: `Race Test Contest ${stamp}`,
      description: 'Testing concurrency safety',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: false,
      createdBy: prof1.id,
    });
    await ContestModel.addProblemToContest({ contestId: cRace.id, problemId: prob1.id, points: 100 });
    await ContestModel.publishContestWithSafety(cRace.id, prof1);

    // Fire 3 simultaneous unpublish requests
    const unpubPromises = [
      request('POST', `/api/contests/${cRace.id}/unpublish`, null, prof1Token),
      request('POST', `/api/contests/${cRace.id}/unpublish`, null, prof1Token),
      request('POST', `/api/contests/${cRace.id}/unpublish`, null, prof1Token),
    ];
    const unpubResults = await Promise.all(unpubPromises);
    const successCount = unpubResults.filter((r) => r.status === 200).length;
    const errorCount = unpubResults.filter((r) => r.status === 400 || r.status === 409).length;

    record('Concurrent unpublish: exactly 1 request succeeds (HTTP 200)', successCount === 1);
    record('Concurrent unpublish: remaining requests cleanly rejected without corruption', errorCount === 2);

    // Verify DB status is consistently draft
    const dbStatusCheck = await db.query('SELECT status FROM contests WHERE id = $1', [cRace.id]);
    record('Final contest status after concurrent requests is consistently "draft"', dbStatusCheck.rows[0]?.status === 'draft');

    // =======================================================
    // Q. LIFECYCLE + PROBLEM MUTATION INTERACTION
    // =======================================================
    console.log('\n--- Q. Lifecycle + Problem Mutation Interaction ---');

    // Problem mutation on running contest
    const addProbRunRes = await request('POST', `/api/contests/${cRunning.id}/problems`, { problemId: prob2.id, points: 50 }, prof1Token);
    record('Adding problem to running contest is blocked (HTTP 409 Conflict)', addProbRunRes.status === 409);

    const delProbRunRes = await request('DELETE', `/api/contests/${cRunning.id}/problems/${prob1.id}`, null, prof1Token);
    record('Removing problem from running contest is blocked (HTTP 409 Conflict)', delProbRunRes.status === 409);

    // =======================================================
    // R. TRANSACTION ROLLBACK
    // =======================================================
    console.log('\n--- R. Transaction Rollback ---');

    // An invalid unpublish on running contest leaves contest running
    const preRollback = await db.query('SELECT status, updated_at FROM contests WHERE id = $1', [cRunning.id]);
    await request('POST', `/api/contests/${cRunning.id}/unpublish`, null, prof1Token);
    const postRollback = await db.query('SELECT status, updated_at FROM contests WHERE id = $1', [cRunning.id]);

    record('Transaction rollback: rejected unpublish does not alter status or touch updated_at',
      preRollback.rows[0].status === postRollback.rows[0].status &&
      new Date(preRollback.rows[0].updated_at).getTime() === new Date(postRollback.rows[0].updated_at).getTime()
    );

    // =======================================================
    // S. AUDIT LOGGING
    // =======================================================
    console.log('\n--- S. Audit Logging ---');

    const lifeAuditRes = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE action IN ('CONTEST_PUBLISHED', 'CONTEST_UNPUBLISHED', 'CONTEST_ARCHIVED')
       ORDER BY id DESC LIMIT 10`
    );
    const actions = lifeAuditRes.rows.map((r) => r.action);
    record('Audit log contains CONTEST_PUBLISHED event', actions.includes('CONTEST_PUBLISHED'));
    record('Audit log contains CONTEST_UNPUBLISHED event', actions.includes('CONTEST_UNPUBLISHED'));
    record('Audit log contains CONTEST_ARCHIVED event', actions.includes('CONTEST_ARCHIVED'));

    // Check sanitize (no credentials or tokens in metadata)
    const allMetadataStr = JSON.stringify(lifeAuditRes.rows);
    record('Audit log metadata does not contain passwords or tokens',
      !allMetadataStr.includes('password') && !allMetadataStr.includes('Bearer')
    );

    // =======================================================
    // T. SAFE ERRORS
    // =======================================================
    console.log('\n--- T. Safe Errors ---');

    // Invalid non-integer ID
    const badIdRes = await request('POST', '/api/contests/not-an-id/archive', null, prof1Token);
    record('Non-integer ID returns safe 400 error', badIdRes.status === 400 && badIdRes.body?.status === 'error');

    // Non-existent ID
    const notFoundRes = await request('POST', '/api/contests/9999999/archive', null, prof1Token);
    record('Non-existent contest returns safe 404 error', notFoundRes.status === 404 && notFoundRes.body?.status === 'error');

    const errBodyStr = JSON.stringify(badIdRes.body) + JSON.stringify(notFoundRes.body);
    record('Error envelopes contain no raw SQL, pg errors, or stack traces',
      !errBodyStr.includes('syntax error') && !errBodyStr.includes('SELECT') && !errBodyStr.includes('node:internal')
    );

  } catch (err) {
    console.error('Fatal error in lifecycle test runner:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.6 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runContestLifecycleTests()
    .then(() => {
      db.pool.end().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(err);
      db.pool.end().then(() => process.exit(1));
    });
}

module.exports = { runContestLifecycleTests };
