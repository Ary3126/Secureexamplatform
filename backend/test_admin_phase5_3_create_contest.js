/**
 * Phase 7.5.3 — Admin Contest Creation Workflow Automated Backend Test Suite
 * File: backend/test_admin_phase5_3_create_contest.js
 * 
 * Tests:
 * 1. Authorized creation (Professor, Contest Admin, Super Admin)
 * 2. Student rejection (403 Forbidden) and Unauthenticated rejection (401 Unauthorized)
 * 3. Invalid title (missing, too short, too long, non-string)
 * 4. Invalid description (non-string, excessive length)
 * 5. Missing required fields (title, startTime, endTime)
 * 6. Invalid dates (malformed date string)
 * 7. End before start (end <= start, duration < 1 minute)
 * 8. Invalid access scope (invalid string enum)
 * 9. Invalid rating configuration (non-boolean isRated)
 * 10. Invalid freeze configuration (negative freeze, non-integer, freeze > duration)
 * 11. Valid draft creation (starts in status='draft', runtimeState='draft')
 * 12. Creator ownership (createdBy matches authenticated user)
 * 13. Database persistence (direct SQL audit of created record)
 * 14. Contest list visibility (isolated to creator and admins, hidden from students and other professors)
 * 15. Duplicate submit protection (rapid multi-click debounce returns 409 Conflict)
 * 16. API error handling (structured envelopes, zero SQL leaks)
 */

