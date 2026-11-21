import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { randomHex } from '../services/crypto.js';

export function ensureStorageDir(subDir) {
  const dir = path.join(env.storageRoot, subDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createDiskUpload(subDir, { fixedFilename = null, preserveExtension = true, maxSizeMb = 500 } = {}) {
  const targetDir = ensureStorageDir(subDir);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, targetDir),
    filename: (_req, file, cb) => {
      if (fixedFilename) {
        return cb(null, fixedFilename);
      }
      const ext = preserveExtension ? path.extname(file.originalname || '').toLowerCase() : '';
      return cb(null, `${Date.now()}-${randomHex(8)}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
  });
}

export function publicStorageUrl(req, apiPrefix, filename) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}${apiPrefix}/${encodeURIComponent(filename)}`;
}

export function sendStoredFile(res, subDir, filename, fallbackFile = null) {
  const safeName = path.basename(String(filename || ''));
  const dir = ensureStorageDir(subDir);
  const filePath = path.join(dir, safeName);
  if (safeName && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  if (fallbackFile && fs.existsSync(fallbackFile)) {
    return res.sendFile(fallbackFile);
  }
  return res.status(404).json({ message: 'File not found.' });
}
