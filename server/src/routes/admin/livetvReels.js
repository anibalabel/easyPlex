import express from 'express';
import path from 'path';
import {
  execute,
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
  createDiskUpload,
  publicStorageUrl,
  sendStoredFile,
} from '../../middleware/upload.js';
import { toBoolInt } from '../../services/mediaCatalog.js';

const router = makeAsyncRouter(express.Router());

// Public reel file access (similar to web.php)
router.get('/admin/reels/video/:filename', (req, res) => {
  return sendStoredFile(res, 'reels_videos', path.basename(req.params.filename));
});
router.get('/admin/reels/thumbnail/:filename', (req, res) => {
  return sendStoredFile(res, 'reels_thumbs', path.basename(req.params.filename));
});

router.use('/admin', requireAdminOrModerator);

const uploadLivetvImg = createDiskUpload('livetv', { preserveExtension: true });
const uploadReelVideo = createDiskUpload('reels_videos', { preserveExtension: true, maxSizeMb: 500 });
const uploadReelThumb = createDiskUpload('reels_thumbs', { preserveExtension: true });

function serializeTagsForDb(rawTags, existing = '[]') {
  if (rawTags === undefined) return existing;
  if (rawTags === null || rawTags === '') return '[]';
  if (Array.isArray(rawTags) || typeof rawTags === 'object') return JSON.stringify(rawTags);
  const str = String(rawTags).trim();
  if (!str) return '[]';
  try {
    JSON.parse(str);
    return str;
  } catch {
    return JSON.stringify(str.split(',').map((s) => s.trim()).filter(Boolean));
  }
}

async function hydrateLivetv(row) {
  if (!row) return null;
  const [genres, videos] = await Promise.all([
    queryAll(
      'SELECT c.*, lg.id AS pivot_id, lg.category_id FROM livetv_genres lg JOIN categories c ON c.id = lg.category_id WHERE lg.livetv_id = ? ORDER BY lg.id ASC',
      [row.id]
    ),
    queryAll(
      'SELECT * FROM livetv_videos WHERE livetv_id = ? ORDER BY COALESCE(sort_order, id) ASC',
      [row.id]
    ),
  ]);
  return { ...row, genres, categories: genres, genreslist: genres.map((g) => g.name), videos };
}

async function syncLivetvCategories(livetvId, cats, replace = false) {
  if (!Array.isArray(cats)) return;
  const now = nowIso();
  if (replace) await execute('DELETE FROM livetv_genres WHERE livetv_id = ?', [livetvId]);
  for (const item of cats) {
    let cat = null;
    if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
      cat = await queryOne('SELECT * FROM categories WHERE id = ?', [Number(item)]);
    } else if (item && (item.category_id || item.id)) {
      cat = await queryOne('SELECT * FROM categories WHERE id = ?', [Number(item.category_id || item.id)]);
    } else if (item?.name) {
      cat = await queryOne('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)', [String(item.name).trim()]);
      if (!cat) {
        const ins = await execute('INSERT INTO categories (name, created_at, updated_at) VALUES (?, ?, ?)', [
          String(item.name).trim(),
          now,
          now,
        ]);
        cat = await queryOne('SELECT * FROM categories WHERE id = ?', [Number(ins.lastInsertRowid)]);
      }
    }
    if (!cat) continue;
    const exists = await queryOne('SELECT id FROM livetv_genres WHERE livetv_id = ? AND category_id = ?', [
      livetvId,
      cat.id,
    ]);
    if (!exists) {
      await execute('INSERT INTO livetv_genres (livetv_id, category_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        livetvId,
        cat.id,
        now,
        now,
      ]);
    }
  }
}

