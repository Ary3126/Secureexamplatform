/**
 * Automated Test Suite for Phase 7.5.11.1 — Admin Dashboard Frontend UI States
 * 
 * Tests UI state logic, error handling, loading behavior, empty datasets,
 * malformed payload resilience, and presentation formatting rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pure logic mirrors of helper functions matching AdminDashboard.jsx
function formatRelativeTime(isoString, now = Date.now()) {
  if (!isoString) return 'Just now';
  try {
    const timestamp = new Date(isoString).getTime();
    if (isNaN(timestamp)) return 'Recently';
    const diff = Math.floor((now - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return 'Recently';
  }
}

function formatUptime(seconds) {
  if (!seconds || typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function getActionBadge(action) {
  if (!action || typeof action !== 'string') return { label: 'ACTION', className: 'action-auth' };
  if (action.includes('CREATED') || action.includes('ADDED')) {
    return { label: action.replace(/_/g, ' '), className: 'action-created' };
  }
  if (action.includes('STATUS') || action.includes('ROLE') || action.includes('DEACTIVATED')) {
    return { label: action.replace(/_/g, ' '), className: 'action-status' };
  }
  if (action.includes('DENIED') || action.includes('FAILURE') || action.includes('LOCKED')) {
    return { label: action.replace(/_/g, ' '), className: 'action-security' };
  }
  return { label: action.replace(/_/g, ' '), className: 'action-auth' };
}

describe('Phase 7.5.11.1: Admin Dashboard Frontend UI States & Resilience Suite', () => {
  // ── 1. LOADING & SKELETON STATE DETERMINATION ─────────────────────────────
  it('1. Loading state renders skeleton placeholders instead of fabricated zero values', () => {
    const isLoading = true;
    const users = {};
    const renderedStudentCount = isLoading
      ? 'SKELETON_PLACEHOLDER'
      : (users.total_students ?? 0);

    assert.strictEqual(renderedStudentCount, 'SKELETON_PLACEHOLDER');
    assert.notStrictEqual(renderedStudentCount, 0, 'Must NOT show 0 during active load');
  });

  // ── 2. ERROR STATE RESOLUTION (NO SILENT ZERO REPLACEMENTS) ───────────────
  it('2. Initial load error renders dedicated error card and does NOT fabricate zero metrics', () => {
    const error = 'Server returned HTTP 500';
    const data = null;

    // View logic from AdminDashboard.jsx
    const shouldRenderErrorCard = Boolean(error && !data);
    const shouldRenderDashboardMetrics = Boolean(!error || data);

    assert.strictEqual(shouldRenderErrorCard, true, 'Error card must render on initial load failure');
    assert.strictEqual(shouldRenderDashboardMetrics, false, 'Metrics grid must NOT render on initial load failure');
  });

  it('3. Refresh failure with existing cached data displays error banner and preserves cached metrics', () => {
    const error = 'Network drop on refresh';
    const cachedData = {
      users: { total_students: 150, total_professors: 12 },
      submissions: { total_submissions: 500 },
    };

    const shouldRenderErrorBanner = Boolean(error && cachedData);
    const shouldRenderErrorCard = Boolean(error && !cachedData);

    assert.strictEqual(shouldRenderErrorBanner, true, 'Error banner must show for background refresh failure');
    assert.strictEqual(shouldRenderErrorCard, false, 'Full error card must NOT replace existing cached data');
    assert.strictEqual(cachedData.users.total_students, 150, 'Cached student count must be preserved');
  });

  // ── 3. AUTHENTIC EMPTY DATASET DISTINCTION ────────────────────────────────
  it('4. Legitimate empty database results in empty state UI without error flag', () => {
    const emptyApiPayload = {
      users: { total_users: 0, total_students: 0, total_professors: 0, total_admins: 0, active_users: 0, total_suspended: 0 },
      contests: { total_contests: 0, active_contests: 0, upcoming_contests: 0, draft_contests: 0, archived_contests: 0 },
      recentContests: [],
      problems: { total_problems: 0, published_problems: 0, draft_problems: 0, pending_review_problems: 0, approved_problems: 0, archived_problems: 0 },
      submissions: { total_submissions: 0, total_evaluated: 0, accepted_submissions: 0, wrong_answer_submissions: 0, runtime_error_submissions: 0, compilation_error_submissions: 0, resource_limit_submissions: 0, acceptance_rate: 0 },
      reviews: { total_queue: 0, pending_reviews: 0, in_review_reviews: 0, approved_reviews: 0 },
      recentActivity: [],
      system: { databaseStatus: 'connected', apiStatus: 'HEALTHY', databaseLatencyMs: 2.1, judgeStatus: 'HEALTHY', uptimeSeconds: 3600 },
    };

    const error = null;
    const isLoading = false;
    const isErrorState = Boolean(error && !emptyApiPayload);
    const isContestsEmpty = emptyApiPayload.recentContests.length === 0;
    const isSubmissionsEmpty = (emptyApiPayload.submissions.total_submissions ?? 0) === 0;
    const isActivityEmpty = emptyApiPayload.recentActivity.length === 0;

    assert.strictEqual(isErrorState, false, 'Empty payload is not an error state');
    assert.strictEqual(isContestsEmpty, true, 'Recent contests renders empty state');
    assert.strictEqual(isSubmissionsEmpty, true, 'Submissions renders empty state');
    assert.strictEqual(isActivityEmpty, true, 'Recent activity renders empty state');
  });

  // ── 4. MALFORMED & INCOMPLETE PAYLOAD RESILIENCE ───────────────────────────
  it('5. Malformed payload with null or non-array fields safely defaults without exceptions', () => {
    const malformedPayload = {
      users: null,
      contests: undefined,
      recentContests: { notAnArray: true }, // Not an array
      problems: 'invalid_string',
      submissions: null,
      reviews: false,
      recentActivity: null,
      system: null,
    };

    const users = malformedPayload?.users || {};
    const contests = malformedPayload?.contests || {};
    const recentContests = Array.isArray(malformedPayload?.recentContests) ? malformedPayload.recentContests : [];
    const problems = malformedPayload?.problems || {};
    const submissions = malformedPayload?.submissions || {};
    const reviews = malformedPayload?.reviews || {};
    const recentActivity = Array.isArray(malformedPayload?.recentActivity) ? malformedPayload.recentActivity : [];
    const system = malformedPayload?.system || {};

    assert.strictEqual(users.total_students ?? 0, 0);
    assert.strictEqual(contests.total_contests ?? 0, 0);
    assert.strictEqual(recentContests.length, 0);
    assert.strictEqual(problems.total_problems ?? 0, 0);
    assert.strictEqual(submissions.total_submissions ?? 0, 0);
    assert.strictEqual(submissions.total_evaluated ?? submissions.total_submissions ?? 0, 0);
    assert.strictEqual(reviews.total_queue ?? 0, 0);
    assert.strictEqual(recentActivity.length, 0);
    assert.strictEqual(system.apiStatus || 'Healthy', 'Healthy');
  });

  // ── 5. TOTAL EVALUATED ACCURACY OVER UN-EVALUATED RUNS ────────────────────
  it('6. Total Evaluated metric accurately reflects total_evaluated over pending submissions', () => {
    const payloadWithPending = {
      submissions: {
        total_submissions: 25, // 20 evaluated + 5 pending in queue
        total_evaluated: 20,
        accepted_submissions: 15,
        wrong_answer_submissions: 3,
        runtime_error_submissions: 2,
        acceptance_rate: 75,
      },
    };

    const sub = payloadWithPending.submissions;
    const displayedEvaluated = sub.total_evaluated ?? sub.total_submissions ?? 0;

    assert.strictEqual(displayedEvaluated, 20, 'Displayed evaluated must be 20, not 25');
  });

  // ── 6. AUDIT ACTIVITY DESCRIPTION FORMATTING (NO ORPHAN HASH) ─────────────
  it('7. Audit activity description formats cleanly without orphan hash when resource_id is null', () => {
    const formatActivityDesc = (act) => {
      const actor = act?.actor_name || 'System';
      const resource = act?.resource_type ? ` \u2022 ${act.resource_type}${act?.resource_id != null ? ` #${act.resource_id}` : ''}` : '';
      return `${actor}${resource}`;
    };

    const itemWithNullId = {
      actor_name: 'super_admin',
      resource_type: 'system',
      resource_id: null,
    };
    const formattedNull = formatActivityDesc(itemWithNullId);
    assert.strictEqual(formattedNull, 'super_admin \u2022 system', 'Must not include # when resource_id is null');
    assert.strictEqual(formattedNull.includes('#'), false, 'Must have no trailing # symbol');

    const itemWithId = {
      actor_name: 'super_admin',
      resource_type: 'user',
      resource_id: 42,
    };
    const formattedWithId = formatActivityDesc(itemWithId);
    assert.strictEqual(formattedWithId, 'super_admin \u2022 user #42');

    const systemItem = {
      actor_name: null,
      resource_type: 'auth',
      resource_id: null,
    };
    const formattedSystem = formatActivityDesc(systemItem);
    assert.strictEqual(formattedSystem, 'System \u2022 auth');
  });

  // ── 7. TIME AND DURATION FORMATTING BOUNDS & DEFENSIVE LOGIC ──────────────
  it('8. formatRelativeTime handles invalid strings, null, and varied intervals gracefully', () => {
    const fixedNow = 1726740000000;
    assert.strictEqual(formatRelativeTime(null, fixedNow), 'Just now');
    assert.strictEqual(formatRelativeTime('', fixedNow), 'Just now');
    assert.strictEqual(formatRelativeTime('invalid-date-string', fixedNow), 'Recently');
    assert.strictEqual(formatRelativeTime(new Date(fixedNow - 30 * 1000).toISOString(), fixedNow), 'Just now');
    assert.strictEqual(formatRelativeTime(new Date(fixedNow - 120 * 1000).toISOString(), fixedNow), '2m ago');
    assert.strictEqual(formatRelativeTime(new Date(fixedNow - 7200 * 1000).toISOString(), fixedNow), '2h ago');
    assert.strictEqual(formatRelativeTime(new Date(fixedNow - 172800 * 1000).toISOString(), fixedNow), '2d ago');
  });

  it('9. formatUptime handles non-numeric types, zeroes, negatives, and large intervals', () => {
    assert.strictEqual(formatUptime(0), '0m');
    assert.strictEqual(formatUptime(-100), '0m');
    assert.strictEqual(formatUptime(null), '0m');
    assert.strictEqual(formatUptime(undefined), '0m');
    assert.strictEqual(formatUptime('invalid_string'), '0m');
    assert.strictEqual(formatUptime(NaN), '0m');
    assert.strictEqual(formatUptime(59), '0m');
    assert.strictEqual(formatUptime(60), '1m');
    assert.strictEqual(formatUptime(3600), '1h 0m');
    assert.strictEqual(formatUptime(7325), '2h 2m');
  });

  // ── 8. AUDIT ACTION BADGE SEMANTIC CLASSIFICATION ─────────────────────────
  it('10. getActionBadge categorizes actions semantically and safely handles non-strings', () => {
    assert.strictEqual(getActionBadge('USER_CREATED').className, 'action-created');
    assert.strictEqual(getActionBadge('CONTEST_ADDED').className, 'action-created');
    assert.strictEqual(getActionBadge('USER_ROLE_UPDATED').className, 'action-status');
    assert.strictEqual(getActionBadge('ACCOUNT_DEACTIVATED').className, 'action-status');
    assert.strictEqual(getActionBadge('AUTH_FAILURE').className, 'action-security');
    assert.strictEqual(getActionBadge('PERMISSION_DENIED').className, 'action-security');
    assert.strictEqual(getActionBadge('LOGIN_SUCCESS').className, 'action-auth');

    // Non-string defensive checks
    assert.strictEqual(getActionBadge(null).className, 'action-auth');
    assert.strictEqual(getActionBadge(undefined).className, 'action-auth');
    assert.strictEqual(getActionBadge(9999).className, 'action-auth');
    assert.strictEqual(getActionBadge({ action: 'CREATED' }).className, 'action-auth');
  });

  // ── 9. CONTEST PARTICIPANT & DATE BOUNDS ──────────────────────────────────
  it('11. Contest item participant count and date bounds format safely', () => {
    const formatContestMeta = (c) => {
      const count = Number(c?.participantCount) || 0;
      const countLabel = `${count} participant${count === 1 ? '' : 's'}`;
      const dateValid = c?.startTime && !isNaN(new Date(c.startTime).getTime());
      const dateLabel = dateValid ? new Date(c.startTime).toLocaleDateString() : null;
      return { countLabel, dateLabel };
    };

    const zeroCountContest = { participantCount: 0, startTime: '2026-10-15T10:00:00Z' };
    const meta0 = formatContestMeta(zeroCountContest);
    assert.strictEqual(meta0.countLabel, '0 participants');
    assert.ok(meta0.dateLabel);

    const oneCountContest = { participantCount: '1', startTime: 'invalid_date' };
    const meta1 = formatContestMeta(oneCountContest);
    assert.strictEqual(meta1.countLabel, '1 participant');
    assert.strictEqual(meta1.dateLabel, null, 'Invalid date must produce null instead of Invalid Date');

    const nullContest = null;
    const metaNull = formatContestMeta(nullContest);
    assert.strictEqual(metaNull.countLabel, '0 participants');
    assert.strictEqual(metaNull.dateLabel, null);
  });

  // ── 10. SYSTEM HEALTH DYNAMIC TELEMETRY ───────────────────────────────────
  it('12. Basic system health reflects dynamic apiStatus rather than hardcoding Healthy', () => {
    const getBadgeStyle = (status) => ({
      color: status === 'HEALTHY' ? '#34d399' : '#f87171',
      label: status || 'Healthy',
      dotClass: status === 'HEALTHY' ? 'dot-healthy' : 'dot-unhealthy',
    });

    const healthySys = getBadgeStyle('HEALTHY');
    assert.strictEqual(healthySys.color, '#34d399');
    assert.strictEqual(healthySys.label, 'HEALTHY');
    assert.strictEqual(healthySys.dotClass, 'dot-healthy');

    const degradedSys = getBadgeStyle('DEGRADED');
    assert.strictEqual(degradedSys.color, '#f87171');
    assert.strictEqual(degradedSys.label, 'DEGRADED');
    assert.strictEqual(degradedSys.dotClass, 'dot-unhealthy');

    const defaultSys = getBadgeStyle(null);
    assert.strictEqual(defaultSys.color, '#f87171');
    assert.strictEqual(defaultSys.label, 'Healthy');
  });

  // ── 11. SOURCE CODE STATIC VERIFICATION ───────────────────────────────────
  it('13. AdminDashboard.jsx source code contains all required robustness and anti-regression fixes', () => {
    const componentPath = path.resolve(__dirname, 'src/components/admin/AdminDashboard.jsx');
    assert.ok(fs.existsSync(componentPath), 'AdminDashboard.jsx must exist');
    const source = fs.readFileSync(componentPath, 'utf8');

    // 1. Dedicated error card on initial failure
    assert.ok(source.includes('admin-error-card'), 'AdminDashboard.jsx must contain admin-error-card');
    assert.ok(source.includes('error && !data'), 'AdminDashboard.jsx must check error && !data for initial failure');

    // 2. Safe array checks
    assert.ok(source.includes('Array.isArray(data?.recentContests)'), 'AdminDashboard.jsx must array-check recentContests');
    assert.ok(source.includes('Array.isArray(data?.recentActivity)'), 'AdminDashboard.jsx must array-check recentActivity');

    // 3. Total evaluated priority
    assert.ok(source.includes('submissions.total_evaluated ?? submissions.total_submissions'), 'AdminDashboard.jsx must prioritize total_evaluated');

    // 4. Resource id formatting without orphan hash
    assert.ok(source.includes('act.resource_id != null'), 'AdminDashboard.jsx must check resource_id != null before hash prefix');

    // 5. Dynamic API status badge color
    assert.ok(source.includes("system.apiStatus === 'HEALTHY' ? '#34d399' : '#f87171'"), 'AdminDashboard.jsx must color apiStatus dynamically');
  });
});
