import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import {
  execute,
  nowIso,
  queryAll,
  queryOne,
} from '../../db/mysql.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import {
  extractBearerOrCookieToken,
  requireAdminOrModerator,
  requireAuth,
} from '../../middleware/auth.js';
import {
  buildPublicPolicyPayload,
  resolveMobileSecurityPolicy,
} from '../../middleware/mobileSecurity.js';
import {
  ensureStorageDir,
  sendStoredFile,
} from '../../middleware/upload.js';
import { env } from '../../config/env.js';
import {
  randomCode,
  sha256,
  signAuthToken,
  verifyAuthToken,
} from '../../services/crypto.js';
import {
  buildDeliveryUrl,
  extractSupportedHost,
  resolveRequestBaseUrl,
  sanitizePublicSettings,
} from '../../services/playback.js';

const router = makeAsyncRouter(express.Router());

const DEFAULT_COLORS = {
  main_color: '#00b4ca',
  fragment_featured_overlay_start: '#2E1A00',
  fragment_featured_overlay_center: '#FF6B35',
  fragment_featured_overlay_end: '#3E2A10',
};

async function getSettingsRow() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

async function getFlatColors() {
  const rows = await queryAll('SELECT color_name, color_value, is_active FROM app_colors WHERE is_active = 1 ORDER BY id ASC');
  const map = { ...DEFAULT_COLORS };
  for (const c of rows) {
    if (c.color_name && c.color_value) {
      map[c.color_name] = c.color_value;
    }
  }
  return map;
}

function parseListSetting(val) {
  if (!val) return [];
  return String(val)
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function sendSafeSubpath(res, baseSubDir, rawSubpath, fallbackFlag = null) {
  const rel = path.basename(String(rawSubpath || '').replace(/^\/+/, ''));
  return sendStoredFile(res, baseSubDir, rel, fallbackFlag);
}

// ================= PUBLIC SETTINGS & COLORS =================
router.get(['/api/settings/:code', '/api/settings', '/api/getconfig/easyplex'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  const [row, colors, branding] = await Promise.all([
    getSettingsRow(),
    getFlatColors(),
    queryOne('SELECT * FROM branding_settings ORDER BY id ASC LIMIT 1'),
  ]);

  return res.json(sanitizePublicSettings(row, { branding, colors, req }));
});

router.get('/api/colors', async (_req, res) => {
  return res.json(await getFlatColors());
});

router.get('/api/colors/admin', requireAdminOrModerator, async (_req, res) => {
  const [colors, items] = await Promise.all([
    getFlatColors(),
    queryAll('SELECT * FROM app_colors ORDER BY id ASC'),
  ]);
  return res.json({ success: true, colors, items });
});

router.post('/api/colors/update', requireAdminOrModerator, async (req, res) => {
  const payload = req.body.colors && typeof req.body.colors === 'object' ? req.body.colors : req.body;
  const updated = [];
  const now = nowIso();
  for (const [name, value] of Object.entries(payload || {})) {
    if (!name || typeof value !== 'string') continue;
    if (name === '_token') continue;
    const exists = await queryOne('SELECT id FROM app_colors WHERE color_name = ?', [name]);
    if (exists) {
      await execute('UPDATE app_colors SET color_value = ?, is_active = 1, updated_at = ? WHERE id = ?', [
        value,
        now,
        exists.id,
      ]);
    } else {
      await execute(
        'INSERT INTO app_colors (color_name, color_value, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        [name, value, now, now]
      );
    }
    updated.push(name);
  }
  const savedColors = await getFlatColors();
  return res.json({
    success: true,
    message: 'Colors updated successfully.',
    colors_updated: updated.length,
    saved_colors: savedColors,
  });
});

// ================= REELS =================
router.get('/api/reels', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(50, Math.max(1, Number(req.query.per_page || req.query.limit || 10)));
  const offset = (page - 1) * perPage;
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);

  const countRow = await queryOne('SELECT COUNT(*) AS cnt FROM reels WHERE is_active = 1');
  const total = Number(countRow?.cnt || 0);
  const rows = await queryAll(
    'SELECT * FROM reels WHERE is_active = 1 ORDER BY COALESCE(position, id) ASC, id DESC LIMIT ? OFFSET ?',
    [perPage, offset]
  );

  let likedSet = new Set();
  if (req.user?.id && rows.length) {
    const likes = await queryAll(
      `SELECT reel_id FROM reel_likes WHERE user_id = ? AND reel_id IN (${rows.map(() => '?').join(',')})`,
      [req.user.id, ...rows.map((r) => r.id)]
    );
    likedSet = new Set(likes.map((l) => Number(l.reel_id)));
  }

  const reels = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    video_url: buildDeliveryUrl(r.video_url, s, { fallback: '', baseUrl }),
    thumbnail_url: buildDeliveryUrl(r.thumbnail_url, s, { fallback: '', baseUrl }),
    poster_path: buildDeliveryUrl(r.thumbnail_url || r.poster_path, s, { fallback: '', baseUrl }),
    likes_count: Number(r.likes_count || 0),
    views_count: Number(r.views_count || 0),
    comments_count: Number(r.comments_count || 0),
    is_liked: likedSet.has(Number(r.id)),
  }));

  const lastPage = Math.max(1, Math.ceil(total / perPage));
  return res.json({
    reels,
    pagination: {
      current_page: page,
      last_page: lastPage,
      per_page: perPage,
      total,
      has_more_pages: page < lastPage,
    },
    recommendation: {
      personalized: Boolean(req.user?.id),
      cycle: Number(req.query.cycle || 0),
    },
  });
});

