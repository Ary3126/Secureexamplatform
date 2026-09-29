import React, { useEffect, useState } from 'react';
import {
  Trophy,
  Flame,
  Clock,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  User,
  Award,
  Code2,
  AlertCircle,
  Play,
  RotateCcw,
  Sparkles,
  Star,
  BookOpen,
  Zap,
  BookmarkCheck,
} from 'lucide-react';
import DashboardSkillsWidget from './DashboardSkillsWidget';

export default function StudentDashboard({
  token,
  user,
  onSelectContest,
  onSelectProblem,
  onNavigateProblems,
  onNavigateSubmissions,
  onNavigateProfile,
  onNavigateLeaderboard,
}) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrollingContestId, setEnrollingContestId] = useState(null);
  const [enrollSuccess, setEnrollSuccess] = useState(null);
  const [enrollError, setEnrollError] = useState(null);

  useEffect(() => {
    fetchDashboard();
  }, [token]);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users/dashboard', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setDashboardData(data);
      } else {
        setError(data.message || 'Failed to load dashboard data');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async (contestId, contestTitle) => {
    if (enrollingContestId) return;
    setEnrollingContestId(contestId);
    setEnrollError(null);
    setEnrollSuccess(null);
    try {
      const res = await fetch(`/api/contests/${contestId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.status === 201) {
        setEnrollSuccess(`Successfully registered for "${contestTitle || 'Contest'}"!`);
        // Refresh authoritative dashboard data
        const refreshRes = await fetch('/api/users/dashboard', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setDashboardData(refreshData);
        }
      } else if (res.status === 409) {
        setEnrollSuccess(`You are already registered for "${contestTitle || 'Contest'}".`);
        const refreshRes = await fetch('/api/users/dashboard', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setDashboardData(refreshData);
        }
      } else if (res.status === 401) {
        setEnrollError('Authentication required. Please log in to enroll.');
      } else if (res.status === 403) {
        setEnrollError(data.message || 'Contest registration is restricted to student accounts.');
      } else if (res.status === 404) {
        setEnrollError('Contest not found or no longer available.');
      } else {
        setEnrollError(data.message || 'Failed to register for contest');
      }
    } catch (err) {
      setEnrollError(err.message || 'Network error occurred during registration');
    } finally {
      setEnrollingContestId(null);
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    return new Date(isoStr).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getVerdictBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return 'verdict-accepted-pill';
      case 'wrong_answer':
        return 'verdict-wa-pill';
      case 'time_limit_exceeded':
        return 'verdict-tle-pill';
      case 'memory_limit_exceeded':
        return 'verdict-mle-pill';
      case 'runtime_error':
      case 'compilation_error':
        return 'verdict-err-pill';
      default:
        return 'verdict-default-pill';
    }
  };

  const getDifficultyClass = (diff) => {
    switch (diff?.toLowerCase()) {
      case 'easy':
        return 'diff-easy';
      case 'medium':
        return 'diff-medium';
      case 'hard':
        return 'diff-hard';
      default:
        return 'diff-easy';
    }
  };

  if (loading) {
    return (
      <div className="dashboard-container loading-state">
        <div className="btn-spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }}></div>
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading your dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container error-state">
        <div className="dash-error-card">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <h3>Unable to load dashboard</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={fetchDashboard}>
            <RotateCcw className="w-4 h-4" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const {
    profileSummary,
    runningContests = [],
    upcomingContests = [],
    joinedContests = [],
    problemsSolvedCount = 0,
    totalAttemptsCount = 0,
    continuePracticing = null,
    savedProblems = [],
    recentSubmissions = [],
  } = dashboardData || {};

  return (
    <div className="dashboard-container">
      {/* 1. Profile Summary Banner */}
      <div className="dashboard-banner">
        <div className="profile-badge-section">
          <img
            src={profileSummary?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.username || 'user'}`}
            alt="Avatar"
            className="dashboard-avatar"
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <h2 className="banner-title">Welcome back, {profileSummary?.fullName || user?.username}!</h2>
              <span className="user-role-tag">{user?.role || 'Student'}</span>
            </div>
            <p className="banner-bio">{profileSummary?.bio || 'Track your coding progress, join contests, and practice problems.'}</p>
          </div>
        </div>

        <div className="banner-actions">
          <div className="stat-pill">
            <div className="stat-pill-icon stat-icon-blue">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <span className="stat-num">{problemsSolvedCount}</span>
              <span className="stat-label">Solved</span>
            </div>
          </div>

          <div className="stat-pill">
            <div className="stat-pill-icon stat-icon-amber">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <span className="stat-num">{totalAttemptsCount}</span>
              <span className="stat-label">Attempts</span>
            </div>
          </div>

          <div className="stat-pill" onClick={onNavigateProfile} style={{ cursor: 'pointer' }} title="View Competitive Rating & History">
            <div className="stat-pill-icon stat-icon-emerald">
              <Star className="w-5 h-5" />
            </div>
            <div>
              <span className="stat-num">{profileSummary?.currentRating || 1200}</span>
              <span className="stat-label">Rating {profileSummary?.ratingStatus === 'provisional' ? '(Prov)' : ''}</span>
            </div>
          </div>

          <button className="btn btn-outline" onClick={onNavigateProfile}>
            <User className="w-4 h-4" />
            <span>Profile</span>
          </button>
        </div>
      </div>

      {/* 2. Quick Continue Practicing Hero Section */}
      <section className="dash-hero-continue">
        {continuePracticing ? (
          <div className="continue-practicing-card">
            <div className="continue-card-content">
              <div className="continue-header-tag">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>Continue Practicing</span>
              </div>
              <h3 className="continue-problem-title">{continuePracticing.title}</h3>
              <div className="continue-problem-meta">
                <span className={`diff-pill ${getDifficultyClass(continuePracticing.difficulty)}`}>
                  {continuePracticing.difficulty ? continuePracticing.difficulty.toUpperCase() : 'EASY'}
                </span>
                <span className="continue-meta-item">
                  <Code2 className="w-3.5 h-3.5 text-muted" />
                  {continuePracticing.codingMode === 'function' ? 'Function Mode' : 'Full Program'}
                </span>
                <span className="continue-meta-item">
                  <Clock className="w-3.5 h-3.5 text-muted" />
                  Last attempt: {formatDate(continuePracticing.lastAttemptedAt)}
                </span>
              </div>
            </div>
            <div className="continue-card-action">
              <button
                type="button"
                className="btn btn-primary btn-continue-action"
                onClick={() => onSelectProblem && onSelectProblem(continuePracticing.id)}
              >
                <span>Resume Problem</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="continue-empty-card">
            <div className="continue-empty-left">
              <div className="continue-empty-icon">
                <BookOpen className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h4>Start solving your first problem</h4>
                <p>Browse our curated problem bank with automated judge feedback and test cases.</p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigateProblems}
            >
              <span>Explore Problems</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Enrollment Alert Notifications */}
      {enrollSuccess && (
        <div className="dash-alert dash-alert-success" data-testid="enroll-success-banner" style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#10b981',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 className="w-4 h-4" />
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{enrollSuccess}</span>
          </div>
          <button
            type="button"
            data-testid="dismiss-enroll-success"
            onClick={() => setEnrollSuccess(null)}
            style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
      )}

      {enrollError && (
        <div className="dash-alert dash-alert-error" data-testid="enroll-error-banner" style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#ef4444',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle className="w-4 h-4" />
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{enrollError}</span>
          </div>
          <button
            type="button"
            data-testid="dismiss-enroll-error"
            onClick={() => setEnrollError(null)}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
      )}

      {/* 3. Main Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Contests & Saved Problems */}
        <div className="dashboard-main-col">
          {/* Live & Running Contests */}
          <section className="dash-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="section-icon-badge icon-live">
                  <Flame className="w-4 h-4" />
                </div>
                <h3 className="section-title">Live & Running Contests</h3>
              </div>
              <span className="count-badge count-live">{runningContests.length} Active</span>
            </div>

            <div className="card-body">
              {runningContests.length === 0 ? (
                <div className="empty-dash-box">
                  <Flame className="w-6 h-6 text-muted" />
                  <p>No live contests currently running. Check upcoming contests below!</p>
                </div>
              ) : (
                <div className="contest-cards-list">
                  {runningContests.map((c) => (
                    <div key={c.id} className="contest-card live-contest-card">
                      <div className="contest-card-main">
                        <div className="contest-status-pill live-pill">
                          <span className="status-dot-pulse"></span>
                          <span>LIVE NOW</span>
                        </div>
                        <h4 className="contest-card-title">{c.title}</h4>
                        <div className="contest-card-meta">
                          <span className="meta-item">
                            <Clock className="w-3.5 h-3.5" />
                            Ends: {formatDate(c.endTime)}
                          </span>
                          <span className="meta-item">
                            <Layers className="w-3.5 h-3.5" />
                            {c.problemCount || 0} Problems
                          </span>
                        </div>
                      </div>
                      <div className="contest-card-actions">
                        {onNavigateLeaderboard && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onNavigateLeaderboard(c.id)}
                            style={{ marginRight: '6px' }}
                          >
                            <Trophy className="w-3.5 h-3.5" />
                            <span>Standings</span>
                          </button>
                        )}
                        <button
                          className="btn btn-success btn-enter-contest"
                          onClick={() => onSelectContest(c.id)}
                        >
                          <span>Enter Contest</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Skills & Progress Mastery Widget (Phase 5.7.6) */}
          <DashboardSkillsWidget token={token} onNavigateProfile={onNavigateProfile} />

          {/* Saved / Bookmarked Problems Widget */}
          <section className="dash-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="section-icon-badge icon-saved">
                  <Star className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="section-title">Saved Problems</h3>
              </div>
              {savedProblems.length > 0 && (
                <button
                  type="button"
                  className="card-header-link"
                  onClick={onNavigateProblems}
                >
                  <span>View All</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="card-body">
              {savedProblems.length === 0 ? (
                <div className="empty-dash-box">
                  <Star className="w-6 h-6 text-muted" />
                  <p>You haven't saved any problems yet. Click the star icon on any problem to bookmark it for later.</p>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: '8px' }}
                    onClick={onNavigateProblems}
                  >
                    <span>Browse Problems</span>
                  </button>
                </div>
              ) : (
                <div className="saved-problems-list">
                  {savedProblems.map((sp) => (
                    <div
                      key={sp.id}
                      className="saved-problem-item"
                      onClick={() => onSelectProblem && onSelectProblem(sp.id)}
                    >
                      <div className="saved-problem-info">
                        <div className="saved-problem-header">
                          <span className="problem-id-tag">#{sp.id}</span>
                          <h5 className="saved-problem-title">{sp.title}</h5>
                        </div>
                        <div className="saved-problem-meta">
                          <span className={`diff-pill ${getDifficultyClass(sp.difficulty)}`}>
                            {sp.difficulty ? sp.difficulty.toUpperCase() : 'EASY'}
                          </span>
                          <span className="saved-sub-text">
                            Saved on {formatDate(sp.savedAt)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProblem && onSelectProblem(sp.id);
                        }}
                      >
                        <span>Solve</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Upcoming Contests */}
          <section className="dash-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="section-icon-badge icon-upcoming">
                  <Calendar className="w-4 h-4" />
                </div>
                <h3 className="section-title">Upcoming Contests</h3>
              </div>
              <span className="count-badge count-upcoming">{upcomingContests.length} Scheduled</span>
            </div>

            <div className="card-body">
              {upcomingContests.length === 0 ? (
                <div className="empty-dash-box">
                  <Calendar className="w-6 h-6 text-muted" />
                  <p>No upcoming contests scheduled at the moment.</p>
                </div>
              ) : (
                <div className="contest-cards-list">
                  {upcomingContests.map((c) => (
                    <div key={c.id} className="contest-card upcoming-contest-card">
                      <div className="contest-card-main">
                        <div className="contest-status-pill upcoming-pill">
                          <span>UPCOMING</span>
                        </div>
                        <h4 className="contest-card-title">{c.title}</h4>
                        <div className="contest-card-meta">
                          <span className="meta-item">
                            <Clock className="w-3.5 h-3.5" />
                            Starts: {formatDate(c.startTime)}
                          </span>
                          {c.creatorUsername && (
                            <span className="meta-item">
                              <User className="w-3.5 h-3.5" />
                              Hosted by @{c.creatorUsername}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="contest-card-actions">
                        {c.isEnrolled ? (
                          <span className="badge-status-enrolled" data-testid={`enrolled-badge-${c.id}`}>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Enrolled</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm btn-enroll-contest"
                            data-testid={`enroll-btn-${c.id}`}
                            disabled={enrollingContestId === c.id}
                            onClick={() => handleEnroll(c.id, c.title)}
                          >
                            {enrollingContestId === c.id ? (
                              <>
                                <div className="btn-spinner" style={{ width: '13px', height: '13px', borderWidth: '2px', marginRight: '6px' }}></div>
                                <span>Registering...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" style={{ marginRight: '4px' }} />
                                <span>Register Now</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Enrolled Contests History */}
          <section className="dash-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="section-icon-badge icon-history">
                  <Trophy className="w-4 h-4" />
                </div>
                <h3 className="section-title">Your Enrolled Contests</h3>
              </div>
              <span className="count-badge count-history">{joinedContests.length} Total</span>
            </div>

            <div className="card-body">
              {joinedContests.length === 0 ? (
                <div className="empty-dash-box">
                  <Trophy className="w-6 h-6 text-muted" />
                  <p>You haven't enrolled in any contests yet.</p>
                </div>
              ) : (
                <div className="enrolled-contests-grid">
                  {joinedContests.map((c) => (
                    <div key={c.id} className="enrolled-contest-item">
                      <div className="enrolled-info">
                        <h5 className="enrolled-title">{c.title}</h5>
                        <div className="enrolled-meta">
                          <span className={`status-pill-small status-${c.runtimeState || 'ended'}`}>
                            {c.runtimeState || 'ended'}
                          </span>
                          <span className="enrolled-joined-date">Joined: {formatDate(c.joinedAt)}</span>
                        </div>
                      </div>
                      <div className="enrolled-action" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {onNavigateLeaderboard && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onNavigateLeaderboard(c.id)}
                          >
                            <Trophy className="w-3.5 h-3.5" />
                            <span>Leaderboard</span>
                          </button>
                        )}
                        {c.runtimeState === 'running' && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => onSelectContest(c.id)}
                          >
                            <span>Continue</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Recent Submissions & Solved Breakdown */}
        <div className="dashboard-side-col">
          <section className="dash-card">
            <div className="card-header">
              <div className="card-header-left">
                <div className="section-icon-badge icon-submissions">
                  <Code2 className="w-4 h-4" />
                </div>
                <h3 className="section-title">Recent Submissions</h3>
              </div>
              {recentSubmissions.length > 0 && onNavigateSubmissions && (
                <button
                  type="button"
                  className="card-header-link"
                  onClick={onNavigateSubmissions}
                >
                  <span>View All</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="card-body">
              {recentSubmissions.length === 0 ? (
                <div className="empty-dash-box">
                  <Code2 className="w-6 h-6 text-muted" />
                  <p>No submissions made yet. Start practicing in the workspace!</p>
                </div>
              ) : (
                <div className="recent-submissions-list">
                  {recentSubmissions.map((s) => (
                    <div key={s.id} className="submission-card-item">
                      <div className="sub-card-header">
                        <span className="sub-card-problem-title">{s.problemTitle || 'Challenge Problem'}</span>
                        <span className={`verdict-badge ${getVerdictBadgeClass(s.status)}`}>
                          {s.status === 'accepted' ? 'Accepted' : s.status?.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <div className="sub-card-footer">
                        <span className="sub-card-lang">{s.language?.toUpperCase()}</span>
                        <span className="sub-card-mode">{s.codingMode === 'function' ? 'Function Mode' : 'Script Mode'}</span>
                        <span className="sub-card-time">{formatDate(s.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}