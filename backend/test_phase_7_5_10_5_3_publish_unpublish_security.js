/**
 * CODEFROG — Phase 7.5.10.5.3
 * Contest Publish & Unpublish Lifecycle Security Test Suite
 * File: backend/test_phase_7_5_10_5_3_publish_unpublish_security.js
 *
 * Verifies all Phase 7.5.10.5.3 security requirements:
 * 1. RBAC (unauthenticated 401, student 403, professor/admin authorized)
 * 2. Ownership / BOLA defense (non-owner professors blocked with 403)
 * 3. Publish transition & prerequisites (requires >= 1 problem, valid status)
 * 4. Unpublish transition & prerequisites (only upcoming with 0 submissions allowed)
 * 5. Generic update bypass defense (PATCH/PUT status published/draft rejected/locked)
 * 6. Draft / Unpublished privacy & isolation (hidden from discovery, direct 403, submission 400)
 * 7. Published visibility (appears in discovery, direct 200, zero hidden test case leakage)
 * 8. Contest-problem consistency (no leakage of private test cases)
 * 9. Enrollment behavior (unpublished blocked 400, published allowed 201)
 * 10. Submission security (authoritative state derived from DB, body spoofing ignored)
 * 11. Leaderboard / result / export protection (unauthorized blocked with 403)
 * 12. Concurrency & race protection (row-locking serializes concurrent publish/unpublish)
 * 13. Idempotency (repeat publish/unpublish returns safe 400 without corruption)
 * 14. Audit logging (CONTEST_PUBLISHED, CONTEST_UNPUBLISHED, PRIVILEGED_ACTION_DENIED)
 * 15. Input validation & injection regression (non-integer ID, negative ID, SQLi, 400/404)
 * 16. Complete teardown & canonical baseline restoration
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { generateToken, hashPassword } = require('./src/services/authService');

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

async function runTestSuite() {
  console.log('\n================================================================');
  console.log(' Phase 7.5.10.5.3: Publish / Unpublish Lifecycle Security Suite  ');
  console.log('================================================================\n');

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    const now = Date.now();
    const pwdHash = await hashPassword('SecurePass123!');

    // 1. Setup isolated test users (distributed across sections to respect rate limits)
    const profA = await UserModel.createUser({
      username: `pub_profA_${now}`,
      email: `pub_profA_${now}@codefrog.internal`,
      fullName: 'Professor Pub Alpha',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA.id);
    const tokenProfA = generateToken(profA);

    const profA2 = await UserModel.createUser({
      username: `pub_profA2_${now}`,
      email: `pub_profA2_${now}@codefrog.internal`,
      fullName: 'Professor Pub Alpha Two',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA2.id);
    const tokenProfA2 = generateToken(profA2);

    const profA3 = await UserModel.createUser({
      username: `pub_profA3_${now}`,
      email: `pub_profA3_${now}@codefrog.internal`,
      fullName: 'Professor Pub Alpha Three',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA3.id);
    const tokenProfA3 = generateToken(profA3);

    const profA4 = await UserModel.createUser({
      username: `pub_profA4_${now}`,
      email: `pub_profA4_${now}@codefrog.internal`,
      fullName: 'Professor Pub Alpha Four',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profA4.id);
    const tokenProfA4 = generateToken(profA4);

    const profB = await UserModel.createUser({
      username: `pub_profB_${now}`,
      email: `pub_profB_${now}@codefrog.internal`,
      fullName: 'Professor Pub Beta',
      passwordHash: pwdHash,
      role: 'professor',
    });
    trackedUserIds.push(profB.id);
    const tokenProfB = generateToken(profB);

    const contestAdmin = await UserModel.createUser({
      username: `pub_cadm_${now}`,
      email: `pub_cadm_${now}@codefrog.internal`,
      fullName: 'Contest Admin Pub',
      passwordHash: pwdHash,
      role: 'contest_admin',
    });
    trackedUserIds.push(contestAdmin.id);
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `pub_sadm_${now}`,
      email: `pub_sadm_${now}@codefrog.internal`,
      fullName: 'Super Admin Pub',
      passwordHash: pwdHash,
      role: 'super_admin',
    });
    trackedUserIds.push(superAdmin.id);
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `pub_student1_${now}`,
      email: `pub_student1_${now}@codefrog.internal`,
      fullName: 'Student Pub One',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student1.id);
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `pub_student2_${now}`,
      email: `pub_student2_${now}@codefrog.internal`,
      fullName: 'Student Pub Two',
      passwordHash: pwdHash,
      role: 'student',
    });
    trackedUserIds.push(student2.id);
    const tokenStudent2 = generateToken(student2);

    // Create shared test problems
    const testProblem = await ProblemModel.createProblem({
      title: `Pub Security Problem ${now}`,
      description: 'Find sum of array elements with edge cases.',
      difficulty: 'medium',
      codingMode: 'full_program',
      createdBy: profA.id,
    });
    trackedProblemIds.push(testProblem.id);

    // Add hidden and sample test cases, and publish problem for public access
    await db.query(
      `INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden)
       VALUES ($1, '1 2 3', '6', true, false), ($1, '9999 1', '10000', false, true)`,
      [testProblem.id]
    );
    await db.query(
      `UPDATE problems SET is_published = true, access_scope = 'public' WHERE id = $1`,
      [testProblem.id]
    );

    const futureStart = new Date(now + 86400000).toISOString();
    const futureEnd = new Date(now + 172800000).toISOString();

    // -------------------------------------------------------------
    // 1. RBAC ON PUBLISH AND UNPUBLISH
    // -------------------------------------------------------------
    console.log('\n--- 1. RBAC on Publish & Unpublish ---');

    // Create a base draft contest
    const resBaseContest = await request('POST', '/api/contests', {
      title: `RBAC Base Contest ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA);
    const baseContestId = resBaseContest.data.contest.id;
    trackedContestIds.push(baseContestId);
    await ContestModel.addProblemToContest({ contestId: baseContestId, problemId: testProblem.id, points: 100 });

    // 1.1 Unauthenticated publish -> 401
    const resUnauthPub = await request('POST', `/api/contests/${baseContestId}/publish`);
    assert(resUnauthPub.status === 401, '1.1 Unauthenticated publish rejected with 401 Unauthorized');

    // 1.2 Unauthenticated unpublish -> 401
    const resUnauthUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`);
    assert(resUnauthUnpub.status === 401, '1.2 Unauthenticated unpublish rejected with 401 Unauthorized');

    // 1.3 Student publish -> 403
    const resStudentPub = await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenStudent1);
    assert(resStudentPub.status === 403, '1.3 Student publish rejected with 403 Forbidden');

    // 1.4 Student unpublish -> 403
    const resStudentUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`, null, tokenStudent1);
    assert(resStudentUnpub.status === 403, '1.4 Student unpublish rejected with 403 Forbidden');

    // 1.5 Owner Professor publish -> 200
    const resOwnerPub = await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenProfA);
    assert(resOwnerPub.status === 200, '1.5 Owner Professor publish succeeds with 200 OK');
    assert(resOwnerPub.data?.contest?.status === 'published', '1.5 Returned contest status is "published"');

    // 1.6 Owner Professor unpublish -> 200
    const resOwnerUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`, null, tokenProfA);
    assert(resOwnerUnpub.status === 200, '1.6 Owner Professor unpublish succeeds with 200 OK');
    assert(resOwnerUnpub.data?.contest?.status === 'draft', '1.6 Returned contest status is reverted to "draft"');

    // 1.7 Contest Admin can publish another professor's draft contest -> 200
    const resCadmPub = await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenContestAdmin);
    assert(resCadmPub.status === 200, '1.7 Contest Admin publish succeeds with 200 OK');

    // 1.8 Contest Admin can unpublish another professor's contest -> 200
    const resCadmUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`, null, tokenContestAdmin);
    assert(resCadmUnpub.status === 200, '1.8 Contest Admin unpublish succeeds with 200 OK');

    // 1.9 Super Admin can publish another professor's draft contest -> 200
    const resSadmPub = await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenSuperAdmin);
    assert(resSadmPub.status === 200, '1.9 Super Admin publish succeeds with 200 OK');

    // 1.10 Super Admin can unpublish another professor's contest -> 200
    const resSadmUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`, null, tokenSuperAdmin);
    assert(resSadmUnpub.status === 200, '1.10 Super Admin unpublish succeeds with 200 OK');

    // -------------------------------------------------------------
    // 2. OWNERSHIP & BOLA DEFENSE
    // -------------------------------------------------------------
    console.log('\n--- 2. Ownership & BOLA Defense ---');

    // 2.1 Prof B attempts to publish Prof A draft contest -> 403
    const resBolaPub = await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenProfB);
    assert(resBolaPub.status === 403, '2.1 Non-owner Professor publish blocked with 403 Forbidden (BOLA)');

    // Publish contest properly via Prof A
    await request('POST', `/api/contests/${baseContestId}/publish`, null, tokenProfA);

    // 2.2 Prof B attempts to unpublish Prof A published contest -> 403
    const resBolaUnpub = await request('POST', `/api/contests/${baseContestId}/unpublish`, null, tokenProfB);
    assert(resBolaUnpub.status === 403, '2.2 Non-owner Professor unpublish blocked with 403 Forbidden (BOLA)');

    // -------------------------------------------------------------
    // 3. PUBLISH TRANSITION & PREREQUISITES
    // -------------------------------------------------------------
    console.log('\n--- 3. Publish Prerequisites ---');

    // 3.1 Cannot publish contest without problems -> 400
    const resEmptyContest = await request('POST', '/api/contests', {
      title: `Empty Contest ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA);
    const emptyContestId = resEmptyContest.data.contest.id;
    trackedContestIds.push(emptyContestId);

    const resPubNoProb = await request('POST', `/api/contests/${emptyContestId}/publish`, null, tokenProfA);
    assert(resPubNoProb.status === 400, '3.1 Publishing contest with zero problems rejected with 400 Bad Request');
    assert(
      JSON.stringify(resPubNoProb.data).includes('At least one problem must be attached'),
      '3.1 Error message explicitly identifies missing problems'
    );

    // 3.2 Attaching a problem allows publication -> 200
    await ContestModel.addProblemToContest({ contestId: emptyContestId, problemId: testProblem.id, points: 50 });
    const resPubWithProb = await request('POST', `/api/contests/${emptyContestId}/publish`, null, tokenProfA);
    assert(resPubWithProb.status === 200, '3.2 Publishing contest with attached problem succeeds with 200 OK');

    // 3.3 Publishing already published contest returns 400 Bad Request
    const resRepeatPub = await request('POST', `/api/contests/${emptyContestId}/publish`, null, tokenProfA);
    assert(resRepeatPub.status === 400, '3.3 Re-publishing an already published contest rejected with 400 Bad Request');
    assert(
      JSON.stringify(resRepeatPub.data).includes('already published'),
      '3.3 Error message identifies contest is already published'
    );

    // 3.4 Publishing an archived contest returns 400 Bad Request
    const resArchContest = await request('POST', '/api/contests', {
      title: `Archived Contest ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA);
    const archContestId = resArchContest.data.contest.id;
    trackedContestIds.push(archContestId);
    await request('POST', `/api/contests/${archContestId}/archive`, null, tokenProfA);

    const resPubArch = await request('POST', `/api/contests/${archContestId}/publish`, null, tokenProfA);
    assert(resPubArch.status === 400, '3.4 Publishing an archived contest rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 4. UNPUBLISH TRANSITION & PREREQUISITES
    // -------------------------------------------------------------
    console.log('\n--- 4. Unpublish Prerequisites ---');

    // 4.1 Reverting upcoming published contest to draft succeeds -> 200
    const resUnpubSuccess = await request('POST', `/api/contests/${emptyContestId}/unpublish`, null, tokenProfA);
    assert(resUnpubSuccess.status === 200, '4.1 Unpublishing upcoming contest succeeds with 200 OK');
    assert(resUnpubSuccess.data?.contest?.status === 'draft', '4.1 Contest returned to "draft" status');

    // 4.2 Re-unpublishing already unpublished (draft) contest returns 400
    const resRepeatUnpub = await request('POST', `/api/contests/${emptyContestId}/unpublish`, null, tokenProfA);
    assert(resRepeatUnpub.status === 400, '4.2 Re-unpublishing a draft contest rejected with 400 Bad Request');
    assert(
      JSON.stringify(resRepeatUnpub.data).includes('must be published') || JSON.stringify(resRepeatUnpub.data).includes('draft'),
      '4.2 Error message notes contest is already in draft status'
    );

    // 4.3 Running contest cannot be unpublished -> 409 Conflict
    const pastStart = new Date(now - 3600000).toISOString();
    const runningContest = await ContestModel.createContest({
      title: `Running Contest ${now}`,
      startTime: pastStart,
      endTime: futureEnd,
      createdBy: profA.id,
    });
    trackedContestIds.push(runningContest.id);
    await ContestModel.addProblemToContest({ contestId: runningContest.id, problemId: testProblem.id, points: 100 });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [runningContest.id]);

    const resUnpubRunning = await request('POST', `/api/contests/${runningContest.id}/unpublish`, null, tokenProfA);
    assert(resUnpubRunning.status === 409, '4.3 Unpublishing actively running contest blocked with 409 Conflict');
    assert(
      JSON.stringify(resUnpubRunning.data).includes('running'),
      '4.3 Error message explicitly cites running state'
    );

    // 4.4 Ended contest cannot be unpublished -> 409 Conflict
    const pastEnd = new Date(now - 1800000).toISOString();
    const endedContest = await ContestModel.createContest({
      title: `Ended Contest ${now}`,
      startTime: pastStart,
      endTime: pastEnd,
      createdBy: profA.id,
    });
    trackedContestIds.push(endedContest.id);
    await ContestModel.addProblemToContest({ contestId: endedContest.id, problemId: testProblem.id, points: 100 });
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [endedContest.id]);

    const resUnpubEnded = await request('POST', `/api/contests/${endedContest.id}/unpublish`, null, tokenProfA);
    assert(resUnpubEnded.status === 409, '4.4 Unpublishing ended contest blocked with 409 Conflict');

    // 4.5 Archived contest cannot be unpublished -> 400 Bad Request (status !== 'published')
    const resUnpubArch = await request('POST', `/api/contests/${archContestId}/unpublish`, null, tokenProfA);
    assert(resUnpubArch.status === 400, '4.5 Unpublishing archived contest rejected with 400 Bad Request');

    // 4.6 Contest with existing submissions cannot be unpublished -> 409 Conflict
    // Re-publish base contest
    await request('POST', `/api/contests/${emptyContestId}/publish`, null, tokenProfA);
    // Insert a submission directly into DB
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, contest_id, language, source_code, status, score)
       VALUES ($1, $2, $3, 'python', 'print(1)', 'accepted', 100)`,
      [student1.id, testProblem.id, emptyContestId]
    );

    const resUnpubWithSub = await request('POST', `/api/contests/${emptyContestId}/unpublish`, null, tokenProfA);
    assert(resUnpubWithSub.status === 409, '4.6 Unpublishing contest with existing submissions blocked with 409 Conflict');
    assert(
      JSON.stringify(resUnpubWithSub.data).includes('Submissions already exist'),
      '4.6 Error message explicitly cites existing submissions'
    );

    // -------------------------------------------------------------
    // 5. GENERIC UPDATE BYPASS DEFENSE (USING Prof A2)
    // -------------------------------------------------------------
    console.log('\n--- 5. Generic Update Bypass Defense ---');

    // Create a new draft contest with zero problems
    const resDraftZero = await request('POST', '/api/contests', {
      title: `Generic Bypass Target ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    const draftZeroId = resDraftZero.data.contest.id;
    trackedContestIds.push(draftZeroId);

    // 5.1 PATCH status: 'published' on draft contest rejected with 400 Bad Request
    const resPatchPublish = await request('PATCH', `/api/contests/${draftZeroId}`, {
      status: 'published',
    }, tokenProfA2);
    assert(resPatchPublish.status === 400, '5.1 Direct status: "published" via PATCH rejected with 400 Bad Request');
    assert(
      JSON.stringify(resPatchPublish.data).includes('POST /api/contests/:id/publish'),
      '5.1 Direct publish error directs user to dedicated endpoint'
    );

    // Verify contest remains draft in DB
    const checkRowDraft = await ContestModel.findContestById(draftZeroId);
    assert(checkRowDraft.status === 'draft', '5.1 Contest status remains strictly "draft" in DB');

    // 5.2 PUT isPublished: true on draft contest does NOT publish it
    const resPutIsPub = await request('PUT', `/api/contests/${draftZeroId}`, {
      title: `Updated Title IsPub ${now}`,
      isPublished: true,
    }, tokenProfA2);
    assert(resPutIsPub.status === 200, '5.2 Permitted update succeeds');
    const checkRowAfterPut = await ContestModel.findContestById(draftZeroId);
    assert(checkRowAfterPut.status === 'draft', '5.2 Injected isPublished: true did not publish contest');

    // 5.3 published: true in body does NOT publish contest
    const resPutPub = await request('PUT', `/api/contests/${draftZeroId}`, {
      title: `Updated Title Pub ${now}`,
      published: true,
    }, tokenProfA2);
    assert(resPutPub.status === 200, '5.3 Permitted update succeeds');
    const checkRowAfterPub = await ContestModel.findContestById(draftZeroId);
    assert(checkRowAfterPub.status === 'draft', '5.3 Injected published: true did not publish contest');

    // 5.4 PATCH status: 'draft' on published upcoming contest rejected with 400 Bad Request
    // Attach problem and publish draftZeroId properly
    await ContestModel.addProblemToContest({ contestId: draftZeroId, problemId: testProblem.id, points: 50 });
    await request('POST', `/api/contests/${draftZeroId}/publish`, null, tokenProfA2);

    const resPatchUnpub = await request('PATCH', `/api/contests/${draftZeroId}`, {
      status: 'draft',
    }, tokenProfA2);
    assert(resPatchUnpub.status === 400, '5.4 Direct status: "draft" via PATCH rejected with 400 Bad Request');
    assert(
      JSON.stringify(resPatchUnpub.data).includes('POST /api/contests/:id/unpublish'),
      '5.4 Direct unpublish error directs user to dedicated endpoint'
    );

    // 5.5 PATCH status: 'draft' on running contest rejected with 409 Conflict
    const resPatchRunningDraft = await request('PATCH', `/api/contests/${runningContest.id}`, {
      status: 'draft',
    }, tokenProfA);
    assert(resPatchRunningDraft.status === 409, '5.5 Direct status: "draft" on running contest returns 409 Conflict');

    // 5.6 isPublished: false does NOT unpublish published contest
    await request('PATCH', `/api/contests/${draftZeroId}`, {
      title: `Updated Title Unpub Injected ${now}`,
      isPublished: false,
    }, tokenProfA2);
    const checkRowStillPub = await ContestModel.findContestById(draftZeroId);
    assert(checkRowStillPub.status === 'published', '5.6 Injected isPublished: false did not revert published contest');

    // -------------------------------------------------------------
    // 6. DRAFT / UNPUBLISHED PRIVACY & ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- 6. Draft Privacy & Isolation ---');

    // Create a new draft contest for isolation tests (using Prof A2)
    const resIsoDraft = await request('POST', '/api/contests', {
      title: `Secret Unpublished Exam ${now}`,
      description: 'Confidential draft problem set',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    const isoDraftId = resIsoDraft.data.contest.id;
    trackedContestIds.push(isoDraftId);
    await ContestModel.addProblemToContest({ contestId: isoDraftId, problemId: testProblem.id, points: 100 });

    // 6.1 Student contest listing omits draft
    const resStuList = await request('GET', '/api/contests', null, tokenStudent1);
    assert(resStuList.status === 200, '6.1 Student gets public contest list (200 OK)');
    const stuContests = resStuList.data?.contests || [];
    assert(!stuContests.some(c => c.id === isoDraftId), '6.1 Unpublished draft contest omitted from student list');

    // 6.2 Public unauthenticated contest listing omits draft
    const resPubList = await request('GET', '/api/contests');
    assert(resPubList.status === 200, '6.2 Anonymous gets public contest list (200 OK)');
    const pubContests = resPubList.data?.contests || [];
    assert(!pubContests.some(c => c.id === isoDraftId), '6.2 Unpublished draft contest omitted from public list');

    // 6.3 Student direct GET /api/contests/:id on draft returns 403 Forbidden
    const resStuDirect = await request('GET', `/api/contests/${isoDraftId}`, null, tokenStudent1);
    assert(resStuDirect.status === 403, '6.3 Student direct GET on draft contest returns 403 Forbidden');

    // 6.4 Anonymous direct GET on draft returns 403 Forbidden
    const resAnonDirect = await request('GET', `/api/contests/${isoDraftId}`);
    assert(resAnonDirect.status === 403, '6.4 Anonymous direct GET on draft contest returns 403 Forbidden');

    // 6.5 Student join draft returns 400 Bad Request
    const resJoinDraft = await request('POST', `/api/contests/${isoDraftId}/join`, null, tokenStudent1);
    assert(resJoinDraft.status === 400, '6.5 Student joining draft contest rejected with 400 Bad Request');

    // 6.6 Code submission to draft returns 400 Bad Request
    const resSubDraft = await request('POST', '/api/submissions', {
      problemId: testProblem.id,
      contestId: isoDraftId,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    assert(resSubDraft.status === 400, '6.6 Code submission to draft contest rejected with 400 Bad Request');

    // 6.7 Interactive run on draft returns 400 Bad Request
    const resRunDraft = await request('POST', '/api/submissions/run', {
      problemId: testProblem.id,
      contestId: isoDraftId,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    assert(resRunDraft.status === 400, '6.7 Interactive run on draft contest rejected with 400 Bad Request');

    // 6.8 Leaderboard query on draft contest returns 404/403
    const resLeadDraft = await request('GET', `/api/contests/${isoDraftId}/leaderboard`, null, tokenStudent1);
    assert(resLeadDraft.status === 404 || resLeadDraft.status === 403, '6.8 Draft leaderboard concealed from student (404/403)');

    // 6.9 Results query on draft contest returns 404/403
    const resResDraft = await request('GET', `/api/contests/${isoDraftId}/results`, null, tokenStudent1);
    assert(resResDraft.status === 404 || resResDraft.status === 403, '6.9 Draft results concealed from student (404/403)');

    // -------------------------------------------------------------
    // 7. PUBLISHED CONTEST VISIBILITY & PUBLIC DATA
    // -------------------------------------------------------------
    console.log('\n--- 7. Published Contest Visibility ---');

    // Publish the isolated contest
    await request('POST', `/api/contests/${isoDraftId}/publish`, null, tokenProfA2);

    // 7.1 Student contest listing now includes published contest
    const resStuListAfterPub = await request('GET', '/api/contests', null, tokenStudent1);
    const stuContestsAfterPub = resStuListAfterPub.data?.contests || [];
    assert(stuContestsAfterPub.some(c => c.id === isoDraftId), '7.1 Published contest appears in student list');

    // 7.2 Public contest listing includes published contest
    const resPubListAfterPub = await request('GET', '/api/contests');
    const pubContestsAfterPub = resPubListAfterPub.data?.contests || [];
    assert(pubContestsAfterPub.some(c => c.id === isoDraftId), '7.2 Published contest appears in public list');

    // 7.3 Student direct GET returns 200 OK with problem metadata
    const resStuDirectPub = await request('GET', `/api/contests/${isoDraftId}`, null, tokenStudent1);
    assert(resStuDirectPub.status === 200, '7.3 Student direct GET on published contest succeeds (200 OK)');
    assert(resStuDirectPub.data?.problems?.length === 1, '7.3 Attached problems array is populated');

    // 7.4 Public direct GET returns 200 OK
    const resPubDirectPub = await request('GET', `/api/contests/${isoDraftId}`);
    assert(resPubDirectPub.status === 200, '7.4 Anonymous direct GET on published contest succeeds (200 OK)');

    // 7.5 Problem list does NOT contain hidden test cases
    const attachedProb = resStuDirectPub.data.problems[0];
    assert(attachedProb.testCases === undefined, '7.5 Problems array does not expose raw testCases');
    assert(attachedProb.hiddenTestCases === undefined, '7.5 Problems array does not expose hiddenTestCases');

    // 7.6 Response strictly excludes passwords and internal secrets
    const jsonStr = JSON.stringify(resStuDirectPub.data);
    assert(!jsonStr.includes('password_hash'), '7.6 Response excludes password_hash');
    assert(!jsonStr.includes('passwordHash'), '7.6 Response excludes passwordHash');

    // -------------------------------------------------------------
    // 8. CONTEST-PROBLEM CONSISTENCY
    // -------------------------------------------------------------
    console.log('\n--- 8. Contest-Problem Consistency ---');

    // 8.1 Student cannot view hidden test case content through problem API
    const resProbDetail = await request('GET', `/api/problems/${testProblem.id}`, null, tokenStudent1);
    assert(resProbDetail.status === 200, '8.1 Problem details accessible to student');
    assert(resProbDetail.data?.sampleTestCases?.length === 1, '8.1 Sample test cases visible');
    assert(resProbDetail.data?.hiddenTestCases === undefined, '8.1 Hidden test cases NOT exposed');

    // 8.2 Student blocked from administrative test-cases API (403 Forbidden)
    const resTestCasesApi = await request('GET', `/api/problems/${testProblem.id}/test-cases`, null, tokenStudent1);
    assert(resTestCasesApi.status === 403, '8.2 Student blocked from /api/problems/:id/test-cases (403 Forbidden)');

    // -------------------------------------------------------------
    // 9. PARTICIPATION & ENROLLMENT BEHAVIOR
    // -------------------------------------------------------------
    console.log('\n--- 9. Participation & Enrollment ---');

    // 9.1 Student joins published upcoming contest -> 201 Created
    const resJoinPub = await request('POST', `/api/contests/${isoDraftId}/join`, null, tokenStudent1);
    assert(resJoinPub.status === 201, '9.1 Student joins published contest (201 Created)');

    // 9.2 Enrollment does NOT mutate contest status
    const rowPostEnroll = await ContestModel.findContestById(isoDraftId);
    assert(rowPostEnroll.status === 'published', '9.2 Contest status remains "published" after student enrollment');

    // 9.3 Repeat join by same student is idempotent or returns 409
    const resRepeatJoin = await request('POST', `/api/contests/${isoDraftId}/join`, null, tokenStudent1);
    assert(resRepeatJoin.status === 409 || resRepeatJoin.status === 200, '9.3 Duplicate enrollment handled cleanly');

    // -------------------------------------------------------------
    // 10. SUBMISSION SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 10. Submission Security ---');

    // 10.1 Injected client-body fields (status: 'running', isPublished: true) cannot bypass upcoming state
    const resSubmitUpcoming = await request('POST', '/api/submissions', {
      problemId: testProblem.id,
      contestId: isoDraftId,
      language: 'python',
      sourceCode: 'print(1)',
      status: 'running',
      isPublished: true,
      contestState: 'running',
    }, tokenStudent1);
    assert(resSubmitUpcoming.status === 400, '10.1 Submission to upcoming contest rejected (400 Bad Request)');
    assert(
      JSON.stringify(resSubmitUpcoming.data).includes('upcoming') || JSON.stringify(resSubmitUpcoming.data).includes('not started') || JSON.stringify(resSubmitUpcoming.data).includes('active'),
      '10.1 Error message correctly identifies that contest has not started yet'
    );

    // -------------------------------------------------------------
    // 11. LEADERBOARD, RESULTS & EXPORT PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- 11. Leaderboard & Export Protection ---');

    // 11.1 Student blocked from /api/contests/:id/admin-leaderboard (403 Forbidden)
    const resAdminLb = await request('GET', `/api/contests/${isoDraftId}/admin-leaderboard`, null, tokenStudent1);
    assert(resAdminLb.status === 403, '11.1 Student blocked from admin leaderboard (403 Forbidden)');

    // 11.2 Student blocked from results export (403 Forbidden)
    const resExpResults = await request('GET', `/api/contests/${isoDraftId}/export/results`, null, tokenStudent1);
    assert(resExpResults.status === 403, '11.2 Student blocked from results export (403 Forbidden)');

    // 11.3 Student blocked from participants export (403 Forbidden)
    const resExpParts = await request('GET', `/api/contests/${isoDraftId}/export/participants`, null, tokenStudent1);
    assert(resExpParts.status === 403, '11.3 Student blocked from participants export (403 Forbidden)');

    // 11.4 Student blocked from submissions export (403 Forbidden)
    const resExpSubs = await request('GET', `/api/contests/${isoDraftId}/export/submissions`, null, tokenStudent1);
    assert(resExpSubs.status === 403, '11.4 Student blocked from submissions export (403 Forbidden)');

    // 11.5 Non-owning professor blocked from Prof A exports (403 Forbidden BOLA)
    const resProfExp = await request('GET', `/api/contests/${isoDraftId}/export/results`, null, tokenProfB);
    assert(resProfExp.status === 403, '11.5 Non-owner Professor blocked from contest export (403 Forbidden)');

    // -------------------------------------------------------------
    // 12. CONCURRENCY & RACE PROTECTION (USING Prof A3)
    // -------------------------------------------------------------
    console.log('\n--- 12. Concurrency & Race Protection ---');

    // 12.1 Concurrent Publish + Publish
    const resRaceDraft1 = await request('POST', '/api/contests', {
      title: `Race Draft Contest 1 ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    const raceDraftId1 = resRaceDraft1.data.contest.id;
    trackedContestIds.push(raceDraftId1);
    await ContestModel.addProblemToContest({ contestId: raceDraftId1, problemId: testProblem.id, points: 50 });

    const pubPromises = [
      request('POST', `/api/contests/${raceDraftId1}/publish`, null, tokenProfA3),
      request('POST', `/api/contests/${raceDraftId1}/publish`, null, tokenProfA3),
    ];
    const pubResults = await Promise.all(pubPromises);
    const pubSuccessCount = pubResults.filter(r => r.status === 200).length;
    const pubFailCount = pubResults.filter(r => r.status === 400).length;
    assert(pubSuccessCount === 1, '12.1 Exactly one concurrent publish request succeeds (200 OK)');
    assert(pubFailCount === 1, '12.1 Concurrent duplicate publish safely returns 400 Bad Request');

    const finalRaceRow1 = await ContestModel.findContestById(raceDraftId1);
    assert(finalRaceRow1.status === 'published', '12.1 Final contest status is consistently "published"');

    // 12.2 Concurrent Unpublish + Unpublish
    const unpubPromises = [
      request('POST', `/api/contests/${raceDraftId1}/unpublish`, null, tokenProfA3),
      request('POST', `/api/contests/${raceDraftId1}/unpublish`, null, tokenProfA3),
    ];
    const unpubResults = await Promise.all(unpubPromises);
    const unpubSuccessCount = unpubResults.filter(r => r.status === 200).length;
    const unpubFailCount = unpubResults.filter(r => r.status === 400).length;
    assert(unpubSuccessCount === 1, '12.2 Exactly one concurrent unpublish request succeeds (200 OK)');
    assert(unpubFailCount === 1, '12.2 Concurrent duplicate unpublish safely returns 400 Bad Request');

    const finalRaceRow2 = await ContestModel.findContestById(raceDraftId1);
    assert(finalRaceRow2.status === 'draft', '12.2 Final contest status is consistently "draft"');

    // 12.3 Concurrent Publish + Unpublish
    const racePromisesMixed = [
      request('POST', `/api/contests/${raceDraftId1}/publish`, null, tokenProfA3),
      request('POST', `/api/contests/${raceDraftId1}/unpublish`, null, tokenProfA3),
    ];
    const mixedResults = await Promise.all(racePromisesMixed);
    assert(mixedResults.every(r => [200, 400].includes(r.status)), '12.3 Concurrent publish+unpublish handled without 500 error');
    const finalRaceRow3 = await ContestModel.findContestById(raceDraftId1);
    assert(['draft', 'published'].includes(finalRaceRow3.status), '12.3 Final contest state is clean and valid');

    // -------------------------------------------------------------
    // 13. IDEMPOTENCY VERIFICATION (USING Prof A4)
    // -------------------------------------------------------------
    console.log('\n--- 13. Idempotency Verification ---');

    const resIdempContest = await request('POST', '/api/contests', {
      title: `Idempotency Contest ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA4);
    const idempContestId = resIdempContest.data.contest.id;
    trackedContestIds.push(idempContestId);
    await ContestModel.addProblemToContest({ contestId: idempContestId, problemId: testProblem.id, points: 50 });

    // Initial publish
    const resInitPub = await request('POST', `/api/contests/${idempContestId}/publish`, null, tokenProfA4);
    assert(resInitPub.status === 200, '13.0 Initial publish succeeds (200 OK)');

    // Call publish 3 more times consecutively
    for (let i = 1; i <= 3; i++) {
      const repPub = await request('POST', `/api/contests/${idempContestId}/publish`, null, tokenProfA4);
      assert(repPub.status === 400, `13.1 Sequential repeat publish #${i} consistently returns 400 Bad Request`);
    }

    // Unpublish back to draft
    const resInitUnpub = await request('POST', `/api/contests/${idempContestId}/unpublish`, null, tokenProfA4);
    assert(resInitUnpub.status === 200, '13.0 Unpublish back to draft succeeds (200 OK)');

    // Call unpublish 3 more times consecutively
    for (let i = 1; i <= 3; i++) {
      const repUnpub = await request('POST', `/api/contests/${idempContestId}/unpublish`, null, tokenProfA4);
      assert(repUnpub.status === 400, `13.2 Sequential repeat unpublish #${i} consistently returns 400 Bad Request`);
    }

    // -------------------------------------------------------------
    // 14. AUDIT LOGGING OBSERVABILITY
    // -------------------------------------------------------------
    console.log('\n--- 14. Audit Logging ---');

    // Query audit logs for events on idempContestId
    const auditRes = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE resource_id = $1 
       ORDER BY created_at DESC LIMIT 10`,
      [idempContestId]
    );
    const actions = auditRes.rows.map(r => r.action);
    assert(actions.includes('CONTEST_PUBLISHED'), '14.1 CONTEST_PUBLISHED audit log exists');
    assert(actions.includes('CONTEST_UNPUBLISHED'), '14.2 CONTEST_UNPUBLISHED audit log exists');

    // Verify PRIVILEGED_ACTION_DENIED logged for non-owner attempt
    const deniedLogs = await db.query(
      `SELECT action, outcome, metadata 
       FROM audit_logs 
       WHERE actor_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY created_at DESC LIMIT 5`,
      [profB.id]
    );
    assert(deniedLogs.rowCount > 0, '14.3 PRIVILEGED_ACTION_DENIED logged for unauthorized professor');

    // -------------------------------------------------------------
    // 15. INPUT BOUNDARIES & INJECTION REGRESSION
    // -------------------------------------------------------------
    console.log('\n--- 15. Input Boundaries & Injection Regression ---');

    // 15.1 Non-integer ID on publish returns 400
    const resBadIdPub = await request('POST', '/api/contests/abc/publish', null, tokenProfA4);
    assert(resBadIdPub.status === 400, '15.1 Non-integer ID on publish returns 400 Bad Request');

    // 15.2 Negative ID on publish returns 400
    const resNegIdPub = await request('POST', '/api/contests/-5/publish', null, tokenProfA4);
    assert(resNegIdPub.status === 400, '15.2 Negative ID on publish returns 400 Bad Request');

    // 15.3 Non-existent ID on publish returns 404
    const resNotFoundPub = await request('POST', '/api/contests/9999999/publish', null, tokenProfA4);
    assert(resNotFoundPub.status === 404, '15.3 Non-existent ID on publish returns 404 Not Found');

    // 15.4 Non-integer ID on unpublish returns 400
    const resBadIdUnpub = await request('POST', '/api/contests/abc/unpublish', null, tokenProfA4);
    assert(resBadIdUnpub.status === 400, '15.4 Non-integer ID on unpublish returns 400 Bad Request');

    // 15.5 SQL injection probe in publish ID returns 400
    const resSqliPub = await request('POST', "/api/contests/1' OR '1'='1/publish", null, tokenProfA4);
    assert(resSqliPub.status === 400, '15.5 SQL injection probe in publish ID returns 400 Bad Request');

    // 15.6 SQL injection probe in unpublish ID returns 400
    const resSqliUnpub = await request('POST', "/api/contests/1' OR '1'='1/unpublish", null, tokenProfA4);
    assert(resSqliUnpub.status === 400, '15.6 SQL injection probe in unpublish ID returns 400 Bad Request');

    // -------------------------------------------------------------
    // 16. TEARDOWN & CANONICAL BASELINE RESTORATION
    // -------------------------------------------------------------
    console.log('\n--- 16. Teardown & Canonical Baseline Restoration ---');

    // Delete test submissions
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1)', [trackedContestIds]);
      await db.query('DELETE FROM audit_logs WHERE resource_type = $1 AND resource_id = ANY($2)', ['contest', trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1)', [trackedContestIds]);
    }

    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1)', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1)', [trackedProblemIds]);
    }

    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1)', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1)', [trackedUserIds]);
    }

    // Verify canonical counts
    const userCount = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const contestCount = await db.query('SELECT COUNT(*)::int AS count FROM contests');
    const problemCount = await db.query('SELECT COUNT(*)::int AS count FROM problems');
    const subCount = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    const ratingCount = await db.query('SELECT COUNT(*)::int AS count FROM rating_history');

    console.log(`Baseline Verification: Users=${userCount.rows[0].count}, Contests=${contestCount.rows[0].count}, Problems=${problemCount.rows[0].count}, Submissions=${subCount.rows[0].count}, Rating History=${ratingCount.rows[0].count}`);

    assert(userCount.rows[0].count === 5, 'Baseline Users == 5');
    assert(contestCount.rows[0].count === 1, 'Baseline Contests == 1');
    assert(problemCount.rows[0].count === 5, 'Baseline Problems == 5');
    assert(subCount.rows[0].count === 33, 'Baseline Submissions == 33');
    assert(ratingCount.rows[0].count === 0, 'Baseline Rating History == 0');

  } catch (err) {
    console.error('Fatal error during test execution:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.pool.end();
    console.log('[DATABASE] PostgreSQL pool has been closed gracefully.');
  }

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite();
}

module.exports = { runTestSuite };
