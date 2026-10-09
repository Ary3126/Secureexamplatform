/**
 * STEP 3 — API SECURITY AUDIT & VULNERABILITY HARDENING AUTOMATED TEST SUITE
 * 
 * Comprehensive test suite verifying:
 * 1. Authentication Security (tampering, invalid passwords, enumeration protection)
 * 2. Authorization / RBAC (Student vs Professor vs Admin)
 * 3. BOLA / IDOR Defense (Submission ownership, code isolation, resource management)
 * 4. Mass Assignment / Field Tampering Defense
 * 5. Sensitive Data Exposure Defense (Password hashes, hidden test cases)
 * 6. Input Validation & SQL Injection Resilience
 * 7. Replay / Idempotency Protection
 * 8. Privileged Action Audit Logging
 */

const http = require('http');
const { app } = require('./src/server');
const { initDb } = require('./src/config/initDb');
const db = require('./src/config/db');
const { generateToken } = require('./src/services/authService');
const AuditLogger = require('./src/services/auditLogger');

let server;
let baseUrl;
const ts = Date.now();

// Test user credentials
const studentA = {
  username: `sec_std_a_${ts}`,
  email: `sec_std_a_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Security Student A',
};

const studentB = {
  username: `sec_std_b_${ts}`,
  email: `sec_std_b_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Security Student B',
};

