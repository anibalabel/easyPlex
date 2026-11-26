import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { env } from '../../config/env.js';
import {
  execute,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/mysql.js';
import { ensureUploadedFilesTable, ensureVideoLibraryTable } from '../../db/schema.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import {
  requireAdminOrModerator,
  requirePermission,
} from '../../middleware/auth.js';
import {
  createDiskUpload,
  publicStorageUrl,
} from '../../middleware/upload.js';
import { randomCode } from '../../services/crypto.js';
import {
  abortMultipartUploadR2,
  buildR2DeliveryUrl,
  buildR2ObjectKey,
  completeMultipartUploadR2,
  createMultipartUploadR2,
  deleteObjectR2,
  extractR2Key,
  getDirectoryForMediaType,
  getR2Config,
  isR2Configured,
  listObjectsR2,
  presignPutObject,
  presignUploadPart,
  putBucketCorsR2,
  putObjectR2,
  sanitizeVideoFilename,
} from '../../services/r2.js';

const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
const DEFAULT_PART_SIZE_BYTES = 32 * 1024 * 1024;

function computeMultipartPlan(fileSize) {
  const minPartSize = 10 * 1024 * 1024;
  let partSize = DEFAULT_PART_SIZE_BYTES;
  if (Math.ceil(fileSize / partSize) > 1000) {
    partSize = Math.max(minPartSize, Math.ceil(fileSize / 1000));
    const mb = 1024 * 1024;
    partSize = Math.ceil(partSize / mb) * mb;
  }
  const totalParts = Math.max(1, Math.ceil(fileSize / partSize));
  return { partSize, totalParts };
}

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

// Memory upload up to 95 MB (Cloudflare Workers isolate ceiling); larger files upload directly to R2 via presigned PUT
const rawVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 95 * 1024 * 1024 },
});
const chunkUpload = createDiskUpload('video_chunks', { preserveExtension: true, maxSizeMb: 95 });

function normalizeVideoFormat(filename) {
  const ext = path.extname(String(filename || '').split('?')[0]).replace('.', '').toLowerCase();
  if (['mp4', 'hls', 'hls_master'].includes(ext)) return ext;
  if (ext === 'm3u8') return 'hls';
  if (['mkv', 'webm', 'mov', 'avi', 'm4v', 'ts'].includes(ext)) return ext;
  return 'mp4';
}

function normalizeVideoType(rawType, episodeId) {
  const allowed = ['trailer', 'full_movie', 'teaser', 'clip', 'episode'];
  if (allowed.includes(rawType)) return rawType;
  return episodeId ? 'episode' : 'full_movie';
}

function normalizeLibraryMediaType(rawType, episodeId) {
  const t = String(rawType || '').toLowerCase();
  if (episodeId || ['episode', 'serie', 'series'].includes(t)) return 'episode';
  if (['anime', 'anime_episode'].includes(t)) return 'anime';
  if (['general', 'upload'].includes(t)) return 'general';
  return 'movie';
}

function parseQualityList(rawQualities, fallbackQuality = 'Original') {
  if (Array.isArray(rawQualities) && rawQualities.length) {
    return rawQualities.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 10);
  }
  if (typeof rawQualities === 'string' && rawQualities.trim()) {
    try {
      const parsed = JSON.parse(rawQualities);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((q) => String(q || '').trim()).filter(Boolean);
      }
    } catch {
      const split = rawQualities.split(',').map((s) => s.trim()).filter(Boolean);
      if (split.length) return split;
    }
  }
  return [String(fallbackQuality || 'Original').trim() || 'Original'];
}

async function getSettingsRow() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

/**
 * Registers an uploaded/stored video in `video_library` cleanly,
 * and if `movieId` or `episodeId` is set (satisfying MySQL `check_parent_entity`),
 * also records rows in `videos`, `video_versions`, and `video_processing_jobs`.
 */