async function syncLivetvVideos(livetvId, links, replaceMissing = true) {
  if (!Array.isArray(links)) return;
  const now = nowIso();
  if (replaceMissing) {
    const existingRows = await queryAll('SELECT id FROM livetv_videos WHERE livetv_id = ?', [livetvId]);
    const existingIds = existingRows.map((r) => r.id);
    const keepIds = links.filter((l) => l.id).map((l) => Number(l.id));
    for (const id of existingIds) {
      if (!keepIds.includes(id)) await execute('DELETE FROM livetv_videos WHERE id = ?', [id]);
    }
  }
  for (let idx = 0; idx < links.length; idx++) {
    const l = links[idx];
    if (!l || !l.link) continue;
    const isActive = l.is_active !== undefined ? toBoolInt(l.is_active, 1) : toBoolInt(l.status, 1);
    const vals = [
      livetvId,
      l.server || 'Default',
      l.quality || 'Auto',
      String(l.link).trim(),
      l.header || null,
      l.useragent || null,
      l.lang || null,
      l.livetv_name || null,
      toBoolInt(l.embed, 0),
      toBoolInt(l.is_premium, 0),
      toBoolInt(l.youtubelink, 0),
      toBoolInt(l.hls, 0),
      toBoolInt(l.supported_hosts, 0),
      toBoolInt(l.drm, 0),
      l.drmuuid || null,
      l.drmlicenceuri || null,
      isActive,
      isActive,
      l.sort_order ?? idx + 1,
    ];
    if (l.id && (await queryOne('SELECT id FROM livetv_videos WHERE id = ? AND livetv_id = ?', [Number(l.id), livetvId]))) {
      await execute(
        `UPDATE livetv_videos SET livetv_id = ?, server = ?, quality = ?, link = ?, header = ?, useragent = ?, lang = ?, livetv_name = ?, embed = ?, is_premium = ?, youtubelink = ?, hls = ?, supported_hosts = ?, drm = ?, drmuuid = ?, drmlicenceuri = ?, status = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ? AND livetv_id = ?`,
        [...vals, now, Number(l.id), livetvId]
      );
    } else {
      await execute(
        `INSERT INTO livetv_videos (livetv_id, server, quality, link, header, useragent, lang, livetv_name, embed, is_premium, youtubelink, hls, supported_hosts, drm, drmuuid, drmlicenceuri, status, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...vals, now, now]
      );
    }
  }
}

// ================= LiveTV Routes =================
router.get('/admin/livetv/data', requirePermission('live_streaming.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 12)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE name LIKE ? OR overview LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM livetvs',
      whereSql,
      params,
      orderBySql: 'id DESC',
      page,
      perPage,
      mapRow: hydrateLivetv,
    })
  );
});

router.get('/admin/stream/show/:livetv', requirePermission('live_streaming.view'), async (req, res) => {
  const row = await queryOne('SELECT * FROM livetvs WHERE id = ?', [Number(req.params.livetv)]);
  if (!row) return res.status(404).json({ message: 'Channel not found' });
  return res.json(await hydrateLivetv(row));
});

router.post('/admin/livetv/store', requirePermission('live_streaming.create'), async (req, res) => {
  const c = req.body.livetv || req.body;
  const name = String(c.name || '').trim();
  if (!name) return res.status(422).json({ status: 422, message: 'Channel name is required' });

  const created = await runInTransaction(async () => {
    const now = nowIso();
    const ins = await execute(
      `INSERT INTO livetvs (name, overview, poster_path, backdrop_path, backdrop_path_tv, link, link_is_premium, featured, embed, status, live, hls, active, vip, views, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        c.overview || null,
        c.poster_path || null,
        c.backdrop_path || null,
        c.backdrop_path_tv || c.backdrop_path || null,
        c.link || null,
        toBoolInt(c.link_is_premium, 0),
        toBoolInt(c.featured, 0),
        toBoolInt(c.embed, 0),
        toBoolInt(c.status, 1),
        toBoolInt(c.live, 1),
        toBoolInt(c.hls, 0),
        toBoolInt(c.active, 1),
        toBoolInt(c.vip ?? c.premuim, 0),
        Number(c.views || 0),
        now,
        now,
      ]
    );
    const id = Number(ins.lastInsertRowid);
    await syncLivetvCategories(id, c.genres || c.categories, false);
    const links =
      req.body.links || c.links || c.videos || (c.link ? [{ server: 'Primary', link: c.link, hls: c.hls, embed: c.embed }] : []);
    if (Array.isArray(links) && links.length) await syncLivetvVideos(id, links, false);
    return hydrateLivetv(await queryOne('SELECT * FROM livetvs WHERE id = ?', [id]));
  });

  return res.json({ status: 200, message: 'created successfully', livetv: created });
});

