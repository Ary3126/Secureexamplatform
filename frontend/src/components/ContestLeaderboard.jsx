import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Clock,
  Search,
  RefreshCw,
  ArrowLeft,
  Zap,
  Radio,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Lock,
} from 'lucide-react';
import CoderEmblem from './CoderEmblem';

export default function ContestLeaderboard({
  contestId,
  token,
  currentUser,
  onNavigateBack,
  onNavigateProfile,
  onOpenProblemInWorkspace,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [isLiveActive, setIsLiveActive] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  const timerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Fetch Authoritative Leaderboard from backend
  const fetchLeaderboard = useCallback(
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

        const res = await fetch(`/api/contests/${contestId}/leaderboard?${queryParams.toString()}`, {
          headers,
        });
        const result = await res.json();

        if (res.ok) {
          setData(result);
        } else {
          setError(result.message || 'Failed to load contest leaderboard');
        }
      } catch (err) {
        setError(err.message || 'Network error fetching contest leaderboard');
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [contestId, token, page, limit, search]
  );

  // Initial Fetch & Search Debounce
  useEffect(() => {
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  // Live Auto-Refresh Polling (every 10s during active contests)
  useEffect(() => {
    if (!isLiveActive || !data?.contest) return;

    const runtimeState = data.contest.runtimeState;
    if (runtimeState === 'ended' && data.contest.isRatingFinalized) {
      // No need to poll finalized contests
      return;
    }

    pollIntervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchLeaderboard(false);
      }
    }, 10000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isLiveActive, data?.contest, fetchLeaderboard]);

  // Server-Authoritative Live Contest Countdown Clock
  useEffect(() => {
    if (!data?.contest) return;

    const endTime = new Date(data.contest.endTime).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = endTime - now;

      if (diff <= 0) {
        setTimeRemaining('00:00:00');
      } else {
        const hrs = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);

        const formatUnit = (n) => String(n).padStart(2, '0');
        setTimeRemaining(`${formatUnit(hrs)}:${formatUnit(mins)}:${formatUnit(secs)}`);
      }
    };

    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [data?.contest]);

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
        <span className="leaderboard-state-badge badge-finalized">
          <Trophy size={14} /> Finalized
        </span>
      );
    }
    if (contest.isFrozen) {
      return (
        <span className="leaderboard-state-badge badge-frozen">
          <Lock size={14} /> Frozen
        </span>
      );
    }
    if (contest.runtimeState === 'running') {
      return (
        <span className="leaderboard-state-badge badge-live">
          <span className="live-dot-pulse" /> Live
        </span>
      );
    }
    if (contest.runtimeState === 'upcoming') {
      return (
        <span className="leaderboard-state-badge badge-upcoming">
          <Clock size={14} /> Upcoming
        </span>
      );
    }
    return (
      <span className="leaderboard-state-badge badge-ended">
        <Clock size={14} /> Ended
      </span>
    );
  };

  const contest = data?.contest;
  const problems = data?.problems || [];
  const standings = data?.standings || [];
  const podium = data?.podium || [];
  const userPosition = data?.userPosition;
  const pagination = data?.pagination || {};
  const contestSummary = data?.contestSummary;

  return (
    <div className="leaderboard-page-container">
      {/* 1. Header Navigation Bar */}
      <div className="leaderboard-header-section">
        <div className="leaderboard-header-left">
          <button
            className="leaderboard-back-btn"
            onClick={onNavigateBack}
            aria-label="Back to Dashboard"
          >
            <ArrowLeft size={18} />
            <span>Dashboard</span>
          </button>
          <div className="leaderboard-title-wrap">
            <div className="leaderboard-title-row">
              <h1 className="leaderboard-contest-title">{contest?.title || 'Contest Leaderboard'}</h1>
              {getStatusBadge(contest)}
              {contest?.isRated && (
                <span className="rated-pill-badge">
                  <Zap size={12} /> Rated Contest
                </span>
              )}
            </div>
            <p className="leaderboard-contest-desc">
              {contest?.description || 'Official authoritative contest scoreboard and standings.'}
            </p>
          </div>
        </div>

        {/* Live Timer & Action Controls */}
        <div className="leaderboard-header-right">
          {contest?.runtimeState === 'running' && (
            <div className="leaderboard-timer-card">
              <span className="timer-label">Time Remaining</span>
              <div className="timer-digits">
                <Clock size={16} className="timer-icon" />
                <span>{timeRemaining || '00:00:00'}</span>
              </div>
            </div>
          )}

          <div className="leaderboard-action-group">
            <button
              className={`live-toggle-btn ${isLiveActive ? 'active' : ''}`}
              onClick={() => setIsLiveActive(!isLiveActive)}
              title={isLiveActive ? 'Live auto-refresh enabled (every 10s)' : 'Live auto-refresh paused'}
            >
              <Radio size={14} className={isLiveActive ? 'live-icon-active' : ''} />
              <span>Live Updates: {isLiveActive ? 'ON' : 'OFF'}</span>
            </button>
            <button
              className="leaderboard-refresh-btn"
              onClick={() => fetchLeaderboard(false)}
              disabled={isRefreshing}
              title="Refresh standings"
            >
              <RefreshCw size={16} className={isRefreshing ? 'spin-anim' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Freeze Alert Banner */}
      {contest?.isFrozen && (
        <div className="leaderboard-freeze-banner" role="alert">
          <div className="freeze-banner-icon">
            <Lock size={20} />
          </div>
          <div className="freeze-banner-content">
            <h4>Leaderboard is Currently Frozen</h4>
            <p>
              Submissions continue to be evaluated normally by the judge. Visible rankings are frozen for the final{' '}
              {contest.leaderboardFreezeMinutes} minutes. Final standings and rating changes will be unveiled when the contest concludes.
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="leaderboard-error-card">
          <AlertCircle size={20} />
          <span>{error}</span>
          <button onClick={() => fetchLeaderboard(true)}>Retry</button>
        </div>
      )}

      {/* 2. Top 3 Podium Section */}
      {podium.length > 0 && !search && (
        <div className="leaderboard-podium-section">
          <div className="podium-grid">
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
              </div>
            ) : (
              <div className="podium-card podium-empty" />
            )}

            {/* Rank 1 (Gold) */}
            {podium[0] ? (
              <div className="podium-card podium-gold">
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
              </div>
            ) : (
              <div className="podium-card podium-empty" />
            )}
          </div>
        </div>
      )}

      {/* 3. Logged-in User Position Sticky Callout */}
      {userPosition?.isParticipating && (
        <div className="leaderboard-user-position-banner">
          <div className="user-pos-left">
            <div className="user-pos-rank-badge">
              <span className="rank-label">YOUR RANK</span>
              <span className="rank-number">#{userPosition.rank}</span>
            </div>
            <div className="user-pos-details">
              <div className="user-pos-name-row">
                <span className="user-pos-name">{userPosition.fullName || userPosition.username}</span>
                <span className="user-pos-badge-you">YOU</span>
              </div>
              <div className="user-pos-metrics">
                <span>
                  <strong>{userPosition.solvedProblemsCount}</strong> / {userPosition.totalProblems} Solved
                </span>
                <span className="dot-sep">•</span>
                <span>
                  <strong>{userPosition.totalScore}</strong> Points
                </span>
                <span className="dot-sep">•</span>
                <span>Penalty: {userPosition.totalPenaltyMinutes}m</span>
              </div>
            </div>
          </div>
          {userPosition.ratingChange !== null && userPosition.ratingChange !== undefined && (
            <div className="user-pos-rating-delta">
              <span className="delta-label">Rating Change</span>
              <span className={`delta-value ${userPosition.ratingChange >= 0 ? 'positive' : 'negative'}`}>
                {userPosition.ratingChange >= 0 ? `+${userPosition.ratingChange}` : userPosition.ratingChange}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 4. Controls: Search & Summary Stats */}
      <div className="leaderboard-filter-toolbar">
        <div className="leaderboard-search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search by username or name..."
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

        {contestSummary && (
          <div className="leaderboard-quick-summary">
            <div className="summary-pill">
              <span className="pill-title">Participants:</span>
              <strong>{contestSummary.totalParticipants}</strong>
            </div>
            <div className="summary-pill">
              <span className="pill-title">Problems:</span>
              <strong>{contestSummary.totalProblems}</strong>
            </div>
            <div className="summary-pill">
              <span className="pill-title">Top Score:</span>
              <strong>{contestSummary.topScore}</strong>
            </div>
          </div>
        )}
      </div>

      {/* 5. Problem-by-Problem Scoreboard Table */}
      <div className="leaderboard-table-card">
        {loading ? (
          <div className="leaderboard-loading-state">
            <div className="loading-spinner" />
            <p>Loading authoritative contest standings...</p>
          </div>
        ) : standings.length === 0 ? (
          <div className="leaderboard-empty-state">
            <Trophy size={40} className="empty-icon" />
            <h3>No Participants Found</h3>
            <p>{search ? 'No participants match your search query.' : 'No students have joined this contest yet.'}</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="scoreboard-table">
              <thead>
                <tr>
                  <th className="th-rank">#</th>
                  <th className="th-user">Coder</th>
                  <th className="th-score">Score</th>
                  <th className="th-penalty">Penalty</th>
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
                </tr>
              </thead>
              <tbody>
                {standings.map((p) => {
                  const isSelf = currentUser && p.userId === currentUser.id;
                  const tier = getTierDetails(p.currentRating);

                  return (
                    <tr key={p.userId} className={`scoreboard-row ${isSelf ? 'scoreboard-row-self' : ''}`}>
                      {/* Rank Column */}
                      <td className="td-rank">
                        <div className="rank-badge-cell">
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

                      {/* User Column */}
                      <td className="td-user">
                        <div className="scoreboard-user-cell">
                          <CoderEmblem size="xs" rating={p.currentRating} username={p.username} />
                          <div className="scoreboard-user-info">
                            <div className="user-name-line">
                              <span
                                className="scoreboard-name-link"
                                onClick={() => onNavigateProfile && onNavigateProfile(p.username)}
                              >
                                {p.fullName || p.username}
                              </span>
                              {isSelf && <span className="you-pill-tag">YOU</span>}
                            </div>
                            <span className="scoreboard-handle-line" style={{ color: tier.color }}>
                              @{p.username}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Total Score */}
                      <td className="td-score">
                        <span className="score-value-bold">{p.totalScore}</span>
                        <span className="score-solved-count">{p.solvedProblemsCount} solved</span>
                      </td>

                      {/* Total Penalty */}
                      <td className="td-penalty">
                        <span className="penalty-value">{p.totalPenaltyMinutes}m</span>
                      </td>

                      {/* Problem Cells */}
                      {p.problems?.map((prob) => {
                        const isSolved = prob.status === 'solved';
                        const isFailed = prob.status === 'failed';

                        return (
                          <td key={prob.problemId} className="td-problem-cell">
                            {isSolved ? (
                              <div className="cell-chip chip-solved" title={`Solved in ${prob.acceptedTimeMinutes}m with ${prob.failedAttemptsBeforeSolve} wrong attempts`}>
                                <span className="chip-symbol">✓</span>
                                <span className="chip-detail">
                                  {prob.failedAttemptsBeforeSolve > 0 ? `+${prob.failedAttemptsBeforeSolve}` : '+'}
                                </span>
                                {prob.acceptedTimeMinutes !== null && (
                                  <span className="chip-time">{prob.acceptedTimeMinutes}m</span>
                                )}
                              </div>
                            ) : isFailed ? (
                              <div className="cell-chip chip-failed" title={`${prob.attemptsCount} failed attempt(s)`}>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {pagination.totalPages > 1 && (
          <div className="leaderboard-pagination-bar">
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
    </div>
  );
}
