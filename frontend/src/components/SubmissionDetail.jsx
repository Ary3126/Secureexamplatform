import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  Award,
  Calendar,
  Code2,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Terminal,
  ShieldCheck,
  Layers,
  Sparkles,
  RefreshCw,
  FileCode2,
  User,
  Hash,
  Gauge,
  Activity,
  BarChart3,
  GitCompare,
} from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';
import SubmissionComparisonModal from './SubmissionComparisonModal';

export default function SubmissionDetail({
  submissionId,
  token,
  currentUser,
  onBack,
  onOpenInEditor,
}) {
  const { resolvedTheme } = useTheme();
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Phase 5.8.4: Distribution State
  const [distribution, setDistribution] = useState(null);
  const [distLoading, setDistLoading] = useState(false);
  const [distError, setDistError] = useState(null);

  // Phase 5.8.5: Comparison Modal State
  const [isCompareOpen, setIsCompareOpen] = useState(false);

  // Fetch submission details from authoritative backend
  const fetchSubmissionDetail = useCallback(async () => {
    if (!submissionId) {
      setLoading(false);
      return;
    }
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setSubmission(data);
      } else {
        setError({
          statusCode: res.status,
          message: data.message || 'Unable to load submission details.',
        });
      }
    } catch (err) {
      setError({
        statusCode: 500,
        message: 'Network error communicating with the submission service.',
      });
    } finally {
      setLoading(false);
    }
  }, [submissionId, token]);

  useEffect(() => {
    fetchSubmissionDetail();
  }, [fetchSubmissionDetail]);

  // Phase 5.8.4: Fetch Performance Distribution independently without blocking main verdict
  useEffect(() => {
    if (!submissionId || !token) return;
    let isMounted = true;
    setDistLoading(true);
    setDistError(null);

    fetch(`/api/submissions/${submissionId}/performance/distribution`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load distribution (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setDistribution(data);
          setDistLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setDistError(err.message || 'Performance distribution unavailable');
          setDistLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [submissionId, token]);

  const handleCopyCode = () => {
    if (!submission?.sourceCode) return;
    navigator.clipboard?.writeText(submission.sourceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getVerdictDetails = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
          label: 'Accepted',
          className: 'verdict-hero-accepted',
          badgeClass: 'badge-verdict-accepted',
        };
      case 'wrong_answer':
        return {
          icon: <XCircle className="w-5 h-5 text-rose-400" />,
          label: 'Wrong Answer',
          className: 'verdict-hero-wa',
          badgeClass: 'badge-verdict-wa',
        };
      case 'time_limit_exceeded':
        return {
          icon: <Clock className="w-5 h-5 text-amber-400" />,
          label: 'Time Limit Exceeded',
          className: 'verdict-hero-tle',
          badgeClass: 'badge-verdict-tle',
        };
      case 'memory_limit_exceeded':
        return {
          icon: <Cpu className="w-5 h-5 text-purple-400" />,
          label: 'Memory Limit Exceeded',
          className: 'verdict-hero-mle',
          badgeClass: 'badge-verdict-mle',
        };
      case 'compilation_error':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-rose-400" />,
          label: 'Compilation Error',
          className: 'verdict-hero-ce',
          badgeClass: 'badge-verdict-ce',
        };
      case 'runtime_error':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-rose-400" />,
          label: 'Runtime Error',
          className: 'verdict-hero-re',
          badgeClass: 'badge-verdict-re',
        };
      case 'queued':
      case 'running':
        return {
          icon: <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />,
          label: status?.toUpperCase(),
          className: 'verdict-hero-pending',
          badgeClass: 'badge-verdict-pending',
        };
      default:
        return {
          icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
          label: status?.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN',
          className: 'verdict-hero-unknown',
          badgeClass: 'badge-verdict-unknown',
        };
    }
  };

  const getMonacoLanguage = (lang) => {
    const l = (lang || '').toLowerCase();
    if (l === 'cpp' || l === 'c++') return 'cpp';
    if (l === 'python' || l === 'py') return 'python';
    if (l === 'java') return 'java';
    if (l === 'javascript' || l === 'js') return 'javascript';
    if (l === 'c') return 'c';
    return 'plaintext';
  };

  const getDifficultyClass = (diff) => {
    switch (diff?.toLowerCase()) {
      case 'easy':
        return 'badge-difficulty-easy';
      case 'medium':
        return 'badge-difficulty-medium';
      case 'hard':
        return 'badge-difficulty-hard';
      default:
        return 'badge-difficulty-easy';
    }
  };

  // Loading Skeleton State
  if (loading) {
    return (
      <div className="submission-detail-container" role="status" aria-live="polite">
        <div className="submission-detail-top-nav">
          <button className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            <span>Back to Submissions</span>
          </button>
        </div>
        <div className="submission-detail-skeleton-header animate-pulse" />
        <div className="submission-detail-skeleton-metrics animate-pulse" />
        <div className="submission-detail-skeleton-code animate-pulse" />
      </div>
    );
  }

  // Error / Unauthorized / Not Found State
  if (error) {
    return (
      <div className="submission-detail-container">
        <div className="submission-detail-top-nav">
          <button className="btn btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            <span>Back to Submissions</span>
          </button>
        </div>

        <div className="submission-detail-error-card" role="alert">
          <div className="error-card-icon-wrapper">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
          </div>
          <h2 className="error-card-title">
            {error.statusCode === 403
              ? 'Access Forbidden'
              : error.statusCode === 404
                ? 'Submission Not Found'
                : 'Error Loading Submission'}
          </h2>
          <p className="error-card-desc">{error.message}</p>
          <div className="error-card-actions">
            <button className="btn btn-primary" onClick={onBack}>
              Return to Submissions List
            </button>
            <button className="btn btn-secondary" onClick={fetchSubmissionDetail}>
              <RefreshCw className="w-4 h-4 mr-1.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!submission) return null;

  const verdict = getVerdictDetails(submission.status);
  const codeLinesCount = (submission.sourceCode || '').split('\n').length;
  const memoryDisplay =
    submission.memoryUsed > 1024
      ? `${(submission.memoryUsed / 1024).toFixed(1)} MB`
      : `${submission.memoryUsed || 0} KB`;

  return (
    <div className="submission-detail-container">
      {/* Top Navigation Bar */}
      <div className="submission-detail-top-nav">
        <button
          type="button"
          className="btn btn-secondary btn-sm submission-back-btn"
          onClick={onBack}
          aria-label="Back to Submissions History"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          <span>Back to Submissions</span>
        </button>

        <div className="submission-detail-nav-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm compare-nav-btn"
            onClick={() => setIsCompareOpen(true)}
            title="Compare with another submission"
            aria-label="Compare Submissions"
          >
            <GitCompare className="w-4 h-4 mr-1.5 text-blue-400" />
            <span>Compare</span>
          </button>

          {onOpenInEditor && (
            <button
              type="button"
              className="btn btn-primary btn-sm open-in-editor-btn"
              onClick={() =>
                onOpenInEditor({
                  problemId: submission.problemId,
                  code: submission.sourceCode,
                  language: submission.language,
                })
              }
            >
              <span>Open in Workspace Editor</span>
              <ExternalLink className="w-4 h-4 ml-1.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hero Header */}
      <div className="submission-detail-hero">
        <div className="submission-detail-hero-left">
          <div className="submission-id-badge">
            <Hash className="w-4 h-4 text-blue-400" />
            <span>Submission #{submission.id}</span>
          </div>

          <h1 className="submission-problem-title">
            {submission.problemTitle || `Problem #${submission.problemId}`}
          </h1>

          <div className="submission-metadata-row">
            <span className={`badge-difficulty ${getDifficultyClass(submission.problemDifficulty)}`}>
              {submission.problemDifficulty?.toUpperCase() || 'EASY'}
            </span>

            {submission.contestTitle ? (
              <span className="submission-contest-tag">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 mr-1" />
                {submission.contestTitle}
              </span>
            ) : (
              <span className="submission-contest-tag submission-practice-tag">
                <Code2 className="w-3.5 h-3.5 text-blue-400 mr-1" />
                Public Practice
              </span>
            )}

            <span className="submission-meta-item">
              <Calendar className="w-3.5 h-3.5 text-muted mr-1" />
              {new Date(submission.createdAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>

            {submission.username && (
              <span className="submission-meta-item">
                <User className="w-3.5 h-3.5 text-muted mr-1" />
                Submitted by <strong>{submission.username}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Big Verdict Hero Pill */}
        <div className={`verdict-hero-badge ${verdict.className}`}>
          <div className="verdict-hero-icon">{verdict.icon}</div>
          <div className="verdict-hero-text">
            <span className="verdict-hero-label">Verdict</span>
            <span className="verdict-hero-status">{verdict.label}</span>
          </div>
        </div>
      </div>

      {/* Metrics Performance Grid */}
      <div className="submission-metrics-grid">
        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <Award className="w-4 h-4 text-amber-400" />
            <span>Score Awarded</span>
          </div>
          <div className="metric-stat-value">
            {submission.score ?? 0} <span className="metric-stat-unit">/ 100 pts</span>
          </div>
        </div>

        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <Clock className="w-4 h-4 text-blue-400" />
            <span>Execution Runtime</span>
          </div>
          <div className="metric-stat-value">
            {submission.executionTime ?? 0} <span className="metric-stat-unit">ms</span>
          </div>
        </div>

        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>Memory Utilized</span>
          </div>
          <div className="metric-stat-value">{memoryDisplay}</div>
        </div>

        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Test Cases</span>
          </div>
          <div className="metric-stat-value">
            {submission.testCasesPassed ?? 0}{' '}
            <span className="metric-stat-unit">/ {submission.testCasesTotal ?? 0} passed</span>
          </div>
        </div>

        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <Code2 className="w-4 h-4 text-cyan-400" />
            <span>Language</span>
          </div>
          <div className="metric-stat-value">
            {submission.language?.toUpperCase() || 'UNKNOWN'}
          </div>
        </div>

        <div className="metric-stat-card">
          <div className="metric-stat-header">
            <Terminal className="w-4 h-4 text-indigo-400" />
            <span>Execution Mode</span>
          </div>
          <div className="metric-stat-value">
            {submission.codingMode === 'function' ? 'Function Mode' : 'Full Program'}
          </div>
        </div>
      </div>

      {/* Enhanced Validation Multi-Tier Stage Breakdown */}
      {submission.validationSummary && (
        <div className="submission-validation-summary-card">
          <div className="validation-card-header">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="validation-card-title">Multi-Tier Validation Pipeline</h3>
          </div>
          <div className="validation-stages-row">
            {submission.validationSummary.stages?.map((stage, idx) => (
              <div
                key={idx}
                className={`validation-stage-chip ${stage.status === 'passed' ? 'stage-passed' : 'stage-failed'
                  }`}
              >
                {stage.status === 'passed' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-1" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-400 mr-1" />
                )}
                <span>
                  {stage.name?.toUpperCase()}: <strong>{stage.status?.toUpperCase()}</strong> (
                  {stage.passedCases ?? 0}/{stage.totalCases ?? 0})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Statistics & Benchmark Metrics (Phase 5.8.2) */}
      {submission.performanceStats && (
        <div className="submission-perf-stats-card">
          <div className="perf-stats-header">
            <div className="perf-stats-title-group">
              <Gauge className="w-5 h-5 text-blue-400" />
              <h3 className="perf-stats-title">Performance Benchmark</h3>
            </div>
            {submission.performanceStats.runtime?.sampleCount > 0 ? (
              <span className="perf-stats-scope-badge">
                Population: <strong>{(submission.performanceStats.runtime.sampleCount || 0).toLocaleString()}</strong> accepted{' '}
                <strong>{submission.language?.toUpperCase()}</strong> submissions
              </span>
            ) : (
              <span className="perf-stats-scope-badge perf-scope-empty">
                No comparable accepted submissions yet
              </span>
            )}
          </div>

          {submission.performanceStats.runtime?.sampleCount > 0 ? (
            <div className="perf-stats-grid">
              {/* Runtime Comparative Card */}
              <div className="perf-stat-column">
                <div className="perf-column-header">
                  <Clock className="w-4 h-4 text-blue-400 mr-1.5" />
                  <h4>Execution Runtime</h4>
                </div>
                <div className="perf-current-box">
                  <span className="perf-current-label">Your Solution</span>
                  <span className="perf-current-value">
                    {submission.executionTime !== null && submission.executionTime !== undefined
                      ? `${submission.executionTime} ms`
                      : 'N/A'}
                  </span>
                </div>
              {submission.performanceStats.runtime?.available && submission.performanceStats.runtime?.percentile !== null ? (
                <div className="perf-percentile-pill percentile-faster">
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-emerald-400 shrink-0" />
                  <span>
                    Faster than <strong>{submission.performanceStats.runtime.percentile}%</strong> of{' '}
                    {submission.language?.toUpperCase()} submissions
                  </span>
                </div>
              ) : (
                <div className="perf-percentile-pill percentile-neutral">
                  <span>
                    Not enough data
                  </span>
                </div>
              )}
                <div className="perf-aggregates-table">
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Fastest (Min)</span>
                    <span className="perf-agg-val">{submission.performanceStats.runtime.minMs} ms</span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Median (50th %)</span>
                    <span className="perf-agg-val highlight-median">{submission.performanceStats.runtime.medianMs} ms</span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Average</span>
                    <span className="perf-agg-val">{submission.performanceStats.runtime.averageMs} ms</span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Slowest (Max)</span>
                    <span className="perf-agg-val">{submission.performanceStats.runtime.maxMs} ms</span>
                  </div>
                </div>
              </div>

              {/* Memory Comparative Card */}
              <div className="perf-stat-column">
                <div className="perf-column-header">
                  <Cpu className="w-4 h-4 text-purple-400 mr-1.5" />
                  <h4>Memory Utilization</h4>
                </div>
                <div className="perf-current-box">
                  <span className="perf-current-label">Your Solution</span>
                  <span className="perf-current-value">{memoryDisplay}</span>
                </div>
              {submission.performanceStats.memory?.available && submission.performanceStats.memory?.percentile !== null ? (
                <div className="perf-percentile-pill percentile-lower-memory">
                  <Cpu className="w-3.5 h-3.5 mr-1 text-purple-400 shrink-0" />
                  <span>
                    Lower than <strong>{submission.performanceStats.memory.percentile}%</strong> of{' '}
                    {submission.language?.toUpperCase()} submissions
                  </span>
                </div>
              ) : (
                <div className="perf-percentile-pill percentile-neutral">
                  <span>
                    Not enough data
                  </span>
                </div>
              )}
                <div className="perf-aggregates-table">
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Lowest (Min)</span>
                    <span className="perf-agg-val">
                      {submission.performanceStats.memory.minKb > 1024
                        ? `${(submission.performanceStats.memory.minKb / 1024).toFixed(1)} MB`
                        : `${submission.performanceStats.memory.minKb ?? 0} KB`}
                    </span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Median (50th %)</span>
                    <span className="perf-agg-val highlight-median">
                      {submission.performanceStats.memory.medianKb > 1024
                        ? `${(submission.performanceStats.memory.medianKb / 1024).toFixed(1)} MB`
                        : `${submission.performanceStats.memory.medianKb ?? 0} KB`}
                    </span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Average</span>
                    <span className="perf-agg-val">
                      {submission.performanceStats.memory.averageKb > 1024
                        ? `${(submission.performanceStats.memory.averageKb / 1024).toFixed(1)} MB`
                        : `${submission.performanceStats.memory.averageKb ?? 0} KB`}
                    </span>
                  </div>
                  <div className="perf-aggregate-row">
                    <span className="perf-agg-label">Highest (Max)</span>
                    <span className="perf-agg-val">
                      {submission.performanceStats.memory.maxKb > 1024
                        ? `${(submission.performanceStats.memory.maxKb / 1024).toFixed(1)} MB`
                        : `${submission.performanceStats.memory.maxKb ?? 0} KB`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="perf-empty-state">
              <Activity className="w-6 h-6 text-muted mb-2" />
              <p>
                Performance statistics are not available yet. No accepted submissions have been recorded for{' '}
                <strong>{submission.language?.toUpperCase()}</strong> on this problem.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Phase 5.8.4: Performance Distribution Section */}
      <div className="perf-dist-section" role="region" aria-label="Performance Distribution Histograms">
        <div className="perf-dist-header">
          <div className="perf-dist-title-group">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <h3 className="perf-dist-title">Performance Distribution</h3>
          </div>
          {distribution?.population > 0 && (
            <span className="perf-stats-scope-badge">
              Population: <strong>{distribution.population.toLocaleString()}</strong> accepted{' '}
              <strong>{submission?.language?.toUpperCase()}</strong> submissions
            </span>
          )}
        </div>

        {distLoading ? (
          <div className="perf-dist-loading-box">
            <RefreshCw className="w-5 h-5 text-blue-400 animate-spin mr-2" />
            <span>Loading performance distribution...</span>
          </div>
        ) : distError ? (
          <div className="perf-dist-error-box">
            <AlertTriangle className="w-5 h-5 text-amber-400 mr-2" />
            <span>Performance distribution unavailable</span>
          </div>
        ) : !distribution?.available ? (
          <div className="perf-dist-empty-box">
            <Activity className="w-5 h-5 text-muted mr-2" />
            <span>Not enough data for distribution</span>
          </div>
        ) : (
          <div className="perf-dist-grid">
            {/* Runtime Distribution Histogram */}
            <div className="perf-dist-card">
              <div className="perf-dist-card-header">
                <div className="perf-dist-card-title">
                  <Clock className="w-4 h-4 text-blue-400 mr-1.5" />
                  <h4>Runtime Distribution — {submission?.language?.toUpperCase()}</h4>
                </div>
                <div className="perf-dist-card-metrics">
                  <span>Your runtime: <strong>{distribution.runtime.userValue !== null ? `${distribution.runtime.userValue} ms` : 'N/A'}</strong></span>
                  <span className="metric-sep">•</span>
                  <span>Median: <strong>{distribution.runtime.median} ms</strong></span>
                  {distribution.runtime.percentile !== null && (
                    <>
                      <span className="metric-sep">•</span>
                      <span>Faster than: <strong>{distribution.runtime.percentile}%</strong></span>
                    </>
                  )}
                </div>
              </div>

              <div className="perf-dist-bars-container" role="list" aria-label="Runtime distribution buckets">
                {distribution.runtime.buckets.map((b) => {
                  const maxCount = Math.max(...distribution.runtime.buckets.map((x) => x.count), 1);
                  const barFillPercent = Math.round((b.count / maxCount) * 100);
                  return (
                    <div
                      key={b.index}
                      role="listitem"
                      className={`perf-dist-bar-item ${b.isUserBucket ? 'perf-dist-bar-user' : ''}`}
                      aria-label={`Runtime bucket ${b.label}: ${b.count} accepted submissions (${b.percentage}%) ${b.isUserBucket ? '(Your Solution)' : ''}`}
                    >
                      <div className="perf-dist-bar-label-col">
                        <span className="perf-dist-bucket-label">{b.label}</span>
                        {b.isUserBucket && <span className="perf-dist-you-badge">← You</span>}
                      </div>
                      <div className="perf-dist-bar-track">
                        <div
                          className={`perf-dist-bar-fill ${b.isUserBucket ? 'fill-user-runtime' : 'fill-runtime'}`}
                          style={{ width: `${Math.max(barFillPercent, b.count > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      <div className="perf-dist-bar-meta-col">
                        <span className="perf-dist-count">{b.count}</span>
                        <span className="perf-dist-pct">({b.percentage}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Memory Distribution Histogram */}
            <div className="perf-dist-card">
              <div className="perf-dist-card-header">
                <div className="perf-dist-card-title">
                  <Cpu className="w-4 h-4 text-purple-400 mr-1.5" />
                  <h4>Memory Distribution — {submission?.language?.toUpperCase()}</h4>
                </div>
                <div className="perf-dist-card-metrics">
                  <span>
                    Your memory: <strong>{distribution.memory.userValueMb !== null ? `${distribution.memory.userValueMb} MB` : 'N/A'}</strong>
                  </span>
                  <span className="metric-sep">•</span>
                  <span>
                    Median: <strong>{(distribution.memory.median / 1024).toFixed(1)} MB</strong>
                  </span>
                  {distribution.memory.percentile !== null && (
                    <>
                      <span className="metric-sep">•</span>
                      <span>Lower than: <strong>{distribution.memory.percentile}%</strong></span>
                    </>
                  )}
                </div>
              </div>

              <div className="perf-dist-bars-container" role="list" aria-label="Memory distribution buckets">
                {distribution.memory.buckets.map((b) => {
                  const maxCount = Math.max(...distribution.memory.buckets.map((x) => x.count), 1);
                  const barFillPercent = Math.round((b.count / maxCount) * 100);
                  return (
                    <div
                      key={b.index}
                      role="listitem"
                      className={`perf-dist-bar-item ${b.isUserBucket ? 'perf-dist-bar-user' : ''}`}
                      aria-label={`Memory bucket ${b.label}: ${b.count} accepted submissions (${b.percentage}%) ${b.isUserBucket ? '(Your Solution)' : ''}`}
                    >
                      <div className="perf-dist-bar-label-col">
                        <span className="perf-dist-bucket-label">{b.label}</span>
                        {b.isUserBucket && <span className="perf-dist-you-badge">← You</span>}
                      </div>
                      <div className="perf-dist-bar-track">
                        <div
                          className={`perf-dist-bar-fill ${b.isUserBucket ? 'fill-user-memory' : 'fill-memory'}`}
                          style={{ width: `${Math.max(barFillPercent, b.count > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      <div className="perf-dist-bar-meta-col">
                        <span className="perf-dist-count">{b.count}</span>
                        <span className="perf-dist-pct">({b.percentage}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compiler / Runtime Error Console */}
      {submission.errorMessage && (
        <div className="submission-error-console-card">
          <div className="error-console-header">
            <Terminal className="w-4 h-4 text-rose-400 mr-1.5" />
            <span>Judge Diagnostic Output</span>
          </div>
          <pre className="error-console-content">
            <code>{submission.errorMessage}</code>
          </pre>
        </div>
      )}

      {/* Historical Submitted Source Code Viewer */}
      <div className="submission-code-viewer-panel">
        <div className="code-viewer-panel-header">
          <div className="code-viewer-title-group">
            <FileCode2 className="w-4 h-4 text-blue-400" />
            <h3 className="code-viewer-title">Historical Submitted Source Code</h3>
            <span className="code-viewer-immutable-tag">Read-Only Archive</span>
          </div>

          <div className="code-viewer-actions">
            <span className="code-viewer-lines-count">{codeLinesCount} lines</span>
            <span className="code-viewer-lang-badge">{submission.language}</span>

            <button
              type="button"
              className="btn btn-secondary btn-sm copy-source-btn"
              onClick={handleCopyCode}
              aria-label="Copy source code to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400 mr-1" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Monaco Editor Read-Only Container */}
        <div className="submission-code-editor-box">
          {submission.sourceCode ? (
            <Editor
              height="480px"
              language={getMonacoLanguage(submission.language)}
              value={submission.sourceCode}
              theme={resolvedTheme === 'light' ? 'light' : 'vs-dark'}
              options={{
                readOnly: true,
                domReadOnly: true,
                fontSize: 14,
                fontFamily: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                cursorBlinking: 'smooth',
                wordWrap: 'on',
              }}
            />
          ) : (
            <div className="submission-missing-code-box">
              <AlertTriangle className="w-6 h-6 text-amber-400 mb-2" />
              <p>Source code is unavailable for this submission.</p>
            </div>
          )}
        </div>
      </div>

      {/* Phase 5.8.5: Submission Comparison Modal */}
      {submission && (
        <SubmissionComparisonModal
          isOpen={isCompareOpen}
          onClose={() => setIsCompareOpen(false)}
          initialSubmissionId={submission.id}
          problemId={submission.problemId}
          problemTitle={submission.problemTitle}
          token={token}
        />
      )}
    </div>
  );
}
