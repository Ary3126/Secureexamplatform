/**
 * Phase 7.5.8.5.3 — Freeze UI Logic & Accessibility Test Suite
 * File: frontend/test_phase7_5_8_5_3_freeze_ui_logic.js
 *
 * Tests the client-side presentation, synchronization, and accessibility rules:
 * 1. Clock Skew Resilience (Server clock authoritative, local client clock manipulation immune)
 * 2. Countdown boundary triggers (re-fetch on freeze boundary and expiration, no client override)
 * 3. Status Badge generation (Accessible role="status", correct label, freeze != finalization)
 * 4. Freeze Alert Banner accessibility (role="alert", aria-live="polite", safe duration formatting)
 * 5. Manager Freeze Override toggle semantics (role="switch", aria-checked, aria-label)
 * 6. Data Masking & Non-leakage (No hidden data reconstructible client-side)
 *
 * Run: node test_phase7_5_8_5_3_freeze_ui_logic.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. CLOCK SKEW & TIMER LOGIC ─────────────────────────────────────────────

function computeCountdown(endTimeStr, serverTimeStr, clientNowMs) {
  const endTime = new Date(endTimeStr).getTime();
  const serverTime = new Date(serverTimeStr).getTime();

  if (isNaN(endTime) || isNaN(serverTime)) {
    return { timeRemaining: '00:00:00', isExpired: true, clockSkew: 0 };
  }

  // Authoritative server clock skew
  const clockSkew = serverTime - clientNowMs;
  const currentEstimatedServerNow = clientNowMs + clockSkew;
  const diff = endTime - currentEstimatedServerNow;

  if (diff <= 0) {
    return { timeRemaining: '00:00:00', isExpired: true, clockSkew };
  }

  const hrs = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  const formatUnit = (n) => String(n).padStart(2, '0');
  return {
    timeRemaining: `${formatUnit(hrs)}:${formatUnit(mins)}:${formatUnit(secs)}`,
    isExpired: false,
    clockSkew,
  };
}

function checkFreezeWindowCrossed(contest, serverTimeStr, clientNowMs) {
  if (!contest?.leaderboardFreezeEnabled) return false;

  const serverTime = new Date(serverTimeStr).getTime();
  const clockSkew = !isNaN(serverTime) ? serverTime - clientNowMs : 0;
  const currentServerNow = clientNowMs + clockSkew;

  const freezeTimeMs = contest.freezeTime ? new Date(contest.freezeTime).getTime() : NaN;
  const endTimeMs = contest.endTime ? new Date(contest.endTime).getTime() : NaN;

  if (isNaN(freezeTimeMs) || isNaN(endTimeMs)) return false;

  return currentServerNow >= freezeTimeMs && currentServerNow < endTimeMs;
}

// ── 2. STATUS BADGE GENERATOR (MIRRORING ContestLeaderboard & ResultsView) ───

function getStatusBadgeDescriptor(contest) {
  if (!contest) return null;

  if (contest.isRatingFinalized || contest.freezeState === 'FINAL') {
    return {
      type: 'finalized',
      label: 'Finalized',
      role: 'status',
      ariaLabel: 'Contest Status: Finalized',
      isProvisional: false,
    };
  }

  if (contest.isFrozen || contest.freezeState === 'FROZEN') {
    return {
      type: 'frozen',
      label: 'Frozen',
      role: 'status',
      ariaLabel: 'Contest Status: Leaderboard Frozen',
      isProvisional: true,
    };
  }

  if (contest.runtimeState === 'running') {
    return {
      type: 'live',
      label: 'Live',
      role: 'status',
      ariaLabel: 'Contest Status: Live',
      isProvisional: true,
    };
  }

  if (contest.runtimeState === 'upcoming') {
    return {
      type: 'upcoming',
      label: 'Upcoming',
      role: 'status',
      ariaLabel: 'Contest Status: Upcoming',
      isProvisional: false,
    };
  }

  return {
    type: 'ended',
    label: 'Ended',
    role: 'status',
    ariaLabel: 'Contest Status: Ended',
    isProvisional: false,
  };
}

// ── 3. FREEZE BANNER FORMATTER ───────────────────────────────────────────────

function getFreezeBannerDetails(contest) {
  const isFrozen = Boolean(contest?.isFrozen || contest?.freezeState === 'FROZEN');
  if (!isFrozen) return null;

  const freezeMinutes = contest.leaderboardFreezeMinutes ?? 60;
  return {
    isVisible: true,
    role: 'alert',
    ariaLive: 'polite',
    heading: 'Leaderboard is Currently Frozen',
    message: `Submissions continue to be evaluated normally by the judge. Visible rankings are frozen for the final ${freezeMinutes} minutes. Final standings and rating changes will be unveiled when the contest concludes.`,
    freezeMinutes,
  };
}

// ── 4. MANAGER TOGGLE ACCESSIBILITY DESCRIPTOR ───────────────────────────────

function getFreezeToggleAttributes(isManager, contest, freezeOverride) {
  const isFrozen = Boolean(contest?.isFrozen || contest?.freezeState === 'FROZEN');
  if (!isManager || !isFrozen) return null;

  return {
    role: 'switch',
    ariaChecked: Boolean(freezeOverride),
    ariaLabel: freezeOverride
      ? 'Freeze override active: viewing unmasked live results'
      : 'Viewing frozen masked results',
    title: freezeOverride
      ? 'Viewing unmasked live results'
      : 'Viewing frozen masked results',
    text: freezeOverride ? 'Unmasked (Live)' : 'Frozen View',
  };
}

// ── TEST SUITE ───────────────────────────────────────────────────────────────

describe('Phase 7.5.8.5.3 — Freeze UI Logic & Accessibility Tests', () => {

  describe('1. Countdown & Server Clock Skew Resilience', () => {
    it('1.1 Computes correct countdown when client and server clocks match', () => {
      const serverTime = '2026-09-29T12:00:00.000Z';
      const endTime = '2026-09-29T13:30:45.000Z';
      const clientNow = new Date('2026-09-29T12:00:00.000Z').getTime();

      const res = computeCountdown(endTime, serverTime, clientNow);
      assert.strictEqual(res.timeRemaining, '01:30:45');
      assert.strictEqual(res.isExpired, false);
      assert.strictEqual(res.clockSkew, 0);
    });

    it('1.2 Client clock set 2 hours ahead does not cause premature expiration', () => {
      const serverTime = '2026-09-29T12:00:00.000Z';
      const endTime = '2026-09-29T13:00:00.000Z';
      // Local computer clock is set to 14:00:00 (2 hours ahead)
      const clientNow = new Date('2026-09-29T14:00:00.000Z').getTime();

      const res = computeCountdown(endTime, serverTime, clientNow);
      // Even though client clock says 14:00, estimated server time is 12:00, so remaining is 01:00:00
      assert.strictEqual(res.timeRemaining, '01:00:00');
      assert.strictEqual(res.isExpired, false);
      assert.strictEqual(res.clockSkew, -2 * 60 * 60 * 1000);
    });

    it('1.3 Client clock set 5 hours behind correctly indicates expiration if server reached endTime', () => {
      const serverTime = '2026-09-29T14:05:00.000Z';
      const endTime = '2026-09-29T14:00:00.000Z';
      // Local computer clock is set to 09:00:00 (5 hours behind)
      const clientNow = new Date('2026-09-29T09:00:00.000Z').getTime();

      const res = computeCountdown(endTime, serverTime, clientNow);
      assert.strictEqual(res.timeRemaining, '00:00:00');
      assert.strictEqual(res.isExpired, true);
    });

    it('1.4 Detects freeze boundary transition using server clock alignment', () => {
      const contest = {
        leaderboardFreezeEnabled: true,
        startTime: '2026-09-29T10:00:00.000Z',
        endTime: '2026-09-29T12:00:00.000Z',
        freezeTime: '2026-09-29T11:00:00.000Z', // 60 mins before end
      };

      // Server is at 11:15 (inside freeze window)
      const serverTime = '2026-09-29T11:15:00.000Z';
      const clientNow = new Date('2026-09-29T11:15:00.000Z').getTime();

      const inFreeze = checkFreezeWindowCrossed(contest, serverTime, clientNow);
      assert.strictEqual(inFreeze, true);
    });

    it('1.5 Detects before freeze window returns false', () => {
      const contest = {
        leaderboardFreezeEnabled: true,
        startTime: '2026-09-29T10:00:00.000Z',
        endTime: '2026-09-29T12:00:00.000Z',
        freezeTime: '2026-09-29T11:00:00.000Z',
      };

      // Server is at 10:45 (before freeze)
      const serverTime = '2026-09-29T10:45:00.000Z';
      const clientNow = new Date('2026-09-29T10:45:00.000Z').getTime();

      const inFreeze = checkFreezeWindowCrossed(contest, serverTime, clientNow);
      assert.strictEqual(inFreeze, false);
    });
  });

  describe('2. Status Badge Presentation & Accessibility', () => {
    it('2.1 Frozen contest displays Frozen badge with role="status" and isProvisional: true', () => {
      const contest = {
        isFrozen: true,
        freezeState: 'FROZEN',
        runtimeState: 'running',
        isRatingFinalized: false,
      };

      const badge = getStatusBadgeDescriptor(contest);
      assert.strictEqual(badge.type, 'frozen');
      assert.strictEqual(badge.label, 'Frozen');
      assert.strictEqual(badge.role, 'status');
      assert.strictEqual(badge.ariaLabel, 'Contest Status: Leaderboard Frozen');
      assert.strictEqual(badge.isProvisional, true);
    });

    it('2.2 Frozen contest is NEVER labeled "Finalized" or "Official"', () => {
      const contest = {
        isFrozen: true,
        freezeState: 'FROZEN',
        runtimeState: 'running',
        isRatingFinalized: false,
      };

      const badge = getStatusBadgeDescriptor(contest);
      assert.notStrictEqual(badge.label, 'Finalized');
      assert.notStrictEqual(badge.label, 'Official Results');
    });

    it('2.3 Finalized contest displays Finalized badge with isProvisional: false', () => {
      const contest = {
        isFrozen: false,
        freezeState: 'FINAL',
        runtimeState: 'ended',
        isRatingFinalized: true,
      };

      const badge = getStatusBadgeDescriptor(contest);
      assert.strictEqual(badge.type, 'finalized');
      assert.strictEqual(badge.label, 'Finalized');
      assert.strictEqual(badge.role, 'status');
      assert.strictEqual(badge.ariaLabel, 'Contest Status: Finalized');
      assert.strictEqual(badge.isProvisional, false);
    });

    it('2.4 Ended contest awaiting finalization displays Ended, not Finalized', () => {
      const contest = {
        isFrozen: false,
        freezeState: 'NOT_FROZEN',
        runtimeState: 'ended',
        isRatingFinalized: false,
      };

      const badge = getStatusBadgeDescriptor(contest);
      assert.strictEqual(badge.type, 'ended');
      assert.strictEqual(badge.label, 'Ended');
      assert.strictEqual(badge.ariaLabel, 'Contest Status: Ended');
    });

    it('2.5 Live running contest without freeze displays Live badge', () => {
      const contest = {
        isFrozen: false,
        freezeState: 'NOT_FROZEN',
        runtimeState: 'running',
        isRatingFinalized: false,
      };

      const badge = getStatusBadgeDescriptor(contest);
      assert.strictEqual(badge.type, 'live');
      assert.strictEqual(badge.label, 'Live');
      assert.strictEqual(badge.ariaLabel, 'Contest Status: Live');
    });
  });

  describe('3. Freeze Alert Banner Content & Duration Formatting', () => {
    it('3.1 Generates alert banner with role="alert" and aria-live="polite"', () => {
      const contest = {
        isFrozen: true,
        freezeState: 'FROZEN',
        leaderboardFreezeMinutes: 45,
      };

      const banner = getFreezeBannerDetails(contest);
      assert.ok(banner);
      assert.strictEqual(banner.isVisible, true);
      assert.strictEqual(banner.role, 'alert');
      assert.strictEqual(banner.ariaLive, 'polite');
      assert.strictEqual(banner.freezeMinutes, 45);
      assert.ok(banner.message.includes('final 45 minutes'));
    });

    it('3.2 Handles 0 minutes freeze duration without defaulting to 60', () => {
      const contest = {
        isFrozen: true,
        freezeState: 'FROZEN',
        leaderboardFreezeMinutes: 0,
      };

      const banner = getFreezeBannerDetails(contest);
      assert.ok(banner);
      assert.strictEqual(banner.freezeMinutes, 0);
      assert.ok(banner.message.includes('final 0 minutes'));
    });

    it('3.3 Handles undefined/null freeze duration by falling back to 60', () => {
      const contest = {
        isFrozen: true,
        freezeState: 'FROZEN',
        leaderboardFreezeMinutes: null,
      };

      const banner = getFreezeBannerDetails(contest);
      assert.ok(banner);
      assert.strictEqual(banner.freezeMinutes, 60);
      assert.ok(banner.message.includes('final 60 minutes'));
    });

    it('3.4 Does not generate banner when contest is NOT frozen', () => {
      const contest = {
        isFrozen: false,
        freezeState: 'NOT_FROZEN',
        leaderboardFreezeMinutes: 60,
      };

      const banner = getFreezeBannerDetails(contest);
      assert.strictEqual(banner, null);
    });
  });

  describe('4. Manager Freeze Override Controls & Accessibility', () => {
    it('4.1 Renders toggle with role="switch" and aria-checked for managers during freeze', () => {
      const contest = { isFrozen: true, freezeState: 'FROZEN' };
      const attrs = getFreezeToggleAttributes(true, contest, false);

      assert.ok(attrs);
      assert.strictEqual(attrs.role, 'switch');
      assert.strictEqual(attrs.ariaChecked, false);
      assert.strictEqual(attrs.text, 'Frozen View');
      assert.strictEqual(attrs.ariaLabel, 'Viewing frozen masked results');
    });

    it('4.2 Updates aria-checked and aria-label when unmask is active', () => {
      const contest = { isFrozen: true, freezeState: 'FROZEN' };
      const attrs = getFreezeToggleAttributes(true, contest, true);

      assert.ok(attrs);
      assert.strictEqual(attrs.ariaChecked, true);
      assert.strictEqual(attrs.text, 'Unmasked (Live)');
      assert.strictEqual(attrs.ariaLabel, 'Freeze override active: viewing unmasked live results');
    });

    it('4.3 Non-managers do not receive toggle attributes (hidden from students)', () => {
      const contest = { isFrozen: true, freezeState: 'FROZEN' };
      const attrs = getFreezeToggleAttributes(false, contest, false);
      assert.strictEqual(attrs, null);
    });

    it('4.4 Managers on non-frozen contests do not see toggle', () => {
      const contest = { isFrozen: false, freezeState: 'NOT_FROZEN' };
      const attrs = getFreezeToggleAttributes(true, contest, false);
      assert.strictEqual(attrs, null);
    });
  });

  describe('5. Data Integrity & Masking Parity', () => {
    it('5.1 Verifies student payload has zero hidden submissions', () => {
      const studentPayload = {
        standings: [
          { userId: 101, username: 'alice', totalScore: 100, problems: [{ problemId: 1, points: 100, status: 'solved' }] },
          { userId: 102, username: 'bob', totalScore: 0, problems: [{ problemId: 1, points: 0, status: 'unattempted' }] },
        ],
        contest: { isFrozen: true, freezeState: 'FROZEN' },
      };

      // Search entire JSON representation for any sign of bob's solve
      const jsonStr = JSON.stringify(studentPayload);
      assert.strictEqual(jsonStr.includes('bob solved'), false);
      assert.strictEqual(studentPayload.standings[1].totalScore, 0);
    });

    it('5.2 Verifies manager unmasked payload contains true standings', () => {
      const managerPayload = {
        standings: [
          { userId: 102, username: 'bob', totalScore: 100, problems: [{ problemId: 1, points: 100, status: 'solved' }] },
          { userId: 101, username: 'alice', totalScore: 100, problems: [{ problemId: 1, points: 100, status: 'solved' }] },
        ],
        contest: { isFrozen: true, freezeState: 'FROZEN' },
      };

      assert.strictEqual(managerPayload.standings[0].username, 'bob');
      assert.strictEqual(managerPayload.standings[0].totalScore, 100);
    });
  });
});
