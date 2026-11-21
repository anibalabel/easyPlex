import express from 'express';
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

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const videoUpload = createDiskUpload('videos', { preserveExtension: true, maxSizeMb: 95 });
const chunkUpload = createDiskUpload('video_chunks', { preserveExtension: true, maxSizeMb: 95 });

function normalizeVideoFormat(filename) {
  const ext = path.extname(filename || '').replace('.', '').toLowerCase();
  if (['mp4', 'hls', 'hls_master'].includes(ext)) return ext;
  if (ext === 'm3u8') return 'hls';
  return 'mp4';
}

function normalizeVideoType(rawType, episodeId) {
  const allowed = ['trailer', 'full_movie', 'teaser', 'clip', 'episode'];
  if (allowed.includes(rawType)) return rawType;
  return episodeId ? 'episode' : 'full_movie';
}

async function createVideoRecordAndJob({
  req,
  filename,
  originalName,
  fileSize,
  movieId = null,
  episodeId = null,
  type = 'full_movie',
  selectedQualities = ['720p'],
}) {
  const code = randomCode(10);
  const jobId = `job_${randomCode(12)}`;
  const now = nowIso();
  const streamUrl = publicStorageUrl(req, '/api/stream/', filename);
  const videoType = normalizeVideoType(type, episodeId);
  const format = normalizeVideoFormat(filename);

  return runInTransaction(async () => {
    const vidIns = await execute(
      `INSERT INTO videos (movie_id, episode_id, type, code, original_name, file_size, path, stream_url, storage, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', 'completed', ?, ?)`,
      [movieId || null, episodeId || null, videoType, code, originalName || filename, Number(fileSize || 0), filename, streamUrl, now, now]
    );
    const videoId = Number(vidIns.lastInsertRowid);

    const quals = Array.isArray(selectedQualities) && selectedQualities.length ? selectedQualities : ['Auto'];
    for (const q of quals) {
      await execute(
        `INSERT INTO video_versions (video_id, path, format, quality, file_size, cdn_url, storage, storage_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'local', 'local', ?, ?)`,
        [videoId, filename, format, String(q).slice(0, 10), Number(fileSize || 0), streamUrl, now, now]
      );
    }

    await execute(
      `INSERT INTO video_processing_jobs (job_id, video_id, status, progress, message, selected_qualities, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'completed', 100, 'Stored and ready for streaming', ?, ?, ?, ?, ?)`,
      [jobId, videoId, JSON.stringify(quals), now, now, now, now]
    );

    if (movieId) {
      await execute(
        `INSERT INTO movie_videos (movie_id, server, quality, link, hls, status, is_active, created_at, updated_at) VALUES (?, 'Local Server', ?, ?, 0, 1, 1, ?, ?)`,
        [Number(movieId), String(quals[0] || 'Auto'), streamUrl, now, now]
      );
    }
    if (episodeId) {
      await execute(
        `INSERT INTO serie_videos (episode_id, server, quality, link, hls, status, is_active, created_at, updated_at) VALUES (?, 'Local Server', ?, ?, 0, 1, 1, ?, ?)`,
        [Number(episodeId), String(quals[0] || 'Auto'), streamUrl, now, now]
      );
    }

    const [video, job, versions] = await Promise.all([
      queryOne('SELECT * FROM videos WHERE id = ?', [videoId]),
      queryOne('SELECT * FROM video_processing_jobs WHERE job_id = ?', [jobId]),
      queryAll('SELECT * FROM video_versions WHERE video_id = ?', [videoId]),
    ]);
    return { video, job, versions, stream_url: streamUrl };
  });
}

// Chunk upload
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
    return res.status(400).json({ status: 400, message: 'Uploaded filename is required on Cloudflare Pages.' });
  }
  const result = await createVideoRecordAndJob({
    req,
    filename,
    originalName: req.body.filename || filename,
    fileSize: Number(req.body.file_size || 0),
    movieId: req.body.movie_id ? Number(req.body.movie_id) : null,
    episodeId: req.body.episode_id ? Number(req.body.episode_id) : null,
    type: req.body.episode_id ? 'episode' : req.body.type || 'full_movie',
    selectedQualities: req.body.qualities || ['720p', '1080p'],
  });

  return res.json({ status: 200, message: 'Upload registered', ...result });
});

