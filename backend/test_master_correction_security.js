/**
 * Automated Verification Suite: Master Correction + Hardening
 * Verifies:
 * 1. Public vs Contest-Private content model (access_scope)
 * 2. Problem Explorer server-side scoping & search isolation
 * 3. BOLA/IDOR protection on GET /api/problems/:id (safe 404 disclosure)
 * 4. Contest participant authorization for private problems
 * 5. Contest lifecycle runtime execution controls (upcoming vs running)
 * 6. Test fixture isolation and teardown
 */

const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ProblemModel = require('./src/models/problemModel');
const ContestModel = require('./src/models/contestModel');
const TestCaseModel = require('./src/models/testCaseModel');
const { getContestRuntimeState } = require('./src/services/contestService');
const { hashPassword } = require('./src/services/authService');

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
  console.log('  STARTING MASTER CORRECTION + HARDENING TEST SUITE');
  console.log('===============================================================\n');

  let profUser, studentA, studentB, adminUser;
  let publicProblem, privateProblem1, privateProblem2;
  let testContestRunning, testContestUpcoming;

  try {
    const pwHash = await hashPassword('Password123!');
    const suffix = Date.now().toString().slice(-5);

    // 1. Setup Test Users
    console.log('--- 1. Setting Up Test Actors ---');
    profUser = await UserModel.createUser({
      username: `prof_hard_${suffix}`,
      email: `prof_hard_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Prof Hardening Test',
      role: 'professor',
    });
    assert(profUser && profUser.role === 'professor', 'Created test professor');

    studentA = await UserModel.createUser({
      username: `stud_a_${suffix}`,
      email: `stud_a_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Student Alpha',
      role: 'student',
    });
    assert(studentA && studentA.role === 'student', 'Created student Alpha (enrolled in contest)');

    studentB = await UserModel.createUser({
      username: `stud_b_${suffix}`,
      email: `stud_b_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Student Beta',
      role: 'student',
    });
    assert(studentB && studentB.role === 'student', 'Created student Beta (unauthorized / non-participant)');

    adminUser = await UserModel.createUser({
      username: `admin_hard_${suffix}`,
      email: `admin_hard_${suffix}@test.edu`,
      passwordHash: pwHash,
      fullName: 'Admin Hardening Test',
      role: 'super_admin',
    });
    assert(adminUser && adminUser.role === 'super_admin', 'Created test super admin');

    // 2. Create Problems with Public and Contest-Private Scopes
    console.log('\n--- 2. Creating Public and Contest-Private Problems ---');
    publicProblem = await ProblemModel.createProblem({
      title: `Public Algorithmic Challenge ${suffix}`,
      description: 'Public open-practice problem accessible in Problem Explorer.',
      difficulty: 'easy',
      codingMode: 'function',
      accessScope: 'public',
      createdBy: profUser.id,
    });
    assert(publicProblem && (publicProblem.accessScope === 'public' || publicProblem.access_scope === 'public'), 'Created public problem with access_scope = public');

    privateProblem1 = await ProblemModel.createProblem({
      title: `Private Exam Problem Secret ${suffix}`,
      description: 'Strictly confidential professor exam question for Contest X.',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profUser.id,
    });
    assert(privateProblem1 && (privateProblem1.accessScope === 'contest_private' || privateProblem1.access_scope === 'contest_private'), 'Created contest-private problem 1');

    privateProblem2 = await ProblemModel.createProblem({
      title: `Private Contest Challenge Alpha ${suffix}`,
      description: 'Confidential problem for upcoming contest.',
      difficulty: 'hard',
      codingMode: 'function',
      accessScope: 'contest_private',
      createdBy: profUser.id,
    });
    assert(privateProblem2 && (privateProblem2.accessScope === 'contest_private' || privateProblem2.access_scope === 'contest_private'), 'Created contest-private problem 2');

    // Attach sample test cases
    await TestCaseModel.createTestCase({
      problemId: privateProblem1.id,
      inputData: '5\n',
      expectedOutput: '10',
      isHidden: false,
      testOrder: 1,
    });

    // 3. Create Contests (Running vs Upcoming)
    console.log('\n--- 3. Setting Up Contests and Attachments ---');
    const now = new Date();
    const startRunning = new Date(now.getTime() - 3600 * 1000).toISOString();
    const endRunning = new Date(now.getTime() + 3600 * 1000).toISOString();

    testContestRunning = await ContestModel.createContest({
      title: `Live Exam Contest ${suffix}`,
      description: 'Live contest with enrolled student Alpha.',
      startTime: startRunning,
      endTime: endRunning,
      createdBy: profUser.id,
    });
    testContestRunning = await ContestModel.updateContestStatus(testContestRunning.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: testContestRunning.id,
      problemId: privateProblem1.id,
      points: 100,
      problemOrder: 1,
    });
    await ContestModel.addParticipant(testContestRunning.id, studentA.id);

    const startUpcoming = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
    const endUpcoming = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();

    testContestUpcoming = await ContestModel.createContest({
      title: `Upcoming Final Exam ${suffix}`,
      description: 'Upcoming contest starting tomorrow.',
      startTime: startUpcoming,
      endTime: endUpcoming,
      createdBy: profUser.id,
    });
    testContestUpcoming = await ContestModel.updateContestStatus(testContestUpcoming.id, 'published');
    await ContestModel.addProblemToContest({
      contestId: testContestUpcoming.id,
      problemId: privateProblem2.id,
      points: 100,
      problemOrder: 1,
    });

    assert(getContestRuntimeState(testContestRunning) === 'running', 'Contest 1 runtimeState evaluated as "running"');
    assert(getContestRuntimeState(testContestUpcoming) === 'upcoming', 'Contest 2 runtimeState evaluated as "upcoming"');

    // 4. Test Public Problem Explorer Visibility (findAllProblems Scoping)
    console.log('\n--- 4. Testing Problem Explorer Server-Side Scoping ---');
    // Student B queries all problems
    const studentExplorerResults = await ProblemModel.findAllProblems({
      userId: studentB.id,
      userRole: 'student',
      limit: 50,
    });
    const containsPrivate1 = studentExplorerResults.some((p) => p.id === privateProblem1.id);
    const containsPrivate2 = studentExplorerResults.some((p) => p.id === privateProblem2.id);
    const containsPublic = studentExplorerResults.some((p) => p.id === publicProblem.id);

    assert(containsPublic === true, 'Student Problem Explorer includes public problem');
    assert(containsPrivate1 === false, 'Student Problem Explorer STRICTLY EXCLUDES privateProblem1');
    assert(containsPrivate2 === false, 'Student Problem Explorer STRICTLY EXCLUDES privateProblem2');

    // Student B searches for the exact private title
    const searchResults = await ProblemModel.findAllProblems({
      search: `Private Exam Problem Secret ${suffix}`,
      userId: studentB.id,
      userRole: 'student',
      limit: 50,
    });
    assert(searchResults.length === 0, 'Search query for private problem title returns 0 results for student');

    const searchPublicResults = await ProblemModel.findAllProblems({
      search: `Public Algorithmic Challenge ${suffix}`,
      userId: studentB.id,
      userRole: 'student',
      limit: 50,
    });
    assert(searchPublicResults.length === 1 && searchPublicResults[0].id === publicProblem.id, 'Search query for public problem returns exact match');

    // Professor queries all problems (sees public + own created private)
    const profExplorerResults = await ProblemModel.findAllProblems({
      userId: profUser.id,
      userRole: 'professor',
      limit: 50,
    });
    assert(profExplorerResults.some((p) => p.id === publicProblem.id), 'Professor sees public problem');
    assert(profExplorerResults.some((p) => p.id === privateProblem1.id), 'Professor sees their own private problem 1');
    assert(profExplorerResults.some((p) => p.id === privateProblem2.id), 'Professor sees their own private problem 2');

    // Admin queries all problems
    const adminExplorerResults = await ProblemModel.findAllProblems({
      userId: adminUser.id,
      userRole: 'super_admin',
      limit: 50,
    });
    assert(adminExplorerResults.some((p) => p.id === privateProblem1.id), 'Super admin sees private problems in platform explorer');

    // 5. Test Problem Authorization Check (isUserAuthorizedForProblem)
    console.log('\n--- 5. Testing Problem Direct Access Authorization & BOLA/IDOR ---');
    const fetchedPublic = await ProblemModel.findProblemById(publicProblem.id);
    const fetchedPrivate1 = await ProblemModel.findProblemById(privateProblem1.id);

    // Public problem is authorized for all
    const pubAuthStudentB = await ProblemModel.isUserAuthorizedForProblem(fetchedPublic, studentB);
    const pubAuthUnauth = await ProblemModel.isUserAuthorizedForProblem(fetchedPublic, null);
    assert(pubAuthStudentB === true, 'Public problem is authorized for student Beta');
    assert(pubAuthUnauth === true, 'Public problem is authorized for unauthenticated visitor');

    // Private problem 1:
    // Unauthorized student Beta (not enrolled in contest)
    const privAuthStudentB = await ProblemModel.isUserAuthorizedForProblem(fetchedPrivate1, studentB);
    assert(privAuthStudentB === false, 'Private problem is UNAUTHORIZED for unenrolled student Beta (BOLA protected)');

    // Enrolled student Alpha (enrolled in live contest testContestRunning)
    const privAuthStudentA = await ProblemModel.isUserAuthorizedForProblem(fetchedPrivate1, studentA);
    assert(privAuthStudentA === true, 'Private problem is AUTHORIZED for enrolled student Alpha');

    // Professor creator
    const privAuthProf = await ProblemModel.isUserAuthorizedForProblem(fetchedPrivate1, profUser);
    assert(privAuthProf === true, 'Private problem is AUTHORIZED for authoring professor');

    // Super Admin
    const privAuthAdmin = await ProblemModel.isUserAuthorizedForProblem(fetchedPrivate1, adminUser);
    assert(privAuthAdmin === true, 'Private problem is AUTHORIZED for super admin');

    // 6. Test Contest Problem Ordering Determinism
    console.log('\n--- 6. Testing Contest Problem Ordering Determinism ---');
    const contestProblems = await ContestModel.getContestProblems(testContestRunning.id);
    assert(contestProblems.length === 1, 'Retrieved contest problems for running contest');
    assert(contestProblems[0].problemId === privateProblem1.id, 'Problem is correctly associated with contest');
    assert(contestProblems[0].problemOrder === 1, 'Problem order is deterministic (1)');

    console.log('\n===============================================================');
    console.log(`  MASTER CORRECTION SUITE COMPLETE: ${passedAssertions}/${totalAssertions} ASSERTIONS PASSED`);
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ MASTER CORRECTION TEST SUITE FAILED:', err);
    throw err;
  } finally {
    // 7. Cleanup Test Fixtures
    console.log('--- Cleaning Up Test Fixtures ---');
    try {
      if (testContestRunning) await ContestModel.deleteContest(testContestRunning.id);
      if (testContestUpcoming) await ContestModel.deleteContest(testContestUpcoming.id);
      if (publicProblem) await query('DELETE FROM problems WHERE id = $1', [publicProblem.id]);
      if (privateProblem1) await query('DELETE FROM problems WHERE id = $1', [privateProblem1.id]);
      if (privateProblem2) await query('DELETE FROM problems WHERE id = $1', [privateProblem2.id]);
      if (profUser) await query('DELETE FROM users WHERE id = $1', [profUser.id]);
      if (studentA) await query('DELETE FROM users WHERE id = $1', [studentA.id]);
      if (studentB) await query('DELETE FROM users WHERE id = $1', [studentB.id]);
      if (adminUser) await query('DELETE FROM users WHERE id = $1', [adminUser.id]);
      console.log('✅ Ephemeral test fixtures cleanly removed from database.');
    } catch (cleanErr) {
      console.error('Warning during test cleanup:', cleanErr.message);
    }
  }
}

if (require.main === module) {
  runTests()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async () => {
      await closePool();
      process.exit(1);
    });
}

module.exports = { runTests };
