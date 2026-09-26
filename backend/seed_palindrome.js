/**
 * Seed script: Add "Palindrome Number" problem (function mode, public access)
 * with 20 test cases via the platform REST API.
 * Run: node seed_palindrome.js
 */

const http = require('http');

const BASE = 'http://localhost:5000';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // 1. Login as platform_admin (professor/admin can create problems)
  console.log('🔐 Logging in as platform_admin...');
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'admin@securejudge.io',
    password: 'Admin@1234',
  });

  if (loginRes.status !== 200 || !loginRes.body.token) {
    // Try default seeded password hash — need actual plain text. Try common ones.
    console.log('Login response:', loginRes.body);
    console.log('\n❌ Login failed. Trying professor_seed account...');
    const login2 = await request('POST', '/api/auth/login', {
      email: 'professor@university.edu',
      password: 'Admin@1234',
    });
    console.log('Professor login response:', login2.body);

    if (login2.status !== 200 || !login2.body.token) {
      console.log('\n❌ Both logins failed. The seeded password hash needs to be known.');
      console.log('Please run: node -e "const b=require(\'bcryptjs\');b.hash(\'Admin@1234\',10).then(h=>console.log(h))"');
      console.log('Then update the password_hash in the users table and re-run this script.');
      process.exit(1);
    }
  }

  const token = loginRes.body?.token || null;
  if (!token) {
    console.log('No token received. Exiting.');
    process.exit(1);
  }
  console.log('✅ Logged in successfully.\n');

  // 2. Create the problem
  console.log('📝 Creating "Palindrome Number" problem...');
  const problemBody = {
    title: 'Palindrome Number',
    description: `Given an integer \`x\`, return \`true\` if \`x\` is a **palindrome**, and \`false\` otherwise.

A number is a palindrome if it reads the same forward and backward.

---

**Example 1:**
\`\`\`
Input: x = 121
Output: true
Explanation: 121 reads as 121 from left to right and from right to left.
\`\`\`

**Example 2:**
\`\`\`
Input: x = -121
Output: false
Explanation: From left to right, it reads -121. From right to left, it becomes 121-. Therefore it is not a palindrome.
\`\`\`

**Example 3:**
\`\`\`
Input: x = 10
Output: false
Explanation: Reads 01 from right to left. Therefore it is not a palindrome.
\`\`\`

---

**Constraints:**
- \`-2³¹ <= x <= 2³¹ - 1\`

**Follow up:** Could you solve it without converting the integer to a string?`,
    difficulty: 'easy',
    coding_mode: 'function',
    access_scope: 'public',
    starter_templates: {
      python: `class Solution:
    def isPalindrome(self, x: int) -> bool:
        # Write your code here
        pass
`,
      javascript: `/**
 * @param {number} x
 * @return {boolean}
 */
function isPalindrome(x) {
    // Write your code here
}
`,
      cpp: `#include <climits>
using namespace std;

class Solution {
public:
    bool isPalindrome(int x) {
        // Write your code here
    }
};
`,
      java: `class Solution {
    public boolean isPalindrome(int x) {
        // Write your code here
    }
}
`,
      c: `#include <stdbool.h>

bool isPalindrome(int x) {
    // Write your code here
}
`,
    },
    harness_templates: {
      python: `import sys
from solution import Solution

def main():
    x = int(input().strip())
    result = Solution().isPalindrome(x)
    print("true" if result else "false")

if __name__ == "__main__":
    main()
`,
      javascript: `const readline = require('readline');
const { isPalindrome } = require('./solution');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    const x = parseInt(line.trim(), 10);
    console.log(isPalindrome(x) ? 'true' : 'false');
    rl.close();
});
`,
      cpp: `#include <iostream>
#include <climits>
using namespace std;

class Solution {
public:
    bool isPalindrome(int x);
};

int main() {
    int x;
    cin >> x;
    Solution sol;
    cout << (sol.isPalindrome(x) ? "true" : "false") << endl;
    return 0;
}
`,
      java: `import java.util.Scanner;

class Solution {
    public boolean isPalindrome(int x) {
        // student code
    }
}

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int x = sc.nextInt();
        Solution sol = new Solution();
        System.out.println(sol.isPalindrome(x) ? "true" : "false");
    }
}
`,
    },
  };

  const createRes = await request('POST', '/api/problems', problemBody, token);
  if (createRes.status !== 201 && createRes.status !== 200) {
    console.error('❌ Failed to create problem:', createRes.body);
    process.exit(1);
  }

  const problemId = createRes.body.problem?.id || createRes.body.id;
  console.log(`✅ Problem created! ID: ${problemId}\n`);

  // 3. Add all 20 test cases
  const testCases = [
    { input: '121',        expected: 'true',  is_sample: true,  is_hidden: false },
    { input: '-121',       expected: 'false', is_sample: true,  is_hidden: false },
    { input: '10',         expected: 'false', is_sample: true,  is_hidden: false },
    { input: '0',          expected: 'true',  is_sample: false, is_hidden: false },
    { input: '11',         expected: 'true',  is_sample: false, is_hidden: false },
    { input: '22',         expected: 'true',  is_sample: false, is_hidden: false },
    { input: '123',        expected: 'false', is_sample: false, is_hidden: false },
    { input: '1221',       expected: 'true',  is_sample: false, is_hidden: false },
    { input: '12321',      expected: 'true',  is_sample: false, is_hidden: false },
    { input: '100',        expected: 'false', is_sample: false, is_hidden: false },
    { input: '101',        expected: 'true',  is_sample: false, is_hidden: true  },
    { input: '12345',      expected: 'false', is_sample: false, is_hidden: true  },
    { input: '-1',         expected: 'false', is_sample: false, is_hidden: true  },
    { input: '-121',       expected: 'false', is_sample: false, is_hidden: true  },
    { input: '1001',       expected: 'true',  is_sample: false, is_hidden: true  },
    { input: '10001',      expected: 'true',  is_sample: false, is_hidden: true  },
    { input: '1234321',    expected: 'true',  is_sample: false, is_hidden: true  },
    { input: '2147447412', expected: 'true',  is_sample: false, is_hidden: true  },
    { input: '2147483647', expected: 'false', is_sample: false, is_hidden: true  },
    { input: '-12321',     expected: 'false', is_sample: false, is_hidden: true  },
  ];

  console.log(`📋 Adding ${testCases.length} test cases...`);
  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const tcRes = await request(
      'POST',
      `/api/problems/${problemId}/test-cases`,
      {
        input_data: tc.input,
        expected_output: tc.expected,
        is_sample: tc.is_sample,
        is_hidden: tc.is_hidden,
        time_limit_ms: 2000,
        memory_limit_mb: 256,
        test_order: i + 1,
      },
      token
    );
    if (tcRes.status === 201 || tcRes.status === 200) {
      console.log(`  ✅ TC ${i + 1}: input=${tc.input.padStart(12)} → ${tc.expected} (${tc.is_sample ? 'sample' : tc.is_hidden ? 'hidden' : 'visible'})`);
      passed++;
    } else {
      console.error(`  ❌ TC ${i + 1} failed:`, tcRes.body);
    }
  }

  console.log(`\n🎉 Done! ${passed}/${testCases.length} test cases added.`);
  console.log(`🔗 Problem ID: ${problemId}`);
  console.log(`🌐 View at: http://localhost:5173/problems/${problemId}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
