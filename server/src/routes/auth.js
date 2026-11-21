import { Router } from 'express';
import { env } from '../config/env.js';
import { SUPPORTED_LOCALES, LOCALE_MESSAGES } from '../config/locales.js';
import { VISIBLE_PERMISSION_KEYS, PERMISSION_DEFINITIONS } from '../config/permissions.js';
import { execute, nowIso, queryAll, queryOne, hasColumn } from '../db/mysql.js';
import { ensureAuxMySqlTables } from '../db/schema.js';
import { hashPassword, randomHex, signAuthToken, verifyPassword } from '../services/crypto.js';
import { getUserWithPermissions, requireAdminOrModerator, touchLastLogin } from '../middleware/auth.js';
import { makeAsyncRouter } from '../middleware/asyncHandler.js';

const router = makeAsyncRouter(Router());

function setAuthCookie(res, token) {
  res.cookie('easyplex_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

router.post(['/login', '/auth/login'], async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(422).json({ message: 'Email and password are required.' });
  }

  const user = await queryOne(`SELECT * FROM users WHERE lower(email) = ?`, [email]);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ message: 'These credentials do not match our records.' });
  }

  if (Number(user.active) !== 1) {
    return res.status(403).json({ message: 'This account has been suspended.' });
  }

  await touchLastLogin(user.id);
  const fullUser = await getUserWithPermissions(user.id);
  const token = signAuthToken(fullUser);
  setAuthCookie(res, token);

  return res.json({
    message: 'Signed in successfully.',
    token,
    user: fullUser,
  });
});

router.post(['/register', '/auth/register'], async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const passwordConfirmation = String(req.body?.password_confirmation ?? password);

  if (!name || !email || !password) {
    return res.status(422).json({ message: 'Name, email, and password are required.' });
  }
  if (password.length < 6) {
    return res.status(422).json({ message: 'Password must be at least 6 characters.' });
  }
  if (password !== passwordConfirmation) {
    return res.status(422).json({ message: 'Passwords do not match.' });
  }

  const existing = await queryOne(`SELECT id FROM users WHERE lower(email) = ?`, [email]);
  if (existing) {
    return res.status(422).json({ message: 'The email has already been taken.' });
  }

  const now = nowIso();
  const hasVerified = await hasColumn('users', 'verified');
  const resInsert = await execute(
    hasVerified
      ? `INSERT INTO users (role, name, email, premuim, verfied, verified, active, password, created_at, updated_at)
         VALUES ('user', ?, ?, 0, 0, 0, 1, ?, ?, ?)`
      : `INSERT INTO users (role, name, email, premuim, verfied, active, password, created_at, updated_at)
         VALUES ('user', ?, ?, 0, 0, 1, ?, ?, ?)`,
    [name, email, hashPassword(password), now, now]
  );

  const created = await getUserWithPermissions(Number(resInsert.lastInsertRowid));
  return res.status(201).json({
    message: 'Account registered successfully.',
    user: created,
  });
});

router.post(['/logout', '/auth/logout'], (_req, res) => {
  res.clearCookie('easyplex_token', { path: '/' });
  return res.json({ message: 'Logged out successfully.' });
});

router.post(['/password/email', '/auth/password/email'], async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(422).json({ message: 'Email is required.' });
  }
  const user = await queryOne(`SELECT id, email FROM users WHERE lower(email) = ?`, [email]);
  if (!user) {
    return res.status(404).json({ message: "We can't find a user with that email address." });
  }
  const token = randomHex(20);
  const now = nowIso();
  await execute(`DELETE FROM password_resets WHERE lower(email) = ?`, [email]);
  await execute(`INSERT INTO password_resets (email, token, created_at) VALUES (?, ?, ?)`, [email, token, now]);

  return res.json({
    message: 'Password reset link generated (local dev mode).',
    reset_token: token,
  });
});

