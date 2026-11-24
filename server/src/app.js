import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import {
  env,
  getCachedDbDefaults,
  isWorkersRuntime,
  runWithRuntimeEnv,
  setRuntimeDbDefaults,
} from './config/env.js';
import { isBackendPath, isSpaPageRequest, isStaticAssetPath } from './config/spaRoutes.js';
import { queryOne } from './db/mysql.js';
import { attachAuthUser } from './middleware/auth.js';
import {
  apiSecurityHeaders,
  conditionalJwtCheck,
  conditionalSignedApi,
  encryptApiResponse,
} from './middleware/mobileSecurity.js';

import webAuthRoutes from './routes/auth.js';
import adminDashboardRoutes from './routes/admin/dashboard.js';
import adminTaxonomyRoutes from './routes/admin/taxonomy.js';
import adminServersRoutes from './routes/admin/servers.js';
import adminUsersRoutes from './routes/admin/users.js';
import adminModeratorsRoutes from './routes/admin/moderators.js';
import adminEngagementRoutes from './routes/admin/engagement.js';
import adminMonetizationRoutes from './routes/admin/monetization.js';
import adminMoviesRoutes from './routes/admin/movies.js';
import adminSeriesAnimeRoutes from './routes/admin/seriesAnime.js';
import adminLivetvReelsRoutes from './routes/admin/livetvReels.js';
import adminCuratedRoutes from './routes/admin/curated.js';
import adminVideosRoutes from './routes/admin/videos.js';
import adminSettingsRoutes from './routes/admin/settings.js';

import apiAuthRoutes from './routes/api/auth.js';
import apiCatalogRoutes from './routes/api/catalog.js';
import apiPlayerMonetizationRoutes from './routes/api/playerMonetization.js';
import apiSystemRoutes from './routes/api/system.js';

export function buildApp({ staticDir = null, useNodeEnv = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  const hasStaticDist = Boolean(staticDir && fs.existsSync(path.join(staticDir, 'index.html')));

  if (useNodeEnv) {
    app.use((_req, _res, next) =>
      runWithRuntimeEnv(typeof process !== 'undefined' ? process.env : {}, next)
    );
  }

  if (hasStaticDist) {
    app.use(express.static(staticDir, { index: false }));
    app.use((req, res, next) => {
      if (isSpaPageRequest(req.method, req.path)) {
        return res.sendFile(path.join(staticDir, 'index.html'));
      }
      return next();
    });
  }

  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(
    express.json({
      limit: '50mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(async (req, _res, next) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = req.get('host');
    const requestOrigin = host ? `${proto}://${host}` : '';
    setRuntimeDbDefaults({ requestOrigin });
    if (req.path !== '/health' && !req.path.startsWith('/installer-api/')) {
      const cached = getCachedDbDefaults();
      if (cached) {
        setRuntimeDbDefaults(cached);
      } else {
        try {
          const s = await queryOne('SELECT app_name, url, jwt_secret FROM settings ORDER BY id ASC LIMIT 1');
          if (s) {
            setRuntimeDbDefaults({
              app_name: s.app_name,
              url: s.url,
              jwt_secret: s.jwt_secret,
            });
          }
        } catch (err) {
          if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED' || err?.code === 'ER_ACCESS_DENIED_ERROR') {
            return next(err);
          }
        }
      }
    }
    next();
  });
  app.use(attachAuthUser);
  app.use(apiSecurityHeaders);
  app.use(conditionalSignedApi);
  app.use(conditionalJwtCheck);
  app.use(encryptApiResponse);

  // Healthcheck
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: env.appName,
      version: '2.4.21',
      runtime: isWorkersRuntime ? 'cloudflare-workers' : 'node',
      db_connection: 'mysql',
    });
  });

  // Web/Auth/Installer Routes
  app.use(webAuthRoutes);

  // Mobile/Client REST API Routes (/api/*)
  app.use(apiAuthRoutes);
  app.use(apiSystemRoutes);
  app.use(apiCatalogRoutes);
  app.use(apiPlayerMonetizationRoutes);

  // Admin Panel Routes (/admin/*)
  app.use(adminDashboardRoutes);
  app.use(adminMoviesRoutes);
  app.use(adminSeriesAnimeRoutes);
  app.use(adminLivetvReelsRoutes);
  app.use(adminCuratedRoutes);
  app.use(adminVideosRoutes);
  app.use(adminTaxonomyRoutes);
  app.use(adminServersRoutes);
  app.use(adminUsersRoutes);
  app.use(adminModeratorsRoutes);
  app.use(adminEngagementRoutes);
  app.use(adminMonetizationRoutes);
  app.use(adminSettingsRoutes);

  // SPA fallback for standard Node.js hosting (Cloudflare Workers uses env.ASSETS instead)
  if (hasStaticDist) {
    app.get('*', (req, res, next) => {
      if (isBackendPath(req.path) || isStaticAssetPath(req.path)) {
        return next();
      }
      return res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error('[EasyPlex Error]', err);
    const status = err.status || 500;
    res.status(status).json({
      status,
      message: err.message || 'Internal Server Error',
    });
  });

  return app;
}
