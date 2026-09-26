/**
 * Admin Navigation Configuration (Phase 7.1 — Admin Architecture & Layout)
 * Defines items, icons, paths, and metadata for the Platform Governor Console.
 *
 * Phase 7.1 change: Added 'audit' as the 7th navigation section.
 * Audit Logs section wires the existing AdminAuditLogs.jsx component.
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
    id: 'audit',
    label: 'Audit Logs',
    iconName: 'FileText',
    path: '/admin/audit',
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
  audit: 'Audit Logs & Security Events',
  system: 'System & Observability',
};

export const parseAdminSection = (pathname) => {
  const cleanPath = (pathname || '').split('?')[0].split('#')[0].toLowerCase().trim();
  if (cleanPath === '/admin/users' || cleanPath.startsWith('/admin/users/')) return 'users';
  if (cleanPath === '/admin/problems' || cleanPath.startsWith('/admin/problems/')) return 'problems';
  if (cleanPath === '/admin/contests' || cleanPath.startsWith('/admin/contests/')) return 'contests';
  if (cleanPath === '/admin/reviews' || cleanPath.startsWith('/admin/reviews/')) return 'reviews';
  if (cleanPath === '/admin/audit' || cleanPath.startsWith('/admin/audit/')) return 'audit';
  if (cleanPath === '/admin/system' || cleanPath.startsWith('/admin/system/')) return 'system';
  return 'dashboard';
};

/**
 * Parse Admin Problem Subroutes (Phase 7.4.1)
 * Extracts subview ('list' | 'create' | 'edit') and problemId from /admin/problems/*
 */
export const parseAdminProblemSubroute = (pathname) => {
  const cleanPath = (pathname || '').split('?')[0].split('#')[0].toLowerCase().trim();
  if (cleanPath === '/admin/problems/new') {
    return { subview: 'create', problemId: null };
  }
  const editMatch = cleanPath.match(/^\/admin\/problems\/([^/]+)\/edit\/?$/);
  if (editMatch && editMatch[1] !== 'new') {
    const rawId = editMatch[1];
    const parsed = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
    return { subview: 'edit', problemId: parsed };
  }
  return { subview: 'list', problemId: null };
};

/**
 * Build Admin Problem URL path (Phase 7.4.1)
 */
export const buildAdminProblemPath = (subview = 'list', problemId = null) => {
  if (subview === 'create') return '/admin/problems/new';
  if (subview === 'edit' && problemId) return `/admin/problems/${problemId}/edit`;
  return '/admin/problems';
};

