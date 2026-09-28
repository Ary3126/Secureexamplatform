import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Code2,
  FileCode,
  Award,
  Plus,
  Search,
  X,
  Check,
  Lock,
  Trash2,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * AdminContestProblemList
 *
 * Dedicated component for viewing and managing problems attached to a contest.
 * Phase 7.5.5.2 (List), Phase 7.5.5.3 (Add Problem), Phase 7.5.5.4 (Remove Problem):
 * - Displays attached contest problems with order, points, badges, total tally
 * - Allows authorized managers (super_admin, contest_admin, owner professor) to add
 *   existing problems from the platform problem bank
 * - Allows authorized managers to safely remove attached problems (deletes relation ONLY)
 * - Enforces client-side duplicate prevention and lifecycle lock warnings
 * - Strictly excludes Drag-and-drop ordering (deferred to 7.5.5.5+)
 */
export default function AdminContestProblemList({
  contestId,
  contest,
  currentUser,
  problems: controlledProblems,
  loading: controlledLoading,
  error: controlledError,
  onRetry: controlledOnRetry,
  onProblemAdded,
  onProblemRemoved,
  token,
}) {
  const [internalProblems, setInternalProblems] = useState(controlledProblems || []);
  const [internalLoading, setInternalLoading] = useState(
    controlledLoading !== undefined ? controlledLoading : Boolean(contestId)
  );
  const [internalError, setInternalError] = useState(controlledError || null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Add Problem Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [bankProblems, setBankProblems] = useState([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [problemPoints, setProblemPoints] = useState(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalSubmitError, setModalSubmitError] = useState(null);

  // Remove Problem Dialog State (Phase 7.5.5.4)
  const [problemToRemove, setProblemToRemove] = useState(null);
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  const searchInputRef = useRef(null);
  const cancelRemoveBtnRef = useRef(null);

  // Helper: Determine if current user has permission to manage (add/remove) problems
  const canManageProblems = (() => {
    if (!currentUser) return false;
    const role = currentUser.role;
    if (role === 'super_admin' || role === 'contest_admin') return true;
    if (role === 'professor') {
      const ownerId = contest?.createdBy || contest?.created_by;
      if (ownerId && ownerId === currentUser.id) return true;
    }
    return false;
  })();
  const canAddProblems = canManageProblems;

  // Helper: Lifecycle locked state
  const runtimeState = (contest?.runtimeState || contest?.status || '').toLowerCase();
  const isLifecycleLocked = ['running', 'ended', 'archived'].includes(runtimeState);

  // Fetch problems directly from authoritative API
  const fetchProblems = useCallback(async () => {
    if (!contestId) return;

    setInternalLoading(true);
    setInternalError(null);

    try {
      const authToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

      const res = await fetch(`/api/contests/${contestId}/problems`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.message || `Failed to fetch contest problems (${res.status})`
        );
      }

      setInternalProblems(data.problems || []);
    } catch (err) {
      setInternalError(err.message || 'Error loading contest problems');
    } finally {
      setInternalLoading(false);
    }
  }, [contestId, token]);

  // Fetch when contestId changes
  useEffect(() => {
    if (contestId) {
      fetchProblems();
    } else if (controlledProblems !== undefined) {
      setInternalProblems(controlledProblems);
    }
  }, [contestId, fetchProblems, controlledProblems]);

  // Sync controlled props if provided
  useEffect(() => {
    if (controlledProblems !== undefined && !contestId) {
      setInternalProblems(controlledProblems);
    }
  }, [controlledProblems, contestId]);

  useEffect(() => {
    if (controlledLoading !== undefined && !contestId) {
      setInternalLoading(controlledLoading);
    }
  }, [controlledLoading, contestId]);

  useEffect(() => {
    if (controlledError !== undefined && !contestId) {
      setInternalError(controlledError);
    }
  }, [controlledError, contestId]);

  const activeProblems = contestId ? internalProblems : (controlledProblems || internalProblems);
  const activeLoading = contestId ? internalLoading : (controlledLoading !== undefined ? controlledLoading : internalLoading);
  const activeError = contestId ? internalError : (controlledError !== undefined ? controlledError : internalError);

  const handleRetry = () => {
    if (contestId) {
      fetchProblems();
    }
    if (controlledOnRetry) {
      controlledOnRetry();
    }
  };

  // Compute total points across attached problems
  const totalPoints = (activeProblems || []).reduce(
    (sum, p) => sum + (parseInt(p.points, 10) || 100),
    0
  );

  // Fetch problem bank for search modal
  const fetchBankProblems = useCallback(async (query = '', diff = 'all') => {
    setBankLoading(true);
    setBankError(null);
    try {
      const authToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

      const params = new URLSearchParams({ limit: '20' });
      if (query.trim()) params.set('search', query.trim());
      if (diff !== 'all') params.set('difficulty', diff);

      const res = await fetch(`/api/problems?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch problem catalog');
      }

      setBankProblems(data.problems || []);
    } catch (err) {
      setBankError(err.message || 'Error loading problems from bank');
    } finally {
      setBankLoading(false);
    }
  }, [token]);

  // Open modal and load initial problem bank
  const handleOpenAddModal = () => {
    if (isLifecycleLocked) return;
    setIsAddModalOpen(true);
    setSearchQuery('');
    setDifficultyFilter('all');
    setSelectedProblem(null);
    setProblemPoints(100);
    setModalSubmitError(null);
    fetchBankProblems('', 'all');
  };

  // Close modal
  const handleCloseAddModal = () => {
    setIsAddModalOpen(false);
    setSelectedProblem(null);
    setModalSubmitError(null);
  };

  // Debounced search trigger
  useEffect(() => {
    if (!isAddModalOpen) return;
    const timer = setTimeout(() => {
      fetchBankProblems(searchQuery, difficultyFilter);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, difficultyFilter, isAddModalOpen, fetchBankProblems]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isAddModalOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isAddModalOpen]);

  // Execute Add Problem API request
  const handleAddProblemSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedProblem || isSubmitting) return;

    setIsSubmitting(true);
    setModalSubmitError(null);

    try {
      const authToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

      const res = await fetch(`/api/contests/${contestId}/problems`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          problemId: selectedProblem.id,
          points: parseInt(problemPoints, 10) || 100,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        let msg = data.message;
        if (data.errors && Array.isArray(data.errors)) {
          msg = data.errors.join(' ');
        }
        if (res.status === 401) msg = 'Session expired. Please log in again.';
        if (res.status === 429) msg = 'Rate limit exceeded. Please wait a moment.';
        throw new Error(msg || `Failed to add problem (${res.status})`);
      }

      // Successful attachment: refresh list and close modal
      setIsAddModalOpen(false);
      setSelectedProblem(null);
      setSuccessMessage(`"${selectedProblem.title}" successfully added to contest!`);
      setTimeout(() => setSuccessMessage(null), 4000);

      await fetchProblems();
      if (onProblemAdded) {
        onProblemAdded(data);
      }
    } catch (err) {
      setModalSubmitError(err.message || 'Error attaching problem to contest');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Remove Dialog
  const handleOpenRemoveDialog = (problem) => {
    if (isLifecycleLocked) return;
    setProblemToRemove(problem);
    setIsRemoveDialogOpen(true);
    setRemoveError(null);
  };

  // Close Remove Dialog
  const handleCloseRemoveDialog = () => {
    if (isRemoving) return;
    setIsRemoveDialogOpen(false);
    setProblemToRemove(null);
    setRemoveError(null);
  };

  // Keyboard accessibility for Remove Dialog (Escape to close)
  useEffect(() => {
    if (!isRemoveDialogOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isRemoving) {
        handleCloseRemoveDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRemoveDialogOpen, isRemoving]);

  // Focus cancel button when remove dialog opens
  useEffect(() => {
    if (isRemoveDialogOpen && cancelRemoveBtnRef.current) {
      setTimeout(() => cancelRemoveBtnRef.current?.focus(), 50);
    }
  }, [isRemoveDialogOpen]);

  // Execute Remove Problem API request (Phase 7.5.5.4)
  const handleConfirmRemove = async () => {
    if (!problemToRemove || isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);

    try {
      const authToken =
        token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
      const probId = problemToRemove.problemId || problemToRemove.id;

      const res = await fetch(`/api/contests/${contestId}/problems/${probId}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        let msg = data.message;
        if (res.status === 401) msg = 'Session expired. Please log in again.';
        if (res.status === 403) msg = 'Forbidden: You do not have permission to remove this problem.';
        if (res.status === 404) msg = data.message || 'Problem or contest not found.';
        if (res.status === 409) msg = data.message || 'Contest is locked for problem modifications.';
        if (res.status === 429) msg = 'Rate limit exceeded. Please wait a moment.';
        throw new Error(msg || `Failed to remove problem (${res.status})`);
      }

      // Successful removal: close dialog, show success feedback, refresh list
      const removedTitle = problemToRemove.title;
      setIsRemoveDialogOpen(false);
      setProblemToRemove(null);
      setSuccessMessage(`"${removedTitle}" successfully removed from contest!`);
      setTimeout(() => setSuccessMessage(null), 4000);

      await fetchProblems();
      if (onProblemRemoved) {
        onProblemRemoved(probId, data);
      }
    } catch (err) {
      setRemoveError(err.message || 'Error removing problem from contest');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="contest-problem-list-section" data-testid="contest-problem-list">
      {/* 1. Header with title, tally, add action, and refresh action */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={16} style={{ color: '#38bdf8' }} />
          <span
            className="inspect-section-title"
            style={{ margin: 0, fontSize: '0.9rem', fontWeight: '700', color: '#f8fafc' }}
          >
            Attached Problems ({activeProblems?.length || 0})
          </span>
          {activeProblems?.length > 0 && (
            <span
              data-testid="problem-total-points"
              style={{
                fontSize: '0.75rem',
                color: '#94a3b8',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '2px 8px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              Total: <strong style={{ color: '#38bdf8' }}>{totalPoints}</strong> pts
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Add Problem Button (Visible only to authorized users) */}
          {canAddProblems && (
            <button
              onClick={handleOpenAddModal}
              disabled={isLifecycleLocked}
              className="btn-add-problem"
              data-testid="add-problem-button"
              style={{
                background: isLifecycleLocked
                  ? 'rgba(255, 255, 255, 0.04)'
                  : 'linear-gradient(135deg, #0284c7, #2563eb)',
                border: isLifecycleLocked
                  ? '1px solid rgba(255, 255, 255, 0.08)'
                  : '1px solid rgba(56, 189, 248, 0.4)',
                color: isLifecycleLocked ? '#64748b' : '#ffffff',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '0.78rem',
                fontWeight: '600',
                cursor: isLifecycleLocked ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
              title={
                isLifecycleLocked
                  ? `Cannot add problems while contest is ${runtimeState}`
                  : 'Attach an existing problem to this contest'
              }
              aria-label="Add Problem to Contest"
            >
              {isLifecycleLocked ? <Lock size={12} /> : <Plus size={12} />}
              <span>Add Problem</span>
            </button>
          )}

          {/* Refresh Action */}
          <button
            onClick={handleRetry}
            disabled={activeLoading}
            className="btn-refresh-problem-list"
            data-testid="refresh-problems-button"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              cursor: activeLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.15s ease',
            }}
            title="Refresh attached problems list"
            aria-label="Refresh attached problems"
          >
            <RotateCcw size={12} className={activeLoading ? 'spin-icon' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div
          role="status"
          data-testid="problem-list-success"
          style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#34d399',
            fontSize: '0.85rem',
          }}
        >
          <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* 2. Error State with Retry Button */}
      {activeError && (
        <div
          role="alert"
          data-testid="problem-list-error"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontSize: '0.85rem' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span data-testid="error-message-text">{activeError}</span>
          </div>
          <button
            onClick={handleRetry}
            data-testid="retry-problems-button"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              borderRadius: '4px',
              padding: '4px 10px',
              fontSize: '0.78rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 3. Loading State */}
      {activeLoading ? (
        <div style={{ padding: '20px 0' }} data-testid="problem-list-loading">
          <AuthoringLoadingState message="Loading attached problems..." />
        </div>
      ) : !activeError && (!activeProblems || activeProblems.length === 0) ? (
        /* 4. Empty State */
        <div
          role="status"
          data-testid="problem-list-empty"
          style={{
            background: 'rgba(30, 41, 59, 0.4)',
            border: '1px dashed rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '28px 20px',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <Layers size={32} style={{ margin: '0 auto 8px', opacity: 0.4, color: '#94a3b8' }} />
          <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#cbd5e1', marginBottom: '4px' }}>
            No Problems Attached
          </div>
          <div style={{ fontSize: '0.8rem', maxWidth: '380px', margin: '0 auto 12px', lineHeight: '1.4' }}>
            This contest currently has no attached problems. Click "Add Problem" above to select problems from the catalog.
          </div>
          {canAddProblems && !isLifecycleLocked && (
            <button
              onClick={handleOpenAddModal}
              data-testid="empty-state-add-button"
              style={{
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={13} /> Add First Problem
            </button>
          )}
        </div>
      ) : (
        /* 5. Attached Problem List */
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          role="list"
          aria-label="Attached contest problems"
          data-testid="problem-list-items"
        >
          {activeProblems.map((problem, idx) => {
            const probId = problem.problemId || problem.id;
            const orderNum = problem.problemOrder || idx + 1;
            const diff = (problem.difficulty || 'medium').toLowerCase();
            const mode = problem.codingMode || problem.coding_mode || 'full_program';
            const pts = problem.points || 100;

            const diffColor =
              diff === 'easy'
                ? { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80' }
                : diff === 'hard'
                ? { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171' }
                : { bg: 'rgba(234, 179, 8, 0.15)', text: '#facc15' };

            return (
              <div
                key={probId}
                role="listitem"
                data-testid={`contest-problem-row-${probId}`}
                style={{
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Left: Position badge, Title & Metadata */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                  <span
                    data-testid={`problem-order-badge-${probId}`}
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: '700',
                      color: '#94a3b8',
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      minWidth: '32px',
                      textAlign: 'center',
                      flexShrink: 0,
                    }}
                    title={`Problem Position: ${orderNum}`}
                  >
                    #{orderNum}
                  </span>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      data-testid={`problem-title-${probId}`}
                      style={{
                        fontWeight: '600',
                        color: '#f8fafc',
                        fontSize: '0.88rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={problem.title}
                    >
                      {problem.title}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '3px',
                        fontSize: '0.72rem',
                        color: '#94a3b8',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span data-testid={`problem-id-${probId}`}>ID #{probId}</span>
                      <span>•</span>
                      <span
                        data-testid={`problem-difficulty-${probId}`}
                        style={{
                          textTransform: 'capitalize',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: diffColor.bg,
                          color: diffColor.text,
                          fontWeight: '600',
                        }}
                      >
                        {diff}
                      </span>
                      <span>•</span>
                      <span
                        data-testid={`problem-mode-${probId}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          textTransform: 'capitalize',
                        }}
                      >
                        {mode === 'function' ? <Code2 size={11} /> : <FileCode size={11} />}
                        {mode === 'function' ? 'Function' : 'Full Program'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Points badge, Status and Remove Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    data-testid={`problem-status-badge-${probId}`}
                    style={{
                      fontSize: '0.72rem',
                      color: '#34d399',
                      background: 'rgba(52, 211, 153, 0.1)',
                      border: '1px solid rgba(52, 211, 153, 0.25)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                    title="Active in Contest"
                  >
                    <CheckCircle2 size={10} /> Active
                  </span>

                  <span
                    data-testid={`problem-points-badge-${probId}`}
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: '700',
                      color: '#38bdf8',
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                      padding: '3px 9px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title={`Problem Points: ${pts}`}
                  >
                    <Award size={12} /> {pts} pts
                  </span>

                  {/* Remove Problem Action (Visible only to authorized users) */}
                  {canManageProblems && (
                    <button
                      type="button"
                      onClick={() => handleOpenRemoveDialog(problem)}
                      disabled={isLifecycleLocked}
                      className="btn-remove-problem"
                      data-testid={`remove-problem-button-${probId}`}
                      aria-label={`Remove ${problem.title} from contest`}
                      title={
                        isLifecycleLocked
                          ? `Cannot remove problems while contest is ${runtimeState}`
                          : 'Remove problem from this contest'
                      }
                      style={{
                        background: isLifecycleLocked ? 'rgba(255, 255, 255, 0.04)' : 'rgba(239, 68, 68, 0.12)',
                        border: isLifecycleLocked ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(239, 68, 68, 0.3)',
                        color: isLifecycleLocked ? '#64748b' : '#f87171',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        cursor: isLifecycleLocked ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isLifecycleLocked ? <Lock size={11} /> : <Trash2 size={11} />}
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Add Problem Modal (Phase 7.5.5.3) */}
      {isAddModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add Problem to Contest"
          data-testid="add-problem-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) handleCloseAddModal();
          }}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '620px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: '#f8fafc' }}>
                  Add Problem to Contest
                </h3>
              </div>
              <button
                onClick={handleCloseAddModal}
                disabled={isSubmitting}
                data-testid="modal-close-button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form & Search Controls */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
              {/* Search & Difficulty Row */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search
                    size={14}
                    style={{
                      position: 'absolute',
                      left: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#64748b',
                    }}
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search problem catalog by title or keyword..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="problem-search-input"
                    style={{
                      width: '100%',
                      padding: '8px 10px 8px 32px',
                      backgroundColor: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '0.85rem',
                      outline: 'none',
                    }}
                  />
                </div>

                <select
                  value={difficultyFilter}
                  onChange={(e) => setDifficultyFilter(e.target.value)}
                  data-testid="problem-difficulty-select"
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '6px',
                    color: '#cbd5e1',
                    fontSize: '0.85rem',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Difficulties</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>

              {/* Points Assignment Row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.4)',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#cbd5e1' }}>
                  <Award size={14} style={{ color: '#38bdf8' }} />
                  <span>Contest Points for this Problem:</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={problemPoints}
                  onChange={(e) => setProblemPoints(Math.max(1, parseInt(e.target.value, 10) || 100))}
                  data-testid="problem-points-input"
                  style={{
                    width: '90px',
                    padding: '4px 8px',
                    textAlign: 'right',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '4px',
                    color: '#38bdf8',
                    fontWeight: '700',
                    fontSize: '0.85rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Error in modal if any */}
            {modalSubmitError && (
              <div
                role="alert"
                data-testid="add-problem-modal-error"
                style={{
                  margin: '12px 20px 0',
                  padding: '10px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '6px',
                  color: '#f87171',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>{modalSubmitError}</span>
              </div>
            )}

            {/* Modal Body: Problem Bank List */}
            <div
              style={{
                padding: '12px 20px',
                overflowY: 'auto',
                flex: 1,
                minHeight: '220px',
                maxHeight: '340px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
              data-testid="problem-bank-list"
            >
              {bankLoading ? (
                <div style={{ padding: '40px 0' }}>
                  <AuthoringLoadingState message="Searching problem catalog..." />
                </div>
              ) : bankError ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#f87171',
                    fontSize: '0.85rem',
                  }}
                >
                  <AlertTriangle size={24} style={{ margin: '0 auto 6px', opacity: 0.8 }} />
                  <div>{bankError}</div>
                </div>
              ) : bankProblems.length === 0 ? (
                <div
                  style={{
                    padding: '36px 20px',
                    textAlign: 'center',
                    color: '#64748b',
                    fontSize: '0.85rem',
                  }}
                  data-testid="problem-bank-empty"
                >
                  No matching problems found in the problem bank.
                </div>
              ) : (
                bankProblems.map((p) => {
                  const isAlreadyAttached = activeProblems.some(
                    (ap) => String(ap.problemId || ap.id) === String(p.id)
                  );
                  const isSelected = selectedProblem?.id === p.id;
                  const diff = (p.difficulty || 'medium').toLowerCase();
                  const mode = p.codingMode || p.coding_mode || 'full_program';

                  const diffColor =
                    diff === 'easy'
                      ? { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80' }
                      : diff === 'hard'
                      ? { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171' }
                      : { bg: 'rgba(234, 179, 8, 0.15)', text: '#facc15' };

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        if (!isAlreadyAttached && !isSubmitting) {
                          setSelectedProblem(isSelected ? null : p);
                        }
                      }}
                      data-testid={
                        isAlreadyAttached
                          ? `problem-option-attached-${p.id}`
                          : `problem-option-${p.id}`
                      }
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: isSelected
                          ? '1px solid #38bdf8'
                          : '1px solid rgba(255, 255, 255, 0.06)',
                        backgroundColor: isSelected
                          ? 'rgba(56, 189, 248, 0.12)'
                          : isAlreadyAttached
                          ? 'rgba(15, 23, 42, 0.3)'
                          : 'rgba(30, 41, 59, 0.5)',
                        opacity: isAlreadyAttached ? 0.45 : 1,
                        cursor: isAlreadyAttached ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: '600',
                            color: isAlreadyAttached ? '#94a3b8' : '#f8fafc',
                            fontSize: '0.86rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.title}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginTop: '2px',
                            fontSize: '0.72rem',
                            color: '#94a3b8',
                          }}
                        >
                          <span>ID #{p.id}</span>
                          <span>•</span>
                          <span
                            style={{
                              textTransform: 'capitalize',
                              padding: '0 5px',
                              borderRadius: '3px',
                              background: diffColor.bg,
                              color: diffColor.text,
                              fontWeight: '600',
                            }}
                          >
                            {diff}
                          </span>
                          <span>•</span>
                          <span style={{ textTransform: 'capitalize' }}>
                            {mode === 'function' ? 'Function' : 'Full Program'}
                          </span>
                        </div>
                      </div>

                      <div style={{ flexShrink: 0 }}>
                        {isAlreadyAttached ? (
                          <span
                            data-testid={`badge-already-attached-${p.id}`}
                            style={{
                              fontSize: '0.72rem',
                              color: '#94a3b8',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}
                          >
                            Already Attached
                          </span>
                        ) : isSelected ? (
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              backgroundColor: '#38bdf8',
                              color: '#0f172a',
                            }}
                          >
                            <Check size={13} strokeWidth={3} />
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'block',
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(15, 23, 42, 0.3)',
              }}
            >
              <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                {selectedProblem ? (
                  <span>
                    Selected: <strong style={{ color: '#f8fafc' }}>{selectedProblem.title}</strong> (#{selectedProblem.id})
                  </span>
                ) : (
                  <span>Select a problem above to attach</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleCloseAddModal}
                  disabled={isSubmitting}
                  data-testid="cancel-add-problem-button"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#cbd5e1',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddProblemSubmit}
                  disabled={!selectedProblem || isSubmitting}
                  data-testid="submit-add-problem-button"
                  style={{
                    padding: '6px 16px',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    background:
                      !selectedProblem || isSubmitting
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'linear-gradient(135deg, #0284c7, #2563eb)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: !selectedProblem || isSubmitting ? '#94a3b8' : '#ffffff',
                    cursor: !selectedProblem || isSubmitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <RotateCcw size={13} className="spin-icon" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={13} />
                      <span>Attach Problem</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Remove Problem Confirmation Dialog (Phase 7.5.5.4) */}
      {isRemoveDialogOpen && problemToRemove && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-problem-dialog-title"
          data-testid="remove-problem-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRemoving) handleCloseRemoveDialog();
          }}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '480px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              overflow: 'hidden',
            }}
          >
            {/* Dialog Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trash2 size={18} style={{ color: '#f87171' }} />
                <h3
                  id="remove-problem-dialog-title"
                  data-testid="remove-problem-dialog-title"
                  style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: '#f8fafc' }}
                >
                  Remove Problem from Contest
                </h3>
              </div>
              <button
                onClick={handleCloseRemoveDialog}
                disabled={isRemoving}
                data-testid="remove-dialog-close-button"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: isRemoving ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Dialog Body */}
            <div style={{ padding: '20px' }}>
              <p
                data-testid="remove-dialog-confirmation-text"
                style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#e2e8f0', lineHeight: '1.5' }}
              >
                Are you sure you want to remove <strong>"{problemToRemove.title}"</strong> from this contest?
              </p>

              <div
                data-testid="remove-dialog-warning-callout"
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  fontSize: '0.82rem',
                  color: '#93c5fd',
                  lineHeight: '1.4',
                }}
              >
                <strong>Note:</strong> This removes the problem from this contest. The problem itself will remain available in the problem bank.
              </div>

              {removeError && (
                <div
                  role="alert"
                  data-testid="remove-problem-error"
                  style={{
                    marginTop: '14px',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fca5a5',
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>{removeError}</span>
                </div>
              )}
            </div>

            {/* Dialog Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                backgroundColor: 'rgba(15, 23, 42, 0.3)',
              }}
            >
              <button
                ref={cancelRemoveBtnRef}
                type="button"
                onClick={handleCloseRemoveDialog}
                disabled={isRemoving}
                data-testid="cancel-remove-problem-button"
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#cbd5e1',
                  cursor: isRemoving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                disabled={isRemoving}
                data-testid="confirm-remove-problem-button"
                style={{
                  padding: '6px 16px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  backgroundColor: isRemoving ? 'rgba(239, 68, 68, 0.4)' : '#dc2626',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: '#ffffff',
                  cursor: isRemoving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isRemoving ? (
                  <>
                    <RotateCcw size={13} className="spin-icon" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Remove Problem</span>
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
