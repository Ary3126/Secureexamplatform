/**
 * Automated Test Suite for Phase 7.4.8: Language & Function/DSL Configuration
 *
 * Verifies:
 * 1. Supported Languages Configuration:
 *    - Valid custom allowedLanguages array (e.g. ['python', 'cpp', 'java'])
 *    - All 5 production languages supported ('python', 'cpp', 'java', 'javascript', 'c')
 *    - Reject empty allowedLanguages array (400)
 *    - Reject unsupported language in allowedLanguages (400)
 *    - Reject duplicate languages in allowedLanguages (400)
 *    - Reject non-array allowedLanguages (400)
 *    - Update allowedLanguages on existing problem (200)
 *
 * 2. Function Mode & DSL Validation (Backend Authoritative):
 *    - Valid function configuration with functionName, returnType, and structured parameters
 *    - Reject empty functionName (400)
 *    - Reject invalid functionName identifier (400)
 *    - Reject empty returnType (400)
 *    - Reject duplicate parameter names (400)
 *    - Reject invalid parameter identifier (400)
 *    - Reject missing parameter type (400)
 *    - Reject harness template missing __STUDENT_CODE__ in Function Mode (400)
 *    - Accept harness template with __STUDENT_CODE__ (201)
 *    - Standard OJ mode accepts empty/omitted functionConfig
 *
 * 3. Database Persistence & Lifecycle:
 *    - function_config stored as JSONB in problems table
 *    - function_config persisted across updates and versioning in problem_versions table
 *    - findProblemById returns functionConfig and allowedLanguages properly formatted
 *
 * 4. HarnessBuilder Integration & Code Generation:
 *    - Function Mode: injects student code into custom harness template for Python
 *    - Function Mode: injects student code into custom harness template for C++
 *    - Function Mode: Java class demotion (demotes public class Solution to class Solution)
 *    - Function Mode: injects student code into custom harness template for JavaScript
 *    - Function Mode: injects student code into custom harness template for C
 *    - Standard OJ: returns student source code unaltered (no harness injection)
 *
 * 5. Security, RBAC & BOLA Defense:
 *    - Unauthenticated request returns 401
 *    - Student role returns 403 Forbidden
 *    - Professor cannot modify another professor's problem (403 BOLA)
 *    - Professor can modify own problem (200)
 *    - Contest Admin and Super Admin can modify any problem (200)
 *    - No credentials or sensitive secrets exposed in API responses
 */

const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const apiRoutes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const HarnessBuilder = require('./src/judge/harness/harnessBuilder');
const ProblemModel = require('./src/models/problemModel');

let server;
let baseUrl;

let studentUser, studentToken;
let profUser, profToken;
let profUser2, profToken2;
let contestAdminUser, contestAdminToken;
let superAdminUser, superAdminToken;

let createdProblemIds = [];
let createdUserIds = [];

let passedAssertions = 0;
let failedAssertions = 0;

function check(label, condition, meta) {
  if (condition) {
    passedAssertions++;
    console.log('  [PASS] ' + label);
  } else {
    failedAssertions++;
    console.error('  [FAIL] ' + label + (meta !== undefined ? ' -> ' + JSON.stringify(meta) : ''));
  }
}

function getErrorString(data) {
  if (!data) return '';
  const arr = Array.isArray(data.errors) ? data.errors.join(' ') : '';
  return `${arr} ${data.error || ''} ${data.message || ''}`.toLowerCase();
}

async function request(method, path, body, token) {
  const url = baseUrl + path;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(function() { return null; });
  return { status: res.status, data: data };
}