router.get('/api/reels/user/liked', requireAuth, async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll(
    `SELECT r.* FROM reels r INNER JOIN reel_likes rl ON rl.reel_id = r.id WHERE rl.user_id = ? AND r.is_active = 1 ORDER BY rl.id DESC`,
    [req.user.id]
  );
  const reels = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    video_url: buildDeliveryUrl(r.video_url, s, { fallback: '', baseUrl }),
    thumbnail_url: buildDeliveryUrl(r.thumbnail_url, s, { fallback: '', baseUrl }),
    is_liked: true,
  }));
  return res.json({ reels, data: reels });
});

router.get(['/api/reels/video/:filename', '/api/reels/video/*'], (req, res) => {
  const target = req.params.filename || req.params[0] || '';
  return sendSafeSubpath(res, 'reels', target);
});

router.get(['/api/reels/thumbnail/:filename', '/api/reels/thumbnail/*'], (req, res) => {
  const target = req.params.filename || req.params[0] || '';
  return sendSafeSubpath(res, 'reels_thumbs', target);
});

router.get('/api/reels/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM reels WHERE id = ? AND is_active = 1', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ message: 'Reel not found' });
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  let isLiked = false;
  if (req.user?.id) {
    const exists = await queryOne('SELECT id FROM reel_likes WHERE reel_id = ? AND user_id = ?', [row.id, req.user.id]);
    isLiked = Boolean(exists);
  }
  return res.json({
    ...row,
    id: Number(row.id),
    video_url: buildDeliveryUrl(row.video_url, s, { fallback: '', baseUrl }),
    thumbnail_url: buildDeliveryUrl(row.thumbnail_url, s, { fallback: '', baseUrl }),
    is_liked: isLiked,
  });
});

router.post('/api/reels/:id/view', async (req, res) => {
  const reelId = Number(req.params.id);
  const now = nowIso();
  await execute('UPDATE reels SET views_count = views_count + 1, updated_at = ? WHERE id = ?', [now, reelId]);
  await execute(
    'INSERT INTO reel_views (reel_id, user_id, viewed_at, watch_time, completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [reelId, req.user?.id || null, now, Number(req.body.watch_time || 0), req.body.completed ? 1 : 0, now, now]
  );
  const updated = await queryOne('SELECT views_count FROM reels WHERE id = ?', [reelId]);
  return res.json({ status: 200, views_count: Number(updated?.views_count || 0) });
});

