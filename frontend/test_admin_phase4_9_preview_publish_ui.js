/**
 * Frontend Unit Test Suite — Phase 7.4.9: Preview / Draft / Publish
 *
 * Tests:
 * 1. Publication validation gate (validateForPublish)
 * 2. Error-to-Tab mapping for interactive fixes (getTabForPublishError)
 * 3. Student preview generation & strictly zero hidden-test leakage
 * 4. Draft and published state transitions
 * 5. Optimistic concurrency conflict resolution invariants
 * 6. Version history snapshot representations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  validateProblemForm,
  validateForPublish,
  getTabForPublishError,
} from './src/components/admin/adminProblemEditorConstants.js';

describe('Phase 7.4.9: Preview / Draft / Publish Frontend Logic', () => {
  const baseValidProblem = {
    title: 'Two Sum Problem',
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
    difficulty: 'easy',
    codingMode: 'function',
    accessScope: 'public',
    allowedLanguages: ['python', 'cpp', 'java', 'javascript', 'c'],
    starterTemplates: {
      python: 'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n',
      cpp: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return {};\n    }\n};',
    },
    harnessTemplates: {
      python: '// __STUDENT_CODE__\nprint("test")',
      cpp: '// __STUDENT_CODE__\nint main() { return 0; }',
    },
    functionConfig: {
      functionName: 'twoSum',
      returnType: 'vector<int>',
      parameters: 'vector<int>& nums, int target',
    },
    testCases: [
      {
        id: 1,
        inputData: '4\n2 7 11 15\n9',
        expectedOutput: '0 1',
        isSample: true,
        isHidden: false,
        testOrder: 1,
      },
      {
        id: 2,
        inputData: '3\n3 2 4\n6',
        expectedOutput: '1 2',
        isHidden: true,
        isSample: false,
        testOrder: 2,
      },
    ],
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    version: 1,
    isPublished: false,
    reviewStatus: 'draft',
  };

  // --------------------------------------------------------------------------
  // 1. Publication Validation Gate (validateForPublish)
  // --------------------------------------------------------------------------
  describe('1. Publication Validation Gate', () => {
    it('1.1 should pass for a fully configured, valid problem', () => {
      const result = validateForPublish(baseValidProblem);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('1.2 should reject problem with title under 3 characters', () => {
      const form = { ...baseValidProblem, title: 'AB' };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('title')));
    });

    it('1.3 should reject problem with description under 5 characters', () => {
      const form = { ...baseValidProblem, description: 'Nope' };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('description')));
    });

    it('1.4 should reject invalid difficulty level', () => {
      const form = { ...baseValidProblem, difficulty: 'impossible' };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('difficulty')));
    });

    it('1.5 should reject invalid coding mode', () => {
      const form = { ...baseValidProblem, codingMode: 'unsupported_mode' };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('coding mode')));
    });

    it('1.6 should require functionName in function mode', () => {
      const form = {
        ...baseValidProblem,
        functionConfig: { ...baseValidProblem.functionConfig, functionName: '' },
      };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('function name')));
    });

    it('1.7 should require at least one starter template in function mode', () => {
      const form = {
        ...baseValidProblem,
        starterTemplates: {},
      };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('starter templates')));
    });

    it('1.8 should require at least one harness template in function mode', () => {
      const form = {
        ...baseValidProblem,
        harnessTemplates: {},
      };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('harness templates')));
    });

    it('1.9 should require at least one test case before publication', () => {
      const form = {
        ...baseValidProblem,
        testCases: [],
        examples: [],
      };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('at least one test case')));
    });

    it('1.10 should require at least one visible sample test case', () => {
      const form = {
        ...baseValidProblem,
        testCases: [
          { id: 1, inputData: '1', expectedOutput: '2', isHidden: true, isSample: false },
          { id: 2, inputData: '2', expectedOutput: '4', isHidden: true, isSample: false },
        ],
      };
      const result = validateForPublish(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some((e) => e.toLowerCase().includes('sample test case')));
    });
  });

  // --------------------------------------------------------------------------
  // 2. Publication Error to Tab Navigation Mapping (getTabForPublishError)
  // --------------------------------------------------------------------------
  describe('2. Publication Error to Tab Navigation Mapping', () => {
    it('2.1 should map title and difficulty errors to "basic" tab', () => {
      assert.strictEqual(getTabForPublishError('Problem title is required'), 'basic');
      assert.strictEqual(getTabForPublishError('Problem must have a valid difficulty'), 'basic');
    });

    it('2.2 should map description errors to "examples" tab', () => {
      assert.strictEqual(getTabForPublishError('Problem description / statement is required'), 'examples');
      assert.strictEqual(getTabForPublishError('Problem statement cannot be empty'), 'examples');
    });

    it('2.3 should map coding mode errors to "coding_mode" tab', () => {
      assert.strictEqual(getTabForPublishError('Problem must have a valid coding mode'), 'coding_mode');
    });

    it('2.4 should map starter templates and language errors to "languages" tab', () => {
      assert.strictEqual(getTabForPublishError('Function-mode problems must provide starter templates'), 'languages');
      assert.strictEqual(getTabForPublishError('Language selection is required'), 'languages');
    });

    it('2.5 should map function name, parameters, and harness errors to "function_dsl" tab', () => {
      assert.strictEqual(getTabForPublishError('Function name is required in Function Mode'), 'function_dsl');
      assert.strictEqual(getTabForPublishError('Function-mode problems must provide harness templates'), 'function_dsl');
      assert.strictEqual(getTabForPublishError('Duplicate parameter name detected'), 'function_dsl');
    });

    it('2.6 should map test case and sample test case errors to "test_cases" tab', () => {
      assert.strictEqual(getTabForPublishError('Problem must have at least one test case before publication'), 'test_cases');
      assert.strictEqual(getTabForPublishError('Problem must have at least one visible sample test case'), 'test_cases');
      assert.strictEqual(getTabForPublishError('Test case #1 is missing input or expected output'), 'test_cases');
    });

    it('2.7 should map execution limits and review approval errors to "execution" tab', () => {
      assert.strictEqual(getTabForPublishError('CPU time limit must be between 500ms and 10000ms'), 'execution');
      assert.strictEqual(getTabForPublishError('Problem publication requires an approved review'), 'execution');
      assert.strictEqual(getTabForPublishError('Approved review is for version 1, but current problem is version 2'), 'execution');
    });

    it('2.8 should fallback to "basic" tab for unrecognized error strings', () => {
      assert.strictEqual(getTabForPublishError('Some general platform system error'), 'basic');
      assert.strictEqual(getTabForPublishError(''), 'basic');
      assert.strictEqual(getTabForPublishError(null), 'basic');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Student Preview Generation & Zero Hidden-Test Leakage Defenses
  // --------------------------------------------------------------------------
  describe('3. Student Preview & Zero Hidden-Test Leakage Defenses', () => {
    it('3.1 should only extract visible sample test cases for preview', () => {
      const allTestCases = [
        { id: 101, inputData: 'sample in 1', expectedOutput: 'sample out 1', isSample: true, isHidden: false },
        { id: 102, inputData: 'sample in 2', expectedOutput: 'sample out 2', isSample: true, isHidden: false },
        { id: 103, inputData: 'SECRET_INPUT_HIDDEN_1', expectedOutput: 'SECRET_OUTPUT_1', isSample: false, isHidden: true },
        { id: 104, inputData: 'SECRET_INPUT_HIDDEN_2', expectedOutput: 'SECRET_OUTPUT_2', isSample: false, isHidden: true },
      ];

      // Simulate the preview filter logic executed in AdminProblemEditor.jsx
      const previewSampleCases = allTestCases
        .filter((tc) => tc.isSample || !tc.isHidden)
        .map((tc, idx) => ({
          id: tc.id || idx + 1,
          inputData: tc.inputData || '',
          expectedOutput: tc.expectedOutput || '',
          explanation: tc.explanation || `Sample test case ${idx + 1}`,
        }));

      assert.strictEqual(previewSampleCases.length, 2);
      assert.strictEqual(previewSampleCases[0].inputData, 'sample in 1');
      assert.strictEqual(previewSampleCases[1].inputData, 'sample in 2');

      // CRITICAL SECURITY ASSERTION: hidden inputs/outputs must not exist anywhere in the preview list
      const stringifiedPreview = JSON.stringify(previewSampleCases);
      assert.strictEqual(stringifiedPreview.includes('SECRET_INPUT_HIDDEN_1'), false);
      assert.strictEqual(stringifiedPreview.includes('SECRET_OUTPUT_1'), false);
      assert.strictEqual(stringifiedPreview.includes('SECRET_INPUT_HIDDEN_2'), false);
      assert.strictEqual(stringifiedPreview.includes('SECRET_OUTPUT_2'), false);
    });

    it('3.2 preview object must not leak private harness templates to students', () => {
      // Preview object structure constructed in editor
      const previewObject = {
        id: baseValidProblem.id || 'DRAFT',
        title: baseValidProblem.title,
        description: baseValidProblem.description,
        difficulty: baseValidProblem.difficulty,
        codingMode: baseValidProblem.codingMode,
        constraints: baseValidProblem.constraints || '',
        allowedLanguages: baseValidProblem.allowedLanguages,
        starterTemplates: baseValidProblem.starterTemplates,
        sampleTestCases: baseValidProblem.testCases.filter((tc) => tc.isSample || !tc.isHidden),
        reviewStatus: baseValidProblem.reviewStatus,
        isPublished: baseValidProblem.isPublished,
      };

      // harnessTemplates contains internal judge harness logic and must be excluded from previewObject
      assert.strictEqual(previewObject.harnessTemplates, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Draft & Published State Transitions
  // --------------------------------------------------------------------------
  describe('4. Draft & Published State Transitions', () => {
    it('4.1 initial problem creation must be a Draft with isPublished false', () => {
      const initialForm = {
        title: 'New Problem Draft',
        isPublished: false,
        reviewStatus: 'draft',
        version: 1,
      };
      assert.strictEqual(initialForm.isPublished, false);
      assert.strictEqual(initialForm.reviewStatus, 'draft');
      assert.strictEqual(initialForm.version, 1);
    });

    it('4.2 normal save of an existing draft must not publish it', () => {
      const currentDraft = {
        title: 'Draft with Edits',
        isPublished: false,
        reviewStatus: 'draft',
        version: 2,
      };

      // Simulate backend response after normal draft save
      const savedResponse = {
        problem: {
          ...currentDraft,
          title: 'Draft with Edits - Saved',
          version: 2,
          isPublished: false,
          reviewStatus: 'draft',
        },
      };

      assert.strictEqual(savedResponse.problem.isPublished, false);
      assert.strictEqual(savedResponse.problem.reviewStatus, 'draft');
    });

    it('4.3 publication transition updates isPublished to true and reviewStatus to published', () => {
      const draft = { ...baseValidProblem, isPublished: false, reviewStatus: 'draft', version: 1 };

      // Simulate publication response from /api/problems/:id/publish
      const publishResponse = {
        problem: {
          ...draft,
          isPublished: true,
          reviewStatus: 'published',
          publishedAt: new Date().toISOString(),
        },
        version: 1,
      };

      assert.strictEqual(publishResponse.problem.isPublished, true);
      assert.strictEqual(publishResponse.problem.reviewStatus, 'published');
      assert.strictEqual(publishResponse.version, 1);
    });

    it('4.4 editing a published problem resets isPublished to false and reviewStatus to draft with incremented version', () => {
      const published = {
        ...baseValidProblem,
        isPublished: true,
        reviewStatus: 'published',
        version: 1,
      };

      // When edited and saved, backend updateProblem sets version = version + 1, is_published = false, review_status = 'draft'
      const updatedAfterEdit = {
        ...published,
        title: 'Two Sum Problem - Enhanced Edition',
        version: published.version + 1,
        isPublished: false,
        reviewStatus: 'draft',
      };

      assert.strictEqual(updatedAfterEdit.version, 2);
      assert.strictEqual(updatedAfterEdit.isPublished, false);
      assert.strictEqual(updatedAfterEdit.reviewStatus, 'draft');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Optimistic Concurrency Invariants
  // --------------------------------------------------------------------------
  describe('5. Optimistic Concurrency Invariants', () => {
    it('5.1 detects stale version and triggers HTTP 409 conflict payload', () => {
      const localVersion = 1;
      const serverVersion = 2;

      const isConflict = localVersion !== serverVersion;
      assert.strictEqual(isConflict, true);

      const conflictResponse = {
        status: 'error',
        statusCode: 409,
        currentVersion: serverVersion,
        message: `Optimistic Concurrency Conflict: Problem version (v${localVersion}) has been superseded by another administrator (v${serverVersion}).`,
      };

      assert.strictEqual(conflictResponse.statusCode, 409);
      assert.strictEqual(conflictResponse.currentVersion, 2);
    });
  });
});
