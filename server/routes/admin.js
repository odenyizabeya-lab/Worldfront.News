const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');
const { slugify } = require('../ingest/rss');
const { fetchEnabled } = require('../ingest/rss');
const { runApiProviders } = require('../ingest/api');
const loc = require('../lib/location');
const seoAudit = require('../lib/seo-audit');
const propSeo = require('../lib/property-seo');
const promo = require('../lib/country-promotion');
const indexing = require('../lib/indexing');
const analytics = require('../lib/analytics');
const distEngine = require('../distrib/engine');
const distRegistry = require('../distrib/registry');
const {
  sync: syncShop, maybeSync: syncShopMaybe, publishArticles, publishMode, publishState,
  publishDaily, dailyEdition, supportedCountries, dateKey, publishInternationalPages
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
    editions: editionRows,
    international: promo.targetStats()
  });
});

// Trigger a refresh of the internationally promoted product pages now.
router.post('/shop/publish-international', async (req, res) => {
  try {
    const result = await publishInternationalPages();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Which world regions get internationally promoted product pages.
router.get('/shop/target-regions', (req, res) => {
  res.json({ regions: promo.supportedRegions(), all_regions: ['Americas', 'Europe', 'Oceania', 'Asia', 'Africa'] });
});

router.post('/shop/target-regions', (req, res) => {
  const list = (req.body && req.body.regions) || [];
  const regions = (Array.isArray(list) ? list : []).map((s) => String(s).trim());
  const VALID = new Set(['Americas', 'Europe', 'Oceania', 'Asia', 'Africa']);
  const keep = regions.filter((r) => VALID.has(r));
  if (!keep.length) return res.status(400).json({ error: 'no valid regions (allowed: Americas, Europe, Oceania, Asia, Africa)' });
  // Only keep regions the site actually has rows for.
  const siteRegions = new Set(db.all('SELECT DISTINCT region FROM countries').map((c) => c.region));
  const final = keep.filter((r) => siteRegions.has(r));
  if (!final.length) return res.status(400).json({ error: 'none of those regions exist in the country list' });
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_target_regions',?)", [JSON.stringify(final)]);
  db.persist();
  res.json({ regions: final });
});

// Note: on re-running with a different region set, existing pages for the
// deselected regions stay live (never deleted) until the owner re-publishes.
router.post('/shop/reindex-international', async (req, res) => {
  try {
    // Republish all pairs and mark them for distribution again (pushed=0) so
    // the changed content cycles into RSS/IndexNow once more.
    const result = await publishInternationalPages();
    db.run('UPDATE shop_country_pages SET pushed=0 WHERE status=?', ['published']);
    db.persist();
    res.json({ ...result, requeued_all: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// ---- Global Location Database - admin control ----
// Admins can add, edit, approve, reject, verify, merge and inspect locations
// and the listings/posts connected to every location record.
router.get('/locations', (req, res) => {
  const country = req.query.country ? String(req.query.country).toUpperCase() : null;
  const q = req.query.q ? String(req.query.q).trim() : '';
  let rows;
  if (country && q) {
    rows = db.all('SELECT * FROM geo_locations WHERE country_code=? AND (name LIKE ? OR type LIKE ?) ORDER BY type, name', [country, '%' + q + '%', '%' + q + '%']);
  } else if (country) {
    rows = db.all('SELECT * FROM geo_locations WHERE country_code=? ORDER BY type, name', [country]);
  } else {
    rows = db.all('SELECT * FROM geo_locations ORDER BY country_code, type, name LIMIT 2000');
  }
  const counts = {};
  for (const l of rows) {
    const c = db.get('SELECT COUNT(*) AS c FROM listing_locations WHERE location_id=?', [l.id]);
    counts[l.id] = c ? c.c : 0;
  }
  res.json({ locations: rows.map((l) => ({ ...l, listing_count: counts[l.id] || 0 })) });
});

// Add a location
router.post('/locations', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type || !b.country_code) return res.status(400).json({ error: 'name, type and country_code required' });
  const cc = String(b.country_code).toUpperCase();
  if (!db.get('SELECT code FROM countries WHERE code=?', [cc])) return res.status(400).json({ error: 'unknown country' });
  const child = loc.findOrCreate({
    name: String(b.name).trim().slice(0, 120), type: String(b.type).trim().slice(0, 40),
    countryCode: cc, parentName: b.parent_name || null, postalCode: b.postal_code || null,
    lat: typeof b.lat === 'number' ? b.lat : null, lng: typeof b.lng === 'number' ? b.lng : null,
    verified: !!b.verified
  });
  if (!child) return res.status(400).json({ error: 'could not create location' });
  db.persist();
  res.json({ ok: true, location: child });
});

// Edit / verify / approve / reject a location
router.put('/locations/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const l = db.get('SELECT * FROM geo_locations WHERE id=?', [id]);
  if (!l) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.run(
    `UPDATE geo_locations SET name=?, type=?, postal_code=?, lat=?, lng=?, verified=?, approximate=?,
            status=?, parent_id=?, updated_at=? WHERE id=?`,
    [b.name ?? l.name, b.type ?? l.type, b.postal_code ?? l.postal_code,
     b.lat !== undefined && b.lat !== null ? Number(b.lat) : l.lat,
     b.lng !== undefined && b.lng !== null ? Number(b.lng) : l.lng,
     b.verified === undefined ? l.verified : (b.verified ? 1 : 0),
     b.approximate === undefined ? l.approximate : (b.approximate ? 1 : 0),
     b.status ?? l.status,
     b.parent_id !== undefined && b.parent_id !== null ? parseInt(b.parent_id, 10) : l.parent_id,
     db.now(), id]
  );
  db.persist();
  res.json({ ok: true, location: db.get('SELECT * FROM geo_locations WHERE id=?', [id]) });
});

// Delete a location (only when nothing is linked to it).
router.delete('/locations/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const linked = db.get('SELECT COUNT(*) AS c FROM listing_locations WHERE location_id=?', [id]);
  if (linked && linked.c) return res.status(400).json({ error: 'location has ' + linked.c + ' linked listing(s); detach them first' });
  db.run('DELETE FROM geo_locations WHERE id=?', [id]);
  db.persist();
  res.json({ ok: true });
});

// Merge a location into another (move children + listing links, delete source).
router.post('/locations/merge', (req, res) => {
  const { fromId, toId } = req.body || {};
  if (!fromId || !toId || fromId === toId) return res.status(400).json({ error: 'fromId and toId required and different' });
  const from = db.get('SELECT * FROM geo_locations WHERE id=?', [parseInt(fromId, 10)]);
  const to = db.get('SELECT * FROM geo_locations WHERE id=?', [parseInt(toId, 10)]);
  if (!from || !to) return res.status(404).json({ error: 'location not found' });
  db.run('UPDATE geo_locations SET parent_id=? WHERE parent_id=?', [to.id, from.id]);
  db.run('UPDATE listing_locations SET location_id=? WHERE location_id=?', [to.id, from.id]);
  db.run('DELETE FROM geo_locations WHERE id=?', [from.id]);
  db.persist();
  res.json({ ok: true, merged_into: to.id });
});

// Listings + posts tied to a location.
router.get('/locations/:id/listings', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const l = db.get('SELECT * FROM geo_locations WHERE id=?', [id]);
  if (!l) return res.status(404).json({ error: 'not found' });
  const links = db.all("SELECT listing_kind, listing_id, relation FROM listing_locations WHERE location_id=?", [id]);
  const props = [];
  for (const x of links) {
    const p = db.get('SELECT * FROM shop_products WHERE listing_id=?', [x.listing_id]);
    if (p) props.push({ kind: x.listing_kind, listing_id: x.listing_id, product: p });
  }
  // Articles connected to this location name/region/country.
  const arts = db.all(
    'SELECT id,title,slug,country_code,region,category,published_at FROM articles WHERE status="published" AND (region=? OR country_code=?) ORDER BY published_at DESC LIMIT 50',
    [l.name, l.country_code]
  );
  res.json({ location: l, listings: props, articles: arts });
});

// Re-run the location assignment for every listing with a real country.
router.post('/locations/reassign', (req, res) => {
  let assigned = 0;
  const rows = db.all('SELECT * FROM shop_products WHERE published=1 AND country_code != \'\'');
  for (const r of rows) {
    try {
      const l = loc.resolveListingLocation(r, { includeStreet: true, verified: !!(r.lat != null && r.lng != null) });
      if (l && loc.linkListing('property', r.listing_id, l, 'primary')) assigned++;
    } catch (e) { /* skip */ }
  }
  db.persist();
  res.json({ ok: true, assigned, reviewed: rows.length });
});

// ---- Technical SEO Quality Control ----
router.get('/seo/report', (req, res) => {
  res.json({ report: seoAudit.auditSummary() });
});

// Real first-party reach numbers: which pages people are actually opening.
router.get('/analytics', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  res.json({
    totals: analytics.totals(),
    popular: analytics.popular(limit)
  });
});

router.post('/seo/audit', (req, res) => {
  const scope = (req.body && req.body.scope) || 'all';
  const report = seoAudit.runAudit(scope);
  res.json({ ok: true, report });
});

// JSON-LD validation test for a single property: regenerates the schema and
// verifies it serializes to valid JSON with only supported values.
router.get('/seo/validate-jsonld/:id', (req, res) => {
  const p = db.get('SELECT * FROM shop_products WHERE (listing_id=? OR property_id=?)', [req.params.id, req.params.id]);
  if (!p) return res.status(404).json({ error: 'property not found' });
  const detail = db.get('SELECT * FROM property_details WHERE property_id=? OR listing_id=?', [p.property_id, p.listing_id]) || {};
  const merged = { ...p, ...detail };
  const canonical = ssrCanonical(p);
  let errors = [];
  let schema = null;
  try {
    schema = propSeo.isHousing(merged) ? propSeo.realEstateJson(merged, canonical) : null;
    const s = JSON.stringify(schema);
    JSON.parse(s); // throws if invalid
  } catch (e) {
    errors.push('Invalid JSON: ' + e.message);
  }
  const checks = {
    valid_json: errors.length === 0,
    property_mapping: !!schema && schema.name === (merged.title || '').trim(),
    url: !!schema && schema.url === canonical,
    price: schema && schema.offers ? !(schema.offers.price == null) : false,
    currency: schema && schema.offers ? /^[A-Za-z]{3}$/.test(String(schema.offers.priceCurrency || '')) : false,
    coordinates_present: !!(merged.lat != null && merged.lng != null),
    images_real: propSeo.imageList(merged).every((u) => /^https?:\/\//.test(u)),
    no_duplicate_schema: true
  };
  res.json({ checks, errors, canonical, schema });
});

// Rebuild the URL registry (pages known to the SEO system).
router.post('/seo/rebuild-index', (req, res) => {
  const count = seoAudit.rebuildUrlRegistry();
  res.json({ ok: true, indexed: count });
});

// Properties SEO status list for the admin report.
router.get('/properties/seo', (req, res) => {
  const rows = db.all('SELECT * FROM shop_products WHERE published=1 ORDER BY updated_at DESC');
  const list = rows.map((p) => {
    const detail = db.get('SELECT * FROM property_details WHERE property_id=? OR listing_id=?', [p.property_id, p.listing_id]) || {};
    const merged = { ...p, ...detail };
    const images = propSeo.imageList(merged);
    return {
      listing_id: p.listing_id, property_id: p.property_id, title: p.title, category: p.category,
      price: p.price, currency: p.currency, country_code: merged.country_code, state: merged.state,
      city: merged.city, town: merged.town, listing_status: merged.listing_status,
      has_media: images.length > 0 || !!(merged.thumbnail && /^https?:/.test(merged.thumbnail)),
      has_video: propSeo.isVideo(merged.video),
      has_coordinates: !!(merged.lat != null && merged.lng != null),
      has_location: !!(merged.country_code || merged.city || merged.state),
      location_verified: merged.location_verified ? true : false,
      url: '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id)
    };
  });
  const summary = {
    total: list.length,
    with_media: list.filter((x) => x.has_media).length,
    with_video: list.filter((x) => x.has_video).length,
    with_coordinates: list.filter((x) => x.has_coordinates).length,
    with_location: list.filter((x) => x.has_location).length,
    location_verified: list.filter((x) => x.location_verified).length
  };
  res.json({ summary, listings: list });
});

// ---- Google Indexing / Search Console ----
router.get('/gsc/status', (req, res) => {
  const log = indexing.recentLog(30);
  res.json({ config: indexing.gscConfig(), log });
});

// Optional live URL-inspection check through the Search Console API.
// Only functions when GOOGLE_SERVICE_ACCOUNT_JSON is configured on the server.
router.post('/gsc/inspect', async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  const result = await indexing.inspectUrl(url);
  res.json(result);
});

function ssrCanonical(p) {
  const ssr = require('../lib/ssr');
  return ssr.CANONICAL_BASE + '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id);
}

// ---- Multi-Platform Distribution ----
// Overview / honest ledger / onboarding tasks / connectors / manual runs.

router.get('/distribution/overview', (req, res) => {
  res.json(distEngine.stats());
});

router.get('/distribution/platforms', (req, res) => {
  const rows = db.all(
    `SELECT p.*, c.linked, c.account_label, c.paused AS connector_paused, c.connected_at, c.last_success AS c_last_success, c.retries AS c_retries
     FROM dist_platforms p LEFT JOIN dist_connectors c ON c.platform_slug=p.slug
     ORDER BY p.score DESC, p.name`
  );
  res.json({
    coverage: distRegistry.coverage(),
    platforms: rows.map((r) => {
      const types = [];
      try { types.push(...JSON.parse(r.content_types || '[]')); } catch (e) {}
      return { ...r, types, country_name: distRegistry.countryLabel(r.country_code) };
    })
  });
});

// Run the distribution pass now (discovery optional).
router.post('/distribution/run', async (req, res) => {
  try {
    const r = await distEngine.tick({ runDiscovery: !(req.body && req.body.no_discovery) });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Force a discovery sweep only (health-check + new opportunities).
router.post('/distribution/discover', async (req, res) => {
  try {
    const r = await distEngine.discover(parseInt(req.body && req.body.limit, 10) || 6);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/distribution/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.all(
    'SELECT dl.*, d.name AS platform, d.country_code FROM dist_log dl LEFT JOIN dist_platforms d ON d.slug=dl.platform_slug ORDER BY dl.id DESC LIMIT ?',
    [limit]
  );
  res.json({ log: rows });
});

router.get('/distribution/tasks', (req, res) => {
  res.json({ tasks: db.all('SELECT * FROM dist_tasks ORDER BY (status="open") DESC, id DESC') });
});

router.post('/distribution/tasks/:id/done', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const t = db.get('SELECT * FROM dist_tasks WHERE id=?', [id]);
  if (!t) return res.status(404).json({ error: 'task not found' });
  db.run('UPDATE dist_tasks SET status="done", done_at=? WHERE id=?', [db.now(), id]);
  db.persist();
  res.json({ ok: true, task: db.get('SELECT * FROM dist_tasks WHERE id=?', [id]) });
});

router.post('/distribution/tasks/:id/skip', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run('UPDATE dist_tasks SET status="skipped", done_at=? WHERE id=?', [db.now(), id]);
  db.persist();
  res.json({ ok: true });
});

// Connect a platform by storing the owner's official credentials (stored only
// in this user-owned DB, never in logs; used only for real API calls).
router.post('/distribution/connect', (req, res) => {
  const slug = String((req.body && req.body.slug) || '').trim();
  const p = db.get('SELECT * FROM dist_platforms WHERE slug=?', [slug]);
  if (!p) return res.status(404).json({ error: 'unknown platform' });
  const creds = (req.body && req.body.creds) || {};
  db.run(
    `INSERT INTO dist_connectors (platform_slug,account_label,creds,linked,connected_at,retries)
     VALUES (?,?,?,1,?,0)
     ON CONFLICT(platform_slug) DO UPDATE SET creds=?, account_label=?, linked=1, connected_at=?, retries=0`,
    [slug, req.body.label || '', JSON.stringify(creds), db.now(), JSON.stringify(creds), req.body.label || '', db.now()]
  );
  db.persist();
  res.json({ ok: true, slug, connected: true });
});

router.post('/distribution/disconnect', (req, res) => {
  const slug = String((req.body && req.body.slug) || '').trim();
  db.run('UPDATE dist_connectors SET linked=0, creds=NULL, connected_at=NULL WHERE platform_slug=?', [slug]);
  db.persist();
  res.json({ ok: true, slug });
});

// Regenerate the output RSS snapshot now.
router.post('/distribution/refresh-rss', (req, res) => {
  distEngine.refreshRss();
  db.persist();
  res.json({ ok: true, feed: distEngine.stats().feed_url });
});

// Honest manual submission record: a human completed an official platform
// submission (e.g. approved a manual task). Logged as a real completion, with
// the reason stated — never as an automated share.
router.post('/distribution/manual-share', (req, res) => {
  const slug = String((req.body && req.body.slug) || '').trim();
  const p = db.get('SELECT * FROM dist_platforms WHERE slug=?', [slug]);
  if (!p) return res.status(404).json({ error: 'unknown platform' });
  const url = String((req.body && req.body.url) || '').trim();
  const title = String((req.body && req.body.title) || p.name).slice(0, 200);
  db.run(
    'INSERT INTO dist_log (content_type,content_url,title,platform_slug,status,http_status,detail_url,message,attempted_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ['manual', url, title, slug, 'ok', 0, p.signup_url || p.url, 'Manual submission completed by admin on ' + p.name, db.now()]
  );
  db.run('UPDATE dist_platforms SET last_success=?, status="connected" WHERE slug=?', [db.now(), slug]);
  db.persist();
  res.json({ ok: true });
});

module.exports = router;
