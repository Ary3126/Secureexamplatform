/**
 * Phase 5.9.4 Admin User & Role Management Automated Test Suite
 * 
 * Verifies:
 * 1. Strict Authentication & Super Admin RBAC (401/403 for unauthorized users)
 * 2. User Listing with Bounded Pagination & Parameterized Filtering (role, status, search)
 * 3. Single User Retrieval & Zero Credential Leakage (no password_hash, tokens)
 * 4. Administrative User Creation with Role & Status (bcrypt hashing, conflict handling, USER_CREATED audit)
 * 5. Administrative User Profile Updates (field whitelisting, mass-assignment defense, USER_UPDATED audit)
 * 6. Role Management & Privilege Escalation Prevention (ROLE_CHANGED audit)
 * 7. Account Status Transitions & Login Flow Integration (ACCOUNT_STATUS_CHANGED, USER_DEACTIVATED)
 * 8. Last Active Super Admin Self-Lockout & Demotion Protection (409 Conflict, ADMIN_ACTION_DENIED)
 * 9. Concurrency & Multi-Admin Race Condition Safety
 * 10. BOLA / IDOR & Input Parameter Tampering Resilience
 * 11. Transactional Atomicity (Synchronized Commit & Rollback)
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const UserModel = require('./src/models/userModel');
const AuditLogModel = require('./src/models/auditLogModel');
const AuditLogger = require('./src/services/auditLogger');

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

function assert(condition, message) {
  if (condition) {
    passedAssertions++;
    console.log(`[PASS] ${message}`);
  } else {
    failedAssertions++;
    console.error(`[FAIL] ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.9.4 ADMIN USER & ROLE MANAGEMENT SUITE');
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
    `, [`std_594_${timestamp}`, `std_594_${timestamp}@test.com`, pwdHash, 'Student 594']);
    studentUser = stdRes.rows[0];
    studentToken = generateToken(studentUser);

    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'professor') RETURNING *;
    `, [`prof_594_${timestamp}`, `prof_594_${timestamp}@test.com`, pwdHash, 'Prof 594']);
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);

    const caRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'contest_admin') RETURNING *;
    `, [`ca_594_${timestamp}`, `ca_594_${timestamp}@test.com`, pwdHash, 'CA 594']);
    contestAdminUser = caRes.rows[0];
    contestAdminToken = generateToken(contestAdminUser);

    const sa1Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa1_594_${timestamp}`, `sa1_594_${timestamp}@test.com`, pwdHash, 'Super Admin 1']);
    superAdmin1User = sa1Res.rows[0];
    superAdmin1Token = generateToken(superAdmin1User);

    const sa2Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa2_594_${timestamp}`, `sa2_594_${timestamp}@test.com`, pwdHash, 'Super Admin 2']);
    superAdmin2User = sa2Res.rows[0];
    superAdmin2Token = generateToken(superAdmin2User);

    assert(studentUser && profUser && contestAdminUser && superAdmin1User && superAdmin2User, '1. All test actors initialized successfully');

    // ----------------------------------------------------
    // 2. Authentication & RBAC Enforcement (401 / 403)
    // ----------------------------------------------------
    console.log('\n--- 2. Authentication & RBAC Enforcement (401 / 403) ---');
    
    // Unauthenticated requests
    const unauthList = await request('GET', '/api/admin/users');
    assert(unauthList.status === 401, '2a. Unauthenticated GET /api/admin/users returns 401');

    const unauthGet = await request('GET', `/api/admin/users/${studentUser.id}`);
    assert(unauthGet.status === 401, '2b. Unauthenticated GET /api/admin/users/:id returns 401');

    const unauthPost = await request('POST', '/api/admin/users', { username: 'test', email: 'test@test.com' });
    assert(unauthPost.status === 401, '2c. Unauthenticated POST /api/admin/users returns 401');

    const unauthPut = await request('PUT', `/api/admin/users/${studentUser.id}`, { fullName: 'Hacked' });
    assert(unauthPut.status === 401, '2d. Unauthenticated PUT /api/admin/users/:id returns 401');

    const unauthRole = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'super_admin' });
    assert(unauthRole.status === 401, '2e. Unauthenticated PATCH /api/admin/users/:id/role returns 401');

    const unauthStatus = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, { isActive: false });
    assert(unauthStatus.status === 401, '2f. Unauthenticated PATCH /api/admin/users/:id/status returns 401');

    // Unauthorized Roles (Student -> 403)
    const stdList = await request('GET', '/api/admin/users', null, studentToken);
    assert(stdList.status === 403, '3a. Student GET /api/admin/users returns 403 Forbidden');

    const stdRole = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'super_admin' }, studentToken);
    assert(stdRole.status === 403, '3b. Student cannot promote self to super_admin (403 Forbidden)');

    // Unauthorized Roles (Professor -> 403)
    const profList = await request('GET', '/api/admin/users', null, profToken);
    assert(profList.status === 403, '3c. Professor GET /api/admin/users returns 403 Forbidden');

    const profRole = await request('PATCH', `/api/admin/users/${profUser.id}/role`, { role: 'super_admin' }, profToken);
    assert(profRole.status === 403, '3d. Professor cannot promote self to super_admin (403 Forbidden)');

    // Unauthorized Roles (Contest Admin -> 403)
    const caList = await request('GET', '/api/admin/users', null, contestAdminToken);
    assert(caList.status === 403, '3e. Contest Admin GET /api/admin/users returns 403 Forbidden');

    const caRole = await request('PATCH', `/api/admin/users/${contestAdminUser.id}/role`, { role: 'super_admin' }, contestAdminToken);
    assert(caRole.status === 403, '3f. Contest Admin cannot promote self to super_admin (403 Forbidden)');

    // Super Admin -> 200 OK
    const saList = await request('GET', '/api/admin/users', null, superAdmin1Token);
    assert(saList.status === 200, '3g. Super Admin GET /api/admin/users returns 200 OK');

    // ----------------------------------------------------
    // 3. User Listing with Bounded Pagination & Filtering
    // ----------------------------------------------------
    console.log('\n--- 3. User Listing with Bounded Pagination & Filtering ---');
    
    assert(Array.isArray(saList.body.data.users), '4a. Users list returns array of users');
    assert(saList.body.data.pagination !== undefined, '4b. Pagination metadata present');
    assert(saList.body.data.pagination.page === 1, '4c. Default page is 1');
    assert(saList.body.data.pagination.limit === 20, '4d. Default limit is 20');

    // Password Hash Leakage Check
    const hasPasswordHash = saList.body.data.users.some(u => u.password_hash || u.passwordHash || u.password);
    assert(!hasPasswordHash, '4e. Password hash / password is NEVER returned in user listing');

    // Bounded limit clamping (limit=1000 clamped to 100)
    const clampRes = await request('GET', '/api/admin/users?limit=1000', null, superAdmin1Token);
    assert(clampRes.body.data.pagination.limit === 100, '4f. Limit > 100 is safely clamped to maximum 100');

    // Role filter
    const roleFilter = await request('GET', '/api/admin/users?role=professor', null, superAdmin1Token);
    assert(roleFilter.status === 200, '4g. Role filter query returns 200 OK');
    assert(roleFilter.body.data.users.every(u => u.role === 'professor'), '4h. All returned users match requested role');

    // Status filter
    const statusFilter = await request('GET', '/api/admin/users?status=active', null, superAdmin1Token);
    assert(statusFilter.status === 200, '4i. Status filter query returns 200 OK');
    assert(statusFilter.body.data.users.every(u => u.isActive === true), '4j. All returned users match active status');

    // Search filter
    const searchFilter = await request('GET', `/api/admin/users?search=std_594_${timestamp}`, null, superAdmin1Token);
    assert(searchFilter.status === 200, '4k. Search query returns 200 OK');
    assert(searchFilter.body.data.users.some(u => u.id === studentUser.id), '4l. Search finds target user by username');

    // ----------------------------------------------------
    // 4. Single User Retrieval & BOLA Protection
    // ----------------------------------------------------
    console.log('\n--- 4. Single User Retrieval & BOLA Protection ---');
    const getUserRes = await request('GET', `/api/admin/users/${studentUser.id}`, null, superAdmin1Token);
    assert(getUserRes.status === 200, '5a. Super Admin can retrieve single user details');
    assert(getUserRes.body.data.user.id === studentUser.id, '5b. Retrieved user ID matches');
    assert(getUserRes.body.data.user.password_hash === undefined, '5c. Single user payload omits password_hash');
    assert(getUserRes.body.data.user.password === undefined, '5d. Single user payload omits password');

    // Nonexistent user -> 404
    const notFoundRes = await request('GET', '/api/admin/users/999999', null, superAdmin1Token);
    assert(notFoundRes.status === 404, '5e. Non-existent user ID returns 404 Not Found');

    // Malformed ID -> 400
    const malformedIdRes = await request('GET', '/api/admin/users/invalid-id-format', null, superAdmin1Token);
    assert(malformedIdRes.status === 400, '5f. Malformed user ID format returns 400 Bad Request');

    // Negative ID -> 400
    const negativeIdRes = await request('GET', '/api/admin/users/-5', null, superAdmin1Token);
    assert(negativeIdRes.status === 400, '5g. Negative user ID format returns 400 Bad Request');

    // ----------------------------------------------------
    // 5. Administrative User Creation (POST /api/admin/users)
    // ----------------------------------------------------
    console.log('\n--- 5. Administrative User Creation ---');
    const newProfPayload = {
      username: `admin_created_prof_${timestamp}`,
      email: `admin_created_prof_${timestamp}@test.com`,
      password: 'SecureAdminPassword123!',
      fullName: 'Admin Created Professor',
      role: 'professor',
      institution: 'MIT Department of EECS',
      bio: 'Algorithms researcher',
    };

    const createRes = await request('POST', '/api/admin/users', newProfPayload, superAdmin1Token);
    assert(createRes.status === 201, '6a. Super Admin creates user successfully (201 Created)');
    assert(createRes.body.data.user.id !== undefined, '6b. Created user has ID');
    assert(createRes.body.data.user.role === 'professor', '6c. Created user has specified role');
    assert(createRes.body.data.user.password_hash === undefined, '6d. Response strictly excludes password_hash');
    assert(createRes.body.data.user.password === undefined, '6e. Response strictly excludes plain password');

    const createdUserId = createRes.body.data.user.id;

    // Verify Password Hash in PostgreSQL database
    const dbUserRow = await UserModel.findUserById(createdUserId);
    assert(dbUserRow.password_hash !== 'SecureAdminPassword123!', '6f. Password in DB is hashed, NOT plaintext');
    assert(dbUserRow.password_hash.startsWith('$2a$') || dbUserRow.password_hash.startsWith('$2b$'), '6g. Password is valid bcrypt hash');

    // Verify Audit Event USER_CREATED
    const auditRes = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_CREATED' AND resource_id = $1;
    `, [createdUserId]);
    assert(auditRes.rows.length === 1, '6h. USER_CREATED audit log event persisted in PostgreSQL');
    assert(auditRes.rows[0].actor_id === superAdmin1User.id, '6i. Audit log records Super Admin actor_id');
    assert(auditRes.rows[0].metadata.createdUserId === createdUserId, '6j. Audit metadata contains createdUserId');
    assert(auditRes.rows[0].metadata.password === undefined, '6k. Audit metadata contains NO password');
    assert(auditRes.rows[0].metadata.password_hash === undefined, '6l. Audit metadata contains NO password_hash');

    // Invalid role rejection
    const invalidRoleRes = await request('POST', '/api/admin/users', {
      ...newProfPayload,
      username: `invalid_role_${timestamp}`,
      email: `invalid_role_${timestamp}@test.com`,
      role: 'unauthorized_hacker_role',
    }, superAdmin1Token);
    assert(invalidRoleRes.status === 400, '6m. Creating user with invalid role returns 400 Bad Request');

    // Duplicate username conflict
    const dupUserRes = await request('POST', '/api/admin/users', {
      ...newProfPayload,
      email: `unique_email_${timestamp}@test.com`,
    }, superAdmin1Token);
    assert(dupUserRes.status === 409, '6n. Duplicate username returns 409 Conflict');

    // Duplicate email conflict
    const dupEmailRes = await request('POST', '/api/admin/users', {
      ...newProfPayload,
      username: `unique_username_${timestamp}`,
    }, superAdmin1Token);
    assert(dupEmailRes.status === 409, '6o. Duplicate email returns 409 Conflict');

    // ----------------------------------------------------
    // 6. Administrative User Update (PUT /api/admin/users/:id)
    // ----------------------------------------------------
    console.log('\n--- 6. Administrative User Update & Mass Assignment Defense ---');
    const updateRes = await request('PUT', `/api/admin/users/${createdUserId}`, {
      fullName: 'Updated Professor Name',
      bio: 'Senior Algorithms Researcher',
      institution: 'Stanford University',
      // Attacker attempts to manipulate role, password, and rating via profile update
      role: 'super_admin',
      password: 'HackedPassword123!',
      passwordHash: 'HackedHash',
      currentRating: 3000,
    }, superAdmin1Token);

    assert(updateRes.status === 200, '7a. Super Admin updates allowed profile fields (200 OK)');
    assert(updateRes.body.data.user.fullName === 'Updated Professor Name', '7b. Full name updated');
    assert(updateRes.body.data.user.institution === 'Stanford University', '7c. Institution updated');

    // Verify Mass Assignment Defense
    const freshDbUser = await UserModel.findUserById(createdUserId);
    assert(freshDbUser.role === 'professor', '7d. Role was NOT changed via PUT /users/:id (remains professor)');
    assert((freshDbUser.currentRating === 1200 || freshDbUser.current_rating === 1200), '7e. Rating was NOT changed via PUT /users/:id (remains 1200)');
    assert((freshDbUser.passwordHash || freshDbUser.password_hash) === (dbUserRow.passwordHash || dbUserRow.password_hash), '7f. Password hash was NOT changed via PUT');

    // Verify USER_UPDATED audit log
    const auditUpdate = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_UPDATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [createdUserId]);
    assert(auditUpdate.rows.length === 1, '7g. USER_UPDATED audit log event persisted in PostgreSQL');
    assert(auditUpdate.rows[0].metadata.updatedFields.includes('fullName'), '7h. Audit metadata records updatedFields');

    // ----------------------------------------------------
    // 7. Role Management & Privilege Escalation Protection
    // ----------------------------------------------------
    console.log('\n--- 7. Role Management & Privilege Escalation Protection ---');
    
    // Promote student to professor
    const promoteRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'professor',
    }, superAdmin1Token);
    assert(promoteRes.status === 200, '8a. Super Admin promotes student to professor (200 OK)');
    assert(promoteRes.body.data.user.role === 'professor', '8b. Updated user role is professor');

    // Promote professor to contest_admin
    const promoteCaRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'contest_admin',
    }, superAdmin1Token);
    assert(promoteCaRes.status === 200, '8c. Super Admin promotes professor to contest_admin (200 OK)');
    assert(promoteCaRes.body.data.user.role === 'contest_admin', '8d. Updated user role is contest_admin');

    // Demote contest_admin back to student
    const demoteRes = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'student',
    }, superAdmin1Token);
    assert(demoteRes.status === 200, '8e. Super Admin demotes user back to student (200 OK)');
    assert(demoteRes.body.data.user.role === 'student', '8f. Updated user role is student');

    // Verify ROLE_CHANGED audit log
    const auditRole = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'ROLE_CHANGED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(auditRole.rows.length === 1, '8g. ROLE_CHANGED audit log event persisted in PostgreSQL');
    assert(auditRole.rows[0].metadata.previousRole === 'contest_admin', '8h. Audit metadata records previousRole');
    assert(auditRole.rows[0].metadata.newRole === 'student', '8i. Audit metadata records newRole');

    // Invalid role value
    const invalidRolePatch = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, {
      role: 'super_hacker_admin',
    }, superAdmin1Token);
    assert(invalidRolePatch.status === 400, '8j. Invalid role value returns 400 Bad Request');

    // ----------------------------------------------------
    // 8. Account Status Management & Authentication Interaction
    // ----------------------------------------------------
    console.log('\n--- 8. Account Status Management & Authentication Interaction ---');
    
    // Deactivate user
    const deactRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, {
      isActive: false,
    }, superAdmin1Token);
    assert(deactRes.status === 200, '9a. Super Admin deactivates user (200 OK)');
    assert(deactRes.body.data.user.isActive === false, '9b. User isActive is now false');

    // Verify ACCOUNT_STATUS_CHANGED & USER_DEACTIVATED audit logs
    const auditStatus = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'ACCOUNT_STATUS_CHANGED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(auditStatus.rows.length === 1, '9c. ACCOUNT_STATUS_CHANGED audit log persisted');

    const auditDeact = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_DEACTIVATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(auditDeact.rows.length === 1, '9d. USER_DEACTIVATED audit log persisted');
    assert(auditDeact.rows[0].metadata.deactivatedBy === superAdmin1User.id, '9e. USER_DEACTIVATED records deactivatedBy admin ID');

    // Attempt login with deactivated user -> 403 Forbidden
    const deactLoginRes = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'Password123!',
    });
    assert(deactLoginRes.status === 403, '9f. Deactivated user login is blocked with 403 Forbidden');
    assert(deactLoginRes.body.message.includes('deactivated'), '9g. Deactivation message returned');

    // Reactivate user
    const reactRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, {
      isActive: true,
    }, superAdmin1Token);
    assert(reactRes.status === 200, '9h. Super Admin reactivates user (200 OK)');
    assert(reactRes.body.data.user.isActive === true, '9i. User isActive is now true');

    // Attempt login with reactivated user -> 200 OK
    const reactLoginRes = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'Password123!',
    });
    assert(reactLoginRes.status === 200, '9j. Reactivated user login succeeds (200 OK)');
    assert(reactLoginRes.body.token !== undefined, '9k. JWT issued for reactivated user');

    // ----------------------------------------------------
    // 9. Last Active Super Admin Self-Protection (CRITICAL)
    // ----------------------------------------------------
    console.log('\n--- 9. Last Active Super Admin Self-Protection ---');
    
    // Temporarily deactivate any pre-existing super admins in DB so only SA1 and SA2 are active
    const otherSaRes = await db.query(`SELECT id FROM users WHERE role = 'super_admin' AND id NOT IN ($1, $2) AND is_active = true;`, [superAdmin1User.id, superAdmin2User.id]);
    const otherSaIds = otherSaRes.rows.map(r => r.id);
    if (otherSaIds.length > 0) {
      await db.query(`UPDATE users SET is_active = false WHERE id = ANY($1::int[]);`, [otherSaIds]);
    }

    try {
      // We currently have exactly 2 active super admins: SA1 and SA2.
      // SA1 can demote SA2 because SA1 remains active.
      const demoteSa2 = await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, {
        role: 'professor',
      }, superAdmin1Token);
      assert(demoteSa2.status === 200, '10a. Super Admin 1 can demote Super Admin 2 when SA1 remains active');

      // Now, SA1 is the ONLY active super admin remaining.
      // Attempt 1: SA1 tries to demote self -> 409 Conflict
      const demoteLastSa = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/role`, {
        role: 'professor',
      }, superAdmin1Token);
      assert(demoteLastSa.status === 409, '10b. Demoting the last active Super Admin is rejected with 409 Conflict');
      assert(demoteLastSa.body.message.includes('last active Super Admin'), '10c. Safe conflict message returned');

      // Attempt 2: SA1 tries to deactivate self -> 409 Conflict
      const deactLastSa = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/status`, {
        isActive: false,
      }, superAdmin1Token);
      assert(deactLastSa.status === 409, '10d. Deactivating the last active Super Admin is rejected with 409 Conflict');
      assert(deactLastSa.body.message.includes('last active Super Admin'), '10e. Safe conflict message returned');

      // Verify ADMIN_ACTION_DENIED audit log
      const denialAudit = await db.query(`
        SELECT * FROM audit_logs WHERE action = 'ADMIN_ACTION_DENIED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
      `, [superAdmin1User.id]);
      assert(denialAudit.rows.length === 1, '10f. ADMIN_ACTION_DENIED audit event persisted in PostgreSQL');
      assert(denialAudit.rows[0].outcome === 'denied', '10g. Audit outcome is denied');
      assert(denialAudit.rows[0].metadata.reason === 'last_active_super_admin', '10h. Audit metadata records reason');

      // Restore SA2 back to super_admin
      const restoreSa2 = await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, {
        role: 'super_admin',
      }, superAdmin1Token);
      assert(restoreSa2.status === 200, '10i. Super Admin 2 restored to super_admin role');

      // ----------------------------------------------------
      // 10. Concurrency & Race Condition Safety
      // ----------------------------------------------------
      console.log('\n--- 10. Concurrency & Race Condition Safety ---');
      // Concurrent attempt: Both SA1 and SA2 attempt to demote each other simultaneously.
      // Exactly one should succeed, and the second MUST fail with 409 Conflict.
      const [raceRes1, raceRes2] = await Promise.all([
        request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, { role: 'student' }, superAdmin1Token),
        request('PATCH', `/api/admin/users/${superAdmin1User.id}/role`, { role: 'student' }, superAdmin2Token),
      ]);

      const statuses = [raceRes1.status, raceRes2.status];
      const hasOne200 = statuses.filter(s => s === 200).length === 1;
      const hasOne409 = statuses.filter(s => s === 409).length === 1;

      assert(hasOne200 && hasOne409, '11a. Concurrent final-admin demotion safely resolved (exactly one 200, one 409)');

      // Ensure at least 1 Super Admin remains active in PostgreSQL
      const remainingSuperAdmins = await db.query(`
        SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND is_active = true AND id IN ($1, $2);
      `, [superAdmin1User.id, superAdmin2User.id]);
      assert(remainingSuperAdmins.rows[0].count === 1, '11b. Exactly 1 Super Admin remains active (0 catastrophic lockout)');

      // Restore SA1 and SA2
      await db.query(`UPDATE users SET role = 'super_admin', is_active = true WHERE id IN ($1, $2);`, [superAdmin1User.id, superAdmin2User.id]);
    } finally {
      // Restore other super admins
      if (otherSaIds.length > 0) {
        await db.query(`UPDATE users SET is_active = true WHERE id = ANY($1::int[]);`, [otherSaIds]);
      }
    }

    // ----------------------------------------------------
    // 11. Transaction Rollback & Atomicity Synchronization
    // ----------------------------------------------------
    console.log('\n--- 11. Transaction Rollback & Atomicity Synchronization ---');
    
    // Simulate transaction rollback on audit insertion failure
    const txClient = await db.getClient();
    let rolledBackUserId = null;
    let rolledBackAuditId = null;
    try {
      await txClient.query('BEGIN');
      const tempUserRes = await UserModel.createAdminUser({
        username: `tx_rollback_user_${timestamp}`,
        email: `tx_rollback_user_${timestamp}@test.com`,
        passwordHash: pwdHash,
        fullName: 'Tx Rollback User',
        role: 'student',
      }, txClient);
      rolledBackUserId = tempUserRes.id;

      const aRes = await AuditLogger.logAction({
        actor: superAdmin1User,
        action: 'USER_CREATED',
        resourceType: 'user',
        resourceId: rolledBackUserId,
        outcome: 'success',
        metadata: { txTest: true },
        client: txClient,
      });
      rolledBackAuditId = aRes.id;

      // Force failure
      await txClient.query('INSERT INTO non_existent_table_error_trigger VALUES (1)');
      await txClient.query('COMMIT');
    } catch (err) {
      await txClient.query('ROLLBACK');
    } finally {
      txClient.release();
    }

    const checkRollbackUser = await db.query('SELECT 1 FROM users WHERE id = $1', [rolledBackUserId]);
    const checkRollbackAudit = await db.query('SELECT 1 FROM audit_logs WHERE id = $1', [rolledBackAuditId]);
    assert(checkRollbackUser.rows.length === 0, '12a. User creation rolled back on transaction error');
    assert(checkRollbackAudit.rows.length === 0, '12b. Audit log rolled back on transaction error (0 phantom records)');

    // ----------------------------------------------------
    // 12. Cleanup Ephemeral Test Fixtures
    // ----------------------------------------------------
    console.log('\n--- 12. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5, $6);`, [
      studentUser.id,
      profUser.id,
      contestAdminUser.id,
      superAdmin1User.id,
      superAdmin2User.id,
      createdUserId,
    ]);
    console.log('[CLEANUP] Ephemeral test fixtures purged.');

    console.log('\n=======================================================');
    console.log(` PHASE 5.9.4 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('=======================================================\n');

  } catch (err) {
    console.error('\n❌ Test Suite Failed with Error:\n', err);
    failedAssertions++;
  } finally {
    if (server) {
      server.close();
    }
    await db.closePool();
    process.exit(failedAssertions > 0 ? 1 : 0);
  }
}

runTests();
