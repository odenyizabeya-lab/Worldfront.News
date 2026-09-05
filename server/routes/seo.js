const express = require('express');
const db = require('../db');
const shop = require('../integrations/weverse-shop');
const ssr = require('../lib/ssr');
const loc = require('../lib/location');
const propSeo = require('../lib/property-seo');

const { esc, CANONICAL_BASE } = ssr;
const router = express.Router();

// ---------- shared helpers ----------

function isMediaVideo(u) {
  return /\.(mp4|webm|ogv|mov|m4v|mpg|mpeg)(\?|$)/i.test(String(u || ''));
}

// Render an article's front media as <video> when it is a real video file
// (house/car walkthroughs), else as a lazy <img>.
function mediaHtml(src, alt, cls) {
  if (!src) return '';
  const c = cls ? ' class="' + cls + '"' : '';
  if (isMediaVideo(src)) {
    return '<video' + c + ' src="' + esc(src) + '" autoplay muted loop playsinline controls preload="metadata" onerror="this.style.display=\'none\'"></video>';
  }
  return '<img' + c + ' loading="lazy" src="' + esc(src) + '" alt="' + esc(alt || '') + '" />';
}

function articleThumb(r) {
  if (!r.image || r.image.indexOf('http') !== 0 || !String(r.image).trim()) return '';
  return mediaHtml(r.image, r.title, '');
}

function productId(propertyId, listingId, productUrl) {
  if (propertyId) return propertyId;
  const m = /(\?|&)id=([A-Za-z0-9_-]+)/.exec(String(productUrl || ''));
  return m ? m[2] : listingId;
}

function productUrlFor(p) {
  return '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id);
}

function productCard(p, opts) {
  const px = ssr.fmtPrice(p.price, p.currency);
  const title = esc(p.title || 'Product');
  const href = esc(productUrlFor(p));
  const ext = p.product_url ? esc(p.product_url) : '#';
  const fallback = '<span class="thumb-fallback" style="background:linear-gradient(135deg,#7a1f8c,#c026d3)"><span class="thumb-fb-icon">🛍️</span><span class="thumb-fb-label">Weverse Shop</span></span>';
  const img = p.thumbnail && p.thumbnail.indexOf('http') === 0
    ? mediaHtml(p.thumbnail, title, '')
    : fallback;
  return '<article class="article-card product-card' + (opts && opts.featured ? ' featured-card' : '') + '">' +
    '<a class="thumb' + (opts && opts.big ? ' product-thumb' : '') + '" href="' + href + '" title="' + title + '">' + img +
      '<span class="cat-tag">' + esc(p.category || 'shopping') + '</span>' +
      (opts && opts.featured ? '<span class="featured-ribbon">★ Featured</span>' : '') +
    '</a>' +
    '<div class="card-body">' +
      '<h3><a href="' + href + '">' + title + '</a></h3>' +
      (p.description ? '<p class="card-summary">' + esc(p.description.slice(0, 120)) + '</p>' : '') +
      '<div class="card-meta"><span class="src">' + esc(p.brand || 'Weverse Shop') + '</span>' +
        '<span>·</span><span class="product-price">' + esc(px) + '</span></div>' +
      '<a class="btn btn-primary btn-sm btn-block buy-btn" href="' + href + '">View product</a> ' +
      '<a class="btn btn-outline btn-sm btn-block" href="' + ext + '" target="_blank" rel="noopener noreferrer noopener">View on Weverse ↗</a>' +
    '</div></article>';
}

function countryName(code) {
  const c = db.get('SELECT name FROM countries WHERE code=?', [code]);
  return c ? c.name : code;
}

// ---------- Product page ----------
// Real-estate listings are rendered with a dedicated RealEstateListing
// JSON-LD schema built from the actual property record plus real media (video
// first, else the real image) tagged with auto-generated SEO alt text.

router.get('/shop/product/:id', (req, res) => {
  const id = String(req.params.id);
  const p = db.get(
    'SELECT * FROM shop_products WHERE (listing_id=? OR property_id=?) AND published=1',
    [id, id]
  );
  if (!p) return ssr.notFoundPage(res, 'That product is not available.');

  const canonical = CANONICAL_BASE + productUrlFor(p);
  const pid = p.property_id || id;
  const detail = db.get('SELECT * FROM property_details WHERE property_id=? OR listing_id=?', [pid, p.listing_id]) || {};
  const merged = { ...p, ...detail };

  const related = db.all(
    'SELECT property_id,listing_id,title,thumbnail,price,currency,product_url,category FROM shop_products WHERE published=1 AND (category=? AND property_id != ?) ORDER BY updated_at DESC LIMIT 6',
    [p.category || '', pid]
  );

  const appeared = db.all(
    'SELECT d.country_code, d.pub_date, d.headline FROM shop_publications sp JOIN shop_publication_days d ON d.country_code=sp.country_code AND d.pub_date=sp.pub_date WHERE sp.listing_id=? ORDER BY d.pub_date DESC',
    [p.listing_id]
  );

  const isProperty = propSeo.isHousing(merged);
  const images = propSeo.imageList(merged);
  const heroImg = images.find((u) => !propSeo.isVideo(u)) || (merged.thumbnail && /^https?:/.test(merged.thumbnail) ? merged.thumbnail : '') || '';
  const heroVid = images.find(propSeo.isVideo) || (merged.video && /^https?:/.test(merged.video) ? merged.video : '') || '';
  const alt = propSeo.generatedAltText(merged);
  const caption = propSeo.generatedCaption(merged);
  const locLabel = loc.displayAddress(merged);
  const locSegs = realLocationSegments(merged);
  const px = ssr.fmtPrice(merged.price, merged.currency);

  let body = '<article class="article-page">';
  body += '<nav class="seo-crumbs">' +
    '<a href="/">Home</a> › <a href="/shop">Shop</a> › ' +
    (p.category ? '<a href="/shop?category=' + encodeURIComponent(p.category) + '">' + esc(p.category) + '</a> › ' : '') +
    locSegs.map((s) => s.url
      ? '<a href="' + esc(s.url) + '">' + esc(s.name) + '</a>'
      : esc(s.name)).join(' › ') +
    (locSegs.length ? ' › ' : '') +
    esc(p.title) + '</nav>';
  body += '<h1>' + esc(p.title) + '</h1>';
  body += '<div class="article-meta"><span class="src">' + esc(p.brand || 'Weverse Online Shop') + '</span>' +
    (p.subcategory && p.subcategory !== 'Not specified' ? '<span>' + esc(p.subcategory) + '</span>' : '') +
    '<span>' + esc(p.category || 'shopping') + '</span>' +
    (merged.listing_status ? '<span>' + esc(merged.listing_status) + '</span>' : '') +
    '</div>';

  // Real media — video first for property walkthroughs, else the real image.
  if (heroVid) {
    body += '<figure class="property-figure"><video class="article-hero-img is-product" src="' + esc(heroVid) + '" autoplay muted loop playsinline controls preload="metadata" onerror="this.style.display=\'none\'"></video>' +
      (caption ? '<figcaption class="muted">' + esc(caption) + '</figcaption>' : '') + '</figure>';
  } else if (heroImg) {
    body += '<figure class="property-figure"><img class="article-hero-img is-product" src="' + esc(heroImg) + '" alt="' + esc(alt) + '" />' +
      (caption ? '<figcaption class="muted">' + esc(caption) + '</figcaption>' : '') + '</figure>';
  }
  body += '<p class="product-price" style="font-size:1.6rem;font-weight:700">' + esc(px) + '</p>';
  if (p.prev_price && p.prev_price !== p.price) {
    body += '<p class="muted" style="text-decoration:line-through">' + esc(ssr.fmtPrice(p.prev_price, p.currency)) + '</p>';
  }
  if (merged.description) {
    body += '<p class="article-summary">' + esc(merged.description) + '</p>';
  }

  // Real location + real spec block for property listings.
  if (isProperty) {
    const specRow = [
      merged.bedrooms ? '<strong>Bedrooms:</strong> ' + esc(merged.bedrooms) : '',
      merged.bathrooms ? '<strong>Bathrooms:</strong> ' + esc(merged.bathrooms) : '',
      merged.building_size ? '<strong>Building size:</strong> ' + esc(merged.building_size) : '',
      merged.land_size ? '<strong>Land size:</strong> ' + esc(merged.land_size) : '',
      merged.parking_spaces ? '<strong>Parking:</strong> ' + esc(merged.parking_spaces) : ''
    ].filter(Boolean).join(' · ');
    const geoText = merged.lat != null && merged.lng != null
      ? '<p><strong>Coordinates:</strong> ' + merged.lat + ', ' + merged.lng + '</p>' : '';
    if (locLabel || specRow || geoText) {
      body += '<div class="card property-specs" style="margin-top:16px">' +
        (locLabel ? '<p><strong>Location:</strong> 📍 ' + esc(locLabel) + '</p>' : '') +
        (geoText ? geoText : '') +
        (specRow ? '<p class="spec-row" style="display:flex;gap:18px;flex-wrap:wrap">' + specRow + '</p>' : '') +
        '</div>';
    }
    // Link to the programmatic location page for this property when it exists.
    const lp = resolvedPropertyLocationPage(merged);
    if (lp) {
      body += '<p style="margin-top:14px"><a class="btn btn-outline btn-sm" href="' + lp + '">🗺 Houses for sale in ' + esc(merged.city || merged.town || 'this area') + '</a></p>';
    }
  }

  body += '<div class="article-actions">' +
    '<a class="btn btn-primary" href="' + esc(p.product_url || '#') + '" target="_blank" rel="noopener noreferrer noopener">View and buy on Weverse ↗</a>' +
    '<a class="btn btn-outline" href="/shop">Browse all products</a>' +
    '</div>';

  if (appeared && appeared.length) {
    body += '<h2 style="margin-top:28px">Where this product appeared</h2><div class="grid">';
    const seen = new Set();
    for (const a of appeared.slice(0, 6)) {
      const key = a.country_code + a.pub_date;
      if (seen.has(key)) continue;
      seen.add(key);
      body += '<article class="article-card"><div class="card-body"><h3><a href="/shop/daily/' + a.country_code + '/' + a.pub_date + '">' +
        esc(countryName(a.country_code)) + ' daily edition · ' + esc(a.pub_date) + '</a></h3></div></article>';
    }
    body += '</div>';
  }

  if (related && related.length) {
    body += '<h2 style="margin-top:28px">More from ' + esc(p.category || 'the shop') + '</h2><div class="grid">' +
      related.map(r => propertyCard(Object.assign(r, (function(){ const d = db.get('SELECT * FROM property_details WHERE property_id=?', [r.property_id]); return d || {}; })()))).join('') + '</div>';
  }
  body += '</article>';

  // Proper structured data: RealEstateListing for properties, Product otherwise.
  // Breadcrumbs include the real location chain so Google sees the product is
  // tied to its actual place (country → state → county/city).
  const crumbItems = [
    { name: 'Home', url: '/' },
    { name: 'Shop', url: '/shop' },
    { name: p.category || 'Products', url: '/shop?category=' + encodeURIComponent(p.category || '') }
  ];
  for (const s of locSegs) {
    crumbItems.push({ name: s.name, url: s.url || undefined });
  }
  crumbItems.push({ name: p.title, url: productUrlFor(p) });
  const crumbJson = ssr.breadcrumbJson(crumbItems);
  const jsonld = isProperty
    ? [propSeo.realEstateJson(merged, canonical), crumbJson]
    : [ssr.productJson(merged, canonical), crumbJson];

  res.type('html').send(ssr.layout({
    title: p.title,
    description: ((p.description || p.title) + '').slice(0, 200),
    canonical,
    og: {
      title: p.title,
      description: (p.description || '').slice(0, 200).replace(/\s+$/, ''),
      image: heroImg && !propSeo.isVideo(heroImg) ? heroImg : undefined,
      type: 'product'
    },
    jsonld,
    bodyHtml: body
  }));
});

