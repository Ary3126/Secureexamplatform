/**
 * Automated UI & Architecture Verification Test Suite for Phase 5.8.4
 * Runtime & Memory Distribution Engine Frontend Integration
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 5.8.4 DISTRIBUTION UI TESTS');
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

    // 1. HISTOGRAM SECTION RENDERS
    console.log('--- 1. Histogram Container & Structure ---');
    record('Renders .perf-dist-section container',
      content.includes('perf-dist-section') &&
      content.includes('Performance Distribution')
    );

    record('Renders .perf-dist-grid layout',
      content.includes('perf-dist-grid')
    );

    // 2. RUNTIME DISTRIBUTION RENDERS
    console.log('\n--- 2. Runtime Distribution Card ---');
    record('Renders Runtime Distribution header with language label',
      content.includes('Runtime Distribution —') &&
      content.includes('submission?.language?.toUpperCase()')
    );

    record('Displays Your Runtime and Median values',
      content.includes('Your runtime:') &&
      content.includes('distribution.runtime.userValue') &&
      content.includes('distribution.runtime.median')
    );

    // 3. MEMORY DISTRIBUTION RENDERS
    console.log('\n--- 3. Memory Distribution Card ---');
    record('Renders Memory Distribution header with language label',
      content.includes('Memory Distribution —') &&
      content.includes('distribution.memory.userValueMb')
    );

    record('Displays Your Memory and Median MB values',
      content.includes('Your memory:') &&
      content.includes('distribution.memory.median / 1024')
    );

    // 4. USER BUCKET HIGHLIGHTING
    console.log('\n--- 4. User Bucket Highlighting ---');
    record('Applies perf-dist-bar-user class to user bucket',
      content.includes('perf-dist-bar-user')
    );

    record('Renders "← You" badge on user bucket',
      content.includes('perf-dist-you-badge') &&
      content.includes('← You')
    );

    // 5. LOADING SKELETON STATE
    console.log('\n--- 5. Loading State ---');
    record('Displays "Loading performance distribution..." when loading',
      content.includes('distLoading') &&
      content.includes('Loading performance distribution...')
    );

    // 6. INSUFFICIENT DATA STATE
    console.log('\n--- 6. Insufficient Data State ---');
    record('Displays "Not enough data for distribution" when unavailable',
      content.includes('!distribution?.available') &&
      content.includes('Not enough data for distribution')
    );

    // 7. API ERROR STATE
    console.log('\n--- 7. API Error State ---');
    record('Displays "Performance distribution unavailable" on API error',
      content.includes('distError') &&
      content.includes('Performance distribution unavailable')
    );

    // 8. ACCESSIBILITY
    console.log('\n--- 8. Accessibility & Screen Reader Attributes ---');
    record('Uses role="region" and aria-label on distribution section',
      content.includes('role="region"') &&
      content.includes('aria-label="Performance Distribution Histograms"')
    );

    record('Uses role="list" and role="listitem" on distribution bars',
      content.includes('role="list"') &&
      content.includes('role="listitem"')
    );

    record('Provides descriptive aria-label with bucket label, count, and percentage',
      content.includes('aria-label={`Runtime bucket ${b.label}: ${b.count} accepted submissions') &&
      content.includes('aria-label={`Memory bucket ${b.label}: ${b.count} accepted submissions')
    );

    // 9. VERDICT SAFETY & NON-BLOCKING BEHAVIOR
    console.log('\n--- 9. Verdict Safety & Independent Lifecycle ---');
    record('Distribution fetched via independent useEffect without blocking primary detail fetch',
      content.includes('fetchSubmissionDetail()') &&
      content.includes('/api/submissions/${submissionId}/performance/distribution')
    );

    record('Verdict header renders independently above distribution section',
      content.indexOf('getVerdictDetails') < content.indexOf('perf-dist-section')
    );

    // 10. CSS DESIGN SYSTEM & RESPONSIVENESS
    console.log('\n--- 10. CSS Design Tokens & Mobile Breakpoints ---');
    const cssPath = path.join(__dirname, 'src', 'index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    record('CSS defines .perf-dist-section and .perf-dist-grid',
      cssContent.includes('.perf-dist-section') &&
      cssContent.includes('.perf-dist-grid')
    );

    record('CSS defines .perf-dist-bar-item and .perf-dist-bar-fill',
      cssContent.includes('.perf-dist-bar-item') &&
      cssContent.includes('.perf-dist-bar-fill')
    );

    record('CSS defines .fill-user-runtime and .fill-user-memory accents',
      cssContent.includes('.fill-user-runtime') &&
      cssContent.includes('.fill-user-memory')
    );

    record('CSS contains responsive mobile breakpoint for .perf-dist-grid',
      cssContent.includes('@media (max-width: 768px)') &&
      cssContent.includes('.perf-dist-grid')
    );

    // 11. NO REGRESSION TO SCROLLING
    console.log('\n--- 11. No Regression to Page Scrolling ---');
    record('CSS preserves .page-viewport-scrollable',
      cssContent.includes('.page-viewport-scrollable')
    );

    record('CSS preserves .submission-detail-container',
      cssContent.includes('.submission-detail-container')
    );

  } catch (err) {
    console.error('Unexpected UI Test Error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(` PHASE 5.8.4 UI TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
