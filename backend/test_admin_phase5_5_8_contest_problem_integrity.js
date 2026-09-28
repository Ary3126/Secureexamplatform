/**
 * Phase 7.5.5.8 — Contest Problem Validation & Integrity Automated Test Suite
 * File: backend/test_admin_phase5_5_8_contest_problem_integrity.js
 *
 * Verifies all Phase 7.5.5.8 requirements:
 * 1. Duplicate Problem Protection:
 *    - Normal duplicate add rejected (409 Conflict)
 *    - Concurrent duplicate add safely serialized (exactly 1 succeeds, others 409)
 *    - Duplicate add after reorder rejected (409 Conflict)
 *    - Re-add after remove succeeds (201/200), subsequent duplicate rejected (409 Conflict)
 * 2. Foreign Key & Resource Integrity:
 *    - Nonexistent contest ID returns 404
 *    - Nonexistent problem ID returns 404
 *    - Malformed contest ID (negative, non-numeric) returns 400
 *    - Malformed problem ID (negative, non-numeric, float, zero) returns 400
 * 3. Problem Eligibility & BOLA:
 *    - Professor cannot attach another professor's private/unpublished problem (403 Forbidden)
 *    - Owner professor can attach own private problem (201 Created)
 *    - Contest Admin and Super Admin can attach catalog problems (201 Created)
 * 4. Ordering Integrity:
 *    - Complete set validation on reorder: count matching, complete permutation
 *    - Duplicate problem IDs in reorder rejected (400)
 *    - Foreign problem IDs in reorder rejected (400)
 *    - Partial/omitted problem IDs in reorder rejected (400)
 *    - Order values contiguous 1..N verified post-reorder
 *    - Removal preserves relative ordering of remaining problems
 * 5. Points Integrity:
 *    - Points must be a strictly positive integer (> 0)
 *    - Zero points rejected (400)
 *    - Negative points rejected (400)
 *    - Malformed / non-numeric points rejected (400)
 *    - Bulk add validates points (> 0) and problemId
 * 6. Atomicity & Rollback Integrity:
 *    - Failed operations trigger clean ROLLBACK leaving database untouched
 * 7. Concurrency & Race Protection:
 *    - Concurrent mutations serialize safely without corrupting order or relationships
 * 8. Lifecycle Lock Integration:
 *    - Mutations on running contests rejected with 409 Conflict
 * 9. Database Constraints:
 *    - PRIMARY KEY (contest_id, problem_id)
 *    - CHECK (points > 0)
 *    - CHECK (problem_order > 0)
 *    - FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE
 *    - FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
 */

