import crypto from 'node:crypto';
import express from 'express';
import {
  execute,
  hasColumn,
  isMySql,
  nowIso,
  queryAll,
  queryOne,
} from '../../db/mysql.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import {
  extractBearerOrCookieToken,
  getUserWithPermissions,
  requireAuth,
  sanitizeUser,
  touchLastLogin,
} from '../../middleware/auth.js';
import {
  createDiskUpload,
  publicStorageUrl,
} from '../../middleware/upload.js';
import {
  hashPassword,
  randomCode,
  sha256,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
} from '../../services/crypto.js';
import {
  buildUserAccessState,
  formatSubscriptionForApi,
  serializePlan,
} from '../../services/subscriptions.js';
import {
  buildDeliveryUrl,
  resolveRequestBaseUrl,
} from '../../services/playback.js';

const router = makeAsyncRouter(express.Router());
const uploadAvatar = createDiskUpload('avatars', { preserveExtension: true });
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_TTL_SECONDS = 2592000; // 30 days (matches Laravel Passport / mobile tokens)

function generateQrLoginCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += QR_ALPHABET[crypto.randomInt(0, QR_ALPHABET.length)];
  }
  return code;
}

async function getSettingsRow() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

async function getActiveSubAndPlan(user) {
  if (!user?.id) return { sub: null, plan: null };
  const sub = await queryOne(
    `SELECT * FROM subscriptions
     WHERE user_id = ? AND (provider_status IN ('active', 'trialing') OR stripe_status IN ('active', 'trialing'))
     ORDER BY id DESC LIMIT 1`,
    [user.id]
  );
  let plan = null;
  const planId = sub?.provider_plan_id || user.pack_id;
  if (planId && Number.isFinite(Number(planId))) {
    plan = await queryOne('SELECT * FROM plans WHERE id = ?', [Number(planId)]);
  } else if (sub?.stripe_plan || user.pack_name) {
    plan = await queryOne('SELECT * FROM plans WHERE stripe_plan_id = ? OR slug = ? OR name = ? LIMIT 1', [
      sub?.stripe_plan || '',
      sub?.stripe_plan || '',
      user.pack_name || '',
    ]);
  }
  return { sub, plan };
}

function buildContextLimits(settings, plan, profiles, devices) {
  const planMaxProfiles = plan ? Number(plan.max_profiles || 0) : 0;
  const settingProfileLimit = Math.max(1, Number(settings.profile_selection_limit || 5));
  const profileLimit = planMaxProfiles > 0 ? planMaxProfiles : settingProfileLimit;

  const planMaxDevices = plan ? Number(plan.max_devices || 0) : 0;
  const settingDeviceLimit = Math.max(1, Number(settings.device_management_limit || 5));
  const deviceLimit = planMaxDevices > 0 ? planMaxDevices : settingDeviceLimit;

  return {
    profile_selection_context: {
      enabled: Boolean(Number(settings.profile_selection || 0)),
      limit: profileLimit,
      current_count: profiles.length,
      remaining: Math.max(0, profileLimit - profiles.length),
      can_add: profiles.length < profileLimit,
      source: planMaxProfiles > 0 ? 'plan' : 'settings',
    },
    device_management_context: {
      enabled: Boolean(Number(settings.device_management || 0)),
      limit: deviceLimit,
      current_count: devices.length,
      remaining: Math.max(0, deviceLimit - devices.length),
      can_add: devices.length < deviceLimit,
      source: planMaxDevices > 0 ? 'plan' : 'settings',
    },
  };
}

