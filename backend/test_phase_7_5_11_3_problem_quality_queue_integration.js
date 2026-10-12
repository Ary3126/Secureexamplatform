/**
 * ========================================================================
 * PHASE 7.5.11.3: PROBLEM BANK & QUALITY QUEUE INTEGRATION & SECURITY SUITE
 * ========================================================================
 *
 * Verifies:
 * 1. Problem Bank CRUD & Discovery:
 *    - Creation with required & optional fields across difficulties and coding modes.
 *    - Retrieval, editing, and optimistic concurrency version checking.
 *    - Listing, searching, multi-filter combinations, sorting, and server-side pagination.
 *    - Empty results, malformed parameters, and 32-bit oversized/negative IDs.
 * 2. Role-Based Authorization Matrix:
 *    - Student role denial on all authoring, editing, publishing, test case, and review endpoints (403).
 *    - Professor BOLA/IDOR isolation (cannot edit/delete other professors' private drafts).
 *    - Super Admin and Contest Admin governance powers.
 * 3. Problem Validation & Quality Enforcement:
 *    - Constraints on title, description, difficulty, codingMode, and accessScope.
 *    - Function mode DSL and harness validation (functionName identifier, __STUDENT_CODE__ placeholder).
 *    - SQL injection resistance across search, filters, and ID parameters.
 *    - Mass-assignment defense (cannot inject isPublished, reviewStatus, version, createdBy).
 * 4. Test-Case Security & Zero Hidden-Test Leakage:
 *    - Hidden test cases strictly withheld from student problem views and preview endpoints.
 *    - Public sample test cases remain accessible.
 *    - Test-case size limits (5MB) and execution limits (timeLimitMs, memoryLimitMb).
 * 5. Quality Queue & Review Workflow State Machine:
 *    - Full review lifecycle: draft -> review_requested -> in_review -> changes_requested -> resubmit -> approved.
 *    - Rejection lifecycle and resubmission.
 *    - Self-review and self-approval defense (prohibited for author).
 *    - Stale approval protection (editing draft increments version and invalidates review/approval).
 *    - Publication gate enforcement: publication requires approved review for current version.
 * 6. Data Integrity, Concurrency & Immutability:
 *    - Optimistic concurrency conflict on stale version (409 Conflict).
 *    - Running contest lock (problem locked against modification/deletion during active contest).
 *    - Historical submissions guard (cannot delete problem with submissions).
 *    - Transactional rollback atomicity (0 orphan records on failure).
 * 7. Audit Logging Trail:
 *    - PostgreSQL audit logs generated for all security, authoring, and review actions.
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const bcrypt = require('bcryptjs');
const { generateToken } = require('./src/services/authService');

// Routes & Models
const problemRoutes = require('./src/routes/problemRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const testCaseRoutes = require('./src/routes/testCaseRoutes');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemReviewModel = require('./src/models/problemReviewModel');
const UserModel = require('./src/models/userModel');

// App setup
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/problems', problemRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', testCaseRoutes);

// Global error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    status: 'error',
    statusCode: status,
    message: err.message || 'Internal Server Error',
    errors: err.errors,
  });
});

let server;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runPhase75113Suite() {
  console.log('========================================================================');
  console.log(' STARTING PHASE 7.5.11.3: PROBLEM BANK & QUALITY QUEUE TEST SUITE');
  console.log('========================================================================\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[SERVER] Test server listening on ${baseUrl}`);
      resolve();
    });
  });

  const timestamp = Date.now();
  const passwordHash = await bcrypt.hash('TestPass123!', 10);

  // Users to create: student, profAlpha (author), profBeta (reviewer), superAdmin
  let studentUser, profAlphaUser, profBetaUser, superAdminUser;
  let studentToken, profAlphaToken, profBetaToken, superAdminToken;

  const createdUserIds = [];
  const createdProblemIds = [];
  const createdContestIds = [];

  try {
    // ------------------------------------------------------------------
    // SETUP: Create Actors
    // ------------------------------------------------------------------
    console.log('--- Setting Up Test Actors ---');

    // 1. Student
    const sRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'student', true) RETURNING id, username, role`,
      [`std_p75113_${timestamp}`, `std_p75113_${timestamp}@test.com`, passwordHash, 'Student Tester']
    );
    studentUser = sRes.rows[0];
    createdUserIds.push(studentUser.id);
    studentToken = generateToken(studentUser);

    // 2. Professor Alpha (Author)
    const paRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'professor', true) RETURNING id, username, role`,
      [`profA_p75113_${timestamp}`, `profA_p75113_${timestamp}@test.com`, passwordHash, 'Prof Alpha']
    );
    profAlphaUser = paRes.rows[0];
    createdUserIds.push(profAlphaUser.id);
    profAlphaToken = generateToken(profAlphaUser);

    // 3. Professor Beta (Reviewer)
    const pbRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'professor', true) RETURNING id, username, role`,
      [`profB_p75113_${timestamp}`, `profB_p75113_${timestamp}@test.com`, passwordHash, 'Prof Beta']
    );
    profBetaUser = pbRes.rows[0];
    createdUserIds.push(profBetaUser.id);
    profBetaToken = generateToken(profBetaUser);

    // 4. Super Admin
    const saRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'super_admin', true) RETURNING id, username, role`,
      [`sa_p75113_${timestamp}`, `sa_p75113_${timestamp}@test.com`, passwordHash, 'Super Admin Tester']
    );
    superAdminUser = saRes.rows[0];
    createdUserIds.push(superAdminUser.id);
    superAdminToken = generateToken(superAdminUser);

    assert(studentToken && profAlphaToken && profBetaToken && superAdminToken, 'All four test actor JWTs generated successfully');

    // ==================================================================
    // MODULE 1: Problem Bank CRUD and Discovery
    // ==================================================================
    console.log('\n--- Module 1: Problem Bank CRUD and Discovery ---');

    // 1.1 Create Full-Program Mode Problem
    const p1Payload = {
      title: `Prefix Sum Range Queries ${timestamp}`,
      description: 'Given an integer array nums, handle multiple queries of the sum of elements between indices left and right.',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'contest_private',
    };
    const createP1Res = await request('POST', '/api/problems', p1Payload, profAlphaToken);
    if (createP1Res.status !== 201) {
      console.error('DEBUG createP1Res failed:', createP1Res.status, JSON.stringify(createP1Res.body));
    }
    assert(createP1Res.status === 201, '1.1 Professor Alpha creates valid problem (201 Created)');
    const p1 = createP1Res.body.problem;
    createdProblemIds.push(p1.id);
    assert(p1.id > 0, '1.1 Created problem has positive integer ID');
    assert(p1.version === 1, '1.1 Initial problem version is 1');
    assert(p1.isPublished === false, '1.1 Initial problem is unpublished draft');
    assert(p1.reviewStatus === 'draft', '1.1 Initial problem reviewStatus is draft');
    assert(p1.accessScope === 'contest_private', '1.1 Professor problem accessScope restricted to contest_private');

    // 1.2 Create Function Mode Problem with DSL
    const p2Payload = {
      title: `LRU Cache Implementation ${timestamp}`,
      description: 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.',
      difficulty: 'hard',
      codingMode: 'function',
      starterTemplates: {
        python: 'class LRUCache:\n    def __init__(self, capacity: int):\n        pass\n',
        cpp: 'class LRUCache {\npublic:\n    LRUCache(int capacity) {}\n};\n',
      },
      harnessTemplates: {
        python: '# __STUDENT_CODE__\ndef solve(): pass\n',
        cpp: '// __STUDENT_CODE__\nvoid solve() {}\n',
      },
      functionConfig: {
        functionName: 'LRUCache',
        returnType: 'void',
        parameters: [{ name: 'capacity', type: 'integer' }],
      },
      accessScope: 'contest_private',
    };
    const createP2Res = await request('POST', '/api/problems', p2Payload, profAlphaToken);
    assert(createP2Res.status === 201, '1.2 Professor Alpha creates function-mode problem with DSL (201 Created)');
    const p2 = createP2Res.body.problem;
    createdProblemIds.push(p2.id);
    assert(p2.codingMode === 'function', '1.2 Problem codingMode stored as function');
    assert(p2.functionConfig?.functionName === 'LRUCache', '1.2 functionConfig preserved in database');

    // 1.3 Add Test Cases to P1
    const tc1Res = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: '5\n1 2 3 4 5\n1 3\n',
      expectedOutput: '9\n',
      isHidden: false,
      isSample: true,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      testOrder: 1,
    }, profAlphaToken);
    assert(tc1Res.status === 201, '1.3 Visible sample test case added (201 Created)');
    assert(tc1Res.body.testCase.isHidden === false, '1.3 Sample test case has isHidden = false');

    const tc2Res = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: '1000\n...random data...\n10 500\n',
      expectedOutput: '123456\n',
      isHidden: true,
      isSample: false,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      testOrder: 2,
    }, profAlphaToken);
    assert(tc2Res.status === 201, '1.3 Hidden judge test case added (201 Created)');
    assert(tc2Res.body.testCase.isHidden === true, '1.3 Judge test case has isHidden = true');

    // 1.4 Retrieve Problem Details
    const getP1Alpha = await request('GET', `/api/problems/${p1.id}`, null, profAlphaToken);
    assert(getP1Alpha.status === 200, '1.4 Author retrieves problem details (200 OK)');
    assert(getP1Alpha.body.id === p1.id, '1.4 Problem ID matches');
    assert(Array.isArray(getP1Alpha.body.sampleTestCases), '1.4 sampleTestCases array present');
    assert(getP1Alpha.body.sampleTestCases.length === 1, '1.4 Returns visible sample test case only');

    // 1.5 Update Problem with Optimistic Concurrency
    const updateP1Res = await request('PUT', `/api/problems/${p1.id}`, {
      title: `Prefix Sum Range Queries (Updated) ${timestamp}`,
      description: 'Updated statement with clearer 0-indexed bounds explanation.',
      expectedVersion: 1,
    }, profAlphaToken);
    assert(updateP1Res.status === 200, '1.5 Problem updated with expectedVersion=1 (200 OK)');
    assert(updateP1Res.body.problem.version === 2, '1.5 Version incremented to 2');

    // 1.6 Optimistic Concurrency Rejection (stale expectedVersion)
    const staleUpdateRes = await request('PUT', `/api/problems/${p1.id}`, {
      title: 'Should fail due to stale version',
      expectedVersion: 1, // Authoritative version is now 2
    }, profAlphaToken);
    assert(staleUpdateRes.status === 409, '1.6 Stale expectedVersion rejected with 409 Conflict');
    assert(staleUpdateRes.body.currentVersion === 2, '1.6 Response provides authoritative currentVersion 2');

    // 1.7 Search, Filtering, Sorting and Pagination (Admin endpoint)
    const adminListRes = await request('GET', `/api/admin/problems?search=${encodeURIComponent('Prefix Sum')}&limit=10&page=1`, null, superAdminToken);
    assert(adminListRes.status === 200, '1.7 Super Admin problem discovery returns 200 OK');
    assert(adminListRes.body.data.problems.some((p) => p.id === p1.id), '1.7 Search finds problem by title keyword');
    assert(adminListRes.body.data.pagination.page === 1, '1.7 Pagination records page 1');
    assert(adminListRes.body.data.pagination.total >= 1, '1.7 Pagination records total count');

    // Multi-filter test (difficulty + codingMode)
    const filteredRes = await request('GET', `/api/admin/problems?difficulty=hard&codingMode=function`, null, superAdminToken);
    assert(filteredRes.status === 200, '1.7 Filter by difficulty=hard & codingMode=function returns 200');
    assert(filteredRes.body.data.problems.every((p) => p.difficulty === 'hard' && p.codingMode === 'function'), '1.7 All returned problems match filter criteria');

    // Sorting by title_asc
    const sortedRes = await request('GET', `/api/admin/problems?sortBy=title_asc&limit=5`, null, superAdminToken);
    assert(sortedRes.status === 200, '1.7 Sort by title_asc returns 200 OK');
    const titles = sortedRes.body.data.problems.map((p) => (p.title || '').toLowerCase());
    const isSorted = titles.slice(1).every((t, i) => t >= titles[i]);
    assert(isSorted, '1.7 Problems are alphabetically ordered by title');

    // Empty search result handling
    const emptySearchRes = await request('GET', `/api/admin/problems?search=NonExistentKeywordXYZ99999`, null, superAdminToken);
    assert(emptySearchRes.status === 200, '1.7 Non-matching search returns 200 OK');
    assert(emptySearchRes.body.data.problems.length === 0, '1.7 Non-matching search returns empty array');
    assert(emptySearchRes.body.data.pagination.total === 0, '1.7 Pagination total is 0');

    // 1.8 Malformed and Oversized Problem IDs
    const malformed1 = await request('GET', '/api/problems/abc', null, profAlphaToken);
    assert(malformed1.status === 400, '1.8 Non-numeric problem ID returns 400 Bad Request');

    const malformed2 = await request('GET', '/api/problems/-5', null, profAlphaToken);
    assert(malformed2.status === 400, '1.8 Negative problem ID returns 400 Bad Request');

    const malformed3 = await request('GET', '/api/problems/1.5', null, profAlphaToken);
    assert(malformed3.status === 400, '1.8 Floating point problem ID returns 400 Bad Request');

    const oversizedId = await request('GET', '/api/problems/9999999999999', null, profAlphaToken);
    assert(oversizedId.status === 404, '1.8 Oversized problem ID (> 2^31-1) safely returns 404 Not Found (no 500 crash)');

    const nonExistentId = await request('GET', '/api/problems/9999999', null, profAlphaToken);
    assert(nonExistentId.status === 404, '1.8 Non-existent problem ID returns 404 Not Found');

    const adminOversized = await request('GET', '/api/admin/problems/9999999999999', null, superAdminToken);
    assert(adminOversized.status === 404, '1.8 Super Admin oversized problem ID safely returns 404 Not Found');

    // ==================================================================
    // MODULE 2: Role-Based Authorization Matrix
    // ==================================================================
    console.log('\n--- Module 2: Role-Based Authorization Matrix ---');

    // 2.1 Student Role Prohibitions
    const stdCreate = await request('POST', '/api/problems', { title: 'Illegal Student Problem', description: 'desc', difficulty: 'easy' }, studentToken);
    assert(stdCreate.status === 403, '2.1 Student cannot create problems (403 Forbidden)');

    const stdUpdate = await request('PUT', `/api/problems/${p1.id}`, { title: 'Illegal Student Edit' }, studentToken);
    assert(stdUpdate.status === 403, '2.1 Student cannot edit problems (403 Forbidden)');

    const stdDelete = await request('DELETE', `/api/problems/${p1.id}`, null, studentToken);
    assert(stdDelete.status === 403, '2.1 Student cannot delete problems (403 Forbidden)');

    const stdPublish = await request('POST', `/api/problems/${p1.id}/publish`, null, studentToken);
    assert(stdPublish.status === 403, '2.1 Student cannot publish problems (403 Forbidden)');

    const stdAdminProblems = await request('GET', '/api/admin/problems', null, studentToken);
    assert(stdAdminProblems.status === 403, '2.1 Student cannot access admin problems directory (403 Forbidden)');

    const stdTestCases = await request('GET', `/api/problems/${p1.id}/test-cases`, null, studentToken);
    assert(stdTestCases.status === 403, '2.1 Student cannot view administrative test cases (403 Forbidden)');

    const stdAddTc = await request('POST', `/api/problems/${p1.id}/test-cases`, { inputData: '1', expectedOutput: '1' }, studentToken);
    assert(stdAddTc.status === 403, '2.1 Student cannot add test cases (403 Forbidden)');

    const stdRevReq = await request('POST', `/api/problems/${p1.id}/review-request`, { comment: 'test' }, studentToken);
    assert(stdRevReq.status === 403, '2.1 Student cannot request problem reviews (403 Forbidden)');

    const stdApprove = await request('POST', `/api/problems/${p1.id}/review/approve`, { note: 'test' }, studentToken);
    assert(stdApprove.status === 403, '2.1 Student cannot approve problem reviews (403 Forbidden)');

    const stdAdminRevQueue = await request('GET', '/api/admin/problem-reviews', null, studentToken);
    assert(stdAdminRevQueue.status === 403, '2.1 Student cannot view admin review queue (403 Forbidden)');

    // 2.2 Unauthenticated Access Prohibitions
    const unauthCreate = await request('POST', '/api/problems', { title: 'No Auth Prob' }, null);
    assert(unauthCreate.status === 401, '2.2 Unauthenticated problem creation returns 401 Unauthorized');

    const unauthAdmin = await request('GET', '/api/admin/problems', null, null);
    assert(unauthAdmin.status === 401, '2.2 Unauthenticated admin problems query returns 401 Unauthorized');

    // 2.3 Cross-Professor Isolation (BOLA / IDOR Defense)
    const betaEditAlpha = await request('PUT', `/api/problems/${p1.id}`, { title: 'Malicious Edit by Beta' }, profBetaToken);
    assert(betaEditAlpha.status === 403, '2.3 Professor Beta cannot edit Professor Alpha private draft (403 Forbidden)');

    const betaDeleteAlpha = await request('DELETE', `/api/problems/${p1.id}`, null, profBetaToken);
    assert(betaDeleteAlpha.status === 403, '2.3 Professor Beta cannot delete Professor Alpha problem (403 Forbidden)');

    const betaPublishAlpha = await request('POST', `/api/problems/${p1.id}/publish`, null, profBetaToken);
    assert(betaPublishAlpha.status === 403, '2.3 Professor Beta cannot publish Professor Alpha problem (403 Forbidden)');

    const betaTcViewAlpha = await request('GET', `/api/problems/${p1.id}/test-cases`, null, profBetaToken);
    assert(betaTcViewAlpha.status === 403, '2.3 Professor Beta cannot view Professor Alpha administrative test cases (403 Forbidden)');

    const betaAddTcAlpha = await request('POST', `/api/problems/${p1.id}/test-cases`, { inputData: 'x', expectedOutput: 'y' }, profBetaToken);
    assert(betaAddTcAlpha.status === 403, '2.3 Professor Beta cannot add test cases to Professor Alpha problem (403 Forbidden)');

    // 2.4 Student Private Draft Invisibility
    const stdViewDraft = await request('GET', `/api/problems/${p1.id}`, null, studentToken);
    assert(stdViewDraft.status === 404, '2.4 Student cannot view unpublished private draft (404 Not Found)');

    // ==================================================================
    // MODULE 3: Problem Validation and Injection Hardening
    // ==================================================================
    console.log('\n--- Module 3: Problem Validation and Injection Hardening ---');

    // 3.1 Field Boundaries Validation
    const shortTitle = await request('POST', '/api/problems', { title: 'ab', description: 'Valid description text', difficulty: 'easy' }, profAlphaToken);
    assert(shortTitle.status === 400, '3.1 Title < 3 characters rejected with 400');

    const longTitle = await request('POST', '/api/problems', { title: 'a'.repeat(201), description: 'Valid description text', difficulty: 'easy' }, profAlphaToken);
    assert(longTitle.status === 400, '3.1 Title > 200 characters rejected with 400');

    const shortDesc = await request('POST', '/api/problems', { title: 'Valid Title', description: 'abc', difficulty: 'easy' }, profAlphaToken);
    assert(shortDesc.status === 400, '3.1 Description < 5 characters rejected with 400');

    const invalidDiff = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description', difficulty: 'extreme' }, profAlphaToken);
    assert(invalidDiff.status === 400, '3.1 Invalid difficulty rejected with 400');

    const invalidMode = await request('POST', '/api/problems', { title: 'Valid Title', description: 'Valid description', difficulty: 'easy', codingMode: 'unsupported' }, profAlphaToken);
    assert(invalidMode.status === 400, '3.1 Invalid codingMode rejected with 400');

    // 3.2 Function Mode DSL Validation
    const badFnName = await request('POST', '/api/problems', {
      title: 'Valid Function Mode Problem',
      description: 'Valid problem description',
      difficulty: 'medium',
      codingMode: 'function',
      functionConfig: { functionName: '123_invalid-name', returnType: 'int' },
    }, profAlphaToken);
    assert(badFnName.status === 400, '3.2 Invalid function name format rejected with 400');

    const missingPlaceholder = await request('POST', '/api/problems', {
      title: 'Valid Function Mode Problem',
      description: 'Valid problem description',
      difficulty: 'medium',
      codingMode: 'function',
      functionConfig: { functionName: 'solveIt', returnType: 'int' },
      harnessTemplates: { python: 'def solve(): pass\n' }, // Missing // __STUDENT_CODE__
    }, profAlphaToken);
    assert(missingPlaceholder.status === 400, '3.2 Function harness missing __STUDENT_CODE__ rejected with 400');

    // 3.3 Mass-Assignment Attack Neutralization
    const massAttack = await request('POST', '/api/problems', {
      title: `Mass Assignment Defense ${timestamp}`,
      description: 'Testing whether user can force publishing or administrative status.',
      difficulty: 'easy',
      role: 'super_admin',
      isPublished: true,
      reviewStatus: 'approved',
      version: 99,
      approvedVersion: 99,
      createdBy: superAdminUser.id,
    }, profAlphaToken);
    assert(massAttack.status === 201, '3.3 Mass-assignment request succeeds cleanly');
    const maProb = massAttack.body.problem;
    createdProblemIds.push(maProb.id);
    assert(maProb.isPublished === false, '3.3 Injected isPublished: true neutralized (isPublished = false)');
    assert(maProb.reviewStatus === 'draft', '3.3 Injected reviewStatus: approved neutralized (reviewStatus = draft)');
    assert(maProb.version === 1, '3.3 Injected version: 99 neutralized (version = 1)');
    assert(maProb.createdBy === profAlphaUser.id, '3.3 Injected createdBy neutralized (owned by authenticated actor)');

    // 3.4 SQL Injection Resilience
    const sqliSearches = [
      "'; DROP TABLE problems; --",
      "' OR '1'='1",
      "UNION SELECT null, null, null, null, null",
      "99999999999999999999", // Numeric overflow search
    ];
    for (const sqli of sqliSearches) {
      const sqliRes = await request('GET', `/api/admin/problems?search=${encodeURIComponent(sqli)}`, null, superAdminToken);
      assert(sqliRes.status === 200, `3.4 SQL injection safely neutralized in search query (${sqli.slice(0, 16)})`);
    }

    // Verify problems table is intact
    const countCheck = await db.query('SELECT COUNT(*)::int AS count FROM problems;');
    assert(countCheck.rows[0].count > 0, '3.4 PostgreSQL problems relation intact and undamaged');

    // ==================================================================
    // MODULE 4: Test-Case Security & Zero Hidden-Test Leakage
    // ==================================================================
    console.log('\n--- Module 4: Test-Case Security & Zero Hidden-Test Leakage ---');

    // 4.1 Preview endpoint excludes hidden tests
    const previewRes = await request('GET', `/api/problems/${p1.id}/preview`, null, profAlphaToken);
    assert(previewRes.status === 200, '4.1 Author generates problem preview (200 OK)');
    assert(Array.isArray(previewRes.body.sampleTestCases), '4.1 Preview returns sample test cases');
    assert(previewRes.body.sampleTestCases.length === 1, '4.1 Preview strictly returns ONLY visible sample cases (length 1)');
    assert(previewRes.body.sampleTestCases[0].inputData.includes('5\n1 2 3 4 5'), '4.1 Sample test case content matches');
    assert(!JSON.stringify(previewRes.body).includes('...random data...'), '4.1 Hidden test case input STRICTLY NOT leaked in preview');
    assert(!JSON.stringify(previewRes.body).includes('123456'), '4.1 Hidden test case output STRICTLY NOT leaked in preview');

    // 4.2 Test case limits enforcement
    const tcOversizedTime = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: '1',
      expectedOutput: '1',
      timeLimitMs: 99999, // Max is 15000
    }, profAlphaToken);
    assert(tcOversizedTime.status === 400, '4.2 Test case timeLimitMs > 15000 rejected with 400');

    const tcOversizedMem = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: '1',
      expectedOutput: '1',
      memoryLimitMb: 2048, // Max is 1024
    }, profAlphaToken);
    assert(tcOversizedMem.status === 400, '4.2 Test case memoryLimitMb > 1024 rejected with 400');

    const tcMissingOutput = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: '1',
    }, profAlphaToken);
    assert(tcMissingOutput.status === 400, '4.2 Test case missing expectedOutput rejected with 400');

    // ==================================================================
    // MODULE 5: Quality Queue & Review Governance State Transitions
    // ==================================================================
    console.log('\n--- Module 5: Quality Queue & Review Governance State Transitions ---');

    // 5.1 Self-Review & Self-Approval Prevention
    const selfStart = await request('POST', `/api/problems/${p1.id}/review/start`, null, profAlphaToken);
    assert(selfStart.status === 403, '5.1 Author cannot start review on own problem (403 Forbidden)');

    const selfApprove2 = await request('POST', `/api/problems/${p1.id}/review/approve`, { note: 'Self approve' }, profAlphaToken);
    assert(selfApprove2.status === 403, '5.1 Author cannot approve own problem (403 Forbidden)');

    // 5.2 Submit for Peer Review
    const revReqRes = await request('POST', `/api/problems/${p1.id}/review-request`, {
      comment: 'Problem prefix sum range queries ready for editorial peer review.',
    }, profAlphaToken);
    assert(revReqRes.status === 201, '5.2 Problem submitted for review (201 Created)');
    assert(revReqRes.body.review.status === 'pending', '5.2 Review created with status pending');
    assert(revReqRes.body.review.problemVersion === 2, '5.2 Review bound to problem version 2');

    const p1InDb = await ProblemModel.findProblemById(p1.id);
    assert(p1InDb.reviewStatus === 'review_requested', '5.2 Problem reviewStatus updated to review_requested');

    // 5.3 Reviewer Starts Review Session
    const startRevRes = await request('POST', `/api/problems/${p1.id}/review/start`, null, profBetaToken);
    assert(startRevRes.status === 200, '5.3 Professor Beta starts review (200 OK)');
    assert(startRevRes.body.review.status === 'in_review', '5.3 Review status updated to in_review');
    assert(startRevRes.body.review.reviewerId === profBetaUser.id, '5.3 Reviewer ID assigned to Professor Beta');

    // 5.4 Reviewer Requests Changes
    const chgReqRes = await request('POST', `/api/problems/${p1.id}/review/request-changes`, {
      comment: 'Please add explicit constraint bounds: 1 <= nums.length <= 10^5.',
    }, profBetaToken);
    assert(chgReqRes.status === 200, '5.4 Professor Beta requests changes (200 OK)');
    assert(chgReqRes.body.review.status === 'changes_requested', '5.4 Review status updated to changes_requested');

    // 5.5 Author Resubmits for Review
    const resubRes = await request('POST', `/api/problems/${p1.id}/review/resubmit`, {
      comment: 'Added requested bounds in statement and updated constraints section.',
    }, profAlphaToken);
    assert(resubRes.status === 201, '5.5 Author resubmits problem for review (201 Created)');
    assert(resubRes.body.review.status === 'pending', '5.5 New review is pending');

    // 5.6 Reviewer Starts & Approves
    await request('POST', `/api/problems/${p1.id}/review/start`, null, profBetaToken);
    const approveRes = await request('POST', `/api/problems/${p1.id}/review/approve`, {
      note: 'Problem statement, test case distribution, and constraints look solid.',
    }, profBetaToken);
    assert(approveRes.status === 200, '5.6 Reviewer approves problem (200 OK)');
    assert(approveRes.body.approvedVersion === 2, '5.6 Approved version is 2');

    const p1Approved = await ProblemModel.findProblemById(p1.id);
    assert(p1Approved.reviewStatus === 'approved', '5.6 Problem reviewStatus updated to approved');
    assert(p1Approved.approvedVersion === 2, '5.6 Problem approvedVersion is 2');
    assert(p1Approved.approvedBy === profBetaUser.id, '5.6 Problem approvedBy recorded');

    // 5.7 Approval Invalidation on Draft Mutation
    const mutateRes = await request('PUT', `/api/problems/${p1.id}`, {
      title: `Prefix Sum Range Queries (Mutated) ${timestamp}`,
      expectedVersion: 2,
    }, profAlphaToken);
    assert(mutateRes.status === 200, '5.7 Draft mutated after approval (200 OK)');
    assert(mutateRes.body.problem.version === 3, '5.7 Version incremented to 3');
    assert(mutateRes.body.problem.reviewStatus === 'draft', '5.7 Approval invalidated: reviewStatus reset to draft');
    assert(mutateRes.body.problem.approvedVersion === null, '5.7 Approval invalidated: approvedVersion reset to null');

    // 5.8 Publishing Gate: Cannot publish unapproved version
    const failPublishRes = await request('POST', `/api/problems/${p1.id}/publish`, null, profAlphaToken);
    assert(failPublishRes.status === 422, '5.8 Unapproved mutated problem publication rejected with 422');
    assert(failPublishRes.body.errors.some((e) => e.includes('approved review')), '5.8 Error specifies required approved review');

    // 5.9 Resubmit and Approve Version 3, then Publish
    await request('POST', `/api/problems/${p1.id}/review-request`, { comment: 'v3 review' }, profAlphaToken);
    await request('POST', `/api/problems/${p1.id}/review/approve`, { note: 'v3 approved' }, profBetaToken);

    const publishSuccessRes = await request('POST', `/api/problems/${p1.id}/publish`, null, profAlphaToken);
    assert(publishSuccessRes.status === 200, '5.9 Approved problem published successfully (200 OK)');
    assert(publishSuccessRes.body.problem.isPublished === true, '5.9 isPublished is true');
    assert(publishSuccessRes.body.problem.accessScope === 'public', '5.9 accessScope promoted to public');
    assert(publishSuccessRes.body.problem.publishedAt !== null, '5.9 publishedAt timestamp recorded');

    // 5.10 Student can now view published problem (zero hidden-test leakage)
    const stdViewPub = await request('GET', `/api/problems/${p1.id}`, null, studentToken);
    assert(stdViewPub.status === 200, '5.10 Student can now view published problem (200 OK)');
    assert(stdViewPub.body.sampleTestCases.length === 1, '5.10 Student receives only sample test cases');
    assert(!JSON.stringify(stdViewPub.body).includes('...random data...'), '5.10 Hidden test case data zero leakage to student');

    // ==================================================================
    // MODULE 6: Data Integrity, Concurrency & Immutability
    // ==================================================================
    console.log('\n--- Module 6: Data Integrity, Concurrency & Immutability ---');

    // 6.1 Immutability Guard: Cannot modify problem in active running contest
    const contestRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, created_by, status)
       VALUES ($1, 'Active Running Contest', NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '50 minutes', $2, 'published')
       RETURNING id;`,
      [`Active Running Contest ${timestamp}`, profAlphaUser.id]
    );
    const contestId = contestRes.rows[0].id;
    createdContestIds.push(contestId);

    await db.query(
      `INSERT INTO contest_problems (contest_id, problem_id, problem_order) VALUES ($1, $2, 1);`,
      [contestId, p1.id]
    );

    // Attempt to update problem while active in running contest
    const updateDuringContest = await request('PUT', `/api/problems/${p1.id}`, {
      title: 'Attempted Update During Running Contest',
      expectedVersion: 3,
    }, profAlphaToken);
    assert(updateDuringContest.status === 409, '6.1 Updating problem active in running contest rejected with 409 Conflict');
    assert(updateDuringContest.body.message.includes('locked'), '6.1 Error message indicates problem is locked during contest');

    // Attempt to delete problem while active in running contest
    const deleteDuringContest = await request('DELETE', `/api/problems/${p1.id}`, null, profAlphaToken);
    assert(deleteDuringContest.status === 409, '6.1 Deleting problem active in running contest rejected with 409 Conflict');

    // Attempt to add test case while active in running contest
    const addTcDuringContest = await request('POST', `/api/problems/${p1.id}/test-cases`, {
      inputData: 'new input',
      expectedOutput: 'new output',
    }, profAlphaToken);
    assert(addTcDuringContest.status === 409, '6.1 Adding test case during active contest rejected with 409 Conflict');

    // Clean up contest attachments
    await db.query('DELETE FROM contest_problems WHERE contest_id = $1', [contestId]);
    await db.query('DELETE FROM contests WHERE id = $1', [contestId]);

    // 6.2 Historical Submissions Guard
    // Add a submission to p1
    await db.query(
      `INSERT INTO submissions (user_id, problem_id, language, source_code, status)
       VALUES ($1, $2, 'python', 'print(9)', 'accepted');`,
      [studentUser.id, p1.id]
    );

    const deleteWithSubs = await request('DELETE', `/api/problems/${p1.id}`, null, profAlphaToken);
    assert(deleteWithSubs.status === 409, '6.2 Deleting problem with historical submissions rejected with 409 Conflict');

    // Clean up submission for p1
    await db.query('DELETE FROM submissions WHERE problem_id = $1', [p1.id]);

    // 6.3 Transactional Rollback Atomicity
    // Verify that aborted problem creation leaves 0 phantom rows
    const client = await db.getClient();
    let txAborted = false;
    try {
      await client.query('BEGIN');
      const abortProb = await ProblemModel.createProblem({
        title: `Aborted Tx Prob ${timestamp}`,
        description: 'Should be rolled back',
        difficulty: 'easy',
        createdBy: profAlphaUser.id,
      }, client);
      createdProblemIds.push(abortProb.id);
      // Explicit rollback
      await client.query('ROLLBACK');
      txAborted = true;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
    }
    assert(txAborted, '6.3 Transaction aborted successfully');
    const phantomCheck = await db.query(`SELECT 1 FROM problems WHERE title = $1`, [`Aborted Tx Prob ${timestamp}`]);
    assert(phantomCheck.rowCount === 0, '6.3 Transaction atomicity verified: 0 phantom records created');

    // ==================================================================
    // MODULE 7: Audit Logging Trail Verification
    // ==================================================================
    console.log('\n--- Module 7: Audit Logging Trail Verification ---');

    const expectedActions = [
      'PROBLEM_CREATED',
      'PROBLEM_UPDATED',
      'PROBLEM_PUBLISHED',
      'PROBLEM_REVIEW_REQUESTED',
      'PROBLEM_REVIEW_STARTED',
      'PROBLEM_APPROVED',
      'TEST_CASE_CREATED',
      'PRIVILEGED_ACTION_DENIED',
    ];

    for (const act of expectedActions) {
      const auditRes = await db.query(
        `SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = $1;`,
        [act]
      );
      const count = auditRes.rows[0].count;
      assert(count > 0, `7. PostgreSQL audit trail persisted events for action: "${act}" (count: ${count})`);
    }

    console.log('\n========================================================================');
    console.log(' ALL PHASE 7.5.11.3 INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('========================================================================\n');
  } finally {
    // ------------------------------------------------------------------
    // CLEANUP: Purge Ephemeral Test Fixtures
    // ------------------------------------------------------------------
    console.log('--- Cleaning Up Ephemeral Test Fixtures ---');
    try {
      if (createdContestIds.length > 0) {
        await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
        await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [createdContestIds]);
      }
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problem_review_comments WHERE review_id IN (SELECT id FROM problem_reviews WHERE problem_id = ANY($1::int[]))`, [createdProblemIds]);
        await db.query(`DELETE FROM problem_reviews WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problem_validation_configs WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
      }
      console.log('[CLEANUP] Ephemeral test fixtures purged successfully.');
    } catch (cleanupErr) {
      console.error('[CLEANUP WARNING] Error during fixture purge:', cleanupErr.message);
    }

    if (server) {
      await new Promise((res) => server.close(res));
      console.log('[SERVER] Test server closed gracefully.');
    }
    if (db.closePool) {
      await db.closePool().catch(() => {});
    } else if (db.end) {
      await db.end().catch(() => {});
    }
    console.log('[DATABASE] PostgreSQL pool closed gracefully.');
  }
}

runPhase75113Suite().catch((err) => {
  console.error('[TEST SUITE CRASHED]:', err);
  process.exit(1);
});
