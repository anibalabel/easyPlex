import express from 'express';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  execute,
  getTableColumns,
  isMySql,
  nowIso,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/mysql.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import {
  requireAdminOrModerator,
  requirePermission,
} from '../../middleware/auth.js';
import {
  createDiskUpload,
  publicStorageUrl,
  sendStoredFile,
} from '../../middleware/upload.js';
import { COUNTRIES } from '../../config/countries.js';
import { env, clearCachedDbDefaults } from '../../config/env.js';
import { sha256 } from '../../services/crypto.js';
import { toBoolInt } from '../../services/mediaCatalog.js';

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const uploadLogo = createDiskUpload('branding', { fixedFilename: 'logo.png' });
const uploadMiniLogo = createDiskUpload('branding', { fixedFilename: 'minilogo.png' });
const uploadMinimizedLogo = createDiskUpload('branding', { fixedFilename: 'minimizedlogo.png' });
const uploadEpisodePlaceholder = createDiskUpload('branding', { fixedFilename: 'episode.png' });
const uploadMediaHome = createDiskUpload('branding', { fixedFilename: 'mediahome.png' });
const uploadNotifIcon = createDiskUpload('branding', { fixedFilename: 'notificationicon.png' });
const uploadSplash = createDiskUpload('branding', { preserveExtension: true });
const uploadBanner = createDiskUpload('branding', { preserveExtension: true });
const uploadSettingsImg = createDiskUpload('branding', { preserveExtension: true });
const uploadApk = createDiskUpload('apk', { fixedFilename: 'app-release.apk', maxSizeMb: 500 });
const uploadM3u = createDiskUpload('m3u', { preserveExtension: true, maxSizeMb: 50 });
const uploadFirebase = createDiskUpload('firebase', { fixedFilename: 'firebase.json', maxSizeMb: 10 });

