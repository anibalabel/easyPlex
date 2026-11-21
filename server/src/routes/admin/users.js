import { Router } from 'express';
import {
  execute,
  hasColumn,
  nowIso,
  paginateQuery,
  queryAll,
  queryOne,
  runInTransaction,
} from '../../db/mysql.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import { requireAdminOrModerator, requirePermission, sanitizeUser } from '../../middleware/auth.js';
import { createDiskUpload, publicStorageUrl } from '../../middleware/upload.js';
import { hashPassword, randomHex } from '../../services/crypto.js';
import { activateSubscriptionForUser } from '../../services/subscriptions.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

const uploadAvatar = createDiskUpload('avatars');

async function enrichAdminUser(user) {
  if (!user) return null;
  const safe = sanitizeUser(user);
  const [profilesRow, devicesRow, credit] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS c FROM profiles WHERE user_id = ?`, [user.id]),
    queryOne(`SELECT COUNT(*) AS c FROM devices WHERE user_id = ?`, [user.id]),
    queryOne(`SELECT balance, total_purchased, total_spent FROM user_credits WHERE user_id = ?`, [user.id]),
  ]);
  const isVerified = Boolean(Number(user.verfied ?? user.verified ?? 0));
  return {
    ...safe,
    premuim: Boolean(Number(user.premuim)),
    verfied: isVerified,
    verified: isVerified,
    active: Boolean(Number(user.active)),
    profiles_count: Number(profilesRow?.c || 0),
    devices_count: Number(devicesRow?.c || 0),
    credit_balance: Number(credit?.balance || 0),
    is_protected: user.email === 'admin@easyplex.com',
  };
}

// Account endpoints
router.get('/admin/account/data', async (req, res) => {
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  return res.json(await enrichAdminUser(user));
});

router.put('/admin/account/update', async (req, res) => {
  const payload = req.body?.user || req.body;
  const name = String(payload?.name || req.user.name).trim();
  const email = String(payload?.email || req.user.email).trim().toLowerCase();
  const avatar = payload?.avatar !== undefined ? payload.avatar : req.user.avatar;
  const phone = payload?.phone !== undefined ? payload.phone : req.user.phone;

  const conflict = await queryOne(`SELECT id FROM users WHERE lower(email) = ? AND id != ?`, [email, req.user.id]);
  if (conflict) return res.status(422).json({ message: 'Email already in use.' });

  const sets = ['name = ?', 'email = ?', 'avatar = ?'];
  const vals = [name, email, avatar || null];
  if (await hasColumn('users', 'phone')) {
    sets.push('phone = ?');
    vals.push(phone || null);
  }
  sets.push('updated_at = ?');
  vals.push(nowIso(), req.user.id);

  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  const refreshed = await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  return res.json({ status: 200, message: 'successfully updated', user: await enrichAdminUser(refreshed) });
});

router.put('/admin/account/password/update', async (req, res) => {
  const payload = req.body?.user || req.body;
  const password = String(payload?.password || '');
  if (password.length < 6) return res.status(422).json({ message: 'Password must be at least 6 characters.' });
  await execute(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [
    hashPassword(password),
    nowIso(),
    req.user.id,
  ]);
  return res.json({ status: 200, message: 'Password updated successfully.' });
});

router.put('/admin/account/passwordApp/update', async (req, res) => {
  const password = String(req.body?.password || req.body?.app_password || '').trim();
  if (!password) return res.status(422).json({ message: 'App password is required.' });
  await execute(`UPDATE settings SET password = ?, updated_at = ? WHERE id = 1`, [password, nowIso()]);
  return res.json({ status: 200, message: 'App password updated successfully.' });
});

router.put('/admin/account/password/updateUser', requirePermission('users.edit'), async (req, res) => {
  const userId = Number(req.body?.user_id || req.body?.id);
  const password = String(req.body?.password || '');
  if (!userId || password.length < 6) {
    return res.status(422).json({ message: 'Valid user ID and password (>= 6 chars) required.' });
  }
  await execute(`UPDATE users SET password = ?, updated_at = ? WHERE id = ?`, [
    hashPassword(password),
    nowIso(),
    userId,
  ]);
  return res.json({ status: 200, message: 'User password updated successfully.' });
});

router.post('/admin/update/avatar', uploadAvatar.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ status: 400, message: 'could not be uploaded' });
  const imagePath = publicStorageUrl(req, '/api/avatars/image', req.file.filename);
  await execute(`UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?`, [imagePath, nowIso(), req.user.id]);
  return res.json({ status: 200, image_path: imagePath, message: 'Avatar updated successfully' });
});

// Users CRUD
router.get('/admin/users/data', async (req, res) => {
  return res.json(await enrichAdminUser(await queryOne(`SELECT * FROM users WHERE id = ?`, [req.user.id])));
});

router.get('/admin/users/allusers', requirePermission('users.view'), async (req, res) => {
  const search = String(req.query?.q || req.query?.search || '').trim();
  const role = String(req.query?.role || '').trim();
  const premium = req.query?.premuim ?? req.query?.premium;
  const active = req.query?.active;

  const where = [];
  const params = [];
  if (search) {
    where.push(`(name LIKE ? OR email LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (role) {
    where.push(`role = ?`);
    params.push(role);
  }
  if (premium === '1' || premium === 'true') where.push(`premuim = 1`);
  if (premium === '0' || premium === 'false') where.push(`premuim = 0`);
  if (active === '1' || active === 'true') where.push(`active = 1`);
  if (active === '0' || active === 'false') where.push(`active = 0`);

  const result = await paginateQuery({
    baseFrom: 'FROM users',
    whereSql: where.join(' AND '),
    params,
    orderBySql: 'created_at DESC, id DESC',
    page: req.query?.page || 1,
    perPage: req.query?.per_page || 12,
    mapRow: enrichAdminUser,
  });
  return res.json(result);
});

