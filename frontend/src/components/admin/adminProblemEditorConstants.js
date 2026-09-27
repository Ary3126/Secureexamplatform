/**
 * Admin Problem Editor Constants & Validation Helpers (Phase 7.4.3)
 * Pure JavaScript logic shared between AdminProblemEditor and test runners.
 */

export const SUPPORTED_LANGUAGES = [
  { id: 'python', label: 'Python 3', ext: 'py' },
  { id: 'cpp', label: 'C++ (G++ 17)', ext: 'cpp' },
  { id: 'java', label: 'Java (OpenJDK 17)', ext: 'java' },
  { id: 'javascript', label: 'JavaScript (Node.js)', ext: 'js' },
  { id: 'c', label: 'C (GCC 11)', ext: 'c' },
];

export const DEFAULT_STARTER_TEMPLATES = {
  function: {
    python: `class Solution:\n    def solve(self, nums: list[int]) -> int:\n        # Write your code here\n        return 0\n`,
    cpp: `#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    int solve(vector<int>& nums) {\n        // Write your code here\n        return 0;\n    }\n};\n`,
    java: `import java.util.*;\n\nclass Solution {\n    public int solve(int[] nums) {\n        // Write your code here\n        return 0;\n    }\n}\n`,
    javascript: `/**\n * @param {number[]} nums\n * @return {number}\n */\nfunction solve(nums) {\n    // Write your code here\n    return 0;\n}\n`,
    c: `#include <stdio.h>\n#include <stdlib.h>\n\nint solve(int* nums, int numsSize) {\n    // Write your code here\n    return 0;\n}\n`,
  },
  full_program: {
    python: `import sys\n\ndef main():\n    input_data = sys.stdin.read().split()\n    if not input_data:\n        return\n    # Process standard input and write to standard output\n    print("Output")\n\nif __name__ == '__main__':\n    main()\n`,
    cpp: `#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    // Read from standard input and write to standard output\n    cout << "Output\\n";\n    return 0;\n}\n`,
    java: `import java.util.Scanner;\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // Read from standard input and write to standard output\n        System.out.println("Output");\n    }\n}\n`,
    javascript: `const readline = require('readline');\n\nconst rl = readline.createInterface({\n    input: process.stdin,\n    output: process.stdout\n});\n\nrl.on('line', (line) => {\n    console.log("Output");\n});\n`,
    c: `#include <stdio.h>\n\nint main() {\n    // Read from standard input and write to standard output\n    printf("Output\\n");\n    return 0;\n}\n`,
  },
};

export const DEFAULT_HARNESS_TEMPLATES = {
  python: `import sys\n\n# __STUDENT_CODE__\n\ndef _trusted_platform_harness_main():\n    raw_input = sys.stdin.read().split()\n    if not raw_input:\n        return\n    sol = Solution()\n    try:\n        nums = [int(x) for x in raw_input]\n        print(sol.solve(nums))\n    except Exception:\n        print(sol.solve(*raw_input))\n\nif __name__ == '__main__':\n    _trusted_platform_harness_main()\n`,
  cpp: `#include <iostream>\n#include <vector>\n#include <sstream>\n#include <string>\nusing namespace std;\n\n// __STUDENT_CODE__\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    string line;\n    if (getline(cin, line)) {\n        stringstream ss(line);\n        vector<int> nums;\n        int val;\n        while (ss >> val) nums.push_back(val);\n        Solution sol;\n        cout << sol.solve(nums) << "\\n";\n    }\n    return 0;\n}\n`,
  java: `import java.util.*;\n\n// __STUDENT_CODE__\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        List<Integer> list = new ArrayList<>();\n        while (sc.hasNextInt()) {\n            list.add(sc.nextInt());\n        }\n        int[] nums = new int[list.size()];\n        for (int i = 0; i < list.size(); i++) nums[i] = list.get(i);\n        Solution sol = new Solution();\n        System.out.println(sol.solve(nums));\n    }\n}\n`,
};

