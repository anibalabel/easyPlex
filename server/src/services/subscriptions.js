import { execute, nowIso, queryOne, runInTransaction } from '../db/sqlite.js';

export function calculatePlanExpiry(plan, startDate = new Date()) {
  const d = new Date(startDate.getTime());
  const durationDays = Number(plan?.pack_duration || 0);
  if (durationDays > 0) {
    d.setDate(d.getDate() + durationDays);
    return d;
  }

  const interval = String(plan?.interval || 'month').toLowerCase();
  const count = Math.max(1, Number(plan?.interval_count || 1));
  if (interval === 'day') d.setDate(d.getDate() + count);
  else if (interval === 'week') d.setDate(d.getDate() + count * 7);
  else if (interval === 'year') d.setFullYear(d.getFullYear() + count);
  else d.setMonth(d.getMonth() + count);
  return d;
}

export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

export async function activateSubscriptionForUser(userId, plan, provider = 'offline', reference = null, customStart = null, customEnd = null) {
  const now = nowIso();
  const start = customStart ? new Date(customStart) : new Date();
  const end = customEnd ? new Date(customEnd) : calculatePlanExpiry(plan, start);
  const startDateStr = formatDateOnly(start);
  const endDateStr = formatDateOnly(end);
  const ref = reference || `${provider}_${Date.now()}_${userId}`;

  return runInTransaction(async () => {
    await execute(
      `UPDATE subscriptions SET provider_status = 'canceled', stripe_status = 'canceled', ends_at = ?, updated_at = ?
       WHERE user_id = ? AND (stripe_status IN ('active', 'trialing') OR provider_status IN ('active', 'trialing'))`,
      [now, now, userId]
    );

    await execute(
      `INSERT INTO subscriptions (
         user_id, name, provider, provider_id, provider_status, provider_plan_id,
         stripe_id, stripe_status, stripe_plan, quantity, current_period_start, current_period_end,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'active', ?, 1, ?, ?, ?, ?)`,
      [
        userId,
        plan.name || 'default',
        provider,
        ref,
        String(plan.id),
        ref,
        String(plan.stripe_plan_id || plan.id),
        start.toISOString().slice(0, 19).replace('T', ' '),
        end.toISOString().slice(0, 19).replace('T', ' '),
        now,
        now,
      ]
    );

    await execute(
      `UPDATE users SET
         premuim = 1,
         pack_id = ?,
         pack_name = ?,
         transaction_id = ?,
         type = ?,
         start_at = ?,
         expired_in = ?,
         updated_at = ?
       WHERE id = ?`,
      [String(plan.id), plan.name, ref, provider, startDateStr, endDateStr, now, userId]
    );

    return queryOne(`SELECT * FROM users WHERE id = ?`, [userId]);
  });
}

