import express from 'express';
import {
  castAsText,
  execute,
  hasColumn,
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
import {
  MEDIA_SCHEMAS,
  toBoolInt,
  syncParentRelations,
  syncLinks,
  hydrateMediaRecord,
  fetchTmdbMetadata,
  normalizeDateValue,
} from '../../services/mediaCatalog.js';
import { getTmdbConfig } from '../../services/tmdb.js';

const router = makeAsyncRouter(express.Router());
router.use('/admin', requireAdminOrModerator);

const uploadSerieImg = createDiskUpload('series', { preserveExtension: true });
const uploadAnimeImg = createDiskUpload('animes', { preserveExtension: true });
const uploadMangaImg = createDiskUpload('mangas', { preserveExtension: true });

async function upsertSeasonsAndEpisodes(
  cfg,
  parentId,
  seasonsPayload,
  { skipExistingSeasons = false, skipExistingEpisodes = false } = {}
) {
  if (!Array.isArray(seasonsPayload)) return { seasonsImported: 0, episodesImported: 0 };
  const now = nowIso();
  let seasonsImported = 0;
  let episodesImported = 0;

  for (const s of seasonsPayload) {
    if (!s) continue;
    const seasonNum = Number(s.season_number ?? 1);
    const sTmdbId = s.tmdb_id ? Number(s.tmdb_id) : null;
    const sAirDate = normalizeDateValue(s.air_date);

    let seasonRow = s.id && !s.episodes_from_tmdb
      ? await queryOne(`SELECT * FROM ${cfg.seasonTable} WHERE id = ? AND ${cfg.seasonFk} = ?`, [Number(s.id), parentId])
      : null;

    if (!seasonRow) {
      seasonRow = await queryOne(
        `SELECT * FROM ${cfg.seasonTable} WHERE ${cfg.seasonFk} = ? AND season_number = ?`,
        [parentId, seasonNum]
      );
    }

    if (!seasonRow && sTmdbId) {
      seasonRow = await queryOne(
        `SELECT * FROM ${cfg.seasonTable} WHERE ${cfg.seasonFk} = ? AND tmdb_id = ?`,
        [parentId, sTmdbId]
      );
    }

    // Avoid UNIQUE tmdb_id collision if another record holds this TMDB ID
    let safeSeasonTmdbId = sTmdbId;
    if (safeSeasonTmdbId && (!seasonRow || Number(seasonRow.tmdb_id) !== safeSeasonTmdbId)) {
      const dupSeason = await queryOne(`SELECT id FROM ${cfg.seasonTable} WHERE tmdb_id = ?`, [safeSeasonTmdbId]);
      if (dupSeason && (!seasonRow || Number(dupSeason.id) !== Number(seasonRow.id))) {
        safeSeasonTmdbId = null;
      }
    }

    if (seasonRow) {
      if (!skipExistingSeasons) {
        await execute(
          `UPDATE ${cfg.seasonTable} SET season_number = ?, name = ?, overview = ?, poster_path = ?, air_date = ?, tmdb_id = COALESCE(?, tmdb_id), updated_at = ? WHERE id = ?`,
          [
            seasonNum,
            s.name || seasonRow.name || `Season ${seasonNum}`,
            s.overview ?? seasonRow.overview,
            s.poster_path ?? seasonRow.poster_path,
            sAirDate ?? seasonRow.air_date,
            safeSeasonTmdbId,
            now,
            seasonRow.id,
          ]
        );
      }
    } else {
      const ins = await execute(
        `INSERT INTO ${cfg.seasonTable} (tmdb_id, ${cfg.seasonFk}, season_number, name, overview, poster_path, air_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          safeSeasonTmdbId,
          parentId,
          seasonNum,
          s.name || `Season ${seasonNum}`,
          s.overview || null,
          s.poster_path || null,
          sAirDate,
          now,
          now,
        ]
      );
      seasonRow = await queryOne(`SELECT * FROM ${cfg.seasonTable} WHERE id = ?`, [Number(ins.lastInsertRowid)]);
      seasonsImported += 1;
    }

    if (Array.isArray(s.episodes)) {
      for (const ep of s.episodes) {
        if (!ep) continue;
        const epNum = Number(ep.episode_number ?? 1);
        const epTmdbId = ep.tmdb_id ? Number(ep.tmdb_id) : null;
        const epAirDate = normalizeDateValue(ep.air_date);

        let epRow = ep.id && !ep.episodes_from_tmdb
          ? await queryOne(`SELECT * FROM ${cfg.episodeTable} WHERE id = ? AND ${cfg.episodeFk} = ?`, [Number(ep.id), seasonRow.id])
          : null;

        if (!epRow) {
          epRow = await queryOne(
            `SELECT * FROM ${cfg.episodeTable} WHERE ${cfg.episodeFk} = ? AND episode_number = ?`,
            [seasonRow.id, epNum]
          );
        }

        if (!epRow && epTmdbId) {
          epRow = await queryOne(
            `SELECT * FROM ${cfg.episodeTable} WHERE ${cfg.episodeFk} = ? AND tmdb_id = ?`,
            [seasonRow.id, epTmdbId]
          );
        }

        if (epRow) {
          if (skipExistingEpisodes) continue;
          await execute(
            `UPDATE ${cfg.episodeTable} SET episode_number = ?, name = ?, overview = ?, still_path = ?, still_path_tv = ?, vote_average = ?, vote_count = ?, air_date = ?, skiprecap_start_in = ?, hasrecap = ?, enable_stream = ?, enable_media_download = ?, enable_ads_unlock = ?, updated_at = ? WHERE id = ?`,
            [
              epNum,
              ep.name || epRow.name || `Episode ${epNum}`,
              ep.overview ?? epRow.overview,
              ep.still_path ?? epRow.still_path,
              ep.still_path_tv ?? ep.still_path ?? epRow.still_path_tv,
              Number(ep.vote_average ?? epRow.vote_average ?? 0),
              ep.vote_count != null ? Number(ep.vote_count) : epRow.vote_count,
              epAirDate ?? epRow.air_date,
              Number(ep.skiprecap_start_in ?? epRow.skiprecap_start_in ?? 0),
              toBoolInt(ep.hasrecap, epRow.hasrecap ?? 0),
              toBoolInt(ep.enable_stream, epRow.enable_stream ?? 1),
              toBoolInt(ep.enable_media_download, epRow.enable_media_download ?? 1),
              toBoolInt(ep.enable_ads_unlock, epRow.enable_ads_unlock ?? 0),
              now,
              epRow.id,
            ]
          );
        } else {
          let safeEpTmdbId = epTmdbId;
          if (safeEpTmdbId) {
            const dupEp = await queryOne(`SELECT id FROM ${cfg.episodeTable} WHERE tmdb_id = ?`, [safeEpTmdbId]);
            if (dupEp) safeEpTmdbId = null;
          }

          const epIns = await execute(
            `INSERT INTO ${cfg.episodeTable} (tmdb_id, ${cfg.episodeFk}, episode_number, name, overview, still_path, still_path_tv, vote_average, vote_count, views, air_date, skiprecap_start_in, hasrecap, enable_stream, enable_media_download, enable_ads_unlock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              safeEpTmdbId,
              seasonRow.id,
              epNum,
              ep.name || `Episode ${epNum}`,
              ep.overview || null,
              ep.still_path || null,
              ep.still_path_tv || ep.still_path || null,
              Number(ep.vote_average || 0),
              ep.vote_count != null ? Number(ep.vote_count) : 0,
              epAirDate,
              Number(ep.skiprecap_start_in || 0),
              toBoolInt(ep.hasrecap, 0),
              toBoolInt(ep.enable_stream, 1),
              toBoolInt(ep.enable_media_download, 1),
              toBoolInt(ep.enable_ads_unlock, 0),
              now,
              now,
            ]
          );
          epRow = await queryOne(`SELECT * FROM ${cfg.episodeTable} WHERE id = ?`, [Number(epIns.lastInsertRowid)]);
          episodesImported += 1;
        }

        const epVideos = ep.videos || ep.links;
        const epDownloads = ep.downloads || ep.linksDownloads;
        const epSubs = ep.substitles || ep.subtitles || ep.linksSubstitles;
        if (Array.isArray(epVideos)) await syncLinks(cfg, epRow.id, epVideos, 'video', Boolean(ep.id));
        if (Array.isArray(epDownloads)) await syncLinks(cfg, epRow.id, epDownloads, 'download', Boolean(ep.id));
        if (Array.isArray(epSubs)) await syncLinks(cfg, epRow.id, epSubs, 'subtitle', Boolean(ep.id));
      }
    }
  }

  return { seasonsImported, episodesImported };
}

