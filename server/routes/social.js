// Social Media Admin API Routes
// All routes require admin authentication.
// Manages connected accounts, posting rules, manual/automatic posts, queue, logs.
const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { PLATFORMS, getOAuthUrl } = require('../lib/social/platforms');
const scheduler = require('../lib/social/scheduler');

const router = express.Router();
router.use(auth.requireAuth, auth.requireAdmin);

// ---- Overview / Stats ----
router.get('/stats', (req, res) => {
  res.json(scheduler.socialStats());
});

// ---- Platform Info ----
router.get('/platforms', (req, res) => {
  const list = Object.keys(PLATFORMS).map(slug => {
    const p = PLATFORMS[slug];
    return {
      slug,
      name: p.name,
      content_types: p.content_types,
      has_video: !!p.has_video,
      max_caption: p.max_caption,
      requires_app_review: !!p.requires_app_review,
      review_note: p.review_note || '',
      requires_paid: !!p.requires_paid,
      paid_note: p.paid_note || '',
      setup_steps: p.setup_steps || [],
      auth_type: p.auth_type || 'oauth',
      no_oauth: !!p.no_oauth
    };
  });
  res.json({ platforms: list });
});

// ---- Connected Accounts ----
router.get('/accounts', (req, res) => {
  const accounts = db.all(
    'SELECT id, platform, platform_user_id, account_name, account_label, page_name, avatar_url, connected, enabled, last_post_at, last_error, token_expires_at, created_at, updated_at FROM social_accounts ORDER BY id'
  );

  // Attach posting rules count
  const result = accounts.map(a => {
    const rules = db.get('SELECT COUNT(*) AS c FROM posting_rules WHERE account_id=?', [a.id]);
    const posts = db.get('SELECT COUNT(*) AS c FROM social_posts WHERE account_id=? AND status="published"', [a.id]);
    const queue = db.get('SELECT COUNT(*) AS c FROM social_posts WHERE account_id=? AND status IN ("queued","scheduled","pending")', [a.id]);
    return {
      ...a,
      posting_rules_count: rules ? rules.c : 0,
      total_posts: posts ? posts.c : 0,
      queued_posts: queue ? queue.c : 0,
      token_valid: a.token_expires_at ? a.token_expires_at > db.now() : true,
      platform_info: PLATFORMS[a.platform] ? PLATFORMS[a.platform].name : a.platform
    };
  });
  res.json({ accounts: result });
});

// ---- Connect: get OAuth URL or save manual credentials ----
router.post('/accounts/connect', (req, res) => {
  const { platform, label } = req.body || {};
  if (!platform) return res.status(400).json({ error: 'platform required' });

  const plat = PLATFORMS[platform];
  if (!plat) return res.status(400).json({ error: 'Unknown platform: ' + platform });

  if (plat.no_oauth) {
    // Bot token / webhook platforms: store credentials directly
    const { token, channel_id, webhook_url } = req.body || {};
    const existing = db.get('SELECT id FROM social_accounts WHERE platform=?', [platform]);

    if (existing) {
      db.run(
        `UPDATE social_accounts SET webhook_url=?, page_id=?, account_name=?, account_label=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [token || webhook_url || '', channel_id || '', label || platform, label || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, page_id, account_name, account_label, webhook_url, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,1,1,?,?)`,
        [platform, channel_id || '', label || platform, label || '', token || webhook_url || '', db.now(), db.now()]
      );
    }
    db.persist();
    return res.json({ ok: true, connected: true, method: 'direct' });
  }

  // OAuth platforms: generate the authorization URL
  const state = 'wf_' + platform + '_' + db.now();
  const url = getOAuthUrl(platform, state);
  if (!url) return res.status(400).json({ error: 'Cannot generate OAuth URL — check server environment variables for ' + platform + '_CLIENT_ID and ' + platform + '_CLIENT_SECRET' });

  // Store state for CSRF validation
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", ['oauth_state_' + state, platform]);
  db.persist();

  // Clean old states (older than 10 minutes)
  const cutoff = db.now() - 600;
  db.all("SELECT key FROM settings WHERE key LIKE 'oauth_state_%'").forEach(row => {
    const parts = row.key.split('_');
    const ts = parseInt(parts[2], 10);
    if (ts && ts < cutoff) db.run('DELETE FROM settings WHERE key=?', [row.key]);
  });

  res.json({ ok: true, auth_url: url, method: 'oauth', platform });
});

