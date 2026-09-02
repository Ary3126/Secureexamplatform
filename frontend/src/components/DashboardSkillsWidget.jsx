import React, { useState, useEffect } from 'react';
import {
  Layers,
  ShieldCheck,
  Target,
  Sparkles,
  ArrowRight,
  Award,
  TrendingUp,
  HelpCircle,
} from 'lucide-react';

/**
 * DashboardSkillsWidget Component (Phase 5.7.6)
 * 
 * Compact, high-impact summary widget embedded into StudentDashboard.
 * Strictly presents backend-authoritative skills data, top strengths, and focus topics.
 */
export default function DashboardSkillsWidget({
  token,
  onNavigateProfile = null,
}) {
  const [skills, setSkills] = useState([]);
  const [summary, setSummary] = useState(null);
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchSkillsSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/skills/my', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (isMounted) {
          if (res.ok && data.success) {
            setSkills(data.skills || []);
            setSummary(data.summary || null);
            setClassificationSummary(data.classificationSummary || null);
          } else {
            setError(data.message || 'Failed to load skills summary');
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Network error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (token) {
      fetchSkillsSummary();
    }
    return () => {
      isMounted = false;
    };
  }, [token]);

  const strengthsList = classificationSummary?.strengths || skills.filter((s) => s.classification === 'STRENGTH');
  const needsPracticeList = classificationSummary?.needsPractice || skills.filter((s) => s.classification === 'NEEDS_PRACTICE');

  const strengthsCount = classificationSummary?.strengthsCount ?? summary?.strengthsCount ?? strengthsList.length;
  const needsPracticeCount = classificationSummary?.needsPracticeCount ?? summary?.needsPracticeCount ?? needsPracticeList.length;
  const developingCount = classificationSummary?.developingCount ?? summary?.developingCount ?? skills.filter((s) => s.classification === 'DEVELOPING').length;

  return (
    <section className="dash-card dashboard-skills-widget" aria-label="Skills & Mastery Overview">
      {/* Card Header */}
      <div className="card-header">
        <div className="card-header-left">
          <div className="section-icon-badge icon-skills">
            <Layers className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          </div>
          <h3 className="section-title">Skills & Mastery Overview</h3>
        </div>

        {onNavigateProfile && (
          <button
            type="button"
            className="card-header-link"
            onClick={onNavigateProfile}
            aria-label="View complete skill matrix in profile"
          >
            <span>Full Matrix</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Card Body */}
      <div className="card-body">
        {loading ? (
          <div className="dash-skills-skeleton">
            <div className="skeleton-line w-full mb-3" />
            <div className="skeleton-box h-12 mb-3" />
            <div className="skeleton-line w-2/3" />
          </div>
        ) : error ? (
          <div className="dash-skills-empty">
            <p className="text-xs text-rose-400">{error}</p>
          </div>
        ) : skills.length === 0 ? (
          <div className="empty-dash-box">
            <Layers className="w-6 h-6 text-muted" aria-hidden="true" />
            <p>No skill assessment data yet. Solve problems to build your algorithmic topic matrix.</p>
          </div>
        ) : (
          <div className="dash-skills-content">
            {/* KPI Counts Bar */}
            <div className="dash-skills-kpi-bar">
              <div className="dash-kpi-pill kpi-pill-strength">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{strengthsCount} Strengths</span>
              </div>

              <div className="dash-kpi-pill kpi-pill-needs-practice">
                <Target className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{needsPracticeCount} Needs Practice</span>
              </div>

              <div className="dash-kpi-pill kpi-pill-developing">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{developingCount} Developing</span>
              </div>
            </div>

            {/* Split Columns: Top Strengths & Focus Areas */}
            <div className="dash-skills-columns">
              {/* Column 1: Top Strengths */}
              <div className="dash-skill-col">
                <div className="dash-col-header text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Top Strengths</span>
                </div>
                {strengthsList.length === 0 ? (
                  <p className="dash-col-empty">Keep solving to establish confirmed strengths.</p>
                ) : (
                  <div className="dash-skill-chip-list">
                    {strengthsList.slice(0, 3).map((sk) => (
                      <div key={sk.topicKey || sk.topicId} className="dash-skill-chip strength-chip">
                        <span className="chip-name">{sk.topicName || sk.topicKey}</span>
                        {sk.score !== undefined && (
                          <span className="chip-score">{Number(sk.score).toFixed(0)} pts</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Column 2: Priority Needs Practice */}
              <div className="dash-skill-col">
                <div className="dash-col-header text-rose-400">
                  <Target className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Priority Focus</span>
                </div>
                {needsPracticeList.length === 0 ? (
                  <p className="dash-col-empty">No critical weak spots detected. Great work!</p>
                ) : (
                  <div className="dash-skill-chip-list">
                    {needsPracticeList.slice(0, 3).map((sk) => (
                      <div key={sk.topicKey || sk.topicId} className="dash-skill-chip needs-practice-chip">
                        <span className="chip-name">{sk.topicName || sk.topicKey}</span>
                        {sk.score !== undefined && (
                          <span className="chip-score">{Number(sk.score).toFixed(0)} pts</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
