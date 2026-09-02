import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  Target,
  Sparkles,
  Anchor,
  HelpCircle,
  ChevronRight,
  Layers,
  Award,
} from 'lucide-react';

/**
 * SkillCard Component (Phase 5.7.6)
 * 
 * Reusable presentation component for displaying a user's algorithmic topic skill.
 * Strictly presents backend-authoritative values (score, level, confidence, classification, trend).
 */
export default function SkillCard({ skill, isOwnProfile = true, onSelect = null }) {
  if (!skill) return null;

  const topicName = skill.topicName || skill.name || skill.topicKey || 'Unknown Topic';
  const category = skill.category || skill.topicCategory || 'General';
  const score = skill.score !== undefined && skill.score !== null ? Number(skill.score) : null;
  const level = skill.level || 'BEGINNER';
  const confidence = skill.confidence !== undefined && skill.confidence !== null ? Number(skill.confidence) : 0;
  const classification = (skill.classification || 'UNASSESSED').toUpperCase();
  const solvedCount = skill.solvedCount ?? 0;
  const attemptedCount = skill.attemptedCount ?? 0;

  // Normalize trend direction
  let trendDirection = 'stable';
  if (typeof skill.trend === 'string') {
    trendDirection = skill.trend.toLowerCase();
  } else if (skill.trend && typeof skill.trend === 'object') {
    trendDirection = skill.trend.direction || 'stable';
  } else if (skill.trendDirection) {
    trendDirection = skill.trendDirection.toLowerCase();
  }

  // Confidence text and badge
  const getConfidenceInfo = (conf) => {
    if (conf >= 70) {
      return { label: 'High Confidence', tier: 'high', pct: Math.round(conf) };
    }
    if (conf >= 30) {
      return { label: 'Medium Confidence', tier: 'medium', pct: Math.round(conf) };
    }
    return { label: 'Low Confidence', tier: 'low', pct: Math.round(conf) };
  };

  const confidenceInfo = getConfidenceInfo(confidence);

  // Classification styling and icon metadata
  const getClassificationBadge = (status) => {
    switch (status) {
      case 'STRENGTH':
        return {
          label: 'Strength',
          badgeClass: 'badge-classification-strength',
          icon: <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'NEEDS_PRACTICE':
        return {
          label: 'Needs Practice',
          badgeClass: 'badge-classification-needs-practice',
          icon: <Target className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'DEVELOPING':
        return {
          label: 'Developing',
          badgeClass: 'badge-classification-developing',
          icon: <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'STABLE':
        return {
          label: 'Stable',
          badgeClass: 'badge-classification-stable',
          icon: <Anchor className="w-3.5 h-3.5" aria-hidden="true" />,
        };
      case 'UNASSESSED':
      default:
        return {
          label: 'Unassessed',
          badgeClass: 'badge-classification-unassessed',
          icon: <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />,
        };
    }
  };

  const classBadge = getClassificationBadge(classification);

  // Trend icon and label
  const renderTrendIndicator = (dir) => {
    switch (dir) {
      case 'improving':
        return (
          <span className="skill-trend-badge trend-improving" title="Performance is improving">
            <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Improving</span>
          </span>
        );
      case 'declining':
        return (
          <span className="skill-trend-badge trend-declining" title="Performance has declined">
            <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Declining</span>
          </span>
        );
      case 'stable':
      default:
        return (
          <span className="skill-trend-badge trend-stable" title="Performance is steady">
            <Minus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Stable</span>
          </span>
        );
    }
  };

  const getLevelBadgeClass = (lvl) => {
    switch (lvl?.toUpperCase()) {
      case 'EXPERT':
        return 'level-badge-expert';
      case 'ADVANCED':
        return 'level-badge-advanced';
      case 'PROFICIENT':
        return 'level-badge-proficient';
      case 'DEVELOPING':
        return 'level-badge-developing';
      case 'BEGINNER':
      default:
        return 'level-badge-beginner';
    }
  };

  return (
    <div
      className={`skill-card ${onSelect ? 'skill-card-clickable' : ''}`}
      onClick={() => onSelect && onSelect(skill)}
      tabIndex={onSelect ? 0 : undefined}
      role={onSelect ? 'button' : 'region'}
      aria-label={`${topicName} Skill Assessment: ${classification}, Score ${score ?? 'N/A'}`}
      onKeyDown={(e) => {
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(skill);
        }
      }}
    >
      {/* Top Header: Topic & Category */}
      <div className="skill-card-header">
        <div className="skill-card-title-group">
          <div className="skill-topic-icon-wrap">
            <Layers className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          </div>
          <div>
            <h4 className="skill-topic-name">{topicName}</h4>
            <span className="skill-category-pill">{category}</span>
          </div>
        </div>

        {/* Classification Badge */}
        <div className={`skill-classification-badge ${classBadge.badgeClass}`}>
          {classBadge.icon}
          <span>{classBadge.label}</span>
        </div>
      </div>

      {/* Main Score & Level Section */}
      <div className="skill-card-body">
        {isOwnProfile && score !== null ? (
          <div className="skill-score-row">
            <div className="skill-score-val-group">
              <span className="skill-score-number">{score.toFixed(1)}</span>
              <span className="skill-score-denom">/ 100</span>
            </div>
            <div className="skill-level-indicator">
              <span className={`skill-level-pill ${getLevelBadgeClass(level)}`}>
                <Award className="w-3 h-3" aria-hidden="true" />
                <span>{level}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="skill-score-row public-view">
            <span className={`skill-level-pill ${getLevelBadgeClass(level)}`}>
              <Award className="w-3 h-3" aria-hidden="true" />
              <span>{level}</span>
            </span>
            <span className="skill-public-solved">{solvedCount} Solved</span>
          </div>
        )}

        {/* Progress Bar (if own profile score is available) */}
        {isOwnProfile && score !== null && (
          <div className="skill-progress-track" aria-hidden="true">
            <div
              className={`skill-progress-fill fill-${classification.toLowerCase().replace('_', '-')}`}
              style={{ width: `${Math.min(100, Math.max(4, score))}%` }}
            />
          </div>
        )}

        {/* Metadata Footer: Confidence, Trend & Activity */}
        <div className="skill-card-footer">
          <div className="skill-confidence-group" title={`Evidence strength: ${confidenceInfo.pct}%`}>
            <span className={`confidence-dot dot-${confidenceInfo.tier}`} aria-hidden="true" />
            <span className="confidence-text">{confidenceInfo.label}</span>
          </div>

          <div className="skill-footer-right">
            {renderTrendIndicator(trendDirection)}
            {onSelect && (
              <ChevronRight className="w-4 h-4 text-slate-400 skill-arrow-icon" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
