const db = require('../config/db');
const SubmissionModel = require('../models/submissionModel');
const ContestModel = require('../models/contestModel');
const ProblemModel = require('../models/problemModel');
const TestCaseModel = require('../models/testCaseModel');
const { getContestRuntimeState } = require('../services/contestService');
const SubmissionPerformanceService = require('../services/submissionPerformanceService');
const judgeQueue = require('../judge/queue/judgeQueue');
const AuditLogger = require('../services/auditLogger');

/**
 * Submit code for official evaluation against all test cases
 * @route POST /api/submissions
 */
const submitSolution = async (req, res, next) => {
  let client = null;
  try {
    const userId = req.user.id;
    const { contestId, problemId, language, sourceCode, codingMode } = req.body;

    // 1. Verify problem existence and authorization
    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    let effectiveContestId = null;
    if (contestId) {
      client = await db.getClient();
      await client.query('BEGIN');

      const cRes = await client.query(
        'SELECT id, title, status, start_time AS "startTime", end_time AS "endTime", is_rating_finalized AS "isRatingFinalized" FROM contests WHERE id = $1 FOR SHARE',
        [contestId]
      );
      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Contest with ID ${contestId} not found`,
        });
      }

      const contest = cRes.rows[0];

      const isAttached = await ContestModel.isProblemInContest(contestId, problemId, client);
      if (!isAttached) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Problem with ID ${problemId} does not belong to contest ${contestId}`,
        });
      }

      if (contest.status !== 'published') {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Submissions are not allowed for draft / unpublished contests',
        });
      }

      const isFinalized = Boolean(
        contest.isRatingFinalized !== undefined ? contest.isRatingFinalized : contest.is_rating_finalized
      );
      if (isFinalized) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Submissions rejected: Contest has already been finalized.',
        });
      }

      const runtimeState = getContestRuntimeState(contest);
      if (runtimeState !== 'running') {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Submissions rejected: Contest is currently '${runtimeState}'. Submissions are strictly accepted only during 'running' state.`,
        });
      }

      if (req.user.role === 'student') {
        const partRes = await client.query(
          'SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
          [contestId, userId]
        );
        if (partRes.rowCount === 0) {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          await AuditLogger.logAction({
            actor: req.user,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'contest',
            resourceId: contestId,
            outcome: 'denied',
            metadata: {
              attemptedAction: 'CONTEST_SUBMISSION_UNENROLLED',
              problemId,
              contestId,
            },
            req,
          });
          return res.status(403).json({
            status: 'error',
            statusCode: 403,
            message: 'Forbidden: You must join the contest before you can submit code',
          });
        }
      }
      effectiveContestId = contest.id;
    } else {
      const isAuthorized = await ProblemModel.isUserAuthorizedForProblem(problem, req.user);
      if (!isAuthorized) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Problem with ID ${problemId} not found`,
        });
      }
      effectiveContestId = null;
    }

    const effectiveCodingMode = codingMode ? codingMode.toLowerCase() : (problem.codingMode || 'function');

    // 2. Create queued submission record in database
    const submission = await SubmissionModel.createSubmission({
      userId,
      contestId: effectiveContestId,
      problemId,
      language,
      codingMode: effectiveCodingMode,
      sourceCode,
      isSampleRun: false,
    }, client);

    if (client) {
      await client.query('COMMIT');
      client.release();
      client = null;
    }

    // Audit log successful submission receipt
    await AuditLogger.logAction({
      actor: req.user,
      action: 'SUBMISSION_CREATED',
      resourceType: 'submission',
      resourceId: submission.id,
      outcome: 'success',
      metadata: {
        contestId: effectiveContestId,
        problemId,
        language,
        codingMode: effectiveCodingMode,
      },
      req,
    });

    // 3. Push job to execution queue with user concurrency tracking
    const enqueued = judgeQueue.addJob({
      submissionId: submission.id,
      userId,
      isSampleRun: false,
    });
    if (!enqueued) {
      return res.status(429).json({
        status: 'error',
        statusCode: 429,
        error: 'QUEUE_CONCURRENCY_LIMIT',
        message: 'Submission queue limit reached. Please wait for your previous submission to finish.',
      });
    }

    return res.status(201).json({
      message: 'Submission received and queued for evaluation',
      submission: {
        id: submission.id,
        contestId: submission.contestId,
        problemId: submission.problemId,
        language: submission.language,
        codingMode: submission.codingMode,
        status: submission.status,
        createdAt: submission.createdAt,
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      client.release();
      client = null;
    }
    next(error);
  }
};