async function serializeProfilesWithStats(userId, settings, req = null) {
  const rows = await queryAll('SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC', [userId]);
  const baseUrl = resolveRequestBaseUrl(req);
  if (!rows.length) return [];

  const statsRows = await queryAll(
    `SELECT profile_id,
            COUNT(*) AS watch_history_count,
            SUM(CASE WHEN progress_percentage > 0 AND progress_percentage < 95 THEN 1 ELSE 0 END) AS continue_watching_count,
            MAX(last_watched_at) AS last_watched_at
     FROM watch_histories
     WHERE user_id = ? AND profile_id IS NOT NULL
     GROUP BY profile_id`,
    [userId]
  );
  const statsMap = new Map(statsRows.map((s) => [Number(s.profile_id), s]));

  return rows.map((p) => {
    const st = statsMap.get(Number(p.id));
    return {
      ...p,
      id: Number(p.id),
      user_id: Number(p.user_id),
      avatar: p.avatar ? buildDeliveryUrl(p.avatar, settings, { fallback: p.avatar, baseUrl }) : null,
      watch_history_count: Number(st?.watch_history_count || 0),
      continue_watching_count: Number(st?.continue_watching_count || 0),
      last_watched_at: st?.last_watched_at || null,
      is_primary: false,
      can_delete: true,
    };
  });
}

async function serializeUserWithProfiles(userId, req = null) {
  const raw = await getUserWithPermissions(userId);
  if (!raw) return null;

  if (!raw.login_code) {
    const generatedCode = randomCode(8);
    await execute('UPDATE users SET login_code = ?, updated_at = ? WHERE id = ?', [generatedCode, nowIso(), raw.id]);
    raw.login_code = generatedCode;
  }

  const user = sanitizeUser(raw);
  const settings = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);

  const [profiles, devices, { sub, plan }] = await Promise.all([
    serializeProfilesWithStats(user.id, settings, req),
    queryAll('SELECT id, name, serial_number, model, user_id, created_at, updated_at FROM devices WHERE user_id = ? ORDER BY id ASC', [user.id]),
    getActiveSubAndPlan(user),
  ]);

  const contexts = buildContextLimits(settings, plan, profiles, devices);
  const expiredDate = user.expired_in ? String(user.expired_in).slice(0, 10) : null;

  return {
    ...user,
    avatar: user.avatar ? buildDeliveryUrl(user.avatar, settings, { fallback: user.avatar, baseUrl }) : null,
    expired_in: expiredDate,
    profiles,
    devices,
    profile_selection_context: contexts.profile_selection_context,
    device_management_context: contexts.device_management_context,
    subscription: formatSubscriptionForApi(sub, plan, user),
  };
}

async function createMobileAuthTokens(user, req) {
  const sessionId = randomCode(16);
  const refreshToken = randomCode(32);
  const now = nowIso();
  const refreshExpStr = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  await execute(
    `INSERT INTO mobile_app_sessions (session_id, user_id, app_id, device_id_hash, platform, package_name, app_version, refresh_token_hash, refresh_token_expires_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      String(req.headers['x-app-id'] || req.body?.app_id || 'easyplex-mobile'),
      sha256(String(req.headers['x-device-id'] || req.body?.device_id || req.ip || 'device')),
      String(req.headers['x-platform'] || req.body?.platform || 'android'),
      String(req.body?.package_name || 'com.easyplexdemoapp'),
      String(req.body?.app_version || '2.4.21'),
      sha256(refreshToken),
      refreshExpStr,
      now,
      now,
      now,
    ]
  );

  const accessToken = signAuthToken(user, { session_id: sessionId });
  return { accessToken, refreshToken, sessionId };
}

// ================= AUTHENTICATION =================
router.post('/api/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !email || !password) {
    return res.status(422).json({ status: 422, message: 'Name, email, and password are required.' });
  }
  if (await queryOne('SELECT id FROM users WHERE LOWER(email) = ?', [email])) {
    return res.status(422).json({ status: 422, message: 'Email is already registered.' });
  }

  const settings = await getSettingsRow();
  const verified = settings?.email_verify ? 0 : 1;
  const pwHash = await hashPassword(password);
  const now = nowIso();
  const loginCode = randomCode(8);

  const [hasPhone, hasVerifiedCol, hasUsernameCol] = await Promise.all([
    hasColumn('users', 'phone'),
    hasColumn('users', 'verified'),
    hasColumn('users', 'username'),
  ]);

  const cols = ['role', 'name', 'email'];
  const vals = ['user', name, email];
  if (hasPhone) {
    cols.push('phone');
    vals.push(req.body.phone || null);
  }
  if (hasUsernameCol && req.body.username) {
    cols.push('username');
    vals.push(String(req.body.username).trim());
  }
  cols.push('premuim', 'verfied');
  vals.push(0, verified);
  if (hasVerifiedCol) {
    cols.push('verified');
    vals.push(verified);
  }
  cols.push('active', 'email_verified_at', 'password', 'login_code', 'created_at', 'updated_at');
  vals.push(1, verified ? now : null, pwHash, loginCode, now, now);

  const ins = await execute(`INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  const userId = Number(ins.lastInsertRowid);
  await execute('INSERT INTO profiles (name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [name, userId, now, now]);

  const user = await serializeUserWithProfiles(userId, req);
  const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);
  return res.status(200).json({
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    access_token: accessToken,
    refresh_token: refreshToken,
    token: accessToken,
    user,
  });
});

