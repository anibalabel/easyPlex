import { env } from '../config/env.js';
import { queryAll, queryOne } from '../db/sqlite.js';
import { getCreditStatus } from './credits.js';

export const MOBILE_HIDDEN_SETTING_FIELDS = [
  'runtime_installation_secret',
  'stripe_secret_key',
  'paypal_secret',
  'razorpay_key_secret',
  'razorpay_webhook_secret',
  'pix_access_token',
  'aws_access_key_id',
  'aws_secret_access_key',
  'aws_default_region',
  'aws_bucket',
  'wasabi_access_key_id',
  'wasabi_secret_access_key',
  'wasabi_default_region',
  'wasabi_bucket',
  'r2_access_key_id',
  'r2_secret_access_key',
  'r2_bucket',
  'r2_endpoint',
  'r2_public_url',
  'bunny_storage_zone',
  'bunny_access_key',
  'bunny_endpoint',
  'bunny_public_url',
  'cdn_base_url',
  'cdn_signing_key',
  'cdn_signing_ttl',
  'cdn_cache_purge_url',
  'cdn_cache_purge_token',
  'cdn_cache_control',
  'cdn_cors_origins',
  'cdn_media_headers',
  'mobile_app_hmac_secret',
  'mobile_app_id',
  'mobile_signed_requests_enabled',
  'mobile_signature_tolerance_seconds',
  'mobile_signature_nonce_ttl_seconds',
  'mobile_response_encryption_enabled',
  'mobile_response_encryption_mode',
  'mobile_response_encryption_secret',
  'mobile_response_encrypt_errors',
  'mobile_jwt_binding_enabled',
  'mobile_jwt_binding_require_payload',
  'mobile_app_integrity_enabled',
  'mobile_app_integrity_required',
  'play_integrity_enabled',
  'mobile_block_sniffer_apps',
  'sniffer_app_package_names',
  'mobile_certificate_pins',
  'jwt_secret',
  'jwt_time_expiration',
  'jwt_ttl',
  'jwt_refresh_ttl',
  'jwt_algo',
  'jwt_leeway',
  'jwt_blacklist_enabled',
  'jwt_blacklist_grace_period',
  'jwt_timestamp_tolerance',
  'vpn_check_enabled',
  'vpn_check_provider',
  'vpn_check_provider_url',
  'vpn_check_provider_key',
  'vpn_check_cache_minutes',
  'vpn_check_block_hosting',
  'vpn_check_block_tor',
  'vpn_check_block_proxy',
  'vpn_check_block_vpn',
  'vpn_check_fail_closed',
  'mail_driver',
  'mail_host',
  'mail_port',
  'mail_username',
  'mail_password',
  'mail_encryption',
  'mail_from_address',
  'mail_from_name',
  'password',
  'app_password_sha256',
  'purchase_key',
  'license_activated_at',
  'license_last_verified_at',
  'firebasejson',
  'googleapiurl',
  'included_segments',
  'allowed_apk_signatures',
  'api_key',
  'google_client_secret',
  'facebook_client_secret',
  'youtube_api_key',
  'authorization',
  'api_country_provider_key',
  'onesignal_rest_api_key',
  'easyplex_24_upgrade_token',
];

export function resolveRequestBaseUrl(req = null) {
  if (!req) return env.appUrl;
  const proto = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = req.headers['x-forwarded-host']?.split(',')[0]?.trim() || req.get('host');
  if (host) return `${proto}://${host}`.replace(/\/+$/, '');
  return env.appUrl;
}

export function buildDeliveryUrl(value, settings = null, { fallback = null, baseUrl = env.appUrl } = {}) {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (!raw) return fallback;

  let resolved = raw;
  if (!/^https?:\/\//i.test(resolved)) {
    const cleanPath = resolved.startsWith('/') ? resolved : `/${resolved}`;
    resolved = `${baseUrl.replace(/\/+$/, '')}${cleanPath}`;
  }

  const cdnEnabled = Boolean(Number(settings?.cdn_enabled || 0));
  const cdnBase = String(settings?.cdn_base_url || '').trim().replace(/\/+$/, '');
  if (cdnEnabled && cdnBase) {
    try {
      const target = new URL(resolved);
      const appOrigin = new URL(baseUrl).origin;
      const isAppOrigin = target.origin === appOrigin || /^localhost$|^127\.0\.0\.1$/.test(target.hostname);
      const isMediaPath =
        target.pathname.startsWith('/storage/') ||
        target.pathname.startsWith('/api/image/') ||
        target.pathname.includes('/image/') ||
        target.pathname.startsWith('/api/video/') ||
        target.pathname.startsWith('/api/stream/') ||
        target.pathname.startsWith('/api/substitle/') ||
        target.pathname.startsWith('/api/reels/');
      if (isAppOrigin && isMediaPath) {
        return `${cdnBase}${target.pathname}${target.search}`;
      }
    } catch {
      // Leave resolved URL intact if malformed
    }
  }
  return resolved;
}

