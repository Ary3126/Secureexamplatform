/**
 * Admin Controller - Super Admin Privileged Operations
 * 
 * Provides secure endpoints for platform-wide audit log inspection
 * and administrative user, role, and account status management.
 */

const db = require('../config/db');
const UserModel = require('../models/userModel');
const AuditLogModel = require('../models/auditLogModel');
const AuditLogger = require('../services/auditLogger');
const { hashPassword, sanitizeUser } = require('../services/authService');
const { getContestRuntimeState } = require('../services/contestService');
const SystemHealthService = require('../services/systemHealthService');

let cachedJudgeHealth = null;
let lastJudgeCheck = 0;
const JUDGE_CACHE_TTL_MS = 60000;

const ALLOWED_ROLES = ['student', 'professor', 'contest_admin', 'super_admin'];

/**
 * Get paginated and filtered audit logs (Super Admin Only)
 * @route GET /api/admin/audit-logs
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const {
      actorId,
      action,
      resourceType,
      resourceId,
      outcome,
      from,
      to,
      page,
      limit,
    } = req.query;

    const result = await AuditLogModel.findAllAuditLogs({
      actorId,
      action,
      resourceType,
      resourceId,
      outcome,
      from,
      to,
      page,
      limit,
    });

    return res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List users with bounded pagination and filtering (Super Admin Only)
 * @route GET /api/admin/users
 */