router.post('/api/login', async (req, res) => {
  const login = String(req.body.username || req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!login || !password) {
    return res.status(400).json({ error: 'invalid_request', message: 'Email/username and password are required.' });
  }

  const hasUsernameCol = await hasColumn('users', 'username');
  const raw = hasUsernameCol
    ? await queryOne('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? LIMIT 1', [login, login])
    : await queryOne('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(name) = ? LIMIT 1', [login, login]);

  if (!raw || !(await verifyPassword(password, raw.password))) {
    return res.status(400).json({ error: 'invalid_grant', message: 'The email or password is incorrect.' });
  }
  if (!raw.active) {
    return res.status(403).json({ status: 403, message: 'Account is suspended.' });
  }

  await touchLastLogin(raw.id);
  const user = await serializeUserWithProfiles(raw.id, req);
  const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);

  return res.json({
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    access_token: accessToken,
    refresh_token: refreshToken,
    token: accessToken,
    user,
  });
});

router.post('/api/refresh', async (req, res) => {
  const rt = String(req.body.refresh_token || '').trim();
  const now = nowIso();

  if (rt) {
    const session = await queryOne(
      'SELECT * FROM mobile_app_sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL',
      [sha256(rt)]
    );
    if (!session || !session.user_id) {
      return res.status(401).json({ error: 'invalid_grant', message: 'The refresh token is invalid.' });
    }
    const user = await serializeUserWithProfiles(Number(session.user_id), req);
    if (!user) return res.status(401).json({ error: 'invalid_grant', message: 'User not found.' });

    const nextRefresh = randomCode(32);
    const nextExp = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      'UPDATE mobile_app_sessions SET refresh_token_hash = ?, refresh_token_expires_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?',
      [sha256(nextRefresh), nextExp, now, now, session.id]
    );
    const accessToken = signAuthToken(user, { session_id: session.session_id });
    return res.json({
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
      access_token: accessToken,
      refresh_token: nextRefresh,
      token: accessToken,
    });
  }

  const token = extractBearerOrCookieToken(req);
  const decoded = token ? verifyAuthToken(token) : null;
  if (!decoded?.sub) {
    return res.status(401).json({ error: 'invalid_grant', message: 'Invalid token' });
  }
  const user = await serializeUserWithProfiles(Number(decoded.sub), req);
  if (!user) return res.status(401).json({ error: 'invalid_grant', message: 'User not found' });

  const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);
  return res.json({
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    access_token: accessToken,
    refresh_token: refreshToken,
    token: accessToken,
  });
});

router.post(['/api/disconnect', '/api/logout', '/api/user/logout'], async (req, res) => {
  const token = extractBearerOrCookieToken(req);
  const decoded = token ? verifyAuthToken(token) : null;
  if (decoded?.session_id) {
    await execute(
      "UPDATE mobile_app_sessions SET revoked_at = ?, revoke_reason = 'logout', updated_at = ? WHERE session_id = ?",
      [nowIso(), nowIso(), decoded.session_id]
    );
  }
  return res.json({ status: 200, message: 'Successfully logged out.' });
});

// ================= USER PROFILE & ACCOUNT =================
router.get(['/api/user', '/api/profile'], requireAuth, async (req, res) => {
  return res.json(await serializeUserWithProfiles(req.user.id, req));
});

