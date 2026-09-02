import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  X,
  Filter,
  Star,
  CheckCircle2,
  Clock,
  Circle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Layers,
  Sparkles,
  BookOpen,
  ArrowRight,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';

export default function ProblemExplorer({
  token,
  currentUser,
  initialFilters = {},
  onSelectProblem,
  onUrlParamChange,
}) {
  // Filter States
  const [search, setSearch] = useState(initialFilters.search || '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters.search || '');
  const [difficulty, setDifficulty] = useState(initialFilters.difficulty || 'all');
  const [codingMode, setCodingMode] = useState(initialFilters.codingMode || 'all');
  const [status, setStatus] = useState(initialFilters.status || 'all');
  const [sortBy, setSortBy] = useState(initialFilters.sortBy || 'newest');
  const [page, setPage] = useState(parseInt(initialFilters.page, 10) || 1);

  // Data States
  const [problems, setProblems] = useState([]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalProblems: 0,
    limit: 20,
    hasNext: false,
    hasPrev: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingBookmarkId, setSavingBookmarkId] = useState(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync state with URL parameters
  useEffect(() => {
    if (onUrlParamChange) {
      onUrlParamChange({
        search: debouncedSearch || undefined,
        difficulty: difficulty !== 'all' ? difficulty : undefined,
        codingMode: codingMode !== 'all' ? codingMode : undefined,
        status: status !== 'all' ? status : undefined,
        sortBy: sortBy !== 'newest' ? sortBy : undefined,
        page: page > 1 ? page : undefined,
      });
    }
  }, [debouncedSearch, difficulty, codingMode, status, sortBy, page, onUrlParamChange]);

  // Fetch problems from server with filters & pagination
  const fetchProblems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      if (difficulty !== 'all') params.append('difficulty', difficulty);
      if (codingMode !== 'all') params.append('codingMode', codingMode);
      if (status !== 'all') {
        if (status === 'saved') {
          params.append('saved', 'true');
        } else {
          params.append('status', status);
        }
      }
      if (sortBy) params.append('sortBy', sortBy);
      params.append('page', page.toString());
      params.append('limit', '15');

      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/problems?${params.toString()}`, { headers });
      const data = await res.json();

      if (res.ok) {
        setProblems(data.problems || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        setError(data.message || 'Failed to load problems');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching problems');
    } finally {
      setLoading(false);
    }
  }, [token, debouncedSearch, difficulty, codingMode, status, sortBy, page]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  // Toggle Bookmark
  const handleToggleBookmark = async (problemId, currentIsSaved, e) => {
    e.stopPropagation();
    if (!token) {
      alert('Please log in to save problems to your bookmarks.');
      return;
    }

    setSavingBookmarkId(problemId);
    // Optimistic UI update
    setProblems((prev) =>
      prev.map((p) => (p.id === problemId ? { ...p, isSaved: !currentIsSaved } : p))
    );

    try {
      const method = currentIsSaved ? 'DELETE' : 'POST';
      const res = await fetch(`/api/problems/${problemId}/bookmark`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        // Revert on error
        setProblems((prev) =>
          prev.map((p) => (p.id === problemId ? { ...p, isSaved: currentIsSaved } : p))
        );
      }
    } catch (err) {
      // Revert on error
      setProblems((prev) =>
        prev.map((p) => (p.id === problemId ? { ...p, isSaved: currentIsSaved } : p))
      );
    } finally {
      setSavingBookmarkId(null);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setDifficulty('all');
    setCodingMode('all');
    setStatus('all');
    setSortBy('newest');
    setPage(1);
  };

  const hasActiveFilters =
    debouncedSearch.trim() !== '' ||
    difficulty !== 'all' ||
    codingMode !== 'all' ||
    status !== 'all' ||
    sortBy !== 'newest';

  const renderStatusBadge = (userStatus) => {
    switch (userStatus) {
      case 'solved':
        return (
          <span className="prob-status-badge status-solved" title="Solved">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Solved</span>
          </span>
        );
      case 'attempted':
        return (
          <span className="prob-status-badge status-attempted" title="Attempted">
            <Clock className="w-3.5 h-3.5" />
            <span>Attempted</span>
          </span>
        );
      default:
        return (
          <span className="prob-status-badge status-unsolved" title="Not Attempted">
            <Circle className="w-3.5 h-3.5" />
            <span>Todo</span>
          </span>
        );
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

  return (
    <div className="explorer-container">
      {/* 1. Header Banner */}
      <div className="explorer-header">
        <div>
          <div className="explorer-badge">
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>Problem Bank</span>
          </div>
          <h1 className="explorer-title">Problem Explorer</h1>
          <p className="explorer-subtitle">
            Explore and practice algorithmic challenges with automated judge feedback in C++, Python, and Java.
          </p>
        </div>
      </div>

      {/* 2. Filter & Search Controls Bar */}
      <div className="explorer-controls-card">
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search problems by title, keyword, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch('')}
              aria-label="Clear Search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="filters-row">
          {/* Difficulty */}
          <div className="filter-select-group">
            <label className="filter-label">Difficulty</label>
            <select
              className="filter-select"
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          {/* Status (Solved / Attempted / Saved) */}
          <div className="filter-select-group">
            <label className="filter-label">Status</label>
            <select
              className="filter-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Status</option>
              {currentUser && <option value="solved">Solved (Passed)</option>}
              {currentUser && <option value="attempted">Attempted (Unsolved)</option>}
              {currentUser && <option value="unsolved">Not Attempted</option>}
              {currentUser && <option value="saved">Bookmarked (Saved)</option>}
            </select>
          </div>

          {/* Coding Mode */}
          <div className="filter-select-group">
            <label className="filter-label">Mode</label>
            <select
              className="filter-select"
              value={codingMode}
              onChange={(e) => {
                setCodingMode(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Modes</option>
              <option value="function">Function Mode</option>
              <option value="full_program">Full Program</option>
            </select>
          </div>

          {/* Sorting */}
          <div className="filter-select-group">
            <label className="filter-label">Sort By</label>
            <select
              className="filter-select"
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="difficulty_asc">Difficulty: Easy ➔ Hard</option>
              <option value="difficulty_desc">Difficulty: Hard ➔ Easy</option>
              <option value="title_asc">Title (A ➔ Z)</option>
              <option value="acceptance_rate">Highest Acceptance</option>
            </select>
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn-secondary btn-sm reset-filter-btn"
              onClick={handleResetFilters}
              title="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Problems List Table */}
      <div className="problems-table-card">
        {loading ? (
          <div className="table-skeleton-container">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="table-row-skeleton" />
            ))}
          </div>
        ) : error ? (
          <div className="explorer-error-box">
            <p>{error}</p>
            <button className="btn btn-primary btn-sm" onClick={fetchProblems}>
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : problems.length === 0 ? (
          <div className="explorer-empty-box">
            <BookOpen className="w-10 h-10 text-muted" />
            <h3>No problems found</h3>
            <p>No challenges match your current search and filter criteria.</p>
            {hasActiveFilters && (
              <button className="btn btn-primary btn-sm" onClick={handleResetFilters}>
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="problems-table-wrapper">
            <table className="problems-custom-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th style={{ width: '100px' }}>Status</th>
                  <th>Title</th>
                  <th style={{ width: '110px' }}>Difficulty</th>
                  <th style={{ width: '130px' }}>Mode</th>
                  <th style={{ width: '120px' }}>Acceptance</th>
                  <th style={{ width: '140px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((prob) => {
                  const isSaved = !!prob.isSaved;
                  return (
                    <tr
                      key={prob.id}
                      className="problem-table-row"
                      onClick={() => onSelectProblem(prob.id)}
                    >
                      {/* Bookmark Star Button */}
                      <td className="cell-bookmark">
                        <button
                          type="button"
                          className={`bookmark-star-btn ${isSaved ? 'saved' : ''}`}
                          onClick={(e) => handleToggleBookmark(prob.id, isSaved, e)}
                          title={isSaved ? 'Remove from Saved' : 'Save Problem'}
                          aria-label={isSaved ? 'Remove Bookmark' : 'Bookmark Problem'}
                          disabled={savingBookmarkId === prob.id}
                        >
                          <Star className={`w-4 h-4 ${isSaved ? 'fill-current text-amber-400' : 'text-muted'}`} />
                        </button>
                      </td>

                      {/* User Status */}
                      <td className="cell-status">
                        {renderStatusBadge(prob.userStatus)}
                      </td>

                      {/* Problem Title & ID */}
                      <td className="cell-title">
                        <div className="problem-title-cell">
                          <span className="problem-id-tag">#{prob.id}</span>
                          <span className="problem-title-text">{prob.title}</span>
                        </div>
                      </td>

                      {/* Difficulty Badge */}
                      <td className="cell-difficulty">
                        <span className={`diff-pill ${getDifficultyClass(prob.difficulty)}`}>
                          {prob.difficulty ? prob.difficulty.toUpperCase() : 'EASY'}
                        </span>
                      </td>

                      {/* Mode Badge */}
                      <td className="cell-mode">
                        <span className="mode-pill-tag">
                          <Code2 className="w-3 h-3 text-blue-400" />
                          <span>{prob.codingMode === 'function' ? 'Function' : 'Full Script'}</span>
                        </span>
                      </td>

                      {/* Acceptance Rate */}
                      <td className="cell-acceptance">
                        <div className="acceptance-pill-box">
                          <span className="acceptance-rate-num">{prob.acceptanceRate || 0}%</span>
                          <span className="acceptance-sub-count">({prob.totalSubmissions || 0})</span>
                        </div>
                      </td>

                      {/* Solve Action */}
                      <td className="cell-action" style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm table-solve-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProblem(prob.id);
                          }}
                        >
                          <span>Solve</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. Pagination Controls Bar */}
        {!loading && pagination.totalPages > 1 && (
          <div className="table-pagination-bar">
            <div className="pagination-info">
              Showing{' '}
              <strong>
                {(pagination.currentPage - 1) * pagination.limit + 1}–
                {Math.min(pagination.totalProblems, pagination.currentPage * pagination.limit)}
              </strong>{' '}
              of <strong>{pagination.totalProblems}</strong> problems
            </div>

            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-outline btn-sm page-nav-btn"
                disabled={!pagination.hasPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>

              <div className="page-numbers-group">
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter((pNum) => {
                    // Show current page, first, last, and immediate neighbors
                    return (
                      pNum === 1 ||
                      pNum === pagination.totalPages ||
                      Math.abs(pNum - pagination.currentPage) <= 1
                    );
                  })
                  .map((pNum) => (
                    <button
                      key={pNum}
                      type="button"
                      className={`page-num-btn ${pagination.currentPage === pNum ? 'active' : ''}`}
                      onClick={() => setPage(pNum)}
                    >
                      {pNum}
                    </button>
                  ))}
              </div>

              <button
                type="button"
                className="btn btn-outline btn-sm page-nav-btn"
                disabled={!pagination.hasNext}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
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
