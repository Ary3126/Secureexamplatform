import React, { useState, useEffect, useCallback } from 'react';
import './adminDashboard.css';
import {
  Users,
  GraduationCap,
  Code2,
  Trophy,
  Activity,
  Inbox,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Server,
  Database,
  Cpu,
  Clock,
  ShieldCheck,
  Calendar,
} from 'lucide-react';

/**
 * Format relative timestamp (e.g. '2 mins ago', '1 hour ago')
 */
function formatRelativeTime(isoString) {
  if (!isoString) return 'Just now';
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return 'Recently';
  }
}

/**
 * Format seconds into human readable duration (e.g. '2h 15m')
 */
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Clean badge class and label for audit action types
 */
function getActionBadge(action) {
  if (!action) return { label: 'ACTION', className: 'action-auth' };
  if (action.includes('CREATED') || action.includes('ADDED')) {
    return { label: action.replace('_', ' '), className: 'action-created' };
  }
  if (action.includes('STATUS') || action.includes('ROLE') || action.includes('DEACTIVATED')) {
    return { label: action.replace('_', ' '), className: 'action-status' };
  }
  if (action.includes('DENIED') || action.includes('FAILURE') || action.includes('LOCKED')) {
    return { label: action.replace('_', ' '), className: 'action-security' };
  }
  return { label: action.replace('_', ' '), className: 'action-auth' };
}

/**
 * Super Admin Phase 2 Dashboard Component
 * Renders real-time aggregated metrics, contest summaries, problem/review queues,
 * audit activity timeline, and subsystem health indicators from /api/admin/overview-stats.
 */
