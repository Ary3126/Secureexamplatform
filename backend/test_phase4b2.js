const { closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const SeededPRNG = require('./src/judge/validation/prng');
const IntegerGenerator = require('./src/judge/validation/generators/integerGenerator');
const IntegerArrayGenerator = require('./src/judge/validation/generators/integerArrayGenerator');
const generatorRegistry = require('./src/judge/validation/generators/generatorRegistry');
const TrustedOracle = require('./src/judge/validation/oracle/trustedOracle');
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
  console.log(' STARTING PHASE 4B.2 TEST SUITE');
  console.log(' (Deterministic Randomized Test Generation & Oracle)');
  console.log('=======================================================\n');

  try {
    const intGen = new IntegerGenerator();
    const arrGen = new IntegerArrayGenerator();

    // ==========================================
    // 1. INTEGER GENERATOR UNIT TESTS
    // ==========================================
    console.log('--- 1. Integer Generator Verification ---');
    const prng1 = new SeededPRNG(42);
    const intRes1 = intGen.generate({
      prng: prng1,
      config: { minValue: -500, maxValue: 500, count: 2 },
      testIndex: 1,
    });
    assert(typeof intRes1 === 'string' && intRes1.trim().length > 0, 'Integer generator outputs non-empty string');
    const intTokens = intRes1.trim().split(/\s+/).map(Number);
    assert(intTokens.length === 2, 'Generates configured number of integer tokens (2)');
    assert(intTokens[0] >= -500 && intTokens[0] <= 500, 'First token respects [minValue, maxValue]');
    assert(intTokens[1] >= -500 && intTokens[1] <= 500, 'Second token respects [minValue, maxValue]');

    // Invalid config (min > max)
    let errCaught = false;
    try {
      intGen.generate({
        prng: new SeededPRNG(1),
        config: { minValue: 100, maxValue: 50 },
      });
    } catch (e) {
      errCaught = true;
      assert(e.message.includes('cannot exceed maxValue'), 'Rejects invalid range (min > max)');
    }
    assert(errCaught, 'Invalid integer range threw exception');

    // ==========================================
    // 2. INTEGER ARRAY GENERATOR UNIT TESTS
    // ==========================================
    console.log('\n--- 2. Integer Array Generator Verification ---');
    const prngArr = new SeededPRNG(100);
    const arrRes1 = arrGen.generate({
      prng: prngArr,
      config: { minSize: 5, maxSize: 15, minValue: -100, maxValue: 100, includeLengthHeader: true },
      testIndex: 3,
    });
    const arrLines = arrRes1.trim().split('\n');
    assert(arrLines.length === 2, 'includeLengthHeader generates 2 lines (size + elements)');
    const headerSize = Number(arrLines[0]);
    const elements = arrLines[1].trim().split(/\s+/).map(Number);
    assert(headerSize >= 5 && headerSize <= 15, 'Header size respects [minSize, maxSize]');
    assert(elements.length === headerSize, 'Number of elements matches header size');
    assert(elements.every((x) => x >= -100 && x <= 100), 'All elements respect [minValue, maxValue]');

    // ==========================================
    // 3. DETERMINISM & SEED REPRODUCIBILITY
    // ==========================================
    console.log('\n--- 3. Determinism & Seed Reproducibility ---');
    const seedA = SeededPRNG.deriveTestSeed({ problemId: 99, submissionId: 500, testIndex: 7 });
    const seedB = SeededPRNG.deriveTestSeed({ problemId: 99, submissionId: 500, testIndex: 7 });
    assert(seedA === seedB, 'deriveTestSeed generates identical seed for same problem/submission/index');

    const prngA = new SeededPRNG(seedA);
    const prngB = new SeededPRNG(seedB);
    const genOutA = intGen.generate({ prng: prngA, config: { minValue: -1000, maxValue: 1000, count: 2 }, testIndex: 7 });
    const genOutB = intGen.generate({ prng: prngB, config: { minValue: -1000, maxValue: 1000, count: 2 }, testIndex: 7 });
    assert(genOutA === genOutB, 'Identical seed and parameters produce 100% byte-for-byte identical test input');

    // Different test index produces diverse input
    const seedC = SeededPRNG.deriveTestSeed({ problemId: 99, submissionId: 500, testIndex: 8 });
    const prngC = new SeededPRNG(seedC);
    const genOutC = intGen.generate({ prng: prngC, config: { minValue: -1000, maxValue: 1000, count: 2 }, testIndex: 8 });
    assert(genOutA !== genOutC, 'Different test indices generate varied pseudo-random inputs');

    // ==========================================
    // 4. GENERATOR REGISTRY
    // ==========================================
    console.log('\n--- 4. Generator Registry Verification ---');
    assert(generatorRegistry.getGenerator('integer') instanceof IntegerGenerator, 'Registry resolves integer generator');
    assert(generatorRegistry.getGenerator('range_generator') instanceof IntegerGenerator, 'Registry resolves range_generator alias');
    assert(generatorRegistry.getGenerator('integer_array') instanceof IntegerArrayGenerator, 'Registry resolves integer_array generator');
    assert(generatorRegistry.getGenerator('array_generator') instanceof IntegerArrayGenerator, 'Registry resolves array_generator alias');

    // ==========================================
    // 5. TRUSTED ORACLE UNIT TESTS
    // ==========================================
    console.log('\n--- 5. Trusted Oracle Verification ---');
    const oracleBuiltin = new TrustedOracle({
      validationConfig: { generatorConfig: { operation: 'sum' } },
    });
    const expectedSum = await oracleBuiltin.getExpectedOutput('25 35\n');
    assert(expectedSum === '60', 'Built-in oracle computes correct expected sum (25 + 35 = 60)');

    const oracleMult = new TrustedOracle({
      validationConfig: { generatorConfig: { operation: 'product' } },
    });
    const expectedMult = await oracleMult.getExpectedOutput('12 12\n');
    assert(expectedMult === '144', 'Built-in oracle computes correct expected product (12 * 12 = 144)');

    // ==========================================
    // 6. END-TO-END JUDGE INTEGRATION TESTS
    // ==========================================
    console.log('\n--- 6. Judge Integration & Randomized Validation ---');

    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    const prof = await UserModel.createUser({
      username: `prof_rand_${unique}`,
      email: `profrand_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Random',
      role: 'professor',
    });

    // Create Problem with 1 visible sample test case
    const problem = await ProblemModel.createProblem({
      title: `Randomized Validation Sum Problem ${unique}`,
      description: 'Calculate sum of two integers with randomized fuzzing.',
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

    // Attach Validation Config (Random enabled, 10 random tests)
    const valConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problem.id,
      validationEnabled: true,
      randomEnabled: true,
      randomTestCount: 10,
      generatorType: 'integer',
      generatorConfig: { minValue: -1000, maxValue: 1000, count: 2, operation: 'sum' },
    });

    // Test Case A: Genuinely Correct Solution (Passes standard + 10 random tests -> ACCEPTED)
    const genuineCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n';
    const genuineResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_genuine_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
      problem,
      validationConfig: valConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(genuineResult.status === 'accepted', 'Genuine solution passes standard + randomized tests -> ACCEPTED');
    assert(genuineResult.score === 100, 'Full score (100) awarded');
    assert(genuineResult.validationSummary.randomValidation.totalGenerated === 10, 'Generated 10 random test cases');
    assert(genuineResult.validationSummary.randomValidation.passed === 10, 'Passed all 10 random test cases');
    assert(genuineResult.validationSummary.randomValidation.status === 'passed', 'Random validation status is passed');

    // Test Case B: Hardcoded Solution (Passes sample test case "10 20 -> 30", but FAILS randomized test -> WRONG_ANSWER)
    const hardcodedCode = `class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 10 and b == 20:
            return 30
        return -999999
`;
    const hardcodedResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_hardcoded_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: hardcodedCode,
      problem,
      validationConfig: valConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(hardcodedResult.status === 'wrong_answer', 'Hardcoded solution caught by randomized tests -> WRONG_ANSWER');
    assert(hardcodedResult.validationSummary.randomValidation.status === 'failed', 'Random validation status is failed');
    assert(hardcodedResult.errorMessage === 'Wrong Answer on randomized validation test', 'Generic failure message returned without leaking seed/data');

    // Test Case C: Random Testing Disabled -> Standard Phase 4A behavior
    const disabledValConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problem.id,
      validationEnabled: true,
      randomEnabled: false,
    });

    const disabledResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_disabled_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: hardcodedCode, // Hardcoded solution only tested against sample test
      problem,
      validationConfig: disabledValConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });

    assert(disabledResult.status === 'accepted', 'When random testing is disabled, only standard test cases determine verdict');
    assert(disabledResult.validationSummary.stages.random === 'disabled', 'Random stage is marked disabled');

    // Test Case D: Crashing solution during random test -> RUNTIME_ERROR
    const crashingOnRandomCode = `class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 10 and b == 20:
            return 30
        raise ValueError("Random input crash")
`;
    const crashResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_crash_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: crashingOnRandomCode,
      problem,
      validationConfig: valConfig,
      testCases: [sampleTestCase],
      problemPoints: 100,
    });
    assert(crashResult.status === 'runtime_error', 'Crashing on random test results in RUNTIME_ERROR verdict');

    // Clean up problem
    await ProblemModel.deleteProblem(problem.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.2 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.2 test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();