function resolvedPropertyLocationPage(p) {
  try {
    const details = { ...p };
    if (!details.country_code) return null;
    const l = loc.resolveListingLocation(details, { includeStreet: false, verified: !!(details.lat != null && details.lng != null) });
    if (!l) return null;
    const path = loc.locationPagePath(l);
    return path ? CANONICAL_BASE + path : null;
  } catch (e) {
    return null;
  }
}

// The real geographic chain (country → state → county/city → …) for a listing,
// annotated with links only to pages that actually exist (never invented).
// The country links to its existing /country/:code page; deeper levels link to
// their programmatic /property/... landing page only when it has live content.
function realLocationSegments(p) {
  try {
    if (!p.country_code) return [];
    const locMrg = loc.resolveListingLocation({ ...p }, { includeStreet: false, verified: !!(p.lat != null && p.lng != null) });
    if (!locMrg) return [];
    const chain = loc.chainFor(locMrg);
    if (!chain || !chain.length) return [];
    const out = [];
    for (const item of chain) {
      if (!['country', 'state', 'city', 'town', 'village', 'district', 'county', 'neighborhood'].includes(item.type)) continue;
      const isCountry = item.type === 'country';
      const hasPage = isCountry || loc.hasContent(item);
      out.push({
        name: item.name,
        type: item.type,
        url: hasPage
          ? (isCountry ? '/country/' + String(p.country_code).toUpperCase() : loc.locationPagePath(item))
          : null
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---------- Daily edition page ----------

function renderEdition(res, country, date) {
  const cc = String(country).toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(cc)) return ssr.notFoundPage(res, 'Unknown country.');
  const edition = shop.dailyEdition(cc, date);
  if (!edition) return ssr.notFoundPage(res, 'No daily edition for that country/date.');

  const canonical = CANONICAL_BASE + '/shop/daily/' + cc + '/' + date;
  const map = new Map(db.all('SELECT listing_id, property_id FROM shop_products').map(r => [r.listing_id, r.property_id]));
  const featured = edition.items.find(i => i.featured) || null;

  const hero = featured
    ? '<div class="daily-hero"><a href="' + esc('/shop/product/' + encodeURIComponent(map.get(featured.listing_id) || productId(null, featured.listing_id, featured.product_url))) + '">' +
        (featured.image && featured.image.indexOf('http') === 0
          ? '<img class="article-hero-img is-product" src="' + esc(featured.image) + '" alt="' + esc(featured.title) + '" />'
          : '') +
        '<span class="featured-ribbon">★ Today\'s featured product</span></a></div>'
    : '';

  let grid = '';
  for (const it of edition.items) {
    const pid = map.get(it.listing_id) || productId(null, it.listing_id, it.product_url);
    grid += productCard({
      property_id: pid,
      listing_id: it.listing_id,
      title: it.title,
      thumbnail: it.image,
      price: it.price,
      currency: it.currency,
      category: it.category,
      brand: it.brand,
      product_url: it.product_url,
      description: it.item_text
    }, { featured: !!it.featured });
  }

  const body =
    '<article class="article-page">' +
      '<span class="cat-tag">shopping</span> <span class="pill">Daily product update</span>' +
      '<h1>' + esc(edition.headline) + '</h1>' +
      '<div class="article-meta"><span class="src">Weverse Online Shop</span>' +
        '<span>' + esc(date) + '</span><span>' + esc(countryName(cc)) + '</span>' +
        (edition.total ? '<span>' + edition.total + ' products</span>' : '') +
      '</div>' + hero +
      (edition.intro ? '<p class="article-summary">' + esc(edition.intro) + '</p>' : '') +
      '<div class="daily-products"><div class="grid">' + grid + '</div></div>' +
      (edition.closing ? '<p class="article-summary" style="margin-top:24px">' + esc(edition.closing) + '</p>' : '') +
    '</article>';

  const items = edition.items.slice(0, 30).map(it => ({
    name: it.title,
    url: CANONICAL_BASE + '/shop/product/' + encodeURIComponent(map.get(it.listing_id) || productId(null, it.listing_id, it.product_url))
  }));

  res.type('html').send(ssr.layout({
    title: edition.headline,
    description: (edition.intro || edition.headline || '').slice(0, 200),
    canonical,
    og: {
      title: edition.headline,
      description: (edition.intro || '').slice(0, 200).replace(/\s+$/, ''),
      image: featured && featured.image && featured.image.indexOf('http') === 0 ? featured.image : undefined,
      type: 'article'
    },
    jsonld: [
      ssr.newsJson({ title: edition.headline, summary: edition.intro, image: featured && featured.image, published_at: new Date(date + 'T12:00:00Z').getTime() / 1000, author: 'Weverse Online Shop' }, canonical),
      ssr.itemListJson(items),
      ssr.breadcrumbJson([
        { name: 'Home', url: '/' },
        { name: 'Shop', url: '/shop' },
        { name: countryName(cc), url: '/country/' + cc },
        { name: date, url: '/shop/daily/' + cc + '/' + date }
      ])
    ],
    bodyHtml: body
  }));
}

router.get('/shop/daily/:country/:date', (req, res) => {
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ssr.notFoundPage(res, 'Invalid date format.');
  renderEdition(res, req.params.country, date);
});

router.get('/shop/daily/:country', (req, res) => {
  const cc = String(req.params.country).toUpperCase();
  const row = db.get(
    'SELECT pub_date FROM shop_publication_days WHERE country_code=? ORDER BY pub_date DESC LIMIT 1',
    [cc]
  );
  if (!row) return ssr.notFoundPage(res, 'No daily edition published for that country yet.');
  res.redirect(301, '/shop/daily/' + cc + '/' + row.pub_date);
});

// ---------- Shop catalog ----------

router.get('/shop', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 80) : '';
  let rows;
  if (category) {
    rows = db.all('SELECT * FROM shop_products WHERE published=1 AND category=? ORDER BY updated_at DESC', [category]);
  } else {
    rows = db.all('SELECT * FROM shop_products WHERE published=1 ORDER BY updated_at DESC');
  }
  const categories = db.all('SELECT category, COUNT(*) AS c FROM shop_products WHERE published=1 GROUP BY category ORDER BY c DESC');

  let chips = '<div class="chip-row"><a class="chip' + (category ? '' : ' active') + '" href="/shop">All</a>' +
    categories.map(c => '<a class="chip' + (category === c.category ? ' active' : '') + '" href="/shop?category=' + encodeURIComponent(c.category) + '">' + esc(c.category) + ' (' + c.c + ')</a>').join('') +
    '</div>';

  let cards = '';
  if (rows.length) {
    cards = '<div class="grid">' + rows.map(p => productCard(p)).join('') + '</div>';
  } else if (category) {
    cards = '<p class="muted">No products in this category yet.</p>';
  } else {
    cards = '<p class="muted">Products are published automatically — check back soon.</p>';
  }

  const canonical = CANONICAL_BASE + '/shop' + (category ? '?category=' + encodeURIComponent(category) : '');
  const listItems = rows.slice(0, 30).map(p => ({ name: p.title, url: CANONICAL_BASE + productUrlFor(p) }));

  const body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › Shop</nav>' +
    '<h1 class="page-title">🛍️ Shop catalog</h1>' +
    '<p class="muted">Every product published from the Weverse Online Shop. Each product has its own permanent page below.</p>' +
    chips + cards;

  res.type('html').send(ssr.layout({
    title: category ? (category + ' products') : 'Shop',
    description: 'Browse the complete Weverse Online Shop product catalog on WorldFront.News — ' + (category ? category + ' products with' : 'every published product with') + ' prices, photos and details.',
    canonical,
    og: { type: 'website', title: category ? (category + ' products') : 'Shop' },
    jsonld: [
      ssr.collectionPageJson(category ? (category + ' products') : 'Shop catalog', canonical),
      ssr.itemListJson(listItems)
    ],
    bodyHtml: body
  }));
});

// ---------- Article page ----------

router.get('/article/:slug', (req, res) => {
  const a = db.get("SELECT * FROM articles WHERE slug=? AND status='published'", [req.params.slug]);
  if (!a) return ssr.notFoundPage(res, 'That article is not available.');

  // Daily shop editions have their own canonical /shop/daily/:country/:date URL.
  const m = /^shop-daily:([A-Z]{2,3}):(\d{4}-\d{2}-\d{2})$/.exec(String(a.guid || ''));
  if (m) {
    if (db.get('SELECT pub_date FROM shop_publication_days WHERE country_code=? AND pub_date=?', [m[1], m[2]])) {
      return res.redirect(301, CANONICAL_BASE + '/shop/daily/' + m[1] + '/' + m[2]);
    }
    return renderEdition(res, m[1], m[2]);
  }

  const canonical = CANONICAL_BASE + '/article/' + encodeURIComponent(a.slug);
  const related = db.all(
    "SELECT id,slug,title,summary,image,category,country_code,source_name,published_at FROM articles WHERE status='published' AND category=? AND id != ? ORDER BY published_at DESC LIMIT 6",
    [a.category, a.id]
  );
  const flag = a.country_code ? countryName(a.country_code) : '';

  const img = a.image && a.image.indexOf('http') === 0
    ? mediaHtml(a.image, a.title, 'article-hero-img')
    : '';

  const body =
    '<article class="article-page">' +
      '<nav class="seo-crumbs"><a href="/">Home</a> › ' +
        '<a href="/category/' + encodeURIComponent(a.category || 'world') + '">' + esc(a.category || 'world') + '</a> › ' + esc(a.title) + '</nav>' +
      '<span class="cat-tag">' + esc(a.category || 'world') + '</span>' +
      (a.breaking ? ' <span class="pill">BREAKING</span>' : '') +
      '<h1>' + esc(a.title) + '</h1>' +
      '<div class="article-meta">' +
        '<span class="src">' + esc(a.source_name || '') + '</span>' +
        (a.author ? '<span>by ' + esc(a.author) + '</span>' : '') +
        (a.published_at ? '<span>' + esc(ssr.fmtDate(a.published_at).slice(0, 10)) + '</span>' : '') +
        (flag ? '<span>' + esc(flag) + '</span>' : '') +
      '</div>' + img +
      (a.summary ? '<p class="article-summary">' + esc(a.summary) + '</p>' : '') +
      '<div class="article-actions"><a class="btn btn-primary" href="' + esc(a.link || '#') + '" target="_blank" rel="noopener noreferrer nofollow">Read original article ↗</a></div>' +
      (related.length
        ? '<h2 style="margin-top:28px">Related stories</h2><div class="grid">' + related.map(r =>
            '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' +
              (r.image && r.image.indexOf('http') === 0 ? mediaHtml(r.image, r.title, '') : '<span class="thumb-fallback"></span>') +
              '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
            '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3></div></article>'
          ).join('') + '</div>'
        : '') +
    '</article>';

  res.type('html').send(ssr.layout({
    title: a.title,
    description: (a.summary || a.title).slice(0, 200),
    canonical,
    og: {
      title: a.title,
      description: (a.summary || '').slice(0, 200).replace(/\s+$/, ''),
      image: a.image && a.image.indexOf('http') === 0 && !isMediaVideo(a.image) ? a.image : undefined,
      type: 'article'
    },
    jsonld: [
      ssr.newsJson(a, canonical),
      ssr.breadcrumbJson([
        { name: 'Home', url: '/' },
        { name: a.category || 'world', url: '/category/' + encodeURIComponent(a.category || 'world') },
        { name: a.title, url: '/article/' + a.slug }
      ])
    ],
    bodyHtml: body
  }));
});

// ---------- Country page ----------

router.get('/country/:code', (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const c = db.get('SELECT code, name FROM countries WHERE code=?', [code]);
  if (!c) return ssr.notFoundPage(res, 'Unknown country.');
  const canonical = CANONICAL_BASE + '/country/' + code;

  const latest = db.all(
    "SELECT id,slug,title,summary,image,category,source_name,published_at FROM articles WHERE status='published' AND country_code=? AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 30",
    [code]
  );
  const ed = db.get('SELECT pub_date FROM shop_publication_days WHERE country_code=? ORDER BY pub_date DESC LIMIT 1', [code]);

  let body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › <a href="/map">World</a> › ' + esc(c.name) + '</nav>' +
    '<h1 class="page-title">News from ' + esc(c.name) + '</h1>';

  if (ed) {
    body += '<section class="shop-edition-link"><a class="btn btn-primary" href="/shop/daily/' + code + '/' + ed.pub_date + '">🛍️ ' +
      esc(c.name) + ' Weverse daily product update (' + ed.pub_date + ')</a></section>';
  }

  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No news stories published for ' + esc(c.name) + ' yet.</p>';
  }

  res.type('html').send(ssr.layout({
    title: 'News from ' + c.name,
    description: 'Latest news from ' + c.name + ' and the ' + c.name + ' Weverse Online Shop daily product update on WorldFront.News.',
    canonical,
    og: { title: 'News from ' + c.name, description: 'Latest news from ' + c.name + ' and its Weverse daily product update.', type: 'website' },
    jsonld: [
      ssr.collectionPageJson('News from ' + c.name, canonical),
      ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: c.name, url: '/country/' + code }])
    ],
    bodyHtml: body
  }));
});

