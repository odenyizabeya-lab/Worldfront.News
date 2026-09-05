/* WorldFront.News views */
window.WF = WF || {};
WF.views = {};

function setMeta(title, desc) {
  document.title = title + ' — WorldFront.News';
  let m = document.querySelector('meta[name="description"]');
  if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
  m.content = desc;
}

function skeletonGrid(n) {
  let s = '<div class="grid">';
  for (let i = 0; i < n; i++) s += '<div class="article-card"><div class="thumb skeleton"></div><div class="card-body"><div class="skeleton" style="height:14px;width:90%"></div><div class="skeleton" style="height:12px;width:60%;margin-top:8px"></div></div></div>';
  return s + '</div>';
}

async function renderList(app, { title, desc, qs, subtitle, count }) {
  app.innerHTML = '<div class="page-title">' + (subtitle || '') + '</div><h1 class="page-title" style="margin-top:0">' + title + '</h1>' +
    (desc ? '<p class="muted">' + desc + '</p>' : '') +
    '<div id="grid">' + skeletonGrid(9) + '</div><div id="pagination" style="text-align:center;margin:20px 0"></div>';
  const grid = document.getElementById('grid');
  const pag = document.getElementById('pagination');
  try {
    const d = await WF.api('/articles' + qs);
    grid.innerHTML = d.articles.length
      ? '<div class="grid">' + d.articles.map(a => WF.articleCard(a)).join('') + '</div>'
      : '<div class="center" style="padding:30px"><p class="muted">' + (count ? 'No stories for this selection yet. The news engine is collecting real headlines from around the world — check back soon.' : 'No stories found yet.') + '</p></div>';
    if (d.totalPages > 1) {
      let html = '';
      if (d.page > 1) html += '<button class="btn btn-outline btn-sm" data-page="' + (d.page - 1) + '">← Previous</button>';
      html += '<span class="muted" style="margin:0 12px">Page ' + d.page + ' of ' + d.totalPages + '</span>';
      if (d.page < d.totalPages) html += '<button class="btn btn-outline btn-sm" data-page="' + (d.page + 1) + '">Next →</button>';
      pag.innerHTML = html;
      pag.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.page;
          const sep = qs.includes('?') ? '&' : '?';
          renderList(app, { title, desc, qs: qs + sep + 'page=' + p, subtitle, count });
        });
      });
    }
  } catch (e) {
    grid.innerHTML = '<div class="center" style="padding:30px"><p class="muted">Could not load stories. Please try again.</p></div>';
  }
}

// ---------- Home ----------
WF.views.home = async function (app) {
  setMeta('Global News Platform', 'Trusted news from every country in the world — browse by country, region and category.');
  app.innerHTML = '<div class="section-head"><h2>🌍 Top Stories</h2></div>' + skeletonGrid(3) + '<div class="spacer"></div><div id="latestSec"><div class="section-head"><h2>🕒 Latest News</h2><a class="see-all" href="/latest">See all</a></div>' + skeletonGrid(6) + '</div>';

  // Featured hero
  try {
    const featured = await WF.api('/articles/featured?limit=1');
    const heroAnchor = app.querySelector('#app') || app;
  } catch (e) {}

  // Top stories
  const grid = app.querySelector('.grid');
  try {
    const d = await WF.api('/articles?limit=6');
    if (d.articles.length) {
      const hero = d.articles[0];
      const rest = d.articles.slice(1);
      grid.outerHTML = renderHero(hero) + '<div class="grid grid-4" style="margin-top:16px">' + rest.map(a => WF.articleCard(a)).join('') + '</div>';
    } else {
      grid.outerHTML = emptyState();
    }
  } catch (e) { grid.outerHTML = emptyState(); }

  // Latest
  const latestSec = document.getElementById('latestSec');
  try {
    const d = await WF.api('/articles?limit=9&sort=published_at');
    const inner = document.getElementById('latestSec');
    if (inner) {
      const gridEl = inner.querySelector('.grid');
      if (gridEl) gridEl.outerHTML = d.articles.length ? '<div class="grid">' + d.articles.map(a => WF.articleCard(a)).join('') + '</div>' : emptyState();
    }
  } catch (e) {}

  appendCategorySections(app);
  appendShopUpdates(app);
};

function renderHero(a) {
  const img = a.image ? WF.mediaTag(a.image, '', a.title) : '';
  return '<div class="hero"><div class="hero-img">' + img + '</div><a class="hero-body" href="/article/' + WF.esc(a.slug || a.id) + '">' +
    '<span class="cat-tag">' + WF.esc(a.category || 'world') + '</span>' +
    '<h2>' + WF.esc(a.title) + '</h2><p>' + WF.esc(a.summary) + '</p>' +
    '<div class="meta">' + WF.esc(a.source_name) + ' · ' + WF.timeAgo(a.published_at) + '</div></a></div>';
}

function emptyState() {
  return '<div class="center" style="padding:40px"><h3>Welcome to WorldFront.News</h3><p class="muted">Real headlines from around the world are being collected now. Please check back in a few minutes, or try the World map below.</p><br><a class="btn btn-primary" href="/world">Browse by country</a></div>';
}

