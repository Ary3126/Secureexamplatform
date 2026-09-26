import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Filter,
  Code2,
  Terminal,
  Globe,
  Lock,
  Layers,
  Archive,
  Edit3,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Eye,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import './adminProblemManagement.css';

/**
 * Admin Problem Management Shell — Problem List View (Phase 7.4.1)
 * Displays the complete problem bank with search, filters, pagination,
 * and routing to Add Problem (/admin/problems/new) and Edit Problem (/admin/problems/:id/edit).
 */
export default function AdminProblemManagement({
  problems = [],
  totalProblems = 0,
  page = 1,
  limit = 20,
  search = '',
  difficultyFilter = 'all',
  codingModeFilter = 'all',
  statusFilter = 'all',
  scopeFilter = 'all',
  loading = false,
  isProcessing = false,
  onSearchChange,
  onDifficultyFilterChange,
  onCodingModeFilterChange,
  onStatusFilterChange,
  onScopeFilterChange,
  onResetFilters,
  onPageChange,
  onNavigateToCreate,
  onNavigateToEdit,
  onArchiveProblem,
}) {
  const totalPages = Math.max(Math.ceil(totalProblems / limit) || 1, 1);
  const hasActiveFilters =
    (search && search.trim() !== '') ||
    difficultyFilter !== 'all' ||
    codingModeFilter !== 'all' ||
    statusFilter !== 'all' ||
    scopeFilter !== 'all';

  return (
    <div className="admin-problems-container" data-testid="admin-problem-management">
      {/* 1. Header with Add Problem Primary Action */}
      <div className="admin-problems-header">
        <div className="admin-problems-title-wrap">
          <h2>Problem Bank Management</h2>
          <span className="admin-problems-subtitle">
            Oversee platform problems, inspect coding architectures, author new problems, and manage problem lifecycles.
          </span>
        </div>

        <div>
          <button
            className="btn-primary"
            onClick={onNavigateToCreate}
            data-testid="add-problem-btn"
          >
            <Plus size={16} /> Add Problem
          </button>
        </div>
      </div>

      {/* 2. Filter Toolbar */}
      <div className="admin-problems-toolbar">
        <div className="problems-search-wrap">
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search problems by title, description, or ID..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="problem-search-input"
          />
        </div>

        <div className="problems-filters-group">
          {/* Difficulty */}
          <select
            className="problem-filter-select"
            value={difficultyFilter}
            onChange={(e) => onDifficultyFilterChange(e.target.value)}
            data-testid="difficulty-filter-select"
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          {/* Coding Mode */}
          <select
            className="problem-filter-select"
            value={codingModeFilter}
            onChange={(e) => onCodingModeFilterChange(e.target.value)}
            data-testid="coding-mode-filter-select"
          >
            <option value="all">All Coding Modes</option>
            <option value="function">Function Mode (LeetCode)</option>
            <option value="full_program">Standard OJ (Full Program)</option>
          </select>

          {/* Access Scope */}
          <select
            className="problem-filter-select"
            value={scopeFilter}
            onChange={(e) => onScopeFilterChange(e.target.value)}
            data-testid="scope-filter-select"
          >
            <option value="all">All Scopes</option>
            <option value="public">Public Explorer</option>
            <option value="contest_private">Contest Private</option>
            <option value="class">Classroom</option>
            <option value="institution">Institution</option>
          </select>

          {/* Review Status */}
          <select
            className="problem-filter-select"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            data-testid="status-filter-select"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
            <option value="in_review">In Review</option>
          </select>

          {hasActiveFilters && (
            <button
              className="btn-secondary"
              onClick={onResetFilters}
              title="Reset all filters"
              data-testid="reset-problem-filters-btn"
              style={{ padding: '6px 12px', fontSize: '0.78rem' }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* 3. Problems Table Card */}
      <div className="admin-problems-card">
        {loading ? (
          <AuthoringLoadingState message="Loading platform problems directory..." />
        ) : problems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
            <BookOpen size={36} style={{ margin: '0 auto 12px auto', opacity: 0.4, display: 'block' }} />
            <h4 style={{ margin: '0 0 6px 0', color: '#cbd5e1', fontSize: '1rem', fontWeight: 600 }}>
              No Problems Found
            </h4>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              {hasActiveFilters
                ? 'No problems match your current search and filter criteria.'
                : 'No problems currently available in the database.'}
            </p>
            {hasActiveFilters && (
              <button
                className="btn-secondary"
                onClick={onResetFilters}
                style={{ marginTop: '14px', fontSize: '0.8rem' }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-problems-table">
              <thead>
                <tr>
                  <th>Problem Title</th>
                  <th>Difficulty</th>
                  <th>Coding Mode</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Acceptance</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((p) => {
                  const modeStr = (p.codingMode || p.coding_mode || 'full_program').toLowerCase();
                  const diffStr = (p.difficulty || 'medium').toLowerCase();
                  const scopeStr = (p.accessScope || p.access_scope || 'contest_private').toLowerCase();
                  const statusStr = (p.reviewStatus || p.review_status || (p.isPublished || p.is_published ? 'published' : 'draft')).toLowerCase();

                  return (
                    <tr key={p.id} data-testid={`problem-row-${p.id}`}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9rem' }}>
                            {p.title}
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                            #{p.id} • Version {p.version || 1} • By {p.creatorUsername || 'Author'}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span className={`badge-diff ${diffStr}`}>
                          {diffStr}
                        </span>
                      </td>

                      <td>
                        <span className={`badge-coding-mode ${modeStr}`}>
                          {modeStr === 'function' ? <Code2 size={12} /> : <Terminal size={12} />}
                          {modeStr === 'function' ? 'Function' : 'Full Program'}
                        </span>
                      </td>

                      <td>
                        <span className={`badge-scope ${scopeStr}`}>
                          {scopeStr === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                          {scopeStr.replace('_', ' ')}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', color: statusStr === 'published' ? '#4ade80' : statusStr === 'archived' ? '#f87171' : '#94a3b8' }}>
                          {statusStr}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>
                          {p.acceptanceRate !== undefined ? `${p.acceptanceRate}%` : 'N/A'}
                        </span>
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            className="btn-table-action"
                            onClick={() => onNavigateToEdit(p.id)}
                            title="Edit Problem"
                            data-testid={`edit-problem-btn-${p.id}`}
                          >
                            <Edit3 size={13} /> Edit
                          </button>

                          {statusStr !== 'archived' && (
                            <button
                              className="btn-table-action suspend"
                              onClick={() => onArchiveProblem && onArchiveProblem(p.id)}
                              disabled={isProcessing}
                              title="Archive Problem"
                              data-testid={`archive-problem-btn-${p.id}`}
                            >
                              <Archive size={13} /> Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. Pagination */}
        {totalProblems > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '14px', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Showing {problems.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, totalProblems)} of {totalProblems} problems
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                data-testid="problem-pagination-prev"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span style={{ padding: '4px 10px', fontSize: '0.8rem', color: '#f8fafc', fontWeight: 700 }}>
                Page {page} of {totalPages}
              </span>

              <button
                className="pagination-btn"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                data-testid="problem-pagination-next"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
