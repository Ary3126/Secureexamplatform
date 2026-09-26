const ProblemModel = require('../models/problemModel');
const TestCaseModel = require('../models/testCaseModel');
const SavedProblemModel = require('../models/savedProblemModel');
const AuditLogger = require('../services/auditLogger');
const { canManageResource } = require('../services/contestService');

/**
 * Create a new problem in the bank
 * @route POST /api/problems
 */
const createProblem = async (req, res, next) => {
  try {
    const { title, description, difficulty, codingMode, starterTemplates, harnessTemplates, accessScope, testCases } = req.body;
    const createdBy = req.user.id;

    // Role-based Access Scope Enforcing:
    // Only super_admin or contest_admin can publish problems directly to the public bank.
    // Professor-created problems strictly default to 'contest_private'.
    const isAdmin = req.user && (req.user.role === 'super_admin' || req.user.role === 'contest_admin');
    const effectiveScope = (accessScope && accessScope.toLowerCase() === 'public')
      ? 'public'
      : (isAdmin ? (accessScope || 'public') : 'contest_private');

    const problem = await ProblemModel.createProblemWithSafety({
      title,
      description,
      difficulty,
      codingMode,
      starterTemplates,
      harnessTemplates,
      accessScope: effectiveScope,
      createdBy,
      testCases,
    }, req.user, req);

    return res.status(201).json({
      message: 'Problem created successfully',
      problem,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all problems with search, filters, sorting, and server-side pagination
 * @route GET /api/problems
 */
const getAllProblems = async (req, res, next) => {
  try {
    const {
      search,
      difficulty,
      codingMode,
      status,
      saved,
      accessScope,
      sortBy = 'newest',
      page = 1,
      limit = 20,
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;
    const userId = req.user ? req.user.id : null;
    const userRole = req.user ? req.user.role : null;

    const [problems, totalProblems] = await Promise.all([
      ProblemModel.findAllProblems({
        search,
        difficulty,
        codingMode,
        status,
        saved,
        accessScope,
        sortBy,
        limit: parsedLimit,
        offset,
        userId,
        userRole,
      }),
      ProblemModel.countAllProblems({
        search,
        difficulty,
        codingMode,
        status,
        saved,
        accessScope,
        userId,
        userRole,
      }),
    ]);

    const totalPages = Math.ceil(totalProblems / parsedLimit) || 1;

    return res.status(200).json({
      count: problems.length,
      problems,
      pagination: {
        currentPage: parsedPage,
        totalPages,
        totalProblems,
        limit: parsedLimit,
        hasNext: parsedPage < totalPages,
        hasPrev: parsedPage > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get problem details by ID (includes visible sample test cases)
 * @route GET /api/problems/:id
 */
const getProblemById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user ? req.user.id : null;
    const problem = await ProblemModel.findProblemById(id, userId);

    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    // Check authorization for private contest problems
    const isAuthorized = await ProblemModel.isUserAuthorizedForProblem(problem, req.user);
    if (!isAuthorized) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    // Attach visible sample test cases only (security: never leak hidden test cases)
    const sampleCases = await TestCaseModel.findVisibleSampleTestCases(id);

    return res.status(200).json({
      ...problem,
      sampleTestCases: sampleCases,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bookmark / Save a problem for authenticated user
 * @route POST /api/problems/:id/bookmark
 */
const bookmarkProblem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const problem = await ProblemModel.findProblemById(id);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    await SavedProblemModel.saveProblem(userId, id);

    return res.status(200).json({
      message: 'Problem bookmarked successfully',
      isSaved: true,
      problemId: parseInt(id, 10),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove bookmark for authenticated user
 * @route DELETE /api/problems/:id/bookmark
 */
const unbookmarkProblem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await SavedProblemModel.unsaveProblem(userId, id);

    return res.status(200).json({
      message: 'Problem removed from bookmarks',
      isSaved: false,
      problemId: parseInt(id, 10),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all saved problems for authenticated user
 * @route GET /api/problems/saved
 */
const getSavedProblems = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;

    const [savedProblems, totalSaved] = await Promise.all([
      SavedProblemModel.findSavedProblemsByUser(userId, { limit: parsedLimit, offset }),
      SavedProblemModel.countSavedProblemsByUser(userId),
    ]);

    const totalPages = Math.ceil(totalSaved / parsedLimit) || 1;

    return res.status(200).json({
      count: savedProblems.length,
      problems: savedProblems,
      pagination: {
        currentPage: parsedPage,
        totalPages,
        totalProblems: totalSaved,
        limit: parsedLimit,
        hasNext: parsedPage < totalPages,
        hasPrev: parsedPage > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update problem details (with optimistic concurrency check)
 * @route PUT /api/problems/:id
 */
const updateProblem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, difficulty, codingMode, starterTemplates, harnessTemplates, accessScope, expectedVersion, version } = req.body;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_UPDATED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only update problems you created',
      });
    }

    const expVer = expectedVersion !== undefined ? expectedVersion : (version !== undefined ? version : req.headers['if-match']);
    const isAdmin = req.user && (req.user.role === 'super_admin' || req.user.role === 'contest_admin');
    const effectiveScope = isAdmin && accessScope ? accessScope : undefined;

    const updateResult = await ProblemModel.updateProblemWithSafety(id, {
      title,
      description,
      difficulty,
      codingMode,
      starterTemplates,
      harnessTemplates,
      accessScope: effectiveScope,
    }, req.user, req, expVer);

    if (updateResult && updateResult.conflict) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Conflict: Problem has been modified by another session. Please reload the latest revision.',
        currentVersion: updateResult.currentVersion,
      });
    }

    return res.status(200).json({
      message: 'Problem updated successfully',
      problem: updateResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Publish problem with validation gate & immutable snapshot
 * @route POST /api/problems/:id/publish
 */
const publishProblem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_PUBLISHED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only publish problems you manage',
      });
    }

    const publishResult = await ProblemModel.publishProblemWithSafety(id, req.user, req);

    if (publishResult.validationFailed) {
      return res.status(422).json({
        status: 'error',
        statusCode: 422,
        message: 'Problem publication validation failed',
        errors: publishResult.errors,
      });
    }

    if (publishResult.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    return res.status(200).json({
      message: 'Problem published successfully',
      problem: publishResult.problem,
      version: publishResult.version,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Preview problem as viewed by students (strictly excludes hidden tests / secrets)
 * @route GET /api/problems/:id/preview
 */
const previewProblem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const problem = await ProblemModel.findProblemById(id);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, problem.createdBy)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to preview this problem',
      });
    }

    const sampleTestCases = await TestCaseModel.findVisibleSampleTestCases(id);

    return res.status(200).json({
      id: problem.id,
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      codingMode: problem.codingMode,
      starterTemplates: problem.starterTemplates,
      accessScope: problem.accessScope,
      version: problem.version,
      isPublished: problem.isPublished,
      sampleTestCases,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clone problem into a new independent draft
 * @route POST /api/problems/:id/clone
 */
const cloneProblem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, accessScope } = req.body;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_CLONED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only clone problems you have access to',
      });
    }

    const cloneResult = await ProblemModel.cloneProblemWithSafety(id, { title, accessScope }, req.user, req);

    if (cloneResult.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    return res.status(201).json({
      message: 'Problem cloned successfully',
      problem: cloneResult.problem,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all version history snapshots for a problem
 * @route GET /api/problems/:id/versions
 */
const getProblemVersions = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view revisions for this problem',
      });
    }

    const versions = await ProblemModel.findProblemVersions(id);

    return res.status(200).json({
      count: versions.length,
      versions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get specific version snapshot details
 * @route GET /api/problems/:id/versions/:versionNumber
 */
const getProblemVersionDetail = async (req, res, next) => {
  try {
    const { id, versionNumber } = req.params;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view revisions for this problem',
      });
    }

    const versionRecord = await ProblemModel.findProblemVersionByNumber(id, parseInt(versionNumber, 10));
    if (!versionRecord) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Version ${versionNumber} not found for problem ID ${id}`,
      });
    }

    return res.status(200).json({
      version: versionRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete problem
 * @route DELETE /api/problems/:id
 */
const deleteProblem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingProblem = await ProblemModel.findProblemById(id);
    if (!existingProblem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, existingProblem.createdBy)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'problem',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'PROBLEM_DELETED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You can only delete problems you created',
      });
    }

    // Atomic transactional deletion with row locking
    const deleteResult = await ProblemModel.deleteProblemWithSafety(id, req.user, req);
    if (deleteResult.hasSubmissions) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot delete problem because submissions exist for this problem.',
      });
    }

    if (!deleteResult.success) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${id} not found`,
      });
    }

    return res.status(200).json({
      message: 'Problem deleted successfully',
      problemId: id,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProblem,
  getAllProblems,
  getProblemById,
  bookmarkProblem,
  unbookmarkProblem,
  getSavedProblems,
  updateProblem,
  deleteProblem,
  publishProblem,
  previewProblem,
  cloneProblem,
  getProblemVersions,
  getProblemVersionDetail,
};