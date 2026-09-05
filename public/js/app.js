/* WorldFront.News frontend core */
window.WF = (function () {
  function safeParse(v) {
    try { return JSON.parse(v || 'null'); } catch (e) { return null; }
  }
  const state = {
    theme: localStorage.getItem('wf-theme') || 'auto',
    token: localStorage.getItem('wf-token') || null,
    user: safeParse(localStorage.getItem('wf-user')),
    location: safeParse(localStorage.getItem('wf-location')),
    countryMap: {},
    countries: [],
    categories: []
  };
  return { state };
})();

// ---- API helper ----
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (WF.state.token) headers['Authorization'] = 'Bearer ' + WF.state.token;
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401 && WF.state.token) { signOut(false); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

// ---- Toast ----
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- Theme ----
function applyTheme() {
  const t = WF.state.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('themeIcon').innerHTML = dark
    ? '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" fill="currentColor"/>';
}
function toggleTheme() {
  const order = ['auto', 'light', 'dark'];
  WF.state.theme = order[(order.indexOf(WF.state.theme) + 1) % order.length];
  localStorage.setItem('wf-theme', WF.state.theme);
  applyTheme();
}

// ---- Time formatting ----
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts * 1000).toLocaleDateString();
}
function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// ---- Country helpers ----
function countryName(code) {
  return (WF.state.countryMap[code] || {}).name || code || '';
}
function countryFlag(code) {
  return (WF.state.countryMap[code] || {}).flag || '';
}

// ---- Card renderer ----
const CAT_GRADS = {
  politics: 'linear-gradient(135deg,#3a0ca3,#7209b7)',
  business: 'linear-gradient(135deg,#003049,#006d77)',
  economy: 'linear-gradient(135deg,#0b3d91,#1d6fd6)',
  finance: 'linear-gradient(135deg,#14532d,#16a34a)',
  technology: 'linear-gradient(135deg,#111,#3a3a6a)',
  science: 'linear-gradient(135deg,#1e3a8a,#0ea5e9)',
  health: 'linear-gradient(135deg,#7f1d1d,#ef4444)',
  entertainment: 'linear-gradient(135deg,#701a75,#c026d3)',
  sports: 'linear-gradient(135deg,#14532d,#166534)',
  lifestyle: 'linear-gradient(135deg,#9a3412,#f59e0b)',
  travel: 'linear-gradient(135deg,#0f766e,#14b8a6)',
  environment: 'linear-gradient(135deg,#064e3b,#22c55e)',
  education: 'linear-gradient(135deg,#4338ca,#6366f1)',
  crime: 'linear-gradient(135deg,#1c1917,#44403c)',
  culture: 'linear-gradient(135deg,#831843,#a21caf)',
  breaking: 'linear-gradient(135deg,#b91c1c,#f97316)',
  shopping: 'linear-gradient(135deg,#9d174d,#db2777)',
  world: 'linear-gradient(135deg,#0b3d91,#38bdf8)'
};
function catGrad(cat) {
  return CAT_GRADS[String(cat || '').toLowerCase()] || 'linear-gradient(135deg,#0b3d91,#38bdf8)';
}
function catEmoji(cat) {
  return {
    politics: '🏛️', business: '💼', economy: '📈', finance: '💰', technology: '💻',
    science: '🔬', health: '🩺', entertainment: '🎬', sports: '⚽', lifestyle: '🛒',
    travel: '✈️', environment: '🌍', education: '🎓', crime: '🚨', culture: '🎭',
    world: '🌐', breaking: '🔴', shopping: '🛍️'
  }[String(cat || '').toLowerCase()] || '📰';
}
function articleCard(a, opts) {
  const b = a.breaking ? '<span class="breaking-tag">BREAKING</span>' : '';
  const cat = a.category ? '<span class="cat-tag">' + esc(a.category) + '</span>' : '';
  const href = '#/article/' + esc(a.slug || a.id);
  let thumb;
  if (a.image) {
    // Real story image - never a blank box: swap in a branded fallback on error
    const fbk = '<span class="thumb-fallback" style="background:' + catGrad(a.category) + '"><span class="thumb-fb-icon">' + catEmoji(a.category) + '</span><span class="thumb-fb-label">' + esc(a.category || 'News') + '</span></span>';
    thumb = '<a class="thumb" href="' + href + '">' +
      '<img loading="lazy" src="' + esc(a.image) + '" alt="' + esc(a.title) + '"' +
      ' onerror="this.remove(); this.parentElement.insertAdjacentHTML(\'beforeend\',' + JSON.stringify(fbk) + ');">' +
      cat + b + '</a>';
    // Elevate any real-image cards only via CSS; the img handles itself
  } else {
    // No image available -> branded category header (never blank/dark)
    const label = a.category ? esc(String(a.category).charAt(0).toUpperCase() + String(a.category).slice(1)) : 'News';
    thumb = '<a class="thumb thumb-fallback" style="background:' + catGrad(a.category) + '" href="' + href + '">' +
      '<span class="thumb-fb-icon">' + catEmoji(a.category) + '</span>' +
      '<span class="thumb-fb-label">' + label + '</span>' + cat + b + '</a>';
  }
  const country = a.country_code ? countryFlag(a.country_code) + ' ' + countryName(a.country_code) : '';
  return '<article class="article-card">' + thumb +
    '<div class="card-body"><h3><a href="' + href + '">' + esc(a.title) + '</a></h3>' +
    (opts !== false ? '<p class="card-summary">' + esc(a.summary) + '</p>' : '') +
    '<div class="card-meta"><span class="src">' + esc(a.source_name) + '</span><span>·</span><span>' + timeAgo(a.published_at) + '</span>' +
    (country ? '<span>·</span><span>' + country + '</span>' : '') + '</div></div></article>';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Share ----
async function shareArticle(a) {
  const data = { title: a.title, url: location.origin + '/#/article/' + (a.slug || a.id) };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) {} }
  if (navigator.clipboard) { await navigator.clipboard.writeText(data.url); toast('Link copied'); }
}