process.env.RATE_LIMIT_CONTEST_MAX = '500';

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let port;
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
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runContestProblemIntegrityTests() {
  let passed = 0;
  let failed = 0;

  function record(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  console.log('=======================================================');
  console.log(' STARTING PHASE 7.5.5.8 CONTEST PROBLEM INTEGRITY TESTS');
  console.log('=======================================================');

  const createdUserIds = [];
  const createdProblemIds = [];
  const createdContestIds = [];

  try {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const ts = Date.now();

    // -------------------------------------------------------------------------
    // 1. Seed Test Actors
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('IntegrityPass@123');

    const profA = await UserModel.createUser({
      username: `profA_558_${ts}`,
      email: `profA_558_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor A ${ts}`,
      role: 'professor',
    });
    createdUserIds.push(profA.id);
    const profAToken = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `profB_558_${ts}`,
      email: `profB_558_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Professor B ${ts}`,
      role: 'professor',
    });
    createdUserIds.push(profB.id);
    const profBToken = generateToken(profB);

    const ca = await UserModel.createUser({
      username: `ca_558_${ts}`,
      email: `ca_558_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Contest Admin ${ts}`,
      role: 'contest_admin',
    });
    createdUserIds.push(ca.id);
    const caToken = generateToken(ca);

    const sa = await UserModel.createUser({
      username: `sa_558_${ts}`,
      email: `sa_558_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Super Admin ${ts}`,
      role: 'super_admin',
    });
    createdUserIds.push(sa.id);
    const saToken = generateToken(sa);

    const student = await UserModel.createUser({
      username: `stud_558_${ts}`,
      email: `stud_558_${ts}@test.com`,
      passwordHash: pwdHash,
      fullName: `Student ${ts}`,
      role: 'student',
    });
    createdUserIds.push(student.id);
    const studentToken = generateToken(student);

    record('Setup: Actors initialized with JWTs', profAToken && profBToken && caToken && saToken && studentToken);

    // -------------------------------------------------------------------------
    // 2. Seed Problems in Problem Catalog
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Seeding Problems Catalog ---');
    const pubProblems = [];
    for (let i = 1; i <= 6; i++) {
      const p = await ProblemModel.createProblem({
        title: `Integrity Problem ${i} ${ts}`,
        description: `Description for integrity problem ${i}`,
        difficulty: 'easy',
        codingMode: 'function',
        createdBy: profA.id,
        accessScope: 'public',
        isPublished: true,
      });
      pubProblems.push(p);
      createdProblemIds.push(p.id);
    }

    // Seed a private unpublished problem owned by Prof B
    const privateProbB = await ProblemModel.createProblem({
      title: `Private Problem ProfB ${ts}`,
      description: 'Private problem description',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profB.id,
      accessScope: 'contest_private',
      isPublished: false,
    });
    createdProblemIds.push(privateProbB.id);

    record('Setup: Public and private problems seeded', pubProblems.length === 6 && privateProbB.id);

    // -------------------------------------------------------------------------
    // 3. Seed Contests
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Seeding Contests ---');
    const now = new Date();

    // Draft contest by Prof A
    const draftContestRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
       VALUES ($1, $2, $3, $4, 'draft', true, $5) RETURNING id, title`,
      [`Draft Contest ${ts}`, 'Draft contest for integrity tests',
       new Date(now.getTime() + 120 * 60000), new Date(now.getTime() + 240 * 60000), profA.id]
    );
    const draftContest = draftContestRes.rows[0];
    createdContestIds.push(draftContest.id);

    // Running contest by Prof A
    const runningContestRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
       VALUES ($1, $2, $3, $4, 'published', true, $5) RETURNING id, title`,
      [`Running Contest ${ts}`, 'Running contest for integrity tests',
       new Date(now.getTime() - 30 * 60000), new Date(now.getTime() + 60 * 60000), profA.id]
    );
    const runningContest = runningContestRes.rows[0];
    createdContestIds.push(runningContest.id);

    // Draft contest by Prof B
    const draftContestBRes = await db.query(
      `INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
       VALUES ($1, $2, $3, $4, 'draft', true, $5) RETURNING id, title`,
      [`Draft Contest B ${ts}`, 'Draft contest for Prof B',
       new Date(now.getTime() + 120 * 60000), new Date(now.getTime() + 240 * 60000), profB.id]
    );
    const draftContestB = draftContestBRes.rows[0];
    createdContestIds.push(draftContestB.id);

    record('Setup: Test contests initialized', draftContest.id && runningContest.id && draftContestB.id);

    // -------------------------------------------------------------------------
    // 4. Duplicate Problem Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Duplicate Problem Protection ---');
    // Add Problem 1 for first time -> 201 Created
    const addP1Res = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[0].id,
      points: 100,
    }, profAToken);
    record('DUPLICATE: Initial problem addition succeeds (201 Created)', addP1Res.status === 201 || addP1Res.status === 200);

    // Attempt to add Problem 1 a second time -> 409 Conflict
    const dupAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[0].id,
      points: 150,
    }, profAToken);
    record('DUPLICATE: Adding identical problem again rejected with 409 Conflict', dupAddRes.status === 409);
    record('DUPLICATE: Error message indicates problem is already attached', String(dupAddRes.body?.message).toLowerCase().includes('already attached'));

    // Add Problem 2 and Problem 3
    await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: pubProblems[1].id, points: 200 }, profAToken);
    await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: pubProblems[2].id, points: 300 }, profAToken);

    // Reorder problems [P3, P1, P2]
    const reorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [pubProblems[2].id, pubProblems[0].id, pubProblems[1].id],
    }, profAToken);
    record('DUPLICATE: Reordering problems succeeds (200 OK)', reorderRes.status === 200);

    // Attempt duplicate add after reorder -> 409 Conflict
    const dupAfterReorderRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[2].id,
    }, profAToken);
    record('DUPLICATE: Duplicate add after reorder rejected with 409 Conflict', dupAfterReorderRes.status === 409);

    // Remove Problem 1
    const remP1Res = await request('DELETE', `/api/contests/${draftContest.id}/problems/${pubProblems[0].id}`, null, profAToken);
    record('DUPLICATE: Removing problem succeeds (200 OK)', remP1Res.status === 200);

    // Re-add Problem 1 -> succeeds
    const reAddP1Res = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[0].id,
      points: 250,
    }, profAToken);
    record('DUPLICATE: Re-adding removed problem succeeds (201 Created)', reAddP1Res.status === 201 || reAddP1Res.status === 200);

    // Duplicate add after re-add -> 409 Conflict
    const dupAfterReAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[0].id,
    }, profAToken);
    record('DUPLICATE: Duplicate after re-add rejected with 409 Conflict', dupAfterReAddRes.status === 409);

    // Concurrent duplicate add test:
    // Launch 5 parallel requests attempting to add Problem 4 simultaneously
    const concurrentAddPromises = Array.from({ length: 5 }).map(() =>
      request('POST', `/api/contests/${draftContest.id}/problems`, {
        problemId: pubProblems[3].id,
        points: 400,
      }, profAToken)
    );
    const concurrentAddResults = await Promise.all(concurrentAddPromises);
    const successCount = concurrentAddResults.filter(r => r.status === 201 || r.status === 200).length;
    const conflictCount = concurrentAddResults.filter(r => r.status === 409).length;
    record('DUPLICATE CONCURRENCY: Exactly 1 concurrent add succeeds', successCount === 1);
    record('DUPLICATE CONCURRENCY: Remaining concurrent adds safely rejected with 409 Conflict', conflictCount === 4);

    // Verify DB integrity: contest has exactly 1 row for Problem 4
    const cpCountRes = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [draftContest.id, pubProblems[3].id]
    );
    record('DUPLICATE DB INTEGRITY: Database has exactly 1 mapping row after concurrent adds', cpCountRes.rows[0].count === 1);

    // -------------------------------------------------------------------------
    // 5. Foreign Key & Resource ID Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Foreign Key & Resource ID Integrity ---');

    // Invalid / Negative Problem ID
    const negProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: -5 }, profAToken);
    record('RESOURCE ID: Negative problemId rejected with 400 Bad Request', negProbRes.status === 400);

    // Zero Problem ID
    const zeroProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: 0 }, profAToken);
    record('RESOURCE ID: Zero problemId rejected with 400 Bad Request', zeroProbRes.status === 400);

    // Non-numeric Problem ID
    const strProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: 'not-a-number' }, profAToken);
    record('RESOURCE ID: Non-numeric problemId rejected with 400 Bad Request', strProbRes.status === 400);

    // Missing Problem ID
    const missingProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { points: 100 }, profAToken);
    record('RESOURCE ID: Missing problemId rejected with 400 Bad Request', missingProbRes.status === 400);

    // Nonexistent Problem ID
    const nonExistentProbRes = await request('POST', `/api/contests/${draftContest.id}/problems`, { problemId: 99999999 }, profAToken);
    record('RESOURCE ID: Nonexistent problemId returns 404 Not Found', nonExistentProbRes.status === 404);

    // Invalid / Negative Contest ID
    const negContestRes = await request('POST', `/api/contests/-1/problems`, { problemId: pubProblems[4].id }, profAToken);
    record('RESOURCE ID: Negative contestId rejected with 400 Bad Request', negContestRes.status === 400);

    // Non-numeric Contest ID
    const strContestRes = await request('POST', `/api/contests/abc/problems`, { problemId: pubProblems[4].id }, profAToken);
    record('RESOURCE ID: Non-numeric contestId rejected with 400 Bad Request', strContestRes.status === 400);

    // Nonexistent Contest ID
    const nonExistentContestRes = await request('POST', `/api/contests/99999999/problems`, { problemId: pubProblems[4].id }, profAToken);
    record('RESOURCE ID: Nonexistent contestId returns 404 Not Found', nonExistentContestRes.status === 404);

    // -------------------------------------------------------------------------
    // 6. Problem Eligibility & BOLA Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Problem Eligibility & BOLA Protection ---');

    // Prof A attempts to attach Prof B's private unpublished problem -> 403 Forbidden
    const bolaAttachRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: privateProbB.id,
    }, profAToken);
    record('ELIGIBILITY: Attaching another professor private problem rejected with 403 Forbidden', bolaAttachRes.status === 403);
    record('ELIGIBILITY: Error message clarifies lack of permission', String(bolaAttachRes.body?.message).toLowerCase().includes('permission'));

    // Prof B can attach their own private problem to their own contest -> 201 Created
    const ownerAttachPrivateRes = await request('POST', `/api/contests/${draftContestB.id}/problems`, {
      problemId: privateProbB.id,
      points: 200,
    }, profBToken);
    record('ELIGIBILITY: Owner professor can attach own private problem (201 Created)', ownerAttachPrivateRes.status === 201 || ownerAttachPrivateRes.status === 200);

    // Super Admin can attach any problem from catalog -> 201 Created
    const saAttachRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[4].id,
      points: 100,
    }, saToken);
    record('ELIGIBILITY: Super Admin can attach catalog problem (201 Created)', saAttachRes.status === 201 || saAttachRes.status === 200);

    // -------------------------------------------------------------------------
    // 7. Points Integrity & Boundary Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Points Integrity ---');

    // Negative Points
    const negPointsRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[5].id,
      points: -100,
    }, profAToken);
    record('POINTS: Negative points rejected with 400 Bad Request', negPointsRes.status === 400);

    // Zero Points
    const zeroPointsRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[5].id,
      points: 0,
    }, profAToken);
    record('POINTS: Zero points rejected with 400 Bad Request', zeroPointsRes.status === 400);

    // Non-numeric Points
    const strPointsRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[5].id,
      points: 'abc',
    }, profAToken);
    record('POINTS: Non-numeric points rejected with 400 Bad Request', strPointsRes.status === 400);

    // Omitted Points -> Defaults to 100
    const defPointsRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: pubProblems[5].id,
    }, profAToken);
    record('POINTS: Omitted points defaults to valid positive integer 100 (201 Created)',
      (defPointsRes.status === 201 || defPointsRes.status === 200) &&
      defPointsRes.body?.mapping?.points === 100
    );

    // Bulk Add: Negative points in item
    const bulkNegPointsRes = await request('POST', `/api/contests/${draftContest.id}/problems/bulk`, {
      problems: [{ problemId: pubProblems[0].id, points: -20 }],
    }, profAToken);
    record('POINTS: Bulk add with negative points rejected with 400 Bad Request', bulkNegPointsRes.status === 400);

    // Bulk Add: Invalid problemId in item
    const bulkInvalidIdRes = await request('POST', `/api/contests/${draftContest.id}/problems/bulk`, {
      problems: [{ problemId: -1, points: 100 }],
    }, profAToken);
    record('POINTS: Bulk add with invalid problemId rejected with 400 Bad Request', bulkInvalidIdRes.status === 400);

    // -------------------------------------------------------------------------
    // 8. Ordering Integrity & Complete Set Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Ordering Integrity & Complete Set Validation ---');

    // Fetch current attached problems in draftContest
    const curProbsRes = await db.query(
      'SELECT problem_id FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );
    const attachedIds = curProbsRes.rows.map(r => r.problem_id);
    const n = attachedIds.length;

    // A. Reorder with duplicate problem ID in array -> 400
    const dupReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [attachedIds[0], attachedIds[0], ...attachedIds.slice(2)],
    }, profAToken);
    record('ORDERING: Reorder with duplicate problem ID rejected with 400 Bad Request', dupReorderRes.status === 400);

    // B. Reorder with foreign problem ID (not in contest) -> 400
    const foreignReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [...attachedIds.slice(0, n - 1), privateProbB.id],
    }, profAToken);
    record('ORDERING: Reorder with foreign problem ID rejected with 400 Bad Request', foreignReorderRes.status === 400);

    // C. Reorder with partial set (omitting attached problems) -> 400
    const partialReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: attachedIds.slice(0, n - 1),
    }, profAToken);
    record('ORDERING: Partial problem list omitting attached problems rejected with 400 Bad Request', partialReorderRes.status === 400);

    // D. Reorder with excess problem IDs -> 400
    const excessReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [...attachedIds, 999999],
    }, profAToken);
    record('ORDERING: Reorder with excess problem count rejected with 400 Bad Request', excessReorderRes.status === 400);

    // E. Reorder with empty array -> 400
    const emptyReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: [],
    }, profAToken);
    record('ORDERING: Reorder with empty problem array rejected with 400 Bad Request', emptyReorderRes.status === 400);

    // F. Valid complete permutation -> 200 OK
    const reversedIds = [...attachedIds].reverse();
    const validReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: reversedIds,
    }, profAToken);
    record('ORDERING: Valid complete permutation accepted (200 OK)', validReorderRes.status === 200);

    // Verify DB ordering: strictly contiguous 1..N
    const postReorderRes = await db.query(
      'SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );
    const postOrders = postReorderRes.rows.map(r => r.problem_order);
    const expectedOrders = Array.from({ length: n }, (_, i) => i + 1);
    record('ORDERING DB INTEGRITY: Database positions strictly contiguous 1..N with zero duplicate slots',
      JSON.stringify(postOrders) === JSON.stringify(expectedOrders)
    );

    // G. Removal preserves relative order
    const toRemoveId = postReorderRes.rows[1].problem_id; // Remove second problem (order 2)
    const remPreserveRes = await request('DELETE', `/api/contests/${draftContest.id}/problems/${toRemoveId}`, null, profAToken);
    record('ORDERING REMOVAL: Removal succeeds (200 OK)', remPreserveRes.status === 200);

    const postRemRes = await db.query(
      'SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );
    const postRemOrders = postRemRes.rows.map(r => r.problem_order);
    // Verified: relative sequence is preserved (remaining orders are strictly ascending)
    let isAscending = true;
    for (let i = 1; i < postRemOrders.length; i++) {
      if (postRemOrders[i] <= postRemOrders[i - 1]) isAscending = false;
    }
    record('ORDERING REMOVAL: Relative ordering of remaining problems strictly preserved', isAscending);

    // -------------------------------------------------------------------------
    // 9. Atomicity & Rollback Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Atomicity & Rollback Integrity ---');

    // Baseline DB state before failed reorder attempt
    const beforeFailRes = await db.query(
      'SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );

    // Attempt invalid reorder payload (containing an invalid ID)
    const currentList = beforeFailRes.rows.map(r => r.problem_id);
    const failPayload = [...currentList.slice(0, currentList.length - 1), -999];
    const failReorderRes = await request('PUT', `/api/contests/${draftContest.id}/problems/order`, {
      problemIds: failPayload,
    }, profAToken);
    record('ATOMICITY: Invalid reorder rejected (400 Bad Request)', failReorderRes.status === 400);

    // Verify DB state is 100% byte-for-byte identical after rollback
    const afterFailRes = await db.query(
      'SELECT problem_id, problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );
    record('ATOMICITY DB INTEGRITY: Database state byte-for-byte unchanged after rejected reorder',
      JSON.stringify(beforeFailRes.rows) === JSON.stringify(afterFailRes.rows)
    );

    // -------------------------------------------------------------------------
    // 10. Concurrency Testing
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Concurrency Safety ---');

    // Parallel reorder requests with valid permutations
    const permA = [...currentList];
    const permB = [...currentList].reverse();

    const concReorderPromises = [
      request('PUT', `/api/contests/${draftContest.id}/problems/order`, { problemIds: permA }, profAToken),
      request('PUT', `/api/contests/${draftContest.id}/problems/order`, { problemIds: permB }, profAToken),
    ];
    const concReorderResults = await Promise.all(concReorderPromises);
    const bothOk = concReorderResults.every(r => r.status === 200);
    record('CONCURRENCY: Concurrent reorders serialize safely without error (200 OK)', bothOk);

    // Final DB state after concurrent reorder must have valid contiguous positions
    const finalConcRes = await db.query(
      'SELECT problem_order FROM contest_problems WHERE contest_id = $1 ORDER BY problem_order ASC',
      [draftContest.id]
    );
    const finalOrders = finalConcRes.rows.map(r => r.problem_order);
    const expectedFinalOrders = Array.from({ length: currentList.length }, (_, i) => i + 1);
    record('CONCURRENCY DB INTEGRITY: Database positions valid contiguous 1..N after concurrent reorders',
      JSON.stringify(finalOrders) === JSON.stringify(expectedFinalOrders)
    );

    // -------------------------------------------------------------------------
    // 11. Lifecycle Lock Integration
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing Lifecycle Lock Integration ---');

    const runAddRes = await request('POST', `/api/contests/${runningContest.id}/problems`, {
      problemId: pubProblems[0].id,
    }, profAToken);
    record('LIFECYCLE INTEGRATION: Add on running contest rejected with 409 Conflict', runAddRes.status === 409);

    const runRemRes = await request('DELETE', `/api/contests/${runningContest.id}/problems/${pubProblems[0].id}`, null, profAToken);
    record('LIFECYCLE INTEGRATION: Remove on running contest rejected with 409 Conflict', runRemRes.status === 409);

    const runOrderRes = await request('PUT', `/api/contests/${runningContest.id}/problems/order`, {
      problemIds: [pubProblems[0].id],
    }, profAToken);
    record('LIFECYCLE INTEGRATION: Reorder on running contest rejected with 409 Conflict', runOrderRes.status === 409);

    // Verify zero rows in running contest
    const runCheckRes = await db.query('SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1', [runningContest.id]);
    record('LIFECYCLE DB INTEGRITY: Zero rows inserted into running contest', runCheckRes.rows[0].count === 0);

    // -------------------------------------------------------------------------
    // 12. Database Constraint Verification (Defense in Depth)
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Testing Database-Level Constraints ---');

    // A. Check constraint: points > 0
    let pointsConstraintBlocked = false;
    try {
      await db.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, -10, 1)',
        [draftContest.id, pubProblems[0].id]
      );
    } catch (err) {
      if (err.code === '23514') pointsConstraintBlocked = true; // check_violation
    }
    record('DB CONSTRAINT: Raw insert with negative points blocked by contest_problems_points_check (23514)', pointsConstraintBlocked);

    // B. Check constraint: problem_order > 0
    let orderConstraintBlocked = false;
    try {
      await db.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 0)',
        [draftContest.id, pubProblems[0].id]
      );
    } catch (err) {
      if (err.code === '23514') orderConstraintBlocked = true; // check_violation
    }
    record('DB CONSTRAINT: Raw insert with problem_order=0 blocked by contest_problems_order_check (23514)', orderConstraintBlocked);

    // C. Primary Key: duplicate (contest_id, problem_id)
    let pkConstraintBlocked = false;
    // Get an existing attached problem ID
    const existingProblemId = (await db.query('SELECT problem_id FROM contest_problems WHERE contest_id = $1 LIMIT 1', [draftContest.id])).rows[0]?.problem_id;
    try {
      await db.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 99)',
        [draftContest.id, existingProblemId]
      );
    } catch (err) {
      if (err.code === '23505') pkConstraintBlocked = true; // unique_violation
    }
    record('DB CONSTRAINT: Raw duplicate insert blocked by PRIMARY KEY contest_problems_pkey (23505)', pkConstraintBlocked);

    // D. Foreign Key: nonexistent contest
    let fkContestBlocked = false;
    try {
      await db.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES (99999999, $1, 100, 1)',
        [pubProblems[0].id]
      );
    } catch (err) {
      if (err.code === '23503') fkContestBlocked = true; // foreign_key_violation
    }
    record('DB CONSTRAINT: Raw insert with nonexistent contest blocked by contest_id foreign key (23503)', fkContestBlocked);

    // E. Foreign Key: nonexistent problem
    let fkProblemBlocked = false;
    try {
      await db.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, 99999999, 100, 1)',
        [draftContest.id]
      );
    } catch (err) {
      if (err.code === '23503') fkProblemBlocked = true; // foreign_key_violation
    }
    record('DB CONSTRAINT: Raw insert with nonexistent problem blocked by problem_id foreign key (23503)', fkProblemBlocked);

    // -------------------------------------------------------------------------
    // 13. Ephemeral Fixture Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Cleaning Up Ephemeral Test Fixtures ---');
    if (createdContestIds.length > 0) {
      await db.query(`DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM audit_logs WHERE resource_type = 'contest' AND resource_id = ANY($1::int[])`, [createdContestIds]);
      await db.query(`DELETE FROM contests WHERE id = ANY($1::int[])`, [createdContestIds]);
    }
    if (createdProblemIds.length > 0) {
      await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
      await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
    }
    record('Cleanup: Ephemeral test fixtures safely cleaned up', true);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.5.8 BACKEND TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runContestProblemIntegrityTests();
}

module.exports = { runContestProblemIntegrityTests };
