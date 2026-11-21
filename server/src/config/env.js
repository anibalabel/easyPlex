import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';

const runtimeEnvStorage = new AsyncLocalStorage();
const cachedDbDefaults = {
  jwt_secret: '',
  app_name: '',
  url: '',
  fetchedAt: 0,
};
const DB_DEFAULTS_TTL_MS = 60_000;

export function getCachedDbDefaults() {
  if (cachedDbDefaults.fetchedAt && Date.now() - cachedDbDefaults.fetchedAt < DB_DEFAULTS_TTL_MS) {
    return cachedDbDefaults;
  }
  return null;
}

export function clearCachedDbDefaults() {
  cachedDbDefaults.fetchedAt = 0;
}

// Only attempt dotenv loading when running under plain local Node (skipped cleanly inside Cloudflare Workers)
try {
  const isWorkersRuntime =
    typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
  if (!isWorkersRuntime && typeof process !== 'undefined' && process.cwd) {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(dirname, '..', '..', '..');
    dotenv.config({ path: path.join(projectRoot, '.env') });
  }
} catch {
  // Cloudflare Workers / Pages supply environment bindings directly per request
}

export function runWithRuntimeEnv(cfEnv, fn) {
  return runtimeEnvStorage.run(
    {
      bindings: cfEnv || {},
      dbDefaults: {},
      requestOrigin: '',
    },
    fn
  );
}

export function setRuntimeDbDefaults({ jwt_secret, app_name, url, requestOrigin } = {}) {
  const store = runtimeEnvStorage.getStore();
  if (jwt_secret) {
    const val = String(jwt_secret).trim();
    cachedDbDefaults.jwt_secret = val;
    if (store) store.dbDefaults.jwt_secret = val;
  }
  if (app_name) {
    const val = String(app_name).trim();
    cachedDbDefaults.app_name = val;
    if (store) store.dbDefaults.app_name = val;
  }
  if (url) {
    const val = String(url).trim();
    cachedDbDefaults.url = val;
    if (store) store.dbDefaults.url = val;
  }
  if (jwt_secret || app_name || url) {
    cachedDbDefaults.fetchedAt = Date.now();
  }
  if (requestOrigin && store) {
    store.requestOrigin = String(requestOrigin).replace(/\/+$/, '');
  }
}

export function getRuntimeVar(key, fallback = '') {
  const store = runtimeEnvStorage.getStore();
  const cfVal = store?.bindings?.[key];
  if (cfVal !== undefined && cfVal !== null && cfVal !== '') {
    return cfVal;
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  return fallback;
}

export function getRuntimeBinding(name) {
  return runtimeEnvStorage.getStore()?.bindings?.[name] || null;
}

export const env = {
  get port() {
    return Number(getRuntimeVar('PORT', 8787));
  },
  get nodeEnv() {
    return String(getRuntimeVar('NODE_ENV', 'production'));
  },
  get appName() {
    const store = runtimeEnvStorage.getStore();
    return String(store?.dbDefaults?.app_name || getRuntimeVar('APP_NAME', 'easyplex-mobile'));
  },
  get appUrl() {
    const store = runtimeEnvStorage.getStore();
    const raw =
      store?.dbDefaults?.url ||
      getRuntimeVar('APP_URL') ||
      store?.requestOrigin ||
      getRuntimeVar('CF_PAGES_URL') ||
      'https://easyplex.pages.dev';
    return String(raw).replace(/\/+$/, '');
  },
  get jwtSecret() {
    const store = runtimeEnvStorage.getStore();
    return String(
      getRuntimeVar('JWT_SECRET') ||
        store?.dbDefaults?.jwt_secret ||
        'easyplex-default-secret'
    );
  },
  get dbConnection() {
    return 'mysql';
  },
  get dbHost() {
    return String(getRuntimeVar('DB_HOST', ''));
  },
  get dbPort() {
    return Number(getRuntimeVar('DB_PORT', 3306));
  },
  get dbDatabase() {
    return String(getRuntimeVar('DB_DATABASE', ''));
  },
  get dbUsername() {
    return String(getRuntimeVar('DB_USERNAME', ''));
  },
  get dbPassword() {
    return String(getRuntimeVar('DB_PASSWORD', ''));
  },
  get dbSsl() {
    return String(getRuntimeVar('DB_SSL', 'false')).toLowerCase() === 'true';
  },
  get dbPoolLimit() {
    return Math.max(1, Number(getRuntimeVar('DB_POOL_LIMIT', 3)));
  },
  get tmdbApiKey() {
    return String(getRuntimeVar('TMDB_API_KEY', ''));
  },
  get hyperdrive() {
    return getRuntimeBinding('HYPERDRIVE');
  },
  get storageBucket() {
    return getRuntimeBinding('STORAGE_BUCKET');
  },
};