// ---------- Category page ----------

router.get('/category/:slug', (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const c = db.get('SELECT slug, name FROM categories WHERE slug=?', [slug]);
  if (!c && slug !== 'shopping') {
    const anyCat = db.get('SELECT category AS name, category AS slug FROM shop_products WHERE LOWER(category)=? LIMIT 1', [decodeURIComponent(slug).toLowerCase()]);
    if (!anyCat) return ssr.notFoundPage(res, 'Unknown category.');
  }
  const canonical = CANONICAL_BASE + '/category/' + slug;

  const isShopCat = !c;
  let body = '<nav class="seo-crumbs"><a href="/">Home</a> › ' + esc(c ? c.name : slug) + '</nav>' +
    '<h1 class="page-title">' + esc(c ? c.name : slug) + '</h1>';

  if (isShopCat) {
    return res.redirect(301, CANONICAL_BASE + '/shop?category=' + encodeURIComponent(slug));
  }

  const latest = db.all(
    "SELECT id,slug,title,summary,image,category,source_name,published_at FROM articles WHERE status='published' AND category=? ORDER BY published_at DESC LIMIT 30",
    [slug]
  );
  if (slug === 'shopping') {
    body += '<p class="muted" style="margin-bottom:14px"><a href="/shop">Browse the full shop product catalog →</a></p>';
  }
  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No stories in this category yet.</p>';
  }

  res.type('html').send(ssr.layout({
    title: (c ? c.name : slug) + ' news',
    description: 'Latest ' + (c ? c.name : slug) + ' news and updates from around the world on WorldFront.News.',
    canonical,
    og: { title: (c ? c.name : slug) + ' news', type: 'website' },
    jsonld: [
      ssr.collectionPageJson((c ? c.name : slug) + ' news', canonical),
      ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: c ? c.name : slug, url: '/category/' + slug }])
    ],
    bodyHtml: body
  }));
});

