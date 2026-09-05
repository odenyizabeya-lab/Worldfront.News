// WorldFront.News Distribution Engine — orchestrator.
//  - seeds + discovers platforms daily (registry.discover)
//  - collects new content (articles, editions, products, site articles)
//  - delivers through every eligible connector (real HTTP where permitted)
//  - writes the honest dist_log ledger + retries failures with backoff
//  - queues human onboarding tasks for manual/paid/approval platforms
const db = require('../db');
const registry = require('./registry');
const rss = require('./rss');
const connectors = require('./connectors');

const RETRY_LIMIT = 3;
const DAY = 24 * 3600;

function kindOf(name) {
  // maps a content source to the registry content_types buckets
  if (name === 'articles' || name === 'site-articles') return 'articles';
  if (name === 'breaking') return 'breaking';
  return 'products'; // editions + products + property announcements
}

// ---- content collection (everything published/updated since last run) ----
function collectItems(sinceMs) {
  const when = db.now();
  const items = [];

  const arts = db.all('SELECT id,title,summary,slug,published_at,fetched_at,image,country_code FROM articles WHERE status="published" AND COALESCE(published_at,fetched_at)>? LIMIT 100', [sinceMs]);
  for (const a of arts) {
    items.push({
      kind: 'articles', key: 'a' + a.id,
      title: a.title, url: connectors.ssrBase() + '/article/' + (a.slug || a.id),
      summary: (a.summary || '').slice(0, 600), image: a.image || ''
    });
  }

  const days = db.all('SELECT country_code AS cc, pub_date AS pd, intro AS intro FROM shop_publication_days WHERE pub_date=?', [dayKey()]);
  for (const d of days) {
    items.push({
      kind: 'editions', key: 'e' + d.cc + d.pd,
      title: (d.intro || ('Daily property market — ' + d.cc)).slice(0, 140),
      url: connectors.ssrBase() + '/shop/daily/' + encodeURIComponent(d.cc) + '/' + d.pd,
      summary: (d.intro || '').slice(0, 600), image: ''
    });
  }

  const props = db.all('SELECT listing_id,property_id,title,category,thumbnail,COALESCE(updated_at,created_at) AS up FROM shop_products WHERE published=1 AND COALESCE(updated_at,created_at)>? LIMIT 80', [sinceMs]);
  for (const p of props) {
    items.push({
      kind: 'products', key: 'p' + (p.property_id || p.listing_id),
      title: p.title, url: connectors.ssrBase() + '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id),
      summary: (p.category || 'property') + ' — WorldFront.News', image: /^https?:\/\//.test(p.thumbnail || '') ? p.thumbnail : ''
    });
  }

  const owned = db.all('SELECT id,title,slug,body,published_at,created_at FROM site_articles WHERE status IN ("published","live") AND COALESCE(published_at,created_at)>? LIMIT 50', [sinceMs]);
  for (const a of owned) {
    items.push({
      kind: 'site-articles', key: 's' + a.id,
      title: a.title, url: connectors.ssrBase() + '/p/' + (a.slug || a.id),
      summary: (a.summary || a.body || '').slice(0, 600), image: ''
    });
  }

  // Deduplicate by URL; keep newest
  const byUrl = new Map();
  for (const it of items) byUrl.set(it.url, it);
  return Array.from(byUrl.values());
}

function dayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---- eligible platforms for a content item ----
function eligible(item) {
  const kind = kindOf(item.kind);
  return db.all('SELECT * FROM dist_platforms WHERE 1=1', []).filter((p) => {
    let types = ['articles'];
    try { types = JSON.parse(p.content_types || '["articles"]'); } catch (e) {}
    return types.length === 0 || types.indexOf(kind) !== -1;
  });
}

function alreadyHandled(url, platformSlug, statuses) {
  const row = db.get(`SELECT id FROM dist_log WHERE content_url=? AND platform_slug=? AND status IN (${statuses.map(() => '?').join(',')}) LIMIT 1`, [url, platformSlug, ...statuses]);
  return !!row;
}

function lastAttempt(url, platformSlug) {
  return db.get('SELECT * FROM dist_log WHERE content_url=? AND platform_slug=? ORDER BY id DESC LIMIT 1', [url, platformSlug]);
}

