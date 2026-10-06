import React, { useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Database,
  Users,
  Trophy,
  BookOpen,
  FileCode,
  ShieldCheck,
  Tag,
  ArrowRight,
  Layers,
} from 'lucide-react';

export default function AdminTestDataArchive({ token, currentUser }) {
  // Navigation Tabs: 'runs' | 'users' | 'contests' | 'problems'
  const [activeTab, setActiveTab] = useState('runs');

  // Summary counts
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Table list state
  const [records, setRecords] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedRunFilter, setSelectedRunFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 1 });

  // Modal / Preview state
  const [modalOpen, setModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [targetToDelete, setTargetToDelete] = useState(null); // { type: 'run' | 'user' | 'contest' | 'problem', id, name }
  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Status alerts / toasts
  const [actionAlert, setActionAlert] = useState(null); // { type: 'success' | 'error', message }

  // Tagging legacy state
  const [isTagging, setIsTagging] = useState(false);

  // 1. Fetch Summary Statistics
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/admin/test-data/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setSummary(json.data || null);
      }
    } catch (err) {
      console.error('Failed to fetch test data summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // 2. Fetch Data according to activeTab
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'runs') {
        const params = new URLSearchParams({ page, limit: 15 });
        if (search.trim()) params.set('search', search.trim());
        const res = await fetch(`/api/admin/test-data/runs?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setRuns(json.data?.runs || []);
          setPagination(json.data?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
        }
      } else {
        const params = new URLSearchParams({ type: activeTab, page, limit: 15 });
        if (search.trim()) params.set('search', search.trim());
        if (selectedRunFilter) params.set('runId', selectedRunFilter);
        const res = await fetch(`/api/admin/test-data?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setRecords(json.data?.records || []);
          setPagination(json.data?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 });
        }
      }
    } catch (err) {
      console.error('Failed to fetch test data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, activeTab, page, search, selectedRunFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle Tab Switch
  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    setPage(1);
    setSearch('');
    setSelectedRunFilter('');
  };

  // 3. Open Preview & Deletion Modal
  const handleOpenDeleteModal = async (type, id, name) => {
    setTargetToDelete({ type, id, name });
    setConfirmInput('');
    setPreviewData(null);
    setModalOpen(true);
    setPreviewLoading(true);

    try {
      let endpoint = '';
      if (type === 'run') {
        endpoint = `/api/admin/test-data/runs/${encodeURIComponent(id)}/preview`;
      } else {
        endpoint = `/api/admin/test-data/preview?type=${type}&id=${id}`;
      }

      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setPreviewData(json.data);
      } else {
        setPreviewData({ canDelete: false, reason: json.message || 'Preview generation failed' });
      }
    } catch (err) {
      setPreviewData({ canDelete: false, reason: err.message || 'Network error fetching preview' });
    } finally {
      setPreviewLoading(false);
    }
  };

  // 4. Execute Deletion
  const handleConfirmDelete = async () => {
    if (!targetToDelete || !previewData || !previewData.canDelete) return;

    const requiredPhrase = targetToDelete.type === 'run' ? 'DELETE TEST RUN' : 'DELETE';
    if (confirmInput.trim() !== requiredPhrase) return;

    setIsDeleting(true);
    try {
      let endpoint = '';
      if (targetToDelete.type === 'run') {
        endpoint = `/api/admin/test-data/runs/${encodeURIComponent(targetToDelete.id)}`;
      } else if (targetToDelete.type === 'users') {
        endpoint = `/api/admin/test-data/users/${targetToDelete.id}`;
      } else if (targetToDelete.type === 'contests') {
        endpoint = `/api/admin/test-data/contests/${targetToDelete.id}`;
      } else if (targetToDelete.type === 'problems') {
        endpoint = `/api/admin/test-data/problems/${targetToDelete.id}`;
      }

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (res.ok) {
        setActionAlert({
          type: 'success',
          message: json.message || 'Successfully deleted test record and dependent test entities.',
        });
        setModalOpen(false);
        fetchSummary();
        fetchData();
      } else {
        setActionAlert({
          type: 'error',
          message: json.message || 'Deletion failed. Check dependencies.',
        });
      }
    } catch (err) {
      setActionAlert({
        type: 'error',
        message: err.message || 'Network error executing permanent deletion.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // 5. Tag Legacy Fixture Data
  const handleTagLegacy = async () => {
    setIsTagging(true);
    try {
      const res = await fetch('/api/admin/test-data/tag-legacy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (res.ok) {
        setActionAlert({
          type: 'success',
          message: `Legacy tagging complete: ${json.data?.usersTagged || 0} users, ${json.data?.contestsTagged || 0} contests, ${json.data?.problemsTagged || 0} problems tagged.`,
        });
        fetchSummary();
        fetchData();
      } else {
        setActionAlert({ type: 'error', message: json.message || 'Legacy tagging failed.' });
      }
    } catch (err) {
      setActionAlert({ type: 'error', message: err.message || 'Network error during legacy tagging.' });
    } finally {
      setIsTagging(false);
    }
  };

  const requiredConfirmationText = targetToDelete?.type === 'run' ? 'DELETE TEST RUN' : 'DELETE';
  const isConfirmEnabled = confirmInput.trim() === requiredConfirmationText && previewData?.canDelete && !isDeleting;

  return (
    <div className="admin-test-data-container" data-testid="admin-test-data-archive" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* 1. Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>
              <Trash2 size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                Test Data Archive & Cleanup
              </h2>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                Permanent deletion console for fake test suites data with dependency-aware isolation
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn-table-action"
            onClick={fetchData}
            title="Refresh Data"
            disabled={loading}
            style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} /> Refresh
          </button>

          <button
            className="btn-table-action"
            onClick={handleTagLegacy}
            disabled={isTagging}
            title="Scan & Tag Legacy Fixtures"
            style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24' }}
          >
            <Tag size={14} /> {isTagging ? 'Scanning...' : 'Tag Legacy Fixtures'}
          </button>
        </div>
      </div>

      {/* 2. Critical Safety Warning Banner */}
      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '14px 18px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <ShieldCheck size={26} style={{ color: '#f87171', flexShrink: 0 }} />
        <div style={{ fontSize: '0.84rem', color: '#fca5a5', lineHeight: 1.5 }}>
          <strong style={{ color: '#fee2e2' }}>Safety Protection Active: </strong>
          Only records explicitly verified as test fixtures can be permanently deleted. Real student accounts, professor accounts, production contests, and active problems are permanently shielded and cannot be deleted through this interface.
        </div>
      </div>

      {/* 3. Action Alert Toast */}
      {actionAlert && (
        <div style={{ background: actionAlert.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)', border: `1px solid ${actionAlert.type === 'success' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`, borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: actionAlert.type === 'success' ? '#4ade80' : '#f87171', fontSize: '0.86rem', fontWeight: 600 }}>
            {actionAlert.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {actionAlert.message}
          </div>
          <button onClick={() => setActionAlert(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
        </div>
      )}

      {/* 4. KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <div style={{ background: '#0e1626', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
            <Layers size={14} /> Test Runs
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc' }}>
            {summaryLoading ? '...' : (summary?.testRuns ?? 0)}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>Distinct test execution suites</div>
        </div>

        <div style={{ background: '#0e1626', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fb923c', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
            <Users size={14} /> Test Users
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc' }}>
            {summaryLoading ? '...' : (summary?.testUsers ?? 0)}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
            {summary?.realUsers ?? 0} real accounts protected
          </div>
        </div>

        <div style={{ background: '#0e1626', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#a78bfa', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
            <Trophy size={14} /> Test Contests
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc' }}>
            {summaryLoading ? '...' : (summary?.testContests ?? 0)}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
            {summary?.realContests ?? 0} production contests protected
          </div>
        </div>

        <div style={{ background: '#0e1626', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>
            <BookOpen size={14} /> Test Problems
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc' }}>
            {summaryLoading ? '...' : (summary?.testProblems ?? 0)}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
            {summary?.realProblems ?? 0} canonical problems protected
          </div>
        </div>
      </div>

      {/* 5. Navigation Tabs & Search Toolbar */}
      <div style={{ background: '#0e1626', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '14px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { id: 'runs', label: 'Test Runs', icon: Layers },
              { id: 'users', label: 'Test Users', icon: Users },
              { id: 'contests', label: 'Test Contests', icon: Trophy },
              { id: 'problems', label: 'Test Problems', icon: BookOpen },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    color: isActive ? '#60a5fa' : '#94a3b8',
                    border: isActive ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid transparent',
                  }}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#64748b' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={`Search ${activeTab}...`}
                style={{
                  width: '100%',
                  padding: '7px 12px 7px 32px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  color: '#f8fafc',
                  fontSize: '0.82rem',
                }}
              />
            </div>
          </div>
        </div>

        {/* 6. Active Tab Content Table */}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
            <RefreshCw size={24} className="spinning" style={{ margin: '0 auto 10px auto', display: 'block', color: '#38bdf8' }} />
            Loading test data records...
          </div>
        ) : activeTab === 'runs' ? (
          /* Runs View */
          runs.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
              No test runs found matching query.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-problems-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Test Run ID</th>
                    <th>Users</th>
                    <th>Contests</th>
                    <th>Problems</th>
                    <th>Submissions</th>
                    <th>First Activity</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.testRunId}>
                      <td>
                        <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 600, fontSize: '0.84rem' }}>
                          {r.testRunId}
                        </span>
                      </td>
                      <td><span style={{ color: '#cbd5e1' }}>{r.userCount}</span></td>
                      <td><span style={{ color: '#cbd5e1' }}>{r.contestCount}</span></td>
                      <td><span style={{ color: '#cbd5e1' }}>{r.problemCount}</span></td>
                      <td><span style={{ color: '#cbd5e1' }}>{r.submissionCount}</span></td>
                      <td>
                        <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                          {r.createdAt ? new Date(r.createdAt).toLocaleString() : 'N/A'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn-table-action suspend"
                          onClick={() => handleOpenDeleteModal('run', r.testRunId, r.testRunId)}
                          style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Trash2 size={12} /> Delete Test Run
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Entities Table (Users, Contests, Problems) */
          records.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
              No test {activeTab} found.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-problems-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{activeTab === 'users' ? 'Username / Email' : 'Title'}</th>
                    <th>{activeTab === 'users' ? 'Role' : activeTab === 'contests' ? 'Status' : 'Difficulty'}</th>
                    <th>Test Run ID</th>
                    <th>Dependencies</th>
                    <th>Created At</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((item) => {
                    const itemName = activeTab === 'users' ? item.username : item.title;
                    return (
                      <tr key={item.id}>
                        <td><span style={{ color: '#64748b', fontWeight: 600 }}>#{item.id}</span></td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.86rem' }}>
                              {itemName}
                            </span>
                            {activeTab === 'users' && (
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{item.email}</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8' }}>
                            {activeTab === 'users' ? item.role : activeTab === 'contests' ? item.status : item.difficulty}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#38bdf8' }}>
                            {item.test_run_id || 'unassigned'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>
                            {activeTab === 'users'
                              ? `${item.submission_count || 0} subs, ${item.participant_count || 0} contests`
                              : activeTab === 'contests'
                              ? `${item.participant_count || 0} parts, ${item.submission_count || 0} subs`
                              : `${item.test_case_count || 0} tc, ${item.submission_count || 0} subs`}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                            {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-table-action suspend"
                            onClick={() => handleOpenDeleteModal(activeTab, item.id, itemName)}
                            style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Pagination Toolbar */}
        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} total items)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn-table-action"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ padding: '4px 10px', fontSize: '0.76rem' }}
              >
                Previous
              </button>
              <button
                className="btn-table-action"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: '4px 10px', fontSize: '0.76rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 7. Permanent Deletion & Preview Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
          <div style={{ background: '#0d1527', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: '12px', width: '100%', maxWidth: '580px', padding: '24px', boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc' }}>
                  Permanent Deletion Confirmation
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Target: {targetToDelete?.type === 'run' ? 'Test Run' : targetToDelete?.type} "{targetToDelete?.name}"
                </span>
              </div>
            </div>

            {previewLoading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                <RefreshCw size={20} className="spinning" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                Inspecting dependent records and verifying test fixture boundaries...
              </div>
            ) : previewData?.canDelete === false ? (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px', padding: '16px', margin: '14px 0', color: '#f87171', fontSize: '0.86rem' }}>
                <strong>DELETION BLOCKED: </strong>
                {previewData?.reason}
                <div style={{ marginTop: '12px', textAlign: 'right' }}>
                  <button className="btn-table-action" onClick={() => setModalOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Dependent Records to be Permanently Removed:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.82rem', color: '#94a3b8' }}>
                    {previewData?.dependentCounts && Object.entries(previewData.dependentCounts).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                        <span style={{ textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1')}</span>
                        <strong style={{ color: '#f8fafc' }}>{val}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <p style={{ fontSize: '0.82rem', color: '#fca5a5', lineHeight: 1.5, margin: '0 0 14px 0' }}>
                  This action will permanently delete this test fixture and all its dependent test submissions, participation records, and test cases in a single database transaction. This cannot be undone.
                </p>

                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                    Type <strong style={{ color: '#f87171' }}>{requiredConfirmationText}</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={requiredConfirmationText}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '0.88rem',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    className="btn-table-action"
                    onClick={() => setModalOpen(false)}
                    disabled={isDeleting}
                    style={{ padding: '8px 16px' }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-table-action suspend"
                    onClick={handleConfirmDelete}
                    disabled={!isConfirmEnabled}
                    style={{
                      padding: '8px 18px',
                      background: isConfirmEnabled ? '#ef4444' : 'rgba(239, 68, 68, 0.2)',
                      color: isConfirmEnabled ? '#ffffff' : '#fca5a5',
                      cursor: isConfirmEnabled ? 'pointer' : 'not-allowed',
                      borderColor: isConfirmEnabled ? '#dc2626' : 'transparent',
                    }}
                  >
                    {isDeleting ? 'Deleting Permanently...' : 'Permanent Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
