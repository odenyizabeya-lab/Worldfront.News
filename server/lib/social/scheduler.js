// Social Media Auto-Posting Scheduler
// Runs on a cron schedule, picks due posts from the queue, publishes them,
// handles retries, and prevents duplicate posts.
const db = require('../../db');
const platforms = require('./platforms');

const DAY = 24 * 3600;
const HOUR = 3600;

// ---- Collect eligible content for automatic posting ----
function collectContent(accountId, contentTypes, limit = 10) {
  const types = Array.isArray(contentTypes) ? contentTypes : ['articles', 'products'];
  const items = [];

  if (types.includes('articles')) {
    const arts = db.all(
      'SELECT id, title, slug, summary, image, published_at FROM articles WHERE status="published" ORDER BY published_at DESC LIMIT ?',
      [limit]
    );
    for (const a of arts) {
      items.push({
        content_type: 'articles',
        content_id: a.id,
        content_url: (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '') + '/article/' + (a.slug || a.id),
        content_title: a.title,
        content_summary: a.summary || '',
        content_image: a.image || '',
        published_at: a.published_at
      });
    }
  }

  if (types.includes('site_articles')) {
    const arts = db.all(
      'SELECT id, title, slug, body, image, published_at FROM site_articles WHERE status IN ("published","live") ORDER BY published_at DESC LIMIT ?',
      [limit]
    );
    for (const a of arts) {
      items.push({
        content_type: 'site_articles',
        content_id: a.id,
        content_url: (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '') + '/p/' + (a.slug || a.id),
        content_title: a.title,
        content_summary: (a.body || '').replace(/<[^>]+>/g, '').slice(0, 300),
        content_image: a.image || '',
        published_at: a.published_at
      });
    }
  }

  if (types.includes('products')) {
    const prods = db.all(
      'SELECT listing_id, property_id, title, category, thumbnail, price, currency FROM shop_products WHERE published=1 ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
    for (const p of prods) {
      const pid = p.property_id || p.listing_id;
      items.push({
        content_type: 'products',
        content_id: p.listing_id,
        content_url: (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '') + '/shop/product/' + encodeURIComponent(pid),
        content_title: p.title,
        content_summary: (p.category || 'product') + (p.price ? ' — ' + p.currency + ' ' + Number(p.price).toLocaleString() : ''),
        content_image: (/^https?:\/\//.test(p.thumbnail || '') ? p.thumbnail : ''),
        published_at: db.now()
      });
    }
  }

  if (types.includes('breaking')) {
    const brk = db.all(
      'SELECT id, title, link, created_at FROM breaking_news WHERE active=1 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    for (const b of brk) {
      items.push({
        content_type: 'breaking',
        content_id: b.id,
        content_url: b.link || (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '') + '/breaking',
        content_title: b.title,
        content_summary: 'Breaking: ' + b.title,
        content_image: '',
        published_at: b.created_at
      });
    }
  }

  return items;
}

// ---- Check if content was already posted to an account ----
function alreadyPosted(accountId, contentUrl) {
  const row = db.get(
    'SELECT id FROM social_posts WHERE account_id=? AND content_url=? AND status IN ("published","queued","scheduled","pending") LIMIT 1',
    [accountId, contentUrl]
  );
  return !!row;
}

// ---- Check if content is in the exclude list ----
function isExcluded(rule, contentId, contentType) {
  if (!rule || !rule.exclude_ids) return false;
  try {
    const excluded = JSON.parse(rule.exclude_ids);
    return excluded.includes(String(contentId)) || excluded.includes(contentType + ':' + contentId);
  } catch (e) { return false; }
}

// ---- Determine if a rule is due to fire now ----
// Time window logic: a rule is due when the current time falls within 15
// minutes of its configured time. The scheduler ticks every 15 minutes, so
// every minute of the day is covered.
function isRuleDue(rule) {
  if (!rule || !rule.enabled) return false;

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay();
  const dayOfMonth = now.getDate();

  const [ruleHour, ruleMinute] = (rule.time_of_day || '09:00').split(':').map(Number);

  if (rule.frequency === 'hourly') {
    // Fire once per hour, at the configured minute-of-hour (within ±15 min).
    const diff = Math.abs(minute - (ruleMinute || 0));
    if (diff > 15 && (60 - diff) > 15) return false;
  } else {
    // Daily / weekly / monthly / custom: due around the configured hour:minute.
    const nowMinutes = hour * 60 + minute;
    const ruleMinutes = (ruleHour || 0) * 60 + (ruleMinute || 0);
    if (Math.abs(nowMinutes - ruleMinutes) > 15) return false;
  }

  // Check day of week for weekly
  if (rule.frequency === 'weekly' && rule.day_of_week) {
    const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const targetDay = days[String(rule.day_of_week).toLowerCase().slice(0, 3)];
    if (targetDay === undefined || targetDay !== dayOfWeek) return false;
  }

  // Check day of month for monthly (never fire if the day isn't configured)
  if (rule.frequency === 'monthly') {
    if (!rule.day_of_month || Number(rule.day_of_month) !== dayOfMonth) return false;
  }

  return true;
}

// ---- Count posts today for an account ----
function postsToday(accountId) {
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const row = db.get(
    'SELECT COUNT(*) AS c FROM social_posts WHERE account_id=? AND published_at>=? AND status="published"',
    [accountId, dayStart]
  );
  return row ? row.c : 0;
}

// ---- Create a post in the queue ----
function queuePost(accountId, contentItem, scheduledAt, postType = 'automatic', status = 'queued') {
  const idempotencyKey = accountId + ':' + contentItem.content_type + ':' + contentItem.content_id;
  const existing = db.get('SELECT id FROM social_posts WHERE idempotency_key=?', [idempotencyKey]);
  if (existing) return { queued: false, reason: 'duplicate', id: existing.id };

  db.run(
    `INSERT INTO social_posts (account_id, content_type, content_id, content_url, content_title, content_summary, content_image,
     post_type, status, scheduled_at, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [accountId, contentItem.content_type, contentItem.content_id, contentItem.content_url,
     contentItem.content_title, contentItem.content_summary, contentItem.content_image,
     postType, status, scheduledAt || db.now(), idempotencyKey, db.now()]
  );
  // NOTE: read last_insert_rowid() BEFORE persist() — sql.js export() resets it to 0.
  const row = db.get('SELECT last_insert_rowid() AS id');
  db.persist();
  return { queued: true, id: row.id };
}

// ---- Execute a single post ----
async function executePost(postId) {
  const post = db.get('SELECT * FROM social_posts WHERE id=?', [postId]);
  if (!post) return { ok: false, message: 'Post not found' };
  if (post.status !== 'queued' && post.status !== 'scheduled' && post.status !== 'retry' && post.status !== 'pending') {
    return { ok: false, message: 'Post is in status: ' + post.status };
  }

  const account = db.get('SELECT * FROM social_accounts WHERE id=?', [post.account_id]);
  if (!account || !account.enabled) return { ok: false, message: 'Account not found or disabled' };

  db.run('UPDATE social_posts SET status="publishing" WHERE id=?', [post.id]);
  db.persist();

  const result = await platforms.publishToPlatform(account, post);

  if (result.ok) {
    db.run(
      `UPDATE social_posts SET status="published", platform_post_id=?, platform_url=?, published_at=?,
       failed_at=NULL, failed_reason=NULL WHERE id=?`,
      [result.platform_post_id || '', result.platform_url || '', db.now(), post.id]
    );
    db.run('UPDATE social_accounts SET last_post_at=?, last_error=NULL WHERE id=?', [db.now(), account.id]);
    db.run(
      `INSERT INTO social_post_log (post_id, account_id, platform, action, status, message, attempted_at) VALUES (?,?,?,?,?,?,?)`,
      [post.id, account.id, account.platform, 'publish', 'ok', result.message, db.now()]
    );
    db.persist();
    return { ok: true, message: result.message, platform_url: result.platform_url };
  } else {
    const retryCount = (post.retry_count || 0) + 1;
    const maxRetries = post.max_retries || 3;
    const failed = retryCount >= maxRetries;
    const nextRetry = failed ? null : db.now() + (retryCount * 15 * 60);

    db.run(
      `UPDATE social_posts SET status=?, failed_at=?, failed_reason=?, retry_count=?,
       next_retry_at=? WHERE id=?`,
      [failed ? 'failed' : 'queued', db.now(), (result.message || '').slice(0, 500), retryCount, nextRetry, post.id]
    );
    db.run('UPDATE social_accounts SET last_error=? WHERE id=?', [(result.message || '').slice(0, 200), account.id]);
    db.run(
      `INSERT INTO social_post_log (post_id, account_id, platform, action, status, message, attempted_at) VALUES (?,?,?,?,?,?,?)`,
      [post.id, account.id, account.platform, 'publish', 'failed', result.message, db.now()]
    );
    db.persist();
    return { ok: false, message: result.message, retry_count: retryCount, failed };
  }
}

// ---- Main scheduler tick: run automatic posting ----
async function schedulerTick() {
  const accounts = db.all('SELECT * FROM social_accounts WHERE connected=1 AND enabled=1');
  const results = { accounts_checked: 0, posts_created: 0, posts_published: 0, posts_failed: 0, retries: 0 };

  for (const account of accounts) {
    results.accounts_checked++;

    // Process retries first
    const retries = db.all(
      "SELECT id FROM social_posts WHERE account_id=? AND status='queued' AND next_retry_at IS NOT NULL AND next_retry_at<=? LIMIT 5",
      [account.id, db.now()]
    );
    for (const r of retries) {
      const r2 = await executePost(r.id);
      if (r2.ok) results.posts_published++;
      else results.retries++;
    }

    // Find active posting rules
    const rules = db.all('SELECT * FROM posting_rules WHERE account_id=? AND enabled=1', [account.id]);
    for (const rule of rules) {
      if (!isRuleDue(rule)) continue;

      // Check daily limit
      const todayCount = postsToday(account.id);
      if (todayCount >= (rule.max_posts_per_day || 3)) continue;

      // Collect content
      const contentTypes = (() => {
        try { return JSON.parse(rule.content_types || '[]'); } catch (e) { return ['articles']; }
      })();
      const items = collectContent(account.id, contentTypes, 5);

      // Filter: exclude already posted, exclude blocked IDs
      const eligible = items.filter(item => {
        if (alreadyPosted(account.id, item.content_url)) return false;
        if (isExcluded(rule, item.content_id, item.content_type)) return false;
        return true;
      });

      if (!eligible.length) continue;

      // Pick the newest eligible item
      const item = eligible[0];
      const postsLeft = (rule.max_posts_per_day || 3) - todayCount;
      if (postsLeft <= 0) continue;

      if (rule.require_approval) {
        // Queue for approval: status 'pending' keeps the scheduler from ever
        // auto-publishing it — only an explicit admin approve publishes it.
        const q = queuePost(account.id, item, db.now(), 'automatic', 'pending');
        if (q.queued) results.posts_created++;
      } else {
        // Publish immediately
        const q = queuePost(account.id, item, db.now(), 'automatic');
        if (q.queued) {
          results.posts_created++;
          const pub = await executePost(q.id);
          if (pub.ok) results.posts_published++;
          else results.posts_failed++;
        }
      }
    }
  }

  // Process all scheduled posts that are due
  const duePosts = db.all(
    "SELECT id FROM social_posts WHERE status IN ('queued','scheduled','retry') AND scheduled_at<=? AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY scheduled_at ASC LIMIT 20",
    [db.now(), db.now()]
  );
  for (const p of duePosts) {
    const pub = await executePost(p.id);
    if (pub.ok) results.posts_published++;
    else if (pub.failed) results.posts_failed++;
    else results.retries++;
  }

  return results;
}

// ---- Dashboard statistics ----
function socialStats() {
  const now = db.now();
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const weekAgo = now - 7 * DAY;
  const monthAgo = now - 30 * DAY;

  const q = (sql, ...p) => (db.get(sql, p) || {}).c || 0;

  return {
    accounts: {
      total: q('SELECT COUNT(*) AS c FROM social_accounts'),
      connected: q('SELECT COUNT(*) AS c FROM social_accounts WHERE connected=1'),
      enabled: q('SELECT COUNT(*) AS c FROM social_accounts WHERE connected=1 AND enabled=1'),
      by_platform: db.all('SELECT platform, COUNT(*) AS c FROM social_accounts WHERE connected=1 GROUP BY platform')
    },
    posts: {
      total: q('SELECT COUNT(*) AS c FROM social_posts'),
      published: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="published"'),
      queued: q('SELECT COUNT(*) AS c FROM social_posts WHERE status IN ("queued","scheduled","pending")'),
      failed: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="failed"'),
      publishing: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="publishing"'),
      today_published: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="published" AND published_at>=?', [dayStart]),
      today_failed: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="failed" AND failed_at>=?', [dayStart]),
      week_published: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="published" AND published_at>=?', [weekAgo]),
      month_published: q('SELECT COUNT(*) AS c FROM social_posts WHERE status="published" AND published_at>=?', [monthAgo])
    },
    rules: {
      total: q('SELECT COUNT(*) AS c FROM posting_rules'),
      enabled: q('SELECT COUNT(*) AS c FROM posting_rules WHERE enabled=1')
    },
    automation_paused: db.get("SELECT value FROM settings WHERE key='social_automation_paused'") ? db.get("SELECT value FROM settings WHERE key='social_automation_paused'").value === '1' : false,
    last_run: db.get("SELECT value FROM settings WHERE key='social_last_scheduler_run'") || { value: null },
    recent_posts: db.all(
      `SELECT sp.*, sa.platform, sa.account_name FROM social_posts sp
       LEFT JOIN social_accounts sa ON sa.id=sp.account_id
       ORDER BY sp.id DESC LIMIT 15`
    ),
    recent_log: db.all(
      `SELECT spl.*, sa.platform, sa.account_name FROM social_post_log spl
       LEFT JOIN social_accounts sa ON sa.id=spl.account_id
       ORDER BY spl.id DESC LIMIT 30`
    )
  };
}

module.exports = {
  collectContent,
  alreadyPosted,
  isExcluded,
  isRuleDue,
  postsToday,
  queuePost,
  executePost,
  schedulerTick,
  socialStats
};
