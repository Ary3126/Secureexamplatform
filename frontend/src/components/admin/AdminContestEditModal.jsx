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
  Edit3,
  Info,
} from 'lucide-react';

/**
 * Format a Date object to 'YYYY-MM-DDTHH:mm' for datetime-local input
 */
function toDateTimeLocalString(date) {
  if (!date || isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

/**
 * States where lifecycle fields (startTime, endTime, status) are immutable.
 * Mirrors contestService.js isLifecycleMutationLocked:
 *   running | ended | archived -> locked
 */
const LIFECYCLE_LOCKED_STATES = new Set(['running', 'ended', 'archived']);

/**
 * AdminContestEditModal - Phase 7.5.4
 *
 * Edit an existing contest's metadata. Respects lifecycle mutation locks:
 * - title, description, isRated, leaderboardFreeze -> always editable
 * - startTime, endTime -> locked when runtimeState is running | ended | archived
 *
 * Props:
 *   isOpen       {boolean}
 *   onClose      {function}
 *   onUpdate     {async function(contestId, payload) => { success, error }}
 *   isSubmitting {boolean}
 *   contest      {Object} - the contest row (includes runtimeState from backend)
 *   currentUser  {Object|null}
 */
export default function AdminContestEditModal({
  isOpen,
  onClose,
  onUpdate,
  isSubmitting = false,
  contest = null,
  currentUser = null,
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startTime: '',
    endTime: '',
    isRated: true,
    leaderboardFreezeEnabled: false,
    leaderboardFreezeMinutes: 60,
  });
  const [formErrors, setFormErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  // Derive lifecycle lock from contest's runtimeState
  const isLifecycleLocked = LIFECYCLE_LOCKED_STATES.has(contest?.runtimeState);

  // Populate form when modal opens or contest changes
  useEffect(() => {
    if (isOpen && contest) {
      setFormData({
        title: contest.title || '',
        description: contest.description || '',
        startTime: contest.startTime
          ? toDateTimeLocalString(new Date(contest.startTime))
          : '',
        endTime: contest.endTime
          ? toDateTimeLocalString(new Date(contest.endTime))
          : '',
        isRated: Boolean(contest.isRated),
        leaderboardFreezeEnabled: Boolean(contest.leaderboardFreezeEnabled),
        leaderboardFreezeMinutes:
          contest.leaderboardFreezeMinutes != null
            ? contest.leaderboardFreezeMinutes
            : 60,
      });
      setFormErrors({});
      setServerError(null);
    }
  }, [isOpen, contest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC key to dismiss
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !contest) return null;

  const durationInfo = getDurationText(formData.startTime, formData.endTime);

  // Duration presets (only if timing is not locked)
  const applyDurationPreset = (hours) => {
    if (!formData.startTime || isLifecycleLocked) return;
    const start = new Date(formData.startTime);
    if (isNaN(start.getTime())) return;
    const newEnd = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setFormData((prev) => ({ ...prev, endTime: toDateTimeLocalString(newEnd) }));
    setFormErrors((prev) => ({ ...prev, startTime: null, endTime: null, freeze: null }));
  };

  // Detect unsaved changes for discard confirmation
  const hasChanges = () => {
    if (!contest) return false;
    const origStart = contest.startTime
      ? toDateTimeLocalString(new Date(contest.startTime))
      : '';
    const origEnd = contest.endTime
      ? toDateTimeLocalString(new Date(contest.endTime))
      : '';
    return (
      formData.title.trim() !== (contest.title || '').trim() ||
      formData.description.trim() !== (contest.description || '').trim() ||
      (!isLifecycleLocked && formData.startTime !== origStart) ||
      (!isLifecycleLocked && formData.endTime !== origEnd) ||
      formData.isRated !== Boolean(contest.isRated) ||
      formData.leaderboardFreezeEnabled !== Boolean(contest.leaderboardFreezeEnabled) ||
      parseInt(formData.leaderboardFreezeMinutes, 10) !==
        (contest.leaderboardFreezeMinutes ?? 60)
    );
  };

  // Client-side validation (mirrors backend validateUpdateContest)
  const validate = () => {
    const errors = {};

    const trimmedTitle = (formData.title || '').trim();
    if (!trimmedTitle) {
      errors.title = 'Contest title is required.';
    } else if (trimmedTitle.length < 3) {
      errors.title = 'Title must be at least 3 characters.';
    } else if (trimmedTitle.length > 200) {
      errors.title = 'Title cannot exceed 200 characters.';
    }

    if (!isLifecycleLocked) {
      if (!formData.startTime) errors.startTime = 'Start time is required.';
      if (!formData.endTime) errors.endTime = 'End time is required.';
      if (formData.startTime && formData.endTime) {
        const start = new Date(formData.startTime).getTime();
        const end = new Date(formData.endTime).getTime();
        if (isNaN(start)) errors.startTime = 'Invalid start date/time.';
        if (isNaN(end)) errors.endTime = 'Invalid end date/time.';
        if (!isNaN(start) && !isNaN(end)) {
          if (end <= start) {
            errors.endTime = 'End time must be strictly later than start time.';
          } else if (end - start < 60000) {
            errors.endTime = 'Contest duration must be at least 1 minute.';
          }
        }
      }
    }

    if (formData.leaderboardFreezeEnabled) {
      const freeze = parseInt(formData.leaderboardFreezeMinutes, 10);
      if (isNaN(freeze) || freeze < 0) {
        errors.freeze = 'Freeze window must be a non-negative number of minutes.';
      } else if (
        durationInfo &&
        durationInfo.totalMinutes &&
        freeze > durationInfo.totalMinutes
      ) {
        errors.freeze = `Freeze window (${freeze}m) cannot exceed total contest duration (${durationInfo.totalMinutes}m).`;
      }
    }

    if (formData.description && formData.description.length > 10000) {
      errors.description = 'Description cannot exceed 10,000 characters.';
    }

    return errors;
  };

  // Form submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    // Build payload - only include timing fields when not lifecycle-locked
    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim() || undefined,
      isRated: Boolean(formData.isRated),
      leaderboardFreezeEnabled: Boolean(formData.leaderboardFreezeEnabled),
      leaderboardFreezeMinutes: formData.leaderboardFreezeEnabled
        ? parseInt(formData.leaderboardFreezeMinutes, 10) || 60
        : undefined,
    };

    if (!isLifecycleLocked) {
      payload.startTime = new Date(formData.startTime).toISOString();
      payload.endTime = new Date(formData.endTime).toISOString();
    }

    try {
      const result = await onUpdate(contest.id, payload);
      if (result && result.error) {
        setServerError(result.error);
      }
      // On success the parent handler closes the modal
    } catch (err) {
      setServerError(
        err.message || 'An unexpected error occurred while saving changes.'
      );
    }
  };

  // Cancel with dirty-state guard
  const handleCancel = () => {
    if (isSubmitting) return;
    if (hasChanges()) {
      if (window.confirm('You have unsaved changes. Discard them?')) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const lockStateLabel =
    contest.runtimeState === 'running'
      ? 'Running'
      : contest.runtimeState === 'ended'
      ? 'Ended'
      : contest.runtimeState === 'archived'
      ? 'Archived'
      : null;

  return (
    <div className="contest-modal-backdrop" onClick={handleCancel}>
      <div
        className="contest-create-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contest-dialog-title"
      >
        {/* Modal Header */}
        <div className="contest-create-header">
          <div className="create-header-title-wrap">
            <div
              className="create-badge-draft"
              style={{
                background: isLifecycleLocked
                  ? 'rgba(251, 191, 36, 0.15)'
                  : 'rgba(56, 189, 248, 0.12)',
                border: isLifecycleLocked
                  ? '1px solid rgba(251, 191, 36, 0.3)'
                  : '1px solid rgba(56, 189, 248, 0.3)',
                color: isLifecycleLocked ? '#fbbf24' : '#38bdf8',
              }}
            >
              {isLifecycleLocked ? (
                <>
                  <Lock size={12} />
                  <span>Partial Edit &mdash; {lockStateLabel}</span>
                </>
              ) : (
                <>
                  <Edit3 size={12} />
                  <span>Edit Contest</span>
                </>
              )}
            </div>
            <h3 id="edit-contest-dialog-title">
              Edit: <span style={{ color: '#38bdf8' }}>{contest.title}</span>
            </h3>
            <p className="create-header-subtitle">
              {isLifecycleLocked
                ? `Title, description, rating policy, and leaderboard freeze can be updated. Schedule is locked while ${lockStateLabel}.`
                : 'Update schedule, rating policy, leaderboard freeze, and metadata for this contest.'}
            </p>
          </div>
          <button
            className="create-modal-close-btn"
            onClick={handleCancel}
            disabled={isSubmitting}
            aria-label="Close edit modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Lifecycle Lock Notice */}
        {isLifecycleLocked && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: 'rgba(251, 191, 36, 0.08)',
              border: '1px solid rgba(251, 191, 36, 0.25)',
              borderRadius: '8px',
              padding: '10px 14px',
              margin: '0 20px',
              fontSize: '0.83rem',
              color: '#fbbf24',
            }}
          >
            <Lock size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
            <span>
              <strong>Timing Locked:</strong> This contest is currently{' '}
              <strong>{lockStateLabel}</strong>. Start time and end time cannot be
              modified. You may still update the title, description, rating policy,
              and leaderboard freeze settings.
            </span>
          </div>
        )}

        {/* Server Error Banner */}
        {serverError && (
          <div className="create-server-error-banner" role="alert">
            <AlertTriangle size={18} className="create-error-icon" />
            <div className="create-error-text">
              <strong>Update Failed:</strong> {serverError}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="contest-create-form" noValidate>
          <div className="contest-create-body">

            {/* Section A: Basic Metadata */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Edit3 size={16} className="section-icon" />
                <span className="section-label">A. Basic Information</span>
              </div>

              <div className="form-group">
                <label htmlFor="edit-contest-title-input" className="form-label required">
                  Contest Title
                </label>
                <input
                  id="edit-contest-title-input"
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
                    <span className="field-hint">
                      Clear, recognizable name (3&ndash;200 characters).
                    </span>
                  )}
                  <span className="char-counter">{formData.title.length}/200</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-contest-desc" className="form-label">
                  Description &amp; Guidelines
                </label>
                <textarea
                  id="edit-contest-desc"
                  className={`form-textarea ${formErrors.description ? 'input-error' : ''}`}
                  placeholder="Outline contest rules, topics covered, penalty policies, or participant instructions..."
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value });
                    if (formErrors.description)
                      setFormErrors({ ...formErrors, description: null });
                  }}
                  rows={3}
                  maxLength={10000}
                  disabled={isSubmitting}
                />
                <div className="field-footer">
                  {formErrors.description ? (
                    <span className="field-error-msg">{formErrors.description}</span>
                  ) : (
                    <span className="field-hint">
                      Markdown or plaintext summary displayed on the contest info page.
                    </span>
                  )}
                  <span className="char-counter">
                    {formData.description.length}/10000
                  </span>
                </div>
              </div>
            </div>

            {/* Section B: Schedule & Timing */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Calendar size={16} className="section-icon" />
                <span className="section-label">B. Schedule &amp; Timing</span>
                {durationInfo && !isLifecycleLocked && (
                  <span className="duration-preview-pill">
                    <Clock size={12} /> Duration: {durationInfo.text}
                  </span>
                )}
                {isLifecycleLocked && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'rgba(251, 191, 36, 0.12)',
                      border: '1px solid rgba(251, 191, 36, 0.3)',
                      color: '#fbbf24',
                      borderRadius: '20px',
                      padding: '2px 10px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                    }}
                  >
                    <Lock size={11} /> Locked
                  </span>
                )}
              </div>

              <div className="timing-inputs-grid">
                <div className="form-group">
                  <label htmlFor="edit-contest-start" className="form-label required">
                    Start Date &amp; Time (Local)
                  </label>
                  <input
                    id="edit-contest-start"
                    type="datetime-local"
                    className={`form-input ${formErrors.startTime ? 'input-error' : ''}`}
                    style={
                      isLifecycleLocked
                        ? { opacity: 0.55, cursor: 'not-allowed' }
                        : undefined
                    }
                    value={formData.startTime}
                    onChange={(e) => {
                      if (isLifecycleLocked) return;
                      setFormData({ ...formData, startTime: e.target.value });
                      if (formErrors.startTime)
                        setFormErrors({ ...formErrors, startTime: null });
                    }}
                    disabled={isSubmitting || isLifecycleLocked}
                    title={
                      isLifecycleLocked
                        ? `Timing is locked — contest is ${lockStateLabel}`
                        : undefined
                    }
                  />
                  {formErrors.startTime && (
                    <span className="field-error-msg">{formErrors.startTime}</span>
                  )}
                  {isLifecycleLocked && (
                    <span
                      className="field-hint"
                      style={{ color: '#64748b', fontSize: '0.75rem' }}
                    >
                      Read-only while {lockStateLabel}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="edit-contest-end" className="form-label required">
                    End Date &amp; Time (Local)
                  </label>
                  <input
                    id="edit-contest-end"
                    type="datetime-local"
                    className={`form-input ${formErrors.endTime ? 'input-error' : ''}`}
                    style={
                      isLifecycleLocked
                        ? { opacity: 0.55, cursor: 'not-allowed' }
                        : undefined
                    }
                    value={formData.endTime}
                    onChange={(e) => {
                      if (isLifecycleLocked) return;
                      setFormData({ ...formData, endTime: e.target.value });
                      if (formErrors.endTime)
                        setFormErrors({ ...formErrors, endTime: null });
                    }}
                    disabled={isSubmitting || isLifecycleLocked}
                    title={
                      isLifecycleLocked
                        ? `Timing is locked — contest is ${lockStateLabel}`
                        : undefined
                    }
                  />
                  {formErrors.endTime && (
                    <span className="field-error-msg">{formErrors.endTime}</span>
                  )}
                  {isLifecycleLocked && (
                    <span
                      className="field-hint"
                      style={{ color: '#64748b', fontSize: '0.75rem' }}
                    >
                      Read-only while {lockStateLabel}
                    </span>
                  )}
                </div>
              </div>

              {!isLifecycleLocked && (
                <div className="presets-bar">
                  <span className="presets-label">Quick Duration Presets:</span>
                  <div className="presets-buttons">
                    {[1, 2, 3, 5, 24].map((h) => (
                      <button
                        key={h}
                        type="button"
                        className="preset-chip"
                        onClick={() => applyDurationPreset(h)}
                        disabled={isSubmitting}
                      >
                        {h === 24 ? '24 Hours' : `${h} Hour${h > 1 ? 's' : ''}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Section C: Scoring & Leaderboard Freeze */}
            <div className="create-form-section">
              <div className="section-label-row">
                <Trophy size={16} className="section-icon" />
                <span className="section-label">
                  C. Scoring &amp; Leaderboard Freeze
                </span>
              </div>

              <div className="config-toggles-grid">
                {/* Rating Card */}
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
                        onChange={(e) =>
                          setFormData({ ...formData, isRated: e.target.checked })
                        }
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
                  {isLifecycleLocked &&
                    formData.isRated !== Boolean(contest.isRated) && (
                      <div
                        style={{
                          marginTop: '8px',
                          display: 'flex',
                          gap: '6px',
                          alignItems: 'flex-start',
                          background: 'rgba(251, 191, 36, 0.08)',
                          border: '1px solid rgba(251, 191, 36, 0.2)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '0.75rem',
                          color: '#fbbf24',
                        }}
                      >
                        <Info
                          size={12}
                          style={{ marginTop: '1px', flexShrink: 0 }}
                        />
                        Changing the rating policy after the contest has started may
                        affect rating calculations upon finalization.
                      </div>
                    )}
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
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            leaderboardFreezeEnabled: e.target.checked,
                          })
                        }
                        disabled={isSubmitting}
                      />
                      <span className="slider round" />
                    </label>
                  </div>
                  <p className="config-card-desc">
                    Masks live standings during the final stretch before the contest
                    concludes to prevent strategic stalling.
                  </p>

                  {formData.leaderboardFreezeEnabled && (
                    <div className="freeze-inputs-area">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label
                          htmlFor="edit-freeze-minutes"
                          className="form-label"
                          style={{ fontSize: '0.78rem' }}
                        >
                          Freeze Window (Minutes before contest end)
                        </label>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <input
                            id="edit-freeze-minutes"
                            type="number"
                            min="1"
                            max={durationInfo?.totalMinutes || 10080}
                            className={`form-input ${
                              formErrors.freeze ? 'input-error' : ''
                            }`}
                            style={{ width: '110px' }}
                            value={formData.leaderboardFreezeMinutes}
                            onChange={(e) => {
                              setFormData({
                                ...formData,
                                leaderboardFreezeMinutes: e.target.value,
                              });
                              if (formErrors.freeze)
                                setFormErrors({ ...formErrors, freeze: null });
                            }}
                            disabled={isSubmitting}
                          />
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            minutes
                          </span>
                        </div>
                        {formErrors.freeze && (
                          <span className="field-error-msg">{formErrors.freeze}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="draft-notice-banner" style={{ marginTop: '12px' }}>
                <Shield size={14} className="notice-icon" />
                <span>
                  <strong>Edit Policy:</strong> Title, description, rating policy, and
                  leaderboard freeze can always be updated.
                  {isLifecycleLocked
                    ? ` Schedule is locked while the contest is ${lockStateLabel}.`
                    : ' Schedule can be changed while the contest is draft or upcoming.'}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Controls */}
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
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