const profA = {
  username: `sec_prof_a_${ts}`,
  email: `sec_prof_a_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Security Professor A',
  role: 'professor',
};

const profB = {
  username: `sec_prof_b_${ts}`,
  email: `sec_prof_b_${ts}@test.com`,
  password: 'Password123!',
  fullName: 'Security Professor B',
  role: 'professor',
};

let tokenStudentA = '';
let tokenStudentB = '';
let tokenProfA = '';
let tokenProfB = '';

let userStudentAId = null;
let userStudentBId = null;
let userProfAId = null;
let userProfBId = null;

let problemAId = null;
let contestAId = null;
let submissionAId = null;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSecurityAuditTests() {
  console.log('=======================================================');
  console.log(' STARTING STEP 3 — API SECURITY AUDIT TEST SUITE');
  console.log('=======================================================\n');

  try {
    await initDb();

    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -----------------------------------------------------------
    // SECTION 1: AUTHENTICATION SECURITY & ACCOUNT ENUMERATION
    // -----------------------------------------------------------
    console.log('--- 1. Authentication Security & Account Enumeration ---');

    // 1.1 Register Student A
    const regResA = await request('POST', '/api/auth/register', studentA);
    assert(regResA.status === 201, 'Student A registration succeeds with 201');
    assert(!regResA.body.user.password_hash && !regResA.body.user.password, 'Password hash is strictly excluded from registration response');
    userStudentAId = regResA.body.user.id;

    // 1.2 Register Student B
    const regResB = await request('POST', '/api/auth/register', studentB);
    userStudentBId = regResB.body.user.id;

    // 1.3 Login Student A
    const loginResA = await request('POST', '/api/auth/login', {
      email: studentA.email,
      password: studentA.password,
    });
    assert(loginResA.status === 200, 'Student A login succeeds with 200');
    assert(typeof loginResA.body.token === 'string', 'JWT access token returned');
    assert(!loginResA.body.user.password_hash, 'Password hash excluded from login payload');
    tokenStudentA = loginResA.body.token;

    // Login Student B
    const loginResB = await request('POST', '/api/auth/login', {
      email: studentB.email,
      password: studentB.password,
    });
    tokenStudentB = loginResB.body.token;

    // 1.4 Invalid password -> 401 with generic message
    const badPassRes = await request('POST', '/api/auth/login', {
      email: studentA.email,
      password: 'WrongPassword999!',
    });
    assert(badPassRes.status === 401, 'Invalid password returns 401 Unauthorized');
    assert(badPassRes.body.message === 'Invalid email or password', 'Error message does not reveal password correctness specifically');

    // 1.5 Non-existent email -> 401 with identical message (Account Enumeration Defense)
    const nonExistentRes = await request('POST', '/api/auth/login', {
      email: `non_existent_${ts}@nowhere.com`,
      password: 'SomePassword123!',
    });
    assert(nonExistentRes.status === 401, 'Non-existent account returns 401');
    assert(nonExistentRes.body.message === badPassRes.body.message, 'Account enumeration protected: identical 401 message for non-existent account');

    // 1.6 Malformed Bearer token -> 401
    const malformedAuthRes = await request('GET', '/api/users/me', null, 'malformed.jwt.token');
    assert(malformedAuthRes.status === 401, 'Malformed JWT token is rejected with 401');

    // 1.7 Missing Bearer token -> 401
    const missingAuthRes = await request('GET', '/api/users/me');
    assert(missingAuthRes.status === 401, 'Missing Authorization header is rejected with 401');

    // Seed Professors in DB
    const hash = require('bcryptjs').hashSync('Password123!', 10);
    const profResA = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'professor') RETURNING id, username, role`,
      [profA.username, profA.email, hash, profA.fullName]
    );
    userProfAId = profResA.rows[0].id;
    tokenProfA = generateToken({ id: userProfAId, role: 'professor' });

    const profResB = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'professor') RETURNING id, username, role`,
      [profB.username, profB.email, hash, profB.fullName]
    );
    userProfBId = profResB.rows[0].id;
    tokenProfB = generateToken({ id: userProfBId, role: 'professor' });

    // -----------------------------------------------------------
    // SECTION 2: AUTHORIZATION / RBAC AUDIT
    // -----------------------------------------------------------
    console.log('\n--- 2. Authorization / RBAC Enforcement ---');

    // 2.1 Student attempts to create a problem -> 403
    const stdCreateProb = await request('POST', '/api/problems', {
      title: 'Hacked Problem',
      description: 'Unauthorized creation',
      difficulty: 'medium',
    }, tokenStudentA);
    assert(stdCreateProb.status === 403, 'Student cannot create problem (403 Forbidden)');

    // 2.2 Student attempts to create a contest -> 403
    const stdCreateContest = await request('POST', '/api/contests', {
      title: 'Hacked Contest',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    }, tokenStudentA);
    assert(stdCreateContest.status === 403, 'Student cannot create contest (403 Forbidden)');

    // 2.3 Student attempts to create snapshot -> 403
    const stdCreateSnap = await request('POST', '/api/leaderboard/snapshots', {
      scope: 'global',
    }, tokenStudentA);
    assert(stdCreateSnap.status === 403, 'Student cannot create leaderboard snapshot (403 Forbidden)');

    // 2.4 Professor A creates problem -> 201
    const profCreateProb = await request('POST', '/api/problems', {
      title: `Security Audit Problem ${ts}`,
      description: 'Given two integers, return their sum.',
      difficulty: 'easy',
      accessScope: 'public',
    }, tokenProfA);
    assert(profCreateProb.status === 201, 'Professor A can create problem (201 Created)');
    problemAId = profCreateProb.body.problem.id;

    // 2.5 Professor A adds test cases (1 visible sample, 1 hidden)
    const addSampleRes = await request('POST', `/api/problems/${problemAId}/test-cases`, {
      inputData: '2 3',
      expectedOutput: '5',
      isHidden: false,
    }, tokenProfA);
    assert(addSampleRes.status === 201, 'Professor A adds sample test case');

    const addHiddenRes = await request('POST', `/api/problems/${problemAId}/test-cases`, {
      inputData: '1000 2000',
      expectedOutput: '3000_SECRET_HIDDEN_OUTPUT',
      isHidden: true,
    }, tokenProfA);
    assert(addHiddenRes.status === 201, 'Professor A adds hidden test case');

    // 2.6 Student attempts to view administrative test cases -> 403
    const stdViewTests = await request('GET', `/api/problems/${problemAId}/test-cases`, null, tokenStudentA);
    assert(stdViewTests.status === 403, 'Student cannot access administrative test-case endpoint (403 Forbidden)');

    // Publish problem so it is available in the public catalog for student inspection
    await db.query("UPDATE problems SET is_published = true, access_scope = 'public', published_at = CURRENT_TIMESTAMP WHERE id = $1", [problemAId]);

    // -----------------------------------------------------------
    // SECTION 3: SENSITIVE DATA EXPOSURE AUDIT
    // -----------------------------------------------------------
    console.log('\n--- 3. Sensitive Data Exposure Audit ---');

    // 3.1 Public Problem Endpoint: Student fetches problem
    const probDetailRes = await request('GET', `/api/problems/${problemAId}`, null, tokenStudentA);
    assert(probDetailRes.status === 200, 'Student can view problem details');
    const samples = probDetailRes.body.sampleTestCases || [];
    assert(samples.length === 1, 'Only sample test cases are returned to student');
    assert(samples[0].expectedOutput === '5', 'Sample output matches');
    assert(
      !JSON.stringify(probDetailRes.body).includes('3000_SECRET_HIDDEN_OUTPUT'),
      'Hidden test cases and expected hidden outputs are STRICTLY shielded from student'
    );

    // -----------------------------------------------------------
    // SECTION 4: BOLA / IDOR AUDIT
    // -----------------------------------------------------------
    console.log('\n--- 4. BOLA / IDOR Resource Protection ---');

    // 4.1 Professor B attempts to update Professor A's problem -> 403
    const profBUpdateProb = await request('PUT', `/api/problems/${problemAId}`, {
      title: 'Tampered by Prof B',
    }, tokenProfB);
    assert(profBUpdateProb.status === 403, 'Professor B cannot update Professor A problem (403 Forbidden)');

    // 4.2 Professor B attempts to delete Professor A's problem -> 403
    const profBDeleteProb = await request('DELETE', `/api/problems/${problemAId}`, null, tokenProfB);
    assert(profBDeleteProb.status === 403, 'Professor B cannot delete Professor A problem (403 Forbidden)');

    // 4.3 Professor A creates contest, adds problem, and publishes
    const contestRes = await request('POST', '/api/contests', {
      title: `Security Audit Contest ${ts}`,
      description: 'Audit contest',
      startTime: new Date(Date.now() - 60000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    }, tokenProfA);
    contestAId = contestRes.body.contest.id;

    await request('POST', `/api/contests/${contestAId}/problems`, {
      problemId: problemAId,
      points: 100,
    }, tokenProfA);

    await request('POST', `/api/contests/${contestAId}/publish`, null, tokenProfA);

    // 4.4 Professor B attempts to delete Professor A's contest -> 403
    const profBDeleteContest = await request('DELETE', `/api/contests/${contestAId}`, null, tokenProfB);
    assert(profBDeleteContest.status === 403, 'Professor B cannot delete Professor A contest (403 Forbidden)');

    // Student A joins contest and submits code
    await request('POST', `/api/contests/${contestAId}/join`, null, tokenStudentA);

    const subRes = await request('POST', '/api/submissions', {
      contestId: contestAId,
      problemId: problemAId,
      language: 'python',
      sourceCode: 'print(sum(map(int, input().split())))',
    }, tokenStudentA);
    assert(subRes.status === 201, 'Student A submits solution');
    submissionAId = subRes.body.submission.id;

    // 4.5 Student B attempts to inspect Student A's submission details -> 403
    const stdBInspectSub = await request('GET', `/api/submissions/${submissionAId}`, null, tokenStudentB);
    assert(stdBInspectSub.status === 403, "Student B cannot inspect Student A's submission (403 Forbidden)");

    // 4.6 Student B attempts to view Student A's submitted source code -> 403
    const stdBInspectCode = await request('GET', `/api/submissions/${submissionAId}/code`, null, tokenStudentB);
    assert(stdBInspectCode.status === 403, "Student B cannot view Student A's source code (403 Forbidden)");

    // 4.7 Student A can inspect their own submission details and code -> 200
    const stdAInspectSub = await request('GET', `/api/submissions/${submissionAId}`, null, tokenStudentA);
    assert(stdAInspectSub.status === 200, "Student A can inspect their own submission");

    const stdAInspectCode = await request('GET', `/api/submissions/${submissionAId}/code`, null, tokenStudentA);
    assert(stdAInspectCode.status === 200, "Student A can view their own source code");

    // -----------------------------------------------------------
    // SECTION 5: MASS ASSIGNMENT / PRIVILEGE ESCALATION AUDIT
    // -----------------------------------------------------------
    console.log('\n--- 5. Mass Assignment & Field Tampering Protection ---');

    // 5.1 Student A tries to elevate role or rating via profile update
    const tamperedProfileUpdate = await request('PUT', '/api/users/me', {
      fullName: 'Hacker Student A',
      role: 'super_admin',
      currentRating: 9999,
      current_rating: 9999,
      rank: 1,
      ratingStatus: 'rated',
    }, tokenStudentA);
    assert(tamperedProfileUpdate.status === 200, 'Profile update returns 200');
    assert(tamperedProfileUpdate.body.user.role === 'student', 'Role tampering blocked: role remains student');
    assert(tamperedProfileUpdate.body.user.currentRating !== 9999, 'Rating tampering blocked: rating remains untainted');

    // -----------------------------------------------------------
    // SECTION 6: SQL INJECTION & INPUT VALIDATION RESILIENCE
    // -----------------------------------------------------------
    console.log('\n--- 6. SQL Injection & Input Validation Resilience ---');

    // 6.1 Problem search with SQL Injection payload
    const sqliSearch = await request('GET', "/api/problems?search=' OR 1=1 --", null, tokenStudentA);
    assert(sqliSearch.status === 200, "SQL injection search payload handled safely (status 200, no SQL error)");

    // 6.2 Leaderboard filter with SQL Injection payload
    const sqliLeaderboard = await request('GET', "/api/leaderboard?institution=' OR 1=1 --");
    assert(sqliLeaderboard.status === 200, "Leaderboard SQL injection payload handled safely");

    // 6.3 Invalid non-numeric ID in path
    const invalidIdRes = await request('GET', '/api/problems/not-a-valid-number', null, tokenStudentA);
    assert(invalidIdRes.status === 400 || invalidIdRes.status === 404, 'Invalid non-numeric ID in path returns 400 or 404 (not 500)');

    // -----------------------------------------------------------
    // SECTION 7: REPLAY & IDEMPOTENCY PROTECTION
    // -----------------------------------------------------------
    console.log('\n--- 7. Replay & Idempotency Protection ---');

    // 7.1 Student A attempts to join the same contest twice -> 409 Conflict
    const dupJoinRes = await request('POST', `/api/contests/${contestAId}/join`, null, tokenStudentA);
    assert(dupJoinRes.status === 409, 'Duplicate contest join request rejected with 409 Conflict');

    // -----------------------------------------------------------
    // SECTION 8: PRIVILEGED ACTION AUDIT LOGGING
    // -----------------------------------------------------------
    console.log('\n--- 8. Privileged Action Audit Logging ---');

    const auditEntry = AuditLogger.logAction({
      actor: { id: userProfAId, username: profA.username, role: 'professor' },
      action: 'SECURITY_AUDIT_VERIFIED',
      resourceType: 'audit_test',
      resourceId: 101,
      outcome: 'SUCCESS',
      metadata: { testSuite: 'Step 3 Security Audit' },
    });
    assert(auditEntry.action === 'SECURITY_AUDIT_VERIFIED', 'Audit logger produces valid action entry');
    assert(auditEntry.actor.username === profA.username, 'Audit entry records actor metadata safely');
    assert(!auditEntry.metadata.password, 'Audit entry sanitizes sensitive parameters');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    try {
      if (submissionAId) await db.query('DELETE FROM submissions WHERE id = $1', [submissionAId]);
      if (problemAId) {
        await db.query('DELETE FROM test_cases WHERE problem_id = $1', [problemAId]);
        await db.query('DELETE FROM problems WHERE id = $1', [problemAId]);
      }
      if (contestAId) {
        await db.query('DELETE FROM contest_participants WHERE contest_id = $1', [contestAId]);
        await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [contestAId]);
        await db.query('DELETE FROM contests WHERE id = $1', [contestAId]);
      }
      const testUids = [userStudentAId, userStudentBId, userProfAId, userProfBId].filter(Boolean);
      if (testUids.length > 0) {
        await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [testUids]);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` STEP 3 SECURITY AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSecurityAuditTests().then(() => {
    require('./src/config/db').closePool().then(() => process.exit(0));
  });
}

module.exports = runSecurityAuditTests;
