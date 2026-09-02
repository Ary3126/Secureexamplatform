const http = require('http');
const { app } = require('./src/server');
const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');
const { generateToken } = require('./src/services/authService');

const PORT = 5002;
let serverInstance;

// Helper to make HTTP requests
const request = (options, postData = null) => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
};

const runTests = async () => {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 3 AUTOMATED TEST SUITE');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, testName, details = '') => {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  };

  const baseHeaders = { 'Content-Type': 'application/json' };

  try {
    // ----------------------------------------------------
    // SETUP TEST USERS
    // ----------------------------------------------------
    await query("DELETE FROM users WHERE email LIKE '%@p3test.com'");

    const studentUser = await UserModel.createUser({
      username: 'p3_student',
      email: 'student@p3test.com',
      passwordHash: 'dummy_hash',
      fullName: 'P3 Student',
      role: 'student',
    });
    const studentToken = generateToken(studentUser);

    const profAUser = await UserModel.createUser({
      username: 'p3_prof_a',
      email: 'profa@p3test.com',
      passwordHash: 'dummy_hash',
      fullName: 'Professor A',
      role: 'professor',
    });
    const profAToken = generateToken(profAUser);

    const profBUser = await UserModel.createUser({
      username: 'p3_prof_b',
      email: 'profb@p3test.com',
      passwordHash: 'dummy_hash',
      fullName: 'Professor B',
      role: 'professor',
    });
    const profBToken = generateToken(profBUser);

    const contestAdminUser = await UserModel.createUser({
      username: 'p3_contest_admin',
      email: 'admin@p3test.com',
      passwordHash: 'dummy_hash',
      fullName: 'Contest Admin',
      role: 'contest_admin',
    });
    const contestAdminToken = generateToken(contestAdminUser);

    const superAdminUser = await UserModel.createUser({
      username: 'p3_super_admin',
      email: 'super@p3test.com',
      passwordHash: 'dummy_hash',
      fullName: 'Super Admin',
      role: 'super_admin',
    });
    const superAdminToken = generateToken(superAdminUser);

    // ----------------------------------------------------
    // 1. PROBLEM MANAGEMENT TESTS
    // ----------------------------------------------------
    console.log('\n--- 1. Problem Management Tests ---');

    // 1.1 Student cannot create problem -> 403
    const probRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/problems',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
      },
      {
        title: 'Two Sum',
        description: 'Find two indices that sum up to target',
        difficulty: 'easy',
      }
    );
    assert(probRes1.status === 403, 'Student cannot create problem (403 Forbidden)', JSON.stringify(probRes1.body));

    // 1.2 Professor A creates problem -> 201
    const probRes2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/problems',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Two Sum',
        description: 'Find two indices that sum up to target',
        difficulty: 'easy',
      }
    );
    assert(probRes2.status === 201, 'Professor creates problem (201 Created)', JSON.stringify(probRes2.body));
    const problemAId = probRes2.body.problem.id;

    // 1.3 Invalid difficulty -> 400
    const probRes3 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/problems',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Invalid Diff Problem',
        description: 'Some problem description',
        difficulty: 'super_hard',
      }
    );
    assert(probRes3.status === 400, 'Invalid difficulty returns 400 Bad Request', JSON.stringify(probRes3.body));

    // 1.4 Professor A updates own problem -> 200
    const probRes4 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/problems/${problemAId}`,
        method: 'PUT',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Two Sum Optimized',
        difficulty: 'medium',
      }
    );
    assert(probRes4.status === 200, 'Professor A updates own problem (200 OK)', JSON.stringify(probRes4.body));

    // 1.5 Professor B cannot update Professor A problem -> 403
    const probRes5 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/problems/${problemAId}`,
        method: 'PUT',
        headers: { ...baseHeaders, Authorization: `Bearer ${profBToken}` },
      },
      {
        title: 'Hacked Title',
      }
    );
    assert(probRes5.status === 403, 'Professor B cannot update Professor A problem (403 Forbidden)', JSON.stringify(probRes5.body));

    // ----------------------------------------------------
    // 2. CONTEST CREATION & OWNERSHIP TESTS
    // ----------------------------------------------------
    console.log('\n--- 2. Contest Creation & Ownership Tests ---');

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const dayAfterTomorrow = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    // 2.1 Student cannot create contest -> 403
    const contestRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
      },
      {
        title: 'Student Contest',
        description: 'Not allowed',
        startTime: tomorrow,
        endTime: dayAfterTomorrow,
      }
    );
    assert(contestRes1.status === 403, 'Student cannot create contest (403 Forbidden)', JSON.stringify(contestRes1.body));

    // 2.2 Invalid times (end before start) -> 400
    const contestRes2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Invalid Times Contest',
        startTime: dayAfterTomorrow,
        endTime: tomorrow,
      }
    );
    assert(contestRes2.status === 400, 'End time before start time returns 400 Bad Request', JSON.stringify(contestRes2.body));

    // 2.3 Professor A creates contest -> 201 (draft)
    const contestRes3 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'DSA Sprint #1 by Prof A',
        description: 'Weekly algorithm challenge',
        startTime: tomorrow,
        endTime: dayAfterTomorrow,
      }
    );
    assert(contestRes3.status === 201, 'Professor A creates contest (201 Created)', JSON.stringify(contestRes3.body));
    assert(contestRes3.body.contest.status === 'draft', 'New contest status defaults to draft');
    const contestAId = contestRes3.body.contest.id;

    // 2.4 Professor A updates own contest -> 200
    const contestRes4 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}`,
        method: 'PUT',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'DSA Sprint #1 (Updated Title)',
      }
    );
    assert(contestRes4.status === 200, 'Professor A updates own contest (200 OK)', JSON.stringify(contestRes4.body));

    // 2.5 Professor B cannot update Professor A contest -> 403
    const contestRes5 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}`,
        method: 'PUT',
        headers: { ...baseHeaders, Authorization: `Bearer ${profBToken}` },
      },
      {
        title: 'Hacked Contest Title',
      }
    );
    assert(contestRes5.status === 403, 'Professor B cannot update Professor A contest (403 Forbidden)', JSON.stringify(contestRes5.body));

    // 2.6 Contest Admin can create contest -> 201
    const contestRes6 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${contestAdminToken}` },
      },
      {
        title: 'Official Contest by Contest Admin',
        startTime: tomorrow,
        endTime: dayAfterTomorrow,
      }
    );
    assert(contestRes6.status === 201, 'Contest Admin creates contest (201 Created)', JSON.stringify(contestRes6.body));

    // ----------------------------------------------------
    // 3. PROBLEM ATTACHMENT & PUBLISHING TESTS
    // ----------------------------------------------------
    console.log('\n--- 3. Problem Attachment & Publishing Tests ---');

    // 3.1 Cannot publish contest without problems -> 400
    const pubRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/publish`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
    });
    assert(pubRes1.status === 400, 'Publishing contest without problems fails (400 Bad Request)', JSON.stringify(pubRes1.body));

    // 3.2 Student cannot attach problem -> 403
    const attachRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
      },
      {
        problemId: problemAId,
        problemOrder: 1,
        points: 100,
      }
    );
    assert(attachRes1.status === 403, 'Student cannot attach problem (403 Forbidden)', JSON.stringify(attachRes1.body));

    // 3.3 Professor B cannot attach problem to Professor A contest -> 403
    const attachRes2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profBToken}` },
      },
      {
        problemId: problemAId,
        problemOrder: 1,
        points: 100,
      }
    );
    assert(attachRes2.status === 403, 'Professor B cannot attach problem to Professor A contest (403 Forbidden)', JSON.stringify(attachRes2.body));

    // 3.4 Professor A attaches problem -> 201
    const attachRes3 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        problemId: problemAId,
        problemOrder: 1,
        points: 100,
      }
    );
    assert(attachRes3.status === 201, 'Professor A attaches problem to contest (201 Created)', JSON.stringify(attachRes3.body));

    // 3.5 Duplicate problem attachment rejected -> 409
    const attachRes4 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${contestAId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        problemId: problemAId,
        problemOrder: 2,
        points: 100,
      }
    );
    assert(attachRes4.status === 409, 'Duplicate problem assignment returns 409 Conflict', JSON.stringify(attachRes4.body));

    // 3.6 Professor A publishes contest with problem -> 200
    const pubRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/publish`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
    });
    assert(pubRes2.status === 200, 'Publishing contest with problem succeeds (200 OK)', JSON.stringify(pubRes2.body));
    assert(pubRes2.body.contest.status === 'published', 'Contest status is updated to published');

    // ----------------------------------------------------
    // 4. CONTEST LIFECYCLE & STATE TESTS
    // ----------------------------------------------------
    console.log('\n--- 4. Contest Lifecycle & State Tests ---');

    // 4.1 Upcoming contest check
    assert(pubRes2.body.contest.runtimeState === 'upcoming', 'Contest scheduled for tomorrow calculates runtimeState: upcoming');

    // Create a running contest (started 1 hour ago, ends in 2 hours)
    const runningStart = new Date(Date.now() - 3600 * 1000).toISOString();
    const runningEnd = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const runningContestRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Active Live Contest',
        startTime: runningStart,
        endTime: runningEnd,
      }
    );
    const runningContestId = runningContestRes.body.contest.id;
    await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${runningContestId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      { problemId: problemAId, points: 50 }
    );
    const pubRunningRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${runningContestId}/publish`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
    });
    assert(pubRunningRes.body.contest.runtimeState === 'running', 'Contest during active window calculates runtimeState: running');

    // Create an ended contest (started 3 hours ago, ended 1 hour ago)
    const endedStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const endedEnd = new Date(Date.now() - 3600 * 1000).toISOString();
    const endedContestRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/contests',
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      {
        title: 'Past Ended Contest',
        startTime: endedStart,
        endTime: endedEnd,
      }
    );
    const endedContestId = endedContestRes.body.contest.id;
    await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/contests/${endedContestId}/problems`,
        method: 'POST',
        headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
      },
      { problemId: problemAId, points: 50 }
    );
    const pubEndedRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${endedContestId}/publish`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
    });
    assert(pubEndedRes.body.contest.runtimeState === 'ended', 'Contest past end time calculates runtimeState: ended');

    // ----------------------------------------------------
    // 5. CONTEST JOINING & PARTICIPATION TESTS
    // ----------------------------------------------------
    console.log('\n--- 5. Contest Joining & Participation Tests ---');

    // 5.1 Student joins published upcoming contest -> 201
    const joinRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/join`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
    });
    assert(joinRes1.status === 201, 'Student joins published contest (201 Created)', JSON.stringify(joinRes1.body));

    // 5.2 Student joins same contest again -> 409
    const joinRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/join`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
    });
    assert(joinRes2.status === 409, 'Duplicate join returns 409 Conflict', JSON.stringify(joinRes2.body));

    // 5.3 Student cannot join ended contest -> 400
    const joinRes3 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${endedContestId}/join`,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
    });
    assert(joinRes3.status === 400, 'Joining ended contest returns 400 Bad Request', JSON.stringify(joinRes3.body));

    // 5.4 Student cannot view participant details -> 403
    const partRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/participants`,
      method: 'GET',
      headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
    });
    assert(partRes1.status === 403, 'Student cannot view participants (403 Forbidden)', JSON.stringify(partRes1.body));

    // 5.5 Professor A views contest participants -> 200
    const partRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}/participants`,
      method: 'GET',
      headers: { ...baseHeaders, Authorization: `Bearer ${profAToken}` },
    });
    assert(partRes2.status === 200, 'Professor views contest participants (200 OK)', JSON.stringify(partRes2.body));
    assert(partRes2.body.participantCount >= 1, 'Participant count matches registered participants');

    // ----------------------------------------------------
    // 6. CONTEST DETAILS & DELETION TESTS
    // ----------------------------------------------------
    console.log('\n--- 6. Contest Details & Deletion Tests ---');

    // 6.1 Contest details includes attached problems and points
    const detailRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}`,
      method: 'GET',
      headers: { ...baseHeaders, Authorization: `Bearer ${studentToken}` },
    });
    assert(detailRes.status === 200, 'GET /api/contests/:id returns 200 OK', JSON.stringify(detailRes.body));
    assert(Array.isArray(detailRes.body.problems) && detailRes.body.problems.length > 0, 'Contest details includes problem array');
    assert(detailRes.body.problems[0].points === 100, 'Problem points are included in response');

    // 6.2 Super Admin deletes Professor A's contest -> 200
    const delRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/contests/${contestAId}`,
      method: 'DELETE',
      headers: { ...baseHeaders, Authorization: `Bearer ${superAdminToken}` },
    });
    assert(delRes1.status === 200, 'Super Admin can delete any contest (200 OK)', JSON.stringify(delRes1.body));

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n=======================================================');
    console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    // Clean up test data
    await query("DELETE FROM users WHERE email LIKE '%@p3test.com'");
  } catch (error) {
    console.error('[TEST ERROR]', error);
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
    await closePool();
    process.exit(failed > 0 ? 1 : 0);
  }
};

// Start test server and execute tests
process.env.PORT = PORT;
serverInstance = app.listen(PORT, async () => {
  await runTests();
});
