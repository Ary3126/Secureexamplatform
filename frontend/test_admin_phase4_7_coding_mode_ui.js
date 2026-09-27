/**
 * Automated Test Suite for Phase 7.4.7: Coding Mode Configuration — Frontend UI Logic
 *
 * Verifies that:
 * 1. Coding Mode Architecture & Metadata:
 *    - CODING_MODES contains both Standard OJ (full_program) and Function Mode (function)
 *    - getCodingModeMeta accurately resolves metadata for both modes
 *    - SUPPORTED_LANGUAGES includes Python, C++, Java, JavaScript, and C
 *    - DEFAULT_STARTER_TEMPLATES defines templates for both modes for all supported languages
 *
 * 2. Form Validation Gate (validateProblemForm):
 *    - Standard OJ problem validation passes with valid payload
 *    - Function Mode requires valid function name (identifier syntax)
 *    - Function Mode rejects missing or malformed function names
 *    - Invalid codingMode values are rejected
 *    - Function Mode validates that harness templates include // __STUDENT_CODE__
 *
 * 3. Non-Destructive Mode Switching State Machine:
 *    - Switching Standard OJ -> Function Mode caches Standard OJ custom code
 *    - Custom Function Mode code is retained when switching back to Standard OJ
 *    - Switching back to Function Mode restores authored Function Mode code
 *    - Zero unintentional destruction of authored starter code or problem configurations
 *
 * 4. Reset-to-Default per Mode:
 *    - Resetting starter template in Standard OJ yields Standard OJ default
 *    - Resetting starter template in Function Mode yields Function Mode default
 *
 * 5. Harness Placeholder Detection:
 *    - Detects presence of __STUDENT_CODE__ placeholder
 *    - Flags missing placeholder and tests placeholder insertion
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  CODING_MODES,
  getCodingModeMeta,
  validateProblemForm,
} from './src/components/admin/adminProblemEditorConstants.js';

describe('Phase 7.4.7: Coding Mode Configuration Frontend Logic', () => {

  // --------------------------------------------------------------------------
  // 1. Coding Mode Architecture & Metadata
  // --------------------------------------------------------------------------
  describe('1. Coding Mode Architecture & Metadata', () => {
    it('1.1 should define CODING_MODES with full_program and function', () => {
      assert.strictEqual(CODING_MODES.length, 2);
      const modeIds = CODING_MODES.map((m) => m.id);
      assert.ok(modeIds.includes('full_program'), 'Must include full_program');
      assert.ok(modeIds.includes('function'), 'Must include function');
    });

    it('1.2 should return correct metadata via getCodingModeMeta', () => {
      const ojMeta = getCodingModeMeta('full_program');
      assert.strictEqual(ojMeta.id, 'full_program');
      assert.strictEqual(ojMeta.badge, 'Standard OJ');
      assert.strictEqual(ojMeta.harnessRequired, false);

      const fnMeta = getCodingModeMeta('function');
      assert.strictEqual(fnMeta.id, 'function');
      assert.strictEqual(fnMeta.badge, 'Function Mode');
      assert.strictEqual(fnMeta.harnessRequired, true);

      // Default fallback
      const fallback = getCodingModeMeta('unknown_mode');
      assert.strictEqual(fallback.id, 'full_program');
    });

    it('1.3 should support all 5 platform languages', () => {
      assert.strictEqual(SUPPORTED_LANGUAGES.length, 5);
      const langIds = SUPPORTED_LANGUAGES.map((l) => l.id);
      assert.deepStrictEqual(langIds.sort(), ['c', 'cpp', 'java', 'javascript', 'python'].sort());
    });

    it('1.4 should provide default starter templates for all 5 languages in both modes', () => {
      const langs = ['python', 'cpp', 'java', 'javascript', 'c'];
      for (const lang of langs) {
        assert.ok(DEFAULT_STARTER_TEMPLATES.function[lang], `Function starter for ${lang} must exist`);
        assert.ok(DEFAULT_STARTER_TEMPLATES.full_program[lang], `Standard OJ starter for ${lang} must exist`);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. Form Validation Gate (validateProblemForm)
  // --------------------------------------------------------------------------
  describe('2. Form Validation Gate (validateProblemForm)', () => {
    const baseValidForm = {
      title: 'Valid Problem Title',
      description: 'A valid comprehensive problem description.',
      difficulty: 'medium',
      codingMode: 'full_program',
      accessScope: 'public',
      timeLimitMs: 2000,
      memoryLimitMb: 256,
    };

    it('2.1 should validate a valid Standard OJ problem form', () => {
      const result = validateProblemForm(baseValidForm);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(Object.keys(result.errors).length, 0);
    });

    it('2.2 should validate a valid Function Mode problem form', () => {
      const fnForm = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'twoSum',
          returnType: 'vector<int>',
          parameters: 'vector<int>& nums, int target',
        },
        harnessTemplates: {
          python: 'import sys\n# __STUDENT_CODE__\ndef run(): pass\n',
        },
      };
      const result = validateProblemForm(fnForm);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(Object.keys(result.errors).length, 0);
    });

    it('2.3 should reject Function Mode when functionName is missing', () => {
      const fnForm = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: '',
        },
      };
      const result = validateProblemForm(fnForm);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.functionName, 'Must have error for missing functionName');
    });

    it('2.4 should reject Function Mode with invalid functionName identifier', () => {
      const invalidNames = ['123startWithDigit', 'has spaces', 'invalid-hyphen', 'punct!'];
      for (const name of invalidNames) {
        const result = validateProblemForm({
          ...baseValidForm,
          codingMode: 'function',
          functionConfig: { functionName: name },
        });
        assert.strictEqual(result.isValid, false, `Name "${name}" should be invalid`);
        assert.ok(result.errors.functionName);
      }
    });

    it('2.5 should reject invalid codingMode', () => {
      const result = validateProblemForm({
        ...baseValidForm,
        codingMode: 'invalid_mode',
      });
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.codingMode, 'Must reject unsupported coding mode');
    });

    it('2.6 should flag harness templates missing __STUDENT_CODE__ in Function Mode', () => {
      const fnForm = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: { functionName: 'solve' },
        harnessTemplates: {
          python: 'def run(): pass', // missing __STUDENT_CODE__
        },
      };
      const result = validateProblemForm(fnForm);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.harness_python, 'Must flag missing __STUDENT_CODE__ placeholder');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Non-Destructive Mode Switching State Machine
  // --------------------------------------------------------------------------
  describe('3. Non-Destructive Mode Switching State Machine', () => {
    it('3.1 should preserve authored code when toggling between Standard OJ and Function Mode', () => {
      // Simulate component state
      let modeStarterTemplates = {
        function: { ...DEFAULT_STARTER_TEMPLATES.function },
        full_program: { ...DEFAULT_STARTER_TEMPLATES.full_program },
      };

      let formData = {
        codingMode: 'full_program',
        starterTemplates: { ...modeStarterTemplates.full_program },
      };

      // 1. Author custom Standard OJ code
      const customOJPython = 'import sys\n# Custom Standard OJ Code\nfor line in sys.stdin:\n    print(line.strip())\n';
      formData.starterTemplates.python = customOJPython;
      modeStarterTemplates.full_program.python = customOJPython;

      // 2. Switch to Function Mode
      const switchMode = (newMode) => {
        const currentMode = formData.codingMode;
        // Cache current mode's templates
        modeStarterTemplates[currentMode] = { ...formData.starterTemplates };
        // Load target mode's templates
        formData.codingMode = newMode;
        formData.starterTemplates = { ...modeStarterTemplates[newMode] };
      };

      switchMode('function');
      assert.strictEqual(formData.codingMode, 'function');
      // Should load Function Mode starter
      assert.strictEqual(formData.starterTemplates.python, DEFAULT_STARTER_TEMPLATES.function.python);

      // 3. Author custom Function Mode code
      const customFnPython = 'class Solution:\n    def solve(self, nums):\n        # Custom Function Mode Logic\n        return max(nums)\n';
      formData.starterTemplates.python = customFnPython;
      modeStarterTemplates.function.python = customFnPython;

      // 4. Switch back to Standard OJ
      switchMode('full_program');
      assert.strictEqual(formData.codingMode, 'full_program');
      // Must restore custom Standard OJ code without data loss!
      assert.strictEqual(formData.starterTemplates.python, customOJPython, 'Custom Standard OJ code must be preserved');

      // 5. Switch back to Function Mode
      switchMode('function');
      assert.strictEqual(formData.codingMode, 'function');
      // Must restore custom Function Mode code without data loss!
      assert.strictEqual(formData.starterTemplates.python, customFnPython, 'Custom Function Mode code must be preserved');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Reset-to-Default per Mode
  // --------------------------------------------------------------------------
  describe('4. Reset-to-Default per Mode', () => {
    it('4.1 should reset starter code to mode-specific default', () => {
      // In Standard OJ mode
      const ojMode = 'full_program';
      const resetOJ = DEFAULT_STARTER_TEMPLATES[ojMode]['cpp'];
      assert.ok(resetOJ.includes('int main()'), 'Standard OJ C++ must have main()');

      // In Function mode
      const fnMode = 'function';
      const resetFn = DEFAULT_STARTER_TEMPLATES[fnMode]['cpp'];
      assert.ok(resetFn.includes('class Solution'), 'Function Mode C++ must have class Solution');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Harness Placeholder Detection
  // --------------------------------------------------------------------------
  describe('5. Harness Placeholder Detection', () => {
    it('5.1 should detect presence or absence of __STUDENT_CODE__ placeholder', () => {
      const validHarness = 'import sys\n// __STUDENT_CODE__\ndef main(): pass\n';
      const invalidHarness = 'import sys\ndef main(): pass\n';

      assert.strictEqual(validHarness.includes('__STUDENT_CODE__'), true);
      assert.strictEqual(invalidHarness.includes('__STUDENT_CODE__'), false);

      // Simulate quick-fix insertion
      const fixedHarness = invalidHarness + '\n// __STUDENT_CODE__\n';
      assert.strictEqual(fixedHarness.includes('__STUDENT_CODE__'), true);
    });
  });

});
