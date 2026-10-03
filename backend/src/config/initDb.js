const fs = require('fs');
const path = require('path');
const { query } = require('./db');

/**
 * Run database migrations / schema initialization
 */
const initDb = async () => {
  try {
    // 1. Apply incremental ALTER column migrations first for all legacy tables
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(30) NOT NULL DEFAULT 'student',
        bio TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS institution VARCHAR(150) DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS current_rating INTEGER NOT NULL DEFAULT 1200;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS highest_rating INTEGER NOT NULL DEFAULT 1200;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_status VARCHAR(20) NOT NULL DEFAULT 'provisional';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rated_contest_count INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_users_institution ON users(institution);
      CREATE INDEX IF NOT EXISTS idx_users_rating_status ON users(rating_status);
      CREATE INDEX IF NOT EXISTS idx_users_current_rating ON users(current_rating DESC);
      CREATE INDEX IF NOT EXISTS idx_users_rating_desc_id_asc ON users(current_rating DESC, id ASC);

      CREATE TABLE IF NOT EXISTS contests (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE contests ADD COLUMN IF NOT EXISTS is_rated BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE contests ADD COLUMN IF NOT EXISTS is_rating_finalized BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE contests ADD COLUMN IF NOT EXISTS ratings_finalized_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE contests ADD COLUMN IF NOT EXISTS leaderboard_freeze_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE contests ADD COLUMN IF NOT EXISTS leaderboard_freeze_minutes INTEGER NOT NULL DEFAULT 60;
      ALTER TABLE contests ADD COLUMN IF NOT EXISTS final_results_snapshot JSONB DEFAULT NULL;

      -- Ensure submissions.contest_id is nullable for public practice submissions
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'submissions' AND column_name = 'contest_id' AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE submissions ALTER COLUMN contest_id DROP NOT NULL;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_submissions_contest_user_status ON submissions(contest_id, user_id, status, is_sample_run);

      -- Phase 5.9.2.2: Ensure submissions foreign keys use RESTRICT to prevent accidental cascade deletion
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'submissions_problem_id_fkey' AND confdeltype = 'c'
        ) THEN
          ALTER TABLE submissions DROP CONSTRAINT submissions_problem_id_fkey;
          ALTER TABLE submissions ADD CONSTRAINT submissions_problem_id_fkey 
            FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE RESTRICT;
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'submissions_contest_id_fkey' AND confdeltype = 'c'
        ) THEN
          ALTER TABLE submissions DROP CONSTRAINT submissions_contest_id_fkey;
          ALTER TABLE submissions ADD CONSTRAINT submissions_contest_id_fkey 
            FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE RESTRICT;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS test_cases (
        id SERIAL PRIMARY KEY,
        problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        input_data TEXT NOT NULL,
        expected_output TEXT NOT NULL,
        is_sample BOOLEAN NOT NULL DEFAULT false,
        order_index INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 1;

      -- Ensure user_skills confidence column supports 0-100 bounded scale (Phase 5.7.3)
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'user_skills' AND column_name = 'confidence'
        ) THEN
          ALTER TABLE user_skills ALTER COLUMN confidence TYPE NUMERIC(6, 2);
          ALTER TABLE user_skills ALTER COLUMN confidence SET DEFAULT 0.00;
        END IF;
      END $$;

      -- Ensure classification column exists on user_skills and user_skill_history (Phase 5.7.5)
      ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS classification VARCHAR(30) NOT NULL DEFAULT 'UNASSESSED';
      ALTER TABLE user_skill_history ADD COLUMN IF NOT EXISTS classification VARCHAR(30) DEFAULT 'UNASSESSED';
      CREATE INDEX IF NOT EXISTS idx_user_skills_classification ON user_skills(classification);

      -- Phase 5.8.6: Performance analytics & candidate selection partial indexes
      CREATE INDEX IF NOT EXISTS idx_submissions_perf_analytics 
      ON submissions(problem_id, LOWER(language), contest_id) 
      INCLUDE (execution_time, memory_used) 
      WHERE status = 'accepted' AND is_sample_run = false;

      CREATE INDEX IF NOT EXISTS idx_submissions_user_problem_recent 
      ON submissions(user_id, problem_id, created_at DESC) 
      WHERE is_sample_run = false;

      -- Phase 5.9.2.3: Persistent Audit Logs Table & Indexes
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50) NOT NULL DEFAULT 'system',
        resource_id INTEGER,
        outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
        metadata JSONB NOT NULL DEFAULT '{}',
        ip_address VARCHAR(45),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs(outcome);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

      -- Phase 5.9.2.4: Ensure contests status check constraint supports 'archived'
      DO $$
      BEGIN
        ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_status_check;
        ALTER TABLE contests ADD CONSTRAINT contests_status_check CHECK (status IN ('draft', 'published', 'archived'));
      EXCEPTION
        WHEN OTHERS THEN NULL;
      END $$;

      -- Ensure problem_validation_configs schema supports Phase 4B/5 validation fields
      CREATE TABLE IF NOT EXISTS problem_validation_configs (
        problem_id INTEGER PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
        validation_enabled BOOLEAN NOT NULL DEFAULT true,
        generator_type VARCHAR(50) NOT NULL DEFAULT 'range_generator',
        generator_params JSONB NOT NULL DEFAULT '{"min": 1, "max": 1000}'::jsonb,
        random_test_count INTEGER NOT NULL DEFAULT 10,
        oracle_code TEXT,
        oracle_language VARCHAR(20) DEFAULT 'javascript',
        time_limit_ms INTEGER NOT NULL DEFAULT 2000,
        memory_limit_mb INTEGER NOT NULL DEFAULT 128,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS id SERIAL;
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS random_enabled BOOLEAN DEFAULT true;
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS edge_enabled BOOLEAN DEFAULT false;
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS boundary_enabled BOOLEAN DEFAULT false;
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS generator_config JSONB DEFAULT '{}';
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS reference_solution JSONB DEFAULT '{}';
      ALTER TABLE problem_validation_configs ADD COLUMN IF NOT EXISTS validation_metadata JSONB DEFAULT '{}';

      -- Seed persistent test users for automated suites
      INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rating_status)
      VALUES 
        ('professor_seed', 'professor@university.edu', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Professor Seed', 'professor', 1500, 1500, 'rated'),
        ('student_seed', 'student@university.edu', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Student Seed', 'student', 1200, 1200, 'provisional')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
    `);

    // 2. Incremental Column & Scope Migration (Master Hardening & Phase 5.9.5 Versioning)
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'problems' AND column_name = 'access_scope'
        ) THEN
          ALTER TABLE problems ADD COLUMN access_scope VARCHAR(30) NOT NULL DEFAULT 'public' 
            CHECK (access_scope IN ('public', 'contest_private', 'class', 'institution'));
        END IF;
      END $$;

      -- Phase 5.9.5: Problem Authoring Studio, Versioning & Historical Integrity
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS problem_version INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS problem_versions (
        id SERIAL PRIMARY KEY,
        problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
        coding_mode VARCHAR(30) NOT NULL DEFAULT 'full_program' CHECK (coding_mode IN ('full_program', 'function')),
        starter_templates JSONB DEFAULT '{}'::jsonb,
        harness_templates JSONB DEFAULT '{}'::jsonb,
        access_scope VARCHAR(30) NOT NULL DEFAULT 'contest_private',
        test_cases_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
        validation_config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_problem_versions_prob_ver UNIQUE (problem_id, version_number)
      );

      -- Phase 5.9.6 Migration: Problem Review & Approval Governance
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'draft';
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS approved_version INTEGER;
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

      CREATE TABLE IF NOT EXISTS problem_reviews (
        id SERIAL PRIMARY KEY,
        problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        problem_version INTEGER NOT NULL,
        submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'changes_requested', 'rejected', 'approved', 'revoked')),
        decision_reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS problem_review_comments (
        id SERIAL PRIMARY KEY,
        review_id INTEGER NOT NULL REFERENCES problem_reviews(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_type VARCHAR(30) NOT NULL DEFAULT 'general' CHECK (comment_type IN ('general', 'change_request', 'rejection_reason', 'approval_note', 'author_response')),
        comment TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_problems_version ON problems(version);
      CREATE INDEX IF NOT EXISTS idx_problems_is_published ON problems(is_published);
      CREATE INDEX IF NOT EXISTS idx_problems_review_status ON problems(review_status);
      CREATE INDEX IF NOT EXISTS idx_problem_versions_problem_id ON problem_versions(problem_id);
      CREATE INDEX IF NOT EXISTS idx_problem_versions_lookup ON problem_versions(problem_id, version_number);
      CREATE INDEX IF NOT EXISTS idx_submissions_problem_version ON submissions(problem_id, problem_version);
      CREATE INDEX IF NOT EXISTS idx_problem_reviews_problem ON problem_reviews(problem_id, problem_version);
      CREATE INDEX IF NOT EXISTS idx_problem_reviews_reviewer ON problem_reviews(reviewer_id);
      CREATE INDEX IF NOT EXISTS idx_problem_reviews_status ON problem_reviews(status);
      CREATE INDEX IF NOT EXISTS idx_problem_reviews_submitted_by ON problem_reviews(submitted_by);
      CREATE INDEX IF NOT EXISTS idx_problem_reviews_created_at ON problem_reviews(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_comments_review_id ON problem_review_comments(review_id);
      CREATE INDEX IF NOT EXISTS idx_review_comments_author_id ON problem_review_comments(author_id);
      CREATE INDEX IF NOT EXISTS idx_review_comments_created_at ON problem_review_comments(created_at ASC);

      -- Phase 5.9.7 Migration: Problem Quality Snapshots
      CREATE TABLE IF NOT EXISTS problem_quality_snapshots (
        id SERIAL PRIMARY KEY,
        problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        problem_version INTEGER NOT NULL,
        quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
        quality_level VARCHAR(30) NOT NULL,
        breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
        checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
        evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_problem_quality_prob_ver UNIQUE (problem_id, problem_version)
      );

      CREATE INDEX IF NOT EXISTS idx_problem_quality_problem ON problem_quality_snapshots(problem_id);
      CREATE INDEX IF NOT EXISTS idx_problem_quality_lookup ON problem_quality_snapshots(problem_id, problem_version);

      -- Phase 5.9.8 Migration: Problem Lifecycle, Rollback & Scheduled Publication
      ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_review_status_check;
      ALTER TABLE problems ADD CONSTRAINT problems_review_status_check CHECK (review_status IN ('draft', 'review_requested', 'in_review', 'changes_requested', 'rejected', 'approved', 'published', 'archived', 'withdrawn'));
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE problems ADD COLUMN IF NOT EXISTS scheduled_publish_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_problems_scheduled_publish ON problems(scheduled_publish_at) WHERE scheduled_publish_at IS NOT NULL;
      ALTER TABLE problem_versions ADD COLUMN IF NOT EXISTS change_summary TEXT;
      ALTER TABLE problem_versions ADD COLUMN IF NOT EXISTS source_action VARCHAR(50) DEFAULT 'published';

      -- Phase 5.9.10 Migration: Platform Reliability, Observability & System Incidents
      CREATE TABLE IF NOT EXISTS system_incidents (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        endpoint VARCHAR(255),
        request_id VARCHAR(64),
        message TEXT NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX IF NOT EXISTS idx_system_incidents_created ON system_incidents(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system_incidents_severity ON system_incidents(severity);
      CREATE INDEX IF NOT EXISTS idx_system_incidents_status ON system_incidents(status);
      CREATE INDEX IF NOT EXISTS idx_system_incidents_category ON system_incidents(category);
      CREATE INDEX IF NOT EXISTS idx_system_incidents_request_id ON system_incidents(request_id);

      -- Phase 7.5.5.8 Migration: Contest Problem Order Integrity
      ALTER TABLE contest_problems DROP CONSTRAINT IF EXISTS contest_problems_order_check;
      ALTER TABLE contest_problems ADD CONSTRAINT contest_problems_order_check CHECK (problem_order > 0);
    `);

    // 2b. Execute full schema SQL (tables, indexes, constraints)
    const schemaPath = path.resolve(__dirname, '../database/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await query(schemaSql);

    // 2c. Prune ephemeral test fixtures created during automated test runs
    await query(`
      -- Prune test submissions first to respect ON DELETE RESTRICT constraints
      DELETE FROM submissions
      WHERE contest_id IN (
        SELECT id FROM contests 
        WHERE (title ILIKE '%Phase 5.8.2 Contest%' 
           OR title ILIKE '%Test Contest 5%' 
           OR title ILIKE '%Skill Test Contest%')
          AND created_at < NOW() - INTERVAL '10 seconds'
      ) OR problem_id IN (
        SELECT id FROM problems
        WHERE (title ILIKE '%Anti-Hardcoding Problem%'
           OR title ILIKE '%Problem 57%'
           OR title ILIKE '%Problem 58%'
           OR title ILIKE '%Hard Problem 57%'
           OR title ILIKE '%Knapsack 57%'
           OR title ILIKE '%Two Sum 57%'
           OR title ILIKE '%Private Exam Problem Secret%'
           OR title ILIKE '%Public Algorithmic Challenge%')
          AND created_at < NOW() - INTERVAL '10 seconds'
      );

      DELETE FROM contest_problems
      WHERE contest_id IN (
        SELECT id FROM contests 
        WHERE (title ILIKE '%Phase 5.8.2 Contest%' 
           OR title ILIKE '%Test Contest 5%' 
           OR title ILIKE '%Skill Test Contest%')
          AND created_at < NOW() - INTERVAL '10 seconds'
      );

      DELETE FROM contests 
      WHERE (title ILIKE '%Phase 5.8.2 Contest%' 
         OR title ILIKE '%Test Contest 5%' 
         OR title ILIKE '%Skill Test Contest%')
        AND created_at < NOW() - INTERVAL '10 seconds';

      DELETE FROM problems
      WHERE (title ILIKE '%Anti-Hardcoding Problem%'
         OR title ILIKE '%Problem 57%'
         OR title ILIKE '%Problem 58%'
         OR title ILIKE '%Hard Problem 57%'
         OR title ILIKE '%Knapsack 57%'
         OR title ILIKE '%Two Sum 57%'
         OR title ILIKE '%Private Exam Problem Secret%'
         OR title ILIKE '%Public Algorithmic Challenge%')
        AND created_at < NOW() - INTERVAL '10 seconds';
    `);

    // 3. Seed canonical platform topics (Phase 5.7.1)
    const DEFAULT_TOPICS = [
      { key: 'arrays', name: 'Arrays & Vectors', category: 'Data Structures', description: 'Contiguous memory buffers, sliding window, and two pointer operations.' },
      { key: 'strings', name: 'Strings & Parsing', category: 'Data Structures', description: 'String manipulation, palindromes, anagrams, and string matching.' },
      { key: 'hashing', name: 'Hashing & Hash Maps', category: 'Data Structures', description: 'Key-value maps, sets, frequency counters, and constant-time lookups.' },
      { key: 'two_pointers', name: 'Two Pointers', category: 'Algorithms', description: 'Two-pointer convergence, opposite ends, and runner techniques.' },
      { key: 'sliding_window', name: 'Sliding Window', category: 'Algorithms', description: 'Subarray and substring contiguous windows with dynamic bounds.' },
      { key: 'binary_search', name: 'Binary Search', category: 'Algorithms', description: 'Logarithmic search space reduction and monotonic predicates.' },
      { key: 'linked_list', name: 'Linked Lists', category: 'Data Structures', description: 'Singly, doubly, and circular linked node traversal and pointer rewiring.' },
      { key: 'stack_queue', name: 'Stacks & Queues', category: 'Data Structures', description: 'LIFO stack, FIFO queue, monotonic stacks, and priority processing.' },
      { key: 'trees', name: 'Trees & BST', category: 'Data Structures', description: 'Binary trees, binary search trees, trie, and tree traversals.' },
      { key: 'graphs', name: 'Graphs & BFS/DFS', category: 'Algorithms', description: 'Adjacency graphs, breadth-first search, depth-first search, and shortest paths.' },
      { key: 'heap', name: 'Heap & Priority Queue', category: 'Data Structures', description: 'Min-heaps, max-heaps, top-k element queries, and scheduling.' },
      { key: 'greedy', name: 'Greedy Algorithms', category: 'Algorithms', description: 'Locally optimal choice heuristics for global optimization problems.' },
      { key: 'dp', name: 'Dynamic Programming', category: 'Algorithms', description: 'Optimal substructure, overlapping subproblems, and memoization.' },
      { key: 'backtracking', name: 'Backtracking', category: 'Algorithms', description: 'Combinatorial search, permutations, subsets, and pruning.' },
      { key: 'bit_manipulation', name: 'Bit Manipulation', category: 'Algorithms', description: 'Binary representations, bitwise operators, and bit masking.' },
      { key: 'math', name: 'Math & Logic', category: 'Math', description: 'Number theory, modular arithmetic, combinatorics, and numerical logic.' }
    ];

    for (const t of DEFAULT_TOPICS) {
      await query(`
        INSERT INTO topics (key, name, category, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (key) DO UPDATE SET 
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          description = EXCLUDED.description;
      `, [t.key, t.name, t.category, t.description]);
    }

    // 4. Seed Canonical Admin & Authorized Public Platform Problems Dataset
    const adminRes = await query(`
      INSERT INTO users (username, email, password_hash, full_name, role, current_rating, highest_rating, rating_status)
      VALUES 
        ('platform_admin', 'admin@securejudge.io', '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6', 'Platform Administrator', 'super_admin', 2000, 2000, 'rated')
      ON CONFLICT (email) DO UPDATE SET role = 'super_admin'
      RETURNING id;
    `);
    const adminId = adminRes.rows[0]?.id || 1;

    // Reset access_scope = 'contest_private' on all non-canonical/professor/test problems
    await query(`
      UPDATE problems 
      SET access_scope = 'contest_private' 
      WHERE title NOT IN ('Two Sum', 'Subarray Sum', 'Palindrome Number');
    `);

    // 4a. Seed Canonical Public Problem: Two Sum (EASY - Function Mode)
    const twoSumStarter = {
      python: `class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        # Write your code here\n        seen = {}\n        for i, num in enumerate(nums):\n            comp = target - num\n            if comp in seen:\n                return [seen[comp], i]\n            seen[num] = i\n        return []\n`,
      cpp: `#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // Write your code here\n        unordered_map<int, int> seen;\n        for (int i = 0; i < nums.size(); ++i) {\n            int comp = target - nums[i];\n            if (seen.count(comp)) {\n                return {seen[comp], i};\n            }\n            seen[nums[i]] = i;\n        }\n        return {};\n    }\n};\n`,
      java: `import java.util.*;\n\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Write your code here\n        Map<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            int comp = target - nums[i];\n            if (seen.containsKey(comp)) {\n                return new int[]{seen.get(comp), i};\n            }\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n`,
      javascript: `/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction twoSum(nums, target) {\n    // Write your code here\n    const seen = new Map();\n    for (let i = 0; i < nums.length; i++) {\n        const comp = target - nums[i];\n        if (seen.has(comp)) {\n            return [seen.get(comp), i];\n        }\n        seen.set(nums[i], i);\n    }\n    return [];\n}\n`,
      c: `#include <stdio.h>\n#include <stdlib.h>\n\nint* twoSum(int* nums, int numsSize, int target, int* returnSize) {\n    *returnSize = 2;\n    int* res = (int*)malloc(2 * sizeof(int));\n    for (int i = 0; i < numsSize; i++) {\n        for (int j = i + 1; j < numsSize; j++) {\n            if (nums[i] + nums[j] == target) {\n                res[0] = i;\n                res[1] = j;\n                return res;\n            }\n        }\n    }\n    *returnSize = 0;\n    return NULL;\n}\n`,
    };

    const twoSumHarness = {
      python: `import sys\n\n# __STUDENT_CODE__\n\ndef _main():\n    lines = [l.strip() for l in sys.stdin.read().strip().split('\\n') if l.strip()]\n    if len(lines) >= 2:\n        nums = list(map(int, lines[0].split()))\n        target = int(lines[1])\n        sol = Solution()\n        if hasattr(sol, 'twoSum'):\n            res = sol.twoSum(nums, target)\n        elif hasattr(sol, 'solve'):\n            res = sol.solve(nums, target)\n        elif 'twoSum' in globals():\n            res = twoSum(nums, target)\n        elif 'solve' in globals():\n            res = solve(nums, target)\n        if res is not None:\n            if isinstance(res, (list, tuple)):\n                print(' '.join(map(str, res)))\n            else:\n                print(res)\n\nif __name__ == '__main__':\n    _main()\n`,
      cpp: `#include <iostream>\n#include <vector>\n#include <sstream>\n#include <string>\n#include <unordered_map>\nusing namespace std;\n\n// __STUDENT_CODE__\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    string line;\n    if (getline(cin, line)) {\n        stringstream ss(line);\n        vector<int> nums;\n        int val;\n        while (ss >> val) nums.push_back(val);\n        int target;\n        if (cin >> target) {\n            Solution sol;\n            vector<int> res = sol.twoSum(nums, target);\n            for (size_t i = 0; i < res.size(); i++) {\n                cout << res[i] << (i + 1 == res.size() ? \"\" : \" \");\n            }\n            cout << \"\\n\";\n        }\n    }\n    return 0;\n}\n`,
      java: `import java.util.*;\nimport java.io.*;\n\n// __STUDENT_CODE__\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextLine()) {\n            String line = sc.nextLine().trim();\n            if (line.isEmpty() && sc.hasNextLine()) line = sc.nextLine().trim();\n            String[] parts = line.split(\"\\\\s+\");\n            int[] nums = new int[parts.length];\n            for (int i = 0; i < parts.length; i++) nums[i] = Integer.parseInt(parts[i]);\n            if (sc.hasNextInt()) {\n                int target = sc.nextInt();\n                Solution sol = new Solution();\n                int[] res = sol.twoSum(nums, target);\n                if (res != null) {\n                    for (int i = 0; i < res.length; i++) {\n                        System.out.print(res[i] + (i + 1 == res.length ? \"\" : \" \"));\n                    }\n                    System.out.println();\n                }\n            }\n        }\n    }\n}\n`,
      javascript: `const readline = require('readline');\n\n// __STUDENT_CODE__\n\nconst rl = readline.createInterface({\n    input: process.stdin,\n    output: process.stdout\n});\n\nconst lines = [];\nrl.on('line', (l) => lines.push(l));\nrl.on('close', () => {\n    const filtered = lines.filter(l => l.trim());\n    if (filtered.length >= 2) {\n        const nums = filtered[0].trim().split(/\\s+/).map(Number);\n        const target = Number(filtered[1].trim());\n        let res;\n        if (typeof twoSum === 'function') {\n            res = twoSum(nums, target);\n        } else if (typeof Solution === 'function') {\n            const sol = new Solution();\n            res = sol.twoSum ? sol.twoSum(nums, target) : sol.solve(nums, target);\n        }\n        if (res !== undefined && res !== null) {\n            if (Array.isArray(res)) {\n                console.log(res.join(' '));\n            } else {\n                console.log(res);\n            }\n        }\n    }\n});\n`,
    };

    const twoSumDesc = `Given an array of integers nums and an integer target, return the indices of the two numbers such that they add up to target.

You may assume that each input has exactly one solution.

Do not use the same element twice.

Return the answer in any valid order.

### Example 1:
**Input:**
nums = [2,7,11,15]
target = 9

**Output:**
[0,1]

**Explanation:**
nums[0] + nums[1] = 2 + 7 = 9.

### Constraints:
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Exactly one valid answer exists.`;

    let twoSum = (await query(`SELECT id FROM problems WHERE title = 'Two Sum' AND access_scope = 'public' LIMIT 1;`)).rows[0];
    if (!twoSum) {
      const tsRes = await query(`
        INSERT INTO problems (title, description, difficulty, coding_mode, starter_templates, harness_templates, access_scope, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id;
      `, ['Two Sum', twoSumDesc, 'easy', 'function', JSON.stringify(twoSumStarter), JSON.stringify(twoSumHarness), 'public', adminId]);
      twoSum = tsRes.rows[0];
    } else {
      await query(`
        UPDATE problems 
        SET description = $1, difficulty = 'easy', coding_mode = 'function', starter_templates = $2, harness_templates = $3, access_scope = 'public'
        WHERE id = $4;
      `, [twoSumDesc, JSON.stringify(twoSumStarter), JSON.stringify(twoSumHarness), twoSum.id]);
    }

    // Seed Two Sum Test Cases (1 sample, 5 hidden)
    await query(`DELETE FROM test_cases WHERE problem_id = $1;`, [twoSum.id]);
    const twoSumCases = [
      { input: '2 7 11 15\n9\n', output: '0 1\n', isSample: true, isHidden: false, order: 1 },
      { input: '3 2 4\n6\n', output: '1 2\n', isSample: false, isHidden: true, order: 2 },
      { input: '3 3\n6\n', output: '0 1\n', isSample: false, isHidden: true, order: 3 },
      { input: '-3 4 3 90\n0\n', output: '0 2\n', isSample: false, isHidden: true, order: 4 },
      { input: '1 5 7 12\n13\n', output: '0 3\n', isSample: false, isHidden: true, order: 5 },
      { input: '-10 -5 0 5 10\n-15\n', output: '0 1\n', isSample: false, isHidden: true, order: 6 },
    ];
    for (const tc of twoSumCases) {
      await query(`
        INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden, test_order)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [twoSum.id, tc.input, tc.output, tc.isSample, tc.isHidden, tc.order]);
    }

    // 4b. Seed Canonical Public Problem: Subarray Sum (MEDIUM - Function Mode)
    const subarraySumStarter = {
      python: `class Solution:\n    def subarraySum(self, nums: list[int], k: int) -> int:\n        # Write your code here\n        from collections import defaultdict\n        prefix_map = defaultdict(int)\n        prefix_map[0] = 1\n        curr_sum = 0\n        count = 0\n        for num in nums:\n            curr_sum += num\n            count += prefix_map[curr_sum - k]\n            prefix_map[curr_sum] += 1\n        return count\n`,
      cpp: `#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nclass Solution {\npublic:\n    int subarraySum(vector<int>& nums, int k) {\n        // Write your code here\n        unordered_map<int, int> prefixFreq;\n        prefixFreq[0] = 1;\n        int currSum = 0;\n        int count = 0;\n        for (int num : nums) {\n            currSum += num;\n            if (prefixFreq.count(currSum - k)) {\n                count += prefixFreq[currSum - k];\n            }\n            prefixFreq[currSum]++;\n        }\n        return count;\n    }\n};\n`,
      java: `import java.util.*;\n\nclass Solution {\n    public int subarraySum(int[] nums, int k) {\n        // Write your code here\n        Map<Integer, Integer> prefixFreq = new HashMap<>();\n        prefixFreq.put(0, 1);\n        int currSum = 0;\n        int count = 0;\n        for (int num : nums) {\n            currSum += num;\n            count += prefixFreq.getOrDefault(currSum - k, 0);\n            prefixFreq.put(currSum, prefixFreq.getOrDefault(currSum, 0) + 1);\n        }\n        return count;\n    }\n}\n`,
      javascript: `/**\n * @param {number[]} nums\n * @param {number} k\n * @return {number}\n */\nfunction subarraySum(nums, k) {\n    // Write your code here\n    const prefixMap = new Map();\n    prefixMap.set(0, 1);\n    let currSum = 0;\n    let count = 0;\n    for (const num of nums) {\n        currSum += num;\n        count += prefixMap.get(currSum - k) || 0;\n        prefixMap.set(currSum, (prefixMap.get(currSum) || 0) + 1);\n    }\n    return count;\n}\n`,
      c: `#include <stdio.h>\n#include <stdlib.h>\n\nint subarraySum(int* nums, int numsSize, int k) {\n    int count = 0;\n    for (int i = 0; i < numsSize; i++) {\n        int sum = 0;\n        for (int j = i; j < numsSize; j++) {\n            sum += nums[j];\n            if (sum == k) count++;\n        }\n    }\n    return count;\n}\n`,
    };

    const subarraySumHarness = {
      python: `import sys\n\n# __STUDENT_CODE__\n\ndef _main():\n    lines = [l.strip() for l in sys.stdin.read().strip().split('\\n') if l.strip()]\n    if len(lines) >= 2:\n        nums = list(map(int, lines[0].split()))\n        k = int(lines[1])\n        sol = Solution()\n        if hasattr(sol, 'subarraySum'):\n            res = sol.subarraySum(nums, k)\n        elif hasattr(sol, 'solve'):\n            res = sol.solve(nums, k)\n        elif 'subarraySum' in globals():\n            res = subarraySum(nums, k)\n        elif 'solve' in globals():\n            res = solve(nums, k)\n        if res is not None:\n            print(res)\n\nif __name__ == '__main__':\n    _main()\n`,
      cpp: `#include <iostream>\n#include <vector>\n#include <sstream>\n#include <string>\nusing namespace std;\n\n// __STUDENT_CODE__\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    string line;\n    if (getline(cin, line)) {\n        stringstream ss(line);\n        vector<int> nums;\n        int val;\n        while (ss >> val) nums.push_back(val);\n        int k;\n        if (cin >> k) {\n            Solution sol;\n            int res = sol.subarraySum(nums, k);\n            cout << res << \"\\n\";\n        }\n    }\n    return 0;\n}\n`,
      java: `import java.util.*;\nimport java.io.*;\n\n// __STUDENT_CODE__\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        if (sc.hasNextLine()) {\n            String line = sc.nextLine().trim();\n            if (line.isEmpty() && sc.hasNextLine()) line = sc.nextLine().trim();\n            String[] parts = line.split(\"\\\\s+\");\n            int[] nums = new int[parts.length];\n            for (int i = 0; i < parts.length; i++) nums[i] = Integer.parseInt(parts[i]);\n            if (sc.hasNextInt()) {\n                int k = sc.nextInt();\n                Solution sol = new Solution();\n                int res = sol.subarraySum(nums, k);\n                System.out.println(res);\n            }\n        }\n    }\n}\n`,
      javascript: `const readline = require('readline');\n\n// __STUDENT_CODE__\n\nconst rl = readline.createInterface({\n    input: process.stdin,\n    output: process.stdout\n});\n\nconst lines = [];\nrl.on('line', (l) => lines.push(l));\nrl.on('close', () => {\n    const filtered = lines.filter(l => l.trim());\n    if (filtered.length >= 2) {\n        const nums = filtered[0].trim().split(/\\s+/).map(Number);\n        const k = Number(filtered[1].trim());\n        let res;\n        if (typeof subarraySum === 'function') {\n            res = subarraySum(nums, k);\n        } else if (typeof Solution === 'function') {\n            const sol = new Solution();\n            res = sol.subarraySum ? sol.subarraySum(nums, k) : sol.solve(nums, k);\n        }\n        if (res !== undefined && res !== null) {\n            console.log(res);\n        }\n    }\n});\n`,
    };

    const subarraySumDesc = `Given an array of integers nums and an integer k, find the total number of continuous subarrays whose sum equals k.

### Example 1:
**Input:**
nums = [1,1,1]
k = 2

**Output:**
2

**Explanation:**
The two valid subarrays are:
- [1,1] at indices [0,1]
- [1,1] at indices [1,2]

### Constraints:
- 1 <= nums.length <= 2 * 10^4
- -1000 <= nums[i] <= 1000
- -10^7 <= k <= 10^7`;

    let subarraySum = (await query(`SELECT id FROM problems WHERE title = 'Subarray Sum' AND access_scope = 'public' LIMIT 1;`)).rows[0];
    if (!subarraySum) {
      const ssRes = await query(`
        INSERT INTO problems (title, description, difficulty, coding_mode, starter_templates, harness_templates, access_scope, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id;
      `, ['Subarray Sum', subarraySumDesc, 'medium', 'function', JSON.stringify(subarraySumStarter), JSON.stringify(subarraySumHarness), 'public', adminId]);
      subarraySum = ssRes.rows[0];
    } else {
      await query(`
        UPDATE problems 
        SET description = $1, difficulty = 'medium', coding_mode = 'function', starter_templates = $2, harness_templates = $3, access_scope = 'public'
        WHERE id = $4;
      `, [subarraySumDesc, JSON.stringify(subarraySumStarter), JSON.stringify(subarraySumHarness), subarraySum.id]);
    }

    // Seed Subarray Sum Test Cases (1 sample, 7 hidden)
    await query(`DELETE FROM test_cases WHERE problem_id = $1;`, [subarraySum.id]);
    const subarraySumCases = [
      { input: '1 1 1\n2\n', output: '2\n', isSample: true, isHidden: false, order: 1 },
      { input: '1 2 3\n3\n', output: '2\n', isSample: false, isHidden: true, order: 2 },
      { input: '1 -1 0\n0\n', output: '3\n', isSample: false, isHidden: true, order: 3 },
      { input: '3 4 7 2 -3 1 4 2\n7\n', output: '4\n', isSample: false, isHidden: true, order: 4 },
      { input: '-1 -1 1\n0\n', output: '1\n', isSample: false, isHidden: true, order: 5 },
      { input: '0 0 0 0 0\n0\n', output: '15\n', isSample: false, isHidden: true, order: 6 },
      { input: '5\n5\n', output: '1\n', isSample: false, isHidden: true, order: 7 },
      { input: '1 2 1 2 1\n3\n', output: '4\n', isSample: false, isHidden: true, order: 8 },
    ];
    for (const tc of subarraySumCases) {
      await query(`
        INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample, is_hidden, test_order)
        VALUES ($1, $2, $3, $4, $5, $6);
      `, [subarraySum.id, tc.input, tc.output, tc.isSample, tc.isHidden, tc.order]);
    }

    console.log('[DATABASE] Schema initialized successfully (Two Sum & Subarray Sum canonical dataset ready).');
    return true;
  } catch (error) {
    console.error('[DATABASE INIT ERROR] Failed to initialize schema:', error.message);
    throw error;
  }
};

// Allow standalone execution: node src/config/initDb.js
if (require.main === module) {
  initDb()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { initDb };
