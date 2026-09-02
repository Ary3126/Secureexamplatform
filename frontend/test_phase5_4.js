/**
 * Automated Verification Test Suite for Phase 5.4 — Competitive Rating System
 */
const API_BASE = 'http://localhost:5000/api';

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'x-test-environment': 'true' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const contentType = res.headers.get('content-type');
  let data = null;
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, body: data, headers: res.headers, ok: res.ok };
}

async function runPhase54Tests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.4 AUTOMATED TEST SUITE');
  console.log(' (Competitive Rating, Elo Engine, Idempotency, History, Rank)');
  console.log('=======================================================\n');

  try {
    const ts = Date.now();

    // 1. Authenticate seeded professor and register 3 fresh test students
    console.log('--- 1. Initial Rating & User Setup Tests ---');
    const profLogin = await apiRequest('/auth/login', 'POST', {
      email: 'professor@university.edu',
      password: 'Password123!',
    });
    assert(profLogin.status === 200, 'Professor login succeeds (200 OK)');
    const profToken = profLogin.body.token;

    const s1Email = `alice_rating_${ts}@test.com`;
    const s2Email = `bob_rating_${ts}@test.com`;
    const s3Email = `charlie_rating_${ts}@test.com`;

    // Register Student 1 (Alice)
    const s1Reg = await apiRequest('/auth/register', 'POST', {
      username: `alice_r_${ts}`,
      email: s1Email,
      password: 'Password123!',
      fullName: 'Alice Walker',
    });
    assert(s1Reg.status === 201, 'Student Alice registration succeeds (201 Created)');
    assert(s1Reg.body.user.currentRating === 1200, 'New student starts with configured initial rating of 1200');
    assert(s1Reg.body.user.highestRating === 1200, 'New student highest rating initialized to 1200');
    assert(s1Reg.body.user.ratingStatus === 'provisional', 'New student rating status is provisional');
    assert(s1Reg.body.user.ratedContestCount === 0, 'New student ratedContestCount initialized to 0');

    const s1Login = await apiRequest('/auth/login', 'POST', {
      email: s1Email,
      password: 'Password123!',
    });
    const s1Token = s1Login.body.token;
    const s1User = s1Login.body.user;
    const s1Id = s1User.id;

    // Register Student 2 (Bob)
    await apiRequest('/auth/register', 'POST', {
      username: `bob_r_${ts}`,
      email: s2Email,
      password: 'Password123!',
      fullName: 'Bob Roberts',
    });
    const s2Login = await apiRequest('/auth/login', 'POST', {
      email: s2Email,
      password: 'Password123!',
    });
    const s2Token = s2Login.body.token;
    const s2Id = s2Login.body.user.id;

    // Register Student 3 (Charlie)
    await apiRequest('/auth/register', 'POST', {
      username: `charlie_r_${ts}`,
      email: s3Email,
      password: 'Password123!',
      fullName: 'Charlie Davis',
    });
    const s3Login = await apiRequest('/auth/login', 'POST', {
      email: s3Email,
      password: 'Password123!',
    });
    const s3Token = s3Login.body.token;
    const s3Id = s3Login.body.user.id;

    // 2. Profile Rating API
    console.log('\n--- 2. Rating & Rank API Verification ---');
    const s1Profile = await apiRequest('/users/me', 'GET', null, s1Token);
    assert(s1Profile.status === 200, 'GET /api/users/me returns 200 OK');
    assert(s1Profile.body.currentRating === 1200, 'Profile includes currentRating');
    assert(s1Profile.body.highestRating === 1200, 'Profile includes highestRating');
    assert(s1Profile.body.ratingStatus === 'provisional', 'Profile includes ratingStatus');
    assert(s1Profile.body.rank !== undefined && s1Profile.body.rank > 0, 'Profile includes computed global rank');
    assert(Array.isArray(s1Profile.body.ratingHistory), 'Profile includes ratingHistory array');

    const s1RatingApi = await apiRequest(`/users/${s1Id}/rating`, 'GET', null, s1Token);
    assert(s1RatingApi.status === 200, 'GET /api/users/:id/rating returns 200 OK');
    assert(s1RatingApi.body.currentRating === 1200, 'User rating endpoint returns correct rating');
    assert(s1RatingApi.body.rank !== undefined, 'User rating endpoint returns rank');

    // 3. Security: Student cannot tamper with rating
    console.log('\n--- 3. Rating Security & Authorization ---');
    const tamperRes = await apiRequest(
      '/users/me',
      'PUT',
      { fullName: 'Alice Walker Updated', currentRating: 5000, highestRating: 5000, ratingStatus: 'rated' },
      s1Token
    );
    assert(tamperRes.status === 200, 'Profile update endpoint responds');
    assert(tamperRes.body.user.currentRating === 1200, 'Student CANNOT modify own rating via profile update (immutable)');

    // 4. Create Problem & Rated Contest
    console.log('\n--- 4. Rated Contest Setup & Participation ---');
    const probRes = await apiRequest(
      '/problems',
      'POST',
      {
        title: `Rating Test Problem ${ts}`,
        description: 'Solve the rating calculation problem',
        difficulty: 'medium',
        codingMode: 'full_program',
      },
      profToken
    );
    const probId = probRes.body.problem.id;

    // Add test case
    await apiRequest(
      `/problems/${probId}/testcases`,
      'POST',
      { inputData: '5\n', expectedOutput: '10\n', isSample: false },
      profToken
    );

    const now = Date.now();
    const contestRes = await apiRequest(
      '/contests',
      'POST',
      {
        title: `Rated Contest Alfa ${ts}`,
        description: 'Competitive Rated Contest',
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 3600000).toISOString(), // Active running contest
        isRated: true,
      },
      profToken
    );
    const contestId = contestRes.body.contest.id;
    assert(contestRes.body.contest.isRated === true, 'Contest created with isRated: true');
    assert(contestRes.body.contest.isRatingFinalized === false, 'Contest starts with isRatingFinalized: false');

    // Attach problem and publish
    await apiRequest(`/contests/${contestId}/problems`, 'POST', { problemId: probId, points: 100 }, profToken);
    await apiRequest(`/contests/${contestId}/publish`, 'POST', null, profToken);

    // Students join contest while running
    const j1 = await apiRequest(`/contests/${contestId}/join`, 'POST', null, s1Token);
    const j2 = await apiRequest(`/contests/${contestId}/join`, 'POST', null, s2Token);
    const j3 = await apiRequest(`/contests/${contestId}/join`, 'POST', null, s3Token);
    assert(j1.status === 201 && j2.status === 201 && j3.status === 201, 'All 3 students joined the contest successfully');

    // 5. Submit solutions: Alice 100pts (Rank 1), Bob wrong answer 0pts (Rank 2), Charlie no submit (Rank 3)
    console.log('\n--- 5. Contest Submissions & Standings ---');
    // Alice submits correct solution
    const aliceSubRes = await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: probId,
        contestId,
        language: 'python',
        sourceCode: 'n = int(input())\nprint(n * 2)',
      },
      s1Token
    );
    const aliceSubId = aliceSubRes.body?.submission?.id || aliceSubRes.body?.id;
    console.log('[ALICE SUBMISSION ID]:', aliceSubId);

    // Bob submits wrong solution
    const bobSubRes = await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: probId,
        contestId,
        language: 'python',
        sourceCode: 'print(0)',
      },
      s2Token
    );
    const bobSubId = bobSubRes.body?.submission?.id || bobSubRes.body?.id;

    // Poll until Alice's submission is judged by the Judge Worker
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const check = await apiRequest(`/submissions/${aliceSubId}`, 'GET', null, s1Token);
      if (check.body && check.body.status && check.body.status !== 'queued' && check.body.status !== 'running') {
        break;
      }
    }

    // Student cannot finalize ratings (Security)
    const studentFinalizeRes = await apiRequest(
      `/contests/${contestId}/finalize-ratings`,
      'POST',
      { force: true },
      s1Token
    );
    assert(studentFinalizeRes.status === 403, 'Student cannot trigger contest finalization (403 Forbidden)');

    // 6. Finalize Contest Ratings (Admin/Professor)
    console.log('\n--- 6. Idempotent Contest Finalization & Elo Calculation ---');
    const finalizeRes = await apiRequest(
      `/contests/${contestId}/finalize-ratings`,
      'POST',
      { force: true },
      profToken
    );
    assert(finalizeRes.status === 200, 'POST /api/contests/:id/finalize-ratings succeeds (200 OK)');
    assert(Array.isArray(finalizeRes.body?.ratingUpdates) && finalizeRes.body.ratingUpdates.length === 3, 'Calculated rating updates for all 3 participants');

    const aliceUpdate = finalizeRes.body.ratingUpdates.find((u) => u.userId === s1Id);
    assert(aliceUpdate.rank === 1, 'Alice ranked #1 in contest standings');
    assert(aliceUpdate.ratingChange > 0, `Alice gained rating (+${aliceUpdate.ratingChange})`);
    assert(aliceUpdate.newRating === 1200 + aliceUpdate.ratingChange, 'New rating = previous + change');
    assert(aliceUpdate.newHighestRating >= aliceUpdate.newRating, 'Highest rating tracked correctly');
    assert(aliceUpdate.newRatedContestCount === 1, 'Rated contest count incremented to 1');

    // Check bottom-ranked participant lost rating
    const bottomUpdate = finalizeRes.body.ratingUpdates.reduce((min, u) => (u.ratingChange < min.ratingChange ? u : min), finalizeRes.body.ratingUpdates[0]);
    assert(bottomUpdate !== undefined, 'Found bottom-tier participant');
    assert(bottomUpdate.ratingChange < 0, `Bottom participant lost rating (${bottomUpdate.ratingChange})`);
    assert(bottomUpdate.newHighestRating === 1200, 'Bottom participant highest rating remains 1200 despite rating drop');

    // Verify rating conservation (approx zero-sum)
    const sumDeltas = finalizeRes.body.ratingUpdates.reduce((acc, u) => acc + u.ratingChange, 0);
    assert(Math.abs(sumDeltas) <= 2, `Rating changes sum approximately to zero (Sum = ${sumDeltas})`);

    // 7. Idempotency Test: Finalize again
    console.log('\n--- 7. Idempotency & Duplicate Protection ---');
    const finalizeAgain = await apiRequest(
      `/contests/${contestId}/finalize-ratings`,
      'POST',
      { force: true },
      profToken
    );
    assert(finalizeAgain.status === 200, 'Calling finalize second time returns 200 OK');
    assert(finalizeAgain.body.alreadyFinalized === true, 'Second call recognizes alreadyFinalized: true');

    // Verify Alice rating was NOT double-incremented
    const aliceProfileAfter = await apiRequest('/users/me', 'GET', null, s1Token);
    assert(aliceProfileAfter.body.currentRating === aliceUpdate.newRating, 'Rating was NOT double-applied after duplicate finalization call');
    assert(aliceProfileAfter.body.ratedContestCount === 1, 'Rated contest count remains exactly 1');

    // 8. Rating History API
    console.log('\n--- 8. Rating History Verification ---');
    const s1HistoryRes = await apiRequest(`/users/${s1Id}/rating-history`, 'GET', null, s1Token);
    assert(s1HistoryRes.status === 200, 'GET /api/users/:id/rating-history returns 200 OK');
    assert(s1HistoryRes.body.historyCount === 1, 'Alice has exactly 1 rating history record');
    assert(s1HistoryRes.body.history[0].ratingChange === aliceUpdate.ratingChange, 'History record stores correct rating delta');
    assert(s1HistoryRes.body.history[0].rank === 1, 'History record stores contest rank');

    // 9. Unrated Contest Test
    console.log('\n--- 9. Unrated Contest Verification ---');
    const unratedContestRes = await apiRequest(
      '/contests',
      'POST',
      {
        title: `Unrated Practice Contest ${ts}`,
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 3600000).toISOString(),
        isRated: false,
      },
      profToken
    );
    const unratedContestId = unratedContestRes.body.contest.id;
    await apiRequest(`/contests/${unratedContestId}/problems`, 'POST', { problemId: probId, points: 100 }, profToken);
    await apiRequest(`/contests/${unratedContestId}/publish`, 'POST', null, profToken);

    const unratedFinalize = await apiRequest(
      `/contests/${unratedContestId}/finalize-ratings`,
      'POST',
      { force: true },
      profToken
    );
    assert(unratedFinalize.status === 400, 'Unrated contest finalization rejected (400 Bad Request)');

    // 10. Provisional to Rated Transition (Simulate 4 more rated contests)
    console.log('\n--- 10. Provisional to Rated Transition ---');
    for (let c = 2; c <= 5; c++) {
      const cRes = await apiRequest(
        '/contests',
        'POST',
        {
          title: `Calibration Contest #${c} ${ts}`,
          startTime: new Date(now - 3600000).toISOString(),
          endTime: new Date(now + 3600000).toISOString(),
          isRated: true,
        },
        profToken
      );
      const cId = cRes.body.contest.id;
      await apiRequest(`/contests/${cId}/problems`, 'POST', { problemId: probId, points: 100 }, profToken);
      await apiRequest(`/contests/${cId}/publish`, 'POST', null, profToken);
      await apiRequest(`/contests/${cId}/join`, 'POST', null, s1Token);
      await apiRequest(`/contests/${cId}/join`, 'POST', null, s2Token);

      await apiRequest(`/contests/${cId}/finalize-ratings`, 'POST', { force: true }, profToken);
    }

    const s1ProfileFinal = await apiRequest('/users/me', 'GET', null, s1Token);
    assert(s1ProfileFinal.body.ratedContestCount === 5, 'Alice completed 5 rated contests');
    assert(s1ProfileFinal.body.ratingStatus === 'rated', 'Alice transitioned from PROVISIONAL to RATED at threshold of 5 contests');

    console.log('\n=======================================================');
    console.log(` PHASE 5.4 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('=======================================================');

    process.exit(failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error('[TEST ERROR]:', err);
    process.exit(1);
  }
}

runPhase54Tests();
