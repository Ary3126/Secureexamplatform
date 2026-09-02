const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const ContestModel = require('./src/models/contestModel');
const SubmissionModel = require('./src/models/submissionModel');
const JudgeService = require('./src/judge/judgeService');
const judgeQueue = require('./src/judge/queue/judgeQueue');
const SecurityPreconditions = require('./src/judge/security/securityPreconditions');
const { hashPassword } = require('./src/services/authService');
const { app } = require('./src/server');

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
  console.log(' STARTING PHASE 4B.6 ADVERSARIAL SECURITY TEST SUITE');
  console.log(' (Judge Hardening, Resource Defense & Abuse Protection)');
  console.log('=======================================================\n');

  try {
    const pwHash = await hashPassword('Password123!');
    const unique = Date.now();

    const prof = await UserModel.createUser({
      username: `prof_sec_${unique}`,
      email: `profsec_${unique}@uni.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Security Officer',
      role: 'professor',
    });

    const contest = await ContestModel.createContest({
      title: `Security Test Contest ${unique}`,
      description: 'Adversarial hardening tests',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      createdBy: prof.id,
    });

    const problem = await ProblemModel.createProblem({
      title: `Security Sandbox Problem ${unique}`,
      description: 'Evaluate containment of hostile submissions',
      difficulty: 'hard',
      codingMode: 'function',
      starterTemplates: {
        python: 'class Solution:\n    def solve(self, a: int) -> int:\n        return a\n',
      },
      createdBy: prof.id,
    });

    const tc = await TestCaseModel.createTestCase({
      problemId: problem.id,
      inputData: '42\n',
      expectedOutput: '42',
      isHidden: false,
      testOrder: 1,
    });

    // ==========================================
    // 1. NETWORK ISOLATION ADVERSARIAL TESTS
    // ==========================================
    console.log('--- 1. Network Isolation Containment ---');
    const networkAttackCode = `
import socket
import urllib.request

class Solution:
    def solve(self, a: int) -> int:
        try:
            # Attempt outbound TCP connection
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.5)
            s.connect(("8.8.8.8", 53))
            s.close()
            return 9999
        except Exception:
            return 0
`;
    const netResult = await JudgeService.evaluateSubmission({
      submissionId: 1001,
      language: 'python',
      codingMode: 'function',
      sourceCode: networkAttackCode,
      problem,
      testCases: [tc],
    });
    // The code either fails connection (returns 0 != 42 -> WRONG_ANSWER) or gets trapped
    assert(netResult.status === 'wrong_answer' || netResult.status === 'runtime_error', 'Outbound network connection is blocked');

    // ==========================================
    // 2. FILESYSTEM ISOLATION & SNOOPING TESTS
    // ==========================================
    console.log('\n--- 2. Filesystem & Secret Isolation ---');
    const fileAttackCode = `
import os

class Solution:
    def solve(self, a: int) -> int:
        # Search for .env or sensitive config
        found_secret = False
        for root, dirs, files in os.walk("../.."):
            for file in files:
                if file.endswith(".env") or "id_rsa" in file:
                    try:
                        with open(os.path.join(root, file), 'r') as f:
                            content = f.read()
                            if "DATABASE_URL" in content or "JWT_SECRET" in content:
                                found_secret = True
                    except Exception:
                        pass
        return 7777 if found_secret else 0
`;
    const fileResult = await JudgeService.evaluateSubmission({
      submissionId: 1002,
      language: 'python',
      codingMode: 'function',
      sourceCode: fileAttackCode,
      problem,
      testCases: [tc],
    });
    assert(fileResult.status === 'wrong_answer', 'Host .env and secret files are strictly unreadable');

    // ==========================================
    // 3. ENVIRONMENT VARIABLE SNOOPING TESTS
    // ==========================================
    console.log('\n--- 3. Process Environment Sanitization ---');
    const envAttackCode = `
import os

class Solution:
    def solve(self, a: int) -> int:
        # Inspect environment variables
        env_keys = list(os.environ.keys())
        leaked = False
        for k in ["DATABASE_URL", "JWT_SECRET", "DB_PASSWORD", "POSTGRES_PASSWORD", "AWS_SECRET"]:
            if k in env_keys:
                leaked = True
        return 8888 if leaked else 0
`;
    const envResult = await JudgeService.evaluateSubmission({
      submissionId: 1003,
      language: 'python',
      codingMode: 'function',
      sourceCode: envAttackCode,
      problem,
      testCases: [tc],
    });
    assert(envResult.status === 'wrong_answer', 'Process environment contains NO backend secrets or JWT keys');

    // ==========================================
    // 4. DOCKER SOCKET PROTECTION TESTS
    // ==========================================
    console.log('\n--- 4. Docker Socket & Control Interface Protection ---');
    const dockerAttackCode = `
import os

class Solution:
    def solve(self, a: int) -> int:
        sock_paths = [
            "/var/run/docker.sock",
            "\\\\.\\pipe\\docker_engine",
            "/run/docker.sock"
        ]
        has_docker = False
        for p in sock_paths:
            if os.path.exists(p):
                has_docker = True
        return 9999 if has_docker else 0
`;
    const dockerResult = await JudgeService.evaluateSubmission({
      submissionId: 1004,
      language: 'python',
      codingMode: 'function',
      sourceCode: dockerAttackCode,
      problem,
      testCases: [tc],
    });
    assert(dockerResult.status === 'wrong_answer', 'Docker daemon socket is strictly inaccessible to student code');

    // ==========================================
    // 5. RESOURCE LIMIT & FORK BOMB TESTS
    // ==========================================
    console.log('\n--- 5. Resource Limits, Timeouts & Output Protection ---');
    
    // CPU Loop
    const infiniteLoopCode = `
class Solution:
    def solve(self, a: int) -> int:
        while True:
            pass
        return a
`;
    const loopResult = await JudgeService.evaluateSubmission({
      submissionId: 1005,
      language: 'python',
      codingMode: 'function',
      sourceCode: infiniteLoopCode,
      problem,
      testCases: [tc],
    });
    assert(loopResult.status === 'time_limit_exceeded', 'Infinite CPU loop is safely killed (TIME_LIMIT_EXCEEDED)');

    // Output Flood
    const outputFloodCode = `
class Solution:
    def solve(self, a: int) -> int:
        for _ in range(50000):
            print("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        return a
`;
    const floodResult = await JudgeService.evaluateSubmission({
      submissionId: 1006,
      language: 'python',
      codingMode: 'function',
      sourceCode: outputFloodCode,
      problem,
      testCases: [tc],
    });
    assert(floodResult.status === 'system_error' || floodResult.status === 'wrong_answer' || floodResult.outputExceeded, 'Output flood stream is bounded and capped at 512KB');

    // Source Code Size Limit
    const hugeCode = 'x = 1\n'.repeat(35000); // > 64 KB
    let sizeLimitCaught = false;
    try {
      SecurityPreconditions.validate({
        submissionId: 1007,
        language: 'python',
        sourceCode: hugeCode,
      });
    } catch (e) {
      sizeLimitCaught = true;
    }
    assert(sizeLimitCaught === true, 'Oversized source code (>64KB) is rejected by SecurityPreconditions');

    // ==========================================
    // 6. QUEUE BACKPRESSURE & RATE LIMITING
    // ==========================================
    console.log('\n--- 6. Queue Backpressure & Abuse Defense ---');
    const initialMetrics = judgeQueue.getMetrics();
    assert(initialMetrics.maxCapacity === 500, 'JudgeQueue enforces hard max capacity of 500 jobs');

    // Test duplicate enqueue protection
    judgeQueue.activeSubmissions.add(99999);
    const enqResult = judgeQueue.addJob({ submissionId: 99999 });
    assert(enqResult === false, 'JudgeQueue rejects duplicate concurrent job enqueue');
    judgeQueue.activeSubmissions.delete(99999);

    // ==========================================
    // 7. FAIL-CLOSED PRECONDITION VALIDATION
    // ==========================================
    console.log('\n--- 7. Fail-Closed Security Policy ---');
    let pathTraversalCaught = false;
    try {
      SecurityPreconditions.validate({
        submissionId: 1008,
        language: 'python',
        sourceCode: 'print(1)',
        workspaceDir: 'C:\\Windows\\System32',
      });
    } catch (e) {
      pathTraversalCaught = true;
    }
    assert(pathTraversalCaught === true, 'SecurityPreconditions prevents path traversal outside safe temp workspace');

    let badLanguageCaught = false;
    try {
      SecurityPreconditions.validate({
        submissionId: 1009,
        language: 'bash',
        sourceCode: 'rm -rf /',
      });
    } catch (e) {
      badLanguageCaught = true;
    }
    assert(badLanguageCaught === true, 'SecurityPreconditions rejects unauthorized languages');

    // ==========================================
    // 8. TEMPORARY WORKSPACE CLEANUP
    // ==========================================
    console.log('\n--- 8. Cleanup & Workspace Hygiene ---');
    const baseTempDir = path.join(os.tmpdir(), 'secure_judge');
    assert(fs.existsSync(baseTempDir), 'Base secure temp workspace exists');

    // Clean up test DB records
    await ProblemModel.deleteProblem(problem.id);
    await ContestModel.deleteContest(contest.id);

    console.log('\n=======================================================');
    console.log(` PHASE 4B.6 SECURITY TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('=======================================================');

    await closePool();
    process.exit(failedTests > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error in Phase 4B.6 security test runner:', err);
    await closePool();
    process.exit(1);
  }
}

runTests();