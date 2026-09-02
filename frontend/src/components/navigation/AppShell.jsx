import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import WorkspaceTopBar from './WorkspaceTopBar';
import CommandPalette from './CommandPalette';

const SIDEBAR_STORAGE_KEY = 'securejudge_sidebar_collapsed';

export default function AppShell({
  activeView = 'landing',
  activeProfileTab = 'matrix',
  selectedProblem = null,
  contest = null,
  currentUser = null,
  profileTargetUser = null,
  problems = [],
  language = 'cpp',
  isRunning = false,
  isSubmitting = false,
  onSelectView = () => {},
  onOpenLogin = () => {},
  onOpenSignup = () => {},
  onLogout = () => {},
  onLanguageChange = () => {},
  onResetTemplate = () => {},
  onRun = () => {},
  onSubmit = () => {},
  onSelectProblem = () => {},
  children,
}) {
  // 1. Sidebar Collapsed State with LocalStorage Persistence
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return saved === 'true';
    } catch (e) {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // 2. Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // 3. Mobile Navigation Drawer State
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // 4. Global Keyboard Shortcuts: Ctrl+K / Cmd+K (Command Palette), Ctrl+B / Cmd+B (Sidebar Toggle), Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      // Check for Ctrl+B or Cmd+B
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      // Check for Escape key
      else if (e.key === 'Escape') {
        if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
        if (isMobileDrawerOpen) setIsMobileDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen, isMobileDrawerOpen, toggleSidebar]);

  const isWorkspace = activeView === 'workspace';

  return (
    <div
      className={`app-shell-root ${sidebarCollapsed ? 'sidebar-is-collapsed' : 'sidebar-is-expanded'} ${
        isWorkspace ? 'workspace-mode-active' : ''
      }`}
    >
      {/* 1. Collapsible Sidebar Navigation */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        activeView={activeView}
        activeProfileTab={activeProfileTab}
        currentUser={currentUser}
        onSelectView={onSelectView}
        isMobileDrawerOpen={isMobileDrawerOpen}
        onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
      />

      {/* Mobile Backdrop Overlay */}
      {isMobileDrawerOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setIsMobileDrawerOpen(false)}
          role="button"
          tabIndex={0}
          aria-label="Close Mobile Navigation"
          onKeyDown={(e) => e.key === 'Escape' && setIsMobileDrawerOpen(false)}
        />
      )}

      {/* 2. Main Application Flow Area */}
      <div className="app-shell-main-track">
        {/* Top Header: Context-Aware (Workspace Bar vs. Minimal Platform Bar) */}
        {isWorkspace ? (
          <WorkspaceTopBar
            selectedProblem={selectedProblem}
            contest={contest}
            language={language}
            onLanguageChange={onLanguageChange}
            onResetTemplate={onResetTemplate}
            onRun={onRun}
            onSubmit={onSubmit}
            isRunning={isRunning}
            isSubmitting={isSubmitting}
            onNavigateBack={() => onSelectView('problems', true)}
            onToggleSidebar={toggleSidebar}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
          />
        ) : (
          <TopBar
            activeView={activeView}
            activeProfileTab={activeProfileTab}
            selectedProblem={selectedProblem}
            contest={contest}
            currentUser={currentUser}
            profileTargetUser={profileTargetUser}
            onSelectView={onSelectView}
            onOpenLogin={onOpenLogin}
            onOpenSignup={onOpenSignup}
            onLogout={onLogout}
            onToggleSidebar={toggleSidebar}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
          />
        )}

        {/* 3. View Content Viewport */}
        <div className={`app-shell-viewport ${isWorkspace ? 'workspace-viewport-fixed' : 'page-viewport-scrollable'}`}>
          {children}
        </div>
      </div>

      {/* 4. Global Command Palette Modal (Ctrl + K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectView={onSelectView}
        onToggleSidebar={toggleSidebar}
        problems={problems}
        onSelectProblem={onSelectProblem}
      />
    </div>
  );
}