// ---- Disconnect an account ----
router.post('/accounts/disconnect', (req, res) => {
  const { account_id } = req.body || {};
  if (!account_id) return res.status(400).json({ error: 'account_id required' });

  const account = db.get('SELECT id FROM social_accounts WHERE id=?', [parseInt(account_id, 10)]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.run('UPDATE social_accounts SET connected=0, access_token=NULL, refresh_token=NULL, token_expires_at=NULL, updated_at=? WHERE id=?',
    [db.now(), account.id]);
  db.run('UPDATE posting_rules SET enabled=0 WHERE account_id=?', [account.id]);
  db.persist();
  res.json({ ok: true });
});

// ---- Enable/Disable an account ----
router.post('/accounts/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const account = db.get('SELECT id, enabled FROM social_accounts WHERE id=?', [id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.run('UPDATE social_accounts SET enabled=?, updated_at=? WHERE id=?',
    [account.enabled ? 0 : 1, db.now(), id]);
  db.persist();
  res.json({ ok: true, enabled: !account.enabled });
});

// ---- Update account label ----
router.put('/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const account = db.get('SELECT id FROM social_accounts WHERE id=?', [id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const { account_label, page_id, page_name, account_name } = req.body || {};
  db.run(
    'UPDATE social_accounts SET account_label=COALESCE(?,account_label), page_id=COALESCE(?,page_id), page_name=COALESCE(?,page_name), account_name=COALESCE(?,account_name), updated_at=? WHERE id=?',
    [account_label || null, page_id || null, page_name || null, account_name || null, db.now(), id]
  );
  db.persist();
  res.json({ ok: true });
});

// ---- Delete an account ----
router.delete('/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run('DELETE FROM posting_rules WHERE account_id=?', [id]);
  db.run('DELETE FROM social_posts WHERE account_id=?', [id]);
  db.run('DELETE FROM social_queue WHERE account_id=?', [id]);
  db.run('DELETE FROM social_post_log WHERE account_id=?', [id]);
  db.run('DELETE FROM social_accounts WHERE id=?', [id]);
  db.persist();
  res.json({ ok: true });
});

// ---- Posting Rules ----
router.get('/rules', (req, res) => {
  const rules = db.all(
    'SELECT pr.*, sa.platform, sa.account_name, sa.account_label FROM posting_rules pr LEFT JOIN social_accounts sa ON sa.id=pr.account_id ORDER BY pr.id'
  );
  res.json({ rules });
});

router.get('/rules/:id', (req, res) => {
  const rule = db.get(
    'SELECT pr.*, sa.platform, sa.account_name, sa.account_label FROM posting_rules pr LEFT JOIN social_accounts sa ON sa.id=pr.account_id WHERE pr.id=?',
    [parseInt(req.params.id, 10)]
  );
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json({ rule });
});

