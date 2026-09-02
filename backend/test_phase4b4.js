const { closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const SourceNormalizer = require('./src/judge/validation/antiHardcoding/sourceNormalizer');
const StaticAnalyzer = require('./src/judge/validation/antiHardcoding/staticAnalyzer');
const BehavioralAnalyzer = require('./src/judge/validation/antiHardcoding/behavioralAnalyzer');
const SuspicionScorer = require('./src/judge/validation/antiHardcoding/suspicionScorer');
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
  console.log(' STARTING PHASE 4B.4 TEST SUITE');
  console.log(' (Anti-Hardcoding & Suspicious Solution Detection)');
  console.log('=======================================================\n');

  try {
    // ==========================================
    // 1. SOURCE NORMALIZATION UNIT TESTS
    // ==========================================
    console.log('--- 1. Source Normalization Verification ---');
    const pySourceWithComments = `
"""
Problem Solution Docstring
"""
# Helper comment
class Solution:
    def solve(self, a: int, b: int) -> int:
        # Calculate sum
        return a + b
`;
    const pyNormalized = SourceNormalizer.normalize(pySourceWithComments, 'python');
    assert(!pyNormalized.includes('Problem Solution Docstring'), 'Python docstrings safely stripped');
    assert(!pyNormalized.includes('# Helper comment'), 'Python single-line comments stripped');
    assert(pyNormalized.includes('return a + b'), 'Executable logic preserved');

    const cppSourceWithComments = `
/* Multi-line C++ comment */
#include <iostream>
// Single-line comment
class Solution {
public:
    int solve(int a, int b) {
        return a + b; // inline comment
    }
};
`;
    const cppNormalized = SourceNormalizer.normalize(cppSourceWithComments, 'cpp');
    assert(!cppNormalized.includes('Multi-line C++ comment'), 'C++ block comments safely stripped');
    assert(!cppNormalized.includes('Single-line comment'), 'C++ line comments safely stripped');
    assert(cppNormalized.includes('return a + b;'), 'C++ executable logic preserved');

    // ==========================================
    // 2. STATIC ANALYSIS & FALSE-POSITIVE PROTECTION
    // ==========================================
    console.log('\n--- 2. Static Analysis & False-Positive Protection ---');

    const standardTestCases = [
      { inputData: '10 20\n', expectedOutput: '30\n' },
      { inputData: '55 45\n', expectedOutput: '100\n' },
      { inputData: '99 1\n', expectedOutput: '100\n' },
      { inputData: '123 456\n', expectedOutput: '579\n' },
    ];

    // Case A: Legitimate solution using standard MOD constant (10^9 + 7) and base case
    const legitCode = `
class Solution:
    def solve(self, a: int, b: int) -> int:
        MOD = 1000000007
        if a == 0:
            return b % MOD
        return (a + b) % MOD
`;
    const legitStatic = StaticAnalyzer.analyze({
      sourceCode: legitCode,
      language: 'python',
      standardTestCases,
    });
    assert(legitStatic.staticScore === 0, 'Legitimate solution with MOD constant scores 0 static suspicion');
    assert(legitStatic.signals.length === 0, 'No suspicious signals raised for legitimate solution');

    // Case B: Obvious hardcoded solution with chained exact test-matching if/elif branches
    const hardcodedChainCode = `
class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 10 and b == 20:
            return 30
        elif a == 55 and b == 45:
            return 100
        elif a == 99 and b == 1:
            return 100
        elif a == 123 and b == 456:
            return 579
        return 0
`;
    const hardcodedStatic = StaticAnalyzer.analyze({
      sourceCode: hardcodedChainCode,
      language: 'python',
      standardTestCases,
    });
    assert(hardcodedStatic.staticScore >= 25, 'Hardcoded chained equality checks raise static suspicion');
    assert(hardcodedStatic.signals.some((s) => s.name === 'EXCESSIVE_EXACT_BRANCHING'), 'EXCESSIVE_EXACT_BRANCHING signal detected');

    // Case C: Hardcoded dictionary output mapping
    const hardcodedDictCode = `
class Solution:
    def solve(self, a: int, b: int) -> int:
        lookup = {
            (10, 20): 30,
            (55, 45): 100,
            (99, 1): 100,
            (123, 456): 579,
        }
        return lookup.get((a, b), 0)
`;
    const dictStatic = StaticAnalyzer.analyze({
      sourceCode: hardcodedDictCode,
      language: 'python',
      standardTestCases,
    });
    assert(dictStatic.staticScore >= 35, 'Hardcoded dictionary mapping raises static suspicion');
    assert(dictStatic.signals.some((s) => s.name === 'HARDCODED_OUTPUT_MAPPING'), 'HARDCODED_OUTPUT_MAPPING signal detected');

    // ==========================================
    // 3. BEHAVIORAL ANALYSIS & SUSPICION SCORING
    // ==========================================
    console.log('\n--- 3. Behavioral Analysis & Suspicion Scoring ---');

    // Behavioral Case: Passed all 4 standard tests, but failed validation test
    const behavResult = BehavioralAnalyzer.analyze({
      standardPassed: 4,
      totalStandard: 4,
      validationOutcome: { isEnabled: true, isSuccess: false, stage: 'random' },
    });
    assert(behavResult.behavioralScore === 40, 'Pass known tests + fail unknown tests raises 40 behavioral points');
    assert(behavResult.signals.some((s) => s.name === 'UNKNOWN_TEST_FAILURE_DISCREPANCY'), 'UNKNOWN_TEST_FAILURE_DISCREPANCY signal recorded');

    // Combined Suspicion Scorer
    const combinedScoreReport = SuspicionScorer.score({
      staticResult: hardcodedStatic,
      behavioralResult: behavResult,
    });
    assert(combinedScoreReport.suspicionScore >= 65, 'Combined static + behavioral evidence yields HIGH suspicion score');
    assert(combinedScoreReport.suspicionLevel === 'HIGH', 'Suspicion level classified as HIGH');
    assert(combinedScoreReport.isFlagged === true, 'Submission is internally flagged');

    // ==========================================
    // 4. END-TO-END JUDGE INTEGRATION TESTS
    // ==========================================
    console.log('\n--- 4. Judge Integration: Anti-Hardcoding Evaluation ---');

    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    const prof = await UserModel.createUser({
      username: `prof_ah_${unique}`,
      email: `profah_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof AntiHardcode',
      role: 'professor',
    });

    const problem = await ProblemModel.createProblem({
      title: `Anti-Hardcoding Problem ${unique}`,
      description: 'Sum two integers with anti-hardcoding security detection.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
      createdBy: prof.id,
    });

    const sampleTestCase1 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '10 20\n',
      expectedOutput: '30',
      isHidden: false,
      testOrder: 1,
    });

    const sampleTestCase2 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '55 45\n',
      expectedOutput: '100',
      isHidden: true,
      testOrder: 2,
    });

    const valConfig = await ProblemValidationConfigModel.upsertConfig({
      problemId: problem.id,
      validationEnabled: true,
      randomEnabled: true,
      randomTestCount: 5,
      edgeEnabled: true,
      boundaryEnabled: true,
      generatorType: 'integer',
      generatorConfig: { minValue: -1000, maxValue: 1000, count: 2, operation: 'sum' },
    });

    // Test A: Genuine Solution (ACCEPTED, suspicionLevel: LOW, isFlagged: false)
    const genuineCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n';
    const genuineResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_ah_gen_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
      problem,
      validationConfig: valConfig,
      testCases: [sampleTestCase1, sampleTestCase2],
      problemPoints: 100,
    });

    assert(genuineResult.status === 'accepted', 'Genuine solution evaluates to ACCEPTED');
    assert(genuineResult.score === 100, 'Score is 100');
    assert(genuineResult.validationSummary.antiHardcoding.suspicionLevel === 'LOW', 'Genuine solution receives LOW suspicion');
    assert(genuineResult.validationSummary.antiHardcoding.isFlagged === false, 'Genuine solution is NOT flagged');

    // Test B: Hardcoded Solution targeting sample test cases (WRONG_ANSWER, suspicionLevel: HIGH, isFlagged: true)
    const hardcodedSubmission = `
class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 10 and b == 20:
            return 30
        elif a == 55 and b == 45:
            return 100
        return -999999
`;
    const hardcodedResult = await JudgeService.evaluateSubmission({
      submissionId: `sub_ah_hard_${unique}`,
      language: 'python',
      codingMode: 'function',
      sourceCode: hardcodedSubmission,
      problem,
      validationConfig: valConfig,
      testCases: [sampleTestCase1, sampleTestCase2],
      problemPoints: 100,
    });

    assert(hardcodedResult.status === 'wrong_answer', 'Hardcoded solution evaluates to WRONG_ANSWER');
    assert(hardcodedResult.validationSummary.antiHardcoding.isFlagged === true, 'Hardcoded solution is internally flagged');
    assert(hardcodedResult.validationSummary.antiHardcoding.signals.length > 0, 'Suspicion signals attached in validation summary');

    // Clean up
    await ProblemModel.deleteProblem(problem.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.4 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.4 test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();