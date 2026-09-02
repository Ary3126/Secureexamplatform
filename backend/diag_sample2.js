const { app } = require('./src/server');
const http = require('http');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { generateToken, hashPassword } = require('./src/services/authService');
const { query } = require('./src/config/db');

async function test() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    try {
      const hash = await hashPassword('Password123!');
      await query("DELETE FROM users WHERE email = 'test_sample_student@test.com'");
      const student = await UserModel.createUser({
        username: 'student_sample',
        email: 'test_sample_student@test.com',
        passwordHash: hash,
        fullName: 'Sample Student',
        role: 'student'
      });
      const token = generateToken(student);

      const prof = (await query("SELECT id FROM users WHERE role = 'professor' LIMIT 1")).rows[0];

      const now = new Date();
      const contest = await ContestModel.createContest({
        title: 'Sample Test Contest ' + Date.now(),
        startTime: new Date(now.getTime() - 100000).toISOString(),
        endTime: new Date(now.getTime() + 1000000).toISOString(),
        createdBy: prof.id
      });

      const problem = await ProblemModel.createProblem({
        title: 'Sample Prob ' + Date.now(),
        description: 'Sample description test',
        difficulty: 'easy',
        createdBy: prof.id
      });

      await ContestModel.addProblemToContest({ contestId: contest.id, problemId: problem.id, points: 100 });
      await ContestModel.updateContestStatus(contest.id, 'published');
      await ContestModel.addParticipant(contest.id, student.id);

      await TestCaseModel.createTestCase({
        problemId: problem.id,
        inputData: '2 3\n',
        expectedOutput: '5',
        isHidden: false
      });

      const postData = JSON.stringify({
        contestId: contest.id,
        problemId: problem.id,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\na, b = int(lines[0]), int(lines[1])\nprint(a + b)'
      });

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/submissions/run',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('Sample Run Response:', data);
          server.close();
          process.exit(0);
        });
      });

      req.on('error', (e) => {
        console.error('Req error:', e);
        server.close();
        process.exit(1);
      });

      req.write(postData);
      req.end();
    } catch (e) {
      console.error('Diag sample error:', e);
      server.close();
      process.exit(1);
    }
  });
}
test();