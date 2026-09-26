import React from 'react';
import {
  ShieldCheck,
  Home,
  Code2,
  Trophy,
  LayoutDashboard,
  BarChart3,
  History,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Terminal,
  BookOpen,
  PlusCircle,
  Inbox,
  ShieldAlert,
  Activity,
} from 'lucide-react';
import { NAV_GROUPS } from '../../config/navConfig';

const ICON_MAP = {
  Home,
  Code2,
  Trophy,
  LayoutDashboard,
  BarChart3,
  History,
  User,
  Settings,
  BookOpen,
  PlusCircle,
  Inbox,
  ShieldAlert,
  Activity,
};

export default function Sidebar({
  collapsed = false,
  onToggleCollapse = () => {},
  activeView = 'landing',
  activeProfileTab = 'matrix',
  currentUser = null,
  onSelectView = () => {},
  isMobileDrawerOpen = false,
  onCloseMobileDrawer = () => {},
}) {
  const handleItemClick = (item) => {
    if (item.initialTab) {
      onSelectView(item.view, true, null, null, item.initialTab);
    } else {
      onSelectView(item.view, true);
    }
    if (isMobileDrawerOpen) {
      onCloseMobileDrawer();
    }
  };

  const isItemActive = (item) => {
    if (item.id === 'settings') {
      return activeView === 'profile' && activeProfileTab === 'settings';
    }
    if (item.id === 'profile') {
      return activeView === 'profile' && activeProfileTab !== 'settings';
    }
    if (item.id === 'contests') {
      return activeView === 'leaderboard';
    }
    if (item.id === 'dashboard') {
      return activeView === 'dashboard';
    }
    if (item.id === 'submissions') {
      return activeView === 'submissions' || activeView === 'submission_detail';
    }
    if (item.id === 'problems') {
      return activeView === 'problems';
    }
    if (item.id === 'rankings') {
      return activeView === 'rankings';
    }
    if (item.id === 'landing') {
      return activeView === 'landing';
    }
    if (item.id === 'prof_studio') {
      return activeView === 'studio' && (!activeProfileTab || activeProfileTab === 'dashboard');
    }
    if (item.id === 'prof_create_contest') {
      return activeView === 'studio' && activeProfileTab === 'create_contest';
    }
    if (item.id === 'prof_manage_contests') {
      return activeView === 'studio' && activeProfileTab === 'contests';
    }
    if (item.id === 'prof_manage_problems') {
      return activeView === 'studio' && activeProfileTab === 'problems';
    }
    if (item.id === 'prof_reviews') {
      return activeView === 'studio' && activeProfileTab === 'reviews';
    }
    if (item.id === 'admin_observability') {
      return activeView === 'admin' && activeProfileTab === 'observability';
    }
    if (item.id === 'admin_panel') {
      return activeView === 'admin' && activeProfileTab !== 'observability';
    }
    return activeView === item.view;
  };

  const filterItemsByRole = (items) => {
    return items.filter((item) => {
      if (!item.allowedRoles) return true;
      if (!currentUser) return false;
      return item.allowedRoles.includes(currentUser.role);
    });
  };

  return (
    <aside
      className={`app-sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-expanded'} ${
        isMobileDrawerOpen ? 'mobile-drawer-open' : ''
      }`}
      aria-label="Main Navigation"
    >
      {/* Sidebar Top Brand Header */}
      <div className="sidebar-brand-header">
        <div
          className="sidebar-brand"
          onClick={() => onSelectView('landing')}
          role="button"
          tabIndex={0}
          title="CodeForge - Return to Home"
          onKeyDown={(e) => e.key === 'Enter' && onSelectView('landing')}
        >
          <div className="brand-logo-icon">
            <ShieldCheck className="w-6 h-6 text-blue-500" />
          </div>
          {!collapsed && (
            <div className="brand-text-col">
              <span className="brand-name">CodeForge</span>
              <span className="brand-subtext">Competitive Coding</span>
            </div>
          )}
        </div>

        {/* Sidebar Collapse Toggle Button (Desktop & Tablet) */}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
          aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links Groups */}
      <nav className="sidebar-nav-container">
        {NAV_GROUPS.map((group) => {
          const visibleItems = filterItemsByRole(group.items);
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.groupId} className="sidebar-nav-group">
              {!collapsed && (
                <div className="sidebar-group-header">
                  <span>{group.groupLabel}</span>
                </div>
              )}

              <ul className="sidebar-nav-list" role="list">
                {visibleItems.map((item) => {
                  const Icon = item.icon || ICON_MAP[item.iconName] || Home;
                  const active = isItemActive(item);

                  return (
                    <li key={item.id} className="sidebar-nav-item">
                      <button
                        type="button"
                        className={`sidebar-nav-link ${active ? 'active' : ''}`}
                        onClick={() => handleItemClick(item)}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                      >
                        <div className="nav-icon-wrap">
                          <Icon className="w-4 h-4" />
                        </div>
                        {!collapsed && <span className="nav-label-text">{item.label}</span>}
                        {collapsed && (
                          <div className="nav-item-tooltip" role="tooltip">
                            {item.label}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Practice Mode Quick Jump Callout */}
      <div className="sidebar-footer-promo">
        <button
          type="button"
          className={`sidebar-quick-workspace-btn ${activeView === 'workspace' ? 'active' : ''}`}
          onClick={() => onSelectView('workspace')}
          title="Open Coding Practice Workspace"
        >
          <Terminal className="w-4 h-4 text-emerald-400" />
          {!collapsed && (
            <div className="quick-workspace-text">
              <span className="workspace-btn-title">Practice IDE</span>
              <span className="workspace-btn-sub">Open Workspace</span>
            </div>
          )}
          {collapsed && (
            <div className="nav-item-tooltip" role="tooltip">
              Practice IDE
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
