import express from 'express';
import {
  execute,
  isMySql,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/mysql.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  createDiskUpload,
  publicStorageUrl,
} from '../../middleware/upload.js';
import {
  addCredits,
  creditsSystemEnabled,
  findContentRecord,
  getCreditStatus,
  getOrCreateUserCredit,
  normalizeContentType,
  spendCreditsForUnlock,
} from '../../services/credits.js';
import {
  activateSubscriptionForUser,
  buildUserAccessState,
  formatSubscriptionForApi,
  serializePlan,
} from '../../services/subscriptions.js';
import {
  attachDownloads,
  attachServers,
  buildDeliveryUrl,
  resolveRequestBaseUrl,
  serializeDownloadRow,
  serializeServerRow,
} from '../../services/playback.js';
import { hydrateMediaRecord } from '../../services/mediaCatalog.js';
import { randomCode } from '../../services/crypto.js';

const router = makeAsyncRouter(express.Router());
const uploadProof = createDiskUpload('offline_payments', { preserveExtension: true });

async function getSettingsRow() {
  return (await queryOne('SELECT * FROM settings ORDER BY id ASC LIMIT 1')) || {};
}

function parsePage(req) {
  return Math.max(1, Number(req.query.page || 1));
}

function parsePerPage(req, fallback = 15) {
  return Math.min(100, Math.max(1, Number(req.query.per_page || req.query.limit || fallback)));
}

function normalizeMediaKind(raw = 'movie') {
  const s = String(raw || 'movie').trim().toLowerCase();
  if (s === 'serie' || s === 'series' || s === 'episode' || s === 'series_episode' || s === 'serie_episode' || s.endsWith('\\serie')) {
    return 'serie';
  }
  if (s === 'anime' || s === 'animes' || s === 'anime_episode' || s.endsWith('\\anime')) {
    return 'anime';
  }
  if (s === 'livetv' || s === 'live_tv' || s === 'streaming' || s.endsWith('\\livetv')) {
    return 'livetv';
  }
  return 'movie';
}

function serializeMovieRequest(r, settings = null, req = null) {
  if (!r) return null;
  const baseUrl = resolveRequestBaseUrl(req);
  let tmdbPayload = r.tmdb_payload || null;
  if (typeof tmdbPayload === 'string' && tmdbPayload.trim().startsWith('{')) {
    try {
      tmdbPayload = JSON.parse(tmdbPayload);
    } catch {
      // keep raw
    }
  }
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    movie_imdb_id: r.movie_imdb_id || null,
    tmdb_id: r.tmdb_id ? Number(r.tmdb_id) : null,
    type: r.type || 'movie',
    status: r.status || 'pending',
    request_title: r.request_title || null,
    poster_path: buildDeliveryUrl(r.poster_path, settings, { fallback: r.poster_path || null, baseUrl }),
    backdrop_path: buildDeliveryUrl(r.backdrop_path, settings, { fallback: r.backdrop_path || null, baseUrl }),
    release_date: r.release_date || null,
    vote_average: r.vote_average !== null && r.vote_average !== undefined ? Number(r.vote_average) : null,
    tmdb_payload: tmdbPayload,
    user_notes: r.user_notes || null,
    admin_notes: r.admin_notes || null,
    requested_at: r.requested_at || r.created_at || null,
    processed_at: r.processed_at || null,
    processed_by: r.processed_by ? Number(r.processed_by) : null,
    created_media_id: r.created_media_id ? Number(r.created_media_id) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function resolveCreditTargetForServer(type, row) {
  if (type === 'serie' || type === 'episode' || type === 'series_episode') {
    return { creditType: 'series_episode', creditId: Number(row.episode_id || row.id) };
  }
  if (type === 'anime' || type === 'anime_episode') {
    return { creditType: 'anime_episode', creditId: Number(row.anime_episode_id || row.id) };
  }
  if (type === 'livetv' || type === 'live_tv') {
    return { creditType: 'live_tv', creditId: Number(row.livetv_id || row.id) };
  }
  return { creditType: 'movie', creditId: Number(row.movie_id || row.id) };
}

// ================= STREAMING & DOWNLOAD SERVERS =================
router.get('/api/streaming-servers/:type/:server', async (req, res) => {
  const type = String(req.params.type || 'movie').toLowerCase();
  const id = Number(req.params.server);
  const table =
    type === 'serie' || type === 'episode'
      ? 'serie_videos'
      : type === 'anime' || type === 'anime_episode'
      ? 'anime_videos'
      : type === 'livetv'
      ? 'livetv_videos'
      : 'movie_videos';

  const [row, settings] = await Promise.all([queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id]), getSettingsRow()]);
  if (!row) return res.status(404).json({ message: 'Server link not found' });

  const { creditType, creditId } = await resolveCreditTargetForServer(type, row);
  const creditStatus = ['movie', 'series_episode', 'anime_episode', 'live_tv'].includes(creditType)
    ? await getCreditStatus({ user: req.user, contentType: creditType, contentId: creditId })
    : { credits_system_enabled: false, is_credit_enabled: false, credits_required: 0, already_unlocked: true, user_balance: 0 };

  const serialized = serializeServerRow(row, {
    kind: type,
    user: req.user,
    creditStatus,
    settings,
    baseUrl: resolveRequestBaseUrl(req),
  });

  if (serialized.premium_required) {
    return res.status(403).json({
      premium_required: true,
      requires_premium: true,
      credit_required: serialized.credit_required,
      message: 'Premium subscription required for this server.',
      server: serialized,
    });
  }

  if (serialized.credit_required > 0) {
    return res.status(402).json({
      premium_required: false,
      credit_required: serialized.credit_required,
      credits_required: serialized.credit_required,
      credit_balance: serialized.credit_balance,
      message: `Requires ${serialized.credit_required} credits to unlock.`,
      server: serialized,
    });
  }

  return res.json({
    ...serialized,
    premium_required: false,
    credit_required: 0,
    server: serialized,
  });
});

