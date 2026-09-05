/* WorldFront.News admin views */
window.WF = WF || {};
if (!WF.views) WF.views = {};

function adminGuard() {
  const u = WF.state.user;
  if (!u) return false;
  return u.role === 'admin';
}

WF.views.admin = async function (app) {
  if (!adminGuard()) {
    app.innerHTML = '<div class="account-panel"><div class="card"><h3>Admin access</h3><p class="muted">Sign in with an admin account.</p>' +
      '<div class="form-row"><label>Email</label><input id="a_email" type="email" value="admin@worldfront.news"></div>' +
      '<div class="form-row"><label>Password</label><input id="a_pass" type="password"></div>' +
      '<button class="btn btn-primary btn-block" id="a_adminLogin">Sign in</button>' +
      '<p class="muted" style="font-size:.78rem;margin-top:8px">Default (dev): admin@worldfront.news / admin123 — change ADMIN_PASSWORD in .env before deploying.</p>' +
      '</div></div>';
    document.getElementById('a_adminLogin').addEventListener('click', async () => {
      try {
        const d = await WF.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('a_email').value, password: document.getElementById('a_pass').value }) });
        WF.state.token = d.token; WF.state.user = d.user;
        localStorage.setItem('wf-token', d.token); localStorage.setItem('wf-user', JSON.stringify(d.user));
        WF.router.go('/admin');
      } catch (e) { WF.toast(e.message); }
    });
    return;
  }
  setMeta('Admin', 'WorldFront.News admin');
  app.innerHTML = '<div class="page-title">Admin Dashboard</div>' +
    '<div class="chip-row">' +
      '<a class="chip" href="#/admin/sources">News Sources</a>' +
      '<a class="chip" href="#/admin/publish">Publish</a>' +
      '<a class="chip" href="#/admin/shop">Shop Updates</a>' +
    '</div>' +
    '<div class="grid grid-4"><div class="card" id="st_articles"></div><div class="card" id="st_sources"></div><div class="card" id="st_users"></div><div class="card" id="st_breaking"></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Fetched feeds (recent)</h3><div id="feedList"></div>' +
    '<button class="btn btn-primary" style="margin-top:10px" id="runFetch">Run news fetch now</button></div>' +
    '<div class="card" style="margin-top:16px"><h3>Manage articles</h3><p class="muted">Search and manage collected stories.</p>' +
    '<div class="form-row"><input id="artSearch" placeholder="Search title or source"></div><div id="artList"></div></div>';

  loadAdminStats();

  document.getElementById('runFetch').addEventListener('click', async () => {
    const b = document.getElementById('runFetch');
    b.textContent = 'Fetching…'; b.disabled = true;
    try {
      const d = await WF.api('/admin/fetch', { method: 'POST' });
      WF.toast('Fetch done: ' + d.ok + ' feeds OK, api=' + (d.api && d.api.total));
    } catch (e) { WF.toast(e.message); }
    b.textContent = 'Run news fetch now'; b.disabled = false;
    loadAdminStats();
  });

  let t;
  document.getElementById('artSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => loadArticleList(e.target.value), 300);
  });
  loadArticleList('');
};

async function loadAdminStats() {
  try {
    const s = await WF.api('/admin/stats');
    setCard('st_articles', '📰 Articles', s.total_articles + ' total · ' + s.published + ' published');
    setCard('st_sources', '📡 Sources', s.sources + ' sources · ' + s.enabled_sources + ' enabled');
    setCard('st_users', '👥 Users', s.users + ' users');
    setCard('st_breaking', '⚡ Breaking', s.breaking + ' active');
    const fl = document.getElementById('feedList');
    fl.innerHTML = (s.recentSources || []).length
      ? s.recentSources.map(f => '<div class="list-item" style="padding:6px 0"><span style="flex:1">' + WF.esc(f.name) + '</span><span class="' + (f.last_status === 'ok' ? 'pill' : 'pill" style="background:#d40000') + '">' + WF.esc((f.last_status || 'never').slice(0, 14)) + '</span></div>').join('')
      : '<p class="muted">No feeds fetched yet. Run a fetch.</p>';
  } catch (e) {}
}
function setCard(id, label, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '<h3>' + label + '</h3><div class="page-title" style="font-size:1.6rem;margin:4px 0">' + WF.esc(value.split(' · ')[0]) + '</div><div class="muted" style="font-size:.85rem">' + value.split(' · ').slice(1).join(' · ') + '</div>';
}

