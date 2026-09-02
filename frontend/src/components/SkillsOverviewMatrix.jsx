import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  Target,
  Sparkles,
  Anchor,
  Search,
  Layers,
  RotateCcw,
  AlertCircle,
  HelpCircle,
  TrendingUp,
} from 'lucide-react';
import SkillCard from './SkillCard';
import SkillDetailModal from './SkillDetailModal';

/**
 * SkillsOverviewMatrix Component (Phase 5.7.6)
 * 
 * Complete skill overview and mastery matrix for the Coder Profile experience.
 * Displays KPI metrics, category & classification filters, search, and detail modal.
 */
export default function SkillsOverviewMatrix({
  token,
  targetUsername = null,
  isOwnProfile = true,
  preloadedSkills = null,
}) {
  const [skills, setSkills] = useState(preloadedSkills || []);
  const [summary, setSummary] = useState(null);
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [loading, setLoading] = useState(!preloadedSkills);
  const [error, setError] = useState(null);

  const [activeFilter, setActiveFilter] = useState('ALL'); // 'ALL' | 'STRENGTH' | 'NEEDS_PRACTICE' | 'DEVELOPING' | 'STABLE'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = isOwnProfile
        ? '/api/skills/my'
        : `/api/skills/user/${encodeURIComponent(targetUsername)}`;

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(endpoint, { headers });
      const data = await res.json();

      if (res.ok && data.success) {
        setSkills(data.skills || []);
        setSummary(data.summary || null);
        setClassificationSummary(data.classificationSummary || null);
      } else {
        setError(data.message || 'Failed to load skill matrix');
      }
    } catch (err) {
      setError(err.message || 'Network error fetching skills');
    } finally {
      setLoading(false);
    }
  }, [isOwnProfile, targetUsername, token]);

  useEffect(() => {
    if (!preloadedSkills) {
      fetchSkills();
    }
  }, [fetchSkills, preloadedSkills]);

  // Derived counts from backend payload
  const counts = useMemo(() => {
    const strengths = classificationSummary?.strengthsCount ?? summary?.strengthsCount ?? skills.filter((s) => s.classification === 'STRENGTH').length;
    const needsPractice = classificationSummary?.needsPracticeCount ?? summary?.needsPracticeCount ?? skills.filter((s) => s.classification === 'NEEDS_PRACTICE').length;
    const developing = classificationSummary?.developingCount ?? summary?.developingCount ?? skills.filter((s) => s.classification === 'DEVELOPING').length;
    const stable = classificationSummary?.stableCount ?? summary?.stableCount ?? skills.filter((s) => s.classification === 'STABLE').length;
    const unassessed = classificationSummary?.unassessedCount ?? summary?.unassessedCount ?? skills.filter((s) => s.classification === 'UNASSESSED').length;

    return {
      all: skills.length,
      strengths,
      needsPractice,
      developing,
      stable,
      unassessed,
    };
  }, [classificationSummary, summary, skills]);

  // Filter skills based on tab and search query
  const filteredSkills = useMemo(() => {
    return skills.filter((sk) => {
      // Classification filter
      if (activeFilter !== 'ALL') {
        const cls = (sk.classification || 'UNASSESSED').toUpperCase();
        if (cls !== activeFilter) {
          return false;
        }
      }

      // Search filter
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase().trim();
        const name = (sk.topicName || sk.name || sk.topicKey || '').toLowerCase();
        const cat = (sk.category || sk.topicCategory || '').toLowerCase();
        return name.includes(query) || cat.includes(query);
      }

      return true;
    });
  }, [skills, activeFilter, searchQuery]);

  return (
    <div className="skills-overview-container">
      {/* 1. KPI Summary Bar */}
      <div className="skills-kpi-grid">
        <div className="skill-kpi-card kpi-strengths">
          <div className="kpi-icon-wrap">
            <ShieldCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <span className="kpi-value text-emerald-400">{counts.strengths}</span>
            <span className="kpi-label">Strengths</span>
          </div>
        </div>

        <div className="skill-kpi-card kpi-needs-practice">
          <div className="kpi-icon-wrap">
            <Target className="w-5 h-5 text-rose-400" aria-hidden="true" />
          </div>
          <div>
            <span className="kpi-value text-rose-400">{counts.needsPractice}</span>
            <span className="kpi-label">Needs Practice</span>
          </div>
        </div>

        <div className="skill-kpi-card kpi-developing">
          <div className="kpi-icon-wrap">
            <Sparkles className="w-5 h-5 text-indigo-400" aria-hidden="true" />
          </div>
          <div>
            <span className="kpi-value text-indigo-400">{counts.developing}</span>
            <span className="kpi-label">Developing</span>
          </div>
        </div>

        <div className="skill-kpi-card kpi-stable">
          <div className="kpi-icon-wrap">
            <Anchor className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          </div>
          <div>
            <span className="kpi-value text-cyan-400">{counts.stable}</span>
            <span className="kpi-label">Stable</span>
          </div>
        </div>

        <div className="skill-kpi-card kpi-total">
          <div className="kpi-icon-wrap">
            <Layers className="w-5 h-5 text-slate-300" aria-hidden="true" />
          </div>
          <div>
            <span className="kpi-value text-slate-100">{counts.all}</span>
            <span className="kpi-label">Tracked Topics</span>
          </div>
        </div>
      </div>

      {/* 2. Filter Tabs & Search Bar */}
      <div className="skills-toolbar-row">
        {/* Classification Filter Tabs */}
        <div className="skills-filter-tabs" role="tablist" aria-label="Filter skills by classification">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'ALL'}
            className={`skills-filter-tab ${activeFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setActiveFilter('ALL')}
          >
            <span>All Topics</span>
            <span className="tab-count-pill">{counts.all}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'STRENGTH'}
            className={`skills-filter-tab tab-strengths ${activeFilter === 'STRENGTH' ? 'active' : ''}`}
            onClick={() => setActiveFilter('STRENGTH')}
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Strengths</span>
            <span className="tab-count-pill">{counts.strengths}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'NEEDS_PRACTICE'}
            className={`skills-filter-tab tab-needs-practice ${activeFilter === 'NEEDS_PRACTICE' ? 'active' : ''}`}
            onClick={() => setActiveFilter('NEEDS_PRACTICE')}
          >
            <Target className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Needs Practice</span>
            <span className="tab-count-pill">{counts.needsPractice}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'DEVELOPING'}
            className={`skills-filter-tab tab-developing ${activeFilter === 'DEVELOPING' ? 'active' : ''}`}
            onClick={() => setActiveFilter('DEVELOPING')}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Developing</span>
            <span className="tab-count-pill">{counts.developing}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === 'STABLE'}
            className={`skills-filter-tab tab-stable ${activeFilter === 'STABLE' ? 'active' : ''}`}
            onClick={() => setActiveFilter('STABLE')}
          >
            <Anchor className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Stable</span>
            <span className="tab-count-pill">{counts.stable}</span>
          </button>
        </div>

        {/* Search Filter Input */}
        <div className="skills-search-wrap">
          <Search className="w-4 h-4 skills-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="skills-search-input"
            placeholder="Search topic or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search algorithmic topics"
          />
          {searchQuery && (
            <button
              type="button"
              className="skills-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* 3. Error Banner */}
      {error && (
        <div className="alert alert-danger flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={fetchSkills}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Retry
          </button>
        </div>
      )}

      {/* 4. Loading Skeleton State */}
      {loading && (
        <div className="skills-grid">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="skill-card skill-skeleton-card">
              <div className="skeleton-line w-1/2 mb-3" />
              <div className="skeleton-line w-3/4 mb-4" />
              <div className="skeleton-box h-8 mb-3" />
              <div className="skeleton-line w-full" />
            </div>
          ))}
        </div>
      )}

      {/* 5. Main Skills Grid */}
      {!loading && filteredSkills.length > 0 && (
        <div className="skills-grid">
          {filteredSkills.map((sk) => (
            <SkillCard
              key={sk.topicId || sk.id || sk.topicKey}
              skill={sk}
              isOwnProfile={isOwnProfile}
              onSelect={setSelectedSkill}
            />
          ))}
        </div>
      )}

      {/* 6. Empty State */}
      {!loading && filteredSkills.length === 0 && (
        <div className="skills-empty-state">
          <HelpCircle className="w-10 h-10 text-cyan-400 opacity-60 mb-3" aria-hidden="true" />
          <h3 className="empty-state-title">
            {searchQuery ? 'No matching topics found' : 'No Skill Data Yet'}
          </h3>
          <p className="empty-state-sub">
            {searchQuery
              ? `No algorithmic topics matched "${searchQuery}". Try a different search term or reset the category filter.`
              : 'Solve problems and participate in contests to automatically calibrate and track your algorithmic topic mastery.'}
          </p>
          {searchQuery && (
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('ALL');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* 7. Skill Detail Modal */}
      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          token={token}
          targetUsername={targetUsername}
          isOwnProfile={isOwnProfile}
          onClose={() => setSelectedSkill(null)}
        />
      )}
    </div>
  );
}
