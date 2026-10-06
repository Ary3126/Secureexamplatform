/**
 * CODEFROG — Complete New Admin Panel Baseline Test Suite
 * File: backend/test_admin_clean_baseline.js
 *
 * Verifies every aspect of the recently redeveloped Admin Panel:
 * 1. Authentication & RBAC
 * 2. Dashboard API
 * 3. User Management APIs
 * 4. Problem Bank APIs
 * 5. Contest Management APIs
 * 6. Security & Audit Log APIs
 * 7. System Health & Observability APIs
 * 8. Problem Review Governance APIs
 * 9. Test Data Archive APIs
 * 10. Self-Cleanup with Zero Residual Test Data
 */

const http = require('http');
const { app } = require('./src/server');
const { pool, closePool } = require('./src/config/db');
const { generateToken } = require('./src/services/authService');
const { generateTestRunId, markTestData, cleanupTestRun } = require('./src/utils/testCleanupHelper');

let server;
let baseUrl;
let passed = 0;
let failed = 0;

function record(name, condition, details = '') {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runBaselineTests() {
  console.log('===============================================================');
  console.log(' STARTING NEW ADMIN PANEL CLEAN BASELINE VERIFICATION');
  console.log('===============================================================\n');

  const suiteRunId = generateTestRunId('admin_baseline');
  const ts = Date.now();

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log(`Admin validation server running at ${baseUrl}`);

    // Generate tokens for each role
    const superAdminToken = generateToken({ id: 3, role: 'super_admin', username: 'platform_admin' });
    const studentToken = generateToken({ id: 2, role: 'student', username: 'student_seed' });
    const profToken = generateToken({ id: 1093, role: 'professor', username: 'prof_alan' });

    // -------------------------------------------------------------------------
    // SECTION 1: Authentication & RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Authentication & RBAC Enforcement ---');

    // 1.1 Unauthenticated access is rejected with 401
    const resNoAuth = await request('GET', '/api/admin/overview-stats');
    record('TEST 1.1: Unauthenticated request rejected with 401 Unauthorized', resNoAuth.status === 401);

    // 1.2 Student access is rejected with 403
    const resStudent = await request('GET', '/api/admin/overview-stats', null, studentToken);
    record('TEST 1.2: Student role rejected with 403 Forbidden', resStudent.status === 403);

    // 1.3 Professor access is rejected with 403
    const resProf = await request('GET', '/api/admin/overview-stats', null, profToken);
    record('TEST 1.3: Professor role rejected with 403 Forbidden', resProf.status === 403);

    // 1.4 Super Admin access succeeds with 200
    const resSuper = await request('GET', '/api/admin/overview-stats', null, superAdminToken);
    record('TEST 1.4: Super Admin access authorized with 200 OK', resSuper.status === 200);

    // -------------------------------------------------------------------------
    // SECTION 2: Platform Dashboard API
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Platform Dashboard API ---');

    record('TEST 2.1: Overview stats returns valid payload', resSuper.body?.status === 'success' && !!resSuper.body?.data);
    const dashData = resSuper.body?.data || {};
    record('TEST 2.2: Overview stats contains users metrics', dashData.users !== undefined);
    record('TEST 2.3: Overview stats contains problems metrics', dashData.problems !== undefined);
    record('TEST 2.4: Overview stats contains contests metrics', dashData.contests !== undefined);
    record('TEST 2.5: Overview stats contains system metrics', dashData.system !== undefined && dashData.system.databaseStatus === 'connected');

    // -------------------------------------------------------------------------
    // SECTION 3: User Management APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 3. User Management APIs ---');

    // 3.1 List users
    const resUsers = await request('GET', '/api/admin/users?limit=50', null, superAdminToken);
    record('TEST 3.1: List users returns 200 OK', resUsers.status === 200);
    const usersList = resUsers.body?.data?.users || [];
    record('TEST 3.2: Returns exactly 5 clean users', usersList.length === 5);

    // 3.2 Get user details
    const resUserDetail = await request('GET', '/api/admin/users/3', null, superAdminToken);
    record('TEST 3.3: Get single user detail returns 200 OK', resUserDetail.status === 200);
    record('TEST 3.4: User detail returns platform_admin', resUserDetail.body?.data?.user?.username === 'platform_admin');

    // 3.3 Create temporary user (with explicit test tagging)
    const newUserData = {
      username: `tmp_admin_user_${ts}`,
      email: `tmp_user_${ts}@test.com`,
      password: 'TemporaryPassword123!',
      fullName: 'Temporary Admin User',
      role: 'student',
    };
    const resCreateUser = await request('POST', '/api/admin/users', newUserData, superAdminToken);
    record('TEST 3.5: Create user returns 201 Created', resCreateUser.status === 201);
    const createdUserId = resCreateUser.body?.data?.user?.id;
    if (createdUserId) {
      await markTestData('users', createdUserId, suiteRunId);
    }

    // 3.4 Update user status
    if (createdUserId) {
      const resStatus = await request('PATCH', `/api/admin/users/${createdUserId}/status`, { isActive: false }, superAdminToken);
      record('TEST 3.6: Update user status returns 200 OK', resStatus.status === 200);
    }

    // 3.5 Update user role
    if (createdUserId) {
      const resRole = await request('PATCH', `/api/admin/users/${createdUserId}/role`, { role: 'professor' }, superAdminToken);
      record('TEST 3.7: Update user role returns 200 OK', resRole.status === 200);
    }

    // 3.6 Self-lockout prevention: Admin cannot deactivate self (returns 409 Conflict)
    const resSelfDeact = await request('PATCH', '/api/admin/users/3/status', { isActive: false }, superAdminToken);
    record('TEST 3.8: Self-deactivation blocked with 409 Conflict', resSelfDeact.status === 409);

    // 3.7 Self-demotion prevention: Admin cannot demote self (returns 409 Conflict)
    const resSelfDemote = await request('PATCH', '/api/admin/users/3/role', { role: 'student' }, superAdminToken);
    record('TEST 3.9: Self-demotion blocked with 409 Conflict', resSelfDemote.status === 409);

    // -------------------------------------------------------------------------
    // SECTION 4: Problem Bank Management APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Problem Bank Management APIs ---');

    const resProbs = await request('GET', '/api/admin/problems?limit=50', null, superAdminToken);
    record('TEST 4.1: List problems returns 200 OK', resProbs.status === 200);
    const probList = resProbs.body?.data?.problems || [];
    record('TEST 4.2: Returns exactly 5 clean problems', probList.length === 5);

    const resProbDetail = await request('GET', '/api/admin/problems/1797', null, superAdminToken);
    record('TEST 4.3: Get problem detail returns 200 OK', resProbDetail.status === 200);
    record('TEST 4.4: Problem detail matches Two Sum', resProbDetail.body?.data?.problem?.title === 'Two Sum');

    // -------------------------------------------------------------------------
    // SECTION 5: Contest Management APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Contest Management APIs ---');

    const resContests = await request('GET', '/api/contests?limit=50', null, superAdminToken);
    record('TEST 5.1: List contests returns 200 OK', resContests.status === 200);
    const contestList = resContests.body?.contests || resContests.body?.data || [];
    record('TEST 5.2: Returns exactly 1 clean contest', contestList.length === 1);
    record('TEST 5.3: Contest #147 is returned', contestList[0]?.id === 147);

    const resContestDetail = await request('GET', '/api/contests/147', null, superAdminToken);
    record('TEST 5.4: Get contest detail returns 200 OK', resContestDetail.status === 200);

    // -------------------------------------------------------------------------
    // SECTION 6: Security & Audit Log APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Security & Audit Log APIs ---');

    const resAudit = await request('GET', '/api/admin/audit-logs?limit=10', null, superAdminToken);
    record('TEST 6.1: Audit logs returns 200 OK', resAudit.status === 200);
    record('TEST 6.2: Audit logs returns paginated log array', Array.isArray(resAudit.body?.data?.logs || resAudit.body?.data));

    // -------------------------------------------------------------------------
    // SECTION 7: System Observability & Health APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 7. System Observability & Health APIs ---');

    const resHealth = await request('GET', '/api/admin/system/health', null, superAdminToken);
    record('TEST 7.1: System health returns 200 OK', resHealth.status === 200);
    record('TEST 7.2: Overall health status is valid enum', ['HEALTHY', 'DEGRADED', 'UNHEALTHY'].includes(resHealth.body?.data?.overall));

    const resMetrics = await request('GET', '/api/admin/system/metrics', null, superAdminToken);
    record('TEST 7.3: System metrics returns 200 OK', resMetrics.status === 200);

    const resIncidents = await request('GET', '/api/admin/system/incidents', null, superAdminToken);
    record('TEST 7.4: System incidents returns 200 OK', resIncidents.status === 200);

    // -------------------------------------------------------------------------
    // SECTION 8: Problem Review Governance APIs
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Problem Review Governance APIs ---');

    const resReviews = await request('GET', '/api/admin/problem-reviews', null, superAdminToken);
    record('TEST 8.1: Problem reviews queue returns 200 OK', resReviews.status === 200);

    const resRevAnalytics = await request('GET', '/api/admin/problem-review-analytics', null, superAdminToken);
    record('TEST 8.2: Problem review analytics returns 200 OK', resRevAnalytics.status === 200);

    const resReviewerStats = await request('GET', '/api/admin/reviewer-analytics', null, superAdminToken);
    record('TEST 8.3: Reviewer analytics returns 200 OK', resReviewerStats.status === 200);

    // -------------------------------------------------------------------------
    // SECTION 9: Test Data Management & Security Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Test Data Management & Security Protection ---');

    const resSummary = await request('GET', '/api/admin/test-data/summary', null, superAdminToken);
    record('TEST 9.1: Test data summary returns 200 OK', resSummary.status === 200);

    // Protection check: Deleting protected platform admin is blocked with 403
    const resDelAdmin = await request('DELETE', '/api/admin/test-data/users/3', null, superAdminToken);
    record('TEST 9.2: Deleting protected platform admin blocked with 403 Forbidden', resDelAdmin.status === 403);

    // Protection check: Deleting protected canonical contest is blocked with 403
    const resDelContest = await request('DELETE', '/api/admin/test-data/contests/147', null, superAdminToken);
    record('TEST 9.3: Deleting protected contest #147 blocked with 403 Forbidden', resDelContest.status === 403);

    // Protection check: Deleting protected canonical problem is blocked with 403
    const resDelProb = await request('DELETE', '/api/admin/test-data/problems/1797', null, superAdminToken);
    record('TEST 9.4: Deleting protected problem #1797 blocked with 403 Forbidden', resDelProb.status === 403);

    // -------------------------------------------------------------------------
    // SECTION 10: Teardown & Self-Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Teardown & Self-Cleanup ---');
    await cleanupTestRun(suiteRunId);

    // Confirm zero residual test data
    const uCount = await pool.query('SELECT count(*) FROM users');
    const cCount = await pool.query('SELECT count(*) FROM contests');
    const pCount = await pool.query('SELECT count(*) FROM problems');
    record('TEST 10.1: Database users count remained strictly at 5', parseInt(uCount.rows[0].count, 10) === 5);
    record('TEST 10.2: Database contests count remained strictly at 1', parseInt(cCount.rows[0].count, 10) === 1);
    record('TEST 10.3: Database problems count remained strictly at 5', parseInt(pCount.rows[0].count, 10) === 5);

  } catch (err) {
    console.error('\n[UNEXPECTED BASELINE ERROR]:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  }

  console.log('\n===============================================================');
  console.log(` BASELINE VALIDATION COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runBaselineTests();
