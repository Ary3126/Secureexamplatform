import React from 'react';
import { GitCompare, X, AlertCircle } from 'lucide-react';

/**
 * Version Diff Comparison Modal
 * Renders side-by-side field diffs between two versions without leaking hidden test secrets.
 */
export default function VersionDiffModal({
  isOpen,
  diffData,
  onClose,
}) {
  if (!isOpen || !diffData) return null;

  const { v1, v2, fields = {}, hasChanges } = diffData;

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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '860px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Modal Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GitCompare size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                Version Comparison: v{v1} vs v{v2}
              </h3>
              <span style={{ fontSize: '0.8rem', color: hasChanges ? '#fbbf24' : '#4ade80' }}>
                {hasChanges ? 'Differences detected between versions' : 'Identical configurations'}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content / Diffs */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {Object.entries(fields).map(([fieldName, diffItem]) => {
            const isChanged = diffItem.changed;

            return (
              <div
                key={fieldName}
                style={{
                  background: isChanged ? 'rgba(245, 158, 11, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                  border: isChanged ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  padding: '14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.85rem', color: '#f8fafc', textTransform: 'capitalize' }}>
                    {fieldName === 'testCasesCount' ? 'Test Cases Count' : fieldName}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: '700',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: isChanged ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                      color: isChanged ? '#fbbf24' : '#4ade80',
                    }}
                  >
                    {isChanged ? 'MODIFIED' : 'IDENTICAL'}
                  </span>
                </div>

                {fieldName === 'testCasesCount' ? (
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px' }}>
                    <strong>v{v1}:</strong> {diffItem.v1?.total || 0} tests ({diffItem.v1?.sample || 0} sample, {diffItem.v1?.hidden || 0} hidden)
                    <span style={{ margin: '0 8px', color: '#64748b' }}>→</span>
                    <strong style={{ color: '#38bdf8' }}>v{v2}:</strong> {diffItem.v2?.total || 0} tests ({diffItem.v2?.sample || 0} sample, {diffItem.v2?.hidden || 0} hidden)
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Version {v1} (Before)
                      </span>
                      <div style={{ fontSize: '0.82rem', color: '#cbd5e1', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                        {typeof diffItem.v1 === 'string' ? diffItem.v1 : JSON.stringify(diffItem.v1, null, 2)}
                      </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px', border: isChanged ? '1px solid rgba(56, 189, 248, 0.2)' : 'none' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#38bdf8', display: 'block', marginBottom: '4px' }}>
                        Version {v2} (After)
                      </span>
                      <div style={{ fontSize: '0.82rem', color: '#f8fafc', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                        {typeof diffItem.v2 === 'string' ? diffItem.v2 : JSON.stringify(diffItem.v2, null, 2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '8px 20px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}
