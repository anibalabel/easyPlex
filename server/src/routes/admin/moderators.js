import { Router } from 'express';
import {
  execute,
  hasColumn,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/sqlite.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import { requireAdminOnly } from '../../middleware/auth.js';
import { hashPassword } from '../../services/crypto.js';

const router = makeAsyncRouter(Router());
router.use(['/admin/moderators', '/api/admin/moderators'], requireAdminOnly);

async function moderatorPayload(user) {
  if (!user) return null;
  const perms = await queryAll(
    `SELECT p.id, p.\`key\`, p.module, p.action, p.label
     FROM permissions p
     JOIN moderator_permissions mp ON mp.permission_id = p.id
     WHERE mp.user_id = ?`,
    [user.id]
  );
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    active: Boolean(Number(user.active)),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    permissions: perms.map((p) => p.key),
    permission_objects: perms,
  };
}

async function syncModeratorPermissions(actorId, moderatorId, permissionKeys = []) {
  const prevRows = await queryAll(
    `SELECT p.\`key\` FROM permissions p JOIN moderator_permissions mp ON mp.permission_id = p.id WHERE mp.user_id = ?`,
    [moderatorId]
  );
  const prev = prevRows.map((r) => r.key);

  const uniqueKeys = [...new Set((Array.isArray(permissionKeys) ? permissionKeys : []).map(String))];
  const permRows = uniqueKeys.length
    ? await queryAll(
        `SELECT id, \`key\` FROM permissions WHERE \`key\` IN (${uniqueKeys.map(() => '?').join(',')})`,
        uniqueKeys
      )
    : [];

  const now = nowIso();
  await execute(`DELETE FROM moderator_permissions WHERE user_id = ?`, [moderatorId]);
  for (const row of permRows) {
    await execute(
      `INSERT INTO moderator_permissions (user_id, permission_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [moderatorId, row.id, now, now]
    );
  }

  await execute(
    `INSERT INTO moderator_permission_audits (actor_id, moderator_id, old_permissions, new_permissions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorId || null, moderatorId, JSON.stringify(prev), JSON.stringify(permRows.map((r) => r.key)), now, now]
  );
}

const listModerators = async (req, res) => {
  const search = String(req.query?.search || '').trim();
  const where = [`role = 'moderator'`];
  const params = [];
  if (search) {
    where.push(`(name LIKE ? OR email LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  return res.json(
    await paginateQuery({
      baseFrom: 'FROM users',
      whereSql: where.join(' AND '),
      params,
      orderBySql: 'created_at DESC, id DESC',
      page: req.query?.page || 1,
      perPage: 12,
      mapRow: moderatorPayload,
    })
  );
};

const listEligibleUsers = async (req, res) => {
  const search = String(req.query?.search || '').trim();
  const where = [`role = 'user'`];
  const params = [];
  if (search) {
    where.push(`(name LIKE ? OR email LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  const rows = (
    await queryAll(
      `SELECT id, name, email, active, created_at FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 20`,
      params
    )
  ).map((u) => ({ ...u, active: Boolean(Number(u.active)) }));
  return res.json(rows);
};

const storeModerator = async (req, res) => {
  const { user_id, name, email, password, active = true, permissions = [] } = req.body || {};
  const now = nowIso();
  const hasVerifiedCol = await hasColumn('users', 'verified');

  let modId;
  try {
    await runInTransaction(async () => {
      if (user_id) {
        const existing = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'user'`, [Number(user_id)]);
        if (!existing) throw new Error('Eligible user not found.');
        await execute(`UPDATE users SET role = 'moderator', active = ?, updated_at = ? WHERE id = ?`, [
          active ? 1 : 0,
          now,
          existing.id,
        ]);
        modId = existing.id;
      } else {
        const cleanEmail = String(email || '').trim().toLowerCase();
        if (!name || !cleanEmail || !password) {
          throw new Error('Name, email, and password are required.');
        }
        if (await queryOne(`SELECT id FROM users WHERE lower(email) = ?`, [cleanEmail])) {
          throw new Error('Email already exists.');
        }
        const cols = ['role', 'name', 'email', 'premuim', 'verfied'];
        const vals = ['moderator', String(name).trim(), cleanEmail, 0, 1];
        if (hasVerifiedCol) {
          cols.push('verified');
          vals.push(1);
        }
        cols.push('active', 'email_verified_at', 'password', 'created_at', 'updated_at');
        vals.push(active ? 1 : 0, now, hashPassword(password), now, now);

        const inserted = await execute(
          `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          vals
        );
        modId = Number(inserted.lastInsertRowid);
      }
      await syncModeratorPermissions(req.user.id, modId, permissions);
    });
  } catch (err) {
    return res.status(422).json({ message: err.message });
  }

  return res.status(201).json(await moderatorPayload(await queryOne(`SELECT * FROM users WHERE id = ?`, [modId])));
};

const showModerator = async (req, res) => {
  const user = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'moderator'`, [Number(req.params.moderator)]);
  if (!user) return res.status(404).json({ message: 'Moderator not found.' });
  return res.json(await moderatorPayload(user));
};

const updateModerator = async (req, res) => {
  const id = Number(req.params.moderator);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'moderator'`, [id]);
  if (!existing) return res.status(404).json({ message: 'Moderator not found.' });
  const { name, email, password, active, permissions } = req.body || {};
  const cleanEmail = String(email ?? existing.email).trim().toLowerCase();
  if (await queryOne(`SELECT id FROM users WHERE lower(email) = ? AND id != ?`, [cleanEmail, id])) {
    return res.status(422).json({ message: 'Email already in use.' });
  }
  await runInTransaction(async () => {
    await execute(
      `UPDATE users SET name = ?, email = ?, active = ?, password = ?, updated_at = ? WHERE id = ?`,
      [
        String(name ?? existing.name).trim(),
        cleanEmail,
        active !== undefined ? (active ? 1 : 0) : existing.active,
        password ? hashPassword(password) : existing.password,
        nowIso(),
        id,
      ]
    );
    if (Array.isArray(permissions)) {
      await syncModeratorPermissions(req.user.id, id, permissions);
    }
  });
  return res.json(await moderatorPayload(await queryOne(`SELECT * FROM users WHERE id = ?`, [id])));
};

const destroyModerator = async (req, res) => {
  const id = Number(req.params.moderator);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'moderator'`, [id]);
  if (!existing) return res.status(404).json({ message: 'Moderator not found.' });
  await runInTransaction(async () => {
    await syncModeratorPermissions(req.user.id, id, []);
    await execute(`UPDATE users SET role = 'user', updated_at = ? WHERE id = ?`, [nowIso(), id]);
  });
  return res.json({ message: 'Moderator access removed.' });
};

const statusModerator = async (req, res) => {
  const id = Number(req.params.moderator);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'moderator'`, [id]);
  if (!existing) return res.status(404).json({ message: 'Moderator not found.' });
  await execute(`UPDATE users SET active = ?, updated_at = ? WHERE id = ?`, [req.body?.active ? 1 : 0, nowIso(), id]);
  return res.json(await moderatorPayload(await queryOne(`SELECT * FROM users WHERE id = ?`, [id])));
};

const updateModeratorPermissions = async (req, res) => {
  const id = Number(req.params.moderator);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ? AND role = 'moderator'`, [id]);
  if (!existing) return res.status(404).json({ message: 'Moderator not found.' });
  await runInTransaction(async () => {
    await syncModeratorPermissions(req.user.id, id, req.body?.permissions || []);
  });
  return res.json(await moderatorPayload(await queryOne(`SELECT * FROM users WHERE id = ?`, [id])));
};

for (const prefix of ['/admin/moderators', '/api/admin/moderators']) {
  router.get(`${prefix}/data`, listModerators);
  if (prefix === '/api/admin/moderators') {
    router.get(`${prefix}`, listModerators);
  }
  router.get(`${prefix}/eligible-users`, listEligibleUsers);
  router.post(`${prefix}`, storeModerator);
  router.get(`${prefix}/:moderator`, showModerator);
  router.put(`${prefix}/:moderator`, updateModerator);
  router.delete(`${prefix}/:moderator`, destroyModerator);
  router.patch(`${prefix}/:moderator/status`, statusModerator);
  router.put(`${prefix}/:moderator/permissions`, updateModeratorPermissions);
}

router.get('/admin/moderators/audits/list', requireAdminOnly, async (_req, res) => {
  const rows = await queryAll(
    `SELECT a.*, actor.name AS actor_name, mod_u.name AS moderator_name
     FROM moderator_permission_audits a
     LEFT JOIN users actor ON actor.id = a.actor_id
     LEFT JOIN users mod_u ON mod_u.id = a.moderator_id
     ORDER BY a.id DESC LIMIT 50`
  );
  return res.json(rows);
});

export default router;
