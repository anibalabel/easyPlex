import express from 'express';
import path from 'path';
import {
  castAsText,
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
  sendStoredFile,
} from '../../middleware/upload.js';
import { getTmdbConfig, tmdbGet } from '../../services/tmdb.js';
import {
  MEDIA_SCHEMAS,
  toBoolInt,
  syncParentRelations,
  syncLinks,
  hydrateMediaRecord,
  fetchTmdbMetadata,
  OPENSUBTITLES_LANGUAGES,
} from '../../services/mediaCatalog.js';

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const uploadMovieImg = createDiskUpload('movies', { preserveExtension: true });
const uploadSubtitleFile = createDiskUpload('subtitles', { preserveExtension: true });

function mapMoviePayload(body = {}) {
  const m = body.movie && typeof body.movie === 'object' ? body.movie : body;
  const title = String(m.title || m.name || '').trim();
  const isPremium = m.premuim !== undefined ? m.premuim : m.premium;
  return {
    tmdb_id: m.tmdb_id !== undefined && m.tmdb_id !== '' && m.tmdb_id !== null ? Number(m.tmdb_id) : null,
    title,
    imdb_external_id: m.imdb_external_id || null,
    original_name: m.original_name || title || null,
    subtitle: m.subtitle || null,
    overview: m.overview || null,
    poster_path: m.poster_path || null,
    backdrop_path: m.backdrop_path || null,
    backdrop_path_tv: m.backdrop_path_tv || m.backdrop_path || null,
    backgroundvideo: m.backgroundvideo || null,
    preview_path: m.preview_path || null,
    vote_average: m.vote_average != null && m.vote_average !== '' ? Number(m.vote_average) : 0,
    trailer_url: m.trailer_url || null,
    vote_count: m.vote_count != null && m.vote_count !== '' ? Number(m.vote_count) : 0,
    popularity: m.popularity != null && m.popularity !== '' ? Number(m.popularity) : 0,
    runtime: m.runtime != null ? String(m.runtime) : null,
    views: m.views != null ? Number(m.views) : 0,
    featured: toBoolInt(m.featured, 0),
    premuim: toBoolInt(isPremium, 0),
    active: m.active !== undefined ? toBoolInt(m.active, 1) : 1,
    release_date: m.release_date || null,
    skiprecap_start_in: m.skiprecap_start_in != null ? Number(m.skiprecap_start_in) : 0,
    hasrecap: toBoolInt(m.hasrecap, 0),
    pinned: toBoolInt(m.pinned, 0),
    enable_stream: m.enable_stream !== undefined ? toBoolInt(m.enable_stream, 1) : 1,
    enable_media_download: m.enable_media_download !== undefined ? toBoolInt(m.enable_media_download, 1) : 1,
    enable_ads_unlock: toBoolInt(m.enable_ads_unlock, 0),
    relationsSource: m,
    links: body.links || m.links || body.videos || m.videos || null,
    linksDownloads: body.linksDownloads || m.linksDownloads || body.downloads || m.downloads || null,
    linksSubstitles:
      body.linksSubstitles || m.linksSubstitles || body.substitles || m.substitles || body.subtitles || m.subtitles || null,
  };
}

