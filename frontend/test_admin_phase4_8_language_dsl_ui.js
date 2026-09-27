/**
 * Frontend Unit Test Suite — Phase 7.4.8: Language & Function/DSL Configuration
 *
 * Tests:
 * 1. Supported languages configuration and metadata
 * 2. Parameter string parsing and structured formatting
 * 3. Boilerplate starter and harness generation from signature
 * 4. Form validation gate for languages, function names, return types, and parameters
 * 5. Duplicate parameter detection and identifier validation
 * 6. Harness placeholder and coding-mode compatibility
 * 7. Security and invariant defenses
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SUPPORTED_LANGUAGES,
  DEFAULT_STARTER_TEMPLATES,
  DEFAULT_HARNESS_TEMPLATES,
  validateProblemForm,
  parseParameterString,
  formatParametersToString,
  generateTemplatesFromSignature,
} from './src/components/admin/adminProblemEditorConstants.js';

describe('Phase 7.4.8: Language & Function/DSL Configuration Frontend Logic', () => {
  const baseValidForm = {
    title: 'Valid Problem Title',
    description: 'Valid problem description that meets length requirements.',
    difficulty: 'medium',
    codingMode: 'full_program',
    accessScope: 'public',
    timeLimitMs: 2000,
    memoryLimitMb: 256,
  };

  // --------------------------------------------------------------------------
  // 1. Supported Languages Configuration & Metadata
  // --------------------------------------------------------------------------
  describe('1. Supported Languages Configuration', () => {
    it('1.1 should define all 5 supported production languages', () => {
      assert.strictEqual(SUPPORTED_LANGUAGES.length, 5);
      const ids = SUPPORTED_LANGUAGES.map((l) => l.id);
      assert.ok(ids.includes('python'));
      assert.ok(ids.includes('cpp'));
      assert.ok(ids.includes('java'));
      assert.ok(ids.includes('javascript'));
      assert.ok(ids.includes('c'));
    });

    it('1.2 should validate allowedLanguages array when provided', () => {
      const form = {
        ...baseValidForm,
        allowedLanguages: ['python', 'cpp', 'java'],
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, true);
    });

    it('1.3 should reject empty allowedLanguages array', () => {
      const form = {
        ...baseValidForm,
        allowedLanguages: [],
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.allowedLanguages, 'Must reject empty allowedLanguages');
    });

    it('1.4 should reject unsupported languages in allowedLanguages', () => {
      const form = {
        ...baseValidForm,
        allowedLanguages: ['python', 'ruby', 'go'],
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.allowedLanguages.includes('Unsupported language'));
    });

    it('1.5 should reject duplicate languages in allowedLanguages', () => {
      const form = {
        ...baseValidForm,
        allowedLanguages: ['python', 'cpp', 'python'],
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.allowedLanguages.includes('Duplicate language'));
    });
  });

  // --------------------------------------------------------------------------
  // 2. Parameter Parsing & Formatting Helpers
  // --------------------------------------------------------------------------
  describe('2. Parameter Parsing & Formatting Helpers', () => {
    it('2.1 should parse comma-separated C++ style parameter string', () => {
      const raw = 'vector<int>& nums, int target';
      const parsed = parseParameterString(raw);
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].name, 'nums');
      assert.strictEqual(parsed[0].type, 'vector<int>&');
      assert.strictEqual(parsed[1].name, 'target');
      assert.strictEqual(parsed[1].type, 'int');
    });

    it('2.2 should parse single parameter cleanly', () => {
      const raw = 'int n';
      const parsed = parseParameterString(raw);
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].name, 'n');
      assert.strictEqual(parsed[0].type, 'int');
    });

    it('2.3 should handle empty or null string gracefully', () => {
      assert.deepStrictEqual(parseParameterString(''), []);
      assert.deepStrictEqual(parseParameterString(null), []);
      assert.deepStrictEqual(parseParameterString(undefined), []);
    });

    it('2.4 should format structured array back to parameter string', () => {
      const structured = [
        { name: 'nums', type: 'vector<int>&' },
        { name: 'k', type: 'int' },
      ];
      const str = formatParametersToString(structured);
      assert.strictEqual(str, 'vector<int>& nums, int k');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Boilerplate Generation from Signature
  // --------------------------------------------------------------------------
  describe('3. Boilerplate Generation from Signature', () => {
    it('3.1 should generate starter templates for all 5 languages', () => {
      const { starterTemplates } = generateTemplatesFromSignature({
        functionName: 'twoSum',
        returnType: 'vector<int>',
        parameters: 'vector<int>& nums, int target',
      });

      assert.ok(starterTemplates.cpp.includes('vector<int> twoSum(vector<int>& nums, int target)'));
      assert.ok(starterTemplates.python.includes('def twoSum(self'));
      assert.ok(starterTemplates.java.includes('twoSum('));
      assert.ok(starterTemplates.javascript.includes('function twoSum('));
      assert.ok(starterTemplates.c.includes('twoSum('));
    });

    it('3.2 should generate harness templates with __STUDENT_CODE__ for all languages', () => {
      const { harnessTemplates } = generateTemplatesFromSignature({
        functionName: 'twoSum',
        returnType: 'vector<int>',
        parameters: 'vector<int>& nums, int target',
      });

      for (const [lang, template] of Object.entries(harnessTemplates)) {
        assert.ok(
          template.includes('__STUDENT_CODE__'),
          `Harness for ${lang} must include __STUDENT_CODE__`
        );
      }
    });

    it('3.3 should adapt types appropriately across language starter templates', () => {
      const { starterTemplates } = generateTemplatesFromSignature({
        functionName: 'maxSubArray',
        returnType: 'int',
        parameters: [{ name: 'nums', type: 'vector<int>&' }],
      });

      assert.ok(starterTemplates.cpp.includes('int maxSubArray(vector<int>& nums)'));
      assert.ok(starterTemplates.java.includes('int maxSubArray(int[] nums)'));
      assert.ok(starterTemplates.c.includes('int maxSubArray(int* nums'));
    });
  });

  // --------------------------------------------------------------------------
  // 4. Function Mode & DSL Validation Gate
  // --------------------------------------------------------------------------
  describe('4. Function Mode & DSL Validation Gate', () => {
    it('4.1 should accept valid function configuration', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'twoSum',
          returnType: 'vector<int>',
          parameters: 'vector<int>& nums, int target',
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, true);
      assert.strictEqual(Object.keys(result.errors).length, 0);
    });

    it('4.2 should reject empty or invalid functionName in Function Mode', () => {
      const invalidNames = ['', '123startWithDigit', 'has spaces', 'bad-name', 'punct!'];
      for (const name of invalidNames) {
        const form = {
          ...baseValidForm,
          codingMode: 'function',
          functionConfig: {
            functionName: name,
            returnType: 'int',
          },
        };
        const result = validateProblemForm(form);
        assert.strictEqual(result.isValid, false, `Name "${name}" should fail validation`);
        assert.ok(result.errors.functionName);
      }
    });

    it('4.3 should reject empty returnType in Function Mode', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'solve',
          returnType: '',
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.returnType, 'Must require returnType in Function Mode');
    });

    it('4.4 should reject duplicate parameter names in structured parameters', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'solve',
          returnType: 'int',
          parameters: [
            { name: 'nums', type: 'int[]' },
            { name: 'nums', type: 'int' },
          ],
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      const hasDuplicateError = Object.values(result.errors).some((msg) =>
        msg.includes('Duplicate parameter name')
      );
      assert.ok(hasDuplicateError, 'Must detect duplicate parameter name');
    });

    it('4.5 should reject duplicate parameter names in string parameters', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'solve',
          returnType: 'int',
          parameters: 'int target, int target',
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      const hasDuplicateError = Object.values(result.errors).some((msg) =>
        msg.includes('Duplicate parameter name')
      );
      assert.ok(hasDuplicateError, 'Must detect duplicate parameter in string');
    });

    it('4.6 should reject parameter with invalid identifier name', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'solve',
          returnType: 'int',
          parameters: [{ name: '123invalid', type: 'int' }],
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(Object.values(result.errors).some((m) => m.includes('valid identifier')));
    });

    it('4.7 should reject parameter missing a type', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: {
          functionName: 'solve',
          returnType: 'int',
          parameters: [{ name: 'target', type: '' }],
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(Object.values(result.errors).some((m) => m.includes('missing a type')));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Harness Template Validation & Security Invariants
  // --------------------------------------------------------------------------
  describe('5. Harness Template Validation & Security Invariants', () => {
    it('5.1 should validate harness templates containing __STUDENT_CODE__ placeholder', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: { functionName: 'solve', returnType: 'int' },
        harnessTemplates: {
          cpp: '#include <iostream>\n// __STUDENT_CODE__\nint main() { return 0; }',
          python: 'import sys\n# __STUDENT_CODE__\ndef main(): pass',
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, true);
    });

    it('5.2 should reject harness template missing __STUDENT_CODE__ in Function Mode', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'function',
        functionConfig: { functionName: 'solve', returnType: 'int' },
        harnessTemplates: {
          cpp: '#include <iostream>\nint main() { return 0; }', // Missing placeholder!
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.harness_cpp);
    });

    it('5.3 should ignore harness placeholder validation in Standard OJ mode', () => {
      const form = {
        ...baseValidForm,
        codingMode: 'full_program',
        harnessTemplates: {
          cpp: '#include <iostream>\nint main() { return 0; }', // Standard OJ doesn't require placeholder
        },
      };
      const result = validateProblemForm(form);
      assert.strictEqual(result.isValid, true);
    });
  });
});
