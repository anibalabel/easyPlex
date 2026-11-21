import express from 'express';
import {
  castAsText,
  execute,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  randomOrderSql,
} from '../../db/sqlite.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import { hydrateMediaRecord } from '../../services/mediaCatalog.js';
import {
  attachDownloads,
  attachServers,
  buildDeliveryUrl,
  resolveRequestBaseUrl,
} from '../../services/playback.js';

const router = makeAsyncRouter(express.Router());

async function getSettingsRow() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

async function hydrateList(kind, rows) {
  return Promise.all(rows.map((r) => hydrateMediaRecord(kind, r, { includeEpisodes: false })));
}

function parseLimit(settingsVal, fallback = 10) {
  const n = Number(settingsVal || fallback);
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : fallback;
}

function parsePage(req) {
  return Math.max(1, Number(req.query.page || 1));
}

function parsePerPage(req, fallback = 12) {
  return Math.min(100, Math.max(1, Number(req.query.per_page || req.query.limit || fallback)));
}

function parseCsvIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((v) => Number(v)).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => Number(v)).filter(Number.isFinite);
  } catch {
    // ignore JSON error
  }
  return String(raw)
    .split(',')
    .map((v) => Number(v.trim()))
    .filter(Number.isFinite);
}

function parseCsvStrings(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    // ignore
  }
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function toUnifiedMediaItem(hydrated, kind, s, baseUrl) {
  if (!hydrated) return null;
  const displayName = hydrated.name || hydrated.title || hydrated.original_name || '';
  return {
    ...hydrated,
    id: Number(hydrated.id),
    name: displayName,
    title: hydrated.title || displayName,
    original_name: hydrated.original_name || displayName,
    poster_path: buildDeliveryUrl(hydrated.poster_path, s, { fallback: hydrated.poster_path || '', baseUrl }),
    backdrop_path: buildDeliveryUrl(hydrated.backdrop_path, s, { fallback: hydrated.backdrop_path || '', baseUrl }),
    backdrop_path_tv: buildDeliveryUrl(
      hydrated.backdrop_path_tv || hydrated.backdrop_path,
      s,
      { fallback: hydrated.backdrop_path_tv || hydrated.backdrop_path || '', baseUrl }
    ),
    vote_average: Number(hydrated.vote_average || 0),
    subtitle: hydrated.subtitle || '',
    overview: hydrated.overview || '',
    release_date: hydrated.release_date || hydrated.first_air_date || '',
    pinned: Number(hydrated.pinned || 0),
    views: Number(hydrated.views || 0),
    type: kind,
    newEpisodes: Number(hydrated.newEpisodes || 0),
    genre_name: hydrated.genresname || hydrated.genre_name || '',
    premuim: Number(hydrated.premuim || 0),
    backgroundvideo: Number(s?.backgroundvideo || 0),
  };
}

async function hydrateSeasonWithPlayback(seasons, kind, { user, settings, req }) {
  return Promise.all(
    seasons.map(async (season) => {
      const eps = Array.isArray(season.episodes) ? season.episodes : [];
      const epKind = kind === 'anime' ? 'anime_episode' : 'episode';
      const parentId = kind === 'anime' ? season.anime_id : season.serie_id;
      const hydratedEps = await Promise.all(
        eps.map(async (ep) => {
          const withServers = await attachServers(ep, {
            kind: epKind,
            user,
            settings,
            req,
          });
          return attachDownloads(withServers, {
            kind: epKind,
            user,
            settings,
            req,
          });
        })
      );
      return {
        ...season,
        episodes_count: Number(season.episodes_count ?? hydratedEps.length),
        episodes: hydratedEps,
      };
    })
  );
}

async function attachCommentsAndRelateds(hydrated, kind) {
  const relTable = kind === 'serie' ? 'series' : kind === 'anime' ? 'animes' : 'movies';
  const commentTypes =
    kind === 'serie'
      ? ['App\\Models\\Serie', 'serie', 'series']
      : kind === 'anime'
      ? ['App\\Models\\Anime', 'anime', 'animes']
      : ['App\\Models\\Movie', 'movie', 'movies'];

  const [relatedRows, comments] = await Promise.all([
    queryAll(`SELECT * FROM ${relTable} WHERE active = 1 AND id != ? ORDER BY ${randomOrderSql()} LIMIT 10`, [
      hydrated.id,
    ]),
    queryAll(
      `SELECT * FROM comments WHERE commentable_id = ? AND commentable_type IN (${commentTypes.map(() => '?').join(',')}) AND is_approved = 1 ORDER BY id DESC LIMIT 20`,
      [hydrated.id, ...commentTypes]
    ),
  ]);

  const relateds = await hydrateList(kind, relatedRows);
  return {
    ...hydrated,
    relateds,
    comments_count: comments.length,
    comments,
  };
}

async function resolveLatestSeriesEpisodes(limit) {
  return queryAll(
    `SELECT e.*, se.season_number, se.name AS season_name, se.serie_id,
            s.name AS serie_name, s.poster_path AS serie_poster_path, s.backdrop_path AS serie_backdrop_path
     FROM episodes e
     INNER JOIN seasons se ON se.id = e.season_id
     INNER JOIN series s ON s.id = se.serie_id
     WHERE s.active = 1
     ORDER BY e.id DESC LIMIT ?`,
    [limit]
  );
}

async function resolveLatestAnimeEpisodes(limit) {
  return queryAll(
    `SELECT e.*, se.season_number, se.name AS season_name, se.anime_id,
            a.name AS anime_name, a.poster_path AS anime_poster_path, a.backdrop_path AS anime_backdrop_path
     FROM anime_episodes e
     INNER JOIN anime_seasons se ON se.id = e.anime_season_id
     INNER JOIN animes a ON a.id = se.anime_id
     WHERE a.active = 1
     ORDER BY e.id DESC LIMIT ?`,
    [limit]
  );
}

async function resolveTop10(s, limit, baseUrl) {
  const mode = String(s.top10_mode || 'manual').toLowerCase();
  const manualRows = await queryAll('SELECT * FROM top10s ORDER BY position ASC, id ASC LIMIT ?', [limit]);

  const mapAuto = async (lim) => {
    const orderCol = s.top10_auto_criteria === 'rating' ? 'vote_average DESC, views DESC' : 'views DESC, popularity DESC';
    const [mRows, sRows, aRows] = await Promise.all([
      queryAll(`SELECT * FROM movies WHERE active = 1 ORDER BY ${orderCol} LIMIT ?`, [lim]),
      queryAll(`SELECT * FROM series WHERE active = 1 ORDER BY ${orderCol} LIMIT ?`, [lim]),
      queryAll(`SELECT * FROM animes WHERE active = 1 ORDER BY ${orderCol} LIMIT ?`, [lim]),
    ]);
    const [mH, sH, aH] = await Promise.all([
      hydrateList('movie', mRows),
      hydrateList('serie', sRows),
      hydrateList('anime', aRows),
    ]);
    const combined = [
      ...mH.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
      ...sH.map((r) => toUnifiedMediaItem(r, 'serie', s, baseUrl)),
      ...aH.map((r) => toUnifiedMediaItem(r, 'anime', s, baseUrl)),
    ].sort((x, y) => Number(y.views || 0) - Number(x.views || 0));
    return combined.slice(0, lim);
  };

  if (mode === 'auto') return mapAuto(limit);

  const hydratedManual = manualRows.map((row) => ({
    ...row,
    id: Number(row.movie_id || row.serie_id || row.anime_id || row.id),
    top10_id: Number(row.id),
    name: row.name || row.title || '',
    title: row.title || row.name || '',
    poster_path: buildDeliveryUrl(row.poster_path, s, { fallback: row.poster_path || '', baseUrl }),
    backdrop_path: buildDeliveryUrl(row.backdrop_path, s, { fallback: row.backdrop_path || '', baseUrl }),
    type: row.anime_id ? 'anime' : row.serie_id ? 'serie' : 'movie',
  }));

  if (mode === 'hybrid' && hydratedManual.length < limit) {
    const extra = await mapAuto(limit - hydratedManual.length);
    return [...hydratedManual, ...extra].slice(0, limit);
  }
  return hydratedManual;
}

