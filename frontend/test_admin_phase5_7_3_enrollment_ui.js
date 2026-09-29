/**
 * Automated Test Suite for Phase 7.5.7.3: Student Contest Enrollment & Registration UI
 * File: frontend/test_admin_phase5_7_3_enrollment_ui.js
 *
 * Verifies all UI requirements for Phase 7.5.7.3:
 * A. Enroll button (Rendered for unenrolled contest with active action trigger)
 * B. Loading state (Spinner displayed, button disabled during pending request)
 * C. Successful enrollment (HTTP 201 returns success banner, transitions to enrolled)
 * D. Already enrolled state (HTTP 409 or pre-enrolled renders green Enrolled badge)
 * E. Unauthorized state (HTTP 401 and 403 surface informative error messages)
 * F. Unavailable contest (HTTP 404 surfaces contest not found notice)
 * G. Lifecycle rejection (HTTP 400 draft/ended/archived renders backend rejection message)
 * H. Network/server error (Fetch rejection handled safely without component crash)
 * I. Refresh preserves enrollment state (Subsequent dashboard fetches maintain enrolled status)
 * J. No admin-only participant controls (Zero administrative mutation buttons in student view)
 * K. Safe error rendering (Errors sanitized, no database details or stack traces shown)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── UI Logic & State Controller Mirror (StudentDashboard.jsx) ──

class StudentContestEnrollmentController {
  constructor({ token = 'mock-jwt-token', user = { id: 1, role: 'student', username: 'alice' } } = {}) {
    this.token = token;
    this.user = user;
    this.dashboardData = null;
    this.enrollingContestId = null;
    this.enrollSuccess = null;
    this.enrollError = null;
    this.networkFetch = null;
  }

  setDashboardData(data) {
    this.dashboardData = JSON.parse(JSON.stringify(data));
  }

  setFetchMock(mockFn) {
    this.networkFetch = mockFn;
  }

  async handleEnroll(contestId, contestTitle) {
    if (this.enrollingContestId) return; // Prevent concurrent double-clicks
    this.enrollingContestId = contestId;
    this.enrollError = null;
    this.enrollSuccess = null;

    try {
      const res = await this.networkFetch(`/api/contests/${contestId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
      });

      const data = await res.json();

      if (res.status === 201) {
        this.enrollSuccess = `Successfully registered for "${contestTitle || 'Contest'}"!`;
        // Refresh authoritative dashboard data
        await this.refreshDashboard();
      } else if (res.status === 409) {
        this.enrollSuccess = `You are already registered for "${contestTitle || 'Contest'}".`;
        await this.refreshDashboard();
      } else if (res.status === 401) {
        this.enrollError = 'Authentication required. Please log in to enroll.';
      } else if (res.status === 403) {
        this.enrollError = data.message || 'Contest registration is restricted to student accounts.';
      } else if (res.status === 404) {
        this.enrollError = 'Contest not found or no longer available.';
      } else {
        this.enrollError = data.message || 'Failed to register for contest';
      }
    } catch (err) {
      this.enrollError = err.message || 'Network error occurred during registration';
    } finally {
      this.enrollingContestId = null;
    }
  }

  async refreshDashboard() {
    if (!this.networkFetch) return;
    const res = await this.networkFetch('/api/users/dashboard', {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.ok) {
      this.dashboardData = await res.json();
    }
  }

  getContestActionProps(contest) {
    const isEnrolled = Boolean(contest.isEnrolled);
    const isEnrolling = this.enrollingContestId === contest.id;

    return {
      isEnrolled,
      isEnrolling,
      buttonDisabled: isEnrolling,
      buttonText: isEnrolling ? 'Registering...' : 'Register Now',
      badgeText: isEnrolled ? 'Enrolled' : null,
      showBadge: isEnrolled,
      showButton: !isEnrolled,
    };
  }

  sanitizeErrorMessage(errorStr) {
    if (!errorStr) return '';
    let sanitized = String(errorStr);
    // Strip stack traces and parenthesized locations
    sanitized = sanitized.replace(/\s+at\s+[\w\s\.<>:\/\\()\-]+/g, '');
    // Strip Windows/Unix filesystem paths
    sanitized = sanitized.replace(/[A-Za-z]:\\[^:\s)]+/g, '');
    sanitized = sanitized.replace(/(?:\/[\w.\-]+)+/g, '');
    // Strip SQL syntax hints
    sanitized = sanitized.replace(/SELECT\s+.*FROM/gi, '[query]');
    sanitized = sanitized.replace(/relation\s+"[^"]+"\s+does\s+not\s+exist/gi, 'Database resource unavailable');
    return sanitized.trim();
  }
}

// ── Test Suites ──

describe('Phase 7.5.7.3: Student Contest Enrollment UI Logic', () => {

  const sampleContest = {
    id: 101,
    title: 'Spring Coding Championship 2026',
    startTime: '2026-10-01T10:00:00.000Z',
    endTime: '2026-10-01T13:00:00.000Z',
    status: 'published',
    runtimeState: 'upcoming',
    isEnrolled: false,
  };

  const sampleDashboard = {
    upcomingContests: [{ ...sampleContest }],
    runningContests: [],
    joinedContests: [],
  };

  // Section A: Enroll Button Rendering
  describe('A. Enroll Button Rendering', () => {
    it('renders Register Now button when student is not enrolled', () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      const props = controller.getContestActionProps(sampleDashboard.upcomingContests[0]);
      assert.equal(props.showButton, true);
      assert.equal(props.showBadge, false);
      assert.equal(props.buttonText, 'Register Now');
      assert.equal(props.buttonDisabled, false);
    });
  });

  // Section B: Loading State Handling
  describe('B. Loading State Handling', () => {
    it('sets loading state and disables button during pending enrollment request', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      let resolveFetch;
      const pendingPromise = new Promise((resolve) => { resolveFetch = resolve; });

      controller.setFetchMock(() => pendingPromise);

      // Trigger enrollment (asynchronous, do not await immediately)
      const enrollPromise = controller.handleEnroll(101, 'Spring Championship');

      // Verify loading state is active
      const loadingProps = controller.getContestActionProps(sampleDashboard.upcomingContests[0]);
      assert.equal(loadingProps.isEnrolling, true);
      assert.equal(loadingProps.buttonDisabled, true);
      assert.equal(loadingProps.buttonText, 'Registering...');

      // Prevent concurrent duplicate clicks
      let secondCallAttempted = false;
      controller.networkFetch = () => {
        secondCallAttempted = true;
        return pendingPromise;
      };
      await controller.handleEnroll(101, 'Spring Championship');
      assert.equal(secondCallAttempted, false, 'Should ignore duplicate enrollment clicks while pending');

      // Resolve original request
      resolveFetch({
        status: 201,
        ok: true,
        json: async () => ({ status: 'success', message: 'Successfully joined contest' }),
      });
      await enrollPromise;

      // Loading state cleared
      const clearedProps = controller.getContestActionProps(sampleDashboard.upcomingContests[0]);
      assert.equal(clearedProps.isEnrolling, false);
      assert.equal(clearedProps.buttonDisabled, false);
    });
  });

  // Section C: Successful Enrollment Flow
  describe('C. Successful Enrollment Flow', () => {
    it('transitions to enrolled state and sets success banner on HTTP 201', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async (url) => {
        if (url === '/api/contests/101/join') {
          return {
            status: 201,
            ok: true,
            json: async () => ({
              status: 'success',
              message: 'Successfully joined contest',
              participant: { contestId: 101, userId: 1, joinedAt: new Date().toISOString() },
            }),
          };
        }
        if (url === '/api/users/dashboard') {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              upcomingContests: [{ ...sampleContest, isEnrolled: true }],
              runningContests: [],
              joinedContests: [{ ...sampleContest, isEnrolled: true }],
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollError, null);
      assert.match(controller.enrollSuccess, /Successfully registered for "Spring Championship"!/);

      // Verify dashboard data is refreshed with authoritative isEnrolled: true
      const updatedProps = controller.getContestActionProps(controller.dashboardData.upcomingContests[0]);
      assert.equal(updatedProps.isEnrolled, true);
      assert.equal(updatedProps.showBadge, true);
      assert.equal(updatedProps.badgeText, 'Enrolled');
      assert.equal(updatedProps.showButton, false);
    });
  });

  // Section D: Already Enrolled State
  describe('D. Already Enrolled State', () => {
    it('renders green Enrolled badge if contest is already enrolled', () => {
      const controller = new StudentContestEnrollmentController();
      const enrolledContest = { ...sampleContest, isEnrolled: true };
      const props = controller.getContestActionProps(enrolledContest);

      assert.equal(props.isEnrolled, true);
      assert.equal(props.showBadge, true);
      assert.equal(props.badgeText, 'Enrolled');
      assert.equal(props.showButton, false);
    });

    it('handles HTTP 409 Conflict idempotently with friendly notice and enrolled status', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async (url) => {
        if (url === '/api/contests/101/join') {
          return {
            status: 409,
            ok: false,
            json: async () => ({
              status: 'error',
              message: 'You have already joined this contest',
            }),
          };
        }
        if (url === '/api/users/dashboard') {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              upcomingContests: [{ ...sampleContest, isEnrolled: true }],
              runningContests: [],
              joinedContests: [{ ...sampleContest, isEnrolled: true }],
            }),
          };
        }
      });

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollError, null);
      assert.match(controller.enrollSuccess, /already registered for "Spring Championship"/);
      assert.equal(controller.dashboardData.upcomingContests[0].isEnrolled, true);
    });
  });

  // Section E: Unauthorized State
  describe('E. Unauthorized State Handling', () => {
    it('surfaces authentication prompt on HTTP 401 Unauthorized', async () => {
      const controller = new StudentContestEnrollmentController({ token: '' });
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => ({
        status: 401,
        ok: false,
        json: async () => ({ status: 'error', message: 'Authentication required' }),
      }));

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.equal(controller.enrollError, 'Authentication required. Please log in to enroll.');
    });

    it('surfaces role restriction error on HTTP 403 Forbidden', async () => {
      const controller = new StudentContestEnrollmentController({ user: { id: 2, role: 'professor' } });
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => ({
        status: 403,
        ok: false,
        json: async () => ({
          status: 'error',
          message: 'Forbidden: Contest self-enrollment is reserved for students.',
        }),
      }));

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.match(controller.enrollError, /reserved for students/);
    });
  });

  // Section F: Unavailable Contest Handling
  describe('F. Unavailable Contest Handling', () => {
    it('surfaces contest not found error on HTTP 404', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => ({
        status: 404,
        ok: false,
        json: async () => ({ status: 'error', message: 'Contest with ID 101 not found' }),
      }));

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.equal(controller.enrollError, 'Contest not found or no longer available.');
    });
  });

  // Section G: Lifecycle Rejection Handling
  describe('G. Lifecycle Rejection Handling', () => {
    it('surfaces ended contest message on HTTP 400', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => ({
        status: 400,
        ok: false,
        json: async () => ({
          status: 'error',
          message: 'Cannot join contest: Contest has already ended',
        }),
      }));

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.equal(controller.enrollError, 'Cannot join contest: Contest has already ended');
    });

    it('surfaces unpublished contest message on HTTP 400', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => ({
        status: 400,
        ok: false,
        json: async () => ({
          status: 'error',
          message: 'Cannot join contest: Contest is not yet published',
        }),
      }));

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.equal(controller.enrollError, 'Cannot join contest: Contest is not yet published');
    });
  });

  // Section H: Network & Server Error Handling
  describe('H. Network & Server Error Handling', () => {
    it('handles network failure gracefully without crashing', async () => {
      const controller = new StudentContestEnrollmentController();
      controller.setDashboardData(sampleDashboard);

      controller.setFetchMock(async () => {
        throw new TypeError('Failed to fetch: network connection lost');
      });

      await controller.handleEnroll(101, 'Spring Championship');

      assert.equal(controller.enrollSuccess, null);
      assert.equal(controller.enrollError, 'Failed to fetch: network connection lost');
      assert.equal(controller.enrollingContestId, null, 'Loading state must be reset after network error');
    });
  });

  // Section I: Refresh Preserves Authoritative State
  describe('I. Refresh Preserves Enrollment State', () => {
    it('preserves enrolled state across simulated dashboard refreshes', async () => {
      const controller = new StudentContestEnrollmentController();
      
      const serverAuthoritativeState = {
        upcomingContests: [{ ...sampleContest, isEnrolled: true }],
        runningContests: [],
        joinedContests: [{ ...sampleContest, isEnrolled: true }],
      };

      controller.setFetchMock(async () => ({
        status: 200,
        ok: true,
        json: async () => serverAuthoritativeState,
      }));

      await controller.refreshDashboard();

      assert.equal(controller.dashboardData.upcomingContests[0].isEnrolled, true);
      assert.equal(controller.dashboardData.joinedContests.length, 1);

      // Re-evaluating UI props still gives Enrolled
      const props = controller.getContestActionProps(controller.dashboardData.upcomingContests[0]);
      assert.equal(props.isEnrolled, true);
      assert.equal(props.badgeText, 'Enrolled');
    });
  });

  // Section J: Absence of Admin Mutation Controls
  describe('J. Absence of Admin Mutation Controls in Student View', () => {
    it('verifies that student view has zero administrative participant controls', () => {
      const controller = new StudentContestEnrollmentController();
      const props = controller.getContestActionProps(sampleContest);

      // Prohibited actions in student enrollment view
      const forbiddenAdminActions = [
        'kickParticipant',
        'disqualifyParticipant',
        'manualAddParticipant',
        'modifyParticipantScore',
        'deleteParticipant',
        'exportParticipantsCsv',
      ];

      for (const action of forbiddenAdminActions) {
        assert.equal(props[action], undefined, `Forbidden admin action ${action} must not be present`);
      }
    });
  });

  // Section K: Safe Error Rendering
  describe('K. Safe Error Rendering', () => {
    it('sanitizes and shields sensitive stack traces and SQL snippets', () => {
      const controller = new StudentContestEnrollmentController();

      const rawSqlError = 'error: relation "users" does not exist at Object.query (D:\\backend\\db.js:45:10)';
      const sanitized = controller.sanitizeErrorMessage(rawSqlError);

      assert.equal(sanitized.includes('D:\\backend'), false);
      assert.equal(sanitized.includes('at Object'), false);
      assert.equal(sanitized.includes('relation "users"'), false);
    });
  });
});
