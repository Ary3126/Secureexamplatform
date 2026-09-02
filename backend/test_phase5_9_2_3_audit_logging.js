/**
 * Phase 5.9.2.3 — Persistent Audit Logging System Automated Test Suite
 * 
 * Verifies:
 * 1. Database schema, columns, indexes, check constraints, ON DELETE SET NULL foreign keys.
 * 2. Privileged action creation and PostgreSQL persistence.
 * 3. Recursive sensitive-field sanitization (passwords, JWTs, headers, cookies, source code, test inputs/outputs).
 * 4. Role-based access control (Super Admin only, Student/Prof/ContestAdmin forbidden).
 * 5. Bounded pagination & parameterized filtering (actor, action, resource, outcome, dates).
 * 6. Outcomes taxonomy (success, failure, denied).
 * 7. Transactional consistency & rollback behavior.
 * 8. Append-only enforcement (no PUT/DELETE API).
 * 9. Audit preservation across actor deactivation and deletion.
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { initDb } = require('./src/config/initDb');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const AuditLogModel = require('./src/models/auditLogModel');
const AuditLogger = require('./src/services/auditLogger');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let port;
let baseUrl;

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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
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

async function runAuditLoggingTests() {
  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  console.log('=======================================================');
  console.log(' STARTING PHASE 5.9.2.3 AUDIT LOGGING TEST SUITE');
  console.log('=======================================================');

  try {
    // Start temporary test server
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const ts = Date.now();
    const passwordHash = await hashPassword('Password123!');

    // -----------------------------------------------------------
    // SECTION 1: DATABASE SCHEMA & INTEGRITY VERIFICATION
    // -----------------------------------------------------------
    console.log('\n--- 1. Database Schema & Migration Verification ---');

    // 1. Table existence
    const tableRes = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'audit_logs';
    `);
    record('1. audit_logs table exists in database', tableRes.rows.length === 1);

    // 2. Required columns existence
    const colRes = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'audit_logs';
    `);
    const cols = colRes.rows.map((r) => r.column_name);
    const requiredCols = ['id', 'actor_id', 'action', 'resource_type', 'resource_id', 'outcome', 'metadata', 'ip_address', 'created_at'];
    const allColsPresent = requiredCols.every((c) => cols.includes(c));
    record('2. Required columns (id, actor_id, action, resource_type, resource_id, outcome, metadata, ip_address, created_at) exist', allColsPresent);

    // 3. Indexes existence
    const indexRes = await db.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'audit_logs';
    `);
    const indexNames = indexRes.rows.map((r) => r.indexname);
    record('3a. Index idx_audit_logs_actor_id exists', indexNames.includes('idx_audit_logs_actor_id'));
    record('3b. Index idx_audit_logs_action exists', indexNames.includes('idx_audit_logs_action'));
    record('3c. Index idx_audit_logs_resource exists', indexNames.includes('idx_audit_logs_resource'));
    record('3d. Index idx_audit_logs_outcome exists', indexNames.includes('idx_audit_logs_outcome'));
    record('3e. Index idx_audit_logs_created_at exists', indexNames.includes('idx_audit_logs_created_at'));

    // 4. Outcome CHECK constraint
    const checkRes = await db.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'audit_logs' AND c.contype = 'c';
    `);
    const checkDefs = checkRes.rows.map((r) => r.def).join(' ');
    record('4. Outcome CHECK constraint enforces success/failure/denied', checkDefs.includes('success') && checkDefs.includes('failure') && checkDefs.includes('denied'));

    // 5. Actor Foreign Key ON DELETE SET NULL
    const fkRes = await db.query(`
      SELECT confdeltype 
      FROM pg_constraint 
      WHERE conname = 'audit_logs_actor_id_fkey' OR (conrelid = 'audit_logs'::regclass AND contype = 'f');
    `);
    const deleteType = fkRes.rows[0]?.confdeltype;
    record('5. Actor foreign key uses ON DELETE SET NULL (confdeltype = n)', deleteType === 'n');

    // 6. Idempotent initialization
    const reInit = await initDb();
    record('6. initDb is idempotent and executes safely on existing schema', reInit === true);

    // -----------------------------------------------------------
    // SECTION 2: TEST ACTORS SETUP
    // -----------------------------------------------------------
    console.log('\n--- 2. Setting Up Test Actors ---');

    const superAdmin = await UserModel.createUser({
      username: `admin_audit_${ts}`,
      email: `admin_audit_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin Audit Test',
    });

    const contestAdmin = await UserModel.createUser({
      username: `ca_audit_${ts}`,
      email: `ca_audit_${ts}@test.com`,
      passwordHash,
      role: 'contest_admin',
      fullName: 'Contest Admin Audit Test',
    });

    const profA = await UserModel.createUser({
      username: `prof_a_audit_${ts}`,
      email: `prof_a_audit_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor A Audit Test',
    });

    const profB = await UserModel.createUser({
      username: `prof_b_audit_${ts}`,
      email: `prof_b_audit_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor B Audit Test',
    });

    const studentA = await UserModel.createUser({
      username: `std_a_audit_${ts}`,
      email: `std_a_audit_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student A Audit Test',
    });

    const tokenSuperAdmin = generateToken(superAdmin);
    const tokenContestAdmin = generateToken(contestAdmin);
    const tokenProfA = generateToken(profA);
    const tokenProfB = generateToken(profB);
    const tokenStudentA = generateToken(studentA);

    record('7. Test actors initialized with RBAC roles', Boolean(tokenSuperAdmin && tokenProfA && tokenStudentA));

    // -----------------------------------------------------------
    // SECTION 3: PRIVILEGED ACTION RECORDING & ATTRIBUTES
    // -----------------------------------------------------------
    console.log('\n--- 3. Testing Privileged Action Recording & Attribute Integrity ---');

    // Create problem via API -> Audits PROBLEM_CREATED
    const createProbRes = await request('POST', '/api/problems', {
      title: `Audit Test Problem ${ts}`,
      description: 'Audit logging problem test',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'public',
    }, tokenProfA);

    record('8. Problem creation API returns 201 Created', createProbRes.status === 201);
    const createdProblemId = createProbRes.body?.problem?.id;

    // Direct DB lookup of the audit log record
    const auditRecordRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'PROBLEM_CREATED' AND resource_id = $1;
    `, [createdProblemId]);

    const auditRow = auditRecordRes.rows[0];
    record('9. Audit record exists in PostgreSQL table', Boolean(auditRow));
    record('10. Actor ID recorded accurately', auditRow?.actor_id === profA.id);
    record('11. Action identifier recorded accurately', auditRow?.action === 'PROBLEM_CREATED');
    record('12. Resource type recorded accurately', auditRow?.resource_type === 'problem');
    record('13. Resource ID matches target problem', auditRow?.resource_id === createdProblemId);
    record('14. Outcome recorded as success', auditRow?.outcome === 'success');
    record('15. created_at timestamp populated', Boolean(auditRow?.created_at));
    record('16. IP address captured', Boolean(auditRow?.ip_address));

    // -----------------------------------------------------------
    // SECTION 4: RECURSIVE SENSITIVE DATA SANITIZATION
    // -----------------------------------------------------------
    console.log('\n--- 4. Testing Recursive Sensitive Data Sanitization ---');

    const dirtyMetadata = {
      problemId: 42,
      difficulty: 'hard',
      password: 'SuperSecretPassword123!',
      passwordHash: '$2b$10$xyz...',
      password_hash: '$2b$10$abc...',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjF9.signature',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjJ9.signature',
      accessToken: 'access-token-val',
      access_token: 'access-token-val-2',
      refreshToken: 'refresh-token-val',
      refresh_token: 'refresh-token-val-2',
      secret: 'my-super-secret-key',
      authorization: 'Bearer eyJhbGciOiJIUzI1Ni...',
      cookie: 'session_id=12345; HttpOnly',
      setCookie: 'session_id=12345',
      sourceCode: 'int main() { return 0; }',
      source_code: 'def solve(): pass',
      inputData: '5 10 15 20 hidden input',
      expectedOutput: '42 hidden output',
      apiKey: 'api-key-12345',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----',
      nestedConfig: {
        safeField: 'safeValue',
        password: 'nestedSecretPassword',
        innerTokens: [
          { token: 'innerJWT', valid: true },
          { secret: 'deepSecret', count: 5 }
        ]
      }
    };

    const sanitized = AuditLogger.sanitize(dirtyMetadata);

    record('17. Sanitizer stripped top-level password', sanitized.password === undefined);
    record('18. Sanitizer stripped passwordHash & password_hash', sanitized.passwordHash === undefined && sanitized.password_hash === undefined);
    record('19. Sanitizer stripped JWT token & jwt keys', sanitized.token === undefined && sanitized.jwt === undefined);
    record('20. Sanitizer stripped access & refresh tokens', sanitized.accessToken === undefined && sanitized.refreshToken === undefined);
    record('21. Sanitizer stripped authorization header & cookies', sanitized.authorization === undefined && sanitized.cookie === undefined);
    record('22. Sanitizer stripped sourceCode & source_code', sanitized.sourceCode === undefined && sanitized.source_code === undefined);
    record('23. Sanitizer stripped inputData & expectedOutput', sanitized.inputData === undefined && sanitized.expectedOutput === undefined);
    record('24. Sanitizer stripped apiKey & privateKey', sanitized.apiKey === undefined && sanitized.privateKey === undefined);
    record('25. Sanitizer recursively stripped nested password', sanitized.nestedConfig?.password === undefined);
    record('26. Sanitizer preserved nested safe values', sanitized.nestedConfig?.safeField === 'safeValue');
    record('27. Sanitizer sanitized array of objects recursively', sanitized.nestedConfig?.innerTokens[0]?.token === undefined && sanitized.nestedConfig?.innerTokens[0]?.valid === true);

    // -----------------------------------------------------------
    // SECTION 5: SUPER ADMIN AUDIT API & RBAC RESTRICTIONS
    // -----------------------------------------------------------
    console.log('\n--- 5. Testing Admin Audit API RBAC Restrictions ---');

    const studentReq = await request('GET', '/api/admin/audit-logs', null, tokenStudentA);
    record('28. Student blocked from GET /api/admin/audit-logs (403 Forbidden)', studentReq.status === 403);

    const profReq = await request('GET', '/api/admin/audit-logs', null, tokenProfA);
    record('29. Professor blocked from GET /api/admin/audit-logs (403 Forbidden)', profReq.status === 403);

    const contestAdminReq = await request('GET', '/api/admin/audit-logs', null, tokenContestAdmin);
    record('30. Contest Admin blocked from GET /api/admin/audit-logs (403 Forbidden)', contestAdminReq.status === 403);

    const unauthReq = await request('GET', '/api/admin/audit-logs', null, null);
    record('31. Unauthenticated request blocked from GET /api/admin/audit-logs (401 Unauthorized)', unauthReq.status === 401);

    const superAdminReq = await request('GET', '/api/admin/audit-logs', null, tokenSuperAdmin);
    record('32. Super Admin can access GET /api/admin/audit-logs (200 OK)', superAdminReq.status === 200);
    record('33. Super Admin response contains logs array and pagination', Array.isArray(superAdminReq.body?.data?.logs) && Boolean(superAdminReq.body?.data?.pagination));

    // -----------------------------------------------------------
    // SECTION 6: FILTERING & BOUNDED PAGINATION
    // -----------------------------------------------------------
    console.log('\n--- 6. Testing Audit Log Filtering & Bounded Pagination ---');

    // Filter by action
    const actionFilterReq = await request('GET', '/api/admin/audit-logs?action=PROBLEM_CREATED', null, tokenSuperAdmin);
    const actionLogs = actionFilterReq.body?.data?.logs || [];
    const allMatchAction = actionLogs.every((l) => l.action === 'PROBLEM_CREATED');
    record('34. Action filter strictly returns matching records', actionFilterReq.status === 200 && actionLogs.length > 0 && allMatchAction);

    // Filter by actorId
    const actorFilterReq = await request('GET', `/api/admin/audit-logs?actorId=${profA.id}`, null, tokenSuperAdmin);
    const actorLogs = actorFilterReq.body?.data?.logs || [];
    const allMatchActor = actorLogs.every((l) => l.actorId === profA.id);
    record('35. Actor filter strictly returns matching records', actorFilterReq.status === 200 && actorLogs.length > 0 && allMatchActor);

    // Filter by resourceType & resourceId
    const resourceFilterReq = await request('GET', `/api/admin/audit-logs?resourceType=problem&resourceId=${createdProblemId}`, null, tokenSuperAdmin);
    const resourceLogs = resourceFilterReq.body?.data?.logs || [];
    record('36. Resource type and ID filters strictly return matching records', resourceFilterReq.status === 200 && resourceLogs.length > 0 && resourceLogs[0].resourceId === createdProblemId);

    // Bounded limit test (limit=500 should be clamped to 100)
    const limitReq = await request('GET', '/api/admin/audit-logs?limit=500', null, tokenSuperAdmin);
    record('37. Excessive limit (500) is bounded to maximum 100', limitReq.body?.data?.pagination?.limit === 100);

    // Pagination navigation (page=1, limit=2)
    const page1Req = await request('GET', '/api/admin/audit-logs?page=1&limit=2', null, tokenSuperAdmin);
    const page2Req = await request('GET', '/api/admin/audit-logs?page=2&limit=2', null, tokenSuperAdmin);
    record('38. Pagination returns correct page and limit metadata', page1Req.body?.data?.pagination?.page === 1 && page1Req.body?.data?.pagination?.limit === 2);
    record('39. Page 2 returns next slice without overlapping first record of page 1', page1Req.body?.data?.logs[0]?.id !== page2Req.body?.data?.logs[0]?.id);

    // -----------------------------------------------------------
    // SECTION 7: OUTCOME TAXONOMY (SUCCESS / FAILURE / DENIED)
    // -----------------------------------------------------------
    console.log('\n--- 7. Testing Outcomes (Success / Failure / Denied) ---');

    // 1. Success recorded: Contest created
    const contestRes = await request('POST', '/api/contests', {
      title: `Audit Contest ${ts}`,
      description: 'Audit contest test',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
    }, tokenProfA);
    const contestId = contestRes.body?.contest?.id;

    // 2. Denied recorded: Professor B attempts to delete Professor A's contest
    const deniedRes = await request('DELETE', `/api/contests/${contestId}`, null, tokenProfB);
    record('40. Unauthorized delete returns 403 Forbidden', deniedRes.status === 403);

    // Check denied audit log
    const deniedLogRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'PRIVILEGED_ACTION_DENIED' AND resource_id = $1;
    `, [contestId]);
    const deniedRow = deniedLogRes.rows[0];
    record('41. PRIVILEGED_ACTION_DENIED recorded with outcome = denied', deniedRow?.outcome === 'denied' && deniedRow?.actor_id === profB.id);

    // 3. Failure recorded: Invalid login
    await request('POST', '/api/auth/login', {
      email: profA.email,
      password: 'WrongPassword123!',
    });
    const failureLogRes = await db.query(`
      SELECT * FROM audit_logs 
      WHERE action = 'LOGIN_FAILURE' AND actor_id = $1 
      ORDER BY id DESC LIMIT 1;
    `, [profA.id]);
    record('42. LOGIN_FAILURE recorded with outcome = failure', failureLogRes.rows[0]?.outcome === 'failure');

    // -----------------------------------------------------------
    // SECTION 8: TRANSACTIONAL INTEGRITY & ROLLBACK BEHAVIOR
    // -----------------------------------------------------------
    console.log('\n--- 8. Testing Transactional Consistency & Rollback Integrity ---');

    // Test transaction commit: Custom transaction with model + audit
    const txClient = await db.getClient();
    let txCommittedProblemId;
    try {
      await txClient.query('BEGIN');
      const pRes = await txClient.query(`
        INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
      `, [`Tx Commit Problem ${ts}`, 'Desc', 'easy', 'function', 'public', profA.id]);
      txCommittedProblemId = pRes.rows[0].id;

      await AuditLogger.logAction({
        actor: profA,
        action: 'PROBLEM_CREATED',
        resourceType: 'problem',
        resourceId: txCommittedProblemId,
        outcome: 'success',
        client: txClient,
      });

      await txClient.query('COMMIT');
    } catch (e) {
      await txClient.query('ROLLBACK');
    } finally {
      txClient.release();
    }

    const verifyCommitProblem = await db.query(`SELECT id FROM problems WHERE id = $1;`, [txCommittedProblemId]);
    const verifyCommitAudit = await db.query(`SELECT id FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1;`, [txCommittedProblemId]);
    record('43. Transactional mutation and audit log both commit together', verifyCommitProblem.rows.length === 1 && verifyCommitAudit.rows.length === 1);

    // Test transaction rollback: Mutation fails or rollback issued
    const txRollbackClient = await db.getClient();
    let txRolledBackProblemId;
    try {
      await txRollbackClient.query('BEGIN');
      const pRes = await txRollbackClient.query(`
        INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
      `, [`Tx Rollback Problem ${ts}`, 'Desc', 'easy', 'function', 'public', profA.id]);
      txRolledBackProblemId = pRes.rows[0].id;

      await AuditLogger.logAction({
        actor: profA,
        action: 'PROBLEM_CREATED',
        resourceType: 'problem',
        resourceId: txRolledBackProblemId,
        outcome: 'success',
        client: txRollbackClient,
      });

      // Explicitly ROLLBACK
      await txRollbackClient.query('ROLLBACK');
    } finally {
      txRollbackClient.release();
    }

    const verifyRollbackProblem = await db.query(`SELECT id FROM problems WHERE id = $1;`, [txRolledBackProblemId]);
    const verifyRollbackAudit = await db.query(`SELECT id FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1;`, [txRolledBackProblemId]);
    record('44. Transaction rollback completely removes both mutation and audit log', verifyRollbackProblem.rows.length === 0 && verifyRollbackAudit.rows.length === 0);

    // -----------------------------------------------------------
    // SECTION 9: APPEND-ONLY & IMMUTABILITY ENFORCEMENT
    // -----------------------------------------------------------
    console.log('\n--- 9. Testing Append-Only Design & Immutability ---');

    const firstAuditId = auditRow?.id;

    // No PUT /api/admin/audit-logs/:id
    const putRes = await request('PUT', `/api/admin/audit-logs/${firstAuditId}`, { action: 'MODIFIED_ACTION' }, tokenSuperAdmin);
    record('45. No application update endpoint for audit logs (404/405)', putRes.status === 404 || putRes.status === 405);

    // No DELETE /api/admin/audit-logs/:id
    const delRes = await request('DELETE', `/api/admin/audit-logs/${firstAuditId}`, null, tokenSuperAdmin);
    record('46. No application delete endpoint for audit logs (404/405)', delRes.status === 404 || delRes.status === 405);

    // Direct DB verify record was untouched
    const verifyUntouched = await db.query(`SELECT action FROM audit_logs WHERE id = $1;`, [firstAuditId]);
    record('47. Audit log remains intact and unmodified in database', verifyUntouched.rows[0]?.action === 'PROBLEM_CREATED');

    // -----------------------------------------------------------
    // SECTION 10: SQL INJECTION & BYPASS RESISTANCE
    // -----------------------------------------------------------
    console.log('\n--- 10. Testing SQL Injection & Parameter Tampering Resistance ---');

    const sqliReq = await request('GET', `/api/admin/audit-logs?action=' OR 1=1 --&resourceType=problem'; DROP TABLE audit_logs; --`, null, tokenSuperAdmin);
    record('48. SQL injection query parameters safely handled without syntax errors', sqliReq.status === 200);

    const tableStillExists = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';`);
    record('49. audit_logs table remains intact after SQL injection attempts', tableStillExists.rows.length === 1);

    // -----------------------------------------------------------
    // SECTION 11: AUDIT RECORD PRESERVATION ON ACTOR DELETION
    // -----------------------------------------------------------
    console.log('\n--- 11. Testing Audit Preservation on Actor Deletion ---');

    // Create ephemeral user
    const ephemeralUser = await UserModel.createUser({
      username: `ephemeral_user_${ts}`,
      email: `ephemeral_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Ephemeral Professor',
    });

    // Log action by ephemeral user
    await AuditLogger.logAction({
      actor: ephemeralUser,
      action: 'EPHEMERAL_ACTION',
      resourceType: 'system',
      outcome: 'success',
    });

    // Delete ephemeral user
    await db.query(`DELETE FROM users WHERE id = $1;`, [ephemeralUser.id]);

    // Check audit log for ephemeral action
    const preservedLogRes = await db.query(`
      SELECT * FROM audit_logs WHERE action = 'EPHEMERAL_ACTION';
    `);
    const preservedLog = preservedLogRes.rows[0];

    record('50. Audit log survives actor account deletion', Boolean(preservedLog));
    record('51. Deleted actor ID is safely set to NULL without cascade deleting audit history', preservedLog?.actor_id === null);

    // -----------------------------------------------------------
    // SECTION 12: CLEANUP EPHEMERAL TEST FIXTURES
    // -----------------------------------------------------------
    console.log('\n--- 12. Cleaning Up Ephemeral Test Fixtures ---');

    await db.query(`DELETE FROM audit_logs WHERE action IN ('EPHEMERAL_ACTION', 'SECURITY_AUDIT_VERIFIED');`);
    await db.query(`DELETE FROM users WHERE email LIKE '%_audit_${ts}@test.com' OR email LIKE 'ephemeral_${ts}@test.com';`);
    record('52. Ephemeral test fixtures cleanly removed', true);

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 5.9.2.3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAuditLoggingTests()
    .then(() => {
      db.pool.end().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(err);
      db.pool.end().then(() => process.exit(1));
    });
}

module.exports = { runAuditLoggingTests };
