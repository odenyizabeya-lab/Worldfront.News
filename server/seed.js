const db = require('./db');
const countries = require('./db/countries');
const categories = require('./db/categories');
const sources = require('./db/sources');

function count(tbl) {
  const r = db.get(`SELECT COUNT(*) AS c FROM ${tbl}`);
  return r ? r.c : 0;
}

async function seed() {
  await db.initialize();
  const now = db.now();

  for (const c of countries) {
    db.run('INSERT OR IGNORE INTO countries (code,name,region,subregion,lat,lng) VALUES (?,?,?,?,?,?)',
      [c[0], c[1], c[2], c[3] || c[2], c[4], c[5]]);
  }
  console.log(`Countries: ${count('countries')}`);

  for (const cat of categories) {
    db.run('INSERT OR IGNORE INTO categories (slug,name,icon,description,active) VALUES (?,?,?,?,1)',
      [cat.slug, cat.name, cat.icon, cat.description]);
  }
  console.log(`Categories: ${count('categories')}`);

  for (const s of sources) {
    db.run('INSERT OR IGNORE INTO news_sources (name,url,country_code,language,category,feed_url,logo,type,enabled,priority) VALUES (?,?,?,?,?,?,?,?,1,0)',
      [s.name, s.url, s.country_code, s.language, s.category, s.feed_url, s.logo || '', 'rss']);
  }
  console.log(`Sources: ${count('news_sources')}`);

  db.run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', ['site_name', 'WorldFront.News']);
  db.run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', ['site_tagline', 'Real news from every corner of the world']);
  db.run('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)', ['last_full_fetch', '0']);

  if (count('users') === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    db.run('INSERT INTO users (email,username,password_hash,role,created_at) VALUES (?,?,?,?,?)',
      ['admin@worldfront.news', 'admin', hash, 'admin', now]);
    console.log('Default admin created: admin@worldfront.news / admin123 (change in production)');
  }

  db.persist();
  console.log('Seed complete. Database at', db.DB_FILE);
}

seed().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
