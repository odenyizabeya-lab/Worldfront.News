// Weverse Online Shop integration (READ-ONLY)
//
// The shop (weverseonlineshop.com) is the owner's own e-commerce site. Its catalog
// lives in Supabase Postgres, which the shop's own front-end reads through the
// official Supabase REST API. This module pulls products through that same official
// API (no scraping, no HTML parsing) using the shop's publishable client key.
//
// The publishable key is public by design: it is already embedded in the shop's
// own public JS bundles and can only read data the shop's policies allow. It can
// never be used to write. Override all of these via environment variables.
const db = require('../db');

const SUPABASE_URL = (process.env.WEVERSE_SHOP_SUPABASE_URL || 'https://wttnvwpoqmbxryivcerf.supabase.co').replace(/\/+$/, '');
const ANON_KEY = process.env.WEVERSE_SHOP_ANON_KEY || 'sb_publishable_X_6kXsJwApi7v7HwoC1xtA_igns4Rxa';
const SHOP_BASE = (process.env.WEVERSE_SHOP_BASE_URL || 'https://weverseonlineshop.com').replace(/\/+$/, '');

const ENTITY_PRODUCT = 'product';

function productUrl(id) {
  if (!id) return SHOP_BASE;
  return SHOP_BASE + '/details.html?id=' + encodeURIComponent(id);
}

// The shop's details.html resolves its ?id= parameter against the listing's
// property_id column (see its own front-end: it renders a Supabase row only
// when l.property_id === e, and its recommendation links use ?id=property_id).
// Linking by listing_id (the UUID) shows "Listing not found", so product URLs
// must always be built from property_id.
function productUrlFor(p) {
  return productUrl(p.property_id || p.listing_id || '');
}

