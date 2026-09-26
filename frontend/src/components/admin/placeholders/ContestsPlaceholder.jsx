import React from 'react';
import { Trophy, CheckCircle2 } from 'lucide-react';

export default function ContestsPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">Contest & Examination Management</h2>
          <p className="admin-placeholder-desc">
            Platform examination scheduling, participation governance, and live leaderboard oversight.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <Trophy size={28} />
        </div>
        <h3>Contest Governance & Live Exam Supervision</h3>
        <p>
          Exam scheduling, state progression (draft &rarr; published &rarr; archived), and anti-cheat
          monitoring will be unified in Phase 5.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Contest lifecycle control</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Instant publish & archive actions</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Leaderboard freeze supervision</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Concurrency and participant tracking</span>
        </div>
      </div>
    </div>
  );
}
