const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { slugify } = require('../ingest/rss');
const { fetchEnabled } = require('../ingest/rss');
const { runApiProviders } = require('../ingest/api');
const {
  sync: syncShop, maybeSync: syncShopMaybe, publishArticles, publishMode, publishState,
  publishDaily, dailyEdition, supportedCountries, dateKey
} = require('../integrations/weverse-shop');

const router = express.Router();
router.use(auth.requireAuth, auth.requireAdmin);

// ---- Dashboard stats ----
router.get('/stats', (req, res) => {
  const s = {};
  s.total_articles = db.get('SELECT COUNT(*) AS c FROM articles').c;
  s.published = db.get('SELECT COUNT(*) AS c FROM articles WHERE status="published"').c;
  s.drafts = db.get('SELECT COUNT(*) AS c FROM articles WHERE status="draft"').c;
  s.sources = db.get('SELECT COUNT(*) AS c FROM news_sources').c;
  s.enabled_sources = db.get('SELECT COUNT(*) AS c FROM news_sources WHERE enabled=1').c;
  s.users = db.get('SELECT COUNT(*) AS c FROM users').c;
  s.breaking = db.get('SELECT COUNT(*) AS c FROM breaking_news WHERE active=1').c;
  const last = db.get("SELECT value FROM settings WHERE key='last_full_fetch'");
  const recentSources = db.all('SELECT name,country_code,last_status,last_fetch FROM news_sources WHERE last_fetch IS NOT NULL ORDER BY last_fetch DESC LIMIT 10');
  res.json({ ...s, last_fetch: last ? last.value : '0', recentSources });
});

// ---- Sources management ----
router.get('/sources', (req, res) => {
  const rows = db.all('SELECT * FROM news_sources ORDER BY id DESC');
  res.json({ sources: rows });
});

router.post('/sources', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.feed_url) return res.status(400).json({ error: 'name and feed_url required' });
  db.run(
    `INSERT INTO news_sources (name,url,country_code,language,category,feed_url,logo,type,enabled,priority)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [b.name, b.url || '', b.country_code ? String(b.country_code).toUpperCase() : 'US',
     b.language || 'en', b.category || 'world', b.feed_url, b.logo || '', b.type || 'rss',
     b.enabled === false ? 0 : 1, b.priority || 0]
  );
  db.persist();
  const row = db.get('SELECT MAX(id) AS id FROM news_sources');
  res.json({ ok: true, id: row ? row.id : 0 });
});

router.put('/sources/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const existing = db.get('SELECT * FROM news_sources WHERE id=?', [id]);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.run('UPDATE news_sources SET name=?, url=?, country_code=?, language=?, category=?, feed_url=?, logo=?, enabled=? WHERE id=?',
    [b.name ?? existing.name, b.url ?? existing.url,
     b.country_code ? String(b.country_code).toUpperCase() : existing.country_code,
     b.language ?? existing.language, b.category ?? existing.category,
     b.feed_url ?? existing.feed_url, b.logo ?? existing.logo,
     b.enabled === undefined ? existing.enabled : (b.enabled ? 1 : 0), id]);
  db.persist();
  res.json({ ok: true });
});

router.delete('/sources/:id', (req, res) => {
  db.run('DELETE FROM news_sources WHERE id=?', [parseInt(req.params.id, 10)]);
  db.persist();
  res.json({ ok: true });
});

// ---- Countries ----
router.get('/countries', (req, res) => {
  const rows = db.all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM articles a WHERE a.country_code=c.code) AS article_count
     FROM countries c ORDER BY c.name`
  );
  res.json({ countries: rows });
});

// ---- Categories ----
router.get('/categories', (req, res) => {
  res.json({ categories: db.all('SELECT * FROM categories ORDER BY name') });
});

router.post('/categories', (req, res) => {
  const b = req.body || {};
  if (!b.slug || !b.name) return res.status(400).json({ error: 'slug and name required' });
  db.run('INSERT OR IGNORE INTO categories (slug,name,icon,description,active) VALUES (?,?,?,?,?)',
    [b.slug, b.name, b.icon || '📰', b.description || '', b.active === false ? 0 : 1]);
  db.persist();
  res.json({ ok: true });
});

// ---- Feature / unfeature articles ----
router.post('/articles/:id/feature', (req, res) => {
  db.run('UPDATE articles SET featured=? WHERE id=?', [req.body.featured ? 1 : 0, parseInt(req.params.id, 10)]);
  db.persist();
  res.json({ ok: true });
});

router.post('/articles/:id/breaking', (req, res) => {
  const art = db.get('SELECT * FROM articles WHERE id=?', [parseInt(req.params.id, 10)]);
  if (!art) return res.status(404).json({ error: 'not found' });
  const on = req.body.breaking ? 1 : 0;
  db.run('UPDATE articles SET breaking=? WHERE id=?', [on, art.id]);
  if (on) {
    db.run('INSERT INTO breaking_news (title,article_id,country_code,link,active,created_at) VALUES (?,?,?,?,1,?)',
      [art.title, art.id, art.country_code, art.link, db.now()]);
  } else {
    db.run('DELETE FROM breaking_news WHERE article_id=?', [art.id]);
  }
  db.persist();
  res.json({ ok: true });
});

// Remove / hide stories
router.post('/articles/:id/remove', (req, res) => {
  db.run('UPDATE articles SET status="removed" WHERE id=?', [parseInt(req.params.id, 10)]);
  db.persist();
  res.json({ ok: true });
});

// ---- Breaking news management ----
router.get('/breaking', (req, res) => {
  res.json({ breaking: db.all('SELECT * FROM breaking_news ORDER BY created_at DESC') });
});