router.post('/rules', (req, res) => {
  const b = req.body || {};
  if (!b.account_id) return res.status(400).json({ error: 'account_id required' });

  const account = db.get('SELECT id FROM social_accounts WHERE id=?', [parseInt(b.account_id, 10)]);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.run(
    `INSERT INTO posting_rules (account_id, enabled, content_types, frequency, time_of_day, day_of_week, day_of_month,
     max_posts_per_day, require_approval, auto_select, include_image, include_link, hashtag_template, caption_template, exclude_ids, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [account.id, b.enabled !== false ? 1 : 0,
     JSON.stringify(b.content_types || ['articles', 'products']),
     b.frequency || 'daily', b.time_of_day || '09:00', b.day_of_week || '*', b.day_of_month || null,
     b.max_posts_per_day || 3, b.require_approval ? 1 : 0, b.auto_select !== false ? 1 : 0,
     b.include_image !== false ? 1 : 0, b.include_link !== false ? 1 : 0,
     b.hashtag_template || '', b.caption_template || '',
     JSON.stringify(b.exclude_ids || []), db.now(), db.now()]
  );
  const row = db.get('SELECT last_insert_rowid() AS id');
  db.persist();
  res.json({ ok: true, id: row.id });
});

router.put('/rules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rule = db.get('SELECT * FROM posting_rules WHERE id=?', [id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const b = req.body || {};

  db.run(
    `UPDATE posting_rules SET enabled=?, content_types=?, frequency=?, time_of_day=?, day_of_week=?, day_of_month=?,
     max_posts_per_day=?, require_approval=?, auto_select=?, include_image=?, include_link=?,
     hashtag_template=?, caption_template=?, exclude_ids=?, updated_at=? WHERE id=?`,
    [b.enabled !== undefined ? (b.enabled ? 1 : 0) : rule.enabled,
     b.content_types ? JSON.stringify(b.content_types) : rule.content_types,
     b.frequency || rule.frequency,
     b.time_of_day || rule.time_of_day,
     b.day_of_week || rule.day_of_week,
     b.day_of_month !== undefined ? b.day_of_month : rule.day_of_month,
     b.max_posts_per_day !== undefined ? b.max_posts_per_day : rule.max_posts_per_day,
     b.require_approval !== undefined ? (b.require_approval ? 1 : 0) : rule.require_approval,
     b.auto_select !== undefined ? (b.auto_select ? 1 : 0) : rule.auto_select,
     b.include_image !== undefined ? (b.include_image ? 1 : 0) : rule.include_image,
     b.include_link !== undefined ? (b.include_link ? 1 : 0) : rule.include_link,
     b.hashtag_template !== undefined ? b.hashtag_template : rule.hashtag_template,
     b.caption_template !== undefined ? b.caption_template : rule.caption_template,
     b.exclude_ids !== undefined ? JSON.stringify(b.exclude_ids) : rule.exclude_ids,
     db.now(), id]
  );
  db.persist();
  res.json({ ok: true });
});

router.delete('/rules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run('DELETE FROM posting_rules WHERE id=?', [id]);
  db.persist();
  res.json({ ok: true });
});

// ---- Toggle a rule ----
router.post('/rules/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rule = db.get('SELECT id, enabled FROM posting_rules WHERE id=?', [id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  db.run('UPDATE posting_rules SET enabled=?, updated_at=? WHERE id=?', [rule.enabled ? 0 : 1, db.now(), id]);
  db.persist();
  res.json({ ok: true, enabled: !rule.enabled });
});

// ---- Manual Posts ----
router.get('/posts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const status = req.query.status || '';
  const account_id = parseInt(req.query.account_id, 10) || 0;
  const post_type = req.query.post_type || '';

  let where = '1=1';
  const params = [];
  if (status) { where += ' AND sp.status=?'; params.push(status); }
  if (account_id) { where += ' AND sp.account_id=?'; params.push(account_id); }
  if (post_type) { where += ' AND sp.post_type=?'; params.push(post_type); }

  const posts = db.all(
    `SELECT sp.*, sa.platform, sa.account_name, sa.account_label
     FROM social_posts sp LEFT JOIN social_accounts sa ON sa.id=sp.account_id
     WHERE ${where} ORDER BY sp.id DESC LIMIT ?`,
    [...params, limit]
  );
  res.json({ posts });
});

router.post('/posts/manual', (req, res) => {
  const b = req.body || {};
  if (!b.account_id) return res.status(400).json({ error: 'account_id required' });
  if (!b.content_url && !b.content_title) return res.status(400).json({ error: 'content_url or content_title required' });

  const account = db.get('SELECT id FROM social_accounts WHERE id=? AND connected=1', [parseInt(b.account_id, 10)]);
  if (!account) return res.status(404).json({ error: 'Connected account not found' });

  const scheduledAt = b.scheduled_at ? parseInt(b.scheduled_at, 10) : db.now();
  // Drafts are stored as 'pending' so the scheduler never auto-publishes them.
  const allowedStatuses = new Set(['queued', 'scheduled', 'pending']);
  const status = b.scheduled_at ? 'scheduled' : (b.status && allowedStatuses.has(b.status) ? b.status : 'queued');
  const postType = 'manual';
  const idempotencyKey = 'manual_' + account.id + '_' + db.now() + '_' + Math.random().toString(36).slice(2, 8);

  db.run(
    `INSERT INTO social_posts (account_id, content_type, content_id, content_url, content_title, content_summary, content_image,
     custom_caption, custom_hashtags, media_url, media_type, post_type, status, scheduled_at, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [account.id, b.content_type || 'article', b.content_id || 0,
     b.content_url || '', b.content_title || '', b.content_summary || '', b.content_image || '',
     b.custom_caption || '', b.custom_hashtags || '', b.media_url || '', b.media_type || 'image',
     postType, status, scheduledAt, idempotencyKey, db.now()]
  );
  // Read the rowid before persist() (sql.js export() resets last_insert_rowid()).
  const row = db.get('SELECT last_insert_rowid() AS id');
  db.persist();

  if (b.publish_now) {
    // Publish immediately. executePost handles all status transitions
    // (publishing -> published / queued-for-retry / failed), so no extra
    // status writes are done here. Any later retry stays intact.
    scheduler.executePost(row.id).catch(() => {});
  }

  res.json({ ok: true, id: row.id, status });
});

// ---- Preview content for posting ----
router.get('/content/preview', (req, res) => {
  const type = req.query.type || 'articles';
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const content = scheduler.collectContent(0, [type], limit);
  res.json({ content });
});

// ---- Get available content for manual selection ----
router.get('/content/available', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const all = [
    ...scheduler.collectContent(0, ['articles'], limit).map(c => ({ ...c, type_label: 'News Article' })),
    ...scheduler.collectContent(0, ['site_articles'], limit).map(c => ({ ...c, type_label: 'Site Article' })),
    ...scheduler.collectContent(0, ['products'], Math.min(limit, 10)).map(c => ({ ...c, type_label: 'Product' })),
    ...scheduler.collectContent(0, ['breaking'], 10).map(c => ({ ...c, type_label: 'Breaking News' }))
  ];
  all.sort((a, b) => (b.published_at || 0) - (a.published_at || 0));
  res.json({ content: all.slice(0, limit) });
});

