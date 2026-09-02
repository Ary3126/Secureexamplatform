import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Trophy,
  BookOpen,
  Plus,
  Inbox,
  Sparkles,
  BarChart3,
  ChevronRight,
  ShieldCheck,
  RotateCcw,
  Save,
  Send,
  Eye,
  History,
  GitCompare,
  Layers,
  Archive,
  Trash2,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Info,
  HelpCircle,
  Search,
  ArrowRight,
  UserCheck,
  Code2,
  FileText,
  X,
  Globe,
} from 'lucide-react';

import StatusBadge from './authoring/StatusBadge';
import LifecycleStepper from './authoring/LifecycleStepper';
import QualityScoreCard from './authoring/QualityScoreCard';
import EditorialChecklistCard from './authoring/EditorialChecklistCard';
import ProblemTable from './authoring/ProblemTable';
import ProblemActionMenu from './authoring/ProblemActionMenu';
import ReviewWorkflowCard from './authoring/ReviewWorkflowCard';
import VersionTimeline from './authoring/VersionTimeline';
import VersionDiffModal from './authoring/VersionDiffModal';
import SchedulePublishModal from './authoring/SchedulePublishModal';
import DependencyImpactCard from './authoring/DependencyImpactCard';
import ConfirmationModal from './authoring/ConfirmationModal';
import ContestManagementCard from './authoring/ContestManagementCard';
import ProfessorDashboardOverview from './authoring/ProfessorDashboardOverview';
import AuthoringLoadingState from './authoring/AuthoringLoadingState';
import AuthoringEmptyState from './authoring/AuthoringEmptyState';

/**
 * Task-Oriented Professor Academic & Contest Authoring Studio
 * Academic Problem Bank, Examination Management, Peer Reviews, and Quality Checks.
 */
