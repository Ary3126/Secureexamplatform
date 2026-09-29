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
 * Authoritative Freeze State determination
 * Derives freeze status from server-authoritative time, contest lifecycle,
 * freeze configuration, and finalization status.
 *
 * @param {Object} contest - Contest object (raw DB row or formatted)
 * @param {Date} [serverTime=new Date()] - Authoritative server timestamp
 * @returns {{ isFrozen: boolean, freezeState: 'NOT_FROZEN'|'FROZEN'|'FINAL', freezeTime: Date|null, freezeMinutes: number, serverTime: Date }}
 */
const getContestFreezeState = (contest, serverTime = new Date()) => {
  const authoritativeTime = serverTime instanceof Date && !isNaN(serverTime.getTime()) ? serverTime : new Date();

  if (!contest) {
    return {
      isFrozen: false,
      freezeState: 'NOT_FROZEN',
      freezeTime: null,
      freezeMinutes: 60,
      serverTime: authoritativeTime,
    };
  }

  const isFinalized = Boolean(
    contest.isRatingFinalized !== undefined ? contest.isRatingFinalized : contest.is_rating_finalized
  );
  if (isFinalized) {
    return {
      isFrozen: false,
      freezeState: 'FINAL',
      freezeTime: null,
      freezeMinutes: 0,
      serverTime: authoritativeTime,
    };
  }

  const freezeEnabled = Boolean(
    contest.leaderboardFreezeEnabled !== undefined
      ? contest.leaderboardFreezeEnabled
      : contest.leaderboard_freeze_enabled
  );

  const startTime = new Date(contest.startTime || contest.start_time);
  const endTime = new Date(contest.endTime || contest.end_time);

  const rawMinutes =
    contest.leaderboardFreezeMinutes !== undefined
      ? contest.leaderboardFreezeMinutes
      : contest.leaderboard_freeze_minutes;
  const freezeMinutes =
    rawMinutes !== undefined && rawMinutes !== null
      ? Math.max(0, parseInt(rawMinutes, 10) || 0)
      : 60;

  if (isNaN(endTime.getTime())) {
    return {
      isFrozen: false,
      freezeState: 'NOT_FROZEN',
      freezeTime: null,
      freezeMinutes,
      serverTime: authoritativeTime,
    };
  }

  // Calculate freeze start time, clamped so it does not precede start time
  const calculatedFreezeTimeMs = endTime.getTime() - freezeMinutes * 60000;
  const clampedFreezeTimeMs = !isNaN(startTime.getTime())
    ? Math.max(startTime.getTime(), calculatedFreezeTimeMs)
    : calculatedFreezeTimeMs;
  const freezeTime = new Date(clampedFreezeTimeMs);

  const nowMs = authoritativeTime.getTime();
  const startMs = !isNaN(startTime.getTime()) ? startTime.getTime() : null;
  const endMs = endTime.getTime();

  // Freeze applies only when enabled, freezeMinutes > 0, within [freezeTime, endTime], and contest is running/started
  const isWithinFreezeWindow =
    freezeEnabled &&
    freezeMinutes > 0 &&
    nowMs >= clampedFreezeTimeMs &&
    nowMs <= endMs &&
    (startMs === null || nowMs >= startMs);

  return {
    isFrozen: isWithinFreezeWindow,
    freezeState: isWithinFreezeWindow ? 'FROZEN' : 'NOT_FROZEN',
    freezeTime,
    freezeMinutes,
    serverTime: authoritativeTime,
  };
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
  getContestFreezeState,
  isLifecycleMutationLocked,
  getLifecycleLockMessage,
  getProblemMutationLockMessage,
  canManageResource,
  formatContest,
  isContestEditable,
  getAvailableLifecycleActions,
};