// POST the shop's own catalog search endpoint (same call its front-end makes).
async function fetchCatalog() {
  const url = SUPABASE_URL + '/rest/v1/rpc/smart_search_quick';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY
    },
    body: JSON.stringify({ p_query: '', p_limit: 2000 }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error('Shop catalog fetch failed: HTTP ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function normalize(p) {
  const id = p.listing_id || p.property_id;
  return {
    listing_id: id || null,
    property_id: p.property_id || id || '',
    title: String(p.title || 'Untitled').trim().slice(0, 300),
    description: String(p.description || '').slice(0, 1600),
    category: String(p.category || 'General').slice(0, 80),
    subcategory: String(p.subcategory || ''),
    brand: String(p.brand || ''),
    price: Number(p.price) || 0,
    currency: String(p.currency || 'USD'),
    thumbnail: String(p.thumbnail || ''),
    product_url: productUrlFor(p)
  };
}

// Full sync: upsert every product from the shop catalog into WorldFront's DB.
async function sync() {
  await db.ready();
  const rows = await fetchCatalog();
  const nowTs = db.now();
  let inserted = 0;
  let updated = 0;
  const seen = [];
  for (const raw of rows) {
    const p = normalize(raw);
    if (!p.listing_id) continue;
    seen.push(p.listing_id);
    const prev = db.get('SELECT listing_id, price, published FROM shop_products WHERE listing_id=?', [p.listing_id]);
    if (!prev) {
      db.run(
        `INSERT INTO shop_products (listing_id,property_id,title,description,category,subcategory,brand,price,currency,thumbnail,product_url,published,created_at,updated_at,prev_price,restock_at,price_changed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,null,null)`,
        [p.listing_id, p.property_id, p.title, p.description, p.category, p.subcategory,
         p.brand, p.price, p.currency, p.thumbnail, p.product_url, nowTs, nowTs, p.price]
      );
      inserted++;
    } else {
      const priceChanged = Number(p.price) !== Number(prev.price || 0);
      const backInStock = prev.published === 0;
      if (priceChanged) {
        db.run(
          `UPDATE shop_products SET property_id=?, title=?, description=?, category=?, subcategory=?, brand=?,
                   price=?, currency=?, thumbnail=?, product_url=?, updated_at=?, prev_price=?, price_changed_at=?,
                   published=1, restock_at=CASE WHEN ?=1 THEN ? ELSE restock_at END
             WHERE listing_id=?`,
          [p.property_id, p.title, p.description, p.category, p.subcategory,
           p.brand, p.price, p.currency, p.thumbnail, p.product_url, nowTs, prev.price, nowTs,
           backInStock ? 1 : 0, nowTs, p.listing_id]
        );
      } else {
        db.run(
          `UPDATE shop_products SET property_id=?, title=?, description=?, category=?, subcategory=?, brand=?,
                   price=?, currency=?, thumbnail=?, product_url=?, updated_at=?, prev_price=?,
                   published=1, restock_at=CASE WHEN ?=1 THEN ? ELSE restock_at END
             WHERE listing_id=?`,
          [p.property_id, p.title, p.description, p.category, p.subcategory,
           p.brand, p.price, p.currency, p.thumbnail, p.product_url, nowTs, p.price,
           backInStock ? 1 : 0, nowTs, p.listing_id]
        );
      }
      updated++;
    }
  }
  if (seen.length) {
    const placeholders = seen.map(() => '?').join(',');
    db.run('UPDATE shop_products SET published=0 WHERE listing_id NOT IN (' + placeholders + ') AND published=1', seen);
  }
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_sync',?)", [String(nowTs)]);
  // Enrich every listing with its real location + media/specs from the showroom.
  // Failures never break the sync — the catalog itself is always stored.
  const enrich = await enrichFromShowroom().catch((e) => ({ error: String((e && e.message) || e) }));
  db.persist();
  return { total: rows.length, inserted, updated, last_sync: nowTs, enrich };
}

// Pulls the rich showroom records (real address, coordinates, media, specs,
// status) for every synced listing and stores them locally in both
// property_details (single source of truth) and the shop_products columns, so
// images, videos, locations and JSON-LD always reflect the real listing.
// Only real fields are stored; junk/unverifiable values are dropped.
const LISTING_IMAGE_KIND = /image\//i;
function isRealMediaUrl(u) {
  return /\.(jpg|jpeg|png|webp|avif|gif|mp4|webm|ogv|mov|m4v|mpg|mpeg)(\?|#|$)/i.test(String(u || ''));
}
async function enrichFromShowroom() {
  await db.ready();
  let showroomMap = new Map();
  try {
    showroomMap = await fetchShowroomListings();
  } catch (e) {
    return { error: 'showroom fetch failed', message: String((e && e.message) || e), enriched: 0 };
  }
  const products = db.all('SELECT listing_id, property_id FROM shop_products WHERE published=1');
  let enriched = 0;

  for (const p of products) {
    const pid = p.property_id ? String(p.property_id) : '';
    const row = pid ? showroomMap.get(pid) : null;
    if (!row) continue;

    const clean = (v) => /^(not specified|none|n\/a|—|-|,$|worldwide|null|undefined)?$/i.test(String(v || '').trim()) ? '' : String(v).trim();

    const images = Array.isArray(row.images)
      ? row.images.map(absMedia).filter((u) => u && hasMediaExt(u)).slice(0, 20)
      : [];
    const video = firstVideoMedia(row) || '';
    const primaryImg = firstImageMedia(row, p.thumbnail || '');
    const thumbnail = primaryImg || p.thumbnail || '';

    const lat = typeof row.lat === 'number' && isFinite(row.lat) ? row.lat : null;
    const lng = typeof row.lng === 'number' && isFinite(row.lng) ? row.lng : null;
    const cc = clean(row.country_code) ? String(row.country_code).toUpperCase() : '';
    const ccValid = cc ? db.get('SELECT code FROM countries WHERE code=?', [cc]) : null;
    const countryCol = ccValid ? cc : '';

    const features = Array.isArray(row.features) ? row.features.filter(clean).slice(0, 20) : [];

    db.run(
      `UPDATE shop_products SET
         country_code=?, state=?, city=?, town=?, village=?, district=?, neighborhood=?,
         street=?, house_number=?, postal_code=?, landmark=?, lat=?, lng=?,
         video=?, images=?, bedrooms=?, bathrooms=?, building_size=?, land_size=?,
         parking_spaces=?, features=?, listing_condition=?, listing_status=?, listing_type=?,
         location_verified=?, coordinates_verified=?, thumbnail=?
       WHERE listing_id=?`,
      [countryCol, clean(row.state), clean(row.city), clean(row.town), clean(row.village),
       clean(row.district), clean(row.neighborhood), clean(row.street), clean(row.house_number),
       clean(row.postal_code), clean(row.landmark), lat, lng,
       video, JSON.stringify(images), clean(row.bedrooms), clean(row.bathrooms),
       clean(row.building_size), clean(row.land_size), clean(row.parking_spaces),
       JSON.stringify(features), clean(row.condition), clean(row.listing_status),
       clean(row.listing_type), lat != null && lng != null ? 1 : 0,
       lat != null && lng != null ? 1 : 0, thumbnail, p.listing_id]
    );

    // Single source of truth record for property pages/JSON-LD.
    db.run(
      `INSERT INTO property_details
       (property_id,listing_id,listing_type,category,subcategory,title,description,price,currency,
        country,country_code,state,city,town,village,district,neighborhood,street,house_number,
        postal_code,landmark,lat,lng,video,video_url,images,bedrooms,bathrooms,building_size,
        land_size,parking_spaces,features,condition,listing_status,coordinates_verified,
        location_verified,media_verified,fetched_at,raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(property_id) DO UPDATE SET
        listing_id=excluded.listing_id,listing_type=excluded.listing_type,category=excluded.category,
        subcategory=excluded.subcategory,title=excluded.title,description=excluded.description,
        price=excluded.price,currency=excluded.currency,country=excluded.country,
        country_code=excluded.country_code,state=excluded.state,city=excluded.city,town=excluded.town,
        village=excluded.village,district=excluded.district,neighborhood=excluded.neighborhood,
        street=excluded.street,house_number=excluded.house_number,postal_code=excluded.postal_code,
        landmark=excluded.landmark,lat=excluded.lat,lng=excluded.lng,video=excluded.video,
        video_url=excluded.video_url,images=excluded.images,bedrooms=excluded.bedrooms,
        bathrooms=excluded.bathrooms,building_size=excluded.building_size,land_size=excluded.land_size,
        parking_spaces=excluded.parking_spaces,features=excluded.features,condition=excluded.condition,
        listing_status=excluded.listing_status,coordinates_verified=excluded.coordinates_verified,
        location_verified=excluded.location_verified,media_verified=excluded.media_verified,
        fetched_at=excluded.fetched_at,raw=excluded.raw`,
      [pid, p.listing_id, clean(row.listing_type), clean(row.category), clean(row.subcategory),
       clean(row.title) || p.title, clean(row.description), row.price ?? p.price,
       clean(row.currency) || p.currency || 'USD', clean(row.country), countryCol,
       clean(row.state), clean(row.city), clean(row.town), clean(row.village),
       clean(row.district), clean(row.neighborhood), clean(row.street), clean(row.house_number),
       clean(row.postal_code), clean(row.landmark), lat, lng, video, video,
       JSON.stringify(images), clean(row.bedrooms), clean(row.bathrooms),
       clean(row.building_size), clean(row.land_size), clean(row.parking_spaces),
       JSON.stringify(features), clean(row.condition), clean(row.listing_status),
       lat != null && lng != null ? 1 : 0, lat != null && lng != null ? 1 : 0,
       video ? 1 : images.length ? 1 : 0, db.now(),
       JSON.stringify({ source: 'showroom_listings', fetched_from: 'supabase' })]
    );
    enriched++;
  }

  // Connect every listing to its resolved real location in the location DB.
  const { resolveListingLocation, linkListing } = require('../lib/location');
  const rich = db.all("SELECT * FROM shop_products WHERE published=1 AND country_code != ''");
  for (const r of rich) {
    const loc = resolveListingLocation(r, { includeStreet: true, verified: !!(r.lat != null && r.lng != null) });
    if (loc) linkListing('property', r.listing_id, loc, 'primary');
  }
  db.persist();
  return { enriched, linked: rich.length };
}

// Automatic daily sync: skips if a sync already ran within the cooldown.
async function maybeSync(cooldownSec = 6 * 3600) {
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_sync'");
  const lastTs = last ? parseInt(last.value, 10) || 0 : 0;
  if (lastTs && (db.now() - lastTs) < cooldownSec) {
    return { skipped: true, last_sync: lastTs };
  }
  return sync();
}

// ---- Product → News article auto-publishing ----
//
// Every day ALL products are published as WorldFront shopping-news articles.
// Each article:
//   * goes into the existing `articles` table (category 'shopping'),
//   * has a stable unique guid 'shop:<listing_id>' so re-syncs never duplicate,
//   * carries a unique slug so it has its own WorldFront URL,
//   * links to the correct product page (prodUrl) for the "buy/view now" button,
//   * is global (country_code NULL = "all countries").
//
// Change detection: if title/price/description/image changed since the last
// publish, its published_at is refreshed so the update surfaces as new.

const PREVIEW_LISTING_IDS = [
  'a4e5cdf9-eca4-488a-b193-3d989c2b6903', // Dell Alienware m15
  '29e781a5-c6b4-45ac-8a55-c75aae94df33', // Whirlpool fridge
  'fc129bcd-4503-45b0-9f82-d63ff15f1041'  // Samsung 4K TV
];

function slugFromListing(id, title) {
  const base = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const h = require('crypto').createHash('sha1').update(String(id)).digest('hex').slice(0, 8);
  return (base || 'product') + '-' + h;
}

function priceLabel(p) {
  const n = Number(p.price) || 0;
  return (p.currency || 'USD') + ' ' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Compose which products to publish based on mode. 'preview' → exactly the 3
// preview products; 'full' → every published product in the catalog.
function selectProducts(mode, limit) {
  let rows;
  if (mode === 'preview') {
    const map = new Map();
    for (const id of PREVIEW_LISTING_IDS) {
      const r = db.get('SELECT * FROM shop_products WHERE listing_id=?', [id]);
      if (r) map.set(id, r);
    }
    rows = Array.from(map.values());
  } else {
    const qs = limit
      ? 'SELECT * FROM shop_products WHERE published=1 ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM shop_products WHERE published=1 ORDER BY updated_at DESC';
    const params = limit ? [limit] : [];
    rows = db.all(qs, params);
  }
  // Sold listings keep their live property page (and schema) but never appear
  // in the active daily-edition product lineups.
  return rows.filter((p) => !isSold(p));
}

// True when the shop marks the listing as sold / no longer available.
function isSold(p) {
  const s = String((p && (p.listing_status || p.listing_condition)) || '').toLowerCase();
  return s.indexOf('sold') !== -1 || s.indexOf('not available') !== -1 || s.indexOf('unavailable') !== -1;
}

// Verify which listings are currently active in the shop (the exact data the
// shop's details page resolves by property_id). Returns a Set of active
// property_ids. Used to guarantee we never publish a broken "Listing not found"
// link: a product is only published when its property_id is active here.
async function fetchActivePropertyIds() {
  const url = SUPABASE_URL + '/rest/v1/showroom_listings?select=property_id&is_active=eq.true&limit=5000';
  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + ANON_KEY
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error('Active listings check failed: HTTP ' + res.status);
  const rows = await res.json();
  return new Set((Array.isArray(rows) ? rows : []).map(r => String(r.property_id || '')));
}

// Publish products as shopping-news articles.
//   mode: 'preview' (exactly the 3 preview products) or 'full' (all).
//   limit: optional int cap for 'full' mode (used by the 3-article launch).
// A product is only published if its Weverse link resolves to an ACTIVE listing
// in the shop (verified via showroom_listings by property_id). Broken or
// inactive links are reported in `broken` and never published.
// Returns a summary: { mode, submitted, created, updated, broken, verified }.
async function publishArticles(mode = 'full', limit = 0) {
  const rows = selectProducts(mode === 'preview' ? 'preview' : 'full', limit);
  const activeIds = await fetchActivePropertyIds();
  const nowTs = db.now();
  let created = 0;
  let updated = 0;
  let verified = 0;
  const broken = [];
  for (const p of rows) {
    if (!p.listing_id) continue;
    const pid = String(p.property_id || '');
    // Link integrity guard: only publish listings that are real and active.
    if (!pid || !activeIds.has(pid)) {
      broken.push({ property_id: pid, title: p.title, reason: !pid ? 'no property_id' : 'inactive or missing listing' });
      continue;
    }
    verified++;
    const guid = 'shop:' + p.listing_id;
    const title = '🛍️ ' + (p.title || 'New product');
    const slug = slugFromListing(p.listing_id, p.title);
    const summary = [
      String(p.brand || '').trim() && 'Brand: ' + p.brand,
      p.category && 'Category: ' + p.category,
      p.price ? 'Price: ' + priceLabel(p) : null,
      p.subcategory && 'Type: ' + p.subcategory
    ].filter(Boolean).join(' · ') + (p.description ? '. ' : '') + (String(p.description || '').slice(0, 220) || '');
    const product = db.get('SELECT * FROM articles WHERE guid=?', [guid]);
    const existing = product ? { title: product.title, image: product.image, link: product.link, summary: product.summary } : null;
    const changed =
      !product ||
      product.title !== title ||
      (product.image || '') !== (p.thumbnail || '') ||
      (product.link || '') !== (p.product_url || '') ||
      (product.summary || '') !== summary;

    if (!product) {
      db.run(
        `INSERT INTO articles (guid,title,slug,summary,content,image,source_name,source_url,author,category,country_code,region,published_at,fetched_at,link,featured,breaking,status,clicks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [guid, title, slug, summary,
         (String(p.description || '') + '\n\nBrand: ' + (p.brand || '') + '\nCategory: ' + (p.category || '') + '\nPrice: ' + priceLabel(p) + '\n\nView and buy at: ' + p.product_url).slice(0, 4000),
         p.thumbnail || '', 'Weverse Shop', SHOP_BASE, 'Weverse Shop',
         'shopping', null, null, nowTs, nowTs, p.product_url, 0, 0, 'published', 0]
      );
      created++;
    } else if (changed) {
      db.run(
        `UPDATE articles SET title=?, summary=?, content=?, image=?, link=?, published_at=?, fetched_at=? WHERE guid=?`,
        [title, summary,
         (String(p.description || '') + '\n\nBrand: ' + (p.brand || '') + '\nCategory: ' + (p.category || '') + '\nPrice: ' + priceLabel(p) + '\n\nView and buy at: ' + p.product_url).slice(0, 4000),
         p.thumbnail || '', p.product_url, nowTs, nowTs, guid]
      );
      updated++;
    }
  }
  db.persist();
  return { mode, submitted: rows.length, created, updated, verified, broken };
}

// ---------------------------------------------------------------------------
// Daily per-country editions ("Daily product update" model)
//
// Every day, for EVERY supported country, the COMPLETE current product
// collection is published as a fresh country-specific shopping article:
//
//   * Fresh headline, intro, product order, featured product and closing,
//     rewritten naturally each day (rotated deterministically by date).
//   * A product published yesterday is NOT a duplicate — it is republished.
//   * The content is labelled a "daily shopping selection" / "daily product
//     update", never as newly-released products (unless genuinely new).
//   * New products added to the shop (houses, cars, everything) are imported
//     by sync() and automatically included in the next edition.
//   * Product data/images are stored ONCE in shop_products and only referenced
//     by ID/URL. Each country×date creates a lightweight publication record
//     (product id, country, date, headline, item text, product order).
//   * Publications are pruned after DAILY_RETENTION_DAYS; the article history
//     row always keeps the edition's headline/intro/closing.
// ---------------------------------------------------------------------------

const DAILY_RETENTION_DAYS = 3;
const COUNTRIES_SETTING = 'shop_publication_countries';

function pad2(n) { return String(n).padStart(2, '0'); }

function dateKey(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function daysSinceEpoch(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

// Countries to produce editions for. Default = every country in the DB.
// Override via the setting 'shop_publication_countries' = JSON array of codes.
function supportedCountries() {
  let list = null;
  const row = db.get("SELECT value FROM settings WHERE key=? AND value IS NOT NULL", [COUNTRIES_SETTING]);
  if (row) {
    try {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr) && arr.length) list = arr.map((s) => String(s));
    } catch (e) { list = null; }
  }
  const all = db.all('SELECT code, name FROM countries ORDER BY name');
  if (!list) return all.map((c) => ({ code: c.code, name: c.name }));
  return all.filter((c) => list.includes(c.code));
}

// --- Rotating copy generators (deterministic per date so every day differs) --

function headlineFor(countryName, count, seed) {
  const variants = [
    count + ' Weverse products available for fans in ' + countryName,
    "Today's Weverse daily selection: " + count + ' products for fans in ' + countryName,
    'Weverse Online Shop daily product update — ' + count + ' products for ' + countryName,
    count + ' fresh daily Weverse picks for fans in ' + countryName,
    'Daily Weverse shopping selection — ' + count + ' products currently in the shop for ' + countryName
  ];
  return variants[seed % variants.length];
}

function introFor(countryName, count, seed, featuredTitle, featuredPrice) {
  const variants = [
    "Welcome to today's daily shopping selection from the Weverse Online Shop for " + countryName + '. This edition gathers all ' + count + ' products currently available. Today\'s featured product is ' + featuredTitle + ', ' + featuredPrice + '.',
    'Here is the Weverse Online Shop daily product update for ' + countryName + '. All ' + count + ' available products are included in today\'s fresh selection, with ' + featuredTitle + ' leading the lineup.',
    'This is today\'s Weverse daily shopping selection for fans in ' + countryName + '. Browse all ' + count + ' products pulled fresh from the shop below, with ' + featuredTitle + ' as today\'s highlighted pick.'
  ];
  return variants[seed % variants.length];
}

function closingFor(countryName, count, seed) {
  const variants = [
    'This was the complete daily selection of ' + count + ' products for ' + countryName + ' from the Weverse Online Shop. New items — including houses and cars — are imported automatically, so check back tomorrow for a brand new daily edition.',
    'That concludes today\'s daily product update for ' + countryName + '. The Weverse Online Shop is checked regularly for new products, price changes and stock updates, and tomorrow brings another fresh selection.',
    'End of today\'s daily shopping selection for ' + countryName + '. The catalog is refreshed every day straight from the Weverse Online Shop — return tomorrow for a new lineup of ' + count + '+ products.'
  ];
  return variants[seed % variants.length];
}

function calloutFor(p) {
  if (p.created_at && p.created_at >= db.now() - 3 * 86400) return 'Newly added to the shop';
  if (p.restock_at && p.restock_at >= db.now() - 3 * 86400) return 'Back in stock';
  if (p.price_changed_at && p.price_changed_at >= db.now() - 3 * 86400) return 'Price updated';
  return '';
}

function itemTextFor(p, callout) {
  const parts = [p.title + ' — ' + priceLabel(p)];
  if (callout) parts.push('(' + callout + ')');
  const brand = String(p.brand || '').trim();
  if (brand) parts.push('Brand: ' + brand);
  const desc = String(p.description || '').trim();
  if (desc) parts.push(desc.slice(0, 140));
  return parts.join(' · ');
}

// Publish the complete current product collection as a fresh edition for every
// supported country (or the subset in `countries`). Running again for the same
// date is idempotent (upsert on listing×country×date). Returns a summary.
async function publishDaily(countries, theDate) {
  await db.ready();
  const date = theDate || dateKey(new Date());
  const dayIdx = Math.abs(daysSinceEpoch(date));
  const target = Array.isArray(countries) && countries.length ? countries.map((s) => String(s)) : null;

  const activeIds = await fetchActivePropertyIds();
  let rows = db.all('SELECT * FROM shop_products WHERE published=1 ORDER BY listing_id ASC');
  // Sold listings stay on their live property pages but never enter today's
  // active country editions (keeps "for sale" lists honest).
  rows = rows.filter((p) => !isSold(p));
  const broken = rows.filter((p) => {
    const pid = String(p.property_id || '');
    return !pid || !activeIds.has(pid);
  });
  rows = rows.filter((p) => {
    const pid = String(p.property_id || '');
    return pid && activeIds.has(pid);
  });

  const count = rows.length;
  const nowTs = db.now();
  let articles = 0;
  let items = 0;
  let created = 0;
  let updated = 0;

  if (count === 0) {
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_publish',?)", [String(nowTs)]);
    db.persist();
    return { mode: 'daily', date, countries: 0, products_per_country: 0, items: 0, created: 0, updated: 0, pruned: 0, broken: broken.length };
  }

  for (const c of supportedCountries()) {
    if (target && !target.includes(c.code)) continue;
    const seed = dayIdx + (c.code ? c.code.charCodeAt(0) + c.code.length : 0);
    const offset = seed % Math.max(1, count);
    const ordered = rows.slice(offset).concat(rows.slice(0, offset));
    const featured = ordered[(offset + 27) % Math.max(1, count)];
    const headline = headlineFor(c.name, count, seed);
    const intro = introFor(c.name, count, seed, featured.title, priceLabel(featured));
    const closing = closingFor(c.name, count, seed);
    const content = [
      intro,
      'Featured today: ' + featured.title + ' — ' + priceLabel(featured) + '.',
      'View the shop: ' + SHOP_BASE,
      closing
    ].join('\n\n');

    const guid = 'shop-daily:' + c.code + ':' + date;
    const slug = slugFromListing(guid, 'weverse-daily-' + (c.name || c.code) + '-' + date);
    const article = db.get('SELECT id FROM articles WHERE guid=?', [guid]);
    if (!article) {
      db.run(
        `INSERT INTO articles (guid,title,slug,summary,content,image,source_name,source_url,source_id,author,category,country_code,region,published_at,fetched_at,link,featured,breaking,status,clicks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [guid, headline, slug, intro.slice(0, 300),
         content,
         featured.thumbnail || '',
         'Weverse Shop', SHOP_BASE, null, 'Weverse Shop',
         'shopping', c.code, null, nowTs, nowTs, productUrlFor(featured), 0, 0, 'published', 0]
      );
      created++;
    } else {
      db.run(
        `UPDATE articles SET title=?, summary=?, content=?, image=?, link=?, published_at=?, fetched_at=? WHERE guid=?`,
        [headline, intro.slice(0, 300), content, featured.thumbnail || '', productUrlFor(featured), nowTs, nowTs, guid]
      );
      updated++;
    }

    db.run(
      `INSERT OR REPLACE INTO shop_publication_days (country_code,pub_date,headline,intro,closing,featured_listing_id,created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [c.code, date, headline, intro, closing, featured.listing_id, nowTs]
    );

    let pos = 1;
    for (const p of ordered) {
      const callout = calloutFor(p);
      db.run(
        `INSERT INTO shop_publications (listing_id,country_code,pub_date,headline,item_text,product_order,featured,created_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(listing_id,country_code,pub_date) DO UPDATE SET
           headline=excluded.headline, item_text=excluded.item_text,
           product_order=excluded.product_order, featured=excluded.featured, created_at=excluded.created_at`,
        [p.listing_id, c.code, date, headline, itemTextFor(p, callout), pos, p.listing_id === featured.listing_id ? 1 : 0, nowTs]
      );
      items++;
      pos++;
    }
    articles++;
  }

  const cutoff = dateKey(new Date(Date.now() - DAILY_RETENTION_DAYS * 86400000));
  const pruned = db.get('SELECT COUNT(*) AS n FROM shop_publications WHERE pub_date < ?', [cutoff]).n;
  db.run('DELETE FROM shop_publications WHERE pub_date < ?', [cutoff]);
  db.run('DELETE FROM shop_publication_days WHERE pub_date < ?', [cutoff]);
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_publish',?)", [String(db.now())]);
  db.persist();

  return { mode: 'daily', date, countries: articles, products_per_country: count, items, created, updated, pruned, broken: broken.length };
}

// Read one edition by country + date, joined with the single source-of-truth
// product rows (no data duplication). Returns null when no edition exists.
function dailyEdition(countryCode, date) {
  const day = db.get('SELECT * FROM shop_publication_days WHERE country_code=? AND pub_date=?', [countryCode, date]);
  if (!day) return null;
  const pub = db.all('SELECT * FROM shop_publications WHERE country_code=? AND pub_date=? ORDER BY product_order', [countryCode, date]);
  const items = [];
  for (const r of pub) {
    const p = db.get('SELECT * FROM shop_products WHERE listing_id=?', [r.listing_id]);
    items.push({
      listing_id: r.listing_id,
      product_order: r.product_order,
      featured: r.featured,
      item_text: r.item_text,
      title: p ? p.title : '',
      price: p ? p.price : 0,
      currency: p ? p.currency : 'USD',
      brand: p ? p.brand : '',
      category: p ? p.category : '',
      image: p ? p.thumbnail : '',
      product_url: p ? productUrlFor(p) : ''
    });
  }
  return {
    country: day.country_code,
    date: day.pub_date,
    headline: day.headline,
    intro: day.intro,
    closing: day.closing,
    featured_listing_id: day.featured_listing_id,
    total: pub.length,
    items
  };
}

// ---------------------------------------------------------------------------
// Real-estate & vehicle posts (authentic showroom media, Houses & Real Estate
// and Cars & Vehicles only)
//
// The shop imports real property and vehicle listings into its showroom. Their
// `showroom_listings` rows carry truthful media (often a real walkthrough video
// as the only media), the true location, the true price and real specs. Daily
// editions re-use a random gallery thumbnail as their front image, which is why
// a bedframe sometimes became the "cover" of a house story.
//
// These dedicated posts fix that for the two real-world categories only:
//   * Houses & Real Estate  → categories Townhouse / Houses (listing_type
//     'property'; subcategories Residential Properties / Tiny Home / ...)
//   * Cars & Vehicles       → categories Cars / Cars & Vehicles / Trucks /
//     Motorcycles and genuine RV subcategories under Motorhomes (the Motorhomes
//     category also contains mis-filed furniture like bed frames, so only real
//     RVs/motorhomes within it qualify).
// Each post uses the listing's own real media (real video first, otherwise the
// real image), the correct title, real location, real price and real specs.
// Listings without usable media are never published, so there are no fake
// covers. The existing automatic posting system is untouched.
// ---------------------------------------------------------------------------

const SHOWROOM_SELECT =
  'property_id,listing_type,category,subcategory,title,description,price,currency,country,country_code,state,city,town,' +
  'video,video_url,images,bedrooms,bathrooms,building_size,land_size,parking_spaces,features,condition,listing_status';
const STORAGE_PUBLIC = SUPABASE_URL + '/storage/v1/object/public/';

function isHousingListing(p) {
  const cat = String(p.category || '').trim().toLowerCase();
  const sub = String(p.subcategory || '').trim().toLowerCase();
  return cat === 'townhouse' || cat === 'houses' || cat === 'property' ||
    ['residential properties', 'tiny home', 'villa', 'apartment', 'condominium', 'townhouse'].includes(sub);
}

function isVehicleListing(p) {
  const cat = String(p.category || '').trim().toLowerCase();
  const sub = String(p.subcategory || '').trim().toLowerCase();
  if (['cars', 'cars & vehicles', 'trucks', 'motorcycles', 'automobiles', 'vehicles'].includes(cat)) return true;
  if (cat === 'motorhomes') {
    return ['class a motorhome', 'class b motorhome', 'class c motorhome', 'class a rv', 'class b rv',
      'class c rv', 'motorhomes', 'rv', 'rvs', 'recreational vehicle', 'camper', 'campervan'].includes(sub);
  }
  return ['suv', 'sedan', 'sports car', 'luxury coupe', 'luxury suv', 'hatchback', 'coupe',
    'convertible', 'pickup', 'pickup truck', 'truck', 'semi truck', 'van', 'motorcycle'].includes(sub);
}

function absMedia(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return 'https:' + s;
  const path = s.replace(/^\/+/, '');
  return STORAGE_PUBLIC + (/^product-images\//.test(path) ? path : 'product-images/' + path);
}

function isMediaVideo(u) {
  return /\.(mp4|webm|ogv|mov|m4v|mpg|mpeg)(\?|$)/i.test(String(u || ''));
}

function cleanSpec(x) { return /^(not specified|none|null|n\/a|—|,|-)?$/i.test(String(x || '').trim()) ? '' : String(x).trim(); }

// Junk rows sometimes store empty/degenerate "media" values (e.g. 'products/'
// with no filename). Only accept media that has a real file extension.
function hasMediaExt(u) {
  return /\.[a-z0-9]{2,5}([?#]|$)/i.test(String(u || ''));
}

// Battery-powered kids ride-on toys are filed under Cars/Trucks but are not
// authentic vehicles, so they never appear as "Vehicle for sale" posts.
function isToyVehicle(p) {
  return /(kids|ride-on|ride on|toy |toys|12 ?v\b|rc car|push car)/i.test(String(p.title || ''));
}

function firstImageMedia(row, fallbackThumb) {
  const imgs = Array.isArray(row.images)
    ? row.images.map(absMedia).filter((u) => u && hasMediaExt(u) && !isMediaVideo(u))
    : [];
  if (imgs.length) return imgs[0];
  const fb = absMedia(fallbackThumb);
  return fb && hasMediaExt(fb) && !isMediaVideo(fb) ? fb : '';
}

function firstVideoMedia(row) {
  const v = absMedia(row.video || row.video_url || '');
  if (v && isMediaVideo(v)) return v;
  const imgs = Array.isArray(row.images) ? row.images.map(absMedia).filter((u) => u && isMediaVideo(u)) : [];
  return imgs[0] || '';
}

function mediaCandidates(row, fallbackThumb) {
  const out = [];
  const v = firstVideoMedia(row || {});
  if (v) out.push(v);
  const im = firstImageMedia(row || {}, fallbackThumb || '');
  if (im) out.push(im);
  return out;
}

async function verifyMedia(u) {
  try {
    const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return false;
    return /^(image|video)\//.test(String(r.headers.get('content-type') || ''));
  } catch (e) {
    return false;
  }
}

async function fetchShowroomListings() {
  const url = SUPABASE_URL + '/rest/v1/showroom_listings?select=' + encodeURIComponent(SHOWROOM_SELECT) + '&limit=5000';
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) throw new Error('Showroom listings fetch failed: HTTP ' + res.status);
  const rows = await res.json();
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.property_id) map.set(String(r.property_id), r);
  }
  return map;
}

// Idempotent, change-detected posts for Houses & Real Estate and Cars &
// Vehicles only. Duplicate imports of the same house (two property_ids sharing
// one title) are de-duplicated so the house is posted once.
async function publishHousingAndVehiclePosts() {
  await db.ready();
  const listings = await fetchShowroomListings();
  const seenTitles = new Set();
  const nowTs = db.now();
  let created = 0;
  let updated = 0;
  let skippedNoMedia = 0;
  let skippedDup = 0;
  let skippedToys = 0;

  const rows = db.all('SELECT * FROM shop_products WHERE published=1 ORDER BY listing_id ASC');
  for (const p of rows) {
    if (!isHousingListing(p) && !isVehicleListing(p)) continue;
    if (isVehicleListing(p) && isToyVehicle(p)) {
      // Toys are not authentic vehicles: remove any auto-post we created for
      // them early on, and never re-publish.
      db.run("DELETE FROM articles WHERE guid=?", ['shop-property:' + p.listing_id]);
      skippedToys++;
      continue;
    }

    const row = p.property_id ? listings.get(String(p.property_id)) : null;
    const candidates = mediaCandidates(row || {}, p.thumbnail || '');

    const kind = isHousingListing(p) ? 'House' : 'Vehicle';
    const title = String((row && row.title) ? row.title : p.title).trim().replace(/\s+/g, ' ');
    const titleKey = title.toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();
    if (!titleKey || seenTitles.has(titleKey)) { skippedDup++; continue; }
    seenTitles.add(titleKey);

    const loc = [cleanSpec(row && row.city), cleanSpec(row && row.state), cleanSpec(row && row.country)]
      .filter(Boolean).join(', ');
    const price = priceLabel({
      price: row && row.price != null && Number(row.price) ? row.price : p.price,
      currency: row && row.currency ? row.currency : p.currency
    });
    const type = String(((row && row.subcategory) || p.subcategory || p.category) || '').trim();
    const cc = row && row.country_code ? String(row.country_code).toUpperCase() : '';
    const ccValid = cc ? db.get('SELECT code FROM countries WHERE code=?', [cc]) : null;

    const specLines = [];
    if (isHousingListing(p)) {
      if (cleanSpec(row && row.bedrooms)) specLines.push('Bedrooms: ' + cleanSpec(row.bedrooms));
      if (cleanSpec(row && row.bathrooms)) specLines.push('Bathrooms: ' + cleanSpec(row.bathrooms));
      if (cleanSpec(row && row.building_size)) specLines.push('Building size: ' + cleanSpec(row.building_size));
      if (cleanSpec(row && row.land_size)) specLines.push('Land size: ' + cleanSpec(row.land_size));
      if (cleanSpec(row && row.parking_spaces)) specLines.push('Parking spaces: ' + cleanSpec(row.parking_spaces));
    }
    if (row && Array.isArray(row.features) && row.features.length) {
      const f = row.features.filter(cleanSpec);
      if (f.length) specLines.push('Features: ' + f.slice(0, 8).join(', '));
    }
    if (cleanSpec(row && row.condition)) specLines.push('Condition: ' + cleanSpec(row.condition));

    const video = candidates.find((c) => isMediaVideo(c)) || '';

    const summary = (kind === 'House' ? 'Property for sale' : 'Vehicle for sale') +
      (loc ? ' — ' + loc : '') + ' — ' + price + (type ? ' · ' + type : '') +
      ((row && cleanSpec(row.listing_status)) ? ' · Status: ' + cleanSpec(row.listing_status) : '');

    const description = String(row && row.description ? row.description : p.description || '').trim();
    const body = [
      description || ('Located in ' + (loc || 'the Weverse showroom') + ', this ' + (type || 'listing').toLowerCase() + ' is offered at ' + price + '.'),
      'Key details',
      '- Location: ' + (loc || 'Weverse showroom listing'),
      '- Price: ' + price,
      '- Type: ' + (type || p.category || 'Listed')
    ].concat(specLines.map((s) => '- ' + s), [
      video ? '- Walkthrough video: ' + video : '',
      '- View the full listing: ' + productUrlFor(p)
    ]).filter(Boolean).join('\n');

    const guid = 'shop-property:' + p.listing_id;
    const slug = slugFromListing(p.listing_id, 'property-' + title);
    const link = productUrlFor(p);
    const countryCol = ccValid ? cc : null;

    const product = db.get('SELECT * FROM articles WHERE guid=?', [guid]);
    const changed =
      !product ||
      product.title !== title ||
      (product.image || '') !== (candidates[0] || '') ||
      (product.summary || '') !== summary ||
      (product.content || '') !== body ||
      (product.link || '') !== link ||
      ((product.country_code || '') !== (countryCol || '')) ||
      ((product.source_name || '') !== 'Weverse Shop');
    if (product && !changed) continue;

    // Real-media guard: only publish a listing whose chosen media actually
    // resolves as an image/video. Unverifiable media (e.g. stale /products/
    // paths) never reaches the site and any leftover auto-post is removed.
    let image = '';
    for (const c of candidates) {
      if (await verifyMedia(c)) { image = c; break; }
    }
    if (!image) {
      db.run("DELETE FROM articles WHERE guid=?", [guid]);
      skippedNoMedia++;
      continue;
    }

    if (!product) {
      db.run(
        `INSERT INTO articles (guid,title,slug,summary,content,image,source_name,source_url,author,category,country_code,region,published_at,fetched_at,link,featured,breaking,status,clicks)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [guid, title, slug, summary, body.slice(0, 4000), image, 'Weverse Shop', SHOP_BASE, 'Weverse Shop',
         'shopping', countryCol, null, nowTs, nowTs, link, 0, 0, 'published', 0]
      );
      created++;
    } else {
      db.run(
        `UPDATE articles SET title=?, summary=?, content=?, image=?, link=?, country_code=?, published_at=?, fetched_at=? WHERE guid=?`,
        [title, summary, body.slice(0, 4000), image, link, countryCol, nowTs, nowTs, guid]
      );
      updated++;
    }
  }
  db.persist();
  return { submitted: rows.filter((p) => isHousingListing(p) || isVehicleListing(p)).length, created, updated, skipped_no_media: skippedNoMedia, skipped_duplicates: skippedDup, skipped_toys: skippedToys };
}

// Runnable on any schedule (the in-process loop calls it every 15 minutes and
// the Vercel cron every hour). Publishes the fresh edition set for today when:
//   * no edition exists for today yet (self-heals a missed/partial day), or
//   * the last full publish is older than 20h (a new day is due), or
//   * the live catalog count changed since today's edition was built
//     (new products such as houses/cars are imported automatically and the
//     complete current collection is re-published for every country).
// Refresh only ever upserts today's publication records; it never deletes
// products, articles, images, prices or older editions' pages.
async function autoPublish() {
  const mode = publishMode();
  if (mode !== 'daily') {
    return { skipped: true, mode };
  }
  await db.ready();
  await maybeSync(); // refresh the catalog first so prices/links/count are current
  const propertyPosts = await publishHousingAndVehiclePosts().catch((err) => ({
    error: String((err && err.message) || err)
  }));
  const state = publishState();
  if (state.needs_publish) {
    const res = await publishDaily();
    return { skipped: false, mode, reason: state.reason, result: res, property_posts: propertyPosts };
  }
  return { skipped: true, mode, reason: state.reason, property_posts: propertyPosts };
}

// Current publishing state: mode, today's fresh-edition coverage and whether a
// re-publish of today's editions is due (new day / missing today / grew count).
function publishState() {
  const mode = publishMode();
  const today = dateKey(new Date());
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_publish'");
  const lastTs = last ? parseInt(last.value, 10) || 0 : 0;
  const day = db.get(
    "SELECT COUNT(*) AS n FROM shop_publication_days WHERE pub_date=?",
    [today]
  );
  const editionsToday = day ? day.n : 0;
  const activeCount = db.get('SELECT COUNT(*) AS n FROM shop_products WHERE published=1').n;
  let editionCount = 0;
  const sample = db.get(
    "SELECT country_code FROM shop_publication_days WHERE pub_date=? LIMIT 1",
    [today]
  );
  if (sample) {
    const c = db.get(
      "SELECT COUNT(*) AS n FROM shop_publications WHERE pub_date=? AND country_code=?",
      [today, sample.country_code]
    );
    editionCount = c ? c.n : 0;
  }
  let needs_publish = false;
  let reason = 'fresh';
  if (editionsToday === 0) {
    needs_publish = true;
    reason = lastTs ? 'previous-day editions only; today is due' : 'no editions published yet';
  } else if (lastTs && (db.now() - lastTs) >= 20 * 3600) {
    needs_publish = true;
    reason = 'new day (publish not run for ' + Math.round((db.now() - lastTs) / 3600) + 'h)';
  } else if (editionCount !== 0 && activeCount !== editionCount) {
    needs_publish = true;
    reason = 'catalog count changed ' + editionCount + ' → ' + activeCount;
  }
  return {
    mode, today, editions_today: editionsToday,
    active_products: activeCount, edition_products: editionCount,
    last_shop_publish: lastTs, needs_publish, reason
  };
}

function publishMode() {
  const row = db.get("SELECT value FROM settings WHERE key='shop_publish_mode'");
  const v = row && row.value;
  return v === 'daily' || v === 'full' ? 'daily' : 'preview';
}

module.exports = {
  fetchCatalog, sync, maybeSync, fetchActivePropertyIds,
  productUrl, productUrlFor, SHOP_BASE,
  publishArticles, autoPublish, publishMode, publishState, PREVIEW_LISTING_IDS,
  publishDaily, dailyEdition, supportedCountries, dateKey,
  publishHousingAndVehiclePosts, fetchShowroomListings, enrichFromShowroom
};