async function syncParentEpisodeStats(kind, parentId) {
  const cfg = MEDIA_SCHEMAS[kind];
  const seasons = await queryAll(
    `SELECT id, season_number FROM ${cfg.seasonTable} WHERE ${cfg.seasonFk} = ? AND season_number > 0`,
    [parentId]
  );
  const seasonIds = seasons.map((s) => Number(s.id));
  let epCount = 0;
  let latestAirDate = null;
  let recentNewEpisodes = 0;

  if (seasonIds.length > 0) {
    const ph = seasonIds.map(() => '?').join(',');
    const agg = await queryOne(
      `SELECT COUNT(*) AS cnt, MAX(air_date) AS max_air FROM ${cfg.episodeTable} WHERE ${cfg.episodeFk} IN (${ph})`,
      seasonIds
    );
    epCount = Number(agg?.cnt || 0);
    latestAirDate = normalizeDateValue(agg?.max_air);

    if (latestAirDate) {
      const airMs = Date.parse(`${latestAirDate}T00:00:00Z`);
      const nowMs = Date.now();
      const diffDays = (nowMs - airMs) / 86400000;
      if (Number.isFinite(diffDays) && diffDays >= -1 && diffDays <= 45) {
        recentNewEpisodes = 1;
      }
    }
  }

  const hasCheckedAt = await hasColumn(cfg.table, 'tmdb_last_checked_at');
  const now = nowIso();
  if (hasCheckedAt) {
    await execute(
      `UPDATE ${cfg.table}
       SET number_of_seasons = COALESCE(NULLIF(?, 0), number_of_seasons),
           number_of_episodes = COALESCE(NULLIF(?, 0), number_of_episodes),
           last_air_date = COALESCE(?, last_air_date),
           newEpisodes = CASE WHEN ? = 1 THEN 1 ELSE newEpisodes END,
           tmdb_last_checked_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [seasons.length, epCount, latestAirDate, recentNewEpisodes, now, now, parentId]
    );
  } else {
    await execute(
      `UPDATE ${cfg.table}
       SET number_of_seasons = COALESCE(NULLIF(?, 0), number_of_seasons),
           number_of_episodes = COALESCE(NULLIF(?, 0), number_of_episodes),
           last_air_date = COALESCE(?, last_air_date),
           newEpisodes = CASE WHEN ? = 1 THEN 1 ELSE newEpisodes END,
           updated_at = ?
       WHERE id = ?`,
      [seasons.length, epCount, latestAirDate, recentNewEpisodes, now, parentId]
    );
  }
}

async function importSeasonsFromTmdb(
  cfg,
  kind,
  parentRow,
  { fetchEpisodes = true, skipExisting = true, seasonsFilter = [] } = {}
) {
  if (!parentRow?.tmdb_id) {
    throw new Error('This record does not have a TMDB ID configured.');
  }
  const tmdbData = await fetchTmdbMetadata(kind, Number(parentRow.tmdb_id), null, {
    includeEpisodes: fetchEpisodes,
    includeSpecials: false,
  });

  let seasons = Array.isArray(tmdbData?.seasons) ? tmdbData.seasons : [];
  if (Array.isArray(seasonsFilter) && seasonsFilter.length > 0) {
    const allowed = new Set(seasonsFilter.map((n) => Number(typeof n === 'object' ? n.season_number : n)));
    seasons = seasons.filter((s) => allowed.has(Number(s.season_number)));
  }

  const normalizedSeasons = seasons.map((s) => ({
    ...s,
    id: undefined,
    episodes_from_tmdb: true,
    tmdb_id: s.tmdb_id || s.id || null,
    episodes: Array.isArray(s.episodes)
      ? s.episodes.map((ep) => ({
          ...ep,
          id: undefined,
          episodes_from_tmdb: true,
          tmdb_id: ep.tmdb_id || ep.id || null,
        }))
      : [],
  }));

  const summary = await upsertSeasonsAndEpisodes(cfg, parentRow.id, normalizedSeasons, {
    skipExistingSeasons: false,
    skipExistingEpisodes: skipExisting,
  });
  await syncParentEpisodeStats(kind, parentRow.id);
  return summary;
}

function registerEpisodicMedia(kind, { plural, singular, perm, uploadMiddleware, imagePrefix, episodeVideoRoutePrefix }) {
  const cfg = MEDIA_SCHEMAS[kind];
  const base = `/admin/${plural}`;
  const singBase = `/admin/${singular}`;

  router.get(`${base}/data`, requirePermission(`${perm}.view`), async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || req.query.limit || 12)));
    const q = String(req.query.q || req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();

    const conditions = [];
    const params = [];
    if (q) {
      conditions.push(`(name LIKE ? OR original_name LIKE ? OR ${castAsText('tmdb_id')} LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status === 'active') conditions.push('active = 1');
    if (status === 'inactive') conditions.push('active = 0');
    if (status === 'premium') conditions.push('premuim = 1');
    if (status === 'featured') conditions.push('featured = 1');

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const paged = await paginateQuery({
      baseFrom: `FROM ${cfg.table}`,
      whereSql,
      params,
      orderBySql: 'id DESC',
      page,
      perPage,
      mapRow: (row) => hydrateMediaRecord(kind, row),
    });
    return res.json(paged);
  });

  router.get([`${base}/edit-data/:id`, `${base}/show/:id`], requirePermission(`${perm}.view`), async (req, res) => {
    const row = await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [Number(req.params.id)]);
    if (!row) return res.status(404).json({ message: `${singular} not found` });
    return res.json(await hydrateMediaRecord(kind, row));
  });

  router.post(`${base}/store`, requirePermission(`${perm}.create`), async (req, res) => {
    const s = req.body[singular] || req.body.serie || req.body.anime || req.body;
    const name = String(s.name || s.title || '').trim();
    if (!name) return res.status(422).json({ status: 422, message: 'Name is required.' });
    const tmdbId = s.tmdb_id ? Number(s.tmdb_id) : null;
    if (tmdbId && (await queryOne(`SELECT id FROM ${cfg.table} WHERE tmdb_id = ?`, [tmdbId]))) {
      return res.status(422).json({ status: 422, message: `TMDB ID ${tmdbId} already exists.` });
    }

    const created = await runInTransaction(async () => {
      const now = nowIso();
      const isAnimeCol = kind === 'anime' ? ', is_anime' : '';
      const ins = await execute(
        `INSERT INTO ${cfg.table} (
          tmdb_id, name, original_name, imdb_external_id, subtitle, overview,
          poster_path, backdrop_path, backdrop_path_tv, backgroundvideo, trailer_url, preview_path,
          views, vote_average, vote_count, popularity, featured, pinned, newEpisodes,
          number_of_seasons, number_of_episodes, premuim, active, first_air_date, last_air_date${isAnimeCol},
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${kind === 'anime' ? ', ?' : ''}, ?, ?)`,
        [
          tmdbId,
          name,
          s.original_name || name,
          s.imdb_external_id || '',
          s.subtitle || null,
          s.overview || null,
          s.poster_path || null,
          s.backdrop_path || null,
          s.backdrop_path_tv || s.backdrop_path || null,
          s.backgroundvideo || null,
          s.trailer_url || null,
          s.preview_path || null,
          Number(s.views || 0),
          Number(s.vote_average || 0),
          Number(s.vote_count || 0),
          Number(s.popularity || 0),
          toBoolInt(s.featured, 0),
          toBoolInt(s.pinned, 0),
          toBoolInt(s.newEpisodes, 0),
          s.number_of_seasons != null ? Number(s.number_of_seasons) : null,
          s.number_of_episodes != null ? Number(s.number_of_episodes) : null,
          toBoolInt(s.premuim !== undefined ? s.premuim : s.premium, 0),
          s.active !== undefined ? toBoolInt(s.active, 1) : 1,
          normalizeDateValue(s.first_air_date),
          normalizeDateValue(s.last_air_date),
          ...(kind === 'anime' ? [toBoolInt(s.is_anime, 1)] : []),
          now,
          now,
        ]
      );
      const id = Number(ins.lastInsertRowid);
      await syncParentRelations(kind, id, s, false);
      const incomingSeasons = s.seasons || req.body.seasons;
      await upsertSeasonsAndEpisodes(cfg, id, incomingSeasons);
      await syncParentEpisodeStats(kind, id);
      if (req.body.notification) {
        await execute(
          `INSERT INTO notification_logs (provider, title, message, type, tmdb, image, status, created_by, created_at) VALUES ('local', ?, ?, ?, ?, ?, 'sent', ?, ?)`,
          [name, s.overview || `New ${singular} added`, kind, String(tmdbId || id), s.poster_path || null, req.user?.id || null, now]
        );
      }
      return queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
    });

    const hasIncomingEpisodes =
      Array.isArray(s.seasons || req.body.seasons) &&
      (s.seasons || req.body.seasons).some((sn) => Array.isArray(sn?.episodes) && sn.episodes.length > 0);
    if (created?.tmdb_id && !hasIncomingEpisodes && req.body.auto_import_seasons !== false) {
      try {
        const tmdbCfg = await getTmdbConfig();
        if (tmdbCfg.configured) {
          await importSeasonsFromTmdb(cfg, kind, created, { fetchEpisodes: true, skipExisting: true });
        }
      } catch {
        // Non-fatal if TMDB lookup fails after record creation
      }
    }

    const hydratedCreated = await hydrateMediaRecord(kind, await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [created.id]));
    return res.json({ status: 200, message: 'created successfully', body: 'Success', [singular]: hydratedCreated });
  });

  router.put(`${base}/update/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    const id = Number(req.params.id);
    const existing = await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ status: 404, message: `${singular} not found` });

    const s = req.body[singular] || req.body.serie || req.body.anime || req.body;
    const updated = await runInTransaction(async () => {
      const now = nowIso();
      await execute(
        `UPDATE ${cfg.table} SET
          tmdb_id = ?, name = ?, original_name = ?, imdb_external_id = ?, subtitle = ?, overview = ?,
          poster_path = ?, backdrop_path = ?, backdrop_path_tv = ?, backgroundvideo = ?, trailer_url = ?, preview_path = ?,
          vote_average = ?, vote_count = ?, popularity = ?, featured = ?, pinned = ?, newEpisodes = ?,
          number_of_seasons = ?, number_of_episodes = ?, premuim = ?, active = ?, first_air_date = ?, last_air_date = ?,
          updated_at = ?
         WHERE id = ?`,
        [
          s.tmdb_id !== undefined ? (s.tmdb_id ? Number(s.tmdb_id) : null) : existing.tmdb_id,
          s.name || s.title || existing.name,
          s.original_name ?? existing.original_name,
          s.imdb_external_id ?? existing.imdb_external_id,
          s.subtitle ?? existing.subtitle,
          s.overview ?? existing.overview,
          s.poster_path ?? existing.poster_path,
          s.backdrop_path ?? existing.backdrop_path,
          s.backdrop_path_tv ?? existing.backdrop_path_tv,
          s.backgroundvideo ?? existing.backgroundvideo,
          s.trailer_url ?? existing.trailer_url,
          s.preview_path ?? existing.preview_path,
          s.vote_average ?? existing.vote_average,
          s.vote_count ?? existing.vote_count,
          s.popularity ?? existing.popularity,
          s.featured !== undefined ? toBoolInt(s.featured, existing.featured) : existing.featured,
          s.pinned !== undefined ? toBoolInt(s.pinned, existing.pinned) : existing.pinned,
          s.newEpisodes !== undefined ? toBoolInt(s.newEpisodes, existing.newEpisodes) : existing.newEpisodes,
          s.number_of_seasons ?? existing.number_of_seasons,
          s.number_of_episodes ?? existing.number_of_episodes,
          s.premuim !== undefined || s.premium !== undefined ? toBoolInt(s.premuim ?? s.premium, existing.premuim) : existing.premuim,
          s.active !== undefined ? toBoolInt(s.active, existing.active) : existing.active,
          s.first_air_date !== undefined ? normalizeDateValue(s.first_air_date) : existing.first_air_date,
          s.last_air_date !== undefined ? normalizeDateValue(s.last_air_date) : existing.last_air_date,
          now,
          id,
        ]
      );
      await syncParentRelations(kind, id, s, Boolean(req.body.replace_relations));
      if (Array.isArray(s.seasons) || Array.isArray(req.body.seasons)) {
        await upsertSeasonsAndEpisodes(cfg, id, s.seasons || req.body.seasons);
        await syncParentEpisodeStats(kind, id);
      }
      return hydrateMediaRecord(kind, await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]));
    });

    return res.json({ status: 200, message: 'successfully updated', body: 'Success', [singular]: updated });
  });

  router.delete(`${base}/destroy/:id`, requirePermission(`${perm}.delete`), async (req, res) => {
    const id = Number(req.params.id);
    if (!(await queryOne(`SELECT id FROM ${cfg.table} WHERE id = ?`, [id]))) {
      return res.status(404).json({ status: 404, message: `${singular} not found` });
    }
    await execute(`DELETE FROM ${cfg.table} WHERE id = ?`, [id]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.post(`${base}/image/store`, requirePermission(`${perm}.edit`), uploadMiddleware.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ status: 400, message: 'Image file is required' });
    return res.json({
      status: 200,
      image_path: publicStorageUrl(req, imagePrefix, req.file.filename),
      filename: req.file.filename,
    });
  });

  // Direct Season & Episode CRUD helpers for React panel
  router.post(`${base}/:id/seasons`, requirePermission(`${perm}.edit`), async (req, res) => {
    const parentId = Number(req.params.id);
    if (!(await queryOne(`SELECT id FROM ${cfg.table} WHERE id = ?`, [parentId]))) {
      return res.status(404).json({ message: `${singular} not found` });
    }
    await upsertSeasonsAndEpisodes(cfg, parentId, [req.body]);
    return res.json({
      status: 200,
      data: await hydrateMediaRecord(kind, await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [parentId])),
    });
  });

  router.post(`${base}/seasons/:seasonId/episodes`, requirePermission(`${perm}.edit`), async (req, res) => {
    const seasonId = Number(req.params.seasonId);
    const season = await queryOne(`SELECT * FROM ${cfg.seasonTable} WHERE id = ?`, [seasonId]);
    if (!season) return res.status(404).json({ message: 'Season not found' });
    const now = nowIso();
    const ep = req.body;
    const ins = await execute(
      `INSERT INTO ${cfg.episodeTable} (tmdb_id, ${cfg.episodeFk}, episode_number, name, overview, still_path, still_path_tv, air_date, enable_stream, enable_media_download, enable_ads_unlock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ep.tmdb_id ? Number(ep.tmdb_id) : null,
        seasonId,
        Number(ep.episode_number || 1),
        ep.name || `Episode ${ep.episode_number || 1}`,
        ep.overview || null,
        ep.still_path || null,
        ep.still_path_tv || ep.still_path || null,
        ep.air_date || null,
        toBoolInt(ep.enable_stream, 1),
        toBoolInt(ep.enable_media_download, 1),
        toBoolInt(ep.enable_ads_unlock, 0),
        now,
        now,
      ]
    );
    const epId = Number(ins.lastInsertRowid);
    if (Array.isArray(ep.videos || ep.links)) await syncLinks(cfg, epId, ep.videos || ep.links, 'video', false);
    if (Array.isArray(ep.downloads || ep.linksDownloads)) await syncLinks(cfg, epId, ep.downloads || ep.linksDownloads, 'download', false);
    if (Array.isArray(ep.substitles || ep.subtitles)) await syncLinks(cfg, epId, ep.substitles || ep.subtitles, 'subtitle', false);
    return res.json({ status: 200, episode_id: epId });
  });

  router.put(`${base}/episodes/:episodeId`, requirePermission(`${perm}.edit`), async (req, res) => {
    const epId = Number(req.params.episodeId);
    const existing = await queryOne(`SELECT * FROM ${cfg.episodeTable} WHERE id = ?`, [epId]);
    if (!existing) return res.status(404).json({ message: 'Episode not found' });
    const ep = req.body;
    const now = nowIso();
    await execute(
      `UPDATE ${cfg.episodeTable} SET episode_number = ?, name = ?, overview = ?, still_path = ?, still_path_tv = ?, air_date = ?, skiprecap_start_in = ?, hasrecap = ?, enable_stream = ?, enable_media_download = ?, enable_ads_unlock = ?, updated_at = ? WHERE id = ?`,
      [
        Number(ep.episode_number ?? existing.episode_number),
        ep.name ?? existing.name,
        ep.overview ?? existing.overview,
        ep.still_path ?? existing.still_path,
        ep.still_path_tv ?? existing.still_path_tv,
        ep.air_date ?? existing.air_date,
        Number(ep.skiprecap_start_in ?? existing.skiprecap_start_in ?? 0),
        toBoolInt(ep.hasrecap, existing.hasrecap ?? 0),
        toBoolInt(ep.enable_stream, existing.enable_stream ?? 1),
        toBoolInt(ep.enable_media_download, existing.enable_media_download ?? 1),
        toBoolInt(ep.enable_ads_unlock, existing.enable_ads_unlock ?? 0),
        now,
        epId,
      ]
    );
    if (Array.isArray(ep.videos || ep.links)) await syncLinks(cfg, epId, ep.videos || ep.links, 'video', true);
    if (Array.isArray(ep.downloads || ep.linksDownloads)) await syncLinks(cfg, epId, ep.downloads || ep.linksDownloads, 'download', true);
    if (Array.isArray(ep.substitles || ep.subtitles)) await syncLinks(cfg, epId, ep.substitles || ep.subtitles, 'subtitle', true);
    return res.json({ status: 200, message: 'Episode updated' });
  });

  // Destroy child items matching web.php routes
  router.delete(`${base}/seasons/destroy/:season`, requirePermission(`${perm}.delete`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.seasonTable} WHERE id = ?`, [Number(req.params.season)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.delete(`${base}/episodes/destroy/:episode`, requirePermission(`${perm}.delete`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.episodeTable} WHERE id = ?`, [Number(req.params.episode)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.delete(`${base}/videos/destroy/:videoId`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.videoTable} WHERE id = ?`, [Number(req.params.videoId)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.delete(`${base}/downloads/destroy/:downloadId`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.downloadTable} WHERE id = ?`, [Number(req.params.downloadId)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.delete(`${base}/substitles/destroy/:subId`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.subtitleTable} WHERE id = ?`, [Number(req.params.subId)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.put(`/admin/${episodeVideoRoutePrefix}/:episodeId/video-link`, requirePermission(`${perm}.edit`), async (req, res) => {
    const epId = Number(req.params.episodeId);
    const links = Array.isArray(req.body.links) ? req.body.links : req.body.video ? [req.body.video] : [req.body];
    await syncLinks(cfg, epId, links, 'video', Boolean(req.body.replace));
    return res.json({ status: 200, message: 'Episode video links updated' });
  });

  router.put(`/admin/${episodeVideoRoutePrefix}/:episodeId/videos/reorder`, requirePermission(`${perm}.edit`), async (req, res) => {
    const epId = Number(req.params.episodeId);
    const order = Array.isArray(req.body.order) ? req.body.order : Array.isArray(req.body.ids) ? req.body.ids : [];
    await runInTransaction(async () => {
      for (let idx = 0; idx < order.length; idx++) {
        const item = order[idx];
        const vidId = typeof item === 'object' ? Number(item.id) : Number(item);
        await execute(
          `UPDATE ${cfg.videoTable} SET position = ?, sort_order = ?, updated_at = ? WHERE id = ? AND ${cfg.videoFk} = ?`,
          [idx + 1, idx + 1, nowIso(), vidId, epId]
        );
      }
    });
    return res.json({ status: 200, message: 'Reordered' });
  });

  // Relation delete routes
  router.delete(`${base}/genres/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.genreTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });
  router.delete(`${base}/casts/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.castTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });
  router.delete(`${base}/networks/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.networkTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });
  router.delete(`${singBase}/collection/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.collectionTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });
  router.delete(`${singBase}/certification/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.certTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });
  router.delete(`${base}/languages/destroy/:id`, requirePermission(`${perm}.edit`), async (req, res) => {
    await execute(`DELETE FROM ${cfg.langTable} WHERE id = ?`, [Number(req.params.id)]);
    return res.json({ status: 200, message: 'successfully deleted' });
  });

  router.post(`${base}/:id/import-seasons`, requirePermission(`${perm}.edit`), async (req, res) => {
    const parentId = Number(req.params.id);
    const parentRow = await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [parentId]);
    if (!parentRow) return res.status(404).json({ status: 404, message: `${singular} not found` });
    if (!parentRow.tmdb_id) {
      return res.status(422).json({ status: 422, message: `This ${singular} does not have a TMDB ID configured.` });
    }
    try {
      const fetchEpisodes = req.body.fetch_episodes !== false;
      const skipExisting = req.body.skip_existing !== false;
      const seasonsFilter = Array.isArray(req.body.seasons) ? req.body.seasons : [];
      const summary = await importSeasonsFromTmdb(cfg, kind, parentRow, {
        fetchEpisodes,
        skipExisting,
        seasonsFilter,
      });
      const updated = await hydrateMediaRecord(kind, await queryOne(`SELECT * FROM ${cfg.table} WHERE id = ?`, [parentId]));
      return res.json({
        status: 200,
        message: `Imported ${summary.seasonsImported} season(s) and ${summary.episodesImported} episode(s) from TMDB.`,
        summary: {
          imported_seasons: summary.seasonsImported,
          imported_episodes: summary.episodesImported,
        },
        data: updated,
      });
    } catch (err) {
      return res.status(422).json({ status: 422, message: err.message || 'TMDB import failed.' });
    }
  });

  // TMDB bulk import/update/stats
  router.get(`${base}/check-exists/:tmdbId`, requirePermission(`${perm}.view`), async (req, res) => {
    const row = await queryOne(`SELECT id, name FROM ${cfg.table} WHERE tmdb_id = ?`, [Number(req.params.tmdbId)]);
    return res.json({ exists: Boolean(row), item: row || null });
  });

  router.post(`${base}/validate-tmdb`, requirePermission(`${perm}.view`), async (req, res) => {
    const tmdbIds = Array.isArray(req.body.tmdb_ids) ? req.body.tmdb_ids.map(Number) : [];
    if (!tmdbIds.length) return res.json({ existing: [], new: [] });
    const rows = await queryAll(
      `SELECT tmdb_id FROM ${cfg.table} WHERE tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`,
      tmdbIds
    );
    const existingSet = new Set(rows.map((r) => Number(r.tmdb_id)));
    return res.json({
      existing: tmdbIds.filter((id) => existingSet.has(id)),
      new: tmdbIds.filter((id) => !existingSet.has(id)),
    });
  });

  router.post(`${base}/bulk-import`, requirePermission(`${perm}.create`), async (req, res) => {
    const items = Array.isArray(req.body[plural])
      ? req.body[plural]
      : Array.isArray(req.body.series)
      ? req.body.series
      : Array.isArray(req.body.items)
      ? req.body.items
      : [];
    const options = req.body.options || {};
    const skipExisting = options.skip_existing !== false;
    const autoActivate = options.auto_activate !== false;
    let imported = 0;
    let skipped = 0;
    let errorsCount = 0;
    const errors = [];
    const createdNeedTmdbSeasons = [];

    await runInTransaction(async () => {
      const now = nowIso();
      for (const item of items) {
        try {
          const tmdbId = item.tmdb_id ? Number(item.tmdb_id) : null;
          if (skipExisting && tmdbId && (await queryOne(`SELECT id FROM ${cfg.table} WHERE tmdb_id = ?`, [tmdbId]))) {
            skipped += 1;
            continue;
          }
          const name = String(item.name || item.original_name || `${singular} #${tmdbId || Date.now()}`).trim();
          const isAnimeCol = kind === 'anime' ? ', is_anime' : '';
          const ins = await execute(
            `INSERT INTO ${cfg.table} (tmdb_id, name, original_name, imdb_external_id, overview, poster_path, backdrop_path, backdrop_path_tv, vote_average, vote_count, popularity, first_air_date, active${isAnimeCol}, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?${kind === 'anime' ? ', 1' : ''}, ?, ?)`,
            [
              tmdbId,
              name,
              item.original_name || name,
              item.overview || null,
              item.poster_path || null,
              item.backdrop_path || null,
              item.backdrop_path || null,
              Number(item.vote_average || 0),
              Number(item.vote_count || 0),
              Number(item.popularity || 0),
              normalizeDateValue(item.first_air_date),
              autoActivate ? 1 : 0,
              now,
              now,
            ]
          );
          const id = Number(ins.lastInsertRowid);
          await syncParentRelations(kind, id, item, false);
          const hasInlineEpisodes =
            Array.isArray(item.seasons) &&
            item.seasons.some((sn) => Array.isArray(sn?.episodes) && sn.episodes.length > 0);
          if (Array.isArray(item.seasons)) {
            await upsertSeasonsAndEpisodes(cfg, id, item.seasons);
          }
          await syncParentEpisodeStats(kind, id);
          if (tmdbId && !hasInlineEpisodes && options.fetch_episodes !== false) {
            createdNeedTmdbSeasons.push({ id, tmdb_id: tmdbId });
          }
          imported += 1;
        } catch (err) {
          errorsCount += 1;
          errors.push({ tmdb_id: item.tmdb_id, error: err.message });
        }
      }
    });

    if (createdNeedTmdbSeasons.length > 0) {
      try {
        const tmdbCfg = await getTmdbConfig();
        if (tmdbCfg.configured) {
          for (const createdItem of createdNeedTmdbSeasons) {
            try {
              await importSeasonsFromTmdb(cfg, kind, createdItem, {
                fetchEpisodes: true,
                skipExisting: true,
              });
            } catch {
              // Skip individual TMDB fetch errors
            }
          }
        }
      } catch {
        // Ignore TMDB config lookup errors
      }
    }

    return res.json({
      status: 200,
      message: 'Bulk import completed',
      summary: { imported, skipped, errors: errorsCount, total: items.length },
      errors,
    });
  });

  router.get(`${base}/bulk-update-items`, requirePermission(`${perm}.view`), async (_req, res) => {
    const items = await queryAll(
      `SELECT id, tmdb_id, name FROM ${cfg.table} WHERE tmdb_id IS NOT NULL AND ${castAsText('tmdb_id')} <> '' ORDER BY id ASC`
    );
    return res.json({ status: 200, items });
  });

  router.post(`${base}/bulk-update`, requirePermission(`${perm}.edit`), async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
    const items = ids.length
      ? await queryAll(`SELECT * FROM ${cfg.table} WHERE id IN (${ids.map(() => '?').join(',')}) AND tmdb_id IS NOT NULL`, ids)
      : await queryAll(`SELECT * FROM ${cfg.table} WHERE tmdb_id IS NOT NULL LIMIT 30`);

    const fetchEpisodes = req.body.fetch_episodes !== false;
    let updated = 0;
    const errors = [];
    for (const row of items) {
      try {
        const tmdb = await fetchTmdbMetadata(kind, row.tmdb_id, null, { includeEpisodes: fetchEpisodes });
        await execute(
          `UPDATE ${cfg.table} SET name = ?, overview = ?, poster_path = COALESCE(?, poster_path), backdrop_path = COALESCE(?, backdrop_path), vote_average = ?, popularity = ?, number_of_seasons = COALESCE(?, number_of_seasons), number_of_episodes = COALESCE(?, number_of_episodes), last_air_date = COALESCE(?, last_air_date), updated_at = ? WHERE id = ?`,
          [
            tmdb.name || row.name,
            tmdb.overview ?? row.overview,
            tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : null,
            tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : null,
            tmdb.vote_average ?? row.vote_average,
            tmdb.popularity ?? row.popularity,
            tmdb.number_of_seasons ?? row.number_of_seasons,
            tmdb.number_of_episodes ?? row.number_of_episodes,
            normalizeDateValue(tmdb.last_air_date),
            nowIso(),
            row.id,
          ]
        );
        if (fetchEpisodes && Array.isArray(tmdb.seasons)) {
          await upsertSeasonsAndEpisodes(
            cfg,
            row.id,
            tmdb.seasons.map((s) => ({
              ...s,
              id: undefined,
              episodes_from_tmdb: true,
              tmdb_id: s.tmdb_id || s.id || null,
              episodes: (s.episodes || []).map((ep) => ({
                ...ep,
                id: undefined,
                episodes_from_tmdb: true,
                tmdb_id: ep.tmdb_id || ep.id || null,
              })),
            })),
            { skipExistingEpisodes: req.body.skip_existing !== false }
          );
        }
        await syncParentEpisodeStats(kind, row.id);
        updated += 1;
      } catch (err) {
        errors.push({ id: row.id, tmdb_id: row.tmdb_id, error: err.message });
      }
    }
    return res.json({ status: 200, message: `Updated ${updated} record(s)`, updated, errors });
  });

  router.get(`${base}/import-stats`, requirePermission(`${perm}.view`), async (_req, res) => {
    const [totalRow, withTmdbRow, activeRow] = await Promise.all([
      queryOne(`SELECT COUNT(*) AS count FROM ${cfg.table}`),
      queryOne(`SELECT COUNT(*) AS count FROM ${cfg.table} WHERE tmdb_id IS NOT NULL`),
      queryOne(`SELECT COUNT(*) AS count FROM ${cfg.table} WHERE active = 1`),
    ]);
    const total = Number(totalRow?.count || 0);
    const withTmdb = Number(withTmdbRow?.count || 0);
    const active = Number(activeRow?.count || 0);
    return res.json({ total, with_tmdb: withTmdb, active, without_tmdb: total - withTmdb });
  });
}

