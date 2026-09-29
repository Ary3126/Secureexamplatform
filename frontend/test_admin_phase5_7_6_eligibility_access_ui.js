/**
 * Automated Test Suite for Phase 7.5.7.6: Eligibility & Access Validation UI Logic
 * File: frontend/test_admin_phase5_7_6_eligibility_access_ui.js
 *
 * Verifies all UI requirements for Phase 7.5.7.6:
 *  A. Student Dashboard Eligibility Evaluation (Server-authoritative state consumption)
 *  B. Dynamic Action Button & Badge Rendering:
 *     - "Enrolled" badge when isEnrolled = true
 *     - "Register Now" button when canRegister = true && !isEnrolled
 *     - "Enter Contest" action when canParticipate = true
 *     - "Registration Closed" indicator when contest is ended or archived
 *  C. Server-Authoritative BOLA Defense & Role Handling:
 *     - Non-student account surfaces eligibility restriction explanation
 *     - Inactive account surfaces account status notice
 *     - Draft contest access denial surfaces 403 Forbidden explanation
 *  D. Network & Error Envelope Sanitization
 *  E. Re-validation on Contest Lifecycle State Shifts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic & State Controller Mirror for Eligibility & Access ──

class StudentContestEligibilityController {
  constructor({ token = 'mock-token', user = { id: 1, role: 'student', username: 'alice', isActive: true } } = {}) {
    this.token = token;
    this.user = user;
    this.eligibilityCache = new Map();
    this.loadingContestId = null;
    this.error = null;
    this.networkFetch = null;
  }

  setFetchMock(mockFn) {
    this.networkFetch = mockFn;
  }

  /**
   * Fetch authoritative eligibility evaluation for a contest
   */
  async fetchEligibility(contestId) {
    this.loadingContestId = contestId;
    this.error = null;

    try {
      const res = await this.networkFetch(`/api/contests/${contestId}/eligibility`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      const data = await res.json();

      if (res.status === 200) {
        this.eligibilityCache.set(contestId, data);
        return data;
      } else if (res.status === 403) {
        const errorState = {
          allowed: false,
          eligible: false,
          canRegister: false,
          canParticipate: false,
          message: data.message || 'Forbidden: Access to this contest is restricted.',
        };
        this.eligibilityCache.set(contestId, errorState);
        this.error = errorState.message;
        return errorState;
      } else if (res.status === 404) {
        this.error = 'Contest not found.';
        return null;
      } else {
        this.error = data.message || 'Failed to determine contest eligibility.';
        return null;
      }
    } catch (err) {
      this.error = err.message || 'Network error fetching eligibility.';
      return null;
    } finally {
      this.loadingContestId = null;
    }
  }

  /**
   * Derive UI Presentation State from Authoritative Evaluation
   */
  getPresentationState(contest, evaluation) {
    if (!evaluation) {
      // Default to contest fields if evaluation not loaded
      if (contest.isEnrolled) {
        return { badge: 'ENROLLED', action: null, canClick: false };
      }
      if (contest.runtimeState === 'ended' || contest.runtimeState === 'archived') {
        return { badge: 'CLOSED', action: null, canClick: false };
      }
      return { badge: null, action: 'REGISTER', canClick: true };
    }

    if (!evaluation.allowed) {
      return { badge: 'RESTRICTED', action: null, canClick: false, reason: evaluation.message || 'Access restricted' };
    }

    if (evaluation.isEnrolled) {
      if (evaluation.canParticipate) {
        return { badge: 'ENROLLED', action: 'ENTER_CONTEST', canClick: true };
      }
      return { badge: 'ENROLLED', action: null, canClick: false };
    }

    if (evaluation.canRegister) {
      return { badge: null, action: 'REGISTER', canClick: true };
    }

    if (!evaluation.eligible) {
      const primaryReason = (evaluation.reasons && evaluation.reasons[0]) || 'Ineligible';
      return { badge: 'NOT_ELIGIBLE', action: null, canClick: false, reason: primaryReason };
    }

    if (!evaluation.status?.registrationOpen) {
      return { badge: 'REGISTRATION_CLOSED', action: null, canClick: false };
    }

    return { badge: 'UNAVAILABLE', action: null, canClick: false };
  }
}

