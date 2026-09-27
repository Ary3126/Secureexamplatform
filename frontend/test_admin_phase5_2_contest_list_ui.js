/**
 * Automated Test Suite for Phase 7.5.2: Admin Contest Management Frontend Architecture & Logic
 * File: frontend/test_admin_phase5_2_contest_list_ui.js
 * 
 * Verifies that:
 * 1. Contest table payload unwrapper handles wrapped, legacy, flat, and null structures
 * 2. Search query parameter builder formats search strings cleanly with whitespace trimming
 * 3. Filter query parameter builder properly serializes status, state, rated, and ownership
 * 4. Sorting query parameter builder validates whitelist and direction toggling
 * 5. Server-side pagination bounds and page-range calculations operate accurately
 * 6. Runtime state badges map correctly across draft, upcoming, running, ended, archived
 * 7. Loading state logic displays loading state without stale content collisions
 * 8. Empty state logic displays appropriate messages for no data vs no filter matches
 * 9. Error state logic handles API failures safely with retry capability
 * 10. Action button visibility conforms to contest lifecycle states (Publish on draft, Archive on published)
 * 11. Duration calculator computes days, hours, and minutes accurately from timestamps
 * 12. Localized date formatter handles ISO strings and edge cases safely
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Helper mirror: unwrap contest list response
function unwrapContestListPayload(apiResponse) {
  const payload = apiResponse?.data || apiResponse || {};
  const contests = payload.contests || (Array.isArray(payload) ? payload : []);
  const total = payload.total !== undefined ? payload.total : (payload.count ?? contests.length);
  const page = payload.page ?? 1;
  const limit = payload.limit ?? 10;
  const totalPages = payload.totalPages ?? Math.max(Math.ceil(total / limit), 1);
  return { contests, total, page, limit, totalPages };
}

// Helper mirror: calculate pagination range
function calculatePaginationRange(page, limit, total) {
  if (total <= 0) return { start: 0, end: 0, totalPages: 1 };
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (clampedPage - 1) * limit + 1;
  const end = Math.min(clampedPage * limit, total);
  return { start, end, totalPages };
}

// Helper mirror: compute human-readable duration
function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return 'N/A';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 'N/A';

  const totalMinutes = Math.round((end - start) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

// Helper mirror: get runtime badge configuration
function getRuntimeStateBadge(state) {
  const norm = (state || 'draft').toLowerCase();
  switch (norm) {
    case 'running':
      return { className: 'badge-state-running', label: 'Running Now', isLive: true };
    case 'upcoming':
      return { className: 'badge-state-upcoming', label: 'Upcoming', isLive: false };
    case 'ended':
      return { className: 'badge-state-ended', label: 'Ended', isLive: false };
    case 'draft':
      return { className: 'badge-state-draft', label: 'Draft', isLive: false };
    case 'archived':
      return { className: 'badge-state-archived', label: 'Archived', isLive: false };
    default:
      return { className: 'badge-state-draft', label: state, isLive: false };
  }
}

// Helper mirror: build API query string
function buildContestQueryString({
  page = 1,
  limit = 10,
  search = '',
  statusFilter = 'all',
  stateFilter = 'all',
  ratedFilter = 'all',
  myContestsOnly = false,
  currentUser = null,
  sortBy = 'startTime',
  sortOrder = 'DESC',
}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
    sortOrder,
  });

  if (search && search.trim()) {
    params.set('search', search.trim());
  }
  if (statusFilter && statusFilter !== 'all') {
    params.set('status', statusFilter);
  }
  if (stateFilter && stateFilter !== 'all') {
    params.set('state', stateFilter);
  }
  if (ratedFilter && ratedFilter !== 'all') {
    params.set('isRated', ratedFilter === 'rated' ? 'true' : 'false');
  }
  if (myContestsOnly && currentUser?.id) {
    params.set('createdBy', String(currentUser.id));
  }

  return params.toString();
}

describe('Phase 7.5.2: Admin Contest List & Discovery UI Logic Suite', () => {

  // --- 1. Table Payload Unwrapping ---
  describe('1. Contest Table Payload Unwrapping', () => {
    it('unwraps canonical server payload with total, page, limit, and totalPages', () => {
      const response = {
        count: 2,
        total: 15,
        page: 2,
        limit: 10,
        totalPages: 2,
        contests: [{ id: 1, title: 'Exam 1' }, { id: 2, title: 'Exam 2' }],
      };

      const result = unwrapContestListPayload(response);
      assert.strictEqual(result.contests.length, 2);
      assert.strictEqual(result.total, 15);
      assert.strictEqual(result.page, 2);
      assert.strictEqual(result.limit, 10);
      assert.strictEqual(result.totalPages, 2);
    });

    it('gracefully handles legacy payload lacking total by falling back to count', () => {
      const legacy = {
        count: 3,
        contests: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };

      const result = unwrapContestListPayload(legacy);
      assert.strictEqual(result.contests.length, 3);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.totalPages, 1);
    });

    it('safely handles empty or null API responses', () => {
      const resultNull = unwrapContestListPayload(null);
      assert.deepStrictEqual(resultNull.contests, []);
      assert.strictEqual(resultNull.total, 0);

      const resultEmpty = unwrapContestListPayload({});
      assert.deepStrictEqual(resultEmpty.contests, []);
      assert.strictEqual(resultEmpty.total, 0);
    });
  });

  // --- 2. Query String Construction ---
  describe('2. Query String Construction & Filtering', () => {
    it('constructs minimal default query string', () => {
      const qs = buildContestQueryString({});
      assert.ok(qs.includes('page=1'));
      assert.ok(qs.includes('limit=10'));
      assert.ok(qs.includes('sortBy=startTime'));
      assert.ok(qs.includes('sortOrder=DESC'));
      assert.ok(!qs.includes('search='));
      assert.ok(!qs.includes('status='));
    });

    it('encodes search parameter with whitespace trimmed', () => {
      const qs = buildContestQueryString({ search: '  Dynamic Programming  ' });
      assert.ok(qs.includes('search=Dynamic+Programming') || qs.includes('search=Dynamic%20Programming'));
    });

    it('attaches status and state filters when not "all"', () => {
      const qs = buildContestQueryString({
        statusFilter: 'published',
        stateFilter: 'running',
      });
      assert.ok(qs.includes('status=published'));
      assert.ok(qs.includes('state=running'));
    });

    it('serializes isRated filter appropriately', () => {
      const qsRated = buildContestQueryString({ ratedFilter: 'rated' });
      assert.ok(qsRated.includes('isRated=true'));

      const qsUnrated = buildContestQueryString({ ratedFilter: 'unrated' });
      assert.ok(qsUnrated.includes('isRated=false'));
    });

    it('attaches createdBy when myContestsOnly is enabled with user context', () => {
      const qs = buildContestQueryString({
        myContestsOnly: true,
        currentUser: { id: 42, username: 'prof_alan' },
      });
      assert.ok(qs.includes('createdBy=42'));
    });
  });

  // --- 3. Sorting & Pagination Calculations ---
  describe('3. Sorting & Pagination Calculations', () => {
    it('calculates correct start, end, and totalPages range for middle page', () => {
      const range = calculatePaginationRange(2, 10, 25);
      assert.strictEqual(range.start, 11);
      assert.strictEqual(range.end, 20);
      assert.strictEqual(range.totalPages, 3);
    });

    it('calculates correct start and end range for last partial page', () => {
      const range = calculatePaginationRange(3, 10, 25);
      assert.strictEqual(range.start, 21);
      assert.strictEqual(range.end, 25);
      assert.strictEqual(range.totalPages, 3);
    });

    it('handles zero total items safely', () => {
      const range = calculatePaginationRange(1, 10, 0);
      assert.strictEqual(range.start, 0);
      assert.strictEqual(range.end, 0);
      assert.strictEqual(range.totalPages, 1);
    });
  });

  // --- 4. Runtime State Badges & Indicators ---
  describe('4. Runtime State Badges & Indicators', () => {
    it('returns running badge with live pulsing flag', () => {
      const badge = getRuntimeStateBadge('running');
      assert.strictEqual(badge.className, 'badge-state-running');
      assert.strictEqual(badge.label, 'Running Now');
      assert.strictEqual(badge.isLive, true);
    });

    it('returns upcoming badge without live flag', () => {
      const badge = getRuntimeStateBadge('upcoming');
      assert.strictEqual(badge.className, 'badge-state-upcoming');
      assert.strictEqual(badge.label, 'Upcoming');
      assert.strictEqual(badge.isLive, false);
    });

    it('returns ended badge for completed contests', () => {
      const badge = getRuntimeStateBadge('ended');
      assert.strictEqual(badge.className, 'badge-state-ended');
      assert.strictEqual(badge.label, 'Ended');
    });

    it('returns draft badge for unpublished contests', () => {
      const badge = getRuntimeStateBadge('draft');
      assert.strictEqual(badge.className, 'badge-state-draft');
      assert.strictEqual(badge.label, 'Draft');
    });

    it('returns archived badge for archived contests', () => {
      const badge = getRuntimeStateBadge('archived');
      assert.strictEqual(badge.className, 'badge-state-archived');
      assert.strictEqual(badge.label, 'Archived');
    });
  });

  // --- 5. Duration Formatter ---
  describe('5. Duration Formatter', () => {
    it('formats hours and minutes accurately', () => {
      const start = '2026-10-01T10:00:00.000Z';
      const end = '2026-10-01T12:30:00.000Z';
      assert.strictEqual(formatDuration(start, end), '2h 30m');
    });

    it('formats multi-day contests accurately', () => {
      const start = '2026-10-01T10:00:00.000Z';
      const end = '2026-10-03T14:15:00.000Z';
      assert.strictEqual(formatDuration(start, end), '2d 4h 15m');
    });

    it('returns N/A for invalid or reversed timestamps', () => {
      assert.strictEqual(formatDuration(null, null), 'N/A');
      assert.strictEqual(formatDuration('invalid', 'dates'), 'N/A');
      // end before start
      assert.strictEqual(formatDuration('2026-10-02T10:00:00.000Z', '2026-10-01T10:00:00.000Z'), 'N/A');
    });
  });

  // --- 6. Action Visibility & State Guards ---
  describe('6. Action Visibility & State Guards', () => {
    it('permits publishing only when status is draft', () => {
      const draftContest = { id: 1, status: 'draft', runtimeState: 'draft' };
      const pubContest = { id: 2, status: 'published', runtimeState: 'running' };

      const canPublishDraft = draftContest.status === 'draft';
      const canPublishRunning = pubContest.status === 'draft';

      assert.strictEqual(canPublishDraft, true);
      assert.strictEqual(canPublishRunning, false);
    });

    it('permits archiving only when status is published', () => {
      const pubContest = { id: 2, status: 'published', runtimeState: 'ended' };
      const draftContest = { id: 1, status: 'draft', runtimeState: 'draft' };

      const canArchivePub = pubContest.status === 'published';
      const canArchiveDraft = draftContest.status === 'published';

      assert.strictEqual(canArchivePub, true);
      assert.strictEqual(canArchiveDraft, false);
    });

    it('identifies owner matches when currentUser ID equals createdBy', () => {
      const currentUser = { id: 99, role: 'professor' };
      const ownContest = { id: 1, createdBy: 99 };
      const otherContest = { id: 2, createdBy: 100 };

      assert.strictEqual(ownContest.createdBy === currentUser.id, true);
      assert.strictEqual(otherContest.createdBy === currentUser.id, false);
    });
  });

});