// ---------- Home page (SSR content, enhanced by the SPA) ----------

function articleCardRow(r) {
  return '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' +
    articleThumb(r) +
    '<span class="cat-tag">' + esc(r.category || 'world') + '</span></a>' +
    '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3>' +
    (r.summary ? '<p class="card-summary">' + esc(r.summary.slice(0, 120)) + '</p>' : '') +
    '<div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>';
}

router.get('/', (req, res) => {
  const top = db.all("SELECT * FROM articles WHERE status='published' AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 9");
  const cats = db.all('SELECT slug, name, icon FROM categories WHERE active=1 AND slug NOT IN (\'world\', \'breaking\') ORDER BY name');
  const prod = db.all('SELECT property_id,listing_id,title,thumbnail,price,currency,product_url,category FROM shop_products WHERE published=1 ORDER BY updated_at DESC LIMIT 4');
  const regions = db.all('SELECT DISTINCT region FROM countries WHERE region IS NOT NULL ORDER BY region LIMIT 12');

  let body = '<div class="section-head"><h2>🌍 Top stories</h2></div>' +
    (top.length ? '<div class="grid grid-4">' + top.map(articleCardRow).join('') + '</div>' : '<p class="muted">Real headlines from around the world are being collected now — check back soon.</p>');

  for (const cat of cats.slice(0, 6)) {
    const items = db.all("SELECT id,slug,title,image,category,source_name FROM articles WHERE status='published' AND category=? ORDER BY published_at DESC LIMIT 4", [cat.slug]);
    if (!items.length) continue;
    body += '<div class="section-head"><h2>' + esc(cat.icon || '') + ' ' + esc(cat.name) + '</h2><a class="see-all" href="/category/' + esc(cat.slug) + '">See all</a></div><div class="grid">' + items.map(articleCardRow).join('') + '</div>';
  }

  if (prod.length) {
    body += '<div class="section-head"><h2>🛍️ Shop updates</h2><a class="see-all" href="/shop">See all</a></div>' +
      '<p class="muted" style="font-size:.85rem;margin:-6px 0 12px">New products published automatically from the Weverse Online Shop.</p>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">' + prod.map(p => productCard(p)).join('') + '</div>';
  }

  if (regions.length) {
    body += '<div class="section-head"><h2>🌍 Explore by region</h2></div><div class="chip-row">' +
      regions.map(r => '<a class="chip" href="/region/' + encodeURIComponent(r.region) + '">' + esc(r.region) + '</a>').join('') +
      ' <a class="chip" href="/map">All countries →</a></div>';
  }

  res.type('html').send(ssr.layout({
    title: 'WorldFront.News — Global News Platform',
    description: 'WorldFront.News — real news from every country in the world, plus the Weverse Online Shop daily product updates for every country.',
    canonical: CANONICAL_BASE + '/',
    og: { title: 'WorldFront.News — Global News Platform', type: 'website' },
    jsonld: [ssr.orgJson(), ssr.webSiteJson()],
    bodyHtml: body
  }));
});

// ---------- Region page ----------

router.get('/region/:name', (req, res) => {
  const name = String(req.params.name).replace(/[^A-Za-z0-9 -]/g, '').trim();
  const row = db.get('SELECT DISTINCT region FROM countries WHERE region=? COLLATE NOCASE', [name]);
  if (!row) return ssr.notFoundPage(res, 'Unknown region.');
  const regionName = row.region;
  const countries = db.all('SELECT code, name FROM countries WHERE region=? COLLATE NOCASE ORDER BY name', [name]);
  const canonical = CANONICAL_BASE + '/region/' + encodeURIComponent(regionName);
  const latest = db.all(
    "SELECT a.slug,a.title,a.image,a.category,a.source_name,a.published_at FROM articles a JOIN countries c ON c.code=a.country_code WHERE a.status='published' AND a.guid NOT LIKE 'shop-daily:%' AND c.region=? COLLATE NOCASE ORDER BY a.published_at DESC LIMIT 30",
    [name]
  );
  let body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › <a href="/world">World</a> › ' + esc(regionName) + '</nav>' +
    '<h1 class="page-title">News &amp; Marketplace — ' + esc(regionName) + '</h1>' +
    '<p class="muted">Live headlines and daily Weverse product updates from every country in ' + esc(regionName) + '.</p>';
  body += '<div class="chiprow">' + countries.map(c =>
    '<a class="chip" href="/country/' + c.code + '">' + esc(c.name) + ' <span class="cat-tag">' + c.code + '</span></a>'
  ).join('') + '<a class="chip" href="/map">🗺 All countries</a></div>';
  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No news stories published yet for this region.</p>';
  }
  res.type('html').send(ssr.layout({
    title: regionName + ' News',
    description: 'Live news from every country in ' + regionName + ' and daily Weverse Online Shop product updates for the region.',
    canonical,
    jsonld: [
      ssr.collectionPageJson(regionName + ' News', canonical),
      ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'World', url: '/world' }, { name: regionName, url: '/region/' + encodeURIComponent(regionName) }])
    ],
    bodyHtml: body
  }));
});

// ---------- Location page (country coordinates / geo discovery) ----------

router.get('/location/:code', (req, res) => {
  const code = String(req.params.code).toUpperCase().slice(0, 3);
  const c = db.get('SELECT code, name, lat, lng, region, subregion FROM countries WHERE code=?', [code]);
  if (!c) return ssr.notFoundPage(res, 'Unknown location.');
  const canonical = CANONICAL_BASE + '/location/' + c.code;
  const latest = db.all(
    "SELECT slug,title,image,category,source_name,published_at FROM articles WHERE status='published' AND country_code=? AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 30",
    [code]
  );
  let body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › <a href="/map">World</a> › <a href="/country/' + c.code + '">' + esc(c.name) + '</a> › Location</nav>' +
    '<h1 class="page-title">Location: ' + esc(c.name) + '</h1>';
  body += '<div class="card"><h3>Geographic location</h3><p class="muted">' + esc(c.name) + ' — ' + esc(c.region || '') + (c.subregion ? ', ' + esc(c.subregion) : '') + '</p>' +
    '<p>Coordinates: <strong>' + (c.lat !== null && c.lat !== undefined ? c.lat : 'n/a') + ', ' + (c.lng !== null && c.lng !== undefined ? c.lng : 'n/a') + '</strong></p>' +
    '<p><a class="btn btn-secondary" href="/map">Open world map</a> <a class="btn btn-secondary" href="/country/' + c.code + '">' + esc(c.name) + ' news hub</a></p></div>';
  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No news stories published yet for this location.</p>';
  }
  const placeLd = {
    '@context': 'https://schema.org', '@type': 'Place',
    name: c.name,
    url: canonical,
    latitude: c.lat, longitude: c.lng,
    address: { '@type': 'PostalAddress', addressCountry: c.code, addressRegion: c.region }
  };
  res.type('html').send(ssr.layout({
    title: 'Location: ' + c.name,
    description: 'Geographic location page for ' + c.name + ' — coordinates, region and the latest news from this country.',
    canonical,
    jsonld: [placeLd, ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'Map', url: '/map' }, { name: c.name, url: '/location/' + c.code }])],
    bodyHtml: body
  }));
});

// ---------- Hub pages: world / map / latest / breaking / legal ----------

function worldBody(res) {
  const regions = db.all('SELECT DISTINCT region FROM countries WHERE region IS NOT NULL ORDER BY region');
  const countries = db.all('SELECT code, name FROM countries ORDER BY name');
  const latest = db.all(
    "SELECT slug,title,image,category,source_name FROM articles WHERE status='published' AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 24"
  );
  let body = '<nav class="seo-crumbs"><a href="/">Home</a> › World</nav>' +
    '<h1 class="page-title">World News</h1>' +
    '<p class="muted">Headlines from every country in the world, organized by region — plus the Weverse Online Shop daily product updates for every country.</p>';
  body += '<div class="chiprow">' + regions.map(r =>
    '<a class="chip" href="/region/' + encodeURIComponent(r.region) + '">' + esc(r.region) + '</a>'
  ).join('') + '<a class="chip" href="/map">🗺 Map of all countries</a></div>';
  body += '<div class="grid">' + latest.map(r =>
    '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
    '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
  ).join('') + '</div>';
  return { body, title: 'World News', desc: 'World news from every country: latest global headlines by region and country.' };
}