export const CODING_MODES = [
  {
    id: 'full_program',
    title: 'Standard OJ (Full Program)',
    subtitle: 'Competitive Programming / Raw I/O Model',
    description: 'Candidate writes a complete program with a main() entry point. Candidate code reads raw standard input (cin/stdin/Scanner) and writes formatted standard output (cout/stdout/System.out). No harness wrapping is applied.',
    badge: 'Standard OJ',
    ioModel: 'Raw standard input & standard output (stdin/stdout)',
    harnessRequired: false,
  },
  {
    id: 'function',
    title: 'Function Mode (Solution Class)',
    subtitle: 'LeetCode / Function Signature Model',
    description: 'Candidate implements only the requested solution function or class method (e.g., class Solution). The judge automatically compiles the solution wrapped in a server-side test harness that deserializes test case inputs and validates output values.',
    badge: 'Function Mode',
    ioModel: 'Automated argument parsing & harness wrapping',
    harnessRequired: true,
  },
];

export function getCodingModeMeta(modeId) {
  return CODING_MODES.find((m) => m.id === modeId) || CODING_MODES[0];
}

/**
 * Helper to parse a parameter string into structured array: [{ name, type }]
 */
export function parseParameterString(paramStr) {
  if (!paramStr || typeof paramStr !== 'string') return [];
  const parts = paramStr.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.map((part, idx) => {
    const tokens = part.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { id: `p-${idx}`, name: '', type: '' };
    if (tokens.length === 1) {
      // Either just type or just name
      return { id: `p-${idx}`, name: tokens[0].replace(/^[&*]+/, ''), type: 'int' };
    }
    const name = tokens[tokens.length - 1].replace(/^[&*]+/, '');
    const type = tokens.slice(0, tokens.length - 1).join(' ');
    return { id: `p-${idx}`, name, type };
  });
}

/**
 * Helper to format structured parameters into string representation
 */
export function formatParametersToString(params) {
  if (!Array.isArray(params)) return '';
  return params
    .filter((p) => p && (p.name || p.type))
    .map((p) => `${p.type ? p.type + ' ' : ''}${p.name || ''}`.trim())
    .join(', ');
}

/**
 * Generate starter and harness templates from Function Mode specification
 */
