// Build-time regeneration of the bundled seed DB (data/worldfront.sqlite).
//
// Vercel runs `npm install` on every build/redeploy, which also runs this
// package's postinstall script (see package.json). On the build machine the
// whole project tree is writable, so this script:
//
//   1. opens the bundled DB (if it exists),
//   2. refreshs the shop catalog from the Weverse Online Shop (sync),
//   3. if daily publishing is enabled, produces today's complete per-country
//      editions and prunes old publication rows,
//   4. persists the result back INTO data/worldfront.sqlite.
//
// The freshly regenerated file is then bundled with the new deployment, which
// makes the current day's editions DURABLE across cold starts (a cold function
// starts from this bundled snapshot instead of the previous day's).
//
// The script never fails a build: any error logs and exits 0 so deploys are
// never blocked (the previous bundled DB is kept as a fallback).
const fs = require('fs');
const path = require('path');

async function main() {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const dbFile = path.join(dataDir, 'worldfront.sqlite');
  if (!fs.existsSync(dbFile)) {
    console.log('[build-regenerate] no bundled DB present — skipping');
    return;
  }
  const db = require('../db');
  const shop = require('./weverse-shop');
  await db.initialize();
  try {
    const s = await shop.sync();
    console.log(`[build-regenerate] shop sync: ${s.total} products (${s.inserted} new, ${s.updated} updated)`);
  } catch (e) {
    console.log('[build-regenerate] shop sync skipped:', e.message);
  }
  try {
    if (shop.publishMode() === 'daily') {
      const r = await shop.publishDaily();
      console.log(`[build-regenerate] daily editions: ${r.date} — ${r.countries} countries × ${r.products_per_country} products (${r.items} records, ${r.pruned} pruned)`);
    } else {
      console.log('[build-regenerate] daily publishing paused — keeping current state, no new editions');
    }
  } catch (e) {
    console.log('[build-regenerate] daily publish skipped:', e.message);
  }
  db.persist();
  console.log('[build-regenerate] bundled DB regenerated:', dbFile, '(' + Math.round(fs.statSync(dbFile).size / 1024 / 1024) + ' MB)');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[build-regenerate]', e.message);
  process.exit(0);
});