router.get('/world', (req, res) => {
  const w = worldBody();
  res.type('html').send(ssr.layout({
    title: w.title, description: w.desc, canonical: CANONICAL_BASE + '/world',
    jsonld: [ssr.collectionPageJson('World News', CANONICAL_BASE + '/world'), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'World', url: '/world' }])],
    bodyHtml: w.body
  }));
});

router.get('/map', (req, res) => {
  const regions = db.all('SELECT DISTINCT region FROM countries WHERE region IS NOT NULL ORDER BY region');
  const canonical = CANONICAL_BASE + '/map';
  let body = '<nav class="seo-crumbs"><a href="/">Home</a> › Map</nav>' +
    '<h1 class="page-title">World Map of News</h1>' +
    '<p class="muted">Every country on the map links to its live news feed and daily Weverse product update.</p>';
  for (const r of regions) {
    const inRegion = db.all('SELECT code, name FROM countries WHERE region=? ORDER BY name', [r.region]);
    body += '<h2>' + esc(r.region) + '</h2><div class="chiprow">' + inRegion.map(c =>
      '<a class="chip" href="/country/' + c.code + '"><span class="flag-placeholder">' + c.code + '</span> ' + esc(c.name) + '</a>'
    ).join('') + '</div>';
  }
  body += '<p class="muted">Browse <a href="/region/Asia">regional news</a>, <a href="/world">world news</a> or the <a href="/shop">Weverse shop</a>.</p>';
  res.type('html').send(ssr.layout({
    title: 'World Map of News',
    description: 'Interactive world map of news from every country: click any country for its live headlines and daily product update.',
    canonical,
    jsonld: [ssr.collectionPageJson('World Map of News', canonical), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'Map', url: '/map' }])],
    bodyHtml: body
  }));
});

router.get('/subregion/:slug', (req, res) => {
  const wanted = String(req.params.slug);
  const sub = subregionSlugs().find(r => r.slug === wanted);
  if (!sub) return ssr.notFoundPage(res, 'Unknown subregion.');
  const canonical = CANONICAL_BASE + '/subregion/' + sub.slug;
  const countries = db.all('SELECT code, name FROM countries WHERE subregion=? ORDER BY name', [sub.name]);
  const latest = db.all(
    "SELECT a.slug,a.title,a.image,a.category,a.source_name,a.published_at FROM articles a JOIN countries c ON c.code=a.country_code WHERE a.status='published' AND c.subregion=? AND (a.guid IS NULL OR a.guid NOT LIKE 'shop-daily:%') ORDER BY a.published_at DESC LIMIT 30",
    [sub.name]
  );
  let body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › <a href="/world">World</a> › <a href="/map">Map</a> › ' + esc(sub.name) + '</nav>' +
    '<h1 class="page-title">' + esc(sub.name) + ' News</h1>' +
    '<p class="muted">Live headlines from every country in ' + esc(sub.name) + ', plus the daily Weverse Online Shop product updates for the region.</p>';
  body += '<div class="chiprow">' + countries.map(c =>
    '<a class="chip" href="/country/' + c.code + '">' + esc(c.name) + ' <span class="cat-tag">' + c.code + '</span></a>'
  ).join('') + '<a class="chip" href="/map">🗺 All countries</a></div>';
  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No news stories published yet for this subregion.</p>';
  }
  res.type('html').send(ssr.layout({
    title: sub.name + ' News',
    description: 'Live news from every country in ' + sub.name + ' and daily Weverse Online Shop product updates for the region.',
    canonical,
    jsonld: [ssr.collectionPageJson(sub.name + ' News', canonical), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'World', url: '/world' }, { name: sub.name, url: '/subregion/' + sub.slug }])],
    bodyHtml: body
  }));
});

router.get('/source/:slug', (req, res) => {
  const wanted = String(req.params.slug);
  const sources = sourceSlugs();
  const name = sources[wanted];
  if (!name) return ssr.notFoundPage(res, 'Unknown source.');
  const canonical = CANONICAL_BASE + '/source/' + wanted;
  const latest = db.all("SELECT slug,title,image,category,source_name,published_at FROM articles WHERE status='published' AND source_name=? ORDER BY published_at DESC LIMIT 48", [name]);
  let body =
    '<nav class="seo-crumbs"><a href="/">Home</a> › <a href="/world">World</a> › Sources › ' + esc(name) + '</nav>' +
    '<h1 class="page-title">' + esc(name) + ' News</h1>' +
    '<p class="muted">Latest stories syndicated from ' + esc(name) + ', published on WorldFront.News. All content belongs to the original publisher.</p>';
  if (latest.length) {
    body += '<div class="grid">' + latest.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span> · ' + esc(ssr.fmtDate(r.published_at)) + '</div></div></article>'
    ).join('') + '</div>';
  } else {
    body += '<p class="muted">No stories published yet from this source.</p>';
  }
  res.type('html').send(ssr.layout({
    title: name + ' News',
    description: 'Latest ' + name + ' news stories syndicated on WorldFront.News.',
    canonical,
    jsonld: [ssr.collectionPageJson(name + ' News', canonical), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'World', url: '/world' }, { name: name, url: '/source/' + wanted }])],
    bodyHtml: body
  }));
});

router.get('/latest', (req, res) => {
  const rows = db.all("SELECT slug,title,image,category,source_name,published_at FROM articles WHERE status='published' AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 24");
  const canonical = CANONICAL_BASE + '/latest';
  let body = '<nav class="seo-crumbs"><a href="/">Home</a> › Latest</nav><h1 class="page-title">Latest News</h1><div class="grid">' +
    rows.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">' + esc(r.category || '') + '</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span> · ' + esc(ssr.fmtDate(r.published_at)) + '</div></div></article>'
    ).join('') + '</div>';
  res.type('html').send(ssr.layout({
    title: 'Latest News',
    description: 'The latest news from around the world, freshly aggregated by WorldFront.News.',
    canonical,
    jsonld: [ssr.collectionPageJson('Latest News', canonical), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'Latest', url: '/latest' }])],
    bodyHtml: body
  }));
});

router.get('/breaking', (req, res) => {
  const canonical = CANONICAL_BASE + '/breaking';
  let rows = db.all("SELECT slug,title,image,source_name,published_at FROM articles WHERE status='published' AND breaking=1 ORDER BY published_at DESC LIMIT 20");
  if (!rows.length) rows = db.all("SELECT slug,title,image,source_name,published_at FROM articles WHERE status='published' AND guid NOT LIKE 'shop-daily:%' ORDER BY published_at DESC LIMIT 20");
  let body = '<nav class="seo-crumbs"><a href="/">Home</a> › Breaking</nav><h1 class="page-title">Breaking News</h1><div class="grid">' +
    rows.map(r =>
      '<article class="article-card"><a class="thumb" href="/article/' + esc(r.slug) + '">' + articleThumb(r) + '<span class="cat-tag">Latest</span></a>' +
      '<div class="card-body"><h3><a href="/article/' + esc(r.slug) + '">' + esc(r.title) + '</a></h3><div class="card-meta"><span class="src">' + esc(r.source_name) + '</span></div></div></article>'
    ).join('') + '</div>';
  res.type('html').send(ssr.layout({
    title: 'Breaking News',
    description: 'Breaking and top news stories from around the world as they are published.',
    canonical,
    jsonld: [ssr.collectionPageJson('Breaking News', canonical), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: 'Breaking', url: '/breaking' }])],
    bodyHtml: body
  }));
});

function staticPage(route, heading, paragraphs, extra) {
  router.get(route, (req, res) => {
    const canonical = CANONICAL_BASE + route;
    let body = '<nav class="seo-crumbs"><a href="/">Home</a> › ' + heading + '</nav><h1 class="page-title">' + heading + '</h1>';
    for (const p of paragraphs) body += '<p>' + p + '</p>';
    if (extra) body += extra;
    res.type('html').send(ssr.layout({
      title: heading, description: heading + ' on WorldFront.News.', canonical,
      jsonld: [ssr.orgJson(), ssr.breadcrumbJson([{ name: 'Home', url: '/' }, { name: heading, url: route }])],
      bodyHtml: body
    }));
  });
}
staticPage('/about', 'About WorldFront.News', [
  'WorldFront.News is a global news platform that aggregates trusted headlines from established news organizations around the world and organizes them by country, region, category and location. Every story includes a link to the original publisher (the copyright owner).',
  'In addition to world news, WorldFront.News publishes the Weverse Online Shop daily product update for every country, so readers see what is available in the shop around the world.'
]);
staticPage('/privacy', 'Privacy Policy', [
  'WorldFront.News collects no personal data beyond what you explicitly provide to the account feature. We do not sell or share personal information.',
  'We use cookies only for authentication on the members area. External content referenced on the site belongs to its original publishers.'
]);
staticPage('/terms', 'Terms of Service', [
  'WorldFront.News aggregates headlines and brief summaries from external sources. All copyrighted content belongs to its original publishers.',
  'The Weverse Online Shop offers its catalogue through official, read-only integration. Purchases take place on the shop\u2019s own website. We give no warranties regarding third-party content.'
]);

