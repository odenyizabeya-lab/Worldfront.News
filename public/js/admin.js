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
    app.innerHTML = '<div class="account-panel"><div class="card"><h3>Admin access</h3><p class="muted">Sign in with an admin account, create a new account, or change your password.</p>' +
      '<div class="form-row"><label>Email</label><input id="a_email" type="email" value="odenyizabeya@gmail.com"></div>' +
      '<div class="form-row"><label>Password</label><input id="a_pass" type="password"></div>' +
      '<button class="btn btn-primary btn-block" id="a_adminLogin">Sign in</button>' +
      '<button class="btn btn-outline btn-block" style="margin-top:8px" id="a_adminRegister">Create account</button>' +
      '<button class="btn btn-outline btn-block" style="margin-top:8px" id="a_adminChangePw">Change password</button>' +
      '<div id="a_pwPanel" style="display:none;margin-top:12px">' +
        '<div class="form-row"><label>Current password</label><input id="a_cur" type="password"></div>' +
        '<div class="form-row"><label>New password (min 8 characters)</label><input id="a_new" type="password"></div>' +
        '<div class="form-row"><label>Repeat new password</label><input id="a_new2" type="password"></div>' +
        '<button class="btn btn-primary btn-block" id="a_savePw">Save password</button>' +
      '</div>' +
      '</div></div>';
    document.getElementById('a_adminLogin').addEventListener('click', async () => {
      try {
        const d = await WF.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('a_email').value, password: document.getElementById('a_pass').value }) });
        WF.state.token = d.token; WF.state.user = d.user;
        localStorage.setItem('wf-token', d.token); localStorage.setItem('wf-user', JSON.stringify(d.user));
        WF.router.go('/admin');
      } catch (e) { WF.toast(e.message); }
    });
    document.getElementById('a_adminRegister').addEventListener('click', async () => {
      try {
        const email = document.getElementById('a_email').value.trim();
        const password = document.getElementById('a_pass').value;
        const username = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 20) || 'user';
        const d = await WF.api('/auth/register', { method: 'POST', body: JSON.stringify({ email, username, password }) });
        WF.state.token = d.token; WF.state.user = d.user;
        localStorage.setItem('wf-token', d.token); localStorage.setItem('wf-user', JSON.stringify(d.user));
        WF.toast('Account created — ' + (d.user.role === 'admin' ? 'welcome admin!' : 'note: accounts start as reader'));
        WF.router.go(d.user.role === 'admin' ? '/admin' : '/account');
      } catch (e) { WF.toast(e.message); }
    });
    const panel = document.getElementById('a_pwPanel');
    document.getElementById('a_adminChangePw').addEventListener('click', () => {
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? 'block' : 'none';
    });
    document.getElementById('a_savePw').addEventListener('click', async () => {
      const email = document.getElementById('a_email').value.trim();
      const cur = document.getElementById('a_cur').value;
      const pw = document.getElementById('a_new').value;
      const pw2 = document.getElementById('a_new2').value;
      if (pw.length < 8) return WF.toast('New password must be at least 8 characters');
      if (pw !== pw2) return WF.toast('New passwords do not match');
      const b = document.getElementById('a_savePw');
      b.disabled = true; b.textContent = 'Saving…';
      try {
        const d = await WF.api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: cur }) });
        WF.state.token = d.token; WF.state.user = d.user;
        const r = await WF.api('/auth/me/change-password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: pw }) });
        localStorage.setItem('wf-token', d.token); localStorage.setItem('wf-user', JSON.stringify(d.user));
        WF.toast(r.message || 'Password updated — you are signed in');
        WF.router.go(d.user.role === 'admin' ? '/admin' : '/account');
      } catch (e) { WF.toast(e.message); }
      b.disabled = false; b.textContent = 'Save password';
    });
    return;
  }
  setMeta('Admin', 'WorldFront.News admin');
  app.innerHTML = '<div class="page-title">Admin Dashboard</div>' +
    '<div class="chip-row">' +
      '<a class="chip" href="#/admin/sources">News Sources</a>' +
      '<a class="chip" href="#/admin/publish">Publish</a>' +
      '<a class="chip" href="#/admin/shop">Shop Updates</a>' +
      '<a class="chip" href="#/admin/seo">SEO</a>' +
      '<a class="chip" href="#/admin/locations">Locations</a>' +
      '<a class="chip" href="#/admin/distribution">Distribution</a>' +
      '<a class="chip" href="#/admin/account">Account</a>' +
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
      ? d.articles.map(a => '<div class="list-item"><div style="flex:1"><a href="/article/' + WF.esc(a.slug || a.id) + '"><strong>' + WF.esc(a.title) + '</strong></a><div class="muted" style="font-size:.78rem">' + WF.esc(a.source_name) + ' · ' + WF.esc(a.country_code) + '</div></div>' +
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
      ? d.products.map(p => '<div class="list-item"><div style="flex:1"><a href="' + WF.esc(p.product_url) + '" target="_blank" rel="noopener noreferrer nofollow"><strong>' + WF.esc(p.title) + '</strong></a><div class="muted" style="font-size:.78rem">' + WF.esc(p.category) + ' · ' + WF.esc(p.price ? p.currency + ' ' + Number(p.price).toLocaleString() : '') + (p.display_location ? ' · 📍 ' + WF.esc(p.display_location) : '') + '</div></div>' +
        '<a class="btn btn-sm btn-outline" href="' + WF.esc(p.product_url) + '" target="_blank" rel="noopener noreferrer nofollow">View</a></div>').join('')
      : '<p class="muted">No products yet — run a sync.</p>';
  } catch (e) {
    list.innerHTML = '<p class="muted">Could not load products.</p>';
  }
}

