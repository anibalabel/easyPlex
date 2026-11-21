import { Router } from 'express';
import { execute, nowIso, paginateQuery, queryAll, queryOne, runInTransaction } from '../../db/sqlite.js';
import { makeAsyncRouter } from '../../middleware/asyncHandler.js';
import { requireAdminOrModerator, requirePermission } from '../../middleware/auth.js';

const router = makeAsyncRouter(Router());
router.use('/admin', requireAdminOrModerator);

// ================= COMMENTS =================
async function resolveMediaInfo(type, id) {
  const t = String(type || '').toLowerCase();
  if (t.includes('movie')) {
    const m = await queryOne(`SELECT id, title FROM movies WHERE id = ?`, [id]);
    return { title: m?.title || `Movie #${id}`, type: 'movie', type_label: 'Movie' };
  }
  if (t.includes('anime_episode') || t.includes('animeepisode')) {
    const e = await queryOne(`SELECT id, name FROM anime_episodes WHERE id = ?`, [id]);
    return { title: e?.name || `Anime Episode #${id}`, type: 'anime_episode', type_label: 'Anime Episode' };
  }
  if (t.includes('anime')) {
    const a = await queryOne(`SELECT id, name FROM animes WHERE id = ?`, [id]);
    return { title: a?.name || `Anime #${id}`, type: 'anime', type_label: 'Anime' };
  }
  if (t.includes('episode')) {
    const e = await queryOne(`SELECT id, name FROM episodes WHERE id = ?`, [id]);
    return { title: e?.name || `Episode #${id}`, type: 'episode', type_label: 'Episode' };
  }
  if (t.includes('serie')) {
    const s = await queryOne(`SELECT id, name FROM series WHERE id = ?`, [id]);
    return { title: s?.name || `Series #${id}`, type: 'series', type_label: 'Series' };
  }
  if (t.includes('reel')) {
    const r = await queryOne(`SELECT id, title FROM reels WHERE id = ?`, [id]);
    return { title: r?.title || `Reel #${id}`, type: 'reel', type_label: 'Reel' };
  }
  return { title: `Media #${id}`, type: t || 'other', type_label: 'Media' };
}

