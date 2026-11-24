import { httpServerHandler } from 'cloudflare:node';
import { buildApp } from './app.js';
import { getCachedKvDbConfig, setCachedKvDbConfig } from './config/env.js';
import { isBackendPath, isSpaPageRequest, isStaticAssetPath } from './config/spaRoutes.js';
import { runWithRequestDb } from './db/mysql.js';

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

    return runWithRequestDb(env, () => nodeHandler.fetch(request, env, ctx), kvDbConfig);
  },
};
