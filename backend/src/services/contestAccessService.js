/**
 * Contest Access & Eligibility Service (Phase 7.5.7.6)
 * Server-authoritative layer determining access, student eligibility,
 * and participation rights for contests.
 */

const { getContestRuntimeState, canManageResource } = require('./contestService');

/**
 * Validate student-specific eligibility criteria
 * ExamForge model rules:
 * 1. Must be an authenticated user
 * 2. User account must be active (is_active !== false)
 * 3. User role must be 'student' (professors and administrators cannot participate as competitors)
 * Note: Institutional, department, and CGPA restrictions are not in current schema (reserved for future scope).
 *
 * @param {Object} user - Sanitized user object { id, role, isActive, is_active }
 * @param {Object} contest - Contest record
 * @returns {{ eligible: boolean, accountActive: boolean, validRole: boolean, reasons: string[] }}
 */
const validateStudentEligibility = (user, contest) => {
  const reasons = [];

  if (!user) {
    return {
      eligible: false,
      accountActive: false,
      validRole: false,
      reasons: ['User authentication is required.'],
    };
  }

  const accountActive = Boolean(
    (user.isActive !== undefined ? user.isActive : (user.is_active !== undefined ? user.is_active : true))
  );

  if (!accountActive) {
    reasons.push('User account is deactivated or inactive.');
  }

  const validRole = user.role === 'student';
  if (!validRole) {
    reasons.push('Only student accounts are eligible to participate as competitors.');
  }

  const eligible = accountActive && validRole;

  return {
    eligible,
    accountActive,
    validRole,
    reasons,
  };
};

/**
 * Validate contest-specific access and visibility
 * ExamForge model rules:
 * 1. Draft contests are private (only visible and manageable by creators and admins)
 * 2. Published contests are visible to all authenticated users
 * 3. Archived contests are visible in read-only mode
 * 4. Runtime state dictates whether registration and participation are open
 *
 * @param {Object} user - Authenticated user object
 * @param {Object} contest - Contest record
 * @param {Date} [now=new Date()] - Server authoritative time
 * @returns {{ allowed: boolean, runtimeState: string, contestPublished: boolean, lifecycleValid: boolean, registrationOpen: boolean, reasons: string[] }}
 */
const validateContestAccess = (user, contest, now = new Date()) => {
  const reasons = [];

  if (!contest) {
    return {
      allowed: false,
      runtimeState: 'draft',
      contestPublished: false,
      lifecycleValid: false,
      registrationOpen: false,
      reasons: ['Contest not found.'],
    };
  }

  const status = contest.status || 'draft';
  const isDraft = status === 'draft';
  const isArchived = status === 'archived';
  const isPublished = status === 'published';

  const runtimeState = getContestRuntimeState(contest);

  let allowed = true;

  if (isDraft) {
    const isManager = Boolean(user && canManageResource(user, contest));
    if (!isManager) {
      allowed = false;
      reasons.push('Contest is unpublished (draft). Access is restricted to contest managers.');
    }
  }

  const registrationOpen = isPublished && (runtimeState === 'upcoming' || runtimeState === 'running');
  const lifecycleValid = isPublished && (runtimeState === 'upcoming' || runtimeState === 'running');

  if (runtimeState === 'ended') {
    reasons.push('Contest has ended. Registration and submissions are closed.');
  } else if (runtimeState === 'archived' || isArchived) {
    reasons.push('Contest is archived. Registration and submissions are closed.');
  } else if (isDraft) {
    reasons.push('Contest is not published. Registration is not open.');
  }

  return {
    allowed,
    runtimeState,
    contestPublished: isPublished,
    lifecycleValid,
    registrationOpen,
    reasons,
  };
};

/**
 * Authoritatively evaluate full contest access and student eligibility
 *
 * @param {Object} user - Sanitized user object
 * @param {Object} contest - Contest record
 * @param {boolean} [isEnrolled=false] - Whether user is in contest_participants
 * @param {Date} [now=new Date()] - Server authoritative time
 * @returns {Object} Comprehensive evaluation result
 */
