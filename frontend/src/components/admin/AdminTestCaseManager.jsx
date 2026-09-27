import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Cpu,
  Eye,
  Shield,
  Search,
  Filter,
  Copy,
  ChevronDown,
  ChevronRight,
  Terminal,
  AlertTriangle,
  RefreshCw,
  FolderTree,
} from 'lucide-react';

/**
 * AdminTestCaseManager - Test Case Management Component (Phase 7.4.6)
 * 
 * Reusable test case management interface integrated into the Shared Problem Editor.
 * Supports:
 * - Visual tree-like hierarchy (Sample vs Hidden Test Cases)
 * - Administrative viewing of all test cases (with inputs, outputs, limits, order)
 * - Adding new test cases (Sample or Hidden)
 * - Editing existing test cases with atomic isolation
 * - Deleting test cases with confirmation modal
 * - Dual-mode compatibility:
 *    • Edit Mode: Direct authoritative API integration (GET/POST/PUT/DELETE)
 *    • Create Mode: In-memory collection submitted atomically with new problem
 */
export default function AdminTestCaseManager({
  problemId = null,
  mode = 'create', // 'create' | 'edit'
  token = '',
  codingMode = 'function',
  localTestCases = [],
  onLocalTestCasesChange,
}) {
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(mode === 'edit' && Boolean(problemId));
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'sample' | 'hidden'
  const [searchQuery, setSearchQuery] = useState('');

  // Active form modal state for Add / Edit
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTestCase, setEditingTestCase] = useState(null); // null for Add, or testCase object for Edit
  const [formData, setFormData] = useState({
    inputData: '',
    expectedOutput: '',
    isHidden: false,
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testOrder: 1,
  });
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation modal state
  const [deleteModalState, setDeleteModalState] = useState({
    isOpen: false,
    testCaseId: null,
    testOrder: null,
    isDeleting: false,
  });

  // Copied feedback tooltip
  const [copiedId, setCopiedId] = useState(null);

  // Fetch test cases in Edit Mode
  const fetchTestCases = async () => {
    if (mode !== 'edit' || !problemId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/problems/${problemId}/test-cases`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to load test cases.');
      }

      const data = await res.json();
      const list = data.testCases || [];
      setTestCases(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'edit' && problemId) {
      fetchTestCases();
    } else {
      // In create mode, use parent's local test cases or initialize
      setTestCases(localTestCases || []);
      setLoading(false);
    }
  }, [mode, problemId, token]);

  // Sync to parent when local test cases change in Create Mode
  const updateLocalCases = (newCases) => {
    setTestCases(newCases);
    if (onLocalTestCasesChange) {
      onLocalTestCasesChange(newCases);
    }
  };

  // Metrics computation
  const metrics = useMemo(() => {
    const total = testCases.length;
    const sampleCount = testCases.filter((tc) => !tc.isHidden && !tc.is_hidden).length;
    const hiddenCount = testCases.filter((tc) => Boolean(tc.isHidden ?? tc.is_hidden)).length;
    return { total, sampleCount, hiddenCount };
  }, [testCases]);

  // Filtered & searched test cases
  const filteredTestCases = useMemo(() => {
    return testCases.filter((tc) => {
      const isHidden = Boolean(tc.isHidden ?? tc.is_hidden);
      if (filterType === 'sample' && isHidden) return false;
      if (filterType === 'hidden' && !isHidden) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const input = (tc.inputData || tc.input_data || '').toLowerCase();
        const output = (tc.expectedOutput || tc.expected_output || '').toLowerCase();
        return input.includes(q) || output.includes(q);
      }
      return true;
    });
  }, [testCases, filterType, searchQuery]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setEditingTestCase(null);
    const nextOrder = testCases.length > 0
      ? Math.max(...testCases.map((tc) => tc.testOrder || tc.test_order || tc.orderIndex || 1)) + 1
      : 1;

    setFormData({
      inputData: '',
      expectedOutput: '',
      isHidden: false,
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      testOrder: nextOrder,
    });
    setFormErrors({});
    setIsFormOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (tc) => {
    setEditingTestCase(tc);
    setFormData({
      inputData: tc.inputData ?? tc.input_data ?? '',
      expectedOutput: tc.expectedOutput ?? tc.expected_output ?? '',
      isHidden: Boolean(tc.isHidden ?? tc.is_hidden),
      timeLimitMs: tc.timeLimitMs ?? tc.time_limit_ms ?? 2000,
      memoryLimitMb: tc.memoryLimitMb ?? tc.memory_limit_mb ?? 256,
      testOrder: tc.testOrder ?? tc.test_order ?? tc.orderIndex ?? 1,
    });
    setFormErrors({});
    setIsFormOpen(true);
  };

  // Validate form
  const validateForm = () => {
    const errs = {};
    if (!formData.expectedOutput.trim()) {
      errs.expectedOutput = 'Expected output is required.';
    }
    if (formData.timeLimitMs < 100 || formData.timeLimitMs > 15000) {
      errs.timeLimitMs = 'Time limit must be between 100 and 15000 ms.';
    }
    if (formData.memoryLimitMb < 16 || formData.memoryLimitMb > 1024) {
      errs.memoryLimitMb = 'Memory limit must be between 16 and 1024 MB.';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Submit Add / Edit
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setError(null);

    const payload = {
      inputData: formData.inputData,
      expectedOutput: formData.expectedOutput,
      isHidden: formData.isHidden,
      isSample: !formData.isHidden,
      timeLimitMs: parseInt(formData.timeLimitMs, 10) || 2000,
      memoryLimitMb: parseInt(formData.memoryLimitMb, 10) || 256,
      testOrder: parseInt(formData.testOrder, 10) || 1,
    };

    try {
      if (mode === 'edit' && problemId) {
        if (editingTestCase) {
          // Edit existing test case
          const res = await fetch(`/api/test-cases/${editingTestCase.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.message || 'Failed to update test case.');
          }

          const updatedItem = data.testCase || { ...editingTestCase, ...payload };
          setTestCases((prev) =>
            prev.map((item) => (item.id === editingTestCase.id ? updatedItem : item))
          );
          setSuccessMsg(`Test Case #${payload.testOrder} updated successfully.`);
        } else {
          // Create new test case for problem
          const res = await fetch(`/api/problems/${problemId}/test-cases`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.message || 'Failed to create test case.');
          }

          const newItem = data.testCase || payload;
          setTestCases((prev) => [...prev, newItem]);
          setSuccessMsg(`Test Case #${payload.testOrder} added successfully.`);
        }
      } else {
        // Create Mode (local memory collection)
        if (editingTestCase) {
          const updated = testCases.map((tc, idx) =>
            (tc.id === editingTestCase.id || idx === editingTestCase._localIndex)
              ? { ...tc, ...payload }
              : tc
          );
          updateLocalCases(updated);
          setSuccessMsg(`Test Case #${payload.testOrder} updated in draft.`);
        } else {
          const newLocalItem = {
            id: `draft-${Date.now()}`,
            _localIndex: testCases.length,
            ...payload,
          };
          updateLocalCases([...testCases, newLocalItem]);
          setSuccessMsg(`Test Case #${payload.testOrder} added to draft.`);
        }
      }

      setIsFormOpen(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Delete Confirmation Modal
  const handlePromptDelete = (tc) => {
    setDeleteModalState({
      isOpen: true,
      testCaseId: tc.id,
      testOrder: tc.testOrder || tc.test_order || tc.orderIndex || 1,
      isDeleting: false,
    });
  };

  // Confirm and Execute Deletion
  const handleConfirmDelete = async () => {
    const { testCaseId } = deleteModalState;
    if (!testCaseId) return;

    setDeleteModalState((prev) => ({ ...prev, isDeleting: true }));
    setError(null);

    try {
      if (mode === 'edit' && problemId && !String(testCaseId).startsWith('draft-')) {
        const res = await fetch(`/api/test-cases/${testCaseId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || 'Failed to delete test case.');
        }

        setTestCases((prev) => prev.filter((tc) => tc.id !== testCaseId));
        setSuccessMsg(`Test case deleted successfully.`);
      } else {
        // Create Mode deletion
        const updated = testCases.filter((tc) => tc.id !== testCaseId);
        updateLocalCases(updated);
        setSuccessMsg('Test case removed from draft.');
      }

      setDeleteModalState({ isOpen: false, testCaseId: null, testOrder: null, isDeleting: false });
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err.message);
      setDeleteModalState((prev) => ({ ...prev, isDeleting: false }));
    }
  };

  // Copy text helper
  const handleCopyContent = (text, id) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className="test-case-manager-container" data-testid="admin-test-case-manager">
      {/* 1. Header & Actions Bar */}
      <div className="tc-header-row">
        <div>
          <h3 className="tc-heading">
            <Database size={18} className="tc-heading-icon" /> Test Case Management
          </h3>
          <p className="tc-subheading">
            Define public sample cases visible to students and confidential evaluation cases for authoritative grading.
          </p>
        </div>

        <button
          className="btn-primary tc-add-btn"
          onClick={handleOpenAddModal}
          data-testid="add-test-case-btn"
        >
          <Plus size={15} /> Add Test Case
        </button>
      </div>

      {/* 2. Visual Hierarchy & Breakdown Tree Card */}
      <div className="tc-tree-card" data-testid="test-cases-tree-card">
        <div className="tc-tree-header">
          <FolderTree size={16} className="text-sky-400" />
          <span className="tc-tree-title">Test Cases Architecture Tree</span>
        </div>
        <div className="tc-tree-view font-mono">
          <div className="tc-tree-root">
            <strong>Test Cases</strong> <span className="tc-tree-count">({metrics.total} total)</span>
          </div>
          <div className="tc-tree-branch">
            <span className="tc-tree-line">├──</span>
            <span className="tc-badge-sample">
              <Eye size={12} /> Public Sample Cases ({metrics.sampleCount})
            </span>
            <span className="tc-tree-desc">— Visible in problem statement & runner</span>
          </div>
          <div className="tc-tree-branch">
            <span className="tc-tree-line">└──</span>
            <span className="tc-badge-hidden">
              <Shield size={12} /> Confidential Hidden Cases ({metrics.hiddenCount})
            </span>
            <span className="tc-tree-desc">— Authoritative judge evaluation only</span>
          </div>
        </div>
      </div>

      {/* Success / Error Banners */}
      {successMsg && (
        <div className="tc-alert-banner success" data-testid="tc-success-banner">
          <CheckCircle2 size={16} /> <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="tc-alert-banner error" data-testid="tc-error-banner">
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}

      {/* 3. Controls & Filter Bar */}
      <div className="tc-toolbar">
        <div className="tc-filter-tabs">
          <button
            className={`tc-filter-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
            data-testid="filter-all-btn"
          >
            All Cases ({metrics.total})
          </button>
          <button
            className={`tc-filter-btn ${filterType === 'sample' ? 'active' : ''}`}
            onClick={() => setFilterType('sample')}
            data-testid="filter-sample-btn"
          >
            <Eye size={13} /> Samples ({metrics.sampleCount})
          </button>
          <button
            className={`tc-filter-btn ${filterType === 'hidden' ? 'active' : ''}`}
            onClick={() => setFilterType('hidden')}
            data-testid="filter-hidden-btn"
          >
            <Shield size={13} /> Hidden ({metrics.hiddenCount})
          </button>
        </div>

        <div className="tc-search-box">
          <Search size={14} className="tc-search-icon" />
          <input
            type="text"
            placeholder="Search test case content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="tc-search-input"
            data-testid="tc-search-input"
          />
        </div>
      </div>

      {/* 4. Test Cases List / Table */}
      {loading ? (
        <div className="tc-loading-box" data-testid="tc-loading-state">
          <RefreshCw size={24} className="animate-spin text-sky-400" />
          <p>Loading test cases from repository...</p>
        </div>
      ) : filteredTestCases.length === 0 ? (
        <div className="tc-empty-state" data-testid="tc-empty-state">
          <Database size={32} className="tc-empty-icon" />
          <h4>No test cases found</h4>
          <p>
            {searchQuery
              ? 'No test cases match your search criteria.'
              : filterType !== 'all'
              ? `No ${filterType} test cases configured for this problem yet.`
              : 'Add sample test cases for students and hidden test cases for judge grading.'}
          </p>
          <button
            className="btn-primary tc-empty-add-btn"
            onClick={handleOpenAddModal}
            data-testid="empty-add-test-case-btn"
          >
            <Plus size={14} /> Add First Test Case
          </button>
        </div>
      ) : (
        <div className="tc-cards-list" data-testid="test-cases-list">
          {filteredTestCases.map((tc, index) => {
            const isHidden = Boolean(tc.isHidden ?? tc.is_hidden);
            const orderNum = tc.testOrder ?? tc.test_order ?? tc.orderIndex ?? (index + 1);
            const inputVal = tc.inputData ?? tc.input_data ?? '';
            const outputVal = tc.expectedOutput ?? tc.expected_output ?? '';
            const timeLimit = tc.timeLimitMs ?? tc.time_limit_ms ?? 2000;
            const memoryLimit = tc.memoryLimitMb ?? tc.memory_limit_mb ?? 256;

            return (
              <div
                key={tc.id || index}
                className={`tc-item-card ${isHidden ? 'is-hidden-card' : 'is-sample-card'}`}
                data-testid={`test-case-card-${tc.id || index}`}
              >
                {/* Card Top Row */}
                <div className="tc-item-header">
                  <div className="tc-item-identity">
                    <span className="tc-order-pill">#{orderNum}</span>
                    {isHidden ? (
                      <span className="tc-badge-hidden" data-testid="badge-hidden">
                        <Shield size={12} /> Confidential Hidden
                      </span>
                    ) : (
                      <span className="tc-badge-sample" data-testid="badge-sample">
                        <Eye size={12} /> Public Sample
                      </span>
                    )}

                    <span className="tc-limit-tag" title="Execution Limits">
                      <Clock size={11} /> {timeLimit}ms
                    </span>
                    <span className="tc-limit-tag" title="Memory Limit">
                      <Cpu size={11} /> {memoryLimit}MB
                    </span>
                  </div>

                  <div className="tc-item-actions">
                    <button
                      className="tc-action-btn edit"
                      onClick={() => handleOpenEditModal(tc)}
                      title="Edit Test Case"
                      data-testid={`edit-tc-btn-${tc.id || index}`}
                    >
                      <Edit2 size={13} /> Edit
                    </button>
                    <button
                      className="tc-action-btn delete"
                      onClick={() => handlePromptDelete(tc)}
                      title="Delete Test Case"
                      data-testid={`delete-tc-btn-${tc.id || index}`}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>

                {/* Card Code Grid: Input & Output */}
                <div className="tc-io-grid">
                  <div className="tc-io-block">
                    <div className="tc-io-header">
                      <span className="tc-io-title">Input</span>
                      <button
                        className="tc-copy-btn"
                        onClick={() => handleCopyContent(inputVal, `in-${tc.id || index}`)}
                        title="Copy Input"
                      >
                        <Copy size={11} />
                        {copiedId === `in-${tc.id || index}` ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="tc-io-code font-mono" data-testid="tc-input-preview">
                      {inputVal ? inputVal : <span className="tc-empty-val">(no input required)</span>}
                    </pre>
                  </div>

                  <div className="tc-io-block">
                    <div className="tc-io-header">
                      <span className="tc-io-title">Expected Output</span>
                      <button
                        className="tc-copy-btn"
                        onClick={() => handleCopyContent(outputVal, `out-${tc.id || index}`)}
                        title="Copy Output"
                      >
                        <Copy size={11} />
                        {copiedId === `out-${tc.id || index}` ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="tc-io-code font-mono" data-testid="tc-output-preview">
                      {outputVal ? outputVal : <span className="tc-empty-val">(empty)</span>}
                    </pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Add / Edit Test Case Modal Form */}
      {isFormOpen && (
        <div className="tc-modal-overlay" data-testid="tc-form-modal">
          <div className="tc-modal-card">
            <div className="tc-modal-header">
              <h4>{editingTestCase ? `Edit Test Case #${formData.testOrder}` : 'Add New Test Case'}</h4>
              <button
                className="tc-modal-close"
                onClick={() => setIsFormOpen(false)}
                disabled={isSubmitting}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="tc-modal-form">
              {/* Classification Selector */}
              <div className="tc-form-group">
                <label className="tc-label">Visibility / Classification <span className="req">*</span></label>
                <div className="tc-class-toggle-grid">
                  <label
                    className={`tc-class-option ${!formData.isHidden ? 'selected sample' : ''}`}
                    onClick={() => setFormData({ ...formData, isHidden: false })}
                    data-testid="radio-sample-type"
                  >
                    <input
                      type="radio"
                      name="classification"
                      checked={!formData.isHidden}
                      onChange={() => setFormData({ ...formData, isHidden: false })}
                      className="sr-only"
                    />
                    <Eye size={16} />
                    <div>
                      <strong>Public Sample Case</strong>
                      <p>Visible to students in statement and runner testing</p>
                    </div>
                  </label>

                  <label
                    className={`tc-class-option ${formData.isHidden ? 'selected hidden' : ''}`}
                    onClick={() => setFormData({ ...formData, isHidden: true })}
                    data-testid="radio-hidden-type"
                  >
                    <input
                      type="radio"
                      name="classification"
                      checked={formData.isHidden}
                      onChange={() => setFormData({ ...formData, isHidden: true })}
                      className="sr-only"
                    />
                    <Shield size={16} />
                    <div>
                      <strong>Confidential Hidden Case</strong>
                      <p>Strictly isolated from candidates; used for grading</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Input Data */}
              <div className="tc-form-group">
                <label className="tc-label">
                  Input Data
                  <span className="tc-label-hint">Passed to stdin / harness driver</span>
                </label>
                <textarea
                  rows={4}
                  value={formData.inputData}
                  onChange={(e) => setFormData({ ...formData, inputData: e.target.value })}
                  placeholder="e.g. 5&#10;1 2 3 4 5"
                  className="tc-textarea font-mono"
                  data-testid="input-test-case-data"
                />
              </div>

              {/* Expected Output */}
              <div className="tc-form-group">
                <label className="tc-label">
                  Expected Output <span className="req">*</span>
                  <span className="tc-label-hint">Expected stdout result</span>
                </label>
                <textarea
                  rows={4}
                  value={formData.expectedOutput}
                  onChange={(e) => setFormData({ ...formData, expectedOutput: e.target.value })}
                  placeholder="e.g. 15"
                  className={`tc-textarea font-mono ${formErrors.expectedOutput ? 'invalid' : ''}`}
                  data-testid="input-test-case-output"
                />
                {formErrors.expectedOutput && (
                  <span className="tc-field-error" data-testid="error-expected-output">{formErrors.expectedOutput}</span>
                )}
              </div>

              {/* Limits and Order row */}
              <div className="tc-form-row">
                <div className="tc-form-group">
                  <label className="tc-label">
                    <Clock size={12} /> Time Limit (ms)
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={15000}
                    step={100}
                    value={formData.timeLimitMs}
                    onChange={(e) => setFormData({ ...formData, timeLimitMs: parseInt(e.target.value, 10) || 2000 })}
                    className={`tc-input ${formErrors.timeLimitMs ? 'invalid' : ''}`}
                    data-testid="input-time-limit"
                  />
                  {formErrors.timeLimitMs && (
                    <span className="tc-field-error">{formErrors.timeLimitMs}</span>
                  )}
                </div>

                <div className="tc-form-group">
                  <label className="tc-label">
                    <Cpu size={12} /> Memory Limit (MB)
                  </label>
                  <input
                    type="number"
                    min={16}
                    max={1024}
                    step={32}
                    value={formData.memoryLimitMb}
                    onChange={(e) => setFormData({ ...formData, memoryLimitMb: parseInt(e.target.value, 10) || 256 })}
                    className={`tc-input ${formErrors.memoryLimitMb ? 'invalid' : ''}`}
                    data-testid="input-memory-limit"
                  />
                  {formErrors.memoryLimitMb && (
                    <span className="tc-field-error">{formErrors.memoryLimitMb}</span>
                  )}
                </div>

                <div className="tc-form-group">
                  <label className="tc-label">Order Index</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={formData.testOrder}
                    onChange={(e) => setFormData({ ...formData, testOrder: parseInt(e.target.value, 10) || 1 })}
                    className="tc-input"
                    data-testid="input-test-order"
                  />
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="tc-modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSubmitting}
                  data-testid="tc-cancel-form-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmitting}
                  data-testid="tc-submit-form-btn"
                >
                  {isSubmitting
                    ? 'Saving...'
                    : editingTestCase
                    ? 'Update Test Case'
                    : 'Add Test Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Delete Confirmation Modal (Step 6) */}
      {deleteModalState.isOpen && (
        <div className="tc-modal-overlay" data-testid="tc-delete-modal">
          <div className="tc-delete-card">
            <div className="tc-delete-icon-wrap">
              <AlertTriangle size={28} className="tc-delete-warn-icon" />
            </div>
            <h4 className="tc-delete-title">Delete Test Case?</h4>
            <p className="tc-delete-desc">
              This action cannot be undone. Test case #{deleteModalState.testOrder} will be permanently removed from this problem.
            </p>

            <div className="tc-delete-actions">
              <button
                className="btn-secondary"
                onClick={() => setDeleteModalState({ isOpen: false, testCaseId: null, testOrder: null, isDeleting: false })}
                disabled={deleteModalState.isDeleting}
                data-testid="tc-delete-cancel-btn"
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleteModalState.isDeleting}
                data-testid="tc-delete-confirm-btn"
              >
                {deleteModalState.isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
