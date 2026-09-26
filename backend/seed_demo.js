const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { hashPassword } = require('./src/services/authService');

async function seed() {
  console.log('Seeding demo data with long-running active contest...');
  try {
    const pwHash = await hashPassword('Password123!');

    // 1. Create / ensure Professor
    let prof = await UserModel.findUserByEmail('prof@university.edu');
    if (!prof) {
      prof = await UserModel.createUser({
        username: 'prof_alan',
        email: 'prof@university.edu',
        passwordHash: pwHash,
        fullName: 'Prof. Alan Turing',
        role: 'professor',
        bio: 'Computer Science Professor & Judge Administrator',
      });
    }

    // 2. Create / ensure Student
    let student = await UserModel.findUserByEmail('student@university.edu');
    if (!student) {
      student = await UserModel.createUser({
        username: 'student_ary',
        email: 'student@university.edu',
        passwordHash: pwHash,
        fullName: 'Ary Student',
        role: 'student',
        bio: 'Competitive Programmer & Algorithmic Thinker',
      });
    }

    // 2b. Create / ensure Super Admin
    let admin = await UserModel.findUserByEmail('admin@securejudge.io');
    const adminPwHash = await hashPassword('Admin@1234');
    if (!admin) {
      await UserModel.createUser({
        username: 'platform_admin',
        email: 'admin@securejudge.io',
        passwordHash: adminPwHash,
        fullName: 'Platform Administrator',
        role: 'super_admin',
        bio: 'ExamForge Super Administrator',
      });
    } else {
      await query(
        `UPDATE users SET password_hash = $1, role = 'super_admin', is_active = true WHERE email = $2`,
        [adminPwHash, 'admin@securejudge.io']
      );
    }

    // 3. Create long-running active contest (running until 2030)
    const now = new Date();
    const startTime = new Date(now.getTime() - 24 * 3600 * 1000).toISOString(); // Started 1 day ago
    const endTime = new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(); // Ends in 1 year

    const contest = await ContestModel.createContest({
      title: 'Active Coding Contest & Examination 2026',
      description: 'Standard Online Judge live contest environment with full program & function mode challenges.',
      startTime,
      endTime,
      createdBy: prof.id,
    });
    await ContestModel.updateContestStatus(contest.id, 'published');
    console.log(`Created active contest: ID ${contest.id} ("${contest.title}")`);

    // 4. Enroll student into contest
    await ContestModel.addParticipant(contest.id, student.id);

    // 5. Create Problem 1: Add Two Numbers (Function Mode)
    const prob1 = await ProblemModel.createProblem({
      title: 'Add Two Numbers (Function Mode)',
      description: 'Implement the function solve(a, b) that returns the sum of two integers a and b.',
      difficulty: 'easy',
      codingMode: 'function',
      starterTemplates: {
        cpp: 'class Solution {\npublic:\n    int solve(int a, int b) {\n        // Return the sum of a and b\n        return a + b;\n    }\n};',
        python: 'class Solution:\n    def solve(self, a: int, b: int) -> int:\n        # Return the sum of a and b\n        return a + b\n',
        java: 'class Solution {\n    public int solve(int a, int b) {\n        // Return the sum of a and b\n        return a + b;\n    }\n}',
      },
      createdBy: prof.id,
    });

    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: prob1.id, points: 100, problemOrder: 1 });

    // Test cases for prob 1
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '2 3\n',
      expectedOutput: '5',
      isHidden: false,
      testOrder: 1,
    });
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '100 250\n',
      expectedOutput: '350',
      isHidden: true,
      testOrder: 2,
    });
    await TestCaseModel.createTestCase({
      problemId: prob1.id,
      inputData: '-15 20\n',
      expectedOutput: '5',
      isHidden: true,
      testOrder: 3,
    });

    // 6. Create Problem 2: Multiply Two Integers (Full Program Mode)
    const prob2 = await ProblemModel.createProblem({
      title: 'Multiply Two Integers (Full Program)',
      description: 'Read two integers a and b from standard input (stdin) and print their product to standard output (stdout).',
      difficulty: 'easy',
      codingMode: 'full_program',
      starterTemplates: {
        cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int a, b;\n    if (cin >> a >> b) {\n        cout << (a * b) << "\\n";\n    }\n    return 0;\n}',
        python: 'import sys\n\ndef main():\n    lines = sys.stdin.read().split()\n    if lines:\n        a, b = int(lines[0]), int(lines[1])\n        print(a * b)\n\nif __name__ == "__main__":\n    main()\n',
        java: 'import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextInt()) {\n            int a = sc.nextInt();\n            int b = sc.nextInt();\n            System.out.println(a * b);\n        }\n    }\n}',
      },
      createdBy: prof.id,
    });

    await ContestModel.addProblemToContest({ contestId: contest.id, problemId: prob2.id, points: 100, problemOrder: 2 });

    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '4 5\n',
      expectedOutput: '20',
      isHidden: false,
      testOrder: 1,
    });
    await TestCaseModel.createTestCase({
      problemId: prob2.id,
      inputData: '12 12\n',
      expectedOutput: '144',
      isHidden: true,
      testOrder: 2,
    });

    console.log('Seeding completed successfully!');
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    await closePool();
    process.exit(1);
  }
}

seed();