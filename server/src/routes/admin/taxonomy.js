import { Router } from 'express';
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
import { requireAdminOrModerator, requirePermission } from '../../middleware/auth.js';
import { createDiskUpload, publicStorageUrl } from '../../middleware/upload.js';
import { tmdbGet } from '../../services/tmdb.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

const uploadLangImg = createDiskUpload('languages');
const uploadCastImg = createDiskUpload('casts');

// ================= GENRES =================
router.get('/admin/genres/datagenres', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM genres ORDER BY name ASC`));
});

router.post('/admin/genres/store', requirePermission('genres.create'), async (req, res) => {
  const name = String(req.body?.name || req.body?.genre?.name || '').trim();
  const logoPath = req.body?.logo_path ?? req.body?.genre?.logo_path ?? null;
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const exists = await queryOne(`SELECT id FROM genres WHERE lower(name) = ?`, [name.toLowerCase()]);
  if (exists) return res.status(422).json({ message: 'The name has already been taken.' });

  const now = nowIso();
  const result = await execute(
    `INSERT INTO genres (name, logo_path, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [name, logoPath ? String(logoPath).trim() : null, now, now]
  );
  const body = await queryOne(`SELECT * FROM genres WHERE id = ?`, [Number(result.lastInsertRowid)]);
  return res.json({ status: 200, message: 'successfully created', body });
});