router.get('/api/download-servers/:type/:server', async (req, res) => {
  const type = String(req.params.type || 'movie').toLowerCase();
  const id = Number(req.params.server);
  const table =
    type === 'serie' || type === 'episode'
      ? 'serie_downloads'
      : type === 'anime' || type === 'anime_episode'
      ? 'anime_downloads'
      : 'movie_downloads';

  const [row, settings] = await Promise.all([queryOne(`SELECT * FROM ${table} WHERE id = ?`, [id]), getSettingsRow()]);
  if (!row) return res.status(404).json({ message: 'Download link not found' });

  const { creditType, creditId } = await resolveCreditTargetForServer(type, row);
  const creditStatus = ['movie', 'series_episode', 'anime_episode', 'live_tv'].includes(creditType)
    ? await getCreditStatus({ user: req.user, contentType: creditType, contentId: creditId })
    : { credits_system_enabled: false, is_credit_enabled: false, credits_required: 0, already_unlocked: true, user_balance: 0 };

  const serialized = serializeDownloadRow(row, {
    kind: type,
    user: req.user,
    creditStatus,
    settings,
    baseUrl: resolveRequestBaseUrl(req),
  });

  if (serialized.premium_required) {
    return res.status(403).json({
      premium_required: true,
      requires_premium: true,
      credit_required: serialized.credit_required,
      message: 'Premium subscription required for this download.',
      server: serialized,
    });
  }

  if (serialized.credit_required > 0) {
    return res.status(402).json({
      premium_required: false,
      credit_required: serialized.credit_required,
      credits_required: serialized.credit_required,
      credit_balance: serialized.credit_balance,
      message: `Requires ${serialized.credit_required} credits to unlock.`,
      server: serialized,
    });
  }

  return res.json({
    ...serialized,
    premium_required: false,
    credit_required: 0,
    server: serialized,
  });
});

