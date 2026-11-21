import { execute, nowIso, queryOne, runInTransaction } from '../db/sqlite.js';

export const CREDIT_CONTENT_TYPES = [
  'movie',
  'series_episode',
  'anime_episode',
  'iptv_channel',
  'live_tv',
];

export function normalizeContentType(type = '') {
  const normalized = String(type).trim().toLowerCase();
  if (['movie', 'movies'].includes(normalized)) return 'movie';
  if (['episode', 'series', 'serie', 'serie_episode', 'series_episode'].includes(normalized)) return 'series_episode';
  if (['anime', 'anime_episode', 'anime_episodes'].includes(normalized)) return 'anime_episode';
  if (['iptv', 'livetv_playlist', 'iptv_channel', 'playlist_channel'].includes(normalized)) return 'iptv_channel';
  if (['livetv', 'live_tv', 'live', 'streaming', 'live_stream', 'live_streaming'].includes(normalized)) return 'live_tv';
  return normalized;
}

export function isValidContentType(type) {
  return CREDIT_CONTENT_TYPES.includes(normalizeContentType(type));
}

export async function creditsSystemEnabled() {
  const row = await queryOne(`SELECT credits_system_enabled FROM settings ORDER BY id ASC LIMIT 1`);
  return Boolean(Number(row?.credits_system_enabled || 0));
}

export async function getOrCreateUserCredit(userId) {
  let row = await queryOne(`SELECT * FROM user_credits WHERE user_id = ?`, [userId]);
  if (!row) {
    const now = nowIso();
    await execute(
      `INSERT INTO user_credits (user_id, balance, total_purchased, total_spent, created_at, updated_at)
       VALUES (?, 0, 0, 0, ?, ?)`,
      [userId, now, now]
    );
    row = await queryOne(`SELECT * FROM user_credits WHERE user_id = ?`, [userId]);
  }
  return row;
}

