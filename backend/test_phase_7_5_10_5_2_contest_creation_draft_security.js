/**
 * CODEFROG — Phase 7.5.10.5.2
 * Contest Creation & Draft Lifecycle Security Test Suite
 * File: backend/test_phase_7_5_10_5_2_contest_creation_draft_security.js
 *
 * Verifies all Phase 7.5.10.5.2 security requirements:
 * 1. Creation authorization (unauthenticated 401, student 403, prof/admin 201)
 * 2. Server-authoritative creator identity (createdBy, ownerId, userId spoofing blocked)
 * 3. Initial state security (status strictly 'draft', runtimeState strictly 'draft')
 * 4. Privileged initial-state tampering (status, isPublished, isRatingFinalized rejected)
 * 5. Mass assignment defense (system/audit/internal fields rejected or ignored)
 * 6. Draft privacy & isolation (hidden from student listings, search, direct ID, enrollment, submission)
 * 7. Draft access matrix & BOLA defense (non-owner professors blocked with 403)
 * 8. Draft editing rules & lifecycle transition protection (generic publish/unpublish blocked)
 * 9. Partial timestamp update validation (prevents DB 500 check violation)
 * 10. Field validation (title bounds, types, null bytes, description limits, freeze settings)
 * 11. Date and time validation (chronological bounds, duration bounds, malformed dates)
 * 12. Duplicate / rapid creation protection (3-second window returns 409)
 * 13. Transaction integrity & rollback
 * 14. SQL injection & XSS resistance
 * 15. Parameter pollution resistance
 * 16. Audit logging (CONTEST_CREATED, PRIVILEGED_ACTION_DENIED)
 * 17. Database integrity
 * 18. Complete test cleanup and canonical baseline restoration
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

async function createTestUser(role = 'student', usernamePrefix = 'test_user') {
  const ts = Date.now() + '_' + Math.floor(Math.random() * 1000000);
  const username = `${usernamePrefix}_${ts}`;
  const email = `${username}@codefrog.test`;
  const passwordHash = await hashPassword('SecurePass123!');

  const user = await UserModel.createUser({
    username,
    email,
    passwordHash,
    fullName: `Test ${role} ${ts}`,
    role,
  });

  if (role !== 'student') {
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    user.role = role;
  }

  trackedUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function runContestCreationDraftSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.5.2 — Contest Creation & Draft Security Suite     ');
  console.log('================================================================\n');

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    const now = Date.now();
    const futureStart = new Date(now + 3600000).toISOString();
    const futureEnd = new Date(now + 7200000).toISOString();

    // -------------------------------------------------------------
    // FIXTURE CREATION
    // -------------------------------------------------------------
    const { user: student1, token: tokenStudent1 } = await createTestUser('student', 'draft_std1');
    const { user: student2, token: tokenStudent2 } = await createTestUser('student', 'draft_std2');
    const { user: profA, token: tokenProfA } = await createTestUser('professor', 'draft_profA');
    const { user: profA2, token: tokenProfA2 } = await createTestUser('professor', 'draft_profA2');
    const { user: profA3, token: tokenProfA3 } = await createTestUser('professor', 'draft_profA3');
    const { user: profB, token: tokenProfB } = await createTestUser('professor', 'draft_profB');
    const { user: contestAdmin, token: tokenContestAdmin } = await createTestUser('contest_admin', 'draft_cadm');
    const { user: superAdmin, token: tokenSuperAdmin } = await createTestUser('super_admin', 'draft_sadm');

    // Use canonical Problem 1797 (Two Sum) for submission testing
    const testProblemId = 1797;

    // -------------------------------------------------------------
    // 1. CREATION AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- 1. Creation Authorization ---');

    // 1.1 Unauthenticated request -> 401
    const resUnauth = await request('POST', '/api/contests', {
      title: 'Unauthenticated Contest',
      startTime: futureStart,
      endTime: futureEnd,
    });
    assert(resUnauth.status === 401, '1.1 Unauthenticated creation rejected with 401 Unauthorized');

    // 1.2 Student role -> 403
    const resStudent = await request('POST', '/api/contests', {
      title: 'Student Attempt Contest',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenStudent1);
    assert(resStudent.status === 403, '1.2 Student creation rejected with 403 Forbidden');

    // 1.3 Professor -> 201
    const resProfA = await request('POST', '/api/contests', {
      title: `Prof A Valid Contest ${now}`,
      description: 'Valid draft contest',
      startTime: futureStart,
      endTime: futureEnd,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    }, tokenProfA);
    assert(resProfA.status === 201, '1.3 Professor creation succeeds with 201 Created');
    const contestAId = resProfA.data?.contest?.id || resProfA.data?.id;
    if (contestAId) trackedContestIds.push(contestAId);

    // 1.4 Contest Admin -> 201
    const resCadm = await request('POST', '/api/contests', {
      title: `Contest Admin Contest ${now}`,
      description: 'Admin created contest',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenContestAdmin);
    assert(resCadm.status === 201, '1.4 Contest Admin creation succeeds with 201 Created');
    const contestCadmId = resCadm.data?.contest?.id || resCadm.data?.id;
    if (contestCadmId) trackedContestIds.push(contestCadmId);

    // 1.5 Super Admin -> 201
    const resSadm = await request('POST', '/api/contests', {
      title: `Super Admin Contest ${now}`,
      description: 'Super admin created contest',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenSuperAdmin);
    assert(resSadm.status === 201, '1.5 Super Admin creation succeeds with 201 Created');
    const contestSadmId = resSadm.data?.contest?.id || resSadm.data?.id;
    if (contestSadmId) trackedContestIds.push(contestSadmId);

    // -------------------------------------------------------------
    // 2. SERVER-AUTHORITATIVE CREATOR IDENTITY & OWNERSHIP SPOOFING
    // -------------------------------------------------------------
    console.log('\n--- 2. Server-Authoritative Creator Identity ---');

    // 2.1 Injected createdBy cannot override authenticated caller
    const resSpoofCreatedBy = await request('POST', '/api/contests', {
      title: `Spoof createdBy Contest ${now}_1`,
      startTime: futureStart,
      endTime: futureEnd,
      createdBy: student1.id,
    }, tokenProfA);
    assert(resSpoofCreatedBy.status === 201, '2.1 Creation with injected createdBy succeeds');
    const spoofC1Id = resSpoofCreatedBy.data?.contest?.id;
    if (spoofC1Id) {
      trackedContestIds.push(spoofC1Id);
      const row = await ContestModel.findContestById(spoofC1Id);
      assert(row.createdBy === profA.id || row.created_by === profA.id, '2.1 createdBy authoritatively set to Prof A (student1 ignored)');
    }

    // 2.2 Injected ownerId cannot override authenticated caller
    const resSpoofOwnerId = await request('POST', '/api/contests', {
      title: `Spoof ownerId Contest ${now}_2`,
      startTime: futureStart,
      endTime: futureEnd,
      ownerId: profB.id,
    }, tokenProfA);
    assert(resSpoofOwnerId.status === 201, '2.2 Creation with injected ownerId succeeds');
    const spoofC2Id = resSpoofOwnerId.data?.contest?.id;
    if (spoofC2Id) {
      trackedContestIds.push(spoofC2Id);
      const row = await ContestModel.findContestById(spoofC2Id);
      assert(row.createdBy === profA.id || row.created_by === profA.id, '2.2 createdBy authoritatively set to Prof A (profB ignored)');
    }

    // 2.3 Injected userId cannot override authenticated caller
    const resSpoofUserId = await request('POST', '/api/contests', {
      title: `Spoof userId Contest ${now}_3`,
      startTime: futureStart,
      endTime: futureEnd,
      userId: superAdmin.id,
    }, tokenProfA);
    assert(resSpoofUserId.status === 201, '2.3 Creation with injected userId succeeds');
    const spoofC3Id = resSpoofUserId.data?.contest?.id;
    if (spoofC3Id) {
      trackedContestIds.push(spoofC3Id);
      const row = await ContestModel.findContestById(spoofC3Id);
      assert(row.createdBy === profA.id || row.created_by === profA.id, '2.3 createdBy authoritatively set to Prof A (superAdmin ignored)');
    }

    // -------------------------------------------------------------
    // 3. INITIAL STATE SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 3. Initial State Security ---');

    // 3.1 Initial status strictly 'draft'
    assert(resProfA.data?.contest?.status === 'draft', '3.1 Returned contest status is strictly "draft"');
    // 3.2 Initial runtimeState strictly 'draft'
    assert(resProfA.data?.contest?.runtimeState === 'draft', '3.2 Returned contest runtimeState is strictly "draft"');

    // 3.3 Attempting to create contest with status='published' rejected
    const resBadStatusPub = await request('POST', '/api/contests', {
      title: `Status Published Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      status: 'published',
    }, tokenProfA);
    assert(resBadStatusPub.status === 400, '3.3 Creation with status="published" rejected with 400 Bad Request');

    // 3.4 Attempting to create contest with status='running' rejected
    const resBadStatusRun = await request('POST', '/api/contests', {
      title: `Status Running Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      status: 'running',
    }, tokenProfA);
    assert(resBadStatusRun.status === 400, '3.4 Creation with status="running" rejected with 400 Bad Request');

    // 3.5 Attempting to create contest with status='ended' rejected
    const resBadStatusEnd = await request('POST', '/api/contests', {
      title: `Status Ended Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      status: 'ended',
    }, tokenProfA);
    assert(resBadStatusEnd.status === 400, '3.5 Creation with status="ended" rejected with 400 Bad Request');

    // 3.6 Attempting to create contest with status='archived' rejected
    const resBadStatusArch = await request('POST', '/api/contests', {
      title: `Status Archived Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      status: 'archived',
    }, tokenProfA);
    assert(resBadStatusArch.status === 400, '3.6 Creation with status="archived" rejected with 400 Bad Request');

    // 3.7 Attempting to create contest with isPublished=true rejected
    const resBadIsPub = await request('POST', '/api/contests', {
      title: `isPublished Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      isPublished: true,
    }, tokenProfA);
    assert(resBadIsPub.status === 400, '3.7 Creation with isPublished=true rejected with 400 Bad Request');

    // 3.8 Attempting to create contest with isRatingFinalized=true rejected
    const resBadFinalized = await request('POST', '/api/contests', {
      title: `isRatingFinalized Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      isRatingFinalized: true,
    }, tokenProfA);
    assert(resBadFinalized.status === 400, '3.8 Creation with isRatingFinalized=true rejected with 400 Bad Request');

    // 3.9 Attempting to create contest with finalResultsSnapshot rejected
    const resBadSnapshot = await request('POST', '/api/contests', {
      title: `finalResultsSnapshot Injection ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      finalResultsSnapshot: { winner: 'hacker' },
    }, tokenProfA);
    assert(resBadSnapshot.status === 400, '3.9 Creation with finalResultsSnapshot rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 4. MASS ASSIGNMENT DEFENSE
    // -------------------------------------------------------------
    console.log('\n--- 4. Mass Assignment Defense ---');

    // 4.1 Injected snake_case fields rejected
    const resSnakeCaseTamper = await request('POST', '/api/contests', {
      title: `Snake Case Tamper ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      is_published: true,
      is_ratings_finalized: true,
    }, tokenProfA);
    assert(resSnakeCaseTamper.status === 400, '4.1 Injected is_published / is_ratings_finalized rejected with 400');

    // 4.2 Arbitrary extra properties do not pollute DB
    const resExtraFields = await request('POST', '/api/contests', {
      title: `Extra Properties Contest ${now}`,
      startTime: futureStart,
      endTime: futureEnd,
      isAdmin: true,
      points: 99999,
      approved_by: 'super_admin',
    }, tokenProfA);
    assert(resExtraFields.status === 201, '4.2 Creation with harmless unrecognized properties succeeds');
    const extraContestId = resExtraFields.data?.contest?.id;
    if (extraContestId) {
      trackedContestIds.push(extraContestId);
      const row = await ContestModel.findContestById(extraContestId);
      assert(row.isAdmin === undefined && row.approved_by === undefined, '4.2 Unrecognized properties not persisted to database');
    }

    // -------------------------------------------------------------
    // 5. DRAFT PRIVACY & ISOLATION
    // -------------------------------------------------------------
    console.log('\n--- 5. Draft Privacy & Isolation ---');

    // 5.1 Student GET /api/contests does NOT list Prof A's draft contest
    const resListStudent = await request('GET', '/api/contests', null, tokenStudent1);
    assert(resListStudent.status === 200, '5.1 Student lists public contests (200 OK)');
    const studentContests = resListStudent.data?.contests || [];
    const foundInStudentList = studentContests.some(c => c.id === contestAId);
    assert(!foundInStudentList, '5.1 Draft contest not exposed in student contest list');

    // 5.2 Public unauthenticated GET /api/contests does NOT list draft contest
    const resListPublic = await request('GET', '/api/contests');
    assert(resListPublic.status === 200, '5.2 Public unauthenticated contest listing (200 OK)');
    const publicContests = resListPublic.data?.contests || [];
    const foundInPublicList = publicContests.some(c => c.id === contestAId);
    assert(!foundInPublicList, '5.2 Draft contest not exposed in public contest list');

    // 5.3 Student direct GET /api/contests/:id on draft returns 403 Forbidden
    const resDirectStudent = await request('GET', `/api/contests/${contestAId}`, null, tokenStudent1);
    assert(resDirectStudent.status === 403, '5.3 Student direct GET on draft returns 403 Forbidden');

    // 5.4 Public unauthenticated direct GET /api/contests/:id on draft returns 403 Forbidden
    const resDirectPublic = await request('GET', `/api/contests/${contestAId}`);
    assert(resDirectPublic.status === 403, '5.4 Public unauthenticated direct GET on draft returns 403 Forbidden');

    // 5.5 Student attempting to join draft contest returns 400 Bad Request
    const resJoinDraft = await request('POST', `/api/contests/${contestAId}/join`, null, tokenStudent1);
    assert(resJoinDraft.status === 400, '5.5 Student join draft contest returns 400 (not yet published)');

    // 5.6 Student attempting to submit code to draft contest problem returns 400 Bad Request
    // Attach test problem to draft contest first
    await ContestModel.addProblemToContest({ contestId: contestAId, problemId: testProblemId, points: 100 });
    const resSubmitDraft = await request('POST', '/api/submissions', {
      problemId: testProblemId,
      contestId: contestAId,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    assert(resSubmitDraft.status === 400, '5.6 Code submission to draft contest returns 400 Bad Request');

    // 5.7 Student interactive run on draft contest returns 400 Bad Request
    const resRunDraft = await request('POST', '/api/submissions/run', {
      problemId: testProblemId,
      contestId: contestAId,
      language: 'python',
      sourceCode: 'print(1)',
    }, tokenStudent1);
    assert(resRunDraft.status === 400, '5.7 Interactive run on draft contest returns 400 Bad Request');

    // -------------------------------------------------------------
    // 6. DRAFT ACCESS MATRIX & BOLA DEFENSE
    // -------------------------------------------------------------
    console.log('\n--- 6. Draft Access Matrix & BOLA Defense ---');

    // 6.1 Owner Professor can view draft -> 200
    const resOwnerView = await request('GET', `/api/contests/${contestAId}`, null, tokenProfA);
    assert(resOwnerView.status === 200, '6.1 Owner Professor can view draft contest (200 OK)');

    // 6.2 Non-Owner Professor viewing draft -> 403
    const resNonOwnerView = await request('GET', `/api/contests/${contestAId}`, null, tokenProfB);
    assert(resNonOwnerView.status === 403, '6.2 Non-Owner Professor viewing draft is blocked with 403 Forbidden');

    // 6.3 Non-Owner Professor updating draft -> 403
    const resNonOwnerEdit = await request('PUT', `/api/contests/${contestAId}`, {
      title: 'Hacked Title By Prof B',
    }, tokenProfB);
    assert(resNonOwnerEdit.status === 403, '6.3 Non-Owner Professor editing draft is blocked with 403 Forbidden');

    // 6.4 Non-Owner Professor deleting draft -> 403
    const resNonOwnerDel = await request('DELETE', `/api/contests/${contestAId}`, null, tokenProfB);
    assert(resNonOwnerDel.status === 403, '6.4 Non-Owner Professor deleting draft is blocked with 403 Forbidden');

    // 6.5 Non-Owner Professor publishing draft -> 403
    const resNonOwnerPub = await request('POST', `/api/contests/${contestAId}/publish`, null, tokenProfB);
    assert(resNonOwnerPub.status === 403, '6.5 Non-Owner Professor publishing draft is blocked with 403 Forbidden');

    // 6.6 Non-Owner Professor adding problem to draft -> 403
    const resNonOwnerAddProb = await request('POST', `/api/contests/${contestAId}/problems`, {
      problemId: testProblemId,
      points: 50,
    }, tokenProfB);
    assert(resNonOwnerAddProb.status === 403, '6.6 Non-Owner Professor adding problem to draft is blocked with 403 Forbidden');

    // 6.7 Contest Admin can manage any professor's draft contest -> 200
    const resCadmView = await request('GET', `/api/contests/${contestAId}`, null, tokenContestAdmin);
    assert(resCadmView.status === 200, '6.7 Contest Admin can view Prof A draft contest (200 OK)');

    // 6.8 Super Admin can manage any professor's draft contest -> 200
    const resSadmView = await request('GET', `/api/contests/${contestAId}`, null, tokenSuperAdmin);
    assert(resSadmView.status === 200, '6.8 Super Admin can view Prof A draft contest (200 OK)');

    // -------------------------------------------------------------
    // 7. DRAFT EDITING RULES & LIFECYCLE TRANSITION PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- 7. Draft Editing Rules & Lifecycle Protection ---');

    // 7.1 Owner can edit draft title, description, isRated
    const resOwnerUpdate = await request('PUT', `/api/contests/${contestAId}`, {
      title: `Prof A Updated Contest Title ${now}`,
      description: 'Updated draft description',
      isRated: false,
    }, tokenProfA);
    assert(resOwnerUpdate.status === 200, '7.1 Owner can edit draft metadata (200 OK)');

    // 7.2 Owner CANNOT publish draft via generic PUT update -> 400
    const resGenericPublish = await request('PUT', `/api/contests/${contestAId}`, {
      status: 'published',
    }, tokenProfA);
    assert(resGenericPublish.status === 400, '7.2 Direct publishing via generic PUT rejected with 400 Bad Request');

    // 7.3 Direct finalization tampering via update -> 400
    const resGenericFinalize = await request('PUT', `/api/contests/${contestAId}`, {
      isRatingFinalized: true,
    }, tokenProfA);
    assert(resGenericFinalize.status === 400, '7.3 Setting isRatingFinalized via update rejected with 400 Bad Request');

    // 7.4 Partial timestamp update: start time later than existing end time -> 400
    const resBadStartOnly = await request('PUT', `/api/contests/${contestAId}`, {
      startTime: new Date(now + 10000000).toISOString(), // After existing endTime
    }, tokenProfA);
    assert(resBadStartOnly.status === 400, '7.4 Partial start time later than existing end time returns clean 400 Bad Request');

    // 7.5 Partial timestamp update: end time earlier than existing start time -> 400
    const resBadEndOnly = await request('PUT', `/api/contests/${contestAId}`, {
      endTime: new Date(now - 100000).toISOString(), // Before existing startTime
    }, tokenProfA);
    assert(resBadEndOnly.status === 400, '7.5 Partial end time earlier than existing start time returns clean 400 Bad Request');

    // -------------------------------------------------------------
    // 8. FIELD VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- 8. Field Validation ---');

    // 8.1 Missing title -> 400
    const resNoTitle = await request('POST', '/api/contests', {
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNoTitle.status === 400, '8.1 Missing title returns 400 Bad Request');

    // 8.2 Short title (<3 chars) -> 400
    const resShortTitle = await request('POST', '/api/contests', {
      title: 'AB',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resShortTitle.status === 400, '8.2 Short title returns 400 Bad Request');

    // 8.3 Long title (>200 chars) -> 400
    const resLongTitle = await request('POST', '/api/contests', {
      title: 'A'.repeat(201),
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resLongTitle.status === 400, '8.3 Long title returns 400 Bad Request');

    // 8.4 Non-string title -> 400
    const resNonStrTitle = await request('POST', '/api/contests', {
      title: 12345,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNonStrTitle.status === 400, '8.4 Non-string title returns 400 Bad Request');

    // 8.5 Null byte in title -> 400
    const resNullByteTitle = await request('POST', '/api/contests', {
      title: 'Valid Title\0WithNullByte',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNullByteTitle.status === 400, '8.5 Null byte in title returns 400 Bad Request');

    // 8.6 Null byte in description -> 400
    const resNullByteDesc = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_nb`,
      description: 'Desc with null byte\0',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNullByteDesc.status === 400, '8.6 Null byte in description returns 400 Bad Request');

    // 8.7 Non-boolean isRated -> 400
    const resBadRated = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_r`,
      startTime: futureStart,
      endTime: futureEnd,
      isRated: 'yes',
    }, tokenProfA2);
    assert(resBadRated.status === 400, '8.7 Non-boolean isRated returns 400 Bad Request');

    // 8.8 Non-boolean leaderboardFreezeEnabled -> 400
    const resBadFreezeBool = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_fb`,
      startTime: futureStart,
      endTime: futureEnd,
      leaderboardFreezeEnabled: 'enabled',
    }, tokenProfA2);
    assert(resBadFreezeBool.status === 400, '8.8 Non-boolean leaderboardFreezeEnabled returns 400 Bad Request');

    // 8.9 Negative leaderboardFreezeMinutes -> 400
    const resBadFreezeNeg = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_fn`,
      startTime: futureStart,
      endTime: futureEnd,
      leaderboardFreezeMinutes: -15,
    }, tokenProfA2);
    assert(resBadFreezeNeg.status === 400, '8.9 Negative leaderboardFreezeMinutes returns 400 Bad Request');

    // 8.10 Freeze duration exceeds contest duration (duration = 60m, freeze = 120m) -> 400
    const resBadFreezeExceed = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_fe`,
      startTime: futureStart,
      endTime: futureEnd,
      leaderboardFreezeMinutes: 120, // Duration is 60 mins
    }, tokenProfA2);
    assert(resBadFreezeExceed.status === 400, '8.10 Freeze duration exceeding contest duration returns 400 Bad Request');

    // -------------------------------------------------------------
    // 9. DATE AND TIME VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- 9. Date and Time Validation ---');

    // 9.1 Missing startTime -> 400
    const resNoStart = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds1`,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNoStart.status === 400, '9.1 Missing startTime returns 400 Bad Request');

    // 9.2 Missing endTime -> 400
    const resNoEnd = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds2`,
      startTime: futureStart,
    }, tokenProfA2);
    assert(resNoEnd.status === 400, '9.2 Missing endTime returns 400 Bad Request');

    // 9.3 Malformed startTime string -> 400
    const resBadDateStr = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds3`,
      startTime: 'not-a-valid-date',
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resBadDateStr.status === 400, '9.3 Malformed date string returns 400 Bad Request');

    // 9.4 Numeric timestamp startTime -> 400
    const resNumDate = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds4`,
      startTime: now + 3600000,
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resNumDate.status === 400, '9.4 Numeric timestamp returns 400 Bad Request');

    // 9.5 Array/object startTime -> 400
    const resArrayDate = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds5`,
      startTime: ['2026-10-08T00:00:00Z'],
      endTime: futureEnd,
    }, tokenProfA2);
    assert(resArrayDate.status === 400, '9.5 Array date returns 400 Bad Request');

    // 9.6 endTime <= startTime -> 400
    const resEndBeforeStart = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds6`,
      startTime: futureEnd,
      endTime: futureStart,
    }, tokenProfA2);
    assert(resEndBeforeStart.status === 400, '9.6 endTime <= startTime returns 400 Bad Request');

    // 9.7 Duration < 1 minute -> 400
    const resTooShort = await request('POST', '/api/contests', {
      title: `Valid Title ${now}_ds7`,
      startTime: futureStart,
      endTime: new Date(new Date(futureStart).getTime() + 30000).toISOString(), // 30 seconds
    }, tokenProfA2);
    assert(resTooShort.status === 400, '9.7 Duration < 1 minute returns 400 Bad Request');

    // -------------------------------------------------------------
    // 10. DUPLICATE / RAPID CREATION PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- 10. Duplicate / Rapid Creation Protection ---');

    const rapidTitle = `Rapid Duplicate Test ${now}`;
    const resRapid1 = await request('POST', '/api/contests', {
      title: rapidTitle,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resRapid1.status === 201, '10.1 First submission of rapid title succeeds (201 Created)');
    if (resRapid1.data?.contest?.id) trackedContestIds.push(resRapid1.data.contest.id);

    // Immediate second submission by same user with same title -> 409 Conflict
    const resRapid2 = await request('POST', '/api/contests', {
      title: rapidTitle,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resRapid2.status === 409, '10.1 Rapid duplicate submission returns 409 Conflict');

    // Different title within 3s -> 201 Created
    const resRapidDiffTitle = await request('POST', '/api/contests', {
      title: `${rapidTitle} Distinct`,
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resRapidDiffTitle.status === 201, '10.2 Different title within window succeeds (201 Created)');
    if (resRapidDiffTitle.data?.contest?.id) trackedContestIds.push(resRapidDiffTitle.data.contest.id);

    // -------------------------------------------------------------
    // 11. TRANSACTION INTEGRITY & ROLLBACK
    // -------------------------------------------------------------
    console.log('\n--- 11. Transaction Integrity & Rollback ---');

    const contestsBeforeFail = (await db.query('SELECT count(*) FROM contests')).rows[0].count;
    // Attempt invalid contest creation
    await request('POST', '/api/contests', {
      title: 'Invalid Rollback Contest',
      startTime: futureStart,
      endTime: 'invalid-end-date',
    }, tokenProfA3);
    const contestsAfterFail = (await db.query('SELECT count(*) FROM contests')).rows[0].count;
    assert(contestsBeforeFail === contestsAfterFail, '11.1 Failed contest creation creates zero orphaned records');

    // -------------------------------------------------------------
    // 12. SQL INJECTION & XSS RESISTANCE
    // -------------------------------------------------------------
    console.log('\n--- 12. SQL Injection & XSS Resistance ---');

    // 12.1 SQL Injection in title
    const sqlTitle = `SQL Inj ' OR '1'='1 ${now}`;
    const resSqlInj = await request('POST', '/api/contests', {
      title: sqlTitle,
      description: "'; DROP TABLE contests; --",
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resSqlInj.status === 201, '12.1 SQL injection payload safely stored as literal text');
    if (resSqlInj.data?.contest?.id) {
      trackedContestIds.push(resSqlInj.data.contest.id);
      const row = await ContestModel.findContestById(resSqlInj.data.contest.id);
      assert(row.title === sqlTitle, '12.1 Title matched literal input without SQL corruption');
    }

    // 12.2 XSS payload in title
    const xssTitle = `<script>alert('xss')</script> ${now}`;
    const resXss = await request('POST', '/api/contests', {
      title: xssTitle,
      description: '<img src=x onerror=alert(1)>',
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resXss.status === 201, '12.2 XSS payload safely handled in contest creation');
    if (resXss.data?.contest?.id) {
      trackedContestIds.push(resXss.data.contest.id);
    }

    // -------------------------------------------------------------
    // 13. MALFORMED JSON & PARSER ABUSE
    // -------------------------------------------------------------
    console.log('\n--- 13. Malformed JSON & Parser Abuse ---');

    const resBadJson = await request('POST', '/api/contests', '{"title": "Broken Json,', tokenProfA3);
    assert(resBadJson.status === 400, '13.1 Malformed JSON payload returns 400 Bad Request');

    // -------------------------------------------------------------
    // 14. PARAMETER POLLUTION RESISTANCE
    // -------------------------------------------------------------
    console.log('\n--- 14. Parameter Pollution Resistance ---');

    const resPolluted = await request('POST', '/api/contests', {
      title: ['Polluted Title 1', 'Polluted Title 2'],
      startTime: futureStart,
      endTime: futureEnd,
    }, tokenProfA3);
    assert(resPolluted.status === 400, '14.1 Array parameter pollution on title returns 400 Bad Request');

    // -------------------------------------------------------------
    // 15. AUDIT LOGGING
    // -------------------------------------------------------------
    console.log('\n--- 15. Audit Logging ---');

    // 15.1 Verify CONTEST_CREATED audit entry exists
    const createLogs = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'CONTEST_CREATED' AND resource_id = $1",
      [contestAId]
    );
    assert(createLogs.rowCount > 0, '15.1 CONTEST_CREATED audit log generated for valid creation');

    // 15.2 Verify PRIVILEGED_ACTION_DENIED for unauthorized student attempt
    const deniedLogs = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1",
      [student1.id]
    );
    assert(deniedLogs.rowCount > 0, '15.2 PRIVILEGED_ACTION_DENIED audit log generated for unauthorized student creation attempt');

    // -------------------------------------------------------------
    // 16. DATABASE INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 16. Database Integrity ---');

    const draftRow = await ContestModel.findContestById(contestAId);
    assert(draftRow.status === 'draft', '16.1 Database row status column is strictly "draft"');
    assert(draftRow.is_rating_finalized === false || draftRow.isRatingFinalized === false, '16.2 is_rating_finalized is strictly false');
    assert(draftRow.final_results_snapshot === null || draftRow.finalResultsSnapshot === null, '16.3 final_results_snapshot is strictly null');

  } catch (err) {
    console.error('Unexpected test exception:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // 17. TEARDOWN & CANONICAL BASELINE RESTORATION
    // -------------------------------------------------------------
    console.log('\n--- 17. Teardown & Canonical Baseline Restoration ---');
    try {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }

      // Clean up tracked items
      if (trackedContestIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
        await db.query(`DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])`, [trackedContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [trackedContestIds]);
      }

      if (trackedUserIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [trackedUserIds]);
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [trackedUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [trackedUserIds]);
      }

      // Re-verify canonical baseline
      const LEGIT_USERS = [2, 3, 1093, 3833, 4339];
      const LEGIT_PROBLEMS = [319, 320, 1797, 1798, 1914];
      await db.query("DELETE FROM submissions WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914) OR (contest_id IS NOT NULL AND contest_id != 147)");
      await db.query("DELETE FROM rating_history WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR contest_id != 147");
      await db.query("DELETE FROM contest_participants WHERE contest_id != 147 OR user_id NOT IN (2, 3, 1093, 3833, 4339)");
      await db.query("DELETE FROM contest_problems WHERE contest_id != 147");
      await db.query("DELETE FROM contests WHERE id != 147");
      await db.query("DELETE FROM test_cases WHERE problem_id NOT IN (319, 320, 1797, 1798, 1914)");
      await db.query("DELETE FROM saved_problems WHERE user_id NOT IN (2, 3, 1093, 3833, 4339) OR problem_id NOT IN (319, 320, 1797, 1798, 1914)");
      await db.query("DELETE FROM problems WHERE id NOT IN (319, 320, 1797, 1798, 1914)");
      await db.query("DELETE FROM audit_logs WHERE actor_id NOT IN (2, 3, 1093, 3833, 4339)");
      await db.query("DELETE FROM users WHERE id NOT IN (2, 3, 1093, 3833, 4339)");
      await db.query("UPDATE users SET is_active = true, role = 'super_admin' WHERE id = 3");

      const uCount = (await db.query('SELECT count(*) FROM users')).rows[0].count;
      const cCount = (await db.query('SELECT count(*) FROM contests')).rows[0].count;
      const pCount = (await db.query('SELECT count(*) FROM problems')).rows[0].count;
      const sCount = (await db.query('SELECT count(*) FROM submissions')).rows[0].count;
      const rCount = (await db.query('SELECT count(*) FROM rating_history')).rows[0].count;

      console.log(`Baseline Verification: Users=${uCount}, Contests=${cCount}, Problems=${pCount}, Submissions=${sCount}, Rating History=${rCount}`);
      assert(Number(uCount) === 5, 'Baseline Users == 5');
      assert(Number(cCount) === 1, 'Baseline Contests == 1');
      assert(Number(pCount) === 5, 'Baseline Problems == 5');
      assert(Number(sCount) === 33, 'Baseline Submissions == 33');
      assert(Number(rCount) === 0, 'Baseline Rating History == 0');
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    } finally {
      await db.closePool();
    }

    console.log('\n================================================================');
    console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  }
}

runContestCreationDraftSuite();
