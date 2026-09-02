/**
 * Role-Based Access Control (RBAC) middleware factory (Phase 5.9.10)
 * @param {...string} allowedRoles - List of authorized roles allowed to access the endpoint
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const requestId = req.id || null;

    if (!req.user) {
      res.locals.errorCategory = 'AUTHENTICATION_ERROR';
      return res.status(401).json({
        status: 'error',
        statusCode: 401,
        error: 'AUTHENTICATION_ERROR',
        message: 'Unauthorized: Authentication required before role authorization',
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.locals.errorCategory = 'AUTHORIZATION_ERROR';
      return res.status(403).json({
        status: 'error',
        statusCode: 403,
        error: 'AUTHORIZATION_ERROR',
        message: `Forbidden: Access denied. Your role '${req.user.role}' is not authorized to access this resource.`,
        requestId,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

module.exports = {
  authorizeRoles,
};
