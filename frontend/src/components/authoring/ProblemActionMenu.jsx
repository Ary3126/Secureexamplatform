import React, { useState, useRef, useEffect } from 'react';
import {
  MoreVertical,
  History,
  GitCompare,
  Sparkles,
  Layers,
  Eye,
  Copy,
  Archive,
  RotateCcw,
  Trash2,
  Calendar,
  Send,
  Globe,
  FileEdit,
  Lock,
} from 'lucide-react';

/**
 * Clean Primary Action Area + Contextual "More Actions" Dropdown
 * Replaces crowded 8-10 button action bars with focused workflow triggers.
 */
export default function ProblemActionMenu({
  status = 'draft',
  isAuthor = true,
  isPublished = false,
  isReadyToPublish = false,
  isProcessing = false,
  onAction,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (actionKey) => {
    setDropdownOpen(false);
    onAction && onAction(actionKey);
  };

  const normalized = (status || 'draft').toLowerCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
      {/* 1. Context-Aware Primary Actions */}
      {normalized === 'published' ? (
        <>
          <button
            onClick={() => onAction('preview')}
            disabled={isProcessing}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Eye size={15} /> Student Preview
          </button>
          {isAuthor && (
            <button
              onClick={() => onAction('unpublish')}
              disabled={isProcessing}
              style={{
                background: '#e11d48',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <RotateCcw size={15} /> Unpublish
            </button>
          )}
        </>
      ) : normalized === 'approved' ? (
        <>
          <button
            onClick={() => onAction('schedule')}
            disabled={isProcessing}
            style={{
              background: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Calendar size={15} /> Schedule
          </button>
          <button
            onClick={() => onAction('publish')}
            disabled={isProcessing}
            style={{
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }}
          >
            <Globe size={15} /> Publish Now
          </button>
        </>
      ) : normalized === 'archived' ? (
        <button
          onClick={() => onAction('restore_archive')}
          disabled={isProcessing}
          style={{
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <RotateCcw size={15} /> Restore Archive
        </button>
      ) : (
        <>
          <button
            onClick={() => onAction('save')}
            disabled={isProcessing}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <FileEdit size={15} /> Save Draft
          </button>
          {isAuthor && (
            <button
              onClick={() => onAction('request_review')}
              disabled={isProcessing}
              style={{
                background: '#a855f7',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Send size={15} /> Request Review
            </button>
          )}
        </>
      )}

      {/* 2. "More Actions" Dropdown */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#e2e8f0',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '0.85rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="More Problem Actions"
        >
          <MoreVertical size={16} />
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '8px',
              padding: '6px',
              width: '220px',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            <button
              onClick={() => handleMenuClick('history')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.82rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <History size={14} color="#38bdf8" /> Version History
            </button>

            <button
              onClick={() => handleMenuClick('quality')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.82rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Sparkles size={14} color="#fbbf24" /> Quality & Checklist
            </button>

            <button
              onClick={() => handleMenuClick('dependencies')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.82rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Layers size={14} color="#a78bfa" /> Dependency Impact
            </button>

            <button
              onClick={() => handleMenuClick('preview')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.82rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Eye size={14} color="#34d399" /> Student Preview
            </button>

            <button
              onClick={() => handleMenuClick('clone')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e2e8f0',
                padding: '8px 10px',
                borderRadius: '4px',
                fontSize: '0.82rem',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Copy size={14} color="#94a3b8" /> Clone Problem
            </button>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />

            {normalized !== 'archived' && !isPublished && (
              <button
                onClick={() => handleMenuClick('archive')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#cbd5e1',
                  padding: '8px 10px',
                  borderRadius: '4px',
                  fontSize: '0.82rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Archive size={14} color="#94a3b8" /> Archive Problem
              </button>
            )}

            {isAuthor && !isPublished && (
              <button
                onClick={() => handleMenuClick('delete')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#f87171',
                  padding: '8px 10px',
                  borderRadius: '4px',
                  fontSize: '0.82rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Trash2 size={14} color="#f87171" /> Delete Draft
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
