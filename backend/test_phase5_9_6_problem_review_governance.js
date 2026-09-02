/**
 * Phase 5.9.6 Problem Review, Approval & Publication Governance Automated Test Suite
 * 
 * Verifies:
 * 1. Strict RBAC (Student denial on review request, start, change request, reject, approve, resubmit, queue)
 * 2. Review Request Submission Lifecycle (Draft -> Review Requested)
 * 3. Reviewer Authorization & Start Review (Review Requested -> In Review)
 * 4. Self-Approval & Self-Review Prevention (Authors strictly forbidden from reviewing/approving own problems)
 * 5. Change Requests & Dialogue Comments (In Review -> Changes Requested)
 * 6. Resubmission Workflow (Changes Requested / Rejected -> Review Requested)
 * 7. Rejection Lifecycle (In Review -> Rejected)
 * 8. Version-Bound Review & Stale Approval Protection (409 Conflict on stale version approval)
 * 9. Approval Invalidation on Draft Mutation (Approved problem resets to Draft on content edit)
 * 10. Publication Review Gate (Direct publish bypass blocked without valid current version approval)
 * 11. Review History & Comments Persistence
 * 12. Review Queue / Admin Dashboard Querying
 * 13. Version Diff Comparison View
 * 14. BOLA / IDOR Defense & Parameter Tampering Resilience
 * 15. Transaction Atomicity & Rollback Verification
 * 16. Persistent Audit Logging
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const ProblemModel = require('./src/models/problemModel');
const ProblemReviewModel = require('./src/models/problemReviewModel');
const AuditLogModel = require('./src/models/auditLogModel');
const AuditLogger = require('./src/services/auditLogger');

let server;
let baseUrl;
const timestamp = Date.now();

// Test Actors
let studentUser, studentToken;
let prof1User, prof1Token; // Author (Professor Alpha)
let prof2User, prof2Token; // Reviewer (Professor Beta)
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
  console.log('========================================================================');
  console.log(' STARTING PHASE 5.9.6 PROBLEM REVIEW & APPROVAL GOVERNANCE TEST SUITE');
  console.log('========================================================================\n');

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
      [`std_596_${timestamp}`, `std_596_${timestamp}@test.edu`, pwdHash, 'Student 596', 'student']
    );
    studentUser = sRes.rows[0];
    studentToken = generateToken(studentUser);

    const p1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`prof1_596_${timestamp}`, `prof1_596_${timestamp}@test.edu`, pwdHash, 'Professor Alpha (Author)', 'professor']
    );
    prof1User = p1Res.rows[0];
    prof1Token = generateToken(prof1User);

    const p2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`prof2_596_${timestamp}`, `prof2_596_${timestamp}@test.edu`, pwdHash, 'Professor Beta (Reviewer)', 'professor']
    );
    prof2User = p2Res.rows[0];
    prof2Token = generateToken(prof2User);

    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, username, email, role, is_active;`,
      [`sa_596_${timestamp}`, `sa_596_${timestamp}@test.edu`, pwdHash, 'Super Admin 596', 'super_admin']
    );
    superAdminUser = saRes.rows[0];
    superAdminToken = generateToken(superAdminUser);

    assert(studentUser && prof1User && prof2User && superAdminUser, '1a. Test actors initialized successfully');

    // ----------------------------------------------------
    // 1. Strict RBAC (Student Denial)
    // ----------------------------------------------------
    console.log('\n--- 2. Strict RBAC: Student Role Denial ---');
    const stdReqRev = await request('POST', '/api/problems/1/review-request', null, studentToken);
    assert(stdReqRev.status === 403, '2a. Student cannot request review (403 Forbidden)');

    const stdStartRev = await request('POST', '/api/problems/1/review/start', null, studentToken);
    assert(stdStartRev.status === 403, '2b. Student cannot start review (403 Forbidden)');

    const stdReqChg = await request('POST', '/api/problems/1/review/request-changes', { comment: 'Fix' }, studentToken);
    assert(stdReqChg.status === 403, '2c. Student cannot request changes (403 Forbidden)');

    const stdReject = await request('POST', '/api/problems/1/review/reject', { reason: 'No' }, studentToken);
    assert(stdReject.status === 403, '2d. Student cannot reject review (403 Forbidden)');

    const stdApprove = await request('POST', '/api/problems/1/review/approve', null, studentToken);
    assert(stdApprove.status === 403, '2e. Student cannot approve review (403 Forbidden)');

    const stdResubmit = await request('POST', '/api/problems/1/review/resubmit', null, studentToken);
    assert(stdResubmit.status === 403, '2f. Student cannot resubmit review (403 Forbidden)');

    const stdGetRevs = await request('GET', '/api/problems/1/reviews', null, studentToken);
    assert(stdGetRevs.status === 403, '2g. Student cannot view problem reviews (403 Forbidden)');

    const stdQueue = await request('GET', '/api/admin/problem-reviews', null, studentToken);
    assert(stdQueue.status === 403, '2h. Student cannot view admin review queue (403 Forbidden)');

    // ----------------------------------------------------
    // 2. Author Problem Creation & Review Request
    // ----------------------------------------------------
    console.log('\n--- 3. Problem Creation & Review Request Submission ---');
    const createProbRes = await request('POST', '/api/problems', {
      title: `Graph Topological Sort ${timestamp}`,
      description: 'Find a valid topological ordering of vertices in a DAG.',
      difficulty: 'medium',
      codingMode: 'function',
      starterTemplates: { python: 'def topo_sort(n, edges):\n    pass\n' },
      harnessTemplates: { python: 'def run_harness():\n    pass\n' },
      accessScope: 'contest_private',
    }, prof1Token);

    assert(createProbRes.status === 201, '3a. Professor Alpha creates problem draft (201 Created)');
    const problem = createProbRes.body.problem;
    assert(problem.version === 1, '3b. Initial problem version is 1');
    assert(problem.reviewStatus === 'draft', '3c. Initial problem reviewStatus is draft');

    // Add sample test case
    await request('POST', `/api/problems/${problem.id}/test-cases`, {
      inputData: '4\n0 1\n0 2\n1 3\n2 3\n',
      expectedOutput: '0 1 2 3\n',
      isHidden: false,
    }, prof1Token);

    // Add hidden test case
    await request('POST', `/api/problems/${problem.id}/test-cases`, {
      inputData: '100\n...random...\n',
      expectedOutput: '...\n',
      isHidden: true,
    }, prof1Token);

    // Submit for peer review
    const revReqRes = await request('POST', `/api/problems/${problem.id}/review-request`, {
      comment: 'Initial submission for peer review',
    }, prof1Token);

    assert(revReqRes.status === 201, '3d. Problem submitted for peer review (201 Created)');
    assert(revReqRes.body.review.status === 'pending', '3e. Created review has status pending');
    assert(revReqRes.body.review.problemVersion === 1, '3f. Review bound to problem version 1');

    const updatedProb1 = await ProblemModel.findProblemById(problem.id);
    assert(updatedProb1.reviewStatus === 'review_requested', '3g. Problem reviewStatus updated to review_requested');

    // Verify PROBLEM_REVIEW_REQUESTED audit event
    const revReqAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_REVIEW_REQUESTED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [problem.id]
    );
    assert(revReqAudit.rows.length === 1, '3h. PROBLEM_REVIEW_REQUESTED audit log persisted in PostgreSQL');
    assert(revReqAudit.rows[0].actor_id === prof1User.id, '3i. Audit actor matches Professor Alpha ID');

    // ----------------------------------------------------
    // 3. Self-Approval & Self-Review Defense
    // ----------------------------------------------------
    console.log('\n--- 4. Self-Approval & Self-Review Defense ---');
    const selfStart = await request('POST', `/api/problems/${problem.id}/review/start`, null, prof1Token);
    assert(selfStart.status === 403, '4a. Author cannot start review on own problem (403 Forbidden)');
    assert(selfStart.body.message.includes('Authors cannot review or approve their own problems'), '4b. Safe self-review error message');

    const selfChanges = await request('POST', `/api/problems/${problem.id}/review/request-changes`, { comment: 'Change' }, prof1Token);
    assert(selfChanges.status === 403, '4c. Author cannot request changes on own problem (403 Forbidden)');

    const selfReject = await request('POST', `/api/problems/${problem.id}/review/reject`, { reason: 'Bad' }, prof1Token);
    assert(selfReject.status === 403, '4d. Author cannot reject own problem (403 Forbidden)');

    const selfApprove = await request('POST', `/api/problems/${problem.id}/review/approve`, null, prof1Token);
    assert(selfApprove.status === 403, '4e. Author cannot approve own problem (403 Forbidden)');
    assert(selfApprove.body.message.includes('Authors are strictly prohibited from approving their own problems'), '4f. Safe self-approval error message');

    // Verify PRIVILEGED_ACTION_DENIED audit log
    const denialAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PRIVILEGED_ACTION_DENIED' AND actor_id = $1 ORDER BY id DESC LIMIT 1;`,
      [prof1User.id]
    );
    assert(denialAudit.rows.length === 1, '4g. PRIVILEGED_ACTION_DENIED audit log recorded for self-approval attempt');
    assert(denialAudit.rows[0].metadata.reason === 'self_approval_prohibited', '4h. Audit metadata records self_approval_prohibited');

    // ----------------------------------------------------
    // 4. Reviewer Authorization & Start Review
    // ----------------------------------------------------
    console.log('\n--- 5. Reviewer Authorization & Start Review ---');
    const startRevRes = await request('POST', `/api/problems/${problem.id}/review/start`, null, prof2Token);
    assert(startRevRes.status === 200, '5a. Professor Beta starts review session (200 OK)');
    assert(startRevRes.body.review.status === 'in_review', '5b. Review status updated to in_review');
    assert(startRevRes.body.review.reviewerId === prof2User.id, '5c. Reviewer ID set to Professor Beta ID');

    const probInReview = await ProblemModel.findProblemById(problem.id);
    assert(probInReview.reviewStatus === 'in_review', '5d. Problem reviewStatus updated to in_review');

    // Verify PROBLEM_REVIEW_STARTED audit event
    const startAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_REVIEW_STARTED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [problem.id]
    );
    assert(startAudit.rows.length === 1, '5e. PROBLEM_REVIEW_STARTED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 5. Change Requests & Review Comments
    // ----------------------------------------------------
    console.log('\n--- 6. Change Requests & Dialogue Comments ---');
    const chgReqRes = await request('POST', `/api/problems/${problem.id}/review/request-changes`, {
      comment: 'Please add constraints on maximum vertices N and disconnected graph test cases.',
    }, prof2Token);

    assert(chgReqRes.status === 200, '6a. Professor Beta requests changes (200 OK)');
    assert(chgReqRes.body.review.status === 'changes_requested', '6b. Review status updated to changes_requested');

    const probChgReq = await ProblemModel.findProblemById(problem.id);
    assert(probChgReq.reviewStatus === 'changes_requested', '6c. Problem reviewStatus is changes_requested');

    // Verify review comments
    const reviewId = chgReqRes.body.review.id;
    const comments = await ProblemReviewModel.findReviewComments(reviewId);
    assert(comments.length >= 2, '6d. Review has author initial comment and change request comment');
    assert(comments.some(c => c.commentType === 'change_request'), '6e. Change request comment type preserved');

    // Verify PROBLEM_CHANGES_REQUESTED audit event
    const chgAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_CHANGES_REQUESTED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [problem.id]
    );
    assert(chgAudit.rows.length === 1, '6f. PROBLEM_CHANGES_REQUESTED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 6. Resubmission Lifecycle
    // ----------------------------------------------------
    console.log('\n--- 7. Resubmission Lifecycle ---');
    const resubRes = await request('POST', `/api/problems/${problem.id}/review/resubmit`, {
      comment: 'Added disconnected graph sample test and specified 1 <= N <= 10^5 constraints.',
    }, prof1Token);

    assert(resubRes.status === 201, '7a. Author resubmits problem for review (201 Created)');
    assert(resubRes.body.review.status === 'pending', '7b. Fresh review request is pending');

    const probResub = await ProblemModel.findProblemById(problem.id);
    assert(probResub.reviewStatus === 'review_requested', '7c. Problem reviewStatus updated to review_requested');

    // Verify PROBLEM_RESUBMITTED audit event
    const resubAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_RESUBMITTED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [problem.id]
    );
    assert(resubAudit.rows.length === 1, '7d. PROBLEM_RESUBMITTED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 7. Rejection Lifecycle
    // ----------------------------------------------------
    console.log('\n--- 8. Rejection Lifecycle ---');
    const rejectRes = await request('POST', `/api/problems/${problem.id}/review/reject`, {
      reason: 'Problem duplicate identified in existing problem bank.',
    }, prof2Token);

    assert(rejectRes.status === 200, '8a. Reviewer rejects problem (200 OK)');
    assert(rejectRes.body.review.status === 'rejected', '8b. Review status updated to rejected');

    const probRejected = await ProblemModel.findProblemById(problem.id);
    assert(probRejected.reviewStatus === 'rejected', '8c. Problem reviewStatus updated to rejected');

    // Resubmit after rejection
    await request('POST', `/api/problems/${problem.id}/review/resubmit`, {
      comment: 'Clarified novel variation distinguishing from duplicate.',
    }, prof1Token);

    // ----------------------------------------------------
    // 8. Version-Bound Review & Stale Approval Protection
    // ----------------------------------------------------
    console.log('\n--- 9. Version-Bound Review & Stale Approval Protection ---');
    // Active review is bound to version 1
    const activeRev1 = await ProblemReviewModel.findActiveReviewForProblem(problem.id);
    assert(activeRev1.problemVersion === 1, '9a. Active review is bound to version 1');

    // Author mutates problem draft -> version increments to 2
    const updateDraftRes = await request('PUT', `/api/problems/${problem.id}`, {
      title: `Topological Sort & Cycle Detection ${timestamp}`,
      expectedVersion: 1,
    }, prof1Token);
    assert(updateDraftRes.status === 200, '9b. Problem draft updated (200 OK)');
    assert(updateDraftRes.body.problem.version === 2, '9c. Problem version incremented to 2');
    assert(updateDraftRes.body.problem.reviewStatus === 'draft', '9d. Review status reset to draft on content update');

    // Active review was revoked by the draft update
    const staleRevCheck = await ProblemReviewModel.findReviewById(activeRev1.id);
    assert(staleRevCheck.status === 'revoked', '9e. Previous review on version 1 was revoked on draft update');

    // Author creates new review request bound to version 2
    const rev2Res = await request('POST', `/api/problems/${problem.id}/review-request`, {
      comment: 'Review request for version 2',
    }, prof1Token);
    assert(rev2Res.status === 201, '9f. New review request created for version 2');
    assert(rev2Res.body.review.problemVersion === 2, '9g. Review is bound to version 2');

    // Reviewer starts review
    await request('POST', `/api/problems/${problem.id}/review/start`, null, prof2Token);

    // Reviewer approves version 2
    const approveV2Res = await request('POST', `/api/problems/${problem.id}/review/approve`, {
      note: 'Verified problem statement, solution template, and test cases.',
    }, prof2Token);
    assert(approveV2Res.status === 200, '9h. Professor Beta approves version 2 (200 OK)');
    assert(approveV2Res.body.approvedVersion === 2, '9i. Approved version is 2');

    const probApproved = await ProblemModel.findProblemById(problem.id);
    assert(probApproved.reviewStatus === 'approved', '9j. Problem reviewStatus is approved');
    assert(probApproved.approvedVersion === 2, '9k. Problem approvedVersion is 2');
    assert(probApproved.approvedBy === prof2User.id, '9l. Problem approvedBy matches Professor Beta ID');

    // Verify PROBLEM_APPROVED audit log
    const approveAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_APPROVED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [problem.id]
    );
    assert(approveAudit.rows.length === 1, '9m. PROBLEM_APPROVED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 8b. Explicit Stale Approval Conflict (409 Conflict)
    // ----------------------------------------------------
    console.log('\n--- 9b. Explicit Stale Approval Conflict (409 Conflict) ---');
    // Create problem for stale approval test
    const staleProbRes = await request('POST', '/api/problems', {
      title: `Stale Conflict Test Problem ${timestamp}`,
      description: 'Test problem for stale approval detection',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'contest_private',
    }, prof1Token);
    const staleProbId = staleProbRes.body.problem.id;

    // Add sample test case
    await request('POST', `/api/problems/${staleProbId}/test-cases`, {
      inputData: '1\n',
      expectedOutput: '1\n',
      isHidden: false,
    }, prof1Token);

    // Request review for version 1
    const staleRevReq = await request('POST', `/api/problems/${staleProbId}/review-request`, { comment: 'v1 review' }, prof1Token);
    const staleRevId = staleRevReq.body.review.id;
    assert(staleRevReq.body.review.problemVersion === 1, '9n. Review request bound to version 1');

    // Author mutates problem draft to version 2 (simulating author update during review)
    // Manually force problem version to 2 while review remains for version 1 to test stale decision detection
    await db.query(`UPDATE problems SET version = 2 WHERE id = $1`, [staleProbId]);

    // Reviewer attempts to approve the stale review (which was bound to version 1)
    const staleApproveRes = await request('POST', `/api/problems/${staleProbId}/review/approve`, {
      note: 'Attempting to approve stale version',
    }, prof2Token);

    assert(staleApproveRes.status === 409, '9o. Stale approval rejected with 409 Conflict');
    assert(staleApproveRes.body.message.includes('stale') || staleApproveRes.body.message.includes('Conflict'), '9p. Error message indicates stale review version conflict');
    assert(staleApproveRes.body.currentVersion === 2, '9q. Response includes authoritative currentVersion 2');

    // Clean up stale test problem
    await db.query(`DELETE FROM test_cases WHERE problem_id = $1`, [staleProbId]);
    await db.query(`DELETE FROM problem_reviews WHERE problem_id = $1`, [staleProbId]);
    await db.query(`DELETE FROM problems WHERE id = $1`, [staleProbId]);

    // ----------------------------------------------------
    // 9. Approval Invalidation on Draft Mutation
    // ----------------------------------------------------
    console.log('\n--- 10. Approval Invalidation on Draft Mutation ---');
    // Author edits approved draft before publishing
    const mutateApprovedRes = await request('PUT', `/api/problems/${problem.id}`, {
      title: `Topological Sort Modified Again ${timestamp}`,
      expectedVersion: 2,
    }, prof1Token);
    assert(mutateApprovedRes.status === 200, '10a. Draft modified (200 OK)');
    assert(mutateApprovedRes.body.problem.version === 3, '10b. Version incremented to 3');
    assert(mutateApprovedRes.body.problem.reviewStatus === 'draft', '10c. APPROVAL INVALIDATED: reviewStatus reset to draft');
    assert(mutateApprovedRes.body.problem.approvedVersion === null, '10d. APPROVAL INVALIDATED: approvedVersion reset to null');

    const checkProbDb = await ProblemModel.findProblemById(problem.id);
    assert(checkProbDb.reviewStatus === 'draft', '10e. Database reviewStatus is draft');
    assert(checkProbDb.approvedVersion === null, '10f. Database approvedVersion is null');

    // ----------------------------------------------------
    // 10. Publish Bypass Prevention (Enforces Approval Gate)
    // ----------------------------------------------------
    console.log('\n--- 11. Publish Bypass Prevention ---');
    // Attempt to publish unapproved version 3 directly -> rejected by validation gate
    const failPublishRes = await request('POST', `/api/problems/${problem.id}/publish`, null, prof1Token);
    assert(failPublishRes.status === 422, '11a. Unapproved problem publication rejected with 422 Unprocessable Entity');
    assert(failPublishRes.body.errors.some(e => e.includes('approved review')), '11b. Validation error specifies missing approval');

    // Resubmit version 3 for review
    await request('POST', `/api/problems/${problem.id}/review-request`, { comment: 'Review v3' }, prof1Token);
    // Reviewer approves version 3
    const approveV3 = await request('POST', `/api/problems/${problem.id}/review/approve`, { note: 'Approved v3' }, prof2Token);
    assert(approveV3.status === 200, '11c. Version 3 approved by Professor Beta (200 OK)');

    // Now publish version 3 -> succeeds
    const pubSuccessRes = await request('POST', `/api/problems/${problem.id}/publish`, null, prof1Token);
    assert(pubSuccessRes.status === 200, '11d. Approved problem published successfully (200 OK)');
    assert(pubSuccessRes.body.problem.isPublished === true, '11e. Published problem has isPublished = true');
    assert(pubSuccessRes.body.problem.reviewStatus === 'published', '11f. Published problem has reviewStatus = published');

    // ----------------------------------------------------
    // 11. Review History & Comments Persistence
    // ----------------------------------------------------
    console.log('\n--- 12. Review History & Dialogue Comments ---');
    const revsRes = await request('GET', `/api/problems/${problem.id}/reviews`, null, prof1Token);
    assert(revsRes.status === 200, '12a. Author retrieves review history (200 OK)');
    assert(revsRes.body.reviews.length >= 3, '12b. Review history records all lifecycle review attempts');

    const latestRev = revsRes.body.reviews[0];
    const revDetailRes = await request('GET', `/api/problems/${problem.id}/reviews/${latestRev.id}`, null, prof1Token);
    assert(revDetailRes.status === 200, '12c. Review detail retrieved (200 OK)');
    assert(revDetailRes.body.review.comments.length >= 1, '12d. Review detail includes dialog comments');

    // Add persistent author comment
    const addCommentRes = await request('POST', `/api/problems/${problem.id}/reviews/${latestRev.id}/comments`, {
      comment: 'Thank you for the review feedback and approval!',
      commentType: 'author_response',
    }, prof1Token);
    assert(addCommentRes.status === 201, '12e. Author comment added (201 Created)');

    // ----------------------------------------------------
    // 12. Review Queue / Admin Dashboard Querying
    // ----------------------------------------------------
    console.log('\n--- 13. Review Queue / Dashboard Querying ---');
    const queueRes = await request('GET', '/api/admin/problem-reviews?limit=20', null, superAdminToken);
    assert(queueRes.status === 200, '13a. Super Admin retrieves review queue (200 OK)');
    assert(queueRes.body.reviews.length >= 1, '13b. Review queue contains reviews');
    assert(queueRes.body.total >= 1, '13c. Review queue pagination total present');

    const filterStatusRes = await request('GET', '/api/admin/problem-reviews?status=approved', null, superAdminToken);
    assert(filterStatusRes.status === 200, '13d. Filter queue by status approved returns 200 OK');
    assert(filterStatusRes.body.reviews.every(r => r.status === 'approved'), '13e. All returned reviews have status approved');

    // ----------------------------------------------------
    // 13. Version Diff Comparison View
    // ----------------------------------------------------
    console.log('\n--- 14. Version Diff Comparison View ---');
    const diffRes = await request('GET', `/api/problems/${problem.id}/reviews/${latestRev.id}/diff`, null, prof2Token);
    assert(diffRes.status === 200, '14a. Review diff comparison retrieved (200 OK)');
    assert(diffRes.body.diff.problemId === problem.id, '14b. Diff problemId matches');
    assert(diffRes.body.diff.submittedVersion !== undefined, '14c. Diff contains submittedVersion');
    assert(diffRes.body.diff.currentVersion !== undefined, '14d. Diff contains currentVersion');

    // ----------------------------------------------------
    // 14. BOLA / IDOR Defense & Parameter Tampering Resilience
    // ----------------------------------------------------
    console.log('\n--- 15. BOLA / IDOR Defense ---');
    const nonExistentRev = await request('GET', `/api/problems/${problem.id}/reviews/999999`, null, prof1Token);
    assert(nonExistentRev.status === 404, '15a. Non-existent review ID returns 404 Not Found');

    const malformedProbRev = await request('GET', '/api/problems/invalid-id/reviews', null, prof1Token);
    assert(malformedProbRev.status === 400, '15b. Malformed problem ID returns 400 Bad Request');

    const malformedRevDetail = await request('GET', `/api/problems/${problem.id}/reviews/invalid-rev-id`, null, prof1Token);
    assert(malformedRevDetail.status === 400, '15c. Malformed review ID returns 400 Bad Request');

    // ----------------------------------------------------
    // 16. Transaction Atomicity & Rollback Verification
    // ----------------------------------------------------
    console.log('\n--- 16. Transaction Atomicity & Rollback ---');
    const txClient = await db.getClient();
    let txRevProblemId;
    try {
      await txClient.query('BEGIN');
      const probTxRes = await txClient.query(
        `INSERT INTO problems (title, description, difficulty, access_scope, created_by, review_status)
         VALUES ('Tx Review Rollback Problem', 'Desc', 'easy', 'contest_private', $1, 'draft')
         RETURNING id;`,
        [prof1User.id]
      );
      txRevProblemId = probTxRes.rows[0].id;

      await ProblemReviewModel.createReviewRequest({
        problemId: txRevProblemId,
        problemVersion: 1,
        submittedBy: prof1User.id,
      }, txClient);

      await AuditLogger.logAction({
        actor: prof1User,
        action: 'PROBLEM_REVIEW_REQUESTED',
        resourceType: 'problem',
        resourceId: txRevProblemId,
        outcome: 'success',
        metadata: { txRollbackTest: true },
        client: txClient,
      });

      // Intentionally abort transaction
      await txClient.query('ROLLBACK');
    } finally {
      txClient.release();
    }

    const checkTxProb = await db.query('SELECT id FROM problems WHERE id = $1', [txRevProblemId]);
    assert(checkTxProb.rows.length === 0, '16a. Problem rolled back on transaction abort');

    const checkTxRev = await db.query('SELECT id FROM problem_reviews WHERE problem_id = $1', [txRevProblemId]);
    assert(checkTxRev.rows.length === 0, '16b. Review record rolled back on transaction abort');

    const checkTxAudit = await db.query('SELECT id FROM audit_logs WHERE resource_id = $1 AND metadata->>\'txRollbackTest\' = \'true\'', [txRevProblemId]);
    assert(checkTxAudit.rows.length === 0, '16c. Audit log rolled back on transaction abort (0 phantom records)');

    // ----------------------------------------------------
    // 17. Mass Assignment Defense
    // ----------------------------------------------------
    console.log('\n--- 17. Mass Assignment Defense ---');
    const massProbRes = await request('POST', '/api/problems', {
      title: `Mass Assignment Problem ${timestamp}`,
      description: 'Valid problem description for testing mass assignment defenses',
      difficulty: 'easy',
      // Attacker attempts to inject protected fields
      role: 'super_admin',
      isPublished: true,
      reviewStatus: 'approved',
      approvedVersion: 1,
      version: 99,
    }, prof1Token);

    assert(massProbRes.status === 201, '17a. Problem created safely');
    assert(massProbRes.body.problem.isPublished === false, '17b. Injected isPublished=true ignored');
    assert(massProbRes.body.problem.reviewStatus === 'draft', '17c. Injected reviewStatus=approved ignored');
    assert(massProbRes.body.problem.version === 1, '17d. Injected version=99 ignored');

    const massProbId = massProbRes.body.problem.id;
    // ----------------------------------------------------
    // 18. SQL Injection Hardening
    // ----------------------------------------------------
    console.log('\n--- 18. SQL Injection Resilience ---');
    const sqliComments = [
      "'; DROP TABLE problem_reviews; --",
      "' OR 1=1 --",
      "' UNION SELECT null, null, null, null, null, null, null --",
    ];

    for (const sqli of sqliComments) {
      const sqliReq = await request('GET', `/api/admin/problem-reviews?search=${encodeURIComponent(sqli)}`, null, superAdminToken);
      assert(sqliReq.status === 200, `18a. SQL injection in queue search neutralized (${sqli.substring(0, 15)}...)`);
    }

    // Verify problem_reviews table is intact
    const tableCheck = await db.query(`SELECT COUNT(*)::int AS count FROM problem_reviews;`);
    assert(tableCheck.rows[0].count >= 0, '18b. Database relations intact after SQL injection attempts');

    // ----------------------------------------------------
    // 19. Hidden Test Privacy in Reviews
    // ----------------------------------------------------
    console.log('\n--- 19. Hidden Test Privacy in Review Workflow ---');
    // Verify preview endpoint does not expose hidden tests
    const previewRes = await request('GET', `/api/problems/${problem.id}/preview`, null, prof1Token);
    assert(previewRes.status === 200, '19a. Preview endpoint returns 200 OK');
    assert(previewRes.body.sampleTestCases.every(tc => tc.isHidden === false), '19b. Preview only returns sample test cases');

    // Student preview/problem access check
    const stdProbRes = await request('GET', `/api/problems/${problem.id}`, null, studentToken);
    assert(stdProbRes.status === 200, '19c. Student can view published problem');
    // Ensure test_cases returned to student are strictly sample/visible
    const stdTcRes = await request('GET', `/api/problems/${problem.id}/test-cases`, null, studentToken);
    assert(stdTcRes.status === 403, '19d. Direct administrative test cases endpoint forbidden for students (403)');

    // ----------------------------------------------------
    // 20. Historical Review Integrity
    // ----------------------------------------------------
    console.log('\n--- 20. Historical Review Integrity ---');
    const histRevs = await ProblemReviewModel.findReviewsByProblemId(problem.id);
    assert(histRevs.length >= 3, '20a. Historical review count preserved');
    assert(histRevs.some(r => r.status === 'rejected'), '20b. Historical rejected review preserved');
    assert(histRevs.some(r => r.status === 'approved'), '20c. Historical approved review preserved');

    // Clean up mass assignment problem
    await db.query(`DELETE FROM problems WHERE id = $1`, [massProbId]);

    // ----------------------------------------------------
    // 21. Cleaning Up Ephemeral Test Fixtures
    // ----------------------------------------------------
    console.log('\n--- 21. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM problem_review_comments WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id = $1);`, [problem.id]);
    await db.query(`DELETE FROM problem_reviews WHERE problem_id = $1;`, [problem.id]);
    await db.query(`DELETE FROM problem_versions WHERE problem_id = $1;`, [problem.id]);
    await db.query(`DELETE FROM test_cases WHERE problem_id = $1;`, [problem.id]);
    await db.query(`DELETE FROM problems WHERE id = $1;`, [problem.id]);
    await db.query(`DELETE FROM audit_logs WHERE actor_id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    console.log('[CLEANUP] Ephemeral test fixtures purged.');

    // ----------------------------------------------------
    // Summary
    // ----------------------------------------------------
    console.log('\n========================================================================');
    console.log(` PHASE 5.9.6 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('========================================================================\n');

  } catch (err) {
    console.error('[TEST SUITE CRASHED]:', err);
    failedAssertions++;
  } finally {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close();
    }
    await db.closePool();
    console.log('[DATABASE] PostgreSQL pool has been closed gracefully.');
    process.exit(failedAssertions > 0 ? 1 : 0);
  }
}

runTests();
