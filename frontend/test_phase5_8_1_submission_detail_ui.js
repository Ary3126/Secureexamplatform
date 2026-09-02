/**
 * Automated UI & Architecture Verification Test Suite for Phase 5.8.1
 * Submission Detail + Full Code Viewer
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 5.8.1 SUBMISSION DETAIL UI TESTS');
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
    // 1. COMPONENT EXISTENCE & CODE STRUCTURE
    // -------------------------------------------------------------------
    console.log('--- 1. Component Static Architecture & Security ---');

    const subDetailPath = path.join(__dirname, 'src', 'components', 'SubmissionDetail.jsx');
    record('SubmissionDetail.jsx component file exists', fs.existsSync(subDetailPath));

    const subDetailContent = fs.readFileSync(subDetailPath, 'utf8');

    record('Component imports and uses Monaco Editor in read-only mode', 
      subDetailContent.includes('@monaco-editor/react') &&
      subDetailContent.includes('readOnly: true') &&
      subDetailContent.includes('domReadOnly: true')
    );

    record('Component integrates useTheme for dynamic light/dark syntax theme',
      subDetailContent.includes('useTheme') &&
      subDetailContent.includes('resolvedTheme')
    );

    record('Component displays authoritative verdict badges with non-color-only text & icons',
      subDetailContent.includes('getVerdictDetails') &&
      subDetailContent.includes('Accepted') &&
      subDetailContent.includes('Wrong Answer') &&
      subDetailContent.includes('Time Limit Exceeded')
    );

    record('Component displays execution runtime, memory, score, test cases, and mode metrics',
      subDetailContent.includes('submission.score') &&
      subDetailContent.includes('submission.executionTime') &&
      subDetailContent.includes('submission.memoryUsed') &&
      subDetailContent.includes('submission.testCasesPassed') &&
      subDetailContent.includes('submission.codingMode')
    );

    record('Component renders multi-tier validation pipeline breakdown when available',
      subDetailContent.includes('validationSummary') &&
      subDetailContent.includes('stages')
    );

    record('Component renders sanitized compiler/runtime error console for failing submissions',
      subDetailContent.includes('errorMessage') &&
      subDetailContent.includes('error-console')
    );

    record('Component implements Copy Code clipboard action with confirmation feedback',
      subDetailContent.includes('handleCopyCode') &&
      subDetailContent.includes('navigator.clipboard') &&
      subDetailContent.includes('Copied!')
    );

    record('Component provides "Open in Workspace Editor" action',
      subDetailContent.includes('onOpenInEditor') &&
      subDetailContent.includes('Open in Workspace Editor')
    );

    record('Component provides "Back to Submissions" navigation button',
      subDetailContent.includes('onBack') &&
      subDetailContent.includes('Back to Submissions')
    );

    record('Component handles loading skeleton, 403 Forbidden, 404 Not Found, and missing code states',
      subDetailContent.includes('animate-pulse') &&
      subDetailContent.includes('Access Forbidden') &&
      subDetailContent.includes('Submission Not Found') &&
      subDetailContent.includes('Source code is unavailable')
    );

    // -------------------------------------------------------------------
    // 2. APP.JSX ROUTING & NAVIGATION INTEGRATION
    // -------------------------------------------------------------------
    console.log('\n--- 2. App.jsx Route & View Integration ---');

    const appPath = path.join(__dirname, 'src', 'App.jsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    record('App.jsx imports SubmissionDetail component',
      appContent.includes("import SubmissionDetail from './components/SubmissionDetail';")
    );

    record('App.jsx parses /submissions/:submissionId route on initial page load',
      appContent.includes('getInitialSubmissionId') &&
      appContent.includes("path.startsWith('/submissions/')")
    );

    record('App.jsx maintains selectedSubmissionId state',
      appContent.includes('selectedSubmissionId')
    );

    record('App.jsx synchronizes browser URL history to /submissions/:id',
      appContent.includes("view === 'submission_detail'") &&
      appContent.includes('/submissions/${targetSubmissionId || selectedSubmissionId}')
    );

    record('App.jsx renders <SubmissionDetail /> when activeView === submission_detail',
      appContent.includes("activeView === 'submission_detail'") &&
      appContent.includes('<SubmissionDetail')
    );

    // -------------------------------------------------------------------
    // 3. SUBMISSION HISTORY & ROW INTERACTION
    // -------------------------------------------------------------------
    console.log('\n--- 3. Submission History Row Action Integration ---');

    const historyPath = path.join(__dirname, 'src', 'components', 'SubmissionHistory.jsx');
    const historyContent = fs.readFileSync(historyPath, 'utf8');

    record('SubmissionHistory.jsx accepts onViewSubmissionDetail prop',
      historyContent.includes('onViewSubmissionDetail')
    );

    record('SubmissionHistory row action invokes onViewSubmissionDetail with submission ID',
      historyContent.includes('onViewSubmissionDetail(sub.id)')
    );

    // -------------------------------------------------------------------
    // 4. CSS DESIGN SYSTEM & RESPONSIVENESS
    // -------------------------------------------------------------------
    console.log('\n--- 4. CSS Design System & Theme Tokens ---');

    const cssPath = path.join(__dirname, 'src', 'index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    record('index.css contains .submission-detail-container layout class',
      cssContent.includes('.submission-detail-container')
    );

    record('index.css contains .verdict-hero-badge and status color variants',
      cssContent.includes('.verdict-hero-badge') &&
      cssContent.includes('.verdict-hero-accepted') &&
      cssContent.includes('.verdict-hero-wa') &&
      cssContent.includes('.verdict-hero-tle')
    );

    record('index.css contains .submission-metrics-grid and .metric-stat-card',
      cssContent.includes('.submission-metrics-grid') &&
      cssContent.includes('.metric-stat-card')
    );

    record('index.css contains .submission-validation-summary-card and stage chips',
      cssContent.includes('.submission-validation-summary-card') &&
      cssContent.includes('.validation-stage-chip')
    );

    record('index.css contains .submission-code-viewer-panel and header styling',
      cssContent.includes('.submission-code-viewer-panel') &&
      cssContent.includes('.code-viewer-panel-header')
    );

    record('index.css contains responsive mobile layout queries',
      cssContent.includes('.submission-detail-hero') &&
      cssContent.includes('@media (max-width: 768px)')
    );

  } catch (err) {
    console.error('Unexpected UI Test Error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(` PHASE 5.8.1 UI TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
