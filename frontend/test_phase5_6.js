/**
 * Phase 5.6 Automated Test Suite
 * Comprehensive Verification for Global + College Leaderboard, Ranking Engine,
 * Rating Tiers, User Position, Platform Statistics, Snapshots, and Security.
 */

import http from 'http';
import assert from 'assert';

const PORT = 5000;
let passedCount = 0;
let failedCount = 0;

function record(testName, condition, details = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${testName}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${testName} - ${details}`);
  }
}

function apiRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'x-test-environment': 'true',
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api${path}`,
        method,
        headers,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.6 AUTOMATED TEST SUITE');
  console.log(' (Global & College Leaderboard, Tiers, Snapshots, Ranks)');
  console.log('=======================================================\n');

  try {
    const ts = Date.now().toString().slice(-6);

    // --- 1. User & College Enrollment Setup ---
    console.log('--- 1. User & College Enrollment Setup ---');

    // Professor login for administrative snapshot actions
    const profLogin = await apiRequest('/auth/login', 'POST', {
      email: 'professor@university.edu',
      password: 'Password123!',
    });
    record('Professor login succeeds', profLogin.status === 200);
    const profToken = profLogin.body?.token;

    // Student A (Stanford)
    const userAHandle = `p56_alice_${ts}`;
    const regA = await apiRequest('/auth/register', 'POST', {
      username: userAHandle,
      email: `${userAHandle}@stanford.edu`,
      password: 'Password123!',
      fullName: 'Alice Stanford',
      institution: 'Stanford University',
    });
    record('Register student A (Stanford) succeeds', regA.status === 201);
    const loginA = await apiRequest('/auth/login', 'POST', {
      email: `${userAHandle}@stanford.edu`,
      password: 'Password123!',
    });
    const tokenA = loginA.body?.token;
    const userAId = loginA.body?.user?.id;

    // Set Alice institution via profile update if not passed on registration
    await apiRequest('/users/me', 'PUT', { institution: 'Stanford University' }, tokenA);

    // Student B (Stanford)
    const userBHandle = `p56_bob_${ts}`;
    await apiRequest('/auth/register', 'POST', {
      username: userBHandle,
      email: `${userBHandle}@stanford.edu`,
      password: 'Password123!',
      fullName: 'Bob Stanford',
    });
    const loginB = await apiRequest('/auth/login', 'POST', {
      email: `${userBHandle}@stanford.edu`,
      password: 'Password123!',
    });
    const tokenB = loginB.body?.token;
    const userBId = loginB.body?.user?.id;
    await apiRequest('/users/me', 'PUT', { institution: 'Stanford University' }, tokenB);

    // Student C (MIT)
    const userCHandle = `p56_charlie_${ts}`;
    await apiRequest('/auth/register', 'POST', {
      username: userCHandle,
      email: `${userCHandle}@mit.edu`,
      password: 'Password123!',
      fullName: 'Charlie MIT',
    });
    const loginC = await apiRequest('/auth/login', 'POST', {
      email: `${userCHandle}@mit.edu`,
      password: 'Password123!',
    });
    const tokenC = loginC.body?.token;
    const userCId = loginC.body?.user?.id;
    await apiRequest('/users/me', 'PUT', { institution: 'Massachusetts Institute of Technology' }, tokenC);

    // Student D (MIT)
    const userDHandle = `p56_david_${ts}`;
    await apiRequest('/auth/register', 'POST', {
      username: userDHandle,
      email: `${userDHandle}@mit.edu`,
      password: 'Password123!',
      fullName: 'David MIT',
    });
    const loginD = await apiRequest('/auth/login', 'POST', {
      email: `${userDHandle}@mit.edu`,
      password: 'Password123!',
    });
    const tokenD = loginD.body?.token;
    const userDId = loginD.body?.user?.id;
    await apiRequest('/users/me', 'PUT', { institution: 'Massachusetts Institute of Technology' }, tokenD);

    // Student E (Independent, No College)
    const userEHandle = `p56_eve_${ts}`;
    await apiRequest('/auth/register', 'POST', {
      username: userEHandle,
      email: `${userEHandle}@gmail.com`,
      password: 'Password123!',
      fullName: 'Eve Independent',
    });
    const loginE = await apiRequest('/auth/login', 'POST', {
      email: `${userEHandle}@gmail.com`,
      password: 'Password123!',
    });
    const tokenE = loginE.body?.token;
    const userEId = loginE.body?.user?.id;

    record('Setup 5 test students across Stanford, MIT, and Independent', !!tokenA && !!tokenB && !!tokenC && !!tokenD && !!tokenE);

    // --- 2. Global Leaderboard API Verification ---
    console.log('\n--- 2. Global Leaderboard API Verification ---');
    const globalLbRes = await apiRequest('/leaderboard');
    record('GET /api/leaderboard returns HTTP 200', globalLbRes.status === 200);
    record('Leaderboard response has scope = global', globalLbRes.body?.scope === 'global');
    record('Leaderboard response includes standings array', Array.isArray(globalLbRes.body?.standings));
    record('Leaderboard response includes pagination object', !!globalLbRes.body?.pagination);
    record('Leaderboard response includes platform statistics', !!globalLbRes.body?.statistics);
    record('Leaderboard response includes tiers configuration', Array.isArray(globalLbRes.body?.tiers));
    record('Tiers array contains 6 distinct platform tiers', globalLbRes.body?.tiers?.length === 6);

    // Verify deterministic ordering: standings must be sorted by currentRating DESC, id ASC
    const standings = globalLbRes.body?.standings || [];
    let isSorted = true;
    for (let i = 0; i < standings.length - 1; i++) {
      if (standings[i].currentRating < standings[i + 1].currentRating) {
        isSorted = false;
        break;
      }
    }
    record('Global standings are strictly sorted by rating descending', isSorted);

    // Verify rating tier attachment
    const firstUser = standings[0];
    if (firstUser) {
      record('First standing row includes valid tier object', !!firstUser.tier?.badge && !!firstUser.tier?.color);
      record('First standing row has integer rank starting at 1', firstUser.rank === 1);
    }

    // --- 3. College Leaderboard & Institution Isolation ---
    console.log('\n--- 3. College Leaderboard & Institution Isolation ---');
    const stanfordLb = await apiRequest('/leaderboard?scope=college&institution=Stanford%20University');
    record('GET /api/leaderboard?scope=college&institution=Stanford returns HTTP 200', stanfordLb.status === 200);
    record('Response confirms scope = college', stanfordLb.body?.scope === 'college');
    record('Response confirms institution = Stanford University', stanfordLb.body?.institution === 'Stanford University');

    const stanfordStandings = stanfordLb.body?.standings || [];
    const hasOnlyStanford = stanfordStandings.every(
      (s) => s.institution.toLowerCase().includes('stanford')
    );
    record('College leaderboard isolates ONLY students from Stanford University', hasOnlyStanford && stanfordStandings.length >= 2);

    const hasMitStudent = stanfordStandings.some(
      (s) => s.userId === userCId || s.userId === userDId
    );
    record('MIT students are strictly excluded from Stanford leaderboard', !hasMitStudent);

    const mitLb = await apiRequest('/leaderboard?scope=college&institution=Massachusetts%20Institute%20of%20Technology');
    record('GET /api/leaderboard for MIT returns HTTP 200', mitLb.status === 200);
    const mitStandings = mitLb.body?.standings || [];
    const hasOnlyMit = mitStandings.every(
      (s) => s.institution.toLowerCase().includes('massachusetts')
    );
    record('MIT leaderboard isolates ONLY students from MIT', hasOnlyMit && mitStandings.length >= 2);

    // --- 4. Logged-in User Position (userPosition) Summary ---
    console.log('\n--- 4. Logged-in User Position (userPosition) Summary ---');
    const userPosRes = await apiRequest('/leaderboard', 'GET', null, tokenA);
    record('Authenticated leaderboard request returns HTTP 200', userPosRes.status === 200);
    const userPos = userPosRes.body?.userPosition;
    record('Response includes userPosition for authenticated user', !!userPos);
    record('userPosition contains correct userId for Alice', userPos?.userId === userAId);
    record('userPosition contains globalRank integer', typeof userPos?.globalRank === 'number' && userPos?.globalRank >= 1);
    record('userPosition contains collegeRank integer for Stanford', typeof userPos?.collegeRank === 'number' && userPos?.collegeRank >= 1);
    record('userPosition includes currentRating and highestRating', userPos?.currentRating === 1200 && userPos?.highestRating === 1200);
    record('userPosition includes rating tier object', !!userPos?.tier?.badge);
    record('userPosition includes platform percentile', typeof userPos?.percentile === 'number');

    // User outside current pagination page (e.g. limit=1) still receives userPosition
    const page1Limit1 = await apiRequest('/leaderboard?page=1&limit=1', 'GET', null, tokenA);
    record('User position is returned even when student is outside pagination page 1', !!page1Limit1.body?.userPosition);
    record('userPosition retains accurate global rank on pagination offset', page1Limit1.body?.userPosition?.globalRank === userPos?.globalRank);

    // --- 5. Filtering, Tiers & Search ---
    console.log('\n--- 5. Filtering, Tiers & Search ---');
    const searchRes = await apiRequest(`/leaderboard?search=${userAHandle}`);
    record('Username search query returns HTTP 200', searchRes.status === 200);
    record('Search by username returns exactly matching user', searchRes.body?.standings?.[0]?.username === userAHandle);

    const nameSearchRes = await apiRequest('/leaderboard?search=Alice%20Stanford');
    const hasAliceByName = (nameSearchRes.body?.standings || []).some((s) => s.userId === userAId);
    record('Search by full name returns matching user', hasAliceByName);

    const emptySearchRes = await apiRequest('/leaderboard?search=nonexistent_query_xyz987');
    record('Non-matching search returns empty standings array', emptySearchRes.body?.standings?.length === 0);

    const statusRatedRes = await apiRequest('/leaderboard?status=rated');
    record('Filter status=rated succeeds', statusRatedRes.status === 200);
    const allRated = (statusRatedRes.body?.standings || []).every((s) => s.ratingStatus === 'rated');
    record('Filter status=rated contains only rated participants', allRated);

    const statusProvRes = await apiRequest('/leaderboard?status=provisional');
    record('Filter status=provisional succeeds', statusProvRes.status === 200);
    const allProv = (statusProvRes.body?.standings || []).every((s) => s.ratingStatus === 'provisional');
    record('Filter status=provisional contains only provisional participants', allProv);

    // --- 6. Platform Rating Statistics & Distribution Histogram ---
    console.log('\n--- 6. Platform Rating Statistics & Distribution Histogram ---');
    const statsRes = await apiRequest('/leaderboard/stats');
    record('GET /api/leaderboard/stats returns HTTP 200', statsRes.status === 200);
    record('Statistics includes totalStudents count', typeof statsRes.body?.totalStudents === 'number');
    record('Statistics includes averageRating', typeof statsRes.body?.averageRating === 'number');
    record('Statistics includes highestRating', typeof statsRes.body?.highestRating === 'number');
    record('Statistics includes ratingDistribution array', Array.isArray(statsRes.body?.ratingDistribution));
    record('Distribution array has 6 buckets matching platform tiers', statsRes.body?.ratingDistribution?.length === 6);

    const distBuckets = statsRes.body?.ratingDistribution || [];
    const sumCounts = distBuckets.reduce((acc, b) => acc + b.count, 0);
    record('Sum of distribution bucket counts equals totalStudents', sumCounts === statsRes.body?.totalStudents);

    // --- 7. Historical Snapshots API ---
    console.log('\n--- 7. Historical Snapshots API ---');
    const snapCreateRes = await apiRequest('/leaderboard/snapshots', 'POST', { scope: 'global' }, profToken);
    record('Professor can trigger historical leaderboard snapshot (HTTP 201)', snapCreateRes.status === 201);
    record('Snapshot response confirms captured student count', snapCreateRes.body?.totalStudentsCaptured > 0);

    const snapGetRes = await apiRequest('/leaderboard/snapshots?scope=global');
    record('GET /api/leaderboard/snapshots returns HTTP 200', snapGetRes.status === 200);
    record('Snapshots response contains array of captured ranks', Array.isArray(snapGetRes.body?.snapshots));

    // Non-professor attempt to create snapshot is rejected (403 Forbidden)
    const studentSnapRes = await apiRequest('/leaderboard/snapshots', 'POST', { scope: 'global' }, tokenA);
    record('Student cannot trigger leaderboard snapshot (HTTP 403 Forbidden)', studentSnapRes.status === 403);

    // --- 8. Security, Anti-Tamper & Privacy Isolation ---
    console.log('\n--- 8. Security, Anti-Tamper & Privacy Isolation ---');
    // Attempt to tamper with rating and rank via profile update
    const tamperRes = await apiRequest('/users/me', 'PUT', {
      bio: 'Legitimate bio update with rating tamper attempt',
      currentRating: 9999,
      current_rating: 9999,
      highestRating: 9999,
      rating_status: 'rated',
      rank: 1,
    }, tokenA);
    record('Profile update response succeeds without crashing', tamperRes.status === 200);

    // Verify rating remained untouched
    const verifyMe = await apiRequest('/users/me', 'GET', null, tokenA);
    record('TAMPER PROTECTION: Student rating cannot be modified via profile update', verifyMe.body?.currentRating === 1200);
    record('TAMPER PROTECTION: Student rating status cannot be escalated', verifyMe.body?.ratingStatus === 'provisional');

    // Verify public leaderboard strictly excludes sensitive credentials
    const publicLb = await apiRequest('/leaderboard');
    const publicUsers = publicLb.body?.standings || [];
    const leaksPassword = publicUsers.some((u) => u.password_hash || u.password);
    const leaksEmail = publicUsers.some((u) => u.email);
    record('PRIVACY ISOLATION: Public leaderboard strictly excludes password hashes', !leaksPassword);
    record('PRIVACY ISOLATION: Public leaderboard strictly excludes student emails', !leaksEmail);

    // --- 9. Summary ---
    console.log('\n=======================================================');
    console.log(` PHASE 5.6 TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('=======================================================\n');

    if (failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Unhandled test runner error:', error);
    process.exit(1);
  }
}

runTests();