export function sanitizePublicSettings(row, { branding = null, colors = null, req = null } = {}) {
  if (!row) return {};
  const clone = { ...row };
  const baseUrl = resolveRequestBaseUrl(req);
  const cdnContext = { ...row };

  for (const field of MOBILE_HIDDEN_SETTING_FIELDS) {
    delete clone[field];
  }

  const mediaFields = [
    'splash_image',
    'custom_banner_image',
    'default_media_placeholder_path',
    'default_media_placeholder_path_home',
    'm3uplaylistpath',
  ];
  for (const field of mediaFields) {
    if (clone[field]) {
      clone[field] = buildDeliveryUrl(clone[field], cdnContext, { fallback: '', baseUrl });
    }
  }

  clone.toolbar_logo = branding?.toolbar_logo || clone.toolbar_logo || 'app_logo';
  if (branding?.toolbar_logo_version !== undefined) {
    clone.toolbar_logo_version = Number(branding.toolbar_logo_version || 1);
  }
  if (colors) {
    clone.app_colors = colors;
  }
  return clone;
}

function getVideoTableForKind(kind) {
  const k = String(kind || 'movie').toLowerCase();
  if (k === 'episode' || k === 'serie') return { table: 'serie_videos', fk: 'episode_id' };
  if (k === 'anime_episode' || k === 'anime') return { table: 'anime_videos', fk: 'anime_episode_id' };
  if (k === 'livetv') return { table: 'livetv_videos', fk: 'livetv_id' };
  return { table: 'movie_videos', fk: 'movie_id' };
}

function getDownloadTableForKind(kind) {
  const k = String(kind || 'movie').toLowerCase();
  if (k === 'episode' || k === 'serie') return { table: 'serie_downloads', fk: 'episode_id' };
  if (k === 'anime_episode' || k === 'anime') return { table: 'anime_downloads', fk: 'anime_episode_id' };
  return { table: 'movie_downloads', fk: 'movie_id' };
}

function isRowActive(row) {
  if (row?.is_active !== undefined && row?.is_active !== null) {
    return Boolean(Number(row.is_active));
  }
  if (row?.status !== undefined && row?.status !== null) {
    return Boolean(Number(row.status));
  }
  return true;
}

export function serializeServerRow(row, { kind = 'movie', parentPremium = false, user = null, creditStatus = null, settings = null, baseUrl = env.appUrl } = {}) {
  const userIsPremium = Boolean(Number(user?.premuim || 0));
  const rowPremium = Boolean(Number(row.is_premium || 0));
  const premiumRequired = rowPremium && !userIsPremium;

  const creditsEnabled = Boolean(creditStatus?.credits_system_enabled && creditStatus?.is_credit_enabled);
  const creditsAmount = Number(creditStatus?.credits_required || 0);
  const alreadyUnlocked = Boolean(creditStatus?.already_unlocked);
  const creditRequired = creditsEnabled && creditsAmount > 0 && !alreadyUnlocked ? creditsAmount : 0;

  const blocked = premiumRequired || creditRequired > 0;
  let message = null;
  if (premiumRequired) {
    message = 'Premium subscription required to access this server.';
  } else if (creditRequired > 0) {
    message = `Requires ${creditRequired} credits to unlock.`;
  }

  const rawLink = row.link || '';
  const deliveryLink = blocked ? '' : buildDeliveryUrl(rawLink, settings, { fallback: rawLink, baseUrl });
  const rawEmbed = row.embed_url || (Number(row.embed || 0) ? deliveryLink : '');

  return {
    id: Number(row.id),
    movie_id: row.movie_id ? Number(row.movie_id) : null,
    episode_id: row.episode_id ? Number(row.episode_id) : null,
    anime_episode_id: row.anime_episode_id ? Number(row.anime_episode_id) : null,
    livetv_id: row.livetv_id ? Number(row.livetv_id) : null,
    name: row.name || row.server || 'Server',
    server: row.server || row.name || 'Server',
    server_name: row.server_name || row.server || row.name || 'Server',
    quality: row.quality || 'HD',
    link: deliveryLink,
    url: deliveryLink,
    embed_url: blocked ? '' : rawEmbed,
    lang: row.lang || 'English',
    header: row.header || '',
    useragent: row.useragent || '',
    embed: Number(row.embed || 0),
    hls: Number(row.hls || 0),
    supported_hosts: Number(row.supported_hosts || 0),
    drm: Number(row.drm || 0),
    drmuuid: row.drmuuid || '',
    drmlicenceuri: row.drmlicenceuri || '',
    video_name: row.video_name || row.name || '',
    is_premium: rowPremium ? 1 : 0,
    is_active: isRowActive(row) ? 1 : 0,
    status: Number(row.status ?? 1),
    position: Number(row.position || row.sort_order || 0),
    sort_order: Number(row.sort_order || row.position || 0),
    premium_required: premiumRequired,
    credit_required: creditRequired,
    credits_required: creditRequired,
    credit_balance: Number(creditStatus?.user_balance || 0),
    already_unlocked: alreadyUnlocked || (!premiumRequired && !creditRequired && (userIsPremium || !parentPremium)),
    content_type: kind,
    message,
  };
}

