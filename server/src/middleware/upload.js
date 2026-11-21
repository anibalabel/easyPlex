import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { execute, nowIso, queryOne } from '../db/mysql.js';
import { ensureUploadedFilesTable } from '../db/schema.js';
import { randomHex } from '../services/crypto.js';

// 1x1 transparent PNG fallback when branding assets haven't been uploaded yet
const TRANSPARENT_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.m3u': 'audio/x-mpegurl',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.apk': 'application/vnd.android.package-archive',
};

function guessMimeType(filename, fallback = 'application/octet-stream') {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return MIME_BY_EXT[ext] || fallback;
}

export function ensureStorageDir(subDir) {
  return String(subDir || 'misc').replace(/[^a-zA-Z0-9_-]/g, '');
}

async function persistUploadedFile(subDir, filename, buffer, mimeType) {
  const folder = ensureStorageDir(subDir);
  const cleanName = path.basename(String(filename || 'file'));
  const bucket = env.storageBucket;
  if (bucket) {
    await bucket.put(`${folder}/${cleanName}`, buffer, {
      httpMetadata: { contentType: mimeType || guessMimeType(cleanName) },
    });
    return;
  }

  await ensureUploadedFilesTable();
  const now = nowIso();
  await execute(
    `INSERT INTO uploaded_files (folder, filename, mime_type, size_bytes, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), content = VALUES(content), updated_at = VALUES(updated_at)`,
    [folder, cleanName, mimeType || guessMimeType(cleanName), buffer.length, buffer, now, now]
  );
}

function makeUploadSaverMiddleware(subDir, { fixedFilename = null, preserveExtension = true } = {}) {
  return async (req, _res, next) => {
    try {
      const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : [];
      for (const f of files) {
        if (!f || !f.buffer) continue;
        const ext = preserveExtension ? path.extname(f.originalname || '').toLowerCase() : '';
        const finalName = fixedFilename || `${Date.now()}-${randomHex(8)}${ext}`;
        f.filename = finalName;
        await persistUploadedFile(subDir, finalName, f.buffer, f.mimetype || guessMimeType(finalName));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function createDiskUpload(subDir, { fixedFilename = null, preserveExtension = true, maxSizeMb = 25 } = {}) {
  const safeMaxMb = Math.min(95, Number(maxSizeMb || 25));
  const memMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: safeMaxMb * 1024 * 1024 },
  });
  const saver = makeUploadSaverMiddleware(subDir, { fixedFilename, preserveExtension });
  return {
    single: (field) => [memMulter.single(field), saver],
    array: (field, maxCount) => [memMulter.array(field, maxCount), saver],
    any: () => [memMulter.any(), saver],
  };
}

export const createUpload = createDiskUpload;

export function publicStorageUrl(req, apiPrefix, filename) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const base = `${proto}://${req.get('host')}`;
  const cleanPrefix = String(apiPrefix || '').replace(/\/+$/, '');
  return `${base}${cleanPrefix}/${encodeURIComponent(filename)}`;
}

export async function sendStoredFile(res, subDir, filename, fallbackFlag = null) {
  const folder = ensureStorageDir(subDir);
  const safeName = path.basename(String(filename || ''));
  if (!safeName && !fallbackFlag) {
    return res.status(404).json({ message: 'File not found.' });
  }

  try {
    const bucket = env.storageBucket;
    if (bucket && safeName) {
      const obj = await bucket.get(`${folder}/${safeName}`);
      if (obj) {
        const ab = await obj.arrayBuffer();
        res.setHeader('Content-Type', obj.httpMetadata?.contentType || guessMimeType(safeName));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(ab));
      }
    }

    if (safeName) {
      await ensureUploadedFilesTable();
      const row = await queryOne(
        'SELECT mime_type, content FROM uploaded_files WHERE folder = ? AND filename = ? LIMIT 1',
        [folder, safeName]
      );
      if (row?.content) {
        const buf = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
        res.setHeader('Content-Type', row.mime_type || guessMimeType(safeName));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
      }
    }
  } catch (err) {
    console.warn('[Upload Read Warning]', err?.message || err);
  }

  if (fallbackFlag) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(TRANSPARENT_PIXEL_PNG);
  }
  return res.status(404).json({ message: 'File not found.' });
}
