import { queryAll, queryOne, execute, nowIso } from '../db/sqlite.js';
import { tmdbGet, getTmdbConfig } from './tmdb.js';

export const MEDIA_SCHEMAS = {
  movie: {
    kind: 'movie',
    table: 'movies',
    titleCol: 'title',
    dateCol: 'release_date',
    fkCol: 'movie_id',
    genreTable: 'movie_genres',
    castTable: 'movie_casts',
    networkTable: 'movie_networks',
    langTable: 'movie_spoken_languages',
    collectionTable: 'movie_collections',
    certTable: 'movie_certifications',
    videoTable: 'movie_videos',
    videoFk: 'movie_id',
    downloadTable: 'movie_downloads',
    downloadFk: 'movie_id',
    subtitleTable: 'movie_substitles',
    subtitleFk: 'movie_id',
    hasHdCol: true,
    hasDownloadOnlyCol: true,
    subtitleHasName: false,
  },
  serie: {
    kind: 'serie',
    table: 'series',
    titleCol: 'name',
    dateCol: 'first_air_date',
    fkCol: 'serie_id',
    genreTable: 'serie_genres',
    castTable: 'serie_casts',
    networkTable: 'serie_networks',
    langTable: 'serie_spoken_languages',
    collectionTable: 'serie_collections',
    certTable: 'serie_certifications',
    seasonTable: 'seasons',
    seasonFk: 'serie_id',
    episodeTable: 'episodes',
    episodeFk: 'season_id',
    videoTable: 'serie_videos',
    videoFk: 'episode_id',
    downloadTable: 'serie_downloads',
    downloadFk: 'episode_id',
    subtitleTable: 'serie_substitles',
    subtitleFk: 'episode_id',
    hasHdCol: false,
    hasDownloadOnlyCol: false,
    subtitleHasName: true,
  },
  anime: {
    kind: 'anime',
    table: 'animes',
    titleCol: 'name',
    dateCol: 'first_air_date',
    fkCol: 'anime_id',
    genreTable: 'anime_genres',
    castTable: 'anime_casts',
    networkTable: 'anime_networks',
    langTable: 'anime_spoken_languages',
    collectionTable: 'anime_collections',
    certTable: 'anime_certifications',
    seasonTable: 'anime_seasons',
    seasonFk: 'anime_id',
    episodeTable: 'anime_episodes',
    episodeFk: 'anime_season_id',
    videoTable: 'anime_videos',
    videoFk: 'anime_episode_id',
    downloadTable: 'anime_downloads',
    downloadFk: 'anime_episode_id',
    subtitleTable: 'anime_substitles',
    subtitleFk: 'anime_episode_id',
    hasHdCol: false,
    hasDownloadOnlyCol: false,
    subtitleHasName: true,
  },
};

export function toBoolInt(val, fallback = 0) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number') return val ? 1 : 0;
  const s = String(val).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on' ? 1 : 0;
}

export async function resolveGenre(item) {
  if (!item) return null;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
    return queryOne('SELECT * FROM genres WHERE id = ?', [Number(item)]);
  }
  const id = item.genre_id ?? item.id;
  const name = String(item.name || '').trim();
  if (id) {
    const existing = await queryOne('SELECT * FROM genres WHERE id = ?', [Number(id)]);
    if (existing) return existing;
  }
  if (!name) return null;
  const byName = await queryOne('SELECT * FROM genres WHERE LOWER(name) = LOWER(?)', [name]);
  if (byName) return byName;
  const now = nowIso();
  const res = await execute(
    'INSERT INTO genres (name, logo_path, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [name, item.logo_path || null, now, now]
  );
  return queryOne('SELECT * FROM genres WHERE id = ?', [Number(res.lastInsertRowid)]);
}