export function serializeDownloadRow(row, { kind = 'movie', user = null, creditStatus = null, settings = null, baseUrl = env.appUrl } = {}) {
  const userIsPremium = Boolean(Number(user?.premuim || 0));
  const rowPremium = Boolean(Number(row.is_premium || 0));
  const downloadPremOnly = Boolean(Number(settings?.download_premuim_only || 0));
  const premiumRequired = (rowPremium || downloadPremOnly) && !userIsPremium;

  const creditsEnabled = Boolean(creditStatus?.credits_system_enabled && creditStatus?.is_credit_enabled);
  const creditsAmount = Number(creditStatus?.credits_required || 0);
  const alreadyUnlocked = Boolean(creditStatus?.already_unlocked);
  const creditRequired = creditsEnabled && creditsAmount > 0 && !alreadyUnlocked ? creditsAmount : 0;

  const blocked = premiumRequired || creditRequired > 0;
  const rawLink = row.link || '';
  const deliveryLink = blocked ? '' : buildDeliveryUrl(rawLink, settings, { fallback: rawLink, baseUrl });

  return {
    id: Number(row.id),
    movie_id: row.movie_id ? Number(row.movie_id) : null,
    episode_id: row.episode_id ? Number(row.episode_id) : null,
    anime_episode_id: row.anime_episode_id ? Number(row.anime_episode_id) : null,
    server: row.server || 'Download',
    name: row.server || 'Download',
    quality: row.quality || 'HD',
    link: deliveryLink,
    url: deliveryLink,
    lang: row.lang || 'English',
    header: row.header || '',
    useragent: row.useragent || '',
    external: Number(row.external || 0),
    supported_hosts: Number(row.supported_hosts || 0),
    is_premium: rowPremium ? 1 : 0,
    is_active: isRowActive(row) ? 1 : 0,
    status: Number(row.status ?? 1),
    position: Number(row.position || 0),
    premium_required: premiumRequired,
    credit_required: creditRequired,
    credits_required: creditRequired,
    credit_balance: Number(creditStatus?.user_balance || 0),
    already_unlocked: alreadyUnlocked || (!premiumRequired && !creditRequired),
    content_type: kind,
    message: premiumRequired ? 'Premium subscription required for download.' : creditRequired > 0 ? `Requires ${creditRequired} credits to unlock.` : null,
  };
}

export async function attachServers(mediaObj, { kind = 'movie', user = null, settings = null, req = null, creditTargetType = null, creditTargetId = null } = {}) {
  if (!mediaObj) return mediaObj;
  const targetId = Number(mediaObj.id);
  const cType = creditTargetType || (kind === 'episode' || kind === 'serie' ? 'series_episode' : kind === 'anime_episode' || kind === 'anime' ? 'anime_episode' : kind === 'livetv' ? 'live_tv' : kind);
  const cId = Number(creditTargetId || targetId);

  const { table, fk } = getVideoTableForKind(kind);
  const rows = Array.isArray(mediaObj.videos)
    ? mediaObj.videos
    : await queryAll(`SELECT * FROM ${table} WHERE ${fk} = ? ORDER BY sort_order ASC, id ASC`, [targetId]);

  const activeRows = rows.filter(isRowActive);
  const creditStatus = ['movie', 'series_episode', 'anime_episode', 'live_tv'].includes(cType)
    ? await getCreditStatus({ user, contentType: cType, contentId: cId })
    : { credits_system_enabled: false, is_credit_enabled: false, credits_required: 0, already_unlocked: true, user_balance: 0 };

  const baseUrl = resolveRequestBaseUrl(req);
  const parentPremium = Boolean(Number(mediaObj.premuim || 0));
  const serialized = activeRows.map((r) =>
    serializeServerRow(r, { kind, parentPremium, user, creditStatus, settings, baseUrl })
  );

  const effectiveCreditRequired =
    creditStatus.credits_system_enabled && creditStatus.is_credit_enabled && !creditStatus.already_unlocked
      ? Number(creditStatus.credits_required || 0)
      : 0;

  return {
    ...mediaObj,
    credit_required: effectiveCreditRequired,
    credits_required: effectiveCreditRequired,
    credit_balance: Number(creditStatus.user_balance || 0),
    already_unlocked: Boolean(creditStatus.already_unlocked),
    servers: serialized,
    videos: serialized.filter((s) => !s.premium_required && s.credit_required === 0),
  };
}

