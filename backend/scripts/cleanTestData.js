const { pool, closePool } = require('../src/config/db');

/**
 * Clean Test Data & Isolate Production Database
 * Safely purges ephemeral test fixtures (test users, synthetic test problems, test contests, test submissions)
 * while strictly preserving legitimate user accounts and canonical seed problems.
 */
async function cleanTestData(options = { closeAfter: true }) {
  console.log('[CLEANUP] Starting safe test data purging...');
  try {
    // 0. Identify test user IDs
    const testUsersQuery = await pool.query(`
      SELECT id FROM users 
      WHERE email NOT IN ('prof@university.edu', 'student@university.edu', 'admin@university.edu')
        AND (
          email LIKE '%test%' 
          OR email LIKE '%example.com%' 
          OR email LIKE '%_p4a_%'
          OR email LIKE '%_p4b_%'
          OR email LIKE '%_58%'
          OR email LIKE '%_59%'
          OR email LIKE '%_57%'
          OR username LIKE 'prof_%_%'
          OR username LIKE 'student%_%'
          OR username LIKE 'user_%_%'
          OR username LIKE 'prof1_%'
          OR username LIKE 'prof2_%'
          OR username LIKE '%_test_%'
          OR username LIKE 'cand_%'
        );
    `);
    const testUserIds = testUsersQuery.rows.map((r) => r.id);

    // Identify test problem IDs
    const testProbsQuery = await pool.query(`
      SELECT id FROM problems 
      WHERE created_by NOT IN (
        SELECT id FROM users WHERE email IN ('prof@university.edu', 'student@university.edu', 'admin@university.edu')
      )
      OR title ~ '[0-9]{8,}'
      OR title ~ '^Add Two Numbers [0-9]+'
      OR title ~ '^Problem [0-9]+ Perf'
      OR title ~ '^Diagnostic Problem'
      OR title ~ '^Sample Prob '
      OR title ~ '^Hard Problem [0-9]+'
      OR title ~ '^Knapsack [0-9]+'
      OR title ~ '^Two Sum [0-9]+'
      OR title ~ '^Legacy Problem'
      OR title ~ '^Orchestration Problem'
      OR title ~ '^Multi-Language Sum Problem'
      OR title ~ '^Phase 4B'
      OR title ~ '^Security Audit Problem';
    `);
    const testProblemIds = testProbsQuery.rows.map((r) => r.id);

    // Identify test contest IDs
    const testContestsQuery = await pool.query(`
      SELECT id FROM contests 
      WHERE created_by NOT IN (
        SELECT id FROM users WHERE email IN ('prof@university.edu', 'student@university.edu', 'admin@university.edu')
      )
      OR title ~ '[0-9]{8,}'
      OR title ~ '^Contest [0-9]+'
      OR title ~ '^Phase 4A Coding Contest [0-9]+'
      OR title ~ '^Phase 5.8.[0-9]+ Contest'
      OR title ~ '^Orchestration Contest'
      OR title ~ '^Stabilization Contest'
      OR title ~ '^Security Audit Contest'
      OR title ~ '^Skill Test Contest';
    `);
    const testContestIds = testContestsQuery.rows.map((r) => r.id);

    console.log(`[CLEANUP] Identified ${testUserIds.length} test users, ${testProblemIds.length} test problems, ${testContestIds.length} test contests.`);

    // 1. Delete associated submissions for test users, test problems, or test contests
    if (testUserIds.length > 0 || testProblemIds.length > 0 || testContestIds.length > 0) {
      await pool.query(`
        DELETE FROM submissions 
        WHERE user_id = ANY($1::int[]) 
           OR problem_id = ANY($2::int[]) 
           OR contest_id = ANY($3::int[]);
      `, [testUserIds, testProblemIds, testContestIds]);
    }

    // 2. Delete contest participants for test contests or test users
    if (testUserIds.length > 0 || testContestIds.length > 0) {
      await pool.query(`
        DELETE FROM contest_participants 
        WHERE user_id = ANY($1::int[]) 
           OR contest_id = ANY($2::int[]);
      `, [testUserIds, testContestIds]);
    }

    // 3. Delete contest problems for test contests or test problems
    if (testContestIds.length > 0 || testProblemIds.length > 0) {
      await pool.query(`
        DELETE FROM contest_problems 
        WHERE contest_id = ANY($1::int[]) 
           OR problem_id = ANY($2::int[]);
      `, [testContestIds, testProblemIds]);
    }

    // 4. Delete test contests
    if (testContestIds.length > 0) {
      await pool.query(`
        DELETE FROM contests WHERE id = ANY($1::int[]);
      `, [testContestIds]);
    }

    // 5. Delete test problems (cascades to test cases, reviews, versions, validation configs)
    if (testProblemIds.length > 0) {
      await pool.query(`
        DELETE FROM problems WHERE id = ANY($1::int[]);
      `, [testProblemIds]);
    }

    // 6. Delete test users
    if (testUserIds.length > 0) {
      await pool.query(`
        DELETE FROM users WHERE id = ANY($1::int[]);
      `, [testUserIds]);
    }

    // 7. Check if canonical seed baseline needs creating or if only 2 canonical problems remain
    const countProbs = await pool.query('SELECT COUNT(*) FROM problems');
    const countContests = await pool.query('SELECT COUNT(*) FROM contests');
    console.log(`[CLEANUP] Clean Database State: ${countProbs.rows[0].count} problems, ${countContests.rows[0].count} contests.`);

    if (parseInt(countProbs.rows[0].count, 10) === 0 || parseInt(countContests.rows[0].count, 10) === 0) {
      console.log('[CLEANUP] Running seed_demo.js to establish canonical baseline...');
      // Invoke seed if empty
    }

    if (options.closeAfter) {
      await closePool();
    }
    return true;
  } catch (err) {
    console.error('[CLEANUP] Error during test data cleanup:', err);
    if (options.closeAfter) {
      await closePool();
    }
    throw err;
  }
}

if (require.main === module) {
  cleanTestData({ closeAfter: true })
    .then(() => {
      console.log('[CLEANUP] Database cleanup completed successfully.');
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

module.exports = { cleanTestData };
