process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'http://127.0.0.1:18080';
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'dev-token';

const { default: worker } = await import('file:///C:/Worldfront.News/site/dist/_worker.js/index.js');

const kv = new Map();
const sessionKV = {
  async get(k) { return kv.has(k) ? kv.get(k) : null; },
  async put(k, v) { kv.set(k, v); },
  async delete(k) { kv.delete(k); },
  async list() { return { keys: [...kv.keys()].map((name) => ({ name })) }; }
};
const env = { SESSION: sessionKV };

const cacheStores = new Map();
const makeStore = () => ({
  async match() { return undefined; },
  async matchAll() { return []; },
  async put() {},
  async add() {},
  async addAll() {},
  async delete() { return false; },
  async keys() { return []; }
});
globalThis.caches = {
  open(name) {
    if (!cacheStores.has(name)) cacheStores.set(name, makeStore());
    return cacheStores.get(name);
  },
  default: null
};

const urls = [
  'http://localhost/',
  'http://localhost/news/global-markets-steady',
  'http://localhost/news/fusion-energy-breakthrough',
  'http://localhost/news/city-transport-corridor',
  'http://localhost/news/does-not-exist'
];

let pass = true;
for (const url of urls) {
  const res = await worker.fetch(new Request(url), env);
  const html = await res.text();
  const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || '';
  const srcScripts = (html.match(/<script[^>]*\ssrc=/gi) || []).length;
  const jsScripts = (html.match(/<script(?:[^>]*)?>/gi) || []).filter((s) => !/application\/ld\+json/.test(s)).length;
  if (res.status >= 500) pass = false;
  console.log(`${res.status} ${url}`);
  console.log(`   html=${html.length}b title="${title.slice(0, 55)}" script-src=${srcScripts} JS-scripts=${jsScripts}`);
}
console.log(pass ? 'ALL ROUTES OK (no 5xx), zero client JS' : 'ERRORS PRESENT');
process.exit(0);