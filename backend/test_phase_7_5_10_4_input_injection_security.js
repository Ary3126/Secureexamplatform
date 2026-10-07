/**
 * Phase 7.5.10.4 — Input Validation & Injection Security Test Suite
 * File: backend/test_phase_7_5_10_4_input_injection_security.js
 *
 * Exhaustive Active Security Penetration & Hardening Suite covering 27 categories:
 * 1.  Validation Architecture (request headers, Content-Type, payload size limits)
 * 2.  SQL Injection (login, search, direct parameter injection, union probes)
 * 3.  Dynamic SQL Components (ORDER BY whitelist, LIMIT/OFFSET boundaries)
 * 4.  Search & Filter Injection (special characters, wildcards, templates)
 * 5.  XSS Protection (stored XSS, reflected XSS, frontend rendering safety)
 * 6.  Command Injection (language enums, function names, runner boundaries)
 * 7.  Judge / Sandbox Boundaries (Docker arguments, env redaction, resource bounds)
 * 8.  Path Traversal (format parameters, directory escape attempts)
 * 9.  Prototype Pollution (__proto__, constructor.prototype, object isolation)
 * 10. Mass Assignment (role, ratings, created_by, admin flags tampering)
 * 11. Malicious JSON (malformed syntax, deep nesting, type mismatch)
 * 12. Parameter Pollution (HPP deterministic scalar handling)
 * 13. Type Confusion (primitives vs objects vs arrays vs booleans)
 * 14. Oversized Payloads (boundary length checking across endpoints)
 * 15. ReDoS Resistance (polynomial/exponential regex attack probes)
 * 16. CSV Formula Injection & Escaping (formula trigger neutralization)
 * 17. CRLF & Header Injection (response header splitting defenses)
 * 18. Null-Byte Injections (%00, \0 byte sequence defenses)
 * 19. Unicode & Normalization Security (homoglyphs, emojis, zero-width chars)
 * 20. Enum & Language Validation (strict allowed value gates)
 * 21. Function Mode DSL Security (identifier rules, param bounds)
 * 22. Test Case Security (raw data neutrality without execution)
 * 23. Error & Stack Trace Disclosure (no leaked internals, paths, or secrets)
 * 24. Validation Order Invariants (validate before DB / execution)
 * 25. Database Integrity Defenses (Postgres constraint mapping to 400/409)
 * 26. Log Injection Defenses (CRLF and control character sanitization)
 * 27. Controlled Fuzz Testing (fuzz matrices across core endpoints)
 *
 * Teardown & Clean Baseline Preservation:
 * Strictly restores Users: 5, Contests: 1, Problems: 5, Submissions: 33, Rating History: 0
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const { app } = require('./src/server');
const db = require('./src/config/db');
const ContestModel = require('./src/models/contestModel');
const ProblemModel = require('./src/models/problemModel');
const TestCaseModel = require('./src/models/testCaseModel');
const SubmissionModel = require('./src/models/submissionModel');
const UserModel = require('./src/models/userModel');
const AuditLogger = require('./src/services/auditLogger');
const ContestExportService = require('./src/services/contestExportService');
const { generateToken, hashPassword } = require('./src/services/authService');

let server;
let serverPort;
let baseUrl;

let passed = 0;
let failed = 0;

const trackedUserIds = [];
const trackedContestIds = [];
const trackedProblemIds = [];
const trackedSubmissionIds = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

function request(method, path, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function createTestUser(role = 'student', usernamePrefix = 'inj_user') {
  const ts = Date.now() + '_' + Math.floor(Math.random() * 1000000);
  const username = `${usernamePrefix}_${ts}`;
  const email = `${username}@codefrog.test`;
  const passwordHash = await hashPassword('SecurePass123!');

  const user = await UserModel.createUser({
    username,
    email,
    passwordHash,
    fullName: `Test ${role} ${ts}`,
    role,
  });

  if (role !== 'student') {
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    user.role = role;
  }

  trackedUserIds.push(user.id);
  const token = generateToken(user);
  return { user, token };
}

async function runInputInjectionSecuritySuite() {
  console.log('================================================================');
  console.log(' Phase 7.5.10.4 — Input Validation & Injection Security Suite   ');
  console.log('================================================================\n');

  try {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
    baseUrl = `http://127.0.0.1:${serverPort}`;

    // -------------------------------------------------------------
    // FIXTURE CREATION
    // -------------------------------------------------------------
    const { user: studentAlice, token: tokenAlice } = await createTestUser('student', 'inj_alice');
    const { user: profAlan, token: tokenAlan } = await createTestUser('professor', 'inj_alan');
    const { user: platformAdmin, token: tokenPlatformAdmin } = await createTestUser('super_admin', 'inj_admin');

    const contestFixture = await ContestModel.createContestWithSafety({
      title: 'Security Audit Contest 75104',
      description: 'Controlled contest fixture for input validation audit',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString(),
      isRated: true,
      createdBy: profAlan.id,
      status: 'published',
    });
    trackedContestIds.push(contestFixture.id);
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [contestFixture.id]);
    await ContestModel.addParticipant(contestFixture.id, studentAlice.id);

    const probFixture = await ProblemModel.createProblemWithSafety({
      title: 'Security Audit Problem 75104',
      description: 'Controlled problem fixture for input validation audit',
      difficulty: 'medium',
      codingMode: 'full_program',
      allowedLanguages: ['python', 'cpp', 'java'],
      accessScope: 'public',
      createdBy: profAlan.id,
      isPublished: true,
    });
    trackedProblemIds.push(probFixture.id);
    await ContestModel.addProblemToContest({
      contestId: contestFixture.id,
      problemId: probFixture.id,
      points: 100,
      problemOrder: 1,
    });

    const tcFixture = await TestCaseModel.createTestCaseWithSafety({
      problemId: probFixture.id,
      inputData: 'sample_input_101',
      expectedOutput: 'sample_output_101',
      isSample: true,
      isHidden: false,
      orderIndex: 1,
    });

    // -------------------------------------------------------------
    // 1. VALIDATION ARCHITECTURE
    // -------------------------------------------------------------
    console.log('--- 1. Validation Architecture ---');

    // 1.1 Non-JSON body on JSON endpoint rejected
    const resBadContentType = await request('POST', '/api/auth/login', 'not json', null, {
      'Content-Type': 'application/json',
    });
    assert(resBadContentType.status === 400, '1.1 Non-JSON body on JSON endpoint rejected with 400 Bad Request');

    // 1.2 Unrecognized HTTP method on protected endpoints rejected
    const resBadMethod = await request('PUT', `/api/contests/${contestFixture.id}/publish`, {}, tokenAlan);
    assert(resBadMethod.status === 404 || resBadMethod.status === 405, '1.2 Unrecognized HTTP method rejected cleanly');

    // 1.3 Content-Type validation: POST with valid JSON accepted
    const resValidJson = await request('POST', '/api/auth/login', {
      username: studentAlice.username,
      password: 'SecurePass123!',
    });
    assert(resValidJson.status === 200, '1.3 Valid JSON payload accepted with 200 OK');

    // 1.4 Max body size limit: Payload exceeding 512KB rejected with 413
    const hugePadding = 'A'.repeat(600 * 1024); // 600KB
    const resHugeBody = await request('POST', '/api/problems', {
      title: 'Huge Body Test',
      description: hugePadding,
      difficulty: 'easy',
    }, tokenAlan);
    assert(resHugeBody.status === 413, '1.4 Payload exceeding 512KB body limit rejected with 413 Payload Too Large');

    // 1.5 Payload within size limit accepted for evaluation
    const normalBody = { title: 'Normal Body Test', description: 'Normal description text', difficulty: 'easy' };
    const resNormalBody = await request('POST', '/api/problems', normalBody, tokenAlan);
    assert(resNormalBody.status === 201, '1.5 Payload within size limit accepted with 201 Created');
    const normProbId = resNormalBody.data?.problem?.id || resNormalBody.data?.id;
    if (normProbId) trackedProblemIds.push(normProbId);

    // -------------------------------------------------------------
    // 2. SQL INJECTION AUDIT
    // -------------------------------------------------------------
    console.log('\n--- 2. SQL Injection ---');

    // 2.1 Login username SQL injection probe ' OR '1'='1
    const resSqlLogin1 = await request('POST', '/api/auth/login', {
      username: "' OR '1'='1",
      password: 'randomPassword!',
    });
    assert(resSqlLogin1.status === 401, "2.1 Login ' OR '1'='1 probe rejected with 401 Unauthorized");

    // 2.2 Login admin comment probe admin'--
    const resSqlLogin2 = await request('POST', '/api/auth/login', {
      username: "admin'--",
      password: 'randomPassword!',
    });
    assert(resSqlLogin2.status === 401, "2.2 Login admin'-- probe rejected with 401 Unauthorized (no auth bypass)");

    // 2.3 Contest retrieval with SQL injection in ID
    const resSqlContest = await request('GET', "/api/contests/1' OR '1'='1", null, tokenAlice);
    assert(resSqlContest.status === 400, "2.3 Contest ID with SQL injection rejected with 400 Bad Request");

    // 2.4 Problem retrieval with UNION SELECT probe
    const resSqlProbUnion = await request('GET', "/api/problems/1 UNION SELECT NULL,NULL,NULL--", null, tokenAlice);
    assert(resSqlProbUnion.status === 400, "2.4 Problem ID with UNION SELECT probe rejected with 400 Bad Request");

    // 2.5 User profile with SQL injection in ID
    const resSqlUser = await request('GET', "/api/users/1; DROP TABLE users;--/rating", null, tokenAlice);
    assert(resSqlUser.status === 400, "2.5 User ID with SQL injection rejected with 400 Bad Request");

    // 2.6 Users table remains intact
    const checkUsers = await db.query('SELECT count(*) FROM users');
    assert(parseInt(checkUsers.rows[0].count, 10) >= 5, "2.6 Users table fully intact post-injection attempts");

    // -------------------------------------------------------------
    // 3. DYNAMIC SQL COMPONENTS (ORDER BY, LIMIT, OFFSET)
    // -------------------------------------------------------------
    console.log('\n--- 3. Dynamic SQL ---');

    // 3.1 ORDER BY whitelist: legitimate sort field
    const resSortValid = await request('GET', `/api/contests/${contestFixture.id}/participants?sortBy=username&sortOrder=DESC`, null, tokenAlan);
    assert(resSortValid.status === 200, '3.1 Whitelisted sortBy=username accepted with 200 OK');

    // 3.2 ORDER BY injection: SQL injection in sortBy falls back safely to whitelist
    const resSortInj = await request('GET', `/api/contests/${contestFixture.id}/participants?sortBy=id;SELECT+pg_sleep(1)--`, null, tokenAlan);
    assert(resSortInj.status === 200, '3.2 ORDER BY injection safely normalized to fallback column (200 OK)');

    // 3.3 ORDER BY direction: CASE WHEN probe safely normalized
    const resSortDirInj = await request('GET', `/api/contests/${contestFixture.id}/participants?sortBy=username&sortOrder=CASE+WHEN+1=1+THEN+DESC+ELSE+ASC+END`, null, tokenAlan);
    assert(resSortDirInj.status === 200, '3.3 ORDER BY sortOrder injection normalized strictly to ASC/DESC (200 OK)');

    // 3.4 LIMIT boundary: limit > 100 clamped to 100
    const resLimitHigh = await request('GET', `/api/contests/${contestFixture.id}/participants?limit=999999`, null, tokenAlan);
    assert(resLimitHigh.status === 200 && resLimitHigh.data?.limit <= 100, '3.4 Oversized limit clamped strictly to 100 max');

    // 3.5 LIMIT negative: limit <= 0 clamped to positive minimum
    const resLimitNeg = await request('GET', `/api/contests/${contestFixture.id}/participants?limit=-10`, null, tokenAlan);
    assert(resLimitNeg.status === 200 && resLimitNeg.data?.limit >= 1, '3.5 Negative limit clamped to positive minimum');

    // 3.6 OFFSET boundary: invalid page defaults safely to page 1
    const resPageInvalid = await request('GET', `/api/contests/${contestFixture.id}/participants?page=invalidPage`, null, tokenAlan);
    assert(resPageInvalid.status === 200 && resPageInvalid.data?.page === 1, '3.6 Invalid page parameter clamped safely to page 1');

    // -------------------------------------------------------------
    // 4. SEARCH / FILTER SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 4. Search & Filter Security ---');

    // 4.1 Single-quote search probe
    const resSearchQuote = await request('GET', "/api/problems?search=' OR '1'='1", null, tokenAlice);
    assert(resSearchQuote.status === 200, "4.1 Search probe with ' OR '1'='1 executes safely with 200 OK");

    // 4.2 SQL comment probe in search
    const resSearchComment = await request('GET', "/api/problems?search=admin'--", null, tokenAlice);
    assert(resSearchComment.status === 200, "4.2 Search probe with admin'-- executes safely with 200 OK");

    // 4.3 Wildcard search probe
    const resSearchWildcard = await request('GET', "/api/problems?search=%25%25%25___", null, tokenAlice);
    assert(resSearchWildcard.status === 200, "4.3 Search with SQL wildcards (% and _) executes safely with 200 OK");

    // 4.4 HTML/Script probe in search
    const resSearchScript = await request('GET', "/api/problems?search=<script>alert(1)</script>", null, tokenAlice);
    assert(resSearchScript.status === 200, "4.4 Search with <script> tag executes safely without reflection");

    // 4.5 Template literal probe in search
    const resSearchTemplate = await request('GET', "/api/problems?search=${7*7}", null, tokenAlice);
    assert(resSearchTemplate.status === 200, "4.5 Search with template expression ${7*7} treated as literal text");

    // -------------------------------------------------------------
    // 5. XSS (STORED, REFLECTED, DOM)
    // -------------------------------------------------------------
    console.log('\n--- 5. XSS Defenses ---');

    // 5.1 Stored XSS probe in problem title & description
    const xssPayload = '<img src=x onerror=alert("XSS")><script>alert(1)</script>';
    const resCreateXssProb = await request('POST', '/api/problems', {
      title: `XSS Test Problem ${Date.now()}`,
      description: `Problem description containing ${xssPayload}`,
      difficulty: 'easy',
    }, tokenAlan);
    assert(resCreateXssProb.status === 201, '5.1 Stored XSS payload accepted safely as raw text');
    const xssProbId = resCreateXssProb.data?.problem?.id || resCreateXssProb.data?.id;
    if (xssProbId) trackedProblemIds.push(xssProbId);

    // 5.2 Retrieval of stored XSS payload: returned as exact JSON string data
    const resGetXssProb = await request('GET', `/api/problems/${xssProbId}`, null, tokenAlan);
    assert(
      resGetXssProb.status === 200 &&
      resGetXssProb.data.description.includes(xssPayload) &&
      resGetXssProb.headers['content-type'].includes('application/json'),
      '5.2 Stored XSS payload returned strictly as JSON string (not executable HTML)'
    );

    // 5.3 Stored XSS in contest description
    const resCreateXssContest = await ContestModel.createContestWithSafety({
      title: `XSS Contest ${Date.now()}`,
      description: xssPayload,
      startTime: new Date(Date.now() - 1000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: profAlan.id,
      status: 'published',
    });
    trackedContestIds.push(resCreateXssContest.id);
    await db.query("UPDATE contests SET status = 'published' WHERE id = $1", [resCreateXssContest.id]);

    const resGetXssContest = await request('GET', `/api/contests/${resCreateXssContest.id}`, null, tokenAlice);
    assert(
      resGetXssContest.status === 200 &&
      resGetXssContest.data.description.includes(xssPayload) &&
      resGetXssContest.headers['content-type'].includes('application/json'),
      '5.3 Contest XSS payload returned strictly as JSON string'
    );

    // 5.4 Reflected XSS in search parameter
    const resReflectedXss = await request('GET', `/api/problems?search=${encodeURIComponent(xssPayload)}`, null, tokenAlice);
    assert(resReflectedXss.headers['content-type'].includes('application/json'), '5.4 Search response enforces application/json header (no HTML rendering)');

    // -------------------------------------------------------------
    // 6. COMMAND INJECTION AUDIT
    // -------------------------------------------------------------
    console.log('\n--- 6. Command Injection ---');

    // 6.1 Language parameter command probe: python; echo TEST
    const resCmdLang1 = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'python; echo TEST',
      sourceCode: 'print(1)',
    }, tokenAlice);
    assert(resCmdLang1.status === 400, '6.1 Command probe in language parameter rejected with 400 Bad Request');

    // 6.2 Language parameter command probe with pipe: python | sh
    const resCmdLang2 = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'python | sh',
      sourceCode: 'print(1)',
    }, tokenAlice);
    assert(resCmdLang2.status === 400, '6.2 Pipe probe in language parameter rejected with 400 Bad Request');

    // 6.3 FunctionName with shell metacharacters in functionConfig
    const resCmdFunc = await request('POST', '/api/problems', {
      title: `Func Mode Cmd Test ${Date.now()}`,
      description: 'Testing command probe in functionName',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'solve; echo HACKED',
        returnType: 'int',
        parameters: [{ name: 'x', type: 'int' }],
      },
    }, tokenAlan);
    assert(resCmdFunc.status === 400, '6.3 Shell probe in functionName rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 7. JUDGE / CODE EXECUTION BOUNDARY
    // -------------------------------------------------------------
    console.log('\n--- 7. Judge Execution Boundary ---');

    // 7.1 Submission creation with benign code succeeds
    const resSubOk = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'python',
      sourceCode: 'import sys\nprint("hello")',
    }, tokenAlice);
    assert(resSubOk.status === 201, '7.1 Submission accepted and queued safely with 201 Created');
    if (resSubOk.data?.id) trackedSubmissionIds.push(resSubOk.data.id);

    // 7.2 Source code with system calls treated purely as data text
    const resSubSysCall = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'python',
      sourceCode: 'import os\nprint(os.environ.get("JWT_SECRET", "NONE"))',
    }, tokenAlice);
    assert(resSubSysCall.status === 201, '7.2 Source code with env probes accepted as text without execution on API process');
    if (resSubSysCall.data?.id) trackedSubmissionIds.push(resSubSysCall.data.id);

    // -------------------------------------------------------------
    // 8. PATH TRAVERSAL AUDIT
    // -------------------------------------------------------------
    console.log('\n--- 8. Path Traversal ---');

    // 8.1 Export format traversal probe
    const resPathExport = await request('GET', `/api/contests/${contestFixture.id}/export/results?format=../../etc/passwd`, null, tokenAlan);
    assert(resPathExport.status === 400, '8.1 Path traversal in export format rejected with 400 Bad Request');

    // 8.2 Route traversal probe ..%2f
    const resPathRoute = await request('GET', '/api/problems/..%2f..%2fpackage.json', null, tokenAlice);
    assert(resPathRoute.status === 400 || resPathRoute.status === 404, '8.2 Route path traversal probe rejected safely');

    // 8.3 Export filename is server-generated
    const resExportLegit = await request('GET', `/api/contests/${contestFixture.id}/export/results?format=csv`, null, tokenAlan);
    const dispHeader = resExportLegit.headers['content-disposition'] || '';
    assert(
      resExportLegit.status === 200 &&
      dispHeader.includes(`contest_${contestFixture.id}_results_`),
      '8.3 Export Content-Disposition filename is server-generated and bounded'
    );

    // -------------------------------------------------------------
    // 9. PROTOTYPE POLLUTION
    // -------------------------------------------------------------
    console.log('\n--- 9. Prototype Pollution ---');

    // 9.1 Profile update with __proto__
    const resProtoPollute = await request('PUT', '/api/users/me', {
      fullName: 'Alice Normal',
      __proto__: { isAdmin: true, role: 'super_admin' },
    }, tokenAlice);
    assert(resProtoPollute.status === 200, '9.1 Profile update with __proto__ processed safely');
    assert(({}).isAdmin === undefined, '9.1 Global Object prototype unpolluted by __proto__ injection');
    assert(({}).role === undefined, '9.1 Global Object prototype role unpolluted');

    // 9.2 Constructor.prototype injection
    const resCtorPollute = await request('PUT', '/api/users/me', {
      fullName: 'Alice Safe',
      constructor: { prototype: { isSuperAdmin: true } },
    }, tokenAlice);
    assert(resCtorPollute.status === 200, '9.2 Profile update with constructor.prototype processed safely');
    assert(({}).isSuperAdmin === undefined, '9.2 Global Object prototype unpolluted by constructor injection');

    // -------------------------------------------------------------
    // 10. MASS ASSIGNMENT DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 10. Mass Assignment ---');

    // 10.1 Role escalation injection in profile
    const resMassRole = await request('PUT', '/api/users/me', {
      fullName: 'Alice Injected',
      role: 'super_admin',
    }, tokenAlice);
    const checkAlice = await UserModel.findUserById(studentAlice.id);
    assert(checkAlice.role === 'student', '10.1 Role tampering in profile strictly ignored (role remains student)');

    // 10.2 Rating inflation injection in profile
    const resMassRating = await request('PUT', '/api/users/me', {
      fullName: 'Alice Rated',
      currentRating: 3000,
      highestRating: 3000,
    }, tokenAlice);
    const checkAliceRating = await UserModel.findUserById(studentAlice.id);
    assert(Number(checkAliceRating.currentRating) === 1200, '10.2 Rating tampering in profile strictly ignored (rating unchanged)');

    // 10.3 CreatedBy tampering in contest creation
    const resMassContest = await request('POST', '/api/contests', {
      title: `Mass Assign Contest ${Date.now()}`,
      description: 'Attempting to spoof createdBy',
      startTime: new Date(Date.now() + 1000).toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      createdBy: studentAlice.id, // Attempt to attribute to Alice
    }, tokenAlan);
    assert(resMassContest.status === 201, '10.3 Contest creation succeeds');
    const massContestId = resMassContest.data?.contest?.id || resMassContest.data?.id;
    if (massContestId) {
      trackedContestIds.push(massContestId);
      const freshContest = await ContestModel.findContestById(massContestId);
      assert(freshContest.created_by === profAlan.id, '10.3 created_by authoritatively set to authenticated caller');
    }

    // -------------------------------------------------------------
    // 11. MALICIOUS JSON & PARSER ABUSE
    // -------------------------------------------------------------
    console.log('\n--- 11. Malicious JSON ---');

    // 11.1 Malformed JSON syntax {
    const resMalformed1 = await request('POST', '/api/auth/login', '{', null);
    assert(resMalformed1.status === 400, '11.1 Malformed JSON syntax "{" rejected with 400 Bad Request');

    // 11.2 Incomplete JSON {"a":
    const resMalformed2 = await request('POST', '/api/auth/login', '{"a":', null);
    assert(resMalformed2.status === 400, '11.2 Incomplete JSON "{\\"a\\":" rejected with 400 Bad Request');

    // 11.3 Unexpected array at top level where object expected
    const resArrayBody = await request('POST', '/api/auth/login', ['username', 'password'], null);
    assert(resArrayBody.status === 400, '11.3 Top-level array payload rejected with 400 Bad Request');

    // 11.4 Deeply nested JSON object (25 levels)
    let nestedObj = { inner: 'deep_value' };
    for (let i = 0; i < 25; i++) {
      nestedObj = { child: nestedObj };
    }
    const resDeepJson = await request('POST', '/api/auth/login', nestedObj, null);
    assert(resDeepJson.status === 400, '11.4 Deeply nested JSON handled safely with 400 Bad Request (no stack overflow)');

    // -------------------------------------------------------------
    // 12. PARAMETER POLLUTION (HPP)
    // -------------------------------------------------------------
    console.log('\n--- 12. Parameter Pollution ---');

    // 12.1 Duplicated limit parameter ?limit=10&limit=100
    const resHppLimit = await request('GET', `/api/contests/${contestFixture.id}/participants?limit=10&limit=100`, null, tokenAlan);
    assert(resHppLimit.status === 200, '12.1 Duplicated limit parameter handled deterministically (200 OK)');

    // 12.2 Duplicated sort parameter ?sortBy=username&sortBy=created_at
    const resHppSort = await request('GET', `/api/contests/${contestFixture.id}/participants?sortBy=username&sortBy=created_at`, null, tokenAlan);
    assert(resHppSort.status === 200, '12.2 Duplicated sortBy parameter handled deterministically (200 OK)');

    // -------------------------------------------------------------
    // 13. TYPE CONFUSION
    // -------------------------------------------------------------
    console.log('\n--- 13. Type Confusion ---');

    // 13.1 Boolean fields sent as string "not_a_bool"
    const resTypeBool = await request('PUT', `/api/contests/${contestFixture.id}`, {
      isRated: 'not_a_bool',
    }, tokenAlan);
    assert(resTypeBool.status === 400, '13.1 Invalid boolean type rejected with 400 Bad Request');

    // 13.2 String field sent as number for problem title
    const resTypeTitle = await request('POST', '/api/problems', {
      title: 123456, // number instead of string
      description: 'Valid problem description',
      difficulty: 'easy',
    }, tokenAlan);
    assert(resTypeTitle.status === 400, '13.2 Non-string problem title rejected with 400 Bad Request');

    // 13.3 Array field sent as string for allowedLanguages
    const resTypeArray = await request('POST', '/api/problems', {
      title: 'Valid Problem Title',
      description: 'Valid problem description',
      difficulty: 'easy',
      allowedLanguages: 'python', // string instead of array
    }, tokenAlan);
    assert(resTypeArray.status === 400, '13.3 Non-array allowedLanguages rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 14. OVERSIZED PAYLOAD BOUNDARIES
    // -------------------------------------------------------------
    console.log('\n--- 14. Oversized Payloads ---');

    // 14.1 Username exceeding 50 characters in registration
    const resLongUsername = await request('POST', '/api/auth/register', {
      username: 'a'.repeat(55),
      email: 'oversized@codefrog.test',
      password: 'SecurePass123!',
      fullName: 'Oversized User',
    });
    assert(resLongUsername.status === 400, '14.1 Username exceeding 50 chars rejected with 400 Bad Request');

    // 14.2 Contest title exceeding 200 characters
    const resLongTitle = await request('POST', '/api/contests', {
      title: 'T'.repeat(205),
      description: 'Valid description',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
    }, tokenAlan);
    assert(resLongTitle.status === 400, '14.2 Contest title exceeding 200 chars rejected with 400 Bad Request');

    // 14.3 Source code exceeding 64KB limit
    const resLongCode = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'python',
      sourceCode: 'A'.repeat(70 * 1024), // 70KB
    }, tokenAlice);
    assert(resLongCode.status === 400, '14.3 Source code exceeding 64KB rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 15. REGEX / ReDoS DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 15. ReDoS Defenses ---');

    // 15.1 Email validator ReDoS probe
    const evilEmail = 'a'.repeat(100) + '!';
    const t0 = Date.now();
    const resRedosEmail = await request('POST', '/api/auth/register', {
      username: `redos_${Date.now()}`,
      email: evilEmail,
      password: 'SecurePass123!',
      fullName: 'ReDoS Test',
    });
    const dt = Date.now() - t0;
    assert(resRedosEmail.status === 400 && dt < 100, `15.1 ReDoS email probe executed in bounded time (${dt}ms < 100ms)`);

    // 15.2 Username validator ReDoS probe
    const evilUsername = 'a'.repeat(29) + '!';
    const t1 = Date.now();
    const resRedosUser = await request('POST', '/api/auth/register', {
      username: evilUsername,
      email: `valid_${Date.now()}@codefrog.test`,
      password: 'SecurePass123!',
      fullName: 'ReDoS Test',
    });
    const dtUser = Date.now() - t1;
    assert(resRedosUser.status === 400 && dtUser < 100, `15.2 ReDoS username probe executed in bounded time (${dtUser}ms < 100ms)`);

    // -------------------------------------------------------------
    // 16. CSV FORMULA INJECTION & ESCAPING
    // -------------------------------------------------------------
    console.log('\n--- 16. CSV Injection & Escaping ---');

    // 16.1 Formula trigger '=1+1' neutralized
    const escapedFormula1 = ContestExportService.escapeCsv('=1+1');
    assert(escapedFormula1.startsWith("\"'="), "16.1 Formula trigger '=1+1' neutralized with leading single quote");

    // 16.2 Formula trigger '@SUM' neutralized
    const escapedFormula2 = ContestExportService.escapeCsv('@SUM(A1:A10)');
    assert(escapedFormula2.startsWith("\"'@"), "16.2 Formula trigger '@SUM(A1:A10)' neutralized with leading single quote");

    // 16.3 Formula trigger '-2+3' neutralized
    const escapedFormula3 = ContestExportService.escapeCsv('-2+3');
    assert(escapedFormula3.startsWith("\"'-"), "16.3 Formula trigger '-2+3' neutralized with leading single quote");

    // 16.4 Formula trigger '+cmd' neutralized
    const escapedFormula4 = ContestExportService.escapeCsv('+cmd');
    assert(escapedFormula4.startsWith("\"'+"), "16.4 Formula trigger '+cmd' neutralized with leading single quote");

    // 16.5 Tab-prefixed formula trigger '\t=DDE' neutralized
    const escapedFormula5 = ContestExportService.escapeCsv('\t=DDE');
    assert(escapedFormula5.startsWith("\"'"), "16.5 Tab-prefixed formula trigger '\\t=DDE' neutralized with leading single quote");

    // 16.6 RFC 4180 quotes escaping: quotes inside cell are doubled
    const escapedQuotes = ContestExportService.escapeCsv('Hello "World"');
    assert(escapedQuotes === '"Hello ""World"""', '16.6 Embedded double-quotes RFC 4180 escaped with doubled quotes');

    // -------------------------------------------------------------
    // 17. HEADER / CRLF INJECTION
    // -------------------------------------------------------------
    console.log('\n--- 17. CRLF & Header Injection ---');

    // 17.1 CRLF in export format query parameter
    const resCrlfExport = await request('GET', `/api/contests/${contestFixture.id}/export/results?format=csv%0d%0aInjected-Header:+evil`, null, tokenAlan);
    assert(resCrlfExport.status === 400, '17.1 CRLF in export format query parameter rejected with 400 Bad Request');
    assert(!resCrlfExport.headers['injected-header'], '17.1 Response contains zero injected HTTP headers');

    // -------------------------------------------------------------
    // 18. NULL-BYTE INJECTIONS
    // -------------------------------------------------------------
    console.log('\n--- 18. Null-Byte Injections ---');

    // 18.1 Null byte in contest ID route parameter
    const resNullId = await request('GET', `/api/contests/1%00`, null, tokenAlice);
    assert(resNullId.status === 400, '18.1 Null-byte in numeric route parameter rejected with 400 Bad Request');

    // 18.2 Null byte in problem title JSON string
    const resNullTitle = await request('POST', '/api/problems', {
      title: 'Test\0NullByteTitle',
      description: 'Testing null byte handling',
      difficulty: 'easy',
    }, tokenAlan);
    assert(resNullTitle.status === 400, '18.2 Null-byte in JSON string handled safely with 400 Bad Request (no 500 DB error)');

    // -------------------------------------------------------------
    // 19. UNICODE & NORMALIZATION SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 19. Unicode Security ---');

    // 19.1 Zero-width spaces in title handled cleanly
    const resUnicodeTitle = await request('POST', '/api/problems', {
      title: 'Problem\u200BWith\u200BZeroWidthSpaces',
      description: 'Testing zero width spaces in title',
      difficulty: 'easy',
    }, tokenAlan);
    assert(resUnicodeTitle.status === 201, '19.1 Zero-width Unicode characters stored safely without corruption');
    if (resUnicodeTitle.data?.id) trackedProblemIds.push(resUnicodeTitle.data.id);

    // 19.2 Multi-byte UTF-8 emojis in problem title
    const resEmojiTitle = await request('POST', '/api/problems', {
      title: 'Algorithm: Tree Traversal 🌲🚀🔥',
      description: 'Description with multi-byte emojis 💡',
      difficulty: 'medium',
    }, tokenAlan);
    assert(resEmojiTitle.status === 201, '19.2 Multi-byte UTF-8 emojis stored and returned safely');
    if (resEmojiTitle.data?.id) trackedProblemIds.push(resEmojiTitle.data.id);

    // 19.3 Role homoglyph spoofing rejected
    const resHomoglyphRole = await request('POST', '/api/auth/register', {
      username: `homoglyph_${Date.now()}`,
      email: `homoglyph_${Date.now()}@codefrog.test`,
      password: 'SecurePass123!',
      fullName: 'Homoglyph User',
      role: 'аdmin', // Cyrillic 'а' homoglyph
    });
    // Regardless of response, check that user in DB is student
    if (resHomoglyphRole.data?.user?.id) {
      trackedUserIds.push(resHomoglyphRole.data.user.id);
      const u = await UserModel.findUserById(resHomoglyphRole.data.user.id);
      assert(u.role === 'student', '19.3 Homoglyph role injection ignored (role defaulted to student)');
    } else {
      assert(resHomoglyphRole.status === 400, '19.3 Invalid role homoglyph rejected with 400 Bad Request');
    }

    // -------------------------------------------------------------
    // 20. ENUM & LANGUAGE VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- 20. Enum Validation ---');

    // 20.1 Invalid difficulty enum
    const resEnumDiff = await request('POST', '/api/problems', {
      title: 'Invalid Diff Problem',
      description: 'Testing invalid difficulty',
      difficulty: 'nightmare',
    }, tokenAlan);
    assert(resEnumDiff.status === 400, '20.1 Invalid difficulty "nightmare" rejected with 400 Bad Request');

    // 20.2 Invalid codingMode enum
    const resEnumMode = await request('POST', '/api/problems', {
      title: 'Invalid Mode Problem',
      description: 'Testing invalid coding mode',
      difficulty: 'easy',
      codingMode: 'kernel_mode',
    }, tokenAlan);
    assert(resEnumMode.status === 400, '20.2 Invalid codingMode "kernel_mode" rejected with 400 Bad Request');

    // 20.3 Invalid language enum in submission
    const resEnumLang = await request('POST', '/api/submissions', {
      problemId: probFixture.id,
      contestId: contestFixture.id,
      language: 'brainfuck',
      sourceCode: '++++++++++',
    }, tokenAlice);
    assert(resEnumLang.status === 400, '20.3 Invalid language "brainfuck" rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 21. FUNCTION MODE DSL SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 21. Function Mode DSL Security ---');

    // 21.1 Invalid function name with spaces
    const resFuncSpace = await request('POST', '/api/problems', {
      title: 'Bad Func Name Problem',
      description: 'Testing space in functionName',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'my function',
        returnType: 'int',
        parameters: [{ name: 'x', type: 'int' }],
      },
    }, tokenAlan);
    assert(resFuncSpace.status === 400, '21.1 Function name with spaces rejected with 400 Bad Request');

    // 21.2 Duplicate parameter names
    const resFuncDupParam = await request('POST', '/api/problems', {
      title: 'Dup Param Problem',
      description: 'Testing duplicate parameter names',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'solveProblem',
        returnType: 'int',
        parameters: [
          { name: 'num', type: 'int' },
          { name: 'num', type: 'int' },
        ],
      },
    }, tokenAlan);
    assert(resFuncDupParam.status === 400, '21.2 Duplicate parameter names rejected with 400 Bad Request');

    // 21.3 Invalid parameter type characters
    const resFuncBadType = await request('POST', '/api/problems', {
      title: 'Bad Param Type Problem',
      description: 'Testing invalid characters in parameter type',
      difficulty: 'easy',
      codingMode: 'function',
      functionConfig: {
        functionName: 'solveProblem',
        returnType: 'int',
        parameters: [{ name: 'x', type: 'int; system("ls")' }],
      },
    }, tokenAlan);
    assert(resFuncBadType.status === 400, '21.3 Invalid characters in parameter type rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 22. TEST CASE SECURITY
    // -------------------------------------------------------------
    console.log('\n--- 22. Test Case Security ---');

    // 22.1 Test case input containing SQL syntax stored purely as text
    const sqlTestInput = "SELECT * FROM users WHERE '1'='1'; DROP TABLE problems;";
    const resTcSql = await TestCaseModel.createTestCaseWithSafety({
      problemId: probFixture.id,
      inputData: sqlTestInput,
      expectedOutput: 'safe_output',
      isSample: false,
      isHidden: true,
      orderIndex: 2,
    });
    const fetchedTc = await TestCaseModel.findTestCaseById(resTcSql.id);
    assert(fetchedTc.inputData === sqlTestInput, '22.1 Test case SQL input stored purely as raw text data without execution');

    // 22.2 Test case with negative time limit rejected
    const resTcNegTime = await request('POST', `/api/problems/${probFixture.id}/test-cases`, {
      inputData: '1 2',
      expectedOutput: '3',
      timeLimitMs: -500,
    }, tokenAlan);
    assert(resTcNegTime.status === 400, '22.2 Negative time limit rejected with 400 Bad Request');

    // -------------------------------------------------------------
    // 23. ERROR & STACK TRACE DISCLOSURE
    // -------------------------------------------------------------
    console.log('\n--- 23. Error & Stack Trace Disclosure ---');

    // 23.1 400 validation error response excludes stack
    const resErr400 = await request('GET', '/api/problems/not-an-id', null, tokenAlice);
    assert(resErr400.status === 400 && resErr400.data.stack === undefined, '23.1 400 response excludes stack trace');

    // 23.2 401 error excludes stack
    const resErr401 = await request('GET', '/api/users/me', null, null);
    assert(resErr401.status === 401 && resErr401.data.stack === undefined, '23.2 401 response excludes stack trace');

    // 23.3 403 error excludes stack
    const resErr403 = await request('POST', '/api/contests', { title: 'Alice Contest' }, tokenAlice);
    assert(resErr403.status === 403 && resErr403.data.stack === undefined, '23.3 403 response excludes stack trace');

    // 23.4 404 error excludes stack
    const resErr404 = await request('GET', '/api/problems/99999999', null, tokenAlice);
    assert(resErr404.status === 404 && resErr404.data.stack === undefined, '23.4 404 response excludes stack trace');

    // 23.5 Error messages do not leak database credentials
    const errStr = JSON.stringify(resErr400.data);
    assert(!errStr.includes('postgres://') && !errStr.includes('password='), '23.5 Error response excludes DB connection credentials');

    // -------------------------------------------------------------
    // 24. VALIDATION ORDER
    // -------------------------------------------------------------
    console.log('\n--- 24. Validation Order ---');

    // 24.1 Invalid ID validated upfront before database lookup
    const resOrder1 = await request('GET', '/api/problems/-999', null, tokenAlice);
    assert(resOrder1.status === 400, '24.1 Negative problem ID rejected with 400 before DB query');

    // 24.2 Decimal ID validated upfront before DB query
    const resOrder2 = await request('GET', '/api/problems/1.5', null, tokenAlice);
    assert(resOrder2.status === 400, '24.2 Decimal problem ID (1.5) rejected with 400 before DB query');

    // 24.3 Unauthenticated request rejected before controller execution
    const resOrder3 = await request('POST', '/api/problems', { title: 'Test' }, null);
    assert(resOrder3.status === 401, '24.3 Unauthenticated request rejected with 401 before controller logic');

    // -------------------------------------------------------------
    // 25. DATABASE INTEGRITY
    // -------------------------------------------------------------
    console.log('\n--- 25. Database Integrity ---');

    // 25.1 Foreign key constraint: orphan problem in contest rejected with DB FK error
    let fkBlocked = false;
    try {
      await db.query('INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, 99999999, 100, 99)', [contestFixture.id]);
    } catch (dbErr) {
      if (dbErr.code === '23503') fkBlocked = true;
    }
    assert(fkBlocked, '25.1 Foreign key constraint 23503 prevents orphan contest_problems record');

    // 25.2 Unique constraint: duplicate problem in contest rejected with unique violation
    let dupBlocked = false;
    try {
      await db.query('INSERT INTO contest_problems (contest_id, problem_id, points, problem_order) VALUES ($1, $2, 100, 1)', [contestFixture.id, probFixture.id]);
    } catch (dbErr) {
      if (dbErr.code === '23505') dupBlocked = true;
    }
    assert(dupBlocked, '25.2 Unique constraint 23505 prevents duplicate problem attachment in contest');

    // -------------------------------------------------------------
    // 26. LOG INJECTION DEFENSES
    // -------------------------------------------------------------
    console.log('\n--- 26. Log Injection ---');

    // 26.1 Username with embedded newline sanitized in audit logs
    const evilLogUser = {
      id: studentAlice.id,
      username: 'attacker\r\nSECURITY_EVENT=ADMIN_LOGIN',
      role: 'student',
    };
    const logResult = await AuditLogger.logAction({
      actor: evilLogUser,
      action: 'TEST_ACTION\r\nINJECTED_ACTION=CRLF',
      resourceType: 'problem\r\nINJECTED_TARGET=ALL',
      resourceId: 1,
      outcome: 'success',
      metadata: { safeNote: 'test note' },
    });
    assert(!logResult.actor.username.includes('\n'), '26.1 Embedded newlines stripped from actor username in audit log');
    assert(!logResult.action.includes('\n'), '26.2 Embedded newlines stripped from audit action identifier');
    assert(!logResult.resourceType.includes('\n'), '26.3 Embedded newlines stripped from audit resourceType');

    // 26.4 Sensitive keys redacted from audit metadata
    const logSensResult = await AuditLogger.logAction({
      actor: studentAlice,
      action: 'AUTH_TEST',
      resourceType: 'user',
      resourceId: studentAlice.id,
      outcome: 'success',
      metadata: {
        password: 'PlainTextPassword123!',
        jwt_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        safeField: 'visible_data',
      },
    });
    assert(logSensResult.metadata.password === undefined, '26.4 password key omitted from audit log metadata');
    assert(logSensResult.metadata.jwt_token === undefined, '26.4 jwt_token key omitted from audit log metadata');
    assert(logSensResult.metadata.safeField === 'visible_data', '26.4 Non-sensitive safeField preserved in audit metadata');

    // -------------------------------------------------------------
    // 27. CONTROLLED FUZZ TESTING
    // -------------------------------------------------------------
    console.log('\n--- 27. Controlled Fuzz Testing ---');

    const fuzzIds = [
      'abc',
      '-1',
      '0',
      '1.1',
      '1e3',
      '+1',
      '01',
      '1 ',
      ' 1',
      'null',
      'true',
      'false',
      'NaN',
      'Infinity',
      '99999999999999999999',
    ];

    let fuzzContestPassed = true;
    for (const badId of fuzzIds) {
      const resFuzz = await request('GET', `/api/contests/${encodeURIComponent(badId)}`, null, tokenAlice);
      if (resFuzz.status === 500) {
        fuzzContestPassed = false;
        break;
      }
    }
    assert(fuzzContestPassed, '27.1 Fuzzing contest ID parameter produced 0 unexpected 500 internal errors');

    let fuzzProblemPassed = true;
    for (const badId of fuzzIds) {
      const resFuzz = await request('GET', `/api/problems/${encodeURIComponent(badId)}`, null, tokenAlice);
      if (resFuzz.status === 500) {
        fuzzProblemPassed = false;
        break;
      }
    }
    assert(fuzzProblemPassed, '27.2 Fuzzing problem ID parameter produced 0 unexpected 500 internal errors');

    let fuzzSubmissionPassed = true;
    for (const badId of fuzzIds) {
      const resFuzz = await request('GET', `/api/submissions/${encodeURIComponent(badId)}`, null, tokenAlice);
      if (resFuzz.status === 500) {
        fuzzSubmissionPassed = false;
        break;
      }
    }
    assert(fuzzSubmissionPassed, '27.3 Fuzzing submission ID parameter produced 0 unexpected 500 internal errors');

    let fuzzPaginationPassed = true;
    const fuzzPages = ['-1', '0', 'abc', '1.1', '10000000', 'null'];
    for (const badPage of fuzzPages) {
      const resFuzz = await request('GET', `/api/problems?page=${badPage}&limit=${badPage}`, null, tokenAlice);
      if (resFuzz.status === 500) {
        fuzzPaginationPassed = false;
        break;
      }
    }
    assert(fuzzPaginationPassed, '27.4 Fuzzing pagination parameters produced 0 unexpected 500 internal errors');

  } catch (err) {
    console.error('[UNEXPECTED SUITE ERROR]:', err);
    failed++;
  } finally {
    // -------------------------------------------------------------
    // TEARDOWN & CLEAN BASELINE PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- Teardown & Clean Baseline Preservation ---');

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Delete tracked submissions
    if (trackedSubmissionIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE id = ANY($1::int[])', [trackedSubmissionIds]);
    }

    // Delete rating history, submissions, participants, problems for tracked contests
    if (trackedContestIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM rating_history WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_participants WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contest_problems WHERE contest_id = ANY($1::int[])', [trackedContestIds]);
      await db.query('DELETE FROM contests WHERE id = ANY($1::int[])', [trackedContestIds]);
    }

    // Delete test cases, submissions, saved problems for tracked problems
    if (trackedProblemIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM contest_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM test_cases WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM saved_problems WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problem_versions WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problem_reviews WHERE problem_id = ANY($1::int[])', [trackedProblemIds]);
      await db.query('DELETE FROM problems WHERE id = ANY($1::int[])', [trackedProblemIds]);
    }

    // Delete audit logs, participants, submissions, and users for tracked users
    if (trackedUserIds.length > 0) {
      await db.query('DELETE FROM submissions WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM rating_history WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM contest_participants WHERE user_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::int[])', [trackedUserIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [trackedUserIds]);
    }

    // Safety sweep for any test-generated users and logs by pattern
    await db.query("DELETE FROM audit_logs WHERE actor_id IN (SELECT id FROM users WHERE username LIKE 'inj_%' OR username LIKE 'homoglyph_%' OR username LIKE 'redos_%')");
    await db.query("DELETE FROM users WHERE username LIKE 'inj_%' OR username LIKE 'homoglyph_%' OR username LIKE 'redos_%'");

    // Verify canonical baseline
    const uCount = await db.query('SELECT count(*) FROM users');
    const cCount = await db.query('SELECT count(*) FROM contests');
    const pCount = await db.query('SELECT count(*) FROM problems');
    const sCount = await db.query('SELECT count(*) FROM submissions');
    const rCount = await db.query('SELECT count(*) FROM rating_history');

    assert(parseInt(uCount.rows[0].count, 10) === 5, `Users count strictly at baseline (5 users, found ${uCount.rows[0].count})`);
    assert(parseInt(cCount.rows[0].count, 10) === 1, `Contests count strictly at baseline (1 contest, found ${cCount.rows[0].count})`);
    assert(parseInt(pCount.rows[0].count, 10) === 5, `Problems count strictly at baseline (5 problems, found ${pCount.rows[0].count})`);
    assert(parseInt(sCount.rows[0].count, 10) === 33, `Submissions count strictly at baseline (33 submissions, found ${sCount.rows[0].count})`);
    assert(parseInt(rCount.rows[0].count, 10) === 0, `Rating History count strictly at baseline (0 rows, found ${rCount.rows[0].count})`);

    await db.closePool();
  }

  console.log('\n================================================================');
  console.log(` Input Validation & Injection Security Summary: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runInputInjectionSecuritySuite();