router.post(['/password/reset', '/auth/password/reset'], async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.password_confirmation ?? password);

  if (!email || !token || !password) {
    return res.status(422).json({ message: 'Email, token, and password are required.' });
  }
  if (password !== confirm) {
    return res.status(422).json({ message: 'Passwords do not match.' });
  }

  const resetRow = await queryOne(`SELECT * FROM password_resets WHERE lower(email) = ? AND token = ?`, [email, token]);
  if (!resetRow) {
    return res.status(422).json({ message: 'This password reset token is invalid.' });
  }

  await execute(`UPDATE users SET password = ?, updated_at = ? WHERE lower(email) = ?`, [hashPassword(password), nowIso(), email]);
  await execute(`DELETE FROM password_resets WHERE lower(email) = ?`, [email]);

  return res.json({ message: 'Your password has been reset!' });
});

router.post(['/email/verify', '/auth/email/verify'], async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(422).json({ message: 'Email is required.' });
  }
  const now = nowIso();
  const hasVerified = await hasColumn('users', 'verified');
  const result = await execute(
    hasVerified
      ? `UPDATE users SET verfied = 1, verified = 1, email_verified_at = ?, updated_at = ? WHERE lower(email) = ?`
      : `UPDATE users SET verfied = 1, email_verified_at = ?, updated_at = ? WHERE lower(email) = ?`,
    [now, now, email]
  );
  if (result.changes === 0) {
    return res.status(404).json({ message: 'User not found.' });
  }
  return res.json({ message: 'Email verified successfully.' });
});

router.post(['/email/resend', '/auth/email/resend'], (_req, res) => {
  return res.json({ message: 'Verification email dispatched (local mode).' });
});

router.get('/admin/session/keep-alive', requireAdminOrModerator, (_req, res) => {
  return res.json({
    status: 200,
    message: 'Admin session refreshed.',
    expires_in: 7 * 24 * 60 * 60,
  });
});

router.get('/admin/auth/profile', requireAdminOrModerator, (req, res) => {
  return res.json(req.user);
});

router.get('/admin/permissions', requireAdminOrModerator, async (_req, res) => {
  const perms = await queryAll(`SELECT id, \`key\`, module, action, label FROM permissions`);
  const byKey = Object.fromEntries(perms.map((p) => [p.key, p]));
  const grouped = Object.entries(PERMISSION_DEFINITIONS)
    .filter(([, def]) => !def.hidden)
    .map(([module, def]) => ({
      module,
      label: def.label,
      admin_only: Boolean(def.admin_only),
      permissions: def.actions.map((action) => byKey[`${module}.${action}`]).filter(Boolean),
    }));
  return res.json(grouped);
});

router.get('/admin/locale', (req, res) => {
  const current = SUPPORTED_LOCALES[req.cookies?.easyplex_locale] ? req.cookies.easyplex_locale : 'en';
  return res.json({
    current,
    fallback: 'en',
    supported: SUPPORTED_LOCALES,
    messages: LOCALE_MESSAGES[current] || LOCALE_MESSAGES.en,
  });
});

