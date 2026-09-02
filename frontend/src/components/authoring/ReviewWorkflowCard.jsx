import React, { useState } from 'react';
import {
  Clock,
  UserCheck,
  Send,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  HelpCircle,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import ConfirmationModal from './ConfirmationModal';

/**
 * Review Workflow Card Component
 * Streamlines peer review evaluation with SLA tracking and guarded decisions.
 */
export default function ReviewWorkflowCard({
  activeReview,
  currentUser,
  isAuthor = false,
  isReviewer = false,
  reviewComments = [],
  onStartReview,
  onApproveReview,
  onRequestChanges,
  onRejectReview,
  onAddComment,
  isProcessing = false,
}) {
  const [newComment, setNewComment] = useState('');
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveNote, setApproveNote] = useState('Statement, test cases, and complexity expectations verified.');
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [changesComment, setChangesComment] = useState('');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  if (!activeReview) {
    return (
      <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>No active review request for this problem.</p>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>When ready, submit your draft for peer review approval.</span>
      </div>
    );
  }

  const handleConfirmApprove = () => {
    setApproveModalOpen(false);
    onApproveReview && onApproveReview(approveNote);
  };

  const handleConfirmChanges = () => {
    if (!changesComment.trim()) return;
    setChangesModalOpen(false);
    onRequestChanges && onRequestChanges(changesComment);
    setChangesComment('');
  };

  const handleConfirmReject = () => {
    if (!rejectComment.trim()) return;
    setRejectModalOpen(false);
    onRejectReview && onRejectReview(rejectComment);
    setRejectComment('');
  };

  const handleSendComment = (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    onAddComment && onAddComment(newComment);
    setNewComment('');
  };

  // SLA indicator
  const getSlaBadge = () => {
    const ageHours = Math.max(0, (Date.now() - new Date(activeReview.createdAt).getTime()) / (1000 * 60 * 60));
    if (ageHours <= 24) {
      return <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>ON TIME (&lt;24h)</span>;
    }
    if (ageHours <= 48) {
      return <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>AT RISK (24-48h)</span>;
    }
    return <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>OVERDUE (&gt;48h)</span>;
  };

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px' }}>
      {/* Review Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '18px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <UserCheck size={18} color="#38bdf8" />
            <h4 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>
              Review #{activeReview.id} (v{activeReview.problemVersion})
            </h4>
            <StatusBadge status={activeReview.status} size="sm" />
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Submitted by User #{activeReview.submittedBy} on {new Date(activeReview.createdAt).toLocaleString()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {getSlaBadge()}
        </div>
      </div>

      {/* Review Actions for Reviewer (Not Author) */}
      {!isAuthor && (
        <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '14px', marginBottom: '18px' }}>
          <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#cbd5e1', marginBottom: '10px' }}>
            Reviewer Decision Actions:
          </span>

          {activeReview.status === 'pending' ? (
            <button
              onClick={onStartReview}
              disabled={isProcessing}
              style={{
                background: '#0284c7',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <CheckCircle2 size={16} /> Start Review
            </button>
          ) : activeReview.status === 'in_review' ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setApproveModalOpen(true)}
                disabled={isProcessing}
                style={{
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ThumbsUp size={15} /> Approve v{activeReview.problemVersion}
              </button>

              <button
                onClick={() => setChangesModalOpen(true)}
                disabled={isProcessing}
                style={{
                  background: '#f59e0b',
                  color: '#0f172a',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertTriangle size={15} /> Request Changes
              </button>

              <button
                onClick={() => setRejectModalOpen(true)}
                disabled={isProcessing}
                style={{
                  background: '#e11d48',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <ThumbsDown size={15} /> Reject Review
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              Review decision has been finalized ({activeReview.status}).
            </div>
          )}
        </div>
      )}

      {/* Review Comments / Dialogue Thread */}
      <div style={{ marginBottom: '16px' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: '700', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <MessageSquare size={14} color="#38bdf8" /> Review Dialogue & Feedback ({reviewComments.length})
        </span>

        {reviewComments.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', color: '#64748b', fontSize: '0.8rem' }}>
            No comments yet on this review. Use the box below to ask questions or provide feedback.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', marginBottom: '12px' }}>
            {reviewComments.map((c) => {
              const isOwn = currentUser && c.authorId === currentUser.id;
              return (
                <div
                  key={c.id}
                  style={{
                    background: isOwn ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isOwn ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '6px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '4px' }}>
                    <span style={{ fontWeight: '700', color: isOwn ? '#38bdf8' : '#cbd5e1' }}>
                      {c.authorName || `User #${c.authorId}`} {c.authorRole ? `(${c.authorRole})` : ''}
                    </span>
                    <span>{new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#f8fafc', whiteSpace: 'pre-wrap' }}>
                    {c.commentText}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Comment Input */}
        <form onSubmit={handleSendComment} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Add a comment or question to this review..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            disabled={isProcessing}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#1e293b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isProcessing || !newComment.trim()}
            style={{
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '0.82rem',
              fontWeight: '600',
              cursor: isProcessing || !newComment.trim() ? 'not-allowed' : 'pointer',
              opacity: isProcessing || !newComment.trim() ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Send size={14} /> Send
          </button>
        </form>
      </div>

      {/* Confirmation Modals for Decision Actions */}
      <ConfirmationModal
        isOpen={approveModalOpen}
        title="Approve Problem Version"
        message={`You are approving Version ${activeReview.problemVersion} for publication.`}
        consequenceText="Author will be authorized to publish this exact version to the problem bank. If author modifies the draft later, approval is automatically invalidated."
        confirmLabel="Confirm Approval"
        confirmVariant="success"
        isProcessing={isProcessing}
        requireInput
        inputLabel="Approval Verification Note"
        inputValue={approveNote}
        onInputChange={setApproveNote}
        onConfirm={handleConfirmApprove}
        onCancel={() => setApproveModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={changesModalOpen}
        title="Request Changes on Problem"
        message={`Request modifications on Version ${activeReview.problemVersion}.`}
        consequenceText="Review status will update to 'Changes Requested'. The author must edit their problem draft and resubmit for approval."
        confirmLabel="Submit Change Request"
        confirmVariant="warning"
        isProcessing={isProcessing}
        requireInput
        inputLabel="Feedback for Author (Required)"
        inputPlaceholder="Explain what needs to be fixed or improved..."
        inputValue={changesComment}
        onInputChange={setChangesComment}
        onConfirm={handleConfirmChanges}
        onCancel={() => setChangesModalOpen(false)}
      />

      <ConfirmationModal
        isOpen={rejectModalOpen}
        title="Reject Problem Review"
        message={`Reject Version ${activeReview.problemVersion}.`}
        consequenceText="Problem review status will be set to 'Rejected'. Author will not be permitted to publish this version."
        confirmLabel="Confirm Rejection"
        confirmVariant="danger"
        isProcessing={isProcessing}
        requireInput
        inputLabel="Reason for Rejection (Required)"
        inputPlaceholder="Specify why this problem is rejected..."
        inputValue={rejectComment}
        onInputChange={setRejectComment}
        onConfirm={handleConfirmReject}
        onCancel={() => setRejectModalOpen(false)}
      />
    </div>
  );
}