async function loadArticleList(q) {
  const list = document.getElementById('artList');
  try {
    const d = await WF.api('/articles?q=' + encodeURIComponent(q || '') + '&limit=15');
    list.innerHTML = d.articles.length
      ? d.articles.map(a => '<div class="list-item"><div style="flex:1"><a href="#/article/' + WF.esc(a.slug || a.id) + '"><strong>' + WF.esc(a.title) + '</strong></a><div class="muted" style="font-size:.78rem">' + WF.esc(a.source_name) + ' · ' + WF.esc(a.country_code) + '</div></div>' +
        '<button class="btn btn-sm btn-outline" data-feat="' + a.id + '" data-on="' + (a.featured ? 1 : 0) + '">' + (a.featured ? 'Unfeature' : 'Feature') + '</button>' +
        '<button class="btn btn-sm btn-outline" data-brk="' + a.id + '" data-on="' + (a.breaking ? 1 : 0) + '">' + (a.breaking ? 'Unbreak' : 'Breaking') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-rem="' + a.id + '">Remove</button>' +
        '</div>').join('')
      : '<p class="muted">No articles match.</p>';

    list.querySelectorAll('[data-feat]').forEach(b => b.addEventListener('click', async () => {
      const on = b.dataset.on === '1' ? 0 : 1;
      await WF.api('/admin/articles/' + b.dataset.feat + '/feature', { method: 'POST', body: JSON.stringify({ featured: on }) });
      WF.toast(on ? 'Featured' : 'Unfeatured'); loadArticleList(q);
    }));
    list.querySelectorAll('[data-brk]').forEach(b => b.addEventListener('click', async () => {
      const on = b.dataset.on === '1' ? 0 : 1;
      await WF.api('/admin/articles/' + b.dataset.brk + '/breaking', { method: 'POST', body: JSON.stringify({ breaking: on }) });
      WF.toast(on ? 'Set as breaking' : 'Removed from breaking'); loadArticleList(q);
    }));
    list.querySelectorAll('[data-rem]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this story?')) return;
      await WF.api('/admin/articles/' + b.dataset.rem + '/remove', { method: 'POST' });
      WF.toast('Story removed'); loadArticleList(q);
    }));
  } catch (e) { list.innerHTML = '<p class="muted">Could not load articles.</p>'; }
}

// ----- Sources manager -----
WF.views.adminSources = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Admin Sources', 'Manage news sources');
  app.innerHTML = '<div class="page-title">News Sources</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>Add source</h3>' +
    '<div class="form-row"><label>Name</label><input id="s_name"></div>' +
    '<div class="form-row"><label>Feed URL (RSS)</label><input id="s_feed" placeholder="https://example.com/feed"></div>' +
    '<div class="form-row" style="display:flex;gap:10px"><div style="flex:1"><label>Country code</label><input id="s_country" placeholder="US" maxlength="2"></div><div style="flex:1"><label>Category</label><input id="s_cat" placeholder="world"></div><div style="flex:1"><label>Language</label><input id="s_lang" placeholder="en"></div></div>' +
    '<button class="btn btn-primary" id="s_add">Add source</button></div>' +
    '<div id="srcList" class="card" style="margin-top:16px"><p class="muted">Loading…</p></div>';

  document.getElementById('s_add').addEventListener('click', async () => {
    try {
      await WF.api('/admin/sources', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('s_name').value,
        feed_url: document.getElementById('s_feed').value,
        country_code: document.getElementById('s_country').value,
        category: document.getElementById('s_cat').value,
        language: document.getElementById('s_lang').value
      }) });
      WF.toast('Source added'); loadSources();
    } catch (e) { WF.toast(e.message); }
  });

  loadSources();
};

async function loadSources() {
  const list = document.getElementById('srcList');
  try {
    const d = await WF.api('/admin/sources');
    list.innerHTML = d.sources.length
      ? d.sources.map(s => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(s.name) + '</strong><div class="muted" style="font-size:.78rem">' + WF.esc(s.feed_url) + ' · ' + WF.esc(s.country_code) + ' · ' + WF.esc(s.language) + '</div></div>' +
        '<span class="' + (s.enabled ? '' : 'muted') + '" style="font-size:.8rem">' + (s.enabled ? 'on' : 'off') + '</span>' +
        '<button class="btn btn-sm btn-outline" data-tog="' + s.id + '" data-on="' + s.enabled + '">' + (s.enabled ? 'Disable' : 'Enable') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + s.id + '">Delete</button></div>').join('')
      : '<p class="muted">No sources yet.</p>';
    list.querySelectorAll('[data-tog]').forEach(b => b.addEventListener('click', async () => {
      await WF.api('/admin/sources/' + b.dataset.tog, { method: 'PUT', body: JSON.stringify({ enabled: b.dataset.on === '1' ? 0 : 1 }) });
      loadSources();
    }));
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this source?')) return;
      await WF.api('/admin/sources/' + b.dataset.del, { method: 'DELETE' });
      loadSources();
    }));
  } catch (e) { list.innerHTML = '<p class="muted">Could not load.</p>'; }
}

