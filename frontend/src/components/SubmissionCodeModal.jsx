import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Code2,
  Clock,
  Cpu,
  Award,
  Calendar,
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

export default function SubmissionCodeModal({
  submission,
  onClose,
  onOpenInEditor,
}) {
  const [copied, setCopied] = useState(false);

  if (!submission) return null;

  const handleCopy = () => {
    if (!submission.sourceCode) return;
    navigator.clipboard?.writeText(submission.sourceCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getVerdictIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'wrong_answer':
        return <XCircle className="w-4 h-4 text-rose-400" />;
      case 'time_limit_exceeded':
      case 'memory_limit_exceeded':
        return <Clock className="w-4 h-4 text-amber-400" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
    }
  };

  const getVerdictClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'accepted':
        return 'modal-verdict-accepted';
      case 'wrong_answer':
        return 'modal-verdict-wa';
      case 'time_limit_exceeded':
        return 'modal-verdict-tle';
      default:
        return 'modal-verdict-err';
    }
  };

  const lines = (submission.sourceCode || '').split('\n');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="code-viewer-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="code-modal-header">
          <div className="code-modal-header-left">
            <div className="code-modal-icon-badge">
              <Code2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="code-modal-title-row">
                <h3 className="code-modal-title">
                  Submission #{submission.id} — {submission.problemTitle || `Problem #${submission.problemId}`}
                </h3>
                <span className={`modal-verdict-pill ${getVerdictClass(submission.status)}`}>
                  {getVerdictIcon(submission.status)}
                  <span>{submission.status?.replace(/_/g, ' ').toUpperCase()}</span>
                </span>
              </div>
              <p className="code-modal-subtitle">
                Language: <strong>{submission.language?.toUpperCase()}</strong> • Mode:{' '}
                <strong>{submission.codingMode === 'function' ? 'Function Mode' : 'Full Script'}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Execution Stats Bar */}
        <div className="code-modal-stats-bar">
          <div className="modal-stat-item">
            <Award className="w-4 h-4 text-amber-400" />
            <span>Score: <strong>{submission.score || 0} pts</strong></span>
          </div>

          <div className="modal-stat-item">
            <Clock className="w-4 h-4 text-blue-400" />
            <span>Runtime: <strong>{submission.executionTime || 0} ms</strong></span>
          </div>

          <div className="modal-stat-item">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>
              Memory:{' '}
              <strong>
                {submission.memoryUsed > 1024
                  ? Math.round(submission.memoryUsed / 1024)
                  : submission.memoryUsed || 0}{' '}
                MB
              </strong>
            </span>
          </div>

          <div className="modal-stat-item modal-stat-date">
            <Calendar className="w-4 h-4 text-muted" />
            <span>{new Date(submission.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {/* Source Code Container */}
        <div className="code-modal-body">
          <div className="code-toolbar">
            <span className="code-lang-tag">{submission.language}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm copy-code-btn"
              onClick={handleCopy}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied to Clipboard' : 'Copy Code'}</span>
            </button>
          </div>

          <div className="code-editor-preview">
            <div className="line-numbers-col">
              {lines.map((_, idx) => (
                <span key={idx} className="line-num">{idx + 1}</span>
              ))}
            </div>
            <pre className="code-lines-pre">
              <code>{submission.sourceCode || '// No code found'}</code>
            </pre>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="code-modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Close
          </button>

          {onOpenInEditor && (
            <button
              type="button"
              className="btn btn-primary btn-reopen-action"
              onClick={() => {
                onOpenInEditor({
                  problemId: submission.problemId,
                  code: submission.sourceCode,
                  language: submission.language,
                });
                onClose();
              }}
            >
              <span>Open in Workspace Editor</span>
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
