const fs = require('fs');
const path = require('path');

// Canonical base derived from the environment so the site keeps working if the
// domain or hosting provider changes. Defaults match the current production host.
// A bare apex value (e.g. https://worldfront.news) is normalized to the www
// subdomain because Vercel serves the site on www and redirects the apex there;
// subdomains and localhost overrides are left untouched.
function canonicalBase(envValue) {
  const v = (envValue === undefined || envValue === null) ? process.env.SITE_URL : envValue;
  const base = String(v || 'https://www.worldfront.news').trim().replace(/\/+$/, '');
  const m = /^(https?:\/\/)([^/]+)/i.exec(base);
  if (!m) return base;
  const host = m[2].toLowerCase();
  const isApexPlainDomain = host.split('.').length === 2
    && host.indexOf('localhost') !== 0
    && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (isApexPlainDomain && !host.startsWith('www.')) {
    return m[1] + 'www.' + host + base.slice(m[0].length);
  }
  return base;
}
const CANONICAL_BASE = canonicalBase(process.env.SITE_URL);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const SITE_NAME = 'WorldFront.News';

let cachedShell = null;
function shell() {
  if (!cachedShell) {
    cachedShell = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  }
  return cachedShell;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toISOString();
}

function fmtPrice(p, currency) {
  if (p == null || p === '') return 'Price on request';
  const sym = { USD: '$', EUR: '€', GBP: '£', NGN: '₦', KRW: '₩', KES: 'KSh ', ZAR: 'R ', GHS: 'GH₵ ' }[String(currency).toUpperCase()];
  const n = Number(p);
  if (sym) return sym + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
  return currency + ' ' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function jsonLd(data) {
  return '<script type="application/ld+json">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>';
}

function orgJson() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: CANONICAL_BASE,
    logo: { '@type': 'ImageObject', url: CANONICAL_BASE + '/icons/icon-192.png' }
  };
}

function webSiteJson() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: CANONICAL_BASE,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: CANONICAL_BASE + '/search?q={search_term_string}' },
      'query-input': 'required name=search_term_string'
    }
  };
}

function breadcrumbJson(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => {
      const entry = { '@type': 'ListItem', position: i + 1, name: it.name };
      if (it.url) entry.item = CANONICAL_BASE + it.url;
      return entry;
    })
  };
}

function productJson(p, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    image: p.thumbnail && p.thumbnail.indexOf('http') === 0 ? [p.thumbnail] : undefined,
    description: p.description ? p.description.slice(0, 2000) : undefined,
    sku: p.property_id || p.listing_id || undefined,
    mpn: p.property_id || undefined,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    category: p.category || undefined,
    url,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: p.currency || 'USD',
      price: p.price != null ? p.price : undefined,
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'Weverse Online Shop' }
    }
  };
}

function newsJson(a, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    image: a.image && a.image.indexOf('http') === 0 ? [a.image] : undefined,
    datePublished: fmtDate(a.published_at),
    author: a.author
      ? { '@type': 'Person', name: a.author }
      : { '@type': 'Organization', name: a.source_name || SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: CANONICAL_BASE + '/icons/icon-192.png' } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    description: (a.summary || a.title || '').slice(0, 160)
  };
}

function itemListJson(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url
    }))
  };
}

function collectionPageJson(name, url, hasPartUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: CANONICAL_BASE },
    ...(hasPartUrl ? { about: { '@type': 'ItemList' } } : {})
  };
}

// Renders the full HTML document. Faithfully clones the app shell from
// public/index.html so the SPA can enhance the page, and injects a server-side
// head (title, description, canonical, robots, OG, JSON-LD) so search engines
// see complete, unique, indexable pages without executing JavaScript.
function layout({ title, description, canonical, robots = 'index,follow', jsonld = [], og = {}, bodyHtml = '', noIndex = false, hreflang = [] }) {
  let html = shell();

  const finalTitle = !title || String(title).indexOf(SITE_NAME) === 0 ? String(title || SITE_NAME) : String(title) + ' — ' + SITE_NAME;
  html = html.replace(/<title>.*?<\/title>/, '<title>' + esc(finalTitle) + '</title>');
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    '<meta name="description" content="' + esc((description || '').slice(0, 200)) + '" />'
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    '<meta property="og:title" content="' + esc(og.title || title || SITE_NAME) + '" />'
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    '<meta property="og:description" content="' + esc(og.description || description || '') + '" />'
  );
  if (og.image) {
    html = html.replace(
      /<meta property="og:image" content="[^"]*" \/>/,
      '<meta property="og:image" content="' + esc(og.image) + '" />'
    );
  }
  if (og.type) {
    html = html.replace(
      /<meta property="og:type" content="website" \/>/,
      '<meta property="og:type" content="' + esc(og.type) + '" />'
    );
  }

  const extra = [];
  if (canonical) extra.push('<link rel="canonical" href="' + esc(canonical) + '" />');
  for (const h of hreflang) {
    if (h && h.code && h.url) extra.push('<link rel="alternate" hreflang="' + esc(h.code) + '" href="' + esc(h.url) + '" />');
  }
  const robotsVal = noIndex ? 'noindex,follow' : robots;
  extra.push('<meta name="robots" content="' + esc(robotsVal) + '" />');
  if (process.env.GOOGLE_SITE_VERIFICATION) {
    extra.push('<meta name="google-site-verification" content="' + esc(process.env.GOOGLE_SITE_VERIFICATION) + '" />');
  }
  for (const j of jsonld) extra.push(jsonLd(j));

  html = html.replace('</head>', extra.join('\n  ') + '\n</head>');
  html = html.replace('<main id="app"></main>', '<main id="app">' + bodyHtml + '</main>');
  return html;
}

function notFoundPage(res, message) {
  res.status(404).send(layout({
    title: 'Page not found',
    description: 'The page you are looking for could not be found.',
    canonical: null,
    noIndex: true,
    bodyHtml: '<div class="center" style="padding:60px 20px;text-align:center">' +
      '<h1>Page not found</h1><p class="muted">' + esc(message || 'This page does not exist.') + '</p>' +
      '<br><a class="btn btn-primary" href="/">Back to home</a> ' +
      '<a class="btn btn-outline" href="/shop">Shop</a></div>'
  }));
}

// Shared header/nav + footer mirror the SPA shell so SSR and app pages look alike.
function shellHeader() {
  return '<div class="site-header"><div class="header-inner">' +
    '<a href="/" class="brand"><img src="/icons/logo.svg" alt="WorldFront.News logo" class="brand-logo" width="34" height="34" /><span class="brand-text">WorldFront<span class="brand-dot">.News</span></span></a>' +
    '<nav class="main-nav"><a href="/latest">Latest</a><a href="/world">World</a><a href="/breaking">Breaking</a><a href="/map">Map</a><a href="/shop">Shop</a></nav>' +
    '</div></div>';
}

module.exports = {
  CANONICAL_BASE, SITE_NAME, canonicalBase, esc, fmtDate, fmtPrice, jsonLd,
  orgJson, webSiteJson, breadcrumbJson, productJson, newsJson, itemListJson, collectionPageJson,
  layout, notFoundPage
};