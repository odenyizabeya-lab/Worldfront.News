const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated DB for this test file: clean schema-only instance in a temp dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-promo-test-'));
process.env.WF_DATA_DIR = TMP;

const db = require('../db');
const promo = require('../lib/country-promotion');

before(async () => {
  await db.initialize();
  // A few countries across the default promotion regions.
  for (const c of [
    { code: 'US', name: 'United States', region: 'Americas', subregion: 'Northern America' },
    { code: 'FR', name: 'France', region: 'Europe', subregion: 'Western Europe' },
    { code: 'JP', name: 'Japan', region: 'Asia', subregion: 'Eastern Asia' },
    { code: 'AU', name: 'Australia', region: 'Oceania', subregion: 'Australia and New Zealand' },
    { code: 'NG', name: 'Nigeria', region: 'Africa', subregion: 'Western Africa' }
  ]) {
    db.run('INSERT INTO countries (code,name,region,subregion,flag,lat,lng) VALUES (?,?,?,?,NULL,0,0)', [c.code, c.name, c.region, c.subregion]);
  }
  // Synthetic catalog covering every targeted type + a toy that must NOT match.
  const products = [
    { listing_id: 'L-HOUSE', property_id: 'P-HOUSE', title: 'Modern family house in the suburbs', category: 'Real Estate', subcategory: 'Residential Properties', price: 250000, currency: 'USD', published: 1 },
    { listing_id: 'L-CAR', property_id: 'P-CAR', title: 'Used SUV in excellent condition', category: 'Vehicles', subcategory: 'Cars', price: 18500, currency: 'USD', published: 1 },
    { listing_id: 'L-TRUCK', property_id: 'P-TRUCK', title: 'Heavy duty pickup truck', category: 'Vehicles', subcategory: 'Trucks', price: 32000, currency: 'USD', published: 1 },
    { listing_id: 'L-RV', property_id: 'P-RV', title: 'Family motorhome with slide-out', category: 'Motorhomes', subcategory: 'Motorhomes', price: 89000, currency: 'USD', published: 1 },
    { listing_id: 'L-FRIDGE', property_id: 'P-FRIDGE', title: 'French door refrigerator', category: 'Home Appliances', subcategory: 'Refrigerators', price: 1299, currency: 'USD', published: 1 },
    { listing_id: 'L-WASH', property_id: 'P-WASH', title: 'Front load washing machine', category: 'Home Appliances', subcategory: 'Washing Machines', price: 499, currency: 'USD', published: 1 },
    { listing_id: 'L-TV', property_id: 'P-TV', title: '55 inch smart ultra HD TV', category: 'Electronics', subcategory: 'Televisions', price: 899, currency: 'USD', published: 1 },
    { listing_id: 'L-TOY', property_id: 'P-TOY', title: 'Kids ride-on toy car 12V', category: 'Vehicles', subcategory: 'Cars', price: 120, currency: 'USD', published: 1 },
    { listing_id: 'L-SOFA', property_id: 'P-SOFA', title: 'Leather corner sofa', category: 'Furniture', subcategory: 'Living Room', price: 750, currency: 'USD', published: 1 }
  ];
  for (const p of products) {
    db.run(
      'INSERT INTO shop_products (listing_id,property_id,title,category,subcategory,price,currency,thumbnail,product_url,published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [p.listing_id, p.property_id, p.title, p.category, p.subcategory, p.price, p.currency, null, 'https://weverseonlineshop.com/p/' + p.listing_id, p.published, db.now(), db.now()]
    );
  }
});

test('isTargetProduct matches each internationally promoted type', () => {
  const t = (cat, sub, title = 'item') => ({ category: cat, subcategory: sub, title, listing_type: 'product' });
  assert.strictEqual(promo.isTargetProduct(t('Real Estate', 'Residential Properties')), true);
  assert.strictEqual(promo.isTargetProduct(t('Vehicles', 'Cars')), true);
  assert.strictEqual(promo.isTargetProduct(t('Vehicles', 'Trucks')), true);
  assert.strictEqual(promo.isTargetProduct(t('Motorhomes', 'Motorhomes')), true);
  assert.strictEqual(promo.isTargetProduct(t('Home Appliances', 'Refrigerators')), true);
  assert.strictEqual(promo.isTargetProduct(t('Home Appliances', 'Washing Machines')), true);
  assert.strictEqual(promo.isTargetProduct(t('Electronics', 'Televisions')), true);
});

