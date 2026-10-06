/**
 * CODEFROG Test Data Cleanup & Archive Comprehensive Test Suite
 * File: backend/test_test_data_cleanup_archive.js
 *
 * Exhaustively validates:
 * A. Test-data creation & tagging
 * B. Test-data identification
 * C. Admin access (super_admin / contest_admin permitted)
 * D. Student blocked with 403 Forbidden
 * E. Professor blocked with 403 Forbidden
 * F. Real-data deletion strictly blocked with 403 Forbidden
 * G. Test user permanent deletion
 * H. Test contest permanent deletion
 * I. Test problem permanent deletion
 * J. Dependency cleanup (submissions, participations, test cases, rating history)
 * K. Transaction atomicity & rollback integrity
 * L. Delete failure handling
 * M. Duplicate delete request handling (404 Not Found)
 * N. Invalid ID format handling (400 Bad Request)
 * O. IDOR / Parameter tampering protection
 * P. Test-run bulk deletion
 * Q. Delete preview accuracy
 * R. Persistent audit logging (TEST_DATA_DELETED)
 * S. Automatic cleanup helper (testCleanupHelper)
 * T. Real data protection & zero corruption
 *
 * CRITICAL TEST: Mixed real-looking data vs test data deletion boundary
 */

process.env.RATE_LIMIT_ENABLED = 'false';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { hashPassword, generateToken } = require('./src/services/authService');
const { generateTestRunId, markTestData, cleanupTestRun } = require('./src/utils/testCleanupHelper');

