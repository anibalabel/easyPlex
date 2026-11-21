import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

let sqliteInstance = null;
let mysqlPool = null;
let sqliteTxDepth = 0;

const txStorage = new AsyncLocalStorage();
const tableColumnsCache = new Map();

export function isMySql() {
  return env.dbConnection === 'mysql';
}

export function randomOrderSql() {
  return isMySql() ? 'RAND()' : 'RANDOM()';
}

export function castAsText(expr) {
  return isMySql() ? `CAST(${expr} AS CHAR)` : `CAST(${expr} AS TEXT)`;
}

export function getDb() {
  if (isMySql()) {
    if (!mysqlPool) {
      mysqlPool = mysql.createPool({
        host: env.dbHost,
        port: env.dbPort,
        database: env.dbDatabase,
        user: env.dbUsername,
        password: env.dbPassword,
        waitForConnections: true,
        connectionLimit: Math.max(1, Number(process.env.DB_POOL_LIMIT || 3)),
        queueLimit: 0,
        dateStrings: true,
        timezone: 'Z',
        charset: 'utf8mb4',
        ...(env.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      });
    }
    return mysqlPool;
  }

  if (!sqliteInstance) {
    const dir = path.dirname(env.sqlitePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    sqliteInstance = new DatabaseSync(env.sqlitePath);
    sqliteInstance.exec('PRAGMA journal_mode = WAL;');
    sqliteInstance.exec('PRAGMA foreign_keys = ON;');
    sqliteInstance.exec('PRAGMA synchronous = NORMAL;');
  }
  return sqliteInstance;
}

export async function verifyConnection() {
  if (isMySql()) {
    const pool = getDb();
    await pool.query('SELECT 1 AS ok');
    return true;
  }
  getDb();
  return true;
}

export async function closeDb() {
  tableColumnsCache.clear();
  if (mysqlPool) {
    const pool = mysqlPool;
    mysqlPool = null;
    try {
      await pool.end();
    } catch {
      // ignore teardown errors
    }
  }
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
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
  if (isMySql()) {
    const conn = txStorage.getStore() || getDb();
    const [rows] = await conn.query(sql, safeParams);
    return Array.isArray(rows) ? rows : [];
  }
  return getDb().prepare(sql).all(...safeParams);
}

export async function queryOne(sql, params = []) {
  const safeParams = normalizeParams(params);
  if (isMySql()) {
    const conn = txStorage.getStore() || getDb();
    const [rows] = await conn.query(sql, safeParams);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  }
  return getDb().prepare(sql).get(...safeParams);
}

export async function execute(sql, params = []) {
  const safeParams = normalizeParams(params);
  if (isMySql()) {
    const conn = txStorage.getStore() || getDb();
    const [result] = await conn.query(sql, safeParams);
    const id = Number(result?.insertId || 0);
    const changes = Number(result?.affectedRows || 0);
    return { lastInsertRowid: id, insertId: id, changes };
  }
  const result = getDb().prepare(sql).run(...safeParams);
  const id = Number(result?.lastInsertRowid || 0);
  const changes = Number(result?.changes || 0);
  return { lastInsertRowid: id, insertId: id, changes };
}

export async function runInTransaction(fn) {
  if (isMySql()) {
    const existingConn = txStorage.getStore();
    if (existingConn) {
      return fn();
    }
    const pool = getDb();
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
        // ignore rollback failure
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  const db = getDb();
  const isOuter = sqliteTxDepth === 0;
  if (isOuter) db.exec('BEGIN');
  sqliteTxDepth += 1;
  try {
    const result = await fn();
    if (isOuter) db.exec('COMMIT');
    return result;
  } catch (err) {
    if (isOuter) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    sqliteTxDepth -= 1;
  }
}

export async function getTableColumns(tableName) {
  const safeName = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  if (tableColumnsCache.has(safeName)) {
    return tableColumnsCache.get(safeName);
  }
  let cols;
  if (isMySql()) {
    try {
      const rows = await queryAll(`SHOW COLUMNS FROM \`${safeName}\``);
      cols = new Set(rows.map((r) => r.Field));
    } catch {
      cols = new Set();
    }
  } else {
    const rows = await queryAll(`PRAGMA table_info(${safeName})`);
    cols = new Set(rows.map((r) => r.name));
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

  const basePath = `${req.protocol}://${req.get('host')}${req.path}`;
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
