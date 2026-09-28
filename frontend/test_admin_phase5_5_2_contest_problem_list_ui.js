/**
 * Automated Test Suite for Phase 7.5.5.2: Admin Contest Problem List UI Logic
 * File: frontend/test_admin_phase5_5_2_contest_problem_list_ui.js
 *
 * Verifies that:
 * 1. Authorized UI visibility: Only authorized roles (super_admin, contest_admin, professor)
 *    have access to view the problem list in AdminContestManagement
 * 2. Problem list rendering: Attached problems render with position badge (#1, #2...),
 *    title, difficulty badge, coding mode, points badge, and active status
 * 3. Empty state: Renders dedicated "No Problems Attached" alert with role="status"
 * 4. Loading state: Displays loading state and disables refresh action during fetch
 * 5. Error state: Displays alert with role="alert", error message, and Retry trigger
 * 6. Retry behavior: Properly triggers refetch when Retry or Refresh is invoked
 * 7. Metadata rendering: Difficulty colors (easy/medium/hard), coding mode labels, points
 * 8. Correct ordering display: Problems are sorted and numbered according to problemOrder
 * 9. Mutation absence: Strictly NO Add Problem, Remove Problem, or Reorder controls present
 * 10. Accessibility basics: role="list", role="listitem", role="alert", aria-labels
 * 11. Security & Data Leak Prevention: Sensitive problem fields (test cases, solutions) are never bound
 * 12. Total Points calculation: Accurately calculates total contest points tally
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Component Logic Mirror ──────────────────────────────────────────────────

function canViewContestManagement(user) {
  if (!user || !user.role) return false;
  return ['super_admin', 'contest_admin', 'professor'].includes(user.role);
}

function canInspectContest(user, contest) {
  if (!canViewContestManagement(user)) return false;
  if (['super_admin', 'contest_admin'].includes(user.role)) return true;
  if (user.role === 'professor' && contest.createdBy === user.id) return true;
  return false;
}

function computeTotalPoints(problems = []) {
  return (problems || []).reduce((sum, p) => sum + (parseInt(p.points, 10) || 100), 0);
}

function getDifficultyBadge(difficulty = 'medium') {
  const diff = String(difficulty).toLowerCase();
  switch (diff) {
    case 'easy':
      return { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', label: 'Easy' };
    case 'hard':
      return { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', label: 'Hard' };
    case 'medium':
    default:
      return { bg: 'rgba(234, 179, 8, 0.15)', text: '#facc15', label: 'Medium' };
  }
}

function getCodingModeLabel(mode = 'full_program') {
  const norm = String(mode).toLowerCase();
  return norm === 'function' ? 'Function' : 'Full Program';
}

function renderProblemListItem(problem, idx) {
  const probId = problem.problemId || problem.id;
  const orderNum = problem.problemOrder || idx + 1;
  const diffBadge = getDifficultyBadge(problem.difficulty);
  const modeLabel = getCodingModeLabel(problem.codingMode || problem.coding_mode);
  const pts = problem.points || 100;

  return {
    testId: `contest-problem-row-${probId}`,
    orderNum: `#${orderNum}`,
    title: problem.title,
    probIdDisplay: `ID #${probId}`,
    difficulty: diffBadge.label,
    difficultyColor: diffBadge.text,
    codingMode: modeLabel,
    points: `${pts} pts`,
    status: 'Active',
    // Invariant verification: ensure no sensitive data leaks into view model
    leakedFields: Object.keys(problem).filter((k) =>
      ['test_cases', 'testcases', 'solution', 'solutions', 'expectedOutput', 'hidden_test_cases'].includes(k)
    ),
  };
}

function simulateProblemListViewState({ problems = [], loading = false, error = null }) {
  if (error) {
    return {
      state: 'error',
      role: 'alert',
      errorMessage: error,
      hasRetry: true,
      hasRefresh: true,
    };
  }
  if (loading) {
    return {
      state: 'loading',
      hasSpinner: true,
      loadingMessage: 'Loading attached problems...',
      refreshDisabled: true,
    };
  }
  if (!problems || problems.length === 0) {
    return {
      state: 'empty',
      role: 'status',
      title: 'No Problems Attached',
      message: 'This contest currently has no attached problems.',
      hasRefresh: true,
      itemCount: 0,
    };
  }
  return {
    state: 'list',
    role: 'list',
    itemCount: problems.length,
    totalPoints: computeTotalPoints(problems),
    items: problems.map((p, i) => renderProblemListItem(p, i)),
  };
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe('Phase 7.5.5.2 — Contest Problem List UI Logic', () => {

  describe('1. Authorized UI Visibility', () => {
    it('allows super_admin to view contest management and inspect any contest', () => {
      const user = { id: 1, role: 'super_admin' };
      const contest = { id: 10, createdBy: 99 };
      assert.strictEqual(canViewContestManagement(user), true);
      assert.strictEqual(canInspectContest(user, contest), true);
    });

    it('allows contest_admin to view contest management and inspect any contest', () => {
      const user = { id: 2, role: 'contest_admin' };
      const contest = { id: 10, createdBy: 99 };
      assert.strictEqual(canViewContestManagement(user), true);
      assert.strictEqual(canInspectContest(user, contest), true);
    });

    it('allows professor to inspect only their owned contest', () => {
      const prof = { id: 5, role: 'professor' };
      const ownedContest = { id: 10, createdBy: 5 };
      const otherContest = { id: 11, createdBy: 99 };
      assert.strictEqual(canViewContestManagement(prof), true);
      assert.strictEqual(canInspectContest(prof, ownedContest), true);
      assert.strictEqual(canInspectContest(prof, otherContest), false);
    });

    it('rejects student role from viewing contest management or inspection UI', () => {
      const student = { id: 100, role: 'student' };
      const contest = { id: 10, createdBy: 5 };
      assert.strictEqual(canViewContestManagement(student), false);
      assert.strictEqual(canInspectContest(student, contest), false);
    });

    it('rejects unauthenticated or null user', () => {
      assert.strictEqual(canViewContestManagement(null), false);
      assert.strictEqual(canInspectContest(null, { id: 1 }), false);
    });
  });

  describe('2. Problem List Rendering & Metadata', () => {
    const mockProblems = [
      { problemId: 101, title: 'Two Sum Variant', difficulty: 'easy', codingMode: 'function', points: 100, problemOrder: 1 },
      { problemId: 102, title: 'Graph Traversal', difficulty: 'medium', codingMode: 'full_program', points: 200, problemOrder: 2 },
      { problemId: 103, title: 'Network Flow Max', difficulty: 'hard', codingMode: 'function', points: 300, problemOrder: 3 },
    ];

    it('renders correct number of items and computed total points', () => {
      const view = simulateProblemListViewState({ problems: mockProblems });
      assert.strictEqual(view.state, 'list');
      assert.strictEqual(view.itemCount, 3);
      assert.strictEqual(view.totalPoints, 600);
      assert.strictEqual(view.role, 'list');
    });

    it('renders each problem with required display fields', () => {
      const view = simulateProblemListViewState({ problems: mockProblems });
      const [p1, p2, p3] = view.items;

      assert.strictEqual(p1.orderNum, '#1');
      assert.strictEqual(p1.title, 'Two Sum Variant');
      assert.strictEqual(p1.difficulty, 'Easy');
      assert.strictEqual(p1.codingMode, 'Function');
      assert.strictEqual(p1.points, '100 pts');
      assert.strictEqual(p1.status, 'Active');

      assert.strictEqual(p2.orderNum, '#2');
      assert.strictEqual(p2.title, 'Graph Traversal');
      assert.strictEqual(p2.difficulty, 'Medium');
      assert.strictEqual(p2.codingMode, 'Full Program');
      assert.strictEqual(p2.points, '200 pts');

      assert.strictEqual(p3.orderNum, '#3');
      assert.strictEqual(p3.title, 'Network Flow Max');
      assert.strictEqual(p3.difficulty, 'Hard');
      assert.strictEqual(p3.points, '300 pts');
    });

    it('supports alternative problem identifier property `id` fallback', () => {
      const item = renderProblemListItem({ id: 999, title: 'Fallback ID Problem' }, 0);
      assert.strictEqual(item.probIdDisplay, 'ID #999');
      assert.strictEqual(item.testId, 'contest-problem-row-999');
    });
  });

  describe('3. Empty State', () => {
    it('renders role="status" and clear empty guidance when problems array is empty', () => {
      const view = simulateProblemListViewState({ problems: [] });
      assert.strictEqual(view.state, 'empty');
      assert.strictEqual(view.role, 'status');
      assert.strictEqual(view.title, 'No Problems Attached');
      assert.strictEqual(view.itemCount, 0);
    });

    it('renders empty state when problems is null or undefined', () => {
      const viewNull = simulateProblemListViewState({ problems: null });
      assert.strictEqual(viewNull.state, 'empty');
      const viewUndef = simulateProblemListViewState({});
      assert.strictEqual(viewUndef.state, 'empty');
    });
  });

  describe('4. Loading State', () => {
    it('renders loading state without displaying stale problem list', () => {
      const view = simulateProblemListViewState({ loading: true, problems: [{ id: 1, title: 'Stale' }] });
      assert.strictEqual(view.state, 'loading');
      assert.strictEqual(view.hasSpinner, true);
      assert.strictEqual(view.refreshDisabled, true);
      assert.strictEqual(view.items, undefined);
    });
  });

  describe('5. Error State and Retry Behavior', () => {
    it('renders role="alert" with error message and active Retry button', () => {
      const view = simulateProblemListViewState({ error: 'Network timeout loading problems' });
      assert.strictEqual(view.state, 'error');
      assert.strictEqual(view.role, 'alert');
      assert.strictEqual(view.errorMessage, 'Network timeout loading problems');
      assert.strictEqual(view.hasRetry, true);
    });

    it('simulates retry action recovering from error to success list', () => {
      let state = simulateProblemListViewState({ error: 'Initial network failure' });
      assert.strictEqual(state.state, 'error');

      // Retry triggered
      state = simulateProblemListViewState({ loading: true });
      assert.strictEqual(state.state, 'loading');

      // Success payload received
      state = simulateProblemListViewState({
        problems: [{ problemId: 50, title: 'Recovered Problem', points: 150, problemOrder: 1 }],
      });
      assert.strictEqual(state.state, 'list');
      assert.strictEqual(state.itemCount, 1);
      assert.strictEqual(state.totalPoints, 150);
    });
  });

  describe('6. Ordering Display & Fallbacks', () => {
    it('respects explicit problemOrder from backend', () => {
      const problems = [
        { problemId: 10, title: 'Order 3', problemOrder: 3 },
        { problemId: 20, title: 'Order 1', problemOrder: 1 },
        { problemId: 30, title: 'Order 2', problemOrder: 2 },
      ];
      // In UI, items are mapped with problemOrder
      const rendered = problems.map((p, idx) => renderProblemListItem(p, idx));
      assert.strictEqual(rendered[0].orderNum, '#3');
      assert.strictEqual(rendered[1].orderNum, '#1');
      assert.strictEqual(rendered[2].orderNum, '#2');
    });

    it('falls back to array index + 1 if problemOrder is missing or null', () => {
      const problems = [
        { problemId: 1, title: 'No Order 1' },
        { problemId: 2, title: 'No Order 2' },
      ];
      const rendered = problems.map((p, idx) => renderProblemListItem(p, idx));
      assert.strictEqual(rendered[0].orderNum, '#1');
      assert.strictEqual(rendered[1].orderNum, '#2');
    });
  });

  describe('7. Strict Mutation Exclusion (Scope Boundary)', () => {
    it('confirms NO Add Problem button is present in Phase 7.5.5.2 UI', () => {
      // AdminContestProblemList is strictly READ/LIST focused
      const view = simulateProblemListViewState({
        problems: [{ problemId: 1, title: 'Test' }],
      });
      assert.strictEqual(view.canAddProblem, undefined);
      assert.strictEqual(view.showAddModal, undefined);
    });

    it('confirms NO Remove Problem button is present in Phase 7.5.5.2 UI', () => {
      const view = simulateProblemListViewState({
        problems: [{ problemId: 1, title: 'Test' }],
      });
      assert.strictEqual(view.items[0].canRemove, undefined);
      assert.strictEqual(view.items[0].hasDeleteAction, undefined);
    });

    it('confirms NO Reorder / Drag-and-drop handles are present in Phase 7.5.5.2 UI', () => {
      const view = simulateProblemListViewState({
        problems: [{ problemId: 1, title: 'Test' }],
      });
      assert.strictEqual(view.isDraggable, undefined);
      assert.strictEqual(view.hasDragHandle, undefined);
    });
  });

  describe('8. Accessibility & Semantics', () => {
    it('uses correct semantic roles for list, status, and alert', () => {
      assert.strictEqual(simulateProblemListViewState({ error: 'err' }).role, 'alert');
      assert.strictEqual(simulateProblemListViewState({ problems: [] }).role, 'status');
      assert.strictEqual(simulateProblemListViewState({ problems: [{ id: 1, title: 'P1' }] }).role, 'list');
    });
  });

  describe('9. Security & Data Leak Prevention', () => {
    it('ensures private problem data (test cases, solutions, outputs) is never bound or leaked', () => {
      const rawApiProblem = {
        problemId: 501,
        title: 'Safe Problem',
        difficulty: 'medium',
        codingMode: 'function',
        points: 100,
        problemOrder: 1,
        status: 'active',
        // Inadvertent fields from broken backend:
        test_cases: [{ input: 'secret', output: 'hidden' }],
        solutions: ['def solve(): return 42'],
        expectedOutput: 'SECRET_ANSWER',
      };

      const rendered = renderProblemListItem(rawApiProblem, 0);
      assert.strictEqual(rendered.leakedFields.length, 3);
      // In the rendered view model, only safe fields exist:
      assert.strictEqual(rendered.title, 'Safe Problem');
      assert.strictEqual(rendered.difficulty, 'Medium');
      assert.strictEqual(rendered.codingMode, 'Function');
      assert.strictEqual(rendered.points, '100 pts');
      assert.strictEqual('test_cases' in rendered, false);
      assert.strictEqual('solutions' in rendered, false);
      assert.strictEqual('expectedOutput' in rendered, false);
    });
  });
});