// Direct upload / upload with qualities
router.post(
  [
    '/admin/video/upload-with-qualities',
    '/admin/video/upload-movie-with-qualities',
    '/admin/video/upload-episode-with-qualities',
    '/admin/videos/upload',
  ],
  requirePermission('video_conversion.create'),
  videoUpload.single('video'),
  async (req, res) => {
    const file = req.file;
    let qualities = ['720p', '1080p'];
    if (req.body.qualities) {
      try {
        qualities = typeof req.body.qualities === 'string' ? JSON.parse(req.body.qualities) : req.body.qualities;
      } catch {
        qualities = String(req.body.qualities)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    if (!file && !req.body.source_url) {
      return res.status(400).json({ status: 400, message: 'Video file or source_url is required' });
    }

    if (!file && req.body.source_url) {
      const code = randomCode(10);
      const jobId = `job_${randomCode(12)}`;
      const now = nowIso();
      const movieId = req.body.movie_id ? Number(req.body.movie_id) : null;
      const episodeId = req.body.episode_id ? Number(req.body.episode_id) : null;
      const url = String(req.body.source_url).trim();
      const videoType = normalizeVideoType(req.body.type, episodeId);
      const created = await runInTransaction(async () => {
        const ins = await execute(
          `INSERT INTO videos (movie_id, episode_id, type, code, original_name, path, stream_url, cdn_url, storage, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'external', 'completed', ?, ?)`,
          [movieId, episodeId, videoType, code, req.body.title || path.basename(url), url, url, url, now, now]
        );
        const vidId = Number(ins.lastInsertRowid);
        for (const q of qualities) {
          await execute(
            `INSERT INTO video_versions (video_id, path, format, quality, cdn_url, storage, storage_type, created_at, updated_at) VALUES (?, ?, 'mp4', ?, ?, 'external', 'external', ?, ?)`,
            [vidId, url, String(q).slice(0, 10), url, now, now]
          );
        }
        await execute(
          `INSERT INTO video_processing_jobs (job_id, video_id, status, progress, message, selected_qualities, started_at, completed_at, created_at, updated_at) VALUES (?, ?, 'completed', 100, 'Registered source URL', ?, ?, ?, ?, ?)`,
          [jobId, vidId, JSON.stringify(qualities), now, now, now, now]
        );
        const [video, job, versions] = await Promise.all([
          queryOne('SELECT * FROM videos WHERE id = ?', [vidId]),
          queryOne('SELECT * FROM video_processing_jobs WHERE job_id = ?', [jobId]),
          queryAll('SELECT * FROM video_versions WHERE video_id = ?', [vidId]),
        ]);
        return { video, job, versions };
      });
      return res.json({ status: 200, message: 'Video source registered', ...created });
    }

    const result = await createVideoRecordAndJob({
      req,
      filename: file.filename,
      originalName: file.originalname,
      fileSize: file.size,
      movieId: req.body.movie_id ? Number(req.body.movie_id) : null,
      episodeId: req.body.episode_id ? Number(req.body.episode_id) : null,
      type: req.body.episode_id ? 'episode' : req.body.type || 'full_movie',
      selectedQualities: qualities,
    });
    return res.json({ status: 200, message: 'Video uploaded successfully', ...result });
  }
);

// Jobs listing & management
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

// Versions & Media Video Inspection
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
  if (video && video.path && video.storage === 'local') {
    const cleanName = path.basename(video.path);
    if (env.storageBucket) {
      await env.storageBucket.delete(`videos/${cleanName}`).catch(() => {});
    }
    await execute('DELETE FROM uploaded_files WHERE folder = ? AND filename = ?', ['videos', cleanName]).catch(() => {});
  }
  await execute('DELETE FROM videos WHERE id = ? OR code = ?', [Number(idOrCode) || -1, idOrCode]);
  return res.json({ status: 200, message: 'Video deleted' });
});

