/**
 * Phase 7.5.2 — Contest List & Discovery Automated Backend Test Suite
 * File: backend/test_admin_phase5_2_contest_list.js
 * 
 * Verifies:
 * 1. Contest list access across roles (Public/Guest, Student, Professor, Contest Admin, Super Admin)
 * 2. RBAC & Privacy enforcement (Students never discover draft contests)
 * 3. Ownership isolation (Professor A sees own drafts, but NOT Professor B's drafts; Admins see all)
 * 4. Server-side Search (matching title, description, ID, creator username; case-insensitive)
 * 5. Search resilience (special characters, SQL injection defense, empty/whitespace queries)
 * 6. Filters (status: draft/published/archived, state: upcoming/running/ended, isRated: true/false, createdBy)
 * 7. Server-side Sorting (whitelist validation for startTime, createdAt, title, ASC/DESC, injection defense)
 * 8. Server-side Pagination (page, limit, total, totalPages, count, offset calculation, clamping)
 * 9. Server-authoritative runtimeState calculation in payload
 * 10. Empty results handling (count: 0, total: 0, totalPages: 0, contests: [])
 * 11. Query parameter resilience (handles garbage parameters without crashing)
 * 12. Complete API response structure (camelCase fields, counts, metadata)
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const { hashPassword, generateToken } = require('./src/services/authService');

let server;
let port;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assertTest(condition, message, detail = '') {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message} - ${detail}`);
  }
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 7.5.2 CONTEST LIST & DISCOVERY TESTS');
  console.log('=======================================================\n');

  // Start ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  const timestamp = Date.now();
  const testUsers = [];
  const testContests = [];
  const testProblems = [];

  try {
    // -------------------------------------------------------------------------
    // 1. Setting Up Test Actors
    // -------------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    // Professor A
    const profA = await UserModel.createUser({
      username: `prof_a_752_${timestamp}`,
      email: `prof_a_752_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'MIT',
      fullName: 'Professor Alpha 752',
    });
    testUsers.push(profA.id);
    const tokenProfA = generateToken({ id: profA.id, role: profA.role, username: profA.username });

    // Professor B
    const profB = await UserModel.createUser({
      username: `prof_b_752_${timestamp}`,
      email: `prof_b_752_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'Stanford',
      fullName: 'Professor Beta 752',
    });
    testUsers.push(profB.id);
    const tokenProfB = generateToken({ id: profB.id, role: profB.role, username: profB.username });

    // Contest Admin
    const contestAdmin = await UserModel.createUser({
      username: `cadm_752_${timestamp}`,
      email: `cadm_752_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'contest_admin',
      institution: 'ExamForge',
      fullName: 'Contest Admin 752',
    });
    testUsers.push(contestAdmin.id);
    const tokenContestAdmin = generateToken({ id: contestAdmin.id, role: contestAdmin.role, username: contestAdmin.username });

    // Super Admin
    const superAdmin = await UserModel.createUser({
      username: `sadmin_752_${timestamp}`,
      email: `sadmin_752_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'super_admin',
      institution: 'ExamForge',
      fullName: 'Super Admin 752',
    });
    testUsers.push(superAdmin.id);
    const tokenSuperAdmin = generateToken({ id: superAdmin.id, role: superAdmin.role, username: superAdmin.username });

    // Student
    const student = await UserModel.createUser({
      username: `stud_752_${timestamp}`,
      email: `stud_752_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      institution: 'MIT',
      fullName: 'Student Learner 752',
    });
    testUsers.push(student.id);
    const tokenStudent = generateToken({ id: student.id, role: student.role, username: student.username });

    assertTest(tokenProfA && tokenProfB && tokenContestAdmin && tokenSuperAdmin && tokenStudent, 'Test actors initialized successfully');

    // -------------------------------------------------------------------------
    // 2. Seeding Test Contests Across Multiple States and Owners
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Seeding Distinct Test Contests ---');

    // Shared problem for publishability
    const sampleProblem = await ProblemModel.createProblem({
      title: `Sample Prob 752 ${timestamp}`,
      description: 'Test problem description for contest',
      difficulty: 'easy',
      codingMode: 'full_program',
      starterTemplates: {},
      createdBy: profA.id,
      accessScope: 'contest_private',
    });
    testProblems.push(sampleProblem.id);

    // Contest 1: Prof A Draft
    const contestProfADraft = await ContestModel.createContest({
      title: `Quantum Algorithms Draft ${timestamp}`,
      description: 'Exploration of quantum algorithmic complexity',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    testContests.push(contestProfADraft.id);

    // Contest 2: Prof B Draft
    const contestProfBDraft = await ContestModel.createContest({
      title: `Neural Network Heuristics Draft ${timestamp}`,
      description: 'Deep learning heuristic optimizations',
      startTime: new Date(Date.now() + 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      createdBy: profB.id,
      isRated: false,
    });
    testContests.push(contestProfBDraft.id);

    // Contest 3: Published Upcoming (Prof A)
    const contestUpcoming = await ContestModel.createContest({
      title: `Graph Theory Challenge Upcoming ${timestamp}`,
      description: 'Advanced graph traversals and flows',
      startTime: new Date(Date.now() + 86400000).toISOString(), // tomorrow
      endTime: new Date(Date.now() + 90000000).toISOString(),
      createdBy: profA.id,
      isRated: true,
    });
    testContests.push(contestUpcoming.id);
    await ContestModel.addProblemToContest({ contestId: contestUpcoming.id, problemId: sampleProblem.id });
    await ContestModel.updateContestStatus(contestUpcoming.id, 'published');

    // Contest 4: Published Running (Prof B)
    const contestRunning = await ContestModel.createContest({
      title: `Dynamic Programming Live Running ${timestamp}`,
      description: 'Competitive DP and memoization sprint',
      startTime: new Date(Date.now() - 1800000).toISOString(), // started 30 mins ago
      endTime: new Date(Date.now() + 1800000).toISOString(),  // ends in 30 mins
      createdBy: profB.id,
      isRated: true,
    });
    testContests.push(contestRunning.id);
    await ContestModel.addProblemToContest({ contestId: contestRunning.id, problemId: sampleProblem.id });
    await ContestModel.updateContestStatus(contestRunning.id, 'published');

    // Contest 5: Published Ended (Prof A)
    const contestEnded = await ContestModel.createContest({
      title: `Binary Search Sprint Ended ${timestamp}`,
      description: 'Historical search and divide-and-conquer exam',
      startTime: new Date(Date.now() - 7200000).toISOString(),
      endTime: new Date(Date.now() - 3600000).toISOString(),
      createdBy: profA.id,
      isRated: false,
    });
    testContests.push(contestEnded.id);
    await ContestModel.addProblemToContest({ contestId: contestEnded.id, problemId: sampleProblem.id });
    await ContestModel.updateContestStatus(contestEnded.id, 'published');

    assertTest(testContests.length === 5, '5 diverse test contests seeded');

    // -------------------------------------------------------------------------
    // 3. Testing RBAC & Privacy Protection (Draft Contests Isolation)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing RBAC & Privacy Protection ---');

    // Unauthenticated Guest: only published contests
    const guestRes = await request('GET', '/api/contests');
    assertTest(guestRes.status === 200, 'Guest can call GET /api/contests (200 OK)');
    const guestDrafts = (guestRes.body.contests || []).filter(c => c.status === 'draft');
    assertTest(guestDrafts.length === 0, 'Unauthenticated guest receives zero draft contests');

    // Student: only published contests
    const studentRes = await request('GET', '/api/contests', null, tokenStudent);
    assertTest(studentRes.status === 200, 'Student can call GET /api/contests (200 OK)');
    const studentDrafts = (studentRes.body.contests || []).filter(c => c.status === 'draft');
    assertTest(studentDrafts.length === 0, 'Student receives zero draft contests');

    // Student requesting status=draft explicitly: should return empty list
    const studentExplicitDraftRes = await request('GET', '/api/contests?status=draft', null, tokenStudent);
    assertTest(studentExplicitDraftRes.status === 200, 'Student requesting status=draft succeeds with 200');
    assertTest(studentExplicitDraftRes.body.count === 0 && studentExplicitDraftRes.body.contests.length === 0,
      'Student explicitly querying status=draft receives 0 contests');

    // Professor A: sees own drafts, but NOT Professor B's drafts
    const profARes = await request('GET', '/api/contests', null, tokenProfA);
    assertTest(profARes.status === 200, 'Professor A can call GET /api/contests (200 OK)');
    const profADrafts = (profARes.body.contests || []).filter(c => c.status === 'draft');
    const profAHasOwnDraft = profADrafts.some(c => c.id === contestProfADraft.id);
    const profAHasOtherDraft = profADrafts.some(c => c.id === contestProfBDraft.id);
    assertTest(profAHasOwnDraft, 'Professor A sees their own draft contest');
    assertTest(!profAHasOtherDraft, 'Professor A does NOT see Professor B draft contest (ownership isolation)');

    // Contest Admin: sees ALL drafts across professors
    const cAdminRes = await request('GET', '/api/contests', null, tokenContestAdmin);
    assertTest(cAdminRes.status === 200, 'Contest Admin can call GET /api/contests (200 OK)');
    const cAdminDrafts = (cAdminRes.body.contests || []).filter(c => c.status === 'draft');
    const cAdminHasBoth = cAdminDrafts.some(c => c.id === contestProfADraft.id) && cAdminDrafts.some(c => c.id === contestProfBDraft.id);
    assertTest(cAdminHasBoth, 'Contest Admin sees draft contests across all professors');

    // Super Admin: sees ALL drafts across professors
    const sAdminRes = await request('GET', '/api/contests', null, tokenSuperAdmin);
    assertTest(sAdminRes.status === 200, 'Super Admin can call GET /api/contests (200 OK)');
    const sAdminDrafts = (sAdminRes.body.contests || []).filter(c => c.status === 'draft');
    const sAdminHasBoth = sAdminDrafts.some(c => c.id === contestProfADraft.id) && sAdminDrafts.some(c => c.id === contestProfBDraft.id);
    assertTest(sAdminHasBoth, 'Super Admin sees draft contests across all professors');

    // -------------------------------------------------------------------------
    // 4. Testing Search Capabilities
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Search Capabilities ---');

    // Search by title keyword: "Quantum"
    const searchQuantumRes = await request('GET', '/api/contests?search=Quantum', null, tokenProfA);
    assertTest(searchQuantumRes.status === 200, 'Search by title keyword returns 200 OK');
    assertTest(searchQuantumRes.body.contests.some(c => c.id === contestProfADraft.id), 'Search matches contest title');

    // Case-insensitive search: "quantum" vs "QUANTUM"
    const searchLowerRes = await request('GET', '/api/contests?search=quantum', null, tokenProfA);
    const searchUpperRes = await request('GET', '/api/contests?search=QUANTUM', null, tokenProfA);
    assertTest(searchLowerRes.body.count === searchUpperRes.body.count, 'Search is case-insensitive');

    // Search by description keyword: "traversals"
    const searchDescRes = await request('GET', '/api/contests?search=traversals', null, tokenSuperAdmin);
    assertTest(searchDescRes.body.contests.some(c => c.id === contestUpcoming.id), 'Search matches description content');

    // Search by creator username
    const searchCreatorRes = await request('GET', `/api/contests?search=${profA.username}`, null, tokenSuperAdmin);
    assertTest(searchCreatorRes.body.contests.some(c => c.createdBy === profA.id), 'Search matches creator username');

    // Search by numeric ID directly
    const searchIdRes = await request('GET', `/api/contests?search=${contestRunning.id}`, null, tokenSuperAdmin);
    assertTest(searchIdRes.body.contests.some(c => c.id === contestRunning.id), 'Search matches exact numeric ID');

    // Search with special characters (safe execution, no SQL injection)
    const searchSpecialRes = await request('GET', '/api/contests?search=%27%20OR%201=1;%20--', null, tokenSuperAdmin);
    assertTest(searchSpecialRes.status === 200, 'Search with SQL injection attempt executes safely without error');
    assertTest(Array.isArray(searchSpecialRes.body.contests), 'Returns array of results safely');

    // -------------------------------------------------------------------------
    // 5. Testing Filters
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Contest Filters ---');

    // Filter by status=published
    const filterPubRes = await request('GET', '/api/contests?status=published', null, tokenSuperAdmin);
    assertTest(filterPubRes.status === 200, 'Filter status=published returns 200');
    assertTest(filterPubRes.body.contests.every(c => c.status === 'published'), 'All returned contests have status=published');

    // Filter by runtime state: upcoming
    const filterUpcomingRes = await request('GET', '/api/contests?state=upcoming', null, tokenSuperAdmin);
    assertTest(filterUpcomingRes.status === 200, 'Filter state=upcoming returns 200');
    assertTest(filterUpcomingRes.body.contests.some(c => c.id === contestUpcoming.id), 'Matches upcoming contest fixture');
    assertTest(filterUpcomingRes.body.contests.every(c => c.runtimeState === 'upcoming'), 'All returned contests have runtimeState=upcoming');

    // Filter by runtime state: running
    const filterRunningRes = await request('GET', '/api/contests?state=running', null, tokenSuperAdmin);
    assertTest(filterRunningRes.status === 200, 'Filter state=running returns 200');
    assertTest(filterRunningRes.body.contests.some(c => c.id === contestRunning.id), 'Matches running contest fixture');
    assertTest(filterRunningRes.body.contests.every(c => c.runtimeState === 'running'), 'All returned contests have runtimeState=running');

    // Filter by runtime state: ended
    const filterEndedRes = await request('GET', '/api/contests?state=ended', null, tokenSuperAdmin);
    assertTest(filterEndedRes.status === 200, 'Filter state=ended returns 200');
    assertTest(filterEndedRes.body.contests.some(c => c.id === contestEnded.id), 'Matches ended contest fixture');
    assertTest(filterEndedRes.body.contests.every(c => c.runtimeState === 'ended'), 'All returned contests have runtimeState=ended');

    // Filter by isRated=true
    const filterRatedRes = await request('GET', '/api/contests?isRated=true', null, tokenSuperAdmin);
    assertTest(filterRatedRes.status === 200, 'Filter isRated=true returns 200');
    assertTest(filterRatedRes.body.contests.every(c => c.isRated === true), 'All returned contests have isRated=true');

    // Filter by isRated=false
    const filterUnratedRes = await request('GET', '/api/contests?isRated=false', null, tokenSuperAdmin);
    assertTest(filterUnratedRes.status === 200, 'Filter isRated=false returns 200');
    assertTest(filterUnratedRes.body.contests.every(c => c.isRated === false), 'All returned contests have isRated=false');

    // Filter by createdBy
    const filterOwnerRes = await request('GET', `/api/contests?createdBy=${profA.id}`, null, tokenSuperAdmin);
    assertTest(filterOwnerRes.status === 200, 'Filter createdBy returns 200');
    assertTest(filterOwnerRes.body.contests.every(c => c.createdBy === profA.id), 'All returned contests belong to specified createdBy');

    // -------------------------------------------------------------------------
    // 6. Testing Sorting
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Sorting Capabilities ---');

    // Sort by startTime ASC
    const sortStartAsc = await request('GET', '/api/contests?sortBy=startTime&sortOrder=ASC&limit=20', null, tokenSuperAdmin);
    assertTest(sortStartAsc.status === 200, 'Sort by startTime ASC returns 200');
    const startDates = sortStartAsc.body.contests.map(c => new Date(c.startTime).getTime());
    let isAsc = true;
    for (let i = 1; i < startDates.length; i++) {
      if (startDates[i] < startDates[i - 1]) isAsc = false;
    }
    assertTest(isAsc, 'Timestamps correctly ordered ascending');

    // Sort by title ASC
    const sortTitleAsc = await request('GET', '/api/contests?sortBy=title&sortOrder=ASC&limit=20', null, tokenSuperAdmin);
    assertTest(sortTitleAsc.status === 200, 'Sort by title ASC returns 200');
    const titles = sortTitleAsc.body.contests.map(c => (c.title || '').toLowerCase());
    let isTitleAsc = true;
    for (let i = 1; i < titles.length; i++) {
      if (titles[i].localeCompare(titles[i - 1]) < 0) isTitleAsc = false;
    }
    assertTest(isTitleAsc, 'Titles correctly ordered alphabetically ascending');

    // Injected invalid sort field: safely falls back to default
    const sortInvalidRes = await request('GET', '/api/contests?sortBy=non_existent_column;DROP%20TABLE;--', null, tokenSuperAdmin);
    assertTest(sortInvalidRes.status === 200, 'Arbitrary sort field safely sanitized against SQL injection');

    // -------------------------------------------------------------------------
    // 7. Testing Server-Side Pagination
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Server-Side Pagination ---');

    const page1Res = await request('GET', '/api/contests?page=1&limit=2', null, tokenSuperAdmin);
    assertTest(page1Res.status === 200, 'Page 1 returns 200 OK');
    assertTest(page1Res.body.page === 1, 'Response indicates page 1');
    assertTest(page1Res.body.limit === 2, 'Response indicates limit 2');
    assertTest(page1Res.body.contests.length <= 2, 'Returns at most 2 items');
    assertTest(page1Res.body.total >= 5, 'Total count reflects all matching contests');
    assertTest(page1Res.body.totalPages === Math.ceil(page1Res.body.total / 2), 'totalPages is calculated correctly');

    const page2Res = await request('GET', '/api/contests?page=2&limit=2', null, tokenSuperAdmin);
    assertTest(page2Res.status === 200, 'Page 2 returns 200 OK');
    assertTest(page2Res.body.page === 2, 'Response indicates page 2');
    if (page1Res.body.contests.length > 0 && page2Res.body.contests.length > 0) {
      assertTest(page1Res.body.contests[0].id !== page2Res.body.contests[0].id, 'Page 2 contains distinct items from Page 1');
    }

    // Excessive limit clamped to 100
    const clampedLimitRes = await request('GET', '/api/contests?limit=5000', null, tokenSuperAdmin);
    assertTest(clampedLimitRes.body.limit === 100, 'Excessive limit clamped safely to max 100');

    // -------------------------------------------------------------------------
    // 8. Testing Empty Results & Edge Cases
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Empty Results & Query Resilience ---');

    const emptySearchRes = await request('GET', '/api/contests?search=UNLIKELY_NON_EXISTENT_MATCH_XYZ_752', null, tokenSuperAdmin);
    assertTest(emptySearchRes.status === 200, 'Empty search returns 200 OK');
    assertTest(emptySearchRes.body.count === 0, 'count is 0');
    assertTest(emptySearchRes.body.total === 0, 'total is 0');
    assertTest(emptySearchRes.body.totalPages === 0, 'totalPages is 0');
    assertTest(Array.isArray(emptySearchRes.body.contests) && emptySearchRes.body.contests.length === 0, 'contests is empty array');

    // Page beyond total pages
    const beyondPageRes = await request('GET', '/api/contests?page=999&limit=10', null, tokenSuperAdmin);
    assertTest(beyondPageRes.status === 200, 'Out-of-range page returns 200 OK');
    assertTest(beyondPageRes.body.contests.length === 0, 'Returns empty contests array for out-of-range page');
    assertTest(beyondPageRes.body.total >= 5, 'Total count still accurately reported');

    // -------------------------------------------------------------------------
    // 9. Testing Payload Structure & Metadata Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Payload Structure & Metadata Integrity ---');

    const sampleContest = filterRunningRes.body.contests.find(c => c.id === contestRunning.id);
    assertTest(sampleContest !== undefined, 'Found sample running contest in response');
    if (sampleContest) {
      assertTest(typeof sampleContest.id === 'number', 'Contest ID is a number');
      assertTest(typeof sampleContest.title === 'string', 'Title is a string');
      assertTest(typeof sampleContest.startTime === 'string', 'startTime is camelCase string');
      assertTest(typeof sampleContest.endTime === 'string', 'endTime is camelCase string');
      assertTest(sampleContest.status === 'published', 'status is published');
      assertTest(sampleContest.runtimeState === 'running', 'runtimeState is calculated as running');
      assertTest(sampleContest.isRated === true, 'isRated is boolean');
      assertTest(typeof sampleContest.problemCount === 'number', 'problemCount is integer number');
      assertTest(typeof sampleContest.participantCount === 'number', 'participantCount is integer number');
      assertTest(sampleContest.creatorUsername === profB.username, 'creatorUsername matches creator');
    }

  } catch (err) {
    failed++;
    console.error('[UNEXPECTED ERROR IN TEST SUITE]:', err);
  } finally {
    // -------------------------------------------------------------------------
    // 10. Cleaning Up Ephemeral Test Fixtures
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Cleaning Up Ephemeral Test Fixtures ---');
    try {
      if (testContests.length > 0) {
        await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [testContests]);
        await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [testContests]);
        await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [testContests]);
      }
      if (testProblems.length > 0) {
        await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [testProblems]);
        await db.query('DELETE FROM problems WHERE id = ANY($1::int[])', [testProblems]);
      }
      if (testUsers.length > 0) {
        await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [testUsers]);
      }
      console.log('[PASS] Test fixtures safely purged from database');
    } catch (cleanupErr) {
      console.error('[CLEANUP ERROR]:', cleanupErr.message);
    }

    if (server) {
      server.close();
    }
    await db.closePool();

    console.log('\n=======================================================');
    console.log(` PHASE 7.5.2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
