require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'ary3126',
  database: process.env.DB_NAME || 'secure_exam_db',
});

// Fixed harness templates — use __STUDENT_CODE__ placeholder so harnessBuilder injects student code
const harnessTemplates = {
  cpp: `#include <iostream>
#include <climits>
#include <string>
using namespace std;

// __STUDENT_CODE__

int main() {
    int x;
    cin >> x;
    Solution sol;
    cout << (sol.isPalindrome(x) ? "true" : "false") << endl;
    return 0;
}
`,
  python: `import sys

# __STUDENT_CODE__

def main():
    x = int(input().strip())
    result = Solution().isPalindrome(x)
    print("true" if result else "false")

if __name__ == "__main__":
    main()
`,
  javascript: `// __STUDENT_CODE__

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    const x = parseInt(line.trim(), 10);
    const sol = new Solution ? new Solution() : null;
    const result = typeof isPalindrome === 'function' ? isPalindrome(x) : sol.isPalindrome(x);
    console.log(result ? 'true' : 'false');
    rl.close();
});
`,
  java: `import java.util.Scanner;

// __STUDENT_CODE__

class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int x = sc.nextInt();
        Solution sol = new Solution();
        System.out.println(sol.isPalindrome(x) ? "true" : "false");
    }
}
`,
};

async function main() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE problems SET harness_templates = $1, updated_at = NOW() WHERE title = 'Palindrome Number' RETURNING id, title`,
      [JSON.stringify(harnessTemplates)]
    );
    if (result.rows.length) {
      console.log(`✅ Fixed harness templates for: "${result.rows[0].title}" (ID: ${result.rows[0].id})`);
      console.log('   C++ harness now uses Solution class correctly.');
      console.log('   Java harness now instantiates Solution correctly.');
    } else {
      console.log('❌ Problem not found!');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