async function updateApiProfileHandler(req, res) {
  const name = req.body.name ? String(req.body.name).trim() : null;
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
  const password = req.body.password ? await hashPassword(String(req.body.password)) : null;

  if (email && email !== String(req.user.email || '').toLowerCase()) {
    const dup = await queryOne('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [email, req.user.id]);
    if (dup) return res.status(422).json({ status: 422, message: 'Email is already taken.' });
  }

  const sets = [
    'name = COALESCE(?, name)',
    'email = COALESCE(?, email)',
    'password = COALESCE(?, password)',
  ];
  const vals = [name, email, password];
  if (await hasColumn('users', 'phone')) {
    sets.push('phone = COALESCE(?, phone)');
    vals.push(req.body.phone || null);
  }
  sets.push('updated_at = ?');
  vals.push(nowIso(), req.user.id);

  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({
    status: 200,
    0: 'successfully updated',
    message: 'successfully updated',
    body: user,
    user,
  });
}

router.post('/api/update', requireAuth, updateApiProfileHandler);
router.put('/api/account/update', requireAuth, updateApiProfileHandler);

router.put('/api/account/phone/update', requireAuth, async (req, res) => {
  const now = nowIso();
  const hasPhone = await hasColumn('users', 'phone');
  const hasVerifiedCol = await hasColumn('users', 'verified');
  const sets = ['verfied = 1', 'updated_at = ?'];
  const vals = [now];
  if (hasVerifiedCol) sets.unshift('verified = 1');
  if (hasPhone && req.body.phone !== undefined) {
    sets.unshift('phone = ?');
    vals.unshift(String(req.body.phone || ''));
  }
  vals.push(req.user.id);
  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({ ...user, status: 200, user });
});

router.get('/api/account/profile-activity', requireAuth, async (req, res) => {
  const profileId = req.query.profile_id || req.headers['x-profile-id'] || null;
  const deviceId = req.query.device_id || req.headers['x-device-id'] || null;
  const pIdNum = profileId ? Number(profileId) : null;

  const watchWhere = pIdNum ? 'user_id = ? AND profile_id = ?' : 'user_id = ?';
  const watchParams = pIdNum ? [req.user.id, pIdNum] : [req.user.id];

  const [favRow, commentsRow, watchRows, likesRow, latestComment] = await Promise.all([
    queryOne('SELECT COUNT(*) AS count FROM favorites WHERE user_id = ?', [req.user.id]),
    queryOne('SELECT COUNT(*) AS count FROM comments WHERE user_id = ?', [req.user.id]),
    queryAll(`SELECT * FROM watch_histories WHERE ${watchWhere} ORDER BY last_watched_at DESC LIMIT 50`, watchParams),
    queryOne('SELECT COUNT(*) AS count FROM likes WHERE user_id = ?', [req.user.id]),
    queryOne('SELECT * FROM comments WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]),
  ]);

  let completed = 0;
  let episodesWatched = 0;
  let watchTimeSeconds = 0;
  const byType = { movie: 0, serie: 0, anime: 0 };

  for (const w of watchRows) {
    const pct = Number(w.progress_percentage || 0);
    if (pct >= 90) completed += 1;
    if (w.episode_id) episodesWatched += 1;
    watchTimeSeconds += Math.max(0, Number(w.current_position || 0));
    const t = String(w.watchable_type || 'movie').toLowerCase();
    if (byType[t] !== undefined) byType[t] += 1;
  }

  return res.json({
    success: true,
    profile_id: pIdNum,
    device_id: deviceId ? String(deviceId) : null,
    stats: {
      favorites: Number(favRow?.count || 0),
      liked: Number(likesRow?.count || 0),
      comments: Number(commentsRow?.count || 0),
      watched: watchRows.length,
      completed,
      episodes_watched: episodesWatched,
      watch_time_seconds: watchTimeSeconds,
      by_type: byType,
    },
    latest: {
      liked: null,
      comment: latestComment || null,
      watched: watchRows[0] || null,
    },
    activity: watchRows.slice(0, 20),
    favorites_count: Number(favRow?.count || 0),
    watch_history_count: watchRows.length,
    comments_count: Number(commentsRow?.count || 0),
  });
});

router.get('/api/account/isSubscribed', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const { sub, plan } = await getActiveSubAndPlan(u);
  const access = buildUserAccessState(u, sub, plan);
  return res.json({
    active: access.is_subscribed ? 1 : 0,
    is_subscribed: access.is_subscribed,
    premuim: access.is_subscribed ? 1 : 0,
    pack_name: u?.pack_name || null,
    expired_in: access.expires_at ? String(access.expires_at).slice(0, 10) : null,
    subscription: {
      is_subscribed: access.is_subscribed,
      is_premium: access.is_premium,
      plan: plan ? serializePlan(plan) : null,
      expires_at: access.expires_at,
      will_cancel: access.will_cancel,
      is_trial: access.is_trial,
      trial_ends_at: access.trial_ends_at,
    },
  });
});

router.get('/api/subscription/checkexpiration', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const today = new Date().toISOString().slice(0, 10);
  const expiredDate = u?.expired_in ? String(u.expired_in).slice(0, 10) : null;
  const expired = Boolean(expiredDate && expiredDate < today);
  if (expired && u?.premuim) {
    await execute('UPDATE users SET premuim = 0, updated_at = ? WHERE id = ?', [nowIso(), req.user.id]);
    u.premuim = 0;
  }
  const { sub, plan } = await getActiveSubAndPlan(u);
  const access = buildUserAccessState(u, sub, plan);

  return res.json({
    status: 200,
    subscription: access.is_subscribed && !expired ? 'notexpired' : 'expired',
    expired: !access.is_subscribed || expired,
    premuim: access.is_subscribed && !expired ? 1 : 0,
    expired_in: expiredDate,
    expires_at: access.expires_at,
    pack_name: u?.pack_name || null,
    renewal_mode: sub?.provider || u?.type || 'manual',
    will_renew: !access.will_cancel && access.is_subscribed,
    can_renew_automatically: ['stripe', 'paypal', 'razorpay'].includes(String(sub?.provider || '').toLowerCase()),
    subscription_state: access.status,
  });
});