router.get('/admin/comments/allcomments', requirePermission('comments.view'), async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const type = String(req.query?.type || '').trim();
  const reaction = String(req.query?.reaction || '').trim();
  const sort = String(req.query?.sort || 'newest');
  const perPage = Math.min(100, Math.max(1, Number(req.query?.per_page || 12)));

  const where = [];
  const params = [];
  if (q) {
    where.push(`(comment LIKE ? OR user_name LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (type) {
    where.push(`lower(commentable_type) LIKE ?`);
    params.push(`%${type.toLowerCase()}%`);
  }
  if (reaction === 'liked') where.push(`likes_count > 0`);
  if (reaction === 'disliked') where.push(`dislikes_count > 0`);
  if (reaction === 'controversial') where.push(`likes_count > 0 AND dislikes_count > 0`);
  if (reaction === 'no_reactions') where.push(`likes_count = 0 AND dislikes_count = 0`);

  const orderMap = {
    recently_updated: 'updated_at DESC',
    newest: 'created_at DESC, id DESC',
    oldest: 'created_at ASC, id ASC',
    most_liked: 'likes_count DESC, id DESC',
    most_disliked: 'dislikes_count DESC, id DESC',
    most_reacted: '(likes_count + dislikes_count) DESC, id DESC',
  };

  const result = await paginateQuery({
    baseFrom: 'FROM comments',
    whereSql: where.join(' AND '),
    params,
    orderBySql: orderMap[sort] || 'created_at DESC, id DESC',
    page: req.query?.page || 1,
    perPage,
    mapRow: async (row) => {
      const [info, reactionRow] = await Promise.all([
        resolveMediaInfo(row.commentable_type, row.commentable_id),
        queryOne(
          `SELECT reaction FROM comment_reactions WHERE comment_id = ? AND user_id = ?`,
          [row.id, req.user.id]
        ),
      ]);
      return {
        ...row,
        media_id: row.commentable_id,
        title: info.title,
        type: info.type,
        type_label: info.type_label,
        reactions_total: Number(row.likes_count || 0) + Number(row.dislikes_count || 0),
        reaction_score: Number(row.likes_count || 0) - Number(row.dislikes_count || 0),
        comment_excerpt: String(row.comment || '').slice(0, 120),
        my_reaction: reactionRow?.reaction || null,
      };
    },
  });

  return res.json(result);
});

router.post('/admin/comments/:comment/approve', requirePermission('comments.approve'), async (req, res) => {
  const id = Number(req.params.comment);
  await execute(`UPDATE comments SET is_approved = 1, updated_at = ? WHERE id = ?`, [nowIso(), id]);
  return res.json({ status: 200, message: 'Comment approved.' });
});

router.post('/admin/comments/:comment/reaction', requirePermission('comments.approve'), async (req, res) => {
  const commentId = Number(req.params.comment);
  const reaction = req.body?.reaction === 'dislike' ? 'dislike' : 'like';
  const comment = await queryOne(`SELECT * FROM comments WHERE id = ?`, [commentId]);
  if (!comment) return res.status(404).json({ message: 'Comment not found.' });

  const now = nowIso();
  const existing = await queryOne(
    `SELECT * FROM comment_reactions WHERE comment_id = ? AND user_id = ?`,
    [commentId, req.user.id]
  );
  let status = 'added';
  let myReaction = reaction;

  await runInTransaction(async () => {
    if (existing && existing.reaction === reaction) {
      await execute(`DELETE FROM comment_reactions WHERE id = ?`, [existing.id]);
      status = 'removed';
      myReaction = null;
    } else if (existing) {
      await execute(`UPDATE comment_reactions SET reaction = ?, updated_at = ? WHERE id = ?`, [
        reaction,
        now,
        existing.id,
      ]);
      status = 'switched';
    } else {
      await execute(
        `INSERT INTO comment_reactions (comment_id, user_id, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [commentId, req.user.id, reaction, now, now]
      );
    }

    const likesRow = await queryOne(
      `SELECT COUNT(*) AS c FROM comment_reactions WHERE comment_id = ? AND reaction = 'like'`,
      [commentId]
    );
    const dislikesRow = await queryOne(
      `SELECT COUNT(*) AS c FROM comment_reactions WHERE comment_id = ? AND reaction = 'dislike'`,
      [commentId]
    );
    await execute(`UPDATE comments SET likes_count = ?, dislikes_count = ?, updated_at = ? WHERE id = ?`, [
      Number(likesRow?.c || 0),
      Number(dislikesRow?.c || 0),
      now,
      commentId,
    ]);
  });

  const updated = await queryOne(`SELECT likes_count, dislikes_count FROM comments WHERE id = ?`, [commentId]);
  return res.json({ status, comment_id: commentId, my_reaction: myReaction, counts: updated });
});

router.delete('/admin/comments/:comment/reaction', requirePermission('comments.approve'), async (req, res) => {
  const commentId = Number(req.params.comment);
  await execute(`DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?`, [commentId, req.user.id]);
  const [likesRow, dislikesRow] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS c FROM comment_reactions WHERE comment_id = ? AND reaction = 'like'`, [commentId]),
    queryOne(`SELECT COUNT(*) AS c FROM comment_reactions WHERE comment_id = ? AND reaction = 'dislike'`, [commentId]),
  ]);
  const likes = Number(likesRow?.c || 0);
  const dislikes = Number(dislikesRow?.c || 0);
  await execute(`UPDATE comments SET likes_count = ?, dislikes_count = ?, updated_at = ? WHERE id = ?`, [
    likes,
    dislikes,
    nowIso(),
    commentId,
  ]);
  return res.json({
    status: 'removed',
    comment_id: commentId,
    my_reaction: null,
    counts: { likes_count: likes, dislikes_count: dislikes },
  });
});

router.delete('/admin/media/delete/comments/:movieid', requirePermission('comments.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM comments WHERE id = ?`, [Number(req.params.movieid)]);
  return res.json({ status: result.changes ? 200 : 404, message: result.changes ? 'Comment deleted.' : 'Not found' });
});

