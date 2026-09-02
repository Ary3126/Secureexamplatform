/**
 * Phase 5.9.2.1 Security Test Suite:
 * Submission Source-Code BOLA/IDOR Authorization Verification
 * 
 * Verifies that GET /api/submissions/:id/code strictly enforces:
 * - Student: Own code only
 * - Professor: Resource ownership only (owns problem OR owns contest)
 * - Public visibility does NOT grant professor access
 * - Super Admin: Full platform-wide access
 * - Non-existent & unauthenticated error handling
 * - Resistance to sequential ID enumeration
 */

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');

const { generateToken } = require('./src/services/authService');

let server;
let port;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 
      'Content-Type': 'application/json',
      'x-test-environment': 'true',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.9.2.1 BOLA/IDOR SECURITY VERIFICATION');
  console.log(' Target: GET /api/submissions/:id/code');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(title, condition, detail = '') {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} - ${detail}`);
      failed++;
    }
  }

  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6'; // Password123!

  try {
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. SETUP ACTORS
    // -------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');

    const studentA = await UserModel.createUser({
      username: `student_a_592_${ts}`,
      email: `student_a_592_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Alpha',
    });

    const studentB = await UserModel.createUser({
      username: `student_b_592_${ts}`,
      email: `student_b_592_${ts}@test.com`,
      passwordHash,
      role: 'student',
      fullName: 'Student Beta',
    });

    const profA = await UserModel.createUser({
      username: `prof_a_592_${ts}`,
      email: `prof_a_592_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Alpha',
    });

    const profB = await UserModel.createUser({
      username: `prof_b_592_${ts}`,
      email: `prof_b_592_${ts}@test.com`,
      passwordHash,
      role: 'professor',
      fullName: 'Professor Beta',
    });

    const superAdmin = await UserModel.createUser({
      username: `admin_592_${ts}`,
      email: `admin_592_${ts}@test.com`,
      passwordHash,
      role: 'super_admin',
      fullName: 'Platform Super Admin',
    });

    // Direct synchronous tokens
    const tokenStudentA = generateToken(studentA);
    const tokenStudentB = generateToken(studentB);
    const tokenProfA = generateToken(profA);
    const tokenProfB = generateToken(profB);
    const tokenAdmin = generateToken(superAdmin);

    record('Test actors created and authenticated successfully', !!(tokenStudentA && tokenStudentB && tokenProfA && tokenProfB && tokenAdmin));

    // -------------------------------------------------------------------
    // 2. SETUP PROBLEMS & CONTESTS
    // -------------------------------------------------------------------
    console.log('\n--- 2. Setting Up Problems and Contests ---');

    // Problem A: Created by Professor A (Private)
    const probA_priv = await ProblemModel.createProblem({
      title: `Problem A Private ${ts}`,
      description: 'Owned by Professor A',
      difficulty: 'medium',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'contest_private',
    });

    // Problem A: Created by Professor A (Public)
    const probA_pub = await ProblemModel.createProblem({
      title: `Problem A Public ${ts}`,
      description: 'Public problem created by Professor A',
      difficulty: 'easy',
      codingMode: 'function',
      createdBy: profA.id,
      accessScope: 'public',
    });

    // Problem B: Created by Professor B (Private)
    const probB_priv = await ProblemModel.createProblem({
      title: `Problem B Private ${ts}`,
      description: 'Owned by Professor B',
      difficulty: 'hard',
      codingMode: 'function',
      createdBy: profB.id,
      accessScope: 'contest_private',
    });

    // Contest A: Created by Professor A
    const contestA = await ContestModel.createContest({
      title: `Contest A ${ts}`,
      description: 'Created by Prof A',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 7200000),
      createdBy: profA.id,
      status: 'published',
    });

    // Contest B: Created by Professor B
    const contestB = await ContestModel.createContest({
      title: `Contest B ${ts}`,
      description: 'Created by Prof B',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 7200000),
      createdBy: profB.id,
      status: 'published',
    });

    // Cross-attachment:
    // Contest A attaches Problem B (Contest owned by Prof A, Problem owned by Prof B)
    await ContestModel.addProblemToContest({ contestId: contestA.id, problemId: probB_priv.id, points: 100, problemOrder: 1 });
    // Contest B attaches Problem A (Contest owned by Prof B, Problem owned by Prof A)
    await ContestModel.addProblemToContest({ contestId: contestB.id, problemId: probA_priv.id, points: 100, problemOrder: 1 });

    record('Problems and cross-owned contests configured in database', true);

    // -------------------------------------------------------------------
    // 3. SETUP SUBMISSIONS
    // -------------------------------------------------------------------
    console.log('\n--- 3. Creating Diverse Submissions ---');

    const code1 = '// Sub 1: Student A on Prob A in Contest A (Both owned by Prof A)';
    const sub1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contestA.id,
      problemId: probA_priv.id,
      language: 'cpp',
      sourceCode: code1,
      status: 'accepted',
      score: 100,
    });

    const code2 = '// Sub 2: Student B on Prob B in Contest B (Both owned by Prof B)';
    const sub2 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contestB.id,
      problemId: probB_priv.id,
      language: 'python',
      sourceCode: code2,
      status: 'accepted',
      score: 100,
    });

    const code3 = '// Sub 3: Student A on Public Prob A in Practice (No contest, Prob owned by Prof A)';
    const sub3 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: null,
      problemId: probA_pub.id,
      language: 'cpp',
      sourceCode: code3,
      status: 'accepted',
      score: 100,
    });

    const code4 = '// Sub 4: Student A on Prob A in Contest B (Problem owned by Prof A, Contest owned by Prof B)';
    const sub4 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contestB.id,
      problemId: probA_priv.id,
      language: 'cpp',
      sourceCode: code4,
      status: 'accepted',
      score: 100,
    });

    const code5 = '// Sub 5: Student B on Prob B in Contest A (Problem owned by Prof B, Contest owned by Prof A)';
    const sub5 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      contestId: contestA.id,
      problemId: probB_priv.id,
      language: 'java',
      sourceCode: code5,
      status: 'accepted',
      score: 100,
    });

    const codeProfSelf = '// Sub ProfSelf: Professor A solving own problem';
    const subProfSelf = await SubmissionModel.createSubmission({
      userId: profA.id,
      contestId: contestA.id,
      problemId: probA_priv.id,
      language: 'cpp',
      sourceCode: codeProfSelf,
      status: 'accepted',
      score: 100,
    });

    record('Submissions seeded across all test scenarios', true);

    // -------------------------------------------------------------------
    // 4. TEST EXECUTION MATRIX
    // -------------------------------------------------------------------
    console.log('\n--- 4. Executing Mandatory Security Test Matrix ---');

    // TEST 1: Student A -> own submission code
    const res1 = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenStudentA);
    record('TEST 1: Student A can retrieve own submission code (200 OK)', res1.status === 200 && res1.body.sourceCode === code1);

    // TEST 2: Student A -> Student B's submission code
    const res2 = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenStudentA);
    record('TEST 2: Student A blocked from Student B submission code (403 Forbidden)', res2.status === 403 && !res2.body.sourceCode);

    // TEST 3: Professor A -> submission for Professor A's problem
    const res3 = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenProfA);
    record('TEST 3: Professor A can access submission for Professor A problem (200 OK)', res3.status === 200 && res3.body.sourceCode === code1);

    // TEST 4: Professor A -> submission for Professor A's contest
    const res4 = await request('GET', `/api/submissions/${sub5.id}/code`, null, tokenProfA);
    record('TEST 4: Professor A can access submission for Professor A contest (200 OK)', res4.status === 200 && res4.body.sourceCode === code5);

    // TEST 5: Professor A -> submission for Professor B's problem & contest
    const res5 = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenProfA);
    record('TEST 5: Professor A BLOCKED from Professor B problem & contest (403 Forbidden)', res5.status === 403 && !res5.body.sourceCode);

    // TEST 6: Professor A -> submission for Professor B's contest (when Prof A does NOT own problem or contest)
    record('TEST 6: Professor A blocked from non-owned contest submissions (403 Forbidden)', res5.status === 403);

    // TEST 7: Professor B -> submission for Professor A's public problem practice run
    const res7 = await request('GET', `/api/submissions/${sub3.id}/code`, null, tokenProfB);
    record('TEST 7: Public problem status DOES NOT grant non-author professor access (403 Forbidden)',
      res7.status === 403 && !res7.body.sourceCode,
      `Received status: ${res7.status}`
    );

    // TEST 8: Professor A owns the problem but NOT the contest
    const res8 = await request('GET', `/api/submissions/${sub4.id}/code`, null, tokenProfA);
    record('TEST 8: Professor A can access code when owning problem (even in Prof B contest) (200 OK)',
      res8.status === 200 && res8.body.sourceCode === code4
    );

    // TEST 9: Professor A owns the contest but NOT the problem
    const res9 = await request('GET', `/api/submissions/${sub5.id}/code`, null, tokenProfA);
    record('TEST 9: Professor A can access code when owning contest (even with Prof B problem) (200 OK)',
      res9.status === 200 && res9.body.sourceCode === code5
    );

    // Also verify Prof B can access sub4 (owns contest) and sub5 (owns problem)
    const resProfB_sub4 = await request('GET', `/api/submissions/${sub4.id}/code`, null, tokenProfB);
    record('TEST 9b: Professor B can access sub4 as contest owner (200 OK)',
      resProfB_sub4.status === 200 && resProfB_sub4.body.sourceCode === code4
    );
    const resProfB_sub5 = await request('GET', `/api/submissions/${sub5.id}/code`, null, tokenProfB);
    record('TEST 9c: Professor B can access sub5 as problem owner (200 OK)',
      resProfB_sub5.status === 200 && resProfB_sub5.body.sourceCode === code5
    );

    // TEST 10: Super Admin -> arbitrary submission code
    const res10_1 = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenAdmin);
    const res10_2 = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenAdmin);
    const res10_3 = await request('GET', `/api/submissions/${sub3.id}/code`, null, tokenAdmin);
    record('TEST 10: Super Admin retains platform-wide access to all submissions (200 OK)',
      res10_1.status === 200 && res10_2.status === 200 && res10_3.status === 200
    );

    // TEST 11: Non-existent submission ID
    const res11 = await request('GET', '/api/submissions/99999999/code', null, tokenProfA);
    record('TEST 11: Non-existent submission ID returns 404 Not Found', res11.status === 404);

    // TEST 12: Unauthenticated request
    const res12 = await request('GET', `/api/submissions/${sub1.id}/code`);
    record('TEST 12: Unauthenticated request returns 401 Unauthorized', res12.status === 401);

    // -------------------------------------------------------------------
    // 5. BOLA / IDOR ENUMERATION RESISTANCE
    // -------------------------------------------------------------------
    console.log('\n--- 5. Testing ID Enumeration & Parameter Tampering Resistance ---');

    // Professor B attempts to sequentially guess submission IDs belonging to Professor A
    const unauthorizedIds = [sub1.id, sub3.id];
    let allDenied = true;
    let anyCodeLeaked = false;

    for (const targetId of unauthorizedIds) {
      const enumRes = await request('GET', `/api/submissions/${targetId}/code`, null, tokenProfB);
      if (enumRes.status !== 403) allDenied = false;
      if (enumRes.body?.sourceCode) anyCodeLeaked = true;
    }

    record('BOLA ENUMERATION: Professor B cannot enumerate & view unauthorized submission code', allDenied);
    record('LEAKAGE PROTECTION: Zero source code leaked across unauthorized attempts', !anyCodeLeaked);

    // Professor views own submission code
    const selfRes = await request('GET', `/api/submissions/${subProfSelf.id}/code`, null, tokenProfA);
    record('PROFESSOR SELF ACCESS: Professor can retrieve code for own submission (200 OK)',
      selfRes.status === 200 && selfRes.body.sourceCode === codeProfSelf
    );

    // -------------------------------------------------------------------
    // 6. CLEANUP
    // -------------------------------------------------------------------
    console.log('\n--- 6. Cleaning Up Ephemeral Test Fixtures ---');

    await db.query('DELETE FROM submissions WHERE id IN ($1, $2, $3, $4, $5, $6)', [
      sub1.id, sub2.id, sub3.id, sub4.id, sub5.id, subProfSelf.id,
    ]);
    await db.query('DELETE FROM contest_problems WHERE contest_id IN ($1, $2)', [contestA.id, contestB.id]);
    await db.query('DELETE FROM contests WHERE id IN ($1, $2)', [contestA.id, contestB.id]);
    await db.query('DELETE FROM problems WHERE id IN ($1, $2, $3)', [probA_priv.id, probA_pub.id, probB_priv.id]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [
      studentA.id, studentB.id, profA.id, profB.id, superAdmin.id,
    ]);

    record('CLEANUP: Test fixtures cleanly purged from database', true);

  } catch (err) {
    console.error('\n[UNEXPECTED TEST EXCEPTION]:', err);
    failed++;
  } finally {
    if (server) server.close();
    if (db.pool && db.pool.end) await db.pool.end();

    console.log('\n=======================================================');
    console.log(` PHASE 5.9.2.1 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