router.post('/admin/locale', (req, res) => {
  const locale = String(req.body?.locale || '').trim().toLowerCase();
  if (!SUPPORTED_LOCALES[locale]) {
    return res.status(422).json({ message: 'Unsupported locale selected.' });
  }
  res.cookie('easyplex_locale', locale, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax', path: '/' });
  return res.json({
    locale,
    supported: SUPPORTED_LOCALES,
    messages: LOCALE_MESSAGES[locale] || LOCALE_MESSAGES.en,
  });
});

// Installer routes
router.get('/installer-api/status', async (_req, res) => {
  await ensureAuxMySqlTables();
  const state = await queryOne(`SELECT * FROM installer_state ORDER BY id ASC LIMIT 1`);
  const settings = await queryOne(`SELECT app_name, url, tmdb_api_key FROM settings ORDER BY id ASC LIMIT 1`);
  return res.json({
    installed: Boolean(Number(state?.installed ?? 1)),
    installed_at: state?.installed_at || null,
    app_name: settings?.app_name || env.appName,
    app_url: settings?.url || env.appUrl,
    tmdb_configured: Boolean(settings?.tmdb_api_key),
    db_driver: `mysql (${env.dbHost || 'hyperdrive'}:${env.dbPort}/${env.dbDatabase})`,
    node_version: 'Cloudflare Pages (nodejs_compat)',
  });
});

router.get('/installer-api/requirements', async (_req, res) => {
  let mysqlOk = false;
  try {
    await queryOne('SELECT 1 AS ok');
    mysqlOk = true;
  } catch {
    mysqlOk = false;
  }
  const requirements = [
    { name: 'Cloudflare Pages Edge Runtime (nodejs_compat)', passed: true },
    { name: 'Remote MySQL2 Connection Driver', passed: mysqlOk },
    { name: 'Cloudflare R2 / MySQL File Storage', passed: true },
    { name: 'JSON & Crypto Engine', passed: true },
    { name: 'TMDB External API Fetch', passed: typeof fetch === 'function' },
  ];

  const storagePaths = [
    {
      folder: 'mysql',
      path: `${env.dbHost || 'hyperdrive'}:${env.dbPort}/${env.dbDatabase}`,
      writable: mysqlOk,
      permission: 'rw',
    },
    {
      folder: env.storageBucket ? 'cloudflare-r2' : 'mysql:uploaded_files',
      path: env.storageBucket ? 'R2 STORAGE_BUCKET Binding' : `${env.dbDatabase}.uploaded_files`,
      writable: mysqlOk,
      permission: 'rw',
    },
  ];

  return res.json({
    requirements,
    permissions: storagePaths,
    all_passed: requirements.every((r) => r.passed),
  });
});

router.post('/installer-api/finish', async (req, res) => {
  const appName = String(req.body?.app_name || 'EASYPLEX').trim() || 'EASYPLEX';
  const appUrl = String(req.body?.app_url || env.appUrl).trim();
  const tmdbApiKey = String(req.body?.tmdb_api_key || '').trim();
  const adminEmail = String(req.body?.admin_email || 'admin@easyplex.com').trim().toLowerCase();
  const adminName = String(req.body?.admin_name || 'admin').trim() || 'admin';
  const adminPassword = String(req.body?.admin_password || '').trim();
  const now = nowIso();

  await ensureAuxMySqlTables();

  const sRow = await queryOne(`SELECT id FROM settings ORDER BY id ASC LIMIT 1`);
  if (sRow) {
    await execute(
      `UPDATE settings SET app_name = ?, url = ?, tmdb_api_key = COALESCE(NULLIF(?, ''), tmdb_api_key), updated_at = ? WHERE id = ?`,
      [appName, appUrl, tmdbApiKey, now, sRow.id]
    );
  }

  const existingAdmin = await queryOne(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
  if (existingAdmin) {
    if (adminPassword) {
      await execute(
        `UPDATE users SET name = ?, email = ?, password = ?, updated_at = ? WHERE id = ?`,
        [adminName, adminEmail, hashPassword(adminPassword), now, existingAdmin.id]
      );
    } else {
      await execute(
        `UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?`,
        [adminName, adminEmail, now, existingAdmin.id]
      );
    }
  }

  const instRow = await queryOne(`SELECT id FROM installer_state ORDER BY id ASC LIMIT 1`);
  if (instRow) {
    await execute(
      `UPDATE installer_state SET installed = 1, installed_at = ?, app_name = ?, admin_email = ?, db_driver = 'mysql' WHERE id = ?`,
      [now, appName, adminEmail, instRow.id]
    );
  } else {
    await execute(
      `INSERT INTO installer_state (installed, installed_at, app_name, admin_email, db_driver) VALUES (1, ?, ?, ?, 'mysql')`,
      [now, appName, adminEmail]
    );
  }

  return res.json({
    message: 'EasyPlex installation configured successfully.',
    admin_email: adminEmail,
  });
});

export { VISIBLE_PERMISSION_KEYS };
export default router;