// ================= WATCH HISTORY =================
router.post('/api/watch-history/progress', async (req, res) => {
  const userId = req.user?.id || (req.body.user_id ? Number(req.body.user_id) : null);
  const profileId = req.body.profile_id || req.headers['x-profile-id'] ? Number(req.body.profile_id || req.headers['x-profile-id']) : null;
  const deviceId = req.body.device_id || req.headers['x-device-id'] || null;
  const type = normalizeMediaKind(req.body.watchable_type || req.body.type || 'movie');
  const watchableId = Number(req.body.watchable_id || req.body.media_id || 0);
  const episodeId = req.body.episode_id ? Number(req.body.episode_id) : null;
  const pos = Number(req.body.current_position || req.body.position || 0);
  const dur = Number(req.body.duration || 0);
  const pct = dur > 0 ? Math.min(100, Number(((pos / dur) * 100).toFixed(2))) : Number(req.body.progress_percentage || 0);
  if (!watchableId) return res.status(422).json({ success: false, message: 'watchable_id is required' });

  const now = nowIso();
  const profileClause = profileId ? 'AND profile_id = ?' : '';
  const params = [type, watchableId, episodeId || 0];
  if (profileId) params.push(profileId);
  params.push(userId || -1, userId, deviceId || '');

  const existing = await queryOne(
    `SELECT id FROM watch_histories WHERE watchable_type = ? AND watchable_id = ? AND COALESCE(episode_id, 0) = ? ${profileClause} AND (user_id = ? OR (? IS NULL AND device_id = ?)) LIMIT 1`,
    params
  );

  if (existing) {
    await execute(
      `UPDATE watch_histories SET current_position = ?, duration = ?, progress_percentage = ?, last_watched_at = ?, updated_at = ? WHERE id = ?`,
      [pos, dur, pct, now, now, existing.id]
    );
    const updated = await queryOne('SELECT * FROM watch_histories WHERE id = ?', [existing.id]);
    return res.json({ success: true, status: 200, data: updated, history: updated });
  }

  const ins = await execute(
    `INSERT INTO watch_histories (user_id, profile_id, device_id, watchable_type, watchable_id, episode_id, current_position, duration, progress_percentage, last_watched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, profileId, deviceId, type, watchableId, episodeId, pos, dur, pct, now, now, now]
  );
  const created = await queryOne('SELECT * FROM watch_histories WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ success: true, status: 200, data: created, history: created });
});

router.get('/api/watch-history/continue-watching', async (req, res) => {
  const userId = req.user?.id || null;
  const profileId = req.query.profile_id || req.headers['x-profile-id'] || null;
  const deviceId = req.query.device_id || req.headers['x-device-id'] || '';
  if (!userId && !deviceId) {
    return res.json({ success: true, data: [], meta: { total: 0, profile_id: null, device_id: null }, items: [] });
  }

  const conds = [];
  const params = [];
  if (userId) {
    conds.push('user_id = ?');
    params.push(userId);
  } else {
    conds.push('device_id = ?');
    params.push(deviceId);
  }
  if (profileId) {
    conds.push('profile_id = ?');
    params.push(Number(profileId));
  }

  const rows = await queryAll(
    `SELECT * FROM watch_histories WHERE ${conds.join(' AND ')} ORDER BY last_watched_at DESC LIMIT 30`,
    params
  );

  const hydrated = await Promise.all(
    rows.map(async (w) => {
      const kind = normalizeMediaKind(w.watchable_type);
      const table = kind === 'serie' ? 'series' : kind === 'anime' ? 'animes' : 'movies';
      const parent = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [Number(w.watchable_id)]);
      const hydratedParent = parent ? await hydrateMediaRecord(kind, parent, { includeEpisodes: false }) : null;

      let episode = null;
      let season = null;
      if (w.episode_id && (kind === 'serie' || kind === 'anime')) {
        const epTable = kind === 'anime' ? 'anime_episodes' : 'episodes';
        const seTable = kind === 'anime' ? 'anime_seasons' : 'seasons';
        const seFk = kind === 'anime' ? 'anime_season_id' : 'season_id';
        episode = await queryOne(`SELECT * FROM ${epTable} WHERE id = ?`, [Number(w.episode_id)]);
        if (episode) {
          season = await queryOne(`SELECT * FROM ${seTable} WHERE id = ?`, [episode[seFk]]);
        }
      }

      return {
        ...w,
        id: Number(w.id),
        watchable_type: kind,
        watchable_id: Number(w.watchable_id),
        episode_id: w.episode_id ? Number(w.episode_id) : null,
        current_position: Number(w.current_position || 0),
        duration: Number(w.duration || 0),
        progress_percentage: Number(w.progress_percentage || 0),
        movie: kind === 'movie' ? hydratedParent : null,
        serie: kind === 'serie' ? hydratedParent : null,
        anime: kind === 'anime' ? hydratedParent : null,
        episode,
        season,
      };
    })
  );

  return res.json({
    success: true,
    data: hydrated,
    items: hydrated,
    meta: {
      total: hydrated.length,
      profile_id: profileId ? Number(profileId) : null,
      device_id: deviceId || null,
    },
  });
});

router.get('/api/watch-history/progress', async (req, res) => {
  const userId = req.user?.id || null;
  const profileId = req.query.profile_id || req.headers['x-profile-id'] || null;
  const deviceId = req.query.device_id || req.headers['x-device-id'] || '';
  const type = normalizeMediaKind(req.query.watchable_type || req.query.type || 'movie');
  const id = Number(req.query.watchable_id || req.query.media_id || 0);
  const epId = req.query.episode_id ? Number(req.query.episode_id) : 0;

  const extra = profileId ? 'AND profile_id = ?' : '';
  const params = [type, id, epId];
  if (profileId) params.push(Number(profileId));
  params.push(userId || -1, userId, deviceId);

  const row = await queryOne(
    `SELECT * FROM watch_histories WHERE watchable_type = ? AND watchable_id = ? AND COALESCE(episode_id, 0) = ? ${extra} AND (user_id = ? OR (? IS NULL AND device_id = ?)) LIMIT 1`,
    params
  );
  return res.json({ success: true, data: row || null, history: row || null });
});

router.get('/api/watch-history/episodes', async (req, res) => {
  const userId = req.user?.id || null;
  const deviceId = req.query.device_id || req.headers['x-device-id'] || '';
  const watchableId = Number(req.query.watchable_id || req.query.serie_id || req.query.anime_id || 0);
  if (!userId && !deviceId) return res.json({ success: true, watched_episode_ids: [], episodes: [] });

  const where = userId ? 'user_id = ?' : 'device_id = ?';
  const params = [userId || deviceId];
  let extra = 'AND episode_id IS NOT NULL';
  if (watchableId) {
    extra += ' AND watchable_id = ?';
    params.push(watchableId);
  }
  const rows = await queryAll(`SELECT * FROM watch_histories WHERE ${where} ${extra}`, params);
  return res.json({
    success: true,
    watched_episode_ids: rows.map((r) => Number(r.episode_id)).filter(Boolean),
    episodes: rows,
  });
});

router.post('/api/watch-history/migrate-device-history', requireAuth, async (req, res) => {
  const deviceId = String(req.body.device_id || req.headers['x-device-id'] || '');
  if (!deviceId) return res.status(422).json({ success: false, message: 'device_id is required' });
  const r = await execute(
    'UPDATE watch_histories SET user_id = ?, updated_at = ? WHERE device_id = ? AND user_id IS NULL',
    [req.user.id, nowIso(), deviceId]
  );
  return res.json({ success: true, status: 200, migrated: r.changes || 0 });
});

router.get('/api/watch-history/count', async (req, res) => {
  const userId = req.user?.id || null;
  const deviceId = req.query.device_id || req.headers['x-device-id'] || '';
  if (!userId && !deviceId) return res.json({ success: true, count: 0 });
  const r = await queryOne(
    `SELECT COUNT(*) AS count FROM watch_histories WHERE ${userId ? 'user_id = ?' : 'device_id = ?'}`,
    [userId || deviceId]
  );
  return res.json({ success: true, count: Number(r?.count || 0) });
});

router.delete(['/api/watch-history/remove', '/api/watch-history/content'], async (req, res) => {
  const userId = req.user?.id || null;
  const id = Number(req.query.watchable_id || req.body?.watchable_id || 0);
  if (userId && id) {
    await execute('DELETE FROM watch_histories WHERE user_id = ? AND watchable_id = ?', [userId, id]);
  }
  return res.json({ success: true, status: 200, message: 'Removed from watch history' });
});

router.delete(['/api/watch-history/clear', '/api/watch-history/user'], requireAuth, async (req, res) => {
  await execute('DELETE FROM watch_histories WHERE user_id = ?', [req.user.id]);
  return res.json({ success: true, status: 200, message: 'Watch history cleared' });
});

router.delete('/api/watch-history/device', async (req, res) => {
  const deviceId = String(req.query.device_id || req.body?.device_id || req.headers['x-device-id'] || '');
  if (deviceId) await execute('DELETE FROM watch_histories WHERE device_id = ? AND user_id IS NULL', [deviceId]);
  return res.json({ success: true, status: 200, message: 'Device history cleared' });
});

// ================= FAVORITES =================
const FAV_CLASS_MAP = {
  movie: { model: 'App\\Models\\Movie', table: 'movies', kind: 'movie' },
  serie: { model: 'App\\Models\\Serie', table: 'series', kind: 'serie' },
  anime: { model: 'App\\Models\\Anime', table: 'animes', kind: 'anime' },
  streaming: { model: 'App\\Models\\Livetv', table: 'livetvs', kind: 'livetv' },
};

for (const [slug, cfg] of Object.entries(FAV_CLASS_MAP)) {
  router.post(`/api/${slug}/addtofav/:id`, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const now = nowIso();
    const verb = isMySql() ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';
    await execute(
      `${verb} favorites (user_id, favoriteable_type, favoriteable_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, cfg.model, id, now, now]
    );
    return res.json({ status: 1, message: 'Success', is_favorite: 1 });
  });

  router.get(`/api/${slug}/isMovieFavorite/:id`, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const exists = await queryOne(
      'SELECT 1 AS ok FROM favorites WHERE user_id = ? AND favoriteable_type = ? AND favoriteable_id = ?',
      [req.user.id, cfg.model, id]
    );
    const val = exists ? 1 : 0;
    return res.json({ status: val, status_fav: val, is_favorite: val });
  });

  router.delete(`/api/${slug}/removefromfav/:id`, requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    await execute(
      'DELETE FROM favorites WHERE user_id = ? AND favoriteable_type = ? AND favoriteable_id = ?',
      [req.user.id, cfg.model, id]
    );
    return res.json({ status: 0, message: 'Removed', is_favorite: 0 });
  });
}