router.get('/admin/users/:user', requirePermission('users.view'), async (req, res) => {
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [Number(req.params.user)]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const [subscriptions, profiles, devices] = await Promise.all([
    queryAll(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC`, [user.id]),
    queryAll(`SELECT * FROM profiles WHERE user_id = ?`, [user.id]),
    queryAll(`SELECT * FROM devices WHERE user_id = ?`, [user.id]),
  ]);
  return res.json({ ...(await enrichAdminUser(user)), subscriptions, profiles, devices });
});

const createUserHandler = async (req, res) => {
  const payload = req.body?.user || req.body;
  const name = String(payload?.name || '').trim();
  const email = String(payload?.email || '').trim().toLowerCase();
  const password = String(payload?.password || '');
  const role = ['admin', 'moderator', 'user'].includes(payload?.role) ? payload.role : 'user';
  if (!req.user.is_admin && role === 'admin') {
    return res.status(403).json({ message: 'Moderators cannot create admin accounts.' });
  }
  if (!name || !email || password.length < 6) {
    return res.status(422).json({ message: 'Name, email, and password (min 6 chars) are required.' });
  }
  if (await queryOne(`SELECT id FROM users WHERE lower(email) = ?`, [email])) {
    return res.status(422).json({ message: 'Email already exists.' });
  }

  const now = nowIso();
  const rawVerified = payload?.verfied !== undefined ? payload.verfied : payload?.verified;
  const verifiedVal = rawVerified !== undefined ? (rawVerified ? 1 : 0) : 1;

  const cols = ['role', 'name', 'email'];
  const vals = [role, name, email];
  if (await hasColumn('users', 'phone')) {
    cols.push('phone');
    vals.push(payload?.phone || null);
  }
  cols.push('premuim', 'verfied');
  vals.push(payload?.premuim ? 1 : 0, verifiedVal);
  if (await hasColumn('users', 'verified')) {
    cols.push('verified');
    vals.push(verifiedVal);
  }
  cols.push('active', 'password', 'pack_name', 'pack_id', 'start_at', 'expired_in', 'created_at', 'updated_at');
  vals.push(
    payload?.active !== undefined ? (payload.active ? 1 : 0) : 1,
    hashPassword(password),
    payload?.pack_name || null,
    payload?.pack_id || null,
    payload?.start_at || null,
    payload?.expired_in || null,
    now,
    now
  );

  const resInsert = await execute(
    `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals
  );

  const created = await queryOne(`SELECT * FROM users WHERE id = ?`, [Number(resInsert.lastInsertRowid)]);
  return res.status(201).json({
    status: 201,
    message: 'User created successfully.',
    user: await enrichAdminUser(created),
  });
};
router.post('/admin/users', requirePermission('users.create'), createUserHandler);
router.post('/admin/users/store', requirePermission('users.create'), createUserHandler);

const updateUserHandler = async (req, res) => {
  const id = Number(req.params.user);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ message: 'User not found.' });
  const payload = req.body?.user || req.body;
  if (!req.user.is_admin && (existing.role === 'admin' || payload?.role === 'admin')) {
    return res.status(403).json({ message: 'Moderators cannot modify admin accounts.' });
  }
  const email = String(payload?.email ?? existing.email).trim().toLowerCase();
  if (await queryOne(`SELECT id FROM users WHERE lower(email) = ? AND id != ?`, [email, id])) {
    return res.status(422).json({ message: 'Email already exists.' });
  }

  const now = nowIso();
  const nextPassword = payload?.password ? hashPassword(payload.password) : existing.password;
  const rawVerified = payload?.verfied !== undefined ? payload.verfied : payload?.verified;
  const nextVerified = rawVerified !== undefined
    ? (rawVerified ? 1 : 0)
    : Number(existing.verfied ?? existing.verified ?? 0);

  const sets = ['name = ?', 'email = ?'];
  const vals = [String(payload?.name ?? existing.name).trim(), email];
  if (await hasColumn('users', 'phone')) {
    sets.push('phone = ?');
    vals.push(payload?.phone !== undefined ? payload.phone : existing.phone);
  }
  sets.push('role = ?', 'premuim = ?', 'verfied = ?');
  vals.push(
    ['admin', 'moderator', 'user'].includes(payload?.role) ? payload.role : existing.role,
    payload?.premuim !== undefined ? (payload.premuim ? 1 : 0) : existing.premuim,
    nextVerified
  );
  if (await hasColumn('users', 'verified')) {
    sets.push('verified = ?');
    vals.push(nextVerified);
  }
  sets.push(
    'active = ?',
    'pack_name = ?',
    'pack_id = ?',
    'start_at = ?',
    'expired_in = ?',
    'password = ?',
    'updated_at = ?'
  );
  vals.push(
    payload?.active !== undefined ? (payload.active ? 1 : 0) : existing.active,
    payload?.pack_name !== undefined ? payload.pack_name : existing.pack_name,
    payload?.pack_id !== undefined ? payload.pack_id : existing.pack_id,
    payload?.start_at !== undefined ? payload.start_at : existing.start_at,
    payload?.expired_in !== undefined ? payload.expired_in : existing.expired_in,
    nextPassword,
    now,
    id
  );

  await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  return res.json({
    status: 200,
    message: 'User updated successfully.',
    user: await enrichAdminUser(await queryOne(`SELECT * FROM users WHERE id = ?`, [id])),
  });
};
router.put('/admin/users/:user', requirePermission('users.edit'), updateUserHandler);
router.put('/admin/users/update/:user', requirePermission('users.edit'), updateUserHandler);

const deleteUserHandler = async (req, res) => {
  const id = Number(req.params.user);
  const existing = await queryOne(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ message: 'User not found.' });
  if (existing.email === 'admin@easyplex.com' || existing.id === req.user.id) {
    return res.status(403).json({ message: 'Protected admin users cannot be deleted.' });
  }
  await execute(`DELETE FROM users WHERE id = ?`, [id]);
  return res.json({ status: 200, message: 'User deleted successfully.' });
};
router.delete('/admin/users/:user', requirePermission('users.delete'), deleteUserHandler);
router.delete('/admin/users/destroy/:user', requirePermission('users.delete'), deleteUserHandler);

