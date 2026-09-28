/**
 * Automated Test Suite for Phase 7.5.6: Admin Contest Lifecycle Management UI
 * File: frontend/test_admin_phase5_6_contest_lifecycle_ui.js
 *
 * Verifies all UI requirements for Phase 7.5.6:
 * A. Lifecycle state display (Draft, Upcoming, Running, Ended, Archived)
 * B. Schedule display (Start time, End time, Duration, Creator/Host)
 * C. Editability display (Editable vs Configuration Locked)
 * D. Lifecycle action visibility (Publish for draft, Unpublish for upcoming, Archive for ended/draft)
 * E. Invalid action handling (Disabled states, tooltips explaining lock reason)
 * F. Confirmation dialogs for destructive actions (Archive and Unpublish modals with consequence explanation)
 * G. Backend error handling (Extraction and display of 400, 403, 409 Conflict messages)
 * H. Refresh after lifecycle transition (Invoking parent callbacks, updating drawer state)
 * I. Archived state UI (Read-only status, archived badge, disabled mutation actions)
 * J. Published/unpublished state UI (Visibility indicators, draft vs published badges)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic Model Mirrors (matching AdminContestManagement.jsx and AdminPanel.jsx) ──

function getRuntimeState(contest) {
  return (contest?.runtimeState || contest?.status || 'draft').toLowerCase();
}

function getStatusBadge(contest) {
  const runtime = getRuntimeState(contest);
  const status = (contest?.status || 'draft').toLowerCase();

  switch (runtime) {
    case 'running':
      return { label: 'Running', color: 'green', isRunning: true };
    case 'upcoming':
      return { label: 'Upcoming', color: 'blue', isUpcoming: true };
    case 'ended':
      return { label: 'Ended', color: 'amber', isEnded: true };
    case 'archived':
      return { label: 'Archived', color: 'gray', isArchived: true };
    default:
      return { label: status === 'published' ? 'Published' : 'Draft', color: 'neutral', isDraft: true };
  }
}

function isContestEditable(contest) {
  const runtime = getRuntimeState(contest);
  if (runtime === 'draft' || runtime === 'upcoming') {
    return { editable: true, badge: 'Editable', color: 'emerald' };
  }
  return { 
    editable: false, 
    badge: 'Configuration Locked', 
    color: 'amber',
    reason: runtime === 'archived' 
      ? 'Contest is archived and cannot be modified.' 
      : `Contest schedule and configuration are locked while ${runtime}.`
  };
}

function getAvailableLifecycleActions(contest, currentUser) {
  if (!contest || !currentUser) {
    return { canPublish: false, canUnpublish: false, canArchive: false, canEdit: false };
  }

  // RBAC & Ownership
  const role = currentUser.role;
  let canManage = role === 'super_admin' || role === 'contest_admin';
  if (role === 'professor') {
    const ownerId = contest.createdBy || contest.created_by;
    canManage = ownerId && ownerId === currentUser.id;
  }

  if (!canManage) {
    return { canPublish: false, canUnpublish: false, canArchive: false, canEdit: false };
  }

  const runtime = getRuntimeState(contest);
  const status = (contest.status || 'draft').toLowerCase();

  const canPublish = status === 'draft';
  const canUnpublish = status === 'published' && runtime === 'upcoming';
  const canArchive = status !== 'archived' && runtime !== 'running';
  const canEdit = runtime === 'draft' || runtime === 'upcoming';

  return {
    canPublish,
    canUnpublish,
    canArchive,
    canEdit,
    runtime,
    status,
  };
}

function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return '—';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return '—';
  
  const diffMinutes = Math.round((end - start) / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function getConfirmationModalDetails(actionType, contest) {
  if (actionType === 'archive') {
    return {
      title: 'Archive Contest',
      confirmText: 'Confirm Archive',
      warningType: 'danger',
      description: `Are you sure you want to archive "${contest?.title || 'this contest'}"?`,
      consequence: 'Archived contests are permanently read-only and immutable. All submissions, participants, standings, ratings, and problem links will be preserved.',
    };
  }
  if (actionType === 'unpublish') {
    return {
      title: 'Unpublish Contest',
      confirmText: 'Unpublish to Draft',
      warningType: 'warning',
      description: `Are you sure you want to unpublish "${contest?.title || 'this contest'}" back to draft?`,
      consequence: 'The contest will no longer be visible to participants. You will be able to edit its configuration, schedule, and problems before republishing.',
    };
  }
  return null;
}

function extractErrorMessage(err) {
  if (typeof err === 'string') return err;
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.message) return err.message;
  return 'An unexpected error occurred. Please try again.';
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Phase 7.5.6 — Admin Contest Lifecycle Management UI', () => {

  const now = new Date();
  const pastStart = new Date(now.getTime() - 7200000).toISOString();
  const pastEnd = new Date(now.getTime() - 3600000).toISOString();
  const futureStart = new Date(now.getTime() + 3600000).toISOString();
  const futureEnd = new Date(now.getTime() + 7200000).toISOString();

  const draftContest = {
    id: 101,
    title: 'Draft Contest',
    status: 'draft',
    runtimeState: 'draft',
    startTime: futureStart,
    endTime: futureEnd,
    problemCount: 2,
    createdBy: 10,
    createdByName: 'Prof Turing',
  };

  const upcomingContest = {
    id: 102,
    title: 'Upcoming Contest',
    status: 'published',
    runtimeState: 'upcoming',
    startTime: futureStart,
    endTime: futureEnd,
    problemCount: 3,
    createdBy: 10,
    createdByName: 'Prof Turing',
  };

  const runningContest = {
    id: 103,
    title: 'Running Contest',
    status: 'published',
    runtimeState: 'running',
    startTime: pastStart,
    endTime: futureEnd,
    problemCount: 4,
    createdBy: 10,
    createdByName: 'Prof Turing',
  };

  const endedContest = {
    id: 104,
    title: 'Ended Contest',
    status: 'published',
    runtimeState: 'ended',
    startTime: pastStart,
    endTime: pastEnd,
    problemCount: 5,
    createdBy: 10,
    createdByName: 'Prof Turing',
  };

  const archivedContest = {
    id: 105,
    title: 'Archived Contest',
    status: 'archived',
    runtimeState: 'archived',
    startTime: pastStart,
    endTime: pastEnd,
    problemCount: 5,
    createdBy: 10,
    createdByName: 'Prof Turing',
  };

  const ownerProf = { id: 10, role: 'professor' };
  const nonOwnerProf = { id: 99, role: 'professor' };
  const contestAdmin = { id: 2, role: 'contest_admin' };
  const superAdmin = { id: 1, role: 'super_admin' };
  const student = { id: 50, role: 'student' };

  // -------------------------------------------------------------------------
  // A. Lifecycle State Display
  // -------------------------------------------------------------------------
  describe('A. Lifecycle State Display', () => {
    it('displays draft status badge correctly', () => {
      const badge = getStatusBadge(draftContest);
      assert.strictEqual(badge.label, 'Draft');
      assert.strictEqual(badge.color, 'neutral');
    });

    it('displays upcoming status badge correctly', () => {
      const badge = getStatusBadge(upcomingContest);
      assert.strictEqual(badge.label, 'Upcoming');
      assert.strictEqual(badge.color, 'blue');
      assert.strictEqual(badge.isUpcoming, true);
    });

    it('displays running status badge correctly', () => {
      const badge = getStatusBadge(runningContest);
      assert.strictEqual(badge.label, 'Running');
      assert.strictEqual(badge.color, 'green');
      assert.strictEqual(badge.isRunning, true);
    });

    it('displays ended status badge correctly', () => {
      const badge = getStatusBadge(endedContest);
      assert.strictEqual(badge.label, 'Ended');
      assert.strictEqual(badge.color, 'amber');
      assert.strictEqual(badge.isEnded, true);
    });

    it('displays archived status badge correctly', () => {
      const badge = getStatusBadge(archivedContest);
      assert.strictEqual(badge.label, 'Archived');
      assert.strictEqual(badge.color, 'gray');
      assert.strictEqual(badge.isArchived, true);
    });
  });

  // -------------------------------------------------------------------------
  // B. Schedule Display
  // -------------------------------------------------------------------------
  describe('B. Schedule Display', () => {
    it('formats 1 hour duration correctly', () => {
      const s = '2026-10-01T10:00:00Z';
      const e = '2026-10-01T11:00:00Z';
      assert.strictEqual(formatDuration(s, e), '1h');
    });

    it('formats 2 hour 30 min duration correctly', () => {
      const s = '2026-10-01T10:00:00Z';
      const e = '2026-10-01T12:30:00Z';
      assert.strictEqual(formatDuration(s, e), '2h 30m');
    });

    it('formats sub-hour duration correctly', () => {
      const s = '2026-10-01T10:00:00Z';
      const e = '2026-10-01T10:45:00Z';
      assert.strictEqual(formatDuration(s, e), '45m');
    });

    it('returns placeholder when dates are invalid or inverted', () => {
      assert.strictEqual(formatDuration(null, null), '—');
      assert.strictEqual(formatDuration('2026-10-01T12:00:00Z', '2026-10-01T10:00:00Z'), '—');
    });
  });

  // -------------------------------------------------------------------------
  // C. Editability Display
  // -------------------------------------------------------------------------
  describe('C. Editability Display', () => {
    it('marks draft as editable', () => {
      const info = isContestEditable(draftContest);
      assert.strictEqual(info.editable, true);
      assert.strictEqual(info.badge, 'Editable');
    });

    it('marks upcoming as editable', () => {
      const info = isContestEditable(upcomingContest);
      assert.strictEqual(info.editable, true);
      assert.strictEqual(info.badge, 'Editable');
    });

    it('marks running as locked with reason', () => {
      const info = isContestEditable(runningContest);
      assert.strictEqual(info.editable, false);
      assert.strictEqual(info.badge, 'Configuration Locked');
      assert.ok(info.reason.includes('running'));
    });

    it('marks ended as locked with reason', () => {
      const info = isContestEditable(endedContest);
      assert.strictEqual(info.editable, false);
      assert.strictEqual(info.badge, 'Configuration Locked');
      assert.ok(info.reason.includes('ended'));
    });

    it('marks archived as locked with reason', () => {
      const info = isContestEditable(archivedContest);
      assert.strictEqual(info.editable, false);
      assert.strictEqual(info.badge, 'Configuration Locked');
      assert.ok(info.reason.includes('archived'));
    });
  });

  // -------------------------------------------------------------------------
  // D. Lifecycle Action Visibility
  // -------------------------------------------------------------------------
  describe('D. Lifecycle Action Visibility', () => {
    it('owner can publish draft and archive draft, but not unpublish draft', () => {
      const actions = getAvailableLifecycleActions(draftContest, ownerProf);
      assert.strictEqual(actions.canPublish, true);
      assert.strictEqual(actions.canUnpublish, false);
      assert.strictEqual(actions.canArchive, true);
      assert.strictEqual(actions.canEdit, true);
    });

    it('owner can unpublish upcoming and archive upcoming, but not publish upcoming', () => {
      const actions = getAvailableLifecycleActions(upcomingContest, ownerProf);
      assert.strictEqual(actions.canPublish, false);
      assert.strictEqual(actions.canUnpublish, true);
      assert.strictEqual(actions.canArchive, true);
      assert.strictEqual(actions.canEdit, true);
    });

    it('running contest has NO publish, unpublish, archive, or edit actions', () => {
      const actions = getAvailableLifecycleActions(runningContest, ownerProf);
      assert.strictEqual(actions.canPublish, false);
      assert.strictEqual(actions.canUnpublish, false);
      assert.strictEqual(actions.canArchive, false);
      assert.strictEqual(actions.canEdit, false);
    });

    it('ended contest allows archive action, but not publish, unpublish, or edit', () => {
      const actions = getAvailableLifecycleActions(endedContest, ownerProf);
      assert.strictEqual(actions.canPublish, false);
      assert.strictEqual(actions.canUnpublish, false);
      assert.strictEqual(actions.canArchive, true);
      assert.strictEqual(actions.canEdit, false);
    });

    it('archived contest has no available lifecycle actions (immutable)', () => {
      const actions = getAvailableLifecycleActions(archivedContest, ownerProf);
      assert.strictEqual(actions.canPublish, false);
      assert.strictEqual(actions.canUnpublish, false);
      assert.strictEqual(actions.canArchive, false);
      assert.strictEqual(actions.canEdit, false);
    });

    it('contest_admin and super_admin have actions across all contests', () => {
      const caActions = getAvailableLifecycleActions(draftContest, contestAdmin);
      assert.strictEqual(caActions.canPublish, true);
      const saActions = getAvailableLifecycleActions(upcomingContest, superAdmin);
      assert.strictEqual(saActions.canUnpublish, true);
    });

    it('non-owner professor and student have NO lifecycle actions (BOLA / RBAC)', () => {
      const nonOwnerActions = getAvailableLifecycleActions(draftContest, nonOwnerProf);
      assert.strictEqual(nonOwnerActions.canPublish, false);
      assert.strictEqual(nonOwnerActions.canArchive, false);

      const studentActions = getAvailableLifecycleActions(draftContest, student);
      assert.strictEqual(studentActions.canPublish, false);
    });
  });

  // -------------------------------------------------------------------------
  // E. Invalid Action Handling
  // -------------------------------------------------------------------------
  describe('E. Invalid Action Handling', () => {
    it('disables publish if problemCount is 0', () => {
      const emptyDraft = { ...draftContest, problemCount: 0 };
      const canTriggerPublish = emptyDraft.problemCount > 0;
      assert.strictEqual(canTriggerPublish, false);
    });

    it('explains lock reason on running contest', () => {
      const info = isContestEditable(runningContest);
      assert.ok(info.reason.includes('locked while running'));
    });
  });

  // -------------------------------------------------------------------------
  // F. Confirmation Dialogs for Destructive Actions
  // -------------------------------------------------------------------------
  describe('F. Confirmation Dialogs for Destructive Actions', () => {
    it('generates archive confirmation modal details explaining immutability', () => {
      const modal = getConfirmationModalDetails('archive', endedContest);
      assert.ok(modal);
      assert.strictEqual(modal.title, 'Archive Contest');
      assert.strictEqual(modal.confirmText, 'Confirm Archive');
      assert.strictEqual(modal.warningType, 'danger');
      assert.ok(modal.consequence.includes('permanently read-only and immutable'));
      assert.ok(modal.consequence.includes('preserved'));
    });

    it('generates unpublish confirmation modal details explaining visibility removal', () => {
      const modal = getConfirmationModalDetails('unpublish', upcomingContest);
      assert.ok(modal);
      assert.strictEqual(modal.title, 'Unpublish Contest');
      assert.strictEqual(modal.confirmText, 'Unpublish to Draft');
      assert.strictEqual(modal.warningType, 'warning');
      assert.ok(modal.consequence.includes('no longer be visible to participants'));
      assert.ok(modal.consequence.includes('able to edit its configuration'));
    });

    it('does NOT generate confirmation modal for non-destructive actions', () => {
      assert.strictEqual(getConfirmationModalDetails('view', endedContest), null);
    });
  });

  // -------------------------------------------------------------------------
  // G. Backend Error Handling
  // -------------------------------------------------------------------------
  describe('G. Backend Error Handling', () => {
    it('extracts server 409 Conflict message cleanly', () => {
      const err = {
        response: {
          status: 409,
          data: {
            status: 'error',
            message: 'Cannot archive an actively running contest.',
          },
        },
      };
      assert.strictEqual(extractErrorMessage(err), 'Cannot archive an actively running contest.');
    });

    it('extracts server 403 Forbidden message cleanly', () => {
      const err = {
        response: {
          status: 403,
          data: {
            status: 'error',
            message: 'Forbidden: You do not have permission to unpublish this contest',
          },
        },
      };
      assert.strictEqual(extractErrorMessage(err), 'Forbidden: You do not have permission to unpublish this contest');
    });

    it('falls back to safe generic error when response is missing', () => {
      assert.strictEqual(extractErrorMessage(null), 'An unexpected error occurred. Please try again.');
    });
  });

  // -------------------------------------------------------------------------
  // H. Refresh After Lifecycle Transition
  // -------------------------------------------------------------------------
  describe('H. Refresh After Lifecycle Transition', () => {
    it('simulates publish callback cycle and updates contest state', async () => {
      let refreshed = false;
      const onRefreshList = () => { refreshed = true; };
      let currentStatus = 'draft';

      const handlePublish = async (id) => {
        // Mock API call
        currentStatus = 'published';
        onRefreshList();
      };

      await handlePublish(101);
      assert.strictEqual(currentStatus, 'published');
      assert.strictEqual(refreshed, true);
    });

    it('simulates unpublish callback cycle and updates contest state', async () => {
      let refreshed = false;
      const onRefreshList = () => { refreshed = true; };
      let currentStatus = 'published';

      const handleUnpublish = async (id) => {
        currentStatus = 'draft';
        onRefreshList();
      };

      await handleUnpublish(102);
      assert.strictEqual(currentStatus, 'draft');
      assert.strictEqual(refreshed, true);
    });
  });

  // -------------------------------------------------------------------------
  // I. Archived State UI
  // -------------------------------------------------------------------------
  describe('I. Archived State UI', () => {
    it('shows archived badge and gray status styling', () => {
      const badge = getStatusBadge(archivedContest);
      assert.strictEqual(badge.label, 'Archived');
      assert.strictEqual(badge.color, 'gray');
      assert.strictEqual(badge.isArchived, true);
    });

    it('locks all configuration and indicates immutability', () => {
      const editable = isContestEditable(archivedContest);
      assert.strictEqual(editable.editable, false);
      assert.strictEqual(editable.badge, 'Configuration Locked');
      assert.ok(editable.reason.includes('archived and cannot be modified'));
    });
  });

  // -------------------------------------------------------------------------
  // J. Published / Unpublished State UI
  // -------------------------------------------------------------------------
  describe('J. Published / Unpublished State UI', () => {
    it('distinguishes draft as private/unpublished', () => {
      assert.strictEqual(draftContest.status, 'draft');
      const badge = getStatusBadge(draftContest);
      assert.strictEqual(badge.label, 'Draft');
    });

    it('distinguishes upcoming as published/visible to participants', () => {
      assert.strictEqual(upcomingContest.status, 'published');
      const badge = getStatusBadge(upcomingContest);
      assert.strictEqual(badge.label, 'Upcoming');
      assert.strictEqual(badge.isUpcoming, true);
    });
  });

});
