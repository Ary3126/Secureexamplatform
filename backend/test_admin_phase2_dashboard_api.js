/**
 * Automated Test Suite for Admin Panel Phase 2: Dashboard API & RBAC
 * 
 * Verifies that:
 * 1. GET /api/admin/overview-stats requires authentication (401)
 * 2. Student role is denied access (403)
 * 3. Professor role is denied access (403)
 * 4. Super Admin role receives 200 OK with real platform metrics
 * 5. Data structures and sanitization guarantees are strictly enforced
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { generateToken, hashPassword } = require('./src/services/authService');
const adminRoutes = require('./src/routes/adminRoutes');
const { errorHandler } = require('./src/middleware/errorHandler');

let server;
let baseUrl;
let studentToken;
let profToken;
let superAdminToken;
let testUsers = [];

async function makeRequest(path, token = null) {
  const url = `${baseUrl}${path}`;
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('Admin Panel Phase 2: Dashboard API & RBAC Suite', () => {
  before(async () => {
    // 1. Setup ephemeral test server
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use(errorHandler);

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // 2. Provision distinct test users
    const pwdHash = await hashPassword('Password123!');
    const timestamp = Date.now();

    const sRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name)
       VALUES ($1, $2, $3, 'student', true, 'Test Student') RETURNING id, role;`,
      [`std_${timestamp}`, `std_${timestamp}@test.com`, pwdHash]
    );
    testUsers.push(sRes.rows[0].id);
    studentToken = generateToken(sRes.rows[0]);

    const pRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name)
       VALUES ($1, $2, $3, 'professor', true, 'Test Professor') RETURNING id, role;`,
      [`prf_${timestamp}`, `prf_${timestamp}@test.com`, pwdHash]
    );
    testUsers.push(pRes.rows[0].id);
    profToken = generateToken(pRes.rows[0]);

    const aRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active, full_name)
       VALUES ($1, $2, $3, 'super_admin', true, 'Test Super Admin') RETURNING id, role;`,
      [`adm_${timestamp}`, `adm_${timestamp}@test.com`, pwdHash]
    );
    testUsers.push(aRes.rows[0].id);
    superAdminToken = generateToken(aRes.rows[0]);
  });

  after(async () => {
    // Cleanup test server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    // Cleanup test users
    if (testUsers.length > 0) {
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [testUsers]);
    }
  });

  it('1. Unauthenticated request to /api/admin/overview-stats returns 401 Unauthorized', async () => {
    const res = await makeRequest('/api/admin/overview-stats');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data?.error, 'AUTHENTICATION_ERROR');
  });

  it('2. Student request to /api/admin/overview-stats returns 403 Forbidden', async () => {
    const res = await makeRequest('/api/admin/overview-stats', studentToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data?.error, 'AUTHORIZATION_ERROR');
  });

  it('3. Professor request to /api/admin/overview-stats returns 403 Forbidden', async () => {
    const res = await makeRequest('/api/admin/overview-stats', profToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data?.error, 'AUTHORIZATION_ERROR');
  });

  it('4. Super Admin request to /api/admin/overview-stats returns 200 OK with real metric objects', async () => {
    const res = await makeRequest('/api/admin/overview-stats', superAdminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data?.status, 'success');

    const data = res.data?.data;
    assert.ok(data, 'data payload must exist');

    // Users metrics
    assert.strictEqual(typeof data.users?.total_users, 'number');
    assert.strictEqual(typeof data.users?.total_students, 'number');
    assert.strictEqual(typeof data.users?.total_professors, 'number');
    assert.strictEqual(typeof data.users?.total_admins, 'number');

    // Contests metrics
    assert.strictEqual(typeof data.contests?.total_contests, 'number');
    assert.strictEqual(typeof data.contests?.active_contests, 'number');
    assert.strictEqual(typeof data.contests?.upcoming_contests, 'number');

    // Contest overview array
    assert.ok(Array.isArray(data.recentContests), 'recentContests must be an array');

    // Problems metrics
    assert.strictEqual(typeof data.problems?.total_problems, 'number');
    assert.strictEqual(typeof data.problems?.published_problems, 'number');

    // Review metrics
    assert.strictEqual(typeof data.reviews?.total_queue, 'number');

    // Recent activity stream
    assert.ok(Array.isArray(data.recentActivity), 'recentActivity must be an array');

    // Basic system health
    assert.strictEqual(data.system?.databaseStatus, 'connected');
    assert.strictEqual(data.system?.apiStatus, 'HEALTHY');
    assert.strictEqual(typeof data.system?.databaseLatencyMs, 'number');
    assert.ok(data.system?.judgeStatus, 'judgeStatus must be present');
    assert.strictEqual(typeof data.system?.uptimeSeconds, 'number');
  });

  it('5. Security check: responses NEVER expose passwords, hashes, or tokens', async () => {
    const res = await makeRequest('/api/admin/overview-stats', superAdminToken);
    const jsonStr = JSON.stringify(res.data);

    assert.strictEqual(jsonStr.includes('password_hash'), false, 'password_hash must not appear');
    assert.strictEqual(jsonStr.includes('passwordHash'), false, 'passwordHash must not appear');
    assert.strictEqual(jsonStr.includes('jwt_secret'), false, 'jwt_secret must not appear');
  });
});
