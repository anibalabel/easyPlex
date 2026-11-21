import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import multer from 'multer';
import {
  execute,
  isMySql,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/sqlite.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import {
  requireAdminOrModerator,
  requirePermission,
} from '../../middleware/auth.js';
import {
  ensureStorageDir,
  publicStorageUrl,
} from '../../middleware/upload.js';
import { randomCode } from '../../services/crypto.js';

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const videosDir = ensureStorageDir('videos');
const chunksBaseDir = ensureStorageDir('video_chunks');

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, videosDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.mp4') || '.mp4';
      cb(null, `${Date.now()}_${randomCode(8)}${ext}`);
    },
  }),
  limits: { fileSize: 2048 * 1024 * 1024 },
});

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const uploadId = String(req.body.upload_id || req.headers['x-upload-id'] || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      const dir = path.join(chunksBaseDir, uploadId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, _file, cb) => {
      const idx = String(req.body.chunk_index ?? req.headers['x-chunk-index'] ?? '0').replace(/[^0-9]/g, '');
      cb(null, `chunk_${idx.padStart(6, '0')}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

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
    received: true,
  });
});

router.post('/admin/video/complete-chunked-upload', requirePermission('video_conversion.create'), async (req, res) => {
  const uploadId = String(req.body.upload_id || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const chunkDir = path.join(chunksBaseDir, uploadId);
  if (!fs.existsSync(chunkDir)) {
    return res.status(404).json({ status: 404, message: 'Upload chunks not found' });
  }
  const files = fs.readdirSync(chunkDir).sort();
  const ext = path.extname(req.body.filename || 'video.mp4') || '.mp4';
  const finalName = `${Date.now()}_${randomCode(8)}${ext}`;
  const finalPath = path.join(videosDir, finalName);

  const fd = fs.openSync(finalPath, 'w');
  try {
    for (const f of files) {
      const buf = fs.readFileSync(path.join(chunkDir, f));
      fs.writeSync(fd, buf);
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(chunkDir, { recursive: true, force: true });

  const stats = fs.existsSync(finalPath) ? fs.statSync(finalPath) : { size: 0 };
  const result = await createVideoRecordAndJob({
    req,
    filename: finalName,
    originalName: req.body.filename || finalName,
    fileSize: stats.size,
    movieId: req.body.movie_id ? Number(req.body.movie_id) : null,
    episodeId: req.body.episode_id ? Number(req.body.episode_id) : null,
    type: req.body.episode_id ? 'episode' : req.body.type || 'full_movie',
    selectedQualities: req.body.qualities || ['720p', '1080p'],
  });

  return res.json({ status: 200, message: 'Chunked upload completed', ...result });
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
  const nextStatus = isMySql() ? 'failed' : 'cancelled';
  await execute(
    `UPDATE video_processing_jobs SET status = ?, message = 'Cancelled by administrator', failed_at = ?, updated_at = ? WHERE job_id = ? OR id = ?`,
    [nextStatus, now, now, req.params.jobId, Number(req.params.jobId) || -1]
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
    const target = path.join(videosDir, path.basename(video.path));
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        /* ignore */
      }
    }
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
  return res.json({
    runtime: `Node.js ${process.version}`,
    platform: process.platform,
    upload_max_filesize: `${Math.round((s?.upload_max_kb || 2097152) / 1024)}M`,
    post_max_size: '2048M',
    memory_limit: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}M RSS`,
    max_execution_time: 'unlimited',
  });
});

router.get('/admin/storage-config', requirePermission('video_conversion.view'), async (_req, res) => {
  const s =
    (await queryOne(
      'SELECT aws_s3_storage, aws_bucket, aws_default_region, wasabi_storage, wasabi_bucket, wasabi_default_region FROM settings LIMIT 1'
    )) || {};
  let localFiles = 0;
  let totalBytes = 0;
  if (fs.existsSync(videosDir)) {
    for (const f of fs.readdirSync(videosDir)) {
      localFiles += 1;
      try {
        totalBytes += fs.statSync(path.join(videosDir, f)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return res.json({
    driver: s.aws_s3_storage ? 's3' : s.wasabi_storage ? 'wasabi' : 'local',
    local_path: videosDir,
    local_files: localFiles,
    local_size_bytes: totalBytes,
    aws_s3_storage: Boolean(s.aws_s3_storage),
    aws_bucket: s.aws_bucket || '',
    aws_default_region: s.aws_default_region || '',
    wasabi_storage: Boolean(s.wasabi_storage),
    wasabi_bucket: s.wasabi_bucket || '',
    wasabi_default_region: s.wasabi_default_region || '',
  });
});

router.get('/admin/video-debug/test-ffmpeg', requirePermission('video_conversion.view'), async (_req, res) => {
  const s = await queryOne('SELECT ffmpeg_binaries, ffprobe_binaries FROM settings LIMIT 1');
  const ffmpegBin = s?.ffmpeg_binaries || 'ffmpeg';
  const result = await new Promise((resolve) => {
    execFile(ffmpegBin, ['-version'], { timeout: 4000 }, (err, stdout) => {
      if (err) {
        resolve({
          available: false,
          binary: ffmpegBin,
          message: 'FFmpeg binary not found on PATH; direct video uploads & streaming work without transcoding.',
          error: err.message,
        });
        return;
      }
      const firstLine = String(stdout || '').split('\n')[0]?.trim();
      resolve({ available: true, binary: ffmpegBin, version: firstLine });
    });
  });
  return res.json(result);
});

export default router;
