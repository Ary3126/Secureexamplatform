import React from 'react';
import {
  FileEdit,
  Clock,
  Send,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Globe,
  Calendar,
  RotateCcw,
  Archive,
} from 'lucide-react';

/**
 * Unified Status Badge component for Problem Authoring & Review Governance
 * Maps status keys to accessible, high-contrast colors, icons, and readable labels.
 */
export default function StatusBadge({ status, size = 'md' }) {
  const normalized = (status || 'draft').toLowerCase();

  const configs = {
    draft: {
      label: 'Draft',
      bg: 'rgba(148, 163, 184, 0.15)',
      color: '#94a3b8',
      border: 'rgba(148, 163, 184, 0.3)',
      icon: FileEdit,
    },
    review_requested: {
      label: 'Review Requested',
      bg: 'rgba(168, 85, 247, 0.15)',
      color: '#c084fc',
      border: 'rgba(168, 85, 247, 0.3)',
      icon: Send,
    },
    pending: {
      label: 'Pending Review',
      bg: 'rgba(168, 85, 247, 0.15)',
      color: '#c084fc',
      border: 'rgba(168, 85, 247, 0.3)',
      icon: Clock,
    },
    in_review: {
      label: 'In Review',
      bg: 'rgba(56, 189, 248, 0.15)',
      color: '#38bdf8',
      border: 'rgba(56, 189, 248, 0.3)',
      icon: Clock,
    },
    changes_requested: {
      label: 'Changes Requested',
      bg: 'rgba(245, 158, 11, 0.15)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.3)',
      icon: AlertTriangle,
    },
    rejected: {
      label: 'Rejected',
      bg: 'rgba(239, 68, 68, 0.15)',
      color: '#f87171',
      border: 'rgba(239, 68, 68, 0.3)',
      icon: XCircle,
    },
    approved: {
      label: 'Approved',
      bg: 'rgba(34, 197, 94, 0.15)',
      color: '#4ade80',
      border: 'rgba(34, 197, 94, 0.3)',
      icon: CheckCircle2,
    },
    published: {
      label: 'Published',
      bg: 'rgba(16, 185, 129, 0.2)',
      color: '#34d399',
      border: 'rgba(16, 185, 129, 0.4)',
      icon: Globe,
    },
    scheduled: {
      label: 'Scheduled',
      bg: 'rgba(139, 92, 246, 0.15)',
      color: '#a78bfa',
      border: 'rgba(139, 92, 246, 0.3)',
      icon: Calendar,
    },
    withdrawn: {
      label: 'Withdrawn',
      bg: 'rgba(244, 63, 94, 0.15)',
      color: '#fb7185',
      border: 'rgba(244, 63, 94, 0.3)',
      icon: RotateCcw,
    },
    archived: {
      label: 'Archived',
      bg: 'rgba(100, 116, 139, 0.15)',
      color: '#94a3b8',
      border: 'rgba(100, 116, 139, 0.3)',
      icon: Archive,
    },
  };

  const cfg = configs[normalized] || configs.draft;
  const IconComponent = cfg.icon;

  const sizeStyles = {
    sm: { padding: '2px 8px', fontSize: '0.7rem', iconSize: 12, gap: '4px' },
    md: { padding: '4px 10px', fontSize: '0.78rem', iconSize: 14, gap: '5px' },
    lg: { padding: '6px 14px', fontSize: '0.85rem', iconSize: 16, gap: '6px' },
  };

  const s = sizeStyles[size] || sizeStyles.md;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: s.gap,
        padding: s.padding,
        borderRadius: '9999px',
        fontSize: s.fontSize,
        fontWeight: '600',
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        textTransform: 'none',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
      title={`Problem Status: ${cfg.label}`}
    >
      <IconComponent size={s.iconSize} style={{ flexShrink: 0 }} />
      <span>{cfg.label}</span>
    </span>
  );
}