/**
 * Run code interactively against sample test cases
 * @route POST /api/submissions/run
 */
const runSampleTests = async (req, res, next) => {
  let client = null;
  try {
    const userId = req.user.id;
    const { contestId, problemId, language, sourceCode, codingMode } = req.body;

    const problem = await ProblemModel.findProblemById(problemId);
    if (!problem) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Problem with ID ${problemId} not found`,
      });
    }

    let effectiveContestId = null;
    if (contestId) {
      client = await db.getClient();
      await client.query('BEGIN');

      const cRes = await client.query(
        'SELECT id, title, status, start_time AS "startTime", end_time AS "endTime", is_rating_finalized AS "isRatingFinalized" FROM contests WHERE id = $1 FOR SHARE',
        [contestId]
      );
      if (cRes.rowCount === 0) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Contest with ID ${contestId} not found`,
        });
      }

      const contest = cRes.rows[0];

      const isAttached = await ContestModel.isProblemInContest(contestId, problemId, client);
      if (!isAttached) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Problem with ID ${problemId} does not belong to contest ${contestId}`,
        });
      }

      if (contest.status !== 'published') {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Interactive runs are not allowed for draft / unpublished contests',
        });
      }

      const isFinalized = Boolean(
        contest.isRatingFinalized !== undefined ? contest.isRatingFinalized : contest.is_rating_finalized
      );
      if (isFinalized) {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Interactive runs rejected: Contest has already been finalized.',
        });
      }

      const runtimeState = getContestRuntimeState(contest);
      if (runtimeState !== 'running') {
        await client.query('ROLLBACK');
        client.release();
        client = null;
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: `Interactive runs rejected: Contest is currently '${runtimeState}'.`,
        });
      }

      if (req.user.role === 'student') {
        const partRes = await client.query(
          'SELECT 1 FROM contest_participants WHERE contest_id = $1 AND user_id = $2',
          [contestId, userId]
        );
        if (partRes.rowCount === 0) {
          await client.query('ROLLBACK');
          client.release();
          client = null;
          await AuditLogger.logAction({
            actor: req.user,
            action: 'PRIVILEGED_ACTION_DENIED',
            resourceType: 'contest',
            resourceId: contestId,
            outcome: 'denied',
            metadata: {
              attemptedAction: 'CONTEST_RUN_SAMPLE_UNENROLLED',
              problemId,
              contestId,
            },
            req,
          });
          return res.status(403).json({
            status: 'error',
            statusCode: 403,
            message: 'Forbidden: You must join the contest before you can run sample code',
          });
        }
      }
      effectiveContestId = contest.id;
    } else {
      const isAuthorized = await ProblemModel.isUserAuthorizedForProblem(problem, req.user);
      if (!isAuthorized) {
        return res.status(404).json({
          status: 'error',
          statusCode: 404,
          message: `Problem with ID ${problemId} not found`,
        });
      }
      effectiveContestId = null;
    }

    const effectiveCodingMode = codingMode ? codingMode.toLowerCase() : (problem.codingMode || 'function');

    const submission = await SubmissionModel.createSubmission({
      userId,
      contestId: effectiveContestId,
      problemId,
      language,
      codingMode: effectiveCodingMode,
      sourceCode,
      isSampleRun: true,
    }, client);

    if (client) {
      await client.query('COMMIT');
      client.release();
      client = null;
    }

    const evaluatedSubmission = await new Promise((resolve) => {
      const enqueued = judgeQueue.addJob({
        submissionId: submission.id,
        userId,
        isSampleRun: true,
        resolveCallback: resolve,
      });
      if (!enqueued) {
        resolve({ status: 'system_error', errorMessage: 'Execution queue limit reached. Please wait for your previous run to finish.' });
      }
    });

    return res.status(200).json({
      message: 'Sample test execution completed',
      runResult: {
        id: submission.id,
        codingMode: submission.codingMode,
        status: evaluatedSubmission ? evaluatedSubmission.status : 'system_error',
        executionTime: evaluatedSubmission ? evaluatedSubmission.executionTime : 0,
        memoryUsed: evaluatedSubmission ? evaluatedSubmission.memoryUsed : 0,
        errorMessage: evaluatedSubmission ? evaluatedSubmission.errorMessage : null,
        sampleResults: evaluatedSubmission ? evaluatedSubmission.sampleResults || [] : [],
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
      client.release();
      client = null;
    }
    next(error);
  }
};

/**
 * Get submission status and results by ID
 * @route GET /api/submissions/:id
 */
const getSubmissionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const parsedId = parseInt(idStr, 10);
    if (parsedId <= 0 || parsedId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const submission = await SubmissionModel.findSubmissionById(parsedId);

    if (!submission) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${id} not found`,
      });
    }

    if (req.user.role === 'student' && submission.userId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: "Forbidden: You cannot inspect another student's submission",
      });
    }

    if (req.user.role === 'professor') {
      const isOwner = submission.contestCreatorId === req.user.id || submission.problemCreatorId === req.user.id || submission.userId === req.user.id;
      if (!isOwner) {
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: 'Forbidden: You do not have permission to inspect this submission',
        });
      }
    }

    const performanceStats = await SubmissionPerformanceService.getPerformanceStats(submission);

    return res.status(200).json({
      id: submission.id,
      userId: submission.userId,
      username: submission.username,
      userFullName: submission.userFullName,
      contestId: submission.contestId,
      contestTitle: submission.contestTitle,
      problemId: submission.problemId,
      problemTitle: submission.problemTitle,
      problemDifficulty: submission.problemDifficulty,
      language: submission.language,
      codingMode: submission.codingMode,
      sourceCode: submission.sourceCode,
      status: submission.status,
      score: submission.score,
      executionTime: submission.executionTime,
      memoryUsed: submission.memoryUsed,
      errorMessage: submission.errorMessage,
      testCasesPassed: submission.testCasesPassed,
      testCasesTotal: submission.testCasesTotal,
      validationSummary: submission.validationSummary,
      performanceStats,
      createdAt: submission.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get submission source code securely (authorized for owner/admin only)
 * @route GET /api/submissions/:id/code
 */
const getSubmissionCode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const parsedId = parseInt(idStr, 10);
    if (parsedId <= 0 || parsedId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const submission = await SubmissionModel.findSubmissionById(parsedId);

    if (!submission) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${id} not found`,
      });
    }

    // Strict ownership & authorization verification
    if (req.user.role === 'student') {
      if (submission.userId !== req.user.id) {
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: "Forbidden: You cannot view another student's source code",
        });
      }
    } else if (req.user.role === 'professor') {
      const isOwner =
        submission.contestCreatorId === req.user.id ||
        submission.problemCreatorId === req.user.id ||
        submission.userId === req.user.id;
      if (!isOwner) {
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: 'Forbidden: You do not have permission to view source code for this submission',
        });
      }
    } else if (req.user.role !== 'super_admin' && req.user.role !== 'contest_admin') {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Forbidden: Insufficient privileges to view source code',
      });
    }

    return res.status(200).json({
      id: submission.id,
      problemId: submission.problemId,
      problemTitle: submission.problemTitle,
      problemDifficulty: submission.problemDifficulty,
      language: submission.language,
      codingMode: submission.codingMode,
      sourceCode: submission.sourceCode,
      status: submission.status,
      score: submission.score,
      executionTime: submission.executionTime,
      memoryUsed: submission.memoryUsed,
      errorMessage: submission.errorMessage,
      createdAt: submission.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get percentile and relative performance statistics for a submission
 * @route GET /api/submissions/:id/performance
 */
const getSubmissionPerformance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const parsedId = parseInt(idStr, 10);
    if (parsedId <= 0 || parsedId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const submission = await SubmissionModel.findSubmissionById(parsedId);

    if (!submission) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${id} not found`,
      });
    }

    // Strict BOLA / IDOR Authorization Check
    if (req.user.role === 'student' && submission.userId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: "Forbidden: You cannot inspect another student's submission performance",
      });
    }

    if (req.user.role === 'professor') {
      const isOwner =
        submission.contestCreatorId === req.user.id ||
        submission.problemCreatorId === req.user.id ||
        submission.userId === req.user.id;
      if (!isOwner) {
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: 'Forbidden: You do not have permission to inspect this submission performance',
        });
      }
    }

    const performance = await SubmissionPerformanceService.getRelativePerformance(submission);
    return res.status(200).json(performance);
  } catch (error) {
    next(error);
  }
};

