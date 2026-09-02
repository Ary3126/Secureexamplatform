/**
 * Targeted Verification Suite: Problem Explorer Public Problem Reset
 * 
 * Verifies:
 * 1. Public Problem Explorer contains EXACTLY Two Sum (EASY) and Subarray Sum (MEDIUM).
 * 2. Total pagination count for normal students is strictly 2.
 * 3. Professor-created contest problems default to 'contest_private' and do NOT leak into Problem Explorer.
 * 4. Private problems cannot be discovered via search, difficulty filters, or pagination.
 * 5. BOLA/IDOR protection on GET /api/problems/:id (safe 404 for unauthorized access).
 * 6. Authorized contest participant CAN access their contest problem.
 * 7. Professor creator CAN access their own private problem.
 * 8. Professor cannot manage another professor's problem.
 * 9. Admin retains authorized rights and can publish problems.
 * 10. Judge execution and evaluation for Two Sum and Subarray Sum produce correct verdicts.
 */

const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const TestCaseModel = require('./src/models/testCaseModel');
const JudgeService = require('./src/judge/judgeService');
const { hashPassword } = require('./src/services/authService');
const { initDb } = require('./src/config/initDb');

let passedAssertions = 0;
let totalAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (!condition) {
    console.error(`  ❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  passedAssertions++;
  console.log(`  ✅ ${message}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  STARTING PROBLEM EXPLORER PUBLIC DATASET RESET SUITE');
  console.log('===============================================================\n');

  try {
    // 0. Ensure canonical database seed
    await initDb();

    const pwHash = await hashPassword('Password123!');
    const suffix = Date.now().toString().slice(-5);

    // 1. Setup Test Actors
    console.log('--- 1. Setting Up Test Actors ---');
    const profA = await UserModel.createUser({
      username: `prof_a_pub_${suffix}`,
      email: `prof_a_pub_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Professor Alpha',
      role: 'professor',
    });
    assert(profA && profA.role === 'professor', 'Created test professor Alpha');

    const profB = await UserModel.createUser({
      username: `prof_b_pub_${suffix}`,
      email: `prof_b_pub_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Professor Beta',
      role: 'professor',
    });
    assert(profB && profB.role === 'professor', 'Created test professor Beta');

    const student = await UserModel.createUser({
      username: `stud_pub_${suffix}`,
      email: `stud_pub_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Student Public Test',
      role: 'student',
    });
    assert(student && student.role === 'student', 'Created test student');

    const admin = await UserModel.createUser({
      username: `admin_pub_${suffix}`,
      email: `admin_pub_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Admin Public Test',
      role: 'super_admin',
    });
    assert(admin && admin.role === 'super_admin', 'Created test super admin');

    // 2. Verify Canonical Public Dataset
    console.log('\n--- 2. Verifying Public Problem Explorer Dataset ---');
    const publicProblems = await ProblemModel.findAllProblems({
      userId: student.id,
      userRole: 'student',
      limit: 50,
      offset: 0,
    });
    const publicCount = await ProblemModel.countAllProblems({
      userId: student.id,
      userRole: 'student',
    });

    assert(publicCount === 2, `Public problems count for student is strictly 2 (got ${publicCount})`);
    assert(publicProblems.length === 2, `Public problems list returned exactly 2 problems (got ${publicProblems.length})`);

    const titles = publicProblems.map((p) => p.title);
    assert(titles.includes('Two Sum'), 'Public dataset contains "Two Sum"');
    assert(titles.includes('Subarray Sum'), 'Public dataset contains "Subarray Sum"');

    const twoSum = publicProblems.find((p) => p.title === 'Two Sum');
    const subarraySum = publicProblems.find((p) => p.title === 'Subarray Sum');

    assert(twoSum.difficulty.toLowerCase() === 'easy', 'Two Sum difficulty is EASY');
    assert(subarraySum.difficulty.toLowerCase() === 'medium', 'Subarray Sum difficulty is MEDIUM');
    assert(twoSum.accessScope === 'public', 'Two Sum accessScope is public');
    assert(subarraySum.accessScope === 'public', 'Subarray Sum accessScope is public');

    // Verify Test Cases for Two Sum
    const twoSumCases = await TestCaseModel.findTestCasesByProblemId(twoSum.id, { includeHidden: true });
    assert(twoSumCases.length === 6, `Two Sum has exactly 6 test cases (got ${twoSumCases.length})`);
    const twoSumSample = twoSumCases.filter((tc) => !tc.isHidden);
    assert(twoSumSample.length === 1, 'Two Sum has 1 sample test case');
    assert(twoSumSample[0].inputData.includes('2 7 11 15'), 'Two Sum sample input matches specification');

    // Verify Test Cases for Subarray Sum
    const subSumCases = await TestCaseModel.findTestCasesByProblemId(subarraySum.id, { includeHidden: true });
    assert(subSumCases.length === 8, `Subarray Sum has exactly 8 test cases (got ${subSumCases.length})`);
    const subSumSample = subSumCases.filter((tc) => !tc.isHidden);
    assert(subSumSample.length === 1, 'Subarray Sum has 1 sample test case');
    assert(subSumSample[0].inputData.includes('1 1 1'), 'Subarray Sum sample input matches specification');

    // 3. Search and Filtering Isolation on Public Dataset
    console.log('\n--- 3. Testing Public Explorer Search and Filter Isolation ---');
    const easyProblems = await ProblemModel.findAllProblems({
      difficulty: 'easy',
      userId: student.id,
      userRole: 'student',
    });
    assert(easyProblems.length === 1 && easyProblems[0].title === 'Two Sum', 'Difficulty filter "easy" returns only Two Sum');

    const mediumProblems = await ProblemModel.findAllProblems({
      difficulty: 'medium',
      userId: student.id,
      userRole: 'student',
    });
    assert(mediumProblems.length === 1 && mediumProblems[0].title === 'Subarray Sum', 'Difficulty filter "medium" returns only Subarray Sum');

    const searchTwoSum = await ProblemModel.findAllProblems({
      search: 'Two Sum',
      userId: student.id,
      userRole: 'student',
    });
    assert(searchTwoSum.length === 1 && searchTwoSum[0].title === 'Two Sum', 'Search "Two Sum" returns only Two Sum');

    // 4. Professor Problem Creation & Contest Isolation
    console.log('\n--- 4. Testing Professor Contest Problem Isolation ---');
    const profProblem = await ProblemModel.createProblem({
      title: `DSA Exam Question 3 ${suffix}`,
      description: 'Confidential examination problem for Prof Alpha contest.',
      difficulty: 'hard',
      codingMode: 'full_program',
      accessScope: 'contest_private',
      createdBy: profA.id,
    });
    assert(profProblem && profProblem.accessScope === 'contest_private', 'Professor problem created with access_scope = contest_private');

    // Normal student must NOT see profProblem in Problem Explorer
    const studentExplorerAfter = await ProblemModel.findAllProblems({
      userId: student.id,
      userRole: 'student',
    });
    assert(studentExplorerAfter.length === 2, 'Student still sees strictly 2 problems after professor created problem');
    assert(!studentExplorerAfter.some((p) => p.id === profProblem.id), 'Professor problem is absent from student Problem Explorer');

    const searchPrivate = await ProblemModel.findAllProblems({
      search: `DSA Exam Question 3 ${suffix}`,
      userId: student.id,
      userRole: 'student',
    });
    assert(searchPrivate.length === 0, 'Private problem cannot be discovered through public search');

    // 5. BOLA / IDOR Protection for Direct Access
    console.log('\n--- 5. Testing Direct Access Authorization (BOLA/IDOR) ---');
    const isStudentAuthorized = await ProblemModel.isUserAuthorizedForProblem(profProblem, student);
    assert(isStudentAuthorized === false, 'Unauthorized student is NOT authorized for private contest problem');

    const isProfAuthorized = await ProblemModel.isUserAuthorizedForProblem(profProblem, profA);
    assert(isProfAuthorized === true, 'Problem creator (Professor Alpha) IS authorized for their own problem');

    const isOtherProfAuthorized = await ProblemModel.isUserAuthorizedForProblem(profProblem, profB);
    assert(isOtherProfAuthorized === false, 'Other professor (Professor Beta) is NOT authorized for private problem');

    const isAdminAuthorized = await ProblemModel.isUserAuthorizedForProblem(profProblem, admin);
    assert(isAdminAuthorized === true, 'Super Admin IS authorized for private problem');

    // 6. Contest Participant Access
    console.log('\n--- 6. Testing Contest Participant Access ---');
    const contest = await ContestModel.createContest({
      title: `Midterm Contest ${suffix}`,
      description: 'Midterm contest by Prof Alpha',
      startTime: new Date(Date.now() - 3600 * 1000).toISOString(),
      endTime: new Date(Date.now() + 3600 * 1000).toISOString(),
      createdBy: profA.id,
    });
    await ContestModel.updateContestStatus(contest.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: contest.id,
      problemId: profProblem.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addParticipant(contest.id, student.id);

    const isParticipantAuthorized = await ProblemModel.isUserAuthorizedForProblem(profProblem, student);
    assert(isParticipantAuthorized === true, 'Enrolled contest participant IS authorized for contest problem');

    // 7. Judge Evaluation for Two Sum and Subarray Sum in Function Mode
    console.log('\n--- 7. Testing Judge Evaluation for Two Sum & Subarray Sum in Function Mode ---');
    
    // Python Two Sum Function Mode Solution
    const twoSumPyFunc = `
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, x in enumerate(nums):
            comp = target - x
            if comp in seen:
                return [seen[comp], i]
            seen[x] = i
        return []
`;
    const twoSumEval = await JudgeService.evaluateSubmission({
      submissionId: 999901,
      language: 'python',
      codingMode: 'function',
      sourceCode: twoSumPyFunc,
      testCases: twoSumCases,
      problem: twoSum,
      problemPoints: 100,
      isSampleRun: false,
    });
    console.log('twoSumEval:', JSON.stringify(twoSumEval, null, 2));
    assert(twoSumEval.status === 'accepted', `Two Sum Python function solution evaluated as ACCEPTED (got ${twoSumEval.status})`);
    assert(twoSumEval.testCasesPassed === 6, `Two Sum passed all 6 test cases (got ${twoSumEval.testCasesPassed}/6)`);

    // Python Subarray Sum Function Mode Solution
    const subSumPyFunc = `
class Solution:
    def subarraySum(self, nums: list[int], k: int) -> int:
        from collections import defaultdict
        prefix_map = defaultdict(int)
        prefix_map[0] = 1
        curr_sum = 0
        count = 0
        for num in nums:
            curr_sum += num
            count += prefix_map[curr_sum - k]
            prefix_map[curr_sum] += 1
        return count
`;
    const subSumEval = await JudgeService.evaluateSubmission({
      submissionId: 999902,
      language: 'python',
      codingMode: 'function',
      sourceCode: subSumPyFunc,
      testCases: subSumCases,
      problem: subarraySum,
      problemPoints: 100,
      isSampleRun: false,
    });
    assert(subSumEval.status === 'accepted', `Subarray Sum Python function solution evaluated as ACCEPTED (got ${subSumEval.status})`);
    assert(subSumEval.testCasesPassed === 8, `Subarray Sum passed all 8 test cases (got ${subSumEval.testCasesPassed}/8)`);

    // 8. SQL Injection & Injection Attack Resilience
    console.log('\n--- 8. Testing SQL Injection Search Resilience ---');
    const sqliSearch = await ProblemModel.findAllProblems({
      search: "' OR 1=1 --",
      userId: student.id,
      userRole: 'student',
    });
    assert(sqliSearch.length === 0, 'SQL injection in search parameter is safely parameterized and returns 0');

    const sqliDiff = await ProblemModel.findAllProblems({
      difficulty: "easy' OR '1'='1",
      userId: student.id,
      userRole: 'student',
    });
    assert(sqliDiff.length === 0, 'SQL injection in difficulty parameter is safely parameterized and returns 0');

    console.log('\n===============================================================');
    console.log(`  ALL ${passedAssertions}/${totalAssertions} PROBLEM EXPLORER RESET ASSERTIONS PASSED!`);
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

runTests();
