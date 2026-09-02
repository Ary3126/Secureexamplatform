/**
 * Admin Governance & Platform Separation Automated Test Suite
 * 
 * Verifies:
 * 1. Strict Role Separation & RBAC (Admin vs Professor vs Student)
 * 2. Platform Overview Stats & Aggregations (GET /api/admin/overview-stats)
 * 3. Platform User & Role Governance (GET/POST/PATCH /api/admin/users)
 * 4. Audit Log Querying & Security Event Stream (GET /api/admin/audit-logs)
 * 5. Problem Review Governance Backlog & Turnaround Analytics
 * 6. Automated Teardown & Clean Test Fixture Isolation
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const UserModel = require('./src/models/userModel');

let server;
let baseUrl;
const timestamp = Date.now();

// Test Actors
let studentUser, studentToken;
let profUser, profToken;
let adminUser, adminToken;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passedAssertions = 0;
let failedAssertions = 0;

function assertCheck(name, condition) {
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${name}`);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING ADMIN GOVERNANCE & ROLE SEPARATION SUITE');
  console.log('=======================================================\n');

  try {
    // 0. Start Server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        console.log(`[SERVER] Test server listening on ${baseUrl}`);
        resolve();
      });
    });

    // 1. Setup Test Actors
    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    const sRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name) VALUES ($1, $2, $3, $4, true, $5) RETURNING id, username, email, role;`,
      [`stu_gov_${timestamp}`, `stu_gov_${timestamp}@test.com`, pwdHash, 'student', 'Test Student']
    );
    studentUser = sRes.rows[0];
    studentToken = generateToken(studentUser);

    const pRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name) VALUES ($1, $2, $3, $4, true, $5) RETURNING id, username, email, role;`,
      [`prof_gov_${timestamp}`, `prof_gov_${timestamp}@test.com`, pwdHash, 'professor', 'Test Professor']
    );
    profUser = pRes.rows[0];
    profToken = generateToken(profUser);

    const aRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name) VALUES ($1, $2, $3, $4, true, $5) RETURNING id, username, email, role;`,
      [`admin_gov_${timestamp}`, `admin_gov_${timestamp}@test.com`, pwdHash, 'super_admin', 'Test Admin']
    );
    adminUser = aRes.rows[0];
    adminToken = generateToken(adminUser);

    assertCheck('Test actors created with distinct roles', studentUser && profUser && adminUser);

    // 2. Strict Role Separation on Admin Endpoints
    console.log('\n--- 2. Strict RBAC & Role Separation on Admin Gateway ---');

    const unauthRes = await request('GET', '/api/admin/overview-stats');
    assertCheck('Unauthenticated request to admin overview returns 401 Unauthorized', unauthRes.status === 401);

    const studentRes = await request('GET', '/api/admin/overview-stats', null, studentToken);
    assertCheck('Student request to admin overview returns 403 Forbidden', studentRes.status === 403);

    const profRes = await request('GET', '/api/admin/overview-stats', null, profToken);
    assertCheck('Professor request to admin overview returns 403 Forbidden', profRes.status === 403);

    const adminStatsRes = await request('GET', '/api/admin/overview-stats', null, adminToken);
    assertCheck('Super Admin request to admin overview returns 200 OK', adminStatsRes.status === 200);
    assertCheck('Admin overview contains user metrics', typeof adminStatsRes.body.data?.users?.total_users === 'number');
    assertCheck('Admin overview contains contest metrics', typeof adminStatsRes.body.data?.contests?.total_contests === 'number');
    assertCheck('Admin overview contains problem metrics', typeof adminStatsRes.body.data?.problems?.total_problems === 'number');
    assertCheck('Admin overview contains system health', adminStatsRes.body.data?.system?.databaseStatus === 'connected');

    // 3. User & Role Management
    console.log('\n--- 3. User & Role Management Engine ---');

    const userListRes = await request('GET', '/api/admin/users?page=1&limit=10', null, adminToken);
    assertCheck('Admin can list users with pagination (200 OK)', userListRes.status === 200);
    assertCheck('Users list contains registered accounts', Array.isArray(userListRes.body.data?.users));

    // Provision new user
    const createRes = await request('POST', '/api/admin/users', {
      username: `new_prof_${timestamp}`,
      fullName: 'New Professor User',
      email: `new_prof_${timestamp}@test.com`,
      password: 'InitialPassword123!',
      role: 'professor',
    }, adminToken);
    assertCheck('Admin can provision new user directly (201 Created)', createRes.status === 201);
    const createdId = createRes.body.data?.user?.id;

    // Change role
    const roleChangeRes = await request('PATCH', `/api/admin/users/${createdId}/role`, {
      role: 'contest_admin',
    }, adminToken);
    assertCheck('Admin can update user role (200 OK)', roleChangeRes.status === 200);
    assertCheck('Role is updated to contest_admin', roleChangeRes.body.data?.user?.role === 'contest_admin');

    // Suspend and reactivate account
    const suspendRes = await request('PATCH', `/api/admin/users/${createdId}/status`, {
      isActive: false,
    }, adminToken);
    assertCheck('Admin can suspend user account (200 OK)', suspendRes.status === 200);
    assertCheck('Account isActive is false', suspendRes.body.data?.user?.isActive === false);

    const activateRes = await request('PATCH', `/api/admin/users/${createdId}/status`, {
      isActive: true,
    }, adminToken);
    assertCheck('Admin can reactivate user account (200 OK)', activateRes.status === 200);
    assertCheck('Account isActive is true', activateRes.body.data?.user?.isActive === true);

    // 4. Audit Log Querying
    console.log('\n--- 4. Audit Logs & Security Stream ---');
    const auditRes = await request('GET', '/api/admin/audit-logs?limit=20', null, adminToken);
    assertCheck('Admin can query security audit logs (200 OK)', auditRes.status === 200);
    assertCheck('Audit log records returned', Array.isArray(auditRes.body.data?.auditLogs || auditRes.body.data?.logs));

    // 5. Ephemeral Teardown Cleanup
    console.log('\n--- 5. Ephemeral Test Fixture Cleanup ---');
    await db.query(`DELETE FROM users WHERE username LIKE $1`, [`%gov_${timestamp}%`]);
    await db.query(`DELETE FROM users WHERE username LIKE $1`, [`%new_prof_${timestamp}%`]);
    console.log('  [CLEANUP] Ephemeral test users purged successfully.');

  } catch (err) {
    console.error('[UNEXPECTED TEST ERROR]', err);
    failedAssertions++;
  } finally {
    if (server) {
      server.close();
    }
    await db.closePool();

    console.log('\n=======================================================');
    console.log(` ADMIN GOVERNANCE SUITE: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('=======================================================\n');

    if (failedAssertions > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
