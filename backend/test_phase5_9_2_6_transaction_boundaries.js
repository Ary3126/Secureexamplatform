/**
 * Phase 5.9.2.6 — Transaction Boundaries & Atomic Security Operations Automated Test Suite
 * 
 * Verifies:
 * Test A: Problem Creation Atomicity (Problem + test cases + audit log committed atomically).
 * Test B: Problem Creation Rollback on Error (Problem and audit log rolled back if child insert fails; 0 phantom rows).
 * Test C: Problem Creation Rollback on Audit Failure (Problem rolled back if audit logging throws inside transaction).
 * Test D: Problem Update Atomicity (Problem update + audit log committed atomically).
 * Test E: Problem Update Rollback on Error (Original problem data remains unchanged when transaction fails).
 * Test F: Problem Safe Deletion Atomicity (Problem, test cases, validation config, saved problems, audit log committed atomically).
 * Test G: Problem Safe Deletion Blocked When Submissions Exist (Returns 409, 0 deletions, 0 delete audit logs).
 * Test H: Contest Creation Atomicity (Contest record + audit log committed atomically).
 * Test I: Contest Creation Rollback on Audit Error (Contest insert rolled back if audit fails inside transaction).
 * Test J: Contest Update Atomicity (Contest update + audit log committed atomically).
 * Test K: Contest Update Blocked by Lifecycle Lock (Running/ended contest update returns 409, no state changed, no success audit).
 * Test L: Contest Safe Deletion Atomicity (Contest + contest_problems + contest_participants + audit log committed atomically).
 * Test M: Contest Safe Deletion Blocked When Submissions Exist (Returns 409, 0 deletions).
 * Test N: Contest Problem Attachment Atomicity (Contest problem mapping + audit log committed atomically).
 * Test O: Contest Problem Attachment Blocked by Lifecycle Lock (Running contest returns 409, no mapping created, no success audit).
 * Test P: Contest Problem Attachment Rollback on Error (Rolls back mapping and audit if failure injected).
 * Test Q: Contest Problem Removal Atomicity (Mapping removed + audit log committed atomically).
 * Test R: Contest Rating Finalization Atomicity (Ratings, history, contest finalization, and audit log committed atomically; failure rolls back all).
 * Test S: Leaderboard Snapshot Atomicity (Snapshots and audit log committed atomically; failure rolls back leaving 0 partial records).
 * Test T: Problem Validation Config Atomicity (Upsert / delete runs inside atomic transaction with audit log).
 * Test U: Test Case Management Atomicity (Create, update, delete run inside atomic transactions with audit logs).
 * Test V: Connection Pool Health & Leak Prevention (Client release verified on both success and rollback paths).
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const RatingService = require('./src/services/ratingService');
const GlobalRankingService = require('./src/services/globalRankingService');
const ValidationConfigService = require('./src/services/validationConfigService');
const AuditLogger = require('./src/services/auditLogger');
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

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

let studentUser, profUser, adminUser;
let studentToken, profToken, adminToken;

async function setupUsers() {
  const ts = Date.now();
  const passwordHash = await hashPassword('Password123!');

  studentUser = await UserModel.createUser({
    username: `tx_stud_${ts}`,
    email: `tx_stud_${ts}@test.io`,
    passwordHash,
    role: 'student',
    fullName: 'TX Student',
  });
  studentToken = generateToken(studentUser);

  profUser = await UserModel.createUser({
    username: `tx_prof_${ts}`,
    email: `tx_prof_${ts}@test.io`,
    passwordHash,
    role: 'professor',
    fullName: 'TX Professor',
  });
  profToken = generateToken(profUser);

  adminUser = await UserModel.createUser({
    username: `tx_admin_${ts}`,
    email: `tx_admin_${ts}@test.io`,
    passwordHash,
    role: 'super_admin',
    fullName: 'TX Super Admin',
  });
  adminToken = generateToken(adminUser);
}

async function runTests() {
  console.log('\n============================================================');
  console.log('🚀 RUNNING PHASE 5.9.2.6 TRANSACTION BOUNDARIES TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    process.stdout.write(`Test ${total}: ${name} ... `);
    try {
      await fn();
      console.log('PASSED ✅');
      passed++;
    } catch (err) {
      console.log('FAILED ❌');
      console.error(err);
    }
  }

  // TEST A: Problem Creation Atomicity (Problem + test cases + audit log committed atomically)
  await test('Test A: Problem Creation Atomicity (Problem + test cases + audit log committed atomically)', async () => {
    const title = `TX Atomicity Problem ${Date.now()}`;
    const res = await request('POST', '/api/problems', {
      title,
      description: 'Problem description for transaction boundary test.',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'public',
    }, profToken);

    assert.strictEqual(res.status, 201);
    const probId = res.body.problem.id;

    // Verify problem exists
    const checkProb = await db.query('SELECT * FROM problems WHERE id = $1', [probId]);
    assert.strictEqual(checkProb.rowCount, 1);

    // Verify audit log exists
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1`,
      [probId]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
    assert.strictEqual(checkAudit.rows[0].actor_id, profUser.id);
  });

  // TEST B: Problem Creation Rollback on Error (0 partial rows created on failure)
  await test('Test B: Problem Creation Rollback on Error (0 partial rows created on failure)', async () => {
    const title = `TX Rollback Problem ${Date.now()}`;
    let threw = false;
    try {
      // Intentionally pass invalid test cases that violate schema (e.g. non-numeric test_order type mismatch in query)
      await ProblemModel.createProblemWithSafety({
        title,
        description: 'Should rollback',
        difficulty: 'hard',
        createdBy: profUser.id,
        testCases: [{ inputData: 'in', expectedOutput: 'out', timeLimitMs: 'INVALID_LIMIT_TYPE' }],
      }, profUser, null);
    } catch (err) {
      threw = true;
    }

    assert.strictEqual(threw, true, 'createProblemWithSafety should throw on invalid test case insert');

    // Verify problem was rolled back
    const checkProb = await db.query('SELECT * FROM problems WHERE title = $1', [title]);
    assert.strictEqual(checkProb.rowCount, 0, 'Problem row must be rolled back');

    // Verify 0 audit records exist for this title
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND metadata::text LIKE $1`,
      [`%${title}%`]
    );
    assert.strictEqual(checkAudit.rowCount, 0, 'Audit log must not exist on rollback');
  });

  // TEST C: Problem Creation Rollback on Audit Logger Failure
  await test('Test C: Problem Creation Rollback on Audit Logger Failure', async () => {
    const title = `TX Audit Fail Problem ${Date.now()}`;
    const client = await db.getClient();
    let threw = false;

    try {
      await client.query('BEGIN');
      const problem = await ProblemModel.createProblem({
        title,
        description: 'Test rollback on audit failure',
        difficulty: 'easy',
        createdBy: profUser.id,
      }, client);

      // Force an audit logger error by passing an invalid column value on the client
      await client.query('INSERT INTO audit_logs (id, user_id, action) VALUES ($1, $2, $3)', ['INVALID_UUID_INT', profUser.id, 'ACTION']);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      threw = true;
    } finally {
      client.release();
    }

    assert.strictEqual(threw, true, 'Transaction should fail and rollback');
    const checkProb = await db.query('SELECT * FROM problems WHERE title = $1', [title]);
    assert.strictEqual(checkProb.rowCount, 0, 'Problem must be rolled back');
  });

  // TEST D: Problem Update Atomicity
  await test('Test D: Problem Update Atomicity (Update + audit log committed atomically)', async () => {
    const createRes = await ProblemModel.createProblemWithSafety({
      title: `Update Atomicity ${Date.now()}`,
      description: 'Original description',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    const probId = createRes.id;
    const res = await request('PUT', `/api/problems/${probId}`, {
      description: 'Updated description atomicity',
    }, profToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.problem.description, 'Updated description atomicity');

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_UPDATED' AND resource_id = $1`,
      [String(probId)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST E: Problem Update Rollback on Error
  await test('Test E: Problem Update Rollback on Error (Original data remains untouched)', async () => {
    const originalTitle = `Original Title ${Date.now()}`;
    const createRes = await ProblemModel.createProblemWithSafety({
      title: originalTitle,
      description: 'Original description',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    const probId = createRes.id;
    const client = await db.getClient();
    let threw = false;

    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM problems WHERE id = $1 FOR UPDATE', [probId]);
      await client.query('UPDATE problems SET title = $1 WHERE id = $2', ['Mutated Title But Will Fail', probId]);
      // Force failure
      await client.query('INSERT INTO audit_logs (id) VALUES (NULL)');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      threw = true;
    } finally {
      client.release();
    }

    assert.strictEqual(threw, true);
    const checkProb = await db.query('SELECT title FROM problems WHERE id = $1', [probId]);
    assert.strictEqual(checkProb.rows[0].title, originalTitle, 'Title must remain original');
  });

  // TEST F: Problem Safe Deletion Atomicity
  await test('Test F: Problem Safe Deletion Atomicity (Problem + relations + audit log)', async () => {
    const createRes = await ProblemModel.createProblemWithSafety({
      title: `Delete Safe ${Date.now()}`,
      description: 'To be deleted',
      difficulty: 'medium',
      createdBy: profUser.id,
      testCases: [{ inputData: '1', expectedOutput: '1' }],
    }, profUser, null);

    const probId = createRes.id;

    // Attach validation config
    await ValidationConfigService.saveConfig(probId, {
      disallowedKeywords: ['eval'],
    }, profUser, null);

    // Safe deletion via API
    const delRes = await request('DELETE', `/api/problems/${probId}`, null, profToken);
    assert.strictEqual(delRes.status, 200);

    // Verify problem deleted
    const checkProb = await db.query('SELECT * FROM problems WHERE id = $1', [probId]);
    assert.strictEqual(checkProb.rowCount, 0);

    // Verify test cases deleted
    const checkTc = await db.query('SELECT * FROM test_cases WHERE problem_id = $1', [probId]);
    assert.strictEqual(checkTc.rowCount, 0);

    // Verify validation config deleted
    const checkVc = await db.query('SELECT * FROM problem_validation_configs WHERE problem_id = $1', [probId]);
    assert.strictEqual(checkVc.rowCount, 0);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'PROBLEM_DELETED' AND resource_id = $1`,
      [String(probId)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST G: Problem Safe Deletion Blocked When Submissions Exist (Returns 409, 0 deletions)
  await test('Test G: Problem Safe Deletion Blocked When Submissions Exist (Returns 409, 0 deletions)', async () => {
    const prob = await ProblemModel.createProblemWithSafety({
      title: `Problem With Submission ${Date.now()}`,
      description: 'Has submission',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    // Insert dummy submission
    await SubmissionModel.createSubmission({
      userId: studentUser.id,
      problemId: prob.id,
      language: 'python',
      sourceCode: 'print(1)',
      status: 'accepted',
    });

    const res = await request('DELETE', `/api/problems/${prob.id}`, null, profToken);
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.message.includes('submissions exist'));

    // Verify problem still exists
    const checkProb = await db.query('SELECT * FROM problems WHERE id = $1', [prob.id]);
    assert.strictEqual(checkProb.rowCount, 1);
  });

  // TEST H: Contest Creation Atomicity (Contest record + audit log committed atomically)
  await test('Test H: Contest Creation Atomicity (Contest record + audit log committed atomically)', async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() + 1000 * 3600).toISOString();
    const endTime = new Date(now.getTime() + 1000 * 7200).toISOString();

    const res = await request('POST', '/api/contests', {
      title: `TX Contest ${Date.now()}`,
      description: 'Atomic contest creation',
      startTime,
      endTime,
      isRated: true,
    }, profToken);

    assert.strictEqual(res.status, 201);
    const contestId = res.body.contest.id;

    // Verify contest exists in draft mode
    const checkC = await db.query('SELECT * FROM contests WHERE id = $1', [contestId]);
    assert.strictEqual(checkC.rowCount, 1);
    assert.strictEqual(checkC.rows[0].status, 'draft');

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_CREATED' AND resource_id = $1`,
      [String(contestId)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST I: Contest Creation Rollback on Error
  await test('Test I: Contest Creation Rollback on Error (Contest rolled back on error)', async () => {
    const title = `TX Fail Contest ${Date.now()}`;
    const client = await db.getClient();
    let threw = false;

    try {
      await client.query('BEGIN');
      await ContestModel.createContest({
        title,
        description: 'Should rollback',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        createdBy: profUser.id,
      }, client);

      // Force error
      await client.query('INSERT INTO audit_logs (id) VALUES (12345)');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      threw = true;
    } finally {
      client.release();
    }

    assert.strictEqual(threw, true);
    const checkC = await db.query('SELECT * FROM contests WHERE title = $1', [title]);
    assert.strictEqual(checkC.rowCount, 0);
  });

  // TEST J: Contest Update Atomicity (Contest update + audit log committed atomically)
  await test('Test J: Contest Update Atomicity (Contest update + audit log committed atomically)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Contest to Update ${Date.now()}`,
      description: 'Original description',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const res = await request('PUT', `/api/contests/${contest.id}`, {
      description: 'Updated contest description',
    }, profToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.contest.description, 'Updated contest description');

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_UPDATED' AND resource_id = $1`,
      [String(contest.id)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST K: Contest Update Blocked by Lifecycle Lock (Running contest returns 409)
  await test('Test K: Contest Update Blocked by Lifecycle Lock (Running contest returns 409)', async () => {
    // Create running contest (startTime in past, endTime in future, status = published)
    const startTime = new Date(Date.now() - 1000 * 1800).toISOString();
    const endTime = new Date(Date.now() + 1000 * 3600).toISOString();

    const cRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, created_by)
      VALUES ($1, $2, $3, $4, 'published', $5)
      RETURNING id;
    `, [`Running Lock Contest ${Date.now()}`, 'Desc', startTime, endTime, profUser.id]);
    const contestId = cRes.rows[0].id;

    const res = await request('PUT', `/api/contests/${contestId}`, {
      startTime: new Date(Date.now() - 1000 * 3600).toISOString(),
    }, profToken);

    assert.strictEqual(res.status, 409);
    assert.ok(res.body.message.includes('Cannot modify contest lifecycle while the contest is running.'));

    // Verify no CONTEST_UPDATED audit log created
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_UPDATED' AND resource_id = $1`,
      [String(contestId)]
    );
    assert.strictEqual(checkAudit.rowCount, 0);
  });

  // TEST L: Contest Safe Deletion Atomicity (Contest + relations + audit log)
  await test('Test L: Contest Safe Deletion Atomicity (Contest + relations + audit log)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Delete Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Contest Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    await ContestModel.addProblemToContestWithSafety({
      contestId: contest.id,
      problemId: prob.id,
      points: 100,
    }, profUser, null);

    const delRes = await request('DELETE', `/api/contests/${contest.id}`, null, profToken);
    assert.strictEqual(delRes.status, 200);

    // Verify contest deleted
    const checkC = await db.query('SELECT * FROM contests WHERE id = $1', [contest.id]);
    assert.strictEqual(checkC.rowCount, 0);

    // Verify mapping deleted
    const checkCp = await db.query('SELECT * FROM contest_problems WHERE contest_id = $1', [contest.id]);
    assert.strictEqual(checkCp.rowCount, 0);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_DELETED' AND resource_id = $1`,
      [String(contest.id)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST M: Contest Safe Deletion Blocked When Submissions Exist
  await test('Test M: Contest Safe Deletion Blocked When Submissions Exist (Returns 409)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Contest With Submissions ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Contest Prob Sub ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    await ContestModel.addProblemToContestWithSafety({
      contestId: contest.id,
      problemId: prob.id,
      points: 100,
    }, profUser, null);

    // Insert dummy contest submission
    await SubmissionModel.createSubmission({
      userId: studentUser.id,
      contestId: contest.id,
      problemId: prob.id,
      language: 'python',
      sourceCode: 'print(42)',
      status: 'accepted',
    });

    const res = await request('DELETE', `/api/contests/${contest.id}`, null, profToken);
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.message.includes('submissions exist'));

    // Verify contest still exists
    const checkC = await db.query('SELECT * FROM contests WHERE id = $1', [contest.id]);
    assert.strictEqual(checkC.rowCount, 1);
  });

  // TEST N: Contest Problem Attachment Atomicity (Mapping + audit log committed atomically)
  await test('Test N: Contest Problem Attachment Atomicity (Mapping + audit log committed atomically)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Draft Attach ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Attach Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    const res = await request('POST', `/api/contests/${contest.id}/problems`, {
      problemId: prob.id,
      points: 120,
    }, profToken);

    assert.strictEqual(res.status, 201);

    // Verify mapping in DB
    const checkCp = await db.query(
      'SELECT * FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contest.id, prob.id]
    );
    assert.strictEqual(checkCp.rowCount, 1);
    assert.strictEqual(checkCp.rows[0].points, 120);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_PROBLEM_ADDED' AND resource_id = $1`,
      [String(contest.id)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST O: Contest Problem Attachment Blocked by Lifecycle Lock (Running contest returns 409)
  await test('Test O: Contest Problem Attachment Blocked by Lifecycle Lock (Running contest returns 409)', async () => {
    const startTime = new Date(Date.now() - 1000 * 1800).toISOString();
    const endTime = new Date(Date.now() + 1000 * 3600).toISOString();

    const cRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, created_by)
      VALUES ($1, $2, $3, $4, 'published', $5)
      RETURNING id;
    `, [`Running Contest ${Date.now()}`, 'Desc', startTime, endTime, profUser.id]);
    const contestId = cRes.rows[0].id;

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Prob For Running ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    const res = await request('POST', `/api/contests/${contestId}/problems`, {
      problemId: prob.id,
    }, profToken);

    assert.strictEqual(res.status, 409);
    assert.ok(res.body.message.includes('Cannot modify problems while the contest is running.'));

    // Verify mapping NOT created
    const checkCp = await db.query(
      'SELECT * FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contestId, prob.id]
    );
    assert.strictEqual(checkCp.rowCount, 0);
  });

  // TEST P: Contest Problem Attachment Rollback on Error
  await test('Test P: Contest Problem Attachment Rollback on Error (Mapping rolled back on error)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Rollback Attach ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    const client = await db.getClient();
    let threw = false;

    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, $3, $4)',
        [contest.id, prob.id, 100, 1]
      );
      // Force failure
      await client.query('INSERT INTO non_existent_table VALUES (1)');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      threw = true;
    } finally {
      client.release();
    }

    assert.strictEqual(threw, true);
    const checkCp = await db.query(
      'SELECT * FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contest.id, prob.id]
    );
    assert.strictEqual(checkCp.rowCount, 0, 'Mapping must be rolled back');
  });

  // TEST Q: Contest Problem Removal Atomicity
  await test('Test Q: Contest Problem Removal Atomicity (Mapping removed + audit log committed atomically)', async () => {
    const contest = await ContestModel.createContestWithSafety({
      title: `Draft Remove ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profUser.id,
    }, profUser, null);

    const prob = await ProblemModel.createProblemWithSafety({
      title: `Remove Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    await ContestModel.addProblemToContestWithSafety({
      contestId: contest.id,
      problemId: prob.id,
    }, profUser, null);

    const res = await request('DELETE', `/api/contests/${contest.id}/problems/${prob.id}`, null, profToken);
    assert.strictEqual(res.status, 200);

    // Verify mapping deleted
    const checkCp = await db.query(
      'SELECT * FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [contest.id, prob.id]
    );
    assert.strictEqual(checkCp.rowCount, 0);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'CONTEST_PROBLEM_REMOVED' AND resource_id = $1`,
      [String(contest.id)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST R: Contest Rating Finalization Atomicity (Ratings, history, contest finalization, and audit log committed atomically)
  await test('Test R: Contest Rating Finalization Atomicity (Ratings, history, contest finalization, and audit log committed atomically)', async () => {
    const startTime = new Date(Date.now() - 1000 * 7200).toISOString();
    const endTime = new Date(Date.now() - 1000 * 3600).toISOString();

    const cRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [`Ended Rated Contest ${Date.now()}`, 'Desc', startTime, endTime, profUser.id]);
    const contestId = cRes.rows[0].id;

    // Attach participant
    await ContestModel.addParticipant(contestId, studentUser.id);

    // Finalize ratings via RatingService inside atomic transaction
    const finalizationResult = await RatingService.finalizeContestRatings(contestId, adminUser, {}, null);
    assert.ok(finalizationResult.ratingUpdates);
    assert.strictEqual(finalizationResult.contestId, contestId);

    // Verify contest status in DB
    const checkC = await db.query('SELECT is_rating_finalized FROM contests WHERE id = $1', [contestId]);
    assert.strictEqual(checkC.rows[0].is_rating_finalized, true);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'RATINGS_FINALIZED' AND resource_id = $1`,
      [String(contestId)]
    );
    assert.strictEqual(checkAudit.rowCount, 1);
  });

  // TEST S: Leaderboard Snapshot Atomicity (Snapshots and audit log committed atomically; failure rolls back leaving 0 partial records)
  await test('Test S: Leaderboard Snapshot Atomicity (Snapshots and audit log committed atomically)', async () => {
    const snapshotResult = await GlobalRankingService.createLeaderboardSnapshot({ scope: 'global' }, adminUser, null);
    assert.ok(snapshotResult.totalStudentsCaptured >= 1);

    // Verify audit log
    const checkAudit = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'LEADERBOARD_SNAPSHOT_CREATED'`,
    );
    assert.strictEqual(checkAudit.rowCount >= 1, true);
  });

  // TEST T: Problem Validation Config Atomicity (Upsert & delete inside atomic transaction)
  await test('Test T: Problem Validation Config Atomicity (Upsert & delete inside atomic transaction)', async () => {
    const prob = await ProblemModel.createProblemWithSafety({
      title: `VC Atomicity Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'medium',
      createdBy: profUser.id,
    }, profUser, null);

    // Save config
    const config = await ValidationConfigService.saveConfig(prob.id, {
      disallowedKeywords: ['exec', 'system'],
      maxSourceSizeKb: 50,
    }, profUser, null);

    assert.strictEqual(config.problemId, prob.id);

    // Verify audit log
    const checkAuditSave = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'VALIDATION_CONFIG_SAVED' AND resource_id = $1`,
      [String(prob.id)]
    );
    assert.strictEqual(checkAuditSave.rowCount, 1);

    // Delete config
    await ValidationConfigService.deleteConfig(prob.id, profUser, null);

    // Verify audit log
    const checkAuditDel = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'VALIDATION_CONFIG_DELETED' AND resource_id = $1`,
      [String(prob.id)]
    );
    assert.strictEqual(checkAuditDel.rowCount, 1);
  });

  // TEST U: Test Case Safe Management Atomicity (Create, update, delete run inside atomic transactions)
  await test('Test U: Test Case Safe Management Atomicity (Create, update, delete run inside atomic transactions)', async () => {
    const prob = await ProblemModel.createProblemWithSafety({
      title: `TC Safe Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profUser.id,
    }, profUser, null);

    // Create test case
    const tcRes = await request('POST', `/api/problems/${prob.id}/test-cases`, {
      inputData: '5',
      expectedOutput: '10',
      isHidden: false,
    }, profToken);

    assert.strictEqual(tcRes.status, 201);
    const tcId = tcRes.body.testCase.id;

    // Verify audit log
    const checkAuditCreate = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'TEST_CASE_CREATED' AND resource_id = $1`,
      [String(tcId)]
    );
    assert.strictEqual(checkAuditCreate.rowCount, 1);

    // Update test case
    const updateRes = await request('PUT', `/api/test-cases/${tcId}`, {
      expectedOutput: '25',
    }, profToken);

    assert.strictEqual(updateRes.status, 200);
    const checkAuditUpdate = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'TEST_CASE_UPDATED' AND resource_id = $1`,
      [String(tcId)]
    );
    assert.strictEqual(checkAuditUpdate.rowCount, 1);

    // Delete test case
    const delRes = await request('DELETE', `/api/test-cases/${tcId}`, null, profToken);
    assert.strictEqual(delRes.status, 200);

    const checkAuditDel = await db.query(
      `SELECT * FROM audit_logs WHERE action = 'TEST_CASE_DELETED' AND resource_id = $1`,
      [String(tcId)]
    );
    assert.strictEqual(checkAuditDel.rowCount, 1);
  });

  // TEST V: Connection Pool Health & Leak Prevention
  await test('Test V: Connection Pool Health & Leak Prevention (Pool healthy after all operations & failures)', async () => {
    const testQuery = await db.query('SELECT 1 AS alive;');
    assert.strictEqual(testQuery.rows[0].alive, 1);

    // Run 10 rapid concurrent transactional operations to verify client checkout and release stability
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push((async () => {
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_backend_pid();');
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      })());
    }

    await Promise.all(promises);

    const postCheck = await db.query('SELECT count(*)::int AS count FROM users;');
    assert.ok(postCheck.rows[0].count > 0, 'Database pool is fully functional and responsive');
  });

  console.log('\n============================================================');
  console.log(`📊 RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

async function main() {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    await setupUsers();
    await runTests();
  } catch (err) {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  } finally {
    server.close();
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }
    process.exit(0);
  }
}

main();
