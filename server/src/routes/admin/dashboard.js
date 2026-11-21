import { Router } from 'express';
import { execute, nowIso, queryAll, queryOne, runInTransaction } from '../../db/sqlite.js';
import { requireAdminOrModerator, requirePermission } from '../../middleware/auth.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

async function aggregateTable(table) {
  const row = await queryOne(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active_count,
       COALESCE(SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END), 0) AS inactive_count
     FROM ${table}`
  );
  const total = Number(row?.total || 0);
  const active = Number(row?.active_count || 0);
  const inactive = Number(row?.inactive_count || 0);
  return {
    total,
    active,
    inactive,
    active_percentage: total > 0 ? Math.round((active / total) * 1000) / 10 : 0,
    inactive_percentage: total > 0 ? Math.round((inactive / total) * 1000) / 10 : 0,
  };
}

router.get('/admin/moviesCount', async (_req, res) => {
  const [reports, movies, series, animes, tvs, users] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS c FROM reports`),
    queryOne(`SELECT COUNT(*) AS c FROM movies`),
    queryOne(`SELECT COUNT(*) AS c FROM series`),
    queryOne(`SELECT COUNT(*) AS c FROM animes`),
    queryOne(`SELECT COUNT(*) AS c FROM livetvs`),
    queryOne(`SELECT COUNT(*) AS c FROM users`),
  ]);
  const counts = {
    reports: Number(reports?.c || 0),
    movies: Number(movies?.c || 0),
    series: Number(series?.c || 0),
    animes: Number(animes?.c || 0),
    tvs: Number(tvs?.c || 0),
    users: Number(users?.c || 0),
  };
  return res.json({ status: 'success', data: { count: counts } });
});

