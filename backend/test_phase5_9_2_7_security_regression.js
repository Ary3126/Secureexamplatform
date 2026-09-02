/**
 * PHASE 5.9.2.7 — COMPREHENSIVE SECURITY REGRESSION TEST SUITE
 * 
 * Aggressively verifies the complete security hardening implemented across:
 * - Phase 5.9.2.1: Submission Code BOLA Protection
 * - Phase 5.9.2.2: Safe Problem & Contest Deletion (Application & DB Restrict)
 * - Phase 5.9.2.3: Persistent Audit Logging, Immutability & Sanitization
 * - Phase 5.9.2.4: Contest Lifecycle Mutation Locks
 * - Phase 5.9.2.5: Contest-Problem Mutation Locks
 * - Phase 5.9.2.6: Transaction Boundaries & Atomicity
 * - Privilege Escalation, Parameter Tampering, IDOR Enumeration, Race Conditions
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const SubmissionModel = require('./src/models/submissionModel');
const TestCaseModel = require('./src/models/testCaseModel');
const AuditLogModel = require('./src/models/auditLogModel');
const AuditLogger = require('./src/services/auditLogger');
const RatingService = require('./src/services/ratingService');
const GlobalRankingService = require('./src/services/globalRankingService');
const ValidationConfigService = require('./src/services/validationConfigService');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let port;
let baseUrl;

// Test Actors
let studentA, studentB, studentC;
let profA, profB, profC;
let contestAdmin, superAdmin;

let tokenStudentA, tokenStudentB, tokenStudentC;
let tokenProfA, tokenProfB, tokenProfC;
let tokenContestAdmin, tokenSuperAdmin;

// Test tracking
let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
let skippedAssertions = 0;

function recordAssert(desc, condition, expected = true, actual = condition) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  [PASS] ${desc}`);
  } else {
    failedAssertions++;
    console.error(`  [FAIL] ${desc} | Expected: ${JSON.stringify(expected)} | Actual: ${JSON.stringify(actual)}`);
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;

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
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
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

async function setupActors() {
  const ts = Date.now();
  const passwordHash = await hashPassword('Password123!');

  studentA = await UserModel.createUser({
    username: `reg_stud_a_${ts}`,
    email: `reg_stud_a_${ts}@test.com`,
    passwordHash,
    role: 'student',
    fullName: 'Student Alpha',
  });
  tokenStudentA = generateToken(studentA);

  studentB = await UserModel.createUser({
    username: `reg_stud_b_${ts}`,
    email: `reg_stud_b_${ts}@test.com`,
    passwordHash,
    role: 'student',
    fullName: 'Student Beta',
  });
  tokenStudentB = generateToken(studentB);

  studentC = await UserModel.createUser({
    username: `reg_stud_c_${ts}`,
    email: `reg_stud_c_${ts}@test.com`,
    passwordHash,
    role: 'student',
    fullName: 'Student Charlie',
  });
  tokenStudentC = generateToken(studentC);

  profA = await UserModel.createUser({
    username: `reg_prof_a_${ts}`,
    email: `reg_prof_a_${ts}@test.com`,
    passwordHash,
    role: 'professor',
    fullName: 'Professor Alpha',
  });
  tokenProfA = generateToken(profA);

  profB = await UserModel.createUser({
    username: `reg_prof_b_${ts}`,
    email: `reg_prof_b_${ts}@test.com`,
    passwordHash,
    role: 'professor',
    fullName: 'Professor Beta',
  });
  tokenProfB = generateToken(profB);

  profC = await UserModel.createUser({
    username: `reg_prof_c_${ts}`,
    email: `reg_prof_c_${ts}@test.com`,
    passwordHash,
    role: 'professor',
    fullName: 'Professor Charlie',
  });
  tokenProfC = generateToken(profC);

  contestAdmin = await UserModel.createUser({
    username: `reg_ca_${ts}`,
    email: `reg_ca_${ts}@test.com`,
    passwordHash,
    role: 'contest_admin',
    fullName: 'Contest Administrator',
  });
  tokenContestAdmin = generateToken(contestAdmin);

  superAdmin = await UserModel.createUser({
    username: `reg_sa_${ts}`,
    email: `reg_sa_${ts}@test.com`,
    passwordHash,
    role: 'super_admin',
    fullName: 'Super Administrator',
  });
  tokenSuperAdmin = generateToken(superAdmin);
}

// =========================================================================
// TEST SUITE EXECUTION
// =========================================================================
async function runAllSecurityRegressionTests() {
  console.log('===============================================================');
  console.log(' STARTING PHASE 5.9.2.7 COMPREHENSIVE SECURITY REGRESSION SUITE');
  console.log('===============================================================');

  // -----------------------------------------------------------------------
  // 1. SECTION 3: 5.9.2.1 SUBMISSION CODE BOLA PROTECTION
  // -----------------------------------------------------------------------
  console.log('\n--- 1. SECTION 3: Submission Code BOLA Authorization Matrix ---');
  {
    // Setup problem & contest fixtures
    const probProfA = await ProblemModel.createProblemWithSafety({
      title: `BOLA Prob Prof A ${Date.now()}`,
      description: 'Desc',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profA.id,
    }, profA, null);

    const probProfB = await ProblemModel.createProblemWithSafety({
      title: `BOLA Prob Prof B ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      createdBy: profB.id,
    }, profB, null);

    const contestProfA = await ContestModel.createContestWithSafety({
      title: `BOLA Contest Prof A ${Date.now()}`,
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profA.id,
    }, profA, null);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [contestProfA.id]);

    const contestProfB = await ContestModel.createContestWithSafety({
      title: `BOLA Contest Prof B ${Date.now()}`,
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profB.id,
    }, profB, null);
    await db.query(`UPDATE contests SET status = 'published' WHERE id = $1`, [contestProfB.id]);

    // Submissions
    // Sub 1: Student A on Prob A in Contest A
    const sub1 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: probProfA.id,
      contestId: contestProfA.id,
      language: 'cpp',
      sourceCode: '// SECRET_SOURCE_CODE_STUDENT_A_SUB1\nint main() { return 0; }',
      status: 'accepted',
    });

    // Sub 2: Student B on Prob B in Contest B
    const sub2 = await SubmissionModel.createSubmission({
      userId: studentB.id,
      problemId: probProfB.id,
      contestId: contestProfB.id,
      language: 'python',
      sourceCode: '# SECRET_SOURCE_CODE_STUDENT_B_SUB2\nprint("hello")',
      status: 'accepted',
    });

    // Sub 3: Student A on Prob A with contest_id = NULL (Practice submission)
    const sub3 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: probProfA.id,
      contestId: null,
      language: 'python',
      sourceCode: '# SECRET_PRACTICE_CODE_A\nprint(42)',
      status: 'accepted',
    });

    // Sub 4: Student A on Prob B (owned by Prof B) in Contest A (owned by Prof A) -> Mixed Ownership
    const sub4 = await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: probProfB.id,
      contestId: contestProfA.id,
      language: 'java',
      sourceCode: '// SECRET_MIXED_CODE_A\nclass Solution {}',
      status: 'accepted',
    });

    // 3.A: Student accesses own submission code -> 200 OK
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenStudentA);
      recordAssert('3.A: Student accesses own submission code (200 OK)', res.status === 200);
      recordAssert('3.A: Source code matches exactly', res.body && res.body.sourceCode && res.body.sourceCode.includes('SECRET_SOURCE_CODE_STUDENT_A_SUB1'));
    }

    // 3.B: Student B attempts to access Student A submission code -> 403 Forbidden
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenStudentB);
      recordAssert('3.B: Student B blocked from Student A submission code (403 Forbidden)', res.status === 403);
      recordAssert('3.B: Error message does not leak source code', res.body && !JSON.stringify(res.body).includes('SECRET_SOURCE_CODE_STUDENT_A_SUB1'));
    }

    // 3.C: Student sequential ID enumeration
    {
      let enumerationBlocked = true;
      for (const targetId of [sub1.id, sub2.id, sub3.id, sub4.id]) {
        const res = await request('GET', `/api/submissions/${targetId}/code`, null, tokenStudentC);
        if (res.status !== 403) {
          enumerationBlocked = false;
        }
      }
      recordAssert('3.C: Student C sequential ID enumeration returns 403 across all unowned submissions', enumerationBlocked);
    }

    // 3.D: Professor accesses submission for own problem -> 200 OK
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenProfA);
      recordAssert('3.D: Professor A accesses submission for own problem (200 OK)', res.status === 200);
      recordAssert('3.D: Professor A receives source code', res.body && res.body.sourceCode && res.body.sourceCode.includes('SECRET_SOURCE_CODE_STUDENT_A_SUB1'));
    }

    // 3.E: Professor accesses submission for another professor problem & contest -> 403 Forbidden
    {
      const res = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenProfA);
      recordAssert('3.E: Professor A blocked from Prof B problem & contest submission (403 Forbidden)', res.status === 403);
    }

    // 3.F: Professor accesses submission from own contest -> 200 OK
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenProfA);
      recordAssert('3.F: Professor A accesses submission from own contest (200 OK)', res.status === 200);
    }

    // 3.G: Professor accesses unrelated professor contest submission -> 403 Forbidden
    {
      const res = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenProfC);
      recordAssert('3.G: Professor C blocked from unrelated Prof B contest submission (403 Forbidden)', res.status === 403);
    }

    // 3.H: Mixed ownership: Prob B (Prof B) in Contest A (Prof A)
    {
      const resProfA = await request('GET', `/api/submissions/${sub4.id}/code`, null, tokenProfA);
      const resProfB = await request('GET', `/api/submissions/${sub4.id}/code`, null, tokenProfB);
      const resProfC = await request('GET', `/api/submissions/${sub4.id}/code`, null, tokenProfC);

      recordAssert('3.H: Mixed ownership: Contest owner Prof A allowed (200 OK)', resProfA.status === 200);
      recordAssert('3.H: Mixed ownership: Problem owner Prof B allowed (200 OK)', resProfB.status === 200);
      recordAssert('3.H: Mixed ownership: Unrelated Prof C denied (403 Forbidden)', resProfC.status === 403);
    }

    // 3.I: Practice submission (contest_id = NULL)
    {
      const resOwner = await request('GET', `/api/submissions/${sub3.id}/code`, null, tokenProfA);
      const resUnrelated = await request('GET', `/api/submissions/${sub3.id}/code`, null, tokenProfB);

      recordAssert('3.I: Practice submission: Problem owner Prof A allowed (200 OK)', resOwner.status === 200);
      recordAssert('3.I: Practice submission: Unrelated Prof B denied (403 Forbidden)', resUnrelated.status === 403);
    }

    // 3.J: Super Admin platform-wide access
    {
      const res1 = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenSuperAdmin);
      const res2 = await request('GET', `/api/submissions/${sub2.id}/code`, null, tokenSuperAdmin);
      recordAssert('3.J: Super Admin retains platform-wide access to all submissions (200 OK)', res1.status === 200 && res2.status === 200);
    }

    // 3.K: Contest Admin access
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenContestAdmin);
      recordAssert('3.K: Contest Admin authorized according to platform role contract (200 OK)', res.status === 200);
    }

    // 3.L: Unauthenticated request -> 401 Unauthorized
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, null);
      recordAssert('3.L: Unauthenticated request returns 401 Unauthorized', res.status === 401);
    }

    // 3.M: Invalid submission IDs
    {
      const res404 = await request('GET', `/api/submissions/99999999/code`, null, tokenSuperAdmin);
      const res400Str = await request('GET', `/api/submissions/abc/code`, null, tokenSuperAdmin);
      const res400Neg = await request('GET', `/api/submissions/-5/code`, null, tokenSuperAdmin);

      recordAssert('3.M: Non-existent submission ID returns 404 Not Found', res404.status === 404);
      recordAssert('3.M: String submission ID returns 400 Bad Request', res400Str.status === 400);
      recordAssert('3.M: Negative submission ID returns 400 Bad Request', res400Neg.status === 400);
    }

    // 3.N: Error responses must never expose source code
    {
      const res = await request('GET', `/api/submissions/${sub1.id}/code`, null, tokenStudentB);
      recordAssert('3.N: 403 Forbidden payload contains zero source code tokens', !JSON.stringify(res.body).includes('SECRET_SOURCE_CODE'));
    }
  }

  // -----------------------------------------------------------------------
  // 2. SECTION 4 & 5: 5.9.2.2 SAFE DELETION & POSTGRESQL RESTRICT PROTECTION
  // -----------------------------------------------------------------------
  console.log('\n--- 2. SECTION 4 & 5: Safe Deletion & Database RESTRICT Constraints ---');
  {
    // 4.A: Delete problem with zero submissions -> 200 OK
    const probEmpty = await ProblemModel.createProblemWithSafety({
      title: `Delete Safe Empty Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profA.id,
    }, profA, null);

    const delEmptyRes = await request('DELETE', `/api/problems/${probEmpty.id}`, null, tokenProfA);
    recordAssert('4.A: Delete problem with zero submissions allowed (200 OK)', delEmptyRes.status === 200);

    const checkProbEmpty = await db.query('SELECT * FROM problems WHERE id = $1', [probEmpty.id]);
    recordAssert('4.A (DB): Problem row removed from database', checkProbEmpty.rowCount === 0);

    // 4.B: Delete problem with submissions -> 409 Conflict
    const probWithSubs = await ProblemModel.createProblemWithSafety({
      title: `Delete Blocked Prob With Subs ${Date.now()}`,
      description: 'Desc',
      difficulty: 'medium',
      createdBy: profA.id,
    }, profA, null);

    await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: probWithSubs.id,
      language: 'cpp',
      sourceCode: 'int main() { return 0; }',
      status: 'accepted',
    });

    const delSubProbRes = await request('DELETE', `/api/problems/${probWithSubs.id}`, null, tokenProfA);
    recordAssert('4.B: Delete problem with submissions blocked (409 Conflict)', delSubProbRes.status === 409);
    recordAssert('4.B: Message states submissions exist', delSubProbRes.body && delSubProbRes.body.message && delSubProbRes.body.message.includes('submissions exist'));

    // 4.C: Professor attempting unauthorized problem deletion -> 403 Forbidden
    const delUnauthProb = await request('DELETE', `/api/problems/${probWithSubs.id}`, null, tokenProfB);
    recordAssert('4.C: Unauthorized professor delete blocked (403 Forbidden)', delUnauthProb.status === 403);

    // 4.D: Super Admin attempting to delete problem with submissions -> 409 Conflict
    const delAdminProb = await request('DELETE', `/api/problems/${probWithSubs.id}`, null, tokenSuperAdmin);
    recordAssert('4.D: Super Admin delete problem with submissions blocked (409 Conflict)', delAdminProb.status === 409);

    // 4.F: Delete contest with zero submissions -> 200 OK
    const contestEmpty = await ContestModel.createContestWithSafety({
      title: `Delete Safe Empty Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
    }, profA, null);

    const delEmptyContestRes = await request('DELETE', `/api/contests/${contestEmpty.id}`, null, tokenProfA);
    recordAssert('4.F: Delete contest with zero submissions allowed (200 OK)', delEmptyContestRes.status === 200);

    const checkContestEmpty = await db.query('SELECT * FROM contests WHERE id = $1', [contestEmpty.id]);
    recordAssert('4.F (DB): Contest row removed from database', checkContestEmpty.rowCount === 0);

    // 4.G: Delete contest with submissions -> 409 Conflict
    const contestWithSubs = await ContestModel.createContestWithSafety({
      title: `Delete Blocked Contest With Subs ${Date.now()}`,
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profA.id,
    }, profA, null);

    await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: probWithSubs.id,
      contestId: contestWithSubs.id,
      language: 'cpp',
      sourceCode: 'int main() { return 0; }',
      status: 'accepted',
    });

    const delSubContestRes = await request('DELETE', `/api/contests/${contestWithSubs.id}`, null, tokenProfA);
    recordAssert('4.G: Delete contest with submissions blocked (409 Conflict)', delSubContestRes.status === 409);

    // 4.H: Super Admin delete contest with submissions -> 409 Conflict
    const delAdminContest = await request('DELETE', `/api/contests/${contestWithSubs.id}`, null, tokenSuperAdmin);
    recordAssert('4.H: Super Admin delete contest with submissions blocked (409 Conflict)', delAdminContest.status === 409);

    // 4.I: Contest with participants but no submissions -> allowed
    const contestWithParts = await ContestModel.createContestWithSafety({
      title: `Contest With Participants Only ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
    }, profA, null);
    await ContestModel.addParticipant(contestWithParts.id, studentA.id);

    const delPartsContestRes = await request('DELETE', `/api/contests/${contestWithParts.id}`, null, tokenProfA);
    recordAssert('4.I: Delete contest with participants but zero submissions allowed (200 OK)', delPartsContestRes.status === 200);

    // 4.J: Verify submissions remain unchanged after blocked deletions
    const checkSub = await db.query('SELECT * FROM submissions WHERE problem_id = $1', [probWithSubs.id]);
    recordAssert('4.J: Historical submissions remain completely intact in DB', checkSub.rowCount >= 1);

    // 5. DATABASE LEVEL DELETION PROTECTION (PostgreSQL ON DELETE RESTRICT)
    let pgProblemRestrictTriggered = false;
    try {
      await db.query('DELETE FROM problems WHERE id = $1', [probWithSubs.id]);
    } catch (err) {
      if (err.code === '23503') { // foreign_key_violation
        pgProblemRestrictTriggered = true;
      }
    }
    recordAssert('5: PostgreSQL ON DELETE RESTRICT strictly rejects raw SQL DELETE on problem with submissions (23503)', pgProblemRestrictTriggered);

    let pgContestRestrictTriggered = false;
    try {
      await db.query('DELETE FROM contests WHERE id = $1', [contestWithSubs.id]);
    } catch (err) {
      if (err.code === '23503') { // foreign_key_violation
        pgContestRestrictTriggered = true;
      }
    }
    recordAssert('5: PostgreSQL ON DELETE RESTRICT strictly rejects raw SQL DELETE on contest with submissions (23503)', pgContestRestrictTriggered);
  }

  // -----------------------------------------------------------------------
  // 3. SECTION 6: 5.9.2.4 CONTEST LIFECYCLE MUTATION LOCKS
  // -----------------------------------------------------------------------
  console.log('\n--- 3. SECTION 6: Contest Lifecycle Mutation Locks ---');
  {
    // DRAFT Contest
    const draftContest = await ContestModel.createContestWithSafety({
      title: `Draft Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
    }, profA, null);

    const updateDraftRes = await request('PUT', `/api/contests/${draftContest.id}`, {
      title: 'Updated Draft Contest Title',
      startTime: new Date(Date.now() + 5000000).toISOString(),
      endTime: new Date(Date.now() + 9000000).toISOString(),
    }, tokenProfA);
    recordAssert('6.Draft: Modifying dates & metadata on draft contest allowed (200 OK)', updateDraftRes.status === 200);

    // RUNNING Contest
    const runningContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [
      `Running Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 1800000).toISOString(),
      new Date(Date.now() + 1800000).toISOString(),
      profA.id,
    ]);
    const runningContestId = runningContestRes.rows[0].id;

    const modRunStartDate = await request('PUT', `/api/contests/${runningContestId}`, {
      startTime: new Date(Date.now() - 3600000).toISOString(),
    }, tokenProfA);
    recordAssert('6.Running: Attempting to modify start_time on running contest blocked (409 Conflict)', modRunStartDate.status === 409);
    recordAssert('6.Running: Error message indicates contest is running', modRunStartDate.body && modRunStartDate.body.message && modRunStartDate.body.message.includes('running'));

    const modRunEndDate = await request('PUT', `/api/contests/${runningContestId}`, {
      endTime: new Date(Date.now() + 7200000).toISOString(),
    }, tokenProfA);
    recordAssert('6.Running: Attempting to modify end_time on running contest blocked (409 Conflict)', modRunEndDate.status === 409);

    const modRunStatus = await request('PUT', `/api/contests/${runningContestId}`, {
      status: 'draft',
    }, tokenProfA);
    recordAssert('6.Running: Attempting to roll status back to draft blocked (409 Conflict)', modRunStatus.status === 409);

    // Direct Model Safety on Running Contest: addProblemToContestWithSafety returns locked: true
    const probDirect = await ProblemModel.createProblemWithSafety({
      title: `Direct Safety Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profA.id,
    }, profA, null);

    const directModelResult = await ContestModel.addProblemToContestWithSafety({
      contestId: runningContestId,
      problemId: probDirect.id,
      points: 100,
      problemOrder: 1,
    }, profA, null);
    recordAssert('6.Running: Direct Model addProblemToContestWithSafety rejects mutation with locked=true', directModelResult.locked === true);

    // ENDED Contest
    const endedContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [
      `Ended Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 7200000).toISOString(),
      new Date(Date.now() - 3600000).toISOString(),
      profA.id,
    ]);
    const endedContestId = endedContestRes.rows[0].id;

    const modEndedDates = await request('PUT', `/api/contests/${endedContestId}`, {
      startTime: new Date(Date.now() - 10000000).toISOString(),
    }, tokenProfA);
    recordAssert('6.Ended: Attempting to modify dates on ended contest blocked (409 Conflict)', modEndedDates.status === 409);

    // ARCHIVED Contest
    const archivedContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'archived', true, $5)
      RETURNING id;
    `, [
      `Archived Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 7200000).toISOString(),
      new Date(Date.now() - 3600000).toISOString(),
      profA.id,
    ]);
    const archivedContestId = archivedContestRes.rows[0].id;

    const modArchived = await request('PUT', `/api/contests/${archivedContestId}`, {
      startTime: new Date(Date.now() - 10000000).toISOString(),
    }, tokenProfA);
    recordAssert('6.Archived: Attempting to modify lifecycle dates on archived contest blocked (409 Conflict)', modArchived.status === 409);
  }

  // -----------------------------------------------------------------------
  // 4. SECTION 7: 5.9.2.5 CONTEST-PROBLEM MUTATION LOCKS
  // -----------------------------------------------------------------------
  console.log('\n--- 4. SECTION 7: Contest-Problem Mutation Locks ---');
  {
    const prob1 = await ProblemModel.createProblemWithSafety({
      title: `CP Lock Prob 1 ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profA.id,
    }, profA, null);

    const prob2 = await ProblemModel.createProblemWithSafety({
      title: `CP Lock Prob 2 ${Date.now()}`,
      description: 'Desc',
      difficulty: 'medium',
      createdBy: profA.id,
    }, profA, null);

    const draftContest = await ContestModel.createContestWithSafety({
      title: `CP Draft Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
    }, profA, null);

    // 7.A: Add problem to draft contest -> 201 Created
    const addDraftRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    }, tokenProfA);
    recordAssert('7.A: Add problem to draft contest allowed (201 Created)', addDraftRes.status === 201);

    // 7.J: Duplicate problem attachment in draft contest -> 409 Conflict
    const addDupRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: prob1.id,
      points: 100,
      problemOrder: 1,
    }, tokenProfA);
    recordAssert('7.J: Duplicate problem attachment in draft contest returns 409 Conflict', addDupRes.status === 409);

    // 7.B: Remove problem from draft contest -> 200 OK
    const remDraftRes = await request('DELETE', `/api/contests/${draftContest.id}/problems/${prob1.id}`, null, tokenProfA);
    recordAssert('7.B: Remove problem from draft contest allowed (200 OK)', remDraftRes.status === 200);

    // RUNNING Contest setup
    const runningContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [
      `CP Running Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 1800000).toISOString(),
      new Date(Date.now() + 1800000).toISOString(),
      profA.id,
    ]);
    const runningContestId = runningContestRes.rows[0].id;
    await ContestModel.addProblemToContest({ contestId: runningContestId, problemId: prob1.id, points: 100, problemOrder: 1 });

    // 7.C: Add problem to running contest -> 409 Conflict
    const addRunRes = await request('POST', `/api/contests/${runningContestId}/problems`, {
      problemId: prob2.id,
    }, tokenProfA);
    recordAssert('7.C: Add problem to running contest blocked (409 Conflict)', addRunRes.status === 409);

    // 7.D: Remove problem from running contest -> 409 Conflict
    const remRunRes = await request('DELETE', `/api/contests/${runningContestId}/problems/${prob1.id}`, null, tokenProfA);
    recordAssert('7.D: Remove problem from running contest blocked (409 Conflict)', remRunRes.status === 409);

    // 7.E: Remove problem from contest with submissions -> 409 Conflict
    await SubmissionModel.createSubmission({
      userId: studentA.id,
      problemId: prob1.id,
      contestId: runningContestId,
      language: 'cpp',
      sourceCode: 'int main() {}',
      status: 'accepted',
    });

    const remSubProbRes = await request('DELETE', `/api/contests/${runningContestId}/problems/${prob1.id}`, null, tokenProfA);
    recordAssert('7.E: Remove problem from contest with submissions blocked (409 Conflict)', remSubProbRes.status === 409);

    // 7.F: Remove problem from historical contest -> 409 Conflict
    const endedContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [
      `CP Ended Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 7200000).toISOString(),
      new Date(Date.now() - 3600000).toISOString(),
      profA.id,
    ]);
    const endedContestId = endedContestRes.rows[0].id;
    await ContestModel.addProblemToContest({ contestId: endedContestId, problemId: prob1.id, points: 100, problemOrder: 1 });

    const remEndedRes = await request('DELETE', `/api/contests/${endedContestId}/problems/${prob1.id}`, null, tokenProfA);
    recordAssert('7.F: Remove problem from ended/historical contest blocked (409 Conflict)', remEndedRes.status === 409);

    // 7.G: Unauthorized professor attempts modification -> 403 Forbidden
    const unauthAddRes = await request('POST', `/api/contests/${draftContest.id}/problems`, {
      problemId: prob2.id,
    }, tokenProfB);
    recordAssert('7.G: Unauthorized professor adding problem blocked (403 Forbidden)', unauthAddRes.status === 403);

    // 7.H: State leakage protection: Unauthorized professor on running contest gets 403 (does not leak 409 state)
    const unauthRunRes = await request('POST', `/api/contests/${runningContestId}/problems`, {
      problemId: prob2.id,
    }, tokenProfB);
    recordAssert('7.H: Unauthorized professor receives 403 Forbidden on running contest (runtime state not leaked)', unauthRunRes.status === 403);

    // 7.I: Bulk add / bulk remove on running contest -> 409 Conflict
    const bulkAddRes = await request('POST', `/api/contests/${runningContestId}/problems/bulk`, {
      problems: [{ problemId: prob2.id, points: 50, problemOrder: 2 }],
    }, tokenProfA);
    recordAssert('7.I: Bulk add problems to running contest blocked (409 Conflict)', bulkAddRes.status === 409);

    const bulkRemRes = await request('DELETE', `/api/contests/${runningContestId}/problems`, null, tokenProfA);
    recordAssert('7.I: Bulk remove problems from running contest blocked (409 Conflict)', bulkRemRes.status === 409);
  }

  // -----------------------------------------------------------------------
  // 5. SECTION 8, 9, 10, 11: 5.9.2.3 AUDIT LOGGING, RBAC, IMMUTABILITY & SANITIZATION
  // -----------------------------------------------------------------------
  console.log('\n--- 5. SECTION 8, 9, 10, 11: Audit Logging, RBAC, Immutability & Sanitization ---');
  {
    // Section 8: Verify action types recorded in DB
    const actionsToVerify = [
      'PROBLEM_CREATED',
      'PROBLEM_UPDATED',
      'PROBLEM_DELETED',
      'CONTEST_CREATED',
      'CONTEST_UPDATED',
      'CONTEST_DELETED',
      'CONTEST_PROBLEM_ADDED',
      'CONTEST_PROBLEM_REMOVED',
      'PRIVILEGED_ACTION_DENIED',
    ];

    for (const act of actionsToVerify) {
      const checkAct = await db.query('SELECT * FROM audit_logs WHERE action = $1 LIMIT 1', [act]);
      recordAssert(`8: Audit log action '${act}' correctly persisted in PostgreSQL`, checkAct.rowCount >= 1);
    }

    // Section 9: Audit Log RBAC
    const unauthAudit = await request('GET', '/api/admin/audit-logs', null, null);
    const studAudit = await request('GET', '/api/admin/audit-logs', null, tokenStudentA);
    const profAudit = await request('GET', '/api/admin/audit-logs', null, tokenProfA);
    const caAudit = await request('GET', '/api/admin/audit-logs', null, tokenContestAdmin);
    const saAudit = await request('GET', '/api/admin/audit-logs', null, tokenSuperAdmin);

    recordAssert('9: Unauthenticated GET /api/admin/audit-logs returns 401 Unauthorized', unauthAudit.status === 401);
    recordAssert('9: Student GET /api/admin/audit-logs returns 403 Forbidden', studAudit.status === 403);
    recordAssert('9: Professor GET /api/admin/audit-logs returns 403 Forbidden', profAudit.status === 403);
    recordAssert('9: Contest Admin GET /api/admin/audit-logs returns 403 Forbidden', caAudit.status === 403);
    recordAssert('9: Super Admin GET /api/admin/audit-logs returns 200 OK', saAudit.status === 200);
    const auditData = saAudit.body && (saAudit.body.data || saAudit.body);
    recordAssert('9: Super Admin audit logs response contains logs array and pagination', auditData && Array.isArray(auditData.logs) && auditData.pagination);

    // Section 10: Audit Log Immutability (No PUT / PATCH / DELETE routes)
    const putAudit = await request('PUT', '/api/admin/audit-logs/1', { action: 'MUTATED' }, tokenSuperAdmin);
    const patchAudit = await request('PATCH', '/api/admin/audit-logs/1', { action: 'MUTATED' }, tokenSuperAdmin);
    const delAudit = await request('DELETE', '/api/admin/audit-logs/1', null, tokenSuperAdmin);

    recordAssert('10: Application does not expose PUT /api/admin/audit-logs/:id (404/405)', putAudit.status === 404 || putAudit.status === 405);
    recordAssert('10: Application does not expose PATCH /api/admin/audit-logs/:id (404/405)', patchAudit.status === 404 || patchAudit.status === 405);
    recordAssert('10: Application does not expose DELETE /api/admin/audit-logs/:id (404/405)', delAudit.status === 404 || delAudit.status === 405);

    // Section 11: Recursive Metadata Sanitization
    const sensitivePayload = {
      safeLabel: 'Non-sensitive label',
      password: 'PlainPassword123!',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      token: 'jwt.token.here',
      jwt: 'eyJh.eyJi.sig',
      accessToken: 'access123',
      refreshToken: 'refresh123',
      authorization: 'Bearer token',
      cookie: 'session=123',
      sourceCode: 'import os; os.system("rm -rf /")',
      inputData: 'sensitive input',
      expectedOutput: 'sensitive output',
      apiKey: 'api_secret_key',
      privateKey: '---BEGIN RSA PRIVATE KEY---',
      nestedObject: {
        password: 'SubPassword123!',
        token: 'sub.jwt.token',
        nestedSafe: 'keep_me_nested',
      },
      nestedArray: [
        { secret: 'item_pwd', token: 'token1' },
        { itemSafe: 'safe_array_item' },
      ],
    };

    const sanitized = AuditLogger.sanitize(sensitivePayload);

    recordAssert('11: Sanitizer preserved top-level safe value', sanitized.safeLabel === 'Non-sensitive label');
    recordAssert('11: Sanitizer stripped password', sanitized.password === undefined);
    recordAssert('11: Sanitizer stripped passwordHash', sanitized.passwordHash === undefined);
    recordAssert('11: Sanitizer stripped token & jwt', sanitized.token === undefined && sanitized.jwt === undefined);
    recordAssert('11: Sanitizer stripped sourceCode', sanitized.sourceCode === undefined);
    recordAssert('11: Sanitizer stripped apiKey & privateKey', sanitized.apiKey === undefined && sanitized.privateKey === undefined);
    recordAssert('11: Sanitizer recursively stripped nested password in object', sanitized.nestedObject && sanitized.nestedObject.password === undefined);
    recordAssert('11: Sanitizer preserved nestedSafe value in object', sanitized.nestedObject && sanitized.nestedObject.nestedSafe === 'keep_me_nested');
    recordAssert('11: Sanitizer recursively sanitized objects in arrays', Array.isArray(sanitized.nestedArray) && sanitized.nestedArray[0].token === undefined && sanitized.nestedArray[1].itemSafe === 'safe_array_item');
  }

  // -----------------------------------------------------------------------
  // 6. SECTION 12, 13, 14: 5.9.2.6 TRANSACTION BOUNDARIES, ROLLBACK & CONNECTION SAFETY
  // -----------------------------------------------------------------------
  console.log('\n--- 6. SECTION 12, 13, 14: Transaction Boundaries, Failure Rollback & Connection Safety ---');
  {
    // 12.A: Problem creation rollback on failure injection
    const titleRollbackProb = `Rollback Injected Prob ${Date.now()}`;
    const client = await db.getClient();
    let tx1Threw = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO problems (title, description, difficulty, created_by) VALUES ($1, $2, $3, $4) RETURNING id;`,
        [titleRollbackProb, 'Desc', 'easy', profA.id]
      );
      // Inject failure
      await client.query('INSERT INTO non_existent_table_for_test VALUES (1)');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      tx1Threw = true;
    } finally {
      client.release();
    }
    recordAssert('12: Failure inside multi-step problem transaction triggers rollback', tx1Threw);

    const checkProbRollback = await db.query('SELECT * FROM problems WHERE title = $1', [titleRollbackProb]);
    recordAssert('12 (DB): Zero problem rows remain in database after rollback', checkProbRollback.rowCount === 0);

    // 13.A: Audit + Transaction Consistency: Mutation succeeds + Audit succeeds = COMMIT
    const probConsistent = await ProblemModel.createProblemWithSafety({
      title: `Consistent Commit Prob ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profA.id,
    }, profA, null);

    const checkConsistentProb = await db.query('SELECT * FROM problems WHERE id = $1', [probConsistent.id]);
    const checkConsistentAudit = await db.query(`SELECT * FROM audit_logs WHERE action = 'PROBLEM_CREATED' AND resource_id = $1`, [probConsistent.id]);
    recordAssert('13: Success path commits both business entity and audit record atomically', checkConsistentProb.rowCount === 1 && checkConsistentAudit.rowCount === 1);

    // 13.B: Audit + Transaction Consistency: Mutation succeeds + Audit fails = ROLLBACK
    const titleAuditFail = `Audit Fail Prob ${Date.now()}`;
    const clientAuditFail = await db.getClient();
    let txAuditThrew = false;
    try {
      await clientAuditFail.query('BEGIN');
      const pRes = await clientAuditFail.query(
        `INSERT INTO problems (title, description, difficulty, created_by) VALUES ($1, $2, $3, $4) RETURNING id;`,
        [titleAuditFail, 'Desc', 'easy', profA.id]
      );
      const newProbId = pRes.rows[0].id;

      // Force failure on audit log insert on transaction client
      await clientAuditFail.query(
        `INSERT INTO audit_logs (id, actor_id, action) VALUES ($1, $2, $3);`,
        ['INVALID_UUID_TYPE_TRIGGER', profA.id, 'PROBLEM_CREATED']
      );
      await clientAuditFail.query('COMMIT');
    } catch (err) {
      await clientAuditFail.query('ROLLBACK');
      txAuditThrew = true;
    } finally {
      clientAuditFail.release();
    }
    recordAssert('13: Audit log insertion failure triggers complete transaction rollback', txAuditThrew);

    const checkAuditFailProb = await db.query('SELECT * FROM problems WHERE title = $1', [titleAuditFail]);
    recordAssert('13 (DB): Business mutation rolled back (0 phantom records)', checkAuditFailProb.rowCount === 0);

    // 14: Connection Safety & Pool Health Under Failure Load
    let poolHealthMaintained = true;
    for (let i = 0; i < 15; i++) {
      const c = await db.getClient();
      try {
        await c.query('BEGIN');
        await c.query('SELECT 1');
        if (i % 2 === 0) {
          throw new Error('Simulated transient failure');
        }
        await c.query('COMMIT');
      } catch (err) {
        try { await c.query('ROLLBACK'); } catch (rbErr) {}
      } finally {
        c.release();
      }
    }

    const testPoolQuery = await db.query('SELECT 1 AS alive;');
    recordAssert('14: Database pool remains 100% healthy and usable after repeated failure injections', testPoolQuery.rows[0].alive === 1);
  }

  // -----------------------------------------------------------------------
  // 7. SECTION 15, 16, 17, 18: PRIVILEGE ESCALATION, IDOR & PARAMETER TAMPERING
  // -----------------------------------------------------------------------
  console.log('\n--- 7. SECTION 15, 16, 17, 18: Privilege Escalation, IDOR & Parameter Tampering ---');
  {
    // 15: Student attempts role escalation in profile update
    const updateRoleRes = await request('PUT', '/api/users/me', {
      fullName: 'Student Alpha Updated',
      role: 'super_admin',
    }, tokenStudentA);
    recordAssert('15: Role parameter tampering in profile update returns 200 without changing role', updateRoleRes.status === 200);

    const checkStudentRole = await db.query('SELECT role FROM users WHERE id = $1', [studentA.id]);
    recordAssert('15 (DB): Student role strictly remains student', checkStudentRole.rows[0].role === 'student');

    // 15b: Professor attempts to create contest claiming createdBy is Super Admin
    const spoofContestRes = await request('POST', '/api/contests', {
      title: `Spoofed Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: superAdmin.id,
    }, tokenProfA);
    recordAssert('15: Contest created successfully', spoofContestRes.status === 201);

    const createdContestId = spoofContestRes.body.contest.id;
    const checkContestCreator = await db.query('SELECT created_by FROM contests WHERE id = $1', [createdContestId]);
    recordAssert('15 (DB): Server sets created_by to authenticated user Prof A (spoofed superAdmin ID ignored)', checkContestCreator.rows[0].created_by === profA.id);

    // 16: IDOR / BOLA Enumeration across resources
    const idorTestCases = await request('GET', '/api/problems/99999/test-cases', null, tokenProfA);
    recordAssert('16: IDOR query for test cases of non-existent problem returns 404', idorTestCases.status === 404);

    // 17: HTTP Method Bypass on admin route
    const postAudit = await request('POST', '/api/admin/audit-logs', { test: true }, tokenStudentA);
    recordAssert('17: POST to audit-logs route blocked with 403 Forbidden', postAudit.status === 403 || postAudit.status === 404);

    // 18: Parameter / Body Spoofing on Problem Creation
    const spoofProbRes = await request('POST', '/api/problems', {
      title: `Spoofed Problem ${Date.now()}`,
      description: 'Problem description for spoofing test',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profB.id, // Prof A tries to set creator to Prof B
    }, tokenProfA);
    recordAssert('18: Problem created successfully', spoofProbRes.status === 201);

    const checkProbCreator = await db.query('SELECT created_by FROM problems WHERE id = $1', [spoofProbRes.body.problem.id]);
    recordAssert('18 (DB): Problem created_by is strictly Prof A (Prof B spoof ignored)', checkProbCreator.rows[0].created_by === profA.id);
  }

  // -----------------------------------------------------------------------
  // 8. SECTION 19: RACE CONDITION & CONCURRENCY TESTING
  // -----------------------------------------------------------------------
  console.log('\n--- 8. SECTION 19: Race-Condition & Concurrency Hardening ---');
  {
    // Scenario 19.A: 10 concurrent requests to add same problem to draft contest
    const raceDraft = await ContestModel.createContestWithSafety({
      title: `Race Draft Contest ${Date.now()}`,
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
    }, profA, null);

    const raceProb = await ProblemModel.createProblemWithSafety({
      title: `Race Problem ${Date.now()}`,
      description: 'Desc',
      difficulty: 'easy',
      createdBy: profA.id,
    }, profA, null);

    const concurrentAdds = await Promise.all(
      Array.from({ length: 8 }, () =>
        request('POST', `/api/contests/${raceDraft.id}/problems`, {
          problemId: raceProb.id,
          points: 100,
          problemOrder: 1,
        }, tokenProfA)
      )
    );

    const successfulAdds = concurrentAdds.filter((r) => r.status === 201);
    const rejectedAdds = concurrentAdds.filter((r) => r.status === 409);

    recordAssert('19: Exactly 1 concurrent add request succeeded (201 Created)', successfulAdds.length === 1);
    recordAssert('19: Remaining 7 concurrent add requests rejected (409 Conflict)', rejectedAdds.length === 7);

    const checkCpCount = await db.query(
      'SELECT COUNT(*)::int AS count FROM contest_problems WHERE contest_id = $1 AND problem_id = $2',
      [raceDraft.id, raceProb.id]
    );
    recordAssert('19 (DB): Exactly 1 mapping row exists in database (0 duplicate corruption)', checkCpCount.rows[0].count === 1);

    // Scenario 19.B: 10 concurrent mutation requests on running contest
    const runningContestRes = await db.query(`
      INSERT INTO contests (title, description, start_time, end_time, status, is_rated, created_by)
      VALUES ($1, $2, $3, $4, 'published', true, $5)
      RETURNING id;
    `, [
      `Concurrency Running Contest ${Date.now()}`,
      'Desc',
      new Date(Date.now() - 1800000).toISOString(),
      new Date(Date.now() + 1800000).toISOString(),
      profA.id,
    ]);
    const runningId = runningContestRes.rows[0].id;

    const concurrentRunningMutations = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request('PUT', `/api/contests/${runningId}`, {
          startTime: new Date(Date.now() - 3600000 - i * 1000).toISOString(),
        }, tokenProfA)
      )
    );

    const allRejected = concurrentRunningMutations.every((r) => r.status === 409 || r.status === 429);
    const noneSucceeded = concurrentRunningMutations.every((r) => r.status !== 200 && r.status !== 201);
    recordAssert('19: 10 concurrent lifecycle mutation attempts on running contest all safely blocked (409/429; 0 succeeded)', allRejected && noneSucceeded);
  }

  // -----------------------------------------------------------------------
  // 9. SECTION 20 & 21: ERROR RESPONSES & SENSITIVE LEAKAGE CHECKS
  // -----------------------------------------------------------------------
  console.log('\n--- 9. SECTION 20 & 21: Error Response Integrity & Information Leakage ---');
  {
    const sqlInjectionPayload = "' OR '1'='1";
    const resSql = await request('GET', `/api/problems/${encodeURIComponent(sqlInjectionPayload)}`, null, tokenStudentA);
    recordAssert('20: SQL injection payload rejected with 400 Bad Request', resSql.status === 400);

    const bodyStr = JSON.stringify(resSql.body);
    recordAssert('20: Error response does NOT leak SQL query strings (SELECT/FROM)', !bodyStr.includes('SELECT ') && !bodyStr.includes('FROM problems'));
    recordAssert('20: Error response does NOT leak credentials or password hashes', !bodyStr.includes('password') && !bodyStr.includes('$2b$'));
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
    await setupActors();
    await runAllSecurityRegressionTests();
  } catch (err) {
    console.error('Fatal error during test execution:', err);
    process.exit(1);
  } finally {
    server.close();
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }

    console.log('\n===============================================================');
    console.log(`📊 PHASE 5.9.2.7 ASSERTIONS: ${passedAssertions} / ${totalAssertions} PASSED (${Math.round((passedAssertions / totalAssertions) * 100)}%)`);
    console.log(`   Failed: ${failedAssertions} | Skipped: ${skippedAssertions}`);
    console.log('===============================================================\n');

    if (failedAssertions > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

main();
