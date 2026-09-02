const JudgeService = require('./src/judge/judgeService');

async function testSample() {
  const code = 'import sys\nlines = sys.stdin.read().split()\na, b = int(lines[0]), int(lines[1])\nprint(a + b)';
  const testCases = [{ id: 1, inputData: '2 3\n', expectedOutput: '5', isHidden: false }];
  const res = await JudgeService.evaluateSubmission({
    submissionId: 'sample_diag',
    language: 'python',
    codingMode: 'full_program',
    sourceCode: code,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('Sample evaluate result:', JSON.stringify(res, null, 2));
  process.exit(0);
}
testSample();