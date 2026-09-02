import React, { useState, useEffect, useRef } from 'react';
import {
  Menu,
  Search,
  ChevronRight,
  User,
  Settings,
  LogOut,
  LogIn,
  UserPlus,
  Sun,
  Moon,
  Monitor,
  Sidebar as SidebarIcon,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import CoderEmblem from '../CoderEmblem';
import NotificationCenter from './NotificationCenter';
import { useTheme } from '../../theme/ThemeContext';

export default function TopBar({
  activeView = 'landing',
  activeProfileTab = 'matrix',
  selectedProblem = null,
  contest = null,
  currentUser = null,
  profileTargetUser = null,
  onSelectView = () => {},
  onOpenLogin = () => {},
  onOpenSignup = () => {},
  onLogout = () => {},
  onToggleSidebar = () => {},
  onOpenCommandPalette = () => {},
  onOpenMobileDrawer = () => {},
  sidebarCollapsed = false,
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUserMenuOpen]);

  // Construct context-aware breadcrumbs
  const getBreadcrumbs = () => {
    const crumbs = [];

    if (activeView === 'landing') {
      crumbs.push({ label: 'Platform Home', view: 'landing' });
    } else if (activeView === 'problems') {
      crumbs.push({ label: 'Problem Explorer', view: 'problems' });
      if (selectedProblem) {
        crumbs.push({ label: selectedProblem.title || `Problem #${selectedProblem.id}`, active: true });
      }
    } else if (activeView === 'dashboard') {
      crumbs.push({ label: 'Student Arena', view: 'dashboard' });
      if (contest) {
        crumbs.push({ label: contest.title || `Contest #${contest.id}`, active: true });
      } else {
        crumbs.push({ label: 'Dashboard & Contests', active: true });
      }
    } else if (activeView === 'submissions') {
      crumbs.push({ label: 'Submissions', view: 'submissions' });
      crumbs.push({ label: 'Coding Analytics & History', active: true });
    } else if (activeView === 'rankings') {
      crumbs.push({ label: 'Leaderboard', view: 'rankings' });
      crumbs.push({ label: 'Global & College Arena', active: true });
    } else if (activeView === 'leaderboard') {
      crumbs.push({ label: 'Contests', view: 'dashboard' });
      crumbs.push({ label: contest?.title || 'Contest Standings', active: true });
    } else if (activeView === 'profile') {
      crumbs.push({ label: 'Coder Identity', view: 'profile' });
      if (activeProfileTab === 'settings') {
        crumbs.push({ label: 'Settings & Preferences', active: true });
      } else if (profileTargetUser) {
        crumbs.push({ label: `@${profileTargetUser}`, active: true });
      } else if (currentUser) {
        crumbs.push({ label: `@${currentUser.username}`, active: true });
      }
    } else if (activeView === 'studio') {
      crumbs.push({ label: 'Professor Studio', view: 'studio' });
      crumbs.push({ label: 'Academic & Contest Authoring', active: true });
    } else if (activeView === 'admin') {
      crumbs.push({ label: 'Platform Governor', view: 'admin' });
      crumbs.push({ label: 'Administration Console', active: true });
    } else if (activeView === 'login') {
      crumbs.push({ label: 'Account Access', view: 'landing' });
      crumbs.push({ label: 'Sign In', active: true });
    } else if (activeView === 'signup') {
      crumbs.push({ label: 'Account Access', view: 'landing' });
      crumbs.push({ label: 'Create Account', active: true });
    } else {
      crumbs.push({ label: 'SecureJudge', view: 'landing' });
    }

    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <header className="app-topbar-header" aria-label="Top Utility Navigation">
      {/* Left Area: Mobile Drawer Toggle, Desktop Sidebar Toggle & Breadcrumbs */}
      <div className="topbar-left-zone">
        {/* Mobile Menu Hamburger */}
        <button
          type="button"
          className="mobile-hamburger-btn"
          onClick={onOpenMobileDrawer}
          title="Open Navigation Menu"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5 text-slate-300" />
        </button>

        {/* Desktop Sidebar Toggle */}
        <button
          type="button"
          className="topbar-sidebar-toggle-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
          aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <SidebarIcon className="w-4 h-4 text-slate-400" />
        </button>

        {/* Dynamic Breadcrumbs */}
        <nav className="topbar-breadcrumb-nav" aria-label="Breadcrumb">
          <ol className="breadcrumb-list" role="list">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={idx} className="breadcrumb-item">
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 breadcrumb-separator text-slate-500" />}
                  {isLast || !crumb.view ? (
                    <span className="breadcrumb-label active" aria-current={isLast ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="breadcrumb-label-btn"
                      onClick={() => onSelectView(crumb.view, true)}
                    >
                      {crumb.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Center Area: Command Palette Trigger Pill */}
      <div className="topbar-center-zone">
        <button
          type="button"
          className="command-palette-trigger-btn"
          onClick={onOpenCommandPalette}
          title="Search or jump to anywhere (Ctrl + K)"
          aria-label="Open Command Palette"
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span className="command-trigger-text">Search or jump to...</span>
          <div className="command-shortcut-badge">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </div>
        </button>
      </div>

      {/* Right Area: Notification Center, Theme Switcher & User Profile Menu */}
      <div className="topbar-right-zone">
        {/* Notification Bell Center */}
        <NotificationCenter />

        {/* Quick Theme Switcher */}
        <div className="topbar-theme-quick-switch" title={`Theme: ${resolvedTheme}`}>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Theme`}
            aria-label="Toggle Theme"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-blue-400" />
            )}
          </button>
        </div>

        {/* User Account / Auth Dropdown */}
        {currentUser ? (
          <div className="topbar-user-menu-wrap" ref={userMenuRef}>
            <button
              type="button"
              className={`topbar-user-avatar-btn ${isUserMenuOpen ? 'active' : ''}`}
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              aria-label="User Account Menu"
              aria-expanded={isUserMenuOpen}
            >
              <CoderEmblem
                username={currentUser.username}
                rating={currentUser.currentRating || 1200}
                size="sm"
              />
              <div className="topbar-user-text">
                <span className="topbar-username">{currentUser.username}</span>
                <span className="topbar-role-badge">{currentUser.role}</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 dropdown-arrow" />
            </button>

            {/* Dropdown Card */}
            {isUserMenuOpen && (
              <div className="user-menu-dropdown-card" role="menu">
                <div className="user-menu-header">
                  <span className="menu-user-fullname">{currentUser.fullName || currentUser.username}</span>
                  <span className="menu-user-handle font-mono">@{currentUser.username}</span>
                  {currentUser.institution && (
                    <span className="menu-user-college">{currentUser.institution}</span>
                  )}
                </div>

                <div className="user-menu-divider"></div>

                <div className="user-menu-items-group" role="group">
                  <button
                    type="button"
                    className="user-menu-item-btn"
                    onClick={() => {
                      onSelectView('profile', true);
                      setIsUserMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <User className="w-4 h-4 text-blue-400" />
                    <span>Coder Profile</span>
                  </button>

                  <button
                    type="button"
                    className="user-menu-item-btn"
                    onClick={() => {
                      onSelectView('profile', true, null, null, 'settings');
                      setIsUserMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    <span>Settings & Preferences</span>
                  </button>
                </div>

                <div className="user-menu-divider"></div>

                {/* Theme selection row inside user menu */}
                <div className="user-menu-theme-row">
                  <span className="theme-row-label">Theme</span>
                  <div className="theme-inline-chips">
                    <button
                      type="button"
                      className={`theme-chip-btn ${theme === 'light' ? 'active' : ''}`}
                      onClick={() => setTheme('light')}
                      title="Light Theme"
                    >
                      <Sun className="w-3 h-3" />
                      <span>Light</span>
                    </button>
                    <button
                      type="button"
                      className={`theme-chip-btn ${theme === 'dark' ? 'active' : ''}`}
                      onClick={() => setTheme('dark')}
                      title="Dark Theme"
                    >
                      <Moon className="w-3 h-3" />
                      <span>Dark</span>
                    </button>
                    <button
                      type="button"
                      className={`theme-chip-btn ${theme === 'system' ? 'active' : ''}`}
                      onClick={() => setTheme('system')}
                      title="Follow System Theme"
                    >
                      <Monitor className="w-3 h-3" />
                      <span>Auto</span>
                    </button>
                  </div>
                </div>

                <div className="user-menu-divider"></div>

                <button
                  type="button"
                  className="user-menu-item-btn logout-item"
                  onClick={() => {
                    onLogout();
                    setIsUserMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <LogOut className="w-4 h-4 text-rose-400" />
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="topbar-auth-btns-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onOpenLogin}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onOpenSignup}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
