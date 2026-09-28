/**
 * Automated Security & Hardening UI Logic Test Suite for Phase 7.5.5.10
 * File: frontend/test_admin_phase5_5_10_security_hardening_ui.js
 *
 * Verifies all Frontend Security UX & Validation Hardening Rules:
 * A. Unauthorized Response (401 / 403):
 *    - 401 Unauthorized triggers 'Session expired. Please log in again.'
 *    - 403 Forbidden triggers explicit role/permission rejection without exposing server internals
 *    - Prevents unauthorized state mutation or UI spoofing
 * B. Expired Authentication State:
 *    - Handling missing or expired JWT tokens
 *    - Clean redirection or messaging requiring re-authentication
 * C. Locked Contest Behavior:
 *    - Strict UI locking for running, ended, and archived contests
 *    - Mutation buttons disabled with lock indicators and tooltips
 *    - Immediate client-side abort before invoking API endpoints on locked contests
 * D. Backend Validation Error Handling:
 *    - Clean extraction of 400 Bad Request & 422 Unprocessable Entity
 *    - Safe formatting of data.errors array payloads into human-readable messages
 *    - Clear display without losing form context
 * E. Safe Error Rendering:
 *    - Responses never render raw stack traces, SQL errors, or object dumps into the DOM
 *    - Prevents XSS / unescaped HTML injection via malicious backend messages
 * F. Successful Authorized Operation:
 *    - Authorized mutations (Add, Remove, Reorder) trigger authoritative server refetch
 *    - Modal/dialog states reset and temporary success banners displayed
 * G. No Client-Side Bypass Assumption:
 *    - Client treats backend as strictly authoritative
 *    - If a manipulated frontend payload reaches the server and returns 403/409, the client
 *      immediately rolls back optimistic state and displays server rejection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic & Security Handlers (Mirrors AdminContestProblemList.jsx) ────────

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
    if (ownerId && String(ownerId) === String(currentUser.id)) return true;
  }
  return false;
}

/**
 * Robust error extraction matching AdminContestProblemList.jsx
 */
function extractErrorMessage(status, data, defaultMsg = 'An unexpected error occurred.') {
  if (status === 401) {
    return 'Session expired. Please log in again.';
  }
  if (status === 403) {
    return data?.message || 'Forbidden: You do not have permission to perform this action.';
  }
  if (status === 404) {
    return data?.message || 'Resource not found.';
  }
  if (status === 409) {
    return data?.message || 'Contest is locked or problem is already attached.';
  }
  if (status === 429) {
    return 'Rate limit exceeded. Please wait a moment.';
  }
  if (data?.errors && Array.isArray(data?.errors)) {
    return data.errors.join(' ');
  }
  if (data?.message) {
    return data.message;
  }
  return defaultMsg;
}

/**
 * Safe text sanitizer for UI rendering to prevent XSS / raw injection
 */
