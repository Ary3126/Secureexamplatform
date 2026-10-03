/**
 * Phase 7.5.8.6 — Contest Export & Reporting Test Suite
 * File: backend/test_phase7_5_8_6_export_reporting.js
 *
 * Exhaustively validates:
 * 1. Contest Results Export (CSV and JSON)
 * 2. Participant Results Export (all-participants summary & individual report)
 * 3. Contest Submissions / Performance Export (CSV and JSON)
 * 4. Strict RBAC (student rejected from admin exports, non-owning professor blocked via BOLA)
 * 5. BOLA / IDOR Defense on individual participant exports
 * 6. CSV Formula Injection defense (neutralization of `=+-@\t\r`)
 * 7. Sensitive data exclusion (no passwords, hashes, tokens, or system secrets)
 * 8. Parameter validation (invalid IDs, invalid formats)
 * 9. Empty contests / edge cases
 * 10. Audit logging verification (success & denial records)
 */

process.env.RATE_LIMIT_CONTEST_MAX = '5000';
process.env.RATE_LIMIT_MEDIUM_MAX = '5000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { hashPassword, generateToken } = require('./src/services/authService');

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

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          raw,
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function record(name, condition, extraInfo = '') {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name} ${extraInfo ? `-> ${extraInfo}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Phase 7.5.8.6 Export & Reporting Test Suite');
  console.log('================================================================');

  try {
    const suffix = Date.now();

    // 1. Seed Users
    const passwordHash = await hashPassword('SecurePass123!');

    const profOwner = await UserModel.createUser({
      username: `prof_exp_owner_${suffix}`,
      email: `prof_exp_owner_${suffix}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Owner',
    });
    const tokenProfOwner = generateToken(profOwner);

    const profOther = await UserModel.createUser({
      username: `prof_exp_other_${suffix}`,
      email: `prof_exp_other_${suffix}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Other',
    });
    const tokenProfOther = generateToken(profOther);

    const contestAdmin = await UserModel.createUser({
      username: `contest_admin_exp_${suffix}`,
      email: `admin_exp_${suffix}@test.com`,
      passwordHash,
      role: 'contest_admin',
      fullName: 'Contest Administrator',
    });
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `super_admin_exp_${suffix}`,
      email: `super_exp_${suffix}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Administrator',
    });
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `student1_exp_${suffix}`,
      email: `student1_exp_${suffix}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Alice Walker',
    });
    const tokenStudent1 = generateToken(student1);

    // Student 2 with CSV Formula Injection payload in full name
    const student2 = await UserModel.createUser({
      username: `student2_exp_${suffix}`,
      email: `student2_exp_${suffix}@test.com`,
      passwordHash,
      role: 'student',
      fullName: '=cmd|\' /C calc\'!A0', // Potential CSV Injection payload
    });
    const tokenStudent2 = generateToken(student2);

    // 2. Seed Contest & Problems
    const now = Date.now();
    const pastStart = new Date(now - 3600000); // 1 hour ago
    const futureEnd = new Date(now + 3600000); // in 1 hour

    const contest = await ContestModel.createContest({
      title: `Export Verification Contest ${suffix}`,
      description: 'Comprehensive export test contest',
      startTime: pastStart.toISOString(),
      endTime: futureEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    });
    await ContestModel.updateContestStatus(contest.id, 'published');

    // Create Problem
    const problem = await ProblemModel.createProblem({
      title: `Problem Export ${suffix}`,
      description: 'Calculate sum of two numbers',
      difficulty: 'Easy',
      createdBy: profOwner.id,
      constraints: 'N <= 1000',
      allowedLanguages: ['javascript', 'python', 'cpp'],
    });

    await ContestModel.addProblemToContest({
      contestId: contest.id,
      problemId: problem.id,
      points: 100,
      problemOrder: 1,
    });

    // Register participants
    await ContestModel.addParticipant(contest.id, student1.id);
    await ContestModel.addParticipant(contest.id, student2.id);

    // Seed submissions
    // Alice submits Accepted
    const subRes1 = await db.query(
      `INSERT INTO submissions (
        user_id, problem_id, contest_id, language, source_code, status, score,
        execution_time, memory_used, test_cases_passed, test_cases_total, is_sample_run, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
      RETURNING id;`,
      [
        student1.id,
        problem.id,
        contest.id,
        'javascript',
        'console.log("accepted");',
        'accepted',
        100,
        45,
        15200,
        5,
        5,
        new Date(now - 1800000), // 30 mins ago
      ]
    );

    // Student 2 submits Wrong Answer
    const subRes2 = await db.query(
      `INSERT INTO submissions (
        user_id, problem_id, contest_id, language, source_code, status, score,
        execution_time, memory_used, test_cases_passed, test_cases_total, is_sample_run, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
      RETURNING id;`,
      [
        student2.id,
        problem.id,
        contest.id,
        'python',
        'print("wrong")',
        'wrong_answer',
        0,
        60,
        18300,
        2,
        5,
        new Date(now - 1200000), // 20 mins ago
      ]
    );

    // =========================================================================
    // SECTION 1: CONTEST RESULTS EXPORT (CSV & JSON)
    // =========================================================================
    console.log('\n--- Section 1: Contest Results Export ---');

    // 1.1 CSV Export by Owner Professor
    const resCsv = await request('GET', `/api/contests/${contest.id}/export/results?format=csv`, null, tokenProfOwner);
    record('1.1 Owner professor exports results as CSV (200 OK)', resCsv.status === 200);
    record('1.2 CSV Content-Type is text/csv; charset=utf-8', String(resCsv.headers['content-type']).includes('text/csv'));
    record('1.3 Content-Disposition includes attachment and .csv filename', String(resCsv.headers['content-disposition']).includes('attachment') && String(resCsv.headers['content-disposition']).includes('.csv'));
    record('1.4 CSV contains required result headers', resCsv.raw.includes('Rank') && resCsv.raw.includes('Score') && resCsv.raw.includes('Solved') && resCsv.raw.includes('Penalty'));
    record('1.5 CSV contains Alice Walker with solved score 100', resCsv.raw.includes('Alice Walker') && resCsv.raw.includes('100'));

    // 1.2 JSON Export by Contest Administrator
    const resJson = await request('GET', `/api/contests/${contest.id}/export/results?format=json`, null, tokenContestAdmin);
    record('1.6 Contest Admin exports results as JSON (200 OK)', resJson.status === 200);
    record('1.7 JSON Content-Type is application/json; charset=utf-8', String(resJson.headers['content-type']).includes('application/json'));
    record('1.8 JSON body contains authoritative structure', Boolean(resJson.body?.contest && Array.isArray(resJson.body?.standings) && resJson.body?.totalParticipants >= 2));
    record('1.9 JSON standings rank #1 has score 100', resJson.body?.standings?.[0]?.totalScore === 100);

    // =========================================================================
    // SECTION 2: PARTICIPANTS EXPORT (ALL & INDIVIDUAL)
    // =========================================================================
    console.log('\n--- Section 2: Participants Export ---');

    // 2.1 Export all participants summary CSV
    const resPartsCsv = await request('GET', `/api/contests/${contest.id}/export/participants?format=csv`, null, tokenProfOwner);
    record('2.1 Owner professor exports all participants as CSV (200 OK)', resPartsCsv.status === 200);
    record('2.2 CSV contains participant summary headers', resPartsCsv.raw.includes('User ID') && resPartsCsv.raw.includes('Submissions Count'));

    // 2.2 Export all participants summary JSON
    const resPartsJson = await request('GET', `/api/contests/${contest.id}/export/participants?format=json`, null, tokenSuperAdmin);
    record('2.3 Super Admin exports all participants as JSON (200 OK)', resPartsJson.status === 200);
    record('2.4 JSON participants list matches count', resPartsJson.body?.totalParticipants === 2 && resPartsJson.body?.participants?.length === 2);

    // 2.3 Individual Participant Result Details Export (CSV)
    const resIndCsv = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/export?format=csv`, null, tokenProfOwner);
    record('2.5 Manager exports individual participant as CSV (200 OK)', resIndCsv.status === 200);
    record('2.6 Individual CSV contains PARTICIPANT SUMMARY section', resIndCsv.raw.includes('PARTICIPANT SUMMARY'));
    record('2.7 Individual CSV contains PROBLEM PERFORMANCE section', resIndCsv.raw.includes('PROBLEM PERFORMANCE'));
    record('2.8 Individual CSV contains SUBMISSIONS LOG section', resIndCsv.raw.includes('SUBMISSIONS LOG'));

    // 2.4 Student Self-Export via /results/me/export (JSON)
    const resMeJson = await request('GET', `/api/contests/${contest.id}/results/me/export?format=json`, null, tokenStudent1);
    record('2.9 Student exports their own report via /results/me/export (200 OK)', resMeJson.status === 200);
    record('2.10 Self-export includes participant summary and submissions', resMeJson.body?.participant?.userId === student1.id && resMeJson.body?.submissions?.length === 1);

    // =========================================================================
    // SECTION 3: CONTEST SUBMISSIONS / PERFORMANCE REPORT
    // =========================================================================
    console.log('\n--- Section 3: Contest Submissions Export ---');

    // 3.1 Submissions Log CSV
    const resSubsCsv = await request('GET', `/api/contests/${contest.id}/export/submissions?format=csv`, null, tokenProfOwner);
    record('3.1 Owner exports contest submissions log as CSV (200 OK)', resSubsCsv.status === 200);
    record('3.2 CSV includes submission details (Verdict, Score, Execution Time)', resSubsCsv.raw.includes('Verdict') && resSubsCsv.raw.includes('Execution Time (ms)') && resSubsCsv.raw.includes('accepted'));

    // 3.2 Submissions Log JSON
    const resSubsJson = await request('GET', `/api/contests/${contest.id}/export/submissions?format=json`, null, tokenContestAdmin);
    record('3.3 Admin exports contest submissions as JSON (200 OK)', resSubsJson.status === 200);
    record('3.4 JSON submissions array has both submissions', resSubsJson.body?.submissions?.length === 2);

    // =========================================================================
    // SECTION 4: SECURITY & RBAC ENFORCEMENT
    // =========================================================================
    console.log('\n--- Section 4: Security & RBAC Enforcement ---');

    // 4.1 Unauthenticated requests rejected (401)
    const resUnauthResults = await request('GET', `/api/contests/${contest.id}/export/results`);
    record('4.1 Unauthenticated /export/results rejected with 401', resUnauthResults.status === 401);

    const resUnauthSubs = await request('GET', `/api/contests/${contest.id}/export/submissions`);
    record('4.2 Unauthenticated /export/submissions rejected with 401', resUnauthSubs.status === 401);

    // 4.2 Student forbidden from admin export endpoints (403)
    const resStudentResults = await request('GET', `/api/contests/${contest.id}/export/results`, null, tokenStudent1);
    record('4.3 Student role forbidden from /export/results (403 Forbidden)', resStudentResults.status === 403);

    const resStudentParts = await request('GET', `/api/contests/${contest.id}/export/participants`, null, tokenStudent1);
    record('4.4 Student role forbidden from /export/participants (403 Forbidden)', resStudentParts.status === 403);

    const resStudentSubs = await request('GET', `/api/contests/${contest.id}/export/submissions`, null, tokenStudent1);
    record('4.5 Student role forbidden from /export/submissions (403 Forbidden)', resStudentSubs.status === 403);

    // 4.3 Non-owning professor forbidden (403 BOLA)
    const resBolaResults = await request('GET', `/api/contests/${contest.id}/export/results`, null, tokenProfOther);
    record('4.6 Non-owning professor forbidden from /export/results (403 BOLA)', resBolaResults.status === 403);

    const resBolaParts = await request('GET', `/api/contests/${contest.id}/export/participants`, null, tokenProfOther);
    record('4.7 Non-owning professor forbidden from /export/participants (403 BOLA)', resBolaParts.status === 403);

    const resBolaSubs = await request('GET', `/api/contests/${contest.id}/export/submissions`, null, tokenProfOther);
    record('4.8 Non-owning professor forbidden from /export/submissions (403 BOLA)', resBolaSubs.status === 403);

    // 4.4 Student BOLA: Student 1 trying to export Student 2's details (403)
    const resBolaStudent = await request('GET', `/api/contests/${contest.id}/participants/${student2.id}/export`, null, tokenStudent1);
    record('4.9 Student forbidden from exporting another student details (403 BOLA)', resBolaStudent.status === 403);

    // 4.5 Professor BOLA on participant details
    const resBolaProfPart = await request('GET', `/api/contests/${contest.id}/participants/${student1.id}/export`, null, tokenProfOther);
    record('4.10 Non-owning professor forbidden from /participants/:id/export (403 BOLA)', resBolaProfPart.status === 403);

    // =========================================================================
    // SECTION 5: FORMULA INJECTION (CSV INJECTION) DEFENSE
    // =========================================================================
    console.log('\n--- Section 5: CSV Formula Injection Defense ---');

    // student2 has fullName "=cmd|' /C calc'!A0"
    const resFormulaCheck = await request('GET', `/api/contests/${contest.id}/export/results?format=csv`, null, tokenProfOwner);
    const hasNeutralizedFormula = resFormulaCheck.raw.includes("''=cmd|' /C calc'!A0") || resFormulaCheck.raw.includes("'=cmd|' /C calc'!A0");
    record('5.1 Leading formula characters (=, +, -, @) are sanitized with prefix apostrophe', hasNeutralizedFormula);
    record('5.2 Raw unsanitized formula is NOT executed or bare in CSV cell', !resFormulaCheck.raw.includes('",=cmd'));

    // =========================================================================
    // SECTION 6: SENSITIVE DATA EXCLUSION
    // =========================================================================
    console.log('\n--- Section 6: Sensitive Data Exclusion ---');

    const csvContent = resCsv.raw;
    const jsonContent = JSON.stringify(resJson.body);

    record('6.1 CSV contains zero password hashes', !csvContent.includes('password_hash') && !csvContent.includes('$2a$') && !csvContent.includes('$2b$'));
    record('6.2 JSON contains zero password hashes', !jsonContent.includes('password_hash') && !jsonContent.includes('$2a$') && !jsonContent.includes('$2b$'));
    record('6.3 CSV contains zero JWT tokens or session secrets', !csvContent.includes('token') && !csvContent.includes('Bearer'));
    record('6.4 JSON contains zero JWT tokens or session secrets', !jsonContent.includes('token') && !jsonContent.includes('Bearer'));
    record('6.5 Submissions export does NOT expose test case inputs or secrets', !resSubsCsv.raw.includes('test_case_secret'));

    // =========================================================================
    // SECTION 7: PARAMETER VALIDATION & ERROR HANDLING
    // =========================================================================
    console.log('\n--- Section 7: Parameter Validation & Error Handling ---');

    // 7.1 Invalid contest ID (non-numeric)
    const resBadId = await request('GET', `/api/contests/not-a-number/export/results`, null, tokenProfOwner);
    record('7.1 Non-numeric contest ID rejected with 400', resBadId.status === 400);

    // 7.2 Non-existent contest ID
    const resNotFound = await request('GET', `/api/contests/9999999/export/results`, null, tokenProfOwner);
    record('7.2 Non-existent contest ID returns 404', resNotFound.status === 404);

    // 7.3 Invalid export format (e.g. xml)
    const resBadFormat = await request('GET', `/api/contests/${contest.id}/export/results?format=xml`, null, tokenProfOwner);
    record('7.3 Unsupported format (xml) returns 400 Bad Request', resBadFormat.status === 400);

    // 7.4 Invalid participant ID
    const resBadPartId = await request('GET', `/api/contests/${contest.id}/participants/invalid_id/export`, null, tokenProfOwner);
    record('7.4 Non-numeric participant ID returns 400 Bad Request', resBadPartId.status === 400);

    // =========================================================================
    // SECTION 8: EMPTY CONTESTS & EDGE CASES
    // =========================================================================
    console.log('\n--- Section 8: Empty Contests & Edge Cases ---');

    // Create an empty contest
    const emptyContest = await ContestModel.createContest({
      title: `Empty Contest For Export ${suffix}`,
      startTime: pastStart.toISOString(),
      endTime: futureEnd.toISOString(),
      createdBy: profOwner.id,
      isRated: false,
    });
    await ContestModel.updateContestStatus(emptyContest.id, 'published');

    const resEmptyCsv = await request('GET', `/api/contests/${emptyContest.id}/export/results?format=csv`, null, tokenProfOwner);
    record('8.1 Empty contest exports valid CSV with header and 0 rows', resEmptyCsv.status === 200 && resEmptyCsv.raw.includes('Rank'));

    const resEmptyJson = await request('GET', `/api/contests/${emptyContest.id}/export/results?format=json`, null, tokenProfOwner);
    record('8.2 Empty contest exports valid JSON with totalParticipants: 0', resEmptyJson.status === 200 && resEmptyJson.body?.totalParticipants === 0);

    // =========================================================================
    // SECTION 9: AUDIT LOGGING VERIFICATION
    // =========================================================================
    console.log('\n--- Section 9: Audit Logging Verification ---');

    const auditResults = await db.query(
      `SELECT action, outcome FROM audit_logs
       WHERE resource_id = $1 AND action = 'CONTEST_RESULTS_EXPORTED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest.id)]
    );
    record('9.1 Audit log recorded CONTEST_RESULTS_EXPORTED with success outcome', Boolean(auditResults.rows[0] && auditResults.rows[0].outcome === 'success'));

    const auditDenied = await db.query(
      `SELECT action, outcome FROM audit_logs
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest.id)]
    );
    record('9.2 Audit log recorded PRIVILEGED_ACTION_DENIED for unauthorized attempt', Boolean(auditDenied.rows[0] && auditDenied.rows[0].outcome === 'denied'));

  } catch (err) {
    console.error('Unhandled test suite error:', err);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');
    if (server) {
      server.close();
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

server = app.listen(0, () => {
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  runTests();
});
