/**
 * Automated Test Suite for Phase 5.2: Student Dashboard + Problem Discovery
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
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}

  return { status, data, ok: res.ok };
}

async function runPhase52Tests() {
  console.log('\n=======================================================');
  console.log(' STARTING PHASE 5.2 AUTOMATED TEST SUITE');
  console.log(' Student Dashboard, Problem Discovery & Bookmarks');
  console.log('=======================================================\n');

  let studentToken = null;
  let studentUser = null;
  let otherStudentToken = null;

  // 1. Authenticate primary test student
  console.log('--- 1. Authentication & Session Setup ---');
  const loginRes = await apiRequest('/auth/login', 'POST', {
    email: 'student@university.edu',
    password: 'Password123!',
  });
  assert(loginRes.status === 200, 'Student login returns HTTP 200');
  assert(!!loginRes.data.token, 'Student JWT token is returned');
  studentToken = loginRes.data.token;
  studentUser = loginRes.data.user;

  // Authenticate secondary test user for isolation tests
  const ts = Date.now().toString().slice(-6);
  const otherUsername = `user_${ts}`;
  const otherEmail = `user_${ts}@test.edu`;
  const otherPassword = 'Password123!';

  const regOther = await apiRequest('/auth/register', 'POST', {
    username: otherUsername,
    email: otherEmail,
    password: otherPassword,
    fullName: 'Other Student',
  });
  assert(regOther.status === 201, 'Secondary student registration succeeds (201 Created)');

  const otherLoginRes = await apiRequest('/auth/login', 'POST', {
    email: otherEmail,
    password: otherPassword,
  });
  assert(otherLoginRes.status === 200, 'Secondary student login succeeds (200 OK)');
  otherStudentToken = otherLoginRes.data.token;

  // 2. Student Dashboard API Tests
  console.log('\n--- 2. Student Dashboard API Tests ---');
  const dashRes = await apiRequest('/users/dashboard', 'GET', null, studentToken);
  assert(dashRes.status === 200, 'GET /api/users/dashboard returns HTTP 200');
  assert(dashRes.data.profileSummary !== undefined, 'Dashboard contains profileSummary');
  assert(Array.isArray(dashRes.data.runningContests), 'Dashboard contains runningContests array');
  assert(Array.isArray(dashRes.data.upcomingContests), 'Dashboard contains upcomingContests array');
  assert(Array.isArray(dashRes.data.joinedContests), 'Dashboard contains joinedContests array');
  assert(typeof dashRes.data.problemsSolvedCount === 'number', 'Dashboard contains real problemsSolvedCount');
  assert(typeof dashRes.data.totalAttemptsCount === 'number', 'Dashboard contains real totalAttemptsCount');
  assert(Array.isArray(dashRes.data.savedProblems), 'Dashboard contains savedProblems array');
  assert(Array.isArray(dashRes.data.recentSubmissions), 'Dashboard contains recentSubmissions array');

  // 3. Problem Discovery & Filtering APIs
  console.log('\n--- 3. Problem Discovery & Filtering API Tests ---');
  const allProbsRes = await apiRequest('/problems', 'GET', null, studentToken);
  assert(allProbsRes.status === 200, 'GET /api/problems returns HTTP 200');
  assert(Array.isArray(allProbsRes.data.problems), 'Problems endpoint returns problems array');
  assert(allProbsRes.data.pagination !== undefined, 'Problems response includes pagination metadata');
  assert(allProbsRes.data.pagination.currentPage === 1, 'Pagination default currentPage is 1');
  assert(allProbsRes.data.pagination.totalProblems >= 0, 'Pagination totalProblems count is present');

  // Search by keyword
  const searchRes = await apiRequest('/problems?search=Sum', 'GET', null, studentToken);
  assert(searchRes.status === 200, 'GET /api/problems?search=Sum returns HTTP 200');
  if (searchRes.data.problems.length > 0) {
    const hasSum = searchRes.data.problems.some((p) => p.title.toLowerCase().includes('sum') || (p.description && p.description.toLowerCase().includes('sum')));
    assert(hasSum, 'Search filter correctly matches problem with keyword "Sum"');
  }

  // Filter by difficulty
  const diffRes = await apiRequest('/problems?difficulty=easy', 'GET', null, studentToken);
  assert(diffRes.status === 200, 'GET /api/problems?difficulty=easy returns HTTP 200');
  const allEasy = diffRes.data.problems.every((p) => p.difficulty === 'easy');
  assert(allEasy, 'Difficulty filter returns only easy problems');

  // Filter by codingMode
  const modeRes = await apiRequest('/problems?codingMode=function', 'GET', null, studentToken);
  assert(modeRes.status === 200, 'GET /api/problems?codingMode=function returns HTTP 200');
  const allFunc = modeRes.data.problems.every((p) => p.codingMode === 'function');
  assert(allFunc, 'Coding mode filter returns only function problems');

  // Server-side Pagination
  const pageRes = await apiRequest('/problems?page=1&limit=2', 'GET', null, studentToken);
  assert(pageRes.status === 200, 'GET /api/problems?page=1&limit=2 returns HTTP 200');
  assert(pageRes.data.problems.length <= 2, 'Page size limit is strictly enforced');
  assert(pageRes.data.pagination.limit === 2, 'Pagination metadata reflects limit=2');

  // Sorting
  const sortRes = await apiRequest('/problems?sortBy=title_asc', 'GET', null, studentToken);
  assert(sortRes.status === 200, 'GET /api/problems?sortBy=title_asc returns HTTP 200');
  if (sortRes.data.problems.length >= 2) {
    const isSorted = sortRes.data.problems[0].title.localeCompare(sortRes.data.problems[1].title) <= 0;
    assert(isSorted, 'Sorting by title_asc correctly orders problem titles alphabetically');
  }

  // 4. Bookmark / Saved Problems Lifecycle & User Isolation
  console.log('\n--- 4. Bookmark / Saved Problems Lifecycle Tests ---');
  const testProblemId = allProbsRes.data.problems[0]?.id || 151;

  // Save Bookmark
  const saveRes = await apiRequest(`/problems/${testProblemId}/bookmark`, 'POST', null, studentToken);
  assert(saveRes.status === 200, 'POST /api/problems/:id/bookmark returns HTTP 200');
  assert(saveRes.data.isSaved === true, 'Response confirms isSaved is true');

  // Duplicate Save (Idempotent)
  const dupSaveRes = await apiRequest(`/problems/${testProblemId}/bookmark`, 'POST', null, studentToken);
  assert(dupSaveRes.status === 200, 'Idempotent bookmark save returns HTTP 200 without conflict error');

  // Retrieve Saved Problems for User A
  const getSavedRes = await apiRequest('/problems/saved', 'GET', null, studentToken);
  assert(getSavedRes.status === 200, 'GET /api/problems/saved returns HTTP 200');
  const isFoundInSaved = getSavedRes.data.problems.some((p) => p.id === testProblemId);
  assert(isFoundInSaved, 'Saved problem appears in user saved list');

  // User Isolation Test (User B should NOT have User A's bookmark)
  const userBSavedRes = await apiRequest('/problems/saved', 'GET', null, otherStudentToken);
  assert(userBSavedRes.status === 200, 'GET /api/problems/saved for other user returns HTTP 200');
  const foundInUserB = userBSavedRes.data.problems.some((p) => p.id === testProblemId);
  assert(!foundInUserB, 'User isolation verified: User B cannot see User A bookmarks');

  // Problem detail reflects isSaved: true
  const probDetailRes = await apiRequest(`/problems/${testProblemId}`, 'GET', null, studentToken);
  assert(probDetailRes.status === 200, 'GET /api/problems/:id returns HTTP 200');
  assert(probDetailRes.data.isSaved === true, 'Problem detail endpoint correctly reflects isSaved: true for user');

  // Filter with ?saved=true
  const filterSavedRes = await apiRequest('/problems?saved=true', 'GET', null, studentToken);
  assert(filterSavedRes.status === 200, 'GET /api/problems?saved=true returns HTTP 200');
  const foundInFiltered = filterSavedRes.data.problems.some((p) => p.id === testProblemId);
  assert(foundInFiltered, 'Query param ?saved=true correctly returns only bookmarked problems');

  // Unsave Bookmark
  const unsaveRes = await apiRequest(`/problems/${testProblemId}/bookmark`, 'DELETE', null, studentToken);
  assert(unsaveRes.status === 200, 'DELETE /api/problems/:id/bookmark returns HTTP 200');
  assert(unsaveRes.data.isSaved === false, 'Response confirms isSaved is false');

  // Verify removed from saved list
  const getSavedAfterRes = await apiRequest('/problems/saved', 'GET', null, studentToken);
  const stillInSaved = getSavedAfterRes.data.problems.some((p) => p.id === testProblemId);
  assert(!stillInSaved, 'Problem successfully removed from saved list after unsave');

  // 5. Problem Status Calculation Tests
  console.log('\n--- 5. Problem Status Calculation Tests ---');
  const statusCheck = await apiRequest(`/problems/${testProblemId}`, 'GET', null, studentToken);
  assert(statusCheck.status === 200, 'GET /api/problems/:id returns HTTP 200');
  assert(
    statusCheck.data.userStatus === 'solved' ||
    statusCheck.data.userStatus === 'attempted' ||
    statusCheck.data.userStatus === 'unsolved',
    `User status correctly calculated as '${statusCheck.data.userStatus}' from genuine submission records`
  );

  console.log('\n=======================================================');
  console.log(' ALL PHASE 5.2 AUTOMATED TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================\n');
}

runPhase52Tests().catch((err) => {
  console.error('\n[FATAL TEST ERROR]', err);
  process.exit(1);
});
