import { Router } from 'express';
import { execute, nowIso, paginateQuery, queryAll, queryOne } from '../../db/sqlite.js';
import { requireAdminOrModerator, requirePermission } from '../../middleware/auth.js';
import { createDiskUpload, publicStorageUrl } from '../../middleware/upload.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

const uploadSubtitle = createDiskUpload('substitles');

// ================= SERVERS (QUALITIES) =================
router.get('/admin/servers/dataservers', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM servers ORDER BY id ASC`));
});

router.post('/admin/servers/store', requirePermission('servers_drm.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const now = nowIso();
  const result = await execute(`INSERT INTO servers (name, status, created_at, updated_at) VALUES (?, ?, ?, ?)`, [
    name,
    req.body?.status !== undefined ? (req.body.status ? 1 : 0) : 1,
    now,
    now,
  ]);
  return res.json({ status: 200, message: 'successfully created', body: await queryOne(`SELECT * FROM servers WHERE id = ?`, [Number(result.lastInsertRowid)]) });
});

router.put('/admin/servers/update/:server', requirePermission('servers_drm.edit'), async (req, res) => {
  const id = Number(req.params.server);
  const existing = await queryOne(`SELECT * FROM servers WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  await execute(`UPDATE servers SET name = ?, status = ?, updated_at = ? WHERE id = ?`, [
    String(req.body?.name ?? existing.name).trim(),
    req.body?.status !== undefined ? (req.body.status ? 1 : 0) : existing.status,
    nowIso(),
    id,
  ]);
  return res.json({ status: 200, message: 'successfully updated', body: await queryOne(`SELECT * FROM servers WHERE id = ?`, [id]) });
});

router.delete('/admin/servers/destroy/:server', requirePermission('servers_drm.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM servers WHERE id = ?`, [Number(req.params.server)]);
  return res.json({ status: result.changes ? 200 : 400, message: result.changes ? 'successfully deleted' : 'could not be deleted' });
});

// ================= DRM SERVERS =================
router.get('/admin/drmservers/drmdataservers', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM drms ORDER BY id DESC`));
});

router.get('/admin/drmservers/drmdataserversweb', async (req, res) => {
  return res.json(await paginateQuery({ baseFrom: 'FROM drms', orderBySql: 'created_at DESC, id DESC', page: req.query?.page || 1, perPage: 12 }));
});

router.post('/admin/drmservers/store', requirePermission('servers_drm.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const named = String(req.body?.named || req.body?.drmlicenceuri || '').trim();
  if (!name || !named) return res.status(422).json({ message: 'Both license label and license URL are required.' });
  const now = nowIso();
  const result = await execute(`INSERT INTO drms (name, named, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [
    name,
    named,
    req.body?.status !== undefined ? (req.body.status ? 1 : 0) : 1,
    now,
    now,
  ]);
  return res.json({ status: 200, message: 'successfully created', body: await queryOne(`SELECT * FROM drms WHERE id = ?`, [Number(result.lastInsertRowid)]) });
});

router.put('/admin/drmservers/update/:server', requirePermission('servers_drm.edit'), async (req, res) => {
  const id = Number(req.params.server);
  const existing = await queryOne(`SELECT * FROM drms WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  await execute(`UPDATE drms SET name = ?, named = ?, status = ?, updated_at = ? WHERE id = ?`, [
    String(req.body?.name ?? existing.name).trim(),
    String(req.body?.named ?? req.body?.drmlicenceuri ?? existing.named).trim(),
    req.body?.status !== undefined ? (req.body.status ? 1 : 0) : existing.status,
    nowIso(),
    id,
  ]);
  return res.json({ status: 200, message: 'successfully updated', body: await queryOne(`SELECT * FROM drms WHERE id = ?`, [id]) });
});

router.delete('/admin/drmservers/destroy/:server', requirePermission('servers_drm.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM drms WHERE id = ?`, [Number(req.params.server)]);
  return res.json({ status: result.changes ? 200 : 400, message: result.changes ? 'successfully deleted' : 'could not be deleted' });
});