// Ensure a human onboarding task exists (idempotent).
function ensureTask(platform, action, guidance) {
  const open = db.get('SELECT id FROM dist_tasks WHERE platform_slug=? AND status="open"', [platform.slug]);
  if (open) return;
  db.run('INSERT INTO dist_tasks (platform_slug,action,status,guidance,submit_url,created_at) VALUES (?,?,?,?,?,?)',
    [platform.slug, action, 'open', guidance, platform.signup_url || platform.url, db.now()]);
}

function writeLog(entry) {
  db.run(
    `INSERT INTO dist_log (content_type,content_url,title,platform_slug,status,http_status,detail_url,message,attempted_at,retry_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [entry.content_type, entry.content_url, entry.title, entry.platform_slug,
     entry.status, entry.http_status || 0, entry.detail_url || '', entry.message || '',
     db.now(), entry.retry_at || null]
  );
}

function touchPlatform(slug, ok, message) {
  if (ok) db.run('UPDATE dist_platforms SET last_success=?, last_failure=NULL, failure_message=NULL, status="connected" WHERE slug=?', [db.now(), slug]);
  else db.run('UPDATE dist_platforms SET last_failure=?, failure_message=? WHERE slug=?', [db.now(), String(message || '').slice(0, 200), slug]);
}

function touchConnector(slug, ok, message) {
  const row = db.get('SELECT retries FROM dist_connectors WHERE platform_slug=?', [slug]);
  if (ok) db.run('UPDATE dist_connectors SET last_success=?, last_failure=NULL, failure_message=NULL, retries=0 WHERE platform_slug=?', [db.now(), slug]);
  else db.run('UPDATE dist_connectors SET last_failure=?, failure_message=?, retries=COALESCE(retries,0)+1 WHERE platform_slug=?', [db.now(), String(message || '').slice(0, 200), slug]);
}

// Refresh the RSS feed bundle so the newest content is always discoverable.
function refreshRss() {
  const xml = rss.buildFeed();
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('rss_feed_snapshot',?)", [xml.slice(0, 250000)]);
}

// ---- the daily distribution pass ----
async function distribute(opts = {}) {
  const force = !!opts.force;
  const lastRow = db.get("SELECT value FROM settings WHERE key='dist_last_run'");
  const sinceMs = force ? 0 : Math.max(0, (lastRow && parseInt(lastRow.value, 10) || 0) - 6 * 3600);
  let items = collectItems(sinceMs);
  items = items.slice(0, 80); // newest first; batch keeps it fast

  const results = { items: items.length, attempts: 0, ok: 0, discoverable: 0, pending: 0, failed: 0, by_type: {} };
  const indexNowUrls = [];
  const manualPlatforms = new Map(); // slug -> platform for one pending row each

  for (const item of items) {
    results.by_type[item.kind] = (results.by_type[item.kind] || 0) + 1;
    for (const p of eligible(item)) {
      const manual = connectors.MANUAL_ONLY.has(p.slug) || p.access === 'paid' || p.access === 'manual' || p.access === 'oauth';
      if (manual) {
        manualPlatforms.set(p.slug, p);
        continue;
      }
      // Real connectors that still need credentials behave as manual until the
      // owner connects them (single pending row + onboarding task, never spam).
      if (p.slug !== 'indexnow' && p.slug !== 'rss-feed' && !Object.keys(connectors.credsFor(p.slug)).length) {
        manualPlatforms.set(p.slug, p);
        continue;
      }
      // skip already-delivered/ok accounts (incl. discoverable) unless forced
      if (!force && alreadyHandled(item.url, p.slug, ['ok', 'discoverable'])) continue;
      results.attempts++;
      if (p.slug === 'indexnow') {
        indexNowUrls.push(item.url);
        continue;
      }
      if (p.slug === 'rss-feed') {
        writeLog({ content_type: item.kind, content_url: item.url, title: item.title, platform_slug: p.slug, status: 'discoverable', http_status: 200, detail_url: connectors.ssrBase() + '/rss.xml', message: 'In the RSS feed — aggregators discover by URL' });
        results.discoverable++;
        continue;
      }
      const res = await connectors.deliver(p, { ...item, content_type: kindOf(item.kind) });
      const ok = res.status === 'ok' || res.status === 'discoverable';
      writeLog({ content_type: item.kind, content_url: item.url, title: item.title, platform_slug: p.slug, status: res.status, http_status: res.httpStatus, detail_url: res.detailUrl, message: res.message, retry_at: res.status === 'failed' ? db.now() + 3600 : null });
      touchPlatform(p.slug, ok, res.message);
      touchConnector(p.slug, ok, res.message);
      if (res.status === 'ok') results.ok++;
      else if (res.status === 'discoverable') results.discoverable++;
      else if (res.status === 'pending') results.pending++;
      else results.failed++;
    }
  }

  // One IndexNow batch for all new URLs (real, free, no account). Failures are
  // retried by the next run's batch — never per-URL.
  if (indexNowUrls.length) {
    results.attempts += indexNowUrls.length;
    const batch = await connectors.indexNowBatch(indexNowUrls);
    for (const url of indexNowUrls) {
      const ok = batch.status === 'ok';
      writeLog({ content_type: 'batch', content_url: url, title: '', platform_slug: 'indexnow', status: ok ? 'ok' : 'failed', http_status: batch.httpStatus, detail_url: 'https://www.indexnow.org', message: ok ? 'IndexNow batch: ' + indexNowUrls.length + ' URLs' : batch.message + ' — retried with the next daily batch', retry_at: null });
      if (ok) results.ok++; else results.failed++;
    }
    touchPlatform('indexnow', batch.status === 'ok', batch.message);
    touchConnector('indexnow', batch.status === 'ok', batch.message);
  }

  // Manual/approval/paid platforms: exactly one honest pending row + one
  // onboarding task per platform — never a fake share, never row spam.
  for (const [slug, p] of manualPlatforms) {
    const logged = db.get('SELECT id FROM dist_log WHERE platform_slug=? AND status IN ("pending","ok","discoverable") LIMIT 1', [slug]);
    if (logged) continue;
    const sample = items.find((it) => eligible(it).some((x) => x.slug === slug));
    if (!sample) continue;
    ensureTask(p, p.access === 'oauth' ? 'connect_oauth' : (p.access === 'paid' ? 'review_paid' : 'register'),
      'Create an official account and complete signup/approval on ' + p.name + ' (' + (p.signup_url || p.url) + '). ' +
      (p.email_verification ? 'Complete the email verification on signup. ' : '') +
      (p.manual_approval ? 'Manage/await the platform approval. ' : '') +
      (p.paid ? 'This platform requires a paid plan — only enroll if you choose to pay. ' : '') +
      'The system will NOT claim this share until a human completes it on the platform.');
    writeLog({ content_type: sample.kind, content_url: sample.url, title: sample.title, platform_slug: slug, status: 'pending', message: 'Human onboarding required on ' + p.name });
    results.pending++;
  }

  refreshRss();
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('dist_last_run',?)", [String(db.now())]);
  db.persist();
  return results;
}

// ---- retry failed deliveries with backoff (never re-pings IndexNow per URL) ----
async function retryDue() {
  const due = db.all("SELECT * FROM dist_log WHERE status='failed' AND platform_slug!='indexnow' AND (retry_at IS NULL OR retry_at<=?) ORDER BY attempted_at ASC LIMIT 25", [db.now()]);
  const out = { tried: 0, ok: 0, stillFailed: 0 };
  for (const row of due) {
    const p = db.get('SELECT * FROM dist_platforms WHERE slug=?', [row.platform_slug]);
    if (!p || connectors.MANUAL_ONLY.has(p.slug)) continue;
    const res = await connectors.deliver(p, { key: 'retry' + row.id, content_type: kindOf(row.content_type), kind: row.content_type, title: row.title, url: row.content_url, summary: row.message });
    out.tried++;
    if (res.status === 'ok' || res.status === 'discoverable') {
      db.run("UPDATE dist_log SET status=?, http_status=?, detail_url=?, message=?, attempted_at=?, retry_at=NULL WHERE id=?", [res.status, res.httpStatus, res.detailUrl || '', res.message, db.now(), row.id]);
      out.ok++;
    } else {
      const retries = (db.get('SELECT COUNT(*) AS c FROM dist_log WHERE content_url=? AND platform_slug=? AND status IN ("failed","pending")', [row.content_url, row.platform_slug]).c) || 1;
      if (retries >= RETRY_LIMIT) {
        db.run("UPDATE dist_log SET message=?, retry_at=NULL WHERE id=?", ['Giving up after ' + retries + ' attempts (requires review)', row.id]);
      } else {
        db.run("UPDATE dist_log SET attempted_at=?, retry_at=? WHERE id=?", [db.now(), db.now() + retries * 1800, row.id]);
      }
      out.stillFailed++;
    }
  }
  db.persist();
  return out;
}

// ---- full daily run (discovery + distribute + retries) ----
async function tick(opts = {}) {
  registry.seedRegistry();
  const disc = opts.runDiscovery === false ? null : await registry.discover(opts.discoveryLimit || 6);
  const dist = await distribute(opts);
  const retry = await retryDue();
  const overview = stats();
  return { discovered: disc, distributed: dist, retried: retry, overview };
}

// ---- honest dashboard stats ----
function stats() {
  const dayStart = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000);
  const q = (sql, ...p) => db.get(sql, p).c || 0;
  const base = connectors.ssrBase();
  const feed = db.get("SELECT value FROM settings WHERE key='rss_feed_snapshot'");
  return {
    platforms: {
      discovered: q('SELECT COUNT(*) AS c FROM dist_platforms'),
      connected: q('SELECT COUNT(*) AS c FROM dist_platforms WHERE status="connected"'),
      pending: q('SELECT COUNT(*) AS c FROM dist_platforms WHERE status="pending" OR (status!="connected" AND access IN ("manual","oauth","paid"))'),
      discovered_today: db.all('SELECT slug,name,country_code,access,method FROM dist_platforms WHERE discovered_at>=? ORDER BY discovered_at DESC', [dayStart]),
      by_access: db.all('SELECT access, COUNT(*) AS c FROM dist_platforms GROUP BY access ORDER BY c DESC')
    },
    active_channels: q('SELECT COUNT(*) AS c FROM dist_connectors WHERE linked=1 AND paused=0'),
    tasks: {
      open: q("SELECT COUNT(*) AS c FROM dist_tasks WHERE status='open'"),
      done: q("SELECT COUNT(*) AS c FROM dist_tasks WHERE status='done'")
    },
    today: {
      article_shares: q("SELECT COUNT(*) AS c FROM dist_log WHERE content_type IN ('articles','site-articles','breaking') AND attempted_at>=? AND status IN ('ok','discoverable')", [dayStart]),
      product_shares: q("SELECT COUNT(*) AS c FROM dist_log WHERE content_type IN ('products','editions') AND attempted_at>=? AND status IN ('ok','discoverable')", [dayStart]),
      failed: q('SELECT COUNT(*) AS c FROM dist_log WHERE attempted_at>=? AND status="failed"', [dayStart]),
      pending: q('SELECT COUNT(*) AS c FROM dist_log WHERE attempted_at>=? AND status="pending"', [dayStart])
    },
    last_success: db.get('SELECT MAX(attempted_at) AS t FROM dist_log WHERE status IN ("ok","discoverable")') || { t: null },
    feed_url: base + '/rss.xml',
    indexnow_key_served: !!(netKey()),
    recent: db.all('SELECT dl.*, d.name AS platform FROM dist_log dl LEFT JOIN dist_platforms d ON d.slug=dl.platform_slug ORDER BY dl.id DESC LIMIT 25')
  };
}

function netKey() {
  const k = db.get("SELECT value FROM settings WHERE key='indexnow_key'");
  return k && /^[0-9a-fA-F]{32}$/.test(k.value) ? k.value : null;
}

// Ensure the indexnow key exists & return it (with the served file URL).
function ensureIndexNowKey() {
  let k = netKey();
  if (!k) {
    const hex = '0123456789abcdef';
    let kk = '';
    for (let i = 0; i < 32; i++) kk += hex[Math.floor(Math.random() * 16)];
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('indexnow_key',?)", [kk]);
    db.persist();
    k = kk;
  }
  return k;
}

module.exports = { tick, distribute, retryDue, discover: registry.discover, seedRegistry: registry.seedRegistry, stats, ensureIndexNowKey, refreshRss, kindOf, dayKey };