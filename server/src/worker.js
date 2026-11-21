import { httpServerHandler } from 'cloudflare:node';
import { buildApp } from './app.js';
import { getCachedKvDbConfig, setCachedKvDbConfig } from './config/env.js';
import { runWithRequestDb } from './db/mysql.js';

const app = buildApp();
const server = app.listen(8787);
const nodeHandler = httpServerHandler(server);

const SPA_EXACT_ROUTES = new Set([
  '/',
  '/home',
  '/login',
  '/register',
  '/email/verify',
  '/installer',
  '/admin',
  '/admin/account',
  '/admin/movies',
  '/admin/series',
  '/admin/animes',
  '/admin/mangas',
  '/admin/streaming',
  '/admin/reels',
  '/admin/featured',
  '/admin/top10',
  '/admin/upcoming',
  '/admin/previews',
  '/admin/requests',
  '/admin/video-conversion',
  '/admin/genres',
  '/admin/categories',
  '/admin/collections',
  '/admin/networks',
  '/admin/certifications',
  '/admin/languages',
  '/admin/casters',
  '/admin/servers',
  '/admin/headers',
  '/admin/users',
  '/admin/moderators',
  '/admin/comments',
  '/admin/reports',
  '/admin/suggestions',
  '/admin/plans',
  '/admin/offline-payments',
  '/admin/credits',
  '/admin/ads',
  '/admin/notifications',
  '/admin/settings',
  '/admin/api-explorer',
]);

function isSpaPageRequest(request, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (SPA_EXACT_ROUTES.has(pathname)) return true;
  if (pathname.startsWith('/password/reset') || pathname.startsWith('/embed/')) return true;
  return false;
}

function isStaticAssetPath(pathname) {
  if (pathname.startsWith('/assets/')) return true;
  return /\.(js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|txt)$/i.test(pathname);
}

function isBackendPath(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/installer-api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/storage/') ||
    pathname === '/health'
  );
}

async function serveSpaIndex(request, env) {
  const url = new URL('/', request.url);
  return env.ASSETS.fetch(
    new Request(url.toString(), {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: request.headers,
    })
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (env.ASSETS) {
      if (isSpaPageRequest(request, pathname)) {
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

    return runWithRequestDb(env, () => nodeHandler.fetch(request, env, ctx), kvDbConfig);
  },
};
