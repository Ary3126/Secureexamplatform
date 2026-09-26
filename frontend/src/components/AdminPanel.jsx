import React, { useState, useEffect, useCallback } from 'react';
import './admin/adminShell.css';
import AdminSidebar from './admin/AdminSidebar';
import AdminHeader from './admin/AdminHeader';

// ── Real Section Components ────────────────────────────────────────────────
import AdminDashboard from './admin/AdminDashboard';
import AdminUserManagement from './admin/AdminUserManagement';
import AdminProblemManagement from './admin/AdminProblemManagement';
import AdminProblemEditor from './admin/AdminProblemEditor';
import AdminContestManagement from './admin/AdminContestManagement';
import AdminReviewGovernance from './admin/AdminReviewGovernance';
import AdminObservability from './admin/AdminObservability';
import AdminAuditLogs from './admin/AdminAuditLogs';
import { parseAdminProblemSubroute, buildAdminProblemPath } from '../config/adminNavConfig';

const ADMIN_SIDEBAR_STORAGE_KEY = 'securejudge_admin_sidebar_collapsed';

// ── Users Section Container ────────────────────────────────────────────────
function UsersSection({ token, currentUser }) {
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const payload = data.data || data;
        const userList = payload.users || (Array.isArray(payload) ? payload : []);
        const total = payload.pagination?.total ?? payload.total ?? payload.totalUsers ?? userList.length;
        setUsers(userList);
        setTotalUsers(total);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, [token, page, search, roleFilter, statusFilter]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleFetchUserDetails = async (userId) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        return json.data?.user || json.user || json;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch user details:', err);
      return null;
    }
  };

  const handleCreateUser = async (userData) => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(userData),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchUsers();
        return { success: true };
      }
      return { success: false, message: data.message || 'Failed to create user' };
    } catch (err) {
      console.error('Create user failed:', err);
      return { success: false, message: err.message || 'Network error' };
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateUserRole = async (userId, role) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchUsers();
        return { success: true };
      }
      return { success: false, message: data.message || 'Failed to update user role' };
    } catch (err) {
      console.error('Role update failed:', err);
      return { success: false, message: err.message || 'Network error' };
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleUserStatus = async (userOrId, currentIsActive) => {
    setIsProcessing(true);
    let userId = userOrId;
    let isActive = currentIsActive;
    if (userOrId && typeof userOrId === 'object') {
      userId = userOrId.id;
      isActive = userOrId.isActive !== undefined ? userOrId.isActive : (userOrId.is_active !== undefined ? userOrId.is_active : userOrId.status === 'active');
    }
    const newIsActive = !isActive;
    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive: newIsActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchUsers();
        return { success: true };
      }
      return { success: false, message: data.message || 'Failed to update account status' };
    } catch (err) {
      console.error('Status toggle failed:', err);
      return { success: false, message: err.message || 'Network error' };
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AdminUserManagement
      users={users}
      totalUsers={totalUsers}
      page={page}
      limit={20}
      search={search}
      roleFilter={roleFilter}
      statusFilter={statusFilter}
      loading={loading}
      currentUser={currentUser}
      isProcessing={isProcessing}
      onSearchChange={(v) => { setSearch(v); setPage(1); }}
      onRoleFilterChange={(v) => { setRoleFilter(v); setPage(1); }}
      onStatusFilterChange={(v) => { setStatusFilter(v); setPage(1); }}
      onPageChange={setPage}
      onCreateUser={handleCreateUser}
      onUpdateUserRole={handleUpdateUserRole}
      onToggleUserStatus={handleToggleUserStatus}
      onFetchUserDetails={handleFetchUserDetails}
    />
  );
}

