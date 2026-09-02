import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Cpu,
  Award,
  History,
  Terminal,
  Sparkles,
  Zap,
  Check,
  AlertCircle,
  Copy,
  ChevronRight,
  Flame,
  Code2,
} from 'lucide-react';

export default function ConsolePane({
  activeTab,
  onTabChange,
  runResult,
  submissionVerdict,
  historyList = [],
  onLoadSubmissionCode,
  onViewSubmissionDetail,
}) {
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState(null);

  const handleCopy = (text, idx) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const formatStatus = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return 'Accepted';
      case 'wrong_answer':
        return 'Wrong Answer';
      case 'compilation_error':
        return 'Compilation Error';
      case 'runtime_error':
        return 'Runtime Error';
      case 'time_limit_exceeded':
        return 'Time Limit Exceeded';
      case 'memory_limit_exceeded':
        return 'Memory Limit Exceeded';
      case 'system_error':
        return 'System Error';
      case 'queued':
        return 'Queued in Judge';
      case 'running':
        return 'Evaluating...';
      default:
        return status ? status.replace(/_/g, ' ').toUpperCase() : 'Ready';
    }
  };

  const getVerdictTheme = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return {
          bannerClass: 'verdict-hero-accepted',
          icon: CheckCircle2,
          iconColor: '#10b981',
          accent: '#10b981',
          bgGlow: 'rgba(16, 185, 129, 0.15)',
          tag: 'All Testcases Passed',
        };
      case 'wrong_answer':
        return {
          bannerClass: 'verdict-hero-wa',
          icon: XCircle,
          iconColor: '#f43f5e',
          accent: '#f43f5e',
          bgGlow: 'rgba(244, 63, 94, 0.15)',
          tag: 'Output Mismatch',
        };
      case 'time_limit_exceeded':
        return {
          bannerClass: 'verdict-hero-tle',
          icon: Clock,
          iconColor: '#f59e0b',
          accent: '#f59e0b',
          bgGlow: 'rgba(245, 158, 11, 0.15)',
          tag: 'Time Limit Exceeded',
        };
      case 'compilation_error':
      case 'runtime_error':
      case 'system_error':
        return {
          bannerClass: 'verdict-hero-err',
          icon: AlertTriangle,
          iconColor: '#fb7185',
          accent: '#f43f5e',
          bgGlow: 'rgba(244, 63, 94, 0.15)',
          tag: 'Execution Fault',
        };
      case 'queued':
      case 'running':
        return {
          bannerClass: 'verdict-hero-running',
          icon: Zap,
          iconColor: '#3b82f6',
          accent: '#3b82f6',
          bgGlow: 'rgba(59, 130, 246, 0.15)',
          tag: 'Sandbox Evaluation',
        };
      default:
        return {
          bannerClass: 'verdict-hero-default',
          icon: Terminal,
          iconColor: '#94a3b8',
          accent: '#94a3b8',
          bgGlow: 'transparent',
          tag: 'Evaluation',
        };
    }
  };

  const sampleResults = runResult?.sampleResults || [];
  const currentCase = sampleResults[selectedCaseIdx] || sampleResults[0];

  return (
    <div className="console-pane-container">
      {/* Console Tab Header */}
      <div className="console-tabs-bar">
        <button
          type="button"
          className={`console-tab-btn ${activeTab === 'testcases' ? 'active' : ''}`}
          onClick={() => onTabChange('testcases')}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Testcase Results</span>
          {runResult?.sampleResults && (
            <span className="console-tab-count">
              {runResult.sampleResults.filter((s) => s.status === 'passed').length}/{runResult.sampleResults.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`console-tab-btn ${activeTab === 'verdict' ? 'active' : ''}`}
          onClick={() => onTabChange('verdict')}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Submission Verdict</span>
          {submissionVerdict && (
            <span className={`console-status-dot dot-${submissionVerdict.status}`}></span>
          )}
        </button>

        <button
          type="button"
          className={`console-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => onTabChange('history')}
        >
          <History className="w-3.5 h-3.5" />
          <span>History</span>
          <span className="console-tab-count">{historyList.length}</span>
        </button>
      </div>

      {/* Console Content Body */}
      <div className="console-content-box">
        {/* ========================================================
            TAB 1: TESTCASE RESULTS (INTERACTIVE RUN)
            ======================================================== */}
        {activeTab === 'testcases' && (
          <div className="console-tab-pane">
            {!runResult ? (
              <div className="console-empty-state">
                <Terminal className="w-8 h-8 text-muted" />
                <p className="empty-title">No Test Run Results Yet</p>
                <p className="empty-hint">Click <strong>"Run"</strong> in the editor toolbar to test your solution against visible sample cases.</p>
              </div>
            ) : runResult.status === 'running' ? (
              <div className="console-loading-state">
                <div className="btn-spinner" style={{ width: '24px', height: '24px' }}></div>
                <span>Executing test cases in Docker sandbox...</span>
              </div>
            ) : runResult.errorMessage && sampleResults.length === 0 ? (
              <div className="console-error-card">
                <div className="error-card-header">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                  <h4>Execution Failed</h4>
                </div>
                <pre className="error-card-pre">{runResult.errorMessage}</pre>
              </div>
            ) : (
              <div className="testcases-explorer">
                {/* Case selector tabs */}
                <div className="case-selector-strip">
                  {sampleResults.map((tc, idx) => {
                    const isPassed = tc.status === 'passed';
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`case-pill-btn ${selectedCaseIdx === idx ? 'active' : ''} ${isPassed ? 'passed' : 'failed'}`}
                        onClick={() => setSelectedCaseIdx(idx)}
                      >
                        <span className="case-pill-status">
                          {isPassed ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        </span>
                        <span>Case {idx + 1}</span>
                      </button>
                    );
                  })}
                  <div className="testcase-speed-tag">
                    <Clock className="w-3 h-3 text-blue-400" />
                    <span>{runResult.executionTime || 0} ms</span>
                  </div>
                </div>

                {/* Case I/O details */}
                {currentCase && (
                  <div className="case-detail-grid">
                    <div className="case-io-card">
                      <div className="case-io-header">
                        <span>Input Data</span>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => handleCopy(currentCase.input, `in-${selectedCaseIdx}`)}
                        >
                          {copiedIdx === `in-${selectedCaseIdx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedIdx === `in-${selectedCaseIdx}` ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <pre className="case-io-pre">{currentCase.input || '(empty input)'}</pre>
                    </div>

                    <div className="case-io-card">
                      <div className="case-io-header">
                        <span>Expected Output</span>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() => handleCopy(currentCase.expectedOutput, `exp-${selectedCaseIdx}`)}
                        >
                          {copiedIdx === `exp-${selectedCaseIdx}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedIdx === `exp-${selectedCaseIdx}` ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <pre className="case-io-pre case-expected-pre">{currentCase.expectedOutput || '(empty)'}</pre>
                    </div>

                    <div className="case-io-card">
                      <div className="case-io-header">
                        <span>Your Actual Output</span>
                        <span className={`case-verdict-tag ${currentCase.status === 'passed' ? 'tag-passed' : 'tag-failed'}`}>
                          {currentCase.status === 'passed' ? 'PASSED' : 'WRONG OUTPUT'}
                        </span>
                      </div>
                      <pre className={`case-io-pre ${currentCase.status === 'passed' ? 'case-actual-pass' : 'case-actual-fail'}`}>
                        {currentCase.actualOutput || '(no output)'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 2: SUBMISSION VERDICT (UNIQUE & MODERN HERO)
            ======================================================== */}
        {activeTab === 'verdict' && (
          <div className="console-tab-pane">
            {!submissionVerdict ? (
              <div className="console-empty-state">
                <Award className="w-8 h-8 text-muted" />
                <p className="empty-title">No Official Submission Yet</p>
                <p className="empty-hint">Click <strong>"Submit"</strong> in the editor toolbar to run your code against hidden test cases and earn points.</p>
              </div>
            ) : submissionVerdict.status === 'queued' || submissionVerdict.status === 'running' ? (
              <div className="console-loading-state">
                <div className="btn-spinner" style={{ width: '28px', height: '28px' }}></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: 600 }}>Judging Submission in Progress...</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Executing test suites in isolated sandbox environment</span>
                </div>
              </div>
            ) : (
              (() => {
                const theme = getVerdictTheme(submissionVerdict.status);
                const IconComponent = theme.icon;
                const isAccepted = submissionVerdict.status === 'accepted';
                const totalCases = submissionVerdict.testCasesTotal || 0;
                const passedCases = submissionVerdict.testCasesPassed || 0;
                const passRatio = totalCases > 0 ? (passedCases / totalCases) * 100 : (isAccepted ? 100 : 0);

                return (
                  <div className="verdict-unique-container">
                    {/* Modern Hero Card */}
                    <div className={`verdict-hero-card ${theme.bannerClass}`}>
                      {/* Left: Status Badge & Big Headline */}
                      <div className="verdict-hero-left">
                        <div className="verdict-icon-bubble">
                          <IconComponent className="w-7 h-7" style={{ color: theme.iconColor }} />
                        </div>
                        <div>
                          <div className="verdict-headline-row">
                            <h3 className="verdict-hero-title">{formatStatus(submissionVerdict.status)}</h3>
                            {isAccepted && (
                              <div className="verdict-celebrate-chip">
                                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Perfect Score</span>
                              </div>
                            )}
                          </div>
                          <p className="verdict-hero-subtitle">{theme.tag}</p>
                        </div>
                      </div>

                      {/* Right: Key Metric Cards Grid */}
                      <div className="verdict-metrics-grid">
                        <div className="verdict-metric-tile">
                          <div className="metric-tile-header">
                            <Award className="w-3.5 h-3.5 text-amber-400" />
                            <span>Score</span>
                          </div>
                          <div className="metric-tile-value">
                            <span className="metric-bold">{submissionVerdict.score || (isAccepted ? 100 : 0)}</span>
                            <span className="metric-unit">pts</span>
                          </div>
                        </div>

                        <div className="verdict-metric-tile">
                          <div className="metric-tile-header">
                            <Clock className="w-3.5 h-3.5 text-blue-400" />
                            <span>Runtime</span>
                          </div>
                          <div className="metric-tile-value">
                            <span className="metric-bold">{submissionVerdict.executionTime || 0}</span>
                            <span className="metric-unit">ms</span>
                          </div>
                        </div>

                        <div className="verdict-metric-tile">
                          <div className="metric-tile-header">
                            <Cpu className="w-3.5 h-3.5 text-purple-400" />
                            <span>Memory</span>
                          </div>
                          <div className="metric-tile-value">
                            <span className="metric-bold">
                              {submissionVerdict.memoryUsed > 1024
                                ? Math.round(submissionVerdict.memoryUsed / 1024)
                                : submissionVerdict.memoryUsed || 0}
                            </span>
                            <span className="metric-unit">MB</span>
                          </div>
                        </div>

                        {totalCases > 0 && (
                          <div className="verdict-metric-tile">
                            <div className="metric-tile-header">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Pass Rate</span>
                            </div>
                            <div className="metric-tile-value">
                              <span className="metric-bold">{passedCases}/{totalCases}</span>
                              <span className="metric-unit">({Math.round(passRatio)}%)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar for Test Suite */}
                    {totalCases > 0 && (
                      <div className="verdict-progress-section">
                        <div className="verdict-progress-track">
                          <div
                            className="verdict-progress-fill"
                            style={{
                              width: `${passRatio}%`,
                              backgroundColor: theme.accent,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Error Output if any */}
                    {submissionVerdict.errorMessage && (
                      <div className="verdict-error-section">
                        <h4 className="error-title">
                          <AlertCircle className="w-4 h-4 text-rose-500" />
                          <span>Judge Diagnostic Log</span>
                        </h4>
                        <pre className="error-log-pre">{submissionVerdict.errorMessage}</pre>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* ========================================================
            TAB 3: SUBMISSION HISTORY
            ======================================================== */}
        {activeTab === 'history' && (
          <div className="console-tab-pane">
            {historyList.length === 0 ? (
              <div className="console-empty-state">
                <History className="w-8 h-8 text-muted" />
                <p className="empty-title">No Previous Submissions</p>
                <p className="empty-hint">Your official submission attempts for this problem will appear here.</p>
              </div>
            ) : (
              <div className="history-table-container">
                <table className="history-table-custom">
                  <thead>
                    <tr>
                      <th>Submission ID</th>
                      <th>Status</th>
                      <th>Language</th>
                      <th>Score</th>
                      <th>Runtime</th>
                      <th>Memory</th>
                      <th>Submitted</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyList.map((sub) => {
                      const theme = getVerdictTheme(sub.status);
                      return (
                        <tr key={sub.id}>
                          <td className="history-id-cell">#{sub.id}</td>
                          <td>
                            <span className={`history-status-pill pill-${sub.status}`}>
                              {formatStatus(sub.status)}
                            </span>
                          </td>
                          <td className="history-lang-cell">{sub.language?.toUpperCase()}</td>
                          <td className="history-score-cell">{sub.score || 0} pts</td>
                          <td className="history-time-cell">{sub.executionTime || 0} ms</td>
                          <td className="history-mem-cell">
                            {sub.memoryUsed > 1024 ? Math.round(sub.memoryUsed / 1024) : sub.memoryUsed || 0} MB
                          </td>
                          <td className="history-date-cell">
                            {new Date(sub.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="history-action-cell">
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {onLoadSubmissionCode && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', height: '24px' }}
                                  onClick={() => onLoadSubmissionCode(sub.id)}
                                  title="Load this submission's code into the editor"
                                >
                                  <Code2 className="w-3 h-3 mr-1" />
                                  <span>Load</span>
                                </button>
                              )}
                              {onViewSubmissionDetail && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '0.75rem', height: '24px' }}
                                  onClick={() => onViewSubmissionDetail(sub.id)}
                                  title="View full submission details and statistics"
                                >
                                  <span>Details</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}