router.delete('/api/user/delete', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(400).json({ status: 400, message: 'Primary admin accounts cannot be self-deleted.' });
  }
  await execute('DELETE FROM users WHERE id = ?', [req.user.id]);
  return res.json({ status: 200, message: 'The account has been successfully deleted' });
});

// ================= SOCIAL AUTH =================
router.post(['/api/social/loginFacebook', '/api/social/loginGoogle', '/api/social_auth'], async (req, res) => {
  const provider = req.path.includes('Google')
    ? 'google'
    : req.path.includes('Facebook')
    ? 'facebook'
    : String(req.body.provider || 'social');
  const providerUserId = String(req.body.provider_id || req.body.id || req.body.sub || '');
  const email = String(req.body.email || (providerUserId ? `${provider}_${providerUserId}@social.local` : '')).toLowerCase();
  const name = String(req.body.name || 'Social User').trim();
  if (!email) return res.status(422).json({ message: 'Email or social ID is required' });

  const now = nowIso();
  let userRow = await queryOne('SELECT * FROM users WHERE LOWER(email) = ?', [email]);
  if (!userRow) {
    const pw = await hashPassword(randomCode(16));
    const hasVerifiedCol = await hasColumn('users', 'verified');
    const cols = ['role', 'name', 'email', 'premuim', 'verfied'];
    const vals = ['user', name, email, 0, 1];
    if (hasVerifiedCol) {
      cols.push('verified');
      vals.push(1);
    }
    cols.push('active', 'email_verified_at', 'provider_name', 'provider_id', 'password', 'avatar', 'login_code', 'created_at', 'updated_at');
    vals.push(1, now, provider, providerUserId || null, pw, req.body.avatar || null, randomCode(8), now, now);

    const ins = await execute(`INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    const newId = Number(ins.lastInsertRowid);
    await execute('INSERT INTO profiles (name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [name, newId, now, now]);
    userRow = await queryOne('SELECT * FROM users WHERE id = ?', [newId]);
  }
  if (providerUserId) {
    const ignoreVerb = isMySql() ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';
    await execute(
      `${ignoreVerb} social_accounts (user_id, provider, provider_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [userRow.id, provider, providerUserId, now, now]
    );
  }
  const user = await serializeUserWithProfiles(userRow.id, req);
  const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);
  return res.json({
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    access_token: accessToken,
    refresh_token: refreshToken,
    token: accessToken,
    user,
  });
});

