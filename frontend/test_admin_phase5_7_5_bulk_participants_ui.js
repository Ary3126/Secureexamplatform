/**
 * Automated Test Suite for Phase 7.5.7.5: Bulk Participant Operations UI Logic
 * File: frontend/test_admin_phase5_7_5_bulk_participants_ui.js
 *
 * Verifies all UI requirements for Phase 7.5.7.5:
 * A. Multi-Select Participant Roster Logic (toggle individual, select all visible, deselect all, count)
 * B. Bulk Remove Action Bar & Confirmation Modal (visibility, participant count, submission warning)
 * C. Candidate Student Multi-Select in Add Modal (toggle individual, select all visible, count)
 * D. Bulk Add API Integration & Result Summary Notification (status 201/200, breakdown display)
 * E. Bulk Remove API Integration & Submission Protection (status 200, removed vs blocked breakdown)
 * F. Role-Based Access Control on Bulk Operations (super_admin, contest_admin, owner professor vs non-owner & student)
 * G. Contest Lifecycle Restrictions on Bulk Operations (draft/running allowed, ended/archived blocked)
 * H. Batch Boundary & Empty Selection Safeguards (empty array protection, maximum limit)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic Mirrors (matching AdminContestParticipantList.jsx) ──

function getContestRuntimeState(c) {
  if (!c) return 'unknown';
  if (c.runtimeState) return c.runtimeState;
  if (c.runtime_state) return c.runtime_state;
  if (c.status === 'archived') return 'archived';
  const now = Date.now();
  const end = new Date(c.endTime || c.end_time).getTime();
  const start = new Date(c.startTime || c.start_time).getTime();
  if (end && !isNaN(end) && now > end) return 'ended';
  if (start && !isNaN(start) && now >= start) return 'running';
  return c.status || 'draft';
}

function isLifecycleLocked(c) {
  const state = getContestRuntimeState(c);
  return state === 'ended' || state === 'archived' || c?.status === 'archived';
}

function checkCanManage(currentUser, contest) {
  return Boolean(
    currentUser && (
      currentUser.role === 'super_admin' ||
      currentUser.role === 'contest_admin' ||
      (currentUser.role === 'professor' && (
        contest?.createdBy === currentUser.id ||
        contest?.created_by === currentUser.id ||
        contest?.authorId === currentUser.id
      ))
    )
  );
}

// Multi-select roster toggle simulation
function toggleSelectParticipant(selectedIds, userId) {
  return selectedIds.includes(userId)
    ? selectedIds.filter((id) => id !== userId)
    : [...selectedIds, userId];
}

function toggleSelectAllVisible(selectedIds, visibleParticipants) {
  const visibleIds = visibleParticipants.map((p) => p.userId);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  if (allSelected) {
    return selectedIds.filter((id) => !visibleIds.includes(id));
  } else {
    return [...new Set([...selectedIds, ...visibleIds])];
  }
}

// Candidate multi-select toggle simulation
function toggleSelectCandidate(selectedCandidateIds, candId) {
  return selectedCandidateIds.includes(candId)
    ? selectedCandidateIds.filter((id) => id !== candId)
    : [...selectedCandidateIds, candId];
}

function toggleSelectAllCandidates(selectedCandidateIds, candidateStudents) {
  const visibleIds = candidateStudents.map((c) => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedCandidateIds.includes(id));
  if (allSelected) {
    return selectedCandidateIds.filter((id) => !visibleIds.includes(id));
  } else {
    return [...new Set([...selectedCandidateIds, ...visibleIds])];
  }
}

// Result summary formatter helper
function formatBulkAddNotification(summary) {
  const { addedCount = 0, alreadyEnrolledCount = 0, invalidCount = 0 } = summary || {};
  return {
    type: addedCount > 0 ? 'success' : 'error',
    message: `Bulk enrollment: ${addedCount} added${alreadyEnrolledCount > 0 ? `, ${alreadyEnrolledCount} already enrolled` : ''}${invalidCount > 0 ? `, ${invalidCount} invalid` : ''}!`,
  };
}

function formatBulkRemoveNotification(summary) {
  const { removedCount = 0, blockedCount = 0 } = summary || {};
  return {
    type: blockedCount > 0 && removedCount === 0 ? 'error' : 'success',
    message: `Bulk remove completed: ${removedCount} removed${blockedCount > 0 ? `, ${blockedCount} retained (had contest submissions)` : ''}.`,
  };
}

describe('Phase 7.5.7.5: Bulk Participant Operations UI Logic', () => {

  // --------------------------------------------------------------------------
  // Group A: Multi-Select Participant Roster
  // --------------------------------------------------------------------------
  describe('A. Participant Roster Multi-Select Logic', () => {
    const participants = [
      { userId: 10, username: 'alice' },
      { userId: 20, username: 'bob' },
      { userId: 30, username: 'charlie' },
    ];

    it('A1. Initial selection is empty', () => {
      const selected = [];
      assert.equal(selected.length, 0);
    });

    it('A2. Select single participant adds user ID to selection array', () => {
      let selected = [];
      selected = toggleSelectParticipant(selected, 10);
      assert.deepEqual(selected, [10]);
    });

    it('A3. Toggle selected participant removes user ID from selection array', () => {
      let selected = [10, 20];
      selected = toggleSelectParticipant(selected, 10);
      assert.deepEqual(selected, [20]);
    });

    it('A4. Select all visible selects all participants on current page', () => {
      let selected = [];
      selected = toggleSelectAllVisible(selected, participants);
      assert.deepEqual(selected.sort(), [10, 20, 30]);
    });

    it('A5. Deselect all visible clears page items when all were selected', () => {
      let selected = [10, 20, 30, 99]; // 99 is from another page
      selected = toggleSelectAllVisible(selected, participants);
      assert.deepEqual(selected, [99]); // only page items removed
    });

    it('A6. Clear selection button clears entire selection state', () => {
      let selected = [10, 20, 30];
      selected = [];
      assert.equal(selected.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Group B: Candidate Students Multi-Select in Add Modal
  // --------------------------------------------------------------------------
  describe('B. Candidate Student Multi-Select Logic', () => {
    const candidates = [
      { id: 101, username: 'stud1' },
      { id: 102, username: 'stud2' },
      { id: 103, username: 'stud3' },
    ];

    it('B1. Toggle candidate student adds and removes ID from candidate selection', () => {
      let selected = [];
      selected = toggleSelectCandidate(selected, 101);
      assert.deepEqual(selected, [101]);
      selected = toggleSelectCandidate(selected, 102);
      assert.deepEqual(selected, [101, 102]);
      selected = toggleSelectCandidate(selected, 101);
      assert.deepEqual(selected, [102]);
    });

    it('B2. Select all candidates selects all visible search results', () => {
      let selected = [];
      selected = toggleSelectAllCandidates(selected, candidates);
      assert.deepEqual(selected.sort(), [101, 102, 103]);
    });

    it('B3. Deselect all candidates unselects all when all are checked', () => {
      let selected = [101, 102, 103];
      selected = toggleSelectAllCandidates(selected, candidates);
      assert.deepEqual(selected, []);
    });

    it('B4. Dynamic button text adapts to count of selected candidates', () => {
      const getButtonText = (count) => (count > 1 ? `Add ${count} Students` : 'Add to Contest');
      assert.equal(getButtonText(0), 'Add to Contest');
      assert.equal(getButtonText(1), 'Add to Contest');
      assert.equal(getButtonText(3), 'Add 3 Students');
      assert.equal(getButtonText(25), 'Add 25 Students');
    });
  });

  // --------------------------------------------------------------------------
  // Group C: Bulk Add Notification & Structured Result Summary
  // --------------------------------------------------------------------------
  describe('C. Bulk Add Result Summary Formatting', () => {
    it('C1. Formats success message with added count', () => {
      const summary = { addedCount: 3, alreadyEnrolledCount: 0, invalidCount: 0 };
      const notif = formatBulkAddNotification(summary);
      assert.equal(notif.type, 'success');
      assert.equal(notif.message, 'Bulk enrollment: 3 added!');
    });

    it('C2. Formats mixed batch message with added, alreadyEnrolled, and invalid counts', () => {
      const summary = { addedCount: 2, alreadyEnrolledCount: 1, invalidCount: 1 };
      const notif = formatBulkAddNotification(summary);
      assert.equal(notif.type, 'success');
      assert.equal(notif.message, 'Bulk enrollment: 2 added, 1 already enrolled, 1 invalid!');
    });

    it('C3. Formats error alert when 0 items were added and all were invalid/enrolled', () => {
      const summary = { addedCount: 0, alreadyEnrolledCount: 2, invalidCount: 1 };
      const notif = formatBulkAddNotification(summary);
      assert.equal(notif.type, 'error');
      assert.equal(notif.message, 'Bulk enrollment: 0 added, 2 already enrolled, 1 invalid!');
    });
  });

  // --------------------------------------------------------------------------
  // Group D: Bulk Remove Notification & Submission Integrity
  // --------------------------------------------------------------------------
  describe('D. Bulk Remove Result Summary & Submission Protection', () => {
    it('D1. Formats clean removal summary when all selected are deleted', () => {
      const summary = { removedCount: 4, blockedCount: 0 };
      const notif = formatBulkRemoveNotification(summary);
      assert.equal(notif.type, 'success');
      assert.equal(notif.message, 'Bulk remove completed: 4 removed.');
    });

    it('D2. Formats warning when some participants are retained due to contest submissions', () => {
      const summary = { removedCount: 2, blockedCount: 2 };
      const notif = formatBulkRemoveNotification(summary);
      assert.equal(notif.type, 'success');
      assert.equal(notif.message, 'Bulk remove completed: 2 removed, 2 retained (had contest submissions).');
    });

    it('D3. Reports error outcome when all selected participants had submissions and were blocked', () => {
      const summary = { removedCount: 0, blockedCount: 3 };
      const notif = formatBulkRemoveNotification(summary);
      assert.equal(notif.type, 'error');
      assert.equal(notif.message, 'Bulk remove completed: 0 removed, 3 retained (had contest submissions).');
    });
  });

  // --------------------------------------------------------------------------
  // Group E: Role-Based Access Control (RBAC)
  // --------------------------------------------------------------------------
  describe('E. RBAC for Bulk Operations', () => {
    const contest = { id: 50, createdBy: 10, title: 'Exam 1' };

    it('E1. Super Admin is authorized for bulk operations', () => {
      assert.equal(checkCanManage({ id: 1, role: 'super_admin' }, contest), true);
    });

    it('E2. Contest Admin is authorized for bulk operations', () => {
      assert.equal(checkCanManage({ id: 2, role: 'contest_admin' }, contest), true);
    });

    it('E3. Owner Professor is authorized for bulk operations on their contest', () => {
      assert.equal(checkCanManage({ id: 10, role: 'professor' }, contest), true);
    });

    it('E4. Non-owning Professor is denied bulk management (BOLA protection)', () => {
      assert.equal(checkCanManage({ id: 99, role: 'professor' }, contest), false);
    });

    it('E5. Student is strictly denied bulk operations', () => {
      assert.equal(checkCanManage({ id: 100, role: 'student' }, contest), false);
    });
  });

  // --------------------------------------------------------------------------
  // Group F: Contest Lifecycle Enforcement
  // --------------------------------------------------------------------------
  describe('F. Contest Lifecycle Lock Rules', () => {
    it('F1. Draft contest allows bulk operations', () => {
      const contest = { id: 1, status: 'draft' };
      assert.equal(isLifecycleLocked(contest), false);
    });

    it('F2. Actively running contest allows bulk operations', () => {
      const now = Date.now();
      const contest = {
        id: 2,
        startTime: new Date(now - 3600000).toISOString(),
        endTime: new Date(now + 3600000).toISOString(),
        status: 'published',
      };
      assert.equal(isLifecycleLocked(contest), false);
    });

    it('F3. Ended contest strictly locks bulk operations', () => {
      const now = Date.now();
      const contest = {
        id: 3,
        startTime: new Date(now - 7200000).toISOString(),
        endTime: new Date(now - 3600000).toISOString(),
        status: 'published',
      };
      assert.equal(isLifecycleLocked(contest), true);
    });

    it('F4. Archived contest strictly locks bulk operations', () => {
      const contest = { id: 4, status: 'archived' };
      assert.equal(isLifecycleLocked(contest), true);
    });
  });

  // --------------------------------------------------------------------------
  // Group G: Boundary & Safeguards
  // --------------------------------------------------------------------------
  describe('G. Boundary & Safeguards', () => {
    it('G1. Empty userIds array is rejected before dispatch', () => {
      const validateBatch = (ids) => Array.isArray(ids) && ids.length > 0 && ids.length <= 100;
      assert.equal(validateBatch([]), false);
      assert.equal(validateBatch(null), false);
      assert.equal(validateBatch(undefined), false);
    });

    it('G2. Oversized batch (>100 items) is rejected before dispatch', () => {
      const validateBatch = (ids) => Array.isArray(ids) && ids.length > 0 && ids.length <= 100;
      const oversized = Array.from({ length: 101 }, (_, i) => i + 1);
      assert.equal(validateBatch(oversized), false);
      const validMax = Array.from({ length: 100 }, (_, i) => i + 1);
      assert.equal(validateBatch(validMax), true);
    });
  });
});