// ----- SEO quality control + Google Search Console -----
WF.views.adminSeo = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('SEO', 'Technical SEO and indexing controls');
  app.innerHTML = '<div class="page-title">🔍 Technical SEO</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>Google Search Console</h3><div id="gscStatus" class="muted">Loading…</div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Link & Index Registry</h3>' +
    '<p class="muted" style="font-size:.9rem">Rebuilds the registry of indexable pages (properties, articles, countries, locations) and runs automated checks over every page.</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="seoRebuild">Rebuild registry</button>' +
    '<button class="btn btn-primary" style="background:#0a7d3c" id="seoRun">Run full audit</button>' +
    '</div><div id="seoReport" style="margin-top:10px"></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Validate a property page (JSON-LD)</h3>' +
    '<div class="form-row" style="display:flex;gap:10px"><input id="seoPid" placeholder="Listing or property id (e.g. W-684297759)" style="flex:1"><button class="btn btn-outline" id="seoValidate">Validate</button></div>' +
    '<div id="seoValOut" class="muted" style="font-size:.85rem;margin-top:8px"></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Property SEO status</h3><div id="propSeoStatus" class="muted">Loading…</div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Real reach — who is actually viewing</h3>' +
    '<p class="muted" style="font-size:.9rem">First-party counter — real numbers of how often each public page was served. No third-party scripts; counts every HTML page view, not names.</p>' +
    '<div id="reachTotals" class="muted"></div><div id="reachList"></div></div>';

  async function loadGsc() {
    try {
      const d = await WF.api('/admin/gsc/status');
      const c = d.config;
      const checks = [
        (c.site_verified ? '✅' : '⬜') + ' Site verification token' + (c.verification_token ? ' configured' : ' (set GOOGLE_SITE_VERIFICATION)'),
        (c.url_inspection_enabled ? '✅' : '⬜') + ' Service account for URL inspection' + (c.service_account_configured ? ' configured' : ' (optional)'),
        'ℹ️ ' + c.recommended_method + ' — ' + c.indexing_api_reason,
        (d.log && d.log.length) ? 'Last log entries: ' + d.log.length : 'No indexing log entries yet.'
      ];
      document.getElementById('gscStatus').innerHTML = '<div style="line-height:1.7">' + checks.map(x => WF.esc(x)).join('<br>') + '</div>';
    } catch (e) {
      document.getElementById('gscStatus').textContent = 'Status unavailable.';
    }
  }
  loadGsc();

  async function loadReach() {
    try {
      const d = await WF.api('/admin/analytics?limit=25');
      const t = d.totals;
      document.getElementById('reachTotals').innerHTML =
        '<p style="margin-top:6px"><strong>' + (t.today_views || 0) + '</strong> page views in the last 24h · <strong>' + (t.views || 0) + '</strong> total · across <strong>' + (t.pages || 0) + '</strong> different pages (' + (t.today_pages || 0) + ' viewed today).</p>';
      document.getElementById('reachList').innerHTML =
        '<div style="max-height:360px;overflow:auto;margin-top:8px">' + (d.popular.length ? d.popular.map(p =>
          '<div class="list-item" style="font-size:.83rem"><span style="width:70px;font-weight:700">' + p.views + '</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="' + WF.esc(p.url) + '" target="_blank" rel="noopener">' + WF.esc(p.url) + '</a></span>' +
          '<span class="muted">' + new Date(+p.last_seen * 1000).toLocaleString() + '</span></div>').join('') : '<p class="muted">No page views recorded yet.</p>') + '</div>';
    } catch (e) {
      document.getElementById('reachTotals').textContent = 'Reach data unavailable.';
    }
  }
  loadReach();

  async function loadReport() {
    try {
      const d = await WF.api('/admin/seo/report');
      const r = d.report;
      if (!r || r.run_at === 0) {
        document.getElementById('seoReport').innerHTML = '<p class="muted">No audit yet. Run one.</p>';
        return;
      }
      const sev = (n, color) => n ? '<span style="color:' + color + ';font-weight:600">' + n + '</span>' : '0';
      document.getElementById('seoReport').innerHTML =
        '<p>' + sev(r.high, '#d40000') + ' high · ' + sev(r.medium, '#c77700') + ' medium · ' + sev(r.low, '#777') + ' low · ran ' + new Date(+r.run_at * 1000).toLocaleString() + '</p>' +
        '<p class="muted" style="font-size:.85rem">Checked ' + (r.stats ? r.stats.checked : 0) + ' pages · ' + (r.stats ? r.stats.properties : 0) + ' properties · ' + (r.stats ? r.stats.locations : 0) + ' landing pages</p>' +
        '<div style="max-height:340px;overflow:auto">' + (r.issues.length ? r.issues.slice(0, 200).map(i =>
          '<div class="list-item" style="font-size:.83rem"><span style="width:60px;color:' + (i.sev === 'high' ? '#d40000' : i.sev === 'medium' ? '#c77700' : '#777') + '">' + WF.esc(i.sev) + '</span>' +
          '<span style="width:120px">' + WF.esc(i.code) + '</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + WF.esc(i.url || '') + '</span>' +
          '<span style="flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + WF.esc(i.msg || '') + '</span></div>').join('') : '<p class="muted">No issues — clean.</p>') + '</div>';
    } catch (e) {
      document.getElementById('seoReport').innerHTML = '<p class="muted">Report unavailable.</p>';
    }
  }
  loadReport();

  document.getElementById('seoRebuild').addEventListener('click', async () => {
    const b = document.getElementById('seoRebuild');
    b.disabled = true; b.textContent = 'Rebuilding…';
    try {
      const d = await WF.api('/admin/seo/rebuild-index', { method: 'POST' });
      WF.toast('Registry rebuilt: ' + d.indexed + ' pages');
      loadReport();
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Rebuild registry';
  });

  document.getElementById('seoRun').addEventListener('click', async () => {
    const b = document.getElementById('seoRun');
    b.disabled = true; b.textContent = 'Auditing…';
    try {
      const d = await WF.api('/admin/seo/audit', { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
      WF.toast('Audit complete: ' + d.report.total + ' issues');
      loadReport();
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Run full audit';
  });

  document.getElementById('seoValidate').addEventListener('click', async () => {
    const id = document.getElementById('seoPid').value.trim();
    if (!id) { WF.toast('Enter a property id'); return; }
    const out = document.getElementById('seoValOut');
    out.textContent = 'Validating…';
    try {
      const d = await WF.api('/admin/seo/validate-jsonld/' + encodeURIComponent(id));
      const checks = Object.keys(d.checks).map(k => (d.checks[k] ? '✅' : '❌') + ' ' + k.replace(/_/g, ' ')).join(' ');
      out.innerHTML = '<div style="line-height:1.6">' + checks + '</div>' + (d.errors && d.errors.length ? d.errors.map(e => '<div style="color:#d40000">' + WF.esc(e) + '</div>').join('') : '');
    } catch (e) {
      if (e.status === 404) out.textContent = 'Property not found.';
      else out.textContent = e.message;
    }
  });

  (async () => {
    try {
      const d = await WF.api('/admin/properties/seo');
      const s = d.summary;
      const line = s.total + ' properties · ' + s.with_media + ' with media · ' + s.with_video + ' with video · ' + s.with_coordinates + ' with coordinates · ' + s.with_location + ' with location · ' + s.location_verified + ' location-verified';
      document.getElementById('propSeoStatus').textContent = line;
    } catch (e) {
      document.getElementById('propSeoStatus').textContent = 'Could not load property SEO status.';
    }
  })();
};

// ----- Location database admin -----
WF.views.adminLocations = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Locations', 'Global location database');
  app.innerHTML = '<div class="page-title">📍 Locations</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>Add location</h3>' +
    '<div class="form-row" style="display:flex;gap:10px">' +
    '<input id="loc_name" placeholder="Name (real only)" style="flex:1">' +
    '<select id="loc_type"><option value="state">State/Province</option><option value="region">Region</option><option value="county">County</option><option value="city">City</option><option value="town">Town</option><option value="village">Village</option><option value="district">District</option></select>' +
    '<input id="loc_cc" placeholder="Country code" maxlength="2" style="width:90px">' +
    '</div>' +
    '<div class="form-row" style="display:flex;gap:10px">' +
    '<input id="loc_parent" placeholder="Parent name (optional)" style="flex:1">' +
    '<input id="loc_lat" placeholder="Lat" style="width:90px">' +
    '<input id="loc_lng" placeholder="Lng" style="width:90px">' +
    '</div>' +
    '<button class="btn btn-primary" id="loc_add">Add location</button></div>' +
    '<div class="card" style="margin-top:16px"><h3>Browse</h3>' +
    '<div class="form-row" style="display:flex;gap:10px"><input id="locCountry" placeholder="Country code (e.g. US)" style="width:120px"><input id="locQ" placeholder="Search name or type…" style="flex:1"><button class="btn btn-outline" id="loc_search">Search</button></div>' +
    '<div id="locList" class="muted" style="font-size:.86rem;margin-top:8px">Loading…</div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Actions</h3>' +
    '<p class="muted" style="font-size:.9rem">Re-run the automatic location assignment for every published listing.</p>' +
    '<button class="btn btn-outline" id="loc_reassign">Reassign listing locations now</button></div>';

  const esc = WF.esc;
  async function load() {
    const cc = document.getElementById('locCountry').value.trim().toUpperCase();
    const q = document.getElementById('locQ').value.trim();
    const list = document.getElementById('locList');
    try {
      const d = await WF.api('/admin/locations' + (cc ? '?country=' + cc : '') + (q ? (cc ? '&' : '?') + 'q=' + encodeURIComponent(q) : ''));
      list.innerHTML = d.locations.length
        ? '<div>Showing ' + d.locations.length + ' locations</div>' + d.locations.slice(0, 250).map(l =>
          '<div class="list-item" style="flex-wrap:wrap">' +
          '<div style="flex:1;min-width:140px"><strong>' + esc(l.name) + '</strong> <span class="muted" style="font-size:.8rem">' + esc(l.type) + ' · ' + esc(l.country_code) + '</span>' +
          (l.verified ? ' <span class="pill">verified</span>' : '') + (l.status === 'pending' ? ' <span class="pill" style="background:#c77700">pending</span>' : '') +
          '<div class="muted" style="font-size:.75rem">' + (l.listing_count || 0) + ' listing(s) · ' + (l.lat != null ? l.lat + ',' + l.lng : 'no coords') + '</div></div>' +
          '<button class="btn btn-sm btn-outline" data-ver="' + l.id + '" data-v="' + (l.verified ? 1 : 0) + '">' + (l.verified ? 'Unverify' : 'Verify') + '</button>' +
          '<button class="btn btn-sm btn-outline" data-app="' + l.id + '" data-s="' + (l.status || '') + '">' + (l.status === 'pending' ? 'Approve' : l.status === 'approved' ? 'Reject' : 'Approve') + '</button>' +
          '<a class="btn btn-sm btn-outline" target="_blank" rel="noopener" href="/api/location/' + l.id + '/listings">Listings</a>' +
          (l.listing_count === 0 ? '<button class="btn btn-sm btn-danger" data-del="' + l.id + '">Delete</button>' : '') +
          '</div>').join('')
        : '<p class="muted">No locations found.</p>';

      list.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', async () => {
        const v = b.dataset.v === '1' ? 0 : 1;
        await WF.api('/admin/locations/' + b.dataset.ver, { method: 'PUT', body: JSON.stringify({ verified: v, status: v ? 'approved' : undefined }) });
        WF.toast(v ? 'Verified' : 'Unverified'); load();
      }));
      list.querySelectorAll('[data-app]').forEach(b => b.addEventListener('click', async () => {
        const s = b.dataset.s === 'pending' ? 'approved' : (b.dataset.s === 'approved' ? 'rejected' : 'approved');
        await WF.api('/admin/locations/' + b.dataset.app, { method: 'PUT', body: JSON.stringify({ status: s }) });
        WF.toast('Status → ' + s); load();
      }));
      list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this location?')) return;
        try {
          await WF.api('/admin/locations/' + b.dataset.del, { method: 'DELETE' });
          WF.toast('Deleted'); load();
        } catch (e) { WF.toast(e.message); }
      }));
    } catch (e) {
      list.innerHTML = '<p class="muted">Could not load locations.</p>';
    }
  }
  load();

  document.getElementById('loc_search').addEventListener('click', load);

  document.getElementById('loc_add').addEventListener('click', async () => {
    try {
      const body = {
        name: document.getElementById('loc_name').value,
        type: document.getElementById('loc_type').value,
        country_code: document.getElementById('loc_cc').value,
        parent_name: document.getElementById('loc_parent').value || undefined,
        lat: document.getElementById('loc_lat').value === '' ? undefined : parseFloat(document.getElementById('loc_lat').value),
        lng: document.getElementById('loc_lng').value === '' ? undefined : parseFloat(document.getElementById('loc_lng').value),
        verified: true
      };
      await WF.api('/admin/locations', { method: 'POST', body: JSON.stringify(body) });
      WF.toast('Location added'); load();
      document.getElementById('loc_name').value = '';
    } catch (e) { WF.toast(e.message); }
  });

  document.getElementById('loc_reassign').addEventListener('click', async () => {
    const b = document.getElementById('loc_reassign');
    b.disabled = true; b.textContent = 'Reassigning…';
    try {
      const d = await WF.api('/admin/locations/reassign', { method: 'POST' });
      WF.toast('Assigned ' + d.assigned + ' of ' + d.reviewed + ' listings');
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Reassign listing locations now';
  });
};

