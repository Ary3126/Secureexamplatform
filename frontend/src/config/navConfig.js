export const NAV_GROUPS = [
  {
    groupId: 'main',
    groupLabel: 'MAIN',
    items: [
      {
        id: 'landing',
        label: 'Home',
        iconName: 'Home',
        view: 'landing',
        allowedRoles: null,
      },
      {
        id: 'problems',
        label: 'Problems',
        iconName: 'Code2',
        view: 'problems',
        allowedRoles: null,
      },
    ],
  },
  {
    groupId: 'compete',
    groupLabel: 'COMPETE',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        iconName: 'LayoutDashboard',
        view: 'dashboard',
        allowedRoles: null,
      },
      {
        id: 'rankings',
        label: 'Leaderboard',
        iconName: 'BarChart3',
        view: 'rankings',
        allowedRoles: null,
      },
      {
        id: 'submissions',
        label: 'Submissions',
        iconName: 'History',
        view: 'submissions',
        allowedRoles: null,
      },
    ],
  },
  {
    groupId: 'admin',
    groupLabel: 'GOVERNANCE',
    items: [
      {
        id: 'admin_panel',
        label: 'Admin Console',
        iconName: 'ShieldAlert',
        view: 'admin',
        allowedRoles: ['super_admin'],
      },
      {
        id: 'admin_observability',
        label: 'Observability',
        iconName: 'Activity',
        view: 'admin',
        initialTab: 'system',
        allowedRoles: ['super_admin'],
      },
    ],
  },
  {
    groupId: 'account',
    groupLabel: 'ACCOUNT',
    items: [
      {
        id: 'profile',
        label: 'Profile',
        iconName: 'User',
        view: 'profile',
        allowedRoles: null,
      },
      {
        id: 'settings',
        label: 'Settings',
        iconName: 'Settings',
        view: 'profile',
        initialTab: 'settings',
        allowedRoles: null,
      },
    ],
  },
];

export const KEYBOARD_SHORTCUTS = {
  commandPalette: ['Control+k', 'Meta+k'],
  sidebarToggle: ['Control+b', 'Meta+b'],
  closeModal: 'Escape',
  submitCode: 'Control+Enter',
};

export const SIDEBAR_STORAGE_KEY = 'securejudge_sidebar_collapsed';
