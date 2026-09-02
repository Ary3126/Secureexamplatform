/**
 * Automated UI & Architecture Verification Suite: Master Correction + Hardening
 * Verifies:
 * 1. Exactly ONE Run and ONE Submit button in Workspace (Deduplication)
 * 2. Viewport scrolling CSS rules (.page-viewport-scrollable)
 * 3. Submission Detail container scroll accessibility
 * 4. Workspace TopBar contest status locking (Upcoming vs Running)
 * 5. Problem Explorer server-side pagination structure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (!condition) {
    console.error(`  ❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  passedAssertions++;
  console.log(`  ✅ ${message}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  STARTING MASTER CORRECTION FRONTEND UI VERIFICATION');
  console.log('===============================================================\n');

  try {
    // 1. Check EditorPane.jsx for deduplication
    console.log('--- 1. Verifying Workspace Button Deduplication ---');
    const editorPanePath = path.resolve(__dirname, 'src/components/EditorPane.jsx');
    const editorPaneCode = fs.readFileSync(editorPanePath, 'utf8');

    assert(!editorPaneCode.includes('btn-success'), 'EditorPane.jsx does NOT contain duplicate Submit button (btn-success)');
    assert(!editorPaneCode.includes('onRun'), 'EditorPane.jsx does NOT contain duplicate Run handler');
    assert(!editorPaneCode.includes('onSubmit'), 'EditorPane.jsx does NOT contain duplicate Submit handler');
    assert(editorPaneCode.includes('editor-toolbar'), 'EditorPane.jsx contains sleek editor status strip');
    assert(editorPaneCode.includes('function-mode-tag'), 'EditorPane.jsx displays coding mode tag');

    // 2. Check WorkspaceTopBar.jsx for authoritative action buttons
    console.log('\n--- 2. Verifying Authoritative Workspace Action Controls ---');
    const topBarPath = path.resolve(__dirname, 'src/components/navigation/WorkspaceTopBar.jsx');
    const topBarCode = fs.readFileSync(topBarPath, 'utf8');

    assert(topBarCode.includes('workspace-run-btn'), 'WorkspaceTopBar.jsx contains authoritative Run button');
    assert(topBarCode.includes('workspace-submit-btn'), 'WorkspaceTopBar.jsx contains authoritative Submit button');
    assert(topBarCode.includes('workspace-lang-select'), 'WorkspaceTopBar.jsx contains authoritative Language selector');
    assert(topBarCode.includes('isUpcomingContest'), 'WorkspaceTopBar.jsx handles upcoming contest locking');

    // 3. Check Viewport Scrolling in index.css
    console.log('\n--- 3. Verifying Viewport & Page Scrolling Rules ---');
    const cssPath = path.resolve(__dirname, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert(cssContent.includes('.page-viewport-scrollable'), 'index.css defines .page-viewport-scrollable');
    assert(cssContent.includes('overflow-y: auto'), 'index.css defines vertical scrolling for scrollable pages');
    assert(cssContent.includes('.submission-detail-container'), 'index.css defines .submission-detail-container');
    assert(cssContent.includes('.submission-perf-stats-card'), 'index.css preserves Phase 5.8.2 performance stats card');

    // 4. Check AppShell Viewport Routing
    console.log('\n--- 4. Verifying AppShell Context-Aware Viewport ---');
    const appShellPath = path.resolve(__dirname, 'src/components/navigation/AppShell.jsx');
    const appShellCode = fs.readFileSync(appShellPath, 'utf8');

    assert(appShellCode.includes('workspace-viewport-fixed'), 'AppShell sets fixed viewport for workspace');
    assert(appShellCode.includes('page-viewport-scrollable'), 'AppShell sets scrollable viewport for all other pages');

    // 5. Check Problem Explorer Pagination
    console.log('\n--- 5. Verifying Problem Explorer Server-Side Pagination ---');
    const explorerPath = path.resolve(__dirname, 'src/components/ProblemExplorer.jsx');
    const explorerCode = fs.readFileSync(explorerPath, 'utf8');

    assert(explorerCode.includes('/api/problems?'), 'Problem Explorer fetches problems via backend API');
    assert(explorerCode.includes('pagination'), 'Problem Explorer binds to backend server pagination');

    console.log('\n===============================================================');
    console.log(`  MASTER CORRECTION FRONTEND SUITE: ${passedAssertions}/${totalAssertions} ASSERTIONS PASSED`);
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ MASTER CORRECTION FRONTEND SUITE FAILED:', err);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runTests };