export function generateTemplatesFromSignature({ functionName = 'solve', returnType = 'int', parameters = 'vector<int>& nums' }) {
  const fnName = (functionName || 'solve').trim();
  const retType = (returnType || 'int').trim();

  // Normalize parameters
  const structuredParams = Array.isArray(parameters)
    ? parameters
    : parseParameterString(parameters);

  const cppParams = structuredParams.length > 0
    ? structuredParams.map((p) => `${p.type || 'int'} ${p.name || 'arg'}`).join(', ')
    : 'vector<int>& nums';

  const pyParams = structuredParams.length > 0
    ? structuredParams.map((p) => `${p.name || 'arg'}: list[int]`).join(', ')
    : 'nums: list[int]';

  const javaParams = structuredParams.length > 0
    ? structuredParams.map((p) => {
        const t = (p.type || '').includes('vector') || (p.type || '').includes('list') ? 'int[]' : (p.type || 'int');
        return `${t} ${p.name || 'arg'}`;
      }).join(', ')
    : 'int[] nums';

  const jsParams = structuredParams.length > 0
    ? structuredParams.map((p) => p.name || 'arg').join(', ')
    : 'nums';

  const cParams = structuredParams.length > 0
    ? structuredParams.map((p) => {
        const t = (p.type || '').includes('vector') ? 'int*' : (p.type || 'int');
        return `${t} ${p.name || 'arg'}`;
      }).join(', ')
    : 'int* nums, int numsSize';

  const starterTemplates = {
    cpp: `#include <vector>\n#include <string>\n#include <iostream>\nusing namespace std;\n\nclass Solution {\npublic:\n    ${retType} ${fnName}(${cppParams}) {\n        // Implement solution here\n        return 0;\n    }\n};\n`,
    python: `class Solution:\n    def ${fnName}(self, ${pyParams}) -> int:\n        # Implement solution here\n        return 0\n`,
    java: `import java.util.*;\n\nclass Solution {\n    public ${retType.includes('vector') ? 'int[]' : retType} ${fnName}(${javaParams}) {\n        // Implement solution here\n        return 0;\n    }\n}\n`,
    javascript: `/**\n * @return {${retType}}\n */\nfunction ${fnName}(${jsParams}) {\n    // Implement solution here\n    return 0;\n}\n`,
    c: `#include <stdio.h>\n#include <stdlib.h>\n\n${retType.includes('vector') ? 'int*' : retType} ${fnName}(${cParams}) {\n    // Implement solution here\n    return 0;\n}\n`,
  };

  const harnessTemplates = {
    cpp: `#include <iostream>\n#include <vector>\n#include <sstream>\n#include <string>\nusing namespace std;\n\n// __STUDENT_CODE__\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    string line;\n    if (getline(cin, line)) {\n        stringstream ss(line);\n        vector<int> nums;\n        int val;\n        while (ss >> val) nums.push_back(val);\n        Solution sol;\n        cout << sol.${fnName}(nums) << "\\n";\n    }\n    return 0;\n}\n`,
    python: `import sys\n\n# __STUDENT_CODE__\n\ndef _trusted_platform_harness_main():\n    raw_input = sys.stdin.read().split()\n    if not raw_input:\n        return\n    sol = Solution()\n    try:\n        nums = [int(x) for x in raw_input]\n        print(sol.${fnName}(nums))\n    except Exception:\n        print(sol.${fnName}(*raw_input))\n\nif __name__ == '__main__':\n    _trusted_platform_harness_main()\n`,
    java: `import java.util.*;\n\n// __STUDENT_CODE__\n\npublic class Solution {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        List<Integer> list = new ArrayList<>();\n        while (sc.hasNextInt()) {\n            list.add(sc.nextInt());\n        }\n        int[] nums = new int[list.size()];\n        for (int i = 0; i < list.size(); i++) nums[i] = list.get(i);\n        Solution sol = new Solution();\n        System.out.println(sol.${fnName}(nums));\n    }\n}\n`,
    javascript: `const readline = require('readline');\n\n// __STUDENT_CODE__\n\nconst rl = readline.createInterface({\n    input: process.stdin,\n    output: process.stdout\n});\n\nlet inputData = '';\nrl.on('line', (line) => { inputData += line + '\\n'; });\nrl.on('close', () => {\n    const nums = inputData.trim().split(/\\s+/).map(Number);\n    console.log(${fnName}(nums));\n});\n`,
    c: `#include <stdio.h>\n#include <stdlib.h>\n\n// __STUDENT_CODE__\n\nint main() {\n    int val;\n    int capacity = 16, size = 0;\n    int* arr = (int*)malloc(capacity * sizeof(int));\n    while (scanf("%d", &val) == 1) {\n        if (size >= capacity) {\n            capacity *= 2;\n            arr = (int*)realloc(arr, capacity * sizeof(int));\n        }\n        arr[size++] = val;\n    }\n    printf("%d\\n", ${fnName}(arr, size));\n    free(arr);\n    return 0;\n}\n`,
  };

  return { starterTemplates, harnessTemplates };
}

/**
 * Shared validation logic for problem form payloads
 */
