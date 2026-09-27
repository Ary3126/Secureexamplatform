import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Settings2,
  Code2,
  Terminal,
  Database,
  CheckCircle2,
  AlertTriangle,
  Save,
  Layers,
  Sparkles,
  Shield,
  HelpCircle,
  Cpu,
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Eye,
  FileText,
  AlertCircle,
  Hash,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import AdminTestCaseManager from './AdminTestCaseManager';
import './adminProblemManagement.css';

/**
 * Shared Admin Problem Editor Architecture (Phase 7.4.3)
 * 
 * Used for both:
 * - Create Mode: /admin/problems/new
 * - Edit Mode: /admin/problems/:id/edit
 * 
 * Reusable Sections:
 * 1. Basic Information (Title, Description, Difficulty, Tags, Constraints)
 * 2. Examples (Input, Output, Explanation)
 * 3. Coding Configuration (Standard OJ vs Function Mode)
 * 4. Language Configuration (Supported languages & starter code templates)
 * 5. Function Mode / DSL Configuration (Function name, return type, parameters, harness templates)
 * 6. Test Case Section Foundation (Sample vs Hidden Test Cases boundary)
 * 7. Execution Configuration (Time limit, Memory limit, Output limit, Versioning & Governance)
 */

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  validateProblemForm,
} from './adminProblemEditorConstants.js';

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  validateProblemForm,
};

