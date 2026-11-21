import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { queryOne } from '../db/sqlite.js';
import { verifyAuthToken } from '../services/crypto.js';
import { extractBearerOrCookieToken } from './auth.js';

// In-memory replay guard for request nonces (keyed by `${appId}:${nonce}` -> expiryMs)
const nonceReplayCache = new Map();

function pruneNonceCache(nowMs) {
  if (nonceReplayCache.size < 2000) return;
  for (const [k, exp] of nonceReplayCache.entries()) {
    if (exp <= nowMs) nonceReplayCache.delete(k);
  }
}

export async function getMobileSecuritySettings() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

export function resolveMobileSecurityPolicy(settings = {}) {
  const signedRequested = Boolean(Number(settings.mobile_signed_requests_enabled || 0));
  const hmacSecret = String(settings.mobile_app_hmac_secret || '').trim();
  const signedConfigured = hmacSecret.length > 0;
  const signedEffective = signedRequested && signedConfigured;

  const encRequested = Boolean(Number(settings.mobile_response_encryption_enabled || 0));
  const encSecret = String(settings.mobile_response_encryption_secret || hmacSecret || '').trim();
  const encConfigured = encSecret.length > 0;
  const encEffective = encRequested && encConfigured;
  const encMode = String(settings.mobile_response_encryption_mode || 'header').toLowerCase() === 'always' ? 'always' : 'header';

  const jwtBindingEffective = Boolean(Number(settings.mobile_jwt_binding_enabled || 0));
  const jwtRequirePayload = Boolean(Number(settings.mobile_jwt_binding_require_payload || 0));

  const integrityRequested = Boolean(Number(settings.mobile_app_integrity_enabled || 0));
  const integrityEffective = integrityRequested;
  const integrityRequired = Boolean(Number(settings.mobile_app_integrity_required || 0));
  const playIntegrityEnabled = Boolean(Number(settings.play_integrity_enabled || 0));
  const playIntegrityReady = playIntegrityEnabled && Boolean(settings.app_packagename);

  const warnings = [];
  if (signedRequested && !signedConfigured) {
    warnings.push('Signed requests requested but mobile_app_hmac_secret is not configured.');
  }
  if (encRequested && !encConfigured) {
    warnings.push('Response encryption requested but mobile_response_encryption_secret is not configured.');
  }

  return {
    version: 1,
    server_time: Math.floor(Date.now() / 1000),
    app_id: settings.mobile_app_id || 'easyplex-mobile',
    signed_requests: {
      requested: signedRequested,
      configured: signedConfigured,
      effective: signedEffective,
      timestamp_tolerance_seconds: Math.max(5, Number(settings.mobile_signature_tolerance_seconds || 60)),
    },
    response_encryption: {
      requested: encRequested,
      configured: encConfigured,
      effective: encEffective,
      mode: encMode,
    },
    jwt_binding: {
      effective: jwtBindingEffective,
      require_payload: jwtRequirePayload,
    },
    integrity: {
      requested: integrityRequested,
      effective: integrityEffective,
      required: integrityRequired,
      required_effective: integrityEffective && integrityRequired,
      play_integrity_enabled: playIntegrityEnabled,
      play_integrity_ready: playIntegrityReady,
    },
    block_sniffer_apps: Boolean(Number(settings.mobile_block_sniffer_apps || 0)),
    warnings,
    _secrets: {
      hmacSecret,
      encSecret,
      nonceTtlSeconds: Math.max(30, Number(settings.mobile_signature_nonce_ttl_seconds || 120)),
      encryptErrors: Boolean(Number(settings.mobile_response_encrypt_errors || 0)),
    },
  };
}

export function buildPublicPolicyPayload(policy) {
  const { _secrets, ...publicPolicy } = policy;
  return publicPolicy;
}

const SIGNED_EXEMPT_PREFIXES = [
  '/api/security/policy',
  '/api/security/startup-check',
  '/api/startup-check',
  '/api/security/integrity/',
  '/api/integrity/',
  '/api/tokens/',
  '/api/oauth/token/connect',
  '/api/checkHash',
  '/api/supportedhosts',
  '/api/vpn-check',
  '/api/login',
  '/api/register',
  '/api/refresh',
  '/api/password/',
  '/api/email/',
  '/api/image/',
  '/api/movies/image/',
  '/api/series/image/',
  '/api/animes/image/',
  '/api/mangas/image/',
  '/api/livetv/image/',
  '/api/casts/image/',
  '/api/languages/image/',
  '/api/preview/image/',
  '/api/featured/image/',
  '/api/top10/image/',
  '/api/upcoming/image/',
  '/api/avatars/image/',
  '/api/reels/video/',
  '/api/reels/thumbnail/',
  '/api/stream/',
  '/api/video/',
  '/api/substitle/',
  '/api/m3u/',
  '/api/app-update/',
  '/api/ads',
  '/api/vast/',
  '/api/vmap/',
  '/api/embeds/',
];

function isPathExempt(pathStr, prefixes) {
  const p = String(pathStr || '');
  return prefixes.some((pre) => p === pre || p.startsWith(pre));
}

function isAdminBrowserSession(req) {
  return Boolean(req.cookies?.easyplex_token && req.user && ['admin', 'moderator'].includes(req.user.role));
}

export function apiSecurityHeaders(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.path.startsWith('/api/embeds/show/')) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
  }
  next();
}

