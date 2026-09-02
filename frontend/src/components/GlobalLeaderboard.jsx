import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Globe,
  Building2,
  Search,
  RefreshCw,
  Award,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  Zap,
  SlidersHorizontal,
  ExternalLink,
  Edit3,
} from 'lucide-react';
import CoderEmblem from './CoderEmblem';

export default function GlobalLeaderboard({
  token,
  currentUser,
  onNavigateProfile,
  onOpenEditProfile,
}) {
  // State
  const [scope, setScope] = useState('global'); // 'global' | 'college'
  const [selectedInstitution, setSelectedInstitution] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'rated' | 'provisional'
  const [tierFilter, setTierFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  const [leaderboardData, setLeaderboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showStatsModal, setShowStatsModal] = useState(false);

  const searchTimerRef = useRef(null);

  // Debounce search input
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setCurrentPage(1);
    }, 300);
  };

  // Switch scope
  const handleScopeChange = (newScope) => {
    setScope(newScope);
    setCurrentPage(1);
    if (newScope === 'college' && currentUser?.institution && !selectedInstitution) {
      setSelectedInstitution(currentUser.institution);
    }
  };

  // Fetch Leaderboard
  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.append('scope', scope);
      if (scope === 'college' && selectedInstitution) {
        params.append('institution', selectedInstitution);
      }
      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }
      if (tierFilter !== 'all') {
        params.append('tier', tierFilter);
      }
      if (debouncedSearch) {
        params.append('search', debouncedSearch);
      }
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let res;
      try {
        res = await fetch(`/api/leaderboard?${params.toString()}`, { headers });
      } catch {
        res = await fetch(`http://localhost:5000/api/leaderboard?${params.toString()}`, { headers });
      }

      if (!res.ok) {
        throw new Error(`Failed to load leaderboard (${res.status})`);
      }

      const data = await res.json();
      setLeaderboardData(data);
    } catch (err) {
      setError(err.message || 'Error connecting to leaderboard service');
    } finally {
      setLoading(false);
    }
  }, [token, scope, selectedInstitution, statusFilter, tierFilter, debouncedSearch, currentPage, pageSize]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Set default college on mount if user belongs to one
  useEffect(() => {
    if (currentUser?.institution && !selectedInstitution) {
      setSelectedInstitution(currentUser.institution);
    }
  }, [currentUser, selectedInstitution]);

  const {
    standings = [],
    podium = [],
    userPosition = null,
    pagination = {},
    statistics = {},
    availableInstitutions = [],
    tiers = [],
  } = leaderboardData || {};

  const totalUsers = pagination.totalUsers || 0;
  const totalPages = pagination.totalPages || 1;

  // Podium sorting: 2nd place on left, 1st in center, 3rd on right
  const podiumSecond = podium.find((p) => p.rank === 2);
  const podiumFirst = podium.find((p) => p.rank === 1);
  const podiumThird = podium.find((p) => p.rank === 3);

  return (
    <div className="leaderboard-page-container">
      {/* 1. Header & Navigation Controls */}
      <div className="leaderboard-header-card">
        <div className="leaderboard-header-main">
          <div className="leaderboard-title-group">
            <div className="leaderboard-header-icon-box">
              <Trophy className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h1 className="leaderboard-main-title">
                  {scope === 'college' ? 'College Standings' : 'Global Leaderboard'}
                </h1>
                <span className="live-pill">
                  <span className="live-dot"></span>
                  AUTHORITATIVE ELO
                </span>
              </div>
              <p className="leaderboard-subtitle">
                Platform-wide competitive standings calculated strictly from official contest ratings.
              </p>
            </div>
          </div>

          {/* Scope Segmented Control */}
          <div className="scope-segmented-control">
            <button
              type="button"
              className={`scope-pill-btn ${scope === 'global' ? 'active' : ''}`}
              onClick={() => handleScopeChange('global')}
            >
              <Globe className="w-4 h-4" />
              <span>Global Arena</span>
            </button>
            <button
              type="button"
              className={`scope-pill-btn ${scope === 'college' ? 'active' : ''}`}
              onClick={() => handleScopeChange('college')}
            >
              <Building2 className="w-4 h-4" />
              <span>College League</span>
            </button>
          </div>
        </div>

        {/* College Selector Bar (When in College scope) */}
        {scope === 'college' && (
          <div className="college-filter-subbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 className="w-4 h-4 text-cyan-400" />
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Institution:
              </span>
            </div>
            <select
              className="college-select-dropdown"
              value={selectedInstitution}
              onChange={(e) => {
                setSelectedInstitution(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">-- Select an Institution --</option>
              {availableInstitutions.map((inst) => (
                <option key={inst.institution} value={inst.institution}>
                  {inst.institution} ({inst.studentCount} students)
                </option>
              ))}
            </select>

            {currentUser && !currentUser.institution && (
              <div className="college-empty-notice">
                <span>You don't have a college set yet.</span>
                <button
                  type="button"
                  className="college-edit-link-btn"
                  onClick={onOpenEditProfile}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Set College in Profile
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Logged-in User Position Sticky Card */}
      {userPosition && (
        <div className="user-position-banner">
          <div className="user-pos-left">
            <div className="user-pos-emblem-wrap">
              <CoderEmblem
                username={userPosition.username}
                rating={userPosition.currentRating}
                tierColor={userPosition.tier?.color || '#06b6d4'}
                tierTitle={userPosition.tier?.name || 'Challenger'}
                size="md"
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="user-pos-name">{userPosition.fullName || userPosition.username}</span>
                <span className="user-pos-handle">@{userPosition.username}</span>
                <span
                  className="tier-pill-badge"
                  style={{
                    color: userPosition.tier?.color || '#06b6d4',
                    background: userPosition.tier?.bg || 'rgba(6, 182, 212, 0.15)',
                    borderColor: `${userPosition.tier?.color || '#06b6d4'}40`,
                  }}
                >
                  {userPosition.tier?.badge || 'CHALLENGER'}
                </span>
              </div>
              <div className="user-pos-subinfo">
                {userPosition.institution && (
                  <span className="user-pos-inst">
                    <Building2 className="w-3.5 h-3.5" />
                    {userPosition.institution}
                  </span>
                )}
                <span>• {userPosition.problemsSolvedCount || 0} Problems Solved</span>
                <span>• {userPosition.ratedContestCount || 0} Rated Contests</span>
                <span>• Status: <strong style={{ textTransform: 'capitalize' }}>{userPosition.ratingStatus}</strong></span>
              </div>
            </div>
          </div>

          <div className="user-pos-right">
            <div className="user-pos-stat-box">
              <span className="user-pos-stat-label">Global Rank</span>
              <span className="user-pos-stat-val text-amber-400">
                #{userPosition.globalRank}
              </span>
              <span className="user-pos-stat-sub">of {userPosition.totalStudents}</span>
            </div>

            {userPosition.collegeRank && (
              <div className="user-pos-stat-box">
                <span className="user-pos-stat-label">College Rank</span>
                <span className="user-pos-stat-val text-cyan-400">
                  #{userPosition.collegeRank}
                </span>
                <span className="user-pos-stat-sub">of {userPosition.totalCollegeStudents}</span>
              </div>
            )}

            <div className="user-pos-stat-box">
              <span className="user-pos-stat-label">Current Rating</span>
              <span className="user-pos-stat-val" style={{ color: userPosition.tier?.color || '#06b6d4' }}>
                {userPosition.currentRating}
              </span>
              <span className="user-pos-stat-sub">Peak: {userPosition.highestRating}</span>
            </div>

            <div className="user-pos-stat-box">
              <span className="user-pos-stat-label">Percentile</span>
              <span className="user-pos-stat-val text-emerald-400">
                Top {100 - userPosition.percentile + 1}%
              </span>
              <span className="user-pos-stat-sub">{userPosition.percentile}th percentile</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Top 3 Visual Podium Grid */}
      {podium.length >= 3 && !debouncedSearch && statusFilter === 'all' && tierFilter === 'all' && (
        <div className="leaderboard-podium-section">
          {/* 🥈 Second Place */}
          {podiumSecond && (
            <div
              className="podium-card podium-silver"
              onClick={() => onNavigateProfile && onNavigateProfile(podiumSecond.username)}
            >
              <div className="podium-rank-crown silver-crown">
                <span className="podium-medal">🥈</span>
                <span>#2</span>
              </div>
              <div className="podium-emblem-wrap">
                <CoderEmblem
                  username={podiumSecond.username}
                  rating={podiumSecond.currentRating}
                  tierColor={podiumSecond.tier?.color || '#94a3b8'}
                  tierTitle={podiumSecond.tier?.name || 'Expert'}
                  size="md"
                />
              </div>
              <h3 className="podium-name">{podiumSecond.fullName || podiumSecond.username}</h3>
              <p className="podium-handle">@{podiumSecond.username}</p>
              {podiumSecond.institution && (
                <p className="podium-inst">{podiumSecond.institution}</p>
              )}
              <div className="podium-score-pill">
                <span className="podium-rating" style={{ color: podiumSecond.tier?.color || '#94a3b8' }}>
                  {podiumSecond.currentRating}
                </span>
                <span className="podium-tier-tag">{podiumSecond.tier?.badge || 'EXPERT'}</span>
              </div>
              <div className="podium-stats-row">
                <span>{podiumSecond.problemsSolvedCount} Solved</span>
                <span>{podiumSecond.ratedContestCount} Contests</span>
              </div>
            </div>
          )}

          {/* 🥇 First Place (Hero Elevated) */}
          {podiumFirst && (
            <div
              className="podium-card podium-gold"
              onClick={() => onNavigateProfile && onNavigateProfile(podiumFirst.username)}
            >
              <div className="podium-rank-crown gold-crown">
                <span className="podium-medal">🥇</span>
                <span>CHAMPION #1</span>
              </div>
              <div className="podium-emblem-wrap gold-halo">
                <CoderEmblem
                  username={podiumFirst.username}
                  rating={podiumFirst.currentRating}
                  tierColor={podiumFirst.tier?.color || '#f59e0b'}
                  tierTitle={podiumFirst.tier?.name || 'Elite'}
                  size="lg"
                />
              </div>
              <h3 className="podium-name hero-name">{podiumFirst.fullName || podiumFirst.username}</h3>
              <p className="podium-handle">@{podiumFirst.username}</p>
              {podiumFirst.institution && (
                <p className="podium-inst hero-inst">{podiumFirst.institution}</p>
              )}
              <div className="podium-score-pill gold-pill">
                <span className="podium-rating" style={{ color: podiumFirst.tier?.color || '#f59e0b' }}>
                  {podiumFirst.currentRating}
                </span>
                <span className="podium-tier-tag">{podiumFirst.tier?.badge || 'ELITE'}</span>
              </div>
              <div className="podium-stats-row">
                <span>{podiumFirst.problemsSolvedCount} Solved</span>
                <span>{podiumFirst.ratedContestCount} Contests</span>
              </div>
            </div>
          )}

          {/* 🥉 Third Place */}
          {podiumThird && (
            <div
              className="podium-card podium-bronze"
              onClick={() => onNavigateProfile && onNavigateProfile(podiumThird.username)}
            >
              <div className="podium-rank-crown bronze-crown">
                <span className="podium-medal">🥉</span>
                <span>#3</span>
              </div>
              <div className="podium-emblem-wrap">
                <CoderEmblem
                  username={podiumThird.username}
                  rating={podiumThird.currentRating}
                  tierColor={podiumThird.tier?.color || '#d97706'}
                  tierTitle={podiumThird.tier?.name || 'Specialist'}
                  size="md"
                />
              </div>
              <h3 className="podium-name">{podiumThird.fullName || podiumThird.username}</h3>
              <p className="podium-handle">@{podiumThird.username}</p>
              {podiumThird.institution && (
                <p className="podium-inst">{podiumThird.institution}</p>
              )}
              <div className="podium-score-pill">
                <span className="podium-rating" style={{ color: podiumThird.tier?.color || '#d97706' }}>
                  {podiumThird.currentRating}
                </span>
                <span className="podium-tier-tag">{podiumThird.tier?.badge || 'SPECIALIST'}</span>
              </div>
              <div className="podium-stats-row">
                <span>{podiumThird.problemsSolvedCount} Solved</span>
                <span>{podiumThird.ratedContestCount} Contests</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Platform Analytics Bar & Rating Distribution */}
      <div className="platform-stats-card">
        <div className="stats-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700' }}>Platform Rating Analytics & Distribution</h3>
          </div>
          <button
            type="button"
            className="toggle-stats-btn"
            onClick={() => setShowStatsModal(!showStatsModal)}
          >
            {showStatsModal ? 'Hide Details' : 'View Tier Ranges'}
          </button>
        </div>

        {/* Quick KPI Pills */}
        <div className="kpi-grid">
          <div className="kpi-pill">
            <span className="kpi-label">Total Coders</span>
            <span className="kpi-value">{statistics.totalStudents || 0}</span>
          </div>
          <div className="kpi-pill">
            <span className="kpi-label">Rated Participants</span>
            <span className="kpi-value text-emerald-400">{statistics.ratedStudents || 0}</span>
          </div>
          <div className="kpi-pill">
            <span className="kpi-label">Provisional</span>
            <span className="kpi-value text-amber-400">{statistics.provisionalStudents || 0}</span>
          </div>
          <div className="kpi-pill">
            <span className="kpi-label">Average Rating</span>
            <span className="kpi-value text-blue-400">{statistics.averageRating || 1200}</span>
          </div>
          <div className="kpi-pill">
            <span className="kpi-label">Peak Rating</span>
            <span className="kpi-value text-rose-400">{statistics.highestRating || 1200}</span>
          </div>
        </div>

        {/* Rating Distribution Histogram */}
        {statistics.ratingDistribution && statistics.ratingDistribution.length > 0 && (
          <div className="histogram-container">
            <span className="histogram-title">Student Distribution by Rating Range</span>
            <div className="histogram-bars">
              {statistics.ratingDistribution.map((bucket) => {
                const isSelected = tierFilter.toLowerCase() === bucket.tierName.toLowerCase();
                return (
                  <div
                    key={bucket.range}
                    className={`histogram-bar-col ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setTierFilter(isSelected ? 'all' : bucket.tierName);
                      setCurrentPage(1);
                    }}
                    title={`${bucket.tierName} (${bucket.range}): ${bucket.count} students (${bucket.percentage}%) - Click to filter`}
                  >
                    <div className="histogram-bar-track">
                      <div
                        className="histogram-bar-fill"
                        style={{
                          height: `${Math.max(bucket.percentage * 1.8, bucket.count > 0 ? 8 : 2)}%`,
                          backgroundColor: bucket.color,
                        }}
                      ></div>
                    </div>
                    <span className="histogram-bar-count">{bucket.count}</span>
                    <span className="histogram-bar-label">{bucket.range}</span>
                    <span className="histogram-bar-tier" style={{ color: bucket.color }}>
                      {bucket.tierName}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsible Tier Breakdown Details */}
        {showStatsModal && (
          <div className="tier-breakdown-panel">
            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Configurable Platform Rating Tiers
            </h4>
            <div className="tiers-detail-grid">
              {tiers.map((t) => (
                <div key={t.badge} className="tier-detail-card" style={{ borderColor: `${t.color}30` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="tier-badge-pill" style={{ color: t.color, background: t.bg }}>
                      {t.badge}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: t.color }}>
                      {t.minRating}{t.maxRating !== Infinity ? `–${t.maxRating}` : '+'}
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {t.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. Filter & Search Toolbar */}
      <div className="leaderboard-controls-card">
        <div className="search-box-wrap">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            className="search-input-field"
            placeholder="Search coder by username or name..."
            value={searchTerm}
            onChange={handleSearchChange}
          />
        </div>

        <div className="filter-dropdowns-group">
          {/* Status Filter */}
          <div className="filter-dropdown-wrap">
            <span className="filter-label">Status:</span>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">All Coders</option>
              <option value="rated">Rated Only (≥5 contests)</option>
              <option value="provisional">Provisional Placement</option>
            </select>
          </div>

          {/* Tier Filter */}
          <div className="filter-dropdown-wrap">
            <span className="filter-label">Tier:</span>
            <select
              className="filter-select"
              value={tierFilter}
              onChange={(e) => {
                setTierFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">All Tiers</option>
              {tiers.map((t) => (
                <option key={t.badge} value={t.name}>
                  {t.name} ({t.minRating}+)
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          {(statusFilter !== 'all' || tierFilter !== 'all' || debouncedSearch) && (
            <button
              type="button"
              className="btn btn-secondary reset-filters-btn"
              onClick={() => {
                setStatusFilter('all');
                setTierFilter('all');
                setSearchTerm('');
                setDebouncedSearch('');
                setCurrentPage(1);
              }}
            >
              Reset Filters
            </button>
          )}

          <button
            type="button"
            className="refresh-btn"
            onClick={fetchLeaderboard}
            disabled={loading}
            title="Refresh Leaderboard"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 6. Standings Table View */}
      <div className="standings-table-card">
        {loading && standings.length === 0 ? (
          <div className="standings-loading-state">
            <div className="btn-spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }}></div>
            <p style={{ marginTop: '14px', color: 'var(--text-secondary)' }}>Calculating platform standings...</p>
          </div>
        ) : error ? (
          <div className="standings-error-state">
            <p style={{ color: 'var(--accent-danger)' }}>{error}</p>
            <button className="btn btn-primary" onClick={fetchLeaderboard}>
              Retry
            </button>
          </div>
        ) : standings.length === 0 ? (
          <div className="standings-empty-state">
            <SlidersHorizontal className="w-10 h-10 text-slate-500" style={{ marginBottom: '12px' }} />
            <h3>No Coders Found</h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              No students match the current filter criteria or search query.
            </p>
          </div>
        ) : (
          <div className="table-scroll-container">
            <table className="global-standings-table">
              <thead>
                <tr>
                  <th style={{ width: '70px', textAlign: 'center' }}>Rank</th>
                  <th>Coder</th>
                  <th>Institution</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>Rating Tier</th>
                  <th style={{ width: '100px', textAlign: 'right' }}>Rating</th>
                  <th style={{ width: '100px', textAlign: 'right' }}>Peak</th>
                  <th style={{ width: '90px', textAlign: 'center' }}>Solved</th>
                  <th style={{ width: '90px', textAlign: 'center' }}>Contests</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((student) => {
                  const isCurrentUser = Boolean(currentUser && currentUser.id === student.userId);
                  const isTop3 = student.rank <= 3;
                  const rankIcon =
                    student.rank === 1 ? '🥇' : student.rank === 2 ? '🥈' : student.rank === 3 ? '🥉' : null;

                  return (
                    <tr
                      key={student.userId}
                      className={`standings-row ${isCurrentUser ? 'user-row-self' : ''}`}
                      onClick={() => onNavigateProfile && onNavigateProfile(student.username)}
                    >
                      {/* Rank */}
                      <td style={{ textAlign: 'center' }}>
                        <div className="rank-cell-wrapper">
                          {rankIcon ? (
                            <span className="rank-medal-icon" title={`Rank #${student.rank}`}>
                              {rankIcon}
                            </span>
                          ) : (
                            <span className={`rank-number ${isTop3 ? 'top-rank' : ''}`}>
                              #{student.rank}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Coder Info */}
                      <td>
                        <div className="coder-profile-cell">
                          <div className="coder-cell-emblem">
                            <CoderEmblem
                              username={student.username}
                              rating={student.currentRating}
                              tierColor={student.tier?.color || '#06b6d4'}
                              tierTitle={student.tier?.name || 'Challenger'}
                              size="sm"
                            />
                          </div>
                          <div className="coder-cell-text">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="coder-cell-name">
                                {student.fullName || student.username}
                              </span>
                              {isCurrentUser && <span className="self-tag-badge">YOU</span>}
                            </div>
                            <span className="coder-cell-handle">@{student.username}</span>
                          </div>
                        </div>
                      </td>

                      {/* Institution */}
                      <td>
                        <span className="inst-cell-text">
                          {student.institution ? (
                            <>
                              <Building2 className="w-3.5 h-3.5 text-slate-400" />
                              <span>{student.institution}</span>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </span>
                      </td>

                      {/* Tier */}
                      <td style={{ textAlign: 'center' }}>
                        <span
                          className="tier-pill-badge"
                          style={{
                            color: student.tier?.color || '#06b6d4',
                            background: student.tier?.bg || 'rgba(6, 182, 212, 0.15)',
                            borderColor: `${student.tier?.color || '#06b6d4'}40`,
                          }}
                        >
                          {student.tier?.badge || 'CHALLENGER'}
                        </span>
                      </td>

                      {/* Current Rating */}
                      <td style={{ textAlign: 'right' }}>
                        <span className="rating-num-cell" style={{ color: student.tier?.color || 'var(--text-primary)' }}>
                          {student.currentRating}
                        </span>
                      </td>

                      {/* Highest Rating */}
                      <td style={{ textAlign: 'right' }}>
                        <span className="peak-rating-cell">{student.highestRating}</span>
                      </td>

                      {/* Solved Problems */}
                      <td style={{ textAlign: 'center' }}>
                        <span className="solved-count-cell">{student.problemsSolvedCount}</span>
                      </td>

                      {/* Rated Contests */}
                      <td style={{ textAlign: 'center' }}>
                        <span className="contests-count-cell">{student.ratedContestCount}</span>
                      </td>

                      {/* Status */}
                      <td style={{ textAlign: 'center' }}>
                        <span className={`status-pill status-pill-${student.ratingStatus}`}>
                          {student.ratingStatus === 'rated' ? 'RATED' : 'PROVISIONAL'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 7. Pagination Controls */}
        {totalPages > 1 && (
          <div className="standings-pagination-bar">
            <span className="pagination-info-text">
              Showing <strong>{(currentPage - 1) * pageSize + 1}</strong>–
              <strong>{Math.min(currentPage * pageSize, totalUsers)}</strong> of{' '}
              <strong>{totalUsers}</strong> Coders
            </span>

            <div className="pagination-btns-group">
              <button
                type="button"
                className="btn btn-secondary pagination-btn"
                disabled={currentPage <= 1 || loading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <span className="page-indicator">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                className="btn btn-secondary pagination-btn"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
