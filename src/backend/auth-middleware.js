import { extractToken, verifyToken } from './session-utils.js';

/**
 * Middleware to require authentication
 * Verifies JWT token and attaches userId to request
 */
export function requireAuth(req, res, next) {
    const token = extractToken(req);

    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'NO_TOKEN'
        });
    }

    const payload = verifyToken(token);

    if (!payload) {
        return res.status(401).json({
            error: 'Invalid or expired token',
            code: 'INVALID_TOKEN'
        });
    }

    // Attach user info to request
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.userRole = payload.role;

    next();
}

/**
 * Optional auth middleware - doesn't require auth but attaches user if present
 */
export function optionalAuth(req, res, next) {
    const token = extractToken(req);

    if (token) {
        const payload = verifyToken(token);
        if (payload) {
            req.userId = payload.userId;
            req.userEmail = payload.email;
            req.userRole = payload.role;
        }
    }

    next();
}
