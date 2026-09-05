// WorldFront.News Distribution — Connector implementations.
//
// Each connector performs a REAL delivery where the platform officially
// permits it, and returns an honest result object:
//   { status: 'ok' | 'discoverable' | 'pending' | 'failed', httpStatus, detailUrl, message }
//
// Credentials are stored by the engine in dist_connectors.creds (user-owned
// store, on the admin's dashboard) — never logged anywhere.
const db = require('../db');
const ssr = require('../lib/ssr');

const UA = 'Mozilla/5.0 (compatible; WorldFront.News/1.0; +https://www.worldfront.news)';

async function httpJson(url, options, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const opts = { ...options, signal: ctrl.signal, headers: { 'user-agent': UA, ...(options.headers || {}) } };
  try {
    const r = await fetch(url, opts);
    const text = await r.text().catch(() => '');
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(t);
  }
}

// ---- IndexNow: real, no-account, instant search pings (batched) ----
async function indexNowShare(item) {
  const r = await indexNowBatch([item.url]);
  if (r.status === 'ok') return { status: 'ok', httpStatus: r.httpStatus, detailUrl: 'https://www.indexnow.org', message: 'Pinged search engines via IndexNow' };
  return { status: 'failed', httpStatus: r.httpStatus, detailUrl: 'https://www.indexnow.org', message: r.message };
}

async function indexNowBatch(urlList) {
  let key = db.get("SELECT value FROM settings WHERE key='indexnow_key'");
  if (!key || !/^[0-9a-fA-F]{32}$/.test(key.value || '')) {
    const hex = '0123456789abcdef';
    let k = '';
    for (let i = 0; i < 32; i++) k += hex[Math.floor(Math.random() * 16)];
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('indexnow_key',?)", [k]);
    key = { value: k };
    db.persist();
  }
  const host = (ssrBase() || 'https://www.worldfront.news').replace(/^https?:\/\//i, '').split('/')[0];
  const keyLocation = (ssrBase() || 'https://www.worldfront.news') + '/' + key.value + '.txt';
  const body = { host, key: key.value, keyLocation, urlList };
  const r = await httpJson('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.ok || r.status === 202) {
    return { status: 'ok', httpStatus: r.status, message: 'Pinged search engines via IndexNow (' + urlList.length + ' URLs)' };
  }
  return { status: 'failed', httpStatus: r.status, message: (r.text || '').slice(0, 160) || 'IndexNow rejected the ping' };
}

// ---- RSS: the feed itself is the distribution channel ----
async function rssShare() {
  return { status: 'discoverable', httpStatus: 200, detailUrl: (ssrBase() || 'https://www.worldfront.news') + '/rss.xml', message: 'Feed updated — aggregators can discover this URL' };
}

// ---- Mastodon (any instance): official API - one status with link ----
async function mastodonShare(item, creds) {
  const instance = String(creds.instance || '').replace(/\/$/, '');
  const token = creds.token || creds.access_token;
  if (!instance || !token) return { status: 'pending', httpStatus: 0, message: 'Needs an access token for an instance (onboarding task)' };
  const text = ((item.title || '') + '\n\n' + item.url).slice(0, 500);
  const r = await httpJson(instance + '/api/v1/statuses', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': 'wf-' + item.key },
    body: JSON.stringify({ status: text })
  });
  if (r.ok) {
    let url = '';
    try { url = JSON.parse(r.text).url || ''; } catch (e) {}
    return { status: 'ok', httpStatus: r.status, detailUrl: url || instance, message: 'Posted to Mastodon' };
  }
  return { status: 'failed', httpStatus: r.status, detailUrl: instance, message: (r.text || '').slice(0, 160) };
}

// ---- Telegram Bot API ----
async function telegramShare(item, creds) {
  const token = creds.token;
  const chat = creds.chat_id || creds.channel;
  if (!token || !chat) return { status: 'pending', httpStatus: 0, message: 'Needs a bot token + channel id (onboarding task)' };
  const text = (item.title || '') + '\n' + item.url;
  const r = await httpJson('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text })
  });
  if (r.ok) {
    const ok = /"ok"\s*:\s*true/.test(r.text);
    return ok
      ? { status: 'ok', httpStatus: r.status, detailUrl: 'https://t.me/me', message: 'Sent to Telegram channel' }
      : { status: 'failed', httpStatus: r.status, message: (r.text || '').slice(0, 160) };
  }
  return { status: 'failed', httpStatus: r.status, message: (r.text || '').slice(0, 160) };
}

// ---- Discord webhook ----
async function discordShare(item, creds) {
  const url = creds.webhook_url;
  if (!url) return { status: 'pending', httpStatus: 0, message: 'Needs a server webhook URL (onboarding task)' };
  const r = await httpJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: (item.title || '') + '\n' + item.url })
  });
  return r.ok
    ? { status: 'ok', httpStatus: r.status, detailUrl: 'https://discord.com', message: 'Sent to Discord webhook' }
    : { status: 'failed', httpStatus: r.status, message: 'Discord webhook rejected request' };
}

