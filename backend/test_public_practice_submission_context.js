/**
 * Targeted Test Suite: Public Practice Submission Context & contest_id Nullability
 * Verifies:
 * 1. Public problem submission succeeds with contest_id = NULL
 * 2. Public problem submission is persisted successfully with contest_id = NULL
 * 3. Public submission can be retrieved from submission history (GET /api/submissions/my)
 * 4. Public submission detail works with NULL contest_id (GET /api/submissions/:id)
 * 5. Contest submission still succeeds with valid contest_id
 * 6. Contest submission rejects mismatched problem/contest
 * 7. Unauthorized/mismatched contest_id cannot be injected into a public submission
 * 8. Public submission does not affect contest leaderboard
 * 9. Public submission does not affect Elo/rating
 * 10. Public submission does not appear in contest standings
 * 11. Malformed contest_id is rejected safely
 * 12. Existing BOLA/IDOR protections remain intact
 */

const assert = require('assert');
const http = require('http');
const { app } = require('./src/server');
const { query, closePool } = require('./src/config/db');
const { initDb } = require('./src/config/initDb');
const StandingsService = require('./src/services/standingsService');

let server = null;
let baseUrl = '';
let studentToken, otherStudentToken, profToken, adminToken;
let studentUser, otherStudentUser, profUser, adminUser;
let publicProblemTwoSum, publicProblemSubSum, contestProblem, testContest;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'x-test-environment': 'true',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function setup() {
  await initDb();

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const timestamp = Date.now();
  const passwordHash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6'; // Password123!

  // Create actors
  const studentRes = await query(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, 'Student Context', 'student')
    RETURNING id, username, email, role;
  `, [`student_ctx_${timestamp}`, `student_ctx_${timestamp}@test.edu`, passwordHash]);
  studentUser = studentRes.rows[0];

  const otherStudentRes = await query(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, 'Other Student Context', 'student')
    RETURNING id, username, email, role;
  `, [`other_ctx_${timestamp}`, `other_ctx_${timestamp}@test.edu`, passwordHash]);
  otherStudentUser = otherStudentRes.rows[0];

  const profRes = await query(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, 'Prof Context', 'professor')
    RETURNING id, username, email, role;
  `, [`prof_ctx_${timestamp}`, `prof_ctx_${timestamp}@test.edu`, passwordHash]);
  profUser = profRes.rows[0];

  const adminRes = await query(`
    INSERT INTO users (username, email, password_hash, full_name, role)
    VALUES ($1, $2, $3, 'Admin Context', 'super_admin')
    RETURNING id, username, email, role;
  `, [`admin_ctx_${timestamp}`, `admin_ctx_${timestamp}@test.edu`, passwordHash]);
  adminUser = adminRes.rows[0];

  // Log in users via API
  const studentLogin = await makeRequest('POST', '/api/auth/login', { email: studentUser.email, password: 'Password123!' });
  studentToken = studentLogin.body.token;

  const otherStudentLogin = await makeRequest('POST', '/api/auth/login', { email: otherStudentUser.email, password: 'Password123!' });
  otherStudentToken = otherStudentLogin.body.token;

  const profLogin = await makeRequest('POST', '/api/auth/login', { email: profUser.email, password: 'Password123!' });
  profToken = profLogin.body.token;

  const adminLogin = await makeRequest('POST', '/api/auth/login', { email: adminUser.email, password: 'Password123!' });
  adminToken = adminLogin.body.token;

  // Fetch canonical public problems
  const twoSumRes = await query(`SELECT * FROM problems WHERE title = 'Two Sum' AND access_scope = 'public' LIMIT 1;`);
  publicProblemTwoSum = twoSumRes.rows[0];

  const subSumRes = await query(`SELECT * FROM problems WHERE title = 'Subarray Sum' AND access_scope = 'public' LIMIT 1;`);
  publicProblemSubSum = subSumRes.rows[0];

  // Create running contest with a private contest problem
  const contestRes = await query(`
    INSERT INTO contests (title, description, created_by, start_time, end_time, status)
    VALUES ('Live Midterm Contest', 'Contest Description', $1, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'published')
    RETURNING id, title, status;
  `, [profUser.id]);
  testContest = contestRes.rows[0];

  const contestProbRes = await query(`
    INSERT INTO problems (title, description, difficulty, coding_mode, access_scope, created_by)
    VALUES ('Contest Secret Algorithm', 'Find the mystery output', 'medium', 'full_program', 'contest_private', $1)
    RETURNING id, title;
  `, [profUser.id]);
  contestProblem = contestProbRes.rows[0];

  // Attach problem to contest
  await query(`
    INSERT INTO contest_problems (contest_id, problem_id, points, problem_order)
    VALUES ($1, $2, 100, 1);
  `, [testContest.id, contestProblem.id]);

  // Seed test case for contest problem
  await query(`
    INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden, order_index)
    VALUES ($1, '42\\n', '84\\n', true, false, 1);
  `, [contestProblem.id]);

  // Enroll studentUser in contest
  await query(`
    INSERT INTO contest_participants (contest_id, user_id)
    VALUES ($1, $2);
  `, [testContest.id, studentUser.id]);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  STARTING PUBLIC PRACTICE SUBMISSION CONTEXT TEST SUITE');
  console.log('===============================================================\n');

  await setup();

  // Test 1: Public problem submission succeeds with contest_id = NULL
  console.log('--- Test 1 & 2: Public Practice Submission (contest_id = NULL) ---');
  const twoSumSource = `
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, num in enumerate(nums):
            comp = target - num
            if comp in seen:
                return [seen[comp], i]
            seen[num] = i
        return []