// ── Problems Section Container ─────────────────────────────────────────────
function ProblemsSection({ token, currentUser, onNavigateSubroute }) {
  const initialSubroute = parseAdminProblemSubroute(typeof window !== 'undefined' ? window.location.pathname : '');
  const [subview, setSubview] = useState(initialSubroute.subview);
  const [selectedProblemId, setSelectedProblemId] = useState(initialSubroute.problemId);

  // List view filters & state
  const [problems, setProblems] = useState([]);
  const [totalProblems, setTotalProblems] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [codingModeFilter, setCodingModeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Sync subroute from external popstate
  useEffect(() => {
    const handlePopState = () => {
      const { subview: sv, problemId: pid } = parseAdminProblemSubroute(typeof window !== 'undefined' ? window.location.pathname : '');
      setSubview(sv);
      setSelectedProblemId(pid);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateSubroute = (newSubview, probId = null) => {
    setSubview(newSubview);
    setSelectedProblemId(probId);
    const newPath = buildAdminProblemPath(newSubview, probId);
    if (typeof window !== 'undefined' && window.history && window.location.pathname !== newPath) {
      window.history.pushState({ view: 'admin', adminSection: 'problems', subview: newSubview, problemId: probId }, '', newPath);
    }
    if (onNavigateSubroute) {
      onNavigateSubroute('problems', newPath);
    }
  };

  const fetchProblems = useCallback(async () => {
    if (subview !== 'list') return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit });
      if (search.trim()) params.set('search', search.trim());
      if (difficultyFilter !== 'all') params.set('difficulty', difficultyFilter);
      if (codingModeFilter !== 'all') params.set('coding_mode', codingModeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (scopeFilter !== 'all') params.set('access_scope', scopeFilter);

      const res = await fetch(`/api/admin/problems?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const payload = data.data || data;
        const problemList = payload.problems || (Array.isArray(payload) ? payload : []);
        const total = payload.pagination?.total ?? payload.total ?? payload.totalProblems ?? problemList.length;
        setProblems(problemList);
        setTotalProblems(total);
      }
    } catch (err) {
      console.error('Failed to fetch problems:', err);
    } finally {
      setLoading(false);
    }
  }, [token, subview, page, limit, search, difficultyFilter, codingModeFilter, statusFilter, scopeFilter]);

  useEffect(() => {
    if (subview === 'list') {
      fetchProblems();
    }
  }, [fetchProblems, subview]);

  const handleArchiveProblem = async (problemId) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/admin/problems/${problemId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchProblems();
    } catch (err) {
      console.error('Archive problem failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setDifficultyFilter('all');
    setCodingModeFilter('all');
    setStatusFilter('all');
    setScopeFilter('all');
    setPage(1);
  };

  if (subview === 'create') {
    return (
      <AdminProblemEditor
        mode="create"
        problemId={null}
        token={token}
        currentUser={currentUser}
        onBack={() => navigateSubroute('list')}
        onSaved={() => {
          fetchProblems();
          navigateSubroute('list');
        }}
      />
    );
  }

  if (subview === 'edit') {
    return (
      <AdminProblemEditor
        mode="edit"
        problemId={selectedProblemId}
        token={token}
        currentUser={currentUser}
        onBack={() => navigateSubroute('list')}
        onSaved={() => {
          fetchProblems();
        }}
      />
    );
  }

  return (
    <AdminProblemManagement
      problems={problems}
      totalProblems={totalProblems}
      page={page}
      limit={limit}
      search={search}
      difficultyFilter={difficultyFilter}
      codingModeFilter={codingModeFilter}
      statusFilter={statusFilter}
      scopeFilter={scopeFilter}
      loading={loading}
      isProcessing={isProcessing}
      onSearchChange={(val) => { setSearch(val); setPage(1); }}
      onDifficultyFilterChange={(val) => { setDifficultyFilter(val); setPage(1); }}
      onCodingModeFilterChange={(val) => { setCodingModeFilter(val); setPage(1); }}
      onStatusFilterChange={(val) => { setStatusFilter(val); setPage(1); }}
      onScopeFilterChange={(val) => { setScopeFilter(val); setPage(1); }}
      onResetFilters={handleResetFilters}
      onPageChange={setPage}
      onNavigateToCreate={() => navigateSubroute('create')}
      onNavigateToEdit={(prob) => navigateSubroute('edit', prob.id || prob.problemId)}
      onArchiveProblem={handleArchiveProblem}
    />
  );
}

// ── Contests Section Container ─────────────────────────────────────────────
function ContestsSection({ token }) {
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchContests = useCallback(async () => {
    setLoading(true);
    try {
      // /api/contests is publicly listed; super_admin token grants full visibility
      const res = await fetch('/api/contests', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setContests(data.contests || data || []);
      }
    } catch (err) {
      console.error('Failed to fetch contests:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchContests(); }, [fetchContests]);

  const handlePublishContest = async (contestId) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/contests/${contestId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchContests();
    } catch (err) {
      console.error('Publish contest failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArchiveContest = async (contestId) => {
    setIsProcessing(true);
    try {
      // Use PATCH to update status to 'archived'
      const res = await fetch(`/api/contests/${contestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (res.ok) fetchContests();
    } catch (err) {
      console.error('Archive contest failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AdminContestManagement
      contests={contests}
      loading={loading}
      isProcessing={isProcessing}
      onInspectContest={(c) => console.log('Inspect contest', c)}
      onPublishContest={handlePublishContest}
      onArchiveContest={handleArchiveContest}
    />
  );
}

// ── Reviews Section Container ──────────────────────────────────────────────
function ReviewsSection({ token }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/problem-reviews', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews || data || []);
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  return (
    <AdminReviewGovernance
      token={token}
      reviews={reviews}
      loading={loading}
      onInspectReview={(r) => console.log('Inspect review', r)}
    />
  );
}

// ── Audit Logs Section Container (Phase 7.1) ───────────────────────────────
// Previously orphaned AdminAuditLogs.jsx is now wired here.
// Backend: GET /api/admin/audit-logs (implemented, verified in Phase 5.9)
function AuditSection({ token }) {
  return (
    <AdminAuditLogs token={token} />
  );
}

// ── Main AdminPanel Component ──────────────────────────────────────────────

/**
 * AdminPanel — Fully Wired Administrative Shell
 * All 6 sections (Dashboard, Users, Problems, Contests, Reviews, System/Observability)
 * are now connected to real components with live API data fetching.
 * No placeholder components remain.
 */
export default function AdminPanel({
  currentUser,
  token,
  initialSection = 'dashboard',
  onNavigateSection = () => {},
  onLogout = () => {},
  onExitToPlatform = () => {},
}) {
  // 1. Active Admin Section Routing
  const [activeSection, setActiveSection] = useState(initialSection || 'dashboard');

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  // 2. Sidebar Collapsed State with LocalStorage persistence
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // 3. Mobile Navigation Drawer State
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // 4. Keyboard Shortcuts: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, isMobileOpen]);

  // 5. Handle Section Navigation
  const handleSelectSection = (sectionId, path) => {
    setActiveSection(sectionId);
    onNavigateSection(sectionId, path);
  };

  return (
    <div className="admin-shell-layout">
      {/* 1. Admin Sidebar */}
      <AdminSidebar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        currentUser={currentUser}
        onLogout={onLogout}
        onExitToPlatform={onExitToPlatform}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* 2. Main Administration Workspace */}
      <div className="admin-main-track">
        <AdminHeader
          activeSection={activeSection}
          currentUser={currentUser}
          onLogout={onLogout}
          onToggleMobile={() => setIsMobileOpen((prev) => !prev)}
          onExitToPlatform={onExitToPlatform}
        />

        <main className="admin-viewport" role="main">
          {/* Dashboard — Phase 2 live metrics */}
          {activeSection === 'dashboard' && (
            <AdminDashboard
              token={token}
              onNavigateSection={handleSelectSection}
            />
          )}

          {/* Users & Roles — live directory with role/status management */}
          {activeSection === 'users' && (
            <UsersSection token={token} currentUser={currentUser} />
          )}

          {/* Problem Bank — governance, quality scoring, lifecycle */}
          {activeSection === 'problems' && (
            <ProblemsSection
              token={token}
              currentUser={currentUser}
              onNavigateSubroute={handleSelectSection}
            />
          )}

          {/* Contests & Exams — scheduling, publish/archive lifecycle */}
          {activeSection === 'contests' && (
            <ContestsSection token={token} />
          )}

          {/* Problem Reviews & SLA Oversight */}
          {activeSection === 'reviews' && (
            <ReviewsSection token={token} />
          )}

          {/* Audit Logs & Security Events — Phase 7.1: wired from orphaned AdminAuditLogs */}
          {activeSection === 'audit' && (
            <AuditSection token={token} />
          )}

          {/* System Observability — health, metrics, incidents */}
          {activeSection === 'system' && (
            <AdminObservability token={token} />
          )}
        </main>
      </div>
    </div>
  );
}
