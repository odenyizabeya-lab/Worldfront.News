// First-party pageview tracking: real, honest numbers for the SEO dashboard.
// No third-party scripts, cookies or fingerprinting — a simple per-URL counter
// incremented when an HTML page is served (only for public pages, never for
// /api, /admin, static assets or sitemaps). Persisted in batches.
const db = require('../db');

const SKIP_EXACT = new Set(['/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/sw.js', '/favicon.ico']);
let pending = 0;

function shouldTrack(url, res) {
  if (!url || url.length < 2) return false;
  if (SKIP_EXACT.has(url)) return false;
  if (url.startsWith('/api/') || url.startsWith('/admin/')) return false;
  if (url.startsWith('/google/')) return false;
  const ct = String(res.getHeader('content-type') || '');
  if (!/text\/html/i.test(ct)) return false;
  return true;
}

function track(req, res) {
  try {
    const url = String(req.originalUrl || req.url || '').split('?')[0];
    if (!shouldTrack(url, res)) return;
    db.run(
      'INSERT INTO pageviews (url, views, last_seen) VALUES (?,1,?) ON CONFLICT(url) DO UPDATE SET views=views+1, last_seen=excluded.last_seen',
      [url, db.now()]
    );
    pending++;
    if (pending >= 20) {
      pending = 0;
      db.persist();
    }
  } catch (e) { /* never break page serving on tracking */ }
}

function middleware(req, res, next) {
  res.on('finish', () => track(req, res));
  next();
}

function totals() {
  const dayStart = db.now() - 86400;
  const rows = db.get('SELECT COUNT(*) AS pages, COALESCE(SUM(views),0) AS views FROM pageviews') || {};
  const today = db.get('SELECT COALESCE(SUM(views),0) AS views FROM pageviews WHERE last_seen >= ?', [dayStart]) || {};
  const todayPages = db.get('SELECT COUNT(*) AS n FROM pageviews WHERE last_seen >= ?', [dayStart]) || {};
  return {
    pages: rows.pages || 0,
    views: rows.views || 0,
    today_views: today.views || 0,
    today_pages: todayPages.n || 0
  };
}

function popular(limit) {
  return db.all(
    'SELECT url, views, last_seen FROM pageviews WHERE views > 0 ORDER BY views DESC, last_seen DESC LIMIT ?',
    [parseInt(limit, 10) || 20]
  );
}

module.exports = { middleware, track, totals, popular };