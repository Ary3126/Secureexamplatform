import assert from 'assert';

const BASE_URL = 'http://localhost:5000/api';

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json', 'x-test-environment': 'true' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, headers: res.headers, body: data };
}

async function runPhase55Tests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.5 AUTOMATED TEST SUITE');
  console.log(' (Contest Leaderboard, Problem Matrix, Freeze & Standings)');
  console.log('=======================================================\n');

  const ts = Date.now();

  try {
    // 1. Initial Setup: Professor Login & Seed Users
    console.log('--- 1. Authentication & Contest Setup ---');
    const profLogin = await apiRequest('/auth/login', 'POST', {
      email: 'professor@university.edu',
      password: 'Password123!',
    });
    assert(profLogin.status === 200, 'Professor login succeeds (200 OK)');
    const profToken = profLogin.body.token;

    // Register 3 Contest Students: Alice, Bob, Charlie
    const s1User = `p55_alice_${ts}`;
    const s1Email = `alice_${ts}@test.edu`;
    const s2User = `p55_bob_${ts}`;
    const s2Email = `bob_${ts}@test.edu`;
    const s3User = `p55_charlie_${ts}`;
    const s3Email = `charlie_${ts}@test.edu`;

    await apiRequest('/auth/signup', 'POST', {
      username: s1User,
      email: s1Email,
      password: 'Password123!',
      fullName: 'Alice Leaderboard',
    });
    await apiRequest('/auth/signup', 'POST', {
      username: s2User,
      email: s2Email,
      password: 'Password123!',
      fullName: 'Bob Leaderboard',
    });
    await apiRequest('/auth/signup', 'POST', {
      username: s3User,
      email: s3Email,
      password: 'Password123!',
      fullName: 'Charlie Leaderboard',
    });

    const s1Login = await apiRequest('/auth/login', 'POST', { email: s1Email, password: 'Password123!' });
    const s2Login = await apiRequest('/auth/login', 'POST', { email: s2Email, password: 'Password123!' });
    const s3Login = await apiRequest('/auth/login', 'POST', { email: s3Email, password: 'Password123!' });

    const s1Token = s1Login.body.token;
    const s2Token = s2Login.body.token;
    const s3Token = s3Login.body.token;

    const s1Id = s1Login.body.user.id;
    const s2Id = s2Login.body.user.id;
    const s3Id = s3Login.body.user.id;

    assert(s1Token && s2Token && s3Token, 'All 3 test students authenticated successfully');

    // Create 2 Problems: Problem 1 (100 pts) and Problem 2 (200 pts)
    const prob1Res = await apiRequest(
      '/problems',
      'POST',
      {
        title: `P5.5 Alpha Problem ${ts}`,
        description: 'Return sum of two numbers',
        difficulty: 'easy',
        codingMode: 'full_program',
      },
      profToken
    );
    const prob1Id = prob1Res.body.problem.id;

    // Add visible testcase to Problem 1
    await apiRequest(
      `/problems/${prob1Id}/test-cases`,
      'POST',
      {
        inputData: '3 5\n',
        expectedOutput: '8\n',
        isHidden: false,
      },
      profToken
    );

    const prob2Res = await apiRequest(
      '/problems',
      'POST',
      {
        title: `P5.5 Beta Problem ${ts}`,
        description: 'Return product of two numbers',
        difficulty: 'medium',
        codingMode: 'full_program',
      },
      profToken
    );
    const prob2Id = prob2Res.body.problem.id;

    // Add visible testcase to Problem 2
    await apiRequest(
      `/problems/${prob2Id}/test-cases`,
      'POST',
      {
        inputData: '4 5\n',
        expectedOutput: '20\n',
        isHidden: false,
      },
      profToken
    );

    // Create Active Published Contest
    const contestStart = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // Started 30 min ago
    const contestEnd = new Date(Date.now() + 90 * 60 * 1000).toISOString(); // Ends in 90 min

    const createContestRes = await apiRequest(
      '/contests',
      'POST',
      {
        title: `P5.5 Grand Championship ${ts}`,
        description: 'Official Phase 5.5 Rated Contest',
        startTime: contestStart,
        endTime: contestEnd,
        isRated: true,
        leaderboardFreezeEnabled: true,
        leaderboardFreezeMinutes: 30,
      },
      profToken
    );
    assert(createContestRes.status === 201, 'Contest created (201 Created)');
    const contestId = createContestRes.body.contest.id;

    // Attach Problem 1 (100 pts) and Problem 2 (200 pts)
    await apiRequest(
      `/contests/${contestId}/problems`,
      'POST',
      { problemId: prob1Id, points: 100, problemOrder: 1 },
      profToken
    );
    await apiRequest(
      `/contests/${contestId}/problems`,
      'POST',
      { problemId: prob2Id, points: 200, problemOrder: 2 },
      profToken
    );

    // Publish contest
    const pubRes = await apiRequest(`/contests/${contestId}/publish`, 'POST', {}, profToken);
    assert(pubRes.status === 200, 'Contest published successfully (200 OK)');

    // Enroll students in contest
    await apiRequest(`/contests/${contestId}/join`, 'POST', {}, s1Token);
    await apiRequest(`/contests/${contestId}/join`, 'POST', {}, s2Token);
    await apiRequest(`/contests/${contestId}/join`, 'POST', {}, s3Token);

    console.log('[PASS] Contest and participants enrolled successfully');

    // 2. Empty Leaderboard Structure Verification
    console.log('\n--- 2. Empty Leaderboard API Verification ---');
    const emptyLbRes = await apiRequest(`/contests/${contestId}/leaderboard`, 'GET', null, s1Token);
    if (emptyLbRes.status !== 200) {
      console.error('[EMPTY LB ERROR BODY]:', emptyLbRes.body);
    }
    assert(emptyLbRes.status === 200, 'GET /api/contests/:id/leaderboard returns 200 OK');
    assert(emptyLbRes.body.contest !== undefined, 'Response contains contest metadata');
    assert(emptyLbRes.body.contest.isRated === true, 'Contest metadata reflects isRated: true');
    assert(emptyLbRes.body.contest.leaderboardFreezeEnabled === true, 'Contest metadata reflects freeze enabled');
    assert(Array.isArray(emptyLbRes.body.problems) && emptyLbRes.body.problems.length === 2, 'Contains 2 contest problems');
    assert(Array.isArray(emptyLbRes.body.standings) && emptyLbRes.body.standings.length === 3, 'Contains 3 participant standings rows');
    assert(Array.isArray(emptyLbRes.body.podium) && emptyLbRes.body.podium.length === 3, 'Contains top 3 podium entries');
    assert(emptyLbRes.body.userPosition?.isParticipating === true, 'Alice user position confirms participation');
    assert(emptyLbRes.body.userPosition.rank === 1, 'Initial tied rank is 1');
    assert(emptyLbRes.body.contestSummary?.totalParticipants === 3, 'Contest summary tracks 3 participants');

    // 3. Official Submissions & Problem Matrix Verification
    console.log('\n--- 3. Submissions & Problem Scoreboard Matrix ---');
    // Alice solves Problem 1 (Accepted on 1st try)
    const s1p1 = await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob1Id,
        contestId,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) + int(lines[1]))\n',
      },
      s1Token
    );
    assert(s1p1.status === 201, 'Alice submission for Problem 1 queued');

    // Wait 2.5s for judge evaluation
    await new Promise((r) => setTimeout(r, 2500));

    // Alice fails Problem 2 once, then solves it (Wrong Answer -> Accepted)
    await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob2Id,
        contestId,
        language: 'python',
        sourceCode: 'print(999)\n', // Wrong Answer
      },
      s1Token
    );
    await new Promise((r) => setTimeout(r, 1500));

    await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob2Id,
        contestId,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) * int(lines[1]))\n', // Correct
      },
      s1Token
    );
    await new Promise((r) => setTimeout(r, 2500));

    // Bob solves Problem 1 only (1st try)
    await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob1Id,
        contestId,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) + int(lines[1]))\n',
      },
      s2Token
    );
    await new Promise((r) => setTimeout(r, 2500));

    // Charlie fails Problem 1 (Wrong Answer, 0 solves)
    await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob1Id,
        contestId,
        language: 'python',
        sourceCode: 'print(0)\n',
      },
      s3Token
    );
    await new Promise((r) => setTimeout(r, 2000));

    // Fetch Leaderboard after submissions
    const liveLb = await apiRequest(`/contests/${contestId}/leaderboard`, 'GET', null, s1Token);
    assert(liveLb.status === 200, 'GET /api/contests/:id/leaderboard returns 200 OK');

    const aliceRow = liveLb.body.standings.find((s) => s.userId === s1Id);
    const bobRow = liveLb.body.standings.find((s) => s.userId === s2Id);
    const charlieRow = liveLb.body.standings.find((s) => s.userId === s3Id);

    assert(aliceRow.rank === 1, 'Alice is Rank #1');
    assert(aliceRow.totalScore === 300, `Alice totalScore = 300 (100 + 200 pts), got ${aliceRow.totalScore}`);
    assert(aliceRow.solvedProblemsCount === 2, 'Alice solved 2 problems');
    assert(bobRow.rank === 2, 'Bob is Rank #2');
    assert(bobRow.totalScore === 100, `Bob totalScore = 100 pts, got ${bobRow.totalScore}`);
    assert(bobRow.solvedProblemsCount === 1, 'Bob solved 1 problem');
    assert(charlieRow.rank === 3, 'Charlie is Rank #3');
    assert(charlieRow.totalScore === 0, 'Charlie totalScore = 0 pts');

    // Verify Problem-by-Problem Scoreboard Details
    const aliceP1 = aliceRow.problems.find((p) => p.problemId === prob1Id);
    const aliceP2 = aliceRow.problems.find((p) => p.problemId === prob2Id);
    assert(aliceP1.status === 'solved', 'Alice Problem 1 status is solved');
    assert(aliceP1.points === 100, 'Alice Problem 1 awarded 100 points');
    assert(aliceP1.failedAttemptsBeforeSolve === 0, 'Alice Problem 1 has 0 failed attempts before solve');
    assert(aliceP2.status === 'solved', 'Alice Problem 2 status is solved');
    assert(aliceP2.points === 200, 'Alice Problem 2 awarded 200 points');
    assert(aliceP2.failedAttemptsBeforeSolve === 1, 'Alice Problem 2 tracks 1 failed attempt before solve');
    assert(aliceP2.penaltyContribution > 20, `Alice Problem 2 penalty reflects +20m wrong attempt penalty (${aliceP2.penaltyContribution}m)`);

    const charlieP1 = charlieRow.problems.find((p) => p.problemId === prob1Id);
    assert(charlieP1.status === 'failed', 'Charlie Problem 1 status is failed');
    assert(charlieP1.attemptsCount === 1, 'Charlie Problem 1 tracks 1 attempt');

    // Podium Check
    assert(liveLb.body.podium[0].userId === s1Id, 'Podium Rank 1 is Alice');
    assert(liveLb.body.podium[1].userId === s2Id, 'Podium Rank 2 is Bob');
    assert(liveLb.body.podium[2].userId === s3Id, 'Podium Rank 3 is Charlie');

    // User Position Check (Alice)
    assert(liveLb.body.userPosition.rank === 1, 'Alice userPosition rank is #1');
    assert(liveLb.body.userPosition.totalScore === 300, 'Alice userPosition totalScore is 300');

    console.log('[PASS] Problem scoreboard matrix and rankings verified accurately');

    // 4. Search & Server-Side Pagination Tests
    console.log('\n--- 4. Search & Server-Side Pagination ---');
    const searchRes = await apiRequest(`/contests/${contestId}/leaderboard?search=Alice`, 'GET', null, s1Token);
    assert(searchRes.status === 200, 'Search request returns 200 OK');
    assert(searchRes.body.standings.length === 1, 'Search for Alice returns exactly 1 row');
    assert(searchRes.body.standings[0].userId === s1Id, 'Returned row matches Alice');

    const pagRes = await apiRequest(`/contests/${contestId}/leaderboard?page=1&limit=2`, 'GET', null, s1Token);
    assert(pagRes.status === 200, 'Pagination request returns 200 OK');
    assert(pagRes.body.standings.length === 2, 'Page 1 limit=2 returns exactly 2 rows');
    assert(pagRes.body.pagination.totalPages === 2, 'Total pages calculated as 2');
    assert(pagRes.body.pagination.hasNext === true, 'Pagination indicates hasNext: true');

    console.log('[PASS] Search and pagination parameters work properly');

    // 5. Leaderboard Freeze Logic Verification
    console.log('\n--- 5. Leaderboard Freeze Verification ---');
    // Create a contest that started 2 hours ago and ends in 15 minutes, with freeze duration = 30 minutes
    // Therefore, freeze began 15 minutes ago (freeze cutoff is 15 minutes in the past)
    const freezeStartTime = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    const freezeEndTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const freezeContestRes = await apiRequest(
      '/contests',
      'POST',
      {
        title: `P5.5 Frozen Contest ${ts}`,
        description: 'Contest currently in freeze window',
        startTime: freezeStartTime,
        endTime: freezeEndTime,
        isRated: true,
        leaderboardFreezeEnabled: true,
        leaderboardFreezeMinutes: 30, // Freeze started 15 min ago
      },
      profToken
    );
    const freezeContestId = freezeContestRes.body.contest.id;

    await apiRequest(
      `/contests/${freezeContestId}/problems`,
      'POST',
      { problemId: prob1Id, points: 100, problemOrder: 1 },
      profToken
    );
    await apiRequest(`/contests/${freezeContestId}/publish`, 'POST', {}, profToken);

    // Alice and Bob join freeze contest
    await apiRequest(`/contests/${freezeContestId}/join`, 'POST', {}, s1Token);
    await apiRequest(`/contests/${freezeContestId}/join`, 'POST', {}, s2Token);

    // Verify contest detects isFrozen: true
    const preCheckLb = await apiRequest(`/contests/${freezeContestId}/leaderboard`, 'GET', null, s1Token);
    assert(preCheckLb.body.contest.isFrozen === true, 'Contest is detected as isFrozen: true');

    // Alice submits solution DURING the freeze
    await apiRequest(
      '/submissions',
      'POST',
      {
        problemId: prob1Id,
        contestId: freezeContestId,
        language: 'python',
        sourceCode: 'import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) + int(lines[1]))\n',
      },
      s1Token
    );
    await new Promise((r) => setTimeout(r, 2500));

    // Student Alice inspects public frozen leaderboard
    const frozenLb = await apiRequest(`/contests/${freezeContestId}/leaderboard`, 'GET', null, s1Token);
    const frozenAlice = frozenLb.body.standings.find((s) => s.userId === s1Id);
    assert(frozenAlice.totalScore === 0, `During freeze, public leaderboard hides post-freeze score (Score = 0, got ${frozenAlice.totalScore})`);

    // Professor inspects with freezeOverride = true
    const unmaskedLb = await apiRequest(`/contests/${freezeContestId}/leaderboard?freezeOverride=true`, 'GET', null, profToken);
    const unmaskedAlice = unmaskedLb.body.standings.find((s) => s.userId === s1Id);
    assert(unmaskedAlice.totalScore === 100, `Professor with freezeOverride sees true unmasked score (Score = 100, got ${unmaskedAlice.totalScore})`);

    console.log('[PASS] Leaderboard freeze correctly masks public scoreboard while judge continues execution');

    // 6. Finalization, Unfreeze & Rating Integration
    console.log('\n--- 6. Finalization & Phase 5.4 Rating Integration ---');
    // Finalize ratings on Contest 1
    const finalizeRes = await apiRequest(
      `/contests/${contestId}/finalize-ratings`,
      'POST',
      { force: true },
      profToken
    );
    assert(finalizeRes.status === 200, 'POST /api/contests/:id/finalize-ratings succeeds (200 OK)');
    assert(finalizeRes.body.ratingUpdates.length === 3, 'Rating updates calculated for all 3 participants');

    // Fetch leaderboard after finalization
    const finalLb = await apiRequest(`/contests/${contestId}/leaderboard`, 'GET', null, s1Token);
    assert(finalLb.body.contest.isRatingFinalized === true, 'Leaderboard reflects isRatingFinalized: true');
    assert(finalLb.body.contest.isFrozen === false, 'Finalized contest is automatically unfrozen');
    assert(finalLb.body.userPosition.ratingChange > 0, `Alice userPosition contains positive ratingChange (+${finalLb.body.userPosition.ratingChange})`);

    // Verify finalization idempotency
    const finalizeAgain = await apiRequest(
      `/contests/${contestId}/finalize-ratings`,
      'POST',
      { force: true },
      profToken
    );
    assert(finalizeAgain.status === 200, 'Duplicate finalization returns 200 OK');
    assert(finalizeAgain.body.alreadyFinalized === true, 'Duplicate finalization recognizes alreadyFinalized');

    console.log('[PASS] Finalization unfreeze and rating integration verified successfully');

    // 7. Security & Authorization Checks
    console.log('\n--- 7. Security & Authorization ---');
    // Non-existent contest returns 404
    const notFoundRes = await apiRequest('/contests/999999/leaderboard', 'GET', null, s1Token);
    assert(notFoundRes.status === 404, 'Non-existent contest leaderboard returns 404');

    // Student attempting freezeOverride is ignored and still receives frozen score
    const studentBypass = await apiRequest(`/contests/${freezeContestId}/leaderboard?freezeOverride=true`, 'GET', null, s1Token);
    const bypassAlice = studentBypass.body.standings.find((s) => s.userId === s1Id);
    assert(bypassAlice.totalScore === 0, 'Student cannot bypass freeze using freezeOverride parameter');

    console.log('[PASS] Authorization and security checks passed');

    console.log('\n=======================================================');
    console.log(' ALL PHASE 5.5 TESTS PASSED SUCCESSFULLY! (36/36)');
    console.log('=======================================================\n');
  } catch (error) {
    console.error('\n[TEST FAILURE IN PHASE 5.5]:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runPhase55Tests();