registerEpisodicMedia('serie', {
  plural: 'series',
  singular: 'serie',
  perm: 'series',
  uploadMiddleware: uploadSerieImg,
  imagePrefix: '/api/series/image/',
  episodeVideoRoutePrefix: 'episodes',
});

registerEpisodicMedia('anime', {
  plural: 'animes',
  singular: 'anime',
  perm: 'anime',
  uploadMiddleware: uploadAnimeImg,
  imagePrefix: '/api/animes/image/',
  episodeVideoRoutePrefix: 'animes',
});

// Direct episode video store routes matching web.php
router.post('/admin/video/store', requirePermission('series.edit'), async (req, res) => {
  const isAnime = Boolean(req.body.is_anime);
  const cfg = isAnime ? MEDIA_SCHEMAS.anime : MEDIA_SCHEMAS.serie;
  const episodeId = Number(req.body.episode_id || req.body.anime_episode_id || 0);
  if (!episodeId) return res.status(422).json({ status: 422, message: 'episode_id is required' });
  const links = Array.isArray(req.body.links) ? req.body.links : [req.body];
  await syncLinks(cfg, episodeId, links, 'video', false);
  return res.json({ status: 200, message: 'created successfully' });
});

router.post('/admin/video/anime/store', requirePermission('anime.edit'), async (req, res) => {
  const episodeId = Number(req.body.episode_id || req.body.anime_episode_id || 0);
  if (!episodeId) return res.status(422).json({ status: 422, message: 'episode_id is required' });
  const links = Array.isArray(req.body.links) ? req.body.links : [req.body];
  await syncLinks(MEDIA_SCHEMAS.anime, episodeId, links, 'video', false);
  return res.json({ status: 200, message: 'created successfully' });
});

