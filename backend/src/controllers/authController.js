const UserModel = require('../models/userModel');
const AuditLogger = require('../services/auditLogger');
const { hashPassword, comparePassword, generateToken, sanitizeUser } = require('../services/authService');

/**
 * Register a new user
 * Strictly enforces 'student' role for public registration
 * 
 * @route POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { username, email, password, fullName } = req.body;

    // Check if email already exists
    const existingEmailUser = await UserModel.findUserByEmail(email);
    if (existingEmailUser) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'An account with this email address already exists',
      });
    }

    // Check if username already exists
    const existingUsernameUser = await UserModel.findUserByUsername(username);
    if (existingUsernameUser) {
      return res.status(409).json({
        status: 'error',
        statusCode: 409,
        message: 'This username is already taken. Please choose another.',
      });
    }

    // Hash password with bcrypt
    const passwordHash = await hashPassword(password);

    // Create user - Always force role to 'student'
    const newUser = await UserModel.createUser({
      username,
      email,
      passwordHash,
      fullName,
      role: 'student', // Enforce student role regardless of what client passes
    });

    // Audit log successful user registration
    await AuditLogger.logAction({
      actor: newUser,
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: newUser.id,
      outcome: 'success',
      metadata: { username: newUser.username, role: 'student' },
      req,
    });

    return res.status(201).json({
      message: 'Registration successful',
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Authenticate user and issue JWT
 * 
 * @route POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await UserModel.findUserByEmail(email);
    if (!user) {
      await AuditLogger.logAction({
        action: 'LOGIN_FAILURE',
        resourceType: 'user',
        outcome: 'failure',
        metadata: { attemptedEmail: email },
        req,
      });
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        message: 'Invalid email or password',
      });
    }

    // Check if account is active
    if (!user.is_active) {
      await AuditLogger.logAction({
        actor: user,
        action: 'LOGIN_FAILURE',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'denied',
        metadata: { reason: 'account_deactivated' },
        req,
      });
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

    // Compare password hash
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      await AuditLogger.logAction({
        actor: user,
        action: 'LOGIN_FAILURE',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'failure',
        metadata: { attemptedEmail: email },
        req,
      });
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        message: 'Invalid email or password',
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    await AuditLogger.logAction({
      actor: user,
      action: 'LOGIN_SUCCESS',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'success',
      req,
    });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
};