async function appendCategorySections(app) {
  try {
    const cats = await WF.api('/categories');
    const active = (cats.categories || []).filter(c => c.slug !== 'world' && c.slug !== 'breaking').slice(0, 8);
    for (const c of active) {
      const sec = document.createElement('div');
      sec.innerHTML = '<div class="section-head"><h2>' + c.icon + ' ' + WF.esc(c.name) + '</h2><a class="see-all" href="/category/' + c.slug + '">See all</a></div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">' + skeletonGrid(4) + '</div>';
      app.appendChild(sec);
      loadCategoryInto(sec.querySelector('.grid'), c.slug);
    }
  } catch (e) {}
}
async function loadCategoryInto(gridEl, slug) {
  try {
    const d = await WF.api('/articles?category=' + encodeURIComponent(slug) + '&limit=4');
    const html = d.articles.length
      ? d.articles.map(a => WF.articleCard(a, false)).join('')
      : '<div class="muted" style="grid-column:1/-1">No stories yet</div>';
    gridEl.innerHTML = d.articles.length ? '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">' + html + '</div>' : '<p class="muted">No stories yet</p>';
  } catch (e) { gridEl.innerHTML = ''; }
}

// ---------- Latest ----------
WF.views.latest = async function (app) {
  setMeta('Latest News', 'The newest headlines from around the world.');
  await renderList(app, { title: 'Latest News', qs: '?limit=24' });
};

// ---------- Breaking ----------
WF.views.breaking = async function (app) {
  setMeta('Breaking News', 'Live and urgent stories right now.');
  app.innerHTML = '<h1 class="page-title">⚡ Breaking News</h1>';
  try {
    const d = await WF.api('/articles?breaking=1&limit=20');
    app.insertAdjacentHTML('beforeend', d.articles.length
      ? '<div class="grid">' + d.articles.map(a => WF.articleCard(a, false)).join('') + '</div>'
      : '<p class="muted">No breaking stories right now. Check back soon.</p>');
  } catch (e) { app.insertAdjacentHTML('beforeend', '<p class="muted">No breaking stories right now.</p>'); }
};

// ---------- World (region index) ----------
WF.views.world = async function (app) {
  setMeta('World News by Region & Country', 'Browse trusted news from every country on Earth, grouped by region.');
  app.innerHTML = '<h1 class="page-title">🌍 World News</h1><p class="muted">Choose a country to read headlines from there.</p><div id="regions"></div>';
  const box = document.getElementById('regions');
  box.innerHTML = skeletonGrid(4);
  try {
    const d = await WF.api('/regions/countries');
    const order = {
      'Africa': 0, 'Asia': 1, 'Europe': 2, 'Americas': 3, 'Oceania': 4
    };
    const regs = Object.keys(d.grouped).sort((a, b) => (order[a] ?? 5) - (order[b] ?? 5));
    let html = '';
    for (const r of regs) {
      const list = d.grouped[r];
      html += '<div class="region-block" style="margin-bottom:26px"><h3>' + WF.esc(r) + ' <span class="muted" style="font-weight:400;font-size:.9rem">(' + list.length + ')</span></h3>' +
        '<div class="country-links">' + list.map(c => '<a href="/country/' + c.code + '">' + WF.esc(c.name) + '</a>').join('') + '</div></div>';
    }
    box.innerHTML = html || '<p class="muted">Loading countries…</p>';
  } catch (e) { box.innerHTML = '<p class="muted">Could not load regions.</p>'; }
};

// ---------- Country ----------
WF.views.country = async function (app, params) {
  const code = params.code.toUpperCase();
  const info = WF.countryMap[code];
  const name = (info && info.name) || code;
  setMeta(name + ' News', 'Latest news from ' + name + ' on WorldFront.News.');
  app.innerHTML = '<div class="country-hero"><div><h1 class="page-title" style="margin:0">' + WF.esc(name) + '</h1>' +
    '<div class="region-note">' + (info ? WF.esc(info.region) : '') + '</div></div>' +
    '<button class="btn btn-outline btn-sm" id="followC">Follow</button></div><div id="grid">' + skeletonGrid(9) + '</div>';
  document.getElementById('followC').addEventListener('click', () => followCountry(code));

  const grid = document.getElementById('grid');
  try {
    const d = await WF.api('/articles?country=' + code + '&limit=24');
    grid.innerHTML = d.articles.length
      ? '<div class="grid">' + d.articles.map(a => WF.articleCard(a)).join('') + '</div>'
      : '<div class="center" style="padding:30px"><p class="muted">No stories for ' + WF.esc(name) + ' yet. The news engine is collecting real headlines from every country — check back soon.</p><a class="btn btn-primary" href="/world">Find another country</a></div>';
  } catch (e) { grid.innerHTML = '<p class="muted">Could not load stories.</p>'; }
};

async function followCountry(code) {
  if (!WF.state.token) { WF.toast('Sign in to follow countries'); WF.router.go('/account'); return; }
  try {
    await WF.api('/follows/country', { method: 'POST', body: JSON.stringify({ country_code: code }) });
    WF.toast('Following ' + WF.countryName(code) + ' ✓');
  } catch (e) { WF.toast(e.message); }
}

// ---------- Category ----------
WF.views.category = async function (app, params) {
  const slug = params.slug;
  setMeta(slug.charAt(0).toUpperCase() + slug.slice(1) + ' News', 'Latest ' + slug + ' headlines.');
  await renderList(app, { title: slug.charAt(0).toUpperCase() + slug.slice(1), qs: '?category=' + encodeURIComponent(slug) + '&limit=24' });
};

// ---------- Region ----------
WF.views.region = async function (app, params) {
  const name = params.name;
  setMeta(name + ' Region News', 'News from the ' + name + ' region.');
  await renderList(app, { title: name + ' Region', qs: '?region=' + encodeURIComponent(name) + '&limit=24' });
};

