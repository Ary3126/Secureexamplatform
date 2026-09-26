/**
 * FRONTEND TEST RUNNER & TIMING BENCHMARK ENGINE
 * 
 * Provides:
 * 1. Targeted category execution (auth, dashboard, contest, leaderboard, profile, nav, fast, all)
 * 2. Exact timing benchmarks per test suite
 * 3. Summary table with pass/fail counts, total duration, and slowest test suites
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, '..');

const SUITE_DEFINITIONS = {
  auth: { file: 'test_phase5_1.js', name: 'Auth UX & Theme System', tags: ['auth', 'theme'] },
  dashboard: { file: 'test_phase5_2.js', name: 'Student Dashboard & Explorer', tags: ['dashboard', 'problems'] },
  submissions: { file: 'test_phase5_3.js', name: 'Submission History & Analytics', tags: ['submissions', 'analytics'] },
  rating: { file: 'test_phase5_4.js', name: 'Rating & Elo Calculation', tags: ['rating', 'elo'] },
  profile: { file: 'test_coder_profile.js', name: 'Coder Identity Profile Matrix', tags: ['profile', 'identity'] },
  standings: { file: 'test_phase5_5.js', name: 'Contest Leaderboard & Freeze', tags: ['contest', 'standings'] },
  leaderboard: { file: 'test_phase5_6.js', name: 'Global & College Leaderboard', tags: ['leaderboard', 'snapshots'] },
  nav: { file: 'test_navigation_refactor.js', name: 'Navigation & AppShell Refactor', tags: ['nav', 'appshell'] },
  skills_ui: { file: 'test_phase5_7_6_skills_ui.js', name: 'Skills & Progress UI Visualization', tags: ['skills', 'profile', 'dashboard', 'ui'] },
  submission_detail: { file: 'test_phase5_8_1_submission_detail_ui.js', name: 'Submission Detail & Code Viewer UI', tags: ['submissions', 'ui', 'code'] },
  statistics_ui: { file: 'test_phase5_8_2_statistics_ui.js', name: 'Submission Performance Statistics UI', tags: ['submissions', 'ui', 'performance'] },
  percentiles_ui: { file: 'test_phase5_8_3_percentiles_ui.js', name: 'Submission Percentiles & Relative Performance UI', tags: ['submissions', 'ui', 'percentiles'] },
  distribution_ui: { file: 'test_phase5_8_4_distribution_ui.js', name: 'Submission Runtime & Memory Distribution UI', tags: ['submissions', 'ui', 'distribution'] },
  comparison_ui: { file: 'test_phase5_8_5_comparison_ui.js', name: 'Submission Comparison UI & Authorization Separation', tags: ['submissions', 'ui', 'comparison'] },
  master_correction_ui: { file: 'test_master_correction_ui.js', name: 'Master Correction & Button Deduplication UI', tags: ['workspace', 'ui', 'scroll'] },
  phase6_ui: { file: 'test_phase6_stabilization_ui.js', name: 'Phase 6 Frontend Stabilization & Architecture Verification', tags: ['ui', 'architecture', 'nav', 'fast'] },
  admin_shell: { file: 'test_admin_phase1_shell.js', name: 'Admin Architecture & Layout Shell (Phase 7.1)', tags: ['admin', 'shell', 'nav', 'fast'] },
  admin_dashboard: { file: 'test_admin_phase2_dashboard.js', name: 'Admin Dashboard Metrics & UI Logic (Phase 7.2)', tags: ['admin', 'dashboard', 'fast'] },
  admin_users: { file: 'test_admin_phase3_users.js', name: 'Admin User Management & Role Governance (Phase 7.3)', tags: ['admin', 'users', 'fast'] },
};

const CATEGORIES = {
  nav: ['nav', 'admin_shell'],
  auth: ['auth'],
  dashboard: ['dashboard', 'submissions', 'profile', 'skills_ui', 'admin_dashboard'],
  contest: ['standings', 'rating'],
  leaderboard: ['leaderboard', 'standings'],
  profile: ['profile', 'skills_ui'],
  skills_ui: ['skills_ui'],
  submissions: ['submissions', 'submission_detail', 'statistics_ui', 'percentiles_ui', 'distribution_ui', 'comparison_ui'],
  admin: ['admin_shell', 'admin_dashboard', 'admin_users'],
  fast: ['nav', 'auth', 'dashboard', 'profile', 'skills_ui', 'submission_detail', 'statistics_ui', 'percentiles_ui', 'distribution_ui', 'comparison_ui', 'master_correction_ui', 'phase6_ui', 'admin_shell', 'admin_dashboard', 'admin_users'],
  all: Object.keys(SUITE_DEFINITIONS),
  regression: Object.keys(SUITE_DEFINITIONS),
};

async function isBackendAlive() {
  try {
    const res = await fetch('http://localhost:5000/api/health');
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function ensureBackendRunning() {
  const alive = await isBackendAlive();
  if (alive) {
    return { process: null, started: false };
  }

  console.log('[FRONTEND RUNNER] Backend not running on port 5000. Spawning test server...');
  const backendRoot = path.resolve(FRONTEND_ROOT, '../backend');
  const serverPath = path.resolve(backendRoot, 'src/server.js');

  const backendProc = spawn(process.execPath, [serverPath], {
    cwd: backendRoot,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', PORT: '5000' },
  });

  // Poll until backend health is 200 OK (up to 10 seconds)
  const start = Date.now();
  while (Date.now() - start < 10000) {
    await new Promise((r) => setTimeout(r, 400));
    if (await isBackendAlive()) {
      console.log('[FRONTEND RUNNER] Backend test server ready on http://localhost:5000.');
      return { process: backendProc, started: true };
    }
  }

  console.warn('[FRONTEND RUNNER WARNING] Backend server failed to start within timeout.');
  return { process: backendProc, started: true };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let category = 'all';
  let specificFiles = [];

  for (const arg of args) {
    if (arg.startsWith('--category=')) {
      category = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--tag=')) {
      category = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--file=')) {
      specificFiles.push(arg.split('=')[1]);
    } else if (arg === '--nav') {
      category = 'nav';
    } else if (arg === '--auth') {
      category = 'auth';
    } else if (arg === '--fast') {
      category = 'fast';
    } else if (!arg.startsWith('--')) {
      if (CATEGORIES[arg]) {
        category = arg;
      } else if (SUITE_DEFINITIONS[arg]) {
        specificFiles.push(SUITE_DEFINITIONS[arg].file);
      } else if (arg.endsWith('.js')) {
        specificFiles.push(arg);
      }
    }
  }

  return { category, specificFiles };
}

function resolveSuitesToRun(category, specificFiles) {
  if (specificFiles.length > 0) {
    return specificFiles.map((f) => {
      const entry = Object.entries(SUITE_DEFINITIONS).find(([_, def]) => def.file === f || def.file === path.basename(f));
      return entry ? entry[1] : { file: f, name: path.basename(f), tags: ['custom'] };
    });
  }

  const keys = CATEGORIES[category] || CATEGORIES.all;
  return keys.map((k) => SUITE_DEFINITIONS[k]);
}

function runSingleSuite(suite) {
  return new Promise((resolve) => {
    const filePath = path.resolve(FRONTEND_ROOT, suite.file);
    const startTime = Date.now();

    const child = spawn(process.execPath, [filePath], {
      cwd: FRONTEND_ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolve({
        suite,
        passed: code === 0,
        exitCode: code,
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2),
      });
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        suite,
        passed: false,
        exitCode: 1,
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2),
        error: err.message,
      });
    });
  });
}

async function main() {
  const { category, specificFiles } = parseArgs();
  const suitesToRun = resolveSuitesToRun(category, specificFiles);

  console.log('\n===============================================================');
  console.log(` FRONTEND TEST RUNNER — TARGETED EXECUTION`);
  console.log(` Selected Category: [${category.toUpperCase()}] | Suites to Run: ${suitesToRun.length}`);
  console.log('===============================================================\n');

  // Check if any selected suite requires live backend
  const requiresBackend = suitesToRun.some((s) => s.file !== 'test_navigation_refactor.js');
  let backendSession = { process: null, started: false };

  if (requiresBackend) {
    backendSession = await ensureBackendRunning();
  }

  const results = [];
  const globalStartTime = Date.now();

  try {
    for (let i = 0; i < suitesToRun.length; i++) {
      const suite = suitesToRun[i];
      console.log(`\n>>> [${i + 1}/${suitesToRun.length}] EXECUTING: ${suite.name} (${suite.file})`);
      const res = await runSingleSuite(suite);
      results.push(res);
    }
  } finally {
    if (backendSession.started && backendSession.process) {
      console.log('[FRONTEND RUNNER] Cleaning up spawned backend test server...');
      backendSession.process.kill();
    }
  }

  const totalDurationSec = ((Date.now() - globalStartTime) / 1000).toFixed(2);
  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;

  console.log('\n===============================================================');
  console.log(` FRONTEND TEST EXECUTION SUMMARY`);
  console.log('===============================================================');
  console.log(`Category:          ${category.toUpperCase()}`);
  console.log(`Suites Executed:   ${results.length}`);
  console.log(`Suites Passed:     ${totalPassed}`);
  console.log(`Suites Failed:     ${totalFailed}`);
  console.log(`Total Duration:    ${totalDurationSec}s\n`);

  console.log('--- PER-SUITE BREAKDOWN ---');
  console.table(
    results.map((r) => ({
      Suite: r.suite.name,
      File: r.suite.file,
      Status: r.passed ? 'PASSED' : 'FAILED',
      'Time (s)': `${r.durationSec}s`,
    }))
  );

  console.log('\n===============================================================');

  if (totalFailed > 0) {
    console.error(`\n[ERROR] ${totalFailed} frontend test suite(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n[SUCCESS] All ${totalPassed} frontend test suite(s) passed successfully in ${totalDurationSec}s.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[FATAL FRONTEND RUNNER ERROR]', err);
  process.exit(1);
});
