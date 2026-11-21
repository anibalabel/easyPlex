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
import { sendStoredFile } from '../../middleware/upload.js';
import { randomCode } from '../../services/crypto.js';
import {
  addCredits,
  findContentRecord,
  normalizeContentType,
  removeCredits,
} from '../../services/credits.js';
import { activateSubscriptionForUser, serializePlan } from '../../services/subscriptions.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

function parseJsonValue(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// ================= PLANS & SUBSCRIPTIONS =================
router.get('/admin/plans/data', requirePermission('plans.view'), async (_req, res) => {
  const rows = await queryAll(`SELECT * FROM plans ORDER BY sort_order ASC, id ASC`);
  return res.json(rows.map(serializePlan));
});

router.post('/admin/plans/store', requirePermission('plans.create'), async (req, res) => {
  const p = req.body?.plan || req.body;
  const name = String(p?.name || '').trim();
  if (!name) return res.status(422).json({ message: 'Plan name is required.' });
  const slug =
    String(p?.slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `plan-${Date.now()}`;
  const features = Array.isArray(p?.features)
    ? p.features
    : String(p?.features || '')
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const now = nowIso();

  const result = await execute(
    `INSERT INTO plans (name, slug, description, features, max_devices, max_profiles, is_featured, is_active, sort_order, trial_days,
       price, stripe_plan_id, stripe_price_id, stripe_product_id, paypal_plan_id, razorpay_plan_id, pack_duration, currency_plan_app, currency, \`interval\`, interval_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      slug,
      p?.description || null,
      JSON.stringify(features),
      Number(p?.max_devices || 1),
      Number(p?.max_profiles || 1),
      p?.is_featured ? 1 : 0,
      p?.is_active !== undefined ? (p.is_active ? 1 : 0) : 1,
      Number(p?.sort_order || 0),
      Number(p?.trial_days || 0),
      String(p?.price ?? '0'),
      p?.stripe_plan_id || '',
      p?.stripe_price_id || '',
      p?.stripe_product_id || null,
      p?.paypal_plan_id || null,
      p?.razorpay_plan_id || null,
      String(p?.pack_duration ?? '30'),
      (p?.currency_plan_app || p?.currency || 'USD').toUpperCase(),
      (p?.currency || 'USD').toUpperCase().slice(0, 3),
      p?.interval || 'month',
      Math.max(1, Number(p?.interval_count || 1)),
      now,
      now,
    ]
  );

  const created = await queryOne(`SELECT * FROM plans WHERE id = ?`, [Number(result.lastInsertRowid)]);
  return res.json({ status: 200, message: 'successfully created', body: serializePlan(created) });
});

router.put('/admin/plans/update/:plan', requirePermission('plans.edit'), async (req, res) => {
  const id = Number(req.params.plan);
  const existing = await queryOne(`SELECT * FROM plans WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ status: 404, message: 'could not be updated' });
  const p = req.body?.plan || req.body;
  const features =
    p?.features !== undefined
      ? Array.isArray(p.features)
        ? p.features
        : String(p.features)
            .split(/[\r\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
      : parseJsonValue(existing.features, []);

  await execute(
    `UPDATE plans SET name = ?, slug = ?, description = ?, features = ?, max_devices = ?, max_profiles = ?, is_featured = ?, is_active = ?,
       sort_order = ?, trial_days = ?, price = ?, stripe_plan_id = ?, stripe_price_id = ?, stripe_product_id = ?, paypal_plan_id = ?, razorpay_plan_id = ?,
       pack_duration = ?, currency_plan_app = ?, currency = ?, \`interval\` = ?, interval_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      String(p?.name ?? existing.name).trim(),
      p?.slug ?? existing.slug,
      p?.description !== undefined ? p.description : existing.description,
      JSON.stringify(features),
      Number(p?.max_devices ?? existing.max_devices),
      Number(p?.max_profiles ?? existing.max_profiles),
      p?.is_featured !== undefined ? (p.is_featured ? 1 : 0) : existing.is_featured,
      p?.is_active !== undefined ? (p.is_active ? 1 : 0) : existing.is_active,
      Number(p?.sort_order ?? existing.sort_order),
      Number(p?.trial_days ?? existing.trial_days),
      String(p?.price ?? existing.price),
      p?.stripe_plan_id ?? existing.stripe_plan_id,
      p?.stripe_price_id ?? existing.stripe_price_id,
      p?.stripe_product_id !== undefined ? p.stripe_product_id : existing.stripe_product_id,
      p?.paypal_plan_id !== undefined ? p.paypal_plan_id : existing.paypal_plan_id,
      p?.razorpay_plan_id !== undefined ? p.razorpay_plan_id : existing.razorpay_plan_id,
      String(p?.pack_duration ?? existing.pack_duration),
      (p?.currency_plan_app || p?.currency || existing.currency_plan_app || 'USD').toUpperCase(),
      (p?.currency || existing.currency || 'USD').toUpperCase().slice(0, 3),
      p?.interval || existing.interval,
      Math.max(1, Number(p?.interval_count ?? existing.interval_count)),
      nowIso(),
      id,
    ]
  );

  return res.json({
    status: 200,
    message: 'successfully updated',
    body: serializePlan(await queryOne(`SELECT * FROM plans WHERE id = ?`, [id])),
  });
});

router.delete('/admin/plans/destroy/:plan', requirePermission('plans.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM plans WHERE id = ?`, [Number(req.params.plan)]);
  return res.status(result.changes ? 200 : 404).json({
    status: result.changes ? 200 : 404,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

const listSubscriptionsHandler = async (_req, res) => {
  const rows = (
    await queryAll(
      `SELECT s.*, u.email, u.pack_name
       FROM subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC, s.id DESC`
    )
  ).map((s) => {
    const expiresAt = s.ends_at || s.current_period_end || null;
    const isRecurring =
      (s.provider || 'stripe') === 'stripe' &&
      !s.ends_at &&
      ['active', 'trialing', 'past_due'].includes(s.stripe_status);
    return {
      id: Number(s.id),
      user_id: Number(s.user_id),
      email: s.email,
      plan_name: s.name || s.pack_name || 'Subscription',
      provider: s.provider || 'stripe',
      status: s.stripe_status,
      provider_status: s.provider_status || s.stripe_status,
      expires_at: expiresAt ? String(expiresAt).slice(0, 10) : null,
      renews_at: isRecurring && s.current_period_end ? String(s.current_period_end).slice(0, 10) : null,
      is_recurring: isRecurring,
      access_label: s.ends_at
        ? `Cancels on ${String(s.ends_at).slice(0, 10)}`
        : expiresAt
        ? `Expires on ${String(expiresAt).slice(0, 10)}`
        : 'Active',
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });
  return res.json(rows);
};

router.get('/admin/subscriptions/all', requirePermission('plans.view'), listSubscriptionsHandler);
router.get('/admin/subscriptions/data', requirePermission('plans.view'), listSubscriptionsHandler);
router.get('/admin/subscriptions/paypal', requirePermission('plans.view'), async (_req, res) => {
  const rows = await queryAll(
    `SELECT s.*, u.email FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.provider = 'paypal' ORDER BY s.created_at DESC`
  );
  return res.json(rows);
});
router.get('/admin/subscriptions/find', async (req, res) => {
  return res.json(await queryAll(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id]));
});

// ================= COUPONS (PROMOCODES) =================
router.get('/admin/coupons/data', requirePermission('plans.view'), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const where = q ? `code LIKE ? OR details LIKE ?` : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const rows = (
    await queryAll(`SELECT * FROM promocodes ${where ? `WHERE ${where}` : ''} ORDER BY id DESC`, params)
  ).map((c) => {
    const details = parseJsonValue(c.details, {});
    return {
      ...c,
      details,
      multi_use: Boolean(Number(c.multi_use)),
      bound_to_user: Boolean(Number(c.bound_to_user)),
    };
  });
  return res.json(rows);
});

router.post('/admin/coupon/store', requirePermission('plans.create'), async (req, res) => {
  const planName = String(req.body?.planName || '').trim();
  const planDays = Number(req.body?.planDays || 30);
  if (!planName || planDays <= 0) return res.status(422).json({ message: 'planName and planDays are required.' });

  const count = Math.min(50, Math.max(1, Number(req.body?.count || 1)));
  const usagesLeft = req.body?.unlimited ? -1 : Math.max(1, Number(req.body?.usages_left || 1));
  const multiUse = req.body?.multi_use ? 1 : 0;
  const expiresAt = new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const now = nowIso();
  const created = [];

  await runInTransaction(async () => {
    for (let i = 0; i < count; i++) {
      const code = `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`;
      const details = JSON.stringify({ planName, planDays });
      const r = await execute(
        `INSERT INTO promocodes (code, usages_left, bound_to_user, multi_use, details, expired_at, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
        [code, usagesLeft, multiUse, details, expiresAt, now, now]
      );
      created.push(await queryOne(`SELECT * FROM promocodes WHERE id = ?`, [Number(r.lastInsertRowid)]));
    }
  });

  return res.status(201).json({ coupon: count === 1 ? created[0] : created });
});

router.put('/admin/coupons/:couponId', requirePermission('plans.edit'), async (req, res) => {
  const id = Number(req.params.couponId);
  const existing = await queryOne(`SELECT * FROM promocodes WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ message: 'Coupon not found.' });
  await execute(`UPDATE promocodes SET usages_left = ?, multi_use = ?, updated_at = ? WHERE id = ?`, [
    req.body?.usages_left !== undefined ? Number(req.body.usages_left) : existing.usages_left,
    req.body?.multi_use !== undefined ? (req.body.multi_use ? 1 : 0) : existing.multi_use,
    nowIso(),
    id,
  ]);
  return res.json({ coupon: await queryOne(`SELECT * FROM promocodes WHERE id = ?`, [id]) });
});

router.delete('/admin/coupon/destroy/:plan', requirePermission('plans.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM promocodes WHERE id = ?`, [Number(req.params.plan)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= OFFLINE PAYMENTS =================
function formatOfflinePayment(req, r) {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    user_name: r.user_name || r.full_name,
    user_email: r.user_email,
    phone: r.phone,
    plan_id: Number(r.plan_id),
    plan_name: r.plan_name || `Plan #${r.plan_id}`,
    amount: Number(r.amount || 0).toFixed(2),
    currency: r.currency || 'USD',
    reference: r.reference,
    proof_url: `${req.protocol}://${req.get('host')}/admin/offline-payments/${r.id}/proof`,
    status: r.status,
    note: r.note,
    rejection_reason: r.rejection_reason,
    created_at: r.created_at,
    reviewed_at: r.approved_at || r.rejected_at || null,
  };
}

router.get('/admin/offline-payments/data', requirePermission('offline_payments.view'), async (req, res) => {
  const status = String(req.query?.status || '').trim();
  const q = String(req.query?.q || '').trim();
  const where = [];
  const params = [];

  if (['pending', 'approved', 'rejected'].includes(status)) {
    where.push(`o.status = ?`);
    params.push(status);
  }
  if (q) {
    where.push(`(o.reference LIKE ? OR u.email LIKE ? OR o.full_name LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const result = await paginateQuery({
    baseFrom: `FROM offline_payment_requests o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN plans p ON p.id = o.plan_id`,
    selectSql: `o.*, u.name AS user_name, u.email AS user_email, p.name AS plan_name`,
    whereSql: where.join(' AND '),
    params,
    orderBySql: 'o.created_at DESC, o.id DESC',
    page: req.query?.page || 1,
    perPage: 25,
    mapRow: (r) => formatOfflinePayment(req, r),
  });

  return res.json({ requests: result, filters: { status: status || 'all', q } });
});

router.get('/admin/offline-payments/:id/proof', requirePermission('offline_payments.view'), async (req, res) => {
  const row = await queryOne(`SELECT proof_image FROM offline_payment_requests WHERE id = ?`, [Number(req.params.id)]);
  if (!row?.proof_image) return res.status(404).json({ message: 'Proof not found.' });
  return sendStoredFile(res, 'offline_proofs', row.proof_image);
});

router.post('/admin/offline-payments/:id/approve', requirePermission('offline_payments.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const payment = await queryOne(`SELECT * FROM offline_payment_requests WHERE id = ?`, [id]);
  if (!payment) return res.status(404).json({ message: 'Request not found.' });
  if (payment.status !== 'pending') return res.status(422).json({ message: 'Only pending requests can be approved.' });

  const [plan, user] = await Promise.all([
    queryOne(`SELECT * FROM plans WHERE id = ?`, [payment.plan_id]),
    queryOne(`SELECT * FROM users WHERE id = ?`, [payment.user_id]),
  ]);
  if (!plan || !user) return res.status(422).json({ message: 'Missing user or plan for this request.' });

  await activateSubscriptionForUser(user.id, plan, 'offline', payment.reference);
  const now = nowIso();
  await execute(
    `UPDATE offline_payment_requests SET status = 'approved', approved_at = ?, rejection_reason = NULL, reviewed_by = ?, updated_at = ? WHERE id = ?`,
    [now, req.user.id, now, id]
  );

  const updated = await queryOne(
    `SELECT o.*, u.name AS user_name, u.email AS user_email, p.name AS plan_name
     FROM offline_payment_requests o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN plans p ON p.id = o.plan_id WHERE o.id = ?`,
    [id]
  );
  return res.json({
    message: 'Offline payment approved and subscription activated.',
    payment: formatOfflinePayment(req, updated),
  });
});

router.post('/admin/offline-payments/:id/reject', requirePermission('offline_payments.reject'), async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.rejection_reason || '').trim();
  if (!reason) return res.status(422).json({ message: 'Rejection reason is required.' });
  const payment = await queryOne(`SELECT * FROM offline_payment_requests WHERE id = ?`, [id]);
  if (!payment) return res.status(404).json({ message: 'Request not found.' });
  if (payment.status !== 'pending') return res.status(422).json({ message: 'Only pending requests can be rejected.' });

  const now = nowIso();
  await execute(
    `UPDATE offline_payment_requests SET status = 'rejected', rejection_reason = ?, rejected_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`,
    [reason, now, req.user.id, now, id]
  );
  const updated = await queryOne(
    `SELECT o.*, u.name AS user_name, u.email AS user_email, p.name AS plan_name
     FROM offline_payment_requests o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN plans p ON p.id = o.plan_id WHERE o.id = ?`,
    [id]
  );
  return res.json({
    message: 'Offline payment request rejected.',
    payment: formatOfflinePayment(req, updated),
  });
});

// ================= CREDITS =================
router.get('/admin/credits/summary', requirePermission('credits.view'), async (_req, res) => {
  const [packages, enabledPackages, sums, pendingRequests] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS c FROM credit_packages`),
    queryOne(`SELECT COUNT(*) AS c FROM credit_packages WHERE status = 'enabled'`),
    queryOne(
      `SELECT COALESCE(SUM(balance), 0) AS bal, COALESCE(SUM(total_purchased), 0) AS pur, COALESCE(SUM(total_spent), 0) AS sp FROM user_credits`
    ),
    queryOne(`SELECT COUNT(*) AS c FROM credit_purchase_requests WHERE status = 'pending'`),
  ]);

  return res.json({
    packages: Number(packages?.c || 0),
    enabled_packages: Number(enabledPackages?.c || 0),
    total_balance: Number(sums?.bal || 0),
    total_purchased: Number(sums?.pur || 0),
    total_spent: Number(sums?.sp || 0),
    pending_requests: Number(pendingRequests?.c || 0),
  });
});

router.get('/admin/credits/packages', requirePermission('credits.view'), async (_req, res) => {
  const packages = (await queryAll(`SELECT * FROM credit_packages ORDER BY sort_order ASC, id ASC`)).map((p) => ({
    ...p,
    price: Number(p.price || 0).toFixed(2),
  }));
  return res.json({ packages });
});

router.post('/admin/credits/packages', requirePermission('credits.create'), async (req, res) => {
  const { name, credits_amount, price, currency = 'USD', status = 'enabled', sort_order = 0 } = req.body || {};
  if (!name || !credits_amount) return res.status(422).json({ message: 'Package name and credits_amount are required.' });
  const now = nowIso();
  const r = await execute(
    `INSERT INTO credit_packages (name, credits_amount, price, currency, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(name).trim(),
      Number(credits_amount),
      Number(price || 0),
      String(currency).toUpperCase(),
      status === 'disabled' ? 'disabled' : 'enabled',
      Number(sort_order || 0),
      now,
      now,
    ]
  );
  const pkg = await queryOne(`SELECT * FROM credit_packages WHERE id = ?`, [Number(r.lastInsertRowid)]);
  return res.status(201).json({
    message: 'Credit package created successfully.',
    package: { ...pkg, price: Number(pkg.price).toFixed(2) },
  });
});

router.put('/admin/credits/packages/:package', requirePermission('credits.edit'), async (req, res) => {
  const id = Number(req.params.package);
  const existing = await queryOne(`SELECT * FROM credit_packages WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ message: 'Package not found.' });
  const { name, credits_amount, price, currency, status, sort_order } = req.body || {};
  await execute(
    `UPDATE credit_packages SET name = ?, credits_amount = ?, price = ?, currency = ?, status = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
    [
      String(name ?? existing.name).trim(),
      Number(credits_amount ?? existing.credits_amount),
      Number(price ?? existing.price),
      String(currency ?? existing.currency).toUpperCase(),
      status ?? existing.status,
      Number(sort_order ?? existing.sort_order),
      nowIso(),
      id,
    ]
  );
  const pkg = await queryOne(`SELECT * FROM credit_packages WHERE id = ?`, [id]);
  return res.json({
    message: 'Credit package updated successfully.',
    package: { ...pkg, price: Number(pkg.price).toFixed(2) },
  });
});

router.delete('/admin/credits/packages/:package', requirePermission('credits.delete'), async (req, res) => {
  await execute(`DELETE FROM credit_packages WHERE id = ?`, [Number(req.params.package)]);
  return res.json({ message: 'Credit package deleted successfully.' });
});

router.get('/admin/credits/users', requirePermission('credits.view'), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const where = q ? `(u.name LIKE ? OR u.email LIKE ?)` : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const users = await paginateQuery({
    baseFrom: `FROM users u LEFT JOIN user_credits c ON c.user_id = u.id`,
    selectSql: `u.id, u.name, u.email, u.premuim, COALESCE(c.balance, 0) AS balance, COALESCE(c.total_purchased, 0) AS total_purchased, COALESCE(c.total_spent, 0) AS total_spent`,
    whereSql: where,
    params,
    orderBySql: 'u.created_at DESC, u.id DESC',
    page: req.query?.page || 1,
    perPage: req.query?.per_page || 20,
    mapRow: (u) => ({
      id: Number(u.id),
      name: u.name,
      email: u.email,
      balance: Number(u.balance || 0),
      total_purchased: Number(u.total_purchased || 0),
      total_spent: Number(u.total_spent || 0),
      premium_label: Number(u.premuim) ? 'Premium' : 'Free',
    }),
  });
  return res.json({ users });
});

router.post('/admin/credits/users/:user/adjust', requirePermission('credits.adjust'), async (req, res) => {
  const userId = Number(req.params.user);
  const action = req.body?.action;
  const amount = Number(req.body?.credits_amount || 0);
  const description = String(req.body?.description || '').trim();
  const user = await queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (!['add', 'remove'].includes(action) || amount < 1) {
    return res.status(422).json({ message: 'Valid action (add/remove) and credits_amount >= 1 required.' });
  }

  try {
    const credit =
      action === 'add'
        ? await addCredits(userId, amount, 'admin_add', description || 'Admin added credits.', req.user.id)
        : await removeCredits(userId, amount, description || 'Admin removed credits.', req.user.id);
    return res.json({
      message: action === 'add' ? 'Credits added successfully.' : 'Credits removed successfully.',
      user: {
        id: Number(user.id),
        name: user.name,
        email: user.email,
        balance: Number(credit.balance),
        total_purchased: Number(credit.total_purchased),
        total_spent: Number(credit.total_spent),
        premium_label: Number(user.premuim) ? 'Premium' : 'Free',
      },
    });
  } catch (err) {
    return res.status(422).json({ message: err.message });
  }
});

router.get('/admin/credits/users/:user/transactions', requirePermission('credits.view'), async (req, res) => {
  const rows = await queryAll(
    `SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    [Number(req.params.user)]
  );
  return res.json({ transactions: rows });
});

router.get('/admin/credits/transactions', requirePermission('credits.view'), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const type = String(req.query?.type || '').trim();
  const contentType = String(req.query?.content_type || '').trim();
  const where = [];
  const params = [];
  if (type) {
    where.push(`t.type = ?`);
    params.push(type);
  }
  if (contentType) {
    where.push(`t.content_type = ?`);
    params.push(contentType);
  }
  if (q) {
    where.push(`(t.payment_reference LIKE ? OR t.description LIKE ? OR u.email LIKE ? OR u.name LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const transactions = await paginateQuery({
    baseFrom: `FROM credit_transactions t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users c ON c.id = t.created_by`,
    selectSql: `t.*, u.name AS user_name, u.email AS user_email, c.name AS created_by_name`,
    whereSql: where.join(' AND '),
    params,
    orderBySql: 't.id DESC',
    page: req.query?.page || 1,
    perPage: req.query?.per_page || 30,
  });
  return res.json({ transactions });
});

router.get('/admin/credits/pricing', requirePermission('credits.view'), async (req, res) => {
  const type = normalizeContentType(String(req.query?.content_type || 'movie'));
  const q = String(req.query?.q || '').trim();
  const page = req.query?.page || 1;
  const perPage = req.query?.per_page || 20;

  let baseFrom = '';
  let selectSql = '';
  let whereSql = '';
  const params = [];

  if (type === 'movie') {
    baseFrom = `FROM movies m LEFT JOIN content_credit_prices p ON p.content_type = 'movie' AND p.content_id = m.id`;
    selectSql = `m.id, m.title, '' AS parent_name, NULL AS season_number, NULL AS episode_number, m.poster_path, p.credits_required, p.is_credit_enabled, (p.id IS NOT NULL) AS has_custom_price`;
    if (q) {
      whereSql = `m.title LIKE ?`;
      params.push(`%${q}%`);
    }
  } else if (type === 'live_tv') {
    baseFrom = `FROM livetvs l LEFT JOIN content_credit_prices p ON p.content_type = 'live_tv' AND p.content_id = l.id`;
    selectSql = `l.id, l.name AS title, '' AS parent_name, NULL AS season_number, NULL AS episode_number, l.poster_path, p.credits_required, p.is_credit_enabled, (p.id IS NOT NULL) AS has_custom_price`;
    if (q) {
      whereSql = `l.name LIKE ?`;
      params.push(`%${q}%`);
    }
  } else if (type === 'series_episode') {
    baseFrom = `FROM episodes e LEFT JOIN seasons s ON s.id = e.season_id LEFT JOIN series sr ON sr.id = s.serie_id LEFT JOIN content_credit_prices p ON p.content_type = 'series_episode' AND p.content_id = e.id`;
    selectSql = `e.id, e.name AS title, COALESCE(sr.name, 'Series') AS parent_name, s.season_number, e.episode_number, e.still_path AS poster_path, p.credits_required, p.is_credit_enabled, (p.id IS NOT NULL) AS has_custom_price`;
    if (q) {
      whereSql = `(e.name LIKE ? OR sr.name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
  } else if (type === 'anime_episode') {
    baseFrom = `FROM anime_episodes e LEFT JOIN anime_seasons s ON s.id = e.anime_season_id LEFT JOIN animes a ON a.id = s.anime_id LEFT JOIN content_credit_prices p ON p.content_type = 'anime_episode' AND p.content_id = e.id`;
    selectSql = `e.id, e.name AS title, COALESCE(a.name, 'Anime') AS parent_name, s.season_number, e.episode_number, e.still_path AS poster_path, p.credits_required, p.is_credit_enabled, (p.id IS NOT NULL) AS has_custom_price`;
    if (q) {
      whereSql = `(e.name LIKE ? OR a.name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
  } else {
    return res.json({ content: { current_page: 1, data: [], last_page: 1, total: 0 } });
  }

  const content = await paginateQuery({
    baseFrom,
    selectSql,
    whereSql,
    params,
    orderBySql: '1 DESC',
    page,
    perPage,
    mapRow: (r) => {
      const subtitle =
        type === 'series_episode' || type === 'anime_episode'
          ? `${r.parent_name || ''} S${r.season_number ?? ''} E${r.episode_number ?? ''}`
          : '';
      return {
        id: Number(r.id),
        title: r.title,
        subtitle,
        poster_path: r.poster_path,
        content_type: type,
        credits_required: r.credits_required !== null ? Number(r.credits_required) : 1,
        is_credit_enabled: r.is_credit_enabled !== null ? Boolean(Number(r.is_credit_enabled)) : true,
        has_custom_price: Boolean(r.has_custom_price),
      };
    },
  });

  return res.json({ content });
});

async function upsertContentCreditPrice(type, contentId, creditsRequired, enabled, now) {
  if (isMySql()) {
    await execute(
      `INSERT INTO content_credit_prices (content_type, content_id, credits_required, is_credit_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE credits_required = VALUES(credits_required), is_credit_enabled = VALUES(is_credit_enabled), updated_at = VALUES(updated_at)`,
      [type, contentId, creditsRequired, enabled, now, now]
    );
  } else {
    await execute(
      `INSERT INTO content_credit_prices (content_type, content_id, credits_required, is_credit_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(content_type, content_id) DO UPDATE SET credits_required = excluded.credits_required, is_credit_enabled = excluded.is_credit_enabled, updated_at = excluded.updated_at`,
      [type, contentId, creditsRequired, enabled, now, now]
    );
  }
}

router.post('/admin/credits/pricing', requirePermission('credits.edit'), async (req, res) => {
  const type = normalizeContentType(req.body?.content_type);
  const contentId = Number(req.body?.content_id);
  const creditsRequired = Math.max(0, Number(req.body?.credits_required ?? 1));
  const enabled = req.body?.is_credit_enabled ? 1 : 0;
  if (!(await findContentRecord(type, contentId))) {
    return res.status(404).json({ message: 'Content not found.' });
  }
  await upsertContentCreditPrice(type, contentId, creditsRequired, enabled, nowIso());
  const price = await queryOne(`SELECT * FROM content_credit_prices WHERE content_type = ? AND content_id = ?`, [
    type,
    contentId,
  ]);
  return res.json({ message: 'Credit price saved successfully.', price });
});

router.post('/admin/credits/pricing/bulk', requirePermission('credits.edit'), async (req, res) => {
  const type = normalizeContentType(req.body?.content_type);
  const ids = Array.isArray(req.body?.content_ids) ? req.body.content_ids.map(Number).filter(Boolean) : [];
  const creditsRequired = Math.max(0, Number(req.body?.credits_required ?? 1));
  const enabled = req.body?.is_credit_enabled ? 1 : 0;
  const now = nowIso();
  await runInTransaction(async () => {
    for (const id of ids) {
      await upsertContentCreditPrice(type, id, creditsRequired, enabled, now);
    }
  });
  return res.json({ message: 'Bulk credit pricing updated successfully.' });
});

router.get('/admin/credits/purchase-requests', requirePermission('credits.view'), async (req, res) => {
  const status = String(req.query?.status || '').trim();
  const where = ['pending', 'approved', 'rejected'].includes(status) ? `r.status = ?` : '';
  const params = where ? [status] : [];
  const requests = await paginateQuery({
    baseFrom: `FROM credit_purchase_requests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN credit_packages p ON p.id = r.credit_package_id`,
    selectSql: `r.*, u.name AS user_name, u.email AS user_email, p.name AS package_name`,
    whereSql: where,
    params,
    orderBySql: 'r.id DESC',
    page: req.query?.page || 1,
    perPage: req.query?.per_page || 20,
    mapRow: (r) => ({
      ...r,
      user_name: r.user_name || r.full_name,
      amount: Number(r.amount || 0).toFixed(2),
      proof_url: `${req.protocol}://${req.get('host')}/admin/credits/purchase-requests/${r.id}/proof`,
      reviewed_at: r.approved_at || r.rejected_at || null,
    }),
  });
  return res.json({ requests });
});

router.get('/admin/credits/purchase-requests/:id/proof', requirePermission('credits.view'), async (req, res) => {
  const row = await queryOne(`SELECT proof_image FROM credit_purchase_requests WHERE id = ?`, [Number(req.params.id)]);
  if (!row?.proof_image) return res.status(404).json({ message: 'Proof not found.' });
  return sendStoredFile(res, 'credit_proofs', row.proof_image);
});

router.post('/admin/credits/purchase-requests/:id/approve', requirePermission('credits.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const pr = await queryOne(`SELECT * FROM credit_purchase_requests WHERE id = ?`, [id]);
  if (!pr) return res.status(404).json({ message: 'Request not found.' });
  if (pr.status !== 'pending') return res.status(422).json({ message: 'Only pending requests can be approved.' });

  const pkg = await queryOne(`SELECT name FROM credit_packages WHERE id = ?`, [pr.credit_package_id]);
  const now = nowIso();
  await addCredits(
    pr.user_id,
    pr.credits_amount,
    'purchase',
    `Approved offline credit purchase: ${pkg?.name || 'Pack'}`,
    req.user.id,
    'offline',
    pr.reference
  );
  await execute(
    `UPDATE credit_purchase_requests SET status = 'approved', approved_at = ?, rejection_reason = NULL, reviewed_by = ?, updated_at = ? WHERE id = ?`,
    [now, req.user.id, now, id]
  );
  return res.json({ message: 'Credit purchase approved and credits added.' });
});

router.post('/admin/credits/purchase-requests/:id/reject', requirePermission('credits.reject'), async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.rejection_reason || '').trim();
  if (!reason) return res.status(422).json({ message: 'Rejection reason is required.' });
  const pr = await queryOne(`SELECT * FROM credit_purchase_requests WHERE id = ?`, [id]);
  if (!pr) return res.status(404).json({ message: 'Request not found.' });
  if (pr.status !== 'pending') return res.status(422).json({ message: 'Only pending requests can be rejected.' });
  const now = nowIso();
  await execute(
    `UPDATE credit_purchase_requests SET status = 'rejected', rejection_reason = ?, rejected_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`,
    [reason, now, req.user.id, now, id]
  );
  return res.json({ message: 'Credit purchase request rejected.' });
});

export default router;
