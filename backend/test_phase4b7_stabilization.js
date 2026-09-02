const fs = require('fs');
const path = require('path');
const os = require('os');
const { closePool, query } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ContestModel = require('./src/models/contestModel');
const SubmissionModel = require('./src/models/submissionModel');
const ProblemValidationConfigModel = require('./src/models/problemValidationConfigModel');
const SubmissionValidationRunModel = require('./src/models/submissionValidationRunModel');
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
  console.log(' STARTING PHASE 4B.7 STABILIZATION & STRESS TEST SUITE');
  console.log(' (Multi-Language Parity, Concurrency, Recovery & Load)');
  console.log('=======================================================\n');

  try {
    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    // 1. Setup Professor and Contest
    const prof = await UserModel.createUser({
      username: `prof_stab_${unique}`,
      email: `profstab_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Stabilization',
      role: 'professor',
    });

    const contest = await ContestModel.createContest({
      title: `Stabilization Contest ${unique}`,
      description: 'Phase 4B.7 End-to-End Stabilization',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      createdBy: prof.id,
    });
    await ContestModel.updateContestStatus(contest.id, 'published');

    // 2. Setup Multi-Language Problem
    const problem = await ProblemModel.createProblem({
      title: `Multi-Language Sum Problem ${unique}`,
      description: 'Calculate sum of two integers across C++, Python, and Java.',
      difficulty: 'easy',
      codingMode: 'function',
      timeLimit: 3000,
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
        cpp: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a + b;\n    }\n};',
        java: 'class Solution {\n    public int solve(int a, int b) {\n        return a + b;\n    }\n}',
      },
      createdBy: prof.id,
    });

    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: problem.id, points: 100 });

    const tc1 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '15 25\n',
      expectedOutput: '40',
      isHidden: false,
      testOrder: 1,
    });

    const tc2 = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '100 200\n',
      expectedOutput: '300',
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

    // ==========================================
    // 1. MULTI-LANGUAGE PARITY TESTS
    // ==========================================
    console.log('--- 1. Multi-Language Parity (C++, Python, Java) ---');

    // Python Accepted
    const pyRes = await JudgeService.evaluateSubmission({
      submissionId: 2001,
      language: 'python',
      codingMode: 'function',
      sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });
    assert(pyRes.status === 'accepted', 'Python solution evaluates to ACCEPTED');
    assert(pyRes.score === 100, 'Python solution awarded 100 points');

    // C++ Accepted
    const cppRes = await JudgeService.evaluateSubmission({
      submissionId: 2002,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a + b;\n    }\n};',
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });
    assert(cppRes.status === 'accepted', 'C++ solution evaluates to ACCEPTED');
    assert(cppRes.score === 100, 'C++ solution awarded 100 points');

    // Java Accepted
    const javaRes = await JudgeService.evaluateSubmission({
      submissionId: 2003,
      language: 'java',
      codingMode: 'function',
      sourceCode: 'class Solution {\n    public int solve(int a, int b) {\n        return a + b;\n    }\n}',
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });
    assert(javaRes.status === 'accepted', 'Java solution evaluates to ACCEPTED');
    assert(javaRes.score === 100, 'Java solution awarded 100 points');

    // C++ Wrong Answer
    const cppWrongRes = await JudgeService.evaluateSubmission({
      submissionId: 2004,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a - b;\n    }\n};',
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });
    assert(cppWrongRes.status === 'wrong_answer', 'C++ wrong logic receives WRONG_ANSWER');

    // Java Compilation Error
    const javaSyntaxRes = await JudgeService.evaluateSubmission({
      submissionId: 2005,
      language: 'java',
      codingMode: 'function',
      sourceCode: 'class Solution { public int solve(int a, int b) { return a + ; } }',
      problem,
      validationConfig: valConfig,
      testCases: [tc1, tc2],
    });
    assert(javaSyntaxRes.status === 'compilation_error', 'Java syntax error receives COMPILATION_ERROR');

    // ==========================================
    // 2. CONCURRENT MULTI-USER ISOLATION STRESS
    // ==========================================
    console.log('\n--- 2. Multi-User Concurrency & Isolation Stress ---');

    const student1 = await UserModel.createUser({
      username: `student1_${unique}`,
      email: `student1_${unique}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student One',
      role: 'student',
    });
    const student2 = await UserModel.createUser({
      username: `student2_${unique}`,
      email: `student2_${unique}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student Two',
      role: 'student',
    });
    const student3 = await UserModel.createUser({
      username: `student3_${unique}`,
      email: `student3_${unique}@test.com`,
      passwordHash: pwHash,
      fullName: 'Student Three',
      role: 'student',
    });

    await ContestModel.addParticipant(contest.id, student1.id);
    await ContestModel.addParticipant(contest.id, student2.id);
    await ContestModel.addParticipant(contest.id, student3.id);

    // Create 3 submissions simultaneously
    const sub1 = await SubmissionModel.createSubmission({
      userId: student1.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        while True: pass\n',
    });

    const sub2 = await SubmissionModel.createSubmission({
      userId: student2.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'python',
      codingMode: 'function',
      sourceCode: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        return a + b\n',
    });

    const sub3 = await SubmissionModel.createSubmission({
      userId: student3.id,
      contestId: contest.id,
      problemId: problem.id,
      language: 'cpp',
      codingMode: 'function',
      sourceCode: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a + b;\n    }\n};',
    });

    // Execute concurrently via Promise.all
    const [eval1, eval2, eval3] = await Promise.all([
      JudgeService.evaluateSubmission({
        submissionId: sub1.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: sub1.sourceCode,
        problem,
        validationConfig: valConfig,
        testCases: [tc1, tc2],
      }),
      JudgeService.evaluateSubmission({
        submissionId: sub2.id,
        language: 'python',
        codingMode: 'function',
        sourceCode: sub2.sourceCode,
        problem,
        validationConfig: valConfig,
        testCases: [tc1, tc2],
      }),
      JudgeService.evaluateSubmission({
        submissionId: sub3.id,
        language: 'cpp',
        codingMode: 'function',
        sourceCode: sub3.sourceCode,
        problem,
        validationConfig: valConfig,
        testCases: [tc1, tc2],
      }),
    ]);

    assert(eval1.status === 'time_limit_exceeded', 'Student 1 infinite loop killed with TIME_LIMIT_EXCEEDED');
    assert(eval2.status === 'accepted', 'Student 2 concurrent submission evaluates to ACCEPTED');
    assert(eval2.score === 100, 'Student 2 awarded 100 points independently');
    assert(eval3.status === 'accepted', 'Student 3 concurrent C++ evaluates to ACCEPTED');
    assert(eval3.score === 100, 'Student 3 awarded 100 points independently');

    // ==========================================
    // 3. FAILURE RECOVERY & RESILIENCY
    // ==========================================
    console.log('\n--- 3. Failure Recovery & Error Isolation ---');

    // Test evaluation with empty test cases yields clean system_error (not unhandled crash)
    const errRes = await JudgeService.evaluateSubmission({
      submissionId: 2006,
      language: 'python',
      codingMode: 'function',
      sourceCode: 'print(1)',
      problem,
      testCases: [],
    });
    assert(errRes.status === 'system_error', 'Missing test cases returns clean system_error');

    // Test active submissions queue cleanup
    assert(judgeQueue.activeSubmissions.size === 0, 'Active submissions set is empty after execution');

    // ==========================================
    // 4. DATABASE INTEGRITY & METRIC RECORDING
    // ==========================================
    console.log('\n--- 4. Database Schema & Audit Consistency ---');

    const valRun2 = await SubmissionValidationRunModel.findBySubmissionId(sub2.id);
    assert(valRun2 !== null, 'Validation run record retrieved from database');
    assert(valRun2.final_status === 'accepted', 'Database records final_status: accepted');
    assert(valRun2.standard_passed === 2, 'Database records standard_passed: 2');

    // ==========================================
    // 5. PERFORMANCE BENCHMARKING
    // ==========================================
    console.log('\n--- 5. Performance Benchmarks ---');
    console.log(`[PERF] Python Eval Time: ${pyRes.executionTime} ms | Memory: ${pyRes.memoryUsed} KB`);
    console.log(`[PERF] C++ Eval Time: ${cppRes.executionTime} ms | Memory: ${cppRes.memoryUsed} KB`);
    console.log(`[PERF] Java Eval Time: ${javaRes.executionTime} ms | Memory: ${javaRes.memoryUsed} KB`);

    assert(pyRes.executionTime >= 0 && pyRes.executionTime < 12000, 'Python evaluation finishes within acceptable threshold');
    assert(cppRes.executionTime >= 0 && cppRes.executionTime < 12000, 'C++ evaluation finishes within acceptable threshold');
    assert(javaRes.executionTime >= 0 && javaRes.executionTime < 12000, 'Java evaluation finishes within acceptable threshold');

    // Clean up test data
    await ProblemModel.deleteProblem(problem.id);
    await ContestModel.deleteContest(contest.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.7 STABILIZATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.7 test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();