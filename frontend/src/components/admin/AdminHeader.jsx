import React from 'react';
import { Menu, Shield, LogOut, ExternalLink } from 'lucide-react';
import { ADMIN_SECTION_LABELS } from '../../config/adminNavConfig';

export default function AdminHeader({
  activeSection = 'dashboard',
  currentUser = null,
  onLogout = () => {},
  onToggleMobile = () => {},
  onExitToPlatform = () => {},
}) {
  const currentTitle = ADMIN_SECTION_LABELS[activeSection] || 'Platform Governance';

  return (
    <header className="admin-header">
      <div className="admin-header-left">
        <button
          type="button"
          className="admin-mobile-toggle"
          onClick={onToggleMobile}
          aria-label="Toggle navigation menu"
        >
          <Menu size={18} />
        </button>

        <div className="admin-breadcrumbs">
          <span className="admin-breadcrumb-root">Admin Console</span>
          <span className="admin-breadcrumb-sep">/</span>
          <span className="admin-breadcrumb-current">{currentTitle}</span>
        </div>
      </div>

      <div className="admin-header-right">
        {currentUser && (
          <div className="admin-header-role-badge">
            <Shield size={12} />
            <span>{currentUser.role || 'SUPER_ADMIN'}</span>
          </div>
        )}

        <button
          type="button"
          className="admin-header-logout-btn"
          onClick={onExitToPlatform}
          title="Return to Student Platform"
        >
          <ExternalLink size={14} />
          <span>Exit</span>
        </button>

        <button
          type="button"
          className="admin-header-logout-btn"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut size={14} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
