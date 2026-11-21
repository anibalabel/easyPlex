import express from 'express';
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
} from '../../middleware/upload.js';
import { toBoolInt } from '../../services/mediaCatalog.js';

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const uploadFeaturedImg = createDiskUpload('featured', { preserveExtension: true });
const uploadTop10Img = createDiskUpload('top10', { preserveExtension: true });
const uploadUpcomingImg = createDiskUpload('upcoming', { preserveExtension: true });
const uploadPreviewImg = createDiskUpload('previews', { preserveExtension: true });

function parseJsonSafe(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// ================= FEATURED =================
router.get('/admin/featured/data', requirePermission('featured.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 20)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE title LIKE ? OR type LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM featureds',
      whereSql,
      params,
      orderBySql: 'position ASC, id ASC',
      page,
      perPage,
    })
  );
});

router.get('/admin/featured/available-positions', requirePermission('featured.view'), async (_req, res) => {
  const used = (await queryAll('SELECT position FROM featureds')).map((r) => Number(r.position));
  const maxPos = used.length ? Math.max(...used) : 0;
  const available = [];
  for (let i = 1; i <= maxPos + 10; i += 1) {
    if (!used.includes(i)) available.push(i);
  }
  return res.json({ used, available, next: maxPos + 1 });
});

router.get('/admin/featured/stats', requirePermission('featured.view'), async (_req, res) => {
  const rows = await queryAll('SELECT type, COUNT(*) AS count FROM featureds GROUP BY type');
  const total = rows.reduce((sum, r) => sum + Number(r.count || 0), 0);
  return res.json({ total, by_type: rows });
});

