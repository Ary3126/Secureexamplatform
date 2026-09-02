import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  SlidersHorizontal,
  ArrowUpDown,
  LayoutGrid,
  List,
  Sparkles,
  Clock,
  Eye,
  FileEdit,
  ArrowRight,
  Plus,
} from 'lucide-react';
import StatusBadge from './StatusBadge';

/**
 * Filterable, Searchable & Sortable Problem Table / Grid View
 * Provides easy scanning, quick filtering, and clean pagination.
 */
export default function ProblemTable({
  problems = [],
  selectedProblemId = null,
  onSelectProblem,
  onCreateProblem,
  onEditProblem,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated_desc');
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Filter & Sort Logic
  const filteredProblems = useMemo(() => {
    return problems.filter((p) => {
      // Search by title or ID
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (p.title || '').toLowerCase().includes(q);
        const matchesId = String(p.id).includes(q);
        if (!matchesTitle && !matchesId) return false;
      }

      // Status filter
      if (statusFilter !== 'all') {
        const pStatus = (p.reviewStatus || (p.isPublished ? 'published' : 'draft')).toLowerCase();
        if (statusFilter === 'drafts' && pStatus !== 'draft') return false;
        if (statusFilter === 'in_review' && !['review_requested', 'pending', 'in_review'].includes(pStatus)) return false;
        if (statusFilter === 'approved' && pStatus !== 'approved') return false;
        if (statusFilter === 'published' && pStatus !== 'published') return false;
        if (statusFilter === 'scheduled' && pStatus !== 'scheduled') return false;
        if (statusFilter === 'archived' && pStatus !== 'archived') return false;
      }

      // Difficulty filter
      if (difficultyFilter !== 'all') {
        if ((p.difficulty || 'easy').toLowerCase() !== difficultyFilter) return false;
      }

      // Coding mode filter
      if (modeFilter !== 'all') {
        if ((p.codingMode || 'full_program').toLowerCase() !== modeFilter) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'updated_desc') return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      if (sortBy === 'updated_asc') return new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0);
      if (sortBy === 'title_asc') return (a.title || '').localeCompare(b.title || '');
      if (sortBy === 'version_desc') return (b.version || 1) - (a.version || 1);
      return 0;
    });
  }, [problems, searchQuery, statusFilter, difficultyFilter, modeFilter, sortBy]);

  // Pagination Slice
  const totalPages = Math.max(1, Math.ceil(filteredProblems.length / itemsPerPage));
  const paginatedProblems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProblems.slice(start, start + itemsPerPage);
  }, [filteredProblems, currentPage]);

  const difficultyColors = {
    easy: { color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)' },
    medium: { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)' },
    hard: { color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' },
  };

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* 1. Search, Filters & Controls Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search problems by title or #ID..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '0.85rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter Dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              padding: '8px 12px',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '0.82rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="drafts">Drafts</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
            <option value="archived">Archived</option>
          </select>

          {/* Difficulty Filter */}
          <select
            value={difficultyFilter}
            onChange={(e) => {
              setDifficultyFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              padding: '8px 12px',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '0.82rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '8px 12px',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '0.82rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="updated_desc">Recently Updated</option>
            <option value="updated_asc">Oldest Updated</option>
            <option value="title_asc">Title (A-Z)</option>
            <option value="version_desc">Highest Version</option>
          </select>

          {/* View Toggle */}
          <div style={{ display: 'flex', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '2px' }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                background: viewMode === 'table' ? '#0284c7' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              title="Table View"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                background: viewMode === 'cards' ? '#0284c7' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
              title="Card View"
            >
              <LayoutGrid size={16} />
            </button>
          </div>

          {/* Create Problem Button */}
          {onCreateProblem && (
            <button
              onClick={onCreateProblem}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} /> New Problem
            </button>
          )}
        </div>
      </div>

      {/* 2. Problem List View (Table or Cards) */}
      {paginatedProblems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
          <p style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '8px' }}>No problems match the current filters</p>
          <span style={{ fontSize: '0.85rem' }}>Try clearing filters or search query to view all problems.</span>
        </div>
      ) : viewMode === 'table' ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 14px' }}>Problem</th>
                <th style={{ padding: '12px 14px' }}>Difficulty</th>
                <th style={{ padding: '12px 14px' }}>Mode</th>
                <th style={{ padding: '12px 14px' }}>Version</th>
                <th style={{ padding: '12px 14px' }}>Status</th>
                <th style={{ padding: '12px 14px' }}>Last Updated</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProblems.map((prob) => {
                const diffCfg = difficultyColors[(prob.difficulty || 'easy').toLowerCase()] || difficultyColors.easy;
                const isSelected = selectedProblemId === prob.id;

                return (
                  <tr
                    key={prob.id}
                    onClick={() => onSelectProblem && onSelectProblem(prob.id)}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: '700', color: '#f8fafc', fontSize: '0.9rem' }}>
                          {prob.title || 'Untitled Problem'}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          #{prob.id} • {prob.accessScope === 'public' ? 'Public Bank' : 'Contest Private'}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: diffCfg.bg,
                          color: diffCfg.color,
                        }}
                      >
                        {prob.difficulty || 'easy'}
                      </span>
                    </td>
                    <td style={{ padding: '14px', color: '#cbd5e1', fontSize: '0.8rem' }}>
                      {prob.codingMode === 'function' ? 'Function' : 'Full Program'}
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px' }}>
                        v{prob.version || 1}
                      </span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <StatusBadge status={prob.reviewStatus || (prob.isPublished ? 'published' : 'draft')} size="sm" />
                    </td>
                    <td style={{ padding: '14px', color: '#64748b', fontSize: '0.78rem' }}>
                      {prob.updatedAt ? new Date(prob.updatedAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProblem ? onEditProblem(prob.id) : onSelectProblem(prob.id);
                          }}
                          style={{
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            color: '#38bdf8',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Open Studio
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {paginatedProblems.map((prob) => {
            const diffCfg = difficultyColors[(prob.difficulty || 'easy').toLowerCase()] || difficultyColors.easy;
            const isSelected = selectedProblemId === prob.id;

            return (
              <div
                key={prob.id}
                onClick={() => onSelectProblem && onSelectProblem(prob.id)}
                style={{
                  background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(0,0,0,0.2)',
                  border: isSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  padding: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '4px', background: diffCfg.bg, color: diffCfg.color }}>
                      {prob.difficulty || 'easy'}
                    </span>
                    <StatusBadge status={prob.reviewStatus || (prob.isPublished ? 'published' : 'draft')} size="sm" />
                  </div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', fontWeight: '700', color: '#f8fafc' }}>
                    {prob.title || 'Untitled Problem'}
                  </h4>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', gap: '8px' }}>
                    <span>v{prob.version || 1}</span> •
                    <span>{prob.codingMode === 'function' ? 'Function Mode' : 'Full Program'}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    {prob.updatedAt ? new Date(prob.updatedAt).toLocaleDateString() : 'Draft'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditProblem ? onEditProblem(prob.id) : onSelectProblem(prob.id);
                    }}
                    style={{
                      background: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Open Studio
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Pagination Controls */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '14px' }}>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, filteredProblems.length)} of {filteredProblems.length} problems
          </span>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: currentPage === 1 ? '#64748b' : '#e2e8f0',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>
            <span style={{ padding: '4px 10px', fontSize: '0.8rem', color: '#cbd5e1' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: currentPage === totalPages ? '#64748b' : '#e2e8f0',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