// Paginated admin movie list
router.get('/admin/movies/dataweb', requirePermission('movies.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || req.query.limit || 12)));
  const q = String(req.query.q || req.query.search || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();

  const conditions = [];
  const params = [];
  if (q) {
    conditions.push(`(title LIKE ? OR original_name LIKE ? OR ${castAsText('tmdb_id')} LIKE ? OR imdb_external_id LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === 'active') conditions.push('active = 1');
  if (status === 'inactive') conditions.push('active = 0');
  if (status === 'premium') conditions.push('premuim = 1');
  if (status === 'featured') conditions.push('featured = 1');

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const paged = await paginateQuery({
    baseFrom: 'FROM movies',
    whereSql,
    params,
    orderBySql: 'id DESC',
    page,
    perPage,
    mapRow: (row) => hydrateMediaRecord('movie', row),
  });

  return res.json(paged);
});

// Single movie detail / edit-data
router.get(
  ['/admin/movies/edit-data/:movie', '/admin/movies/detail/:movie', '/admin/media/detail/:movie'],
  requirePermission('movies.view'),
  async (req, res) => {
    const movie = await queryOne('SELECT * FROM movies WHERE id = ?', [Number(req.params.movie)]);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });
    const hydrated = await hydrateMediaRecord('movie', movie);
    return res.json(hydrated);
  }
);

// Store movie
router.post(['/admin/moviesmedia/storemovie', '/admin/movies/store'], requirePermission('movies.create'), async (req, res) => {
  const data = mapMoviePayload(req.body);
  if (!data.title) {
    return res.status(422).json({ status: 422, message: 'Movie title is required.' });
  }
  if (data.tmdb_id) {
    const dup = await queryOne('SELECT id FROM movies WHERE tmdb_id = ?', [data.tmdb_id]);
    if (dup) {
      return res.status(422).json({
        status: 422,
        message: `Movie with TMDB ID ${data.tmdb_id} already exists (ID ${dup.id}).`,
      });
    }
  }

  const created = await runInTransaction(async () => {
    const now = nowIso();
    const insert = await execute(
      `INSERT INTO movies (
        tmdb_id, title, imdb_external_id, original_name, subtitle, overview,
        poster_path, backdrop_path, backdrop_path_tv, backgroundvideo, preview_path,
        vote_average, trailer_url, vote_count, popularity, runtime, views,
        featured, premuim, active, release_date, skiprecap_start_in, hasrecap, pinned,
        enable_stream, enable_media_download, enable_ads_unlock, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.tmdb_id,
        data.title,
        data.imdb_external_id,
        data.original_name,
        data.subtitle,
        data.overview,
        data.poster_path,
        data.backdrop_path,
        data.backdrop_path_tv,
        data.backgroundvideo,
        data.preview_path,
        data.vote_average,
        data.trailer_url,
        data.vote_count,
        data.popularity,
        data.runtime,
        data.views,
        data.featured,
        data.premuim,
        data.active,
        data.release_date,
        data.skiprecap_start_in,
        data.hasrecap,
        data.pinned,
        data.enable_stream,
        data.enable_media_download,
        data.enable_ads_unlock,
        now,
        now,
      ]
    );
    const movieId = Number(insert.lastInsertRowid);
    await syncParentRelations('movie', movieId, data.relationsSource, false);
    if (Array.isArray(data.links)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.links, 'video', false);
    if (Array.isArray(data.linksDownloads)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.linksDownloads, 'download', false);
    if (Array.isArray(data.linksSubstitles)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.linksSubstitles, 'subtitle', false);

    if (req.body.notification) {
      await execute(
        `INSERT INTO notification_logs (provider, title, message, type, tmdb, image, status, created_by, created_at) VALUES ('local', ?, ?, 'movie', ?, ?, 'sent', ?, ?)`,
        [data.title, data.overview || 'New movie added', String(data.tmdb_id || movieId), data.poster_path || null, req.user?.id || null, now]
      );
    }

    return hydrateMediaRecord('movie', await queryOne('SELECT * FROM movies WHERE id = ?', [movieId]));
  });

  return res.json({ status: 200, message: 'created successfully', body: 'Success', movie: created });
});

