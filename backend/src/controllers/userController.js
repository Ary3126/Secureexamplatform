const UserModel = require('../models/userModel');
const ContestModel = require('../models/contestModel');
const SubmissionModel = require('../models/submissionModel');
const SavedProblemModel = require('../models/savedProblemModel');
const RatingModel = require('../models/ratingModel');
const AuditLogger = require('../services/auditLogger');
const { formatContest } = require('../services/contestService');
const { sanitizeUser } = require('../services/authService');

/**
 * Get current authenticated user profile with statistics and competitive rating
 * @route GET /api/users/me
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await UserModel.findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ status: 'error', statusCode: 404, message: 'User not found' });
    }

    const sanitized = sanitizeUser(user);

    if (user.role === 'student') {
      const [problemsSolvedCount, joinedContests, recentSubs, rank, ratingHistory] = await Promise.all([
        SubmissionModel.countSolvedProblemsByUser(user.id),
        ContestModel.findJoinedContestsByUser(user.id),
        SubmissionModel.findSubmissionsByUser(user.id, { limit: 5 }),
        RatingModel.getGlobalRank(user.id),
        RatingModel.getRatingHistoryByUser(user.id),
      ]);

      sanitized.problemsSolvedCount = problemsSolvedCount;
      sanitized.contestsJoinedCount = joinedContests.length;
      sanitized.recentSubmissions = recentSubs;
      sanitized.rank = rank;
      sanitized.ratingHistory = ratingHistory;
    }

    return res.status(200).json(sanitized);
  } catch (error) {
    next(error);
  }
};

/**
 * Update authenticated user's profile
 * @route PUT /api/users/me
 */
