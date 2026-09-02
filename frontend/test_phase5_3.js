/**
 * Automated Test Suite for Phase 5.3: Submission History + Coding Analytics
 */
const API_BASE = 'http://localhost:5000/api';

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    throw new Error(message);
  }
  console.log(`[PASS] ${message}`);
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

  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {}
  } else if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    data = await res.text();
  }

  return { status, data, headers: res.headers, ok: res.ok };
}

async function runPhase53Tests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.3 AUTOMATED TEST SUITE');
  console.log(' Submission History, Coding Analytics & CSV Export');
  console.log('=======================================================\n');

  let studentToken = null;
  let studentUser = null;
  let otherStudentToken = null;
  let otherStudentUser = null;

  // 1. Authenticate primary student
  console.log('--- 1. Authentication & Setup ---');
  const loginRes = await apiRequest('/auth/login', 'POST', {
    email: 'student@university.edu',
    password: 'Password123!',
  });
  assert(loginRes.status === 200, 'Student login returns HTTP 200');
  studentToken = loginRes.data.token;
  studentUser = loginRes.data.user;

  // Register secondary user for security isolation tests
  const ts = Date.now().toString().slice(-6);
  const otherUsername = `isol_${ts}`;
  const otherEmail = `isol_${ts}@test.edu`;
  const otherPassword = 'Password123!';

  await apiRequest('/auth/register', 'POST', {
    username: otherUsername,
    email: otherEmail,
    password: otherPassword,
    fullName: 'Isolation Test User',
  });

  const otherLogin = await apiRequest('/auth/login', 'POST', {
    email: otherEmail,
    password: otherPassword,
  });
  assert(otherLogin.status === 200, 'Secondary user login succeeds');
  otherStudentToken = otherLogin.data.token;
  otherStudentUser = otherLogin.data.user;

  // 2. Submission History API Tests
  console.log('\n--- 2. Submission History Listing & Filters ---');
  const histRes = await apiRequest('/submissions/my', 'GET', null, studentToken);
  assert(histRes.status === 200, 'GET /api/submissions/my returns HTTP 200');
  assert(Array.isArray(histRes.data.submissions), 'Submissions list is an array');
  assert(histRes.data.pagination !== undefined, 'Pagination metadata is included');
  assert(histRes.data.pagination.currentPage === 1, 'Default currentPage is 1');
  assert(typeof histRes.data.pagination.totalSubmissions === 'number', 'totalSubmissions is a number');

  // Verdict Filter
  const verdictRes = await apiRequest('/submissions/my?verdict=accepted', 'GET', null, studentToken);
  assert(verdictRes.status === 200, 'GET /api/submissions/my?verdict=accepted returns HTTP 200');
  const allAccepted = verdictRes.data.submissions.every((s) => s.status === 'accepted');
  assert(allAccepted, 'Verdict filter returns only accepted submissions');

  // Language Filter
  const langRes = await apiRequest('/submissions/my?language=cpp', 'GET', null, studentToken);
  assert(langRes.status === 200, 'GET /api/submissions/my?language=cpp returns HTTP 200');
  const allCpp = langRes.data.submissions.every((s) => s.language === 'cpp');
  assert(allCpp, 'Language filter returns only C++ submissions');

  // Time Range Filter
  const timeRes = await apiRequest('/submissions/my?timeRange=30d', 'GET', null, studentToken);
  assert(timeRes.status === 200, 'GET /api/submissions/my?timeRange=30d returns HTTP 200');

  // Sorting
  const sortRes = await apiRequest('/submissions/my?sortBy=runtime_asc', 'GET', null, studentToken);
  assert(sortRes.status === 200, 'GET /api/submissions/my?sortBy=runtime_asc returns HTTP 200');

  // Server-Side Pagination
  const pageRes = await apiRequest('/submissions/my?page=1&limit=2', 'GET', null, studentToken);
  assert(pageRes.status === 200, 'GET /api/submissions/my?page=1&limit=2 returns HTTP 200');
  assert(pageRes.data.submissions.length <= 2, 'Page size limit is strictly enforced');
  assert(pageRes.data.pagination.limit === 2, 'Pagination limit matches requested page size');

  // Search by Problem Title
  const searchRes = await apiRequest('/submissions/my?search=Add', 'GET', null, studentToken);
  assert(searchRes.status === 200, 'GET /api/submissions/my?search=Add returns HTTP 200');

  // 3. Coding Analytics Engine Tests
  console.log('\n--- 3. Coding Analytics Engine Tests ---');
  const analyticsRes = await apiRequest('/submissions/analytics?timeRange=all', 'GET', null, studentToken);
  assert(analyticsRes.status === 200, 'GET /api/submissions/analytics returns HTTP 200');
  const analytics = analyticsRes.data;

  assert(analytics.summary !== undefined, 'Analytics response contains summary object');
  assert(typeof analytics.summary.totalSubmissions === 'number', 'Summary contains totalSubmissions');
  assert(typeof analytics.summary.acceptedSubmissions === 'number', 'Summary contains acceptedSubmissions');
  assert(typeof analytics.summary.acceptanceRate === 'number', 'Summary contains acceptanceRate (%)');
  assert(typeof analytics.summary.uniqueProblemsSolved === 'number', 'Summary contains uniqueProblemsSolved');
  assert(
    analytics.summary.uniqueProblemsSolved <= analytics.summary.acceptedSubmissions,
    'Unique problems solved is correctly deduplicated and <= accepted submissions count'
  );

  assert(analytics.verdictDistribution !== undefined, 'Analytics contains verdictDistribution map');
  assert(typeof analytics.verdictDistribution.accepted === 'number', 'Verdict map tracks accepted count');
  assert(typeof analytics.verdictDistribution.wrong_answer === 'number', 'Verdict map tracks wrong_answer count');

  assert(analytics.languageDistribution !== undefined, 'Analytics contains languageDistribution');
  assert(analytics.difficultyDistribution !== undefined, 'Analytics contains difficultyDistribution');
  assert(Array.isArray(analytics.activityTimeline), 'Analytics contains activityTimeline array');

  // Time-range filtered analytics
  const analytics7d = await apiRequest('/submissions/analytics?timeRange=7d', 'GET', null, studentToken);
  assert(analytics7d.status === 200, 'GET /api/submissions/analytics?timeRange=7d returns HTTP 200');
  assert(analytics7d.data.timeRange === '7d', 'Analytics responds with requested 7d time range');

  // 4. Source Code Inspection & Security Authorization Tests
  console.log('\n--- 4. Source Code Inspection & Security Authorization Tests ---');
  if (histRes.data.submissions.length > 0) {
    const testSubId = histRes.data.submissions[0].id;

    // Student inspects their own code
    const ownCodeRes = await apiRequest(`/submissions/${testSubId}/code`, 'GET', null, studentToken);
    assert(ownCodeRes.status === 200, 'Student can safely view their own submission source code (200 OK)');
    assert(typeof ownCodeRes.data.sourceCode === 'string', 'Source code string is returned in response');
    assert(ownCodeRes.data.id === testSubId, 'Returned code corresponds to correct submission ID');

    // Other student tries to inspect student A's code -> MUST BE FORBIDDEN (403)
    const unauthorizedRes = await apiRequest(`/submissions/${testSubId}/code`, 'GET', null, otherStudentToken);
    assert(
      unauthorizedRes.status === 403,
      'User isolation verified: Student B cannot view Student A source code (HTTP 403 Forbidden)'
    );

    // Other student tries to inspect student A's submission details -> MUST BE FORBIDDEN (403)
    const unauthorizedDetail = await apiRequest(`/submissions/${testSubId}`, 'GET', null, otherStudentToken);
    assert(
      unauthorizedDetail.status === 403,
      'User isolation verified: Student B cannot inspect Student A submission details (HTTP 403 Forbidden)'
    );
  }

  // 5. Personal CSV Export Tests
  console.log('\n--- 5. Personal CSV Export Tests ---');
  const exportRes = await apiRequest('/submissions/export', 'GET', null, studentToken);
  assert(exportRes.status === 200, 'GET /api/submissions/export returns HTTP 200');
  assert(exportRes.headers.get('content-type').includes('text/csv'), 'Response Content-Type is text/csv');
  assert(typeof exportRes.data === 'string', 'CSV content is returned as text string');

  const csvLines = exportRes.data.split('\r\n');
  assert(csvLines.length >= 1, 'CSV contains at least the header row');
  const headerLine = csvLines[0];
  assert(headerLine.includes('Submission ID'), 'CSV header includes Submission ID');
  assert(headerLine.includes('Problem Title'), 'CSV header includes Problem Title');
  assert(headerLine.includes('Verdict'), 'CSV header includes Verdict');
  assert(headerLine.includes('Language'), 'CSV header includes Language');
  assert(!exportRes.data.includes('password_hash'), 'CSV strictly excludes password hashes');
  assert(!exportRes.data.includes('jwt'), 'CSV strictly excludes JWT tokens');

  // Verify User B's CSV export does not leak User A's submissions
  const otherExportRes = await apiRequest('/submissions/export', 'GET', null, otherStudentToken);
  assert(otherExportRes.status === 200, 'User B CSV export returns HTTP 200');
  const otherCsvLines = otherExportRes.data.split('\r\n').filter((l) => l.trim().length > 0);
  assert(
    otherCsvLines.length === 1,
    'User B with 0 submissions has exactly 1 CSV row (headers only, no leakage of User A data)'
  );

  console.log('\n=======================================================');
  console.log(' ALL PHASE 5.3 AUTOMATED TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================\n');
}

runPhase53Tests().catch((err) => {
  console.error('\n[FATAL TEST ERROR]', err);
  process.exit(1);
});