// Update movie
router.put(['/admin/moviesmedia/updatemovie/:movie', '/admin/movies/update/:movie'], requirePermission('movies.edit'), async (req, res) => {
  const movieId = Number(req.params.movie);
  const existing = await queryOne('SELECT * FROM movies WHERE id = ?', [movieId]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Movie not found' });

  const data = mapMoviePayload(req.body);
  const updated = await runInTransaction(async () => {
    const now = nowIso();
    await execute(
      `UPDATE movies SET
        tmdb_id = ?, title = ?, imdb_external_id = ?, original_name = ?, subtitle = ?, overview = ?,
        poster_path = ?, backdrop_path = ?, backdrop_path_tv = ?, backgroundvideo = ?, preview_path = ?,
        vote_average = ?, trailer_url = ?, vote_count = ?, popularity = ?, runtime = ?,
        featured = ?, premuim = ?, active = ?, release_date = ?, skiprecap_start_in = ?, hasrecap = ?, pinned = ?,
        enable_stream = ?, enable_media_download = ?, enable_ads_unlock = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.tmdb_id ?? existing.tmdb_id,
        data.title || existing.title,
        data.imdb_external_id ?? existing.imdb_external_id,
        data.original_name ?? existing.original_name,
        data.subtitle ?? existing.subtitle,
        data.overview ?? existing.overview,
        data.poster_path ?? existing.poster_path,
        data.backdrop_path ?? existing.backdrop_path,
        data.backdrop_path_tv ?? existing.backdrop_path_tv,
        data.backgroundvideo ?? existing.backgroundvideo,
        data.preview_path ?? existing.preview_path,
        data.vote_average ?? existing.vote_average,
        data.trailer_url ?? existing.trailer_url,
        data.vote_count ?? existing.vote_count,
        data.popularity ?? existing.popularity,
        data.runtime ?? existing.runtime,
        data.featured,
        data.premuim,
        data.active,
        data.release_date ?? existing.release_date,
        data.skiprecap_start_in,
        data.hasrecap,
        data.pinned,
        data.enable_stream,
        data.enable_media_download,
        data.enable_ads_unlock,
        now,
        movieId,
      ]
    );

    const replaceRelations = Boolean(req.body.replace_relations);
    await syncParentRelations('movie', movieId, data.relationsSource, replaceRelations);
    if (Array.isArray(data.links)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.links, 'video', true);
    if (Array.isArray(data.linksDownloads)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.linksDownloads, 'download', true);
    if (Array.isArray(data.linksSubstitles)) await syncLinks(MEDIA_SCHEMAS.movie, movieId, data.linksSubstitles, 'subtitle', true);

    return hydrateMediaRecord('movie', await queryOne('SELECT * FROM movies WHERE id = ?', [movieId]));
  });

  return res.json({ status: 200, message: 'successfully updated', body: 'Success', movie: updated });
});

// Delete movie
router.delete('/admin/movies/destroy/:movie', requirePermission('movies.delete'), async (req, res) => {
  const movieId = Number(req.params.movie);
  const existing = await queryOne('SELECT id FROM movies WHERE id = ?', [movieId]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Movie not found' });
  await execute('DELETE FROM movies WHERE id = ?', [movieId]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

// Upload movie poster/backdrop image
router.post('/admin/movies/image/store', requirePermission('movies.edit'), uploadMovieImg.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 400, message: 'Image file is required' });
  }
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/movies/image/', req.file.filename),
    filename: req.file.filename,
    message: 'successfully uploaded',
  });
});

// Child resources & link endpoints
router.get('/admin/movies/videos/:movie', requirePermission('movies.view'), async (req, res) => {
  const rows = await queryAll(
    'SELECT * FROM movie_videos WHERE movie_id = ? ORDER BY COALESCE(position, sort_order, id) ASC',
    [Number(req.params.movie)]
  );
  return res.json(rows);
});

router.put('/admin/movies/:movie/videos/reorder', requirePermission('movies.edit'), async (req, res) => {
  const movieId = Number(req.params.movie);
  const order = Array.isArray(req.body.order) ? req.body.order : Array.isArray(req.body.ids) ? req.body.ids : [];
  await runInTransaction(async () => {
    for (let idx = 0; idx < order.length; idx++) {
      const item = order[idx];
      const id = typeof item === 'object' ? Number(item.id) : Number(item);
      await execute(
        'UPDATE movie_videos SET position = ?, sort_order = ?, updated_at = ? WHERE id = ? AND movie_id = ?',
        [idx + 1, idx + 1, nowIso(), id, movieId]
      );
    }
  });
  return res.json({ status: 200, message: 'Video links reordered' });
});

router.delete('/admin/movies/videos/destroy/:movievideo', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_videos WHERE id = ?', [Number(req.params.movievideo)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/movies/videodelete/destroy/:movie', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_videos WHERE movie_id = ?', [Number(req.params.movie)]);
  return res.json({ status: 200, message: 'Movie videos deleted' });
});

router.get('/admin/movies/downloads/:movie', requirePermission('movies.view'), async (req, res) => {
  const rows = await queryAll(
    'SELECT * FROM movie_downloads WHERE movie_id = ? ORDER BY COALESCE(sort_order, id) ASC',
    [Number(req.params.movie)]
  );
  return res.json(rows);
});

router.delete('/admin/movies/downloads/destroy/:moviedownload', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_downloads WHERE id = ?', [Number(req.params.moviedownload)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.get('/admin/movies/substitles/:movie', requirePermission('movies.view'), async (req, res) => {
  const rows = await queryAll('SELECT * FROM movie_substitles WHERE movie_id = ? ORDER BY id ASC', [
    Number(req.params.movie),
  ]);
  return res.json(rows);
});

router.delete('/admin/movies/substitles/destroy/:moviesubstitle', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_substitles WHERE id = ?', [Number(req.params.moviesubstitle)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.get('/admin/movies/casters/:movie', requirePermission('movies.view'), async (req, res) => {
  const rows = await queryAll(
    `SELECT c.*, mc.id AS pivot_id FROM movie_casts mc JOIN casts c ON c.id = mc.cast_id WHERE mc.movie_id = ? ORDER BY COALESCE(c.\`order\`, 9999) ASC`,
    [Number(req.params.movie)]
  );
  return res.json(rows);
});

router.get('/admin/movies/productions/:movie', requirePermission('movies.view'), async (req, res) => {
  const rows = await queryAll(
    'SELECT n.*, mn.id AS pivot_id FROM movie_networks mn JOIN networks n ON n.id = mn.network_id WHERE mn.movie_id = ?',
    [Number(req.params.movie)]
  );
  return res.json(rows);
});

router.delete('/admin/movies/genres/destroy/:moviegenre', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_genres WHERE id = ?', [Number(req.params.moviegenre)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.delete('/admin/movies/casts/destroy/:cast', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_casts WHERE id = ?', [Number(req.params.cast)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.delete('/admin/movies/networks/destroy/:cast', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_networks WHERE id = ?', [Number(req.params.cast)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.delete('/admin/movie/collection/destroy/:collection', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_collections WHERE id = ?', [Number(req.params.collection)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.delete('/admin/movie/certification/destroy/:certification', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_certifications WHERE id = ?', [Number(req.params.certification)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.delete('/admin/movies/languages/destroy/:moviegenre', requirePermission('movies.edit'), async (req, res) => {
  await execute('DELETE FROM movie_spoken_languages WHERE id = ?', [Number(req.params.moviegenre)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

// TMDB validation & bulk operations
router.get('/admin/movies/tmdb/configuration', requirePermission('movies.view'), async (_req, res) => {
  const { apiKey } = await getTmdbConfig();
  if (!apiKey) {
    return res.status(422).json({
      status: 422,
      valid: false,
      message: 'Configure a valid TMDB API key in Settings before using bulk import.',
    });
  }
  try {
    const configuration = await tmdbGet('/configuration');
    return res.json({
      status: 200,
      valid: true,
      message: 'TMDB API key is valid.',
      configuration,
    });
  } catch (err) {
    return res.status(422).json({
      status: 422,
      valid: false,
      message: err.message || 'Unable to validate TMDB API key.',
    });
  }
});

// TMDB Search/Lookup Proxy for admin forms
router.get('/admin/tmdb/search', requirePermission('movies.view'), async (req, res) => {
  const type = String(req.query.type || 'movie');
  const query = String(req.query.query || '').trim();
  const tmdbId = req.query.tmdb_id ? Number(req.query.tmdb_id) : null;
  const language = req.query.language || undefined;
  const includeEpisodes =
    req.query.include_episodes !== '0' && req.query.include_episodes !== 'false';
  const includeSpecials =
    req.query.include_specials === '1' || req.query.include_specials === 'true';

  try {
    if (tmdbId) {
      const normalizedKind =
        type === 'tv' || type === 'serie' || type === 'anime' ? 'serie' : 'movie';
      const detail = await fetchTmdbMetadata(normalizedKind, tmdbId, language, {
        includeEpisodes: normalizedKind !== 'movie' && includeEpisodes,
        includeSpecials,
      });
      return res.json({ status: 200, data: detail });
    }
    if (!query) return res.json({ status: 200, results: [] });
    const endpoint = type === 'tv' || type === 'serie' || type === 'anime' ? '/search/tv' : '/search/movie';
    const data = await tmdbGet(endpoint, { query, language });
    return res.json({ status: 200, ...data });
  } catch (err) {
    return res.status(422).json({ status: 422, message: err.message });
  }
});

router.get('/admin/movies/check-exists/:tmdbId', requirePermission('movies.view'), async (req, res) => {
  const row = await queryOne('SELECT id, title FROM movies WHERE tmdb_id = ?', [Number(req.params.tmdbId)]);
  return res.json({ exists: Boolean(row), movie: row || null });
});

router.post('/admin/movies/validate-tmdb', requirePermission('movies.view'), async (req, res) => {
  const tmdbIds = Array.isArray(req.body.tmdb_ids) ? req.body.tmdb_ids.map(Number) : [];
  if (!tmdbIds.length) return res.json({ existing: [], new: [] });
  const placeholders = tmdbIds.map(() => '?').join(',');
  const existingRows = await queryAll(`SELECT tmdb_id FROM movies WHERE tmdb_id IN (${placeholders})`, tmdbIds);
  const existingSet = new Set(existingRows.map((r) => Number(r.tmdb_id)));
  return res.json({
    existing: tmdbIds.filter((id) => existingSet.has(id)),
    new: tmdbIds.filter((id) => !existingSet.has(id)),
  });
});

router.post('/admin/movies/bulk-import', requirePermission('movies.create'), async (req, res) => {
  const movies = Array.isArray(req.body.movies) ? req.body.movies : [];
  const options = req.body.options || {};
  const skipExisting = options.skip_existing !== false;
  const autoActivate = options.auto_activate !== false;

  let imported = 0;
  let skipped = 0;
  let errorsCount = 0;
  const errors = [];

  await runInTransaction(async () => {
    const now = nowIso();
    for (const item of movies) {
      try {
        const tmdbId = item.tmdb_id ? Number(item.tmdb_id) : null;
        if (skipExisting && tmdbId && (await queryOne('SELECT id FROM movies WHERE tmdb_id = ?', [tmdbId]))) {
          skipped += 1;
          continue;
        }
        const title = String(item.title || item.original_title || `Movie #${tmdbId || Date.now()}`).trim();
        const ins = await execute(
          `INSERT INTO movies (
            tmdb_id, title, original_name, overview, poster_path, backdrop_path, backdrop_path_tv,
            vote_average, vote_count, popularity, runtime, release_date, trailer_url, active,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tmdbId,
            title,
            item.original_title || item.original_name || title,
            item.overview || null,
            item.poster_path || null,
            item.backdrop_path || null,
            item.backdrop_path || null,
            Number(item.vote_average || 0),
            Number(item.vote_count || 0),
            Number(item.popularity || 0),
            item.runtime != null ? String(item.runtime) : null,
            item.release_date || null,
            item.trailer_url || null,
            autoActivate ? 1 : 0,
            now,
            now,
          ]
        );
        await syncParentRelations('movie', Number(ins.lastInsertRowid), item, false);
        imported += 1;
      } catch (err) {
        errorsCount += 1;
        errors.push({ tmdb_id: item.tmdb_id, title: item.title || 'Unknown', error: err.message });
      }
    }
  });

  return res.json({
    status: 200,
    message: 'Bulk import completed',
    summary: { imported, skipped, errors: errorsCount, total: movies.length },
    errors,
  });
});

router.get('/admin/movies/bulk-update-items', requirePermission('movies.view'), async (_req, res) => {
  const items = await queryAll(
    `SELECT id, tmdb_id, title FROM movies WHERE tmdb_id IS NOT NULL AND ${castAsText('tmdb_id')} <> '' ORDER BY id ASC`
  );
  return res.json({ status: 200, items });
});

router.post('/admin/movies/bulk-update', requirePermission('movies.edit'), async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const items = ids.length
    ? await queryAll(`SELECT * FROM movies WHERE id IN (${ids.map(() => '?').join(',')}) AND tmdb_id IS NOT NULL`, ids)
    : await queryAll('SELECT * FROM movies WHERE tmdb_id IS NOT NULL LIMIT 50');

  let updated = 0;
  const errors = [];
  for (const m of items) {
    try {
      const tmdb = await fetchTmdbMetadata('movie', m.tmdb_id);
      const now = nowIso();
      await execute(
        `UPDATE movies SET title = ?, overview = ?, poster_path = COALESCE(?, poster_path), backdrop_path = COALESCE(?, backdrop_path), vote_average = ?, popularity = ?, runtime = ?, release_date = ?, updated_at = ? WHERE id = ?`,
        [
          tmdb.title || m.title,
          tmdb.overview ?? m.overview,
          tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : null,
          tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : null,
          tmdb.vote_average ?? m.vote_average,
          tmdb.popularity ?? m.popularity,
          tmdb.runtime != null ? String(tmdb.runtime) : m.runtime,
          tmdb.release_date || m.release_date,
          now,
          m.id,
        ]
      );
      if (Array.isArray(tmdb.genres)) {
        await syncParentRelations('movie', m.id, { genres: tmdb.genres }, false);
      }
      updated += 1;
    } catch (err) {
      errors.push({ id: m.id, tmdb_id: m.tmdb_id, error: err.message });
    }
  }
  return res.json({ status: 200, message: `Updated ${updated} movie(s)`, updated, errors });
});

router.get('/admin/movies/import-stats', requirePermission('movies.view'), async (_req, res) => {
  const [totalRow, withTmdbRow, activeRow] = await Promise.all([
    queryOne('SELECT COUNT(*) AS count FROM movies'),
    queryOne('SELECT COUNT(*) AS count FROM movies WHERE tmdb_id IS NOT NULL'),
    queryOne('SELECT COUNT(*) AS count FROM movies WHERE active = 1'),
  ]);
  const total = Number(totalRow?.count || 0);
  const withTmdb = Number(withTmdbRow?.count || 0);
  const active = Number(activeRow?.count || 0);
  return res.json({ total, with_tmdb: withTmdb, active, without_tmdb: total - withTmdb });
});

// Auto subtitle settings & OpenSubtitles routes
router.get('/admin/auto-subtitle-settings', requirePermission('movies.view'), async (_req, res) => {
  const settings = (await queryOne('SELECT * FROM auto_subtitle_settings ORDER BY id ASC LIMIT 1')) || {
    enabled: 0,
    default_languages: '["en"]',
    apply_to_bulk_import: 1,
    apply_to_manual_add: 1,
    skip_if_exists: 1,
    max_subtitles_per_language: 1,
    min_download_count: 0,
    notify_on_completion: 0,
    retry_on_failure: 1,
    retry_attempts: 2,
  };
  return res.json(settings);
});

router.put('/admin/auto-subtitle-settings', requirePermission('movies.edit'), async (req, res) => {
  const now = nowIso();
  const existing = await queryOne('SELECT id FROM auto_subtitle_settings ORDER BY id ASC LIMIT 1');
  const langs = Array.isArray(req.body.default_languages ?? req.body.languages)
    ? JSON.stringify(req.body.default_languages ?? req.body.languages)
    : String(req.body.default_languages ?? req.body.languages ?? '["en"]');
  const enabled = toBoolInt(req.body.enabled ?? req.body.auto_fetch_enabled, 0);
  const vals = [
    enabled,
    langs,
    toBoolInt(req.body.apply_to_bulk_import, 1),
    toBoolInt(req.body.apply_to_manual_add, 1),
    toBoolInt(req.body.skip_if_exists, 1),
    Number(req.body.max_subtitles_per_language || 1),
    Number(req.body.min_download_count ?? req.body.min_downloads ?? 0),
    toBoolInt(req.body.notify_on_completion, 0),
    toBoolInt(req.body.retry_on_failure, 1),
    Number(req.body.retry_attempts || 2),
  ];
  if (existing) {
    await execute(
      `UPDATE auto_subtitle_settings SET enabled = ?, default_languages = ?, apply_to_bulk_import = ?, apply_to_manual_add = ?, skip_if_exists = ?, max_subtitles_per_language = ?, min_download_count = ?, notify_on_completion = ?, retry_on_failure = ?, retry_attempts = ?, updated_at = ? WHERE id = ?`,
      [...vals, now, existing.id]
    );
  } else {
    await execute(
      `INSERT INTO auto_subtitle_settings (enabled, default_languages, apply_to_bulk_import, apply_to_manual_add, skip_if_exists, max_subtitles_per_language, min_download_count, notify_on_completion, retry_on_failure, retry_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...vals, now, now]
    );
  }
  return res.json({ status: 200, settings: await queryOne('SELECT * FROM auto_subtitle_settings ORDER BY id ASC LIMIT 1') });
});

router.get('/admin/subtitles/languages', requirePermission('movies.view'), (_req, res) => {
  return res.json({ status: 200, provider: 'opensubtitles', languages: OPENSUBTITLES_LANGUAGES });
});

router.get('/admin/movies/:movieId/subtitles/search', requirePermission('movies.view'), async (req, res) => {
  const movie = await queryOne('SELECT * FROM movies WHERE id = ?', [Number(req.params.movieId)]);
  if (!movie) return res.status(404).json({ message: 'Movie not found' });
  const existing = await queryAll('SELECT * FROM movie_substitles WHERE movie_id = ?', [movie.id]);
  const s = await queryOne('SELECT autosubstitles FROM settings LIMIT 1');
  if (!s?.autosubstitles) {
    return res.json({ status: 200, existing, results: [], message: 'Enable Auto Subtitles in Settings for remote lookup.' });
  }
  return res.json({ status: 200, existing, results: [] });
});

router.post('/admin/movies/:movieId/subtitles/download-specific', requirePermission('movies.edit'), uploadSubtitleFile.single('file'), async (req, res) => {
  const movieId = Number(req.params.movieId);
  const link = req.file ? publicStorageUrl(req, '/api/substitle/', req.file.filename) : String(req.body.link || '').trim();
  if (!link) return res.status(422).json({ status: 422, message: 'Subtitle link or file is required' });
  const now = nowIso();
  const ins = await execute(
    'INSERT INTO movie_substitles (movie_id, link, lang, type, zip, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    [movieId, link, req.body.lang || 'en', req.body.type || 'srt', toBoolInt(req.body.zip, 0), now, now]
  );
  return res.json({ status: 200, subtitle: await queryOne('SELECT * FROM movie_substitles WHERE id = ?', [Number(ins.lastInsertRowid)]) });
});

router.post(['/admin/movies/:movieId/subtitles/auto-fetch', '/admin/movies/:movieId/subtitles/test-auto-fetch'], requirePermission('movies.edit'), async (_req, res) => {
  const subCfg = await queryOne('SELECT * FROM auto_subtitle_settings LIMIT 1');
  if (!subCfg?.enabled) {
    return res.status(422).json({ status: 422, message: 'Enable Auto Subtitles in Settings before running auto-fetch.' });
  }
  return res.json({ status: 200, imported: 0, message: 'Auto-fetch completed' });
});

router.get('/admin/subtitles/file/:filename', (req, res) => {
  return sendStoredFile(res, 'subtitles', path.basename(req.params.filename));
});

export default router;
