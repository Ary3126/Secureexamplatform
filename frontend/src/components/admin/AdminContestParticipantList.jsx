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
  UserPlus,
  UserMinus,
  CheckCircle,
  Loader2,
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

  // Phase 7.5.7.4: Manual Participant Management State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [candidateStudents, setCandidateStudents] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [addModalError, setAddModalError] = useState(null);

  const [participantToRemove, setParticipantToRemove] = useState(null);
  const [isRemovingParticipant, setIsRemovingParticipant] = useState(false);
  const [removeModalError, setRemoveModalError] = useState(null);

  const [actionNotification, setActionNotification] = useState(null);

  const searchDebounceRef = useRef(null);
  const candidateDebounceRef = useRef(null);

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

  // Contest Runtime State & RBAC authorization
  const getContestRuntimeState = (c) => {
    if (!c) return 'unknown';
    if (c.runtimeState) return c.runtimeState;
    if (c.runtime_state) return c.runtime_state;
    if (c.status === 'archived') return 'archived';
    const now = Date.now();
    const end = new Date(c.endTime || c.end_time).getTime();
    const start = new Date(c.startTime || c.start_time).getTime();
    if (end && !isNaN(end) && now > end) return 'ended';
    if (start && !isNaN(start) && now >= start) return 'running';
    return c.status || 'draft';
  };

  const runtimeState = getContestRuntimeState(contest);
  const isLifecycleLocked = runtimeState === 'ended' || runtimeState === 'archived' || contest?.status === 'archived';

  const canManage = Boolean(
    currentUser && (
      currentUser.role === 'super_admin' ||
      currentUser.role === 'contest_admin' ||
      (currentUser.role === 'professor' && (
        contest?.createdBy === currentUser.id ||
        contest?.created_by === currentUser.id ||
        contest?.authorId === currentUser.id
      ))
    )
  );

  const fetchCandidateStudents = useCallback(async (query = '') => {
    if (!contestId) return;
    setLoadingCandidates(true);
    setAddModalError(null);
    try {
      const authToken = token || currentUser?.token;
      const params = new URLSearchParams();
      if (query && query.trim()) {
        params.set('search', query.trim());
      }
      params.set('limit', '10');

      const res = await fetch(`/api/contests/${contestId}/search-students?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to search candidate students');
      }

      setCandidateStudents(data.students || []);
    } catch (err) {
      setAddModalError(err.message || 'Failed to search candidate students');
    } finally {
      setLoadingCandidates(false);
    }
  }, [contestId, token, currentUser]);

  const handleOpenAddModal = () => {
    setIsAddModalOpen(true);
    setCandidateSearchQuery('');
    setSelectedCandidate(null);
    setAddModalError(null);
    fetchCandidateStudents('');
  };

  const handleCandidateSearchChange = (e) => {
    const val = e.target.value;
    setCandidateSearchQuery(val);
    if (candidateDebounceRef.current) {
      clearTimeout(candidateDebounceRef.current);
    }
    candidateDebounceRef.current = setTimeout(() => {
      fetchCandidateStudents(val);
    }, 300);
  };

  const handleAddParticipant = async () => {
    if (!selectedCandidate || !contestId || isAddingParticipant) return;
    setIsAddingParticipant(true);
    setAddModalError(null);

    try {
      const authToken = token || currentUser?.token;
      const res = await fetch(`/api/contests/${contestId}/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ userId: selectedCandidate.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `Failed to add participant (HTTP ${res.status})`);
      }

      setActionNotification({
        type: 'success',
        message: `Successfully enrolled @${data.participant?.username || selectedCandidate.username} in Contest #${contestId}!`,
      });

      setIsAddModalOpen(false);
      setSelectedCandidate(null);
      setCandidateSearchQuery('');
      fetchParticipants();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      setAddModalError(err.message || 'Failed to add participant');
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleRemoveParticipant = async () => {
    if (!participantToRemove || !contestId || isRemovingParticipant) return;
    setIsRemovingParticipant(true);
    setRemoveModalError(null);

    try {
      const authToken = token || currentUser?.token;
      const res = await fetch(`/api/contests/${contestId}/participants/${participantToRemove.userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `Failed to remove participant (HTTP ${res.status})`);
      }

      setActionNotification({
        type: 'success',
        message: `Participant @${participantToRemove.username} was removed from the contest.`,
      });

      setParticipantToRemove(null);
      fetchParticipants();
      if (onRefreshParent) onRefreshParent();
    } catch (err) {
      setRemoveModalError(err.message || 'Failed to remove participant');
    } finally {
      setIsRemovingParticipant(false);
    }
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

          {canManage && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              disabled={isLifecycleLocked}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                background: isLifecycleLocked ? 'rgba(51, 65, 85, 0.4)' : '#2563eb',
                color: isLifecycleLocked ? '#94a3b8' : '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: isLifecycleLocked ? 'not-allowed' : 'pointer',
                opacity: isLifecycleLocked ? 0.6 : 1,
                transition: 'all 0.15s ease',
              }}
              title={isLifecycleLocked ? `Cannot add participants to ${runtimeState} contest` : 'Add participant manually'}
            >
              <UserPlus size={14} />
              <span>Add Participant</span>
            </button>
          )}
        </div>
      </div>

      {/* Lifecycle lock warning banner */}
      {isLifecycleLocked && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            borderRadius: '6px',
            background: 'rgba(234, 179, 8, 0.08)',
            border: '1px solid rgba(234, 179, 8, 0.25)',
            color: '#facc15',
            fontSize: '0.78rem',
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>
            <strong>Contest {runtimeState === 'archived' ? 'Archived' : 'Ended'}:</strong> Participant enrollment and removal are closed. Historical records are strictly immutable.
          </span>
        </div>
      )}

      {/* Action Notification Banner */}
      {actionNotification && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderRadius: '6px',
            background: actionNotification.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.12)',
            border: `1px solid ${actionNotification.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
            color: actionNotification.type === 'error' ? '#f87171' : '#4ade80',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {actionNotification.type === 'error' ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
            <span>{actionNotification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotification(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

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
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Actions</th>
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

                      {/* Action Buttons: Inspect & Remove */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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

                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setParticipantToRemove(p);
                                setRemoveModalError(null);
                              }}
                              disabled={isLifecycleLocked}
                              style={{
                                padding: '4px 8px',
                                background: isLifecycleLocked ? 'rgba(51, 65, 85, 0.2)' : 'rgba(239, 68, 68, 0.1)',
                                border: `1px solid ${isLifecycleLocked ? 'rgba(255, 255, 255, 0.08)' : 'rgba(239, 68, 68, 0.25)'}`,
                                borderRadius: '4px',
                                color: isLifecycleLocked ? '#64748b' : '#f87171',
                                fontSize: '0.72rem',
                                fontWeight: '600',
                                cursor: isLifecycleLocked ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                opacity: isLifecycleLocked ? 0.5 : 1,
                                transition: 'all 0.15s ease',
                              }}
                              title={isLifecycleLocked ? `Cannot remove participant from ${runtimeState} contest` : `Remove @${p.username}`}
                            >
                              <UserMinus size={12} /> Remove
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

      {/* Add Participant Modal (Phase 7.5.7.4) */}
      {isAddModalOpen && (
        <div
          className="contest-add-participant-backdrop"
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
          onClick={() => {
            if (!isAddingParticipant) setIsAddModalOpen(false);
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={18} color="#38bdf8" />
                <div>
                  <div style={{ fontWeight: '700', fontSize: '1rem', color: '#f8fafc' }}>
                    Add Participant
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Enroll an active student in Contest #{contestId}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isAddingParticipant}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: isAddingParticipant ? 'not-allowed' : 'pointer',
                  padding: '4px',
                }}
                title="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
              {/* Search candidate students input */}
              <div style={{ position: 'relative' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#64748b',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="Search students by username, name, email..."
                  value={candidateSearchQuery}
                  onChange={handleCandidateSearchChange}
                  disabled={isAddingParticipant}
                  style={{
                    width: '100%',
                    padding: '8px 30px 8px 32px',
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '0.85rem',
                    outline: 'none',
                  }}
                />
                {candidateSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCandidateSearchQuery('');
                      fetchCandidateStudents('');
                    }}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Error banner if add error */}
              {addModalError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '0.8rem',
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>{addModalError}</span>
                </div>
              )}

              {/* Candidate Selection List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Available Students ({candidateStudents.length})
                </div>

                {loadingCandidates ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto 8px auto', color: '#38bdf8' }} />
                    <div>Searching available students...</div>
                  </div>
                ) : candidateStudents.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 16px',
                      background: 'rgba(30, 41, 59, 0.3)',
                      border: '1px dashed rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      textAlign: 'center',
                      color: '#94a3b8',
                      fontSize: '0.82rem',
                    }}
                  >
                    {candidateSearchQuery
                      ? `No unenrolled students match "${candidateSearchQuery}".`
                      : 'No available unenrolled students found.'}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      maxHeight: '240px',
                      overflowY: 'auto',
                    }}
                  >
                    {candidateStudents.map((cand) => {
                      const isSelected = selectedCandidate?.id === cand.id;
                      const candRatingColor = getRatingColor(cand.current_rating || cand.currentRating);
                      return (
                        <div
                          key={cand.id}
                          onClick={() => !isAddingParticipant && setSelectedCandidate(cand)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 12px',
                            background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(30, 41, 59, 0.5)',
                            border: `1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)'}`,
                            borderRadius: '6px',
                            cursor: isAddingParticipant ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="radio"
                              name="selectedCandidate"
                              checked={isSelected}
                              onChange={() => setSelectedCandidate(cand)}
                              style={{ cursor: 'pointer', accentColor: '#38bdf8' }}
                            />
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.85rem' }}>
                                  @{cand.username}
                                </span>
                                {cand.full_name && (
                                  <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>
                                    ({cand.full_name})
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                {cand.email} {cand.institution ? `• ${cand.institution}` : ''}
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span
                              style={{
                                fontWeight: '700',
                                color: candRatingColor,
                                fontSize: '0.82rem',
                              }}
                            >
                              {cand.current_rating || cand.currentRating || 1200}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                padding: '12px 20px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(15, 23, 42, 0.8)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isAddingParticipant}
                style={{
                  padding: '6px 14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: isAddingParticipant ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddParticipant}
                disabled={!selectedCandidate || isAddingParticipant || isLifecycleLocked}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 16px',
                  background: !selectedCandidate || isAddingParticipant || isLifecycleLocked ? 'rgba(37, 99, 235, 0.4)' : '#2563eb',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: !selectedCandidate || isAddingParticipant || isLifecycleLocked ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                {isAddingParticipant ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Adding...</span>
                  </>
                ) : (
                  <>
                    <UserPlus size={13} />
                    <span>Add to Contest</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Participant Confirmation Modal (Phase 7.5.7.4) */}
      {participantToRemove && (
        <div
          className="contest-remove-participant-backdrop"
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
          onClick={() => {
            if (!isRemovingParticipant) setParticipantToRemove(null);
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid rgba(239, 68, 68, 0.25)',
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
            {/* Header */}
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
                <UserMinus size={18} color="#f87171" />
                <div style={{ fontWeight: '700', fontSize: '1rem', color: '#f8fafc' }}>
                  Remove Participant
                </div>
              </div>
              <button
                type="button"
                onClick={() => setParticipantToRemove(null)}
                disabled={isRemovingParticipant}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: isRemovingParticipant ? 'not-allowed' : 'pointer',
                  padding: '4px',
                }}
                title="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Prompt details */}
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.5' }}>
              Are you sure you want to remove participant{' '}
              <strong style={{ color: '#f8fafc' }}>@{participantToRemove.username}</strong>
              {participantToRemove.fullName ? ` (${participantToRemove.fullName})` : ''} from Contest #{contestId}?
            </div>

            {/* Integrity Warning */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '6px',
                background: 'rgba(234, 179, 8, 0.08)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                color: '#facc15',
                fontSize: '0.78rem',
                lineHeight: '1.4',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Submission Integrity Protection:</strong> If this student has submitted solutions in this contest, the platform will block removal to preserve competition history and audit records.
              </div>
            </div>

            {/* Error Message banner if removal failed */}
            {removeModalError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: '0.8rem',
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{removeModalError}</span>
              </div>
            )}

            {/* Footer Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
              <button
                type="button"
                onClick={() => setParticipantToRemove(null)}
                disabled={isRemovingParticipant}
                style={{
                  padding: '6px 14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '6px',
                  color: '#cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: isRemovingParticipant ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveParticipant}
                disabled={isRemovingParticipant || isLifecycleLocked}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 16px',
                  background: isRemovingParticipant || isLifecycleLocked ? 'rgba(239, 68, 68, 0.4)' : '#ef4444',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: isRemovingParticipant || isLifecycleLocked ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                {isRemovingParticipant ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <UserMinus size={13} />
                    <span>Confirm Removal</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
