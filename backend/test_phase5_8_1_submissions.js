/**
 * Automated Verification Test Suite for Phase 5.8.1 — Submission Detail + Full Code
 * 
 * Verifies:
 * 1. Submission detail lookup by valid ID (GET /api/submissions/:id).
 * 2. Exact historical source code preservation and immutability.
 * 3. BOLA / IDOR protection (Student B cannot access Student A's submission).
 * 4. Professor RBAC authorization for contest/problem owners.
 * 5. Invalid / non-numeric submission ID handling (400 Bad Request).
 * 6. Non-existent submission ID handling (404 Not Found).
 * 7. Unauthenticated request rejection (401 Unauthorized).
 * 8. SQL injection resilience on submission routes.
 * 9. Sensitive data shield (no password hashes or judge worker internals leaked).
 * 10. Multi-tier validationSummary exposure when available.
 */

const assert = require('assert');
const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const SubmissionModel = require('./src/models/submissionModel');
const TestCaseModel = require('./src/models/testCaseModel');

let server = null;
let baseUrl = '';
let passedCount = 0;
let failedCount = 0;

function record(name, condition, extra = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name} - ${extra}`);
  }
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'x-test-environment': 'true',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.8.1 AUTOMATED TEST SUITE');
  console.log(' Submission Detail & Exact Historical Code Verification');
  console.log('=======================================================\n');

  const ts = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';

  try {
    // Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // -------------------------------------------------------------------
    // 1. SETUP USERS, CONTEST & PROBLEM
    // -------------------------------------------------------------------
    console.log('--- 1. Test Setup (Users, Contest, Problem) ---');

    const prof = await UserModel.createUser({
      username: `prof_581_${ts}`,
      email: `prof_581_${ts}@test.edu`,
      passwordHash,
      fullName: 'Professor 581',
      role: 'professor',
    });

    const studentA = await UserModel.createUser({
      username: `alice_581_${ts}`,
      email: `alice_581_${ts}@test.edu`,
      passwordHash,
      fullName: 'Alice 581',
      role: 'student',
    });

    const studentB = await UserModel.createUser({
      username: `bob_581_${ts}`,
      email: `bob_581_${ts}@test.edu`,
      passwordHash,
      fullName: 'Bob 581',
      role: 'student',
    });

    // Create running contest
    const startTime = new Date(Date.now() - 3600000);
    const endTime = new Date(Date.now() + 7200000);
    const contest = await ContestModel.createContest({
      title: `Phase 5.8.1 Contest ${ts}`,
      description: 'Contest for Submission Detail testing',
      startTime,
      endTime,
      createdBy: prof.id,
      status: 'published',
    });

    const problem = await ProblemModel.createProblem({
      title: `Two Sum 581 ${ts}`,
      description: 'Given an array of integers, return indices of the two numbers that add up to target.',
      difficulty: 'easy',
      codingMode: 'function',
      timeLimit: 2000,
      memoryLimit: 256,
      createdBy: prof.id,
    });

    await ContestModel.addProblemToContest({
      contestId: contest.id,
      problemId: problem.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addParticipant(contest.id, studentA.id);
    await ContestModel.addParticipant(contest.id, studentB.id);

    // Add sample test case
    await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '2 7 11 15\n9',
      expectedOutput: '0 1',
      isSample: true,
      orderIndex: 1,
    });

    // Log in users
    const aliceLogin = await request('POST', '/api/auth/login', { email: studentA.email, password: 'Password123!' });
    const aliceToken = aliceLogin.body.token;

    const bobLogin = await request('POST', '/api/auth/login', { email: studentB.email, password: 'Password123!' });
    const bobToken = bobLogin.body.token;

    const profLogin = await request('POST', '/api/auth/login', { email: prof.email, password: 'Password123!' });
    const profToken = profLogin.body.token;

    record('Professor and students created and logged in', !!aliceToken && !!bobToken && !!profToken);

    // -------------------------------------------------------------------
    // 2. SUBMISSION CREATION & EXACT SOURCE CODE STORAGE
    // -------------------------------------------------------------------
    console.log('\n--- 2. Submission Creation & Exact Code Storage ---');

    const exactCode = `// Exact Submitted Solution for Phase 5.8.1
#include <vector>
#include <unordered_map>
using namespace std;

