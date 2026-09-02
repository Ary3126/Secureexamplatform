const { closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const IntegerGenerator = require('./src/judge/validation/generators/integerGenerator');
const IntegerArrayGenerator = require('./src/judge/validation/generators/integerArrayGenerator');
const BaseGenerator = require('./src/judge/validation/generators/baseGenerator');
const JudgeService = require('./src/judge/judgeService');
const { hashPassword } = require('./src/services/authService');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

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

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 4B.3 TEST SUITE');
  console.log(' (Edge-Case, Boundary-Case Validation & Deduplication)');
  console.log('=======================================================\n');

  try {
    const intGen = new IntegerGenerator();
    const arrGen = new IntegerArrayGenerator();

    // ==========================================
    // 1. INTEGER EDGE & BOUNDARY CASES
    // ==========================================
    console.log('--- 1. Integer Edge & Boundary Generator ---');
    const intEdges = intGen.generateEdgeCases({
      config: { minValue: -100, maxValue: 100, count: 2 },
      maxCases: 20,
    });
    assert(Array.isArray(intEdges) && intEdges.length > 0, 'Integer edge generator outputs array of cases');
    const edgeJoined = intEdges.join(' ');
    assert(edgeJoined.includes('-100'), 'Edge cases include minimum value (-100)');
    assert(edgeJoined.includes('100'), 'Edge cases include maximum value (100)');
    assert(edgeJoined.includes('0'), 'Edge cases include zero (0)');
    assert(edgeJoined.includes('-1'), 'Edge cases include -1');
    assert(edgeJoined.includes('1'), 'Edge cases include 1');

    // Constraint enforcement: positive only (0 to 50) must NOT contain negative numbers
    const posEdges = intGen.generateEdgeCases({
      config: { minValue: 0, maxValue: 50, count: 1 },
      maxCases: 10,
    });
    const hasNegative = posEdges.some((c) => Number(c.trim()) < 0);
    assert(!hasNegative, 'Edge generator respects positive constraint (no negative numbers generated for min=0)');

    // Integer Boundaries
    const intBounds = intGen.generateBoundaryCases({
      config: { minValue: -500, maxValue: 500, count: 2 },
      maxCases: 10,
    });
    assert(intBounds.some((b) => b.includes('-500 -500')), 'Boundary cases include min-min pair');
    assert(intBounds.some((b) => b.includes('500 500')), 'Boundary cases include max-max pair');
    assert(intBounds.some((b) => b.includes('-500 500')), 'Boundary cases include min-max pair');

    // ==========================================
    // 2. INTEGER ARRAY EDGE & BOUNDARY CASES
    // ==========================================
    console.log('\n--- 2. Integer Array Edge & Boundary Generator ---');
    const arrEdges = arrGen.generateEdgeCases({
      config: { minSize: 1, maxSize: 50, minValue: -1000, maxValue: 1000, includeLengthHeader: true },
      maxCases: 20,
    });
    assert(arrEdges.length >= 5, 'Generates comprehensive suite of array edge cases');
    // Check single-element array presence
    assert(arrEdges.some((c) => c.startsWith('1\n')), 'Edge cases include single-element array (size 1)');

    // Array Boundaries
    const arrBounds = arrGen.generateBoundaryCases({
      config: { minSize: 2, maxSize: 100, minValue: -999, maxValue: 999, includeLengthHeader: false },
      maxCases: 10,
    });
    assert(arrBounds.length > 0, 'Generates boundary cases for arrays');
    assert(arrBounds.some((b) => b.includes('-999 -999')), 'Boundary cases include array of all minimum values');
    assert(arrBounds.some((b) => b.includes('999 999')), 'Boundary cases include array of all maximum values');

    // ==========================================
    // 3. FINGERPRINT & DEDUPLICATION LOGIC
    // ==========================================
    console.log('\n--- 3. Test Deduplication & Fingerprinting ---');
    const fp1 = BaseGenerator.computeFingerprint('10 20\n');
    const fp2 = BaseGenerator.computeFingerprint('10   20\r\n');
    const fp3 = BaseGenerator.computeFingerprint('20 10\n');
    assert(fp1 === fp2, 'Whitespace & CRLF normalized inputs produce identical SHA-256 fingerprint');
    assert(fp1 !== fp3, 'Different test inputs produce distinct fingerprints');

    // ==========================================
    // 4. END-TO-END JUDGE INTEGRATION TESTS
    // ==========================================
    console.log('\n--- 4. Judge Integration: Random + Edge + Boundary Suite ---');

    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    const prof = await UserModel.createUser({
      username: `prof_edge_${unique}`,
      email: `profedge_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Edge',
      role: 'professor',
    });

    const problem = await ProblemModel.createProblem({
      title: `Edge & Boundary Validation Problem ${unique}`,
      description: 'Sum two integers with complete validation (Random, Edge, Boundary).',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
      createdBy: prof.id,
    });

    const sampleTestCase = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '10 20\n',
      expectedOutput: '30',
      isHidden: false,
      testOrder: 1,
    });

    // Full Validation Config: Random + Edge + Boundary all enabled
    const fullValConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problem.id,
      validationEnabled: true,
      randomEnabled: true,
      randomTestCount: 5,
      edgeEnabled: true,
      boundaryEnabled: true,
      generatorType: 'integer',
      generatorConfig: { minValue: -1000, maxValue: 1000, count: 2, operation: 'sum' },
    });

    // Test A: 100% Genuine Solution (Passes Standard, Random, Edge, and Boundary -> ACCEPTED)
    const genuineCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n';
    const genuineResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_gen_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
      problem,
      validationConfig: fullValConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(genuineResult.status === 'accepted', 'Genuine solution passes all tiers (Standard + Random + Edge + Boundary) -> ACCEPTED');
    assert(genuineResult.score === 100, 'Score is 100');
    assert(genuineResult.validationSummary.stages.standard === 'passed', 'Standard stage: passed');
    assert(genuineResult.validationSummary.stages.random === 'passed', 'Random stage: passed');
    assert(genuineResult.validationSummary.stages.edge === 'passed', 'Edge stage: passed');
    assert(genuineResult.validationSummary.stages.boundary === 'passed', 'Boundary stage: passed');
    assert(genuineResult.validationSummary.edgeValidation.passed > 0, 'Edge validation executed and passed cases');
    assert(genuineResult.validationSummary.boundaryValidation.passed > 0, 'Boundary validation executed and passed cases');

    // Test B: Solution flawed strictly on Negative numbers (Passes standard & positive, but FAILS on edge cases)
    const failOnNegativeCode = `class Solution:
    def solve(self, a: int, b: int) -> int:
        if a < 0 or b < 0:
            return 999999
        return a + b
`;
    const edgeFailResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_edgefail_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: failOnNegativeCode,
      problem,
      validationConfig: fullValConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(edgeFailResult.status === 'wrong_answer', 'Solution failing negative edge cases receives WRONG_ANSWER');
    assert(edgeFailResult.validationSummary.stages.edge === 'failed' || edgeFailResult.validationSummary.stages.random === 'failed', 'Validation failure recorded in stage breakdown');
    assert(edgeFailResult.errorMessage.includes('Wrong Answer on'), 'Generic non-leaking error message returned');

    // Test C: Solution flawed strictly on Boundary limit (-1000 or 1000)
    const failOnBoundaryCode = `class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 1000 and b == 1000:
            return 0
        return a + b
`;
    const boundFailResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_boundfail_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: failOnBoundaryCode,
      problem,
      validationConfig: fullValConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(boundFailResult.status === 'wrong_answer', 'Solution failing extreme boundary values receives WRONG_ANSWER');

    // Clean up
    await ProblemModel.deleteProblem(problem.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.3 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.3 test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();