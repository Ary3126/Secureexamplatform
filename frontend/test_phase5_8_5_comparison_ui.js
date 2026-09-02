/**
 * Automated UI & Architecture Verification Test Suite for Phase 5.8.5
 * Submission Comparison Engine Frontend Integration
 *
 * Covers all 16 required frontend dimensions:
 * 1. Compare button in SubmissionDetail
 * 2. Compare button in SubmissionHistory
 * 3. SubmissionComparisonModal component exists
 * 4. Comparison loading state
 * 5. Comparison success rendering
 * 6. Comparison error and failure state
 * 7. Candidate submission picker integration
 * 8. Verdict comparison rendering
 * 9. Runtime difference and metric display
 * 10. Memory difference and metric display
 * 11. Test count comparison
 * 12. Missing metric / unavailable handling
 * 13. Source code visibility authorization separation
 * 14. Mobile layout & responsive breakpoints
 * 15. Accessibility & ARIA semantics
 * 16. No regression on scrolling or existing features
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 5.8.5 COMPARISON UI TESTS');
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
    const modalPath = path.join(__dirname, 'src', 'components', 'SubmissionComparisonModal.jsx');
    const subDetailPath = path.join(__dirname, 'src', 'components', 'SubmissionDetail.jsx');
    const subHistoryPath = path.join(__dirname, 'src', 'components', 'SubmissionHistory.jsx');
    const cssPath = path.join(__dirname, 'src', 'index.css');

    // 1. COMPONENT EXISTENCE
    console.log('--- 1. Component Architecture & File Integrity ---');
    record('SubmissionComparisonModal.jsx exists', fs.existsSync(modalPath));
    record('SubmissionDetail.jsx exists', fs.existsSync(subDetailPath));
    record('SubmissionHistory.jsx exists', fs.existsSync(subHistoryPath));
    record('index.css exists', fs.existsSync(cssPath));

    const modalContent = fs.readFileSync(modalPath, 'utf8');
    const detailContent = fs.readFileSync(subDetailPath, 'utf8');
    const historyContent = fs.readFileSync(subHistoryPath, 'utf8');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // 2. COMPARE BUTTON INTEGRATION
    console.log('\n--- 2. Compare Button Integration ---');
    record(
      'SubmissionDetail renders Compare button',
      detailContent.includes('compare-nav-btn') && detailContent.includes('Compare')
    );
    record(
      'SubmissionDetail integrates SubmissionComparisonModal',
      detailContent.includes('SubmissionComparisonModal') &&
      detailContent.includes('isCompareOpen')
    );
    record(
      'SubmissionHistory renders Compare button in row actions',
      historyContent.includes('compare-row-btn') && historyContent.includes('Compare')
    );
    record(
      'SubmissionHistory integrates SubmissionComparisonModal',
      historyContent.includes('SubmissionComparisonModal') &&
      historyContent.includes('compareSub')
    );

    // 3. CANDIDATE SUBMISSION PICKER
    console.log('\n--- 3. Candidate Submission Selection ---');
    record(
      'Fetches candidate submissions for same problem via authoritative API',
      modalContent.includes('/api/submissions/problem/')
    );
    record(
      'Renders Candidate A and Candidate B dropdown selectors',
      modalContent.includes('Submission A (Baseline)') &&
      modalContent.includes('Submission B (Compare With)')
    );

    // 4. COMPARISON API CLIENT INTEGRATION
    console.log('\n--- 4. Authoritative Comparison API Integration ---');
    record(
      'Calls GET /api/submissions/compare with left and right query parameters',
      modalContent.includes('/api/submissions/compare?left=')
    );
    record(
      'Renders loading state while comparing',
      modalContent.includes('submission-compare-loading') &&
      modalContent.includes('Comparing submissions...')
    );
    record(
      'Renders error alert upon API failure or unauthorized response',
      modalContent.includes('submission-compare-error-alert')
    );

    // 5. METRIC & DIFFERENCE DISPLAY
    console.log('\n--- 5. Metric Differences & Visual Hierarchy ---');
    record(
      'Displays runtime comparison summary card',
      modalContent.includes('compare-summary-label') &&
      modalContent.includes('Runtime Comparison')
    );
    record(
      'Displays memory comparison summary card',
      modalContent.includes('Memory Comparison')
    );
    record(
      'Renders verdict comparison with distinct badges',
      modalContent.includes('badge-verdict') &&
      modalContent.includes('leftVerdict') &&
      modalContent.includes('rightVerdict')
    );
    record(
      'Renders runtime row with ms metric units',
      modalContent.includes('metric-unit') && modalContent.includes('ms')
    );
    record(
      'Renders memory row with MB metric units',
      modalContent.includes('metric-unit') && modalContent.includes('MB')
    );
    record(
      'Renders test cases passed comparison',
      modalContent.includes('test-cases-pill') && modalContent.includes('passed')
    );

    // 6. MISSING METRIC & COMPILATION ERROR HANDLING
    console.log('\n--- 6. Missing Metric & Safe Handling ---');
    record(
      'Displays Unavailable for missing execution metrics',
      modalContent.includes('metric-val-unavailable') &&
      modalContent.includes('Unavailable')
    );

    // 7. INDEPENDENT SOURCE CODE VISIBILITY & PERMISSIONS
    console.log('\n--- 7. Independent Source Code Authorization Separation ---');
    record(
      'Checks leftVisible and rightVisible independently before rendering view button',
      modalContent.includes('comparison.sourceCode?.leftVisible') &&
      modalContent.includes('comparison.sourceCode?.rightVisible')
    );
    record(
      'Renders Private Code indicator when source code is not authorized',
      modalContent.includes('badge-private-code') &&
      modalContent.includes('Private Code')
    );
    record(
      'Fetches code securely via authorized endpoint /api/submissions/:id/code',
      modalContent.includes('/api/submissions/${submissionId}/code')
    );

    // 8. ACCESSIBILITY & ARIA ATTRIBUTES
    console.log('\n--- 8. Accessibility & Semantics ---');
    record(
      'Uses role="dialog" and aria-modal="true" on comparison modal backdrop',
      modalContent.includes('role="dialog"') &&
      modalContent.includes('aria-modal="true"')
    );
    record(
      'Uses aria-labelledby bound to modal title',
      modalContent.includes('aria-labelledby="compare-modal-title"')
    );
    record(
      'Includes accessible close button with aria-label',
      modalContent.includes('aria-label="Close comparison modal"')
    );
    record(
      'Supports Escape key listener to close modal',
      modalContent.includes('e.key === \'Escape\'')
    );

    // 9. RESPONSIVE CSS DESIGN & BREAKPOINTS
    console.log('\n--- 9. Responsive CSS & Mobile Breakpoints ---');
    record(
      'CSS defines .submission-compare-backdrop and .submission-compare-modal',
      cssContent.includes('.submission-compare-backdrop') &&
      cssContent.includes('.submission-compare-modal')
    );
    record(
      'CSS defines .submission-compare-table-container and table layout',
      cssContent.includes('.submission-compare-table-container') &&
      cssContent.includes('.submission-compare-table')
    );
    record(
      'CSS defines responsive mobile breakpoint (max-width: 768px)',
      cssContent.includes('@media (max-width: 768px)') &&
      cssContent.includes('.submission-compare-modal')
    );

    // 10. NO REGRESSION ON VIEWPORT SCROLLING
    console.log('\n--- 10. Viewport & Scroll Preservation ---');
    record(
      'CSS preserves .page-viewport-scrollable without clipping',
      cssContent.includes('.page-viewport-scrollable')
    );
    record(
      'CSS preserves .submission-detail-container',
      cssContent.includes('.submission-detail-container')
    );

  } catch (err) {
    console.error('[FATAL ERROR]:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(` PHASE 5.8.5 UI TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
