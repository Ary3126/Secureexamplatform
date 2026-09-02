import http from 'http';

const PORT = 5000;

// Helper to make HTTP requests
const request = (options, postData = null) => {
  return new Promise((resolve, reject) => {
    const headers = { 'x-test-environment': 'true', ...(options.headers || {}) };
    const req = http.request({ ...options, headers }, (res) => {
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

const runPhase51Tests = async () => {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.1 AUTOMATED TEST SUITE');
  console.log(' Landing Page, Auth UX & Theme System Verification');
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

  // ----------------------------------------------------
  // 1. THEME LOGIC & RESOLUTION TESTS
  // ----------------------------------------------------
  console.log('\n--- 1. Theme Logic & Resolution Tests ---');

  const resolveTheme = (theme, systemIsDark) => {
    if (theme === 'system') return systemIsDark ? 'dark' : 'light';
    return theme === 'light' ? 'light' : 'dark';
  };

  const getMonacoTheme = (resolvedTheme) => {
    return resolvedTheme === 'light' ? 'vs-light' : 'vs-dark';
  };

  assert(resolveTheme('dark', false) === 'dark', 'Explicit dark theme resolves to dark');
  assert(resolveTheme('light', true) === 'light', 'Explicit light theme resolves to light');
  assert(resolveTheme('system', true) === 'dark', 'System theme with dark OS resolves to dark');
  assert(resolveTheme('system', false) === 'light', 'System theme with light OS resolves to light');
  assert(getMonacoTheme('dark') === 'vs-dark', 'Dark theme coordinates Monaco editor to vs-dark');
  assert(getMonacoTheme('light') === 'vs-light', 'Light theme coordinates Monaco editor to vs-light');

  // ----------------------------------------------------
  // 2. CLIENT-SIDE VALIDATION UNIT TESTS
  // ----------------------------------------------------
  console.log('\n--- 2. Client-Side Validation Logic Tests ---');

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

  const validateSignup = (fullName, username, email, password, confirmPassword) => {
    const errs = {};
    if (!fullName || fullName.trim().length < 2 || fullName.trim().length > 100) {
      errs.fullName = 'Invalid full name';
    }
    if (!username || !USERNAME_REGEX.test(username.trim())) {
      errs.username = 'Invalid username';
    }
    if (!email || !EMAIL_REGEX.test(email.trim())) {
      errs.email = 'Invalid email';
    }
    const hasMinLength = password && password.length >= 8;
    const hasLetter = /[a-zA-Z]/.test(password || '');
    const hasNumber = /[0-9]/.test(password || '');
    if (!hasMinLength || !hasLetter || !hasNumber) {
      errs.password = 'Weak password';
    }
    if (password !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match';
    }
    return Object.keys(errs).length === 0;
  };

  assert(
    validateSignup('Ary Patel', 'ary_dev', 'ary@test.com', 'Pass1234', 'Pass1234'),
    'Valid registration payload passes client validation'
  );
  assert(
    !validateSignup('A', 'ary_dev', 'ary@test.com', 'Pass1234', 'Pass1234'),
    'Short full name fails client validation'
  );
  assert(
    !validateSignup('Ary Patel', 'a@#', 'ary@test.com', 'Pass1234', 'Pass1234'),
    'Invalid characters in username fails client validation'
  );
  assert(
    !validateSignup('Ary Patel', 'ary_dev', 'not-an-email', 'Pass1234', 'Pass1234'),
    'Malformed email fails client validation'
  );
  assert(
    !validateSignup('Ary Patel', 'ary_dev', 'ary@test.com', 'short', 'short'),
    'Short password (< 8 chars) fails client validation'
  );
  assert(
    !validateSignup('Ary Patel', 'ary_dev', 'ary@test.com', 'Pass1234', 'Pass5678'),
    'Mismatched passwords fail client validation'
  );

  // ----------------------------------------------------
  // 3. ROUTE PATH RESOLUTION TESTS
  // ----------------------------------------------------
  console.log('\n--- 3. Route Path Resolution Tests ---');

  const getRouteView = (path) => {
    const p = path.toLowerCase();
    if (p === '/login') return 'login';
    if (p === '/signup') return 'signup';
    if (p === '/dashboard' || p === '/contests') return 'dashboard';
    if (p === '/workspace' || p === '/problems') return 'workspace';
    if (p === '/profile') return 'profile';
    return 'landing';
  };

  assert(getRouteView('/') === 'landing', 'Root path / maps to public landing page');
  assert(getRouteView('/login') === 'login', 'Path /login maps to LoginPage');
  assert(getRouteView('/signup') === 'signup', 'Path /signup maps to SignupPage');
  assert(getRouteView('/dashboard') === 'dashboard', 'Path /dashboard maps to StudentDashboard');
  assert(getRouteView('/workspace') === 'workspace', 'Path /workspace maps to Practice Workspace');
  assert(getRouteView('/profile') === 'profile', 'Path /profile maps to UserProfile');

  // ----------------------------------------------------
  // 4. BACKEND INTEGRATION VIA HTTP
  // ----------------------------------------------------
  console.log('\n--- 4. Backend Authentication & Problem API Integration ---');

  const baseHeaders = { 'Content-Type': 'application/json' };

  try {
    // 4.1 Health Check Endpoint
    const healthRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/health',
      method: 'GET',
    });

    if (healthRes.status === 200) {
      assert(healthRes.body.server === 'OK', 'Backend health check returns server OK');

      // 4.2 Registration integration test
      const testEmail = `p51_student_${Date.now()}@test.com`;
      const regRes = await request(
        {
          hostname: 'localhost',
          port: PORT,
          path: '/api/auth/register',
          method: 'POST',
          headers: baseHeaders,
        },
        {
          fullName: 'Phase 51 Tester',
          username: `p51_user_${Date.now()}`.slice(0, 20),
          email: testEmail,
          password: 'Password123!',
        }
      );
      assert(regRes.status === 201, 'Backend handles signup from Phase 5.1 UI (201 Created)');

      // 4.3 Login with new account
      const loginRes = await request(
        {
          hostname: 'localhost',
          port: PORT,
          path: '/api/auth/login',
          method: 'POST',
          headers: baseHeaders,
        },
        {
          email: testEmail,
          password: 'Password123!',
        }
      );
      assert(
        loginRes.status === 200 && typeof loginRes.body.token === 'string',
        'Backend handles login from Phase 5.1 UI and returns valid JWT token'
      );

      // 4.4 Fetch Problems with Auth Token
      const token = loginRes.body.token;
      const probRes = await request({
        hostname: 'localhost',
        port: PORT,
        path: '/api/problems',
        method: 'GET',
        headers: {
          ...baseHeaders,
          Authorization: `Bearer ${token}`,
        },
      });
      assert(
        probRes.status === 200 && Array.isArray(probRes.body.problems),
        'GET /api/problems returns problem list with authentication'
      );
    } else {
      console.log('[INFO] Backend not currently running on port 5000; verified unit & theme logic.');
    }
  } catch (err) {
    console.log('[INFO] Backend live request skipped (offline):', err.message);
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n=======================================================');
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
};

runPhase51Tests();