router.get('/admin/moviesInactiveCount', async (_req, res) => {
  const [movies, series, animes, tvs] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS c FROM movies WHERE active = 0`),
    queryOne(`SELECT COUNT(*) AS c FROM series WHERE active = 0`),
    queryOne(`SELECT COUNT(*) AS c FROM animes WHERE active = 0`),
    queryOne(`SELECT COUNT(*) AS c FROM livetvs WHERE active = 0`),
  ]);
  return res.json({
    status: 'success',
    data: {
      count: {
        movies: Number(movies?.c || 0),
        series: Number(series?.c || 0),
        animes: Number(animes?.c || 0),
        tvs: Number(tvs?.c || 0),
      },
    },
  });
});

router.get('/admin/moviesCountViews', async (_req, res) => {
  const [movies, series, animes, livetvs] = await Promise.all([
    queryOne(`SELECT COALESCE(SUM(views), 0) AS c FROM movies`),
    queryOne(`SELECT COALESCE(SUM(views), 0) AS c FROM series`),
    queryOne(`SELECT COALESCE(SUM(views), 0) AS c FROM animes`),
    queryOne(`SELECT COALESCE(SUM(views), 0) AS c FROM livetvs`),
  ]);
  return res.json({
    status: 'success',
    data: {
      count: {
        movies: Number(movies?.c || 0),
        series: Number(series?.c || 0),
        animes: Number(animes?.c || 0),
        livetvs: Number(livetvs?.c || 0),
      },
    },
  });
});

router.get('/admin/activity-statistics', async (_req, res) => {
  const [movies, series, animes, livetvs] = await Promise.all([
    aggregateTable('movies'),
    aggregateTable('series'),
    aggregateTable('animes'),
    aggregateTable('livetvs'),
  ]);
  return res.json({ movies, series, animes, livetvs });
});

router.post('/admin/bulk-activate', requirePermission('movies.publish'), async (req, res) => {
  const contentType = req.body?.type;
  const tables = contentType && ['movies', 'series', 'animes', 'livetvs'].includes(contentType)
    ? [contentType]
    : ['movies', 'series', 'animes', 'livetvs'];
  const now = nowIso();

  const activated = await runInTransaction(async () => {
    let total = 0;
    for (const table of tables) {
      const result = await execute(`UPDATE ${table} SET active = 1, updated_at = ? WHERE active = 0`, [now]);
      total += result.changes;
    }
    return total;
  });

  return res.json({
    status: 'success',
    message: `Successfully activated ${activated} items`,
    count: activated,
  });
});

router.post('/admin/bulk-deactivate', requirePermission('movies.publish'), async (req, res) => {
  const contentType = req.body?.type;
  const tables = contentType && ['movies', 'series', 'animes', 'livetvs'].includes(contentType)
    ? [contentType]
    : ['movies', 'series', 'animes', 'livetvs'];
  const now = nowIso();

  const deactivated = await runInTransaction(async () => {
    let total = 0;
    for (const table of tables) {
      const result = await execute(`UPDATE ${table} SET active = 0, updated_at = ? WHERE active = 1`, [now]);
      total += result.changes;
    }
    return total;
  });

  return res.json({
    status: 'success',
    message: `Successfully deactivated ${deactivated} items`,
    count: deactivated,
  });
});

router.post('/admin/toggle-status/:type/:id', requirePermission('movies.publish'), async (req, res) => {
  const { type, id } = req.params;
  if (!['movies', 'series', 'animes', 'livetvs'].includes(type)) {
    return res.status(400).json({ status: 'error', message: 'Invalid content type' });
  }
  const item = await queryOne(`SELECT id, active FROM ${type} WHERE id = ?`, [id]);
  if (!item) {
    return res.status(404).json({ status: 'error', message: 'Content not found' });
  }
  const newStatus = Number(item.active) ? 0 : 1;
  await execute(`UPDATE ${type} SET active = ?, updated_at = ? WHERE id = ?`, [newStatus, nowIso(), id]);
  return res.json({
    status: 'success',
    message: `Content successfully ${newStatus ? 'activated' : 'deactivated'}`,
    new_status: newStatus,
  });
});

router.get('/admin/inactive-content', async (req, res) => {
  const type = req.query?.type;
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
  const page = Math.max(1, Number(req.query?.page || 1));
  const offset = (page - 1) * limit;

  const tables = type && ['movies', 'series', 'animes', 'livetvs'].includes(type)
    ? [type]
    : ['movies', 'series', 'animes', 'livetvs'];

  let items = [];
  for (const t of tables) {
    const titleCol = t === 'movies' ? 'title' : 'name';
    const rows = await queryAll(
      `SELECT id, ${titleCol} AS title, poster_path, created_at, updated_at FROM ${t} WHERE active = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    for (const r of rows) {
      items.push({ ...r, type: t });
    }
  }

  items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  items = items.slice(0, limit);

  return res.json({
    status: 'success',
    data: items,
    pagination: { page, limit, total: items.length },
  });
});

router.get('/admin/topcontent', async (_req, res) => {
  const [movies, series, animes] = await Promise.all([
    queryAll(
      `SELECT m.id, m.title, m.poster_path, m.backdrop_path, m.backdrop_path_tv, m.vote_average, m.subtitle, m.overview,
              m.release_date, m.pinned, m.created_at, m.updated_at, m.views, m.active, 'movie' AS type, 0 AS newEpisodes,
              (SELECT g.name FROM genres g JOIN movie_genres mg ON g.id = mg.genre_id WHERE mg.movie_id = m.id LIMIT 1) AS genre_name
       FROM movies m WHERE m.active = 1 ORDER BY m.views DESC LIMIT 5`
    ),
    queryAll(
      `SELECT s.id, s.name, s.poster_path, s.backdrop_path, s.backdrop_path_tv, s.vote_average, s.subtitle, s.overview,
              s.first_air_date AS release_date, s.pinned, s.created_at, s.updated_at, s.views, s.active, 'serie' AS type, s.newEpisodes,
              (SELECT g.name FROM genres g JOIN serie_genres sg ON g.id = sg.genre_id WHERE sg.serie_id = s.id LIMIT 1) AS genre_name
       FROM series s WHERE s.active = 1 ORDER BY s.views DESC LIMIT 5`
    ),
    queryAll(
      `SELECT a.id, a.name, a.poster_path, a.backdrop_path, a.backdrop_path_tv, a.vote_average, a.subtitle, a.overview,
              a.first_air_date AS release_date, a.pinned, a.created_at, a.updated_at, a.views, a.active, 'anime' AS type, a.newEpisodes,
              (SELECT g.name FROM genres g JOIN anime_genres ag ON g.id = ag.genre_id WHERE ag.anime_id = a.id LIMIT 1) AS genre_name
       FROM animes a WHERE a.active = 1 ORDER BY a.views DESC LIMIT 5`
    ),
  ]);

  return res.json({
    movies: movies.map((r) => ({ ...r, is_active: Boolean(r.active) })),
    series: series.map((r) => ({ ...r, is_active: Boolean(r.active) })),
    animes: animes.map((r) => ({ ...r, is_active: Boolean(r.active) })),
  });
});

