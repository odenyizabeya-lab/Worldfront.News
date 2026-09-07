// International product promotion for the Weverse Online Shop.
//
// The user's shop sells many product types, but this system targets the ones
// that matter internationally:
//   * Houses / real estate / houses for rent
//   * Cars, trucks
//   * Motorhomes / RVs
//   * Refrigerators & freezers (fridges)
//   * Washing machines / washers & dryers / laundry centers
//   * TVs / televisions
//
// For every target product and every supported country we generate a
// professional, unique news-style article + a localized product page. The
// content is built deterministically from a seed (product id + country code),
// so every product × country combination gets its own stable text, and the
// text is refreshed only when the underlying product facts change. Nothing is
// invented: prices, images, locations and specs are the real values from the
// shop catalog, and copy never claims Google will show a page anywhere.
//
// The supported country list comes from the same countries the site's own
// country selector lists (the `countries` table), filtered to the regions the
// owner chose (default: Americas, Europe, Oceania, Asia — set as
// shop_target_regions in settings). New products are picked up automatically
// on every shop sync: the matcher runs against the live catalog, so when the
// owner adds a new house, car, fridge or TV to the Weverse Online Shop it is
// automatically included in the next generation run.
const db = require('../db');
const ssr = require('../lib/ssr');
const { esc } = ssr;

const SHOP_BASE = (process.env.WEVERSE_SHOP_BASE_URL || 'https://weverseonlineshop.com').replace(/\/+$/, '');
const REGIONS_SETTING = 'shop_target_regions';
const DEFAULT_REGIONS = ['Americas', 'Europe', 'Oceania', 'Asia'];
const STATUS_PUBLISHED = 'published';

// ---- Target product matching (the categories the owner asked for) ----

const HOUSE_CATS = ['houses', 'townhouse', 'property', 'real estate', 'villa', 'apartment', 'condominium', 'residential'];
const CAR_CATS = ['cars', 'cars & vehicles', 'automobiles', 'vehicles', 'trucks', 'motorhomes', 'motorcycles', 'rvs', 'rv'];
const FRIDGE_SUBCATS = ['refrigerators', 'fridge', 'freezers', 'freezer'];
const WASHER_SUBCATS = ['washing machines', 'washers & dryers', 'washers', 'dryers', 'laundry centers', 'laundry'];
const TV_SUBCATS = ['televisions', 'tvs', 'television', 'tv'];
const HOUSE_SUBCATS = ['residential properties', 'tiny home', 'houses for rent', 'rental', 'apartment', 'villa', 'condominium'];