// ================= PASSWORD & EMAIL VERIFICATION =================
router.post('/api/password/email', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(422).json({ message: 'Email is required' });
  const token = randomCode(8);
  await execute('INSERT INTO password_resets (email, token, created_at) VALUES (?, ?, ?)', [email, token, nowIso()]);
  return res.json({ status: 200, message: 'Password reset token generated.', reset_token: token });
});

router.post('/api/password/reset', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  const reset = await queryOne(
    'SELECT * FROM password_resets WHERE LOWER(email) = ? AND token = ? ORDER BY created_at DESC LIMIT 1',
    [email, token]
  );
  if (!reset) return res.status(422).json({ message: 'Invalid reset token' });
  const pwHash = await hashPassword(password);
  await execute('UPDATE users SET password = ?, updated_at = ? WHERE LOWER(email) = ?', [pwHash, nowIso(), email]);
  await execute('DELETE FROM password_resets WHERE LOWER(email) = ?', [email]);
  return res.json({ status: 200, message: 'Password reset successfully' });
});

router.post('/api/email/verify', requireAuth, async (req, res) => {
  const now = nowIso();
  const hasVerifiedCol = await hasColumn('users', 'verified');
  const verifiedClause = hasVerifiedCol ? 'verfied = 1, verified = 1' : 'verfied = 1';
  await execute(`UPDATE users SET ${verifiedClause}, email_verified_at = ?, updated_at = ? WHERE id = ?`, [
    now,
    now,
    req.user.id,
  ]);
  return res.json({ status: 200, message: 'Email verified', user: await serializeUserWithProfiles(req.user.id, req) });
});

router.post('/api/email/resend', requireAuth, (_req, res) => {
  return res.json({ status: 200, message: 'Verification code dispatched.' });
});

// ================= DEVICES & SUB-PROFILES =================
router.get('/api/user/devices/', requireAuth, async (req, res) => {
  const devices = await queryAll(
    'SELECT id, name, serial_number, model, user_id, created_at, updated_at FROM devices WHERE user_id = ? ORDER BY id DESC',
    [req.user.id]
  );
  return res.json({ devices });
});

router.post('/api/user/device/create', requireAuth, async (req, res) => {
  const settings = await getSettingsRow();
  const serial = req.body.serial_number ? String(req.body.serial_number).trim() : null;
  const name = String(req.body.name || req.body.device_name || 'Device').trim();
  const model = req.body.model ? String(req.body.model).trim() : null;

  if (serial) {
    const existing = await queryOne('SELECT * FROM devices WHERE user_id = ? AND serial_number = ? LIMIT 1', [
      req.user.id,
      serial,
    ]);
    if (existing) {
      const user = await serializeUserWithProfiles(req.user.id, req);
      return res.json({ ...user, status: 200, message: 'Device Already Attached', device: existing });
    }
  }

  const [{ plan }, devices] = await Promise.all([
    getActiveSubAndPlan(req.user),
    queryAll('SELECT id FROM devices WHERE user_id = ?', [req.user.id]),
  ]);
  const limit = plan && Number(plan.max_devices || 0) > 0
    ? Number(plan.max_devices)
    : Math.max(1, Number(settings.device_management_limit || 5));

  if (Boolean(Number(settings.device_management || 0)) && devices.length >= limit) {
    return res.status(422).json({ status: 422, message: 'Device limit reached.' });
  }

  const now = nowIso();
  const ins = await execute(
    'INSERT INTO devices (name, serial_number, model, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, serial, model, req.user.id, now, now]
  );
  const device = await queryOne('SELECT * FROM devices WHERE id = ?', [Number(ins.lastInsertRowid)]);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({ ...user, status: 200, message: 'Device successfully Attached', device });
});

router.delete('/api/user/device/delete/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await queryOne('SELECT id FROM devices WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Device not found' });
  await execute('DELETE FROM devices WHERE id = ? AND user_id = ?', [id, req.user.id]);
  return res.json({ status: 200, message: 'successfully removed' });
});

