import React, { useState } from 'react';
import { Calendar, Clock, X, AlertCircle, RotateCcw } from 'lucide-react';

/**
 * Schedule Publication Modal Component
 * Configures future release datetime with runtime safety notices.
 */
export default function SchedulePublishModal({
  isOpen,
  currentSchedule,
  onSchedule,
  onCancelSchedule,
  onClose,
  isProcessing = false,
}) {
  const [scheduledDateTime, setScheduledDateTime] = useState(
    currentSchedule ? new Date(currentSchedule).toISOString().slice(0, 16) : ''
  );

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!scheduledDateTime) return;
    onSchedule && onSchedule(new Date(scheduledDateTime).toISOString());
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '480px',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={20} color="#a78bfa" />
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
              Schedule Publication
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Info Box */}
        <div style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: '8px', padding: '12px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <AlertCircle size={16} color="#a78bfa" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span style={{ fontSize: '0.8rem', color: '#ddd6fe', lineHeight: '1.4' }}>
              Automatic release occurs at the scheduled timestamp. The platform will automatically re-verify peer review approval at execution time.
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
              Release Date & Time (Local Timezone)
            </label>
            <input
              type="datetime-local"
              value={scheduledDateTime}
              onChange={(e) => setScheduledDateTime(e.target.value)}
              disabled={isProcessing}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {currentSchedule && (
            <div style={{ marginBottom: '16px', fontSize: '0.8rem', color: '#94a3b8' }}>
              Currently scheduled for: <strong style={{ color: '#a78bfa' }}>{new Date(currentSchedule).toLocaleString()}</strong>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
            {currentSchedule ? (
              <button
                type="button"
                onClick={onCancelSchedule}
                disabled={isProcessing}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel Schedule
              </button>
            ) : (
              <div />
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#94a3b8',
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                }}
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isProcessing || !scheduledDateTime}
                style={{
                  background: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  cursor: isProcessing || !scheduledDateTime ? 'not-allowed' : 'pointer',
                  opacity: isProcessing || !scheduledDateTime ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isProcessing && <RotateCcw size={14} className="animate-spin" />}
                <span>{currentSchedule ? 'Update Schedule' : 'Save Schedule'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