router.put('/admin/livetv/update/:livetv', requirePermission('live_streaming.edit'), async (req, res) => {
  const id = Number(req.params.livetv);
  const existing = await queryOne('SELECT * FROM livetvs WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Channel not found' });
  const c = req.body.livetv || req.body;

  const updated = await runInTransaction(async () => {
    await execute(
      `UPDATE livetvs SET name = ?, overview = ?, poster_path = ?, backdrop_path = ?, backdrop_path_tv = ?, link = ?, link_is_premium = ?, featured = ?, embed = ?, status = ?, live = ?, hls = ?, active = ?, vip = ?, updated_at = ? WHERE id = ?`,
      [
        c.name || existing.name,
        c.overview ?? existing.overview,
        c.poster_path ?? existing.poster_path,
        c.backdrop_path ?? existing.backdrop_path,
        c.backdrop_path_tv ?? existing.backdrop_path_tv,
        c.link ?? existing.link,
        c.link_is_premium !== undefined ? toBoolInt(c.link_is_premium, existing.link_is_premium) : existing.link_is_premium,
        c.featured !== undefined ? toBoolInt(c.featured, existing.featured) : existing.featured,
        c.embed !== undefined ? toBoolInt(c.embed, existing.embed) : existing.embed,
        c.status !== undefined ? toBoolInt(c.status, existing.status) : existing.status,
        c.live !== undefined ? toBoolInt(c.live, existing.live) : existing.live,
        c.hls !== undefined ? toBoolInt(c.hls, existing.hls) : existing.hls,
        c.active !== undefined ? toBoolInt(c.active, existing.active) : existing.active,
        c.vip !== undefined || c.premuim !== undefined ? toBoolInt(c.vip ?? c.premuim, existing.vip) : existing.vip,
        nowIso(),
        id,
      ]
    );
    if (Array.isArray(c.genres || c.categories)) {
      await syncLivetvCategories(id, c.genres || c.categories, Boolean(req.body.replace_relations));
    }
    const links = req.body.links || c.links || c.videos;
    if (Array.isArray(links)) await syncLivetvVideos(id, links, true);
    return hydrateLivetv(await queryOne('SELECT * FROM livetvs WHERE id = ?', [id]));
  });

  return res.json({ status: 200, message: 'successfully updated', livetv: updated });
});

router.delete('/admin/livetv/destroy/:livetv', requirePermission('live_streaming.delete'), async (req, res) => {
  await execute('DELETE FROM livetvs WHERE id = ?', [Number(req.params.livetv)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/livetv/image/store', requirePermission('live_streaming.edit'), uploadLivetvImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image file is required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/livetv/image/', req.file.filename),
    filename: req.file.filename,
  });
});