// ---------- Map ----------
WF.views.map = async function (app) {
  setMeta('World News Map', 'Interactive map of news stories from around the world.');
  app.innerHTML = '<h1 class="page-title">🗺️ World News Map</h1><p class="muted">Stories by country. Hover a marker for the latest headline.</p>' +
    '<div class="map-container"><div class="map-canvas" id="mapCanvas"><p class="center muted" style="padding:40px">Loading map…</p></div>' +
    '<div class="map-legend"><span class="dot" style="background:#0a7ed4"></span>News story</div></div>';
  try {
    const d = await WF.api('/map');
    renderMap('mapCanvas', d.points);
  } catch (e) {
    document.getElementById('mapCanvas').innerHTML = '<p class="center muted" style="padding:40px">Map unavailable without internet. Please try again.</p>';
  }
};

function renderMap(id, points) {
  const el = document.getElementById(id);
  if (!points || !points.length) { el.innerHTML = '<p class="center muted" style="padding:40px">No map data yet.</p>'; return; }

  // Build a grouped marker set per country
  const byCountry = {};
  for (const p of points) {
    if (!byCountry[p.country_code]) byCountry[p.country_code] = { ...p, count: 0 };
    byCountry[p.country_code].count++;
    if (!byCountry[p.country_code].title && p.title) byCountry[p.country_code].title = p.title;
  }
  const markers = Object.values(byCountry).slice(0, 300);

  // Leaflet CDN
  if (!window.L) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => drawLeaflet(el, markers);
    document.head.appendChild(s);
  } else {
    drawLeaflet(el, markers);
  }
}
function drawLeaflet(el, markers) {
  el.innerHTML = '';
  const map = L.map(el).setView([20, 10], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const scale = Math.max(4, Math.min(26, markers.length / 4));
  for (const m of markers) {
    const r = 6 + Math.log2(m.count + 1) * 3;
    const c = L.circleMarker([m.lat, m.lng], {
      radius: r, color: '#0a3d7a', fillColor: '#0a7ed4', fillOpacity: 0.8, weight: 1
    });
    c.bindPopup('<b>' + WF.esc(m.country_name || m.country_code) + '</b><br>' + WF.esc((m.title || '').slice(0, 90)) + (m.count > 1 ? '<br><i>' + m.count + ' stories</i>' : ''));
    c.addTo(map);
  }
  if (markers.length) {
    const bounds = markers.map(m => [m.lat, m.lng]);
    if (bounds.length > 1) map.fitBounds(bounds, { maxZoom: 4, padding: [20, 20] });
  }
}

// ---------- Article ----------
WF.views.article = async function (app, params) {
  app.innerHTML = '<div class="article-page"><div class="skeleton" style="height:24px;width:70%"></div><div class="skeleton" style="height:200px;margin:16px 0"></div></div>';
  try {
    const d = await WF.api('/articles/' + encodeURIComponent(params.slug));
    const a = d.article;
    setMeta(a.title, (a.summary || '').slice(0, 160));
    updateSEOTags(a);

    const isDaily = a.guid && String(a.guid).indexOf('shop-daily:') === 0;
    if (isDaily) {
      await renderDailyEdition(app, a, d);
      return;
    }

    const isShop = a.category === 'shopping' || (a.guid && String(a.guid).indexOf('shop:') === 0);
    const img = a.image ? WF.mediaTag(a.image, 'article-hero-img' + (isShop ? ' is-product' : ''), a.title) : '';
    const flag = a.country_code ? WF.countryName(a.country_code) : '';
    const actionLabel = isShop ? 'View product on Weverse ↗' : 'Read original article ↗';
    const sourceNote = isShop
      ? 'This product is shown directly from the Weverse Online Shop. The "View product on Weverse" button opens the original product listing where you can view and buy the product.'
      : 'This summary is provided by WorldFront.News and links to the original article at the source publisher. We do not reproduce full copyrighted content.';
    app.innerHTML =
      '<article class="article-page">' +
      '<span class="cat-tag">' + WF.esc(a.category || 'world') + '</span>' +
      (a.breaking ? ' <span class="pill">BREAKING</span>' : '') +
      '<h1>' + WF.esc(a.title) + '</h1>' +
      '<div class="article-meta">' +
        '<span class="src">' + WF.esc(a.source_name || '') + '</span>' +
        (a.author ? '<span>by ' + WF.esc(a.author) + '</span>' : '') +
        '<span>' + WF.fmtDate(a.published_at) + '</span>' +
        (flag ? '<span>' + flag + '</span>' : '') +
      '</div>' + img +
      (a.summary ? '<p class="article-summary">' + WF.esc(a.summary) + '</p>' : '') +
      '<div class="article-actions">' +
        '<a class="btn btn-primary" href="' + WF.esc(a.link || '#') + '" target="_blank" rel="noopener nofollow">' + actionLabel + '</a>' +
        '<button class="btn btn-outline" id="shareBtn">Share</button>' +
        '<button class="btn btn-outline" id="saveBtn">Save</button>' +
        '<button class="btn btn-outline" id="followBtn">Follow ' + WF.esc(flag) + '</button>' +
      '</div>' +
      '<p class="muted" style="font-size:.85rem">' + sourceNote + '</p>' +
      '</article>';

    document.querySelector('#shareBtn').addEventListener('click', () => WF.shareArticle(a));
    document.getElementById('saveBtn').addEventListener('click', () => saveArticle(a));
    document.getElementById('followBtn').addEventListener('click', () => a.country_code && followCountry(a.country_code));

    // Related
    const rel = document.createElement('div');
    rel.className = 'related';
    rel.innerHTML = '<h3>Related stories</h3><div class="grid">' +
      (d.related && d.related.length ? d.related.map(x => WF.articleCard(x, false)).join('') : '<p class="muted">No related stories yet.</p>') +
      '</div>';
    app.appendChild(rel);
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = '<div class="center" style="padding:40px"><h3>Article not found</h3><p class="muted">' + WF.esc(e.message) + '</p><br><a class="btn btn-primary" href="/">Back to home</a></div>';
  }
};

// Daily per-country Weverse shopping edition. The edition's headline/intro/
// closing and ordered product lineup come from /api/shop/daily; every product
// references the single stored product record (id + image URL, no duplication)
// and its "View product on Weverse ↗" button opens the live shop listing.
function dailyItemCard(it, index) {
  const px = it.price ? it.currency + ' ' + Number(it.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'Price on request';
  const title = WF.esc(it.title || 'Product');
  const bid = it.property_id || (it.product_url ? it.product_url.split('id=')[1] : null) || it.listing_id;
  const internal = '/shop/product/' + WF.esc(bid);
  const url = WF.esc(it.product_url || '#');
  const img = it.image
    ? '<img loading="lazy" src="' + WF.esc(it.image) + '" alt="' + title + '" onerror="this.style.display=\'none\'">'
    : '';
  const note = it.item_text || '';
  const badge = it.featured ? '<span class="pill featured-pill">★ Featured today</span>' : '<span class="pill">#' + (index + 1) + ' of today\'s selection</span>';
  return '<article class="article-card product-card' + (it.featured ? ' featured-card' : '') + '">' +
    '<a class="thumb product-thumb" href="' + internal + '" title="' + title + '">' +
      (img || '<span class="thumb-fallback" style="background:linear-gradient(135deg,#7a1f8c,#c026d3)"><span class="thumb-fb-icon">🛍️</span><span class="thumb-fb-label">Weverse Shop</span></span>') +
      '<span class="cat-tag">' + WF.esc(it.category || 'shopping') + '</span>' +
      (it.featured ? '<span class="featured-ribbon">★ Featured</span>' : '') +
    '</a>' +
    '<div class="card-body">' +
      '<div class="card-meta">' + badge + '</div>' +
      '<h3><a href="' + internal + '">' + title + '</a></h3>' +
      (note ? '<p class="card-summary">' + WF.esc(note.slice(0, 200)) + '</p>' : '') +
      '<div class="card-meta"><span class="src">' + (it.brand ? WF.esc(it.brand) : 'Weverse Shop') + '</span>' +
        '<span>·</span><span class="product-price">' + WF.esc(px) + '</span></div>' +
      '<a class="btn btn-primary btn-sm btn-block buy-btn" href="' + internal + '">View product</a>' +
      '<a class="btn btn-outline btn-sm btn-block buy-btn" href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">View on Weverse ↗</a>' +
    '</div></article>';
}

async function renderDailyEdition(app, a, d) {
  const m = /^shop-daily:([A-Z]{2,3}):(\d{4}-\d{2}-\d{2})$/.exec(String(a.guid));
  if (!m) {
    app.innerHTML = '<div class="center" style="padding:40px"><h3>Article not found</h3><p class="muted">Sorry, this daily edition could not be loaded.</p></div>';
    return;
  }
  const country = m[1];
  const date = m[2];
  const countryName = WF.countryName(country) || country;
  let data = null;
  try {
    data = (await WF.api('/shop/daily?country=' + encodeURIComponent(country) + '&date=' + encodeURIComponent(date))).edition;
  } catch (e) { data = null; }

  const featured = data && data.items && data.items.find(i => i.featured) ? data.items.find(i => i.featured) : null;
  const items = data && data.items ? data.items : [];

  const hero = featured
    ? '<div class="daily-hero">' +
        (featured.image ? WF.mediaTag(featured.image, 'article-hero-img is-product', featured.title) : '') +
        '<span class="featured-ribbon">★ Today\'s featured product</span>' +
      '</div>'
    : '';

  const intro = data && data.intro ? data.intro
    : (a.summary ? a.summary : 'Today\'s daily shopping selection from the Weverse Online Shop for ' + countryName + '.');
  const closing = data && data.closing
    ? data.closing
    : 'This was the complete daily selection from the Weverse Online Shop. Check back tomorrow for a fresh daily edition.';

  app.innerHTML =
    '<article class="article-page">' +
      '<span class="cat-tag">shopping</span> <span class="pill">Daily product update</span>' +
      '<h1>' + WF.esc(a.title) + '</h1>' +
      '<div class="article-meta">' +
        '<span class="src">Weverse Online Shop</span>' +
        '<span>' + (data ? formatDay(date) : WF.fmtDate(a.published_at)) + '</span>' +
        '<span>' + WF.esc(countryName) + '</span>' +
        (data && data.total ? '<span>' + data.total + ' products</span>' : '') +
      '</div>' + hero +
      '<p class="article-summary">' + WF.esc(intro) + '</p>' +
      '<div class="article-actions">' +
        (featured
          ? '<a class="btn btn-primary" href="' + WF.esc(featured.product_url || '#') + '" target="_blank" rel="noopener nofollow">View product on Weverse ↗</a>'
          : '') +
        '<button class="btn btn-outline" id="shareBtn">Share</button>' +
        '<button class="btn btn-outline" id="saveBtn">Save</button>' +
        '<button class="btn btn-outline" id="followBtn">Follow ' + WF.esc(countryName) + '</button>' +
      '</div>' +
      '<div class="daily-products">' +
        (data
          ? (items.length ? '<div class="grid">' + items.map((it, i) => dailyItemCard(it, i)).join('') + '</div>'
            : '<p class="muted">This edition\'s product list has expired; the selection is republished fresh every day.</p>')
          : '<p class="muted">This edition\'s product list is no longer available. New daily editions are published every day for every country.</p>') +
      '</div>' +
      '<p class="article-summary" style="margin-top:24px">' + WF.esc(closing) + '</p>' +
    '</article>';

  const sb = document.getElementById('shareBtn');
  if (sb) sb.addEventListener('click', () => WF.shareArticle(a));
  const sv = document.getElementById('saveBtn');
  if (sv) sv.addEventListener('click', () => saveArticle(a));
  const fb = document.getElementById('followBtn');
  if (fb) fb.addEventListener('click', () => followCountry(country));

  const rel = document.createElement('div');
  rel.className = 'related';
  rel.innerHTML = '<h3>Related stories</h3><div class="grid">' +
    (d.related && d.related.length ? d.related.map(x => WF.articleCard(x, false)).join('') : '<p class="muted">No related stories yet.</p>') +
    '</div>';
  app.appendChild(rel);
  window.scrollTo(0, 0);
}

function formatDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function updateSEOTags(a) {
  // Open Graph
  let og = document.querySelector('meta[property="og:title"]');
  if (!og) { og = document.createElement('meta'); og.setAttribute('property', 'og:title'); document.head.appendChild(og); }
  og.setAttribute('content', a.title);
  let img = document.querySelector('meta[property="og:image"]');
  if (!img) { img = document.createElement('meta'); img.setAttribute('property', 'og:image'); document.head.appendChild(img); }
  img.setAttribute('content', a.image && !WF.isVideoUrl(a.image) ? a.image : location.origin + '/icons/icon-512.png');
  let ogurl = document.querySelector('meta[property="og:url"]');
  if (!ogurl) { ogurl = document.createElement('meta'); ogurl.setAttribute('property', 'og:url'); document.head.appendChild(ogurl); }
  ogurl.setAttribute('content', location.origin + '/article/' + a.slug);

  // JSON-LD NewsArticle
  let j = document.getElementById('jsonld-news');
  if (!j) { j = document.createElement('script'); j.id = 'jsonld-news'; j.type = 'application/ld+json'; document.head.appendChild(j); }
  j.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    image: a.image && !WF.isVideoUrl(a.image) ? [a.image] : undefined,
    datePublished: new Date(a.published_at * 1000).toISOString(),
    author: a.author ? { '@type': 'Person', name: a.author } : { '@type': 'Organization', name: 'WorldFront.News' },
    publisher: { '@type': 'Organization', name: 'WorldFront.News', logo: { '@type': 'ImageObject', url: location.origin + '/icons/icon-192.png' } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': location.origin + '/article/' + a.slug },
    description: (a.summary || '').slice(0, 160)
  });
}

async function saveArticle(a) {
  if (!WF.state.token) { WF.toast('Sign in to save articles'); WF.router.go('/account'); return; }
  try {
    await WF.api('/auth/saved/' + a.id, { method: 'POST' });
    WF.toast('Saved to your reading list ✓');
  } catch (e) { WF.toast(e.message); }
}

// ---------- Product page (client view; SSR serves the same page) ----------
WF.views.product = async function (app, params) {
  app.innerHTML = '<div class="article-page"><div class="skeleton" style="height:24px;width:70%"></div><div class="skeleton" style="height:200px;margin:16px 0"></div></div>';
  try {
    const d = await WF.api('/shop/product/' + encodeURIComponent(params.id));
    const p = d.product;
    setMeta(p.title, (p.description || '').slice(0, 160));
    const px = p.price ? p.currency + ' ' + Number(p.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'Price on request';
    app.innerHTML =
      '<article class="article-page">' +
      '<span class="cat-tag">' + WF.esc(p.category || 'shopping') + '</span>' +
      '<h1>' + WF.esc(p.title) + '</h1>' +
      '<div class="article-meta"><span class="src">' + WF.esc(p.brand || 'Weverse Online Shop') + '</span></div>' +
      (p.thumbnail ? WF.mediaTag(p.thumbnail, 'article-hero-img is-product', p.title) : '') +
      '<p class="product-price" style="font-size:1.6rem;font-weight:700">' + WF.esc(px) + '</p>' +
      (p.description ? '<p class="article-summary">' + WF.esc(p.description) + '</p>' : '') +
      '<div class="article-actions">' +
        '<a class="btn btn-primary" href="' + WF.esc(p.product_url || '#') + '" target="_blank" rel="noopener noreferrer nofollow">View and buy on Weverse ↗</a>' +
        '<a class="btn btn-outline" href="/shop">Browse all products</a>' +
      '</div></article>';
  } catch (e) {
    app.innerHTML = '<div class="center" style="padding:40px"><h3>Product not found</h3><p class="muted">' + WF.esc(e.message) + '</p><br><a class="btn btn-primary" href="/shop">Back to shop</a></div>';
  }
};

// ---------- Daily edition page (client view; SSR serves the same page) ----------
WF.views.shopDaily = async function (app, params) {
  app.innerHTML = '<div class="article-page"><div class="skeleton" style="height:24px;width:70%"></div><div class="skeleton" style="height:200px;margin:16px 0"></div></div>';
  try {
    const api = '/shop/daily' + (params.date ? '?country=' + encodeURIComponent(params.country) + '&date=' + encodeURIComponent(params.date) : '/' + encodeURIComponent(params.country));
    const data = (await WF.api(api)).edition;
    const featured = data.items.find(i => i.featured) || null;
    setMeta(data.headline, (data.intro || '').slice(0, 160));
    const hero = featured
      ? '<div class="daily-hero">' + (featured.image ? WF.mediaTag(featured.image, 'article-hero-img is-product', featured.title) : '') +
        '<span class="featured-ribbon">★ Today\'s featured product</span></div>'
      : '';
    const countryName = WF.countryName(params.country) || params.country;
    app.innerHTML =
      '<article class="article-page">' +
      '<span class="cat-tag">shopping</span> <span class="pill">Daily product update</span>' +
      '<h1>' + WF.esc(data.headline) + '</h1>' +
      '<div class="article-meta"><span class="src">Weverse Online Shop</span><span>' + WF.esc(params.date || '') + '</span><span>' + WF.esc(countryName) + '</span></div>' +
      hero + (data.intro ? '<p class="article-summary">' + WF.esc(data.intro) + '</p>' : '') +
      '<div class="daily-products">' + (data.items.length ? '<div class="grid">' + data.items.map((it, i) => dailyItemCard(it, i)).join('') + '</div>' : '<p class="muted">No products in this edition.</p>') + '</div>' +
      (data.closing ? '<p class="article-summary" style="margin-top:24px">' + WF.esc(data.closing) + '</p>' : '') +
      '</article>';
    const rel = document.createElement('div');
    rel.className = 'related';
    rel.innerHTML = '<h3>Related</h3><p class="muted"><a href="/shop">Browse all shop products →</a></p>';
    app.appendChild(rel);
  } catch (e) {
    app.innerHTML = '<div class="center" style="padding:40px"><h3>Edition not found</h3><p class="muted">No daily edition is published for that selection yet.</p><br><a class="btn btn-primary" href="/shop">Back to shop</a></div>';
  }
};

// ---------- Search ----------
WF.views.search = async function (app, params) {
  const q = params.q;
  setMeta('Search: ' + q, 'Search results for ' + q);
  app.innerHTML = '<h1 class="page-title">Search: "' + WF.esc(q) + '"</h1><div id="grid">' + skeletonGrid(9) + '</div>';
  const grid = document.getElementById('grid');
  try {
    const d = await WF.api('/search?q=' + encodeURIComponent(q));
    grid.innerHTML = d.results.length
      ? '<div class="grid">' + d.results.map(r => WF.articleCard(r)).join('') + '</div>'
      : '<p class="muted">No results for "' + WF.esc(q) + '". Try different words.</p>';
  } catch (e) { grid.innerHTML = '<p class="muted">Search error.</p>'; }
};

// ---------- Account ----------
WF.views.account = async function (app) {
  setMeta('Account', 'Your WorldFront.News account');
  if (!WF.state.token) {
    app.innerHTML = '<div class="account-panel">' +
      '<div class="card"><h3>Welcome to WorldFront.News</h3>' +
      '<div id="authform">' +
        '<div class="form-row"><label>Email</label><input id="a_email" type="email" placeholder="you@email.com"></div>' +
        '<div class="form-row"><label>Username</label><input id="a_user" type="text" placeholder="username"></div>' +
        '<div class="form-row"><label>Password</label><input id="a_pass" type="password" placeholder="••••••••"></div>' +
        '<button class="btn btn-primary btn-block" id="a_login">Sign in</button>' +
        '<button class="btn btn-outline btn-block" style="margin-top:8px" id="a_register">Create account</button>' +
        '<p class="muted" style="font-size:.8rem;text-align:center;margin-top:10px">Sign in to save articles, follow countries & categories, and use location-based news.</p>' +
      '</div></div></div>';
    document.getElementById('a_login').addEventListener('click', async () => {
      try {
        const d = await WF.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: el('a_email'), password: el('a_pass') }) });
        afterLogin(d);
      } catch (e) { WF.toast(e.message); }
    });
    document.getElementById('a_register').addEventListener('click', async () => {
      try {
        const d = await WF.api('/auth/register', { method: 'POST', body: JSON.stringify({ email: el('a_email'), username: el('a_user'), password: el('a_pass') }) });
        afterLogin(d);
      } catch (e) { WF.toast(e.message); }
    });
    return;
  }

  // Logged in
  const u = WF.state.user;
  let follows = { countries: [], categories: [] };
  try { follows = await WF.api('/auth/follows'); } catch (e) {}
  let saved = [];
  try { saved = (await WF.api('/auth/saved')).saved; } catch (e) {}

  app.innerHTML = '<div class="account-panel">' +
    '<div class="card"><h3>👤 ' + WF.esc(u.username || u.email) + '</h3><p class="muted">' + WF.esc(u.email) + ' · ' + WF.esc(u.role) + '</p>' +
    '<button class="btn btn-outline btn-sm" id="logoutBtn">Sign out</button></div>' +
    '<div class="card" style="margin-top:16px"><h3>Following</h3>' +
    '<div id="followChips" class="chip-row"></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Saved articles (' + saved.length + ')</h3><div id="savedList"></div></div>' +
    (u.role === 'admin' ? '<div class="card" style="margin-top:16px"><h3>Admin</h3><a class="btn btn-outline btn-block" href="/admin">Open Admin Dashboard</a></div>' : '') +
    '</div>';

  document.getElementById('logoutBtn').addEventListener('click', signOut);

  const chips = document.getElementById('followChips');
  let chipHtml = '';
  for (const c of follows.countries) {
    chipHtml += '<button class="chip active" data-c="' + c + '">' + WF.countryName(c) + ' ✕</button>';
  }
  for (const c of follows.categories) {
    chipHtml += '<button class="chip active" data-cat="' + c + '">' + c + ' ✕</button>';
  }
  chips.innerHTML = chipHtml || '<p class="muted">No follows yet.</p>';
  chips.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', async () => {
    await WF.api('/follows/country', { method: 'DELETE', body: JSON.stringify({ country_code: b.dataset.c }) });
    b.remove(); WF.toast('Unfollowed');
  }));
  chips.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', async () => {
    await WF.api('/follows/category', { method: 'DELETE', body: JSON.stringify({ category: b.dataset.cat }) });
    b.remove(); WF.toast('Unfollowed');
  }));

  const sl = document.getElementById('savedList');
  sl.innerHTML = saved.length
    ? saved.map(a => '<div class="list-item"><a href="/article/' + WF.esc(a.slug || a.id) + '">' + (a.image ? '<img src="' + WF.esc(a.image) + '" onerror="this.style.display=\'none\'">' : '') + '</a><div><a href="/article/' + WF.esc(a.slug || a.id) + '"><strong>' + WF.esc(a.title) + '</strong></a><div class="muted" style="font-size:.78rem">' + WF.esc(a.source_name) + '</div></div></div>').join('')
    : '<p class="muted">No saved articles yet.</p>';
};