export async function addCredits(userId, amount, type = 'admin_add', description = '', createdBy = null, paymentMethod = null, paymentReference = null) {
  const qty = Math.max(1, parseInt(amount, 10) || 0);
  const now = nowIso();

  return runInTransaction(async () => {
    const credit = await getOrCreateUserCredit(userId);
    const before = Number(credit.balance || 0);
    const after = before + qty;
    const isPurchase = type === 'purchase';

    await execute(
      `UPDATE user_credits
       SET balance = ?, total_purchased = total_purchased + ?, updated_at = ?
       WHERE user_id = ?`,
      [after, isPurchase ? qty : 0, now, userId]
    );

    await execute(
      `INSERT INTO credit_transactions (
         user_id, type, credits_amount, balance_before, balance_after,
         payment_method, payment_reference, description, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, type, qty, before, after, paymentMethod, paymentReference, description, createdBy, now, now]
    );

    return getOrCreateUserCredit(userId);
  });
}

export async function removeCredits(userId, amount, description = 'Admin removed credits.', createdBy = null) {
  const qty = Math.max(1, parseInt(amount, 10) || 0);
  const now = nowIso();

  return runInTransaction(async () => {
    const credit = await getOrCreateUserCredit(userId);
    const before = Number(credit.balance || 0);
    if (before < qty) {
      throw new Error('Insufficient credit balance.');
    }
    const after = before - qty;

    await execute(
      `UPDATE user_credits SET balance = ?, updated_at = ? WHERE user_id = ?`,
      [after, now, userId]
    );

    await execute(
      `INSERT INTO credit_transactions (
         user_id, type, credits_amount, balance_before, balance_after,
         description, created_by, created_at, updated_at
       ) VALUES (?, 'admin_remove', ?, ?, ?, ?, ?, ?, ?)`,
      [userId, -qty, before, after, description, createdBy, now, now]
    );

    return getOrCreateUserCredit(userId);
  });
}

export async function spendCreditsForUnlock(userId, contentType, contentId) {
  const normalizedType = normalizeContentType(contentType);
  if (!isValidContentType(normalizedType)) {
    throw new Error('Invalid content type.');
  }

  const now = nowIso();
  const settings = await queryOne(`SELECT credits_system_enabled, premium_users_bypass_credits, credit_unlock_policy FROM settings ORDER BY id ASC LIMIT 1`);
  const user = await queryOne(`SELECT id, premuim FROM users WHERE id = ?`, [userId]);
  if (!user) throw new Error('User not found.');

  if (!Number(settings?.credits_system_enabled)) {
    const wallet = await getOrCreateUserCredit(userId);
    return { unlocked: true, credits_spent: 0, balance: wallet.balance, bypass: 'system_disabled' };
  }

  if (Number(settings?.premium_users_bypass_credits) === 1 && Number(user.premuim) === 1) {
    const wallet = await getOrCreateUserCredit(userId);
    return { unlocked: true, credits_spent: 0, balance: wallet.balance, bypass: 'premium' };
  }

  const policy = settings?.credit_unlock_policy || 'forever';
  const existing = await queryOne(
    `SELECT * FROM user_content_unlocks WHERE user_id = ? AND content_type = ? AND content_id = ?`,
    [userId, normalizedType, contentId]
  );

  if (existing && policy === 'forever' && existing.status === 'consumed') {
    const wallet = await getOrCreateUserCredit(userId);
    return { unlocked: true, already_unlocked: true, credits_spent: 0, balance: wallet.balance };
  }

  const priceRow = await queryOne(
    `SELECT * FROM content_credit_prices WHERE content_type = ? AND content_id = ?`,
    [normalizedType, contentId]
  );
  const required = priceRow
    ? (Number(priceRow.is_credit_enabled) ? Number(priceRow.credits_required || 0) : 0)
    : 1;

  if (required <= 0) {
    const wallet = await getOrCreateUserCredit(userId);
    return { unlocked: true, credits_spent: 0, balance: wallet.balance };
  }

  return runInTransaction(async () => {
    const credit = await getOrCreateUserCredit(userId);
    const before = Number(credit.balance || 0);
    if (before < required) {
      throw new Error('Insufficient credits to unlock this content.');
    }
    const after = before - required;

    await execute(
      `UPDATE user_credits SET balance = ?, total_spent = total_spent + ?, updated_at = ? WHERE user_id = ?`,
      [after, required, now, userId]
    );

    await execute(
      `INSERT INTO credit_transactions (
         user_id, type, credits_amount, balance_before, balance_after,
         content_type, content_id, description, created_at, updated_at
       ) VALUES (?, 'spend', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, -required, before, after, normalizedType, contentId, `Unlocked ${normalizedType} #${contentId}`, now, now]
    );

    const existingUnlock = await queryOne(
      `SELECT id FROM user_content_unlocks WHERE user_id = ? AND content_type = ? AND content_id = ?`,
      [userId, normalizedType, contentId]
    );
    if (existingUnlock) {
      await execute(
        `UPDATE user_content_unlocks
         SET credits_spent = ?, status = 'consumed', unlocked_at = ?, consumed_at = ?, updated_at = ?
         WHERE id = ?`,
        [required, now, now, now, existingUnlock.id]
      );
    } else {
      await execute(
        `INSERT INTO user_content_unlocks (user_id, content_type, content_id, credits_spent, status, unlocked_at, consumed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'consumed', ?, ?, ?, ?)`,
        [userId, normalizedType, contentId, required, now, now, now, now]
      );
    }

    return { unlocked: true, credits_spent: required, balance: after };
  });
}