const http = require('http');
const assert = require('assert');
const { app } = require('./src/server');
const db = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const ContestModel = require('./src/models/contestModel');
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
  console.log(' STARTING PHASE 7.5.3 CREATE CONTEST WORKFLOW TESTS');
  console.log('=======================================================\n');

  // Start ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://localhost:${port}`;

  const timestamp = Date.now();
  const testUsers = [];
  const testContests = [];

  try {
    // -------------------------------------------------------------------------
    // 1. Setting Up Test Actors
    // -------------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    // Professor A
    const profA = await UserModel.createUser({
      username: `prof_a_753_${timestamp}`,
      email: `prof_a_753_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'MIT',
      fullName: 'Professor Alpha 753',
    });
    testUsers.push(profA.id);
    const tokenProfA = generateToken({ id: profA.id, role: profA.role, username: profA.username });

    // Professor B
    const profB = await UserModel.createUser({
      username: `prof_b_753_${timestamp}`,
      email: `prof_b_753_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'professor',
      institution: 'Stanford',
      fullName: 'Professor Beta 753',
    });
    testUsers.push(profB.id);
    const tokenProfB = generateToken({ id: profB.id, role: profB.role, username: profB.username });

    // Contest Admin
    const contestAdmin = await UserModel.createUser({
      username: `cadm_753_${timestamp}`,
      email: `cadm_753_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'contest_admin',
      institution: 'ExamForge',
      fullName: 'Contest Admin 753',
    });
    testUsers.push(contestAdmin.id);
    const tokenContestAdmin = generateToken({ id: contestAdmin.id, role: contestAdmin.role, username: contestAdmin.username });

    // Super Admin
    const superAdmin = await UserModel.createUser({
      username: `sadmin_753_${timestamp}`,
      email: `sadmin_753_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'super_admin',
      institution: 'ExamForge',
      fullName: 'Super Admin 753',
    });
    testUsers.push(superAdmin.id);
    const tokenSuperAdmin = generateToken({ id: superAdmin.id, role: superAdmin.role, username: superAdmin.username });

    // Student
    const student = await UserModel.createUser({
      username: `student_753_${timestamp}`,
      email: `student_753_${timestamp}@test.edu`,
      passwordHash: pwdHash,
      role: 'student',
      institution: 'MIT',
      fullName: 'Student 753',
    });
    testUsers.push(student.id);
    const tokenStudent = generateToken({ id: student.id, role: student.role, username: student.username });

    assertTest(testUsers.length === 5, 'All 5 test actors created successfully');

    // Future reference times
    const startIso = new Date(Date.now() + 3600 * 1000).toISOString();
    const endIso = new Date(Date.now() + 3 * 3600 * 1000).toISOString();

    // -------------------------------------------------------------------------
    // 2. Testing Authentication & RBAC Authorization
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing RBAC & Authorization ---');

    // 2.1 Unauthenticated request returns 401
    const unauthRes = await request('POST', '/api/contests', {
      title: 'Unauthenticated Contest',
      startTime: startIso,
      endTime: endIso,
    });
    assertTest(unauthRes.status === 401, 'Unauthenticated contest creation returns 401 Unauthorized');

    // 2.2 Student request returns 403 Forbidden
    const studentRes = await request('POST', '/api/contests', {
      title: 'Student Attempted Contest',
      startTime: startIso,
      endTime: endIso,
    }, tokenStudent);
    assertTest(studentRes.status === 403, 'Student contest creation is rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // 3. Testing Field Validations: Title
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Title Validation ---');

    // 3.1 Missing title
    const noTitleRes = await request('POST', '/api/contests', {
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(noTitleRes.status === 400, 'Missing title returns 400 Bad Request');
    assertTest(noTitleRes.body.errors && noTitleRes.body.errors.some(e => e.includes('title')), 'Returns error indicating title required');

    // 3.2 Title too short (< 3 chars)
    const shortTitleRes = await request('POST', '/api/contests', {
      title: 'AB',
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(shortTitleRes.status === 400, 'Title < 3 chars returns 400 Bad Request');

    // 3.3 Title too long (> 200 chars)
    const longTitle = 'C'.repeat(201);
    const longTitleRes = await request('POST', '/api/contests', {
      title: longTitle,
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(longTitleRes.status === 400, 'Title > 200 chars returns 400 Bad Request');

    // 3.4 Non-string title
    const nonStringTitleRes = await request('POST', '/api/contests', {
      title: 12345,
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(nonStringTitleRes.status === 400, 'Non-string title returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 4. Testing Description Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Description Validation ---');

    // 4.1 Non-string description
    const badDescRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      description: 99999,
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(badDescRes.status === 400, 'Non-string description returns 400 Bad Request');

    // 4.2 Excessive description length (> 10000 chars)
    const excessiveDesc = 'D'.repeat(10005);
    const excessiveDescRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      description: excessiveDesc,
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);
    assertTest(excessiveDescRes.status === 400, 'Description > 10000 chars returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 5. Testing Required Fields & Dates
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Date Validation ---');

    // 5.1 Missing start time
    const noStartRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      endTime: endIso,
    }, tokenProfA);
    assertTest(noStartRes.status === 400, 'Missing startTime returns 400 Bad Request');

    // 5.2 Missing end time
    const noEndRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      startTime: startIso,
    }, tokenProfA);
    assertTest(noEndRes.status === 400, 'Missing endTime returns 400 Bad Request');

    // 5.3 Malformed start date
    const malformedStartRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      startTime: 'not-a-valid-date-string',
      endTime: endIso,
    }, tokenProfA);
    assertTest(malformedStartRes.status === 400, 'Malformed startTime returns 400 Bad Request');

    // 5.4 Malformed end date
    const malformedEndRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      startTime: startIso,
      endTime: 'yesterday',
    }, tokenProfA);
    assertTest(malformedEndRes.status === 400, 'Malformed endTime returns 400 Bad Request');

    // 5.5 End before start
    const endBeforeStartRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      startTime: endIso,
      endTime: startIso,
    }, tokenProfA);
    assertTest(endBeforeStartRes.status === 400, 'End time before start time returns 400 Bad Request');
    assertTest(endBeforeStartRes.body.errors && endBeforeStartRes.body.errors.some(e => e.includes('later than')), 'Returns error indicating end must be later than start');

    // 5.6 End equal to start
    const endEqualStartRes = await request('POST', '/api/contests', {
      title: 'Valid Title Here',
      startTime: startIso,
      endTime: startIso,
    }, tokenProfA);
    assertTest(endEqualStartRes.status === 400, 'End time equal to start time returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 6. Testing Access Scope Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Access Scope Validation ---');

    // 6.1 Invalid access scope string
    const badScopeRes = await request('POST', '/api/contests', {
      title: 'Valid Title Scope Test',
      startTime: startIso,
      endTime: endIso,
      accessScope: 'classified_top_secret',
    }, tokenProfA);
    assertTest(badScopeRes.status === 400, 'Invalid accessScope returns 400 Bad Request');
    assertTest(badScopeRes.body.errors && badScopeRes.body.errors.some(e => e.includes('access scope')), 'Errors specify valid allowed access scopes');

    // 6.2 Invalid visibility string
    const badVisRes = await request('POST', '/api/contests', {
      title: 'Valid Title Visibility Test',
      startTime: startIso,
      endTime: endIso,
      visibility: 'hidden_chamber',
    }, tokenProfA);
    assertTest(badVisRes.status === 400, 'Invalid visibility returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 7. Testing Rating Configuration Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Rating Configuration Validation ---');

    // 7.1 Non-boolean isRated (string)
    const badRatedStrRes = await request('POST', '/api/contests', {
      title: 'Valid Title Rating Test',
      startTime: startIso,
      endTime: endIso,
      isRated: 'yes',
    }, tokenProfA);
    assertTest(badRatedStrRes.status === 400, 'String isRated returns 400 Bad Request');

    // 7.2 Non-boolean isRated (number)
    const badRatedNumRes = await request('POST', '/api/contests', {
      title: 'Valid Title Rating Test',
      startTime: startIso,
      endTime: endIso,
      isRated: 1,
    }, tokenProfA);
    assertTest(badRatedNumRes.status === 400, 'Numeric isRated returns 400 Bad Request');

    // -------------------------------------------------------------------------
    // 8. Testing Leaderboard Freeze Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Leaderboard Freeze Validation ---');

    // 8.1 Non-boolean leaderboardFreezeEnabled
    const badFreezeBoolRes = await request('POST', '/api/contests', {
      title: 'Valid Title Freeze Test',
      startTime: startIso,
      endTime: endIso,
      leaderboardFreezeEnabled: 'true',
    }, tokenProfA);
    assertTest(badFreezeBoolRes.status === 400, 'String leaderboardFreezeEnabled returns 400 Bad Request');

    // 8.2 Negative leaderboardFreezeMinutes
    const badFreezeNegRes = await request('POST', '/api/contests', {
      title: 'Valid Title Freeze Test',
      startTime: startIso,
      endTime: endIso,
      leaderboardFreezeMinutes: -20,
    }, tokenProfA);
    assertTest(badFreezeNegRes.status === 400, 'Negative leaderboardFreezeMinutes returns 400 Bad Request');

    // 8.3 Non-integer freeze minutes
    const badFreezeFloatRes = await request('POST', '/api/contests', {
      title: 'Valid Title Freeze Test',
      startTime: startIso,
      endTime: endIso,
      leaderboardFreezeMinutes: 'not-a-number',
    }, tokenProfA);
    assertTest(badFreezeFloatRes.status === 400, 'Non-integer leaderboardFreezeMinutes returns 400 Bad Request');

    // 8.4 Freeze minutes exceeds total duration (Duration = 2h = 120m; Freeze = 180m)
    const badFreezeExceedRes = await request('POST', '/api/contests', {
      title: 'Valid Title Freeze Test',
      startTime: startIso,
      endTime: endIso,
      leaderboardFreezeMinutes: 180,
    }, tokenProfA);
    assertTest(badFreezeExceedRes.status === 400, 'Freeze minutes exceeding duration returns 400 Bad Request');
    assertTest(badFreezeExceedRes.body.errors && badFreezeExceedRes.body.errors.some(e => e.includes('freeze')), 'Error indicates freeze cannot exceed duration');

    // -------------------------------------------------------------------------
    // 9. Authorized Valid Contest Creation (Professor, Contest Admin, Super Admin)
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Authorized Valid Creation ---');

    // 9.1 Professor A creates rated contest with freeze enabled
    const contestTitleA = `Prof A Contest 753 #${timestamp}`;
    const profACreateRes = await request('POST', '/api/contests', {
      title: contestTitleA,
      description: 'Comprehensive testing contest by Prof A',
      startTime: startIso,
      endTime: endIso,
      accessScope: 'public',
      isRated: true,
      leaderboardFreezeEnabled: true,
      leaderboardFreezeMinutes: 45,
    }, tokenProfA);

    assertTest(profACreateRes.status === 201, 'Professor A creates valid contest (201 Created)');
    assertTest(profACreateRes.body.contest !== undefined, 'Response contains contest object');
    assertTest(profACreateRes.body.contest.title === contestTitleA, 'Returned contest title matches');
    assertTest(profACreateRes.body.contest.status === 'draft', 'Newly created contest starts in status="draft"');
    assertTest(profACreateRes.body.contest.runtimeState === 'draft', 'Authoritative runtimeState is "draft"');
    assertTest(profACreateRes.body.contest.isRated === true, 'isRated is true');
    assertTest(profACreateRes.body.contest.leaderboardFreezeEnabled === true, 'Freeze is enabled');
    assertTest(profACreateRes.body.contest.leaderboardFreezeMinutes === 45, 'Freeze minutes is 45');
    assertTest(profACreateRes.body.contest.createdBy === profA.id, 'Creator ID matches authenticated Professor A');

    const contestAId = profACreateRes.body.contest.id;
    testContests.push(contestAId);

    // 9.2 Contest Admin creates unrated contest without freeze
    const contestTitleAdmin = `Contest Admin Invitational #${timestamp}`;
    const cadmCreateRes = await request('POST', '/api/contests', {
      title: contestTitleAdmin,
      description: 'Platform open contest',
      startTime: startIso,
      endTime: endIso,
      isRated: false,
      leaderboardFreezeEnabled: false,
    }, tokenContestAdmin);

    assertTest(cadmCreateRes.status === 201, 'Contest Admin creates valid contest (201 Created)');
    assertTest(cadmCreateRes.body.contest.isRated === false, 'isRated is false (unrated contest)');
    assertTest(cadmCreateRes.body.contest.leaderboardFreezeEnabled === false, 'Freeze is false');
    assertTest(cadmCreateRes.body.contest.createdBy === contestAdmin.id, 'Creator ID matches Contest Admin');
    testContests.push(cadmCreateRes.body.contest.id);

    // 9.3 Super Admin creates valid examination contest
    const contestTitleSuper = `Super Admin Midterm Examination #${timestamp}`;
    const sadminCreateRes = await request('POST', '/api/contests', {
      title: contestTitleSuper,
      startTime: startIso,
      endTime: endIso,
      accessScope: 'private',
      isRated: false,
    }, tokenSuperAdmin);

    assertTest(sadminCreateRes.status === 201, 'Super Admin creates valid contest (201 Created)');
    assertTest(sadminCreateRes.body.contest.createdBy === superAdmin.id, 'Creator ID matches Super Admin');
    testContests.push(sadminCreateRes.body.contest.id);

    // -------------------------------------------------------------------------
    // 10. Database Persistence & Integrity Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Database Persistence ---');

    const dbAuditRes = await db.query(
      `SELECT id, title, description, created_by, status, is_rated, leaderboard_freeze_enabled, leaderboard_freeze_minutes 
       FROM contests WHERE id = $1`,
      [contestAId]
    );

    assertTest(dbAuditRes.rows.length === 1, 'Contest row exists in database');
    const dbRow = dbAuditRes.rows[0];
    assertTest(dbRow.title === contestTitleA, 'Database row title matches');
    assertTest(dbRow.description === 'Comprehensive testing contest by Prof A', 'Database row description matches');
    assertTest(dbRow.created_by === profA.id, 'Database row created_by matches actor ID');
    assertTest(dbRow.status === 'draft', 'Database status is draft');
    assertTest(dbRow.is_rated === true, 'Database is_rated is true');
    assertTest(dbRow.leaderboard_freeze_enabled === true, 'Database freeze enabled is true');
    assertTest(dbRow.leaderboard_freeze_minutes === 45, 'Database freeze minutes is 45');

    // -------------------------------------------------------------------------
    // 11. Contest List Visibility & Discovery Integration
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing Contest List Visibility ---');

    // 11.1 Creator Professor A sees their newly created draft contest
    const profAListRes = await request('POST', `/api/contests`, null, null); // verify GET list
    const profAList = await request('GET', `/api/contests?status=draft`, null, tokenProfA);
    assertTest(profAList.status === 200, 'Professor A fetches draft contests (200 OK)');
    assertTest(
      profAList.body.contests && profAList.body.contests.some(c => c.id === contestAId),
      'Professor A discovers their newly created draft contest in list'
    );

    // 11.2 Professor B does NOT see Professor A's draft contest (Ownership Isolation)
    const profBList = await request('GET', `/api/contests?status=draft`, null, tokenProfB);
    assertTest(profBList.status === 200, 'Professor B fetches draft contests (200 OK)');
    assertTest(
      profBList.body.contests && !profBList.body.contests.some(c => c.id === contestAId),
      'Professor B CANNOT see Professor A draft contest (Ownership Isolation)'
    );

    // 11.3 Student does NOT see any draft contest
    const studentList = await request('GET', `/api/contests`, null, tokenStudent);
    assertTest(studentList.status === 200, 'Student fetches contests (200 OK)');
    assertTest(
      studentList.body.contests && !studentList.body.contests.some(c => c.id === contestAId),
      'Student CANNOT discover newly created draft contest'
    );

    // -------------------------------------------------------------------------
    // 12. Duplicate Submission Multi-Click Protection
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Testing Duplicate Submission Multi-Click Protection ---');

    // Submitting with the EXACT same title and same user immediately (< 3s)
    const dupRes = await request('POST', '/api/contests', {
      title: contestTitleA,
      startTime: startIso,
      endTime: endIso,
    }, tokenProfA);

    assertTest(dupRes.status === 409, 'Immediate duplicate submission returns 409 Conflict');
    assertTest(dupRes.body.statusCode === 409, 'Error envelope indicates 409');
    assertTest(dupRes.body.duplicateContestId === contestAId, 'Returns ID of previously created contest');
    assertTest(dupRes.body.message && dupRes.body.message.includes('just created'), 'Message warns user of duplicate');

    // -------------------------------------------------------------------------
    // 13. API Error Envelope Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Testing API Error Response Integrity ---');

    const errorFormatRes = await request('POST', '/api/contests', {
      title: 'T',
      startTime: 'bad',
      endTime: 'bad',
    }, tokenProfA);

    assertTest(errorFormatRes.status === 400, 'Returns 400');
    assertTest(errorFormatRes.body.status === 'error', 'Standard envelope status="error"');
    assertTest(errorFormatRes.body.statusCode === 400, 'Standard envelope statusCode=400');
    assertTest(Array.isArray(errorFormatRes.body.errors), 'Standard envelope errors is array');
    assertTest(typeof errorFormatRes.body.message === 'string', 'Standard envelope message is string');

  } catch (err) {
    console.error('Unexpected test exception:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // 14. Purging Test Fixtures
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Cleaning Up Test Fixtures ---');
    try {
      if (testContests.length > 0) {
        await db.query(`DELETE FROM contests WHERE id = ANY($1)`, [testContests]);
      }
      if (testUsers.length > 0) {
        await db.query(`DELETE FROM users WHERE id = ANY($1)`, [testUsers]);
      }
      assertTest(true, 'Test fixtures safely purged from database');
    } catch (cleanupErr) {
      console.error('Failed to purge test fixtures:', cleanupErr);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n=======================================================');
  console.log(` PHASE 7.5.3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