const getUsers = async (req, res, next) => {
  try {
    const { page, limit, role, status, search } = req.query;

    const result = await UserModel.findAllUsers({
      page,
      limit,
      role,
      status,
      search,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        users: result.users,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single user by ID (Super Admin Only)
 * @route GET /api/admin/users/:id
 */
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr) || parseInt(idStr, 10) <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid user ID format. Must be a positive integer.',
      });
    }

    const user = await UserModel.findUserById(parseInt(idStr, 10));
    if (!user) {
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User with ID ${id} not found`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new user with administrative role and status (Super Admin Only)
 * @route POST /api/admin/users
 */
const createUser = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const {
      username,
      email,
      password,
      fullName,
      role = 'student',
      isActive = true,
      bio = '',
      avatarUrl = '',
      institution = '',
    } = req.body;

    // Validate username
    if (!username || typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: username must be between 3 and 50 characters.',
      });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: username can only contain alphanumeric characters, underscores, and hyphens.',
      });
    }

    // Validate email
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: email format is invalid.',
      });
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: password must be at least 8 characters long.',
      });
    }

    // Validate fullName
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: fullName is required.',
      });
    }

    // Validate role
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Validation failed: role must be one of: ${ALLOWED_ROLES.join(', ')}.`,
      });
    }

    // Validate isActive
    const normalizedIsActive = isActive === undefined ? true : Boolean(isActive);

    // Check duplicate username or email
    const existingEmail = await UserModel.findUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Resource conflict: A user with this email already exists.',
      });
    }

    const existingUsername = await UserModel.findUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'Resource conflict: A user with this username already exists.',
      });
    }

    const passwordHash = await hashPassword(password);

    await client.query('BEGIN');

    const newUser = await UserModel.createAdminUser(
      {
        username,
        email,
        passwordHash,
        fullName,
        role: normalizedRole,
        isActive: normalizedIsActive,
        bio,
        avatarUrl,
        institution,
      },
      client
    );

    // Audit log user creation
    await AuditLogger.logAction({
      actor: req.user,
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: newUser.id,
      outcome: 'success',
      metadata: {
        createdUserId: newUser.id,
        username: newUser.username,
        role: newUser.role,
        isActive: newUser.isActive,
      },
      req,
      client,
    });

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'success',
      message: 'User created successfully',
      data: {
        user: sanitizeUser(newUser),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Update user profile details (Super Admin Only)
 * Strictly whitelist mutable fields (no role or password changes allowed here)
 * @route PUT /api/admin/users/:id
 */
const updateUser = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr) || parseInt(idStr, 10) <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid user ID format. Must be a positive integer.',
      });
    }
    const targetId = parseInt(idStr, 10);

    const { username, email, fullName, bio, avatarUrl, institution } = req.body;

    // Validate fields if supplied
    if (username !== undefined) {
      if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 50 || !/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Validation failed: username must be 3-50 alphanumeric characters with hyphens/underscores.',
        });
      }
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Validation failed: email format is invalid.',
        });
      }
    }

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length === 0) {
        return res.status(400).json({
          status: 'error',
          statusCode: 400,
          message: 'Validation failed: fullName cannot be empty.',
        });
      }
    }

    await client.query('BEGIN');

    const targetUser = await UserModel.findUserByIdForUpdate(targetId, client);
    if (!targetUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User with ID ${id} not found`,
      });
    }

    // Check duplicate username if changing
    if (username && username.trim().toLowerCase() !== targetUser.username.toLowerCase()) {
      const dupUsername = await UserModel.findUserByUsername(username);
      if (dupUsername && dupUsername.id !== targetId) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'Resource conflict: Username is already in use by another user.',
        });
      }
    }

    // Check duplicate email if changing
    if (email && email.trim().toLowerCase() !== targetUser.email.toLowerCase()) {
      const dupEmail = await UserModel.findUserByEmail(email);
      if (dupEmail && dupEmail.id !== targetId) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'Resource conflict: Email is already in use by another user.',
        });
      }
    }

    const updatedUser = await UserModel.updateUserAdmin(
      targetId,
      {
        username,
        email,
        fullName,
        bio,
        avatarUrl,
        institution,
      },
      client
    );

    const updatedFields = Object.keys({ username, email, fullName, bio, avatarUrl, institution }).filter(
      (k) => req.body[k] !== undefined
    );

    await AuditLogger.logAction({
      actor: req.user,
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: targetId,
      outcome: 'success',
      metadata: {
        targetUserId: targetId,
        updatedFields,
      },
      req,
      client,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: 'User updated successfully',
      data: {
        user: sanitizeUser(updatedUser),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Update user role (Super Admin Only)
 * Includes Last Active Super Admin self-lockout protection
 * @route PATCH /api/admin/users/:id/role
 */
const updateUserRole = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr) || parseInt(idStr, 10) <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid user ID format. Must be a positive integer.',
      });
    }
    const targetId = parseInt(idStr, 10);

    const { role } = req.body;
    if (!role || typeof role !== 'string') {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: role is required.',
      });
    }

    const newRole = role.trim().toLowerCase();
    if (!ALLOWED_ROLES.includes(newRole)) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: `Validation failed: role must be one of: ${ALLOWED_ROLES.join(', ')}.`,
      });
    }

    await client.query('BEGIN');

    const targetUser = await UserModel.findUserByIdForUpdate(targetId, client);
    if (!targetUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User with ID ${id} not found`,
      });
    }

    // Super Admin Self-Protection: Cannot demote the last active Super Admin
    if (targetUser.role === 'super_admin' && newRole !== 'super_admin') {
      const activeSuperAdminCount = await UserModel.countActiveSuperAdmins(client, true);
      if (activeSuperAdminCount <= 1) {
        await client.query('ROLLBACK');

        await AuditLogger.logAction({
          actor: req.user,
          action: 'ADMIN_ACTION_DENIED',
          resourceType: 'user',
          resourceId: targetId,
          outcome: 'denied',
          metadata: {
            attemptedAction: 'ROLE_CHANGED',
            targetUserId: targetId,
            reason: 'last_active_super_admin',
          },
          req,
        });

        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'Conflict: Cannot demote the last active Super Admin account.',
        });
      }
    }

    const updatedUser = await UserModel.updateUserRole(targetId, newRole, client);

    await AuditLogger.logAction({
      actor: req.user,
      action: 'ROLE_CHANGED',
      resourceType: 'user',
      resourceId: targetId,
      outcome: 'success',
      metadata: {
        targetUserId: targetId,
        previousRole: targetUser.role,
        newRole,
      },
      req,
      client,
    });

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: 'User role updated successfully',
      data: {
        user: sanitizeUser(updatedUser),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Update user account status (Super Admin Only)
 * Includes Last Active Super Admin self-lockout protection
 * @route PATCH /api/admin/users/:id/status
 */
const updateUserStatus = async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!/^\d+$/.test(idStr) || parseInt(idStr, 10) <= 0) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Invalid user ID format. Must be a positive integer.',
      });
    }
    const targetId = parseInt(idStr, 10);

    const { isActive } = req.body;
    if (isActive === undefined || (typeof isActive !== 'boolean' && isActive !== 'true' && isActive !== 'false')) {
      return res.status(400).json({
        status: 'error',
        statusCode: 400,
        message: 'Validation failed: isActive must be a boolean value (true or false).',
      });
    }

    const newIsActive = typeof isActive === 'boolean' ? isActive : isActive === 'true';

    await client.query('BEGIN');

    const targetUser = await UserModel.findUserByIdForUpdate(targetId, client);
    if (!targetUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: `User with ID ${id} not found`,
      });
    }

    // Super Admin Self-Protection: Cannot deactivate the last active Super Admin
    if (targetUser.role === 'super_admin' && targetUser.is_active && !newIsActive) {
      const activeSuperAdminCount = await UserModel.countActiveSuperAdmins(client, true);
      if (activeSuperAdminCount <= 1) {
        await client.query('ROLLBACK');

        await AuditLogger.logAction({
          actor: req.user,
          action: 'ADMIN_ACTION_DENIED',
          resourceType: 'user',
          resourceId: targetId,
          outcome: 'denied',
          metadata: {
            attemptedAction: 'ACCOUNT_STATUS_CHANGED',
            targetUserId: targetId,
            reason: 'last_active_super_admin',
          },
          req,
        });

        return res.status(409).json({
          status: 'error',
          statusCode: 409,
          message: 'Conflict: Cannot deactivate the last active Super Admin account.',
        });
      }
    }

    const updatedUser = await UserModel.updateUserStatus(targetId, newIsActive, client);

    // Audit log status change
    await AuditLogger.logAction({
      actor: req.user,
      action: 'ACCOUNT_STATUS_CHANGED',
      resourceType: 'user',
      resourceId: targetId,
      outcome: 'success',
      metadata: {
        targetUserId: targetId,
        previousStatus: targetUser.is_active,
        newStatus: newIsActive,
      },
      req,
      client,
    });

    // If deactivating, also record USER_DEACTIVATED audit event
    if (!newIsActive && targetUser.is_active) {
      await AuditLogger.logAction({
        actor: req.user,
        action: 'USER_DEACTIVATED',
        resourceType: 'user',
        resourceId: targetId,
        outcome: 'success',
        metadata: {
          targetUserId: targetId,
          deactivatedBy: req.user.id,
        },
        req,
        client,
      });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'success',
      message: 'User account status updated successfully',
      data: {
        user: sanitizeUser(updatedUser),
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

/**
 * Get aggregated platform overview metrics (Super Admin Only)
 * @route GET /api/admin/overview-stats
 */
const getOverviewStats = async (req, res, next) => {
  try {
    const t0 = process.hrtime.bigint();

    // 1. User metrics
    const userStatsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS total_users,
        COUNT(CASE WHEN role = 'student' THEN 1 END)::int AS total_students,
        COUNT(CASE WHEN role = 'professor' THEN 1 END)::int AS total_professors,
        COUNT(CASE WHEN role = 'super_admin' THEN 1 END)::int AS total_admins,
        COUNT(CASE WHEN is_active = true THEN 1 END)::int AS active_users,
        COUNT(CASE WHEN is_active = false THEN 1 END)::int AS total_suspended
      FROM users;
    `);

    // 2. Contest metrics
    const contestStatsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS total_contests,
        COUNT(CASE WHEN status = 'published' AND start_time <= NOW() AND end_time > NOW() THEN 1 END)::int AS active_contests,
        COUNT(CASE WHEN status = 'published' AND start_time > NOW() THEN 1 END)::int AS upcoming_contests,
        COUNT(CASE WHEN status = 'draft' THEN 1 END)::int AS draft_contests,
        COUNT(CASE WHEN status = 'archived' THEN 1 END)::int AS archived_contests
      FROM contests;
    `);

    // 3. Active and upcoming contests list (max 6)
    const recentContestsRes = await db.query(`
      SELECT 
        c.id, 
        c.title, 
        c.start_time AS "startTime", 
        c.end_time AS "endTime", 
        c.status,
        COUNT(DISTINCT part.user_id)::int AS "participantCount"
      FROM contests c
      LEFT JOIN contest_participants part ON c.id = part.contest_id
      WHERE c.status != 'archived'
      GROUP BY c.id
      ORDER BY 
        CASE 
          WHEN c.status = 'published' AND c.start_time <= NOW() AND c.end_time > NOW() THEN 1
          WHEN c.status = 'published' AND c.start_time > NOW() THEN 2
          ELSE 3
        END,
        c.start_time ASC
      LIMIT 6;
    `);

    const formattedContests = recentContestsRes.rows.map((c) => ({
      id: c.id,
      title: c.title,
      startTime: c.startTime,
      endTime: c.endTime,
      status: c.status,
      runtimeState: getContestRuntimeState(c),
      participantCount: Number(c.participantCount) || 0,
    }));

    // 4. Problem metrics
    const probStatsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS total_problems,
        COUNT(CASE WHEN is_published = true THEN 1 END)::int AS published_problems,
        COUNT(CASE WHEN review_status = 'draft' THEN 1 END)::int AS draft_problems,
        COUNT(CASE WHEN review_status = 'review_requested' OR review_status = 'in_review' THEN 1 END)::int AS pending_review_problems,
        COUNT(CASE WHEN review_status = 'approved' THEN 1 END)::int AS approved_problems,
        COUNT(CASE WHEN review_status = 'archived' THEN 1 END)::int AS archived_problems
      FROM problems;
    `);

    // 5. Review queue metrics
    const reviewStatsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS total_queue,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending_reviews,
        COUNT(CASE WHEN status = 'in_review' THEN 1 END)::int AS in_review_reviews,
        COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS approved_reviews
      FROM problem_reviews;
    `);

    // 6. Submission metrics (evaluated non-sample submissions)
    const subStatsRes = await db.query(`
      SELECT 
        COUNT(*)::int AS total_submissions,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END)::int AS accepted_submissions,
        COUNT(CASE WHEN status = 'wrong_answer' THEN 1 END)::int AS wrong_answer_submissions,
        COUNT(CASE WHEN status = 'runtime_error' THEN 1 END)::int AS runtime_error_submissions,
        COUNT(CASE WHEN status = 'compilation_error' THEN 1 END)::int AS compilation_error_submissions,
        COUNT(CASE WHEN status IN ('time_limit_exceeded', 'memory_limit_exceeded') THEN 1 END)::int AS resource_limit_submissions
      FROM submissions
      WHERE is_sample_run = false;
    `);

    const subRow = subStatsRes.rows[0] || {};
    const acceptedSubs = subRow.accepted_submissions || 0;
    const evaluatedSubs = (subRow.accepted_submissions || 0) +
      (subRow.wrong_answer_submissions || 0) +
      (subRow.runtime_error_submissions || 0) +
      (subRow.compilation_error_submissions || 0) +
      (subRow.resource_limit_submissions || 0);
    const acceptanceRate = evaluatedSubs > 0 ? Math.round((acceptedSubs / evaluatedSubs) * 100) : 0;
    const formattedSubmissions = {
      ...subRow,
      acceptance_rate: acceptanceRate,
    };

    // 7. Recent audit activity (sanitized: only non-sensitive columns)
    const recentAuditRes = await db.query(`
      SELECT a.id, a.action, a.resource_type, a.resource_id, a.outcome, a.created_at,
             u.username AS actor_name, u.role AS actor_role
      FROM audit_logs a
      LEFT JOIN users u ON a.actor_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 10;
    `);

    const dbDurationMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;

    // 8. System Health check (cached judge compilers)
    let judgeHealth = cachedJudgeHealth;
    if (!judgeHealth || Date.now() - lastJudgeCheck > JUDGE_CACHE_TTL_MS) {
      try {
        judgeHealth = await SystemHealthService.checkJudgeHealth();
        cachedJudgeHealth = judgeHealth;
        lastJudgeCheck = Date.now();
      } catch {
        judgeHealth = { status: 'DEGRADED', message: 'Compiler check pending' };
      }
    }

    return res.status(200).json({
      status: 'success',
      data: {
        users: userStatsRes.rows[0],
        contests: contestStatsRes.rows[0],
        recentContests: formattedContests,
        problems: probStatsRes.rows[0],
        submissions: formattedSubmissions,
        reviews: reviewStatsRes.rows[0],
        recentActivity: recentAuditRes.rows,
        system: {
          databaseStatus: 'connected',
          apiStatus: 'HEALTHY',
          databaseLatencyMs: dbDurationMs,
          judgeStatus: judgeHealth?.status || 'HEALTHY',
          judgeMessage: judgeHealth?.message || 'Compilers available',
          compilers: judgeHealth?.compilers || {},
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAuditLogs,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  updateUserRole,
  updateUserStatus,
  getOverviewStats,
};
