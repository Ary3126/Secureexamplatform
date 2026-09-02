import React from 'react';
import {
  Trophy,
  BookOpen,
  Inbox,
  Activity,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileEdit,
  Sparkles,
  Layers,
} from 'lucide-react';
import StatusBadge from './StatusBadge';

/**
 * Central Admin & Professor Dashboard Overview Component
 * Renders summary metrics cards, recent contests, and problems requiring attention.
 */
export default function AdminDashboardOverview({
  contests = [],
  problems = [],
  reviewQueue = [],
  currentUser,
  onNavigateSection,
  onSelectContest,
  onSelectProblem,
}) {
  const activeContestsCount = contests.filter(
    (c) => c.status === 'published' || c.status === 'running'
  ).length;

  const draftProblemsCount = problems.filter(
    (p) => (p.reviewStatus || 'draft') === 'draft'
  ).length;

  // Problems requiring attention: in review, changes requested, rejected, or low quality
  const problemsRequiringAttention = problems.filter((p) => {
    const st = (p.reviewStatus || 'draft').toLowerCase();
    return st === 'changes_requested' || st === 'rejected' || st === 'review_requested';
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Summary Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {/* My Contests */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('contests')}
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Managed Contests</span>
            <Trophy size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {contests.length}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: '#38bdf8', fontWeight: '600' }}>
            <span>View all contests</span>
            <ArrowRight size={13} />
          </div>
        </div>

        {/* My Problems */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Problem Bank</span>
            <BookOpen size={18} color="#4ade80" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {problems.length}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: '#4ade80', fontWeight: '600' }}>
            <span>Manage problem bank</span>
            <ArrowRight size={13} />
          </div>
        </div>

        {/* Pending Reviews */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('reviews')}
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(192, 132, 252, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Pending Reviews</span>
            <Inbox size={18} color="#c084fc" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#c084fc', marginBottom: '8px' }}>
            {reviewQueue.length}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: '#c084fc', fontWeight: '600' }}>
            <span>Review submissions</span>
            <ArrowRight size={13} />
          </div>
        </div>

        {/* Active Contests */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('contests')}
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Active Contests</span>
            <Activity size={18} color="#fbbf24" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#fbbf24', marginBottom: '8px' }}>
            {activeContestsCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: '#fbbf24', fontWeight: '600' }}>
            <span>View live exams</span>
            <ArrowRight size={13} />
          </div>
        </div>
      </div>

      {/* 2. Problems Requiring Attention (if any) */}
      {problemsRequiringAttention.length > 0 && (
        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} color="#fbbf24" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>
                Problems Requiring Attention ({problemsRequiringAttention.length})
              </h3>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Problem</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>Issue Description</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {problemsRequiringAttention.slice(0, 5).map((prob) => {
                  const st = (prob.reviewStatus || 'draft').toLowerCase();
                  let issueText = 'Awaiting review decision';
                  if (st === 'changes_requested') issueText = 'Reviewer requested changes before approval';
                  if (st === 'rejected') issueText = 'Review rejected. Needs revision';

                  return (
                    <tr key={prob.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontWeight: '700', color: '#f8fafc' }}>{prob.title}</span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>v{prob.version || 1}</span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <StatusBadge status={prob.reviewStatus} size="sm" />
                      </td>
                      <td style={{ padding: '12px', color: '#cbd5e1', fontSize: '0.8rem' }}>
                        {issueText}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <button
                          onClick={() => onSelectProblem && onSelectProblem(prob.id)}
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
                          Resolve in Studio
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Recent Contests Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>
            Managed Contests & Examinations
          </h3>
          <button
            onClick={() => onNavigateSection && onNavigateSection('contests')}
            style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <span>View All Contests</span>
            <ArrowRight size={13} />
          </button>
        </div>

        {contests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#64748b', fontSize: '0.85rem' }}>
            No contests created yet. Click "+ New Contest" to create your first examination.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Contest</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px' }}>Problems</th>
                  <th style={{ padding: '10px 12px' }}>Start Time</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {contests.slice(0, 5).map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontWeight: '700', color: '#f8fafc' }}>{c.title}</span>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>ID: #{c.id}</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: c.status === 'published' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                          color: c.status === 'published' ? '#4ade80' : '#94a3b8',
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: '#cbd5e1' }}>
                      {c.problemsCount || (c.problems?.length) || 0}
                    </td>
                    <td style={{ padding: '12px', color: '#64748b', fontSize: '0.78rem' }}>
                      {c.startTime ? new Date(c.startTime).toLocaleDateString() : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <button
                        onClick={() => onSelectContest && onSelectContest(c.id)}
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
                        Manage
                      </button>
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
