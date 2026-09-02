import React from 'react';

/**
 * Deterministic "Code Core" Dynamic SVG Emblem
 * Generates an original, high-tech geometric coding badge based on user rating,
 * tier, problem solves count, and username hash.
 * 
 * Zero external dependencies. 100% pure responsive SVG.
 */
export default function CoderEmblem({
  username = 'coder',
  rating = 1200,
  tierTitle = 'Competitor',
  tierColor = '#3b82f6',
  solvedCount = 0,
  size = 'lg', // 'sm' | 'md' | 'lg' | 'hero'
  className = '',
}) {
  // Deterministic seed from username
  const seed = (username || 'user')
    .split('')
    .reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0);

  // Derive geometric variations
  const nodeCount = 6 + (seed % 4); // 6 to 9 vertices
  const circuitRotation = (seed * 17) % 360;
  const innerRays = 4 + (seed % 5);

  const dimMap = {
    sm: 36,
    md: 56,
    lg: 96,
    hero: 130,
  };
  const dim = dimMap[size] || dimMap.lg;
  const cx = dim / 2;
  const cy = dim / 2;
  const rOuter = (dim / 2) * 0.88;
  const rCore = (dim / 2) * 0.46;
  const rInner = (dim / 2) * 0.26;

  // Polygon points for outer matrix ring
  const polygonPoints = Array.from({ length: nodeCount }).map((_, i) => {
    const angle = (i * 2 * Math.PI) / nodeCount - Math.PI / 2;
    const x = cx + rOuter * Math.cos(angle);
    const y = cy + rOuter * Math.sin(angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Circuit tick marks around core
  const circuitTicks = Array.from({ length: 12 }).map((_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const x1 = cx + (rCore + 2) * Math.cos(angle);
    const y1 = cy + (rCore + 2) * Math.sin(angle);
    const x2 = cx + (rCore + 6) * Math.cos(angle);
    const y2 = cy + (rCore + 6) * Math.sin(angle);
    return { x1, y1, x2, y2, angle };
  });

  const uniqueId = `emblem-${username.replace(/[^a-zA-Z0-9]/g, '')}-${rating}`;

  return (
    <div
      className={`coder-emblem-container emblem-size-${size} ${className}`}
      style={{ width: dim, height: dim, minWidth: dim, minHeight: dim }}
      title={`${username} • ${tierTitle} (${rating})`}
    >
      <svg
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        className="coder-emblem-svg"
      >
        <defs>
          <linearGradient id={`grad-ring-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tierColor} stopOpacity="0.9" />
            <stop offset="50%" stopColor={tierColor} stopOpacity="0.4" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.8" />
          </linearGradient>

          <linearGradient id={`grad-core-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>

          <filter id={`glow-${uniqueId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer Tech Orbit Ring */}
        <polygon
          points={polygonPoints}
          fill="none"
          stroke={`url(#grad-ring-${uniqueId})`}
          strokeWidth={size === 'hero' ? '2.5' : size === 'lg' ? '2' : '1.5'}
          strokeDasharray="6 3"
          className="emblem-orbit-polygon"
        />

        {/* Ambient Glow Aura */}
        <circle
          cx={cx}
          cy={cy}
          r={rOuter * 0.95}
          fill="none"
          stroke={tierColor}
          strokeWidth="1"
          strokeOpacity="0.25"
          filter={`url(#glow-${uniqueId})`}
        />

        {/* Circuit Interconnect Rays */}
        <g transform={`rotate(${circuitRotation}, ${cx}, ${cy})`}>
          {circuitTicks.map((t, idx) => (
            <line
              key={idx}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={idx % 2 === 0 ? tierColor : '#64748b'}
              strokeWidth={idx % 3 === 0 ? '1.5' : '0.8'}
              strokeOpacity="0.7"
            />
          ))}
        </g>

        {/* Core Shield */}
        <circle
          cx={cx}
          cy={cy}
          r={rCore}
          fill={`url(#grad-core-${uniqueId})`}
          stroke={tierColor}
          strokeWidth={size === 'hero' ? '2' : '1.5'}
          strokeOpacity="0.85"
        />

        {/* Concentric Node Rings */}
        <circle
          cx={cx}
          cy={cy}
          r={rInner * 1.3}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="0.8"
          strokeOpacity="0.4"
          strokeDasharray="2 2"
        />

        {/* Central Geometric Coding Monogram / Glyph */}
        <g transform={`translate(${cx}, ${cy})`}>
          {size === 'sm' ? (
            // Simplified micro-bracket for small sizes
            <path
              d="M -4 -5 L -7 0 L -4 5 M 4 -5 L 7 0 L 4 5"
              fill="none"
              stroke={tierColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            // Rich multi-segment code node glyph for md/lg/hero
            <>
              {/* Left & Right Code Brackets */}
              <path
                d={`M ${-rInner * 0.8} ${-rInner * 0.7} L ${-rInner * 1.3} 0 L ${-rInner * 0.8} ${rInner * 0.7}`}
                fill="none"
                stroke={tierColor}
                strokeWidth={size === 'hero' ? '2.5' : '2'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={`M ${rInner * 0.8} ${-rInner * 0.7} L ${rInner * 1.3} 0 L ${rInner * 0.8} ${rInner * 0.7}`}
                fill="none"
                stroke={tierColor}
                strokeWidth={size === 'hero' ? '2.5' : '2'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Slash / Center Binary Node */}
              <line
                x1={-rInner * 0.25}
                y1={rInner * 0.7}
                x2={rInner * 0.25}
                y2={-rInner * 0.7}
                stroke="#38bdf8"
                strokeWidth={size === 'hero' ? '2' : '1.5'}
                strokeLinecap="round"
              />

              {/* Center Diamond Pulsar */}
              <polygon
                points={`0,${-rInner * 0.35} ${rInner * 0.35},0 0,${rInner * 0.35} ${-rInner * 0.35},0`}
                fill={tierColor}
                fillOpacity="0.8"
              />
            </>
          )}
        </g>

        {/* Orbit Node Markers */}
        {Array.from({ length: 4 }).map((_, i) => {
          const angle = (i * 90 * Math.PI) / 180 + Math.PI / 4;
          const nx = cx + rOuter * Math.cos(angle);
          const ny = cy + rOuter * Math.sin(angle);
          return (
            <circle
              key={i}
              cx={nx}
              cy={ny}
              r={size === 'hero' ? 2.5 : 1.8}
              fill={tierColor}
              stroke="#0f172a"
              strokeWidth="1"
            />
          );
        })}
      </svg>
    </div>
  );
}
