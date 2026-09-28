const ContestModel = require('../models/contestModel');
const ProblemModel = require('../models/problemModel');
const RatingService = require('../services/ratingService');
const AuditLogger = require('../services/auditLogger');
const {
  canManageResource,
  formatContest,
  getContestRuntimeState,
  isLifecycleMutationLocked,
  getLifecycleLockMessage,
  getProblemMutationLockMessage,
} = require('../services/contestService');

/**
 * Create a new contest (starts in 'draft' status)
 * @route POST /api/contests
 */
const createContest = async (req, res, next) => {
  try {
    const {
      title,
      description,
      startTime,
      endTime,
      isRated = true,
      leaderboardFreezeEnabled = false,
      leaderboardFreezeMinutes = 60,
    } = req.body;
    const createdBy = req.user.id;

    // Check for accidental duplicate submission within 3 seconds by the same user with the same title
    const recentDuplicate = await ContestModel.findRecentDuplicate({
      title,
      createdBy,
      withinSeconds: 3,
    });
    if (recentDuplicate) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'A contest with this title was just created. Please wait a moment before resubmitting.',
        duplicateContestId: recentDuplicate.id,
      });
    }

    const contest = await ContestModel.createContestWithSafety({
      title,
      description,
      startTime,
      endTime,
      createdBy,
      isRated: isRated !== undefined ? Boolean(isRated) : true,
      leaderboardFreezeEnabled: Boolean(leaderboardFreezeEnabled),
      leaderboardFreezeMinutes: parseInt(leaderboardFreezeMinutes, 10) || 60,
    }, req.user, req);

    return res.status(201).json({
      message: 'Contest created successfully in draft mode',
      contest: formatContest(contest),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List contests with search, filters, sorting, and pagination
 * @route GET /api/contests
 */
const getAllContests = async (req, res, next) => {
  try {
    const { status, state, search, sortBy, sortOrder, isRated, createdBy, page, limit, offset } = req.query;

    const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    const parsedPage = page ? Math.max(1, parseInt(page, 10) || 1) : null;
    const effectiveOffset = parsedPage ? (parsedPage - 1) * parsedLimit : Math.max(0, parseInt(offset, 10) || 0);
    const effectivePage = parsedPage || Math.floor(effectiveOffset / parsedLimit) + 1;

    const contests = await ContestModel.findAllContests({
      status,
      state,
      search,
      sortBy,
      sortOrder,
      isRated,
      createdBy,
      user: req.user || null,
      limit: parsedLimit,
      offset: effectiveOffset,
    });

    const formatted = contests.map(formatContest);
    const totalCount = contests.totalCount !== undefined ? contests.totalCount : formatted.length;

    return res.status(200).json({
      count: formatted.length,
      total: totalCount,
      page: effectivePage,
      limit: parsedLimit,
      totalPages: Math.ceil(totalCount / parsedLimit),
      contests: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get contest details by ID including attached problems and points
 * @route GET /api/contests/:id
 */
const getContestById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const contest = await ContestModel.findContestById(id);

    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${id} not found`,
      });
    }

    // If contest is draft, only authorized managers/creator can view it
    if (contest.status === 'draft' && !canManageResource(req.user, contest)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Draft contests are not visible to participants',
      });
    }

    const problems = await ContestModel.getContestProblems(id);
    const formatted = formatContest(contest);

    return res.status(200).json({
      ...formatted,
      problems,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update contest
 * @route PUT /api/contests/:id
 */
const updateContest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const contest = await ContestModel.findContestById(id);

    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_UPDATED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to modify this contest',
      });
    }

    const {
      title,
      description,
      startTime,
      endTime,
      isRated,
      leaderboardFreezeEnabled,
      leaderboardFreezeMinutes,
      status,
    } = req.body;

    // 1. Authoritative server-side runtimeState check
    const runtimeState = getContestRuntimeState(contest);

    if (runtimeState === 'archived') {
      const lockMessage = getLifecycleLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_UPDATE',
          runtimeState,
        },
        req,
      });

      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    const hasLifecycleField = startTime !== undefined || endTime !== undefined || status !== undefined;
    const isArchiveTransition = status === 'archived' && startTime === undefined && endTime === undefined && (runtimeState === 'ended' || runtimeState === 'draft');

    if (hasLifecycleField && isLifecycleMutationLocked(runtimeState) && !isArchiveTransition) {
      const lockMessage = getLifecycleLockMessage(runtimeState);
      const attemptedFields = [];
      if (startTime !== undefined) attemptedFields.push('startTime');
      if (endTime !== undefined) attemptedFields.push('endTime');
      if (status !== undefined) attemptedFields.push('status');

      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_LIFECYCLE_UPDATE',
          runtimeState,
          attemptedFields,
        },
        req,
      });

      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    // 2. Perform atomic update with row locking & audit logging
    const updateResult = await ContestModel.updateContestWithSafety(id, {
      title,
      description,
      startTime,
      endTime,
      isRated,
      leaderboardFreezeEnabled,
      leaderboardFreezeMinutes,
      status,
    }, req.user, req);

    if (updateResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_LIFECYCLE_UPDATE',
          runtimeState: updateResult.runtimeState,
        },
        req,
      });

      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: updateResult.message,
      });
    }

    if (!updateResult.success || !updateResult.contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${id} not found`,
      });
    }

    const updatedContest = updateResult.contest;

    return res.status(200).json({
      message: 'Contest updated successfully',
      contest: formatContest(updatedContest),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a contest
 * @route DELETE /api/contests/:id
 */
const deleteContest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const contest = await ContestModel.findContestById(id);

    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${id} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_DELETED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to delete this contest',
      });
    }

    // Atomic transactional deletion with row locking & audit logging
    const deleteResult = await ContestModel.deleteContestWithSafety(id, req.user, req);
    if (deleteResult.hasSubmissions) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot delete contest because submissions exist for this contest.',
      });
    }

    if (!deleteResult.success) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${id} not found`,
      });
    }

    return res.status(200).json({
      message: 'Contest deleted successfully',
      contestId: id,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Publish contest (draft -> published)
 * @route PATCH /api/contests/:id/publish
 */
const publishContest = async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const contestIdNum = Number(rawId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestIdNum);

    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PUBLISHED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to publish this contest',
      });
    }

    if (contest.status !== 'draft') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Cannot publish contest: Contest is already ${contest.status}`,
      });
    }

    const publishResult = await ContestModel.publishContestWithSafety(contestIdNum, req.user, req);
    if (publishResult.invalidStatus) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Cannot publish contest: Contest is already ${publishResult.currentStatus}`,
      });
    }

    if (publishResult.noProblems) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot publish contest: At least one problem must be attached',
      });
    }

    if (!publishResult.success || !publishResult.contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Contest published successfully',
      contest: formatContest(publishResult.contest),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unpublish contest (published upcoming -> draft)
 * @route POST /api/contests/:id/unpublish
 */
const unpublishContest = async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const contestIdNum = Number(rawId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_UNPUBLISHED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to unpublish this contest',
      });
    }

    const result = await ContestModel.unpublishContestWithSafety(contestIdNum, req.user, req);

    if (result.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (result.invalidStatus) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: result.message || `Cannot unpublish contest in current status: ${result.currentStatus}`,
      });
    }

    if (result.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_UNPUBLISHED',
          runtimeState: result.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: result.message,
      });
    }

    if (result.hasSubmissions) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_UNPUBLISHED',
          reason: 'has_submissions',
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: result.message,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Contest unpublished successfully',
      contest: formatContest(result.contest),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Archive contest (ended / draft / upcoming -> archived)
 * @route POST /api/contests/:id/archive
 */
const archiveContest = async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const contestIdNum = Number(rawId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_ARCHIVED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to archive this contest',
      });
    }

    const result = await ContestModel.archiveContestWithSafety(contestIdNum, req.user, req);

    if (result.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (result.alreadyArchived) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: result.message || 'Contest is already archived',
      });
    }

    if (result.running) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_ARCHIVED',
          runtimeState: 'running',
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: result.message || 'Cannot archive an actively running contest.',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Contest archived successfully',
      contest: formatContest(result.contest),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List attached problems for a contest (restricted to authorized managers)
 * @route GET /api/contests/:id/problems
 */
const getContestProblems = async (req, res, next) => {
  try {
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // Role-based authorization & ownership isolation
    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'GET_CONTEST_PROBLEMS' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view problems for this contest',
      });
    }

    const problems = await ContestModel.getContestProblems(contestIdNum);

    // Sanitize problem output: only return metadata appropriate for admin contest problem list
    // Strictly exclude hidden test cases, expected outputs, solutions, and internal secrets
    const sanitizedProblems = problems.map((p) => ({
      problemId: p.problemId,
      title: p.title,
      description: p.description,
      difficulty: p.difficulty,
      codingMode: p.codingMode || p.coding_mode,
      problemOrder: p.problemOrder,
      points: p.points,
      status: 'active',
    }));

    return res.status(200).json({
      status: 'success',
      contestId: contestIdNum,
      count: sanitizedProblems.length,
      problems: sanitizedProblems,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Attach problem to contest
 * @route POST /api/contests/:id/problems
 */
const addProblemToContest = async (req, res, next) => {
  try {
    const rawContestId = req.params.contestId || req.params.id;
    const contestId = Number(rawContestId);
    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { problemId, points, problemOrder } = req.body || {};
    const problemIdNum = Number(problemId);
    if (!Number.isInteger(problemIdNum) || problemIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'A valid positive integer problemId is required.',
      });
    }

    // 1. Resolve contest resource
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // 2. Ownership & RBAC check BEFORE lifecycle check (prevent leaking lifecycle to unauthorized users)
    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestId,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PROBLEM_ADDED', problemId: problemIdNum },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to modify this contest',
      });
    }

    // 3. Authoritative lifecycle check
    const runtimeState = getContestRuntimeState(contest);
    if (isLifecycleMutationLocked(runtimeState)) {
      const lockMessage = getProblemMutationLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestId,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'add',
          problemId: problemIdNum,
          runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    // 4. Validate problem existence
    const problem = await ProblemModel.findProblemById(problemIdNum);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemIdNum} not found`,
      });
    }

    // 4b. Validate problem accessibility (BOLA & private problem protection)
    if (req.user.role === 'professor') {
      const scope = (problem.accessScope || problem.access_scope || 'public').toLowerCase();
      const isOwner = problem.createdBy === req.user.id || problem.created_by === req.user.id;
      const isPub = problem.isPublished !== undefined ? problem.isPublished : problem.is_published;
      if ((scope !== 'public' || isPub === false) && !isOwner) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'problem',
          resourceId: problemIdNum,
          outcome: 'denied',
          metadata: { attemptedAction: 'ATTACH_INACCESSIBLE_PROBLEM', contestId },
          req,
        });
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: 'Forbidden: You do not have permission to attach this problem',
        });
      }
    }

    // 5. Parse and validate points and problemOrder
    let parsedPoints = 100;
    if (points !== undefined) {
      const numPoints = Number(points);
      if (!Number.isInteger(numPoints) || numPoints <= 0 || numPoints > 100000) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Points must be a positive integer (max 100000).',
        });
      }
      parsedPoints = numPoints;
    }

    let parsedOrder = undefined;
    if (problemOrder !== undefined) {
      const numOrder = Number(problemOrder);
      if (!Number.isInteger(numOrder) || numOrder <= 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Problem order must be a positive integer.',
        });
      }
      parsedOrder = numOrder;
    }

    // 6. Atomic insert with row-level locking & audit logging
    const addResult = await ContestModel.addProblemToContestWithSafety({
      contestId,
      problemId: problemIdNum,
      points: parsedPoints,
      problemOrder: parsedOrder,
    }, req.user, req);

    if (addResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestId,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'add',
          problemId: problemIdNum,
          runtimeState: addResult.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: addResult.message,
      });
    }

    if (addResult.duplicate) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'This problem is already attached to this contest',
      });
    }

    if (!addResult.success || !addResult.mapping) {
      if (addResult.notFound && addResult.resource === 'problem') {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Problem with ID ${problemIdNum} not found`,
        });
      }
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    return res.status(201).json({
      status: 'success',
      message: 'Problem added to contest successfully',
      mapping: addResult.mapping,
      problem: {
        problemId: problem.id,
        title: problem.title,
        difficulty: problem.difficulty,
        codingMode: problem.codingMode || problem.coding_mode,
        points: addResult.mapping.points,
        problemOrder: addResult.mapping.problemOrder,
        status: problem.isActive !== false ? 'active' : 'inactive',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Remove problem from contest
 * @route DELETE /api/contests/:contestId/problems/:problemId
 */
const removeProblemFromContest = async (req, res, next) => {
  try {
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { problemId } = req.params;
    const problemIdNum = Number(problemId);
    if (!Number.isInteger(problemIdNum) || problemIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid problem ID format. ID must be a positive integer.',
      });
    }

    // 1. Resolve contest resource
    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // 2. Ownership & RBAC check BEFORE lifecycle check
    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PROBLEM_REMOVED', problemId: problemIdNum },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to remove problems from this contest',
      });
    }

    // 3. Authoritative lifecycle check
    const runtimeState = getContestRuntimeState(contest);
    if (isLifecycleMutationLocked(runtimeState)) {
      const lockMessage = getProblemMutationLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'remove',
          problemId: problemIdNum,
          runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    // 4. Validate problem existence in catalog
    const problem = await ProblemModel.findProblemById(problemIdNum);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemIdNum} not found`,
      });
    }

    // 5. Atomic delete with row-level locking & audit logging
    const removeResult = await ContestModel.removeProblemFromContestWithSafety(contestIdNum, problemIdNum, req.user, req);

    if (removeResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'remove',
          problemId: problemIdNum,
          runtimeState: removeResult.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: removeResult.message,
      });
    }

    if (!removeResult.success) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: 'Problem was not found in this contest',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Problem removed from contest successfully',
      contestId: contestIdNum,
      problemId: problemIdNum,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk add problems to contest
 * @route POST /api/contests/:id/problems/bulk
 * @route PUT /api/contests/:id/problems
 */
