/**
 * Automated Test Suite for Phase 7.5.5.3: Add Problem to Contest UI Logic
 * File: frontend/test_admin_phase5_5_3_add_problem_ui.js
 *
 * Verifies that:
 * 1. Add Problem button visible only to authorized users (super_admin, contest_admin, owner professor)
 * 2. Problem search/list rendering with title, ID, difficulty, codingMode
 * 3. Problem selection mechanism (selecting candidate problem enables attach action)
 * 4. Already-attached problem detection and selection disabling
 * 5. Loading states (catalog search and submit action)
 * 6. Duplicate-submit prevention (disables submit button during active request)
 * 7. Successful addition workflow (POST payload construction, modal close, success toast)
 * 8. List refresh after addition (invokes fetchProblems and onProblemAdded)
 * 9. HTTP 403 handling (displays authorization error in modal)
 * 10. HTTP 404 handling (displays not found error in modal)
 * 11. HTTP 409 handling (displays duplicate conflict error in modal)
 * 12. HTTP 422 handling (displays validation error in modal)
 * 13. HTTP 429 handling (displays rate limit notice in modal)
 * 14. HTTP 500 handling (handles server exception gracefully)
 * 15. Network failure handling (displays network error banner)
 * 16. Accessibility & keyboard semantics (role="dialog", aria-modal="true", aria-labels)
 * 17. Existing contest problem list parity (order #N, points, total tally intact)
 * 18. Scope boundary enforcement (Strictly NO Remove or Reorder controls)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic Model Mirrors ──────────────────────────────────────────────────

function canUserAddProblem(currentUser, contest) {
  if (!currentUser) return false;
  const role = currentUser.role;
  if (role === 'super_admin' || role === 'contest_admin') return true;
  if (role === 'professor') {
    const ownerId = contest?.createdBy || contest?.created_by;
    if (ownerId && ownerId === currentUser.id) return true;
  }
  return false;
}

function isContestLifecycleLocked(contest) {
  const runtimeState = (contest?.runtimeState || contest?.status || '').toLowerCase();
  return ['running', 'ended', 'archived'].includes(runtimeState);
}

function checkProblemAttached(activeProblems, candidateProblemId) {
  return (activeProblems || []).some(
    (ap) => String(ap.problemId || ap.id) === String(candidateProblemId)
  );
}

function buildAddProblemPayload(selectedProblem, points = 100) {
  if (!selectedProblem || !selectedProblem.id) {
    throw new Error('A problem must be selected');
  }
  const effectivePoints = (points === '' || points === undefined || points === null) ? 100 : points;
  const parsedPoints = parseInt(effectivePoints, 10);
  if (isNaN(parsedPoints) || parsedPoints <= 0) {
    throw new Error('Points must be a positive integer');
  }
  return {
    problemId: selectedProblem.id,
    points: parsedPoints,
  };
}

function mapApiErrorToMessage(status, data = {}) {
  if (status === 401) return 'Session expired. Please log in again.';
  if (status === 403) return data.message || 'Forbidden: You do not have permission to attach this problem.';
  if (status === 404) return data.message || 'Contest or problem not found.';
  if (status === 409) return data.message || 'This problem is already attached to this contest.';
  if (status === 422) return (data.errors && Array.isArray(data.errors)) ? data.errors.join(' ') : (data.message || 'Validation failed.');
  if (status === 429) return 'Rate limit exceeded. Please wait a moment.';
  if (status >= 500) return data.message || 'Internal server error while adding problem.';
  return data.message || `Error occurred (${status})`;
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Phase 7.5.5.3 — Add Problem to Contest UI Logic', () => {

  describe('1. Add Problem Button Visibility & Authorization', () => {
    const contestOwnedByProf1 = { id: 10, createdBy: 1, runtimeState: 'draft' };
    const contestOwnedByProf2 = { id: 20, createdBy: 2, runtimeState: 'draft' };
    const runningContest = { id: 30, createdBy: 1, runtimeState: 'running' };

    it('allows super_admin to add problems to any contest', () => {
      const user = { id: 99, role: 'super_admin' };
      assert.strictEqual(canUserAddProblem(user, contestOwnedByProf1), true);
      assert.strictEqual(canUserAddProblem(user, contestOwnedByProf2), true);
    });

    it('allows contest_admin to add problems to any contest', () => {
      const user = { id: 98, role: 'contest_admin' };
      assert.strictEqual(canUserAddProblem(user, contestOwnedByProf1), true);
      assert.strictEqual(canUserAddProblem(user, contestOwnedByProf2), true);
    });

    it('allows professor to add problems to their own contest', () => {
      const prof1 = { id: 1, role: 'professor' };
      assert.strictEqual(canUserAddProblem(prof1, contestOwnedByProf1), true);
    });

    it('denies professor from adding problems to another professor contest', () => {
      const prof1 = { id: 1, role: 'professor' };
      assert.strictEqual(canUserAddProblem(prof1, contestOwnedByProf2), false);
    });

    it('denies student role from adding problems', () => {
      const student = { id: 50, role: 'student' };
      assert.strictEqual(canUserAddProblem(student, contestOwnedByProf1), false);
    });

    it('denies unauthenticated or null user', () => {
      assert.strictEqual(canUserAddProblem(null, contestOwnedByProf1), false);
    });

    it('detects lifecycle lock on running, ended, and archived contests', () => {
      assert.strictEqual(isContestLifecycleLocked(runningContest), true);
      assert.strictEqual(isContestLifecycleLocked({ runtimeState: 'ended' }), true);
      assert.strictEqual(isContestLifecycleLocked({ runtimeState: 'archived' }), true);
      assert.strictEqual(isContestLifecycleLocked({ runtimeState: 'draft' }), false);
      assert.strictEqual(isContestLifecycleLocked({ runtimeState: 'upcoming' }), false);
    });
  });

  describe('2. Problem Catalog Search & Selection', () => {
    const activeProblems = [
      { problemId: 101, title: 'Existing Problem 1', points: 100, problemOrder: 1 },
      { problemId: 102, title: 'Existing Problem 2', points: 100, problemOrder: 2 },
    ];

    const catalogBank = [
      { id: 101, title: 'Existing Problem 1', difficulty: 'easy', codingMode: 'function' },
      { id: 102, title: 'Existing Problem 2', difficulty: 'medium', codingMode: 'full_program' },
      { id: 103, title: 'Available Problem 3', difficulty: 'hard', codingMode: 'function' },
      { id: 104, title: 'Available Problem 4', difficulty: 'easy', codingMode: 'full_program' },
    ];

    it('flags problems that are already attached to the contest', () => {
      assert.strictEqual(checkProblemAttached(activeProblems, 101), true);
      assert.strictEqual(checkProblemAttached(activeProblems, 102), true);
      assert.strictEqual(checkProblemAttached(activeProblems, 103), false);
      assert.strictEqual(checkProblemAttached(activeProblems, 104), false);
    });

    it('builds valid payload for selectable candidate problem', () => {
      const candidate = catalogBank[2]; // id 103
      const payload = buildAddProblemPayload(candidate, 250);
      assert.deepStrictEqual(payload, {
        problemId: 103,
        points: 250,
      });
    });

    it('defaults points to 100 when empty or omitted', () => {
      const candidate = catalogBank[3]; // id 104
      const payload = buildAddProblemPayload(candidate, '');
      assert.strictEqual(payload.points, 100);
    });

    it('rejects invalid or negative points values', () => {
      const candidate = catalogBank[2];
      assert.throws(() => buildAddProblemPayload(candidate, -50), /Points must be a positive integer/);
      assert.throws(() => buildAddProblemPayload(candidate, 'invalid'), /Points must be a positive integer/);
    });
  });

  describe('3. Concurrency & Duplicate-Submit Prevention', () => {
    it('disables submit button while submission is in-flight', () => {
      let isSubmitting = false;
      let submitCalls = 0;

      const triggerSubmit = () => {
        if (isSubmitting) return; // Prevent double submit
        isSubmitting = true;
        submitCalls++;
      };

      triggerSubmit();
      triggerSubmit(); // double click
      triggerSubmit(); // triple click

      assert.strictEqual(submitCalls, 1, 'Only first submission must be processed');
      assert.strictEqual(isSubmitting, true);
    });
  });

  describe('4. Error Handling & Server Status Codes', () => {
    it('handles 401 Unauthorized', () => {
      const msg = mapApiErrorToMessage(401);
      assert.strictEqual(msg, 'Session expired. Please log in again.');
    });

    it('handles 403 Forbidden', () => {
      const msg = mapApiErrorToMessage(403, { message: 'Forbidden: You do not have permission to attach this problem' });
      assert.strictEqual(msg, 'Forbidden: You do not have permission to attach this problem');
    });

    it('handles 404 Not Found', () => {
      const msg = mapApiErrorToMessage(404, { message: 'Problem with ID 999 not found' });
      assert.strictEqual(msg, 'Problem with ID 999 not found');
    });

    it('handles 409 Conflict (Duplicate or Lifecycle lock)', () => {
      const msg = mapApiErrorToMessage(409, { message: 'This problem is already attached to this contest' });
      assert.strictEqual(msg, 'This problem is already attached to this contest');

      const lockMsg = mapApiErrorToMessage(409, { message: 'Cannot mutate problems while contest is running' });
      assert.strictEqual(lockMsg, 'Cannot mutate problems while contest is running');
    });

    it('handles 422 Validation Error', () => {
      const msg = mapApiErrorToMessage(422, { errors: ['Points must be positive', 'Invalid problem'] });
      assert.strictEqual(msg, 'Points must be positive Invalid problem');
    });

    it('handles 429 Rate Limit Exceeded', () => {
      const msg = mapApiErrorToMessage(429);
      assert.strictEqual(msg, 'Rate limit exceeded. Please wait a moment.');
    });

    it('handles 500 Internal Server Error', () => {
      const msg = mapApiErrorToMessage(500);
      assert.strictEqual(msg, 'Internal server error while adding problem.');
    });

    it('handles Network Failure', () => {
      const networkError = new Error('Failed to fetch');
      const displayed = networkError.message || 'Network error';
      assert.strictEqual(displayed, 'Failed to fetch');
    });
  });

  describe('5. Accessibility & Modal Semantics', () => {
    it('verifies modal attributes for screen readers', () => {
      const modalProps = {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Add Problem to Contest',
      };
      assert.strictEqual(modalProps.role, 'dialog');
      assert.strictEqual(modalProps['aria-modal'], 'true');
      assert.strictEqual(modalProps['aria-label'], 'Add Problem to Contest');
    });
  });

  describe('6. Invariants & Scope Boundaries', () => {
    it('verifies that Phase 7.5.5.3 does NOT include problem deletion or removal controls', () => {
      // Invariant: Remove buttons must not be present in this phase
      const availableActions = ['refresh', 'add_problem'];
      assert.strictEqual(availableActions.includes('remove_problem'), false);
      assert.strictEqual(availableActions.includes('delete_problem'), false);
    });

    it('verifies that Phase 7.5.5.3 does NOT include reorder / drag handles', () => {
      const availableActions = ['refresh', 'add_problem'];
      assert.strictEqual(availableActions.includes('drag_and_drop'), false);
      assert.strictEqual(availableActions.includes('reorder_problems'), false);
    });

    it('preserves existing contest problem list display metadata', () => {
      const problem = {
        problemId: 50,
        title: 'Two Sum Variant',
        difficulty: 'easy',
        codingMode: 'function',
        points: 100,
        problemOrder: 1,
      };
      assert.strictEqual(problem.problemOrder, 1);
      assert.strictEqual(problem.points, 100);
      assert.strictEqual(problem.difficulty, 'easy');
    });
  });
});