// Mangas CRUD (shares movies permission module in EasyPlex 2.4 DB)
router.get('/admin/mangas/data', requirePermission('movies.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page || 12)));
  const q = String(req.query.q || req.query.search || '').trim();
  const whereSql = q ? 'WHERE name LIKE ? OR original_name LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM mangas',
      whereSql,
      params,
      orderBySql: 'id DESC',
      page,
      perPage,
    })
  );
});

router.post('/admin/mangas/store', requirePermission('movies.create'), async (req, res) => {
  const m = req.body.manga || req.body;
  const name = String(m.name || m.title || '').trim();
  if (!name) return res.status(422).json({ status: 422, message: 'Manga name is required' });
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO mangas (tmdb_id, name, original_name, imdb_external_id, overview, subtitle, poster_path, backdrop_path_tv, backdrop_path, preview_path, trailer_url, views, vote_average, vote_count, popularity, active, premuim, pinned, newEpisodes, featured, first_air_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.tmdb_id ? Number(m.tmdb_id) : null,
      name,
      m.original_name || name,
      m.imdb_external_id || '',
      m.overview || null,
      m.subtitle || null,
      m.poster_path || null,
      m.backdrop_path_tv || m.backdrop_path || null,
      m.backdrop_path || null,
      m.preview_path || null,
      m.trailer_url || null,
      Number(m.views || 0),
      Number(m.vote_average || 0),
      Number(m.vote_count || 0),
      Number(m.popularity || 0),
      toBoolInt(m.active, 1),
      toBoolInt(m.premuim ?? m.premium, 0),
      toBoolInt(m.pinned, 0),
      toBoolInt(m.newEpisodes, 0),
      toBoolInt(m.featured, 0),
      m.first_air_date || null,
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'created successfully',
    manga: await queryOne('SELECT * FROM mangas WHERE id = ?', [Number(ins.lastInsertRowid)]),
  });
});

