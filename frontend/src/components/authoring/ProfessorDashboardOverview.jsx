import React from 'react';
import {
  Trophy,
  BookOpen,
  Inbox,
  Sparkles,
  Layers,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  FileEdit,
  Globe,
  GitCompare,
  TrendingUp,
  Check,
  ShieldCheck,
  RotateCcw,
  Activity,
} from 'lucide-react';
import StatusBadge from './StatusBadge';

/**
 * Enhanced Professor Academic Dashboard Overview Component (Phase 5.9.9)
 * Tailored specifically for Professors to manage their academic problem bank,
 * test case formulations, editorial quality, and class examinations.
 */
export default function ProfessorDashboardOverview({
  contests = [],
  problems = [],
  reviewQueue = [],
  currentUser,
  onNavigateSection,
  onOpenCreateProblem,
  onOpenCreateContest,
  onSelectContest,
  onSelectProblem,
}) {
  // Problem state breakdown
  const draftProblems = problems.filter((p) => (p.reviewStatus || 'draft').toLowerCase() === 'draft');
  const inReviewProblems = problems.filter(
    (p) => (p.reviewStatus || '').toLowerCase() === 'review_requested' || (p.reviewStatus || '').toLowerCase() === 'in_review'
  );
  const approvedProblems = problems.filter((p) => (p.reviewStatus || '').toLowerCase() === 'approved');
  const publishedProblems = problems.filter((p) => p.isPublished || p.is_published);
  const changesRequestedProblems = problems.filter((p) => (p.reviewStatus || '').toLowerCase() === 'changes_requested');
  const archivedProblems = problems.filter((p) => (p.reviewStatus || '').toLowerCase() === 'archived');

  // Contest breakdown
  const activeContests = contests.filter((c) => (c.status || '').toLowerCase() === 'published' || (c.status || '').toLowerCase() === 'running');
  const draftContests = contests.filter((c) => (c.status || '').toLowerCase() === 'draft');

  // Attention items: changes requested, review requested, rejected
  const attentionProblems = problems.filter((p) => {
    const st = (p.reviewStatus || '').toLowerCase();
    return st === 'changes_requested' || st === 'rejected' || st === 'review_requested';
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Academic Hub Header & Quick Actions */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9))',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: '800',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                textTransform: 'uppercase',
              }}
            >
              Academic Workspace
            </span>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              Welcome back, {currentUser?.full_name || currentUser?.username || 'Professor'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '1.45rem', color: '#f8fafc', fontWeight: '800' }}>
            Professor Authoring & Examination Studio
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={onOpenCreateProblem}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#0369a1')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#0284c7')}
          >
            <Plus size={16} /> Create Problem
          </button>

          <button
            onClick={onOpenCreateContest}
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              padding: '10px 18px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)')}
          >
            <Trophy size={16} /> Create Contest
          </button>

          <button
            onClick={() => onNavigateSection && onNavigateSection('reviews')}
            style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              color: '#fbbf24',
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Inbox size={16} /> Review Tasks ({reviewQueue.length})
          </button>
        </div>
      </div>

      {/* 2. Overview KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {/* My Problems Card */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>My Problem Bank</span>
            <BookOpen size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {problems.length}
          </div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', color: '#94a3b8' }}>
            <span>{publishedProblems.length} Published</span>
            <span>•</span>
            <span>{draftProblems.length} Drafts</span>
          </div>
        </div>

        {/* Draft Problems Card */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Drafts in Progress</span>
            <FileEdit size={18} color="#94a3b8" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {draftProblems.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Awaiting formulation & submission
          </div>
        </div>

        {/* Problems In Review */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Under Peer Review</span>
            <Clock size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {inReviewProblems.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#38bdf8' }}>
            Submitted for faculty appraisal
          </div>
        </div>

        {/* Approved Problems Ready to Publish */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Approved for Publish</span>
            <Sparkles size={18} color="#c084fc" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {approvedProblems.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: '600' }}>
            Ready to attach to class exams
          </div>
        </div>

        {/* My Contests Card */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('contests')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>My Contests</span>
            <Trophy size={18} color="#4ade80" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {contests.length}
          </div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', color: '#94a3b8' }}>
            <span style={{ color: '#4ade80' }}>{activeContests.length} Active</span>
            <span>•</span>
            <span>{draftContests.length} Drafts</span>
          </div>
        </div>

        {/* Assigned Peer Reviews Card */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('reviews')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Assigned Reviews</span>
            <Inbox size={18} color="#fbbf24" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc', marginBottom: '8px' }}>
            {reviewQueue.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
            Pending peer evaluations
          </div>
        </div>

        {/* Needs Changes Card */}
        <div
          onClick={() => onNavigateSection && onNavigateSection('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Needs Revision</span>
            <AlertTriangle size={18} color="#f87171" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: changesRequestedProblems.length > 0 ? '#f87171' : '#f8fafc', marginBottom: '8px' }}>
            {changesRequestedProblems.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: changesRequestedProblems.length > 0 ? '#f87171' : '#94a3b8' }}>
            {changesRequestedProblems.length > 0 ? 'Reviewer feedback pending' : 'No revisions pending'}
          </div>
        </div>
      </div>

      {/* 3. Problem Quality & Publication Intelligence Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Quality & Editorial Readiness Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} color="#38bdf8" />
              <span>Problem Quality & Editorial Intelligence</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: '700' }}>PHASE 5.9.7</span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: '1.5', margin: '0 0 16px 0' }}>
            Automated quality diagnostics assess statement clarity, test case coverage, constraint specifications, and duplicate similarity checks.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', textAlign: 'center', background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#4ade80' }}>
                {problems.length > 0 ? Math.round((publishedProblems.length / problems.length) * 100) : 100}%
              </span>
              <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8' }}>Checklist Health</span>
            </div>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#38bdf8' }}>
                {approvedProblems.length + publishedProblems.length}
              </span>
              <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8' }}>Verified Problems</span>
            </div>
            <div>
              <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#fbbf24' }}>
                {reviewRequestedProblems.length}
              </span>
              <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8' }}>In Queue</span>
            </div>
          </div>
        </div>

        {/* Lifecycle & Version History Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RotateCcw size={18} color="#c084fc" />
              <span>Lifecycle & Version History</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#c084fc', fontWeight: '700' }}>PHASE 5.9.8</span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: '1.5', margin: '0 0 16px 0' }}>
            Immutable problem versioning with side-by-side diff comparisons, instantaneous rollback, safe contest dependency checks, and publication scheduling.
          </p>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', background: 'rgba(34,197,94,0.15)', color: '#4ade80', borderRadius: '6px', fontWeight: '600' }}>
              {publishedProblems.length} Published Live
            </span>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', background: 'rgba(168,85,247,0.15)', color: '#c084fc', borderRadius: '6px', fontWeight: '600' }}>
              {approvedProblems.length} Approved Ready
            </span>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', background: 'rgba(148,163,184,0.15)', color: '#94a3b8', borderRadius: '6px', fontWeight: '600' }}>
              {archivedProblems.length} Archived
            </span>
          </div>
        </div>
      </div>

      {/* 4. Attention Items & Managed Class Examinations Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Problems Requiring Attention */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={17} color="#fbbf24" />
              <span>Needs Your Attention</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{attentionProblems.length} items</span>
          </div>

          {attentionProblems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b', fontSize: '0.85rem' }}>
              <CheckCircle2 size={24} color="#4ade80" style={{ margin: '0 auto 8px auto', display: 'block' }} />
              All problem reviews and authoring workflows are up to date!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {attentionProblems.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  onClick={() => onSelectProblem && onSelectProblem(p.id)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: '700', color: '#f8fafc', fontSize: '0.85rem', display: 'block' }}>
                      {p.title}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>v{p.version || 1} • ID: #{p.id}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <StatusBadge status={p.reviewStatus || 'draft'} size="sm" />
                    <ArrowRight size={14} color="#64748b" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Managed Class Contests */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trophy size={17} color="#4ade80" />
              <span>My Class Examinations</span>
            </h3>
            <button
              onClick={() => onNavigateSection && onNavigateSection('contests')}
              style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.78rem', cursor: 'pointer', fontWeight: '600' }}
            >
              View All ({contests.length})
            </button>
          </div>

          {contests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b', fontSize: '0.85rem' }}>
              No exams created yet. Click "+ Create Contest" to host your first exam.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {contests.slice(0, 4).map((c) => (
                <div
                  key={c.id}
                  onClick={() => onSelectContest && onSelectContest(c.id)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: '700', color: '#f8fafc', fontSize: '0.85rem', display: 'block' }}>
                      {c.title}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {c.problemsCount || c.problems?.length || 0} Problems • {c.participantsCount || 0} Students
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: c.status === 'published' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                        color: c.status === 'published' ? '#4ade80' : '#94a3b8',
                      }}
                    >
                      {c.status || 'draft'}
                    </span>
                    <ArrowRight size={14} color="#64748b" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
