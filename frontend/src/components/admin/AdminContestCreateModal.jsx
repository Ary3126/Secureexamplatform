import React, { useState, useEffect } from 'react';
import {
  X,
  Trophy,
  Calendar,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Globe,
  Sparkles,
  HelpCircle,
} from 'lucide-react';

/**
 * Format Date object to 'YYYY-MM-DDTHH:mm' for datetime-local input
 */
function toDateTimeLocalString(date) {
  if (!date || isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Compute friendly duration text between two datetime-local strings
 */
function getDurationText(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return null;

  const totalMins = Math.round((end - start) / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const minutes = totalMins % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return { text: parts.join(' '), totalMinutes: totalMins };
}

export default function AdminContestCreateModal({
  isOpen,
  onClose,
  onCreate,
  isSubmitting = false,
  currentUser = null,
}) {
  // Default start: Next whole hour; Default end: 2 hours later
  const getDefaultDates = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return {
      startTime: toDateTimeLocalString(start),
      endTime: toDateTimeLocalString(end),
    };
  };

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    accessScope: 'public',
    isRated: true,
    leaderboardFreezeEnabled: false,
    leaderboardFreezeMinutes: 60,
  });

  const [formErrors, setFormErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  // Initialize or reset form state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const defaults = getDefaultDates();
      setFormData({
        title: '',
        description: '',
        startTime: defaults.startTime,
        endTime: defaults.endTime,
        accessScope: 'public',
        isRated: true,
        leaderboardFreezeEnabled: false,
        leaderboardFreezeMinutes: 60,
      });
      setFormErrors({});
      setServerError(null);
    }
  }, [isOpen]);

  // Handle ESC key to dismiss
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, formData]);

  if (!isOpen) return null;

  const durationInfo = getDurationText(formData.startTime, formData.endTime);

  const applyDurationPreset = (hours) => {
    if (!formData.startTime) return;
    const start = new Date(formData.startTime);
    if (isNaN(start.getTime())) return;
    const newEnd = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setFormData((prev) => ({
      ...prev,
      endTime: toDateTimeLocalString(newEnd),
    }));
    // Clear timing errors if valid
    setFormErrors((prev) => ({ ...prev, startTime: null, endTime: null, freeze: null }));
  };

  const validate = () => {
    const errors = {};

    // 1. Title validation
    const trimmedTitle = (formData.title || '').trim();
    if (!trimmedTitle) {
      errors.title = 'Contest title is required.';
    } else if (trimmedTitle.length < 3) {
      errors.title = 'Title must be at least 3 characters.';
    } else if (trimmedTitle.length > 200) {
      errors.title = 'Title cannot exceed 200 characters.';
    }

    // 2. Timing validation
    if (!formData.startTime) {
      errors.startTime = 'Start time is required.';
    }
    if (!formData.endTime) {
      errors.endTime = 'End time is required.';
    }

    if (formData.startTime && formData.endTime) {
      const start = new Date(formData.startTime).getTime();
      const end = new Date(formData.endTime).getTime();
      if (isNaN(start)) {
        errors.startTime = 'Invalid start date/time.';
      }
      if (isNaN(end)) {
        errors.endTime = 'Invalid end date/time.';
      }
      if (!isNaN(start) && !isNaN(end)) {
        if (end <= start) {
          errors.endTime = 'End time must be strictly later than start time.';
        } else if ((end - start) < 60000) {
          errors.endTime = 'Contest duration must be at least 1 minute.';
        }
      }
    }

    // 3. Freeze validation
    if (formData.leaderboardFreezeEnabled) {
      const freeze = parseInt(formData.leaderboardFreezeMinutes, 10);
      if (isNaN(freeze) || freeze < 0) {
        errors.freeze = 'Freeze window must be a non-negative number of minutes.';
      } else if (durationInfo && durationInfo.totalMinutes && freeze > durationInfo.totalMinutes) {
        errors.freeze = `Freeze window (${freeze}m) cannot exceed total contest duration (${durationInfo.totalMinutes}m).`;
      }
    }

    // 4. Description limit
    if (formData.description && formData.description.length > 10000) {
      errors.description = 'Description cannot exceed 10,000 characters.';
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});

    // Convert local datetime to UTC ISO string
    const startUtc = new Date(formData.startTime).toISOString();
    const endUtc = new Date(formData.endTime).toISOString();

    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim() || undefined,
      startTime: startUtc,
      endTime: endUtc,
      accessScope: formData.accessScope,
      isRated: Boolean(formData.isRated),
      leaderboardFreezeEnabled: Boolean(formData.leaderboardFreezeEnabled),
      leaderboardFreezeMinutes: formData.leaderboardFreezeEnabled
        ? (!isNaN(parseInt(formData.leaderboardFreezeMinutes, 10))
            ? Math.max(0, parseInt(formData.leaderboardFreezeMinutes, 10))
            : 60)
        : 60,
    };

    try {
      const result = await onCreate(payload);
      if (result && result.error) {
        setServerError(result.error);
      }
    } catch (err) {
      setServerError(err.message || 'An unexpected error occurred while creating contest.');
    }
  };

  const handleCancel = () => {
    if (isSubmitting) return;
    const hasData = Boolean(formData.title.trim() || formData.description.trim());
    if (hasData) {
      if (window.confirm('You have unsaved changes. Discard contest creation?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <div className="contest-modal-backdrop" onClick={handleCancel}>
      <div
        className="contest-create-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contest-title"
      >
        {/* Modal Header */}
        <div className="contest-create-header">
          <div className="create-header-title-wrap">
            <div className="create-badge-draft">
              <Lock size={12} />
              <span>Draft Mode</span>
            </div>
            <h3 id="create-contest-title">Create New Contest</h3>
            <p className="create-header-subtitle">
              Configure contest schedule, access scope, rating policy, and leaderboard freeze rules.
            </p>
          </div>
          <button
            className="create-modal-close-btn"
            onClick={handleCancel}
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Server Error Banner */}
        {serverError && (
          <div className="create-server-error-banner" role="alert">
            <AlertTriangle size={18} className="create-error-icon" />
            <div className="create-error-text">
              <strong>Creation Failed:</strong> {serverError}
            </div>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="contest-create-form" noValidate>
          <div className="contest-create-body">
            {/* Section A: Basic Metadata */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Sparkles size={16} className="section-icon" />
                <span className="section-label">A. Basic Information</span>
              </div>

              {/* Title Field */}
              <div className="form-group">
                <label htmlFor="contest-title" className="form-label required">
                  Contest Title
                </label>
                <input
                  id="contest-title"
                  type="text"
                  className={`form-input ${formErrors.title ? 'input-error' : ''}`}
                  placeholder="e.g. ACM-ICPC Campus Qualifier 2026 #1"
                  value={formData.title}
                  onChange={(e) => {
                    setFormData({ ...formData, title: e.target.value });
                    if (formErrors.title) setFormErrors({ ...formErrors, title: null });
                  }}
                  maxLength={200}
                  disabled={isSubmitting}
                  autoFocus
                />
                <div className="field-footer">
                  {formErrors.title ? (
                    <span className="field-error-msg">{formErrors.title}</span>
                  ) : (
                    <span className="field-hint">Give this contest a clear, recognizable name (3–200 characters).</span>
                  )}
                  <span className="char-counter">{formData.title.length}/200</span>
                </div>
              </div>

              {/* Description Field */}
              <div className="form-group">
                <label htmlFor="contest-desc" className="form-label">
                  Description & Guidelines
                </label>
                <textarea
                  id="contest-desc"
                  className={`form-textarea ${formErrors.description ? 'input-error' : ''}`}
                  placeholder="Outline contest rules, topics covered, penalty policies, or participant instructions..."
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value });
                    if (formErrors.description) setFormErrors({ ...formErrors, description: null });
                  }}
                  rows={3}
                  maxLength={10000}
                  disabled={isSubmitting}
                />
                <div className="field-footer">
                  {formErrors.description ? (
                    <span className="field-error-msg">{formErrors.description}</span>
                  ) : (
                    <span className="field-hint">Markdown or plaintext summary displayed on contest info page.</span>
                  )}
                  <span className="char-counter">{formData.description.length}/10000</span>
                </div>
              </div>
            </div>

            {/* Section B: Schedule & Timing */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Calendar size={16} className="section-icon" />
                <span className="section-label">B. Schedule & Timing</span>
                {durationInfo && (
                  <span className="duration-preview-pill">
                    <Clock size={12} /> Duration: {durationInfo.text}
                  </span>
                )}
              </div>

              <div className="timing-inputs-grid">
                {/* Start Time */}
                <div className="form-group">
                  <label htmlFor="contest-start" className="form-label required">
                    Start Date & Time (Local)
                  </label>
                  <input
                    id="contest-start"
                    type="datetime-local"
                    className={`form-input ${formErrors.startTime ? 'input-error' : ''}`}
                    value={formData.startTime}
                    onChange={(e) => {
                      setFormData({ ...formData, startTime: e.target.value });
                      if (formErrors.startTime) setFormErrors({ ...formErrors, startTime: null });
                    }}
                    disabled={isSubmitting}
                  />
                  {formErrors.startTime && (
                    <span className="field-error-msg">{formErrors.startTime}</span>
                  )}
                </div>

                {/* End Time */}
                <div className="form-group">
                  <label htmlFor="contest-end" className="form-label required">
                    End Date & Time (Local)
                  </label>
                  <input
                    id="contest-end"
                    type="datetime-local"
                    className={`form-input ${formErrors.endTime ? 'input-error' : ''}`}
                    value={formData.endTime}
                    onChange={(e) => {
                      setFormData({ ...formData, endTime: e.target.value });
                      if (formErrors.endTime) setFormErrors({ ...formErrors, endTime: null });
                    }}
                    disabled={isSubmitting}
                  />
                  {formErrors.endTime && (
                    <span className="field-error-msg">{formErrors.endTime}</span>
                  )}
                </div>
              </div>

              {/* Quick Duration Presets */}
              <div className="presets-bar">
                <span className="presets-label">Quick Duration Presets:</span>
                <div className="presets-buttons">
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => applyDurationPreset(1)}
                    disabled={isSubmitting}
                  >
                    1 Hour
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => applyDurationPreset(2)}
                    disabled={isSubmitting}
                  >
                    2 Hours
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => applyDurationPreset(3)}
                    disabled={isSubmitting}
                  >
                    3 Hours
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => applyDurationPreset(5)}
                    disabled={isSubmitting}
                  >
                    5 Hours
                  </button>
                  <button
                    type="button"
                    className="preset-chip"
                    onClick={() => applyDurationPreset(24)}
                    disabled={isSubmitting}
                  >
                    24 Hours
                  </button>
                </div>
              </div>
            </div>

            {/* Section C: Access Scope & Lifecycle Status */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Globe size={16} className="section-icon" />
                <span className="section-label">C. Access Scope & Visibility</span>
              </div>

              <div className="access-scope-selector-grid">
                <label className={`access-option-card ${formData.accessScope === 'public' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="accessScope"
                    value="public"
                    checked={formData.accessScope === 'public'}
                    onChange={() => setFormData({ ...formData, accessScope: 'public' })}
                    disabled={isSubmitting}
                  />
                  <div className="option-content">
                    <div className="option-title">
                      <Globe size={14} /> Public Contest
                    </div>
                    <div className="option-desc">
                      Available to all enrolled students and users across the platform upon publication.
                    </div>
                  </div>
                </label>

                <label className={`access-option-card ${formData.accessScope === 'private' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="accessScope"
                    value="private"
                    checked={formData.accessScope === 'private'}
                    onChange={() => setFormData({ ...formData, accessScope: 'private' })}
                    disabled={isSubmitting}
                  />
                  <div className="option-content">
                    <div className="option-title">
                      <Lock size={14} /> Private / Examination
                    </div>
                    <div className="option-desc">
                      Restricted to invited participants or specific enrolled course sections.
                    </div>
                  </div>
                </label>
              </div>

              {/* Informative notice on draft lifecycle */}
              <div className="draft-notice-banner">
                <Shield size={14} className="notice-icon" />
                <span>
                  <strong>Draft Status Policy:</strong> This contest will be created in <code>draft</code> status.
                  Problems must be attached in Phase 7.5.5 before it can be published in Phase 7.5.6.
                </span>
              </div>
            </div>

            {/* Section D & E: Scoring, Rating & Leaderboard Freeze */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Trophy size={16} className="section-icon" />
                <span className="section-label">D. Scoring & Leaderboard Freeze</span>
              </div>

              <div className="config-toggles-grid">
                {/* Rating Setting Card */}
                <div className="config-card">
                  <div className="config-card-header">
                    <div className="config-card-title">
                      <Trophy size={16} style={{ color: '#fbbf24' }} />
                      <span>Competitive Elo Rating</span>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={formData.isRated}
                        onChange={(e) => setFormData({ ...formData, isRated: e.target.checked })}
                        disabled={isSubmitting}
                      />
                      <span className="slider round" />
                    </label>
                  </div>
                  <p className="config-card-desc">
                    {formData.isRated
                      ? 'Rated: Submissions and placements will adjust competitive Elo ratings upon contest finalization.'
                      : 'Unrated: Practice or mock examination. Placements are recorded without altering student ratings.'}
                  </p>
                </div>

                {/* Leaderboard Freeze Card */}
                <div className="config-card">
                  <div className="config-card-header">
                    <div className="config-card-title">
                      <Clock size={16} style={{ color: '#38bdf8' }} />
                      <span>Leaderboard Freeze</span>
                    </div>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={formData.leaderboardFreezeEnabled}
                        onChange={(e) => setFormData({ ...formData, leaderboardFreezeEnabled: e.target.checked })}
                        disabled={isSubmitting}
                      />
                      <span className="slider round" />
                    </label>
                  </div>
                  <p className="config-card-desc">
                    Masks live standings during the final stretch before the contest concludes to prevent strategic stalling.
                  </p>

                  {formData.leaderboardFreezeEnabled && (
                    <div className="freeze-inputs-area">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="freeze-minutes" className="form-label" style={{ fontSize: '0.78rem' }}>
                          Freeze Window (Minutes before contest end)
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            id="freeze-minutes"
                            type="number"
                            min="1"
                            max={durationInfo?.totalMinutes || 10080}
                            className={`form-input ${formErrors.freeze ? 'input-error' : ''}`}
                            style={{ width: '110px' }}
                            value={formData.leaderboardFreezeMinutes}
                            onChange={(e) => {
                              setFormData({ ...formData, leaderboardFreezeMinutes: e.target.value });
                              if (formErrors.freeze) setFormErrors({ ...formErrors, freeze: null });
                            }}
                            disabled={isSubmitting}
                          />
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>minutes</span>
                        </div>
                        {formErrors.freeze && (
                          <span className="field-error-msg">{formErrors.freeze}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer Controls */}
          <div className="contest-create-footer">
            <button
              type="button"
              className="btn-cancel"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-submit-create"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="btn-spinner" />
                  <span>Creating Contest...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Create Contest (Draft)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
