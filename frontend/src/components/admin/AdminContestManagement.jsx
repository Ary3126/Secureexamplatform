import React, { useState } from 'react';
import {
  Trophy,
  Search,
  Users,
  Calendar,
  Layers,
  Archive,
  Globe,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Admin Platform-Wide Contest Administration View
 * Oversees all platform contests, host professors, participation metrics, and exam schedules.
 */
export default function AdminContestManagement({
  contests = [],
  loading = false,
  onInspectContest,
  onPublishContest,
  onArchiveContest,
  isProcessing = false,
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredContests = contests.filter((c) => {
    if (statusFilter !== 'all' && (c.status || 'draft').toLowerCase() !== statusFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = (c.title || '').toLowerCase().includes(q);
      const matchDesc = (c.description || '').toLowerCase().includes(q);
      const matchId = String(c.id).includes(q);
      if (!matchTitle && !matchDesc && !matchId) return false;
    }
    return true;
  });

  const getStatusBadge = (status) => {
    const st = (status || 'draft').toLowerCase();
    const map = {
      published: { label: 'Published / Active', bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' },
      draft: { label: 'Draft', bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' },
      archived: { label: 'Archived', bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171' },
      running: { label: 'Running Now', bg: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' },
    };
    const s = map[st] || map.draft;
    return (
      <span
        style={{
          fontSize: '0.72rem',
          fontWeight: '700',
          textTransform: 'uppercase',
          padding: '2px 8px',
          borderRadius: '4px',
          background: s.bg,
          color: s.color,
        }}
      >
        {s.label}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header */}
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
          Platform Contest Administration
        </h2>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
          Inspect all exams and contests created across the institution.
        </span>
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
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search contests by title, ID, or description..."
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '7px 12px',
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '0.82rem',
              outline: 'none',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="published">Published / Active</option>
            <option value="draft">Draft Only</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* 3. Contests Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        {loading ? (
          <AuthoringLoadingState message="Loading platform contests..." />
        ) : filteredContests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '0.9rem' }}>
            No platform contests found matching your criteria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>Contest Name</th>
                  <th style={{ padding: '12px 14px' }}>Host Professor</th>
                  <th style={{ padding: '12px 14px' }}>Status</th>
                  <th style={{ padding: '12px 14px' }}>Problems</th>
                  <th style={{ padding: '12px 14px' }}>Enrolled</th>
                  <th style={{ padding: '12px 14px' }}>Timeline</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContests.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontWeight: '700', color: '#f8fafc', display: 'block' }}>{c.title}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>ID: #{c.id}</span>
                    </td>
                    <td style={{ padding: '14px', color: '#cbd5e1' }}>
                      {c.creatorName || (c.created_by ? `Professor #${c.created_by}` : 'System Admin')}
                    </td>
                    <td style={{ padding: '14px' }}>
                      {getStatusBadge(c.status)}
                    </td>
                    <td style={{ padding: '14px', color: '#38bdf8', fontWeight: '700' }}>
                      {c.problemsCount || c.problems_count || c.problems?.length || 0}
                    </td>
                    <td style={{ padding: '14px', color: '#4ade80', fontWeight: '700' }}>
                      {c.participantsCount || c.participants_count || 0}
                    </td>
                    <td style={{ padding: '14px', color: '#94a3b8', fontSize: '0.78rem' }}>
                      <div>Start: {c.startTime || c.start_time ? new Date(c.startTime || c.start_time).toLocaleDateString() : 'N/A'}</div>
                      <div>End: {c.endTime || c.end_time ? new Date(c.endTime || c.end_time).toLocaleDateString() : 'N/A'}</div>
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          onClick={() => onInspectContest && onInspectContest(c.id)}
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
                          <Eye size={13} /> Results
                        </button>

                        {(c.status === 'draft') && onPublishContest && (
                          <button
                            onClick={() => onPublishContest(c.id)}
                            disabled={isProcessing}
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              color: '#4ade80',
                              borderRadius: '4px',
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              fontWeight: '700',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Globe size={13} /> Publish
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
