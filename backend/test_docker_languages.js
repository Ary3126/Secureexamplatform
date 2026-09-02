const languageRegistry = require('./src/judge/runners');
const JudgeService = require('./src/judge/judgeService');

async function testAllLanguages() {
  console.log('--- TESTING C++, PYTHON, AND JAVA IN DOCKER JUDGE ---');
  process.env.USE_DOCKER = 'true';

  const testCases = [
    { id: 1, inputData: '5 7\n', expectedOutput: '12', isHidden: false, timeLimitMs: 4000, memoryLimitMb: 256 },
    { id: 2, inputData: '100 250\n', expectedOutput: '350', isHidden: true, timeLimitMs: 4000, memoryLimitMb: 256 }
  ];

  // 1. Test C++
  console.log('\n[1] Testing C++ execution in Docker...');
  const cppCode = `
#include <iostream>
using namespace std;
int main() {
    int a, b;
    if (cin >> a >> b) {
        cout << a + b << endl;
    }
    return 0;
}
`;
  const cppResult = await JudgeService.evaluateSubmission({
    submissionId: 'test_cpp',
    language: 'cpp',
    sourceCode: cppCode,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('C++ Verdict:', cppResult.status, '| Score:', cppResult.score, '| Time:', cppResult.executionTime, 'ms');
  if (cppResult.errorMessage) console.log('C++ Error:', cppResult.errorMessage);

  // 2. Test Java
  console.log('\n[2] Testing Java execution in Docker...');
  const javaCode = `
import java.util.Scanner;
public class Solution {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        if (sc.hasNextInt()) {
            int a = sc.nextInt();
            int b = sc.nextInt();
            System.out.println(a + b);
        }
        sc.close();
    }
}
`;
  const javaResult = await JudgeService.evaluateSubmission({
    submissionId: 'test_java',
    language: 'java',
    sourceCode: javaCode,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('Java Verdict:', javaResult.status, '| Score:', javaResult.score, '| Time:', javaResult.executionTime, 'ms');
  if (javaResult.errorMessage) console.log('Java Error:', javaResult.errorMessage);

  // 3. Test Python
  console.log('\n[3] Testing Python execution in Docker...');
  const pyCode = `
import sys
tokens = sys.stdin.read().split()
if len(tokens) >= 2:
    print(int(tokens[0]) + int(tokens[1]))
`;
  const pyResult = await JudgeService.evaluateSubmission({
    submissionId: 'test_py',
    language: 'python',
    sourceCode: pyCode,
    testCases,
    problemPoints: 100,
    isSampleRun: true
  });
  console.log('Python Verdict:', pyResult.status, '| Score:', pyResult.score, '| Time:', pyResult.executionTime, 'ms');
  if (pyResult.errorMessage) console.log('Python Error:', pyResult.errorMessage);

  process.exit(0);
}

testAllLanguages().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});