router.post('/admin/users/:user/apply-package', requirePermission('users.edit'), async (req, res) => {
  const userId = Number(req.params.user);
  const planId = Number(req.body?.package_id || req.body?.plan_id);
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  const plan = await queryOne(`SELECT * FROM plans WHERE id = ?`, [planId]);
  if (!user || !plan) return res.status(404).json({ message: 'User or plan not found.' });
  const updated = await activateSubscriptionForUser(
    userId,
    plan,
    'offline',
    `admin_manual_${Date.now()}_${userId}`,
    req.body?.premium_start_at || null,
    req.body?.premium_expires_at || null
  );
  return res.json({
    status: 200,
    message: 'Package applied successfully.',
    user: await enrichAdminUser(updated),
  });
});

router.delete('/admin/users/:user/remove-package', requirePermission('users.edit'), async (req, res) => {
  const userId = Number(req.params.user);
  const now = nowIso();
  const hasSubStatus = await hasColumn('subscriptions', 'status');
  const hasProviderStatus = await hasColumn('subscriptions', 'provider_status');

  const subSets = [`stripe_status = 'canceled'`, `ends_at = ?`, `updated_at = ?`];
  if (hasSubStatus) subSets.unshift(`status = 'canceled'`);
  if (hasProviderStatus) subSets.unshift(`provider_status = 'canceled'`);

  await runInTransaction(async () => {
    await execute(`UPDATE subscriptions SET ${subSets.join(', ')} WHERE user_id = ?`, [now, now, userId]);
    await execute(
      `UPDATE users SET premuim = 0, pack_id = NULL, pack_name = NULL, type = NULL, start_at = NULL, expired_in = NULL, updated_at = ? WHERE id = ?`,
      [now, userId]
    );
  });
  return res.json({
    status: 200,
    message: 'Package removed successfully.',
    user: await enrichAdminUser(await queryOne(`SELECT * FROM users WHERE id = ?`, [userId])),
  });
});

