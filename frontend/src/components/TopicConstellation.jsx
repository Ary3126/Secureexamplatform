import React, { useState } from 'react';
import { Network, Sparkles, Activity } from 'lucide-react';

/**
 * Topic Constellation Component
 * Interactive SVG network visualization representing algorithmic domain mastery.
 */
export default function TopicConstellation({ topicStats = [] }) {
  const [hoveredTopic, setHoveredTopic] = useState(null);

  const fallbackTopics = [
    { id: 'arrays', name: 'Arrays & Vectors', count: 0, percentage: 0, active: false },
    { id: 'strings', name: 'Strings & Parsing', count: 0, percentage: 0, active: false },
    { id: 'math', name: 'Math & Logic', count: 0, percentage: 0, active: false },
    { id: 'searching', name: 'Searching & Binary Search', count: 0, percentage: 0, active: false },
    { id: 'sorting', name: 'Sorting & Ordering', count: 0, percentage: 0, active: false },
    { id: 'trees', name: 'Trees & BST', count: 0, percentage: 0, active: false },
    { id: 'graphs', name: 'Graphs & BFS/DFS', count: 0, percentage: 0, active: false },
    { id: 'dp', name: 'Dynamic Programming', count: 0, percentage: 0, active: false },
    { id: 'data_structures', name: 'Stacks & Queues', count: 0, percentage: 0, active: false },
  ];

  const topics = topicStats && topicStats.length > 0 ? topicStats : fallbackTopics;
  const activeCount = topics.filter((t) => t.count > 0).length;

  // Constellation SVG layout coordinates
  const width = 360;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2;

  // Fixed constellation layout points for standard 9 topics
  const nodePositions = [
    { x: cx, y: 38 },            // 0: Arrays (Top)
    { x: cx + 110, y: 70 },       // 1: Strings (Top-Right)
    { x: cx + 125, y: 155 },      // 2: Math (Right)
    { x: cx + 60, y: 205 },       // 3: Searching (Bottom-Right)
    { x: cx - 60, y: 205 },       // 4: Sorting (Bottom-Left)
    { x: cx - 125, y: 155 },      // 5: Trees (Left)
    { x: cx - 110, y: 70 },       // 6: Graphs (Top-Left)
    { x: cx + 45, y: cy },        // 7: DP (Inner-Right)
    { x: cx - 45, y: cy },        // 8: Stacks/Queues (Inner-Left)
  ];

  // Interconnecting constellation edges
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], // Outer ring
    [0, 7], [0, 8], [7, 8], [7, 2], [8, 5], [7, 3], [8, 4], // Cross links
  ];

  return (
    <div className="topic-constellation-card">
      <div className="constellation-header">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-purple-400" />
          <h4 className="constellation-title">Topic Constellation</h4>
        </div>
        <span className="constellation-badge">
          {activeCount > 0 ? `${activeCount} Domains Active` : 'Awaiting Data'}
        </span>
      </div>

      <div className="constellation-canvas-wrapper">
        <svg viewBox={`0 0 ${width} ${height}`} className="constellation-svg">
          <defs>
            <linearGradient id="edgeGradActive" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.6" />
            </linearGradient>

            <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Connected Web Edges */}
          {edges.map(([fromIdx, toIdx], eIdx) => {
            const p1 = nodePositions[fromIdx];
            const p2 = nodePositions[toIdx];
            const t1 = topics[fromIdx];
            const t2 = topics[toIdx];
            const isConnectedActive = t1?.count > 0 && t2?.count > 0;
            const isHighlighted = hoveredTopic && (hoveredTopic.id === t1?.id || hoveredTopic.id === t2?.id);

            return (
              <line
                key={eIdx}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={isHighlighted ? '#38bdf8' : isConnectedActive ? 'url(#edgeGradActive)' : 'rgba(255, 255, 255, 0.08)'}
                strokeWidth={isHighlighted ? 2 : isConnectedActive ? 1.5 : 1}
                strokeDasharray={isConnectedActive ? 'none' : '3 3'}
                className="constellation-edge"
              />
            );
          })}

          {/* Star Constellation Nodes */}
          {topics.slice(0, 9).map((topic, idx) => {
            const pos = nodePositions[idx] || { x: cx, y: cy };
            const isActive = topic.count > 0;
            const isHovered = hoveredTopic?.id === topic.id;
            const nodeRadius = isActive ? Math.min(10, 5 + Math.sqrt(topic.count) * 2) : 4;
            const nodeColor = isActive ? '#a855f7' : 'rgba(148, 163, 184, 0.4)';

            return (
              <g
                key={topic.id || idx}
                className="constellation-node-group"
                onMouseEnter={() => setHoveredTopic({ ...topic, ...pos })}
                onMouseLeave={() => setHoveredTopic(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Aura Pulse on Active Nodes */}
                {isActive && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeRadius + 4}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="1"
                    strokeOpacity="0.4"
                    filter="url(#nodeGlow)"
                  />
                )}

                {/* Node Body */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isHovered ? nodeRadius + 2 : nodeRadius}
                  fill={isHovered ? '#38bdf8' : nodeColor}
                  stroke="#0f172a"
                  strokeWidth="2"
                  className="constellation-node-circle"
                />

                {/* Node Label */}
                <text
                  x={pos.x}
                  y={pos.y + nodeRadius + 12}
                  textAnchor="middle"
                  fill={isActive ? 'var(--text-primary)' : 'var(--text-muted)'}
                  fontSize="8.5"
                  fontWeight={isActive ? '700' : '500'}
                  className="constellation-node-label"
                >
                  {topic.name.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip */}
        {hoveredTopic && (
          <div
            className="constellation-tooltip"
            style={{
              left: `${(hoveredTopic.x / width) * 100}%`,
              top: `${(hoveredTopic.y / height) * 100}%`,
            }}
          >
            <div className="tooltip-topic-name">{hoveredTopic.name}</div>
            <div className="tooltip-topic-solved">
              <span>Solved:</span>
              <strong>{hoveredTopic.count} problems</strong>
            </div>
            {hoveredTopic.count > 0 && (
              <div className="tooltip-topic-pct">
                <span>Domain Share:</span>
                <strong>{hoveredTopic.percentage}%</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Domain Pills List */}
      <div className="constellation-topics-grid">
        {topics.slice(0, 6).map((t) => (
          <div
            key={t.id}
            className={`topic-tile ${t.count > 0 ? 'tile-active' : 'tile-dormant'}`}
          >
            <span className="topic-tile-name">{t.name}</span>
            <span className="topic-tile-count">{t.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