export default function ProblemAuthoringStudio({
  token,
  currentUser,
  onSelectProblem,
  initialSection = 'dashboard',
  initialOpenCreateContest = false,
}) {
  // Navigation Section: 'dashboard' | 'contests' | 'problems' | 'editor' | 'reviews'
  const [navSection, setNavSection] = useState(
    initialSection === 'create_contest' ? 'contests' : (initialSection || 'dashboard')
  );
  const [editorSubTab, setEditorSubTab] = useState('statement'); // 'statement', 'testcases', 'quality', 'reviews', 'revisions', 'dependencies'

  // Data State
  const [contests, setContests] = useState([]);
  const [problems, setProblems] = useState([]);
  const [selectedProblemId, setSelectedProblemId] = useState(null);
  const [selectedContestId, setSelectedContestId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [conflictError, setConflictError] = useState(null);

  // Contest Creation Modal State
  const [createContestModalOpen, setCreateContestModalOpen] = useState(
    initialOpenCreateContest || initialSection === 'create_contest' || false
  );
  const [newContestData, setNewContestData] = useState({
    title: '',
    description: '',
    startTime: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
    endTime: new Date(Date.now() + 25 * 3600 * 1000).toISOString().slice(0, 16),
  });

  useEffect(() => {
    if (initialSection) {
      setNavSection(initialSection === 'create_contest' ? 'contests' : initialSection);
    }
    if (initialOpenCreateContest || initialSection === 'create_contest') {
      setCreateContestModalOpen(true);
    }
  }, [initialSection, initialOpenCreateContest]);

  // Quality & Editorial State
  const [qualityData, setQualityData] = useState(null);
  const [checklistData, setChecklistData] = useState(null);
  const [similarityData, setSimilarityData] = useState(null);
  const [reviewAnalyticsData, setReviewAnalyticsData] = useState(null);
  const [loadingQuality, setLoadingQuality] = useState(false);

  // Lifecycle, Version Compare & Rollback State
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffData, setDiffData] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [dependencyData, setDependencyData] = useState(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  // Active Problem Form State
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    difficulty: 'easy',
    codingMode: 'full_program',
    accessScope: 'contest_private',
    version: 1,
    isPublished: false,
    reviewStatus: 'draft',
    approvedVersion: null,
    createdBy: null,
    scheduledPublishAt: null,
    starterTemplates: {
      python: '# Write your solution here\n',
      cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your solution here\n    return 0;\n}\n',
      java: 'import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        // Write your solution here\n    }\n}\n',
    },
    harnessTemplates: {
      python: 'def solve():\n    pass\n',
      cpp: 'void solve() {}\n',
      java: 'class Solution { void solve() {} }\n',
    },
  });

  // Test Cases & Validation
  const [testCases, setTestCases] = useState([]);
  const [loadingTestCases, setLoadingTestCases] = useState(false);
  const [newTestCase, setNewTestCase] = useState({
    inputData: '',
    expectedOutput: '',
    isHidden: false,
    timeLimitMs: 2000,
    memoryLimitMb: 128,
  });

  // Reviews & History
  const [revisions, setRevisions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [activeReviewDetail, setActiveReviewDetail] = useState(null);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  // Confirmation Modals State
  const [confirmModalConfig, setConfirmModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    consequenceText: '',
    confirmLabel: 'Confirm',
    confirmVariant: 'primary',
    actionKey: null,
  });

  // Selected language for starter templates tab
  const [selectedLang, setSelectedLang] = useState('python');

  // Fetch Contests
  const fetchContests = useCallback(async () => {
    try {
      const res = await fetch('/api/contests?limit=50', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        setContests(data.contests || data || []);
      }
    } catch (err) {
      console.error('Failed to fetch contests:', err);
    }
  }, [token]);

  // Fetch author's problems
  const fetchProblems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/problems?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setProblems(data.problems || []);
        if (data.problems?.length > 0 && !selectedProblemId) {
          setSelectedProblemId(data.problems[0].id);
        }
      } else {
        setError(data.message || 'Failed to load problems');
      }
    } catch (err) {
      setError('Network error while loading problems');
    } finally {
      setLoading(false);
    }
  }, [token, selectedProblemId]);

  // Fetch Review Queue for Reviewers
  const fetchReviewQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/problem-reviews?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setReviewQueue(data.reviews || []);
      }
    } catch (err) {}
  }, [token]);

  useEffect(() => {
    fetchContests();
    fetchProblems();
    if (currentUser?.role === 'super_admin' || currentUser?.role === 'professor' || currentUser?.role === 'contest_admin') {
      fetchReviewQueue();
    }
  }, [fetchContests, fetchProblems, fetchReviewQueue, currentUser]);

  // Load single problem details when selected
  const loadProblemDetail = useCallback(async (probId) => {
    if (!probId) return;
    try {
      setLoading(true);
      setError(null);
      setConflictError(null);

      // 1. Problem details
      const res = await fetch(`/api/problems/${probId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        setFormData({
          title: data.title || '',
          description: data.description || '',
          difficulty: data.difficulty || 'easy',
          codingMode: data.codingMode || 'full_program',
          accessScope: data.accessScope || 'contest_private',
          version: data.version || 1,
          isPublished: Boolean(data.isPublished),
          reviewStatus: data.reviewStatus || 'draft',
          approvedVersion: data.approvedVersion,
          createdBy: data.createdBy,
          scheduledPublishAt: data.scheduledPublishAt,
          starterTemplates: data.starterTemplates || {},
          harnessTemplates: data.harnessTemplates || {},
        });
      }

      // 2. Administrative test cases
      setLoadingTestCases(true);
      const tcRes = await fetch(`/api/problems/${probId}/test-cases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tcData = await tcRes.json();
      if (tcRes.ok) {
        setTestCases(tcData.testCases || []);
      }

      // 3. Revisions
      const revRes = await fetch(`/api/problems/${probId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const revData = await revRes.json();
      if (revRes.ok) {
        setRevisions(revData.versions || []);
      }

      // 4. Reviews
      const rRes = await fetch(`/api/problems/${probId}/reviews`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rData = await rRes.json();
      if (rRes.ok) {
        setReviews(rData.reviews || []);
        if (rData.reviews?.length > 0) {
          const detailRes = await fetch(`/api/problems/${probId}/reviews/${rData.reviews[0].id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const detailData = await detailRes.json();
          if (detailRes.ok) setActiveReviewDetail(detailData.review);
        } else {
          setActiveReviewDetail(null);
        }
      }

      // 5. Fetch Quality, Editorial Checklist, Similarity, and Analytics
      try {
        setLoadingQuality(true);
        const [qRes, cRes, sRes, aRes, depRes] = await Promise.all([
          fetch(`/api/problems/${probId}/quality`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/problems/${probId}/editorial-checklist`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/problems/${probId}/similarity`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/problems/${probId}/review-analytics`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`/api/problems/${probId}/dependencies`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (qRes.ok) setQualityData(await qRes.json());
        if (cRes.ok) setChecklistData(await cRes.json());
        if (sRes.ok) setSimilarityData(await sRes.json());
        if (aRes.ok) {
          const aData = await aRes.json();
          setReviewAnalyticsData(aData.analytics);
        }
        if (depRes.ok) {
          const depData = await depRes.json();
          setDependencyData(depData.impact);
        }
      } catch (err) {
        console.error('Error fetching quality/analytics:', err);
      } finally {
        setLoadingQuality(false);
      }
    } catch (err) {
      setError('Failed to fetch problem details');
    } finally {
      setLoading(false);
      setLoadingTestCases(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedProblemId) {
      loadProblemDetail(selectedProblemId);
    }
  }, [selectedProblemId, loadProblemDetail]);

  // Create New Problem Draft
  const handleCreateNewProblem = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch('/api/problems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'New Problem Draft',
          description: '### Problem Statement\n\nDescribe the problem here.\n\n### Input Format\n\n### Output Format\n\n### Constraints\n',
          difficulty: 'easy',
          codingMode: 'full_program',
          accessScope: 'contest_private',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Created new problem draft');
        fetchProblems();
        setSelectedProblemId(data.problem.id);
        setNavSection('editor');
        setEditorSubTab('statement');
      } else {
        setError(data.message || 'Failed to create problem');
      }
    } catch (err) {
      setError('Network error while creating problem');
    } finally {
      setSaving(false);
    }
  };

  // Create New Contest
  const handleCreateContest = async (e) => {
    e.preventDefault();
    if (!newContestData.title.trim()) {
      setError('Contest title is required');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch('/api/contests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: newContestData.title,
          description: newContestData.description,
          startTime: new Date(newContestData.startTime).toISOString(),
          endTime: new Date(newContestData.endTime).toISOString(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Contest "${data.title || newContestData.title}" created successfully`);
        setCreateContestModalOpen(false);
        setNewContestData({
          title: '',
          description: '',
          startTime: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
          endTime: new Date(Date.now() + 25 * 3600 * 1000).toISOString().slice(0, 16),
        });
        fetchContests();
      } else {
        setError(data.message || 'Failed to create contest');
      }
    } catch (err) {
      setError('Network error creating contest');
    } finally {
      setSaving(false);
    }
  };

  // Publish Contest
  const handlePublishContest = async (contestId) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/contests/${contestId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Contest published and live!');
        fetchContests();
      } else {
        setError(data.message || 'Failed to publish contest');
      }
    } catch (err) {
      setError('Network error publishing contest');
    } finally {
      setSaving(false);
    }
  };

  // Save / Update Problem Draft with Optimistic Concurrency Check
  const handleSaveProblem = async () => {
    if (!selectedProblemId) return;
    try {
      setSaving(true);
      setError(null);
      setConflictError(null);
      setSuccessMsg(null);

      const res = await fetch(`/api/problems/${selectedProblemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          difficulty: formData.difficulty,
          codingMode: formData.codingMode,
          starterTemplates: formData.starterTemplates,
          harnessTemplates: formData.harnessTemplates,
          accessScope: formData.accessScope,
          expectedVersion: formData.version,
        }),
      });

      const data = await res.json();
      if (res.status === 409) {
        setConflictError('Conflict: Problem was modified in another session. Please reload to see latest version.');
      } else if (res.ok) {
        setSuccessMsg('Problem saved successfully');
        setFormData((prev) => ({
          ...prev,
          version: data.problem.version,
          isPublished: data.problem.isPublished,
          reviewStatus: data.problem.reviewStatus || 'draft',
        }));
        fetchProblems();
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Failed to save problem');
      }
    } catch (err) {
      setError('Network error while saving problem');
    } finally {
      setSaving(false);
    }
  };

  // Handle Publish Problem
  const handlePublish = async () => {
    if (!selectedProblemId) return;
    try {
      setPublishing(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Problem published successfully to the Problem Bank!');
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || (data.errors ? data.errors.join(', ') : 'Publish failed'));
      }
    } catch (err) {
      setError('Network error during publication');
    } finally {
      setPublishing(false);
    }
  };

  // Handle Unpublish
  const handleUnpublish = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/unpublish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Unpublish failed');
      }
    } catch (err) {
      setError('Network error during unpublish');
    } finally {
      setSaving(false);
    }
  };

  // Handle Archive
  const handleArchive = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Archive failed');
      }
    } catch (err) {
      setError('Network error during archive');
    } finally {
      setSaving(false);
    }
  };

  // Handle Restore Archive
  const handleRestoreArchive = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/restore-archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Restore archive failed');
      }
    } catch (err) {
      setError('Network error during restore archive');
    } finally {
      setSaving(false);
    }
  };

  // Handle Submit for Review
  const handleSubmitForReview = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/review-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment: `Review request for Version ${formData.version}` }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Submitted for peer review. Reviewers have been notified.');
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Failed to submit review request');
      }
    } catch (err) {
      setError('Network error while requesting review');
    } finally {
      setSaving(false);
    }
  };

  // Handle Start Review
  const handleStartReview = async () => {
    if (!activeReviewDetail) return;
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/review/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Review started. You are now the assigned reviewer.');
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Failed to start review');
      }
    } catch (err) {
      setError('Network error starting review');
    } finally {
      setSaving(false);
    }
  };

  // Handle Approve Review
  const handleApproveReview = async (note) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/review/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Version ${formData.version} approved successfully! Problem is ready to publish.`);
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Approval failed');
      }
    } catch (err) {
      setError('Network error approving review');
    } finally {
      setSaving(false);
    }
  };

  // Handle Request Changes
  const handleRequestChanges = async (comment) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/review/request-changes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Changes requested. Author has been notified.');
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Failed to request changes');
      }
    } catch (err) {
      setError('Network error requesting changes');
    } finally {
      setSaving(false);
    }
  };

  // Handle Reject Review
  const handleRejectReview = async (comment) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/review/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Problem review rejected.');
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Failed to reject review');
      }
    } catch (err) {
      setError('Network error rejecting review');
    } finally {
      setSaving(false);
    }
  };

  // Handle Add Review Comment
  const handleAddComment = async (text) => {
    if (!activeReviewDetail || !text.trim()) return;
    try {
      const res = await fetch(`/api/problems/${selectedProblemId}/review/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comment: text }),
      });
      if (res.ok) {
        loadProblemDetail(selectedProblemId);
      }
    } catch (err) {}
  };

  // Handle Quality Check
  const handleRunQualityCheck = async () => {
    try {
      setLoadingQuality(true);
      setError(null);
      const [qRes, cRes] = await Promise.all([
        fetch(`/api/problems/${selectedProblemId}/quality`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/problems/${selectedProblemId}/editorial-checklist`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (qRes.ok) setQualityData(await qRes.json());
      if (cRes.ok) setChecklistData(await cRes.json());
      setSuccessMsg('Quality & Editorial evaluation completed');
    } catch (err) {
      setError('Failed to run quality check');
    } finally {
      setLoadingQuality(false);
    }
  };

  // Handle Rollback
  const handleRollback = async (targetVersion, changeSummary) => {
    try {
      setRollbackLoading(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/versions/${targetVersion}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changeSummary }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        loadProblemDetail(selectedProblemId);
        fetchProblems();
      } else {
        setError(data.message || 'Rollback failed');
      }
    } catch (err) {
      setError('Network error during rollback');
    } finally {
      setRollbackLoading(false);
    }
  };

  // Handle Version Comparison
  const handleCompareVersions = async (v1, v2) => {
    try {
      setLoadingDiff(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/versions/compare?v1=${v1}&v2=${v2}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setDiffData(data.diff);
        setDiffModalOpen(true);
      } else {
        setError(data.message || 'Version comparison failed');
      }
    } catch (err) {
      setError('Network error during version comparison');
    } finally {
      setLoadingDiff(false);
    }
  };

  // Handle Schedule Publish
  const handleSchedulePublish = async (isoDate) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/schedule-publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scheduledPublishAt: isoDate }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        setScheduleModalOpen(false);
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Scheduling failed');
      }
    } catch (err) {
      setError('Network error during schedule publication');
    } finally {
      setSaving(false);
    }
  };

  // Handle Cancel Schedule
  const handleCancelSchedule = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/schedule-publish`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(data.message);
        setScheduleModalOpen(false);
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Cancel schedule failed');
      }
    } catch (err) {
      setError('Network error during cancelling schedule');
    } finally {
      setSaving(false);
    }
  };

  // Handle Add Test Case
  const handleAddTestCase = async (e) => {
    e.preventDefault();
    if (!newTestCase.inputData.trim() || !newTestCase.expectedOutput.trim()) {
      setError('Test case input and output are required');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/test-cases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newTestCase),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Test case added successfully');
        setNewTestCase({ inputData: '', expectedOutput: '', isHidden: false, timeLimitMs: 2000, memoryLimitMb: 128 });
        loadProblemDetail(selectedProblemId);
      } else {
        setError(data.message || 'Failed to add test case');
      }
    } catch (err) {
      setError('Network error adding test case');
    } finally {
      setSaving(false);
    }
  };

  // Handle Delete Test Case
  const handleDeleteTestCase = async (testCaseId) => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/test-cases/${testCaseId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSuccessMsg('Test case deleted');
        loadProblemDetail(selectedProblemId);
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to delete test case');
      }
    } catch (err) {
      setError('Network error deleting test case');
    } finally {
      setSaving(false);
    }
  };

  // Handle Clone Problem
  const handleCloneProblem = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/clone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `Copy of ${formData.title}`,
          accessScope: 'contest_private',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg('Problem cloned successfully into a new draft');
        fetchProblems();
        setSelectedProblemId(data.problem.id);
        setNavSection('editor');
      } else {
        setError(data.message || 'Failed to clone problem');
      }
    } catch (err) {
      setError('Network error while cloning problem');
    } finally {
      setSaving(false);
    }
  };

  // Handle Open Student Preview
  const handleOpenPreview = async () => {
    try {
      setError(null);
      const res = await fetch(`/api/problems/${selectedProblemId}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setPreviewData(data);
        setPreviewModalOpen(true);
      } else {
        setError(data.message || 'Preview not available');
      }
    } catch (err) {
      setError('Network error loading student preview');
    }
  };

  // Action Dispatcher for ProblemActionMenu
  const handleActionMenuDispatch = (actionKey) => {
    if (actionKey === 'save') handleSaveProblem();
    else if (actionKey === 'request_review') handleSubmitForReview();
    else if (actionKey === 'publish') {
      setConfirmModalConfig({
        isOpen: true,
        title: 'Publish Problem to Bank',
        message: `Publish Version ${formData.version} (${formData.title}) to the public problem bank?`,
        consequenceText: 'Problem will become publicly discoverable by students and available for contest assignment.',
        confirmLabel: 'Confirm & Publish',
        confirmVariant: 'success',
        actionKey: 'publish',
      });
    } else if (actionKey === 'unpublish') {
      setConfirmModalConfig({
        isOpen: true,
        title: 'Unpublish Problem',
        message: `Withdraw ${formData.title} from the public problem bank?`,
        consequenceText: 'Problem will be hidden from student explorer and restricted to contest_private access.',
        confirmLabel: 'Confirm Unpublish',
        confirmVariant: 'danger',
        actionKey: 'unpublish',
      });
    } else if (actionKey === 'archive') {
      setConfirmModalConfig({
        isOpen: true,
        title: 'Archive Problem',
        message: `Archive ${formData.title}?`,
        consequenceText: 'Problem will be soft-locked and cannot be used in new contests. (Blocked if active in contests).',
        confirmLabel: 'Confirm Archive',
        confirmVariant: 'warning',
        actionKey: 'archive',
      });
    } else if (actionKey === 'restore_archive') {
      handleRestoreArchive();
    } else if (actionKey === 'schedule') {
      setScheduleModalOpen(true);
    } else if (actionKey === 'preview') {
      handleOpenPreview();
    } else if (actionKey === 'clone') {
      handleCloneProblem();
    } else if (actionKey === 'history') {
      setNavSection('editor');
      setEditorSubTab('revisions');
    } else if (actionKey === 'quality') {
      setNavSection('editor');
      setEditorSubTab('quality');
    } else if (actionKey === 'dependencies') {
      setNavSection('editor');
      setEditorSubTab('dependencies');
    }
  };

  const handleConfirmModalExecution = () => {
    const key = confirmModalConfig.actionKey;
    setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }));
    if (key === 'publish') handlePublish();
    else if (key === 'unpublish') handleUnpublish();
    else if (key === 'archive') handleArchive();
  };

  const isAuthor = currentUser && formData.createdBy === currentUser.id;
  const isReadyToPublish = formData.reviewStatus === 'approved' && formData.approvedVersion === formData.version;

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: '#090d16', color: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Top Professor Navigation Bar */}
      <div style={{ background: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen size={22} color="#38bdf8" />
            <span style={{ fontWeight: '800', fontSize: '1.05rem', color: '#f8fafc' }}>
              Professor Studio
            </span>
          </div>

          {/* Primary Nav Tabs */}
          <nav style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setNavSection('dashboard')}
              style={{
                background: navSection === 'dashboard' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: navSection === 'dashboard' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <LayoutDashboard size={15} /> Dashboard
            </button>

            <button
              onClick={() => setNavSection('contests')}
              style={{
                background: navSection === 'contests' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: navSection === 'contests' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trophy size={15} /> My Contests ({contests.length})
            </button>

            <button
              onClick={() => setNavSection('problems')}
              style={{
                background: navSection === 'problems' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: navSection === 'problems' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <BookOpen size={15} /> My Problems ({problems.length})
            </button>

            {selectedProblemId && (
              <button
                onClick={() => setNavSection('editor')}
                style={{
                  background: navSection === 'editor' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                  color: navSection === 'editor' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Code2 size={15} /> Problem Studio
              </button>
            )}

            <button
              onClick={() => setNavSection('reviews')}
              style={{
                background: navSection === 'reviews' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: navSection === 'reviews' ? '#38bdf8' : '#94a3b8',
                border: 'none',
                padding: '8px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Inbox size={15} /> Reviews {reviewQueue.length > 0 && `(${reviewQueue.length})`}
            </button>
          </nav>
        </div>

        {/* Top Right Quick Creation Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setCreateContestModalOpen(true)}
            style={{
              background: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Trophy size={15} /> New Contest
          </button>

          <button
            onClick={handleCreateNewProblem}
            disabled={saving}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Plus size={16} /> New Problem
          </button>
        </div>
      </div>

      {/* Notifications & Error Banners */}
      {conflictError && (
        <div style={{ padding: '10px 24px', background: 'rgba(239, 68, 68, 0.2)', borderBottom: '1px solid #ef4444', color: '#fca5a5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}><AlertTriangle size={18} /> {conflictError}</span>
          <button onClick={() => loadProblemDetail(selectedProblemId)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}>
            Reload Latest
          </button>
        </div>
      )}
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

      {/* 2. Main Content Area */}
      <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* SECTION A: DASHBOARD OVERVIEW */}
        {navSection === 'dashboard' && (
          <ProfessorDashboardOverview
            contests={contests}
            problems={problems}
            reviewQueue={reviewQueue}
            currentUser={currentUser}
            onNavigateSection={(sec) => setNavSection(sec)}
            onOpenCreateProblem={handleCreateNewProblem}
            onOpenCreateContest={() => setCreateContestModalOpen(true)}
            onSelectContest={(cid) => {
              setSelectedContestId(cid);
              setNavSection('contests');
            }}
            onSelectProblem={(pid) => {
              setSelectedProblemId(pid);
              setNavSection('editor');
            }}
          />
        )}

        {/* SECTION B: MY CONTESTS & VERIFICATION */}
        {navSection === 'contests' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: '0 0 6px 0', fontSize: '1.3rem', color: '#f8fafc' }}>
                  Contest & Examination Management
                </h2>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Inspect contest status, problem readiness, participant enrollment, and live results.
                </span>
              </div>

              <button
                onClick={() => setCreateContestModalOpen(true)}
                style={{
                  background: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Plus size={16} /> Create Contest
              </button>
            </div>

            {contests.length === 0 ? (
              <AuthoringEmptyState
                title="No Contests Created Yet"
                description="Create your first examination contest, configure dates, and attach problems from your problem bank."
                actionLabel="Create First Contest"
                onAction={() => setCreateContestModalOpen(true)}
                icon={Trophy}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {contests.map((c) => (
                  <ContestManagementCard
                    key={c.id}
                    contest={c}
                    isAuthor={currentUser && c.createdBy === currentUser.id}
                    onViewContest={(cid) => {
                      // Trigger workspace or contest view
                      window.location.href = `/contests/${cid}/leaderboard`;
                    }}
                    onManageProblems={(cid) => {
                      setNavSection('problems');
                    }}
                    onViewResults={(cid) => {
                      window.location.href = `/contests/${cid}/leaderboard`;
                    }}
                    onPublishContest={handlePublishContest}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION C: MY PROBLEMS DIRECTORY */}
        {navSection === 'problems' && (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.3rem', color: '#f8fafc' }}>
                Problem Bank Directory
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                Search, filter, and inspect all authored problem drafts, approved releases, and archived questions.
              </span>
            </div>

            <ProblemTable
              problems={problems}
              selectedProblemId={selectedProblemId}
              onSelectProblem={(id) => {
                setSelectedProblemId(id);
                setNavSection('editor');
              }}
              onCreateProblem={handleCreateNewProblem}
              onEditProblem={(id) => {
                setSelectedProblemId(id);
                setNavSection('editor');
              }}
            />
          </div>
        )}

        {/* SECTION D: PROBLEM EDITOR / STUDIO */}
        {navSection === 'editor' && (
          <div>
            {/* Clickable Breadcrumbs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '16px' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => setNavSection('dashboard')}>Panel Dashboard</span>
              <ChevronRight size={14} />
              <span style={{ cursor: 'pointer' }} onClick={() => setNavSection('problems')}>Problems</span>
              <ChevronRight size={14} />
              <span style={{ color: '#f8fafc', fontWeight: '600' }}>{formData.title || 'Untitled Problem'}</span>
            </div>

            {/* Problem Overview Card */}
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#f8fafc', fontWeight: '800' }}>
                      {formData.title || 'Untitled Problem'}
                    </h2>
                    <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 8px', borderRadius: '4px' }}>
                      Revision: v{formData.version || 1}
                    </span>
                    <StatusBadge status={formData.reviewStatus || (formData.isPublished ? 'published' : 'draft')} size="md" />
                  </div>

                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span>Difficulty: <strong style={{ color: '#e2e8f0', textTransform: 'uppercase' }}>{formData.difficulty}</strong></span> •
                    <span>Mode: <strong style={{ color: '#e2e8f0' }}>{formData.codingMode === 'function' ? 'Function Mode' : 'Full Program'}</strong></span> •
                    <span>Scope: <strong style={{ color: '#e2e8f0' }}>{formData.accessScope === 'public' ? 'Public Bank' : 'Contest Private'}</strong></span>
                  </div>
                </div>

                {/* Primary Action Area + More Actions Dropdown */}
                <ProblemActionMenu
                  status={formData.reviewStatus || (formData.isPublished ? 'published' : 'draft')}
                  isAuthor={isAuthor}
                  isPublished={formData.isPublished}
                  isReadyToPublish={isReadyToPublish}
                  isProcessing={saving || publishing}
                  onAction={handleActionMenuDispatch}
                />
              </div>
            </div>

            {/* Lifecycle Stepper & Contextual Guidance */}
            <LifecycleStepper
              status={formData.reviewStatus || (formData.isPublished ? 'published' : 'draft')}
              version={formData.version}
              approvedVersion={formData.approvedVersion}
              isAuthor={isAuthor}
              scheduledPublishAt={formData.scheduledPublishAt}
              onPrimaryAction={handleActionMenuDispatch}
            />

            {/* Sub-Navigation Tabs */}
            <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '20px' }}>
              <button
                onClick={() => setEditorSubTab('statement')}
                style={{
                  background: editorSubTab === 'statement' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'statement' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'statement' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <FileText size={15} /> Statement & Details
              </button>

              <button
                onClick={() => setEditorSubTab('testcases')}
                style={{
                  background: editorSubTab === 'testcases' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'testcases' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'testcases' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Layers size={15} /> Test Cases ({testCases.length})
              </button>

              <button
                onClick={() => setEditorSubTab('quality')}
                style={{
                  background: editorSubTab === 'quality' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'quality' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'quality' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Sparkles size={15} /> Quality & Checklist
              </button>

              <button
                onClick={() => setEditorSubTab('reviews')}
                style={{
                  background: editorSubTab === 'reviews' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'reviews' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'reviews' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <UserCheck size={15} /> Peer Review ({reviews.length})
              </button>

              <button
                onClick={() => setEditorSubTab('revisions')}
                style={{
                  background: editorSubTab === 'revisions' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'revisions' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'revisions' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <History size={15} /> Version History ({revisions.length})
              </button>

              <button
                onClick={() => setEditorSubTab('dependencies')}
                style={{
                  background: editorSubTab === 'dependencies' ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                  color: editorSubTab === 'dependencies' ? '#38bdf8' : '#94a3b8',
                  border: 'none',
                  borderBottom: editorSubTab === 'dependencies' ? '2px solid #38bdf8' : '2px solid transparent',
                  padding: '10px 16px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Layers size={15} /> Usage & Contests
              </button>
            </div>

            {/* SUBTAB 1: STATEMENT */}
            {editorSubTab === 'statement' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#e2e8f0', marginBottom: '6px' }}>
                      Problem Title
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="e.g. Binary Search Tree Validation"
                      style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.95rem', fontWeight: '600', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#e2e8f0', marginBottom: '6px' }}>
                      Problem Description (Markdown)
                    </label>
                    <textarea
                      rows={14}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Describe the problem, input format, output format, and constraints..."
                      style={{ width: '100%', padding: '12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontFamily: 'monospace', fontSize: '0.88rem', lineHeight: '1.5', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  </div>

                  {formData.codingMode === 'function' && (
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <label style={{ fontSize: '0.82rem', fontWeight: '700', color: '#e2e8f0' }}>
                          Function Starter Code Templates
                        </label>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {['python', 'cpp', 'java'].map((lang) => (
                            <button
                              key={lang}
                              onClick={() => setSelectedLang(lang)}
                              style={{
                                background: selectedLang === lang ? '#0284c7' : 'rgba(255,255,255,0.05)',
                                color: '#fff',
                                border: 'none',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                textTransform: 'uppercase',
                              }}
                            >
                              {lang}
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea
                        rows={6}
                        value={formData.starterTemplates?.[selectedLang] || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            starterTemplates: { ...formData.starterTemplates, [selectedLang]: e.target.value },
                          })
                        }
                        style={{ width: '100%', padding: '10px', background: '#090d16', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  )}
                </div>

                {/* Right Attributes Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '16px' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#f8fafc' }}>
                      Problem Attributes
                    </h4>

                    <div style={{ marginBottom: '14px' }}>
                      <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Difficulty</label>
                      <select
                        value={formData.difficulty}
                        onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                      <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Coding Mode</label>
                      <select
                        value={formData.codingMode}
                        onChange={(e) => setFormData({ ...formData, codingMode: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
                      >
                        <option value="full_program">Full Program (Standard I/O)</option>
                        <option value="function">Function Mode (Solution Class)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Access Scope</label>
                      <select
                        value={formData.accessScope}
                        onChange={(e) => setFormData({ ...formData, accessScope: e.target.value })}
                        style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
                      >
                        <option value="contest_private">Contest Private</option>
                        <option value="public">Public Bank</option>
                      </select>
                    </div>
                  </div>

                  <QualityScoreCard
                    qualityData={qualityData}
                    loading={loadingQuality}
                    onRunEvaluation={handleRunQualityCheck}
                    onViewChecklist={() => setEditorSubTab('quality')}
                  />
                </div>
              </div>
            )}

            {/* SUBTAB 2: TEST CASES */}
            {editorSubTab === 'testcases' && (
              <div>
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '18px', marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#f8fafc' }}>Add Test Case</h4>
                  <form onSubmit={handleAddTestCase}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Input Data</label>
                        <textarea
                          rows={4}
                          value={newTestCase.inputData}
                          onChange={(e) => setNewTestCase({ ...newTestCase, inputData: e.target.value })}
                          placeholder="e.g. 5\n1 2 3 4 5"
                          style={{ width: '100%', padding: '10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontFamily: 'monospace', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Expected Output</label>
                        <textarea
                          rows={4}
                          value={newTestCase.expectedOutput}
                          onChange={(e) => setNewTestCase({ ...newTestCase, expectedOutput: e.target.value })}
                          placeholder="e.g. 15"
                          style={{ width: '100%', padding: '10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontFamily: 'monospace', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: '#e2e8f0' }}>
                        <input
                          type="checkbox"
                          checked={newTestCase.isHidden}
                          onChange={(e) => setNewTestCase({ ...newTestCase, isHidden: e.target.checked })}
                        />
                        <span>Hidden Test Case (Used strictly for grading)</span>
                      </label>

                      <button
                        type="submit"
                        disabled={saving}
                        style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}
                      >
                        Add Test Case
                      </button>
                    </div>
                  </form>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {testCases.length === 0 ? (
                    <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                      No test cases created yet.
                    </div>
                  ) : (
                    testCases.map((tc, idx) => (
                      <div
                        key={tc.id || idx}
                        style={{
                          background: 'rgba(15, 23, 42, 0.6)',
                          border: tc.isHidden ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '8px',
                          padding: '14px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.85rem', color: tc.isHidden ? '#fbbf24' : '#38bdf8' }}>
                            Test Case #{idx + 1} {tc.isHidden ? '(Hidden)' : '(Sample Visible)'}
                          </span>
                          <button
                            onClick={() => handleDeleteTestCase(tc.id)}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
                            title="Delete Test Case"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.8rem' }}>
                          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px' }}>
                            <strong style={{ color: '#94a3b8' }}>Input:</strong>
                            <pre style={{ margin: '4px 0 0 0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{tc.inputData}</pre>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px' }}>
                            <strong style={{ color: '#94a3b8' }}>Output:</strong>
                            <pre style={{ margin: '4px 0 0 0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{tc.expectedOutput}</pre>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* SUBTAB 3: QUALITY */}
            {editorSubTab === 'quality' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <QualityScoreCard
                  qualityData={qualityData}
                  loading={loadingQuality}
                  onRunEvaluation={handleRunQualityCheck}
                />
                <EditorialChecklistCard
                  checklistData={checklistData}
                  onNavigateTab={(t) => setEditorSubTab(t)}
                />
              </div>
            )}

            {/* SUBTAB 4: REVIEWS */}
            {editorSubTab === 'reviews' && (
              <ReviewWorkflowCard
                activeReview={activeReviewDetail}
                currentUser={currentUser}
                isAuthor={isAuthor}
                isReviewer={currentUser && activeReviewDetail?.reviewerId === currentUser.id}
                reviewComments={activeReviewDetail?.comments || []}
                onStartReview={handleStartReview}
                onApproveReview={handleApproveReview}
                onRequestChanges={handleRequestChanges}
                onRejectReview={handleRejectReview}
                onAddComment={handleAddComment}
                isProcessing={saving}
              />
            )}

            {/* SUBTAB 5: REVISIONS */}
            {editorSubTab === 'revisions' && (
              <VersionTimeline
                revisions={revisions}
                currentVersion={formData.version}
                onCompareVersions={handleCompareVersions}
                onRollbackVersion={handleRollback}
                isProcessing={rollbackLoading}
              />
            )}

            {/* SUBTAB 6: DEPENDENCIES */}
            {editorSubTab === 'dependencies' && (
              <DependencyImpactCard
                dependencyData={dependencyData}
                loading={loadingQuality}
              />
            )}
          </div>
        )}

        {/* SECTION E: REVIEW QUEUE */}
        {navSection === 'reviews' && (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: '0 0 6px 0', fontSize: '1.3rem', color: '#f8fafc' }}>
                Peer Review Queue
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                Problems awaiting review, calibration, and editorial verification.
              </span>
            </div>

            {reviewQueue.length === 0 ? (
              <AuthoringEmptyState
                title="Review Queue is Clean"
                description="There are currently no problem review requests waiting in the queue."
                actionLabel="Back to Problems"
                onAction={() => setNavSection('problems')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {reviewQueue.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: '700', fontSize: '1rem', color: '#f8fafc' }}>
                          {item.problemTitle || `Problem #${item.problemId}`}
                        </span>
                        <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px' }}>
                          v{item.problemVersion}
                        </span>
                        <StatusBadge status={item.status} size="sm" />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        Author: #{item.submittedBy} • Submitted {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedProblemId(item.problemId);
                        setNavSection('editor');
                        setEditorSubTab('reviews');
                      }}
                      style={{
                        background: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Open Review
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Create Contest Modal */}
      {createContestModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trophy size={18} color="#7c3aed" /> Create Examination Contest
              </h3>
              <button onClick={() => setCreateContestModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateContest}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Contest Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Midterm Examination 2026"
                  value={newContestData.title}
                  onChange={(e) => setNewContestData({ ...newContestData, title: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '4px' }}>Description</label>
                <textarea
                  rows={3}
                  placeholder="Exam instructions and guidelines..."
                  value={newContestData.description}
                  onChange={(e) => setNewContestData({ ...newContestData, description: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>Start Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={newContestData.startTime}
                    onChange={(e) => setNewContestData({ ...newContestData, startTime: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px' }}>End Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={newContestData.endTime}
                    onChange={(e) => setNewContestData({ ...newContestData, endTime: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#fff', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCreateContestModalOpen(false)}
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', padding: '8px 16px', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
                >
                  {saving ? 'Creating...' : 'Create Contest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Global Confirmation, Diff & Schedule Modals */}
      <ConfirmationModal
        isOpen={confirmModalConfig.isOpen}
        title={confirmModalConfig.title}
        message={confirmModalConfig.message}
        consequenceText={confirmModalConfig.consequenceText}
        confirmLabel={confirmModalConfig.confirmLabel}
        confirmVariant={confirmModalConfig.confirmVariant}
        isProcessing={saving || publishing}
        onConfirm={handleConfirmModalExecution}
        onCancel={() => setConfirmModalConfig((prev) => ({ ...prev, isOpen: false }))}
      />

      <VersionDiffModal
        isOpen={diffModalOpen}
        diffData={diffData}
        onClose={() => setDiffModalOpen(false)}
      />

      <SchedulePublishModal
        isOpen={scheduleModalOpen}
        currentSchedule={formData.scheduledPublishAt}
        onSchedule={handleSchedulePublish}
        onCancelSchedule={handleCancelSchedule}
        onClose={() => setScheduleModalOpen(false)}
        isProcessing={saving}
      />

      {/* Student Preview Modal */}
      {previewModalOpen && previewData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', width: '100%', maxWidth: '780px', maxHeight: '80vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Eye size={20} /> Student Preview: {previewData.title}
              </h3>
              <button onClick={() => setPreviewModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                ✕
              </button>
            </div>
            <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: '1.5' }}>
              {previewData.description}
            </pre>
            <div style={{ marginTop: '16px' }}>
              <span style={{ fontWeight: '700', fontSize: '0.85rem', color: '#38bdf8' }}>Sample Test Cases (Visible to Students)</span>
              {previewData.sampleTestCases?.map((tc, idx) => (
                <div key={idx} style={{ background: '#090d16', padding: '10px 12px', borderRadius: '6px', marginTop: '8px', fontSize: '0.82rem' }}>
                  <div><strong>Input:</strong> {tc.inputData}</div>
                  <div><strong>Output:</strong> {tc.expectedOutput}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
