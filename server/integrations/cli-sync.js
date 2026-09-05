// Manual CLI: sync products from the Weverse shop catalog into the local DB.
// Usage: node server/integrations/cli-sync.js
require('dotenv').config();
const db = require('../db');
const { sync } = require('./weverse-shop');

(async () => {
  await db.initialize();
  const result = await sync();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('Sync failed:', e.message);
  process.exit(1);
});