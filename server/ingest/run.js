// Runs the news ingestion. Usage: node server/ingest/run.js
require('dotenv').config();
const { fetchEnabled } = require('./rss');
const { runApiProviders } = require('./api');

async function main() {
  const onlyApi = process.argv.includes('--api');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  if (onlyApi) {
    const r = await runApiProviders();
    console.log('API providers:', r);
    return;
  }

  const start = Date.now();
  console.log('Starting RSS ingestion...');
  const results = await fetchEnabled(limit);
  const ok = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error);
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s. OK: ${ok}, Failed: ${failed.length}`);
  if (failed.length) {
    console.log('Failed feeds:', failed.map((f) => f.source).join(', '));
  }

  // Also run API providers if keys are present
  const r = await runApiProviders();
  console.log('API providers:', r);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