// ---------------------------------------------------------------------------
// PROPERTY PAGES + PROGRAMMATIC LOCATION LANDING PAGES
// ---------------------------------------------------------------------------
//
// Every house/car/product keeps its existing canonical page (nothing broken).
// Real-estate listings additionally render a RealEstateListing JSON-LD schema
// built purely from the actual property record, and all media is tagged with
// automatically-generated alt text derived from the real listing.
//
// Location landing pages live at:
//   /property/[country]/[state]/[city]/[neighborhood]
// They are only created for locations that:
//   * exist in the geo_locations database (real records), AND
//   * have real property content under them.
// No fake or empty location pages are ever generated.
// ---------------------------------------------------------------------------

function propertyRecord(p) {
  if (!p || p.listing_id == null) return null;
  const pid = String(p.property_id || p.listing_id);
  const detail = db.get('SELECT * FROM property_details WHERE property_id=?', [pid]) ||
    db.get('SELECT * FROM property_details WHERE listing_id=?', [p.listing_id]);
  return { ...p, ...(detail || {}) };
}

// Card renderer that uses real property media + SEO alt text.
function propertyCard(p, opts) {
  const merged = propertyRecord(p);
  const px = ssr.fmtPrice(merged.price, merged.currency);
  const title = esc(merged.title || 'Property');
  const href = esc('/shop/product/' + encodeURIComponent(merged.property_id || merged.listing_id));
  const short = (merged.description || '').slice(0, 140);
  const isVid = propSeo.isVideo(merged.video || merged.thumbnail);
  const media = isVid
    ? '<video class="thumb-video" src="' + esc(merged.video) + '" autoplay muted loop playsinline preload="metadata" onerror="this.style.display=\'none\'"></video>'
    : (merged.thumbnail && /^https?:/.test(merged.thumbnail)
        ? '<img loading="lazy" src="' + esc(merged.thumbnail) + '" alt="' + esc(propSeo.generatedAltText(merged)) + '" />'
        : '<span class="thumb-fallback"></span>');
  const locLabel = loc && loc.displayAddress ? loc.displayAddress(merged) : '';
  return '<article class="article-card product-card' + (opts && opts.featured ? ' featured-card' : '') + '">' +
    '<a class="thumb" href="' + href + '" title="' + title + '">' + media +
      '<span class="cat-tag">' + esc(merged.category || 'property') + '</span>' +
      (opts && opts.featured ? '<span class="featured-ribbon">★ Featured</span>' : '') + '</a>' +
    '<div class="card-body"><h3><a href="' + href + '">' + title + '</a></h3>' +
      (short ? '<p class="card-summary">' + esc(short) + '</p>' : '') +
      (locLabel ? '<p class="card-location">📍 ' + esc(locLabel) + '</p>' : '') +
      '<div class="card-meta"><span class="src">' + esc(merged.brand || 'Weverse Shop') + '</span><span>·</span>' +
      '<span class="product-price">' + esc(px) + '</span></div>' +
    '</div></article>';
}

// ---- Programmatic location landing pages ----
function resolveLocationPath(segments) {
  const cleanSeg = String(segments || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!cleanSeg.length) return null;

  // First segment must resolve to a real country in geo_locations.
  let cur = db.get(
    "SELECT * FROM geo_locations WHERE type='country' AND (slug=? OR slug LIKE ?) LIMIT 1",
    [cleanSeg[0], cleanSeg[0] + '%']
  );
  if (!cur) {
    // fallback: country code or plain name slug (yields the geo_country row).
    cur = db.get(
      'SELECT g.* FROM geo_locations g JOIN countries c ON c.code=g.country_code WHERE g.type="country" AND (c.code=? COLLATE NOCASE OR c.name=? COLLATE NOCASE) LIMIT 1',
      [cleanSeg[0], cleanSeg[0]]
    );
    if (!cur) return null;
  }
  const chain = [cur];
  for (let i = 1; i < cleanSeg.length; i++) {
    const next = db.get(
      'SELECT * FROM geo_locations WHERE parent_id=? AND (slug=? OR slug LIKE ?) LIMIT 1',
      [cur.id, cleanSeg[i], cleanSeg[i] + '%']
    );
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  return { chain, leaf: cur };
}

function locationProperties(leaf) {
  // Real properties connected to this location or any of its descendants.
  const ids = new Set([leaf.id]);
  const parents = [leaf.id];
  while (parents.length) {
    const next = db.all(
      'SELECT id FROM geo_locations WHERE parent_id IN (' + parents.map(() => '?').join(',') + ')',
      parents
    );
    parents.length = 0;
    for (const r of next) {
      ids.add(r.id);
      parents.push(r.id);
    }
  }
  const placeholders = Array.from(ids).map(() => '?');
  if (!placeholders.length) return [];
  const links = db.all(
    "SELECT listing_id FROM listing_locations WHERE relation='primary' AND location_id IN (" + placeholders.join(',') + ') GROUP BY listing_id',
    Array.from(ids)
  );
  const listings = links.map((l) => l.listing_id);
  if (!listings.length) return [];
  const rows = db.all(
    'SELECT * FROM shop_products WHERE published=1 AND listing_id IN (' + listings.map(() => '?').join(',') + ') ORDER BY updated_at DESC',
    listings
  );
  // Only housing + vehicles that genuinely carry this location.
  return rows.filter((p) => propSeo.isHousing(p) || /(cars|vehicles|trucks|motorcycles|motorhomes|automobiles)/i.test(String(p.category || '')));
}

function locationTitle(name, count, cc) {
  const country = db.get('SELECT name FROM countries WHERE code=?', [cc]);
  const simple = /^(state|province|region|county|country)$/i.test(name.type) ? name.name : name.name;
  const base = 'Houses for Sale in ' + simple;
  return count > 0 ? base : base;
}

function renderLocationPage(res, chain) {
  const leaf = chain[chain.length - 1];
  const country = chain.find((l) => l.type === 'country');
  const props = locationProperties(leaf);
  const pagePath = chain.map((l) => loc.slugify(l.name)).join('/');
  const canonical = CANONICAL_BASE + '/property/' + pagePath;
  const cc = country ? country.country_code : leaf.country_code;
  const countryName = country ? country.name : cc;

  const crumbs = '<a href="/">Home</a> › <a href="/map">World</a> › ' +
    (country ? '<a href="/country/' + cc + '">' + esc(country.name) + '</a> › ' : '') +
    chain.filter((l) => l.type !== 'country').map((l) => esc(l.name)).join(' › ');

  // Breadcrumb data for structured data + display.
  const crumbItems = [{ name: 'Home', url: '/' }, { name: 'World', url: '/map' }];
  let crumbPath = '';
  for (const l of chain) {
    crumbPath += '/' + loc.slugify(l.name);
    crumbItems.push({ name: l.name, url: '/property' + crumbPath });
  }

  const h1 = 'Houses for Sale in ' + leaf.name +
    (chain.filter((l) => l.type !== 'country').length > 1 ? ', ' + chain.filter((l) => l.type !== 'country' && l.id !== leaf.id).map((l) => l.name).join(', ') : '');
  const title = h1 + (countryName !== leaf.name ? ', ' + countryName : '');

  let body =
    '<nav class="seo-crumbs">' + crumbs + '</nav>' +
    '<h1 class="page-title">' + esc(h1) + '</h1>' +
    '<p class="muted">' + esc(props.length) + ' propert' + (props.length === 1 ? 'y' : 'ies') +
    ' for sale in ' + esc(leaf.name) + (country && country.name !== leaf.name ? ', ' + esc(country.name) : '') + '.</p>';

  // Location facts (real values only).
  body += '<div class="card" style="margin-bottom:18px"><h3>📍 ' + esc(leaf.name) + '</h3><p class="muted">' +
    chain.map((l) => esc(l.name)).join(' → ') + '</p>';
  if (leaf.lat != null && leaf.lng != null) {
    body += '<p>Coordinates: <strong>' + leaf.lat + ', ' + leaf.lng + '</strong></p>' +
      '<p><a class="btn btn-secondary btn-sm" href="/map#lat=' + leaf.lat + '&lng=' + leaf.lng + '">Open on map</a></p>';
  }
  body += '</div>';

  if (props.length) {
    body += '<div class="grid">' + props.slice(0, 24).map((p) => propertyCard(p)).join('') + '</div>';
  } else {
    body += '<p class="muted">There are currently no live property listings at this exact location.</p>' +
      '<p><a class="btn btn-outline" href="/shop">Browse all shop listings</a> ' +
      '<a class="btn btn-outline" href="/map">Explore the world map</a></p>';
  }

  // Related real locations (parents + children with content).
  const related = [];
  if (chain.length > 1) related.push(chain[chain.length - 2]);
  const children = db.all('SELECT * FROM geo_locations WHERE parent_id=? AND status=\'approved\' ORDER BY name', [leaf.id]);
  for (const c of children) if (c.type !== 'street' && c.type !== 'landmark') related.push(c);
  if (related.length) {
    body += '<h2 style="margin-top:28px">Explore nearby locations</h2><div class="chip-row">' +
      related.filter((r) => r && r.id !== leaf.id).slice(0, 30).map((r) =>
        (function() {
          const p = chainForId(r.id);
          return '<a class="chip" href="/' + (p ? 'property/' + p : 'map') + '">' + esc(r.name) + '</a>';
        })()
      ).join('') + '</div>';
  }

  const jsonld = [
    ssr.collectionPageJson(h1, canonical),
    ssr.breadcrumbJson(crumbItems)
  ];
  if (leaf.lat != null && leaf.lng != null) {
    jsonld.push({
      '@context': 'https://schema.org', '@type': 'Place',
      name: leaf.name, url: canonical,
      address: { '@type': 'PostalAddress', addressLocality: leaf.name, addressCountry: cc },
      geo: { '@type': 'GeoCoordinates', latitude: leaf.lat, longitude: leaf.lng }
    });
  }

  res.type('html').send(ssr.layout({
    title,
    description: 'Houses for sale in ' + leaf.name + ', ' + (countryName !== leaf.name ? countryName + ' — ' : '') + props.length + ' propert' + (props.length === 1 ? 'y' : 'ies') + ' currently available.',
    canonical,
    og: { title, type: 'website' },
    jsonld,
    bodyHtml: body
  }));
}

function chainForId(id) {
  let cur = db.get('SELECT * FROM geo_locations WHERE id=?', [id]);
  if (!cur) return null;
  const chain = [];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    if (cur.parent_id) cur = db.get('SELECT * FROM geo_locations WHERE id=?', [cur.parent_id]);
    else cur = null;
  }
  const ci = chain.findIndex((l) => l.type === 'country');
  if (ci === -1) return null;
  return chain.slice(ci).map((l) => loc.slugify(l.name)).join('/');
}