router.post(['/api/user/profile/create', '/api/users/addprofile'], requireAuth, async (req, res) => {
  const settings = await getSettingsRow();
  const profileSelectionEnabled = Boolean(Number(settings.profile_selection || 0));
  if (!profileSelectionEnabled && req.path === '/api/user/profile/create') {
    return res.status(403).json({ status: 403, message: 'Profile selection is disabled.' });
  }

  const [{ plan }, currentProfiles] = await Promise.all([
    getActiveSubAndPlan(req.user),
    queryAll('SELECT id FROM profiles WHERE user_id = ?', [req.user.id]),
  ]);
  const limit = plan && Number(plan.max_profiles || 0) > 0
    ? Number(plan.max_profiles)
    : Math.max(1, Number(settings.profile_selection_limit || 5));

  if (currentProfiles.length >= limit) {
    return res.status(422).json({ status: 422, message: 'Maximum number of profiles reached.' });
  }

  const name = String(req.body.name || 'Profile').trim();
  const now = nowIso();
  const ins = await execute('INSERT INTO profiles (name, avatar, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    name,
    req.body.avatar || null,
    req.user.id,
    now,
    now,
  ]);
  const profile = await queryOne('SELECT * FROM profiles WHERE id = ?', [Number(ins.lastInsertRowid)]);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({
    status: 200,
    message: 'successfully Added',
    body: user,
    user,
    profile,
    profiles: user.profiles,
    profile_selection_context: user.profile_selection_context,
  });
});

router.delete('/api/user/profile/delete/:profile_id', requireAuth, async (req, res) => {
  const id = Number(req.params.profile_id);
  const existing = await queryOne('SELECT id FROM profiles WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Profile not found' });
  await execute('DELETE FROM profiles WHERE id = ? AND user_id = ?', [id, req.user.id]);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({
    status: 200,
    message: 'successfully removed',
    profiles: user.profiles,
    profile_selection_context: user.profile_selection_context,
  });
});

router.get('/api/users/profile/:user/:code', async (req, res) => {
  const u = await serializeUserWithProfiles(Number(req.params.user), req);
  if (!u) return res.status(404).json({ message: 'User not found' });
  return res.json(u);
});

router.get('/api/avatar/:avatarid', async (req, res) => {
  const row = await queryOne('SELECT * FROM avatars WHERE id = ?', [Number(req.params.avatarid)]);
  if (!row) return res.status(404).json({ message: 'Avatar not found' });
  return res.json(row);
});

router.post('/api/user/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Avatar image required' });
  const url = publicStorageUrl(req, '/api/avatars/image/', req.file.filename);
  await execute('UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?', [url, nowIso(), req.user.id]);
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({ ...user, status: 200, avatar: url, body: user, user });
});

router.post('/api/user/avatarProfile', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Avatar image required' });
  const profileId = Number(req.body.profile_id || 0);
  const url = publicStorageUrl(req, '/api/avatars/image/', req.file.filename);
  if (profileId) {
    await execute('UPDATE profiles SET avatar = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
      url,
      nowIso(),
      profileId,
      req.user.id,
    ]);
  }
  const user = await serializeUserWithProfiles(req.user.id, req);
  return res.json({ ...user, status: 200, avatar: url, body: user, user });
});

// ================= QR / TV CODE LOGIN (Laravel QrLoginController 1:1) =================
router.post('/api/generate-login-code', async (_req, res) => {
  const loginCode = generateQrLoginCode(8);
  const pollToken = randomCode(32);
  const expUnix = Math.floor(Date.now() / 1000) + 600;
  const expiresAt = new Date(expUnix * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const now = nowIso();

  await execute(
    `INSERT INTO login_codes (code, status, expires_at, poll_token_hash, tokens_retrieved, created_at, updated_at)
     VALUES (?, 'pending', ?, ?, 0, ?, ?)`,
    [loginCode, expiresAt, sha256(pollToken), now, now]
  );

  return res.status(201).json({
    loginCode,
    code: loginCode,
    pollToken,
    poll_token: pollToken,
    expiresAt: expUnix,
  });
});

router.get('/api/check-login-status/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const row = await queryOne('SELECT * FROM login_codes WHERE UPPER(code) = ?', [code]);
  if (!row) return res.status(404).json({ status: 'invalid' });

  const expMs = Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z');
  if (Number.isFinite(expMs) && expMs < Date.now() && row.status === 'pending') {
    return res.status(200).json({ status: 'expired' });
  }
  return res.status(200).json({ status: row.status });
});

