const ContestModel = require('../models/contestModel');
const UserModel = require('../models/userModel');
const ProblemModel = require('../models/problemModel');
const RatingService = require('../services/ratingService');
const AuditLogger = require('../services/auditLogger');
const ContestExportService = require('../services/contestExportService');
const db = require('../config/db');
const {
  canManageResource,
  formatContest,
  getContestRuntimeState,
  isLifecycleMutationLocked,
  getLifecycleLockMessage,
  getProblemMutationLockMessage,
} = require('../services/contestService');
const {
  validateStudentEligibility,
  validateContestAccess,
  evaluateContestAccessAndEligibility,
  validateTargetStudentForEnrollment,
} = require('../services/contestAccessService');


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
      leaderboardFreezeMinutes:
        leaderboardFreezeMinutes !== undefined && leaderboardFreezeMinutes !== null
          ? Math.max(0, parseInt(leaderboardFreezeMinutes, 10) || 0)
          : 60,
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

    // If contest is draft, only authorized managers/creator can view it
    if (contest.status === 'draft' && !canManageResource(req.user, contest)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Draft contests are not visible to participants',
      });
    }

    const problems = await ContestModel.getContestProblems(contest.id);
    const formatted = formatContest(contest);

    let isEnrolled = false;
    let enrolledAt = null;
    if (req.user && req.user.id) {
      const participant = await ContestModel.findParticipant(contest.id, req.user.id);
      if (participant) {
        isEnrolled = true;
        enrolledAt = participant.joinedAt;
      }
    }

    return res.status(200).json({
      ...formatted,
      isEnrolled,
      enrolledAt,
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
    const rawId = req.params.id;
    const contestIdNum = Number(rawId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }
    const id = contestIdNum;

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

    // Block publication / unpublication via generic update
    if (status === 'published' && contest.status === 'draft') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Contests cannot be published via generic update. Please use POST /api/contests/:id/publish.',
      });
    }

    if (status === 'draft' && contest.status === 'published') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Contests cannot be reverted to draft via generic update. Please use POST /api/contests/:id/unpublish.',
      });
    }

    // Verify chronological validity if only one date is updated
    if (startTime !== undefined || endTime !== undefined) {
      const effectiveStartTime = startTime !== undefined ? new Date(startTime) : new Date(contest.startTime);
      const effectiveEndTime = endTime !== undefined ? new Date(endTime) : new Date(contest.endTime);
      if (effectiveEndTime <= effectiveStartTime) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Contest update validation failed',
          errors: ['Contest end time must be later than the start time.'],
        });
      }

      // Hardening: For published upcoming contests, start time cannot be set in the past to force early start
      if (contest.status === 'published' && startTime !== undefined) {
        const newStart = new Date(startTime);
        if (newStart <= new Date()) {
          return res.status(400).json({
            status: 'error',
            statusCode: 400,
            message: 'Contest update validation failed',
            errors: ['Cannot set start time to the past for a published upcoming contest.'],
          });
        }
      }

      // Hardening: For published upcoming contests, end time cannot be set in the past
      if (contest.status === 'published' && endTime !== undefined) {
        const newEnd = new Date(endTime);
        if (newEnd <= new Date()) {
          return res.status(400).json({
            status: 'error',
            statusCode: 400,
            message: 'Contest update validation failed',
            errors: ['Cannot set end time to the past for a published upcoming contest.'],
          });
        }
      }
    }

    // Hardening: isRated cannot be modified while contest is running
    if (isRated !== undefined && runtimeState === 'running') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot modify rated status while the contest is running.',
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
      const attemptedAction = updateResult.resultLocked
        ? 'CONTEST_RESULT_MUTATION_AFTER_FINALIZATION'
        : 'CONTEST_LIFECYCLE_UPDATE';

      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: id,
        outcome: 'denied',
        metadata: {
          attemptedAction,
          runtimeState: updateResult.runtimeState,
          resultLocked: Boolean(updateResult.resultLocked),
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
    const rawId = req.params.id;
    const contestIdNum = Number(rawId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }
    const id = contestIdNum;

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
    if (deleteResult.running) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot delete an actively running contest.',
      });
    }

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
 * Join / Enroll in a published contest (Students only)
 * @route POST /api/contests/:id/join
 */
