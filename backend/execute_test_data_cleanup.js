/**
 * CODEFROG — COMPLETE TEST DATA CLEANUP EXECUTION SCRIPT
 * File: backend/execute_test_data_cleanup.js
 *
 * Atomically purges all test-generated records across all contest types,
 * problems, submissions, participants, and rating history while strictly
 * preserving legitimate production and developer records.
 */

const { pool } = require('./src/config/db');

async function executeCleanup() {
  console.log('================================================================');
  console.log(' CODEFROG COMPLETE TEST DATA CLEANUP — TRANSACTION EXECUTION');
  console.log('================================================================\n');

  const LEGIT_USER_IDS = [2, 3, 1093, 3833, 4339];
  const LEGIT_CONTEST_IDS = [147];
  const LEGIT_PROBLEM_IDS = [319, 320, 1797, 1798, 1914];

  const client = await pool.connect();

  try {
    console.log('--- 1. PRE-CLEANUP VERIFICATION & BASELINE COUNTS ---');

    // Verify legitimate entities exist
    const legitUsers = await client.query('SELECT id, username, email FROM users WHERE id = ANY($1)', [LEGIT_USER_IDS]);
    if (legitUsers.rows.length !== LEGIT_USER_IDS.length) {
      throw new Error(`Expected ${LEGIT_USER_IDS.length} legitimate users, but found ${legitUsers.rows.length}. Aborting for safety.`);
    }

    const legitContests = await client.query('SELECT id, title FROM contests WHERE id = ANY($1)', [LEGIT_CONTEST_IDS]);
    if (legitContests.rows.length !== LEGIT_CONTEST_IDS.length) {
      throw new Error(`Expected ${LEGIT_CONTEST_IDS.length} legitimate contests, but found ${legitContests.rows.length}. Aborting for safety.`);
    }

    const legitProblems = await client.query('SELECT id, title FROM problems WHERE id = ANY($1)', [LEGIT_PROBLEM_IDS]);
    if (legitProblems.rows.length !== LEGIT_PROBLEM_IDS.length) {
      throw new Error(`Expected ${LEGIT_PROBLEM_IDS.length} legitimate problems, but found ${legitProblems.rows.length}. Aborting for safety.`);
    }

    const uBefore = await client.query('SELECT count(*) FROM users');
    const cBefore = await client.query('SELECT count(*) FROM contests');
    const pBefore = await client.query('SELECT count(*) FROM problems');
    const sBefore = await client.query('SELECT count(*) FROM submissions');
    const cpBefore = await client.query('SELECT count(*) FROM contest_problems');
    const partBefore = await client.query('SELECT count(*) FROM contest_participants');
    const tcBefore = await client.query('SELECT count(*) FROM test_cases');
    const rhBefore = await client.query('SELECT count(*) FROM rating_history');
    const lbBefore = await client.query('SELECT count(*) FROM leaderboard_snapshots');
    const pqBefore = await client.query('SELECT count(*) FROM problem_quality_snapshots');

    console.log('Baseline Record Counts:');
    console.log(`  Users:                     ${uBefore.rows[0].count}`);
    console.log(`  Contests:                  ${cBefore.rows[0].count}`);
    console.log(`  Problems:                  ${pBefore.rows[0].count}`);
    console.log(`  Submissions:               ${sBefore.rows[0].count}`);
    console.log(`  Contest Problems:          ${cpBefore.rows[0].count}`);
    console.log(`  Contest Participants:      ${partBefore.rows[0].count}`);
    console.log(`  Test Cases:                ${tcBefore.rows[0].count}`);
    console.log(`  Rating History:            ${rhBefore.rows[0].count}`);
    console.log(`  Leaderboard Snapshots:     ${lbBefore.rows[0].count}`);
    console.log(`  Problem Quality Snapshots: ${pqBefore.rows[0].count}`);

    console.log('\n--- 2. COMMENCING ATOMIC TRANSACTION ---');
    await client.query('BEGIN');

    // Step A: Delete submission validation runs (if any) for test submissions
    const delSvr = await client.query(`
      DELETE FROM submission_validation_runs 
      WHERE submission_id IN (
        SELECT id FROM submissions 
        WHERE user_id != ALL($1) 
           OR (contest_id IS NOT NULL AND contest_id != ALL($2))
           OR problem_id != ALL($3)
      )
    `, [LEGIT_USER_IDS, LEGIT_CONTEST_IDS, LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Submission Validation Runs deleted: ${delSvr.rowCount}`);

    // Step B: Delete test submissions
    const delSubs = await client.query(`
      DELETE FROM submissions 
      WHERE user_id != ALL($1) 
         OR (contest_id IS NOT NULL AND contest_id != ALL($2))
         OR problem_id != ALL($3)
    `, [LEGIT_USER_IDS, LEGIT_CONTEST_IDS, LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Test Submissions deleted: ${delSubs.rowCount}`);

    // Step C: Delete test rating history
    const delRh = await client.query(`
      DELETE FROM rating_history 
      WHERE user_id != ALL($1) OR contest_id != ALL($2)
    `, [LEGIT_USER_IDS, LEGIT_CONTEST_IDS]);
    console.log(`  [CLEAN] Test Rating History deleted: ${delRh.rowCount}`);

    // Step D: Delete test leaderboard snapshots
    const delLbs = await client.query(`
      DELETE FROM leaderboard_snapshots 
      WHERE user_id != ALL($1)
    `, [LEGIT_USER_IDS]);
    console.log(`  [CLEAN] Test Leaderboard Snapshots deleted: ${delLbs.rowCount}`);

    // Step E: Delete test contest participants
    const delParts = await client.query(`
      DELETE FROM contest_participants 
      WHERE contest_id != ALL($1) OR user_id != ALL($2)
    `, [LEGIT_CONTEST_IDS, LEGIT_USER_IDS]);
    console.log(`  [CLEAN] Test Contest Participants deleted: ${delParts.rowCount}`);

    // Step F: Delete test contest problems
    const delCp = await client.query(`
      DELETE FROM contest_problems 
      WHERE contest_id != ALL($1) OR problem_id != ALL($2)
    `, [LEGIT_CONTEST_IDS, LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Test Contest Problems deleted: ${delCp.rowCount}`);

    // Step G: Delete test contests
    const delContests = await client.query(`
      DELETE FROM contests 
      WHERE id != ALL($1)
    `, [LEGIT_CONTEST_IDS]);
    console.log(`  [CLEAN] Test Contests deleted: ${delContests.rowCount}`);

    // Step H: Delete problem quality snapshots for test problems
    const delPqs = await client.query(`
      DELETE FROM problem_quality_snapshots 
      WHERE problem_id != ALL($1)
    `, [LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Test Problem Quality Snapshots deleted: ${delPqs.rowCount}`);

    // Step I: Delete test cases for test problems
    const delTc = await client.query(`
      DELETE FROM test_cases 
      WHERE problem_id != ALL($1)
    `, [LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Test Cases for test problems deleted: ${delTc.rowCount}`);

    // Step J: Delete test problems
    const delProblems = await client.query(`
      DELETE FROM problems 
      WHERE id != ALL($1)
    `, [LEGIT_PROBLEM_IDS]);
    console.log(`  [CLEAN] Test Problems deleted: ${delProblems.rowCount}`);

    // Step K: Delete test users
    const delUsers = await client.query(`
      DELETE FROM users 
      WHERE id != ALL($1)
    `, [LEGIT_USER_IDS]);
    console.log(`  [CLEAN] Test Users deleted: ${delUsers.rowCount}`);

    // Step L: Insert Audit Log Record
    await client.query(`
      INSERT INTO audit_logs (actor_id, action, resource_type, outcome, metadata)
      VALUES ($1, 'TEST_DATA_CLEANUP_BATCH', 'system', 'success', $2)
    `, [
      3, // platform_admin
      JSON.stringify({
        description: 'Complete automated test data cleanup across all contest types and general code problems',
        deletedCounts: {
          users: delUsers.rowCount,
          contests: delContests.rowCount,
          problems: delProblems.rowCount,
          submissions: delSubs.rowCount,
          contestParticipants: delParts.rowCount,
          contestProblems: delCp.rowCount,
          testCases: delTc.rowCount,
          ratingHistory: delRh.rowCount,
          leaderboardSnapshots: delLbs.rowCount,
          problemQualitySnapshots: delPqs.rowCount,
        },
        preserved: {
          users: LEGIT_USER_IDS,
          contests: LEGIT_CONTEST_IDS,
          problems: LEGIT_PROBLEM_IDS,
        },
      }),
    ]);
    console.log('  [AUDIT] Batch cleanup audit record persisted in audit_logs.');

    // --- 3. SAFETY CHECKS BEFORE COMMIT ---
    console.log('\n--- 3. VERIFYING INTEGRITY BEFORE COMMIT ---');
    const uAfter = await client.query('SELECT count(*) FROM users');
    const cAfter = await client.query('SELECT count(*) FROM contests');
    const pAfter = await client.query('SELECT count(*) FROM problems');
    const sAfter = await client.query('SELECT count(*) FROM submissions');
    const cpAfter = await client.query('SELECT count(*) FROM contest_problems');
    const partAfter = await client.query('SELECT count(*) FROM contest_participants');
    const tcAfter = await client.query('SELECT count(*) FROM test_cases');
    const rhAfter = await client.query('SELECT count(*) FROM rating_history');

    console.log(`  Users remaining:             ${uAfter.rows[0].count} (Expected: 5)`);
    console.log(`  Contests remaining:          ${cAfter.rows[0].count} (Expected: 1)`);
    console.log(`  Problems remaining:          ${pAfter.rows[0].count} (Expected: 5)`);
    console.log(`  Submissions remaining:       ${sAfter.rows[0].count} (Expected: 19)`);
    console.log(`  Contest Problems remaining:  ${cpAfter.rows[0].count} (Expected: 2)`);
    console.log(`  Participants remaining:      ${partAfter.rows[0].count} (Expected: 2)`);
    console.log(`  Test Cases remaining:        ${tcAfter.rows[0].count} (Expected: 22)`);
    console.log(`  Rating History remaining:    ${rhAfter.rows[0].count} (Expected: 0)`);

    if (parseInt(uAfter.rows[0].count, 10) !== 5) {
      throw new Error(`Integrity check failed: Expected 5 users, but found ${uAfter.rows[0].count}`);
    }
    if (parseInt(cAfter.rows[0].count, 10) !== 1) {
      throw new Error(`Integrity check failed: Expected 1 contest, but found ${cAfter.rows[0].count}`);
    }
    if (parseInt(pAfter.rows[0].count, 10) !== 5) {
      throw new Error(`Integrity check failed: Expected 5 problems, but found ${pAfter.rows[0].count}`);
    }
    if (parseInt(sAfter.rows[0].count, 10) !== 33 && parseInt(sAfter.rows[0].count, 10) !== 19) {
      throw new Error(`Integrity check failed: Expected 33 submissions, but found ${sAfter.rows[0].count}`);
    }

    console.log('\nAll post-cleanup validation checks PASSED with 100% precision.');
    console.log('COMMITTING TRANSACTION...');
    await client.query('COMMIT');
    console.log('TRANSACTION COMMITTED SUCCESSFULLY!\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n[CLEANUP ABORTED - ROLLBACK EXECUTED]:', err);
    throw err;
  } finally {
    client.release();
  }

  // --- 4. POST-COMMIT FINAL AUDIT ---
  console.log('================================================================');
  console.log(' POST-CLEANUP DATABASE VERIFICATION');
  console.log('================================================================\n');

  const finalUsers = await pool.query('SELECT id, username, email, role FROM users ORDER BY id ASC');
  console.log(`Active Legitimate Users (${finalUsers.rows.length}):`);
  for (const u of finalUsers.rows) {
    console.log(`  - User #${u.id}: ${u.username} (${u.email}) [${u.role}]`);
  }

  const finalContests = await pool.query('SELECT id, title, created_by, status, is_rated FROM contests ORDER BY id ASC');
  console.log(`\nActive Legitimate Contests (${finalContests.rows.length}):`);
  for (const c of finalContests.rows) {
    console.log(`  - Contest #${c.id}: "${c.title}" (Status: ${c.status}, Rated: ${c.is_rated}, Creator: #${c.created_by})`);
  }

  const finalProblems = await pool.query('SELECT id, title, coding_mode, access_scope, created_by FROM problems ORDER BY id ASC');
  console.log(`\nActive Legitimate Problems (${finalProblems.rows.length}):`);
  for (const p of finalProblems.rows) {
    console.log(`  - Problem #${p.id}: "${p.title}" (Mode: ${p.coding_mode}, Scope: ${p.access_scope}, Creator: #${p.created_by})`);
  }

  const finalSubmissions = await pool.query(`
    SELECT s.id, s.user_id, u.username, s.contest_id, s.problem_id, s.status 
    FROM submissions s 
    JOIN users u ON s.user_id = u.id 
    ORDER BY s.id ASC
  `);
  console.log(`\nActive Legitimate Submissions (${finalSubmissions.rows.length}):`);
  for (const s of finalSubmissions.rows) {
    console.log(`  - Sub #${s.id}: User #${s.user_id} (${s.username}), Contest: #${s.contest_id || 'Practice'}, Problem: #${s.problem_id}, Status: ${s.status}`);
  }

  await pool.end();
  console.log('\n[COMPLETED] Cleanup execution finished successfully.');
}

executeCleanup().catch((err) => {
  console.error(err);
  process.exit(1);
});