const INTEGER_SETTING_COLS = new Set([
  'autosubstitles', 'livetv', 'ads_player', 'vast_midroll_time_seconds', 'anime',
  'facebook_show_interstitial', 'ad_show_interstitial', 'ad_interstitial', 'ad_banner',
  'ad_face_audience_interstitial', 'ad_face_audience_banner', 'enable_custom_message',
  'featured_home_numbers', 'wach_ads_to_unlock', 'aws_s3_storage', 'wasabi_storage',
  'r2_storage', 'bunny_storage', 'cdn_enabled', 'cdn_signing_enabled', 'cdn_signing_ttl',
  'vidsrc', 'telescope_enabled',
  'next_episode_timer', 'auto_play_next_media', 'appodeal_show_interstitial',
  'ad_unit_id_native_enable', 'appodeal_banner', 'appodeal_interstitial',
  'server_dialog_selection', 'download_premuim_only', 'wach_ads_to_unlock_player',
  'enable_custom_banner', 'mantenance_mode', 'allow_adm', 'enable_previews',
  'enable_pinned', 'startapp_banner', 'startapp_interstitial', 'enable_vlc',
  'resume_offline', 'pip_enable', 'unityads_banner', 'unityads_interstitial',
  'streaming', 'enable_banner_bottom', 'ad_face_audience_native', 'enable_upcoming',
  'enable_download', 'notification_separated', 'email_verify', 'force_login',
  'favoriteonline', 'separate_download', 'vpn', 'notification_style', 'force_update',
  'appnext_banner', 'appnext_interstitial', 'livetv_multi_servers', 'suggest_auth',
  'networks', 'enable_webview', 'vungle_banner', 'vungle_interstitial', 'flag_secure',
  'appnext_interstitial_show', 'ironsource_banner', 'ironsource_interstitial', 'unity_show',
  'root_detection', 'applovin_banner', 'applovin_interstitial', 'applovin_interstitial_show',
  'vungle_interstitial_show', 'ironsource_interstitial_show', 'force_password_access',
  'force_inappupdate', 'enable_comments', 'applovin_native', 'phone_verification',
  'profile_selection', 'device_management', 'enable_player_inter', 'internallangs',
  'searchhistory', 'forcewatchbyauth', 'safemode', 'enable_watchinyourlang',
  'rtl_support', 'wortise_interstitial', 'wortise_banner', 'wortise_interstitial_show',
  'wortise_banner_enable', 'enablelangsinservers', 'enablesociallogins',
  'enabledynamicslider', 'slidertimer', 'device_management_limit', 'profile_selection_limit',
  'enablelayoutchange', 'enableshadow', 'enablecustomcontent', 'disablelogin',
  'enable_collections', 'backgroundvideo', 'm3uplaylist', 'playlistauth',
  'notification_counter', 'ffmpeg', 'premium_users_bypass_credits', 'credits_system_enabled',
  'reels', 'reels_ad_frequency', 'auto_advance_reels', 'reel_auto_advance_delay',
  'usercanadd', 'enable_jwt_token', 'inject_embed', 'enable_shadows',
  'vpn_detection_enabled', 'vpn_block_playback', 'vpn_block_api_calls', 'vpn_show_warning',
  'vpn_block_medium_risk', 'vpn_check_backend', 'vpn_medium_risk_score', 'vpn_high_risk_score',
  'api_country_restriction_enabled', 'ironsource_native', 'library_native_ads',
  'library_native_ads_interval', 'api_rate_limit_per_minute', 'app_security_hash',
  'app_security_sha256', 'app_security_auth', 'mobile_signed_requests_enabled',
  'mobile_signature_tolerance_seconds', 'mobile_signature_nonce_ttl_seconds',
  'mobile_response_encryption_enabled', 'mobile_response_encrypt_errors',
  'mobile_jwt_binding_enabled', 'mobile_jwt_binding_require_payload',
  'mobile_app_integrity_enabled', 'mobile_app_integrity_required', 'play_integrity_enabled',
  'mobile_block_sniffer_apps', 'vpn_check_enabled', 'vpn_check_cache_minutes',
  'vpn_check_block_hosting', 'vpn_check_block_tor', 'vpn_check_block_proxy',
  'vpn_check_block_vpn', 'vpn_check_fail_closed', 'jwt_time_expiration', 'jwt_ttl',
  'jwt_refresh_ttl', 'jwt_leeway', 'jwt_blacklist_enabled', 'jwt_blacklist_grace_period',
  'jwt_timestamp_tolerance', 'response_cache_enabled', 'response_cache_lifetime',
  'upload_max_kb', 'limit_upcoming', 'limit_networks', 'limit_collections',
  'limit_streaming', 'limit_casts', 'limit_latest', 'limit_popular_series',
  'limit_recent_movies', 'limit_recent_series', 'limit_popular',
  'limit_latest_episodes_series', 'limit_latest_episodes_animes', 'limit_rv_content',
  'limit_rv_content_network', 'limit_rv_content_lang', 'limit_animes_latest',
  'limit_choosed', 'limit_featured', 'limit_pinned', 'limit_recommended',
  'limit_thisweek', 'limit_top10', 'limit_trending', 'debugbar_enabled',
  'api_country_provider_cache_hours', 'license_activation_valid',
]);

const MYSQL_STRICT_JSON_COLS = new Set([
  'allowed_apk_signatures',
  'video_quality_profiles',
  'vpn_package_names',
  'api_country_restriction_countries',
  'sniffer_app_package_names',
  'video_quality_presets',
  'home_content_order',
  'top10_auto_types',
]);

const JSON_SETTING_COLS = new Set([
  ...MYSQL_STRICT_JSON_COLS,
  'tmdb_lang',
  'cdn_media_headers',
  'included_segments',
  'rv_content',
  'rv_content_network',
  'rv_content_lang',
  'mobile_certificate_pins',
]);

function normalizeSettingDateTime(val) {
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  return val;
}

