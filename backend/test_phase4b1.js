const http = require('http');
const { query, closePool } = require('./src/config/db');
const { app } = require('./src/server');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const ValidationConfigService = require('./src/services/validationConfigService');
const JudgeService = require('./src/judge/judgeService');
const { hashPassword, generateToken } = require('./src/services/authService');
const { VALIDATION_MODES, GENERATOR_TYPES, VALIDATION_LIMITS } = require('./src/judge/validation/validationConstants');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let testServer = null;
let serverPort = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${message}`);
  }
}

// HTTP request helper
function apiRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: serverPort,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = {};
          try {
            json = data ? JSON.parse(data) : {};
          } catch (e) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, data: json });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (body) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 4B.1 TEST SUITE');
  console.log(' (Validation Architecture & Problem Test Configuration)');
  console.log('=======================================================\n');

  try {
    // Start ephemeral test server
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        serverPort = testServer.address().port;
        console.log(`[TEST HARNESS] Ephemeral test server running on port ${serverPort}\n`);
        resolve();
      });
    });

    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    // 1. Setup Professor A, Professor B, and Student
    const profA = await UserModel.createUser({
      username: `prof_a_${unique}`,
      email: `profa_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Professor A',
      role: 'professor',
    });
    const tokenProfA = generateToken(profA);

    const profB = await UserModel.createUser({
      username: `prof_b_${unique}`,
      email: `profb_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Professor B',
      role: 'professor',
    });
    const tokenProfB = generateToken(profB);

    const student = await UserModel.createUser({
      username: `student_${unique}`,
      email: `student_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Student Arya',
      role: 'student',
    });
    const tokenStudent = generateToken(student);

    // Create Problem owned by Prof A
    const problemA = await ProblemModel.createProblem({
      title: `Phase 4B.1 Validation Problem ${unique}`,
      description: 'Solve the sum problem with validation architecture enabled.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
      createdBy: profA.id,
    });

    const testCase1 = await TestCaseModel.createTestCase({
      problemId: problemA.id,
      inputData: '10 20\n',
      expectedOutput: '30',
      isHidden: false,
      testOrder: 1,
    });
    const testCase2 = await TestCaseModel.createTestCase({
      problemId: problemA.id,
      inputData: '50 150\n',
      expectedOutput: '200',
      isHidden: true,
      testOrder: 2,
    });

    // ==========================================
    // 1. CONSTANTS & ENUMS VERIFICATION
    // ==========================================
    console.log('--- 1. Validation Categories & Constants ---');
    assert(VALIDATION_MODES.STANDARD === 'STANDARD', 'VALIDATION_MODES includes STANDARD');
    assert(VALIDATION_MODES.EDGE === 'EDGE', 'VALIDATION_MODES includes EDGE');
    assert(VALIDATION_MODES.BOUNDARY === 'BOUNDARY', 'VALIDATION_MODES includes BOUNDARY');
    assert(VALIDATION_MODES.RANDOM === 'RANDOM', 'VALIDATION_MODES includes RANDOM');
    assert(GENERATOR_TYPES.DEFAULT === 'default', 'GENERATOR_TYPES includes default');
    assert(GENERATOR_TYPES.RANGE_GENERATOR === 'range_generator', 'GENERATOR_TYPES includes range_generator');
    assert(VALIDATION_LIMITS.MAX_RANDOM_TESTS === 50, 'Max random test limit is 50 to prevent resource exhaustion');

    // ==========================================
    // 2. DATABASE MODEL & UNIQUE RELATIONSHIP
    // ==========================================
    console.log('\n--- 2. Database Model & Relationship ---');
    
    // Check initial default (no config in DB)
    const initialConfig = await ProblemValidationConfigModel.findByProblemId(problemA.id);
    assert(initialConfig === null, 'Problem has no validation config initially in database');

    // Create configuration via Model
    const createdConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problemA.id,
      validationEnabled: true,
      randomEnabled: true,
      randomTestCount: 15,
      edgeEnabled: true,
      boundaryEnabled: true,
      generatorType: 'range_generator',
      generatorConfig: { min: -1000, max: 1000 },
      validationMetadata: { author: 'Prof A', phase: '4B.1' },
    });

    assert(createdConfig.problemId === problemA.id, 'Config successfully created for problem');
    assert(createdConfig.validationEnabled === true, 'validationEnabled is true');
    assert(createdConfig.randomEnabled === true, 'randomEnabled is true');
    assert(createdConfig.randomTestCount === 15, 'randomTestCount is 15');
    assert(createdConfig.edgeEnabled === true, 'edgeEnabled is true');
    assert(createdConfig.boundaryEnabled === true, 'boundaryEnabled is true');
    assert(createdConfig.generatorType === 'range_generator', 'generatorType is range_generator');
    assert(createdConfig.generatorConfig.min === -1000, 'generatorConfig stored as JSONB correctly');

    // Test UPSERT (update existing without duplicate row)
    const updatedConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problemA.id,
      validationEnabled: false,
      randomTestCount: 25,
      generatorType: 'default',
    });
    assert(updatedConfig.id === createdConfig.id, 'UPSERT maintains same config ID (no duplicate created)');
    assert(updatedConfig.validationEnabled === false, 'validationEnabled updated to false');
    assert(updatedConfig.randomTestCount === 25, 'randomTestCount updated to 25');

    // ==========================================
    // 3. SERVICE LEVEL INPUT VALIDATION & LIMITS
    // ==========================================
    console.log('\n--- 3. Validation Service & Input Sanitization ---');

    // Negative randomTestCount should fail
    let errCaught = false;
    try {
      await ValidationConfigService.saveConfig(problemA.id, { randomTestCount: -5 });
    } catch (e) {
      errCaught = true;
      assert(e.statusCode === 400, 'Rejects negative randomTestCount with 400 Bad Request');
    }
    assert(errCaught, 'Negative randomTestCount correctly threw error');

    // Excessive randomTestCount (>50) should fail
    errCaught = false;
    try {
      await ValidationConfigService.saveConfig(problemA.id, { randomTestCount: 999 });
    } catch (e) {
      errCaught = true;
      assert(e.statusCode === 400, 'Rejects excessive randomTestCount (>50) with 400 Bad Request');
    }
    assert(errCaught, 'Excessive randomTestCount correctly threw error');

    // Invalid generatorType should fail
    errCaught = false;
    try {
      await ValidationConfigService.saveConfig(problemA.id, { generatorType: 'unsupported_malicious_type' });
    } catch (e) {
      errCaught = true;
      assert(e.statusCode === 400, 'Rejects invalid generatorType with 400 Bad Request');
    }
    assert(errCaught, 'Invalid generatorType correctly threw error');

    // Non-existent problem ID should fail with 404
    errCaught = false;
    try {
      await ValidationConfigService.saveConfig(999999, { validationEnabled: true });
    } catch (e) {
      errCaught = true;
      assert(e.statusCode === 404, 'Rejects non-existent problem ID with 404 Not Found');
    }
    assert(errCaught, 'Non-existent problem correctly threw 404');

    // ==========================================
    // 4. API & RBAC AUTHORIZATION TESTS
    // ==========================================
    console.log('\n--- 4. API Endpoints & RBAC Security ---');

    // GET config for problem
    const getRes = await apiRequest({
      method: 'GET',
      path: `/api/problems/${problemA.id}/validation-config`,
      headers: { Authorization: `Bearer ${tokenProfA}` },
    });
    assert(getRes.status === 200, 'GET /problems/:id/validation-config returns 200 OK');
    assert(getRes.data.config.problemId === problemA.id, 'GET returns correct problem config');

    // Student attempt to PUT config (must be 403 Forbidden)
    const studentPutRes = await apiRequest({
      method: 'PUT',
      path: `/api/problems/${problemA.id}/validation-config`,
      headers: { Authorization: `Bearer ${tokenStudent}` },
      body: { validationEnabled: true, randomTestCount: 10 },
    });
    assert(studentPutRes.status === 403, 'Student is forbidden (403) from updating validation config');

    // Prof B attempt to update Prof A's problem (must be 403 Forbidden)
    const profBPutRes = await apiRequest({
      method: 'PUT',
      path: `/api/problems/${problemA.id}/validation-config`,
      headers: { Authorization: `Bearer ${tokenProfB}` },
      body: { validationEnabled: true, randomTestCount: 10 },
    });
    assert(profBPutRes.status === 403, 'Unrelated professor cannot modify another professor problem config');

    // Prof A (owner) successfully updates config via API
    const profAPutRes = await apiRequest({
      method: 'PUT',
      path: `/api/problems/${problemA.id}/validation-config`,
      headers: { Authorization: `Bearer ${tokenProfA}` },
      body: {
        validationEnabled: true,
        randomEnabled: true,
        randomTestCount: 20,
        edgeEnabled: true,
        boundaryEnabled: true,
        generatorType: 'range_generator',
        generatorConfig: { min: 1, max: 100 },
      },
    });
    assert(profAPutRes.status === 200, 'Owner Professor can successfully update validation config (200 OK)');
    assert(profAPutRes.data.config.validationEnabled === true, 'Updated validationEnabled reflected in API response');
    assert(profAPutRes.data.config.randomTestCount === 20, 'Updated randomTestCount reflected in API response');

    // ==========================================
    // 5. JUDGE WORKER & BACKWARD COMPATIBILITY
    // ==========================================
    console.log('\n--- 5. Judge Integration & Backward Compatibility ---');

    // Test A: Problem WITH validation enabled
    const validPythonCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n';
    const judgeResWithValidation = await JudgeService.evaluateSubmission({
      submissionId: 'test_val_enabled',
      language: 'python',
      codingMode: 'function',
      sourceCode: validPythonCode,
      problem: problemA,
      testCases: [testCase1, testCase2],
      problemPoints: 100,
    });

    assert(judgeResWithValidation.status === 'accepted', 'Correct code receives ACCEPTED with validation enabled');
    assert(judgeResWithValidation.score === 100, 'Score is 100 points');
    assert(judgeResWithValidation.validationSummary !== undefined, 'validationSummary is attached when validationEnabled is true');
    assert(judgeResWithValidation.validationSummary.stages.standard === 'passed', 'Standard stage passes');
    assert(judgeResWithValidation.validationSummary.stages.random === 'passed' || judgeResWithValidation.validationSummary.stages.random === 'pending_phase4b2', 'Random stage cleanly evaluated');

    // Test B: Backward Compatibility with Problem having NO validation config
    const problemNoConfig = await ProblemModel.createProblem({
      title: `Legacy Problem ${unique}`,
      description: 'Legacy problem from Phase 4A with no validation config.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: { python: validPythonCode },
      createdBy: profA.id,
    });
    const legacyTc1 = await TestCaseModel.createTestCase({
      problemId: problemNoConfig.id,
      inputData: '5 7\n',
      expectedOutput: '12',
      isHidden: false,
      testOrder: 1,
    });

    const legacyJudgeRes = await JudgeService.evaluateSubmission({
      submissionId: 'test_legacy',
      language: 'python',
      codingMode: 'function',
      sourceCode: validPythonCode,
      problem: problemNoConfig,
      testCases: [legacyTc1],
      problemPoints: 100,
    });

    assert(legacyJudgeRes.status === 'accepted', 'Legacy Phase 4A problem without validation config evaluates to ACCEPTED');
    assert(legacyJudgeRes.score === 100, 'Legacy problem scores 100');
    assert(legacyJudgeRes.validationSummary === undefined, 'validationSummary is undefined for legacy problems with disabled/missing validation');

    // Test C: Wrong code receives WRONG_ANSWER
    const wrongPythonCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a - b\n';
    const wrongJudgeRes = await JudgeService.evaluateSubmission({
      submissionId: 'test_wrong',
      language: 'python',
      codingMode: 'function',
      sourceCode: wrongPythonCode,
      problem: problemA,
      testCases: [testCase1, testCase2],
      problemPoints: 100,
    });
    assert(wrongJudgeRes.status === 'wrong_answer', 'Wrong code receives WRONG_ANSWER');
    assert(wrongJudgeRes.score === 0, 'Score is 0 for wrong answer');

    // Test D: Compilation/Syntax error handling
    const brokenPythonCode = 'class Solution def solve(:\n return invalid';
    const brokenJudgeRes = await JudgeService.evaluateSubmission({
      submissionId: 'test_broken',
      language: 'python',
      codingMode: 'function',
      sourceCode: brokenPythonCode,
      problem: problemA,
      testCases: [testCase1],
      problemPoints: 100,
    });
    assert(brokenJudgeRes.status === 'compilation_error' || brokenJudgeRes.status === 'runtime_error', 'Syntax error receives compilation/runtime error');

    // ==========================================
    // 6. CASCADE DELETION VERIFICATION
    // ==========================================
    console.log('\n--- 6. Cascade Deletion Integrity ---');
    await ProblemModel.deleteProblem(problemA.id);
    const orphanConfig = await ProblemValidationConfigModel.findByProblemId(problemA.id);
    assert(orphanConfig === null, 'Validation config is automatically deleted via CASCADE when Problem is deleted');

    // Summary
    console.log('\n=======================================================');
    console.log(` PHASE 4B.1 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    if (testServer) {
      testServer.close();
    }
    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.1 test runner:', err);
    if (testServer) {
      testServer.close();
    }
    await closePool();
    process.exit(1);
  }
}

runTests();