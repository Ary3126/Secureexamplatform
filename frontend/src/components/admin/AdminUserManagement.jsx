import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Plus,
  Filter,
  UserCheck,
  UserX,
  Shield,
  Clock,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Eye,
  Info,
  CheckCircle,
  Building,
  Award,
  Calendar,
  Lock,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import './adminUserManagement.css';

/**
 * Admin User & Role Management Component (Phase 7.3)
 * Full platform user governance console supporting:
 * - Real-time directory search & server-side pagination
 * - Role filtering (Student, Professor, Contest Admin, Super Admin)
 * - Status filtering (Active, Suspended)
 * - User Details inspection modal (zero-credential leakage)
 * - Account suspension & activation with confirmation UX
 * - Role escalation & demotion with confirmation UX and self-lockout safeguards
 * - Administrative user provisioning
 */
export default function AdminUserManagement({
  users = [],
  totalUsers = 0,
  page = 1,
  limit = 20,
  search = '',
  roleFilter = 'all',
  statusFilter = 'all',
  loading = false,
  currentUser,
  onSearchChange,
  onRoleFilterChange,
  onStatusFilterChange,
  onPageChange,
  onCreateUser,
  onUpdateUserRole,
  onToggleUserStatus,
  onFetchUserDetails,
  isProcessing = false,
}) {
  // Modal states
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [roleChangeModalOpen, setRoleChangeModalOpen] = useState(false);
  const [statusConfirmModalOpen, setStatusConfirmModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  // Selected entities for modals
  const [selectedUserForRole, setSelectedUserForRole] = useState(null);
  const [selectedUserForStatus, setSelectedUserForStatus] = useState(null);
  const [selectedUserForDetails, setSelectedUserForDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Form states
  const [targetRole, setTargetRole] = useState('student');
  const [newUserData, setNewUserData] = useState({
    username: '',
    fullName: '',
    email: '',
    password: '',
    role: 'professor',
    institution: '',
  });

  // UI feedback notifications
  const [bannerFeedback, setBannerFeedback] = useState(null);
  const [modalError, setModalError] = useState('');

  // Auto-dismiss banner after 5 seconds
  useEffect(() => {
    if (bannerFeedback) {
      const timer = setTimeout(() => {
        setBannerFeedback(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [bannerFeedback]);

  const totalPages = Math.max(Math.ceil(totalUsers / limit) || 1, 1);

  // --- Handlers for User Details Modal ---
  const handleOpenDetailsModal = async (user) => {
    setSelectedUserForDetails(user);
    setDetailsModalOpen(true);
    if (onFetchUserDetails && user.id) {
      setDetailsLoading(true);
      try {
        const fullDetails = await onFetchUserDetails(user.id);
        if (fullDetails) {
          setSelectedUserForDetails(fullDetails);
        }
      } catch (e) {
        console.error('Failed to load user details:', e);
      } finally {
        setDetailsLoading(false);
      }
    }
  };

  // --- Handlers for Role Modal ---
  const handleOpenRoleModal = (user) => {
    setSelectedUserForRole(user);
    setTargetRole(user.role || 'student');
    setModalError('');
    setRoleChangeModalOpen(true);
  };

  const handleConfirmRoleChange = async () => {
    if (!selectedUserForRole) return;
    setModalError('');
    try {
      const result = await onUpdateUserRole(selectedUserForRole.id, targetRole);
      if (result && result.success === false) {
        setModalError(result.message || 'Failed to update user role');
        return;
      }
      setRoleChangeModalOpen(false);
      setBannerFeedback({
        type: 'success',
        message: `Role for "${selectedUserForRole.username}" updated to ${targetRole}.`,
      });
    } catch (err) {
      setModalError(err.message || 'Error occurred while updating role');
    }
  };

  // --- Handlers for Status Confirmation Modal ---
  const handleOpenStatusModal = (user) => {
    setSelectedUserForStatus(user);
    setModalError('');
    setStatusConfirmModalOpen(true);
  };

  const handleConfirmStatusToggle = async () => {
    if (!selectedUserForStatus) return;
    setModalError('');
    const currentlyActive = Boolean(
      selectedUserForStatus.isActive ??
      selectedUserForStatus.is_active ??
      selectedUserForStatus.status === 'active'
    );
    const newIsActive = !currentlyActive;
    try {
      const result = await onToggleUserStatus(selectedUserForStatus.id, currentlyActive);
      if (result && result.success === false) {
        setModalError(result.message || 'Failed to update account status');
        return;
      }
      setStatusConfirmModalOpen(false);
      setBannerFeedback({
        type: 'success',
        message: `Account "${selectedUserForStatus.username}" has been ${newIsActive ? 'activated' : 'suspended'}.`,
      });
    } catch (err) {
      setModalError(err.message || 'Error occurred while updating status');
    }
  };

  // --- Handlers for Provision User Modal ---
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setModalError('');
    try {
      const payload = {
        ...newUserData,
        fullName: newUserData.fullName.trim() || newUserData.username.trim(),
      };
      const result = await onCreateUser(payload);
      if (result && result.success === false) {
        setModalError(result.message || 'Failed to provision user');
        return;
      }
      setCreateUserModalOpen(false);
      setNewUserData({ username: '', fullName: '', email: '', password: '', role: 'professor', institution: '' });
      setBannerFeedback({
        type: 'success',
        message: `New platform user "${payload.username}" provisioned successfully.`,
      });
    } catch (err) {
      setModalError(err.message || 'Error occurred while provisioning user');
    }
  };

  const hasActiveFilters = search.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all';

  const handleResetFilters = () => {
    onSearchChange('');
    onRoleFilterChange('all');
    onStatusFilterChange('all');
  };

  return (
    <div className="admin-users-container" data-testid="admin-user-management">
      {/* 1. Header & Summary Bar */}
      <div className="admin-users-header">
        <div className="admin-users-title-wrap">
          <h2>User & Role Management</h2>
          <span className="admin-users-subtitle">
            Search, filter, inspect details, assign roles, and manage platform account statuses.
          </span>
        </div>

        <div className="admin-users-actions">
          <button
            className="btn-primary"
            onClick={() => {
              setModalError('');
              setCreateUserModalOpen(true);
            }}
            data-testid="provision-user-btn"
          >
            <Plus size={16} /> Provision User
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerFeedback && (
        <div className={`admin-feedback-banner ${bannerFeedback.type}`} data-testid="admin-feedback-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {bannerFeedback.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span>{bannerFeedback.message}</span>
          </div>
          <button
            onClick={() => setBannerFeedback(null)}
            style={{ background: 'transparent', border: 'none', color: 'currentColor', cursor: 'pointer' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 2. Filter Toolbar */}
      <div className="admin-users-toolbar">
        <div className="search-field-wrap">
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search by username, full name, or email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="user-search-input"
          />
          {search && (
            <button
              className="search-clear-btn"
              onClick={() => onSearchChange('')}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="filter-dropdowns-group">
          <div className="filter-select-wrap">
            <span className="filter-select-label">Role:</span>
            <select
              className="filter-select"
              value={roleFilter}
              onChange={(e) => onRoleFilterChange(e.target.value)}
              data-testid="role-filter-select"
            >
              <option value="all">All Roles</option>
              <option value="student">Student</option>
              <option value="professor">Professor</option>
              <option value="contest_admin">Contest Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>

          <div className="filter-select-wrap">
            <span className="filter-select-label">Status:</span>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              data-testid="status-filter-select"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Suspended Only</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              className="btn-secondary"
              onClick={handleResetFilters}
              title="Reset all filters"
              data-testid="reset-filters-btn"
              style={{ padding: '6px 12px', fontSize: '0.78rem' }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* 3. Users Table Card */}
      <div className="admin-users-card">
        {loading ? (
          <AuthoringLoadingState message="Loading platform users directory..." />
        ) : users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
            <Users size={36} style={{ margin: '0 auto 12px auto', opacity: 0.4, display: 'block' }} />
            <h4 style={{ margin: '0 0 6px 0', color: '#cbd5e1', fontSize: '1rem', fontWeight: 600 }}>
              No Users Found
            </h4>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              {hasActiveFilters
                ? 'No platform users match your current search and filter criteria.'
                : 'No users currently registered in the database.'}
            </p>
            {hasActiveFilters && (
              <button
                className="btn-secondary"
                onClick={handleResetFilters}
                style={{ marginTop: '14px', fontSize: '0.8rem' }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="table-responsive-container">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>User Identity</th>
                  <th>Platform Role</th>
                  <th>Account Status</th>
                  <th>Rating</th>
                  <th>Registered</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isActive = Boolean(u.isActive ?? u.is_active ?? u.status === 'active');
                  const isCurrent = currentUser && (currentUser.id === u.id || currentUser.username === u.username);
                  const initials = (u.fullName || u.full_name || u.username || 'U')
                    .substring(0, 2)
                    .toUpperCase();

                  return (
                    <tr key={u.id} data-testid={`user-row-${u.id}`}>
                      {/* Identity */}
                      <td>
                        <div className="user-identity-cell">
                          <div className="user-avatar-initials">{initials}</div>
                          <div className="user-names-wrap">
                            <span className="user-primary-name">
                              {u.username}
                              {isCurrent && (
                                <span style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
                                  You
                                </span>
                              )}
                            </span>
                            <span className="user-secondary-email">
                              {u.fullName || u.full_name ? `${u.fullName || u.full_name} • ` : ''}
                              {u.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td>
                        <span className={`badge-role ${u.role}`} data-testid={`role-badge-${u.id}`}>
                          <Shield size={12} />
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`badge-status ${isActive ? 'active' : 'suspended'}`} data-testid={`status-badge-${u.id}`}>
                          <span className="status-dot" />
                          {isActive ? 'Active' : 'Suspended'}
                        </span>
                      </td>

                      {/* Rating */}
                      <td>
                        <span style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>
                          {u.currentRating || u.current_rating || 1200}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: '4px' }}>
                          ({u.ratingStatus || u.rating_status || 'provisional'})
                        </span>
                      </td>

                      {/* Registered Date */}
                      <td style={{ color: '#64748b', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {new Date(u.createdAt || u.created_at || Date.now()).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="action-buttons-group">
                          {/* View Details */}
                          <button
                            className="btn-table-action"
                            onClick={() => handleOpenDetailsModal(u)}
                            title="View Full User Details"
                            data-testid={`view-user-btn-${u.id}`}
                          >
                            <Eye size={13} /> Details
                          </button>

                          {/* Change Role */}
                          <button
                            className="btn-table-action role"
                            onClick={() => handleOpenRoleModal(u)}
                            title="Modify User Role"
                            data-testid={`change-role-btn-${u.id}`}
                          >
                            <Shield size={13} /> Role
                          </button>

                          {/* Suspend / Activate */}
                          <button
                            className={`btn-table-action ${isActive ? 'suspend' : 'activate'}`}
                            onClick={() => handleOpenStatusModal(u)}
                            disabled={isProcessing || isCurrent}
                            title={isCurrent ? 'Cannot suspend your own active account' : isActive ? 'Suspend Account' : 'Activate Account'}
                            data-testid={`toggle-status-btn-${u.id}`}
                          >
                            {isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                            {isActive ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. Scalable Pagination Bar */}
        {totalUsers > 0 && (
          <div className="admin-pagination-bar" data-testid="admin-pagination-bar">
            <span className="pagination-info">
              Showing {users.length > 0 ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, totalUsers)} of {totalUsers} total users
            </span>

            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                data-testid="pagination-prev-btn"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span className="pagination-current">
                Page {page} of {totalPages}
              </span>

              <button
                className="pagination-btn"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                data-testid="pagination-next-btn"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. User Details Modal */}
      {detailsModalOpen && selectedUserForDetails && (
        <div className="admin-modal-backdrop" data-testid="user-details-modal">
          <div className="admin-modal-dialog" style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <h3>
                <Info size={18} style={{ color: '#38bdf8' }} /> User Account Profile
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setDetailsModalOpen(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {detailsLoading ? (
                <AuthoringLoadingState message="Loading comprehensive user profile..." />
              ) : (
                <>
                  <div className="user-detail-profile-header">
                    <div className="user-detail-avatar-large">
                      {(selectedUserForDetails.fullName || selectedUserForDetails.full_name || selectedUserForDetails.username || 'U')
                        .substring(0, 2)
                        .toUpperCase()}
                    </div>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0', fontSize: '1.15rem', color: '#f8fafc', fontWeight: 700 }}>
                        {selectedUserForDetails.fullName || selectedUserForDetails.full_name || selectedUserForDetails.username}
                      </h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                          @{selectedUserForDetails.username}
                        </span>
                        <span className={`badge-role ${selectedUserForDetails.role}`}>
                          {selectedUserForDetails.role}
                        </span>
                        <span
                          className={`badge-status ${
                            (selectedUserForDetails.isActive ?? selectedUserForDetails.is_active ?? selectedUserForDetails.status === 'active')
                              ? 'active'
                              : 'suspended'
                          }`}
                        >
                          {(selectedUserForDetails.isActive ?? selectedUserForDetails.is_active ?? selectedUserForDetails.status === 'active')
                            ? 'Active'
                            : 'Suspended'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="user-detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">User ID</span>
                      <span className="detail-value">#{selectedUserForDetails.id}</span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Email Address</span>
                      <span className="detail-value">{selectedUserForDetails.email}</span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Institution / University</span>
                      <span className="detail-value">
                        {selectedUserForDetails.institution || 'None specified'}
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Rating & Tier</span>
                      <span className="detail-value">
                        {selectedUserForDetails.currentRating || selectedUserForDetails.current_rating || 1200} Elo
                        {' '}({selectedUserForDetails.ratingStatus || selectedUserForDetails.rating_status || 'provisional'})
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Highest Rating</span>
                      <span className="detail-value">
                        {selectedUserForDetails.highestRating || selectedUserForDetails.highest_rating || 1200} Elo
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Rated Contests Participated</span>
                      <span className="detail-value">
                        {selectedUserForDetails.ratedContestCount || selectedUserForDetails.rated_contest_count || 0}
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Registration Date</span>
                      <span className="detail-value">
                        {new Date(selectedUserForDetails.createdAt || selectedUserForDetails.created_at || Date.now()).toLocaleString()}
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Last Record Update</span>
                      <span className="detail-value">
                        {new Date(selectedUserForDetails.updatedAt || selectedUserForDetails.updated_at || Date.now()).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {selectedUserForDetails.bio && (
                    <div style={{ marginTop: '12px' }}>
                      <span className="detail-label">Biography</span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '6px' }}>
                        {selectedUserForDetails.bio}
                      </p>
                    </div>
                  )}

                  <div className="security-credential-banner">
                    <Lock size={15} style={{ flexShrink: 0 }} />
                    <span>
                      Zero Credential Leakage: Passwords, password hashes, session tokens, and security secrets are strictly omitted from client responses.
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setDetailsModalOpen(false)}
                data-testid="close-user-details-btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Status Toggle Confirmation Modal (Phase 7.3 Section 15 Confirmation UX) */}
      {statusConfirmModalOpen && selectedUserForStatus && (
        <div className="admin-modal-backdrop" data-testid="status-confirm-modal">
          <div className="admin-modal-dialog">
            <div className="modal-header">
              <h3>
                <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
                Confirm Account Status Change
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setStatusConfirmModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {modalError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '0.82rem', marginBottom: '14px' }}>
                  {modalError}
                </div>
              )}

              {(() => {
                const currentlyActive = Boolean(
                  selectedUserForStatus.isActive ??
                  selectedUserForStatus.is_active ??
                  selectedUserForStatus.status === 'active'
                );
                return (
                  <div>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#e2e8f0' }}>
                      Are you sure you want to {currentlyActive ? <strong>suspend</strong> : <strong>reactivate</strong>} the following platform user?
                    </p>

                    <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
                      <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.92rem' }}>
                        {selectedUserForStatus.username}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                        {selectedUserForStatus.email} • Role: {selectedUserForStatus.role}
                      </div>
                    </div>

                    <div className={`consequence-box ${currentlyActive ? 'danger' : 'info'}`}>
                      <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        {currentlyActive ? (
                          <span>
                            <strong>Consequence:</strong> Suspending this account will immediately revoke access and reject subsequent login attempts. Historical contest records, ratings, and code submissions will be preserved safely.
                          </span>
                        ) : (
                          <span>
                            <strong>Consequence:</strong> Reactivating this account will restore standard login capabilities, contest participation, and problem solving access for this user.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setStatusConfirmModalOpen(false)}
                disabled={isProcessing}
              >
                Cancel
              </button>

              {(() => {
                const currentlyActive = Boolean(
                  selectedUserForStatus.isActive ??
                  selectedUserForStatus.is_active ??
                  selectedUserForStatus.status === 'active'
                );
                return (
                  <button
                    className={currentlyActive ? 'btn-danger' : 'btn-success'}
                    onClick={handleConfirmStatusToggle}
                    disabled={isProcessing}
                    data-testid="confirm-status-btn"
                  >
                    {isProcessing
                      ? 'Processing...'
                      : currentlyActive
                      ? 'Confirm Suspension'
                      : 'Confirm Activation'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 7. Role Change Confirmation Modal */}
      {roleChangeModalOpen && selectedUserForRole && (
        <div className="admin-modal-backdrop" data-testid="role-change-modal">
          <div className="admin-modal-dialog">
            <div className="modal-header">
              <h3>
                <Shield size={18} style={{ color: '#38bdf8' }} />
                Assign Role for @{selectedUserForRole.username}
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setRoleChangeModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {modalError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '0.82rem', marginBottom: '14px' }}>
                  {modalError}
                </div>
              )}

              <p style={{ margin: '0 0 14px 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                Current Role:{' '}
                <strong style={{ color: '#38bdf8', textTransform: 'uppercase' }}>
                  {selectedUserForRole.role}
                </strong>
              </p>

              <div className="form-group">
                <label>Select New Platform Role</label>
                <select
                  className="form-input"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  data-testid="target-role-select"
                >
                  <option value="student">Student (Standard Candidate)</option>
                  <option value="professor">Professor (Faculty & Problem Author)</option>
                  <option value="contest_admin">Contest Admin (Contest Organizer)</option>
                  <option value="super_admin">Super Admin (Platform Governor Console)</option>
                </select>
              </div>

              <div className="consequence-box info">
                <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '0.8rem' }}>
                  {targetRole === 'super_admin'
                    ? 'Caution: Assigning Super Admin grants full unrestricted platform governance powers, user management, and security audit rights.'
                    : targetRole === 'professor'
                    ? 'Professor role allows authoring problems, creating contests, and participating in peer review workflows.'
                    : 'Standard student role restricts access strictly to solving practice problems, contests, and viewing profile analytics.'}
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setRoleChangeModalOpen(false)}
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmRoleChange}
                disabled={isProcessing || targetRole === selectedUserForRole.role}
                data-testid="confirm-role-btn"
              >
                {isProcessing ? 'Updating...' : 'Confirm Role Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Create / Provision User Modal */}
      {createUserModalOpen && (
        <div className="admin-modal-backdrop" data-testid="create-user-modal">
          <div className="admin-modal-dialog">
            <div className="modal-header">
              <h3>
                <Plus size={18} style={{ color: '#38bdf8' }} /> Provision Platform User
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setCreateUserModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {modalError && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '0.82rem', marginBottom: '14px' }}>
                    {modalError}
                  </div>
                )}

                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. faculty_smith"
                    value={newUserData.username}
                    onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                    className="form-input"
                    data-testid="new-user-username"
                  />
                </div>

                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. Jane Smith"
                    value={newUserData.fullName}
                    onChange={(e) => setNewUserData({ ...newUserData, fullName: e.target.value })}
                    className="form-input"
                    data-testid="new-user-fullname"
                  />
                </div>

                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. jsmith@university.edu"
                    value={newUserData.email}
                    onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                    className="form-input"
                    data-testid="new-user-email"
                  />
                </div>

                <div className="form-group">
                  <label>Institution (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Department of Computer Science"
                    value={newUserData.institution}
                    onChange={(e) => setNewUserData({ ...newUserData, institution: e.target.value })}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label>Initial Temporary Password</label>
                  <input
                    type="password"
                    required
                    placeholder="Minimum 8 characters"
                    value={newUserData.password}
                    onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                    className="form-input"
                    data-testid="new-user-password"
                  />
                </div>

                <div className="form-group">
                  <label>Assigned Role</label>
                  <select
                    value={newUserData.role}
                    onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
                    className="form-input"
                    data-testid="new-user-role"
                  >
                    <option value="student">Student</option>
                    <option value="professor">Professor</option>
                    <option value="contest_admin">Contest Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCreateUserModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isProcessing}
                  data-testid="submit-provision-user-btn"
                >
                  {isProcessing ? 'Provisioning...' : 'Provision User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