/**
 * Get runtime and memory distribution histograms for a submission
 * @route GET /api/submissions/:id/performance/distribution
 */
const getSubmissionDistribution = async (req, res, next) => {
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const parsedId = parseInt(idStr, 10);
    if (parsedId <= 0 || parsedId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid submission ID format. Must be a positive integer.',
      });
    }

    const submission = await SubmissionModel.findSubmissionById(parsedId);

    if (!submission) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${id} not found`,
      });
    }

    // Strict BOLA / IDOR Authorization Check
    if (req.user.role === 'student' && submission.userId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: "Forbidden: You cannot inspect another student's performance distribution",
      });
    }

    if (req.user.role === 'professor') {
      const isOwner =
        submission.contestCreatorId === req.user.id ||
        submission.problemCreatorId === req.user.id ||
        submission.userId === req.user.id;
      if (!isOwner) {
        return res.status(403).json({
          status: 'error',
          statusCode: 403,
          message: 'Forbidden: You do not have permission to inspect this performance distribution',
        });
      }
    }

    const distribution = await SubmissionPerformanceService.getPerformanceDistribution(submission);
    return res.status(200).json(distribution);
  } catch (error) {
    next(error);
  }
};

/**
 * Phase 5.8.5: Compare two submissions side-by-side
 * @route GET /api/submissions/compare?left=<id>&right=<id>
 */
const compareSubmissions = async (req, res, next) => {
  try {
    const { left, right } = req.query;

    const leftStr = String(left || '').trim();
    const rightStr = String(right || '').trim();

    // 1. Strict ID validation
    if (!/^\d+$/.test(leftStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid left submission ID format. Must be a positive integer.',
      });
    }

    if (!/^\d+$/.test(rightStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid right submission ID format. Must be a positive integer.',
      });
    }

    const leftId = parseInt(leftStr, 10);
    const rightId = parseInt(rightStr, 10);

    if (leftId <= 0 || leftId > 2147483647 || rightId <= 0 || rightId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Submission IDs must be positive integers.',
      });
    }

    // 2. Fetch authoritative submissions independently
    const [subLeft, subRight] = await Promise.all([
      SubmissionModel.findSubmissionById(leftId),
      SubmissionModel.findSubmissionById(rightId),
    ]);

    if (!subLeft) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${leftId} not found`,
      });
    }

    if (!subRight) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Submission with ID ${rightId} not found`,
      });
    }

    // 3. Independent Authorization Enforcement
    const checkAccess = (submission, idLabel) => {
      if (req.user.role === 'student' && submission.userId !== req.user.id) {
        return {
          authorized: false,
          message: `Forbidden: You cannot inspect another student's submission (${idLabel} #${submission.id})`,
        };
      }

      if (req.user.role === 'professor') {
        const isOwner =
          submission.contestCreatorId === req.user.id ||
          submission.problemCreatorId === req.user.id ||
          submission.userId === req.user.id;
        if (!isOwner) {
          return {
            authorized: false,
            message: `Forbidden: You do not have permission to inspect submission ${submission.id}`,
          };
        }
      }

      return { authorized: true };
    };

    const leftAuth = checkAccess(subLeft, 'left');
    if (!leftAuth.authorized) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: leftAuth.message,
      });
    }

    const rightAuth = checkAccess(subRight, 'right');
    if (!rightAuth.authorized) {
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: rightAuth.message,
      });
    }

    // 4. Same-Problem Validation
    if (Number(subLeft.problemId) !== Number(subRight.problemId)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Cannot compare submissions across different problems. Both submissions must belong to problem ID ${subLeft.problemId}.`,
      });
    }

    // 5. Generate Comparison
    const comparisonResult = await SubmissionPerformanceService.compareSubmissions(
      subLeft,
      subRight,
      req.user
    );

    return res.status(200).json(comparisonResult);
  } catch (error) {
    next(error);
  }
};

/**
 * Phase 5.8.5: Get user's previous submissions for a problem (for candidate comparison picker)
 * @route GET /api/submissions/problem/:problemId/my
 */
const getMySubmissionsForProblem = async (req, res, next) => {
  try {
    const { problemId } = req.params;
    const pIdStr = String(problemId || '').trim();
    if (!/^\d+$/.test(pIdStr)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid problem ID format',
      });
    }

    const pId = parseInt(pIdStr, 10);
    if (pId <= 0 || pId > 2147483647) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid problem ID format',
      });
    }
    const submissions = await SubmissionModel.findUserSubmissionsForProblem(req.user.id, pId, 20);
    return res.status(200).json({ submissions });
  } catch (error) {
    next(error);
  }
};

/**
 * Get paginated submission history for the authenticated user
 * @route GET /api/submissions/my
 */
const getMySubmissions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      search,
      verdict,
      language,
      contestId,
      problemId,
      timeRange = 'all',
      sortBy = 'newest',
      page = 1,
      limit = 20,
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;

    const [submissions, totalSubmissions] = await Promise.all([
      SubmissionModel.findSubmissionsByUser(userId, {
        search,
        verdict,
        language,
        contestId,
        problemId,
        timeRange,
        sortBy,
        limit: parsedLimit,
        offset,
      }),
      SubmissionModel.countSubmissionsByUser(userId, {
        search,
        verdict,
        language,
        contestId,
        problemId,
        timeRange,
      }),
    ]);

    const totalPages = Math.ceil(totalSubmissions / parsedLimit) || 1;

    return res.status(200).json({
      count: submissions.length,
      submissions,
      pagination: {
        currentPage: parsedPage,
        totalPages,
        totalSubmissions,
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
 * Get student coding analytics and performance statistics
 * @route GET /api/submissions/analytics
 */
const getStudentAnalytics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { timeRange = 'all' } = req.query;

    const analytics = await SubmissionModel.getStudentAnalytics(userId, { timeRange });

    return res.status(200).json(analytics);
  } catch (error) {
    next(error);
  }
};

/**
 * Export personal submission history as CSV
 * @route GET /api/submissions/export
 */
const exportSubmissionsCsv = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const submissions = await SubmissionModel.findSubmissionsForExport(userId);

    // CSV Header row
    const headers = [
      'Submission ID',
      'Problem ID',
      'Problem Title',
      'Difficulty',
      'Language',
      'Coding Mode',
      'Verdict',
      'Score',
      'Execution Time (ms)',
      'Memory Used (KB)',
      'Tests Passed',
      'Total Tests',
      'Contest Title',
      'Submitted At',
    ];

    // Escape CSV cell value safely
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const text = String(str).replace(/"/g, '""');
      return `"${text}"`;
    };

    const csvRows = [headers.join(',')];
    for (const sub of submissions) {
      csvRows.push(
        [
          sub.id,
          sub.problemId,
          escapeCsv(sub.problemTitle),
          escapeCsv(sub.difficulty),
          escapeCsv(sub.language),
          escapeCsv(sub.codingMode),
          escapeCsv(sub.verdict),
          sub.score || 0,
          sub.executionTimeMs || 0,
          sub.memoryUsedKb || 0,
          sub.testCasesPassed || 0,
          sub.testCasesTotal || 0,
          escapeCsv(sub.contestTitle),
          escapeCsv(sub.submittedAt ? new Date(sub.submittedAt).toISOString() : ''),
        ].join(',')
      );
    }

    const csvContent = csvRows.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="submissions_export_${userId}_${Date.now()}.csv"`
    );

    return res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitSolution,
  runSampleTests,
  getSubmissionById,
  getSubmissionCode,
  getSubmissionPerformance,
  getSubmissionDistribution,
  compareSubmissions,
  getMySubmissionsForProblem,
  getMySubmissions,
  getStudentAnalytics,
  exportSubmissionsCsv,
};