import React from 'react';
import {
  FileEdit,
  Send,
  CheckCircle2,
  Globe,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowRight,
  Info,
  Calendar,
} from 'lucide-react';

/**
 * Visual Lifecycle Stepper & Contextual Next-Action Guidance
 * Renders the 4-step lifecycle progression and provides plain-English next-step instructions.
 */
export default function LifecycleStepper({
  status = 'draft',
  version = 1,
  approvedVersion = null,
  isAuthor = true,
  scheduledPublishAt = null,
  onPrimaryAction,
  onSecondaryAction,
}) {
  const normalized = (status || 'draft').toLowerCase();

  // Determine active step index (0 = Draft, 1 = Review, 2 = Decision, 3 = Release)
  let activeStep = 0;
  if (['review_requested', 'pending', 'in_review'].includes(normalized)) {
    activeStep = 1;
  } else if (['approved', 'changes_requested', 'rejected'].includes(normalized)) {
    activeStep = 2;
  } else if (['published', 'scheduled', 'withdrawn', 'archived'].includes(normalized)) {
    activeStep = 3;
  }

  // Next-Action guidance matrix
  const guidanceMap = {
    draft: {
      title: 'Problem in Draft Mode',
      desc: 'You are authoring or updating problem statement and test cases. When ready, run Quality checks and submit for peer review.',
      actionText: isAuthor ? 'Submit for Review' : 'Edit Problem',
      actionKey: isAuthor ? 'request_review' : 'edit',
      hint: 'Requires at least 1 sample test case and 1 hidden test case.',
      badgeColor: '#94a3b8',
    },
    review_requested: {
      title: 'Awaiting Peer Review',
      desc: 'This version (v' + version + ') has been submitted to the review queue. Another professor will inspect statement, code templates, and test coverage.',
      actionText: isAuthor ? 'View Review Details' : 'Start Review',
      actionKey: isAuthor ? 'view_reviews' : 'start_review',
      hint: 'Editing problem content now will reset review status to draft.',
      badgeColor: '#c084fc',
    },
    in_review: {
      title: 'Active Peer Review in Progress',
      desc: 'A reviewer is currently evaluating this problem for clarity, difficulty calibration, and grading safety.',
      actionText: 'Open Review Panel',
      actionKey: 'view_reviews',
      hint: 'Discussion comments are visible to the author and reviewer.',
      badgeColor: '#38bdf8',
    },
    changes_requested: {
      title: 'Changes Requested by Reviewer',
      desc: 'The reviewer left feedback and requested modifications before this problem can be approved.',
      actionText: isAuthor ? 'Edit & Address Feedback' : 'View Feedback',
      actionKey: isAuthor ? 'edit' : 'view_reviews',
      hint: 'Update problem draft and resubmit for review once changes are made.',
      badgeColor: '#fbbf24',
    },
    rejected: {
      title: 'Review Rejected',
      desc: 'This problem version was not approved for publication. Review the reviewer note to understand why.',
      actionText: isAuthor ? 'Edit & Resubmit' : 'View Details',
      actionKey: isAuthor ? 'edit' : 'view_reviews',
      hint: 'You can modify the problem and submit a fresh review request.',
      badgeColor: '#f87171',
    },
    approved: {
      title: 'Approved & Ready for Release',
      desc: `Version ${approvedVersion || version} has been verified and approved by a peer reviewer. You can now publish to the problem bank or schedule a future release.`,
      actionText: isAuthor ? 'Publish Now' : 'View Details',
      actionKey: isAuthor ? 'publish' : 'view_reviews',
      hint: 'Modifying problem draft will invalidate this approval.',
      badgeColor: '#4ade80',
    },
    published: {
      title: 'Published & Active in Problem Bank',
      desc: 'This problem is live in the public problem bank and available for contest assignment and practice.',
      actionText: isAuthor ? 'Unpublish / Withdraw' : 'View Problem',
      actionKey: isAuthor ? 'unpublish' : 'preview',
      hint: 'To modify statement or test cases, edit the problem to create a new draft version.',
      badgeColor: '#34d399',
    },
    scheduled: {
      title: 'Scheduled for Release',
      desc: `Configured to automatically release${scheduledPublishAt ? ` on ${new Date(scheduledPublishAt).toLocaleString()}` : ''}.`,
      actionText: 'Manage Schedule',
      actionKey: 'schedule',
      hint: 'Publication safety will be re-verified at execution time.',
      badgeColor: '#a78bfa',
    },
    withdrawn: {
      title: 'Withdrawn from Public Bank',
      desc: 'This problem was unpublished. It is no longer visible to students in public problem explorer.',
      actionText: isAuthor ? 'Edit Draft' : 'View Details',
      actionKey: isAuthor ? 'edit' : 'preview',
      hint: 'Request peer review on updated draft to republish.',
      badgeColor: '#fb7185',
    },
    archived: {
      title: 'Archived Problem',
      desc: 'Soft-locked problem archived for record keeping. It cannot be used in new contests unless restored.',
      actionText: isAuthor ? 'Restore from Archive' : 'View Details',
      actionKey: isAuthor ? 'restore_archive' : 'preview',
      hint: 'Restoring moves status back to Draft mode.',
      badgeColor: '#94a3b8',
    },
  };

  const guidance = guidanceMap[normalized] || guidanceMap.draft;

  const steps = [
    { label: 'Draft', desc: 'Authoring & Tests', icon: FileEdit },
    { label: 'Peer Review', desc: 'Evaluation', icon: Send },
    {
      label: normalized === 'rejected' ? 'Rejected' : normalized === 'changes_requested' ? 'Changes Req.' : 'Approved',
      desc: normalized === 'rejected' ? 'Needs revision' : normalized === 'changes_requested' ? 'Feedback given' : 'Verified',
      icon: normalized === 'rejected' ? XCircle : normalized === 'changes_requested' ? AlertTriangle : CheckCircle2,
      isAlert: normalized === 'rejected' || normalized === 'changes_requested',
    },
    {
      label: normalized === 'scheduled' ? 'Scheduled' : normalized === 'archived' ? 'Archived' : 'Published',
      desc: normalized === 'scheduled' ? 'Future release' : normalized === 'archived' ? 'Inactive' : 'Live in Bank',
      icon: normalized === 'scheduled' ? Calendar : Globe,
    },
  ];

  return (
    <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
      {/* 4-Step Visual Stepper Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', position: 'relative', marginBottom: '20px' }}>
        {steps.map((step, idx) => {
          const isDone = idx < activeStep || (idx === activeStep && (normalized === 'approved' || normalized === 'published'));
          const isCurrent = idx === activeStep;
          const StepIcon = step.icon;

          return (
            <div
              key={step.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '10px 8px',
                borderRadius: '8px',
                background: isCurrent
                  ? 'rgba(56, 189, 248, 0.08)'
                  : isDone
                  ? 'rgba(34, 197, 94, 0.05)'
                  : 'rgba(255,255,255,0.02)',
                border: isCurrent
                  ? '1px solid rgba(56, 189, 248, 0.3)'
                  : isDone
                  ? '1px solid rgba(34, 197, 94, 0.2)'
                  : '1px solid rgba(255,255,255,0.05)',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '8px',
                  background: step.isAlert
                    ? normalized === 'rejected' ? '#ef4444' : '#f59e0b'
                    : isCurrent
                    ? '#0284c7'
                    : isDone
                    ? '#16a34a'
                    : 'rgba(255,255,255,0.08)',
                  color: '#ffffff',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                }}
              >
                <StepIcon size={16} />
              </div>
              <span style={{ fontSize: '0.85rem', fontWeight: isCurrent ? '700' : '600', color: isCurrent ? '#38bdf8' : isDone ? '#4ade80' : '#94a3b8' }}>
                {step.label}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                {step.desc}
              </span>
            </div>
          );
        })}
      </div>

      {/* Contextual Next-Action Guidance Callout */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.25)',
          borderLeft: `4px solid ${guidance.badgeColor}`,
          borderRadius: '0 8px 8px 0',
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#f8fafc' }}>
              {guidance.title}
            </span>
            <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', color: '#94a3b8', padding: '2px 6px', borderRadius: '4px' }}>
              v{version}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: '1.4' }}>
            {guidance.desc}
          </p>
          {guidance.hint && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
              <Info size={12} color="#38bdf8" />
              <span>{guidance.hint}</span>
            </div>
          )}
        </div>

        {onPrimaryAction && (
          <div>
            <button
              onClick={() => onPrimaryAction(guidance.actionKey)}
              style={{
                background: guidance.actionKey === 'publish'
                  ? '#16a34a'
                  : guidance.actionKey === 'request_review'
                  ? '#a855f7'
                  : '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '8px 18px',
                borderRadius: '8px',
                fontWeight: '600',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            >
              <span>{guidance.actionText}</span>
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