router.get('/admin/topcontentmovies', async (_req, res) => res.json(await queryAll(`SELECT id, title, poster_path, views, active FROM movies WHERE active = 1 ORDER BY views DESC LIMIT 5`)));
router.get('/admin/topcontentseries', async (_req, res) => res.json(await queryAll(`SELECT id, name, poster_path, views, active FROM series WHERE active = 1 ORDER BY views DESC LIMIT 5`)));
router.get('/admin/topcontentanimes', async (_req, res) => res.json(await queryAll(`SELECT id, name, poster_path, views, active FROM animes WHERE active = 1 ORDER BY views DESC LIMIT 5`)));
router.get('/admin/topmovies', async (_req, res) => res.json(await queryAll(`SELECT * FROM movies ORDER BY views DESC LIMIT 5`)));
router.get('/admin/topanimes', async (_req, res) => res.json(await queryAll(`SELECT * FROM animes ORDER BY views DESC LIMIT 10`)));
router.get('/admin/topepisodes', async (_req, res) => res.json(await queryAll(`SELECT * FROM episodes ORDER BY views DESC LIMIT 10`)));
router.get('/admin/toplivetvs', async (_req, res) => res.json(await queryAll(`SELECT * FROM livetvs ORDER BY views DESC LIMIT 10`)));
router.get('/admin/Allfeatured', async (_req, res) => res.json(await queryAll(`SELECT * FROM featureds ORDER BY position ASC, created_at DESC`)));

// Admin search endpoints
router.get('/admin/search_movies', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM movies WHERE title LIKE ? OR original_name LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get('/admin/search_series', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM series WHERE name LIKE ? OR original_name LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get('/admin/search_animes', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM animes WHERE name LIKE ? OR original_name LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get('/admin/search_streaming', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM livetvs WHERE name LIKE ? ORDER BY id DESC LIMIT 50`, [q]));
});
router.get('/admin/search_users', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT id, role, name, email, premuim, active, pack_name, expired_in, created_at FROM users WHERE name LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get(['/admin/search_casts', '/admin/searchwebcasts'], async (req, res) => {
  const q = `%${String(req.query?.q || req.query?.search || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM casts WHERE name LIKE ? ORDER BY id DESC LIMIT 50`, [q]));
});
router.get('/admin/search_certifications', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM certifications WHERE certification LIKE ? OR country_code LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get('/admin/search_langs', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM languages WHERE name LIKE ? OR english_name LIKE ? OR iso_639_1 LIKE ? ORDER BY id DESC LIMIT 50`, [q, q, q]));
});
router.get('/admin/search_comments', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM comments WHERE comment LIKE ? OR user_name LIKE ? ORDER BY id DESC LIMIT 50`, [q, q]));
});
router.get('/admin/search_featured', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM featureds WHERE title LIKE ? ORDER BY position ASC LIMIT 50`, [q]));
});
router.get('/admin/search_top10', async (req, res) => {
  const q = `%${String(req.query?.q || '').trim()}%`;
  return res.json(await queryAll(`SELECT * FROM top10s WHERE title LIKE ? ORDER BY position ASC LIMIT 50`, [q]));
});

export default router;
