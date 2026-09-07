// WorldFront.News output RSS 2.0 feed.
// One feed covering: site-published articles, daily shop editions, and latest
// real-estate/product announcements — the URL aggregators subscribe to.
// Distributed via the RSS connector (status 'discoverable' — platforms pull).
const db = require('../db');
const ssr = require('../lib/ssr');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function base() {
  return ssr.canonicalBase(process.env.SITE_URL).replace(/\/$/, '');
}

function itemXml(i) {
  return '<item>' +
    '<title>' + esc(i.title) + '</title>' +
    '<link>' + esc(i.url) + '</link>' +
    '<guid isPermaLink="true">' + esc(i.url) + '</guid>' +
    (i.pubDate ? '<pubDate>' + esc(i.pubDate) + '</pubDate>' : '') +
    (i.image ? '<enclosure url="' + esc(i.image) + '" type="image/jpeg"/>' : '') +
    '<description>' + esc(i.summary || '') + '</description>' +
    '<category>' + esc(i.kind || 'news') + '</category>' +
    '</item>';
}

function buildFeed() {
  const when = db.now();
  const items = [];

  // Site-authored articles (editorial + shopping news).
  const arts = db.all(
    'SELECT id,title,summary,content,slug,published_at,image,category,country_code FROM articles WHERE status="published" ORDER BY COALESCE(published_at,fetched_at) DESC LIMIT 20'
  );
  for (const a of arts) {
    const path = a.slug ? '/article/' + a.slug : '/article/' + a.id;
    items.push({
      title: a.title, url: base() + path, summary: (a.summary || a.content || '').slice(0, 600),
      pubDate: new Date((a.published_at || when) * 1000).toUTCString(),
      image: a.image || '', kind: a.category || 'news'
    });
  }

  // Daily shop editions (this week's country editions, most recent first).
  const days = db.all(
    'SELECT d.country_code AS cc, d.pub_date AS pd, d.intro AS intro, c.name AS country FROM shop_publication_days d LEFT JOIN countries c ON c.code=d.country_code ORDER BY d.pub_date DESC, d.country_code LIMIT 20'
  );
  for (const d of days) {
    items.push({
      title: (d.intro || ('Daily property market — ' + (d.country || d.cc))).slice(0, 120),
      url: base() + '/shop/daily/' + encodeURIComponent(d.cc) + '/' + d.pd,
      summary: (d.intro || '').slice(0, 600), pubDate: null, image: '', kind: 'shopping'
    });
  }

  // Latest real-estate/product announcements.
  const props = db.all(
    'SELECT listing_id,property_id,title,category,price,currency,thumbnail,updated_at FROM shop_products WHERE published=1 ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 20'
  );
  for (const p of props) {
    items.push({
      title: p.title,
      url: base() + '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id),
      summary: ((p.category || 'property') + (p.currency ? ' · ' + p.currency + ' ' + (p.price != null ? p.price : '—') : '')).slice(0, 600),
      pubDate: p.updated_at ? new Date(p.updated_at * 1000).toUTCString() : null,
      image: /^https?:\/\//.test(p.thumbnail || '') ? p.thumbnail : '', kind: p.category || 'property'
    });
  }

  // Latest internationally promoted product pages — a bounded sample so the
  // feed mixes new/updated country pages naturally (never the full 6,800+).
  const promos = db.all(
    'SELECT scp.listing_id, scp.country_code, scp.headline, scp.summary, scp.updated_at, sp.property_id, sp.thumbnail, sp.title AS ptitle ' +
    'FROM shop_country_pages scp JOIN shop_products sp ON sp.property_id = scp.listing_id OR sp.listing_id = scp.listing_id ' +
    "WHERE scp.status='published' ORDER BY scp.updated_at DESC, scp.listing_id LIMIT 12"
  );
  for (const pr of promos) {
    const pid = pr.property_id || pr.listing_id;
    items.push({
      title: pr.headline,
      url: base() + '/shop/product/' + encodeURIComponent(pid) + '/for/' + pr.country_code,
      summary: (pr.summary || (pr.ptitle || '') + ' — internationally promoted product page.').slice(0, 600),
      pubDate: pr.updated_at ? new Date(pr.updated_at * 1000).toUTCString() : null,
      image: /^https?:\/\//.test(pr.thumbnail || '') ? pr.thumbnail : '',
      kind: 'shopping'
    });
  }

  // Site-authored CMS articles.
  const owned = db.all(
    'SELECT id,title,slug,body,category,image,published_at FROM site_articles WHERE status IN ("published","live") ORDER BY COALESCE(published_at,created_at) DESC LIMIT 10'
  );
  for (const a of owned) {
    items.push({
      title: a.title, url: base() + '/p/' + (a.slug || a.id), summary: (a.body || '').slice(0, 600),
      pubDate: a.published_at ? new Date(a.published_at * 1000).toUTCString() : null,
      image: /^https?:\/\//.test(a.image || '') ? a.image : '', kind: 'editorial'
    });
  }

  const dedup = new Map();
  for (const it of items) handled(it, dedup);

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '<channel>\n' +
    '<title>WorldFront.News</title>' +
    '<link>' + base() + '</link>' +
    '<description>WorldFront.News — global news, daily property market editions and real-estate announcements.</description>' +
    '<atom:link href="' + base() + '/rss.xml" rel="self" type="application/rss+xml"/>' +
    '<lastBuildDate>' + new Date(when * 1000).toUTCString() + '</lastBuildDate>' +
    Array.from(dedup.values()).map((d) => itemXml(d)).join('') +
    '</channel>\n</rss>';
}

function handled(it, map) {
  if (!map.has(it.url)) map.set(it.url, it);
  return map;
}

module.exports = { buildFeed };