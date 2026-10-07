/**
 * Phase 7.5.10.1 — Security Architecture & Threat Audit Test Suite
 *
 * Comprehensive end-to-end security architecture audit verifying:
 * 1. Authentication Boundary & Token Hardening (missing, malformed, expired, invalid sig, deactivated)
 * 2. RBAC & Privilege Escalation Defenses (student vs professor vs super_admin)
 * 3. Object-Level Authorization & BOLA/IDOR (contest ownership, problem ownership, submission code, participant results)
 * 4. Mass Assignment & Protected-Field Tampering (role, rating, status, snapshot, created_by)
 * 5. Input Validation & Parameter Boundaries (string IDs, negative IDs, zero, bounds, pagination clamps)
 * 6. SQL Injection Resistance (parameterized queries across search, filters, IDs, bodies)
 * 7. Contest State Machine Security (draft/upcoming/ended submission blocks, lifecycle mutation locks)
 * 8. Problem Privacy & Zero Hidden-Test Leakage (hidden tests never returned to students, draft problem privacy)
 * 9. Participant & Enrollment Security (unenrolled student submission block, unauthorized participant mutation)
 * 10. Submission Identity Protection (server-derived userId, spoofing ignored)
 * 11. Result & Rating Integrity (server-authoritative ratings, idempotency, mathematical invariants)
 * 12. Export Security & Formula Injection Defense (CSV formula injection defense, RBAC on exports)
 * 13. Audit Log Security & Sensitive Key Redaction (access restricted to super_admin, recursive redaction)
 * 14. Information Disclosure & Error Sanitization (zero password_hash in responses, production error sanitization)
 * 15. HTTP Security Headers & CORS Enforcement (Helmet headers, CORS restrictions)
 * 16. Teardown & Clean Baseline Preservation (strictly restores clean baseline)
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
const AuditLogger = require('./src/services/auditLogger');
const { generateToken, hashPassword } = require('./src/services/authService');
const { corsOptions } = require('./src/config/corsConfig');

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

async function createTestUser(role = 'student', usernamePrefix = 'sec_user') {
  const ts = Date.now() + '_' + Math.floor(Math.random() * 100000);
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

  trackedUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function runSecurityAuditSuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.1 — Security Architecture & Threat Audit Suite    ');
  console.log('================================================================\n');

  // Start ephemeral server
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
    // PART 1: AUTHENTICATION BOUNDARY AUDIT
    // -------------------------------------------------------------
    console.log('--- Part 1: Authentication Boundary Audit ---');

    // 1.1 Missing Authorization Header
    const noAuthRes = await request('GET', '/api/users/me');
    assert(noAuthRes.status === 401, '1.1 Missing auth header rejected with 401 Unauthorized');
    assert(noAuthRes.data && noAuthRes.data.error === 'AUTHENTICATION_ERROR', '1.1 Returns standardized AUTHENTICATION_ERROR contract');

    // 1.2 Malformed Authorization Header (no Bearer prefix)
    const badBearerRes = await request('GET', '/api/users/me', null, null, { Authorization: 'Basic dXNlcjpwYXNz' });
    assert(badBearerRes.status === 401, '1.2 Non-Bearer auth header rejected with 401 Unauthorized');

    // 1.3 Empty Bearer Token
    const emptyBearerRes = await request('GET', '/api/users/me', null, null, { Authorization: 'Bearer ' });
    assert(emptyBearerRes.status === 401, '1.3 Empty Bearer token rejected with 401 Unauthorized');

    // 1.4 Invalid Signature / Forged JWT
    const forgedToken = jwt.sign({ userId: 1, role: 'super_admin' }, 'wrong_secret_key_1234567890', { expiresIn: '1h' });
    const forgedRes = await request('GET', '/api/users/me', null, forgedToken);
    assert(forgedRes.status === 401, '1.4 Forged JWT with invalid signature rejected with 401 Unauthorized');

    // 1.5 Expired JWT
    const expiredToken = jwt.sign({ userId: 1, role: 'student' }, config.jwt.secret, { expiresIn: '-1s', issuer: 'secure-exam-platform' });
    const expiredRes = await request('GET', '/api/users/me', null, expiredToken);
    assert(expiredRes.status === 401, '1.5 Expired JWT token rejected with 401 Unauthorized');
    assert(expiredRes.data && expiredRes.data.message.includes('expired'), '1.5 Identifies token expiration specifically');

    // 1.6 Deactivated Account Token
    const { user: deactUser, token: deactToken } = await createTestUser('student', 'deact');
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [deactUser.id]);
    const deactRes = await request('GET', '/api/users/me', null, deactToken);
    assert(deactRes.status === 401, '1.6 Deactivated user account token rejected with 401 Unauthorized');

    // 1.7 Non-Existent User ID in Valid Token
    const ghostToken = jwt.sign({ userId: 999999999, role: 'student' }, config.jwt.secret, { expiresIn: '1h', issuer: 'secure-exam-platform' });
    const ghostRes = await request('GET', '/api/users/me', null, ghostToken);
    assert(ghostRes.status === 401, '1.7 Token for non-existent user rejected with 401 Unauthorized');

    // -------------------------------------------------------------
    // PART 2: RBAC & PRIVILEGE ESCALATION DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- Part 2: RBAC & Privilege Escalation Defenses ---');

    const { user: student1, token: studentToken1 } = await createTestUser('student', 'stud_rbac');
    const { user: prof1, token: profToken1 } = await createTestUser('professor', 'prof_rbac');
    const { user: superAdmin, token: adminToken } = await createTestUser('super_admin', 'admin_rbac');

    // 2.1 Student attempting to create contest
    const studContestRes = await request('POST', '/api/contests', { title: 'Illegal Student Contest' }, studentToken1);
    assert(studContestRes.status === 403, '2.1 Student blocked from POST /api/contests with 403 Forbidden');
    assert(studContestRes.data && studContestRes.data.error === 'AUTHORIZATION_ERROR', '2.1 Returns standardized AUTHORIZATION_ERROR');

    // 2.2 Student attempting to create problem
    const studProbRes = await request('POST', '/api/problems', { title: 'Illegal Problem', description: 'Desc' }, studentToken1);
    assert(studProbRes.status === 403, '2.2 Student blocked from POST /api/problems with 403 Forbidden');

    // 2.3 Student attempting to finalize ratings
    const studFinalizeRes = await request('POST', '/api/contests/147/finalize-ratings', {}, studentToken1);
    assert(studFinalizeRes.status === 403, '2.3 Student blocked from POST /api/contests/:id/finalize-ratings with 403 Forbidden');

    // 2.4 Student attempting to access Admin Audit Logs
    const studAuditRes = await request('GET', '/api/admin/audit-logs', null, studentToken1);
    assert(studAuditRes.status === 403, '2.4 Student blocked from GET /api/admin/audit-logs with 403 Forbidden');

    // 2.5 Professor attempting to access Admin Overview Stats
    const profAdminRes = await request('GET', '/api/admin/overview-stats', null, profToken1);
    assert(profAdminRes.status === 403, '2.5 Professor blocked from Super Admin overview-stats with 403 Forbidden');

    // 2.6 Professor attempting to access Admin User Management
    const profUsersRes = await request('GET', '/api/admin/users', null, profToken1);
    assert(profUsersRes.status === 403, '2.6 Professor blocked from Super Admin user management with 403 Forbidden');

    // 2.7 Super Admin granted access to administrative endpoints
    const adminStatsRes = await request('GET', '/api/admin/overview-stats', null, adminToken);
    assert(adminStatsRes.status === 200, '2.7 Super Admin authorized on /api/admin/overview-stats with 200 OK');

    // -------------------------------------------------------------
    // PART 3: OBJECT-LEVEL AUTHORIZATION & BOLA/IDOR
    // -------------------------------------------------------------
    console.log('\n--- Part 3: Object-Level Authorization & BOLA/IDOR ---');

    const { user: prof2, token: profToken2 } = await createTestUser('professor', 'prof_owner2');
    const { user: student2, token: studentToken2 } = await createTestUser('student', 'stud_victim');

    // Create a contest owned by Professor 1
    const contest1 = await ContestModel.createContest({
      title: 'Prof1 Contest ' + Date.now(),
      description: 'Test ownership',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      createdBy: prof1.id,
      isRated: true,
    });
    trackedContestIds.push(contest1.id);

    // 3.1 Professor 2 attempting to update Professor 1's contest
    const prof2UpdateContest = await request('PUT', `/api/contests/${contest1.id}`, { title: 'Hijacked Title' }, profToken2);
    assert(prof2UpdateContest.status === 403, '3.1 Professor 2 blocked with 403 from updating Professor 1 contest');

    // 3.2 Professor 2 attempting to publish Professor 1's contest
    const prof2PublishContest = await request('POST', `/api/contests/${contest1.id}/publish`, {}, profToken2);
    assert(prof2PublishContest.status === 403, '3.2 Professor 2 blocked with 403 from publishing Professor 1 contest');

    // 3.3 Professor 2 attempting to delete Professor 1's contest
    const prof2DeleteContest = await request('DELETE', `/api/contests/${contest1.id}`, null, profToken2);
    assert(prof2DeleteContest.status === 403, '3.3 Professor 2 blocked with 403 from deleting Professor 1 contest');

    // Create a problem owned by Professor 1
    const prob1 = await ProblemModel.createProblem({
      title: 'Prof1 Private Problem ' + Date.now(),
      description: 'Private problem desc',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      createdBy: prof1.id,
    });
    trackedProblemIds.push(prob1.id);

    // 3.4 Professor 2 attempting to update Professor 1's problem
    const prof2UpdateProb = await request('PUT', `/api/problems/${prob1.id}`, { title: 'Hijacked Problem' }, profToken2);
    assert(prof2UpdateProb.status === 403, '3.4 Professor 2 blocked with 403 from updating Professor 1 problem');

    // 3.5 Student 1 creating a submission; Student 2 attempting to view Student 1's source code
    const sub1 = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: null,
      problemId: 1797, // Two Sum baseline problem
      language: 'python',
      codingMode: 'full_program',
      sourceCode: 'print("student1 secret solution")',
      isSampleRun: false,
    });
    trackedSubmissionIds.push(sub1.id);

    const stud2ViewCode = await request('GET', `/api/submissions/${sub1.id}/code`, null, studentToken2);
    assert(stud2ViewCode.status === 403, '3.5 Student 2 blocked with 403 from viewing Student 1 submission source code');

    // 3.6 Student 2 attempting to view Student 1 submission verdict details
    const stud2ViewSub = await request('GET', `/api/submissions/${sub1.id}`, null, studentToken2);
    assert(stud2ViewSub.status === 403, '3.6 Student 2 blocked with 403 from inspecting Student 1 submission results');

    // 3.7 Student 1 can inspect their own submission details
    const stud1ViewOwnSub = await request('GET', `/api/submissions/${sub1.id}`, null, studentToken1);
    assert(stud1ViewOwnSub.status === 200, '3.7 Student 1 authorized on their own submission results with 200 OK');

    // -------------------------------------------------------------
    // PART 4: MASS ASSIGNMENT & PROTECTED-FIELD TAMPERING
    // -------------------------------------------------------------
    console.log('\n--- Part 4: Mass Assignment & Protected-Field Tampering ---');

    // 4.1 Student attempting to modify their own role via profile update
    const roleTamperRes = await request('PUT', '/api/users/me', {
      fullName: 'Hacked Name',
      role: 'super_admin',
      is_active: false,
      currentRating: 9999,
      highestRating: 9999,
    }, studentToken1);
    assert(roleTamperRes.status === 200, '4.1 Profile update request succeeds for valid fields');

    const freshUser1 = await UserModel.findUserById(student1.id);
    assert(freshUser1.role === 'student', '4.1 Server strictly preserved role as student (ignored role tampering)');
    assert((freshUser1.currentRating || freshUser1.current_rating) === 1200, '4.1 Server strictly preserved rating (ignored rating tampering)');
    assert(freshUser1.full_name === 'Hacked Name' || freshUser1.fullName === 'Hacked Name', '4.1 Whitelisted fullName updated successfully');

    // 4.2 Professor attempting to modify protected fields on contest update
    const contestTamperRes = await request('PUT', `/api/contests/${contest1.id}`, {
      title: 'Valid Updated Title',
      is_rating_finalized: true,
      ratings_finalized_at: new Date().toISOString(),
      created_by: prof2.id,
      final_results_snapshot: { fake: 'snapshot' },
    }, profToken1);
    assert(contestTamperRes.status === 200, '4.2 Contest update succeeds for permitted fields');

    const freshContest1 = await ContestModel.findContestById(contest1.id);
    assert(freshContest1.title === 'Valid Updated Title', '4.2 Title updated successfully');
    const isFinalizedVal = freshContest1.isRatingFinalized !== undefined ? freshContest1.isRatingFinalized : freshContest1.is_rating_finalized;
    assert(isFinalizedVal === false, '4.2 is_rating_finalized tampering strictly ignored');
    assert((freshContest1.createdBy || freshContest1.created_by) === prof1.id, '4.2 created_by ownership tampering strictly ignored');

    // -------------------------------------------------------------
    // PART 5: INPUT VALIDATION & PARAMETER BOUNDARIES
    // -------------------------------------------------------------
    console.log('\n--- Part 5: Input Validation & Parameter Boundaries ---');

    // 5.1 String/NaN contest ID
    const badContestId = await request('GET', '/api/contests/not-a-number', null, profToken1);
    assert(badContestId.status === 400, '5.1 String contest ID returns 400 Bad Request');

    // 5.2 Negative contest ID
    const negContestId = await request('GET', '/api/contests/-42/leaderboard', null, profToken1);
    assert(negContestId.status === 400, '5.2 Negative contest ID returns 400 Bad Request');

    // 5.3 String problem ID
    const badProblemId = await request('GET', '/api/problems/invalid-id', null, profToken1);
    assert(badProblemId.status === 400, '5.3 String problem ID returns 400 Bad Request');

    // 5.4 String submission ID
    const badSubId = await request('GET', '/api/submissions/abc', null, studentToken1);
    assert(badSubId.status === 400, '5.4 String submission ID returns 400 Bad Request');

    // 5.5 String user ID on rating history
    const badUserId = await request('GET', '/api/users/test_str/rating-history', null, studentToken1);
    assert(badUserId.status === 400, '5.5 String user ID on rating history returns 400 Bad Request');

    // 5.6 Excessive pagination limit clamped
    const hugePageRes = await request('GET', '/api/contests?limit=10000', null, profToken1);
    assert(hugePageRes.status === 200, '5.6 Large pagination query handled gracefully');
    if (hugePageRes.data && hugePageRes.data.pagination) {
      assert(hugePageRes.data.pagination.limit <= 100, '5.6 Pagination limit clamped to <= 100');
    }

    // -------------------------------------------------------------
    // PART 6: SQL INJECTION RESISTANCE
    // -------------------------------------------------------------
    console.log('\n--- Part 6: SQL Injection Resistance ---');

    // 6.1 SQL injection in search parameter
    const sqliSearch = await request('GET', "/api/contests?search=' OR 1=1 --", null, profToken1);
    assert(sqliSearch.status === 200, "6.1 Search parameter with ' OR 1=1 -- executed safely without error");

    // 6.2 SQL injection in problem search
    const sqliProb = await request('GET', "/api/problems?search='; DROP TABLE users; --", null, profToken1);
    assert(sqliProb.status === 200, '6.2 Problem search parameter with DROP TABLE injection executed safely');

    // 6.3 Verify table integrity remains intact
    const verifyUserTable = await db.query('SELECT count(*) FROM users');
    assert(parseInt(verifyUserTable.rows[0].count, 10) > 0, '6.3 Database users table fully intact post-injection attempts');

    // 6.4 SQL injection in route path parameter handled by parameter validator
    const sqliPath = await request('GET', "/api/contests/1' OR '1'='1", null, profToken1);
    assert(sqliPath.status === 400, '6.4 SQL injection in numeric path parameter intercepted by 400 validator');

    // -------------------------------------------------------------
    // PART 7: CONTEST STATE MACHINE SECURITY
    // -------------------------------------------------------------
    console.log('\n--- Part 7: Contest State Machine Security ---');

    // Draft contest
    const draftContest = await ContestModel.createContest({
      title: 'Draft Contest ' + Date.now(),
      startTime: new Date(Date.now() + 7200000),
      endTime: new Date(Date.now() + 10800000),
      createdBy: prof1.id,
      isRated: true,
    });
    trackedContestIds.push(draftContest.id);
    await ContestModel.addProblemToContest({ contestId: draftContest.id, problemId: 1797, points: 100 });

    // 7.1 Submission to draft contest rejected
    const draftSubRes = await request('POST', '/api/submissions', {
      contestId: draftContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print(1)',
    }, studentToken1);
    assert(draftSubRes.status === 400, '7.1 Submission to draft contest rejected with 400 Bad Request');

    // 7.2 Finalization of draft contest rejected
    const draftFinalizeRes = await request('POST', `/api/contests/${draftContest.id}/finalize-ratings`, {}, profToken1);
    assert(draftFinalizeRes.status === 400, '7.2 Finalization of draft contest rejected with 400 Bad Request');

    // Publish contest with future dates (Upcoming state)
    await ContestModel.updateContest(draftContest.id, {
      status: 'published',
      startTime: new Date(Date.now() + 3600000),
      endTime: new Date(Date.now() + 7200000),
    });

    // 7.3 Submission to upcoming contest rejected
    const upcomingSubRes = await request('POST', '/api/submissions', {
      contestId: draftContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print(1)',
    }, studentToken1);
    assert(upcomingSubRes.status === 400, '7.3 Submission to upcoming contest rejected with 400 Bad Request');

    // Ended contest
    const endedContest = await ContestModel.createContest({
      title: 'Ended Contest ' + Date.now(),
      startTime: new Date(Date.now() - 7200000),
      endTime: new Date(Date.now() - 3600000),
      createdBy: prof1.id,
      isRated: true,
    });
    trackedContestIds.push(endedContest.id);
    await ContestModel.updateContest(endedContest.id, { status: 'published' });
    await ContestModel.addProblemToContest({ contestId: endedContest.id, problemId: 1797, points: 100 });

    // 7.4 Submission to ended contest rejected
    const endedSubRes = await request('POST', '/api/submissions', {
      contestId: endedContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print(1)',
    }, studentToken1);
    assert(endedSubRes.status === 400, '7.4 Submission to ended contest rejected with 400 Bad Request');

    // 7.5 Adding problem to ended contest rejected with lifecycle lock
    const addProbEndedRes = await request('POST', `/api/contests/${endedContest.id}/problems`, {
      problemId: 1797,
      points: 100,
    }, profToken1);
    assert(addProbEndedRes.status === 409, '7.5 Adding problem to ended contest blocked with 409 Conflict');

    // -------------------------------------------------------------
    // PART 8: PROBLEM PRIVACY & ZERO HIDDEN-TEST LEAKAGE
    // -------------------------------------------------------------
    console.log('\n--- Part 8: Problem Privacy & Zero Hidden-Test Leakage ---');

    // Create problem with both sample and hidden test cases
    const privProb = await ProblemModel.createProblem({
      title: 'Privacy Problem ' + Date.now(),
      description: 'Test case privacy check',
      difficulty: 'hard',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
      createdBy: prof1.id,
    });
    trackedProblemIds.push(privProb.id);

    // Visible sample test case
    await TestCaseModel.createTestCase({
      problemId: privProb.id,
      inputData: 'sample input 1',
      expectedOutput: 'sample output 1',
      isHidden: false,
      isSample: true,
      testOrder: 1,
    });

    // Hidden private test case
    await TestCaseModel.createTestCase({
      problemId: privProb.id,
      inputData: 'SUPER_SECRET_HIDDEN_INPUT_xyz987',
      expectedOutput: 'SUPER_SECRET_HIDDEN_OUTPUT_xyz987',
      isHidden: true,
      isSample: false,
      testOrder: 2,
    });

    // 8.1 Student fetches problem details
    const studentProbRes = await request('GET', `/api/problems/${privProb.id}`, null, studentToken1);
    assert(studentProbRes.status === 200, '8.1 Student successfully retrieves published problem details');
    const probData = studentProbRes.data;
    assert(Array.isArray(probData.sampleTestCases), '8.1 sampleTestCases array is attached');
    assert(probData.sampleTestCases.length === 1, '8.1 Exactly 1 sample test case returned');
    assert(probData.sampleTestCases[0].inputData === 'sample input 1', '8.1 Sample test case content is intact');

    // Verify raw JSON response does not contain the secret hidden test string
    const rawStudentProbString = JSON.stringify(probData);
    assert(!rawStudentProbString.includes('SUPER_SECRET_HIDDEN_INPUT_xyz987'), '8.1 Hidden test case input NEVER leaked in problem response');
    assert(!rawStudentProbString.includes('SUPER_SECRET_HIDDEN_OUTPUT_xyz987'), '8.1 Hidden test case output NEVER leaked in problem response');

    // 8.2 Student attempting to access administrative test-case endpoints
    const studTestCasesRes = await request('GET', `/api/problems/${privProb.id}/test-cases`, null, studentToken1);
    assert(studTestCasesRes.status === 403, '8.2 Student blocked with 403 from administrative test-cases endpoint');

    // 8.3 Draft unpublished problem returns 404 to students
    const draftProb = await ProblemModel.createProblem({
      title: 'Draft Problem ' + Date.now(),
      description: 'Draft desc',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      isPublished: false,
      createdBy: prof1.id,
    });
    trackedProblemIds.push(draftProb.id);

    const studDraftProbRes = await request('GET', `/api/problems/${draftProb.id}`, null, studentToken1);
    assert(studDraftProbRes.status === 404, '8.3 Private unpublished problem returns 404 Not Found to unauthorized students');

    // -------------------------------------------------------------
    // PART 9: PARTICIPANT & ENROLLMENT SECURITY
    // -------------------------------------------------------------
    console.log('\n--- Part 9: Participant & Enrollment Security ---');

    // Running contest owned by Prof 1
    const runContest = await ContestModel.createContest({
      title: 'Running Contest ' + Date.now(),
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      createdBy: prof1.id,
      isRated: true,
    });
    trackedContestIds.push(runContest.id);
    await ContestModel.updateContest(runContest.id, { status: 'published' });
    await ContestModel.addProblemToContest({ contestId: runContest.id, problemId: 1797, points: 100 });

    // 9.1 Unenrolled student submitting to running contest
    const unenrolledSub = await request('POST', '/api/submissions', {
      contestId: runContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print("unenrolled")',
    }, studentToken1);
    assert(unenrolledSub.status === 403, '9.1 Unenrolled student blocked from submitting with 403 Forbidden');

    // 9.2 Unauthorized professor adding participants to another professor's contest
    const unauthAddPart = await request('POST', `/api/contests/${runContest.id}/participants`, {
      userId: student1.id,
    }, profToken2);
    assert(unauthAddPart.status === 403, '9.2 Unauthorized professor blocked with 403 from adding participants');

    // -------------------------------------------------------------
    // PART 10: SUBMISSION IDENTITY PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- Part 10: Submission Identity Protection ---');

    // Enroll student 1
    await ContestModel.addParticipant(runContest.id, student1.id);

    // 10.1 Student 1 submits while trying to spoof userId in payload
    const spoofSub = await request('POST', '/api/submissions', {
      contestId: runContest.id,
      problemId: 1797,
      language: 'python',
      sourceCode: 'print("student 1")',
      userId: student2.id, // spoof attempt!
    }, studentToken1);
    assert(spoofSub.status === 200 || spoofSub.status === 201, '10.1 Submission created successfully');

    const subId = spoofSub.data?.submission?.id || spoofSub.data?.runResult?.id;
    if (subId) {
      trackedSubmissionIds.push(subId);
      const subRecord = await SubmissionModel.findSubmissionById(subId);
      assert(subRecord && subRecord.userId === student1.id, '10.1 Server strictly bound submission to authenticated student1 (spoofed userId ignored)');
      // Mark submission as accepted so finalization won't be blocked by pending evaluations
      await db.query("UPDATE submissions SET status = 'accepted', score = 100 WHERE id = $1", [subId]);
    } else {
      assert(false, '10.1 Failed to obtain submission id from response');
    }

    // -------------------------------------------------------------
    // PART 11: RESULT & RATING INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- Part 11: Result & Rating Integrity ---');

    // End runContest for finalization via direct SQL transition
    await db.query('UPDATE contests SET start_time = $1, end_time = $2 WHERE id = $3', [
      new Date(Date.now() - 7200000),
      new Date(Date.now() - 3600000),
      runContest.id,
    ]);

    // 11.1 Client sending forged rating changes in finalization request body
    const finalizeTamperRes = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {
      ratings: [
        { userId: student1.id, ratingChange: 500, newRating: 9999 },
      ],
      isRated: false,
    }, profToken1);
    assert(finalizeTamperRes.status === 200, '11.1 Finalization succeeded');
    assert(finalizeTamperRes.data && finalizeTamperRes.data.isRated === true, '11.1 Server maintained authoritative isRated: true');

    // 11.2 Check rating history was strictly server calculated
    const history1 = await RatingModel.getRatingHistoryByUser(student1.id);
    assert(history1.length === 1, '11.2 Exactly 1 rating_history entry generated');
    const h = history1[0];
    assert(h.newRating !== 9999, '11.2 Client forged rating 9999 was strictly ignored');
    assert(h.previousRating + h.ratingChange === h.newRating, '11.2 Mathematical invariant prev + delta = new holds strictly');

    // 11.3 Repeated finalization idempotency
    const repeatFinalize = await request('POST', `/api/contests/${runContest.id}/finalize-ratings`, {}, profToken1);
    assert(repeatFinalize.status === 200, '11.3 Repeated finalization returns 200 OK');
    assert(repeatFinalize.data && repeatFinalize.data.alreadyFinalized === true, '11.3 Confirms alreadyFinalized: true');

    const historyAfterRepeat = await RatingModel.getRatingHistoryByUser(student1.id);
    assert(historyAfterRepeat.length === 1, '11.3 Zero duplicate rating history rows generated');

    // -------------------------------------------------------------
    // PART 12: EXPORT SECURITY & FORMULA INJECTION DEFENSE
    // -------------------------------------------------------------
    console.log('\n--- Part 12: Export Security & Formula Injection Defense ---');

    // 12.1 Student attempting to export administrative contest results
    const studExportRes = await request('GET', `/api/contests/${runContest.id}/export/results`, null, studentToken1);
    assert(studExportRes.status === 403, '12.1 Student blocked with 403 from administrative contest results export');

    // 12.2 Student attempting to export all participants
    const studExportParts = await request('GET', `/api/contests/${runContest.id}/export/participants`, null, studentToken1);
    assert(studExportParts.status === 403, '12.2 Student blocked with 403 from administrative participants export');

    // 12.3 Professor exporting results in CSV format
    const profExportCsv = await request('GET', `/api/contests/${runContest.id}/export/results?format=csv`, null, profToken1);
    assert(profExportCsv.status === 200, '12.3 Professor authorized to export results as CSV');
    assert(typeof profExportCsv.data === 'string', '12.3 Returns raw CSV string');

    // Verify zero password hashes or secrets in CSV
    assert(!profExportCsv.data.includes('password_hash'), '12.3 Zero password_hash in CSV export');
    assert(!profExportCsv.data.includes('$2a$'), '12.3 Zero bcrypt hash prefixes in CSV export');

    // 12.4 Formula injection unit verification
    const { escapeCsv } = require('./src/services/contestExportService');
    const formulaPayloads = ['=cmd|', '-2+3', '+cmd', '@SUM(A1:A10)', '\t=DDE', '\r=EXEC'];
    for (const f of formulaPayloads) {
      const sanitized = escapeCsv(f);
      assert(sanitized.startsWith("\"'") || sanitized.startsWith("'"), `12.4 Formula trigger '${f}' neutralized with leading single quote`);
    }

    // -------------------------------------------------------------
    // PART 13: AUDIT LOG SECURITY & SENSITIVE KEY REDACTION
    // -------------------------------------------------------------
    console.log('\n--- Part 13: Audit Log Security & Sensitive Key Redaction ---');

    // 13.1 Non-super-admin accessing audit logs
    const nonAdminAudit = await request('GET', '/api/admin/audit-logs', null, profToken1);
    assert(nonAdminAudit.status === 403, '13.1 Professor blocked with 403 from audit-logs');

    // 13.2 Metadata sanitizer recursive redaction test
    const dirtyMetadata = {
      user_password: 'super_secret_password',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      jwt_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      apiKey: 'sk-1234567890',
      source_code: 'def secret(): pass',
      normalField: 'safe_value',
      nested: {
        token: 'secret_nested_token',
        nestedSafe: 12345,
      },
    };

    const cleanMetadata = AuditLogger.sanitize(dirtyMetadata);
    assert(cleanMetadata.user_password === undefined, '13.2 user_password key omitted');
    assert(cleanMetadata.passwordHash === undefined, '13.2 passwordHash key omitted');
    assert(cleanMetadata.jwt_token === undefined, '13.2 jwt_token key omitted');
    assert(cleanMetadata.apiKey === undefined, '13.2 apiKey key omitted');
    assert(cleanMetadata.source_code === undefined, '13.2 source_code key omitted');
    assert(cleanMetadata.normalField === 'safe_value', '13.2 safe field preserved');
    assert(cleanMetadata.nested.token === undefined, '13.2 nested token key omitted');
    assert(cleanMetadata.nested.nestedSafe === 12345, '13.2 nested safe field preserved');

    // -------------------------------------------------------------
    // PART 14: INFORMATION DISCLOSURE & ERROR SANITIZATION
    // -------------------------------------------------------------
    console.log('\n--- Part 14: Information Disclosure & Error Sanitization ---');

    // 14.1 Login response excludes password_hash
    const loginRes = await request('POST', '/api/auth/login', {
      username: student1.username,
      password: 'SecurePass123!',
    });
    assert(loginRes.status === 200, '14.1 Login succeeds');
    const loginString = JSON.stringify(loginRes.data);
    assert(!loginString.includes('password_hash'), '14.1 Login response strictly excludes password_hash');
    assert(!loginString.includes('$2a$'), '14.1 Login response strictly excludes bcrypt hash');

    // 14.2 Profile /me response excludes password_hash
    const meRes = await request('GET', '/api/users/me', null, studentToken1);
    assert(meRes.status === 200, '14.2 Profile /me succeeds');
    const meString = JSON.stringify(meRes.data);
    assert(!meString.includes('password_hash'), '14.2 Profile /me response strictly excludes password_hash');

    // 14.3 Error handling does not leak stack traces in test/prod
    const errRes = await request('GET', '/api/users/999999999/rating', null, studentToken1);
    assert(errRes.status === 404, '14.3 Non-existent user rating returns 404 Not Found');
    assert(!errRes.data.stack, '14.3 Error response strictly excludes stack trace');

    // -------------------------------------------------------------
    // PART 15: HTTP SECURITY HEADERS & CORS ENFORCEMENT
    // -------------------------------------------------------------
    console.log('\n--- Part 15: HTTP Security Headers & CORS Enforcement ---');

    const headersRes = await request('GET', '/api/health');
    assert(headersRes.status === 200, '15.1 Health check responds 200 OK');

    // Check Helmet security headers
    const hHeaders = headersRes.headers;
    assert(hHeaders['x-content-type-options'] === 'nosniff', '15.2 X-Content-Type-Options: nosniff present');
    assert(hHeaders['x-frame-options'] === 'SAMEORIGIN' || hHeaders['content-security-policy'] !== undefined, '15.3 Frame protection or CSP present');

    // 15.4 CORS policy rejects disallowed foreign origin
    const corsPromise = new Promise((resolve) => {
      corsOptions.origin('https://malicious-attacker-domain.xyz', (err, allowed) => {
        resolve({ err, allowed });
      });
    });
    const corsResult = await corsPromise;
    assert(corsResult.err !== null || corsResult.allowed === false, '15.4 CORS policy rejects unauthorized external origin');

    // 15.5 CORS policy permits configured localhost origin
    const corsLocalPromise = new Promise((resolve) => {
      corsOptions.origin('http://localhost:5173', (err, allowed) => {
        resolve({ err, allowed });
      });
    });
    const corsLocalResult = await corsLocalPromise;
    assert(corsLocalResult.err === null && corsLocalResult.allowed === true, '15.5 CORS policy authorizes trusted local frontend origin');

  } catch (err) {
    console.error('[UNEXPECTED TEST ERROR]', err);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // PART 16: TEARDOWN & CLEAN BASELINE PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- Part 16: Teardown & Clean Baseline Preservation ---');

    // Delete tracked submissions
    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1::int[])', [trackedSubmissionIds]);
    }

    // Delete rating history and submissions for tracked contests/users
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [trackedContestIds]);
    }

    // Delete tracked test cases and problems
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1::int[])', [trackedProblemIds]);
    }

    // Delete tracked audit logs and users
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM rating_history WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM contest_participants WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [trackedUserIds]);
    }

    // Verify baseline counts
    const usersCount = await db.query('SELECT count(*) FROM users');
    const contestsCount = await db.query('SELECT count(*) FROM contests');
    const problemsCount = await db.query('SELECT count(*) FROM problems');
    const subsCount = await db.query('SELECT count(*) FROM submissions');
    const historyCount = await db.query('SELECT count(*) FROM rating_history');

    assert(parseInt(usersCount.rows[0].count, 10) === 5, `16.1 Users table preserved at exact baseline (5 users, found ${usersCount.rows[0].count})`);
    assert(parseInt(contestsCount.rows[0].count, 10) === 1, `16.2 Contests table preserved at exact baseline (1 contest, found ${contestsCount.rows[0].count})`);
    assert(parseInt(problemsCount.rows[0].count, 10) === 5, `16.3 Problems table preserved at exact baseline (5 problems, found ${problemsCount.rows[0].count})`);
    assert(parseInt(subsCount.rows[0].count, 10) === 33, `16.4 Submissions table preserved at exact baseline (33 submissions, found ${subsCount.rows[0].count})`);
    assert(parseInt(historyCount.rows[0].count, 10) === 0, `16.5 Rating history table preserved at exact baseline (0 rows, found ${historyCount.rows[0].count})`);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` Security Audit Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityAuditSuite();
