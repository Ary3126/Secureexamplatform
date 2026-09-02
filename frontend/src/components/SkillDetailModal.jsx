import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Layers,
  Award,
  ShieldCheck,
  Target,
  Sparkles,
  Anchor,
  HelpCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Clock,
  History,
  Activity,
} from 'lucide-react';
import SkillProgressChart from './SkillProgressChart';

/**
 * SkillDetailModal Component (Phase 5.7.6)
 * 
 * Focused modal dialog for deep topic inspection, historical progression curves,
 * and evidence breakdown.
 */
export default function SkillDetailModal({
  skill,
  token,
  targetUsername = null,
  isOwnProfile = true,
  onClose,
}) {
  const [historyData, setHistoryData] = useState([]);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('all');

  const topicKey = skill?.topicKey || '';
  const topicName = skill?.topicName || skill?.name || topicKey;

  const fetchTopicHistory = useCallback(async () => {
    if (!topicKey) return;
    setLoading(true);
    setError(null);
    try {
      let endpoint = '';
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      if (isOwnProfile) {
        endpoint = `/api/skills/my/history/${encodeURIComponent(topicKey)}?limit=50&order=DESC`;
      } else if (targetUsername) {
        endpoint = `/api/skills/user/${encodeURIComponent(targetUsername)}/history?topicKey=${encodeURIComponent(topicKey)}&limit=50&order=DESC`;
      } else {
        endpoint = `/api/skills/my/history/${encodeURIComponent(topicKey)}?limit=50&order=DESC`;
      }

      const res = await fetch(endpoint, { headers });
      const data = await res.json();

      if (res.ok && data.success) {
        setHistoryData(data.history || []);
        setTrendData(data.trend || null);
      } else {
        setError(data.message || 'Failed to fetch topic history');
      }
    } catch (err) {
      setError(err.message || 'Network error loading progress history');
    } finally {
      setLoading(false);
    }
  }, [topicKey, isOwnProfile, targetUsername, token]);

  useEffect(() => {
    fetchTopicHistory();
  }, [fetchTopicHistory]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!skill) return null;

  const score = skill.score !== undefined && skill.score !== null ? Number(skill.score) : null;
  const level = skill.level || 'BEGINNER';
  const confidence = skill.confidence !== undefined && skill.confidence !== null ? Number(skill.confidence) : 0;
  const classification = (skill.classification || 'UNASSESSED').toUpperCase();
  const category = skill.category || skill.topicCategory || 'General';

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    return new Date(isoStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="skill-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-detail-title"
    >
      <div className="skill-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="skill-modal-header">
          <div className="skill-modal-header-info">
            <div className="skill-modal-icon-wrap">
              <Layers className="w-5 h-5 text-cyan-400" aria-hidden="true" />
            </div>
            <div>
              <h2 id="skill-detail-title" className="skill-modal-title">
                {topicName}
              </h2>
              <span className="skill-category-pill">{category}</span>
            </div>
          </div>

          <button
            type="button"
            className="skill-modal-close-btn"
            onClick={onClose}
            aria-label="Close detail modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="skill-modal-body">
          {/* Quick Metrics Strip */}
          <div className="skill-modal-metrics-grid">
            {isOwnProfile && score !== null && (
              <div className="skill-modal-metric-card">
                <span className="modal-metric-lbl">Skill Score</span>
                <div className="modal-metric-val-row">
                  <span className="modal-metric-val text-cyan-400">{score.toFixed(1)}</span>
                  <span className="modal-metric-sub">/ 100</span>
                </div>
              </div>
            )}

            <div className="skill-modal-metric-card">
              <span className="modal-metric-lbl">Proficiency Level</span>
              <span className="modal-metric-val text-slate-100">{level}</span>
            </div>

            <div className="skill-modal-metric-card">
              <span className="modal-metric-lbl">Assessment Status</span>
              <span className={`modal-metric-val badge-text-${classification.toLowerCase().replace('_', '-')}`}>
                {classification.replace('_', ' ')}
              </span>
            </div>

            <div className="skill-modal-metric-card">
              <span className="modal-metric-lbl">Confidence</span>
              <span className="modal-metric-val text-emerald-400">{confidence.toFixed(1)}%</span>
            </div>

            <div className="skill-modal-metric-card">
              <span className="modal-metric-lbl">Unique Solved</span>
              <span className="modal-metric-val">{skill.solvedCount ?? 0} Problems</span>
            </div>
          </div>

          {/* Error Banner */}
          {error && <div className="alert alert-danger mb-4">{error}</div>}

          {/* Progress Chart Section */}
          <div className="skill-modal-chart-section">
            <SkillProgressChart
              history={historyData}
              topicName={topicName}
              isLoading={loading}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
            />
          </div>

          {/* Historical Snapshots Table */}
          {historyData.length > 0 && (
            <div className="skill-modal-history-table-section">
              <div className="history-table-header-row">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  <h3 className="history-section-title">Timeline Snapshots</h3>
                </div>
                <span className="history-count-tag">{historyData.length} records</span>
              </div>

              <div className="skill-history-table-wrap">
                <table className="skill-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {isOwnProfile && <th>Score</th>}
                      <th>Level</th>
                      <th>Confidence</th>
                      <th>Status</th>
                      <th>Solved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.map((h, idx) => (
                      <tr key={h.id || idx}>
                        <td className="font-mono text-xs text-slate-400">{formatDate(h.recordedAt)}</td>
                        {isOwnProfile && (
                          <td className="font-semibold text-cyan-400">
                            {Number(h.score ?? 0).toFixed(1)}
                          </td>
                        )}
                        <td>
                          <span className="skill-level-pill-small">{h.level || level}</span>
                        </td>
                        <td className="text-slate-300">{Number(h.confidence ?? 0).toFixed(1)}%</td>
                        <td>
                          <span className={`status-pill status-${(h.classification || 'UNASSESSED').toLowerCase().replace('_', '-')}`}>
                            {h.classification || 'UNASSESSED'}
                          </span>
                        </td>
                        <td className="text-slate-300">{h.solvedCount ?? skill.solvedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="skill-modal-footer">
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
