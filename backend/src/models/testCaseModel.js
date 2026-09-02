const db = require('../config/db');
const AuditLogger = require('../services/auditLogger');

/**
 * TestCase Model - Database access for problem test cases
 */
class TestCaseModel {
  /**
   * Create a test case
   * @param {Object} param0 - { problemId, inputData, expectedOutput, isHidden, timeLimitMs, memoryLimitMb, testOrder }
   * @param {Object|null} client - Optional transaction client
   * @returns {Promise<Object>}
   */
  static async createTestCase({
    problemId,
    inputData = '',
    expectedOutput = '',
    isHidden = true,
    timeLimitMs = 2000,
    memoryLimitMb = 256,
    testOrder = 1,
  }, client = null) {
    const text = `
      INSERT INTO test_cases (
        problem_id, input_data, expected_output, is_hidden, time_limit_ms, memory_limit_mb, test_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id, 
        problem_id AS "problemId", 
        input_data AS "inputData", 
        expected_output AS "expectedOutput", 
        is_hidden AS "isHidden", 
        time_limit_ms AS "timeLimitMs", 
        memory_limit_mb AS "memoryLimitMb", 
        test_order AS "testOrder", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [problemId, inputData, expectedOutput, isHidden, timeLimitMs, memoryLimitMb, testOrder];
    const res = await (client || db).query(text, values);
    return res.rows[0];
  }

  /**
   * Create a test case inside an atomic transaction with audit logging
   */
  static async createTestCaseWithSafety(params, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const testCase = await TestCaseModel.createTestCase(params, client);

      if (actor) {
        await AuditLogger.logAction({
          actor,
          action: 'TEST_CASE_CREATED',
          resourceType: 'test_case',
          resourceId: testCase.id,
          outcome: 'success',
          metadata: { problemId: testCase.problemId, isHidden: testCase.isHidden },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return testCase;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Find test case by ID
   * @param {number|string} id
   * @param {Object|null} client
   * @returns {Promise<Object|null>}
   */
  static async findTestCaseById(id, client = null) {
    const text = `
      SELECT 
        tc.id, 
        tc.problem_id AS "problemId", 
        tc.input_data AS "inputData", 
        tc.expected_output AS "expectedOutput", 
        tc.is_hidden AS "isHidden", 
        tc.time_limit_ms AS "timeLimitMs", 
        tc.memory_limit_mb AS "memoryLimitMb", 
        tc.test_order AS "testOrder", 
        p.created_by AS "problemCreatorId",
        tc.created_at AS "createdAt", 
        tc.updated_at AS "updatedAt"
      FROM test_cases tc
      JOIN problems p ON tc.problem_id = p.id
      WHERE tc.id = $1;
    `;
    const res = await (client || db).query(text, [id]);
    return res.rows[0] || null;
  }

  /**
   * Find all test cases for a problem
   * @param {number|string} problemId
   * @param {Object} options - { includeHidden: boolean }
   * @param {Object|null} client
   * @returns {Promise<Array<Object>>}
   */
  static async findTestCasesByProblemId(problemId, { includeHidden = false } = {}, client = null) {
    let text = `
      SELECT 
        id, 
        problem_id AS "problemId", 
        input_data AS "inputData", 
        expected_output AS "expectedOutput", 
        is_hidden AS "isHidden", 
        time_limit_ms AS "timeLimitMs", 
        memory_limit_mb AS "memoryLimitMb", 
        test_order AS "testOrder", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
      FROM test_cases
      WHERE problem_id = $1
    `;
    const values = [problemId];

    if (!includeHidden) {
      text += ' AND is_hidden = false';
    }

    text += ' ORDER BY test_order ASC, id ASC;';
    const res = await (client || db).query(text, values);
    return res.rows;
  }

  /**
   * Find visible sample test cases for public problem view
   * @param {number|string} problemId
   * @returns {Promise<Array<Object>>}
   */
  static async findVisibleSampleTestCases(problemId) {
    return await TestCaseModel.findTestCasesByProblemId(problemId, { includeHidden: false });
  }

  /**
   * Alias to find all test cases for problem
   */
  static async findByProblemId(problemId, options = { includeHidden: true }, client = null) {
    return await TestCaseModel.findTestCasesByProblemId(problemId, options, client);
  }

  /**
   * Update a test case
   * @param {number|string} id
   * @param {Object} updateData
   * @param {Object|null} client
   * @returns {Promise<Object|null>}
   */
  static async updateTestCase(id, { inputData, expectedOutput, isHidden, timeLimitMs, memoryLimitMb, testOrder }, client = null) {
    const text = `
      UPDATE test_cases
      SET 
        input_data = COALESCE($1, input_data),
        expected_output = COALESCE($2, expected_output),
        is_hidden = COALESCE($3, is_hidden),
        time_limit_ms = COALESCE($4, time_limit_ms),
        memory_limit_mb = COALESCE($5, memory_limit_mb),
        test_order = COALESCE($6, test_order),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING 
        id, 
        problem_id AS "problemId", 
        input_data AS "inputData", 
        expected_output AS "expectedOutput", 
        is_hidden AS "isHidden", 
        time_limit_ms AS "timeLimitMs", 
        memory_limit_mb AS "memoryLimitMb", 
        test_order AS "testOrder", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt";
    `;
    const values = [inputData, expectedOutput, isHidden, timeLimitMs, memoryLimitMb, testOrder, id];
    const res = await (client || db).query(text, values);
    return res.rows[0] || null;
  }

  /**
   * Update a test case inside an atomic transaction with row locking and audit logging
   */
  static async updateTestCaseWithSafety(id, updateData, actor = null, req = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const lockRes = await client.query('SELECT id, problem_id FROM test_cases WHERE id = $1 FOR UPDATE', [id]);
      if (lockRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const updated = await TestCaseModel.updateTestCase(id, updateData, client);

      if (actor && updated) {
        await AuditLogger.logAction({
          actor,
          action: 'TEST_CASE_UPDATED',
          resourceType: 'test_case',
          resourceId: updated.id,
          outcome: 'success',
          metadata: { problemId: updated.problemId, isHidden: updated.isHidden },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a test case
   * @param {number|string} id
   * @param {Object|null} client
   * @returns {Promise<boolean>}
   */
  static async deleteTestCase(id, client = null) {
    const text = 'DELETE FROM test_cases WHERE id = $1 RETURNING id;';
    const res = await (client || db).query(text, [id]);
    return res.rowCount > 0;
  }

  /**
   * Delete a test case inside an atomic transaction with row locking and audit logging
   */
  static async deleteTestCaseWithSafety(id, actor = null, req = null, problemId = null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const lockRes = await client.query('SELECT id, problem_id FROM test_cases WHERE id = $1 FOR UPDATE', [id]);
      if (lockRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      const resolvedProblemId = problemId || lockRes.rows[0].problem_id;

      const deleted = await TestCaseModel.deleteTestCase(id, client);

      if (actor && deleted) {
        await AuditLogger.logAction({
          actor,
          action: 'TEST_CASE_DELETED',
          resourceType: 'test_case',
          resourceId: id,
          outcome: 'success',
          metadata: { problemId: resolvedProblemId },
          client,
          req,
        });
      }

      await client.query('COMMIT');
      return deleted;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Count total test cases for a problem
   * @param {number|string} problemId
   * @param {Object|null} client
   * @returns {Promise<number>}
   */
  static async countTestCases(problemId, client = null) {
    const text = 'SELECT COUNT(*)::int AS count FROM test_cases WHERE problem_id = $1;';
    const res = await (client || db).query(text, [problemId]);
    return res.rows[0] ? res.rows[0].count : 0;
  }
}

module.exports = TestCaseModel;