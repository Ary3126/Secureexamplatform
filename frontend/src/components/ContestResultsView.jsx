import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Clock,
  Search,
  RefreshCw,
  ArrowLeft,
  Zap,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Lock,
  Layers,
  Users,
  BarChart3,
  Award,
  Sparkles,
  Eye,
} from 'lucide-react';
import CoderEmblem from './CoderEmblem';
import ParticipantResultDetailsModal from './ParticipantResultDetailsModal';
import './contestResultsView.css';

/**
 * ContestResultsView — Server-Authoritative Contest Results (Phase 7.5.8.2)
 * Renders official post-contest results, official rating adjustments,
 * winner podium, problem performance matrix, and personal participant scorecard.
 */
export default function ContestResultsView({
  contestId,
  token,
  currentUser,
  onNavigateBack,
  onNavigateLeaderboard,
  onNavigateProfile,
  onOpenProblemInWorkspace,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);

  // Fetch Authoritative Contest Results from backend
  const fetchResults = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      else setIsRefreshing(true);
      setError(null);

      try {
        const queryParams = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
        });
        if (search.trim()) {
          queryParams.append('search', search.trim());
        }

        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`/api/contests/${contestId}/results?${queryParams.toString()}`, {
          headers,
        });
        const result = await res.json();

        if (res.ok) {
          setData(result);
        } else {
          setError(result.message || 'Failed to load contest results');
        }
      } catch (err) {
        setError(err.message || 'Network error fetching contest results');
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [contestId, token, page, limit, search]
  );

  // Fetch on mount or parameter changes
  useEffect(() => {
    fetchResults(true);
  }, [fetchResults]);

  const getTierDetails = (rating) => {
    const r = rating || 1200;
    if (r >= 2400) return { label: 'Grandmaster', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' };
    if (r >= 2100) return { label: 'Master', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
    if (r >= 1900) return { label: 'Candidate Master', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' };
    if (r >= 1600) return { label: 'Expert', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
    if (r >= 1400) return { label: 'Specialist', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' };
    if (r >= 1200) return { label: 'Pupil', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
    return { label: 'Newbie', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
  };

  const getStatusBadge = (contest) => {
    if (!contest) return null;
    if (contest.isRatingFinalized) {
      return (
        <span className="results-badge badge-finalized">
          <CheckCircle2 size={13} /> Official Results
        </span>
      );
    }
    if (contest.isFrozen) {
      return (
        <span className="results-badge badge-frozen">
          <Lock size={13} /> Frozen (Provisional)
        </span>
      );
    }
    if (contest.runtimeState === 'running') {
      return (
        <span className="results-badge badge-live">
          <span className="live-dot-pulse" /> Live In Progress
        </span>
      );
    }
    if (contest.runtimeState === 'upcoming') {
      return (
        <span className="results-badge badge-upcoming">
          <Clock size={13} /> Upcoming
        </span>
      );
    }
    return (
      <span className="results-badge badge-ended">
        <Clock size={13} /> Ended (Standings Concluded)
      </span>
    );
  };

  const formatTimestamp = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const contest = data?.contest;
  const problems = data?.problems || [];
  const results = data?.results || data?.standings || [];
  const podium = data?.podium || [];
  const userResult = data?.userResult || data?.userPosition;
  const pagination = data?.pagination || {};
  const resultSummary = data?.resultSummary || data?.contestSummary;

  const isManager = Boolean(
    currentUser &&
    (currentUser.role === 'super_admin' ||
     currentUser.role === 'contest_admin' ||
     (currentUser.role === 'professor' && contest && (currentUser.id === contest.createdBy || currentUser.id === contest.created_by)))
  );

  return (
    <div className="contest-results-container">
      {/* 1. Header Section */}
      <div className="results-header-section">
        <div className="results-header-left">
          <button
            className="results-back-btn"
            onClick={onNavigateBack}
            aria-label="Back to Dashboard"
          >
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </button>

          <div className="results-title-wrap">
            <div className="results-title-row">
              <h1 className="results-contest-title">{contest?.title || 'Contest Results'}</h1>
              {getStatusBadge(contest)}
              {contest?.isRated && (
                <span className="rated-pill-badge">
                  <Zap size={12} /> Rated Contest
                </span>
              )}
            </div>
            <p className="results-contest-desc">
              {contest?.description || 'Server-authoritative contest results, performance metrics, and official rankings.'}
            </p>
          </div>
        </div>

        {/* View Switcher & Action Controls */}
        <div className="results-header-right">
          <div className="results-view-switcher">
            {onNavigateLeaderboard && (
              <button
                className="view-switch-btn"
                onClick={() => onNavigateLeaderboard(contestId)}
                title="Switch to live scoreboard view"
              >
                <BarChart3 size={14} />
                <span>Scoreboard</span>
              </button>
            )}
            <button className="view-switch-btn active" title="Currently viewing official results">
              <Award size={14} />
              <span>Results & Awards</span>
            </button>
          </div>

          <button
            className="results-refresh-btn"
            onClick={() => fetchResults(false)}
            disabled={isRefreshing}
            title="Refresh contest results"
          >
            <RefreshCw size={15} className={isRefreshing ? 'spin-anim' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Official Status / Celebration Banner */}
      {contest?.isRatingFinalized ? (
        <div className="results-status-banner banner-finalized" role="alert">
          <div className="status-banner-icon">
            <Sparkles size={22} className="sparkle-anim" />
          </div>
          <div className="status-banner-content">
            <h4>Official Contest Results & Rating Adjustments Finalized</h4>
            <p>
              This contest has concluded and all submissions have been authoritatively evaluated.
              Official rankings and competitive rating updates have been permanently applied.
              {contest.ratingsFinalizedAt && (
                <span className="banner-timestamp">
                  {' '}• Finalized on {formatTimestamp(contest.ratingsFinalizedAt)}
                </span>
              )}
            </p>
          </div>
        </div>
      ) : contest?.runtimeState === 'ended' ? (
        <div className="results-status-banner banner-ended" role="alert">
          <div className="status-banner-icon">
            <Clock size={20} />
          </div>
          <div className="status-banner-content">
            <h4>Contest Concluded — Standings Finalized</h4>
            <p>
              The contest duration has completed and code submissions are closed.
              Final standings are calculated below. Official rating adjustments will be finalized shortly.
            </p>
          </div>
        </div>
      ) : contest?.isFrozen ? (
        <div className="results-status-banner banner-frozen" role="alert">
          <div className="status-banner-icon">
            <Lock size={20} />
          </div>
          <div className="status-banner-content">
            <h4>Leaderboard is Currently Frozen</h4>
            <p>
              Provisional rankings are shown. Submissions made during the final{' '}
              {contest.leaderboardFreezeMinutes} minutes will be unveiled when the contest is finalized.
            </p>
          </div>
        </div>
      ) : null}

      {/* Error State */}
      {error && (
        <div className="results-error-card">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => fetchResults(true)}>Retry</button>
        </div>
      )}

      {/* 3. Summary Statistics Cards */}
      {resultSummary && (
        <div className="results-summary-grid">
          <div className="summary-stat-card">
            <div className="stat-card-header">
              <span className="stat-card-label">Participants</span>
              <Users size={16} className="stat-card-icon text-blue" />
            </div>
            <div className="stat-card-value">{resultSummary.totalParticipants}</div>
            <span className="stat-card-sub">Enrolled competitors</span>
          </div>

          <div className="summary-stat-card">
            <div className="stat-card-header">
              <span className="stat-card-label">Contest Problems</span>
              <Layers size={16} className="stat-card-icon text-indigo" />
            </div>
            <div className="stat-card-value">{resultSummary.totalProblems}</div>
            <span className="stat-card-sub">Evaluated challenges</span>
          </div>

          <div className="summary-stat-card">
            <div className="stat-card-header">
              <span className="stat-card-label">Winning Score</span>
              <Trophy size={16} className="stat-card-icon text-amber" />
            </div>
            <div className="stat-card-value text-amber">{resultSummary.topScore} pts</div>
            <span className="stat-card-sub">Highest points achieved</span>
          </div>

          <div className="summary-stat-card">
            <div className="stat-card-header">
              <span className="stat-card-label">Average Score</span>
              <BarChart3 size={16} className="stat-card-icon text-cyan" />
            </div>
            <div className="stat-card-value">{resultSummary.averageScore} pts</div>
            <span className="stat-card-sub">Median: {resultSummary.medianScore} pts</span>
          </div>
        </div>
      )}

      {/* 4. Top 3 Winners Podium */}
      {podium.length > 0 && !search && (
        <div className="results-podium-section">
          <div className="podium-section-header">
            <Trophy size={18} className="text-amber" />
            <h2>Contest Champions & Podium</h2>
          </div>

          <div className="results-podium-grid">
            {/* Rank 2 (Silver) */}
            {podium[1] ? (
              <div className="podium-card podium-silver">
                <div className="podium-badge-pill silver">
                  <span>🥈 Rank 2</span>
                </div>
                <div className="podium-avatar-wrap">
                  <CoderEmblem size="md" rating={podium[1].currentRating} username={podium[1].username} />
                </div>
                <h3
                  className="podium-user-name"
                  onClick={() => onNavigateProfile && onNavigateProfile(podium[1].username)}
                >
                  {podium[1].fullName || podium[1].username}
                </h3>
                <span className="podium-user-handle">@{podium[1].username}</span>
                <div className="podium-stats-row">
                  <span className="podium-score">{podium[1].totalScore} pts</span>
                  <span className="podium-solved">{podium[1].solvedProblemsCount} solved</span>
                </div>
                {podium[1].ratingChange !== null && podium[1].ratingChange !== undefined && (
                  <div className={`podium-delta-pill ${podium[1].ratingChange >= 0 ? 'pos' : 'neg'}`}>
                    {podium[1].ratingChange >= 0 ? `+${podium[1].ratingChange}` : podium[1].ratingChange} rating
                  </div>
                )}
              </div>
            ) : (
              <div className="podium-card podium-empty" />
            )}

            {/* Rank 1 (Gold - Champion) */}
            {podium[0] ? (
              <div className="podium-card podium-gold champion-glow">
                <div className="podium-badge-pill gold">
                  <Trophy size={14} /> <span>🥇 Champion (Rank 1)</span>
                </div>
                <div className="podium-avatar-wrap champion">
                  <CoderEmblem size="lg" rating={podium[0].currentRating} username={podium[0].username} />
                </div>
                <h3
                  className="podium-user-name"
                  onClick={() => onNavigateProfile && onNavigateProfile(podium[0].username)}
                >
                  {podium[0].fullName || podium[0].username}
                </h3>
                <span className="podium-user-handle">@{podium[0].username}</span>
                <div className="podium-stats-row">
                  <span className="podium-score-champion">{podium[0].totalScore} pts</span>
                  <span className="podium-solved">{podium[0].solvedProblemsCount} solved</span>
                </div>
                {podium[0].ratingChange !== null && podium[0].ratingChange !== undefined && (
                  <div className={`podium-delta-pill ${podium[0].ratingChange >= 0 ? 'pos' : 'neg'}`}>
                    {podium[0].ratingChange >= 0 ? `+${podium[0].ratingChange}` : podium[0].ratingChange} rating
                  </div>
                )}
              </div>
            ) : null}

            {/* Rank 3 (Bronze) */}
            {podium[2] ? (
              <div className="podium-card podium-bronze">
                <div className="podium-badge-pill bronze">
                  <span>🥉 Rank 3</span>
                </div>
                <div className="podium-avatar-wrap">
                  <CoderEmblem size="md" rating={podium[2].currentRating} username={podium[2].username} />
                </div>
                <h3
                  className="podium-user-name"
                  onClick={() => onNavigateProfile && onNavigateProfile(podium[2].username)}
                >
                  {podium[2].fullName || podium[2].username}
                </h3>
                <span className="podium-user-handle">@{podium[2].username}</span>
                <div className="podium-stats-row">
                  <span className="podium-score">{podium[2].totalScore} pts</span>
                  <span className="podium-solved">{podium[2].solvedProblemsCount} solved</span>
                </div>
                {podium[2].ratingChange !== null && podium[2].ratingChange !== undefined && (
                  <div className={`podium-delta-pill ${podium[2].ratingChange >= 0 ? 'pos' : 'neg'}`}>
                    {podium[2].ratingChange >= 0 ? `+${podium[2].ratingChange}` : podium[2].ratingChange} rating
                  </div>
                )}
              </div>
            ) : (
              <div className="podium-card podium-empty" />
            )}
          </div>
        </div>
      )}

      {/* 5. Logged-In User Performance Banner */}
      {userResult?.isParticipating && (
        <div className="results-user-card">
          <div className="user-card-left">
            <div className="user-card-rank-badge">
              <span className="rank-label">YOUR FINAL RANK</span>
              <span className="rank-number">#{userResult.rank}</span>
            </div>
            <div className="user-card-details">
              <div className="user-card-name-row">
                <span className="user-card-name">{userResult.fullName || userResult.username}</span>
                <span className="user-card-badge-you">YOU</span>
              </div>
              <div className="user-card-metrics">
                <span>
                  <strong>{userResult.solvedProblemsCount}</strong> / {userResult.totalProblems} Solved
                </span>
                <span className="dot-sep">•</span>
                <span>
                  <strong>{userResult.totalScore}</strong> Points
                </span>
                <span className="dot-sep">•</span>
                <span>Total Penalty: {userResult.totalPenaltyMinutes}m</span>
              </div>
            </div>
          </div>

          {userResult.ratingChange !== null && userResult.ratingChange !== undefined && (
            <div className="user-card-rating-box">
              <span className="rating-box-label">Rating Adjustment</span>
              <span
                className={`rating-box-value ${userResult.ratingChange >= 0 ? 'positive' : 'negative'}`}
              >
                {userResult.ratingChange >= 0 ? `+${userResult.ratingChange}` : userResult.ratingChange}
              </span>
              {userResult.newRating && (
                <span className="rating-box-new">New Rating: {userResult.newRating}</span>
              )}
            </div>
          )}

          <div className="user-card-actions">
            <button
              type="button"
              className="user-card-inspect-btn"
              onClick={() => setSelectedParticipantId('me')}
              title="Inspect your detailed problem breakdown and submission history"
            >
              <Eye size={14} />
              <span>Inspect Breakdown</span>
            </button>
          </div>
        </div>
      )}

      {/* 6. Filter & Search Toolbar */}
      <div className="results-toolbar">
        <div className="results-search-box">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder="Search participant by name or username..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search && (
            <button className="clear-search-btn" onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>

        <div className="results-count-pill">
          <span>Results: <strong>{pagination.totalParticipants || results.length}</strong></span>
        </div>
      </div>

      {/* 7. Authoritative Results Table */}
      <div className="results-table-card">
        {loading ? (
          <div className="results-loading-state">
            <div className="loading-spinner" />
            <p>Loading authoritative contest results...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="results-empty-state">
            <Trophy size={42} className="empty-icon" />
            <h3>No Results Found</h3>
            <p>{search ? 'No participants match your search criteria.' : 'No participant scores recorded for this contest.'}</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="results-table">
              <thead>
                <tr>
                  <th className="th-rank">#</th>
                  <th className="th-user">Participant</th>
                  <th className="th-score">Score</th>
                  <th className="th-solved">Solved</th>
                  <th className="th-penalty">Penalty</th>
                  {contest?.isRatingFinalized && <th className="th-delta">Δ Rating</th>}
                  {problems.map((prob, idx) => (
                    <th
                      key={prob.problemId}
                      className="th-problem"
                      title={`${prob.title} (${prob.maxPoints} pts)`}
                      onClick={() => onOpenProblemInWorkspace && onOpenProblemInWorkspace(prob.problemId)}
                    >
                      <div className="prob-header-cell">
                        <span className="prob-order">P{idx + 1}</span>
                        <span className="prob-points">{prob.maxPoints}p</span>
                      </div>
                    </th>
                  ))}
                  <th className="th-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => {
                  const isSelf = currentUser && p.userId === currentUser.id;
                  const tier = getTierDetails(p.currentRating);

                  return (
                    <tr key={p.userId} className={`results-row ${isSelf ? 'results-row-self' : ''}`}>
                      {/* Rank Cell */}
                      <td className="td-rank">
                        <div className="rank-cell">
                          {p.rank === 1 ? (
                            <span className="rank-medal gold">🥇 1</span>
                          ) : p.rank === 2 ? (
                            <span className="rank-medal silver">🥈 2</span>
                          ) : p.rank === 3 ? (
                            <span className="rank-medal bronze">🥉 3</span>
                          ) : (
                            <span className="rank-standard">{p.rank}</span>
                          )}
                        </div>
                      </td>

                      {/* Participant Cell */}
                      <td className="td-user">
                        <div className="results-user-cell">
                          <CoderEmblem size="xs" rating={p.currentRating} username={p.username} />
                          <div className="results-user-info">
                            <div className="user-name-line">
                              <span
                                className="results-name-link"
                                onClick={() => onNavigateProfile && onNavigateProfile(p.username)}
                              >
                                {p.fullName || p.username}
                              </span>
                              {isSelf && <span className="you-pill-tag">YOU</span>}
                            </div>
                            <span className="results-handle-line" style={{ color: tier.color }}>
                              @{p.username}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Score Cell */}
                      <td className="td-score">
                        <span className="score-val-bold">{p.totalScore}</span>
                      </td>

                      {/* Solved Count Cell */}
                      <td className="td-solved">
                        <span className="solved-pill">
                          {p.solvedProblemsCount} / {problems.length}
                        </span>
                      </td>

                      {/* Penalty Cell */}
                      <td className="td-penalty">
                        <span className="penalty-val">{p.totalPenaltyMinutes}m</span>
                      </td>

                      {/* Rating Change Cell (if Finalized) */}
                      {contest?.isRatingFinalized && (
                        <td className="td-delta">
                          {p.ratingChange !== null && p.ratingChange !== undefined ? (
                            <span className={`delta-tag ${p.ratingChange >= 0 ? 'pos' : 'neg'}`}>
                              {p.ratingChange >= 0 ? `+${p.ratingChange}` : p.ratingChange}
                            </span>
                          ) : (
                            <span className="delta-none">—</span>
                          )}
                        </td>
                      )}

                      {/* Problem Cells */}
                      {p.problems?.map((prob) => {
                        const isSolved = prob.status === 'solved';
                        const isFailed = prob.status === 'failed';

                        return (
                          <td key={prob.problemId} className="td-problem-cell">
                            {isSolved ? (
                              <div
                                className="cell-chip chip-solved"
                                title={`Solved in ${prob.acceptedTimeMinutes}m with ${prob.failedAttemptsBeforeSolve} failed attempts`}
                              >
                                <span className="chip-symbol">✓</span>
                                <span className="chip-detail">
                                  {prob.failedAttemptsBeforeSolve > 0 ? `+${prob.failedAttemptsBeforeSolve}` : '+'}
                                </span>
                                {prob.acceptedTimeMinutes !== null && (
                                  <span className="chip-time">{prob.acceptedTimeMinutes}m</span>
                                )}
                              </div>
                            ) : isFailed ? (
                              <div
                                className="cell-chip chip-failed"
                                title={`${prob.attemptsCount} failed attempt(s)`}
                              >
                                <span className="chip-symbol">✗</span>
                                <span className="chip-detail">-{prob.attemptsCount}</span>
                              </div>
                            ) : (
                              <div className="cell-chip chip-unattempted">
                                <span>—</span>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Action Cell */}
                      <td className="td-action">
                        {(isSelf || isManager) ? (
                          <button
                            type="button"
                            className="btn-results-inspect"
                            onClick={() => setSelectedParticipantId(p.userId)}
                            title={`Inspect performance details for ${p.fullName || p.username}`}
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>
                        ) : (
                          <span style={{ color: '#475569', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 8. Pagination Toolbar */}
        {pagination.totalPages > 1 && (
          <div className="results-pagination-bar">
            <span className="pagination-summary">
              Showing {(pagination.currentPage - 1) * pagination.limit + 1}–
              {Math.min(pagination.currentPage * pagination.limit, pagination.totalParticipants)} of{' '}
              {pagination.totalParticipants} participants
            </span>
            <div className="pagination-buttons">
              <button
                className="pag-btn"
                disabled={!pagination.hasPrev}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="pag-page-indicator">
                Page {pagination.currentPage} of {pagination.totalPages}
              </span>
              <button
                className="pag-btn"
                disabled={!pagination.hasNext}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 9. Participant Result Details Modal (Phase 7.5.8.4) */}
      {selectedParticipantId && (
        <ParticipantResultDetailsModal
          contestId={contestId}
          participantId={selectedParticipantId}
          initialFreezeOverride={false}
          isManager={isManager}
          token={token}
          onClose={() => setSelectedParticipantId(null)}
          onOpenProblemInWorkspace={onOpenProblemInWorkspace}
        />
      )}
    </div>
  );
}