const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { username, fullName, bio, avatarUrl, institution } = req.body;

    if (username && username.trim().toLowerCase() !== req.user.username.toLowerCase()) {
      const existingUser = await UserModel.findUserByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'This username is already taken by another user.',
        });
      }
    }

    const updatedUser = await UserModel.updateUserProfile(userId, {
      fullName,
      username,
      bio,
      avatarUrl,
      institution,
    });

    if (!updatedUser) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: 'User profile could not be found to update.',
      });
    }

    // Audit log successful profile update
    await AuditLogger.logAction({
      actor: req.user,
      action: 'USER_PROFILE_UPDATED',
      resourceType: 'user',
      resourceId: updatedUser.id,
      outcome: 'success',
      metadata: {
        updatedFields: Object.keys({ fullName, username, bio, avatarUrl, institution }).filter(k => req.body[k] !== undefined),
      },
      req,
    });

    return res.status(200).json({
      message: 'Profile updated successfully',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get public profile for any user
 * @route GET /api/users/:id/public-profile
 */
const getPublicProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const publicProfile = await UserModel.getPublicProfile(id);

    if (!publicProfile) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User '${id}' not found`,
      });
    }

    const rank = await RatingModel.getGlobalRank(publicProfile.id);

    return res.status(200).json({
      user: {
        ...publicProfile,
        rank,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get comprehensive Coder Identity for a user (Own profile or Public profile)
 * Aggregates user identity, rating core, coding DNA, topic constellation, difficulty orbit, and contest history
 * @route GET /api/users/:idOrUsername/identity
 * @route GET /api/users/me/identity
 */
const getCoderIdentity = async (req, res, next) => {
  try {
    const targetIdentifier = req.params.idOrUsername || 'me';
    let targetUser = null;

    if (targetIdentifier === 'me') {
      targetUser = await UserModel.findUserById(req.user.id);
    } else if (!isNaN(targetIdentifier) && !isNaN(parseFloat(targetIdentifier))) {
      targetUser = await UserModel.findUserById(parseInt(targetIdentifier, 10));
    } else {
      targetUser = await UserModel.findUserByUsername(targetIdentifier);
    }

    if (!targetUser) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `Coder '${targetIdentifier}' not found`,
      });
    }

    const isOwnProfile = Boolean(req.user && req.user.id === targetUser.id);

    // Parallel fetch for all identity components
    const [rank, ratingHistory, analytics, topicStats, joinedContests, recentSubmissions] =
      await Promise.all([
        RatingModel.getGlobalRank(targetUser.id),
        RatingModel.getRatingHistoryByUser(targetUser.id),
        SubmissionModel.getStudentAnalytics(targetUser.id),
        SubmissionModel.getSolvedProblemTopics(targetUser.id),
        ContestModel.findJoinedContestsByUser(targetUser.id),
        SubmissionModel.findSubmissionsByUser(targetUser.id, { limit: 8 }),
      ]);

    // Public vs Private sanitized user object
    const user = {
      id: targetUser.id,
      username: targetUser.username,
      fullName: targetUser.full_name || targetUser.fullName,
      role: targetUser.role,
      bio: targetUser.bio || '',
      avatarUrl: targetUser.avatar_url || targetUser.avatarUrl || '',
      institution: targetUser.institution || '',
      currentRating: targetUser.current_rating ?? targetUser.currentRating ?? 1200,
      highestRating: targetUser.highest_rating ?? targetUser.highestRating ?? 1200,
      ratingStatus: targetUser.rating_status || targetUser.ratingStatus || 'provisional',
      ratedContestCount: targetUser.rated_contest_count ?? targetUser.ratedContestCount ?? 0,
      createdAt: targetUser.created_at || targetUser.createdAt,
      rank,
    };

    // Include email ONLY if own profile
    if (isOwnProfile) {
      user.email = targetUser.email;
    }

    const summary = analytics?.summary || {};
    const diffStats = analytics?.difficultyDistribution || { easy: 0, medium: 0, hard: 0 };
    const verdictDist = analytics?.verdictDistribution || {};
    const langDist = analytics?.languageDistribution || {};
    const timeline = analytics?.activityTimeline || [];
    const recent = Array.isArray(recentSubmissions) ? recentSubmissions : [];
    const joined = Array.isArray(joinedContests) ? joinedContests : [];

    return res.status(200).json({
      isOwnProfile,
      user,
      rating: {
        current: user.currentRating,
        highest: user.highestRating,
        status: user.ratingStatus,
        ratedContestCount: user.ratedContestCount,
        globalRank: rank || 1,
      },
      ratingHistory: ratingHistory || [],
      performance: {
        problemsSolved: summary.uniqueProblemsSolved || 0,
        totalSubmissions: summary.totalSubmissions || 0,
        acceptedSubmissions: summary.acceptedSubmissions || 0,
        acceptanceRate: summary.acceptanceRate || 0,
        averageRuntime: summary.averageRuntime || 0,
        averageMemory: summary.averageMemory || 0,
        bestRuntime: summary.bestRuntime || 0,
        bestMemory: summary.bestMemory || 0,
        contestsJoinedCount: joined.length,
      },
      difficultyStats: diffStats,
      topicStats: topicStats || [],
      verdictDistribution: verdictDist,
      languageDistribution: langDist,
      activityTimeline: timeline,
      recentActivity: recent.map((s) => ({
        id: s.id,
        problemId: s.problemId,
        problemTitle: s.problemTitle,
        difficulty: s.difficulty || s.problemDifficulty || 'easy',
        language: s.language,
        verdict: s.status || s.verdict,
        score: s.score || 0,
        executionTimeMs: s.executionTime || s.executionTimeMs || 0,
        memoryUsedKb: s.memoryUsed || s.memoryUsedKb || 0,
        submittedAt: s.createdAt || s.submittedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consolidated Student Dashboard data
 * @route GET /api/users/dashboard
 */
const getStudentDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Parallel fetch for high performance
    const [
      allContests,
      rawJoined,
      problemsSolvedCount,
      totalAttemptsCount,
      continuePracticing,
      savedProblems,
      recentSubmissions,
      user,
      globalRank,
    ] = await Promise.all([
      ContestModel.findAllContests({ status: 'published' }),
      ContestModel.findJoinedContestsByUser(userId),
      SubmissionModel.countSolvedProblemsByUser(userId),
      SubmissionModel.countTotalSubmissionsByUser(userId),
      SubmissionModel.findLatestAttemptedProblem(userId),
      SavedProblemModel.findSavedProblemsByUser(userId, { limit: 4 }),
      SubmissionModel.findSubmissionsByUser(userId, { limit: 8 }),
      UserModel.findUserById(userId),
      RatingModel.getGlobalRank(userId),
    ]);

    const joinedContestIds = new Set(rawJoined.map((j) => j.id));
    const formattedContests = allContests.map(formatContest);
    const runningContests = formattedContests
      .filter((c) => c.runtimeState === 'running')
      .map((c) => ({ ...c, isEnrolled: joinedContestIds.has(c.id) }));
    const upcomingContests = formattedContests
      .filter((c) => c.runtimeState === 'upcoming')
      .map((c) => ({ ...c, isEnrolled: joinedContestIds.has(c.id) }));
    const joinedContests = rawJoined.map(formatContest).map((c) => ({ ...c, isEnrolled: true }));

    const profileSummary = user ? sanitizeUser(user) : null;
    if (profileSummary) {
      profileSummary.rank = globalRank;
    }

    return res.status(200).json({
      profileSummary,
      globalRank,
      runningContests,
      upcomingContests,
      joinedContests,
      problemsSolvedCount,
      totalAttemptsCount,
      continuePracticing,
      savedProblems,
      recentSubmissions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user competitive rating details
 * @route GET /api/users/:id/rating
 */
const getUserRating = async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUserId = id === 'me' ? req.user.id : parseInt(id, 10);

    const [userSummary, rank] = await Promise.all([
      RatingModel.getUserRatingSummary(targetUserId),
      RatingModel.getGlobalRank(targetUserId),
    ]);

    if (!userSummary) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User '${id}' not found`,
      });
    }

    return res.status(200).json({
      userId: userSummary.id,
      username: userSummary.username,
      fullName: userSummary.fullName,
      currentRating: userSummary.currentRating,
      highestRating: userSummary.highestRating,
      ratingStatus: userSummary.ratingStatus,
      ratedContestCount: userSummary.ratedContestCount,
      rank,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user rating history
 * @route GET /api/users/:id/rating-history
 */
const getUserRatingHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUserId = id === 'me' ? req.user.id : parseInt(id, 10);

    const history = await RatingModel.getRatingHistoryByUser(targetUserId);

    return res.status(200).json({
      userId: targetUserId,
      historyCount: history.length,
      history,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  getPublicProfile,
  getCoderIdentity,
  getStudentDashboard,
  getUserRating,
  getUserRatingHistory,
};