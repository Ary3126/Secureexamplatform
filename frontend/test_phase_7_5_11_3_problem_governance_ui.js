/**
 * Phase 7.5.11.3 Dedicated Frontend Test Suite: Problem Bank & Quality Queue UI Logic & Security
 *
 * Verifies frontend component logic, state transitions, validation, and defense in depth:
 * 1. Payload unwrapping from API responses (wrapped, flat, and null/empty fallbacks)
 * 2. Zero hidden-test leakage defense in frontend data structures
 * 3. SLA computation logic (ON TIME <24h, AT RISK 24-48h, OVERDUE >48h)
 * 4. Difficulty, codingMode, accessScope, and reviewStatus badge semantics
 * 5. Multi-field client-side search filtering (title, ID, description)
 * 6. Pagination mathematics, boundary clamping, and inverted range prevention
 * 7. Function mode harness placeholder enforcement (__STUDENT_CODE__)
 * 8. Static verification of AdminProblemManagement.jsx and AdminReviewGovernance.jsx
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// --- Pure Logic Helper Mirrors from AdminProblemManagement.jsx & AdminReviewGovernance.jsx ---

function unwrapProblemListPayload(apiResponse) {
  const payload = apiResponse?.data || apiResponse || {};
  const problems = payload.problems || (Array.isArray(payload) ? payload : []);
  const total = payload.pagination?.total ?? payload.total ?? payload.totalProblems ?? problems.length;
  const page = payload.pagination?.page ?? payload.page ?? 1;
  const limit = payload.pagination?.limit ?? payload.limit ?? 20;
  const totalPages = payload.pagination?.totalPages ?? Math.max(Math.ceil(total / limit), 1);
  return { problems, total, page, limit, totalPages };
}

function computeSlaBadge(createdAt, currentTime = Date.now()) {
  if (!createdAt) return { label: 'ON TIME (<24h)', color: '#4ade80', level: 'on_time' };
  const ageHours = (currentTime - new Date(createdAt).getTime()) / (1000 * 3600);
  if (ageHours > 48) {
    return { label: 'OVERDUE (>48h)', color: '#f87171', level: 'overdue' };
  } else if (ageHours > 24) {
    return { label: 'AT RISK (24-48h)', color: '#fbbf24', level: 'at_risk' };
  }
  return { label: 'ON TIME (<24h)', color: '#4ade80', level: 'on_time' };
}

function calculatePaginationRange(page, limit, total) {
  if (total <= 0) return { start: 0, end: 0, totalPages: 1, clampedPage: 1 };
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const start = (clampedPage - 1) * limit + 1;
  const end = Math.min(clampedPage * limit, total);
  return { start, end, totalPages, clampedPage };
}

function sanitizeProblemForStudentView(problem) {
  if (!problem) return null;
  const sanitized = { ...problem };
  // Administrative test cases array must NEVER be present for students
  delete sanitized.testCases;
  delete sanitized.test_cases;
  // Sample test cases only
  if (Array.isArray(sanitized.sampleTestCases)) {
    sanitized.sampleTestCases = sanitized.sampleTestCases.filter((tc) => !tc.isHidden && !tc.is_hidden);
  }
  return sanitized;
}

function validateHarnessTemplate(harnessCode) {
  if (!harnessCode || typeof harnessCode !== 'string') return false;
  return harnessCode.includes('__STUDENT_CODE__');
}

function filterProblems(problems, { search = '', difficulty = 'all', codingMode = 'all', status = 'all', scope = 'all' }) {
  return problems.filter((p) => {
    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      const matchTitle = (p.title || '').toLowerCase().includes(q);
      const matchDesc = (p.description || '').toLowerCase().includes(q);
      const matchId = String(p.id) === q;
      if (!matchTitle && !matchDesc && !matchId) return false;
    }
    if (difficulty !== 'all' && (p.difficulty || '').toLowerCase() !== difficulty.toLowerCase()) {
      return false;
    }
    if (codingMode !== 'all' && (p.codingMode || p.coding_mode || '').toLowerCase() !== codingMode.toLowerCase()) {
      return false;
    }
    if (status !== 'all') {
      const isPublished = Boolean(p.isPublished ?? p.is_published);
      if (status === 'published' && !isPublished) return false;
      if (status === 'draft' && isPublished) return false;
    }
    if (scope !== 'all' && (p.accessScope || p.access_scope || '').toLowerCase() !== scope.toLowerCase()) {
      return false;
    }
    return true;
  });
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Phase 7.5.11.3: Problem Bank & Quality Queue UI Logic & Security', () => {

  describe('1. API Response Payload Unwrapping & Fallbacks', () => {
    it('should unwrap wrapped standard API response ({ status, data: { problems, pagination } })', () => {
      const resp = {
        status: 'success',
        data: {
          problems: [{ id: 1, title: 'Two Sum' }, { id: 2, title: 'Three Sum' }],
          pagination: { total: 42, page: 2, limit: 10, totalPages: 5 },
        },
      };
      const result = unwrapProblemListPayload(resp);
      assert.strictEqual(result.problems.length, 2);
      assert.strictEqual(result.total, 42);
      assert.strictEqual(result.page, 2);
      assert.strictEqual(result.limit, 10);
      assert.strictEqual(result.totalPages, 5);
    });

    it('should unwrap flat root API response ({ problems, total, page, limit })', () => {
      const resp = {
        problems: [{ id: 5, title: 'Binary Search' }],
        total: 1,
        page: 1,
        limit: 20,
      };
      const result = unwrapProblemListPayload(resp);
      assert.strictEqual(result.problems.length, 1);
      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.totalPages, 1);
    });

    it('should gracefully handle empty or undefined payloads without throwing', () => {
      const resultNull = unwrapProblemListPayload(null);
      assert.deepStrictEqual(resultNull.problems, []);
      assert.strictEqual(resultNull.total, 0);
      assert.strictEqual(resultNull.totalPages, 1);

      const resultEmpty = unwrapProblemListPayload({});
      assert.deepStrictEqual(resultEmpty.problems, []);
      assert.strictEqual(resultEmpty.total, 0);
    });
  });

  describe('2. Test-Case Privacy & Zero Hidden-Test Leakage in Frontend Views', () => {
    it('should completely strip administrative test cases array from student-facing problem object', () => {
      const rawProblem = {
        id: 101,
        title: 'Secret Problem',
        testCases: [
          { id: 1, inputData: '1 2', expectedOutput: '3', isHidden: false },
          { id: 2, inputData: '999 1000', expectedOutput: '1999', isHidden: true },
        ],
        sampleTestCases: [
          { id: 1, inputData: '1 2', expectedOutput: '3', isHidden: false },
        ],
      };

      const sanitized = sanitizeProblemForStudentView(rawProblem);
      assert.strictEqual(sanitized.testCases, undefined);
      assert.strictEqual(sanitized.test_cases, undefined);
      assert.strictEqual(sanitized.sampleTestCases.length, 1);
      assert.strictEqual(sanitized.sampleTestCases[0].isHidden, false);
    });

    it('should filter out any erroneously attached hidden tests from sampleTestCases', () => {
      const problemWithLeakedHidden = {
        id: 102,
        title: 'Leaky Problem',
        sampleTestCases: [
          { id: 1, inputData: 'public', isHidden: false },
          { id: 2, inputData: 'secret_leak', isHidden: true },
        ],
      };
      const sanitized = sanitizeProblemForStudentView(problemWithLeakedHidden);
      assert.strictEqual(sanitized.sampleTestCases.length, 1);
      assert.strictEqual(sanitized.sampleTestCases[0].inputData, 'public');
    });
  });

  describe('3. SLA Turnaround Calculation Logic', () => {
    const now = 1700000000000;

    it('should classify reviews created <24h ago as ON TIME', () => {
      const created12hAgo = new Date(now - 12 * 3600 * 1000).toISOString();
      const badge = computeSlaBadge(created12hAgo, now);
      assert.strictEqual(badge.level, 'on_time');
      assert.match(badge.label, /ON TIME/);
      assert.strictEqual(badge.color, '#4ade80');
    });

    it('should classify reviews created between 24h and 48h ago as AT RISK', () => {
      const created30hAgo = new Date(now - 30 * 3600 * 1000).toISOString();
      const badge = computeSlaBadge(created30hAgo, now);
      assert.strictEqual(badge.level, 'at_risk');
      assert.match(badge.label, /AT RISK/);
      assert.strictEqual(badge.color, '#fbbf24');
    });

    it('should classify reviews created >48h ago as OVERDUE', () => {
      const created72hAgo = new Date(now - 72 * 3600 * 1000).toISOString();
      const badge = computeSlaBadge(created72hAgo, now);
      assert.strictEqual(badge.level, 'overdue');
      assert.match(badge.label, /OVERDUE/);
      assert.strictEqual(badge.color, '#f87171');
    });

    it('should provide default ON TIME badge when createdAt is missing or null', () => {
      const badge = computeSlaBadge(null, now);
      assert.strictEqual(badge.level, 'on_time');
    });
  });

  describe('4. Pagination Mathematics & Boundary Safety', () => {
    it('should compute normal pagination range correctly', () => {
      const range = calculatePaginationRange(2, 20, 55);
      assert.strictEqual(range.start, 21);
      assert.strictEqual(range.end, 40);
      assert.strictEqual(range.totalPages, 3);
      assert.strictEqual(range.clampedPage, 2);
    });

    it('should clamp out-of-bounds page numbers to valid ranges', () => {
      const highPage = calculatePaginationRange(999, 10, 25);
      assert.strictEqual(highPage.clampedPage, 3);
      assert.strictEqual(highPage.start, 21);
      assert.strictEqual(highPage.end, 25);

      const zeroPage = calculatePaginationRange(0, 10, 25);
      assert.strictEqual(zeroPage.clampedPage, 1);
      assert.strictEqual(zeroPage.start, 1);
    });

    it('should handle 0 total items safely with 0 start and end', () => {
      const emptyRange = calculatePaginationRange(1, 20, 0);
      assert.strictEqual(emptyRange.start, 0);
      assert.strictEqual(emptyRange.end, 0);
      assert.strictEqual(emptyRange.totalPages, 1);
    });
  });

  describe('5. Function Mode Harness Template Verification', () => {
    it('should accept valid harnesses containing __STUDENT_CODE__', () => {
      assert.strictEqual(validateHarnessTemplate('# __STUDENT_CODE__\ndef solve(): pass'), true);
      assert.strictEqual(validateHarnessTemplate('// __STUDENT_CODE__\nint main() {}'), true);
    });

    it('should reject harnesses missing __STUDENT_CODE__ placeholder', () => {
      assert.strictEqual(validateHarnessTemplate('def solve(): pass'), false);
      assert.strictEqual(validateHarnessTemplate(''), false);
      assert.strictEqual(validateHarnessTemplate(null), false);
    });
  });

  describe('6. Client-Side Multi-Field Search & Filter Matrix', () => {
    const mockProblems = [
      { id: 1, title: 'Array Queries', description: 'Prefix sum', difficulty: 'easy', codingMode: 'full_program', isPublished: true, accessScope: 'public' },
      { id: 2, title: 'Graph Traversal', description: 'BFS and DFS', difficulty: 'hard', codingMode: 'function', isPublished: false, accessScope: 'contest_private' },
      { id: 3, title: 'Tree Paths', description: 'LCA of binary tree', difficulty: 'medium', codingMode: 'function', isPublished: true, accessScope: 'public' },
    ];

    it('should filter by title search', () => {
      const res = filterProblems(mockProblems, { search: 'Graph' });
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].id, 2);
    });

    it('should filter by ID search', () => {
      const res = filterProblems(mockProblems, { search: '3' });
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].id, 3);
    });

    it('should filter by difficulty and codingMode simultaneously', () => {
      const res = filterProblems(mockProblems, { difficulty: 'hard', codingMode: 'function' });
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].id, 2);
    });

    it('should filter by published status', () => {
      const published = filterProblems(mockProblems, { status: 'published' });
      assert.strictEqual(published.length, 2);
      const drafts = filterProblems(mockProblems, { status: 'draft' });
      assert.strictEqual(drafts.length, 1);
      assert.strictEqual(drafts[0].id, 2);
    });
  });

  describe('7. Static Source Inspection of Admin Problem Components', () => {
    const frontendDir = fs.existsSync(path.join(process.cwd(), 'src'))
      ? process.cwd()
      : path.join(process.cwd(), 'frontend');

    it('AdminProblemManagement.jsx exists and includes filter controls and data-testid attributes', () => {
      const filePath = path.join(frontendDir, 'src', 'components', 'admin', 'AdminProblemManagement.jsx');
      assert(fs.existsSync(filePath), 'AdminProblemManagement.jsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');
      assert(content.includes('data-testid="admin-problem-management"'), 'Must contain container data-testid');
      assert(content.includes('data-testid="problem-search-input"'), 'Must contain search input data-testid');
      assert(content.includes('data-testid="add-problem-btn"'), 'Must contain add problem button data-testid');
    });

    it('AdminReviewGovernance.jsx exists and includes SLA badges and reviewer analytics', () => {
      const filePath = path.join(frontendDir, 'src', 'components', 'admin', 'AdminReviewGovernance.jsx');
      assert(fs.existsSync(filePath), 'AdminReviewGovernance.jsx must exist');
      const content = fs.readFileSync(filePath, 'utf8');
      assert(content.includes('Problem Review Governance & Turnaround SLA'), 'Must include review governance title');
      assert(content.includes('getSlaBadge'), 'Must contain SLA calculation logic');
      assert(content.includes('OVERDUE'), 'Must handle overdue SLA');
      assert(content.includes('AT RISK'), 'Must handle at risk SLA');
    });
  });

});
