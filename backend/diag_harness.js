const JudgeService = require('./src/judge/judgeService');

async function testHarness() {
  const cppCode = 'class Solution {\npublic:\n    int solve(int a, int b) {\n        return a + b;\n    }\n};';
  const testCases = [{ id: 1, inputData: '2 3\n', expectedOutput: '5', isHidden: false }];
  const res = await JudgeService.evaluateSubmission({
    submissionId: 'cpp_test',
    language: 'cpp',
    codingMode: 'function',
    sourceCode: cppCode,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('C++ evaluate result:', JSON.stringify(res, null, 2));

  const javaCode = 'class Solution {\n    public int solve(int a, int b) {\n        return a + b;\n    }\n}';
  const javaRes = await JudgeService.evaluateSubmission({
    submissionId: 'java_test',
    language: 'java',
    codingMode: 'function',
    sourceCode: javaCode,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('Java evaluate result:', JSON.stringify(javaRes, null, 2));
  process.exit(0);
}
testHarness();