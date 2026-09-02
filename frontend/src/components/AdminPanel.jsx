import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Users,
  Trophy,
  BookOpen,
  Inbox,
  Activity,
  FileText,
  Server,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  LogOut,
  LayoutDashboard,
} from 'lucide-react';

import AdminDashboardView from './admin/AdminDashboardView';
import AdminUserManagement from './admin/AdminUserManagement';
import AdminContestManagement from './admin/AdminContestManagement';
import AdminProblemGovernance from './admin/AdminProblemGovernance';
import AdminReviewGovernance from './admin/AdminReviewGovernance';
import AdminAuditLogs from './admin/AdminAuditLogs';
import AdminSystemHealth from './admin/AdminSystemHealth';
import AdminObservability from './admin/AdminObservability';

/**
 * Dedicated Super Admin & Contest Admin Governance Panel
 * Pure platform-management interface strictly separated from Professor academic authoring.
 */
export default function AdminPanel({
  token,
  currentUser,
  onNavigateToProblem,
  onNavigateToContest,
  initialTab = 'overview',
}) {
  // Navigation Tab: 'overview' | 'users' | 'contests' | 'problems' | 'reviews' | 'audit' | 'observability' | 'system'
  const [activeTab, setActiveTab] = useState(initialTab || 'overview');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Aggregated Stats State (from GET /api/admin/overview-stats)
  const [overviewStats, setOverviewStats] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Users Directory State (from GET /api/admin/users)
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Platform Contests State (from GET /api/contests)
  const [contests, setContests] = useState([]);
  const [loadingContests, setLoadingContests] = useState(false);

  // Platform Problems State (from GET /api/problems)
  const [problems, setProblems] = useState([]);
  const [loadingProblems, setLoadingProblems] = useState(false);

  // Review Queue State (from GET /api/admin/problem-reviews)
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  // Audit Logs State (from GET /api/admin/audit-logs)
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Global Feedback State
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // 1. Fetch Aggregated Overview Stats
  const fetchOverviewStats = useCallback(async () => {
    try {
      setLoadingOverview(true);
      setError(null);
      const res = await fetch('/api/admin/overview-stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setOverviewStats(data.data || data);
      } else {
        setError(data.message || 'Failed to load platform overview stats');
      }
    } catch (err) {
      console.error('Failed to load overview stats:', err);
    } finally {
      setLoadingOverview(false);
    }
  }, [token]);

  // 2. Fetch Users Directory
  const fetchUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      setError(null);
      let url = `/api/admin/users?page=${userPage}&limit=20`;
      if (userSearch.trim()) url += `&search=${encodeURIComponent(userSearch.trim())}`;
      if (userRoleFilter !== 'all') url += `&role=${userRoleFilter}`;
      if (userStatusFilter !== 'all') url += `&status=${userStatusFilter}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const uList = data.data?.users || data.users || [];
        setUsers(uList);
        setTotalUsers(data.data?.pagination?.total || data.pagination?.total || data.total || uList.length);
      } else {
        setError(data.message || 'Failed to load user directory');
      }
    } catch (err) {
      setError('Network error while loading users');
    } finally {
      setLoadingUsers(false);
    }
  }, [token, userPage, userSearch, userRoleFilter, userStatusFilter]);

  // 3. Fetch Platform Contests & Problems
  const fetchPlatformContent = useCallback(async () => {
    try {
      setLoadingContests(true);
      setLoadingProblems(true);
      const [cRes, pRes, rRes] = await Promise.all([
        fetch('/api/contests?limit=100', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/problems?limit=100', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/problem-reviews?limit=50', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (cRes.ok) {
        const cData = await cRes.json();
        setContests(cData.data?.contests || cData.contests || cData || []);
      }
      if (pRes.ok) {
        const pData = await pRes.json();
        setProblems(pData.data?.problems || pData.problems || pData || []);
      }
      if (rRes.ok) {
        const rData = await rRes.json();
        setReviewQueue(rData.data?.reviews || rData.reviews || []);
      }
    } catch (err) {
      console.error('Failed to load platform content:', err);
    } finally {
      setLoadingContests(false);
      setLoadingProblems(false);
    }
  }, [token]);

  // 4. Fetch Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      setLoadingAudit(true);
      let url = '/api/admin/audit-logs?limit=50';
      if (auditActionFilter !== 'all') url += `&action=${auditActionFilter}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const aList = data.data?.auditLogs || data.data?.logs || data.auditLogs || (Array.isArray(data.data) ? data.data : []);
        setAuditLogs(aList);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  }, [token, auditActionFilter]);

  // Trigger data fetches on tab change
  useEffect(() => {
    fetchOverviewStats();
    fetchPlatformContent();
    if (activeTab === 'users' || activeTab === 'overview') fetchUsers();
    if (activeTab === 'audit' || activeTab === 'overview') fetchAuditLogs();
  }, [fetchOverviewStats, fetchPlatformContent, fetchUsers, fetchAuditLogs, activeTab]);

  // Handle Create User
  const handleCreateUser = async (newUserData) => {
    try {
      setIsProcessing(true);
      setError(null);
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newUserData),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`User ${newUserData.username} provisioned successfully with role ${newUserData.role}`);
        fetchUsers();
        fetchOverviewStats();
      } else {
        setError(data.message || 'Failed to create user');
      }
    } catch (err) {
      setError('Network error creating user');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Update Role
  const handleUpdateUserRole = async (userId, newRole) => {
    try {
      setIsProcessing(true);
      setError(null);
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Role updated to ${newRole}`);
        fetchUsers();
        fetchOverviewStats();
      } else {
        setError(data.message || 'Failed to update role');
      }
    } catch (err) {
      setError('Network error updating role');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Create General Problem (Public Problem Bank)
  const handleCreateProblem = async (newProblemData) => {
    try {
      setIsProcessing(true);
      setError(null);
      const res = await fetch('/api/problems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...newProblemData,
          accessScope: newProblemData.accessScope || 'public',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Problem "${newProblemData.title}" created successfully in Public Problem Bank`);
        fetchPlatformContent();
        fetchOverviewStats();
      } else {
        setError(data.message || 'Failed to create problem');
      }
    } catch (err) {
      setError('Network error creating problem');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Toggle Status
  const handleToggleUserStatus = async (user) => {
    const isCurrentlyActive = user.is_active !== undefined ? user.is_active : user.status === 'active';
    const nextIsActive = !isCurrentlyActive;
    try {
      setIsProcessing(true);
      setError(null);
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: nextIsActive, status: nextIsActive ? 'active' : 'inactive' }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`User ${user.username} is now ${nextIsActive ? 'Active' : 'Suspended'}`);
        fetchUsers();
        fetchOverviewStats();
      } else {
        setError(data.message || 'Failed to update user status');
      }
    } catch (err) {
      setError('Network error updating user status');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Publish Contest
  const handlePublishContest = async (contestId) => {
    try {
      setIsProcessing(true);
      setError(null);
      const res = await fetch(`/api/contests/${contestId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Contest published and live!');
        fetchPlatformContent();
        fetchOverviewStats();
      } else {
        setError(data.message || 'Failed to publish contest');
      }
    } catch (err) {
      setError('Network error publishing contest');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: '#090d16', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Admin Top Console Bar */}
      <div
        style={{
          background: '#0f172a',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '0 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '56px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={22} color="#f59e0b" />
            <span style={{ fontWeight: '800', fontSize: '1.05rem', color: '#f8fafc' }}>
              Platform Governor Console
            </span>
            <span
              style={{
                fontSize: '0.68rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#fbbf24',
                fontWeight: '800',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {currentUser?.role || 'SUPER ADMIN'}
            </span>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', gap: '2px' }}>
            <button
              onClick={() => setActiveTab('overview')}
              style={{
                background: activeTab === 'overview' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'overview' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Activity size={14} /> Overview
            </button>

            <button
              onClick={() => setActiveTab('users')}
              style={{
                background: activeTab === 'users' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'users' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Users size={14} /> Users & Roles ({totalUsers || users.length})
            </button>

            <button
              onClick={() => setActiveTab('contests')}
              style={{
                background: activeTab === 'contests' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'contests' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trophy size={14} /> Contests ({contests.length})
            </button>

            <button
              onClick={() => setActiveTab('problems')}
              style={{
                background: activeTab === 'problems' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'problems' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BookOpen size={14} /> Problems ({problems.length})
            </button>

            <button
              onClick={() => setActiveTab('reviews')}
              style={{
                background: activeTab === 'reviews' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'reviews' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Inbox size={14} /> Reviews ({reviewQueue.length})
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              style={{
                background: activeTab === 'audit' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'audit' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <FileText size={14} /> Audit Logs
            </button>

            <button
              onClick={() => setActiveTab('observability')}
              style={{
                background: activeTab === 'observability' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'observability' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Activity size={14} /> Observability
            </button>

            <button
              onClick={() => setActiveTab('system')}
              style={{
                background: activeTab === 'system' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeTab === 'system' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Server size={14} /> Diagnostics
            </button>
          </nav>
        </div>

        {/* Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80' }} />
          <span style={{ fontSize: '0.78rem', color: '#86efac', fontWeight: '600' }}>Admin Gateway Active</span>
        </div>
      </div>

      {/* Global Alerts Banner */}
      {error && (
        <div style={{ padding: '10px 24px', background: 'rgba(239, 68, 68, 0.15)', borderBottom: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '10px 24px', background: 'rgba(34, 197, 94, 0.15)', borderBottom: '1px solid rgba(34, 197, 94, 0.3)', color: '#86efac', fontSize: '0.85rem' }}>
          {successMsg}
        </div>
      )}

      {/* 2. Main Content Body Area */}
      <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* VIEW 1: OVERVIEW & SYSTEM HEALTH */}
        {activeTab === 'overview' && (
          <AdminDashboardView
            stats={overviewStats}
            loading={loadingOverview}
            onRefresh={() => {
              fetchOverviewStats();
              fetchPlatformContent();
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenCreateUser={() => setActiveTab('users')}
          />
        )}

        {/* VIEW 2: USERS & ROLES DIRECTORY (Phase 5.9.4) */}
        {activeTab === 'users' && (
          <AdminUserManagement
            users={users}
            totalUsers={totalUsers}
            page={userPage}
            limit={20}
            search={userSearch}
            roleFilter={userRoleFilter}
            statusFilter={userStatusFilter}
            loading={loadingUsers}
            currentUser={currentUser}
            onSearchChange={(q) => {
              setUserSearch(q);
              setUserPage(1);
            }}
            onRoleFilterChange={(rf) => {
              setUserRoleFilter(rf);
              setUserPage(1);
            }}
            onStatusFilterChange={(sf) => {
              setUserStatusFilter(sf);
              setUserPage(1);
            }}
            onPageChange={(p) => setUserPage(p)}
            onCreateUser={handleCreateUser}
            onUpdateUserRole={handleUpdateUserRole}
            onToggleUserStatus={handleToggleUserStatus}
            isProcessing={isProcessing}
          />
        )}

        {/* VIEW 3: ALL PLATFORM CONTESTS */}
        {activeTab === 'contests' && (
          <AdminContestManagement
            contests={contests}
            loading={loadingContests}
            onInspectContest={(cid) => {
              if (onNavigateToContest) onNavigateToContest(cid);
              else window.location.href = `/contests/${cid}/leaderboard`;
            }}
            onPublishContest={handlePublishContest}
            isProcessing={isProcessing}
          />
        )}

        {/* VIEW 4: PROBLEM BANK GOVERNANCE */}
        {activeTab === 'problems' && (
          <AdminProblemGovernance
            problems={problems}
            loading={loadingProblems}
            onCreateProblem={handleCreateProblem}
            onOpenWorkspace={(probId) => {
              if (onNavigateToProblem) onNavigateToProblem(probId);
            }}
            isProcessing={isProcessing}
          />
        )}

        {/* VIEW 5: REVIEW GOVERNANCE (Phase 5.9.6 / 5.9.7) */}
        {activeTab === 'reviews' && (
          <AdminReviewGovernance
            token={token}
            reviews={reviewQueue}
            loading={loadingReviews}
            onInspectReview={(probId) => {
              if (onNavigateToProblem) onNavigateToProblem(probId);
            }}
          />
        )}

        {/* VIEW 6: SECURITY AUDIT LOGS (Phase 5.9.3) */}
        {activeTab === 'audit' && (
          <AdminAuditLogs
            logs={auditLogs}
            loading={loadingAudit}
            actionFilter={auditActionFilter}
            onActionFilterChange={(af) => setAuditActionFilter(af)}
          />
        )}

        {/* VIEW 7: OBSERVABILITY & RELIABILITY (Phase 5.9.10) */}
        {activeTab === 'observability' && (
          <AdminObservability token={token} />
        )}

        {/* VIEW 8: SYSTEM DIAGNOSTICS */}
        {activeTab === 'system' && (
          <AdminSystemHealth
            system={overviewStats?.system}
            stats={overviewStats}
            onRefresh={fetchOverviewStats}
          />
        )}
      </div>
    </div>
  );
}
