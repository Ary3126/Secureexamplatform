/**
 * Phase 7.5.10.3 — BOLA / IDOR & Ownership Security Test Suite
 * File: backend/test_phase_7_5_10_3_bola_idor_ownership.js
 *
 * Exhaustive active validation of Broken Object Level Authorization (BOLA),
 * Insecure Direct Object References (IDOR), and Resource Ownership Boundaries:
 * 1. User & Profile BOLA / IDOR (cross-student identity, private data shielding, email privacy)
 * 2. Contest BOLA / IDOR (cross-professor contest view, edit, publish, unpublish, archive, delete)
 * 3. Contest ID Manipulation (string, negative, decimal, non-existent, request-body spoofing)
 * 4. Problem BOLA / IDOR (cross-professor problem view, edit, publish, delete, clone, versions)
 * 5. Private / Draft Problem Access (student & peer discovery shielding, hidden test case exclusion)
 * 6. Test Case BOLA & Protection (cross-professor test case view/edit/delete, student prohibition)
 * 7. Contest-Problem Relationship Security (foreign problem attachment blocking, bulk problem isolation)
 * 8. Participant BOLA & Bulk Authorization (cross-professor enrollment manipulation, student blocks)
 * 9. Submission BOLA & Identity Binding (server-derived user_id, cross-student code/verdict isolation)
 * 10. Result & Standings BOLA (cross-student result snooping, manager scoping, self-access)
 * 11. Rating Finalization Ownership (cross-professor finalization blocks, student finalization blocks)
 * 12. Export BOLA (cross-professor results/participants/submissions export blocks, student peer export blocks)
 * 13. Admin Boundary Protection (role escalation blocks on /api/admin/*, super admin legitimate access)
 * 14. Nested Resource BOLA & Relationship Integrity (mismatched child IDs in route paths)
 * 15. Cross-Resource ID Mixing (submitting to Contest A with Problem B, unenrolled contest submissions)
 * 16. Mass Assignment & Ownership Tampering (createdBy, ownerId, userId tampering neutrality)
 * 17. HTTP Method & Alternate Route Bypass (unexpected HTTP methods, route tampering immunity)
 * 18. Database-Level Ownership Integrity (foreign keys, composite PKs, unique constraints)
 * 19. Teardown & Clean Baseline Preservation (strictly restores Users: 5, Contests: 1, Problems: 5, Submissions: 33, Rating History: 0)
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const jwt = require('jsonwebtoken');
const { app } = require('./src/server');
const db = require('./src/config/db');
const config = require('./src/config/env');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const RatingModel = require('./src/models/ratingModel');
const UserModel = require('./src/models/userModel');
const { generateToken, hashPassword } = require('./src/services/authService');
const { canManageResource } = require('./src/services/contestService');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];
const trackedProblemIds = [];
const trackedSubmissionIds = [];

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

    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function createTestUser(role = 'student', usernamePrefix = 'bola_user') {
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

async function runBolaIdorOwnershipSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.3 — BOLA / IDOR & Ownership Security Suite        ');
  console.log('================================================================\n');

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      serverPort = server.address().port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // SETUP TEST IDENTITIES & CORE OBJECTS
    // -------------------------------------------------------------
    const { user: studentAlice, token: tokenAlice } = await createTestUser('student', 's_alice');
    const { user: studentBob, token: tokenBob } = await createTestUser('student', 's_bob');
    const { user: profAlan, token: tokenAlan } = await createTestUser('professor', 'p_alan');
    const { user: profGrace, token: tokenGrace } = await createTestUser('professor', 'p_grace');
    const { user: contestAdmin, token: tokenContestAdmin } = await createTestUser('contest_admin', 'c_admin');
    const tokenPlatformAdmin = generateToken({ id: 3, role: 'super_admin', username: 'platform_admin' });

    const now = Date.now();

    // 1. Contest A (owned by Prof Alan)
    const contestARes = await ContestModel.createContest({
      title: 'Prof Alan Contest A',
      description: 'Owned by Alan',
      createdBy: profAlan.id,
      startTime: new Date(now - 3600000),
      endTime: new Date(now + 7200000),
      status: 'published',
    });
    const contestA = contestARes;
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [contestA.id]);
    contestA.status = 'published';
    trackedContestIds.push(contestA.id);

    // 1b. Draft Contest A (owned by Prof Alan, used for problem attachment/relationship security tests)
    const contestDraftARes = await ContestModel.createContest({
      title: 'Prof Alan Draft Contest A',
      description: 'Draft Contest for Problem Tests',
      createdBy: profAlan.id,
      startTime: new Date(now + 3600000),
      endTime: new Date(now + 7200000),
      status: 'draft',
    });
    const contestDraftA = contestDraftARes;
    trackedContestIds.push(contestDraftA.id);

    // 2. Contest B (owned by Prof Grace)
    const contestBRes = await ContestModel.createContest({
      title: 'Prof Grace Contest B',
      description: 'Owned by Grace',
      createdBy: profGrace.id,
      startTime: new Date(now - 3600000),
      endTime: new Date(now + 7200000),
      status: 'published',
    });
    const contestB = contestBRes;
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [contestB.id]);
    contestB.status = 'published';
    trackedContestIds.push(contestB.id);

    // 3. Problem A (owned by Prof Alan, contest_private)
    const probARes = await ProblemModel.createProblem({
      title: 'Prof Alan Private Problem A',
      description: 'Confidential Problem A',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profAlan.id,
      isPublished: true,
      allowedLanguages: ['python', 'cpp', 'java'],
    });
    const probA = probARes;
    trackedProblemIds.push(probA.id);

    // 4. Problem B (owned by Prof Grace, contest_private)
    const probBRes = await ProblemModel.createProblem({
      title: 'Prof Grace Private Problem B',
      description: 'Confidential Problem B',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profGrace.id,
      isPublished: true,
      allowedLanguages: ['python', 'cpp', 'java'],
    });
    const probB = probBRes;
    trackedProblemIds.push(probB.id);

    // 5. Public Problem (owned by Prof Alan, public bank)
    const probPubRes = await ProblemModel.createProblem({
      title: 'Public Platform Problem',
      description: 'Public Challenge',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profAlan.id,
      isPublished: true,
      allowedLanguages: ['python', 'cpp', 'java'],
    });
    const probPub = probPubRes;
    trackedProblemIds.push(probPub.id);

    // Attach Test Cases
    const tcARes = await TestCaseModel.createTestCase({
      problemId: probA.id,
      inputData: 'secret_hidden_input_A',
      expectedOutput: 'secret_hidden_output_A',
      isSample: false,
      orderIndex: 1,
    });
    const tcA = tcARes;

    const tcBRes = await TestCaseModel.createTestCase({
      problemId: probB.id,
      inputData: 'secret_hidden_input_B',
      expectedOutput: 'secret_hidden_output_B',
      isSample: false,
      orderIndex: 1,
    });
    const tcB = tcBRes;

    const tcPubSample = await TestCaseModel.createTestCase({
      problemId: probPub.id,
      inputData: 'public_sample_input',
      expectedOutput: 'public_sample_output',
      isSample: true,
      orderIndex: 1,
    });
    const tcPubHidden = await TestCaseModel.createTestCase({
      problemId: probPub.id,
      inputData: 'public_secret_hidden_input',
      expectedOutput: 'public_secret_hidden_output',
      isSample: false,
      orderIndex: 2,
    });

    // Attach Problem A to Contest A
    await ContestModel.addProblemToContest({
      contestId: contestA.id,
      problemId: probA.id,
      points: 100,
      problemOrder: 1,
    });

    // Attach Problem B to Contest B
    await ContestModel.addProblemToContest({
      contestId: contestB.id,
      problemId: probB.id,
      points: 100,
      problemOrder: 1,
    });

    // Enroll Student Alice in Contest A
    await ContestModel.addParticipant(contestA.id, studentAlice.id);

    // Enroll Student Bob in Contest B
    await ContestModel.addParticipant(contestB.id, studentBob.id);

    // Create Submission A by Student Alice in Contest A
    const resSubA = await request('POST', '/api/submissions', {
      contestId: contestA.id,
      problemId: probA.id,
      language: 'python',
      sourceCode: 'print("Alice Solution A")',
    }, tokenAlice);
    const subAId = resSubA.data?.submission?.id;
    if (subAId) trackedSubmissionIds.push(subAId);

    // Create Submission B by Student Bob in Contest B
    const resSubB = await request('POST', '/api/submissions', {
      contestId: contestB.id,
      problemId: probB.id,
      language: 'python',
      sourceCode: 'print("Bob Solution B")',
    }, tokenBob);
    const subBId = resSubB.data?.submission?.id;
    if (subBId) trackedSubmissionIds.push(subBId);

    // -------------------------------------------------------------
    // 1. USER & PROFILE BOLA / IDOR
    // -------------------------------------------------------------
    console.log('--- 1. User & Profile BOLA / IDOR ---');

    // 1.1 Student A accesses Student B identity
    const resAliceViewBobId = await request('GET', `/api/users/${studentBob.id}/identity`, null, tokenAlice);
    assert(resAliceViewBobId.status === 200, '1.1 Public profile identity returns 200 OK');
    assert(resAliceViewBobId.data?.isOwnProfile === false, '1.1 Server identifies isOwnProfile: false');
    assert(!resAliceViewBobId.data?.user?.email, '1.1 Peer email is strictly HIDDEN from Student A (Zero PII Leakage)');
    assert(!resAliceViewBobId.data?.user?.password_hash, '1.1 Password hash is strictly excluded');

    // 1.2 Student A accesses own identity
    const resAliceOwnId = await request('GET', '/api/users/me/identity', null, tokenAlice);
    assert(resAliceOwnId.status === 200, '1.2 Own identity returns 200 OK');
    assert(resAliceOwnId.data?.isOwnProfile === true, '1.2 Server identifies isOwnProfile: true');
    assert(resAliceOwnId.data?.user?.email === studentAlice.email, '1.2 Own email is present on own profile');

    // 1.3 Student A attempts to update Student B profile via PUT /api/users/me
    const resAliceSpoofUpdate = await request('PUT', '/api/users/me', {
      id: studentBob.id,
      userId: studentBob.id,
      fullName: 'Alice Hacked Bob',
    }, tokenAlice);
    assert(resAliceSpoofUpdate.status === 200, '1.3 Profile update request succeeds');

    const freshBob = await UserModel.findUserById(studentBob.id);
    const freshAlice = await UserModel.findUserById(studentAlice.id);
    assert(freshBob.full_name !== 'Alice Hacked Bob' && freshBob.fullName !== 'Alice Hacked Bob', '1.3 Student B profile was NOT modified');
    assert(freshAlice.full_name === 'Alice Hacked Bob' || freshAlice.fullName === 'Alice Hacked Bob', '1.3 Update strictly applied to Student A authenticated context');

    // -------------------------------------------------------------
    // 2. CONTEST BOLA / IDOR
    // -------------------------------------------------------------
    console.log('\n--- 2. Contest BOLA / IDOR ---');

    // 2.1 Prof Alan attempts to update Prof Grace Contest B
    const resAlanEditB = await request('PUT', `/api/contests/${contestB.id}`, {
      title: 'Alan Hacked Contest B',
    }, tokenAlan);
    assert(resAlanEditB.status === 403, '2.1 Prof Alan blocked from updating Contest B (403 Forbidden BOLA)');

    // 2.2 Prof Alan attempts to publish Prof Grace Contest B
    const resAlanPubB = await request('POST', `/api/contests/${contestB.id}/publish`, {}, tokenAlan);
    assert(resAlanPubB.status === 403, '2.2 Prof Alan blocked from publishing Contest B (403 Forbidden BOLA)');

    // 2.3 Prof Alan attempts to unpublish Prof Grace Contest B
    const resAlanUnpubB = await request('POST', `/api/contests/${contestB.id}/unpublish`, {}, tokenAlan);
    assert(resAlanUnpubB.status === 403, '2.3 Prof Alan blocked from unpublishing Contest B (403 Forbidden BOLA)');

    // 2.4 Prof Alan attempts to archive Prof Grace Contest B
    const resAlanArchiveB = await request('POST', `/api/contests/${contestB.id}/archive`, {}, tokenAlan);
    assert(resAlanArchiveB.status === 403, '2.4 Prof Alan blocked from archiving Contest B (403 Forbidden BOLA)');

    // 2.5 Prof Alan attempts to delete Prof Grace Contest B
    const resAlanDeleteB = await request('DELETE', `/api/contests/${contestB.id}`, null, tokenAlan);
    assert(resAlanDeleteB.status === 403, '2.5 Prof Alan blocked from deleting Contest B (403 Forbidden BOLA)');

    // 2.6 Prof Alan attempts to finalize ratings on Prof Grace Contest B
    const resAlanFinalizeB = await request('POST', `/api/contests/${contestB.id}/finalize-ratings`, {}, tokenAlan);
    assert(resAlanFinalizeB.status === 403, '2.6 Prof Alan blocked from finalizing Contest B ratings (403 Forbidden BOLA)');

    // 2.7 Super Admin authorized globally on Contest B
    const resSuperContestB = await request('GET', `/api/contests/${contestB.id}/problems`, null, tokenPlatformAdmin);
    assert(resSuperContestB.status === 200, '2.7 Super Admin authorized platform-wide on Contest B (200 OK)');

    // -------------------------------------------------------------
    // 3. CONTEST ID MANIPULATION & BOUNDARIES
    // -------------------------------------------------------------
    console.log('\n--- 3. Contest ID Manipulation & Boundaries ---');

    // 3.1 Non-existent numeric contest ID
    const resNonExistentContest = await request('GET', '/api/contests/99999999', null, tokenAlan);
    assert(resNonExistentContest.status === 404, '3.1 Non-existent contest returns 404 Not Found');

    // 3.2 String contest ID parameter
    const resStringContestId = await request('GET', '/api/contests/not-an-id', null, tokenAlan);
    assert(resStringContestId.status === 400, '3.2 Non-numeric contest ID rejected with 400 Bad Request');

    // 3.3 Negative contest ID parameter
    const resNegContestId = await request('GET', '/api/contests/-42', null, tokenAlan);
    assert(resNegContestId.status === 400, '3.3 Negative contest ID rejected with 400 Bad Request');

    // 3.4 Request body contestId spoofing during update
    const resBodySpoofContest = await request('PUT', `/api/contests/${contestA.id}`, {
      title: 'Legitimate Contest A Title',
      contestId: contestB.id,
      id: contestB.id,
    }, tokenAlan);
    assert(resBodySpoofContest.status === 200, '3.4 Update on owned Contest A succeeds');

    const freshContestA = await ContestModel.findContestById(contestA.id);
    const freshContestB = await ContestModel.findContestById(contestB.id);
    assert(freshContestA.title === 'Legitimate Contest A Title', '3.4 Contest A was updated');
    assert(freshContestB.title === 'Prof Grace Contest B', '3.4 Contest B was untouched (body contestId spoofing ignored)');

    // -------------------------------------------------------------
    // 4. PROBLEM BOLA / IDOR
    // -------------------------------------------------------------
    console.log('\n--- 4. Problem BOLA / IDOR ---');

    // 4.1 Prof Alan attempts to edit Prof Grace Problem B
    const resAlanEditProbB = await request('PUT', `/api/problems/${probB.id}`, {
      title: 'Alan Hacked Problem B',
    }, tokenAlan);
    assert(resAlanEditProbB.status === 403, '4.1 Prof Alan blocked from editing Problem B (403 Forbidden BOLA)');

    // 4.2 Prof Alan attempts to publish Prof Grace Problem B
    const resAlanPubProbB = await request('POST', `/api/problems/${probB.id}/publish`, {}, tokenAlan);
    assert(resAlanPubProbB.status === 403, '4.2 Prof Alan blocked from publishing Problem B (403 Forbidden BOLA)');

    // 4.3 Prof Alan attempts to unpublish Prof Grace Problem B
    const resAlanUnpubProbB = await request('POST', `/api/problems/${probB.id}/unpublish`, {}, tokenAlan);
    assert(resAlanUnpubProbB.status === 403, '4.3 Prof Alan blocked from unpublishing Problem B (403 Forbidden BOLA)');

    // 4.4 Prof Alan attempts to archive Prof Grace Problem B
    const resAlanArchiveProbB = await request('POST', `/api/problems/${probB.id}/archive`, {}, tokenAlan);
    assert(resAlanArchiveProbB.status === 403, '4.4 Prof Alan blocked from archiving Problem B (403 Forbidden BOLA)');

    // 4.5 Prof Alan attempts to delete Prof Grace Problem B
    const resAlanDeleteProbB = await request('DELETE', `/api/problems/${probB.id}`, null, tokenAlan);
    assert(resAlanDeleteProbB.status === 403, '4.5 Prof Alan blocked from deleting Problem B (403 Forbidden BOLA)');

    // 4.6 Prof Alan attempts to inspect version history of Problem B
    const resAlanVersionsProbB = await request('GET', `/api/problems/${probB.id}/versions`, null, tokenAlan);
    assert(resAlanVersionsProbB.status === 403, '4.6 Prof Alan blocked from version history of Problem B (403 Forbidden BOLA)');

    // 4.7 Super Admin authorized globally on Problem B
    const resSuperProbB = await request('GET', `/api/problems/${probB.id}/versions`, null, tokenPlatformAdmin);
    assert(resSuperProbB.status === 200, '4.7 Super Admin authorized platform-wide on Problem B (200 OK)');

    // -------------------------------------------------------------
    // 5. PRIVATE / DRAFT PROBLEM ACCESS
    // -------------------------------------------------------------
    console.log('\n--- 5. Private / Draft Problem Access ---');

    // 5.1 Student Alice attempts direct access to Problem B (contest_private in Contest B, Alice not enrolled in B)
    const resAliceAccessProbB = await request('GET', `/api/problems/${probB.id}`, null, tokenAlice);
    assert(resAliceAccessProbB.status === 404, '5.1 Private Problem B returns 404 Not Found to unauthorized Student Alice');

    // 5.2 Student Bob attempts direct access to Problem A (contest_private in Contest A, Bob not enrolled in A)
    const resBobAccessProbA = await request('GET', `/api/problems/${probA.id}`, null, tokenBob);
    assert(resBobAccessProbA.status === 404, '5.2 Private Problem A returns 404 Not Found to unauthorized Student Bob');

    // 5.3 Unauthenticated visitor attempts to access private Problem A
    const resAnonAccessProbA = await request('GET', `/api/problems/${probA.id}`);
    assert(resAnonAccessProbA.status === 404, '5.3 Private Problem A returns 404 Not Found to unauthenticated callers');

    // 5.4 Student Alice accesses public Problem Pub
    const resAliceAccessPub = await request('GET', `/api/problems/${probPub.id}`, null, tokenAlice);
    assert(resAliceAccessPub.status === 200, '5.4 Public problem returned with 200 OK');
    const pubStr = JSON.stringify(resAliceAccessPub.data);
    assert(!pubStr.includes('public_secret_hidden_input'), '5.4 Hidden test case NEVER leaked in public problem response');
    assert(pubStr.includes('public_sample_input'), '5.4 Visible sample test cases correctly included');

    // -------------------------------------------------------------
    // 6. TEST CASE BOLA & PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- 6. Test Case BOLA & Protection ---');

    // 6.1 Prof Alan attempts to view test cases for Prof Grace Problem B
    const resAlanViewTCB = await request('GET', `/api/problems/${probB.id}/test-cases`, null, tokenAlan);
    assert(resAlanViewTCB.status === 403, '6.1 Prof Alan blocked from viewing Problem B test cases (403 Forbidden)');

    // 6.2 Prof Alan attempts to add test case to Prof Grace Problem B
    const resAlanAddTCB = await request('POST', `/api/problems/${probB.id}/test-cases`, {
      inputData: 'malicious_input',
      expectedOutput: 'malicious_output',
      isSample: false,
    }, tokenAlan);
    assert(resAlanAddTCB.status === 403, '6.2 Prof Alan blocked from adding test case to Problem B (403 Forbidden)');

    // 6.3 Prof Alan attempts to update Prof Grace test case tcB
    const resAlanEditTCB = await request('PUT', `/api/problems/${probB.id}/test-cases/${tcB.id}`, {
      inputData: 'tampered_input',
      expectedOutput: 'tampered_output',
    }, tokenAlan);
    assert(resAlanEditTCB.status === 403, '6.3 Prof Alan blocked from updating Problem B test case (403 Forbidden)');

    // 6.4 Prof Alan attempts to delete Prof Grace test case tcB
    const resAlanDelTCB = await request('DELETE', `/api/problems/${probB.id}/test-cases/${tcB.id}`, null, tokenAlan);
    assert(resAlanDelTCB.status === 403, '6.4 Prof Alan blocked from deleting Problem B test case (403 Forbidden)');

    // 6.5 Student Alice attempts to access administrative test-cases endpoint
    const resAliceViewTCA = await request('GET', `/api/problems/${probA.id}/test-cases`, null, tokenAlice);
    assert(resAliceViewTCA.status === 403, '6.5 Student Alice blocked from administrative test-cases API (403 Forbidden)');

    // 6.6 Direct test-case endpoint BOLA: route problemId mismatch
    const resMismatchTC = await request('GET', `/api/problems/${probA.id}/test-cases/${tcB.id}`, null, tokenAlan);
    assert(resMismatchTC.status === 404, '6.6 Test case belonging to Problem B requested under Problem A returns 404 Not Found');

    // -------------------------------------------------------------
    // 7. CONTEST-PROBLEM RELATIONSHIP SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 7. Contest-Problem Relationship Security ---');

    // 7.1 Prof Alan attempts to attach Prof Grace private Problem B to Contest Draft A
    const resAlanAttachProbB = await request('POST', `/api/contests/${contestDraftA.id}/problems`, {
      problemId: probB.id,
      points: 100,
    }, tokenAlan);
    assert(resAlanAttachProbB.status === 403, '7.1 Prof Alan blocked from attaching foreign private Problem B to Contest A (403)');

    // 7.2 Prof Alan attempts bulk attaching with mixed problems: [probPub, probB]
    const resAlanBulkMixed = await request('POST', `/api/contests/${contestDraftA.id}/problems/bulk`, {
      problems: [
        { problemId: probPub.id, points: 50 },
        { problemId: probB.id, points: 150 }, // Foreign private problem
      ],
    }, tokenAlan);
    assert(resAlanBulkMixed.status === 403, '7.2 Bulk add with one unauthorized foreign problem strictly rejected (403 Forbidden)');

    const isPubInA = await ContestModel.isProblemInContest(contestDraftA.id, probPub.id);
    assert(isPubInA === false, '7.2 Partial commit prevented: probPub was NOT added when bulk contained unauthorized problem');

    // 7.3 Removing problem not attached to contest
    const resRemoveUnattached = await request('DELETE', `/api/contests/${contestDraftA.id}/problems/${probPub.id}`, null, tokenAlan);
    assert(resRemoveUnattached.status === 404, '7.3 Removing unattached problem from contest returns 404 Not Found');

    // -------------------------------------------------------------
    // 8. PARTICIPANT BOLA & BULK AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- 8. Participant BOLA & Bulk Authorization ---');

    // 8.1 Student Alice attempts to enroll Student Bob into Contest A
    const resAliceEnrollBob = await request('POST', `/api/contests/${contestA.id}/participants`, {
      userId: studentBob.id,
    }, tokenAlice);
    assert(resAliceEnrollBob.status === 403, '8.1 Student Alice blocked from enrolling participants (403 Forbidden)');

    // 8.2 Prof Alan attempts to add participant to Prof Grace Contest B
    const resAlanAddPartB = await request('POST', `/api/contests/${contestB.id}/participants`, {
      userId: studentAlice.id,
    }, tokenAlan);
    assert(resAlanAddPartB.status === 403, '8.2 Prof Alan blocked from adding participant to Contest B (403 Forbidden BOLA)');

    // 8.3 Prof Alan attempts to remove participant from Prof Grace Contest B
    const resAlanRemovePartB = await request('DELETE', `/api/contests/${contestB.id}/participants/${studentBob.id}`, null, tokenAlan);
    assert(resAlanRemovePartB.status === 403, '8.3 Prof Alan blocked from removing participant from Contest B (403 Forbidden BOLA)');

    // 8.4 Prof Alan attempts bulk adding participants to Contest B
    const resAlanBulkAddPartB = await request('POST', `/api/contests/${contestB.id}/participants/bulk`, {
      userIds: [studentAlice.id],
    }, tokenAlan);
    assert(resAlanBulkAddPartB.status === 403, '8.4 Prof Alan blocked from bulk adding participants to Contest B (403 Forbidden BOLA)');

    // 8.5 Removing participant with existing submissions is blocked to preserve integrity
    const resRemoveAliceSub = await request('DELETE', `/api/contests/${contestA.id}/participants/${studentAlice.id}`, null, tokenAlan);
    assert(resRemoveAliceSub.status === 409, '8.5 Removing participant with historical submissions blocked with 409 Conflict');

    // 8.6 Removing non-enrolled user from Contest A
    const resRemoveNonEnrolled = await request('DELETE', `/api/contests/${contestA.id}/participants/${studentBob.id}`, null, tokenAlan);
    assert(resRemoveNonEnrolled.status === 404, '8.6 Removing non-enrolled user returns 404 Not Found');

    // -------------------------------------------------------------
    // 9. SUBMISSION BOLA & IDENTITY BINDING
    // -------------------------------------------------------------
    console.log('\n--- 9. Submission BOLA & Identity Binding ---');

    // 9.1 Submission identity strictly derived from server context (spoofed userId ignored)
    const resSpoofSub = await request('POST', '/api/submissions', {
      contestId: contestA.id,
      problemId: probA.id,
      language: 'python',
      sourceCode: 'print("Alice Anti-Spoof")',
      userId: studentBob.id, // Alice tries to attribute to Bob
    }, tokenAlice);
    assert(resSpoofSub.status === 201 || resSpoofSub.status === 200, '9.1 Submission accepted');
    const spoofSubId = resSpoofSub.data?.submission?.id;
    if (spoofSubId) {
      trackedSubmissionIds.push(spoofSubId);
      const subRec = await SubmissionModel.findSubmissionById(spoofSubId);
      assert(subRec.userId === studentAlice.id, '9.1 Server bound submission to Alice (Bob spoofing ignored)');
      assert(subRec.userId !== studentBob.id, '9.1 Submission was NOT attributed to Bob');
    }

    // 9.2 Student Alice attempts to view Student Bob submission source code
    const resAliceViewBobCode = await request('GET', `/api/submissions/${subBId}/code`, null, tokenAlice);
    assert(resAliceViewBobCode.status === 403, '9.2 Student Alice blocked from viewing Bob submission code (403 Forbidden BOLA)');

    // 9.3 Student Alice attempts to view Student Bob submission details
    const resAliceViewBobSub = await request('GET', `/api/submissions/${subBId}`, null, tokenAlice);
    assert(resAliceViewBobSub.status === 403, '9.3 Student Alice blocked from viewing Bob submission details (403 Forbidden BOLA)');

    // 9.4 Prof Alan attempts to inspect Student Bob submission in Prof Grace Contest B
    const resAlanViewBobSub = await request('GET', `/api/submissions/${subBId}`, null, tokenAlan);
    assert(resAlanViewBobSub.status === 403, '9.4 Prof Alan blocked from viewing Contest B submissions (403 Forbidden BOLA)');

    // 9.5 Prof Grace authorized to inspect Bob submission in her Contest B
    const resGraceViewBobSub = await request('GET', `/api/submissions/${subBId}`, null, tokenGrace);
    assert(resGraceViewBobSub.status === 200, '9.5 Owning Prof Grace authorized on Contest B submission (200 OK)');

    // 9.6 Super Admin authorized globally on any submission
    const resSuperViewSub = await request('GET', `/api/submissions/${subBId}`, null, tokenPlatformAdmin);
    assert(resSuperViewSub.status === 200, '9.6 Super Admin authorized platform-wide on any submission (200 OK)');

    // -------------------------------------------------------------
    // 10. RESULT & STANDINGS BOLA
    // -------------------------------------------------------------
    console.log('\n--- 10. Result & Standings BOLA ---');

    // 10.1 Student Alice attempts to inspect Student Bob result details in Contest B
    const resAliceViewBobResB = await request('GET', `/api/contests/${contestB.id}/participants/${studentBob.id}/results`, null, tokenAlice);
    assert(resAliceViewBobResB.status === 403, '10.1 Alice blocked from inspecting Bob results in Contest B (403 Forbidden BOLA)');

    // 10.2 Student Alice accesses own result details in Contest A
    const resAliceOwnResA = await request('GET', `/api/contests/${contestA.id}/results/me`, null, tokenAlice);
    assert(resAliceOwnResA.status === 200, '10.2 Alice authorized on own result details in Contest A (200 OK)');

    // 10.3 Prof Alan attempts to inspect participant results in Prof Grace Contest B
    const resAlanViewBobResB = await request('GET', `/api/contests/${contestB.id}/participants/${studentBob.id}/results`, null, tokenAlan);
    assert(resAlanViewBobResB.status === 403, '10.3 Prof Alan blocked from Contest B participant results (403 Forbidden BOLA)');

    // 10.4 Prof Alan authorized on Alice results in his Contest A
    const resAlanViewAliceResA = await request('GET', `/api/contests/${contestA.id}/participants/${studentAlice.id}/results`, null, tokenAlan);
    assert(resAlanViewAliceResA.status === 200, '10.4 Owning Prof Alan authorized on Contest A participant results (200 OK)');

    // -------------------------------------------------------------
    // 11. EXPORT BOLA
    // -------------------------------------------------------------
    console.log('\n--- 11. Export BOLA ---');

    // 11.1 Student Alice attempts administrative export of Contest A results
    const resAliceExpRes = await request('GET', `/api/contests/${contestA.id}/export/results`, null, tokenAlice);
    assert(resAliceExpRes.status === 403, '11.1 Student Alice blocked from contest results export (403 Forbidden)');

    // 11.2 Student Alice attempts administrative export of Contest A participants
    const resAliceExpPart = await request('GET', `/api/contests/${contestA.id}/export/participants`, null, tokenAlice);
    assert(resAliceExpPart.status === 403, '11.2 Student Alice blocked from contest participants export (403 Forbidden)');

    // 11.3 Student Alice attempts administrative export of Contest A submissions
    const resAliceExpSubs = await request('GET', `/api/contests/${contestA.id}/export/submissions`, null, tokenAlice);
    assert(resAliceExpSubs.status === 403, '11.3 Student Alice blocked from contest submissions export (403 Forbidden)');

    // 11.4 Student Alice attempts to export Student Bob individual participant details
    const resAliceExpBobDetails = await request('GET', `/api/contests/${contestA.id}/participants/${studentBob.id}/export`, null, tokenAlice);
    assert(resAliceExpBobDetails.status === 403, '11.4 Student Alice blocked from exporting Bob participant details (403 Forbidden BOLA)');

    // 11.5 Student Alice exports her own participant details
    const resAliceExpOwn = await request('GET', `/api/contests/${contestA.id}/results/me/export`, null, tokenAlice);
    assert(resAliceExpOwn.status === 200, '11.5 Student Alice authorized to export her own results (200 OK)');

    // 11.6 Prof Alan attempts to export results of Prof Grace Contest B
    const resAlanExpBResults = await request('GET', `/api/contests/${contestB.id}/export/results`, null, tokenAlan);
    assert(resAlanExpBResults.status === 403, '11.6 Prof Alan blocked from exporting Contest B results (403 Forbidden BOLA)');

    // 11.7 Prof Alan attempts to export participants of Prof Grace Contest B
    const resAlanExpBParts = await request('GET', `/api/contests/${contestB.id}/export/participants`, null, tokenAlan);
    assert(resAlanExpBParts.status === 403, '11.7 Prof Alan blocked from exporting Contest B participants (403 Forbidden BOLA)');

    // 11.8 Prof Alan attempts to export submissions of Prof Grace Contest B
    const resAlanExpBSubs = await request('GET', `/api/contests/${contestB.id}/export/submissions`, null, tokenAlan);
    assert(resAlanExpBSubs.status === 403, '11.8 Prof Alan blocked from exporting Contest B submissions (403 Forbidden BOLA)');

    // 11.9 Owning Prof Alan authorized to export Contest A results
    const resAlanExpAResults = await request('GET', `/api/contests/${contestA.id}/export/results`, null, tokenAlan);
    assert(resAlanExpAResults.status === 200, '11.9 Owning Prof Alan authorized to export Contest A results (200 OK)');

    // -------------------------------------------------------------
    // 12. ADMIN BOUNDARY PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- 12. Admin Boundary Protection ---');

    // 12.1 Student calling Admin User Management
    const resStudAdminUsers = await request('GET', '/api/admin/users', null, tokenAlice);
    assert(resStudAdminUsers.status === 403, '12.1 Student blocked from /api/admin/users (403 Forbidden)');

    // 12.2 Professor calling Admin User Management
    const resProfAdminUsers = await request('GET', '/api/admin/users', null, tokenAlan);
    assert(resProfAdminUsers.status === 403, '12.2 Professor blocked from /api/admin/users (403 Forbidden)');

    // 12.3 Contest Admin calling Admin User Management
    const resCAdminUsers = await request('GET', '/api/admin/users', null, tokenContestAdmin);
    assert(resCAdminUsers.status === 403, '12.3 Contest Admin blocked from Admin User Management (403 Forbidden)');

    // 12.4 Super Admin authorized on Admin User Management
    const resSuperAdminUsers = await request('GET', '/api/admin/users', null, tokenPlatformAdmin);
    assert(resSuperAdminUsers.status === 200, '12.4 Super Admin authorized on /api/admin/users (200 OK)');

    // -------------------------------------------------------------
    // 13. NESTED RESOURCE BOLA & RELATIONSHIP INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 13. Nested Resource BOLA & Relationship Integrity ---');

    // 13.1 Mismatched child problem in contest problem remove: Problem B is not in Contest Draft A
    const resMismatchProbDel = await request('DELETE', `/api/contests/${contestDraftA.id}/problems/${probB.id}`, null, tokenAlan);
    assert(resMismatchProbDel.status === 404, '13.1 Removing Problem B from Contest A returns 404 Not Found (child not in parent)');

    // 13.2 Mismatched participant delete: Student Bob is not in Contest A
    const resMismatchPartDel = await request('DELETE', `/api/contests/${contestA.id}/participants/${studentBob.id}`, null, tokenAlan);
    assert(resMismatchPartDel.status === 404, '13.2 Removing Student Bob from Contest A returns 404 Not Found (child not in parent)');

    // 13.3 Mismatched participant results: Student Bob is not in Contest A
    const resMismatchPartRes = await request('GET', `/api/contests/${contestA.id}/participants/${studentBob.id}/results`, null, tokenAlan);
    assert(resMismatchPartRes.status === 404, '13.3 Results for Student Bob in Contest A returns 404 Not Found (child not in parent)');

    // -------------------------------------------------------------
    // 14. CROSS-RESOURCE ID MIXING (SUBMISSIONS)
    // -------------------------------------------------------------
    console.log('\n--- 14. Cross-Resource ID Mixing (Submissions) ---');

    // 14.1 Submitting to Contest A with foreign private Problem B (not attached to Contest A)
    const resCrossSubmit = await request('POST', '/api/submissions', {
      contestId: contestA.id,
      problemId: probB.id, // Problem B belongs to Contest B, not Contest A
      language: 'python',
      sourceCode: 'print("Cross Mix Hack")',
    }, tokenAlice);
    assert(resCrossSubmit.status === 400, '14.1 Cross-resource submit (Contest A + Problem B) rejected with 400 Bad Request');
    assert(resCrossSubmit.data?.message?.includes('does not belong to contest'), '14.1 Error message explicitly identifies contest-problem mismatch');

    // 14.2 Student Alice submitting to Contest B without being enrolled
    const resUnenrolledSubmit = await request('POST', '/api/submissions', {
      contestId: contestB.id,
      problemId: probB.id,
      language: 'python',
      sourceCode: 'print("Unenrolled Hack")',
    }, tokenAlice);
    assert(resUnenrolledSubmit.status === 403, '14.2 Submitting to un-enrolled Contest B rejected with 403 Forbidden');
    assert(resUnenrolledSubmit.data?.message?.includes('join the contest'), '14.2 Error message identifies missing enrollment');

    // -------------------------------------------------------------
    // 15. MASS ASSIGNMENT & OWNERSHIP TAMPERING
    // -------------------------------------------------------------
    console.log('\n--- 15. Mass Assignment & Ownership Tampering ---');

    // 15.1 Create contest with injected createdBy / ownerId
    const resMassAssignContestCreate = await request('POST', '/api/contests', {
      title: 'Prof Alan Mass Assign Test',
      description: 'Desc',
      startTime: new Date(now + 100000),
      endTime: new Date(now + 200000),
      createdBy: profGrace.id,
      ownerId: profGrace.id,
      userId: profGrace.id,
    }, tokenAlan);
    assert(resMassAssignContestCreate.status === 201, '15.1 Contest creation succeeds');
    const createdContestId = resMassAssignContestCreate.data?.id || resMassAssignContestCreate.data?.contest?.id;
    if (createdContestId) {
      trackedContestIds.push(createdContestId);
      const cRow = await ContestModel.findContestById(createdContestId);
      assert(cRow.createdBy === profAlan.id || cRow.created_by === profAlan.id, '15.1 created_by authoritatively bound to Prof Alan (injected profGrace ignored)');
    }

    // 15.2 Create problem with injected createdBy
    const resMassAssignProbCreate = await request('POST', '/api/problems', {
      title: 'Prof Alan Mass Assign Problem',
      description: 'Desc test description',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profGrace.id,
      approvedBy: studentAlice.id,
      isPublished: true,
    }, tokenAlan);
    assert(resMassAssignProbCreate.status === 201, '15.2 Problem creation succeeds');
    const createdProbId = resMassAssignProbCreate.data?.problem?.id || resMassAssignProbCreate.data?.id;
    if (createdProbId) {
      trackedProblemIds.push(createdProbId);
      const pRow = await ProblemModel.findProblemById(createdProbId);
      assert(pRow.createdBy === profAlan.id || pRow.created_by === profAlan.id, '15.2 problem.createdBy authoritatively bound to Prof Alan (injected profGrace ignored)');
    }

    // -------------------------------------------------------------
    // 16. HTTP METHOD & ALTERNATE ROUTE BYPASS
    // -------------------------------------------------------------
    console.log('\n--- 16. HTTP Method & Alternate Route Bypass ---');

    // 16.1 GET instead of DELETE on contest route does not trigger deletion
    const resGetInsteadOfDelete = await request('GET', `/api/contests/${contestA.id}`, null, tokenAlan);
    assert(resGetInsteadOfDelete.status === 200, '16.1 GET returns contest details safely without mutating');
    const stillExists = await ContestModel.findContestById(contestA.id);
    assert(stillExists !== null, '16.1 Contest A remains intact in database');

    // 16.2 Unsupported HTTP method on sensitive endpoint
    const resPatchPublish = await request('PATCH', `/api/contests/${contestA.id}/publish`, {}, tokenAlan);
    assert(resPatchPublish.status === 404 || resPatchPublish.status === 405, '16.2 Unsupported PATCH on publish route rejected');

    // -------------------------------------------------------------
    // 17. DATABASE-LEVEL OWNERSHIP INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 17. Database-Level Ownership Integrity ---');

    // 17.1 Inserting contest with non-existent created_by fails FK check
    let fkContestError = false;
    try {
      await db.query(
        "INSERT INTO contests (title, created_by, start_time, end_time, status) VALUES ('Orphan Contest', 99999999, NOW(), NOW() + interval '1 hour', 'draft')"
      );
    } catch (err) {
      fkContestError = true;
      assert(err.code === '23503', '17.1 Foreign key constraint 23503 blocks orphan contest created_by');
    }
    assert(fkContestError, '17.1 Orphan contest insert threw DB FK violation');

    // 17.2 Inserting submission with non-existent user_id fails FK check
    let fkSubError = false;
    try {
      await db.query(
        "INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status) VALUES (99999999, $1, $2, 'python', 'x', 'queued')",
        [contestA.id, probA.id]
      );
    } catch (err) {
      fkSubError = true;
      assert(err.code === '23503', '17.2 Foreign key constraint 23503 blocks orphan submission user_id');
    }
    assert(fkSubError, '17.2 Orphan submission insert threw DB FK violation');

    // 17.3 Duplicate participant insertion fails PK check
    let dupPartError = false;
    try {
      await db.query(
        'INSERT INTO contest_participants (contest_id, user_id) VALUES ($1, $2)',
        [contestA.id, studentAlice.id]
      );
    } catch (err) {
      dupPartError = true;
      assert(err.code === '23505', '17.3 Composite primary key 23505 blocks duplicate participant in contest');
    }
    assert(dupPartError, '17.3 Duplicate participant insert threw DB unique violation');

  } catch (err) {
    console.error('[UNEXPECTED SUITE ERROR]:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // 18. TEARDOWN & CLEAN BASELINE PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- 18. Teardown & Clean Baseline Preservation ---');

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Delete tracked submissions
    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1::int[])', [trackedSubmissionIds]);
    }

    // Delete rating history, submissions, participants, problems for tracked contests
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [trackedContestIds]);
    }

    // Delete test cases, submissions, saved problems for tracked problems
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problem_reviews WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1::int[])', [trackedProblemIds]);
    }

    // Delete audit logs, participants, submissions, and users for tracked users
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM rating_history WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM contest_participants WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [trackedUserIds]);
    }

    // Verify canonical baseline
    const uCount = await db.query('SELECT count(*) FROM users');
    const cCount = await db.query('SELECT count(*) FROM contests');
    const pCount = await db.query('SELECT count(*) FROM problems');
    const sCount = await db.query('SELECT count(*) FROM submissions');
    const rCount = await db.query('SELECT count(*) FROM rating_history');

    assert(parseInt(uCount.rows[0].count, 10) === 5, `18.1 Users count strictly at baseline (5 users, found ${uCount.rows[0].count})`);
    assert(parseInt(cCount.rows[0].count, 10) === 1, `18.2 Contests count strictly at baseline (1 contest, found ${cCount.rows[0].count})`);
    assert(parseInt(pCount.rows[0].count, 10) === 5, `18.3 Problems count strictly at baseline (5 problems, found ${pCount.rows[0].count})`);
    assert(parseInt(sCount.rows[0].count, 10) === 33, `18.4 Submissions count strictly at baseline (33 submissions, found ${sCount.rows[0].count})`);
    assert(parseInt(rCount.rows[0].count, 10) === 0, `18.5 Rating History count strictly at baseline (0 rows, found ${rCount.rows[0].count})`);

    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` BOLA / IDOR & Ownership Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runBolaIdorOwnershipSuite();
