import AppError from '../utils/appError.js';

/**
 * Authorize user roles
 * @param  {...string} roles - Allowed roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
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