export default function AdminProblemEditor({
  mode = 'create', // 'create' | 'edit'
  problemId = null,
  onBack,
  onSaved,
  token,
  currentUser,
}) {
  const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'examples' | 'coding_mode' | 'languages' | 'function_dsl' | 'test_cases' | 'execution'
  const [selectedLanguage, setSelectedLanguage] = useState('python');
  const [statementPreview, setStatementPreview] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);

  // Form State Foundation
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    difficulty: 'medium',
    codingMode: 'function',
    accessScope: 'public',
    tags: 'algorithms',
    constraints: '1 <= nums.length <= 10^5\n-10^9 <= nums[i] <= 10^9',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    outputLimitKb: 512,
    version: 1,
    reviewStatus: 'draft',
    functionConfig: {
      functionName: 'solve',
      returnType: 'int',
      parameters: 'vector<int>& nums',
    },
    examples: [
      {
        id: 1,
        input: '5\n1 2 3 4 5',
        output: '15',
        explanation: 'The sum of elements is 1 + 2 + 3 + 4 + 5 = 15.',
      },
    ],
    starterTemplates: { ...DEFAULT_STARTER_TEMPLATES.function },
    harnessTemplates: { ...DEFAULT_HARNESS_TEMPLATES },
    testCases: [],
  });

  // Track initial state for dirty detection
  const [initialData, setInitialData] = useState(null);

  // Determine if form is dirty (unsaved changes)
  const isDirty = useMemo(() => {
    if (!initialData) return false;
    return JSON.stringify(formData) !== JSON.stringify(initialData);
  }, [formData, initialData]);

  // Load problem details if in edit mode
  useEffect(() => {
    if (mode === 'edit') {
      const idStr = String(problemId || '').trim();
      if (!idStr || !/^\d+$/.test(idStr) || parseInt(idStr, 10) <= 0) {
        setError(`Invalid problem ID format: "${problemId}". Problem ID must be a positive integer.`);
        setLoading(false);
        return;
      }

      let isMounted = true;
      setLoading(true);
      setError(null);

      fetch(`/api/admin/problems/${idStr}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || `Problem #${problemId} not found in database.`);
          }
          return res.json();
        })
        .then((json) => {
          if (!isMounted) return;
          const p = json.data?.problem || json.problem || json;
          const sampleCases = p.sampleTestCases || [];

          // Reconstitute examples from sampleTestCases if available
          const loadedExamples = sampleCases.length > 0
            ? sampleCases.map((tc, idx) => ({
                id: tc.id || idx + 1,
                input: tc.inputData || '',
                output: tc.expectedOutput || '',
                explanation: tc.explanation || `Sample test case ${idx + 1}`,
              }))
            : [
                {
                  id: 1,
                  input: '5\n1 2 3 4 5',
                  output: '15',
                  explanation: 'Standard sample test case.',
                },
              ];

          const loadedData = {
            title: p.title || '',
            description: p.description || '',
            difficulty: p.difficulty || 'medium',
            codingMode: p.codingMode || p.coding_mode || 'function',
            accessScope: p.accessScope || p.access_scope || 'public',
            tags: p.tags || 'algorithms',
            constraints: p.constraints || '1 <= nums.length <= 10^5\n-10^9 <= nums[i] <= 10^9',
            timeLimitMs: p.timeLimitMs || 2000,
            memoryLimitMb: p.memoryLimitMb || 256,
            outputLimitKb: 512,
            version: p.version || 1,
            reviewStatus: p.reviewStatus || p.review_status || 'draft',
            functionConfig: p.functionConfig || {
              functionName: 'solve',
              returnType: 'int',
              parameters: 'vector<int>& nums',
            },
            examples: loadedExamples,
            starterTemplates: {
              ...DEFAULT_STARTER_TEMPLATES[p.codingMode || 'function'],
              ...(p.starterTemplates || p.starter_templates || {}),
            },
            harnessTemplates: {
              ...DEFAULT_HARNESS_TEMPLATES,
              ...(p.harnessTemplates || p.harness_templates || {}),
            },
            testCases: loadedExamples.map((ex, i) => ({
              id: ex.id || `tc-${i + 1}`,
              inputData: ex.input || '',
              expectedOutput: ex.output || '',
              isHidden: false,
              isSample: true,
              testOrder: i + 1,
            })),
          };

          setFormData(loadedData);
          setInitialData(loadedData);
        })
        .catch((err) => {
          if (isMounted) setError(err.message);
        })
        .finally(() => {
          if (isMounted) setLoading(false);
        });

      return () => { isMounted = false; };
    } else {
      // Create mode
      setInitialData({ ...formData });
      setLoading(false);
    }
  }, [mode, problemId, token]);

  // Mode switcher handler (updates default templates if starter is unchanged)
  const handleCodingModeChange = (newMode) => {
    if (newMode === formData.codingMode) return;
    setFormData((prev) => ({
      ...prev,
      codingMode: newMode,
      starterTemplates: {
        ...DEFAULT_STARTER_TEMPLATES[newMode],
      },
    }));
  };

  // Add Example
  const handleAddExample = () => {
    const nextId = formData.examples.length + 1;
    setFormData((prev) => ({
      ...prev,
      examples: [
        ...prev.examples,
        {
          id: nextId,
          input: '',
          output: '',
          explanation: '',
        },
      ],
    }));
  };

  // Remove Example
  const handleRemoveExample = (idx) => {
    setFormData((prev) => ({
      ...prev,
      examples: prev.examples.filter((_, i) => i !== idx),
    }));
  };

  // Update Example Field
  const handleUpdateExample = (idx, field, val) => {
    setFormData((prev) => {
      const updated = [...prev.examples];
      updated[idx] = { ...updated[idx], [field]: val };
      return { ...prev, examples: updated };
    });
  };

  // Auto-generate starter & harness templates from Function Signature
  const handleGenerateFromSignature = () => {
    const fnName = formData.functionConfig.functionName.trim() || 'solve';
    const retType = formData.functionConfig.returnType.trim() || 'int';
    const params = formData.functionConfig.parameters.trim() || 'vector<int>& nums';

    const generatedStarter = {
      cpp: `#include <vector>\n#include <string>\nusing namespace std;\n\nclass Solution {\npublic:\n    ${retType} ${fnName}(${params}) {\n        // Implement solution here\n        return 0;\n    }\n};\n`,
      python: `class Solution:\n    def ${fnName}(self, nums: list[int]) -> int:\n        # Implement solution here\n        return 0\n`,
      java: `import java.util.*;\n\nclass Solution {\n    public ${retType} ${fnName}(int[] nums) {\n        // Implement solution here\n        return 0;\n    }\n}\n`,
      javascript: `/**\n * @return {${retType}}\n */\nfunction ${fnName}(nums) {\n    // Implement solution here\n    return 0;\n}\n`,
      c: `${retType} ${fnName}(int* nums, int numsSize) {\n    // Implement solution here\n    return 0;\n}\n`,
    };

    const generatedHarness = {
      cpp: `#include <iostream>\n#include <vector>\n#include <sstream>\n#include <string>\nusing namespace std;\n\n// __STUDENT_CODE__\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    string line;\n    if (getline(cin, line)) {\n        stringstream ss(line);\n        vector<int> nums;\n        int val;\n        while (ss >> val) nums.push_back(val);\n        Solution sol;\n        cout << sol.${fnName}(nums) << "\\n";\n    }\n    return 0;\n}\n`,
      python: `import sys\n\n# __STUDENT_CODE__\n\ndef _main():\n    raw = sys.stdin.read().split()\n    if not raw: return\n    sol = Solution()\n    print(sol.${fnName}([int(x) for x in raw]))\n\nif __name__ == '__main__':\n    _main()\n`,
      java: `import java.util.*;\n\n// __STUDENT_CODE__\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        List<Integer> list = new ArrayList<>();\n        while (sc.hasNextInt()) list.add(sc.nextInt());\n        int[] nums = new int[list.size()];\n        for (int i=0; i<list.size(); i++) nums[i] = list.get(i);\n        Solution sol = new Solution();\n        System.out.println(sol.${fnName}(nums));\n    }\n}\n`,
    };

    setFormData((prev) => ({
      ...prev,
      starterTemplates: { ...prev.starterTemplates, ...generatedStarter },
      harnessTemplates: { ...prev.harnessTemplates, ...generatedHarness },
    }));
  };

  // Safe navigation back
  const handleAttemptBack = () => {
    if (isDirty) {
      setShowUnsavedPrompt(true);
    } else {
      onBack?.();
    }
  };

  // Save Problem Action
  const handleSave = async () => {
    // 1. Run client-side validation
    const validation = validateProblemForm(formData);
    setValidationErrors(validation.errors);
    if (!validation.isValid) {
      setError('Please resolve the highlighted validation errors before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const endpoint = mode === 'edit' ? `/api/problems/${problemId}` : '/api/problems';
      const method = mode === 'edit' ? 'PUT' : 'POST';

      // Assemble test cases payload: use formData.testCases if configured, else fallback to examples
      const testCasesPayload = (formData.testCases && formData.testCases.length > 0)
        ? formData.testCases.map((tc, idx) => ({
            inputData: tc.inputData || '',
            expectedOutput: tc.expectedOutput || '',
            isSample: tc.isSample !== undefined ? tc.isSample : !tc.isHidden,
            isHidden: tc.isHidden !== undefined ? tc.isHidden : !tc.isSample,
            timeLimitMs: tc.timeLimitMs || formData.timeLimitMs,
            memoryLimitMb: tc.memoryLimitMb || formData.memoryLimitMb,
            testOrder: tc.testOrder || (idx + 1),
          }))
        : formData.examples.map((ex, idx) => ({
            inputData: ex.input || '',
            expectedOutput: ex.output || '',
            isSample: true,
            isHidden: false,
            timeLimitMs: formData.timeLimitMs,
            memoryLimitMb: formData.memoryLimitMb,
            testOrder: idx + 1,
          }));

      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        difficulty: formData.difficulty.toLowerCase(),
        codingMode: formData.codingMode.toLowerCase(),
        accessScope: formData.accessScope.toLowerCase(),
        starterTemplates: formData.starterTemplates,
        harnessTemplates: formData.harnessTemplates,
        testCases: testCasesPayload,
        version: formData.version,
      };

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(
            `Optimistic Concurrency Conflict: Problem version (v${formData.version}) has been superseded by another administrator (v${json.currentVersion || 'latest'}). Please reload to resolve.`
          );
        }
        throw new Error(json.message || `Failed to ${mode === 'edit' ? 'update' : 'create'} problem.`);
      }

      setSaveSuccess(true);
      const savedProblem = json.problem || json.data?.problem || json;
      if (savedProblem && savedProblem.version) {
        setFormData((prev) => ({ ...prev, version: savedProblem.version }));
      }
      setInitialData({ ...formData, version: savedProblem?.version || formData.version });

      if (onSaved) {
        onSaved(savedProblem);
      }

      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="problem-editor-shell" data-testid="admin-problem-editor">
        <AuthoringLoadingState message={`Loading Problem #${problemId} for administrative authoring...`} />
      </div>
    );
  }

  if (error && mode === 'edit' && !initialData) {
    return (
      <div className="problem-editor-shell" data-testid="admin-problem-editor">
        <div className="editor-error-banner" data-testid="problem-not-found-card">
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
      <header className="editor-header-nav">
        <div className="editor-header-left">
          <button
            className="editor-back-btn"
            onClick={handleAttemptBack}
            data-testid="editor-back-btn"
            title="Return to Problem Directory"
          >
            <ArrowLeft size={15} /> Problems
          </button>

          <div className="editor-title-wrap">
            <h2>
              {mode === 'create' ? 'Create Problem' : `Edit Problem #${problemId}`}
              <span className={`editor-mode-badge ${mode}`} data-testid="editor-mode-badge">
                {mode === 'create' ? 'Create Mode' : 'Edit Mode'}
              </span>
              {mode === 'edit' && (
                <span className="editor-version-badge" data-testid="editor-version-badge">
                  v{formData.version}
                </span>
              )}
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isDirty && (
            <span className="editor-dirty-indicator" data-testid="editor-dirty-indicator">
              <span className="dirty-dot" /> Unsaved Changes
            </span>
          )}

          {saveSuccess && (
            <span className="editor-save-success" data-testid="editor-save-success">
              <CheckCircle2 size={15} /> Saved successfully!
            </span>
          )}

          <button
            className="btn-secondary"
            onClick={handleAttemptBack}
            disabled={isSaving}
            data-testid="editor-cancel-btn"
          >
            Cancel
          </button>

          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving}
            data-testid="editor-save-btn"
          >
            <Save size={15} /> {isSaving ? 'Saving...' : mode === 'create' ? 'Create Problem' : 'Save Changes'}
          </button>
        </div>
      </header>

      {/* Global Error Alert Banner */}
      {error && (
        <div className="editor-alert-box error" data-testid="editor-error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Architecture Navigation & Workspace Grid */}
      <div className="editor-architecture-grid">
        {/* Left Section Navigation (7 Structured Reusable Sections) */}
        <aside className="editor-section-nav" data-testid="editor-sidebar-nav">
          <button
            className={`editor-nav-tab ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
            data-testid="tab-basic"
          >
            <Settings2 size={16} /> 1. Basic Information
            {validationErrors.title && <span className="tab-error-dot" />}
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'examples' ? 'active' : ''}`}
            onClick={() => setActiveTab('examples')}
            data-testid="tab-examples"
          >
            <FileText size={16} /> 2. Statement & Examples
            {validationErrors.description && <span className="tab-error-dot" />}
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'coding_mode' ? 'active' : ''}`}
            onClick={() => setActiveTab('coding_mode')}
            data-testid="tab-coding-mode"
          >
            <Code2 size={16} /> 3. Coding Architecture
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'languages' ? 'active' : ''}`}
            onClick={() => setActiveTab('languages')}
            data-testid="tab-languages"
          >
            <Terminal size={16} /> 4. Languages & Starters
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'function_dsl' ? 'active' : ''}`}
            onClick={() => setActiveTab('function_dsl')}
            data-testid="tab-function-dsl"
          >
            <Sparkles size={16} /> 5. Function Mode & DSL
            {validationErrors.functionName && <span className="tab-error-dot" />}
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'test_cases' ? 'active' : ''}`}
            onClick={() => setActiveTab('test_cases')}
            data-testid="tab-test-cases"
          >
            <Database size={16} /> 6. Test Cases
          </button>

          <button
            className={`editor-nav-tab ${activeTab === 'execution' ? 'active' : ''}`}
            onClick={() => setActiveTab('execution')}
            data-testid="tab-execution"
          >
            <Shield size={16} /> 7. Limits & Governance
            {(validationErrors.timeLimitMs || validationErrors.memoryLimitMb) && <span className="tab-error-dot" />}
          </button>
        </aside>

        {/* Right Section Content Card */}
        <main className="editor-content-card" data-testid="editor-main-card">
          {/* SECTION 1: BASIC INFORMATION */}
          {activeTab === 'basic' && (
            <div data-testid="section-basic">
              <h3>1. Basic Information</h3>
              <p className="editor-content-subtitle">
                Configure primary title, problem difficulty rating, access scope, and constraints.
              </p>

              <div className="editor-form-group">
                <label className="editor-label">
                  Problem Title <span className="req">*</span>
                  <span className="char-count">{formData.title.length}/200</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Invert Binary Tree, Optimal Matrix Multiplication"
                  className={`editor-input ${validationErrors.title ? 'invalid' : ''}`}
                  data-testid="input-problem-title"
                />
                {validationErrors.title && (
                  <span className="form-error-msg">{validationErrors.title}</span>
                )}
              </div>

              <div className="editor-form-row">
                <div className="editor-form-group">
                  <label className="editor-label">Difficulty Rating</label>
                  <select
                    value={formData.difficulty}
                    onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                    className="editor-select"
                    data-testid="select-problem-difficulty"
                  >
                    <option value="easy">Easy (Fundamentals & Direct Logic)</option>
                    <option value="medium">Medium (Data Structures & Optimization)</option>
                    <option value="hard">Hard (Advanced DP, Graphs & Hard Constraints)</option>
                  </select>
                </div>

                <div className="editor-form-group">
                  <label className="editor-label">Access Scope</label>
                  <select
                    value={formData.accessScope}
                    onChange={(e) => setFormData({ ...formData, accessScope: e.target.value })}
                    className="editor-select"
                    data-testid="select-problem-scope"
                  >
                    <option value="public">Public (Visible across Platform Practice Explorer)</option>
                    <option value="contest_private">Contest Private (Restricted to Assigned Contests)</option>
                    <option value="class">Classroom (Faculty Managed Group)</option>
                    <option value="institution">Institution Only</option>
                  </select>
                </div>
              </div>

              <div className="editor-form-group">
                <label className="editor-label">
                  Tags & Categories <span className="hint">(Comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="e.g. arrays, dynamic-programming, two-pointers, math"
                  className="editor-input"
                  data-testid="input-problem-tags"
                />
              </div>

              <div className="editor-form-group">
                <label className="editor-label">Problem Constraints</label>
                <textarea
                  rows={4}
                  value={formData.constraints}
                  onChange={(e) => setFormData({ ...formData, constraints: e.target.value })}
                  placeholder="e.g. 1 <= nums.length <= 10^5&#10;-10^9 <= nums[i] <= 10^9"
                  className="editor-textarea font-mono"
                  data-testid="input-problem-constraints"
                />
              </div>
            </div>
          )}

          {/* SECTION 2: STATEMENT & EXAMPLES */}
          {activeTab === 'examples' && (
            <div data-testid="section-examples">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>2. Problem Statement & Examples</h3>
                  <p className="editor-content-subtitle" style={{ margin: 0 }}>
                    Write problem description, formal input/output specifications, and candidate examples.
                  </p>
                </div>
                <div className="statement-preview-toggle">
                  <button
                    className={`preview-toggle-btn ${!statementPreview ? 'active' : ''}`}
                    onClick={() => setStatementPreview(false)}
                    type="button"
                  >
                    Edit Markdown
                  </button>
                  <button
                    className={`preview-toggle-btn ${statementPreview ? 'active' : ''}`}
                    onClick={() => setStatementPreview(true)}
                    type="button"
                  >
                    <Eye size={13} /> Preview
                  </button>
                </div>
              </div>

              <div className="editor-form-group">
                <label className="editor-label">
                  Problem Description <span className="req">*</span>
                </label>
                {!statementPreview ? (
                  <textarea
                    rows={8}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter comprehensive problem description, background, and input/output rules..."
                    className={`editor-textarea font-mono ${validationErrors.description ? 'invalid' : ''}`}
                    data-testid="input-problem-description"
                  />
                ) : (
                  <div className="statement-markdown-preview" data-testid="statement-preview-box">
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#e2e8f0', fontSize: '0.88rem' }}>
                      {formData.description || '(No description provided)'}
                    </pre>
                  </div>
                )}
                {validationErrors.description && (
                  <span className="form-error-msg">{validationErrors.description}</span>
                )}
              </div>

              {/* Examples Management */}
              <div className="examples-manager-wrap">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <label className="editor-label" style={{ margin: 0 }}>
                    Candidate Examples (Sample Test Cases)
                  </label>
                  <button
                    className="btn-add-item"
                    onClick={handleAddExample}
                    type="button"
                    data-testid="btn-add-example"
                  >
                    <Plus size={14} /> Add Example
                  </button>
                </div>

                <div className="examples-list">
                  {formData.examples.map((ex, idx) => (
                    <div key={ex.id || idx} className="example-card" data-testid={`example-card-${idx}`}>
                      <div className="example-card-header">
                        <span className="example-index">Example #{idx + 1}</span>
                        {formData.examples.length > 1 && (
                          <button
                            className="btn-remove-item"
                            onClick={() => handleRemoveExample(idx)}
                            type="button"
                            title="Remove Example"
                            data-testid={`btn-remove-example-${idx}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="editor-form-row">
                        <div className="editor-form-group">
                          <label className="editor-sublabel">Input Stream</label>
                          <textarea
                            rows={3}
                            value={ex.input}
                            onChange={(e) => handleUpdateExample(idx, 'input', e.target.value)}
                            placeholder="e.g. 5\n1 2 3 4 5"
                            className="editor-textarea font-mono sm"
                            data-testid={`example-input-${idx}`}
                          />
                        </div>
                        <div className="editor-form-group">
                          <label className="editor-sublabel">Expected Output</label>
                          <textarea
                            rows={3}
                            value={ex.output}
                            onChange={(e) => handleUpdateExample(idx, 'output', e.target.value)}
                            placeholder="e.g. 15"
                            className="editor-textarea font-mono sm"
                            data-testid={`example-output-${idx}`}
                          />
                        </div>
                      </div>

                      <div className="editor-form-group" style={{ marginBottom: 0 }}>
                        <label className="editor-sublabel">Explanation</label>
                        <input
                          type="text"
                          value={ex.explanation}
                          onChange={(e) => handleUpdateExample(idx, 'explanation', e.target.value)}
                          placeholder="Explain why this output is correct..."
                          className="editor-input sm"
                          data-testid={`example-explanation-${idx}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: CODING ARCHITECTURE */}
          {activeTab === 'coding_mode' && (
            <div data-testid="section-coding-mode">
              <h3>3. Coding Architecture & Evaluation Mode</h3>
              <p className="editor-content-subtitle">
                Select how candidate code is authored and judged: LeetCode-style Function Mode or Standard Online Judge.
              </p>

              <div className="coding-modes-grid">
                <div
                  className={`coding-mode-card ${formData.codingMode === 'function' ? 'selected' : ''}`}
                  onClick={() => handleCodingModeChange('function')}
                  data-testid="mode-card-function"
                >
                  <div className="mode-card-header">
                    <Code2 size={22} style={{ color: '#c084fc' }} />
                    <span className="mode-title">Function Mode (Solution Class)</span>
                    {formData.codingMode === 'function' && <span className="mode-active-tag">Active</span>}
                  </div>
                  <p className="mode-desc">
                    Candidates only author the target method or class logic (e.g. <code>class Solution</code>). The judge harness
                    (<code>harnessBuilder.js</code>) dynamically wraps student code with input parsing and output serialization.
                  </p>
                  <ul className="mode-bullets">
                    <li>No boilerplate I/O required from candidates</li>
                    <li>Automated deserialization & validation</li>
                    <li>Supports C++, Python, Java, JavaScript, and C</li>
                  </ul>
                </div>

                <div
                  className={`coding-mode-card ${formData.codingMode === 'full_program' ? 'selected' : ''}`}
                  onClick={() => handleCodingModeChange('full_program')}
                  data-testid="mode-card-full-program"
                >
                  <div className="mode-card-header">
                    <Terminal size={22} style={{ color: '#38bdf8' }} />
                    <span className="mode-title">Standard OJ (Full Program)</span>
                    {formData.codingMode === 'full_program' && <span className="mode-active-tag full">Active</span>}
                  </div>
                  <p className="mode-desc">
                    Traditional competitive programming workflow (Codeforces / HackerRank style). Candidate writes a standalone
                    executable containing <code>main()</code> and reads raw standard input directly.
                  </p>
                  <ul className="mode-bullets">
                    <li>Candidate has complete control of standard I/O streams</li>
                    <li>Raw stdin matching and stdout diff verification</li>
                    <li>Direct compilation without harness wrapping</li>
                  </ul>
                </div>
              </div>

              <div className="sandbox-security-box">
                <Shield size={20} style={{ color: '#38bdf8', flexShrink: 0 }} />
                <div>
                  <strong>Sandboxing & Execution Boundary:</strong> All candidate submissions run in Docker/Process isolation
                  with strict resource caps (2.0s CPU time, 256MB RAM, 512KB max stdout buffer, non-root user).
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: LANGUAGES & STARTER TEMPLATES */}
          {activeTab === 'languages' && (
            <div data-testid="section-languages">
              <h3>4. Language Configuration & Starter Templates</h3>
              <p className="editor-content-subtitle">
                Configure boilerplate starter code provided to candidates across all supported languages.
              </p>

              <div className="lang-tabs-bar">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.id}
                    className={`lang-tab-btn ${selectedLanguage === lang.id ? 'active' : ''}`}
                    onClick={() => setSelectedLanguage(lang.id)}
                    type="button"
                    data-testid={`lang-tab-${lang.id}`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>

              <div className="template-editor-wrap">
                <div className="template-editor-toolbar">
                  <span className="editor-lang-badge">
                    Editing Starter Code: <strong>{SUPPORTED_LANGUAGES.find((l) => l.id === selectedLanguage)?.label}</strong>
                  </span>
                  <button
                    className="btn-subaction"
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        starterTemplates: {
                          ...prev.starterTemplates,
                          [selectedLanguage]: DEFAULT_STARTER_TEMPLATES[formData.codingMode][selectedLanguage] || '',
                        },
                      }));
                    }}
                    type="button"
                    data-testid="btn-reset-template"
                  >
                    <RefreshCw size={12} /> Reset to Default
                  </button>
                </div>

                <textarea
                  rows={14}
                  value={formData.starterTemplates[selectedLanguage] || ''}
                  onChange={(e) => {
                    const updated = { ...formData.starterTemplates, [selectedLanguage]: e.target.value };
                    setFormData({ ...formData, starterTemplates: updated });
                  }}
                  className="editor-textarea font-mono code-box"
                  placeholder={`// Enter ${selectedLanguage} starter template...`}
                  data-testid="input-starter-code"
                />
              </div>
            </div>
          )}

          {/* SECTION 5: FUNCTION MODE & DSL CONFIGURATION */}
          {activeTab === 'function_dsl' && (
            <div data-testid="section-function-dsl">
              <h3>5. Function Mode & DSL Configuration</h3>
              <p className="editor-content-subtitle">
                Define the function signature, argument types, and server-side test harness templates.
              </p>

              {formData.codingMode !== 'function' ? (
                <div className="editor-info-banner">
                  <Info size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <div>
                    This problem is currently in <strong>Standard OJ (Full Program)</strong> mode. Harness configuration and DSL
                    function signatures are only evaluated when <strong>Function Mode</strong> is active.
                  </div>
                </div>
              ) : (
                <>
                  <div className="signature-builder-card">
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#f8fafc' }}>
                      Function Signature Specification
                    </h4>

                    <div className="editor-form-row three-col">
                      <div className="editor-form-group">
                        <label className="editor-label">Function Name <span className="req">*</span></label>
                        <input
                          type="text"
                          value={formData.functionConfig.functionName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              functionConfig: { ...formData.functionConfig, functionName: e.target.value },
                            })
                          }
                          placeholder="e.g. solve, twoSum, maxSubArray"
                          className={`editor-input font-mono ${validationErrors.functionName ? 'invalid' : ''}`}
                          data-testid="input-function-name"
                        />
                        {validationErrors.functionName && (
                          <span className="form-error-msg">{validationErrors.functionName}</span>
                        )}
                      </div>

                      <div className="editor-form-group">
                        <label className="editor-label">Return Type</label>
                        <input
                          type="text"
                          value={formData.functionConfig.returnType}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              functionConfig: { ...formData.functionConfig, returnType: e.target.value },
                            })
                          }
                          placeholder="e.g. int, vector<int>, string, bool"
                          className="editor-input font-mono"
                          data-testid="input-return-type"
                        />
                      </div>

                      <div className="editor-form-group">
                        <label className="editor-label">Parameters</label>
                        <input
                          type="text"
                          value={formData.functionConfig.parameters}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              functionConfig: { ...formData.functionConfig, parameters: e.target.value },
                            })
                          }
                          placeholder="e.g. vector<int>& nums, int k"
                          className="editor-input font-mono"
                          data-testid="input-parameters"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button
                        className="btn-secondary sm"
                        onClick={handleGenerateFromSignature}
                        type="button"
                        data-testid="btn-generate-templates"
                      >
                        <Sparkles size={13} /> Auto-Generate Starter & Harness from Signature
                      </button>
                    </div>
                  </div>

                  {/* Harness Templates View */}
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <label className="editor-label" style={{ margin: 0 }}>
                        Server-Side Test Harness (<code>harnessBuilder.js</code> integration)
                      </label>
                      <span className="harness-tag">
                        Placeholder: <code>// __STUDENT_CODE__</code>
                      </span>
                    </div>

                    <div className="lang-tabs-bar">
                      {['python', 'cpp', 'java'].map((langKey) => (
                        <button
                          key={langKey}
                          className={`lang-tab-btn ${selectedLanguage === langKey ? 'active' : ''}`}
                          onClick={() => setSelectedLanguage(langKey)}
                          type="button"
                        >
                          {SUPPORTED_LANGUAGES.find((l) => l.id === langKey)?.label}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={10}
                      value={formData.harnessTemplates[selectedLanguage] || ''}
                      onChange={(e) => {
                        const updated = { ...formData.harnessTemplates, [selectedLanguage]: e.target.value };
                        setFormData({ ...formData, harnessTemplates: updated });
                      }}
                      className="editor-textarea font-mono code-box"
                      placeholder={`// Harness template for ${selectedLanguage}...`}
                      data-testid="input-harness-code"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* SECTION 6: TEST CASE MANAGEMENT (Phase 7.4.6) */}
          {activeTab === 'test_cases' && (
            <div data-testid="section-test-cases">
              <AdminTestCaseManager
                problemId={problemId}
                mode={mode}
                token={token}
                codingMode={formData.codingMode}
                localTestCases={formData.testCases || []}
                onLocalTestCasesChange={(updatedCases) => {
                  setFormData((prev) => ({
                    ...prev,
                    testCases: updatedCases,
                  }));
                }}
              />
            </div>
          )}

          {/* SECTION 7: LIMITS & GOVERNANCE */}
          {activeTab === 'execution' && (
            <div data-testid="section-execution">
              <h3>7. Execution Limits & Lifecycle Governance</h3>
              <p className="editor-content-subtitle">
                Configure runtime constraints and inspect versioning metadata.
              </p>

              <div className="editor-form-row">
                <div className="editor-form-group">
                  <label className="editor-label">
                    <Clock size={14} style={{ display: 'inline', marginRight: '4px' }} />
                    CPU Time Limit (ms) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min={500}
                    max={10000}
                    step={100}
                    value={formData.timeLimitMs}
                    onChange={(e) => setFormData({ ...formData, timeLimitMs: parseInt(e.target.value, 10) || 2000 })}
                    className={`editor-input ${validationErrors.timeLimitMs ? 'invalid' : ''}`}
                    data-testid="input-time-limit"
                  />
                  {validationErrors.timeLimitMs && (
                    <span className="form-error-msg">{validationErrors.timeLimitMs}</span>
                  )}
                </div>

                <div className="editor-form-group">
                  <label className="editor-label">
                    <Cpu size={14} style={{ display: 'inline', marginRight: '4px' }} />
                    Memory Limit (MB) <span className="req">*</span>
                  </label>
                  <input
                    type="number"
                    min={64}
                    max={1024}
                    step={32}
                    value={formData.memoryLimitMb}
                    onChange={(e) => setFormData({ ...formData, memoryLimitMb: parseInt(e.target.value, 10) || 256 })}
                    className={`editor-input ${validationErrors.memoryLimitMb ? 'invalid' : ''}`}
                    data-testid="input-memory-limit"
                  />
                  {validationErrors.memoryLimitMb && (
                    <span className="form-error-msg">{validationErrors.memoryLimitMb}</span>
                  )}
                </div>

                <div className="editor-form-group">
                  <label className="editor-label">Output Buffer Cap</label>
                  <input
                    type="text"
                    disabled
                    value="512 KB (Platform Sandbox Standard)"
                    className="editor-input disabled"
                  />
                </div>
              </div>

              {/* Lifecycle & Versioning Details */}
              <div className="governance-meta-card">
                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#f8fafc' }}>
                  Governance & Audit Snapshot
                </h4>

                <div className="governance-grid">
                  <div className="gov-item">
                    <span className="gov-label">Lifecycle Status</span>
                    <span className="gov-val status-badge draft">{formData.reviewStatus.toUpperCase()}</span>
                  </div>
                  <div className="gov-item">
                    <span className="gov-label">Active Version</span>
                    <span className="gov-val">v{formData.version}</span>
                  </div>
                  <div className="gov-item">
                    <span className="gov-label">Optimistic Concurrency</span>
                    <span className="gov-val">Enforced</span>
                  </div>
                  <div className="gov-item">
                    <span className="gov-label">Authoring Actor</span>
                    <span className="gov-val">{currentUser?.username || 'Super Admin'} ({currentUser?.role || 'super_admin'})</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Unsaved Changes Confirmation Modal */}
      {showUnsavedPrompt && (
        <div className="editor-modal-overlay" data-testid="unsaved-changes-modal">
          <div className="editor-modal-card">
            <AlertTriangle size={32} style={{ color: '#fbbf24', margin: '0 auto 12px auto', display: 'block' }} />
            <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc', textAlign: 'center' }}>Unsaved Changes</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#cbd5e1', textAlign: 'center' }}>
              You have unsaved changes in this problem draft. Leaving will discard your current modifications.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                className="btn-secondary"
                onClick={() => setShowUnsavedPrompt(false)}
                data-testid="btn-stay-editing"
              >
                Stay & Keep Editing
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  setShowUnsavedPrompt(false);
                  onBack?.();
                }}
                data-testid="btn-discard-leave"
              >
                Discard & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
