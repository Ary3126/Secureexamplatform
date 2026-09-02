const http = require('http');
const { app, startServer } = require('./src/server');
const { query, closePool } = require('./src/config/db');
const UserModel = require('./src/models/userModel');

const PORT = 5001; // Use separate port for testing
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
  console.log(' STARTING PHASE 2 AUTOMATED TEST SUITE');
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

  // Clean up any test users from prior runs
  await query("DELETE FROM users WHERE email LIKE '%@test.com'");

  const baseHeaders = { 'Content-Type': 'application/json' };

  try {
    // ----------------------------------------------------
    // 1. REGISTRATION TESTS
    // ----------------------------------------------------
    console.log('\n--- 1. Registration Tests ---');

    // Test 1.1: Valid Registration
    const regRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'test_student_1',
        email: 'student1@test.com',
        password: 'Password123!',
        fullName: 'Test Student One',
      }
    );

    assert(regRes1.status === 201, 'Valid registration returns 201', JSON.stringify(regRes1.body));
    assert(regRes1.body.user && regRes1.body.user.role === 'student', 'Registered user defaults to role: student');
    assert(regRes1.body.user && !regRes1.body.user.password && !regRes1.body.user.password_hash, 'Password and hash are stripped from response');

    // Test 1.2: Registration ignores client-passed role override
    const regRes2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'test_fake_admin',
        email: 'fakeadmin@test.com',
        password: 'Password123!',
        fullName: 'Fake Admin User',
        role: 'super_admin', // Client tries to elevate
      }
    );

    assert(regRes2.status === 201, 'Registration with role injection succeeds', JSON.stringify(regRes2.body));
    assert(regRes2.body.user.role === 'student', 'Injected role is ignored and strictly set to student');

    // Test 1.3: Duplicate email returns 409 Conflict
    const regRes3 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'another_user',
        email: 'student1@test.com', // Duplicate
        password: 'Password123!',
        fullName: 'Another Name',
      }
    );

    assert(regRes3.status === 409, 'Duplicate email returns 409 Conflict', JSON.stringify(regRes3.body));

    // Test 1.4: Duplicate username returns 409 Conflict
    const regRes4 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'test_student_1', // Duplicate
        email: 'different@test.com',
        password: 'Password123!',
        fullName: 'Another Name',
      }
    );

    assert(regRes4.status === 409, 'Duplicate username returns 409 Conflict', JSON.stringify(regRes4.body));

    // Test 1.5: Weak password returns 400 Bad Request
    const regRes5 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'weak_pass_user',
        email: 'weakpass@test.com',
        password: '123', // Weak
        fullName: 'Weak User',
      }
    );

    assert(regRes5.status === 400, 'Weak password (<8 chars) returns 400 Bad Request', JSON.stringify(regRes5.body));

    // Test 1.6: Invalid email format returns 400 Bad Request
    const regRes6 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/register',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        username: 'invalid_email_user',
        email: 'not-an-email',
        password: 'Password123!',
        fullName: 'Invalid Email User',
      }
    );

    assert(regRes6.status === 400, 'Invalid email format returns 400 Bad Request', JSON.stringify(regRes6.body));

    // ----------------------------------------------------
    // 2. LOGIN TESTS
    // ----------------------------------------------------
    console.log('\n--- 2. Login Tests ---');

    // Test 2.1: Valid Login
    const loginRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        email: 'student1@test.com',
        password: 'Password123!',
      }
    );

    assert(loginRes1.status === 200, 'Valid login returns 200 OK', JSON.stringify(loginRes1.body));
    assert(loginRes1.body.token && typeof loginRes1.body.token === 'string', 'Login returns valid JWT token');
    assert(loginRes1.body.user && loginRes1.body.user.role === 'student', 'Login returns authenticated user info');

    const studentToken = loginRes1.body.token;

    // Test 2.2: Wrong Password returns 401
    const loginRes2 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        email: 'student1@test.com',
        password: 'WrongPassword999!',
      }
    );

    assert(loginRes2.status === 401, 'Wrong password returns 401 Unauthorized', JSON.stringify(loginRes2.body));

    // Test 2.3: Non-existent email returns 401
    const loginRes3 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: baseHeaders,
      },
      {
        email: 'nonexistent@test.com',
        password: 'Password123!',
      }
    );

    assert(loginRes3.status === 401, 'Non-existent email returns 401 Unauthorized', JSON.stringify(loginRes3.body));

    // ----------------------------------------------------
    // 3. AUTHENTICATION & PROFILE TESTS
    // ----------------------------------------------------
    console.log('\n--- 3. Authentication & Profile Tests ---');

    // Test 3.1: GET /api/users/me with valid token
    const profileRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/users/me',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${studentToken}`,
      },
    });

    assert(profileRes1.status === 200, 'GET /api/users/me with valid token returns 200 OK', JSON.stringify(profileRes1.body));
    assert(profileRes1.body.username === 'test_student_1', 'Profile returns correct username');
    assert(!profileRes1.body.password_hash, 'Profile does NOT expose password_hash');

    // Test 3.2: GET /api/users/me with missing token returns 401
    const profileRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/users/me',
      method: 'GET',
      headers: baseHeaders,
    });

    assert(profileRes2.status === 401, 'GET /api/users/me without token returns 401 Unauthorized', JSON.stringify(profileRes2.body));

    // Test 3.3: GET /api/users/me with invalid token returns 401
    const profileRes3 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/users/me',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: 'Bearer invalid.token.payload',
      },
    });

    assert(profileRes3.status === 401, 'GET /api/users/me with invalid token returns 401 Unauthorized', JSON.stringify(profileRes3.body));

    // Test 3.4: PUT /api/users/me update fullName and username
    const updateRes1 = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/users/me',
        method: 'PUT',
        headers: {
          ...baseHeaders,
          Authorization: `Bearer ${studentToken}`,
        },
      },
      {
        fullName: 'Ary Updated Patel',
        username: 'test_student_updated',
        role: 'super_admin', // Should be ignored/not updated
      }
    );

    assert(updateRes1.status === 200, 'PUT /api/users/me updates profile successfully', JSON.stringify(updateRes1.body));
    assert(updateRes1.body.user.fullName === 'Ary Updated Patel', 'Full name updated in response');
    assert(updateRes1.body.user.username === 'test_student_updated', 'Username updated in response');
    assert(updateRes1.body.user.role === 'student', 'User role remains student despite client payload injection');

    // ----------------------------------------------------
    // 4. ROLE-BASED ACCESS CONTROL (RBAC) TESTS
    // ----------------------------------------------------
    console.log('\n--- 4. Role-Based Access Control (RBAC) Tests ---');

    // Test 4.1: Student accessing professor endpoint returns 403 Forbidden
    const rbacRes1 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/professor/test',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${studentToken}`,
      },
    });

    assert(rbacRes1.status === 403, 'Student accessing /api/professor/test returns 403 Forbidden', JSON.stringify(rbacRes1.body));

    // Test 4.2: Student accessing admin endpoint returns 403 Forbidden
    const rbacRes2 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/test',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${studentToken}`,
      },
    });

    assert(rbacRes2.status === 403, 'Student accessing /api/admin/test returns 403 Forbidden', JSON.stringify(rbacRes2.body));

    // Create Professor User
    await query("DELETE FROM users WHERE email = 'prof@test.com'");
    const profUser = await UserModel.createUser({
      username: 'prof_john',
      email: 'prof@test.com',
      passwordHash: '$2b$12$eX8V7X7G2Z1jW3e4r5t6y.7u8i9o0p1q2w3e4r5t6y7u8i9o0p1q2', // dummy bcrypt hash
      fullName: 'Professor John',
      role: 'professor',
    });
    const { generateToken } = require('./src/services/authService');
    const profToken = generateToken(profUser);

    // Test 4.3: Professor accessing /api/professor/test returns 200 OK
    const rbacRes3 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/professor/test',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${profToken}`,
      },
    });

    assert(rbacRes3.status === 200, 'Professor accessing /api/professor/test returns 200 OK', JSON.stringify(rbacRes3.body));

    // Create Contest Admin User
    await query("DELETE FROM users WHERE email = 'contestadmin@test.com'");
    const contestAdminUser = await UserModel.createUser({
      username: 'contest_admin_user',
      email: 'contestadmin@test.com',
      passwordHash: '$2b$12$eX8V7X7G2Z1jW3e4r5t6y.7u8i9o0p1q2w3e4r5t6y7u8i9o0p1q2',
      fullName: 'Contest Admin User',
      role: 'contest_admin',
    });
    const contestAdminToken = generateToken(contestAdminUser);

    // Test 4.4: Contest Admin accessing /api/contest-admin/test returns 200 OK
    const rbacRes4 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/contest-admin/test',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${contestAdminToken}`,
      },
    });

    assert(rbacRes4.status === 200, 'Contest Admin accessing /api/contest-admin/test returns 200 OK', JSON.stringify(rbacRes4.body));

    // Create Super Admin User
    await query("DELETE FROM users WHERE email = 'superadmin@test.com'");
    const superAdminUser = await UserModel.createUser({
      username: 'super_admin_user',
      email: 'superadmin@test.com',
      passwordHash: '$2b$12$eX8V7X7G2Z1jW3e4r5t6y.7u8i9o0p1q2w3e4r5t6y7u8i9o0p1q2',
      fullName: 'Super Administrator',
      role: 'super_admin',
    });
    const superAdminToken = generateToken(superAdminUser);

    // Test 4.5: Super Admin accessing /api/admin/test returns 200 OK
    const rbacRes5 = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/admin/test',
      method: 'GET',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${superAdminToken}`,
      },
    });

    assert(rbacRes5.status === 200, 'Super Admin accessing /api/admin/test returns 200 OK', JSON.stringify(rbacRes5.body));

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n=======================================================');
    console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=======================================================\n');

    // Clean up test data
    await query("DELETE FROM users WHERE email LIKE '%@test.com'");
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
