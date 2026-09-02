const { closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ContestModel = require('./src/models/contestModel');
const SubmissionModel = require('./src/models/submissionModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const SubmissionValidationRunModel = require('./src/models/submissionValidationRunModel');
const { ValidationRun, VALIDATION_STAGES, VERDICT_PRIORITY } = require('./src/judge/validation/validationRun');
const JudgeService = require('./src/judge/judgeService');
const judgeQueue = require('./src/judge/queue/judgeQueue');
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
  console.log(' STARTING PHASE 4B.5 TEST SUITE');
  console.log(' (Enhanced Judge Orchestration & Verdict Integration)');
  console.log('=======================================================\n');

  try {
    // ==========================================
    // 1. STATE MACHINE & VERDICT PRIORITY
    // ==========================================
    console.log('--- 1. ValidationRun State Machine & Priority ---');
    const valRun = new ValidationRun({ submissionId: 1, problemId: 10 });
    assert(valRun.currentStage === VALIDATION_STAGES.INITIALIZING, 'Initial stage is INITIALIZING');
    assert(valRun.finalStatus === 'running', 'Initial status is running');

    valRun.startStage(VALIDATION_STAGES.COMPILATION);
    assert(valRun.currentStage === VALIDATION_STAGES.COMPILATION, 'Transitions to COMPILATION');
    valRun.endStage(VALIDATION_STAGES.COMPILATION);
    assert(typeof valRun.stageDurations[VALIDATION_STAGES.COMPILATION] === 'number', 'Records compilation stage duration');

    // Priority Check
    valRun.setVerdict('wrong_answer', 'Wrong output', 'STANDARD');
    assert(valRun.finalStatus === 'wrong_answer', 'Assigns wrong_answer');
    assert(valRun.shouldStopEarly() === true, 'shouldStopEarly is true on wrong_answer');

    // Higher priority overrides lower priority
    valRun.setVerdict('compilation_error', 'Syntax error', 'COMPILATION');
    assert(valRun.finalStatus === 'compilation_error', 'compilation_error overrides wrong_answer');

    // Lower priority CANNOT override higher priority
    valRun.setVerdict('accepted', null, 'FINALIZATION');
    assert(valRun.finalStatus === 'compilation_error', 'accepted CANNOT override compilation_error');

    // ==========================================
    // 2. END-TO-END EARLY STOPPING PIPELINE TESTS
    // ==========================================
    console.log('\n--- 2. End-to-End Pipeline & Early Stopping ---');

    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    const prof = await UserModel.createUser({
      username: `prof_orch_${unique}`,
      email: `proforch_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Orchestration',
      role: 'professor',
    });

    const contest = await ContestModel.createContest({
      title: `Orchestration Contest ${unique}`,
      description: 'Phase 4B.5 contest',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      createdBy: prof.id,
    });

    const problem = await ProblemModel.createProblem({
      title: `Orchestration Problem ${unique}`,
      description: 'Complete sum problem with all validation tiers.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
      createdBy: prof.id,
    });

    const tc1 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '10 20\n',
      expectedOutput: '30',
      isHidden: false,
      testOrder: 1,
    });

    const tc2 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '50 50\n',
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

    // Pipeline Test A: Syntax Error (Early stop at COMPILATION)
    const syntaxErrorCode = 'class Solution def solve(self, a, b): invalid syntax';
    const subSyntax = await SubmissionModel.createSubmission({
      userId: prof.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: syntaxErrorCode,
    });

    const syntaxResult = await JudgeService.evaluateSubmission({
      submissionId: subSyntax.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: syntaxErrorCode,
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });

    assert(syntaxResult.status === 'compilation_error', 'Pipeline stops early on compilation failure');
    assert(syntaxResult.testCasesPassed === 0, 'No standard test cases executed on compilation error');
    assert(syntaxResult.validationSummary.failureStage === 'COMPILATION', 'Failure stage recorded as COMPILATION');

    // Pipeline Test B: Standard Test Failure (Early stop at STANDARD)
    const wrongOnStandardCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return -1\n';
    const subStdFail = await SubmissionModel.createSubmission({
      userId: prof.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: wrongOnStandardCode,
    });

    const stdFailResult = await JudgeService.evaluateSubmission({
      submissionId: subStdFail.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: wrongOnStandardCode,
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });

    assert(stdFailResult.status === 'wrong_answer', 'Standard test failure returns wrong_answer');
    assert(stdFailResult.validationSummary.failureStage === 'STANDARD', 'Failure stage recorded as STANDARD');
    assert(stdFailResult.validationSummary.stages.random === 'pending', 'Random tests were NOT run (early stopped)');

    // Pipeline Test C: Passes Standard, Fails Random (Early stop at RANDOM)
    const hardcodedSampleCode = `class Solution:
    def solve(self, a: int, b: int) -> int:
        if a == 10 and b == 20:
            return 30
        if a == 50 and b == 50:
            return 100
        return -999999
`;
    const subRandFail = await SubmissionModel.createSubmission({
      userId: prof.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: hardcodedSampleCode,
    });

    const randFailResult = await JudgeService.evaluateSubmission({
      submissionId: subRandFail.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: hardcodedSampleCode,
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });

    assert(randFailResult.status === 'wrong_answer', 'Random test failure returns wrong_answer');
    assert(randFailResult.testCasesPassed === 2, 'Passed all standard test cases');
    assert(randFailResult.validationSummary.stages.standard === 'passed', 'Standard stage: passed');
    assert(randFailResult.validationSummary.stages.random === 'failed', 'Random stage: failed');
    assert(randFailResult.validationSummary.antiHardcoding.isFlagged === true, 'Anti-hardcoding system flags memorized solution');

    // Pipeline Test D: 100% Genuine Solution (Passes all stages -> ACCEPTED)
    const genuineCode = 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n';
    const subGen = await SubmissionModel.createSubmission({
      userId: prof.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
    });

    const genResult = await JudgeService.evaluateSubmission({
      submissionId: subGen.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });

    assert(genResult.status === 'accepted', 'Genuine solution passes all stages -> ACCEPTED');
    assert(genResult.score === 100, 'Awarded 100 points');
    assert(genResult.validationSummary.stages.standard === 'passed', 'Standard: passed');
    assert(genResult.validationSummary.stages.random === 'passed', 'Random: passed');
    assert(genResult.validationSummary.stages.edge === 'passed', 'Edge: passed');
    assert(genResult.validationSummary.stages.boundary === 'passed', 'Boundary: passed');
    assert(genResult.validationSummary.antiHardcoding.isFlagged === false, 'Anti-hardcoding: clean (not flagged)');

    // ==========================================
    // 3. DATABASE AUDIT & LOGGING PERSISTENCE
    // ==========================================
    console.log('\n--- 3. Database Audit & Run Persistence ---');
    const runRecord = await SubmissionValidationRunModel.findBySubmissionId(subGen.id);
    assert(runRecord !== null, 'Validation run record saved to PostgreSQL submission_validation_runs');
    assert(runRecord.final_status === 'accepted', 'Validation run recorded final_status: accepted');
    assert(runRecord.problem_id === problem.id, 'Validation run linked to correct problemId');
    assert(typeof runRecord.stage_durations === 'object', 'Validation run saved stage_durations');

    // ==========================================
    // 4. QUEUE IDEMPOTENCY GUARD
    // ==========================================
    console.log('\n--- 4. Queue Idempotency & Concurrency ---');
    const metricsBefore = judgeQueue.getMetrics();
    assert(typeof metricsBefore.concurrencyLimit === 'number', 'JudgeQueue exposes concurrency limits');

    // ==========================================
    // 5. BACKWARD COMPATIBILITY
    // ==========================================
    console.log('\n--- 5. Legacy Phase 4A Backward Compatibility ---');
    const legacyProblem = await ProblemModel.createProblem({
      title: `Legacy Problem ${unique}`,
      description: 'Problem without validation config',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      },
      createdBy: prof.id,
    });

    const legacyResult = await JudgeService.evaluateSubmission({
      submissionId: 999999,
      language: 'python',
      codingMode: 'function',
      sourceCode: genuineCode,
      problem: legacyProblem,
      validationConfig: null,
      testCases: [tc1],
    });

    assert(legacyResult.status === 'accepted', 'Legacy problem without validation config evaluates normally');
    assert(legacyResult.validationSummary === undefined || legacyResult.validationSummary.validationEnabled === false, 'Legacy problem validationSummary is undefined or disabled');

    // Clean up
    await ProblemModel.deleteProblem(problem.id);
    await ProblemModel.deleteProblem(legacyProblem.id);
    await ContestModel.deleteContest(contest.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.5 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.5 test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();