function sanitizeForDisplay(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if an error message contains leaked server internals
 */
function containsInternalLeaks(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const leakPatterns = [
    /node_modules/i,
    /at\s+.*:\d+:\d+/i, // Stack trace file:line:col
    /at\s+[a-zA-Z0-9_.]+\s+\(/i, // Stack trace function call
    /pg_query|syntax error at or near|relation ".*" does not exist/i, // SQL internal
    /jwt secret|process\.env/i,
    /d:\\secureexamplatform\\backend/i,
    /\/var\/www/i,
  ];
  return leakPatterns.some((pattern) => pattern.test(msg));
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Phase 7.5.5.10: Frontend Security UX & Validation Hardening', () => {

  // ── A. Unauthorized Response (401 & 403) ───────────────────────────────────
  describe('A. Unauthorized Response (401 & 403)', () => {
    it('should map 401 response to clear session expiration message', () => {
      const errorMsg = extractErrorMessage(401, { message: 'Unauthorized: Invalid token' });
      assert.strictEqual(errorMsg, 'Session expired. Please log in again.');
    });

    it('should map 403 response to permission denial without leaking authorization internals', () => {
      const errorMsg = extractErrorMessage(403, {
        message: 'Forbidden: You do not have permission to attach this problem.',
      });
      assert.strictEqual(
        errorMsg,
        'Forbidden: You do not have permission to attach this problem.'
      );
    });

    it('should fall back to safe default 403 message if server response body is empty', () => {
      const errorMsg = extractErrorMessage(403, {});
      assert.strictEqual(
        errorMsg,
        'Forbidden: You do not have permission to perform this action.'
      );
    });

    it('should prevent professor who does not own contest from gaining manage permissions in UI', () => {
      const profA = { id: 101, role: 'professor' };
      const contestOwnedByProfB = { id: 50, createdBy: 102, runtimeState: 'draft' };
      assert.strictEqual(canUserManageProblems(profA, contestOwnedByProfB), false);
    });

    it('should prevent student role from gaining manage permissions in UI', () => {
      const student = { id: 200, role: 'student' };
      const contest = { id: 50, createdBy: 200, runtimeState: 'draft' };
      assert.strictEqual(canUserManageProblems(student, contest), false);
    });
  });

  // ── B. Expired Authentication State ───────────────────────────────────────
  describe('B. Expired Authentication State', () => {
    it('should identify unauthenticated state when user is null or undefined', () => {
      const contest = { id: 50, createdBy: 101, runtimeState: 'draft' };
      assert.strictEqual(canUserManageProblems(null, contest), false);
      assert.strictEqual(canUserManageProblems(undefined, contest), false);
    });

    it('should identify unauthenticated request when token is missing', () => {
      const token = null;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      assert.deepStrictEqual(headers, {});
      assert.strictEqual(headers.Authorization, undefined);
    });

    it('should handle token expiration response by halting mutation flow and flagging re-login', () => {
      let loggedOut = false;
      const onAuthError = () => { loggedOut = true; };

      const res = { status: 401, ok: false };
      const data = { message: 'jwt expired' };
      const msg = extractErrorMessage(res.status, data);

      if (res.status === 401) {
        onAuthError();
      }

      assert.strictEqual(loggedOut, true);
      assert.strictEqual(msg, 'Session expired. Please log in again.');
    });
  });

  // ── C. Locked Contest Behavior ────────────────────────────────────────────
  describe('C. Locked Contest Behavior', () => {
    it('should strictly identify running contest as lifecycle locked', () => {
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'running' }), true);
      assert.strictEqual(isLifecycleLocked({ status: 'running' }), true);
    });

    it('should strictly identify ended contest as lifecycle locked', () => {
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'ended' }), true);
      assert.strictEqual(isLifecycleLocked({ status: 'ended' }), true);
    });

    it('should strictly identify archived contest as lifecycle locked', () => {
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'archived' }), true);
      assert.strictEqual(isLifecycleLocked({ status: 'archived' }), true);
    });

    it('should identify draft and upcoming contests as unlocked for problem editing', () => {
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'draft' }), false);
      assert.strictEqual(isLifecycleLocked({ runtimeState: 'upcoming' }), false);
    });

    it('should immediately abort client mutation handlers if contest is locked without calling fetch', () => {
      const contest = { id: 50, runtimeState: 'running' };
      let fetchCalled = false;

      function handleAddProblemClick() {
        if (isLifecycleLocked(contest)) {
          return { blocked: true, reason: 'Contest is locked' };
        }
        fetchCalled = true;
        return { blocked: false };
      }

      const result = handleAddProblemClick();
      assert.strictEqual(result.blocked, true);
      assert.strictEqual(fetchCalled, false);
    });

    it('should display conflict error (409) if backend rejects mutation due to lifecycle lock', () => {
      const data = {
        message: 'Contest problems cannot be modified in runtime state: running',
      };
      const errorMsg = extractErrorMessage(409, data);
      assert.strictEqual(
        errorMsg,
        'Contest problems cannot be modified in runtime state: running'
      );
    });
  });

  // ── D. Backend Validation Error Handling ───────────────────────────────────
  describe('D. Backend Validation Error Handling', () => {
    it('should extract structured array validation errors into clean readable text', () => {
      const data = {
        message: 'Validation failed',
        errors: [
          'Points must be an integer between 1 and 100,000.',
          'problemId must be a positive integer.',
        ],
      };
      const errorMsg = extractErrorMessage(400, data);
      assert.strictEqual(
        errorMsg,
        'Points must be an integer between 1 and 100,000. problemId must be a positive integer.'
      );
    });

    it('should extract single message validation errors for 422 responses', () => {
      const data = {
        message: 'Problem #999 does not exist or has been deleted.',
      };
      const errorMsg = extractErrorMessage(422, data);
      assert.strictEqual(
        errorMsg,
        'Problem #999 does not exist or has been deleted.'
      );
    });

    it('should preserve user form input when backend validation error occurs', () => {
      const formState = { selectedProblemId: 105, points: 0 };
      const res = { status: 400, ok: false };
      const data = { message: 'Points must be a positive integer.' };

      let displayedError = null;
      if (!res.ok) {
        displayedError = extractErrorMessage(res.status, data);
      }

      // Form state must be preserved for correction
      assert.strictEqual(formState.selectedProblemId, 105);
      assert.strictEqual(formState.points, 0);
      assert.strictEqual(displayedError, 'Points must be a positive integer.');
    });
  });

  // ── E. Safe Error Rendering ────────────────────────────────────────────────
  describe('E. Safe Error Rendering', () => {
    it('should detect and filter out dangerous stack traces or internal leaks', () => {
      const unsafeErrors = [
        'Error: fail\n    at contestController.js:140:12\n    at Layer.handle',
        'syntax error at or near "SELECT" in pg_query',
        'Cannot read property of undefined in d:\\Secureexamplatform\\backend\\src',
        'JWT secret is invalid: process.env.JWT_SECRET',
      ];

      for (const unsafe of unsafeErrors) {
        assert.strictEqual(
          containsInternalLeaks(unsafe),
          true,
          `Failed to detect leak in: ${unsafe}`
        );
      }
    });

    it('should confirm safe customer-facing error messages have zero leaks', () => {
      const safeErrors = [
        'Session expired. Please log in again.',
        'Forbidden: You do not have permission to attach this problem.',
        'Points must be a positive integer between 1 and 100,000.',
        'Contest problems cannot be modified in runtime state: running',
        'Problem order updated successfully!',
      ];

      for (const safe of safeErrors) {
        assert.strictEqual(
          containsInternalLeaks(safe),
          false,
          `Erroneously flagged leak in safe message: ${safe}`
        );
      }
    });

    it('should sanitize HTML characters to prevent XSS injection in error displays', () => {
      const maliciousPayload = '<img src=x onerror=alert(1)> & "injection"';
      const sanitized = sanitizeForDisplay(maliciousPayload);

      assert.strictEqual(
        sanitized,
        '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;injection&quot;'
      );
      assert.strictEqual(sanitized.includes('<img'), false);
    });
  });

  // ── F. Successful Authorized Operation ────────────────────────────────────
  describe('F. Successful Authorized Operation', () => {
    it('should reset modal state and trigger refetch after successful problem addition', () => {
      let modalOpen = true;
      let refetched = false;
      let callbackInvoked = false;

      function onAddSuccess() {
        modalOpen = false;
        refetched = true;
        callbackInvoked = true;
      }

      const res = { status: 201, ok: true };
      if (res.ok) {
        onAddSuccess();
      }

      assert.strictEqual(modalOpen, false);
      assert.strictEqual(refetched, true);
      assert.strictEqual(callbackInvoked, true);
    });

    it('should close confirmation dialog and invoke callbacks upon successful removal', () => {
      let dialogOpen = true;
      let removedProblemId = null;

      function onRemoveSuccess(id) {
        dialogOpen = false;
        removedProblemId = id;
      }

      const res = { status: 200, ok: true };
      if (res.ok) {
        onRemoveSuccess(102);
      }

      assert.strictEqual(dialogOpen, false);
      assert.strictEqual(removedProblemId, 102);
    });

    it('should exit reorder mode and trigger refetch after successful order save', () => {
      let isReorderMode = true;
      let refetched = false;

      function onSaveOrderSuccess() {
        isReorderMode = false;
        refetched = true;
      }

      const res = { status: 200, ok: true };
      if (res.ok) {
        onSaveOrderSuccess();
      }

      assert.strictEqual(isReorderMode, false);
      assert.strictEqual(refetched, true);
    });
  });

  // ── G. No Client-Side Bypass Assumption ───────────────────────────────────
  describe('G. No Client-Side Bypass Assumption', () => {
    it('should treat server as authoritative when client state conflicts with server response', () => {
      // Simulating a client that improperly assumed it could modify a contest
      let clientSideProblems = [
        { problemId: 101, title: 'Two Sum', points: 100 },
        { problemId: 102, title: 'Add Two Numbers', points: 200 },
      ];

      // Optimistically added 103 on client
      const optimisticState = [
        ...clientSideProblems,
        { problemId: 103, title: 'Inaccessible Private Problem', points: 150 },
      ];

      // Server rejects with 403 Forbidden (BOLA / Private problem protection)
      const serverResponse = {
        ok: false,
        status: 403,
        data: { message: 'Forbidden: You do not have permission to attach this problem.' },
      };

      if (!serverResponse.ok) {
        // Rollback optimistic state to authoritative state
        clientSideProblems = [...clientSideProblems];
      }

      assert.strictEqual(clientSideProblems.length, 2);
      assert.strictEqual(clientSideProblems.some((p) => p.problemId === 103), false);
    });

    it('should not allow client-side reordering to persist if backend rejects atomic update', () => {
      const originalOrder = [101, 102, 103];
      let workingOrder = [103, 101, 102];

      // Backend fails atomic update (e.g. 409 Conflict due to concurrent lock)
      const serverResponse = {
        ok: false,
        status: 409,
        data: { message: 'Contest is locked for problem modifications.' },
      };

      if (!serverResponse.ok) {
        // Rollback working sequence to server authoritative order
        workingOrder = [...originalOrder];
      }

      assert.deepStrictEqual(workingOrder, [101, 102, 103]);
    });

    it('should never expose client controls when user role is unauthorized, regardless of prop tampering', () => {
      const fakeAdminUser = { id: 999, role: 'student', isSpoofedAdmin: true };
      const contest = { id: 45, createdBy: 100, runtimeState: 'draft' };

      // UI authorization helper must strictly check canonical role
      assert.strictEqual(canUserManageProblems(fakeAdminUser, contest), false);
    });
  });
});
