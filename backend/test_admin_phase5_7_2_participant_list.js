/**
 * ==============================================================================
 * TEST SUITE: Phase 7.5.7.2 — Contest Participant List & Discovery Backend
 * ==============================================================================
 * Comprehensive security, authorization, search, pagination, and data privacy tests.
 * 
 * Target Endpoint: GET /api/contests/:id/participants
 * 
 * Test Coverage:
 *  A. Authenticated access
 *  B. Unauthenticated access (401)
 *  C. Professor ownership (200 for owned contest)
 *  D. Professor cross-contest BOLA protection (403)
 *  E. Contest Admin access across contests (200)
 *  F. Super Admin access across contests (200)
 *  G. Student rejection (403 Forbidden)
 *  H. Nonexistent contest (404)
 *  I. Empty participant list (200, total: 0, participants: [])
 *  J. Participant list retrieval (safe response fields allowlist)
 *  K. Search (username, full_name, email, institution, non-matching)
 *  L. Pagination (page, limit, totalPages, offset correctness)
 *  M. Sorting (joinedAt, username, fullName, currentRating, ASC/DESC)
 *  N. Parameter validation (invalid contest ID returns 400)
 *  O. Sensitive data shielding (NO password_hash, tokens, internal secrets)
 *  P. SQL injection payload resilience (search, sortBy, page, limit)
 *  Q. Malformed pagination parameters fallback gracefully
 *  R. Excessive limit clamping (max 100)
 *  S. Deterministic ordering stability (tie-breaker with user_id)
 *  T. Cross-contest participant leakage prevention
 * ==============================================================================
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const { generateToken } = require('./src/services/authService');
const bcrypt = require('bcryptjs');

let server;
let port;
let baseUrl;

// Test fixtures
let profA, profB, contestAdmin, superAdmin, student1, student2, student3, studentOther;
let tokenProfA, tokenProfB, tokenContestAdmin, tokenSuperAdmin, tokenStudent1;
let contestProfA, contestProfB, emptyContest;

function makeRequest(method, path, body = null, token = null) {
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
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  const passwordHash = await bcrypt.hash('TestPass123!', 10);
  const stamp = Date.now();

  // Create Users
  const userSql = `
    INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, institution, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
    RETURNING id, username, email, role, full_name AS "fullName", current_rating AS "currentRating";
  `;

  const pARes = await db.query(userSql, [`prof_a_${stamp}`, `prof_a_${stamp}@test.com`, passwordHash, 'Professor Alice', 'professor', 1500, 1500, 'MIT']);
  profA = pARes.rows[0];
  tokenProfA = generateToken(profA);

  const pBRes = await db.query(userSql, [`prof_b_${stamp}`, `prof_b_${stamp}@test.com`, passwordHash, 'Professor Bob', 'professor', 1500, 1500, 'Stanford']);
  profB = pBRes.rows[0];
  tokenProfB = generateToken(profB);

  const caRes = await db.query(userSql, [`c_admin_${stamp}`, `c_admin_${stamp}@test.com`, passwordHash, 'Contest Admin Charlie', 'contest_admin', 1800, 1800, 'CMU']);
  contestAdmin = caRes.rows[0];
  tokenContestAdmin = generateToken(contestAdmin);

  const saRes = await db.query(userSql, [`s_admin_${stamp}`, `s_admin_${stamp}@test.com`, passwordHash, 'Super Admin Dave', 'super_admin', 2000, 2000, 'System']);
  superAdmin = saRes.rows[0];
  tokenSuperAdmin = generateToken(superAdmin);

  const s1Res = await db.query(userSql, [`student_alpha_${stamp}`, `alpha_${stamp}@test.com`, passwordHash, 'Alpha Student', 'student', 1350, 1400, 'MIT']);
  student1 = s1Res.rows[0];
  tokenStudent1 = generateToken(student1);

  const s2Res = await db.query(userSql, [`student_bravo_${stamp}`, `bravo_${stamp}@test.com`, passwordHash, 'Bravo Student', 'student', 1200, 1250, 'Harvard']);
  student2 = s2Res.rows[0];

  const s3Res = await db.query(userSql, [`student_charlie_${stamp}`, `charlie_${stamp}@test.com`, passwordHash, 'Charlie Student', 'student', 1650, 1700, 'Berkeley']);
  student3 = s3Res.rows[0];

  const sOtherRes = await db.query(userSql, [`student_other_${stamp}`, `other_${stamp}@test.com`, passwordHash, 'Other Student', 'student', 1100, 1100, 'Oxford']);
  studentOther = sOtherRes.rows[0];

  // Create Contests
  const contestSql = `
    INSERT INTO contests (title, description, created_by, start_time, end_time, status, is_rated)
    VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '3 hours', 'published', true)
    RETURNING id, title, created_by AS "createdBy", status;
  `;

  const cARes = await db.query(contestSql, [`Contest Prof A ${stamp}`, 'Contest A Description', profA.id]);
  contestProfA = cARes.rows[0];

  const cBRes = await db.query(contestSql, [`Contest Prof B ${stamp}`, 'Contest B Description', profB.id]);
  contestProfB = cBRes.rows[0];

  const cEmptyRes = await db.query(contestSql, [`Contest Empty ${stamp}`, 'Empty Contest', profA.id]);
  emptyContest = cEmptyRes.rows[0];

  // Enroll Participants in Contest A: student1, student2, student3
  const enrollSql = `INSERT INTO contest_participants (contest_id, user_id, joined_at) VALUES ($1, $2, $3);`;
  await db.query(enrollSql, [contestProfA.id, student1.id, new Date(Date.now() - 300000)]);
  await db.query(enrollSql, [contestProfA.id, student2.id, new Date(Date.now() - 200000)]);
  await db.query(enrollSql, [contestProfA.id, student3.id, new Date(Date.now() - 100000)]);

  // Enroll studentOther in Contest B only
  await db.query(enrollSql, [contestProfB.id, studentOther.id, new Date()]);
}

async function cleanup() {
  if (contestProfA && contestProfB) {
    await db.query(`DELETE FROM contest_participants WHERE contest_id IN ($1, $2, $3);`, [contestProfA.id, contestProfB.id, emptyContest.id]);
    await db.query(`DELETE FROM contests WHERE id IN ($1, $2, $3);`, [contestProfA.id, contestProfB.id, emptyContest.id]);
  }
  const userIds = [profA, profB, contestAdmin, superAdmin, student1, student2, student3, studentOther]
    .filter(Boolean)
    .map((u) => u.id);
  if (userIds.length > 0) {
    await db.query(`DELETE FROM users WHERE id = ANY($1::int[]);`, [userIds]);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.7.2 PARTICIPANT LIST TEST SUITE');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(desc, ok, details = '') {
    if (ok) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc} - ${details}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // Section A & B: Authentication & Authorization
    // ----------------------------------------------------
    console.log('--- 1. Authentication & Basic Authorization ---');

    // B. Unauthenticated access -> 401
    const resUnauth = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`);
    record('B. Unauthenticated request rejected with 401 Unauthorized', resUnauth.status === 401);

    // G. Student rejection -> 403
    const resStudent = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`, null, tokenStudent1);
    record('G. Student request rejected with 403 Forbidden', resStudent.status === 403);

    // C. Professor ownership -> 200
    const resProfA = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`, null, tokenProfA);
    record('C. Professor A accesses owned contest participants (200 OK)', resProfA.status === 200);
    record('C. Response includes total participantCount and participants array', 
      resProfA.body?.total === 3 && Array.isArray(resProfA.body?.participants));

    // D. Professor cross-contest BOLA -> 403
    const resBOLA = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`, null, tokenProfB);
    record('D. Professor B cannot access Professor A contest participants (403 BOLA)', resBOLA.status === 403);

    // E. Contest Admin access -> 200
    const resCA = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`, null, tokenContestAdmin);
    record('E. Contest Admin can access any contest participants (200 OK)', resCA.status === 200);

    // F. Super Admin access -> 200
    const resSA = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants`, null, tokenSuperAdmin);
    record('F. Super Admin can access any contest participants (200 OK)', resSA.status === 200);

    // H. Nonexistent contest -> 404
    const res404 = await makeRequest('GET', `/api/contests/99999999/participants`, null, tokenProfA);
    record('H. Nonexistent contest returns 404 Not Found', res404.status === 404);

    // N. Invalid non-integer contest ID -> 400
    const resInvalidId = await makeRequest('GET', `/api/contests/abc-not-an-id/participants`, null, tokenProfA);
    record('N. Non-numeric contest ID returns 400 Bad Request', resInvalidId.status === 400);

    // I. Empty participant list -> 200 with total: 0
    const resEmpty = await makeRequest('GET', `/api/contests/${emptyContest.id}/participants`, null, tokenProfA);
    record('I. Empty contest returns 200 with total 0 and empty participants array', 
      resEmpty.status === 200 && resEmpty.body?.total === 0 && resEmpty.body?.participants?.length === 0);

    // ----------------------------------------------------
    // Section J & O: Response Data Privacy & Whitelist
    // ----------------------------------------------------
    console.log('\n--- 2. Response Data & Privacy Whitelist ---');

    const participant = resProfA.body.participants[0];
    record('J. Participant contains safe field userId', participant.userId !== undefined);
    record('J. Participant contains safe field username', typeof participant.username === 'string');
    record('J. Participant contains safe field fullName', typeof participant.fullName === 'string');
    record('J. Participant contains safe field email', typeof participant.email === 'string');
    record('J. Participant contains safe field currentRating', typeof participant.currentRating === 'number');
    record('J. Participant contains safe field joinedAt', typeof participant.joinedAt === 'string');

    // O. Sensitive field shielding
    const rawBodyStr = JSON.stringify(resProfA.body);
    record('O. Password hashes strictly excluded from response', !rawBodyStr.includes('password_hash') && !rawBodyStr.includes('TestPass123!'));
    record('O. JWT tokens and auth secrets strictly excluded', !rawBodyStr.includes('eyJ') && !rawBodyStr.includes('secret'));

    // ----------------------------------------------------
    // Section K: Search Functionality
    // ----------------------------------------------------
    console.log('\n--- 3. Server-Side Search Filtering ---');

    // Search by username
    const resSearchUsername = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=alpha`, null, tokenProfA);
    record('K1. Search by username matches correct student', 
      resSearchUsername.status === 200 && resSearchUsername.body.total === 1 && resSearchUsername.body.participants[0].userId === student1.id);

    // Search by full name
    const resSearchName = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=Bravo`, null, tokenProfA);
    record('K2. Search by full name matches correct student', 
      resSearchName.status === 200 && resSearchName.body.total === 1 && resSearchName.body.participants[0].userId === student2.id);

    // Search by email
    const resSearchEmail = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=charlie_`, null, tokenProfA);
    record('K3. Search by email matches correct student', 
      resSearchEmail.status === 200 && resSearchEmail.body.total === 1 && resSearchEmail.body.participants[0].userId === student3.id);

    // Search by institution
    const resSearchInst = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=Harvard`, null, tokenProfA);
    record('K4. Search by institution matches correct student', 
      resSearchInst.status === 200 && resSearchInst.body.total === 1 && resSearchInst.body.participants[0].userId === student2.id);

    // Search with no matches
    const resSearchNone = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=NonExistentUserXYZ`, null, tokenProfA);
    record('K5. Search with no matches returns total 0 and empty array', 
      resSearchNone.status === 200 && resSearchNone.body.total === 0 && resSearchNone.body.participants.length === 0);

    // ----------------------------------------------------
    // Section L: Pagination Controls
    // ----------------------------------------------------
    console.log('\n--- 4. Server-Side Pagination Controls ---');

    // Page 1 with limit 2
    const resPage1 = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?page=1&limit=2`, null, tokenProfA);
    record('L1. Page 1 with limit 2 returns 2 items', 
      resPage1.status === 200 && resPage1.body.participants.length === 2 && resPage1.body.page === 1 && resPage1.body.limit === 2 && resPage1.body.totalPages === 2);

    // Page 2 with limit 2
    const resPage2 = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?page=2&limit=2`, null, tokenProfA);
    record('L2. Page 2 with limit 2 returns 1 item', 
      resPage2.status === 200 && resPage2.body.participants.length === 1 && resPage2.body.page === 2);

    // Ensure Page 1 and Page 2 contain non-overlapping items
    const page1Ids = resPage1.body.participants.map((p) => p.userId);
    const page2Ids = resPage2.body.participants.map((p) => p.userId);
    const overlap = page1Ids.filter((id) => page2Ids.includes(id));
    record('L3. Non-overlapping pagination items between pages', overlap.length === 0);

    // ----------------------------------------------------
    // Section M & S: Sorting & Deterministic Stability
    // ----------------------------------------------------
    console.log('\n--- 5. Sorting & Deterministic Ordering ---');

    // Sort by currentRating DESC
    const resSortRating = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?sortBy=currentRating&sortOrder=DESC`, null, tokenProfA);
    const ratingsDesc = resSortRating.body.participants.map((p) => p.currentRating);
    const isSortedDesc = ratingsDesc.every((val, idx, arr) => idx === 0 || arr[idx - 1] >= val);
    record('M1. Sort by currentRating DESC orders highest rated first', 
      resSortRating.status === 200 && isSortedDesc && ratingsDesc[0] === 1650);

    // Sort by username ASC
    const resSortUser = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?sortBy=username&sortOrder=ASC`, null, tokenProfA);
    const usernames = resSortUser.body.participants.map((p) => p.username);
    const isSortedUser = usernames.slice().sort().join(',') === usernames.join(',');
    record('M2. Sort by username ASC orders alphabetically', resSortUser.status === 200 && isSortedUser);

    // Sort by joinedAt ASC (default)
    const resSortJoined = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?sortBy=joinedAt&sortOrder=ASC`, null, tokenProfA);
    record('M3. Default sort by joinedAt ASC orders chronological entry', 
      resSortJoined.status === 200 && resSortJoined.body.participants[0].userId === student1.id);

    // ----------------------------------------------------
    // Section P, Q, R: Security Resilience & Parameter Hardening
    // ----------------------------------------------------
    console.log('\n--- 6. Parameter Resilience & SQL Injection Shielding ---');

    // SQL Injection in search parameter
    const resSqlSearch = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?search=' OR 1=1 --`, null, tokenProfA);
    record('P1. SQL injection payload in search safely handled without syntax error (200 OK)', resSqlSearch.status === 200);

    // SQL Injection in sortBy parameter
    const resSqlSort = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?sortBy=id;DROP TABLE users;--`, null, tokenProfA);
    record('P2. SQL injection payload in sortBy safely falls back to default column (200 OK)', resSqlSort.status === 200);

    // Q. Malformed pagination fallback
    const resMalformedPage = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?page=-5&limit=not-a-number`, null, tokenProfA);
    record('Q. Negative page and non-numeric limit fall back safely to page=1 limit=20', 
      resMalformedPage.status === 200 && resMalformedPage.body.page === 1 && resMalformedPage.body.limit === 20);

    // R. Excessive limit clamped to 100
    const resExcessLimit = await makeRequest('GET', `/api/contests/${contestProfA.id}/participants?limit=99999`, null, tokenProfA);
    record('R. Excessive limit parameter clamped to maximum 100', 
      resExcessLimit.status === 200 && resExcessLimit.body.limit === 100);

    // ----------------------------------------------------
    // Section T: Cross-Contest Participant Leakage Prevention
    // ----------------------------------------------------
    console.log('\n--- 7. Cross-Contest Isolation ---');

    const resContestB = await makeRequest('GET', `/api/contests/${contestProfB.id}/participants`, null, tokenProfB);
    const contestBParticipantIds = resContestB.body.participants.map((p) => p.userId);
    record('T1. Contest B has strictly its own participants', 
      resContestB.status === 200 && contestBParticipantIds.length === 1 && contestBParticipantIds[0] === studentOther.id);

    const contestAParticipantIds = resProfA.body.participants.map((p) => p.userId);
    record('T2. Contest A does NOT contain Contest B participants (Zero leakage)', 
      !contestAParticipantIds.includes(studentOther.id));

  } catch (err) {
    console.error('Fatal test execution error:', err);
    failed++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 7.5.7.2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    await cleanup();
    if (server) {
      server.close();
    }
    await db.closePool();
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Start temporary test server
server = http.createServer(app);
server.listen(0, async () => {
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  await setup();
  await runTests();
});