router.put('/admin/mangas/update/:manga', requirePermission('movies.edit'), async (req, res) => {
  const id = Number(req.params.manga);
  const existing = await queryOne('SELECT * FROM mangas WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Manga not found' });
  const m = req.body.manga || req.body;
  await execute(
    `UPDATE mangas SET tmdb_id = ?, name = ?, original_name = ?, imdb_external_id = ?, overview = ?, subtitle = ?, poster_path = ?, backdrop_path_tv = ?, backdrop_path = ?, preview_path = ?, trailer_url = ?, vote_average = ?, active = ?, premuim = ?, pinned = ?, newEpisodes = ?, featured = ?, first_air_date = ?, updated_at = ? WHERE id = ?`,
    [
      m.tmdb_id !== undefined ? (m.tmdb_id ? Number(m.tmdb_id) : null) : existing.tmdb_id,
      m.name || m.title || existing.name,
      m.original_name ?? existing.original_name,
      m.imdb_external_id ?? existing.imdb_external_id,
      m.overview ?? existing.overview,
      m.subtitle ?? existing.subtitle,
      m.poster_path ?? existing.poster_path,
      m.backdrop_path_tv ?? existing.backdrop_path_tv,
      m.backdrop_path ?? existing.backdrop_path,
      m.preview_path ?? existing.preview_path,
      m.trailer_url ?? existing.trailer_url,
      m.vote_average ?? existing.vote_average,
      m.active !== undefined ? toBoolInt(m.active, existing.active) : existing.active,
      m.premuim !== undefined || m.premium !== undefined ? toBoolInt(m.premuim ?? m.premium, existing.premuim) : existing.premuim,
      m.pinned !== undefined ? toBoolInt(m.pinned, existing.pinned) : existing.pinned,
      m.newEpisodes !== undefined ? toBoolInt(m.newEpisodes, existing.newEpisodes) : existing.newEpisodes,
      m.featured !== undefined ? toBoolInt(m.featured, existing.featured) : existing.featured,
      m.first_air_date ?? existing.first_air_date,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    manga: await queryOne('SELECT * FROM mangas WHERE id = ?', [id]),
  });
});

router.delete('/admin/mangas/destroy/:manga', requirePermission('movies.delete'), async (req, res) => {
  await execute('DELETE FROM mangas WHERE id = ?', [Number(req.params.manga)]);
  return res.json({ status: 200, message: 'successfully deleted' });
});

router.post('/admin/mangas/image/store', requirePermission('movies.edit'), uploadMangaImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'Image file is required' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/mangas/image/', req.file.filename),
    filename: req.file.filename,
  });
});

export default router;
