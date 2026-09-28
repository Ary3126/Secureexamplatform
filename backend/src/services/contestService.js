/**
 * Contest Service - Calculates runtime contest states and provides
 * resource ownership verification and lifecycle mutation lock logic.
 */

/**
 * Calculate dynamic runtime state for a contest using server-authoritative time
 * @param {Object} contest - Contest object containing status, startTime, endTime
 * @returns {string} 'draft' | 'upcoming' | 'running' | 'ended' | 'archived'
 */
const getContestRuntimeState = (contest) => {
  if (!contest) return null;
  if (contest.status === 'archived') return 'archived';
  if (contest.status === 'draft') return 'draft';

  const now = new Date();
  const startTime = new Date(contest.startTime || contest.start_time);
  const endTime = new Date(contest.endTime || contest.end_time);

  if (now < startTime) {
    return 'upcoming';
  } else if (now >= startTime && now < endTime) {
    return 'running';
  } else {
    return 'ended';
  }
};

/**
 * Check if a contest's lifecycle fields are locked against mutation
 * @param {string} runtimeState - 'draft' | 'upcoming' | 'running' | 'ended' | 'archived'
 * @returns {boolean}
 */
const isLifecycleMutationLocked = (runtimeState) => {
  return runtimeState === 'running' || runtimeState === 'ended' || runtimeState === 'archived';
};

/**
 * Get structured error message for locked lifecycle mutation
 * @param {string} runtimeState
 * @returns {string}
 */
const getLifecycleLockMessage = (runtimeState) => {
  if (runtimeState === 'running') {
    return 'Cannot modify contest lifecycle while the contest is running.';
  } else if (runtimeState === 'ended') {
    return 'Cannot modify contest lifecycle after the contest has ended.';
  } else if (runtimeState === 'archived') {
    return 'Cannot modify contest lifecycle for an archived contest.';
  }
  return 'Cannot modify contest lifecycle in current state.';
};

/**
 * Get structured error message for locked contest-problem mutation
 * @param {string} runtimeState
 * @returns {string}
 */
const getProblemMutationLockMessage = (runtimeState) => {
  if (runtimeState === 'running') {
    return 'Cannot modify problems while the contest is running.';
  } else if (runtimeState === 'ended') {
    return 'Cannot modify problems after the contest has ended.';
  } else if (runtimeState === 'archived') {
    return 'Cannot modify problems for an archived contest.';
  }
  return 'Cannot modify contest problems in current state.';
};

/**
 * Check if an authenticated user has permission to manage a resource (contest or problem)
 * @param {Object} user - Authenticated user object ({ id, role })
 * @param {Object|number|string} resource - Resource object or creator ID directly
 * @returns {boolean}
 */
const canManageResource = (user, resource) => {
  if (!user || resource === undefined || resource === null) return false;

  let creatorId;
  if (typeof resource === 'number' || typeof resource === 'string') {
    creatorId = parseInt(resource, 10);
  } else {
    creatorId = resource.createdBy !== undefined ? resource.createdBy : resource.created_by;
  }

  // Super Admin & Contest Admin have platform-wide management permissions
  if (user.role === 'super_admin' || user.role === 'contest_admin') {
    return true;
  }

  // Professor can only manage their own creations
  if (user.role === 'professor' && creatorId === user.id) {
    return true;
  }

  return false;
};

/**
 * Format and enrich contest object with runtimeState and clean camelCase fields
 * @param {Object} contest
 * @returns {Object}
 */
const formatContest = (contest) => {
  if (!contest) return null;
  const runtimeState = getContestRuntimeState(contest);

  return {
    id: contest.id,
    title: contest.title,
    description: contest.description,
    startTime: contest.startTime || contest.start_time,
    endTime: contest.endTime || contest.end_time,
    status: contest.status,
    runtimeState,
    createdBy: contest.createdBy || contest.created_by,
    creatorUsername: contest.creatorUsername || contest.creator_username,
    problemCount: contest.problemCount !== undefined ? parseInt(contest.problemCount, 10) : undefined,
    participantCount: contest.participantCount !== undefined ? parseInt(contest.participantCount, 10) : undefined,
    isRated: contest.isRated !== undefined ? contest.isRated : (contest.is_rated !== undefined ? contest.is_rated : true),
    isRatingFinalized: contest.isRatingFinalized !== undefined ? contest.isRatingFinalized : (contest.is_rating_finalized || false),
    ratingsFinalizedAt: contest.ratingsFinalizedAt || contest.ratings_finalized_at || null,
    leaderboardFreezeEnabled: contest.leaderboardFreezeEnabled !== undefined ? contest.leaderboardFreezeEnabled : (contest.leaderboard_freeze_enabled || false),
    leaderboardFreezeMinutes: contest.leaderboardFreezeMinutes !== undefined ? parseInt(contest.leaderboardFreezeMinutes, 10) : (contest.leaderboard_freeze_minutes ? parseInt(contest.leaderboard_freeze_minutes, 10) : 60),
    createdAt: contest.createdAt || contest.created_at,
    updatedAt: contest.updatedAt || contest.updated_at,
  };
};

/**
 * Determine if a contest is editable based on its runtime state
 * @param {Object} contest
 * @returns {{ editable: boolean, reason?: string }}
 */
const isContestEditable = (contest) => {
  if (!contest) return { editable: false, reason: 'Contest not found' };
  const runtimeState = getContestRuntimeState(contest);
  if (runtimeState === 'draft' || runtimeState === 'upcoming') {
    return { editable: true };
  }
  return {
    editable: false,
    reason: getLifecycleLockMessage(runtimeState),
  };
};

/**
 * Determine available lifecycle actions for a contest and user
 * @param {Object} contest
 * @param {Object} user
 * @returns {Object}
 */
const getAvailableLifecycleActions = (contest, user) => {
  if (!contest || !user) {
    return { canPublish: false, canUnpublish: false, canArchive: false, canEdit: false };
  }

  const hasPermission = canManageResource(user, contest);
  if (!hasPermission) {
    return { canPublish: false, canUnpublish: false, canArchive: false, canEdit: false };
  }

  const runtimeState = getContestRuntimeState(contest);
  const status = contest.status || 'draft';

  const canPublish = status === 'draft';
  const canUnpublish = status === 'published' && runtimeState === 'upcoming';
  const canArchive = status !== 'archived' && runtimeState !== 'running';
  const canEdit = runtimeState === 'draft' || runtimeState === 'upcoming';

  return {
    canPublish,
    canUnpublish,
    canArchive,
    canEdit,
    runtimeState,
    status,
  };
};

module.exports = {
  getContestRuntimeState,
  isLifecycleMutationLocked,
  getLifecycleLockMessage,
  getProblemMutationLockMessage,
  canManageResource,
  formatContest,
  isContestEditable,
  getAvailableLifecycleActions,
};