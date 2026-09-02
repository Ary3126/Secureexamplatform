/**
 * Automated Verification Suite: Phase 5.9.7 Problem Quality, Editorial Intelligence & Review Analytics
 * 
 * Verifies:
 * 1. Strict Role-Based Access Control (Student denial across all endpoints)
 * 2. Deterministic Quality Scoring & Component Breakdown (0-100 scale)
 * 3. Structured 12-Item Editorial Checklist (A through L)
 * 4. Incomplete / Poor Quality Detection & Warnings
 * 5. Duplicate & Similarity Detection (Jaccard NLP Tokenization)
 * 6. Cross-Professor Isolation & Private Statement Shielding
 * 7. Hidden Test & Oracle Privacy Guarantees
 * 8. Problem Review Pipeline Analytics & Rates
 * 9. Review SLA / Aging Distribution (ON_TIME, AT_RISK, OVERDUE)
 * 10. Platform-Wide Review Analytics & Reviewer Workload (Super Admin)
 * 11. Version-Bound Quality Snapshot Persistence & Immutability
 * 12. Stale Approval & Publication Bypass Prevention
 * 13. BOLA / IDOR Defense (400 on malformed, 404 on nonexistent)
 * 14. Mass Assignment & Parameter Injection Protection
 * 15. SQL Injection Resilience
 * 16. Transaction Atomicity & Rollback Safety
 * 17. Security Audit Logging Persistence
 * 18. Teardown & Ephemeral Fixture Hygiene
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
const ProblemQualityModel = require('./src/models/problemQualityModel');

let app;
let server;
let baseUrl;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  if (!condition) {
    failedAssertions++;
    console.error(`[FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedAssertions++;
  console.log(`[PASS] ${message}`);
}

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : null;
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, body: raw });
          }
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
  console.log(' STARTING PHASE 5.9.7 PROBLEM QUALITY, EDITORIAL & REVIEW ANALYTICS TEST');
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
    const suffix = Date.now().toString();

    const studentUser = await UserModel.createUser({
      username: `student_597_${suffix}`,
      email: `student_597_${suffix}@test.edu`,
      passwordHash: 'dummy_hash',
      fullName: 'Student Quality Tester',
      role: 'student',
    });

    const prof1User = await UserModel.createUser({
      username: `prof1_597_${suffix}`,
      email: `prof1_597_${suffix}@test.edu`,
      passwordHash: 'dummy_hash',
      fullName: 'Professor Alpha Author',
      role: 'professor',
    });

    const prof2User = await UserModel.createUser({
      username: `prof2_597_${suffix}`,
      email: `prof2_597_${suffix}@test.edu`,
      passwordHash: 'dummy_hash',
      fullName: 'Professor Beta Reviewer',
      role: 'professor',
    });

    const superAdminUser = await UserModel.createUser({
      username: `sa_597_${suffix}`,
      email: `sa_597_${suffix}@test.edu`,
      passwordHash: 'dummy_hash',
      fullName: 'Super Admin Quality Oversight',
      role: 'super_admin',
    });

    const studentToken = generateToken(studentUser);
    const prof1Token = generateToken(prof1User);
    const prof2Token = generateToken(prof2User);
    const superAdminToken = generateToken(superAdminUser);

    assert(studentToken && prof1Token && prof2Token && superAdminToken, '1a. Test actors initialized successfully');

    // ----------------------------------------------------
    // 2. Strict RBAC: Student Role Denial
    // ----------------------------------------------------
    console.log('\n--- 2. Strict RBAC: Student Role Denial ---');
    const studentQual = await request('GET', '/api/problems/1/quality', null, studentToken);
    assert(studentQual.status === 403, '2a. Student cannot evaluate problem quality (403 Forbidden)');

    const studentChecklist = await request('GET', '/api/problems/1/editorial-checklist', null, studentToken);
    assert(studentChecklist.status === 403, '2b. Student cannot view editorial checklist (403 Forbidden)');

    const studentSim = await request('GET', '/api/problems/1/similarity', null, studentToken);
    assert(studentSim.status === 403, '2c. Student cannot access similarity detection (403 Forbidden)');

    const studentProbAnalytics = await request('GET', '/api/problems/1/review-analytics', null, studentToken);
    assert(studentProbAnalytics.status === 403, '2d. Student cannot view problem review analytics (403 Forbidden)');

    const studentAdminRev = await request('GET', '/api/admin/problem-review-analytics', null, studentToken);
    assert(studentAdminRev.status === 403, '2e. Student cannot view admin review analytics (403 Forbidden)');

    const studentReviewerPerf = await request('GET', '/api/admin/reviewer-analytics', null, studentToken);
    assert(studentReviewerPerf.status === 403, '2f. Student cannot view reviewer analytics (403 Forbidden)');

    // ----------------------------------------------------
    // 3. High-Quality Problem Creation & Deterministic Quality Scoring
    // ----------------------------------------------------
    console.log('\n--- 3. High-Quality Problem Creation & Deterministic Quality Scoring ---');
    const goodProbRes = await request('POST', '/api/problems', {
      title: `Optimal Binary Search Tree Path Sum ${suffix}`,
      description: `### Problem Statement\nGiven the root of a binary search tree, find the maximum path sum between any two nodes.\n\n### Input Format\nFirst line contains integer N.\n\n### Output Format\nPrint maximum path sum.\n\n### Constraints\n1 <= N <= 10^5\nNode values between -1000 and 1000.\nTime Complexity: O(N)\nSpace Complexity: O(H)\n`,
      difficulty: 'hard',
      codingMode: 'function',
      starterTemplates: {
        python: 'def maxPathSum(root):\n    # Write code\n    return 0\n',
        cpp: 'int maxPathSum(TreeNode* root) {\n    return 0;\n}\n',
        java: 'class Solution {\n    public int maxPathSum(TreeNode root) {\n        return 0;\n    }\n}\n',
      },
      harnessTemplates: {
        python: 'def solve(): pass\n',
        cpp: 'void solve() {}\n',
        java: 'class Solution { void solve() {} }\n',
      },
      accessScope: 'contest_private',
    }, prof1Token);

    assert(goodProbRes.status === 201, '3a. High-quality problem created (201 Created)');
    const goodProbId = goodProbRes.body.problem.id;

    // Add 1 visible sample test case and 2 hidden test cases
    await request('POST', `/api/problems/${goodProbId}/test-cases`, {
      inputData: '3\n1 2 3\n',
      expectedOutput: '6\n',
      isHidden: false,
      testOrder: 1,
    }, prof1Token);

    await request('POST', `/api/problems/${goodProbId}/test-cases`, {
      inputData: '5\n-10 9 20 15 7\n',
      expectedOutput: '42\n',
      isHidden: true,
      testOrder: 2,
    }, prof1Token);

    await request('POST', `/api/problems/${goodProbId}/test-cases`, {
      inputData: '1\n-3\n',
      expectedOutput: '-3\n',
      isHidden: true,
      testOrder: 3,
    }, prof1Token);

    // Evaluate Quality
    const qualityRes = await request('GET', `/api/problems/${goodProbId}/quality`, null, prof1Token);
    assert(qualityRes.status === 200, '3b. Quality evaluated successfully (200 OK)');
    assert(typeof qualityRes.body.qualityScore === 'number', '3c. Quality score is numeric');
    assert(qualityRes.body.qualityScore >= 80, `3d. Quality score is high (${qualityRes.body.qualityScore}/100)`);
    assert(qualityRes.body.qualityLevel === 'EXCELLENT' || qualityRes.body.qualityLevel === 'GOOD', '3e. Quality level is EXCELLENT or GOOD');

    // Verify Breakdown Categories
    const bk = qualityRes.body.breakdown;
    assert(bk.titleQuality.score === 10, '3f. Title quality score full (10/10)');
    assert(bk.statementCompleteness.score === 20, '3g. Statement completeness score full (20/20)');
    assert(bk.difficultyConsistency.score === 10, '3h. Difficulty consistency score full (10/10)');
    assert(bk.codingModeAndTemplates.score === 15, '3i. Function mode templates score full (15/15)');
    assert(bk.testCoverage.score === 25, '3j. Test coverage score full (25/25)');
    assert(bk.complexityDocumentation.score === 10, '3k. Complexity documentation score full (10/10)');
    assert(bk.similarityRisk.score === 10, '3l. Similarity risk score full (10/10)');

    // ----------------------------------------------------
    // 4. Structured 12-Item Editorial Checklist (A–L)
    // ----------------------------------------------------
    console.log('\n--- 4. Structured 12-Item Editorial Checklist (A-L) ---');
    const chkRes = await request('GET', `/api/problems/${goodProbId}/editorial-checklist`, null, prof1Token);
    assert(chkRes.status === 200, '4a. Editorial checklist retrieved (200 OK)');
    assert(Array.isArray(chkRes.body.checklist), '4b. Checklist is an array');
    assert(chkRes.body.checklist.length === 12, '4c. Exactly 12 structured checklist criteria present (A-L)');

    const chkMap = {};
    chkRes.body.checklist.forEach(item => { chkMap[item.key] = item; });

    assert(chkMap['A'] && chkMap['A'].status === 'PASS', '4d. Item A (Problem Statement) is PASS');
    assert(chkMap['B'] && chkMap['B'].status === 'PASS', '4e. Item B (Constraints) is PASS');
    assert(chkMap['C'] && chkMap['C'].status === 'PASS', '4f. Item C (Input Specification) is PASS');
    assert(chkMap['D'] && chkMap['D'].status === 'PASS', '4g. Item D (Output Specification) is PASS');
    assert(chkMap['E'] && chkMap['E'].status === 'PASS', '4h. Item E (Examples & Samples) is PASS');
    assert(chkMap['F'] && chkMap['F'].status === 'PASS', '4i. Item F (Difficulty) is PASS');
    assert(chkMap['G'] && chkMap['G'].status === 'PASS', '4j. Item G (Complexity Expectations) is PASS');
    assert(chkMap['H'] && chkMap['H'].status === 'PASS', '4k. Item H (Starter Code & Harness) is PASS');
    assert(chkMap['I'] && chkMap['I'].status === 'PASS', '4l. Item I (Test Coverage) is PASS');
    assert(chkMap['J'] && chkMap['J'].status === 'PASS', '4m. Item J (Edge Cases) is PASS');
    assert(chkMap['K'] && chkMap['K'].status === 'PASS', '4n. Item K (Security & Leakage) is PASS');
    assert(chkMap['L'] && chkMap['L'].status === 'PASS', '4o. Item L (Duplicate Similarity) is PASS');

    // ----------------------------------------------------
    // 5. Incomplete / Poor Quality Problem Scoring
    // ----------------------------------------------------
    console.log('\n--- 5. Incomplete / Poor Quality Problem Scoring ---');
    const poorProbRes = await request('POST', '/api/problems', {
      title: 'Untitled',
      description: 'Find something.',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'contest_private',
    }, prof1Token);
    assert(poorProbRes.status === 201, '5a. Incomplete problem draft created');
    const poorProbId = poorProbRes.body.problem.id;

    const poorQualRes = await request('GET', `/api/problems/${poorProbId}/quality`, null, prof1Token);
    assert(poorQualRes.status === 200, '5b. Poor quality problem evaluated');
    assert(poorQualRes.body.qualityScore < 50, `5c. Low quality score correctly returned (${poorQualRes.body.qualityScore}/100)`);
    assert(poorQualRes.body.qualityLevel === 'NEEDS_IMPROVEMENT' || poorQualRes.body.qualityLevel === 'FAIR', '5d. Quality level indicates improvement needed');

    const poorChkRes = await request('GET', `/api/problems/${poorProbId}/editorial-checklist`, null, prof1Token);
    const poorChkMap = {};
    poorChkRes.body.checklist.forEach(item => { poorChkMap[item.key] = item; });
    assert(poorChkMap['A'].status === 'FAIL', '5e. Item A (Problem Statement) fails for short statement');
    assert(poorChkMap['E'].status === 'FAIL', '5f. Item E (Examples) fails for missing sample test');
    assert(poorChkMap['H'].status === 'FAIL', '5g. Item H (Starter Code) fails for missing function templates');
    assert(poorChkMap['I'].status === 'FAIL', '5h. Item I (Test Coverage) fails for 0 test cases');

    // Clean up poor problem
    await request('DELETE', `/api/problems/${poorProbId}`, null, prof1Token);

    // ----------------------------------------------------
    // 6. Duplicate & Similarity Detection
    // ----------------------------------------------------
    console.log('\n--- 6. Duplicate & Similarity Detection ---');
    const dupeProbRes = await request('POST', '/api/problems', {
      title: `Optimal Binary Search Tree Path Sum ${suffix}`,
      description: `### Problem Statement\nGiven the root of a binary search tree, find the maximum path sum between any two nodes.\n\n### Input Format\nFirst line contains integer N.\n\n### Output Format\nPrint maximum path sum.\n\n### Constraints\n1 <= N <= 10^5\nNode values between -1000 and 1000.\nTime Complexity: O(N)\nSpace Complexity: O(H)\n`,
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'contest_private',
    }, prof1Token);
    const dupeProbId = dupeProbRes.body.problem.id;

    const simRes = await request('GET', `/api/problems/${dupeProbId}/similarity`, null, prof1Token);
    assert(simRes.status === 200, '6a. Similarity detection returns 200 OK');
    assert(simRes.body.highestSimilarityScore >= 80, `6b. High similarity detected (${simRes.body.highestSimilarityScore}%)`);
    assert(simRes.body.similarityLevel === 'HIGH' || simRes.body.similarityLevel === 'MODERATE', '6c. Similarity level classified as HIGH or MODERATE');
    assert(simRes.body.matchedProblems.some(m => m.problemId === goodProbId), '6d. Matched problems list contains original problem ID');

    // Clean up duplicate problem
    await request('DELETE', `/api/problems/${dupeProbId}`, null, prof1Token);

    // ----------------------------------------------------
    // 7. Cross-Professor Isolation & Private Statement Shielding
    // ----------------------------------------------------
    console.log('\n--- 7. Cross-Professor Isolation & Private Statement Shielding ---');
    // Professor Beta creates a problem and checks similarity
    const prof2Prob = await request('POST', '/api/problems', {
      title: `Graph Traversal Algorithm ${suffix}`,
      description: 'Perform breadth first search on an undirected graph with N vertices and M edges.',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'contest_private',
    }, prof2Token);
    const prof2ProbId = prof2Prob.body.problem.id;

    const prof2Sim = await request('GET', `/api/problems/${prof2ProbId}/similarity`, null, prof2Token);
    assert(prof2Sim.status === 200, '7a. Professor Beta can run similarity check on own problem');
    // Professor Beta must NOT see private description or hidden tests of Professor Alpha's problem
    if (prof2Sim.body.matchedProblems?.length > 0) {
      assert(!prof2Sim.body.matchedProblems[0].description, '7b. Full description is shielded in similarity matches');
      assert(!prof2Sim.body.matchedProblems[0].testCases, '7c. Hidden test cases are strictly shielded');
    }

    // ----------------------------------------------------
    // 8. Hidden Test & Oracle Privacy Guarantees
    // ----------------------------------------------------
    console.log('\n--- 8. Hidden Test & Oracle Privacy Guarantees ---');
    const qualCheck = await request('GET', `/api/problems/${goodProbId}/quality`, null, prof1Token);
    const jsonStr = JSON.stringify(qualCheck.body);
    assert(!jsonStr.includes('-10 9 20 15 7'), '8a. Hidden test input data NOT leaked in quality response');
    assert(!jsonStr.includes('42\n'), '8b. Hidden test expected output NOT leaked in quality response');
    assert(!jsonStr.includes('generator_secret'), '8c. Generator secrets NOT leaked in quality response');

    // ----------------------------------------------------
    // 9. Problem Review Pipeline Analytics & Rates
    // ----------------------------------------------------
    console.log('\n--- 9. Problem Review Pipeline Analytics & Rates ---');
    // Submit good problem for review
    await request('POST', `/api/problems/${goodProbId}/review-request`, { comment: 'Ready for full evaluation' }, prof1Token);
    // Reviewer starts review
    await request('POST', `/api/problems/${goodProbId}/review/start`, null, prof2Token);
    // Reviewer requests changes
    await request('POST', `/api/problems/${goodProbId}/review/request-changes`, { note: 'Please add 1 more edge case' }, prof2Token);
    // Author resubmits
    await request('POST', `/api/problems/${goodProbId}/review/resubmit`, { comment: 'Added extra test case' }, prof1Token);
    // Reviewer approves
    await request('POST', `/api/problems/${goodProbId}/review/approve`, { note: 'Approved for publication' }, prof2Token);

    // Fetch Review Analytics for problem
    const pAnalyticsRes = await request('GET', `/api/problems/${goodProbId}/review-analytics`, null, prof1Token);
    assert(pAnalyticsRes.status === 200, '9a. Problem review analytics returned 200 OK');
    const pa = pAnalyticsRes.body.analytics;
    assert(pa.totalReviews >= 2, '9b. Total reviews count tracks all attempts');
    assert(pa.statusCounts.approved >= 1, '9c. Status counts track approved reviews');
    assert(pa.statusCounts.revoked >= 1 || pa.statusCounts.changes_requested >= 1, '9d. Status counts track review history');
    assert(typeof pa.rates.approvalRate === 'number', '9e. Approval rate calculated');
    assert(typeof pa.timing.avgDurationHours === 'number', '9f. Average duration calculated');

    // ----------------------------------------------------
    // 10. Review SLA / Aging Calculations
    // ----------------------------------------------------
    console.log('\n--- 10. Review SLA / Aging Calculations ---');
    assert(pa.backlog.slaDistribution !== undefined, '10a. SLA distribution present in backlog');
    assert(typeof pa.backlog.slaDistribution.ON_TIME === 'number', '10b. ON_TIME count present');
    assert(typeof pa.backlog.slaDistribution.AT_RISK === 'number', '10c. AT_RISK count present');
    assert(typeof pa.backlog.slaDistribution.OVERDUE === 'number', '10d. OVERDUE count present');

    // ----------------------------------------------------
    // 11. Platform-Wide Review Analytics (Super Admin)
    // ----------------------------------------------------
    console.log('\n--- 11. Platform-Wide Review Analytics (Super Admin) ---');
    const adminRevRes = await request('GET', '/api/admin/problem-review-analytics', null, superAdminToken);
    assert(adminRevRes.status === 200, '11a. Super Admin retrieves platform review analytics (200 OK)');
    assert(adminRevRes.body.analytics.totalReviews >= 2, '11b. Platform analytics aggregates total reviews');

    const adminReviewerRes = await request('GET', '/api/admin/reviewer-analytics', null, superAdminToken);
    assert(adminReviewerRes.status === 200, '11c. Super Admin retrieves reviewer performance analytics (200 OK)');
    assert(Array.isArray(adminReviewerRes.body.reviewers), '11d. Reviewers list is an array');
    const prof2Metric = adminReviewerRes.body.reviewers.find(r => r.reviewerId === prof2User.id);
    assert(prof2Metric && prof2Metric.completedReviews >= 1, '11e. Reviewer Professor Beta completed reviews tracked');

    // ----------------------------------------------------
    // 12. Version-Bound Quality Snapshot Persistence & Immutability
    // ----------------------------------------------------
    console.log('\n--- 12. Version-Bound Quality Snapshot Persistence & Immutability ---');
    // Fetch snapshot for Version 1 from database
    const v1Snapshot = await ProblemQualityModel.findByProblemAndVersion(goodProbId, 1);
    assert(v1Snapshot !== null, '12a. Quality snapshot persisted in PostgreSQL for version 1');
    assert(v1Snapshot.qualityScore >= 80, '12b. Persisted snapshot records correct quality score');
    assert(v1Snapshot.qualityLevel === 'EXCELLENT' || v1Snapshot.qualityLevel === 'GOOD', '12c. Persisted snapshot records quality level');

    // Author mutates problem draft to Version 2
    await request('PUT', `/api/problems/${goodProbId}`, {
      title: `Optimal Binary Search Tree Path Sum Updated ${suffix}`,
      description: 'Modified statement for second semester version.',
    }, prof1Token);

    // Evaluate Quality for Version 2
    const v2QualRes = await request('GET', `/api/problems/${goodProbId}/quality`, null, prof1Token);
    assert(v2QualRes.status === 200, '12d. Version 2 quality evaluated (200 OK)');
    assert(v2QualRes.body.version === 2, '12e. Evaluated version is 2');

    // Verify historical version 1 snapshot remains intact and immutable
    const v1AfterUpdate = await ProblemQualityModel.findByProblemAndVersion(goodProbId, 1);
    assert(v1AfterUpdate.problemVersion === 1, '12f. Version 1 snapshot intact in database');

    const v2Snapshot = await ProblemQualityModel.findByProblemAndVersion(goodProbId, 2);
    assert(v2Snapshot.problemVersion === 2, '12g. Version 2 snapshot created independently');

    // ----------------------------------------------------
    // 13. Stale Approval & Publication Bypass Prevention
    // ----------------------------------------------------
    console.log('\n--- 13. Stale Approval & Publication Bypass Prevention ---');
    // Version 2 was edited after Version 1 approval -> reviewStatus reset to draft
    const failPub = await request('POST', `/api/problems/${goodProbId}/publish`, null, prof1Token);
    assert(failPub.status === 422, '13a. Mutated problem with invalidated approval cannot be published (422)');

    // Submit and approve Version 2
    await request('POST', `/api/problems/${goodProbId}/review-request`, { comment: 'Review v2' }, prof1Token);
    await request('POST', `/api/problems/${goodProbId}/review/approve`, { note: 'Approved v2' }, prof2Token);

    // Publish Version 2
    const pubRes = await request('POST', `/api/problems/${goodProbId}/publish`, null, prof1Token);
    assert(pubRes.status === 200, '13b. Approved Version 2 problem published successfully (200 OK)');

    // ----------------------------------------------------
    // 14. BOLA / IDOR & Malformed ID Defense
    // ----------------------------------------------------
    console.log('\n--- 14. BOLA / IDOR & Malformed ID Defense ---');
    const badIdQual = await request('GET', '/api/problems/invalid-id/quality', null, prof1Token);
    assert(badIdQual.status === 400, '14a. Non-numeric problem ID returns 400 Bad Request');

    const nonExistentQual = await request('GET', '/api/problems/99999999/quality', null, prof1Token);
    assert(nonExistentQual.status === 404, '14b. Nonexistent problem ID returns 404 Not Found');

    const badIdChk = await request('GET', '/api/problems/invalid-id/editorial-checklist', null, prof1Token);
    assert(badIdChk.status === 400, '14c. Malformed checklist ID returns 400 Bad Request');

    const nonExistentChk = await request('GET', '/api/problems/99999999/editorial-checklist', null, prof1Token);
    assert(nonExistentChk.status === 404, '14d. Nonexistent checklist ID returns 404 Not Found');

    // ----------------------------------------------------
    // 15. Mass Assignment Defense
    // ----------------------------------------------------
    console.log('\n--- 15. Mass Assignment Defense ---');
    const massProbRes = await request('POST', '/api/problems', {
      title: `Mass Assignment Quality Guard ${suffix}`,
      description: 'Testing mass assignment protection in problem authoring.',
      difficulty: 'easy',
      codingMode: 'full_program',
      qualityScore: 100,
      qualityLevel: 'EXCELLENT',
      isPublished: true,
      reviewStatus: 'approved',
    }, prof1Token);

    assert(massProbRes.status === 201, '15a. Problem created safely');
    assert(massProbRes.body.problem.isPublished === false, '15b. Injected isPublished=true ignored');
    assert(massProbRes.body.problem.reviewStatus === 'draft', '15c. Injected reviewStatus=approved ignored');

    const massProbId = massProbRes.body.problem.id;
    await request('DELETE', `/api/problems/${massProbId}`, null, prof1Token);

    // ----------------------------------------------------
    // 16. SQL Injection Resilience
    // ----------------------------------------------------
    console.log('\n--- 16. SQL Injection Resilience ---');
    const sqliPayloads = [
      "'; DROP TABLE problem_quality_snapshots; --",
      "' OR 1=1 --",
      "' UNION SELECT null, null, null, null, null, null --",
    ];

    for (const sqli of sqliPayloads) {
      const sqliQual = await request('GET', `/api/problems/${encodeURIComponent(sqli)}/quality`, null, superAdminToken);
      assert(sqliQual.status === 400, `16a. SQL injection in problem ID safely rejected with 400 (${sqli.substring(0, 15)}...)`);
    }

    // Verify problem_quality_snapshots table is intact
    const tableCheck = await db.query(`SELECT COUNT(*)::int AS count FROM problem_quality_snapshots;`);
    assert(tableCheck.rows[0].count >= 0, '16b. Database relations intact after SQL injection attempts');

    // ----------------------------------------------------
    // 17. Transaction Atomicity & Rollback Safety
    // ----------------------------------------------------
    console.log('\n--- 17. Transaction Atomicity & Rollback Safety ---');
    const client = await db.getClient();
    let txSnapshotId = null;
    try {
      await client.query('BEGIN');
      const snap = await ProblemQualityModel.saveQualitySnapshot({
        problemId: goodProbId,
        problemVersion: 999,
        qualityScore: 95,
        qualityLevel: 'EXCELLENT',
        breakdown: { test: true },
        checklist: [],
      }, client);
      txSnapshotId = snap.id;
      // Intentionally rollback
      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const checkPhantom = await db.query(`SELECT * FROM problem_quality_snapshots WHERE problem_id = $1 AND problem_version = 999;`, [goodProbId]);
    assert(checkPhantom.rows.length === 0, '17a. Snapshot record rolled back on transaction abort (0 phantom records)');

    // ----------------------------------------------------
    // 18. Audit Logging Verification
    // ----------------------------------------------------
    console.log('\n--- 18. Audit Logging Verification ---');
    const qualAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_QUALITY_EVALUATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [goodProbId]
    );
    assert(qualAudit.rows.length === 1, '18a. PROBLEM_QUALITY_EVALUATED audit log persisted in PostgreSQL');

    const chkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'EDITORIAL_CHECKLIST_EVALUATED' AND resource_id = $1 ORDER BY id DESC LIMIT 1;`,
      [goodProbId]
    );
    assert(chkAudit.rows.length === 1, '18b. EDITORIAL_CHECKLIST_EVALUATED audit log persisted in PostgreSQL');

    const simAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_SIMILARITY_CHECKED' ORDER BY id DESC LIMIT 1;`
    );
    assert(simAudit.rows.length === 1, '18c. PROBLEM_SIMILARITY_CHECKED audit log persisted in PostgreSQL');

    // ----------------------------------------------------
    // 19. Teardown & Ephemeral Fixture Hygiene
    // ----------------------------------------------------
    console.log('\n--- 19. Cleaning Up Ephemeral Test Fixtures ---');
    await db.query(`DELETE FROM problem_quality_snapshots WHERE problem_id IN ($1, $2);`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM problem_review_comments WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id IN ($1, $2));`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM problem_reviews WHERE problem_id IN ($1, $2);`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM problem_versions WHERE problem_id IN ($1, $2);`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM test_cases WHERE problem_id IN ($1, $2);`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM problems WHERE id IN ($1, $2);`, [goodProbId, prof2ProbId]);
    await db.query(`DELETE FROM audit_logs WHERE actor_id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4);`, [studentUser.id, prof1User.id, prof2User.id, superAdminUser.id]);
    console.log('[CLEANUP] Ephemeral test fixtures purged.');

    // ----------------------------------------------------
    // Summary
    // ----------------------------------------------------
    console.log('\n========================================================================');
    console.log(` PHASE 5.9.7 TEST SUMMARY: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
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
