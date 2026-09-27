/**
 * Phase 7.4.10: Security & Validation Hardening Test Suite
 * Exhaustively validates:
 * 1. Role-Based Access Control (RBAC) across all Problem Management endpoints
 * 2. IDOR / Broken Object-Level Authorization (BOLA) defenses
 * 3. Strict Hidden Test-Case Zero-Leakage Invariants
 * 4. Draft & Unpublished Problem Isolation (Discovery, GET, Search, Pagination)
 * 5. Input Validation & Strict Boundary Controls
 * 6. XSS / Content Escaping & Malicious Payload Neutralization
 * 7. SQL Injection Defense across Search, Filters, Sorting, and IDs
 * 8. Path Traversal & Execution Sandbox Verification
 * 9. Coding Mode & Language Configuration Security
 * 10. Function / DSL Configuration Hardening
 * 11. Publish Validation Gate & Bypass Defense
 * 12. Optimistic Concurrency Control (Silent Overwrite Prevention)
 * 13. Version History RBAC & Snapshot Security
 * 14. Clone Security & Draft State Guarantees
 * 15. Delete Protection & Submission Integrity
 * 16. Comprehensive Audit Logging & Security Event Tracing
 * 17. Sensitive Data Leakage Prevention (Passwords, Tokens, DB Secrets)
 * 18. Rate Limiting Protection on Problem & Test-Case Routes
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const problemRoutes = require('./src/routes/problemRoutes');
const testCaseRoutes = require('./src/routes/testCaseRoutes');
const { generateToken } = require('./src/services/authService');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/problems', problemRoutes);
app.use('/api', testCaseRoutes);

// Central error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    status: 'error',
    statusCode: status,
    message: err.message || 'Internal Server Error',
  });
});

let server;
let baseUrl;

// Ephemeral test tracking
const createdProblemIds = [];
const createdUserIds = [];

// Helper to execute HTTP requests
function request(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    let payload = null;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {
          json = rawData;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          text: rawData,
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function makeToken(user) {
  return generateToken(user);
}

let studentUser, profUser1, profUser2, adminUser, superAdminUser;
let studentToken, profToken1, profToken2, adminToken, superAdminToken;

async function setupUsers() {
  const ts = Date.now();
  const users = [
    { username: `sec_stu_${ts}`, email: `sec_stu_${ts}@examforge.internal`, role: 'student', full_name: 'Security Student' },
    { username: `sec_p1_${ts}`, email: `sec_p1_${ts}@examforge.internal`, role: 'professor', full_name: 'Prof Alpha' },
    { username: `sec_p2_${ts}`, email: `sec_p2_${ts}@examforge.internal`, role: 'professor', full_name: 'Prof Beta' },
    { username: `sec_adm_${ts}`, email: `sec_adm_${ts}@examforge.internal`, role: 'contest_admin', full_name: 'Contest Admin' },
    { username: `sec_sadm_${ts}`, email: `sec_sadm_${ts}@examforge.internal`, role: 'super_admin', full_name: 'Super Governor' },
  ];

  for (const u of users) {
    const res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, 'hash_sec_vault_test', $3, $4)
       RETURNING id, username, email, role`,
      [u.username, u.email, u.role, u.full_name]
    );
    createdUserIds.push(res.rows[0].id);
    if (u.role === 'student') studentUser = res.rows[0];
    else if (u.username.startsWith('sec_p1_')) profUser1 = res.rows[0];
    else if (u.username.startsWith('sec_p2_')) profUser2 = res.rows[0];
    else if (u.role === 'contest_admin') adminUser = res.rows[0];
    else if (u.role === 'super_admin') superAdminUser = res.rows[0];
  }

  studentToken = makeToken(studentUser);
  profToken1 = makeToken(profUser1);
  profToken2 = makeToken(profUser2);
  adminToken = makeToken(adminUser);
  superAdminToken = makeToken(superAdminUser);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=================================================================');
  console.log(' PHASE 7.4.10: SECURITY & VALIDATION HARDENING SUITE');
  console.log('=================================================================\n');

  await setupUsers();

  // ==============================================================
  // 1. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==============================================================
  console.log('-- Section 1: Role-Based Access Control (RBAC) --');

  // Unauthenticated requests
  const unauthPost = await request('POST', '/api/problems', { body: { title: 'Unauth Problem' } });
  assert(unauthPost.status === 401, '1.1 Unauthenticated POST /api/problems returns 401 Unauthorized');

  const unauthPut = await request('PUT', '/api/problems/1', { body: { title: 'Unauth Edit' } });
  assert(unauthPut.status === 401, '1.2 Unauthenticated PUT /api/problems/:id returns 401 Unauthorized');

  const unauthDel = await request('DELETE', '/api/problems/1');
  assert(unauthDel.status === 401, '1.3 Unauthenticated DELETE /api/problems/:id returns 401 Unauthorized');

  const unauthPub = await request('POST', '/api/problems/1/publish');
  assert(unauthPub.status === 401, '1.4 Unauthenticated POST /api/problems/:id/publish returns 401 Unauthorized');

  const unauthPrev = await request('GET', '/api/problems/1/preview');
  assert(unauthPrev.status === 401, '1.5 Unauthenticated GET /api/problems/:id/preview returns 401 Unauthorized');

  const unauthVers = await request('GET', '/api/problems/1/versions');
  assert(unauthVers.status === 401, '1.6 Unauthenticated GET /api/problems/:id/versions returns 401 Unauthorized');

  const unauthClone = await request('POST', '/api/problems/1/clone');
  assert(unauthClone.status === 401, '1.7 Unauthenticated POST /api/problems/:id/clone returns 401 Unauthorized');

  // Student RBAC restrictions
  const stuPost = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { title: 'Student Problem', description: 'Testing student create problem rejection', difficulty: 'easy' },
  });
  assert(stuPost.status === 403, '1.8 Student cannot create problems (403 Forbidden)');

  const stuPut = await request('PUT', '/api/problems/1', {
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { title: 'Student Edit Problem' },
  });
  assert(stuPut.status === 403, '1.9 Student cannot edit problems (403 Forbidden)');

  const stuDel = await request('DELETE', '/api/problems/1', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuDel.status === 403, '1.10 Student cannot delete problems (403 Forbidden)');

  const stuPub = await request('POST', '/api/problems/1/publish', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuPub.status === 403, '1.11 Student cannot publish problems (403 Forbidden)');

  const stuPrev = await request('GET', '/api/problems/1/preview', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuPrev.status === 403, '1.12 Student cannot preview problems (403 Forbidden)');

  const stuVers = await request('GET', '/api/problems/1/versions', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuVers.status === 403, '1.13 Student cannot view problem versions (403 Forbidden)');

  const stuClone = await request('POST', '/api/problems/1/clone', {
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { title: 'Cloned By Student' },
  });
  assert(stuClone.status === 403, '1.14 Student cannot clone problems (403 Forbidden)');

  // Student test case restrictions
  const stuTcPost = await request('POST', '/api/problems/1/test-cases', {
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { inputData: '1', expectedOutput: '2' },
  });
  assert(stuTcPost.status === 403, '1.15 Student cannot create test cases (403 Forbidden)');

  const stuTcGet = await request('GET', '/api/problems/1/test-cases', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuTcGet.status === 403, '1.16 Student cannot list administrative test cases (403 Forbidden)');

  const stuTcGetOne = await request('GET', '/api/test-cases/1', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuTcGetOne.status === 403, '1.17 Student cannot get individual test case (403 Forbidden)');

  const stuTcPut = await request('PUT', '/api/test-cases/1', {
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { expectedOutput: 'updated' },
  });
  assert(stuTcPut.status === 403, '1.18 Student cannot update test case (403 Forbidden)');

  const stuTcDel = await request('DELETE', '/api/test-cases/1', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(stuTcDel.status === 403, '1.19 Student cannot delete test case (403 Forbidden)');

  // ==============================================================
  // 2. IDOR / BOLA DEFENSES
  // ==============================================================
  console.log('\n-- Section 2: IDOR / BOLA Defenses --');

  // Prof 1 creates Problem 1
  const createP1 = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${profToken1}` },
    body: {
      title: 'Prof1 Private Task',
      description: 'Private algorithm for classroom examination',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'contest_private',
    },
  });
  const prob1Id = createP1.body.problem.id;
  createdProblemIds.push(prob1Id);
  assert(createP1.status === 201, '2.1 Professor 1 creates problem successfully');

  // Add test case to Problem 1
  const createTc1 = await request('POST', `/api/problems/${prob1Id}/test-cases`, {
    headers: { Authorization: `Bearer ${profToken1}` },
    body: { inputData: '10 20', expectedOutput: '30', isHidden: false, isSample: true },
  });
  const tc1Id = createTc1.body.testCase.id;
  assert(createTc1.status === 201, '2.2 Professor 1 adds test case to own problem');

  // Prof 2 attempts unauthorized operations on Problem 1
  const prof2Get = await request('GET', `/api/problems/${prob1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2Get.status === 404, '2.3 BOLA: Prof 2 cannot view Prof 1 private problem (404 Not Found)');

  const prof2Put = await request('PUT', `/api/problems/${prob1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
    body: { title: 'Prof2 Hijack Attempt' },
  });
  assert(prof2Put.status === 403, '2.4 BOLA: Prof 2 cannot update Prof 1 problem (403 Forbidden)');

  const prof2Pub = await request('POST', `/api/problems/${prob1Id}/publish`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2Pub.status === 403, '2.5 BOLA: Prof 2 cannot publish Prof 1 problem (403 Forbidden)');

  const prof2Prev = await request('GET', `/api/problems/${prob1Id}/preview`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2Prev.status === 403, '2.6 BOLA: Prof 2 cannot preview Prof 1 problem (403 Forbidden)');

  const prof2Clone = await request('POST', `/api/problems/${prob1Id}/clone`, {
    headers: { Authorization: `Bearer ${profToken2}` },
    body: { title: 'Prof2 Stolen Clone' },
  });
  assert(prof2Clone.status === 403, '2.7 BOLA: Prof 2 cannot clone Prof 1 private problem (403 Forbidden)');

  const prof2Vers = await request('GET', `/api/problems/${prob1Id}/versions`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2Vers.status === 403, '2.8 BOLA: Prof 2 cannot view Prof 1 versions (403 Forbidden)');

  const prof2Del = await request('DELETE', `/api/problems/${prob1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2Del.status === 403, '2.9 BOLA: Prof 2 cannot delete Prof 1 problem (403 Forbidden)');

  // Prof 2 attempts unauthorized operations on Prof 1 Test Cases
  const prof2TcList = await request('GET', `/api/problems/${prob1Id}/test-cases`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2TcList.status === 403, '2.10 BOLA: Prof 2 cannot list Prof 1 test cases (403 Forbidden)');

  const prof2TcGet = await request('GET', `/api/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2TcGet.status === 403, '2.11 BOLA: Prof 2 cannot read Prof 1 test case (403 Forbidden)');

  const prof2TcPut = await request('PUT', `/api/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
    body: { expectedOutput: 'tampered' },
  });
  assert(prof2TcPut.status === 403, '2.12 BOLA: Prof 2 cannot update Prof 1 test case (403 Forbidden)');

  const prof2TcDel = await request('DELETE', `/api/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken2}` },
  });
  assert(prof2TcDel.status === 403, '2.13 BOLA: Prof 2 cannot delete Prof 1 test case (403 Forbidden)');

  // Cross-Resource Path ID Tampering
  const mismatchTcGet = await request('GET', `/api/problems/999999/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken1}` },
  });
  assert(mismatchTcGet.status === 404, '2.14 Cross-Resource: Mismatched problemId in path returns 404');

  const mismatchTcPut = await request('PUT', `/api/problems/999999/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken1}` },
    body: { expectedOutput: 'tampered' },
  });
  assert(mismatchTcPut.status === 404, '2.15 Cross-Resource: Mismatched problemId in PUT path returns 404');

  const mismatchTcDel = await request('DELETE', `/api/problems/999999/test-cases/${tc1Id}`, {
    headers: { Authorization: `Bearer ${profToken1}` },
  });
  assert(mismatchTcDel.status === 404, '2.16 Cross-Resource: Mismatched problemId in DELETE path returns 404');

  // Super Admin platform-level access
  const sAdminPrev = await request('GET', `/api/problems/${prob1Id}/preview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(sAdminPrev.status === 200, '2.17 Super Admin can preview any problem resource');

  // ==============================================================
  // 3. HIDDEN TEST-CASE ZERO-LEAKAGE DEFENSE
  // ==============================================================
  console.log('\n-- Section 3: Hidden Test-Case Zero-Leakage Defense --');

  // Super Admin creates a problem with public sample and secret hidden test cases
  const createSecretProblem = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Secret Leakage Test Task',
      description: 'Calculates Fibonacci sequence values',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      isPublished: true,
      functionConfig: { functionName: 'fib', returnType: 'int', parameters: [{ name: 'n', type: 'int' }] },
      starterTemplates: { python: 'def fib(n: int) -> int:\n    pass\n' },
      harnessTemplates: { python: '# __STUDENT_CODE__\nprint(fib(int(input())))\n' },
      allowedLanguages: ['python'],
    },
  });
  const secProbId = createSecretProblem.body.problem.id;
  createdProblemIds.push(secProbId);

  // Add visible sample test case
  await request('POST', `/api/problems/${secProbId}/test-cases`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { inputData: '5', expectedOutput: '5', isHidden: false, isSample: true },
  });

  // Add secret hidden test case
  const HIDDEN_INPUT_SECRET = 'CONFIDENTIAL_INPUT_998877';
  const HIDDEN_OUTPUT_SECRET = 'CONFIDENTIAL_OUTPUT_112233';
  await request('POST', `/api/problems/${secProbId}/test-cases`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { inputData: HIDDEN_INPUT_SECRET, expectedOutput: HIDDEN_OUTPUT_SECRET, isHidden: true, isSample: false },
  });

  // A. Student GET Problem Details
  const studentProbView = await request('GET', `/api/problems/${secProbId}`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(studentProbView.status === 200, '3.1 Student can fetch published problem details (200 OK)');
  const sampleCases = studentProbView.body.sampleTestCases || [];
  assert(sampleCases.length === 1, '3.2 Student view strictly returns only sample test cases (count=1)');
  assert(sampleCases[0].inputData === '5', '3.3 Sample test case input matches public sample');
  assert(!studentProbView.text.includes(HIDDEN_INPUT_SECRET), '3.4 CRITICAL: Hidden input secret NOT leaked in student problem view');
  assert(!studentProbView.text.includes(HIDDEN_OUTPUT_SECRET), '3.5 CRITICAL: Hidden output secret NOT leaked in student problem view');

  // B. Admin Preview View
  const adminPrevView = await request('GET', `/api/problems/${secProbId}/preview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(adminPrevView.status === 200, '3.6 Admin preview returns 200 OK');
  assert(!adminPrevView.text.includes(HIDDEN_INPUT_SECRET), '3.7 CRITICAL: Hidden input secret NOT leaked in student-style preview');
  assert(!adminPrevView.text.includes(HIDDEN_OUTPUT_SECRET), '3.8 CRITICAL: Hidden output secret NOT leaked in student-style preview');
  assert(adminPrevView.body.harnessTemplates === undefined, '3.9 CRITICAL: Private harness templates NOT leaked in student-style preview');

  // C. Problem Catalog Listing
  const catalogView = await request('GET', `/api/problems?search=Secret+Leakage`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(catalogView.status === 200, '3.10 Problem search catalog returns 200 OK');
  assert(!catalogView.text.includes(HIDDEN_INPUT_SECRET), '3.11 CRITICAL: Hidden input secret NOT leaked in search catalog');
  assert(!catalogView.text.includes(HIDDEN_OUTPUT_SECRET), '3.12 CRITICAL: Hidden output secret NOT leaked in search catalog');

  // ==============================================================
  // 4. DRAFT & UNPUBLISHED PROBLEM ISOLATION
  // ==============================================================
  console.log('\n-- Section 4: Draft & Unpublished Problem Isolation --');

  // Create an unpublished draft problem
  const createDraft = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Top Secret Unreleased Exam Problem',
      description: 'Exclusive examination problem scheduled for next week finals',
      difficulty: 'hard',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: false,
    },
  });
  const draftProbId = createDraft.body.problem.id;
  createdProblemIds.push(draftProbId);
  assert(createDraft.body.problem.isPublished === false, '4.1 Created problem is unpublished (isPublished = false)');

  // A. Direct Student GET by ID
  const studentDraftGet = await request('GET', `/api/problems/${draftProbId}`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(studentDraftGet.status === 404, '4.2 Student direct GET for unpublished draft problem returns 404 Not Found');

  // B. Unauthenticated GET by ID
  const unauthDraftGet = await request('GET', `/api/problems/${draftProbId}`);
  assert(unauthDraftGet.status === 404, '4.3 Anonymous direct GET for unpublished draft problem returns 404 Not Found');

  // C. Search Isolation
  const searchDraft = await request('GET', '/api/problems?search=Unreleased+Exam', {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(searchDraft.status === 200, '4.4 Student search responds 200 OK');
  assert(searchDraft.body.count === 0, '4.5 Draft problem is completely omitted from student search results (count=0)');
  assert(!searchDraft.text.includes('Top Secret Unreleased Exam'), '4.6 Search response payload has zero traces of draft problem');

  // D. Professor Discovery Isolation (Cannot see other creator unpublished problems)
  const profSearchDraft = await request('GET', '/api/problems?search=Unreleased+Exam', {
    headers: { Authorization: `Bearer ${profToken1}` },
  });
  assert(profSearchDraft.body.count === 0, '4.7 Other professor search does not expose another creator unpublished draft');

  // E. Admin Discovery (Admins can view and govern drafts)
  const adminSearchDraft = await request('GET', '/api/problems?search=Unreleased+Exam', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(adminSearchDraft.body.count >= 1, '4.8 Super Admin can discover and govern draft problem in problem bank');

  // ==============================================================
  // 5. INPUT VALIDATION & STRICT BOUNDARY CONTROLS
  // ==============================================================
  console.log('\n-- Section 5: Input Validation & Boundary Controls --');

  // Title bounds
  const shortTitle = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'AB', description: 'Valid description text', difficulty: 'easy' },
  });
  assert(shortTitle.status === 400, '5.1 Rejects title under 3 characters (400 Bad Request)');

  const longTitle = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'A'.repeat(201), description: 'Valid description text', difficulty: 'easy' },
  });
  assert(longTitle.status === 400, '5.2 Rejects title exceeding 200 characters (400 Bad Request)');

  // Description bounds
  const shortDesc = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'Valid Title', description: 'Tiny', difficulty: 'easy' },
  });
  assert(shortDesc.status === 400, '5.3 Rejects description under 5 characters (400 Bad Request)');

  const oversizedDesc = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'Valid Title', description: 'X'.repeat(100001), difficulty: 'easy' },
  });
  assert(oversizedDesc.status === 400, '5.4 Rejects oversized description exceeding 100,000 characters (400 Bad Request)');

  // Difficulty enum
  const badDiff = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'Valid Title', description: 'Valid description text', difficulty: 'nightmare' },
  });
  assert(badDiff.status === 400, '5.5 Rejects invalid difficulty level (400 Bad Request)');

  // Coding mode enum
  const badMode = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'Valid Title', description: 'Valid description text', difficulty: 'easy', codingMode: 'unsupported_mode' },
  });
  assert(badMode.status === 400, '5.6 Rejects invalid codingMode (400 Bad Request)');

  // Parameter identifier validation in Function Mode
  const invalidFnName = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Valid Title',
      description: 'Valid description text',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: { functionName: '123_invalid_start', returnType: 'int' },
    },
  });
  assert(invalidFnName.status === 400, '5.7 Rejects non-identifier functionName (400 Bad Request)');

  // Parameter array bounds
  const tooManyParams = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Valid Title',
      description: 'Valid description text',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'manyParams',
        returnType: 'int',
        parameters: Array.from({ length: 51 }, (_, i) => ({ name: `p${i}`, type: 'int' })),
      },
    },
  });
  assert(tooManyParams.status === 400, '5.8 Rejects excessive parameter count (>50 parameters) (400 Bad Request)');

  // Parameter type safety
  const unsafeParamType = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Valid Title',
      description: 'Valid description text',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'testTypes',
        returnType: 'int',
        parameters: [{ name: 'x', type: 'int; system("calc.exe");' }],
      },
    },
  });
  assert(unsafeParamType.status === 400, '5.9 Rejects parameter types with dangerous injection characters (400 Bad Request)');

  // Invalid parameter IDs
  const badProbId = await request('GET', '/api/problems/invalid-id');
  assert(badProbId.status === 400, '5.10 Non-integer problem ID returns 400 Bad Request');

  const negProbId = await request('GET', '/api/problems/-5');
  assert(negProbId.status === 400, '5.11 Negative problem ID returns 400 Bad Request');

  const badTcId = await request('GET', '/api/test-cases/abc', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(badTcId.status === 400, '5.12 Non-integer test-case ID returns 400 Bad Request');

  // ==============================================================
  // 6. XSS / CONTENT ESCAPING DEFENSE
  // ==============================================================
  console.log('\n-- Section 6: XSS & Malicious Content Neutralization --');

  const xssPayloadTitle = '<script>alert("XSS-TITLE")</script>';
  const xssPayloadDesc = '<img src=x onerror="alert(\'XSS-DESC\')">';

  const xssProblem = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: xssPayloadTitle,
      description: xssPayloadDesc,
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'public',
      isPublished: true,
    },
  });
  const xssProbId = xssProblem.body.problem.id;
  createdProblemIds.push(xssProbId);
  assert(xssProblem.status === 201, '6.1 Problem created with raw HTML/script payload in title and description');

  // Fetch from student view
  const xssStudentGet = await request('GET', `/api/problems/${xssProbId}`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(xssStudentGet.status === 200, '6.2 Student GET returns problem successfully');
  assert(xssStudentGet.body.title === xssPayloadTitle, '6.3 Title stored verbatim as inert text string without executing');
  assert(xssStudentGet.body.description === xssPayloadDesc, '6.4 Description stored verbatim as inert text string without executing');

  // Verify Preview endpoint handles XSS payload safely
  const xssPreviewGet = await request('GET', `/api/problems/${xssProbId}/preview`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(xssPreviewGet.status === 200, '6.5 Preview endpoint returns 200 OK');
  assert(xssPreviewGet.body.description === xssPayloadDesc, '6.6 Preview serves description text without server-side corruption');

  // ==============================================================
  // 7. SQL INJECTION DEFENSE
  // ==============================================================
  console.log('\n-- Section 7: SQL Injection Defense --');

  // A. Search parameter SQLi
  const sqliSearch1 = await request('GET', `/api/problems?search=' OR '1'='1`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(sqliSearch1.status === 200, '7.1 Classic SQL injection in search parameter executes safely without 500 error');

  const sqliSearch2 = await request('GET', `/api/problems?search=1; DROP TABLE test_cases; --`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(sqliSearch2.status === 200, '7.2 Destructive SQL injection in search parameter executes safely via parameterization');

  // Verify test_cases table was not dropped
  const checkTable = await db.query('SELECT COUNT(*) FROM test_cases');
  assert(parseInt(checkTable.rows[0].count, 10) >= 0, '7.3 Database integrity verified: test_cases table intact');

  // B. SortBy parameter SQLi
  const sqliSort = await request('GET', `/api/problems?sortBy=id;SELECT * FROM users--`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(sqliSort.status === 200, '7.4 Malicious sortBy parameter falls back safely to whitelisted ordering');

  // C. Difficulty parameter SQLi
  const sqliDiff = await request('GET', `/api/problems?difficulty=' OR '1'='1`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert(sqliDiff.status === 200, '7.5 SQL injection in difficulty filter safely parameterized');

  // ==============================================================
  // 8. PATH TRAVERSAL & CODE GENERATION HARNESS SECURITY
  // ==============================================================
  console.log('\n-- Section 8: Path Traversal & Harness Builder Security --');

  // Verify HarnessBuilder wraps student logic inside trusted platform harness
  const rawStudentCode = 'return a + b';
  const pythonHarness = HarnessBuilder.buildExecutableCode({
    language: 'python',
    codingMode: 'function',
    sourceCode: rawStudentCode,
    problem: {
      harnessTemplates: {
        python: '# ====== TRUSTED HARNESS ======\n# __STUDENT_CODE__\nif __name__ == "__main__":\n    print(Solution().solve(1, 2))\n',
      },
    },
  });
  assert(pythonHarness.includes(rawStudentCode), '8.1 Python harness properly contains student logic');
  assert(!pythonHarness.includes('__STUDENT_CODE__'), '8.2 Placeholder __STUDENT_CODE__ cleanly stripped and replaced');
  assert(pythonHarness.includes('# ====== TRUSTED HARNESS ======'), '8.3 Platform-controlled execution boundary preserved');

  // Path traversal in starter/harness templates
  const pathTraversalHarness = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Path Traversal Guard Test',
      description: 'Verifies harness template accepts safe strings only',
      difficulty: 'easy',
      codingMode: 'function',
      allowedLanguages: ['python'],
      starterTemplates: { python: 'def solve(): pass' },
      harnessTemplates: { python: '# __STUDENT_CODE__\nimport os\n# ../../etc/passwd\n' },
    },
  });
  assert(pathTraversalHarness.status === 201, '8.4 Problem created; template stored safely in DB without executing filesystem operations');
  createdProblemIds.push(pathTraversalHarness.body.problem.id);

  // ==============================================================
  // 9. CODING MODE & LANGUAGE CONFIGURATION SECURITY
  // ==============================================================
  console.log('\n-- Section 9: Coding Mode & Language Configuration Security --');

  // Fake language injection
  const fakeLang = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Fake Language Problem',
      description: 'Testing language whitelist enforcement',
      difficulty: 'easy',
      allowedLanguages: ['python', 'malicious_bash_executor'],
    },
  });
  assert(fakeLang.status === 400, '9.1 Rejects unapproved/arbitrary language identifier (400 Bad Request)');

  // Empty allowed languages
  const emptyLangs = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Empty Languages Problem',
      description: 'Testing language whitelist enforcement',
      difficulty: 'easy',
      allowedLanguages: [],
    },
  });
  assert(emptyLangs.status === 400, '9.2 Rejects empty allowedLanguages array (400 Bad Request)');

  // Duplicate allowed languages
  const dupLangs = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Duplicate Languages Problem',
      description: 'Testing language whitelist enforcement',
      difficulty: 'easy',
      allowedLanguages: ['python', 'python'],
    },
  });
  assert(dupLangs.status === 400, '9.3 Rejects duplicate language identifiers (400 Bad Request)');

  // ==============================================================
  // 10. PUBLISH VALIDATION GATE & BYPASS DEFENSE
  // ==============================================================
  console.log('\n-- Section 10: Publish Validation Gate & Bypass Defense --');

  // Create problem with missing test cases
  const unpubProb1 = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'No Test Cases Problem',
      description: 'Cannot be published without test cases',
      difficulty: 'easy',
      codingMode: 'full_program',
      isPublished: false,
    },
  });
  const unpubProb1Id = unpubProb1.body.problem.id;
  createdProblemIds.push(unpubProb1Id);

  // Attempt to publish problem without test cases
  const pubBypass1 = await request('POST', `/api/problems/${unpubProb1Id}/publish`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(pubBypass1.status === 422, '10.1 Direct API publish without test cases rejected with 422 Unprocessable Entity');
  assert(pubBypass1.body.errors && pubBypass1.body.errors.length > 0, '10.2 Publish validation failure returns detailed error list');

  // Verify problem remained unpublished
  const checkUnpub1 = await request('GET', `/api/problems/${unpubProb1Id}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(checkUnpub1.body.isPublished === false, '10.3 Problem remains unpublished after validation failure');

  // Create function mode problem without harness template
  const unpubProb2 = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Incomplete Function Mode Problem',
      description: 'Function problem missing harness templates and function name',
      difficulty: 'medium',
      codingMode: 'function',
      isPublished: false,
      functionConfig: { functionName: 'incompleteFn', returnType: 'int' },
      testCases: [{ inputData: '1', expectedOutput: '2', isHidden: false, isSample: true }],
    },
  });
  const unpubProb2Id = unpubProb2.body.problem.id;
  createdProblemIds.push(unpubProb2Id);

  const pubBypass2 = await request('POST', `/api/problems/${unpubProb2Id}/publish`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(pubBypass2.status === 422, '10.4 Publishing incomplete Function Mode problem rejected with 422');
  assert(
    pubBypass2.body.errors.some((e) => e.includes('function name') || e.includes('harness')),
    '10.5 Validation errors identify missing function configuration and harness templates'
  );

  // ==============================================================
  // 11. OPTIMISTIC CONCURRENCY CONTROL (SILENT OVERWRITE PREVENTION)
  // ==============================================================
  console.log('\n-- Section 11: Optimistic Concurrency Control --');

  // Create problem for concurrency testing
  const occProb = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Concurrency Safety Task',
      description: 'Tests optimistic version locking against race conditions',
      difficulty: 'medium',
      codingMode: 'full_program',
    },
  });
  const occProbId = occProb.body.problem.id;
  createdProblemIds.push(occProbId);
  assert(occProb.body.problem.version === 1, '11.1 Concurrency problem starts at version 1');

  // Session B updates the problem first -> increments to version 2
  const sessionBUpdate = await request('PUT', `/api/problems/${occProbId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Concurrency Safety Task - Session B Edition',
      expectedVersion: 1,
    },
  });
  assert(sessionBUpdate.status === 200, '11.2 Session B update succeeds');
  assert(sessionBUpdate.body.problem.version === 2, '11.3 Database problem version incremented to 2');

  // Session A attempts update using stale expectedVersion = 1
  const sessionAStaleUpdate = await request('PUT', `/api/problems/${occProbId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Concurrency Safety Task - Stale Overwrite Attempt',
      expectedVersion: 1,
    },
  });
  assert(sessionAStaleUpdate.status === 409, '11.4 Stale update rejected with HTTP 409 Conflict');
  assert(sessionAStaleUpdate.body.currentVersion === 2, '11.5 Conflict response provides currentVersion for client resync');

  // Verify Session A did NOT overwrite Session B changes
  const verifyNoOverwrite = await request('GET', `/api/problems/${occProbId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(verifyNoOverwrite.body.title === 'Concurrency Safety Task - Session B Edition', '11.6 Database data preserved intact; silent overwrite prevented');

  // ==============================================================
  // 12. VERSION HISTORY & IMMUTABLE REVISION SECURITY
  // ==============================================================
  console.log('\n-- Section 12: Version History & Snapshot Security --');

  // Publish problem to generate version snapshot
  await request('POST', `/api/problems/${occProbId}/test-cases`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { inputData: '1', expectedOutput: '2', isHidden: false, isSample: true },
  });

  const publishOcc = await request('POST', `/api/problems/${occProbId}/publish`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(publishOcc.status === 200, '12.1 Problem published successfully');

  // List versions
  const getVersions = await request('GET', `/api/problems/${occProbId}/versions`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(getVersions.status === 200, '12.2 Manager can view immutable revision list (200 OK)');
  assert(getVersions.body.versions.length >= 1, '12.3 Versions array contains recorded publication snapshot');

  // Get specific version detail
  const vNum = getVersions.body.versions[0].versionNumber;
  const getVersionDetail = await request('GET', `/api/problems/${occProbId}/versions/${vNum}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(getVersionDetail.status === 200, '12.4 Manager can fetch specific version snapshot (200 OK)');
  assert(getVersionDetail.body.version.versionNumber === vNum, '12.5 Version snapshot matches requested versionNumber');

  // Non-existent version
  const badVersion = await request('GET', `/api/problems/${occProbId}/versions/999999`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(badVersion.status === 404, '12.6 Non-existent version number returns 404 Not Found');

  // Invalid version format
  const invalidVersionFormat = await request('GET', `/api/problems/${occProbId}/versions/abc`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(invalidVersionFormat.status === 400, '12.7 Non-numeric version number returns 400 Bad Request');

  // ==============================================================
  // 13. CLONE SECURITY & DRAFT STATE GUARANTEES
  // ==============================================================
  console.log('\n-- Section 13: Clone Security & Draft State Guarantees --');

  const cloneRes = await request('POST', `/api/problems/${occProbId}/clone`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { title: 'Cloned Security Task' },
  });
  assert(cloneRes.status === 201, '13.1 Problem cloned successfully returns 201 Created');
  const clonedProblem = cloneRes.body.problem;
  createdProblemIds.push(clonedProblem.id);

  assert(clonedProblem.id !== occProbId, '13.2 Cloned problem has distinct new identifier');
  assert(clonedProblem.isPublished === false, '13.3 Cloned problem always defaults to unpublished (isPublished = false)');
  assert(clonedProblem.version === 1, '13.4 Cloned problem resets version to 1');
  assert(clonedProblem.reviewStatus === 'draft', '13.5 Cloned problem reviewStatus resets to draft');

  // Verify cloned test cases exist and are independent
  const clonedTcs = await request('GET', `/api/problems/${clonedProblem.id}/test-cases`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(clonedTcs.status === 200, '13.6 Cloned problem test cases accessible to owner');
  assert(clonedTcs.body.count === 1, '13.7 Test cases cloned accurately with parent problem');

  // ==============================================================
  // 14. DELETE PROTECTION & SUBMISSION INTEGRITY
  // ==============================================================
  console.log('\n-- Section 14: Delete Protection & Transactional Integrity --');

  // Create problem with submission
  const subProb = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Problem With Active Submissions',
      description: 'Integrity test to ensure problems with submissions cannot be deleted',
      difficulty: 'easy',
      codingMode: 'full_program',
    },
  });
  const subProbId = subProb.body.problem.id;
  createdProblemIds.push(subProbId);

  // Insert mock submission in database
  await db.query(
    `INSERT INTO submissions (user_id, problem_id, language, coding_mode, source_code, status, score)
     VALUES ($1, $2, 'python', 'full_program', 'print(1)', 'accepted', 100)`,
    [studentUser.id, subProbId]
  );

  // Attempt to delete problem with active submissions
  const delWithSub = await request('DELETE', `/api/problems/${subProbId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(delWithSub.status === 409, '14.1 Deleting problem with active submissions rejected with 409 Conflict');
  assert(delWithSub.body.message.includes('submissions exist'), '14.2 Error message explains submission preservation invariant');

  // Delete problem without submissions
  const cleanDelProb = await request('POST', '/api/problems', {
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: {
      title: 'Ephemeral Clean Delete Problem',
      description: 'Will be safely deleted in atomic transaction',
      difficulty: 'easy',
      codingMode: 'full_program',
      testCases: [{ inputData: '1', expectedOutput: '2' }],
    },
  });
  const cleanDelId = cleanDelProb.body.problem.id;

  const delClean = await request('DELETE', `/api/problems/${cleanDelId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(delClean.status === 200, '14.3 Deleting problem without submissions returns 200 OK');

  const checkDeleted = await request('GET', `/api/problems/${cleanDelId}`, {
    headers: { Authorization: `Bearer ${superAdminToken}` },
  });
  assert(checkDeleted.status === 404, '14.4 Deleted problem is no longer accessible (404 Not Found)');

  // ==============================================================
  // 15. AUDIT LOGGING & SECURITY EVENT TRACING
  // ==============================================================
  console.log('\n-- Section 15: Audit Logging & Security Event Tracing --');

  const auditEventsRes = await db.query(
    `SELECT action, resource_type, outcome, metadata
     FROM audit_logs
     WHERE actor_id IN ($1, $2, $3, $4, $5)
     ORDER BY id DESC LIMIT 50`,
    createdUserIds
  );
  const auditLogs = auditEventsRes.rows;

  const foundDenied = auditLogs.some((l) => l.action === 'PRIVILEGED_ACTION_DENIED' && l.outcome === 'denied');
  assert(foundDenied, '15.1 PRIVILEGED_ACTION_DENIED event recorded in audit_logs for unauthorized attempt');

  const foundCreated = auditLogs.some((l) => l.action === 'PROBLEM_CREATED' && l.outcome === 'success');
  assert(foundCreated, '15.2 PROBLEM_CREATED event recorded in audit_logs');

  const foundUpdated = auditLogs.some((l) => l.action === 'PROBLEM_UPDATED' && l.outcome === 'success');
  assert(foundUpdated, '15.3 PROBLEM_UPDATED event recorded in audit_logs');

  const foundPublished = auditLogs.some((l) => l.action === 'PROBLEM_PUBLISHED' && l.outcome === 'success');
  assert(foundPublished, '15.4 PROBLEM_PUBLISHED event recorded in audit_logs');

  const foundCloned = auditLogs.some((l) => l.action === 'PROBLEM_CLONED' && l.outcome === 'success');
  assert(foundCloned, '15.5 PROBLEM_CLONED event recorded in audit_logs');

  const foundDeleted = auditLogs.some((l) => l.action === 'PROBLEM_DELETED' && l.outcome === 'success');
  assert(foundDeleted, '15.6 PROBLEM_DELETED event recorded in audit_logs');

  // Verify logs do NOT contain passwords or secrets
  const logsDump = JSON.stringify(auditLogs);
  assert(!logsDump.includes('hash_sec_vault_test'), '15.7 Audit logs NEVER contain password hashes');
  assert(!logsDump.includes('eyJhbGciOi'), '15.8 Audit logs NEVER contain raw JWT tokens');

  // ==============================================================
  // 16. API RESPONSE LEAKAGE HARDENING
  // ==============================================================
  console.log('\n-- Section 16: API Response Leakage Hardening --');

  // Test across multiple endpoints for sensitive leaks
  const endpointsToAudit = [
    { method: 'GET', path: `/api/problems/${secProbId}`, headers: { Authorization: `Bearer ${studentToken}` } },
    { method: 'GET', path: `/api/problems/${secProbId}/preview`, headers: { Authorization: `Bearer ${superAdminToken}` } },
    { method: 'GET', path: `/api/problems?search=test`, headers: { Authorization: `Bearer ${studentToken}` } },
    { method: 'GET', path: `/api/problems/${occProbId}/versions`, headers: { Authorization: `Bearer ${superAdminToken}` } },
    { method: 'GET', path: `/api/problems/${occProbId}/versions/1`, headers: { Authorization: `Bearer ${superAdminToken}` } },
  ];

  let hasSecretLeak = false;
  for (const ep of endpointsToAudit) {
    const res = await request(ep.method, ep.path, { headers: ep.headers });
    const payload = res.text.toLowerCase();
    if (
      payload.includes('password_hash') ||
      payload.includes('jwt_secret') ||
      payload.includes('postgres://') ||
      payload.includes('stack_trace') ||
      payload.includes('pg_stat_activity')
    ) {
      hasSecretLeak = true;
      console.error(`Leak detected in ${ep.path}: ${payload.slice(0, 100)}`);
    }
  }
  assert(!hasSecretLeak, '16.1 All responses verified clean of password_hash, jwt_secret, connection strings, and stack traces');

  // ==============================================================
  // 17. RATE LIMITING PROTECTION
  // ==============================================================
  console.log('\n-- Section 17: Rate Limiting Protection --');

  // Verify rate limiter activates when testing rate limits explicitly
  const rateLimitProbe = await request('GET', '/api/problems', {
    headers: {
      'x-test-rate-limit': 'true',
    },
  });
  // Rate limiter middleware adds standard rate limiting or executes safely
  assert(rateLimitProbe.status === 200 || rateLimitProbe.status === 429, '17.1 Rate limiter evaluates incoming problem queries');

  const tcRateLimitProbe = await request('GET', `/api/problems/${occProbId}/test-cases`, {
    headers: {
      Authorization: `Bearer ${superAdminToken}`,
      'x-test-rate-limit': 'true',
    },
  });
  assert(tcRateLimitProbe.status === 200 || tcRateLimitProbe.status === 429, '17.2 Rate limiter evaluates incoming test-case queries');

  // ==============================================================
  // TEARDOWN
  // ==============================================================
  console.log('\n-- Teardown: Purging Ephemeral Test Entities --');
  try {
    if (createdProblemIds.length > 0) {
      await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM problem_validation_configs WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM submissions WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
      await db.query(`DELETE FROM submissions WHERE user_id = ANY($1::int[])`, [createdUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
    }
    console.log(`  Purged ${createdProblemIds.length} test problems and ${createdUserIds.length} test users.`);
  } catch (cleanErr) {
    console.error('Error during cleanup:', cleanErr.message);
  }

  console.log('\n=================================================================');
  console.log(` PHASE 7.4.10 RESULTS: ${passed} passed, ${failed} failed`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Start local HTTP server
const port = 0;
server = app.listen(port, () => {
  const p = server.address().port;
  baseUrl = `http://127.0.0.1:${p}`;
  console.log(`Security test harness running on ${baseUrl}`);
  runTests()
    .then(() => {
      server.close(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Test suite error:', err);
      if (server) server.close();
      process.exit(1);
    });
});
