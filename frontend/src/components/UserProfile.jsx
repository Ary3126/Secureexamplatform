import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Award,
  Zap,
  User,
  Activity,
  Shield,
  Edit3,
  Share2,
  Cpu,
  Flame,
  Code2,
  Check,
  Building2,
  Settings as SettingsIcon,
  BarChart3,
  Globe,
  Clock,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import CoderEmblem from './CoderEmblem';
import DifficultyOrbit from './DifficultyOrbit';
import TopicConstellation from './TopicConstellation';
import SkillsOverviewMatrix from './SkillsOverviewMatrix';
import Settings from './Settings';

export default function UserProfile({
  token,
  currentUser,
  targetUsername = null,
  targetUserId = null,
  initialTab = 'matrix',
  onBackToWorkspace,
  onOpenProblem,
  onOpenLogin,
}) {
  const [identityData, setIdentityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab); // 'matrix' | 'skills' | 'settings'

  const [copiedLink, setCopiedLink] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    fetchCoderIdentity();
  }, [token, targetUsername, targetUserId]);

  const fetchCoderIdentity = async () => {
    if (!token && !targetUsername && !targetUserId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const endpoint = targetUsername
        ? `/api/users/u/${encodeURIComponent(targetUsername)}`
        : targetUserId
        ? `/api/users/${targetUserId}/identity`
        : '/api/users/me/identity';

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(endpoint, { headers });
      const data = await res.json();

      if (res.ok) {
        setIdentityData(data);
      } else {
        setError(data.message || 'Failed to load coder identity');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching coder identity');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyProfileUrl = () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const getRatingTier = (rating) => {
    if (rating >= 2200) {
      return {
        title: 'ELITE',
        color: '#f43f5e',
        badgeClass: 'tier-elite',
      };
    }
    if (rating >= 1900) {
      return {
        title: 'MASTER',
        color: '#f59e0b',
        badgeClass: 'tier-master',
      };
    }
    if (rating >= 1600) {
      return {
        title: 'SPECIALIST',
        color: '#a855f7',
        badgeClass: 'tier-specialist',
      };
    }
    if (rating >= 1400) {
      return {
        title: 'EXPERT',
        color: '#3b82f6',
        badgeClass: 'tier-expert',
      };
    }
    if (rating >= 1200) {
      return {
        title: 'CHALLENGER',
        color: '#06b6d4',
        badgeClass: 'tier-challenger',
      };
    }
    return {
      title: 'EXPLORER',
      color: '#94a3b8',
      badgeClass: 'tier-explorer',
    };
  };

  const calculateProfileCompletion = (user) => {
    if (!user) return 0;
    let score = 25; // Base registered user
    if (user.fullName && user.fullName.length > 2) score += 25;
    if (user.institution && user.institution.length > 2) score += 25;
    if (user.bio && user.bio.trim().length > 10) score += 25;
    return Math.min(100, score);
  };

  // Render SVG Elo Rating Progression Chart
  const renderRatingGraph = (history) => {
    if (!history || history.length === 0) {
      return (
        <div className="rating-graph-empty">
          <Activity className="w-8 h-8 text-blue-400 opacity-60 mb-2" />
          <p className="font-medium text-slate-300">No rated contests logged yet</p>
          <p className="text-xs text-slate-500 max-w-sm text-center mt-1">
            Participate in rated contests to calibrate your initial Elo rating and track your historical progression curve.
          </p>
        </div>
      );
    }

    const svgWidth = 680;
    const svgHeight = 220;
    const padding = { top: 24, right: 30, bottom: 30, left: 45 };
    const chartW = svgWidth - padding.left - padding.right;
    const chartH = svgHeight - padding.top - padding.bottom;

    const ratings = history.map((h) => h.newRating);
    const minRating = Math.max(100, Math.min(...ratings, 1200) - 100);
    const maxRating = Math.max(...ratings, 1200) + 100;
    const range = maxRating - minRating || 1;

    const points = history.map((h, i) => {
      const x = padding.left + (i / Math.max(history.length - 1, 1)) * chartW;
      const y = padding.top + chartH - ((h.newRating - minRating) / range) * chartH;
      return { x, y, ...h, index: i };
    });

    const pathData = points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    const areaData = points.length > 0
      ? `${pathData} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`
      : '';

    return (
      <div className="rating-graph-wrapper">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="rating-svg-canvas">
          <defs>
            <linearGradient id="ratingAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 0.33, 0.66, 1].map((ratio, idx) => {
            const yVal = padding.top + chartH * (1 - ratio);
            const rVal = Math.round(minRating + ratio * range);
            return (
              <g key={idx}>
                <line
                  x1={padding.left}
                  y1={yVal}
                  x2={svgWidth - padding.right}
                  y2={yVal}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 8}
                  y={yVal + 3}
                  fill="rgba(255, 255, 255, 0.4)"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {rVal}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          {areaData && <path d={areaData} fill="url(#ratingAreaGrad)" />}

          {/* Progression Line */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive Data Points */}
          {points.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={hoveredPoint?.id === p.id ? 6 : 4}
                fill={p.ratingChange >= 0 ? '#10b981' : '#f43f5e'}
                stroke="#0f172a"
                strokeWidth="2"
                style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            </g>
          ))}
        </svg>

        {/* Floating Tooltip */}
        {hoveredPoint && (
          <div
            className="rating-graph-tooltip"
            style={{
              left: `${(hoveredPoint.x / svgWidth) * 100}%`,
              top: `${(hoveredPoint.y / svgHeight) * 100}%`,
            }}
          >
            <div className="tooltip-title">{hoveredPoint.contestTitle || 'Rated Contest'}</div>
            <div className="tooltip-row">
              <span>Rank:</span>
              <strong>#{hoveredPoint.rank}</strong>
            </div>
            <div className="tooltip-row">
              <span>Delta:</span>
              <strong className={hoveredPoint.ratingChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {hoveredPoint.ratingChange >= 0 ? `+${hoveredPoint.ratingChange}` : hoveredPoint.ratingChange}
              </strong>
            </div>
            <div className="tooltip-row">
              <span>New Rating:</span>
              <strong>{hoveredPoint.newRating}</strong>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!token && !targetUsername && !targetUserId) {
    return (
      <div className="profile-container unauth-state">
        <div className="dash-error-card" style={{ maxWidth: '520px', margin: '60px auto', textAlign: 'center' }}>
          <User className="w-12 h-12 text-blue-400 mb-2" style={{ margin: '0 auto' }} />
          <h3>Sign in to View Coder Profile</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
            Access your personal competitive Elo rating graph, difficulty orbit, topic mastery constellation, and skill overview.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={onOpenLogin}>
              Sign In
            </button>
            <button className="btn btn-secondary" onClick={onBackToWorkspace}>
              Explore Problems
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="profile-container loading-state">
        <div className="spinner"></div>
        <p>Loading coder identity...</p>
      </div>
    );
  }

  if (error && !identityData) {
    return (
      <div className="profile-container error-state">
        <div className="alert alert-danger mb-4">{error}</div>
        <button className="btn btn-primary btn-sm" onClick={onBackToWorkspace}>
          &larr; Return to Workspace
        </button>
      </div>
    );
  }

  const user = identityData?.user || {};
  const isOwnProfile = identityData?.isOwnProfile ?? false;
  const ratingData = identityData?.rating || {};
  const performance = identityData?.performance || {};
  const difficultyStats = identityData?.difficultyStats || { easy: 0, medium: 0, hard: 0 };
  const topicStats = identityData?.topicStats || [];
  const ratingHistory = identityData?.ratingHistory || [];
  const recentActivity = identityData?.recentActivity || [];

  const currentRating = ratingData.current ?? 1200;
  const highestRating = ratingData.highest ?? 1200;
  const ratingStatus = ratingData.status || 'provisional';
  const ratedContestCount = ratingData.ratedContestCount || 0;
  const globalRank = ratingData.globalRank || 1;
  const ratingTier = getRatingTier(currentRating);
  const completionPct = calculateProfileCompletion(user);

  const memberYear = user.createdAt ? new Date(user.createdAt).getFullYear() : 2026;

  return (
    <div className="profile-container coder-identity-theme">
      {/* Top Header Bar */}
      <div className="profile-top-bar">
        <button className="btn btn-outline btn-sm back-nav-btn" onClick={onBackToWorkspace}>
          &larr; Back to Workspace
        </button>

        {/* Tab Switcher for Profile Owner */}
        {isOwnProfile ? (
          <div className="profile-segmented-nav">
            <button
              type="button"
              className={`profile-nav-tab ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Identity Matrix</span>
            </button>
            <button
              type="button"
              className={`profile-nav-tab ${activeTab === 'skills' ? 'active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >
              <Layers className="w-4 h-4" />
              <span>Skills & Mastery</span>
            </button>
            <button
              type="button"
              className={`profile-nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Settings & Preferences</span>
            </button>
          </div>
        ) : (
          <div className="profile-header-tagline">
            <Code2 className="w-4 h-4 text-cyan-400" />
            <span>PUBLIC CODER PROFILE</span>
          </div>
        )}
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* RENDER TAB 1: SETTINGS & PREFERENCES */}
      {isOwnProfile && activeTab === 'settings' ? (
        <Settings
          token={token}
          currentUser={currentUser}
          userProfile={user}
          onProfileUpdated={(updatedUser) => {
            setIdentityData((prev) => ({
              ...prev,
              user: { ...prev.user, ...updatedUser },
            }));
            fetchCoderIdentity();
          }}
        />
      ) : isOwnProfile && activeTab === 'skills' ? (
        /* RENDER TAB 2: DEDICATED SKILLS & MASTERY MATRIX */
        <div className="profile-skills-tab-content">
          <SkillsOverviewMatrix
            token={token}
            targetUsername={targetUsername}
            isOwnProfile={isOwnProfile}
          />
        </div>
      ) : (
        /* RENDER TAB 3: CODER IDENTITY MATRIX */
        <div className="profile-matrix-content">
          {/* 1. HERO CODER IDENTITY CARD */}
          <section className="coder-identity-hero-card">
            <div className="hero-identity-grid">
              {/* Left: Code Core Dynamic Vector Emblem */}
              <div className="emblem-showcase-col">
                <CoderEmblem
                  username={user.username || 'coder'}
                  rating={currentRating}
                  tierTitle={ratingTier.title}
                  tierColor={ratingTier.color}
                  solvedCount={performance.problemsSolved || 0}
                  size="hero"
                />
                <div className="emblem-tier-label" style={{ color: ratingTier.color }}>
                  {ratingTier.title}
                </div>
              </div>

              {/* Center: Coder Information */}
              <div className="identity-info-col">
                <div className="identity-title-row">
                  <h1 className="coder-display-name">{user.fullName || user.username}</h1>
                  <span className={`role-badge role-${user.role}`}>{user.role?.toUpperCase()}</span>
                </div>

                <div className="coder-meta-row">
                  <span className="coder-handle">@{user.username}</span>
                  <span className="meta-sep">•</span>
                  <span className="coder-member-since">Member since {memberYear}</span>
                  {user.institution && (
                    <>
                      <span className="meta-sep">•</span>
                      <span className="coder-institution-tag">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{user.institution}</span>
                      </span>
                    </>
                  )}
                </div>

                <p className="coder-bio-text">
                  {user.bio ? user.bio : 'Competitive programmer solving algorithmic challenges on SecureExam.'}
                </p>

                {/* Programming Languages */}
                <div className="coder-languages-row">
                  <span className="lang-pill">C++</span>
                  <span className="lang-pill">Python</span>
                  <span className="lang-pill">Java</span>
                </div>

                {/* Profile Completion Signal */}
                {isOwnProfile && (
                  <div className="profile-signal-wrap">
                    <div className="signal-header">
                      <span className="signal-label">Profile Completeness</span>
                      <span className="signal-pct">{completionPct}%</span>
                    </div>
                    <div className="signal-track">
                      <div className="signal-fill" style={{ width: `${completionPct}%` }}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Quick Action Controls */}
              <div className="identity-actions-col">
                {isOwnProfile && (
                  <button
                    className="btn btn-primary btn-sm edit-profile-btn"
                    onClick={() => setActiveTab('settings')}
                  >
                    <SettingsIcon className="w-3.5 h-3.5" />
                    <span>Settings & Edit</span>
                  </button>
                )}

                <button
                  className="btn btn-outline btn-sm share-profile-btn"
                  onClick={handleCopyProfileUrl}
                  title="Copy public link to this profile"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copied URL!' : 'Share Profile'}</span>
                </button>
              </div>
            </div>
          </section>

          {/* 2. COMPETITIVE RATING CORE HERO */}
          <section className="rating-core-hero-card">
            <div className="rating-core-layout">
              {/* Main Primary Rating Value */}
              <div className="rating-primary-block">
                <span className="rating-core-label">Competitive Rating</span>
                <div className="rating-core-number-row">
                  <span className="rating-core-number" style={{ color: ratingTier.color }}>
                    {currentRating}
                  </span>
                  <span className={`rating-tier-pill ${ratingTier.badgeClass}`}>{ratingTier.title}</span>
                </div>
                <div className="rating-status-row">
                  <span
                    className={`status-tag ${
                      ratingStatus === 'provisional' ? 'status-provisional' : 'status-rated'
                    }`}
                  >
                    {ratingStatus.toUpperCase()}
                  </span>
                  {ratingStatus === 'provisional' && (
                    <span className="provisional-hint">
                      ({Math.max(0, 5 - ratedContestCount)} more contests for rated status)
                    </span>
                  )}
                </div>
              </div>

              {/* 4-Stat Core Matrix */}
              <div className="rating-core-matrix">
                <div className="matrix-stat-item">
                  <Award className="w-5 h-5 text-blue-400" />
                  <div>
                    <span className="matrix-stat-val">#{globalRank}</span>
                    <span className="matrix-stat-lbl">Global Rank</span>
                  </div>
                </div>

                <div className="matrix-stat-item">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <div>
                    <span className="matrix-stat-val">{highestRating}</span>
                    <span className="matrix-stat-lbl">Peak Rating</span>
                  </div>
                </div>

                <div className="matrix-stat-item">
                  <Zap className="w-5 h-5 text-purple-400" />
                  <div>
                    <span className="matrix-stat-val">{ratedContestCount}</span>
                    <span className="matrix-stat-lbl">Rated Contests</span>
                  </div>
                </div>

                <div className="matrix-stat-item">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <div>
                    <span className="matrix-stat-val">{performance.problemsSolved || 0}</span>
                    <span className="matrix-stat-lbl">Unique Solved</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3. PERFORMANCE SNAPSHOT & CODING DNA */}
          <section className="performance-dna-section">
            <div className="section-title-row">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <h3 className="section-heading">Performance Snapshot</h3>
              </div>
            </div>

            <div className="performance-metrics-grid">
              <div className="perf-metric-card">
                <span className="perf-card-lbl">Acceptance Rate</span>
                <span className="perf-card-val text-emerald-400">{performance.acceptanceRate || 0}%</span>
                <span className="perf-card-sub">
                  {performance.acceptedSubmissions || 0} accepted / {performance.totalSubmissions || 0} total
                </span>
              </div>

              <div className="perf-metric-card">
                <span className="perf-card-lbl">Total Submissions</span>
                <span className="perf-card-val">{performance.totalSubmissions || 0}</span>
                <span className="perf-card-sub">Attempts across all problems</span>
              </div>

              <div className="perf-metric-card">
                <span className="perf-card-lbl">Average Runtime</span>
                <span className="perf-card-val text-blue-400">
                  {performance.averageRuntime > 0 ? `${performance.averageRuntime} ms` : '—'}
                </span>
                <span className="perf-card-sub">
                  Best: {performance.bestRuntime > 0 ? `${performance.bestRuntime} ms` : '—'}
                </span>
              </div>

              <div className="perf-metric-card">
                <span className="perf-card-lbl">Average Memory</span>
                <span className="perf-card-val text-purple-400">
                  {performance.averageMemory > 0 ? `${(performance.averageMemory / 1024).toFixed(1)} MB` : '—'}
                </span>
                <span className="perf-card-sub">
                  Best: {performance.bestMemory > 0 ? `${(performance.bestMemory / 1024).toFixed(1)} MB` : '—'}
                </span>
              </div>
            </div>
          </section>

          {/* 4. VISUAL DOMAIN SPLIT: DIFFICULTY ORBIT + TOPIC CONSTELLATION */}
          <section className="visual-domain-split-grid">
            <DifficultyOrbit
              difficultyStats={difficultyStats}
              totalSolved={performance.problemsSolved || 0}
            />
            <TopicConstellation topicStats={topicStats} />
          </section>

          {/* 4.5 SKILLS MASTERY & PROGRESSION MATRIX */}
          <section className="skills-matrix-profile-section">
            <div className="section-title-row">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="section-heading">Skill Mastery & Progression Matrix</h3>
              </div>
            </div>
            <SkillsOverviewMatrix
              token={token}
              targetUsername={targetUsername}
              isOwnProfile={isOwnProfile}
            />
          </section>

          {/* 5. CONTEST JOURNEY & RATING PROGRESSION GRAPH */}
          <section className="contest-journey-section">
            <div className="section-title-row">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h3 className="section-heading">Contest Journey & Progression Curve</h3>
              </div>
              <span className="contest-count-badge">{ratingHistory.length} Contests Logged</span>
            </div>

            {renderRatingGraph(ratingHistory)}

            {/* Contest History Table */}
            {ratingHistory.length > 0 && (
              <div className="rating-history-table-wrapper mt-4">
                <table className="rating-history-table">
                  <thead>
                    <tr>
                      <th>Contest Title</th>
                      <th>Rank</th>
                      <th>Delta</th>
                      <th>New Rating</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratingHistory.map((h, i) => (
                      <tr key={i}>
                        <td className="font-semibold text-slate-200">
                          {h.contestTitle || `Rated Contest #${h.contestId}`}
                        </td>
                        <td>
                          <span className="rank-badge">#{h.rank}</span>
                        </td>
                        <td>
                          <span
                            className={`delta-badge ${
                              h.ratingChange >= 0 ? 'delta-positive' : 'delta-negative'
                            }`}
                          >
                            {h.ratingChange >= 0 ? `+${h.ratingChange}` : h.ratingChange}
                          </span>
                        </td>
                        <td className="font-mono font-bold text-slate-100">{h.newRating}</td>
                        <td className="text-slate-400 text-xs">
                          {h.finalizedAt ? new Date(h.finalizedAt).toLocaleDateString() : 'Recent'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 6. RECENT ACTIVITY STREAM */}
          {recentActivity.length > 0 && (
            <section className="recent-activity-section">
              <div className="section-title-row">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <h3 className="section-heading">Recent Solves & Coding Stream</h3>
                </div>
              </div>

              <div className="activity-stream-list">
                {recentActivity.map((sub) => (
                  <div key={sub.id} className="activity-stream-item">
                    <div className="activity-item-main">
                      <span className={`diff-tag diff-${sub.difficulty}`}>{sub.difficulty?.toUpperCase()}</span>
                      <span className="activity-problem-title">{sub.problemTitle || `Problem #${sub.problemId}`}</span>
                      <span className="activity-lang-tag">{sub.language}</span>
                    </div>
                    <div className="activity-item-metrics">
                      <span className={`verdict-pill verdict-${sub.verdict}`}>
                        {sub.verdict === 'accepted' ? 'ACCEPTED' : sub.verdict?.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <span className="activity-date">
                        {sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : 'Recent'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}