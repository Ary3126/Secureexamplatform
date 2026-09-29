/**
 * Phase 7.5.8.3 — Admin Leaderboard Component
 * File: frontend/src/components/admin/AdminContestLeaderboard.jsx
 *
 * Implements authoritative contest standings inspection for administrators:
 * - Direct integration with GET /api/contests/:id/admin-leaderboard
 * - Server-side search, filtering (status), whitelisted sorting, and pagination
 * - Freeze override toggle allowing managers to see unmasked live results
 * - Participant performance inspection modal with problem-by-problem breakdown
 * - Responsive dark glassmorphism styling
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  RotateCw,
  Eye,
  X,
  Trophy,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  Users,
  ShieldAlert,
} from 'lucide-react';
import ParticipantResultDetailsModal from '../ParticipantResultDetailsModal';
import './adminContestLeaderboard.css';

export default function AdminContestLeaderboard({
  contestId,
  contest = null,
  currentUser = null,
  token = null,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Search & Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('rank');
  const [sortOrder, setSortOrder] = useState('ASC');
  const [page, setPage] = useState(1);
  const [freezeOverride, setFreezeOverride] = useState(true);

  // Participant Inspection Modal State
  const [inspectedParticipant, setInspectedParticipant] = useState(null);

  const debounceTimerRef = useRef(null);

  // Debounce search input
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1); // Reset to first page on search
    }, 300);
  };

  const fetchAdminLeaderboard = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams({
        page: String(page),
        limit: '50',
        search: debouncedSearch.trim(),
        sortBy,
        sortOrder,
        filterStatus,
        freezeOverride: String(freezeOverride),
      });

      const authToken = token || currentUser?.token;
      const headers = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`/api/contests/${contestId}/admin-leaderboard?${queryParams.toString()}`, {
        method: 'GET',
        headers,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || `Failed to fetch admin leaderboard (${res.status})`);
      }

      setData(json);
    } catch (err) {
      setError(err.message || 'An error occurred while loading contest standings.');
    } finally {
      setLoading(false);
    }
  }, [contestId, page, debouncedSearch, sortBy, sortOrder, filterStatus, freezeOverride, token, currentUser]);

  useEffect(() => {
    fetchAdminLeaderboard();
  }, [fetchAdminLeaderboard]);

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === 'ASC' ? 'DESC' : 'ASC'));
    setPage(1);
  };

  const getRankBadge = (rank) => {
    if (rank === 1) {
      return <span className="admin-lb-rank-badge rank-gold">🥇 1</span>;
    }
    if (rank === 2) {
      return <span className="admin-lb-rank-badge rank-silver">🥈 2</span>;
    }
    if (rank === 3) {
      return <span className="admin-lb-rank-badge rank-bronze">🥉 3</span>;
    }
    return <span className="admin-lb-rank-badge rank-standard">#{rank}</span>;
  };

  const summary = data?.contestSummary;
  const standings = data?.standings || [];
  const problems = data?.problems || [];
  const pagination = data?.pagination || {};
  const isContestFrozen = Boolean(data?.contest?.isFrozen);

  return (
    <div className="admin-lb-container">
      {/* 1. Control Toolbar */}
      <div className="admin-lb-toolbar">
        {/* Search */}
        <div className="admin-lb-search-wrap">
          <Search size={14} className="admin-lb-search-icon" />
          <input
            type="text"
            className="admin-lb-search-input"
            placeholder="Search participants..."
            value={search}
            onChange={handleSearchChange}
          />
        </div>

        {/* Filters & Sorting */}
        <div className="admin-lb-filters-wrap">
          {/* Status Filter */}
          <select
            className="admin-lb-select"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
            title="Filter by participant activity"
          >
            <option value="all">All Participants</option>
            <option value="solved_any">Solved ≥ 1 Problem</option>
            <option value="has_submissions">With Submissions</option>
            <option value="no_submissions">No Submissions</option>
          </select>

          {/* Sort By Field */}
          <select
            className="admin-lb-select"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setPage(1);
            }}
            title="Sort standings by field (Official rank preserved)"
          >
            <option value="rank">Sort by: Rank (Default)</option>
            <option value="score">Sort by: Score</option>
            <option value="solved">Sort by: Solved Problems</option>
            <option value="penalty">Sort by: Penalty Time</option>
            <option value="participant">Sort by: Name / Handle</option>
            <option value="submissions">Sort by: Submissions</option>
          </select>

          {/* Sort Order Button */}
          <button
            type="button"
            className="admin-lb-btn-sort-order"
            onClick={toggleSortOrder}
            title={`Sort Order: ${sortOrder}`}
          >
            {sortOrder === 'ASC' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            <span>{sortOrder}</span>
          </button>

          {/* Freeze Override Toggle */}
          <label className="admin-lb-freeze-toggle" title="Toggle manager unmasking of submissions during freeze window">
            <input
              type="checkbox"
              checked={freezeOverride}
              onChange={(e) => setFreezeOverride(e.target.checked)}
            />
            <span>Unmask Freeze</span>
          </label>

          {/* Refresh Button */}
          <button
            type="button"
            className="admin-lb-btn-refresh"
            onClick={fetchAdminLeaderboard}
            disabled={loading}
            title="Refresh contest standings"
          >
            <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Freeze Warning Banner if currently frozen */}
      {isContestFrozen && (
        <div
          style={{
            background: freezeOverride ? 'rgba(56, 189, 248, 0.12)' : 'rgba(168, 85, 247, 0.15)',
            border: `1px solid ${freezeOverride ? 'rgba(56, 189, 248, 0.3)' : 'rgba(168, 85, 247, 0.35)'}`,
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.8rem',
            color: freezeOverride ? '#38bdf8' : '#c084fc',
          }}
        >
          <ShieldAlert size={16} />
          <div>
            <strong>Contest is currently Frozen.</strong>{' '}
            {freezeOverride
              ? 'You are viewing LIVE UNMASKED standings (Manager Override active).'
              : 'You are viewing standard MASKED standings as visible to public students.'}
          </div>
        </div>
      )}

      {/* 2. Quick Metrics Row */}
      {summary && (
        <div className="admin-lb-metrics-grid">
          <div className="admin-lb-metric-card">
            <span className="admin-lb-metric-label">Participants</span>
            <span className="admin-lb-metric-value">{summary.totalParticipants}</span>
          </div>
          <div className="admin-lb-metric-card">
            <span className="admin-lb-metric-label">Problems</span>
            <span className="admin-lb-metric-value">{summary.totalProblems}</span>
          </div>
          <div className="admin-lb-metric-card">
            <span className="admin-lb-metric-label">Top Score</span>
            <span className="admin-lb-metric-value" style={{ color: '#38bdf8' }}>
              {summary.topScore}
            </span>
          </div>
          <div className="admin-lb-metric-card">
            <span className="admin-lb-metric-label">Avg Score</span>
            <span className="admin-lb-metric-value">{summary.averageScore}</span>
          </div>
          <div className="admin-lb-metric-card">
            <span className="admin-lb-metric-label">Median Score</span>
            <span className="admin-lb-metric-value">{summary.medianScore}</span>
          </div>
        </div>
      )}

      {/* 3. Main Standings Table */}
      {loading && !data ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
          <RotateCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto', display: 'block' }} />
          <span>Calculating authoritative contest standings...</span>
        </div>
      ) : error ? (
        <div style={{ padding: '24px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: '#f87171', textAlign: 'center' }}>
          <AlertTriangle size={24} style={{ margin: '0 auto 8px auto', display: 'block' }} />
          <div style={{ fontWeight: '600', marginBottom: '6px' }}>Failed to Load Standings</div>
          <div style={{ fontSize: '0.8rem', marginBottom: '14px' }}>{error}</div>
          <button type="button" onClick={fetchAdminLeaderboard} className="admin-lb-btn-refresh">
            Retry
          </button>
        </div>
      ) : standings.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '8px', border: '1px dashed rgba(148, 163, 184, 0.2)', color: '#94a3b8' }}>
          <Users size={32} style={{ margin: '0 auto 10px auto', opacity: 0.5 }} />
          <div style={{ fontWeight: '600', color: '#f8fafc', marginBottom: '4px' }}>No Participants Found</div>
          <div style={{ fontSize: '0.8rem' }}>
            {search || filterStatus !== 'all'
              ? 'No participants match the selected search or filter criteria.'
              : 'This contest currently has no enrolled participants.'}
          </div>
        </div>
      ) : (
        <div className="admin-lb-table-wrap">
          <table className="admin-lb-table">
            <thead>
              <tr>
                <th style={{ width: '45px', textAlign: 'center' }}>Rank</th>
                <th>Participant</th>
                <th style={{ textAlign: 'center' }}>Score</th>
                <th style={{ textAlign: 'center' }}>Solved</th>
                <th style={{ textAlign: 'center' }}>Penalty</th>
                <th style={{ textAlign: 'center' }}>Submissions</th>
                {problems.map((prob) => (
                  <th key={prob.problemId} style={{ textAlign: 'center', minWidth: '60px' }}>
                    <div>P{prob.problemOrder}</div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: '400' }}>
                      {prob.maxPoints} pts
                    </div>
                  </th>
                ))}
                <th style={{ textAlign: 'center', width: '80px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((p) => (
                <tr key={p.userId}>
                  {/* Rank */}
                  <td style={{ textAlign: 'center' }}>{getRankBadge(p.rank)}</td>

                  {/* Participant */}
                  <td>
                    <div className="admin-lb-participant-cell">
                      <div className="admin-lb-avatar">
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt={p.username} />
                        ) : (
                          (p.fullName || p.username).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="admin-lb-name-group">
                        <span className="admin-lb-fullname">{p.fullName || p.username}</span>
                        <span className="admin-lb-username">@{p.username}</span>
                      </div>
                    </div>
                  </td>

                  {/* Score */}
                  <td style={{ textAlign: 'center', fontWeight: '700', color: '#38bdf8' }}>
                    {p.totalScore}
                  </td>

                  {/* Solved */}
                  <td style={{ textAlign: 'center', fontWeight: '600' }}>
                    {p.solvedProblemsCount} / {problems.length}
                  </td>

                  {/* Penalty */}
                  <td style={{ textAlign: 'center', color: '#cbd5e1' }}>
                    {p.totalPenaltyMinutes}m
                  </td>

                  {/* Submissions */}
                  <td style={{ textAlign: 'center', color: '#94a3b8' }}>
                    {p.totalSubmissions || 0}
                  </td>

                  {/* Problem Matrix Chips */}
                  {p.problems?.map((prob) => (
                    <td key={prob.problemId} className="chip-cell">
                      {prob.status === 'solved' ? (
                        <div className="chip-solved" title={`Solved in ${prob.acceptedTimeMinutes}m (${prob.failedAttemptsBeforeSolve} incorrect prior attempts)`}>
                          <span>✓ {prob.points}</span>
                          <span style={{ fontSize: '0.62rem', opacity: 0.85 }}>+{prob.acceptedTimeMinutes}m</span>
                        </div>
                      ) : prob.status === 'failed' ? (
                        <div className="chip-failed" title={`${prob.attemptsCount} failed attempt(s)`}>
                          <span>✗</span>
                          <span style={{ fontSize: '0.62rem' }}>-{prob.attemptsCount}</span>
                        </div>
                      ) : (
                        <span className="chip-unattempted">—</span>
                      )}
                    </td>
                  ))}

                  {/* Action */}
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn-lb-inspect"
                      onClick={() => setInspectedParticipant(p)}
                      title={`Inspect ${p.fullName || p.username}'s contest performance`}
                    >
                      <Eye size={12} /> Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div className="admin-lb-pagination">
          <div>
            Showing {(pagination.currentPage - 1) * pagination.limit + 1} to{' '}
            {Math.min(pagination.currentPage * pagination.limit, pagination.totalParticipants)} of{' '}
            {pagination.totalParticipants} participants
          </div>

          <div className="admin-lb-page-controls">
            <button
              type="button"
              className="admin-lb-btn-page"
              disabled={!pagination.hasPrev || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#cbd5e1' }}>
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="admin-lb-btn-page"
              disabled={!pagination.hasNext || loading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* 5. Authoritative Participant Result Details Modal (Phase 7.5.8.4) */}
      {inspectedParticipant && (
        <ParticipantResultDetailsModal
          contestId={contestId}
          participantId={inspectedParticipant.userId}
          initialFreezeOverride={freezeOverride}
          isManager={true}
          token={token}
          onClose={() => setInspectedParticipant(null)}
        />
      )}
    </div>
  );
}