router.post('/admin/genres/fetch', requirePermission('genres.create'), async (req, res) => {
  try {
    let movieGenres = req.body?.movies?.genres || [];
    let tvGenres = req.body?.series?.genres || [];

    if (!movieGenres.length && !tvGenres.length) {
      const [mRes, tRes] = await Promise.all([
        tmdbGet('/genre/movie/list'),
        tmdbGet('/genre/tv/list'),
      ]);
      movieGenres = mRes.genres || [];
      tvGenres = tRes.genres || [];
    }

    const now = nowIso();
    const allGenres = [...movieGenres, ...tvGenres];
    await runInTransaction(async () => {
      for (const g of allGenres) {
        if (!g?.id || !g?.name) continue;
        if (isMySql()) {
          await execute(
            `INSERT INTO genres (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = VALUES(updated_at)`,
            [Number(g.id), String(g.name).trim(), now, now]
          );
        } else {
          await execute(
            `INSERT INTO genres (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
            [Number(g.id), String(g.name).trim(), now, now]
          );
        }
      }
    });

    return res.json({
      status: 200,
      message: 'successfully updated',
      body: await queryAll(`SELECT * FROM genres ORDER BY name ASC`),
    });
  } catch (err) {
    return res.status(422).json({ status: 422, message: err.message });
  }
});

router.put('/admin/genres/update/:genre', requirePermission('genres.edit'), async (req, res) => {
  const id = Number(req.params.genre);
  const existing = await queryOne(`SELECT * FROM genres WHERE id = ?`, [id]);
  if (!existing) return res.status(400).json({ status: 400, message: 'could not be updated' });

  const name = String(req.body?.name ?? existing.name ?? '').trim();
  const logoPath = req.body?.logo_path !== undefined ? req.body.logo_path : existing.logo_path;
  await execute(`UPDATE genres SET name = ?, logo_path = ?, updated_at = ? WHERE id = ?`, [
    name,
    logoPath || null,
    nowIso(),
    id,
  ]);
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM genres WHERE id = ?`, [id]),
  });
});

router.delete('/admin/genres/destroy/:genre', requirePermission('genres.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM genres WHERE id = ?`, [Number(req.params.genre)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= STREAMING CATEGORIES =================
router.get('/admin/categories/data', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM categories ORDER BY id DESC`));
});

router.post('/admin/categories/store', requirePermission('streaming_categories.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const exists = await queryOne(`SELECT id FROM categories WHERE lower(name) = ?`, [name.toLowerCase()]);
  if (exists) return res.status(422).json({ message: 'The name has already been taken.' });

  const now = nowIso();
  const result = await execute(`INSERT INTO categories (name, created_at, updated_at) VALUES (?, ?, ?)`, [
    name,
    now,
    now,
  ]);
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM categories WHERE id = ?`, [Number(result.lastInsertRowid)]),
  });
});

router.put('/admin/categories/update/:genre', requirePermission('streaming_categories.edit'), async (req, res) => {
  const id = Number(req.params.genre);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  await execute(`UPDATE categories SET name = ?, updated_at = ? WHERE id = ?`, [name, nowIso(), id]);
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM categories WHERE id = ?`, [id]),
  });
});

router.delete('/admin/categories/destroy/:genre', requirePermission('streaming_categories.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM categories WHERE id = ?`, [Number(req.params.genre)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= COLLECTIONS =================
router.get('/admin/collections/datawebcollections', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM collections ORDER BY created_at DESC, id DESC`));
});

router.post('/admin/collections/store', requirePermission('collections.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const now = nowIso();
  const result = await execute(
    `INSERT INTO collections (name, poster_path, backdrop_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [name, req.body?.poster_path || null, req.body?.backdrop_path || null, now, now]
  );
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM collections WHERE id = ?`, [Number(result.lastInsertRowid)]),
  });
});

router.put('/admin/collections/update/:collection', requirePermission('collections.edit'), async (req, res) => {
  const id = Number(req.params.collection);
  const existing = await queryOne(`SELECT * FROM collections WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  await execute(
    `UPDATE collections SET name = ?, poster_path = ?, backdrop_path = ?, updated_at = ? WHERE id = ?`,
    [
      String(req.body?.name ?? existing.name).trim(),
      req.body?.poster_path !== undefined ? req.body.poster_path : existing.poster_path,
      req.body?.backdrop_path !== undefined ? req.body.backdrop_path : existing.backdrop_path,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM collections WHERE id = ?`, [id]),
  });
});

router.delete('/admin/collections/destroy/:collection', requirePermission('collections.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM collections WHERE id = ?`, [Number(req.params.collection)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= NETWORKS =================
const listNetworks = async (_req, res) =>
  res.json(await queryAll(`SELECT * FROM networks ORDER BY created_at DESC, id DESC`));
router.get('/admin/networks/datanetworks', listNetworks);
router.get('/admin/networks/datawebnetworks', listNetworks);

router.post('/admin/networks/store', requirePermission('networks.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const originCountry = req.body?.origin_country ? String(req.body.origin_country).trim().toUpperCase() : null;
  const now = nowIso();
  const result = await execute(
    `INSERT INTO networks (name, logo_path, origin_country, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [name, req.body?.logo_path || null, originCountry, now, now]
  );
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM networks WHERE id = ?`, [Number(result.lastInsertRowid)]),
  });
});

router.put('/admin/networks/update/:network', requirePermission('networks.edit'), async (req, res) => {
  const id = Number(req.params.network);
  const existing = await queryOne(`SELECT * FROM networks WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  const originCountry = req.body?.origin_country !== undefined
    ? (req.body.origin_country ? String(req.body.origin_country).trim().toUpperCase() : null)
    : existing.origin_country;
  await execute(
    `UPDATE networks SET name = ?, logo_path = ?, origin_country = ?, updated_at = ? WHERE id = ?`,
    [
      String(req.body?.name ?? existing.name).trim(),
      req.body?.logo_path !== undefined ? req.body.logo_path : existing.logo_path,
      originCountry,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM networks WHERE id = ?`, [id]),
  });
});

router.delete('/admin/networks/destroy/:network', requirePermission('networks.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM networks WHERE id = ?`, [Number(req.params.network)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= CERTIFICATIONS =================
router.get('/admin/certification/data', async (req, res) => {
  const search = String(req.query?.search || '').trim();
  const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 12)));
  const page = Math.max(1, Number(req.query?.page || 1));
  const allowedSort = ['id', 'country_code', 'certification', 'meaning', 'order', 'created_at', 'updated_at'];
  const sortBy = allowedSort.includes(req.query?.sort_by) ? req.query.sort_by : 'country_code';
  const sortOrder = String(req.query?.sort_order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const whereParts = [];
  const params = [];
  if (search) {
    whereParts.push(`(country_code LIKE ? OR certification LIKE ? OR meaning LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const orderSql = sortBy === 'order' ? `\`order\` ${sortOrder}` : `${sortBy} ${sortOrder}`;
  const result = await paginateQuery({
    baseFrom: 'FROM certifications',
    whereSql: whereParts.join(' AND '),
    params,
    orderBySql: `${orderSql}, id ASC`,
    page,
    perPage,
    mapRow: (r) => ({ ...r, name: `${r.country_code || ''} - ${r.certification || ''}` }),
  });
  return res.json(result);
});

router.get('/admin/certification/datacertifications', async (_req, res) => {
  const rows = (await queryAll(`SELECT * FROM certifications ORDER BY country_code ASC, \`order\` ASC`)).map((r) => ({
    ...r,
    name: `${r.country_code || ''} - ${r.certification || ''}`,
  }));
  return res.json(rows);
});

const fetchCertificationsHandler = async (req, res) => {
  try {
    let certMap = req.body?.certifications;
    if (!certMap || typeof certMap !== 'object') {
      const data = await tmdbGet('/certification/movie/list');
      certMap = data?.certifications || {};
    }

    const now = nowIso();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    await runInTransaction(async () => {
      for (const [country, items] of Object.entries(certMap)) {
        if (!Array.isArray(items)) continue;
        const cc = String(country).toUpperCase();
        for (const item of items) {
          const cert = String(item?.certification || '').trim();
          if (!cert) {
            skipped++;
            continue;
          }
          const existing = await queryOne(
            `SELECT id FROM certifications WHERE country_code = ? AND certification = ?`,
            [cc, cert]
          );
          if (existing) {
            await execute(
              `UPDATE certifications SET meaning = ?, \`order\` = ?, updated_at = ? WHERE id = ?`,
              [item?.meaning || '', Number(item?.order ?? 0), now, existing.id]
            );
            updated++;
          } else {
            await execute(
              `INSERT INTO certifications (country_code, certification, meaning, \`order\`, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [cc, cert, item?.meaning || '', Number(item?.order ?? 0), now, now]
            );
            inserted++;
          }
        }
      }
    });

    return res.json({ message: 'Certifications synchronized successfully.', inserted, updated, skipped });
  } catch (err) {
    return res.status(422).json({ message: err.message });
  }
};

router.post('/admin/certification/fetch', requirePermission('certifications.create'), fetchCertificationsHandler);
router.post('/admin/certifications/fetch', requirePermission('certifications.create'), fetchCertificationsHandler);

const storeCertHandler = async (req, res) => {
  const payload = req.body?.certification && typeof req.body.certification === 'object' ? req.body.certification : req.body;
  const cc = String(payload?.country_code || '').trim().toUpperCase();
  const cert = String(payload?.certification || '').trim();
  const meaning = String(payload?.meaning || '').trim();
  const order = Number(payload?.order ?? 0);
  if (!cc || !cert) return res.status(422).json({ message: 'Country code and certification are required.' });

  const now = nowIso();
  const result = await execute(
    `INSERT INTO certifications (country_code, certification, meaning, \`order\`, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [cc, cert, meaning, order, now, now]
  );
  const body = await queryOne(`SELECT * FROM certifications WHERE id = ?`, [Number(result.lastInsertRowid)]);
  return res.json({ status: 200, message: 'successfully created', body });
};
router.post('/admin/certification/store', requirePermission('certifications.create'), storeCertHandler);
router.post('/admin/certifications/store', requirePermission('certifications.create'), storeCertHandler);

const updateCertHandler = async (req, res) => {
  const id = Number(req.params.certification || req.params.genre);
  const existing = await queryOne(`SELECT * FROM certifications WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  const payload = req.body?.certification && typeof req.body.certification === 'object' ? req.body.certification : req.body;

  await execute(
    `UPDATE certifications SET country_code = ?, certification = ?, meaning = ?, \`order\` = ?, updated_at = ? WHERE id = ?`,
    [
      String(payload?.country_code ?? existing.country_code).trim().toUpperCase(),
      String(payload?.certification ?? existing.certification).trim(),
      String(payload?.meaning ?? existing.meaning ?? '').trim(),
      Number(payload?.order ?? existing.order ?? 0),
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM certifications WHERE id = ?`, [id]),
  });
};
router.put('/admin/certifications/update/:certification', requirePermission('certifications.edit'), updateCertHandler);

const deleteCertHandler = async (req, res) => {
  const id = Number(req.params.certification || req.params.genre);
  const result = await execute(`DELETE FROM certifications WHERE id = ?`, [id]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
};
router.delete('/admin/certifications/destroy/:certification', requirePermission('certifications.delete'), deleteCertHandler);
router.delete('/admin/certification/delete-all-records', requirePermission('certifications.delete'), async (_req, res) => {
  await execute(`DELETE FROM certifications`);
  return res.json({ message: 'All records deleted successfully' });
});

// ================= LANGUAGES =================
router.get('/admin/languages/admindata', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM languages',
      orderBySql: 'featured DESC, english_name ASC',
      page: req.query?.page || 1,
      perPage: 12,
    })
  );
});

router.get('/admin/languages/data', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM languages ORDER BY featured DESC, english_name ASC`));
});

router.get('/admin/languages/tmdb', async (_req, res) => {
  try {
    const list = await tmdbGet('/configuration/languages');
    return res.json(Array.isArray(list) ? list : []);
  } catch {
    return res.json([
      { iso_639_1: 'en', english_name: 'English', name: 'English' },
      { iso_639_1: 'es', english_name: 'Spanish', name: 'Español' },
      { iso_639_1: 'fr', english_name: 'French', name: 'Français' },
      { iso_639_1: 'de', english_name: 'German', name: 'Deutsch' },
      { iso_639_1: 'it', english_name: 'Italian', name: 'Italiano' },
      { iso_639_1: 'pt', english_name: 'Portuguese', name: 'Português' },
      { iso_639_1: 'ja', english_name: 'Japanese', name: '日本語' },
      { iso_639_1: 'ko', english_name: 'Korean', name: '한국어/조선말' },
      { iso_639_1: 'ar', english_name: 'Arabic', name: 'العربية' },
      { iso_639_1: 'hi', english_name: 'Hindi', name: 'हिन्दी' },
      { iso_639_1: 'tr', english_name: 'Turkish', name: 'Türkçe' },
      { iso_639_1: 'ru', english_name: 'Russian', name: 'Pусский' },
      { iso_639_1: 'zh', english_name: 'Mandarin', name: '普通话' },
    ]);
  }
});

router.post('/admin/languages/store', requirePermission('languages.create'), async (req, res) => {
  const payload = req.body?.language || req.body;
  const iso = String(payload?.iso_639_1 || '').trim().toLowerCase();
  const englishName = String(payload?.english_name || payload?.name || '').trim();
  if (!iso || !englishName) return res.status(422).json({ message: 'ISO code and English name are required.' });
  const now = nowIso();

  const existing = await queryOne(`SELECT id FROM languages WHERE iso_639_1 = ?`, [iso]);
  if (existing) {
    await execute(
      `UPDATE languages SET english_name = ?, name = ?, logo_path = ?, featured = ?, updated_at = ? WHERE id = ?`,
      [englishName, payload?.name || englishName, payload?.logo_path || null, payload?.featured ? 1 : 0, now, existing.id]
    );
  } else {
    await execute(
      `INSERT INTO languages (iso_639_1, english_name, name, logo_path, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [iso, englishName, payload?.name || englishName, payload?.logo_path || null, payload?.featured ? 1 : 0, now, now]
    );
  }
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM languages WHERE iso_639_1 = ?`, [iso]),
  });
});

router.post('/admin/languages/fetch', requirePermission('languages.create'), async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (Array.isArray(req.body?.languages) ? req.body.languages : []);
  const now = nowIso();
  const ignoreVerb = isMySql() ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';
  await runInTransaction(async () => {
    for (const item of items) {
      const iso = String(item?.iso_639_1 || '').trim().toLowerCase();
      const eng = String(item?.english_name || item?.name || '').trim();
      if (!iso || !eng) continue;
      await execute(
        `${ignoreVerb} languages (iso_639_1, english_name, name, featured, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [iso, eng, item?.name || eng, now, now]
      );
    }
  });
  return res.json({ status: 200, message: 'Languages imported successfully.' });
});

router.put('/admin/languages/update/:lang', requirePermission('languages.edit'), async (req, res) => {
  const id = Number(req.params.lang);
  const existing = await queryOne(`SELECT * FROM languages WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  const payload = req.body?.language || req.body;
  await execute(
    `UPDATE languages SET iso_639_1 = ?, english_name = ?, name = ?, logo_path = ?, featured = ?, updated_at = ? WHERE id = ?`,
    [
      String(payload?.iso_639_1 ?? existing.iso_639_1).trim().toLowerCase(),
      String(payload?.english_name ?? existing.english_name).trim(),
      String(payload?.name ?? existing.name ?? '').trim(),
      payload?.logo_path !== undefined ? payload.logo_path : existing.logo_path,
      payload?.featured !== undefined ? (payload.featured ? 1 : 0) : existing.featured,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM languages WHERE id = ?`, [id]),
  });
});

router.delete('/admin/languages/destroy/:langs', requirePermission('languages.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM languages WHERE id = ?`, [Number(req.params.langs)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

router.post('/admin/languages/image/store', requirePermission('languages.create'), uploadLangImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'could not be uploaded' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/languages/image', req.file.filename),
    message: 'image uploaded successfully',
  });
});

// ================= CASTERS / PEOPLE =================
router.get('/admin/casters/datacasters', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM casts',
      orderBySql: 'created_at DESC, id DESC',
      page: req.query?.page || 1,
      perPage: 12,
    })
  );
});

router.get('/admin/casters/datawebcaster', async (req, res) => {
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM casts',
      orderBySql: 'id DESC',
      page: req.query?.page || 1,
      perPage: 12,
    })
  );
});

router.post('/admin/casts/store', requirePermission('casters.create'), async (req, res) => {
  const payload = req.body?.caster || req.body;
  const name = String(payload?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const now = nowIso();
  const result = await execute(
    `INSERT INTO casts (name, original_name, gender, place_of_birth, profile_path, imdb_id, known_for_department, biography, \`character\`, birthday, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      payload?.original_name || name,
      payload?.gender ?? null,
      payload?.place_of_birth || null,
      payload?.profile_path || null,
      payload?.imdb_id || null,
      payload?.known_for_department || 'Acting',
      payload?.biography || null,
      payload?.character || null,
      payload?.birthday || null,
      payload?.active !== undefined ? (payload.active ? 1 : 0) : 1,
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM casts WHERE id = ?`, [Number(result.lastInsertRowid)]),
  });
});

const updateCastHandler = async (req, res) => {
  const id = Number(req.params.cast);
  const existing = await queryOne(`SELECT * FROM casts WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  const payload = req.body?.caster || req.body;
  await execute(
    `UPDATE casts SET name = ?, original_name = ?, place_of_birth = ?, profile_path = ?, biography = ?, birthday = ?, \`character\` = ?, known_for_department = ?, active = ?, updated_at = ? WHERE id = ?`,
    [
      String(payload?.name ?? existing.name).trim(),
      payload?.original_name !== undefined ? payload.original_name : existing.original_name,
      payload?.place_of_birth !== undefined ? payload.place_of_birth : existing.place_of_birth,
      payload?.profile_path !== undefined ? payload.profile_path : existing.profile_path,
      payload?.biography !== undefined ? payload.biography : existing.biography,
      payload?.birthday !== undefined ? payload.birthday : existing.birthday,
      payload?.character !== undefined ? payload.character : existing.character,
      payload?.known_for_department !== undefined ? payload.known_for_department : existing.known_for_department,
      payload?.active !== undefined ? (payload.active ? 1 : 0) : existing.active,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM casts WHERE id = ?`, [id]),
  });
};
router.put('/admin/casters/updatecast/:cast', requirePermission('casters.edit'), updateCastHandler);
router.put('/admin/casts/update/:cast', requirePermission('casters.edit'), updateCastHandler);

router.delete('/admin/casts/destroy/:genre', requirePermission('casters.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM casts WHERE id = ?`, [Number(req.params.genre)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

router.post('/admin/casts/image/store', requirePermission('casters.create'), uploadCastImg.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'could not be uploaded' });
  return res.json({
    status: 200,
    image_path: publicStorageUrl(req, '/api/casts/image', req.file.filename),
    message: 'image uploaded successfully',
  });
});

// TMDB person helper
router.get('/admin/tmdb/person/:id', async (req, res) => {
  try {
    const data = await tmdbGet(`/person/${Number(req.params.id)}`);
    return res.json(data);
  } catch (err) {
    return res.status(422).json({ message: err.message });
  }
});

export default router;
