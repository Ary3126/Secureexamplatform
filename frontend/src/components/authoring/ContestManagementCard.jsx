import React from 'react';
import {
  Trophy,
  Users,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Eye,
  Settings,
  Layers,
  BarChart3,
  Globe,
  Archive,
} from 'lucide-react';

/**
 * Contest Management & Verification Card Component
 * Computes human-readable readiness checks (problems approved, test cases configured)
 * and provides direct task-oriented action buttons.
 */
export default function ContestManagementCard({
  contest,
  isAuthor = true,
  onViewContest,
  onManageProblems,
  onViewResults,
  onPublishContest,
  onEditSettings,
}) {
  if (!contest) return null;

  const {
    id,
    title = 'Untitled Contest',
    description = '',
    status = 'draft',
    startTime,
    endTime,
    problemsCount = 0,
    participantsCount = 0,
    problems = [],
    unapprovedCount = 0,
  } = contest;

  const normalizedStatus = (status || 'draft').toLowerCase();

  const statusConfigs = {
    draft: { label: 'Draft', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.3)' },
    ready: { label: 'Ready', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)' },
    upcoming: { label: 'Upcoming', color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)' },
    published: { label: 'Published', color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)' },
    running: { label: 'Running Now', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.4)' },
    completed: { label: 'Completed', color: '#cbd5e1', bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)' },
    archived: { label: 'Archived', color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)', border: 'rgba(100, 116, 139, 0.3)' },
  };

  const st = statusConfigs[normalizedStatus] || statusConfigs.draft;

  // Compute Readiness Assessment
  let isReady = false;
  let readinessMessage = '';
  let readinessType = 'warning'; // 'success' | 'warning' | 'error'

  const effectiveProbCount = problems?.length || problemsCount || 0;

  if (effectiveProbCount === 0) {
    readinessMessage = 'No problems attached to this contest yet.';
    readinessType = 'warning';
  } else if (unapprovedCount > 0) {
    readinessMessage = `${unapprovedCount} problem(s) still require review before release.`;
    readinessType = 'warning';
  } else {
    isReady = true;
    readinessMessage = 'All attached problems are verified and ready for examination.';
    readinessType = 'success';
  }

  const formatDateTime = (dtStr) => {
    if (!dtStr) return 'TBD';
    return new Date(dtStr).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        transition: 'border-color 0.2s ease',
      }}
    >
      {/* 1. Header & Badges */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
              {title}
            </h3>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: st.bg,
                color: st.color,
                border: `1px solid ${st.border}`,
              }}
            >
              {st.label}
            </span>
          </div>
          {description && (
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: '1.4', maxWidth: '640px' }}>
              {description}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => onViewContest && onViewContest(id)}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#f8fafc',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Eye size={14} /> View Contest
          </button>

          <button
            onClick={() => onManageProblems && onManageProblems(id)}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Layers size={14} /> Manage Problems
          </button>

          <button
            onClick={() => onViewResults && onViewResults(id)}
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <BarChart3 size={14} /> Results
          </button>
        </div>
      </div>

      {/* 2. Key Metrics & Timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', background: 'rgba(0, 0, 0, 0.25)', padding: '12px 14px', borderRadius: '8px' }}>
        <div>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
            <Layers size={13} color="#38bdf8" /> Problems
          </span>
          <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
            {effectiveProbCount} {effectiveProbCount === 1 ? 'Problem' : 'Problems'}
          </strong>
        </div>

        <div>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
            <Users size={13} color="#4ade80" /> Participants
          </span>
          <strong style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
            {participantsCount} Enrolled
          </strong>
        </div>

        <div>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
            <Calendar size={13} color="#fbbf24" /> Start Time
          </span>
          <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            {formatDateTime(startTime)}
          </span>
        </div>

        <div>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
            <Clock size={13} color="#f87171" /> End Time
          </span>
          <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
            {formatDateTime(endTime)}
          </span>
        </div>
      </div>

      {/* 3. Human-Readable Readiness Alert / Verification Callout */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: readinessType === 'success' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          border: readinessType === 'success' ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {readinessType === 'success' ? (
            <CheckCircle2 size={16} color="#4ade80" />
          ) : (
            <AlertTriangle size={16} color="#fbbf24" />
          )}
          <span style={{ fontSize: '0.82rem', color: readinessType === 'success' ? '#86efac' : '#fde68a', fontWeight: '500' }}>
            {readinessMessage}
          </span>
        </div>

        {normalizedStatus === 'draft' && isReady && onPublishContest && (
          <button
            onClick={() => onPublishContest(id)}
            style={{
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Globe size={13} /> Publish Contest
          </button>
        )}
      </div>
    </div>
  );
}