router.patch('/admin/users/:user/toggle-premium', requirePermission('users.edit'), async (req, res) => {
  const userId = Number(req.params.user);
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const enabled = !Number(user.premuim);
  const now = nowIso();
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  await execute(
    `UPDATE users SET premuim = ?, type = ?, start_at = ?, expired_in = ?, updated_at = ? WHERE id = ?`,
    [
      enabled ? 1 : 0,
      enabled ? 'offline' : null,
      enabled ? (user.start_at || today) : null,
      enabled ? (user.expired_in || nextMonth) : null,
      now,
      userId,
    ]
  );
  return res.json({
    status: 200,
    message: 'Premium status updated.',
    user: await enrichAdminUser(await queryOne(`SELECT * FROM users WHERE id = ?`, [userId])),
  });
});

router.patch('/admin/users/:user/toggle-status', requirePermission('users.ban'), async (req, res) => {
  const userId = Number(req.params.user);
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.email === 'admin@easyplex.com') {
    return res.status(403).json({ message: 'Protected admin users cannot be deactivated.' });
  }
  const nextActive = Number(user.active) ? 0 : 1;
  await execute(`UPDATE users SET active = ?, updated_at = ? WHERE id = ?`, [nextActive, nowIso(), userId]);
  return res.json({
    status: 200,
    message: 'Account status updated.',
    user: await enrichAdminUser(await queryOne(`SELECT * FROM users WHERE id = ?`, [userId])),
  });
});

router.put('/admin/user/ban/:id', requirePermission('users.ban'), async (req, res) => {
  await execute(`UPDATE users SET active = 0, updated_at = ? WHERE id = ? AND email != 'admin@easyplex.com'`, [
    nowIso(),
    Number(req.params.id),
  ]);
  return res.json({ status: 200, message: 'User banned.' });
});

router.put('/admin/user/unban/:id', requirePermission('users.ban'), async (req, res) => {
  await execute(`UPDATE users SET active = 1, updated_at = ? WHERE id = ?`, [nowIso(), Number(req.params.id)]);
  return res.json({ status: 200, message: 'User unbanned.' });
});

router.post('/admin/users/:user/reset-password', requirePermission('users.edit'), async (req, res) => {
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [Number(req.params.user)]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const token = randomHex(20);
  await execute(`DELETE FROM password_resets WHERE lower(email) = ?`, [user.email.toLowerCase()]);
  await execute(`INSERT INTO password_resets (email, token, created_at) VALUES (?, ?, ?)`, [
    user.email.toLowerCase(),
    token,
    nowIso(),
  ]);
  return res.json({ status: 200, message: 'Password reset link generated.', reset_token: token });
});

router.post('/admin/users/bulk-action', requirePermission('users.edit'), async (req, res) => {
  const action = String(req.body?.action || '');
  const userIds = Array.isArray(req.body?.users) ? req.body.users.map(Number).filter(Boolean) : [];
  if (!userIds.length) return res.status(422).json({ message: 'Select at least one user.' });
  const now = nowIso();
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10);
  const plan = req.body?.bulk_package_id
    ? await queryOne(`SELECT * FROM plans WHERE id = ?`, [Number(req.body.bulk_package_id)])
    : null;

  let changed = 0;
  await runInTransaction(async () => {
    for (const id of userIds) {
      const u = await queryOne(`SELECT * FROM users WHERE id = ?`, [id]);
      if (!u) continue;
      if ((action === 'delete' || action === 'deactivate') && u.email === 'admin@easyplex.com') continue;

      if (action === 'delete') {
        await execute(`DELETE FROM users WHERE id = ?`, [id]);
        changed++;
      } else if (action === 'mark_premium') {
        await execute(
          `UPDATE users SET premuim = 1, type = 'offline', start_at = COALESCE(start_at, ?), expired_in = ?, updated_at = ? WHERE id = ?`,
          [today, nextYear, now, id]
        );
        changed++;
      } else if (action === 'remove_premium') {
        await execute(`UPDATE users SET premuim = 0, type = NULL, expired_in = NULL, updated_at = ? WHERE id = ?`, [
          now,
          id,
        ]);
        changed++;
      } else if (action === 'activate') {
        await execute(`UPDATE users SET active = 1, updated_at = ? WHERE id = ?`, [now, id]);
        changed++;
      } else if (action === 'deactivate') {
        await execute(`UPDATE users SET active = 0, updated_at = ? WHERE id = ?`, [now, id]);
        changed++;
      } else if (action === 'assign_package' && plan) {
        await activateSubscriptionForUser(id, plan, 'offline', `bulk_${Date.now()}_${id}`);
        changed++;
      }
    }
  });

  return res.json({ status: 200, message: `${changed} user(s) updated.`, changed });
});

export default router;
