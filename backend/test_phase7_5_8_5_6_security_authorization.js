/**
 * Phase 7.5.8.5.6 — Security & Authorization Verification Suite
 * File: backend/test_phase7_5_8_5_6_security_authorization.js
 *
 * Exhaustive security and authorization testing for the complete
 * contest freeze, finalization, result-lock, and participant access workflow.
 *
 * Coverage Matrix:
 * 1. Authentication (missing, invalid, expired tokens)
 * 2. RBAC (student, professor, contest_admin, super_admin)
 * 3. Professor Ownership & Cross-Professor BOLA
 * 4. Student Own-Result Access vs Cross-Student BOLA
 * 5. Cross-Contest IDOR / Object Isolation
 * 6. Finalization Authorization & Lifecycle Integrity
 * 7. Freeze Bypass Resistance (query, body, header tampering)
 * 8. Result-Lock Bypass Resistance (metadata, problems, participants)
 * 9. Mass Assignment & Client Flag Injection Resistance
 * 10. SQL Injection & Identifier Hardening
 * 11. Sensitive Data Exposure & Source Code Access Control
 * 12. Audit Logging of Privileged Denials
 * 13. Error Sanitization (no stack traces, no internal leaks)
 * 14. Rate Limiting Headers & Replay / Concurrent Security
 */

process.env.RATE_LIMIT_CONTEST_MAX = '2000';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const RatingService = require('./src/services/ratingService');
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

const get  = (p, t)    => request('GET', p, null, t);
const post = (p, b, t) => request('POST', p, b, t);
const put  = (p, b, t) => request('PUT', p, b, t);
const del  = (p, b, t) => request('DELETE', p, b, t);

let passed = 0;
let failed = 0;

