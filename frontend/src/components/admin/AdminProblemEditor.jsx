import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Info,
  UploadCloud,
  History,
  Lock,
  Check,
  ExternalLink,
  XCircle,
  X,
} from 'lucide-react';
import AuthoringLoadingState from '../authoring/AuthoringLoadingState';
import AdminTestCaseManager from './AdminTestCaseManager';
import './adminProblemManagement.css';

/**
 * Shared Admin Problem Editor Architecture (Phase 7.4.3 - 7.4.9)
 * 
 * Used for both:
 * - Create Mode: /admin/problems/new
 * - Edit Mode: /admin/problems/:id/edit
 * 
 * Complete Problem Lifecycle:
 * Draft → Save → Preview → Validate → Publish → Published
 */

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  CODING_MODES,
  getCodingModeMeta,
  validateProblemForm,
  parseParameterString,
  formatParametersToString,
  generateTemplatesFromSignature,
  getTabForPublishError,
  validateForPublish,
} from './adminProblemEditorConstants.js';

export {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  CODING_MODES,
  getCodingModeMeta,
  validateProblemForm,
  parseParameterString,
  formatParametersToString,
  generateTemplatesFromSignature,
  getTabForPublishError,
  validateForPublish,
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
  const [modeSwitchNotice, setModeSwitchNotice] = useState(null);
  const [generateNotice, setGenerateNotice] = useState(null);
  const [previewLang, setPreviewLang] = useState('cpp');

  // Phase 7.4.9 Preview & Publish State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewActiveLang, setPreviewActiveLang] = useState('python');
  const [previewLoading, setPreviewLoading] = useState(false);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState(null);
  const [publishSuccessInfo, setPublishSuccessInfo] = useState(null);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictVersion, setConflictVersion] = useState(null);
  const [isReloadingConflict, setIsReloadingConflict] = useState(false);

  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [versionHistory, setVersionHistory] = useState([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState(null);

  // Per-mode starter templates cache ensuring non-destructive mode switching
  const [modeStarterTemplates, setModeStarterTemplates] = useState({
    function: { ...DEFAULT_STARTER_TEMPLATES.function },
    full_program: { ...DEFAULT_STARTER_TEMPLATES.full_program },
  });

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
    isPublished: false,
    reviewStatus: 'draft',
    allowedLanguages: SUPPORTED_LANGUAGES.map((l) => l.id),
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

  const fetchProblemDetails = useCallback(async (idStr) => {
    const res = await fetch(`/api/admin/problems/${idStr}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `Problem #${idStr} not found in database.`);
    }
    const json = await res.json();
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
      isPublished: p.isPublished !== undefined ? p.isPublished : (p.is_published !== undefined ? p.is_published : false),
      reviewStatus: p.reviewStatus || p.review_status || 'draft',
      allowedLanguages: p.allowedLanguages || p.allowed_languages || (
        p.starterTemplates || p.starter_templates
          ? Object.keys(p.starterTemplates || p.starter_templates).filter((k) => SUPPORTED_LANGUAGES.some((sl) => sl.id === k))
          : SUPPORTED_LANGUAGES.map((l) => l.id)
      ),
      functionConfig: p.functionConfig || p.function_config || {
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

    const activeCodingMode = loadedData.codingMode;
    setModeStarterTemplates({
      function: activeCodingMode === 'function' ? { ...loadedData.starterTemplates } : { ...DEFAULT_STARTER_TEMPLATES.function },
      full_program: activeCodingMode === 'full_program' ? { ...loadedData.starterTemplates } : { ...DEFAULT_STARTER_TEMPLATES.full_program },
    });

    setFormData(loadedData);
    setInitialData(loadedData);
    return loadedData;
  }, [token]);

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

      fetchProblemDetails(idStr)
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
  }, [mode, problemId, fetchProblemDetails]);

  // Handle starter code edits preserving per-mode authored code
  const handleStarterTemplateChange = (lang, newCode) => {
    setFormData((prev) => ({
      ...prev,
      starterTemplates: {
        ...prev.starterTemplates,
        [lang]: newCode,
      },
    }));
    setModeStarterTemplates((prev) => ({
      ...prev,
      [formData.codingMode]: {
        ...prev[formData.codingMode],
        [lang]: newCode,
      },
    }));
  };

  // Reset starter template for a language to mode-specific default
  const handleResetStarterTemplate = (lang) => {
    const defaultCode = DEFAULT_STARTER_TEMPLATES[formData.codingMode]?.[lang] || '';
    handleStarterTemplateChange(lang, defaultCode);
  };

  // Mode switcher handler with non-destructive preservation
  const handleCodingModeChange = (newMode) => {
    if (newMode === formData.codingMode) return;

    const currentMode = formData.codingMode;
    const currentTemplates = { ...formData.starterTemplates };

    setModeStarterTemplates((prev) => {
      const updated = {
        ...prev,
        [currentMode]: currentTemplates,
      };

      const targetTemplates = updated[newMode] || { ...DEFAULT_STARTER_TEMPLATES[newMode] };

      setFormData((prevForm) => ({
        ...prevForm,
        codingMode: newMode,
        starterTemplates: targetTemplates,
      }));

      return updated;
    });

    setModeSwitchNotice(
      `Switched to ${newMode === 'function' ? 'Function Mode (Solution Class)' : 'Standard OJ (Full Program)'}. Your previous mode code is preserved.`
    );
    setTimeout(() => {
      setModeSwitchNotice(null);
    }, 4500);
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

  // Structured parameters parsing & duplicate detection
  const structuredParams = useMemo(() => {
    return parseParameterString(formData.functionConfig?.parameters || '');
  }, [formData.functionConfig?.parameters]);

  const duplicateParamNames = useMemo(() => {
    const seen = new Set();
    const dups = new Set();
    for (const p of structuredParams) {
      const name = (p.name || '').trim().toLowerCase();
      if (!name) continue;
      if (seen.has(name)) {
        dups.add(name);
      } else {
        seen.add(name);
      }
    }
    return Array.from(dups);
  }, [structuredParams]);

  const handleAddParameter = () => {
    const nextIdx = structuredParams.length + 1;
    const newParam = { id: `p-${Date.now()}`, name: `arg${nextIdx}`, type: 'int' };
    const updated = [...structuredParams, newParam];
    const formatted = formatParametersToString(updated);
    setFormData((prev) => ({
      ...prev,
      functionConfig: { ...prev.functionConfig, parameters: formatted },
    }));
  };

  const handleUpdateParameter = (idx, field, value) => {
    const updated = structuredParams.map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    const formatted = formatParametersToString(updated);
    setFormData((prev) => ({
      ...prev,
      functionConfig: { ...prev.functionConfig, parameters: formatted },
    }));
  };

  const handleRemoveParameter = (idx) => {
    const updated = structuredParams.filter((_, i) => i !== idx);
    const formatted = formatParametersToString(updated);
    setFormData((prev) => ({
      ...prev,
      functionConfig: { ...prev.functionConfig, parameters: formatted },
    }));
  };

  const handleToggleLanguage = (langId) => {
    setFormData((prev) => {
      const current = prev.allowedLanguages || SUPPORTED_LANGUAGES.map((l) => l.id);
      let updated;
      if (current.includes(langId)) {
        if (current.length === 1) {
          return prev; // Cannot disable the last language
        }
        updated = current.filter((l) => l !== langId);
      } else {
        updated = [...current, langId];
      }
      return { ...prev, allowedLanguages: updated };
    });
    // If selected language was disabled, switch to first active
    if (selectedLanguage === langId) {
      const remaining = (formData.allowedLanguages || []).filter((l) => l !== langId);
      if (remaining.length > 0) {
        setSelectedLanguage(remaining[0]);
      }
    }
  };

  // Live function signature computation for interactive preview
  const previewSignature = useMemo(() => {
    const fnName = (formData.functionConfig?.functionName || 'solve').trim();
    const retType = (formData.functionConfig?.returnType || 'int').trim();
    const params = structuredParams;

    switch (previewLang) {
      case 'cpp': {
        const pList = params.length > 0 ? params.map((p) => `${p.type || 'int'} ${p.name || 'arg'}`).join(', ') : 'vector<int>& nums';
        return `${retType} ${fnName}(${pList});`;
      }
      case 'python': {
        const pList = params.length > 0 ? params.map((p) => `${p.name || 'arg'}: list[int]`).join(', ') : 'nums: list[int]';
        return `def ${fnName}(self, ${pList}) -> ${retType}:`;
      }
      case 'java': {
        const pList = params.length > 0 ? params.map((p) => `${(p.type || '').includes('vector') ? 'int[]' : (p.type || 'int')} ${p.name || 'arg'}`).join(', ') : 'int[] nums';
        const javaRet = retType.includes('vector') ? 'int[]' : retType;
        return `public ${javaRet} ${fnName}(${pList});`;
      }
      case 'javascript': {
        const pList = params.length > 0 ? params.map((p) => p.name || 'arg').join(', ') : 'nums';
        return `function ${fnName}(${pList});`;
      }
      case 'c': {
        const pList = params.length > 0 ? params.map((p) => `${p.type || 'int*'} ${p.name || 'arg'}`).join(', ') : 'int* nums, int numsSize';
        const cRet = retType.includes('vector') ? 'int*' : retType;
        return `${cRet} ${fnName}(${pList});`;
      }
      default:
        return `${retType} ${fnName}(...);`;
    }
  }, [formData.functionConfig, structuredParams, previewLang]);

  // Auto-generate starter & harness templates from Function Signature
  const handleGenerateFromSignature = () => {
    const fnName = formData.functionConfig?.functionName?.trim() || 'solve';
    const retType = formData.functionConfig?.returnType?.trim() || 'int';
    const params = formData.functionConfig?.parameters || 'vector<int>& nums';

    const { starterTemplates: genStarter, harnessTemplates: genHarness } = generateTemplatesFromSignature({
      functionName: fnName,
      returnType: retType,
      parameters: params,
    });

    setFormData((prev) => ({
      ...prev,
      starterTemplates: { ...prev.starterTemplates, ...genStarter },
      harnessTemplates: { ...prev.harnessTemplates, ...genHarness },
    }));
    setModeStarterTemplates((prev) => ({
      ...prev,
      function: { ...(prev.function || {}), ...genStarter },
    }));
    setGenerateNotice('Boilerplate starter code and test harnesses regenerated from function signature.');
    setTimeout(() => setGenerateNotice(null), 4000);
  };

  // Safe navigation back
  const handleAttemptBack = () => {
    if (isDirty) {
      setShowUnsavedPrompt(true);
    } else {
      onBack?.();
    }
  };

  // Core Save Problem Logic (Phase 7.4.9)
  const performSave = async () => {
    // 1. Run client-side validation
    const validation = validateProblemForm(formData);
    setValidationErrors(validation.errors);
    if (!validation.isValid) {
      setError('Please resolve the highlighted validation errors before saving.');
      return { success: false, validationError: true };
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
        allowedLanguages: formData.allowedLanguages,
        starterTemplates: formData.starterTemplates,
        harnessTemplates: formData.harnessTemplates,
        functionConfig: formData.codingMode === 'function' ? formData.functionConfig : undefined,
        testCases: testCasesPayload,
        version: formData.version,
        isPublished: formData.isPublished || false,
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
          const conflictVer = json.currentVersion || (formData.version + 1);
          setConflictVersion(conflictVer);
          setShowConflictModal(true);
          throw new Error(
            `Optimistic Concurrency Conflict: Problem version (v${formData.version}) has been superseded by another administrator (v${conflictVer}). Please reload to resolve.`
          );
        }
        throw new Error(json.message || `Failed to ${mode === 'edit' ? 'update' : 'create'} problem.`);
      }

      setSaveSuccess(true);
      const savedProblem = json.problem || json.data?.problem || json;
      const nextVersion = savedProblem?.version || (mode === 'edit' ? formData.version + 1 : 1);
      const nextPublished = savedProblem?.isPublished !== undefined ? savedProblem.isPublished : false;
      const nextReviewStatus = savedProblem?.reviewStatus || 'draft';

      const updatedState = {
        ...formData,
        version: nextVersion,
        isPublished: nextPublished,
        reviewStatus: nextReviewStatus,
      };
      setFormData(updatedState);
      setInitialData(updatedState);

      if (onSaved) {
        onSaved(savedProblem);
      }

      setTimeout(() => setSaveSuccess(false), 3500);
      return { success: true, problem: savedProblem };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setIsSaving(false);
    }
  };

  // Save Problem Action
  const handleSave = async () => {
    await performSave();
  };

  // Phase 7.4.9 Preview Handler: student-facing problem representation with strictly zero hidden test leakage
  const handleOpenPreview = async () => {
    const activeLangs = (formData.allowedLanguages && formData.allowedLanguages.length > 0)
      ? formData.allowedLanguages
      : SUPPORTED_LANGUAGES.map((l) => l.id);
    const initialLang = activeLangs.includes(selectedLanguage) ? selectedLanguage : activeLangs[0];
    setPreviewActiveLang(initialLang);
    setPreviewLoading(true);
    setIsPreviewOpen(true);

    // If already saved in edit mode and clean, attempt fetch from /api/problems/:id/preview
    if (mode === 'edit' && problemId && !isDirty) {
      try {
        const res = await fetch(`/api/problems/${problemId}/preview`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setPreviewData(json);
          setPreviewLoading(false);
          return;
        }
      } catch (err) {
        // Fallback to local form data representation
      }
    }

    // Client-side preview representation based on current authored form state
    const sampleCases = (formData.testCases && formData.testCases.length > 0)
      ? formData.testCases
          .filter((tc) => tc.isSample || !tc.isHidden)
          .map((tc, idx) => ({
            id: tc.id || idx + 1,
            inputData: tc.inputData || '',
            expectedOutput: tc.expectedOutput || '',
            explanation: tc.explanation || `Sample test case ${idx + 1}`,
          }))
      : formData.examples.map((ex, idx) => ({
          id: ex.id || idx + 1,
          inputData: ex.input || '',
          expectedOutput: ex.output || '',
          explanation: ex.explanation || `Sample test case ${idx + 1}`,
        }));

    setPreviewData({
      id: problemId || 'DRAFT',
      title: formData.title || 'Untitled Problem',
      description: formData.description || 'No description provided.',
      difficulty: formData.difficulty || 'medium',
      codingMode: formData.codingMode || 'function',
      constraints: formData.constraints || '',
      allowedLanguages: activeLangs,
      starterTemplates: formData.starterTemplates || {},
      functionConfig: formData.functionConfig || {},
      sampleTestCases: sampleCases,
      reviewStatus: formData.reviewStatus || 'draft',
      isPublished: formData.isPublished || false,
    });
    setPreviewLoading(false);
  };

  // Phase 7.4.9 Publish Handler: validation gate, save draft if modified, POST /api/problems/:id/publish
  const handleAttemptPublish = async () => {
    // 1. Client-side pre-validation
    const clientVal = validateForPublish(formData);
    if (!clientVal.isValid) {
      setPublishErrors(clientVal.errors);
      return;
    }

    setIsPublishing(true);
    setPublishErrors(null);
    setError(null);

    try {
      // 2. Ensure problem is saved first if dirty or create mode
      let targetId = problemId;
      if (isDirty || mode === 'create' || !targetId) {
        const saveRes = await performSave();
        if (!saveRes.success) {
          setIsPublishing(false);
          return;
        }
        targetId = saveRes.problem?.id || problemId;
      }

      if (!targetId) {
        throw new Error('Problem must be saved before it can be published.');
      }

      // 3. Call backend publication validation gate API
      const res = await fetch(`/api/problems/${targetId}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 422) {
          setPublishErrors(json.errors || [json.message || 'Publication validation failed.']);
          return;
        }
        if (res.status === 409) {
          const conflictVer = json.currentVersion || (formData.version + 1);
          setConflictVersion(conflictVer);
          setShowConflictModal(true);
          throw new Error(json.message || 'Optimistic concurrency conflict during publication.');
        }
        throw new Error(json.message || `Failed to publish problem #${targetId}.`);
      }

      // 4. Success state update
      const pubProblem = json.problem || {};
      const publishedVersion = json.version || pubProblem.version || formData.version;

      const publishedState = {
        ...formData,
        isPublished: true,
        reviewStatus: 'published',
        version: publishedVersion,
      };
      setFormData(publishedState);
      setInitialData(publishedState);

      setPublishSuccessInfo({
        version: publishedVersion,
        problemId: targetId,
        publishedAt: pubProblem.publishedAt || new Date().toISOString(),
      });

      if (onSaved) {
        onSaved({ ...pubProblem, isPublished: true, reviewStatus: 'published', version: publishedVersion });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  // Phase 7.4.9 Version History Handler: view immutable snapshots of publications
  const handleOpenVersionHistory = async () => {
    if (!problemId) return;
    setIsVersionHistoryOpen(true);
    setVersionHistoryLoading(true);
    setVersionHistoryError(null);

    try {
      const res = await fetch(`/api/problems/${problemId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Failed to load version history snapshots.');
      }
      setVersionHistory(json.versions || json.data || []);
    } catch (err) {
      setVersionHistoryError(err.message);
    } finally {
      setVersionHistoryLoading(false);
    }
  };

  // Phase 7.4.9 Concurrency Conflict Reload Handler: reload latest problem state without silent overwrite
  const handleConflictReload = async () => {
    if (!problemId) return;
    setIsReloadingConflict(true);
    try {
      await fetchProblemDetails(problemId);
      setShowConflictModal(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsReloadingConflict(false);
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
              <span className={`editor-status-badge ${formData.isPublished ? 'published' : 'draft'}`} data-testid="editor-status-badge">
                {formData.isPublished ? <Check size={12} /> : <Lock size={12} />}
                {formData.isPublished ? 'Published' : 'Draft'}
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
            onClick={handleOpenPreview}
            disabled={isSaving || isPublishing}
            data-testid="editor-preview-btn"
            title="Preview student-facing problem statement and sample test cases"
          >
            <Eye size={15} /> Preview
          </button>

          {mode === 'edit' && (
            <button
              className="btn-secondary"
              onClick={handleOpenVersionHistory}
              disabled={isSaving || isPublishing}
              data-testid="editor-versions-btn"
              title="View historical publication snapshots"
            >
              <History size={15} /> Versions
            </button>
          )}

          <button
            className="btn-secondary"
            onClick={handleAttemptBack}
            disabled={isSaving || isPublishing}
            data-testid="editor-cancel-btn"
          >
            Cancel
          </button>

          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || isPublishing}
            data-testid="editor-save-btn"
          >
            <Save size={15} /> {isSaving ? 'Saving...' : mode === 'create' ? 'Create Problem' : 'Save Draft'}
          </button>

          <button
            className="btn-publish"
            onClick={handleAttemptPublish}
            disabled={isSaving || isPublishing}
            data-testid="editor-publish-btn"
            title="Validate requirements and publish problem to student catalog"
          >
            <UploadCloud size={15} /> {isPublishing ? 'Publishing...' : 'Publish'}
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
            {formData.codingMode !== 'function' && (
              <span className="tab-pill-mode" data-testid="tab-pill-function-only">Function Only</span>
            )}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>3. Coding Architecture & Evaluation Mode</h3>
                  <p className="editor-content-subtitle" style={{ margin: '4px 0 0 0' }}>
                    Select how candidate code is authored and evaluated: LeetCode-style Function Mode or Standard Online Judge.
                  </p>
                </div>
                <span className={`mode-pill ${formData.codingMode === 'function' ? 'function-pill' : 'standard-pill'}`} data-testid="active-mode-pill">
                  {formData.codingMode === 'function' ? 'Function Mode Active' : 'Standard OJ Active'}
                </span>
              </div>

              {modeSwitchNotice && (
                <div className="mode-switch-alert" data-testid="mode-switch-notice">
                  <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                  <span>{modeSwitchNotice}</span>
                </div>
              )}

              <div className="coding-modes-grid">
                <div
                  className={`coding-mode-card ${formData.codingMode === 'function' ? 'selected function-selected' : ''}`}
                  onClick={() => handleCodingModeChange('function')}
                  data-testid="mode-card-function"
                  role="button"
                  tabIndex={0}
                >
                  <div className="mode-card-header">
                    <Code2 size={22} style={{ color: '#c084fc' }} />
                    <span className="mode-title">Function Mode (Solution Class)</span>
                    {formData.codingMode === 'function' ? (
                      <span className="mode-active-tag">Active</span>
                    ) : (
                      <span className="mode-select-hint">Click to Select</span>
                    )}
                  </div>
                  <p className="mode-desc">
                    Candidates only author the target method or class logic (e.g. <code>class Solution</code>). The judge harness
                    (<code>harnessBuilder.js</code>) dynamically wraps student code with input parsing and output serialization.
                  </p>
                  <ul className="mode-bullets">
                    <li>No boilerplate I/O required from candidates</li>
                    <li>Automated argument parsing & validation</li>
                    <li>Supports C++, Python, Java, JavaScript, and C</li>
                    <li>Harness templates customizable with <code>// __STUDENT_CODE__</code></li>
                  </ul>
                </div>

                <div
                  className={`coding-mode-card ${formData.codingMode === 'full_program' ? 'selected standard-selected' : ''}`}
                  onClick={() => handleCodingModeChange('full_program')}
                  data-testid="mode-card-full-program"
                  role="button"
                  tabIndex={0}
                >
                  <div className="mode-card-header">
                    <Terminal size={22} style={{ color: '#38bdf8' }} />
                    <span className="mode-title">Standard OJ (Full Program)</span>
                    {formData.codingMode === 'full_program' ? (
                      <span className="mode-active-tag full">Active</span>
                    ) : (
                      <span className="mode-select-hint">Click to Select</span>
                    )}
                  </div>
                  <p className="mode-desc">
                    Traditional competitive programming workflow (Codeforces / HackerRank style). Candidate writes a standalone
                    executable containing <code>main()</code> and reads raw standard input directly.
                  </p>
                  <ul className="mode-bullets">
                    <li>Candidate has complete control of standard I/O streams</li>
                    <li>Raw stdin matching and stdout diff verification</li>
                    <li>Direct compilation without harness wrapping</li>
                    <li>Zero boilerplate overhead, optimal for algorithmic contests</li>
                  </ul>
                </div>
              </div>

              {/* Mode Specific Deep-Dive Architecture Box */}
              <div className="mode-architecture-summary" data-testid="mode-architecture-summary">
                {formData.codingMode === 'function' ? (
                  <div className="mode-detail-card function-accent" data-testid="function-mode-architecture-card">
                    <h4>Function Mode Execution Architecture</h4>
                    <p>
                      Candidate submission is merged with the language-specific harness template via <code>HarnessBuilder.buildExecutableCode()</code>.
                      The driver program reads test-case inputs, deserializes arguments, invokes the student's solution method, and prints results.
                    </p>
                    <div className="mode-tags-row">
                      <span className="tag-pill">Signature DSL: Required</span>
                      <span className="tag-pill">Harness Template: Active</span>
                      <span className="tag-pill">I/O Wrapping: Automated</span>
                    </div>
                  </div>
                ) : (
                  <div className="mode-detail-card standard-accent" data-testid="standard-oj-architecture-card">
                    <h4>Standard Online Judge Architecture</h4>
                    <p>
                      Candidate submission is compiled as a standalone binary/script directly without code injection or harness wrapping.
                      The test cases feed raw input data via <code>stdin</code> and capture <code>stdout</code> for direct exact diff checking.
                    </p>
                    <div className="mode-tags-row">
                      <span className="tag-pill">Standalone main(): Required</span>
                      <span className="tag-pill">Harness Template: Disabled</span>
                      <span className="tag-pill">I/O Streams: Direct stdin/stdout</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="sandbox-security-box">
                <Shield size={20} style={{ color: '#38bdf8', flexShrink: 0 }} />
                <div>
                  <strong>Sandboxing & Execution Boundary:</strong> All candidate submissions run in Docker/Process isolation
                  with strict resource caps ({formData.timeLimitMs}ms CPU time, {formData.memoryLimitMb}MB RAM, 512KB max stdout buffer, non-root user).
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

              {/* Contextual Mode Guidance Banner */}
              <div className="mode-context-banner" data-testid="starter-code-mode-banner">
                {formData.codingMode === 'function' ? (
                  <div>
                    <span className="badge-fn">Function Mode</span>
                    <span className="context-text">
                      Candidates only author the target method or class. Boilerplate standard I/O and deserialization are handled automatically by the platform harness.
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="badge-std">Standard OJ</span>
                    <span className="context-text">
                      Candidates write a complete program with <code>main()</code> reading raw standard input (cin/stdin/Scanner) and writing standard output.
                    </span>
                  </div>
                )}
              </div>

              {/* Language Enablement Toggles */}
              <div className="language-selector-section" data-testid="language-selector-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <label className="editor-label" style={{ margin: 0 }}>
                    Enabled Problem Languages ({formData.allowedLanguages?.length || 0} / {SUPPORTED_LANGUAGES.length})
                  </label>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    Select which programming languages candidates may submit in
                  </span>
                </div>
                <div className="language-toggles-grid" data-testid="language-toggles-grid">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isEnabled = (formData.allowedLanguages || []).includes(lang.id);
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => handleToggleLanguage(lang.id)}
                        className={`lang-toggle-card ${isEnabled ? 'enabled' : 'disabled'}`}
                        data-testid={`toggle-lang-${lang.id}`}
                      >
                        <div className="toggle-indicator">
                          {isEnabled ? <CheckCircle2 size={15} color="#38bdf8" /> : <div className="toggle-dot-off" />}
                        </div>
                        <span className="lang-toggle-name">{lang.label}</span>
                        <span className="lang-toggle-badge">{lang.ext.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
                {validationErrors.allowedLanguages && (
                  <span className="form-error-msg" data-testid="error-allowed-languages" style={{ display: 'block', marginTop: '6px' }}>
                    {validationErrors.allowedLanguages}
                  </span>
                )}
              </div>

              <div className="lang-tabs-bar">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isEnabled = (formData.allowedLanguages || []).includes(lang.id);
                  return (
                    <button
                      key={lang.id}
                      className={`lang-tab-btn ${selectedLanguage === lang.id ? 'active' : ''} ${!isEnabled ? 'disabled-tab' : ''}`}
                      onClick={() => setSelectedLanguage(lang.id)}
                      type="button"
                      data-testid={`lang-tab-${lang.id}`}
                    >
                      {lang.label}
                      {!isEnabled && <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: '4px' }}>(Disabled)</span>}
                    </button>
                  );
                })}
              </div>

              <div className="template-editor-wrap">
                <div className="template-editor-toolbar">
                  <span className="editor-lang-badge">
                    Editing Starter Code: <strong>{SUPPORTED_LANGUAGES.find((l) => l.id === selectedLanguage)?.label}</strong>
                    {' '}({formData.codingMode === 'function' ? 'Function Boilerplate' : 'Full Program'})
                  </span>
                  <button
                    className="btn-subaction"
                    onClick={() => handleResetStarterTemplate(selectedLanguage)}
                    type="button"
                    data-testid="btn-reset-template"
                  >
                    <RefreshCw size={12} /> Reset to Default
                  </button>
                </div>

                <textarea
                  rows={14}
                  value={formData.starterTemplates[selectedLanguage] || ''}
                  onChange={(e) => handleStarterTemplateChange(selectedLanguage, e.target.value)}
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
                <div className="standard-oj-notice" data-testid="standard-oj-harness-notice">
                  <Terminal size={26} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 6px 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 700 }}>
                      Standard OJ (Full Program) Active
                    </h4>
                    <p style={{ margin: '0 0 14px 0', fontSize: '0.86rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                      In Standard OJ mode, candidate submissions are evaluated as standalone executables with direct
                      standard input (<code>stdin</code>) and standard output (<code>stdout</code>) streams. Function signatures
                      and server-side harness injection (<code>harnessBuilder.js</code>) are not utilized for this problem.
                    </p>
                    <button
                      className="btn-secondary sm"
                      onClick={() => handleCodingModeChange('function')}
                      type="button"
                      data-testid="btn-switch-to-function-mode"
                    >
                      <Sparkles size={13} /> Switch to Function Mode
                    </button>
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
                          <span className="form-error-msg" data-testid="error-function-name">{validationErrors.functionName}</span>
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
                          className={`editor-input font-mono ${validationErrors.returnType ? 'invalid' : ''}`}
                          data-testid="input-return-type"
                        />
                        {validationErrors.returnType && (
                          <span className="form-error-msg" data-testid="error-return-type">{validationErrors.returnType}</span>
                        )}
                      </div>

                      <div className="editor-form-group">
                        <label className="editor-label">Parameters (String or Structured)</label>
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

                    {/* Structured Parameters Breakdown */}
                    <div className="params-builder-container" data-testid="params-builder-container">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                          Structured Parameters ({structuredParams.length})
                        </span>
                        <button
                          type="button"
                          className="btn-add-param"
                          onClick={handleAddParameter}
                          data-testid="btn-add-parameter"
                        >
                          <Plus size={13} /> Add Parameter
                        </button>
                      </div>

                      {structuredParams.length > 0 && (
                        <div>
                          <div className="params-table-header">
                            <span style={{ flex: 1 }}>Parameter Type</span>
                            <span style={{ flex: 1 }}>Parameter Name</span>
                            <span style={{ width: '38px', textAlign: 'center' }}>Del</span>
                          </div>
                          {structuredParams.map((p, idx) => (
                            <div key={p.id || idx} className="param-row" data-testid={`param-row-${idx}`}>
                              <input
                                type="text"
                                value={p.type}
                                onChange={(e) => handleUpdateParameter(idx, 'type', e.target.value)}
                                placeholder="e.g. vector<int>&, int"
                                className="param-input"
                                style={{ flex: 1 }}
                                data-testid={`param-type-input-${idx}`}
                              />
                              <input
                                type="text"
                                value={p.name}
                                onChange={(e) => handleUpdateParameter(idx, 'name', e.target.value)}
                                placeholder="e.g. nums, target"
                                className={`param-input ${duplicateParamNames.includes(p.name?.toLowerCase()) ? 'invalid' : ''}`}
                                style={{ flex: 1 }}
                                data-testid={`param-name-input-${idx}`}
                              />
                              <button
                                type="button"
                                className="btn-param-del"
                                onClick={() => handleRemoveParameter(idx)}
                                title="Remove parameter"
                                data-testid={`btn-del-param-${idx}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {duplicateParamNames.length > 0 && (
                        <div className="param-duplicate-badge" data-testid="duplicate-param-warning">
                          <AlertTriangle size={14} /> Duplicate parameter identifier: &quot;{duplicateParamNames.join(', ')}&quot;. Parameter names must be unique.
                        </div>
                      )}
                    </div>

                    {/* Live Multi-Language Signature Preview */}
                    <div className="sig-preview-card" data-testid="signature-preview-card">
                      <div className="sig-preview-header">
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Code2 size={14} color="#38bdf8" /> Live Multi-Language Signature Preview
                        </span>
                        <div className="sig-preview-tabs">
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <button
                              key={lang.id}
                              type="button"
                              className={`sig-preview-tab-btn ${previewLang === lang.id ? 'active' : ''}`}
                              onClick={() => setPreviewLang(lang.id)}
                              data-testid={`sig-preview-lang-${lang.id}`}
                            >
                              {lang.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <pre className="sig-preview-code" data-testid="sig-preview-display">
                        {previewSignature}
                      </pre>
                    </div>

                    {generateNotice && (
                      <div className="mode-switch-alert" data-testid="generate-templates-notice" style={{ marginTop: '10px' }}>
                        <CheckCircle2 size={16} style={{ color: '#4ade80', flexShrink: 0 }} />
                        <span>{generateNotice}</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <label className="editor-label" style={{ margin: 0 }}>
                        Server-Side Test Harness (<code>harnessBuilder.js</code> integration)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {((formData.harnessTemplates[selectedLanguage] || '').includes('__STUDENT_CODE__')) ? (
                          <span className="harness-tag valid" data-testid="harness-valid-badge">
                            <CheckCircle2 size={12} /> Placeholder <code>__STUDENT_CODE__</code> Active
                          </span>
                        ) : (
                          <span className="harness-tag warning" data-testid="harness-missing-badge">
                            <AlertTriangle size={12} /> Missing <code>__STUDENT_CODE__</code>
                          </span>
                        )}

                        {!((formData.harnessTemplates[selectedLanguage] || '').includes('__STUDENT_CODE__')) && (
                          <button
                            className="btn-subaction"
                            type="button"
                            onClick={() => {
                              const current = formData.harnessTemplates[selectedLanguage] || '';
                              const updated = current + '\n// __STUDENT_CODE__\n';
                              setFormData({
                                ...formData,
                                harnessTemplates: { ...formData.harnessTemplates, [selectedLanguage]: updated },
                              });
                            }}
                            data-testid="btn-insert-placeholder"
                          >
                            <Plus size={11} /> Insert Placeholder
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="lang-tabs-bar">
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <button
                          key={lang.id}
                          className={`lang-tab-btn ${selectedLanguage === lang.id ? 'active' : ''}`}
                          onClick={() => setSelectedLanguage(lang.id)}
                          type="button"
                          data-testid={`harness-lang-tab-${lang.id}`}
                        >
                          {lang.label}
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
                    <span className={`gov-val status-badge ${formData.isPublished ? 'published' : 'draft'}`} data-testid="gov-status-badge">
                      {formData.isPublished ? 'PUBLISHED' : (formData.reviewStatus || 'DRAFT').toUpperCase()}
                    </span>
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

      {/* 3. Phase 7.4.9 Student Preview Modal */}
      {isPreviewOpen && previewData && (
        <div className="editor-modal-backdrop" data-testid="student-preview-modal">
          <div className="editor-modal-container preview-modal-dialog">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Eye size={20} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                  Student Problem Preview
                </h3>
                <span className="preview-badge-student">Student View Simulation</span>
                <span className={`editor-status-badge ${previewData.isPublished ? 'published' : 'draft'}`}>
                  {previewData.isPublished ? 'PUBLISHED' : 'DRAFT'}
                </span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsPreviewOpen(false)}
                data-testid="preview-close-btn"
                title="Close Preview"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', padding: '20px' }}>
              {/* Header Info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc' }} data-testid="preview-title">
                  {previewData.title || 'Untitled Problem'}
                </h2>
                <span className={`preview-diff-pill ${previewData.difficulty}`} data-testid="preview-difficulty">
                  {(previewData.difficulty || 'medium').toUpperCase()}
                </span>
                <span className="preview-mode-pill" data-testid="preview-coding-mode">
                  {previewData.codingMode === 'function' ? 'Function Mode' : 'Standard OJ'}
                </span>
              </div>

              {/* Problem Description */}
              <div className="preview-section-card">
                <h4 className="preview-section-title">Problem Statement</h4>
                <div
                  className="preview-markdown-content"
                  style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#e2e8f0' }}
                  data-testid="preview-description"
                >
                  {previewData.description || 'No description provided.'}
                </div>
              </div>

              {/* Constraints */}
              {previewData.constraints && (
                <div className="preview-section-card" style={{ marginTop: '16px' }}>
                  <h4 className="preview-section-title">Constraints</h4>
                  <pre
                    className="preview-code-block"
                    style={{ margin: 0, padding: '10px 14px', background: '#090d16', borderRadius: '6px', fontSize: '0.85rem', color: '#fca5a5' }}
                    data-testid="preview-constraints"
                  >
                    {previewData.constraints}
                  </pre>
                </div>
              )}

              {/* Examples / Sample Test Cases */}
              <div className="preview-section-card" style={{ marginTop: '16px' }}>
                <h4 className="preview-section-title">Sample Test Cases (Visible to Students)</h4>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                  Strictly non-hidden sample test cases are displayed. Private test cases and judge secrets remain hidden.
                </p>
                {(previewData.sampleTestCases && previewData.sampleTestCases.length > 0) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="preview-sample-cases-list">
                    {previewData.sampleTestCases.map((tc, idx) => (
                      <div
                        key={tc.id || idx}
                        className="preview-example-item"
                        style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px 14px' }}
                        data-testid={`preview-sample-case-${idx}`}
                      >
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#38bdf8', marginBottom: '8px' }}>
                          Example {idx + 1}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Input:</span>
                            <pre style={{ margin: '4px 0 0 0', padding: '8px 10px', background: '#030712', borderRadius: '4px', fontSize: '0.82rem', color: '#cbd5e1' }}>
                              {tc.inputData || '(Empty input)'}
                            </pre>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Expected Output:</span>
                            <pre style={{ margin: '4px 0 0 0', padding: '8px 10px', background: '#030712', borderRadius: '4px', fontSize: '0.82rem', color: '#86efac' }}>
                              {tc.expectedOutput || '(Empty output)'}
                            </pre>
                          </div>
                        </div>
                        {tc.explanation && (
                          <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#94a3b8' }}>
                            <strong>Explanation:</strong> {tc.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '12px', background: '#1e293b', borderRadius: '6px', color: '#94a3b8', fontSize: '0.85rem' }}>
                    No sample test cases configured yet.
                  </div>
                )}
              </div>

              {/* Starter Code Preview */}
              <div className="preview-section-card" style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 className="preview-section-title" style={{ margin: 0 }}>Starter Code Template</h4>
                  <select
                    className="editor-select"
                    value={previewActiveLang}
                    onChange={(e) => setPreviewActiveLang(e.target.value)}
                    style={{ width: 'auto', padding: '4px 10px', fontSize: '0.82rem' }}
                    data-testid="preview-lang-select"
                  >
                    {(previewData.allowedLanguages || SUPPORTED_LANGUAGES.map((l) => l.id)).map((lang) => (
                      <option key={lang} value={lang}>
                        {SUPPORTED_LANGUAGES.find((sl) => sl.id === lang)?.name || lang}
                      </option>
                    ))}
                  </select>
                </div>
                <pre
                  style={{ margin: 0, padding: '14px', background: '#090d16', borderRadius: '8px', fontSize: '0.85rem', color: '#cbd5e1', overflowX: 'auto', border: '1px solid #1e293b' }}
                  data-testid="preview-starter-code"
                >
                  {previewData.starterTemplates?.[previewActiveLang] || '// No starter code provided for this language.'}
                </pre>
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #1e293b' }}>
              <button
                className="btn-secondary"
                onClick={() => setIsPreviewOpen(false)}
                data-testid="preview-dismiss-btn"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Phase 7.4.9 Publish Validation Failure Modal */}
      {publishErrors && (
        <div className="editor-modal-backdrop" data-testid="publish-errors-modal">
          <div className="editor-modal-container publish-errors-dialog">
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} style={{ color: '#f87171' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f87171' }}>
                  Publication Validation Failed
                </h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setPublishErrors(null)}
                data-testid="publish-errors-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.88rem', color: '#cbd5e1' }}>
                The problem does not yet meet all platform publication safety requirements. Please address the following issues before publishing:
              </p>

              <div className="publish-errors-list" data-testid="publish-errors-list">
                {publishErrors.map((err, idx) => {
                  const targetTab = getTabForPublishError(err);
                  return (
                    <div
                      key={idx}
                      className="publish-error-row"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#2d1215', border: '1px solid #7f1d1d', borderRadius: '6px', marginBottom: '8px' }}
                      data-testid={`publish-error-item-${idx}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fca5a5', fontSize: '0.85rem' }}>
                        <XCircle size={15} style={{ flexShrink: 0 }} />
                        <span>{err}</span>
                      </div>
                      <button
                        className="btn-jump-tab"
                        onClick={() => {
                          setActiveTab(targetTab);
                          setPublishErrors(null);
                        }}
                        data-testid={`jump-tab-${targetTab}`}
                        title={`Navigate to ${targetTab.replace('_', ' ')} tab`}
                      >
                        Fix in {targetTab.replace('_', ' ')} &rarr;
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #1e293b' }}>
              <button
                className="btn-secondary"
                onClick={() => setPublishErrors(null)}
                data-testid="publish-errors-dismiss-btn"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Phase 7.4.9 Publish Success Modal */}
      {publishSuccessInfo && (
        <div className="editor-modal-backdrop" data-testid="publish-success-modal">
          <div className="editor-modal-container publish-success-dialog" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle2 size={22} style={{ color: '#22c55e' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#86efac' }}>
                  Problem Published!
                </h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setPublishSuccessInfo(null)}
                data-testid="publish-success-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', color: '#22c55e' }}>
                <UploadCloud size={30} />
              </div>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', color: '#f8fafc' }}>
                {formData.title}
              </h4>
              <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#cbd5e1' }}>
                Successfully published to the student catalog as <strong style={{ color: '#86efac' }}>Version {publishSuccessInfo.version}</strong>. An immutable snapshot has been stored in version history.
              </p>
            </div>

            <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'center', padding: '14px 20px', borderTop: '1px solid #1e293b' }}>
              <button
                className="btn-secondary"
                onClick={() => setPublishSuccessInfo(null)}
                data-testid="btn-stay-published"
              >
                Stay in Editor
              </button>
              <button
                className="btn-primary"
                onClick={onBack}
                data-testid="btn-view-catalog"
              >
                Back to Problems
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Phase 7.4.9 Concurrency Conflict Modal */}
      {showConflictModal && (
        <div className="editor-modal-backdrop" data-testid="concurrency-conflict-modal">
          <div className="editor-modal-container concurrency-conflict-dialog" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} style={{ color: '#fbbf24' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fbbf24' }}>
                  Optimistic Concurrency Conflict
                </h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setShowConflictModal(false)}
                data-testid="conflict-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#f8fafc' }}>
                This problem was modified in another session.
              </p>
              <div style={{ background: '#1e293b', padding: '12px 16px', borderRadius: '6px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>
                <div>Your local version: <strong style={{ color: '#f87171' }}>v{formData.version}</strong></div>
                <div>Server latest version: <strong style={{ color: '#86efac' }}>v{conflictVersion || (formData.version + 1)}</strong></div>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1' }}>
                To prevent silent overwrites of concurrent modifications, you must reload the latest version before submitting further changes.
              </p>
            </div>

            <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #1e293b' }}>
              <button className="btn-secondary" onClick={() => setShowConflictModal(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleConflictReload}
                disabled={isReloadingConflict}
                data-testid="btn-reload-latest"
              >
                {isReloadingConflict ? 'Reloading...' : 'Reload Latest Problem'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Phase 7.4.9 Version History Modal */}
      {isVersionHistoryOpen && (
        <div className="editor-modal-backdrop" data-testid="version-history-modal">
          <div className="editor-modal-container versions-modal-dialog" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <History size={20} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                  Publication Version History
                </h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsVersionHistoryOpen(false)}
                data-testid="versions-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', padding: '20px' }}>
              {versionHistoryLoading && (
                <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>Loading versions snapshot audit trail...</p>
              )}
              {versionHistoryError && (
                <div className="editor-alert-box error">
                  <AlertCircle size={15} />
                  <span>{versionHistoryError}</span>
                </div>
              )}
              {!versionHistoryLoading && !versionHistoryError && versionHistory.length === 0 && (
                <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>
                  No published version snapshots recorded yet. When you publish this problem, immutable snapshots will appear here.
                </p>
              )}
              {!versionHistoryLoading && versionHistory.length > 0 && (
                <div className="versions-timeline" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} data-testid="versions-timeline-list">
                  {versionHistory.map((ver, idx) => (
                    <div
                      key={ver.id || idx}
                      className="version-history-item"
                      style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      data-testid={`version-item-${ver.versionNumber || ver.version_number}`}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.95rem' }}>
                            Version {ver.versionNumber || ver.version_number}
                          </span>
                          <span className="status-badge published" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                            PUBLISHED SNAPSHOT
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                          {ver.changeSummary || ver.change_summary || 'Publication snapshot'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                          {ver.createdAt || ver.created_at ? new Date(ver.createdAt || ver.created_at).toLocaleString() : 'Timestamp unavailable'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid #1e293b' }}>
              <button
                className="btn-secondary"
                onClick={() => setIsVersionHistoryOpen(false)}
                data-testid="versions-dismiss-btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
