import React, { useState } from 'react';
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
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';

/**
 * Admin User & Role Management Component (Phase 5.9.4 Integration)
 * Full platform user directory with search, role-based filtering,
 * role assignment, account status suspension/activation, and new user provisioning.
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
  isProcessing = false,
}) {
  // Local state for modals
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [roleChangeModalOpen, setRoleChangeModalOpen] = useState(false);
  const [selectedUserForRole, setSelectedUserForRole] = useState(null);
  const [targetRole, setTargetRole] = useState('student');

  const [newUserData, setNewUserData] = useState({
    username: '',
    fullName: '',
    email: '',
    password: '',
    role: 'professor',
    status: 'active',
  });

  const totalPages = Math.ceil(totalUsers / limit) || 1;

  const handleOpenRoleModal = (user) => {
    setSelectedUserForRole(user);
    setTargetRole(user.role);
    setRoleChangeModalOpen(true);
  };

  const handleConfirmRoleChange = async () => {
    if (!selectedUserForRole) return;
    await onUpdateUserRole(selectedUserForRole.id, targetRole);
    setRoleChangeModalOpen(false);
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    await onCreateUser({
      ...newUserData,
      fullName: newUserData.fullName.trim() || newUserData.username.trim(),
    });
    setCreateUserModalOpen(false);
    setNewUserData({ username: '', fullName: '', email: '', password: '', role: 'professor', status: 'active' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header & Quick Action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', color: '#f8fafc', fontWeight: '800' }}>
            User & Role Management
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Manage platform accounts, promote user roles, and control account activation.
          </span>
        </div>

        <button
          onClick={() => setCreateUserModalOpen(true)}
          style={{
            background: '#0284c7',
            color: '#fff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '6px',
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Plus size={16} /> Provision User
        </button>
      </div>

      {/* 2. Filter Toolbar */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
          <input
            type="text"
            placeholder="Search by username or email address..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '0.85rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => onRoleFilterChange(e.target.value)}
              style={{
                padding: '7px 12px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            >
              <option value="all">All Roles</option>
              <option value="student">Student</option>
              <option value="professor">Professor</option>
              <option value="contest_admin">Contest Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              style={{
                padding: '7px 12px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive / Suspended</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Users Table */}
      <div style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '20px' }}>
        {loading ? (
          <AuthoringLoadingState message="Loading platform users directory..." />
        ) : users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '0.9rem' }}>
            No platform users found matching your search and filter criteria.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 14px' }}>User Details</th>
                  <th style={{ padding: '12px 14px' }}>Platform Role</th>
                  <th style={{ padding: '12px 14px' }}>Account Status</th>
                  <th style={{ padding: '12px 14px' }}>Registered At</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '14px' }}>
                      <span style={{ fontWeight: '700', color: '#f8fafc', display: 'block' }}>{u.username}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background:
                            u.role === 'super_admin'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : u.role === 'professor'
                              ? 'rgba(56, 189, 248, 0.15)'
                              : 'rgba(255, 255, 255, 0.08)',
                          color:
                            u.role === 'super_admin'
                              ? '#f87171'
                              : u.role === 'professor'
                              ? '#38bdf8'
                              : '#cbd5e1',
                        }}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: u.status === 'active' || u.is_active ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: u.status === 'active' || u.is_active ? '#4ade80' : '#f87171',
                        }}
                      >
                        {u.status || (u.is_active ? 'active' : 'suspended')}
                      </span>
                    </td>
                    <td style={{ padding: '14px', color: '#64748b', fontSize: '0.78rem' }}>
                      {new Date(u.createdAt || u.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          onClick={() => handleOpenRoleModal(u)}
                          style={{
                            background: 'rgba(56, 189, 248, 0.1)',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            color: '#38bdf8',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Change Role
                        </button>

                        {currentUser && currentUser.id !== u.id && (
                          <button
                            onClick={() => onToggleUserStatus(u)}
                            disabled={isProcessing}
                            style={{
                              background: (u.status === 'active' || u.is_active) ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                              border: (u.status === 'active' || u.is_active) ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)',
                              color: (u.status === 'active' || u.is_active) ? '#f87171' : '#4ade80',
                              borderRadius: '4px',
                              padding: '4px 10px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              cursor: 'pointer',
                            }}
                          >
                            {(u.status === 'active' || u.is_active) ? 'Suspend' : 'Activate'}
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

        {/* 4. Pagination */}
        {totalUsers > limit && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Showing {users.length} of {totalUsers} total users
            </span>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: page <= 1 ? '#475569' : '#cbd5e1',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.78rem',
                }}
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <span style={{ padding: '4px 10px', fontSize: '0.8rem', color: '#f8fafc', fontWeight: '700' }}>
                {page} / {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: page >= totalPages ? '#475569' : '#cbd5e1',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.78rem',
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Create User Modal */}
      {createUserModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '480px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
                Provision Platform User
              </h3>
              <button onClick={() => setCreateUserModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Username</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. prof_john"
                  value={newUserData.username}
                  onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Dr. John Doe"
                  value={newUserData.fullName}
                  onChange={(e) => setNewUserData({ ...newUserData, fullName: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Email</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. john@university.edu"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Initial Password</label>
                <input
                  type="password"
                  required
                  placeholder="Minimum 8 characters"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Assigned Role</label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
                  style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
                >
                  <option value="student">Student</option>
                  <option value="professor">Professor</option>
                  <option value="contest_admin">Contest Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setCreateUserModalOpen(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', padding: '8px 14px', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={isProcessing} style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}>
                  {isProcessing ? 'Provisioning...' : 'Provision User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Role Change Modal */}
      {roleChangeModalOpen && selectedUserForRole && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '440px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
              Assign Role for {selectedUserForRole.username}
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.82rem', color: '#94a3b8' }}>
              Current Role: <strong style={{ color: '#38bdf8', textTransform: 'uppercase' }}>{selectedUserForRole.role}</strong>
            </p>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', color: '#e2e8f0', marginBottom: '6px' }}>Select New Platform Role</label>
              <select
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none' }}
              >
                <option value="student">Student</option>
                <option value="professor">Professor</option>
                <option value="contest_admin">Contest Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setRoleChangeModalOpen(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', padding: '8px 14px', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirmRoleChange} disabled={isProcessing} style={{ background: '#f59e0b', color: '#0f172a', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}>
                {isProcessing ? 'Updating...' : 'Confirm Role Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