function canViewUserFavorites(req) {
  return Number(req.params.userId) === Number(req.user.id) || req.user.role === 'admin';
}

router.get('/api/user/:userId/favorites', requireAuth, async (req, res) => {
  if (!canViewUserFavorites(req)) return res.status(403).json({ message: 'Forbidden' });
  const rows = await queryAll('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC', [
    Number(req.params.userId),
  ]);
  return res.json({ favorites: rows, data: rows });
});

router.get('/api/user/:userId/movies', requireAuth, async (req, res) => {
  if (!canViewUserFavorites(req)) return res.status(403).json({ message: 'Forbidden' });
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM movies m INNER JOIN favorites f ON f.favoriteable_id = m.id',
      whereSql: 'WHERE f.user_id = ? AND f.favoriteable_type = ?',
      params: [Number(req.params.userId), 'App\\Models\\Movie'],
      selectSql: 'm.*',
      orderBySql: 'f.created_at DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('movie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/user/:userId/series', requireAuth, async (req, res) => {
  if (!canViewUserFavorites(req)) return res.status(403).json({ message: 'Forbidden' });
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM series s INNER JOIN favorites f ON f.favoriteable_id = s.id',
      whereSql: 'WHERE f.user_id = ? AND f.favoriteable_type = ?',
      params: [Number(req.params.userId), 'App\\Models\\Serie'],
      selectSql: 's.*',
      orderBySql: 'f.created_at DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('serie', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/user/:userId/animes', requireAuth, async (req, res) => {
  if (!canViewUserFavorites(req)) return res.status(403).json({ message: 'Forbidden' });
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM animes a INNER JOIN favorites f ON f.favoriteable_id = a.id',
      whereSql: 'WHERE f.user_id = ? AND f.favoriteable_type = ?',
      params: [Number(req.params.userId), 'App\\Models\\Anime'],
      selectSql: 'a.*',
      orderBySql: 'f.created_at DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      mapRow: (r) => hydrateMediaRecord('anime', r, { includeEpisodes: false }),
      req,
    })
  );
});

router.get('/api/user/:userId/streaming', requireAuth, async (req, res) => {
  if (!canViewUserFavorites(req)) return res.status(403).json({ message: 'Forbidden' });
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM livetvs l INNER JOIN favorites f ON f.favoriteable_id = l.id',
      whereSql: 'WHERE f.user_id = ? AND f.favoriteable_type = ?',
      params: [Number(req.params.userId), 'App\\Models\\Livetv'],
      selectSql: 'l.*',
      orderBySql: 'f.created_at DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 12),
      req,
    })
  );
});

// ================= COMMENTS & REACTIONS =================
function getCommentableModel(reqPath) {
  if (reqPath.includes('/series/')) return 'App\\Models\\Serie';
  if (reqPath.includes('/animes/')) return 'App\\Models\\Anime';
  return 'App\\Models\\Movie';
}

router.get(
  ['/api/media/detail/comments/:id/:code?', '/api/media/series/comments/:id/:code?', '/api/media/animes/comments/:id/:code?'],
  async (req, res) => {
    const id = Number(req.params.id);
    const model = getCommentableModel(req.path);
    const rows = await queryAll(
      `SELECT * FROM comments WHERE commentable_id = ? AND (commentable_type = ? OR commentable_type LIKE ?) AND is_approved = 1 ORDER BY id DESC`,
      [id, model, `%${model.split('\\').pop()}%`]
    );
    let reactionMap = new Map();
    if (req.user?.id && rows.length) {
      const rx = await queryAll(
        `SELECT comment_id, reaction FROM comment_reactions WHERE user_id = ? AND comment_id IN (${rows.map(() => '?').join(',')})`,
        [req.user.id, ...rows.map((r) => r.id)]
      );
      reactionMap = new Map(rx.map((r) => [Number(r.comment_id), r.reaction]));
    }
    const comments = rows.map((c) => ({
      ...c,
      likes_count: Number(c.likes_count || 0),
      dislikes_count: Number(c.dislikes_count || 0),
      my_reaction: reactionMap.get(Number(c.id)) || null,
    }));
    return res.json({ comments_count: comments.length, comments });
  }
);

router.post(
  [
    '/api/media/detail/addcomment/:code?',
    '/api/media/series/addcomment/:code?',
    '/api/media/animes/addcomment/:code?',
    '/api/media/addcomment',
  ],
  requireAuth,
  async (req, res) => {
    const id = Number(req.body.movie_id || req.body.serie_id || req.body.anime_id || req.body.commentable_id || 0);
    const commentText = String(req.body.comments_message || req.body.comment || req.body.message || '').trim();
    if (!id || !commentText) return res.status(422).json({ message: 'Media ID and comment text required' });

    const model = req.body.serie_id
      ? 'App\\Models\\Serie'
      : req.body.anime_id
      ? 'App\\Models\\Anime'
      : getCommentableModel(req.path);
    const now = nowIso();
    const ins = await execute(
      `INSERT INTO comments (commentable_type, commentable_id, user_image, user_name, comment, is_approved, user_id, likes_count, dislikes_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 0, 0, ?, ?)`,
      [model, id, req.user.avatar || null, req.user.name, commentText, req.user.id, now, now]
    );
    const created = await queryOne('SELECT * FROM comments WHERE id = ?', [Number(ins.lastInsertRowid)]);
    return res.status(201).json(created);
  }
);

