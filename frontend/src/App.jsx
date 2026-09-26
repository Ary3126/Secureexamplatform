import React, { useState, useEffect, useCallback } from 'react';
import AppShell from './components/navigation/AppShell';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import ProblemExplorer from './components/ProblemExplorer';
import SubmissionHistory from './components/SubmissionHistory';
import SubmissionDetail from './components/SubmissionDetail';
import ProblemPane from './components/ProblemPane';
import EditorPane from './components/EditorPane';
import ConsolePane from './components/ConsolePane';
import LoginModal from './components/LoginModal';
import StudentDashboard from './components/StudentDashboard';
import UserProfile from './components/UserProfile';
import ContestLeaderboard from './components/ContestLeaderboard';
import GlobalLeaderboard from './components/GlobalLeaderboard';
import ProblemAuthoringStudio from './components/ProblemAuthoringStudio';
import AdminPanel from './components/AdminPanel';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { getStarterCode } from './starterTemplates';

function MainApp() {
  const { resolvedTheme } = useTheme();
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('token') || '';
    } catch {
      return '';
    }
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Parse initial view and filter query params from window.location
  const getInitialProfileUser = () => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname;
    if (path.startsWith('/u/')) return path.slice(3);
    if (path.startsWith('/profile/') && path !== '/profile') return path.slice(9);
    return null;
  };

  const getInitialLeaderboardContestId = () => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith('/contests/') && (path.endsWith('/leaderboard') || path.endsWith('/standings'))) {
      const parts = path.split('/');
      return parts[2] || null;
    }
    if (path.startsWith('/leaderboard/') && path !== '/leaderboard' && path !== '/leaderboard/') {
      return path.slice(13) || null;
    }
    return null;
  };

  const getInitialSubmissionId = () => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname;
    if (path.startsWith('/submissions/') && path !== '/submissions' && path !== '/submissions/') {
      return path.slice(13);
    }
    return null;
  };

  const getInitialView = () => {
    if (typeof window === 'undefined') return 'landing';
    const path = window.location.pathname.toLowerCase();
    if (path === '/login') return 'login';
    if (path === '/signup') return 'signup';
    if (path === '/problems' || path === '/explore') return 'problems';
    if (path.startsWith('/submissions/') && path !== '/submissions' && path !== '/submissions/') return 'submission_detail';
    if (path === '/submissions' || path === '/history') return 'submissions';
    if (path === '/dashboard' || path === '/contests') return 'dashboard';
    if (path === '/leaderboard' || path === '/rankings' || path === '/standings') return 'rankings';
    if (path.startsWith('/contests/') && (path.endsWith('/leaderboard') || path.endsWith('/standings')) || (path.startsWith('/leaderboard/') && path !== '/leaderboard/')) return 'leaderboard';
    if (path === '/workspace' || path === '/practice') return 'workspace';
    if (path === '/profile' || path.startsWith('/profile/') || path.startsWith('/u/')) return 'profile';
    if (path === '/studio' || path === '/professor' || path === '/author' || path === '/authoring') return 'studio';
    if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
    return 'landing';
  };

  const getInitialAdminSection = () => {
    if (typeof window === 'undefined') return 'dashboard';
    const path = window.location.pathname.toLowerCase();
    if (path === '/admin/users' || path.startsWith('/admin/users/')) return 'users';
    if (path === '/admin/problems' || path.startsWith('/admin/problems/')) return 'problems';
    if (path === '/admin/contests' || path.startsWith('/admin/contests/')) return 'contests';
    if (path === '/admin/reviews' || path.startsWith('/admin/reviews/')) return 'reviews';
    if (path === '/admin/system' || path.startsWith('/admin/system/')) return 'system';
    return 'dashboard';
  };

  const getInitialFilterParams = () => {
    if (typeof window === 'undefined') return {};
    const searchParams = new URLSearchParams(window.location.search);
    return {
      search: searchParams.get('search') || '',
      difficulty: searchParams.get('difficulty') || 'all',
      codingMode: searchParams.get('codingMode') || 'all',
      status: searchParams.get('status') || 'all',
      sortBy: searchParams.get('sortBy') || 'newest',
      page: searchParams.get('page') || '1',
    };
  };

  // App Navigation View: 'landing' | 'login' | 'signup' | 'problems' | 'submissions' | 'submission_detail' | 'workspace' | 'dashboard' | 'profile' | 'leaderboard' | 'rankings' | 'studio' | 'admin'
  const [activeView, setActiveView] = useState(getInitialView);
  const [adminSection, setAdminSection] = useState(getInitialAdminSection);
  const [activeProfileTab, setActiveProfileTab] = useState('matrix');
  const [profileTargetUser, setProfileTargetUser] = useState(getInitialProfileUser);
  const [leaderboardContestId, setLeaderboardContestId] = useState(getInitialLeaderboardContestId);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(getInitialSubmissionId);
  const [initialExplorerFilters] = useState(getInitialFilterParams);

  // Sync view state to browser URL history
  const navigateTo = useCallback((view, pushState = true, targetUser = null, targetContestId = null, initialTab = 'matrix', targetSubmissionId = null, targetAdminSection = null) => {
    setActiveView(view);
    setActiveProfileTab(initialTab || 'matrix');
    if (targetAdminSection) {
      setAdminSection(targetAdminSection);
    }
    if (view === 'profile') {
      setProfileTargetUser(targetUser || null);
    }
    if (view === 'leaderboard') {
      setLeaderboardContestId(targetContestId || leaderboardContestId);
    }
    if (view === 'submission_detail') {
      setSelectedSubmissionId(targetSubmissionId || selectedSubmissionId);
    }
    if (pushState && typeof window !== 'undefined' && window.history) {
      let path = '/';
      if (view === 'login') path = '/login';
      else if (view === 'signup') path = '/signup';
      else if (view === 'problems') path = '/problems';
      else if (view === 'submissions') path = '/submissions';
      else if (view === 'submission_detail') path = `/submissions/${targetSubmissionId || selectedSubmissionId}`;
      else if (view === 'workspace') path = '/workspace';
      else if (view === 'dashboard') path = '/dashboard';
      else if (view === 'rankings') path = '/leaderboard';
      else if (view === 'leaderboard') path = `/contests/${targetContestId || leaderboardContestId || '1'}/leaderboard`;
      else if (view === 'profile') path = targetUser ? `/u/${targetUser}` : '/profile';
      else if (view === 'studio') path = '/studio';
      else if (view === 'admin') {
        const sec = targetAdminSection || adminSection;
        if (sec === 'users') path = '/admin/users';
        else if (sec === 'problems') path = '/admin/problems';
        else if (sec === 'contests') path = '/admin/contests';
        else if (sec === 'reviews') path = '/admin/reviews';
        else if (sec === 'system') path = '/admin/system';
        else path = '/admin';
      }

      if (window.location.pathname !== path) {
        window.history.pushState({ view, targetUser, targetContestId, targetSubmissionId, adminSection: targetAdminSection || adminSection }, '', path);
      }
    }
  }, [leaderboardContestId, selectedSubmissionId, adminSection]);

  // Update URL search parameters when filtering on /problems
  const handleUrlParamChange = useCallback((filters) => {
    if (typeof window === 'undefined' || !window.history) return;
    if (window.location.pathname !== '/problems') return;

    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.difficulty && filters.difficulty !== 'all') params.append('difficulty', filters.difficulty);
    if (filters.codingMode && filters.codingMode !== 'all') params.append('codingMode', filters.codingMode);
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.sortBy && filters.sortBy !== 'newest') params.append('sortBy', filters.sortBy);
    if (filters.page && filters.page > 1) params.append('page', filters.page.toString());

    const queryString = params.toString();
    const newUrl = queryString ? `/problems?${queryString}` : '/problems';
    window.history.replaceState({ view: 'problems' }, '', newUrl);
  }, []);

  // Sync admin subroute changes
  const handleAdminSectionChange = useCallback((sectionId, path) => {
    setAdminSection(sectionId);
    if (typeof window !== 'undefined' && window.history) {
      const targetPath = path || (sectionId === 'dashboard' ? '/admin' : `/admin/${sectionId}`);
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ view: 'admin', adminSection: sectionId }, '', targetPath);
      }
    }
  }, []);

  // Listen to browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setActiveView(getInitialView());
      setAdminSection(getInitialAdminSection());
      setSelectedSubmissionId(getInitialSubmissionId());
      setProfileTargetUser(getInitialProfileUser());
      setLeaderboardContestId(getInitialLeaderboardContestId());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Contest & Problems State
  const [contest, setContest] = useState(null);
  const [problems, setProblems] = useState([]);
  const [selectedProblem, setSelectedProblem] = useState(null);

  // Editor State
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('');

  // Execution & Console State
  const [activeConsoleTab, setActiveConsoleTab] = useState('testcases');
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [submissionVerdict, setSubmissionVerdict] = useState(null);
  const [historyList, setHistoryList] = useState([]);

  // Auto-join contest helper
  const ensureContestJoined = async (contestId, authToken = token) => {
    if (!contestId || !authToken) return;
    try {
      await fetch(`/api/contests/${contestId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });
    } catch (e) {}
  };

  const [isAuthChecking, setIsAuthChecking] = useState(() => {
    try {
      return Boolean(localStorage.getItem('token'));
    } catch {
      return false;
    }
  });

  // 1. Fetch user profile on token change
  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      setIsAuthChecking(false);
      return;
    }
    setIsAuthChecking(true);
    fetch(`/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        if (user) setCurrentUser(user);
        else {
          // Token invalid/expired -> clear
          setToken('');
          try {
            localStorage.removeItem('token');
          } catch (e) {}
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, [token]);

  // 2. Fetch running contest and attached problems
  const fetchContestsAndProblems = async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      // 1. Check running contests first
      const res = await fetch(`/api/contests?state=running`, { headers });
      const data = await res.json();

      let activeContest = null;
      if (data && data.contests && data.contests.length > 0) {
        // Prefer running contest that has attached problems
        activeContest = data.contests.find((c) => (c.problemCount || 0) > 0) || data.contests[0];
      }

      // 2. If no running contest with problems, look for published contests with problems
      if (!activeContest || (activeContest.problemCount || 0) === 0) {
        const pubRes = await fetch(`/api/contests?status=published`, { headers });
        const pubData = await pubRes.json();
        if (pubData && pubData.contests && pubData.contests.length > 0) {
          const withProblems = pubData.contests.find((c) => (c.problemCount || 0) > 0);
          if (withProblems) {
            activeContest = withProblems;
          } else if (!activeContest) {
            activeContest = pubData.contests[0];
          }
        }
      }

      if (activeContest) {
        setContest(activeContest);
        if (token) {
          await ensureContestJoined(activeContest.id, token);
        }

        const detailRes = await fetch(`/api/contests/${activeContest.id}`, { headers });
        const detailData = await detailRes.json();

        if (detailData.problems && detailData.problems.length > 0) {
          setProblems(detailData.problems);
          loadProblemDetails(detailData.problems[0].id || detailData.problems[0].problemId);
          return;
        }
      }

      fetchProblemsFallback();
    } catch (err) {
      fetchProblemsFallback();
    }
  };

  useEffect(() => {
    fetchContestsAndProblems();
  }, [token]);

  const fetchProblemsFallback = () => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`/api/problems`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.problems && data.problems.length > 0) {
          setProblems(data.problems);
          loadProblemDetails(data.problems[0].id);
        }
      })
      .catch(() => {});
  };

  const loadProblemDetails = async (problemId) => {
    if (!problemId) return;
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/problems/${problemId}`, { headers });
      const prob = await res.json();
      setSelectedProblem(prob);

      // Load initial function mode starter code
      const initialCode = getStarterCode(
        'function',
        language,
        prob.starterTemplates || prob.starter_templates
      );
      setCode(initialCode);

      loadHistory(problemId);
    } catch (err) {
      console.error('Failed to load problem details:', err);
    }
  };

  const loadHistory = async (problemId) => {
    if (!token) return;
    try {
      const query = problemId ? `?problemId=${problemId}` : '';
      const res = await fetch(`/api/submissions/my${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data && data.submissions) {
        setHistoryList(data.submissions);
      }
    } catch (e) {}
  };

  // Handle language change
  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    const starter = getStarterCode(
      'function',
      newLang,
      selectedProblem?.starterTemplates || selectedProblem?.starter_templates
    );
    setCode(starter);
  };

  // Handle Reset to Starter Template
  const handleResetTemplate = () => {
    const starter = getStarterCode(
      'function',
      language,
      selectedProblem?.starterTemplates || selectedProblem?.starter_templates
    );
    setCode(starter);
  };

  // Open problem in editor with custom source code (from Submission History)
  const handleOpenProblemInEditor = async (arg1, historicalCode = null, codeLanguage = null) => {
    let probId = arg1;
    let histCode = historicalCode;
    let lang = codeLanguage;

    if (typeof arg1 === 'object' && arg1 !== null) {
      probId = arg1.problemId || arg1.id;
      histCode = arg1.code || arg1.sourceCode;
      lang = arg1.language;
    }

    if (probId) {
      await loadProblemDetails(probId);
    }
    if (histCode) {
      setCode(histCode);
    }
    if (lang) {
      setLanguage(lang.toLowerCase());
    }
    navigateTo('workspace');
  };

  // Helper to retrieve contestId for a specific problem if part of an active contest
  const getGuaranteedContestId = async (probId) => {
    // If the problem belongs to the active contest, return that contest's ID
    if (contest && contest.id && Array.isArray(problems) && problems.some(p => (p.id || p.problemId) === probId)) {
      return contest.id;
    }
    // Check if any published contest contains this problem
    try {
      const res = await fetch('/api/contests', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data && data.contests && data.contests.length > 0) {
        for (const c of data.contests) {
          const detailRes = await fetch(`/api/contests/${c.id}`);
          const detail = await detailRes.json();
          if (detail && detail.problems && detail.problems.some((p) => (p.id || p.problemId) === probId)) {
            setContest(c);
            return c.id;
          }
        }
      }
    } catch (e) {}

    // Public practice problem does not belong to a contest
    return null;
  };

  // Handle Interactive Run (Sample tests)
  const handleRun = async () => {
    if (isRunning || isSubmitting) return;
    if (!token) {
      setIsLoginModalOpen(true);
      return;
    }
    if (!selectedProblem) return;

    setIsRunning(true);
    setActiveConsoleTab('testcases');
    setRunResult({ status: 'running', executionTime: 0, sampleResults: [] });

    const currentProbId = selectedProblem.id || selectedProblem.problemId;
    const targetContestId = await getGuaranteedContestId(currentProbId);

    if (targetContestId) {
      await ensureContestJoined(targetContestId, token);
    }

    try {
      const executeRunRequest = async () => {
        return await fetch(`/api/submissions/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            contestId: targetContestId,
            problemId: currentProbId,
            language,
            codingMode: selectedProblem.codingMode || 'function',
            sourceCode: code,
          }),
        });
      };

      let res = await executeRunRequest();
      let data = await res.json();

      if (res.status === 403 && data.message && data.message.includes('join the contest') && targetContestId) {
        await ensureContestJoined(targetContestId, token);
        res = await executeRunRequest();
        data = await res.json();
      }

      if (!res.ok) {
        setRunResult({
          status: 'system_error',
          executionTime: 0,
          errorMessage: data.message || 'Run execution failed',
          sampleResults: [],
        });
      } else {
        setRunResult(data.runResult);
      }
    } catch (err) {
      setRunResult({
        status: 'system_error',
        executionTime: 0,
        errorMessage: err.message,
        sampleResults: [],
      });
    } finally {
      setIsRunning(false);
    }
  };

  // Handle Official Submission
  const handleSubmit = async () => {
    if (isSubmitting || isRunning) return;
    if (!token) {
      setIsLoginModalOpen(true);
      return;
    }
    if (!selectedProblem) return;

    setIsSubmitting(true);
    setActiveConsoleTab('verdict');
    setSubmissionVerdict({ status: 'queued', score: 0, executionTime: 0, memoryUsed: 0 });

    const currentProbId = selectedProblem.id || selectedProblem.problemId;
    const targetContestId = await getGuaranteedContestId(currentProbId);

    if (targetContestId) {
      await ensureContestJoined(targetContestId, token);
    }

    try {
      const executeSubmitRequest = async () => {
        return await fetch(`/api/submissions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            contestId: targetContestId,
            problemId: currentProbId,
            language,
            codingMode: selectedProblem.codingMode || 'function',
            sourceCode: code,
          }),
        });
      };

      let res = await executeSubmitRequest();
      let data = await res.json();

      if (res.status === 403 && data.message && data.message.includes('join the contest') && targetContestId) {
        await ensureContestJoined(targetContestId, token);
        res = await executeSubmitRequest();
        data = await res.json();
      }

      if (!res.ok) {
        setSubmissionVerdict({
          status: 'system_error',
          score: 0,
          errorMessage: data.message || 'Submission failed',
        });
        setIsSubmitting(false);
        return;
      }

      const submissionId = data.submission.id;
      pollSubmissionResult(submissionId);
    } catch (err) {
      setSubmissionVerdict({
        status: 'system_error',
        score: 0,
        errorMessage: err.message,
      });
      setIsSubmitting(false);
    }
  };

  // Poll for official submission result with adaptive fast cadence
  const pollSubmissionResult = (submissionId) => {
    let attempts = 0;
    const maxAttempts = 60; // Max 30+ seconds polling tolerance
    let isTerminated = false;

    const poll = async () => {
      if (isTerminated) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/submissions/${submissionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const sub = await res.json();

        const terminalStatuses = [
          'accepted',
          'wrong_answer',
          'compilation_error',
          'runtime_error',
          'time_limit_exceeded',
          'memory_limit_exceeded',
          'system_error',
        ];

        if (sub && sub.status && terminalStatuses.includes(String(sub.status).toLowerCase())) {
          isTerminated = true;
          setSubmissionVerdict(sub);
          setIsSubmitting(false);
          loadHistory(selectedProblem ? (selectedProblem.id || selectedProblem.problemId) : null);
          return;
        }

        if (attempts >= maxAttempts) {
          isTerminated = true;
          setSubmissionVerdict(sub || { status: 'system_error', errorMessage: 'Evaluation timeout' });
          setIsSubmitting(false);
          return;
        }

        // Adaptive polling interval: 250ms for initial attempts, then 500ms, then 800ms
        const nextDelay = attempts <= 4 ? 250 : attempts <= 12 ? 500 : 800;
        setTimeout(poll, nextDelay);
      } catch (e) {
        if (!isTerminated) {
          isTerminated = true;
          setIsSubmitting(false);
        }
      }
    };

    // Trigger initial fast poll at 200ms
    setTimeout(poll, 200);
  };

  const handleAuthSuccess = (newToken, user) => {
    setToken(newToken);
    try {
      localStorage.setItem('token', newToken);
    } catch (e) {}
    setCurrentUser(user);
    if (contest) {
      ensureContestJoined(contest.id, newToken);
    }
    navigateTo('dashboard');
  };

  const handleLogout = () => {
    setToken('');
    try {
      localStorage.removeItem('token');
    } catch (e) {}
    setCurrentUser(null);
    navigateTo('landing');
  };

  const handleSelectContestFromDashboard = async (contestId) => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/contests/${contestId}`, { headers });
      const data = await res.json();
      setContest(data);
      if (data.problems && data.problems.length > 0) {
        setProblems(data.problems);
        loadProblemDetails(data.problems[0].id || data.problems[0].problemId);
      }
      navigateTo('workspace');
    } catch (err) {
      console.error('Error switching contest:', err);
      navigateTo('workspace');
    }
  };

  const handleLoadSubmissionCode = async (subId) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/submissions/${subId}/code`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.sourceCode) {
        setCode(data.sourceCode);
        if (data.language) setLanguage(data.language.toLowerCase());
      }
    } catch (e) {
      console.error('Failed to load submission code:', e);
    }
  };

  const monacoEditorTheme = resolvedTheme === 'light' ? 'vs-light' : 'vs-dark';

  const isProblemInCurrentContest = contest && contest.id && Array.isArray(problems) && problems.some(p => (p.id || p.problemId) === (selectedProblem?.id || selectedProblem?.problemId));
  const activeContestForWorkspace = isProblemInCurrentContest ? contest : null;

  // Dedicated Super Admin Panel Shell (Bypasses Student AppShell for clean standalone administration layout)
  if (activeView === 'admin' && !isAuthChecking && currentUser && currentUser.role === 'super_admin') {
    return (
      <AdminPanel
        currentUser={currentUser}
        token={token}
        initialSection={adminSection}
        onNavigateSection={handleAdminSectionChange}
        onLogout={handleLogout}
        onExitToPlatform={() => navigateTo('dashboard')}
      />
    );
  }

  return (
    <AppShell
      activeView={activeView}
      activeProfileTab={activeProfileTab}
      selectedProblem={selectedProblem}
      contest={activeContestForWorkspace}
      currentUser={currentUser}
      profileTargetUser={profileTargetUser}
      problems={problems}
      language={language}
      isRunning={isRunning}
      isSubmitting={isSubmitting}
      onSelectView={navigateTo}
      onOpenLogin={() => navigateTo('login')}
      onOpenSignup={() => navigateTo('signup')}
      onLogout={handleLogout}
      onLanguageChange={handleLanguageChange}
      onResetTemplate={handleResetTemplate}
      onRun={handleRun}
      onSubmit={handleSubmit}
      onSelectProblem={(probId) => {
        setContest(null);
        loadProblemDetails(probId);
        navigateTo('workspace');
      }}
    >
      {/* 1. Public Landing View */}
      {activeView === 'landing' && (
        <LandingPage
          onStartPracticing={() => navigateTo('workspace')}
          onExploreProblems={() => navigateTo('problems')}
          onNavigateLogin={() => navigateTo('login')}
          onNavigateSignup={() => navigateTo('signup')}
          onSelectProblem={(probId) => {
            setContest(null);
            loadProblemDetails(probId);
            navigateTo('workspace');
          }}
        />
      )}

      {/* 2. Problem Discovery & Explorer View (Phase 5.2) */}
      {activeView === 'problems' && (
        <ProblemExplorer
          token={token}
          currentUser={currentUser}
          initialFilters={initialExplorerFilters}
          onSelectProblem={(probId) => {
            setContest(null);
            loadProblemDetails(probId);
            navigateTo('workspace');
          }}
          onUrlParamChange={handleUrlParamChange}
        />
      )}

      {/* 3. Submission History & Coding Analytics View (Phase 5.3) */}
      {activeView === 'submissions' && (
        <SubmissionHistory
          token={token}
          currentUser={currentUser}
          onOpenProblemInEditor={handleOpenProblemInEditor}
          onNavigateProblems={() => navigateTo('problems')}
          onViewSubmissionDetail={(subId) => navigateTo('submission_detail', true, null, null, 'matrix', subId)}
          onOpenLogin={() => navigateTo('login')}
        />
      )}

      {/* 3.1 Submission Detail & Exact Source Code View (Phase 5.8.1) */}
      {activeView === 'submission_detail' && (
        <SubmissionDetail
          submissionId={selectedSubmissionId}
          token={token}
          currentUser={currentUser}
          onBack={() => navigateTo('submissions')}
          onOpenInEditor={handleOpenProblemInEditor}
        />
      )}

      {/* 4. Dedicated Login View */}
      {activeView === 'login' && (
        <LoginPage
          onLogin={handleAuthSuccess}
          onNavigateSignup={() => navigateTo('signup')}
          onNavigateLanding={() => navigateTo('landing')}
        />
      )}

      {/* 5. Dedicated Signup View */}
      {activeView === 'signup' && (
        <SignupPage
          onSignupSuccess={handleAuthSuccess}
          onNavigateLogin={() => navigateTo('login')}
          onNavigateLanding={() => navigateTo('landing')}
        />
      )}

      {/* 6. Student Dashboard View */}
      {activeView === 'dashboard' && (
        <StudentDashboard
          token={token}
          user={currentUser}
          onSelectContest={handleSelectContestFromDashboard}
          onSelectProblem={(probId) => {
            loadProblemDetails(probId);
            navigateTo('workspace');
          }}
          onNavigateProblems={() => navigateTo('problems')}
          onNavigateSubmissions={() => navigateTo('submissions')}
          onNavigateProfile={() => navigateTo('profile')}
          onNavigateLeaderboard={(targetContestId) => navigateTo('leaderboard', true, null, targetContestId)}
        />
      )}

      {/* 7. Contest Leaderboard View (Phase 5.5) */}
      {activeView === 'leaderboard' && (
        <ContestLeaderboard
          contestId={leaderboardContestId || (contest ? contest.id : '1')}
          token={token}
          currentUser={currentUser}
          onNavigateBack={() => navigateTo('dashboard')}
          onNavigateProfile={(targetUsername) => navigateTo('profile', true, targetUsername)}
          onOpenProblemInWorkspace={(probId) => {
            loadProblemDetails(probId);
            navigateTo('workspace');
          }}
        />
      )}

      {/* 8. Global + College Leaderboard View (Phase 5.6) */}
      {activeView === 'rankings' && (
        <GlobalLeaderboard
          token={token}
          currentUser={currentUser}
          onNavigateProfile={(targetUsername) => navigateTo('profile', true, targetUsername)}
          onOpenEditProfile={() => navigateTo('profile', true, null, null, 'settings')}
        />
      )}

      {/* 9. User Profile View (Coder Identity & Settings) */}
      {activeView === 'profile' && (
        <UserProfile
          token={token}
          currentUser={currentUser}
          targetUsername={profileTargetUser}
          initialTab={activeProfileTab}
          onBackToWorkspace={() => navigateTo('workspace')}
          onOpenProblem={(probId) => {
            loadProblemDetails(probId);
            navigateTo('workspace');
          }}
          onOpenLogin={() => navigateTo('login')}
        />
      )}

      {/* 9.1 Problem Authoring Studio (Professor & Author Workspace) */}
      {activeView === 'studio' && (
        !currentUser ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '24px' }}>
            <h2 style={{ color: '#f8fafc', marginBottom: '8px' }}>Authentication Required</h2>
            <p style={{ color: '#94a3b8', maxWidth: '400px', marginBottom: '20px' }}>
              Please log in to access the Professor Authoring Studio.
            </p>
            <button
              onClick={() => navigateTo('login')}
              style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}
            >
              Log In
            </button>
          </div>
        ) : currentUser.role === 'student' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '24px' }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '32px', maxWidth: '480px' }}>
              <h2 style={{ color: '#f87171', margin: '0 0 12px 0', fontSize: '1.25rem' }}>Access Denied</h2>
              <p style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 20px 0' }}>
                The Professor Studio is restricted to faculty and examination authors. Students can solve problems and track skill progress from the Student Dashboard.
              </p>
              <button
                onClick={() => navigateTo('dashboard')}
                style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}
              >
                Go to Student Dashboard
              </button>
            </div>
          </div>
        ) : (
          <ProblemAuthoringStudio
            token={token}
            currentUser={currentUser}
            initialSection={activeProfileTab || 'dashboard'}
            initialOpenCreateContest={activeProfileTab === 'create_contest'}
            onSelectProblem={(probId) => {
              loadProblemDetails(probId);
              navigateTo('workspace');
            }}
          />
        )
      )}

      {/* 9.2 Super Admin Console Access Guard */}
      {activeView === 'admin' && (
        isAuthChecking ? (
          <div className="admin-access-screen">
            <div className="admin-access-card auth">
              <div style={{ width: '28px', height: '28px', border: '3px solid rgba(56, 189, 248, 0.2)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px auto' }} />
              <h2 style={{ color: '#f8fafc', fontSize: '1.15rem', margin: '0 0 8px 0' }}>Verifying Credentials</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
                Authenticating administrator permissions...
              </p>
            </div>
          </div>
        ) : !currentUser ? (
          <div className="admin-access-screen">
            <div className="admin-access-card auth">
              <h2 style={{ color: '#f8fafc', margin: '0 0 8px 0', fontSize: '1.25rem' }}>Authentication Required</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 20px 0' }}>
                Please log in with Super Administrator credentials to access the Platform Governor Console.
              </p>
              <button
                onClick={() => navigateTo('login')}
                className="admin-access-btn"
              >
                Log In
              </button>
            </div>
          </div>
        ) : currentUser.role !== 'super_admin' ? (
          <div className="admin-access-screen">
            <div className="admin-access-card denied">
              <h2 style={{ color: '#f87171', margin: '0 0 12px 0', fontSize: '1.25rem' }}>Access Denied</h2>
              <p style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 20px 0' }}>
                The Admin Console is strictly restricted to Super Administrators. Your role '{currentUser.role}' is not authorized to access this resource.
              </p>
              <button
                onClick={() => navigateTo(currentUser.role === 'professor' ? 'studio' : 'dashboard')}
                className="admin-access-btn"
              >
                {currentUser.role === 'professor' ? 'Go to Professor Studio' : 'Go to Student Dashboard'}
              </button>
            </div>
          </div>
        ) : null
      )}

      {/* 10. Code Practice & Contest Workspace */}
      {activeView === 'workspace' && (
        <main className="workspace-grid">
          <ProblemPane
            problems={problems}
            selectedProblem={selectedProblem}
            onSelectProblem={(pId) => loadProblemDetails(pId)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <EditorPane
              language={language}
              code={code}
              onCodeChange={setCode}
              codingMode={selectedProblem?.codingMode || selectedProblem?.coding_mode || 'function'}
              editorTheme={monacoEditorTheme}
            />

            <ConsolePane
              activeTab={activeConsoleTab}
              onTabChange={setActiveConsoleTab}
              runResult={runResult}
              submissionVerdict={submissionVerdict}
              historyList={historyList}
              onLoadSubmissionCode={handleLoadSubmissionCode}
              onViewSubmissionDetail={(subId) => navigateTo('submission_detail', true, null, null, 'matrix', subId)}
            />
          </div>
        </main>
      )}

      {/* Fallback Login Modal (Used if prompted inside workspace) */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLogin={handleAuthSuccess}
        apiUrl=""
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}