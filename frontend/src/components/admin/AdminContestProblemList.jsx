import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Code2,
  FileCode,
  Award,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * AdminContestProblemList
 *
 * Dedicated read/list component for viewing problems currently attached to a contest.
 * Strictly READ/LIST focused for Phase 7.5.5.2:
 * - Fetches fresh problem list from GET /api/contests/:id/problems on inspection
 * - Displays problem ordering/position, title, difficulty, coding mode, points, and status
 * - Renders dedicated loading, empty, and error states with retry behavior
 * - Excludes all mutation capabilities (no add, remove, or reorder)
 */
export default function AdminContestProblemList({
  contestId,
  problems: controlledProblems,
  loading: controlledLoading,
  error: controlledError,
  onRetry: controlledOnRetry,
  token,
}) {
  const [internalProblems, setInternalProblems] = useState(controlledProblems || []);
  const [internalLoading, setInternalLoading] = useState(
    controlledLoading !== undefined ? controlledLoading : Boolean(contestId)
  );
  const [internalError, setInternalError] = useState(controlledError || null);

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

  return (
    <div className="contest-problem-list-section" data-testid="contest-problem-list">
      {/* 1. Header with title, tally, and refresh action */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
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
          <div style={{ fontSize: '0.8rem', maxWidth: '380px', margin: '0 auto', lineHeight: '1.4' }}>
            This contest currently has no attached problems. Problems can be added by authorized managers before publishing.
          </div>
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

                {/* Right: Points badge and Status */}
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