const joinContest = async (req, res, next) => {
  try {
    const { id: rawContestId } = req.params;
    const contestId = Number(rawContestId);

    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    // Account status check: Inactive or suspended accounts cannot enroll
    const isUserActive = req.user.isActive !== undefined ? req.user.isActive : (req.user.is_active !== undefined ? req.user.is_active : true);
    if (!isUserActive) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'CONTEST_ENROLL', reason: 'INACTIVE_USER_ACCOUNT' },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Inactive or suspended student accounts cannot enroll in contests.',
      });
    }

    // Role check: Only students can participate as competitors
    if (req.user.role !== 'student') {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'CONTEST_ENROLL', role: req.user.role },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Contest self-enrollment is reserved for students. Administrative users do not participate as competitors.',
      });
    }

    const userId = req.user.id;

    // Verify contest existence
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // Check archived status
    if (contest.status === 'archived') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest is archived',
      });
    }

    // Must be published (drafts are private / unenrollable)
    if (contest.status !== 'published') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest is not yet published',
      });
    }

    // Check runtimeState (ended and archived contests cannot be joined)
    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'ended') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest has already ended',
      });
    }

    if (runtimeState === 'archived') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Cannot join contest: Contest is archived',
      });
    }

    // Check if already joined (idempotency / duplicate check)
    const existing = await ContestModel.findParticipant(contestId, userId);
    if (existing) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'You have already joined this contest',
        participant: existing,
      });
    }

    // Atomic insertion with catch for race condition unique violation (23505)
    try {
      const participant = await ContestModel.addParticipant(contestId, userId);

      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PARTICIPANT_JOINED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'success',
          metadata: { userId, contestId: contest.id },
          req,
        });
      }

      return res.status(201).json({
        status: 'success',
        message: 'Successfully joined contest',
        participant,
      });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        const participant = await ContestModel.findParticipant(contestId, userId);
        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'You have already joined this contest',
          participant: participant || { contestId, userId },
        });
      }
      throw dbErr;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Check current user enrollment status in a contest
 * @route GET /api/contests/:id/enrollment
 */
