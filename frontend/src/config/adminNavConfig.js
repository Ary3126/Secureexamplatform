/**
 * Admin Navigation Configuration (Phase 1 Foundation & Shell)
 * Defines items, icons, paths, and metadata for the Platform Governor Console.
 */

export const ADMIN_NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    iconName: 'LayoutDashboard',
    path: '/admin',
  },
  {
    id: 'users',
    label: 'Users',
    iconName: 'Users',
    path: '/admin/users',
  },
  {
    id: 'problems',
    label: 'Problem Bank',
    iconName: 'BookOpen',
    path: '/admin/problems',
  },
  {
    id: 'contests',
    label: 'Contests',
    iconName: 'Trophy',
    path: '/admin/contests',
  },
  {
    id: 'reviews',
    label: 'Reviews',
    iconName: 'Inbox',
    path: '/admin/reviews',
  },
  {
    id: 'system',
    label: 'System',
    iconName: 'Server',
    path: '/admin/system',
  },
];

export const ADMIN_SECTION_LABELS = {
  dashboard: 'Platform Dashboard',
  users: 'Users & Roles',
  problems: 'Problem Bank Governance',
  contests: 'Contests & Exams',
  reviews: 'Problem Reviews & SLAs',
  system: 'System & Observability',
};

export const parseAdminSection = (pathname) => {
  const path = (pathname || '').toLowerCase();
  if (path === '/admin/users' || path.startsWith('/admin/users/')) return 'users';
  if (path === '/admin/problems' || path.startsWith('/admin/problems/')) return 'problems';
  if (path === '/admin/contests' || path.startsWith('/admin/contests/')) return 'contests';
  if (path === '/admin/reviews' || path.startsWith('/admin/reviews/')) return 'reviews';
  if (path === '/admin/system' || path.startsWith('/admin/system/')) return 'system';
  return 'dashboard';
};