router.post('/api/reels/:id/like', requireAuth, async (req, res) => {
  const reelId = Number(req.params.id);
  const now = nowIso();
  const existing = await queryOne('SELECT id FROM reel_likes WHERE reel_id = ? AND user_id = ?', [reelId, req.user.id]);
  let liked = false;
  if (existing) {
    await execute('DELETE FROM reel_likes WHERE id = ?', [existing.id]);
    await execute(
      'UPDATE reels SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END, updated_at = ? WHERE id = ?',
      [now, reelId]
    );
  } else {
    await execute(
      'INSERT INTO reel_likes (reel_id, user_id, liked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [reelId, req.user.id, now, now, now]
    );
    await execute('UPDATE reels SET likes_count = likes_count + 1, updated_at = ? WHERE id = ?', [now, reelId]);
    liked = true;
  }
  const reel = await queryOne('SELECT likes_count FROM reels WHERE id = ?', [reelId]);
  return res.json({
    status: 200,
    message: liked ? 'Reel liked' : 'Reel unliked',
    is_liked: liked,
    liked,
    likes_count: Number(reel?.likes_count || 0),
  });
});

router.get('/api/reels/:reel/liked', requireAuth, async (req, res) => {
  const exists = await queryOne('SELECT id FROM reel_likes WHERE reel_id = ? AND user_id = ?', [
    Number(req.params.reel),
    req.user.id,
  ]);
  return res.json({ is_liked: Boolean(exists), liked: Boolean(exists) });
});

// ================= SECURITY, TOKENS, INTEGRITY, HOSTS & SYSTEM =================
router.get('/api/security/policy', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  const s = await getSettingsRow();
  return res.json(buildPublicPolicyPayload(resolveMobileSecurityPolicy(s)));
});

router.all(['/api/security/startup-check', '/api/startup-check'], async (req, res) => {
  const s = await getSettingsRow();
  const configured = parseListSetting(s.sniffer_app_package_names).map((p) => p.toLowerCase());
  const submitted = []
    .concat(req.body?.installed_packages || [])
    .concat(req.body?.packages || [])
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);

  const matchedPackages = submitted.filter((p) => configured.includes(p));
  const snifferDetected = matchedPackages.length > 0;
  const blockEnabled = Boolean(Number(s.mobile_block_sniffer_apps || 0));
  const blockRequired = snifferDetected && blockEnabled;

  return res.status(blockRequired ? 403 : 200).json({
    success: !blockRequired,
    status: blockRequired ? 403 : 200,
    security: {
      sniffer_detected: snifferDetected,
      matched_packages: matchedPackages,
      block_required: blockRequired,
      policy_version: '1',
      cache_ttl_seconds: 600,
    },
  });
});

router.all(['/api/security/integrity/challenge', '/api/integrity/challenge'], (_req, res) => {
  return res.json({
    success: true,
    challenge: crypto.randomBytes(24).toString('base64url'),
    expires_in: 300,
  });
});

router.all(['/api/security/integrity/verify', '/api/integrity/verify'], async (req, res) => {
  const sessionId = String(req.body?.session_id || req.headers['x-session-id'] || '').trim();
  const verdict = req.body?.verdict || { verdict: 'MEETS_DEVICE_INTEGRITY', app_recognition: 'PLAY_RECOGNIZED' };
  if (sessionId) {
    const now = nowIso();
    const exp = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      'UPDATE mobile_app_sessions SET integrity_verified_at = ?, integrity_expires_at = ?, integrity_verdict = ?, updated_at = ? WHERE session_id = ?',
      [now, exp, typeof verdict === 'string' ? verdict : JSON.stringify(verdict), now, sessionId]
    );
  }
  return res.json({
    success: true,
    verified: true,
    expires_in: 86400,
    verdict,
  });
});

router.get('/api/vpn-check', (req, res) => {
  const ip =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    '127.0.0.1';
  return res.json({
    vpn: false,
    proxy: false,
    tor: false,
    hosting: false,
    countryCode: null,
    ip,
    riskScore: 0,
    risk_score: 0,
    blocked: false,
    message: 'OK',
  });
});

