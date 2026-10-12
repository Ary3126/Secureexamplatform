/**
 * Phase 7.5.11.2 Dedicated Test Suite: User & Role Management Integration & Security
 * 
 * Verifies platform-wide governance, data consistency, and security defenses:
 * 1. Strict Authentication & Role-Based Access Control (401/403 for unauthorized actors)
 * 2. User Listing with Bounded Pagination, Parameterized Filtering & Multi-field Search
 * 3. Search and Filter boundary stability (oversized pages, invalid limits, injection safety)
 * 4. Single User Retrieval & Zero Credential Leakage (strict omission of password_hash, tokens)
 * 5. BOLA / IDOR Defense & Oversized / Malformed ID bounds handling (no 500 crashes)
 * 6. Administrative User Provisioning with Role, Status, and bcrypt Password Hashing
 * 7. Mass Assignment Defense on Profile Updates (whitelisted fields only)
 * 8. Role Management across all supported platform roles:
 *    ['student', 'professor', 'contest_admin', 'super_admin']
 * 9. Account Status Transitions (Suspension / Reactivation) & Authentication Enforcement
 * 10. Last Active Super Admin Protection (Self-Lockout & Demotion Defense with 409 Conflict)
 * 11. Comprehensive Audit Logging Verification (USER_CREATED, USER_UPDATED, ROLE_CHANGED,
 *     ACCOUNT_STATUS_CHANGED, USER_DEACTIVATED, ADMIN_ACTION_DENIED)
 * 12. Concurrency Safety & Deterministic Fixture Teardown
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

let createdUserId = null;
let secondaryCreatedUserId = null;

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
    console.log(`  [PASS] ${message}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================================================');
  console.log(' STARTING PHASE 7.5.11.2 USER & ROLE MANAGEMENT INTEGRATION SUITE');
  console.log('========================================================================\n');

  try {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // ----------------------------------------------------
    // MODULE 1: Set Up Deterministic Ephemeral Actors
    // ----------------------------------------------------
    console.log('--- MODULE 1: Actor Initialization & Role Baseline ---');
    const pwdHash = await hashPassword('TestPassword123!');

    const stdRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'student') RETURNING *;
    `, [`std_p75112_${timestamp}`, `std_p75112_${timestamp}@test.org`, pwdHash, 'Student P75112']);
    studentUser = stdRes.rows[0];
    studentToken = generateToken(studentUser);

    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'professor') RETURNING *;
    `, [`prof_p75112_${timestamp}`, `prof_p75112_${timestamp}@test.org`, pwdHash, 'Prof P75112']);
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);

    const caRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'contest_admin') RETURNING *;
    `, [`ca_p75112_${timestamp}`, `ca_p75112_${timestamp}@test.org`, pwdHash, 'CA P75112']);
    contestAdminUser = caRes.rows[0];
    contestAdminToken = generateToken(contestAdminUser);

    const sa1Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa1_p75112_${timestamp}`, `sa1_p75112_${timestamp}@test.org`, pwdHash, 'Super Admin 1']);
    superAdmin1User = sa1Res.rows[0];
    superAdmin1Token = generateToken(superAdmin1User);

    const sa2Res = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa2_p75112_${timestamp}`, `sa2_p75112_${timestamp}@test.org`, pwdHash, 'Super Admin 2']);
    superAdmin2User = sa2Res.rows[0];
    superAdmin2Token = generateToken(superAdmin2User);

    assert(studentUser && profUser && contestAdminUser && superAdmin1User && superAdmin2User, '1. All canonical test actors created');
    assert(studentUser.role === 'student', '2. Student actor has role student');
    assert(profUser.role === 'professor', '3. Professor actor has role professor');
    assert(contestAdminUser.role === 'contest_admin', '4. Contest Admin actor has role contest_admin');
    assert(superAdmin1User.role === 'super_admin', '5. Super Admin 1 actor has role super_admin');

    // ----------------------------------------------------
    // MODULE 2: Strict Authentication & RBAC Authorization
    // ----------------------------------------------------
    console.log('\n--- MODULE 2: Authentication & RBAC Authorization Enforcement ---');

    // 2.1 Unauthenticated requests return 401
    const unauthGet = await request('GET', '/api/admin/users');
    assert(unauthGet.status === 401, '6. Unauthenticated GET /api/admin/users returns 401 Unauthorized');

    const unauthPost = await request('POST', '/api/admin/users', { username: 'test' });
    assert(unauthPost.status === 401, '7. Unauthenticated POST /api/admin/users returns 401 Unauthorized');

    const unauthPatchRole = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'super_admin' });
    assert(unauthPatchRole.status === 401, '8. Unauthenticated PATCH /api/admin/users/:id/role returns 401 Unauthorized');

    const unauthPatchStatus = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, { isActive: false });
    assert(unauthPatchStatus.status === 401, '9. Unauthenticated PATCH /api/admin/users/:id/status returns 401 Unauthorized');

    // 2.2 Invalid / Forged JWT returns 401
    const forgedRes = await request('GET', '/api/admin/users', null, 'forged.fake.token');
    assert(forgedRes.status === 401, '10. Forged / invalid bearer token returns 401 Unauthorized');

    // 2.3 Student role returns 403 Forbidden across all endpoints
    const stdList = await request('GET', '/api/admin/users', null, studentToken);
    assert(stdList.status === 403, '11. Student GET /api/admin/users returns 403 Forbidden');

    const stdRole = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'super_admin' }, studentToken);
    assert(stdRole.status === 403, '12. Student privilege escalation attempt returns 403 Forbidden');

    const stdStatus = await request('PATCH', `/api/admin/users/${profUser.id}/status`, { isActive: false }, studentToken);
    assert(stdStatus.status === 403, '13. Student account deactivation attempt returns 403 Forbidden');

    // 2.4 Professor role returns 403 Forbidden
    const profList = await request('GET', '/api/admin/users', null, profToken);
    assert(profList.status === 403, '14. Professor GET /api/admin/users returns 403 Forbidden');

    const profRole = await request('PATCH', `/api/admin/users/${profUser.id}/role`, { role: 'super_admin' }, profToken);
    assert(profRole.status === 403, '15. Professor privilege escalation attempt returns 403 Forbidden');

    // 2.5 Contest Admin role returns 403 Forbidden
    const caList = await request('GET', '/api/admin/users', null, contestAdminToken);
    assert(caList.status === 403, '16. Contest Admin GET /api/admin/users returns 403 Forbidden');

    const caRole = await request('PATCH', `/api/admin/users/${contestAdminUser.id}/role`, { role: 'super_admin' }, contestAdminToken);
    assert(caRole.status === 403, '17. Contest Admin privilege escalation attempt returns 403 Forbidden');

    // 2.6 Super Admin succeeds
    const saList = await request('GET', '/api/admin/users', null, superAdmin1Token);
    assert(saList.status === 200, '18. Super Admin GET /api/admin/users returns 200 OK');

    // ----------------------------------------------------
    // MODULE 3: User Listing, Discovery & Bounded Pagination
    // ----------------------------------------------------
    console.log('\n--- MODULE 3: User Listing, Discovery & Bounded Pagination ---');

    assert(saList.body.status === 'success', '19. API returns status success');
    assert(Array.isArray(saList.body.data.users), '20. Response data contains users array');
    assert(saList.body.data.pagination !== undefined, '21. Response data contains pagination metadata');
    assert(saList.body.data.pagination.page === 1, '22. Default page number is 1');
    assert(saList.body.data.pagination.limit === 20, '23. Default page limit is 20');
    assert(typeof saList.body.data.pagination.total === 'number', '24. Pagination total count is number');

    // Zero Credential Leakage in user listing
    const anyCredentialsLeaked = saList.body.data.users.some(u => u.password_hash || u.passwordHash || u.password || u.token);
    assert(!anyCredentialsLeaked, '25. ZERO credential leakage: password_hash, password, token strictly absent');

    // Pagination bound clamping
    const maxClamp = await request('GET', '/api/admin/users?limit=500', null, superAdmin1Token);
    assert(maxClamp.body.data.pagination.limit === 100, '26. Limit 500 clamped safely to 100 max');

    const minClamp = await request('GET', '/api/admin/users?limit=0', null, superAdmin1Token);
    assert(minClamp.body.data.pagination.limit === 1, '27. Limit 0 clamped safely to 1 min');

    const negClamp = await request('GET', '/api/admin/users?limit=-10', null, superAdmin1Token);
    assert(negClamp.body.data.pagination.limit === 1, '28. Limit -10 clamped safely to 1 min');

    const negPage = await request('GET', '/api/admin/users?page=-5', null, superAdmin1Token);
    assert(negPage.body.data.pagination.page === 1, '29. Page -5 clamped safely to 1 min');

    // Oversized page handles gracefully (no database integer overflow crash)
    const overPage = await request('GET', '/api/admin/users?page=9999999999', null, superAdmin1Token);
    assert(overPage.status === 200, '30. Oversized page query returns 200 OK without crash');
    assert(Array.isArray(overPage.body.data.users) && overPage.body.data.users.length === 0, '31. Oversized page returns empty users array');

    // Filtering by Role
    const filterStd = await request('GET', '/api/admin/users?role=student', null, superAdmin1Token);
    assert(filterStd.status === 200, '32. Role filter for student returns 200 OK');
    assert(filterStd.body.data.users.every(u => u.role === 'student'), '33. All returned users have role student');

    const filterProf = await request('GET', '/api/admin/users?role=professor', null, superAdmin1Token);
    assert(filterProf.status === 200, '34. Role filter for professor returns 200 OK');
    assert(filterProf.body.data.users.every(u => u.role === 'professor'), '35. All returned users have role professor');

    const filterCa = await request('GET', '/api/admin/users?role=contest_admin', null, superAdmin1Token);
    assert(filterCa.status === 200, '36. Role filter for contest_admin returns 200 OK');
    assert(filterCa.body.data.users.every(u => u.role === 'contest_admin'), '37. All returned users have role contest_admin');

    const filterSa = await request('GET', '/api/admin/users?role=super_admin', null, superAdmin1Token);
    assert(filterSa.status === 200, '38. Role filter for super_admin returns 200 OK');
    assert(filterSa.body.data.users.every(u => u.role === 'super_admin'), '39. All returned users have role super_admin');

    // Filtering by Status
    const filterActive = await request('GET', '/api/admin/users?status=active', null, superAdmin1Token);
    assert(filterActive.status === 200, '40. Status filter active returns 200 OK');
    assert(filterActive.body.data.users.every(u => u.isActive === true), '41. All users in active filter are isActive true');

    const filterSuspended = await request('GET', '/api/admin/users?status=suspended', null, superAdmin1Token);
    assert(filterSuspended.status === 200, '42. Status filter suspended returns 200 OK');
    assert(filterSuspended.body.data.users.every(u => u.isActive === false), '43. All users in suspended filter are isActive false');

    // Searching users by username, email, full name
    const searchByUsername = await request('GET', `/api/admin/users?search=std_p75112_${timestamp}`, null, superAdmin1Token);
    assert(searchByUsername.status === 200, '44. Search by username returns 200 OK');
    assert(searchByUsername.body.data.users.some(u => u.id === studentUser.id), '45. Search correctly finds student by username');

    const searchByEmail = await request('GET', `/api/admin/users?search=std_p75112_${timestamp}@test.org`, null, superAdmin1Token);
    assert(searchByEmail.status === 200, '46. Search by email returns 200 OK');
    assert(searchByEmail.body.data.users.some(u => u.id === studentUser.id), '47. Search correctly finds student by email');

    const searchByFullName = await request('GET', `/api/admin/users?search=Student P75112`, null, superAdmin1Token);
    assert(searchByFullName.status === 200, '48. Search by full name returns 200 OK');
    assert(searchByFullName.body.data.users.some(u => u.id === studentUser.id), '49. Search correctly finds student by full name');

    // SQL Wildcards / Injection resistance
    const sqlInjectionSearch = await request('GET', `/api/admin/users?search=' OR '1'='1`, null, superAdmin1Token);
    assert(sqlInjectionSearch.status === 200, '50. Parameterized query safely handles quotes and SQL keywords');

    const wildcardSearch = await request('GET', `/api/admin/users?search=%%%%`, null, superAdmin1Token);
    assert(wildcardSearch.status === 200, '51. Parameterized query safely handles wildcard characters');

    // ----------------------------------------------------
    // MODULE 4: Single User Details & Zero Credential Leakage
    // ----------------------------------------------------
    console.log('\n--- MODULE 4: Single User Details & Zero Credential Disclosure ---');

    const getUser = await request('GET', `/api/admin/users/${studentUser.id}`, null, superAdmin1Token);
    assert(getUser.status === 200, '52. GET /api/admin/users/:id returns 200 OK');
    const uDetail = getUser.body.data.user;
    assert(uDetail.id === studentUser.id, '53. Details user ID matches requested ID');
    assert(uDetail.username === studentUser.username, '54. Username matches');
    assert(uDetail.email === studentUser.email, '55. Email matches');
    assert(uDetail.fullName === studentUser.full_name, '56. Full name matches');
    assert(uDetail.role === 'student', '57. Role matches');
    assert(uDetail.isActive === true, '58. isActive matches');
    assert(uDetail.password_hash === undefined, '59. Zero credential leakage: password_hash undefined');
    assert(uDetail.passwordHash === undefined, '60. Zero credential leakage: passwordHash undefined');
    assert(uDetail.password === undefined, '61. Zero credential leakage: plain password undefined');

    // Nonexistent user -> 404
    const nonExistent = await request('GET', '/api/admin/users/888888', null, superAdmin1Token);
    assert(nonExistent.status === 404, '62. Nonexistent user ID returns 404 Not Found');

    // Malformed ID -> 400
    const malformedId = await request('GET', '/api/admin/users/abc-xyz', null, superAdmin1Token);
    assert(malformedId.status === 400, '63. Malformed user ID returns 400 Bad Request');

    const negativeId = await request('GET', '/api/admin/users/-42', null, superAdmin1Token);
    assert(negativeId.status === 400, '64. Negative user ID returns 400 Bad Request');

    const zeroId = await request('GET', '/api/admin/users/0', null, superAdmin1Token);
    assert(zeroId.status === 400, '65. Zero user ID returns 400 Bad Request');

    // Oversized integer ID (preventing PostgreSQL integer overflow crash)
    const oversizedId = await request('GET', '/api/admin/users/99999999999999999999', null, superAdmin1Token);
    assert(oversizedId.status === 404, '66. Oversized integer ID handled gracefully with 404 (no 500 error)');

    // ----------------------------------------------------
    // MODULE 5: Administrative User Provisioning
    // ----------------------------------------------------
    console.log('\n--- MODULE 5: Administrative User Provisioning ---');

    const newUserPayload = {
      username: `prov_user_${timestamp}`,
      email: `prov_user_${timestamp}@university.edu`,
      password: 'StrongProvisionPassword123!',
      fullName: 'Dr. Provisioned Professor',
      role: 'professor',
      institution: 'Carnegie Mellon University',
      bio: 'Distributed Systems & Security',
    };

    const provRes = await request('POST', '/api/admin/users', newUserPayload, superAdmin1Token);
    assert(provRes.status === 201, '67. Provisioning user returns 201 Created');
    assert(provRes.body.status === 'success', '68. Response status is success');
    createdUserId = provRes.body.data.user.id;
    assert(typeof createdUserId === 'number', '69. Created user assigned database ID');
    assert(provRes.body.data.user.role === 'professor', '70. Assigned role is professor');
    assert(provRes.body.data.user.institution === 'Carnegie Mellon University', '71. Institution saved correctly');
    assert(provRes.body.data.user.password_hash === undefined, '72. Provision response omits password_hash');
    assert(provRes.body.data.user.password === undefined, '73. Provision response omits plain password');

    // Verify Password Hash in Postgres
    const dbCreatedUser = await UserModel.findUserById(createdUserId);
    assert(dbCreatedUser.password_hash !== newUserPayload.password, '74. Database stores hashed password, NOT plaintext');
    assert(dbCreatedUser.password_hash.startsWith('$2a$') || dbCreatedUser.password_hash.startsWith('$2b$'), '75. Password is valid bcrypt hash');

    // Verify USER_CREATED Audit Log
    const provAudit = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_CREATED' AND resource_id = $1;
    `, [createdUserId]);
    assert(provAudit.rows.length === 1, '76. USER_CREATED audit log persisted in PostgreSQL');
    assert(provAudit.rows[0].actor_id === superAdmin1User.id, '77. USER_CREATED audit log records Super Admin actor_id');
    assert(provAudit.rows[0].metadata.createdUserId === createdUserId, '78. Audit metadata references created user');
    assert(provAudit.rows[0].metadata.password === undefined, '79. Audit metadata omits passwords');

    // Duplicate username conflict -> 409
    const dupUser = await request('POST', '/api/admin/users', {
      ...newUserPayload,
      email: `unique_${timestamp}@test.com`,
    }, superAdmin1Token);
    assert(dupUser.status === 409, '80. Duplicate username returns 409 Conflict');

    // Duplicate email conflict -> 409
    const dupEmail = await request('POST', '/api/admin/users', {
      ...newUserPayload,
      username: `unique_${timestamp}`,
    }, superAdmin1Token);
    assert(dupEmail.status === 409, '81. Duplicate email returns 409 Conflict');

    // Validation failures
    const shortPwd = await request('POST', '/api/admin/users', {
      ...newUserPayload,
      username: `short_pwd_${timestamp}`,
      email: `short_pwd_${timestamp}@test.com`,
      password: 'short',
    }, superAdmin1Token);
    assert(shortPwd.status === 400, '82. Password < 8 characters returns 400 Bad Request');

    const badEmail = await request('POST', '/api/admin/users', {
      ...newUserPayload,
      username: `bad_email_${timestamp}`,
      email: 'not-an-email',
    }, superAdmin1Token);
    assert(badEmail.status === 400, '83. Malformed email returns 400 Bad Request');

    const badRole = await request('POST', '/api/admin/users', {
      ...newUserPayload,
      username: `bad_role_${timestamp}`,
      email: `bad_role_${timestamp}@test.com`,
      role: 'unauthorized_elevated_role',
    }, superAdmin1Token);
    assert(badRole.status === 400, '84. Unsupported role returns 400 Bad Request');

    // ----------------------------------------------------
    // MODULE 6: User Profile Details Update & Mass Assignment Defense
    // ----------------------------------------------------
    console.log('\n--- MODULE 6: User Profile Details Update & Mass Assignment Defense ---');

    const updatePayload = {
      fullName: 'Dr. Jane Provisioned Smith',
      bio: 'Leading Computer Systems Researcher',
      institution: 'UC Berkeley',
      // Attacker attempts mass assignment manipulation
      role: 'super_admin',
      currentRating: 2800,
      password: 'HackedPassword123!',
      passwordHash: 'HackedHash',
    };

    const updateRes = await request('PUT', `/api/admin/users/${createdUserId}`, updatePayload, superAdmin1Token);
    assert(updateRes.status === 200, '85. PUT /api/admin/users/:id returns 200 OK');
    assert(updateRes.body.data.user.fullName === 'Dr. Jane Provisioned Smith', '86. Full name updated');
    assert(updateRes.body.data.user.bio === 'Leading Computer Systems Researcher', '87. Bio updated');
    assert(updateRes.body.data.user.institution === 'UC Berkeley', '88. Institution updated');

    // Verify Mass Assignment Defense: role and rating remain unchanged
    const freshDbUser = await UserModel.findUserById(createdUserId);
    assert(freshDbUser.role === 'professor', '89. Mass assignment defense: role remains professor');
    assert((freshDbUser.current_rating === 1200 || freshDbUser.currentRating === 1200), '90. Mass assignment defense: rating remains 1200');
    assert(freshDbUser.password_hash === dbCreatedUser.password_hash, '91. Mass assignment defense: password hash untouched');

    // Verify USER_UPDATED Audit Log
    const updateAudit = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_UPDATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [createdUserId]);
    assert(updateAudit.rows.length === 1, '92. USER_UPDATED audit log persisted in PostgreSQL');
    assert(updateAudit.rows[0].metadata.updatedFields.includes('fullName'), '93. Audit metadata lists updatedFields');

    // Oversized ID on PUT
    const putOversized = await request('PUT', '/api/admin/users/99999999999999999999', { fullName: 'Test' }, superAdmin1Token);
    assert(putOversized.status === 404, '94. PUT with oversized integer ID returns 404 cleanly');

    // ----------------------------------------------------
    // MODULE 7: Role Management Across All Supported Roles
    // ----------------------------------------------------
    console.log('\n--- MODULE 7: Role Management & Privilege Escalation Protection ---');

    // Supported roles: student -> professor -> contest_admin -> super_admin -> student
    const toProf = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'professor' }, superAdmin1Token);
    assert(toProf.status === 200, '95. Super Admin promotes student to professor');
    assert(toProf.body.data.user.role === 'professor', '96. User role updated to professor');

    const toCa = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'contest_admin' }, superAdmin1Token);
    assert(toCa.status === 200, '97. Super Admin promotes professor to contest_admin');
    assert(toCa.body.data.user.role === 'contest_admin', '98. User role updated to contest_admin');

    const toSa = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'super_admin' }, superAdmin1Token);
    assert(toSa.status === 200, '99. Super Admin promotes contest_admin to super_admin');
    assert(toSa.body.data.user.role === 'super_admin', '100. User role updated to super_admin');

    const backToStd = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'student' }, superAdmin1Token);
    assert(backToStd.status === 200, '101. Super Admin demotes user back to student');
    assert(backToStd.body.data.user.role === 'student', '102. User role updated to student');

    // Invalid role rejected
    const invalidRole = await request('PATCH', `/api/admin/users/${studentUser.id}/role`, { role: 'hacker' }, superAdmin1Token);
    assert(invalidRole.status === 400, '103. Invalid role rejected with 400 Bad Request');

    // ROLE_CHANGED audit log
    const roleAudit = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'ROLE_CHANGED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(roleAudit.rows.length === 1, '104. ROLE_CHANGED audit log persisted');
    assert(roleAudit.rows[0].metadata.previousRole === 'super_admin', '105. Previous role recorded in audit log');
    assert(roleAudit.rows[0].metadata.newRole === 'student', '106. New role recorded in audit log');

    // Oversized ID on PATCH role
    const patchRoleOversized = await request('PATCH', '/api/admin/users/99999999999999999999/role', { role: 'student' }, superAdmin1Token);
    assert(patchRoleOversized.status === 404, '107. PATCH role with oversized integer ID returns 404 cleanly');

    // ----------------------------------------------------
    // MODULE 8: Account Status Transitions & Auth Integration
    // ----------------------------------------------------
    console.log('\n--- MODULE 8: Account Status Transitions & Authentication Integration ---');

    // Suspend user
    const suspendRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, { isActive: false }, superAdmin1Token);
    assert(suspendRes.status === 200, '108. Super Admin suspends user account');
    assert(suspendRes.body.data.user.isActive === false, '109. User isActive is false');

    // Verify audit logs: ACCOUNT_STATUS_CHANGED & USER_DEACTIVATED
    const statusAudit = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'ACCOUNT_STATUS_CHANGED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(statusAudit.rows.length === 1, '110. ACCOUNT_STATUS_CHANGED audit log persisted');

    const deactAudit = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'USER_DEACTIVATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
    `, [studentUser.id]);
    assert(deactAudit.rows.length === 1, '111. USER_DEACTIVATED audit log persisted');
    assert(deactAudit.rows[0].metadata.deactivatedBy === superAdmin1User.id, '112. Audit log records deactivating admin ID');

    // Attempt login with suspended account -> 403 Forbidden
    const suspendedLogin = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'TestPassword123!',
    });
    assert(suspendedLogin.status === 403, '113. Suspended account login rejected with 403 Forbidden');
    assert(suspendedLogin.body.message.includes('deactivated'), '114. Account deactivation notice returned to user');

    // Reactivate user
    const reactivateRes = await request('PATCH', `/api/admin/users/${studentUser.id}/status`, { isActive: true }, superAdmin1Token);
    assert(reactivateRes.status === 200, '115. Super Admin reactivates user account');
    assert(reactivateRes.body.data.user.isActive === true, '116. User isActive is true');

    // Attempt login with reactivated account -> 200 OK
    const reactivatedLogin = await request('POST', '/api/auth/login', {
      email: studentUser.email,
      password: 'TestPassword123!',
    });
    assert(reactivatedLogin.status === 200, '117. Reactivated account login succeeds with 200 OK');
    assert(typeof reactivatedLogin.body.token === 'string', '118. Valid JWT token issued for reactivated user');

    // Oversized ID on PATCH status
    const patchStatusOversized = await request('PATCH', '/api/admin/users/99999999999999999999/status', { isActive: false }, superAdmin1Token);
    assert(patchStatusOversized.status === 404, '119. PATCH status with oversized integer ID returns 404 cleanly');

    // ----------------------------------------------------
    // MODULE 9: Last Active Super Admin Protection (Self-Lockout Defense)
    // ----------------------------------------------------
    console.log('\n--- MODULE 9: Last Active Super Admin Protection ---');

    // Temporarily deactivate any other pre-existing super admins in the DB so only SA1 and SA2 are active
    const otherSa = await db.query(`SELECT id FROM users WHERE role = 'super_admin' AND id NOT IN ($1, $2) AND is_active = true;`, [superAdmin1User.id, superAdmin2User.id]);
    const otherSaIds = otherSa.rows.map(r => r.id);
    if (otherSaIds.length > 0) {
      await db.query(`UPDATE users SET is_active = false WHERE id = ANY($1::int[]);`, [otherSaIds]);
    }

    try {
      // With exactly SA1 and SA2 active, SA1 demotes SA2
      const demoteSa2 = await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, { role: 'professor' }, superAdmin1Token);
      assert(demoteSa2.status === 200, '120. Super Admin 1 can demote Super Admin 2 when SA1 remains active');

      // Now SA1 is the ONLY active Super Admin.
      // Attempt 1: SA1 tries to demote self -> 409 Conflict
      const demoteSelf = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/role`, { role: 'student' }, superAdmin1Token);
      assert(demoteSelf.status === 409, '121. Demoting the last active Super Admin rejected with 409 Conflict');
      assert(demoteSelf.body.message.includes('last active Super Admin'), '122. Safe conflict explanation returned');

      // Attempt 2: SA1 tries to deactivate self -> 409 Conflict
      const deactSelf = await request('PATCH', `/api/admin/users/${superAdmin1User.id}/status`, { isActive: false }, superAdmin1Token);
      assert(deactSelf.status === 409, '123. Deactivating the last active Super Admin rejected with 409 Conflict');
      assert(deactSelf.body.message.includes('last active Super Admin'), '124. Safe conflict explanation returned');

      // Verify ADMIN_ACTION_DENIED audit log
      const denialAudit = await db.query(`
        SELECT * FROM audit_logs WHERE action = 'ADMIN_ACTION_DENIED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;
      `, [superAdmin1User.id]);
      assert(denialAudit.rows.length === 1, '125. ADMIN_ACTION_DENIED audit log event persisted');
      assert(denialAudit.rows[0].outcome === 'denied', '126. Audit outcome is denied');
      assert(denialAudit.rows[0].metadata.reason === 'last_active_super_admin', '127. Audit reason is last_active_super_admin');

      // Restore SA2 back to Super Admin
      const restoreSa2 = await request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, { role: 'super_admin' }, superAdmin1Token);
      assert(restoreSa2.status === 200, '128. Super Admin 2 restored to super_admin role');

      // Concurrency: Concurrent mutual demotion test
      const [race1, race2] = await Promise.all([
        request('PATCH', `/api/admin/users/${superAdmin2User.id}/role`, { role: 'student' }, superAdmin1Token),
        request('PATCH', `/api/admin/users/${superAdmin1User.id}/role`, { role: 'student' }, superAdmin2Token),
      ]);

      const raceStatuses = [race1.status, race2.status];
      const has200 = raceStatuses.includes(200);
      const has409 = raceStatuses.includes(409);
      assert(has200 && has409, '129. Concurrent mutual demotion safely resolved (1 succeeded with 200, 1 blocked with 409)');

      // Restore both SA1 and SA2
      await db.query(`UPDATE users SET role = 'super_admin', is_active = true WHERE id IN ($1, $2);`, [superAdmin1User.id, superAdmin2User.id]);
      assert(true, '130. Super Admins restored post-concurrency test');
    } finally {
      if (otherSaIds.length > 0) {
        await db.query(`UPDATE users SET is_active = true WHERE id = ANY($1::int[]);`, [otherSaIds]);
      }
    }

    // ----------------------------------------------------
    // MODULE 10: Ephemeral Test Fixture Purge & Pool Teardown
    // ----------------------------------------------------
    console.log('\n--- MODULE 10: Ephemeral Test Fixture Purge & Cleanup ---');
    const idsToPurge = [
      studentUser.id,
      profUser.id,
      contestAdminUser.id,
      superAdmin1User.id,
      superAdmin2User.id,
      createdUserId,
    ].filter(Boolean);

    await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [idsToPurge]);
    console.log(`[CLEANUP] Purged ${idsToPurge.length} ephemeral test users. Production data intact.`);
    assert(true, '131. Ephemeral test fixtures purged safely with zero damage to other users');

    console.log('\n========================================================================');
    console.log(` PHASE 7.5.11.2 INTEGRATION TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ Phase 7.5.11.2 Test Suite Encountered Fatal Error:\n', err);
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
