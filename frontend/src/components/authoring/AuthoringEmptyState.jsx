import React from 'react';
import { Plus, BookOpen, ArrowRight } from 'lucide-react';

/**
 * User-Friendly Empty State with Call-to-Action for Professor Panel
 */
export default function AuthoringEmptyState({
  title = 'No items found',
  description = 'Get started by creating your first problem or updating search filters.',
  actionLabel = 'Create Problem',
  onAction,
  icon: Icon = BookOpen,
}) {
  return (
    <div
      style={{
        padding: '64px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        background: 'rgba(15, 23, 42, 0.4)',
        border: '1px dashed rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: 'rgba(56, 189, 248, 0.1)',
          color: '#38bdf8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
        }}
      >
        <Icon size={24} />
      </div>

      <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem', color: '#f8fafc', fontWeight: '700' }}>
        {title}
      </h3>
      <p style={{ margin: '0 0 20px 0', fontSize: '0.85rem', color: '#94a3b8', maxWidth: '420px', lineHeight: '1.5' }}>
        {description}
      </p>

      {onAction && (
        <button
          onClick={onAction}
          style={{
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.2)',
          }}
        >
          <Plus size={16} />
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}