export function serializePlan(row) {
  let features = [];
  if (row.features) {
    try {
      features = typeof row.features === 'string' ? JSON.parse(row.features) : row.features;
      if (!Array.isArray(features)) features = [];
    } catch {
      features = [];
    }
  }
  const currency = row.currency || row.currency_plan_app || 'USD';
  const priceNum = Number(row.price || 0);
  const interval = row.interval || 'month';
  const intervalCount = Number(row.interval_count || 1);

  return {
    id: Number(row.id),
    key: row.slug || `plan-${row.id}`,
    slug: row.slug || `plan-${row.id}`,
    name: row.name,
    description: row.description || '',
    price: priceNum,
    currency,
    currency_plan_app: row.currency_plan_app || currency,
    interval,
    interval_count: intervalCount,
    interval_label: intervalCount > 1 ? `Every ${intervalCount} ${interval}s` : `Per ${interval}`,
    pack_duration: Number(row.pack_duration || 30),
    trial_days: Number(row.trial_days || 0),
    max_devices: Number(row.max_devices || 1),
    max_profiles: Number(row.max_profiles || 1),
    sort_order: Number(row.sort_order || 0),
    is_active: Boolean(Number(row.is_active ?? 1)),
    is_featured: Boolean(Number(row.is_featured ?? 0)),
    stripe_plan_id: row.stripe_plan_id || '',
    stripe_price_id: row.stripe_price_id || '',
    stripe_product_id: row.stripe_product_id || '',
    paypal_plan_id: row.paypal_plan_id || '',
    razorpay_plan_id: row.razorpay_plan_id || '',
    features,
    grants_premium: Boolean(Number(row.grants_premium ?? 1)),
    formatted_price: `${priceNum.toFixed(2)} ${currency}`,
    providers: {
      stripe: Boolean(row.stripe_price_id || row.stripe_plan_id),
      paypal: Boolean(row.paypal_plan_id),
      razorpay: Boolean(row.razorpay_plan_id),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function isSubscriptionActiveRow(sub) {
  if (!sub) return false;
  const st = String(sub.provider_status || sub.stripe_status || '').toLowerCase();
  if (!['active', 'trialing'].includes(st)) return false;
  const endStr = sub.ends_at || sub.current_period_end;
  if (endStr) {
    const endMs = Date.parse(String(endStr).replace(' ', 'T'));
    if (Number.isFinite(endMs) && endMs < Date.now()) return false;
  }
  return true;
}

export function formatSubscriptionForApi(sub, plan, user = null) {
  const active = isSubscriptionActiveRow(sub);
  const userPrem = Boolean(Number(user?.premuim || 0));
  if (!active && !userPrem) return null;

  const serializedPlan = plan ? serializePlan(plan) : null;
  const status = sub ? String(sub.provider_status || sub.stripe_status || 'active') : 'active';
  const periodEnd = sub?.current_period_end || sub?.ends_at || user?.expired_in || null;
  const trialEnd = sub?.trial_ends_at || null;

  return {
    id: sub ? Number(sub.id) : null,
    user_id: sub ? Number(sub.user_id) : Number(user?.id || 0),
    provider: sub?.provider || user?.type || 'offline',
    provider_id: sub?.provider_id || user?.transaction_id || null,
    provider_status: status,
    stripe_status: sub?.stripe_status || status,
    plan_id: serializedPlan?.id || (user?.pack_id ? Number(user.pack_id) : null),
    plan_name: serializedPlan?.name || user?.pack_name || null,
    plan: serializedPlan,
    current_period_start: sub?.current_period_start || user?.start_at || null,
    current_period_end: periodEnd,
    ends_at: sub?.ends_at || null,
    trial_ends_at: trialEnd,
    is_trial: status === 'trialing',
    will_cancel: Boolean(sub?.ends_at && status === 'active'),
    is_active: true,
    created_at: sub?.created_at || user?.created_at || null,
    updated_at: sub?.updated_at || user?.updated_at || null,
  };
}

export function buildUserAccessState(user, sub = null, plan = null) {
  const activeSub = isSubscriptionActiveRow(sub) ? sub : null;
  const isUserPremium = Boolean(Number(user?.premuim || 0));
  const userExpiredAt = user?.expired_in ? Date.parse(String(user.expired_in).replace(' ', 'T')) : null;
  const userNotExpired = !Number.isFinite(userExpiredAt) || userExpiredAt >= Date.now() - 86400000;
  const isSubscribed = Boolean(activeSub || (isUserPremium && userNotExpired));
  const status = String(activeSub?.provider_status || activeSub?.stripe_status || (isSubscribed ? 'active' : 'inactive')).toLowerCase();

  return {
    is_subscribed: isSubscribed,
    is_premium: Boolean(isUserPremium || activeSub),
    has_active_subscription: Boolean(activeSub || isSubscribed),
    is_trial: status === 'trialing',
    will_cancel: Boolean(activeSub?.ends_at),
    status,
    provider: activeSub?.provider || user?.type || null,
    plan_id: plan?.id ? Number(plan.id) : user?.pack_id ? Number(user.pack_id) : null,
    plan_name: plan?.name || user?.pack_name || null,
    max_devices: Number(plan?.max_devices || 1),
    max_profiles: Number(plan?.max_profiles || 1),
    start_at: activeSub?.current_period_start || user?.start_at || null,
    expires_at: activeSub?.current_period_end || activeSub?.ends_at || user?.expired_in || null,
    trial_ends_at: activeSub?.trial_ends_at || null,
  };
}
