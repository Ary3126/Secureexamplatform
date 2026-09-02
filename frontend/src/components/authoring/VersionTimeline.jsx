import React, { useState } from 'react';
import {
  History,
  GitCompare,
  RotateCcw,
  Eye,
  CheckCircle2,
  Calendar,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';

/**
 * Version History & Rollback Timeline Component
 * Renders immutable historical versions with side-by-side comparison triggers and guarded rollback.
 */
export default function VersionTimeline({
  revisions = [],
  currentVersion = 1,
  onCompareVersions,
  onRollbackVersion,
  isProcessing = false,
}) {
  const [selectedTargetVersion, setSelectedTargetVersion] = useState(null);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');

  const handleOpenRollback = (verNum) => {
    setSelectedTargetVersion(verNum);
    setRollbackReason(`Restoring previous snapshot v${verNum}`);
    setRollbackModalOpen(true);
  };

  const handleConfirmRollback = () => {
    if (!selectedTargetVersion) return;
    setRollbackModalOpen(false);
    onRollbackVersion && onRollbackVersion(selectedTargetVersion, rollbackReason);
  };

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
        <div>
          <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} color="#38bdf8" />
            Immutable Version Snapshots & History
          </h4>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Historical judging snapshots created upon publication and rollback.
          </span>
        </div>
      </div>

      {/* Revision Timeline List */}
      {revisions.length === 0 ? (
        <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
          No published version snapshots recorded yet. Publishing this problem will record its first immutable snapshot.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {revisions.map((rev) => {
            const isCurrent = rev.versionNumber === currentVersion;
            return (
              <div
                key={rev.id || rev.versionNumber}
                style={{
                  background: isCurrent ? 'rgba(56, 189, 248, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                  border: isCurrent ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: '800', fontSize: '1rem', color: isCurrent ? '#38bdf8' : '#e2e8f0' }}>
                      v{rev.versionNumber}
                    </span>
                    <span style={{ fontWeight: '600', color: '#f8fafc', fontSize: '0.9rem' }}>
                      {rev.title}
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#0284c7', color: '#fff', borderRadius: '4px', fontWeight: '700' }}>
                        CURRENT
                      </span>
                    )}
                    <span style={{ fontSize: '0.72rem', padding: '2px 6px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', borderRadius: '4px', textTransform: 'capitalize' }}>
                      {rev.sourceAction || 'published'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {rev.changeSummary && <span>Summary: {rev.changeSummary} •</span>}
                    <span>{rev.testCasesCount || 0} tests snapshot</span> •
                    <span style={{ color: '#64748b' }}>{new Date(rev.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => onCompareVersions && onCompareVersions(rev.versionNumber, currentVersion)}
                    disabled={isProcessing}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#e2e8f0',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <GitCompare size={14} /> Compare
                  </button>

                  {!isCurrent && (
                    <button
                      onClick={() => handleOpenRollback(rev.versionNumber)}
                      disabled={isProcessing}
                      style={{
                        background: '#f59e0b',
                        color: '#0f172a',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <RotateCcw size={14} /> Restore v{rev.versionNumber}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      <ConfirmationModal
        isOpen={rollbackModalOpen}
        title={`Rollback Problem to v${selectedTargetVersion}`}
        message={`Are you sure you want to restore problem state from Version ${selectedTargetVersion}?`}
        consequenceText={`Rollback will create a new Version ${currentVersion + 1} with the content and test cases of v${selectedTargetVersion}. Existing approvals will be invalidated and review status reset to Draft. Past revision snapshots are NOT deleted.`}
        confirmLabel="Confirm Rollback"
        confirmVariant="warning"
        isProcessing={isProcessing}
        requireInput
        inputLabel="Rollback Change Summary"
        inputValue={rollbackReason}
        onInputChange={setRollbackReason}
        onConfirm={handleConfirmRollback}
        onCancel={() => setRollbackModalOpen(false)}
      />
    </div>
  );
}
