import { ApiError } from '../utils/ApiError.js';

/**
 * Factory function: only allows listed roles to proceed.
 * Usage: requireRole(['SuperUser', 'HR'])
 */
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError(403, `Access denied. Required roles: ${roles.join(', ')}`)
      );
    }
    next();
  };
};

// Alias for backward compatibility
export const authorizeRoles = (...roles) => requireRole(roles);

// ── ROLE GROUP CONSTANTS ──
export const ADMIN_ROLES = ['SuperUser', 'HR'];
export const MANAGEMENT_ROLES = ['SuperUser', 'HR', 'Director', 'VP', 'GM'];
export const CAN_CREATE_EMPLOYEE = ['SuperUser', 'HR', 'Director', 'VP', 'GM'];
export const CAN_EDIT_EMPLOYEE = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'];
export const ALL_ROLES = ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM', 'Employee', 'Intern'];

export const isManagementRole = (role) =>
  ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM'].includes(role);
