const https = require('https');
const db = require('./server/db');
function get(u) {
  return new Promise((res, rej) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}
(async () => {
  await db.initialize();
  const three = db.all("SELECT listing_id, property_id, title, product_url FROM shop_products WHERE listing_id IN ('a4e5cdf9-eca4-488a-b193-3d989c2b6903','29e781a5-c6b4-45ac-8a55-c75aae94df33','fc129bcd-4503-45b0-9f82-d63ff15f1041')");
  console.log('current rows:', JSON.stringify(three, null, 1));

  const modules = [
    'https://weverseonlineshop.com/assets/catalog-DyyszhIg.js',
    'https://weverseonlineshop.com/assets/catalog-hidden-store-CWIOFTTo.js',
    'https://weverseonlineshop.com/assets/phone-data-Of7KtnOV.js',
    'https://weverseonlineshop.com/assets/motorhome-data-CupbOvk0.js'
  ];
  const bundles = {};
  for (const u of modules) {
    const name = u.split('/').pop();
    try { bundles[name] = await get(u); console.log(name, 'len', bundles[name].length); }
    catch (e) { console.log(name, 'FAIL', e.message); }
  }
  for (const row of three) {
    const pid = row.property_id;
    const found = Object.keys(bundles).filter(n => bundles[n].includes(pid));
    console.log(pid, '->', row.title.slice(0, 40), '| present in:', found.join(', ') || 'NONE');
  }
  process.exit(0);
})();