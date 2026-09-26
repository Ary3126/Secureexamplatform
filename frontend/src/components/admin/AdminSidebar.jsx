import React from 'react';
import {
  ShieldAlert,
  LayoutDashboard,
  Users,
  BookOpen,
  Trophy,
  Inbox,
  Server,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ArrowUpRight,
} from 'lucide-react';
import { ADMIN_NAV_ITEMS } from '../../config/adminNavConfig';

const ICON_MAP = {
  LayoutDashboard,
  Users,
  BookOpen,
  Trophy,
  Inbox,
  Server,
};

export default function AdminSidebar({
  activeSection = 'dashboard',
  onSelectSection = () => {},
  collapsed = false,
  onToggleCollapse = () => {},
  currentUser = null,
  onLogout = () => {},
  onExitToPlatform = () => {},
  isMobileOpen = false,
  onCloseMobile = () => {},
}) {
  const handleItemClick = (item) => {
    onSelectSection(item.id, item.path);
    if (isMobileOpen) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="admin-mobile-backdrop"
          onClick={onCloseMobile}
          role="button"
          tabIndex={0}
          aria-label="Close Navigation"
          onKeyDown={(e) => e.key === 'Escape' && onCloseMobile()}
        />
      )}

      <aside className={`admin-sidebar ${collapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
        {/* Brand Header */}
        <div className="admin-sidebar-brand">
          <div className="admin-brand-left">
            <div className="admin-brand-icon-wrap">
              <ShieldAlert size={18} />
            </div>
            {!collapsed && (
              <div className="admin-brand-text">
                <span className="admin-brand-title">CodeForge</span>
                <span className="admin-brand-subtitle">Platform Governor</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="admin-collapse-toggle"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
            aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="admin-sidebar-nav" aria-label="Admin Navigation">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = ICON_MAP[item.iconName] || LayoutDashboard;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`admin-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => handleItemClick(item)}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="admin-nav-icon">
                  <Icon size={18} />
                </div>
                {!collapsed && <span className="admin-nav-label">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Footer: Identity & Quick Actions */}
        <div className="admin-sidebar-footer">
          {currentUser && (
            <div className="admin-user-profile-badge" title={`${currentUser.username} (${currentUser.role})`}>
              <div className="admin-avatar-circle">
                {(currentUser.username || 'A').slice(0, 2).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="admin-user-info">
                  <span className="admin-username">{currentUser.username}</span>
                  <span className="admin-role-tag">{currentUser.role}</span>
                </div>
              )}
            </div>
          )}

          <div className="admin-sidebar-actions">
            <button
              type="button"
              className="admin-footer-btn"
              onClick={onExitToPlatform}
              title="Return to Student & Exam Platform"
            >
              <ArrowUpRight size={15} />
              {!collapsed && <span>Student Platform</span>}
            </button>

            <button
              type="button"
              className="admin-footer-btn logout"
              onClick={onLogout}
              title="Log out from Super Admin"
            >
              <LogOut size={15} />
              {!collapsed && <span>Log Out</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
