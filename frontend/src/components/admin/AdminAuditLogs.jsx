import React, { useState } from 'react';
import {
  FileText,
  Search,
  Filter,
  Shield,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Eye,
  Info,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Admin Security Audit Logs View (Phase 5.9.3 Integration)
 * Real-time immutable audit stream of all administrative, authorization, and lifecycle events.
 */
export default function AdminAuditLogs({
  logs = [],
  loading = false,
  actionFilter = 'all',
  onActionFilterChange,
}) {
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedLogForDetail, setSelectedLogForDetail] = useState(null);

  const filteredLogs = logs.filter((l) => {
    if (actionFilter !== 'all' && l.action !== actionFilter) return false;
    if (outcomeFilter !== 'all' && (l.outcome || '').toLowerCase() !== outcomeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchActor = (l.actorName || l.actor_name || '').toLowerCase().includes(q);
      const matchAction = (l.action || '').toLowerCase().includes(q);
      const matchResource = (l.resourceType || l.resource_type || '').toLowerCase().includes(q);
      if (!matchActor && !matchAction && !matchResource) return false;
    }
    return true;
  });

  const getOutcomeBadge = (outcome) => {
    const oc = (outcome || 'success').toLowerCase();
    if (oc === 'success') {
      return (
        <span style={{ fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80' }}>
          SUCCESS
        </span>
      );
    } else if (oc === 'denied') {
      return (
        <span style={{ fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
          DENIED
        </span>
      );
    }
    return (
      <span style={{ fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
        FAILURE
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header */}
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
          Security Audit Logs & Access Activity
        </h2>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
          Immutable audit trail for authorization changes, account state updates, and content publications.
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
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search by actor, action, or resource..."
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

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Action:</span>
            <select
              value={actionFilter}
              onChange={(e) => onActionFilterChange(e.target.value)}
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
              <option value="all">All Actions</option>
              <option value="ROLE_CHANGED">ROLE_CHANGED</option>
              <option value="ACCOUNT_STATUS_CHANGED">ACCOUNT_STATUS_CHANGED</option>
              <option value="USER_CREATED">USER_CREATED</option>
              <option value="USER_DEACTIVATED">USER_DEACTIVATED</option>
              <option value="PROBLEM_PUBLISHED">PROBLEM_PUBLISHED</option>
              <option value="PROBLEM_APPROVED">PROBLEM_APPROVED</option>
              <option value="ADMIN_ACTION_DENIED">ADMIN_ACTION_DENIED</option>
              <option value="PRIVILEGED_ACTION_DENIED">PRIVILEGED_ACTION_DENIED</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Result:</span>
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
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
              <option value="all">All Results</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failure">Failure</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Audit Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        {loading ? (
          <AuthoringLoadingState message="Loading security audit trail..." />
        ) : filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '0.9rem' }}>
            No audit records found matching the specified filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>Timestamp</th>
                  <th style={{ padding: '12px 14px' }}>Actor</th>
                  <th style={{ padding: '12px 14px' }}>Action</th>
                  <th style={{ padding: '12px 14px' }}>Outcome</th>
                  <th style={{ padding: '12px 14px' }}>Target Resource</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '14px', color: '#64748b', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                      {new Date(log.createdAt || log.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontWeight: '700', color: '#f8fafc', display: 'block' }}>
                        {log.actorName || log.actor_name || `User #${log.actorId || log.actor_id || 'System'}`}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#38bdf8', textTransform: 'uppercase' }}>
                        {log.actorRole || log.actor_role || 'system'}
                      </span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: '700', padding: '3px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      {getOutcomeBadge(log.outcome)}
                    </td>
                    <td style={{ padding: '14px', color: '#cbd5e1' }}>
                      <span style={{ textTransform: 'capitalize' }}>{log.resourceType || log.resource_type || 'system'}</span>
                      {(log.resourceId || log.resource_id) && ` #${log.resourceId || log.resource_id}`}
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <button
                          onClick={() => setSelectedLogForDetail(log)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#cbd5e1',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          Inspect JSON
                        </button>
                      ) : (
                        <span style={{ color: '#475569', fontSize: '0.75rem' }}>None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Metadata Inspection Modal */}
      {selectedLogForDetail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', fontWeight: '700' }}>
                Audit Log Event #{selectedLogForDetail.id}
              </h3>
              <button onClick={() => setSelectedLogForDetail(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '12px' }}>
              Action: <strong style={{ color: '#38bdf8' }}>{selectedLogForDetail.action}</strong> • Outcome: <strong style={{ color: '#4ade80' }}>{selectedLogForDetail.outcome}</strong>
            </div>

            <pre style={{ background: '#090d16', padding: '14px', borderRadius: '8px', color: '#86efac', fontFamily: 'monospace', fontSize: '0.82rem', overflowX: 'auto' }}>
              {JSON.stringify(selectedLogForDetail.metadata, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => setSelectedLogForDetail(null)}
                style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