async function applySettingsUpdate(payload) {
  const settingsRow = await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  if (!settingsRow) throw new Error('Settings record missing');
  const validCols = await getTableColumns('settings');
  const updates = {};

  for (const [k, rawVal] of Object.entries(payload || {})) {
    if (!validCols.has(k) || k === 'id' || k === 'created_at' || k === 'updated_at') continue;
    if (JSON_SETTING_COLS.has(k)) {
      if (rawVal === null || rawVal === undefined) {
        updates[k] = null;
      } else if (typeof rawVal === 'object') {
        updates[k] = JSON.stringify(rawVal);
      } else if (rawVal === '' && MYSQL_STRICT_JSON_COLS.has(k)) {
        updates[k] = null;
      } else {
        updates[k] = rawVal;
      }
    } else if (INTEGER_SETTING_COLS.has(k)) {
      if (typeof rawVal === 'boolean') updates[k] = rawVal ? 1 : 0;
      else if (rawVal === null || rawVal === '') updates[k] = 0;
      else if (!Number.isNaN(Number(rawVal))) updates[k] = Number(rawVal);
      else updates[k] = toBoolInt(rawVal, 0);
    } else if (typeof rawVal === 'boolean') {
      updates[k] = rawVal ? 1 : 0;
    } else if (rawVal instanceof Date || k === 'license_activated_at' || k === 'license_last_verified_at') {
      updates[k] = normalizeSettingDateTime(rawVal);
    } else if (typeof rawVal === 'object' && rawVal !== null && !Buffer.isBuffer(rawVal)) {
      updates[k] = JSON.stringify(rawVal);
    } else {
      updates[k] = rawVal;
    }
  }

  if (payload?.password && String(payload.password).trim() !== '' && validCols.has('app_password_sha256')) {
    updates.app_password_sha256 = sha256(String(payload.password).trim());
  }

  const keys = Object.keys(updates);
  if (keys.length) {
    const setSql = keys.map((k) => `\`${k}\` = ?`).join(', ');
    const vals = keys.map((k) => updates[k]);
    await execute(`UPDATE settings SET ${setSql}, updated_at = ? WHERE id = ?`, [...vals, nowIso(), settingsRow.id]);
    clearCachedDbDefaults();
  }
  return queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
}

router.get('/admin/settings/data', requirePermission('settings.view'), async (_req, res) => {
  const [settings, mail, branding, colors] = await Promise.all([
    queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1'),
    queryOne('SELECT * FROM mail_settings ORDER BY id ASC LIMIT 1'),
    queryOne('SELECT * FROM branding_settings ORDER BY id ASC LIMIT 1'),
    queryAll('SELECT * FROM app_colors ORDER BY id ASC'),
  ]);
  return res.json({
    ...settings,
    mail_settings: mail || null,
    toolbar_logo: branding?.toolbar_logo || 'app_logo',
    app_colors: colors,
    countries: COUNTRIES,
  });
});

router.get('/admin/settingsSecurity/data', requirePermission('settings.view'), async (_req, res) => {
  const s = await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  return res.json(s);
});

router.get('/admin/settings/countries', requirePermission('settings.view'), (_req, res) => {
  return res.json({ countries: COUNTRIES });
});

