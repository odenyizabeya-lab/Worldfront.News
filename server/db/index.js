const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const WASM_PATH = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const BUNDLED_DIR = path.join(__dirname, '..', '..', 'data');
const BUNDLED_DB = path.join(BUNDLED_DIR, 'worldfront.sqlite');

function resolveDataDir() {
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
  `;

  db.run(schema);

  const shopCols = new Set((all('PRAGMA table_info(shop_products)') || []).map((c) => c.name));
  if (!shopCols.has('prev_price')) db.run('ALTER TABLE shop_products ADD COLUMN prev_price REAL');
  if (!shopCols.has('restock_at')) db.run('ALTER TABLE shop_products ADD COLUMN restock_at INTEGER');
  if (!shopCols.has('price_changed_at')) db.run('ALTER TABLE shop_products ADD COLUMN price_changed_at INTEGER');

  persist();
}

module.exports = { initialize, open, ready, run, all, get, persist, now, DB_FILE, DATA_DIR };
