const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const WASM_PATH = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const BUNDLED_DIR = path.join(__dirname, '..', '..', 'data');
const BUNDLED_DB = path.join(BUNDLED_DIR, 'worldfront.sqlite');

function resolveDataDir() {
  const env = process.env.WF_DATA_DIR;
  if (env) {
    fs.mkdirSync(env, { recursive: true });
    return env;
  }
  try {
    fs.mkdirSync(BUNDLED_DIR, { recursive: true });
    const probe = path.join(BUNDLED_DIR, '.write-test');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return BUNDLED_DIR;
  } catch (e) {
    const tmp = path.join(os.tmpdir(), 'worldfront-data');
    fs.mkdirSync(tmp, { recursive: true });
    return tmp;
  }
}

const DATA_DIR = resolveDataDir();
const DB_FILE = path.join(DATA_DIR, 'worldfront.sqlite');

function seedBundledDb() {
  if (fs.existsSync(DB_FILE)) return;
  // When WF_DATA_DIR is set (tests/CI) we always want a clean schema-only DB.
  if (process.env.WF_DATA_DIR) return;
  if (fs.existsSync(BUNDLED_DB)) {
    fs.copyFileSync(BUNDLED_DB, DB_FILE);
  }
}

let db = null;
let SQL = null;
let initPromise = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function now() {
  return Math.floor(Date.now() / 1000);
}

// Lazy async initialization of sql.js (wasm init is async)
function open() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    ensureDirs();
    seedBundledDb();
    SQL = await initSqlJs({
      locateFile: (file) => {
        if (fs.existsSync(WASM_PATH)) return WASM_PATH;
        return file;
      }
    });
    if (fs.existsSync(DB_FILE)) {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
    return db;
  })();
  return initPromise;
}

function ready() {
  return open().then(() => db);
}

function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
}

function all(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } catch (e) {
    try { stmt.free(); } catch (_) {}
    throw e;
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : undefined;
}

function persist() {
  if (!db) throw new Error('Database not initialized');
  ensureDirs();
  const data = db.export();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, DB_FILE);
}