`;

  const publicSubmitRes = await makeRequest('POST', '/api/submissions', {
    problemId: publicProblemTwoSum.id,
    language: 'python',
    codingMode: 'function',
    sourceCode: twoSumSource,
    // No contestId sent (null)
  }, studentToken);

  assert.strictEqual(publicSubmitRes.status, 201, `Public submission endpoint returned 201 Created (got ${publicSubmitRes.status})`);
  assert.strictEqual(publicSubmitRes.body.submission.contestId, null, 'Submission response has contestId = null');
  console.log('  ✅ Test 1 Passed: Public problem submission succeeds with contest_id = NULL');

  const submissionId = publicSubmitRes.body.submission.id;
  const dbSub = (await query(`SELECT * FROM submissions WHERE id = $1;`, [submissionId])).rows[0];
  assert(dbSub, 'Submission row exists in database');
  assert.strictEqual(dbSub.contest_id, null, 'Database column contest_id is strictly NULL');
  console.log('  ✅ Test 2 Passed: Public problem submission is persisted successfully with contest_id = NULL');

  // Test 3: Public submission can be retrieved from submission history
  console.log('\n--- Test 3: History Retrieval for Public Submissions ---');
  const historyRes = await makeRequest('GET', '/api/submissions/my', null, studentToken);

  assert.strictEqual(historyRes.status, 200, 'History endpoint returned 200 OK');
  assert(Array.isArray(historyRes.body.submissions), 'Submissions array returned');
  const foundInHistory = historyRes.body.submissions.find(s => s.id === submissionId);
  assert(foundInHistory, 'Public practice submission found in user history');
  assert.strictEqual(foundInHistory.contestId, null, 'History item has contestId = null');
  console.log('  ✅ Test 3 Passed: Public submission is retrieved from history with contestId = NULL');

  // Test 4: Public submission detail works with NULL contest_id
  console.log('\n--- Test 4: Submission Detail for Public Submissions ---');
  const detailRes = await makeRequest('GET', `/api/submissions/${submissionId}`, null, studentToken);

  assert.strictEqual(detailRes.status, 200, 'Detail endpoint returned 200 OK');
  assert.strictEqual(detailRes.body.id, submissionId, 'Submission detail ID matches');
  assert.strictEqual(detailRes.body.contestId, null, 'Detail contestId is null');
  assert.strictEqual(detailRes.body.contestTitle, null, 'Detail contestTitle is null');
  assert.strictEqual(detailRes.body.problemTitle, 'Two Sum', 'Problem title is Two Sum');
  console.log('  ✅ Test 4 Passed: Public submission detail works with NULL contest_id');

  // Test 5: Contest submission still succeeds with valid contest_id
  console.log('\n--- Test 5: Contest Submission with Valid contest_id ---');
  const contestSource = `