// ----- Publish original articles -----
WF.views.adminPublish = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Publish', 'Write and publish your own articles');
  app.innerHTML = '<div class="page-title">Write & Publish</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>New article</h3>' +
    '<div class="form-row"><label>Title</label><input id="p_title"></div>' +
    '<div class="form-row" style="display:flex;gap:10px"><div style="flex:1"><label>Category</label><input id="p_cat" placeholder="world"></div><div style="flex:1"><label>Country code</label><input id="p_country" placeholder="US" maxlength="2"></div><div style="flex:1"><label>Author</label><input id="p_author" placeholder="Your name"></div></div>' +
    '<div class="form-row"><label>Image URL (optional)</label><input id="p_image" placeholder="https://...jpg"></div>' +
    '<div class="form-row"><label>Body</label><textarea id="p_body" rows="10" placeholder="Write your article here…"></textarea></div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="p_save">Save draft</button>' +
    '<button class="btn btn-primary" id="p_publish" style="background:#0a7d3c">Publish</button>' +
    '</div></div>' +
    '<div id="siteList" class="card" style="margin-top:16px"><p class="muted">Loading…</p></div>';

  const body = () => ({ title: document.getElementById('p_title').value, category: document.getElementById('p_cat').value, country_code: document.getElementById('p_country').value, author: document.getElementById('p_author').value, image: document.getElementById('p_image').value, body: document.getElementById('p_body').value });

  document.getElementById('p_save').addEventListener('click', async () => {
    try { await WF.api('/admin/site-articles', { method: 'POST', body: JSON.stringify({ ...body(), status: 'draft' }) }); WF.toast('Draft saved'); loadSiteList(); } catch (e) { WF.toast(e.message); }
  });
  document.getElementById('p_publish').addEventListener('click', async () => {
    try { await WF.api('/admin/site-articles', { method: 'POST', body: JSON.stringify({ ...body(), status: 'published' }) }); WF.toast('Published!'); loadSiteList(); } catch (e) { WF.toast(e.message); }
  });
  loadSiteList();
};

async function loadSiteList() {
  const list = document.getElementById('siteList');
  if (!list) return;
  try {
    const d = await WF.api('/admin/site-articles');
    list.innerHTML = '<h3>Your articles</h3>' + (d.articles.length
      ? d.articles.map(a => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(a.title) + '</strong><div class="muted" style="font-size:.78rem">' + WF.esc(a.status) + ' · ' + WF.esc(a.category) + '</div></div>' +
        '<a class="btn btn-sm btn-outline" href="#/p/' + a.slug + '">View</a>' +
        '<button class="btn btn-sm btn-danger" data-del="' + a.id + '">Delete</button></div>').join('')
      : '<p class="muted">No articles yet.</p>');
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this article?')) return;
      await WF.api('/admin/site-articles/' + b.dataset.del, { method: 'DELETE' });
      loadSiteList();
    }));
  } catch (e) {}
};