// /property/[country]/[state]/[city]/[neighborhood] (and all sub-paths)
router.get(['/property/:a/:b/:c/:d', '/property/:a/:b/:c', '/property/:a/:b', '/property/:a'], (req, res) => {
  const parts = [req.params.a, req.params.b, req.params.c, req.params.d].filter(Boolean);
  if (!parts.length) return ssr.notFoundPage(res, 'No location specified.');
  const resolved = resolveLocationPath(parts.join('/'));
  if (!resolved || !resolved.leaf) return ssr.notFoundPage(res, 'That location is not available.');
  renderLocationPage(res, resolved.chain);
});

// ---- Enhanced property display page (existing /shop/product/:id URL kept) ----
// Real-estate listings always render RealEstateListing JSON-LD and images with
// generated SEO alt text derived from the actual record. The enhancement is
// implemented inside the /shop/product/:id route above; this marker documents
// the guarantee that no fake or unrelated media is ever shown.

// ---------- robots + sitemaps ----------

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /api\n' +
    'Disallow: /account\n' +
    'Disallow: /saved\n' +
    'Disallow: /#/\n' +
    '\n' +
    '# Search-visible sitemaps (index) and child sitemaps are served from:\n' +
    '# /sitemap.xml and /sitemaps/{name}.xml\n' +
    'Sitemap: ' + CANONICAL_BASE + '/sitemap.xml\n'
  );
});

// Google Search Console file-token verification: serves /google/<token>.html
// exactly as Google requires it when the admin verifies by file upload.
router.get('/google/:token.html', (req, res) => {
  const expected = process.env.GOOGLE_SITE_VERIFICATION;
  const body = String(req.params.token).trim();
  if (!expected || body !== expected) return ssr.notFoundPage(res, 'Verification token not found.');
  res.type('text/html').send('google-site-verification: google' + body + '.html\n');
});

function urlXml(path, lastmod) {
  return '<url><loc>' + CANONICAL_BASE + path + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + '</url>';
}

const regionSlug = (region) => String(region || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Unique slug per distinct article source (avoids collisions after slugifying).
function sourceSlugs() {
  const rows = db.all("SELECT DISTINCT source_name FROM articles WHERE status='published' AND source_name IS NOT NULL AND source_name != '' ORDER BY source_name");
  const buckets = {};
  for (const r of rows) {
    if (r.source_name === 'Weverse Shop') continue; // shop-daily feed: article URLs 301 to editions
    const base = regionSlug(r.source_name);
    (buckets[base] = buckets[base] || []).push(r.source_name);
  }
  const map = {};
  for (const base in buckets) {
    buckets[base].forEach((nm, i) => {
      map[i ? base + '-' + (i + 1) : base] = nm;
    });
  }
  return map;
}

function subregionSlugs() {
  return db.all('SELECT DISTINCT subregion FROM countries WHERE subregion IS NOT NULL ORDER BY subregion').map(r => ({ name: r.subregion, slug: regionSlug(r.subregion) }));
}

router.get('/sitemap.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const files = [
    { name: 'home', lastmod: today },
    { name: 'products', lastmod: today },
    { name: 'editions', lastmod: today },
    { name: 'articles', lastmod: today },
    { name: 'countries', lastmod: today },
    { name: 'categories', lastmod: today },
    { name: 'locations', lastmod: today }
  ];
  const catRows = db.all('SELECT slug FROM categories WHERE active=1 ORDER BY slug');
  for (const c of catRows) files.push({ name: 'category-' + c.slug, lastmod: today });
  const ccRows = db.all('SELECT code FROM countries ORDER BY code');
  for (const c of ccRows) files.push({ name: 'country-' + c.code, lastmod: today });
  const regionRows = db.all('SELECT DISTINCT region FROM countries WHERE region IS NOT NULL ORDER BY region');
  for (const r of regionRows) files.push({ name: 'region-' + regionSlug(r.region), lastmod: today });
  for (const sub of subregionSlugs()) files.push({ name: 'subregion-' + sub.slug, lastmod: today });
  for (const slug in sourceSlugs()) files.push({ name: 'source-' + slug, lastmod: today });
  const shopCats = db.all("SELECT category, COUNT(*) n FROM shop_products WHERE published=1 AND category IS NOT NULL AND category != '' GROUP BY category ORDER BY category");
  for (const p of shopCats) files.push({ name: 'shop-' + regionSlug(p.category), lastmod: today });
  // Per-country location landing sitemaps (only for countries with real locations)
  const locCountries = db.all("SELECT DISTINCT country_code FROM geo_locations WHERE type IN ('state','city','town','village','district','county') AND country_code IS NOT NULL");
  for (const c of locCountries) files.push({ name: 'loc-' + c.country_code, lastmod: today });
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const f of files) xml += '  <sitemap><loc>' + CANONICAL_BASE + '/sitemaps/' + f.name + '.xml</loc><lastmod>' + f.lastmod + '</lastmod></sitemap>\n';
  xml += '</sitemapindex>';
  res.type('application/xml').send(xml);
});

