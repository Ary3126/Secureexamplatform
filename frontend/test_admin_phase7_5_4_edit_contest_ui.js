/**
 * Phase 7.5.4: Admin Contest Edit UI Logic Test Suite
 *
 * Tests AdminContestEditModal business logic:
 * - Lifecycle lock detection and enforcement
 * - Form pre-population from existing contest data
 * - Payload construction (with/without timing fields)
 * - Client-side validation parity with backend validateUpdateContest
 * - Dirty-state detection for cancel guard
 * - RBAC edit button visibility
 * - Duration utility helpers
 *
 * Run: node test_admin_phase7_5_4_edit_contest_ui.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';


// ── Helpers (mirroring AdminContestEditModal implementation) ─────────────────

function toDateTimeLocalString(date) {
  if (!date || isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDurationText(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  const totalMins = Math.round((end - start) / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const minutes = totalMins % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return { text: parts.join(' '), totalMinutes: totalMins };
}

const LIFECYCLE_LOCKED_STATES = new Set(['running', 'ended', 'archived']);

function buildDefaultFormData(contest) {
  return {
    title: contest.title || '',
    description: contest.description || '',
    startTime: contest.startTime
      ? toDateTimeLocalString(new Date(contest.startTime))
      : '',
    endTime: contest.endTime
      ? toDateTimeLocalString(new Date(contest.endTime))
      : '',
    isRated: Boolean(contest.isRated),
    leaderboardFreezeEnabled: Boolean(contest.leaderboardFreezeEnabled),
    leaderboardFreezeMinutes:
      contest.leaderboardFreezeMinutes != null
        ? contest.leaderboardFreezeMinutes
        : 60,
  };
}

function validate(formData, isLifecycleLocked) {
  const errors = {};

  const trimmedTitle = (formData.title || '').trim();
  if (!trimmedTitle) {
    errors.title = 'Contest title is required.';
  } else if (trimmedTitle.length < 3) {
    errors.title = 'Title must be at least 3 characters.';
  } else if (trimmedTitle.length > 200) {
    errors.title = 'Title cannot exceed 200 characters.';
  }

  if (!isLifecycleLocked) {
    if (!formData.startTime) errors.startTime = 'Start time is required.';
    if (!formData.endTime) errors.endTime = 'End time is required.';
    if (formData.startTime && formData.endTime) {
      const start = new Date(formData.startTime).getTime();
      const end = new Date(formData.endTime).getTime();
      if (isNaN(start)) errors.startTime = 'Invalid start date/time.';
      if (isNaN(end)) errors.endTime = 'Invalid end date/time.';
      if (!isNaN(start) && !isNaN(end)) {
        if (end <= start) errors.endTime = 'End time must be strictly later than start time.';
        else if (end - start < 60000) errors.endTime = 'Contest duration must be at least 1 minute.';
      }
    }
  }

  const durationInfo = getDurationText(formData.startTime, formData.endTime);
  if (formData.leaderboardFreezeEnabled) {
    const freeze = parseInt(formData.leaderboardFreezeMinutes, 10);
    if (isNaN(freeze) || freeze < 0) {
      errors.freeze = 'Freeze window must be a non-negative number of minutes.';
    } else if (durationInfo && durationInfo.totalMinutes && freeze > durationInfo.totalMinutes) {
      errors.freeze = `Freeze window (${freeze}m) cannot exceed total contest duration (${durationInfo.totalMinutes}m).`;
    }
  }

  if (formData.description && formData.description.length > 10000) {
    errors.description = 'Description cannot exceed 10,000 characters.';
  }

  return errors;
}

function buildPayload(formData, isLifecycleLocked) {
  const payload = {
    title: formData.title.trim(),
    description: formData.description.trim() || undefined,
    isRated: Boolean(formData.isRated),
    leaderboardFreezeEnabled: Boolean(formData.leaderboardFreezeEnabled),
    leaderboardFreezeMinutes: formData.leaderboardFreezeEnabled
      ? parseInt(formData.leaderboardFreezeMinutes, 10) || 60
      : undefined,
  };

  if (!isLifecycleLocked) {
    payload.startTime = new Date(formData.startTime).toISOString();
    payload.endTime = new Date(formData.endTime).toISOString();
  }

  return payload;
}

function hasChanges(formData, contest, isLifecycleLocked) {
  const origStart = contest.startTime
    ? toDateTimeLocalString(new Date(contest.startTime))
    : '';
  const origEnd = contest.endTime
    ? toDateTimeLocalString(new Date(contest.endTime))
    : '';
  return (
    formData.title.trim() !== (contest.title || '').trim() ||
    formData.description.trim() !== (contest.description || '').trim() ||
    (!isLifecycleLocked && formData.startTime !== origStart) ||
    (!isLifecycleLocked && formData.endTime !== origEnd) ||
    formData.isRated !== Boolean(contest.isRated) ||
    formData.leaderboardFreezeEnabled !== Boolean(contest.leaderboardFreezeEnabled) ||
    parseInt(formData.leaderboardFreezeMinutes, 10) !==
      (contest.leaderboardFreezeMinutes ?? 60)
  );
}

function canManageContest(currentUser, contest) {
  if (!currentUser) return false;
  if (currentUser.role === 'super_admin' || currentUser.role === 'contest_admin')
    return true;
  if (currentUser.role === 'professor' && contest.createdBy === currentUser.id)
    return true;
  return false;
}

// ── Sample contest objects ────────────────────────────────────────────────────

const now = Date.now();

const draftContest = {
  id: 1,
  title: 'Campus Qualifier 2026',
  description: 'Main contest description',
  startTime: new Date(now + 24 * 60 * 60 * 1000).toISOString(),   // tomorrow
  endTime:   new Date(now + 26 * 60 * 60 * 1000).toISOString(),   // +2h
  status: 'draft',
  runtimeState: 'draft',
  isRated: true,
  leaderboardFreezeEnabled: false,
  leaderboardFreezeMinutes: 60,
  createdBy: 42,
};

const upcomingContest = {
  ...draftContest,
  id: 2,
  status: 'published',
  runtimeState: 'upcoming',
};

const runningContest = {
  ...draftContest,
  id: 3,
  status: 'published',
  runtimeState: 'running',
  startTime: new Date(now - 30 * 60 * 1000).toISOString(),   // 30 min ago
  endTime:   new Date(now + 90 * 60 * 1000).toISOString(),   // +90 min from now
};

const endedContest = {
  ...draftContest,
  id: 4,
  status: 'published',
  runtimeState: 'ended',
  startTime: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
  endTime:   new Date(now - 2 * 60 * 60 * 1000).toISOString(),
};

const archivedContest = {
  ...draftContest,
  id: 5,
  status: 'archived',
  runtimeState: 'archived',
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Phase 7.5.4: Admin Contest Edit UI Logic Suite', () => {

  describe('1. Lifecycle Lock Detection', () => {
    it('draft is NOT lifecycle locked', () => {
      assert.equal(LIFECYCLE_LOCKED_STATES.has(draftContest.runtimeState), false);
    });

    it('upcoming is NOT lifecycle locked', () => {
      assert.equal(LIFECYCLE_LOCKED_STATES.has(upcomingContest.runtimeState), false);
    });

    it('running IS lifecycle locked', () => {
      assert.equal(LIFECYCLE_LOCKED_STATES.has(runningContest.runtimeState), true);
    });

    it('ended IS lifecycle locked', () => {
      assert.equal(LIFECYCLE_LOCKED_STATES.has(endedContest.runtimeState), true);
    });

    it('archived IS lifecycle locked', () => {
      assert.equal(LIFECYCLE_LOCKED_STATES.has(archivedContest.runtimeState), true);
    });
  });

  describe('2. Form Pre-Population', () => {
    it('populates title from contest data', () => {
      const fd = buildDefaultFormData(draftContest);
      assert.equal(fd.title, 'Campus Qualifier 2026');
    });

    it('converts ISO startTime to datetime-local format', () => {
      const fd = buildDefaultFormData(draftContest);
      assert.match(fd.startTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('converts ISO endTime to datetime-local format', () => {
      const fd = buildDefaultFormData(draftContest);
      assert.match(fd.endTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('correctly maps isRated boolean from contest', () => {
      const fd = buildDefaultFormData(draftContest);
      assert.equal(fd.isRated, true);
    });

    it('correctly maps leaderboardFreezeEnabled from contest', () => {
      const fd = buildDefaultFormData(draftContest);
      assert.equal(fd.leaderboardFreezeEnabled, false);
    });

    it('defaults leaderboardFreezeMinutes to 60 when null/undefined', () => {
      const c = { ...draftContest, leaderboardFreezeMinutes: null };
      const fd = buildDefaultFormData(c);
      assert.equal(fd.leaderboardFreezeMinutes, 60);
    });

    it('uses explicit leaderboardFreezeMinutes value when set', () => {
      const c = { ...draftContest, leaderboardFreezeMinutes: 30 };
      const fd = buildDefaultFormData(c);
      assert.equal(fd.leaderboardFreezeMinutes, 30);
    });
  });

  describe('3. Payload Construction — Lifecycle Unlocked', () => {
    it('includes startTime and endTime when not locked (draft)', () => {
      const fd = buildDefaultFormData(draftContest);
      const payload = buildPayload(fd, false);
      assert.ok(payload.startTime, 'startTime should be present');
      assert.ok(payload.endTime, 'endTime should be present');
    });

    it('produces valid UTC ISO strings for timing fields', () => {
      const fd = buildDefaultFormData(draftContest);
      const payload = buildPayload(fd, false);
      assert.doesNotThrow(() => new Date(payload.startTime));
      assert.doesNotThrow(() => new Date(payload.endTime));
      assert.ok(payload.startTime.endsWith('Z'), 'startTime should be UTC ISO');
      assert.ok(payload.endTime.endsWith('Z'), 'endTime should be UTC ISO');
    });

    it('trims whitespace from title in payload', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = '  Trimmed Title  ';
      const payload = buildPayload(fd, false);
      assert.equal(payload.title, 'Trimmed Title');
    });

    it('sends undefined for description when empty string', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.description = '';
      const payload = buildPayload(fd, false);
      assert.equal(payload.description, undefined);
    });

    it('includes leaderboardFreezeMinutes when freeze is enabled', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.leaderboardFreezeEnabled = true;
      fd.leaderboardFreezeMinutes = 45;
      const payload = buildPayload(fd, false);
      assert.equal(payload.leaderboardFreezeMinutes, 45);
    });

    it('omits leaderboardFreezeMinutes when freeze is disabled', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.leaderboardFreezeEnabled = false;
      const payload = buildPayload(fd, false);
      assert.equal(payload.leaderboardFreezeMinutes, undefined);
    });
  });

  describe('4. Payload Construction — Lifecycle Locked', () => {
    it('OMITS startTime when contest is running (locked)', () => {
      const fd = buildDefaultFormData(runningContest);
      const payload = buildPayload(fd, true);  // isLifecycleLocked = true
      assert.equal(payload.startTime, undefined, 'startTime must not be sent when locked');
    });

    it('OMITS endTime when contest is running (locked)', () => {
      const fd = buildDefaultFormData(runningContest);
      const payload = buildPayload(fd, true);
      assert.equal(payload.endTime, undefined, 'endTime must not be sent when locked');
    });

    it('OMITS startTime when contest is ended (locked)', () => {
      const fd = buildDefaultFormData(endedContest);
      const payload = buildPayload(fd, true);
      assert.equal(payload.startTime, undefined);
    });

    it('still includes title, isRated, freeze fields even when locked', () => {
      const fd = buildDefaultFormData(runningContest);
      fd.title = 'Updated During Run';
      const payload = buildPayload(fd, true);
      assert.equal(payload.title, 'Updated During Run');
      assert.ok('isRated' in payload, 'isRated should always be present');
      assert.ok('leaderboardFreezeEnabled' in payload, 'freeze enabled should always be present');
    });
  });

  describe('5. Client-Side Validation — Unlocked (matches backend validateUpdateContest)', () => {
    const unlocked = false;

    it('rejects empty title', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = '';
      const errors = validate(fd, unlocked);
      assert.ok(errors.title, 'should have title error');
    });

    it('rejects title shorter than 3 chars', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = 'AB';
      const errors = validate(fd, unlocked);
      assert.ok(errors.title);
    });

    it('rejects title longer than 200 chars', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = 'A'.repeat(201);
      const errors = validate(fd, unlocked);
      assert.ok(errors.title);
    });

    it('accepts title of exactly 3 characters', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = 'ABC';
      const errors = validate(fd, unlocked);
      assert.equal(errors.title, undefined);
    });

    it('rejects end time not later than start time', () => {
      const fd = buildDefaultFormData(draftContest);
      const start = new Date(now + 24 * 60 * 60 * 1000);
      fd.startTime = toDateTimeLocalString(start);
      fd.endTime = toDateTimeLocalString(start); // same time
      const errors = validate(fd, unlocked);
      assert.ok(errors.endTime, 'end == start should produce endTime error');
    });

    it('rejects duration shorter than 1 minute (boundary case)', () => {
      // datetime-local has 1-minute granularity; 30s difference rounds to the
      // same minute string, so end == start after toDateTimeLocalString conversion.
      // The validator correctly rejects this via "end <= start" branch.
      const fd = buildDefaultFormData(draftContest);
      const start = new Date(now + 24 * 60 * 60 * 1000);
      fd.startTime = toDateTimeLocalString(start);
      // 30s later rounds to same minute, so endTime == startTime string
      fd.endTime = toDateTimeLocalString(new Date(start.getTime() + 30 * 1000));
      const errors = validate(fd, unlocked);
      // Either "end <= start" or "< 1 minute" is triggered
      assert.ok(errors.endTime, 'same-minute resolution should produce endTime error');
    });

    it('flags freeze window exceeding contest duration', () => {
      const fd = buildDefaultFormData(draftContest);
      const start = new Date(now + 24 * 60 * 60 * 1000);
      fd.startTime = toDateTimeLocalString(start);
      fd.endTime = toDateTimeLocalString(new Date(start.getTime() + 60 * 60 * 1000)); // 1h
      fd.leaderboardFreezeEnabled = true;
      fd.leaderboardFreezeMinutes = 120; // exceeds 60m
      const errors = validate(fd, unlocked);
      assert.ok(errors.freeze, 'freeze exceeding duration should error');
    });

    it('accepts valid freeze window within duration', () => {
      const fd = buildDefaultFormData(draftContest);
      const start = new Date(now + 24 * 60 * 60 * 1000);
      fd.startTime = toDateTimeLocalString(start);
      fd.endTime = toDateTimeLocalString(new Date(start.getTime() + 120 * 60 * 1000)); // 2h
      fd.leaderboardFreezeEnabled = true;
      fd.leaderboardFreezeMinutes = 60;
      const errors = validate(fd, unlocked);
      assert.equal(errors.freeze, undefined);
    });

    it('flags description over 10,000 chars', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.description = 'A'.repeat(10001);
      const errors = validate(fd, unlocked);
      assert.ok(errors.description);
    });

    it('returns empty errors object for valid locked-unlocked form', () => {
      const fd = buildDefaultFormData(draftContest);
      const errors = validate(fd, unlocked);
      assert.equal(Object.keys(errors).length, 0);
    });
  });

  describe('6. Validation — Lifecycle Locked (timing not validated)', () => {
    const locked = true;

    it('does NOT produce startTime/endTime errors when locked and they are empty', () => {
      const fd = buildDefaultFormData(runningContest);
      // Clear timing fields (as if inputs were disabled)
      fd.startTime = '';
      fd.endTime = '';
      const errors = validate(fd, locked);
      assert.equal(errors.startTime, undefined, 'startTime should not be validated when locked');
      assert.equal(errors.endTime, undefined, 'endTime should not be validated when locked');
    });

    it('still validates title when locked', () => {
      const fd = buildDefaultFormData(runningContest);
      fd.title = '';
      const errors = validate(fd, locked);
      assert.ok(errors.title, 'title is always validated');
    });

    it('still validates freeze window when locked and freeze is enabled', () => {
      const fd = buildDefaultFormData(runningContest);
      fd.leaderboardFreezeEnabled = true;
      fd.leaderboardFreezeMinutes = -5;
      const errors = validate(fd, locked);
      assert.ok(errors.freeze, 'negative freeze should error even when locked');
    });
  });

  describe('7. Dirty-State Detection for Cancel Guard', () => {
    it('detects NO changes when form matches original contest', () => {
      const fd = buildDefaultFormData(draftContest);
      const changed = hasChanges(fd, draftContest, false);
      assert.equal(changed, false);
    });

    it('detects title change', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.title = 'Different Title';
      assert.equal(hasChanges(fd, draftContest, false), true);
    });

    it('detects description change', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.description = 'New description';
      assert.equal(hasChanges(fd, draftContest, false), true);
    });

    it('detects isRated toggle', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.isRated = !fd.isRated;
      assert.equal(hasChanges(fd, draftContest, false), true);
    });

    it('detects leaderboardFreezeEnabled toggle', () => {
      const fd = buildDefaultFormData(draftContest);
      fd.leaderboardFreezeEnabled = true;
      assert.equal(hasChanges(fd, draftContest, false), true);
    });

    it('detects timing change when NOT locked', () => {
      const fd = buildDefaultFormData(draftContest);
      const newStart = new Date(now + 48 * 60 * 60 * 1000);
      fd.startTime = toDateTimeLocalString(newStart);
      assert.equal(hasChanges(fd, draftContest, false), true);
    });

    it('does NOT report timing change as dirty when LOCKED (timing ignored)', () => {
      // When locked, timing changes should not be considered dirty
      // because the fields are read-only and the original values are preserved
      const fd = buildDefaultFormData(runningContest);
      // Even if start/end are the same (read-only), only non-timing fields matter
      const changed = hasChanges(fd, runningContest, true);
      assert.equal(changed, false);
    });
  });

  describe('8. Edit Button Visibility (RBAC)', () => {
    const superAdmin = { id: 99, role: 'super_admin' };
    const contestAdmin = { id: 88, role: 'contest_admin' };
    const professor = { id: 42, role: 'professor' };
    const anotherProfessor = { id: 77, role: 'professor' };
    const student = { id: 55, role: 'student' };

    it('super_admin can manage any contest', () => {
      assert.equal(canManageContest(superAdmin, draftContest), true);
    });

    it('contest_admin can manage any contest', () => {
      assert.equal(canManageContest(contestAdmin, draftContest), true);
    });

    it('professor can manage their own contest', () => {
      // draftContest.createdBy = 42
      assert.equal(canManageContest(professor, draftContest), true);
    });

    it('professor cannot manage another professor\'s contest', () => {
      // anotherProfessor.id = 77, contest.createdBy = 42
      assert.equal(canManageContest(anotherProfessor, draftContest), false);
    });

    it('student cannot manage any contest', () => {
      assert.equal(canManageContest(student, draftContest), false);
    });

    it('unauthenticated user cannot manage any contest', () => {
      assert.equal(canManageContest(null, draftContest), false);
    });
  });

  describe('9. Duration Utility', () => {
    it('computes 2-hour contest duration correctly', () => {
      const start = new Date(now + 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const info = getDurationText(
        toDateTimeLocalString(start),
        toDateTimeLocalString(end)
      );
      assert.ok(info, 'should have duration info');
      assert.equal(info.totalMinutes, 120);
      assert.equal(info.text, '2h');
    });

    it('returns null for end before start', () => {
      const start = new Date(now + 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() - 60000);
      const info = getDurationText(
        toDateTimeLocalString(start),
        toDateTimeLocalString(end)
      );
      assert.equal(info, null);
    });

    it('returns null when start string is empty', () => {
      const info = getDurationText('', '2026-12-01T10:00');
      assert.equal(info, null);
    });
  });

});