// Kids' ride-on toys are filed under Cars but are not real vehicles.
function isToyVehicle(p) {
  return /(kids|ride-on|ride on|toy |toys|12 ?v\b|rc car|push car)/i.test(String(p.title || ''));
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[^\w#&+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesAny(s, list) {
  const n = norm(s);
  return list.some((k) => n.indexOf(k) !== -1 || n === k);
}

// True when a product belongs to one of the internationally promoted types.
function isTargetProduct(p) {
  const cat = String(p.category || '');
  const sub = String(p.subcategory || '');
  const type = String(p.listing_type || '');
  const status = String(p.listing_status || '');
  const title = String(p.title || '');
  const nsub = norm(sub);
  const ntype = norm(type);

  // Houses / real estate / houses for rent.
  const isHouse = matchesAny(cat, HOUSE_CATS) || matchesAny(sub, HOUSE_SUBCATS) || ntype === 'property';
  if (isHouse) return true;

  // Cars / trucks / motorhomes (never toy vehicles).
  const isVehicle = matchesAny(cat, CAR_CATS) || ntype === 'vehicle';
  if (isVehicle) return !isToyVehicle(p);

  // Fridges.
  if (matchesAny(cat, ['home appliances', 'kitchen', 'kitchen & appliances']) && matchesAny(sub, FRIDGE_SUBCATS)) return true;
  if (matchesAny(sub, FRIDGE_SUBCATS)) return true;

  // Washing machines.
  if (matchesAny(cat, ['home appliances', 'kitchen', 'kitchen & appliances']) && matchesAny(sub, WASHER_SUBCATS)) return true;
  if (matchesAny(sub, WASHER_SUBCATS)) return true;

  // TVs / televisions.
  if (matchesAny(cat, ['electronics', 'electronics & appliances']) && matchesAny(sub, TV_SUBCATS)) return true;
  if (matchesAny(sub, TV_SUBCATS)) return true;

  // Motorhomes filed directly under the Motorhomes category.
  if (cat.toLowerCase().indexOf('motorhome') !== -1) return true;
  void status; void title;
  return false;
}

// ---- Supported countries: the site's own country list, region-filtered ----

function supportedRegions() {
  let regions = null;
  const row = db.get('SELECT value FROM settings WHERE key=?', [REGIONS_SETTING]);
  if (row) {
    try {
      const arr = JSON.parse(row.value);
      if (Array.isArray(arr) && arr.length) regions = arr.map((s) => String(s));
    } catch (e) { regions = null; }
  }
  if (!regions) return DEFAULT_REGIONS.slice();
  return regions.filter((r) => DEFAULT_REGIONS.indexOf(r) !== -1 || r !== '');
}

// Countries that get international product pages. Starts from the same rows
// the website's country selector uses (the `countries` table), then keeps only
// the owner-chosen regions.
function supportedCountries() {
  const regions = supportedRegions();
  return db.all(
    'SELECT code, name, region, subregion FROM countries WHERE region IN (' + regions.map(() => '?').join(',') + ') ORDER BY name',
    regions
  );
}

function isSold(p) {
  const s = String((p && (p.listing_status || p.listing_condition)) || '').toLowerCase();
  return s.indexOf('sold') !== -1 || s.indexOf('not available') !== -1 || s.indexOf('unavailable') !== -1 || s === 'sale complete';
}

// All currently published target products in the live catalog (JS filter over
// the local store, so a fresh sync immediately feeds the matcher).
function targetProducts() {
  return db.all('SELECT * FROM shop_products WHERE published=1')
    .filter((p) => isTargetProduct(p) && !isSold(p));
}

// ---- Deterministic seed per product × country ----

function makeSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedFor(pid, cc) {
  return makeSeed(String(pid || '') + '|' + String(cc || ''));
}

// ---- Copy generators (deterministic per seed → unique per combination) ----

// Human category noun used inside headlines/copy.
function typeNoun(p) {
  const cat = norm(p.category);
  const sub = norm(p.subcategory);
  if (cat === 'houses' || cat === 'townhouse' || sub === 'residential properties' || p.listing_type === 'property') {
    const st = norm(p.listing_status);
    return st.indexOf('rent') !== -1 || st.indexOf('lease') !== -1 ? 'Rental property' : 'House';
  }
  if (cat.indexOf('motorhome') !== -1 || sub.indexOf('rv') !== -1 || sub.indexOf('motorhome') !== -1) return 'Motorhome';
  if (cat === 'cars' || cat === 'cars & vehicles' || cat === 'trucks' || sub.indexOf('suv') !== -1 || sub.indexOf('sedan') !== -1) return 'Vehicle';
  if (sub.indexOf('televisions') !== -1 || sub.indexOf('tv') !== -1) return 'TV';
  if (sub.indexOf('refrigerator') !== -1 || sub.indexOf('freezer') !== -1 || sub.indexOf('fridge') !== -1) return 'Refrigerator';
  if (sub.indexOf('washer') !== -1 || sub.indexOf('dryer') !== -1 || sub.indexOf('laundry') !== -1) return 'Washing machine';
  return 'Product';
}

function forRent(p) {
  const st = norm(p.listing_status);
  return st.indexOf('rent') !== -1 || st.indexOf('lease') !== -1;
}

function cleanTitle(p) {
  return String(p.title || 'Product').replace(/^[^\w]+/, '').replace(/\s+/g, ' ').trim() || 'Product';
}

function headlineFor(p, country, seed) {
  const t = cleanTitle(p).slice(0, 80);
  const noun = typeNoun(p);
  const n = country.name;
  const variants = [
    t + ' — now featured for buyers in ' + n,
    n + ' readers: ' + t + ' from the Weverse Online Shop',
    t + ' offered internationally — a look for ' + n,
    'In ' + n + ': ' + t + ' and everything shoppers should know',
    t + ': pricing, facts and availability for ' + n,
    'Spotlight on ' + t + ' for "Weverse" shoppers in ' + n,
    noun + ' update from the Weverse Online Shop — ' + t + ' (for ' + n + ')',
    t + ' makes its international debut coverage — ' + n + ' edition'
  ];
  return variants[seed % variants.length];
}

function introFor(p, country, seed, featuredNoun) {
  const n = country.name;
  const sub = country.subregion ? ' in ' + country.subregion : '';
  const region = country.region;
  const t = cleanTitle(p).slice(0, 90);
  const brand = p.brand ? ' by ' + p.brand : '';
  const price = ssr.fmtPrice(p.price, p.currency);
  const variants = [
    'Readers in ' + n + ' can now explore ' + t + brand + ' in the Weverse Online Shop. This ' + featuredNoun.toLowerCase() + ' is listed at ' + price + ' and is among the international picks covered by WorldFront.News' + sub + '.',
    'WorldFront.News covers the Weverse Online Shop for readers across ' + region + ', and today it is highlighting ' + t + brand + ' — a ' + featuredNoun.toLowerCase() + ' currently listed at ' + price + ' for shoppers in ' + n + '.',
    'For our audience in ' + n + ', today\'s international product coverage looks at ' + t + brand + '. It is a ' + featuredNoun.toLowerCase() + ' offered in the Weverse Online Shop at ' + price + ', with the details below.'
  ];
  return variants[seed % variants.length];
}

function overviewBody(p, country) {
  const t = cleanTitle(p);
  const desc = String(p.description || '').trim();
  const n = country.name;
  const paras = [];
  if (desc) {
    paras.push('<p>' + esc(desc.slice(0, 600)) + '</p>');
  } else {
    paras.push('<p>This ' + typeNoun(p).toLowerCase() + ' is part of the Weverse Online Shop catalog that WorldFront.News tracks for readers in ' + n + '.</p>');
  }
  return paras.join('');
}

function keyDetails(p) {
  const rows = [];
  rows.push('<li>Price: <strong>' + esc(ssr.fmtPrice(p.price, p.currency)) + '</strong></li>');
  if (p.brand) rows.push('<li>Brand: ' + esc(p.brand) + '</li>');
  if (p.category) rows.push('<li>Category: ' + esc(p.category) + '</li>');
  if (p.subcategory && norm(p.subcategory) !== 'not specified') rows.push('<li>Type: ' + esc(p.subcategory) + '</li>');
  if (p.country_code && p.country_code !== '') {
    const place = [p.city || '', p.state || '', p.country && p.country !== 'Not specified' ? p.country : ''].filter(Boolean).join(', ');
    if (place) rows.push('<li>Location: ' + esc(place) + '</li>');
  }
  if (p.bedrooms) rows.push('<li>Bedrooms: ' + esc(p.bedrooms) + '</li>');
  if (p.bathrooms) rows.push('<li>Bathrooms: ' + esc(p.bathrooms) + '</li>');
  if (p.building_size) rows.push('<li>Building size: ' + esc(p.building_size) + '</li>');
  if (p.land_size) rows.push('<li>Land size: ' + esc(p.land_size) + '</li>');
  if (p.listing_status && norm(p.listing_status) !== '') rows.push('<li>Status: ' + esc(p.listing_status) + '</li>');
  if (Array.isArray(p.features)) {
    const feats = p.features.filter((f) => f && String(f).trim());
    if (feats.length) rows.push('<li>Features: ' + esc(feats.slice(0, 8).join(', ')) + '</li>');
  }
  return rows.length ? '<h2>Key details</h2><ul class="product-specs-list">' + rows.join('') + '</ul>' : '';
}

function buyNoteFor(p, country, seed) {
  const n = country.name;
  const variants = [
    'Orders are handled directly by the Weverse Online Shop. Before buying, confirm current availability, shipping options and delivery time for ' + n + ' on the official shop page.',
    'The Weverse Online Shop processes orders for its international catalog. Buyers in ' + n + ' should check the listing for today\'s availability, price and delivery details.',
    'For ' + n + ' shoppers, the fastest way to check stock and shipping is the official Weverse Online Shop listing linked below — details can change without notice.'
  ];
  return variants[seed % variants.length];
}

function closingFor(p, country) {
  const n = country.name;
  return 'WorldFront.News shines a spotlight on Weverse Online Shop products so readers in ' + n +
    ' can discover new houses, vehicles and home appliances from around the world. ' +
    'New items the owner adds to the shop are covered automatically. Browse the full catalog any time from the product page below.';
}

// Full deterministic article body (single-source of truth; rendered into the
// localized product page and the news-style article view).
function articleBody(p, country, seed) {
  const noun = typeNoun(p).toLowerCase();
  const rent = forRent(p);
  const parts = [];
  parts.push('<p class="article-summary">' + esc(introFor(p, country, seed, typeNoun(p))) + '</p>');
  parts.push(overviewBody(p, country));
  if (rent) {
    parts.push('<p>This listing is available as a rental — readers interested in renting should review the terms directly with the Weverse Online Shop before proceeding.</p>');
  }
  parts.push(keyDetails(p));
  parts.push('<h2>Buying for readers in ' + esc(country.name) + '</h2><p>' + esc(buyNoteFor(p, country, (seed + 7) >>> 0)) + '</p>');
  parts.push('<p>' + esc(closingFor(p, country)) + '</p>');
  return parts.join('\n');
}

function summaryFor(p, country, seed) {
  return introFor(p, country, seed, typeNoun(p)).slice(0, 300);
}

// ---- Generation + persistence ----

// Refresh the product × country matrix. Pure upsert: existing rows that are
// unchanged keep their published_at; changed/new rows are written now. Never
// deletes anything. Returns a summary.
function publishCountryPages(opts = {}) {
  const products = opts.products || targetProducts();
  const countries = opts.countries || supportedCountries();
  const nowTs = db.now();
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 0;
  const rot = opts.rotate ? Math.max(0, parseInt(opts.rotate, 10) || 0) : 0;
  const allPairs = [];
  for (const p of products) {
    for (const c of countries) {
      allPairs.push([p, c]);
    }
  }
  // Optional rotating window (used by cron so new/edited products spread out
  // instead of all landing at once). Default: all pairs every run.
  const list = limit ? allPairs.slice(rot % Math.max(1, allPairs.length), rot % Math.max(1, allPairs.length) + limit) : allPairs;

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const [p, c] of list) {
    const key = String(p.property_id || p.listing_id);
    if (!key || !c.code) continue;
    const seed = seedFor(key, c.code);
    const headline = headlineFor(p, c, seed);
    const summary = summaryFor(p, c, seed);
    const prev = db.get('SELECT headline, summary, updated_at FROM shop_country_pages WHERE listing_id=? AND country_code=?', [key, c.code]);
    if (!prev) {
      db.run(
        `INSERT INTO shop_country_pages (listing_id,country_code,headline,summary,seed,status,published_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [key, c.code, headline, summary, seed, STATUS_PUBLISHED, nowTs, nowTs]
      );
      created++;
    } else if (prev.headline !== headline || prev.summary !== summary) {
      db.run(
        `UPDATE shop_country_pages SET headline=?, summary=?, seed=?, status=?, pushed=0, updated_at=? WHERE listing_id=? AND country_code=?`,
        [headline, summary, seed, STATUS_PUBLISHED, nowTs, key, c.code]
      );
      updated++;
    } else {
      db.run(`UPDATE shop_country_pages SET status=? WHERE listing_id=? AND country_code=?`, [STATUS_PUBLISHED, key, c.code]);
      unchanged++;
    }
  }
  db.persist();
  return { mode: 'country-pages', regions: supportedRegions(), countries: countries.length, products: products.length, pairs: list.length, created, updated, unchanged };
}

// Rows for a country (published), newest first.
function countryPages(cc) {
  return db.all(
    'SELECT * FROM shop_country_pages WHERE country_code=? AND status=? ORDER BY updated_at DESC',
    [String(cc).toUpperCase(), STATUS_PUBLISHED]
  );
}

// One page row for product × country (for the localized page render).
function pageRow(pid, cc) {
  return db.get('SELECT * FROM shop_country_pages WHERE listing_id=? AND country_code=? AND status=?', [pid, String(cc).toUpperCase(), STATUS_PUBLISHED]);
}

function targetStats() {
  return {
    target_products: targetProducts().length,
    supported_regions: supportedRegions(),
    supported_countries: supportedCountries().length,
    published_pages: db.get("SELECT COUNT(*) AS n FROM shop_country_pages WHERE status='published'").n,
    countries_published: db.get("SELECT COUNT(DISTINCT country_code) AS n FROM shop_country_pages WHERE status='published'").n
  };
}

module.exports = {
  isTargetProduct, targetProducts, supportedRegions, supportedCountries,
  seedFor, headlineFor, introFor, articleBody, summaryFor, typeNoun, forRent,
  publishCountryPages, countryPages, pageRow, targetStats, SHOP_BASE
};