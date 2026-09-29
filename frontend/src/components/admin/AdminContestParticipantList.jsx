import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Search,
  RotateCcw,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trophy,
  Mail,
  Building,
  Calendar,
  Eye,
  Shield,
  Clock,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Format timestamp into human-readable localized string
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
 * Helper to compute relative time from now
 */
function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Rating badge color helper
 */
function getRatingColor(rating) {
  if (!rating || rating < 1200) return '#94a3b8'; // Newbie / Gray
  if (rating < 1400) return '#4ade80'; // Pupil / Green
  if (rating < 1600) return '#38bdf8'; // Specialist / Cyan
  if (rating < 1900) return '#818cf8'; // Expert / Blue
  if (rating < 2100) return '#c084fc'; // Candidate Master / Purple
  return '#f87171'; // Master+ / Red
}

/**
 * AdminContestParticipantList — Phase 7.5.7.2
 *
 * Dedicated administrative discovery view for contest participants:
 * - Server-side search by username, full name, email, institution
 * - Server-side pagination with configurable page navigation
 * - Sortable columns with deterministic secondary tie-breaker
 * - Safe participant detail inspection modal (read-only, no mutation)
 * - Error boundary handling with retry and unauthorized detection
 */
export default function AdminContestParticipantList({
  contestId,
  contest,
  currentUser,
  token,
  onClose,
  onRefreshParent,
}) {
  const [participants, setParticipants] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [sortBy, setSortBy] = useState('joinedAt');
  const [sortOrder, setSortOrder] = useState('ASC');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Participant detail inspection modal state
  const [inspectedParticipant, setInspectedParticipant] = useState(null);

  const searchDebounceRef = useRef(null);

  /**
   * Fetch participants from authoritative backend endpoint
   */
  const fetchParticipants = useCallback(async () => {
    if (!contestId) return;

    setLoading(true);
    setError(null);

    try {
      const authToken = token || currentUser?.token;
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sortBy,
        sortOrder,
      });

      if (activeSearch.trim()) {
        params.set('search', activeSearch.trim());
      }

      const res = await fetch(`/api/contests/${contestId}/participants?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Forbidden: You do not have permission to view participants for this contest.');
        }
        if (res.status === 401) {
          throw new Error('Unauthorized: Session expired. Please log in again.');
        }
        if (res.status === 404) {
          throw new Error('Contest not found.');
        }
        throw new Error(data.message || `Failed to fetch participants (HTTP ${res.status})`);
      }

      setParticipants(data.participants || []);
      setTotal(data.total !== undefined ? data.total : data.participantCount || 0);
      setPage(data.page || 1);
      setLimit(data.limit || 20);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred while loading participants.');
    } finally {
      setLoading(false);
    }
  }, [contestId, page, limit, activeSearch, sortBy, sortOrder, token, currentUser]);

  // Initial and reactive fetch
  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Debounced search input handler
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setActiveSearch(val);
      setPage(1); // Reset to page 1 on new search
    }, 350);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    setPage(1);
  };

  const handleSortToggle = (col) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(col);
      setSortOrder('ASC');
    }
    setPage(1);
  };

  const getSortIcon = (col) => {
    if (sortBy !== col) return <ArrowUpDown size={12} style={{ opacity: 0.4 }} />;
    return sortOrder === 'ASC' ? <ArrowUp size={12} color="#38bdf8" /> : <ArrowDown size={12} color="#38bdf8" />;
  };

  return (
    <div className="admin-participant-discovery" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header bar: Title, Total Badge, Search, Refresh */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: 'rgba(56, 189, 248, 0.1)',
              color: '#38bdf8',
            }}
          >
            <Users size={18} />
          </div>
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#f8fafc' }}>
              Enrolled Participants
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Discovery & inspection for Contest #{contestId}
            </div>
          </div>
          <span
            style={{
              marginLeft: '8px',
              fontSize: '0.78rem',
              fontWeight: '700',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(34, 197, 94, 0.12)',
              color: '#4ade80',
              border: '1px solid rgba(34, 197, 94, 0.25)',
            }}
          >
            {total} Total
          </span>
        </div>

        {/* Search bar & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1', maxWidth: '420px', justifyContent: 'flex-end' }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              maxWidth: '300px',
            }}
          >
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                color: '#64748b',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Search by name, username, email..."
              value={searchQuery}
              onChange={handleSearchChange}
              style={{
                width: '100%',
                padding: '6px 30px 6px 30px',
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '2px',
                }}
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={fetchParticipants}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '6px',
              color: '#94a3b8',
              fontSize: '0.8rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Refresh participant roster"
          >
            <RotateCcw size={13} className={loading ? 'animate-spin' : ''} />
            <span style={{ display: 'none', md: 'inline' }}>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Loading, Error, Empty, or Table */}
      {loading ? (
        <div style={{ padding: '40px 0' }}>
          <AuthoringLoadingState message="Loading contest participants..." />
        </div>
      ) : error ? (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <AlertTriangle size={32} color="#f87171" style={{ margin: '0 auto 10px auto' }} />
          <div style={{ color: '#f87171', fontWeight: '700', fontSize: '0.95rem', marginBottom: '6px' }}>
            Failed to Load Participants
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '0.82rem', maxWidth: '500px', margin: '0 auto 16px auto' }}>
            {error}
          </div>
          <button
            type="button"
            onClick={fetchParticipants}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={13} /> Retry
          </button>
        </div>
      ) : participants.length === 0 ? (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.4)',
            border: '1px dashed rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '36px 20px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'rgba(100, 116, 139, 0.1)',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px auto',
            }}
          >
            <Users size={22} />
          </div>
          <div style={{ fontWeight: '700', color: '#f8fafc', fontSize: '0.95rem', marginBottom: '4px' }}>
            {activeSearch ? 'No Participants Found' : 'No Enrolled Participants'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', maxWidth: '420px', margin: '0 auto' }}>
            {activeSearch
              ? `No registered participants match "${activeSearch}". Try adjusting or clearing your search.`
              : 'No students have joined or been registered for this contest yet.'}
          </div>
          {activeSearch && (
            <button
              type="button"
              onClick={handleClearSearch}
              style={{
                marginTop: '12px',
                padding: '4px 12px',
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                color: '#38bdf8',
                borderRadius: '6px',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              Clear Search Filter
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Participant Table */}
          <div
            style={{
              overflowX: 'auto',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(15, 23, 42, 0.5)',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                textAlign: 'left',
                fontSize: '0.82rem',
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'rgba(30, 41, 59, 0.6)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    fontSize: '0.7rem',
                    letterSpacing: '0.04em',
                  }}
                >
                  <th
                    style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortToggle('username')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      Participant {getSortIcon('username')}
                    </div>
                  </th>
                  <th
                    style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortToggle('fullName')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      Full Name {getSortIcon('fullName')}
                    </div>
                  </th>
                  <th style={{ padding: '10px 14px' }}>Email</th>
                  <th style={{ padding: '10px 14px' }}>Institution</th>
                  <th
                    style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortToggle('currentRating')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      Rating {getSortIcon('currentRating')}
                    </div>
                  </th>
                  <th
                    style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSortToggle('joinedAt')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      Joined {getSortIcon('joinedAt')}
                    </div>
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, idx) => {
                  const ratingColor = getRatingColor(p.currentRating);
                  return (
                    <tr
                      key={p.userId || idx}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Participant / Username Column */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                              fontWeight: '700',
                              fontSize: '0.72rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {(p.username || '?')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600', color: '#f8fafc' }}>
                              {p.username}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                              ID #{p.userId}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Full Name */}
                      <td style={{ padding: '10px 14px', color: '#cbd5e1' }}>
                        {p.fullName || '—'}
                      </td>

                      {/* Email */}
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {p.email || '—'}
                      </td>

                      {/* Institution */}
                      <td style={{ padding: '10px 14px', color: '#cbd5e1' }}>
                        {p.institution ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Building size={12} color="#64748b" />
                            <span>{p.institution}</span>
                          </div>
                        ) : (
                          <span style={{ color: '#64748b' }}>—</span>
                        )}
                      </td>

                      {/* Rating Column */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontWeight: '700',
                              color: ratingColor,
                              fontSize: '0.85rem',
                            }}
                          >
                            {p.currentRating || 1200}
                          </span>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: p.ratingStatus === 'rated' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                              color: p.ratingStatus === 'rated' ? '#4ade80' : '#facc15',
                              border: `1px solid ${p.ratingStatus === 'rated' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(234, 179, 8, 0.25)'}`,
                              textTransform: 'uppercase',
                            }}
                          >
                            {p.ratingStatus || 'prov'}
                          </span>
                        </div>
                      </td>

                      {/* Joined At Column */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ color: '#f8fafc', fontSize: '0.8rem' }}>
                          {formatDateTime(p.joinedAt)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                          {formatRelativeTime(p.joinedAt)}
                        </div>
                      </td>

                      {/* Inspect Action */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setInspectedParticipant(p)}
                          style={{
                            padding: '4px 8px',
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            borderRadius: '4px',
                            color: '#38bdf8',
                            fontSize: '0.72rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease',
                          }}
                          title="Inspect participant details"
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '8px 4px',
              fontSize: '0.78rem',
              color: '#94a3b8',
            }}
          >
            <div>
              Showing{' '}
              <strong style={{ color: '#f8fafc' }}>
                {total === 0 ? 0 : (page - 1) * limit + 1}
              </strong>{' '}
              to{' '}
              <strong style={{ color: '#f8fafc' }}>
                {Math.min(page * limit, total)}
              </strong>{' '}
              of <strong style={{ color: '#f8fafc' }}>{total}</strong> participants
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  color: page <= 1 ? '#475569' : '#f8fafc',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                <ChevronLeft size={13} /> Prev
              </button>

              <span style={{ padding: '0 8px', color: '#cbd5e1' }}>
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  color: page >= totalPages ? '#475569' : '#f8fafc',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Participant Safe Details Modal (Section 14: Read-Only, No Mutation) */}
      {inspectedParticipant && (
        <div
          className="contest-inspect-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '20px',
          }}
          onClick={() => setInspectedParticipant(null)}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '460px',
              padding: '20px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                paddingBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} color="#38bdf8" />
                <div style={{ fontWeight: '700', fontSize: '1rem', color: '#f8fafc' }}>
                  Participant Details
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedParticipant(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                }}
                title="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  User ID
                </div>
                <div style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.85rem' }}>
                  #{inspectedParticipant.userId}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Username
                </div>
                <div style={{ fontWeight: '600', color: '#38bdf8', fontSize: '0.85rem' }}>
                  @{inspectedParticipant.username}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  gridColumn: 'span 2',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Full Name
                </div>
                <div style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.85rem' }}>
                  {inspectedParticipant.fullName || '—'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  gridColumn: 'span 2',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Email Address
                </div>
                <div style={{ fontWeight: '500', color: '#cbd5e1', fontSize: '0.82rem' }}>
                  {inspectedParticipant.email || '—'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Current Rating
                </div>
                <div
                  style={{
                    fontWeight: '700',
                    fontSize: '0.95rem',
                    color: getRatingColor(inspectedParticipant.currentRating),
                  }}
                >
                  {inspectedParticipant.currentRating || 1200} ({inspectedParticipant.ratingStatus || 'prov'})
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Peak Rating
                </div>
                <div
                  style={{
                    fontWeight: '700',
                    fontSize: '0.95rem',
                    color: getRatingColor(inspectedParticipant.highestRating || inspectedParticipant.currentRating),
                  }}
                >
                  {inspectedParticipant.highestRating || inspectedParticipant.currentRating || 1200}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  gridColumn: 'span 2',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Institution / Affiliation
                </div>
                <div style={{ fontWeight: '500', color: '#cbd5e1', fontSize: '0.82rem' }}>
                  {inspectedParticipant.institution || 'None specified'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  gridColumn: 'span 2',
                }}
              >
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Registration Timestamp
                </div>
                <div style={{ fontWeight: '500', color: '#f8fafc', fontSize: '0.82rem' }}>
                  {formatDateTime(inspectedParticipant.joinedAt)} ({formatRelativeTime(inspectedParticipant.joinedAt)})
                </div>
              </div>
            </div>

            {/* Read-Only Notice */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'rgba(56, 189, 248, 0.06)',
                border: '1px solid rgba(56, 189, 248, 0.18)',
                color: '#38bdf8',
                fontSize: '0.75rem',
              }}
            >
              <Shield size={14} style={{ flexShrink: 0 }} />
              <span>
                <strong>Read-Only Inspection:</strong> Participant status and manual modifications are managed in later governance phases.
              </span>
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button
                type="button"
                onClick={() => setInspectedParticipant(null)}
                style={{
                  padding: '6px 16px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#f8fafc',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