export async function resolveCast(item) {
  if (!item) return null;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
    return queryOne('SELECT * FROM casts WHERE id = ? OR cast_id = ?', [Number(item), Number(item)]);
  }
  const externalId = item.cast_id ? Number(item.cast_id) : item.id ? Number(item.id) : null;
  const name = String(item.name || item.original_name || '').trim();
  if (!externalId && !name) return null;

  let existing = null;
  if (externalId) {
    existing = await queryOne('SELECT * FROM casts WHERE id = ? OR cast_id = ?', [externalId, externalId]);
  }
  if (!existing && name) {
    existing = await queryOne('SELECT * FROM casts WHERE LOWER(name) = LOWER(?)', [name]);
  }
  const now = nowIso();
  if (existing) {
    await execute(
      `UPDATE casts SET
        name = COALESCE(?, name),
        original_name = COALESCE(?, original_name),
        gender = COALESCE(?, gender),
        profile_path = COALESCE(?, profile_path),
        known_for_department = COALESCE(?, known_for_department),
        \`character\` = COALESCE(?, \`character\`),
        credit_id = COALESCE(?, credit_id),
        popularity = COALESCE(?, popularity),
        \`order\` = COALESCE(?, \`order\`),
        updated_at = ?
       WHERE id = ?`,
      [
        name || null,
        item.original_name || null,
        item.gender ?? null,
        item.profile_path || null,
        item.known_for_department || null,
        item.character || null,
        item.credit_id || null,
        item.popularity != null ? Math.round(Number(item.popularity)) : null,
        item.order ?? null,
        now,
        existing.id,
      ]
    );
    return queryOne('SELECT * FROM casts WHERE id = ?', [existing.id]);
  }

  const res = await execute(
    `INSERT INTO casts (
      name, cast_id, original_name, gender, place_of_birth, profile_path, imdb_id,
      known_for_department, biography, adult, \`character\`, birthday, credit_id, popularity,
      \`order\`, views, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name || 'Unknown',
      externalId || null,
      item.original_name || name || null,
      item.gender ?? null,
      item.place_of_birth || null,
      item.profile_path || null,
      item.imdb_id || null,
      item.known_for_department || 'Acting',
      item.biography || null,
      toBoolInt(item.adult, 0),
      item.character || null,
      item.birthday || null,
      item.credit_id || null,
      item.popularity != null ? Math.round(Number(item.popularity)) : 0,
      item.order ?? 0,
      Number(item.views || 0),
      1,
      now,
      now,
    ]
  );
  return queryOne('SELECT * FROM casts WHERE id = ?', [Number(res.lastInsertRowid)]);
}

export async function resolveNetwork(item) {
  if (!item) return null;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
    return queryOne('SELECT * FROM networks WHERE id = ?', [Number(item)]);
  }
  const id = item.network_id ?? item.id;
  const name = String(item.name || '').trim();
  if (id) {
    const existing = await queryOne('SELECT * FROM networks WHERE id = ?', [Number(id)]);
    if (existing) return existing;
  }
  if (!name) return null;
  const byName = await queryOne('SELECT * FROM networks WHERE LOWER(name) = LOWER(?)', [name]);
  if (byName) return byName;
  const now = nowIso();
  const res = await execute(
    'INSERT INTO networks (name, logo_path, origin_country, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [name, item.logo_path || null, item.origin_country || null, now, now]
  );
  return queryOne('SELECT * FROM networks WHERE id = ?', [Number(res.lastInsertRowid)]);
}

export async function resolveCollection(item) {
  if (!item) return null;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
    return queryOne('SELECT * FROM collections WHERE id = ?', [Number(item)]);
  }
  const id = item.collection_id ?? item.id;
  const name = String(item.name || '').trim();
  if (id) {
    const existing = await queryOne('SELECT * FROM collections WHERE id = ?', [Number(id)]);
    if (existing) return existing;
  }
  if (!name) return null;
  const byName = await queryOne('SELECT * FROM collections WHERE LOWER(name) = LOWER(?)', [name]);
  if (byName) return byName;
  const now = nowIso();
  const res = await execute(
    'INSERT INTO collections (name, poster_path, backdrop_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [name, item.poster_path || null, item.backdrop_path || null, now, now]
  );
  return queryOne('SELECT * FROM collections WHERE id = ?', [Number(res.lastInsertRowid)]);
}

export async function resolveCertification(item) {
  if (!item) return null;
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
    return queryOne('SELECT * FROM certifications WHERE id = ?', [Number(item)]);
  }
  const id = item.certification_id ?? item.id;
  if (id) {
    const existing = await queryOne('SELECT * FROM certifications WHERE id = ?', [Number(id)]);
    if (existing) return existing;
  }
  const country = String(item.country_code || item.iso_3166_1 || 'US').trim().toUpperCase();
  const cert = String(item.certification || '').trim();
  if (!cert) return null;
  const existing = await queryOne(
    'SELECT * FROM certifications WHERE UPPER(country_code) = ? AND certification = ?',
    [country, cert]
  );
  if (existing) return existing;
  const now = nowIso();
  const res = await execute(
    'INSERT INTO certifications (country_code, certification, meaning, `order`, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [country, cert, item.meaning || null, item.order ?? null, now, now]
  );
  return queryOne('SELECT * FROM certifications WHERE id = ?', [Number(res.lastInsertRowid)]);
}

export async function resolveLanguage(item) {
  if (!item) return null;
  const code = String(item.iso_639_1 || item.language_code || '').trim().toLowerCase();
  const name = String(item.english_name || item.language_name || item.name || code).trim();
  if (!code) return null;
  const existing = await queryOne('SELECT * FROM languages WHERE LOWER(iso_639_1) = ?', [code]);
  if (existing) return existing;
  const now = nowIso();
  await execute(
    'INSERT INTO languages (iso_639_1, english_name, name, featured, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    [code, name || code, item.name || name || code, now, now]
  );
  return queryOne('SELECT * FROM languages WHERE LOWER(iso_639_1) = ?', [code]);
}

async function insertUniquePivot(table, parentCol, parentId, childCol, childId) {
  const exists = await queryOne(
    `SELECT id FROM ${table} WHERE ${parentCol} = ? AND ${childCol} = ?`,
    [parentId, childId]
  );
  if (exists) return;
  const now = nowIso();
  await execute(
    `INSERT INTO ${table} (${parentCol}, ${childCol}, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [parentId, childId, now, now]
  );
}