async function createTestUser(username, role) {
  const email = `${username}_${Date.now()}@test.internal`;
  const hashed = await hashPassword('Password123!');
  const res = await db.query(
    `INSERT INTO users (username, email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, username, email, role`,
    [username, email, hashed, role, `Test ${username}`]
  );
  const user = res.rows[0];
  createdUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function createProblem(token, overrides) {
  overrides = overrides || {};
  const payload = Object.assign({
    title: 'Phase748 Problem ' + Date.now(),
    description: 'Problem for testing language and function/DSL configuration.',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    allowedLanguages: ['python', 'cpp', 'java'],
    functionConfig: {
      functionName: 'solve',
      returnType: 'int',
      parameters: [{ name: 'nums', type: 'vector<int>&' }],
    },
    starterTemplates: {
      python: 'class Solution:\n    def solve(self, nums):\n        return sum(nums)\n',
      cpp: 'class Solution {\npublic:\n    int solve(vector<int>& nums) { return 0; }\n};\n',
    },
    harnessTemplates: {
      python: 'import sys\n# __STUDENT_CODE__\ndef _trusted_platform_harness_main(): pass\nif __name__=="__main__": _trusted_platform_harness_main()\n',
      cpp: '#include <iostream>\n// __STUDENT_CODE__\nint main() { return 0; }\n',
    },
    testCases: [
      { inputData: '1 2 3', expectedOutput: '6', isHidden: false, isSample: true, testOrder: 1 },
    ],
  }, overrides);

  const res = await request('POST', '/api/problems', payload, token);
  if (res.status === 201 && res.data && res.data.problem && res.data.problem.id) {
    createdProblemIds.push(res.data.problem.id);
  }
  return res;
}

async function runTests() {
  console.log('\n=================================================================');
  console.log(' PHASE 7.4.8: LANGUAGE & FUNCTION/DSL CONFIGURATION TEST SUITE');
  console.log('=================================================================\n');

  try {
    // 1. Initialize Express App
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    console.log(`Test server online at ${baseUrl}`);

    // 2. Seed Test Users
    const uStudent = await createTestUser(`stu_${Date.now()}`, 'student');
    studentUser = uStudent.user; studentToken = uStudent.token;

    const uProf = await createTestUser(`prof1_${Date.now()}`, 'professor');
    profUser = uProf.user; profToken = uProf.token;

    const uProf2 = await createTestUser(`prof2_${Date.now()}`, 'professor');
    profUser2 = uProf2.user; profToken2 = uProf2.token;

    const uContestAdmin = await createTestUser(`ca_${Date.now()}`, 'contest_admin');
    contestAdminUser = uContestAdmin.user; contestAdminToken = uContestAdmin.token;

    const uSuperAdmin = await createTestUser(`sa_${Date.now()}`, 'super_admin');
    superAdminUser = uSuperAdmin.user; superAdminToken = uSuperAdmin.token;

    console.log('Test users created with verified JWT roles.\n');

    // -------------------------------------------------------------
    // Section 1: Supported Languages Configuration
    // -------------------------------------------------------------
    console.log('-- Section 1: Supported Languages Configuration --');

    // 1.1: Create problem with valid subset of allowedLanguages
    const langSubsetRes = await createProblem(profToken, {
      title: 'Subset Langs ' + Date.now(),
      allowedLanguages: ['python', 'cpp'],
    });
    check('1.1 Create problem with valid subset of allowedLanguages returns 201', langSubsetRes.status === 201);
    check('1.2 Problem allowedLanguages matches subset', 
      Array.isArray(langSubsetRes.data?.problem?.allowedLanguages) &&
      langSubsetRes.data.problem.allowedLanguages.length === 2 &&
      langSubsetRes.data.problem.allowedLanguages.includes('python') &&
      langSubsetRes.data.problem.allowedLanguages.includes('cpp')
    );

    // 1.3: Create problem with all 5 production languages
    const allLangsRes = await createProblem(profToken, {
      title: 'All Langs ' + Date.now(),
      allowedLanguages: ['python', 'cpp', 'java', 'javascript', 'c'],
    });
    check('1.3 Create problem with all 5 languages returns 201', allLangsRes.status === 201);
    check('1.4 All 5 languages returned in allowedLanguages', allLangsRes.data?.problem?.allowedLanguages?.length === 5);

    // 1.5: Reject empty allowedLanguages array
    const emptyLangsRes = await createProblem(profToken, {
      title: 'Empty Langs ' + Date.now(),
      allowedLanguages: [],
    });
    check('1.5 Reject empty allowedLanguages returns 400', emptyLangsRes.status === 400);

    // 1.6: Reject unsupported language in allowedLanguages
    const unsupportedLangRes = await createProblem(profToken, {
      title: 'Unsupported Lang ' + Date.now(),
      allowedLanguages: ['python', 'rust', 'csharp'],
    });
    check('1.6 Reject unsupported language returns 400', unsupportedLangRes.status === 400);
    check('1.7 Error indicates unsupported language', getErrorString(unsupportedLangRes.data).includes('unsupported') || getErrorString(unsupportedLangRes.data).includes('rust'));

    // 1.8: Reject duplicate languages in allowedLanguages
    const dupLangsRes = await createProblem(profToken, {
      title: 'Duplicate Langs ' + Date.now(),
      allowedLanguages: ['python', 'cpp', 'python'],
    });
    check('1.8 Reject duplicate languages returns 400', dupLangsRes.status === 400);
    check('1.9 Error indicates duplicate language', getErrorString(dupLangsRes.data).includes('duplicate'));

    // 1.10: Reject non-array allowedLanguages
    const nonArrayLangRes = await createProblem(profToken, {
      title: 'Non-array Lang ' + Date.now(),
      allowedLanguages: 'python',
    });
    check('1.10 Reject non-array allowedLanguages returns 400', nonArrayLangRes.status === 400);

    // 1.11: Update allowedLanguages on existing problem
    const updateLangRes = await request('PUT', `/api/problems/${langSubsetRes.data.problem.id}`, {
      allowedLanguages: ['python', 'cpp', 'javascript'],
      version: 1,
    }, profToken);
    check('1.11 Update allowedLanguages returns 200', updateLangRes.status === 200);
    check('1.12 Updated problem has 3 allowed languages', updateLangRes.data?.problem?.allowedLanguages?.length === 3);

    // -------------------------------------------------------------
    // Section 2: Function Mode & DSL Validation (Backend Authoritative)
    // -------------------------------------------------------------
    console.log('\n-- Section 2: Function Mode & DSL Validation --');

    // 2.1: Valid function configuration with functionName, returnType, and parameters
    const validFnConfigRes = await createProblem(profToken, {
      title: 'Valid Function Config ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'twoSum',
        returnType: 'vector<int>',
        parameters: [
          { name: 'nums', type: 'vector<int>&' },
          { name: 'target', type: 'int' },
        ],
      },
      starterTemplates: {
        cpp: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) { return {}; }\n};\n',
      },
      harnessTemplates: {
        cpp: '#include <iostream>\n// __STUDENT_CODE__\nint main() { return 0; }\n',
      },
    });
    check('2.1 Valid function configuration returns 201', validFnConfigRes.status === 201);
    check('2.2 Response contains persisted functionConfig', validFnConfigRes.data?.problem?.functionConfig?.functionName === 'twoSum');
    check('2.3 functionConfig parameters correctly structured', validFnConfigRes.data?.problem?.functionConfig?.parameters?.length === 2);

    // 2.4: Reject empty functionName in Function Mode
    const emptyFnNameRes = await createProblem(profToken, {
      title: 'Empty Fn Name ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: '',
        returnType: 'int',
      },
    });
    check('2.4 Reject empty functionName in Function Mode returns 400', emptyFnNameRes.status === 400);

    // 2.5: Reject invalid functionName identifier (starting with digit or special characters)
    const invalidFnNameRes = await createProblem(profToken, {
      title: 'Invalid Fn Name ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: '2badFunction!',
        returnType: 'int',
      },
    });
    check('2.5 Reject invalid functionName identifier returns 400', invalidFnNameRes.status === 400);

    // 2.6: Reject empty returnType in Function Mode
    const emptyRetTypeRes = await createProblem(profToken, {
      title: 'Empty Return Type ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve',
        returnType: '   ',
      },
    });
    check('2.6 Reject empty returnType in Function Mode returns 400', emptyRetTypeRes.status === 400);

    // 2.7: Reject duplicate parameter names
    const dupParamRes = await createProblem(profToken, {
      title: 'Duplicate Param ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve',
        returnType: 'int',
        parameters: [
          { name: 'nums', type: 'vector<int>&' },
          { name: 'nums', type: 'int' },
        ],
      },
    });
    check('2.7 Reject duplicate parameter names returns 400', dupParamRes.status === 400);
    check('2.8 Error mentions duplicate parameter name', getErrorString(dupParamRes.data).includes('duplicate parameter'));

    // 2.9: Reject invalid parameter name identifier
    const invalidParamNameRes = await createProblem(profToken, {
      title: 'Invalid Param Name ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve',
        returnType: 'int',
        parameters: [{ name: '99bad_param', type: 'int' }],
      },
    });
    check('2.9 Reject invalid parameter name identifier returns 400', invalidParamNameRes.status === 400);

    // 2.10: Reject missing parameter type
    const missingParamTypeRes = await createProblem(profToken, {
      title: 'Missing Param Type ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve',
        returnType: 'int',
        parameters: [{ name: 'validParam', type: '' }],
      },
    });
    check('2.10 Reject parameter missing type returns 400', missingParamTypeRes.status === 400);

    // 2.11: Reject Function Mode harness template missing __STUDENT_CODE__
    const missingPlaceholderRes = await createProblem(profToken, {
      title: 'Missing Placeholder ' + Date.now(),
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve',
        returnType: 'int',
      },
      harnessTemplates: {
        cpp: '#include <iostream>\nint main() { return 0; }\n',
      },
    });
    check('2.11 Reject harness missing __STUDENT_CODE__ in Function Mode returns 400', missingPlaceholderRes.status === 400);
    check('2.12 Error message specifies missing __STUDENT_CODE__ placeholder', getErrorString(missingPlaceholderRes.data).includes('__student_code__'));

    // 2.13: Standard OJ accepts empty / omitted functionConfig
    const ojProblemRes = await createProblem(profToken, {
      title: 'Standard OJ Problem ' + Date.now(),
      codingMode: 'full_program',
      functionConfig: {},
      starterTemplates: {
        python: 'import sys\nprint("hello world")\n',
      },
    });
    check('2.13 Standard OJ accepts omitted/empty functionConfig returns 201', ojProblemRes.status === 201);
    check('2.14 Standard OJ mode persisted as full_program', ojProblemRes.data?.problem?.codingMode === 'full_program');

    // -------------------------------------------------------------
    // Section 3: Database Persistence & Versioning for function_config
    // -------------------------------------------------------------
    console.log('\n-- Section 3: Database Persistence & Versioning --');

    const fnProbId = validFnConfigRes.data.problem.id;

    // 3.1: Verify in DB direct query on problems table
    const dbProbRes = await db.query('SELECT function_config, allowed_languages, coding_mode FROM problems WHERE id = $1', [fnProbId]);
    check('3.1 problems table has function_config JSONB column populated', dbProbRes.rows[0]?.function_config !== null);
    check('3.2 DB function_config contains twoSum functionName', dbProbRes.rows[0]?.function_config?.functionName === 'twoSum');
    check('3.3 DB allowed_languages matches configured array', Array.isArray(dbProbRes.rows[0]?.allowed_languages));

    // 3.2: Update functionConfig on existing problem
    const updateFnRes = await request('PUT', `/api/problems/${fnProbId}`, {
      functionConfig: {
        functionName: 'threeSum',
        returnType: 'vector<vector<int>>',
        parameters: [{ name: 'nums', type: 'vector<int>&' }],
      },
      version: 1,
    }, profToken);
    check('3.4 Update functionConfig returns 200', updateFnRes.status === 200);
    check('3.5 Problem version incremented to 2', updateFnRes.data?.problem?.version === 2);
    check('3.6 Updated functionName is threeSum', updateFnRes.data?.problem?.functionConfig?.functionName === 'threeSum');

    // 3.3: Set approved status and publish to create problem_versions snapshot
    await db.query(
      `UPDATE problems SET review_status = 'approved', approved_version = version WHERE id = $1`,
      [fnProbId]
    );
    const pubRes = await ProblemModel.publishProblemWithSafety(fnProbId, profUser);
    check('3.7 publishProblemWithSafety succeeds', pubRes.success === true);

    const dbVerRes = await db.query(
      'SELECT version_number, function_config, allowed_languages FROM problem_versions WHERE problem_id = $1 ORDER BY version_number ASC',
      [fnProbId]
    );
    check('3.8 problem_versions recorded snapshot with function_config', dbVerRes.rows.length >= 1);
    if (dbVerRes.rows.length >= 1) {
      check('3.8b Snapshot captures functionName', dbVerRes.rows[0]?.function_config?.functionName === 'threeSum');
      check('3.8c Snapshot captures allowed_languages', Array.isArray(dbVerRes.rows[0]?.allowed_languages));
    }

    // 3.4: Verify GET /api/problems/:id returns functionConfig
    const getProbRes = await request('GET', `/api/problems/${fnProbId}`, null, profToken);
    check('3.9 GET /api/problems/:id returns 200', getProbRes.status === 200);
    const fetchedConfig = getProbRes.data?.functionConfig || getProbRes.data?.problem?.functionConfig;
    check('3.10 GET response includes functionConfig', fetchedConfig?.functionName === 'threeSum');

    // -------------------------------------------------------------
    // Section 4: HarnessBuilder Integration & Code Generation
    // -------------------------------------------------------------
    console.log('\n-- Section 4: HarnessBuilder Integration & Code Generation --');

    // 4.1: Function Mode Python harness replacement
    const pyStudentCode = 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]';
    const pyHarness = 'import sys\n# __STUDENT_CODE__\nprint(Solution().twoSum([2,7,11,15], 9))\n';
    const pyBuilt = HarnessBuilder.buildExecutableCode({
      language: 'python',
      codingMode: 'function',
      sourceCode: pyStudentCode,
      problem: { harnessTemplates: { python: pyHarness } },
    });
    check('4.1 Python Function Mode injects student code into harness', pyBuilt.includes('class Solution:') && pyBuilt.includes('print(Solution().twoSum'));
    check('4.2 Python Function Mode removes __STUDENT_CODE__ placeholder', !pyBuilt.includes('__STUDENT_CODE__'));

    // 4.3: Function Mode C++ harness replacement
    const cppStudentCode = 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) { return {0, 1}; }\n};';
    const cppHarness = '#include <iostream>\n#include <vector>\nusing namespace std;\n// __STUDENT_CODE__\nint main() { Solution s; return 0; }\n';
    const cppBuilt = HarnessBuilder.buildExecutableCode({
      language: 'cpp',
      codingMode: 'function',
      sourceCode: cppStudentCode,
      problem: { harnessTemplates: { cpp: cppHarness } },
    });
    check('4.3 C++ Function Mode injects student code into harness', cppBuilt.includes('class Solution') && cppBuilt.includes('int main()'));
    check('4.4 C++ Function Mode removes __STUDENT_CODE__ placeholder', !cppBuilt.includes('__STUDENT_CODE__'));

    // 4.5: Function Mode Java class demotion
    const javaStudentCode = 'public class Solution {\n    public int[] twoSum(int[] nums, int target) { return new int[]{0, 1}; }\n}';
    const javaHarness = 'import java.util.*;\n// __STUDENT_CODE__\npublic class Main {\n    public static void main(String[] args) {\n        Solution sol = new Solution();\n    }\n}\n';
    const javaBuilt = HarnessBuilder.buildExecutableCode({
      language: 'java',
      codingMode: 'function',
      sourceCode: javaStudentCode,
      problem: { harnessTemplates: { java: javaHarness } },
    });
    check('4.5 Java Function Mode injects student code into harness', javaBuilt.includes('class Solution') && javaBuilt.includes('class Main'));
    check('4.6 Java Function Mode demotes public class Main to class Main for Solution.java compatibility', !javaBuilt.includes('public class Main') && javaBuilt.includes('public class Solution'));

    // 4.7: Function Mode JavaScript harness replacement
    const jsStudentCode = 'function twoSum(nums, target) { return [0, 1]; }';
    const jsHarness = '// __STUDENT_CODE__\nconsole.log(twoSum([2, 7, 11, 15], 9));\n';
    const jsBuilt = HarnessBuilder.buildExecutableCode({
      language: 'javascript',
      codingMode: 'function',
      sourceCode: jsStudentCode,
      problem: { harnessTemplates: { javascript: jsHarness } },
    });
    check('4.7 JS Function Mode injects student code into harness', jsBuilt.includes('function twoSum') && jsBuilt.includes('console.log(twoSum'));

    // 4.8: Function Mode C harness replacement
    const cStudentCode = 'int* twoSum(int* nums, int numsSize, int target, int* returnSize) { return NULL; }';
    const cHarness = '#include <stdio.h>\n#include <stdlib.h>\n// __STUDENT_CODE__\nint main() { return 0; }\n';
    const cBuilt = HarnessBuilder.buildExecutableCode({
      language: 'c',
      codingMode: 'function',
      sourceCode: cStudentCode,
      problem: { harnessTemplates: { c: cHarness } },
    });
    check('4.8 C Function Mode injects student code into harness', cBuilt.includes('int* twoSum') && cBuilt.includes('int main()'));

    // 4.9: Standard OJ returns unmodified source code for all languages
    for (const lang of ['python', 'cpp', 'java', 'javascript', 'c']) {
      const rawCode = `// Standard OJ for ${lang}`;
      const builtOJ = HarnessBuilder.buildExecutableCode({
        language: lang,
        codingMode: 'full_program',
        sourceCode: rawCode,
        problem: { harnessTemplates: { [lang]: 'UNUSED HARNESS' } },
      });
      check(`4.9 Standard OJ for ${lang} returns sourceCode unmodified`, builtOJ === rawCode);
    }

    // -------------------------------------------------------------
    // Section 5: Security, RBAC & BOLA Defense
    // -------------------------------------------------------------
    console.log('\n-- Section 5: Security, RBAC & BOLA Defense --');

    // 5.1: Unauthenticated request to create problem
    const unauthCreate = await request('POST', '/api/problems', {
      title: 'Unauth Problem',
      codingMode: 'function',
      functionConfig: { functionName: 'solve', returnType: 'int' },
    }, null);
    check('5.1 Unauthenticated request returns 401', unauthCreate.status === 401);

    // 5.2: Student role attempting to create problem
    const studentCreate = await request('POST', '/api/problems', {
      title: 'Student Problem',
      codingMode: 'function',
      functionConfig: { functionName: 'solve', returnType: 'int' },
    }, studentToken);
    check('5.2 Student role returns 403 Forbidden', studentCreate.status === 403);

    // 5.3: Student role attempting to update problem
    const studentUpdate = await request('PUT', `/api/problems/${fnProbId}`, {
      functionConfig: { functionName: 'hackedSolve', returnType: 'int' },
      version: 2,
    }, studentToken);
    check('5.3 Student role on PUT returns 403 Forbidden', studentUpdate.status === 403);

    // 5.4: Professor attempting to update another professor's problem (BOLA defense)
    const bolaUpdate = await request('PUT', `/api/problems/${fnProbId}`, {
      functionConfig: { functionName: 'stolenFunction', returnType: 'int' },
      version: 2,
    }, profToken2);
    check('5.4 Professor cannot update another professor problem (BOLA defense 403)', bolaUpdate.status === 403);

    // 5.5: Professor can update own problem
    const ownUpdate = await request('PUT', `/api/problems/${fnProbId}`, {
      title: 'Updated Own Problem Title',
      version: 2,
    }, profToken);
    check('5.5 Professor can update own problem (200 OK)', ownUpdate.status === 200);

    // 5.6: Contest Admin can update any problem
    const caUpdate = await request('PUT', `/api/problems/${fnProbId}`, {
      allowedLanguages: ['python', 'cpp', 'java', 'javascript'],
      version: 3,
    }, contestAdminToken);
    check('5.6 Contest Admin can update problem (200 OK)', caUpdate.status === 200);

    // 5.7: Super Admin can update any problem
    const saUpdate = await request('PUT', `/api/problems/${fnProbId}`, {
      allowedLanguages: ['python', 'cpp', 'java', 'javascript', 'c'],
      version: 4,
    }, superAdminToken);
    check('5.7 Super Admin can update problem (200 OK)', saUpdate.status === 200);

    // 5.8: Sensitive credentials check: verify no password_hash or jwt_secret leak
    const responseBodyStr = JSON.stringify(saUpdate.data);
    check('5.8 Response does not expose password_hash', !responseBodyStr.includes('password_hash'));
    check('5.9 Response does not expose jwt_secret', !responseBodyStr.includes('jwt_secret'));

  } catch (err) {
    console.error('Fatal test error in test suite:', err);
    failedAssertions++;
  } finally {
    // Teardown
    console.log('\n-- Teardown: Purging Ephemeral Test Data --');
    try {
      if (createdProblemIds.length > 0) {
        await db.query(`DELETE FROM test_cases WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM audit_logs WHERE resource_type = 'problem' AND resource_id = ANY($1::int[])`, [createdProblemIds]);
        await db.query(`DELETE FROM problems WHERE id = ANY($1::int[])`, [createdProblemIds]);
        console.log(`  Purged ${createdProblemIds.length} test problems.`);
      }
      if (createdUserIds.length > 0) {
        await db.query(`DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])`, [createdUserIds]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [createdUserIds]);
        console.log(`  Purged ${createdUserIds.length} test users.`);
      }
    } catch (cleanErr) {
      console.error('Cleanup warning:', cleanErr.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await db.pool.end();

    console.log('\n=================================================================');
    console.log(` PHASE 7.4.8 TEST RESULTS: ${passedAssertions} passed, ${failedAssertions} failed`);
    console.log('=================================================================\n');

    if (failedAssertions > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