const getMyEnrollmentStatus = async (req, res, next) => {
  try {
    const { id: rawContestId } = req.params;
    const contestId = Number(rawContestId);

    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    const participant = await ContestModel.findParticipant(contestId, req.user.id);

    return res.status(200).json({
      contestId,
      isEnrolled: Boolean(participant),
      enrolledAt: participant ? participant.joinedAt : null,
      participant: participant || null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Check current user contest eligibility and access evaluation (Phase 7.5.7.6)
 * Server-authoritative endpoint. Evaluates req.user.id strictly to prevent BOLA/IDOR.
 * @route GET /api/contests/:id/eligibility
 */
const getContestEligibility = async (req, res, next) => {
  try {
    const { id: rawContestId } = req.params;
    const contestId = Number(rawContestId);

    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // Check if current user is enrolled (evaluating server-authoritative req.user.id)
    const participant = await ContestModel.findParticipant(contestId, req.user.id);
    const isEnrolled = Boolean(participant);

    const evaluation = evaluateContestAccessAndEligibility(req.user, contest, isEnrolled);

    // If contest is in draft status and caller is not a manager, return 403 Forbidden without leaking sensitive info
    if (!evaluation.allowed && contest.status === 'draft') {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Contest is in draft mode and not accessible.',
        eligibility: evaluation,
      });
    }

    return res.status(200).json({
      status: 'success',
      ...evaluation,
      enrolledAt: participant ? participant.joinedAt : null,
      eligibility: evaluation,
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
    const { id: rawContestId } = req.params;
    const contestId = parseInt(rawContestId, 10);

    if (isNaN(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID: must be a positive integer',
      });
    }

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contest.id,
          outcome: 'denied',
          metadata: { attemptedAction: 'GET_CONTEST_PARTICIPANTS' },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to view participant details for this contest',
      });
    }

    const {
      page = 1,
      limit = 20,
      search = '',
      q = '',
      sortBy = 'joinedAt',
      sort_by = '',
      sortOrder = 'ASC',
      sort_order = '',
    } = req.query;

    const effectiveSearch = (search || q || '').trim();
    const effectiveSortBy = sortBy || sort_by || 'joinedAt';
    const effectiveSortOrder = sortOrder || sort_order || 'ASC';

    const result = await ContestModel.getContestParticipants(contestId, {
      page,
      limit,
      search: effectiveSearch,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
    });

    return res.status(200).json({
      contestId,
      participantCount: result.total,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      participants: result.participants,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Manually add a participant to a contest (Manager only)
 * @route POST /api/contests/:id/participants
 */
const addContestParticipant = async (req, res, next) => {
  try {
    const { id: rawContestId } = req.params;
    const contestId = Number(rawContestId);
    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { userId: rawUserId, studentId: rawStudentId } = req.body || {};
    const targetUserId = Number(rawUserId !== undefined ? rawUserId : rawStudentId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid student ID format. Must provide a valid positive integer userId.',
      });
    }

    // 1. Verify contest existence
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // 2. Authorization / BOLA check: Only authorized managers (owning professor, contest_admin, super_admin)
    if (!canManageResource(req.user, contest)) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'ADD_PARTICIPANT', targetUserId },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to manage participants for this contest',
      });
    }

    // 3. Lifecycle check: ended and archived contests are locked against adding participants
    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'archived' || contest.status === 'archived') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot add participants: Contest is archived',
      });
    }

    if (runtimeState === 'ended') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot add participants: Contest has already ended',
      });
    }

    // 4. Verify target user exists, is active, and has role 'student'
    const studentUser = await UserModel.findUserById(targetUserId);
    if (!studentUser) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Student with ID ${targetUserId} not found`,
      });
    }

    if (studentUser.role !== 'student') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Cannot add user '${studentUser.username}' as participant: Only student accounts can participate as competitors`,
      });
    }

    const isTargetActive = studentUser.isActive !== undefined ? studentUser.isActive : (studentUser.is_active !== undefined ? studentUser.is_active : true);
    if (!isTargetActive) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Cannot add student '${studentUser.username}': User account is inactive`,
      });
    }

    // 5. Duplicate check
    const existing = await ContestModel.findParticipant(contestId, targetUserId);
    if (existing) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: `Student '${studentUser.username}' is already enrolled in this contest`,
        participant: existing,
      });
    }

    // 6. Insert participant with race condition catch (code 23505)
    try {
      const participant = await ContestModel.addParticipant(contestId, targetUserId);

      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PARTICIPANT_ADDED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'success',
          metadata: {
            studentId: targetUserId,
            studentUsername: studentUser.username,
            contestId,
            runtimeState,
          },
          req,
        });
      }

      return res.status(201).json({
        status: 'success',
        message: `Successfully added ${studentUser.fullName || studentUser.username} to contest`,
        participant: {
          contestId: participant.contestId,
          userId: participant.userId,
          joinedAt: participant.joinedAt,
          username: studentUser.username,
          fullName: studentUser.fullName || studentUser.full_name,
          email: studentUser.email,
        },
      });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        const participant = await ContestModel.findParticipant(contestId, targetUserId);
        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: `Student '${studentUser.username}' is already enrolled in this contest`,
          participant: participant || { contestId, userId: targetUserId },
        });
      }
      throw dbErr;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Manually remove a participant from a contest (Manager only)
 * @route DELETE /api/contests/:id/participants/:userId
 */
const removeContestParticipant = async (req, res, next) => {
  try {
    const { id: rawContestId, userId: rawUserId } = req.params;
    const contestId = Number(rawContestId);
    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const targetUserId = Number(rawUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid user ID format. ID must be a positive integer.',
      });
    }

    // 1. Verify contest existence
    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    // 2. Authorization / BOLA check
    if (!canManageResource(req.user, contest)) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'REMOVE_PARTICIPANT', targetUserId },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to manage participants for this contest',
      });
    }

    // 3. Lifecycle check: ended and archived contests are locked against removing participants
    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'archived' || contest.status === 'archived') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot remove participants: Contest is archived',
      });
    }

    if (runtimeState === 'ended') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot remove participants: Contest has already ended',
      });
    }

    // 4. Verify participant currently exists in this contest
    const existing = await ContestModel.findParticipant(contestId, targetUserId);
    if (!existing) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Participant with user ID ${targetUserId} not found in this contest`,
      });
    }

    // 5. Dependency check: protect historical submissions and contest integrity
    const subCheck = await db.query(
      'SELECT 1 FROM submissions WHERE contest_id = $1 AND user_id = $2 LIMIT 1;',
      [contestId, targetUserId]
    );
    if (subCheck.rowCount > 0) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot remove participant: User has submitted solutions in this contest. Historical submission records must be preserved.',
      });
    }

    // 6. Delete participant mapping atomically
    const removed = await ContestModel.removeParticipant(contestId, targetUserId);
    if (!removed) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Participant with user ID ${targetUserId} not found in this contest`,
      });
    }

    // 7. Audit log
    if (AuditLogger && AuditLogger.logAction) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PARTICIPANT_REMOVED',
        resourceType: 'contest',
        resourceId: contestId,
        outcome: 'success',
        metadata: {
          studentId: targetUserId,
          contestId,
          runtimeState,
        },
        req,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Participant removed successfully from contest',
      contestId,
      userId: targetUserId,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search active students eligible to be added to this contest
 * @route GET /api/contests/:id/search-students
 */
const searchContestCandidateStudents = async (req, res, next) => {
  try {
    const { id: rawContestId } = req.params;
    const contestId = Number(rawContestId);
    if (!Number.isInteger(contestId) || contestId <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

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
        message: 'Forbidden: You do not have permission to manage this contest',
      });
    }

    const { search = '', limit = 10 } = req.query;
    const students = await ContestModel.searchAvailableStudents(contestId, {
      search,
      limit,
    });

    return res.status(200).json({
      status: 'success',
      count: students.length,
      students,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk add participants to a contest (Manager only)
 * @route POST /api/contests/:id/participants/bulk
 */
const bulkAddContestParticipants = async (req, res, next) => {
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

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'BULK_ADD_PARTICIPANTS' },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to manage participants for this contest',
      });
    }

    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'archived' || contest.status === 'archived') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot add participants: Contest is archived',
      });
    }

    if (runtimeState === 'ended') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot add participants: Contest has already ended',
      });
    }

    const rawList = req.body?.userIds || req.body?.participants || req.body?.studentIds || (Array.isArray(req.body) ? req.body : []);

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'A non-empty array of user IDs or participant objects is required.',
      });
    }

    if (rawList.length > 100) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Participants array exceeds maximum allowed limit of 100 items.',
      });
    }

    const result = await ContestModel.bulkAddParticipantsWithSafety(contestId, rawList, req.user, req);

    if (result.locked) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: result.message,
      });
    }

    if (result.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (result.validationError) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: result.message || 'Validation failed for participant user IDs',
      });
    }

    const statusCode = result.summary.addedCount > 0 ? 201 : 200;
    return res.status(statusCode).json({
      status: 'success',
      message: `Bulk add operation completed: ${result.summary.addedCount} added, ${result.summary.alreadyEnrolledCount} already enrolled, ${result.summary.invalidCount} invalid.`,
      contestId,
      summary: result.summary,
      added: result.added,
      alreadyEnrolled: result.alreadyEnrolled,
      invalid: result.invalid,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk remove participants from a contest (Manager only)
 * @route DELETE /api/contests/:id/participants/bulk
 * @route DELETE /api/contests/:id/participants
 * @route POST /api/contests/:id/participants/bulk-remove
 */
const bulkRemoveContestParticipants = async (req, res, next) => {
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

    const contest = await ContestModel.findContestById(contestId);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (!canManageResource(req.user, contest)) {
      if (AuditLogger && AuditLogger.logAction) {
        await AuditLogger.logAction({
          actor: req.user,
          action: 'PRIVILEGED_ACTION_DENIED',
          resourceType: 'contest',
          resourceId: contestId,
          outcome: 'denied',
          metadata: { attemptedAction: 'BULK_REMOVE_PARTICIPANTS' },
          req,
        });
      }
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to manage participants for this contest',
      });
    }

    const runtimeState = getContestRuntimeState(contest);
    if (runtimeState === 'archived' || contest.status === 'archived') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot remove participants: Contest is archived',
      });
    }

    if (runtimeState === 'ended') {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Cannot remove participants: Contest has already ended',
      });
    }

    const rawList = req.body?.userIds || req.body?.participants || req.body?.participantIds || (Array.isArray(req.body) ? req.body : []);

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'A non-empty array of participant user IDs is required.',
      });
    }

    if (rawList.length > 100) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Participant IDs array exceeds maximum allowed limit of 100 items.',
      });
    }

    const result = await ContestModel.bulkRemoveParticipantsWithSafety(contestId, rawList, req.user, req);

    if (result.locked) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: result.message,
      });
    }

    if (result.notFound) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestId} not found`,
      });
    }

    if (result.validationError) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: result.message || 'Validation failed for participant user IDs',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: `Bulk remove operation completed: ${result.summary.removedCount} removed, ${result.summary.blockedCount} blocked with submissions, ${result.summary.notEnrolledCount} not enrolled.`,
      contestId,
      summary: result.summary,
      removed: result.removed,
      blockedWithSubmissions: result.blockedWithSubmissions,
      notEnrolled: result.notEnrolled,
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

    // Check manager permission (strict ownership verification)
    if (!canManageResource(req.user, contest)) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_FINALIZATION_UNAUTHORIZED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: You do not have permission to finalize contest ratings',
      });
    }

    // Client rating tampering detection & security logging
    const { force, ratingChange, newRating, previousRating, rank, participantCount, __testSimulateFailureAt } = req.body || {};
    if (
      ratingChange !== undefined ||
      newRating !== undefined ||
      previousRating !== undefined ||
      rank !== undefined ||
      participantCount !== undefined
    ) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'RATING_INTEGRITY_VIOLATION',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: {
          attemptedAction: 'CLIENT_RATING_TAMPERING',
          reason: 'Client-supplied rating values are strictly ignored. All calculations are server-authoritative.',
          tamperingPayload: { ratingChange, newRating, previousRating, rank, participantCount },
        },
        req,
      });
    }

    const options = {
      force: Boolean(force),
    };
    if (process.env.NODE_ENV === 'test' && __testSimulateFailureAt) {
      options.__testSimulateFailureAt = __testSimulateFailureAt;
    }

    const result = await RatingService.finalizeContestRatings(contestIdNum, req.user, options, req);

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
    const rawContestId = req.params.contestId || req.params.id;
    const contestIdNum = Number(rawContestId);
    if (!Number.isInteger(contestIdNum) || contestIdNum <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid contest ID format. ID must be a positive integer.',
      });
    }

    const { page, limit, search, freezeOverride } = req.query;

    const StandingsService = require('../services/standingsService');
    const result = await StandingsService.computeContestStandings({
      contestId: contestIdNum,
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
 * Get authoritative contest results view
 * @route GET /api/contests/:id/results
 */
const getContestResults = async (req, res, next) => {
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

    const { page, limit, search, freezeOverride } = req.query;

    const StandingsService = require('../services/standingsService');
    const result = await StandingsService.computeContestResults({
      contestId: contestIdNum,
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
 * Get dedicated admin contest leaderboard
 * @route GET /api/contests/:id/admin-leaderboard
 */
const getContestAdminLeaderboard = async (req, res, next) => {
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

    // Role check: Only professors, contest_admin, and super_admin are authorized
    if (!req.user || !['professor', 'contest_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not have permission to access the admin leaderboard.',
      });
    }

    // Contest existence and ownership check (BOLA / IDOR protection)
    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'ADMIN_LEADERBOARD_UNAUTHORIZED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { page, limit, search, freezeOverride, sortBy, sortOrder, filterStatus } = req.query;

    // Validate whitelisted sortBy
    const validSortFields = ['rank', 'score', 'solved', 'penalty', 'participant', 'submissions'];
    if (sortBy && !validSortFields.includes(sortBy)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Invalid sortBy field. Allowed fields: ${validSortFields.join(', ')}`,
      });
    }

    // Validate whitelisted sortOrder
    if (sortOrder && !['ASC', 'DESC', 'asc', 'desc'].includes(sortOrder)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid sortOrder. Allowed: ASC, DESC',
      });
    }

    // Validate whitelisted filterStatus
    const validFilterStatuses = ['all', 'solved_any', 'has_submissions', 'no_submissions'];
    if (filterStatus && !validFilterStatuses.includes(filterStatus)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Invalid filterStatus. Allowed: ${validFilterStatuses.join(', ')}`,
      });
    }

    const StandingsService = require('../services/standingsService');
    const result = await StandingsService.computeContestStandings({
      contestId: contestIdNum,
      requestingUser: req.user,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search: search || '',
      freezeOverride: freezeOverride === 'true' || freezeOverride === true,
      sortBy: sortBy || 'rank',
      sortOrder: (sortOrder || 'ASC').toUpperCase(),
      filterStatus: filterStatus || 'all',
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'ADMIN_LEADERBOARD_ACCESSED',
      resourceType: 'contest',
      resourceId: contestIdNum,
      outcome: 'success',
      metadata: {
        page: page ? parseInt(page, 10) : 1,
        freezeOverride: freezeOverride === 'true' || freezeOverride === true,
        sortBy: sortBy || 'rank',
        filterStatus: filterStatus || 'all',
      },
      req,
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get detailed contest performance and submission history for an individual participant
 * @route GET /api/contests/:id/participants/:userId/results
 * @route GET /api/contests/:id/results/me
 */
const getContestParticipantResultDetails = async (req, res, next) => {
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

    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        message: 'Unauthorized. Authentication token required.',
      });
    }

    // Determine targetUserId
    let targetUserId;
    if (req.params.userId === 'me' || !req.params.userId) {
      targetUserId = req.user.id;
    } else {
      const parsedUserId = Number(req.params.userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Invalid participant ID format. Must be a positive integer or "me".',
        });
      }
      targetUserId = parsedUserId;
    }

    // Verify contest existence
    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // Check manager status
    const isManager = Boolean(
      req.user.role === 'super_admin' ||
      req.user.role === 'contest_admin' ||
      (req.user.role === 'professor' && req.user.id === contest.created_by)
    );

    // BOLA Check: Draft contest secrecy
    if (contest.status === 'draft' && !isManager) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // BOLA Check: Student can only view their own result details
    if (req.user.role === 'student' && targetUserId !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'PARTICIPANT_RESULTS_BOLA', targetUserId },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not have permission to view another student\'s contest result details.',
      });
    }

    // BOLA Check: Professor can only inspect contests they manage
    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'PARTICIPANT_RESULTS_UNAUTHORIZED_PROFESSOR' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { freezeOverride } = req.query;
    const effectiveFreezeOverride = isManager && (freezeOverride === 'true' || freezeOverride === true);

    const StandingsService = require('../services/standingsService');
    const result = await StandingsService.computeParticipantResultDetails({
      contestId: contestIdNum,
      targetUserId,
      requestingUser: req.user,
      freezeOverride: effectiveFreezeOverride,
    });

    if (isManager && targetUserId !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'ADMIN_PARTICIPANT_RESULT_ACCESSED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'success',
        metadata: { targetUserId },
        req,
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getMyContestResultDetails = async (req, res, next) => {
  req.params.userId = 'me';
  return getContestParticipantResultDetails(req, res, next);
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

/**
 * Export contest results / standings in CSV or JSON format
 * @route GET /api/contests/:id/export/results
 */
const exportContestResults = async (req, res, next) => {
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

    // Role check: Only professors, contest_admin, and super_admin are authorized
    if (!req.user || !['professor', 'contest_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not have permission to export contest results.',
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

    // BOLA check: professor can only export contests they created
    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_RESULTS_EXPORT_UNAUTHORIZED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { format = 'csv', freezeOverride } = req.query;
    const effectiveFreezeOverride = freezeOverride === 'true' || freezeOverride === true;

    const exportResult = await ContestExportService.exportContestResults({
      contestId: contestIdNum,
      requestingUser: req.user,
      format,
      freezeOverride: effectiveFreezeOverride,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'CONTEST_RESULTS_EXPORTED',
      resourceType: 'contest',
      resourceId: contestIdNum,
      outcome: 'success',
      metadata: {
        format,
        rowCount: exportResult.rowCount,
        filename: exportResult.filename,
      },
      req,
    });

    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    return res.status(200).send(exportResult.content);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Export all participants summary breakdown in CSV or JSON format
 * @route GET /api/contests/:id/export/participants
 */
const exportContestParticipants = async (req, res, next) => {
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

    if (!req.user || !['professor', 'contest_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not have permission to export contest participants.',
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

    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_PARTICIPANTS_EXPORT_UNAUTHORIZED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { format = 'csv', freezeOverride } = req.query;
    const effectiveFreezeOverride = freezeOverride === 'true' || freezeOverride === true;

    const exportResult = await ContestExportService.exportAllParticipants({
      contestId: contestIdNum,
      requestingUser: req.user,
      format,
      freezeOverride: effectiveFreezeOverride,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'CONTEST_PARTICIPANTS_EXPORTED',
      resourceType: 'contest',
      resourceId: contestIdNum,
      outcome: 'success',
      metadata: {
        format,
        rowCount: exportResult.rowCount,
        filename: exportResult.filename,
      },
      req,
    });

    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    return res.status(200).send(exportResult.content);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Export individual participant performance and submission history in CSV or JSON format
 * @route GET /api/contests/:id/participants/:userId/export
 */
const exportParticipantResultDetails = async (req, res, next) => {
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

    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        message: 'Unauthorized. Authentication token required.',
      });
    }

    let targetUserId;
    if (req.params.userId === 'me' || !req.params.userId) {
      targetUserId = req.user.id;
    } else {
      const parsedUserId = Number(req.params.userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Invalid participant ID format. Must be a positive integer or "me".',
        });
      }
      targetUserId = parsedUserId;
    }

    const contest = await ContestModel.findContestById(contestIdNum);
    if (!contest) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    const isManager = Boolean(
      req.user.role === 'super_admin' ||
      req.user.role === 'contest_admin' ||
      (req.user.role === 'professor' && req.user.id === contest.created_by)
    );

    if (contest.status === 'draft' && !isManager) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Contest with ID ${contestIdNum} not found`,
      });
    }

    // BOLA check: Student can only export their own results
    if (req.user.role === 'student' && targetUserId !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'PARTICIPANT_EXPORT_BOLA', targetUserId },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: "Forbidden. You do not have permission to export another student's contest result details.",
      });
    }

    // BOLA check: Professor can only inspect contests they manage
    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'PARTICIPANT_EXPORT_UNAUTHORIZED_PROFESSOR' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { format = 'csv', freezeOverride } = req.query;
    const effectiveFreezeOverride = isManager && (freezeOverride === 'true' || freezeOverride === true);

    const exportResult = await ContestExportService.exportParticipantDetails({
      contestId: contestIdNum,
      targetUserId,
      requestingUser: req.user,
      format,
      freezeOverride: effectiveFreezeOverride,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'PARTICIPANT_RESULTS_EXPORTED',
      resourceType: 'contest',
      resourceId: contestIdNum,
      outcome: 'success',
      metadata: {
        targetUserId,
        format,
        rowCount: exportResult.rowCount,
        filename: exportResult.filename,
      },
      req,
    });

    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    return res.status(200).send(exportResult.content);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: error.message,
      });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Export contest submissions and performance log in CSV or JSON format
 * @route GET /api/contests/:id/export/submissions
 */
const exportContestSubmissions = async (req, res, next) => {
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

    if (!req.user || !['professor', 'contest_admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not have permission to export contest submissions.',
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

    if (req.user.role === 'professor' && contest.created_by !== req.user.id) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'PRIVILEGED_ACTION_DENIED',
        resourceType: 'contest',
        resourceId: contestIdNum,
        outcome: 'denied',
        metadata: { attemptedAction: 'CONTEST_SUBMISSIONS_EXPORT_UNAUTHORIZED' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden. You do not manage this contest.',
      });
    }

    const { format = 'csv', freezeOverride } = req.query;
    const effectiveFreezeOverride = freezeOverride === 'true' || freezeOverride === true;

    const exportResult = await ContestExportService.exportContestSubmissions({
      contestId: contestIdNum,
      requestingUser: req.user,
      format,
      freezeOverride: effectiveFreezeOverride,
    });

    await AuditLogger.logAction({
      actor: req.user,
      action: 'CONTEST_SUBMISSIONS_EXPORTED',
      resourceType: 'contest',
      resourceId: contestIdNum,
      outcome: 'success',
      metadata: {
        format,
        rowCount: exportResult.rowCount,
        filename: exportResult.filename,
      },
      req,
    });

    res.setHeader('Content-Type', exportResult.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    return res.status(200).send(exportResult.content);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: error.message,
      });
    }
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
  getMyEnrollmentStatus,
  getContestEligibility,
  getContestParticipants,
  addContestParticipant,
  removeContestParticipant,
  bulkAddContestParticipants,
  bulkRemoveContestParticipants,
  searchContestCandidateStudents,
  finalizeContestRatings,
  getContestLeaderboard,
  getContestResults,
  getContestAdminLeaderboard,
  getContestParticipantResultDetails,
  getMyContestResultDetails,
  exportContestResults,
  exportContestParticipants,
  exportParticipantResultDetails,
  exportContestSubmissions,
};