async function registerUploadedVideo({
  title = '',
  originalName,
  fileKey,
  streamUrl,
  fileSize = 0,
  storage = 'r2',
  bucket = null,
  directory = 'movies/originals',
  mediaType = 'movie',
  quality = 'Original',
  selectedQualities = null,
  movieId = null,
  episodeId = null,
  autoAttach = false,
}) {
  await ensureVideoLibraryTable();
  const code = randomCode(10);
  const jobId = `job_${randomCode(12)}`;
  const now = nowIso();
  const cleanOriginal = String(originalName || path.basename(fileKey || 'video.mp4'));
  const cleanTitle = String(title || '').trim() || cleanOriginal.replace(/\.[^.]+$/, '');
  const format = normalizeVideoFormat(fileKey || cleanOriginal);
  const cleanQuality = String(quality || selectedQualities?.[0] || 'Original').slice(0, 32);
  const quals = Array.isArray(selectedQualities) && selectedQualities.length ? selectedQualities : [cleanQuality];
  const libMediaType = normalizeLibraryMediaType(mediaType, episodeId);
  const serverLabel = storage === 'r2' ? 'Cloudflare R2' : storage === 'external' ? 'External URL' : 'Local Server';

  const result = await runInTransaction(async () => {
    const libIns = await execute(
      `INSERT INTO video_library
        (code, title, original_name, media_type, directory, file_key, stream_url, format, quality, file_size, storage, bucket, movie_id, episode_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        cleanTitle,
        cleanOriginal,
        libMediaType,
        directory,
        fileKey,
        streamUrl,
        format,
        cleanQuality,
        Number(fileSize || 0),
        storage,
        bucket || null,
        movieId ? Number(movieId) : null,
        episodeId ? Number(episodeId) : null,
        now,
        now,
      ]
    );
    const libraryId = Number(libIns.lastInsertRowid);

    let video = null;
    let job = null;
    let versions = [];

    // Production MySQL enforces CHECK ((movie_id IS NOT NULL AND episode_id IS NULL) OR (movie_id IS NULL AND episode_id IS NOT NULL))
    const hasSingleParent = (movieId && !episodeId) || (!movieId && episodeId);
    if (hasSingleParent) {
      const videoType = normalizeVideoType(mediaType, episodeId);
      const dbFormat = format === 'hls' ? 'hls' : 'mp4';
      const vidIns = await execute(
        `INSERT INTO videos (movie_id, episode_id, type, code, original_name, file_size, path, stream_url, cdn_url, storage, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [
          movieId ? Number(movieId) : null,
          episodeId ? Number(episodeId) : null,
          videoType,
          code,
          cleanOriginal,
          Number(fileSize || 0),
          fileKey,
          streamUrl,
          streamUrl,
          storage,
          now,
          now,
        ]
      );
      const videoId = Number(vidIns.lastInsertRowid);

      for (const q of quals) {
        await execute(
          `INSERT INTO video_versions (video_id, path, format, quality, file_size, cdn_url, cloud_url, storage, storage_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            videoId,
            fileKey,
            dbFormat,
            String(q).slice(0, 10),
            Number(fileSize || 0),
            streamUrl,
            storage === 'r2' ? streamUrl : null,
            storage,
            storage,
            now,
            now,
          ]
        );
      }

      await execute(
        `INSERT INTO video_processing_jobs (job_id, video_id, status, progress, message, selected_qualities, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, 'completed', 100, ?, ?, ?, ?, ?, ?)`,
        [
          jobId,
          videoId,
          storage === 'r2' ? 'Uploaded directly to Cloudflare R2' : 'Stored and ready for streaming',
          JSON.stringify(quals),
          now,
          now,
          now,
          now,
        ]
      );

      if (autoAttach && movieId) {
        await execute(
          `INSERT INTO movie_videos (movie_id, server, quality, link, video_name, hls, status, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [Number(movieId), serverLabel, cleanQuality, streamUrl, cleanTitle, format === 'hls' ? 1 : 0, now, now]
        );
      }
      if (autoAttach && episodeId) {
        await execute(
          `INSERT INTO serie_videos (episode_id, server, quality, link, video_name, hls, status, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [Number(episodeId), serverLabel, cleanQuality, streamUrl, cleanTitle, format === 'hls' ? 1 : 0, now, now]
        );
      }

      [video, job, versions] = await Promise.all([
        queryOne('SELECT * FROM videos WHERE id = ?', [videoId]),
        queryOne('SELECT * FROM video_processing_jobs WHERE job_id = ?', [jobId]),
        queryAll('SELECT * FROM video_versions WHERE video_id = ?', [videoId]),
      ]);
    }

    const item = await queryOne('SELECT * FROM video_library WHERE id = ?', [libraryId]);
    return {
      item,
      video,
      job,
      versions,
      stream_url: streamUrl,
      video_path: streamUrl,
      path: fileKey,
      video_name: cleanTitle,
      server: serverLabel,
      storage,
      quality: cleanQuality,
      hls: format === 'hls' ? 1 : 0,
    };
  });

  return result;
}

async function storeBufferToActiveStorage({ req, buffer, originalName, mimeType, mediaType = 'movie' }) {
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  const directory = getDirectoryForMediaType(mediaType);
  const cleanOriginal = String(originalName || 'video.mp4');

  if (r2Cfg.enabled) {
    const key = buildR2ObjectKey(mediaType, cleanOriginal);
    await putObjectR2(r2Cfg, {
      key,
      buffer,
      contentType: mimeType || 'video/mp4',
    });
    const streamUrl = buildR2DeliveryUrl(r2Cfg, key, settings);
    return {
      fileKey: key,
      streamUrl,
      directory,
      storage: 'r2',
      bucket: r2Cfg.bucket,
    };
  }

  const filename = `${Date.now()}-${randomCode(8)}-${sanitizeVideoFilename(cleanOriginal)}`;
  if (env.storageBucket) {
    await env.storageBucket.put(`videos/${filename}`, buffer, {
      httpMetadata: { contentType: mimeType || 'video/mp4' },
    });
    return {
      fileKey: `videos/${filename}`,
      streamUrl: publicStorageUrl(req, '/api/stream/', filename),
      directory: 'videos',
      storage: 'local',
      bucket: 'STORAGE_BUCKET',
    };
  }

  await ensureUploadedFilesTable();
  const now = nowIso();
  await execute(
    `INSERT INTO uploaded_files (folder, filename, mime_type, size_bytes, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), content = VALUES(content), updated_at = VALUES(updated_at)`,
    ['videos', filename, mimeType || 'video/mp4', buffer.length, buffer, now, now]
  );

  return {
    fileKey: filename,
    streamUrl: publicStorageUrl(req, '/api/stream/', filename),
    directory: 'videos',
    storage: 'local',
    bucket: null,
  };
}

// ==================== CLOUDFLARE R2 DIRECT PRESIGN & LIBRARY ====================

// 1) Generate S3 SigV4 presigned PUT URL (or S3 Multipart plan for large files > 50 MB)
router.post('/admin/video/r2/presign', requirePermission('video_conversion.create'), async (req, res) => {
  const filename = String(req.body?.filename || '').trim();
  if (!filename) {
    return res.status(400).json({ status: 400, message: 'Filename is required' });
  }
  const fileSize = Number(req.body?.file_size || 0);
  const contentType = String(req.body?.content_type || 'video/mp4').trim() || 'video/mp4';
  const mediaType = req.body?.episode_id ? 'episode' : req.body?.type || 'movie';
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);

  if (!r2Cfg.enabled) {
    return res.json({
      status: 200,
      mode: 'server_upload',
      r2_configured: false,
      has_worker_fallback: fileSize <= 95 * 1024 * 1024,
      max_worker_mb: 95,
      message: 'Cloudflare R2 S3 credentials are not enabled in Settings; using standard panel storage upload.',
    });
  }

  const key = buildR2ObjectKey(mediaType, filename);
  const publicUrl = buildR2DeliveryUrl(r2Cfg, key, settings);

  if (fileSize > MULTIPART_THRESHOLD_BYTES) {
    const uploadId = await createMultipartUploadR2(r2Cfg, { key, contentType });
    const { partSize, totalParts } = computeMultipartPlan(fileSize);
    const initialCount = Math.min(totalParts, 150);
    const partUrls = {};
    for (let p = 1; p <= initialCount; p += 1) {
      partUrls[p] = presignUploadPart(r2Cfg, { key, uploadId, partNumber: p, expiresSeconds: 7200 });
    }
    return res.json({
      status: 200,
      mode: 'multipart_r2',
      r2_configured: true,
      upload_id: uploadId,
      key,
      directory: getDirectoryForMediaType(mediaType),
      public_url: publicUrl,
      bucket: r2Cfg.bucket,
      storage: 'r2',
      part_size: partSize,
      total_parts: totalParts,
      part_urls: partUrls,
      max_worker_mb: 95,
    });
  }

  const uploadUrl = presignPutObject(r2Cfg, { key, expiresSeconds: 3600 });

  return res.json({
    status: 200,
    mode: 'presigned_r2',
    r2_configured: true,
    upload_url: uploadUrl,
    key,
    directory: getDirectoryForMediaType(mediaType),
    public_url: publicUrl,
    bucket: r2Cfg.bucket,
    storage: 'r2',
    has_worker_fallback: fileSize <= 95 * 1024 * 1024,
    max_worker_mb: 95,
  });
});

// 1b) Sign additional multipart upload part URLs on demand for very large files
router.post('/admin/video/r2/multipart/sign-part', requirePermission('video_conversion.create'), async (req, res) => {
  const key = String(req.body?.key || '').trim().replace(/^\/+/, '');
  const uploadId = String(req.body?.upload_id || '').trim();
  const partNumbers = Array.isArray(req.body?.part_numbers)
    ? req.body.part_numbers.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000).slice(0, 100)
    : [];

  if (!key || !uploadId || !partNumbers.length) {
    return res.status(400).json({ status: 400, message: 'key, upload_id and part_numbers are required.' });
  }
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  if (!r2Cfg.enabled) {
    return res.status(422).json({ status: 422, message: 'Cloudflare R2 is not configured.' });
  }

  const partUrls = {};
  for (const p of partNumbers) {
    partUrls[p] = presignUploadPart(r2Cfg, { key, uploadId, partNumber: p, expiresSeconds: 7200 });
  }
  return res.json({ status: 200, part_urls: partUrls });
});

// 2) Register a video after direct PUT or S3 Multipart Upload to R2 finishes
router.post('/admin/video/r2/complete', requirePermission('video_conversion.create'), async (req, res) => {
  const key = String(req.body?.key || '').trim().replace(/^\/+/, '');
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);

  const streamUrl =
    String(req.body?.public_url || '').trim() ||
    (r2Cfg.enabled && key ? buildR2DeliveryUrl(r2Cfg, key, settings) : '');

  if (!key || !streamUrl) {
    return res.status(400).json({ status: 400, message: 'R2 object key and stream URL are required.' });
  }

  if (req.body?.upload_id && Array.isArray(req.body?.parts)) {
    if (!r2Cfg.enabled) {
      return res.status(422).json({ status: 422, message: 'Cloudflare R2 configuration missing.' });
    }
    await completeMultipartUploadR2(r2Cfg, {
      key,
      uploadId: req.body.upload_id,
      parts: req.body.parts,
    });
  }

  const result = await registerUploadedVideo({
    title: req.body?.title || '',
    originalName: req.body?.original_name || path.basename(key),
    fileKey: key,
    streamUrl,
    fileSize: Number(req.body?.file_size || 0),
    storage: 'r2',
    bucket: r2Cfg.bucket || req.body?.bucket || null,
    directory: getDirectoryForMediaType(req.body?.episode_id ? 'episode' : req.body?.type || 'movie'),
    mediaType: req.body?.episode_id ? 'episode' : req.body?.type || 'movie',
    quality: req.body?.quality || 'Original',
    movieId: req.body?.movie_id ? Number(req.body.movie_id) : null,
    episodeId: req.body?.episode_id ? Number(req.body.episode_id) : null,
    autoAttach: Boolean(req.body?.auto_attach),
  });

  return res.json({ status: 200, message: 'Video uploaded to Cloudflare R2 and registered cleanly', ...result });
});

// 2b) Abort incomplete multipart upload so partial chunks do not remain in R2
router.post('/admin/video/r2/abort', requirePermission('video_conversion.create'), async (req, res) => {
  const key = String(req.body?.key || '').trim().replace(/^\/+/, '');
  const uploadId = String(req.body?.upload_id || '').trim();
  if (!key || !uploadId) {
    return res.json({ status: 200, aborted: false });
  }
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  if (r2Cfg.enabled) {
    await abortMultipartUploadR2(r2Cfg, { key, uploadId }).catch(() => {});
  }
  return res.json({ status: 200, aborted: true });
});

// 3) One-click CORS rule installer on Cloudflare R2 bucket via S3 PutBucketCors
router.post('/admin/video/r2/cors', requirePermission('video_conversion.create'), async (req, res) => {
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  if (!r2Cfg.enabled) {
    return res.status(422).json({
      status: 422,
      message: 'Configure and enable Cloudflare R2 credentials in Settings first.',
    });
  }

  const origin = req.headers.origin ? [String(req.headers.origin)] : [];
  try {
    await putBucketCorsR2(r2Cfg, origin);
    return res.json({
      status: 200,
      message: 'Cloudflare R2 CORS policy updated to allow browser uploads.',
    });
  } catch (err) {
    return res.status(422).json({
      status: 422,
      message: `Unable to update R2 CORS automatically (${err.message}). If your R2 API token is Object Read & Write only, add CORS directly in Cloudflare Dashboard -> R2 -> ${r2Cfg.bucket} -> Settings -> CORS Policy.`,
    });
  }
});

// 4) List uploaded/registered videos so Movies/Episodes & Storage page can browse and select them
router.get('/admin/videos/library', requirePermission('video_conversion.view'), async (req, res) => {
  await ensureVideoLibraryTable();
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 24)));
  const q = String(req.query.q || '').trim();
  const mediaType = String(req.query.type || '').trim().toLowerCase();

  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(vl.title LIKE ? OR vl.original_name LIKE ? OR vl.file_key LIKE ? OR vl.stream_url LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (mediaType && mediaType !== 'all') {
    conditions.push('vl.media_type = ?');
    params.push(mediaType);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const paged = await paginateQuery({
    baseFrom: 'FROM video_library vl LEFT JOIN movies m ON m.id = vl.movie_id LEFT JOIN episodes e ON e.id = vl.episode_id',
    selectSql: 'vl.*, m.title AS movie_title, e.name AS episode_name',
    whereSql,
    params,
    orderBySql: 'vl.id DESC',
    page,
    perPage,
  });

  const settings = await getSettingsRow();
  return res.json({
    ...paged,
    r2_configured: isR2Configured(settings),
    r2_bucket: settings?.r2_bucket || '',
  });
});

// 5) Scan existing objects in R2 bucket and import missing videos into `video_library`
router.post('/admin/videos/library/sync-r2', requirePermission('video_conversion.create'), async (_req, res) => {
  await ensureVideoLibraryTable();
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  if (!r2Cfg.enabled) {
    return res.status(422).json({
      status: 422,
      message: 'Cloudflare R2 is not configured/enabled in Settings.',
    });
  }

  const objects = await listObjectsR2(r2Cfg, { maxKeys: 1000, videosOnly: true });
  const existingRows = await queryAll('SELECT file_key, stream_url FROM video_library');
  const existingKeys = new Set(existingRows.map((r) => String(r.file_key || '').replace(/^\/+/, '')));
  const existingUrls = new Set(existingRows.map((r) => String(r.stream_url || '').trim()));

  let imported = 0;
  let skipped = 0;
  const now = nowIso();

  for (const obj of objects) {
    const cleanKey = String(obj.key || '').replace(/^\/+/, '');
    const streamUrl = buildR2DeliveryUrl(r2Cfg, cleanKey, settings);
    if (existingKeys.has(cleanKey) || existingUrls.has(streamUrl)) {
      skipped += 1;
      continue;
    }

    const base = path.basename(cleanKey);
    const cleanedDisplay = base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '');
    const mediaType = cleanKey.startsWith('series/')
      ? 'episode'
      : cleanKey.startsWith('animes/')
        ? 'anime'
        : cleanKey.startsWith('videos/')
          ? 'general'
          : 'movie';
    const directory = cleanKey.includes('/') ? path.posix.dirname(cleanKey) : 'movies/originals';

    await execute(
      `INSERT INTO video_library
        (code, title, original_name, media_type, directory, file_key, stream_url, format, quality, file_size, storage, bucket, movie_id, episode_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Original', ?, 'r2', ?, NULL, NULL, ?, ?)`,
      [
        randomCode(10),
        cleanedDisplay.replace(/\.[^.]+$/, '') || base,
        cleanedDisplay || base,
        mediaType,
        directory,
        cleanKey,
        streamUrl,
        normalizeVideoFormat(cleanKey),
        Number(obj.size || 0),
        r2Cfg.bucket,
        now,
        now,
      ]
    );
    existingKeys.add(cleanKey);
    existingUrls.add(streamUrl);
    imported += 1;
  }

  return res.json({
    status: 200,
    imported,
    skipped,
    total_r2_objects: objects.length,
    message: imported
      ? `Imported ${imported} video(s) from Cloudflare R2 bucket "${r2Cfg.bucket}".`
      : `All ${objects.length} R2 video(s) are already in your library.`,
  });
});

// 6) Delete a registered video from DB AND remove file from R2 / storage
router.delete('/admin/videos/library/:id', requirePermission('video_conversion.delete'), async (req, res) => {
  await ensureVideoLibraryTable();
  const idOrCode = req.params.id;
  const row = await queryOne('SELECT * FROM video_library WHERE id = ? OR code = ?', [
    Number(idOrCode) || -1,
    String(idOrCode),
  ]);
  if (!row) {
    return res.status(404).json({ status: 404, message: 'Video not found in library' });
  }

  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  if (row.storage === 'r2' && r2Cfg.enabled && row.file_key) {
    const key = extractR2Key(row.file_key, r2Cfg) || row.file_key;
    await deleteObjectR2(r2Cfg, key).catch((err) => {
      console.warn('[R2 Delete Warning]', err?.message || err);
    });
  } else if (row.storage === 'local' && row.file_key) {
    const cleanName = path.basename(row.file_key);
    if (env.storageBucket) {
      await env.storageBucket.delete(`videos/${cleanName}`).catch(() => {});
    }
    await execute('DELETE FROM uploaded_files WHERE folder = ? AND filename = ?', ['videos', cleanName]).catch(() => {});
  }

  await execute('DELETE FROM video_library WHERE id = ?', [row.id]);
  if (row.code) {
    await execute('DELETE FROM videos WHERE code = ?', [row.code]).catch(() => {});
  }

  return res.json({ status: 200, message: 'Video removed from library and storage' });
});

// ==================== COMPATIBILITY & DIRECT UPLOAD ROUTES ====================

router.post('/admin/video/upload-chunk', requirePermission('video_conversion.create'), chunkUpload.single('chunk'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Chunk file is required' });
  return res.json({
    status: 200,
    upload_id: req.body.upload_id || 'default',
    chunk_index: Number(req.body.chunk_index || 0),
    filename: req.file.filename,
    received: true,
  });
});

router.post('/admin/video/complete-chunked-upload', requirePermission('video_conversion.create'), async (req, res) => {
  const filename = path.basename(String(req.body.filename || req.body.source_url || ''));
  if (!filename) {
    return res.status(400).json({ status: 400, message: 'Uploaded filename is required.' });
  }
  const streamUrl = publicStorageUrl(req, '/api/stream/', filename);
  const quals = parseQualityList(req.body.qualities, req.body.quality || 'Original');
  const result = await registerUploadedVideo({
    title: req.body.title || filename,
    originalName: req.body.filename || filename,
    fileKey: filename,
    streamUrl,
    fileSize: Number(req.body.file_size || 0),
    storage: 'local',
    directory: 'videos',
    mediaType: req.body.episode_id ? 'episode' : req.body.type || 'movie',
    quality: quals[0],
    selectedQualities: quals,
    movieId: req.body.movie_id ? Number(req.body.movie_id) : null,
    episodeId: req.body.episode_id ? Number(req.body.episode_id) : null,
    autoAttach: Boolean(req.body.auto_attach),
  });

  return res.json({ status: 200, message: 'Upload registered', ...result });
});

// Direct upload (server-proxied to R2 S3 when configured, or local/STORAGE_BUCKET fallback) — NO FFmpeg conversion
router.post(
  [
    '/admin/videos/upload',
    '/admin/video/store',
    '/admin/video/upload-with-qualities',
    '/admin/video/upload-movie-with-qualities',
    '/admin/video/upload-episode-with-qualities',
  ],
  requirePermission('video_conversion.create'),
  rawVideoUpload.single('video'),
  async (req, res) => {
    const file = req.file;
    const singleQuality = req.body.quality ? String(req.body.quality).trim() : '';
    const qualities = parseQualityList(req.body.qualities, singleQuality || 'Original');

    if (!file && !req.body.source_url) {
      return res.status(400).json({ status: 400, message: 'Video file or source_url is required' });
    }

    const movieId = req.body.movie_id ? Number(req.body.movie_id) : null;
    const episodeId = req.body.episode_id ? Number(req.body.episode_id) : null;
    const mediaType = episodeId ? 'episode' : req.body.type || 'movie';
    const autoAttach = Boolean(req.body.auto_attach && req.body.auto_attach !== '0' && req.body.auto_attach !== 'false');

    if (!file && req.body.source_url) {
      const url = String(req.body.source_url).trim();
      const result = await registerUploadedVideo({
        title: req.body.title || path.basename(url.split('?')[0]),
        originalName: req.body.title || path.basename(url.split('?')[0]) || 'video.mp4',
        fileKey: url,
        streamUrl: url,
        fileSize: 0,
        storage: 'external',
        directory: 'external',
        mediaType,
        quality: qualities[0],
        selectedQualities: qualities,
        movieId,
        episodeId,
        autoAttach,
      });
      return res.json({ status: 200, success: true, message: 'Video source registered', ...result });
    }

    const stored = await storeBufferToActiveStorage({
      req,
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      mediaType,
    });

    const result = await registerUploadedVideo({
      title: req.body.title || '',
      originalName: file.originalname,
      fileKey: stored.fileKey,
      streamUrl: stored.streamUrl,
      fileSize: file.size,
      storage: stored.storage,
      bucket: stored.bucket,
      directory: stored.directory,
      mediaType,
      quality: qualities[0],
      selectedQualities: qualities,
      movieId,
      episodeId,
      autoAttach,
    });

    return res.json({ status: 200, success: true, message: 'Video uploaded successfully', ...result });
  }
);

router.delete('/admin/video/direct-upload', requirePermission('video_conversion.delete'), async (req, res) => {
  const url = String(req.body?.url || req.query?.url || '').trim();
  if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);
  const key = extractR2Key(url, r2Cfg);
  if (r2Cfg.enabled && key && /((?:movies|series|animes)\/originals|videos\/uploads)\//i.test(key)) {
    await deleteObjectR2(r2Cfg, key).catch(() => {});
  }
  await ensureVideoLibraryTable();
  await execute('DELETE FROM video_library WHERE stream_url = ? OR file_key = ?', [url, key || url]).catch(() => {});
  return res.json({ success: true, message: 'Uploaded file deleted successfully.' });
});

// ==================== LEGACY JOBS LISTING & MANAGEMENT ====================

router.get('/admin/video-jobs', requirePermission('video_conversion.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 20)));
  const status = String(req.query.status || '').trim().toLowerCase();
  const whereSql = status && status !== 'all' ? 'WHERE j.status = ?' : '';
  const params = status && status !== 'all' ? [status] : [];
  const paged = await paginateQuery({
    baseFrom:
      'FROM video_processing_jobs j LEFT JOIN videos v ON v.id = j.video_id LEFT JOIN movies m ON m.id = v.movie_id LEFT JOIN episodes e ON e.id = v.episode_id',
    selectSql:
      'j.*, v.code AS video_code, v.original_name, v.stream_url, v.file_size, v.movie_id, v.episode_id, m.title AS movie_title, e.name AS episode_name',
    whereSql,
    params,
    orderBySql: 'j.id DESC',
    page,
    perPage,
    mapRow: async (row) => ({
      ...row,
      versions: row.video_id ? await queryAll('SELECT * FROM video_versions WHERE video_id = ?', [row.video_id]) : [],
    }),
  });
  return res.json(paged);
});

router.get(['/admin/video-jobs/:jobId/status', '/admin/jobs/:jobId/status'], requirePermission('video_conversion.view'), async (req, res) => {
  const job = await queryOne(
    `SELECT j.*, v.code AS video_code, v.original_name, v.stream_url FROM video_processing_jobs j LEFT JOIN videos v ON v.id = j.video_id WHERE j.job_id = ? OR j.id = ?`,
    [req.params.jobId, Number(req.params.jobId) || -1]
  );
  if (!job) return res.status(404).json({ message: 'Job not found' });
  return res.json(job);
});

router.all('/admin/video-jobs/:jobId/retry', requirePermission('video_conversion.edit'), async (req, res) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  const now = nowIso();
  await execute(
    `UPDATE video_processing_jobs SET status = 'completed', progress = 100, message = 'Retried and completed', error_message = NULL, completed_at = ?, updated_at = ? WHERE job_id = ? OR id = ?`,
    [now, now, req.params.jobId, Number(req.params.jobId) || -1]
  );
  return res.json({ status: 200, message: 'Job retried' });
});

router.all('/admin/video-jobs/:jobId/cancel', requirePermission('video_conversion.edit'), async (req, res) => {
  if (req.method !== 'PATCH' && req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  const now = nowIso();
  await execute(
    `UPDATE video_processing_jobs SET status = 'failed', message = 'Cancelled by administrator', failed_at = ?, updated_at = ? WHERE job_id = ? OR id = ?`,
    [now, now, req.params.jobId, Number(req.params.jobId) || -1]
  );
  return res.json({ status: 200, message: 'Job cancelled' });
});

router.delete('/admin/video-jobs/:jobId', requirePermission('video_conversion.delete'), async (req, res) => {
  await execute('DELETE FROM video_processing_jobs WHERE job_id = ? OR id = ?', [
    req.params.jobId,
    Number(req.params.jobId) || -1,
  ]);
  return res.json({ status: 200, message: 'Job deleted' });
});

router.post('/admin/video-jobs/bulk-delete', requirePermission('video_conversion.delete'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.json({ status: 200, deleted: 0 });
  for (const id of ids) {
    await execute('DELETE FROM video_processing_jobs WHERE job_id = ? OR id = ?', [String(id), Number(id) || -1]);
  }
  return res.json({ status: 200, deleted: ids.length, message: 'Selected jobs deleted' });
});

// ==================== VERSIONS & MEDIA VIDEO INSPECTION ====================

router.get(
  ['/admin/episodes/:episodeId/processed-videos', '/admin/episodes/videos_ffmpeg/:episodeId'],
  requirePermission('video_conversion.view'),
  async (req, res) => {
    const vids = await queryAll('SELECT * FROM videos WHERE episode_id = ? ORDER BY id DESC', [
      Number(req.params.episodeId),
    ]);
    const out = await Promise.all(
      vids.map(async (v) => ({
        ...v,
        versions: await queryAll('SELECT * FROM video_versions WHERE video_id = ?', [v.id]),
      }))
    );
    return res.json(out);
  }
);

router.get('/admin/movies/videos_ffmpeg/:movieId', requirePermission('video_conversion.view'), async (req, res) => {
  const vids = await queryAll('SELECT * FROM videos WHERE movie_id = ? ORDER BY id DESC', [Number(req.params.movieId)]);
  const out = await Promise.all(
    vids.map(async (v) => ({
      ...v,
      versions: await queryAll('SELECT * FROM video_versions WHERE video_id = ?', [v.id]),
    }))
  );
  return res.json(out);
});

router.get('/admin/video/:videoCode/versions', requirePermission('video_conversion.view'), async (req, res) => {
  const video = await queryOne('SELECT * FROM videos WHERE code = ? OR id = ?', [
    req.params.videoCode,
    Number(req.params.videoCode) || -1,
  ]);
  if (!video) return res.status(404).json({ message: 'Video not found' });
  const versions = await queryAll('SELECT * FROM video_versions WHERE video_id = ?', [video.id]);
  return res.json({ video, versions });
});

router.get('/admin/videos/:videoId', requirePermission('video_conversion.view'), async (req, res) => {
  const video = await queryOne('SELECT * FROM videos WHERE id = ? OR code = ?', [
    Number(req.params.videoId) || -1,
    req.params.videoId,
  ]);
  if (!video) return res.status(404).json({ message: 'Video not found' });
  return res.json({ ...video, versions: await queryAll('SELECT * FROM video_versions WHERE video_id = ?', [video.id]) });
});

router.delete(
  ['/admin/video-versions/:identifier', '/admin/video/:identifier/version'],
  requirePermission('video_conversion.delete'),
  async (req, res) => {
    const idOrCode = req.params.identifier;
    await execute('DELETE FROM video_versions WHERE id = ?', [Number(idOrCode) || -1]);
    return res.json({ status: 200, message: 'Video version deleted' });
  }
);

router.delete('/admin/videos/:identifier', requirePermission('video_conversion.delete'), async (req, res) => {
  const idOrCode = req.params.identifier;
  const video = await queryOne('SELECT * FROM videos WHERE id = ? OR code = ?', [
    Number(idOrCode) || -1,
    idOrCode,
  ]);
  const settings = await getSettingsRow();
  const r2Cfg = getR2Config(settings);

  if (video && video.path) {
    if (video.storage === 'r2' && r2Cfg.enabled) {
      const key = extractR2Key(video.path, r2Cfg) || video.path;
      await deleteObjectR2(r2Cfg, key).catch(() => {});
    } else if (video.storage === 'local') {
      const cleanName = path.basename(video.path);
      if (env.storageBucket) {
        await env.storageBucket.delete(`videos/${cleanName}`).catch(() => {});
      }
      await execute('DELETE FROM uploaded_files WHERE folder = ? AND filename = ?', ['videos', cleanName]).catch(() => {});
    }
  }
  await execute('DELETE FROM videos WHERE id = ? OR code = ?', [Number(idOrCode) || -1, idOrCode]);
  if (video?.code) {
    await ensureVideoLibraryTable();
    await execute('DELETE FROM video_library WHERE code = ?', [video.code]).catch(() => {});
  }
  return res.json({ status: 200, message: 'Video deleted' });
});

router.get('/admin/video/available-qualities', requirePermission('video_conversion.view'), (_req, res) => {
  return res.json({ qualities: ['Original', '4K', '1080p', '720p', '480p', '360p'] });
});

router.post(
  ['/admin/episodes/:episodeId/process', '/admin/animes/:episodeId/process'],
  requirePermission('video_conversion.create'),
  (_req, res) => {
    return res.json({ status: 200, message: 'Direct pass-through storage active', job_id: `job_${randomCode(12)}` });
  }
);

// ==================== DIAGNOSTICS ====================

router.get('/admin/queue/status', requirePermission('video_conversion.view'), async (_req, res) => {
  const counts = await queryOne(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM video_processing_jobs
  `);
  return res.json({
    queue_running: true,
    worker_mode: 'direct-r2-upload',
    counts: counts || { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
  });
});

router.post('/admin/queue/start', requirePermission('video_conversion.edit'), (_req, res) => {
  return res.json({ success: true, queue_running: true, message: 'Direct upload pipeline is active.' });
});

router.post('/admin/queue/stop', requirePermission('video_conversion.edit'), (_req, res) => {
  return res.json({ success: true, queue_running: false, message: 'Queue paused.' });
});

router.get('/admin/php-config', requirePermission('video_conversion.view'), async (_req, res) => {
  const s = await queryOne('SELECT upload_max_kb FROM settings LIMIT 1');
  const rssMb = typeof process?.memoryUsage === 'function' ? `${Math.round(process.memoryUsage().rss / 1024 / 1024)}M RSS` : 'Edge Isolate (128M+)';
  return res.json({
    runtime: 'Cloudflare Pages Worker (nodejs_compat)',
    platform: 'cloudflare-pages',
    upload_max_filesize: `${Math.round((s?.upload_max_kb || 97280) / 1024)}M`,
    post_max_size: 'Direct R2 (Unlimited)',
    memory_limit: rssMb,
    max_execution_time: 'edge-streaming',
  });
});

router.get('/admin/storage-config', requirePermission('video_conversion.view'), async (_req, res) => {
  await ensureVideoLibraryTable();
  const s = await getSettingsRow();
  const r2Cfg = getR2Config(s);
  const localStats = await queryOne('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes FROM uploaded_files WHERE folder = ?', ['videos']).catch(() => ({ cnt: 0, bytes: 0 }));
  const libStats = await queryOne('SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS bytes FROM video_library').catch(() => ({ cnt: 0, bytes: 0 }));

  const driver = r2Cfg.enabled
    ? 'r2'
    : env.storageBucket
      ? 'cloudflare-r2'
      : s.bunny_storage
        ? 'bunny'
        : s.aws_s3_storage
          ? 's3'
          : s.wasabi_storage
            ? 'wasabi'
            : 'mysql-blob';

  return res.json({
    driver,
    local_path: r2Cfg.enabled
      ? `R2 Bucket: ${r2Cfg.bucket}`
      : env.storageBucket
        ? 'R2 Binding: STORAGE_BUCKET'
        : 'MySQL: uploaded_files',
    local_files: Number(libStats?.cnt || localStats?.cnt || 0),
    local_size_bytes: Number(libStats?.bytes || localStats?.bytes || 0),
    library_count: Number(libStats?.cnt || 0),
    library_size_bytes: Number(libStats?.bytes || 0),
    r2_storage: Boolean(Number(s.r2_storage || 0)),
    r2_configured: r2Cfg.enabled,
    r2_bucket: r2Cfg.bucket || s.r2_bucket || '',
    r2_endpoint: r2Cfg.endpoint || s.r2_endpoint || '',
    r2_public_url: r2Cfg.publicUrl || s.r2_public_url || '',
    worker_r2_binding: Boolean(env.storageBucket),
    aws_s3_storage: Boolean(s.aws_s3_storage),
    aws_bucket: s.aws_bucket || '',
    aws_default_region: s.aws_default_region || '',
    wasabi_storage: Boolean(s.wasabi_storage),
    wasabi_bucket: s.wasabi_bucket || '',
    wasabi_default_region: s.wasabi_default_region || '',
  });
});

router.get('/admin/video-debug/test-ffmpeg', requirePermission('video_conversion.view'), async (_req, res) => {
  const s = await getSettingsRow();
  const r2Cfg = getR2Config(s);
  return res.json({
    available: false,
    direct_upload: true,
    r2_configured: r2Cfg.enabled,
    binary: s?.ffmpeg_binaries || 'none',
    message: r2Cfg.enabled
      ? 'Direct pass-through mode active: videos upload straight to Cloudflare R2 without quality transcoding.'
      : 'Direct pass-through mode: configure Cloudflare R2 in Settings for unlimited direct video uploads.',
  });
});

export default router;