function afterLogin(d) {
  WF.state.token = d.token;
  WF.state.user = d.user;
  localStorage.setItem('wf-token', d.token);
  localStorage.setItem('wf-user', JSON.stringify(d.user));
  WF.toast('Welcome, ' + (d.user.username || '') + '!');
  WF.router.go('/');
}
function el(id) { return document.getElementById(id) ? document.getElementById(id).value : ''; }
function signOut() {
  const token = WF.state.token;
  WF.state.token = null; WF.state.user = null;
  localStorage.removeItem('wf-token'); localStorage.removeItem('wf-user');
  if (token) {
    try { fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); } catch (e) {}
  }
  WF.router.go('/');
}
window.signOut = signOut;

// ---------- Saved ----------
WF.views.saved = async function (app) {
  setMeta('Saved', 'Your saved articles');
  if (!WF.state.token) { app.innerHTML = '<p class="muted">Sign in to view saved articles.</p>'; return; }
  app.innerHTML = '<h1 class="page-title">Saved</h1><div id="grid">' + skeletonGrid(6) + '</div>';
  try {
    const d = await WF.api('/auth/saved');
    document.getElementById('grid').innerHTML = d.saved.length
      ? '<div class="grid">' + d.saved.map(a => WF.articleCard(a)).join('') + '</div>'
      : '<p class="muted">Nothing saved yet. Tap the Save button on an article.</p>';
  } catch (e) {}
};