router.delete('/admin/livetv/genres/destroy/:livetvgenre', requirePermission('live_streaming.edit'), async (req, res) => {
  await execute('DELETE FROM livetv_genres WHERE id = ?', [Number(req.params.livetvgenre)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.get('/admin/livetvs/videos/:livetv', requirePermission('live_streaming.view'), async (req, res) => {
  return res.json(
    await queryAll('SELECT * FROM livetv_videos WHERE livetv_id = ? ORDER BY COALESCE(sort_order, id) ASC', [
      Number(req.params.livetv),
    ])
  );
});

router.post('/admin/streaming/store', requirePermission('live_streaming.edit'), async (req, res) => {
  const livetvId = Number(req.body.livetv_id || 0);
  if (!livetvId) return res.status(422).json({ status: 422, message: 'livetv_id is required' });
  await syncLivetvVideos(livetvId, Array.isArray(req.body.links) ? req.body.links : [req.body], false);
  return res.json({ status: 200, message: 'Streaming link added' });
});

router.delete('/admin/livetvs/videos/destroy/:videoId', requirePermission('live_streaming.edit'), async (req, res) => {
  await execute('DELETE FROM livetv_videos WHERE id = ?', [Number(req.params.videoId)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

// ================= Reels Routes =================
router.get('/admin/reels/data', requirePermission('reels.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 15)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE title LIKE ? OR subtitle LIKE ? OR description LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM reels',
      whereSql,
      params,
      orderBySql: 'COALESCE(position, id) ASC, id DESC',
      page,
      perPage,
    })
  );
});

router.get('/admin/reels/stats', requirePermission('reels.view'), async (_req, res) => {
  const stats = await queryOne(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
      COALESCE(SUM(views_count), 0) AS total_views,
      COALESCE(SUM(likes_count), 0) AS total_likes
    FROM reels
  `);
  return res.json(stats || { total: 0, active: 0, total_views: 0, total_likes: 0 });
});

router.get('/admin/reels/show/:id', requirePermission('reels.view'), async (req, res) => {
  const row = await queryOne('SELECT * FROM reels WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ message: 'Reel not found' });
  return res.json(row);
});

router.post('/admin/reels/store', requirePermission('reels.create'), async (req, res) => {
  const r = req.body;
  if (!r.title || !r.video_url) {
    return res.status(422).json({ status: 422, message: 'title and video_url are required' });
  }
  const maxPos = (await queryOne('SELECT COALESCE(MAX(position), 0) AS max_pos FROM reels'))?.max_pos || 0;
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO reels (media_id, media_type, episode_id, title, subtitle, description, video_url, thumbnail_url, duration, likes_count, views_count, is_active, position, created_by, quality, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(r.media_id || 0),
      r.media_type || 'movie',
      r.episode_id ? Number(r.episode_id) : null,
      String(r.title).trim(),
      r.subtitle || null,
      r.description || null,
      String(r.video_url).trim(),
      r.thumbnail_url || null,
      Number(r.duration || 30),
      toBoolInt(r.is_active, 1),
      r.position != null ? Number(r.position) : Number(maxPos) + 1,
      req.user?.id || null,
      r.quality || 'Auto',
      serializeTagsForDb(r.tags, '[]'),
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'Reel created',
    reel: await queryOne('SELECT * FROM reels WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/reels/update/:id', requirePermission('reels.edit'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await queryOne('SELECT * FROM reels WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Reel not found' });
  const r = req.body;
  await execute(
    `UPDATE reels SET media_id = ?, media_type = ?, episode_id = ?, title = ?, subtitle = ?, description = ?, video_url = ?, thumbnail_url = ?, duration = ?, is_active = ?, position = ?, quality = ?, tags = ?, updated_at = ? WHERE id = ?`,
    [
      r.media_id !== undefined ? Number(r.media_id) : existing.media_id,
      r.media_type ?? existing.media_type,
      r.episode_id !== undefined ? (r.episode_id ? Number(r.episode_id) : null) : existing.episode_id,
      r.title ?? existing.title,
      r.subtitle ?? existing.subtitle,
      r.description ?? existing.description,
      r.video_url ?? existing.video_url,
      r.thumbnail_url ?? existing.thumbnail_url,
      r.duration !== undefined ? Number(r.duration) : existing.duration,
      r.is_active !== undefined ? toBoolInt(r.is_active, existing.is_active) : existing.is_active,
      r.position !== undefined ? Number(r.position) : existing.position,
      r.quality ?? existing.quality,
      serializeTagsForDb(r.tags, serializeTagsForDb(existing.tags, '[]')),
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'Reel updated',
    reel: await queryOne('SELECT * FROM reels WHERE id = ?', [id]),
  });
});

router.delete('/admin/reels/destroy/:id', requirePermission('reels.delete'), async (req, res) => {
  await execute('DELETE FROM reels WHERE id = ?', [Number(req.params.id)]);
  return res.json({ status: 200, message: 'Reel deleted' });
});

async function swapReelOrder(id, direction) {
  const rows = await queryAll('SELECT id, position FROM reels ORDER BY COALESCE(position, id) ASC, id ASC');
  const idx = rows.findIndex((r) => Number(r.id) === Number(id));
  if (idx === -1) return false;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return true;
  const tmp = rows[idx];
  rows[idx] = rows[swapIdx];
  rows[swapIdx] = tmp;
  await runInTransaction(async () => {
    const now = nowIso();
    for (let i = 0; i < rows.length; i++) {
      await execute('UPDATE reels SET position = ?, updated_at = ? WHERE id = ?', [i + 1, now, rows[i].id]);
    }
  });
  return true;
}

router.post('/admin/reels/move-up/:id', requirePermission('reels.edit'), async (req, res) => {
  if (!(await swapReelOrder(req.params.id, 'up'))) return res.status(404).json({ message: 'Reel not found' });
  return res.json({ status: 200, message: 'Moved up' });
});

router.post('/admin/reels/move-down/:id', requirePermission('reels.edit'), async (req, res) => {
  if (!(await swapReelOrder(req.params.id, 'down'))) return res.status(404).json({ message: 'Reel not found' });
  return res.json({ status: 200, message: 'Moved down' });
});

router.get('/admin/reels/search-media', requirePermission('reels.view'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'all').toLowerCase();
  const results = [];
  if (type === 'all' || type === 'movie') {
    const rows = await queryAll(`SELECT id, title AS name, poster_path, 'movie' AS type FROM movies WHERE title LIKE ? LIMIT 15`, [
      `%${q}%`,
    ]);
    results.push(...rows);
  }
  if (type === 'all' || type === 'serie') {
    const rows = await queryAll(`SELECT id, name, poster_path, 'serie' AS type FROM series WHERE name LIKE ? LIMIT 15`, [
      `%${q}%`,
    ]);
    results.push(...rows);
  }
  if (type === 'all' || type === 'anime') {
    const rows = await queryAll(`SELECT id, name, poster_path, 'anime' AS type FROM animes WHERE name LIKE ? LIMIT 15`, [
      `%${q}%`,
    ]);
    results.push(...rows);
  }
  return res.json({ data: results });
});

router.get('/admin/reels/seasons', requirePermission('reels.view'), async (req, res) => {
  const mediaType = String(req.query.media_type || 'serie').toLowerCase();
  const mediaId = Number(req.query.media_id || 0);
  if (!mediaId) return res.json([]);
  if (mediaType === 'anime') {
    return res.json(await queryAll('SELECT * FROM anime_seasons WHERE anime_id = ? ORDER BY season_number ASC', [mediaId]));
  }
  return res.json(await queryAll('SELECT * FROM seasons WHERE serie_id = ? ORDER BY season_number ASC', [mediaId]));
});

router.get('/admin/reels/episodes', requirePermission('reels.view'), async (req, res) => {
  const mediaType = String(req.query.media_type || 'serie').toLowerCase();
  const seasonId = Number(req.query.season_id || 0);
  if (!seasonId) return res.json([]);
  if (mediaType === 'anime') {
    return res.json(
      await queryAll('SELECT * FROM anime_episodes WHERE anime_season_id = ? ORDER BY episode_number ASC', [seasonId])
    );
  }
  return res.json(await queryAll('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number ASC', [seasonId]));
});

router.post('/admin/reels/video/store', requirePermission('reels.edit'), uploadReelVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Video file required' });
  return res.json({
    status: 200,
    video_url: publicStorageUrl(req, '/admin/reels/video/', req.file.filename),
    filename: req.file.filename,
  });
});

router.post('/admin/reels/thumbnail/store', requirePermission('reels.edit'), uploadReelThumb.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image file required' });
  return res.json({
    status: 200,
    thumbnail_url: publicStorageUrl(req, '/admin/reels/thumbnail/', req.file.filename),
    filename: req.file.filename,
  });
});

export default router;