// ================= HEADERS =================
router.get('/admin/headers/dataheaders', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM headers ORDER BY id DESC`));
});

router.post('/admin/headers/store', requirePermission('headers_user_agents.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const now = nowIso();
  const result = await execute(`INSERT INTO headers (name, status, created_at, updated_at) VALUES (?, 1, ?, ?)`, [name, now, now]);
  return res.json({ status: 200, message: 'successfully created', body: await queryOne(`SELECT * FROM headers WHERE id = ?`, [Number(result.lastInsertRowid)]) });
});

router.put('/admin/headers/update/:header', requirePermission('headers_user_agents.edit'), async (req, res) => {
  const id = Number(req.params.header);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  await execute(`UPDATE headers SET name = ?, updated_at = ? WHERE id = ?`, [name, nowIso(), id]);
  return res.json({ status: 200, message: 'successfully updated', body: await queryOne(`SELECT * FROM headers WHERE id = ?`, [id]) });
});

router.delete('/admin/headers/destroy/:header', requirePermission('headers_user_agents.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM headers WHERE id = ?`, [Number(req.params.header)]);
  return res.json({ status: result.changes ? 200 : 400, message: result.changes ? 'successfully deleted' : 'could not be deleted' });
});

// ================= USER AGENTS =================
router.get('/admin/useragents/datausersagent', async (req, res) => {
  return res.json(await paginateQuery({ baseFrom: 'FROM user_agents', orderBySql: 'created_at DESC, id DESC', page: req.query?.page || 1, perPage: 12 }));
});

router.get('/admin/useragents/datausersagentoptions', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM user_agents ORDER BY id DESC`));
});

router.post('/admin/useragents/store', requirePermission('headers_user_agents.create'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'The name field is required.' });
  const now = nowIso();
  const result = await execute(`INSERT INTO user_agents (name, url, created_at, updated_at) VALUES (?, ?, ?, ?)`, [
    name,
    req.body?.url || null,
    now,
    now,
  ]);
  return res.json({ status: 200, message: 'successfully created', body: await queryOne(`SELECT * FROM user_agents WHERE id = ?`, [Number(result.lastInsertRowid)]) });
});

router.put('/admin/useragents/update/:useragent', requirePermission('headers_user_agents.edit'), async (req, res) => {
  const id = Number(req.params.useragent);
  const existing = await queryOne(`SELECT * FROM user_agents WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  await execute(`UPDATE user_agents SET name = ?, url = ?, updated_at = ? WHERE id = ?`, [
    String(req.body?.name ?? existing.name).trim(),
    req.body?.url !== undefined ? req.body.url : existing.url,
    nowIso(),
    id,
  ]);
  return res.json({ status: 200, message: 'successfully updated', body: await queryOne(`SELECT * FROM user_agents WHERE id = ?`, [id]) });
});

router.delete('/admin/useragents/destroy/:header', requirePermission('headers_user_agents.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM user_agents WHERE id = ?`, [Number(req.params.header)]);
  return res.json({ status: result.changes ? 200 : 400, message: result.changes ? 'successfully deleted' : 'could not be deleted' });
});

// ================= SUBTITLES =================
router.get('/admin/substitles/data', async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM movie_substitles ORDER BY id DESC`));
});

router.post('/admin/substitle/store', uploadSubtitle.single('substitle'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 400, message: 'could not be uploaded' });
  }
  return res.json({
    status: 200,
    substitle_path: publicStorageUrl(req, '/api/substitle', req.file.filename),
    server: 'Own',
    message: 'successfully uploaded',
  });
});

router.put('/admin/substitles/update/:substitle', async (req, res) => {
  const id = Number(req.params.substitle);
  const existing = await queryOne(`SELECT * FROM movie_substitles WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'Not found' });
  await execute(
    `UPDATE movie_substitles SET link = ?, lang = ?, type = ?, zip = ?, status = ?, updated_at = ? WHERE id = ?`,
    [
      req.body?.link ?? existing.link,
      req.body?.lang ?? existing.lang,
      req.body?.type ?? existing.type,
      req.body?.zip !== undefined ? (req.body.zip ? 1 : 0) : existing.zip,
      req.body?.status !== undefined ? (req.body.status ? 1 : 0) : existing.status,
      nowIso(),
      id,
    ]
  );
  return res.json({ status: 200, message: 'successfully updated', body: await queryOne(`SELECT * FROM movie_substitles WHERE id = ?`, [id]) });
});

export default router;
