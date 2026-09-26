/**
 * Direct DB seed script for "Palindrome Number" problem.
 * No API login needed — writes directly to PostgreSQL.
 * Run: node seed_palindrome_direct.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'ary3126',
  database: process.env.DB_NAME || 'secure_exam_db',
});

const starterTemplates = {
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
};

const harnessTemplates = {
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

bool isPalindrome(int x);

int main() {
    int x;
    cin >> x;
    cout << (isPalindrome(x) ? "true" : "false") << endl;
    return 0;
}
`,
  java: `import java.util.Scanner;

class Main {
    public static boolean isPalindrome(int x) {
        // student code
        return false;
    }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int x = sc.nextInt();
        System.out.println(isPalindrome(x) ? "true" : "false");
    }
}
`,
};

const description = `Given an integer \`x\`, return \`true\` if \`x\` is a **palindrome**, and \`false\` otherwise.

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

**Follow up:** Could you solve it without converting the integer to a string?`;

const testCases = [
  { input: '121',        expected: 'true',  is_sample: true,  is_hidden: false, order: 1  },
  { input: '-121',       expected: 'false', is_sample: true,  is_hidden: false, order: 2  },
  { input: '10',         expected: 'false', is_sample: true,  is_hidden: false, order: 3  },
  { input: '0',          expected: 'true',  is_sample: false, is_hidden: false, order: 4  },
  { input: '11',         expected: 'true',  is_sample: false, is_hidden: false, order: 5  },
  { input: '22',         expected: 'true',  is_sample: false, is_hidden: false, order: 6  },
  { input: '123',        expected: 'false', is_sample: false, is_hidden: false, order: 7  },
  { input: '1221',       expected: 'true',  is_sample: false, is_hidden: false, order: 8  },
  { input: '12321',      expected: 'true',  is_sample: false, is_hidden: false, order: 9  },
  { input: '100',        expected: 'false', is_sample: false, is_hidden: false, order: 10 },
  { input: '101',        expected: 'true',  is_sample: false, is_hidden: true,  order: 11 },
  { input: '12345',      expected: 'false', is_sample: false, is_hidden: true,  order: 12 },
  { input: '-1',         expected: 'false', is_sample: false, is_hidden: true,  order: 13 },
  { input: '-121',       expected: 'false', is_sample: false, is_hidden: true,  order: 14 },
  { input: '1001',       expected: 'true',  is_sample: false, is_hidden: true,  order: 15 },
  { input: '10001',      expected: 'true',  is_sample: false, is_hidden: true,  order: 16 },
  { input: '1234321',    expected: 'true',  is_sample: false, is_hidden: true,  order: 17 },
  { input: '2147447412', expected: 'true',  is_sample: false, is_hidden: true,  order: 18 },
  { input: '2147483647', expected: 'false', is_sample: false, is_hidden: true,  order: 19 },
  { input: '-12321',     expected: 'false', is_sample: false, is_hidden: true,  order: 20 },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get admin user id
    const adminRes = await client.query(
      `SELECT id FROM users WHERE email = 'admin@securejudge.io' LIMIT 1`
    );
    if (!adminRes.rows.length) throw new Error('Admin user not found!');
    const adminId = adminRes.rows[0].id;
    console.log(`✅ Found admin user ID: ${adminId}`);

    // Check if problem already exists
    const existing = await client.query(
      `SELECT id FROM problems WHERE title = 'Palindrome Number' LIMIT 1`
    );
    let problemId;

    if (existing.rows.length) {
      problemId = existing.rows[0].id;
      console.log(`ℹ️  Problem already exists with ID: ${problemId}. Updating...`);
      await client.query(
        `UPDATE problems SET
          description = $1,
          difficulty = 'easy',
          coding_mode = 'function',
          access_scope = 'public',
          starter_templates = $2,
          harness_templates = $3,
          updated_at = NOW()
        WHERE id = $4`,
        [description, JSON.stringify(starterTemplates), JSON.stringify(harnessTemplates), problemId]
      );
      // Remove old test cases
      await client.query(`DELETE FROM test_cases WHERE problem_id = $1`, [problemId]);
      console.log(`🗑️  Old test cases removed.`);
    } else {
      const probRes = await client.query(
        `INSERT INTO problems
          (title, description, difficulty, coding_mode, access_scope,
           starter_templates, harness_templates, created_by,
           is_published, review_status, created_at, updated_at)
        VALUES ($1, $2, 'easy', 'function', 'public', $3, $4, $5, true, 'approved', NOW(), NOW())
        RETURNING id`,
        [
          'Palindrome Number',
          description,
          JSON.stringify(starterTemplates),
          JSON.stringify(harnessTemplates),
          adminId,
        ]
      );
      problemId = probRes.rows[0].id;
      console.log(`✅ Problem created with ID: ${problemId}`);
    }

    // Insert all 20 test cases
    console.log(`\n📋 Inserting ${testCases.length} test cases...`);
    for (const tc of testCases) {
      await client.query(
        `INSERT INTO test_cases
          (problem_id, input_data, expected_output, is_sample, is_hidden,
           time_limit_ms, memory_limit_mb, test_order, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 2000, 256, $6, NOW(), NOW())`,
        [problemId, tc.input, tc.expected, tc.is_sample, tc.is_hidden, tc.order]
      );
      console.log(
        `  ✅ TC ${String(tc.order).padStart(2)}: ${tc.input.padStart(12)} → ${tc.expected.padEnd(5)} ` +
        `[${tc.is_sample ? 'sample ' : tc.is_hidden ? 'hidden ' : 'visible'}]`
      );
    }

    await client.query('COMMIT');
    console.log(`\n🎉 Done! "Palindrome Number" problem is live.`);
    console.log(`🔗 Problem ID: ${problemId}`);
    console.log(`🌐 View at: http://localhost:5173/problems/${problemId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
