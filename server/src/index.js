import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';

import { env } from './config/env.js';
import { closeDb, isMySql, verifyConnection } from './db/sqlite.js';
import { initSchema } from './db/schema.js';
import { ensureCoreSeed, seedDemoData } from './db/seed.js';
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

export async function createApp() {
  await verifyConnection();
  await initSchema();
  await ensureCoreSeed();
  await seedDemoData();

  const app = express();
  app.set('trust proxy', 1);

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
      db_connection: env.dbConnection,
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

  // Serve built React frontend if available
  if (fs.existsSync(env.clientDistDir)) {
    app.use(express.static(env.clientDistDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/admin/') || req.path.startsWith('/installer-api/')) {
        return next();
      }
      return res.sendFile(path.join(env.clientDistDir, 'index.html'));
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

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isMain) {
  try {
    const app = await createApp();
    const targetInfo = isMySql()
      ? `MySQL ${env.dbUsername}@${env.dbHost}:${env.dbPort}/${env.dbDatabase}`
      : `SQLite ${env.sqlitePath}`;
    const server = app.listen(env.port, () => {
      console.log(`EasyPlex 2.4.21 Backend listening on http://localhost:${env.port} [${targetInfo}]`);
    });
    const shutdown = async () => {
      server.close();
      await closeDb();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    const details =
      err?.message ||
      err?.code ||
      (Array.isArray(err?.errors) ? err.errors.map((e) => e.message || e.code).join('; ') : '') ||
      String(err);
    console.error(
      `[EasyPlex Startup Error] Failed to initialize ${isMySql() ? `MySQL (${env.dbHost}:${env.dbPort}/${env.dbDatabase})` : `SQLite (${env.sqlitePath})`}: ${details}`
    );
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

export default createApp;
