import React from 'react';
import {
  Users,
  Trophy,
  BookOpen,
  Inbox,
  Activity,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  UserCheck,
  UserX,
  Plus,
  RefreshCw,
  Server,
  Database,
  Cpu,
} from 'lucide-react';

/**
 * Admin Dashboard Overview View
 * Operational summary of entire platform: User distribution, contest health,
 * problem bank statistics, review backlog, live security stream, and system status.
 */
export default function AdminDashboardView({
  stats,
  loading,
  onRefresh,
  onNavigateTab,
  onOpenCreateUser,
}) {
  const {
    users = {},
    contests = {},
    problems = {},
    reviews = {},
    recentActivity = [],
    system = {},
  } = stats || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 1. Header & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.4rem', color: '#f8fafc', fontWeight: '800' }}>
            Platform Operations Overview
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Real-time platform metrics, governance queues, security activity, and service health.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#cbd5e1',
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Metrics</span>
          </button>

          <button
            onClick={onOpenCreateUser}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '7px 16px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Plus size={15} />
            <span>Provision User</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        {/* Total Users Card */}
        <div
          onClick={() => onNavigateTab('users')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Platform Users</span>
            <Users size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: '800', color: '#f8fafc', marginBottom: '4px' }}>
            {users.total_users || 0}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {users.total_students || 0} Students • {users.total_professors || 0} Professors • {users.total_admins || 0} Admins
          </div>
        </div>

        {/* Platform Contests Card */}
        <div
          onClick={() => onNavigateTab('contests')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Examinations</span>
            <Trophy size={18} color="#fbbf24" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: '800', color: '#f8fafc', marginBottom: '4px' }}>
            {contests.total_contests || 0}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#4ade80' }}>
            {contests.active_contests || 0} Published / Active • {contests.draft_contests || 0} Draft
          </div>
        </div>

        {/* Problem Bank Governance Card */}
        <div
          onClick={() => onNavigateTab('problems')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(74, 222, 128, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Problem Bank</span>
            <BookOpen size={18} color="#4ade80" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: '800', color: '#f8fafc', marginBottom: '4px' }}>
            {problems.total_problems || 0}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {problems.published_problems || 0} Published • {problems.approved_problems || 0} Approved • {problems.draft_problems || 0} Draft
          </div>
        </div>

        {/* Review Queue SLA Card */}
        <div
          onClick={() => onNavigateTab('reviews')}
          style={{
            background: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(192, 132, 252, 0.4)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Review Governance</span>
            <Inbox size={18} color="#c084fc" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: '800', color: '#c084fc', marginBottom: '4px' }}>
            {reviews.total_queue || 0}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {reviews.pending_reviews || 0} Pending • {reviews.in_review_reviews || 0} In Progress
          </div>
        </div>
      </div>

      {/* 3. System Health Bar */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={16} color="#4ade80" />
            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#f8fafc' }}>System Status: Operational</span>
          </div>
          <span style={{ color: '#475569' }}>•</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#94a3b8' }}>
            <Database size={14} color="#38bdf8" />
            <span>PostgreSQL: Connected</span>
          </div>
          <span style={{ color: '#475569' }}>•</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#94a3b8' }}>
            <Cpu size={14} color="#a78bfa" />
            <span>Judge Sandbox: Ready</span>
          </div>
        </div>

        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
          Uptime: {Math.floor((system.uptimeSeconds || 0) / 3600)}h {Math.floor(((system.uptimeSeconds || 0) % 3600) / 60)}m • Node {system.nodeVersion || 'v26.x'}
        </div>
      </div>

      {/* 4. Two-Column Operations View: Recent Activity & Quick Action Shortcuts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
        {/* Left: Recent Security & Administrative Activity */}
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} color="#38bdf8" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>
                Recent Security & System Stream
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab('audit')}
              style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>Full Audit Logs</span>
              <ArrowRight size={13} />
            </button>
          </div>

          {recentActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px', color: '#64748b', fontSize: '0.85rem' }}>
              No recent audit events recorded.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentActivity.slice(0, 7).map((act) => (
                <div
                  key={act.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: act.outcome === 'success' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: act.outcome === 'success' ? '#38bdf8' : '#f87171',
                      }}
                    >
                      {act.action}
                    </span>
                    <span style={{ color: '#cbd5e1', fontWeight: '500' }}>
                      {act.actor_name || 'System'} ({act.actor_role || 'system'})
                    </span>
                  </div>

                  <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
                    {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Quick Governance Action Shortcuts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1rem', color: '#f8fafc', fontWeight: '700' }}>
              Administrative Actions
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => onNavigateTab('users')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={15} color="#38bdf8" />
                  <span>User Directory & Roles</span>
                </div>
                <ArrowRight size={14} color="#64748b" />
              </button>

              <button
                onClick={() => onNavigateTab('contests')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Trophy size={15} color="#fbbf24" />
                  <span>All Platform Contests</span>
                </div>
                <ArrowRight size={14} color="#64748b" />
              </button>

              <button
                onClick={() => onNavigateTab('problems')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={15} color="#4ade80" />
                  <span>Problem Bank Governance</span>
                </div>
                <ArrowRight size={14} color="#64748b" />
              </button>

              <button
                onClick={() => onNavigateTab('reviews')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Inbox size={15} color="#c084fc" />
                  <span>Review SLA & Turnaround</span>
                </div>
                <ArrowRight size={14} color="#64748b" />
              </button>

              <button
                onClick={() => onNavigateTab('audit')}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={15} color="#f87171" />
                  <span>Security Audit Stream</span>
                </div>
                <ArrowRight size={14} color="#64748b" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