// ---------- Site article (admin-published) ----------
WF.views.sitearticle = async function (app, params) {
  app.innerHTML = '<div class="article-page"><div class="skeleton" style="height:24px;width:70%"></div></div>';
  try {
    const d = await WF.api('/site-articles/' + encodeURIComponent(params.slug));
    const a = d.article;
    setMeta(a.title, (a.body || '').replace(/<[^>]+>/g, ' ').slice(0, 160));
    app.innerHTML = '<article class="article-page">' +
      (a.category ? '<span class="cat-tag">' + WF.esc(a.category) + '</span>' : '') +
      '<h1>' + WF.esc(a.title) + '</h1>' +
      '<div class="article-meta"><span class="src">' + WF.esc(a.author || 'WorldFront.News') + '</span><span>' + WF.fmtDate(a.published_at) + '</span></div>' +
      (a.image ? WF.mediaTag(a.image, 'article-hero-img', a.title) : '') +
      '<div style="font-size:1.05rem;line-height:1.7">' + a.body + '</div>' +
      '</article>';
  } catch (e) {
    app.innerHTML = '<div class="center" style="padding:40px"><p class="muted">Article not found.</p></div>';
  }
};

// ---------- Static pages ----------
WF.views.about = async function (app) {
  setMeta('About', 'About WorldFront.News');
  app.innerHTML = '<div class="article-page"><h1>About WorldFront.News</h1>' +
    '<p>WorldFront.News is a real global news platform that collects trusted headlines from established news organizations around the world and organizes them by <strong>country, region, category</strong> and <strong>location</strong>.</p>' +
    '<p>We link every story to its original publisher. We show summaries and never claim content as our own. Our news engine fetches real RSS feeds and licensed news APIs continuously.</p>' +
    '<p>Coverage spans every country on Earth — from the US, Germany, the UK and France to Japan, China, India, Brazil and all continents.</p></div>';
};
WF.views.privacy = async function (app) {
  setMeta('Privacy Policy', 'WorldFront.News privacy policy');
  app.innerHTML = '<div class="article-page"><h1>Privacy Policy</h1>' +
    '<p>Your location is used only to tailor news. If you enable GPS "news near me", your coordinates are <strong>rounded to roughly 1 km and never published or shown publicly</strong>. You can always select a country manually instead of using GPS.</p>' +
    '<p>We respect publisher copyright. We link to original articles and provide summaries only.</p></div>';
};
WF.views.terms = async function (app) {
  setMeta('Terms', 'WorldFront.News terms');
  app.innerHTML = '<div class="article-page"><h1>Terms of Service</h1>' +
    '<p>WorldFront.News aggregates headlines from external sources. All copyrighted content belongs to its original publishers. We provide brief summaries and links to the original source.</p></div>';
};

