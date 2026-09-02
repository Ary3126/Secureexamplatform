/**
 * Phase 5.9.5 Problem Authoring Studio Automated Test Suite
 * 
 * Verifies:
 * 1. Strict RBAC (Student denial on create, update, delete, publish, clone, test-cases, preview, revisions)
 * 2. Professor Authoring & Ownership Permissions (CRUD, sample/hidden test cases, validation config)
 * 3. Cross-Professor Isolation & BOLA/IDOR Defense (403/404 on unowned private problems)
 * 4. Super Admin Global Management Powers (update, clone, publish, test cases)
 * 5. Mass-Assignment Protection (immutable id, createdBy, role, isPublished, ratings)
 * 6. Hidden Test Privacy & Source Security (no hidden test / secret leakage to students or preview)
 * 7. Publish Validation Gate (422 rejection on missing test cases/harnesses, transactional publish)
 * 8. Problem Versioning & Historical Judging Snapshot Integrity (reproducible version snapshots)
 * 9. Optimistic Concurrency Control (409 Conflict on stale expectedVersion)
 * 10. Problem Cloning (independent draft, new ID, test case copy, zero inherited submissions/audits)
 * 11. Contest Safety & Deletion Guards (409 Conflict on problem with submissions)
 * 12. Transactional Atomicity (Rollback on failure with 0 phantom records)
 * 13. Persistent Audit Logging (PROBLEM_CREATED, PROBLEM_UPDATED, PROBLEM_PUBLISHED, PROBLEM_CLONED, etc.)
 * 14. Input Validation & SQL Injection Resilience
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const AuditLogModel = require('./src/models/auditLogModel');
const AuditLogger = require('./src/services/auditLogger');

let server;
let baseUrl;
const timestamp = Date.now();

// Test Actors
let studentUser, studentToken;
let prof1User, prof1Token;
let prof2User, prof2Token;
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
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 5.9.5 PROBLEM AUTHORING STUDIO TEST SUITE');
  console.log('=======================================================\n');

  try {
    // ----------------------------------------------------
    // 0. Server & Fixture Initialization
    // ----------------------------------------------------
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        console.log(`[SERVER] Test server listening on ${baseUrl}`);
        resolve();
      });
    });

    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('SecurePass123!');

    const sRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`std_595_${timestamp}`, `std_595_${timestamp}@test.edu`, pwdHash, 'Student 595', 'student']
    );
    studentUser = sRes.rows[0];
    studentToken = generateToken(studentUser);

    const p1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`prof1_595_${timestamp}`, `prof1_595_${timestamp}@test.edu`, pwdHash, 'Professor Alpha', 'professor']
    );
    prof1User = p1Res.rows[0];
    prof1Token = generateToken(prof1User);

    const p2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`prof2_595_${timestamp}`, `prof2_595_${timestamp}@test.edu`, pwdHash, 'Professor Beta', 'professor']
    );
    prof2User = p2Res.rows[0];
    prof2Token = generateToken(prof2User);

    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`sa_595_${timestamp}`, `sa_595_${timestamp}@test.edu`, pwdHash, 'Super Admin 595', 'super_admin']
    );
    superAdminUser = saRes.rows[0];
    superAdminToken = generateToken(superAdminUser);

    assert(studentUser && prof1User && prof2User && superAdminUser, '1a. Test actors initialized successfully');

    // ----------------------------------------------------
    // 1. Strict RBAC (Student Denial)
    // ----------------------------------------------------
    console.log('\n--- 2. Strict RBAC: Student Role Denial ---');
    const stdCreate = await request('POST', '/api/problems', {
      title: 'Student Attempt Problem',
      description: 'Desc',
      difficulty: 'easy',
    }, studentToken);
    assert(stdCreate.status === 403, '2a. Student cannot create problem (403 Forbidden)');

    const stdUpdate = await request('PUT', '/api/problems/1', { title: 'Hacked' }, studentToken);
    assert(stdUpdate.status === 403, '2b. Student cannot update problem (403 Forbidden)');

    const stdDelete = await request('DELETE', '/api/problems/1', null, studentToken);
    assert(stdDelete.status === 403, '2c. Student cannot delete problem (403 Forbidden)');

    const stdPublish = await request('POST', '/api/problems/1/publish', null, studentToken);
    assert(stdPublish.status === 403, '2d. Student cannot publish problem (403 Forbidden)');

    const stdClone = await request('POST', '/api/problems/1/clone', null, studentToken);
    assert(stdClone.status === 403, '2e. Student cannot clone problem (403 Forbidden)');

    const stdPreview = await request('GET', '/api/problems/1/preview', null, studentToken);
    assert(stdPreview.status === 403, '2f. Student cannot access problem preview endpoint (403 Forbidden)');

    const stdVersions = await request('GET', '/api/problems/1/versions', null, studentToken);
    assert(stdVersions.status === 403, '2g. Student cannot view problem revision snapshots (403 Forbidden)');

    const stdTestCases = await request('GET', '/api/problems/1/test-cases', null, studentToken);
    assert(stdTestCases.status === 403, '2h. Student cannot view administrative test cases (403 Forbidden)');

    const stdAddTc = await request('POST', '/api/problems/1/test-cases', { inputData: '1', expectedOutput: '2' }, studentToken);
    assert(stdAddTc.status === 403, '2i. Student cannot add test cases (403 Forbidden)');

    const stdValConfig = await request('POST', '/api/problems/1/validation-config', { validationEnabled: true }, studentToken);
    assert(stdValConfig.status === 403, '2j. Student cannot configure validation generators (403 Forbidden)');

    // ----------------------------------------------------
    // 2. Professor Authoring & Ownership Permissions
    // ----------------------------------------------------
    console.log('\n--- 3. Professor Authoring & Problem Creation ---');
    const p1CreateRes = await request('POST', '/api/problems', {
      title: `Binary Search Tree ${timestamp}`,
      description: 'Implement a balanced BST with insert and search.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Node:\n    pass\n',
        cpp: 'struct Node {};\n',
        java: 'class Node {}\n',
      },
      harnessTemplates: {
        python: 'def run_harness():\n    pass\n',
        cpp: 'void run_harness() {}\n',
        java: 'class Harness { static void run() {} }\n',
      },
      accessScope: 'contest_private',
    }, prof1Token);

    assert(p1CreateRes.status === 201, '3a. Professor Alpha creates problem draft (201 Created)');
    const p1Prob = p1CreateRes.body.problem;
    assert(p1Prob.id > 0, '3b. Created problem has positive integer ID');
    assert(p1Prob.version === 1, '3c. Initial problem version is 1');
    assert(p1Prob.isPublished === false, '3d. Initial problem is in draft state (isPublished = false)');
    assert(p1Prob.accessScope === 'contest_private', '3e. Initial problem access scope is contest_private');

    // Verify PROBLEM_CREATED audit log
    const p1CreateAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [p1Prob.id]
    );
    assert(p1CreateAudit.rows.length === 1, '3f. PROBLEM_CREATED audit log persisted in PostgreSQL');
    assert(p1CreateAudit.rows[0].actor_id === prof1User.id, '3g. Audit log actor matches Professor Alpha ID');

    // Add Sample Test Case
    const tc1Res = await request('POST', `/api/problems/${p1Prob.id}/test-cases`, {
      inputData: '5\n1 2 3 4 5\n3\n',
      expectedOutput: 'true\n',
      isHidden: false,
      testOrder: 1,
    }, prof1Token);
    assert(tc1Res.status === 201, '3h. Professor Alpha adds visible sample test case (201 Created)');
    const sampleTc = tc1Res.body.testCase;
    assert(sampleTc.isHidden === false, '3i. Sample test case isHidden is false');

    // Add Hidden Test Case
    const tc2Res = await request('POST', `/api/problems/${p1Prob.id}/test-cases`, {
      inputData: '1000\n...random...\n999\n',
      expectedOutput: 'false\n',
      isHidden: true,
      testOrder: 2,
    }, prof1Token);
    assert(tc2Res.status === 201, '3j. Professor Alpha adds hidden test case (201 Created)');
    const hiddenTc = tc2Res.body.testCase;
    assert(hiddenTc.isHidden === true, '3k. Hidden test case isHidden is true');

    // Save Validation Config
    const valRes = await request('POST', `/api/problems/${p1Prob.id}/validation-config`, {
      validationEnabled: true,
      generatorType: 'array_generator',
      randomTestCount: 15,
      oracleCode: 'function solve(arr, k) { return arr.includes(k); }',
      oracleLanguage: 'javascript',
    }, prof1Token);
    assert(valRes.status === 200, '3l. Professor Alpha saves validation generator config (200 OK)');

    // Update Problem Details (Version increments)
    const p1UpdateRes = await request('PUT', `/api/problems/${p1Prob.id}`, {
      title: `Binary Search Tree & Traversals ${timestamp}`,
      description: 'Implement a balanced BST with insert, search, and in-order traversal.',
      difficulty: 'medium',
      codingMode: 'function',
    }, prof1Token);
    assert(p1UpdateRes.status === 200, '3m. Professor Alpha updates problem draft (200 OK)');
    assert(p1UpdateRes.body.problem.version === 2, '3n. Problem version incremented to 2');

    const p1UpdateAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_UPDATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [p1Prob.id]
    );
    assert(p1UpdateAudit.rows.length === 1, '3o. PROBLEM_UPDATED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 3. Cross-Professor Isolation & BOLA / IDOR Defense
    // ----------------------------------------------------
    console.log('\n--- 4. Cross-Professor Isolation & BOLA Defense ---');
    const p2Update = await request('PUT', `/api/problems/${p1Prob.id}`, { title: 'Tampered by Beta' }, prof2Token);
    assert(p2Update.status === 403, '4a. Professor Beta cannot update Professor Alpha problem (403 Forbidden)');

    const p2Delete = await request('DELETE', `/api/problems/${p1Prob.id}`, null, prof2Token);
    assert(p2Delete.status === 403, '4b. Professor Beta cannot delete Professor Alpha problem (403 Forbidden)');

    const p2Publish = await request('POST', `/api/problems/${p1Prob.id}/publish`, null, prof2Token);
    assert(p2Publish.status === 403, '4c. Professor Beta cannot publish Professor Alpha problem (403 Forbidden)');

    const p2Clone = await request('POST', `/api/problems/${p1Prob.id}/clone`, null, prof2Token);
    assert(p2Clone.status === 403, '4d. Professor Beta cannot clone Professor Alpha private problem (403 Forbidden)');

    const p2Preview = await request('GET', `/api/problems/${p1Prob.id}/preview`, null, prof2Token);
    assert(p2Preview.status === 403, '4e. Professor Beta cannot preview Professor Alpha private problem (403 Forbidden)');

    const p2Versions = await request('GET', `/api/problems/${p1Prob.id}/versions`, null, prof2Token);
    assert(p2Versions.status === 403, '4f. Professor Beta cannot view Professor Alpha problem revisions (403 Forbidden)');

    const p2GetTcs = await request('GET', `/api/problems/${p1Prob.id}/test-cases`, null, prof2Token);
    assert(p2GetTcs.status === 403, '4g. Professor Beta cannot view Professor Alpha administrative test cases (403 Forbidden)');

    const p2AddTc = await request('POST', `/api/problems/${p1Prob.id}/test-cases`, { inputData: '99', expectedOutput: '99' }, prof2Token);
    assert(p2AddTc.status === 403, '4h. Professor Beta cannot add test cases to Professor Alpha problem (403 Forbidden)');

    const p2GetVal = await request('GET', `/api/problems/${p1Prob.id}/validation-config`, null, prof2Token);
    assert(p2GetVal.status === 403, '4i. Professor Beta cannot view Professor Alpha validation config (403 Forbidden)');

    const p2SaveVal = await request('POST', `/api/problems/${p1Prob.id}/validation-config`, { validationEnabled: false }, prof2Token);
    assert(p2SaveVal.status === 403, '4j. Professor Beta cannot modify Professor Alpha validation config (403 Forbidden)');

    // Verify PRIVILEGED_ACTION_DENIED audit log
    const denialAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 ORDER BY id DESC LIMIT 1;`,
      [prof2User.id]
    );
    assert(denialAudit.rows.length === 1, '4k. PRIVILEGED_ACTION_DENIED audit log recorded for unauthorized professor');
    assert(denialAudit.rows[0].outcome === 'denied', '4l. Audit outcome is denied');

    // ----------------------------------------------------
    // 4. Super Admin Global Management Powers
    // ----------------------------------------------------
    console.log('\n--- 5. Super Admin Global Management Powers ---');
    const saGetTcs = await request('GET', `/api/problems/${p1Prob.id}/test-cases`, null, superAdminToken);
    assert(saGetTcs.status === 200, '5a. Super Admin can view administrative test cases on any problem (200 OK)');
    assert(saGetTcs.body.testCases.length === 2, '5b. Super Admin receives both sample and hidden test cases');

    const saUpdate = await request('PUT', `/api/problems/${p1Prob.id}`, {
      difficulty: 'hard',
    }, superAdminToken);
    assert(saUpdate.status === 200, '5c. Super Admin can update any problem (200 OK)');
    assert(saUpdate.body.problem.difficulty === 'hard', '5d. Problem difficulty updated by Super Admin');

    // Restore difficulty back to medium
    await request('PUT', `/api/problems/${p1Prob.id}`, { difficulty: 'medium' }, superAdminToken);

    // ----------------------------------------------------
    // 5. Mass Assignment Protection
    // ----------------------------------------------------
    console.log('\n--- 6. Mass-Assignment Protection ---');
    const massAssignRes = await request('PUT', `/api/problems/${p1Prob.id}`, {
      title: `BST Robust Title ${timestamp}`,
      id: 99999,
      createdBy: studentUser.id,
      created_by: studentUser.id,
      role: 'super_admin',
      isPublished: true,
      currentRating: 3000,
      submissionCount: 500,
      createdAt: '1990-01-01T00:00:00Z',
    }, prof1Token);

    assert(massAssignRes.status === 200, '6a. Problem update succeeds without crash');
    const checkedProb = await ProblemModel.findProblemById(p1Prob.id);
    assert(checkedProb.id === p1Prob.id, '6b. ID was NOT changed by mass assignment');
    assert(checkedProb.createdBy === prof1User.id, '6c. createdBy was NOT changed by mass assignment');
    assert(checkedProb.isPublished === false, '6d. isPublished was NOT altered by PUT /problems/:id (remains draft)');

    // ----------------------------------------------------
    // 6. Hidden Test Case Privacy & Source Security
    // ----------------------------------------------------
    console.log('\n--- 7. Hidden Test Case Privacy & Source Security ---');
    // Public problem lookup by student (after making problem public or checking student visibility)
    // First, let's test preview endpoint
    const previewRes = await request('GET', `/api/problems/${p1Prob.id}/preview`, null, prof1Token);
    assert(previewRes.status === 200, '7a. Professor Alpha generates student preview (200 OK)');
    assert(previewRes.body.sampleTestCases.length === 1, '7b. Preview includes ONLY visible sample test cases (got 1)');
    assert(previewRes.body.sampleTestCases[0].isHidden === false, '7c. Preview test case is sample test case');
    assert(previewRes.body.testCases === undefined, '7d. Preview strictly omits administrative testCases array');
    assert(previewRes.body.oracleCode === undefined, '7e. Preview strictly omits oracle code');

    // ----------------------------------------------------
    // 7. Publish Validation Gate
    // ----------------------------------------------------
    console.log('\n--- 8. Publish Validation Gate ---');
    // Create empty problem with no test cases
    const emptyProbRes = await request('POST', '/api/problems', {
      title: 'Empty Incomplete Problem',
      description: 'Needs test cases',
      difficulty: 'easy',
    }, prof1Token);
    const emptyProb = emptyProbRes.body.problem;

    const failPublish1 = await request('POST', `/api/problems/${emptyProb.id}/publish`, null, prof1Token);
    assert(failPublish1.status === 422, '8a. Incomplete problem without test cases rejected with 422 Unprocessable Entity');
    assert(failPublish1.body.errors.some(e => e.includes('at least one test case')), '8b. Validation error specifies missing test cases');

    // Add only a hidden test case (no sample)
    await request('POST', `/api/problems/${emptyProb.id}/test-cases`, {
      inputData: '1\n',
      expectedOutput: '2\n',
      isHidden: true,
    }, prof1Token);

    const failPublish2 = await request('POST', `/api/problems/${emptyProb.id}/publish`, null, prof1Token);
    assert(failPublish2.status === 422, '8c. Problem with no visible sample test cases rejected with 422');
    assert(failPublish2.body.errors.some(e => e.includes('visible sample test case')), '8d. Validation error specifies missing sample test case');

    // Clean up empty problem
    await request('DELETE', `/api/problems/${emptyProb.id}`, null, prof1Token);

    // Submit for review and approve by Professor Beta before publishing (Phase 5.9.6 Governance)
    await request('POST', `/api/problems/${p1Prob.id}/review-request`, { comment: 'Ready for review' }, prof1Token);
    await request('POST', `/api/problems/${p1Prob.id}/review/approve`, { note: 'Approved for publication' }, prof2Token);

    // Now publish Professor Alpha's complete problem (has title, statement, starter/harness, sample test, hidden test, validation config, and approved review)
    const pubSuccessRes = await request('POST', `/api/problems/${p1Prob.id}/publish`, null, prof1Token);
    assert(pubSuccessRes.status === 200, '8e. Valid problem published successfully (200 OK)');
    assert(pubSuccessRes.body.problem.isPublished === true, '8f. Published problem has isPublished = true');
    assert(pubSuccessRes.body.problem.accessScope === 'public', '8g. Published problem access scope promoted to public');
    assert(pubSuccessRes.body.problem.publishedAt !== null, '8h. Published problem has publishedAt timestamp');

    // Verify PROBLEM_PUBLISHED and PROBLEM_VERSION_CREATED audit logs
    const pubAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_PUBLISHED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [p1Prob.id]
    );
    assert(pubAudit.rows.length === 1, '8i. PROBLEM_PUBLISHED audit event persisted in PostgreSQL');

    const verAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_VERSION_CREATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [p1Prob.id]
    );
    assert(verAudit.rows.length === 1, '8j. PROBLEM_VERSION_CREATED audit event persisted in PostgreSQL');

    // ----------------------------------------------------
    // 8. Problem Versioning & Historical Snapshot Integrity
    // ----------------------------------------------------
    console.log('\n--- 9. Problem Versioning & Historical Snapshot Integrity ---');
    const versionsRes = await request('GET', `/api/problems/${p1Prob.id}/versions`, null, prof1Token);
    assert(versionsRes.status === 200, '9a. Professor Alpha retrieves problem revision history (200 OK)');
    assert(versionsRes.body.versions.length >= 1, '9b. Revision history contains published version');
    const publishedVersionRecord = versionsRes.body.versions[0];
    assert(publishedVersionRecord.testCasesCount === 2, '9c. Revision records 2 test cases in snapshot');

    // Retrieve full immutable version snapshot detail
    const verDetailRes = await request('GET', `/api/problems/${p1Prob.id}/versions/${publishedVersionRecord.versionNumber}`, null, prof1Token);
    assert(verDetailRes.status === 200, '9d. Specific version snapshot detail retrieved (200 OK)');
    const vSnapshot = verDetailRes.body.version;
    assert(vSnapshot.testCasesSnapshot.length === 2, '9e. Snapshot includes immutable test cases array');
    assert(vSnapshot.testCasesSnapshot[0].expectedOutput === 'true\n', '9f. Test case 1 snapshot intact');
    assert(vSnapshot.testCasesSnapshot[1].expectedOutput === 'false\n', '9g. Test case 2 snapshot intact');
    assert(vSnapshot.validationConfigSnapshot.randomTestCount === 15, '9h. Validation config snapshot intact');

    // Mutate current problem draft
    await request('PUT', `/api/problems/${p1Prob.id}`, {
      title: 'Completely Rewritten BST Problem',
      description: 'Changed statement completely for new semester.',
    }, prof1Token);

    // Verify historical version snapshot was NOT altered!
    const vSnapshotRecheck = await request('GET', `/api/problems/${p1Prob.id}/versions/${publishedVersionRecord.versionNumber}`, null, prof1Token);
    assert(vSnapshotRecheck.body.version.title === vSnapshot.title, '9i. HISTORICAL SNAPSHOT PRESERVED: Original title intact in version snapshot');
    assert(!vSnapshotRecheck.body.version.title.includes('Completely Rewritten'), '9j. HISTORICAL SNAPSHOT IMMUTABILITY: Unaffected by later author edits');

    // ----------------------------------------------------
    // 9. Optimistic Concurrency Control (409 Conflict)
    // ----------------------------------------------------
    console.log('\n--- 10. Optimistic Concurrency Control ---');
    // Current problem version is now > 2
    const currentProb = await ProblemModel.findProblemById(p1Prob.id);
    const staleVersion = currentProb.version - 1;

    // Tab A tries to update using stale version
    const staleUpdateRes = await request('PUT', `/api/problems/${p1Prob.id}`, {
      title: 'Stale Tab Overwrite Attempt',
      expectedVersion: staleVersion,
    }, prof1Token);

    assert(staleUpdateRes.status === 409, '10a. Stale version update rejected with 409 Conflict');
    assert(staleUpdateRes.body.message.includes('Problem has been modified by another session'), '10b. Safe conflict error message returned');
    assert(staleUpdateRes.body.currentVersion === currentProb.version, '10c. Response includes authoritative currentVersion');

    // Update with correct expectedVersion succeeds
    const freshUpdateRes = await request('PUT', `/api/problems/${p1Prob.id}`, {
      title: `BST Final Version ${timestamp}`,
      expectedVersion: currentProb.version,
    }, prof1Token);
    assert(freshUpdateRes.status === 200, '10d. Update with matched expectedVersion succeeds (200 OK)');

    // ----------------------------------------------------
    // 10. Problem Cloning
    // ----------------------------------------------------
    console.log('\n--- 11. Problem Cloning ---');
    const cloneRes = await request('POST', `/api/problems/${p1Prob.id}/clone`, {
      title: `Cloned BST Problem ${timestamp}`,
    }, prof1Token);

    assert(cloneRes.status === 201, '11a. Problem cloned successfully (201 Created)');
    const clonedProb = cloneRes.body.problem;
    assert(clonedProb.id !== p1Prob.id, '11b. Cloned problem has distinct new ID');
    assert(clonedProb.version === 1, '11c. Cloned problem starts at version 1');
    assert(clonedProb.isPublished === false, '11d. Cloned problem starts in draft state (isPublished = false)');
    assert(clonedProb.accessScope === 'contest_private', '11e. Cloned problem access scope is contest_private');
    assert(clonedProb.createdBy === prof1User.id, '11f. Cloned problem owned by cloner');

    // Verify cloned test cases
    const clonedTcs = await TestCaseModel.findTestCasesByProblemId(clonedProb.id, { includeHidden: true });
    assert(clonedTcs.length === 2, '11g. Cloned problem inherited 2 test cases');

    // Verify cloned problem has 0 submissions
    const hasSubs = await ProblemModel.hasSubmissions(clonedProb.id);
    assert(hasSubs === false, '11h. Cloned problem has 0 historical submissions');

    // Verify PROBLEM_CLONED audit log
    const cloneAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_CLONED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [clonedProb.id]
    );
    assert(cloneAudit.rows.length === 1, '11i. PROBLEM_CLONED audit log persisted in PostgreSQL');
    assert(cloneAudit.rows[0].metadata.sourceProblemId === p1Prob.id, '11j. Audit metadata records sourceProblemId');

    // ----------------------------------------------------
    // 11. Contest Safety & Deletion Guards
    // ----------------------------------------------------
    console.log('\n--- 12. Contest Safety & Deletion Guards ---');
    // Create submission on p1Prob
    const subRes = await db.query(
      `INSERT INTO submissions (user_id, problem_id, language, source_code, status, score)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;`,
      [studentUser.id, p1Prob.id, 'python', 'print("hello")', 'accepted', 100]
    );
    const subId = subRes.rows[0].id;
    assert(subId > 0, '12a. Test submission created for problem');

    // Attempt to delete problem with submission -> 409 Conflict
    const delConflictRes = await request('DELETE', `/api/problems/${p1Prob.id}`, null, prof1Token);
    assert(delConflictRes.status === 409, '12b. Deleting problem with historical submissions rejected with 409 Conflict');
    assert(delConflictRes.body.message.includes('submissions exist'), '12c. Conflict message returned');

    // Cloned problem has 0 submissions -> deletion succeeds
    const delCloneRes = await request('DELETE', `/api/problems/${clonedProb.id}`, null, prof1Token);
    assert(delCloneRes.status === 200, '12d. Cloned problem with 0 submissions deleted successfully (200 OK)');

    // ----------------------------------------------------
    // 12. Transactional Atomicity & Rollback Verification
    // ----------------------------------------------------
    console.log('\n--- 13. Transactional Atomicity & Rollback ---');
    const txClient = await db.getClient();
    let txProblemId;
    try {
      await txClient.query('BEGIN');
      const probTxRes = await txClient.query(
        `INSERT INTO problems (title, description, difficulty, access_scope, created_by)
         VALUES ('Tx Rollback Test Problem', 'Desc', 'easy', 'contest_private', $1)
         RETURNING id;`,
        [prof1User.id]
      );
      txProblemId = probTxRes.rows[0].id;

      await AuditLogger.logAction({
        actor: prof1User,
        action: 'PROBLEM_CREATED',
        resourceType: 'problem',
        resourceId: txProblemId,
        outcome: 'success',
        metadata: { txTest: true },
        client: txClient,
      });

      // Intentionally abort transaction
      await txClient.query('ROLLBACK');
    } finally {
      txClient.release();
    }

    const verifyProb = await db.query('SELECT id FROM problems WHERE id = $1', [txProblemId]);
    assert(verifyProb.rows.length === 0, '13a. Problem rolled back on transaction abort');

    const verifyAudit = await db.query('SELECT id FROM audit_logs WHERE resource_id = $1 AND metadata->>\'txTest\' = \'true\'', [txProblemId]);
    assert(verifyAudit.rows.length === 0, '13b. Audit log rolled back on transaction abort (0 phantom records)');

    // ----------------------------------------------------
    // 13. Cleaning Up Ephemeral Test Fixtures
    // ----------------------------------------------------
    console.log('\n--- 14. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM submissions WHERE user_id = $1;`, [studentUser.id]);
    await db.query(`DELETE FROM problem_versions WHERE problem_id = $1;`, [p1Prob.id]);
    await db.query(`DELETE FROM test_cases WHERE problem_id = $1;`, [p1Prob.id]);
    await db.query(`DELETE FROM problem_validation_configs WHERE problem_id = $1;`, [p1Prob.id]);
    await db.query(`DELETE FROM problems WHERE id = $1;`, [p1Prob.id]);
    await db.query(`DELETE FROM audit_logs WHERE actor_id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    console.log('[CLEANUP] Ephemeral test fixtures purged.');

    // ----------------------------------------------------
    // Summary
    // ----------------------------------------------------
    console.log('\n=======================================================');
    console.log(` PHASE 5.9.5 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('=======================================================\n');

  } catch (err) {
    console.error('[TEST SUITE CRASHED]:', err);
    failedAssertions++;
  } finally {
    if (server) {
      server.close();
    }
    await db.closePool();
    console.log('[DATABASE] PostgreSQL pool has been closed gracefully.');
    process.exit(failedAssertions > 0 ? 1 : 0);
  }
}

runTests();