export default function AdminDashboard({
  token,
  onNavigateSection = () => {},
}) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchOverviewStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/admin/overview-stats', { headers });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Session expired. Please log in again.');
        if (res.status === 403) throw new Error('Access denied. Super Admin privileges required.');
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const json = await res.json();
      if (json.status === 'success' && json.data) {
        setData(json.data);
        setLastUpdated(new Date());
      } else {
        throw new Error(json.message || 'Failed to parse platform metrics');
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred while loading dashboard metrics.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOverviewStats();
  }, [fetchOverviewStats]);

  const users = data?.users || {};
  const contests = data?.contests || {};
  const recentContests = data?.recentContests || [];
  const problems = data?.problems || {};
  const reviews = data?.reviews || {};
  const recentActivity = data?.recentActivity || [];
  const system = data?.system || {};

  return (
    <div className="admin-dashboard-container" data-testid="admin-dashboard">
      {/* 1. Header Bar */}
      <div className="admin-dash-header">
        <div className="admin-dash-header-left">
          <h1>Platform Dashboard</h1>
          <p>Real-time platform overview, operational metrics, and telemetry.</p>
        </div>
        <div className="admin-dash-header-right">
          {lastUpdated && (
            <span className="admin-last-updated">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchOverviewStats}
            disabled={isLoading}
            className="admin-refresh-btn"
            title="Refresh dashboard metrics"
            data-testid="admin-refresh-btn"
          >
            <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
            <span>{isLoading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* 2. Error State */}
      {error && (
        <div className="admin-error-banner" data-testid="admin-error-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <button onClick={fetchOverviewStats} className="admin-error-retry-btn">
            Retry
          </button>
        </div>
      )}

      {/* 3. Overview Statistics Cards */}
      <div className="admin-stats-grid" data-testid="admin-stats-grid">
        {/* Total Students */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Total Students</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-blue">
              <Users size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (users.total_students ?? 0)}
          </div>
          <span className="admin-stat-subtext">Active registered candidates</span>
        </div>

        {/* Total Professors */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Total Professors</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-purple">
              <GraduationCap size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (users.total_professors ?? 0)}
          </div>
          <span className="admin-stat-subtext">Faculty & exam authors</span>
        </div>

        {/* Total Problems */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Total Problems</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-emerald">
              <Code2 size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (problems.total_problems ?? 0)}
          </div>
          <span className="admin-stat-subtext">
            {problems.published_problems ?? 0} published across bank
          </span>
        </div>

        {/* Total Contests */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Total Contests</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-amber">
              <Trophy size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (contests.total_contests ?? 0)}
          </div>
          <span className="admin-stat-subtext">
            {contests.draft_contests ?? 0} draft / scheduled
          </span>
        </div>

        {/* Active Contests */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Active Contests</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-cyan">
              <Activity size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (contests.active_contests ?? 0)}
          </div>
          <span className="admin-stat-subtext">Currently ongoing exams</span>
        </div>

        {/* Pending Reviews */}
        <div className="admin-stat-card">
          <div className="admin-stat-card-top">
            <span className="admin-stat-label">Pending Reviews</span>
            <div className="admin-stat-icon-wrap admin-stat-icon-rose">
              <Inbox size={18} />
            </div>
          </div>
          <div className="admin-stat-value">
            {isLoading ? <div className="admin-skeleton" style={{ height: '32px', width: '60px' }} /> : (reviews.pending_reviews ?? 0)}
          </div>
          <span className="admin-stat-subtext">Problems awaiting faculty review</span>
        </div>
      </div>

      {/* 4. Main Two-Column Row: Contests & Problems */}
      <div className="admin-dash-grid-2col">
        {/* Contest Overview */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Trophy size={18} color="#f59e0b" />
              <h2>Contest Overview</h2>
            </div>
            <button
              onClick={() => onNavigateSection('contests', '/admin/contests')}
              className="admin-card-link-btn"
            >
              View Contests <ArrowRight size={13} />
            </button>
          </div>

          <div className="admin-card-body">
            {isLoading ? (
              <div className="admin-skeleton skeleton-section-card" />
            ) : recentContests.length === 0 ? (
              <div className="admin-empty-state">
                <Calendar size={28} color="#64748b" />
                <p>No active or scheduled contests found.</p>
              </div>
            ) : (
              <div className="admin-contest-list">
                {recentContests.map((c) => {
                  const runtime = c.runtimeState || 'draft';
                  const badgeClass =
                    runtime === 'running'
                      ? 'badge-running'
                      : runtime === 'upcoming'
                      ? 'badge-upcoming'
                      : runtime === 'ended'
                      ? 'badge-ended'
                      : 'badge-draft';

                  return (
                    <div key={c.id} className="admin-contest-item">
                      <div className="admin-contest-info">
                        <span className="admin-contest-title">{c.title}</span>
                        <div className="admin-contest-meta">
                          <span>{c.participantCount} participant{c.participantCount === 1 ? '' : 's'}</span>
                          {c.startTime && (
                            <span>{new Date(c.startTime).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <div className="admin-contest-badges">
                        <span className={`admin-runtime-badge ${badgeClass}`}>
                          {runtime}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Problem & Review Overview */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Code2 size={18} color="#34d399" />
              <h2>Problem & Review Overview</h2>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => onNavigateSection('problems', '/admin/problems')}
                className="admin-card-link-btn"
              >
                Problems <ArrowRight size={13} />
              </button>
              <button
                onClick={() => onNavigateSection('reviews', '/admin/reviews')}
                className="admin-card-link-btn"
              >
                Reviews <ArrowRight size={13} />
              </button>
            </div>
          </div>

          <div className="admin-card-body">
            {isLoading ? (
              <div className="admin-skeleton skeleton-section-card" />
            ) : (
              <>
                <div className="admin-problem-matrix">
                  <div className="admin-matrix-box">
                    <span className="admin-matrix-box-label">
                      <span className="health-dot dot-healthy" /> Published
                    </span>
                    <span className="admin-matrix-box-value">
                      {problems.published_problems ?? 0}
                    </span>
                  </div>
                  <div className="admin-matrix-box">
                    <span className="admin-matrix-box-label">
                      <span className="health-dot dot-degraded" /> Draft Problems
                    </span>
                    <span className="admin-matrix-box-value">
                      {problems.draft_problems ?? 0}
                    </span>
                  </div>
                  <div className="admin-matrix-box">
                    <span className="admin-matrix-box-label">
                      Pending Reviews
                    </span>
                    <span className="admin-matrix-box-value" style={{ color: '#fbbf24' }}>
                      {reviews.pending_reviews ?? 0}
                    </span>
                  </div>
                  <div className="admin-matrix-box">
                    <span className="admin-matrix-box-label">
                      Approved Reviews
                    </span>
                    <span className="admin-matrix-box-value" style={{ color: '#34d399' }}>
                      {reviews.approved_reviews ?? 0}
                    </span>
                  </div>
                </div>

                <div className="admin-review-summary-box">
                  <div className="admin-review-summary-info">
                    <h4>Review Queue Health</h4>
                    <p>Total items currently managed in faculty review queue</p>
                  </div>
                  <span className="admin-review-pill">
                    {reviews.total_queue ?? 0} Total in Queue
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 5. Second Two-Column Row: Recent Activity & System Health */}
      <div className="admin-dash-grid-2col">
        {/* Recent Activity */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <ShieldCheck size={18} color="#38bdf8" />
              <h2>Recent Administrative Activity</h2>
            </div>
          </div>

          <div className="admin-card-body">
            {isLoading ? (
              <div className="admin-skeleton skeleton-section-card" />
            ) : recentActivity.length === 0 ? (
              <div className="admin-empty-state">
                <ShieldCheck size={28} color="#64748b" />
                <p>No recent audit logs available.</p>
              </div>
            ) : (
              <div className="admin-activity-list">
                {recentActivity.slice(0, 7).map((act) => {
                  const badge = getActionBadge(act.action);
                  return (
                    <div key={act.id} className="admin-activity-item">
                      <div className="admin-activity-main">
                        <span className={`admin-action-tag ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="admin-activity-desc">
                          <span className="admin-activity-actor">
                            {act.actor_name || 'System'}
                          </span>
                          {' '}&bull; {act.resource_type} #{act.resource_id}
                        </span>
                      </div>
                      <span className="admin-activity-time">
                        {formatRelativeTime(act.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Basic System Health */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title-group">
              <Server size={18} color="#10b981" />
              <h2>Basic System Health</h2>
            </div>
          </div>

          <div className="admin-card-body">
            {isLoading ? (
              <div className="admin-skeleton skeleton-section-card" />
            ) : (
              <div className="admin-health-list">
                {/* API Status */}
                <div className="admin-health-item">
                  <div className="admin-health-subsys">
                    <span className="health-dot dot-healthy" />
                    <div>
                      <div className="admin-health-name">Backend API Gateway</div>
                      <div className="admin-health-meta">Express &bull; Node {system.nodeVersion || 'v24'}</div>
                    </div>
                  </div>
                  <span className="admin-health-status-badge" style={{ color: '#34d399' }}>
                    Healthy
                  </span>
                </div>

                {/* Database Status */}
                <div className="admin-health-item">
                  <div className="admin-health-subsys">
                    <span className={`health-dot ${system.databaseStatus === 'connected' ? 'dot-healthy' : 'dot-unhealthy'}`} />
                    <div>
                      <div className="admin-health-name">PostgreSQL Database</div>
                      <div className="admin-health-meta">
                        {system.databaseLatencyMs ? `${system.databaseLatencyMs}ms query latency` : 'Active connection pool'}
                      </div>
                    </div>
                  </div>
                  <span
                    className="admin-health-status-badge"
                    style={{ color: system.databaseStatus === 'connected' ? '#34d399' : '#f87171' }}
                  >
                    {system.databaseStatus === 'connected' ? 'Connected' : 'Degraded'}
                  </span>
                </div>

                {/* Judge Sandbox Status */}
                <div className="admin-health-item">
                  <div className="admin-health-subsys">
                    <span
                      className={`health-dot ${
                        system.judgeStatus === 'HEALTHY'
                          ? 'dot-healthy'
                          : system.judgeStatus === 'DEGRADED'
                          ? 'dot-degraded'
                          : 'dot-unhealthy'
                      }`}
                    />
                    <div>
                      <div className="admin-health-name">Judge Sandbox & Compilers</div>
                      <div className="admin-health-meta">
                        {system.judgeMessage || 'Compilers available'}
                      </div>
                    </div>
                  </div>
                  <span
                    className="admin-health-status-badge"
                    style={{
                      color:
                        system.judgeStatus === 'HEALTHY'
                          ? '#34d399'
                          : system.judgeStatus === 'DEGRADED'
                          ? '#fbbf24'
                          : '#f87171',
                    }}
                  >
                    {system.judgeStatus || 'Healthy'}
                  </span>
                </div>

                {/* Uptime and Env */}
                <div className="admin-uptime-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Clock size={13} />
                    <span>Uptime: {formatUptime(system.uptimeSeconds)}</span>
                  </div>
                  <span>Environment: {system.environment || 'development'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
