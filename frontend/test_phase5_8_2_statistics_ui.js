/**
 * Automated UI & Architecture Verification Test Suite for Phase 5.8.2
 * Submission Performance Statistics (Runtime & Memory)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 5.8.2 PERFORMANCE STATS UI TESTS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function record(title, condition, detail = '') {
    if (condition) {
      console.log(`  ✓ ${title}`);
      passed++;
    } else {
      console.error(`  ✗ ${title} [FAIL: ${detail}]`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------
    // 1. COMPONENT STATIC ARCHITECTURE & RENDERING
    // -------------------------------------------------------------------
    console.log('--- 1. Component Static Architecture & Rendering ---');

    const subDetailPath = path.join(__dirname, 'src', 'components', 'SubmissionDetail.jsx');
    record('SubmissionDetail.jsx exists', fs.existsSync(subDetailPath));

    const subDetailContent = fs.readFileSync(subDetailPath, 'utf8');

    record('Component handles performanceStats payload',
      subDetailContent.includes('submission.performanceStats')
    );

    record('Component renders Performance Benchmark card container',
      subDetailContent.includes('submission-perf-stats-card') &&
      subDetailContent.includes('Performance Benchmark')
    );

    record('Component renders scope comparison badge with sampleCount and language',
      subDetailContent.includes('perf-stats-scope-badge') &&
      subDetailContent.includes('submission.performanceStats.runtime?.sampleCount') &&
      subDetailContent.includes('submission.language?.toUpperCase()')
    );

    record('Component renders parallel Runtime and Memory comparative columns',
      subDetailContent.includes('Execution Runtime') &&
      subDetailContent.includes('Memory Utilization') &&
      subDetailContent.includes('perf-stat-column')
    );

    record('Component displays target solution values for both runtime and memory',
      subDetailContent.includes('Your Solution') &&
      subDetailContent.includes('perf-current-box') &&
      subDetailContent.includes('perf-current-value')
    );

    record('Component renders complete runtime aggregate breakdown (Min, Median, Average, Max)',
      subDetailContent.includes('Fastest (Min)') &&
      subDetailContent.includes('Median (50th %)') &&
      subDetailContent.includes('Average') &&
      subDetailContent.includes('Slowest (Max)') &&
      subDetailContent.includes('submission.performanceStats.runtime.minMs') &&
      subDetailContent.includes('submission.performanceStats.runtime.medianMs') &&
      subDetailContent.includes('submission.performanceStats.runtime.averageMs') &&
      subDetailContent.includes('submission.performanceStats.runtime.maxMs')
    );

    record('Component renders complete memory aggregate breakdown (Min, Median, Average, Max)',
      subDetailContent.includes('Lowest (Min)') &&
      subDetailContent.includes('Highest (Max)') &&
      subDetailContent.includes('submission.performanceStats.memory.minKb') &&
      subDetailContent.includes('submission.performanceStats.memory.medianKb') &&
      subDetailContent.includes('submission.performanceStats.memory.averageKb') &&
      subDetailContent.includes('submission.performanceStats.memory.maxKb')
    );

    record('Component formats memory values cleanly into MB/KB',
      subDetailContent.includes('/ 1024).toFixed(1)} MB')
    );

    record('Component renders empty state when zero comparable submissions exist',
      subDetailContent.includes('perf-empty-state') &&
      subDetailContent.includes('Performance statistics are not available yet')
    );

    record('Component handles missing target runtime metrics without displaying fake zeros',
      subDetailContent.includes("'N/A'")
    );

    // -------------------------------------------------------------------
    // 2. CSS DESIGN SYSTEM & RESPONSIVENESS
    // -------------------------------------------------------------------
    console.log('\n--- 2. CSS Design System & Responsive Tokens ---');

    const cssPath = path.join(__dirname, 'src', 'index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    record('index.css contains .submission-perf-stats-card styling',
      cssContent.includes('.submission-perf-stats-card')
    );

    record('index.css contains .perf-stats-header and .perf-stats-scope-badge',
      cssContent.includes('.perf-stats-header') &&
      cssContent.includes('.perf-stats-scope-badge')
    );

    record('index.css contains .perf-stats-grid layout',
      cssContent.includes('.perf-stats-grid') &&
      cssContent.includes('grid-template-columns: repeat(2, 1fr)')
    );

    record('index.css contains .perf-stat-column and .perf-current-box',
      cssContent.includes('.perf-stat-column') &&
      cssContent.includes('.perf-current-box')
    );

    record('index.css contains .perf-aggregates-table and .perf-aggregate-row',
      cssContent.includes('.perf-aggregates-table') &&
      cssContent.includes('.perf-aggregate-row')
    );

    record('index.css contains .highlight-median accent token',
      cssContent.includes('.highlight-median')
    );

    record('index.css contains mobile responsive breakpoint for performance grid',
      cssContent.includes('@media (max-width: 768px)') &&
      cssContent.includes('.perf-stats-grid')
    );

  } catch (err) {
    console.error('Unexpected UI Test Error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(` PHASE 5.8.2 UI TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
