/**
 * Phase 5.9.3 Comprehensive Persistent Audit Logging Verification Test Suite
 * 
 * Verifies complete, hardened audit logging architecture:
 * 1. Database schema, constraints, indexes & ON DELETE SET NULL
 * 2. Append-only persistence & lifecycle survival
 * 3. Deeply nested & recursive metadata sanitization (passwords, JWTs, tokens, source code, keys)
 * 4. Super Admin RBAC & endpoint protection (401/403 for unauthorized personas)
 * 5. Append-only endpoint immutability (No PUT/PATCH/DELETE)
 * 6. SQL injection resilience on all query filters
 * 7. Transactional atomicity (commit & rollback synchronization)
 * 8. Comprehensive event coverage & forensic context
 * 9. Readiness for Phase 5.9.4 Admin User Management events
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const AuditLogger = require('./src/services/auditLogger');
const AuditLogModel = require('./src/models/auditLogModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');

let server;
let baseUrl;
const timestamp = Date.now();

// Test Actors
let studentUser, studentToken;
let profUser, profToken;
let contestAdminUser, contestAdminToken;
let superAdminUser, superAdminToken;

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
  console.log(' STARTING PHASE 5.9.3 PERSISTENT AUDIT LOGGING SUITE');
  console.log('=======================================================\n');

  try {
    // Start HTTP server on dynamic port
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // ----------------------------------------------------
    // 1. Database Schema, Constraints & Indexes Verification
    // ----------------------------------------------------
    console.log('--- 1. Database Schema & Index Verification ---');
    const tableRes = await db.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs';
    `);
    assert(tableRes.rows.length === 1, '1. audit_logs table exists in PostgreSQL database');

    const colRes = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'audit_logs';
    `);
    const cols = colRes.rows.map(r => r.column_name);
    const expectedCols = ['id', 'actor_id', 'action', 'resource_type', 'resource_id', 'outcome', 'metadata', 'ip_address', 'created_at'];
    expectedCols.forEach(c => {
      assert(cols.includes(c), `2. Column '${c}' exists in audit_logs table`);
    });

    // Check indexes
    const idxRes = await db.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'audit_logs';
    `);
    const indexNames = idxRes.rows.map(r => r.indexname);
    assert(indexNames.includes('idx_audit_logs_actor_id'), '3a. Index idx_audit_logs_actor_id exists');
    assert(indexNames.includes('idx_audit_logs_action'), '3b. Index idx_audit_logs_action exists');
    assert(indexNames.includes('idx_audit_logs_resource'), '3c. Index idx_audit_logs_resource exists');
    assert(indexNames.includes('idx_audit_logs_outcome'), '3d. Index idx_audit_logs_outcome exists');
    assert(indexNames.includes('idx_audit_logs_created_at'), '3e. Index idx_audit_logs_created_at exists');

    // Check outcome constraint
    const checkRes = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'audit_logs'::regclass AND contype = 'c';
    `);
    const hasOutcomeCheck = checkRes.rows.some(r => r.def.includes('outcome') && r.def.includes('success') && r.def.includes('failure') && r.def.includes('denied'));
    assert(hasOutcomeCheck, '4. Outcome CHECK constraint enforces success, failure, denied');

    // Check actor foreign key ON DELETE SET NULL
    const fkRes = await db.query(`
      SELECT conname, confdeltype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'audit_logs'::regclass AND contype = 'f' AND conname = 'audit_logs_actor_id_fkey';
    `);
    assert(fkRes.rows.length === 1 && fkRes.rows[0].confdeltype === 'n', '5. Actor foreign key uses ON DELETE SET NULL (confdeltype = n)');

    // ----------------------------------------------------
    // 2. Setting Up Test Actors
    // ----------------------------------------------------
    console.log('\n--- 2. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('Password123!');

    const stdRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'student') RETURNING *;
    `, [`std_593_${timestamp}`, `std_593_${timestamp}@test.com`, pwdHash, 'Student 593']);
    studentUser = stdRes.rows[0];
    studentToken = generateToken(studentUser);

    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'professor') RETURNING *;
    `, [`prof_593_${timestamp}`, `prof_593_${timestamp}@test.com`, pwdHash, 'Prof 593']);
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);

    const caRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'contest_admin') RETURNING *;
    `, [`ca_593_${timestamp}`, `ca_593_${timestamp}@test.com`, pwdHash, 'CA 593']);
    contestAdminUser = caRes.rows[0];
    contestAdminToken = generateToken(contestAdminUser);

    const saRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'super_admin') RETURNING *;
    `, [`sa_593_${timestamp}`, `sa_593_${timestamp}@test.com`, pwdHash, 'Super Admin 593']);
    superAdminUser = saRes.rows[0];
    superAdminToken = generateToken(superAdminUser);

    assert(studentUser && profUser && contestAdminUser && superAdminUser, '6. All test actors created successfully');

    // ----------------------------------------------------
    // 3. Metadata Sanitization & Deep Redaction Verification
    // ----------------------------------------------------
    console.log('\n--- 3. Metadata Sanitization & Deep Redaction Verification ---');
    const dirtyMetadata = {
      safeField: 'Forensic event summary',
      password: 'super_secret_password',
      password_hash: '$2b$10$xyz...',
      passwordHash: '$2b$10$abc...',
      token: 'secret-token-value',
      authToken: 'auth-token-123',
      accessToken: 'access-token-456',
      refreshToken: 'refresh-token-789',
      bearerToken: 'bearer-token-000',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTYxNjIzOTAyMn0.dummySignatureValue',
      rawJwtInString: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTYxNjIzOTAyMn0.dummySignatureValue',
      authorization: 'Bearer secret_auth_header',
      cookie: 'session_id=123456',
      setCookie: 'session_id=123456; Secure',
      apiKey: 'api-key-live-12345',
      userApiKey: 'custom-api-key',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----',
      clientSecret: 'secret_oauth_client_secret',
      credentials: { username: 'test', pass: '123' },
      sourceCode: 'int main() { return 0; }',
      code: 'print("hello world")',
      solutionCode: 'def solve(): pass',
      inputData: '1 2 3 4 5',
      expectedOutput: '15',
      hiddenTest: { input: 'secret', output: 'secret' },
      hiddenTests: [{ input: 'hidden1' }, { input: 'hidden2' }],
      nestedLevel1: {
        safeChild: 'Child safe string',
        password: 'nested_secret_password',
        nestedLevel2: {
          deepSafe: 'Deeply nested value',
          privateKey: 'deep_private_key',
          nestedArray: [
            { safeItem: 1, token: 'array_token' },
            { safeItem: 2, apiKey: 'array_api_key' },
          ],
        },
      },
      arrayValues: ['safe_array_item_1', 'safe_array_item_2'],
    };

    const sanitized = AuditLogger.sanitize(dirtyMetadata);

    assert(sanitized.safeField === 'Forensic event summary', '7a. Sanitizer preserved safe top-level fields');
    assert(sanitized.password === undefined, '7b. Sanitizer stripped password');
    assert(sanitized.password_hash === undefined, '7c. Sanitizer stripped password_hash');
    assert(sanitized.passwordHash === undefined, '7d. Sanitizer stripped passwordHash');
    assert(sanitized.token === undefined, '7e. Sanitizer stripped token');
    assert(sanitized.authToken === undefined, '7f. Sanitizer stripped authToken');
    assert(sanitized.accessToken === undefined, '7g. Sanitizer stripped accessToken');
    assert(sanitized.refreshToken === undefined, '7h. Sanitizer stripped refreshToken');
    assert(sanitized.bearerToken === undefined, '7i. Sanitizer stripped bearerToken');
    assert(sanitized.jwt === undefined, '7j. Sanitizer stripped jwt');
    assert(sanitized.rawJwtInString === undefined, '7k. Sanitizer redacted JWT Bearer strings inside values');
    assert(sanitized.authorization === undefined, '7l. Sanitizer stripped authorization');
    assert(sanitized.cookie === undefined, '7m. Sanitizer stripped cookie');
    assert(sanitized.setCookie === undefined, '7n. Sanitizer stripped setCookie');
    assert(sanitized.apiKey === undefined, '7o. Sanitizer stripped apiKey');
    assert(sanitized.userApiKey === undefined, '7p. Sanitizer stripped userApiKey');
    assert(sanitized.privateKey === undefined, '7q. Sanitizer stripped privateKey');
    assert(sanitized.clientSecret === undefined, '7r. Sanitizer stripped clientSecret');
    assert(sanitized.credentials === undefined, '7s. Sanitizer stripped credentials');
    assert(sanitized.sourceCode === undefined, '7t. Sanitizer stripped sourceCode');
    assert(sanitized.code === undefined, '7u. Sanitizer stripped code');
    assert(sanitized.solutionCode === undefined, '7v. Sanitizer stripped solutionCode');
    assert(sanitized.inputData === undefined, '7w. Sanitizer stripped inputData');
    assert(sanitized.expectedOutput === undefined, '7x. Sanitizer stripped expectedOutput');
    assert(sanitized.hiddenTest === undefined, '7y. Sanitizer stripped hiddenTest');
    assert(sanitized.hiddenTests === undefined, '7z. Sanitizer stripped hiddenTests');

    // Nested sanitization checks
    assert(sanitized.nestedLevel1.safeChild === 'Child safe string', '8a. Sanitizer preserved nested safeChild');
    assert(sanitized.nestedLevel1.password === undefined, '8b. Sanitizer stripped nested password');
    assert(sanitized.nestedLevel1.nestedLevel2.deepSafe === 'Deeply nested value', '8c. Sanitizer preserved deepSafe');
    assert(sanitized.nestedLevel1.nestedLevel2.privateKey === undefined, '8d. Sanitizer stripped deeply nested privateKey');
    assert(sanitized.nestedLevel1.nestedLevel2.nestedArray[0].safeItem === 1, '8e. Sanitizer preserved array object safeItem');
    assert(sanitized.nestedLevel1.nestedLevel2.nestedArray[0].token === undefined, '8f. Sanitizer stripped array object token');
    assert(sanitized.nestedLevel1.nestedLevel2.nestedArray[1].apiKey === undefined, '8g. Sanitizer stripped array object apiKey');
    assert(Array.isArray(sanitized.arrayValues) && sanitized.arrayValues.length === 2, '8h. Sanitizer preserved safe array values');

    // Prototype pollution check
    const protoAttack = JSON.parse('{"__proto__": {"polluted": true}, "safe": "value"}');
    const sanitizedProto = AuditLogger.sanitize(protoAttack);
    assert(sanitizedProto.safe === 'value' && !sanitizedProto.__proto__?.polluted, '8i. Sanitizer defended against prototype pollution keys');

    // ----------------------------------------------------
    // 4. Privileged Action Logging & Persistence Integrity
    // ----------------------------------------------------
    console.log('\n--- 4. Privileged Action Logging & Persistence Integrity ---');
    const auditRes = await AuditLogger.logAction({
      actor: profUser,
      action: 'PROBLEM_CREATED',
      resourceType: 'problem',
      resourceId: 9999,
      outcome: 'success',
      metadata: { difficulty: 'medium', codingMode: 'function' },
      ipAddress: '192.168.1.50',
    });

    assert(auditRes.id !== null, '9a. AuditLogger returned persisted record ID');
    assert(auditRes.action === 'PROBLEM_CREATED', '9b. AuditLogger recorded action PROBLEM_CREATED');
    assert(auditRes.resourceType === 'problem', '9c. AuditLogger recorded resourceType problem');
    assert(auditRes.outcome === 'success', '9d. AuditLogger recorded outcome success');

    // Verify row directly in PostgreSQL table
    const dbAuditRow = await AuditLogModel.findAuditLogById(auditRes.id);
    assert(dbAuditRow !== null, '10a. Audit log persisted in PostgreSQL audit_logs table');
    assert(dbAuditRow.actorId === profUser.id, '10b. Audit log actorId matches professor');
    assert(dbAuditRow.actorUsername === profUser.username, '10c. Joined actor username matches professor');
    assert(dbAuditRow.action === 'PROBLEM_CREATED', '10d. Persisted action is PROBLEM_CREATED');
    assert(dbAuditRow.ipAddress === '192.168.1.50', '10e. Persisted IP address matches 192.168.1.50');

    // ----------------------------------------------------
    // 5. Privileged Action Denied (Security Failure Context)
    // ----------------------------------------------------
    console.log('\n--- 5. Privileged Action Denied (Security Failure Context) ---');
    const denialAudit = await AuditLogger.logAction({
      actor: studentUser,
      action: 'PRIVILEGED_ACTION_DENIED',
      resourceType: 'contest',
      resourceId: 1234,
      outcome: 'denied',
      metadata: { attemptedAction: 'CONTEST_DELETED', runtimeState: 'running' },
      ipAddress: '10.0.0.1',
    });

    assert(denialAudit.outcome === 'denied', '11a. Outcome normalized to denied');
    const dbDenial = await AuditLogModel.findAuditLogById(denialAudit.id);
    assert(dbDenial !== null, '11b. Denial audit record persisted in PostgreSQL');
    assert(dbDenial.outcome === 'denied', '11c. Persisted outcome is denied');
    assert(dbDenial.metadata.attemptedAction === 'CONTEST_DELETED', '11d. Forensic context contains attemptedAction');

    // ----------------------------------------------------
    // 6. Super Admin Audit Inspection API & RBAC Restrictions
    // ----------------------------------------------------
    console.log('\n--- 6. Super Admin Audit Inspection API & RBAC Restrictions ---');
    
    // Unauthenticated request -> 401
    const unauthRes = await request('GET', '/api/admin/audit-logs');
    assert(unauthRes.status === 401, '12a. Unauthenticated request to /api/admin/audit-logs returns 401 Unauthorized');

    // Student request -> 403
    const stdResAudit = await request('GET', '/api/admin/audit-logs', null, studentToken);
    assert(stdResAudit.status === 403, '12b. Student request to /api/admin/audit-logs returns 403 Forbidden');

    // Professor request -> 403
    const profResAudit = await request('GET', '/api/admin/audit-logs', null, profToken);
    assert(profResAudit.status === 403, '12c. Professor request to /api/admin/audit-logs returns 403 Forbidden');

    // Contest Admin request -> 403
    const caResAudit = await request('GET', '/api/admin/audit-logs', null, contestAdminToken);
    assert(caResAudit.status === 403, '12d. Contest Admin request to /api/admin/audit-logs returns 403 Forbidden');

    // Super Admin request -> 200
    const saResAudit = await request('GET', '/api/admin/audit-logs', null, superAdminToken);
    assert(saResAudit.status === 200, '12e. Super Admin request to /api/admin/audit-logs returns 200 OK');
    assert(Array.isArray(saResAudit.body.data.logs), '12f. Super Admin response contains logs array');
    assert(saResAudit.body.data.pagination !== undefined, '12g. Super Admin response contains pagination object');
    assert(saResAudit.body.data.pagination.page === 1, '12h. Pagination default page is 1');
    assert(saResAudit.body.data.pagination.limit === 20, '12i. Pagination default limit is 20');

    // ----------------------------------------------------
    // 7. Filtering & Bounded Pagination Verification
    // ----------------------------------------------------
    console.log('\n--- 7. Filtering & Bounded Pagination Verification ---');
    
    // Action filter
    const actionFilter = await request('GET', '/api/admin/audit-logs?action=PROBLEM_CREATED', null, superAdminToken);
    assert(actionFilter.status === 200, '13a. Filter by action returns 200 OK');
    assert(actionFilter.body.data.logs.every(l => l.action === 'PROBLEM_CREATED'), '13b. All returned logs match action PROBLEM_CREATED');

    // Actor ID filter
    const actorFilter = await request('GET', `/api/admin/audit-logs?actorId=${profUser.id}`, null, superAdminToken);
    assert(actorFilter.status === 200, '13c. Filter by actorId returns 200 OK');
    assert(actorFilter.body.data.logs.every(l => l.actorId === profUser.id), '13d. All returned logs match actorId');

    // Outcome filter
    const outcomeFilter = await request('GET', '/api/admin/audit-logs?outcome=denied', null, superAdminToken);
    assert(outcomeFilter.status === 200, '13e. Filter by outcome returns 200 OK');
    assert(outcomeFilter.body.data.logs.every(l => l.outcome === 'denied'), '13f. All returned logs match outcome denied');

    // Limit clamping (limit=500 should clamp to 100)
    const limitClamp = await request('GET', '/api/admin/audit-logs?limit=500', null, superAdminToken);
    assert(limitClamp.body.data.pagination.limit === 100, '13g. Excessive limit (>100) safely clamped to maximum 100');

    // Pagination offset & page stepping
    const page1 = await request('GET', '/api/admin/audit-logs?limit=1&page=1', null, superAdminToken);
    const page2 = await request('GET', '/api/admin/audit-logs?limit=1&page=2', null, superAdminToken);
    assert(page1.body.data.logs.length === 1 && page2.body.data.logs.length === 1, '13h. Limit=1 returns exactly 1 item per page');
    assert(page1.body.data.logs[0].id !== page2.body.data.logs[0].id, '13i. Page 1 and Page 2 contain non-overlapping records');

    // ----------------------------------------------------
    // 8. SQL Injection & Parameter Tampering Resilience
    // ----------------------------------------------------
    console.log('\n--- 8. SQL Injection & Parameter Tampering Resilience ---');
    const sqliActor = await request('GET', "/api/admin/audit-logs?actorId=1%20OR%201=1", null, superAdminToken);
    assert(sqliActor.status === 200, '14a. SQL injection in actorId safely parameterized (200 OK without SQL error)');

    const sqliAction = await request('GET', "/api/admin/audit-logs?action='''%20OR%20'1'='1", null, superAdminToken);
    assert(sqliAction.status === 200, '14b. SQL injection in action parameter safely handled');

    const sqliOutcome = await request('GET', "/api/admin/audit-logs?outcome=invalid_outcome_injection", null, superAdminToken);
    assert(sqliOutcome.status === 200, '14c. Invalid outcome parameter safely ignored');

    const sqliDate = await request('GET', "/api/admin/audit-logs?from=malformed-date-string", null, superAdminToken);
    assert(sqliDate.status === 200, '14d. Malformed date filter safely ignored without crash');

    // ----------------------------------------------------
    // 9. Append-Only Immutability Verification (No PUT/PATCH/DELETE)
    // ----------------------------------------------------
    console.log('\n--- 9. Append-Only Immutability Verification ---');
    const putRes = await request('PUT', `/api/admin/audit-logs/${auditRes.id}`, { action: 'MUTATED' }, superAdminToken);
    assert(putRes.status === 404 || putRes.status === 405, '15a. No PUT /api/admin/audit-logs/:id endpoint exists (404/405)');

    const patchRes = await request('PATCH', `/api/admin/audit-logs/${auditRes.id}`, { action: 'MUTATED' }, superAdminToken);
    assert(patchRes.status === 404 || patchRes.status === 405, '15b. No PATCH /api/admin/audit-logs/:id endpoint exists (404/405)');

    const delRes = await request('DELETE', `/api/admin/audit-logs/${auditRes.id}`, null, superAdminToken);
    assert(delRes.status === 404 || delRes.status === 405, '15c. No DELETE /api/admin/audit-logs/:id endpoint exists (404/405)');

    // Verify record in DB is unmodified
    const untouched = await AuditLogModel.findAuditLogById(auditRes.id);
    assert(untouched.action === 'PROBLEM_CREATED', '15d. Audit record remains 100% immutable and unmodified in PostgreSQL');

    // ----------------------------------------------------
    // 10. Transaction Boundaries & Atomicity Synchronization
    // ----------------------------------------------------
    console.log('\n--- 10. Transaction Boundaries & Atomicity Synchronization ---');
    
    // Success path: Both business mutation and audit log commit together
    const txClientSuccess = await db.getClient();
    let committedProblemId = null;
    let committedAuditId = null;
    try {
      await txClientSuccess.query('BEGIN');
      const pRes = await txClientSuccess.query(`
        INSERT INTO problems (title, description, difficulty, created_by, coding_mode, access_scope)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;
      `, [`Tx Audit Prob Success ${timestamp}`, 'Desc', 'easy', profUser.id, 'full_program', 'contest_private']);
      committedProblemId = pRes.rows[0].id;

      const aRes = await AuditLogger.logAction({
        actor: profUser,
        action: 'PROBLEM_CREATED',
        resourceType: 'problem',
        resourceId: committedProblemId,
        outcome: 'success',
        metadata: { txTest: true },
        client: txClientSuccess,
      });
      committedAuditId = aRes.id;
      await txClientSuccess.query('COMMIT');
    } finally {
      txClientSuccess.release();
    }

    const verifyProb = await db.query('SELECT 1 FROM problems WHERE id = $1', [committedProblemId]);
    const verifyAudit = await db.query('SELECT 1 FROM audit_logs WHERE id = $1', [committedAuditId]);
    assert(verifyProb.rows.length === 1, '16a. Business mutation committed successfully');
    assert(verifyAudit.rows.length === 1, '16b. Transactional audit log committed alongside business mutation');

    // Failure path: Business mutation failure rolls back audit log
    const txClientFail = await db.getClient();
    let rolledBackAuditId = null;
    try {
      await txClientFail.query('BEGIN');
      const pResFail = await txClientFail.query(`
        INSERT INTO problems (title, description, difficulty, created_by, coding_mode, access_scope)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;
      `, [`Tx Audit Prob Fail ${timestamp}`, 'Desc', 'easy', profUser.id, 'full_program', 'contest_private']);
      const failProbId = pResFail.rows[0].id;

      const aResFail = await AuditLogger.logAction({
        actor: profUser,
        action: 'PROBLEM_CREATED',
        resourceType: 'problem',
        resourceId: failProbId,
        outcome: 'success',
        metadata: { txTest: 'will_rollback' },
        client: txClientFail,
      });
      rolledBackAuditId = aResFail.id;

      // Force intentional error inside transaction
      await txClientFail.query('INSERT INTO non_existent_table_forced_error VALUES (1)');
      await txClientFail.query('COMMIT');
    } catch (err) {
      await txClientFail.query('ROLLBACK');
    } finally {
      txClientFail.release();
    }

    const checkRollbackAudit = await db.query('SELECT 1 FROM audit_logs WHERE id = $1', [rolledBackAuditId]);
    assert(checkRollbackAudit.rows.length === 0, '16c. Transactional audit log completely rolled back on error (0 phantom records)');

    // ----------------------------------------------------
    // 11. Historical Audit Preservation on User Deletion
    // ----------------------------------------------------
    console.log('\n--- 11. Historical Audit Preservation on User Deletion ---');
    const ephemeralUserRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4, 'student') RETURNING *;
    `, [`eph_std_${timestamp}`, `eph_std_${timestamp}@test.com`, pwdHash, 'Ephemeral User']);
    const ephUser = ephemeralUserRes.rows[0];

    const ephAudit = await AuditLogger.logAction({
      actor: ephUser,
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: ephUser.id,
      outcome: 'success',
    });

    // Delete ephemeral user
    await db.query('DELETE FROM users WHERE id = $1', [ephUser.id]);

    const preservedAudit = await AuditLogModel.findAuditLogById(ephAudit.id);
    assert(preservedAudit !== null, '17a. Audit log record survived actor account deletion');
    assert(preservedAudit.actorId === null, '17b. Deleted actorId is safely set to NULL via ON DELETE SET NULL');
    assert(preservedAudit.action === 'USER_REGISTERED', '17c. Action and metadata preserved intact');

    // ----------------------------------------------------
    // 12. Phase 5.9.4 Admin User Management Event Readiness
    // ----------------------------------------------------
    console.log('\n--- 12. Phase 5.9.4 Admin User Management Readiness ---');
    const userMgmtActions = [
      { action: 'USER_CREATED', resType: 'user', resId: 5001, meta: { role: 'professor' } },
      { action: 'USER_UPDATED', resType: 'user', resId: 5001, meta: { updatedFields: ['fullName', 'institution'] } },
      { action: 'ROLE_CHANGED', resType: 'user', resId: 5001, meta: { previousRole: 'student', newRole: 'professor' } },
      { action: 'ACCOUNT_STATUS_CHANGED', resType: 'user', resId: 5001, meta: { isActive: false, reason: 'admin_deactivation' } },
      { action: 'USER_DEACTIVATED', resType: 'user', resId: 5001, meta: { deactivatedBy: superAdminUser.id } },
      { action: 'ADMIN_ACTION_DENIED', resType: 'admin', resId: null, meta: { attemptedOperation: 'DATABASE_PURGE' }, outcome: 'denied' },
    ];

    for (const event of userMgmtActions) {
      const log = await AuditLogger.logAction({
        actor: superAdminUser,
        action: event.action,
        resourceType: event.resType,
        resourceId: event.resId,
        outcome: event.outcome || 'success',
        metadata: event.meta,
      });
      assert(log.id !== null, `18. Phase 5.9.4 readiness: Logged ${event.action} successfully`);
      const dbRow = await AuditLogModel.findAuditLogById(log.id);
      assert(dbRow.action === event.action, `18. Persisted Phase 5.9.4 event ${event.action} in PostgreSQL`);
    }

    // ----------------------------------------------------
    // 13. Clean Up Ephemeral Test Fixtures
    // ----------------------------------------------------
    console.log('\n--- 13. Cleaning Up Ephemeral Test Fixtures ---');
    if (committedProblemId) {
      await db.query('DELETE FROM problems WHERE id = $1', [committedProblemId]);
    }
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4)', [
      studentUser.id,
      profUser.id,
      contestAdminUser.id,
      superAdminUser.id,
    ]);
    console.log('[CLEANUP] Ephemeral test users and problems purged.');

    console.log('\n=======================================================');
    console.log(` PHASE 5.9.3 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
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