async function recountCommentReactions(commentId) {
  const rows = await queryAll('SELECT reaction, COUNT(*) AS cnt FROM comment_reactions WHERE comment_id = ? GROUP BY reaction', [
    commentId,
  ]);
  let likes = 0;
  let dislikes = 0;
  for (const r of rows) {
    if (r.reaction === 'like') likes = Number(r.cnt);
    if (r.reaction === 'dislike') dislikes = Number(r.cnt);
  }
  await execute('UPDATE comments SET likes_count = ?, dislikes_count = ?, updated_at = ? WHERE id = ?', [
    likes,
    dislikes,
    nowIso(),
    commentId,
  ]);
  return { likes_count: likes, dislikes_count: dislikes };
}

router.post('/api/media/comments/:comment/reaction', requireAuth, async (req, res) => {
  const commentId = Number(req.params.comment);
  const type = String(req.body.reaction || 'like').toLowerCase() === 'dislike' ? 'dislike' : 'like';
  const now = nowIso();

  const existingComment = await queryOne('SELECT id FROM comments WHERE id = ?', [commentId]);
  if (!existingComment) return res.status(404).json({ message: 'Comment not found' });

  const { action, myReaction, counts } = await runInTransaction(async () => {
    const existing = await queryOne('SELECT * FROM comment_reactions WHERE comment_id = ? AND user_id = ?', [
      commentId,
      req.user.id,
    ]);
    let act = 'added';
    let finalReaction = type;
    if (existing) {
      if (existing.reaction === type) {
        await execute('DELETE FROM comment_reactions WHERE id = ?', [existing.id]);
        act = 'removed';
        finalReaction = null;
      } else {
        await execute('UPDATE comment_reactions SET reaction = ?, updated_at = ? WHERE id = ?', [
          type,
          now,
          existing.id,
        ]);
        act = 'switched';
      }
    } else {
      await execute(
        'INSERT INTO comment_reactions (comment_id, user_id, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [commentId, req.user.id, type, now, now]
      );
    }
    const c = await recountCommentReactions(commentId);
    return { action: act, myReaction: finalReaction, counts: c };
  });

  return res.json({ status: action, comment_id: commentId, my_reaction: myReaction, counts });
});

router.delete('/api/media/comments/:comment/reaction', requireAuth, async (req, res) => {
  const commentId = Number(req.params.comment);
  await execute('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?', [commentId, req.user.id]);
  const counts = await recountCommentReactions(commentId);
  return res.json({ status: 'removed', comment_id: commentId, my_reaction: null, counts });
});

