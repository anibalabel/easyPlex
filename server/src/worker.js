import { httpServerHandler } from 'cloudflare:node';
import { buildApp } from './app.js';
import { getCachedKvDbConfig, setCachedKvDbConfig, setRuntimeDbDefaults } from './config/env.js';
import { isBackendPath, isSpaPageRequest, isStaticAssetPath } from './config/spaRoutes.js';
import { queryOne, runWithRequestDb } from './db/mysql.js';
import { getUserWithPermissions } from './middleware/auth.js';
import { verifyAuthToken } from './services/crypto.js';
import { getR2Config, presignUploadPart } from './services/r2.js';

const app = buildApp();
const server = app.listen(8787);
const nodeHandler = httpServerHandler(server);

async function serveSpaIndex(request, env) {
  const url = new URL('/', request.url);
  return env.ASSETS.fetch(
    new Request(url.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    })
  );
}

function extractWorkerAuthToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'easyplex_token') {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

function jsonRes(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Streams an S3 Multipart part directly from the incoming browser Request body
 * to Cloudflare R2 without buffering in Worker memory or requiring R2 bucket CORS.
 */
async function handleWorkerR2MultipartProxy(request, url) {
  const settings = await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1');
  if (settings) {
    setRuntimeDbDefaults({
      jwt_secret: settings.jwt_secret,
      app_name: settings.app_name,
      url: settings.url,
    });
  }

  const token = extractWorkerAuthToken(request);
  const payload = token ? verifyAuthToken(token) : null;
  const user = payload?.sub ? await getUserWithPermissions(payload.sub) : null;
  if (!user || Number(user.active) !== 1) {
    return jsonRes(401, { status: 401, message: 'Session expired. Please sign in again.' });
  }
  const hasPerm =
    user.is_admin ||
    (user.is_moderator && Array.isArray(user.permissions) && user.permissions.includes('video_conversion.create'));
  if (!hasPerm) {
    return jsonRes(403, { status: 403, message: 'Missing required permission: video_conversion.create' });
  }

  const key = String(url.searchParams.get('key') || '').trim().replace(/^\/+/, '');
  const uploadId = String(url.searchParams.get('uploadId') || '').trim();
  const partNumber = Number(url.searchParams.get('partNumber') || 0);
  if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return jsonRes(400, { status: 400, message: 'key, uploadId, and valid partNumber are required.' });
  }

  const r2Cfg = getR2Config(settings);
  if (!r2Cfg.enabled) {
    return jsonRes(422, { status: 422, message: 'Cloudflare R2 is not configured in Settings.' });
  }

  const presignedUrl = presignUploadPart(r2Cfg, { key, uploadId, partNumber, expiresSeconds: 3600 });
  const contentLength = request.headers.get('content-length');
  const putHeaders = new Headers();
  if (contentLength) {
    putHeaders.set('content-length', contentLength);
  }

  const r2Res = await fetch(presignedUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: request.body,
  });

  if (!r2Res.ok) {
    const errText = await r2Res.text().catch(() => '');
    return jsonRes(502, {
      status: 502,
      message: `R2 chunk upload failed (${r2Res.status}): ${errText.slice(0, 250)}`,
    });
  }

  const etag = r2Res.headers.get('etag') || r2Res.headers.get('ETag') || '';
  return jsonRes(200, {
    status: 200,
    partNumber,
    etag,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (env.ASSETS) {
      if (isSpaPageRequest(request.method, pathname)) {
        return serveSpaIndex(request, env);
      }
      if (!isBackendPath(pathname) && isStaticAssetPath(pathname)) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) return assetRes;
      }
      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        !isBackendPath(pathname)
      ) {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) return assetRes;
        return serveSpaIndex(request, env);
      }
    }

    let kvDbConfig = null;
    if (env.CONFIG_KV && !env.HYPERDRIVE) {
      const cached = getCachedKvDbConfig();
      if (cached) {
        kvDbConfig = cached.value;
      } else {
        try {
          kvDbConfig = await env.CONFIG_KV.get('mysql_config', 'json');
          setCachedKvDbConfig(kvDbConfig || null);
        } catch {
          kvDbConfig = null;
        }
      }
    }

    if (request.method === 'PUT' && pathname === '/admin/video/r2/multipart/upload-part') {
      return runWithRequestDb(env, () => handleWorkerR2MultipartProxy(request, url), kvDbConfig);
    }

    return runWithRequestDb(env, () => nodeHandler.fetch(request, env, ctx), kvDbConfig);
  },
};