// ================= Weverse Shop Updates =================
// Products are auto-published from the owner's own Weverse Online Shop catalog
// via its official (read-only) Supabase API. Every "View & Buy" button opens the
// correct product page on the shop.
function productCard(p) {
  const px = p.price ? p.currency + ' ' + Number(p.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
  const title = WF.esc(p.title);
  const internal = '/shop/product/' + WF.esc(p.property_id || p.listing_id);
  const url = WF.esc(p.product_url);
  const fallback = '<span class="thumb-fallback" style="background:linear-gradient(135deg,#7a1f8c,#c026d3)"><span class="thumb-fb-icon">🛍️</span><span class="thumb-fb-label">Weverse Shop</span></span>';
  const img = p.thumbnail
    ? '<img loading="lazy" src="' + WF.esc(p.thumbnail) + '" alt="' + title + '" onerror="this.remove(); this.parentElement.insertAdjacentHTML(\'beforeend\',' + JSON.stringify(fallback) + ');">'
    : fallback;
  return '<article class="article-card product-card">' +
    '<a class="thumb" href="' + internal + '" title="' + title + '">' + img +
      '<span class="cat-tag">' + WF.esc(p.category) + '</span></a>' +
    '<div class="card-body">' +
      '<h3><a href="' + internal + '">' + title + '</a></h3>' +
      '<p class="card-summary">' + WF.esc((p.description || '').slice(0, 130)) + '</p>' +
      '<div class="card-meta"><span class="src">' + (p.brand ? WF.esc(p.brand) : 'Weverse Shop') + '</span>' +
        (p.display_location ? '<span>·</span><span class="product-location">📍 ' + WF.esc(p.display_location) + '</span>' : '') +
        (px ? '<span>·</span><span class="product-price">' + WF.esc(px) + '</span>' : '') + '</div>' +
      '<a class="btn btn-primary btn-sm btn-block buy-btn" href="' + internal + '">View product</a>' +
      '<a class="btn btn-outline btn-sm btn-block buy-btn" href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">View & Buy on Weverse ↗</a>' +
    '</div></article>';
}

WF.views.shop = async function (app) {
  setMeta('Weverse Shop Updates', 'New products auto-published from Weverse Online Shop — view and buy on the shop.');
  app.innerHTML = '<h1 class="page-title">🛍️ Weverse Shop Updates</h1>' +
    '<p class="muted">Products are published automatically from Weverse Online Shop. Tap a product to view and buy it on the shop.</p>' +
    '<div class="chip-row" id="shopCats"><span class="muted" style="font-size:.85rem">Loading categories…</span></div>' +
    '<div class="form-row" style="max-width:460px"><input id="shopSearch" placeholder="Search products…" autocomplete="off"></div>' +
    '<div id="shopGrid">' + skeletonGrid(9) + '</div>' +
    '<div id="shopMore" style="text-align:center;margin:18px 0"></div>';

  const state = { category: '', q: '', limit: 12 };
  const grid = document.getElementById('shopGrid');
  const more = document.getElementById('shopMore');
  let shopTimer = null;

  async function load(reset) {
    if (reset) state.limit = 12;
    const qs = '?limit=' + state.limit +
      (state.category ? '&category=' + encodeURIComponent(state.category) : '') +
      (state.q ? '&q=' + encodeURIComponent(state.q) : '');
    try {
      const d = await WF.api('/shop/products' + qs);
      if (d.products.length) {
        const cardsHtml = '<div class="grid">' + d.products.map(productCard).join('') + '</div>';
        if (reset) grid.innerHTML = cardsHtml;
        else {
          const g = grid.querySelector('.grid');
          if (g) g.insertAdjacentHTML('beforeend', d.products.map(productCard).join(''));
          else grid.innerHTML = cardsHtml;
        }
      } else {
        grid.innerHTML = '<div class="center" style="padding:30px"><p class="muted">No products match yet. New arrivals are published automatically — check back soon.</p></div>';
      }
      more.innerHTML = d.total > state.limit
        ? '<button class="btn btn-outline" id="loadMoreBtn">Load more (' + (d.total - state.limit) + ' more)</button>'
        : '';
      const lb = document.getElementById('loadMoreBtn');
      if (lb) lb.addEventListener('click', () => { state.limit += 12; load(false); });
    } catch (e) {
      grid.innerHTML = '<div class="center" style="padding:30px"><p class="muted">Could not load products. Please try again.</p></div>';
    }
  }

  try {
    const d = await WF.api('/shop/products?limit=1');
    const box = document.getElementById('shopCats');
    const chips = ['<button class="chip active" data-cat="">All</button>']
      .concat((d.categories || []).map(c => '<button class="chip" data-cat="' + WF.esc(c.category) + '">' + WF.esc(c.category) + ' (' + c.c + ')</button>'))
      .join('');
    box.innerHTML = chips;
    box.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      state.category = b.dataset.cat;
      box.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
      load(true);
    }));
  } catch (e) {}

  document.getElementById('shopSearch').addEventListener('input', (e) => {
    clearTimeout(shopTimer);
    shopTimer = setTimeout(() => { state.q = e.target.value.trim(); load(true); }, 300);
  });

  await load(true);
};

async function appendShopUpdates(app) {
  try {
    const d = await WF.api('/shop/products?limit=4');
    if (!d.products || !d.products.length) return;
    const sec = document.createElement('div');
    sec.innerHTML =
      '<div class="section-head"><h2>🛍️ Weverse Shop Updates</h2><a class="see-all" href="/shop">See all</a></div>' +
      '<p class="muted" style="font-size:.85rem;margin:-6px 0 12px">New products published automatically from Weverse Online Shop. Prices and availability shown on the shop.</p>' +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">' + d.products.map(productCard).join('') + '</div>';
    app.appendChild(sec);
  } catch (e) {}
}