export async function getCreditStatus({ user = null, contentType, contentId }) {
  const normalizedType = normalizeContentType(contentType);
  const id = Number(contentId || 0);
  const settings =
    (await queryOne(
      `SELECT credits_system_enabled, premium_users_bypass_credits, credit_unlock_policy FROM settings ORDER BY id ASC LIMIT 1`
    )) || {};
  const enabled = Boolean(Number(settings.credits_system_enabled || 0));
  const policy = settings.credit_unlock_policy || 'forever';
  const unlockExpiresAfterPlayback = policy !== 'forever';
  const premiumBypassEnabled = Number(settings.premium_users_bypass_credits ?? 1) === 1;
  const isAdmin = user?.role === 'admin' || Boolean(user?.is_admin);
  const isPremium = Boolean(Number(user?.premuim || 0)) || isAdmin;
  const premiumBypass = isAdmin || (premiumBypassEnabled && isPremium);

  let balance = 0;
  let existingUnlock = null;
  if (user?.id) {
    const wallet = await getOrCreateUserCredit(user.id);
    balance = Number(wallet?.balance || 0);
    if (id) {
      existingUnlock = await queryOne(
        `SELECT * FROM user_content_unlocks WHERE user_id = ? AND content_type = ? AND content_id = ?`,
        [user.id, normalizedType, id]
      );
    }
  }

  let priceRow = null;
  if (id) {
    priceRow = await queryOne(
      `SELECT * FROM content_credit_prices WHERE content_type = ? AND content_id = ?`,
      [normalizedType, id]
    );
  }
  const creditsRequired = priceRow
    ? Number(priceRow.is_credit_enabled)
      ? Number(priceRow.credits_required || 0)
      : 0
    : 1;

  const alreadyConsumed = Boolean(existingUnlock && existingUnlock.status === 'consumed');
  const alreadyUnlocked = Boolean(existingUnlock && (!unlockExpiresAfterPlayback || existingUnlock.status !== 'expired'));
  const contentExists = id ? await findContentRecord(normalizedType, id) : null;
  const adsUnlockAvailable = Boolean(Number(contentExists?.enable_ads_unlock || 0));

  const requiresCredits = enabled && !premiumBypass && creditsRequired > 0;
  const creditRequired = requiresCredits && !alreadyUnlocked;
  const hasEnoughCredits = balance >= creditsRequired;
  const streamAvailable = !requiresCredits || alreadyUnlocked;

  return {
    content_type: normalizedType,
    content_id: id,
    credits_system_enabled: enabled,
    is_credit_enabled: creditsRequired > 0,
    credit_unlock_policy: policy,
    unlock_expires_after_playback: unlockExpiresAfterPlayback,
    credit_required: creditRequired,
    requires_credits: requiresCredits,
    has_enough_credits: hasEnoughCredits,
    already_unlocked: alreadyUnlocked,
    already_consumed: alreadyConsumed,
    server_access: streamAvailable,
    recent_consumed_stream_access: alreadyConsumed && streamAvailable,
    premium_bypass: premiumBypass,
    ads_unlock_available: adsUnlockAvailable,
    credits_skipped_by_ads_unlock: false,
    balance,
    user_balance: balance,
    credit_balance: balance,
    credits_required: requiresCredits ? creditsRequired : 0,
    consume_after_seconds: 0,
    stream_available: streamAvailable,
  };
}

export async function findContentRecord(type, id) {
  const t = normalizeContentType(type);
  switch (t) {
    case 'movie':
      return queryOne(`SELECT id, title AS name, poster_path, enable_ads_unlock FROM movies WHERE id = ?`, [id]);
    case 'series_episode':
      return queryOne(`SELECT id, name, still_path AS poster_path, enable_ads_unlock FROM episodes WHERE id = ?`, [id]);
    case 'anime_episode':
      return queryOne(`SELECT id, name, still_path AS poster_path, enable_ads_unlock FROM anime_episodes WHERE id = ?`, [id]);
    case 'live_tv':
      return queryOne(`SELECT id, name, poster_path, 0 AS enable_ads_unlock FROM livetvs WHERE id = ?`, [id]);
    default:
      return null;
  }
}
