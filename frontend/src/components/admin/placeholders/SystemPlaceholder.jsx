import React from 'react';
import { Server, CheckCircle2 } from 'lucide-react';

export default function SystemPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">System & Observability</h2>
          <p className="admin-placeholder-desc">
            Deep subsystem health diagnostics, latency percentiles, telemetry, and platform incidents.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <Server size={28} />
        </div>
        <h3>Platform Reliability, Probes & Incidents</h3>
        <p>
          Subsystem diagnostics (PostgreSQL, Judge Compilers, Storage), live API latency percentiles
          (p50, p95, p99), and incident status management will be integrated in Phase 7.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Subsystem health probes (DB, Judge, Memory)</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> API latency percentiles & route hotspots</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Append-only security audit log stream</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Live platform incident lifecycle tracking</span>
        </div>
      </div>
    </div>
  );
}
