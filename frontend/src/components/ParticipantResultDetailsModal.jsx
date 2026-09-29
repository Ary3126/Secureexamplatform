import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Trophy,
  Award,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Code,
  Calendar,
  Zap,
  ShieldAlert,
  Layers,
  FileText,
  RefreshCw,
  Lock,
  Unlock,
  Eye,
  Check,
} from 'lucide-react';
import CoderEmblem from './CoderEmblem';
import SubmissionCodeModal from './SubmissionCodeModal';
import './participantResultDetailsModal.css';

/**
 * ParticipantResultDetailsModal — Sub-Phase 7.5.8.4
 * Reusable modal for detailed contest results and submission history of a participant.
 * Reuses server-authoritative scoring and standings data.
 */
export default function ParticipantResultDetailsModal({
  contestId,
  participantId, // 'me' or numeric userId
  initialFreezeOverride = false,
  isManager = false,
  token = null,
  onClose,
  onOpenProblemInWorkspace,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [freezeOverride, setFreezeOverride] = useState(initialFreezeOverride);
  const [activeCodeSubmission, setActiveCodeSubmission] = useState(null);

  const effectiveToken = token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

  const fetchDetails = useCallback(async () => {
    if (!contestId) return;
    setLoading(true);
    setError(null);

    try {
      let url =
        participantId === 'me' || !participantId
          ? `/api/contests/${contestId}/results/me`
          : `/api/contests/${contestId}/participants/${participantId}/results`;

      if (isManager && freezeOverride) {
        url += `?freezeOverride=true`;
      }

      const headers = {};
      if (effectiveToken) {
        headers['Authorization'] = `Bearer ${effectiveToken}`;
      }

      const res = await fetch(url, { headers });
      const result = await res.json();

      if (res.ok) {
        setData(result);
      } else {
        setError(result.message || 'Failed to load participant result details.');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching participant result details.');
    } finally {
      setLoading(false);
    }
  }, [contestId, participantId, freezeOverride, isManager, effectiveToken]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (activeCodeSubmission) {
          setActiveCodeSubmission(null);
        } else if (onClose) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCodeSubmission, onClose]);

  const participant = data?.participant;
  const summary = data?.summary;
  const contest = data?.contest;
  const problems = data?.problems || [];
  const submissions = data?.submissions || [];

  const getRankBadge = (rank) => {
    if (rank === 1) return <span style={{ color: '#fbbf24', fontWeight: '800' }}>🥇 Rank #1</span>;
    if (rank === 2) return <span style={{ color: '#e2e8f0', fontWeight: '800' }}>🥈 Rank #2</span>;
    if (rank === 3) return <span style={{ color: '#f97316', fontWeight: '800' }}>🥉 Rank #3</span>;
    return <span style={{ color: '#94a3b8', fontWeight: '700' }}>Rank #{rank}</span>;
  };

  const getVerdictTag = (status) => {
    const s = String(status || '').toLowerCase();
    let label = s.replace(/_/g, ' ').toUpperCase();
    let icon = <CheckCircle2 size={12} />;
    let cls = 'accepted';

    if (s === 'accepted') {
      icon = <CheckCircle2 size={12} />;
      cls = 'accepted';
    } else if (s === 'wrong_answer') {
      icon = <XCircle size={12} />;
      cls = 'wrong_answer';
    } else if (s.includes('limit')) {
      icon = <Clock size={12} />;
      cls = 'time_limit_exceeded';
    } else {
      icon = <AlertTriangle size={12} />;
      cls = 'runtime_error';
    }

    return (
      <span className={`verdict-tag ${cls}`}>
        {icon}
        <span>{label}</span>
      </span>
    );
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="participant-details-overlay" onClick={onClose}>
      <div
        className="participant-details-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdetails-title"
      >
        {/* Modal Header */}
        <div className="participant-details-header">
          <div className="participant-header-profile">
            <div className="participant-header-avatar">
              {participant?.avatarUrl ? (
                <img src={participant.avatarUrl} alt={participant.username} />
              ) : (
                (participant?.fullName || participant?.username || '?').charAt(0).toUpperCase()
              )}
            </div>
            <div className="participant-header-info">
              <div className="participant-name-row">
                <span id="pdetails-title" className="participant-fullname">
                  {participant?.fullName || participant?.username || 'Participant Details'}
                </span>
                {participant?.username && (
                  <span className="participant-username">@{participant.username}</span>
                )}
                {participant?.ratingStatus && (
                  <span className="participant-tier-badge">
                    <Zap size={11} /> {participant.ratingStatus} ({participant.currentRating || 1200})
                  </span>
                )}
              </div>
              <div className="participant-meta-row">
                <span>
                  <Award size={12} />
                  Contest: {contest?.title || `Contest #${contestId}`}
                </span>
                {participant?.joinedAt && (
                  <span>
                    <Calendar size={12} />
                    Joined: {new Date(participant.joinedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="participant-header-actions">
            {isManager && contest?.isFrozen && (
              <button
                type="button"
                className={`freeze-toggle-btn ${freezeOverride ? 'active' : ''}`}
                onClick={() => setFreezeOverride(!freezeOverride)}
                title={freezeOverride ? 'Viewing unmasked live results' : 'Viewing frozen masked results'}
              >
                {freezeOverride ? <Unlock size={13} /> : <Lock size={13} />}
                <span>{freezeOverride ? 'Unmasked (Live)' : 'Frozen View'}</span>
              </button>
            )}

            <button
              type="button"
              className="modal-close-icon-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="participant-details-body">
          {loading ? (
            <div className="participant-details-loading">
              <div className="pdetails-spinner" />
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                Loading authoritative result details...
              </p>
            </div>
          ) : error ? (
            <div className="participant-details-error">
              <ShieldAlert size={36} />
              <h4 style={{ color: '#f8fafc', margin: '0.25rem 0' }}>Access Error</h4>
              <p style={{ maxWidth: '400px', fontSize: '0.85rem' }}>{error}</p>
              <button type="button" onClick={fetchDetails}>
                Try Again
              </button>
            </div>
          ) : (
            <>
              {/* Leaderboard Freeze Warning Banner */}
              {contest?.isFrozen && !freezeOverride && (
                <div className="freeze-notice-banner">
                  <Lock size={16} style={{ flexShrink: 0, color: '#fbbf24' }} />
                  <div>
                    <strong>Leaderboard Freeze Active:</strong> Submissions made during the final{' '}
                    {contest.leaderboardFreezeMinutes} minutes are hidden from public view. Scores
                    and rankings will be finalized when the contest concludes.
                  </div>
                </div>
              )}

              {/* 1. Summary KPI Cards */}
              <div className="participant-kpi-grid">
                <div className="participant-kpi-card rank-card">
                  <span className="participant-kpi-label">
                    <Trophy size={13} /> Official Rank
                  </span>
                  <div className="participant-kpi-val">{getRankBadge(summary?.rank)}</div>
                  <span className="participant-kpi-sub">
                    of {contest?.isRatingFinalized ? 'final' : 'current'} standings
                  </span>
                </div>

                <div className="participant-kpi-card score-card">
                  <span className="participant-kpi-label">
                    <Award size={13} /> Total Score
                  </span>
                  <div className="participant-kpi-val">{summary?.totalScore ?? 0} pts</div>
                  <span className="participant-kpi-sub">
                    {problems.reduce((acc, p) => acc + (p.maxPoints || 0), 0)} max points
                  </span>
                </div>

                <div className="participant-kpi-card solved-card">
                  <span className="participant-kpi-label">
                    <CheckCircle2 size={13} /> Solved
                  </span>
                  <div className="participant-kpi-val">
                    {summary?.solvedProblemsCount ?? 0} / {summary?.totalProblems ?? problems.length}
                  </div>
                  <span className="participant-kpi-sub">Problems accepted</span>
                </div>

                <div className="participant-kpi-card">
                  <span className="participant-kpi-label">
                    <Clock size={13} /> Total Penalty
                  </span>
                  <div className="participant-kpi-val">{summary?.totalPenaltyMinutes ?? 0}m</div>
                  <span className="participant-kpi-sub">Cumulative time offset</span>
                </div>

                <div className="participant-kpi-card">
                  <span className="participant-kpi-label">
                    <Layers size={13} /> Submissions
                  </span>
                  <div className="participant-kpi-val">{summary?.totalSubmissions ?? submissions.length}</div>
                  <span className="participant-kpi-sub">Total contest attempts</span>
                </div>

                {participant?.ratingChange !== null && participant?.ratingChange !== undefined && (
                  <div
                    className={`participant-kpi-card delta-card ${
                      participant.ratingChange >= 0 ? 'pos' : 'neg'
                    }`}
                  >
                    <span className="participant-kpi-label">
                      <Zap size={13} /> Rating Delta
                    </span>
                    <div className="participant-kpi-val">
                      {participant.ratingChange >= 0
                        ? `+${participant.ratingChange}`
                        : participant.ratingChange}
                    </div>
                    <span className="participant-kpi-sub">
                      New: {participant.newRating || participant.currentRating}
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Problem Performance Matrix */}
              <div className="participant-details-section">
                <div className="section-title-wrap">
                  <h3 className="section-heading">
                    <Layers size={16} style={{ color: '#38bdf8' }} />
                    <span>Problem Breakdown</span>
                    <span className="count-badge">{problems.length} challenges</span>
                  </h3>
                </div>

                <div className="problem-breakdown-grid">
                  {problems.map((prob) => {
                    const isSolved = prob.status === 'solved';
                    const isFailed = prob.status === 'failed';

                    return (
                      <div key={prob.problemId} className="problem-breakdown-card">
                        <div className="problem-card-top">
                          <div className="problem-card-title-group">
                            <span className="problem-card-title">
                              P{prob.problemOrder}. {prob.problemTitle || `Problem #${prob.problemId}`}
                            </span>
                            <div className="problem-card-sub">
                              <span className={`diff-badge ${prob.difficulty || 'medium'}`}>
                                {prob.difficulty || 'medium'}
                              </span>
                              <span>•</span>
                              <span>Max {prob.maxPoints} pts</span>
                            </div>
                          </div>

                          <span
                            className={`status-chip ${
                              isSolved ? 'solved' : isFailed ? 'failed' : 'unattempted'
                            }`}
                          >
                            {isSolved ? (
                              <>
                                <Check size={11} /> Solved
                              </>
                            ) : isFailed ? (
                              <>
                                <X size={11} /> Attempted
                              </>
                            ) : (
                              'Unattempted'
                            )}
                          </span>
                        </div>

                        <div className="problem-metrics-row">
                          <div className="problem-metric-item">
                            <span className="lbl">Points Earned</span>
                            <span
                              className="val"
                              style={{ color: prob.points > 0 ? '#38bdf8' : '#94a3b8' }}
                            >
                              {prob.points} / {prob.maxPoints}
                            </span>
                          </div>

                          <div className="problem-metric-item">
                            <span className="lbl">Attempts</span>
                            <span className="val">
                              {prob.attemptsCount}{' '}
                              {prob.failedAttemptsBeforeSolve > 0 && (
                                <span style={{ color: '#fb7185', fontSize: '0.68rem' }}>
                                  ({prob.failedAttemptsBeforeSolve} WA)
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="problem-metric-item">
                            <span className="lbl">Solve Time</span>
                            <span className="val">
                              {prob.acceptedTimeMinutes !== null ? `+${prob.acceptedTimeMinutes}m` : '—'}
                            </span>
                          </div>

                          <div className="problem-metric-item">
                            <span className="lbl">Penalty</span>
                            <span className="val">
                              {prob.penaltyContribution > 0 ? `+${prob.penaltyContribution}m` : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Submissions History Section */}
              <div className="participant-details-section">
                <div className="section-title-wrap">
                  <h3 className="section-heading">
                    <FileText size={16} style={{ color: '#818cf8' }} />
                    <span>Submission History</span>
                    <span className="count-badge">{submissions.length} attempts</span>
                  </h3>
                </div>

                {submissions.length === 0 ? (
                  <div className="submissions-empty-state">
                    <FileText size={32} />
                    <p>No contest submissions recorded for this participant.</p>
                  </div>
                ) : (
                  <div className="submissions-table-container">
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Problem</th>
                          <th style={{ textAlign: 'center' }}>Verdict</th>
                          <th style={{ textAlign: 'center' }}>Points</th>
                          <th>Language</th>
                          <th style={{ textAlign: 'center' }}>Runtime</th>
                          <th style={{ textAlign: 'center' }}>Memory</th>
                          <th>Submitted At</th>
                          <th style={{ textAlign: 'center', width: '90px' }}>Source Code</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map((sub) => (
                          <tr key={sub.id}>
                            <td className="sub-id-cell">#{sub.id}</td>
                            <td>
                              <span style={{ fontWeight: '600', color: '#f1f5f9' }}>
                                P{sub.problemOrder}. {sub.problemTitle || `Problem #${sub.problemId}`}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{getVerdictTag(sub.status)}</td>
                            <td
                              style={{
                                textAlign: 'center',
                                fontWeight: '700',
                                color: sub.score > 0 ? '#38bdf8' : '#94a3b8',
                              }}
                            >
                              {sub.score}
                            </td>
                            <td>
                              <span
                                style={{
                                  textTransform: 'uppercase',
                                  fontSize: '0.72rem',
                                  fontFamily: 'monospace',
                                  color: '#cbd5e1',
                                }}
                              >
                                {sub.language}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', color: '#94a3b8' }}>
                              {sub.executionTime !== null && sub.executionTime !== undefined
                                ? `${sub.executionTime}ms`
                                : '—'}
                            </td>
                            <td style={{ textAlign: 'center', color: '#94a3b8' }}>
                              {sub.memoryUsed !== null && sub.memoryUsed !== undefined
                                ? `${Math.round(sub.memoryUsed / 1024)}KB`
                                : '—'}
                            </td>
                            <td style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                              {formatDate(sub.submittedAt)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {sub.canViewCode ? (
                                <button
                                  type="button"
                                  className="btn-view-code"
                                  onClick={() => setActiveCodeSubmission(sub)}
                                  title="Inspect submission source code"
                                >
                                  <Code size={12} /> View Code
                                </button>
                              ) : (
                                <span
                                  style={{
                                    fontSize: '0.7rem',
                                    color: '#64748b',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                  }}
                                  title="Source code is protected by security policy"
                                >
                                  <Lock size={10} /> Hidden
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="participant-details-footer">
          <button type="button" className="btn-close-modal" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {/* Code Viewer Sub-Modal */}
      {activeCodeSubmission && (
        <SubmissionCodeModal
          submission={activeCodeSubmission}
          onClose={() => setActiveCodeSubmission(null)}
          onOpenInEditor={onOpenProblemInWorkspace}
        />
      )}
    </div>
  );
}
