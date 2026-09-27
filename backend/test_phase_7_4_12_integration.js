/**
 * PHASE 7.4.12 — COMPLETE END-TO-END INTEGRATION & VERIFICATION SUITE
 * 
 * Verifies:
 * 1. End-to-End Workflow 1: Standard OJ Problem (Create -> Test Cases -> Draft -> Preview -> Publish -> Student Discovery -> Submit -> Judge -> Result)
 * 2. End-to-End Workflow 2: Function Mode Problem (DSL Config -> Templates -> Harness -> Draft -> Preview -> Publish -> Student Submit -> Wrapped Execution -> Result)
 * 3. Edit & Versioning Integration: Stale Concurrency (409), Draft Reset, Snapshots History
 * 4. Test Case Scoping: Visible Sample vs Hidden Test Isolation (Zero Leakage)
 * 5. Clone & Delete Invariants: Clone to Draft, Submission Protection Against Deletion
 * 6. RBAC & Cross-Role Authorization: Student, Professor, Contest Admin, Super Admin
 * 7. Database Integrity & Audit Logging Tracing
 */

const http = require('http');
const { app } = require('./src/server');
const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemLifecycleModel = require('./src/models/problemLifecycleModel');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');
const { generateToken, hashPassword } = require('./src/services/authService');

let server;
let port;
let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

function makeRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
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
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSubmission(submissionId, token, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await makeRequest({
      method: 'GET',
      path: `/api/submissions/${submissionId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 200 && res.body.status !== 'queued' && res.body.status !== 'running') {
      return res.body;
    }
    await sleep(250);
  }
  throw new Error(`Submission ${submissionId} timed out waiting for evaluation.`);
}

async function runPhase7412Integration() {
  console.log('\n=================================================================');
  console.log(' PHASE 7.4.12 — GENERAL PROBLEM MANAGEMENT FINAL INTEGRATION');
  console.log('=================================================================\n');

  const rand = Date.now();
  const createdUserIds = [];
  const createdProblemIds = [];

  try {
    // 0. Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        console.log(`Integration test server online at http://127.0.0.1:${port}`);
        resolve();
      });
    });

    // Seed test actors
    const pwHash = await hashPassword('TestP@ssword123!');
    const studentUser = await UserModel.createUser({
      username: `p7412_stu_${rand}`,
      email: `stu_${rand}@p7412.com`,
      passwordHash: pwHash,
      fullName: 'Alice Student',
      role: 'student',
    });
    createdUserIds.push(studentUser.id);
    const studentToken = generateToken(studentUser);

    const profA = await UserModel.createUser({
      username: `p7412_profa_${rand}`,
      email: `profa_${rand}@p7412.com`,
      passwordHash: pwHash,
      fullName: 'Professor Alan',
      role: 'professor',
    });
    createdUserIds.push(profA.id);
    const profAToken = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `p7412_profb_${rand}`,
      email: `profb_${rand}@p7412.com`,
      passwordHash: pwHash,
      fullName: 'Professor Brenda',
      role: 'professor',
    });
    createdUserIds.push(profB.id);
    const profBToken = generateToken(profB);

    const adminUser = await UserModel.createUser({
      username: `p7412_adm_${rand}`,
      email: `adm_${rand}@p7412.com`,
      passwordHash: pwHash,
      fullName: 'Sarah SuperAdmin',
      role: 'super_admin',
    });
    createdUserIds.push(adminUser.id);
    const adminToken = generateToken(adminUser);

    // -------------------------------------------------------------
    // SECTION 1: END-TO-END WORKFLOW 1 — STANDARD OJ
    // -------------------------------------------------------------
    console.log('-- Section 1: End-to-End Workflow 1 — Standard OJ --');

    // 1.1 Admin creates Standard OJ problem with starter templates
    const ojCreateRes = await makeRequest({
      method: 'POST',
      path: '/api/problems',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: `Multiply Two Numbers (Standard OJ) ${rand}`,
        description: 'Read two integers a and b from standard input and print their product to standard output.',
        difficulty: 'easy',
        codingMode: 'full_program',
        accessScope: 'public',
        isPublished: false,
        allowedLanguages: ['python', 'cpp', 'java'],
        starterTemplates: {
          python: '# Standard OJ: Read from stdin\nimport sys\nline = sys.stdin.read().split()\nif line:\n    a, b = int(line[0]), int(line[1])\n    print(a * b)\n',
          cpp: '#include <iostream>\nusing namespace std;\nint main() {\n    long long a, b;\n    if (cin >> a >> b) cout << a * b << endl;\n    return 0;\n}\n',
          java: 'import java.util.Scanner;\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextLong()) {\n            long a = sc.nextLong();\n            long b = sc.nextLong();\n            System.out.println(a * b);\n        }\n    }\n}\n',
        },
      },
    });

    assert(ojCreateRes.status === 201, '1.1 Admin creates Standard OJ problem (201 Created)');
    const ojProblem = ojCreateRes.body.problem;
    createdProblemIds.push(ojProblem.id);
    assert(ojProblem.codingMode === 'full_program', '1.2 Problem codingMode is full_program');
    assert(ojProblem.isPublished === false || ojProblem.is_published === false || (ojProblem.reviewStatus || ojProblem.review_status) === 'draft', '1.3 Initial status is unpublished draft');
    assert(ojProblem.version === 1, '1.4 Initial version is 1');

    // 1.2 Add Visible Sample Test Case and Hidden Test Case
    const sampleTcRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${ojProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        inputData: '3 4\n',
        expectedOutput: '12',
        isHidden: false,
        isSample: true,
        testOrder: 1,
      },
    });
    assert(sampleTcRes.status === 201, '1.5 Sample test case added (201 Created)');

    const hiddenTcRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${ojProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        inputData: '1000 2000\n',
        expectedOutput: '2000000',
        isHidden: true,
        isSample: false,
        testOrder: 2,
      },
    });
    assert(hiddenTcRes.status === 201, '1.6 Hidden test case added (201 Created)');

    // 1.3 Preview Draft Problem (Admin only, zero hidden test leakage)
    const ojPreviewRes = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}/preview`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(ojPreviewRes.status === 200, '1.7 Admin can preview draft problem (200 OK)');
    assert(ojPreviewRes.body.sampleTestCases.length === 1, '1.8 Preview contains exactly 1 sample test case');
    assert(!JSON.stringify(ojPreviewRes.body).includes('1000 2000'), '1.9 CRITICAL: Preview never exposes hidden input');
    assert(!JSON.stringify(ojPreviewRes.body).includes('2000000'), '1.10 CRITICAL: Preview never exposes hidden expected output');

    // 1.4 Student blocked from unpublished draft
    const stuDraftGet = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(stuDraftGet.status === 404 || stuDraftGet.status === 403, '1.11 Student blocked from unpublished draft problem');

    // 1.5 Publish Standard OJ Problem
    const ojPublishRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${ojProblem.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { accessScope: 'public' },
    });
    assert(ojPublishRes.status === 200, '1.12 Problem published successfully (200 OK)');
    assert(ojPublishRes.body.problem.isPublished === true, '1.13 Problem state isPublished = true');
    assert(ojPublishRes.body.problem.reviewStatus === 'published', '1.14 Problem reviewStatus = published');

    // 1.6 Student Discovers Problem via Catalog & Search
    const stuCatalogRes = await makeRequest({
      method: 'GET',
      path: `/api/problems?search=Multiply&difficulty=easy`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(stuCatalogRes.status === 200, '1.15 Student catalog discovery returns 200 OK');
    const catalogProblems = stuCatalogRes.body.problems || stuCatalogRes.body.data || [];
    const foundProblem = catalogProblems.find((p) => p.id === ojProblem.id);
    assert(Boolean(foundProblem), '1.16 Published Standard OJ problem visible in student catalog search');

    // 1.7 Student Views Published Problem
    const stuProbGet = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(stuProbGet.status === 200, '1.17 Student fetches published problem detail (200 OK)');
    assert(stuProbGet.body.sampleTestCases.length === 1, '1.18 Student receives visible sample test case');
    assert(!JSON.stringify(stuProbGet.body).includes('1000 2000'), '1.19 Zero hidden test leakage in student problem view');

    // 1.8 Student Submits Solution to Judge
    const ojSubmitRes = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        problemId: ojProblem.id,
        language: 'python',
        codingMode: 'full_program',
        sourceCode: 'import sys\nline = sys.stdin.read().split()\nif line:\n    a, b = int(line[0]), int(line[1])\n    print(a * b)\n',
      },
    });
    assert(ojSubmitRes.status === 201, '1.20 Student submission queued (201 Created)');
    const ojSubId = ojSubmitRes.body.submission.id;
    const ojSubResult = await waitForSubmission(ojSubId, studentToken);
    assert(ojSubResult.status === 'accepted', '1.21 Standard OJ Python submission evaluated as ACCEPTED');
    assert(ojSubResult.score === 100, '1.22 Standard OJ Python submission awarded 100 points');

    // -------------------------------------------------------------
    // SECTION 2: END-TO-END WORKFLOW 2 — FUNCTION MODE
    // -------------------------------------------------------------
    console.log('\n-- Section 2: End-to-End Workflow 2 — Function Mode --');

    // 2.1 Professor creates Function Mode problem with DSL config
    const fnCreateRes = await makeRequest({
      method: 'POST',
      path: '/api/problems',
      headers: { Authorization: `Bearer ${profAToken}` },
      body: {
        title: `Two Sum Function Mode ${rand}`,
        description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
        difficulty: 'medium',
        codingMode: 'function',
        accessScope: 'public',
        isPublished: false,
        allowedLanguages: ['python', 'cpp', 'java'],
        functionConfig: {
          functionName: 'twoSum',
          returnType: 'List[int]',
          parameters: [
            { name: 'nums', type: 'List[int]' },
            { name: 'target', type: 'int' },
          ],
        },
        starterTemplates: {
          python: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        # Implement your solution\n        return []\n',
          cpp: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return {};\n    }\n};\n',
          java: 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{};\n    }\n}\n',
        },
        harnessTemplates: {
          python: `import sys, json