// Build a property's real image list (absolute URLs only) for image sitemaps.
function propertyImageSitemapEntries(p) {
  const merged = { ...p };
  const detail = db.get('SELECT * FROM property_details WHERE property_id=? OR listing_id=?', [p.property_id, p.listing_id]);
  if (detail) Object.assign(merged, detail);
  const urls = propSeo.imageList(merged).filter((u) => /^https?:\/\//.test(u) && !propSeo.isVideo(u));
  if (!urls.length && /^https?:\/\//.test(p.thumbnail || '') && !propSeo.isVideo(p.thumbnail)) urls.push(p.thumbnail);
  const out = urls.slice(0, 10).map((u) =>
    '<image:image><image:loc>' + esc(u) + '</image:loc>' +
    (merged.title ? '<image:title>' + esc(merged.title) + '</image:title>' : '') +
    '<image:caption>' + esc(propSeo.generatedCaption(merged)) + '</image:caption>' +
    '</image:image>'
  );
  return out;
}

router.get('/sitemaps/:name.xml', (req, res) => {
  const name = String(req.params.name);
  const withImages = /(products|shop-)/.test(name);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
    (withImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '') + '>\n';
  const iso = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const seen = new Set();
  const addUniq = (path, lm, extra) => {
    if (seen.has(path)) return;
    seen.add(path);
    xml += '  ' + urlXml(path, lm) + (extra || '');
  };

  // Helper: canonical page path for an approved geo location that has content.
  const locPagePath = (l) => {
    const chain = [];
    let cur = l;
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift(cur);
      if (cur.parent_id) cur = db.get('SELECT * FROM geo_locations WHERE id=?', [cur.parent_id]);
      else cur = null;
    }
    const ci = chain.findIndex((x) => x.type === 'country');
    if (ci === -1) return null;
    return '/property/' + chain.slice(ci).map((x) => loc.slugify(x.name)).join('/');
  };

  // Helper: a location landing page only counts when real property content exists.
  const locHasContent = (l) => loc.hasContent(l);

  if (name === 'home') {
    for (const p of ['/', '/shop', '/latest', '/world', '/breaking', '/map', '/about', '/privacy', '/terms']) {
      xml += '  ' + urlXml(p) + '\n';
    }
  } else if (name === 'products') {
    const rows = db.all('SELECT * FROM shop_products WHERE published=1 ORDER BY updated_at DESC');
    for (const p of rows) {
      const path = '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id);
      xml += '  ' + urlXml(path, iso(p.updated_at));
      xml += propertyImageSitemapEntries(p).join('');
      xml += '\n';
    }
  } else if (name === 'editions') {
    const rows = db.all('SELECT country_code, pub_date FROM shop_publication_days ORDER BY pub_date DESC, country_code');
    for (const e of rows) {
      xml += '  ' + urlXml('/shop/daily/' + e.country_code + '/' + e.pub_date, e.pub_date) + '\n';
    }
  } else if (name === 'articles') {
    const rows = db.all("SELECT slug, published_at FROM articles WHERE status='published' AND (guid IS NULL OR guid NOT LIKE 'shop-daily:%') ORDER BY published_at DESC");
    for (const a of rows) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
  } else if (name === 'countries') {
    const rows = db.all('SELECT code FROM countries ORDER BY code');
    for (const c of rows) xml += '  ' + urlXml('/country/' + c.code) + '\n';
  } else if (name === 'categories') {
    const rows = db.all('SELECT slug FROM categories WHERE active=1 ORDER BY slug');
    for (const c of rows) xml += '  ' + urlXml('/category/' + c.slug) + '\n';
  } else if (name === 'locations') {
    // All real location landing pages that have live property content.
    const locs = db.all("SELECT * FROM geo_locations WHERE status='approved' AND type IN ('state','province','county','region','city','town','village','district','ward') ORDER BY country_code, type, name");
    for (const l of locs) {
      if (!locHasContent(l)) continue;
      const path = locPagePath(l);
      if (path) addUniq(path, l.updated_at);
    }
  } else if (/^loc-[A-Z]{2}$/.test(name)) {
    const cc = name.slice(4);
    const locs = db.all("SELECT * FROM geo_locations WHERE status='approved' AND country_code=? AND type IN ('state','province','county','region','city','town','village','district','ward') ORDER BY type, name", [cc]);
    for (const l of locs) {
      if (!locHasContent(l)) continue;
      const path = locPagePath(l);
      if (path) addUniq(path, l.updated_at);
    }
  } else if (/^country-[A-Z]{2}$/.test(name)) {
    const cc = name.slice(8);
    const loc = db.get('SELECT code FROM countries WHERE code=?', [cc]);
    if (!loc) return ssr.notFoundPage(res, 'Unknown country sitemap.');
    addUniq('/location/' + cc);
    const arts = db.all("SELECT slug, published_at FROM articles WHERE status='published' AND country_code=? AND (guid IS NULL OR guid NOT LIKE 'shop-daily:%') ORDER BY published_at DESC", [cc]);
    for (const a of arts) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
    const eds = db.all('SELECT pub_date FROM shop_publication_days WHERE country_code=? ORDER BY pub_date DESC', [cc]);
    for (const e of eds) addUniq('/shop/daily/' + cc + '/' + e.pub_date, e.pub_date);
    // Country location landing page too.
    const locs = db.all("SELECT * FROM geo_locations WHERE status='approved' AND country_code=? AND type IN ('state','province','county','region','city','town','village','district','ward')", [cc]);
    for (const l of locs) {
      if (!locHasContent(l)) continue;
      const path = locPagePath(l);
      if (path) addUniq(path, l.updated_at);
    }
  } else if (/^region-/.test(name)) {
    const wanted = name.slice(7);
    const regionRows = db.all('SELECT DISTINCT region FROM countries WHERE region IS NOT NULL');
    const regionName = regionRows.find(r => regionSlug(r.region) === wanted);
    if (!regionName) return ssr.notFoundPage(res, 'Unknown region sitemap.');
    addUniq('/region/' + encodeURIComponent(regionName.region));
    const arts = db.all(
      "SELECT a.slug, a.published_at FROM articles a JOIN countries c ON c.code=a.country_code WHERE a.status='published' AND c.region=? COLLATE NOCASE AND (a.guid IS NULL OR a.guid NOT LIKE 'shop-daily:%') ORDER BY a.published_at DESC LIMIT 1000",
      [regionName.region]
    );
    for (const a of arts) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
  } else if (/^category-/.test(name)) {
    const slug = name.slice(9);
    const cat = db.get('SELECT slug, name FROM categories WHERE slug=? AND active=1', [slug]);
    if (!cat) return ssr.notFoundPage(res, 'Unknown category sitemap.');
    addUniq('/category/' + cat.slug);
    const arts = db.all("SELECT slug, published_at FROM articles WHERE status='published' AND category=? AND (guid IS NULL OR guid NOT LIKE 'shop-daily:%') ORDER BY published_at DESC LIMIT 1000", [cat.slug]);
    for (const a of arts) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
  } else if (/^subregion-/.test(name)) {
    const wanted = name.slice(10);
    const sub = subregionSlugs().find(r => r.slug === wanted);
    if (!sub) return ssr.notFoundPage(res, 'Unknown subregion sitemap.');
    addUniq('/subregion/' + sub.slug);
    const arts = db.all(
      "SELECT a.slug, a.published_at FROM articles a JOIN countries c ON c.code=a.country_code WHERE a.status='published' AND c.subregion=? AND (a.guid IS NULL OR a.guid NOT LIKE 'shop-daily:%') ORDER BY a.published_at DESC LIMIT 1000",
      [sub.name]
    );
    for (const a of arts) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
  } else if (/^source-/.test(name)) {
    const wanted = name.slice(7);
    const sources = sourceSlugs();
    if (!sources[wanted]) return ssr.notFoundPage(res, 'Unknown source sitemap.');
    addUniq('/source/' + wanted);
    const arts = db.all("SELECT slug, published_at FROM articles WHERE status='published' AND source_name=? ORDER BY published_at DESC LIMIT 1000", [sources[wanted]]);
    for (const a of arts) addUniq('/article/' + encodeURIComponent(a.slug), iso(a.published_at));
  } else if (/^shop-/.test(name)) {
    const wanted = name.slice(5);
    const cats = db.all('SELECT DISTINCT category FROM shop_products WHERE published=1');
    const cat = cats.find(c => regionSlug(c.category) === wanted);
    if (!cat) return ssr.notFoundPage(res, 'Unknown shop sitemap.');
    const prods = db.all('SELECT * FROM shop_products WHERE published=1 AND category=? ORDER BY updated_at DESC', [cat.category]);
    addUniq('/shop');
    for (const p of prods) {
      const path = '/shop/product/' + encodeURIComponent(p.property_id || p.listing_id);
      xml += '  ' + urlXml(path, iso(p.updated_at));
      xml += propertyImageSitemapEntries(p).join('');
      xml += '\n';
    }
  } else {
    return ssr.notFoundPage(res, 'Unknown sitemap.');
  }
  xml += '</urlset>';
  res.type('application/xml').send(xml);
});

// GSC file-verification convenience (only active when token configured).
router.get('/google/:token.html', (req, res) => {
  const expected = process.env.GOOGLE_SITE_VERIFICATION;
  if (!expected || req.params.token !== expected) return res.status(404).send('Not found');
  res.type('text/html').send('google-site-verification: ' + expected);
});

// Output RSS 2.0 feed: the site's promo channel. Aggregators, feed readers
// and RSS directories subscribe to this URL (distributed as 'discoverable').
router.get('/rss.xml', (req, res) => {
  try {
    const xml = require('../distrib/rss').buildFeed();
    res.type('application/rss+xml; charset=utf-8').send(xml);
  } catch (e) {
    res.status(500).send('RSS generation failed: ' + e.message);
  }
});

// IndexNow key-file protocol: Bing/Yandex/Seznam/Naver verifies ownership by
// fetching /<key>.txt. The key is generated once and stored in settings.
router.get('/:key.txt', (req, res) => {
  const eng = require('../distrib/engine');
  const key = eng.ensureIndexNowKey();
  if (!/^[0-9a-fA-F]{32}$/.test(req.params.key) || String(req.params.key).toLowerCase() !== key.toLowerCase()) {
    return res.status(404).type('text/plain').send('Not found');
  }
  res.type('text/plain').send(key);
});

module.exports = router;