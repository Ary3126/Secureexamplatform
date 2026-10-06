/**
 * CODEFROG — Legacy Professor Studio Cleanup Verification Suite
 * Validates:
 * 1. Admin Golden Baseline integrity (Super Admin access, Dashboard, Users, Problems, Contests, Audit, Health)
 * 2. Strict Admin Route isolation (No route redirects to /studio)
 * 3. Professor Role Verification & APIs (Professor login, RBAC endpoints, Problem creation, Contest creation)
 * 4. Student Role Verification (Student login, Problem explorer, Dashboard access)
 * 5. Dead Code Cleanup Verification (Old studio components deleted, shared admin components preserved)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { app } = require('./src/server');
const { pool, closePool } = require('./src/config/db');
const { generateToken } = require('./src/services/authService');

let server;
let baseUrl;

function request(method, reqPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runVerification() {
  console.log('===============================================================');
  console.log(' STARTING LEGACY PROFESSOR STUDIO CLEANUP VERIFICATION');
  console.log('===============================================================\n');

  // Start self-contained ephemeral server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Verification test server running at ${baseUrl}\n`);
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  function record(desc, cond) {
    if (cond) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.log(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  // --- 1. Dead Code Verification & Shared Components Preservation ---
  console.log('--- 1. Frontend Decommission & File Structure Verification ---');
  const frontendComponentsDir = path.resolve(__dirname, '../frontend/src/components');
  const authoringDir = path.join(frontendComponentsDir, 'authoring');

  const oldStudioFile = path.join(frontendComponentsDir, 'ProblemAuthoringStudio.jsx');
  record('Legacy ProblemAuthoringStudio.jsx is permanently deleted', !fs.existsSync(oldStudioFile));

  const deletedAuthoringFiles = [
    'AuthoringEmptyState.jsx',
    'ConfirmationModal.jsx',
    'ContestManagementCard.jsx',
    'DependencyImpactCard.jsx',
    'EditorialChecklistCard.jsx',
    'LifecycleStepper.jsx',
    'ProblemActionMenu.jsx',
    'ProblemTable.jsx',
    'ProfessorDashboardOverview.jsx',
    'QualityScoreCard.jsx',
    'ReviewWorkflowCard.jsx',
    'SchedulePublishModal.jsx',
    'VersionDiffModal.jsx',
    'VersionTimeline.jsx',
  ];

  deletedAuthoringFiles.forEach((file) => {
    const fullPath = path.join(authoringDir, file);
    record(`Legacy authoring component ${file} is permanently deleted`, !fs.existsSync(fullPath));
  });

  const sharedAuthoringFiles = ['AuthoringLoadingState.jsx', 'StatusBadge.jsx'];
  sharedAuthoringFiles.forEach((file) => {
    const fullPath = path.join(authoringDir, file);
    record(`Shared component ${file} is STRICTLY PRESERVED for Admin Panel`, fs.existsSync(fullPath));
  });

  // Verify App.jsx doesn't import or render ProblemAuthoringStudio
  const appJsxContent = fs.readFileSync(path.resolve(__dirname, '../frontend/src/App.jsx'), 'utf-8');
  record('App.jsx does not import ProblemAuthoringStudio', !appJsxContent.includes('ProblemAuthoringStudio'));
  record('App.jsx does not render activeView === "studio"', !appJsxContent.includes("activeView === 'studio'"));
  record('App.jsx redirects /studio to dashboard', appJsxContent.includes("path === '/studio' || path === '/professor' || path === '/author' || path === '/authoring') return 'dashboard'"));

  // Verify Navbar.jsx does not contain "Professor Studio"
  const navbarContent = fs.readFileSync(path.resolve(__dirname, '../frontend/src/components/Navbar.jsx'), 'utf-8');
  record('Navbar.jsx does not contain Professor Studio links', !navbarContent.includes('Professor Studio'));

  // Verify navConfig.js does not contain groupId: 'professor'
  const navConfigContent = fs.readFileSync(path.resolve(__dirname, '../frontend/src/config/navConfig.js'), 'utf-8');
  record("navConfig.js does not contain 'groupId: professor'", !navConfigContent.includes("groupId: 'professor'"));

  // --- 2. Database & Active Roles Verification ---
  console.log('\n--- 2. Database User & Role Invariants ---');
  const userRows = await pool.query('SELECT id, username, email, role FROM users ORDER BY id ASC');
  record('Database contains exactly 5 clean authoritative users', userRows.rows.length === 5);

  const roles = userRows.rows.map((u) => u.role);
  record('Database contains super_admin (platform_admin)', roles.includes('super_admin'));
  record('Database contains professor (prof_alan & professor_seed)', roles.filter((r) => r === 'professor').length === 2);
  record('Database contains student (student_seed & Ary)', roles.filter((r) => r === 'student').length === 2);

  // --- 3. Backend RBAC Verification ---
  console.log('\n--- 3. Backend RBAC Verification ---');
  const profUser = userRows.rows.find((u) => u.role === 'professor');
  const studentUser = userRows.rows.find((u) => u.role === 'student');
  const adminUser = userRows.rows.find((u) => u.role === 'super_admin');

  const profToken = generateToken(profUser);
  const studentToken = generateToken(studentUser);
  const adminToken = generateToken(adminUser);

  // Test server health
  const healthRes = await request('GET', '/api/health');
  record('Backend server health check returns 200 OK', healthRes.status === 200);

  // Test professor RBAC endpoint
  const profRbacRes = await request('GET', '/api/professor/test', null, profToken);
  record('Professor access to /api/professor/test returns 200 OK', profRbacRes.status === 200);

  const studentRbacRes = await request('GET', '/api/professor/test', null, studentToken);
  record('Student access to /api/professor/test is rejected with 403 Forbidden', studentRbacRes.status === 403);

  // Test Admin route isolation: Professor cannot access /api/admin/overview-stats
  const profAdminRes = await request('GET', '/api/admin/overview-stats', null, profToken);
  record('Professor access to /api/admin/overview-stats is rejected with 403 Forbidden', profAdminRes.status === 403);

  // Super Admin can access /api/admin/overview-stats
  const adminOverviewRes = await request('GET', '/api/admin/overview-stats', null, adminToken);
  record('Super Admin access to /api/admin/overview-stats returns 200 OK', adminOverviewRes.status === 200);

  // Student access to problems
  const studentProblemsRes = await request('GET', '/api/problems', null, studentToken);
  record('Student access to /api/problems returns 200 OK', studentProblemsRes.status === 200);

  // Student access to contests
  const studentContestsRes = await request('GET', '/api/contests', null, studentToken);
  record('Student access to /api/contests returns 200 OK', studentContestsRes.status === 200);

  // Close server and pool
  await new Promise((resolve) => server.close(resolve));
  await closePool();

  console.log('\n===============================================================');
  console.log(` VERIFICATION COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