router.delete(['/api/media/comments/:comment', '/api/media/delete/comments/:comment'], requireAuth, async (req, res) => {
  const comment = await queryOne('SELECT * FROM comments WHERE id = ?', [Number(req.params.comment)]);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  if (Number(comment.user_id) !== Number(req.user.id) && !['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  await execute('DELETE FROM comments WHERE id = ?', [comment.id]);
  return res.json({ status: 200, message: 'Comment deleted' });
});

// ================= RATINGS =================
router.post('/api/media/addrating', requireAuth, async (req, res) => {
  const type = normalizeMediaKind(req.body.media_type || req.body.type || 'movie');
  const id = Number(req.body.media_id || req.body.movie_id || req.body.id || 0);
  const rating = Math.max(0, Math.min(10, Number(req.body.rating || 0)));
  if (!id) return res.status(422).json({ message: 'media_id is required' });

  const now = nowIso();
  const existing = await queryOne('SELECT id FROM reviews WHERE user_id = ? AND media_type = ? AND media_id = ?', [
    req.user.id,
    type,
    id,
  ]);
  if (existing) {
    await execute('UPDATE reviews SET rating = ?, updated_at = ? WHERE id = ?', [rating, now, existing.id]);
  } else {
    await execute(
      'INSERT INTO reviews (user_id, media_type, media_id, rating, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, type, id, rating, now, now]
    );
  }

  const agg = await queryOne(
    'SELECT AVG(rating) AS avg_rating, COUNT(*) AS cnt FROM reviews WHERE media_type = ? AND media_id = ?',
    [type, id]
  );
  const voteAvg = Number(Number(agg?.avg_rating || rating).toFixed(1));
  const voteCount = Number(agg?.cnt || 1);
  const table = type === 'serie' ? 'series' : type === 'anime' ? 'animes' : 'movies';
  await execute(`UPDATE ${table} SET vote_average = ?, vote_count = ?, updated_at = ? WHERE id = ?`, [
    voteAvg,
    voteCount,
    now,
    id,
  ]);

  return res.json({
    status: 200,
    message: 'Review saved successfully',
    rating,
    vote_average: voteAvg,
    vote_count: voteCount,
  });
});

// ================= REPORTS, SUGGESTIONS & MOVIE REQUESTS =================
router.post('/api/report/:code?', async (req, res) => {
  const now = nowIso();
  const ins = await execute('INSERT INTO reports (title, message, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    String(req.body.title || 'Report'),
    String(req.body.message || ''),
    now,
    now,
  ]);
  const body = await queryOne('SELECT * FROM reports WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ status: 200, message: 'created successfully', body });
});

router.post('/api/suggest/:code?', async (req, res) => {
  const now = nowIso();
  const ins = await execute('INSERT INTO suggestions (title, message, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    String(req.body.title || 'Suggestion'),
    String(req.body.message || ''),
    now,
    now,
  ]);
  const body = await queryOne('SELECT * FROM suggestions WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ status: 200, message: 'created successfully', body });
});

router.post('/api/movie-requests/submit', requireAuth, async (req, res) => {
  const tmdbId = req.body.tmdb_id ? Number(req.body.tmdb_id) : null;
  const title = String(req.body.request_title || req.body.title || '').trim();
  const type = normalizeMediaKind(req.body.type || 'movie');
  if (!title && !tmdbId) return res.status(422).json({ status: 422, message: 'Title or TMDB ID is required' });

  const now = nowIso();
  const ins = await execute(
    `INSERT INTO movie_requests (user_id, movie_imdb_id, tmdb_id, type, status, request_title, poster_path, backdrop_path, release_date, vote_average, tmdb_payload, user_notes, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      req.body.movie_imdb_id || null,
      tmdbId,
      type,
      title || `TMDB #${tmdbId}`,
      req.body.poster_path || null,
      req.body.backdrop_path || null,
      req.body.release_date || null,
      req.body.vote_average ? Number(req.body.vote_average) : null,
      req.body.tmdb_payload ? (typeof req.body.tmdb_payload === 'string' ? req.body.tmdb_payload : JSON.stringify(req.body.tmdb_payload)) : null,
      req.body.user_notes || null,
      now,
      now,
      now,
    ]
  );
  const created = await queryOne('SELECT * FROM movie_requests WHERE id = ?', [Number(ins.lastInsertRowid)]);
  const s = await getSettingsRow();
  return res.json({
    status: 200,
    message: 'Request submitted successfully',
    data: serializeMovieRequest(created, s, req),
  });
});

router.get(['/api/movie-requests/my-requests', '/api/user/my-movie-requests'], requireAuth, async (req, res) => {
  const s = await getSettingsRow();
  const paginated = await paginateQuery({
    baseFrom: 'FROM movie_requests',
    whereSql: 'WHERE user_id = ?',
    params: [req.user.id],
    orderBySql: 'id DESC',
    page: parsePage(req),
    perPage: parsePerPage(req, 15),
    mapRow: (r) => serializeMovieRequest(r, s, req),
    req,
  });
  return res.json({ status: 200, data: paginated.data, requests: paginated.data, pagination: paginated });
});

router.get('/api/movie-requests/stats', requireAuth, async (req, res) => {
  const rows = await queryAll('SELECT status, COUNT(*) AS count FROM movie_requests WHERE user_id = ? GROUP BY status', [
    req.user.id,
  ]);
  const stats = { total: 0, pending: 0, approved: 0, fulfilled: 0, rejected: 0 };
  for (const r of rows) {
    stats[r.status] = Number(r.count);
    stats.total += Number(r.count);
  }
  return res.json({ status: 200, data: stats, stats });
});

router.get('/api/movie-requests/status/:status', requireAuth, async (req, res) => {
  const s = await getSettingsRow();
  const rows = await queryAll('SELECT * FROM movie_requests WHERE user_id = ? AND status = ? ORDER BY id DESC', [
    req.user.id,
    String(req.params.status),
  ]);
  const data = rows.map((r) => serializeMovieRequest(r, s, req));
  return res.json({ status: 200, data, requests: data });
});

router.get('/api/movie-requests/type/:type', requireAuth, async (req, res) => {
  const s = await getSettingsRow();
  const rows = await queryAll('SELECT * FROM movie_requests WHERE user_id = ? AND type = ? ORDER BY id DESC', [
    req.user.id,
    normalizeMediaKind(req.params.type),
  ]);
  const data = rows.map((r) => serializeMovieRequest(r, s, req));
  return res.json({ status: 200, data, requests: data });
});

router.get('/api/movie-requests/:requestId', requireAuth, async (req, res) => {
  const row = await queryOne('SELECT * FROM movie_requests WHERE id = ? AND user_id = ?', [
    Number(req.params.requestId),
    req.user.id,
  ]);
  if (!row) return res.status(404).json({ message: 'Request not found' });
  const s = await getSettingsRow();
  return res.json({ status: 200, data: serializeMovieRequest(row, s, req) });
});

router.delete('/api/movie-requests/cancel/:requestId', requireAuth, async (req, res) => {
  await execute('DELETE FROM movie_requests WHERE id = ? AND user_id = ? AND status = ?', [
    Number(req.params.requestId),
    req.user.id,
    'pending',
  ]);
  return res.json({ status: 200, message: 'Request cancelled' });
});

// ================= PLANS, SUBSCRIPTIONS, PAYMENTS & COUPONS =================
router.get(['/api/plans', '/api/plans/plans/:code?', '/api/subscriptions/plans', '/api/subscriptions/all', '/api/subscriptions/paypal'], async (_req, res) => {
  const rows = await queryAll('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
  const plans = rows.map(serializePlan);
  return res.json({ status: 200, success: true, plans, data: plans });
});

router.get('/api/plans/show/:plan/:code?', async (req, res) => {
  const row = await queryOne('SELECT * FROM plans WHERE id = ?', [Number(req.params.plan)]);
  if (!row) return res.status(404).json({ message: 'Plan not found' });
  return res.json({ status: 200, plan: serializePlan(row) });
});

router.get('/api/subscriptions/me', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const sub = await queryOne(
    `SELECT * FROM subscriptions WHERE user_id = ? AND (stripe_status IN ('active', 'trialing') OR provider_status IN ('active', 'trialing')) ORDER BY id DESC LIMIT 1`,
    [req.user.id]
  );
  let plan = null;
  const planId = sub?.provider_plan_id || u?.pack_id;
  if (planId && Number.isFinite(Number(planId))) {
    plan = await queryOne('SELECT * FROM plans WHERE id = ?', [Number(planId)]);
  }
  const serializedSub = formatSubscriptionForApi(sub, plan, u);
  const access = buildUserAccessState(u, sub, plan);
  return res.json({
    success: true,
    data: {
      subscription: serializedSub,
      access,
    },
  });
});

router.get('/api/subscriptions/stripe/config', async (_req, res) => {
  const s = await getSettingsRow();
  return res.json({
    success: true,
    publishable_key: s.stripe_publishable_key || '',
    currency: s.cashier_currency || 'usd',
    payment_mode: s.payment_mode || 'live',
  });
});

router.post(
  [
    '/api/subscriptions/subscribe',
    '/api/subscriptions/paypal/activate',
    '/api/subscriptions/renew',
    '/api/addPlanToUser',
    '/api/updatePaypal',
  ],
  requireAuth,
  async (req, res) => {
    const planId = Number(req.body.plan_id || req.body.pack_id || 0);
    const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    const provider = req.path.toLowerCase().includes('paypal') ? 'paypal' : String(req.body.provider || 'stripe');
    const updatedUser = await activateSubscriptionForUser(
      req.user.id,
      plan,
      provider,
      req.body.transaction_id || req.body.subscription_id || null
    );
    const sub = await queryOne('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
    return res.json({
      status: 200,
      success: true,
      message: 'Subscription activated',
      user: updatedUser,
      subscription: formatSubscriptionForApi(sub, plan, updatedUser),
    });
  }
);

router.all(
  [
    '/api/subscriptions/cancel',
    '/api/cancelSubscription',
    '/api/cancelSubscriptionPaypal',
  ],
  requireAuth,
  async (req, res) => {
    const now = nowIso();
    await execute(
      `UPDATE subscriptions SET provider_status = 'canceled', stripe_status = 'canceled', ends_at = ?, updated_at = ? WHERE user_id = ? AND (stripe_status = 'active' OR provider_status = 'active')`,
      [now, now, req.user.id]
    );
    await execute('UPDATE users SET premuim = 0, updated_at = ? WHERE id = ?', [now, req.user.id]);
    return res.json({ status: 200, success: true, message: 'Subscription cancelled' });
  }
);

router.post('/api/subscriptions/sync', requireAuth, async (req, res) => {
  const u = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const sub = await queryOne(
    `SELECT * FROM subscriptions WHERE user_id = ? AND (stripe_status IN ('active', 'trialing') OR provider_status IN ('active', 'trialing')) ORDER BY id DESC LIMIT 1`,
    [req.user.id]
  );
  return res.json({ status: 200, success: true, synced: true, subscription: sub || null, user: u });
});

router.get('/api/payment-methods', async (_req, res) => {
  const s = await queryOne(
    'SELECT stripe_publishable_key, paypal_client_id, paypal_currency, razorpay_key_id, pix_provider, offline_payment_instructions, default_payment, payment_mode FROM settings LIMIT 1'
  );
  const methods = [];
  if (s?.stripe_publishable_key) methods.push({ id: 'stripe', name: 'Credit / Debit Card (Stripe)', enabled: true });
  if (s?.paypal_client_id) methods.push({ id: 'paypal', name: 'PayPal', enabled: true });
  if (s?.razorpay_key_id) methods.push({ id: 'razorpay', name: 'Razorpay', enabled: true });
  methods.push({
    id: 'offline',
    name: 'Offline / Bank Transfer',
    enabled: true,
    instructions: s?.offline_payment_instructions || '',
  });
  return res.json({ success: true, status: 200, payment_methods: methods, config: s || {} });
});

router.post('/api/offline-payment-request', requireAuth, uploadProof.single('proof_image'), async (req, res) => {
  const planId = Number(req.body.plan_id);
  const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) return res.status(404).json({ message: 'Plan not found' });
  if (!req.file) return res.status(422).json({ message: 'proof_image file is required' });

  const now = nowIso();
  const ref = `OFF-${Date.now()}-${randomCode(5)}`;
  const proofUrl = publicStorageUrl(req, '/api/image/offline/', req.file.filename);
  const ins = await execute(
    `INSERT INTO offline_payment_requests (user_id, plan_id, amount, currency, full_name, phone, reference, note, proof_image, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      req.user.id,
      plan.id,
      Number(plan.price || 0),
      plan.currency || 'USD',
      String(req.body.full_name || req.user.name),
      String(req.body.phone || ''),
      ref,
      req.body.note || null,
      proofUrl,
      now,
      now,
    ]
  );
  const row = await queryOne('SELECT * FROM offline_payment_requests WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ status: 200, success: true, message: 'Payment proof uploaded', request: row, data: row });
});

router.get('/api/offline-payment-requests', requireAuth, async (req, res) => {
  const rows = await queryAll(
    'SELECT o.*, p.name AS plan_name FROM offline_payment_requests o LEFT JOIN plans p ON p.id = o.plan_id WHERE o.user_id = ? ORDER BY o.id DESC',
    [req.user.id]
  );
  return res.json({ success: true, status: 200, requests: rows, data: rows });
});

// ================= COUPONS =================
router.post('/api/coupons/create', requireAuth, async (req, res) => {
  if (!['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const code = String(req.body.code || randomCode(8)).trim().toUpperCase();
  const now = nowIso();
  const ins = await execute(
    `INSERT INTO promocodes (user_id, code, usages_left, bound_to_user, multi_use, details, expired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      code,
      Math.max(1, Number(req.body.usages_left || 1)),
      req.body.bound_to_user ? 1 : 0,
      req.body.multi_use ? 1 : 0,
      req.body.details ? (typeof req.body.details === 'string' ? req.body.details : JSON.stringify(req.body.details)) : '{}',
      req.body.expired_at || null,
      now,
      now,
    ]
  );
  const coupon = await queryOne('SELECT * FROM promocodes WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ status: 200, success: true, message: 'Coupon created', coupon });
});

router.post('/api/coupons/apply', requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const coupon = await queryOne('SELECT * FROM promocodes WHERE UPPER(code) = ?', [code]);
  if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
  if (Number(coupon.usages_left) <= 0) return res.status(422).json({ success: false, message: 'Coupon usage limit reached' });
  if (coupon.expired_at && String(coupon.expired_at) < nowIso()) {
    return res.status(422).json({ success: false, message: 'Coupon expired' });
  }
  if (!Number(coupon.multi_use || 0)) {
    const usedByUser = await queryOne('SELECT id FROM promocode_user WHERE promocode_id = ? AND user_id = ?', [
      coupon.id,
      req.user.id,
    ]);
    if (usedByUser) return res.status(422).json({ success: false, message: 'Coupon already used by this account' });
  }

  const now = nowIso();
  await execute('UPDATE promocodes SET usages_left = usages_left - 1, updated_at = ? WHERE id = ?', [now, coupon.id]);
  await execute(
    'INSERT INTO promocode_user (promocode_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [coupon.id, req.user.id, now, now]
  );

  let details = {};
  try {
    details = coupon.details ? JSON.parse(coupon.details) : {};
  } catch {
    details = {};
  }

  return res.json({
    status: 200,
    success: true,
    message: 'Coupon applied successfully',
    coupon: { ...coupon, details },
  });
});

// ================= CREDITS SYSTEM =================
router.get('/api/user/credits', requireAuth, async (req, res) => {
  const [enabled, credit] = await Promise.all([creditsSystemEnabled(), getOrCreateUserCredit(req.user.id)]);
  return res.json({
    success: true,
    status: 200,
    credits_system_enabled: enabled,
    balance: Number(credit.balance || 0),
    total_purchased: Number(credit.total_purchased || 0),
    total_spent: Number(credit.total_spent || 0),
    data: credit,
  });
});

router.get('/api/credit/packages', async (_req, res) => {
  const packages = await queryAll(
    "SELECT * FROM credit_packages WHERE status = 'enabled' ORDER BY sort_order ASC, id ASC"
  );
  return res.json({ success: true, status: 200, packages, data: packages });
});

router.post('/api/credits/purchase/initiate', requireAuth, async (req, res) => {
  const pkg = await queryOne("SELECT * FROM credit_packages WHERE id = ? AND status = 'enabled'", [
    Number(req.body.package_id || req.body.credit_package_id),
  ]);
  if (!pkg) return res.status(404).json({ message: 'Credit package not found' });
  const reference = `CRD_INIT_${Date.now()}_${randomCode(6)}`;
  return res.json({
    success: true,
    status: 200,
    reference,
    package: pkg,
    amount: Number(pkg.price || 0),
    currency: pkg.currency || 'USD',
  });
});

router.post('/api/credits/purchase/confirm', requireAuth, async (req, res) => {
  const pkg = await queryOne('SELECT * FROM credit_packages WHERE id = ?', [Number(req.body.package_id || req.body.credit_package_id)]);
  if (!pkg) return res.status(404).json({ message: 'Credit package not found' });
  const ref = String(req.body.reference || req.body.payment_reference || `CRD_${Date.now()}_${randomCode(5)}`);
  const updated = await addCredits(
    req.user.id,
    Number(pkg.credits_amount),
    'purchase',
    `Purchased ${pkg.name} (${pkg.credits_amount} credits)`,
    req.user.id,
    String(req.body.payment_method || 'stripe'),
    ref
  );
  return res.json({ success: true, status: 200, message: 'Credits added', credit: updated, balance: Number(updated.balance || 0) });
});

router.post('/api/credits/purchase/offline-request', requireAuth, uploadProof.single('proof_image'), async (req, res) => {
  const pkg = await queryOne('SELECT * FROM credit_packages WHERE id = ?', [Number(req.body.package_id || req.body.credit_package_id)]);
  if (!pkg) return res.status(404).json({ message: 'Credit package not found' });
  if (!req.file) return res.status(422).json({ message: 'proof_image file is required' });

  const now = nowIso();
  const ref = `CRD_OFF_${Date.now()}_${randomCode(5)}`;
  const proofUrl = publicStorageUrl(req, '/api/image/offline/', req.file.filename);
  const ins = await execute(
    `INSERT INTO credit_purchase_requests (user_id, credit_package_id, credits_amount, amount, currency, full_name, phone, reference, note, proof_image, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      req.user.id,
      pkg.id,
      pkg.credits_amount,
      pkg.price,
      pkg.currency || 'USD',
      String(req.body.full_name || req.user.name),
      String(req.body.phone || ''),
      ref,
      req.body.note || null,
      proofUrl,
      now,
      now,
    ]
  );
  const row = await queryOne('SELECT * FROM credit_purchase_requests WHERE id = ?', [Number(ins.lastInsertRowid)]);
  return res.json({ success: true, status: 200, message: 'Credit offline request submitted', request: row, data: row });
});

router.get('/api/credits/purchase/offline-requests', requireAuth, async (req, res) => {
  const rows = await queryAll(
    'SELECT * FROM credit_purchase_requests WHERE user_id = ? ORDER BY id DESC',
    [req.user.id]
  );
  return res.json({ success: true, status: 200, requests: rows, data: rows });
});

router.post('/api/credits/check', requireAuth, async (req, res) => {
  const type = normalizeContentType(req.body.content_type || req.body.type || 'movie');
  const id = Number(req.body.content_id || req.body.id || 0);
  if (!id) return res.status(422).json({ message: 'content_id is required' });

  const status = await getCreditStatus({ user: req.user, contentType: type, contentId: id });
  return res.json({
    success: true,
    status: 200,
    ...status,
  });
});

router.post('/api/credits/spend', requireAuth, async (req, res) => {
  const type = normalizeContentType(req.body.content_type || req.body.type || 'movie');
  const id = Number(req.body.content_id || req.body.id || 0);
  const content = await findContentRecord(type, id);
  if (!content) return res.status(404).json({ message: 'Content not found' });

  try {
    const result = await spendCreditsForUnlock(req.user.id, type, id);
    return res.json({ success: true, status: 200, ...result });
  } catch (err) {
    const status = err.statusCode || (String(err.message || '').toLowerCase().includes('insufficient') ? 402 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
});

router.get('/api/credits/transactions', requireAuth, async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM credit_transactions',
      whereSql: 'WHERE user_id = ?',
      params: [req.user.id],
      orderBySql: 'id DESC',
      page: parsePage(req),
      perPage: parsePerPage(req, 20),
      req,
    })
  );
});

// ================= WEBHOOKS =================
router.post(['/api/webhooks/stripe', '/api/webhooks/paypal'], (_req, res) => {
  return res.json({ received: true });
});

export default router;