export async function syncParentRelations(mediaType, parentId, payload = {}, replace = false) {
  const cfg = MEDIA_SCHEMAS[mediaType];
  if (!cfg) throw new Error(`Unknown mediaType: ${mediaType}`);
  const now = nowIso();

  const genres = payload.genres;
  if (Array.isArray(genres)) {
    if (replace) await execute(`DELETE FROM ${cfg.genreTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of genres) {
      const g = await resolveGenre(item);
      if (g) await insertUniquePivot(cfg.genreTable, cfg.fkCol, parentId, 'genre_id', g.id);
    }
  }

  const casts = payload.casterslist || payload.casts;
  if (Array.isArray(casts)) {
    if (replace) await execute(`DELETE FROM ${cfg.castTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of casts) {
      const c = await resolveCast(item);
      if (c) await insertUniquePivot(cfg.castTable, cfg.fkCol, parentId, 'cast_id', c.id);
    }
  }

  const networks = payload.networks;
  if (Array.isArray(networks)) {
    if (replace) await execute(`DELETE FROM ${cfg.networkTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of networks) {
      const n = await resolveNetwork(item);
      if (n) await insertUniquePivot(cfg.networkTable, cfg.fkCol, parentId, 'network_id', n.id);
    }
  }

  const spokenLangs = payload.spoken_languages;
  if (Array.isArray(spokenLangs)) {
    if (replace) await execute(`DELETE FROM ${cfg.langTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of spokenLangs) {
      const lang = await resolveLanguage(item);
      if (!lang) continue;
      const exists = await queryOne(
        `SELECT id FROM ${cfg.langTable} WHERE ${cfg.fkCol} = ? AND (LOWER(iso_639_1) = ? OR LOWER(language_code) = ?)`,
        [parentId, lang.iso_639_1.toLowerCase(), lang.iso_639_1.toLowerCase()]
      );
      if (!exists) {
        await execute(
          `INSERT INTO ${cfg.langTable} (name, iso_639_1, ${cfg.fkCol}, language_name, language_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [lang.name || lang.english_name, lang.iso_639_1, parentId, lang.english_name, lang.iso_639_1, now, now]
        );
      }
    }
  }

  const cols = payload.belongs_to_collection || payload.collections;
  if (cols) {
    const colArr = Array.isArray(cols) ? cols : [cols];
    if (replace) await execute(`DELETE FROM ${cfg.collectionTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of colArr) {
      const col = await resolveCollection(item);
      if (!col) continue;
      const exists = await queryOne(
        `SELECT id FROM ${cfg.collectionTable} WHERE ${cfg.fkCol} = ? AND collection_id = ?`,
        [parentId, col.id]
      );
      if (!exists) {
        await execute(
          `INSERT INTO ${cfg.collectionTable} (name, ${cfg.fkCol}, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [col.name, parentId, col.id, now, now]
        );
      }
    }
  }

  const certs = payload.certifications;
  if (Array.isArray(certs)) {
    if (replace) await execute(`DELETE FROM ${cfg.certTable} WHERE ${cfg.fkCol} = ?`, [parentId]);
    for (const item of certs) {
      const cert = await resolveCertification(item);
      if (!cert) continue;
      const exists = await queryOne(
        `SELECT id FROM ${cfg.certTable} WHERE ${cfg.fkCol} = ? AND certification_id = ?`,
        [parentId, cert.id]
      );
      if (!exists) {
        await execute(
          `INSERT INTO ${cfg.certTable} (country_code, certification, meaning, ${cfg.fkCol}, certification_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [cert.country_code, cert.certification, cert.meaning, parentId, cert.id, now, now]
        );
      }
    }
  }
}

export async function syncLinks(cfg, ownerId, links, kind, replaceMissing = true) {
  if (!Array.isArray(links)) return;
  const now = nowIso();

  if (kind === 'video') {
    const table = cfg.videoTable;
    const fk = cfg.videoFk;
    if (replaceMissing) {
      const existingIds = (await queryAll(`SELECT id FROM ${table} WHERE ${fk} = ?`, [ownerId])).map((r) => r.id);
      const keepIds = links.filter((l) => l.id).map((l) => Number(l.id));
      for (const id of existingIds) {
        if (!keepIds.includes(id)) await execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
      }
    }
    for (let idx = 0; idx < links.length; idx += 1) {
      const link = links[idx];
      if (!link || !link.link) continue;
      const sortOrder = link.sort_order ?? link.position ?? idx + 1;
      const isActive = link.is_active !== undefined ? toBoolInt(link.is_active, 1) : toBoolInt(link.status, 1);
      const common = [
        ownerId,
        link.position ?? sortOrder,
        sortOrder,
        link.server || 'Default',
        link.quality || 'Auto',
        link.header || null,
        link.useragent || null,
        String(link.link).trim(),
        link.lang || null,
        link.video_name || null,
        toBoolInt(link.embed, 0),
        toBoolInt(link.is_premium, 0),
        toBoolInt(link.youtubelink, 0),
        toBoolInt(link.hls, 0),
        toBoolInt(link.supported_hosts, 0),
        toBoolInt(link.drm, 0),
        link.drmuuid || null,
        link.drmlicenceuri || null,
        isActive,
        isActive,
      ];
      if (link.id && (await queryOne(`SELECT id FROM ${table} WHERE id = ? AND ${fk} = ?`, [Number(link.id), ownerId]))) {
        const extraSet = cfg.hasHdCol ? ', hd = ?, downloadonly = ?' : '';
        const extraVals = cfg.hasHdCol ? [toBoolInt(link.hd, 0), toBoolInt(link.downloadonly, 0)] : [];
        await execute(
          `UPDATE ${table} SET ${fk} = ?, position = ?, sort_order = ?, server = ?, quality = ?, header = ?, useragent = ?, link = ?, lang = ?, video_name = ?, embed = ?, is_premium = ?, youtubelink = ?, hls = ?, supported_hosts = ?, drm = ?, drmuuid = ?, drmlicenceuri = ?, status = ?, is_active = ?${extraSet}, updated_at = ? WHERE id = ? AND ${fk} = ?`,
          [...common, ...extraVals, now, Number(link.id), ownerId]
        );
      } else {
        const extraCol = cfg.hasHdCol ? ', hd, downloadonly' : '';
        const extraPlaceholder = cfg.hasHdCol ? ', ?, ?' : '';
        const extraVals = cfg.hasHdCol ? [toBoolInt(link.hd, 0), toBoolInt(link.downloadonly, 0)] : [];
        await execute(
          `INSERT INTO ${table} (${fk}, position, sort_order, server, quality, header, useragent, link, lang, video_name, embed, is_premium, youtubelink, hls, supported_hosts, drm, drmuuid, drmlicenceuri, status, is_active${extraCol}, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${extraPlaceholder}, ?, ?)`,
          [...common, ...extraVals, now, now]
        );
      }
    }
    return;
  }

  if (kind === 'download') {
    const table = cfg.downloadTable;
    const fk = cfg.downloadFk;
    if (replaceMissing) {
      const existingIds = (await queryAll(`SELECT id FROM ${table} WHERE ${fk} = ?`, [ownerId])).map((r) => r.id);
      const keepIds = links.filter((l) => l.id).map((l) => Number(l.id));
      for (const id of existingIds) {
        if (!keepIds.includes(id)) await execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
      }
    }
    for (let idx = 0; idx < links.length; idx += 1) {
      const link = links[idx];
      if (!link || !link.link) continue;
      const isActive = link.is_active !== undefined ? toBoolInt(link.is_active, 1) : toBoolInt(link.status, 1);
      const common = [
        ownerId,
        link.server || 'Direct',
        link.quality || 'Auto',
        link.header || null,
        link.useragent || null,
        link.video_name || null,
        String(link.link).trim(),
        toBoolInt(link.is_premium, 0),
        link.lang || null,
        toBoolInt(link.youtubelink, 0),
        toBoolInt(link.supported_hosts, 0),
        toBoolInt(link.external, 0),
        isActive,
        isActive,
        link.sort_order ?? idx + 1,
      ];
      if (link.id && (await queryOne(`SELECT id FROM ${table} WHERE id = ? AND ${fk} = ?`, [Number(link.id), ownerId]))) {
        await execute(
          `UPDATE ${table} SET ${fk} = ?, server = ?, quality = ?, header = ?, useragent = ?, video_name = ?, link = ?, is_premium = ?, lang = ?, youtubelink = ?, supported_hosts = ?, external = ?, status = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ? AND ${fk} = ?`,
          [...common, now, Number(link.id), ownerId]
        );
      } else {
        await execute(
          `INSERT INTO ${table} (${fk}, server, quality, header, useragent, video_name, link, is_premium, lang, youtubelink, supported_hosts, external, status, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...common, now, now]
        );
      }
    }
    return;
  }

  if (kind === 'subtitle') {
    const table = cfg.subtitleTable;
    const fk = cfg.subtitleFk;
    if (replaceMissing) {
      const existingIds = (await queryAll(`SELECT id FROM ${table} WHERE ${fk} = ?`, [ownerId])).map((r) => r.id);
      const keepIds = links.filter((l) => l.id).map((l) => Number(l.id));
      for (const id of existingIds) {
        if (!keepIds.includes(id)) await execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
      }
    }
    for (const sub of links) {
      if (!sub || !sub.link) continue;
      const status = toBoolInt(sub.status, 1);
      const zip = toBoolInt(sub.zip, 0);
      if (sub.id && (await queryOne(`SELECT id FROM ${table} WHERE id = ? AND ${fk} = ?`, [Number(sub.id), ownerId]))) {
        if (cfg.subtitleHasName) {
          await execute(
            `UPDATE ${table} SET ${fk} = ?, name = ?, link = ?, lang = ?, type = ?, zip = ?, status = ?, updated_at = ? WHERE id = ? AND ${fk} = ?`,
            [ownerId, sub.name || sub.lang || 'Subtitle', String(sub.link).trim(), sub.lang || 'en', sub.type || 'srt', zip, status, now, Number(sub.id), ownerId]
          );
        } else {
          await execute(
            `UPDATE ${table} SET ${fk} = ?, link = ?, lang = ?, type = ?, zip = ?, status = ?, updated_at = ? WHERE id = ? AND ${fk} = ?`,
            [ownerId, String(sub.link).trim(), sub.lang || 'en', sub.type || 'srt', zip, status, now, Number(sub.id), ownerId]
          );
        }
      } else if (cfg.subtitleHasName) {
        await execute(
          `INSERT INTO ${table} (${fk}, name, link, lang, type, zip, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ownerId, sub.name || sub.lang || 'Subtitle', String(sub.link).trim(), sub.lang || 'en', sub.type || 'srt', zip, status, now, now]
        );
      } else {
        await execute(
          `INSERT INTO ${table} (${fk}, link, lang, type, zip, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [ownerId, String(sub.link).trim(), sub.lang || 'en', sub.type || 'srt', zip, status, now, now]
        );
      }
    }
  }
}

export async function hydrateMediaRecord(mediaType, row, { includeEpisodes = true } = {}) {
  if (!row) return null;
  const cfg = MEDIA_SCHEMAS[mediaType];
  const [genres, casts, networks, spoken_languages, collections, certifications] = await Promise.all([
    queryAll(
      `SELECT g.*, mg.id AS pivot_id, mg.genre_id FROM ${cfg.genreTable} mg JOIN genres g ON g.id = mg.genre_id WHERE mg.${cfg.fkCol} = ? ORDER BY mg.id ASC`,
      [row.id]
    ),
    queryAll(
      `SELECT c.*, mc.id AS pivot_id, mc.cast_id AS pivot_cast_id FROM ${cfg.castTable} mc JOIN casts c ON c.id = mc.cast_id WHERE mc.${cfg.fkCol} = ? ORDER BY COALESCE(c.\`order\`, 9999) ASC, mc.id ASC`,
      [row.id]
    ),
    queryAll(
      `SELECT n.*, mn.id AS pivot_id, mn.network_id FROM ${cfg.networkTable} mn JOIN networks n ON n.id = mn.network_id WHERE mn.${cfg.fkCol} = ? ORDER BY mn.id ASC`,
      [row.id]
    ),
    queryAll(`SELECT * FROM ${cfg.langTable} WHERE ${cfg.fkCol} = ? ORDER BY id ASC`, [row.id]),
    queryAll(
      `SELECT c.*, mc.id AS pivot_id, mc.collection_id FROM ${cfg.collectionTable} mc JOIN collections c ON c.id = mc.collection_id WHERE mc.${cfg.fkCol} = ? ORDER BY mc.id ASC`,
      [row.id]
    ),
    queryAll(`SELECT * FROM ${cfg.certTable} WHERE ${cfg.fkCol} = ? ORDER BY id ASC`, [row.id]),
  ]);

  const normalizedGenres = genres.map((g) => ({
    id: g.pivot_id || g.id,
    genre_id: g.genre_id || g.id,
    name: g.name,
    logo_path: g.logo_path || null,
  }));
  const genreslist = normalizedGenres.map((g) => g.name).filter(Boolean);
  const genresname =
    mediaType === 'movie'
      ? genreslist[0] || null
      : genreslist.join(', ');

  const hydrated = {
    ...row,
    genres: normalizedGenres,
    genreslist,
    genresname,
    casts,
    casterslist: casts,
    networks,
    networkslist: networks,
    spoken_languages,
    collections,
    belongs_to_collection: collections,
    certifications,
  };

  if (mediaType === 'movie') {
    const [videos, downloads, substitles] = await Promise.all([
      queryAll(
        `SELECT * FROM ${cfg.videoTable} WHERE ${cfg.videoFk} = ? ORDER BY COALESCE(position, sort_order, id) ASC`,
        [row.id]
      ),
      queryAll(
        `SELECT * FROM ${cfg.downloadTable} WHERE ${cfg.downloadFk} = ? ORDER BY COALESCE(sort_order, id) ASC`,
        [row.id]
      ),
      queryAll(`SELECT * FROM ${cfg.subtitleTable} WHERE ${cfg.subtitleFk} = ? ORDER BY id ASC`, [row.id]),
    ]);
    let substype = 0;
    for (let i = substitles.length - 1; i >= 0; i -= 1) {
      if (substitles[i]?.type) {
        substype = substitles[i].type;
        break;
      }
    }
    return {
      ...hydrated,
      substype,
      videos,
      downloads,
      substitles,
      subtitles: substitles,
    };
  }

  const rawSeasons = await queryAll(
    `SELECT * FROM ${cfg.seasonTable} WHERE ${cfg.seasonFk} = ? ORDER BY season_number ASC, id ASC`,
    [row.id]
  );

  const seasons = await Promise.all(
    rawSeasons.map(async (season) => {
      const epCountRow = await queryOne(
        `SELECT COUNT(*) AS c FROM ${cfg.episodeTable} WHERE ${cfg.episodeFk} = ?`,
        [season.id]
      );
      const episodes_count = Number(epCountRow?.c || 0);
      if (!includeEpisodes) return { ...season, episodes_count };
      const rawEpisodes = await queryAll(
        `SELECT * FROM ${cfg.episodeTable} WHERE ${cfg.episodeFk} = ? ORDER BY episode_number ASC, id ASC`,
        [season.id]
      );
      const episodes = await Promise.all(
        rawEpisodes.map(async (ep) => {
          const [videos, downloads, substitles] = await Promise.all([
            queryAll(
              `SELECT * FROM ${cfg.videoTable} WHERE ${cfg.videoFk} = ? ORDER BY COALESCE(position, sort_order, id) ASC`,
              [ep.id]
            ),
            queryAll(
              `SELECT * FROM ${cfg.downloadTable} WHERE ${cfg.downloadFk} = ? ORDER BY COALESCE(sort_order, id) ASC`,
              [ep.id]
            ),
            queryAll(`SELECT * FROM ${cfg.subtitleTable} WHERE ${cfg.subtitleFk} = ? ORDER BY id ASC`, [ep.id]),
          ]);
          return { ...ep, videos, downloads, substitles };
        })
      );
      return { ...season, episodes_count, episodes };
    })
  );

  return {
    ...hydrated,
    seasons,
    seasons_count: rawSeasons.length,
  };
}

export function normalizeDateValue(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s || s === '0000-00-00') return null;
  return s.slice(0, 10);
}

export async function fetchTmdbMetadata(
  kind,
  tmdbId,
  language = null,
  { includeEpisodes = false, includeSpecials = false } = {}
) {
  const { apiKey, imageBaseUrl } = await getTmdbConfig();
  if (!apiKey) {
    throw new Error('Configure a valid TMDB API key in Settings before using TMDB import.');
  }
  const tmdbType = kind === 'movie' ? 'movie' : 'tv';
  const params = {
    append_to_response: kind === 'movie'
      ? 'credits,videos,release_dates,external_ids'
      : 'credits,videos,content_ratings,external_ids',
  };
  if (language) params.language = language;
  const data = await tmdbGet(`/${tmdbType}/${tmdbId}`, params);

  if (tmdbType === 'tv' && includeEpisodes && Array.isArray(data.seasons)) {
    const targetSeasons = data.seasons
      .filter((s) => includeSpecials || Number(s.season_number) > 0)
      .sort((a, b) => Number(a.season_number) - Number(b.season_number));

    const hydratedSeasons = [];
    const batchSize = 5;
    for (let i = 0; i < targetSeasons.length; i += batchSize) {
      const batch = targetSeasons.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (s) => {
          try {
            const seasonDetail = await tmdbGet(
              `/tv/${tmdbId}/season/${Number(s.season_number)}`,
              language ? { language } : {}
            );
            const episodes = Array.isArray(seasonDetail?.episodes)
              ? seasonDetail.episodes.map((ep) => ({
                  id: ep.id,
                  tmdb_id: ep.id,
                  episode_number: Number(ep.episode_number || 1),
                  name: ep.name || `Episode ${ep.episode_number || 1}`,
                  overview: ep.overview || '',
                  still_path: ep.still_path ? `${imageBaseUrl.replace(/\/+$/, '')}${ep.still_path}` : '',
                  still_path_tv: ep.still_path ? `https://image.tmdb.org/t/p/original${ep.still_path}` : '',
                  air_date: normalizeDateValue(ep.air_date),
                  vote_average: Number(ep.vote_average || 0),
                  vote_count: Number(ep.vote_count || 0),
                  runtime: Number(ep.runtime || 0),
                }))
              : [];
            return {
              ...s,
              tmdb_id: s.id ?? null,
              poster_path: s.poster_path
                ? `${imageBaseUrl.replace(/\/+$/, '')}${s.poster_path}`
                : '',
              air_date: normalizeDateValue(s.air_date),
              episodes,
            };
          } catch {
            return {
              ...s,
              tmdb_id: s.id ?? null,
              poster_path: s.poster_path
                ? `${imageBaseUrl.replace(/\/+$/, '')}${s.poster_path}`
                : '',
              air_date: normalizeDateValue(s.air_date),
              episodes: [],
            };
          }
        })
      );
      hydratedSeasons.push(...batchResults);
    }

    data.seasons = hydratedSeasons;
  }

  return data;
}

export const OPENSUBTITLES_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-br', name: 'Portuguese (Brazil)' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh-cn', name: 'Chinese (Simplified)' },
  { code: 'zh-tw', name: 'Chinese (Traditional)' },
  { code: 'hi', name: 'Hindi' },
  { code: 'tr', name: 'Turkish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'cs', name: 'Czech' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
];
