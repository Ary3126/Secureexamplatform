import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Home,
  Code2,
  Trophy,
  LayoutDashboard,
  BarChart3,
  History,
  User,
  Settings,
  Sun,
  Moon,
  Monitor,
  Terminal,
  Sidebar as SidebarIcon,
  ArrowRight,
  Sparkles,
  X,
} from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';

export default function CommandPalette({
  isOpen = false,
  onClose = () => {},
  onSelectView = () => {},
  onToggleSidebar = () => {},
  problems = [],
  onSelectProblem = () => {},
}) {
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Auto-focus input when opened & reset state
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 50);
    }
  }, [isOpen]);

  // Build command palette catalog
  const staticCommands = [
    // Navigation
    {
      id: 'nav-home',
      category: 'NAVIGATION',
      title: 'Platform Home',
      subtitle: 'Go to public landing and showcase',
      icon: Home,
      action: () => onSelectView('landing', true),
    },
    {
      id: 'nav-problems',
      category: 'NAVIGATION',
      title: 'Problem Explorer',
      subtitle: 'Browse all algorithmic challenges',
      icon: Code2,
      action: () => onSelectView('problems', true),
    },
    {
      id: 'nav-contests',
      category: 'NAVIGATION',
      title: 'Contests & Arena',
      subtitle: 'View scheduled and live contests',
      icon: Trophy,
      action: () => onSelectView('dashboard', true),
    },
    {
      id: 'nav-dashboard',
      category: 'NAVIGATION',
      title: 'Student Dashboard',
      subtitle: 'Overview of recent solves and contest history',
      icon: LayoutDashboard,
      action: () => onSelectView('dashboard', true),
    },
    {
      id: 'nav-leaderboard',
      category: 'NAVIGATION',
      title: 'Global & College Leaderboard',
      subtitle: 'Platform-wide and college rankings',
      icon: BarChart3,
      action: () => onSelectView('rankings', true),
    },
    {
      id: 'nav-submissions',
      category: 'NAVIGATION',
      title: 'Submission History & Analytics',
      subtitle: 'Audit code verdicts and runtime analytics',
      icon: History,
      action: () => onSelectView('submissions', true),
    },
    {
      id: 'nav-profile',
      category: 'NAVIGATION',
      title: 'Coder Identity Profile',
      subtitle: 'View Elo rating, emblem, and domain stats',
      icon: User,
      action: () => onSelectView('profile', true),
    },
    {
      id: 'nav-settings',
      category: 'NAVIGATION',
      title: 'Settings & Preferences',
      subtitle: 'Configure theme, institution, and workspace ergonomics',
      icon: Settings,
      action: () => onSelectView('profile', true, null, null, 'settings'),
    },
    {
      id: 'nav-workspace',
      category: 'NAVIGATION',
      title: 'Practice Code Workspace',
      subtitle: 'Open interactive IDE workspace',
      icon: Terminal,
      action: () => onSelectView('workspace', true),
    },

    // Actions & Themes
    {
      id: 'action-theme-light',
      category: 'THEME & INTERFACE',
      title: 'Switch to Light Theme',
      subtitle: 'Clean high-contrast daylight interface',
      icon: Sun,
      action: () => setTheme('light'),
    },
    {
      id: 'action-theme-dark',
      category: 'THEME & INTERFACE',
      title: 'Switch to Dark Theme',
      subtitle: 'Deep slate coding workspace',
      icon: Moon,
      action: () => setTheme('dark'),
    },
    {
      id: 'action-theme-system',
      category: 'THEME & INTERFACE',
      title: 'Follow System Theme',
      subtitle: 'Synchronize with device OS scheme',
      icon: Monitor,
      action: () => setTheme('system'),
    },
    {
      id: 'action-toggle-sidebar',
      category: 'THEME & INTERFACE',
      title: 'Toggle Sidebar Collapse',
      subtitle: 'Expand or collapse navigation sidebar (Ctrl+B)',
      icon: SidebarIcon,
      action: () => onToggleSidebar(),
    },
  ];

  // Dynamic problem shortcuts
  const problemCommands = (problems || []).slice(0, 8).map((p) => ({
    id: `prob-${p.id}`,
    category: 'CHALLENGES',
    title: p.title || `Problem #${p.id}`,
    subtitle: `${p.difficulty?.toUpperCase() || 'EASY'} • ${p.category || 'Algorithms'}`,
    icon: Code2,
    action: () => {
      onSelectProblem(p.id);
      onSelectView('workspace', true);
    },
  }));

  const allCommands = [...staticCommands, ...problemCommands];

  // Filter commands by query
  const filteredCommands = query.trim() === ''
    ? allCommands
    : allCommands.filter((cmd) => {
        const fullText = `${cmd.title} ${cmd.subtitle} ${cmd.category}`.toLowerCase();
        return fullText.includes(query.toLowerCase());
      });

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('.command-palette-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="command-palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="command-palette-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Bar Header */}
        <div className="command-palette-input-wrap">
          <Search className="w-5 h-5 text-slate-400 search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            aria-autocomplete="list"
          />
          {query && (
            <button
              type="button"
              className="command-clear-btn"
              onClick={() => setQuery('')}
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div className="command-esc-badge">
            <kbd>ESC</kbd>
          </div>
        </div>

        {/* Command Items List */}
        <div className="command-palette-body" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              <Sparkles className="w-6 h-6 text-slate-500 mb-2" />
              <p className="font-semibold text-slate-300">No commands matching &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-slate-500 mt-1">
                Try searching for &quot;problems&quot;, &quot;leaderboard&quot;, &quot;settings&quot;, or &quot;theme&quot;.
              </p>
            </div>
          ) : (
            <ul className="command-palette-list" role="listbox">
              {filteredCommands.map((cmd, idx) => {
                const Icon = cmd.icon;
                const isSelected = idx === selectedIndex;

                return (
                  <li
                    key={cmd.id}
                    className={`command-palette-item ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      cmd.action();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="command-item-icon-wrap">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="command-item-info">
                      <div className="command-item-title-row">
                        <span className="command-item-title">{cmd.title}</span>
                        <span className="command-item-category">{cmd.category}</span>
                      </div>
                      <span className="command-item-subtitle">{cmd.subtitle}</span>
                    </div>
                    {isSelected && (
                      <ArrowRight className="w-4 h-4 text-cyan-400 command-arrow-icon" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Keyboard Navigation Footer */}
        <div className="command-palette-footer">
          <div className="footer-keys-hints">
            <span className="key-hint">
              <kbd className="kbd-pill">↑</kbd>
              <kbd className="kbd-pill">↓</kbd>
              Navigate
            </span>
            <span className="key-hint">
              <kbd className="kbd-pill">↵</kbd>
              Select
            </span>
            <span className="key-hint">
              <kbd className="kbd-pill">ESC</kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
