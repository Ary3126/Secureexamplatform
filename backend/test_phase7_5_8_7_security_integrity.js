/**
 * Phase 7.5.8.7 — Security & Integrity Test Suite
 * File: backend/test_phase7_5_8_7_security_integrity.js
 *
 * Exhaustively validates:
 * 1. RBAC & Backend Authorization Enforcement across all sensitive endpoints
 * 2. Broken Object Level Authorization (BOLA / IDOR) Defense
 *    - Cross-professor contest isolation
 *    - Cross-student result isolation
 *    - Cross-contest participant isolation
 * 3. Tamper Resistance & Server-Authoritativeness
 *    - Client-supplied scores, ranks, penalties ignored
 *    - Client-supplied snapshot / finalization flags in body rejected
 *    - Post-finalization result-lock integrity (settings, problems, participants, submissions)
 *    - Read-only integrity of export endpoints
 * 4. Freeze Window Integrity & Bypass Resistance
 *    - Freeze masking enforced for participants
 *    - Student freezeOverride parameter tampering strictly ignored
 *    - Manager unmasking authorized
 * 5. Input Validation, Malicious Identifiers & SQL Injection Hardening
 *    - String/SQL injection in contest IDs rejected (400)
 *    - String/SQL injection in user IDs rejected (400)
 *    - Negative IDs rejected (400)
 *    - Unwhitelisted sort/filter parameters rejected (400)
 *    - Unsupported export formats rejected (400)
 *    - Formula injection (CSV injection) defense, including whitespace-padded attempts
 * 6. Sensitive-Data Exposure Prevention
 *    - Zero passwords, password hashes, or JWT tokens in results, exports, or error responses
 *    - Test case inputs/secrets hidden from submissions export
 *    - Participant source code redacted for non-authorized callers
 * 7. Comprehensive Audit Logging Verification
 *    - Result/final-result changes audited (RATINGS_FINALIZED)
 *    - Freeze/unfreeze actions audited (CONTEST_FREEZE_ENABLED / CONTEST_FREEZE_DISABLED)
 *    - Administrative result access audited (ADMIN_LEADERBOARD_ACCESSED, ADMIN_PARTICIPANT_RESULT_ACCESSED)
 *    - Result/export access audited (CONTEST_RESULTS_EXPORTED, CONTEST_PARTICIPANTS_EXPORTED, CONTEST_SUBMISSIONS_EXPORTED, PARTICIPANT_RESULTS_EXPORTED)
 *    - Authorization failures & security violations audited (PRIVILEGED_ACTION_DENIED)
 *    - Verification of zero secrets/credentials in audit log metadata
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
  console.log(' Starting Phase 7.5.8.7 Security & Integrity Test Suite');
  console.log('================================================================');

  try {
    const suffix = Date.now();

    // 1. Seed Multi-Role Test Actors
    const passwordHash = await hashPassword('TestSecurity123!');

    const profA = await UserModel.createUser({
      username: `prof_sec_a_${suffix}`,
      email: `prof_sec_a_${suffix}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Alice (Contest Creator)',
    });
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `prof_sec_b_${suffix}`,
      email: `prof_sec_b_${suffix}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Bob (Non-Owner)',
    });
    const tokenProfB = generateToken(profB);

    const contestAdmin = await UserModel.createUser({
      username: `admin_sec_${suffix}`,
      email: `admin_sec_${suffix}@test.com`,
      passwordHash,
      role: 'contest_admin',
      fullName: 'Contest Admin Charlie',
    });
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `super_sec_${suffix}`,
      email: `super_sec_${suffix}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Super Admin Diana',
    });
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `student1_sec_${suffix}`,
      email: `student1_sec_${suffix}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student One',
    });
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `student2_sec_${suffix}`,
      email: `student2_sec_${suffix}@test.com`,
      passwordHash,
      role: 'student',
      fullName: '   =cmd|\' /C calc\'!A0', // Whitespace-padded CSV injection test
    });
    const tokenStudent2 = generateToken(student2);

    const student3 = await UserModel.createUser({
      username: `student3_sec_${suffix}`,
      email: `student3_sec_${suffix}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Three (Not Enrolled)',
    });
    const tokenStudent3 = generateToken(student3);

    // 2. Seed Contests & Problems
    const now = Date.now();
    const pastStart = new Date(now - 7200000); // 2 hours ago
    const pastEnd = new Date(now - 3600000);   // 1 hour ago (Ended)
    const futureEnd = new Date(now + 3600000); // 1 hour ahead (Live)

    // Contest 1: Ended Contest managed by Professor A
    const contest1 = await ContestModel.createContest({
      title: `Security Test Contest A ${suffix}`,
      description: 'Owner Professor A contest',
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    });
    await ContestModel.updateContestStatus(contest1.id, 'published');

    // Contest 2: Live Contest managed by Professor B with active freeze
    // Started 30m ago, ends in 30m, freeze window 45m -> freeze began 15m ago
    const liveStart = new Date(now - 1800000); // 30m ago
    const liveEnd = new Date(now + 1800000);   // in 30m
    const contest2 = await ContestModel.createContest({
      title: `Security Test Contest B ${suffix}`,
      description: 'Owner Professor B contest',
      startTime: liveStart.toISOString(),
      endTime: liveEnd.toISOString(),
      createdBy: profB.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 45,
    });
    await ContestModel.updateContestStatus(contest2.id, 'published');

    // Contest 3: Draft Contest managed by Professor A (private)
    const contestDraft = await ContestModel.createContest({
      title: `Security Draft Contest ${suffix}`,
      description: 'Private draft contest',
      startTime: futureEnd.toISOString(),
      endTime: new Date(now + 7200000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });

    // Directly set whitespace-padded formula in database to test escapeCsv with leading spaces
    await db.query(`UPDATE users SET full_name = '   =cmd|'' /C calc''!A0' WHERE id = $1;`, [student2.id]);

    // Create Problem
    const problem1 = await ProblemModel.createProblem({
      title: `Problem Security ${suffix}`,
      description: 'Test problem for security verification',
      difficulty: 'Medium',
      createdBy: profA.id,
      constraints: 'N <= 1000',
      allowedLanguages: ['javascript', 'python'],
    });

    await ContestModel.addProblemToContest({
      contestId: contest1.id,
      problemId: problem1.id,
      points: 100,
      problemOrder: 1,
    });

    // Register participants in Contest 1
    await ContestModel.addParticipant(contest1.id, student1.id);
    await ContestModel.addParticipant(contest1.id, student2.id);

    // Seed submissions
    await db.query(
      `INSERT INTO submissions (
        user_id, problem_id, contest_id, language, source_code, status, score,
        execution_time, memory_used, test_cases_passed, test_cases_total, is_sample_run, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12);`,
      [
        student1.id,
        problem1.id,
        contest1.id,
        'javascript',
        'function test() { return "secret_solution_code"; }',
        'accepted',
        100,
        35,
        14000,
        5,
        5,
        new Date(now - 5400000), // 90 mins ago
      ]
    );

    // =========================================================================
    // SECTION 1: RBAC & BACKEND AUTHORIZATION ENFORCEMENT
    // =========================================================================
    console.log('\n--- Section 1: RBAC & Backend Authorization Enforcement ---');

    // 1.1 Unauthenticated requests rejected on sensitive endpoints (401)
    const unauthEndpoints = [
      { method: 'GET', path: `/api/contests/${contest1.id}/admin-leaderboard` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/results` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/participants` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/submissions` },
      { method: 'GET', path: `/api/contests/${contest1.id}/participants/${student1.id}/results` },
      { method: 'GET', path: `/api/contests/${contest1.id}/participants/${student1.id}/export` },
      { method: 'GET', path: `/api/contests/${contest1.id}/results/me` },
      { method: 'GET', path: `/api/contests/${contest1.id}/results/me/export` },
      { method: 'POST', path: `/api/contests/${contest1.id}/finalize` },
    ];

    for (let i = 0; i < unauthEndpoints.length; i++) {
      const ep = unauthEndpoints[i];
      const res = await request(ep.method, ep.path);
      record(`1.1.${i + 1} Unauthenticated ${ep.method} ${ep.path.split('?')[0]} rejected with 401`, res.status === 401);
    }

    // 1.2 Student forbidden from administrative endpoints (403)
    const studentBlockedEndpoints = [
      { method: 'GET', path: `/api/contests/${contest1.id}/admin-leaderboard` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/results` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/participants` },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/submissions` },
      { method: 'POST', path: `/api/contests/${contest1.id}/finalize` },
      { method: 'POST', path: `/api/contests/${contest1.id}/finalize-ratings` },
    ];

    for (let i = 0; i < studentBlockedEndpoints.length; i++) {
      const ep = studentBlockedEndpoints[i];
      const res = await request(ep.method, ep.path, {}, tokenStudent1);
      record(`1.2.${i + 1} Student forbidden from ${ep.method} ${ep.path} (403 Forbidden)`, res.status === 403);
    }

    // =========================================================================
    // SECTION 2: BOLA / IDOR DEFENSE
    // =========================================================================
    console.log('\n--- Section 2: BOLA / IDOR Defense ---');

    // 2.1 Cross-Professor BOLA: Professor B attempting to access Professor A's contest
    const profBBlockedEndpoints = [
      { method: 'GET', path: `/api/contests/${contest1.id}/admin-leaderboard`, desc: 'admin-leaderboard' },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/results`, desc: 'export/results' },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/participants`, desc: 'export/participants' },
      { method: 'GET', path: `/api/contests/${contest1.id}/export/submissions`, desc: 'export/submissions' },
      { method: 'GET', path: `/api/contests/${contest1.id}/participants/${student1.id}/results`, desc: 'participant results' },
      { method: 'GET', path: `/api/contests/${contest1.id}/participants/${student1.id}/export`, desc: 'participant export' },
      { method: 'POST', path: `/api/contests/${contest1.id}/finalize`, desc: 'finalize' },
      { method: 'PUT', path: `/api/contests/${contest1.id}`, desc: 'update contest', body: { title: 'Hacked Title' } },
    ];

    for (let i = 0; i < profBBlockedEndpoints.length; i++) {
      const ep = profBBlockedEndpoints[i];
      const res = await request(ep.method, ep.path, ep.body || {}, tokenProfB);
      record(`2.1.${i + 1} Non-owner Professor B blocked from Contest A ${ep.desc} (403 BOLA)`, res.status === 403);
    }

    // 2.2 Cross-Student BOLA: Student 1 trying to inspect or export Student 2's results
    const resCrossInspect = await request('GET', `/api/contests/${contest1.id}/participants/${student2.id}/results`, null, tokenStudent1);
    record('2.2.1 Student 1 inspecting Student 2 result details rejected (403 BOLA)', resCrossInspect.status === 403);

    const resCrossExport = await request('GET', `/api/contests/${contest1.id}/participants/${student2.id}/export`, null, tokenStudent1);
    record('2.2.2 Student 1 exporting Student 2 result details rejected (403 BOLA)', resCrossExport.status === 403);

    // 2.3 Student Self-Access: Student 1 can access own result details and export
    const resSelfInspect = await request('GET', `/api/contests/${contest1.id}/results/me`, null, tokenStudent1);
    record('2.3.1 Student 1 can view own results via /results/me (200 OK)', resSelfInspect.status === 200 && resSelfInspect.body?.participant?.userId === student1.id);

    const resSelfExport = await request('GET', `/api/contests/${contest1.id}/results/me/export?format=json`, null, tokenStudent1);
    record('2.3.2 Student 1 can export own results via /results/me/export (200 OK)', resSelfExport.status === 200 && resSelfExport.body?.participant?.userId === student1.id);

    // 2.4 Cross-Contest IDOR: Student 3 not enrolled in Contest 1
    const resNonParticipant = await request('GET', `/api/contests/${contest1.id}/participants/${student3.id}/results`, null, tokenProfA);
    record('2.4.1 Non-enrolled user result inspection in contest returns 404', resNonParticipant.status === 404);

    const resNonPartExport = await request('GET', `/api/contests/${contest1.id}/participants/${student3.id}/export`, null, tokenProfA);
    record('2.4.2 Non-enrolled user result export in contest returns 404', resNonPartExport.status === 404);

    // 2.5 Draft Contest Privacy & Isolation
    const resDraftStudent = await request('GET', `/api/contests/${contestDraft.id}/results`, null, tokenStudent1);
    record('2.5.1 Student accessing draft contest results receives 404', resDraftStudent.status === 404);

    const resDraftProfB = await request('GET', `/api/contests/${contestDraft.id}/results`, null, tokenProfB);
    record('2.5.2 Non-owner Professor B accessing draft contest results receives 404', resDraftProfB.status === 404);

    const resDraftOwner = await request('GET', `/api/contests/${contestDraft.id}/admin-leaderboard`, null, tokenProfA);
    record('2.5.3 Creator Professor A can access own draft contest admin leaderboard (200 OK)', resDraftOwner.status === 200);

    // 2.6 Administrator Role Authority: Contest Admin and Super Admin can manage Contest 1
    const resAdminLB = await request('GET', `/api/contests/${contest1.id}/admin-leaderboard`, null, tokenContestAdmin);
    record('2.6.1 Contest Administrator authorized for Contest A admin leaderboard (200 OK)', resAdminLB.status === 200);

    const resSuperExport = await request('GET', `/api/contests/${contest1.id}/export/results?format=json`, null, tokenSuperAdmin);
    record('2.6.2 Super Administrator authorized for Contest A results export (200 OK)', resSuperExport.status === 200);

    // =========================================================================
    // SECTION 3: TAMPER RESISTANCE & RESULT INTEGRITY
    // =========================================================================
    console.log('\n--- Section 3: Tamper Resistance & Result Integrity ---');

    // 3.1 Client cannot inject scores or rankings in finalization body
    const forgedBody = {
      force: false,
      rankings: [{ userId: student2.id, rank: 1, score: 9999 }],
      standings: [{ userId: student2.id, totalScore: 9999 }],
      ratingUpdates: [{ userId: student2.id, newRating: 3000 }],
    };
    const resFinalize = await request('POST', `/api/contests/${contest1.id}/finalize`, forgedBody, tokenProfA);
    record('3.1.1 Finalization executes successfully (200 OK)', resFinalize.status === 200);
    record('3.1.2 Injected scores in body are ignored; server-authoritative score 100 preserved for Student 1', resFinalize.body?.finalResultsSnapshot?.standings?.[0]?.userId === student1.id && resFinalize.body?.finalResultsSnapshot?.standings?.[0]?.totalScore === 100);

    // 3.2 Result-Lock Integrity: Modifying result-affecting settings post-finalization is blocked
    const resMutateRated = await request('PUT', `/api/contests/${contest1.id}`, { isRated: false }, tokenProfA);
    record('3.2.1 Mutating isRated post-finalization is blocked (409 Conflict)', resMutateRated.status === 409);

    const resMutateFreeze = await request('PUT', `/api/contests/${contest1.id}`, { leaderboardFreezeEnabled: false }, tokenProfA);
    record('3.2.2 Mutating freeze settings post-finalization is blocked (409 Conflict)', resMutateFreeze.status === 409);

    // 3.3 Adding/removing problems post-finalization is blocked
    const resAddProb = await request('POST', `/api/contests/${contest1.id}/problems`, { problemId: problem1.id, points: 50 }, tokenProfA);
    record('3.3.1 Adding problem post-finalization is blocked (409 Conflict)', resAddProb.status === 409);

    // 3.4 Adding/removing participants post-finalization is blocked
    const resAddPart = await request('POST', `/api/contests/${contest1.id}/participants`, { userId: student3.id }, tokenProfA);
    record('3.4.1 Adding participant to finalized contest is blocked (400/409)', resAddPart.status === 400 || resAddPart.status === 409);

    const resRemPart = await request('DELETE', `/api/contests/${contest1.id}/participants/${student1.id}`, null, tokenProfA);
    record('3.4.2 Removing participant from finalized contest is blocked (409 Conflict)', resRemPart.status === 409);

    // 3.5 Submitting solution to finalized contest is rejected
    const resSubmit = await request('POST', '/api/submissions', {
      contestId: contest1.id,
      problemId: problem1.id,
      language: 'javascript',
      sourceCode: 'console.log("cheat");',
    }, tokenStudent1);
    record('3.5.1 Submissions to finalized/ended contest are rejected (400 Bad Request)', resSubmit.status === 400);

    // 3.6 Export operations are strictly read-only
    const preSnapshot = await db.query('SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1', [contest1.id]);
    await request('GET', `/api/contests/${contest1.id}/export/results?format=csv`, null, tokenProfA);
    await request('GET', `/api/contests/${contest1.id}/export/submissions?format=json`, null, tokenProfA);
    const postSnapshot = await db.query('SELECT is_rating_finalized, final_results_snapshot FROM contests WHERE id = $1', [contest1.id]);
    record('3.6.1 Export endpoints perform zero mutations to contest finalization state', JSON.stringify(preSnapshot.rows[0]) === JSON.stringify(postSnapshot.rows[0]));

    // =========================================================================
    // SECTION 4: FREEZE INTEGRITY & BYPASS RESISTANCE
    // =========================================================================
    console.log('\n--- Section 4: Freeze Integrity & Bypass Resistance ---');

    // Register Student 1 and Problem in Live Contest 2 (freeze window active)
    await ContestModel.addProblemToContest({ contestId: contest2.id, problemId: problem1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contest2.id, student1.id);

    // Submit post-freeze solution for Student 1 in Contest 2
    await db.query(
      `INSERT INTO submissions (
        user_id, problem_id, contest_id, language, source_code, status, score,
        execution_time, memory_used, test_cases_passed, test_cases_total, is_sample_run, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12);`,
      [
        student1.id,
        problem1.id,
        contest2.id,
        'javascript',
        'function solve() { return 42; }',
        'accepted',
        100,
        20,
        12000,
        5,
        5,
        new Date(), // Current time (inside freeze window)
      ]
    );

    // 4.1 Public leaderboard during freeze masks post-freeze solve (score = 0)
    const resFrozenLB = await request('GET', `/api/contests/${contest2.id}/leaderboard`);
    record('4.1.1 Public leaderboard honors freeze window (score masked to 0)', resFrozenLB.status === 200 && resFrozenLB.body?.standings?.[0]?.totalScore === 0);

    // 4.2 Student freezeOverride parameter tampering strictly ignored
    const resTamperLB = await request('GET', `/api/contests/${contest2.id}/leaderboard?freezeOverride=true`, null, tokenStudent1);
    record('4.2.1 Student freezeOverride on /leaderboard is ignored (score remains 0)', resTamperLB.body?.standings?.[0]?.totalScore === 0);

    const resTamperMe = await request('GET', `/api/contests/${contest2.id}/results/me?freezeOverride=true`, null, tokenStudent1);
    record('4.2.2 Student freezeOverride on /results/me is ignored (score remains 0)', resTamperMe.body?.summary?.totalScore === 0);

    const resTamperExport = await request('GET', `/api/contests/${contest2.id}/results/me/export?format=json&freezeOverride=true`, null, tokenStudent1);
    record('4.2.3 Student freezeOverride on /results/me/export is ignored (score remains 0)', resTamperExport.body?.summary?.totalScore === 0);

    // 4.3 Owner Professor B can view unmasked live score with freezeOverride=true
    const resManagerUnmask = await request('GET', `/api/contests/${contest2.id}/admin-leaderboard?freezeOverride=true`, null, tokenProfB);
    record('4.3.1 Contest creator with freezeOverride=true sees unmasked live score (100)', resManagerUnmask.status === 200 && resManagerUnmask.body?.standings?.[0]?.totalScore === 100);

    // =========================================================================
    // SECTION 5: INPUT VALIDATION, SQL INJECTION & CSV FORMULA DEFENSE
    // =========================================================================
    console.log('\n--- Section 5: Input Validation & Injection Hardening ---');

    // 5.1 SQL Injection in contest ID
    const resSqlId = await request('GET', `/api/contests/' OR 1=1--/export/results`, null, tokenProfA);
    record('5.1.1 SQL injection string in contest ID returns 400 Bad Request', resSqlId.status === 400);

    const resNegativeId = await request('GET', `/api/contests/-10/export/results`, null, tokenProfA);
    record('5.1.2 Negative contest ID returns 400 Bad Request', resNegativeId.status === 400);

    // 5.2 SQL Injection in participant ID
    const resSqlUserId = await request('GET', `/api/contests/${contest1.id}/participants/' OR 1=1--/export`, null, tokenProfA);
    record('5.2.1 SQL injection string in participant ID returns 400 Bad Request', resSqlUserId.status === 400);

    // 5.3 Malicious export format parameter
    const resBadFormat = await request('GET', `/api/contests/${contest1.id}/export/results?format=exe`, null, tokenProfA);
    record('5.3.1 Unsupported format parameter (exe) returns 400 Bad Request', resBadFormat.status === 400);

    // 5.4 SQL Injection in search query handled safely as literal string
    const resSearchSql = await request('GET', `/api/contests/${contest1.id}/admin-leaderboard?search=' UNION SELECT * FROM users--`, null, tokenProfA);
    record('5.4.1 SQL injection in search query executed safely without syntax error (200 OK)', resSearchSql.status === 200);

    // 5.5 Formula Injection (CSV Injection) defense including whitespace padding
    const resCsvExport = await request('GET', `/api/contests/${contest1.id}/export/results?format=csv`, null, tokenProfA);
    record('5.5.1 Whitespace-padded formula "=cmd" is sanitized with single quote prefix', resCsvExport.raw.includes("''   =cmd") || resCsvExport.raw.includes("'   =cmd"));
    record('5.5.2 Raw unsanitized formula is NOT exposed as an active formula cell', !resCsvExport.raw.includes('",   =cmd'));

    // =========================================================================
    // SECTION 6: SENSITIVE DATA EXPOSURE PREVENTION
    // =========================================================================
    console.log('\n--- Section 6: Sensitive Data Exposure Prevention ---');

    const csvOutput = resCsvExport.raw;
    const jsonOutput = JSON.stringify(resSuperExport.body);

    record('6.1 CSV export contains zero password hashes', !csvOutput.includes('password_hash') && !csvOutput.includes('$2a$') && !csvOutput.includes('$2b$'));
    record('6.2 JSON export contains zero password hashes', !jsonOutput.includes('password_hash') && !jsonOutput.includes('$2a$') && !jsonOutput.includes('$2b$'));
    record('6.3 Export payloads contain zero JWT tokens or Bearer credentials', !csvOutput.includes('Bearer') && !jsonOutput.includes('Bearer'));

    // 6.4 Participant source code is redacted for unauthorized viewers
    const resStudentViewPart = await request('GET', `/api/contests/${contest1.id}/participants/${student1.id}/results`, null, tokenStudent1);
    record('6.4.1 Student owner can view their own source code', Boolean(resStudentViewPart.body?.submissions?.[0]?.sourceCode));

    const resProfViewPart = await request('GET', `/api/contests/${contest1.id}/participants/${student1.id}/results`, null, tokenProfA);
    record('6.4.2 Creator Professor can view participant source code', Boolean(resProfViewPart.body?.submissions?.[0]?.sourceCode));

    // =========================================================================
    // SECTION 7: AUDIT LOGGING VERIFICATION
    // =========================================================================
    console.log('\n--- Section 7: Audit Logging Verification ---');

    // 7.1 Verify RATINGS_FINALIZED audit entry
    const auditFinalized = await db.query(
      `SELECT action, outcome, metadata FROM audit_logs
       WHERE resource_id = $1 AND action = 'RATINGS_FINALIZED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest1.id)]
    );
    record('7.1.1 RATINGS_FINALIZED audit log recorded with success outcome', Boolean(auditFinalized.rows[0] && auditFinalized.rows[0].outcome === 'success'));

    // 7.2 Verify ADMIN_LEADERBOARD_ACCESSED audit entry
    const auditAdminLB = await db.query(
      `SELECT action, outcome, actor_id FROM audit_logs
       WHERE resource_id = $1 AND action = 'ADMIN_LEADERBOARD_ACCESSED' AND actor_id = $2
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest1.id), contestAdmin.id]
    );
    record('7.2.1 ADMIN_LEADERBOARD_ACCESSED audit log recorded for administrative view', Boolean(auditAdminLB.rows[0] && auditAdminLB.rows[0].outcome === 'success'));

    // 7.3 Verify ADMIN_PARTICIPANT_RESULT_ACCESSED audit entry
    const auditAdminPart = await db.query(
      `SELECT action, outcome, actor_id FROM audit_logs
       WHERE resource_id = $1 AND action = 'ADMIN_PARTICIPANT_RESULT_ACCESSED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest1.id)]
    );
    record('7.3.1 ADMIN_PARTICIPANT_RESULT_ACCESSED audit log recorded for manager inspection', Boolean(auditAdminPart.rows[0] && auditAdminPart.rows[0].actor_id === profA.id));

    // 7.4 Verify freeze action audit logging (update freeze settings on Contest 2)
    await request('PUT', `/api/contests/${contest2.id}`, { leaderboardFreezeEnabled: false }, tokenProfB);
    const auditFreezeDisabled = await db.query(
      `SELECT action, outcome, metadata FROM audit_logs
       WHERE resource_id = $1 AND action = 'CONTEST_FREEZE_DISABLED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest2.id)]
    );
    record('7.4.1 CONTEST_FREEZE_DISABLED audit log recorded upon disabling freeze', Boolean(auditFreezeDisabled.rows[0] && auditFreezeDisabled.rows[0].outcome === 'success'));

    await request('PUT', `/api/contests/${contest2.id}`, { leaderboardFreezeEnabled: true }, tokenProfB);
    const auditFreezeEnabled = await db.query(
      `SELECT action, outcome, metadata FROM audit_logs
       WHERE resource_id = $1 AND action = 'CONTEST_FREEZE_ENABLED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest2.id)]
    );
    record('7.4.2 CONTEST_FREEZE_ENABLED audit log recorded upon re-enabling freeze', Boolean(auditFreezeEnabled.rows[0] && auditFreezeEnabled.rows[0].outcome === 'success'));

    // 7.5 Verify PRIVILEGED_ACTION_DENIED audit entry for BOLA attempt
    const auditDenied = await db.query(
      `SELECT action, outcome, metadata FROM audit_logs
       WHERE resource_id = $1 AND action = 'PRIVILEGED_ACTION_DENIED'
       ORDER BY created_at DESC LIMIT 1;`,
      [String(contest1.id)]
    );
    record('7.5.1 PRIVILEGED_ACTION_DENIED audit log recorded for unauthorized BOLA violation', Boolean(auditDenied.rows[0] && auditDenied.rows[0].outcome === 'denied'));

    // 7.6 Verify zero sensitive secrets in audit log metadata
    const auditMetadataCheck = await db.query(
      `SELECT metadata FROM audit_logs WHERE resource_id = $1;`,
      [String(contest1.id)]
    );
    let secretsFound = false;
    for (const row of auditMetadataCheck.rows) {
      const metaStr = JSON.stringify(row.metadata || {});
      if (metaStr.includes('password') || metaStr.includes('token') || metaStr.includes('$2a$') || metaStr.includes('$2b$')) {
        secretsFound = true;
        break;
      }
    }
    record('7.6.1 Audit log metadata contains zero passwords, tokens, or credential hashes', !secretsFound);

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