// ----- Multi-Platform Distribution dashboard -----
// Publish once on WorldFront.News → distribute to every connected platform.
// Results are the honest live ledger (real HTTP) — no fake successes.
WF.views.adminDistribution = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Distribution', 'Multi-platform distribution');
  app.innerHTML = '<div class="page-title">Distribution</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<p class="muted">Publish once on WorldFront.News → distribute to every eligible platform. ' +
    'Every row is a real, verified destination; results are the honest ledger.</p>' +
    '<div class="grid grid-4" id="dist_cards"></div>' +
    '<div class="card" style="margin-top:14px"><h3>Run now</h3>' +
    '<div class="form-row"><label><input type="checkbox" id="dist_no_discover" checked> include daily discovery (find new platforms)</label></div>' +
    '<button class="btn btn-primary" id="dist_run">Run distribution + discovery now</button> ' +
    '<button class="btn btn-outline" id="dist_rss">Regenerate RSS feed</button>' +
    '<span style="float:right" class="muted" id="dist_feed"></span></div>' +
    '<div class="card" style="margin-top:14px"><h3>Platforms</h3><div id="dist_platforms"></div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Onboarding tasks (need you)</h3><div id="dist_tasks"></div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Recent delivery ledger</h3><div id="dist_log"></div></div>';

  loadOverview();
  loadPlatforms();
  loadTasks();
  loadLog();

  document.getElementById('dist_run').addEventListener('click', async () => {
    const b = document.getElementById('dist_run');
    b.disabled = true; b.textContent = 'Running… this can take a minute';
    try {
      const d = await WF.api('/admin/distribution/run', { method: 'POST', body: JSON.stringify({ no_discovery: !document.getElementById('dist_no_discover').checked }) });
      const dd = d.distributed || {};
      WF.toast('Run done: shared=' + dd.ok + ' discoverable=' + dd.discoverable + ' pending=' + dd.pending + ' failed=' + dd.failed);
      loadOverview(); loadPlatforms(); loadTasks(); loadLog();
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Run distribution + discovery now';
  });
  document.getElementById('dist_rss').addEventListener('click', async () => {
    try {
      const d = await WF.api('/admin/distribution/refresh-rss', { method: 'POST' });
      WF.toast('RSS regenerated: ' + d.feed);
      setFeed(d.feed);
    } catch (e) { WF.toast(e.message); }
  });

  function setFeed(url) {
    const f = document.getElementById('dist_feed');
    if (f && url) f.innerHTML = 'Feed: <a target="_blank" rel="noopener" href="' + url + '">' + WF.esc(url) + '</a>';
  }

  async function loadOverview() {
    try {
      const o = await WF.api('/admin/distribution/overview');
      const p = o.platforms;
      const today = o.today;
      setCard('dist_cards0', 'Platforms', p.discovered + ' total · ' + p.connected + ' connected');
      setCard('dist_cards1', 'Today', (today.article_shares + today.product_shares) + ' shared · ' + today.failed + ' failed');
      setCard('dist_cards2', 'Onboarding', o.tasks.open + ' open tasks');
      setCard('dist_cards3', 'Channels', o.active_channels + ' active connectors');
      setFeed(o.feed_url);
      const el = document.getElementById('dist_cards');
      if (el) {
        el.innerHTML = '<div class="card" id="dist_cards0"></div><div class="card" id="dist_cards1"></div><div class="card" id="dist_cards2"></div><div class="card" id="dist_cards3"></div>';
        setCard('dist_cards0', 'Platforms', p.discovered + ' total · ' + p.connected + ' connected');
        setCard('dist_cards1', 'Today', (today.article_shares + today.product_shares) + ' shared · ' + today.failed + ' failed');
        setCard('dist_cards2', 'Onboarding', o.tasks.open + ' open tasks');
        setCard('dist_cards3', 'Channels', o.active_channels + ' active connectors');
      }
    } catch (e) {}
  }

  async function loadPlatforms() {
    const el = document.getElementById('dist_platforms');
    try {
      const d = await WF.api('/admin/distribution/platforms');
      const rows = d.platforms || [];
      el.innerHTML =
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Platform</th><th>Market</th><th>Access</th><th>Method</th><th>Status</th><th>Last</th><th>Action</th></tr></thead><tbody>' +
        rows.map((p) => {
          const accessBadge = p.access === 'none' ? '<span class="pill">no key</span>' :
            p.access === 'free_key' ? '<span class="pill" style="background:#1a7f37">free key</span>' :
            p.access === 'oauth' ? '<span class="pill" style="background:#1f6feb">OAuth</span>' :
            p.access === 'webhook' ? '<span class="pill" style="background:#8957e5">webhook</span>' :
            p.access === 'paid' ? '<span class="pill" style="background:#d40000">paid</span>' :
            '<span class="pill" style="background:#c77700">manual</span>';
          const status = p.linked ? '<span class="pill" style="background:#1a7f37">connected</span>'
            : (p.status === 'connected' ? '<span class="pill" style="background:#1a7f37">linked</span>'
               : p.manual_approval ? '<span class="pill" style="background:#c77700">approval</span>'
               : '<span class="pill">new</span>');
          const last = p.c_last_success || p.last_success
            ? new Date((p.c_last_success || p.last_success) * 1000).toISOString().slice(0, 10)
            : (p.last_failure ? 'fail ' + new Date(p.last_failure * 1000).toISOString().slice(0, 10) : '—');
          const credsInput = p.access === 'free_key' || p.access === 'webhook' ? p.slug : '';
          const act = p.linked
            ? '<button class="btn btn-sm btn-danger" data-disc="' + p.slug + '">Disconnect</button>'
            : '<button class="btn btn-sm btn-outline" data-conn="' + p.slug + '">' + (p.access === 'manual' || p.access === 'paid' ? 'Manual submit' : 'Connect') + '</button>';
          return '<tr><td><strong>' + WF.esc(p.name) + '</strong>' +
            '<div class="muted" style="font-size:.7rem"><a target="_blank" rel="noopener" href="' + WF.esc(p.url || p.signup_url || '#') + '">' + WF.esc(p.region + ' · ' + (p.country_name || '')) + '</a></div>' +
            '<div class="muted" style="font-size:.7rem">' + (p.types || []).join(', ') + (p.notes ? ' — ' + WF.esc(p.notes.slice(0, 90)) : '') + '</div></td>' +
            '<td>' + WF.esc(p.country_name || p.country_code) + '</td>' +
            '<td>' + accessBadge + (p.paid ? ' 💰' : '') + '</td>' +
            '<td class="muted">' + WF.esc(p.method) + '</td>' +
            '<td>' + status + '</td>' +
            '<td class="muted" style="font-size:.72rem">' + last + '</td>' +
            '<td>' + act + (credsInput ? ' <button class="btn btn-sm btn-outline" data-key="' + credsInput + '">key</button>' : '') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';

      el.querySelectorAll('[data-conn]').forEach((b) => b.addEventListener('click', () => connectModal(b.dataset.conn, d.platforms.find((x) => x.slug === b.dataset.conn))));
      el.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => connectModal(b.dataset.key, d.platforms.find((x) => x.slug === b.dataset.key))));
      el.querySelectorAll('[data-disc]').forEach((b) => b.addEventListener('click', async () => {
        await WF.api('/admin/distribution/disconnect', { method: 'POST', body: JSON.stringify({ slug: b.dataset.disc }) });
        WF.toast('Disconnected'); loadPlatforms(); loadOverview();
      }));
    } catch (e) { el.innerHTML = '<p class="muted">Could not load platforms.</p>'; }
  }

  function connectModal(slug, p) {
    if (!p) return;
    const fields = [];
    if (slug === 'mastodon' || slug === 'mastodon-au' || slug === 'mastodon-jp' || slug === 'mastodon-de') {
      fields.push({ k: 'instance', l: 'Instance URL', v: p.url || 'https://mastodon.social', ph: 'https://mastodon.example' });
      fields.push({ k: 'token', l: 'Access token', v: '', ph: 'paste token from instance → Preferences → Development' });
    } else if (slug === 'telegram') {
      fields.push({ k: 'token', l: 'Bot token', v: '', ph: 'from @BotFather' });
      fields.push({ k: 'chat_id', l: 'Channel/chat id', v: '', ph: '@mychannel or numeric id' });
    } else if (slug === 'discord') {
      fields.push({ k: 'webhook_url', l: 'Webhook URL', v: '', ph: 'https://discord.com/api/webhooks/...' });
    } else if (slug === 'devto') {
      fields.push({ k: 'api_key', l: 'dev.to API key', v: '', ph: 'dev.to/settings/account' });
    } else if (slug === 'blogger') {
      fields.push({ k: 'api_key', l: 'Google API key', v: '', ph: 'Blogger Data API v3' });
      fields.push({ k: 'blog_id', l: 'Blog id', v: '', ph: 'blog URL id' });
    }
    const body = '<div class="card"><h3>Connect — ' + WF.esc(p.name) + '</h3><p class="muted">' + WF.esc(p.access + ' · ' + (p.notes || '').slice(0, 220)) + '</p>' +
      fields.map((f) => '<div class="form-row"><label>' + WF.esc(f.l) + '</label><input id="ck_' + f.k + '" value="' + WF.esc(f.v) + '" placeholder="' + WF.esc(f.ph || '') + '"></div>').join('') +
      (fields.length ? '<label class="form-row"><span class="muted">Account label</span><input id="ck_label" placeholder="optional"></label>' : '') +
      '<div class="form-row"><input id="ck_url" placeholder="URL you submitted (manual submit only) ' + (slug.startsWith('http') ? '' : '') + '"></div>' +
      '<button class="btn btn-primary" id="ck_save">' + (fields.length ? 'Save connection' : 'Mark manual submission done') + '</button> <button class="btn btn-outline" id="ck_close">Close</button></div>';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(8,8,14,.7);z-index:99;display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;overflow:auto';
    modal.innerHTML = '<div style="max-width:520px;width:100%;background:#11101a;border:1px solid #2a2a3d;border-radius:12px;padding:20px">' + body + '</div>';
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#ck_close').addEventListener('click', close);
    modal.querySelector('#ck_save').addEventListener('click', async () => {
      try {
        const creds = {};
        fields.forEach((f) => { const v = (document.getElementById('ck_' + f.k) || {}).value; if (v) creds[f.k] = v; });
        const urlVal = (document.getElementById('ck_url') || {}).value || '';
        if (fields.length) {
          if (!Object.keys(creds).length) return WF.toast('Enter at least one field');
          await WF.api('/admin/distribution/connect', { method: 'POST', body: JSON.stringify({ slug, label: (document.getElementById('ck_label') || {}).value || '', creds }) });
          WF.toast(p.name + ' connected');
        } else {
          await WF.api('/admin/distribution/manual-share', { method: 'POST', body: JSON.stringify({ slug, url: urlVal }) });
          WF.toast('Manual submission recorded'); loadLog(); loadTasks();
        }
        close(); loadPlatforms(); loadOverview();
      } catch (e) { WF.toast(e.message); }
    });
  }

  async function loadTasks() {
    const el = document.getElementById('dist_tasks');
    try {
      const d = await WF.api('/admin/distribution/tasks');
      const open = d.tasks.filter((t) => t.status === 'open');
      el.innerHTML = open.length
        ? open.map((t) => {
            const p = { name: t.platform_slug };
            return '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(t.platform_slug) + '</strong> — ' + WF.esc(t.action) +
              '<div class="muted" style="font-size:.78rem">' + WF.esc(t.guidance || '') + '</div>' +
              (t.submit_url ? '<a class="btn btn-sm btn-outline" style="margin-top:4px" target="_blank" rel="noopener" href="' + WF.esc(t.submit_url) + '">Open signup page</a>' : '') +
              '</div>' +
              '<button class="btn btn-sm btn-outline" data-done="' + t.id + '">Mark done</button>' +
              '<button class="btn btn-sm btn-danger" data-skip="' + t.id + '">Skip</button></div>';
          }).join('')
        : '<p class="muted">No open tasks. Minutes well spent — run distribution to discover more opportunities.</p>';
      el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
        await WF.api('/admin/distribution/tasks/' + b.dataset.done + '/done', { method: 'POST' });
        WF.toast('Task done'); loadTasks(); loadOverview();
      }));
      el.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', async () => {
        await WF.api('/admin/distribution/tasks/' + b.dataset.skip + '/skip', { method: 'POST' });
        loadTasks();
      }));
    } catch (e) { el.innerHTML = '<p class="muted">Could not load tasks.</p>'; }
  }

  async function loadLog() {
    const el = document.getElementById('dist_log');
    try {
      const d = await WF.api('/admin/distribution/log?limit=30');
      const rows = d.log || [];
      el.innerHTML = rows.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Content</th><th>Platform</th><th>Status</th><th>HTTP</th><th>Result</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><td class="muted" style="font-size:.72rem">' + new Date(r.attempted_at * 1000).toISOString().slice(0, 16) + '</td>' +
            '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a target="_blank" rel="noopener" href="' + WF.esc(r.content_url) + '">' + WF.esc(r.title || r.content_url) + '</a><div class="muted" style="font-size:.7rem">' + WF.esc(r.content_type) + '</div></td>' +
            '<td>' + WF.esc(r.platform || r.platform_slug) + '</td>' +
            '<td><span class="pill" style="background:' + (r.status === 'ok' ? '#1a7f37' : r.status === 'discoverable' ? '#1f6feb' : r.status === 'pending' ? '#c77700' : '#d40000') + '">' + WF.esc(r.status) + '</span>' + (r.http_status ? ' <span class="muted">' + r.http_status + '</span>' : '') + '</td>' +
            '<td class="muted" style="font-size:.75rem;max-width:260px">' + WF.esc(r.message || '') + (r.detail_url ? ' <a target="_blank" rel="noopener" href="' + WF.esc(r.detail_url) + '">link</a>' : '') + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="muted">No distribution activity yet. Run it now.</p>';
    } catch (e) { el.innerHTML = '<p class="muted">Could not load ledger.</p>'; }
  }
};