export function validateProblemForm(data) {
  const errors = {};

  if (!data.title || typeof data.title !== 'string' || data.title.trim().length < 3) {
    errors.title = 'Problem title is required and must be at least 3 characters long.';
  } else if (data.title.trim().length > 200) {
    errors.title = 'Problem title must not exceed 200 characters.';
  }

  if (!data.description || typeof data.description !== 'string' || data.description.trim().length < 5) {
    errors.description = 'Problem statement is required and must be at least 5 characters long.';
  }

  const validDifficulties = ['easy', 'medium', 'hard'];
  if (!data.difficulty || !validDifficulties.includes(data.difficulty.toLowerCase())) {
    errors.difficulty = 'Difficulty must be one of: easy, medium, hard.';
  }

  const validModes = ['full_program', 'function'];
  if (!data.codingMode || !validModes.includes(data.codingMode.toLowerCase())) {
    errors.codingMode = 'Coding mode must be either Standard OJ (full_program) or Function Mode (function).';
  }

  const validScopes = ['public', 'contest_private', 'class', 'institution'];
  if (!data.accessScope || !validScopes.includes(data.accessScope.toLowerCase())) {
    errors.accessScope = 'Access scope must be one of: public, contest_private, class, institution.';
  }

  const timeLimit = Number(data.timeLimitMs);
  if (isNaN(timeLimit) || timeLimit < 500 || timeLimit > 10000) {
    errors.timeLimitMs = 'Time limit must be an integer between 500 ms and 10000 ms.';
  }

  const memoryLimit = Number(data.memoryLimitMb);
  if (isNaN(memoryLimit) || memoryLimit < 64 || memoryLimit > 1024) {
    errors.memoryLimitMb = 'Memory limit must be an integer between 64 MB and 1024 MB.';
  }

  // Allowed Languages validation
  if (data.allowedLanguages !== undefined && data.allowedLanguages !== null) {
    if (!Array.isArray(data.allowedLanguages) || data.allowedLanguages.length === 0) {
      errors.allowedLanguages = 'At least one language must be enabled for the problem.';
    } else {
      const validLangIds = SUPPORTED_LANGUAGES.map((l) => l.id);
      const seen = new Set();
      for (const lang of data.allowedLanguages) {
        if (!validLangIds.includes(lang)) {
          errors.allowedLanguages = `Unsupported language "${lang}" in allowed languages.`;
          break;
        }
        if (seen.has(lang)) {
          errors.allowedLanguages = `Duplicate language "${lang}" in allowed languages.`;
          break;
        }
        seen.add(lang);
      }
    }
  }

  // Function Mode validation
  if (data.codingMode === 'function') {
    const fnName = data.functionConfig?.functionName?.trim();
    if (!fnName) {
      errors.functionName = 'Function name is required in Function Mode.';
    } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fnName)) {
      errors.functionName = 'Function name must be a valid identifier (alphanumeric and underscores only).';
    }

    if (data.functionConfig && data.functionConfig.returnType !== undefined) {
      const retType = data.functionConfig.returnType?.trim();
      if (!retType) {
        errors.returnType = 'Return type is required in Function Mode.';
      }
    }

    // Parameter duplicate and syntax checks
    if (data.functionConfig?.parameters) {
      const params = data.functionConfig.parameters;
      const seenNames = new Set();

      if (Array.isArray(params)) {
        for (let i = 0; i < params.length; i++) {
          const p = params[i];
          const pName = (p.name || '').trim();
          const pType = (p.type || '').trim();

          if (!pName) {
            errors[`param_${i}`] = `Parameter ${i + 1} is missing a parameter name.`;
          } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pName)) {
            errors[`param_${i}`] = `Parameter name "${pName}" must be a valid identifier.`;
          } else if (seenNames.has(pName.toLowerCase())) {
            errors[`param_${i}`] = `Duplicate parameter name "${pName}". Parameter names must be unique.`;
          } else {
            seenNames.add(pName.toLowerCase());
          }

          if (!pType) {
            errors[`param_type_${i}`] = `Parameter "${pName || i + 1}" is missing a type.`;
          }
        }
      } else if (typeof params === 'string') {
        const trimmed = params.trim();
        if (trimmed.length > 0) {
          const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
          for (let i = 0; i < parts.length; i++) {
            const tokens = parts[i].split(/\s+/).filter(Boolean);
            if (tokens.length < 2) {
              errors[`param_${i}`] = `Parameter ${i + 1} ("${parts[i]}") is missing a parameter name.`;
            } else {
              const rawName = tokens[tokens.length - 1].replace(/^[&*]+/, '');
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawName)) {
                errors[`param_${i}`] = `Parameter name "${rawName}" must be a valid identifier.`;
              } else if (seenNames.has(rawName.toLowerCase())) {
                errors[`param_${i}`] = `Duplicate parameter name "${rawName}". Parameter names must be unique.`;
              } else {
                seenNames.add(rawName.toLowerCase());
              }
            }
          }
        }
      }
    }

    if (data.harnessTemplates && typeof data.harnessTemplates === 'object') {
      for (const [lang, template] of Object.entries(data.harnessTemplates)) {
        if (typeof template === 'string' && template.trim().length > 0) {
          if (!template.includes('__STUDENT_CODE__')) {
            errors[`harness_${lang}`] = `Harness template for ${lang} must include the // __STUDENT_CODE__ placeholder.`;
          }
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
