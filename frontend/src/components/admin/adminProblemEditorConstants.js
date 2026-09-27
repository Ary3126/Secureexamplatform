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

  if (data.codingMode === 'function') {
    const fnName = data.functionConfig?.functionName?.trim();
    if (!fnName) {
      errors.functionName = 'Function name is required in Function Mode.';
    } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fnName)) {
      errors.functionName = 'Function name must be a valid identifier (alphanumeric and underscores only).';
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
