// Backfill missing article images by fetching each article's page and
// extracting its Open Graph / first-photo image. Resumable and throttled.
// Usage: node server/ingest/backfillimages.js [limit]
const db = require('../db');
const { fetchOGImage } = require('./og');

const limit = parseInt(process.argv[2] || process.env.IMAGE_BACKFILL_LIMIT || '50', 10);

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  await db.ready();
  const rows = db.all(
    "SELECT id, title, link FROM articles WHERE (image IS NULL OR image='') AND link != '' ORDER BY published_at DESC LIMIT ?",
    [limit]
  );
  if (!rows.length) {
    console.log('No articles need images.');
    db.persist();
    return;
  }
  console.log('Backfilling images for', rows.length, 'articles...');
  let ok = 0, fail = 0;
  for (const r of rows) {
    const img = await fetchOGImage(r.link);
    if (img) {
      db.run('UPDATE articles SET image=? WHERE id=?', [img, r.id]);
      ok++;
      console.log('  OK  [' + r.id + '] ' + img.slice(0, 90));
    } else {
      fail++;
      console.log('  --  [' + r.id + '] no image found');
    }
    await sleep(400); // polite throttle
  }
  db.persist();
  console.log('\nDone. Filled=' + ok + ' noneFound=' + fail);
  process.exit(0);
}

main().catch((e) => {
  console.error('backfill error:', e.message);
  process.exit(1);
});
