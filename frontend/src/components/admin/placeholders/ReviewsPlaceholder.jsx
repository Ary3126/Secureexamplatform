import React from 'react';
import { Inbox, CheckCircle2 } from 'lucide-react';

export default function ReviewsPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">Problem Review Governance</h2>
          <p className="admin-placeholder-desc">
            Peer review queue supervision, editorial SLA health, and turnaround analytics.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <Inbox size={28} />
        </div>
        <h3>Review Queue Oversight & Editorial SLAs</h3>
        <p>
          Platform-wide review queue monitoring, SLA tracking badges (ON TIME, AT RISK, OVERDUE),
          and reviewer turnaround metrics will be integrated in Phase 6.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Global review backlog monitoring</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> 24h/48h turnaround SLA indicators</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Reviewer assignment & workload balancing</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Editorial audit compliance</span>
        </div>
      </div>
    </div>
  );
}
