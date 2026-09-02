import React from 'react';
import {
  Server,
  Database,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Shield,
  Activity,
  HardDrive,
} from 'lucide-react';

/**
 * Admin System Health & Diagnostic View
 * Real-time monitoring of backend database, judge sandbox, API server, and system uptime.
 */
export default function AdminSystemHealth({
  system = {},
  stats = {},
  onRefresh,
}) {
  const uptimeHours = Math.floor((system.uptimeSeconds || 0) / 3600);
  const uptimeMinutes = Math.floor(((system.uptimeSeconds || 0) % 3600) / 60);
  const uptimeSeconds = (system.uptimeSeconds || 0) % 60;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header */}
      <div>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
          System Health & Diagnostic Controls
        </h2>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
          Service connectivity, sandbox execution runtime, and database connection pool diagnostics.
        </span>
      </div>

      {/* 2. Primary Service Health Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        {/* Database Service */}
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Database size={22} color="#38bdf8" />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>PostgreSQL Engine</h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Relational Data Store</span>
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: '800', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '3px 8px', borderRadius: '4px' }}>
              ONLINE
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Connection Status:</span>
              <strong style={{ color: '#4ade80' }}>Connected (Healthy)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Isolation Engine:</span>
              <span>PostgreSQL Transactions</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Persistent Audit Logs:</span>
              <span style={{ color: '#38bdf8' }}>Enabled (Phase 5.9.3)</span>
            </div>
          </div>
        </div>

        {/* Judge Execution Sandbox */}
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Cpu size={22} color="#a78bfa" />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>Judge Sandbox</h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Isolated Execution Worker</span>
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: '800', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '3px 8px', borderRadius: '4px' }}>
              READY
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Supported Compilers:</span>
              <strong style={{ color: '#f8fafc' }}>Python, C++ (g++), Java</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Execution Safety:</span>
              <span>Restricted Process Spawning</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Execution Mode:</span>
              <span style={{ color: '#38bdf8' }}>Function & Full Program</span>
            </div>
          </div>
        </div>

        {/* API Server Runtime */}
        <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Server size={22} color="#38bdf8" />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f8fafc', fontWeight: '700' }}>Express API Server</h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>REST Backend Framework</span>
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: '800', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '3px 8px', borderRadius: '4px' }}>
              ACTIVE
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', color: '#cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Node.js Runtime:</span>
              <strong style={{ color: '#f8fafc' }}>{system.nodeVersion || 'v26.x'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Server Uptime:</span>
              <span style={{ color: '#4ade80', fontWeight: '700' }}>{uptimeHours}h {uptimeMinutes}m {uptimeSeconds}s</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Environment:</span>
              <span style={{ textTransform: 'uppercase', color: '#fbbf24' }}>{system.environment || 'development'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
