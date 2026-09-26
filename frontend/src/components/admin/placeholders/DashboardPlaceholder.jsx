import React from 'react';
import { LayoutDashboard, CheckCircle2 } from 'lucide-react';

export default function DashboardPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">Platform Dashboard</h2>
          <p className="admin-placeholder-desc">
            Centralized platform overview, operational health, and system-level telemetry.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <LayoutDashboard size={28} />
        </div>
        <h3>Admin Overview & Dashboard</h3>
        <p>
          This section will provide consolidated platform metrics, active examination telemetry,
          and security audit feeds in the upcoming Phase 2.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Real-time active participant counters</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Live exam concurrency meters</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Recent administrative audit events</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> High-severity system alerts</span>
        </div>
      </div>
    </div>
  );
}
