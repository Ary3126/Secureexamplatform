import React from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  HelpCircle,
} from 'lucide-react';

/**
 * Quality Score Card Component
 * Displays 0-100 score, level rating, category progress bars, and improvement recommendations.
 */
export default function QualityScoreCard({
  qualityData,
  loading = false,
  onRunEvaluation,
  onViewChecklist,
}) {
  if (!qualityData) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#38bdf8" />
            <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#f8fafc' }}>Quality & Editorial Health</h4>
          </div>
          <button
            onClick={onRunEvaluation}
            disabled={loading}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Evaluating...' : 'Run Quality Check'}
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
          Evaluate statement completeness, test cases coverage, code templates, and similarity score before requesting review.
        </p>
      </div>
    );
  }

  const { qualityScore = 0, qualityLevel = 'FAIR', categoryScores = {}, improvementSuggestions = [] } = qualityData;

  const levelConfigs = {
    EXCELLENT: { color: '#4ade80', bg: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.3)', label: 'Excellent' },
    GOOD: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)', label: 'Good' },
    FAIR: { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)', label: 'Fair' },
    NEEDS_IMPROVEMENT: { color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', label: 'Needs Improvement' },
  };

  const levelCfg = levelConfigs[qualityLevel] || levelConfigs.FAIR;

  const categories = [
    { key: 'statement', label: 'Problem Statement', max: 20, score: categoryScores.statementCompleteness ?? 0 },
    { key: 'testCoverage', label: 'Test Coverage', max: 25, score: categoryScores.testCoverage ?? 0 },
    { key: 'templates', label: 'Code Templates', max: 15, score: categoryScores.codingModeAndTemplates ?? 0 },
    { key: 'difficulty', label: 'Difficulty Calibration', max: 10, score: categoryScores.difficultyConsistency ?? 0 },
    { key: 'complexity', label: 'Complexity Bounds', max: 10, score: categoryScores.complexityDocumentation ?? 0 },
    { key: 'similarity', label: 'Similarity Risk', max: 10, score: categoryScores.similarityRisk ?? 0 },
    { key: 'title', label: 'Title Quality', max: 10, score: categoryScores.titleQuality ?? 0 },
  ];

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* Header with Score & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '18px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Sparkles size={18} color="#38bdf8" />
            <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>Quality Score</h4>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: levelCfg.bg,
                color: levelCfg.color,
                border: `1px solid ${levelCfg.border}`,
              }}
            >
              {levelCfg.label}
            </span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Evaluates completeness, constraint precision, and test case coverage.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: levelCfg.color, lineHeight: '1' }}>
              {qualityScore} <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '500' }}>/ 100</span>
            </div>
          </div>
          <button
            onClick={onRunEvaluation}
            disabled={loading}
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Checking...' : 'Re-check'}
          </button>
        </div>
      </div>

      {/* Category Progress Bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        {categories.map((cat) => {
          const pct = Math.min(100, Math.round((cat.score / cat.max) * 100));
          const barColor = pct >= 80 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';

          return (
            <div key={cat.key} style={{ background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
                <span style={{ color: '#cbd5e1' }}>{cat.label}</span>
                <span style={{ fontWeight: '700', color: barColor }}>
                  {cat.score} / {cat.max}
                </span>
              </div>
              <div style={{ height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Actionable Improvement Suggestions */}
      {improvementSuggestions && improvementSuggestions.length > 0 && (
        <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '0.82rem', fontWeight: '700', color: '#fbbf24' }}>
            <AlertTriangle size={14} />
            <span>Recommended Improvements ({improvementSuggestions.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {improvementSuggestions.slice(0, 3).map((item, idx) => (
              <div key={idx} style={{ fontSize: '0.78rem', color: '#fde68a', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <span>•</span>
                <span>{item.message || item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer link to view full checklist */}
      {onViewChecklist && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onViewChecklist}
            style={{
              background: 'transparent',
              color: '#38bdf8',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: 0,
            }}
          >
            <span>View Full 12-Item Editorial Checklist</span>
            <ExternalLink size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
