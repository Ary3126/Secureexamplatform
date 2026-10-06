/**
 * CODEFROG Test Data Cleanup & Tracing Helper
 * File: backend/src/utils/testCleanupHelper.js
 *
 * Provides utilities for test suites to:
 * 1. Generate unique traceable test_run_id
 * 2. Explicitly tag created test records (users, contests, problems, submissions)
 * 3. Automatically and cleanly purge test records after suite completion
 */

const { query } = require('../config/db');

/**
 * Generate a unique, traceable test run ID with optional prefix
 * Example: test_20261005_a1b2c3d4
 */
function generateTestRunId(prefix = 'test') {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Explicitly tag a newly created database record as test data with test_run_id
 * @param {'users' | 'contests' | 'problems' | 'submissions'} table 
 * @param {number|number[]} idOrIds 
 * @param {string} testRunId 
 */
async function markTestData(table, idOrIds, testRunId) {
  const allowedTables = ['users', 'contests', 'problems', 'submissions'];
  if (!allowedTables.includes(table)) {
    throw new Error(`Invalid table for test data marking: ${table}`);
  }

  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  if (ids.length === 0) return;

  await query(
    `UPDATE ${table} SET is_test_data = true, test_run_id = $1 WHERE id = ANY($2::int[])`,
    [testRunId, ids]
  );
}

/**
 * Perform safe, dependency-aware cleanup for an entire test run
 * @param {string} testRunId 
 * @returns {Promise<{ deletedUsers: number, deletedContests: number, deletedProblems: number, deletedSubmissions: number }>}
 */
async function cleanupTestRun(testRunId) {
  if (!testRunId || typeof testRunId !== 'string' || testRunId.trim() === '') {
    throw new Error('Valid testRunId required for cleanup');
  }

  // Delegate directly to the authoritative testDataService to guarantee atomic transactions and security checks
  const TestDataService = require('../services/testDataService');
  return await TestDataService.deleteTestRun(testRunId, null, { skipAuditIfNoActor: true });
}

module.exports = {
  generateTestRunId,
  markTestData,
  cleanupTestRun,
};