__STUDENT_CODE__

def _run():
    lines = sys.stdin.read().strip().split('\\n')
    if not lines or not lines[0]: return
    nums = json.loads(lines[0])
    target = int(lines[1])
    sol = Solution()
    res = sol.twoSum(nums, target)
    print(f"{res[0]} {res[1]}")

if __name__ == '__main__':
    _run()
`,
          cpp: `#include <iostream>
#include <vector>
#include <sstream>
using namespace std;

__STUDENT_CODE__

int main() {
    // Harness driver
    return 0;
}
`,
          java: `import java.util.*;

__STUDENT_CODE__

public class Main {
    public static void main(String[] args) {
        // Harness driver
    }
}
`,
        },
      },
    });

    assert(fnCreateRes.status === 201, '2.1 Professor creates Function Mode problem (201 Created)');
    const fnProblem = fnCreateRes.body.problem;
    createdProblemIds.push(fnProblem.id);
    assert(fnProblem.codingMode === 'function', '2.2 Problem codingMode is function');
    assert(fnProblem.functionConfig.functionName === 'twoSum', '2.3 Problem functionConfig contains twoSum');

    // 2.2 Add Sample and Hidden Test Cases (JSON formatted lines)
    await makeRequest({
      method: 'POST',
      path: `/api/problems/${fnProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${profAToken}` },
      body: {
        inputData: '[2, 7, 11, 15]\n9\n',
        expectedOutput: '0 1',
        isHidden: false,
        isSample: true,
        testOrder: 1,
      },
    });

    await makeRequest({
      method: 'POST',
      path: `/api/problems/${fnProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${profAToken}` },
      body: {
        inputData: '[3, 2, 4]\n6\n',
        expectedOutput: '1 2',
        isHidden: true,
        isSample: false,
        testOrder: 2,
      },
    });

    // 2.3 Verify HarnessBuilder generates clean code without placeholder
    const studentSol = 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            diff = target - n\n            if diff in seen:\n                return [seen[diff], i]\n            seen[n] = i\n        return []\n';
    const wrappedCode = HarnessBuilder.buildExecutableCode({
      sourceCode: studentSol,
      language: 'python',
      codingMode: 'function',
      harnessTemplates: fnProblem.harnessTemplates,
    });
    assert(!wrappedCode.includes('__STUDENT_CODE__'), '2.4 HarnessBuilder strips __STUDENT_CODE__ placeholder');
    assert(wrappedCode.includes('class Solution:'), '2.5 HarnessBuilder embeds student solution');
    assert(wrappedCode.includes('_run()'), '2.6 HarnessBuilder maintains execution driver entrypoint');

    // 2.4 Professor Problem Published by Platform Admin (Approval Gate)
    const fnPublishRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${fnProblem.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { accessScope: 'public' },
    });
    assert(fnPublishRes.status === 200, '2.7 Function Mode problem published successfully (200 OK)');

    // 2.5 Student Submits Function Mode Code to Judge
    const fnSubmitRes = await makeRequest({
      method: 'POST',
      path: '/api/submissions',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        problemId: fnProblem.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: studentSol,
      },
    });
    assert(fnSubmitRes.status === 201, '2.8 Function Mode submission queued (201 Created)');
    const fnSubId = fnSubmitRes.body.submission.id;
    const fnSubResult = await waitForSubmission(fnSubId, studentToken);
    assert(fnSubResult.status === 'accepted', '2.9 Function Mode submission evaluated as ACCEPTED');
    assert(fnSubResult.score === 100, '2.10 Function Mode submission awarded 100 points');

    // -------------------------------------------------------------
    // SECTION 3: EDIT + VERSION INTEGRATION & CONCURRENCY
    // -------------------------------------------------------------
    console.log('\n-- Section 3: Edit + Version Integration & Concurrency --');

    // 3.1 Edit Published Problem -> Resets to Draft & Increments Version
    const editRes = await makeRequest({
      method: 'PUT',
      path: `/api/problems/${ojProblem.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: `Multiply Two Numbers (Updated) ${rand}`,
        description: 'Updated problem description requiring 64-bit integer handling.',
        difficulty: 'medium',
        expectedVersion: 1,
      },
    });
    assert(editRes.status === 200, '3.1 Edit published problem returns 200 OK');
    assert(editRes.body.problem.version === 2, '3.2 Problem version incremented to 2');
    assert(editRes.body.problem.isPublished === false || editRes.body.problem.is_published === false, '3.3 Editing published problem resets isPublished = false');
    assert((editRes.body.problem.reviewStatus || editRes.body.problem.review_status) === 'draft', '3.4 Editing published problem resets reviewStatus = draft');

    // 3.2 Optimistic Concurrency Control: Stale Version Conflict
    const staleUpdateRes = await makeRequest({
      method: 'PUT',
      path: `/api/problems/${ojProblem.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: 'Conflicting Stale Update',
        expectedVersion: 1, // Client still holds version 1
      },
    });
    assert(staleUpdateRes.status === 409, '3.5 Stale version update rejected with HTTP 409 Conflict');
    assert(staleUpdateRes.body.currentVersion === 2, '3.6 Conflict response returns currentVersion = 2');

    // 3.3 Republish Problem with version 2
    const republishRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${ojProblem.id}/publish`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { accessScope: 'public' },
    });
    assert(republishRes.status === 200, '3.7 Republish problem returns 200 OK');
    assert(republishRes.body.problem.version === 2, '3.8 Republished problem version is 2');

    // 3.4 Version History Snapshots Verification
    const versionsRes = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}/versions`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(versionsRes.status === 200, '3.9 Admin fetches version history (200 OK)');
    assert(versionsRes.body.versions.length >= 2, '3.10 Version history contains both version snapshots');

    const v1Res = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}/versions/1`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(v1Res.status === 200, '3.11 Fetch version 1 snapshot returns 200 OK');
    assert(v1Res.body.version.versionNumber === 1, '3.12 Version 1 snapshot retains original versionNumber 1');

    // -------------------------------------------------------------
    // SECTION 4: CLONE & DELETE INTEGRATION
    // -------------------------------------------------------------
    console.log('\n-- Section 4: Clone & Delete Integration --');

    // 4.1 Clone Problem
    const cloneRes = await makeRequest({
      method: 'POST',
      path: `/api/problems/${fnProblem.id}/clone`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Cloned Two Sum ${rand}` },
    });
    assert(cloneRes.status === 201, '4.1 Clone problem returns 201 Created');
    const clonedProblem = cloneRes.body.problem;
    createdProblemIds.push(clonedProblem.id);
    assert(clonedProblem.id !== fnProblem.id, '4.2 Cloned problem has distinct ID');
    assert(clonedProblem.isPublished === false, '4.3 Cloned problem defaults to unpublished draft');
    assert(clonedProblem.version === 1, '4.4 Cloned problem version resets to 1');
    assert(clonedProblem.codingMode === 'function', '4.5 Cloned problem preserves codingMode');

    // 4.2 Delete Problem with Submissions (Protected by Foreign Key / Policy)
    const delWithSubs = await makeRequest({
      method: 'DELETE',
      path: `/api/problems/${ojProblem.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(delWithSubs.status === 409, '4.6 Deleting problem with active submissions rejected with 409 Conflict');

    // 4.3 Delete Cloned Problem without Submissions
    const delCloned = await makeRequest({
      method: 'DELETE',
      path: `/api/problems/${clonedProblem.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(delCloned.status === 200, '4.7 Deleting problem with zero submissions returns 200 OK');

    const checkDeleted = await makeRequest({
      method: 'GET',
      path: `/api/problems/${clonedProblem.id}`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(checkDeleted.status === 404, '4.8 Deleted problem returns 404 Not Found');

    // -------------------------------------------------------------
    // SECTION 5: RBAC & CROSS-ROLE AUTHORIZATION MATRIX
    // -------------------------------------------------------------
    console.log('\n-- Section 5: RBAC & Cross-Role Authorization Matrix --');

    // 5.1 Student denied administrative problem creation
    const stuCreateProb = await makeRequest({
      method: 'POST',
      path: '/api/problems',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: { title: 'Illegal Student Problem', description: 'test', difficulty: 'easy' },
    });
    assert(stuCreateProb.status === 403, '5.1 Student denied POST /api/problems (403 Forbidden)');

    // 5.2 Student denied test case access
    const stuGetTc = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(stuGetTc.status === 403, '5.2 Student denied GET /test-cases (403 Forbidden)');

    // 5.3 Student denied version history access
    const stuGetVers = await makeRequest({
      method: 'GET',
      path: `/api/problems/${ojProblem.id}/versions`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(stuGetVers.status === 403, '5.3 Student denied GET /versions (403 Forbidden)');

    // 5.4 Professor B blocked from modifying Professor A's problem (BOLA)
    const bolaUpdate = await makeRequest({
      method: 'PUT',
      path: `/api/problems/${fnProblem.id}`,
      headers: { Authorization: `Bearer ${profBToken}` },
      body: { title: 'BOLA Hijack Attempt' },
    });
    assert(bolaUpdate.status === 403, '5.4 Professor B denied modifying Professor A problem (403 BOLA)');

    // 5.5 Professor B blocked from adding test case to Professor A's problem
    const bolaAddTc = await makeRequest({
      method: 'POST',
      path: `/api/problems/${fnProblem.id}/test-cases`,
      headers: { Authorization: `Bearer ${profBToken}` },
      body: { inputData: '1', expectedOutput: '2' },
    });
    assert(bolaAddTc.status === 403, '5.5 Professor B denied adding test case to Professor A problem (403 BOLA)');

    // -------------------------------------------------------------
    // SECTION 6: DATABASE INTEGRITY & AUDIT LOGGING
    // -------------------------------------------------------------
    console.log('\n-- Section 6: Database Integrity & Audit Logging --');

    // 6.1 Verify Audit Log Entries for Problem Operations
    const auditRes = await query(
      `SELECT action, outcome, metadata FROM audit_logs WHERE resource_type = 'problem' AND resource_id = $1 ORDER BY id ASC`,
      [ojProblem.id]
    );
    const actions = auditRes.rows.map((r) => r.action);
    assert(actions.includes('PROBLEM_CREATED'), '6.1 Audit log recorded PROBLEM_CREATED');
    assert(actions.includes('PROBLEM_PUBLISHED'), '6.2 Audit log recorded PROBLEM_PUBLISHED');
    assert(actions.includes('PROBLEM_UPDATED'), '6.3 Audit log recorded PROBLEM_UPDATED');

    // 6.2 Verify Zero Orphaned Test Cases
    const orphanTcRes = await query(
      `SELECT COUNT(*)::int AS count FROM test_cases tc LEFT JOIN problems p ON tc.problem_id = p.id WHERE p.id IS NULL`
    );
    assert(orphanTcRes.rows[0].count === 0, '6.4 Database integrity: 0 orphaned test cases');

    // 6.3 Verify Zero Orphaned Problem Versions
    const orphanPvRes = await query(
      `SELECT COUNT(*)::int AS count FROM problem_versions pv LEFT JOIN problems p ON pv.problem_id = p.id WHERE p.id IS NULL`
    );
    assert(orphanPvRes.rows[0].count === 0, '6.5 Database integrity: 0 orphaned problem versions');

    // 6.4 API Response Sanitization (No password hashes or JWT secrets)
    const sampleResp = JSON.stringify(stuProbGet.body) + JSON.stringify(ojPreviewRes.body);
    assert(!sampleResp.includes('password_hash'), '6.6 Responses clean of password_hash');
    assert(!sampleResp.includes('jwt_secret'), '6.7 Responses clean of jwt_secret');

  } catch (err) {
    console.error('Unhandled exception in Phase 7.4.12 Integration Suite:', err);
    failCount++;
  } finally {
    // Teardown
    console.log('\n-- Teardown: Purging Ephemeral Test Fixtures --');
    try {
      for (const pid of createdProblemIds) {
        await query(`DELETE FROM submissions WHERE problem_id = $1`, [pid]);
        await query(`DELETE FROM problem_versions WHERE problem_id = $1`, [pid]);
        await query(`DELETE FROM test_cases WHERE problem_id = $1`, [pid]);
        await query(`DELETE FROM problems WHERE id = $1`, [pid]);
      }
      for (const uid of createdUserIds) {
        await query(`DELETE FROM submissions WHERE user_id = $1`, [uid]);
        await query(`DELETE FROM users WHERE id = $1`, [uid]);
      }
      console.log(`  Purged ${createdProblemIds.length} test problems and ${createdUserIds.length} test users.`);
    } catch (e) {
      console.error('Error during cleanup:', e.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('Test HTTP server closed.');
    }
    await closePool();
    console.log('Database pool closed.');

    console.log('\n=================================================================');
    console.log(` PHASE 7.4.12 INTEGRATION RESULTS: ${passCount} passed, ${failCount} failed`);
    console.log('=================================================================\n');

    process.exit(failCount > 0 ? 1 : 0);
  }
}

runPhase7412Integration();