// ---- Approve a pending post ----
router.post('/posts/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = db.get('SELECT * FROM social_posts WHERE id=?', [id]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'queued' && post.status !== 'scheduled' && post.status !== 'pending') {
    return res.status(400).json({ error: 'Post is in status: ' + post.status });
  }

  scheduler.executePost(id).then(result => {
    if (result.ok) {
      res.json({ ok: true, message: result.message, platform_url: result.platform_url });
    } else {
      res.json({ ok: false, message: result.message });
    }
  }).catch(e => {
    res.status(500).json({ error: e.message });
  });
});

// ---- Delete a post ----
router.delete('/posts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run('DELETE FROM social_queue WHERE post_id=?', [id]);
  db.run('DELETE FROM social_post_log WHERE post_id=?', [id]);
  db.run('DELETE FROM social_posts WHERE id=?', [id]);
  db.persist();
  res.json({ ok: true });
});

// ---- Queue ----
router.get('/queue', (req, res) => {
  const posts = db.all(
    `SELECT sp.*, sa.platform, sa.account_name, sa.account_label
     FROM social_posts sp LEFT JOIN social_accounts sa ON sa.id=sp.account_id
     WHERE sp.status IN ('queued','scheduled','pending')
     ORDER BY sp.scheduled_at ASC, sp.id ASC LIMIT 100`
  );
  res.json({ queue: posts });
});

// ---- Post Logs ----
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const account_id = parseInt(req.query.account_id, 10);
  const platform = req.query.platform || '';

  let where = '1=1';
  const params = [];
  if (account_id) { where += ' AND spl.account_id=?'; params.push(account_id); }
  if (platform) { where += ' AND spl.platform=?'; params.push(platform); }

  const logs = db.all(
    `SELECT spl.*, sa.account_name, sa.account_label
     FROM social_post_log spl LEFT JOIN social_accounts sa ON sa.id=spl.account_id
     WHERE ${where} ORDER BY spl.id DESC LIMIT ?`,
    [...params, limit]
  );
  res.json({ logs });
});

// ---- Scheduler Controls ----
router.post('/scheduler/pause', (req, res) => {
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('social_automation_paused','1')");
  db.persist();
  res.json({ ok: true, paused: true });
});

router.post('/scheduler/resume', (req, res) => {
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('social_automation_paused','0')");
  db.persist();
  res.json({ ok: true, paused: false });
});

router.post('/scheduler/run', async (req, res) => {
  try {
    const result = await scheduler.schedulerTick();
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('social_last_scheduler_run',?)", [String(db.now())]);
    db.persist();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- View the next scheduled post ----
router.get('/scheduler/next', (req, res) => {
  const next = db.get(
    `SELECT sp.*, sa.platform, sa.account_name
     FROM social_posts sp LEFT JOIN social_accounts sa ON sa.id=sp.account_id
     WHERE sp.status IN ('queued','scheduled') AND sp.scheduled_at IS NOT NULL
     ORDER BY sp.scheduled_at ASC LIMIT 1`
  );
  res.json({ next: next || null });
});

// ---- Bulk approve posts ----
router.post('/posts/bulk-approve', async (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });

  const results = [];
  for (const id of ids) {
    const post = db.get('SELECT id, status FROM social_posts WHERE id=?', [parseInt(id, 10)]);
    if (!post || (post.status !== 'queued' && post.status !== 'scheduled' && post.status !== 'pending')) continue;
    const r = await scheduler.executePost(post.id);
    results.push({ id: post.id, ok: r.ok, message: r.message });
  }
  res.json({ ok: true, results });
});

// ---- Get excluded content IDs for a rule ----
router.get('/rules/:id/excluded', (req, res) => {
  const rule = db.get('SELECT exclude_ids FROM posting_rules WHERE id=?', [parseInt(req.params.id, 10)]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  let ids = [];
  try { ids = JSON.parse(rule.exclude_ids || '[]'); } catch (e) {}
  res.json({ excluded_ids: ids });
});

// ---- Add excluded content IDs for a rule ----
router.post('/rules/:id/exclude', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rule = db.get('SELECT exclude_ids FROM posting_rules WHERE id=?', [id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const { content_id, content_type } = req.body || {};
  if (!content_id) return res.status(400).json({ error: 'content_id required' });

  let ids = [];
  try { ids = JSON.parse(rule.exclude_ids || '[]'); } catch (e) {}
  const key = content_type ? content_type + ':' + content_id : String(content_id);
  if (!ids.includes(key)) ids.push(key);

  db.run('UPDATE posting_rules SET exclude_ids=?, updated_at=? WHERE id=?', [JSON.stringify(ids), db.now(), id]);
  db.persist();
  res.json({ ok: true, excluded_ids: ids });
});

module.exports = router;
