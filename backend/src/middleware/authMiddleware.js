const { verifyToken, sanitizeUser } = require('../services/authService');
const UserModel = require('../models/userModel');

/**
 * Authentication middleware (Phase 5.9.10)
 * Verifies JWT from Authorization header and attaches sanitized active user to req.user
 * Returns standardized error contracts with error: AUTHENTICATION_ERROR and requestId.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const requestId = req.id || null;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: Access token is missing or malformed',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: Access token is required',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          status: 'error',
          statusCode: 401,
          error: 'AUTHENTICATION_ERROR',
          message: 'Unauthorized: Token has expired',
          requestId,
          timestamp: new Date().toISOString(),
        });
      }
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: Invalid authentication token',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    // Verify user still exists in database and is active
    const user = await UserModel.findUserById(decoded.userId);
    if (!user) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: User account no longer exists',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    if (!user.is_active) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: User account has been deactivated. Please contact an administrator.',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    req.user = sanitizeUser(user);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication middleware
 * Attaches sanitized user to req.user if a valid token is provided,
 * but allows the request to continue unauthenticated if no token is present.
 */
const optionalAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const decoded = verifyToken(token);
      const user = await UserModel.findUserById(decoded.userId);
      if (user && user.is_active) {
        req.user = sanitizeUser(user);
      } else {
        req.user = null;
      }
    } catch (err) {
      req.user = null;
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticate,
  optionalAuthenticate,
};
