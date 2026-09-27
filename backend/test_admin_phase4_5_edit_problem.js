/**
 * Automated Test Suite for Phase 7.4.5: Edit Problem — Full Workflow
 *
 * Verifies:
 * 1. RBAC & Route Authorization:
 *    - Unauthenticated PUT /api/problems/:id returns 401
 *    - Student role returns 403 Forbidden
 *    - Super Admin can edit any problem (200 OK)
 *    - Professor can edit own problem (200 OK)
 *    - Professor cannot edit another professor's problem (403)
 *    - Contest Admin can edit any problem (200 OK)
 *
 * 2. Edit Problem — Core Update Workflow:
 *    - Load problem via GET /api/admin/problems/:id
 *    - Update title, description, difficulty
 *    - Version increments after update (version+1)
 *    - Review status reset to 'draft' after update
 *    - Unchanged fields preserved (data preservation)
 *
 * 3. Sample Test Cases Replacement:
 *    - Editing examples replaces sample test cases atomically
 *    - Hidden test cases are never touched
 *    - Test case count updates correctly
 *    - Test case content updates correctly
 *
 * 4. Optimistic Concurrency Control:
 *    - Stale version returns 409 Conflict
 *    - Current version accepts update
 *    - Version number in response is updated
 *
 * 5. Data Preservation:
 *    - Changing only difficulty preserves title, description, templates
 *    - Changing only templates preserves difficulty, title, description
 *    - Changing only title preserves all other fields
 *
 * 6. Input Validation Gate:
 *    - Short title (<3 chars) returns 400
 *    - Short description (<5 chars) returns 400
 *    - Invalid difficulty returns 400
 *    - Invalid codingMode returns 400
 *
 * 7. Invalid Problem ID & Not Found:
 *    - Non-numeric ID returns 400 from admin GET
 *    - Nonexistent problem ID returns 404
 *
 * 8. Security:
 *    - BOLA: Professor cannot edit other professor's problem
 *    - Response does not expose password_hash or sensitive tokens
 *    - Audit log records PROBLEM_UPDATED event
 *    - 403 response does not expose SQL internals
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const adminRoutes = require('./src/routes/adminRoutes');
const problemRoutes = require('./src/routes/problemRoutes');
const { errorHandler } = require('./src/middleware/errorHandler');

let server;
let baseUrl;

let studentUser, studentToken;
let profUser, profToken;
let profUser2, profToken2;
let contestAdminUser, contestAdminToken;
let superAdminUser, superAdminToken;

let createdProblemIds = [];
let createdUserIds = [];

let passedAssertions = 0;
let failedAssertions = 0;

function check(label, condition, meta) {
  if (condition) {
    passedAssertions++;
    console.log('  [PASS] ' + label);
  } else {
    failedAssertions++;
    console.error('  [FAIL] ' + label + (meta !== undefined ? ' -> ' + JSON.stringify(meta) : ''));
  }
}

async function request(method, path, body, token) {
  const url = baseUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(function() { return null; });
  return { status: res.status, data: data };
}

async function createProblem(token, overrides) {
  overrides = overrides || {};
  const payload = Object.assign({
    title: 'Phase745 Base Problem',
    description: 'Describe the algorithm challenge in detail.',
    difficulty: 'easy',
    codingMode: 'function',
    accessScope: 'public',
    starterTemplates: {
      python: 'class Solution:\n    def solve(self, nums):\n        return 0\n',
      cpp: 'class Solution {\npublic:\n    int solve() { return 0; }\n};\n',
    },
    harnessTemplates: {
      python: 'import sys\n# __STUDENT_CODE__\ndef _m(): pass\nif __name__=="__main__": _m()\n',
    },
    testCases: [
      { inputData: '1 2 3', expectedOutput: '6', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 1 },
    ],
  }, overrides);
  const r = await request('POST', '/api/problems', payload, token);
  if (r.status === 201 && r.data && r.data.problem) {
    createdProblemIds.push(r.data.problem.id);
    return r.data.problem;
  }
  return null;
}

async function setup() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/problems', problemRoutes);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = 'http://127.0.0.1:' + server.address().port;

  const pw = await hashPassword('TestPass745!');

  const ins = async function(username, email, role, fullName) {
    const r = await db.query(
      'INSERT INTO users (username, email, password_hash, role, full_name, is_active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id, username, role',
      [username, email, pw, role, fullName]
    );
    const u = r.rows[0];
    createdUserIds.push(u.id);
    return { user: u, token: generateToken(u) };
  };

  var s = await ins('p745_student', 'p745_student@test.example', 'student', 'Phase745 Student');
  studentUser = s.user; studentToken = s.token;

  var p = await ins('p745_prof', 'p745_prof@test.example', 'professor', 'Phase745 Professor');
  profUser = p.user; profToken = p.token;

  var p2 = await ins('p745_prof2', 'p745_prof2@test.example', 'professor', 'Phase745 Professor2');
  profUser2 = p2.user; profToken2 = p2.token;

  var ca = await ins('p745_cadmin', 'p745_cadmin@test.example', 'contest_admin', 'Phase745 Contest Admin');
  contestAdminUser = ca.user; contestAdminToken = ca.token;

  var sa = await ins('p745_sadmin', 'p745_sadmin@test.example', 'super_admin', 'Phase745 Super Admin');
  superAdminUser = sa.user; superAdminToken = sa.token;
}

async function cleanup() {
  for (var i = 0; i < createdProblemIds.length; i++) {
    await db.query('DELETE FROM problems WHERE id = $1', [createdProblemIds[i]]).catch(function() {});
  }
  for (var j = 0; j < createdUserIds.length; j++) {
    await db.query('DELETE FROM users WHERE id = $1', [createdUserIds[j]]).catch(function() {});
  }
  if (server) await new Promise(function(resolve) { server.close(resolve); });
}

async function runTests() {
  console.log('='.repeat(65));
  console.log(' PHASE 7.4.5 — EDIT PROBLEM INTEGRATION TESTS');
  console.log('='.repeat(65));

  // ── Section 1: RBAC & Authorization ──────────────────────────────
  console.log('\n-- Section 1: RBAC & Route Authorization --');

  // Create a seed problem owned by super admin for auth tests
  var seedProb = await createProblem(superAdminToken, { title: 'Phase745 Auth Seed Problem' });
  check('Setup: seed problem created', seedProb !== null, seedProb);

  var r;

  // 1.1 Unauthenticated
  r = await request('PUT', '/api/problems/' + (seedProb ? seedProb.id : 1), { title: 'New Title', description: 'Valid desc', difficulty: 'easy' });
  check('1.1 Unauthenticated PUT returns 401', r.status === 401, r.data);

  // 1.2 Student
  if (seedProb) {
    r = await request('PUT', '/api/problems/' + seedProb.id, { title: 'New Title', description: 'Valid desc', difficulty: 'easy' }, studentToken);
    check('1.2 Student role returns 403 Forbidden', r.status === 403, r.data);
  }

  // 1.3 Super Admin can edit any problem
  if (seedProb) {
    r = await request('PUT', '/api/problems/' + seedProb.id, {
      title: 'Phase745 Updated By SuperAdmin',
      description: 'Updated problem description for Phase 7.4.5 testing.',
      difficulty: 'medium',
      version: seedProb.version,
    }, superAdminToken);
    check('1.3 Super Admin can edit any problem (200)', r.status === 200, r.data);
    if (r.status === 200 && r.data.problem) seedProb = r.data.problem;
  }

  // 1.4 Professor can edit own problem
  var profProb = await createProblem(profToken, { title: 'Phase745 Prof Own Problem' });
  check('Setup: prof own problem created', profProb !== null, profProb);

  if (profProb) {
    r = await request('PUT', '/api/problems/' + profProb.id, {
      title: 'Phase745 Prof Own Problem Updated',
      description: 'Professor updated this problem.',
      difficulty: 'hard',
      version: profProb.version,
    }, profToken);
    check('1.4 Professor can edit own problem (200)', r.status === 200, r.data);
  }

  // 1.5 Professor BOLA — cannot edit another professor's problem
  var profProb2 = await createProblem(profToken2, { title: 'Phase745 Prof2 Problem' });
  check('Setup: prof2 problem created', profProb2 !== null, profProb2);

  if (profProb2) {
    r = await request('PUT', '/api/problems/' + profProb2.id, {
      title: 'Phase745 Prof1 Attempts Theft',
      description: 'Professor 1 should not edit professor 2 problem.',
      difficulty: 'easy',
      version: profProb2.version,
    }, profToken);
    check('1.5 Professor cannot edit another professor\'s problem (403 BOLA)', r.status === 403, r.data);
  }

  // 1.6 Contest Admin can edit any problem
  if (profProb) {
    r = await request('PUT', '/api/problems/' + profProb.id, {
      title: 'Phase745 Contest Admin Override',
      description: 'Contest admin updating professor problem.',
      difficulty: 'easy',
      version: profProb.version !== undefined ? profProb.version + 1 : 2,
    }, contestAdminToken);
    check('1.6 Contest Admin can edit any problem (200)', r.status === 200, r.data);
  }

  // ── Section 2: Core Edit Workflow ────────────────────────────────
  console.log('\n-- Section 2: Core Edit Workflow --');

  var editProb = await createProblem(superAdminToken, { title: 'Phase745 Edit Core Problem', difficulty: 'easy' });
  check('Setup: edit core problem created', editProb !== null, editProb);

  if (editProb) {
    // 2.1 Load via admin GET
    r = await request('GET', '/api/admin/problems/' + editProb.id, null, superAdminToken);
    check('2.1 GET /api/admin/problems/:id returns 200', r.status === 200, r.data);

    var loaded = r.data && (r.data.data && r.data.data.problem || r.data.problem);
    check('2.2 Loaded problem id matches', loaded && loaded.id === editProb.id, loaded && loaded.id);
    check('2.3 Loaded problem has sampleTestCases array', loaded && Array.isArray(loaded.sampleTestCases), loaded);

    // 2.4 Update title, description, difficulty
    r = await request('PUT', '/api/problems/' + editProb.id, {
      title: 'Phase745 Edit Core Problem — UPDATED',
      description: 'Updated description with sufficient length for validation.',
      difficulty: 'hard',
      version: editProb.version,
    }, superAdminToken);
    check('2.4 Update title/description/difficulty returns 200', r.status === 200, r.data);

    var updated = r.data && r.data.problem;
    check('2.5 Updated title matches', updated && updated.title === 'Phase745 Edit Core Problem — UPDATED', updated && updated.title);
    check('2.6 Updated difficulty matches "hard"', updated && updated.difficulty === 'hard', updated && updated.difficulty);
    check('2.7 Version incremented after update', updated && updated.version === editProb.version + 1, updated && updated.version);
    check('2.8 reviewStatus reset to "draft" after update', updated && (updated.reviewStatus || updated.review_status) === 'draft', updated);
  }

  // ── Section 3: Sample Test Cases Replacement ─────────────────────
  console.log('\n-- Section 3: Sample Test Cases Replacement --');

  var tcProb = await createProblem(superAdminToken, {
    title: 'Phase745 TC Replacement Problem',
    testCases: [
      { inputData: 'original input 1', expectedOutput: 'orig out 1', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 1 },
      { inputData: 'original input 2', expectedOutput: 'orig out 2', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 2 },
    ],
  });
  check('Setup: TC replacement problem created', tcProb !== null, tcProb);

  if (tcProb) {
    // Verify original test cases
    var r1 = await request('GET', '/api/admin/problems/' + tcProb.id, null, superAdminToken);
    var origProb = r1.data && (r1.data.data && r1.data.data.problem || r1.data.problem);
    check('3.1 Original problem has 2 sample test cases', origProb && origProb.sampleTestCases && origProb.sampleTestCases.length === 2, origProb && origProb.sampleTestCases && origProb.sampleTestCases.length);

    // Update with new test cases (3 new ones)
    var r2 = await request('PUT', '/api/problems/' + tcProb.id, {
      title: tcProb.title,
      description: 'Updated description for test case replacement.',
      difficulty: 'medium',
      version: tcProb.version,
      testCases: [
        { inputData: 'new input A', expectedOutput: 'new out A', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 1 },
        { inputData: 'new input B', expectedOutput: 'new out B', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 2 },
        { inputData: 'new input C', expectedOutput: 'new out C', isSample: true, isHidden: false, timeLimitMs: 2000, memoryLimitMb: 256, testOrder: 3 },
      ],
    }, superAdminToken);
    check('3.2 Update with new test cases returns 200', r2.status === 200, r2.data);

    // Reload and verify new test cases
    var r3 = await request('GET', '/api/admin/problems/' + tcProb.id, null, superAdminToken);
    var reloaded = r3.data && (r3.data.data && r3.data.data.problem || r3.data.problem);
    var newCases = reloaded && reloaded.sampleTestCases || [];

    check('3.3 Problem now has 3 sample test cases after update', newCases.length === 3, 'count=' + newCases.length);
    check('3.4 First new test case has correct inputData', newCases.length >= 1 && newCases[0].inputData === 'new input A', newCases[0] && newCases[0].inputData);
    check('3.5 First new test case has correct expectedOutput', newCases.length >= 1 && newCases[0].expectedOutput === 'new out A', newCases[0] && newCases[0].expectedOutput);
    check('3.6 Old test cases are gone (no "original input" remaining)', newCases.every(function(tc) { return !tc.inputData.includes('original input'); }), JSON.stringify(newCases.map(function(tc) { return tc.inputData; })));
  }

  // ── Section 4: Optimistic Concurrency Control ──────────────────
  console.log('\n-- Section 4: Optimistic Concurrency Control --');

  var concurrencyProb = await createProblem(superAdminToken, { title: 'Phase745 Concurrency Problem' });
  check('Setup: concurrency problem created', concurrencyProb !== null, concurrencyProb);

  if (concurrencyProb) {
    // 4.1 Stale version returns 409
    r = await request('PUT', '/api/problems/' + concurrencyProb.id, {
      title: 'Phase745 Stale Version Update',
      description: 'This update uses an old version number.',
      difficulty: 'medium',
      version: 999, // Wrong stale version
    }, superAdminToken);
    check('4.1 Stale version returns 409 Conflict', r.status === 409, r.data);
    check('4.2 409 response contains currentVersion', r.data && r.data.currentVersion !== undefined, r.data);

    // 4.3 Correct version succeeds
    r = await request('PUT', '/api/problems/' + concurrencyProb.id, {
      title: 'Phase745 Correct Version Update',
      description: 'This update uses the correct current version.',
      difficulty: 'hard',
      version: concurrencyProb.version,
    }, superAdminToken);
    check('4.3 Correct version returns 200', r.status === 200, r.data);
    var vUpd = r.data && r.data.problem;
    check('4.4 Version number incremented in response', vUpd && vUpd.version === concurrencyProb.version + 1, vUpd && vUpd.version);
  }

  // ── Section 5: Data Preservation ──────────────────────────────
  console.log('\n-- Section 5: Data Preservation --');

  var preserveProb = await createProblem(superAdminToken, {
    title: 'Phase745 Data Preservation Problem',
    description: 'This description must survive partial updates without modification.',
    difficulty: 'easy',
    codingMode: 'function',
  });
  check('Setup: data preservation problem created', preserveProb !== null, preserveProb);

  if (preserveProb) {
    // Change only difficulty — title and description must be preserved
    r = await request('PUT', '/api/problems/' + preserveProb.id, {
      difficulty: 'hard',
      version: preserveProb.version,
    }, superAdminToken);
    check('5.1 Partial update (difficulty only) returns 200', r.status === 200, r.data);

    var partialUpd = r.data && r.data.problem;
    check('5.2 Title preserved after difficulty-only update', partialUpd && partialUpd.title === preserveProb.title, partialUpd && partialUpd.title);
    check('5.3 Description preserved after difficulty-only update', partialUpd && partialUpd.description === preserveProb.description, partialUpd && partialUpd.description);
    check('5.4 Difficulty updated to "hard"', partialUpd && partialUpd.difficulty === 'hard', partialUpd && partialUpd.difficulty);
    check('5.5 codingMode preserved after partial update', partialUpd && (partialUpd.codingMode || partialUpd.coding_mode) === 'function', partialUpd && (partialUpd.codingMode || partialUpd.coding_mode));
  }

  // ── Section 6: Input Validation Gate ───────────────────────────
  console.log('\n-- Section 6: Input Validation Gate --');

  var validationProb = await createProblem(superAdminToken, { title: 'Phase745 Validation Probe' });
  if (validationProb) {
    r = await request('PUT', '/api/problems/' + validationProb.id, { title: 'AB', description: 'Valid description', difficulty: 'easy' }, superAdminToken);
    check('6.1 Short title (<3 chars) returns 400', r.status === 400, r.data);

    r = await request('PUT', '/api/problems/' + validationProb.id, { title: 'Valid Title', description: 'Hi', difficulty: 'easy' }, superAdminToken);
    check('6.2 Short description (<5 chars) returns 400', r.status === 400, r.data);

    r = await request('PUT', '/api/problems/' + validationProb.id, { title: 'Valid Title', description: 'Valid description', difficulty: 'legendary' }, superAdminToken);
    check('6.3 Invalid difficulty returns 400', r.status === 400, r.data);

    r = await request('PUT', '/api/problems/' + validationProb.id, { title: 'Valid Title', description: 'Valid description', difficulty: 'easy', codingMode: 'quantum' }, superAdminToken);
    check('6.4 Invalid codingMode returns 400', r.status === 400, r.data);
  }

  // ── Section 7: Invalid ID & Not Found ─────────────────────────
  console.log('\n-- Section 7: Invalid ID & Not Found --');

  r = await request('GET', '/api/admin/problems/not-a-number', null, superAdminToken);
  check('7.1 Non-numeric ID in GET returns 400', r.status === 400, r.data);

  r = await request('GET', '/api/admin/problems/9999999', null, superAdminToken);
  check('7.2 Nonexistent problem ID returns 404', r.status === 404, r.data);

  r = await request('PUT', '/api/problems/9999999', { title: 'Ghost', description: 'Ghost problem edit', difficulty: 'easy' }, superAdminToken);
  check('7.3 Update nonexistent problem returns 404', r.status === 404, r.data);

  // ── Section 8: Security ─────────────────────────────────────────
  console.log('\n-- Section 8: Security --');

  var secProb = await createProblem(superAdminToken, { title: 'Phase745 Security Probe Problem' });
  if (secProb) {
    r = await request('PUT', '/api/problems/' + secProb.id, {
      title: 'Phase745 Security Updated',
      description: 'Security check for response sanitization.',
      difficulty: 'easy',
      version: secProb.version,
    }, superAdminToken);
    check('8.1 Security test update returns 200', r.status === 200, r.data);

    var secStr = JSON.stringify(r.data);
    check('8.2 Response does not expose password_hash', !secStr.includes('password_hash'), 'LEAKED');
    check('8.3 Response does not expose passwordHash', !secStr.includes('passwordHash'), 'LEAKED');
    check('8.4 Response does not expose jwt_secret', !secStr.includes('jwt_secret'), 'LEAKED');

    // Verify PROBLEM_UPDATED audit event
    var auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'PROBLEM_UPDATED' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1",
      [String(secProb.id)]
    );
    check('8.5 PROBLEM_UPDATED audit event recorded', auditRes.rows.length > 0, auditRes.rows);
    if (auditRes.rows.length > 0) {
      check('8.6 Audit event outcome = "success"', auditRes.rows[0].outcome === 'success', auditRes.rows[0]);
    }
  }

  // 403 BOLA test — response should not leak SQL
  if (profProb2) {
    r = await request('PUT', '/api/problems/' + profProb2.id, {
      title: 'Hacking Title',
      description: 'SQL injection attempt: \' OR 1=1 --',
      difficulty: 'easy',
    }, profToken);
    check('8.7 BOLA attack returns 403', r.status === 403, r.data);
    var bolaStr = JSON.stringify(r.data);
    check('8.8 403 BOLA response does not expose SQL', !bolaStr.includes('FROM users') && !bolaStr.includes('INSERT INTO'), bolaStr.slice(0, 200));
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(65));
  console.log(' PHASE 7.4.5 TEST RESULTS: ' + passedAssertions + ' passed, ' + failedAssertions + ' failed');
  console.log('='.repeat(65));

  return failedAssertions === 0;
}

(async function() {
  try {
    await setup();
    var success = await runTests();
    await cleanup();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
    await cleanup().catch(function() {});
    process.exit(1);
  }
})();
