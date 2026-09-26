import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  FileCode2,
  Settings2,
  Code2,
  Terminal,
  Database,
  CheckCircle2,
  AlertTriangle,
  Save,
  X,
  Layers,
  Sparkles,
  Shield,
  HelpCircle,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import './adminProblemManagement.css';

/**
 * Shared Admin Problem Editor Architecture Shell (Phase 7.4.1)
 * 
 * Supports dual operational modes:
 * - Create Mode: Provision new problem draft (/admin/problems/new)
 * - Edit Mode: Inspect and modify existing problem (/admin/problems/:id/edit)
 * 
 * Establishes architectural boundaries for:
 * 1. Metadata & Scoping (Title, Difficulty, Public vs Contest-Private)
 * 2. Coding Architecture (Standard OJ Full Program vs Function Mode)
 * 3. Starter & Harness Templates (Language integration)
 * 4. Test Case Management Boundary (Sample vs Hidden Test Cases)
 * 5. Lifecycle & Versioning (Draft, Review, Publication)
 */
export default function AdminProblemEditor({
  mode = 'create', // 'create' | 'edit'
  problemId = null,
  onBack,
  token,
  currentUser,
}) {
  const [activeTab, setActiveTab] = useState('metadata'); // 'metadata' | 'coding_mode' | 'templates' | 'test_cases' | 'review'
  const [loading, setLoading] = useState(mode === 'edit');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Problem Draft State Foundation
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    difficulty: 'medium',
    codingMode: 'function', // 'full_program' | 'function'
    accessScope: 'public', // 'public' | 'contest_private'
    version: 1,
    reviewStatus: 'draft',
    starterTemplates: {
      cpp: '// C++ Solution',
      python: '# Python Solution',
      java: '// Java Solution',
    },
    harnessTemplates: {},
  });

  // Fetch problem details if in edit mode
  useEffect(() => {
    if (mode === 'edit' && problemId) {
      let isMounted = true;
      setLoading(true);
      setError(null);

      fetch(`/api/admin/problems/${problemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || `Problem #${problemId} not found`);
          }
          return res.json();
        })
        .then((json) => {
          if (!isMounted) return;
          const p = json.data?.problem || json.problem || json;
          setFormData({
            title: p.title || '',
            description: p.description || '',
            difficulty: p.difficulty || 'medium',
            codingMode: p.codingMode || p.coding_mode || 'function',
            accessScope: p.accessScope || p.access_scope || 'public',
            version: p.version || 1,
            reviewStatus: p.reviewStatus || p.review_status || 'draft',
            starterTemplates: p.starterTemplates || p.starter_templates || {},
            harnessTemplates: p.harnessTemplates || p.harness_templates || {},
          });
        })
        .catch((err) => {
          if (isMounted) setError(err.message);
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      return () => { isMounted = false; };
    } else {
      setLoading(false);
    }
  }, [mode, problemId, token]);

  const handleSaveDraft = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const endpoint = mode === 'edit' ? `/api/problems/${problemId}` : '/api/problems';
      const method = mode === 'edit' ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || `Failed to ${mode === 'edit' ? 'update' : 'create'} problem`);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="problem-editor-shell" data-testid="admin-problem-editor">
        <AuthoringLoadingState message={`Loading Problem #${problemId} for administrative editing...`} />
      </div>
    );
  }

  if (error && mode === 'edit') {
    return (
      <div className="problem-editor-shell" data-testid="admin-problem-editor">
        <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '24px', textAlign: 'center' }}>
          <AlertTriangle size={36} style={{ color: '#f87171', margin: '0 auto 10px auto', display: 'block' }} />
          <h3 style={{ margin: '0 0 6px 0', color: '#fca5a5', fontSize: '1.1rem' }}>Problem Not Accessible</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#cbd5e1' }}>{error}</p>
          <button className="editor-back-btn" onClick={onBack} data-testid="editor-back-btn">
            <ArrowLeft size={14} /> Back to Problems
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="problem-editor-shell" data-testid="admin-problem-editor">
      {/* 1. Editor Header Bar */}
      <div className="editor-header-nav">
        <div className="editor-header-left">
          <button className="editor-back-btn" onClick={onBack} data-testid="editor-back-btn" title="Return to Problem Directory">
            <ArrowLeft size={15} /> Problems
          </button>

          <div className="editor-title-wrap">
            <h2>
              {mode === 'create' ? 'Add New Problem' : `Edit Problem #${problemId}`}
              <span className={`editor-mode-badge ${mode}`} data-testid="editor-mode-badge">
                {mode === 'create' ? 'Create Mode' : 'Edit Mode'}
              </span>
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {saveSuccess && (
            <span style={{ fontSize: '0.82rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={15} /> Saved successfully!
            </span>
          )}

          <button className="btn-secondary" onClick={onBack} disabled={isSaving}>
            Cancel
          </button>

          <button
            className="btn-primary"
            onClick={handleSaveDraft}
            disabled={isSaving}
            data-testid="editor-save-btn"
          >
            <Save size={15} /> {isSaving ? 'Saving...' : mode === 'create' ? 'Save Draft' : 'Save Changes'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', padding: '10px 16px', color: '#fca5a5', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* 2. Architecture Navigation & Workspace Grid */}
      <div className="editor-architecture-grid">
        {/* Left Section Navigation */}
        <aside className="editor-section-nav">
          <button
            className={`editor-nav-tab ${activeTab === 'metadata' ? 'active' : ''}`}
            onClick={() => setActiveTab('metadata')}
            data-testid="tab-metadata"
          >
            <Settings2 size={16} /> 1. Metadata & Scope
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'coding_mode' ? 'active' : ''}`}
            onClick={() => setActiveTab('coding_mode')}
            data-testid="tab-coding-mode"
          >
            <Code2 size={16} /> 2. Coding Architecture
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'templates' ? 'active' : ''}`}
            onClick={() => setActiveTab('templates')}
            data-testid="tab-templates"
          >
            <Terminal size={16} /> 3. Starter & Harness
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'test_cases' ? 'active' : ''}`}
            onClick={() => setActiveTab('test_cases')}
            data-testid="tab-test-cases"
          >
            <Database size={16} /> 4. Test Case Boundary
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'review' ? 'active' : ''}`}
            onClick={() => setActiveTab('review')}
            data-testid="tab-review"
          >
            <Shield size={16} /> 5. Lifecycle & Review
          </button>
        </aside>

        {/* Right Section Content Card */}
        <div className="editor-content-card">
          {/* TAB 1: METADATA & SCOPE */}
          {activeTab === 'metadata' && (
            <div>
              <h3>Problem Metadata & Access Scope</h3>
              <p className="editor-content-subtitle">
                Configure primary title, problem difficulty rating, and visibility across the platform.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                    Problem Title *
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Invert Binary Tree, Optimal Matrix Multiplication"
                    style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    data-testid="problem-title-input"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                      Difficulty Level
                    </label>
                    <select
                      value={formData.difficulty}
                      onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
                      data-testid="problem-difficulty-select"
                    >
                      <option value="easy">Easy (Fundamentals & Direct Logic)</option>
                      <option value="medium">Medium (Data Structures & Algorithmic Optimizations)</option>
                      <option value="hard">Hard (Advanced Dynamic Programming & Graph Theory)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                      Access Scope
                    </label>
                    <select
                      value={formData.accessScope}
                      onChange={(e) => setFormData({ ...formData, accessScope: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
                      data-testid="problem-scope-select"
                    >
                      <option value="public">Public (Visible across platform Practice Explorer)</option>
                      <option value="contest_private">Contest Private (Restricted to assigned contest examinations)</option>
                      <option value="class">Classroom (Faculty managed group)</option>
                      <option value="institution">Institution Only</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                    Problem Statement & Specifications
                  </label>
                  <textarea
                    rows={6}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter comprehensive problem description, input/output formats, constraints, and sample explanations..."
                    style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    data-testid="problem-description-input"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CODING ARCHITECTURE */}
          {activeTab === 'coding_mode' && (
            <div>
              <h3>Coding Architecture & Evaluation Mode</h3>
              <p className="editor-content-subtitle">
                Select between Standard Online Judge (Full Program) or LeetCode-style Function Mode.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div
                  onClick={() => setFormData({ ...formData, codingMode: 'function' })}
                  style={{
                    border: formData.codingMode === 'function' ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.12)',
                    background: formData.codingMode === 'function' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(30, 41, 59, 0.4)',
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  data-testid="mode-card-function"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Code2 size={20} style={{ color: '#c084fc' }} />
                    <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>Function Mode</span>
                    {formData.codingMode === 'function' && <span className="architecture-tag">Selected</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                    Candidates implement a single solution class/method (`class Solution`). The backend judge automatically links a trusted harness (`harnessBuilder.js`) for stdin parsing and output serialization.
                  </p>
                </div>

                <div
                  onClick={() => setFormData({ ...formData, codingMode: 'full_program' })}
                  style={{
                    border: formData.codingMode === 'full_program' ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.12)',
                    background: formData.codingMode === 'full_program' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(30, 41, 59, 0.4)',
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  data-testid="mode-card-full-program"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Terminal size={20} style={{ color: '#38bdf8' }} />
                    <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>Standard OJ (Full Program)</span>
                    {formData.codingMode === 'full_program' && <span className="architecture-tag">Selected</span>}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                    Traditional competitive programming workflow. Candidate writes a complete executable program with `main()`, custom I/O handling, and full control of standard streams.
                  </p>
                </div>
              </div>

              <div className="architecture-placeholder-box">
                <p>
                  <strong>Execution Subsystem Contract:</strong> All untrusted student submissions run in sandboxed Docker/Process isolation with hard wall-clock and memory caps (512 KB output buffer, non-root user).
                </p>
                <span className="architecture-tag">Phase 7.4.1 Architectural Integration Gate</span>
              </div>
            </div>
          )}

          {/* TAB 3: STARTER & HARNESS TEMPLATES */}
          {activeTab === 'templates' && (
            <div>
              <h3>Starter Code & Harness Templates Boundary</h3>
              <p className="editor-content-subtitle">
                Define boilerplate starter templates provided to candidates across C++, Python, and Java.
              </p>

              <div className="architecture-placeholder-box" style={{ padding: '36px' }}>
                <Terminal size={32} style={{ color: '#38bdf8', opacity: 0.8 }} />
                <p>
                  <strong>Template Authoring Studio Foundation:</strong> In Phase 7.4.2+, administrators will be able to edit multi-language starter code and test harness overrides directly in Monaco Editor.
                </p>
                <span className="architecture-tag">Integration Point: harnessBuilder.js (C++, Python, Java)</span>
              </div>
            </div>
          )}

          {/* TAB 4: TEST CASE BOUNDARY */}
          {activeTab === 'test_cases' && (
            <div>
              <h3>Test Case Management Boundary</h3>
              <p className="editor-content-subtitle">
                Manage visible sample test cases and confidential evaluation test cases.
              </p>

              <div className="architecture-placeholder-box" style={{ padding: '36px' }}>
                <Database size={32} style={{ color: '#fbbf24', opacity: 0.8 }} />
                <p>
                  <strong>Test Case Management Foundation:</strong> Full test-case upload, automated generator, and execution verifier will be integrated in Phase 7.4.2.
                </p>
                <span className="architecture-tag">Integration Point: /api/problems/:problemId/test-cases</span>
              </div>
            </div>
          )}

          {/* TAB 5: LIFECYCLE & REVIEW */}
          {activeTab === 'review' && (
            <div>
              <h3>Problem Governance & Lifecycle State</h3>
              <p className="editor-content-subtitle">
                Review queue status, version history, and publication locks.
              </p>

              <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Current Lifecycle Status:</span>
                  <span style={{ fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', fontSize: '0.8rem', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                    {formData.reviewStatus}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Version Number:</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.85rem' }}>
                    v{formData.version}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Authoring Role:</span>
                  <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>
                    {currentUser?.username || 'Super Admin'} ({currentUser?.role || 'super_admin'})
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