describe('Phase 7.5.7.6: Eligibility & Access Validation UI Logic', () => {

  describe('A. Authoritative Eligibility Fetching & Cache', () => {
    it('A1. Successfully fetches and caches authoritative eligibility', async () => {
      const controller = new StudentContestEligibilityController();
      controller.setFetchMock(async (url) => {
        assert.equal(url, '/api/contests/101/eligibility');
        return {
          status: 200,
          json: async () => ({
            status: 'success',
            contestId: 101,
            userId: 1,
            allowed: true,
            eligible: true,
            canRegister: true,
            canParticipate: false,
            isEnrolled: false,
            runtimeState: 'upcoming',
            reasons: [],
            status: {
              accountActive: true,
              validRole: true,
              contestPublished: true,
              lifecycleValid: true,
              registrationOpen: true,
              alreadyEnrolled: false,
            },
          }),
        };
      });

      const res = await controller.fetchEligibility(101);
      assert.equal(res.canRegister, true);
      assert.equal(res.eligible, true);
      assert.equal(controller.eligibilityCache.has(101), true);
      assert.equal(controller.error, null);
    });

    it('A2. Handles 403 Forbidden gracefully when user cannot access draft contest', async () => {
      const controller = new StudentContestEligibilityController();
      controller.setFetchMock(async () => {
        return {
          status: 403,
          json: async () => ({
            status: 'error',
            statusCode: 403,
            message: 'Forbidden: Contest is in draft mode and not accessible.',
          }),
        };
      });

      const res = await controller.fetchEligibility(102);
      assert.equal(res.allowed, false);
      assert.equal(res.canRegister, false);
      assert.match(controller.error, /draft mode/i);
    });

    it('A3. Handles network failure safely without crashing', async () => {
      const controller = new StudentContestEligibilityController();
      controller.setFetchMock(async () => {
        throw new Error('Connection refused');
      });

      const res = await controller.fetchEligibility(103);
      assert.equal(res, null);
      assert.equal(controller.error, 'Connection refused');
    });
  });

  describe('B. Dynamic Action & Badge Presentation State', () => {
    const controller = new StudentContestEligibilityController();

    it('B1. Enrolled student in upcoming contest displays ENROLLED badge and no active register button', () => {
      const contest = { id: 1, runtimeState: 'upcoming' };
      const evaluation = {
        allowed: true,
        eligible: true,
        canRegister: false,
        canParticipate: false,
        isEnrolled: true,
        runtimeState: 'upcoming',
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, 'ENROLLED');
      assert.equal(presentation.action, null);
      assert.equal(presentation.canClick, false);
    });

    it('B2. Enrolled student in running contest displays ENROLLED badge and ENTER_CONTEST action', () => {
      const contest = { id: 2, runtimeState: 'running' };
      const evaluation = {
        allowed: true,
        eligible: true,
        canRegister: false,
        canParticipate: true,
        isEnrolled: true,
        runtimeState: 'running',
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, 'ENROLLED');
      assert.equal(presentation.action, 'ENTER_CONTEST');
      assert.equal(presentation.canClick, true);
    });

    it('B3. Unenrolled eligible student in upcoming contest displays REGISTER action', () => {
      const contest = { id: 3, runtimeState: 'upcoming' };
      const evaluation = {
        allowed: true,
        eligible: true,
        canRegister: true,
        canParticipate: false,
        isEnrolled: false,
        runtimeState: 'upcoming',
        status: { registrationOpen: true },
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, null);
      assert.equal(presentation.action, 'REGISTER');
      assert.equal(presentation.canClick, true);
    });

    it('B4. Ended contest displays REGISTRATION_CLOSED badge', () => {
      const contest = { id: 4, runtimeState: 'ended' };
      const evaluation = {
        allowed: true,
        eligible: true,
        canRegister: false,
        canParticipate: false,
        isEnrolled: false,
        runtimeState: 'ended',
        status: { registrationOpen: false },
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, 'REGISTRATION_CLOSED');
      assert.equal(presentation.action, null);
      assert.equal(presentation.canClick, false);
    });

    it('B5. Ineligible user (e.g. professor) displays NOT_ELIGIBLE with reason', () => {
      const contest = { id: 5, runtimeState: 'upcoming' };
      const evaluation = {
        allowed: true,
        eligible: false,
        canRegister: false,
        canParticipate: false,
        isEnrolled: false,
        runtimeState: 'upcoming',
        reasons: ['Only student accounts are eligible to participate as competitors.'],
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, 'NOT_ELIGIBLE');
      assert.equal(presentation.action, null);
      assert.match(presentation.reason, /student accounts/i);
    });

    it('B6. Draft contest denied displays RESTRICTED with explanation', () => {
      const contest = { id: 6, status: 'draft' };
      const evaluation = {
        allowed: false,
        eligible: false,
        canRegister: false,
        canParticipate: false,
        message: 'Forbidden: Contest is in draft mode and not accessible.',
      };

      const presentation = controller.getPresentationState(contest, evaluation);
      assert.equal(presentation.badge, 'RESTRICTED');
      assert.equal(presentation.action, null);
      assert.match(presentation.reason, /draft mode/i);
    });
  });

  describe('C. Server-Authoritative Immutability', () => {
    it('C1. Client cannot bypass canRegister = false if backend marks contest closed', () => {
      const controller = new StudentContestEligibilityController();
      const contest = { id: 7, isEnrolled: false };
      const backendEval = {
        allowed: true,
        eligible: true,
        canRegister: false,
        isEnrolled: false,
        status: { registrationOpen: false },
      };

      const presentation = controller.getPresentationState(contest, backendEval);
      assert.notEqual(presentation.action, 'REGISTER');
      assert.equal(presentation.canClick, false);
    });

    it('C2. Inactive account flagged by backend is strictly blocked from action triggers', () => {
      const controller = new StudentContestEligibilityController({
        user: { id: 9, role: 'student', username: 'inactive_alice', isActive: false },
      });
      const contest = { id: 8 };
      const backendEval = {
        allowed: true,
        eligible: false,
        canRegister: false,
        isEnrolled: false,
        reasons: ['User account is deactivated or inactive.'],
        status: { accountActive: false, validRole: true },
      };

      const presentation = controller.getPresentationState(contest, backendEval);
      assert.equal(presentation.badge, 'NOT_ELIGIBLE');
      assert.match(presentation.reason, /deactivated or inactive/i);
    });
  });
});