// ---- dev.to (Forem) REST API ----
async function devToShare(item, creds) {
  const apiKey = creds.api_key;
  if (!apiKey) return { status: 'pending', httpStatus: 0, message: 'Needs a dev.to API key (onboarding task)' };
  const tags = (item.content_type === 'products') ? ['showdev'] : ['news'];
  const body = {
    article: {
      title: String(item.title || '').slice(0, 120),
      published: true,
      tags,
      body_markdown: '**Via WorldFront.News**\n\n' + (item.summary || '') + '\n\n[Read the full article](' + item.url + ')\n\n---\nWorldFront.News — global news + daily property market.',
      canonical_url: item.url
    }
  };
  const r = await httpJson('https://dev.to/api/articles', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.ok) {
    let url = '';
    try { url = JSON.parse(r.text).url || ''; } catch (e) {}
    return { status: 'ok', httpStatus: r.status, detailUrl: url || 'https://dev.to', message: 'Published on dev.to' };
  }
  return { status: 'failed', httpStatus: r.status, detailUrl: 'https://dev.to', message: (r.text || '').slice(0, 160) };
}

// ---- Blogger Data API v3 (free API key) ----
async function bloggerShare(item, creds) {
  const key = creds.api_key;
  const blogId = creds.blog_id;
  if (!key || !blogId) return { status: 'pending', httpStatus: 0, message: 'Needs Blogger API key + blog id (onboarding task)' };
  const content = '<p><a href="' + item.url + '">' + String(item.title || '').replace(/&/g, '&amp;') + '</a></p><p>' + (item.summary || '') + '</p>';
  const r = await httpJson('https://www.googleapis.com/blogger/v3/blogs/' + encodeURIComponent(blogId) + '/posts?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'blogger#post', title: String(item.title || '').slice(0, 150), content, labels: ['WorldFront.News'] })
  });
  if (r.ok) {
    let url = '';
    try { url = (JSON.parse(r.text).url) || ''; } catch (e) {}
    return { status: 'ok', httpStatus: r.status, detailUrl: url, message: 'Cross-posted to Blogger blog' };
  }
  return { status: 'failed', httpStatus: r.status, detailUrl: 'https://developers.google.com/blogger', message: (r.text || '').slice(0, 160) };
}

// ---- The honest no-automation path (manual + OAuth-only + paid platforms).
// Returns 'pending' + guarantees an open onboarding task exists in the engine.
function manualShare(platform) {
  const r = { status: 'pending', httpStatus: 0, message: 'Requires human signup on ' + platform.name };
  if (platform.access === 'paid') r.message = platform.name + ' requires a paid plan — enroll manually if you choose';
  return r;
}

// ---- connector map ----
const IMPLEMENTATIONS = {
  indexnow: (item) => indexNowShare(item),
  'rss-feed': () => rssShare(),
  mastodon: (item, creds) => mastodonShare(item, creds),
  'mastodon-au': (item, creds) => mastodonShare(item, creds),
  'mastodon-jp': (item, creds) => mastodonShare(item, creds),
  'mastodon-de': (item, creds) => mastodonShare(item, creds),
  telegram: (item, creds) => telegramShare(item, creds),
  discord: (item, creds) => discordShare(item, creds),
  devto: (item, creds) => devToShare(item, creds),
  blogger: (item, creds) => bloggerShare(item, creds)
};

const MANUAL_ONLY = new Set([
  'google-scm', 'bing-webmaster', 'yandex-webmaster', 'baidu-search', 'naver-search',
  'google-news', 'bing-news', 'yahoo-news', 'apple-news',
  'hacker-news', 'reddit', 'linkedin', 'x-twitter', 'meta-facebook',
  'plurk', 'weibo', 'zhihu', 'vk',
  'feedspot', 'blogarama', 'folkd', 'mister-wong', 'wykop', 'peertube',
  'medium', 'substack', 'hashnode', 'tumblr', 'wordpress-com', 'pinterest'
]);

function credsFor(platformSlug) {
  const row = db.get('SELECT creds FROM dist_connectors WHERE platform_slug=? AND linked=1', [platformSlug]);
  if (!row || !row.creds) return {};
  try { return JSON.parse(row.creds) || {}; } catch (e) { return {}; }
}

function canonicalBase() {
  const base = ssr.canonicalBase(process.env.SITE_URL);
  return base.replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
}
function ssrBase() {
  try { return canonicalBase(); } catch (e) { return 'https://www.worldfront.news'; }
}

// Execute one delivery. Returns the honest result.
async function deliver(platform, item) {
  const impl = IMPLEMENTATIONS[platform.slug];
  if (!impl && !MANUAL_ONLY.has(platform.slug)) {
    return { status: 'pending', httpStatus: 0, message: 'No auto connector — treat as manual for now' };
  }
  if (!impl) return manualShare(platform);
  try {
    return await impl(item, credsFor(platform.slug));
  } catch (e) {
    return { status: 'failed', httpStatus: 0, message: String(e.message || 'connector error').slice(0, 160) };
  }
}

module.exports = { deliver, credsFor, indexNowBatch, IMPLEMENTATIONS, MANUAL_ONLY, ssrBase, canonicalBase };