export async function attachDownloads(mediaObj, { kind = 'movie', user = null, settings = null, req = null, creditTargetType = null, creditTargetId = null } = {}) {
  if (!mediaObj) return mediaObj;
  const targetId = Number(mediaObj.id);
  const cType = creditTargetType || (kind === 'episode' || kind === 'serie' ? 'series_episode' : kind === 'anime_episode' || kind === 'anime' ? 'anime_episode' : kind === 'livetv' ? 'live_tv' : kind);
  const cId = Number(creditTargetId || targetId);

  const { table, fk } = getDownloadTableForKind(kind);
  const rows = Array.isArray(mediaObj.downloads)
    ? mediaObj.downloads
    : await queryAll(`SELECT * FROM ${table} WHERE ${fk} = ? ORDER BY sort_order ASC, id ASC`, [targetId]);

  const activeRows = rows.filter(isRowActive);
  const creditStatus = ['movie', 'series_episode', 'anime_episode', 'live_tv'].includes(cType)
    ? await getCreditStatus({ user, contentType: cType, contentId: cId })
    : { credits_system_enabled: false, is_credit_enabled: false, credits_required: 0, already_unlocked: true, user_balance: 0 };

  const baseUrl = resolveRequestBaseUrl(req);
  const serialized = activeRows.map((r) =>
    serializeDownloadRow(r, { kind, user, creditStatus, settings, baseUrl })
  );

  return {
    ...mediaObj,
    download_servers: serialized,
    downloads: serialized.filter((d) => !d.premium_required && d.credit_required === 0),
  };
}

export const SUPPORTED_HOST_DOMAINS = [
  'savefiles.com', 'mediafire.com', 'filemoon.sx', 'filemoon.to', 'filemoon.in',
  'lulustream.com', 'luluvdo.com', 'niikaplayerr.com', 'bigwarp.io', 'bigwarp.art',
  'vidguard.to', 'listeamed.net', 'vgfplay.com', 'mixdrop.co', 'mixdrop.ag', 'mixdrop.sx',
  'goodstream.uno', 'dropload.io', 'rpmhub.site', 'vidhide.com', 'vidhidepro.com',
  'vidhidevip.com', 'embedwish.com', 'streamwish.to', 'streamwish.com', 'streamhls.to',
  'streamable.com', 'vidara.to', 'uqload.to', 'uqload.ws', 'uqload.io', 'voe.sx',
  'd0o0d.com', 'doodstream.com', 'dood.wf', 'dood.yt', 'dood.pm', 'dood.so',
  'streamtape.com', 'streamtape.to', 'upstream.to', 'vidoza.net', 'mp4upload.com',
  'ok.ru', 'vk.com', 'dailymotion.com', 'vimeo.com', 'mega.nz',
];

async function safeFetchText(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
      },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractSupportedHost(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return { supported: false, matched_domain: null, extracted_url: null };

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { supported: false, matched_domain: null, extracted_url: null };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const matched = SUPPORTED_HOST_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`));
  if (!matched) {
    return { supported: false, matched_domain: null, extracted_url: null };
  }

  let extractedUrl = input;
  if (matched === 'streamable.com') {
    const id = parsed.pathname.split('/').filter(Boolean).pop();
    if (id) {
      const html = await safeFetchText(`https://api.streamable.com/videos/${id}`);
      if (html) {
        try {
          const json = JSON.parse(html);
          const mp4 = json?.files?.mp4?.url || json?.files?.['mp4-mobile']?.url;
          if (mp4) extractedUrl = mp4.startsWith('//') ? `https:${mp4}` : mp4;
        } catch {
          // ignore
        }
      }
    }
  } else if (matched === 'mediafire.com') {
    const html = await safeFetchText(input);
    const m = html?.match(/href="(https?:\/\/download\d+\.mediafire\.com\/[^"]+)"/i);
    if (m?.[1]) extractedUrl = m[1];
  } else if (/^(voe\.sx|vidhide|uqload|lulustream|vidara|d0o0d|dood)/.test(matched)) {
    const html = await safeFetchText(input);
    const m3u8 = html?.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    const mp4 = html?.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
    if (m3u8?.[0]) extractedUrl = m3u8[0];
    else if (mp4?.[0]) extractedUrl = mp4[0];
  }

  return {
    supported: true,
    matched_domain: matched,
    extracted_url: extractedUrl,
  };
}