async function initialize() {
  await ready();
  db.run('PRAGMA journal_mode=MEMORY');
  db.run('PRAGMA foreign_keys=OFF');

  const schema = `
  CREATE TABLE IF NOT EXISTS countries (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    subregion TEXT,
    flag TEXT,
    lat REAL,
    lng REAL
  );

  CREATE TABLE IF NOT EXISTS regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country_code TEXT,
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    country_code TEXT,
    lat REAL,
    lng REAL,
    slug TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    description TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS news_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    country_code TEXT,
    language TEXT,
    category TEXT,
    feed_url TEXT,
    logo TEXT,
    type TEXT DEFAULT 'rss',
    enabled INTEGER DEFAULT 1,
    last_fetch INTEGER,
    last_status TEXT,
    priority INTEGER DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_source_feed ON news_sources(feed_url);

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE,
    title TEXT NOT NULL,
    slug TEXT,
    summary TEXT,
    content TEXT,
    image TEXT,
    source_name TEXT,
    source_url TEXT,
    source_id INTEGER,
    author TEXT,
    country_code TEXT,
    region TEXT,
    category TEXT,
    published_at INTEGER,
    fetched_at INTEGER,
    link TEXT,
    featured INTEGER DEFAULT 0,
    breaking INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published',
    clicks INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
  CREATE INDEX IF NOT EXISTS idx_articles_country ON articles(country_code);
  CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
  CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
  CREATE INDEX IF NOT EXISTS idx_articles_breaking ON articles(breaking);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'reader',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS saved_articles (
    user_id INTEGER,
    article_id INTEGER,
    created_at INTEGER,
    PRIMARY KEY (user_id, article_id)
  );

  CREATE TABLE IF NOT EXISTS followed_countries (
    user_id INTEGER,
    country_code TEXT,
    PRIMARY KEY (user_id, country_code)
  );

  CREATE TABLE IF NOT EXISTS followed_categories (
    user_id INTEGER,
    category TEXT,
    PRIMARY KEY (user_id, category)
  );

  CREATE TABLE IF NOT EXISTS user_location (
    user_id INTEGER PRIMARY KEY,
    country_code TEXT,
    region TEXT,
    state TEXT,
    city TEXT,
    lat REAL,
    lng REAL,
    allow_gps INTEGER DEFAULT 0,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS breaking_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    article_id INTEGER,
    country_code TEXT,
    link TEXT,
    active INTEGER DEFAULT 1,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS site_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    category TEXT,
    country_code TEXT,
    image TEXT,
    body TEXT,
    author TEXT,
    featured INTEGER DEFAULT 0,
    breaking INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    published_at INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS shop_products (
    listing_id TEXT PRIMARY KEY,
    property_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    subcategory TEXT,
    brand TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    thumbnail TEXT,
    product_url TEXT,
    published INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_shop_products_category ON shop_products(category);
  CREATE INDEX IF NOT EXISTS idx_shop_products_updated ON shop_products(updated_at);

  CREATE TABLE IF NOT EXISTS shop_publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    pub_date TEXT NOT NULL,
    headline TEXT NOT NULL,
    item_text TEXT NOT NULL,
    product_order INTEGER NOT NULL,
    featured INTEGER DEFAULT 0,
    created_at INTEGER,
    UNIQUE (listing_id, country_code, pub_date)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_pub_country_date ON shop_publications(country_code, pub_date);
  CREATE INDEX IF NOT EXISTS idx_shop_pub_date ON shop_publications(pub_date);

  CREATE TABLE IF NOT EXISTS shop_publication_days (
    country_code TEXT NOT NULL,
    pub_date TEXT NOT NULL,
    headline TEXT NOT NULL,
    intro TEXT NOT NULL,
    closing TEXT NOT NULL,
    featured_listing_id TEXT,
    created_at INTEGER,
    PRIMARY KEY (country_code, pub_date)
  );

  -- International product promotion: one row per (target product × country)
  -- for the localized deep articles + product pages. Generated deterministically
  -- from the shop catalog + the site's country list; never deleted on re-run.
  CREATE TABLE IF NOT EXISTS shop_country_pages (
    listing_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL,
    seed INTEGER,
    status TEXT DEFAULT 'published',
    published_at INTEGER,
    updated_at INTEGER,
    pushed INTEGER DEFAULT 0,
    PRIMARY KEY (listing_id, country_code)
  );
  CREATE INDEX IF NOT EXISTS idx_shop_country_pages_country ON shop_country_pages(country_code);
  CREATE INDEX IF NOT EXISTS idx_shop_country_pages_updated ON shop_country_pages(updated_at);

  -- =====================================================================
  -- GLOBAL LOCATION SYSTEM (WorldFront.News)
  -- Real, hierarchical, verifiable locations for news, properties,
  -- vehicles, shops, businesses and map integration.
  --
  -- Hierarchy:
  --   country → (state|province|region) → (county|department|prefecture)
  --           → (city|town|village) → (district|ward|borough)
  --           → street → (house/building number)
  --
  -- Only real, verified locations are stored. Unverified data is flagged.
  -- type values: country|state|province|region|county|department|prefecture|
  --              city|town|village|district|ward|borough|street|landmark|bus_stop
  -- =====================================================================
  CREATE TABLE IF NOT EXISTS geo_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    country_code TEXT,
    parent_id INTEGER,
    slug TEXT UNIQUE,
    postal_code TEXT,
    lat REAL,
    lng REAL,
    verified INTEGER DEFAULT 0,
    approximate INTEGER DEFAULT 0,
    status TEXT DEFAULT 'approved',
    meta TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_geo_type ON geo_locations(type);
  CREATE INDEX IF NOT EXISTS idx_geo_country ON geo_locations(country_code);
  CREATE INDEX IF NOT EXISTS idx_geo_parent ON geo_locations(parent_id);

  -- Rich property/vehicle records pulled from the showroom (single source of
  -- truth per property_id). Every listing keeps its own accurate address,
  -- coordinates, media, specs and status.
  CREATE TABLE IF NOT EXISTS property_details (
    property_id TEXT PRIMARY KEY,
    listing_id TEXT,
    listing_type TEXT,
    category TEXT,
    subcategory TEXT,
    title TEXT,
    description TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    country TEXT,
    country_code TEXT,
    state TEXT,
    city TEXT,
    town TEXT,
    village TEXT,
    district TEXT,
    neighborhood TEXT,
    street TEXT,
    house_number TEXT,
    postal_code TEXT,
    landmark TEXT,
    lat REAL,
    lng REAL,
    video TEXT,
    video_url TEXT,
    images TEXT,
    bedrooms TEXT,
    bathrooms TEXT,
    building_size TEXT,
    land_size TEXT,
    parking_spaces TEXT,
    features TEXT,
    condition TEXT,
    listing_status TEXT,
    coordinates_verified INTEGER DEFAULT 0,
    location_verified INTEGER DEFAULT 0,
    media_verified INTEGER DEFAULT 0,
    fetched_at INTEGER,
    raw TEXT,
    UNIQUE (property_id)
  );
  CREATE INDEX IF NOT EXISTS idx_prop_country ON property_details(country_code);
  CREATE INDEX IF NOT EXISTS idx_prop_city ON property_details(city);

  -- Join table linking any listing (property/vehicle/product/street) to a
  -- geo_locations row. Keeps the connection between listing, location and page.
  CREATE TABLE IF NOT EXISTS listing_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_kind TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    location_id INTEGER NOT NULL,
    relation TEXT DEFAULT 'primary',
    created_at INTEGER,
    UNIQUE (listing_kind, listing_id, relation)
  );
  CREATE INDEX IF NOT EXISTS idx_ll_listing ON listing_locations(listing_kind, listing_id);
  CREATE INDEX IF NOT EXISTS idx_ll_location ON listing_locations(location_id);

  -- Technical SEO quality-control report snapshots (admin reports).
  CREATE TABLE IF NOT EXISTS seo_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at INTEGER,
    scope TEXT,
    issues TEXT,
    stats TEXT
  );

  -- URL registry used by the QA system to validate every indexed page.
  CREATE TABLE IF NOT EXISTS indexed_urls (
    url TEXT PRIMARY KEY,
    kind TEXT,
    lastmod INTEGER,
    status_code INTEGER DEFAULT 200,
    title TEXT,
    meta_description TEXT,
    canonical TEXT,
    h1 TEXT,
    has_jsonld INTEGER DEFAULT 0,
    has_image INTEGER DEFAULT 0,
    last_checked INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_urls_kind ON indexed_urls(kind);

  -- Google Search Console indexing log (never stores secrets/credentials).
  CREATE TABLE IF NOT EXISTS sc_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    action TEXT,
    status TEXT,
    message TEXT,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_sc_url ON sc_log(url);

  -- First-party pageview counter: real per-URL reach numbers for the QA/SEO
  -- dashboard. Created on demand, so older databases pick it up automatically.
  CREATE TABLE IF NOT EXISTS pageviews (
    url TEXT PRIMARY KEY,
    views INTEGER DEFAULT 0,
    last_seen INTEGER
  );

  -- =====================================================================
  -- MULTI-PLATFORM DISTRIBUTION (WorldFront.News)
  -- Publish once on WF → distribute to every eligible platform.
  -- Every row is a REAL platform with its true requirement level; nothing
  -- is ever marked "shared" unless a real HTTP exchange confirmed it.
  -- access: none | free_key | oauth | webhook | manual | paid
  -- method: api | rss_discovery | oauth | webhook | manual | submission
  -- =====================================================================
  CREATE TABLE IF NOT EXISTS dist_platforms (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country_code TEXT DEFAULT 'XX',
    region TEXT DEFAULT 'Global',
    url TEXT,
    signup_url TEXT,
    content_types TEXT DEFAULT '["articles"]',
    access TEXT NOT NULL,
    method TEXT NOT NULL,
    api_required INTEGER DEFAULT 0,
    email_verification INTEGER DEFAULT 1,
    manual_approval INTEGER DEFAULT 0,
    paid INTEGER DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'new',
    auto_create INTEGER DEFAULT 0,
    discovered_at INTEGER,
    last_checked INTEGER,
    last_success INTEGER,
    last_failure INTEGER,
    failure_message TEXT,
    score INTEGER DEFAULT 0,
    meta TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dist_platforms_status ON dist_platforms(status);
  CREATE INDEX IF NOT EXISTS idx_dist_platforms_access ON dist_platforms(access);

  -- Connected account/API credentials + health per platform (user-owned store).
  CREATE TABLE IF NOT EXISTS dist_connectors (
    platform_slug TEXT PRIMARY KEY,
    account_label TEXT,
    creds TEXT,
    linked INTEGER DEFAULT 0,
    connected_at INTEGER,
    last_success INTEGER,
    last_failure INTEGER,
    failure_message TEXT,
    retries INTEGER DEFAULT 0,
    paused INTEGER DEFAULT 0,
    meta TEXT
  );

  -- One row per content × platform delivery attempt (the honest ledger).
  CREATE TABLE IF NOT EXISTS dist_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_type TEXT,
    content_url TEXT,
    title TEXT,
    platform_slug TEXT,
    status TEXT,
    http_status INTEGER,
    detail_url TEXT,
    message TEXT,
    attempted_at INTEGER,
    retry_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_dist_log_url ON dist_log(content_url);
  CREATE INDEX IF NOT EXISTS idx_dist_log_platform ON dist_log(platform_slug);
  CREATE INDEX IF NOT EXISTS idx_dist_log_attempt ON dist_log(attempted_at);

  -- Human-in-the-loop onboarding queue (manual signup / verification / approval).
  CREATE TABLE IF NOT EXISTS dist_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_slug TEXT,
    action TEXT,
    status TEXT DEFAULT 'open',
    guidance TEXT,
    submit_url TEXT,
    created_at INTEGER,
    done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_dist_tasks_status ON dist_tasks(status);

  -- =====================================================================
  -- SOCIAL MEDIA AUTOMATION (WorldFront.News — KCO Global Marketplace)
  -- Automatic + manual social media publishing system.
  -- All credentials stored server-side only, encrypted when possible.
  -- =====================================================================
  CREATE TABLE IF NOT EXISTS social_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    platform_user_id TEXT,
    account_name TEXT,
    account_label TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER,
    token_type TEXT DEFAULT 'bearer',
    scope TEXT,
    page_id TEXT,
    page_name TEXT,
    webhook_url TEXT,
    avatar_url TEXT,
    connected INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    last_post_at INTEGER,
    last_error TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);

  CREATE TABLE IF NOT EXISTS posting_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    enabled INTEGER DEFAULT 1,
    content_types TEXT DEFAULT '["articles","products","site_articles"]',
    frequency TEXT DEFAULT 'daily',
    time_of_day TEXT DEFAULT '09:00',
    day_of_week TEXT DEFAULT '*',
    day_of_month INTEGER,
    max_posts_per_day INTEGER DEFAULT 3,
    require_approval INTEGER DEFAULT 0,
    auto_select INTEGER DEFAULT 1,
    include_image INTEGER DEFAULT 1,
    include_link INTEGER DEFAULT 1,
    hashtag_template TEXT,
    caption_template TEXT,
    exclude_ids TEXT DEFAULT '[]',
    created_at INTEGER,
    updated_at INTEGER,
    FOREIGN KEY (account_id) REFERENCES social_accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_posting_rules_account ON posting_rules(account_id);

  CREATE TABLE IF NOT EXISTS social_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    content_type TEXT NOT NULL,
    content_id INTEGER,
    content_url TEXT,
    content_title TEXT,
    content_summary TEXT,
    content_image TEXT,
    custom_caption TEXT,
    custom_hashtags TEXT,
    media_url TEXT,
    media_type TEXT DEFAULT 'image',
    platform_post_id TEXT,
    platform_url TEXT,
    post_type TEXT DEFAULT 'automatic',
    status TEXT DEFAULT 'pending',
    scheduled_at INTEGER,
    published_at INTEGER,
    failed_at INTEGER,
    failed_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at INTEGER,
    idempotency_key TEXT,
    created_at INTEGER,
    FOREIGN KEY (account_id) REFERENCES social_accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
  CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_social_posts_account ON social_posts(account_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_idempotency ON social_posts(idempotency_key);

  CREATE TABLE IF NOT EXISTS social_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    post_id INTEGER,
    position INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued',
    created_at INTEGER,
    FOREIGN KEY (account_id) REFERENCES social_accounts(id),
    FOREIGN KEY (post_id) REFERENCES social_posts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_social_queue_status ON social_queue(status);

  CREATE TABLE IF NOT EXISTS social_post_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    account_id INTEGER,
    platform TEXT,
    action TEXT,
    status TEXT,
    http_status INTEGER,
    message TEXT,
    response_data TEXT,
    attempted_at INTEGER,
    FOREIGN KEY (post_id) REFERENCES social_posts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_social_post_log_post ON social_post_log(post_id);
  CREATE INDEX IF NOT EXISTS idx_social_post_log_attempt ON social_post_log(attempted_at);

  CREATE TABLE IF NOT EXISTS social_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    platform_post_id TEXT,
    content_url TEXT,
    liked_at INTEGER,
    FOREIGN KEY (account_id) REFERENCES social_accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_social_likes_account ON social_likes(account_id);
  `;

  db.run(schema);

  const shopCols = new Set((all('PRAGMA table_info(shop_products)') || []).map((c) => c.name));
  if (!shopCols.has('prev_price')) db.run('ALTER TABLE shop_products ADD COLUMN prev_price REAL');
  if (!shopCols.has('restock_at')) db.run('ALTER TABLE shop_products ADD COLUMN restock_at INTEGER');
  if (!shopCols.has('price_changed_at')) db.run('ALTER TABLE shop_products ADD COLUMN price_changed_at INTEGER');

  // Rich location + media columns so every listing carries its own accurate
  // location and real media inside the local DB (reduces external lookups).
  const richCols = [
    ['country_code', 'TEXT'], ['state', 'TEXT'], ['city', 'TEXT'], ['town', 'TEXT'],
    ['village', 'TEXT'], ['district', 'TEXT'], ['neighborhood', 'TEXT'],
    ['street', 'TEXT'], ['house_number', 'TEXT'], ['postal_code', 'TEXT'],
    ['landmark', 'TEXT'], ['lat', 'REAL'], ['lng', 'REAL'],
    ['video', 'TEXT'], ['images', 'TEXT'], ['bedrooms', 'TEXT'], ['bathrooms', 'TEXT'],
    ['building_size', 'TEXT'], ['land_size', 'TEXT'], ['parking_spaces', 'TEXT'],
    ['features', 'TEXT'], ['listing_condition', 'TEXT'], ['listing_status', 'TEXT'],
    ['listing_type', 'TEXT'], ['location_verified', 'INTEGER DEFAULT 0'],
    ['coordinates_verified', 'INTEGER DEFAULT 0']
  ];
  const has = new Set(shopCols);
  for (const [col, typ] of richCols) {
    if (!has.has(col)) {
      try { db.run('ALTER TABLE shop_products ADD COLUMN ' + col + ' ' + typ); } catch (e) { /* already added concurrently */ }
    }
  }

  // Seed the geo location database with real data for every supported country.
  try {
    const { seedGeoLocations } = require('./geo-seed');
    const s = seedGeoLocations();
    if (s && s.inserted) {
      console.log('Geo locations seeded: ' + s.inserted + ' new locations.');
    }
  } catch (e) {
    console.log('Geo seed note: ' + (e && e.message ? e.message : 'skipped'));
  }

  persist();
}

module.exports = { initialize, open, ready, run, all, get, persist, now, DB_FILE, DATA_DIR };