const evaluateContestAccessAndEligibility = (user, contest, isEnrolled = false, now = new Date()) => {
  const access = validateContestAccess(user, contest, now);
  const eligibility = validateStudentEligibility(user, contest);

  const reasons = [];

  // If not allowed to access contest, that's primary
  if (!access.allowed) {
    reasons.push(...access.reasons);
  }

  // If student is ineligible
  if (!eligibility.eligible) {
    reasons.push(...eligibility.reasons);
  }

  const alreadyEnrolled = Boolean(isEnrolled);

  // Can the user register now?
  // Must be allowed to view, eligible as student, registration open, and not already enrolled
  const canRegister = Boolean(
    access.allowed &&
    eligibility.eligible &&
    access.registrationOpen &&
    !alreadyEnrolled
  );

  // Can the user participate/submit code now?
  // Must be allowed, eligible, enrolled, and contest must be in 'running' state
  const canParticipate = Boolean(
    access.allowed &&
    eligibility.eligible &&
    alreadyEnrolled &&
    access.runtimeState === 'running'
  );

  // Informative lifecycle / enrollment notes in reasons if applicable
  if (alreadyEnrolled) {
    reasons.push('User is already enrolled in this contest.');
  } else if (access.registrationOpen && !eligibility.eligible) {
    // Already covered in eligibility reasons
  } else if (!access.registrationOpen && access.allowed) {
    // Add access reasons if not already added
    access.reasons.forEach((r) => {
      if (!reasons.includes(r)) reasons.push(r);
    });
  }

  if (alreadyEnrolled && access.runtimeState === 'upcoming') {
    reasons.push('Contest has not started yet. Problem submission will open at contest start time.');
  }

  return {
    contestId: contest ? contest.id : null,
    userId: user ? user.id : null,
    allowed: access.allowed,
    eligible: eligibility.eligible,
    canRegister,
    canParticipate,
    isEnrolled: alreadyEnrolled,
    runtimeState: access.runtimeState,
    reasons: [...new Set(reasons)],
    status: {
      accountActive: eligibility.accountActive,
      validRole: eligibility.validRole,
      contestPublished: access.contestPublished,
      lifecycleValid: access.lifecycleValid,
      registrationOpen: access.registrationOpen,
      alreadyEnrolled,
    },
  };
};

/**
 * Validate target student for administrative enrollment operations (Phase 7.5.7.4 / 7.5.7.5)
 *
 * @param {Object} targetStudent - Target student user record
 * @param {Object} contest - Contest record
 * @returns {{ valid: boolean, statusCode: number, message?: string }}
 */
const validateTargetStudentForEnrollment = (targetStudent, contest) => {
  if (!contest) {
    return { valid: false, statusCode: 404, message: 'Contest not found' };
  }

  const runtimeState = getContestRuntimeState(contest);
  if (runtimeState === 'archived' || contest.status === 'archived') {
    return { valid: false, statusCode: 409, message: 'Cannot add participants: Contest is archived' };
  }

  if (runtimeState === 'ended') {
    return { valid: false, statusCode: 409, message: 'Cannot add participants: Contest has already ended' };
  }

  if (!targetStudent) {
    return { valid: false, statusCode: 404, message: 'Student not found' };
  }

  if (targetStudent.role !== 'student') {
    return {
      valid: false,
      statusCode: 400,
      message: `Cannot add user '${targetStudent.username}' as participant: Only student accounts can participate as competitors`,
    };
  }

  const isActive = Boolean(
    targetStudent.isActive !== undefined ? targetStudent.isActive : (targetStudent.is_active !== undefined ? targetStudent.is_active : true)
  );

  if (!isActive) {
    return {
      valid: false,
      statusCode: 400,
      message: `Cannot add student '${targetStudent.username}': User account is inactive`,
    };
  }

  return { valid: true, statusCode: 200 };
};

module.exports = {
  validateStudentEligibility,
  validateContestAccess,
  evaluateContestAccessAndEligibility,
  validateTargetStudentForEnrollment,
};
