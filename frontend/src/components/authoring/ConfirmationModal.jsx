import React from 'react';
import { AlertTriangle, X, Check, RotateCcw } from 'lucide-react';

/**
 * Reusable & Accessible Confirmation Modal for Dangerous Actions
 * Requires explicit user confirmation and clearly explains the operational consequence.
 */
export default function ConfirmationModal({
  isOpen,
  title,
  message,
  consequenceText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary', // 'primary' | 'danger' | 'warning' | 'success'
  isProcessing = false,
  requireInput = false,
  inputLabel = 'Comment / Justification',
  inputPlaceholder = 'Enter required feedback...',
  inputValue = '',
  onInputChange,
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: { bg: '#e11d48', hover: '#be123c', color: '#ffffff' },
    warning: { bg: '#f59e0b', hover: '#d97706', color: '#0f172a' },
    success: { bg: '#16a34a', hover: '#15803d', color: '#ffffff' },
    primary: { bg: '#0284c7', hover: '#0369a1', color: '#ffffff' },
  };

  const v = variantStyles[confirmVariant] || variantStyles.primary;

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
        if (e.target === e.currentTarget && !isProcessing) onCancel();
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '520px',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${v.bg}22`,
                color: v.bg,
                border: `1px solid ${v.bg}44`,
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc', fontWeight: '700' }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Message Body */}
        <div style={{ marginBottom: '18px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#cbd5e1', lineHeight: '1.5' }}>
            {message}
          </p>

          {consequenceText && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '0.82rem',
                color: '#fca5a5',
                lineHeight: '1.4',
              }}
            >
              <strong>Operational Consequence:</strong> {consequenceText}
            </div>
          )}
        </div>

        {/* Required Input (for Feedback/Justifications) */}
        {requireInput && (
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
              {inputLabel} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              rows={3}
              value={inputValue}
              onChange={(e) => onInputChange && onInputChange(e.target.value)}
              placeholder={inputPlaceholder}
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '0.85rem',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onCancel}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#94a3b8',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing || (requireInput && !inputValue.trim())}
            style={{
              background: v.bg,
              color: v.color,
              border: 'none',
              padding: '8px 20px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: isProcessing || (requireInput && !inputValue.trim()) ? 'not-allowed' : 'pointer',
              opacity: isProcessing || (requireInput && !inputValue.trim()) ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {isProcessing && <RotateCcw size={14} className="animate-spin" />}
            <span>{isProcessing ? 'Processing...' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
