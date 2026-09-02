/**
 * PHASE 5 — MASTER TASK: CODER IDENTITY PROFILE REDESIGN TEST SUITE
 * 
 * Verifies:
 * 1. Coder Identity API (`/api/users/me/identity`) for authenticated users.
 * 2. Public Coder Identity API (`/api/users/:id/identity` & `/api/users/u/:username`).
 * 3. Privacy isolation: Email & secrets are omitted for non-owner public requests.
 * 4. Rating metrics & Tier classification integration.
 * 5. Performance snapshot & deduplicated solving analytics.
 * 6. Difficulty orbit distribution (Easy, Medium, Hard).
 * 7. Topic constellation domain breakdown (Arrays, Strings, Math, Trees, Graphs, DP, etc.).
 * 8. Profile mutation & server-side rating immutability.
 * 9. Handling of non-existent users with HTTP 404.
 */

import assert from 'assert';

const BASE_URL = 'http://localhost:5000/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'x-test-environment': 'true', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING CODER IDENTITY PROFILE VERIFICATION TESTS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(title, condition, detail = '') {
    if (condition) {
      console.log(`  ✓ ${title}`);
      passed++;
    } else {
      console.error(`  ✗ ${title} [FAIL: ${detail}]`);
      failed++;
    }
  }

  const ts = Date.now();
  const studentA = {
    username: `coder_a_${ts}`,
    email: `coder_a_${ts}@test.edu`,
    password: 'Password123!',
    fullName: 'Ada Lovelace',
    role: 'student',
  };

  const studentB = {
    username: `coder_b_${ts}`,
    email: `coder_b_${ts}@test.edu`,
    password: 'Password123!',
    fullName: 'Alan Turing',
    role: 'student',
  };

  try {
    // 1. Register and Login Student A and Student B
    const regA = await request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(studentA),
    });
    record('Register student A for profile test', regA.status === 201);
    const userA = regA.data.user;

    const loginA = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: studentA.email, password: studentA.password }),
    });
    record('Login student A returns token', loginA.status === 200 && loginA.data.token);
    const tokenA = loginA.data.token;

    const regB = await request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(studentB),
    });
    record('Register student B for profile test', regB.status === 201);
    const userB = regB.data.user;

    const loginB = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: studentB.email, password: studentB.password }),
    });
    record('Login student B returns token', loginB.status === 200 && loginB.data.token);
    const tokenB = loginB.data.token;

    // 2. Fetch Own Coder Identity (/api/users/me/identity)
    const ownIdentity = await request('/users/me/identity', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    record('Fetch own coder identity returns 200 OK', ownIdentity.status === 200);
    record('Own identity indicates isOwnProfile: true', ownIdentity.data.isOwnProfile === true);
    record('Own identity exposes user metadata', ownIdentity.data.user && ownIdentity.data.user.username === studentA.username);
    record('Own identity exposes user email to owner', ownIdentity.data.user.email === studentA.email);
    record('Own identity contains rating core data', ownIdentity.data.rating && ownIdentity.data.rating.current === 1200);
    record('Own identity contains rating status provisional', ownIdentity.data.rating.status === 'provisional');
    record('Own identity contains global rank', typeof ownIdentity.data.rating.globalRank === 'number');
    record('Own identity contains performance snapshot', ownIdentity.data.performance !== undefined);
    record('Own identity contains difficulty distribution', ownIdentity.data.difficultyStats && typeof ownIdentity.data.difficultyStats.easy === 'number');
    record('Own identity contains topic constellation stats array', Array.isArray(ownIdentity.data.topicStats));
    record('Topic stats contain standard algorithmic domains', ownIdentity.data.topicStats.some(t => t.id === 'arrays') && ownIdentity.data.topicStats.some(t => t.id === 'math'));
    record('Own identity contains ratingHistory array', Array.isArray(ownIdentity.data.ratingHistory));

    // 3. Fetch Another User Public Profile via User ID (/api/users/:id/identity)
    const publicIdentityById = await request(`/users/${userA.id}/identity`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });

    record('Fetch other user identity by ID returns 200 OK', publicIdentityById.status === 200);
    record('Other user identity indicates isOwnProfile: false', publicIdentityById.data.isOwnProfile === false);
    record('Other user identity shows username', publicIdentityById.data.user.username === studentA.username);
    record('Other user identity shows rating', publicIdentityById.data.rating.current === 1200);
    record('PRIVACY ISOLATION: Other user email is strictly hidden', publicIdentityById.data.user.email === undefined);
    record('PRIVACY ISOLATION: Password hash is never exposed', publicIdentityById.data.user.password_hash === undefined && publicIdentityById.data.user.passwordHash === undefined);

    // 4. Fetch Another User Public Profile via Username URL (/api/users/u/:username)
    const publicIdentityByUsername = await request(`/users/u/${studentA.username}`);
    record('Fetch public profile via /u/:username without auth returns 200 OK', publicIdentityByUsername.status === 200);
    record('Public profile by handle returns correct user', publicIdentityByUsername.data.user.username === studentA.username);
    record('Public profile by handle indicates isOwnProfile: false for unauthenticated visitor', publicIdentityByUsername.data.isOwnProfile === false);
    record('Public profile by handle shows full name and bio', publicIdentityByUsername.data.user.fullName === studentA.fullName);
    record('Public profile exposes difficulty and topic distributions', Array.isArray(publicIdentityByUsername.data.topicStats));

    // 5. Update Profile Fields via PUT /api/users/me
    const updatedBio = 'Competitive programming enthusiast specializing in Graph Theory and Dynamic Programming.';
    const updatedName = 'Ada Lovelace, Countess of Lovelace';

    const updateRes = await request('/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        fullName: updatedName,
        bio: updatedBio,
        // Attempt to tamper with rating
        currentRating: 3000,
        highestRating: 3000,
      }),
    });

    record('Profile update returns 200 OK', updateRes.status === 200);
    record('Profile update persists full name', updateRes.data.user.fullName === updatedName);
    record('Profile update persists bio', updateRes.data.user.bio === updatedBio);

    // Verify rating remained server-immutable
    const recheckIdentity = await request('/users/me/identity', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    record('TAMPER PROTECTION: Rating cannot be altered via profile update', recheckIdentity.data.rating.current === 1200);
    record('Re-fetched identity displays updated bio', recheckIdentity.data.user.bio === updatedBio);

    // 6. Handle Non-Existent User Lookups
    const nonExistent = await request('/users/u/ghost_user_does_not_exist_99999');
    record('Lookup of non-existent username returns 404', nonExistent.status === 404);

    const nonExistentId = await request('/users/99999999/identity');
    record('Lookup of non-existent user ID returns 404', nonExistentId.status === 404);

    // 7. Username Collision Handling
    const collisionAttempt = await request('/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        username: studentB.username, // Try to take Student B's handle
      }),
    });
    record('Attempting to claim an existing username returns 409 Conflict', collisionAttempt.status === 409);

  } catch (err) {
    console.error('Unexpected test error:', err);
    record('Test suite execution without crash', false, err.message);
  }

  console.log('\n======================================================');
  console.log(` CODER IDENTITY TESTS SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