// ---- Install PWA ----
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});
function canInstall() { return !!deferredPrompt; }

// ---- Init shared UI ----
async function initShell() {
  applyTheme();

  // Load countries map
  try {
    const d = await api('/regions/countries');
    const map = {};
    for (const [reg, list] of Object.entries(d.grouped)) {
      for (const c of list) {
        map[c.code] = { name: c.name, region: c.region, flag: '🏳️' };
      }
    }
    // Emoji flags where not covered roughly by name
    WF.state.countryMap = map;
  } catch (e) {}

  try {
    const c = await api('/countries');
    const map = WF.state.countryMap;
    for (const row of c.countries) {
      if (map[row.code]) map[row.code].name = row.name;
      else map[row.code] = { name: row.name, region: row.region };
    }
    WF.state.countries = c.countries;
  } catch (e) {}

  // Year
  document.getElementById('year').textContent = new Date().getFullYear();

  // Header buttons
  document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('mainNav').classList.toggle('open'));
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('searchBtn').addEventListener('click', () => openSearch());
  document.getElementById('searchClose').addEventListener('click', () => closeSearch());
  document.getElementById('searchInput').addEventListener('input', debounce(onSearchInput, 250));
  document.getElementById('locBtn').addEventListener('click', () => openLocation());
  document.getElementById('locClose').addEventListener('click', () => closeLocation());
  document.getElementById('locSave').addEventListener('click', saveLocation);
  document.getElementById('locGpsBtn').addEventListener('click', findNearMe);
  document.getElementById('locGps').addEventListener('change', toggleGps);
  document.getElementById('bnLoc').addEventListener('click', (e) => { e.preventDefault(); openLocation(); });
  document.getElementById('userBtn').addEventListener('click', () => WF.router.go('/account'));

  initLocationSelect();
  initBreaking();
  registerSW();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---- Search ----