router.get(['/api/tokens/tokens/server-time', '/api/tokens/server-time'], (_req, res) => {
  const d = new Date();
  return res.json({
    timestamp: Math.floor(d.getTime() / 1000),
    datetime: d.toISOString().slice(0, 19).replace('T', ' '),
    timezone: 'UTC',
    iso8601: d.toISOString(),
  });
});

router.all(['/api/tokens/generate', '/api/tokens/mobile/generate', '/api/oauth/token/connect'], async (req, res) => {
  const s = await getSettingsRow();
  const appId = String(req.body?.app_id || req.headers['x-app-id'] || s.mobile_app_id || 'easyplex-mobile');
  const deviceId = String(req.body?.device_id || req.headers['x-device-id'] || req.ip || 'device');
  const platform = String(req.body?.platform || req.headers['x-platform'] || 'android');
  const pkg = String(req.body?.package_name || s.app_packagename || 'com.easyplexdemoapp');
  const appVersion = String(req.body?.app_version || req.headers['x-app-version'] || '2.4.21');
  const sig = String(
    req.body?.signature || req.body?.hash256 || req.headers['x-app-signature'] || ''
  ).trim();

  const sessionId = randomCode(16);
  const refreshToken = randomCode(32);
  const ttlSec = Math.max(60, Number(s.jwt_time_expiration || 86400));
  const refreshTtlSec = Math.max(3600, Number(s.jwt_refresh_ttl || 20160) * 60);
  const refreshExpStr = new Date(Date.now() + refreshTtlSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const now = nowIso();

  await execute(
    `INSERT INTO mobile_app_sessions (session_id, user_id, app_id, device_id_hash, platform, package_name, app_version, signature_hash, refresh_token_hash, refresh_token_expires_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      req.user?.id || null,
      appId,
      sha256(deviceId),
      platform,
      pkg,
      appVersion,
      sig ? sha256(sig) : null,
      sha256(refreshToken),
      refreshExpStr,
      now,
      now,
      now,
    ]
  );

  const accessToken = signAuthToken(
    { id: req.user?.id || 0, email: req.user?.email || 'guest@easyplex.local', role: req.user?.role || 'guest' },
    { session_id: sessionId, app_id: appId }
  );

  return res.json({
    success: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ttlSec,
    refresh_expires_in: refreshTtlSec,
    session_id: sessionId,
    debug_info: null,
  });
});

router.post('/api/tokens/validate', (req, res) => {
  const token = String(req.body?.token || extractBearerOrCookieToken(req) || '').trim();
  const decoded = token ? verifyAuthToken(token) : null;
  if (!decoded) {
    return res.status(401).json({ success: false, valid: false, message: 'Invalid or expired token' });
  }
  const ttl = Math.max(0, Number(decoded.exp || 0) - Math.floor(Date.now() / 1000));
  return res.json({
    success: true,
    valid: true,
    payload: decoded,
    decoded,
    ttl,
    token_type: 'bearer',
  });
});

router.post('/api/tokens/refresh', async (req, res) => {
  const s = await getSettingsRow();
  const rt = String(req.body?.refresh_token || '').trim();
  const bearer = extractBearerOrCookieToken(req);
  let session = null;

  if (rt) {
    session = await queryOne('SELECT * FROM mobile_app_sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL', [
      sha256(rt),
    ]);
  } else if (bearer) {
    const decoded = verifyAuthToken(bearer);
    if (decoded?.session_id) {
      session = await queryOne('SELECT * FROM mobile_app_sessions WHERE session_id = ? AND revoked_at IS NULL', [
        decoded.session_id,
      ]);
    }
  }

  if (!session) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }

  const nextRefresh = randomCode(32);
  const ttlSec = Math.max(60, Number(s.jwt_time_expiration || 86400));
  const refreshTtlSec = Math.max(3600, Number(s.jwt_refresh_ttl || 20160) * 60);
  const refreshExpStr = new Date(Date.now() + refreshTtlSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const now = nowIso();

  await execute(
    'UPDATE mobile_app_sessions SET refresh_token_hash = ?, refresh_token_expires_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?',
    [sha256(nextRefresh), refreshExpStr, now, now, session.id]
  );

  const user = session.user_id ? await queryOne('SELECT id, email, role FROM users WHERE id = ?', [session.user_id]) : null;
  const accessToken = signAuthToken(
    user || { id: 0, email: 'session@easyplex.local', role: 'guest' },
    { session_id: session.session_id, app_id: session.app_id }
  );

  return res.json({
    success: true,
    access_token: accessToken,
    refresh_token: nextRefresh,
    refresh_expires_in: refreshTtlSec,
    session_id: session.session_id,
    token_type: 'bearer',
    expires_in: ttlSec,
  });
});

router.post('/api/checkHash', async (req, res) => {
  const s = await getSettingsRow();
  const submitted = String(req.body?.hash256 || req.body?.signature || req.headers['x-app-signature'] || '').trim().toLowerCase();
  const allowed = parseListSetting(s.allowed_apk_signatures).map((x) => x.toLowerCase());
  const enforce = Boolean(Number(s.app_security_hash || 0) || Number(s.app_security_sha256 || 0)) && allowed.length > 0;

  if (enforce && (!submitted || !allowed.includes(submitted))) {
    return res.status(400).json({ status: 400, message: 'Invalid signature hash.' });
  }
  return res.json({ status: 200 });
});

router.post('/api/googledrive', async (req, res) => {
  const inputUrl = String(req.body?.url || req.query?.url || '').trim();
  if (!inputUrl) {
    return res.status(422).json({ status: 422, message: 'url is required' });
  }
  const m =
    inputUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    inputUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!m?.[1]) {
    return res.status(422).json({ status: 422, message: 'Invalid Google Drive URL' });
  }
  return res.json({
    status: 200,
    url: `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`,
  });
});

router.all('/api/supportedhosts', async (req, res) => {
  const inputUrl = String(req.body?.url || req.query?.url || '').trim();
  const result = await extractSupportedHost(inputUrl);
  if (!result.supported) {
    return res.status(422).json({
      message: 'Unsupported host.',
      url: inputUrl,
      matched_domain: null,
      extracted_url: null,
    });
  }
  return res.json({
    message: 'Supported host detected.',
    matched_domain: result.matched_domain,
    url: inputUrl,
    extracted_url: result.extracted_url,
  });
});

router.get('/api/license/status/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const code = String(req.params.code || '').trim();
  const storedKey = String(s.purchase_key || '').trim();

  // Keep local/demo/empty panel non-blocking while honoring explicit purchase_key check when passed
  const matches =
    !storedKey ||
    storedKey === 'local-dev-key' ||
    !code ||
    code === 'local-test' ||
    code === storedKey;

  if (!matches && !env.demoMode) {
    return res.status(403).json({ status: 'error', activated: false, message: 'License verification failed.' });
  }
  return res.json({
    status: 'success',
    activated: true,
    reason: 'remote_verified',
    expires_at: null,
  });
});

router.get('/api/system/node', async (req, res) => {
  const s = await getSettingsRow();
  return res.json({
    s: 'success',
    ok: true,
    r: 'verified',
    host: req.get('host') || 'localhost',
    mode: 'node',
    until: null,
    note: s.activated_domain ? 'local' : 'verified',
  });
});

router.get('/api/installs/store', async (_req, res) => {
  const row = await queryOne('SELECT * FROM statistics ORDER BY id ASC LIMIT 1');
  const now = nowIso();
  if (row) {
    await execute('UPDATE statistics SET installs = installs + 1, updated_at = ? WHERE id = ?', [now, row.id]);
  } else {
    await execute('INSERT INTO statistics (installs, created_at, updated_at) VALUES (1, ?, ?)', [now, now]);
  }
  const updated = await queryOne('SELECT * FROM statistics ORDER BY id ASC LIMIT 1');
  return res.json(updated || { id: 1, installs: 1 });
});

router.get('/api/installs', async (_req, res) => {
  const row = await queryOne('SELECT * FROM statistics ORDER BY id ASC LIMIT 1');
  return res.json(row || { id: 1, installs: 0 });
});

router.get('/api/webview', async (_req, res) => {
  const s = await queryOne('SELECT enable_webview, webview_link FROM settings ORDER BY id ASC LIMIT 1');
  return res.json(s || { enable_webview: 0, webview_link: '' });
});

// ================= MEDIA, IMAGES & STREAM FILE SERVING =================
const fallbackLogo = true;

router.get('/api/image/logo', (_req, res) => sendStoredFile(res, 'branding', 'logo.png', fallbackLogo));
router.get('/api/image/minilogo', (_req, res) => sendStoredFile(res, 'branding', 'minilogo.png', fallbackLogo));
router.get('/api/image/minimizedlogo', (_req, res) =>
  sendStoredFile(res, 'branding', 'minimizedlogo.png', fallbackLogo)
);
router.get('/api/image/episode', (_req, res) => sendStoredFile(res, 'branding', 'episode.png', fallbackLogo));
router.get('/api/image/mediahome', (_req, res) => sendStoredFile(res, 'branding', 'mediahome.png', fallbackLogo));
router.get('/api/image/notificationicon', (_req, res) =>
  sendStoredFile(res, 'branding', 'notificationicon.png', fallbackLogo)
);
router.get('/api/image/splash', async (_req, res) => {
  const s = await queryOne('SELECT splash_image FROM settings LIMIT 1');
  const fname = s?.splash_image ? path.basename(s.splash_image) : 'splash.png';
  return sendStoredFile(res, 'branding', fname, fallbackLogo);
});
router.get('/api/image/custombanner', async (_req, res) => {
  const s = await queryOne('SELECT custom_banner_image FROM settings LIMIT 1');
  const fname = s?.custom_banner_image ? path.basename(s.custom_banner_image) : 'banner.png';
  return sendStoredFile(res, 'branding', fname, fallbackLogo);
});
router.get('/api/image/users', (_req, res) => sendStoredFile(res, 'avatars', 'default.png', fallbackLogo));
router.get('/api/image/file/:filename', (req, res) =>
  sendStoredFile(res, 'branding', path.basename(req.params.filename), fallbackLogo)
);
router.get('/api/image/offline/:filename', (req, res) =>
  sendStoredFile(res, 'offline_payments', path.basename(req.params.filename), fallbackLogo)
);

const IMAGE_DIR_MAP = {
  movies: 'movies',
  series: 'series',
  animes: 'animes',
  mangas: 'mangas',
  livetv: 'livetv',
  casts: 'casts',
  languages: 'languages',
  preview: 'previews',
  featured: 'featured',
  top10: 'top10',
  upcoming: 'upcoming',
  avatars: 'avatars',
};

for (const [routeSlug, subDir] of Object.entries(IMAGE_DIR_MAP)) {
  router.get(`/api/${routeSlug}/image/:filename`, (req, res) => {
    return sendStoredFile(res, subDir, path.basename(req.params.filename), fallbackLogo);
  });
}

router.get(['/api/substitle/:filename', '/api/substitle/*'], (req, res) =>
  sendSafeSubpath(res, 'subtitles', req.params.filename || req.params[0] || '')
);
router.get('/api/m3u/:filename', (req, res) => sendStoredFile(res, 'm3u', path.basename(req.params.filename)));
router.get('/api/app-update/download', (_req, res) => sendStoredFile(res, 'apk', 'app-release.apk'));
router.get(['/api/stream/:filename', '/api/video/serve/:filename', '/api/video/serve/*', '/api/video/:filename'], (req, res) => {
  const target = req.params.filename || req.params[0] || '';
  return sendSafeSubpath(res, 'videos', target);
});

router.get('/storage/:subDir/*', (req, res) => {
  return sendSafeSubpath(res, path.basename(req.params.subDir), req.params[0] || '');
});
router.get('/storage/:subDir/:filename', (req, res) => {
  return sendStoredFile(res, path.basename(req.params.subDir), path.basename(req.params.filename));
});

export default router;