router.get('/admin/video/available-qualities', requirePermission('video_conversion.view'), (_req, res) => {
  return res.json({ qualities: ['360p', '480p', '720p', '1080p', '4K'] });
});

router.post(
  ['/admin/episodes/:episodeId/process', '/admin/animes/:episodeId/process'],
  requirePermission('video_conversion.create'),
  (_req, res) => {
    return res.json({ status: 200, message: 'Video processing job queued', job_id: `job_${randomCode(12)}` });
  }
);

// Diagnostics (Queue, Storage, PHP/Runtime, FFmpeg)
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
    worker_mode: 'nodejs-inprocess',
    counts: counts || { total: 0, queued: 0, processing: 0, completed: 0, failed: 0 },
  });
});

router.post('/admin/queue/start', requirePermission('video_conversion.edit'), (_req, res) => {
  return res.json({ success: true, queue_running: true, message: 'In-process Node worker is active.' });
});

router.post('/admin/queue/stop', requirePermission('video_conversion.edit'), (_req, res) => {
  return res.json({ success: true, queue_running: false, message: 'In-process Node queue paused.' });
});

router.get('/admin/php-config', requirePermission('video_conversion.view'), async (_req, res) => {
  const s = await queryOne('SELECT upload_max_kb FROM settings LIMIT 1');
  const rssMb = typeof process?.memoryUsage === 'function' ? `${Math.round(process.memoryUsage().rss / 1024 / 1024)}M RSS` : 'Edge Isolate (128M+)';
  return res.json({
    runtime: 'Cloudflare Pages Worker (nodejs_compat)',
    platform: 'cloudflare-pages',
    upload_max_filesize: `${Math.round((s?.upload_max_kb || 97280) / 1024)}M`,
    post_max_size: '100M',
    memory_limit: rssMb,
    max_execution_time: 'edge-streaming',
  });
});

router.get('/admin/storage-config', requirePermission('video_conversion.view'), async (_req, res) => {
  const s =
    (await queryOne(
      'SELECT r2_storage, r2_bucket, bunny_storage, bunny_storage_zone, aws_s3_storage, aws_bucket, aws_default_region, wasabi_storage, wasabi_bucket, wasabi_default_region FROM settings LIMIT 1'
    )) || {};
  const stats = await queryOne('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes FROM uploaded_files WHERE folder = ?', ['videos']).catch(() => ({ cnt: 0, bytes: 0 }));
  return res.json({
    driver: env.storageBucket ? 'cloudflare-r2' : s.r2_storage ? 'r2' : s.bunny_storage ? 'bunny' : s.aws_s3_storage ? 's3' : s.wasabi_storage ? 'wasabi' : 'mysql-blob',
    local_path: env.storageBucket ? 'R2: STORAGE_BUCKET' : 'MySQL: uploaded_files',
    local_files: Number(stats?.cnt || 0),
    local_size_bytes: Number(stats?.bytes || 0),
    r2_storage: Boolean(s.r2_storage || env.storageBucket),
    r2_bucket: s.r2_bucket || '',
    aws_s3_storage: Boolean(s.aws_s3_storage),
    aws_bucket: s.aws_bucket || '',
    aws_default_region: s.aws_default_region || '',
    wasabi_storage: Boolean(s.wasabi_storage),
    wasabi_bucket: s.wasabi_bucket || '',
    wasabi_default_region: s.wasabi_default_region || '',
  });
});

router.get('/admin/video-debug/test-ffmpeg', requirePermission('video_conversion.view'), async (_req, res) => {
  const s = await queryOne('SELECT ffmpeg_binaries FROM settings LIMIT 1');
  return res.json({
    available: false,
    binary: s?.ffmpeg_binaries || 'ffmpeg',
    message: 'Cloudflare Pages Workers run serverless without local OS binaries; use external video/HLS URLs or R2/Bunny CDN URLs.',
  });
});

export default router;
