import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2/promise';
import { env, runWithRuntimeEnv } from '../config/env.js';

let fallbackPool = null;

const requestDbStorage = new AsyncLocalStorage();
const txStorage = new AsyncLocalStorage();
const tableColumnsCache = new Map();

export function isMySql() {
  return true;
}

export function randomOrderSql() {
  return 'RAND()';
}

export function castAsText(expr) {
  return `CAST(${expr} AS CHAR)`;
}

function buildConnectionOptions() {
  const hd = env.hyperdrive;
  const host = hd?.host || env.dbHost;
  const port = Number(hd?.port || env.dbPort || 3306);
  const database = hd?.database || env.dbDatabase;
  const user = hd?.user || env.dbUsername;
  const password = hd?.password !== undefined ? hd.password : env.dbPassword;

  if (!host || !database || !user) {
    throw new Error(
      'Remote MySQL configuration missing (DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD or HYPERDRIVE binding).'
    );
  }

  return {
    host,
    port,
    database,
    user,
    password,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
    disableEval: true,
    ...(env.dbSsl && !hd ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

function getFallbackPool() {
  if (!fallbackPool) {
    fallbackPool = mysql.createPool({
      ...buildConnectionOptions(),
      waitForConnections: true,
      connectionLimit: env.dbPoolLimit,
      queueLimit: 0,
    });
  }
  return fallbackPool;
}

async function getActiveExecutor() {
  const txConn = txStorage.getStore();
  if (txConn) return txConn;

  const reqCtx = requestDbStorage.getStore();
  if (reqCtx) {
    if (!reqCtx.connPromise) {
      reqCtx.connPromise = mysql.createConnection(buildConnectionOptions());
    }
    return reqCtx.connPromise;
  }

  return getFallbackPool();
}

export async function runWithRequestDb(cfEnv, fn) {
  return runWithRuntimeEnv(cfEnv, async () => {
    const reqCtx = { connPromise: null, txDepth: 0 };
    try {
      return await requestDbStorage.run(reqCtx, fn);
    } finally {
      if (reqCtx.connPromise) {
        try {
          const conn = await reqCtx.connPromise;
          await conn.end();
        } catch {
          // ignore teardown errors
        }
      }
    }
  });
}

export async function verifyConnection() {
  const executor = await getActiveExecutor();
  await executor.query('SELECT 1 AS ok');
  return true;
}

export async function closeDb() {
  tableColumnsCache.clear();
  if (fallbackPool) {
    const pool = fallbackPool;
    fallbackPool = null;
    try {
      await pool.end();
    } catch {
      // ignore teardown errors
    }
  }
}

export function clearSchemaCache() {
  tableColumnsCache.clear();
}

export function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeParams(params = []) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19).replace('T', ' ');
    }
    if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Uint8Array)) {
      return JSON.stringify(v);
    }
    return v;
  });
}

export async function queryAll(sql, params = []) {
  const safeParams = normalizeParams(params);
  const executor = await getActiveExecutor();
  const [rows] = await executor.query(sql, safeParams);
  return Array.isArray(rows) ? rows : [];
}

export async function queryOne(sql, params = []) {
  const safeParams = normalizeParams(params);
  const executor = await getActiveExecutor();
  const [rows] = await executor.query(sql, safeParams);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
}

export async function execute(sql, params = []) {
  const safeParams = normalizeParams(params);
  const executor = await getActiveExecutor();
  const [result] = await executor.query(sql, safeParams);
  const id = Number(result?.insertId || 0);
  const changes = Number(result?.affectedRows || 0);
  return { lastInsertRowid: id, insertId: id, changes };
}

export async function runInTransaction(fn) {
  const reqCtx = requestDbStorage.getStore();
  if (reqCtx) {
    const conn = await getActiveExecutor();
    const isOuter = reqCtx.txDepth === 0;
    if (isOuter) await conn.beginTransaction();
    reqCtx.txDepth += 1;
    try {
      const result = await txStorage.run(conn, () => fn());
      if (isOuter) await conn.commit();
      return result;
    } catch (err) {
      if (isOuter) {
        try {
          await conn.rollback();
        } catch {
          // ignore rollback error
        }
      }
      throw err;
    } finally {
      reqCtx.txDepth -= 1;
    }
  }

  const existingConn = txStorage.getStore();
  if (existingConn) {
    return fn();
  }
  const pool = getFallbackPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await txStorage.run(conn, () => fn());
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function getTableColumns(tableName) {
  const safeName = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  if (tableColumnsCache.has(safeName)) {
    return tableColumnsCache.get(safeName);
  }
  let cols;
  try {
    const rows = await queryAll(`SHOW COLUMNS FROM \`${safeName}\``);
    cols = new Set(rows.map((r) => r.Field));
  } catch {
    cols = new Set();
  }
  tableColumnsCache.set(safeName, cols);
  return cols;
}

export async function hasColumn(tableName, colName) {
  const cols = await getTableColumns(tableName);
  return cols.has(colName);
}

export async function paginateQuery({
  baseFrom,
  whereSql = '',
  params = [],
  selectSql = '*',
  orderBySql = 'id DESC',
  page = 1,
  perPage = 12,
  mapRow = null,
  req = null,
}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.max(1, Math.min(200, Number(perPage) || 12));
  const offset = (safePage - 1) * safePerPage;
  const trimmedWhere = String(whereSql || '').trim().replace(/^where\s+/i, '');
  const whereClause = trimmedWhere ? `WHERE ${trimmedWhere}` : '';

  const totalRow = await queryOne(`SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`, params);
  const total = Number(totalRow?.total || 0);
  const rows = await queryAll(
    `SELECT ${selectSql} ${baseFrom} ${whereClause} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`,
    [...params, safePerPage, offset]
  );

  const data = mapRow ? await Promise.all(rows.map(mapRow)) : rows;
  const lastPage = Math.max(1, Math.ceil(total / safePerPage));

  if (!req) {
    return {
      current_page: safePage,
      data,
      first_page_url: `?page=1`,
      from: total === 0 ? null : offset + 1,
      last_page: lastPage,
      last_page_url: `?page=${lastPage}`,
      next_page_url: safePage < lastPage ? `?page=${safePage + 1}` : null,
      per_page: safePerPage,
      prev_page_url: safePage > 1 ? `?page=${safePage - 1}` : null,
      to: total === 0 ? null : Math.min(offset + rows.length, total),
      total,
    };
  }

  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const basePath = `${proto}://${req.get('host')}${req.path}`;
  const buildPageUrl = (p) => `${basePath}?page=${p}`;
  const links = [];
  links.push({ url: safePage > 1 ? buildPageUrl(safePage - 1) : null, label: '&laquo; Previous', active: false });
  const startP = Math.max(1, safePage - 3);
  const endP = Math.min(lastPage, safePage + 3);
  for (let p = startP; p <= endP; p += 1) {
    links.push({ url: buildPageUrl(p), label: String(p), active: p === safePage });
  }
  links.push({ url: safePage < lastPage ? buildPageUrl(safePage + 1) : null, label: 'Next &raquo;', active: false });

  return {
    current_page: safePage,
    data,
    first_page_url: buildPageUrl(1),
    from: total === 0 ? null : offset + 1,
    last_page: lastPage,
    last_page_url: buildPageUrl(lastPage),
    links,
    next_page_url: safePage < lastPage ? buildPageUrl(safePage + 1) : null,
    path: basePath,
    per_page: safePerPage,
    prev_page_url: safePage > 1 ? buildPageUrl(safePage - 1) : null,
    to: total === 0 ? null : Math.min(offset + rows.length, total),
    total,
  };
}
