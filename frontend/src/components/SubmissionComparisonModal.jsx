import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  GitCompare,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  Award,
  Calendar,
  Code2,
  Lock,
  ExternalLink,
  AlertTriangle,
  FileCode,
  Layers,
} from 'lucide-react';

/**
 * Phase 5.8.5: Submission Comparison Modal
 *
 * Side-by-side (desktop) and stacked (mobile) comparison interface.
 * Strictly separates metadata authorization from source-code authorization.
 */
export default function SubmissionComparisonModal({
  isOpen,
  onClose,
  initialSubmissionId,
  problemId,
  problemTitle,
  token,
}) {
  const [leftId, setLeftId] = useState(initialSubmissionId || '');
  const [rightId, setRightId] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Source code preview state
  const [viewingCodeSide, setViewingCodeSide] = useState(null); // 'left' | 'right' | null
  const [sourceCodeData, setSourceCodeData] = useState({ left: null, right: null });
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState(null);

  // Sync initial ID
  useEffect(() => {
    if (initialSubmissionId) {
      setLeftId(String(initialSubmissionId));
    }
  }, [initialSubmissionId]);

  // Fetch candidate submissions for this problem
  useEffect(() => {
    if (!isOpen || !problemId || !token) return;

    let isMounted = true;
    setCandidatesLoading(true);

    fetch(`/api/submissions/problem/${problemId}/my`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject('Failed to load candidate submissions')))
      .then((data) => {
        if (isMounted) {
          const subs = data.submissions || [];
          setCandidates(subs);
          // Auto-select candidate if rightId is empty and a different submission exists
          const differentSub = subs.find((s) => String(s.id) !== String(leftId));
          if (differentSub && !rightId) {
            setRightId(String(differentSub.id));
          }
          setCandidatesLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setCandidatesLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, problemId, token, leftId, rightId]);

  // Fetch comparison data
  const fetchComparison = useCallback(() => {
    if (!leftId || !rightId || !token) return;

    if (String(leftId).trim() === String(rightId).trim()) {
      setError('Please select two different submissions to compare.');
      setComparison(null);
      return;
    }

    setLoading(true);
    setError(null);
    setViewingCodeSide(null);

    fetch(`/api/submissions/compare?left=${leftId}&right=${rightId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || `Comparison failed (${res.status})`);
        }
        return data;
      })
      .then((data) => {
        setComparison(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to compare submissions');
        setComparison(null);
        setLoading(false);
      });
  }, [leftId, rightId, token]);

  useEffect(() => {
    if (isOpen && leftId && rightId) {
      fetchComparison();
    }
  }, [isOpen, leftId, rightId, fetchComparison]);

  // Fetch source code securely for an authorized side
  const handleInspectCode = (side, submissionId) => {
    if (viewingCodeSide === side) {
      setViewingCodeSide(null);
      return;
    }

    if (sourceCodeData[side]) {
      setViewingCodeSide(side);
      return;
    }

    setCodeLoading(true);
    setCodeError(null);

    fetch(`/api/submissions/${submissionId}/code`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || `Code inspection failed (${res.status})`);
        }
        return data;
      })
      .then((data) => {
        setSourceCodeData((prev) => ({ ...prev, [side]: data.sourceCode }));
        setViewingCodeSide(side);
        setCodeLoading(false);
      })
      .catch((err) => {
        setCodeError(err.message || 'Unable to load source code');
        setCodeLoading(false);
      });
  };

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formatVerdict = (v) => {
    const s = String(v || '').toLowerCase();
    if (s === 'accepted') {
      return {
        label: 'Accepted',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
        badgeClass: 'badge-verdict-accepted',
      };
    }
    if (s === 'wrong_answer') {
      return {
        label: 'Wrong Answer',
        icon: <XCircle className="w-4 h-4 text-rose-400" />,
        badgeClass: 'badge-verdict-wrong',
      };
    }
    if (s === 'time_limit_exceeded') {
      return {
        label: 'Time Limit Exceeded',
        icon: <Clock className="w-4 h-4 text-amber-400" />,
        badgeClass: 'badge-verdict-tle',
      };
    }
    if (s === 'compilation_error') {
      return {
        label: 'Compilation Error',
        icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
        badgeClass: 'badge-verdict-ce',
      };
    }
    if (s === 'runtime_error') {
      return {
        label: 'Runtime Error',
        icon: <AlertTriangle className="w-4 h-4 text-purple-400" />,
        badgeClass: 'badge-verdict-re',
      };
    }
    return {
      label: s ? s.toUpperCase() : 'Unavailable',
      icon: <Layers className="w-4 h-4 text-slate-400" />,
      badgeClass: 'badge-verdict-queued',
    };
  };

  const leftVerdict = comparison ? formatVerdict(comparison.left?.verdict) : null;
  const rightVerdict = comparison ? formatVerdict(comparison.right?.verdict) : null;

  return (
    <div
      className="submission-compare-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-modal-title"
    >
      <div className="submission-compare-modal">
        {/* Modal Header */}
        <div className="submission-compare-header">
          <div className="submission-compare-title-group">
            <div className="submission-compare-icon-wrap">
              <GitCompare className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 id="compare-modal-title" className="submission-compare-title">
                Submission Comparison
              </h2>
              <p className="submission-compare-subtitle">
                {problemTitle || `Problem #${problemId}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="submission-compare-close-btn"
            onClick={onClose}
            aria-label="Close comparison modal"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selection Bar */}
        <div className="submission-compare-select-bar">
          <div className="compare-select-field">
            <label className="compare-select-label">Submission A (Baseline)</label>
            <div className="compare-select-wrapper">
              <select
                className="filter-select compare-dropdown"
                value={leftId}
                onChange={(e) => setLeftId(e.target.value)}
                aria-label="Select Submission A"
              >
                {candidates.length > 0 ? (
                  candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.id} — {c.status?.toUpperCase()} ({c.language?.toUpperCase()}
                      {c.executionTime !== null ? `, ${c.executionTime}ms` : ''})
                    </option>
                  ))
                ) : (
                  <option value={leftId}>#{leftId} (Current)</option>
                )}
              </select>
            </div>
          </div>

          <div className="compare-select-divider">
            <span>vs</span>
          </div>

          <div className="compare-select-field">
            <label className="compare-select-label">Submission B (Compare With)</label>
            <div className="compare-select-wrapper">
              <select
                className="filter-select compare-dropdown"
                value={rightId}
                onChange={(e) => setRightId(e.target.value)}
                aria-label="Select Submission B"
                disabled={candidatesLoading}
              >
                <option value="">-- Choose a submission --</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id} disabled={String(c.id) === String(leftId)}>
                    #{c.id} — {c.status?.toUpperCase()} ({c.language?.toUpperCase()}
                    {c.executionTime !== null ? `, ${c.executionTime}ms` : ''})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="submission-compare-body">
          {/* Loading State */}
          {loading && (
            <div className="submission-compare-loading" role="status">
              <div className="spinner-sm" />
              <span>Comparing submissions...</span>
            </div>
          )}

          {/* Error Alert */}
          {error && !loading && (
            <div className="submission-compare-error-alert" role="alert">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <div>
                <strong>Comparison Error:</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Empty Prompt State */}
          {!loading && !error && !comparison && (
            <div className="submission-compare-empty">
              <GitCompare className="w-12 h-12 text-slate-500 mb-2" />
              <p>Select another submission above to compare side-by-side.</p>
            </div>
          )}

          {/* Comparison Content */}
          {!loading && !error && comparison && (
            <div className="submission-compare-content">
              {/* Summary Highlight Card */}
              <div className="submission-compare-summary-card">
                <div className="compare-summary-item">
                  <span className="compare-summary-label">Runtime Comparison</span>
                  <span className="compare-summary-value">{comparison.comparison.runtimeSummary}</span>
                </div>
                <div className="compare-summary-item">
                  <span className="compare-summary-label">Memory Comparison</span>
                  <span className="compare-summary-value">{comparison.comparison.memorySummary}</span>
                </div>
              </div>

              {/* Responsive Side-by-Side Table (Desktop) / Stacked Grid (Mobile) */}
              <div className="submission-compare-table-container">
                <table className="submission-compare-table" role="table">
                  <thead>
                    <tr>
                      <th className="th-metric">Metric</th>
                      <th className="th-sub">
                        Submission A <span>(#{comparison.left?.submissionId})</span>
                      </th>
                      <th className="th-sub">
                        Submission B <span>(#{comparison.right?.submissionId})</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Verdict */}
                    <tr>
                      <td className="td-metric">
                        <Award className="w-4 h-4 text-amber-400 mr-2" />
                        <span>Verdict</span>
                      </td>
                      <td className="td-val">
                        <span className={`badge-verdict ${leftVerdict.badgeClass}`}>
                          {leftVerdict.icon}
                          <span className="ml-1.5">{leftVerdict.label}</span>
                        </span>
                      </td>
                      <td className="td-val">
                        <span className={`badge-verdict ${rightVerdict.badgeClass}`}>
                          {rightVerdict.icon}
                          <span className="ml-1.5">{rightVerdict.label}</span>
                        </span>
                      </td>
                    </tr>

                    {/* Language & Coding Mode */}
                    <tr>
                      <td className="td-metric">
                        <Code2 className="w-4 h-4 text-blue-400 mr-2" />
                        <span>Language</span>
                      </td>
                      <td className="td-val">
                        <span className="lang-pill">
                          {comparison.left?.language?.toUpperCase()}
                        </span>
                        <span className="mode-tag ml-2 text-xs text-muted">
                          {comparison.left?.codingMode === 'function_only' ? 'Function' : 'Full Program'}
                        </span>
                      </td>
                      <td className="td-val">
                        <span className="lang-pill">
                          {comparison.right?.language?.toUpperCase()}
                        </span>
                        <span className="mode-tag ml-2 text-xs text-muted">
                          {comparison.right?.codingMode === 'function_only' ? 'Function' : 'Full Program'}
                        </span>
                      </td>
                    </tr>

                    {/* Runtime */}
                    <tr>
                      <td className="td-metric">
                        <Clock className="w-4 h-4 text-emerald-400 mr-2" />
                        <span>Runtime</span>
                      </td>
                      <td className="td-val">
                        {comparison.left?.runtime !== null ? (
                          <span className="metric-val-num">
                            {comparison.left.runtime} <span className="metric-unit">ms</span>
                          </span>
                        ) : (
                          <span className="metric-val-unavailable">Unavailable</span>
                        )}
                      </td>
                      <td className="td-val">
                        {comparison.right?.runtime !== null ? (
                          <span className="metric-val-num">
                            {comparison.right.runtime} <span className="metric-unit">ms</span>
                          </span>
                        ) : (
                          <span className="metric-val-unavailable">Unavailable</span>
                        )}
                      </td>
                    </tr>

                    {/* Memory */}
                    <tr>
                      <td className="td-metric">
                        <Cpu className="w-4 h-4 text-purple-400 mr-2" />
                        <span>Memory Usage</span>
                      </td>
                      <td className="td-val">
                        {comparison.left?.memoryMb !== null ? (
                          <span className="metric-val-num">
                            {comparison.left.memoryMb} <span className="metric-unit">MB</span>
                          </span>
                        ) : (
                          <span className="metric-val-unavailable">Unavailable</span>
                        )}
                      </td>
                      <td className="td-val">
                        {comparison.right?.memoryMb !== null ? (
                          <span className="metric-val-num">
                            {comparison.right.memoryMb} <span className="metric-unit">MB</span>
                          </span>
                        ) : (
                          <span className="metric-val-unavailable">Unavailable</span>
                        )}
                      </td>
                    </tr>

                    {/* Test Cases Passed */}
                    <tr>
                      <td className="td-metric">
                        <CheckCircle2 className="w-4 h-4 text-cyan-400 mr-2" />
                        <span>Test Cases</span>
                      </td>
                      <td className="td-val">
                        <span className="test-cases-pill">
                          {comparison.left?.testsPassed} / {comparison.left?.testsTotal} passed
                        </span>
                      </td>
                      <td className="td-val">
                        <span className="test-cases-pill">
                          {comparison.right?.testsPassed} / {comparison.right?.testsTotal} passed
                        </span>
                      </td>
                    </tr>

                    {/* Submission Timestamp */}
                    <tr>
                      <td className="td-metric">
                        <Calendar className="w-4 h-4 text-slate-400 mr-2" />
                        <span>Submitted</span>
                      </td>
                      <td className="td-val td-date">
                        {comparison.left?.submittedAt
                          ? new Date(comparison.left.submittedAt).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="td-val td-date">
                        {comparison.right?.submittedAt
                          ? new Date(comparison.right.submittedAt).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                    </tr>

                    {/* Source Code Action Row (Independent Authorization) */}
                    <tr className="tr-source-code-actions">
                      <td className="td-metric">
                        <FileCode className="w-4 h-4 text-indigo-400 mr-2" />
                        <span>Source Code</span>
                      </td>
                      <td className="td-val">
                        {comparison.sourceCode?.leftVisible ? (
                          <button
                            type="button"
                            className={`btn btn-sm ${
                              viewingCodeSide === 'left' ? 'btn-primary' : 'btn-outline'
                            }`}
                            onClick={() => handleInspectCode('left', comparison.left.submissionId)}
                            aria-label="View Source Code A"
                          >
                            <Code2 className="w-3.5 h-3.5 mr-1" />
                            <span>
                              {viewingCodeSide === 'left' ? 'Hide Code A' : 'View Code A'}
                            </span>
                          </button>
                        ) : (
                          <span className="badge-private-code" title="Source code is private">
                            <Lock className="w-3 h-3 mr-1" />
                            <span>Private Code</span>
                          </span>
                        )}
                      </td>
                      <td className="td-val">
                        {comparison.sourceCode?.rightVisible ? (
                          <button
                            type="button"
                            className={`btn btn-sm ${
                              viewingCodeSide === 'right' ? 'btn-primary' : 'btn-outline'
                            }`}
                            onClick={() => handleInspectCode('right', comparison.right.submissionId)}
                            aria-label="View Source Code B"
                          >
                            <Code2 className="w-3.5 h-3.5 mr-1" />
                            <span>
                              {viewingCodeSide === 'right' ? 'Hide Code B' : 'View Code B'}
                            </span>
                          </button>
                        ) : (
                          <span className="badge-private-code" title="Source code is private">
                            <Lock className="w-3 h-3 mr-1" />
                            <span>Private Code</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Source Code Viewer Drawer / Panel */}
              {viewingCodeSide && (
                <div className="submission-compare-code-viewer">
                  <div className="compare-code-header">
                    <div className="compare-code-title">
                      <Code2 className="w-4 h-4 text-blue-400 mr-1.5" />
                      <span>
                        Source Code — Submission{' '}
                        {viewingCodeSide === 'left'
                          ? `A (#${comparison.left.submissionId})`
                          : `B (#${comparison.right.submissionId})`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="compare-code-close"
                      onClick={() => setViewingCodeSide(null)}
                      title="Hide code"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {codeLoading && (
                    <div className="compare-code-loading">
                      <div className="spinner-sm" />
                      <span>Loading authorized source code...</span>
                    </div>
                  )}

                  {codeError && (
                    <div className="compare-code-error">
                      <span>{codeError}</span>
                    </div>
                  )}

                  {!codeLoading && !codeError && sourceCodeData[viewingCodeSide] && (
                    <pre className="compare-code-block">
                      <code>{sourceCodeData[viewingCodeSide]}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
