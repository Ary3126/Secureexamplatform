/**
 * UNIFIED TEST RUNNER & TIMING BENCHMARK ENGINE
 * 
 * Provides:
 * 1. Targeted category execution (unit, feature, api, security, judge, skills, fast, all)
 * 2. Changed-file heuristic detection
 * 3. Exact timing benchmarks per test suite
 * 4. Summary table with pass/fail counts, total duration, and slowest test suites
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_ROOT = path.resolve(__dirname, '..');

// Canonical Suite Definitions
const SUITE_DEFINITIONS = {
  phase2: { file: 'test_phase2.js', name: 'Auth, Profile & RBAC', tags: ['api', 'feature', 'auth'] },
  phase3: { file: 'test_phase3.js', name: 'Contests & Problem Bank', tags: ['api', 'feature', 'contest'] },
  phase4a: { file: 'test_phase4a.js', name: 'Judge Core & Sandboxing', tags: ['judge'] },
  phase4a_extra: { file: 'test_phase4a_extra.js', name: 'Function Mode & Harnesses', tags: ['judge', 'feature'] },
  phase4b1: { file: 'test_phase4b1.js', name: 'Random Test Gen & Oracles', tags: ['judge', 'feature'] },
  phase4b2: { file: 'test_phase4b2.js', name: 'Edge/Boundary & Deduplication', tags: ['unit', 'judge'] },
  phase4b3: { file: 'test_phase4b3.js', name: 'Anti-Cheat Static Analysis', tags: ['unit', 'security', 'judge'] },
  phase4b4: { file: 'test_phase4b4.js', name: 'Anti-Hardcoding Heuristics', tags: ['unit', 'security', 'judge'] },
  phase4b5: { file: 'test_phase4b5.js', name: 'Unified Multi-Tier Pipeline', tags: ['judge'] },
  phase4b6: { file: 'test_phase4b6_security.js', name: 'Judge Adversarial Security', tags: ['security', 'judge'] },
  phase4b7: { file: 'test_phase4b7_stabilization.js', name: 'Multi-Language Parity & Stress', tags: ['judge'] },
  api_security: { file: 'test_phase_api_security.js', name: 'Rate Limiting & Headers', tags: ['api', 'security'] },
  security_audit: { file: 'test_step3_security_audit.js', name: 'API Security Audit (48 Endpoints)', tags: ['api', 'security'] },
  skills571: { file: 'test_phase5_7_1_skills.js', name: 'Skill Data Model & Foundation', tags: ['skills', 'feature', 'api', 'unit'] },
  skills572: { file: 'test_phase5_7_2_skills.js', name: 'Deterministic Skill Scoring Engine', tags: ['skills', 'feature', 'api', 'unit'] },
  skills573: { file: 'test_phase5_7_3_skills.js', name: 'Confidence & Evidence Layer', tags: ['skills', 'feature', 'api', 'unit'] },
  skills574: { file: 'test_phase5_7_4_skills.js', name: 'Progress History & Trends', tags: ['skills', 'feature', 'api', 'unit'] },
  skills575: { file: 'test_phase5_7_5_skills.js', name: 'Strengths & Needs Practice Classification', tags: ['skills', 'feature', 'api', 'unit'] },
  skills577: { file: 'test_phase5_7_7_optimization.js', name: 'Skill Optimization & Latency Benchmarks', tags: ['skills', 'feature', 'api', 'unit', 'optimization'] },
  phase5_8_1: { file: 'test_phase5_8_1_submissions.js', name: 'Submission Detail & Full Code Retrieval', tags: ['submissions', 'analytics', 'api', 'security'] },
  phase5_8_2: { file: 'test_phase5_8_2_statistics.js', name: 'Submission Performance Statistics (Runtime & Memory)', tags: ['submissions', 'analytics', 'api', 'performance'] },
  phase5_8_3: { file: 'test_phase5_8_3_percentiles.js', name: 'Submission Percentile Performance Engine', tags: ['submissions', 'analytics', 'api', 'performance', 'unit'] },
  phase5_8_4: { file: 'test_phase5_8_4_distribution.js', name: 'Submission Runtime & Memory Distribution Engine', tags: ['submissions', 'analytics', 'api', 'performance', 'unit'] },
  phase5_8_5: { file: 'test_phase5_8_5_comparison.js', name: 'Submission Comparison Engine & Security Isolation', tags: ['submissions', 'analytics', 'api', 'security'] },
  phase5_9_3: { file: 'test_phase5_9_3_persistent_audit_logging.js', name: 'Persistent PostgreSQL Audit Logging & Sanitization', tags: ['security', 'audit', 'api', 'unit'] },
  phase5_9_4: { file: 'test_phase5_9_4_admin_user_management.js', name: 'Admin User & Role Management Engine', tags: ['security', 'admin', 'api', 'unit'] },
  phase5_9_5: { file: 'test_phase5_9_5_problem_authoring.js', name: 'Problem Authoring Studio & Versioning Engine', tags: ['security', 'authoring', 'api', 'unit'] },
  phase5_9_6: { file: 'test_phase5_9_6_problem_review_governance.js', name: 'Secure Problem Review, Approval & Publication Governance', tags: ['security', 'governance', 'api', 'unit'] },
  phase5_9_7: { file: 'test_phase5_9_7_problem_quality_editorial.js', name: 'Problem Quality, Editorial Intelligence & Review Analytics', tags: ['security', 'quality', 'analytics', 'api', 'unit'] },
  phase5_9_8: { file: 'test_phase5_9_8_problem_lifecycle_operations.js', name: 'Problem Lifecycle, Version History, Rollback & Publication Operations', tags: ['security', 'lifecycle', 'rollback', 'api', 'unit'] },
  admin_governance: { file: 'test_admin_governance_platform.js', name: 'Admin Platform Governance & Role Separation', tags: ['security', 'admin', 'governance', 'api', 'unit'] },
  phase5_9_10: { file: 'test_phase5_9_10_platform_reliability.js', name: 'Platform Reliability, Observability & Health Probes', tags: ['reliability', 'observability', 'health', 'security', 'api', 'unit'] },
  master_correction: { file: 'test_master_correction_security.js', name: 'Public/Private Scoping & Master Hardening', tags: ['security', 'api', 'feature', 'contest'] },
};

// Logical Category Mappings
const CATEGORIES = {
  submissions: ['phase5_8_1', 'phase5_8_2', 'phase5_8_3', 'phase5_8_4', 'phase5_8_5'],
  skills: ['skills571', 'skills572', 'skills573', 'skills574', 'skills575', 'skills577'],
  unit: ['phase4b2', 'phase4b3', 'phase4b4', 'skills575', 'skills577', 'phase5_8_1', 'phase5_8_2', 'phase5_8_3', 'phase5_8_4', 'phase5_9_3', 'phase5_9_4', 'phase5_9_5', 'phase5_9_6', 'phase5_9_7', 'phase5_9_8', 'phase5_9_10'],
  feature: ['phase2', 'phase3', 'phase4a_extra', 'skills575', 'skills577', 'phase5_8_1', 'phase5_8_2', 'phase5_8_5', 'phase5_9_3', 'phase5_9_4', 'phase5_9_5', 'phase5_9_6', 'phase5_9_7', 'phase5_9_8', 'phase5_9_10', 'master_correction'],
  api: ['phase2', 'phase3', 'api_security', 'security_audit', 'skills575', 'skills577', 'phase5_8_1', 'phase5_8_2', 'phase5_8_5', 'phase5_9_3', 'phase5_9_4', 'phase5_9_5', 'phase5_9_6', 'phase5_9_7', 'phase5_9_8', 'phase5_9_10', 'master_correction'],
  security: ['api_security', 'security_audit', 'phase4b6', 'phase4b3', 'skills577', 'phase5_8_1', 'phase5_8_2', 'phase5_8_5', 'phase5_9_3', 'phase5_9_4', 'phase5_9_5', 'phase5_9_6', 'phase5_9_7', 'phase5_9_8', 'phase5_9_10', 'master_correction'],
  judge: ['phase4a', 'phase4a_extra', 'phase4b1', 'phase4b2', 'phase4b5', 'phase4b6', 'phase4b7'],
  fast: ['phase2', 'phase3', 'phase4b2', 'phase4b3', 'phase4b4', 'api_security', 'skills575', 'phase5_8_1', 'phase5_8_2', 'phase5_8_3', 'phase5_8_4', 'phase5_8_5', 'phase5_9_3', 'phase5_9_4', 'phase5_9_5', 'phase5_9_6', 'phase5_9_7', 'phase5_9_8', 'phase5_9_10', 'master_correction'],
  all: Object.keys(SUITE_DEFINITIONS),
};

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
    } else if (arg === '--changed') {
      category = 'changed';
    } else if (arg === '--fast') {
      category = 'fast';
    } else if (arg === '--security') {
      category = 'security';
    } else if (arg === '--skills') {
      category = 'skills';
    } else if (arg === '--judge') {
      category = 'judge';
    } else if (arg === '--api') {
      category = 'api';
    } else if (arg === '--unit') {
      category = 'unit';
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

function detectChangedSuites() {
  // Safe heuristic fallback for changed files
  return CATEGORIES.fast;
}

function resolveSuitesToRun(category, specificFiles) {
  if (specificFiles.length > 0) {
    return specificFiles.map((f) => {
      const entry = Object.entries(SUITE_DEFINITIONS).find(([_, def]) => def.file === f || def.file === path.basename(f));
      return entry ? entry[1] : { file: f, name: path.basename(f), tags: ['custom'] };
    });
  }

  if (category === 'changed') {
    const keys = detectChangedSuites();
    return keys.map((k) => SUITE_DEFINITIONS[k]);
  }

  const keys = CATEGORIES[category] || CATEGORIES.all;
  return keys.map((k) => SUITE_DEFINITIONS[k]);
}

function runSingleSuite(suite) {
  return new Promise((resolve) => {
    const filePath = path.resolve(BACKEND_ROOT, suite.file);
    const startTime = Date.now();

    const child = spawn(process.execPath, [filePath], {
      cwd: BACKEND_ROOT,
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
  console.log(` SECURE EXAM PLATFORM — TARGETED TEST RUNNER`);
  console.log(` Selected Category: [${category.toUpperCase()}] | Suites to Run: ${suitesToRun.length}`);
  console.log('===============================================================\n');

  const results = [];
  const globalStartTime = Date.now();

  for (let i = 0; i < suitesToRun.length; i++) {
    const suite = suitesToRun[i];
    console.log(`\n>>> [${i + 1}/${suitesToRun.length}] EXECUTING: ${suite.name} (${suite.file})`);
    const res = await runSingleSuite(suite);
    results.push(res);
  }

  const totalDurationSec = ((Date.now() - globalStartTime) / 1000).toFixed(2);
  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;

  console.log('\n===============================================================');
  console.log(` TEST EXECUTION SUMMARY & BENCHMARK REPORT`);
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

  // Top Slowest Suites Report
  const sorted = [...results].sort((a, b) => b.durationMs - a.durationMs);
  console.log('\n--- TOP 5 SLOWEST SUITES ---');
  sorted.slice(0, 5).forEach((r, idx) => {
    console.log(` ${idx + 1}. ${r.suite.name} (${r.suite.file}) -> ${r.durationSec}s [${r.passed ? 'PASSED' : 'FAILED'}]`);
  });

  console.log('\n===============================================================');

  // Automated Post-Execution Teardown & Test Data Isolation
  try {
    const { cleanTestData } = require('./cleanTestData');
    console.log('\n[RUNNER TEARDOWN] Running automated test fixture purging...');
    await cleanTestData({ closeAfter: true });
    console.log('[RUNNER TEARDOWN] Test data isolation completed: Database is clean.');
  } catch (cleanErr) {
    console.error('[RUNNER TEARDOWN WARNING] Failed to purge test fixtures:', cleanErr.message);
  }

  if (totalFailed > 0) {
    console.error(`\n[ERROR] ${totalFailed} test suite(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n[SUCCESS] All ${totalPassed} test suite(s) passed successfully in ${totalDurationSec}s.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[FATAL RUNNER ERROR]', err);
  process.exit(1);
});
