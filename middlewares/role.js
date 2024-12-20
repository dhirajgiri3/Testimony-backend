import AppError from '../utils/appError.js';

/**
 * Middleware to authorize user roles.
 * Accepts either a list of roles or an array of roles.
 * @param  {...string|Array<string>} roles - Allowed roles
 */
export const authorize = (...roles) => {
  // Handle case where the first argument is an array of roles
  const allowedRoles = Array.isArray(roles[0]) ? roles[0] : roles;

  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

/**
 * Middleware to handle role-based access control
 * @param {Array} allowedRoles - Array of allowed roles
 */
export const roleBasedAccessControl = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Access denied: insufficient permissions', 403));
    }
    next();
  };
};
