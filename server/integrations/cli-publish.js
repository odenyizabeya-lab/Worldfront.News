// CLI: publish Weverse Shop products, then persist the result into
// data/worldfront.sqlite so it ships with the next deploy.
//
// Usage:
//   node server/integrations/cli-publish.js press        -> publish the 3 featured product articles (daily publishing: paused)
//   node server/integrations/cli-publish.js all          -> enable DAILY publishing + publish today's editions for every country
//   node server/integrations/cli-publish.js all NG US    -> only those countries (ISO codes)
const db = require('../db');
const { sync, publishArticles, publishDaily, publishInternationalPages, publishMode } = require('./weverse-shop');

async function main() {
  const arg = process.argv[2] || 'press';
  const countryArg = process.argv.slice(3).filter((a) => !a.startsWith('-'));
  await db.initialize();

  const needSync = process.argv.includes('--sync');
  if (needSync) {
    const s = await sync();
    console.log(`Shop sync: ${s.total} products (${s.inserted} new, ${s.updated} updated)`);
  }

  if (arg !== 'all') {
    const r = await publishArticles('preview');
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_publish_mode','preview')", []);
    if (process.argv.includes('--pages')) {
      const inl = await publishInternationalPages();
      console.log(`International pages: ${inl.pairs} pairs (${inl.created} new, ${inl.updated} refreshed) across ${inl.countries} countries.`);
    }
    db.persist();
    console.log('Daily publishing paused — shop stays synced; published products remain live.');
    console.log(`Publish done: ${r.submitted} products -> ${r.created} articles created, ${r.updated} refreshed (${r.verified} links verified, ${r.broken.length} skipped as broken).`);
    for (const b of r.broken) {
      console.log(`  SKIPPED (broken/inactive): [${b.property_id}] ${b.title} (${b.reason})`);
    }
  } else {
    const s = await sync();
    console.log(`Shop sync: ${s.total} products (${s.inserted} new, ${s.updated} updated)`);
    const r = await publishDaily(countryArg.length ? countryArg : null);
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('shop_publish_mode','daily')", []);
    db.persist();
    console.log('Daily publishing ENABLED (all supported countries, every day).');
    console.log(`Publish done: ${r.date} — ${r.countries} countries × ${r.products_per_country} products (${r.items} publication records, ${r.created} new articles, ${r.updated} refreshed, ${r.pruned} pruned, ${r.broken} broken links skipped).`);
    if (r.international_pages) {
      console.log(`International pages: ${r.international_pages.pairs} pairs (${r.international_pages.created} new, ${r.international_pages.updated} refreshed, ${r.international_pages.unchanged} unchanged) across ${r.international_pages.countries} countries.`);
    }
    for (const b of db.all('SELECT * FROM shop_products WHERE published=1 AND (property_id IS NULL OR property_id=\'\') LIMIT 5')) {
      console.log(`  WARN: missing property_id [${b.listing_id}] ${b.title}`);
    }
  }

  const mode = publishMode();
  console.log(`shop_publish_mode=${mode}`);
  console.log('DB file:', db.DB_FILE);

  const shop = db.all("SELECT guid,title,link,country_code FROM articles WHERE category='shopping' AND status='published' ORDER BY published_at DESC LIMIT 12");
  console.log(`Shopping articles (last ${shop.length}):`);
  for (const a of shop) {
    console.log(`  - [${a.guid}] ${a.title}${a.country_code ? ' (' + a.country_code + ')' : ''}`);
    console.log(`    link: ${a.link}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});