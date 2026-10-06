import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  LogIn,
  UserPlus,
  LayoutDashboard,
  Code,
  UserCheck,
  LogOut,
  Menu,
  X,
  Home,
  BookOpen,
  Trophy,
  Globe,
  History,
} from 'lucide-react';
import ThemeSelector from './ThemeSelector';
import CoderEmblem from './CoderEmblem';

export default function Navbar({
  contest,
  currentUser,
  activeView = 'landing',
  onSelectView,
  onOpenLogin,
  onOpenSignup,
  onLogout,
}) {
  const [timeLeftStr, setTimeLeftStr] = useState('--:--:--');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!contest || !contest.endTime) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(contest.endTime).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeftStr('00:00:00 (Ended)');
        clearInterval(interval);
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeftStr(
          `${hours.toString().padStart(2, '0')}:${minutes
            .toString()
            .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [contest]);

  const runtimeState = contest ? contest.runtimeState || 'running' : 'running';

  const handleNavClick = (view) => {
    onSelectView(view);
    setMobileMenuOpen(false);
  };

  return (
    <header className="navbar">
      {/* Brand Logo */}
      <div className="nav-left">
        <div
          className="nav-brand"
          onClick={() => handleNavClick('landing')}
          role="button"
          tabIndex={0}
          title="CodeForge Home"
        >
          <ShieldCheck className="w-6 h-6 text-blue-500 flex-shrink-0" />
          <span className="brand-name">CodeForge</span>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="desktop-nav-links">
          <button
            type="button"
            className={`nav-link-btn ${activeView === 'landing' ? 'active' : ''}`}
            onClick={() => handleNavClick('landing')}
          >
            <Home className="w-4 h-4" />
            <span>Home</span>
          </button>

          <button
            type="button"
            className={`nav-link-btn ${activeView === 'problems' ? 'active' : ''}`}
            onClick={() => handleNavClick('problems')}
          >
            <BookOpen className="w-4 h-4" />
            <span>Problems</span>
          </button>

          <button
            type="button"
            className={`nav-link-btn ${activeView === 'workspace' ? 'active' : ''}`}
            onClick={() => handleNavClick('workspace')}
          >
            <Code className="w-4 h-4" />
            <span>Workspace</span>
          </button>

          <button
            type="button"
            className={`nav-link-btn ${activeView === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleNavClick('dashboard')}
          >
            <Trophy className="w-4 h-4" />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            className={`nav-link-btn ${activeView === 'rankings' ? 'active' : ''}`}
            onClick={() => handleNavClick('rankings')}
          >
            <Globe className="w-4 h-4" />
            <span>Leaderboard</span>
          </button>

          {currentUser && (
            <button
              type="button"
              className={`nav-link-btn ${activeView === 'submissions' ? 'active' : ''}`}
              onClick={() => handleNavClick('submissions')}
            >
              <History className="w-4 h-4" />
              <span>Submissions</span>
            </button>
          )}

          {currentUser && (
            <button
              type="button"
              className={`nav-link-btn ${activeView === 'profile' ? 'active' : ''}`}
              onClick={() => handleNavClick('profile')}
            >
              <UserCheck className="w-4 h-4" />
              <span>Profile</span>
            </button>
          )}


          {currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'contest_admin') && (
            <button
              type="button"
              className={`nav-link-btn ${activeView === 'admin' ? 'active' : ''}`}
              onClick={() => handleNavClick('admin')}
              style={{
                borderColor: activeView === 'admin' ? '#f59e0b' : 'transparent',
                color: activeView === 'admin' ? '#fbbf24' : '#cbd5e1',
              }}
            >
              <ShieldAlert className="w-4 h-4" color="#f59e0b" />
              <span>Admin Console</span>
            </button>
          )}
        </nav>
      </div>

      {/* Center Contest Status (Workspace only) */}
      {contest && activeView === 'workspace' && (
        <div className="nav-contest-info">
          <span className="contest-title-tag" title={contest.title}>
            {contest.title}
          </span>
          <span className={`status-badge status-${runtimeState}`}>
            {runtimeState}
          </span>
          <div className="timer-badge">
            <Clock className="w-4 h-4" />
            <span>{timeLeftStr}</span>
          </div>
        </div>
      )}

      {/* Right Actions & Auth Status */}
      <div className="nav-actions">
        {/* User Status / Auth Buttons */}
        {currentUser ? (
          <div className="user-profile-menu">
            <div
              className="user-badge"
              onClick={() => handleNavClick('profile')}
              role="button"
              tabIndex={0}
              title="View Profile"
            >
              <CoderEmblem
                username={currentUser.username}
                rating={currentUser.currentRating || 1200}
                size="sm"
              />
              <div className="user-text-info">
                <span className="user-name">{currentUser.username}</span>
                <span className="user-role-badge">{currentUser.role}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm logout-btn"
              onClick={onLogout}
              title="Log out of account"
              aria-label="Log Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="logout-label">Logout</span>
            </button>
          </div>
        ) : (
          <div className="auth-buttons-group">
            <button
              type="button"
              className="btn btn-secondary nav-login-btn"
              onClick={onOpenLogin}
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In</span>
            </button>

            <button
              type="button"
              className="btn btn-primary nav-signup-btn"
              onClick={onOpenSignup}
            >
              <UserPlus className="w-4 h-4" />
              <span>Sign Up</span>
            </button>
          </div>
        )}

        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          className="mobile-menu-toggle-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close Menu' : 'Open Menu'}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer-card" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div className="nav-brand">
                <ShieldCheck className="w-6 h-6 text-blue-500" />
                <span className="brand-name">CodeForge</span>
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mobile-drawer-theme">
              <span className="mobile-drawer-label">Theme</span>
              <ThemeSelector />
            </div>

            <nav className="mobile-drawer-links">
              <button
                type="button"
                className={`mobile-nav-item ${activeView === 'landing' ? 'active' : ''}`}
                onClick={() => handleNavClick('landing')}
              >
                <Home className="w-5 h-5" />
                <span>Home</span>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeView === 'problems' ? 'active' : ''}`}
                onClick={() => handleNavClick('problems')}
              >
                <BookOpen className="w-5 h-5" />
                <span>Problem Explorer</span>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeView === 'workspace' ? 'active' : ''}`}
                onClick={() => handleNavClick('workspace')}
              >
                <Code className="w-5 h-5" />
                <span>Practice Workspace</span>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeView === 'dashboard' ? 'active' : ''}`}
                onClick={() => handleNavClick('dashboard')}
              >
                <Trophy className="w-5 h-5" />
                <span>Student Dashboard</span>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeView === 'rankings' ? 'active' : ''}`}
                onClick={() => handleNavClick('rankings')}
              >
                <Globe className="w-5 h-5" />
                <span>Global Leaderboard</span>
              </button>

              {currentUser && (
                <button
                  type="button"
                  className={`mobile-nav-item ${activeView === 'submissions' ? 'active' : ''}`}
                  onClick={() => handleNavClick('submissions')}
                >
                  <History className="w-5 h-5" />
                  <span>Submission History</span>
                </button>
              )}

              {currentUser && (
                <button
                  type="button"
                  className={`mobile-nav-item ${activeView === 'profile' ? 'active' : ''}`}
                  onClick={() => handleNavClick('profile')}
                >
                  <UserCheck className="w-5 h-5" />
                  <span>My Profile</span>
                </button>
              )}


              {currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'contest_admin') && (
                <button
                  type="button"
                  className={`mobile-nav-item ${activeView === 'admin' ? 'active' : ''}`}
                  onClick={() => handleNavClick('admin')}
                  style={{ color: '#fbbf24' }}
                >
                  <ShieldAlert className="w-5 h-5" color="#f59e0b" />
                  <span>Admin Console</span>
                </button>
              )}
            </nav>

            <div className="mobile-drawer-footer">
              {currentUser ? (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out ({currentUser.username})</span>
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <button
                    type="button"
                    className="btn btn-primary w-full"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenSignup();
                    }}
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Create Account</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary w-full"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenLogin();
                    }}
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}