import { queryAll, queryOne, execute, nowIso } from '../db/sqlite.js';
import { verifyAuthToken } from '../services/crypto.js';
import { VISIBLE_PERMISSION_KEYS } from '../config/permissions.js';

export async function getUserWithPermissions(userId) {
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const isModerator = user.role === 'moderator';

  let permissions = [];
  if (isAdmin) {
    permissions = VISIBLE_PERMISSION_KEYS;
  } else if (isModerator) {
    const rows = await queryAll(
      `SELECT p.\`key\` AS perm_key
       FROM permissions p
       JOIN moderator_permissions mp ON mp.permission_id = p.id
       WHERE mp.user_id = ?`,
      [user.id]
    );
    permissions = rows.map((r) => r.perm_key);
  }

  return {
    ...sanitizeUser(user),
    is_admin: isAdmin,
    is_moderator: isModerator,
    permissions,
  };
}

export function sanitizeUser(user) {
  if (!user) return null;
  const copy = { ...user };
  delete copy.password;
  delete copy.remember_token;
  return copy;
}

export function extractBearerOrCookieToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies && req.cookies.easyplex_token) {
    return req.cookies.easyplex_token;
  }
  if (req.query && typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export async function attachAuthUser(req, _res, next) {
  try {
    const token = extractBearerOrCookieToken(req);
    if (token) {
      const payload = verifyAuthToken(token);
      if (payload && payload.sub) {
        const user = await getUserWithPermissions(payload.sub);
        if (user && Number(user.active) === 1) {
          req.user = user;
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      message: 'Unauthenticated.',
      error: 'Unauthenticated.',
    });
  }
  next();
}

export function requireAdminOrModerator(req, res, next) {
  if (!req.user) {
    return res.status(401)
      .set('X-Admin-Auth-Expired', 'true')
      .json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (!req.user.is_admin && !req.user.is_moderator) {
    return res.status(403).json({
      message: 'You do not have permission to access the admin panel.',
    });
  }
  next();
}

export function requireAdminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401)
      .set('X-Admin-Auth-Expired', 'true')
      .json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (!req.user.is_admin) {
    return res.status(403).json({
      message: 'Only administrators can perform this action.',
    });
  }
  next();
}

export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401)
        .set('X-Admin-Auth-Expired', 'true')
        .json({ message: 'Your session has expired. Please sign in again.' });
    }
    if (req.user.is_admin) {
      return next();
    }
    if (req.user.is_moderator && Array.isArray(req.user.permissions) && req.user.permissions.includes(permissionKey)) {
      return next();
    }
    return res.status(403).json({
      message: `Missing required permission: ${permissionKey}`,
    });
  };
}

export async function touchLastLogin(userId) {
  await execute(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), userId]);
}
