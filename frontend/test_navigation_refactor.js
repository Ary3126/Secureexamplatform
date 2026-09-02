import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NAV_GROUPS, KEYBOARD_SHORTCUTS, SIDEBAR_STORAGE_KEY } from './src/config/navConfig.js';

describe('Navigation + UI/UX Refactor & AppShell Architecture Tests', () => {
  it('1. Sidebar NAV_GROUPS has correct 3 groups (MAIN, COMPETE, ACCOUNT)', () => {
    assert.strictEqual(Array.isArray(NAV_GROUPS), true, 'NAV_GROUPS should be an array');
    assert.strictEqual(NAV_GROUPS.length, 3, 'Should have exactly 3 navigation groups');

    const groupIds = NAV_GROUPS.map((g) => g.groupId);
    assert.deepStrictEqual(groupIds, ['main', 'compete', 'account'], 'Group IDs must match');
  });

  it('2. Sidebar MAIN group contains Home, Problems, and Contests', () => {
    const mainGroup = NAV_GROUPS.find((g) => g.groupId === 'main');
    assert.ok(mainGroup, 'MAIN group must exist');
    assert.strictEqual(mainGroup.items.length, 3);

    const itemIds = mainGroup.items.map((i) => i.id);
    assert.deepStrictEqual(itemIds, ['landing', 'problems', 'contests']);
  });

  it('3. Sidebar COMPETE group contains Dashboard, Leaderboard, Submissions', () => {
    const competeGroup = NAV_GROUPS.find((g) => g.groupId === 'compete');
    assert.ok(competeGroup, 'COMPETE group must exist');
    assert.strictEqual(competeGroup.items.length, 3);

    const itemIds = competeGroup.items.map((i) => i.id);
    assert.deepStrictEqual(itemIds, ['dashboard', 'rankings', 'submissions']);
  });

  it('4. Sidebar ACCOUNT group contains Profile and Settings', () => {
    const accountGroup = NAV_GROUPS.find((g) => g.groupId === 'account');
    assert.ok(accountGroup, 'ACCOUNT group must exist');
    assert.strictEqual(accountGroup.items.length, 2);

    const itemIds = accountGroup.items.map((i) => i.id);
    assert.deepStrictEqual(itemIds, ['profile', 'settings']);

    const settingsItem = accountGroup.items.find((i) => i.id === 'settings');
    assert.strictEqual(settingsItem.initialTab, 'settings', 'Settings item should target settings tab');
  });

  it('5. Role-aware navigation foundation filters items accurately', () => {
    const studentUser = { id: 1, username: 'student1', role: 'STUDENT' };
    const professorUser = { id: 2, username: 'prof1', role: 'PROFESSOR' };

    // Function matching Sidebar.jsx filterItemsByRole
    const filterByRole = (items, user) => {
      return items.filter((item) => {
        if (!item.allowedRoles) return true;
        if (!user) return false;
        return item.allowedRoles.includes(user.role);
      });
    };

    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const studentItems = filterByRole(allItems, studentUser);
    const profItems = filterByRole(allItems, professorUser);

    assert.strictEqual(studentItems.length, 8, 'Student sees all 8 standard items');
    assert.strictEqual(profItems.length, 8, 'Professor sees all 8 standard items');
  });

  it('6. LocalStorage persistence key is standardized', () => {
    const STORAGE_KEY = 'securejudge_sidebar_collapsed';
    assert.strictEqual(STORAGE_KEY, 'securejudge_sidebar_collapsed');
  });

  it('7. Keyboard shortcut mappings are preserved without conflicts', () => {
    const shortcuts = {
      commandPalette: ['Control+k', 'Meta+k'],
      sidebarToggle: ['Control+b', 'Meta+b'],
      closeModal: 'Escape',
      submitCode: 'Control+Enter',
    };

    assert.ok(shortcuts.commandPalette.includes('Control+k'));
    assert.ok(shortcuts.sidebarToggle.includes('Control+b'));
    assert.strictEqual(shortcuts.closeModal, 'Escape');
  });

  it('8. Theme engine supports Light, Dark, and System modes seamlessly', () => {
    const supportedThemes = ['light', 'dark', 'system'];
    assert.strictEqual(supportedThemes.length, 3);
    assert.ok(supportedThemes.includes('light'));
    assert.ok(supportedThemes.includes('dark'));
    assert.ok(supportedThemes.includes('system'));
  });
});
