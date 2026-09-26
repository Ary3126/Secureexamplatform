import React from 'react';
import { BookOpen, CheckCircle2 } from 'lucide-react';

export default function ProblemsPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">Problem Bank Governance</h2>
          <p className="admin-placeholder-desc">
            Central problem repository oversight, public problem bank publishing, and quality control.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <BookOpen size={28} />
        </div>
        <h3>Problem Repository & Editorial Governance</h3>
        <p>
          Administrative problem oversight, scope classification, and public repository management
          will be connected in Phase 4.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Public problem bank oversight</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Multi-version historical integrity</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Automated test coverage verification</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Cross-scope access management</span>
        </div>
      </div>
    </div>
  );
}
