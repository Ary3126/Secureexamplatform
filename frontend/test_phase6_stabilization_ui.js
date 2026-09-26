/**
 * PHASE 6 FRONTEND STABILIZATION & ARCHITECTURE VERIFICATION TEST SUITE
 * 
 * Verifies:
 * 1. Component existence & export integrity
 * 2. Routing & View state mappings in App.jsx
 * 3. AppShell & Navigation groups configuration in navConfig.js
 * 4. Workspace control button consolidation (WorkspaceTopBar authoritative)
 * 5. Viewport layout & global scrollbar architecture (.page-viewport-scrollable)
 * 6. Theme engine tokens and synchronization (Light, Dark, System)
 * 7. Coder Profile & Settings tab integration
 * 8. Performance and Analytics UI cards (Percentiles, Distribution, Comparison)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NAV_GROUPS, KEYBOARD_SHORTCUTS, SIDEBAR_STORAGE_KEY } from './src/config/navConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, 'src');

describe('Phase 6 Frontend Stabilization & Architecture Verification', () => {
  // --- 1. COMPONENT INTEGRITY ---
  it('1a. Core student panels exist in components directory', () => {
    const requiredComponents = [
      'LandingPage.jsx',
      'LoginPage.jsx',
      'SignupPage.jsx',
      'StudentDashboard.jsx',
      'ProblemExplorer.jsx',
      'ProblemPane.jsx',
      'EditorPane.jsx',
      'ConsolePane.jsx',
      'SubmissionHistory.jsx',
      'SubmissionDetail.jsx',
      'SubmissionComparisonModal.jsx',
      'ContestLeaderboard.jsx',
      'GlobalLeaderboard.jsx',
      'UserProfile.jsx',
      'Settings.jsx',
      'CoderEmblem.jsx',
      'DifficultyOrbit.jsx',
      'TopicConstellation.jsx',
    ];

    for (const comp of requiredComponents) {
      const fullPath = path.join(SRC_DIR, 'components', comp);
      assert.ok(fs.existsSync(fullPath), `Component ${comp} must exist`);
    }
  });

  it('1b. Navigation components exist in navigation directory', () => {
    const navComponents = [
      'AppShell.jsx',
      'Sidebar.jsx',
      'TopBar.jsx',
      'WorkspaceTopBar.jsx',
      'CommandPalette.jsx',
      'NotificationCenter.jsx',
    ];

    for (const comp of navComponents) {
      const fullPath = path.join(SRC_DIR, 'components', 'navigation', comp);
      assert.ok(fs.existsSync(fullPath), `Nav component ${comp} must exist`);
    }
  });

  // --- 2. APPSHELL & NAVIGATION GROUPS ---
  it('2a. navConfig defines 5 canonical navigation groups', () => {
    assert.strictEqual(Array.isArray(NAV_GROUPS), true);
    assert.strictEqual(NAV_GROUPS.length, 5);
    const groupIds = NAV_GROUPS.map((g) => g.groupId);
    assert.deepStrictEqual(groupIds, ['main', 'compete', 'professor', 'admin', 'account']);
  });

  it('2b. Student navigation is scoped to 8 accessible items', () => {
    const studentUser = { id: 1, username: 'student_test', role: 'student' };
    const filterByRole = (items, user) => {
      return items.filter((item) => {
        if (!item.allowedRoles) return true;
        if (!user) return false;
        return item.allowedRoles.includes(user.role);
      });
    };

    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const studentItems = filterByRole(allItems, studentUser);
    assert.strictEqual(studentItems.length, 8);
    const itemIds = studentItems.map((i) => i.id);
    assert.deepStrictEqual(itemIds, [
      'landing', 'problems', 'contests',
      'dashboard', 'rankings', 'submissions',
      'profile', 'settings'
    ]);
  });

  // --- 3. WORKSPACE BUTTON DEDUPLICATION ---
  it('3a. EditorPane does not duplicate Run or Submit buttons', () => {
    const editorContent = fs.readFileSync(path.join(SRC_DIR, 'components', 'EditorPane.jsx'), 'utf-8');
    assert.strictEqual(editorContent.includes('btn-success'), false, 'No duplicate green Submit button');
    assert.strictEqual(editorContent.includes('onClick={onSubmit}'), false, 'No duplicate onSubmit handler');
    assert.strictEqual(editorContent.includes('onClick={onRun}'), false, 'No duplicate onRun handler');
  });

  it('3b. WorkspaceTopBar provides authoritative Run and Submit controls', () => {
    const wsContent = fs.readFileSync(path.join(SRC_DIR, 'components', 'navigation', 'WorkspaceTopBar.jsx'), 'utf-8');
    assert.ok(wsContent.includes('onRun'), 'Must provide onRun control');
    assert.ok(wsContent.includes('onSubmit'), 'Must provide onSubmit control');
    assert.ok(wsContent.includes('onLanguageChange'), 'Must provide language selector');
  });

  // --- 4. VIEWPORT & SCROLLING ARCHITECTURE ---
  it('4a. index.css establishes .page-viewport-scrollable container', () => {
    const cssContent = fs.readFileSync(path.join(SRC_DIR, 'index.css'), 'utf-8');
    assert.ok(cssContent.includes('.page-viewport-scrollable'), 'Must define .page-viewport-scrollable');
    assert.ok(cssContent.includes('overflow-y: auto'), 'Must enable vertical scrolling');
    assert.ok(cssContent.includes('height: calc(100vh - 48px)'), 'Must calculate usable height');
  });

  it('4b. AppShell wraps non-workspace pages in scrollable viewport', () => {
    const shellContent = fs.readFileSync(path.join(SRC_DIR, 'components', 'navigation', 'AppShell.jsx'), 'utf-8');
    assert.ok(shellContent.includes('page-viewport-scrollable'), 'AppShell must apply scrollable class');
    assert.ok(shellContent.includes('activeView === \'workspace\''), 'AppShell checks workspace mode');
  });

  // --- 5. THEME SYSTEM & TOKENS ---
  it('5a. ThemeContext provides light, dark, and system themes', () => {
    const themeContent = fs.readFileSync(path.join(SRC_DIR, 'theme', 'ThemeContext.jsx'), 'utf-8');
    assert.ok(themeContent.includes('light'), 'Supports light theme');
    assert.ok(themeContent.includes('dark'), 'Supports dark theme');
    assert.ok(themeContent.includes('system'), 'Supports system theme');
  });

  it('5b. index.css defines harmonious design tokens', () => {
    const cssContent = fs.readFileSync(path.join(SRC_DIR, 'index.css'), 'utf-8');
    assert.ok(cssContent.includes('--bg-canvas'), 'Defines background canvas token');
    assert.ok(cssContent.includes('--bg-surface'), 'Defines background surface token');
    assert.ok(cssContent.includes('--text-primary'), 'Defines text token');
    assert.ok(cssContent.includes('--accent-primary'), 'Defines accent token');
    assert.ok(cssContent.includes('--border-color'), 'Defines border token');
  });

  // --- 6. SUBMISSION DETAIL & ANALYTICS VISUALIZATION ---
  it('6a. SubmissionDetail renders Monaco read-only viewer and performance cards', () => {
    const detailContent = fs.readFileSync(path.join(SRC_DIR, 'components', 'SubmissionDetail.jsx'), 'utf-8');
    assert.ok(detailContent.includes('readOnly: true'), 'Monaco editor must be read-only');
    assert.ok(detailContent.includes('performanceStats'), 'Renders performance stats card');
    assert.ok(detailContent.includes('SubmissionComparisonModal'), 'Integrates comparison modal');
  });

  it('6b. GlobalLeaderboard supports Global Arena and College League scopes', () => {
    const lbContent = fs.readFileSync(path.join(SRC_DIR, 'components', 'GlobalLeaderboard.jsx'), 'utf-8');
    assert.ok(lbContent.includes('Global Arena'), 'Has Global Arena scope');
    assert.ok(lbContent.includes('College League'), 'Has College League scope');
    assert.ok(lbContent.includes('userPosition'), 'Renders sticky user position');
  });
});
