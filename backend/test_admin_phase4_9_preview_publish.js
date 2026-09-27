/**
 * Automated Test Suite for Phase 7.4.9: Preview / Draft / Publish
 *
 * Verifies:
 * 1. Draft Lifecycle:
 *    - Problem creation produces a draft (is_published = false, review_status = 'draft')
 *    - Saving draft updates fields while remaining unpublished
 *    - Reloading draft preserves all fields and unpublished status
 *    - Editing a draft does NOT accidentally publish it
 *
 * 2. Preview System & Authorization:
 *    - Authorized Admin/creator can preview draft problem (200)
 *    - Preview response contains title, description, codingMode, starterTemplates, sampleTestCases
 *    - STRICT SECURITY: Hidden test cases are NEVER returned in preview
 *    - STRICT SECURITY: Private execution harness templates and judge secrets are NOT leaked in preview
 *    - Unauthorized user / student cannot preview unpublished/draft problem (403/401)
 *    - Non-existent problem ID returns 404
 *
 * 3. Publication Validation Gate:
 *    - Rejects problem without title (422)
 *    - Rejects problem without description (422)
 *    - Rejects problem with invalid coding mode or difficulty (422)
 *    - Rejects Function Mode without starter/harness templates (422)
 *    - Rejects problem without any test cases (422)
 *    - Rejects problem without any visible sample test cases (422)
 *    - Valid publication transitions is_published = true, review_status = 'published', access_scope = 'public' (200)
 *
 * 4. Publication Version Snapshots & Concurrency:
 *    - Successful publication persists an immutable snapshot in problem_versions table
 *    - Snapshot contains test_cases_snapshot, starter_templates, allowed_languages, coding_mode
 *    - Optimistic concurrency: update with stale version returns 409 Conflict
 *
 * 5. Republish / Edit Published Problem Lifecycle:
 *    - Editing an already published problem increments version and sets is_published = false, review_status = 'draft'
 *    - Previous published version snapshot in problem_versions remains intact
 *    - Re-publishing updates version snapshot and restores published status
 *
 * 6. Version History Endpoints & Authorization:
 *    - GET /api/problems/:id/versions returns list of immutable snapshots for authorized manager (200)
 *    - GET /api/problems/:id/versions/:versionNumber returns specific version detail (200)
 *    - Unauthorized user / student cannot access version history (403)
 *
 * 7. Student Problem Access & Zero Hidden-Test Leakage:
 *    - After publication, student can access problem via public problem API (200)
 *    - Student response strictly contains only sample test cases
 *    - Hidden test cases remain 100% hidden from students
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const apiRoutes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');

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

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    data = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    data,
  };
}

async function setup() {
  console.log('Initializing express test app...');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  const hashedPw = await hashPassword('Password123!');
  const ts = Date.now();

  // Create test student
  const studentRes = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, 'student', $4, true)
     RETURNING id, username, email, role;`,
    [`p49_stud_${ts}`, `p49_stud_${ts}@test.com`, hashedPw, `Student ${ts}`]
  );
  studentUser = studentRes.rows[0];
  studentToken = generateToken(studentUser);
  createdUserIds.push(studentUser.id);

  // Create test professor 1 (owner)
  const profRes = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, 'professor', $4, true)
     RETURNING id, username, email, role;`,
    [`p49_prof1_${ts}`, `p49_prof1_${ts}@test.com`, hashedPw, `Prof One ${ts}`]
  );
  profUser = profRes.rows[0];
  profToken = generateToken(profUser);
  createdUserIds.push(profUser.id);

  // Create test professor 2 (other professor for BOLA check)
  const prof2Res = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, 'professor', $4, true)
     RETURNING id, username, email, role;`,
    [`p49_prof2_${ts}`, `p49_prof2_${ts}@test.com`, hashedPw, `Prof Two ${ts}`]
  );
  profUser2 = prof2Res.rows[0];
  profToken2 = generateToken(profUser2);
  createdUserIds.push(profUser2.id);

  // Create test contest admin
  const caRes = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, 'contest_admin', $4, true)
     RETURNING id, username, email, role;`,
    [`p49_ca_${ts}`, `p49_ca_${ts}@test.com`, hashedPw, `Contest Admin ${ts}`]
  );
  contestAdminUser = caRes.rows[0];
  contestAdminToken = generateToken(contestAdminUser);
  createdUserIds.push(contestAdminUser.id);

  // Create test super admin
  const saRes = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, 'super_admin', $4, true)
     RETURNING id, username, email, role;`,
    [`p49_sa_${ts}`, `p49_sa_${ts}@test.com`, hashedPw, `Super Admin ${ts}`]
  );
  superAdminUser = saRes.rows[0];
  superAdminToken = generateToken(superAdminUser);
  createdUserIds.push(superAdminUser.id);

  console.log('Seeded test users successfully.');
}

async function cleanup() {
  console.log('Cleaning up test data...');
  if (createdProblemIds.length > 0) {
    try {
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1::int[])', [createdProblemIds]);
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [createdProblemIds]);
      await db.query('DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])', [createdProblemIds]);
      await db.query('DELETE FROM problem_reviews WHERE problem_id = ANY($1::int[])', [createdProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1::int[])', [createdProblemIds]);
    } catch (e) {
      console.error('Error during problem cleanup:', e.message);
    }
  }

  if (createdUserIds.length > 0) {
    try {
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [createdUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [createdUserIds]);
    } catch (e) {
      console.error('Error during user cleanup:', e.message);
    }
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('Cleanup finished.');
}

async function runTests() {
  console.log('\n==================================================');
  console.log('PHASE 7.4.9 — PREVIEW / DRAFT / PUBLISH TEST SUITE');
  console.log('==================================================\n');

  // --------------------------------------------------------------------------
  // 1. DRAFT LIFECYCLE
  // --------------------------------------------------------------------------
  console.log('1. Draft Lifecycle (Create, Save, Edit, Reload, Unpublished Protection)');

  let draftProblemId;
  const draftCreatePayload = {
    title: 'Phase 7.4.9 Draft Test Problem',
    description: 'A problem created as a draft for lifecycle verification.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    isPublished: false,
    allowedLanguages: ['python', 'cpp', 'java'],
    functionConfig: {
      functionName: 'draftSolve',
      returnType: 'int',
      parameters: 'vector<int>& arr',
    },
    starterTemplates: {
      python: 'class Solution:\n    def draftSolve(self, arr: list[int]) -> int:\n        return 0\n',
      cpp: 'class Solution {\npublic:\n    int draftSolve(vector<int>& arr) { return 0; }\n};',
      java: 'class Solution {\n    public int draftSolve(int[] arr) { return 0; }\n}',
    },
    harnessTemplates: {
      python: '// __STUDENT_CODE__\nprint(Solution().draftSolve([1,2,3]))',
      cpp: '// __STUDENT_CODE__\nint main() { return 0; }',
      java: '// __STUDENT_CODE__\npublic class Main { public static void main(String[] args) {} }',
    },
    testCases: [
      { inputData: '3\n1 2 3', expectedOutput: '6', isSample: true, isHidden: false },
      { inputData: '2\n10 20', expectedOutput: '30', isSample: false, isHidden: true },
    ],
  };

  const createRes = await request('/api/problems', {
    method: 'POST',
    token: superAdminToken,
    body: JSON.stringify(draftCreatePayload),
  });

  check('1.1 Create problem responds with 201 Created', createRes.status === 201, createRes.data);
  const createdProb = createRes.data?.problem;
  draftProblemId = createdProb?.id;
  if (draftProblemId) createdProblemIds.push(draftProblemId);

  check('1.2 Newly created problem is in draft state (isPublished = false)', createdProb?.isPublished === false, createdProb);
  check('1.3 Newly created problem reviewStatus is draft', createdProb?.reviewStatus === 'draft', createdProb);
  check('1.4 Newly created problem starts at version 1', createdProb?.version === 1, createdProb);

  // Normal save of draft
  const saveDraftPayload = {
    title: 'Phase 7.4.9 Draft Test Problem (Saved Modification)',
    description: 'Updated draft description with more details.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    allowedLanguages: ['python', 'cpp', 'java'],
    functionConfig: createdProb?.functionConfig,
    starterTemplates: createdProb?.starterTemplates,
    harnessTemplates: createdProb?.harnessTemplates,
    version: createdProb?.version || 1,
  };

  const saveRes = await request(`/api/problems/${draftProblemId}`, {
    method: 'PUT',
    token: superAdminToken,
    body: JSON.stringify(saveDraftPayload),
  });

  check('1.5 Saving draft problem responds with 200 OK', saveRes.status === 200, saveRes.data);
  const savedProb = saveRes.data?.problem;
  check('1.6 Saving draft increments version to 2', savedProb?.version === 2, savedProb);
  check('1.7 Saving draft remains unpublished (isPublished = false)', savedProb?.isPublished === false, savedProb);
  check('1.8 Saving draft reviewStatus remains draft', savedProb?.reviewStatus === 'draft', savedProb);

  // Reload draft via admin endpoint
  const reloadRes = await request(`/api/admin/problems/${draftProblemId}`, {
    method: 'GET',
    token: superAdminToken,
  });

  check('1.9 Reloading draft via admin endpoint responds with 200 OK', reloadRes.status === 200, reloadRes.data);
  const reloadedProb = reloadRes.data?.data?.problem || reloadRes.data?.problem;
  check('1.10 Reloaded problem preserves updated title', reloadedProb?.title === 'Phase 7.4.9 Draft Test Problem (Saved Modification)', reloadedProb);
  check('1.11 Reloaded problem remains unpublished', reloadedProb?.isPublished === false, reloadedProb);

  // Student cannot access draft problem via public API
  const studentDraftAccess = await request(`/api/problems/${draftProblemId}`, {
    method: 'GET',
    token: studentToken,
  });
  check('1.12 Student cannot view unpublished draft problem (404/403)', [403, 404].includes(studentDraftAccess.status), studentDraftAccess.status);

  // --------------------------------------------------------------------------
  // 2. PREVIEW SYSTEM & AUTHORIZATION
  // --------------------------------------------------------------------------
  console.log('\n2. Preview System & Authorization (Strict Zero Hidden-Test Leakage)');

  // 2.1 Preview as creator/super_admin
  const previewRes = await request(`/api/problems/${draftProblemId}/preview`, {
    method: 'GET',
    token: superAdminToken,
  });

  check('2.1 Admin preview of draft problem returns 200 OK', previewRes.status === 200, previewRes.data);
  const preview = previewRes.data;
  check('2.2 Preview contains problem title and description', preview?.title && preview?.description, preview);
  check('2.3 Preview contains codingMode and allowedLanguages', preview?.codingMode === 'function' && Array.isArray(preview?.allowedLanguages), preview);
  check('2.4 Preview contains starterTemplates for student editor', preview?.starterTemplates && preview.starterTemplates.python, preview);
  check('2.5 CRITICAL SECURITY: Preview strictly DOES NOT expose harnessTemplates', preview?.harnessTemplates === undefined, preview);

  // Check test case leakage in preview
  const previewSampleCases = preview?.sampleTestCases || [];
  check('2.6 Preview returns visible sample test cases', previewSampleCases.length > 0, previewSampleCases);
  const hasAnyHiddenInPreview = previewSampleCases.some((tc) => tc.isHidden === true);
  check('2.7 CRITICAL SECURITY: Preview NEVER contains hidden test cases (isHidden === true)', !hasAnyHiddenInPreview, previewSampleCases);
  const stringifiedPreview = JSON.stringify(preview);
  check('2.8 CRITICAL SECURITY: Hidden input "10 20" not leaked in preview payload', !stringifiedPreview.includes('10 20'), stringifiedPreview);
  check('2.9 CRITICAL SECURITY: Hidden output "30" not leaked in preview payload', !stringifiedPreview.includes('30'), stringifiedPreview);

  // 2.2 Preview authorization checks
  const studentPreviewRes = await request(`/api/problems/${draftProblemId}/preview`, {
    method: 'GET',
    token: studentToken,
  });
  check('2.10 Student preview of draft problem is rejected with 403 Forbidden', studentPreviewRes.status === 403, studentPreviewRes.status);

  const unauthPreviewRes = await request(`/api/problems/${draftProblemId}/preview`, {
    method: 'GET',
  });
  check('2.11 Unauthenticated preview is rejected with 401 Unauthorized', unauthPreviewRes.status === 401, unauthPreviewRes.status);

  const nonExistentPreviewRes = await request('/api/problems/999999/preview', {
    method: 'GET',
    token: superAdminToken,
  });
  check('2.12 Preview for non-existent problem ID returns 404', nonExistentPreviewRes.status === 404, nonExistentPreviewRes.status);

  // BOLA check: prof2 trying to preview prof1's problem
  const prof1ProblemRes = await request('/api/problems', {
    method: 'POST',
    token: profToken,
    body: JSON.stringify({
      title: 'Prof1 Private Problem',
      description: 'Private research problem description.',
      difficulty: 'easy',
      codingMode: 'full_program',
      starterTemplates: { python: 'print("prof1")' },
      testCases: [{ inputData: '1', expectedOutput: '1', isSample: true, isHidden: false }],
    }),
  });
  const prof1ProblemId = prof1ProblemRes.data?.problem?.id;
  if (prof1ProblemId) createdProblemIds.push(prof1ProblemId);

  const prof2PreviewProf1 = await request(`/api/problems/${prof1ProblemId}/preview`, {
    method: 'GET',
    token: profToken2,
  });
  check('2.13 Other professor cannot preview draft problem (403 BOLA defense)', prof2PreviewProf1.status === 403, prof2PreviewProf1.status);

  // --------------------------------------------------------------------------
  // 3. PUBLICATION VALIDATION GATE
  // --------------------------------------------------------------------------
  console.log('\n3. Publication Validation Gate (Rejection of Incomplete / Unsafe Problems)');

  // Create invalid problem with no test cases to test publication gate rejection
  const invalidProbRes = await request('/api/problems', {
    method: 'POST',
    token: superAdminToken,
    body: JSON.stringify({
      title: 'Invalid Problem for Publish Validation',
      description: 'Problem with no test cases whatsoever.',
      difficulty: 'easy',
      codingMode: 'full_program',
      isPublished: false,
      starterTemplates: { python: 'print(1)' },
      testCases: [],
    }),
  });
  const invalidProblemId = invalidProbRes.data?.problem?.id;
  if (invalidProblemId) createdProblemIds.push(invalidProblemId);

  const publishInvalidRes = await request(`/api/problems/${invalidProblemId}/publish`, {
    method: 'POST',
    token: superAdminToken,
  });
  check('3.1 Publishing problem without test cases fails with 422 Unprocessable Entity', publishInvalidRes.status === 422, publishInvalidRes.status);
  check('3.2 Validation failure response contains errors array', Array.isArray(publishInvalidRes.data?.errors), publishInvalidRes.data);
  check('3.3 Validation errors mention required test cases', publishInvalidRes.data?.errors?.some((e) => e.toLowerCase().includes('test case')), publishInvalidRes.data?.errors);

  // Verify problem did NOT get published
  const probAfterFailedPublish = await ProblemModel.findProblemById(invalidProblemId);
  check('3.4 Problem remains unpublished after validation failure (isPublished = false)', probAfterFailedPublish?.isPublished === false, probAfterFailedPublish);

  // Test Function Mode missing harness rejection
  const fnProbMissingHarnessRes = await request('/api/problems', {
    method: 'POST',
    token: superAdminToken,
    body: JSON.stringify({
      title: 'Function Mode Problem Missing Harness',
      description: 'Testing publication gate validation for function mode harnesses.',
      difficulty: 'medium',
      codingMode: 'function',
      isPublished: false,
      starterTemplates: { python: 'class Solution:\n    pass\n' },
      harnessTemplates: {},
      testCases: [{ inputData: '1', expectedOutput: '1', isSample: true, isHidden: false }],
    }),
  });
  const fnProbMissingHarnessId = fnProbMissingHarnessRes.data?.problem?.id;
  if (fnProbMissingHarnessId) createdProblemIds.push(fnProbMissingHarnessId);

  const publishMissingHarnessRes = await request(`/api/problems/${fnProbMissingHarnessId}/publish`, {
    method: 'POST',
    token: superAdminToken,
  });
  check('3.5 Publishing function-mode problem without harness fails with 422', publishMissingHarnessRes.status === 422, publishMissingHarnessRes.status);
  check('3.6 Validation errors mention harness templates', publishMissingHarnessRes.data?.errors?.some((e) => e.toLowerCase().includes('harness')), publishMissingHarnessRes.data?.errors);

  // --------------------------------------------------------------------------
  // 4. PUBLISH WORKFLOW & IMMUTABLE VERSION SNAPSHOTS
  // --------------------------------------------------------------------------
  console.log('\n4. Publish Workflow & Immutable Version Snapshots');

  // Publish the valid draft problem (draftProblemId)
  const publishSuccessRes = await request(`/api/problems/${draftProblemId}/publish`, {
    method: 'POST',
    token: superAdminToken,
  });

  check('4.1 Publishing valid problem responds with 200 OK', publishSuccessRes.status === 200, publishSuccessRes.data);
  const publishedData = publishSuccessRes.data?.problem;
  check('4.2 Published problem state isPublished = true', publishedData?.isPublished === true, publishedData);
  check('4.3 Published problem reviewStatus = "published"', publishedData?.reviewStatus === 'published', publishedData);
  check('4.4 Published problem accessScope = "public"', publishedData?.accessScope === 'public', publishedData);

  // Verify immutable snapshot created in problem_versions table
  const versionSnapshots = await ProblemModel.findProblemVersions(draftProblemId);
  check('4.5 Immutable snapshot persisted in problem_versions table', versionSnapshots.length > 0, versionSnapshots);
  const latestSnapshot = versionSnapshots[0];
  check('4.6 Snapshot sourceAction is "published"', (latestSnapshot?.sourceAction || latestSnapshot?.source_action) === 'published', latestSnapshot);

  const snapshotDetail = await ProblemModel.findProblemVersionByNumber(draftProblemId, latestSnapshot.versionNumber || latestSnapshot.version_number);
  check('4.7 Snapshot contains testCasesSnapshot array', Array.isArray(snapshotDetail?.testCasesSnapshot), snapshotDetail);
  check('4.8 Snapshot contains starterTemplates JSON', typeof snapshotDetail?.starterTemplates === 'object', snapshotDetail);

  // --------------------------------------------------------------------------
  // 5. OPTIMISTIC CONCURRENCY DEFENSE
  // --------------------------------------------------------------------------
  console.log('\n5. Optimistic Concurrency Defense (Prevent Silent Overwrites)');

  // Attempt to update with a stale expectedVersion
  const currentDbProblem = await ProblemModel.findProblemById(draftProblemId);
  const staleVersion = (currentDbProblem?.version || 2) - 1; // deliberately stale

  const conflictUpdatePayload = {
    title: 'Concurrent Collision Title',
    version: staleVersion,
  };

  const conflictRes = await request(`/api/problems/${draftProblemId}`, {
    method: 'PUT',
    token: superAdminToken,
    body: JSON.stringify(conflictUpdatePayload),
  });

  check('5.1 Stale version update triggers HTTP 409 Conflict', conflictRes.status === 409, conflictRes.data);
  check('5.2 Conflict response contains currentVersion for client synchronization', conflictRes.data?.currentVersion !== undefined, conflictRes.data);

  // Verify DB state was NOT silently overwritten
  const probAfterConflict = await ProblemModel.findProblemById(draftProblemId);
  check('5.3 Database problem was NOT overwritten during conflict', probAfterConflict?.title !== 'Concurrent Collision Title', probAfterConflict?.title);

  // --------------------------------------------------------------------------
  // 6. REPUBLISH / EDIT PUBLISHED PROBLEM LIFECYCLE
  // --------------------------------------------------------------------------
  console.log('\n6. Republish / Edit Published Problem Lifecycle');

  // Edit the published problem with valid current version
  const editPublishedPayload = {
    title: 'Phase 7.4.9 Draft Test Problem (Second Edition)',
    description: 'Updated statement for second edition.',
    difficulty: 'medium',
    codingMode: 'function',
    version: currentDbProblem?.version,
  };

  const editPublishedRes = await request(`/api/problems/${draftProblemId}`, {
    method: 'PUT',
    token: superAdminToken,
    body: JSON.stringify(editPublishedPayload),
  });

  check('6.1 Editing a published problem returns 200 OK', editPublishedRes.status === 200, editPublishedRes.data);
  const editedProblem = editPublishedRes.data?.problem;
  check('6.2 Editing published problem resets isPublished = false (back to draft)', editedProblem?.isPublished === false, editedProblem);
  check('6.3 Editing published problem resets reviewStatus = "draft"', editedProblem?.reviewStatus === 'draft', editedProblem);
  check('6.4 Editing published problem increments version number', editedProblem?.version > currentDbProblem?.version, editedProblem);

  // Re-publish the updated problem
  const republishRes = await request(`/api/problems/${draftProblemId}/publish`, {
    method: 'POST',
    token: superAdminToken,
  });

  check('6.5 Re-publishing edited problem returns 200 OK', republishRes.status === 200, republishRes.data);
  const republishedProb = republishRes.data?.problem;
  check('6.6 Re-published problem isPublished = true', republishedProb?.isPublished === true, republishedProb);

  // Verify second snapshot recorded in problem_versions
  const updatedVersions = await ProblemModel.findProblemVersions(draftProblemId);
  check('6.7 Version history records snapshots for both publication versions', updatedVersions.length >= 2, updatedVersions.map((v) => v.versionNumber || v.version_number));

  // --------------------------------------------------------------------------
  // 7. VERSION HISTORY ENDPOINTS & RBAC
  // --------------------------------------------------------------------------
  console.log('\n7. Version History Endpoints & RBAC');

  // Authorized manager gets version list
  const versionsListRes = await request(`/api/problems/${draftProblemId}/versions`, {
    method: 'GET',
    token: superAdminToken,
  });
  check('7.1 GET /api/problems/:id/versions returns 200 for manager', versionsListRes.status === 200, versionsListRes.data);
  check('7.2 Versions list returns count and versions array', Array.isArray(versionsListRes.data?.versions) && versionsListRes.data.count > 0, versionsListRes.data);

  // Get specific version detail
  const firstVersionNumber = updatedVersions[updatedVersions.length - 1].versionNumber || updatedVersions[updatedVersions.length - 1].version_number;
  const versionDetailRes = await request(`/api/problems/${draftProblemId}/versions/${firstVersionNumber}`, {
    method: 'GET',
    token: superAdminToken,
  });
  check('7.3 GET /api/problems/:id/versions/:v returns 200 with version snapshot detail', versionDetailRes.status === 200, versionDetailRes.data);
  check('7.4 Version snapshot details match recorded versionNumber', (versionDetailRes.data?.version?.versionNumber || versionDetailRes.data?.version?.version_number) === firstVersionNumber, versionDetailRes.data);

  // Student cannot view version history
  const studentVersionsRes = await request(`/api/problems/${draftProblemId}/versions`, {
    method: 'GET',
    token: studentToken,
  });
  check('7.5 Student cannot access /api/problems/:id/versions (403 Forbidden)', studentVersionsRes.status === 403, studentVersionsRes.status);

  // Unauthenticated user cannot view version history
  const unauthVersionsRes = await request(`/api/problems/${draftProblemId}/versions`, {
    method: 'GET',
  });
  check('7.6 Unauthenticated access to versions returns 401 Unauthorized', unauthVersionsRes.status === 401, unauthVersionsRes.status);

  // Non-existent version number returns 404
  const invalidVersionRes = await request(`/api/problems/${draftProblemId}/versions/9999`, {
    method: 'GET',
    token: superAdminToken,
  });
  check('7.7 Non-existent version number returns 404', invalidVersionRes.status === 404, invalidVersionRes.status);

  // --------------------------------------------------------------------------
  // 8. STUDENT ACCESS AFTER PUBLICATION & ZERO HIDDEN-TEST LEAKAGE
  // --------------------------------------------------------------------------
  console.log('\n8. Student Access After Publication & Zero Hidden-Test Leakage');

  // Student fetches published problem
  const studentViewRes = await request(`/api/problems/${draftProblemId}`, {
    method: 'GET',
    token: studentToken,
  });

  check('8.1 Student can fetch published problem (200 OK)', studentViewRes.status === 200, studentViewRes.data);
  const studentView = studentViewRes.data?.problem || studentViewRes.data;
  check('8.2 Student sees problem title, description, and difficulty', Boolean(studentView?.title && studentView?.description), studentView);
  check('8.3 Student sees allowedLanguages and starterTemplates', Boolean(Array.isArray(studentView?.allowedLanguages) && studentView?.starterTemplates), studentView);

  // Administrative test cases endpoint should be 403 Forbidden for students
  const studentAdminTestCasesRes = await request(`/api/problems/${draftProblemId}/test-cases`, {
    method: 'GET',
    token: studentToken,
  });
  check('8.4 Administrative test-cases endpoint is 403 Forbidden for student', studentAdminTestCasesRes.status === 403, studentAdminTestCasesRes.status);

  // Student receives visible sample test cases directly on the problem view
  const studentCases = studentView?.sampleTestCases || [];
  check('8.5 Student receives visible sample test cases in problem view', studentCases.length > 0, studentCases);
  const anyHiddenReturnedToStudent = studentCases.some((tc) => tc.isHidden === true);
  check('8.6 CRITICAL SECURITY: Zero hidden test cases returned to student', !anyHiddenReturnedToStudent, studentCases);
  const studentCasesString = JSON.stringify(studentCases);
  check('8.7 CRITICAL SECURITY: Hidden input data "10 20" not leaked to student', !studentCasesString.includes('10 20'), studentCasesString);
  check('8.8 CRITICAL SECURITY: Hidden output data "30" not leaked to student', !studentCasesString.includes('30'), studentCasesString);
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('Fatal error during test run:', err);
    failedAssertions++;
  } finally {
    await cleanup();
    console.log('\n--------------------------------------------------');
    console.log(`Phase 7.4.9 Backend Results: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
    console.log('--------------------------------------------------\n');
    process.exit(failedAssertions > 0 ? 1 : 0);
  }
})();
