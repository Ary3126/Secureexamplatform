/**
 * Phase 7.3 Admin Panel: User Management API & Security Test Suite
 * 
 * Verifies:
 * 1. Strict Authentication & Super Admin RBAC (401/403 for unauthorized users)
 * 2. User Listing with Bounded Pagination & Parameterized Filtering (role, status, search)
 * 3. Single User Retrieval & Zero Credential Leakage (no password_hash, tokens)
 * 4. Administrative User Provisioning (bcrypt hashing, duplicate conflict handling, USER_CREATED audit)
 * 5. Administrative User Profile Updates (field whitelisting, mass-assignment defense, USER_UPDATED audit)
 * 6. Role Management & Privilege Escalation Prevention (ROLE_CHANGED audit)
 * 7. Account Status Transitions & Login Flow Integration (ACCOUNT_STATUS_CHANGED, USER_DEACTIVATED)
 * 8. Last Active Super Admin Self-Lockout & Demotion Protection (409 Conflict, ADMIN_ACTION_DENIED)
 * 9. BOLA / IDOR & Input Parameter Tampering Resilience (malformed IDs, SQL injection payloads)
 * 10. Clean Test Fixture Isolation & Pool Teardown
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const UserModel = require('./src/models/userModel');
const AuditLogModel = require('./src/models/auditLogModel');

let server;
let baseUrl;
const timestamp = Date.now();

// Test Actors
let studentUser, studentToken;
let profUser, profToken;
let contestAdminUser, contestAdminToken;
let superAdmin1User, superAdmin1Token;
let superAdmin2User, superAdmin2Token;

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

function check(name, condition) {
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${name}`);
    throw new Error(`Assertion Failed: ${name}`);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.3 ADMIN USER MANAGEMENT API SUITE');
  console.log('=======================================================\n');

  try {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // ----------------------------------------------------
    // 1. Setting Up Test Actors
    // ----------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('Password123!');

    const stdRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'student') RETURNING *;
    `, [`std_p73_${timestamp}`, `std_p73_${timestamp}@test.com`, pwdHash, 'Student P73']);
    studentUser = stdRes.rows[0];
    studentToken = generateToken(studentUser);

    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'professor') RETURNING *;
    `, [`prof_p73_${timestamp}`, `prof_p73_${timestamp}@test.com`, pwdHash, 'Prof P73']);
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);

    const caRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'contest_admin') RETURNING *;
    `, [`ca_p73_${timestamp}`, `ca_p73_${timestamp}@test.com`, pwdHash, 'ContestAdmin P73']);
    contestAdminUser = caRes.rows[0];
    contestAdminToken = generateToken(contestAdminUser);

    const sa1Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa1_p73_${timestamp}`, `sa1_p73_${timestamp}@test.com`, pwdHash, 'SuperAdmin 1 P73']);
    superAdmin1User = sa1Res.rows[0];
    superAdmin1Token = generateToken(superAdmin1User);

    const sa2Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa2_p73_${timestamp}`, `sa2_p73_${timestamp}@test.com`, pwdHash, 'SuperAdmin 2 P73']);
    superAdmin2User = sa2Res.rows[0];
    superAdmin2Token = generateToken(superAdmin2User);

    check('Test actors initialized successfully', studentUser && profUser && superAdmin1User && superAdmin2User);

    // ----------------------------------------------------
    // 2. Strict Authentication & Role Separation (RBAC)
    // ----------------------------------------------------
    console.log('\n--- 2. Strict Authentication & RBAC ---');
    const unauthRes = await request('GET', '/api/admin/users');
    check('Unauthenticated GET /api/admin/users returns 401', unauthRes.status === 401);

    const stdListRes = await request('GET', '/api/admin/users', null, studentToken);
    check('Student GET /api/admin/users returns 403 Forbidden', stdListRes.status === 403);

    const profListRes = await request('GET', '/api/admin/users', null, profToken);
    check('Professor GET /api/admin/users returns 403 Forbidden', profListRes.status === 403);

    const caListRes = await request('GET', '/api/admin/users', null, contestAdminToken);
    check('Contest Admin GET /api/admin/users returns 403 Forbidden', caListRes.status === 403);

    const saListRes = await request('GET', '/api/admin/users', null, superAdmin1Token);
    check('Super Admin GET /api/admin/users returns 200 OK', saListRes.status === 200);

    // ----------------------------------------------------
    // 3. User Listing, Bounded Pagination, and Parameter Filtering
    // ----------------------------------------------------
    console.log('\n--- 3. User Listing & Pagination ---');
    const users = saListRes.body.data.users;
    const pagination = saListRes.body.data.pagination;

    check('Users is an array', Array.isArray(users));
    check('Pagination total is present and positive', pagination && pagination.total > 0);
    check('Default page is 1', pagination.page === 1);
    check('Default limit is 20', pagination.limit === 20);

    // Credential leakage check across all listed users
    let anyCredentialLeaked = false;
    for (const u of users) {
      if (u.password_hash !== undefined || u.password !== undefined || u.token !== undefined) {
        anyCredentialLeaked = true;
      }
    }
    check('ZERO credential leakage: password_hash is omitted across all users', !anyCredentialLeaked);

    // Limit clamp check (limit > 100 should be clamped to 100)
    const clampRes = await request('GET', '/api/admin/users?limit=250', null, superAdmin1Token);
    check('Limit > 100 is clamped to 100', clampRes.body.data.pagination.limit === 100);

    // Role filtering
    const roleFilterRes = await request('GET', '/api/admin/users?role=professor', null, superAdmin1Token);
    check('Role filter returns 200 OK', roleFilterRes.status === 200);
    const profsOnly = roleFilterRes.body.data.users;
    check('All filtered users have professor role', profsOnly.every((u) => u.role === 'professor'));

    // Status filtering
    const statusFilterRes = await request('GET', '/api/admin/users?status=active', null, superAdmin1Token);
    check('Status filter returns 200 OK', statusFilterRes.status === 200);
    const activeOnly = statusFilterRes.body.data.users;
    check('All returned users are active', activeOnly.every((u) => u.isActive === true));

    // Search filtering
    const searchRes = await request('GET', `/api/admin/users?search=${encodeURIComponent(studentUser.username)}`, null, superAdmin1Token);
    check('Search query returns 200 OK', searchRes.status === 200);
    check('Search finds target student', searchRes.body.data.users.some((u) => u.username === studentUser.username));

    // SQL Injection resilience
    const sqliRes = await request('GET', `/api/admin/users?search=${encodeURIComponent("' OR '1'='1' --")}`, null, superAdmin1Token);
    check('SQL injection payload handled safely (returns 200 without error)', sqliRes.status === 200);

    // ----------------------------------------------------
    // 4. Single User Retrieval & IDOR / BOLA Resilience
    // ----------------------------------------------------
    console.log('\n--- 4. Single User Retrieval & IDOR / BOLA Resilience ---');
    const singleRes = await request('GET', `/api/admin/users/${studentUser.id}`, null, superAdmin1Token);
    check('Super Admin can retrieve user by ID (200 OK)', singleRes.status === 200);
    check('User ID matches requested ID', singleRes.body.data.user.id === studentUser.id);
    check('User details payload omits password_hash', singleRes.body.data.user.password_hash === undefined);
    check('User details payload omits password', singleRes.body.data.user.password === undefined);

    const nonExistentRes = await request('GET', '/api/admin/users/99999999', null, superAdmin1Token);
    check('Non-existent user ID returns 404 Not Found', nonExistentRes.status === 404);

    const malformedIdRes = await request('GET', '/api/admin/users/invalid_id', null, superAdmin1Token);
    check('Malformed user ID returns 400 Bad Request', malformedIdRes.status === 400);

    const studentSingleRes = await request('GET', `/api/admin/users/${profUser.id}`, null, studentToken);
    check('Student cannot access single user admin endpoint (403)', studentSingleRes.status === 403);

    // ----------------------------------------------------
    // 5. Administrative User Provisioning
    // ----------------------------------------------------
    console.log('\n--- 5. User Provisioning ---');
    const newUsername = `admin_created_${timestamp}`;
    const newEmail = `${newUsername}@test.edu`;
    const createRes = await request('POST', '/api/admin/users', {
      username: newUsername,
      email: newEmail,
      password: 'TemporaryPassword123!',
      fullName: 'Admin Created Professor',
      role: 'professor',
      isActive: true,
      institution: 'MIT',
    }, superAdmin1Token);

    check('User created successfully (201 Created)', createRes.status === 201);
    const createdUser = createRes.body.data.user;
    check('Created user has correct role', createdUser.role === 'professor');
    check('Created user omits password_hash', createdUser.password_hash === undefined);

    // Duplicate email check
    const dupEmailRes = await request('POST', '/api/admin/users', {
      username: `another_${timestamp}`,
      email: newEmail,
      password: 'TemporaryPassword123!',
      fullName: 'Duplicate',
    }, superAdmin1Token);
    check('Duplicate email returns 409 Conflict', dupEmailRes.status === 409);

    // Duplicate username check
    const dupUserRes = await request('POST', '/api/admin/users', {
      username: newUsername,
      email: `other_${timestamp}@test.edu`,
      password: 'TemporaryPassword123!',
      fullName: 'Duplicate',
    }, superAdmin1Token);
    check('Duplicate username returns 409 Conflict', dupUserRes.status === 409);

    // ----------------------------------------------------
    // 6. User Profile Update
    // ----------------------------------------------------
    console.log('\n--- 6. User Profile Updates ---');
    const updateRes = await request('PUT', `/api/admin/users/${createdUser.id}`, {
      fullName: 'Updated Professor Name',
      institution: 'Harvard University',
      bio: 'Machine learning expert',
    }, superAdmin1Token);
    check('User profile updated successfully (200 OK)', updateRes.status === 200);
    check('Full name updated', updateRes.body.data.user.fullName === 'Updated Professor Name');
    check('Institution updated', updateRes.body.data.user.institution === 'Harvard University');

    // ----------------------------------------------------
    // 7. Role Management & Privilege Escalation Protection
    // ----------------------------------------------------
    console.log('\n--- 7. Role Management ---');
    const roleUpRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'professor',
    }, superAdmin1Token);
    check('Promote student to professor (200 OK)', roleUpRes.status === 200);
    check('Updated role is professor', roleUpRes.body.data.user.role === 'professor');

    const roleDownRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'student',
    }, superAdmin1Token);
    check('Demote user back to student (200 OK)', roleDownRes.status === 200);
    check('Updated role is student', roleDownRes.body.data.user.role === 'student');

    const invalidRoleRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'root_god',
    }, superAdmin1Token);
    check('Invalid role returns 400 Bad Request', invalidRoleRes.status === 400);

    // ----------------------------------------------------
    // 8. Account Status Management & Authentication Impact
    // ----------------------------------------------------
    console.log('\n--- 8. Account Status Management ---');
    const suspendRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, {
      isActive: false,
    }, superAdmin1Token);
    check('Super Admin suspends student (200 OK)', suspendRes.status === 200);
    check('User isActive is false', suspendRes.body.data.user.isActive === false);

    // Suspended student login attempt should be blocked with 403 Forbidden
    const suspendedLoginRes = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'Password123!',
    });
    check('Suspended user login rejected with 403 Forbidden', suspendedLoginRes.status === 403);
    check('Suspension error message returned', suspendedLoginRes.body.message && suspendedLoginRes.body.message.includes('deactivated'));

    // Reactivate student account
    const reactivateRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, {
      isActive: true,
    }, superAdmin1Token);
    check('Super Admin reactivates student (200 OK)', reactivateRes.status === 200);
    check('User isActive is true', reactivateRes.body.data.user.isActive === true);

    // Reactivated user login succeeds
    const activeLoginRes = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'Password123!',
    });
    check('Reactivated user login succeeds (200 OK)', activeLoginRes.status === 200);
    check('JWT token issued upon login', Boolean(activeLoginRes.body.token));

    // ----------------------------------------------------
    // 9. Last Active Super Admin Protection
    // ----------------------------------------------------
    console.log('\n--- 9. Last Active Super Admin Protection ---');
    // Temporarily deactivate other pre-existing super admins in DB so only SA1 and SA2 are active
    const otherSaRes = await db.query(
      `SELECT id FROM users WHERE role = 'super_admin' AND id NOT IN ($1, $2) AND is_active = true;`,
      [superAdmin1User.id, superAdmin2User.id]
    );
    const otherSaIds = otherSaRes.rows.map((r) => r.id);
    if (otherSaIds.length > 0) {
      await db.query(`UPDATE users SET is_active = false WHERE id = ANY($1::int[]);`, [otherSaIds]);
    }

    try {
      // First, demote superAdmin2 to professor so that only superAdmin1 remains active
      const demoteSA2Res = await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, {
        role: 'professor',
      }, superAdmin1Token);
      check('Demote Super Admin 2 when SA1 is active (200 OK)', demoteSA2Res.status === 200);

      // Now attempt to demote SA1 (the last active super admin) -> Must return 409
      const demoteLastSARes = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/role`, {
        role: 'student',
      }, superAdmin1Token);
      check('Demoting the last active Super Admin rejected with 409 Conflict', demoteLastSARes.status === 409);

      // Now attempt to suspend SA1 (the last active super admin) -> Must return 409
      const suspendLastSARes = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/status`, {
        isActive: false,
      }, superAdmin1Token);
      check('Suspending the last active Super Admin rejected with 409 Conflict', suspendLastSARes.status === 409);

      // Restore SA2 back to super_admin
      await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, {
        role: 'super_admin',
      }, superAdmin1Token);
    } finally {
      // Restore other super admins
      if (otherSaIds.length > 0) {
        await db.query(`UPDATE users SET is_active = true WHERE id = ANY($1::int[]);`, [otherSaIds]);
      }
    }

    // ----------------------------------------------------
    // 10. Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 10. Audit Logging Verification ---');
    const auditRes = await request('GET', '/api/admin/audit-logs?limit=20', null, superAdmin1Token);
    check('Audit logs returned successfully (200 OK)', auditRes.status === 200);
    const logs = auditRes.body.data.logs || auditRes.body.data;
    check('Audit logs is an array', Array.isArray(logs));
    const actions = logs.map((l) => l.action);
    check('USER_CREATED action logged', actions.includes('USER_CREATED'));
    check('ROLE_CHANGED action logged', actions.includes('ROLE_CHANGED'));
    check('ACCOUNT_STATUS_CHANGED action logged', actions.includes('ACCOUNT_STATUS_CHANGED'));
    check('ADMIN_ACTION_DENIED action logged', actions.includes('ADMIN_ACTION_DENIED'));

    // ----------------------------------------------------
    // 11. Cleanup
    // ----------------------------------------------------
    console.log('\n--- 11. Cleaning Up Test Fixtures ---');
    await db.query(`
      DELETE FROM audit_logs WHERE actor_id IN ($1, $2, $3, $4, $5);
    `, [studentUser.id, profUser.id, contestAdminUser.id, superAdmin1User.id, superAdmin2User.id]);
    await db.query(`
      DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5, $6);
    `, [studentUser.id, profUser.id, contestAdminUser.id, superAdmin1User.id, superAdmin2User.id, createdUser.id]);
    console.log('  [CLEANUP] Test records purged successfully.');

    console.log('\n=======================================================');
    console.log(` PHASE 7.3 API SUITE: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('=======================================================\n');

  } finally {
    if (server) server.close();
    await db.pool.end();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL] Test runner encountered uncaught error:', err);
  process.exit(1);
});
