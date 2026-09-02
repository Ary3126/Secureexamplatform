import React from 'react';
import { Layers, AlertTriangle, CheckCircle2, Trophy, Code2, Star, ShieldAlert } from 'lucide-react';

/**
 * Dependency & Usage Impact Card Component
 * Displays contest attachments, submission volume, and blocking guards before destructive actions.
 */
export default function DependencyImpactCard({
  dependencyData,
  loading = false,
}) {
  if (loading) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
        Analyzing problem dependencies and contest bindings...
      </div>
    );
  }

  if (!dependencyData) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
        No dependency data loaded.
      </div>
    );
  }

  const {
    impactLevel = 'NONE',
    canArchive = true,
    canUnpublish = true,
    blockingReasons = [],
    metrics = { totalContestsAttached: 0, activeContestsCount: 0, upcomingContestsCount: 0, totalSubmissions: 0, userBookmarksCount: 0 },
    contests = [],
  } = dependencyData;

  const impactConfigs = {
    HIGH: { color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)', label: 'High Impact' },
    MEDIUM: { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', label: 'Medium Impact' },
    LOW: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', label: 'Low Impact' },
    NONE: { color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)', label: 'Zero Impact' },
  };

  const imp = impactConfigs[impactLevel] || impactConfigs.NONE;

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={18} color="#a78bfa" />
          <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>
            Dependency & Usage Impact Analysis
          </h4>
        </div>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: '700',
            background: imp.bg,
            color: imp.color,
          }}
        >
          {imp.label}
        </span>
      </div>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
            <Trophy size={14} color="#38bdf8" /> Contests Attached
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#f8fafc' }}>
            {metrics.totalContestsAttached}
          </div>
          <span style={{ fontSize: '0.7rem', color: metrics.activeContestsCount > 0 ? '#f87171' : '#64748b' }}>
            {metrics.activeContestsCount} active, {metrics.upcomingContestsCount} upcoming
          </span>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
            <Code2 size={14} color="#4ade80" /> Submissions
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#f8fafc' }}>
            {metrics.totalSubmissions}
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Historical judge runs</span>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
            <Star size={14} color="#fbbf24" /> Saved Bookmarks
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#f8fafc' }}>
            {metrics.userBookmarksCount}
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Student saved lists</span>
        </div>
      </div>

      {/* Blocking Reasons Alert Box */}
      {blockingReasons && blockingReasons.length > 0 && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171', fontWeight: '700', fontSize: '0.82rem', marginBottom: '6px' }}>
            <ShieldAlert size={16} />
            <span>Destructive Actions Blocked ({blockingReasons.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {blockingReasons.map((r, idx) => (
              <div key={idx} style={{ fontSize: '0.78rem', color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <span>•</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contests List */}
      {contests && contests.length > 0 && (
        <div>
          <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '8px' }}>
            Attached Contests ({contests.length})
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
            {contests.map((c) => (
              <div
                key={c.contestId || c.id}
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.8rem',
                }}
              >
                <div>
                  <span style={{ fontWeight: '600', color: '#f8fafc' }}>{c.title}</span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '8px' }}>
                    Order: #{c.problemOrder || 1} ({c.points || 100} pts)
                  </span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'capitalize' }}>
                  {c.status || 'published'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