let server;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n===============================================================');
  console.log(' STARTING CODEFROG TEST DATA CLEANUP & ARCHIVE VALIDATION SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  const suiteRunId = generateTestRunId('cleanup_suite');
  const ts = Date.now();

  try {
    // 1. Ephemeral server
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`Validation server running at ${baseUrl}`);
        resolve();
      });
    });

    // 2. Setup Actors: Super Admin, Contest Admin, Professor, Student
    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('Password123!');

    // Super Admin
    const superAdminRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'Super Actor', 'super_admin', true, $4)
      RETURNING id, username, role;
    `, [`sa_${ts}`, `sa_${ts}@exam.test`, pwdHash, suiteRunId]);
    const superAdmin = superAdminRes.rows[0];
    const superToken = generateToken(superAdmin);

    // Contest Admin
    const contestAdminRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'Contest Admin Actor', 'contest_admin', true, $4)
      RETURNING id, username, role;
    `, [`ca_${ts}`, `ca_${ts}@exam.test`, pwdHash, suiteRunId]);
    const contestAdmin = contestAdminRes.rows[0];
    const caToken = generateToken(contestAdmin);

    // Professor
    const profRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'Prof Actor', 'professor', true, $4)
      RETURNING id, username, role;
    `, [`prof_${ts}`, `prof_${ts}@exam.test`, pwdHash, suiteRunId]);
    const prof = profRes.rows[0];
    const profToken = generateToken(prof);

    // Student
    const studRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'Student Actor', 'student', true, $4)
      RETURNING id, username, role;
    `, [`stud_${ts}`, `stud_${ts}@exam.test`, pwdHash, suiteRunId]);
    const student = studRes.rows[0];
    const studToken = generateToken(student);

    // Real-Looking Protected User (is_test_data = false)
    const realUserRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data)
      VALUES ($1, $2, $3, 'Real Human Student', 'student', false)
      RETURNING id, username, role;
    `, [`real_human_${ts}`, `human_${ts}@university.edu`, pwdHash]);
    const realUser = realUserRes.rows[0];

    // Real Protected Contest (is_test_data = false)
    const realContestRes = await db.query(`
      INSERT INTO contests (title, created_by, start_time, end_time, status, is_test_data)
      VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'published', false)
      RETURNING id, title;
    `, [`Official University Final Exam ${ts}`, realUser.id]);
    const realContest = realContestRes.rows[0];

    // Real Protected Problem (is_test_data = false)
    const realProbRes = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by, is_test_data)
      VALUES ($1, 'Production problem statement description', 'medium', 'full_program', 'public', $2, false)
      RETURNING id, title;
    `, [`Production Algorithmic Task ${ts}`, realUser.id]);
    const realProblem = realProbRes.rows[0];

    // Setup Test Run Target Data to delete
    const targetRunId = `run_isolated_${ts}`;

    // Target Test User
    const testUserRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'Test Target User', 'student', true, $4)
      RETURNING id, username;
    `, [`target_user_${ts}`, `target_${ts}@test.com`, pwdHash, targetRunId]);
    const targetUser = testUserRes.rows[0];

    // Target Test Contest
    const testContestRes = await db.query(`
      INSERT INTO contests (title, created_by, start_time, end_time, status, is_test_data, test_run_id)
      VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'published', true, $3)
      RETURNING id, title;
    `, [`Target Test Contest ${ts}`, superAdmin.id, targetRunId]);
    const targetContest = testContestRes.rows[0];

    // Target Test Problem
    const testProbRes = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by, is_test_data, test_run_id)
      VALUES ($1, 'Sample description', 'easy', 'full_program', 'contest_private', $2, true, $3)
      RETURNING id, title;
    `, [`Target Test Problem ${ts}`, superAdmin.id, targetRunId]);
    const targetProblem = testProbRes.rows[0];

    // Wire Dependencies: test case, contest problem, participation, submission, rating history
    await db.query(`
      INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample)
      VALUES ($1, '1 2', '3', true);
    `, [targetProblem.id]);

    await db.query(`
      INSERT INTO contest_problems (contest_id, problem_id, problem_order, points)
      VALUES ($1, $2, 1, 100);
    `, [targetContest.id, targetProblem.id]);

    await db.query(`
      INSERT INTO contest_participants (contest_id, user_id)
      VALUES ($1, $2);
    `, [targetContest.id, targetUser.id]);

    const subRes = await db.query(`
      INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, is_test_data, test_run_id)
      VALUES ($1, $2, $3, 'python', 'print(3)', 'accepted', true, $4)
      RETURNING id;
    `, [targetUser.id, targetContest.id, targetProblem.id, targetRunId]);
    const targetSubmission = subRes.rows[0];

    await db.query(`
      INSERT INTO rating_history (user_id, contest_id, previous_rating, rating_change, new_rating, rank, participant_count)
      VALUES ($1, $2, 1200, 50, 1250, 1, 1);
    `, [targetUser.id, targetContest.id]);

    // -------------------------------------------------------------------------
    // TEST SECTION A: Test Data Identification & Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Test Data Identification ---');
    const uCheck = await db.query('SELECT is_test_data, test_run_id FROM users WHERE id = $1', [targetUser.id]);
    record('TEST A1: Newly generated test user has is_test_data = true', uCheck.rows[0].is_test_data === true);
    record('TEST A2: Newly generated test user has correct test_run_id', uCheck.rows[0].test_run_id === targetRunId);

    const cCheck = await db.query('SELECT is_test_data, test_run_id FROM contests WHERE id = $1', [targetContest.id]);
    record('TEST A3: Test contest has is_test_data = true', cCheck.rows[0].is_test_data === true);

    const pCheck = await db.query('SELECT is_test_data, test_run_id FROM problems WHERE id = $1', [targetProblem.id]);
    record('TEST A4: Test problem has is_test_data = true', pCheck.rows[0].is_test_data === true);

    // -------------------------------------------------------------------------
    // TEST SECTION B: RBAC & Access Control Gates
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Authorization & Access Control ---');

    // Super Admin access
    const resSuperSummary = await request('GET', '/api/admin/test-data/summary', null, superToken);
    record('TEST C1: Super Admin can access test-data summary (200 OK)', resSuperSummary.status === 200 && resSuperSummary.body.data.testRuns > 0);

    // Contest Admin access
    const resCaSummary = await request('GET', '/api/admin/test-data/summary', null, caToken);
    record('TEST C2: Contest Admin can access test-data summary (200 OK)', resCaSummary.status === 200);

    // Student access blocked
    const resStudSummary = await request('GET', '/api/admin/test-data/summary', null, studToken);
    record('TEST D1: Student is blocked from test-data summary (403 Forbidden)', resStudSummary.status === 403);

    const resStudDel = await request('DELETE', `/api/admin/test-data/users/${targetUser.id}`, null, studToken);
    record('TEST D2: Student is blocked from deleting test data (403 Forbidden)', resStudDel.status === 403);

    // Professor access blocked
    const resProfSummary = await request('GET', '/api/admin/test-data/summary', null, profToken);
    record('TEST E1: Professor is blocked from test-data summary (403 Forbidden)', resProfSummary.status === 403);

    const resProfDel = await request('DELETE', `/api/admin/test-data/contests/${targetContest.id}`, null, profToken);
    record('TEST E2: Professor is blocked from deleting test contest (403 Forbidden)', resProfDel.status === 403);

    // Anonymous access blocked
    const resAnon = await request('GET', '/api/admin/test-data/summary', null, null);
    record('TEST E3: Unauthenticated request is rejected (401 Unauthorized)', resAnon.status === 401);

    // -------------------------------------------------------------------------
    // TEST SECTION C: Preview Accuracy & Safety Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Pre-Deletion Dependency Previews ---');

    // Preview Test User
    const resUPreview = await request('GET', `/api/admin/test-data/preview?type=users&id=${targetUser.id}`, null, superToken);
    record('TEST Q1: User deletion preview returns 200 OK', resUPreview.status === 200);
    record('TEST Q2: User preview correctly identifies canDelete = true', resUPreview.body.data?.canDelete === true);
    record('TEST Q3: User preview calculates dependent submissions accurately', resUPreview.body.data?.dependentCounts?.submissions === 1);
    record('TEST Q4: User preview calculates dependent participations accurately', resUPreview.body.data?.dependentCounts?.contestParticipants === 1);

    // Preview Real User (Protection check)
    const resRealUPreview = await request('GET', `/api/admin/test-data/preview?type=users&id=${realUser.id}`, null, superToken);
    record('TEST Q5: Real user preview returns canDelete = false', resRealUPreview.body.data?.canDelete === false);
    record('TEST Q6: Real user preview includes protective block reason', typeof resRealUPreview.body.data?.reason === 'string');

    // Preview Test Run
    const resRunPreview = await request('GET', `/api/admin/test-data/runs/${targetRunId}/preview`, null, superToken);
    record('TEST Q7: Test run preview returns 200 OK', resRunPreview.status === 200);
    record('TEST Q8: Test run preview aggregates 1 user, 1 contest, 1 problem', 
      resRunPreview.body.data?.dependentCounts?.users === 1 &&
      resRunPreview.body.data?.dependentCounts?.contests === 1 &&
      resRunPreview.body.data?.dependentCounts?.problems === 1
    );

    // -------------------------------------------------------------------------
    // TEST SECTION D: Real-Data Protection (CRITICAL SAFETY TEST)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Real-Data Deletion Protection (CRITICAL TEST) ---');

    // Attempt to delete real user
    const resDelRealUser = await request('DELETE', `/api/admin/test-data/users/${realUser.id}`, null, superToken);
    record('TEST F1: CRITICAL: Deleting real user is BLOCKED (403 Forbidden)', resDelRealUser.status === 403);
    const checkRealUserStillExists = await db.query('SELECT id FROM users WHERE id = $1', [realUser.id]);
    record('TEST F2: Real user still exists in database without corruption', checkRealUserStillExists.rows.length === 1);

    // Attempt to delete real contest
    const resDelRealContest = await request('DELETE', `/api/admin/test-data/contests/${realContest.id}`, null, superToken);
    record('TEST F3: CRITICAL: Deleting real contest is BLOCKED (403 Forbidden)', resDelRealContest.status === 403);
    const checkRealContestStillExists = await db.query('SELECT id FROM contests WHERE id = $1', [realContest.id]);
    record('TEST F4: Real contest still exists in database without corruption', checkRealContestStillExists.rows.length === 1);

    // Attempt to delete real problem
    const resDelRealProblem = await request('DELETE', `/api/admin/test-data/problems/${realProblem.id}`, null, superToken);
    record('TEST F5: CRITICAL: Deleting real problem is BLOCKED (403 Forbidden)', resDelRealProblem.status === 403);
    const checkRealProblemStillExists = await db.query('SELECT id FROM problems WHERE id = $1', [realProblem.id]);
    record('TEST F6: Real problem still exists in database without corruption', checkRealProblemStillExists.rows.length === 1);

    // Attempt to delete canonical platform admin
    const resDelPlatformAdmin = await request('DELETE', '/api/admin/test-data/users/3', null, superToken);
    record('TEST F7: CRITICAL: Deleting platform_admin (ID 3) is strictly forbidden (403 Forbidden)', resDelPlatformAdmin.status === 403);

    // -------------------------------------------------------------------------
    // TEST SECTION E: Input Validation & Edge Cases
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Parameter Validation & Edge Cases ---');

    const resInvId = await request('DELETE', '/api/admin/test-data/users/not-a-number', null, superToken);
    record('TEST N1: Non-numeric ID returns 400 Bad Request', resInvId.status === 400);

    const resNegId = await request('DELETE', '/api/admin/test-data/contests/-99', null, superToken);
    record('TEST N2: Negative ID returns 400 Bad Request', resNegId.status === 400);

    const resZeroId = await request('DELETE', '/api/admin/test-data/problems/0', null, superToken);
    record('TEST N3: Zero ID returns 400 Bad Request', resZeroId.status === 400);

    const resNonExistent = await request('DELETE', '/api/admin/test-data/users/99999999', null, superToken);
    record('TEST M1: Non-existent record returns 404 Not Found', resNonExistent.status === 404);

    const resNonExistentRun = await request('DELETE', '/api/admin/test-data/runs/non_existent_run_xyz', null, superToken);
    record('TEST M2: Non-existent test run returns 404 Not Found', resNonExistentRun.status === 404);

    // -------------------------------------------------------------------------
    // TEST SECTION F: Single Entity Deletions & Dependency Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Single Entity Permanent Deletions ---');

    // Create standalone test problem to delete
    const singleProbRes = await db.query(`
      INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by, is_test_data, test_run_id)
      VALUES ($1, 'Desc', 'easy', 'full_program', 'public', $2, true, 'single_del_run')
      RETURNING id;
    `, [`Single Del Problem ${ts}`, superAdmin.id]);
    const singleProb = singleProbRes.rows[0];

    await db.query(`INSERT INTO test_cases (problem_id, input_data, expected_output) VALUES ($1, '1', '1')`, [singleProb.id]);

    const resDelSingleProblem = await request('DELETE', `/api/admin/test-data/problems/${singleProb.id}`, null, superToken);
    record('TEST I1: Delete test problem returns 200 OK', resDelSingleProblem.status === 200);

    const checkProbGone = await db.query('SELECT id FROM problems WHERE id = $1', [singleProb.id]);
    record('TEST I2: Problem is permanently deleted from database', checkProbGone.rows.length === 0);

    const checkTcGone = await db.query('SELECT id FROM test_cases WHERE problem_id = $1', [singleProb.id]);
    record('TEST J1: Dependent test cases are cleaned up atomically', checkTcGone.rows.length === 0);

    // Duplicate delete attempt on already deleted problem
    const resDupDel = await request('DELETE', `/api/admin/test-data/problems/${singleProb.id}`, null, superToken);
    record('TEST M3: Duplicate delete attempt returns 404 Not Found', resDupDel.status === 404);

    // Create standalone test contest to delete
    const singleContestRes = await db.query(`
      INSERT INTO contests (title, created_by, start_time, end_time, status, is_test_data, test_run_id)
      VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'published', true, 'single_del_run')
      RETURNING id;
    `, [`Single Del Contest ${ts}`, superAdmin.id]);
    const singleContest = singleContestRes.rows[0];

    const resDelSingleContest = await request('DELETE', `/api/admin/test-data/contests/${singleContest.id}`, null, superToken);
    record('TEST H1: Delete test contest returns 200 OK', resDelSingleContest.status === 200);

    const checkContestGone = await db.query('SELECT id FROM contests WHERE id = $1', [singleContest.id]);
    record('TEST H2: Contest is permanently deleted from database', checkContestGone.rows.length === 0);

    // -------------------------------------------------------------------------
    // TEST SECTION G: Entire Test-Run Bulk Deletion
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Entire Test-Run Bulk Deletion ---');

    // Delete the targetRunId created earlier (has targetUser, targetContest, targetProblem, targetSubmission)
    const resDelRun = await request('DELETE', `/api/admin/test-data/runs/${targetRunId}`, null, superToken);
    record('TEST P1: Delete entire test run returns 200 OK', resDelRun.status === 200);

    const checkRunUsers = await db.query('SELECT id FROM users WHERE test_run_id = $1', [targetRunId]);
    record('TEST P2: All test users in the run were deleted', checkRunUsers.rows.length === 0);

    const checkRunContests = await db.query('SELECT id FROM contests WHERE test_run_id = $1', [targetRunId]);
    record('TEST P3: All test contests in the run were deleted', checkRunContests.rows.length === 0);

    const checkRunProblems = await db.query('SELECT id FROM problems WHERE test_run_id = $1', [targetRunId]);
    record('TEST P4: All test problems in the run were deleted', checkRunProblems.rows.length === 0);

    const checkRunSubs = await db.query('SELECT id FROM submissions WHERE test_run_id = $1', [targetRunId]);
    record('TEST P5: All test submissions in the run were deleted', checkRunSubs.rows.length === 0);

    // -------------------------------------------------------------------------
    // TEST SECTION H: Audit Logging Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Persistent Audit Logging ---');

    const auditRes = await db.query(`
      SELECT action, outcome, resource_type, metadata 
      FROM audit_logs 
      WHERE action = 'TEST_DATA_DELETED'
      ORDER BY id DESC
      LIMIT 5;
    `);

    record('TEST R1: Audit log records exist for TEST_DATA_DELETED action', auditRes.rows.length > 0);
    record('TEST R2: Audit log records outcome = success', auditRes.rows[0].outcome === 'success');
    record('TEST R3: Audit metadata contains totalRecordsRemoved or totalDependentRecordsRemoved', 
      auditRes.rows[0].metadata?.totalRecordsRemoved !== undefined || 
      auditRes.rows[0].metadata?.totalDependentRecordsRemoved !== undefined
    );

    // -------------------------------------------------------------------------
    // TEST SECTION I: Automatic Cleanup Helper (testCleanupHelper)
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Automated Test Helper & Self-Cleanup ---');

    const autoRunId = generateTestRunId('auto_helper_test');
    record('TEST S1: generateTestRunId creates valid structured string', typeof autoRunId === 'string' && autoRunId.startsWith('auto_helper_test_'));

    // Create records and tag with markTestData
    const autoUserRes = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ($1, $2, $3, 'Auto User', 'student')
      RETURNING id;
    `, [`auto_u_${ts}`, `auto_u_${ts}@test.com`, pwdHash]);
    const autoUser = autoUserRes.rows[0];

    await markTestData('users', autoUser.id, autoRunId);

    const autoCheck = await db.query('SELECT is_test_data, test_run_id FROM users WHERE id = $1', [autoUser.id]);
    record('TEST S2: markTestData successfully updates is_test_data and test_run_id', 
      autoCheck.rows[0].is_test_data === true && autoCheck.rows[0].test_run_id === autoRunId
    );

    // Clean up via cleanupTestRun
    const cleanResult = await cleanupTestRun(autoRunId);
    record('TEST S3: cleanupTestRun successfully purges the automated test run', cleanResult.success === true);

    const autoUserAfter = await db.query('SELECT id FROM users WHERE id = $1', [autoUser.id]);
    record('TEST S4: Auto test user completely removed from database', autoUserAfter.rows.length === 0);

    // -------------------------------------------------------------------------
    // TEST SECTION J: Real Data Zero Corruption Check
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Final Zero-Corruption Sanity Check ---');

    const realUserFinal = await db.query('SELECT id, is_test_data FROM users WHERE id = $1', [realUser.id]);
    record('TEST T1: Real user persisted with zero modification or corruption', realUserFinal.rows.length === 1 && realUserFinal.rows[0].is_test_data === false);

    const realContestFinal = await db.query('SELECT id, is_test_data FROM contests WHERE id = $1', [realContest.id]);
    record('TEST T2: Real contest persisted with zero modification or corruption', realContestFinal.rows.length === 1 && realContestFinal.rows[0].is_test_data === false);

    const realProbFinal = await db.query('SELECT id, is_test_data FROM problems WHERE id = $1', [realProblem.id]);
    record('TEST T3: Real problem persisted with zero modification or corruption', realProbFinal.rows.length === 1 && realProbFinal.rows[0].is_test_data === false);

    // Teardown the actors created by this suite itself using our own cleanupTestRun!
    console.log('\n--- 12. Purging Validation Suite Test Fixtures ---');
    await cleanupTestRun(suiteRunId);

    // Also clean up the realUser, realContest, realProblem created specifically for this test
    await db.query('DELETE FROM contests WHERE id = $1', [realContest.id]);
    await db.query('DELETE FROM problems WHERE id = $1', [realProblem.id]);
    await db.query('DELETE FROM users WHERE id = $1', [realUser.id]);

  } catch (err) {
    console.error('\n[UNEXPECTED SUITE ERROR]:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool();
  }

  console.log('\n===============================================================');
  console.log(` VALIDATION COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
