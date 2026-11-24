import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, verifyConnection } from './db/mysql.js';
import { ensureAuxMySqlTables } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const distDir = path.join(projectRoot, 'dist');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.warn(
    `[EasyPlex Warning] Built frontend not found at "${distDir}". Run "npm run build:client" (or upload dist/) before opening the panel.`
  );
}

const app = buildApp({ staticDir: distDir, useNodeEnv: true });
const port = Number(process.env.PORT || 3000);

const server = app.listen(port, () => {
  console.log(`EasyPlex 2.4.21 Node server listening on port ${port}`);
});

if (env.dbHost && env.dbDatabase && env.dbUsername) {
  verifyConnection()
    .then(() => ensureAuxMySqlTables())
    .then(() => {
      console.log(`[EasyPlex DB] Connected to MySQL ${env.dbUsername}@${env.dbHost}:${env.dbPort}/${env.dbDatabase}`);
    })
    .catch((err) => {
      console.warn(`[EasyPlex DB Warning] ${err?.message || err}. Open /installer to check MySQL settings.`);
    });
} else {
  console.warn('[EasyPlex DB Warning] DB_* env vars not configured yet. Open /installer to test connection.');
}

async function shutdown() {
  server.close();
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