test('isTargetProduct excludes toys and unrelated products', () => {
  assert.strictEqual(promo.isTargetProduct({ category: 'Vehicles', subcategory: 'Cars', title: 'Kids ride-on toy car 12V' }), false);
  assert.strictEqual(promo.isTargetProduct({ category: 'Furniture', subcategory: 'Living Room', title: 'Sofa' }), false);
  assert.strictEqual(promo.isTargetProduct({ category: 'Toys', subcategory: 'Games', title: 'Board game' }), false);
});

test('seedFor is deterministic per product × country', () => {
  const a = promo.seedFor('P-CAR', 'FR');
  const b = promo.seedFor('P-CAR', 'FR');
  const c = promo.seedFor('P-CAR', 'JP');
  const d = promo.seedFor('P-TV', 'FR');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(a, d);
});

test('supportedRegions defaults to the four targeted regions', () => {
  assert.deepStrictEqual(promo.supportedRegions(), ['Americas', 'Europe', 'Oceania', 'Asia']);
});

test('supportedCountries filters out non-target regions (Nigeria/Africa excluded)', () => {
  const codes = promo.supportedCountries().map((c) => c.code);
  assert.ok(codes.includes('US') && codes.includes('FR') && codes.includes('JP') && codes.includes('AU'));
  assert.ok(!codes.includes('NG'));
});

test('publishCountryPages creates one row per product × country with no duplicates', async () => {
  const prods = db.all('SELECT * FROM shop_products');
  const countries = promo.supportedCountries();
  const res = await promo.publishCountryPages();
  assert.strictEqual(res.pairs, prods.filter((p) => promo.isTargetProduct(p)).length * countries.length);
  assert.ok(res.created > 0);

  const dup = db.get(
    'SELECT COUNT(*) AS n FROM (SELECT listing_id, country_code, COUNT(*) c FROM shop_country_pages GROUP BY listing_id, country_code HAVING c > 1)'
  );
  assert.strictEqual(dup.n, 0);
});

test('each product × country combination gets unique headline text', () => {
  const rows = db.all('SELECT listing_id, country_code, headline FROM shop_country_pages ORDER BY listing_id, country_code');
  const keys = new Map();
  for (const r of rows) {
    if (keys.has(r.headline) && keys.get(r.headline) !== r.listing_id + '|' + r.country_code) {
      assert.fail('duplicate headline across different combinations: ' + r.headline);
    }
    keys.set(r.headline, r.listing_id + '|' + r.country_code);
  }
});

test('publishCountryPages is idempotent on re-run (no new rows, no changes)', async () => {
  const before = db.get("SELECT COUNT(*) AS n FROM shop_country_pages WHERE status='published'").n;
  const res = await promo.publishCountryPages();
  const after = db.get("SELECT COUNT(*) AS n FROM shop_country_pages WHERE status='published'").n;
  assert.strictEqual(after, before);
  assert.strictEqual(res.created, 0);
  assert.strictEqual(res.updated, 0);
});

test('countryPages returns only that country rows with real content', () => {
  const pages = promo.countryPages('FR');
  assert.ok(pages.length > 0);
  for (const p of pages) {
    assert.strictEqual(p.country_code, 'FR');
    assert.ok(p.headline && p.headline.length > 20);
    assert.ok(p.summary && p.summary.length > 20);
  }
});

test('pageRow resolves by the property-first key', () => {
  const row = promo.pageRow('P-CAR', 'FR');
  assert.ok(row);
  assert.strictEqual(row.country_code, 'FR');
  assert.ok(!promo.pageRow('P-TOY', 'FR'));
});

test('region setting can narrow the promotion in admin', async () => {
  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_target_regions',?)", [JSON.stringify(['Americas', 'Oceania'])]);
  assert.deepStrictEqual(promo.supportedRegions(), ['Americas', 'Oceania']);
  const codes = promo.supportedCountries().map((c) => c.code);
  assert.ok(codes.includes('US') && codes.includes('AU'));
  assert.ok(!codes.includes('FR') && !codes.includes('JP'));
  db.run("DELETE FROM settings WHERE key='shop_target_regions'", []);
});