async function resolveRvSection(rawSetting, kindFilter, limit, s, baseUrl) {
  const genres = parseCsvStrings(rawSetting);
  if (genres.length) {
    const ph = genres.map(() => '?').join(',');
    const [mRows, sRows, aRows] = await Promise.all([
      kindFilter === 'network'
        ? queryAll(
            `SELECT DISTINCT m.* FROM movies m INNER JOIN movie_networks mn ON mn.movie_id = m.id INNER JOIN networks n ON n.id = mn.network_id WHERE m.active = 1 AND (LOWER(n.name) IN (${ph}) OR ${castAsText('n.id')} IN (${ph})) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), ...genres, limit]
          )
        : kindFilter === 'lang'
        ? queryAll(
            `SELECT DISTINCT m.* FROM movies m INNER JOIN movie_spoken_languages ml ON ml.movie_id = m.id WHERE m.active = 1 AND LOWER(ml.iso_639_1) IN (${ph}) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), limit]
          )
        : queryAll(
            `SELECT DISTINCT m.* FROM movies m INNER JOIN movie_genres mg ON mg.movie_id = m.id INNER JOIN genres g ON g.id = mg.genre_id WHERE m.active = 1 AND (LOWER(g.name) IN (${ph}) OR ${castAsText('g.id')} IN (${ph})) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), ...genres, limit]
          ),
      kindFilter === 'network'
        ? queryAll(
            `SELECT DISTINCT sr.* FROM series sr INNER JOIN serie_networks sn ON sn.serie_id = sr.id INNER JOIN networks n ON n.id = sn.network_id WHERE sr.active = 1 AND (LOWER(n.name) IN (${ph}) OR ${castAsText('n.id')} IN (${ph})) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), ...genres, limit]
          )
        : kindFilter === 'lang'
        ? queryAll(
            `SELECT DISTINCT sr.* FROM series sr INNER JOIN serie_spoken_languages sl ON sl.serie_id = sr.id WHERE sr.active = 1 AND LOWER(sl.iso_639_1) IN (${ph}) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), limit]
          )
        : queryAll(
            `SELECT DISTINCT sr.* FROM series sr INNER JOIN serie_genres sg ON sg.serie_id = sr.id INNER JOIN genres g ON g.id = sg.genre_id WHERE sr.active = 1 AND (LOWER(g.name) IN (${ph}) OR ${castAsText('g.id')} IN (${ph})) LIMIT ?`,
            [...genres.map((g) => g.toLowerCase()), ...genres, limit]
          ),
      queryAll(`SELECT * FROM animes WHERE active = 1 ORDER BY views DESC LIMIT ?`, [Math.ceil(limit / 3)]),
    ]);

    const [mH, sH, aH] = await Promise.all([
      hydrateList('movie', mRows),
      hydrateList('serie', sRows),
      hydrateList('anime', aRows),
    ]);
    return [
      ...mH.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
      ...sH.map((r) => toUnifiedMediaItem(r, 'serie', s, baseUrl)),
      ...aH.map((r) => toUnifiedMediaItem(r, 'anime', s, baseUrl)),
    ].slice(0, limit);
  }

  const mRows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY popularity DESC, id DESC LIMIT ?', [limit]);
  const mH = await hydrateList('movie', mRows);
  return mH.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl));
}

async function hydrateLivetvRows(rows, s, baseUrl) {
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const ph = ids.map(() => '?').join(',');
  const [genreLinks, videoRows] = await Promise.all([
    queryAll(
      `SELECT lg.livetv_id, c.id, c.name FROM livetv_genres lg INNER JOIN categories c ON c.id = lg.category_id WHERE lg.livetv_id IN (${ph})`,
      ids
    ),
    queryAll(`SELECT * FROM livetv_videos WHERE livetv_id IN (${ph}) AND status = 1 ORDER BY id ASC`, ids),
  ]);
  const genreMap = new Map();
  for (const g of genreLinks) {
    if (!genreMap.has(g.livetv_id)) genreMap.set(g.livetv_id, []);
    genreMap.get(g.livetv_id).push({ id: Number(g.id), category_id: Number(g.id), name: g.name });
  }
  const vidMap = new Map();
  for (const v of videoRows) {
    if (!vidMap.has(v.livetv_id)) vidMap.set(v.livetv_id, []);
    vidMap.get(v.livetv_id).push(v);
  }
  return rows.map((r) => {
    const genres = genreMap.get(r.id) || [];
    const genresname = genres.map((g) => g.name);
    return {
      ...r,
      id: Number(r.id),
      poster_path: buildDeliveryUrl(r.poster_path, s, { fallback: r.poster_path || '', baseUrl }),
      backdrop_path: buildDeliveryUrl(r.backdrop_path, s, { fallback: r.backdrop_path || '', baseUrl }),
      backposter: buildDeliveryUrl(r.backdrop_path || r.poster_path, s, { fallback: '', baseUrl }),
      genres,
      genresname,
      genre_name: genresname[0] || '',
      videos: vidMap.get(r.id) || [],
    };
  });
}

async function buildMobileResponse(req) {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);

  const [
    featuredRows,
    popularMoviesRows,
    latestMoviesRows,
    thisweekMoviesRows,
    choosedMoviesRows,
    recommendedMoviesRows,
    trendingMoviesRows,
    popularSeriesRows,
    recentSeriesRows,
    animeRows,
    livetvRows,
    upcomingRows,
    networksRows,
    collectionsRows,
    pinnedMoviesRows,
    languageRows,
    castsRows,
    previewsRows,
    latestSeriesEpisodes,
    latestAnimeEpisodes,
    top10Items,
    rvcontent,
    rvcontentnetwork,
    rvcontentlangs,
  ] = await Promise.all([
    queryAll('SELECT * FROM featureds ORDER BY position ASC, id ASC LIMIT ?', [parseLimit(s.limit_featured, 10)]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY views DESC, popularity DESC LIMIT ?', [
      parseLimit(s.limit_popular, 10),
    ]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY id DESC LIMIT ?', [parseLimit(s.limit_latest, 10)]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY release_date DESC, id DESC LIMIT ?', [
      parseLimit(s.limit_thisweek, 10),
    ]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY vote_average DESC, popularity DESC LIMIT ?', [
      parseLimit(s.limit_choosed, 10),
    ]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY vote_average DESC, views DESC LIMIT ?', [
      parseLimit(s.limit_recommended, 10),
    ]),
    queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY popularity DESC, views DESC LIMIT ?', [
      parseLimit(s.limit_trending, 10),
    ]),
    queryAll('SELECT * FROM series WHERE active = 1 ORDER BY views DESC, popularity DESC LIMIT ?', [
      parseLimit(s.limit_popular_series, 20),
    ]),
    queryAll('SELECT * FROM series WHERE active = 1 ORDER BY id DESC LIMIT ?', [parseLimit(s.limit_recent_series, 10)]),
    Number(s.anime ?? 1)
      ? queryAll('SELECT * FROM animes WHERE active = 1 ORDER BY id DESC LIMIT ?', [parseLimit(s.limit_animes_latest, 10)])
      : [],
    Number(s.livetv ?? 1)
      ? queryAll('SELECT * FROM livetvs WHERE active = 1 ORDER BY featured DESC, views DESC LIMIT ?', [
          parseLimit(s.limit_streaming, 10),
        ])
      : [],
    Number(s.enable_upcoming ?? 1)
      ? queryAll('SELECT * FROM upcomings ORDER BY id DESC LIMIT ?', [parseLimit(s.limit_upcoming, 10)])
      : [],
    Number(s.networks || 0)
      ? queryAll('SELECT * FROM networks ORDER BY id ASC LIMIT ?', [parseLimit(s.limit_networks, 10)])
      : [],
    Number(s.enable_collections || 0)
      ? queryAll('SELECT * FROM collections ORDER BY id ASC LIMIT ?', [parseLimit(s.limit_collections, 10)])
      : [],
    Number(s.enable_pinned || 0)
      ? queryAll('SELECT * FROM movies WHERE active = 1 AND pinned = 1 ORDER BY id DESC LIMIT ?', [
          parseLimit(s.limit_pinned, 10),
        ])
      : [],
    Number(s.enable_watchinyourlang || 0)
      ? queryAll('SELECT * FROM languages ORDER BY featured DESC, english_name ASC')
      : [],
    queryAll('SELECT * FROM casts WHERE active = 1 ORDER BY popularity DESC, id DESC LIMIT ?', [
      parseLimit(s.limit_casts, 10),
    ]),
    queryAll('SELECT * FROM previews ORDER BY id DESC LIMIT 15'),
    resolveLatestSeriesEpisodes(parseLimit(s.limit_latest_episodes_series, 20)),
    resolveLatestAnimeEpisodes(parseLimit(s.limit_latest_episodes_animes, 20)),
    resolveTop10(s, parseLimit(s.limit_top10, 10), baseUrl),
    resolveRvSection(s.rv_content, 'genre', parseLimit(s.limit_rv_content, 15), s, baseUrl),
    resolveRvSection(s.rv_content_network, 'network', parseLimit(s.limit_rv_content_network, 15), s, baseUrl),
    resolveRvSection(s.rv_content_lang, 'lang', parseLimit(s.limit_rv_content_lang, 15), s, baseUrl),
  ]);

  const [
    popMovies,
    latMovies,
    twMovies,
    chMovies,
    recMovies,
    trMovies,
    popSeries,
    recSeries,
    animesHydrated,
    pinnedHydrated,
    livetvHydrated,
  ] = await Promise.all([
    hydrateList('movie', popularMoviesRows),
    hydrateList('movie', latestMoviesRows),
    hydrateList('movie', thisweekMoviesRows),
    hydrateList('movie', choosedMoviesRows),
    hydrateList('movie', recommendedMoviesRows),
    hydrateList('movie', trendingMoviesRows),
    hydrateList('serie', popularSeriesRows),
    hydrateList('serie', recentSeriesRows),
    hydrateList('anime', animeRows),
    hydrateList('movie', pinnedMoviesRows),
    hydrateLivetvRows(livetvRows, s, baseUrl),
  ]);

  const unifiedLatestMovies = latMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl));
  const unifiedPopular = popMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl));
  const unifiedPopularSeries = popSeries.map((r) => toUnifiedMediaItem(r, 'serie', s, baseUrl));
  const unifiedRecents = recSeries.map((r) => toUnifiedMediaItem(r, 'serie', s, baseUrl));

  const payload = {
    featured: featuredRows.map((f) => ({
      ...f,
      poster_path: buildDeliveryUrl(f.poster_path, s, { fallback: f.poster_path || '', baseUrl }),
      backdrop_path: buildDeliveryUrl(f.backdrop_path, s, { fallback: f.backdrop_path || '', baseUrl }),
    })),
    popular: unifiedPopular,
    latest: unifiedLatestMovies,
    latest_movies: unifiedLatestMovies,
    thisweek: twMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
    choosed: chMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
    recommended: recMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
    trending: trMovies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
    top10: top10Items,
    popularSeries: unifiedPopularSeries,
    recents: unifiedRecents,
    popular_casters: castsRows,
    previews: previewsRows,
    rvcontent,
    rvcontentnetwork,
    rvcontentlangs,
    latest_episodes: latestSeriesEpisodes,
    latest_episodes_animes: latestAnimeEpisodes,
  };

  if (Number(s.anime ?? 1)) payload.anime = animesHydrated.map((r) => toUnifiedMediaItem(r, 'anime', s, baseUrl));
  if (Number(s.networks || 0)) payload.networks = networksRows;
  if (Number(s.enable_upcoming ?? 1)) payload.upcoming = upcomingRows;
  if (Number(s.livetv ?? 1)) payload.livetv = livetvHydrated;
  if (Number(s.enable_collections || 0)) payload.collections = collectionsRows;
  if (Number(s.enable_pinned || 0)) payload.pinned = pinnedHydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl));
  if (Number(s.enable_watchinyourlang || 0)) payload.languages = languageRows;

  return payload;
}

// ================= HOME & MOBILE DISCOVERY =================
router.get(['/api/media/mobile/:code', '/api/media/mobile', '/api/media/homecontent/:code', '/api/media/homecontent'], async (req, res) => {
  return res.json(await buildMobileResponse(req));
});

// ================= MOVIES =================
router.get('/api/media/detail/:movie/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM movies WHERE id = ?', [Number(req.params.movie)]);
  if (!row) return res.status(404).json({ message: 'Movie not found' });
  const settings = await getSettingsRow();
  let hydrated = await hydrateMediaRecord('movie', row);
  hydrated = await attachServers(hydrated, { kind: 'movie', user: req.user, settings, req });
  hydrated = await attachDownloads(hydrated, { kind: 'movie', user: req.user, settings, req });
  hydrated.substype = hydrated.substitles?.length ? hydrated.substitles[0].type : null;
  return res.json(await attachCommentsAndRelateds(hydrated, 'movie'));
});

router.get('/api/media/view/:movie/:code?', async (req, res) => {
  await execute('UPDATE movies SET views = views + 1, updated_at = ? WHERE id = ?', [nowIso(), Number(req.params.movie)]);
  return res.json({ status: 200 });
});

router.get('/api/media/substitles/:movie/:code?', async (req, res) => {
  const subs = await queryAll('SELECT * FROM movie_substitles WHERE movie_id = ? ORDER BY id ASC', [
    Number(req.params.movie),
  ]);
  return res.json(subs);
});

router.get('/api/movies/videos/:movie', async (req, res) => {
  const movie = await queryOne('SELECT * FROM movies WHERE id = ?', [Number(req.params.movie)]);
  if (!movie) return res.json([]);
  const settings = await getSettingsRow();
  const attached = await attachServers(movie, { kind: 'movie', user: req.user, settings, req });
  return res.json(attached.servers || []);
});

router.get('/api/media/relateds/:movie/:code?', async (req, res) => {
  const id = Number(req.params.movie);
  const rows = await queryAll(`SELECT * FROM movies WHERE active = 1 AND id != ? ORDER BY ${randomOrderSql()} LIMIT 10`, [id]);
  return res.json({ relateds: await hydrateList('movie', rows) });
});

router.get('/api/media/latestcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY id DESC LIMIT ?', [parseLimit(s.limit_latest, 15)]);
  const hydrated = await hydrateList('movie', rows);
  return res.json({ latest: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/recentscontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY release_date DESC, id DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ recents: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/popularcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY views DESC, popularity DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ popular: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/recommendedcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY vote_average DESC, views DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ recommended: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/trendingcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY popularity DESC, views DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ trending: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/thisweekcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY id DESC LIMIT 10');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ thisweek: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/pinnedcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 AND pinned = 1 ORDER BY id DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ pinned: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/choosedcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll('SELECT * FROM movies WHERE active = 1 ORDER BY vote_average DESC LIMIT 15');
  const hydrated = await hydrateList('movie', rows);
  return res.json({ choosed: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/suggestedcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  const rows = await queryAll(`SELECT * FROM movies WHERE active = 1 ORDER BY ${randomOrderSql()} LIMIT 10`);
  const hydrated = await hydrateList('movie', rows);
  return res.json({ suggested: hydrated.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)) });
});

router.get('/api/media/randomcontent/:code?', async (_req, res) => {
  const rows = await queryAll(`SELECT * FROM movies WHERE active = 1 ORDER BY ${randomOrderSql()} LIMIT 1`);
  return res.json({ random: await hydrateList('movie', rows) });
});

router.get('/api/media/randomMovie/:code?', async (_req, res) => {
  const row = await queryOne(`SELECT * FROM movies WHERE active = 1 ORDER BY ${randomOrderSql()} LIMIT 1`);
  if (!row) return res.status(404).json({ message: 'No movies available' });
  return res.json(await hydrateMediaRecord('movie', row));
});

router.get('/api/media/featuredcontent/:code?', async (_req, res) => {
  return res.json({ featured: await queryAll('SELECT * FROM featureds ORDER BY position ASC, id ASC') });
});

router.get('/api/media/topcontent/:code?', async (req, res) => {
  const s = await getSettingsRow();
  const baseUrl = resolveRequestBaseUrl(req);
  return res.json({ top10: await resolveTop10(s, parseLimit(s.limit_top10, 10), baseUrl) });
});

router.get('/api/media/previewscontent/:code?', async (_req, res) => {
  return res.json({ previews: await queryAll('SELECT * FROM previews ORDER BY id DESC') });
});

router.get('/api/media/kids/:code?', async (_req, res) => {
  const rows = await queryAll(
    `SELECT DISTINCT m.* FROM movies m JOIN movie_genres mg ON mg.movie_id = m.id JOIN genres g ON g.id = mg.genre_id WHERE m.active = 1 AND (LOWER(g.name) LIKE '%family%' OR LOWER(g.name) LIKE '%animation%' OR LOWER(g.name) LIKE '%kids%') ORDER BY m.id DESC LIMIT 20`
  );
  return res.json({ movies: await hydrateList('movie', rows) });
});

router.get('/api/movies/latestadded/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/movies/byyear/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies',
      whereSql: 'WHERE active = 1',
      orderBySql: 'release_date DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/movies/byrating/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies',
      whereSql: 'WHERE active = 1',
      orderBySql: 'vote_average DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/movies/byviews/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies',
      whereSql: 'WHERE active = 1',
      orderBySql: 'views DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

// ================= SERIES, SEASONS & EPISODES =================
router.get('/api/series/show/:serie/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM series WHERE id = ?', [Number(req.params.serie)]);
  if (!row) return res.status(404).json({ message: 'Series not found' });
  const settings = await getSettingsRow();
  const hydrated = await hydrateMediaRecord('serie', row, { includeEpisodes: true });
  hydrated.seasons = await hydrateSeasonWithPlayback(hydrated.seasons || [], 'serie', {
    user: req.user,
    settings,
    req,
  });
  return res.json(await attachCommentsAndRelateds(hydrated, 'serie'));
});

router.get('/api/series/watch/:serie/:code?', async (req, res) => {
  await execute('UPDATE series SET views = views + 1, updated_at = ? WHERE id = ?', [nowIso(), Number(req.params.serie)]);
  return res.json({ status: 200 });
});

router.get('/api/series/relateds/:serie/:code?', async (req, res) => {
  const id = Number(req.params.serie);
  const rows = await queryAll(`SELECT * FROM series WHERE active = 1 AND id != ? ORDER BY ${randomOrderSql()} LIMIT 10`, [id]);
  return res.json({ relateds: await hydrateList('serie', rows) });
});

router.get('/api/series/season/:season/:code?', async (req, res) => {
  const seasonId = Number(req.params.season);
  const [season, rows, settings] = await Promise.all([
    queryOne('SELECT * FROM seasons WHERE id = ?', [seasonId]),
    queryAll('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number ASC, id ASC', [seasonId]),
    getSettingsRow(),
  ]);
  const episodes = await Promise.all(
    rows.map(async (ep) => {
      let item = await attachServers(ep, {
        kind: 'episode',
        user: req.user,
        settings,
        req,
      });
      item = await attachDownloads(item, {
        kind: 'episode',
        user: req.user,
        settings,
        req,
      });
      return item;
    })
  );
  return res.json({ episodes });
});

router.get('/api/series/seasons/:season/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM episodes',
      whereSql: 'WHERE season_id = ?',
      params: [Number(req.params.season)],
      orderBySql: 'episode_number ASC, id ASC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

router.get(['/api/series/episodeshow/:episode/:code?', '/api/series/showEpisodeNotif/:episode/:code?'], async (req, res) => {
  const ep = await queryOne('SELECT * FROM episodes WHERE id = ?', [Number(req.params.episode)]);
  if (!ep) return res.status(404).json({ message: 'Episode not found' });
  const [season, settings, substitles] = await Promise.all([
    queryOne('SELECT * FROM seasons WHERE id = ?', [ep.season_id]),
    getSettingsRow(),
    queryAll('SELECT * FROM serie_substitles WHERE episode_id = ?', [ep.id]),
  ]);
  let hydratedEp = { ...ep, substitles };
  hydratedEp = await attachServers(hydratedEp, {
    kind: 'episode',
    user: req.user,
    settings,
    req,
  });
  hydratedEp = await attachDownloads(hydratedEp, {
    kind: 'episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episode: [hydratedEp], episodes: [hydratedEp] });
});

router.get(['/api/series/episode/:episode/:code?', '/api/series/videos/:episode'], async (req, res) => {
  const epId = Number(req.params.episode);
  const ep = await queryOne('SELECT * FROM episodes WHERE id = ?', [epId]);
  const settings = await getSettingsRow();
  const attached = await attachServers(ep || { id: epId }, {
    kind: 'episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episode_stream: attached.servers || [] });
});

router.get('/api/series/substitle/:episode/:code?', async (req, res) => {
  const episode_stream = await queryAll('SELECT * FROM serie_substitles WHERE episode_id = ? ORDER BY id ASC', [
    Number(req.params.episode),
  ]);
  return res.json({ episode_stream });
});

router.get('/api/series/next-episode/:episode/:code?', async (req, res) => {
  const cur = await queryOne('SELECT * FROM episodes WHERE id = ?', [Number(req.params.episode)]);
  if (!cur) return res.json({ episodes: [] });
  const next = await queryOne(
    'SELECT * FROM episodes WHERE season_id = ? AND episode_number > ? ORDER BY episode_number ASC LIMIT 1',
    [cur.season_id, cur.episode_number]
  );
  if (!next) return res.json({ episodes: [] });
  const settings = await getSettingsRow();
  const attached = await attachServers(next, {
    kind: 'episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episodes: [attached] });
});

router.get('/api/series/view/:episode/:code?', async (req, res) => {
  await execute('UPDATE episodes SET views = views + 1, updated_at = ? WHERE id = ?', [nowIso(), Number(req.params.episode)]);
  return res.json({ status: 200 });
});

router.get('/api/series/recommended/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM series WHERE active = 1 ORDER BY vote_average DESC, views DESC LIMIT 15');
  return res.json({ recommended: await hydrateList('serie', rows) });
});

router.get('/api/series/popular/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM series WHERE active = 1 ORDER BY views DESC, popularity DESC LIMIT 15');
  return res.json({ popularSeries: await hydrateList('serie', rows) });
});

router.get('/api/series/recentscontent/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM series WHERE active = 1 ORDER BY id DESC LIMIT 15');
  return res.json({ recents: await hydrateList('serie', rows) });
});

router.get(['/api/series/newEpisodescontent/:code?', '/api/series/latestepisodes/:code?'], async (_req, res) => {
  return res.json({ latest_episodes: await resolveLatestSeriesEpisodes(20) });
});

router.get('/api/media/seriesEpisodesAll/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom:
        'FROM episodes e INNER JOIN seasons se ON se.id = e.season_id INNER JOIN series s ON s.id = se.serie_id',
      whereSql: 'WHERE s.active = 1',
      selectSql:
        'e.*, se.season_number, se.serie_id, s.name AS serie_name, s.poster_path AS serie_poster_path, s.backdrop_path AS serie_backdrop_path',
      orderBySql: 'e.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

router.get('/api/series/latestadded/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM series',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/series/byyear/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM series',
      whereSql: 'WHERE active = 1',
      orderBySql: 'first_air_date DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/series/byrating/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM series',
      whereSql: 'WHERE active = 1',
      orderBySql: 'vote_average DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/series/byviews/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM series',
      whereSql: 'WHERE active = 1',
      orderBySql: 'views DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/series/kids/:code?', async (_req, res) => {
  const rows = await queryAll(
    `SELECT DISTINCT s.* FROM series s JOIN serie_genres sg ON sg.serie_id = s.id JOIN genres g ON g.id = sg.genre_id WHERE s.active = 1 AND (LOWER(g.name) LIKE '%family%' OR LOWER(g.name) LIKE '%animation%' OR LOWER(g.name) LIKE '%kids%') ORDER BY s.id DESC LIMIT 20`
  );
  return res.json({ series: await hydrateList('serie', rows) });
});

// ================= ANIMES =================
router.get('/api/animes/show/:anime/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM animes WHERE id = ?', [Number(req.params.anime)]);
  if (!row) return res.status(404).json({ message: 'Anime not found' });
  const settings = await getSettingsRow();
  const hydrated = await hydrateMediaRecord('anime', row, { includeEpisodes: true });
  hydrated.seasons = await hydrateSeasonWithPlayback(hydrated.seasons || [], 'anime', {
    user: req.user,
    settings,
    req,
  });
  return res.json(await attachCommentsAndRelateds(hydrated, 'anime'));
});

router.get('/api/animes/watch/:serie/:code?', async (req, res) => {
  await execute('UPDATE animes SET views = views + 1, updated_at = ? WHERE id = ?', [nowIso(), Number(req.params.serie)]);
  return res.json({ status: 200 });
});

router.get('/api/animes/recents/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM animes WHERE active = 1 ORDER BY id DESC LIMIT 15');
  return res.json({ anime: await hydrateList('anime', rows) });
});

router.get('/api/animes/relateds/:anime/:code?', async (req, res) => {
  const id = Number(req.params.anime);
  const rows = await queryAll(`SELECT * FROM animes WHERE active = 1 AND id != ? ORDER BY ${randomOrderSql()} LIMIT 10`, [id]);
  return res.json({ relateds: await hydrateList('anime', rows) });
});

router.get('/api/animes/season/:season/:code?', async (req, res) => {
  const seasonId = Number(req.params.season);
  const [season, rows, settings] = await Promise.all([
    queryOne('SELECT * FROM anime_seasons WHERE id = ?', [seasonId]),
    queryAll('SELECT * FROM anime_episodes WHERE anime_season_id = ? ORDER BY episode_number ASC, id ASC', [seasonId]),
    getSettingsRow(),
  ]);
  const episodes = await Promise.all(
    rows.map(async (ep) => {
      let item = await attachServers(ep, {
        kind: 'anime_episode',
        user: req.user,
        settings,
        req,
      });
      item = await attachDownloads(item, {
        kind: 'anime_episode',
        user: req.user,
        settings,
        req,
      });
      return item;
    })
  );
  return res.json({ episodes });
});

router.get('/api/animes/seasons/:season/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM anime_episodes',
      whereSql: 'WHERE anime_season_id = ?',
      params: [Number(req.params.season)],
      orderBySql: 'episode_number ASC, id ASC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

router.get(['/api/animes/episodeshow/:episode/:code?', '/api/animes/showEpisodeNotif/:episode/:code?'], async (req, res) => {
  const ep = await queryOne('SELECT * FROM anime_episodes WHERE id = ?', [Number(req.params.episode)]);
  if (!ep) return res.status(404).json({ message: 'Episode not found' });
  const [season, settings, substitles] = await Promise.all([
    queryOne('SELECT * FROM anime_seasons WHERE id = ?', [ep.anime_season_id]),
    getSettingsRow(),
    queryAll('SELECT * FROM anime_substitles WHERE anime_episode_id = ?', [ep.id]),
  ]);
  let hydratedEp = { ...ep, substitles };
  hydratedEp = await attachServers(hydratedEp, {
    kind: 'anime_episode',
    user: req.user,
    settings,
    req,
  });
  hydratedEp = await attachDownloads(hydratedEp, {
    kind: 'anime_episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episodes: [hydratedEp] });
});

router.get('/api/animes/next-episode/:episode/:code?', async (req, res) => {
  const cur = await queryOne('SELECT * FROM anime_episodes WHERE id = ?', [Number(req.params.episode)]);
  if (!cur) return res.json({ episodes: [] });
  const next = await queryOne(
    'SELECT * FROM anime_episodes WHERE anime_season_id = ? AND episode_number > ? ORDER BY episode_number ASC LIMIT 1',
    [cur.anime_season_id, cur.episode_number]
  );
  if (!next) return res.json({ episodes: [] });
  const settings = await getSettingsRow();
  const attached = await attachServers(next, {
    kind: 'anime_episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episodes: [attached] });
});

router.get(['/api/animes/episode/:episode/:code?', '/api/animes/videos/:episode'], async (req, res) => {
  const epId = Number(req.params.episode);
  const ep = await queryOne('SELECT * FROM anime_episodes WHERE id = ?', [epId]);
  const settings = await getSettingsRow();
  const attached = await attachServers(ep || { id: epId }, {
    kind: 'anime_episode',
    user: req.user,
    settings,
    req,
  });
  return res.json({ episode_stream: attached.servers || [] });
});

router.get('/api/animes/substitle/:episode/:code?', async (req, res) => {
  const episode_stream = await queryAll('SELECT * FROM anime_substitles WHERE anime_episode_id = ? ORDER BY id ASC', [
    Number(req.params.episode),
  ]);
  return res.json({ episode_stream });
});

router.get(['/api/animes/newEpisodescontent/:code?', '/api/animes/latestepisodes/:code?'], async (_req, res) => {
  return res.json({ latest_episodes: await resolveLatestAnimeEpisodes(20) });
});

router.get('/api/media/animesEpisodesAll/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom:
        'FROM anime_episodes e INNER JOIN anime_seasons se ON se.id = e.anime_season_id INNER JOIN animes a ON a.id = se.anime_id',
      whereSql: 'WHERE a.active = 1',
      selectSql:
        'e.*, se.season_number, se.anime_id, a.name AS anime_name, a.poster_path AS anime_poster_path, a.backdrop_path AS anime_backdrop_path',
      orderBySql: 'e.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

router.get('/api/animes/latestadded/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM animes',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/animes/byyear/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM animes',
      whereSql: 'WHERE active = 1',
      orderBySql: 'first_air_date DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/animes/byrating/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM animes',
      whereSql: 'WHERE active = 1',
      orderBySql: 'vote_average DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/animes/byviews/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM animes',
      whereSql: 'WHERE active = 1',
      orderBySql: 'views DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  );
});

// ================= LIVE TV =================
router.get(['/api/stream/show/:livetv/:code?', '/api/livetv/show/:livetv/:code?'], async (req, res) => {
  const id = Number(req.params.livetv);
  const [row, settings] = await Promise.all([queryOne('SELECT * FROM livetvs WHERE id = ?', [id]), getSettingsRow()]);
  if (!row) return res.status(404).json({ message: 'Channel not found' });
  const baseUrl = resolveRequestBaseUrl(req);
  const [hydrated] = await hydrateLivetvRows([row], settings, baseUrl);
  const withServers = await attachServers(hydrated, { kind: 'livetv', user: req.user, settings, req });
  return res.json(withServers);
});

router.get('/api/livetv/latest/:code?', async (req, res) => {
  const [s, rows] = await Promise.all([
    getSettingsRow(),
    queryAll('SELECT * FROM livetvs WHERE active = 1 ORDER BY id DESC LIMIT 20'),
  ]);
  return res.json({ livetv: await hydrateLivetvRows(rows, s, resolveRequestBaseUrl(req)) });
});

router.get('/api/livetv/featured/:code?', async (req, res) => {
  const [s, rows] = await Promise.all([
    getSettingsRow(),
    queryAll('SELECT * FROM livetvs WHERE active = 1 AND featured = 1 ORDER BY id DESC LIMIT 20'),
  ]);
  return res.json({ featured_streaming: await hydrateLivetvRows(rows, s, resolveRequestBaseUrl(req)) });
});

router.get('/api/livetv/mostwatched/:code?', async (req, res) => {
  const [s, rows] = await Promise.all([
    getSettingsRow(),
    queryAll('SELECT * FROM livetvs WHERE active = 1 ORDER BY views DESC LIMIT 20'),
  ]);
  return res.json({ watched: await hydrateLivetvRows(rows, s, resolveRequestBaseUrl(req)) });
});

router.get('/api/livetv/random/:livetv/:code?', async (_req, res) => {
  const rows = await queryAll(`SELECT * FROM livetvs WHERE active = 1 ORDER BY ${randomOrderSql()} LIMIT 10`);
  return res.json({ random: rows });
});

router.get('/api/streaming/relateds/:movie/:code?', async (req, res) => {
  const id = Number(req.params.movie);
  return res.json({
    relateds: await queryAll(`SELECT * FROM livetvs WHERE active = 1 AND id != ? ORDER BY ${randomOrderSql()} LIMIT 10`, [id]),
  });
});

// ================= GENRES & TAXONOMY (Laravel LengthAwarePaginator) =================
router.get('/api/genres/list/:code?', async (_req, res) => {
  return res.json({ genres: await queryAll('SELECT * FROM genres ORDER BY name ASC') });
});

router.get('/api/genres/movies/all/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM movies',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  )
);

router.get('/api/genres/series/all/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM series',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  )
);

router.get('/api/genres/animes/all/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM animes',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  )
);

router.get('/api/genres/mediaLibrary/showAllManga/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM mangas',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  )
);

router.get(
  [
    '/api/genres/media/show/:genre/:code?',
    '/api/genres/media/type/:genre/:code?',
    '/api/genres/media/names/:genre/:code?',
  ],
  async (req, res) => {
    const gParam = String(req.params.genre || '');
    const genreId = Number(gParam);
    const isNumeric = Number.isFinite(genreId) && gParam.trim() !== '';
    const genreMatch = isNumeric
      ? 'g.id = ?'
      : 'LOWER(g.name) = ?';
    const matchVal = isNumeric ? genreId : gParam.trim().toLowerCase();

    return res.json(
      await paginateQuery({
        baseFrom:
          'FROM movies m INNER JOIN movie_genres mg ON mg.movie_id = m.id INNER JOIN genres g ON g.id = mg.genre_id',
        whereSql: `WHERE m.active = 1 AND ${genreMatch}`,
        params: [matchVal],
        selectSql: 'DISTINCT m.*',
        orderBySql: 'm.id DESC',
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
        req,
      })
    );
  }
);

router.get(['/api/genres/mediaLibrary/show/:genre/:type/:code?', '/api/genres/mediaLibrary/show/:genre'], async (req, res) => {
  const gParam = String(req.params.genre || '');
  const typeParam = String(req.params.type || req.query.type || 'movie').toLowerCase();
  const genreId = Number(gParam);
  const isNumeric = Number.isFinite(genreId) && gParam.trim() !== '';
  const genreMatch = isNumeric ? 'g.id = ?' : 'LOWER(g.name) = ?';
  const matchVal = isNumeric ? genreId : gParam.trim().toLowerCase();

  if (typeParam === 'serie' || typeParam === 'series') {
    return res.json(
      await paginateQuery({
        baseFrom:
          'FROM series s INNER JOIN serie_genres sg ON sg.serie_id = s.id INNER JOIN genres g ON g.id = sg.genre_id',
        whereSql: `WHERE s.active = 1 AND ${genreMatch}`,
        params: [matchVal],
        selectSql: 'DISTINCT s.*',
        orderBySql: 's.id DESC',
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
        req,
      })
    );
  }

  if (typeParam === 'anime' || typeParam === 'animes') {
    return res.json(
      await paginateQuery({
        baseFrom:
          'FROM animes a INNER JOIN anime_genres ag ON ag.anime_id = a.id INNER JOIN genres g ON g.id = ag.genre_id',
        whereSql: `WHERE a.active = 1 AND ${genreMatch}`,
        params: [matchVal],
        selectSql: 'DISTINCT a.*',
        orderBySql: 'a.id DESC',
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
        req,
      })
    );
  }

  return res.json(
    await paginateQuery({
      baseFrom:
        'FROM movies m INNER JOIN movie_genres mg ON mg.movie_id = m.id INNER JOIN genres g ON g.id = mg.genre_id',
      whereSql: `WHERE m.active = 1 AND ${genreMatch}`,
      params: [matchVal],
      selectSql: 'DISTINCT m.*',
      orderBySql: 'm.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/genres/mediaLibrary/showManga/:genre/:type/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM mangas',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

const GENRE_DISCOVERY_MAP = [
  { paths: ['/api/genres/pinned/all/:code?', '/api/genres/movies/pinned/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1 AND pinned = 1', order: 'id DESC' },
  { paths: ['/api/genres/choosed/all/:code?', '/api/genres/movies/choosed/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'vote_average DESC, popularity DESC' },
  { paths: ['/api/genres/topteen/all/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'views DESC, vote_average DESC' },
  { paths: ['/api/genres/recommended/all/:code?', '/api/genres/movies/recommended/:code?', '/api/genres/series/recommended/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'vote_average DESC, views DESC' },
  { paths: ['/api/genres/trending/all/:code?', '/api/genres/movies/trending/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'popularity DESC, views DESC' },
  { paths: ['/api/genres/new/all/:code?', '/api/genres/latestmovies/all/:code?', '/api/genres/movies/latest/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'id DESC' },
  { paths: ['/api/genres/thisweek/all/:code?', '/api/genres/movies/thisweek/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'release_date DESC, id DESC' },
  { paths: ['/api/genres/popularmovies/all/:code?', '/api/genres/movies/popular/:code?'], table: 'movies', kind: 'movie', where: 'WHERE active = 1', order: 'views DESC, popularity DESC' },
  { paths: ['/api/genres/popularseries/all/:code?', '/api/genres/series/popular/:code?'], table: 'series', kind: 'serie', where: 'WHERE active = 1', order: 'views DESC, popularity DESC' },
  { paths: ['/api/genres/latestseries/all/:code?', '/api/genres/series/latest/:code?'], table: 'series', kind: 'serie', where: 'WHERE active = 1', order: 'id DESC' },
  { paths: ['/api/genres/latestanimes/all/:code?', '/api/genres/animes/latest/:code?'], table: 'animes', kind: 'anime', where: 'WHERE active = 1', order: 'id DESC' },
  { paths: ['/api/genres/animes/popular/:code?'], table: 'animes', kind: 'anime', where: 'WHERE active = 1', order: 'views DESC, popularity DESC' },
];

for (const cfg of GENRE_DISCOVERY_MAP) {
  router.get(cfg.paths, async (req, res) => {
    const isSeriesPath = req.path.includes('/series/');
    const table = isSeriesPath ? 'series' : cfg.table;
    const kind = isSeriesPath ? 'serie' : cfg.kind;
    return res.json(
      await paginateQuery({
        baseFrom: `FROM ${table}`,
        whereSql: cfg.where,
        orderBySql: cfg.order,
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord(kind, r, { includeEpisodes: false }),
        req,
      })
    );
  });
}

// Generic fallback for remaining /api/genres/:section/:filter routes
router.get(
  [
    '/api/genres/movies/latestadded/:code?',
    '/api/genres/movies/byyear/:code?',
    '/api/genres/movies/byrating/:code?',
    '/api/genres/movies/byviews/:code?',
  ],
  async (req, res) => {
    const order = req.path.includes('byyear')
      ? 'release_date DESC, id DESC'
      : req.path.includes('byrating')
      ? 'vote_average DESC, id DESC'
      : req.path.includes('byviews')
      ? 'views DESC, id DESC'
      : 'id DESC';
    return res.json(
      await paginateQuery({
        baseFrom: 'FROM movies',
        whereSql: 'WHERE active = 1',
        orderBySql: order,
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
        req,
      })
    );
  }
);

router.get(
  [
    '/api/genres/series/latestadded/:code?',
    '/api/genres/series/byyear/:code?',
    '/api/genres/series/byrating/:code?',
    '/api/genres/series/byviews/:code?',
  ],
  async (req, res) => {
    const order = req.path.includes('byyear')
      ? 'first_air_date DESC, id DESC'
      : req.path.includes('byrating')
      ? 'vote_average DESC, id DESC'
      : req.path.includes('byviews')
      ? 'views DESC, id DESC'
      : 'id DESC';
    return res.json(
      await paginateQuery({
        baseFrom: 'FROM series',
        whereSql: 'WHERE active = 1',
        orderBySql: order,
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
        req,
      })
    );
  }
);

router.get(
  [
    '/api/genres/animes/latestadded/:code?',
    '/api/genres/animes/byyear/:code?',
    '/api/genres/animes/byrating/:code?',
    '/api/genres/animes/byviews/:code?',
  ],
  async (req, res) => {
    const order = req.path.includes('byyear')
      ? 'first_air_date DESC, id DESC'
      : req.path.includes('byrating')
      ? 'vote_average DESC, id DESC'
      : req.path.includes('byviews')
      ? 'views DESC, id DESC'
      : 'id DESC';
    return res.json(
      await paginateQuery({
        baseFrom: 'FROM animes',
        whereSql: 'WHERE active = 1',
        orderBySql: order,
        page: parsePage(req),
        perPage: parsePerPage(req, 12),
        mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
        req,
      })
    );
  }
);

// ================= CATEGORIES, COLLECTIONS, NETWORKS, CASTS, LANGUAGES =================
router.get('/api/categories/list/:code?', async (_req, res) =>
  res.json({ categories: await queryAll('SELECT * FROM categories ORDER BY name ASC') })
);

router.get('/api/categories/streaming/show/streaming/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM livetvs',
      whereSql: 'WHERE active = 1',
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  )
);

router.get('/api/categories/streaming/show/:genre/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM livetvs l INNER JOIN livetv_genres lg ON lg.livetv_id = l.id',
      whereSql: 'WHERE l.active = 1 AND lg.category_id = ?',
      params: [Number(req.params.genre)],
      selectSql: 'DISTINCT l.*',
      orderBySql: 'l.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  )
);

router.get('/api/collections/data/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM collections ORDER BY id ASC');
  return res.json(rows);
});

router.get('/api/collections/media/show/:genre/:code?', async (req, res) => {
  const param = String(req.params.genre || '').trim();
  const idNum = Number(param);
  const whereMatch = Number.isFinite(idNum) && param !== '' ? 'c.id = ?' : 'LOWER(c.name) = ?';
  const matchVal = Number.isFinite(idNum) && param !== '' ? idNum : param.toLowerCase();

  return res.json(
    await paginateQuery({
      baseFrom:
        'FROM movies m INNER JOIN movie_collections mc ON mc.movie_id = m.id INNER JOIN collections c ON c.id = mc.collection_id',
      whereSql: `WHERE m.active = 1 AND ${whereMatch}`,
      params: [matchVal],
      selectSql: 'DISTINCT m.*',
      orderBySql: 'm.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get(['/api/networks/list/:code?', '/api/networks/lists/:code?', '/api/networks/custom/'], async (_req, res) =>
  res.json({ networks: await queryAll('SELECT * FROM networks ORDER BY id ASC') })
);

router.get('/api/networks/listsPaginate/:code?', async (req, res) =>
  res.json(
    await paginateQuery({
      baseFrom: 'FROM networks',
      orderBySql: 'id ASC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  )
);

router.get(['/api/networks/media/show/:genre/:code?', '/api/genres/network/show/:genre/:code?'], async (req, res) => {
  const param = String(req.params.genre || '').trim();
  const idNum = Number(param);
  const whereMatch = Number.isFinite(idNum) && param !== '' ? 'n.id = ?' : 'LOWER(n.name) = ?';
  const matchVal = Number.isFinite(idNum) && param !== '' ? idNum : param.toLowerCase();

  return res.json(
    await paginateQuery({
      baseFrom:
        'FROM movies m INNER JOIN movie_networks mn ON mn.movie_id = m.id INNER JOIN networks n ON n.id = mn.network_id',
      whereSql: `WHERE m.active = 1 AND ${whereMatch}`,
      params: [matchVal],
      selectSql: 'DISTINCT m.*',
      orderBySql: 'm.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/media/popularCasters/:code?', async (_req, res) => {
  const rows = await queryAll('SELECT * FROM casts WHERE active = 1 ORDER BY popularity DESC, id DESC LIMIT 30');
  return res.json({ popular_casters: rows });
});

router.get('/api/genres/allCasters/all/:code?', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM casts',
      whereSql: 'WHERE active = 1',
      orderBySql: 'popularity DESC, id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 20),
      req,
    })
  );
});

router.get('/api/cast/detail/:actor/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM casts WHERE id = ?', [Number(req.params.actor)]);
  if (!row) return res.status(404).json({ message: 'Actor not found' });
  return res.json(row);
});

router.get('/api/filmographie/detail/:actor/:code?', async (req, res) => {
  const castId = Number(req.params.actor);
  const [movies, series, animes] = await Promise.all([
    queryAll('SELECT m.* FROM movies m INNER JOIN movie_casts mc ON mc.movie_id = m.id WHERE mc.cast_id = ?', [castId]),
    queryAll('SELECT s.* FROM series s INNER JOIN serie_casts sc ON sc.serie_id = s.id WHERE sc.cast_id = ?', [castId]),
    queryAll('SELECT a.* FROM animes a INNER JOIN anime_casts ac ON ac.anime_id = a.id WHERE ac.cast_id = ?', [castId]),
  ]);
  const [mH, sH, aH] = await Promise.all([
    hydrateList('movie', movies),
    hydrateList('serie', series),
    hydrateList('anime', animes),
  ]);
  const all = [...mH, ...sH, ...aH];
  const page = parsePage(req);
  const perPage = parsePerPage(req, 12);
  const offset = (page - 1) * perPage;
  const slice = all.slice(offset, offset + perPage);
  const lastPage = Math.max(1, Math.ceil(all.length / perPage));
  const pathUrl = `${resolveRequestBaseUrl(req)}${req.path}`;
  return res.json({
    current_page: page,
    data: slice,
    from: slice.length ? offset + 1 : null,
    last_page: lastPage,
    path: pathUrl,
    per_page: perPage,
    to: slice.length ? offset + slice.length : null,
    total: all.length,
    filmographie: all,
    movies: mH,
    series: sH,
    animes: aH,
  });
});

router.get(['/api/languages/data/:code?', '/api/languages/datalibrary/:code?'], async (_req, res) => {
  const rows = await queryAll('SELECT * FROM languages ORDER BY featured DESC, english_name ASC');
  return res.json(rows);
});

router.get(['/api/languages/media/show/:genre/:code?', '/api/languages/media/names/:genre/:code?'], async (req, res) => {
  const code = String(req.params.genre || '').trim().toLowerCase();
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies m INNER JOIN movie_spoken_languages ml ON ml.movie_id = m.id',
      whereSql: 'WHERE m.active = 1 AND (LOWER(ml.iso_639_1) = ? OR LOWER(ml.language_code) = ? OR LOWER(ml.english_name) = ?)',
      params: [code, code, code],
      selectSql: 'DISTINCT m.*',
      orderBySql: 'm.id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/servers/data/:code?', async (_req, res) =>
  res.json({ servers: await queryAll('SELECT * FROM servers WHERE status = 1 ORDER BY id ASC') })
);

router.get('/api/servers/qualities', async (_req, res) => {
  const rows = await queryAll("SELECT DISTINCT quality FROM movie_videos WHERE quality IS NOT NULL AND quality != '' ORDER BY quality ASC");
  return res.json({ qualities: rows.map((r) => r.quality) });
});

router.get('/api/servers/qualities-with-count', async (_req, res) => {
  const rows = await queryAll(
    "SELECT quality AS name, COUNT(*) AS count FROM movie_videos WHERE quality IS NOT NULL AND quality != '' GROUP BY quality ORDER BY count DESC"
  );
  return res.json({ qualities: rows });
});

router.get('/api/servers/by-quality', async (req, res) => {
  const quality = String(req.query.quality || '').trim();
  const rows = quality
    ? await queryAll('SELECT * FROM movie_videos WHERE quality = ? AND is_active = 1 ORDER BY id DESC LIMIT 30', [quality])
    : await queryAll('SELECT * FROM movie_videos WHERE is_active = 1 ORDER BY id DESC LIMIT 30');
  return res.json({ data: rows, servers: rows });
});

router.get('/api/servers/check-quality/:type/:id/:quality', async (req, res) => {
  const type = String(req.params.type || 'movie').toLowerCase();
  const id = Number(req.params.id);
  const quality = String(req.params.quality || '').trim();
  const table =
    type === 'episode' || type === 'serie'
      ? 'serie_videos'
      : type === 'anime_episode' || type === 'anime'
      ? 'anime_videos'
      : 'movie_videos';
  const fk =
    type === 'episode' || type === 'serie'
      ? 'episode_id'
      : type === 'anime_episode' || type === 'anime'
      ? 'anime_episode_id'
      : 'movie_id';
  const rows = await queryAll(`SELECT * FROM ${table} WHERE ${fk} = ? AND LOWER(quality) = LOWER(?)`, [id, quality]);
  return res.json({ available: rows.length > 0, count: rows.length, servers: rows });
});

router.get('/api/upcoming/latest/:code?', async (_req, res) =>
  res.json({ upcoming: await queryAll('SELECT * FROM upcomings ORDER BY id DESC LIMIT 20') })
);

router.get('/api/upcoming/show/:upcoming/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM upcomings WHERE id = ?', [Number(req.params.upcoming)]);
  if (!row) return res.status(404).json({ message: 'Upcoming item not found' });
  return res.json(row);
});

router.get('/api/previews/latest/:code?', async (_req, res) =>
  res.json({ previews: await queryAll('SELECT * FROM previews ORDER BY id DESC LIMIT 20') })
);

// ================= ADVANCED FILTER & SEARCH =================
router.get('/api/genres/filter-options', async (_req, res) => {
  const [genres, servers, qualitiesRows, oldestMovie, languages, certifications] = await Promise.all([
    queryAll('SELECT id, name FROM genres ORDER BY name ASC'),
    queryAll('SELECT id, name FROM servers WHERE status = 1 ORDER BY name ASC'),
    queryAll("SELECT DISTINCT quality FROM movie_videos WHERE quality IS NOT NULL AND quality != '' ORDER BY quality ASC"),
    queryOne("SELECT MIN(release_date) AS oldest FROM movies WHERE release_date IS NOT NULL AND release_date >= '1900-01-01'"),
    queryAll('SELECT * FROM languages ORDER BY english_name ASC'),
    queryAll('SELECT * FROM certifications ORDER BY country_code ASC'),
  ]);
  const rawOldest = oldestMovie?.oldest;
  const oldestDate =
    rawOldest instanceof Date
      ? rawOldest.toISOString().slice(0, 10)
      : rawOldest
      ? String(rawOldest).slice(0, 10)
      : '1980-01-01';
  return res.json({
    genres,
    content_types: ['movie', 'serie', 'anime'],
    servers,
    qualities: qualitiesRows.map((q) => q.quality),
    oldest_release_year: Number(oldestDate.slice(0, 4)) || 1980,
    oldest_release_date: oldestDate,
    sort_options: ['latest', 'popular', 'rating', 'views', 'year'],
    languages,
    certifications,
  });
});

router.get(['/api/genres/advanced-filter', '/api/genres/search-with-filters'], async (req, res) => {
  const q = String(req.query.q || req.query.query || '').trim();
  const type = String(req.query.type || req.query.content_type || 'movie').toLowerCase();
  const genreIds = parseCsvIds(req.query.genres || req.query.genre);
  const sort = String(req.query.sort || 'latest').toLowerCase();
  const minRating = Number(req.query.min_rating || 0);
  const yearFrom = String(req.query.year_from || '').trim();
  const yearTo = String(req.query.year_to || '').trim();

  const isSerie = type === 'serie' || type === 'series';
  const isAnime = type === 'anime' || type === 'animes';
  const table = isSerie ? 'series' : isAnime ? 'animes' : 'movies';
  const kind = isSerie ? 'serie' : isAnime ? 'anime' : 'movie';
  const titleCol = isSerie || isAnime ? 'name' : 'title';
  const dateCol = isSerie || isAnime ? 'first_air_date' : 'release_date';
  const genreJoinTable = isSerie ? 'serie_genres' : isAnime ? 'anime_genres' : 'movie_genres';
  const genreFk = isSerie ? 'serie_id' : isAnime ? 'anime_id' : 'movie_id';

  let baseFrom = `FROM ${table} m`;
  const where = ['m.active = 1'];
  const params = [];

  if (genreIds.length) {
    baseFrom += ` INNER JOIN ${genreJoinTable} j ON j.${genreFk} = m.id`;
    where.push(`j.genre_id IN (${genreIds.map(() => '?').join(',')})`);
    params.push(...genreIds);
  }
  if (q) {
    where.push(`(m.${titleCol} LIKE ? OR m.original_name LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (minRating > 0) {
    where.push('m.vote_average >= ?');
    params.push(minRating);
  }
  if (yearFrom) {
    where.push(`m.${dateCol} >= ?`);
    params.push(`${yearFrom}-01-01`);
  }
  if (yearTo) {
    where.push(`m.${dateCol} <= ?`);
    params.push(`${yearTo}-12-31`);
  }

  const orderBy =
    sort === 'popular' || sort === 'views'
      ? 'm.views DESC, m.id DESC'
      : sort === 'rating'
      ? 'm.vote_average DESC, m.id DESC'
      : sort === 'year'
      ? `m.${dateCol} DESC, m.id DESC`
      : 'm.id DESC';

  return res.json(
    await paginateQuery({
      baseFrom,
      whereSql: `WHERE ${where.join(' AND ')}`,
      params,
      selectSql: 'DISTINCT m.*',
      orderBySql: orderBy,
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord(kind, r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/search/:query/:code?', async (req, res) => {
  const q = String(req.params.query || '').trim();
  const typeFilter = String(req.query.type || 'all').toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const page = parsePage(req);
  const perPage = parsePerPage(req, limit);
  const like = `%${q}%`;

  const [mRows, sRows, aRows, livetv, casts] = await Promise.all([
    ['all', 'movie', 'movies'].includes(typeFilter)
      ? queryAll('SELECT * FROM movies WHERE active = 1 AND (title LIKE ? OR original_name LIKE ?) ORDER BY id DESC LIMIT ?', [like, like, limit])
      : [],
    ['all', 'serie', 'series'].includes(typeFilter)
      ? queryAll('SELECT * FROM series WHERE active = 1 AND (name LIKE ? OR original_name LIKE ?) ORDER BY id DESC LIMIT ?', [like, like, limit])
      : [],
    ['all', 'anime', 'animes'].includes(typeFilter)
      ? queryAll('SELECT * FROM animes WHERE active = 1 AND (name LIKE ? OR original_name LIKE ?) ORDER BY id DESC LIMIT ?', [like, like, limit])
      : [],
    ['all', 'livetv', 'streaming'].includes(typeFilter)
      ? queryAll('SELECT * FROM livetvs WHERE active = 1 AND name LIKE ? ORDER BY id DESC LIMIT ?', [like, limit])
      : [],
    ['all', 'cast', 'casts'].includes(typeFilter)
      ? queryAll('SELECT * FROM casts WHERE active = 1 AND name LIKE ? ORDER BY popularity DESC LIMIT ?', [like, limit])
      : [],
  ]);

  const [s, [movies, series, animes]] = await Promise.all([
    getSettingsRow(),
    Promise.all([hydrateList('movie', mRows), hydrateList('serie', sRows), hydrateList('anime', aRows)]),
  ]);

  const baseUrl = resolveRequestBaseUrl(req);
  const unified = [
    ...movies.map((r) => toUnifiedMediaItem(r, 'movie', s, baseUrl)),
    ...series.map((r) => toUnifiedMediaItem(r, 'serie', s, baseUrl)),
    ...animes.map((r) => toUnifiedMediaItem(r, 'anime', s, baseUrl)),
    ...livetv.map((r) => ({ ...r, type: 'livetv' })),
  ];

  const offset = (page - 1) * perPage;
  const pagedResults = unified.slice(offset, offset + perPage);

  return res.json({
    query: q,
    total: unified.length,
    page,
    per_page: perPage,
    results: pagedResults,
    search: unified,
    movies,
    series,
    animes,
    livetv,
    casts,
  });
});

// ================= ADS, VAST/VMAP & EMBEDS =================
router.get('/api/ads', async (_req, res) => {
  const row = await queryOne(`SELECT * FROM ads ORDER BY ${randomOrderSql()} LIMIT 1`);
  return res.json(row || {});
});

router.get('/api/vast/:id', async (req, res) => {
  const ad = await queryOne('SELECT * FROM ads WHERE id = ?', [Number(req.params.id)]);
  if (!ad) return res.status(404).type('text/xml').send('<VAST version="3.0"/>');
  const skipAttr = ad.skipoffset ? ` skipoffset="${ad.skipoffset}"` : '';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="${ad.id}">
    <InLine>
      <AdSystem>EasyPlex</AdSystem>
      <AdTitle>${ad.title || 'EasyPlex Ad'}</AdTitle>
      <Creatives>
        <Creative>
          <Linear${skipAttr}>
            <Duration>${ad.duration || '00:00:15'}</Duration>
            <VideoClicks>
              <ClickThrough><![CDATA[${ad.clickThroughUrl || ''}]]></ClickThrough>
            </VideoClicks>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="1280" height="720"><![CDATA[${ad.link || ''}]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>`;
  return res.type('text/xml').send(xml);
});

router.get('/api/vmap/:id', async (req, res) => {
  const baseUrl = resolveRequestBaseUrl(req);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0">
  <vmap:AdBreak timeOffset="start" breakType="linear" breakId="preroll">
    <vmap:AdSource id="preroll-ad" allowMultipleAds="false" followRedirects="true">
      <vmap:AdTagURI templateType="vast3"><![CDATA[${baseUrl}/api/vast/${Number(req.params.id)}]]></vmap:AdTagURI>
    </vmap:AdSource>
  </vmap:AdBreak>
</vmap:VMAP>`;
  return res.type('text/xml').send(xml);
});

router.get(['/api/embeds/show/:embed', '/embeds/show/:embed'], async (req, res) => {
  const row = await queryOne('SELECT * FROM embeds WHERE id = ?', [Number(req.params.embed)]);
  if (!row) return res.status(404).json({ message: 'Embed not found' });

  const accept = String(req.headers.accept || '').toLowerCase();
  const wantsJson =
    String(req.query.format || '').toLowerCase() === 'json' ||
    (accept.includes('application/json') && !accept.includes('text/html'));

  if (wantsJson) {
    return res.json(row);
  }

  const safeUrl = String(row.url || '').replace(/"/g, '&quot;');
  const safeTitle = String(row.name || 'EasyPlex Embed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return res.type('text/html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;border:0;background:#000;overflow:hidden}</style>
</head>
<body>
  <iframe src="${safeUrl}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer-when-downgrade"></iframe>
</body>
</html>`);
});

export default router;
