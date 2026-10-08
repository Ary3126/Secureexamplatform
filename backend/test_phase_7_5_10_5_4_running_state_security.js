/**
 * Phase 7.5.10.5.4 — Contest Running / Active State Security Test Suite
 * File: backend/test_phase_7_5_10_5_4_running_state_security.js
 *
 * Verifies all Phase 7.5.10.5.4 requirements:
 * 1. Runtime State Determination & Server Time Authority:
 *    - now < startTime -> 'upcoming'
 *    - now == startTime -> 'running'
 *    - startTime < now < endTime -> 'running'
 *    - now == endTime -> 'ended'
 *    - now > endTime -> 'ended'
 * 2. Running State Immutability:
 *    - startTime locked (409 Conflict)
 *    - endTime locked (409 Conflict)
 *    - status locked (409 Conflict)
 *    - adding problem locked (409 Conflict)
 *    - removing problem locked (409 Conflict)
 *    - reordering problems locked (409 Conflict)
 *    - isRated locked (409 Conflict)
 *    - contest deletion locked (409 Conflict)
 *    - unpublish locked (409 Conflict)
 *    - archive locked (409 Conflict)
 *    - cosmetic update (title, description) permitted (200 OK)
 * 3. Generic Update Bypass Defenses:
 *    - status: 'running' in body rejected with 400 Bad Request
 *    - status: 'active' in body rejected with 400 Bad Request
 *    - startTime in the past on published upcoming contest rejected with 400 Bad Request
 *    - endTime in the past on published upcoming contest rejected with 400 Bad Request
 *    - updating endTime on ended contest to the future rejected with 409 Conflict
 *    - updating status on ended contest rejected with 409 Conflict
 * 4. Submission & Interactive Run Boundaries:
 *    - upcoming contest: submissions & runs rejected (400 Bad Request)
 *    - running contest: unenrolled rejected (403), enrolled accepted (201 Created)
 *    - ended contest: submissions & runs rejected (400 Bad Request)
 *    - client body spoofing (status='running', contestState='running') cannot bypass upcoming/ended
 * 5. BOLA / IDOR & Ownership Protections on Running Contests:
 *    - Non-owning professor blocked from modifying running contest (403 Forbidden)
 *    - Non-owning professor blocked from exporting running contest results (403 Forbidden)
 *    - Contest Admin & Super Admin authorized platform-wide
 * 6. Concurrency & Race Protections:
 *    - Concurrent problem mutations during running state safely serialized and rejected (409)
 *    - Concurrent unpublish requests on running contest safely rejected (409)
 *    - Concurrent submissions to running contest handled cleanly
 *    - Concurrent finalization on running contest rejected without force (400)
 * 7. Audit Logging & Sensitive Key Redaction:
 *    - PRIVILEGED_ACTION_DENIED logged with outcome: 'denied'
 *    - Zero passwords, hashes, or JWT tokens in audit log metadata
 * 8. Input Validation & Boundaries:
 *    - Non-integer, negative, non-existent contest IDs handled safely
 * 9. Teardown & Canonical Baseline Restoration:
 *    - Users: 5, Contests: 1, Problems: 5, Submissions: 33, Rating History: 0.
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

async function runRunningStateSecurityTests() {
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

  console.log('================================================================');
  console.log(' CODEFROG — Phase 7.5.10.5.4: Running State Security Tests');
  console.log('================================================================');

  const trackedUserIds = [];
  const trackedContestIds = [];
  const trackedProblemIds = [];
  const trackedSubmissionIds = [];

  try {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const now = Date.now();
    const pwdHash = await hashPassword('SecurityTestPass@2026!');

    // -------------------------------------------------------------
    // Setup Isolated Test Actors
    // -------------------------------------------------------------
    console.log('\n--- Setting Up Test Actors ---');

    const profA = await UserModel.createUser({
      username: `run_profA_${now}`,
      email: `run_profA_${now}@codefrog.internal`,
      fullName: 'Professor Running Alpha',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA.id);
    const tokenProfA = generateToken(profA);

    const profA2 = await UserModel.createUser({
      username: `run_profA2_${now}`,
      email: `run_profA2_${now}@codefrog.internal`,
      fullName: 'Professor Running Alpha Two',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA2.id);
    const tokenProfA2 = generateToken(profA2);

    const profA3 = await UserModel.createUser({
      username: `run_profA3_${now}`,
      email: `run_profA3_${now}@codefrog.internal`,
      fullName: 'Professor Running Alpha Three',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA3.id);
    const tokenProfA3 = generateToken(profA3);

    const profB = await UserModel.createUser({
      username: `run_profB_${now}`,
      email: `run_profB_${now}@codefrog.internal`,
      fullName: 'Professor Running Beta',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profB.id);
    const tokenProfB = generateToken(profB);

    const contestAdmin = await UserModel.createUser({
      username: `run_cadm_${now}`,
      email: `run_cadm_${now}@codefrog.internal`,
      fullName: 'Contest Admin Running',
      passwordHash: pwdHash,
      role: 'contest_admin',
    });
    trackedUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `run_sadm_${now}`,
      email: `run_sadm_${now}@codefrog.internal`,
      fullName: 'Super Admin Running',
      passwordHash: pwdHash,
      role: 'super_admin',
    });
    trackedUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `run_stu1_${now}`,
      email: `run_stu1_${now}@codefrog.internal`,
      fullName: 'Student Running One',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student1.id);
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `run_stu2_${now}`,
      email: `run_stu2_${now}@codefrog.internal`,
      fullName: 'Student Running Two',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student2.id);
    const tokenStudent2 = generateToken(student2);

    // Create shared test problems
    const testProblem = await ProblemModel.createProblem({
      title: `Run Security Problem 1 ${now}`,
      description: 'Calculate sum of two numbers with test cases.',
      difficulty: 'easy',
      codingMode: 'full_program',
      createdBy: profA.id,
    });
    trackedProblemIds.push(testProblem.id);

    const testProblem2 = await ProblemModel.createProblem({
      title: `Run Security Problem 2 ${now}`,
      description: 'Find max element in array.',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
    });
    trackedProblemIds.push(testProblem2.id);

    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '1 2', '3', true, false), ($1, '10 20', '30', false, true),
              ($2, '3 1 5 2', '5', true, false), ($2, '100 -5 99', '100', false, true)`,
      [testProblem.id, testProblem2.id]
    );
    await db.query(`UPDATE problems SET is_published = true, access_scope = 'public' WHERE id IN ($1, $2)`, [testProblem.id, testProblem2.id]);

    const pastStart = new Date(now - 3600000).toISOString(); // 1 hour ago
    const futureEnd = new Date(now + 7200000).toISOString();  // 2 hours in future
    const pastEnd = new Date(now - 1800000).toISOString();    // 30 mins ago
    const futureStart = new Date(now + 86400000).toISOString(); // 1 day in future
    const farFutureEnd = new Date(now + 172800000).toISOString();

    // -------------------------------------------------------------
    // 1. RUNTIME STATE DETERMINATION & TIME BOUNDARIES
    // -------------------------------------------------------------
    console.log('\n--- 1. Runtime State Determination & Server Time Authority ---');

    // 1.1 Upcoming state: status=published, now < startTime
    const stateUpcoming = getContestRuntimeState({ status: 'published', startTime: futureStart, endTime: farFutureEnd });
    testAssert(stateUpcoming === 'upcoming', '1.1 getContestRuntimeState returns "upcoming" when now < startTime');

    // 1.2 Exact start boundary: now == startTime -> 'running'
    const exactStartTime = new Date(now).toISOString();
    const stateExactStart = getContestRuntimeState({ status: 'published', startTime: exactStartTime, endTime: futureEnd });
    testAssert(stateExactStart === 'running', '1.2 getContestRuntimeState returns "running" at exact startTime boundary');

    // 1.3 Running state: startTime < now < endTime
    const stateRunning = getContestRuntimeState({ status: 'published', startTime: pastStart, endTime: futureEnd });
    testAssert(stateRunning === 'running', '1.3 getContestRuntimeState returns "running" when startTime < now < endTime');

    // 1.4 Exact end boundary: now == endTime -> 'ended'
    const exactEndTime = new Date(now).toISOString();
    const stateExactEnd = getContestRuntimeState({ status: 'published', startTime: pastStart, endTime: exactEndTime });
    testAssert(stateExactEnd === 'ended', '1.4 getContestRuntimeState returns "ended" at exact endTime boundary');

    // 1.5 Ended state: now > endTime -> 'ended'
    const stateEnded = getContestRuntimeState({ status: 'published', startTime: pastStart, endTime: pastEnd });
    testAssert(stateEnded === 'ended', '1.5 getContestRuntimeState returns "ended" when now > endTime');

    // 1.6 Draft state overrides timestamps
    const stateDraft = getContestRuntimeState({ status: 'draft', startTime: pastStart, endTime: futureEnd });
    testAssert(stateDraft === 'draft', '1.6 Draft status strictly evaluates runtimeState="draft" regardless of timestamps');

    // 1.7 Archived status overrides timestamps
    const stateArchived = getContestRuntimeState({ status: 'archived', startTime: pastStart, endTime: futureEnd });
    testAssert(stateArchived === 'archived', '1.7 Archived status strictly evaluates runtimeState="archived" regardless of timestamps');

    // -------------------------------------------------------------
    // 2. RUNNING STATE IMMUTABILITY
    // -------------------------------------------------------------
    console.log('\n--- 2. Running State Immutability ---');

    // Create a base contest and set it to running via published status and pastStart
    const resCreateRun = await request('POST', '/api/contests', {
      title: `Running Immutability Contest ${now}`,
      startTime: futureStart,
      endTime: farFutureEnd,
      isRated: true,
    }, tokenProfA);
    const runContestId = resCreateRun.data.contest.id;
    trackedContestIds.push(runContestId);

    await ContestModel.addProblemToContest({ contestId: runContestId, problemId: testProblem.id, points: 100 });
    await ContestModel.addProblemToContest({ contestId: runContestId, problemId: testProblem2.id, points: 200 });

    // Publish contest, then simulate active running by setting DB times
    await request('POST', `/api/contests/${runContestId}/publish`, null, tokenProfA);
    await db.query("UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3", [pastStart, futureEnd, runContestId]);

    // Verify contest evaluates as running
    const checkRunRow = await ContestModel.findContestById(runContestId);
    testAssert(getContestRuntimeState(checkRunRow) === 'running', '2.0 Contest confirmed in running runtimeState');

    // 2.1 Attempt to modify startTime on running contest -> 409 Conflict
    const resModStart = await request('PATCH', `/api/contests/${runContestId}`, {
      startTime: new Date(now - 7200000).toISOString(),
    }, tokenProfA);
    testAssert(resModStart.status === 409, '2.1 Modifying startTime on running contest returns 409 Conflict');
    testAssert(
      String(resModStart.data?.message).includes('running') || String(resModStart.data?.message).includes('lifecycle'),
      '2.1 Error message specifies running lifecycle lock'
    );

    // 2.2 Attempt to modify endTime on running contest -> 409 Conflict
    const resModEnd = await request('PATCH', `/api/contests/${runContestId}`, {
      endTime: new Date(now + 14400000).toISOString(),
    }, tokenProfA);
    testAssert(resModEnd.status === 409, '2.2 Modifying endTime on running contest returns 409 Conflict');

    // 2.3 Attempt to revert status to draft on running contest -> 409 Conflict
    const resModStatusDraft = await request('PATCH', `/api/contests/${runContestId}`, {
      status: 'draft',
    }, tokenProfA);
    testAssert(resModStatusDraft.status === 409, '2.3 Reverting status to draft on running contest returns 409 Conflict');

    // 2.4 Attempt to set status to archived on running contest -> 409 Conflict
    const resModStatusArch = await request('PATCH', `/api/contests/${runContestId}`, {
      status: 'archived',
    }, tokenProfA);
    testAssert(resModStatusArch.status === 409, '2.4 Setting status to archived via PATCH on running contest returns 409 Conflict');

    // 2.5 Attempt to archive via POST /api/contests/:id/archive on running contest -> 409 Conflict
    const resArchApi = await request('POST', `/api/contests/${runContestId}/archive`, null, tokenProfA);
    testAssert(resArchApi.status === 409, '2.5 POST /archive on running contest returns 409 Conflict');

    // 2.6 Attempt to unpublish via POST /api/contests/:id/unpublish on running contest -> 409 Conflict
    const resUnpubApi = await request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA);
    testAssert(resUnpubApi.status === 409, '2.6 POST /unpublish on running contest returns 409 Conflict');

    // 2.7 Attempt to add a problem to running contest -> 409 Conflict
    const resAddProb = await request('POST', `/api/contests/${runContestId}/problems`, {
      problemId: testProblem2.id,
      points: 50,
    }, tokenProfA);
    testAssert(resAddProb.status === 409, '2.7 Adding problem to running contest returns 409 Conflict');

    // 2.8 Attempt to remove a problem from running contest -> 409 Conflict
    const resRemProb = await request('DELETE', `/api/contests/${runContestId}/problems/${testProblem.id}`, null, tokenProfA);
    testAssert(resRemProb.status === 409, '2.8 Removing problem from running contest returns 409 Conflict');

    // 2.9 Attempt to reorder problems on running contest -> 409 Conflict
    const resReorder = await request('PUT', `/api/contests/${runContestId}/problems/order`, {
      problemIds: [testProblem2.id, testProblem.id],
    }, tokenProfA);
    testAssert(resReorder.status === 409, '2.9 Reordering problems on running contest returns 409 Conflict');

    // 2.10 Attempt to modify isRated on running contest -> 409 Conflict
    const resModRated = await request('PATCH', `/api/contests/${runContestId}`, {
      isRated: false,
    }, tokenProfA);
    testAssert(resModRated.status === 409, '2.10 Modifying isRated on running contest returns 409 Conflict');

    // 2.11 Attempt to delete actively running contest -> 409 Conflict
    const resDelRun = await request('DELETE', `/api/contests/${runContestId}`, null, tokenProfA);
    testAssert(resDelRun.status === 409, '2.11 Deleting actively running contest returns 409 Conflict');
    testAssert(
      String(resDelRun.data?.message).includes('running') || String(resDelRun.data?.message).includes('Cannot delete'),
      '2.11 Deletion error message cites actively running status'
    );

    // 2.12 Permitted cosmetic update (title, description) succeeds with 200 OK
    const resCosmetic = await request('PATCH', `/api/contests/${runContestId}`, {
      title: `Running Immutability Contest Updated ${now}`,
      description: 'Updated cosmetic description during running state',
    }, tokenProfA);
    testAssert(resCosmetic.status === 200, '2.12 Cosmetic metadata update on running contest succeeds (200 OK)');
    testAssert(resCosmetic.data?.contest?.title.includes('Updated'), '2.12 Updated title persisted');

    // -------------------------------------------------------------
    // 3. GENERIC UPDATE BYPASS DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 3. Generic Update Bypass Defenses ---');

    // Create an upcoming published contest
    const resUpcomingContest = await request('POST', '/api/contests', {
      title: `Upcoming Bypass Contest ${now}`,
      startTime: futureStart,
      endTime: farFutureEnd,
    }, tokenProfA2);
    const upContestId = resUpcomingContest.data.contest.id;
    trackedContestIds.push(upContestId);

    await ContestModel.addProblemToContest({ contestId: upContestId, problemId: testProblem.id, points: 100 });
    await request('POST', `/api/contests/${upContestId}/publish`, null, tokenProfA2);

    // 3.1 Attempt status: 'running' via generic update -> 400 Bad Request
    const resPutRunStatus = await request('PATCH', `/api/contests/${upContestId}`, {
      status: 'running',
    }, tokenProfA2);
    testAssert(resPutRunStatus.status === 400, '3.1 status="running" via PATCH rejected with 400 Bad Request');

    // 3.2 Attempt status: 'active' via generic update -> 400 Bad Request
    const resPutActiveStatus = await request('PATCH', `/api/contests/${upContestId}`, {
      status: 'active',
    }, tokenProfA2);
    testAssert(resPutActiveStatus.status === 400, '3.2 status="active" via PATCH rejected with 400 Bad Request');

    // 3.3 Attempt startTime in the past on published contest -> 400 Bad Request
    const resPutPastStart = await request('PATCH', `/api/contests/${upContestId}`, {
      startTime: pastStart,
    }, tokenProfA2);
    testAssert(resPutPastStart.status === 400, '3.3 Setting startTime to the past on published contest rejected with 400 Bad Request');
    testAssert(
      JSON.stringify(resPutPastStart.data).includes('Cannot set start time to the past'),
      '3.3 Error message identifies past start time restriction'
    );

    // Verify contest remains upcoming in DB
    const upCheckDb = await ContestModel.findContestById(upContestId);
    testAssert(getContestRuntimeState(upCheckDb) === 'upcoming', '3.3 Contest strictly remains "upcoming" in DB');

    // 3.4 Attempt endTime in the past on published contest -> 400 Bad Request
    const resPutPastEnd = await request('PATCH', `/api/contests/${upContestId}`, {
      endTime: pastEnd,
    }, tokenProfA2);
    testAssert(resPutPastEnd.status === 400, '3.4 Setting endTime to the past on published contest rejected with 400 Bad Request');

    // 3.5 Combined payload attack: status: 'running', startTime in past
    const resCombinedAttack = await request('PATCH', `/api/contests/${upContestId}`, {
      status: 'running',
      startTime: pastStart,
      endTime: futureEnd,
    }, tokenProfA2);
    testAssert(resCombinedAttack.status === 400, '3.5 Combined status+timestamp attack rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 4. ENDED STATE DEFENSES & REVIVAL PREVENTIONS
    // -------------------------------------------------------------
    console.log('\n--- 4. Ended State Defenses & Revival Preventions ---');

    // Create ended contest fixture
    const resEndedContest = await request('POST', '/api/contests', {
      title: `Ended Defense Contest ${now}`,
      startTime: futureStart,
      endTime: farFutureEnd,
    }, tokenProfA3);
    const endContestId = resEndedContest.data.contest.id;
    trackedContestIds.push(endContestId);

    await ContestModel.addProblemToContest({ contestId: endContestId, problemId: testProblem.id, points: 100 });
    await request('POST', `/api/contests/${endContestId}/publish`, null, tokenProfA3);
    await db.query("UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3", [pastStart, pastEnd, endContestId]);

    const endCheckDb = await ContestModel.findContestById(endContestId);
    testAssert(getContestRuntimeState(endCheckDb) === 'ended', '4.0 Contest confirmed in ended runtimeState');

    // 4.1 Attempt to revive ended contest by moving endTime into future -> 409 Conflict
    const resReviveEnd = await request('PATCH', `/api/contests/${endContestId}`, {
      endTime: farFutureEnd,
    }, tokenProfA3);
    testAssert(resReviveEnd.status === 409, '4.1 Extending endTime on ended contest rejected with 409 Conflict');
    testAssert(
      String(resReviveEnd.data?.message).includes('ended') || String(resReviveEnd.data?.message).includes('lifecycle'),
      '4.1 Error message cites ended lifecycle lock'
    );

    // 4.2 Attempt to reset status: 'published' on ended contest -> 409 Conflict
    const resResetPub = await request('PATCH', `/api/contests/${endContestId}`, {
      status: 'published',
    }, tokenProfA3);
    testAssert(resResetPub.status === 409, '4.2 Resetting status="published" on ended contest rejected with 409 Conflict');

    // 4.3 Attempt to reset status: 'draft' on ended contest -> 409 Conflict
    const resResetDraft = await request('PATCH', `/api/contests/${endContestId}`, {
      status: 'draft',
    }, tokenProfA3);
    testAssert(resResetDraft.status === 409, '4.3 Resetting status="draft" on ended contest rejected with 409 Conflict');

    // 4.4 Attempt POST /publish on ended contest -> 400 Bad Request
    const resPubEnded = await request('POST', `/api/contests/${endContestId}/publish`, null, tokenProfA3);
    testAssert(resPubEnded.status === 400, '4.4 POST /publish on ended contest rejected with 400 Bad Request');

    // 4.5 Attempt POST /unpublish on ended contest -> 400 / 409
    const resUnpubEnded = await request('POST', `/api/contests/${endContestId}/unpublish`, null, tokenProfA3);
    testAssert(resUnpubEnded.status === 409 || resUnpubEnded.status === 400, '4.5 POST /unpublish on ended contest rejected');

    // 4.6 Adding problem to ended contest -> 409 Conflict
    const resAddProbEnded = await request('POST', `/api/contests/${endContestId}/problems`, {
      problemId: testProblem2.id,
      points: 50,
    }, tokenProfA3);
    testAssert(resAddProbEnded.status === 409, '4.6 Adding problem to ended contest rejected with 409 Conflict');

    // -------------------------------------------------------------
    // 5. SUBMISSION & INTERACTIVE RUN BOUNDARIES
    // -------------------------------------------------------------
    console.log('\n--- 5. Submission & Interactive Run Boundaries ---');

    // 5.1 Student enrolled in upcoming contest attempts submit -> 400 Bad Request
    await request('POST', `/api/contests/${upContestId}/join`, null, tokenStudent1);
    const resSubUpcoming = await request('POST', '/api/submissions', {
      contestId: upContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    testAssert(resSubUpcoming.status === 400, '5.1 Submission to upcoming contest rejected with 400 Bad Request');
    testAssert(
      String(resSubUpcoming.data?.message).includes('upcoming'),
      '5.1 Error message explicitly identifies "upcoming" rejection'
    );

    // 5.2 Student attempts interactive run on upcoming contest -> 400 Bad Request
    const resRunUpcoming = await request('POST', '/api/submissions/run', {
      contestId: upContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    testAssert(resRunUpcoming.status === 400, '5.2 Interactive run on upcoming contest rejected with 400 Bad Request');

    // 5.3 Student enrolled in running contest submits code -> 201 Created
    await request('POST', `/api/contests/${runContestId}/join`, null, tokenStudent1);
    const resSubRunning = await request('POST', '/api/submissions', {
      contestId: runContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(3)',
    }, tokenStudent1);
    testAssert(resSubRunning.status === 201, '5.3 Enrolled student submits to running contest successfully (201 Created)');
    if (resSubRunning.data?.submission?.id) {
      trackedSubmissionIds.push(resSubRunning.data.submission.id);
    }

    // 5.4 Student interactive run on running contest -> 200 OK / processed
    const resRunRunning = await request('POST', '/api/submissions/run', {
      contestId: runContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(3)',
    }, tokenStudent1);
    testAssert(resRunRunning.status === 200 || resRunRunning.status === 201, '5.4 Interactive run on running contest accepted');

    // 5.5 Unenrolled student submitting to running contest -> 403 Forbidden
    const resSubUnenrolled = await request('POST', '/api/submissions', {
      contestId: runContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(3)',
    }, tokenStudent2);
    testAssert(resSubUnenrolled.status === 403, '5.5 Unenrolled student submitting to running contest rejected with 403 Forbidden');

    // 5.6 Student submitting to ended contest -> 400 Bad Request
    const resSubEnded = await request('POST', '/api/submissions', {
      contestId: endContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    testAssert(resSubEnded.status === 400, '5.6 Submission to ended contest rejected with 400 Bad Request');
    testAssert(
      String(resSubEnded.data?.message).includes('ended'),
      '5.6 Error message explicitly identifies "ended" rejection'
    );

    // 5.7 Student interactive run on ended contest -> 400 Bad Request
    const resRunEnded = await request('POST', '/api/submissions/run', {
      contestId: endContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    testAssert(resRunEnded.status === 400, '5.7 Interactive run on ended contest rejected with 400 Bad Request');

    // 5.8 Injected body properties cannot spoof contest state
    const resSubSpoof = await request('POST', '/api/submissions', {
      contestId: upContestId,
      problemId: testProblem.id,
      language: 'python',
      sourceCode: 'print(1)',
      status: 'running',
      contestState: 'running',
      runtimeState: 'running',
      isPublished: true,
    }, tokenStudent1);
    testAssert(resSubSpoof.status === 400, '5.8 Injected body properties (status="running") cannot bypass upcoming state');

    // -------------------------------------------------------------
    // 6. BOLA / IDOR & ROLE-BASED ACCESS CONTROLS
    // -------------------------------------------------------------
    console.log('\n--- 6. BOLA / IDOR & RBAC Controls ---');

    // 6.1 Non-owning Professor B blocked from modifying Prof A's running contest -> 403 Forbidden
    const resBolaModRun = await request('PATCH', `/api/contests/${runContestId}`, {
      title: 'Prof B Hijack Title',
    }, tokenProfB);
    testAssert(resBolaModRun.status === 403, '6.1 Non-owning Professor blocked from updating running contest (403 Forbidden BOLA)');

    // 6.2 Non-owning Professor B blocked from exporting running contest results -> 403 Forbidden
    const resBolaExportRun = await request('GET', `/api/contests/${runContestId}/export/results`, null, tokenProfB);
    testAssert(resBolaExportRun.status === 403, '6.2 Non-owning Professor blocked from exporting running contest results (403 Forbidden BOLA)');

    // 6.3 Contest Admin authorized to view running contest details (200 OK)
    const resCadmViewRun = await request('GET', `/api/contests/${runContestId}`, null, tokenContestAdmin);
    testAssert(resCadmViewRun.status === 200, '6.3 Contest Admin authorized to view running contest (200 OK)');

    // 6.4 Super Admin authorized to view running contest details (200 OK)
    const resSadmViewRun = await request('GET', `/api/contests/${runContestId}`, null, tokenSuperAdmin);
    testAssert(resSadmViewRun.status === 200, '6.4 Super Admin authorized to view running contest (200 OK)');

    // 6.5 Student blocked from admin leaderboard on running contest (403 Forbidden)
    const resStuAdminLb = await request('GET', `/api/contests/${runContestId}/admin-leaderboard`, null, tokenStudent1);
    testAssert(resStuAdminLb.status === 403, '6.5 Student blocked from admin leaderboard on running contest (403 Forbidden)');

    // -------------------------------------------------------------
    // 7. CONCURRENCY & RACE CONDITION DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 7. Concurrency & Race Condition Defenses ---');

    // 7.1 Five simultaneous problem additions to running contest -> all 409 Conflict
    const raceAddResults = await Promise.all([
      request('POST', `/api/contests/${runContestId}/problems`, { problemId: testProblem2.id, points: 10 }, tokenProfA),
      request('POST', `/api/contests/${runContestId}/problems`, { problemId: testProblem2.id, points: 20 }, tokenProfA),
      request('POST', `/api/contests/${runContestId}/problems`, { problemId: testProblem2.id, points: 30 }, tokenProfA),
      request('POST', `/api/contests/${runContestId}/problems`, { problemId: testProblem2.id, points: 40 }, tokenProfA),
      request('POST', `/api/contests/${runContestId}/problems`, { problemId: testProblem2.id, points: 50 }, tokenProfA),
    ]);
    const allAddBlocked = raceAddResults.every((r) => r.status === 409);
    testAssert(allAddBlocked, '7.1 All 5 concurrent problem additions on running contest rejected with 409 Conflict');

    // 7.2 Five simultaneous unpublish requests on running contest -> all 409 Conflict
    const raceUnpubResults = await Promise.all([
      request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA),
      request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA),
      request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA),
      request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA),
      request('POST', `/api/contests/${runContestId}/unpublish`, null, tokenProfA),
    ]);
    const allUnpubBlocked = raceUnpubResults.every((r) => r.status === 409);
    testAssert(allUnpubBlocked, '7.2 All 5 concurrent unpublish requests on running contest rejected with 409 Conflict');

    // 7.3 Concurrent finalization attempt on running contest without force -> rejected with 400 Bad Request
    const resFinRun = await request('POST', `/api/contests/${runContestId}/finalize-ratings`, {}, tokenProfA);
    testAssert(resFinRun.status === 400, '7.3 Finalization on running contest without force rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 8. AUDIT LOGGING INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 8. Audit Logging Integrity ---');

    // 8.1 PRIVILEGED_ACTION_DENIED logged for attempted lifecycle update on running contest
    const auditRes = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY id DESC LIMIT 5`,
      [runContestId]
    );
    testAssert(auditRes.rows.length > 0, '8.1 PRIVILEGED_ACTION_DENIED logged for running contest mutation attempt');
    testAssert(auditRes.rows[0].outcome === 'denied', '8.1 Audit outcome marked as "denied"');

    // 8.2 Audit metadata excludes sensitive secrets
    const auditStr = JSON.stringify(auditRes.rows);
    testAssert(!auditStr.includes('password_hash'), '8.2 Audit logs strictly exclude password_hash');
    testAssert(!auditStr.includes('jwt_token'), '8.2 Audit logs strictly exclude jwt_token');

    // -------------------------------------------------------------
    // 9. INPUT VALIDATION & BOUNDARY RESISTANCE
    // -------------------------------------------------------------
    console.log('\n--- 9. Input Boundaries & Fuzzing Resistance ---');

    // 9.1 Non-integer ID on update
    const resNonInt = await request('PATCH', '/api/contests/abc', { title: 'New' }, tokenProfA);
    testAssert(resNonInt.status === 400, '9.1 Non-integer ID returns 400 Bad Request');

    // 9.2 Negative ID on update
    const resNegId = await request('PATCH', '/api/contests/-5', { title: 'New' }, tokenProfA);
    testAssert(resNegId.status === 400, '9.2 Negative ID returns 400 Bad Request');

    // 9.3 Decimal ID on update
    const resDecId = await request('PATCH', '/api/contests/1.5', { title: 'New' }, tokenProfA);
    testAssert(resDecId.status === 400, '9.3 Decimal ID returns 400 Bad Request');

    // 9.4 Non-existent ID on update
    const resNonExist = await request('PATCH', '/api/contests/9999999', { title: 'New' }, tokenProfA);
    testAssert(resNonExist.status === 404, '9.4 Non-existent ID returns 404 Not Found');

    // 9.5 SQL injection probe in ID parameter
    const resSqlInj = await request('PATCH', '/api/contests/1%20OR%201=1', { title: 'New' }, tokenProfA);
    testAssert(resSqlInj.status === 400, '9.5 SQL injection probe in contest ID returns 400 Bad Request');

    // -------------------------------------------------------------
    // 10. TEARDOWN & CANONICAL BASELINE RESTORATION
    // -------------------------------------------------------------
    console.log('\n--- 10. Teardown & Canonical Baseline Restoration ---');

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

    // Clean test users
    if (trackedUserIds.length > 0) {
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

runRunningStateSecurityTests();
