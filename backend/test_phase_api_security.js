/**
 * Step 2 Verification Test Suite — API Security Hardening & Rate Limiting
 */

process.env.NODE_ENV = 'test';
process.env.USE_DOCKER = 'false';

const assert = require('assert');
const http = require('http');
const { app, startServer } = require('./src/server');
const { closePool } = require('./src/config/db');
const { createRateLimiter, getSafeClientIp } = require('./src/middleware/rateLimitMiddleware');
const RATE_LIMIT_CONFIG = require('./src/config/rateLimitConfig');
const judgeQueue = require('./src/judge/queue/judgeQueue');

let serverInstance;
let baseUrl = '';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsedData = null;
          try {
            parsedData = JSON.parse(rawData);
          } catch {
            parsedData = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsedData,
          });
        });
      }
    );

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING API SECURITY & RATE LIMITING TEST SUITE      ');
  console.log(' (Step 2 - Tiered Limits, 429s, Anti-Spoof, Headers)   ');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log('[PASS] ' + name);
      passed++;
    } catch (err) {
      console.error('[FAIL] ' + name + ':', err.message);
      failed++;
    }
  };

  try {
    serverInstance = await startServer();
    const port = serverInstance.address().port;
    baseUrl = 'http://localhost:' + port;

    const testUserEmail = 'sec_user_' + Date.now() + '@example.com';
    const testUsername = 'sec_user_' + Date.now();
    const testPassword = 'Password123!';
    let studentToken = '';

    console.log('--- 1. User Setup & Basic Authentication ---');
    await test('Registers test student account', async () => {
      const res = await makeRequest('POST', '/api/auth/register', {
        username: testUsername,
        email: testUserEmail,
        password: testPassword,
        fullName: 'Security Test Student',
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.user.role, 'student');
    });

    await test('Authenticates test student and retrieves JWT token', async () => {
      const res = await makeRequest('POST', '/api/auth/login', {
        email: testUserEmail,
        password: testPassword,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.token);
      studentToken = res.body.token;
    });

    console.log('\n--- 2. Centralized Rate Limiting & HTTP 429 Verification ---');
    await test('Allows requests below configured rate limit', async () => {
      const customLimiter = createRateLimiter({
        name: 'TEST_POLICY_1',
        windowMs: 5000,
        maxRequests: 3,
      });

      const mockReq = {
        headers: { 'x-test-rate-limit': 'true' },
        user: { id: 9901 },
        originalUrl: '/test',
        method: 'GET',
      };
      let nextCount = 0;
      const mockRes = {
        setHeader: () => {},
        status: () => ({ json: () => {} }),
      };

      customLimiter(mockReq, mockRes, () => nextCount++);
      customLimiter(mockReq, mockRes, () => nextCount++);
      customLimiter(mockReq, mockRes, () => nextCount++);

      assert.strictEqual(nextCount, 3, 'First 3 requests should pass through');
    });

    await test('Returns HTTP 429 Too Many Requests when limit exceeded', async () => {
      const customLimiter = createRateLimiter({
        name: 'TEST_POLICY_2',
        windowMs: 5000,
        maxRequests: 2,
        message: 'Rate limit test exceeded',
      });

      const mockReq = {
        headers: { 'x-test-rate-limit': 'true' },
        user: { id: 9902 },
        originalUrl: '/test-429',
        method: 'GET',
      };
      const mockRes = {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(k, v) {
          this.headers[k] = v;
        },
        status(code) {
          this.statusCode = code;
          return {
            json: (b) => {
              this.body = b;
            },
          };
        },
      };

      // Request 1 & 2 pass
      customLimiter(mockReq, mockRes, () => {});
      customLimiter(mockReq, mockRes, () => {});

      // Request 3 exceeds limit
      customLimiter(mockReq, mockRes, () => {});

      assert.strictEqual(mockRes.statusCode, 429);
      assert.strictEqual(mockRes.body.error, 'RATE_LIMIT_EXCEEDED');
      assert.strictEqual(mockRes.body.message, 'Rate limit test exceeded');
      assert.ok(mockRes.headers['Retry-After'] >= 1, 'Retry-After header must be set');
      assert.strictEqual(mockRes.headers['X-RateLimit-Remaining'], 0);
    });

    console.log('\n--- 3. Client IP Anti-Spoofing Validation ---');
    await test('Rejects spoofed X-Forwarded-For when TRUST_PROXY is false', async () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '203.0.113.195, 198.51.100.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
      };

      const resolvedIp = getSafeClientIp(mockReq);
      assert.strictEqual(resolvedIp, '127.0.0.1', 'Untrusted proxy header must not override real socket address');
    });

    console.log('\n--- 4. Account Identifier & Auth Protection ---');
    await test('Tracks account identifier across login attempts', async () => {
      const authLimiter = createRateLimiter({
        name: 'TEST_AUTH',
        windowMs: 5000,
        maxRequests: 2,
        trackIdentifier: true,
      });

      const mockReq1 = {
        headers: { 'x-test-rate-limit': 'true' },
        body: { email: 'victim@example.com' },
        socket: { remoteAddress: '10.0.0.1' },
      };
      const mockReq2 = {
        headers: { 'x-test-rate-limit': 'true' },
        body: { email: 'victim@example.com' },
        socket: { remoteAddress: '10.0.0.2' },
      };

      const mockRes = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        status(code) {
          this.statusCode = code;
          return { json: () => {} };
        },
      };

      authLimiter(mockReq1, mockRes, () => {});
      authLimiter(mockReq2, mockRes, () => {});

      // 3rd request for same account identifier must be throttled
      authLimiter(mockReq1, mockRes, () => {});
      assert.strictEqual(mockRes.statusCode, 429, 'Ident-based brute force must trigger 429');
    });

    console.log('\n--- 5. Judge Queue Per-User Concurrency Guard ---');
    await test('Limits concurrent pending/running jobs per user', async () => {
      const userId = 8812;
      judgeQueue.userActiveJobs.set(userId, RATE_LIMIT_CONFIG.SUBMIT_CODE.maxConcurrentPerUser);

      const enqueued = judgeQueue.addJob({
        submissionId: 99991,
        userId,
        isSampleRun: false,
      });

      assert.strictEqual(enqueued, false, 'Excess submission must be rejected early');
      judgeQueue.userActiveJobs.delete(userId);
    });

    console.log('\n--- 6. Security Headers (Helmet CSP, X-Content-Type, Referrer) ---');
    await test('Sets hardened security headers without breaking frontend', async () => {
      const res = await makeRequest('GET', '/');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.ok(res.headers['content-security-policy'], 'CSP header must be present');
    });

    console.log('\n--- 7. CORS Hardening & Credentials Policy ---');
    await test('Allows configured frontend origin with credentials', async () => {
      const res = await makeRequest('OPTIONS', '/api/contests', null, {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      });
      assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5173');
      assert.strictEqual(res.headers['access-control-allow-credentials'], 'true');
    });

    console.log('\n--- 8. Request Size & Payload Protection ---');
    await test('Rejects oversized JSON payload (>512KB) with 413 Payload Too Large', async () => {
      const oversizedPayload = {
        sourceCode: 'A'.repeat(600 * 1024),
      };
      const res = await makeRequest('POST', '/api/submissions', oversizedPayload, {
        Authorization: 'Bearer ' + studentToken,
      });
      assert.strictEqual(res.statusCode, 413, 'Oversized payload must receive 413');
    });

    console.log('\n--- 9. Pagination Clamping Defense ---');
    await test('Clamps excessive pagination limits (limit=9999999 clamped to max 100)', async () => {
      const res = await makeRequest('GET', '/api/problems?page=1&limit=9999999', null, {
        Authorization: 'Bearer ' + studentToken,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.pagination);
      assert.strictEqual(res.body.pagination.limit, 100, 'Limit must be clamped to 100');
    });

    await test('Clamps excessive contest pagination limits safely', async () => {
      const res = await makeRequest('GET', '/api/contests?limit=50000', null, {
        Authorization: 'Bearer ' + studentToken,
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.contests);
    });

    console.log('\n--- 10. Sanitized Error Handling (No Internals Leaked) ---');
    await test('Sanitizes 404 endpoint not found response', async () => {
      const res = await makeRequest('GET', '/api/non-existent-endpoint-test');
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.error, 'NOT_FOUND');
      assert.ok(res.body.message.includes('Endpoint not found'));
      assert.strictEqual(res.body.stack, undefined, 'Stack trace must not be exposed');
    });

    console.log('\n=======================================================');
    console.log(' API SECURITY TEST SUMMARY: ' + passed + ' PASSED, ' + failed + ' FAILED');
    console.log('=======================================================');

    if (serverInstance) {
      serverInstance.close();
    }
    await closePool();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    if (serverInstance) {
      serverInstance.close();
    }
    await closePool();
    process.exit(1);
  }
}

runTests();