router.post('/api/authenticate-with-code', requireAuth, async (req, res) => {
  const code = String(req.body.loginCode || req.body.code || '').trim().toUpperCase();
  const row = await queryOne('SELECT * FROM login_codes WHERE UPPER(code) = ?', [code]);
  if (!row) return res.status(404).json({ message: 'Invalid or expired code' });

  const expMs = Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z');
  if (Number.isFinite(expMs) && expMs < Date.now()) {
    return res.status(410).json({ message: 'Code expired' });
  }

  const now = nowIso();
  await execute(
    `UPDATE login_codes SET status = 'authenticated', user_id = ?, updated_at = ? WHERE id = ?`,
    [req.user.id, now, row.id]
  );
  return res.json({ status: 200, message: 'TV device approved' });
});

router.post(['/api/claim-login-code/:code', '/api/claim-mobile-login-code/:code'], async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  const row = await queryOne('SELECT * FROM login_codes WHERE UPPER(code) = ?', [code]);
  if (!row) return res.status(404).json({ message: 'Invalid login code' });

  const expMs = Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z');
  if (Number.isFinite(expMs) && expMs < Date.now()) {
    return res.status(410).json({ status: 'expired', message: 'Login code expired' });
  }

  const isMobileClaim = req.path.includes('claim-mobile-login-code');
  const pollToken = String(req.body.pollToken || req.body.poll_token || '').trim();
  const tokenMatch = Boolean(pollToken && row.poll_token_hash && sha256(pollToken) === row.poll_token_hash);

  if (isMobileClaim) {
    if (!req.user?.id) {
      return res.status(401).json({ message: 'Authentication required to claim mobile login code' });
    }
    const now = nowIso();
    await execute(
      `UPDATE login_codes SET status = 'authenticated', user_id = ?, claimed_at = ?, tokens_retrieved = 1, updated_at = ? WHERE id = ?`,
      [req.user.id, now, now, row.id]
    );
    const user = await serializeUserWithProfiles(req.user.id, req);
    const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);
    return res.json({
      status: 'authenticated',
      access_token: accessToken,
      refresh_token: refreshToken,
      expiresIn: TOKEN_TTL_SECONDS,
      expires_in: TOKEN_TTL_SECONDS,
      token_type: 'Bearer',
      type: 'AndroidTV',
      user,
    });
  }

  if (row.status !== 'authenticated' || !row.user_id) {
    return res.status(409).json({ status: row.status, message: 'Code not yet authenticated' });
  }
  if (Number(row.tokens_retrieved || 0) === 1) {
    return res.status(409).json({ message: 'Login code already claimed' });
  }
  if (!tokenMatch && !req.user?.id) {
    return res.status(403).json({ message: 'Invalid pollToken' });
  }

  const now = nowIso();
  await execute(
    `UPDATE login_codes SET claimed_at = ?, tokens_retrieved = 1, updated_at = ? WHERE id = ?`,
    [now, now, row.id]
  );

  const user = await serializeUserWithProfiles(Number(row.user_id), req);
  const { accessToken, refreshToken } = await createMobileAuthTokens(user, req);
  return res.json({
    status: 'authenticated',
    access_token: accessToken,
    refresh_token: refreshToken,
    expiresIn: TOKEN_TTL_SECONDS,
    expires_in: TOKEN_TTL_SECONDS,
    token_type: 'Bearer',
    type: 'AndroidTV',
    user,
  });
});

router.post('/api/qrLogin-autogenerate', requireAuth, async (req, res) => {
  const nextCode = randomCode(8);
  await execute('UPDATE users SET login_code = ?, updated_at = ? WHERE id = ?', [nextCode, nowIso(), req.user.id]);
  return res.json({ status: 200, login_code: nextCode });
});

router.get('/api/paypal', async (_req, res) => {
  const s = await queryOne('SELECT paypal_client_id, paypal_amount, paypal_currency, payment_mode FROM settings LIMIT 1');
  return res.json(s || {});
});

export default router;
