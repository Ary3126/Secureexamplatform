/**
 * CODEFROG Test Data Controller
 * File: backend/src/controllers/testDataController.js
 *
 * Handles HTTP requests for the Admin Test Data Archive,
 * previewing dependencies, and executing safe permanent deletions.
 */

const TestDataService = require('../services/testDataService');

class TestDataController {
  /**
   * GET /api/admin/test-data/summary
   */
  static async getSummary(req, res) {
    try {
      const summary = await TestDataService.getTestDataSummary();
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        data: summary,
      });
    } catch (err) {
      console.error('[TEST DATA SUMMARY ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to retrieve test data summary',
      });
    }
  }

  /**
   * GET /api/admin/test-data/runs
   */
  static async getRuns(req, res) {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;
      const result = await TestDataService.getTestRuns({ page, limit, search });
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        data: result,
      });
    } catch (err) {
      console.error('[TEST DATA RUNS ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to retrieve test runs',
      });
    }
  }

  /**
   * GET /api/admin/test-data
   * Query params: type ('users' | 'contests' | 'problems'), page, limit, search, runId
   */
  static async getRecords(req, res) {
    try {
      const { type = 'users', page = 1, limit = 20, search = '', runId = '' } = req.query;
      if (!['users', 'contests', 'problems'].includes(type)) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Invalid type parameter. Must be "users", "contests", or "problems".',
        });
      }

      const result = await TestDataService.getTestRecords(type, { page, limit, search, runId });
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        data: result,
      });
    } catch (err) {
      console.error('[TEST DATA RECORDS ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to retrieve test data records',
      });
    }
  }

  /**
   * GET /api/admin/test-data/preview?type=:type&id=:id
   */
  static async getPreview(req, res) {
    try {
      const { type, id } = req.query;
      if (!type || !id) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Both "type" and "id" query parameters are required for preview.',
        });
      }

      const result = await TestDataService.getPreview(type, id);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        data: result,
      });
    } catch (err) {
      console.error('[TEST DATA PREVIEW ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to generate deletion preview',
      });
    }
  }

  /**
   * GET /api/admin/test-data/runs/:runId/preview
   */
  static async getRunPreview(req, res) {
    try {
      const { runId } = req.params;
      const result = await TestDataService.getTestRunPreview(runId);
      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        data: result,
      });
    } catch (err) {
      console.error('[TEST DATA RUN PREVIEW ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to generate test run preview',
      });
    }
  }

  /**
   * DELETE /api/admin/test-data/users/:id
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const actorId = req.user?.id;
      const result = await TestDataService.deleteTestUser(id, actorId);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: result.message,
        data: { deletedRecords: result.deletedRecords },
      });
    } catch (err) {
      console.error('[DELETE TEST USER CONTROLLER ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to delete test user',
      });
    }
  }

  /**
   * DELETE /api/admin/test-data/contests/:id
   */
  static async deleteContest(req, res) {
    try {
      const { id } = req.params;
      const actorId = req.user?.id;
      const result = await TestDataService.deleteTestContest(id, actorId);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: result.message,
        data: { deletedRecords: result.deletedRecords },
      });
    } catch (err) {
      console.error('[DELETE TEST CONTEST CONTROLLER ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to delete test contest',
      });
    }
  }

  /**
   * DELETE /api/admin/test-data/problems/:id
   */
  static async deleteProblem(req, res) {
    try {
      const { id } = req.params;
      const actorId = req.user?.id;
      const result = await TestDataService.deleteTestProblem(id, actorId);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: result.message,
        data: { deletedRecords: result.deletedRecords },
      });
    } catch (err) {
      console.error('[DELETE TEST PROBLEM CONTROLLER ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to delete test problem',
      });
    }
  }

  /**
   * DELETE /api/admin/test-data/runs/:runId
   */
  static async deleteRun(req, res) {
    try {
      const { runId } = req.params;
      const actorId = req.user?.id;
      const result = await TestDataService.deleteTestRun(runId, actorId);

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          status: 'error',
          statusCode: result.statusCode || 400,
          message: result.message,
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: result.message,
        data: result.deletedCounts,
      });
    } catch (err) {
      console.error('[DELETE TEST RUN CONTROLLER ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to delete test run',
      });
    }
  }

  /**
   * POST /api/admin/test-data/tag-legacy
   */
  static async tagLegacy(req, res) {
    try {
      const result = await TestDataService.tagLegacyTestData();
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: 'Legacy test fixture tagging complete',
        data: result,
      });
    } catch (err) {
      console.error('[TAG LEGACY TEST DATA ERROR]:', err);
      return res.status(500).json({
        status: 'error',
        statusCode: 500,
        message: 'Failed to tag legacy test data',
      });
    }
  }
}

module.exports = TestDataController;
