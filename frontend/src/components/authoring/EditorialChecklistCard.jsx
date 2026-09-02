import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Code2,
  Layers,
  ShieldCheck,
  Zap,
  ArrowRight,
  HelpCircle,
} from 'lucide-react';

/**
 * Grouped 8-Section Editorial Checklist Card (Items A through L)
 * Displays passing ratio, collapsible sections, and actionable "What's wrong / Why it matters / How to fix" prompts.
 */
export default function EditorialChecklistCard({
  checklistData,
  onNavigateTab,
}) {
  const [expandedSections, setExpandedSections] = useState({
    definition: true,
    constraints: true,
    io: false,
    examples: true,
    difficulty: false,
    starter: false,
    tests: true,
    security: false,
  });

  if (!checklistData || !checklistData.items) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
        No editorial checklist data available yet. Run a Quality Evaluation to generate checklist results.
      </div>
    );
  }

  const { items = [], passedCount = 0, warningCount = 0, failedCount = 0, totalItems = 12 } = checklistData;

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group items into 8 human-friendly sections
  const sections = [
    {
      key: 'definition',
      title: '1. Problem Definition',
      icon: FileText,
      itemIds: ['item_a', 'item_k'],
      actionTab: 'statement',
      actionLabel: 'Edit Statement',
    },
    {
      key: 'constraints',
      title: '2. Constraints & Bounds',
      icon: Zap,
      itemIds: ['item_b'],
      actionTab: 'statement',
      actionLabel: 'Edit Constraints',
    },
    {
      key: 'io',
      title: '3. Input & Output Specification',
      icon: FileText,
      itemIds: ['item_c', 'item_d'],
      actionTab: 'statement',
      actionLabel: 'Edit I/O Format',
    },
    {
      key: 'examples',
      title: '4. Examples & Sample Tests',
      icon: Layers,
      itemIds: ['item_e'],
      actionTab: 'testcases',
      actionLabel: 'Add Sample Test',
    },
    {
      key: 'difficulty',
      title: '5. Difficulty & Complexity',
      icon: Zap,
      itemIds: ['item_f', 'item_g'],
      actionTab: 'statement',
      actionLabel: 'Edit Complexity',
    },
    {
      key: 'starter',
      title: '6. Starter Code & Harnesses',
      icon: Code2,
      itemIds: ['item_h'],
      actionTab: 'code',
      actionLabel: 'Configure Templates',
    },
    {
      key: 'tests',
      title: '7. Test Coverage & Edge Cases',
      icon: Layers,
      itemIds: ['item_i', 'item_j'],
      actionTab: 'testcases',
      actionLabel: 'Manage Test Cases',
    },
    {
      key: 'security',
      title: '8. Security & Similarity',
      icon: ShieldCheck,
      itemIds: ['item_l'],
      actionTab: 'quality',
      actionLabel: 'Check Similarity',
    },
  ];

  // Helper to get status icon & badge
  const renderStatusPill = (status) => {
    const s = (status || 'fail').toUpperCase();
    if (s === 'PASS') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '700' }}>
          <CheckCircle2 size={12} /> PASS
        </span>
      );
    }
    if (s === 'WARNING') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '700' }}>
          <AlertTriangle size={12} /> WARNING
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '700' }}>
        <XCircle size={12} /> FAIL
      </span>
    );
  };

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* Top Header Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px' }}>
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={20} color="#38bdf8" />
            12-Item Editorial Quality Checklist
          </h3>
          <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            Authoritative standards check before peer review approval and bank publication.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem' }}>
            <span style={{ color: '#4ade80', fontWeight: '700' }}>{passedCount} Passed</span> •
            <span style={{ color: '#fbbf24', fontWeight: '700' }}>{warningCount} Warnings</span> •
            <span style={{ color: '#f87171', fontWeight: '700' }}>{failedCount} Failed</span>
          </div>
          <div style={{ background: passedCount === totalItems ? 'rgba(34, 197, 94, 0.2)' : 'rgba(56, 189, 248, 0.1)', color: passedCount === totalItems ? '#4ade80' : '#38bdf8', padding: '4px 10px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700' }}>
            {passedCount} / {totalItems} Complete
          </div>
        </div>
      </div>

      {/* Grouped Checklist Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {sections.map((sec) => {
          const sectionItems = items.filter((it) => sec.itemIds.includes((it.id || it.code || '').toLowerCase()));
          if (sectionItems.length === 0) return null;

          const hasFailure = sectionItems.some((it) => (it.status || '').toUpperCase() === 'FAIL');
          const hasWarning = sectionItems.some((it) => (it.status || '').toUpperCase() === 'WARNING');
          const SectionIcon = sec.icon;
          const isExpanded = expandedSections[sec.key];

          return (
            <div
              key={sec.key}
              style={{
                background: 'rgba(0,0,0,0.2)',
                border: hasFailure
                  ? '1px solid rgba(239, 68, 68, 0.3)'
                  : hasWarning
                  ? '1px solid rgba(245, 158, 11, 0.25)'
                  : '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {/* Collapsible Section Header */}
              <div
                onClick={() => toggleSection(sec.key)}
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <SectionIcon size={16} color="#94a3b8" />
                  <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#f8fafc' }}>
                    {sec.title}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    ({sectionItems.length} {sectionItems.length === 1 ? 'item' : 'items'})
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {hasFailure ? (
                    renderStatusPill('FAIL')
                  ) : hasWarning ? (
                    renderStatusPill('WARNING')
                  ) : (
                    renderStatusPill('PASS')
                  )}
                  {isExpanded ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
                </div>
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {sectionItems.map((item) => {
                    const status = (item.status || 'fail').toUpperCase();
                    const isOk = status === 'PASS';

                    return (
                      <div
                        key={item.id || item.code}
                        style={{
                          background: isOk ? 'rgba(34, 197, 94, 0.03)' : 'rgba(239, 68, 68, 0.04)',
                          border: `1px solid ${isOk ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.2)'}`,
                          borderRadius: '6px',
                          padding: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.85rem', color: '#f8fafc' }}>
                            {item.name || item.title || item.code}
                          </span>
                          {renderStatusPill(item.status)}
                        </div>

                        <p style={{ margin: '0 0 6px 0', fontSize: '0.8rem', color: '#cbd5e1' }}>
                          {item.message || item.description}
                        </p>

                        {/* Actionable Guidance for Warnings & Failures */}
                        {!isOk && (
                          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
                              <strong>How to fix:</strong> {item.remediation || item.suggestion || 'Update problem definition to comply with standards.'}
                            </div>
                            {onNavigateTab && (
                              <button
                                onClick={() => onNavigateTab(sec.actionTab)}
                                style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  borderRadius: '4px',
                                  padding: '4px 10px',
                                  fontSize: '0.75rem',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <span>{sec.actionLabel}</span>
                                <ArrowRight size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