const bulkAddProblemsToContest = async (req, res, next) => {
  try {
    if ((req.body?.problemIds || req.body?.orderedProblemIds) && !req.body?.problems) {
      return reorderContestProblems(req, res, next);
    }
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { problems } = req.body || {};

    if (!Array.isArray(problems) || problems.length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'A non-empty array of problems is required.',
      });
    }

    if (problems.length > 100) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Problems array exceeds maximum allowed limit of 100 items.',
      });
    }

    const seenProblemIds = new Set();
    for (let i = 0; i < problems.length; i++) {
      const item = problems[i];
      if (!item || typeof item !== 'object') {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Invalid problem entry at index ${i}. Must be an object.`,
        });
      }
      const numPId = Number(item.problemId || item.id);
      if (!Number.isInteger(numPId) || numPId <= 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Invalid problemId at index ${i}. Must be a positive integer.`,
        });
      }
      if (seenProblemIds.has(numPId)) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Duplicate problemId ${numPId} at index ${i}. Each problem must be unique.`,
        });
      }
      seenProblemIds.add(numPId);

      if (item.points !== undefined) {
        const numPts = Number(item.points);
        if (!Number.isInteger(numPts) || numPts <= 0 || numPts > 100000) {
          return res.status(400).json({
            status: 'error',
            statusCode: 400,
            message: `Invalid points at index ${i}. Points must be a positive integer (max 100000).`,
          });
        }
      }
      if (item.problemOrder !== undefined || item.order !== undefined) {
        const numOrd = Number(item.problemOrder || item.order);
        if (!Number.isInteger(numOrd) || numOrd <= 0) {
          return res.status(400).json({
            status: 'error',
            statusCode: 400,
            message: `Invalid problemOrder at index ${i}. Problem order must be a positive integer.`,
          });
        }
      }
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PROBLEM_BULK_ADD' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to modify this contest',
      });
    }

    const runtimeState = getContestRuntimeState(contest);
    if (isLifecycleMutationLocked(runtimeState)) {
      const lockMessage = getProblemMutationLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'bulk_add',
          runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    // Verify problem accessibility (BOLA & private problem protection) for each problem
    for (const item of problems) {
      const numPId = Number(item.problemId || item.id);
      const problem = await ProblemModel.findProblemById(numPId);
      if (!problem) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Problem with ID ${numPId} not found`,
        });
      }
      if (req.user.role === 'professor') {
        const scope = (problem.accessScope || problem.access_scope || 'public').toLowerCase();
        const isOwner = problem.createdBy === req.user.id || problem.created_by === req.user.id;
        const isPub = problem.isPublished !== undefined ? problem.isPublished : problem.is_published;
        if ((scope !== 'public' || isPub === false) && !isOwner) {
          await AuditLogger.logAction({
            actor: req.user,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'problem',
            resourceId: numPId,
            outcome: 'denied',
            metadata: { attemptedAction: 'ATTACH_INACCESSIBLE_PROBLEM', contestId: contestIdNum },
            req,
          });
          return res.status(403).json({
            status: 'error',
            statusCode: 403,
            message: 'Forbidden: You do not have permission to attach this problem',
          });
        }
      }
    }

    const bulkResult = await ContestModel.bulkAddProblemsWithSafety(contestIdNum, problems, req.user, req);
    if (bulkResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'bulk_add',
          runtimeState: bulkResult.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: bulkResult.message,
      });
    }

    return res.status(200).json({
      message: 'Problems added to contest successfully',
      mappings: bulkResult.mappings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk remove problems from contest
 * @route DELETE /api/contests/:id/problems
 */
const bulkRemoveProblemsFromContest = async (req, res, next) => {
  try {
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { problemIds } = req.body || {};

    if (problemIds !== undefined && problemIds !== null) {
      if (!Array.isArray(problemIds)) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'problemIds must be an array of positive integers.',
        });
      }
      if (problemIds.length > 100) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'problemIds array exceeds maximum allowed limit of 100 items.',
        });
      }
      for (const id of problemIds) {
        const idNum = Number(id);
        if (!Number.isInteger(idNum) || idNum <= 0) {
          return res.status(400).json({
            status: 'error',
            statusCode: 400,
            message: `Invalid problem ID in removal list: ${id}. Must be a positive integer.`,
          });
        }
      }
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PROBLEM_BULK_REMOVE' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to remove problems from this contest',
      });
    }

    const runtimeState = getContestRuntimeState(contest);
    if (isLifecycleMutationLocked(runtimeState)) {
      const lockMessage = getProblemMutationLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'bulk_remove',
          runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    const bulkResult = await ContestModel.bulkRemoveProblemsWithSafety(contestIdNum, problemIds, req.user, req);
    if (bulkResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'bulk_remove',
          runtimeState: bulkResult.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: bulkResult.message,
      });
    }

    return res.status(200).json({
      message: 'Problems removed from contest successfully',
      contestId: contestIdNum,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Join contest (for students and users)
 * @route POST /api/contests/:id/join
 */
const joinContest = async (req, res, next) => {
  try {
    const { id: contestId } = req.params;
    const userId = req.user.id;

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // Must be published
    if (contest.status !== 'published') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest is not yet published',
      });
    }

    // Check if ended
    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'ended') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest has already ended',
      });
    }

    // Check if already joined
    const existing = await ContestModel.findParticipant(contestId, userId);
    if (existing) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'You have already joined this contest',
      });
    }

    const participant = await ContestModel.addParticipant(contestId, userId);

    return res.status(201).json({
      message: 'Successfully joined contest',
      participant,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get contest participants (restricted to managers)
 * @route GET /api/contests/:id/participants
 */
const getContestParticipants = async (req, res, next) => {
  try {
    const { id: contestId } = req.params;

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view participant details for this contest',
      });
    }

    const participants = await ContestModel.getContestParticipants(contestId);

    return res.status(200).json({
      contestId,
      participantCount: participants.length,
      participants,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Finalize ratings for a contest (Professors/Contest Admins/Super Admins)
 * @route POST /api/contests/:id/finalize-ratings
 */
const finalizeContestRatings = async (req, res, next) => {
  try {
    const { id: contestId } = req.params;
    const { force } = req.body || {};

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // Check manager permission
    if (!canManageResource(req.user, contest) && req.user.role === 'student') {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to finalize contest ratings',
      });
    }

    const result = await RatingService.finalizeContestRatings(contestId, req.user, {
      force: Boolean(force),
    }, req);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get contest leaderboard with problem matrix, podium, user position, and freeze status
 * @route GET /api/contests/:id/leaderboard
 */
const getContestLeaderboard = async (req, res, next) => {
  try {
    const { id: contestId } = req.params;
    const { page, limit, search, freezeOverride } = req.query;

    const StandingsService = require('../services/standingsService');
    const result = await StandingsService.computeContestStandings({
      contestId,
      requestingUser: req.user || null,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search: search || '',
      freezeOverride: freezeOverride === 'true' || freezeOverride === true,
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Reorder problems in a contest
 * @route PUT /api/contests/:contestId/problems/order
 * @route PUT /api/contests/:id/problems/order
 * @route PATCH /api/contests/:contestId/problems/order
 * @route PATCH /api/contests/:id/problems/order
 */
const reorderContestProblems = async (req, res, next) => {
  try {
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    // Parse ordered problem IDs from body (support { problemIds: [...] }, { orderedProblemIds: [...] }, or { order: [...] })
    let orderedProblemIds = null;
    if (Array.isArray(req.body?.problemIds)) {
      orderedProblemIds = req.body.problemIds;
    } else if (Array.isArray(req.body?.orderedProblemIds)) {
      orderedProblemIds = req.body.orderedProblemIds;
    } else if (Array.isArray(req.body?.problems)) {
      orderedProblemIds = req.body.problems
        .sort((a, b) => (parseInt(a.problemOrder || a.order, 10) || 0) - (parseInt(b.problemOrder || b.order, 10) || 0))
        .map(p => p.problemId || p.id);
    } else if (Array.isArray(req.body?.order)) {
      orderedProblemIds = req.body.order
        .sort((a, b) => (parseInt(a.problemOrder || a.order, 10) || 0) - (parseInt(b.problemOrder || b.order, 10) || 0))
        .map(p => p.problemId || p.id);
    } else if (Array.isArray(req.body)) {
      orderedProblemIds = req.body;
    }

    if (!orderedProblemIds || !Array.isArray(orderedProblemIds) || orderedProblemIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'A non-empty array of problem IDs is required for reordering.',
      });
    }

    if (orderedProblemIds.length > 100) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Problem ordering array exceeds maximum allowed limit of 100 items.',
      });
    }

    for (let i = 0; i < orderedProblemIds.length; i++) {
      const pIdNum = Number(orderedProblemIds[i]);
      if (!Number.isInteger(pIdNum) || pIdNum <= 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Invalid problem ID in ordering array: ${orderedProblemIds[i]}. Problem ID must be a positive integer.`,
        });
      }
    }

    // 1. Resolve contest resource
    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // 2. Ownership & RBAC check BEFORE lifecycle check
    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PROBLEMS_REORDERED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to reorder problems in this contest',
      });
    }

    // 3. Authoritative lifecycle check
    const runtimeState = getContestRuntimeState(contest);
    if (isLifecycleMutationLocked(runtimeState)) {
      const lockMessage = getProblemMutationLockMessage(runtimeState);
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'reorder',
          runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: lockMessage,
      });
    }

    // 4. Atomic reorder execution under transaction row lock
    const reorderResult = await ContestModel.reorderContestProblemsWithSafety(
      contestIdNum,
      orderedProblemIds,
      req.user,
      req
    );

    if (reorderResult.locked) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CONTEST_PROBLEM_MUTATION',
          operation: 'reorder',
          runtimeState: reorderResult.runtimeState,
        },
        req,
      });
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: reorderResult.message,
      });
    }

    if (!reorderResult.success) {
      if (reorderResult.notFound) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Contest with ID ${contestIdNum} not found`,
        });
      }
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: reorderResult.message || 'Validation failed for contest problem ordering',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Contest problems reordered successfully',
      contestId: contestIdNum,
      problems: reorderResult.problems,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createContest,
  getAllContests,
  getContestById,
  updateContest,
  deleteContest,
  publishContest,
  unpublishContest,
  archiveContest,
  getContestProblems,
  addProblemToContest,
  removeProblemFromContest,
  reorderContestProblems,
  bulkAddProblemsToContest,
  bulkRemoveProblemsFromContest,
  joinContest,
  getContestParticipants,
  finalizeContestRatings,
  getContestLeaderboard,
};
