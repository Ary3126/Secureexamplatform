/**
 * HarnessBuilder - Secure server-side execution harness generator for Function/Logic mode
 * Wraps untrusted student function/class logic into a trusted, platform-controlled execution harness.
 */
class HarnessBuilder {
  /**
   * Combine student code with server-controlled test harness if in function mode
   * @param {Object} options - { language, codingMode, sourceCode, problem }
   * @returns {string} Executable complete source code
   */
  static buildExecutableCode({ language, codingMode = 'function', sourceCode, problem = null }) {
    if (codingMode !== 'function') {
      return sourceCode;
    }

    const lang = (language || '').toLowerCase().trim();
    const harnessTemplates = (problem && problem.harnessTemplates) || (problem && problem.harness_templates) || {};

    if (harnessTemplates[lang]) {
      const template = harnessTemplates[lang];
      return template.replace(/(\/\/|\/\*|#)\s*__STUDENT_CODE__\s*(\*\/)?/g, sourceCode);
    }

    switch (lang) {
      case 'cpp':
        return HarnessBuilder.buildCppHarness(sourceCode);
      case 'python':
        return HarnessBuilder.buildPythonHarness(sourceCode);
      case 'java':
        return HarnessBuilder.buildJavaHarness(sourceCode);
      default:
        return sourceCode;
    }
  }

  static buildCppHarness(studentCode) {
    return `// ====== SECURE HARNESS PREAMBLE ======
#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <cmath>
#include <numeric>
using namespace std;

// ====== STUDENT LOGIC ======
${studentCode}

// ====== TRUSTED PLATFORM TEST HARNESS ======
int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    Solution solutionInstance;
    int a, b;
    if (cin >> a >> b) {
        cout << solutionInstance.solve(a, b) << endl;
    }
    return 0;
}
`;
  }

  static buildPythonHarness(studentCode) {
    return `# ====== SECURE HARNESS PREAMBLE ======
import sys
import math
import collections
import itertools
from typing import List, Dict, Set, Optional, Tuple

# ====== STUDENT LOGIC ======
${studentCode}

# ====== TRUSTED PLATFORM TEST HARNESS ======
def _trusted_platform_harness_main():
    raw_input = sys.stdin.read().split()
    if not raw_input:
        return

    sol = Solution()
    if len(raw_input) >= 2:
        try:
            a = int(raw_input[0])
            b = int(raw_input[1])
            res = sol.solve(a, b)
            print(res)
            return
        except (TypeError, ValueError):
            pass

    # Fallback to single or array argument
    try:
        nums = [int(x) for x in raw_input]
        print(sol.solve(nums))
    except Exception:
        print(sol.solve(*raw_input))

if __name__ == '__main__':
    _trusted_platform_harness_main()
`;
  }

  static buildJavaHarness(studentCode) {
    const trimmed = (studentCode || '').trim();
    const lastBraceIdx = trimmed.lastIndexOf('}');
    
    const harnessMain = `
    public static void main(String[] args) {
        try {
            Scanner scanner = new Scanner(System.in);
            List<String> tokens = new ArrayList<>();
            while (scanner.hasNext()) {
                tokens.add(scanner.next());
            }
            scanner.close();

            if (tokens.isEmpty()) return;

            Solution sol = new Solution();
            java.lang.reflect.Method targetMethod = null;
            for (java.lang.reflect.Method m : Solution.class.getDeclaredMethods()) {
                if (m.getName().equals("solve") || m.getName().equals("twoSum") || m.getName().equals("mainLogic")) {
                    targetMethod = m;
                    break;
                }
            }
            if (targetMethod == null) {
                java.lang.reflect.Method[] methods = Solution.class.getDeclaredMethods();
                if (methods.length > 0) targetMethod = methods[0];
            }
            if (targetMethod == null) {
                System.err.println("Method not found in class Solution");
                return;
            }

            Class<?>[] paramTypes = targetMethod.getParameterTypes();
            Object[] argsToPass = new Object[paramTypes.length];

            if (paramTypes.length == 2) {
                argsToPass[0] = Integer.parseInt(tokens.get(0));
                argsToPass[1] = Integer.parseInt(tokens.get(1));
            } else if (paramTypes.length == 1) {
                if (paramTypes[0] == int.class || paramTypes[0] == Integer.class) {
                    argsToPass[0] = Integer.parseInt(tokens.get(0));
                } else if (paramTypes[0] == int[].class) {
                    int[] arr = new int[tokens.size()];
                    for (int i = 0; i < tokens.size(); i++) arr[i] = Integer.parseInt(tokens.get(i));
                    argsToPass[0] = arr;
                } else if (paramTypes[0] == String.class) {
                    argsToPass[0] = String.join(" ", tokens);
                }
            }

            Object result = targetMethod.invoke(sol, argsToPass);
            if (result != null) {
                if (result instanceof int[]) {
                    System.out.println(Arrays.toString((int[]) result));
                } else {
                    System.out.println(result);
                }
            }
        } catch (Throwable t) {
            if (t instanceof java.lang.reflect.InvocationTargetException && t.getCause() != null) {
                t.getCause().printStackTrace(System.err);
            } else {
                t.printStackTrace(System.err);
            }
        }
    }
`;

    let combined;
    if (lastBraceIdx !== -1) {
      combined = trimmed.slice(0, lastBraceIdx) + '\n' + harnessMain + '\n}';
    } else {
      combined = `public class Solution {\n${trimmed}\n${harnessMain}\n}`;
    }

    return `import java.util.*;\nimport java.io.*;\n\n${combined}`;
  }
}

module.exports = HarnessBuilder;