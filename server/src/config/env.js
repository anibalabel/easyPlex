import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

export const env = {
  port: Number(process.env.PORT || 8000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'EASYPLEX',
  appUrl: (process.env.APP_URL || 'http://localhost:8000').replace(/\/+$/, ''),
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  jwtSecret: process.env.JWT_SECRET || 'easyplex-local-dev-jwt-secret',
  sessionSecret: process.env.SESSION_SECRET || 'easyplex-local-dev-session-secret',
  dbConnection: String(process.env.DB_CONNECTION || 'sqlite').toLowerCase() === 'mysql' ? 'mysql' : 'sqlite',
  dbHost: process.env.DB_HOST || '127.0.0.1',
  dbPort: Number(process.env.DB_PORT || 3306),
  dbDatabase: process.env.DB_DATABASE || '',
  dbUsername: process.env.DB_USERNAME || '',
  dbPassword: process.env.DB_PASSWORD || '',
  dbSsl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
  sqlitePath: path.resolve(serverRoot, process.env.SQLITE_PATH || './data/easyplex.sqlite'),
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  demoMode: String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true',
  serverRoot,
  projectRoot,
  storageRoot: path.join(serverRoot, 'storage'),
  clientDistDir: path.join(projectRoot, 'client', 'dist'),
};