// ----- Admin account: change email & password -----
WF.views.adminAccount = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Account', 'Your admin account settings');
  const u = WF.state.user || {};
  app.innerHTML = '<div class="page-title">Admin Account</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="card" style="margin-top:12px"><h3>Signed in as</h3>' +
    '<p class="muted" id="ac_who">' + WF.esc(u.email || '') + ' (' + WF.esc(u.username || '') + ', ' + WF.esc(u.role || '') + ')</p></div>' +
    '<div class="card" style="margin-top:16px"><h3>Change email</h3>' +
    '<div class="form-row"><label>Current password</label><input id="ac_pw_email" type="password" autocomplete="current-password"></div>' +
    '<div class="form-row"><label>New email</label><input id="ac_email" type="email" value="' + WF.esc(u.email || '') + '"></div>' +
    '<button class="btn btn-primary" id="ac_save_email">Save email</button></div>' +
    '<div class="card" style="margin-top:16px"><h3>Change password</h3>' +
    '<div class="form-row"><label>Current password</label><input id="ac_pw_cur" type="password" autocomplete="current-password"></div>' +
    '<div class="form-row"><label>New password (min 8 characters)</label><input id="ac_pw_new" type="password" autocomplete="new-password"></div>' +
    '<ul class="muted" style="font-size:.8rem;margin:6px 0 10px">' +
    '<li>Other signed-in sessions are logged out when you change the password.</li>' +
    '<li>You will use the new password for every future login.</li></ul>' +
    '<button class="btn btn-primary" id="ac_save_pw">Save password</button></div>';

  document.getElementById('ac_save_email').addEventListener('click', async () => {
    const b = document.getElementById('ac_save_email');
    b.disabled = true; b.textContent = 'Saving…';
    try {
      const d = await WF.api('/auth/me/change-email', { method: 'POST', body: JSON.stringify({
        current_password: document.getElementById('ac_pw_email').value,
        new_email: document.getElementById('ac_email').value
      }) });
      WF.state.user = d.user; localStorage.setItem('wf-user', JSON.stringify(d.user));
      document.getElementById('ac_who').textContent = d.user.email + ' (' + d.user.username + ', ' + d.user.role + ')';
      WF.toast('Email updated to ' + d.user.email);
      document.getElementById('ac_pw_email').value = '';
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Save email';
  });

  document.getElementById('ac_save_pw').addEventListener('click', async () => {
    const b = document.getElementById('ac_save_pw');
    b.disabled = true; b.textContent = 'Saving…';
    try {
      const d = await WF.api('/auth/me/change-password', { method: 'POST', body: JSON.stringify({
        current_password: document.getElementById('ac_pw_cur').value,
        new_password: document.getElementById('ac_pw_new').value
      }) });
      WF.toast(d.message || 'Password updated');
      document.getElementById('ac_pw_cur').value = '';
      document.getElementById('ac_pw_new').value = '';
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Save password';
  });
};