#include <iostream>
using namespace std;
int main() {
    int x;
    if (cin >> x) cout << x * 2 << endl;
    return 0;
}
`;
  const contestSubmitRes = await makeRequest('POST', '/api/submissions', {
    contestId: testContest.id,
    problemId: contestProblem.id,
    language: 'cpp',
    codingMode: 'full_program',
    sourceCode: contestSource,
  }, studentToken);

  assert.strictEqual(contestSubmitRes.status, 201, `Contest submission endpoint returned 201 Created (got ${contestSubmitRes.status})`);
  assert.strictEqual(contestSubmitRes.body.submission.contestId, testContest.id, 'Contest submission has real contestId');
  console.log('  ✅ Test 5 Passed: Contest submission succeeds with valid contest_id');

  // Test 6: Contest submission rejects mismatched problem/contest
  console.log('\n--- Test 6: Mismatched Contest Problem Rejection ---');
  const mismatchedSubmitRes = await makeRequest('POST', '/api/submissions', {
    contestId: testContest.id,
    problemId: 999999, // Non-existent or unattached problem
    language: 'cpp',
    codingMode: 'full_program',
    sourceCode: contestSource,
  }, studentToken);

  assert.strictEqual(mismatchedSubmitRes.status, 404, 'Mismatched non-existent problem returns 404');
  console.log('  ✅ Test 6 Passed: Mismatched problem submission safely rejected');

  // Test 7: Unauthorized/Stale contest_id on public problem is coerced to public practice
  console.log('\n--- Test 7: Arbitrary Contest ID Injection on Public Problem ---');
  const arbitraryContestRes = await makeRequest('POST', '/api/submissions', {
    contestId: testContest.id, // Trying to submit public problem against contest
    problemId: publicProblemSubSum.id,
    language: 'python',
    codingMode: 'function',
    sourceCode: `class Solution:\n    def subarraySum(self, nums: list[int], k: int) -> int:\n        return 0\n`,
  }, otherStudentToken);

  assert.strictEqual(arbitraryContestRes.status, 201, 'Public problem submission succeeds');
  assert.strictEqual(arbitraryContestRes.body.submission.contestId, null, 'Public problem is evaluated with contestId = NULL (does not leak into contest)');
  console.log('  ✅ Test 7 Passed: Arbitrary contest_id on public problem is safely coerced to NULL');

  // Test 8 & 10: Public submission does not affect contest leaderboard or standings
  console.log('\n--- Test 8 & 10: Contest Leaderboard & Standings Isolation ---');
  const standingsPayload = await StandingsService.computeContestStandings({ contestId: testContest.id });
  assert(Array.isArray(standingsPayload.standings), 'Standings array returned');
  
  // Verify that Two Sum and Subarray Sum submissions do not appear in testContest standings
  for (const row of standingsPayload.standings) {
    if (row.problemResults) {
      for (const pr of row.problemResults) {
        assert(pr.problemId !== publicProblemTwoSum.id, 'Two Sum public submission NOT in contest standings');
        assert(pr.problemId !== publicProblemSubSum.id, 'Subarray Sum public submission NOT in contest standings');
      }
    }
  }
  console.log('  ✅ Test 8 & 10 Passed: Public submissions strictly excluded from contest leaderboard & standings');

  // Test 9: Public submission does not affect Elo/rating
  console.log('\n--- Test 9: Rating & Elo Isolation ---');
  const userRating = (await query(`SELECT current_rating FROM users WHERE id = $1;`, [studentUser.id])).rows[0];
  assert.strictEqual(userRating.current_rating, 1200, 'Student rating remained unchanged (1200)');
  console.log('  ✅ Test 9 Passed: Public submissions have zero impact on student rating/Elo');

  // Test 11: Malformed contest_id is rejected safely
  console.log('\n--- Test 11: Malformed contest_id Rejection ---');
  const malformedRes = await makeRequest('POST', '/api/submissions', {
    contestId: 'invalid-string-id',
    problemId: publicProblemTwoSum.id,
    language: 'python',
    sourceCode: twoSumSource,
  }, studentToken);

  assert.strictEqual(malformedRes.status, 400, 'Malformed contest_id returned 400 Bad Request');
  console.log('  ✅ Test 11 Passed: Malformed contest_id is safely rejected with 400 Bad Request');

  // Test 12: Existing BOLA/IDOR protections remain intact
  console.log('\n--- Test 12: BOLA/IDOR Protection on Submission Inspection ---');
  const unauthorizedInspectRes = await makeRequest('GET', `/api/submissions/${submissionId}`, null, otherStudentToken);

  assert.strictEqual(unauthorizedInspectRes.status, 403, 'Other student cannot inspect private submission (403 Forbidden)');

  const unauthorizedCodeRes = await makeRequest('GET', `/api/submissions/${submissionId}/code`, null, otherStudentToken);

  assert.strictEqual(unauthorizedCodeRes.status, 403, 'Other student cannot inspect private submission code (403 Forbidden)');
  console.log('  ✅ Test 12 Passed: BOLA/IDOR protection verified for submission inspection & code retrieval');

  // Clean up fixtures
  await query(`DELETE FROM submissions WHERE user_id IN ($1, $2);`, [studentUser.id, otherStudentUser.id]);
  await query(`DELETE FROM contest_problems WHERE contest_id = $1;`, [testContest.id]);
  await query(`DELETE FROM contest_participants WHERE contest_id = $1;`, [testContest.id]);
  await query(`DELETE FROM test_cases WHERE problem_id = $1;`, [contestProblem.id]);
  await query(`DELETE FROM problems WHERE id = $1;`, [contestProblem.id]);
  await query(`DELETE FROM contests WHERE id = $1;`, [testContest.id]);
  await query(`DELETE FROM users WHERE id IN ($1, $2, $3, $4);`, [studentUser.id, otherStudentUser.id, profUser.id, adminUser.id]);

  console.log('\n===============================================================');
  console.log('  ALL 12/12 PUBLIC PRACTICE CONTEXT TEST ASSERTIONS PASSED!');
  console.log('===============================================================\n');
}

runTests()
  .then(async () => {
    if (server) server.close();
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ Test Suite Failed:', err);
    if (server) server.close();
    await closePool();
    process.exit(1);
  });
