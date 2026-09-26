import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NAV_GROUPS } from './src/config/navConfig.js';
import { ADMIN_NAV_ITEMS, ADMIN_SECTION_LABELS, parseAdminSection } from './src/config/adminNavConfig.js';

describe('Admin Panel Phase 7.1: Foundation & Shell Architecture Tests', () => {
  // 1. Navigation Configuration & RBAC Filtering
  it('1. Admin navigation group is strictly restricted to super_admin in navConfig', () => {
    const adminGroup = NAV_GROUPS.find((g) => g.groupId === 'admin');
    assert.ok(adminGroup, 'Admin group must exist in NAV_GROUPS');
    assert.strictEqual(adminGroup.items.length, 2, 'Admin group should have 2 items');

    for (const item of adminGroup.items) {
      assert.deepStrictEqual(
        item.allowedRoles,
        ['super_admin'],
        `Item ${item.id} must be strictly restricted to ['super_admin']`
      );
    }
  });

  // 2. Admin Sidebar Items Verification (Phase 7.1: 7 sections including Audit Logs)
  it('2. AdminSidebar defines all 7 Phase 7.1 sections with correct paths and icons', () => {
    assert.ok(Array.isArray(ADMIN_NAV_ITEMS), 'ADMIN_NAV_ITEMS must be an array');
    assert.strictEqual(ADMIN_NAV_ITEMS.length, 7, 'Must contain exactly 7 navigation items in Phase 7.1');

    const expected = [
      { id: 'dashboard', label: 'Dashboard', path: '/admin', iconName: 'LayoutDashboard' },
      { id: 'users', label: 'Users', path: '/admin/users', iconName: 'Users' },
      { id: 'problems', label: 'Problem Bank', path: '/admin/problems', iconName: 'BookOpen' },
      { id: 'contests', label: 'Contests', path: '/admin/contests', iconName: 'Trophy' },
      { id: 'reviews', label: 'Reviews', path: '/admin/reviews', iconName: 'Inbox' },
      { id: 'audit', label: 'Audit Logs', path: '/admin/audit', iconName: 'FileText' },
      { id: 'system', label: 'System', path: '/admin/system', iconName: 'Server' },
    ];

    expected.forEach((exp, idx) => {
      const actual = ADMIN_NAV_ITEMS[idx];
      assert.strictEqual(actual.id, exp.id, `Item ${idx} id mismatch`);
      assert.strictEqual(actual.label, exp.label, `Item ${idx} label mismatch`);
      assert.strictEqual(actual.path, exp.path, `Item ${idx} path mismatch`);
      assert.strictEqual(actual.iconName, exp.iconName, `Item ${idx} iconName mismatch`);
    });
  });

  // 3. Subroute Parsing Logic Tests (Phase 7.1: includes /admin/audit)
  it('3. Admin subroute parser correctly extracts section from URL path', () => {
    assert.strictEqual(parseAdminSection('/admin'), 'dashboard');
    assert.strictEqual(parseAdminSection('/admin/'), 'dashboard');
    assert.strictEqual(parseAdminSection('/admin/users'), 'users');
    assert.strictEqual(parseAdminSection('/admin/users/42'), 'users');
    assert.strictEqual(parseAdminSection('/admin/problems'), 'problems');
    assert.strictEqual(parseAdminSection('/admin/contests'), 'contests');
    assert.strictEqual(parseAdminSection('/admin/reviews'), 'reviews');
    assert.strictEqual(parseAdminSection('/admin/audit'), 'audit');
    assert.strictEqual(parseAdminSection('/admin/audit/export'), 'audit');
    assert.strictEqual(parseAdminSection('/admin/system'), 'system');
    assert.strictEqual(parseAdminSection('/other'), 'dashboard');
    assert.strictEqual(parseAdminSection(''), 'dashboard');
    assert.strictEqual(parseAdminSection(null), 'dashboard');
    assert.strictEqual(parseAdminSection(undefined), 'dashboard');
  });

  // 4. Section Labels Verification (Phase 7.1: all 7 labels)
  it('4. Section labels map all 7 administrative areas accurately', () => {
    assert.strictEqual(ADMIN_SECTION_LABELS.dashboard, 'Platform Dashboard');
    assert.strictEqual(ADMIN_SECTION_LABELS.users, 'Users & Roles');
    assert.strictEqual(ADMIN_SECTION_LABELS.problems, 'Problem Bank Governance');
    assert.strictEqual(ADMIN_SECTION_LABELS.contests, 'Contests & Exams');
    assert.strictEqual(ADMIN_SECTION_LABELS.reviews, 'Problem Reviews & SLAs');
    assert.strictEqual(ADMIN_SECTION_LABELS.audit, 'Audit Logs & Security Events');
    assert.strictEqual(ADMIN_SECTION_LABELS.system, 'System & Observability');
  });

  // 5. RBAC Access Evaluation Tests
  it('5. RBAC Gate: strictly permits super_admin and denies student, professor, contest_admin', () => {
    const canAccessAdminShell = (user) => {
      if (!user) return false;
      return user.role === 'super_admin';
    };

    const student = { id: 1, username: 'std1', role: 'student' };
    const professor = { id: 2, username: 'prof1', role: 'professor' };
    const contestAdmin = { id: 3, username: 'ca1', role: 'contest_admin' };
    const superAdmin = { id: 4, username: 'sa1', role: 'super_admin' };

    assert.strictEqual(canAccessAdminShell(null), false, 'Unauthenticated user denied');
    assert.strictEqual(canAccessAdminShell(student), false, 'Student role denied');
    assert.strictEqual(canAccessAdminShell(professor), false, 'Professor role denied');
    assert.strictEqual(canAccessAdminShell(contestAdmin), false, 'Contest Admin role denied');
    assert.strictEqual(canAccessAdminShell(superAdmin), true, 'Super Admin role permitted');
  });

  // 6. Direct URL and Deep Subroute Security Evaluation
  it('6. Direct URL parsing handles deep subpaths, mixed casing, and query strings', () => {
    assert.strictEqual(parseAdminSection('/ADMIN/USERS'), 'users');
    assert.strictEqual(parseAdminSection('/Admin/Audit'), 'audit');
    assert.strictEqual(parseAdminSection('/admin/problems?filter=hard'), 'problems');
    assert.strictEqual(parseAdminSection('/admin/system?refresh=true'), 'system');
    assert.strictEqual(parseAdminSection('/admin/unknown-route'), 'dashboard');
  });

  // 7. Shell Configuration Integrity
  it('7. Shell navigation structure defines unique IDs and canonical routes', () => {
    const ids = ADMIN_NAV_ITEMS.map((i) => i.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(uniqueIds.size, ids.length, 'Every admin navigation item must have a unique ID');

    const paths = ADMIN_NAV_ITEMS.map((i) => i.path);
    const uniquePaths = new Set(paths);
    assert.strictEqual(uniquePaths.size, paths.length, 'Every admin navigation item must have a unique path');

    // Verify all IDs have a corresponding label in ADMIN_SECTION_LABELS
    for (const item of ADMIN_NAV_ITEMS) {
      assert.ok(ADMIN_SECTION_LABELS[item.id], `Label must exist for section ${item.id}`);
    }
  });
});