function openSearch() {
  const p = document.getElementById('searchPanel');
  p.classList.add('open');
  document.getElementById('searchInput').focus();
}
function closeSearch() {
  document.getElementById('searchPanel').classList.remove('open');
  document.getElementById('searchResults').innerHTML = '';
}
async function onSearchInput() {
  const q = document.getElementById('searchInput').value.trim();
  const box = document.getElementById('searchResults');
  if (!q) { box.innerHTML = ''; return; }
  try {
    const d = await api('/search?q=' + encodeURIComponent(q));
    box.innerHTML = d.results.length
      ? d.results.slice(0, 8).map(r => '<a class="sr-item" href="#/article/' + esc(r.slug || r.id) + '" onclick="WF.closeSearch()">' +
          (r.image ? '<img src="' + esc(r.image) + '" onerror="this.style.display=\'none\'">' : '') +
          '<div><div class="sr-title">' + esc(r.title) + '</div><div class="sr-meta">' + esc(r.source_name) + ' · ' + timeAgo(r.published_at) + '</div></div></a>').join('')
      : '<div class="sr-item muted">No results for "' + esc(q) + '"</div>';
  } catch (e) { box.innerHTML = ''; }
}
function closeSearchComp() { closeSearch(); }

// ---- Breaking news live-TV overlay ----
let wfrontTimer = null;

function updateClock() {
  const el = document.getElementById('wfrontClock');
  if (el) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    el.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' + hh + ':' + mm + ':' + ss;
  }
}

function measureOverlay() {
  const ov = document.getElementById('breakingOverlay');
  if (ov && !ov.hidden) {
    const h = ov.getBoundingClientRect().height;
    document.body.style.setProperty('--wfront-total', Math.ceil(h) + 'px');
  } else {
    document.body.style.setProperty('--wfront-total', '0px');
  }
}

// Set the big wordmark. Always-on live-TV look: red BREAKING whenever there is news.
function setBadgeMode(hasNews) {
  const b1 = document.querySelector('#wfrontBadges .b-breaking');
  const b2 = document.querySelector('#wfrontBadges .b-news');
  if (hasNews) {
    if (b1) { b1.textContent = 'BREAKING'; b1.classList.add('active'); }
    if (b2) { b2.textContent = 'NEWS'; }
  } else {
    if (b1) { b1.textContent = 'BREAKING'; b1.classList.remove('active'); }
    if (b2) { b2.textContent = 'NEWS'; }
  }
}

// ---- Breaking news cycling state ----
let _brkItems = [];
let _brkIdx = 0;
let _brkCycleTimer = null;

function buildMetaLine(item) {
  const parts = [];
  if (item.country_code) parts.push(countryFlag(item.country_code) + ' ' + countryName(item.country_code));
  parts.push(item.category || 'World');
  if (item.created_at) parts.push(timeAgo(item.created_at));
  return parts.join(' · ');
}

function showBrkSlide(idx) {
  const bg = document.getElementById('wmBg');
  const img = document.getElementById('wmImg');
  const load = document.getElementById('wmLoading');
  const hl = document.getElementById('wmHeadline');
  const src = document.getElementById('wmSource');
  const num = document.getElementById('wmStoryNum');
  if (!bg || !hl || !img) return;
  const item = _brkItems[idx];
  if (!item) return;

  const href = item.link || (item.article_slug ? '/#/article/' + item.article_slug : '/#/latest');
  hl.href = href;
  hl.textContent = item.title;
  src.textContent = buildMetaLine(item);
  num.textContent = (idx + 1) + ' / ' + _brkItems.length;

  if (item.image) {
    // Show gradient immediately so there is never a black box while the image loads
    bg.style.background = catGrad(item.category);
    if (img.dataset.src !== item.image) {
      img.dataset.src = item.image;
      img.onload = function () {
        bg.style.backgroundImage = 'url(\'' + esc(item.image) + '\')';
        bg.style.background = '';
        load.style.opacity = '0';
      };
      img.onerror = function () {
        bg.style.backgroundImage = 'none';
        bg.style.background = catGrad(item.category);
        load.style.opacity = '0';
      };
      img.src = item.image;
      load.style.opacity = '1';
    }
  } else {
    img.onload = img.onerror = null;
    img.removeAttribute('src');
    bg.style.backgroundImage = 'none';
    bg.style.background = catGrad(item.category);
    load.style.opacity = '0';
  }

  hl.style.animation = 'none';
  hl.offsetHeight;
  hl.style.animation = 'textSlideIn .6s ease-out both';
  src.style.animation = 'none';
  src.offsetHeight;
  src.style.animation = 'textSlideIn .6s ease-out .15s both';
}