// ================= REPORTS =================
router.get('/admin/reports/data', requirePermission('reports.view'), async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM reports ORDER BY id DESC`));
});

router.post('/admin/reports/send', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!title || !message) return res.status(422).json({ message: 'Title and message are required.' });
  const now = nowIso();
  const resInsert = await execute(
    `INSERT INTO reports (title, message, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [title, message, now, now]
  );
  return res.json({
    status: 200,
    message: 'created successfully',
    body: await queryOne(`SELECT * FROM reports WHERE id = ?`, [Number(resInsert.lastInsertRowid)]),
  });
});

router.delete('/admin/reports/destroy/:report', requirePermission('reports.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM reports WHERE id = ?`, [Number(req.params.report)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= SUGGESTIONS =================
router.get('/admin/suggestions/data', requirePermission('suggestions.view'), async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM suggestions ORDER BY created_at DESC, id DESC`));
});

router.post('/admin/suggestions/send', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!title || !message) return res.status(422).json({ message: 'Title and message are required.' });
  const now = nowIso();
  const resInsert = await execute(
    `INSERT INTO suggestions (title, message, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [title, message, now, now]
  );
  return res.json({
    status: 200,
    message: 'created successfully',
    body: await queryOne(`SELECT * FROM suggestions WHERE id = ?`, [Number(resInsert.lastInsertRowid)]),
  });
});

router.delete('/admin/suggestions/destroy/:report', requirePermission('suggestions.delete'), async (req, res) => {
  const result = await execute(`DELETE FROM suggestions WHERE id = ?`, [Number(req.params.report)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= ADS MANAGER =================
router.get('/admin/ads/data', requirePermission('ads.view'), async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM ads ORDER BY id DESC`));
});

router.post('/admin/ads/store', requirePermission('ads.update'), async (req, res) => {
  const payload = req.body?.ads || req.body?.ad || req.body;
  const title = String(payload?.title || '').trim();
  const link = String(payload?.link || '').trim();
  if (!title || !link) return res.status(422).json({ message: 'Ad title and link are required.' });
  const now = nowIso();
  const result = await execute(
    `INSERT INTO ads (title, link, clickThroughUrl, customVast, duration, skipoffset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      link,
      payload?.clickThroughUrl || '',
      payload?.customVast ? 1 : 0,
      payload?.duration || '30',
      payload?.skipoffset || '5',
      now,
      now,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully created',
    body: await queryOne(`SELECT * FROM ads WHERE id = ?`, [Number(result.lastInsertRowid)]),
  });
});

router.put('/admin/ads/update/:ads', requirePermission('ads.update'), async (req, res) => {
  const id = Number(req.params.ads);
  const existing = await queryOne(`SELECT * FROM ads WHERE id = ?`, [id]);
  if (!existing) return res.status(404).json({ message: 'Ad not found.' });
  const payload = req.body?.ads || req.body?.ad || req.body;
  await execute(
    `UPDATE ads SET title = ?, link = ?, clickThroughUrl = ?, customVast = ?, duration = ?, skipoffset = ?, updated_at = ? WHERE id = ?`,
    [
      payload?.title ?? existing.title,
      payload?.link ?? existing.link,
      payload?.clickThroughUrl ?? existing.clickThroughUrl,
      payload?.customVast !== undefined ? (payload.customVast ? 1 : 0) : existing.customVast,
      payload?.duration ?? existing.duration,
      payload?.skipoffset ?? existing.skipoffset,
      nowIso(),
      id,
    ]
  );
  return res.json({
    status: 200,
    message: 'successfully updated',
    body: await queryOne(`SELECT * FROM ads WHERE id = ?`, [id]),
  });
});

router.delete('/admin/ads/destroy/:ads', requirePermission('ads.update'), async (req, res) => {
  const result = await execute(`DELETE FROM ads WHERE id = ?`, [Number(req.params.ads)]);
  return res.json({
    status: result.changes ? 200 : 400,
    message: result.changes ? 'successfully deleted' : 'could not be deleted',
  });
});

// ================= NOTIFICATIONS =================
router.get('/admin/notifications/logs', requirePermission('notifications.send'), async (_req, res) => {
  return res.json(await queryAll(`SELECT * FROM notification_logs ORDER BY id DESC LIMIT 50`));
});

router.post('/admin/notifications/onesignal', requirePermission('notifications.send'), async (req, res) => {
  const settings = await queryOne(
    `SELECT onesignal_app_id, onesignal_rest_api_key, included_segments FROM settings WHERE id = 1`
  );
  const data = req.body?.data || {};
  const title = data.title || req.body?.headings?.en || '';
  const message = data.message || req.body?.contents?.en || title;
  const image = data.image || req.body?.big_picture || '';
  const link = data.link || req.body?.url || '';
  const now = nowIso();

  let remoteStatus = 'logged_local';
  let remoteBody = null;

  if (settings?.onesignal_app_id && settings?.onesignal_rest_api_key) {
    try {
      const authHeader = settings.onesignal_rest_api_key.startsWith('Basic ')
        ? settings.onesignal_rest_api_key
        : `Basic ${settings.onesignal_rest_api_key}`;
      const resp = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({
          app_id: settings.onesignal_app_id,
          included_segments: req.body?.included_segments?.length
            ? req.body.included_segments
            : [settings.included_segments || 'All'],
          headings: { en: title },
          contents: { en: message },
          ...(image ? { big_picture: image } : {}),
          ...(link ? { url: link } : {}),
          data: { type: String(data.type || 'custom'), tmdb: String(data.tmdb || ''), title, message, image, link },
        }),
      });
      remoteBody = await resp.json().catch(() => ({}));
      remoteStatus = resp.ok ? 'sent' : 'failed';
    } catch (err) {
      remoteStatus = 'error';
      remoteBody = { error: err.message };
    }
  }

  await execute(
    `INSERT INTO notification_logs (provider, title, message, type, tmdb, image, link, payload, status, created_by, created_at)
     VALUES ('onesignal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      message,
      String(data.type || 'custom'),
      String(data.tmdb || ''),
      image,
      link,
      JSON.stringify(req.body || {}),
      remoteStatus,
      req.user.id,
      now,
    ]
  );

  return res.json({
    success: true,
    status: remoteStatus,
    message:
      remoteStatus === 'logged_local'
        ? 'Notification logged locally (configure OneSignal App ID & REST Key in Settings to push live).'
        : 'OneSignal notification processed.',
    details: remoteBody,
  });
});

router.post('/admin/notifications/firebase', requirePermission('notifications.send'), async (req, res) => {
  const msg = req.body?.message || {};
  const notif = msg.notification || {};
  const data = msg.data || {};
  const title = data.title || notif.title || '';
  const body = data.message || notif.body || '';
  const image = data.image || notif.image || '';
  const link = data.link || '';
  const now = nowIso();

  await execute(
    `INSERT INTO notification_logs (provider, title, message, type, tmdb, image, link, payload, status, created_by, created_at)
     VALUES ('firebase', ?, ?, ?, ?, ?, ?, ?, 'logged_local', ?, ?)`,
    [
      title,
      body,
      String(data.type || 'custom'),
      String(data.tmdb || ''),
      image,
      link,
      JSON.stringify(msg),
      req.user.id,
      now,
    ]
  );

  return res.json({
    success: true,
    message: 'Firebase notification queued & logged.',
  });
});

export default router;
