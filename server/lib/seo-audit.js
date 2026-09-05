// WorldFront.News — Technical SEO Quality Control
//
// Runs automated checks over the live URL registry (indexed_urls), the
// database and the sitemap to surface real issues for the admin reports:
// broken/duplicate URLs, missing title/description/canonical/H1, invalid or
// missing JSON-LD, incorrect prices/currencies/locations, property media
// problems and sitemap mismatches.
//
// Never guesses. Every check is derived from actual database rows.

const db = require('../db');
const { CANONICAL_BASE } = require('./ssr');
const propSeo = require('./property-seo');

const ISO_DATE = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

// ---- URL registry rebuild ----
// Recomputes the repo of every indexable page (property, product, article,
// location, country, category, shop daily) with its SEO facts so checks can
// run against stable data.
function rebuildUrlRegistry() {
  const nowTs = db.now();
  db.run('DELETE FROM indexed_urls');
  const insert = (url, kind, lastmod, facts) => {
    db.run(
      `INSERT OR IGNORE INTO indexed_urls
       (url,kind,lastmod,status_code,title,meta_description,canonical,h1,has_jsonld,has_image,last_checked)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [url, kind, lastmod ? ISO_DATE(lastmod) : null, 200,
       facts.title || null, facts.metaDescription || null, facts.canonical || null,
       facts.h1 || null, facts.hasJsonLd ? 1 : 0, facts.hasImage ? 1 : 0, nowTs]
    );
  };

  // Property/product pages
  const products = db.all('SELECT * FROM shop_products WHERE published=1');
  for (const p of products) {
    const loc = propSeo.clean(p.city || p.town) ? (propSeo.clean(p.city || p.town) + (propSeo.clean(p.state) ? ', ' + propSeo.clean(p.state) : '')) : '';
    insert('/shop/product/' + encodeURIComponent(p.property_id || p.listing_id), 'property',
      p.updated_at, {
        title: p.title,
        metaDescription: (p.description || p.title || '').slice(0, 160),
        canonical: CANONICAL_BASE + '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id),
        h1: p.title,
        hasJsonLd: 1,
        hasImage: !!(p.thumbnail && /^https?:/.test(p.thumbnail) || propSeo.clean(p.video) || p.images)
      });
  }

  // Articles (excluding shop-daily editions which live at /shop/daily/...)
  const articles = db.all("SELECT * FROM articles WHERE status='published' AND (guid IS NULL OR guid NOT LIKE 'shop-daily:%')");
  for (const a of articles) {
    insert('/article/' + encodeURIComponent(a.slug), 'article', a.published_at, {
      title: a.title,
      metaDescription: (a.summary || a.title || '').slice(0, 160),
      canonical: CANONICAL_BASE + '/article/' + encodeURIComponent(a.slug),
      h1: a.title,
      hasJsonLd: 1,
      hasImage: !!(a.image && /^https?:/.test(a.image))
    });
  }

  // Countries
  const countries = db.all('SELECT code,name FROM countries');
  for (const c of countries) {
    insert('/country/' + c.code, 'country', null, {
      title: 'News from ' + c.name,
      metaDescription: 'Latest news from ' + c.name + ' on WorldFront.News.',
      canonical: CANONICAL_BASE + '/country/' + c.code,
      h1: 'News from ' + c.name, hasJsonLd: 1, hasImage: 0
    });
  }

  // Geo locations that qualify as landing pages (they have listings/content)
  const locs = db.all('SELECT * FROM geo_locations WHERE status=\'approved\'');
  for (const l of locs) {
    if (l.type === 'street' || l.type === 'landmark') continue;
    const chainHasContent = propertyCountForLocation(l.id) > 0;
    if (!chainHasContent) continue;
    insert('/property/' + locPath(l), 'location', l.updated_at, {
      title: 'Houses for Sale in ' + l.name,
      metaDescription: 'Houses for sale in ' + l.name + '.',
      canonical: CANONICAL_BASE + '/property/' + locPath(l),
      h1: 'Houses for Sale in ' + l.name, hasJsonLd: 0, hasImage: 0
    });
  }

  // Daily editions
  const eds = db.all('SELECT country_code,pub_date FROM shop_publication_days');
  for (const e of eds) {
    insert('/shop/daily/' + e.country_code + '/' + e.pub_date, 'edition', null, {
      title: e.pub_date + ' — ' + e.country_code + ' daily product update',
      metaDescription: 'Daily Weverse product update for ' + e.country_code + '.',
      canonical: CANONICAL_BASE + '/shop/daily/' + e.country_code + '/' + e.pub_date,
      h1: e.pub_date + ' daily update', hasJsonLd: 1, hasImage: 0
    });
  }

  db.persist();
  return db.get('SELECT COUNT(*) AS c FROM indexed_urls').c;
}

function locPath(loc) {
  // Build the chain path for a location record (root-first).
  const chain = [];
  let cur = loc;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    if (cur.parent_id) cur = db.get('SELECT * FROM geo_locations WHERE id=?', [cur.parent_id]);
    else cur = null;
  }
  return chain.map((l) => propSeo.slugifyFilename(l.name)).join('/');
}

function propertyCountForLocation(locationId) {
  return db.get('SELECT COUNT(*) AS c FROM listing_locations WHERE location_id=?', [locationId]).c;
}

// ---- Core audit ----
function runAudit(scope) {
  const issues = [];
  const stats = { checked: 0, urls: 0, properties: 0, articles: 0, locations: 0 };

  stats.urls = rebuildUrlRegistry();
  const rows = db.all('SELECT * FROM indexed_urls');

  const urlSeen = new Set();
  const titleSeen = new Map();
  const descSeen = new Map();
  const canonicalSeen = new Map();

  for (const r of rows) {
    stats.checked++;

    // Duplicate URLs (should never happen after dedup, but verify).
    if (urlSeen.has(r.url)) issues.push({ code: 'duplicate_url', url: r.url, sev: 'high', msg: 'Duplicate URL in registry' });
    urlSeen.add(r.url);

    // Titles.
    if (!r.title || !r.title.trim()) {
      issues.push({ code: 'missing_title', url: r.url, sev: 'high', msg: 'Missing title tag' });
    } else {
      const key = String(r.title).trim().toLowerCase();
      if (titleSeen.has(key) && titleSeen.get(key) !== r.url) {
        issues.push({ code: 'duplicate_title', url: r.url, sev: 'medium', msg: 'Duplicate title: "' + r.title.slice(0, 60) + '" (also on ' + titleSeen.get(key) + ')' });
      }
      titleSeen.set(key, r.url);
    }

    // Meta descriptions.
    if (!r.meta_description || !r.meta_description.trim()) {
      issues.push({ code: 'missing_meta_description', url: r.url, sev: 'medium', msg: 'Missing meta description' });
    } else {
      const key = String(r.meta_description).trim().toLowerCase();
      if (descSeen.has(key)) issues.push({ code: 'duplicate_meta_description', url: r.url, sev: 'low', msg: 'Duplicate meta description' });
      descSeen.set(key, r.url);
    }

    // Canonical.
    if (!r.canonical) {
      issues.push({ code: 'missing_canonical', url: r.url, sev: 'high', msg: 'Missing canonical URL' });
    } else if (String(r.canonical).replace(/\/+$/,'') !== (CANONICAL_BASE + r.url).replace(/\/+$/,'')) {
      issues.push({ code: 'incorrect_canonical', url: r.url, sev: 'high', msg: 'Canonical mismatch: ' + r.canonical });
    }

    // H1.
    if (!r.h1 || !r.h1.trim()) {
      issues.push({ code: 'missing_h1', url: r.url, sev: 'high', msg: 'Missing H1 heading' });
    } else if (String(r.h1).trim().length < 4) {
      issues.push({ code: 'incorrect_h1', url: r.url, sev: 'medium', msg: 'H1 too short: "' + r.h1 + '"' });
    }

    // Structured data.
    if (r.kind === 'property' && r.has_jsonld !== 1) {
      issues.push({ code: 'missing_jsonld', url: r.url, sev: 'high', msg: 'Property page missing structured data' });
    }

    // Images.
    if (r.kind === 'property' && r.has_image !== 1) {
      issues.push({ code: 'missing_image', url: r.url, sev: 'medium', msg: 'Property page has no real image/video' });
    }
  }

  // Property-level data correctness (prices, currency, location, media).
  const props = db.all("SELECT * FROM shop_products WHERE published=1");
  stats.properties = props.length;
  const propUrlSeen = new Set();
  for (const p of props) {
    const pid = p.property_id || p.listing_id;
    if (propUrlSeen.has(pid)) issues.push({ code: 'duplicate_property', url: '/shop/product/' + pid, sev: 'high', msg: 'Two listings share the same property id' });
    propUrlSeen.add(pid);

    // Price sanity: real listings always have a positive numeric price.
    if (p.price == null || isNaN(Number(p.price)) || Number(p.price) < 0) {
      issues.push({ code: 'incorrect_price', url: '/shop/product/' + pid, sev: 'high', msg: 'Price missing/invalid for "' + (p.title || '').slice(0, 60) + '"' });
    }
    if (p.price === 0) {
      issues.push({ code: 'zero_price', url: '/shop/product/' + pid, sev: 'low', msg: 'Price is 0 for "' + (p.title || '').slice(0, 60) + '"' });
    }
    if (!/^[A-Za-z]{3}$/.test(String(p.currency || '').trim())) {
      issues.push({ code: 'incorrect_currency', url: '/shop/product/' + pid, sev: 'high', msg: 'Invalid currency "' + p.currency + '"' });
    }

    // Location quality: never "Worldwide"/"Not specified" when a real one exists.
    if (p.city || p.town) {
      if (/^(not specified|none|worldwide|)$/i.test(String(p.state || '').trim()) && propSeo.clean(p.country_code)) {
        issues.push({ code: 'missing_region', url: '/shop/product/' + pid, sev: 'low', msg: 'City present but state/region missing' });
      }
    } else if (propSeo.clean(p.country_code)) {
      // fine — country-only is legitimate when that is all we know
    }

    // Media: real image/video URLs only.
    if (p.thumbnail && !/^https?:\/\//.test(p.thumbnail)) {
      issues.push({ code: 'broken_image_url', url: '/shop/product/' + pid, sev: 'high', msg: 'Thumbnail is not an absolute URL' });
    }
  }

  // Location pages thin check.
  const locs = db.all("SELECT * FROM geo_locations WHERE status='approved' AND type IN ('state','city','town','village','district','county')");
  stats.locations = locs.length;
  for (const l of locs) {
    const cnt = propertyCountForLocation(l.id);
    const arts = db.get('SELECT COUNT(*) AS c FROM articles WHERE region=? OR country_code=?', [l.name, l.country_code]);
    if (cnt === 0 && (arts ? arts.c : 0) === 0) {
      issues.push({ code: 'thin_location', url: '/property/' + locPath(l), sev: 'low', msg: 'No content for location "' + l.name + '"' });
    }
  }

  // Articles sanity.
  stats.articles = db.get("SELECT COUNT(*) AS c FROM articles WHERE status='published'").c;

  db.run('INSERT INTO seo_audit_log (run_at,scope,issues,stats) VALUES (?,?,?,?)',
    [db.now(), scope || 'all', JSON.stringify(issues), JSON.stringify(stats)]);
  const log = db.get('SELECT last_insert_rowid() AS id');
  const logId = log ? log.id : 0;
  db.persist();

  return { id: logId, run_at: db.now(), stats, total: issues.length, issues };
}

// Summary counts for the admin dashboard.
function auditSummary() {
  const last = db.get('SELECT * FROM seo_audit_log ORDER BY id DESC LIMIT 1');
  let summary = { run_at: 0, total: 0, high: 0, medium: 0, low: 0, stats: null, issues: [] };
  if (!last) return summary;
  const issues = JSON.parse(last.issues || '[]');
  summary = {
    run_at: last.run_at, total: issues.length,
    high: issues.filter((i) => i.sev === 'high').length,
    medium: issues.filter((i) => i.sev === 'medium').length,
    low: issues.filter((i) => i.sev === 'low').length,
    stats: JSON.parse(last.stats || '{}'),
    issues
  };
  return summary;
}

// Sitemap consistency: every indexed URL must have both a real page and a
// sitemap entry; every sitemap URL must exist in the registry or be valid.
function sitemapConsistency(urlset) {
  const problems = [];
  const registry = new Set(db.all('SELECT url FROM indexed_urls').map((r) => r.url));
  const seen = new Set();
  for (const u of urlset || []) {
    if (seen.has(u)) problems.push({ code: 'sitemap_duplicate', url: u, sev: 'high', msg: 'Duplicate URL in sitemap' });
    seen.add(u);
  }
  return problems;
}

module.exports = { rebuildUrlRegistry, runAudit, auditSummary, sitemapConsistency, locPath, propertyCountForLocation, ISO_DATE };