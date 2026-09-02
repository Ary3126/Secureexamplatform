import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  X,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  Award,
  Calendar,
  Download,
  Code2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  BarChart3,
  Layers,
  Sparkles,
  Zap,
  TrendingUp,
  AlertCircle,
  Terminal,
  GitCompare,
} from 'lucide-react';
import SubmissionCodeModal from './SubmissionCodeModal';
import SubmissionComparisonModal from './SubmissionComparisonModal';

export default function SubmissionHistory({
  token,
  currentUser,
  onOpenProblemInEditor,
  onNavigateProblems,
  onViewSubmissionDetail,
  onOpenLogin,
}) {
  // Filters & State
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [language, setLanguage] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);

  // Data States
  const [submissions, setSubmissions] = useState([]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalSubmissions: 0,
    limit: 15,
    hasNext: false,
    hasPrev: false,
  });
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selected submission for code inspection modal
  const [selectedSubForModal, setSelectedSubForModal] = useState(null);

  // Phase 5.8.5: Selected submission for comparison modal
  const [compareSub, setCompareSub] = useState(null);
  const [codeLoading, setCodeLoading] = useState(false);

  // Debounce search (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch Submissions List
  const fetchSubmissions = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      if (verdict !== 'all') params.append('verdict', verdict);
      if (language !== 'all') params.append('language', language);
      if (timeRange !== 'all') params.append('timeRange', timeRange);
      if (sortBy) params.append('sortBy', sortBy);
      params.append('page', page.toString());
      params.append('limit', '15');

      const res = await fetch(`/api/submissions/my?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        setSubmissions(data.submissions || []);
        if (data.pagination) setPagination(data.pagination);
      } else {
        setError(data.message || 'Failed to load submissions');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching submissions');
    } finally {
      setLoading(false);
    }
  }, [token, debouncedSearch, verdict, language, timeRange, sortBy, page]);

  // Fetch Coding Analytics
  const fetchAnalytics = useCallback(async () => {
    if (!token) {
      setAnalyticsLoading(false);
      return;
    }
    setAnalyticsLoading(true);
    try {
      const params = new URLSearchParams();
      if (timeRange !== 'all') params.append('timeRange', timeRange);

      const res = await fetch(`/api/submissions/analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setAnalytics(data);
      }
    } catch (e) {
      console.error('Failed to load analytics:', e);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [token, timeRange]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Inspect Source Code
  const handleInspectCode = async (subId) => {
    setCodeLoading(true);
    try {
      const res = await fetch(`/api/submissions/${subId}/code`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedSubForModal(data);
      } else {
        alert(data.message || 'Unable to load submission code');
      }
    } catch (e) {
      alert('Network error loading code');
    } finally {
      setCodeLoading(false);
    }
  };

  // Export CSV
  const handleExportCsv = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/submissions/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert('Failed to generate export file');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `submissions_history_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert('Error downloading CSV file');
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setVerdict('all');
    setLanguage('all');
    setSortBy('newest');
    setPage(1);
  };

  const hasActiveFilters =
    debouncedSearch.trim() !== '' ||
    verdict !== 'all' ||
    language !== 'all' ||
    sortBy !== 'newest';

  const formatVerdictPill = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return (
          <span className="history-status-pill pill-accepted">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Accepted</span>
          </span>
        );
      case 'wrong_answer':
        return (
          <span className="history-status-pill pill-wrong_answer">
            <XCircle className="w-3.5 h-3.5" />
            <span>Wrong Answer</span>
          </span>
        );
      case 'time_limit_exceeded':
        return (
          <span className="history-status-pill pill-time_limit_exceeded">
            <Clock className="w-3.5 h-3.5" />
            <span>Time Limit</span>
          </span>
        );
      case 'compilation_error':
      case 'runtime_error':
        return (
          <span className="history-status-pill pill-compilation_error">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{status?.replace(/_/g, ' ').toUpperCase()}</span>
          </span>
        );
      default:
        return (
          <span className="history-status-pill pill-queued">
            <span>{status ? status.replace(/_/g, ' ').toUpperCase() : 'QUEUED'}</span>
          </span>
        );
    }
  };

  if (!token) {
    return (
      <div className="submissions-history-container unauth-state">
        <div className="dash-error-card" style={{ maxWidth: '520px', margin: '60px auto', textAlign: 'center' }}>
          <BarChart3 className="w-12 h-12 text-blue-400 mb-2" style={{ margin: '0 auto' }} />
          <h3>Sign in to View Submission History</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
            Audit all your evaluated code submissions, runtime and memory performance statistics, and source code logs.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={onOpenLogin}>
              Sign In
            </button>
            <button className="btn btn-secondary" onClick={onNavigateProblems}>
              Explore Problems
            </button>
          </div>
        </div>
      </div>
    );
  }

  const summary = analytics?.summary || {};
  const verdictDist = analytics?.verdictDistribution || {};
  const langDist = analytics?.languageDistribution || {};
  const diffDist = analytics?.difficultyDistribution || {};
  const timeline = analytics?.activityTimeline || [];

  return (
    <div className="submissions-history-container">
      {/* 1. Header with Time Range Selector & Export Action */}
      <div className="history-header">
        <div>
          <div className="explorer-badge">
            <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
            <span>Student Analytics</span>
          </div>
          <h1 className="history-title">Submission History & Coding Analytics</h1>
          <p className="history-subtitle">
            Comprehensive audit log of all your evaluated code submissions, runtime performance metrics, and learning trajectory.
          </p>
        </div>

        <div className="history-header-actions">
          {/* Time Range Filter Switcher */}
          <div className="time-range-segmented-control">
            <button
              type="button"
              className={`time-range-btn ${timeRange === 'today' ? 'active' : ''}`}
              onClick={() => setTimeRange('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={`time-range-btn ${timeRange === '7d' ? 'active' : ''}`}
              onClick={() => setTimeRange('7d')}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`time-range-btn ${timeRange === '30d' ? 'active' : ''}`}
              onClick={() => setTimeRange('30d')}
            >
              30 Days
            </button>
            <button
              type="button"
              className={`time-range-btn ${timeRange === 'all' ? 'active' : ''}`}
              onClick={() => setTimeRange('all')}
            >
              All Time
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-export-csv"
            onClick={handleExportCsv}
            title="Download CSV export of your personal submission history"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 2. Coding Analytics Overview Cards & Charts Grid */}
      <div className="analytics-summary-grid">
        {/* Metric Card 1: Unique Problems Solved */}
        <div className="analytics-metric-card">
          <div className="analytics-card-header">
            <span className="metric-header-title">Problems Solved</span>
            <div className="stat-pill-icon stat-icon-blue">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="metric-card-value">
            <span className="metric-huge">{summary.uniqueProblemsSolved || 0}</span>
            <span className="metric-sub-label">unique challenges</span>
          </div>
          <div className="metric-card-footer">
            <span>{summary.uniqueProblemsAttempted || 0} attempted</span>
          </div>
        </div>

        {/* Metric Card 2: Acceptance Rate */}
        <div className="analytics-metric-card">
          <div className="analytics-card-header">
            <span className="metric-header-title">Acceptance Rate</span>
            <div className="stat-pill-icon stat-icon-amber">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="metric-card-value">
            <span className="metric-huge">{summary.acceptanceRate || 0}%</span>
            <span className="metric-sub-label">accuracy</span>
          </div>
          <div className="metric-card-footer">
            <span>{summary.acceptedSubmissions || 0} of {summary.totalSubmissions || 0} evaluated</span>
          </div>
        </div>

        {/* Metric Card 3: Total Submissions */}
        <div className="analytics-metric-card">
          <div className="analytics-card-header">
            <span className="metric-header-title">Total Submissions</span>
            <div className="stat-pill-icon stat-icon-purple">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="metric-card-value">
            <span className="metric-huge">{summary.totalSubmissions || 0}</span>
            <span className="metric-sub-label">attempts</span>
          </div>
          <div className="metric-card-footer">
            <span>Across all problem sets</span>
          </div>
        </div>

        {/* Metric Card 4: Avg Speed & Memory */}
        <div className="analytics-metric-card">
          <div className="analytics-card-header">
            <span className="metric-header-title">Judge Performance</span>
            <div className="stat-pill-icon stat-icon-cyan">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="metric-card-value-group">
            <div>
              <span className="perf-val">{summary.averageRuntime || 0} ms</span>
              <span className="perf-label">Avg Runtime</span>
            </div>
            <div>
              <span className="perf-val">
                {summary.averageMemory > 1024 ? Math.round(summary.averageMemory / 1024) : summary.averageMemory || 0} MB
              </span>
              <span className="perf-label">Avg Memory</span>
            </div>
          </div>
          <div className="metric-card-footer">
            <span>Best: {summary.bestRuntime || 0} ms</span>
          </div>
        </div>
      </div>

      {/* 3. Detailed Distribution Panels */}
      <div className="analytics-breakdown-grid">
        {/* Verdict Distribution Panel */}
        <div className="breakdown-card">
          <div className="breakdown-header">
            <h4>Verdict Breakdown</h4>
            <span className="breakdown-sub">{summary.totalSubmissions || 0} total</span>
          </div>
          <div className="verdict-breakdown-pills">
            <div className="verdict-count-item item-accepted">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Accepted</span>
              <strong>{verdictDist.accepted || 0}</strong>
            </div>
            <div className="verdict-count-item item-wa">
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Wrong Answer</span>
              <strong>{verdictDist.wrong_answer || 0}</strong>
            </div>
            <div className="verdict-count-item item-tle">
              <Clock className="w-4 h-4 text-amber-400" />
              <span>Time Limit</span>
              <strong>{verdictDist.time_limit_exceeded || 0}</strong>
            </div>
            <div className="verdict-count-item item-err">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Runtime / Compile Error</span>
              <strong>{(verdictDist.runtime_error || 0) + (verdictDist.compilation_error || 0)}</strong>
            </div>
          </div>
        </div>

        {/* Difficulty Distribution Panel */}
        <div className="breakdown-card">
          <div className="breakdown-header">
            <h4>Solved by Difficulty</h4>
            <span className="breakdown-sub">{summary.uniqueProblemsSolved || 0} unique solved</span>
          </div>
          <div className="difficulty-solved-cards">
            <div className="diff-solved-tile tile-easy">
              <span className="diff-title">Easy</span>
              <span className="diff-count">{diffDist.easy || 0}</span>
              <span className="diff-solved-label">Solved</span>
            </div>
            <div className="diff-solved-tile tile-medium">
              <span className="diff-title">Medium</span>
              <span className="diff-count">{diffDist.medium || 0}</span>
              <span className="diff-solved-label">Solved</span>
            </div>
            <div className="diff-solved-tile tile-hard">
              <span className="diff-title">Hard</span>
              <span className="diff-count">{diffDist.hard || 0}</span>
              <span className="diff-solved-label">Solved</span>
            </div>
          </div>
        </div>

        {/* Language Usage Panel */}
        <div className="breakdown-card">
          <div className="breakdown-header">
            <h4>Language Distribution</h4>
            <span className="breakdown-sub">Compiler Usage</span>
          </div>
          <div className="language-dist-list">
            {['cpp', 'python', 'java'].map((langKey) => {
              const langData = langDist[langKey] || { count: 0, percentage: 0 };
              const langLabels = { cpp: 'C++ (GCC 17)', python: 'Python 3.12', java: 'Java (OpenJDK 17)' };
              return (
                <div key={langKey} className="lang-dist-row">
                  <div className="lang-dist-info">
                    <span className="lang-dist-name">{langLabels[langKey]}</span>
                    <span className="lang-dist-count">{langData.count} submissions ({langData.percentage}%)</span>
                  </div>
                  <div className="lang-progress-track">
                    <div
                      className={`lang-progress-fill fill-${langKey}`}
                      style={{ width: `${langData.percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Submissions Filter & Search Bar */}
      <div className="explorer-controls-card">
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search submission history by problem title or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch('')}
              aria-label="Clear Search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="filters-row">
          {/* Verdict Filter */}
          <div className="filter-select-group">
            <label className="filter-label">Verdict</label>
            <select
              className="filter-select"
              value={verdict}
              onChange={(e) => {
                setVerdict(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Verdicts</option>
              <option value="accepted">Accepted</option>
              <option value="wrong_answer">Wrong Answer</option>
              <option value="time_limit_exceeded">Time Limit Exceeded</option>
              <option value="runtime_error">Runtime Error</option>
              <option value="compilation_error">Compilation Error</option>
            </select>
          </div>

          {/* Language Filter */}
          <div className="filter-select-group">
            <label className="filter-label">Language</label>
            <select
              className="filter-select"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Languages</option>
              <option value="cpp">C++</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="filter-select-group">
            <label className="filter-label">Sort By</label>
            <select
              className="filter-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="runtime_asc">Fastest Runtime</option>
              <option value="memory_asc">Lowest Memory</option>
              <option value="score_desc">Highest Score</option>
            </select>
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-secondary btn-sm reset-filter-btn"
              onClick={handleResetFilters}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* 5. Submissions List Table */}
      <div className="problems-table-card">
        {loading ? (
          <div className="table-skeleton-container">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="table-row-skeleton" />
            ))}
          </div>
        ) : error ? (
          <div className="explorer-error-box">
            <p>{error}</p>
            <button className="btn btn-primary btn-sm" onClick={fetchSubmissions}>
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : submissions.length === 0 ? (
          <div className="explorer-empty-box">
            <Terminal className="w-10 h-10 text-muted" />
            <h3>No submissions found</h3>
            <p>You haven't submitted any code matching the selected search and filter parameters.</p>
            {hasActiveFilters && (
              <button className="btn btn-primary btn-sm" onClick={handleResetFilters}>
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="problems-table-wrapper">
            <table className="problems-custom-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}># ID</th>
                  <th>Problem Title</th>
                  <th style={{ width: '100px' }}>Language</th>
                  <th style={{ width: '160px' }}>Verdict</th>
                  <th style={{ width: '100px' }}>Score</th>
                  <th style={{ width: '110px' }}>Runtime</th>
                  <th style={{ width: '110px' }}>Memory</th>
                  <th style={{ width: '160px' }}>Submitted At</th>
                  <th style={{ width: '140px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id} className="problem-table-row">
                    {/* ID */}
                    <td className="history-id-cell">#{sub.id}</td>

                    {/* Problem Title */}
                    <td className="cell-title">
                      <div className="problem-title-cell">
                        <span className="problem-id-tag">#{sub.problemId}</span>
                        <span className="problem-title-text">{sub.problemTitle || `Problem #${sub.problemId}`}</span>
                      </div>
                    </td>

                    {/* Language */}
                    <td className="history-lang-cell">
                      <span className="mode-pill-tag">{sub.language?.toUpperCase()}</span>
                    </td>

                    {/* Verdict */}
                    <td>{formatVerdictPill(sub.status)}</td>

                    {/* Score */}
                    <td className="history-score-cell">{sub.score || 0} pts</td>

                    {/* Runtime */}
                    <td className="history-time-cell">{sub.executionTime || 0} ms</td>

                    {/* Memory */}
                    <td className="history-mem-cell">
                      {sub.memoryUsed > 1024 ? Math.round(sub.memoryUsed / 1024) : sub.memoryUsed || 0} MB
                    </td>

                    {/* Submitted At */}
                    <td className="history-date-cell">
                      {new Date(sub.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Actions */}
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm compare-row-btn"
                        style={{ marginRight: '6px' }}
                        onClick={() =>
                          setCompareSub({
                            id: sub.id,
                            problemId: sub.problemId,
                            problemTitle: sub.problemTitle,
                          })
                        }
                        title="Compare with another submission"
                        aria-label={`Compare submission #${sub.id}`}
                      >
                        <GitCompare className="w-3.5 h-3.5 mr-1 text-blue-400" />
                        <span>Compare</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          if (onViewSubmissionDetail) {
                            onViewSubmissionDetail(sub.id);
                          } else {
                            handleInspectCode(sub.id);
                          }
                        }}
                        title="View submission details and source code"
                      >
                        <Code2 className="w-3.5 h-3.5 mr-1" />
                        <span>Details</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 6. Pagination Bar */}
        {!loading && pagination.totalPages > 1 && (
          <div className="table-pagination-bar">
            <div className="pagination-info">
              Showing{' '}
              <strong>
                {(pagination.currentPage - 1) * pagination.limit + 1}–
                {Math.min(pagination.totalSubmissions, pagination.currentPage * pagination.limit)}
              </strong>{' '}
              of <strong>{pagination.totalSubmissions}</strong> submissions
            </div>

            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-outline btn-sm page-nav-btn"
                disabled={!pagination.hasPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <div className="page-numbers-group">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter((pNum) => {
                    return (
                      pNum === 1 ||
                      pNum === pagination.totalPages ||
                      Math.abs(pNum - pagination.currentPage) <= 1
                    );
                  })
                  .map((pNum) => (
                    <button
                      key={pNum}
                      type="button"
                      className={`page-num-btn ${pagination.currentPage === pNum ? 'active' : ''}`}
                      onClick={() => setPage(pNum)}
                    >
                      {pNum}
                    </button>
                  ))}
              </div>

              <button
                type="button"
                className="btn btn-outline btn-sm page-nav-btn"
                disabled={!pagination.hasNext}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 7. Code Viewer Modal */}
      {selectedSubForModal && (
        <SubmissionCodeModal
          submission={selectedSubForModal}
          onClose={() => setSelectedSubForModal(null)}
          onOpenInEditor={onOpenProblemInEditor}
        />
      )}

      {/* Phase 5.8.5: Submission Comparison Modal */}
      {compareSub && (
        <SubmissionComparisonModal
          isOpen={Boolean(compareSub)}
          onClose={() => setCompareSub(null)}
          initialSubmissionId={compareSub.id}
          problemId={compareSub.problemId}
          problemTitle={compareSub.problemTitle}
          token={token}
        />
      )}
    </div>
  );
}
