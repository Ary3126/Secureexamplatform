import React from 'react';
import {
  ArrowLeft,
  Play,
  Send,
  RotateCcw,
  Clock,
  Code2,
  Sidebar as SidebarIcon,
  Search,
  Lock,
} from 'lucide-react';

export default function WorkspaceTopBar({
  selectedProblem = null,
  contest = null,
  language = 'cpp',
  onLanguageChange = () => {},
  onResetTemplate = () => {},
  onRun = () => {},
  onSubmit = () => {},
  isRunning = false,
  isSubmitting = false,
  onNavigateBack = () => {},
  onToggleSidebar = () => {},
  onOpenCommandPalette = () => {},
  sidebarCollapsed = false,
}) {
  const diffClass = selectedProblem?.difficulty
    ? `diff-${selectedProblem.difficulty.toLowerCase()}`
    : 'diff-easy';

  const isUpcomingContest = contest && (contest.runtimeState === 'upcoming' || contest.status === 'upcoming');
  const isEndedContest = contest && (contest.runtimeState === 'ended' || contest.status === 'ended');

  const actionDisabled = isRunning || isSubmitting || isUpcomingContest;
  const actionTooltip = isUpcomingContest
    ? 'Submissions and interactive runs unlock once the contest goes live.'
    : isRunning
    ? 'Running sample cases...'
    : isSubmitting
    ? 'Submitting to judge...'
    : undefined;

  return (
    <header className="workspace-topbar-header" aria-label="Workspace Controls">
      {/* Left: Sidebar Toggle, Back to Problems, and Problem Title */}
      <div className="workspace-topbar-left">
        <button
          type="button"
          className="topbar-sidebar-toggle-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Expand Sidebar (Ctrl+B)' : 'Collapse Sidebar (Ctrl+B)'}
          aria-label={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <SidebarIcon className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          className="workspace-back-btn"
          onClick={onNavigateBack}
          title="Return to Problem Explorer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="back-btn-text">Problems</span>
        </button>

        <div className="workspace-problem-ident">
          <span className={`diff-pill ${diffClass}`}>
            {selectedProblem?.difficulty?.toUpperCase() || 'EASY'}
          </span>
          <span className="workspace-problem-title">
            {selectedProblem?.title || `Problem #${selectedProblem?.id || 1}`}
          </span>
        </div>
      </div>

      {/* Center: Contest Context Badge & Language Selector */}
      <div className="workspace-topbar-center">
        {contest && (
          <div
            className={`workspace-contest-pill ${isUpcomingContest ? 'contest-pill-upcoming' : ''}`}
            title={`Contest: ${contest.title} (${contest.runtimeState || 'active'})`}
          >
            {isUpcomingContest ? (
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="contest-pill-title">
              {contest.title}
              {isUpcomingContest ? ' (Upcoming - Locked)' : isEndedContest ? ' (Ended)' : ''}
            </span>
          </div>
        )}

        <div className="workspace-lang-control-group">
          <Code2 className="w-3.5 h-3.5 text-slate-400" />
          <select
            className="workspace-lang-select"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            title="Select Programming Language"
            aria-label="Programming Language"
            disabled={isRunning || isSubmitting}
          >
            <option value="cpp">C++ (GCC 13)</option>
            <option value="python">Python (3.11)</option>
            <option value="java">Java (OpenJDK 21)</option>
          </select>

          <button
            type="button"
            className="workspace-reset-btn"
            onClick={onResetTemplate}
            title="Reset code to default template"
            aria-label="Reset code to starter template"
            disabled={isRunning || isSubmitting}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: Quick Search + Run & Submit Actions */}
      <div className="workspace-topbar-right">
        <button
          type="button"
          className="workspace-search-shortcut-btn"
          onClick={onOpenCommandPalette}
          title="Command Palette (Ctrl + K)"
          aria-label="Open Command Palette"
        >
          <Search className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm workspace-run-btn"
          onClick={onRun}
          disabled={actionDisabled}
          title={actionTooltip || 'Run sample test cases'}
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunning ? 'Running...' : 'Run'}</span>
        </button>

        <button
          type="button"
          className="btn btn-primary btn-sm workspace-submit-btn"
          onClick={onSubmit}
          disabled={actionDisabled}
          title={actionTooltip || 'Submit solution to online judge'}
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isSubmitting ? 'Evaluating...' : 'Submit'}</span>
        </button>
      </div>
    </header>
  );
}
