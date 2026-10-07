/**
 * Phase 7.5.10.2 — Authentication & RBAC Validation Test Suite
 * File: backend/test_phase_7_5_10_2_auth_rbac_validation.js
 *
 * Comprehensive active validation of the CODEFROG authentication and authorization system:
 * 1. Authentication Boundary & Token Bypass Defenses (missing, malformed, empty, forged, expired)
 * 2. JWT Token Manipulation & Forgery Resistance (tampered userId, role, algorithm, signature stripping)
 * 3. Password Verification & Login Endpoint Security (wrong password, nonexistent user, no password_hash leakage)
 * 4. Account Status & Deactivation Security (deactivated user token rejected 401, login rejected 403)
 * 5. Role Escalation & Privilege Defenses (student/prof escalation blocked, super admin self-lockout protection)
 * 6. Identity Impersonation & Submission Identity Protection (server-derived userId, student code isolation)
 * 7. Contest Operations Authorization & BOLA/IDOR (cross-professor contest operations, contest_admin/super_admin permissions)
 * 8. Problem Operations Authorization & Hidden-Test Privacy (cross-professor problem edits, hidden test shielding)
 * 9. Participant & Enrollment Authorization (student/unauthorized prof participant mutation blocks)
 * 10. Result Details & Export Authorization (administrative export blocks, student peer isolation)
 * 11. Rating Finalization Authorization & Integrity (role gates, client-forged rating neutralization)
 * 12. Admin Protected Operations (super_admin exclusivity, student/prof/contest_admin rejection)
 * 13. Mass Assignment & Protected-Field Tampering (role, is_active, rating, created_by tampering immunity)
 * 14. Authorization Error Sanitization & Information Disclosure (zero stack traces, zero DB secrets)
 * 15. Session Edge Cases & Token Robustness (extra claims, token near expiration, invalid types)
 * 16. Teardown & Clean Baseline Preservation (strictly preserves Users: 5, Contests: 1, Problems: 5, Submissions: 33, Rating History: 0)
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

async function createTestUser(role = 'student', usernamePrefix = 'auth_user') {
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

  // If role is contest_admin or super_admin, update in db to ensure exact role
  if (role !== 'student') {
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    user.role = role;
  }

  trackedUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function runAuthRbacValidationSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.2 — Authentication & RBAC Validation Suite        ');
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
    // Setup Primary Test Actors
    const { user: studentAlice, token: tokenAlice } = await createTestUser('student', 'alice');
    const { user: studentBob, token: tokenBob } = await createTestUser('student', 'bob');
    const { user: profAlan, token: tokenAlan } = await createTestUser('professor', 'prof_alan');
    const { user: profGrace, token: tokenGrace } = await createTestUser('professor', 'prof_grace');
    const { user: contestAdmin, token: tokenContestAdmin } = await createTestUser('contest_admin', 'cadmin');
    const { user: superAdmin, token: tokenSuperAdmin } = await createTestUser('super_admin', 'sadmin');

    // -------------------------------------------------------------
    // SECTION 1: AUTHENTICATION BOUNDARY & TOKEN BYPASS DEFENSES
    // -------------------------------------------------------------
    console.log('--- 1. Authentication Boundary & Token Bypass Defenses ---');

    // 1.1 Missing Authorization Header
    const resNoAuth = await request('GET', '/api/users/me');
    assert(resNoAuth.status === 401, '1.1 Missing Authorization header returns 401 Unauthorized');
    assert(resNoAuth.data && resNoAuth.data.error === 'AUTHENTICATION_ERROR', '1.1 Error body contains AUTHENTICATION_ERROR');

    // 1.2 Empty Authorization Header
    const resEmptyAuth = await request('GET', '/api/users/me', null, null, { Authorization: '' });
    assert(resEmptyAuth.status === 401, '1.2 Empty Authorization header returns 401 Unauthorized');

    // 1.3 Literal "Bearer" without token
    const resBareBearer = await request('GET', '/api/users/me', null, null, { Authorization: 'Bearer' });
    assert(resBareBearer.status === 401, '1.3 Literal "Bearer" without token returns 401 Unauthorized');

    // 1.4 "Bearer " with trailing space only
    const resSpaceBearer = await request('GET', '/api/users/me', null, null, { Authorization: 'Bearer ' });
    assert(resSpaceBearer.status === 401, '1.4 "Bearer " with whitespace only returns 401 Unauthorized');

    // 1.5 Non-Bearer Scheme (Basic Auth)
    const resBasicAuth = await request('GET', '/api/users/me', null, null, { Authorization: 'Basic dXNlcjpwYXNz' });
    assert(resBasicAuth.status === 401, '1.5 Non-Bearer scheme rejected with 401 Unauthorized');

    // 1.6 Malformed JWT token (random gibberish string)
    const resGibberish = await request('GET', '/api/users/me', null, 'this.is.not.a.valid.jwt.token');
    assert(resGibberish.status === 401, '1.6 Malformed token rejected with 401 Unauthorized');

    // 1.7 Expired Token
    const expiredToken = jwt.sign(
      { userId: studentAlice.id, role: 'student' },
      config.jwt.secret,
      { expiresIn: '-1s', issuer: 'secure-exam-platform' }
    );
    const resExpired = await request('GET', '/api/users/me', null, expiredToken);
    assert(resExpired.status === 401, '1.7 Expired JWT rejected with 401 Unauthorized');
    assert(resExpired.data && resExpired.data.message.includes('expired'), '1.7 Identifies token expiration specifically');

    // 1.8 Forged Token (Signed with incorrect secret)
    const forgedToken = jwt.sign(
      { userId: studentAlice.id, role: 'super_admin' },
      'wrong_secret_attacker_key_987654321',
      { expiresIn: '1h', issuer: 'secure-exam-platform' }
    );
    const resForged = await request('GET', '/api/users/me', null, forgedToken);
    assert(resForged.status === 401, '1.8 Token signed with wrong secret rejected with 401 Unauthorized');

    // 1.9 Token with invalid issuer
    const badIssuerToken = jwt.sign(
      { userId: studentAlice.id, role: 'student' },
      config.jwt.secret,
      { expiresIn: '1h', issuer: 'malicious-identity-provider' }
    );
    const resBadIssuer = await request('GET', '/api/users/me', null, badIssuerToken);
    assert(resBadIssuer.status === 401, '1.9 Token with invalid issuer rejected with 401 Unauthorized');

    // 1.10 Token for non-existent ghost user
    const ghostToken = jwt.sign(
      { userId: 999999999, role: 'student' },
      config.jwt.secret,
      { expiresIn: '1h', issuer: 'secure-exam-platform' }
    );
    const resGhost = await request('GET', '/api/users/me', null, ghostToken);
    assert(resGhost.status === 401, '1.10 Token referencing deleted/non-existent user rejected with 401');

    // -------------------------------------------------------------
    // SECTION 2: JWT TOKEN MANIPULATION & ALGORITHM ATTACKS
    // -------------------------------------------------------------
    console.log('\n--- 2. JWT Token Manipulation & Algorithm Attacks ---');

    // 2.1 Tampered User ID in Payload (signature unchanged)
    const validTokenParts = tokenAlice.split('.');
    const decodedPayloadAlice = JSON.parse(Buffer.from(validTokenParts[1], 'base64').toString('utf8'));
    decodedPayloadAlice.userId = studentBob.id; // Tamper Alice's token to point to Bob
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayloadAlice)).toString('base64url');
    const tamperedTokenAliceToBob = `${validTokenParts[0]}.${tamperedPayloadB64}.${validTokenParts[2]}`;

    const resTamperedId = await request('GET', '/api/users/me', null, tamperedTokenAliceToBob);
    assert(resTamperedId.status === 401, '2.1 Tampered userId with unchanged signature rejected with 401');

    // 2.2 Tampered Role in Payload (Alice elevates to super_admin without valid signature)
    decodedPayloadAlice.userId = studentAlice.id;
    decodedPayloadAlice.role = 'super_admin'; // Tamper role
    const tamperedRoleB64 = Buffer.from(JSON.stringify(decodedPayloadAlice)).toString('base64url');
    const tamperedRoleToken = `${validTokenParts[0]}.${tamperedRoleB64}.${validTokenParts[2]}`;

    const resTamperedRole = await request('GET', '/api/admin/overview-stats', null, tamperedRoleToken);
    assert(resTamperedRole.status === 401, '2.2 Tampered role with unchanged signature rejected with 401');

    // 2.3 Signature Stripping Attack (Header + Payload without signature)
    const strippedSigToken = `${validTokenParts[0]}.${validTokenParts[1]}.`;
    const resStrippedSig = await request('GET', '/api/users/me', null, strippedSigToken);
    assert(resStrippedSig.status === 401, '2.3 Signature-stripped token rejected with 401 Unauthorized');

    // 2.4 'none' Algorithm Attack (Header alg: 'none')
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const noneToken = `${noneHeader}.${validTokenParts[1]}.`;
    const resNoneAlg = await request('GET', '/api/users/me', null, noneToken);
    assert(resNoneAlg.status === 401, '2.4 alg: "none" algorithm attack rejected with 401 Unauthorized');

    // 2.5 Token with missing userId claim
    const noUserIdToken = jwt.sign(
      { role: 'student' },
      config.jwt.secret,
      { expiresIn: '1h', issuer: 'secure-exam-platform' }
    );
    const resNoUserId = await request('GET', '/api/users/me', null, noUserIdToken);
    assert(resNoUserId.status === 401, '2.5 Token missing userId claim rejected with 401 Unauthorized');

    // -------------------------------------------------------------
    // SECTION 3: PASSWORD / LOGIN SECURITY & ERROR INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 3. Password Verification & Login Endpoint Security ---');

    // 3.1 Login with wrong password
    const resWrongPass = await request('POST', '/api/auth/login', {
      username: studentAlice.username,
      password: 'WrongPassword999!',
    });
    assert(resWrongPass.status === 401, '3.1 Wrong password rejected with 401 Unauthorized');
    assert(resWrongPass.data && resWrongPass.data.message.includes('Invalid email or password'), '3.1 Generic error message returned');

    // 3.2 Login with non-existent user
    const resNonExistent = await request('POST', '/api/auth/login', {
      username: 'definitely_non_existent_ghost_99999',
      password: 'SomePassword123!',
    });
    assert(resNonExistent.status === 401, '3.2 Non-existent user rejected with 401 Unauthorized');

    // 3.3 Login with missing password
    const resMissingPass = await request('POST', '/api/auth/login', {
      username: studentAlice.username,
    });
    assert(resMissingPass.status === 400, '3.3 Missing password returns 400 Bad Request');

    // 3.4 Login with missing username/email
    const resMissingUser = await request('POST', '/api/auth/login', {
      password: 'SecurePass123!',
    });
    assert(resMissingUser.status === 400, '3.4 Missing username/email returns 400 Bad Request');

    // 3.5 Successful login via username
    const resValidLoginUser = await request('POST', '/api/auth/login', {
      username: studentAlice.username,
      password: 'SecurePass123!',
    });
    assert(resValidLoginUser.status === 200, '3.5 Login via username succeeds with 200 OK');
    assert(resValidLoginUser.data && resValidLoginUser.data.token, '3.5 Login response includes valid JWT');
    const loginUserObj = resValidLoginUser.data.user || {};
    assert(loginUserObj.password_hash === undefined, '3.5 Login response strictly excludes password_hash');
    assert(loginUserObj.passwordHash === undefined, '3.5 Login response strictly excludes passwordHash');

    // 3.6 Successful login via email
    const resValidLoginEmail = await request('POST', '/api/auth/login', {
      email: studentAlice.email,
      password: 'SecurePass123!',
    });
    assert(resValidLoginEmail.status === 200, '3.6 Login via email succeeds with 200 OK');

    // -------------------------------------------------------------
    // SECTION 4: ACCOUNT STATUS & DEACTIVATION SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 4. Account Status & Deactivation Security ---');

    // 4.1 Create temporary user and verify active session works
    const { user: deactTarget, token: deactToken } = await createTestUser('student', 'deact_target');
    const resActiveAccess = await request('GET', '/api/users/me', null, deactToken);
    assert(resActiveAccess.status === 200, '4.1 Active user accesses /api/users/me with 200 OK');

    // 4.2 Deactivate user in database
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [deactTarget.id]);

    // 4.3 Existing token used after deactivation
    const resDeactOldToken = await request('GET', '/api/users/me', null, deactToken);
    assert(resDeactOldToken.status === 401, '4.3 Deactivated user token immediately rejected with 401 Unauthorized');
    assert(resDeactOldToken.data && resDeactOldToken.data.message.includes('deactivated'), '4.3 Explains account deactivation specifically');

    // 4.4 Login attempt on deactivated account
    const resDeactLogin = await request('POST', '/api/auth/login', {
      username: deactTarget.username,
      password: 'SecurePass123!',
    });
    assert(resDeactLogin.status === 403, '4.4 Login on deactivated account rejected with 403 Forbidden');

    // 4.5 Reactivate user and verify restoration
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [deactTarget.id]);
    const resReactivated = await request('GET', '/api/users/me', null, deactToken);
    assert(resReactivated.status === 200, '4.5 Reactivated user token immediately accepted with 200 OK');

    // -------------------------------------------------------------
    // SECTION 5: ROLE ESCALATION & MASS ASSIGNMENT DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 5. Role Escalation & Mass Assignment Defenses ---');

    // 5.1 Student attempting to self-escalate role via PUT /api/users/me
    const resSelfEscalate = await request('PUT', '/api/users/me', {
      fullName: 'Alice In Wonderland',
      role: 'super_admin',
      is_active: false,
      currentRating: 3000,
      highestRating: 3000,
    }, tokenAlice);
    assert(resSelfEscalate.status === 200, '5.1 Profile update request succeeds for permitted fields');

    const freshAlice = await UserModel.findUserById(studentAlice.id);
    assert(freshAlice.role === 'student', '5.1 Role remains student (role escalation ignored)');
    assert((freshAlice.currentRating || freshAlice.current_rating) === 1200, '5.1 Rating remains 1200 (rating inflation ignored)');
    assert(freshAlice.full_name === 'Alice In Wonderland' || freshAlice.fullName === 'Alice In Wonderland', '5.1 Permitted fullName updated');

    // 5.2 Student attempting to change role via Admin API
    const resStudentAdminPatch = await request('PATCH', `/api/admin/users/${studentAlice.id}/role`, {
      role: 'super_admin',
    }, tokenAlice);
    assert(resStudentAdminPatch.status === 403, '5.2 Student blocked from PATCH /api/admin/users/:id/role with 403 Forbidden');

    // 5.3 Professor attempting to escalate to super_admin via Admin API
    const resProfAdminPatch = await request('PATCH', `/api/admin/users/${profAlan.id}/role`, {
      role: 'super_admin',
    }, tokenAlan);
    assert(resProfAdminPatch.status === 403, '5.3 Professor blocked from PATCH /api/admin/users/:id/role with 403 Forbidden');

    // 5.4 Contest Admin attempting to access Super Admin User Role Patch
    const resCAdminPatch = await request('PATCH', `/api/admin/users/${studentAlice.id}/role`, {
      role: 'professor',
    }, tokenContestAdmin);
    assert(resCAdminPatch.status === 403, '5.4 Contest Admin blocked from Admin User Management with 403 Forbidden');

    // 5.5 Super Admin self-lockout defense: cannot deactivate the last active super admin
    // Temporarily make superAdmin inactive so only 1 active super admin (User 3) remains in system
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [superAdmin.id]);
    const tokenPlatformAdmin = generateToken({ id: 3, role: 'super_admin', username: 'platform_admin' });
    const resSelfDeact = await request('PATCH', '/api/admin/users/3/status', {
      isActive: false,
    }, tokenPlatformAdmin);
    assert(resSelfDeact.status === 409, '5.5 Super Admin self-deactivation blocked with 409 Conflict');

    // 5.6 Super Admin self-lockout defense: cannot demote the last active super admin
    const resSelfDemote = await request('PATCH', '/api/admin/users/3/role', {
      role: 'student',
    }, tokenPlatformAdmin);
    assert(resSelfDemote.status === 409, '5.6 Super Admin self-demotion blocked with 409 Conflict');

    // Restore superAdmin to active state
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [superAdmin.id]);

    // -------------------------------------------------------------
    // SECTION 6: IDENTITY IMPERSONATION & SUBMISSION BINDING
    // -------------------------------------------------------------
    console.log('\n--- 6. Identity Impersonation & Submission Identity Protection ---');

    // Create a contest owned by Prof Alan in running state
    const now = Date.now();
    const contestRes = await ContestModel.createContest({
      title: 'Active Security Validation Contest',
      description: 'RBAC verification contest',
      createdBy: profAlan.id,
      startTime: new Date(now - 3600000),
      endTime: new Date(now + 7200000),
      status: 'published',
    });
    const runContest = contestRes;
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [runContest.id]);
    runContest.status = 'published';
    trackedContestIds.push(runContest.id);

    // Attach problem 1797 (Two Sum) to runContest
    await ContestModel.addProblemToContest({
      contestId: runContest.id,
      problemId: 1797,
      points: 100,
      problemOrder: 1,
    });

    // Enroll Student Alice in runContest
    await ContestModel.addParticipant(runContest.id, studentAlice.id);

    // 6.1 Alice submits code trying to spoof userId: Bob in request body
    const resSpoofedSub = await request('POST', '/api/submissions', {
      contestId: runContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print("Alice Spoof Test")',
      userId: studentBob.id, // Attacker Alice tries to impersonate Bob
    }, tokenAlice);

    assert(resSpoofedSub.status === 201 || resSpoofedSub.status === 200, '6.1 Submission accepted');
    const subId = resSpoofedSub.data?.submission?.id;
    assert(subId !== undefined, '6.1 Submission ID received');
    if (subId) {
      trackedSubmissionIds.push(subId);
      const subRecord = await SubmissionModel.findSubmissionById(subId);
      assert(subRecord && subRecord.userId === studentAlice.id, '6.1 Server strictly bound submission to Alice (Bob spoofing ignored)');
      assert(subRecord && subRecord.userId !== studentBob.id, '6.1 Submission was NOT attributed to Bob');
    }

    // 6.2 Bob attempts to view Alice's submission source code
    const resBobViewCode = await request('GET', `/api/submissions/${subId}/code`, null, tokenBob);
    assert(resBobViewCode.status === 403, '6.2 Bob blocked from viewing Alice submission code with 403 Forbidden');

    // 6.3 Bob attempts to view Alice's submission verdict/details
    const resBobViewSub = await request('GET', `/api/submissions/${subId}`, null, tokenBob);
    assert(resBobViewSub.status === 403, '6.3 Bob blocked from viewing Alice submission details with 403 Forbidden');

    // 6.4 Alice views her own submission details
    const resAliceViewSub = await request('GET', `/api/submissions/${subId}`, null, tokenAlice);
    assert(resAliceViewSub.status === 200, '6.4 Alice authorized to inspect her own submission (200 OK)');

    // 6.5 Owning Professor Alan views Alice's submission in his contest
    const resProfViewSub = await request('GET', `/api/submissions/${subId}`, null, tokenAlan);
    assert(resProfViewSub.status === 200, '6.5 Owning Professor authorized to inspect contest submissions (200 OK)');

    // -------------------------------------------------------------
    // SECTION 7: CONTEST OPERATIONS RBAC & OWNERSHIP (BOLA/IDOR)
    // -------------------------------------------------------------
    console.log('\n--- 7. Contest Operations Authorization & BOLA/IDOR ---');

    // Create Contest A owned by Prof Alan
    const contestARes = await ContestModel.createContest({
      title: 'Prof Alan Draft Contest A',
      description: 'Owned by Prof Alan',
      createdBy: profAlan.id,
      startTime: new Date(now + 86400000),
      endTime: new Date(now + 90000000),
      status: 'draft',
    });
    const contestA = contestARes;
    trackedContestIds.push(contestA.id);

    // 7.1 Student attempting to create contest
    const resStudentCreateContest = await request('POST', '/api/contests', {
      title: 'Student Illegal Contest',
      description: 'Desc',
      startTime: new Date(now + 10000),
      endTime: new Date(now + 20000),
    }, tokenAlice);
    assert(resStudentCreateContest.status === 403, '7.1 Student blocked from creating contests with 403 Forbidden');

    // 7.2 Prof Grace attempting to edit Prof Alan's contest
    const resGraceEditContestA = await request('PUT', `/api/contests/${contestA.id}`, {
      title: 'Hacked by Grace',
    }, tokenGrace);
    assert(resGraceEditContestA.status === 403, '7.2 Prof Grace blocked from updating Prof Alan contest with 403 Forbidden');

    // 7.3 Prof Grace attempting to publish Prof Alan's contest
    const resGracePublishA = await request('POST', `/api/contests/${contestA.id}/publish`, {}, tokenGrace);
    assert(resGracePublishA.status === 403, '7.3 Prof Grace blocked from publishing Prof Alan contest with 403 Forbidden');

    // 7.4 Prof Grace attempting to delete Prof Alan's contest
    const resGraceDeleteA = await request('DELETE', `/api/contests/${contestA.id}`, null, tokenGrace);
    assert(resGraceDeleteA.status === 403, '7.4 Prof Grace blocked from deleting Prof Alan contest with 403 Forbidden');

    // 7.5 Prof Grace attempting to attach problems to Prof Alan's contest
    const resGraceAddProblemA = await request('POST', `/api/contests/${contestA.id}/problems`, {
      problemId: 1797,
      points: 100,
    }, tokenGrace);
    assert(resGraceAddProblemA.status === 403, '7.5 Prof Grace blocked from attaching problems to Prof Alan contest (403)');

    // 7.6 Prof Grace attempting to export results from Prof Alan's running contest
    const resGraceExport = await request('GET', `/api/contests/${runContest.id}/export/results`, null, tokenGrace);
    assert(resGraceExport.status === 403, '7.6 Prof Grace blocked from exporting Prof Alan contest results (403)');

    // 7.7 Prof Grace attempting to finalize ratings on Prof Alan's running contest
    const resGraceFinalize = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {}, tokenGrace);
    assert(resGraceFinalize.status === 403, '7.7 Prof Grace blocked from finalizing Prof Alan contest ratings (403)');

    // 7.8 Contest Admin authorized to inspect/manage Contest A
    const resCAdminProblems = await request('GET', `/api/contests/${runContest.id}/problems`, null, tokenContestAdmin);
    assert(resCAdminProblems.status === 200, '7.8 Contest Admin authorized platform-wide on contest problems (200 OK)');

    // 7.9 Super Admin authorized to inspect/manage Contest A
    const resSuperContest = await request('GET', `/api/contests/${runContest.id}/problems`, null, tokenSuperAdmin);
    assert(resSuperContest.status === 200, '7.9 Super Admin authorized platform-wide on contest problems (200 OK)');

    // -------------------------------------------------------------
    // SECTION 8: PROBLEM OPERATIONS RBAC & PRIVACY
    // -------------------------------------------------------------
    console.log('\n--- 8. Problem Operations Authorization & Hidden-Test Privacy ---');

    // Create private problem owned by Prof Alan
    const probARes = await ProblemModel.createProblem({
      title: 'Prof Alan Secret Problem',
      description: 'Confidential algorithmic test',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profAlan.id,
      allowedLanguages: ['python', 'cpp', 'java'],
    });
    const probA = probARes;
    trackedProblemIds.push(probA.id);

    // Add hidden test case to probA
    const tcRes = await TestCaseModel.createTestCase({
      problemId: probA.id,
      inputData: 'secret_hidden_input_999',
      expectedOutput: 'secret_hidden_output_999',
      isSample: false,
      orderIndex: 1,
    });
    if (tcRes && tcRes.id) {
      // tracked automatically by problem cascade
    }

    // 8.1 Student attempting to create problem
    const resStudentCreateProb = await request('POST', '/api/problems', {
      title: 'Student Problem',
      description: 'Desc',
      difficulty: 'easy',
      codingMode: 'function',
    }, tokenAlice);
    assert(resStudentCreateProb.status === 403, '8.1 Student blocked from creating problems with 403 Forbidden');

    // 8.2 Prof Grace attempting to edit Prof Alan's problem
    const resGraceEditProb = await request('PUT', `/api/problems/${probA.id}`, {
      title: 'Tampered by Grace',
    }, tokenGrace);
    assert(resGraceEditProb.status === 403, '8.2 Prof Grace blocked from editing Prof Alan problem with 403 Forbidden');

    // 8.3 Prof Grace attempting to publish Prof Alan's problem
    const resGracePublishProb = await request('POST', `/api/problems/${probA.id}/publish`, {}, tokenGrace);
    assert(resGracePublishProb.status === 403, '8.3 Prof Grace blocked from publishing Prof Alan problem with 403 Forbidden');

    // 8.4 Student querying private unpublished problem
    const resStudentViewPrivate = await request('GET', `/api/problems/${probA.id}`, null, tokenAlice);
    assert(resStudentViewPrivate.status === 404, '8.4 Private problem returns 404 Not Found to unauthorized students');

    // Create public published problem with sample and hidden test case
    const pubProb = await ProblemModel.createProblem({
      title: 'Platform Public Challenge',
      description: 'Public algorithmic test',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profAlan.id,
      isPublished: true,
      allowedLanguages: ['python', 'cpp', 'java'],
    });
    trackedProblemIds.push(pubProb.id);

    await TestCaseModel.createTestCase({
      problemId: pubProb.id,
      inputData: 'secret_hidden_input_pub_999',
      expectedOutput: 'secret_hidden_output_pub_999',
      isSample: false,
      orderIndex: 1,
    });
    await TestCaseModel.createTestCase({
      problemId: pubProb.id,
      inputData: 'sample_visible_input_1',
      expectedOutput: 'sample_visible_output_1',
      isSample: true,
      orderIndex: 2,
    });

    // 8.5 Student accessing public problem receives 200 OK without hidden test cases
    const resStudentPublicProb = await request('GET', `/api/problems/${pubProb.id}`, null, tokenAlice);
    assert(resStudentPublicProb.status === 200, '8.5 Public problem returned with 200 OK');
    const probPayloadStr = JSON.stringify(resStudentPublicProb.data);
    assert(!probPayloadStr.includes('secret_hidden_input_pub_999'), '8.5 Hidden test cases NEVER leaked in problem response');
    assert(probPayloadStr.includes('sample_visible_input_1'), '8.5 Sample test cases correctly visible to students');

    // 8.6 Student attempting to access administrative test-cases endpoint
    const resStudentTC = await request('GET', `/api/problems/${probA.id}/test-cases`, null, tokenAlice);
    assert(resStudentTC.status === 403, '8.6 Student blocked from test-cases API (403 Forbidden)');

    // -------------------------------------------------------------
    // SECTION 9: PARTICIPANT & ENROLLMENT AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- 9. Participant & Enrollment Authorization ---');

    // 9.1 Student Alice attempting to enroll Student Bob manually
    const resAliceAddBob = await request('POST', `/api/contests/${runContest.id}/participants`, {
      userId: studentBob.id,
    }, tokenAlice);
    assert(resAliceAddBob.status === 403, '9.1 Student blocked from adding participants with 403 Forbidden');

    // 9.2 Prof Grace attempting to add participants to Prof Alan's contest
    const resGraceAddPart = await request('POST', `/api/contests/${runContest.id}/participants`, {
      userId: studentBob.id,
    }, tokenGrace);
    assert(resGraceAddPart.status === 403, '9.2 Unauthorized professor blocked from adding participants (403)');

    // 9.3 Prof Alan adds Bob to his contest
    const resAlanAddBob = await request('POST', `/api/contests/${runContest.id}/participants`, {
      userId: studentBob.id,
    }, tokenAlan);
    assert(resAlanAddBob.status === 200 || resAlanAddBob.status === 201, '9.3 Owning Professor adds participant successfully');

    // 9.4 Prof Grace attempting to remove participant from Prof Alan's contest
    const resGraceRemoveBob = await request('DELETE', `/api/contests/${runContest.id}/participants/${studentBob.id}`, null, tokenGrace);
    assert(resGraceRemoveBob.status === 403, '9.4 Unauthorized professor blocked from removing participants (403)');

    // -------------------------------------------------------------
    // SECTION 10: RESULT DETAILS & EXPORT AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- 10. Result Details & Export Authorization ---');

    // 10.1 Student Alice attempting administrative contest results export
    const resAliceExportResults = await request('GET', `/api/contests/${runContest.id}/export/results`, null, tokenAlice);
    assert(resAliceExportResults.status === 403, '10.1 Student blocked from administrative results export (403)');

    // 10.2 Student Alice attempting administrative participants export
    const resAliceExportParts = await request('GET', `/api/contests/${runContest.id}/export/participants`, null, tokenAlice);
    assert(resAliceExportParts.status === 403, '10.2 Student blocked from administrative participants export (403)');

    // 10.3 Student Alice attempting to view Student Bob's private participant result details
    const resAliceViewBobResult = await request('GET', `/api/contests/${runContest.id}/participants/${studentBob.id}/results`, null, tokenAlice);
    assert(resAliceViewBobResult.status === 403, '10.3 Alice blocked from viewing Bob private result details with 403 Forbidden (BOLA)');

    // 10.4 Student Alice viewing her own result details
    const resAliceOwnResult = await request('GET', `/api/contests/${runContest.id}/results/me`, null, tokenAlice);
    assert(resAliceOwnResult.status === 200, '10.4 Alice authorized on her own result details (200 OK)');

    // 10.5 Owning Professor Alan viewing Alice's participant result details
    const resAlanViewAliceResult = await request('GET', `/api/contests/${runContest.id}/participants/${studentAlice.id}/results`, null, tokenAlan);
    assert(resAlanViewAliceResult.status === 200, '10.5 Owning Professor authorized to view participant results (200 OK)');

    // -------------------------------------------------------------
    // SECTION 11: RATING FINALIZATION AUTHORIZATION & INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 11. Rating Finalization Authorization & Integrity ---');

    // 11.1 Student attempting to finalize contest ratings
    const resStudentFinalize = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {}, tokenAlice);
    assert(resStudentFinalize.status === 403, '11.1 Student blocked from finalizing ratings with 403 Forbidden');

    // 11.2 Foreign Professor Grace attempting to finalize ratings
    const resGraceFinalize2 = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {}, tokenGrace);
    assert(resGraceFinalize2.status === 403, '11.2 Foreign Professor blocked from finalizing ratings with 403 Forbidden');

    // Mark Alice submission accepted and move runContest to ended state for finalization test
    await db.query("UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1", [subId]);
    await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [
      new Date(now - 7200000),
      new Date(now - 3600000),
      runContest.id,
    ]);

    // 11.3 Owning Professor Alan finalizes with client-forged rating parameters
    const resAlanFinalizeTamper = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {
      ratings: [
        { userId: studentAlice.id, ratingChange: 500, newRating: 9999 },
      ],
      isRated: false,
    }, tokenAlan);
    assert(resAlanFinalizeTamper.status === 200, '11.3 Owning Professor finalizes ratings successfully');
    assert(resAlanFinalizeTamper.data && resAlanFinalizeTamper.data.isRated === true, '11.3 Server-authoritative isRated: true preserved');

    const aliceHistory = await RatingModel.getRatingHistoryByUser(studentAlice.id);
    assert(aliceHistory.length === 1, '11.3 Exactly 1 rating_history record created');
    assert(aliceHistory[0].newRating !== 9999, '11.3 Client-supplied newRating 9999 strictly ignored');

    // 11.4 Idempotent repeat finalization
    const resRepeatFinalize = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {}, tokenAlan);
    assert(resRepeatFinalize.status === 200, '11.4 Repeat finalization returns 200 OK');
    assert(resRepeatFinalize.data && resRepeatFinalize.data.alreadyFinalized === true, '11.4 alreadyFinalized: true confirmed');

    // -------------------------------------------------------------
    // SECTION 12: ADMIN PROTECTED OPERATIONS & SUPER ADMIN EXCLUSIVITY
    // -------------------------------------------------------------
    console.log('\n--- 12. Admin Protected Operations & Super Admin Exclusivity ---');

    // 12.1 Student attempting to access Admin Overview Stats
    const resStudStats = await request('GET', '/api/admin/overview-stats', null, tokenAlice);
    assert(resStudStats.status === 403, '12.1 Student blocked from /api/admin/overview-stats (403)');

    // 12.2 Professor attempting to access Admin Overview Stats
    const resProfStats = await request('GET', '/api/admin/overview-stats', null, tokenAlan);
    assert(resProfStats.status === 403, '12.2 Professor blocked from /api/admin/overview-stats (403)');

    // 12.3 Contest Admin attempting to access Admin Overview Stats
    const resCAdminStats = await request('GET', '/api/admin/overview-stats', null, tokenContestAdmin);
    assert(resCAdminStats.status === 403, '12.3 Contest Admin blocked from /api/admin/overview-stats (403)');

    // 12.4 Student attempting to access Admin Audit Logs
    const resStudLogs = await request('GET', '/api/admin/audit-logs', null, tokenAlice);
    assert(resStudLogs.status === 403, '12.4 Student blocked from /api/admin/audit-logs (403)');

    // 12.5 Professor attempting to access Admin Audit Logs
    const resProfLogs = await request('GET', '/api/admin/audit-logs', null, tokenAlan);
    assert(resProfLogs.status === 403, '12.5 Professor blocked from /api/admin/audit-logs (403)');

    // 12.6 Super Admin authorized on Admin Overview Stats
    const resSuperStats = await request('GET', '/api/admin/overview-stats', null, tokenSuperAdmin);
    assert(resSuperStats.status === 200, '12.6 Super Admin authorized on /api/admin/overview-stats (200 OK)');

    // 12.7 Super Admin authorized on Admin Audit Logs
    const resSuperLogs = await request('GET', '/api/admin/audit-logs', null, tokenSuperAdmin);
    assert(resSuperLogs.status === 200, '12.7 Super Admin authorized on /api/admin/audit-logs (200 OK)');

    // 12.8 Super Admin authorized on Admin Users listing
    const resSuperUsers = await request('GET', '/api/admin/users?limit=10', null, tokenSuperAdmin);
    assert(resSuperUsers.status === 200, '12.8 Super Admin authorized on /api/admin/users (200 OK)');

    // -------------------------------------------------------------
    // SECTION 13: MASS ASSIGNMENT & PROTECTED FIELD INJECTIONS
    // -------------------------------------------------------------
    console.log('\n--- 13. Mass Assignment & Protected Field Injections ---');

    // 13.1 Update contest with injected protected fields (is_rating_finalized, created_by)
    const resContestMassAssign = await request('PUT', `/api/contests/${contestA.id}`, {
      title: 'Legitimate Title Update',
      is_rating_finalized: true,
      created_by: profGrace.id,
      ratings_finalized_at: new Date().toISOString(),
      final_results_snapshot: { forged: true },
    }, tokenAlan);
    assert(resContestMassAssign.status === 200, '13.1 Contest metadata update succeeds');

    const freshContestA = await ContestModel.findContestById(contestA.id);
    assert(freshContestA.title === 'Legitimate Title Update', '13.1 Permitted title updated');
    const isFinVal = freshContestA.isRatingFinalized !== undefined ? freshContestA.isRatingFinalized : freshContestA.is_rating_finalized;
    assert(isFinVal === false, '13.1 is_rating_finalized tampering strictly ignored');
    const createdByVal = freshContestA.createdBy !== undefined ? freshContestA.createdBy : freshContestA.created_by;
    assert(createdByVal === profAlan.id, '13.1 created_by ownership tampering strictly ignored');

    // 13.2 Update problem with injected protected fields (approved_by, created_by, is_published, review_status)
    const resProbMassAssign = await request('PUT', `/api/problems/${probA.id}`, {
      title: 'Legitimate Problem Title Update',
      expectedVersion: probA.version,
      approved_by: studentAlice.id,
      created_by: profGrace.id,
      is_published: true,
      review_status: 'published',
    }, tokenAlan);
    assert(resProbMassAssign.status === 200, '13.2 Problem update succeeds for permitted fields');

    const freshProbA = await ProblemModel.findProblemById(probA.id);
    assert(freshProbA.created_by === profAlan.id || freshProbA.createdBy === profAlan.id, '13.2 Problem created_by tampering strictly ignored');
    assert(freshProbA.is_published === false || freshProbA.isPublished === false, '13.2 Problem is_published tampering strictly ignored');
    assert(!freshProbA.approved_by && !freshProbA.approvedBy, '13.2 Problem approved_by tampering strictly ignored');

    // -------------------------------------------------------------
    // SECTION 14: AUTHORIZATION ERROR SANITIZATION
    // -------------------------------------------------------------
    console.log('\n--- 14. Authorization Error Sanitization & Information Disclosure ---');

    // 14.1 Unauthorized 401 error response does not leak database details or stack trace
    assert(!resNoAuth.data.stack, '14.1 401 response excludes stack trace');
    assert(!JSON.stringify(resNoAuth.data).includes('SELECT'), '14.1 401 response excludes raw SQL');
    assert(!JSON.stringify(resNoAuth.data).includes('pg_'), '14.1 401 response excludes internal Postgres names');

    // 14.2 Forbidden 403 error response does not leak internal details
    assert(!resStudentCreateContest.data.stack, '14.2 403 response excludes stack trace');
    assert(!JSON.stringify(resStudentCreateContest.data).includes('password'), '14.2 403 response excludes password information');

    // 14.3 Non-existent user query returns 404 without leaking server internals
    const res404User = await request('GET', '/api/users/88888888/rating', null, tokenAlice);
    assert(res404User.status === 404, '14.3 Non-existent user returns 404 Not Found');
    assert(!res404User.data.stack, '14.3 404 response excludes stack trace');

    // -------------------------------------------------------------
    // SECTION 15: SESSION EDGE CASES & TOKEN ROBUSTNESS
    // -------------------------------------------------------------
    console.log('\n--- 15. Session Edge Cases & Token Robustness ---');

    // 15.1 Token with extra harmless payload claims
    const tokenExtraClaims = jwt.sign(
      {
        userId: studentAlice.id,
        role: 'student',
        customOrganization: 'Computer Science Dept',
        loginMethod: 'oauth2_sso',
      },
      config.jwt.secret,
      { expiresIn: '1h', issuer: 'secure-exam-platform' }
    );
    const resExtraClaims = await request('GET', '/api/users/me', null, tokenExtraClaims);
    assert(resExtraClaims.status === 200, '15.1 Token with extra custom claims verified successfully');

    // 15.2 Token near expiration (5 seconds remaining)
    const tokenNearExpiry = jwt.sign(
      { userId: studentAlice.id, role: 'student' },
      config.jwt.secret,
      { expiresIn: '5s', issuer: 'secure-exam-platform' }
    );
    const resNearExpiry = await request('GET', '/api/users/me', null, tokenNearExpiry);
    assert(resNearExpiry.status === 200, '15.2 Token near expiration (5s) accepted before expiry');

    // 15.3 Numeric non-integer userId in token
    const tokenFloatUser = jwt.sign(
      { userId: 12.34, role: 'student' },
      config.jwt.secret,
      { expiresIn: '1h', issuer: 'secure-exam-platform' }
    );
    const resFloatUser = await request('GET', '/api/users/me', null, tokenFloatUser);
    assert(resFloatUser.status === 401, '15.3 Non-integer userId in token rejected with 401');

  } catch (err) {
    console.error('[UNEXPECTED SUITE ERROR]:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // SECTION 16: TEARDOWN & CLEAN BASELINE PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- 16. Teardown & Clean Baseline Preservation ---');

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

    // Delete test cases and problems for tracked problems
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
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

    // Verify clean baseline
    const uCount = await db.query('SELECT count(*) FROM users');
    const cCount = await db.query('SELECT count(*) FROM contests');
    const pCount = await db.query('SELECT count(*) FROM problems');
    const sCount = await db.query('SELECT count(*) FROM submissions');
    const rCount = await db.query('SELECT count(*) FROM rating_history');

    assert(parseInt(uCount.rows[0].count, 10) === 5, `16.1 Users count strictly at baseline (5 users, found ${uCount.rows[0].count})`);
    assert(parseInt(cCount.rows[0].count, 10) === 1, `16.2 Contests count strictly at baseline (1 contest, found ${cCount.rows[0].count})`);
    assert(parseInt(pCount.rows[0].count, 10) === 5, `16.3 Problems count strictly at baseline (5 problems, found ${pCount.rows[0].count})`);
    assert(parseInt(sCount.rows[0].count, 10) === 33, `16.4 Submissions count strictly at baseline (33 submissions, found ${sCount.rows[0].count})`);
    assert(parseInt(rCount.rows[0].count, 10) === 0, `16.5 Rating History count strictly at baseline (0 rows, found ${rCount.rows[0].count})`);

    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` Auth & RBAC Validation Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAuthRbacValidationSuite();
