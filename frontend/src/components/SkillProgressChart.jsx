import React, { useState } from 'react';
import { Activity, Clock, ShieldCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * SkillProgressChart Component (Phase 5.7.6)
 * 
 * Pure SVG responsive chart showing historical skill progression over time.
 * Includes screen-reader accessible descriptions, interactive tooltips, and theme integration.
 */
export default function SkillProgressChart({
  history = [],
  topicName = 'Skill',
  isLoading = false,
  timeRange = 'all',
  onTimeRangeChange = null,
}) {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (isLoading) {
    return (
      <div className="skill-chart-loading-box">
        <div className="spinner-small" />
        <span>Loading skill progress history...</span>
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="skill-chart-empty-box">
        <Activity className="w-8 h-8 text-cyan-400 opacity-60 mb-2" aria-hidden="true" />
        <p className="font-medium text-slate-200">No Historical Snapshots Yet</p>
        <p className="text-xs text-slate-400 max-w-sm text-center mt-1">
          Historical progression snapshots are automatically recorded whenever you submit solutions to problems in {topicName}.
        </p>
      </div>
    );
  }

  // Sort chronological for display (oldest to newest)
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  const displayedHistory = timeRange === 'recent' ? sortedHistory.slice(-10) : sortedHistory;

  // Chart Dimensions
  const svgWidth = 640;
  const svgHeight = 220;
  const padding = { top: 25, right: 30, bottom: 35, left: 45 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;

  // Y-axis Bounds: 0 to 100
  const minY = 0;
  const maxY = 100;
  const rangeY = maxY - minY;

  // Generate data points
  const points = displayedHistory.map((item, i) => {
    const scoreVal = Number(item.score ?? 0);
    const x = padding.left + (displayedHistory.length === 1 ? chartW / 2 : (i / (displayedHistory.length - 1)) * chartW);
    const y = padding.top + chartH - (scoreVal / rangeY) * chartH;
    return {
      x,
      y,
      score: scoreVal,
      confidence: Number(item.confidence ?? 0),
      level: item.level || 'BEGINNER',
      classification: item.classification || 'UNASSESSED',
      recordedAt: item.recordedAt,
      id: item.id || `pt-${i}`,
      index: i,
    };
  });

  const pathData = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  const areaData = points.length > 0
    ? `${pathData} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`
    : '';

  // Generate Natural Language Accessible Textual Summary for Screen Readers
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const delta = lastPt.score - firstPt.score;
  const directionText = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'remained steady';
  const accessibleSummary = `${topicName} skill ${directionText} from ${firstPt.score.toFixed(1)} to ${lastPt.score.toFixed(1)} across ${points.length} snapshots recorded between ${new Date(firstPt.recordedAt).toLocaleDateString()} and ${new Date(lastPt.recordedAt).toLocaleDateString()}. Current confidence is ${lastPt.confidence.toFixed(1)} percent with status ${lastPt.classification}.`;

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    return new Date(isoStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="skill-progress-chart-container">
      {/* Screen Reader Live Region for Accessibility */}
      <div className="sr-only" aria-live="polite">
        {accessibleSummary}
      </div>

      {/* Chart Controls Bar */}
      <div className="skill-chart-header-row">
        <div className="skill-chart-title-group">
          <Activity className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <span className="skill-chart-title">Skill Score Timeline</span>
          <span className="skill-snapshot-count-pill">{points.length} Snapshots</span>
        </div>

        {onTimeRangeChange && (
          <div className="skill-chart-range-buttons" role="group" aria-label="Time range filter">
            <button
              type="button"
              className={`range-btn ${timeRange === 'recent' ? 'active' : ''}`}
              onClick={() => onTimeRangeChange('recent')}
            >
              Recent 10
            </button>
            <button
              type="button"
              className={`range-btn ${timeRange === 'all' ? 'active' : ''}`}
              onClick={() => onTimeRangeChange('all')}
            >
              All History
            </button>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="skill-chart-svg-wrapper">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="skill-svg-canvas"
          role="img"
          aria-label={`${topicName} historical skill progression graph`}
        >
          <defs>
            <linearGradient id="skillAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines (0, 25, 50, 75, 100) */}
          {[0, 25, 50, 75, 100].map((scoreLevel) => {
            const yVal = padding.top + chartH - (scoreLevel / rangeY) * chartH;
            return (
              <g key={scoreLevel}>
                <line
                  x1={padding.left}
                  y1={yVal}
                  x2={svgWidth - padding.right}
                  y2={yVal}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 10}
                  y={yVal + 3}
                  fill="rgba(255, 255, 255, 0.45)"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {scoreLevel}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          {areaData && <path d={areaData} fill="url(#skillAreaGrad)" />}

          {/* Score Curve */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive Data Points */}
          {points.map((p) => (
            <g key={p.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={hoveredPoint?.id === p.id ? 6 : 4}
                fill={p.score >= 65 ? '#10b981' : p.score < 35 ? '#f43f5e' : '#06b6d4'}
                stroke="#0f172a"
                strokeWidth="2"
                style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
                onMouseEnter={() => setHoveredPoint(p)}
                onMouseLeave={() => setHoveredPoint(null)}
                tabIndex={0}
                role="button"
                aria-label={`Snapshot on ${formatDate(p.recordedAt)}: Score ${p.score.toFixed(1)}, Confidence ${p.confidence.toFixed(1)}%`}
                onFocus={() => setHoveredPoint(p)}
                onBlur={() => setHoveredPoint(null)}
              />
            </g>
          ))}
        </svg>

        {/* Hover Tooltip */}
        {hoveredPoint && (
          <div
            className="skill-chart-tooltip"
            style={{
              left: `${Math.min(svgWidth - 140, Math.max(20, hoveredPoint.x - 60))}px`,
              top: `${Math.max(10, hoveredPoint.y - 85)}px`,
            }}
          >
            <div className="tooltip-date">{formatDate(hoveredPoint.recordedAt)}</div>
            <div className="tooltip-row">
              <span>Score:</span>
              <strong className="text-cyan-400">{hoveredPoint.score.toFixed(1)} / 100</strong>
            </div>
            <div className="tooltip-row">
              <span>Confidence:</span>
              <strong className="text-slate-300">{hoveredPoint.confidence.toFixed(1)}%</strong>
            </div>
            <div className="tooltip-row">
              <span>Status:</span>
              <strong className="text-emerald-400">{hoveredPoint.classification}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
