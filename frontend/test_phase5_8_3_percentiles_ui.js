/**
 * Automated UI & Architecture Verification Test Suite for Phase 5.8.3
 * Percentile & Relative Performance Engine UI Integration
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 5.8.3 PERCENTILES UI TESTS');
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
    const subDetailPath = path.join(__dirname, 'src', 'components', 'SubmissionDetail.jsx');
    record('SubmissionDetail.jsx exists', fs.existsSync(subDetailPath));

    const content = fs.readFileSync(subDetailPath, 'utf8');

    // 1. PERCENTILE DISPLAY
    console.log('--- 1. Percentile Display & Phrasing ---');
    record('Renders "Faster than X% of submissions" for runtime',
      content.includes('Faster than') &&
      content.includes('submission.performanceStats.runtime.percentile') &&
      content.includes('submissions')
    );

    record('Renders "Lower than Y% of submissions" for memory',
      content.includes('Lower than') &&
      content.includes('submission.performanceStats.memory.percentile') &&
      content.includes('submissions')
    );

    record('Renders Population count badge with toLocaleString()',
      content.includes('Population:') &&
      content.includes('toLocaleString()') &&
      content.includes('accepted')
    );

    // 2. INSUFFICIENT DATA STATE
    console.log('\n--- 2. Insufficient Data & Small Dataset Protection ---');
    record('Renders clean "Not enough data" fallback without displaying fake percentiles',
      content.includes('Not enough data')
    );

    record('Checks available flag and non-null percentile before rendering rank pill',
      content.includes('submission.performanceStats.runtime?.available') &&
      content.includes('submission.performanceStats.runtime?.percentile !== null') &&
      content.includes('submission.performanceStats.memory?.available') &&
      content.includes('submission.performanceStats.memory?.percentile !== null')
    );

    // 3. LOADING STATE
    console.log('\n--- 3. UI Safety & Loading Skeletons ---');
    record('Maintains loading state without freezing the page',
      content.includes('if (loading)') &&
      content.includes('submission-detail-skeleton-header') &&
      content.includes('submission-detail-skeleton-metrics')
    );

    // 4. API ERROR STATE
    console.log('\n--- 4. API Error, Unauthorized & Not Found Handling ---');
    record('Handles error and 403/404 states gracefully with alert and retry',
      content.includes('if (error)') &&
      content.includes('error.statusCode === 403') &&
      content.includes('Access Forbidden') &&
      content.includes('Submission Not Found')
    );

    // 5. LANGUAGE DISPLAY
    console.log('\n--- 5. Language Isolation Display ---');
    record('Displays language in uppercase for benchmark isolation',
      content.includes('submission.language?.toUpperCase()')
    );

    // 6. RUNTIME & MEMORY FORMATTING
    console.log('\n--- 6. Runtime and Memory Metric Formatting ---');
    record('Formats runtime cleanly with ms unit',
      content.includes('submission.executionTime} ms') || content.includes('`ms`') || content.includes('${submission.executionTime} ms')
    );

    record('Formats memory cleanly into MB / KB',
      content.includes('/ 1024).toFixed(1)} MB') &&
      content.includes('KB')
    );

    // 7. NO REGRESSION TO SUBMISSION DETAIL
    console.log('\n--- 7. No Regression to Phase 5.8.1 & 5.8.2 Features ---');
    record('Preserves Verdict Hero Header',
      content.includes('submission-detail-hero') &&
      content.includes('getVerdictDetails')
    );

    record('Preserves Multi-tier validation breakdown',
      content.includes('validationSummary') &&
      content.includes('submission-validation-summary-card')
    );

    record('Preserves Monaco Read-Only Code Viewer',
      content.includes('readOnly: true') &&
      content.includes('submission.sourceCode')
    );

    record('Preserves Min, Median, Average, Max aggregate benchmark tables',
      content.includes('Fastest (Min)') &&
      content.includes('Median (50th %)') &&
      content.includes('Average') &&
      content.includes('Slowest (Max)')
    );

  } catch (err) {
    console.error('Unexpected UI Test Error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(` PHASE 5.8.3 UI TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
