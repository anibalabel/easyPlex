import { Router } from 'express';
import {
  clearCachedDbDefaults,
  clearCachedKvDbConfig,
  env,
  getActiveKvDbConfig,
  setCachedKvDbConfig,
} from '../config/env.js';
import { SUPPORTED_LOCALES, LOCALE_MESSAGES } from '../config/locales.js';
import { VISIBLE_PERMISSION_KEYS, PERMISSION_DEFINITIONS } from '../config/permissions.js';
import {
  clearSchemaCache,
  execute,
  hasColumn,
  nowIso,
  queryAll,
  queryOne,
  testDirectConnection,
} from '../db/mysql.js';
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

// Remote MySQL Setup & Connection Diagnostics Wizard
function activeDbSource() {
  if (env.hyperdrive) return 'hyperdrive';
  if (getActiveKvDbConfig()?.host) return 'kv';
  if (env.dbHost && env.dbDatabase && env.dbUsername) return 'env';
  return 'none';
}

router.get('/installer-api/status', async (_req, res) => {
  const source = activeDbSource();
  const check = await testDirectConnection();
  return res.json({
    connected: check.ok,
    configured: source !== 'none',
    source,
    kv_bound: Boolean(env.configKv),
    hyperdrive_bound: Boolean(env.hyperdrive),
    host: env.dbHost || (env.hyperdrive ? 'HYPERDRIVE' : ''),
    port: env.dbPort || 3306,
    database: env.dbDatabase || env.hyperdrive?.database || '',
    username: env.dbUsername || env.hyperdrive?.user || '',
    ssl: Boolean(env.dbSsl),
    app_name: check.app_name || env.appName,
    tables_count: check.tables_count || 0,
    mysql_version: check.mysql_version || null,
    latency_ms: check.latency_ms,
    error_code: check.ok ? null : check.code,
    error_message: check.ok ? null : check.message,
    hint: check.ok ? null : check.hint,
    db_driver: `mysql (${env.dbHost || 'hyperdrive'}:${env.dbPort}/${env.dbDatabase})`,
    node_version: 'Cloudflare Workers (nodejs_compat)',
  });
});

router.post('/installer-api/test-connection', async (req, res) => {
  const host = String(req.body?.host || '').trim();
  const port = Number(req.body?.port || 3306);
  const database = String(req.body?.database || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password ?? '');
  const ssl = Boolean(req.body?.ssl);

  const check = await testDirectConnection({ host, port, database, username, password, ssl });
  return res.status(check.ok ? 200 : 422).json(check);
});

router.post('/installer-api/save-connection', async (req, res) => {
  const currentCheck = await testDirectConnection();
  if (currentCheck.ok && !req.user?.is_admin) {
    return res.status(403).json({
      message: 'An active database connection already exists. Sign in as admin to modify it.',
    });
  }

  const host = String(req.body?.host || '').trim();
  const port = Number(req.body?.port || 3306);
  const database = String(req.body?.database || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password ?? '');
  const ssl = Boolean(req.body?.ssl);

  const check = await testDirectConnection({ host, port, database, username, password, ssl });
  if (!check.ok) {
    return res.status(422).json({
      ...check,
      message: check.message || 'Could not connect to remote MySQL server.',
    });
  }

  if (env.configKv) {
    const payload = { host, port, database, username, password, ssl };
    await env.configKv.put('mysql_config', JSON.stringify(payload));
    setCachedKvDbConfig(payload);
    clearCachedDbDefaults();
    clearSchemaCache();
    return res.json({
      saved_to: 'kv',
      ok: true,
      ...check,
      message: 'Remote MySQL connection verified and saved to Cloudflare KV (CONFIG_KV).',
    });
  }

  return res.json({
    saved_to: 'env_required',
    ok: true,
    ...check,
    message:
      'Connection verified! Add CONFIG_KV binding for browser persistence, or save DB_* variables in Cloudflare Dashboard -> Settings -> Variables and Secrets.',
  });
});

export { VISIBLE_PERMISSION_KEYS };
export default router;
