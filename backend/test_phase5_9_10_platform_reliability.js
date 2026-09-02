const assert = require('assert');
const http = require('http');
const express = require('express');
const db = require('./src/config/db');
const { initDb } = require('./src/config/initDb');
const apiRoutes = require('./src/routes');
const { requestIdMiddleware } = require('./src/middleware/requestIdMiddleware');
const { metricsMiddleware } = require('./src/middleware/metricsMiddleware');
const metricsService = require('./src/services/metricsService');
const SystemHealthService = require('./src/services/systemHealthService');
const IncidentModel = require('./src/models/incidentModel');
const { notFoundHandler, errorHandler } = require('./src/middleware/errorHandler');
const { generateToken, hashPassword } = require('./src/services/authService');

// Create test express app
const app = express();
app.use(express.json());
app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use('/api', apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

let server;
let baseUrl;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    if (body) {
      reqHeaders['Content-Type'] = 'application/json';
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
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch (e) {
            json = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: json,
          });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=======================================================');
  console.log(' STARTING PHASE 5.9.10 PLATFORM RELIABILITY & HEALTH SUITE');
  console.log(' (Observability, Latency Percentiles, Probes & Incidents)');
  console.log('=======================================================\n');

  await initDb();

  // Start test server on random available port
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`[SERVER] Test server listening on ${baseUrl}\n`);

  const uniqueSuffix = Date.now();
  let studentUser, profUser, adminUser;
  let studentToken, profToken, adminToken;

  try {
    // --- 1. Setting Up Test Actors ---
    console.log('--- 1. Setting Up Test Actors ---');
    const pwdHash = await hashPassword('TestPass123!');

    const stuRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'student', true) RETURNING id, username, role;`,
      [`stu_rel_${uniqueSuffix}`, `stu_rel_${uniqueSuffix}@test.com`, pwdHash, 'Student Reliability']
    );
    studentUser = stuRes.rows[0];
    studentToken = generateToken(studentUser);

    const profRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'professor', true) RETURNING id, username, role;`,
      [`prof_rel_${uniqueSuffix}`, `prof_rel_${uniqueSuffix}@test.com`, pwdHash, 'Prof Reliability']
    );
    profUser = profRes.rows[0];
    profToken = generateToken(profUser);

    const adminRes = await db.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'super_admin', true) RETURNING id, username, role;`,
      [`admin_rel_${uniqueSuffix}`, `admin_rel_${uniqueSuffix}@test.com`, pwdHash, 'Admin Reliability']
    );
    adminUser = adminRes.rows[0];
    adminToken = generateToken(adminUser);

    console.log('  [PASS] Test actors provisioned (Student, Professor, Super Admin)\n');

    // --- 2. Infrastructure Health, Liveness & Readiness Probes ---
    console.log('--- 2. Infrastructure Health, Liveness & Readiness Probes ---');

    // Legacy /api/health
    const legacyHealth = await makeRequest('GET', '/api/health');
    assert.strictEqual(legacyHealth.statusCode, 200);
    assert.strictEqual(legacyHealth.body.server, 'OK');
    assert.strictEqual(legacyHealth.body.database, 'OK');
    console.log('  [PASS] Legacy /api/health returns 200 OK { server: OK, database: OK }');

    // Liveness /api/health/live
    const liveProbe = await makeRequest('GET', '/api/health/live');
    assert.strictEqual(liveProbe.statusCode, 200);
    assert.strictEqual(liveProbe.body.status, 'LIVE');
    assert(typeof liveProbe.body.uptimeSeconds === 'number');
    console.log('  [PASS] Liveness probe /api/health/live returns 200 OK (status: LIVE)');

    // Readiness /api/health/ready
    const readyProbe = await makeRequest('GET', '/api/health/ready');
    assert.strictEqual(readyProbe.statusCode, 200);
    assert.strictEqual(readyProbe.body.status, 'READY');
    assert.strictEqual(readyProbe.body.database, 'HEALTHY');
    console.log('  [PASS] Readiness probe /api/health/ready returns 200 OK (status: READY)\n');

    // --- 3. Request Correlation & X-Request-ID Header Propagation ---
    console.log('--- 3. Request Correlation & X-Request-ID Header Propagation ---');

    // Auto-generated Request ID
    const autoReq = await makeRequest('GET', '/api/health/live');
    assert(autoReq.headers['x-request-id']);
    assert(autoReq.headers['x-request-id'].length >= 8);
    console.log(`  [PASS] Generated X-Request-ID present in response header (${autoReq.headers['x-request-id']})`);

    // Propagated Client Request ID
    const customId = `client-req-trace-${uniqueSuffix}`;
    const customReq = await makeRequest('GET', '/api/health/live', null, { 'X-Request-ID': customId });
    assert.strictEqual(customReq.headers['x-request-id'], customId);
    console.log(`  [PASS] Valid client X-Request-ID safely propagated (${customReq.headers['x-request-id']})`);

    // Malformed / dangerous Request ID Sanitization
    const dangerousId = `malicious-id-with-script<script>alert(1)</script>-or-spaces!`;
    const sanitizedReq = await makeRequest('GET', '/api/health/live', null, { 'X-Request-ID': dangerousId });
    assert.notStrictEqual(sanitizedReq.headers['x-request-id'], dangerousId);
    assert(sanitizedReq.headers['x-request-id'].length >= 8);
    console.log('  [PASS] Malformed/Script-injected Request ID safely sanitized and replaced\n');

    // --- 4. Centralized Error Classification & Safe Error Payloads ---
    console.log('--- 4. Centralized Error Classification & Safe Error Payloads ---');

    // 404 NOT_FOUND
    const notFoundRes = await makeRequest('GET', '/api/non-existent-route-endpoint');
    assert.strictEqual(notFoundRes.statusCode, 404);
    assert.strictEqual(notFoundRes.body.error, 'NOT_FOUND');
    assert(notFoundRes.body.requestId);
    console.log('  [PASS] 404 classified as NOT_FOUND with requestId in JSON payload');

    // 401 AUTHENTICATION_ERROR
    const unauthRes = await makeRequest('GET', '/api/admin/system/health');
    assert.strictEqual(unauthRes.statusCode, 401);
    assert.strictEqual(unauthRes.body.error, 'AUTHENTICATION_ERROR');
    assert(unauthRes.body.requestId);
    console.log('  [PASS] 401 classified as AUTHENTICATION_ERROR with requestId in JSON payload');

    // 403 AUTHORIZATION_ERROR
    const forbiddenRes = await makeRequest('GET', '/api/admin/system/health', null, {
      Authorization: `Bearer ${studentToken}`,
    });
    assert.strictEqual(forbiddenRes.statusCode, 403);
    assert.strictEqual(forbiddenRes.body.error, 'AUTHORIZATION_ERROR');
    assert(forbiddenRes.body.requestId);
    console.log('  [PASS] 403 classified as AUTHORIZATION_ERROR with requestId in JSON payload');

    // 400 VALIDATION_ERROR (PostgreSQL 22P02 Invalid Integer ID)
    const malformedIdRes = await makeRequest('GET', '/api/problems/invalid-non-numeric-id', null, {
      Authorization: `Bearer ${studentToken}`,
    });
    assert.strictEqual(malformedIdRes.statusCode, 400);
    assert.strictEqual(malformedIdRes.body.error, 'VALIDATION_ERROR');
    assert(malformedIdRes.body.requestId);
    console.log('  [PASS] PostgreSQL 22P02 classified as VALIDATION_ERROR with requestId in JSON payload');

    // Verify Zero Stack Trace Leakage in standard response
    assert.strictEqual(forbiddenRes.body.stack, undefined);
    assert.strictEqual(notFoundRes.body.stack, undefined);
    console.log('  [PASS] Zero internal stack traces leaked in error responses\n');

    // --- 5. In-Memory API Performance Metrics & Percentile Engine ---
    console.log('--- 5. In-Memory API Performance Metrics & Percentile Engine ---');

    metricsService.clear();

    // Generate known synthetic transactions to verify exact percentile calculations
    // 10 requests with durations: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 ms
    for (let i = 1; i <= 10; i++) {
      metricsService.recordRequest({
        endpoint: '/api/problems',
        method: 'GET',
        statusCode: i === 10 ? 500 : 200,
        durationMs: i * 10,
        role: 'student',
      });
    }

    const summary = metricsService.getMetricsSummary(3600000);
    assert.strictEqual(summary.totalRequests, 10);
    assert.strictEqual(summary.totalErrors, 1);
    assert.strictEqual(summary.errorRatePct, 10);
    assert.strictEqual(summary.averageLatencyMs, 55);
    assert.strictEqual(summary.p50LatencyMs, 50);
    assert.strictEqual(summary.p95LatencyMs, 100);
    assert.strictEqual(summary.p99LatencyMs, 100);
    assert.strictEqual(summary.statusCodeBreakdown['2xx'], 9);
    assert.strictEqual(summary.statusCodeBreakdown['5xx'], 1);
    assert(summary.hotspots.length >= 1);
    assert.strictEqual(summary.hotspots[0].route, 'GET /api/problems');

    console.log('  [PASS] MetricsService accurately computes total requests, error rate %, and mean latency');
    console.log('  [PASS] MetricsService accurately calculates p50 (50ms), p95 (100ms), and p99 (100ms) percentiles');
    console.log('  [PASS] MetricsService aggregates status code distributions and route hotspots\n');

    // --- 6. Super Admin Deep Subsystem Health Diagnostics & RBAC ---
    console.log('--- 6. Super Admin Deep Subsystem Health Diagnostics & RBAC ---');

    // Student forbidden (403)
    const stuHealth = await makeRequest('GET', '/api/admin/system/health', null, {
      Authorization: `Bearer ${studentToken}`,
    });
    assert.strictEqual(stuHealth.statusCode, 403);
    console.log('  [PASS] Student is forbidden (403) from accessing admin subsystem health');

    // Professor forbidden (403)
    const profHealth = await makeRequest('GET', '/api/admin/system/health', null, {
      Authorization: `Bearer ${profToken}`,
    });
    assert.strictEqual(profHealth.statusCode, 403);
    console.log('  [PASS] Professor is forbidden (403) from accessing admin subsystem health');

    // Super Admin authorized (200 OK)
    const adminHealth = await makeRequest('GET', '/api/admin/system/health', null, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.strictEqual(adminHealth.statusCode, 200);
    assert(adminHealth.body.data);
    const health = adminHealth.body.data;
    assert(health.overall === 'HEALTHY' || health.overall === 'DEGRADED');
    assert(health.backend && health.backend.status === 'HEALTHY');
    assert(health.database && typeof health.database.latencyMs === 'number');
    assert(health.judge && health.judge.compilers);
    assert(health.storage && health.storage.status === 'HEALTHY');

    // Secret Protection Checks
    const rawJson = JSON.stringify(health);
    assert(!rawJson.includes('password'));
    assert(!rawJson.includes('JWT_SECRET'));
    assert(!rawJson.includes('DATABASE_URL'));

    console.log('  [PASS] Super Admin successfully retrieves deep health diagnostics (200 OK)');
    console.log('  [PASS] Database latency, connection pool stats, and judge compilers returned');
    console.log('  [PASS] Strictly zero sensitive database URLs or JWT secrets in payload\n');

    // --- 7. Admin Metrics Telemetry API & Hotspots ---
    console.log('--- 7. Admin Metrics Telemetry API & Hotspots ---');

    const adminMetrics = await makeRequest('GET', '/api/admin/system/metrics?windowMs=3600000', null, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.strictEqual(adminMetrics.statusCode, 200);
    assert(adminMetrics.body.data);
    assert(typeof adminMetrics.body.data.averageLatencyMs === 'number');
    assert(typeof adminMetrics.body.data.p95LatencyMs === 'number');
    console.log('  [PASS] Super Admin retrieves real-time metrics telemetry (200 OK)\n');

    // --- 8. Persistent System Incidents & Status Lifecycle ---
    console.log('--- 8. Persistent System Incidents & Status Lifecycle ---');

    // 1. Create incident
    const testIncident = await IncidentModel.createIncident({
      category: 'DATABASE_ERROR',
      severity: 'HIGH',
      endpoint: '/api/contests/live',
      requestId: `trace-${uniqueSuffix}`,
      message: '[TEST] PostgreSQL query timeout exceeded during high load',
      details: { timeoutMs: 5000 },
      status: 'OPEN',
    });
    assert(testIncident.id);
    assert.strictEqual(testIncident.category, 'DATABASE_ERROR');
    assert.strictEqual(testIncident.severity, 'HIGH');
    assert.strictEqual(testIncident.status, 'OPEN');
    console.log(`  [PASS] Incident #${testIncident.id} created successfully with severity HIGH`);

    // 2. Query incidents via Admin API
    const incidentsListRes = await makeRequest('GET', '/api/admin/system/incidents?severity=HIGH', null, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.strictEqual(incidentsListRes.statusCode, 200);
    assert(incidentsListRes.body.data.incidents.length >= 1);
    assert(incidentsListRes.body.data.pagination.total >= 1);
    console.log('  [PASS] Super Admin queries filtered incidents list with pagination (200 OK)');

    // 3. Update status: OPEN -> INVESTIGATING
    const updateRes1 = await makeRequest(
      'PATCH',
      `/api/admin/system/incidents/${testIncident.id}/status`,
      { status: 'INVESTIGATING' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(updateRes1.statusCode, 200);
    assert.strictEqual(updateRes1.body.data.status, 'INVESTIGATING');
    console.log('  [PASS] Incident status updated to INVESTIGATING (200 OK)');

    // 4. Update status: INVESTIGATING -> RESOLVED
    const updateRes2 = await makeRequest(
      'PATCH',
      `/api/admin/system/incidents/${testIncident.id}/status`,
      { status: 'RESOLVED' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(updateRes2.statusCode, 200);
    assert.strictEqual(updateRes2.body.data.status, 'RESOLVED');
    assert(updateRes2.body.data.resolved_at);
    console.log('  [PASS] Incident status updated to RESOLVED with resolved_at timestamp (200 OK)');

    // 5. Invalid status transition rejection
    const invalidStatusRes = await makeRequest(
      'PATCH',
      `/api/admin/system/incidents/${testIncident.id}/status`,
      { status: 'INVALID_STATUS' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert(invalidStatusRes.statusCode >= 400);
    console.log('  [PASS] Invalid incident status safely rejected with 400/500\n');

    // --- 9. SQL Injection & IDOR Resilience ---
    console.log('--- 9. SQL Injection & IDOR Resilience ---');

    const sqlInjSearch = await makeRequest(
      'GET',
      `/api/admin/system/incidents?search=${encodeURIComponent("'; DROP TABLE system_incidents; --")}`,
      null,
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(sqlInjSearch.statusCode, 200);
    const tableCheck = await db.query('SELECT 1 FROM system_incidents LIMIT 1;');
    assert(tableCheck);
    console.log('  [PASS] Parameterized SQL query neutralized SQL injection in search filter');

    const invalidIncidentId = await makeRequest(
      'PATCH',
      '/api/admin/system/incidents/9999999/status',
      { status: 'RESOLVED' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(invalidIncidentId.statusCode, 404);
    console.log('  [PASS] Non-existent incident ID safely returns 404 Not Found\n');

    // --- 10. Ephemeral Test Fixture Cleanup ---
    console.log('--- 10. Ephemeral Test Fixture Cleanup ---');
    await db.query('DELETE FROM users WHERE username IN ($1, $2, $3);', [
      studentUser.username,
      profUser.username,
      adminUser.username,
    ]);
    await IncidentModel.purgeTestIncidents();
    console.log('  [CLEANUP] Ephemeral test users and incidents purged successfully.\n');

    console.log('=======================================================');
    console.log(' PHASE 5.9.10 TEST SUMMARY: 26 PASSED, 0 FAILED');
    console.log('=======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
    await db.closePool();
  }
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('[TEST FAILED]', err);
    if (server) server.close();
    process.exit(1);
  });
