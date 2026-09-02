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
      {
        id: 'contests',
        label: 'Contests & Exams',
        iconName: 'Trophy',
        view: 'dashboard',
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
    groupId: 'professor',
    groupLabel: 'FACULTY & AUTHORING',
    items: [
      {
        id: 'prof_studio',
        label: 'Professor Studio',
        iconName: 'BookOpen',
        view: 'studio',
        initialTab: 'dashboard',
        allowedRoles: ['professor', 'contest_admin', 'super_admin'],
      },
      {
        id: 'prof_create_contest',
        label: '+ Add Contest',
        iconName: 'PlusCircle',
        view: 'studio',
        initialTab: 'create_contest',
        allowedRoles: ['professor', 'contest_admin', 'super_admin'],
      },
      {
        id: 'prof_manage_contests',
        label: 'Manage Contests',
        iconName: 'Trophy',
        view: 'studio',
        initialTab: 'contests',
        allowedRoles: ['professor', 'contest_admin', 'super_admin'],
      },
      {
        id: 'prof_manage_problems',
        label: 'My Problems',
        iconName: 'Code2',
        view: 'studio',
        initialTab: 'problems',
        allowedRoles: ['professor', 'contest_admin', 'super_admin'],
      },
      {
        id: 'prof_reviews',
        label: 'Review Queue',
        iconName: 'Inbox',
        view: 'studio',
        initialTab: 'reviews',
        allowedRoles: ['professor', 'contest_admin', 'super_admin'],
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
        allowedRoles: ['super_admin', 'contest_admin'],
      },
      {
        id: 'admin_observability',
        label: 'Observability',
        iconName: 'Activity',
        view: 'admin',
        initialTab: 'observability',
        allowedRoles: ['super_admin', 'contest_admin'],
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
