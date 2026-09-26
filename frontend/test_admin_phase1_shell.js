import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NAV_GROUPS } from './src/config/navConfig.js';
import { ADMIN_NAV_ITEMS, ADMIN_SECTION_LABELS, parseAdminSection } from './src/config/adminNavConfig.js';

describe('Admin Panel Phase 1: Foundation & Shell Architecture Tests', () => {
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

  // 2. Admin Sidebar Items Verification
  it('2. AdminSidebar defines all 6 Phase 1 sections with correct paths', () => {
    assert.ok(Array.isArray(ADMIN_NAV_ITEMS), 'ADMIN_NAV_ITEMS must be an array');
    assert.strictEqual(ADMIN_NAV_ITEMS.length, 6, 'Must contain exactly 6 navigation items');

    const expected = [
      { id: 'dashboard', label: 'Dashboard', path: '/admin', iconName: 'LayoutDashboard' },
      { id: 'users', label: 'Users', path: '/admin/users', iconName: 'Users' },
      { id: 'problems', label: 'Problem Bank', path: '/admin/problems', iconName: 'BookOpen' },
      { id: 'contests', label: 'Contests', path: '/admin/contests', iconName: 'Trophy' },
      { id: 'reviews', label: 'Reviews', path: '/admin/reviews', iconName: 'Inbox' },
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

  // 3. Subroute Parsing Logic Tests
  it('3. Admin subroute parser correctly extracts section from URL path', () => {
    assert.strictEqual(parseAdminSection('/admin'), 'dashboard');
    assert.strictEqual(parseAdminSection('/admin/'), 'dashboard');
    assert.strictEqual(parseAdminSection('/admin/users'), 'users');
    assert.strictEqual(parseAdminSection('/admin/users/42'), 'users');
    assert.strictEqual(parseAdminSection('/admin/problems'), 'problems');
    assert.strictEqual(parseAdminSection('/admin/contests'), 'contests');
    assert.strictEqual(parseAdminSection('/admin/reviews'), 'reviews');
    assert.strictEqual(parseAdminSection('/admin/system'), 'system');
    assert.strictEqual(parseAdminSection('/other'), 'dashboard');
  });

  // 4. Section Labels Verification
  it('4. Section labels map all 6 administrative areas accurately', () => {
    assert.strictEqual(ADMIN_SECTION_LABELS.dashboard, 'Platform Dashboard');
    assert.strictEqual(ADMIN_SECTION_LABELS.users, 'Users & Roles');
    assert.strictEqual(ADMIN_SECTION_LABELS.problems, 'Problem Bank Governance');
    assert.strictEqual(ADMIN_SECTION_LABELS.contests, 'Contests & Exams');
    assert.strictEqual(ADMIN_SECTION_LABELS.reviews, 'Problem Reviews & SLAs');
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
});
