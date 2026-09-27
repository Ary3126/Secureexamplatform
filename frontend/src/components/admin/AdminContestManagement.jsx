import React, { useState } from 'react';
import {
  Trophy,
  Search,
  Users,
  Calendar,
  Layers,
  Archive,
  Globe,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Plus,
  Shield,
  BarChart3,
  X,
  ExternalLink,
  Flame,
  Award,
  Edit3,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import AdminContestCreateModal from './AdminContestCreateModal';
import AdminContestEditModal from './AdminContestEditModal';
import './adminContestManagement.css';

/**
 * Helper to compute human-readable duration between start and end times
 */
function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return 'N/A';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 'N/A';

  const totalMinutes = Math.round((end - start) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

/**
 * Format date for high readability in localized format
 */
function formatDateTime(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Admin Contest Management — Master Discovery & Administration View (Phase 7.5.2)
 * Connects to the authoritative backend contest infrastructure with server-side search,
 * filters, sorting, pagination, and inspection.
 */
export default function AdminContestManagement({
  contests = [],
  totalContests = 0,
  page = 1,
  limit = 10,
  search = '',
  statusFilter = 'all',
  stateFilter = 'all',
  ratedFilter = 'all',
  myContestsOnly = false,
  sortBy = 'startTime',
  sortOrder = 'DESC',
  loading = false,
  isProcessing = false,
  isEditing = false,
  error = null,
  currentUser = null,
  inspectedContest = null,
  inspectLoading = false,
  onSearchChange,
  onStatusFilterChange,
  onStateFilterChange,
  onRatedFilterChange,
  onMyContestsChange,
  onSortByChange,
  onSortOrderChange,
  onPageChange,
  onLimitChange,
  onResetFilters,
  onInspectContest,
  onCloseInspect,
  onPublishContest,
  onArchiveContest,
  onUpdateContest,
  onRetry,
  onCreateContest,
  isCreating = false,
}) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // editContest holds the full contest row currently being edited (or null if closed)
  const [editContest, setEditContest] = useState(null);
  const totalPages = Math.max(Math.ceil(totalContests / limit) || 1, 1);

  /**
   * Returns true if the current user has management permissions for the given contest.
   * This mirrors the server-side canManageResource logic (UI hint only; server enforces).
   */
  const canManageContest = (c) => {
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin' || currentUser.role === 'contest_admin')
      return true;
    if (currentUser.role === 'professor' && c.createdBy === currentUser.id)
      return true;
    return false;
  };

  /**
   * Called by AdminContestEditModal when the form is submitted.
   * Forwards to onUpdateContest (provided by AdminPanel), then closes the modal on success.
   */
  const handleEditSubmit = async (contestId, payload) => {
    if (!onUpdateContest) return { success: false, error: 'Update handler not configured.' };
    const result = await onUpdateContest(contestId, payload);
    if (result && result.success) {
      setEditContest(null);
    }
    return result;
  };

  // Quick Metrics (computed from currently loaded page or total indicators)
  const runningCount = contests.filter((c) => (c.runtimeState || '').toLowerCase() === 'running').length;
  const upcomingCount = contests.filter((c) => (c.runtimeState || '').toLowerCase() === 'upcoming').length;
  const totalParticipantsAcrossPage = contests.reduce((acc, c) => acc + (c.participantCount || 0), 0);

  const getRuntimeBadge = (state) => {
    const s = (state || 'draft').toLowerCase();
    switch (s) {
      case 'running':
        return (
          <span className="badge-runtime-state badge-state-running">
            <span className="pulse-dot" /> Running Now
          </span>
        );
      case 'upcoming':
        return (
          <span className="badge-runtime-state badge-state-upcoming">
            <Clock size={11} /> Upcoming
          </span>
        );
      case 'ended':
        return (
          <span className="badge-runtime-state badge-state-ended">
            <CheckCircle2 size={11} /> Ended
          </span>
        );
      case 'draft':
        return (
          <span className="badge-runtime-state badge-state-draft">
            Draft
          </span>
        );
      case 'archived':
        return (
          <span className="badge-runtime-state badge-state-archived">
            <Archive size={11} /> Archived
          </span>
        );
      default:
        return (
          <span className="badge-runtime-state badge-state-draft">
            {state}
          </span>
        );
    }
  };

  const hasActiveFilters =
    Boolean(search) ||
    statusFilter !== 'all' ||
    stateFilter !== 'all' ||
    ratedFilter !== 'all' ||
    myContestsOnly ||
    sortBy !== 'startTime' ||
    sortOrder !== 'DESC';

  return (
    <div className="admin-contests-container">
      {/* 1. Header Area */}
      <div className="admin-contests-header">
        <div className="admin-contests-title-wrap">
          <h2>Contest & Examination Administration</h2>
          <span className="admin-contests-subtitle">
            Oversee, discover, and inspect all competitive programming contests and examinations across the institution.
          </span>
        </div>

        {currentUser?.role !== 'student' && (
          <button
            className="btn-create-contest-top"
            onClick={() => setIsCreateOpen(true)}
            style={{
              background: '#38bdf8',
              color: '#0f172a',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontWeight: '700',
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(56, 189, 248, 0.25)',
              transition: 'all 0.15s ease',
            }}
            title="Create New Contest (Draft)"
          >
            <Plus size={16} /> New Contest
          </button>
        )}
      </div>

      {/* 2. Quick Metrics Row */}
      <div className="admin-contests-metrics-grid">
        <div className="contest-metric-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            <Trophy size={20} />
          </div>
          <div>
            <div className="metric-value">{totalContests}</div>
            <div className="metric-label">Total Contests</div>
          </div>
        </div>

        <div className="contest-metric-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#34d399' }}>
            <Flame size={20} />
          </div>
          <div>
            <div className="metric-value">{runningCount}</div>
            <div className="metric-label">Running on Page</div>
          </div>
        </div>

        <div className="contest-metric-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(167, 139, 250, 0.15)', color: '#c084fc' }}>
            <Calendar size={20} />
          </div>
          <div>
            <div className="metric-value">{upcomingCount}</div>
            <div className="metric-label">Upcoming on Page</div>
          </div>
        </div>

        <div className="contest-metric-card">
          <div className="metric-icon-wrap" style={{ background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' }}>
            <Users size={20} />
          </div>
          <div>
            <div className="metric-value">{totalParticipantsAcrossPage}</div>
            <div className="metric-label">Enrolled on Page</div>
          </div>
        </div>
      </div>

      {/* 3. Runtime State Tabs */}
      <div className="admin-contests-tabs">
        <button
          className={`contest-tab-btn ${stateFilter === 'all' && statusFilter !== 'draft' && statusFilter !== 'archived' ? 'active' : ''}`}
          onClick={() => {
            onStateFilterChange && onStateFilterChange('all');
            onStatusFilterChange && onStatusFilterChange('all');
          }}
        >
          All Active
        </button>
        <button
          className={`contest-tab-btn ${stateFilter === 'running' ? 'active' : ''}`}
          onClick={() => {
            onStateFilterChange && onStateFilterChange('running');
            onStatusFilterChange && onStatusFilterChange('all');
          }}
        >
          <span className="pulse-dot" /> Live Running
        </button>
        <button
          className={`contest-tab-btn ${stateFilter === 'upcoming' ? 'active' : ''}`}
          onClick={() => {
            onStateFilterChange && onStateFilterChange('upcoming');
            onStatusFilterChange && onStatusFilterChange('all');
          }}
        >
          Upcoming
        </button>
        <button
          className={`contest-tab-btn ${stateFilter === 'ended' ? 'active' : ''}`}
          onClick={() => {
            onStateFilterChange && onStateFilterChange('ended');
            onStatusFilterChange && onStatusFilterChange('all');
          }}
        >
          Ended
        </button>
        <button
          className={`contest-tab-btn ${statusFilter === 'draft' || stateFilter === 'draft' ? 'active' : ''}`}
          onClick={() => {
            onStatusFilterChange && onStatusFilterChange('draft');
            onStateFilterChange && onStateFilterChange('all');
          }}
        >
          Drafts
        </button>
        <button
          className={`contest-tab-btn ${statusFilter === 'archived' || stateFilter === 'archived' ? 'active' : ''}`}
          onClick={() => {
            onStatusFilterChange && onStatusFilterChange('archived');
            onStateFilterChange && onStateFilterChange('all');
          }}
        >
          Archived
        </button>
      </div>

      {/* 4. Filter & Search Toolbar */}
      <div className="admin-contests-toolbar">
        <div className="contests-search-wrap">
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            className="contests-search-input"
            placeholder="Search by title, description, ID, or host..."
            value={search}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          />
          {search && (
            <button className="search-clear-btn" onClick={() => onSearchChange && onSearchChange('')} title="Clear search">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="contests-filters-row">
          {/* Status Dropdown */}
          <select
            className="contests-filter-select"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange && onStatusFilterChange(e.target.value)}
            title="Filter by status"
          >
            <option value="all">Status: All</option>
            <option value="published">Published</option>
            <option value="draft">Draft Only</option>
            <option value="archived">Archived</option>
          </select>

          {/* Rating Dropdown */}
          <select
            className="contests-filter-select"
            value={ratedFilter}
            onChange={(e) => onRatedFilterChange && onRatedFilterChange(e.target.value)}
            title="Filter by rated status"
          >
            <option value="all">Scoring: All</option>
            <option value="rated">Rated Only (Elo)</option>
            <option value="unrated">Unrated Only</option>
          </select>

          {/* Ownership Toggle (for professors/admins) */}
          {currentUser && (
            <button
              onClick={() => onMyContestsChange && onMyContestsChange(!myContestsOnly)}
              style={{
                background: myContestsOnly ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                border: myContestsOnly ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(255, 255, 255, 0.15)',
                color: myContestsOnly ? '#38bdf8' : '#cbd5e1',
                padding: '7px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                cursor: 'pointer',
                fontWeight: myContestsOnly ? '700' : '500',
              }}
              title="Show only contests created by you"
            >
              My Contests
            </button>
          )}

          {/* Sort By Dropdown */}
          <select
            className="contests-filter-select"
            value={sortBy}
            onChange={(e) => onSortByChange && onSortByChange(e.target.value)}
            title="Sort contests by"
          >
            <option value="startTime">Sort: Start Time</option>
            <option value="title">Sort: Contest Title</option>
            <option value="createdAt">Sort: Created Date</option>
            <option value="id">Sort: Contest ID</option>
          </select>

          {/* Sort Direction Toggle */}
          <button
            onClick={() => onSortOrderChange && onSortOrderChange(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
            className="btn-reset-filters"
            title="Toggle sort direction"
          >
            {sortOrder === 'ASC' ? 'Ascending ↑' : 'Descending ↓'}
          </button>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button className="btn-reset-filters" onClick={onResetFilters} title="Reset all search and filter parameters">
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* 5. Error Banner */}
      {error && (
        <div className="contests-error-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button onClick={onRetry} className="btn-table-action" style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#fff' }}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* 6. Main Contests Table */}
      <div className="contests-table-wrap">
        {loading ? (
          <AuthoringLoadingState message="Fetching contest directory from server..." />
        ) : contests.length === 0 ? (
          <div className="contests-empty-state">
            <Trophy size={42} style={{ color: '#64748b', opacity: 0.6 }} />
            <h3 className="empty-state-title">No contests found</h3>
            <p className="empty-state-desc">
              No contests match your current search or filter parameters. Try adjusting your search term or resetting the filters.
            </p>
            {hasActiveFilters ? (
              <button className="btn-reset-filters" onClick={onResetFilters} style={{ marginTop: '8px' }}>
                <RotateCcw size={13} /> Clear All Filters
              </button>
            ) : currentUser?.role !== 'student' && (
              <button
                className="btn-submit-create"
                onClick={() => setIsCreateOpen(true)}
                style={{ marginTop: '12px', display: 'inline-flex' }}
              >
                <Plus size={16} /> Create First Contest
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="contests-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Contest</th>
                  <th style={{ width: '14%' }}>Host</th>
                  <th style={{ width: '12%' }}>Timeline</th>
                  <th style={{ width: '9%' }}>Duration</th>
                  <th style={{ width: '11%' }}>Runtime State</th>
                  <th style={{ width: '8%', textAlign: 'center' }}>Problems</th>
                  <th style={{ width: '8%', textAlign: 'center' }}>Enrolled</th>
                  <th style={{ width: '10%' }}>Scoring</th>
                  <th style={{ width: '14%', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((c) => {
                  const isOwner = currentUser && c.createdBy === currentUser.id;
                  const durationStr = formatDuration(c.startTime, c.endTime);

                  return (
                    <tr key={c.id}>
                      {/* Contest Column */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: '700', color: '#f8fafc' }}>{c.title}</span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>#{c.id}</span>
                        </div>
                        {c.description && (
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: '#94a3b8',
                              marginTop: '2px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '300px',
                            }}
                          >
                            {c.description}
                          </div>
                        )}
                      </td>

                      {/* Host / Owner Column */}
                      <td>
                        <span style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>
                          {c.creatorUsername || `Professor #${c.createdBy}`}
                        </span>
                        {isOwner && <span className="badge-owner-you">You</span>}
                      </td>

                      {/* Timeline Column */}
                      <td style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                        <div>Start: {formatDateTime(c.startTime)}</div>
                        <div>End: {formatDateTime(c.endTime)}</div>
                      </td>

                      {/* Duration Column */}
                      <td style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: '600' }}>
                        {durationStr}
                      </td>

                      {/* Runtime State Column */}
                      <td>{getRuntimeBadge(c.runtimeState || c.status)}</td>

                      {/* Problems Column */}
                      <td style={{ textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: '700',
                            color: '#38bdf8',
                            background: 'rgba(56, 189, 248, 0.1)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}
                        >
                          {c.problemCount || 0}
                        </span>
                      </td>

                      {/* Participants Column */}
                      <td style={{ textAlign: 'center' }}>
                        <span
                          style={{
                            fontSize: '0.82rem',
                            fontWeight: '700',
                            color: '#4ade80',
                            background: 'rgba(34, 197, 94, 0.1)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                          }}
                        >
                          {c.participantCount || 0}
                        </span>
                      </td>

                      {/* Scoring Column */}
                      <td>
                        {c.isRated ? (
                          <span className="badge-rated">
                            <Trophy size={11} /> Rated
                          </span>
                        ) : (
                          <span className="badge-unrated">Unrated</span>
                        )}
                        {c.leaderboardFreezeEnabled && (
                          <div style={{ fontSize: '0.68rem', color: '#a78bfa', marginTop: '3px' }}>
                            Freeze: {c.leaderboardFreezeMinutes || 60}m
                          </div>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="action-buttons-group">
                          {/* Inspect / View Details Button */}
                          <button
                            onClick={() => onInspectContest && onInspectContest(c.id)}
                            className="btn-table-action btn-action-inspect"
                            title="Inspect contest details"
                          >
                            <Eye size={13} /> Inspect
                          </button>

                          {/* Edit Button (managers only) */}
                          {canManageContest(c) && onUpdateContest && (
                            <button
                              onClick={() => setEditContest(c)}
                              disabled={isProcessing || isEditing}
                              className="btn-table-action"
                              style={{
                                background: 'rgba(56, 189, 248, 0.1)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.25)',
                              }}
                              title="Edit contest metadata"
                            >
                              <Edit3 size={13} /> Edit
                            </button>
                          )}

                          {/* Leaderboard Link Button */}
                          <a
                            href={`/contests/${c.id}/leaderboard`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-table-action btn-action-leaderboard"
                            style={{ textDecoration: 'none' }}
                            title="Open contest standings leaderboard"
                          >
                            <BarChart3 size={13} />
                          </a>

                          {/* Publish Action (for Drafts) */}
                          {c.status === 'draft' && onPublishContest && (
                            <button
                              onClick={() => onPublishContest(c.id)}
                              disabled={isProcessing}
                              className="btn-table-action btn-action-publish"
                              title="Publish this contest"
                            >
                              <Globe size={13} /> Publish
                            </button>
                          )}

                          {/* Archive Action (for published/ended contests) */}
                          {c.status === 'published' && onArchiveContest && (
                            <button
                              onClick={() => onArchiveContest(c.id)}
                              disabled={isProcessing}
                              className="btn-table-action btn-action-archive"
                              title="Archive contest"
                            >
                              <Archive size={13} /> Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 7. Pagination Bar */}
        {!loading && totalContests > 0 && (
          <div className="contests-pagination-bar">
            <div className="pagination-info">
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalContests} total contests)
            </div>

            <div className="pagination-controls">
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginRight: '4px' }}>Per Page:</span>
              <select
                className="contests-filter-select"
                style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                value={limit}
                onChange={(e) => onLimitChange && onLimitChange(parseInt(e.target.value, 10))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>

              <button
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => onPageChange && onPageChange(page - 1)}
                title="Previous page"
              >
                <ChevronLeft size={14} /> Prev
              </button>

              <span className="pagination-page-indicator">
                {page} / {totalPages}
              </span>

              <button
                className="pagination-btn"
                disabled={page >= totalPages}
                onClick={() => onPageChange && onPageChange(page + 1)}
                title="Next page"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 8. Contest Inspection Drawer / Modal */}
      {inspectedContest && (
        <div className="contest-inspect-backdrop" onClick={onCloseInspect}>
          <div className="contest-inspect-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inspect-header">
              <div className="inspect-title-area">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3>{inspectedContest.title}</h3>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>#{inspectedContest.id}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  {getRuntimeBadge(inspectedContest.runtimeState || inspectedContest.status)}
                  {inspectedContest.isRated ? (
                    <span className="badge-rated"><Trophy size={11} /> Rated</span>
                  ) : (
                    <span className="badge-unrated">Unrated</span>
                  )}
                </div>
              </div>
              <button
                onClick={onCloseInspect}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                title="Close inspection"
              >
                <X size={20} />
              </button>
            </div>

            <div className="inspect-body">
              {inspectLoading ? (
                <AuthoringLoadingState message="Loading contest details..." />
              ) : (
                <>
                  {/* Overview Cards */}
                  <div>
                    <div className="inspect-section-title">Timeline & Schedule</div>
                    <div className="inspect-grid-2">
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">Start Time</div>
                        <div className="inspect-field-val">{formatDateTime(inspectedContest.startTime)}</div>
                      </div>
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">End Time</div>
                        <div className="inspect-field-val">{formatDateTime(inspectedContest.endTime)}</div>
                      </div>
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">Duration</div>
                        <div className="inspect-field-val">{formatDuration(inspectedContest.startTime, inspectedContest.endTime)}</div>
                      </div>
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">Host Creator</div>
                        <div className="inspect-field-val">{inspectedContest.creatorUsername || `User #${inspectedContest.createdBy}`}</div>
                      </div>
                    </div>
                  </div>

                  {/* Configuration & Rules */}
                  <div>
                    <div className="inspect-section-title">Configuration & Rules</div>
                    <div className="inspect-grid-2">
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">Leaderboard Freeze</div>
                        <div className="inspect-field-val">
                          {inspectedContest.leaderboardFreezeEnabled ? `Enabled (${inspectedContest.leaderboardFreezeMinutes || 60} mins before end)` : 'Disabled (Live all time)'}
                        </div>
                      </div>
                      <div className="inspect-field-card">
                        <div className="inspect-field-label">Rating Status</div>
                        <div className="inspect-field-val">
                          {inspectedContest.isRatingFinalized ? 'Ratings Finalized' : 'Pending Finalization'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  {inspectedContest.description && (
                    <div>
                      <div className="inspect-section-title">Description</div>
                      <div
                        style={{
                          background: 'rgba(30, 41, 59, 0.5)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          fontSize: '0.85rem',
                          color: '#cbd5e1',
                          lineHeight: '1.5',
                        }}
                      >
                        {inspectedContest.description}
                      </div>
                    </div>
                  )}

                  {/* Attached Problems List */}
                  <div>
                    <div className="inspect-section-title">
                      Attached Problems ({inspectedContest.problems?.length || 0})
                    </div>
                    {(!inspectedContest.problems || inspectedContest.problems.length === 0) ? (
                      <div style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic' }}>
                        No problems attached to this contest yet.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {inspectedContest.problems.map((p, idx) => (
                          <div
                            key={p.problemId || p.id}
                            style={{
                              background: 'rgba(30, 41, 59, 0.6)',
                              border: '1px solid rgba(255, 255, 255, 0.06)',
                              borderRadius: '8px',
                              padding: '10px 14px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: '700', color: '#f8fafc', marginRight: '8px' }}>
                                #{p.problemOrder || idx + 1}. {p.title}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'capitalize' }}>
                                ({p.difficulty || 'medium'}, {p.codingMode || 'full_program'})
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: '0.8rem',
                                fontWeight: '700',
                                color: '#38bdf8',
                                background: 'rgba(56, 189, 248, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                              }}
                            >
                              {p.points || 100} pts
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="inspect-footer">
              <a
                href={`/contests/${inspectedContest.id}/leaderboard`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-table-action btn-action-leaderboard"
                style={{ textDecoration: 'none', padding: '6px 14px' }}
              >
                <BarChart3 size={14} /> Open Standings
              </a>

              <button
                onClick={onCloseInspect}
                className="pagination-btn"
                style={{ padding: '6px 16px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Edit Contest Modal (Phase 7.5.4) */}
      <AdminContestEditModal
        isOpen={Boolean(editContest)}
        onClose={() => setEditContest(null)}
        onUpdate={handleEditSubmit}
        isSubmitting={isEditing}
        contest={editContest}
        currentUser={currentUser}
      />

      {/* 10. Create Contest Modal (Phase 7.5.3) */}
      <AdminContestCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={async (payload) => {
          if (onCreateContest) {
            const res = await onCreateContest(payload);
            if (res && res.success) {
              setIsCreateOpen(false);
            }
            return res;
          }
        }}
        isSubmitting={isCreating}
        currentUser={currentUser}
      />
    </div>
  );
}