function startBrkCycle() {
  if (_brkCycleTimer) clearInterval(_brkCycleTimer);
  if (_brkItems.length <= 1) return;
  _brkIdx = 0;
  _brkCycleTimer = setInterval(function () {
    _brkIdx = (_brkIdx + 1) % _brkItems.length;
    showBrkSlide(_brkIdx);
  }, 5000);
}

function renderBreaking(items, urgent) {
  const ov = document.getElementById('breakingOverlay');
  const track = document.getElementById('ltTrack');
  const list = Array.isArray(items) ? items.filter(i => i && i.title && String(i.title).trim()) : [];

  if (_brkCycleTimer) { clearInterval(_brkCycleTimer); _brkCycleTimer = null; }

  if (!list.length) {
    setBadgeMode(false);
    ov.hidden = true;
    document.body.style.setProperty('--wfront-total', '0px');
    _brkItems = [];
    return;
  }

  setBadgeMode(true);
  _brkItems = list;
  _brkIdx = 0;
  showBrkSlide(0);
  startBrkCycle();

  const itemsHtml = list.map(i => {
    const l = i.link || (i.article_slug ? '/#/article/' + i.article_slug : '/#/latest');
    const tag = i.urgent ? 'BREAKING' : 'LIVE';
    return '<span class="lt-item"><span class="lt-tag">' + tag + '</span><a href="' + esc(l) + '">' + esc(i.title) + '</a></span>';
  }).join('<span class="lt-item"><span class="spacer">◆</span></span>');
  track.innerHTML = '<div class="lt-inner">' + itemsHtml + '<span class="lt-item"><span class="spacer">◆</span></span>' + itemsHtml + '</div>';

  ov.hidden = false;
  measureOverlay();
}

async function initBreaking() {
  updateClock();
  if (wfrontTimer) { clearInterval(wfrontTimer); clearInterval(window._brkPoll); }
  if (_brkCycleTimer) { clearInterval(_brkCycleTimer); _brkCycleTimer = null; }
  wfrontTimer = setInterval(updateClock, 1000);

  async function fetchIt() {
    try {
      const d = await api('/breaking');
      if (d && Array.isArray(d.items)) {
        renderBreaking(d.items, !!d.urgent);
      } else {
        renderBreaking([]);
      }
    } catch (e) {
      const base = document.getElementById('ltTrack');
      if (base && !base.children.length) renderBreaking([]);
      if (window._brkEmpty === undefined) {
        window._brkEmpty = true;
        renderBreaking([]);
      }
    }
  }

  await fetchIt();
  // Auto-update when new breaking news is published in the admin
  window._brkPoll = setInterval(fetchIt, 30000);
  // Re-measure on resize so the spacer stays exact (no jitter)
  window.addEventListener('resize', () => { clearTimeout(initBreaking._r); initBreaking._r = setTimeout(measureOverlay, 120); });

  // Load triggers a re-measure after images/fonts settle
  window.addEventListener('load', () => setTimeout(measureOverlay, 200));
}

function initTicker() {
  return initBreaking();
}

// ---- Location ----
let regionsCache = {};
async function initLocationSelect() {
  const sel = document.getElementById('locCountry');
  sel.innerHTML = '<option value="">Select country</option>';
  try {
    const d = await api('/regions/countries');
    regionsCache = d.grouped;
    for (const [reg, list] of Object.entries(d.grouped)) {
      for (const c of list) {
        const o = document.createElement('option');
        o.value = c.code;
        o.textContent = c.name;
        sel.appendChild(o);
      }
    }
    // restore
    if (WF.state.location && WF.state.location.country_code) {
      sel.value = WF.state.location.country_code;
      populateRegions(WF.state.location.country_code);
      if (WF.state.location.region) document.getElementById('locRegion').value = WF.state.location.region;
      if (WF.state.location.city) document.getElementById('locCity').value = WF.state.location.city;
    }
  } catch (e) {}
  sel.addEventListener('change', () => populateRegions(sel.value));
}
function populateRegions(code) {
  const rs = document.getElementById('locRegion');
  rs.innerHTML = '<option value="">Region / State (optional)</option>';
  rs.disabled = !code;
  const c = regionsCache[code];
  if (!c) { rs.disabled = true; return; }
  const { state: states } = groupStates(c);
  for (const s of states) {
    const o = document.createElement('option');
    o.value = s; o.textContent = s; rs.appendChild(o);
  }
}
function groupStates(countries) {
  // For states, use subregion as the grouping a user sees as regions/states
  const states = [...new Set(countries.map(x => x.subregion))].filter(Boolean);
  return { state: states };
}
function openLocation() { document.getElementById('locationPanel').classList.add('open'); }
function closeLocation() { document.getElementById('locationPanel').classList.remove('open'); }

