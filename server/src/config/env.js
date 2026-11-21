import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';

const runtimeEnvStorage = new AsyncLocalStorage();

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
  return runtimeEnvStorage.run(cfEnv || {}, fn);
}

export function getRuntimeVar(key, fallback = '') {
  const cfStore = runtimeEnvStorage.getStore();
  if (cfStore && cfStore[key] !== undefined && cfStore[key] !== null && cfStore[key] !== '') {
    return cfStore[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  return fallback;
}

export function getRuntimeBinding(name) {
  return runtimeEnvStorage.getStore()?.[name] || null;
}

export const env = {
  get port() {
    return Number(getRuntimeVar('PORT', 8787));
  },
  get nodeEnv() {
    return String(getRuntimeVar('NODE_ENV', 'production'));
  },
  get appName() {
    return String(getRuntimeVar('APP_NAME', 'easyplex-mobile'));
  },
  get appUrl() {
    const raw = getRuntimeVar('APP_URL') || getRuntimeVar('CF_PAGES_URL') || 'https://easyplex.pages.dev';
    return String(raw).replace(/\/+$/, '');
  },
  get jwtSecret() {
    return String(getRuntimeVar('JWT_SECRET', 'easyplex-jwt-secret-change-in-cloudflare-env'));
  },
  get sessionSecret() {
    return String(getRuntimeVar('SESSION_SECRET', 'easyplex-session-secret-change-in-cloudflare-env'));
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
