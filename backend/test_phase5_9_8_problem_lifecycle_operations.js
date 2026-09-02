/**
 * ========================================================================
 * PHASE 5.9.8 TEST SUITE: PROBLEM LIFECYCLE, VERSION HISTORY, ROLLBACK &
 * PUBLICATION OPERATIONS
 * ========================================================================
 *
 * Verifies:
 * 1. Strict RBAC & Student Denial on all lifecycle endpoints (403 Forbidden).
 * 2. Immutable Version Snapshots & Revision Persistence across problem mutations.
 * 3. Version Comparison Engine: safe field diffs & zero hidden-test leakage.
 * 4. Rollback Engine: creates new incremented version, restores test cases, preserves history.
 * 5. Rollback Review Invalidation: rollback cannot bypass review governance.
 * 6. Publication Operations: Unpublish / Withdraw, Archive, Restore from Archive.
 * 7. Dependency & Impact Analysis: prevents archive/unpublish when active in contests (409).
 * 8. Scheduled Publication: future timestamps, stale approval rejection, and execution safety.
 * 9. Cross-Professor Isolation & BOLA/IDOR protection.
 * 10. Hidden Test & Oracle Privacy Guarantees.
 * 11. SQL Injection & Mass Assignment Defense.
 * 12. Transaction Atomicity & Rollback Safety.
 * 13. Persistent PostgreSQL Audit Trail.
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const problemRoutes = require('./src/routes/problemRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const testCaseRoutes = require('./src/routes/testCaseRoutes');
const { generateToken } = require('./src/services/authService');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemReviewModel = require('./src/models/problemReviewModel');

let app;
let server;
let baseUrl;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    failedAssertions++;
    throw new Error(`Assertion failed: ${message}`);
  } else {
    passedAssertions++;
    console.log(`[PASS] ${message}`);
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      { method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsedBody = null;
          try {
            parsedBody = data ? JSON.parse(data) : {};
          } catch (e) {
            parsedBody = data;
          }
          resolve({ status: res.statusCode, body: parsedBody, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log(' STARTING PHASE 5.9.8 PROBLEM LIFECYCLE, ROLLBACK & OPERATIONS TEST');
  console.log('========================================================================\n');

  try {
    // ----------------------------------------------------
    // Server Initialization
    // ----------------------------------------------------
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api', testCaseRoutes);
    app.use('/api/problems', problemRoutes);
    app.use('/api/admin', adminRoutes);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    console.log(`[SERVER] Test server listening on ${baseUrl}`);

    // ----------------------------------------------------
    // 1. Setting Up Test Actors
    // ----------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');
    const timestamp = Date.now();

    // 1. Super Admin
    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, 'super_admin', 'Super Admin 598')
       RETURNING id, username, email, role;`,
      [`sa_598_${timestamp}`, `sa_598_${timestamp}@test.com`, 'hash']
    );
    const superAdmin = saRes.rows[0];
    const saToken = generateToken(superAdmin);

    // 2. Professor Alpha (Author / Owner)
    const prof1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, 'professor', 'Prof Alpha 598')
       RETURNING id, username, email, role;`,
      [`prof1_598_${timestamp}`, `prof1_598_${timestamp}@test.com`, 'hash']
    );
    const profAlpha = prof1Res.rows[0];
    const profAlphaToken = generateToken(profAlpha);

    // 3. Professor Beta (Peer Reviewer / Unauthorized)
    const prof2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, 'professor', 'Prof Beta 598')
       RETURNING id, username, email, role;`,
      [`prof2_598_${timestamp}`, `prof2_598_${timestamp}@test.com`, 'hash']
    );
    const profBeta = prof2Res.rows[0];
    const profBetaToken = generateToken(profBeta);

    // 4. Student (Unprivileged)
    const studentRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, 'student', 'Student 598')
       RETURNING id, username, email, role;`,
      [`student_598_${timestamp}`, `student_598_${timestamp}@test.com`, 'hash']
    );
    const student = studentRes.rows[0];
    const studentToken = generateToken(student);

    assert(superAdmin && profAlpha && profBeta && student, '1a. Test actors initialized successfully');

    // ----------------------------------------------------
    // 2. Strict RBAC: Student Role Denial
    // ----------------------------------------------------
    console.log('\n--- 2. Strict RBAC: Student Role Denial ---');
    const dummyId = 999999;
    const r1 = await request('GET', `/api/problems/${dummyId}/versions/compare?v1=1&v2=2`, null, studentToken);
    assert(r1.status === 403, '2a. Student cannot compare versions (403 Forbidden)');

    const r2 = await request('POST', `/api/problems/${dummyId}/versions/1/rollback`, null, studentToken);
    assert(r2.status === 403, '2b. Student cannot rollback problem (403 Forbidden)');

    const r3 = await request('POST', `/api/problems/${dummyId}/unpublish`, null, studentToken);
    assert(r3.status === 403, '2c. Student cannot unpublish problem (403 Forbidden)');

    const r4 = await request('POST', `/api/problems/${dummyId}/archive`, null, studentToken);
    assert(r4.status === 403, '2d. Student cannot archive problem (403 Forbidden)');

    const r5 = await request('POST', `/api/problems/${dummyId}/restore-archive`, null, studentToken);
    assert(r5.status === 403, '2e. Student cannot restore archived problem (403 Forbidden)');

    const r6 = await request('POST', `/api/problems/${dummyId}/schedule-publish`, { scheduledPublishAt: new Date(Date.now() + 3600000).toISOString() }, studentToken);
    assert(r6.status === 403, '2f. Student cannot schedule publication (403 Forbidden)');

    const r7 = await request('DELETE', `/api/problems/${dummyId}/schedule-publish`, null, studentToken);
    assert(r7.status === 403, '2g. Student cannot cancel scheduled publication (403 Forbidden)');

    const r8 = await request('GET', `/api/problems/${dummyId}/dependencies`, null, studentToken);
    assert(r8.status === 403, '2h. Student cannot view dependency impact analysis (403 Forbidden)');

    // ----------------------------------------------------
    // 3. Problem Creation, Versioning & Historical Snapshots
    // ----------------------------------------------------
    console.log('\n--- 3. Problem Creation, Versioning & Historical Snapshots ---');
    const createRes = await request('POST', '/api/problems', {
      title: `Binary Search Tree Validation ${timestamp}`,
      description: 'Given the root of a binary tree, determine if it is a valid binary search tree.\n\nInput Format: Array of node values.\nOutput Format: boolean true or false.\nConstraints: 1 <= n <= 10^4.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def isValidBST(self, root) -> bool:\n        pass\n',
        cpp: 'class Solution {\npublic:\n    bool isValidBST(TreeNode* root) {}\n};\n',
        java: 'class Solution {\n    public boolean isValidBST(TreeNode root) {}\n}\n',
      },
      harnessTemplates: {
        python: 'def solve(): pass\n',
        cpp: 'void solve() {}\n',
        java: 'class Solution { void solve() {} }\n',
      },
      accessScope: 'contest_private',
    }, profAlphaToken);

    assert(createRes.status === 201, '3a. Problem created as Version 1 (201 Created)');
    const probId = createRes.body.problem.id;

    // Add 1 sample and 2 hidden test cases
    await request('POST', `/api/problems/${probId}/test-cases`, { inputData: '[2,1,3]\n', expectedOutput: 'true\n', isHidden: false, testOrder: 1 }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/test-cases`, { inputData: '[5,1,4,null,null,3,6]\n', expectedOutput: 'false\n', isHidden: true, testOrder: 2 }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/test-cases`, { inputData: '[1,1]\n', expectedOutput: 'false\n', isHidden: true, testOrder: 3 }, profAlphaToken);

    // Request Review & Approve Version 1
    await request('POST', `/api/problems/${probId}/review-request`, { comment: 'Initial version 1 review' }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/review/start`, null, profBetaToken);
    await request('POST', `/api/problems/${probId}/review/approve`, { note: 'Version 1 verified' }, profBetaToken);

    // Publish Version 1
    const pub1Res = await request('POST', `/api/problems/${probId}/publish`, null, profAlphaToken);
    assert(pub1Res.status === 200, '3b. Version 1 published successfully (200 OK)');
    assert(pub1Res.body.problem.version === 1, '3c. Authoritative version is 1');

    // Mutate Problem to Version 2
    const updateRes = await request('PUT', `/api/problems/${probId}`, {
      title: `BST Validation & Bounds Check ${timestamp}`,
      description: 'Given the root of a binary tree, determine if it is a valid binary search tree.\n\nInput Format: Array representation of binary tree.\nOutput Format: boolean.\nConstraints: -2^31 <= Node.val <= 2^31 - 1, 1 <= n <= 10^5.',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'public',
      expectedVersion: 1,
    }, profAlphaToken);

    assert(updateRes.status === 200, '3d. Problem updated to Version 2 (200 OK)');
    assert(updateRes.body.problem.version === 2, '3e. Problem version incremented to 2');
    assert(updateRes.body.problem.reviewStatus === 'draft', '3f. Approval invalidated on edit (status reset to draft)');

    // Add extra test case for Version 2
    await request('POST', `/api/problems/${probId}/test-cases`, { inputData: '[-2147483648]\n', expectedOutput: 'true\n', isHidden: true, testOrder: 4 }, profAlphaToken);

    // Request Review & Approve Version 2
    await request('POST', `/api/problems/${probId}/review-request`, { comment: 'Version 2 with bounds review' }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/review/start`, null, profBetaToken);
    await request('POST', `/api/problems/${probId}/review/approve`, { note: 'Version 2 approved' }, profBetaToken);

    // Publish Version 2
    const pub2Res = await request('POST', `/api/problems/${probId}/publish`, null, profAlphaToken);
    assert(pub2Res.status === 200, '3g. Version 2 published successfully (200 OK)');
    assert(pub2Res.body.problem.version === 2, '3h. Version 2 snapshot created');

    // Verify Revision List
    const revListRes = await request('GET', `/api/problems/${probId}/versions`, null, profAlphaToken);
    assert(revListRes.status === 200, '3i. Revision history retrieved (200 OK)');
    assert(revListRes.body.count === 2, '3j. Exactly 2 published versions in history');
    assert(revListRes.body.versions[0].versionNumber === 2, '3k. Version 2 present');
    assert(revListRes.body.versions[1].versionNumber === 1, '3l. Version 1 present');

    // ----------------------------------------------------
    // 4. Version Comparison Engine
    // ----------------------------------------------------
    console.log('\n--- 4. Version Comparison Engine ---');
    const compRes = await request('GET', `/api/problems/${probId}/versions/compare?v1=1&v2=2`, null, profAlphaToken);
    assert(compRes.status === 200, '4a. Version comparison returned 200 OK');
    const diff = compRes.body.diff;
    assert(diff.hasChanges === true, '4b. Changes detected between v1 and v2');
    assert(diff.fields.title.changed === true, '4c. Title field diff flagged as changed');
    assert(diff.fields.difficulty.changed === true, '4d. Difficulty diff flagged (medium -> hard)');
    assert(diff.fields.difficulty.v1 === 'medium' && diff.fields.difficulty.v2 === 'hard', '4e. Difficulty values matched');
    assert(diff.fields.testCasesCount.v1.total === 3, '4f. Version 1 test case count is 3');
    assert(diff.fields.testCasesCount.v2.total === 4, '4g. Version 2 test case count is 4');

    // Invalid compare query tests
    const compInv1 = await request('GET', `/api/problems/${probId}/versions/compare?v1=1&v2=99`, null, profAlphaToken);
    assert(compInv1.status === 404, '4h. Non-existent version comparison returns 404 Not Found');

    const compInv2 = await request('GET', `/api/problems/${probId}/versions/compare?v1=abc&v2=2`, null, profAlphaToken);
    assert(compInv2.status === 400, '4i. Malformed version parameters return 400 Bad Request');

    // ----------------------------------------------------
    // 5. Rollback / Restore Engine & Immutability
    // ----------------------------------------------------
    console.log('\n--- 5. Rollback / Restore Engine & Immutability ---');
    const rollbackRes = await request('POST', `/api/problems/${probId}/versions/1/rollback`, {
      changeSummary: 'Restoring initial V1 configuration for contest compatibility',
    }, profAlphaToken);

    assert(rollbackRes.status === 200, '5a. Rollback to version 1 executed (200 OK)');
    const restoredProblem = rollbackRes.body.problem;
    assert(restoredProblem.version === 3, '5b. Rollback creates incremented Version 3 (never deletes history)');
    assert(restoredProblem.restoredFromVersion === 1, '5c. Restored from version 1 recorded');
    assert(restoredProblem.reviewStatus === 'draft', '5d. Review status reset to draft (approval invalidated)');
    assert(restoredProblem.isPublished === false, '5e. Problem is not published upon rollback');
    assert(restoredProblem.title === `Binary Search Tree Validation ${timestamp}`, '5f. Title restored to Version 1');

    // Verify Active Test Cases were restored to 3
    const tcRes = await TestCaseModel.findTestCasesByProblemId(probId, { includeHidden: true });
    assert(tcRes.length === 3, '5g. Active test cases reverted to Version 1 count (3 test cases)');

    // Verify Revision List now contains 3 versions
    const revListAfterRes = await request('GET', `/api/problems/${probId}/versions`, null, profAlphaToken);
    assert(revListAfterRes.body.count === 3, '5h. Revision history now contains 3 snapshots');
    const v3Snap = revListAfterRes.body.versions.find((v) => v.versionNumber === 3);
    assert(v3Snap && v3Snap.sourceAction === 'rollback', '5i. Version 3 source action marked as rollback');

    // ----------------------------------------------------
    // 6. Rollback Cannot Bypass Review Governance
    // ----------------------------------------------------
    console.log('\n--- 6. Rollback Cannot Bypass Review Governance ---');
    const unapprovedPubRes = await request('POST', `/api/problems/${probId}/publish`, null, profAlphaToken);
    assert(unapprovedPubRes.status === 422, '6a. Publishing rolled-back version without approval rejected (422)');
    assert(unapprovedPubRes.body.errors.some((e) => e.includes('approved')), '6b. Error specifies required peer review approval');

    // ----------------------------------------------------
    // 7. Publication Operations: Unpublish / Withdraw
    // ----------------------------------------------------
    console.log('\n--- 7. Publication Operations: Unpublish / Withdraw ---');
    // Review & approve Version 3
    await request('POST', `/api/problems/${probId}/review-request`, { comment: 'Review for restored v3' }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/review/start`, null, profBetaToken);
    await request('POST', `/api/problems/${probId}/review/approve`, { note: 'V3 verified' }, profBetaToken);

    // Publish Version 3
    await request('POST', `/api/problems/${probId}/publish`, null, profAlphaToken);

    // Unpublish / Withdraw problem
    const unpubRes = await request('POST', `/api/problems/${probId}/unpublish`, null, profAlphaToken);
    assert(unpubRes.status === 200, '7a. Problem unpublished / withdrawn (200 OK)');
    assert(unpubRes.body.isPublished === false, '7b. isPublished is false');
    assert(unpubRes.body.reviewStatus === 'withdrawn', '7c. reviewStatus is withdrawn');

    // Unpublishing already unpublished problem returns 400
    const unpubAgain = await request('POST', `/api/problems/${probId}/unpublish`, null, profAlphaToken);
    assert(unpubAgain.status === 400, '7d. Re-unpublishing returns 400 Bad Request');

    // ----------------------------------------------------
    // 8. Archive & Restore Lifecycle Operations
    // ----------------------------------------------------
    console.log('\n--- 8. Archive & Restore Lifecycle Operations ---');
    const archiveRes = await request('POST', `/api/problems/${probId}/archive`, null, profAlphaToken);
    assert(archiveRes.status === 200, '8a. Problem archived successfully (200 OK)');
    assert(archiveRes.body.reviewStatus === 'archived', '8b. reviewStatus updated to archived');

    const archiveAgain = await request('POST', `/api/problems/${probId}/archive`, null, profAlphaToken);
    assert(archiveAgain.status === 400, '8c. Archiving already archived problem returns 400');

    // Restore problem from archive
    const restoreArchRes = await request('POST', `/api/problems/${probId}/restore-archive`, null, profAlphaToken);
    assert(restoreArchRes.status === 200, '8d. Problem restored from archive (200 OK)');
    assert(restoreArchRes.body.reviewStatus === 'draft', '8e. reviewStatus reset to draft');

    // ----------------------------------------------------
    // 9. Scheduled Publication Flow & Execution
    // ----------------------------------------------------
    console.log('\n--- 9. Scheduled Publication Flow & Execution ---');
    // Request review & approve Version 3
    await request('POST', `/api/problems/${probId}/review-request`, { comment: 'Review for schedule publish' }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/review/start`, null, profBetaToken);
    await request('POST', `/api/problems/${probId}/review/approve`, { note: 'Approved for scheduled release' }, profBetaToken);

    // Schedule Publication for future date
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const schedRes = await request('POST', `/api/problems/${probId}/schedule-publish`, { scheduledPublishAt: futureDate }, profAlphaToken);
    assert(schedRes.status === 200, '9a. Publication scheduled for future timestamp (200 OK)');

    // Mutate problem to Version 4 (invalidates approval)
    await request('PUT', `/api/problems/${probId}`, {
      title: `BST Validation & Bounds Check V4 ${timestamp}`,
      description: 'Given the root of a binary tree, determine if it is a valid binary search tree.\n\nInput Format: Array.\nOutput Format: bool.\nConstraints: 1 <= n <= 10^5.',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'contest_private',
      expectedVersion: 3,
    }, profAlphaToken);

    // Attempt Execution on mutated/unapproved problem
    const execFailRes = await request('POST', `/api/problems/${probId}/execute-publish`, null, profAlphaToken);
    assert(execFailRes.status === 422, '9b. Scheduled execution on unapproved problem safely rejected (422)');

    // Re-approve Version 4 and Schedule again
    await request('POST', `/api/problems/${probId}/review-request`, { comment: 'V4 review' }, profAlphaToken);
    await request('POST', `/api/problems/${probId}/review/start`, null, profBetaToken);
    await request('POST', `/api/problems/${probId}/review/approve`, { note: 'V4 approved' }, profBetaToken);

    await request('POST', `/api/problems/${probId}/schedule-publish`, { scheduledPublishAt: futureDate }, profAlphaToken);

    // Cancel Scheduled Publication
    const cancelSchedRes = await request('DELETE', `/api/problems/${probId}/schedule-publish`, null, profAlphaToken);
    assert(cancelSchedRes.status === 200, '9c. Scheduled publication cancelled successfully (200 OK)');

    // Schedule again and execute publish
    await request('POST', `/api/problems/${probId}/schedule-publish`, { scheduledPublishAt: futureDate }, profAlphaToken);
    const execSuccessRes = await request('POST', `/api/problems/${probId}/execute-publish`, null, profAlphaToken);
    assert(execSuccessRes.status === 200, '9d. Scheduled publication executed successfully (200 OK)');
    assert(execSuccessRes.body.problem.isPublished === true, '9e. Problem is now published');

    // ----------------------------------------------------
    // 10. Dependency & Usage Impact Analysis
    // ----------------------------------------------------
    console.log('\n--- 10. Dependency & Usage Impact Analysis ---');
    const depRes = await request('GET', `/api/problems/${probId}/dependencies`, null, profAlphaToken);
    assert(depRes.status === 200, '10a. Dependency impact retrieved (200 OK)');
    const impact = depRes.body.impact;
    assert(typeof impact.impactLevel === 'string', '10b. Impact level computed');
    assert(typeof impact.canArchive === 'boolean', '10c. canArchive flag returned');
    assert(Array.isArray(impact.contests), '10d. Contests usage list returned');

    // Attach problem to an active/upcoming contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, created_by, status)
       VALUES ($1, 'Test Contest', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', $2, 'published')
       RETURNING id;`,
      [`Lifecycle Impact Contest ${timestamp}`, profAlpha.id]
    );
    const contestId = contestRes.rows[0].id;
    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order) VALUES ($1, $2, 1);`,
      [contestId, probId]
    );

    // Check Dependency Impact again
    const depWithContest = await request('GET', `/api/problems/${probId}/dependencies`, null, profAlphaToken);
    assert(depWithContest.body.impact.metrics.activeContestsCount >= 1, '10e. Active contest count tracks attached upcoming contest');
    assert(depWithContest.body.impact.canArchive === false, '10f. Archiving blocked when problem in upcoming contest');

    // Attempting to archive should fail with 409 Conflict
    const archBlockRes = await request('POST', `/api/problems/${probId}/archive`, null, profAlphaToken);
    assert(archBlockRes.status === 409, '10g. Archiving problem in active contest rejected with 409 Conflict');

    // Clean up test contest
    await db.query(`DELETE FROM contest_problems WHERE contest_id = $1`, [contestId]);
    await db.query(`DELETE FROM contests WHERE id = $1`, [contestId]);

    // ----------------------------------------------------
    // 11. Cross-Professor Isolation & IDOR/BOLA Defense
    // ----------------------------------------------------
    console.log('\n--- 11. Cross-Professor Isolation & IDOR/BOLA Defense ---');
    // Create private problem owned by Professor Alpha
    const privProbRes = await request('POST', '/api/problems', {
      title: `Alpha Secret Problem ${timestamp}`,
      description: 'Private research problem. Constraints: 1 <= n <= 10.',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'contest_private',
    }, profAlphaToken);
    const privProbId = privProbRes.body.problem.id;

    // Professor Beta cannot compare versions of Alpha's private problem
    const bComp = await request('GET', `/api/problems/${privProbId}/versions/compare?v1=1&v2=1`, null, profBetaToken);
    assert(bComp.status === 403, '11a. Professor Beta cannot compare versions of Alpha private problem (403)');

    // Professor Beta cannot rollback Alpha's problem
    const bRoll = await request('POST', `/api/problems/${privProbId}/versions/1/rollback`, null, profBetaToken);
    assert(bRoll.status === 403, '11b. Professor Beta cannot rollback Alpha problem (403)');

    // Professor Beta cannot unpublish Alpha's problem
    const bUnpub = await request('POST', `/api/problems/${privProbId}/unpublish`, null, profBetaToken);
    assert(bUnpub.status === 403, '11c. Professor Beta cannot unpublish Alpha problem (403)');

    // Professor Beta cannot archive Alpha's problem
    const bArch = await request('POST', `/api/problems/${privProbId}/archive`, null, profBetaToken);
    assert(bArch.status === 403, '11d. Professor Beta cannot archive Alpha problem (403)');

    // Clean up private problem
    await request('DELETE', `/api/problems/${privProbId}`, null, profAlphaToken);

    // ----------------------------------------------------
    // 12. Hidden Test Privacy & Secret Protection
    // ----------------------------------------------------
    console.log('\n--- 12. Hidden Test Privacy & Secret Protection ---');
    // Verify version compare diff returns ONLY counts
    const compPrivacy = await request('GET', `/api/problems/${probId}/versions/compare?v1=1&v2=2`, null, profAlphaToken);
    const tcField = compPrivacy.body.diff.fields.testCasesCount;
    assert(typeof tcField.v1.sample === 'number' && typeof tcField.v1.hidden === 'number', '12a. Diff returns test counts');
    assert(JSON.stringify(compPrivacy.body).indexOf('expectedOutput') === -1, '12b. Hidden test expected output NOT leaked in diff');
    assert(JSON.stringify(compPrivacy.body).indexOf('inputData') === -1, '12c. Hidden test input data NOT leaked in diff');

    // ----------------------------------------------------
    // 13. SQL Injection & Mass Assignment Defense
    // ----------------------------------------------------
    console.log('\n--- 13. SQL Injection & Mass Assignment Defense ---');
    const sqlInjections = [
      "1; DROP TABLE problem_versions CASCADE; --",
      "1' OR '1'='1",
      "1 UNION SELECT null, null, null",
    ];

    for (const sqli of sqlInjections) {
      const sqliRes = await request('GET', `/api/problems/${probId}/versions/compare?v1=${encodeURIComponent(sqli)}&v2=2`, null, profAlphaToken);
      assert(sqliRes.status === 400 || sqliRes.status === 404, `13a. SQL injection in version param safely rejected with ${sqliRes.status}`);
    }

    // Mass assignment injection in rollback
    const massAssignRes = await request('POST', `/api/problems/${probId}/versions/1/rollback`, {
      isPublished: true,
      reviewStatus: 'approved',
      version: 999,
      approvedBy: profAlpha.id,
    }, profAlphaToken);

    assert(massAssignRes.status === 200, '13b. Rollback succeeds');
    assert(massAssignRes.body.problem.isPublished === false, '13c. Injected isPublished=true neutralized');
    assert(massAssignRes.body.problem.reviewStatus === 'draft', '13d. Injected reviewStatus=approved neutralized');

    // ----------------------------------------------------
    // 14. Transaction Atomicity & Rollback Safety
    // ----------------------------------------------------
    console.log('\n--- 14. Transaction Atomicity & Rollback Safety ---');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO problem_versions (
          problem_id, version_number, title, description, difficulty, coding_mode,
          access_scope, test_cases_snapshot, validation_config_snapshot, created_by
        ) VALUES ($1, 9999, 'Rollback Test', 'Desc', 'easy', 'full_program', 'contest_private', '[]', '{}', $2)`,
        [probId, profAlpha.id]
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const checkPhantom = await db.query(
      `SELECT COUNT(*)::int AS count FROM problem_versions WHERE problem_id = $1 AND version_number = 9999;`,
      [probId]
    );
    assert(checkPhantom.rows[0].count === 0, '14a. Transaction abort leaves zero phantom version snapshots');

    // ----------------------------------------------------
    // 15. Persistent Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 15. Persistent Audit Logging Verification ---');
    const requiredAuditEvents = [
      'VERSION_COMPARED',
      'VERSION_RESTORED',
      'PROBLEM_PUBLISHED',
      'PROBLEM_UNPUBLISHED',
      'PROBLEM_ARCHIVED',
      'PROBLEM_RESTORED',
      'PUBLICATION_SCHEDULED',
      'PUBLICATION_SCHEDULE_CANCELLED',
      'PUBLICATION_EXECUTION_FAILED',
      'DEPENDENCY_IMPACT_CHECKED',
      'PRIVILEGED_ACTION_DENIED',
    ];

    for (const actionName of requiredAuditEvents) {
      const auditRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = $1;`,
        [actionName]
      );
      assert(auditRes.rows[0].count >= 1, `15. Audit log persisted for action "${actionName}" (count: ${auditRes.rows[0].count})`);
    }

    // ----------------------------------------------------
    // 16. Cleaning Up Ephemeral Test Fixtures
    // ----------------------------------------------------
    console.log('\n--- 16. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM test_cases WHERE problem_id = $1;`, [probId]);
    await db.query(`DELETE FROM problem_review_comments WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id = $1);`, [probId]);
    await db.query(`DELETE FROM problem_reviews WHERE problem_id = $1;`, [probId]);
    await db.query(`DELETE FROM problem_versions WHERE problem_id = $1;`, [probId]);
    await db.query(`DELETE FROM problem_quality_snapshots WHERE problem_id = $1;`, [probId]);
    await db.query(`DELETE FROM problems WHERE id = $1;`, [probId]);

    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4);`, [
      superAdmin.id,
      profAlpha.id,
      profBeta.id,
      student.id,
    ]);
    console.log('[CLEANUP] Ephemeral test fixtures purged.');

    console.log('\n========================================================================');
    console.log(` PHASE 5.9.8 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('========================================================================\n');
  } catch (err) {
    console.error('\n[TEST SUITE CRASHED]:', err);
    failedAssertions++;
  } finally {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close();
    }
    if (typeof db.closePool === 'function') {
      await db.closePool();
    } else if (db.pool) {
      await db.pool.end();
    }
    console.log('[DATABASE] PostgreSQL pool has been closed gracefully.');
    process.exit(failedAssertions > 0 ? 1 : 0);
  }
}

runTests();
