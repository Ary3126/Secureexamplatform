/**
 * Standard Function Mode Starter Templates
 * Multi-language skeleton templates for function-based problem solving
 */
export const STARTER_TEMPLATES = {
  function: {
    cpp: `class Solution {
public:
    int solve(int a, int b) {
        // Write your logic here
        return a + b;
    }
};
`,
    python: `class Solution:
    def solve(self, a: int, b: int) -> int:
        # Write your logic here
        return a + b
`,
    java: `class Solution {
    public int solve(int a, int b) {
        // Write your logic here
        return a + b;
    }
}
`,
  },
};

/**
 * Helper to get starter template for a given language
 */
export function getStarterCode(mode = 'function', lang = 'cpp', problemTemplates = null) {
  const normLang = lang.toLowerCase();

  if (problemTemplates && problemTemplates[normLang]) {
    return problemTemplates[normLang];
  }

  return (
    (STARTER_TEMPLATES.function && STARTER_TEMPLATES.function[normLang]) ||
    STARTER_TEMPLATES.function.cpp
  );
}