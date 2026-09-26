import React from 'react';
import { Users, CheckCircle2 } from 'lucide-react';

export default function UsersPlaceholder() {
  return (
    <div className="admin-placeholder-container">
      <div className="admin-placeholder-header">
        <div>
          <h2 className="admin-placeholder-title">Users & Role Management</h2>
          <p className="admin-placeholder-desc">
            User directory, role assignment, account activation, and identity governance.
          </p>
        </div>
        <span className="admin-phase-badge">Phase 1 Foundation</span>
      </div>

      <div className="admin-placeholder-card">
        <div className="admin-placeholder-icon-wrap">
          <Users size={28} />
        </div>
        <h3>User Administration & Access Governance</h3>
        <p>
          Full user management with searchable directories, role promotion guards,
          and suspension controls will be integrated in Phase 3.
        </p>
        <div className="admin-spec-list">
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Paginated user directory</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Role elevation (student &rarr; professor &rarr; super_admin)</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Self-lockout prevention invariants</span>
          <span className="admin-spec-item"><CheckCircle2 size={13} color="#38bdf8" /> Immediate account deactivation</span>
        </div>
      </div>
    </div>
  );
}
