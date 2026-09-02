import React from 'react';
import { Target, CheckCircle2 } from 'lucide-react';

/**
 * Difficulty Orbit Component
 * Visual circular arc representation of solved problems across Easy, Medium, and Hard tiers.
 */
export default function DifficultyOrbit({ difficultyStats = { easy: 0, medium: 0, hard: 0 }, totalSolved = 0 }) {
  const easyCount = difficultyStats.easy || 0;
  const mediumCount = difficultyStats.medium || 0;
  const hardCount = difficultyStats.hard || 0;
  const sumCount = totalSolved > 0 ? totalSolved : (easyCount + mediumCount + hardCount);

  const easyPct = sumCount > 0 ? Math.round((easyCount / sumCount) * 100) : 0;
  const medPct = sumCount > 0 ? Math.round((mediumCount / sumCount) * 100) : 0;
  const hardPct = sumCount > 0 ? Math.round((hardCount / sumCount) * 100) : 0;

  // Arc calculation for 3 segments around a 360 degree circle
  const size = 180;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Segment stroke dashes with spacing gap
  const gap = sumCount > 0 ? 4 : 0;
  const easyLen = sumCount > 0 ? Math.max(0, (easyCount / sumCount) * circumference - gap) : 0;
  const medLen = sumCount > 0 ? Math.max(0, (mediumCount / sumCount) * circumference - gap) : 0;
  const hardLen = sumCount > 0 ? Math.max(0, (hardCount / sumCount) * circumference - gap) : 0;

  const easyOffset = 0;
  const medOffset = -(easyLen + gap);
  const hardOffset = -(easyLen + gap + medLen + gap);

  return (
    <div className="difficulty-orbit-card">
      <div className="orbit-header">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-cyan-400" />
          <h4 className="orbit-title">Difficulty Orbit</h4>
        </div>
        <span className="orbit-sub">Unique Solved Distribution</span>
      </div>

      <div className="orbit-body">
        {/* Circular Orbit Ring Canvas */}
        <div className="orbit-chart-wrapper">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="orbit-svg">
            <defs>
              <linearGradient id="easyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <linearGradient id="medGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
              <linearGradient id="hardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f43f5e" />
                <stop offset="100%" stopColor="#fb7185" />
              </linearGradient>
            </defs>

            {/* Background Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--border-color)"
              strokeWidth={strokeWidth}
              strokeOpacity="0.4"
            />

            {sumCount === 0 ? (
              // Empty State Ring
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth={strokeWidth}
                strokeOpacity="0.2"
                strokeDasharray="4 6"
              />
            ) : (
              // Segmented Active Arcs
              <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                {easyLen > 0 && (
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="url(#easyGrad)"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${easyLen} ${circumference}`}
                    strokeDashoffset={easyOffset}
                    strokeLinecap="round"
                  />
                )}
                {medLen > 0 && (
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="url(#medGrad)"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${medLen} ${circumference}`}
                    strokeDashoffset={medOffset}
                    strokeLinecap="round"
                  />
                )}
                {hardLen > 0 && (
                  <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="url(#hardGrad)"
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${hardLen} ${circumference}`}
                    strokeDashoffset={hardOffset}
                    strokeLinecap="round"
                  />
                )}
              </g>
            )}
          </svg>

          {/* Center Stat Callout */}
          <div className="orbit-center-stat">
            <span className="orbit-center-num">{sumCount}</span>
            <span className="orbit-center-lbl">Solved</span>
          </div>
        </div>

        {/* Breakdown Badges */}
        <div className="orbit-pills-list">
          <div className="orbit-pill pill-easy">
            <div className="pill-dot dot-easy"></div>
            <div className="pill-info">
              <span className="pill-tier">Easy</span>
              <span className="pill-count">
                <strong>{easyCount}</strong> ({easyPct}%)
              </span>
            </div>
          </div>

          <div className="orbit-pill pill-medium">
            <div className="pill-dot dot-medium"></div>
            <div className="pill-info">
              <span className="pill-tier">Medium</span>
              <span className="pill-count">
                <strong>{mediumCount}</strong> ({medPct}%)
              </span>
            </div>
          </div>

          <div className="orbit-pill pill-hard">
            <div className="pill-dot dot-hard"></div>
            <div className="pill-info">
              <span className="pill-tier">Hard</span>
              <span className="pill-count">
                <strong>{hardCount}</strong> ({hardPct}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
