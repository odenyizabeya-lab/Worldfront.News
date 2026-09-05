const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');
const { fetchEnabled } = require('../ingest/rss');
const { runApiProviders } = require('../ingest/api');
const shop = require('../integrations/weverse-shop');

const router = express.Router();

function publicArticle(a) {
  return {
    id: a.id, guid: a.guid, title: a.title, slug: a.slug, summary: a.summary,
    image: a.image, source_name: a.source_name, source_url: a.source_url,
    author: a.author, country_code: a.country_code, region: a.region,
    category: a.category, published_at: a.published_at, fetched_at: a.fetched_at,
    link: a.link, featured: a.featured, breaking: a.breaking, clicks: a.clicks
  };
}

function buildArticleQuery(filters) {
  const where = ["status='published'"];
  const params = [];
  if (filters.country) { where.push('country_code=?'); params.push(String(filters.country).toUpperCase()); }
  if (filters.category) { where.push('category=?'); params.push(filters.category); }
  if (filters.region) { where.push('region=?'); params.push(filters.region); }
  if (filters.q) {
    where.push('(title LIKE ? OR summary LIKE ? OR source_name LIKE ? OR category LIKE ?)');
    const like = '%' + filters.q + '%';
    params.push(like, like, like, like);
  }
  if (filters.breaking === '1') where.push('breaking=1');
  if (filters.featured === '1') where.push('featured=1');
  const orderBy = filters.sort === 'clicks' ? 'clicks DESC, published_at DESC' : 'published_at DESC';
  return { where: where.join(' AND '), params, orderBy };
}

// GET /api/articles?country=&category=&region=&q=&page=&limit=&sort=&breaking=&featured=
router.get('/articles', (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const f = buildArticleQuery(req.query);

  const countRow = db.get(`SELECT COUNT(*) AS c FROM articles WHERE ${f.where}`, f.params);
  const total = countRow ? countRow.c : 0;
  const offset = (page - 1) * limit;

  const rows = db.all(
    `SELECT * FROM articles WHERE ${f.where} ORDER BY ${f.orderBy} LIMIT ? OFFSET ?`,
    [...f.params, limit, offset]
  );
  res.json({
    articles: rows.map(publicArticle),
    page, limit, total, totalPages: Math.ceil(total / limit)
  });
});

// GET /api/articles/featured
router.get('/articles/featured', (req, res) => {
  const rows = db.all(
    "SELECT * FROM articles WHERE status='published' AND featured=1 ORDER BY published_at DESC LIMIT ?",
    [parseInt(req.query.limit || '6', 10)]
  );
  res.json({ articles: rows.map(publicArticle) });
});

// GET /api/breaking
// AUTOMATIC MODE: surfaces the latest real articles without admin action.
//  - urgent   : genuinely urgent stories (articles flagged breaking, or admin-published
//               breaking_news entries). These get the red "BREAKING" treatment.
//  - items    : ordered list for the ticker / main graphic. Urgent first, then the
//               latest eligible real articles so the LIVE graphic always shows fresh news.
router.get('/breaking', (req, res) => {
  const nowTs = db.now();
  const urgentWindow = nowTs - 7 * 24 * 3600;     // 7 days
  const recency = nowTs - 48 * 3600;              // 48h recency for automatic latest news

  // Tier 1: genuinely urgent flag (engine or admin elevated, recently)
  const urgentFlag = db.all(
    `SELECT id, title, country_code, link, slug AS article_slug, published_at AS created_at, category, image
     FROM articles WHERE status='published' AND breaking=1 AND published_at > ?
     ORDER BY published_at DESC LIMIT 10`,
    [urgentWindow]
  );

  // Tier 1b: admin-published breaking_news entries (still respected, user opted priority)
  const manual = db.all(
    `SELECT b.id, b.title, b.article_id, b.country_code, b.link, b.created_at,
            a.slug AS article_slug
     FROM breaking_news b LEFT JOIN articles a ON a.id=b.article_id
     WHERE b.active=1 ORDER BY b.created_at DESC LIMIT 10`
  );

  // Tier 2: latest real articles (automatic) - fill so the graphic always has news.
  const latest = db.all(
    `SELECT id, title, country_code, link, slug AS article_slug, published_at AS created_at, category, image,
            breaking
     FROM articles WHERE status='published' AND published_at > ?
     ORDER BY published_at DESC LIMIT 20`,
    [recency]
  );

  const items = [];
  const seen = new Set();
  const push = (title, meta, urgent) => {
    const t = (title || '').trim();
    if (!t || seen.has(String(t).toLowerCase())) return;
    seen.add(String(t).toLowerCase());
    items.push({ id: meta.id, title: t, country_code: meta.country_code || '', link: meta.link || (meta.article_slug ? '/#/article/' + meta.article_slug : ''), created_at: meta.created_at, category: meta.category || '', image: meta.image || null, urgent: !!urgent });
  };

  // Urgent first (most recent first)
  for (const m of manual) push(m.title, m, true);
  for (const f of urgentFlag) push(f.title, f, true);

  // Then automatic latest real news
  for (const l of latest) push(l.title, l, false);

  const hasUrgent = (manual.length + urgentFlag.length) > 0;
  const current = typeof req.query.country === 'string' ? req.query.country : null;
  res.json({ items, urgent: hasUrgent, empty: items.length === 0, current });
});