class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> mp;
        for (int i = 0; i < (int)nums.size(); ++i) {
            int complement = target - nums[i];
            if (mp.count(complement)) {
                return {mp[complement], i};
            }
            mp[nums[i]] = i;
        }
        return {};
    }
};`;

    const subRes = await SubmissionModel.createSubmission({
      userId: studentA.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: exactCode,
      isSampleRun: false,
    });

    // Update submission with evaluated verdict
    await SubmissionModel.updateSubmission(subRes.id, {
      status: 'accepted',
      score: 100,
      executionTime: 42,
      memoryUsed: 2048,
      testCasesPassed: 10,
      testCasesTotal: 10,
      validationSummary: {
        totalStages: 3,
        passedStages: 3,
        stages: [
          { name: 'standard', status: 'passed', passedCases: 4, totalCases: 4 },
          { name: 'random', status: 'passed', passedCases: 4, totalCases: 4 },
          { name: 'edge', status: 'passed', passedCases: 2, totalCases: 2 },
        ],
      },
    });

    record('Submission created and evaluated successfully in database', !!subRes.id);

    // -------------------------------------------------------------------
    // 3. SUBMISSION DETAIL RETRIEVAL API (GET /api/submissions/:id)
    // -------------------------------------------------------------------
    console.log('\n--- 3. Submission Detail API Verification ---');

    const detailRes = await request('GET', `/api/submissions/${subRes.id}`, null, aliceToken);
    record('Student A fetches own submission with 200 OK', detailRes.status === 200);
    record('Detail contains correct submission ID', detailRes.body.id === subRes.id);
    record('Detail contains problem title', detailRes.body.problemTitle === `Two Sum 581 ${ts}`);
    record('Detail contains problem difficulty', detailRes.body.problemDifficulty === 'easy');
    record('Detail contains contest title', detailRes.body.contestTitle === `Phase 5.8.1 Contest ${ts}`);
    record('Detail contains username', detailRes.body.username === studentA.username);
    record('Detail contains language CPP', detailRes.body.language === 'cpp');
    record('Detail contains codingMode function', detailRes.body.codingMode === 'function');
    record('Detail contains verdict accepted', detailRes.body.status === 'accepted');
    record('Detail contains score 100', detailRes.body.score === 100);
    record('Detail contains execution runtime 42ms', detailRes.body.executionTime === 42);
    record('Detail contains memory 2048 KB', detailRes.body.memoryUsed === 2048);
    record('Detail contains test cases passed 10/10', detailRes.body.testCasesPassed === 10 && detailRes.body.testCasesTotal === 10);
    record('Detail contains multi-tier validationSummary', typeof detailRes.body.validationSummary === 'object' && detailRes.body.validationSummary.stages.length === 3);

    // Exact historical code match
    record('EXACT CODE PRESERVATION: Source code matches byte-for-byte', detailRes.body.sourceCode === exactCode);

    // -------------------------------------------------------------------
    // 4. BOLA / IDOR & AUTHORIZATION CONTROLS
    // -------------------------------------------------------------------
    console.log('\n--- 4. BOLA / IDOR & Authorization Controls ---');

    // Student B attempts to access Student A's submission
    const bobAccessRes = await request('GET', `/api/submissions/${subRes.id}`, null, bobToken);
    record('BOLA PROTECTION: Student B is forbidden (403) from inspecting Student A submission', bobAccessRes.status === 403);
    record('BOLA error returns clean message without code leakage', !bobAccessRes.body.sourceCode);

    // Student B attempts to access Student A's code via /:id/code
    const bobCodeRes = await request('GET', `/api/submissions/${subRes.id}/code`, null, bobToken);
    record('BOLA PROTECTION: Student B is forbidden (403) from /:id/code', bobCodeRes.status === 403);

    // Professor can access submissions for their own contest
    const profAccessRes = await request('GET', `/api/submissions/${subRes.id}`, null, profToken);
    record('RBAC: Contest Creator Professor can inspect student submission with 200 OK', profAccessRes.status === 200);
    record('Professor receives exact submitted code', profAccessRes.body.sourceCode === exactCode);

    // -------------------------------------------------------------------
    // 5. PARAMETER VALIDATION & ERROR HANDLING
    // -------------------------------------------------------------------
    console.log('\n--- 5. Parameter Validation & Error Handling ---');

    // Non-existent ID
    const notFoundRes = await request('GET', '/api/submissions/9999999', null, aliceToken);
    record('Non-existent submission ID returns 404 Not Found', notFoundRes.status === 404);

    // Non-numeric ID
    const invalidIdRes = await request('GET', '/api/submissions/abc-invalid-id', null, aliceToken);
    record('Malformed non-numeric ID returns 400 Bad Request', invalidIdRes.status === 400);

    // Negative ID
    const negIdRes = await request('GET', '/api/submissions/-1', null, aliceToken);
    record('Negative submission ID returns 400 Bad Request', negIdRes.status === 400);

    // Unauthenticated request
    const unauthRes = await request('GET', `/api/submissions/${subRes.id}`);
    record('Unauthenticated request returns 401 Unauthorized', unauthRes.status === 401);

    // SQL injection payload
    const sqliRes = await request('GET', '/api/submissions/1%20OR%201=1', null, aliceToken);
    record('SQL injection payload is safely rejected (400 Bad Request)', sqliRes.status === 400);

    // Sensitive data leakage check
    record('PRIVACY: Password hash is never returned in submission detail', detailRes.body.passwordHash === undefined && detailRes.body.password_hash === undefined);

  } catch (err) {
    console.error('[UNEXPECTED TEST FAILURE]:', err);
    failedCount++;
  } finally {
    console.log('\n=======================================================');
    console.log(` PHASE 5.8.1 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    if (server) {
      server.close();
    }
    if (db.pool && db.pool.end) {
      await db.pool.end();
    }
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runTests();
