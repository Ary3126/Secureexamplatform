import React from 'react';
import { Award, Clock, Cpu, FileText, Code2 } from 'lucide-react';

export default function ProblemPane({
  problems = [],
  selectedProblem,
  onSelectProblem,
}) {
  if (!selectedProblem) {
    return (
      <div className="problem-pane" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
        <p>No problem selected.</p>
      </div>
    );
  }

  const sampleCases = selectedProblem.sampleTestCases || [];

  return (
    <div className="problem-pane">
      <div className="problem-header">
        <div className="problem-selector-row">
          {problems.length > 1 ? (
            <select
              className="select-input"
              style={{ fontWeight: 600, fontSize: '0.95rem' }}
              value={selectedProblem.id || selectedProblem.problemId}
              onChange={(e) => onSelectProblem(e.target.value)}
            >
              {problems.map((p, idx) => (
                <option key={p.id || p.problemId} value={p.id || p.problemId}>
                  {idx + 1}. {p.title}
                </option>
              ))}
            </select>
          ) : (
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              {selectedProblem.title}
            </h2>
          )}
        </div>

        <div className="problem-meta-row">
          <span className={`diff-badge diff-${selectedProblem.difficulty || 'easy'}`}>
            {selectedProblem.difficulty || 'easy'}
          </span>
          <span className="mode-badge mode-function">
            <Code2 className="w-3.5 h-3.5 inline mr-1" />
            LeetCode Function Mode
          </span>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>{selectedProblem.points || 100} Points</span>
          </span>
        </div>
      </div>

      <div className="problem-content">
        <div>
          <div className="section-title">
            <FileText className="w-3.5 h-3.5 inline mr-1" />
            Description
          </div>
          <div className="problem-desc">
            {selectedProblem.description}
          </div>
        </div>

        <div className="function-mode-hint">
          <p>
            Write only the required <code>Solution</code> class / method logic. Input parsing, headers, includes, and driver execution are handled automatically by the judge platform.
          </p>
        </div>

        {sampleCases.length > 0 && (
          <div>
            <div className="section-title">Example Test Cases</div>
            {sampleCases.map((tc, idx) => (
              <div key={tc.id || idx} className="sample-case-card">
                <div className="sample-case-header">Example {idx + 1}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>Input:</div>
                <div className="code-box">{tc.inputData || '(empty)'}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>Expected Output:</div>
                <div className="code-box" style={{ color: '#34d399' }}>{tc.expectedOutput}</div>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="section-title">Constraints & Limits</div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '0.85rem', color: '#94a3b8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock className="w-4 h-4 text-blue-400" />
              <span>Time Limit: <strong>2000 ms</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu className="w-4 h-4 text-purple-400" />
              <span>Memory Limit: <strong>256 MB</strong></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}