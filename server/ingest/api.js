// Optional API-based news providers (NewsData.io, NewsAPI.org, GNews).
// These require API keys set in the environment. They are NOT required for the
// platform to work (RSS feeds are the primary source), but they expand coverage.
const db = require('../db');

function normalizeCountry(code) {
  if (!code) return 'US';
  return String(code).toUpperCase();
}

function guessCategoryFromNewsAPI(cat) {
  const map = {
    business: 'business', general: 'world', health: 'health',
    science: 'science', sports: 'sports', technology: 'technology',
    entertainment: 'entertainment'
  };
  return map[cat] || 'world';
}

async function fetchNewsDataAPI(key, limit = 50) {
  // NewsData.io: https://newsdata.io
  const url = `https://newsdata.io/api/1/news?apikey=${key}&language=en,de,fr,es,pt,it&size=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('NewsData.io HTTP ' + res.status);
  const json = await res.json();
  let inserted = 0;
  for (const a of (json.results || [])) {
    const guid = 'newsdata:' + (a.link || a.article_id);
    const publishedAt = a.pubDate ? Math.floor(new Date(a.pubDate).getTime() / 1000) : db.now();
    try {
      db.run(
        `INSERT OR IGNORE INTO articles
         (guid,title,slug,summary,content,image,source_name,source_url,author,country_code,category,published_at,fetched_at,link,breaking,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'published')`,
        [guid, a.title, slug(a.title), a.description, a.content, a.image_url,
         a.source_id || 'NewsData', (a.source_url || a.link) || '',
         a.creator && a.creator[0] || '', normalizeCountry(a.country && a.country[0]),
         guessCategoryFromNewsAPI(a.category && a.category[0]) || guess(a.title),
         publishedAt, db.now(), a.link || a.url || '']
      );
      inserted++;
    } catch (e) {}
  }
  return inserted;
}

async function fetchNewsAPI(key, limit = 50) {
  // NewsAPI.org: requires 'top-headlines'
  const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=${limit}&apiKey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('NewsAPI HTTP ' + res.status);
  const json = await res.json();
  if (json.status !== 'ok') throw new Error('NewsAPI: ' + (json.message || 'error'));
  let inserted = 0;
  for (const a of (json.articles || [])) {
    if (!a.title || a.title === '[Removed]') continue;
    const guid = 'newsapi:' + (a.url);
    try {
      db.run(
        `INSERT OR IGNORE INTO articles
         (guid,title,slug,summary,content,image,source_name,source_url,author,country_code,category,published_at,fetched_at,link,breaking,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'published')`,
        [guid, a.title, slug(a.title), a.description, a.description, a.urlToImage,
         (a.source && a.source.name) || 'NewsAPI', a.url,
         a.author || '', normalizeCountry(a.country) || 'US',
         guessCategoryFromNewsAPI(a.category) || guess(a.title),
         a.publishedAt ? Math.floor(new Date(a.publishedAt).getTime() / 1000) : db.now(),
         db.now(), a.url]
      );
      inserted++;
    } catch (e) {}
  }
  return inserted;
}

async function fetchGNews(key, limit = 50) {
  // GNews.io
  const url = `https://gnews.io/api/v4/top-headlines?lang=en&max=${limit}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('GNews HTTP ' + res.status);
  const json = await res.json();
  let inserted = 0;
  for (const a of (json.articles || [])) {
    const guid = 'gnews:' + (a.url);
    try {
      db.run(
        `INSERT OR IGNORE INTO articles
         (guid,title,slug,summary,content,image,source_name,source_url,author,country_code,category,published_at,fetched_at,link,breaking,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'published')`,
        [guid, a.title, slug(a.title), a.description, a.content, a.image,
         (a.source && a.source.name) || 'GNews', a.url,
         a.author || '', normalizeCountry(a.country) || 'US',
         'world', a.publishedAt ? Math.floor(new Date(a.publishedAt).getTime() / 1000) : db.now(),
         db.now(), a.url]
      );
      inserted++;
    } catch (e) {}
  }
  return inserted;
}

function slug(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function guess(t) {
  const s = String(t || '').toLowerCase();
  if (/(tech|software|ai|computer|app|cyber|digital|chip|startup)/.test(s)) return 'technology';
  if (/(health|medical|doctor|vaccine|hospital|disease|patient)/.test(s)) return 'health';
  if (/(sport|football|soccer|basketball|tennis|olympic|match|nba|nfl|fifa)/.test(s)) return 'sports';
  if (/(business|market|stock|economy|finance|bank|invest|gdp)/.test(s)) return 'business';
  if (/(science|space|nasa|research|study|climate|environment)/.test(s)) return 'science';
  if (/(election|government|politics|president|minister|senate|congress)/.test(s)) return 'politics';
  return 'world';
}

async function runApiProviders() {
  await db.ready();
  let total = 0;
  const notes = [];

  if (process.env.NEWSDATA_API_KEY) {
    try {
      const n = await fetchNewsDataAPI(process.env.NEWSDATA_API_KEY);
      total += n; notes.push('NewsData.io: ' + n);
    } catch (e) { notes.push('NewsData.io error: ' + e.message); }
  }
  if (process.env.NEWSAPI_KEY) {
    try {
      const n = await fetchNewsAPI(process.env.NEWSAPI_KEY);
      total += n; notes.push('NewsAPI: ' + n);
    } catch (e) { notes.push('NewsAPI error: ' + e.message); }
  }
  if (process.env.GNEWS_KEY) {
    try {
      const n = await fetchGNews(process.env.GNEWS_KEY);
      total += n; notes.push('GNews: ' + n);
    } catch (e) { notes.push('GNews error: ' + e.message); }
  }

  db.persist();
  return { total, notes };
}

module.exports = { runApiProviders, fetchNewsDataAPI, fetchNewsAPI, fetchGNews };