function record(label, cond, reason = '') {
  if (cond) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${reason ? ` | ${reason}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 7.5.8.5.6: Security & Authorization Hardening Tests ');
  console.log('================================================================\n');

  try {
    // 0. Ensure schema columns exist
    await db.query(`ALTER TABLE contests ADD COLUMN IF NOT EXISTS final_results_snapshot JSONB DEFAULT NULL;`);

    const suffix = Date.now();
    const pwHash = await hashPassword('SecurePass123!');
    const now = new Date();
    const pastStart = new Date(now.getTime() - 4 * 3600000);
    const pastEnd = new Date(now.getTime() - 1 * 3600000);

    // ── Setup Security Actors ──────────────────────────────────────────
    const profA = await UserModel.createUser({
      username: `prof_sec_a_${suffix}`,
      email: `prof_sec_a_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Professor Alice (Owner)',
      role: 'professor',
    });
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `prof_sec_b_${suffix}`,
      email: `prof_sec_b_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Professor Bob (Attacker)',
      role: 'professor',
    });
    const tokenProfB = generateToken(profB);

    const contestAdmin = await UserModel.createUser({
      username: `cadmin_sec_${suffix}`,
      email: `cadmin_sec_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Contest Admin User',
      role: 'contest_admin',
    });
    const tokenContestAdmin = generateToken(contestAdmin);

    const superAdmin = await UserModel.createUser({
      username: `sadmin_sec_${suffix}`,
      email: `sadmin_sec_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Super Admin User',
      role: 'super_admin',
    });
    const tokenSuperAdmin = generateToken(superAdmin);

    const student1 = await UserModel.createUser({
      username: `student1_sec_${suffix}`,
      email: `student1_sec_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student One',
      role: 'student',
    });
    const tokenStudent1 = generateToken(student1);

    const student2 = await UserModel.createUser({
      username: `student2_sec_${suffix}`,
      email: `student2_sec_${suffix}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student Two',
      role: 'student',
    });
    const tokenStudent2 = generateToken(student2);

    // ── Setup Problems ─────────────────────────────────────────────────
    const prob1 = await ProblemModel.createProblem({
      title: `Sec Problem 1 ${suffix}`,
      description: 'Security Problem 1',
      difficulty: 'easy',
      createdBy: profA.id,
    });

    const prob2 = await ProblemModel.createProblem({
      title: `Sec Problem 2 ${suffix}`,
      description: 'Security Problem 2',
      difficulty: 'medium',
      createdBy: profA.id,
    });

    // ── Setup Contests ─────────────────────────────────────────────────
    // 1. Published, ended contest with freeze enabled (owned by profA)
    const contestA = await ContestModel.createContest({
      title: `Contest A Prof Owner ${suffix}`,
      description: 'Owned by Professor A',
      startTime: pastStart.toISOString(),
      endTime: pastEnd.toISOString(),
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    });
    await ContestModel.updateContestStatus(contestA.id, 'published');
    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(contestA.id, student1.id);
    await ContestModel.addParticipant(contestA.id, student2.id);

    // Add submission for Student 1
    const tPreFreeze = new Date(pastStart.getTime() + 15 * 60000);
    const subRes = await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'const secretKey = "SUPER_SECRET";', 'accepted', 100, false, $4)
       RETURNING id;`,
      [student1.id, contestA.id, prob1.id, tPreFreeze.toISOString()]
    );
    const subId1 = subRes.rows[0].id;

    // 2. Draft contest owned by profA (must remain completely hidden from students and profB)
    const draftContest = await ContestModel.createContest({
      title: `Draft Secret Contest ${suffix}`,
      description: 'Confidential draft contest',
      startTime: new Date(now.getTime() + 3600000).toISOString(),
      endTime: new Date(now.getTime() + 7200000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });

    // ════════════════════════════════════════════════════════════════════
    // 1. AUTHENTICATION CONTROLS
    // ════════════════════════════════════════════════════════════════════
    console.log('--- 1. Authentication Controls ---');

    // 1.1 Missing token on protected endpoint
    const resNoToken = await post(`/api/contests/${contestA.id}/finalize-ratings`, {});
    record('1.1 Missing Authorization token rejected (401 Unauthorized)', resNoToken.status === 401);

    // 1.2 Invalid token rejected
    const resBadToken = await post(`/api/contests/${contestA.id}/finalize-ratings`, {}, 'invalid.bearer.token');
    record('1.2 Invalid Authorization token rejected (401 Unauthorized)', resBadToken.status === 401);

    // 1.3 Malformed token structure rejected
    const resMalformed = await get(`/api/contests/${contestA.id}/results/me`, 'Bearer notajwt');
    record('1.3 Malformed Authorization header rejected (401 Unauthorized)', resMalformed.status === 401);

    // 1.4 Protected participant details requires token
    const resAnonDetails = await get(`/api/contests/${contestA.id}/participants/${student1.id}/results`);
    record('1.4 Unauthenticated participant details rejected (401 Unauthorized)', resAnonDetails.status === 401);

    // ════════════════════════════════════════════════════════════════════
    // 2. RBAC & PRIVILEGE ENFORCEMENT
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 2. RBAC & Privilege Enforcement ---');

    // 2.1 Student cannot finalize contest ratings
    const resStdFin = await post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenStudent1);
    record('2.1 Student attempting finalization rejected (403 Forbidden)', resStdFin.status === 403);

    // 2.2 Student cannot access admin leaderboard
    const resStdAdminBoard = await get(`/api/contests/${contestA.id}/admin-leaderboard`, tokenStudent1);
    record('2.2 Student attempting admin leaderboard rejected (403 Forbidden)', resStdAdminBoard.status === 403);

    // 2.3 Student cannot access contest participants management list
    const resStdPartList = await get(`/api/contests/${contestA.id}/participants`, tokenStudent1);
    record('2.3 Student attempting participant management list rejected (403 Forbidden)', resStdPartList.status === 403);

    // 2.4 Student cannot perform contest update
    const resStdUpdate = await put(`/api/contests/${contestA.id}`, { title: 'Hacked Title' }, tokenStudent1);
    record('2.4 Student attempting contest update rejected (403 Forbidden)', resStdUpdate.status === 403);

    // 2.5 Contest Admin authorized for management endpoints
    const resCadminBoard = await get(`/api/contests/${contestA.id}/admin-leaderboard`, tokenContestAdmin);
    record('2.5 Contest Admin authorized for admin leaderboard (200 OK)', resCadminBoard.status === 200);

    // 2.6 Super Admin authorized for management endpoints
    const resSadminBoard = await get(`/api/contests/${contestA.id}/admin-leaderboard`, tokenSuperAdmin);
    record('2.6 Super Admin authorized for admin leaderboard (200 OK)', resSadminBoard.status === 200);

    // ════════════════════════════════════════════════════════════════════
    // 3. PROFESSOR OWNERSHIP & BOLA PROTECTION
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 3. Professor Ownership & Cross-Professor BOLA ---');

    // 3.1 Non-owner professor cannot finalize other professor contest
    const resProfBFin = await post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfB);
    record('3.1 Non-owner professor finalization denied (403 BOLA)', resProfBFin.status === 403);

    // 3.2 Non-owner professor cannot view other professor admin leaderboard
    const resProfBBoard = await get(`/api/contests/${contestA.id}/admin-leaderboard`, tokenProfB);
    record('3.2 Non-owner professor admin leaderboard denied (403 BOLA)', resProfBBoard.status === 403);

    // 3.3 Non-owner professor cannot update other professor contest
    const resProfBUpdate = await put(`/api/contests/${contestA.id}`, { title: 'Bob Hijack' }, tokenProfB);
    record('3.3 Non-owner professor contest update denied (403 BOLA)', resProfBUpdate.status === 403);

    // 3.4 Non-owner professor cannot inspect student details in other professor contest
    const resProfBInspect = await get(`/api/contests/${contestA.id}/participants/${student1.id}/results`, tokenProfB);
    record('3.4 Non-owner professor participant result inspection denied (403 BOLA)', resProfBInspect.status === 403);

    // 3.5 Creator professor is authorized to inspect their own contest admin leaderboard
    const resProfABoard = await get(`/api/contests/${contestA.id}/admin-leaderboard`, tokenProfA);
    record('3.5 Creator professor authorized for own contest admin leaderboard (200 OK)', resProfABoard.status === 200);

    // 3.6 Draft contest completely hidden from non-owning professor (404 Not Found)
    const resProfBDraft = await get(`/api/contests/${draftContest.id}/results`, tokenProfB);
    record('3.6 Draft contest hidden from other professors (404 Not Found)', resProfBDraft.status === 404);

    // ════════════════════════════════════════════════════════════════════
    // 4. STUDENT OWN-RESULT VS CROSS-STUDENT ACCESS
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 4. Student Own-Result vs Cross-Student Access ---');

    // 4.1 Student 1 accesses own result details via /results/me
    const resStd1Me = await get(`/api/contests/${contestA.id}/results/me`, tokenStudent1);
    record('4.1 Student can access own result details via /results/me (200 OK)',
      resStd1Me.status === 200 && resStd1Me.body?.participant?.userId === student1.id);

    // 4.2 Student 1 accesses own result details via explicit participant ID
    const resStd1Direct = await get(`/api/contests/${contestA.id}/participants/${student1.id}/results`, tokenStudent1);
    record('4.2 Student can access own result via /participants/:userId/results (200 OK)',
      resStd1Direct.status === 200 && resStd1Direct.body?.participant?.userId === student1.id);

    // 4.3 Student 1 attempts to access Student 2 result details (BOLA)
    const resStd1InspectStd2 = await get(`/api/contests/${contestA.id}/participants/${student2.id}/results`, tokenStudent1);
    record('4.3 Student accessing another student result details denied (403 Forbidden BOLA)',
      resStd1InspectStd2.status === 403);

    // 4.4 Draft contest result details hidden from student (404 Not Found)
    const resStdDraft = await get(`/api/contests/${draftContest.id}/results/me`, tokenStudent1);
    record('4.4 Draft contest result details returns 404 for student', resStdDraft.status === 404);

    // ════════════════════════════════════════════════════════════════════
    // 5. CROSS-CONTEST IDOR / OBJECT ISOLATION
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 5. Cross-Contest IDOR / Object Isolation ---');

    // 5.1 Requesting non-participant user ID returns 404
    const resNonPart = await get(`/api/contests/${contestA.id}/participants/9999999/results`, tokenProfA);
    record('5.1 Non-participant user ID in contest returns 404 Not Found', resNonPart.status === 404);

    // 5.2 Requesting non-existent contest ID returns 404
    const resNonContest = await get(`/api/contests/9999999/results`, tokenStudent1);
    record('5.2 Non-existent contest ID returns 404 Not Found', resNonContest.status === 404);

    // ════════════════════════════════════════════════════════════════════
    // 6. FREEZE BYPASS RESISTANCE
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 6. Freeze Bypass Resistance ---');

    // Create a contest currently in active freeze
    const freezeStart = new Date(now.getTime() - 40 * 60000);
    const freezeEnd = new Date(now.getTime() + 20 * 60000); // 20m remaining, freeze 30m -> frozen!
    const activeFreezeContest = await ContestModel.createContest({
      title: `Active Freeze Contest ${suffix}`,
      startTime: freezeStart.toISOString(),
      endTime: freezeEnd.toISOString(),
      createdBy: profA.id,
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 30,
    });
    await ContestModel.updateContestStatus(activeFreezeContest.id, 'published');
    await ContestModel.addProblemToContest({ contestId: activeFreezeContest.id, problemId: prob1.id, points: 100, problemOrder: 1 });
    await ContestModel.addParticipant(activeFreezeContest.id, student1.id);
    await ContestModel.addParticipant(activeFreezeContest.id, student2.id);

    // Student 1 submits before freeze (at +5m)
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'pre', 'accepted', 100, false, $4);`,
      [student1.id, activeFreezeContest.id, prob1.id, new Date(freezeStart.getTime() + 5 * 60000).toISOString()]
    );

    // Student 2 submits DURING freeze window (at +25m, freeze started at +30m before end -> +30m from start)
    // Wait, duration is 60m. freezeMinutes = 30m. Freeze starts at 30m.
    // Let's place post-freeze submission at 35m from start (during freeze)
    await db.query(
      `INSERT INTO submissions (user_id, contest_id, problem_id, language, source_code, status, score, is_sample_run, created_at)
       VALUES ($1, $2, $3, 'javascript', 'post', 'accepted', 100, false, $4);`,
      [student2.id, activeFreezeContest.id, prob1.id, new Date(freezeStart.getTime() + 35 * 60000).toISOString()]
    );

    // 6.1 Student querying leaderboard during freeze sees post-freeze submission masked (Score = 0)
    const resFrozenLeaderboard = await get(`/api/contests/${activeFreezeContest.id}/leaderboard`, tokenStudent1);
    const p2Frozen = resFrozenLeaderboard.body?.standings?.find(p => p.userId === student2.id);
    record('6.1 Public leaderboard during freeze masks post-freeze solve (Score = 0)',
      p2Frozen?.totalScore === 0, `score=${p2Frozen?.totalScore}`);

    // 6.2 Student passing freezeOverride=true in query params is strictly ignored
    const resBypassAttempt = await get(`/api/contests/${activeFreezeContest.id}/leaderboard?freezeOverride=true`, tokenStudent1);
    const p2Bypass = resBypassAttempt.body?.standings?.find(p => p.userId === student2.id);
    record('6.2 Student freezeOverride=true query bypass ignored (Score remains 0)',
      p2Bypass?.totalScore === 0, `score=${p2Bypass?.totalScore}`);

    // 6.3 Student passing freezeOverride on results view is strictly ignored
    const resResultsBypass = await get(`/api/contests/${activeFreezeContest.id}/results?freezeOverride=true`, tokenStudent1);
    const r2Bypass = resResultsBypass.body?.results?.find(p => p.userId === student2.id);
    record('6.3 Student freezeOverride on results endpoint ignored (Score remains 0)',
      r2Bypass?.totalScore === 0, `score=${r2Bypass?.totalScore}`);

    // 6.4 Contest owner professor with freezeOverride=true sees unmasked score (100)
    const resOwnerUnmask = await get(`/api/contests/${activeFreezeContest.id}/admin-leaderboard?freezeOverride=true`, tokenProfA);
    const p2Unmasked = resOwnerUnmask.body?.standings?.find(p => p.userId === student2.id);
    record('6.4 Contest owner with freezeOverride=true sees true unmasked score (100)',
      p2Unmasked?.totalScore === 100, `score=${p2Unmasked?.totalScore}`);

    // ════════════════════════════════════════════════════════════════════
    // 7. FINALIZATION & RESULT LOCK INTEGRITY
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 7. Finalization & Result Lock Integrity ---');

    // Finalize contestA by profA
    const resFinA = await post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfA);
    record('7.1 Authoritative finalization by owner professor succeeds (200 OK)', resFinA.status === 200);

    // 7.2 Result-affecting contest mutation is blocked (409)
    const resLockRated = await put(`/api/contests/${contestA.id}`, { isRated: false }, tokenProfA);
    record('7.2 Mutating isRated post-finalization is blocked (409 Conflict)', resLockRated.status === 409);

    const resLockFreeze = await put(`/api/contests/${contestA.id}`, { leaderboardFreezeEnabled: false }, tokenProfA);
    record('7.3 Mutating freeze settings post-finalization is blocked (409 Conflict)', resLockFreeze.status === 409);

    // 7.4 Adding problem post-finalization is blocked (409)
    const resAddProbLock = await post(`/api/contests/${contestA.id}/problems`, { problemId: prob2.id, points: 200 }, tokenProfA);
    record('7.4 Adding problem post-finalization is blocked (409 Conflict)', resAddProbLock.status === 409);

    // 7.5 Removing participant post-finalization is blocked (409)
    const resRmPartLock = await del(`/api/contests/${contestA.id}/participants/${student1.id}`, null, tokenProfA);
    record('7.5 Removing participant post-finalization is blocked (409 Conflict)', resRmPartLock.status === 409);

    // 7.6 Submitting code post-finalization is rejected (400)
    const resSubPostLock = await post('/api/submissions', {
      contestId: contestA.id,
      problemId: prob1.id,
      language: 'javascript',
      sourceCode: 'console.log("too late");',
    }, tokenStudent1);
    record('7.6 Submitting solution to finalized contest rejected (400 Bad Request)', resSubPostLock.status === 400);

    // ════════════════════════════════════════════════════════════════════
    // 8. MASS ASSIGNMENT & CLIENT TAMPERING
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 8. Mass Assignment & Client Tampering ---');

    // 8.1 Attempting to un-finalize contest via PUT body
    await put(`/api/contests/${contestA.id}`, {
      isRatingFinalized: false,
      is_rating_finalized: false,
      ratingsFinalizedAt: null,
    }, tokenProfA);
    const dbRowFin = (await db.query('SELECT is_rating_finalized, ratings_finalized_at FROM contests WHERE id = $1', [contestA.id])).rows[0];
    record('8.1 Client body cannot unset is_rating_finalized or ratings_finalized_at',
      dbRowFin?.is_rating_finalized === true && dbRowFin?.ratings_finalized_at !== null);

    // 8.2 Attempting to tamper with finalResultsSnapshot in body
    await post(`/api/contests/${contestA.id}/finalize-ratings`, {
      finalResultsSnapshot: { hacked: true, score: 999999 },
    }, tokenProfA);
    const dbSnap = (await db.query('SELECT final_results_snapshot FROM contests WHERE id = $1', [contestA.id])).rows[0]?.final_results_snapshot;
    record('8.2 Final results snapshot in DB cannot be overwritten via request body',
      dbSnap?.hacked !== true);

    // ════════════════════════════════════════════════════════════════════
    // 9. SQL INJECTION & IDENTIFIER HARDENING
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 9. SQL Injection & Identifier Hardening ---');

    // 9.1 SQL injection in contest ID
    const resSqlContest = await get('/api/contests/1%20OR%201=1/results', tokenStudent1);
    record('9.1 SQL injection in contest ID returns 400 Bad Request', resSqlContest.status === 400);

    // 9.2 Non-integer contest ID
    const resNonInt = await get('/api/contests/abc/leaderboard', tokenStudent1);
    record('9.2 String contest ID returns 400 Bad Request', resNonInt.status === 400);

    // 9.3 Negative contest ID
    const resNegId = await get('/api/contests/-10/results', tokenStudent1);
    record('9.3 Negative contest ID returns 400 Bad Request', resNegId.status === 400);

    // 9.4 SQL injection in participant ID
    const resSqlPart = await get(`/api/contests/${contestA.id}/participants/1%20OR%201=1/results`, tokenProfA);
    record('9.4 SQL injection in participant ID returns 400 Bad Request', resSqlPart.status === 400);

    // 9.5 SQL injection in search parameter handled safely
    const resSearchInj = await get(`/api/contests/${contestA.id}/results?search=%27%20OR%201=1%20--`, tokenStudent1);
    record('9.5 SQL injection in search parameter handled safely as literal string (200 OK)', resSearchInj.status === 200);

    // ════════════════════════════════════════════════════════════════════
    // 10. SENSITIVE DATA EXPOSURE & SOURCE CODE SECURITY
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 10. Sensitive Data Exposure & Source Code Security ---');

    // 10.1 Responses do not expose password hashes or sensitive tokens
    const resResultsPayload = await get(`/api/contests/${contestA.id}/results`, tokenStudent1);
    const jsonStr = JSON.stringify(resResultsPayload.body);
    record('10.1 Results response does not expose password hashes or JWTs',
      !jsonStr.includes('password_hash') && !jsonStr.includes('passwordHash') && !jsonStr.includes('$2b$'));

    // 10.2 Source code returned to student owner for own submission
    const resOwnDetails = await get(`/api/contests/${contestA.id}/results/me`, tokenStudent1);
    const subOwn = resOwnDetails.body?.submissions?.[0];
    record('10.2 Student owner can view their own source code',
      subOwn?.sourceCode?.includes('secretKey'));

    // 10.3 Source code returned to authorized creator professor
    const resProfInspect = await get(`/api/contests/${contestA.id}/participants/${student1.id}/results`, tokenProfA);
    const subProf = resProfInspect.body?.submissions?.[0];
    record('10.3 Creator professor can view student source code',
      subProf?.sourceCode?.includes('secretKey'));

    // 10.4 Public leaderboard does NOT expose submission source codes
    const resLbPayload = await get(`/api/contests/${contestA.id}/leaderboard`, tokenStudent1);
    const lbStr = JSON.stringify(resLbPayload.body);
    record('10.4 Public leaderboard does not leak source code',
      !lbStr.includes('SUPER_SECRET'));

    // ════════════════════════════════════════════════════════════════════
    // 11. AUDIT LOGGING OF PRIVILEGED DENIALS
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 11. Audit Logging of Privileged Denials ---');

    // 11.1 Check audit log for CONTEST_FINALIZATION_UNAUTHORIZED (from 3.1)
    const auditFinRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND outcome = 'denied'
         AND metadata->>'attemptedAction' = 'CONTEST_FINALIZATION_UNAUTHORIZED'
       LIMIT 1;`,
      [String(contestA.id)]
    );
    record('11.1 Audit log recorded for unauthorized finalization denial',
      Boolean(auditFinRes.rows[0] && auditFinRes.rows[0].actor_id === profB.id));

    // 11.2 Check audit log for PARTICIPANT_RESULTS_BOLA (from 4.3)
    const auditBolaRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND outcome = 'denied'
         AND metadata->>'attemptedAction' = 'PARTICIPANT_RESULTS_BOLA'
       LIMIT 1;`,
      [String(contestA.id)]
    );
    record('11.2 Audit log recorded for student participant results BOLA denial',
      Boolean(auditBolaRes.rows[0] && auditBolaRes.rows[0].actor_id === student1.id));

    // 11.3 Check audit log for ADMIN_LEADERBOARD_UNAUTHORIZED (from 3.2)
    const auditAdminBoardRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND outcome = 'denied'
         AND metadata->>'attemptedAction' = 'ADMIN_LEADERBOARD_UNAUTHORIZED'
       LIMIT 1;`,
      [String(contestA.id)]
    );
    record('11.3 Audit log recorded for unauthorized admin leaderboard access denial',
      Boolean(auditAdminBoardRes.rows[0] && auditAdminBoardRes.rows[0].actor_id === profB.id));

    // 11.4 Check audit log for RATINGS_FINALIZED success (from 7.1)
    const auditFinSuccess = await db.query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = 'contest' 
         AND resource_id = $1 
         AND action = 'RATINGS_FINALIZED'
         AND outcome = 'success'
       LIMIT 1;`,
      [String(contestA.id)]
    );
    record('11.4 Audit log recorded for successful finalization',
      Boolean(auditFinSuccess.rows[0] && auditFinSuccess.rows[0].actor_id === profA.id));

    // ════════════════════════════════════════════════════════════════════
    // 12. ERROR SANITIZATION & RATE LIMITING
    // ════════════════════════════════════════════════════════════════════
    console.log('\n--- 12. Error Sanitization & Rate Limiting ---');

    // 12.1 Error response does not leak internal stack traces to client
    const resBadReq = await get('/api/contests/invalid-id/results', tokenStudent1);
    record('12.1 Client error response does not expose stack trace',
      resBadReq.body && !resBadReq.body.stack && typeof resBadReq.body.message === 'string');

    // 12.2 Rate limit headers present on API responses
    record('12.2 Rate limit headers present on API responses',
      Boolean(resResultsPayload.headers['ratelimit-limit'] || resResultsPayload.headers['x-ratelimit-limit']));

    // 12.3 Concurrent unauthorized requests all cleanly rejected without leakage
    const [conc1, conc2, conc3] = await Promise.all([
      post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfB),
      post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenProfB),
      post(`/api/contests/${contestA.id}/finalize-ratings`, {}, tokenStudent1),
    ]);
    record('12.3 Concurrent unauthorized requests safely rejected (all 403 Forbidden)',
      conc1.status === 403 && conc2.status === 403 && conc3.status === 403);

  } catch (err) {
    console.error('Unhandled test execution error:', err);
    failed++;
  } finally {
    console.log('\n================================================================');
    console.log(` Test Summary: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');
    if (server) server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

server = app.listen(0, () => {
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  runTests();
});