router.post('/admin/featured/store', requirePermission('featured.create'), async (req, res) => {
  const f = req.body.featured || req.body;
  if (!f.title) return res.status(422).json({ status: 422, message: 'Title is required' });
  const maxPos = (await queryOne('SELECT COALESCE(MAX(position), 0) AS max_pos FROM featureds'))?.max_pos || 0;
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO featureds (featured_id, title, poster_path, release_date, overview, backdrop_path, backdrop_path_tv, backgroundvideo, quality, vote_average, type, genre, premuim, position, enable_miniposter, miniposter, custom, custom_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      f.featured_id ? Number(f.featured_id) : null,
      String(f.title).trim(),
      f.poster_path || null,
      f.release_date || null,
      f.overview || null,
      f.backdrop_path || null,
      f.backdrop_path_tv || f.backdrop_path || null,
      f.backgroundvideo || null,
      f.quality || null,
      f.vote_average != null ? Number(f.vote_average) : null,
      f.type || 'movie',
      f.genre || null,
      toBoolInt(f.premuim ?? f.premium, 0),
      f.position != null ? Number(f.position) : Number(maxPos) + 1,
      toBoolInt(f.enable_miniposter, 0),
      f.miniposter || null,
      toBoolInt(f.custom, 0),
      f.custom_link || null,
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'Featured item created',
    featured: await queryOne('SELECT * FROM featureds WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/featured/update/:featured', requirePermission('featured.edit'), async (req, res) => {
  const id = Number(req.params.featured);
  const existing = await queryOne('SELECT * FROM featureds WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Featured item not found' });
  const f = req.body.featured || req.body;
  await execute(
    `UPDATE featureds SET featured_id = ?, title = ?, poster_path = ?, release_date = ?, overview = ?, backdrop_path = ?, backdrop_path_tv = ?, backgroundvideo = ?, quality = ?, vote_average = ?, type = ?, genre = ?, premuim = ?, position = ?, enable_miniposter = ?, miniposter = ?, custom = ?, custom_link = ?, updated_at = ? WHERE id = ?`,
    [
      f.featured_id !== undefined ? (f.featured_id ? Number(f.featured_id) : null) : existing.featured_id,
      f.title ?? existing.title,
      f.poster_path ?? existing.poster_path,
      f.release_date !== undefined ? f.release_date || null : existing.release_date,
      f.overview ?? existing.overview,
      f.backdrop_path ?? existing.backdrop_path,
      f.backdrop_path_tv ?? existing.backdrop_path_tv,
      f.backgroundvideo ?? existing.backgroundvideo,
      f.quality ?? existing.quality,
      f.vote_average !== undefined ? Number(f.vote_average) : existing.vote_average,
      f.type ?? existing.type,
      f.genre ?? existing.genre,
      f.premuim !== undefined || f.premium !== undefined ? toBoolInt(f.premuim ?? f.premium, existing.premuim) : existing.premuim,
      f.position !== undefined ? Number(f.position) : existing.position,
      f.enable_miniposter !== undefined ? toBoolInt(f.enable_miniposter, existing.enable_miniposter) : existing.enable_miniposter,
      f.miniposter ?? existing.miniposter,
      f.custom !== undefined ? toBoolInt(f.custom, existing.custom) : existing.custom,
      f.custom_link ?? existing.custom_link,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'Featured item updated',
    featured: await queryOne('SELECT * FROM featureds WHERE id = ?', [id]),
  });
});

router.delete('/admin/featured/destroy/:upcoming', requirePermission('featured.delete'), async (req, res) => {
  await execute('DELETE FROM featureds WHERE id = ?', [Number(req.params.upcoming)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post(['/admin/featured/image/store', '/admin/featureds/image/store'], requirePermission('featured.edit'), uploadFeaturedImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image file is required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/featured/image/', req.file.filename),
    filename: req.file.filename,
  });
});

async function swapFeaturedPosition(id, dir) {
  const rows = await queryAll('SELECT id FROM featureds ORDER BY position ASC, id ASC');
  const idx = rows.findIndex((r) => Number(r.id) === Number(id));
  if (idx === -1) return false;
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx >= 0 && swapIdx < rows.length) {
    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];
    await runInTransaction(async () => {
      const now = nowIso();
      for (let i = 0; i < rows.length; i++) {
        await execute('UPDATE featureds SET position = ?, updated_at = ? WHERE id = ?', [i + 1, now, rows[i].id]);
      }
    });
  }
  return true;
}

router.post('/admin/featured/move-up/:id', requirePermission('featured.edit'), async (req, res) => {
  if (!(await swapFeaturedPosition(req.params.id, 'up'))) return res.status(404).json({ message: 'Not found' });
  return res.json({ status: 200, message: 'Moved up' });
});

router.post('/admin/featured/move-down/:id', requirePermission('featured.edit'), async (req, res) => {
  if (!(await swapFeaturedPosition(req.params.id, 'down'))) return res.status(404).json({ message: 'Not found' });
  return res.json({ status: 200, message: 'Moved down' });
});

router.post('/admin/featured/reorder', requirePermission('featured.edit'), async (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : Array.isArray(req.body.ids) ? req.body.ids : [];
  await runInTransaction(async () => {
    const now = nowIso();
    for (let idx = 0; idx < order.length; idx++) {
      const item = order[idx];
      const id = typeof item === 'object' ? Number(item.id) : Number(item);
      await execute('UPDATE featureds SET position = ?, updated_at = ? WHERE id = ?', [idx + 1, now, id]);
    }
  });
  return res.json({ status: 200, message: 'Reordered' });
});

router.post('/admin/featured/normalize-positions', requirePermission('featured.edit'), async (_req, res) => {
  const rows = await queryAll('SELECT id FROM featureds ORDER BY position ASC, id ASC');
  await runInTransaction(async () => {
    const now = nowIso();
    for (let i = 0; i < rows.length; i++) {
      await execute('UPDATE featureds SET position = ?, updated_at = ? WHERE id = ?', [i + 1, now, rows[i].id]);
    }
  });
  return res.json({ status: 200, message: 'Positions normalized' });
});

router.post('/admin/featured/clear-featured', requirePermission('featured.delete'), async (_req, res) => {
  await execute('DELETE FROM featureds');
  return res.json({ status: 200, message: 'All featured entries cleared' });
});

router.post('/admin/featured/auto-populate', requirePermission('featured.create'), async (req, res) => {
  const count = Math.min(20, Math.max(1, Number(req.body.limit || 5)));
  const [topMovies, topSeries, maxPosRow] = await Promise.all([
    queryAll(
      'SELECT id, title, poster_path, backdrop_path, backdrop_path_tv, release_date, overview, vote_average, premuim FROM movies WHERE active = 1 ORDER BY views DESC, vote_average DESC LIMIT ?',
      [count]
    ),
    queryAll(
      'SELECT id, name AS title, poster_path, backdrop_path, backdrop_path_tv, first_air_date AS release_date, overview, vote_average, premuim FROM series WHERE active = 1 ORDER BY views DESC, vote_average DESC LIMIT ?',
      [Math.max(1, Math.floor(count / 2))]
    ),
    queryOne('SELECT COALESCE(MAX(position), 0) AS max_pos FROM featureds'),
  ]);

  let pos = Number(maxPosRow?.max_pos || 0) + 1;
  const now = nowIso();
  await runInTransaction(async () => {
    for (const m of topMovies) {
      await execute(
        `INSERT INTO featureds (featured_id, title, poster_path, backdrop_path, backdrop_path_tv, release_date, overview, vote_average, type, premuim, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'movie', ?, ?, ?, ?)`,
        [
          m.id,
          m.title,
          m.poster_path,
          m.backdrop_path,
          m.backdrop_path_tv,
          m.release_date || null,
          m.overview,
          m.vote_average,
          m.premuim || 0,
          pos++,
          now,
          now,
        ]
      );
    }
    for (const s of topSeries) {
      await execute(
        `INSERT INTO featureds (featured_id, title, poster_path, backdrop_path, backdrop_path_tv, release_date, overview, vote_average, type, premuim, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'serie', ?, ?, ?, ?)`,
        [
          s.id,
          s.title,
          s.poster_path,
          s.backdrop_path,
          s.backdrop_path_tv,
          s.release_date || null,
          s.overview,
          s.vote_average,
          s.premuim || 0,
          pos++,
          now,
          now,
        ]
      );
    }
  });
  return res.json({ status: 200, message: 'Featured auto-populated' });
});

// ================= TOP 10 =================
router.get('/admin/top10/data', requirePermission('top10.view'), async (_req, res) => {
  const rows = await queryAll('SELECT * FROM top10s ORDER BY position ASC, id ASC');
  return res.json({ data: rows, total: rows.length });
});

router.get('/admin/top10/settings', requirePermission('top10.view'), async (_req, res) => {
  const s = await queryOne(
    'SELECT top10_mode, top10_auto_criteria, top10_auto_window, top10_auto_types, limit_top10 FROM settings ORDER BY id ASC LIMIT 1'
  );
  return res.json({
    top10_mode: s?.top10_mode || 'manual',
    top10_auto_criteria: s?.top10_auto_criteria || 'views',
    top10_auto_window: s?.top10_auto_window || 'all',
    top10_auto_types: parseJsonSafe(s?.top10_auto_types, ['movie', 'serie']),
    limit_top10: s?.limit_top10 || 10,
  });
});

router.post('/admin/top10/settings', requirePermission('top10.edit'), async (req, res) => {
  const s = await queryOne('SELECT id FROM settings ORDER BY id ASC LIMIT 1');
  if (s) {
    await execute(
      `UPDATE settings SET top10_mode = ?, top10_auto_criteria = ?, top10_auto_window = ?, top10_auto_types = ?, limit_top10 = ?, updated_at = ? WHERE id = ?`,
      [
        req.body.top10_mode || 'manual',
        req.body.top10_auto_criteria || 'views',
        req.body.top10_auto_window || 'all',
        Array.isArray(req.body.top10_auto_types)
          ? JSON.stringify(req.body.top10_auto_types)
          : String(req.body.top10_auto_types || '["movie","serie"]'),
        Number(req.body.limit_top10 || 10),
        nowIso(),
        s.id,
      ]
    );
  }
  return res.json({ status: 200, message: 'Top 10 settings updated' });
});

router.get('/admin/top10/available-positions', requirePermission('top10.view'), async (_req, res) => {
  const used = (await queryAll('SELECT position FROM top10s')).map((r) => Number(r.position));
  const available = [];
  for (let i = 1; i <= 10; i += 1) {
    if (!used.includes(i)) available.push(i);
  }
  return res.json({ used, available });
});

router.get('/admin/top10/stats', requirePermission('top10.view'), async (_req, res) => {
  const rows = await queryAll('SELECT type, COUNT(*) AS count FROM top10s GROUP BY type');
  const total = rows.reduce((sum, r) => sum + Number(r.count || 0), 0);
  return res.json({ total, remaining_slots: Math.max(0, 10 - total), by_type: rows });
});

router.get('/admin/top10/show/:id', requirePermission('top10.view'), async (req, res) => {
  const row = await queryOne('SELECT * FROM top10s WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ message: 'Top 10 item not found' });
  return res.json(row);
});

router.post('/admin/top10/store', requirePermission('top10.create'), async (req, res) => {
  const t = req.body;
  if (!t.title || !t.poster_path || !t.type) {
    return res.status(422).json({ status: 422, message: 'title, poster_path and type are required' });
  }
  let pos = t.position ? Number(t.position) : null;
  if (!pos) {
    const used = new Set((await queryAll('SELECT position FROM top10s')).map((r) => Number(r.position)));
    for (let i = 1; i <= 10; i += 1) {
      if (!used.has(i)) {
        pos = i;
        break;
      }
    }
    if (!pos) pos = Number((await queryOne('SELECT COALESCE(MAX(position), 0) AS mp FROM top10s'))?.mp || 0) + 1;
  }
  if (await queryOne('SELECT id FROM top10s WHERE position = ?', [pos])) {
    return res.status(422).json({ status: 422, message: `Position ${pos} is already occupied` });
  }
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO top10s (position, title, overview, media_id, poster_path, backdrop_path, backdrop_path_tv, type, genre, vote_average, release_date, quality, backgroundvideo, miniposter, enable_miniposter, premium, custom, custom_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pos,
      String(t.title).trim(),
      t.overview || null,
      t.media_id ? Number(t.media_id) : null,
      t.poster_path,
      t.backdrop_path || null,
      t.backdrop_path_tv || t.backdrop_path || null,
      t.type,
      t.genre || null,
      t.vote_average != null ? String(t.vote_average) : null,
      t.release_date || null,
      t.quality || null,
      t.backgroundvideo || null,
      t.miniposter || null,
      toBoolInt(t.enable_miniposter, 0),
      toBoolInt(t.premium ?? t.premuim, 0),
      toBoolInt(t.custom, 0),
      t.custom_link || null,
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'Top 10 entry created',
    item: await queryOne('SELECT * FROM top10s WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/top10/update/:id', requirePermission('top10.edit'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await queryOne('SELECT * FROM top10s WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Top 10 item not found' });
  const t = req.body;
  const targetPos = t.position !== undefined ? Number(t.position) : existing.position;
  if (targetPos !== existing.position && (await queryOne('SELECT id FROM top10s WHERE position = ? AND id <> ?', [targetPos, id]))) {
    return res.status(422).json({ status: 422, message: `Position ${targetPos} is already occupied` });
  }
  await execute(
    `UPDATE top10s SET position = ?, title = ?, overview = ?, media_id = ?, poster_path = ?, backdrop_path = ?, backdrop_path_tv = ?, type = ?, genre = ?, vote_average = ?, release_date = ?, quality = ?, backgroundvideo = ?, miniposter = ?, enable_miniposter = ?, premium = ?, custom = ?, custom_link = ?, updated_at = ? WHERE id = ?`,
    [
      targetPos,
      t.title ?? existing.title,
      t.overview ?? existing.overview,
      t.media_id !== undefined ? (t.media_id ? Number(t.media_id) : null) : existing.media_id,
      t.poster_path ?? existing.poster_path,
      t.backdrop_path ?? existing.backdrop_path,
      t.backdrop_path_tv ?? existing.backdrop_path_tv,
      t.type ?? existing.type,
      t.genre ?? existing.genre,
      t.vote_average !== undefined ? String(t.vote_average) : existing.vote_average,
      t.release_date ?? existing.release_date,
      t.quality ?? existing.quality,
      t.backgroundvideo ?? existing.backgroundvideo,
      t.miniposter ?? existing.miniposter,
      t.enable_miniposter !== undefined ? toBoolInt(t.enable_miniposter, existing.enable_miniposter) : existing.enable_miniposter,
      t.premium !== undefined || t.premuim !== undefined ? toBoolInt(t.premium ?? t.premuim, existing.premium) : existing.premium,
      t.custom !== undefined ? toBoolInt(t.custom, existing.custom) : existing.custom,
      t.custom_link ?? existing.custom_link,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'Top 10 entry updated',
    item: await queryOne('SELECT * FROM top10s WHERE id = ?', [id]),
  });
});

router.delete('/admin/top10/destroy/:id', requirePermission('top10.delete'), async (req, res) => {
  await execute('DELETE FROM top10s WHERE id = ?', [Number(req.params.id)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/top10/image/store', requirePermission('top10.edit'), uploadTop10Img.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image file is required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/top10/image/', req.file.filename),
    filename: req.file.filename,
  });
});

async function reorderTop10Ids(orderedIds) {
  await runInTransaction(async () => {
    const now = nowIso();
    // Use temporary negative positions to avoid UNIQUE constraint collision on top10s.position
    for (let i = 0; i < orderedIds.length; i++) {
      await execute('UPDATE top10s SET position = ? WHERE id = ?', [-(i + 1), Number(orderedIds[i])]);
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await execute('UPDATE top10s SET position = ?, updated_at = ? WHERE id = ?', [i + 1, now, Number(orderedIds[i])]);
    }
  });
}

router.post('/admin/top10/move-up/:id', requirePermission('top10.edit'), async (req, res) => {
  const rows = (await queryAll('SELECT id FROM top10s ORDER BY position ASC, id ASC')).map((r) => r.id);
  const idx = rows.indexOf(Number(req.params.id));
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  if (idx > 0) {
    [rows[idx], rows[idx - 1]] = [rows[idx - 1], rows[idx]];
    await reorderTop10Ids(rows);
  }
  return res.json({ status: 200, message: 'Moved up' });
});

router.post('/admin/top10/move-down/:id', requirePermission('top10.edit'), async (req, res) => {
  const rows = (await queryAll('SELECT id FROM top10s ORDER BY position ASC, id ASC')).map((r) => r.id);
  const idx = rows.indexOf(Number(req.params.id));
  if (idx === -1) return res.status(404).json({ message: 'Not found' });
  if (idx < rows.length - 1) {
    [rows[idx], rows[idx + 1]] = [rows[idx + 1], rows[idx]];
    await reorderTop10Ids(rows);
  }
  return res.json({ status: 200, message: 'Moved down' });
});

router.post('/admin/top10/reorder', requirePermission('top10.edit'), async (req, res) => {
  const order = (Array.isArray(req.body.order) ? req.body.order : req.body.ids || []).map((x) =>
    typeof x === 'object' ? Number(x.id) : Number(x)
  );
  await reorderTop10Ids(order);
  return res.json({ status: 200, message: 'Top 10 reordered' });
});

router.post('/admin/top10/clear', requirePermission('top10.delete'), async (_req, res) => {
  await execute('DELETE FROM top10s');
  return res.json({ status: 200, message: 'Top 10 cleared' });
});

router.post('/admin/top10/auto-populate', requirePermission('top10.create'), async (_req, res) => {
  const [movies, series] = await Promise.all([
    queryAll(
      `SELECT id, title, overview, poster_path, backdrop_path, backdrop_path_tv, vote_average, release_date, premuim FROM movies WHERE active = 1 AND poster_path IS NOT NULL ORDER BY views DESC LIMIT 6`
    ),
    queryAll(
      `SELECT id, name AS title, overview, poster_path, backdrop_path, backdrop_path_tv, vote_average, first_air_date AS release_date, premuim FROM series WHERE active = 1 AND poster_path IS NOT NULL ORDER BY views DESC LIMIT 4`
    ),
  ]);
  const combined = [
    ...movies.map((m) => ({ ...m, type: 'movie' })),
    ...series.map((s) => ({ ...s, type: 'serie' })),
  ].slice(0, 10);

  await runInTransaction(async () => {
    await execute('DELETE FROM top10s');
    const now = nowIso();
    for (let idx = 0; idx < combined.length; idx++) {
      const item = combined[idx];
      await execute(
        `INSERT INTO top10s (position, title, overview, media_id, poster_path, backdrop_path, backdrop_path_tv, type, vote_average, release_date, premium, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idx + 1,
          item.title,
          item.overview,
          item.id,
          item.poster_path,
          item.backdrop_path,
          item.backdrop_path_tv,
          item.type,
          item.vote_average != null ? String(item.vote_average) : null,
          item.release_date || null,
          item.premuim || 0,
          now,
          now,
        ]
      );
    }
  });
  return res.json({ status: 200, message: `Populated ${combined.length} Top 10 items` });
});

// ================= UPCOMING =================
router.get('/admin/upcoming/data', requirePermission('upcoming.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 15)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE title LIKE ? OR genre LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  return res.json(await paginateQuery({ baseFrom: 'FROM upcomings', whereSql, params, orderBySql: 'id DESC', page, perPage }));
});

router.post('/admin/upcoming/store', requirePermission('upcoming.create'), async (req, res) => {
  const u = req.body.upcoming || req.body;
  if (!u.title) return res.status(422).json({ status: 422, message: 'Title is required' });
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO upcomings (tmdb_id, title, overview, poster_path, backdrop_path, link, genre, trailer_id, release_date, views, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      u.tmdb_id ? Number(u.tmdb_id) : null,
      String(u.title).trim(),
      u.overview || null,
      u.poster_path || null,
      u.backdrop_path || null,
      u.link || null,
      u.genre || null,
      u.trailer_id || null,
      u.release_date || null,
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'created successfully',
    upcoming: await queryOne('SELECT * FROM upcomings WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/upcoming/update/:upcoming', requirePermission('upcoming.edit'), async (req, res) => {
  const id = Number(req.params.upcoming);
  const existing = await queryOne('SELECT * FROM upcomings WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const u = req.body.upcoming || req.body;
  await execute(
    `UPDATE upcomings SET tmdb_id = ?, title = ?, overview = ?, poster_path = ?, backdrop_path = ?, link = ?, genre = ?, trailer_id = ?, release_date = ?, updated_at = ? WHERE id = ?`,
    [
      u.tmdb_id !== undefined ? (u.tmdb_id ? Number(u.tmdb_id) : null) : existing.tmdb_id,
      u.title ?? existing.title,
      u.overview ?? existing.overview,
      u.poster_path ?? existing.poster_path,
      u.backdrop_path ?? existing.backdrop_path,
      u.link ?? existing.link,
      u.genre ?? existing.genre,
      u.trailer_id ?? existing.trailer_id,
      u.release_date ?? existing.release_date,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    upcoming: await queryOne('SELECT * FROM upcomings WHERE id = ?', [id]),
  });
});

router.delete('/admin/upcoming/destroy/:upcoming', requirePermission('upcoming.delete'), async (req, res) => {
  await execute('DELETE FROM upcomings WHERE id = ?', [Number(req.params.upcoming)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/upcoming/image/store', requirePermission('upcoming.edit'), uploadUpcomingImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/upcoming/image/', req.file.filename),
    filename: req.file.filename,
  });
});

// ================= PREVIEWS (shares movies permission module in EasyPlex 2.4 DB) =================
router.get('/admin/preview/data', requirePermission('movies.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 15)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE title LIKE ?' : '';
  const params = q ? [`%${q}%`] : [];
  return res.json(await paginateQuery({ baseFrom: 'FROM previews', whereSql, params, orderBySql: 'id DESC', page, perPage }));
});

router.post('/admin/preview/store', requirePermission('movies.create'), async (req, res) => {
  const p = req.body.preview || req.body;
  if (!p.title) return res.status(422).json({ status: 422, message: 'Title is required' });
  const now = nowIso();
  const ins = await execute(
    'INSERT INTO previews (title, backdrop_path, minicover, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [String(p.title).trim(), p.backdrop_path || null, p.minicover || null, p.link || null, now, now]
  );
  return res.json({
    status: 200,
    message: 'created successfully',
    preview: await queryOne('SELECT * FROM previews WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/preview/update/:preview', requirePermission('movies.edit'), async (req, res) => {
  const id = Number(req.params.preview);
  const existing = await queryOne('SELECT * FROM previews WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ message: 'Not found' });
  const p = req.body.preview || req.body;
  await execute(
    'UPDATE previews SET title = ?, backdrop_path = ?, minicover = ?, link = ?, updated_at = ? WHERE id = ?',
    [p.title ?? existing.title, p.backdrop_path ?? existing.backdrop_path, p.minicover ?? existing.minicover, p.link ?? existing.link, nowIso(), id]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    preview: await queryOne('SELECT * FROM previews WHERE id = ?', [id]),
  });
});

router.delete('/admin/preview/destroy/:preview', requirePermission('movies.delete'), async (req, res) => {
  await execute('DELETE FROM previews WHERE id = ?', [Number(req.params.preview)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/preview/image/store', requirePermission('movies.edit'), uploadPreviewImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/preview/image/', req.file.filename),
    filename: req.file.filename,
  });
});

// ================= MOVIE REQUESTS =================
router.get(['/admin/movie-requests', '/admin/movie-requests/with-tmdb-data'], requirePermission('movie_requests.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 15)));
  const status = String(req.query.status || '').trim().toLowerCase();
  const q = String(req.query.q || req.query.search || '').trim();
  const conditions = [];
  const params = [];
  if (status && status !== 'all') {
    conditions.push('mr.status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(mr.request_title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movie_requests mr LEFT JOIN users u ON u.id = mr.user_id',
      selectSql: 'mr.*, u.name AS user_name, u.email AS user_email',
      whereSql,
      params,
      orderBySql: 'mr.id DESC',
      page,
      perPage,
      mapRow: (r) => ({
        ...r,
        tmdb_payload: parseJsonSafe(r.tmdb_payload, null),
      }),
    })
  );
});

router.get('/admin/movie-requests/stats', requirePermission('movie_requests.view'), async (_req, res) => {
  const row = await queryOne(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM movie_requests
  `);
  return res.json(row || { total: 0, pending: 0, approved: 0, rejected: 0 });
});

async function approveOneRequest(requestId, adminId, adminNotes = null) {
  const reqRow = await queryOne('SELECT * FROM movie_requests WHERE id = ?', [Number(requestId)]);
  if (!reqRow) return null;
  const now = nowIso();
  let mediaId = reqRow.created_media_id;
  if (!mediaId && reqRow.request_title) {
    const type = String(reqRow.type || 'movie').toLowerCase();
    if (type === 'serie' || type === 'tv') {
      const existing = reqRow.tmdb_id ? await queryOne('SELECT id FROM series WHERE tmdb_id = ?', [reqRow.tmdb_id]) : null;
      if (existing) {
        mediaId = existing.id;
      } else {
        const ins = await execute(
          `INSERT INTO series (tmdb_id, name, original_name, imdb_external_id, poster_path, backdrop_path, vote_average, first_air_date, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            reqRow.tmdb_id || null,
            reqRow.request_title,
            reqRow.request_title,
            reqRow.movie_imdb_id || '',
            reqRow.poster_path,
            reqRow.backdrop_path,
            reqRow.vote_average || 0,
            reqRow.release_date || null,
            now,
            now,
          ]
        );
        mediaId = Number(ins.lastInsertRowid);
      }
    } else if (type === 'anime') {
      const existing = reqRow.tmdb_id ? await queryOne('SELECT id FROM animes WHERE tmdb_id = ?', [reqRow.tmdb_id]) : null;
      if (existing) {
        mediaId = existing.id;
      } else {
        const ins = await execute(
          `INSERT INTO animes (tmdb_id, name, original_name, imdb_external_id, poster_path, backdrop_path, vote_average, first_air_date, active, is_anime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
          [
            reqRow.tmdb_id || null,
            reqRow.request_title,
            reqRow.request_title,
            reqRow.movie_imdb_id || '',
            reqRow.poster_path,
            reqRow.backdrop_path,
            reqRow.vote_average || 0,
            reqRow.release_date || null,
            now,
            now,
          ]
        );
        mediaId = Number(ins.lastInsertRowid);
      }
    } else {
      const existing = reqRow.tmdb_id ? await queryOne('SELECT id FROM movies WHERE tmdb_id = ?', [reqRow.tmdb_id]) : null;
      if (existing) {
        mediaId = existing.id;
      } else {
        const ins = await execute(
          `INSERT INTO movies (tmdb_id, title, original_name, imdb_external_id, poster_path, backdrop_path, vote_average, release_date, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            reqRow.tmdb_id || null,
            reqRow.request_title,
            reqRow.request_title,
            reqRow.movie_imdb_id || null,
            reqRow.poster_path,
            reqRow.backdrop_path,
            reqRow.vote_average || 0,
            reqRow.release_date || null,
            now,
            now,
          ]
        );
        mediaId = Number(ins.lastInsertRowid);
      }
    }
  }
  await execute(
    `UPDATE movie_requests SET status = 'approved', admin_notes = COALESCE(?, admin_notes), processed_at = ?, processed_by = ?, created_media_id = ?, updated_at = ? WHERE id = ?`,
    [adminNotes, now, adminId || null, mediaId || null, now, reqRow.id]
  );
  return queryOne('SELECT * FROM movie_requests WHERE id = ?', [reqRow.id]);
}

router.post('/admin/movie-requests/:requestId/approve', requirePermission('movie_requests.approve'), async (req, res) => {
  const updated = await approveOneRequest(req.params.requestId, req.user?.id, req.body.admin_notes || null);
  if (!updated) return res.status(404).json({ message: 'Request not found' });
  return res.json({ status: 200, message: 'Request approved', request: updated });
});

router.post('/admin/movie-requests/:requestId/reject', requirePermission('movie_requests.reject'), async (req, res) => {
  const id = Number(req.params.requestId);
  if (!(await queryOne('SELECT id FROM movie_requests WHERE id = ?', [id]))) {
    return res.status(404).json({ message: 'Request not found' });
  }
  const now = nowIso();
  await execute(
    `UPDATE movie_requests SET status = 'rejected', admin_notes = COALESCE(?, admin_notes), processed_at = ?, processed_by = ?, updated_at = ? WHERE id = ?`,
    [req.body.admin_notes || null, now, req.user?.id || null, now, id]
  );
  return res.json({
    status: 200,
    message: 'Request rejected',
    request: await queryOne('SELECT * FROM movie_requests WHERE id = ?', [id]),
  });
});

router.post('/admin/movie-requests/bulk-approve', requirePermission('movie_requests.approve'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  let count = 0;
  await runInTransaction(async () => {
    for (const id of ids) {
      if (await approveOneRequest(id, req.user?.id, req.body.admin_notes || null)) count += 1;
    }
  });
  return res.json({ status: 200, message: `Approved ${count} request(s)`, count });
});

router.post('/admin/movie-requests/bulk-reject', requirePermission('movie_requests.reject'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) return res.json({ status: 200, count: 0 });
  const now = nowIso();
  await execute(
    `UPDATE movie_requests SET status = 'rejected', admin_notes = COALESCE(?, admin_notes), processed_at = ?, processed_by = ?, updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [req.body.admin_notes || null, now, req.user?.id || null, now, ...ids]
  );
  return res.json({ status: 200, message: `Rejected ${ids.length} request(s)`, count: ids.length });
});

router.delete('/admin/movie-requests/:requestId', requirePermission('movie_requests.delete'), async (req, res) => {
  await execute('DELETE FROM movie_requests WHERE id = ?', [Number(req.params.requestId)]);
  return res.json({ status: 200, message: 'Request deleted' });
});

export default router;
