import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Filter,
  Sparkles,
  Layers,
  Archive,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Code2,
  X,
} from 'lucide-react';
import StatusBadge from '../authoring/StatusBadge';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Admin Problem Bank Governance View
 * Platform-wide problem bank oversight, quality scoring, review statuses, and general problem provisioning.
 */
export default function AdminProblemGovernance({
  problems = [],
  loading = false,
  onInspectProblem,
  onOpenWorkspace,
  onCreateProblem,
  onArchiveProblem,
  isProcessing = false,
}) {
  const [search, setSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');

  // Modal State for Creating a General Problem
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newProblemData, setNewProblemData] = useState({
    title: '',
    description: '',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
  });

  const filteredProblems = problems.filter((p) => {
    if (difficultyFilter !== 'all' && (p.difficulty || 'easy').toLowerCase() !== difficultyFilter) return false;
    if (scopeFilter !== 'all' && (p.accessScope || p.access_scope || 'contest_private').toLowerCase() !== scopeFilter) return false;
    if (statusFilter !== 'all') {
      const st = (p.reviewStatus || p.review_status || (p.isPublished || p.is_published ? 'published' : 'draft')).toLowerCase();
      if (st !== statusFilter) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = (p.title || '').toLowerCase().includes(q);
      const matchDesc = (p.description || '').toLowerCase().includes(q);
      const matchId = String(p.id).includes(q);
      if (!matchTitle && !matchDesc && !matchId) return false;
    }
    return true;
  });

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!onCreateProblem) return;
    await onCreateProblem(newProblemData);
    setCreateModalOpen(false);
    setNewProblemData({
      title: '',
      description: '',
      difficulty: 'medium',
      codingMode: 'function',
      accessScope: 'public',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header & Quick Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
            Problem Bank Governance & Oversight
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Inspect all problems authored across the institution, quality health, and publication states.
          </span>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          style={{
            background: '#0284c7',
            color: '#fff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '6px',
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Plus size={16} /> Create General Problem
        </button>
      </div>

      {/* 2. Filter Bar */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search problems by title, ID, or keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '0.85rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={difficultyFilter}
            onChange={(e) => setDifficultyFilter(e.target.value)}
            style={{ padding: '7px 10px', background: '#1e293b', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '7px 10px', background: '#1e293b', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value="all">All Lifecycle States</option>
            <option value="published">Published</option>
            <option value="approved">Approved (Ready)</option>
            <option value="review_requested">Review Requested</option>
            <option value="in_review">In Review</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            style={{ padding: '7px 10px', background: '#1e293b', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value="all">All Scopes</option>
            <option value="public">Public Bank</option>
            <option value="contest_private">Contest Private</option>
          </select>
        </div>
      </div>

      {/* 3. Problems Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        {loading ? (
          <AuthoringLoadingState message="Loading problem bank..." />
        ) : filteredProblems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '0.9rem' }}>
            No problems found matching the selected filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>Problem Title</th>
                  <th style={{ padding: '12px 14px' }}>Author</th>
                  <th style={{ padding: '12px 14px' }}>Difficulty</th>
                  <th style={{ padding: '12px 14px' }}>Mode</th>
                  <th style={{ padding: '12px 14px' }}>Governance Status</th>
                  <th style={{ padding: '12px 14px' }}>Scope</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProblems.map((p) => {
                  const status = p.reviewStatus || p.review_status || (p.isPublished || p.is_published ? 'published' : 'draft');
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '14px' }}>
                        <span style={{ fontWeight: '700', color: '#f8fafc', display: 'block' }}>{p.title}</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>v{p.version || 1} • ID: #{p.id}</span>
                      </td>
                      <td style={{ padding: '14px', color: '#cbd5e1' }}>
                        {p.authorName || (p.created_by ? `Professor #${p.created_by}` : 'Author')}
                      </td>
                      <td style={{ padding: '14px' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            color:
                              p.difficulty === 'easy'
                                ? '#4ade80'
                                : p.difficulty === 'medium'
                                ? '#fbbf24'
                                : '#f87171',
                          }}
                        >
                          {p.difficulty}
                        </span>
                      </td>
                      <td style={{ padding: '14px', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {p.codingMode === 'function' || p.coding_mode === 'function' ? 'Function Mode' : 'Full Program'}
                      </td>
                      <td style={{ padding: '14px' }}>
                        <StatusBadge status={status} size="sm" />
                      </td>
                      <td style={{ padding: '14px' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background:
                              (p.accessScope === 'public' || p.access_scope === 'public')
                                ? 'rgba(34, 197, 94, 0.15)'
                                : 'rgba(148, 163, 184, 0.15)',
                            color:
                              (p.accessScope === 'public' || p.access_scope === 'public')
                                ? '#4ade80'
                                : '#94a3b8',
                          }}
                        >
                          {(p.accessScope === 'public' || p.access_scope === 'public') ? 'Public Bank' : 'Private'}
                        </span>
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            onClick={() => onOpenWorkspace && onOpenWorkspace(p.id)}
                            style={{
                              background: 'rgba(56, 189, 248, 0.1)',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              color: '#38bdf8',
                              borderRadius: '4px',
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Code2 size={13} /> Test Solve
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Create General Problem Modal */}
      {createModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
                Create General Problem (Public Bank)
              </h3>
              <button onClick={() => setCreateModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Problem Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Reverse a Linked List"
                  value={newProblemData.title}
                  onChange={(e) => setNewProblemData({ ...newProblemData, title: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Difficulty</label>
                  <select
                    value={newProblemData.difficulty}
                    onChange={(e) => setNewProblemData({ ...newProblemData, difficulty: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Coding Mode</label>
                  <select
                    value={newProblemData.codingMode}
                    onChange={(e) => setNewProblemData({ ...newProblemData, codingMode: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
                  >
                    <option value="function">Function Mode</option>
                    <option value="full_program">Full Program Mode</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Access Scope</label>
                <select
                  value={newProblemData.accessScope}
                  onChange={(e) => setNewProblemData({ ...newProblemData, accessScope: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
                >
                  <option value="public">Public Bank (Visible to all students in Explorer)</option>
                  <option value="contest_private">Contest Private</option>
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Problem Description / Statement</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Provide problem statement, input/output formats, and constraints..."
                  value={newProblemData.description}
                  onChange={(e) => setNewProblemData({ ...newProblemData, description: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setCreateModalOpen(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', padding: '8px 14px', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={isProcessing} style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}>
                  {isProcessing ? 'Creating...' : 'Create General Problem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