async function saveLocation() {
  if (!WF.state.token) { toast('Please sign in to save your location'); WF.router.go('/account'); return; }
  const data = {
    country_code: document.getElementById('locCountry').value,
    region: document.getElementById('locRegion').value,
    state: document.getElementById('locRegion').value,
    city: document.getElementById('locCity').value
  };
  if (!data.country_code) { toast('Select a country'); return; }
  try {
    await api('/location/save', { method: 'POST', body: JSON.stringify(data) });
    WF.state.location = data;
    localStorage.setItem('wf-location', JSON.stringify(data));
    toast('Location saved ✓');
    closeLocation();
  } catch (e) { toast(e.message); }
}

async function toggleGps() {
  const allow = document.getElementById('locGps').checked;
  if (!WF.state.token) { toast('Please sign in'); document.getElementById('locGps').checked = false; return; }
  try {
    if (!allow) {
      await api('/location/gps', { method: 'POST', body: JSON.stringify({ allow: false }) });
      toast('Location services disabled');
      return;
    }
    // Explain then request
    if (!confirm('WorldFront will use your approximate location only to find "news near me". Your exact coordinates are rounded and never published or shared. Allow?')) {
      document.getElementById('locGps').checked = false; return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      await api('/location/gps', { method: 'POST', body: JSON.stringify({ allow: true, lat: pos.coords.latitude, lng: pos.coords.longitude }) });
      toast('Location services enabled');
    }, (err) => { toast('Location unavailable'); document.getElementById('locGps').checked = false; }, { enableHighAccuracy: false, timeout: 10000 });
  } catch (e) { toast(e.message); }
}

async function findNearMe() {
  const box = document.getElementById('locNear');
  box.innerHTML = '<p class="muted">Locating…</p>';
  const useLoc = WF.state.location && WF.state.location.country_code;
  let qs = '?country=' + (useLoc ? encodeURIComponent(WF.state.location.country_code) : '');
  // If GPS on, add coords
  if (WF.state.location && WF.state.location.gps_enabled && WF.state.location.lat != null) {
    qs = '?lat=' + WF.state.location.lat + '&lng=' + WF.state.location.lng;
  } else if (navigator.geolocation && confirm('Allow approximate location to find news near you? You can also pick a country manually.')) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      qs = '?lat=' + pos.coords.latitude + '&lng=' + pos.coords.longitude;
    } catch (e) {}
  }
  try {
    const d = await api('/location/near' + qs);
    const name = d.location.country ? countryName(d.location.country) : 'latest';
    box.innerHTML = '<h4>News: ' + esc(name) + '</h4>' +
      (d.articles.length ? d.articles.map(a => articleCard(a, false)).join('') : '<p class="muted">No local stories yet. Try another country.</p>');
  } catch (e) { box.innerHTML = '<p class="muted">Could not load news near you.</p>'; }
}

// Expose
window.WF.api = api;
window.WF.toast = toast;
window.WF.initShell = initShell;
window.WF.articleCard = articleCard;
window.WF.countryName = countryName;
window.WF.countryMap = WF.state.countryMap;
window.WF.timeAgo = timeAgo;
window.WF.fmtDate = fmtDate;
window.WF.esc = esc;
window.WF.shareArticle = shareArticle;
window.WF.openSearch = openSearch;
window.WF.closeSearch = closeSearchComp;
window.WF.closeSearchComp = closeSearchComp;
window.WF.openLocation = openLocation;
window.WF.closeLocation = closeLocation;
window.WF.canInstall = canInstall;
window.WF.deferredPrompt = deferredPrompt;