// GET /api/articles/:id
router.get('/articles/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let a = db.get("SELECT * FROM articles WHERE id=? AND status='published'", [id]);
  if (!a) {
    // fallback by slug
    a = db.get("SELECT * FROM articles WHERE slug=? AND status='published'", [req.params.id]);
  }
  if (!a) return res.status(404).json({ error: 'Article not found' });
  db.run('UPDATE articles SET clicks = clicks + 1 WHERE id=?', [a.id]);
  db.persist();
  const related = db.all(
    `SELECT * FROM articles WHERE status='published' AND category=? AND id != ?
     ORDER BY published_at DESC LIMIT 6`,
    [a.category, a.id]
  );
  res.json({ article: publicArticle(a), related: related.map(publicArticle) });
});

// Search endpoint (word, headline, source, category)
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [], total: 0 });
  const like = '%' + q + '%';
  const results = db.all(
    `SELECT id,title,slug,summary,image,source_name,country_code,category,published_at,link
     FROM articles WHERE status='published' AND
     (title LIKE ? OR summary LIKE ? OR source_name LIKE ? OR category LIKE ? OR country_code LIKE ?)
     ORDER BY published_at DESC LIMIT 50`,
    [like, like, like, like, like]
  );
  res.json({ query: q, total: results.length, results });
});

// Countries list
router.get('/countries', (req, res) => {
  const rows = db.all(
    `SELECT c.code, c.name, c.region, c.subregion, c.lat, c.lng,
            (SELECT COUNT(*) FROM articles a WHERE a.country_code=c.code AND a.status='published') AS article_count
     FROM countries c WHERE c.code IN (SELECT DISTINCT country_code FROM articles WHERE status='published')
       OR c.code IN (SELECT DISTINCT country_code FROM news_sources)
     ORDER BY c.name`
  );
  res.json({ countries: rows });
});

// All regions
router.get('/regions', (req, res) => {
  const regions = db.all('SELECT DISTINCT region FROM countries ORDER BY region');
  res.json({ regions: regions.map(r => r.region) });
});

// Countries grouped by region
router.get('/regions/countries', (req, res) => {
  const rows = db.all('SELECT code,name,region,subregion,lat,lng FROM countries ORDER BY name');
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.region]) grouped[r.region] = [];
    grouped[r.region].push(r);
  }
  res.json({ grouped });
});

// Locations (cities/states) for a country
router.get('/locations', (req, res) => {
  const country = req.query.country;
  let rows;
  if (country) {
    rows = db.all(
      "SELECT * FROM locations WHERE country_code=? ORDER BY type, name", [String(country).toUpperCase()]
    );
  } else {
    rows = db.all('SELECT * FROM locations ORDER BY country_code, type, name LIMIT 5000');
  }
  res.json({ locations: rows });
});

// Map data: articles with coordinates
router.get('/map', (req, res) => {
  const rows = db.all(
    `SELECT a.id, a.title, a.category, a.published_at, a.source_name, a.country_code,
            c.name AS country_name, c.lat, c.lng
     FROM articles a JOIN countries c ON c.code=a.country_code
     WHERE a.status='published' AND c.lat IS NOT NULL
     ORDER BY a.published_at DESC LIMIT 2000`
  );
  res.json({ points: rows });
});

