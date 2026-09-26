import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  UserCheck,
  TrendingUp,
  BarChart3,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import StatusBadge from '../authoring/StatusBadge';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Admin Review Governance & SLA Oversight View (Phase 5.9.6 & 5.9.7)
 * Central review queue, SLA tracking badges (ON TIME, AT RISK, OVERDUE),
 * and platform-wide turnaround performance analytics.
 */
export default function AdminReviewGovernance({
  token,
  reviews = [],
  loading = false,
  onInspectReview,
}) {
  const [analytics, setAnalytics] = useState(null);
  const [reviewers, setReviewers] = useState([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    async function loadAnalytics() {
      try {
        setLoadingAnalytics(true);
        const [aRes, rRes] = await Promise.all([
          fetch('/api/admin/problem-review-analytics', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/admin/reviewer-analytics', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (aRes.ok) {
          const aData = await aRes.json();
          setAnalytics(aData.analytics || aData.data || aData);
        }
        if (rRes.ok) {
          const rData = await rRes.json();
          setReviewers(rData.reviewers || rData.data || []);
        }
      } catch (err) {
        console.error('Failed to load review analytics:', err);
      } finally {
        setLoadingAnalytics(false);
      }
    }
    if (token) loadAnalytics();
  }, [token]);

  // Compute SLA status for a review item
  const getSlaBadge = (createdAt) => {
    if (!createdAt) return { label: 'ON TIME', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)' };
    const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 3600);
    if (ageHours > 48) {
      return { label: 'OVERDUE (>48h)', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' };
    } else if (ageHours > 24) {
      return { label: 'AT RISK (24-48h)', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)' };
    }
    return { label: 'ON TIME (<24h)', color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)' };
  };

  const slaOverdueCount = reviews.filter((r) => {
    if (!r.created_at && !r.createdAt) return false;
    const age = (Date.now() - new Date(r.created_at || r.createdAt).getTime()) / (1000 * 3600);
    return age > 48;
  }).length;

  const slaAtRiskCount = reviews.filter((r) => {
    if (!r.created_at && !r.createdAt) return false;
    const age = (Date.now() - new Date(r.created_at || r.createdAt).getTime()) / (1000 * 3600);
    return age > 24 && age <= 48;
  }).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '32px' }}>
      {/* 1. Header */}
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
          Problem Review Governance & Turnaround SLA
        </h2>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
          Platform-wide review queue, turnaround performance, and reviewer workload distribution.
        </span>
      </div>

      {/* 2. SLA Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '16px 18px' }}>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Total In Backlog</span>
          <span style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f8fafc' }}>{reviews.length}</span>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '12px', padding: '16px 18px' }}>
          <span style={{ fontSize: '0.78rem', color: '#86efac', display: 'block', marginBottom: '4px' }}>On Time (&lt;24h)</span>
          <span style={{ fontSize: '1.8rem', fontWeight: '800', color: '#4ade80' }}>
            {reviews.length - slaAtRiskCount - slaOverdueCount}
          </span>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '12px', padding: '16px 18px' }}>
          <span style={{ fontSize: '0.78rem', color: '#fde68a', display: 'block', marginBottom: '4px' }}>At Risk (24-48h)</span>
          <span style={{ fontSize: '1.8rem', fontWeight: '800', color: '#fbbf24' }}>{slaAtRiskCount}</span>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', padding: '16px 18px' }}>
          <span style={{ fontSize: '0.78rem', color: '#fca5a5', display: 'block', marginBottom: '4px' }}>Overdue (&gt;48h)</span>
          <span style={{ fontSize: '1.8rem', fontWeight: '800', color: '#f87171' }}>{slaOverdueCount}</span>
        </div>
      </div>

      {/* 3. Review Queue Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>
          Platform Review Queue
        </h3>

        {loading ? (
          <AuthoringLoadingState message="Loading platform review queue..." />
        ) : reviews.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px', color: '#64748b', fontSize: '0.85rem' }}>
            No problem reviews currently waiting in the backlog.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>Problem</th>
                  <th style={{ padding: '12px 14px' }}>Author</th>
                  <th style={{ padding: '12px 14px' }}>Assigned Reviewer</th>
                  <th style={{ padding: '12px 14px' }}>Review Status</th>
                  <th style={{ padding: '12px 14px' }}>SLA Health</th>
                  <th style={{ padding: '12px 14px' }}>Submitted Date</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((item) => {
                  const sla = getSlaBadge(item.createdAt || item.created_at);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '14px' }}>
                        <span style={{ fontWeight: '700', color: '#f8fafc', display: 'block' }}>
                          {item.problemTitle || `Problem #${item.problemId || item.problem_id}`}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>v{item.problemVersion || item.problem_version || 1}</span>
                      </td>
                      <td style={{ padding: '14px', color: '#cbd5e1' }}>
                        {item.authorName || `Professor #${item.submittedBy || item.submitted_by}`}
                      </td>
                      <td style={{ padding: '14px', color: '#94a3b8' }}>
                        {item.reviewerName || (item.reviewerId || item.reviewer_id ? `Reviewer #${item.reviewerId || item.reviewer_id}` : 'Unassigned')}
                      </td>
                      <td style={{ padding: '14px' }}>
                        <StatusBadge status={item.status} size="sm" />
                      </td>
                      <td style={{ padding: '14px' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: '800',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: sla.bg,
                            color: sla.color,
                          }}
                        >
                          {sla.label}
                        </span>
                      </td>
                      <td style={{ padding: '14px', color: '#64748b', fontSize: '0.78rem' }}>
                        {new Date(item.createdAt || item.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>
                        <button
                          onClick={() => onInspectReview && onInspectReview(item.problemId || item.problem_id)}
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
                          Open Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Platform Review Turnaround Performance (Phase 5.9.7) */}
      {analytics && (
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={18} color="#38bdf8" />
            <span>Turnaround & Decision Analytics</span>
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', background: 'rgba(0, 0, 0, 0.25)', padding: '16px', borderRadius: '8px' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Total Reviews Decided</span>
              <strong style={{ fontSize: '1.2rem', color: '#f8fafc' }}>
                {analytics.totalDecisions || analytics.totalDecided || 0}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Approval Rate</span>
              <strong style={{ fontSize: '1.2rem', color: '#4ade80' }}>
                {analytics.approvalRate ? `${analytics.approvalRate}%` : 'N/A'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Average Turnaround</span>
              <strong style={{ fontSize: '1.2rem', color: '#38bdf8' }}>
                {analytics.avgTurnaroundHours ? `${analytics.avgTurnaroundHours} hours` : '< 24 hours'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Median Turnaround</span>
              <strong style={{ fontSize: '1.2rem', color: '#c084fc' }}>
                {analytics.medianTurnaroundHours ? `${analytics.medianTurnaroundHours} hours` : '< 12 hours'}
              </strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