router.post('/breaking', (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title required' });
  db.run('INSERT INTO breaking_news (title,article_id,country_code,link,active,created_at) VALUES (?,?,?,?,1,?)',
    [b.title, parseInt(b.article_id, 10) || null, b.country_code || '', b.link || '', db.now()]);
  db.persist();
  res.json({ ok: true });
});

router.delete('/breaking/:id', (req, res) => {
  db.run('DELETE FROM breaking_news WHERE id=?', [parseInt(req.params.id, 10)]);
  db.persist();
  res.json({ ok: true });
});

// ---- Publish original site articles (CMS) ----
router.get('/site-articles', (req, res) => {
  res.json({ articles: db.all('SELECT * FROM site_articles ORDER BY id DESC') });
});

router.post('/site-articles', (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.body) return res.status(400).json({ error: 'title and body required' });
  const slug = b.slug || slugify(b.title) + '-' + db.now();
  db.run(
    `INSERT INTO site_articles (title,slug,category,country_code,image,body,author,featured,breaking,status,published_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.title, slug, b.category || 'world', b.country_code ? String(b.country_code).toUpperCase() : 'US',
     b.image || '', b.body, b.author || 'WorldFront.News',
     b.featured ? 1 : 0, b.breaking ? 1 : 0, b.status || 'published',
     b.published_at || db.now(), db.now()]
  );
  db.persist();
  res.json({ ok: true, id: db.get('SELECT last_insert_rowid() AS id').id, slug });
});

router.put('/site-articles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const ex = db.get('SELECT * FROM site_articles WHERE id=?', [id]);
  if (!ex) return res.status(404).json({ error: 'not found' });
  db.run(
    'UPDATE site_articles SET title=?, category=?, country_code=?, image=?, body=?, author=?, featured=?, breaking=?, status=? WHERE id=?',
    [b.title ?? ex.title, b.category ?? ex.category,
     b.country_code ? String(b.country_code).toUpperCase() : ex.country_code,
     b.image ?? ex.image, b.body ?? ex.body, b.author ?? ex.author,
     b.featured === undefined ? ex.featured : (b.featured ? 1 : 0),
     b.breaking === undefined ? ex.breaking : (b.breaking ? 1 : 0),
     b.status ?? ex.status, id]
  );
  db.persist();
  res.json({ ok: true });
});

router.delete('/site-articles/:id', (req, res) => {
  db.run('DELETE FROM site_articles WHERE id=?', [parseInt(req.params.id, 10)]);
  db.persist();
  res.json({ ok: true });
});

// ---- Trigger a fetch ----
router.post('/fetch', async (req, res) => {
  try {
    const results = await fetchEnabled();
    let api = { total: 0 };
    try { api = await runApiProviders(); } catch (e) {}
    const ok = results.filter(r => !r.error).length;
    res.json({ ok, total_sources: results.length, failed: results.filter(r => r.error).map(r => r.source), api });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Users ----
router.get('/users', (req, res) => {
  res.json({ users: db.all('SELECT id,email,username,role,created_at FROM users') });
});

// ---- Weverse Shop Updates (daily per-country product publishing) ----
router.get('/shop/status', (req, res) => {
  const totals = db.get('SELECT COUNT(*) AS c FROM shop_products WHERE published=1');
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_sync'");
  const pub = db.get("SELECT COUNT(*) AS c FROM articles WHERE category='shopping' AND status='published'");
  const editionRows = db.all('SELECT pub_date, COUNT(*) AS c FROM shop_publication_days GROUP BY pub_date ORDER BY pub_date DESC');
  res.json({
    total: totals ? totals.c : 0,
    last_sync: last ? last.value : '0',
    ...publishState(),
    published_articles: pub ? pub.c : 0,
    supported_countries: supportedCountries().length,
    editions: editionRows
  });
});

router.post('/shop/sync', async (req, res) => {
  try {
    const result = await syncShop();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Publish the 3 preview products as shopping-news articles so the user can
// inspect them before enabling daily publishing. Only publishes products whose
// Weverse link is verified active.
router.post('/shop/publish-preview', async (req, res) => {
  try {
    const r = await publishArticles('preview');
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Launch daily publishing: sets mode 'daily' and produces today's complete
// country editions (fresh headline/intro/order/featured/closing per country).
// Re-runs every day via the cron; each edition upserts by country+date.
router.post('/shop/publish-daily', async (req, res) => {
  try {
    const result = await syncShop();
    const r = await publishDaily();
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_publish_mode','daily')", []);
    db.persist();
    res.json({ ...r, sync: { total: result.total, inserted: result.inserted, updated: result.updated } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET today's edition for a country (admin inspection).
router.get('/shop/daily/:country', (req, res) => {
  const date = String(req.query.date || dateKey(new Date()));
  const edition = dailyEdition(String(req.params.country).toUpperCase(), date);
  if (!edition) return res.status(404).json({ error: 'No edition for that country/date' });
  res.json({ edition });
});

// Set which countries get daily editions (JSON array of country codes).
router.get('/shop/countries', (req, res) => {
  res.json({ countries: supportedCountries().map((c) => c.code) });
});

router.post('/shop/countries', (req, res) => {
  const list = (req.body && req.body.countries) || [];
  const codes = (Array.isArray(list) ? list : []).map((s) => String(s).toUpperCase());
  const valid = new Set(db.all('SELECT code FROM countries').map((c) => c.code));
  const keep = codes.filter((c) => valid.has(c));
  if (!keep.length) return res.status(400).json({ error: 'no valid country codes' });
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_publication_countries',?)", [JSON.stringify(keep)]);
  db.persist();
  res.json({ countries: keep });
});

// Disable daily publishing (stops the cron from producing new editions).
router.post('/shop/disable-daily', (req, res) => {
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_publish_mode','preview')", []);
  db.persist();
  res.json({ mode: publishMode() });
});

module.exports = router;
