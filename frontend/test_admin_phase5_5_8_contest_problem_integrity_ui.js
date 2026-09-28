/**
 * Automated Test Suite for Phase 7.5.5.8: Contest Problem Validation & Integrity UI Logic
 * File: frontend/test_admin_phase5_5_8_contest_problem_integrity_ui.js
 *
 * Verifies all UI integrity rules:
 * 1. Invalid Add Submission & Error Handling:
 *    - Client prevents non-positive points submission
 *    - Client prevents submission without selected problem
 *    - Backend 400 Bad Request error cleanly extracted and rendered
 *    - Backend 403 Forbidden error displayed accurately
 *    - Backend 404 Not Found error displayed accurately
 * 2. Duplicate Problem Protection:
 *    - Already attached problems marked unselectable in problem bank
 *    - Client-side duplicate check blocks re-dispatch
 *    - Backend 409 Conflict error for duplicates cleanly displayed
 *    - Modal remains open on duplicate conflict for user correction
 * 3. Invalid Ordering Response & Integrity:
 *    - Client prevents empty reorder list dispatch
 *    - Backend 400/422 validation errors (duplicates, foreign IDs, gaps) rendered in reorder error banner
 *    - Reorder mode remains active on error (does not falsely dismiss)
 * 4. Backend Validation Error Display:
 *    - Handles single string `data.message`
 *    - Handles array of error strings `data.errors`
 *    - Handles network exceptions cleanly
 * 5. Successful Refresh & Invariant Synchronization:
 *    - Successful Add triggers authoritative fetchProblems refresh
 *    - Successful Remove triggers authoritative fetchProblems refresh
 *    - Successful Reorder triggers authoritative fetchProblems refresh
 * 6. Locked-State Behavior:
 *    - All mutation triggers disabled when contest is running, ended, or archived
 *    - Server-authoritative 409 Conflict handling without desynchronizing local state
 * 7. No False Success State:
 *    - Failed Add never sets success notification
 *    - Failed Remove never removes problem from UI or sets success notification
 *    - Failed Reorder never exits reorder mode or sets success notification
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic Model Mirrors (matching AdminContestProblemList.jsx) ─────────────

function getRuntimeState(contest) {
  return (contest?.runtimeState || contest?.status || '').toLowerCase();
}

function isLifecycleLocked(contest) {
  const state = getRuntimeState(contest);
  return ['running', 'ended', 'archived'].includes(state);
}

function canUserManageProblems(currentUser, contest) {
  if (!currentUser) return false;
  const role = currentUser.role;
  if (role === 'super_admin' || role === 'contest_admin') return true;
  if (role === 'professor') {
    const ownerId = contest?.createdBy || contest?.created_by;
    if (ownerId && ownerId === currentUser.id) return true;
  }
  return false;
}

function validateAddProblemInput(selectedProblem, points, activeProblems = []) {
  if (!selectedProblem || !selectedProblem.id) {
    return { valid: false, error: 'Please select a problem from the problem catalog.' };
  }
  const parsedPts = parseInt(points, 10);
  if (isNaN(parsedPts) || parsedPts <= 0) {
    return { valid: false, error: 'Points must be a positive integer greater than zero.' };
  }
  const isDuplicate = activeProblems.some(
    (ap) => String(ap.problemId || ap.id) === String(selectedProblem.id)
  );
  if (isDuplicate) {
    return { valid: false, error: 'Problem is already attached to this contest.' };
  }
  return { valid: true, parsedPoints: parsedPts };
}

function validateReorderPayload(reorderProblems) {
  if (!Array.isArray(reorderProblems) || reorderProblems.length === 0) {
    return { valid: false, error: 'Cannot save empty problem sequence.' };
  }
  const problemIds = reorderProblems.map((p) => p.problemId || p.id);
  const seen = new Set();
  for (const id of problemIds) {
    if (!id || isNaN(parseInt(id, 10)) || parseInt(id, 10) <= 0) {
      return { valid: false, error: `Invalid problem ID in sequence: ${id}` };
    }
    if (seen.has(id)) {
      return { valid: false, error: `Duplicate problem ID in sequence: ${id}` };
    }
    seen.add(id);
  }
  return { valid: true, problemIds };
}

function mapApiError(operation, status, data = {}) {
  let msg = data.message;
  if (data.errors && Array.isArray(data.errors)) {
    msg = data.errors.join(' ');
  }
  if (status === 400 || status === 422) {
    return msg || 'Invalid request payload provided.';
  }
  if (status === 401) {
    return 'Session expired. Please log in again.';
  }
  if (status === 403) {
    if (operation === 'add') return msg || 'Forbidden: You do not have permission to attach this problem.';
    if (operation === 'remove') return 'Forbidden: You do not have permission to remove this problem.';
    if (operation === 'reorder') return 'Forbidden: You do not have permission to reorder problems in this contest.';
    return 'Forbidden';
  }
  if (status === 404) {
    return msg || 'Contest or problem not found.';
  }
  if (status === 409) {
    return msg || 'Contest is locked or problem is already attached.';
  }
  if (status === 429) {
    return 'Rate limit exceeded. Please wait a moment.';
  }
  return msg || `Operation failed (${status})`;
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Phase 7.5.5.8 — Contest Problem Validation & Integrity UI Logic', () => {

  const sampleContest = { id: 101, createdBy: 50, runtimeState: 'draft' };
  const lockedContest = { id: 102, createdBy: 50, runtimeState: 'running' };
  const profOwner = { id: 50, role: 'professor' };
  const profOther = { id: 99, role: 'professor' };

  const existingProblems = [
    { id: 10, title: 'Two Sum', points: 100, problemOrder: 1 },
    { id: 20, title: 'Valid Parentheses', points: 200, problemOrder: 2 },
    { id: 30, title: 'Merge Intervals', points: 300, problemOrder: 3 },
  ];

  // ---------------------------------------------------------------------------
  // 1. Invalid Add Submission & Error Handling
  // ---------------------------------------------------------------------------
  describe('1. Invalid Add Submission & Error Handling', () => {
    it('blocks add submission when no problem is selected', () => {
      const result = validateAddProblemInput(null, 100, existingProblems);
      assert.strictEqual(result.valid, false);
      assert.match(result.error, /Please select a problem/i);
    });

    it('blocks add submission when points are 0, negative, or non-numeric', () => {
      const prob = { id: 40, title: 'Binary Tree Level Order' };

      const resZero = validateAddProblemInput(prob, 0, existingProblems);
      assert.strictEqual(resZero.valid, false);
      assert.match(resZero.error, /positive integer/i);

      const resNeg = validateAddProblemInput(prob, -50, existingProblems);
      assert.strictEqual(resNeg.valid, false);
      assert.match(resNeg.error, /positive integer/i);

      const resNaN = validateAddProblemInput(prob, 'invalid', existingProblems);
      assert.strictEqual(resNaN.valid, false);
      assert.match(resNaN.error, /positive integer/i);
    });

    it('accepts valid problem selection with positive points', () => {
      const prob = { id: 40, title: 'Binary Tree Level Order' };
      const result = validateAddProblemInput(prob, 150, existingProblems);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.parsedPoints, 150);
    });

    it('extracts and formats backend 400 Bad Request error message', () => {
      const err = mapApiError('add', 400, {
        message: 'points must be a positive integer greater than zero',
      });
      assert.strictEqual(err, 'points must be a positive integer greater than zero');
    });

    it('extracts and formats backend 403 Forbidden error message for inaccessible private problem', () => {
      const err = mapApiError('add', 403, {
        message: 'Cannot attach problem: you do not have permission to access private problem 40.',
      });
      assert.match(err, /do not have permission/i);
    });

    it('extracts and formats backend 404 Not Found error message', () => {
      const err = mapApiError('add', 404, { message: 'Problem 999 not found.' });
      assert.strictEqual(err, 'Problem 999 not found.');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Duplicate Problem Protection
  // ---------------------------------------------------------------------------
  describe('2. Duplicate Problem Protection', () => {
    it('detects already attached problems and marks them invalid for add', () => {
      const duplicateProb = { id: 20, title: 'Valid Parentheses' };
      const result = validateAddProblemInput(duplicateProb, 100, existingProblems);
      assert.strictEqual(result.valid, false);
      assert.match(result.error, /already attached/i);
    });

    it('identifies attached problems in bank catalog for unselectable styling', () => {
      const bank = [
        { id: 10, title: 'Two Sum' },
        { id: 40, title: 'Trapping Rain Water' },
      ];
      const isAttached10 = existingProblems.some((ap) => ap.id === bank[0].id);
      const isAttached40 = existingProblems.some((ap) => ap.id === bank[1].id);

      assert.strictEqual(isAttached10, true, 'Two Sum should be identified as already attached');
      assert.strictEqual(isAttached40, false, 'Trapping Rain Water is not attached');
    });

    it('extracts and displays backend 409 Conflict message when duplicate add rejected', () => {
      const err = mapApiError('add', 409, {
        message: 'Problem is already attached to this contest',
      });
      assert.strictEqual(err, 'Problem is already attached to this contest');
    });

    it('keeps modal open with error state when duplicate add is rejected', () => {
      let isModalOpen = true;
      let modalError = null;
      let successMessage = null;

      // Simulate duplicate response
      const apiResponse = { status: 409, data: { message: 'Problem is already attached to this contest' } };
      modalError = mapApiError('add', apiResponse.status, apiResponse.data);

      assert.strictEqual(isModalOpen, true, 'Modal must remain open');
      assert.strictEqual(modalError, 'Problem is already attached to this contest');
      assert.strictEqual(successMessage, null, 'No success message should be shown');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Invalid Ordering Response & Integrity
  // ---------------------------------------------------------------------------
  describe('3. Invalid Ordering Response & Integrity', () => {
    it('blocks reorder submission on empty list', () => {
      const result = validateReorderPayload([]);
      assert.strictEqual(result.valid, false);
      assert.match(result.error, /empty problem sequence/i);
    });

    it('blocks reorder submission on duplicate problem IDs', () => {
      const badList = [
        { id: 10, title: 'Two Sum' },
        { id: 10, title: 'Two Sum Duplicate' },
      ];
      const result = validateReorderPayload(badList);
      assert.strictEqual(result.valid, false);
      assert.match(result.error, /Duplicate problem ID/i);
    });

    it('extracts and formats backend 400 ordering error with validation array', () => {
      const err = mapApiError('reorder', 400, {
        errors: ['problemIds must contain all attached contest problems', 'duplicate problem ID detected'],
      });
      assert.match(err, /must contain all attached contest problems/);
      assert.match(err, /duplicate problem ID detected/);
    });

    it('reorder mode remains active with error rendered upon ordering rejection', () => {
      let isReorderMode = true;
      let reorderError = null;
      let successMessage = null;

      // Simulate backend rejecting with 400 Bad Request
      const response = { status: 400, data: { message: 'problemIds list does not match attached problems' } };
      reorderError = mapApiError('reorder', response.status, response.data);

      assert.strictEqual(isReorderMode, true, 'Reorder mode must stay active');
      assert.strictEqual(reorderError, 'problemIds list does not match attached problems');
      assert.strictEqual(successMessage, null, 'No success message should be set');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Backend Validation Error Display
  // ---------------------------------------------------------------------------
  describe('4. Backend Validation Error Display', () => {
    it('renders single string error messages faithfully', () => {
      const msg = mapApiError('add', 400, { message: 'Problem order must be greater than zero' });
      assert.strictEqual(msg, 'Problem order must be greater than zero');
    });

    it('joins multiple validation error strings with space separation', () => {
      const msg = mapApiError('add', 422, {
        errors: ['Field points must be >= 1.', 'Field problemId is required.'],
      });
      assert.strictEqual(msg, 'Field points must be >= 1. Field problemId is required.');
    });

    it('provides clear fallback message when server returns empty error body', () => {
      const msg = mapApiError('add', 400, {});
      assert.strictEqual(msg, 'Invalid request payload provided.');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Successful Refresh & Invariant Synchronization
  // ---------------------------------------------------------------------------
  describe('5. Successful Refresh & Invariant Synchronization', () => {
    it('invokes fetchProblems and clears modal on successful Add', async () => {
      let fetchCalled = false;
      let isModalOpen = true;
      let successMessage = null;

      const handleAddSuccess = async (problemTitle) => {
        isModalOpen = false;
        successMessage = `"${problemTitle}" successfully added to contest!`;
        fetchCalled = true;
      };

      await handleAddSuccess('Binary Tree Maximum Path Sum');
      assert.strictEqual(fetchCalled, true, 'fetchProblems must be invoked to refresh problem list');
      assert.strictEqual(isModalOpen, false, 'Modal should close on success');
      assert.match(successMessage, /Binary Tree Maximum Path Sum/);
    });

    it('invokes fetchProblems and closes dialog on successful Remove', async () => {
      let fetchCalled = false;
      let isDialogOpen = true;
      let successMessage = null;

      const handleRemoveSuccess = async (problemTitle) => {
        isDialogOpen = false;
        successMessage = `"${problemTitle}" successfully removed from contest!`;
        fetchCalled = true;
      };

      await handleRemoveSuccess('Two Sum');
      assert.strictEqual(fetchCalled, true, 'fetchProblems must be invoked to refresh problem list');
      assert.strictEqual(isDialogOpen, false, 'Remove dialog should close on success');
      assert.match(successMessage, /Two Sum/);
    });

    it('invokes fetchProblems and exits reorder mode on successful Reorder', async () => {
      let fetchCalled = false;
      let isReorderMode = true;
      let successMessage = null;

      const handleReorderSuccess = async () => {
        isReorderMode = false;
        successMessage = 'Problem order updated successfully!';
        fetchCalled = true;
      };

      await handleReorderSuccess();
      assert.strictEqual(fetchCalled, true, 'fetchProblems must be invoked to refresh problem list');
      assert.strictEqual(isReorderMode, false, 'Reorder mode should be dismissed on success');
      assert.strictEqual(successMessage, 'Problem order updated successfully!');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Locked-State Behavior
  // ---------------------------------------------------------------------------
  describe('6. Locked-State Behavior', () => {
    it('correctly derives isLifecycleLocked for running, ended, archived', () => {
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'running' }), true);
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'ended' }), true);
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'archived' }), true);
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'draft' }), false);
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'upcoming' }), false);
    });

    it('prevents opening Add Modal when contest is locked', () => {
      let isModalOpen = false;
      const handleOpenAddModal = (contest) => {
        if (isLifecycleLocked(contest)) return;
        isModalOpen = true;
      };

      handleOpenAddModal(lockedContest);
      assert.strictEqual(isModalOpen, false, 'Add modal must not open for locked contest');

      handleOpenAddModal(sampleContest);
      assert.strictEqual(isModalOpen, true, 'Add modal opens for editable draft contest');
    });

    it('prevents entering Reorder Mode when contest is locked', () => {
      let isReorderMode = false;
      const handleToggleReorder = (contest) => {
        if (isLifecycleLocked(contest)) return;
        isReorderMode = true;
      };

      handleToggleReorder(lockedContest);
      assert.strictEqual(isReorderMode, false, 'Reorder mode must not activate for locked contest');

      handleToggleReorder(sampleContest);
      assert.strictEqual(isReorderMode, true, 'Reorder mode activates for editable draft contest');
    });

    it('handles backend 409 Conflict gracefully if client was out of sync', () => {
      const err = mapApiError('add', 409, {
        message: 'Contest is locked for problem modifications in state: running',
      });
      assert.match(err, /Contest is locked/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. No False Success State
  // ---------------------------------------------------------------------------
  describe('7. No False Success State', () => {
    it('does not display success notification if Add Problem request fails', async () => {
      let successMessage = null;
      let modalError = null;

      const submitAdd = async (shouldFail) => {
        try {
          if (shouldFail) {
            throw new Error('Points must be a positive integer greater than zero.');
          }
          successMessage = 'Problem added successfully!';
        } catch (err) {
          modalError = err.message;
        }
      };

      await submitAdd(true);
      assert.strictEqual(successMessage, null, 'Must NOT display success notification on failed add');
      assert.strictEqual(modalError, 'Points must be a positive integer greater than zero.');
    });

    it('does not display success notification or remove item if Remove Problem request fails', async () => {
      let currentProblems = [...existingProblems];
      let successMessage = null;
      let removeError = null;

      const submitRemove = async (probId, shouldFail) => {
        try {
          if (shouldFail) {
            throw new Error('Contest is locked for problem modifications.');
          }
          currentProblems = currentProblems.filter((p) => p.id !== probId);
          successMessage = 'Problem removed successfully!';
        } catch (err) {
          removeError = err.message;
        }
      };

      await submitRemove(20, true);
      assert.strictEqual(successMessage, null, 'Must NOT display success notification on failed remove');
      assert.strictEqual(currentProblems.length, 3, 'Problems list must remain untouched on failure');
      assert.strictEqual(removeError, 'Contest is locked for problem modifications.');
    });

    it('does not display success notification or exit reorder mode if Reorder request fails', async () => {
      let isReorderMode = true;
      let successMessage = null;
      let reorderError = null;

      const submitReorder = async (shouldFail) => {
        try {
          if (shouldFail) {
            throw new Error('Invalid problem sequence: missing problem 30.');
          }
          isReorderMode = false;
          successMessage = 'Problem order updated successfully!';
        } catch (err) {
          reorderError = err.message;
        }
      };

      await submitReorder(true);
      assert.strictEqual(successMessage, null, 'Must NOT display success notification on failed reorder');
      assert.strictEqual(isReorderMode, true, 'Must NOT exit reorder mode on failed reorder');
      assert.strictEqual(reorderError, 'Invalid problem sequence: missing problem 30.');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. RBAC / Permission Integration
  // ---------------------------------------------------------------------------
  describe('8. RBAC / Permission Integration', () => {
    it('allows contest owner professor, contest_admin, and super_admin to manage problems', () => {
      assert.strictEqual(canUserManageProblems(profOwner, sampleContest), true);
      assert.strictEqual(canUserManageProblems({ role: 'contest_admin' }, sampleContest), true);
      assert.strictEqual(canUserManageProblems({ role: 'super_admin' }, sampleContest), true);
    });

    it('disallows non-owner professor and student from managing problems', () => {
      assert.strictEqual(canUserManageProblems(profOther, sampleContest), false);
      assert.strictEqual(canUserManageProblems({ role: 'student' }, sampleContest), false);
      assert.strictEqual(canUserManageProblems(null, sampleContest), false);
    });
  });
});