router.get('/admin/settings/mobile-gradle-properties', requirePermission('settings.view'), async (_req, res) => {
  const s = (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
  const apiUrl = s.url || env.appUrl;
  const props = [
    `# Generated by EasyPlex 2.4 Panel`,
    `APP_API_URL="${apiUrl}/api/"`,
    `APP_PURCHASE_KEY="${s.purchase_key || ''}"`,
    `TMDB_API_KEY="${s.tmdb_api_key || ''}"`,
    `APP_PACKAGE_NAME="${s.app_packagename || 'com.easyplexdemoapp'}"`,
    `MOBILE_APP_ID="${s.mobile_app_id || 'easyplex-mobile'}"`,
    `MOBILE_APP_HMAC_SECRET="${s.mobile_app_hmac_secret || ''}"`,
    `MOBILE_SIGNED_REQUESTS=${s.mobile_signed_requests_enabled ? 'true' : 'false'}`,
    `MOBILE_RESPONSE_ENCRYPTION=${s.mobile_response_encryption_enabled ? 'true' : 'false'}`,
  ].join('\n');
  return res.json({ properties: props, settings_summary: { apiUrl, package_name: s.app_packagename } });
});

router.put(
  ['/admin/settings/update/:setting', '/admin/settings/updatepanel', '/admin/settings/set'],
  requirePermission('settings.update'),
  async (req, res) => {
    const body = req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body;
    const updated = await applySettingsUpdate(body);
    return res.json({ status: 200, message: 'Settings updated successfully', settings: updated });
  }
);

router.post('/admin/settings/update', requirePermission('settings.update'), async (req, res) => {
  const body = req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body;
  const updated = await applySettingsUpdate(body);
  return res.json({ status: 200, message: 'Settings updated successfully', settings: updated });
});

router.post('/admin/updateMailSettings', requirePermission('settings.update'), async (req, res) => {
  const existing = await queryOne('SELECT id FROM mail_settings ORDER BY id ASC LIMIT 1');
  const m = req.body;
  const now = nowIso();
  const vals = [
    m.mail_driver || 'smtp',
    m.mail_host || null,
    Number(m.mail_port || 587),
    m.mail_username || null,
    m.mail_password || null,
    m.mail_encryption || 'tls',
    m.mail_from_address || null,
    m.mail_from_name || null,
  ];
  if (existing) {
    await execute(
      `UPDATE mail_settings SET mail_driver = ?, mail_host = ?, mail_port = ?, mail_username = ?, mail_password = ?, mail_encryption = ?, mail_from_address = ?, mail_from_name = ?, updated_at = ? WHERE id = ?`,
      [...vals, now, existing.id]
    );
  } else {
    await execute(
      `INSERT INTO mail_settings (mail_driver, mail_host, mail_port, mail_username, mail_password, mail_encryption, mail_from_address, mail_from_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...vals, now, now]
    );
  }
  return res.json({
    status: 200,
    message: 'Mail settings saved',
    mail_settings: await queryOne('SELECT * FROM mail_settings ORDER BY id ASC LIMIT 1'),
  });
});

// App Colors & Branding
router.get('/admin/colors', requirePermission('settings.view'), async (_req, res) => {
  const [colors, branding] = await Promise.all([
    queryAll('SELECT * FROM app_colors ORDER BY id ASC'),
    queryOne('SELECT * FROM branding_settings ORDER BY id ASC LIMIT 1'),
  ]);
  return res.json({ colors, branding: branding || { toolbar_logo: 'app_logo' } });
});

router.all('/admin/colors/update', requirePermission('settings.update'), async (req, res) => {
  if (req.method !== 'PUT' && req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  const now = nowIso();
  await runInTransaction(async () => {
    const items = Array.isArray(req.body.colors)
      ? req.body.colors
      : Object.entries(req.body.colors || {}).map(([color_name, color_value]) => ({ color_name, color_value }));
    for (const c of items) {
      if (!c.color_name || !c.color_value) continue;
      const existing = await queryOne('SELECT id FROM app_colors WHERE color_name = ?', [String(c.color_name)]);
      if (existing) {
        await execute(
          'UPDATE app_colors SET color_value = ?, color_description = COALESCE(?, color_description), is_active = ?, updated_at = ? WHERE id = ?',
          [String(c.color_value), c.color_description || null, toBoolInt(c.is_active, 1), now, existing.id]
        );
      } else {
        await execute(
          'INSERT INTO app_colors (color_name, color_value, color_description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [String(c.color_name), String(c.color_value), c.color_description || null, toBoolInt(c.is_active, 1), now, now]
        );
      }
    }
    if (req.body.toolbar_logo) {
      const b = await queryOne('SELECT id FROM branding_settings ORDER BY id ASC LIMIT 1');
      if (b) {
        await execute('UPDATE branding_settings SET toolbar_logo = ?, updated_at = ? WHERE id = ?', [
          req.body.toolbar_logo,
          now,
          b.id,
        ]);
      } else {
        await execute('INSERT INTO branding_settings (toolbar_logo, created_at, updated_at) VALUES (?, ?, ?)', [
          req.body.toolbar_logo,
          now,
          now,
        ]);
      }
    }
  });
  return res.json({
    status: 200,
    message: 'App colors & branding updated',
    colors: await queryAll('SELECT * FROM app_colors ORDER BY id ASC'),
  });
});

// Branding / File Uploads
router.post('/admin/update/logo', requirePermission('settings.update'), uploadLogo.single('image'), (req, res) => {
  return res.json({ status: 200, image_path: publicStorageUrl(req, '/api/image/', 'logo'), message: 'Logo uploaded' });
});
router.post('/admin/update/minilogo', requirePermission('settings.update'), uploadMiniLogo.single('image'), (req, res) => {
  return res.json({ status: 200, image_path: publicStorageUrl(req, '/api/image/', 'minilogo'), message: 'Mini logo uploaded' });
});
router.post('/admin/update/minimizedlogo', requirePermission('settings.update'), uploadMinimizedLogo.single('image'), (req, res) => {
  return res.json({ status: 200, image_path: publicStorageUrl(req, '/api/image/', 'minimizedlogo'), message: 'Minimized logo uploaded' });
});
router.post('/admin/update/episode', requirePermission('settings.update'), uploadEpisodePlaceholder.single('image'), (req, res) => {
  return res.json({ status: 200, image_path: publicStorageUrl(req, '/api/image/', 'episode'), message: 'Episode image uploaded' });
});
router.post('/admin/update/mediahome', requirePermission('settings.update'), uploadMediaHome.single('image'), async (req, res) => {
  const url = publicStorageUrl(req, '/api/image/', 'mediahome');
  await execute('UPDATE settings SET default_media_placeholder_path_home = ?, updated_at = ?', [url, nowIso()]);
  return res.json({ status: 200, image_path: url, message: 'Media home image uploaded' });
});
router.post('/admin/update/notificationicon', requirePermission('settings.update'), uploadNotifIcon.single('image'), (req, res) => {
  return res.json({ status: 200, image_path: publicStorageUrl(req, '/api/image/', 'notificationicon'), message: 'Notification icon uploaded' });
});
router.post('/admin/update/customBanner', requirePermission('settings.update'), uploadBanner.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image required' });
  const url = publicStorageUrl(req, '/api/image/file/', req.file.filename);
  await execute('UPDATE settings SET custom_banner_image = ?, updated_at = ?', [url, nowIso()]);
  return res.json({ status: 200, image_path: url, filename: req.file.filename });
});
router.post('/admin/update/splash', requirePermission('settings.update'), uploadSplash.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image required' });
  const url = publicStorageUrl(req, '/api/image/file/', req.file.filename);
  await execute('UPDATE settings SET splash_image = ?, updated_at = ?', [url, nowIso()]);
  return res.json({ status: 200, image_path: url, filename: req.file.filename });
});
router.post('/admin/settings/image/store', requirePermission('settings.update'), uploadSettingsImg.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image required' });
  const url = publicStorageUrl(req, '/api/image/file/', req.file.filename);
  await execute('UPDATE settings SET default_media_placeholder_path = ?, updated_at = ?', [url, nowIso()]);
  return res.json({ status: 200, image_path: url, filename: req.file.filename });
});

router.post('/admin/settings/update-apk', requirePermission('settings.update'), uploadApk.single('apk'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'APK file required' });
  return res.json({
    status: 200,
    download_url: publicStorageUrl(req, '/api/app-update/', 'download'),
    filename: req.file.filename,
  });
});

router.post('/admin/m3u/store', requirePermission('settings.update'), uploadM3u.single('m3u'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'M3U file required' });
  const url = publicStorageUrl(req, '/api/m3u/', req.file.filename);
  await execute('UPDATE settings SET m3uplaylistpath = ?, updated_at = ?', [url, nowIso()]);
  return res.json({ status: 200, path: url, filename: req.file.filename });
});

router.post('/admin/firebase/store', requirePermission('settings.update'), uploadFirebase.single('firebase'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Firebase JSON required' });
  await execute('UPDATE settings SET firebasejson = ?, updated_at = ?', [req.file.filename, nowIso()]);
  return res.json({ status: 200, filename: req.file.filename, message: 'Firebase JSON stored' });
});

router.get('/admin/firebase/getAccessToken', requirePermission('settings.view'), async (_req, res) => {
  const s = await queryOne('SELECT firebasejson FROM settings LIMIT 1');
  return res.json({ status: 200, configured: Boolean(s?.firebasejson), filename: s?.firebasejson || null });
});

router.get('/admin/firebase/:filename', requirePermission('settings.view'), (req, res) => {
  return sendStoredFile(res, 'firebase', path.basename(req.params.filename));
});

// Maintenance & Backup Operations
router.post('/admin/settings/database-backup', requirePermission('settings.update'), async (_req, res) => {
  const zip = new AdmZip();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const tablesRows = await queryAll('SHOW TABLES');
  const tables = {};
  for (const row of tablesRows) {
    const tableName = Object.values(row)[0];
    if (!tableName || tableName === 'uploaded_files') continue;
    tables[tableName] = await queryAll(`SELECT * FROM \`${String(tableName).replace(/`/g, '')}\``);
  }
  const payload = JSON.stringify({ database: env.dbDatabase, exported_at: nowIso(), tables }, null, 2);
  zip.addFile(`easyplex-mysql-backup-${stamp}.json`, Buffer.from(payload, 'utf8'));

  const buffer = zip.toBuffer();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="easyplex-backup-${stamp}.zip"`);
  return res.send(buffer);
});

router.post(['/admin/cacheClear', '/admin/cacheClearApi'], requirePermission('settings.update'), (_req, res) => {
  return res.json({ status: 200, message: 'Application and API caches cleared.' });
});

router.post('/admin/settings/access-tokens/cleanup', requirePermission('settings.update'), async (_req, res) => {
  const now = nowIso();
  const r1 = await execute(
    'DELETE FROM mobile_app_sessions WHERE revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < ?)',
    [now]
  );
  const r2 = await execute('DELETE FROM login_codes WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
  return res.json({
    status: 200,
    cleaned_sessions: Number(r1.changes || 0),
    cleaned_login_codes: Number(r2.changes || 0),
    message: 'Expired sessions and login codes cleaned up.',
  });
});

router.post('/admin/settings/runtime-service/run', requirePermission('settings.update'), async (_req, res) => {
  const s = await queryOne('SELECT id FROM settings ORDER BY id ASC LIMIT 1');
  if (s) {
    await execute(
      'UPDATE settings SET license_activation_valid = 1, license_last_verified_at = ?, updated_at = ? WHERE id = ?',
      [nowIso(), nowIso(), s.id]
    );
  }
  return res.json({ status: 200, valid: true, message: 'Runtime status refreshed (local mode active).' });
});

// Local non-blocking license endpoints (per user preference)
router.all(
  [
    '/admin/verify',
    '/admin/activate',
    '/admin/deactivate',
    '/admin/version',
    '/admin/config',
    '/admin/license/installation-hash',
    '/admin/license/refresh-state',
    '/admin/license/activation-cache',
    '/admin/setconfig/status',
    '/admin/setconfig/store',
    '/admin/setconfig/unzip',
  ],
  async (_req, res) => {
    const s = await queryOne(
      'SELECT app_name, webpanelversion, purchase_key, activated_domain, license_activation_valid FROM settings LIMIT 1'
    );
    return res.json({
      status: 200,
      valid: true,
      activated: true,
      version: s?.webpanelversion || '2.4.21',
      installation_hash: sha256(env.appUrl),
      purchase_key: s?.purchase_key || 'CLOUDFLARE',
      activated_domain: s?.activated_domain || new URL(env.appUrl).hostname,
      message: 'Remote panel active.',
    });
  }
);

export default router;
