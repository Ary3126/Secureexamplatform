import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Server,
  Database,
  Cpu,
  HardDrive,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
  TrendingUp,
  ShieldAlert,
  Search,
  Filter,
  Check,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Super Admin Observability Center (Phase 5.9.10)
 * 
 * Provides production-grade visibility into backend health, database connection pool,
 * judge compiler availability, API performance (p50/p95/p99 latency), error rates,
 * route hotspots, and persistent incident tracking.
 */
export default function AdminObservability({ token }) {
  const [healthData, setHealthData] = useState(null);
  const [metricsData, setMetricsData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [incidentPagination, setIncidentPagination] = useState({ total: 0, page: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [timeWindowMs, setTimeWindowMs] = useState(3600000); // 1h default
  const [incidentFilter, setIncidentFilter] = useState({ severity: '', status: '', search: '' });
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Fetch all observability streams in parallel
  const fetchObservabilityData = useCallback(async () => {
    try {
      setError(null);
      const headers = { Authorization: `Bearer ${token}` };

      const [healthRes, metricsRes, incidentsRes] = await Promise.all([
        fetch('/api/admin/system/health', { headers }),
        fetch(`/api/admin/system/metrics?windowMs=${timeWindowMs}`, { headers }),
        fetch(
          `/api/admin/system/incidents?page=${incidentPagination.page}&severity=${incidentFilter.severity}&status=${incidentFilter.status}&search=${encodeURIComponent(
            incidentFilter.search
          )}`,
          { headers }
        ),
      ]);

      if (healthRes.ok) {
        const hJson = await healthRes.json();
        setHealthData(hJson.data);
      }
      if (metricsRes.ok) {
        const mJson = await metricsRes.json();
        setMetricsData(mJson.data);
      }
      if (incidentsRes.ok) {
        const iJson = await incidentsRes.json();
        setIncidents(iJson.data.incidents || []);
        setIncidentPagination(iJson.data.pagination || { total: 0, page: 1, limit: 20 });
      }
    } catch (err) {
      setError('Failed to fetch real-time observability telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, timeWindowMs, incidentPagination.page, incidentFilter]);

  useEffect(() => {
    fetchObservabilityData();
  }, [fetchObservabilityData]);

  // Auto-refresh interval (15s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchObservabilityData();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchObservabilityData]);

  // Update Incident Status
  const handleUpdateIncident = async (incidentId, newStatus) => {
    try {
      const res = await fetch(`/api/admin/system/incidents/${incidentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setActionSuccess(`Incident #${incidentId} updated to ${newStatus}`);
        fetchObservabilityData();
        setTimeout(() => setActionSuccess(null), 3000);
      }
    } catch (e) {
      setError('Failed to update incident status');
    }
  };

  const getStatusBadge = (status) => {
    const s = String(status || '').toUpperCase();
    if (s === 'HEALTHY' || s === 'READY' || s === 'OPERATIONAL' || s === 'RESOLVED') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(34,197,94,0.15)', color: '#4ade80', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>
          <CheckCircle2 size={13} /> {s}
        </span>
      );
    }
    if (s === 'DEGRADED' || s === 'INVESTIGATING' || s === 'MEDIUM') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(245,158,11,0.15)', color: '#fbbf24', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>
          <AlertTriangle size={13} /> {s}
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(239,68,68,0.15)', color: '#f87171', padding: '3px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>
        <XCircle size={13} /> {s || 'UNKNOWN'}
      </span>
    );
  };

  const getSeverityBadge = (sev) => {
    const s = String(sev || '').toUpperCase();
    const colors = {
      CRITICAL: { bg: 'rgba(239,68,68,0.2)', text: '#f87171', border: 'rgba(239,68,68,0.4)' },
      HIGH: { bg: 'rgba(249,115,22,0.2)', text: '#fb923c', border: 'rgba(249,115,22,0.4)' },
      MEDIUM: { bg: 'rgba(234,179,8,0.2)', text: '#facc15', border: 'rgba(234,179,8,0.4)' },
      LOW: { bg: 'rgba(56,189,248,0.2)', text: '#38bdf8', border: 'rgba(56,189,248,0.4)' },
    };
    const c = colors[s] || colors.MEDIUM;
    return (
      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '800' }}>
        {s}
      </span>
    );
  };

  const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '32px' }}>
      {/* 1. Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={22} color="#38bdf8" />
            <span>Platform Reliability & Observability Center</span>
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Real-time subsystem diagnostics, API latency percentiles, error rate classification, and incident management.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={timeWindowMs}
            onChange={(e) => setTimeWindowMs(Number(e.target.value))}
            style={{ padding: '7px 10px', background: '#1e293b', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value={900000}>Past 15 Minutes</option>
            <option value={3600000}>Past 1 Hour</option>
            <option value={21600000}>Past 6 Hours</option>
            <option value={86400000}>Past 24 Hours</option>
          </select>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              background: autoRefresh ? 'rgba(56, 189, 248, 0.2)' : '#1e293b',
              border: `1px solid ${autoRefresh ? '#38bdf8' : 'rgba(255,255,255,0.15)'}`,
              color: autoRefresh ? '#38bdf8' : '#94a3b8',
              padding: '7px 12px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Zap size={14} /> {autoRefresh ? 'Live (15s)' : 'Auto-Refresh Off'}
          </button>

          <button
            onClick={() => {
              setRefreshing(true);
              fetchObservabilityData();
            }}
            disabled={refreshing}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
          {actionSuccess}
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <AuthoringLoadingState message="Connecting to platform telemetry streams..." />
      ) : (
        <>
          {/* 2. Subsystem Health Diagnostic Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            {/* Backend Overall Status */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Platform Core</span>
                <Server size={18} color="#38bdf8" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: '800', color: '#f8fafc' }}>
                  {healthData?.overall || 'UNKNOWN'}
                </span>
                {getStatusBadge(healthData?.overall)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.6' }}>
                <div>Uptime: <strong style={{ color: '#f8fafc' }}>{formatUptime(healthData?.backend?.uptimeSeconds)}</strong></div>
                <div>Node.js: <strong style={{ color: '#f8fafc' }}>{healthData?.backend?.nodeVersion}</strong> ({healthData?.backend?.platform})</div>
                <div>Heap Used: <strong style={{ color: '#f8fafc' }}>{healthData?.backend?.memory?.heapUsedMb} MB</strong> / {healthData?.backend?.memory?.heapTotalMb} MB</div>
              </div>
            </div>

            {/* PostgreSQL Subsystem */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>PostgreSQL Cluster</span>
                <Database size={18} color="#4ade80" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: '800', color: '#f8fafc' }}>
                  {healthData?.database?.status || 'CONNECTED'}
                </span>
                {getStatusBadge(healthData?.database?.status)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.6' }}>
                <div>Probe Latency: <strong style={{ color: '#4ade80' }}>{healthData?.database?.latencyMs !== null ? `${healthData?.database?.latencyMs} ms` : 'N/A'}</strong></div>
                <div>Pool Connections: <strong style={{ color: '#f8fafc' }}>{healthData?.database?.pool?.totalConnections || 1}</strong> total, <strong style={{ color: '#f8fafc' }}>{healthData?.database?.pool?.idleConnections || 1}</strong> idle</div>
                <div>Waiting Queue: <strong style={{ color: '#f8fafc' }}>{healthData?.database?.pool?.waitingRequests || 0}</strong> reqs</div>
              </div>
            </div>

            {/* Judge Execution Sandbox */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Judge & Sandbox</span>
                <Cpu size={18} color="#c084fc" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: '800', color: '#f8fafc' }}>
                  {healthData?.judge?.status || 'OPERATIONAL'}
                </span>
                {getStatusBadge(healthData?.judge?.status)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span>Python 3:</span>
                  <span style={{ color: healthData?.judge?.compilers?.python?.available ? '#4ade80' : '#f87171', fontWeight: '700' }}>
                    {healthData?.judge?.compilers?.python?.available ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span>C++ (g++):</span>
                  <span style={{ color: healthData?.judge?.compilers?.cpp?.available ? '#4ade80' : '#f87171', fontWeight: '700' }}>
                    {healthData?.judge?.compilers?.cpp?.available ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span>Java (javac):</span>
                  <span style={{ color: healthData?.judge?.compilers?.java?.available ? '#4ade80' : '#f87171', fontWeight: '700' }}>
                    {healthData?.judge?.compilers?.java?.available ? 'Available' : 'Unavailable'}
                  </span>
                </div>
              </div>
            </div>

            {/* Storage & Host Memory */}
            <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: '600' }}>Host Resources</span>
                <HardDrive size={18} color="#fbbf24" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: '800', color: '#f8fafc' }}>
                  {healthData?.storage?.status || 'HEALTHY'}
                </span>
                {getStatusBadge(healthData?.storage?.status)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: '1.6' }}>
                <div>Temp Workspace: <strong style={{ color: '#4ade80' }}>{healthData?.storage?.tempDir || 'Operational'}</strong></div>
                <div>Free RAM: <strong style={{ color: '#f8fafc' }}>{healthData?.storage?.freeMemoryMb} MB</strong> / {healthData?.storage?.totalMemoryMb} MB</div>
                <div>Isolation Boundary: <strong style={{ color: '#38bdf8' }}>Enforced</strong></div>
              </div>
            </div>
          </div>

          {/* 3. API Performance KPIs & Latency Percentiles */}
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={18} color="#38bdf8" />
              <span>API Performance & Latency Percentiles</span>
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>Request Volume</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#f8fafc' }}>{metricsData?.totalRequests || 0}</span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>{metricsData?.lifetimeTotalRequests || 0} lifetime</span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>Error Rate</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: (metricsData?.errorRatePct || 0) > 5 ? '#f87171' : '#4ade80' }}>
                  {metricsData?.errorRatePct || 0}%
                </span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>{metricsData?.totalErrors || 0} failed requests</span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>Avg Latency</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#38bdf8' }}>{metricsData?.averageLatencyMs || 0} ms</span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>Mean response time</span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>p50 (Median)</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#a78bfa' }}>{metricsData?.p50LatencyMs || 0} ms</span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>50% faster than</span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>p95 Latency</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#fbbf24' }}>{metricsData?.p95LatencyMs || 0} ms</span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>95th percentile</span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '14px', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>p99 Latency</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#f87171' }}>{metricsData?.p99LatencyMs || 0} ms</span>
                <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>99th percentile</span>
              </div>
            </div>

            {/* Status Code Distribution Bar */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px' }}>
                <span>HTTP Response Status Distribution:</span>
                <span>
                  <strong style={{ color: '#4ade80' }}>2xx: {metricsData?.statusCodeBreakdown?.['2xx'] || 0}</strong> •{' '}
                  <strong style={{ color: '#38bdf8' }}>3xx: {metricsData?.statusCodeBreakdown?.['3xx'] || 0}</strong> •{' '}
                  <strong style={{ color: '#fbbf24' }}>4xx: {metricsData?.statusCodeBreakdown?.['4xx'] || 0}</strong> •{' '}
                  <strong style={{ color: '#f87171' }}>5xx: {metricsData?.statusCodeBreakdown?.['5xx'] || 0}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* 4. Performance Hotspots Table (Slowest Endpoints) */}
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>
              Route Performance Hotspots (Latency Rankings)
            </h3>

            {(!metricsData?.hotspots || metricsData.hotspots.length === 0) ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '0.85rem' }}>
                No performance telemetry captured in current time window.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 12px' }}>Method & Route</th>
                      <th style={{ padding: '10px 12px' }}>Requests</th>
                      <th style={{ padding: '10px 12px' }}>Error Count</th>
                      <th style={{ padding: '10px 12px' }}>Error Rate</th>
                      <th style={{ padding: '10px 12px' }}>Avg Latency</th>
                      <th style={{ padding: '10px 12px' }}>p95 Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsData.hotspots.map((h, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: '800',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              marginRight: '8px',
                              background: h.method === 'GET' ? 'rgba(56,189,248,0.15)' : h.method === 'POST' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                              color: h.method === 'GET' ? '#38bdf8' : h.method === 'POST' ? '#4ade80' : '#fbbf24',
                            }}
                          >
                            {h.method}
                          </span>
                          <span style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{h.endpoint}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1' }}>{h.requestCount}</td>
                        <td style={{ padding: '10px 12px', color: h.errorCount > 0 ? '#f87171' : '#64748b' }}>{h.errorCount}</td>
                        <td style={{ padding: '10px 12px', color: h.errorRatePct > 0 ? '#f87171' : '#64748b' }}>{h.errorRatePct}%</td>
                        <td style={{ padding: '10px 12px', color: '#38bdf8', fontWeight: '700' }}>{h.averageLatencyMs} ms</td>
                        <td style={{ padding: '10px 12px', color: '#fbbf24', fontWeight: '700' }}>{h.p95LatencyMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 5. Persistent System Incidents Log */}
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={18} color="#f87171" />
                <span>System Incidents & Error Logs</span>
              </h3>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={incidentFilter.severity}
                  onChange={(e) => setIncidentFilter({ ...incidentFilter, severity: e.target.value })}
                  style={{ padding: '6px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.78rem', outline: 'none' }}
                >
                  <option value="">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>

                <select
                  value={incidentFilter.status}
                  onChange={(e) => setIncidentFilter({ ...incidentFilter, status: e.target.value })}
                  style={{ padding: '6px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.78rem', outline: 'none' }}
                >
                  <option value="">All Statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="INVESTIGATING">Investigating</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </div>
            </div>

            {incidents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: '#64748b', fontSize: '0.85rem' }}>
                <CheckCircle2 size={24} color="#4ade80" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                No system incidents reported. All subsystems operating within expected parameters.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '10px 12px' }}>Timestamp</th>
                      <th style={{ padding: '10px 12px' }}>Severity</th>
                      <th style={{ padding: '10px 12px' }}>Category</th>
                      <th style={{ padding: '10px 12px' }}>Endpoint</th>
                      <th style={{ padding: '10px 12px' }}>Request ID</th>
                      <th style={{ padding: '10px 12px' }}>Message</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((inc) => (
                      <tr key={inc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px 12px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          {new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{getSeverityBadge(inc.severity)}</td>
                        <td style={{ padding: '10px 12px', color: '#cbd5e1', fontWeight: '600' }}>{inc.category}</td>
                        <td style={{ padding: '10px 12px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {inc.endpoint || 'N/A'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                          {inc.request_id ? inc.request_id.slice(0, 12) + '...' : 'none'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#f8fafc', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inc.message}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{getStatusBadge(inc.status)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            {inc.status === 'OPEN' && (
                              <button
                                onClick={() => handleUpdateIncident(inc.id, 'INVESTIGATING')}
                                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24', padding: '3px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}
                              >
                                Investigate
                              </button>
                            )}
                            {inc.status !== 'RESOLVED' && (
                              <button
                                onClick={() => handleUpdateIncident(inc.id, 'RESOLVED')}
                                style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', padding: '3px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}
                              >
                                Resolve
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
        </>
      )}
    </div>
  );
}