export function verifySignedRequestPayload({ method, reqPath, timestamp, nonce, appId, signature, rawBody = '', policy }) {
  const expectedAppId = String(policy.app_id || 'easyplex-mobile');
  if (!appId || String(appId) !== expectedAppId) {
    return { ok: false, reason: 'INVALID_APP_ID' };
  }

  const tsNum = Number(timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  const tol = Number(policy.signed_requests?.timestamp_tolerance_seconds || 60);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > tol) {
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  }

  const nonceStr = String(nonce || '').trim();
  if (nonceStr.length < 16) {
    return { ok: false, reason: 'INVALID_NONCE' };
  }

  const cacheKey = `${expectedAppId}:${nonceStr}`;
  const nowMs = Date.now();
  pruneNonceCache(nowMs);
  const existingExp = nonceReplayCache.get(cacheKey);
  if (existingExp && existingExp > nowMs) {
    return { ok: false, reason: 'NONCE_REPLAYED' };
  }

  const bodyHash = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex').toLowerCase();
  const canonical = `${String(method || 'GET').toUpperCase()}\n${reqPath}\n${tsNum}\n${nonceStr}\n${bodyHash}`;
  const secret = policy._secrets.hmacSecret;

  const expectedHex = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex').toLowerCase();
  const expectedB64 = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('base64');

  const sig = String(signature || '').trim();
  const matchesHex =
    sig.length === expectedHex.length &&
    crypto.timingSafeEqual(Buffer.from(sig.toLowerCase(), 'utf8'), Buffer.from(expectedHex, 'utf8'));
  const matchesB64 =
    sig.length === expectedB64.length &&
    crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedB64, 'utf8'));

  if (!matchesHex && !matchesB64) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  }

  nonceReplayCache.set(cacheKey, nowMs + (policy._secrets.nonceTtlSeconds * 1000));
  return { ok: true };
}

export async function conditionalSignedApi(req, res, next) {
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.endsWith('/panel') && req.path.startsWith('/api/search/')) return next();
    if (isPathExempt(req.path, SIGNED_EXEMPT_PREFIXES)) return next();
    if (isAdminBrowserSession(req)) return next();

    const settings = await getMobileSecuritySettings();
    const policy = resolveMobileSecurityPolicy(settings);
    if (!policy.signed_requests.effective) return next();

    const check = verifySignedRequestPayload({
      method: req.method,
      reqPath: req.path,
      timestamp: req.headers['x-timestamp'],
      nonce: req.headers['x-nonce'],
      appId: req.headers['x-app-id'],
      signature: req.headers['x-signature'],
      rawBody: req.rawBody || '',
      policy,
    });

    if (!check.ok) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SIGNED_REQUEST_REJECTED',
          message: 'Unauthorized request.',
        },
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

export function encryptPayloadAes256Gcm({ data, method, reqPath, secret, sessionId = '', nonce = '', timestamp = '' }) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const key = crypto
    .createHmac('sha256', secret)
    .update(`easyplex-response-v1|${sessionId}|${nonce}|${timestamp}`, 'utf8')
    .digest();
  const iv = crypto.randomBytes(12);
  const aadStr = `${String(method || 'GET').toUpperCase()}\n${reqPath}\n${timestamp}\n${nonce}`;
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aadStr, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    alg: 'AES-256-GCM',
    kid: 'mobile-response-v1',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    aad: Buffer.from(aadStr, 'utf8').toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export async function encryptApiResponse(req, res, next) {
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path === '/api/security/policy' || req.path === '/api/supportedhosts') return next();
    if (req.path.startsWith('/api/search/') && req.path.endsWith('/panel')) return next();

    const settings = await getMobileSecuritySettings();
    const policy = resolveMobileSecurityPolicy(settings);
    if (!policy.response_encryption.effective) return next();

    const headerVal = String(req.headers['x-encrypt-response'] || '').trim().toLowerCase();
    const explicitHeader = ['1', 'true', 'yes'].includes(headerVal);
    if (isAdminBrowserSession(req) && !explicitHeader) return next();

    const shouldEncrypt =
      policy.response_encryption.mode === 'always' ||
      explicitHeader ||
      req.path.startsWith('/api/watch-history/');
    if (!shouldEncrypt) return next();

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const statusCode = res.statusCode || 200;
      if (statusCode === 204 || (body && typeof body === 'object' && body.encrypted === true)) {
        return originalJson(body);
      }
      if (statusCode >= 400 && !policy._secrets.encryptErrors) {
        return originalJson(body);
      }

      const sessionId = String(req.headers['x-session-id'] || '');
      const nonce = String(req.headers['x-nonce'] || '');
      const timestamp = String(req.headers['x-timestamp'] || Math.floor(Date.now() / 1000));
      const envelope = encryptPayloadAes256Gcm({
        data: body,
        method: req.method,
        reqPath: req.path,
        secret: policy._secrets.encSecret,
        sessionId,
        nonce,
        timestamp,
      });
      res.setHeader('X-Content-Encrypted', 'AES-256-GCM');
      return originalJson(envelope);
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

export async function conditionalJwtCheck(req, res, next) {
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/search/') && req.path.endsWith('/panel')) return next();
    if (isPathExempt(req.path, [...SIGNED_EXEMPT_PREFIXES, '/api/settings', '/api/getconfig', '/api/colors', '/api/installs', '/api/webview', '/api/license/', '/api/system/node', '/api/user'])) {
      return next();
    }
    if (isAdminBrowserSession(req)) return next();

    const settings = await getMobileSecuritySettings();
    const enableJwt = Boolean(Number(settings.enable_jwt_token || 0));
    if (!enableJwt) return next();

    const token = extractBearerOrCookieToken(req);
    const decoded = token ? verifyAuthToken(token) : null;
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Valid JWT token is required.',
        },
      });
    }
    req.jwtPayload = decoded;
    return next();
  } catch (err) {
    return next(err);
  }
}