// ----- Weverse Shop Updates (auto-published products) -----
WF.views.adminShop = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Shop Updates', 'Weverse Online Shop product publishing');
  app.innerHTML = '<div class="page-title">🛍️ Weverse Shop Updates</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>Automatic product publishing</h3>' +
    '<p class="muted" style="font-size:.9rem">Products are synced automatically from your Weverse Online Shop through its official read-only Supabase API and published with a fresh complete edition every day for every supported country. Nothing is scraped, your shop is never modified, and published products, pages, images and prices stay live permanently.</p>' +
    '<div id="shopStatus" class="muted">Loading…</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' +
    '<button class="btn btn-primary" id="shopSync">Sync products now</button>' +
    '<button class="btn btn-outline" id="shopPreset">Publish 3 featured products</button>' +
    '<button class="btn btn-primary" id="shopEnable" style="background:#0a7d3c">Enable daily publishing (all countries)</button>' +
    '<button class="btn btn-outline" id="shopDisable">Pause daily publishing</button>' +
    '</div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Products in catalog</h3>' +
    '<div class="form-row"><input id="shopAdminSearch" placeholder="Search products…" autocomplete="off"></div>' +
    '<div id="shopAdminList"></div></div>';

  async function status() {
    try {
      const s = await WF.api('/admin/shop/status');
      const last = (s.last_sync && s.last_sync !== '0') ? new Date(+s.last_sync * 1000).toLocaleString() : 'never';
      const lastPub = (s.last_shop_publish && s.last_shop_publish !== '0') ? new Date(+s.last_shop_publish * 1000).toLocaleString() : 'never';
      const mode = s.mode === 'daily'
        ? '✅ Daily publishing ENABLED — fresh complete editions every day for ' + (s.supported_countries || 0) + ' countries'
        : '⏸ Daily publishing PAUSED — shop stays synced, no new daily editions';
      let html = s.total + ' products · ' + s.published_articles + ' shopping articles · ' + (s.supported_countries || 0) + ' countries · last sync: ' + last;
      if (s.editions && s.editions.length) html += ' · latest edition: ' + s.editions[0].pub_date + ' (' + s.editions[0].c + ' countries)';
      if (s.today) html += '<br>Today ' + s.today + ': ' + (s.editions_today || 0) + ' of ' + (s.supported_countries || 0) + ' countries published · ' + (s.edition_products || 0) + ' products per edition';
      if (s.needs_publish) html += ' · pending publish (' + s.reason + ')';
      document.getElementById('shopStatus').innerHTML = html + '<br><strong>' + mode + '</strong> · last publish: ' + lastPub;
    } catch (e) {
      document.getElementById('shopStatus').textContent = 'Status unavailable.';
    }
  }
  status();

  function busy(btn, label, on) {
    if (!btn) return;
    if (on) { btn.textContent = label + '…'; btn.disabled = true; }
    else { btn.textContent = label; btn.disabled = false; }
  }

  document.getElementById('shopSync').addEventListener('click', async () => {
    const b = document.getElementById('shopSync');
    busy(b, 'Sync products now', true);
    try {
      const r = await WF.api('/admin/shop/sync', { method: 'POST' });
      WF.toast('Synced: ' + r.total + ' products (' + r.inserted + ' new, ' + r.updated + ' updated)');
      status(); loadShopAdmin('');
    } catch (e) { WF.toast(e.message); }
    busy(b, 'Sync products now', false);
  });

  document.getElementById('shopPreset').addEventListener('click', async () => {
    const b = document.getElementById('shopPreset');
    busy(b, 'Publishing 3 featured products…', true);
    try {
      const r = await WF.api('/admin/shop/publish-preview', { method: 'POST' });
      WF.toast('Published: ' + r.created + ' articles created, ' + r.updated + ' refreshed');
      status();
    } catch (e) { WF.toast(e.message); }
    busy(b, 'Publish 3 featured products', false);
  });

  document.getElementById('shopEnable').addEventListener('click', async () => {
    const b = document.getElementById('shopEnable');
    busy(b, 'Publishing today\'s editions…', true);
    try {
      const r = await WF.api('/admin/shop/publish-daily', { method: 'POST' });
      WF.toast('Daily publishing enabled: ' + r.countries + ' countries × ' + r.products_per_country + ' products (' + r.items + ' records, ' + r.created + ' new articles)');
      status(); loadShopAdmin('');
    } catch (e) { WF.toast(e.message); }
    busy(b, 'Enable daily publishing (all countries)', false);
  });

  document.getElementById('shopDisable').addEventListener('click', async () => {
    try {
      await WF.api('/admin/shop/disable-daily', { method: 'POST' });
      WF.toast('Daily publishing paused — all published products remain live');
      status();
    } catch (e) { WF.toast(e.message); }
  });

  let t;
  document.getElementById('shopAdminSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => loadShopAdmin(e.target.value), 300);
  });
  loadShopAdmin('');
};

async function loadShopAdmin(q) {
  const list = document.getElementById('shopAdminList');
  if (!list) return;
  try {
    const d = await WF.api('/shop/products?limit=30' + (q ? '&q=' + encodeURIComponent(q) : ''));
    list.innerHTML = d.products.length
      ? d.products.map(p => '<div class="list-item"><div style="flex:1"><a href="' + WF.esc(p.product_url) + '" target="_blank" rel="noopener noreferrer nofollow"><strong>' + WF.esc(p.title) + '</strong></a><div class="muted" style="font-size:.78rem">' + WF.esc(p.category) + ' · ' + WF.esc(p.price ? p.currency + ' ' + Number(p.price).toLocaleString() : '') + '</div></div>' +
        '<a class="btn btn-sm btn-outline" href="' + WF.esc(p.product_url) + '" target="_blank" rel="noopener noreferrer nofollow">View</a></div>').join('')
      : '<p class="muted">No products yet — run a sync.</p>';
  } catch (e) {
    list.innerHTML = '<p class="muted">Could not load products.</p>';
  }
}