// ---- Categories ----
router.get('/categories', (req, res) => {
  const rows = db.all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM articles a WHERE a.category=c.slug AND a.status='published') AS article_count
     FROM categories c WHERE c.active=1 ORDER BY c.name`
  );
  res.json({ categories: rows });
});

// ---- Public site articles (admin-published) ----
router.get('/site-articles/:slug', (req, res) => {
  const a = db.get("SELECT * FROM site_articles WHERE slug=? AND status='published'", [req.params.slug]);
  if (!a) return res.status(404).json({ error: 'Article not found' });
  res.json({ article: a });
});

// ---- Weverse Shop Updates (products auto-published from the shop's catalog) ----
function publicProduct(p) {
  return {
    listing_id: p.listing_id, property_id: p.property_id, title: p.title,
    description: p.description, category: p.category, subcategory: p.subcategory,
    brand: p.brand, price: p.price, currency: p.currency, thumbnail: p.thumbnail,
    product_url: p.product_url, updated_at: p.updated_at
  };
}

// GET /api/shop/products?limit=&category=&q=
router.get('/shop/products', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '24', 10), 1), 100);
  const category = req.query.category;
  const q = (req.query.q || '').trim();
  let sql = 'SELECT * FROM shop_products WHERE published=1';
  const params = [];
  if (category) { sql += ' AND category=?'; params.push(String(category).slice(0, 80)); }
  if (q) {
    const like = '%' + q + '%';
    sql += ' AND (title LIKE ? OR description LIKE ? OR brand LIKE ? OR category LIKE ?)';
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.all(sql, params);
  const totals = db.get('SELECT COUNT(*) AS c FROM shop_products WHERE published=1');
  const cats = db.all(
    'SELECT category, COUNT(*) AS c FROM shop_products WHERE published=1 GROUP BY category ORDER BY c DESC'
  );
  res.json({
    products: rows.map(publicProduct),
    total: totals ? totals.c : 0,
    categories: cats
  });
});

// GET /api/shop/product/:id  (by listing_id or property_id)
router.get('/shop/product/:id', (req, res) => {
  const p = db.get(
    'SELECT * FROM shop_products WHERE (listing_id=? OR property_id=?) AND published=1',
    [req.params.id, req.params.id]
  );
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json({ product: publicProduct(p) });
});

// GET /api/shop/daily?country=NG&date=YYYY-MM-DD
// One country's full daily edition: headline, intro, closing, and the complete
// ordered product lineup. Products reference the single source-of-truth rows in
// shop_products by id/URL (no image or data duplication).
router.get('/shop/daily', (req, res) => {
  const country = String(req.query.country || 'US').toUpperCase();
  const date = String(req.query.date || shop.dateKey(new Date()));
  const edition = shop.dailyEdition(country, date);
  if (!edition) return res.status(404).json({ error: 'No daily edition for that country/date' });
  const article = db.get('SELECT slug, published_at FROM articles WHERE guid=?', ['shop-daily:' + country + ':' + date]);
  res.json({ edition, article_slug: article ? article.slug : null, article_published_at: article ? article.published_at : null });
});

// GET /api/shop/daily/:country  → latest available edition for a country
router.get('/shop/daily/:country', (req, res) => {
  const country = String(req.params.country).toUpperCase();
  const row = db.get(
    'SELECT pub_date FROM shop_publication_days WHERE country_code=? ORDER BY pub_date DESC LIMIT 1',
    [country]
  );
  if (!row) return res.status(404).json({ error: 'No daily edition for that country' });
  return res.redirect('/api/shop/daily?country=' + encodeURIComponent(country) + '&date=' + row.pub_date);
});

// GET /api/shop/dailies  → index of available daily editions (country, date, headline, article slug)
router.get('/shop/dailies', (req, res) => {
  const rows = db.all(
    `SELECT d.country_code, d.pub_date, d.headline, d.featured_listing_id,
            a.slug AS article_slug
     FROM shop_publication_days d
     LEFT JOIN articles a ON a.guid = 'shop-daily:' || d.country_code || ':' || d.pub_date
     ORDER BY d.pub_date DESC, d.country_code`
  );
  res.json({
    dailies: rows.map((r) => ({
      country_code: r.country_code, date: r.pub_date, headline: r.headline,
      featured_listing_id: r.featured_listing_id, article_slug: r.article_slug
    }))
  });
});

// GET /api/shop/stats
router.get('/shop/stats', (req, res) => {
  const totals = db.get('SELECT COUNT(*) AS c FROM shop_products WHERE published=1');
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_sync'");
  res.json({ total: totals ? totals.c : 0, last_sync: last ? last.value : '0' });
});

// ---- Stats ----
router.get('/stats', (req, res) => {
  const settings = {};
  for (const s of db.all('SELECT * FROM settings')) settings[s.key] = s.value;
  res.json({
    articles: db.get('SELECT COUNT(*) AS c FROM articles WHERE status="published"').c,
    countries: db.get('SELECT COUNT(DISTINCT country_code) AS c FROM articles WHERE status="published"').c,
    sources: db.get('SELECT COUNT(*) AS c FROM news_sources WHERE enabled=1').c,
    last_fetch: settings.last_full_fetch
  });
});

module.exports = router;
module.exports.buildArticleQuery = buildArticleQuery;
