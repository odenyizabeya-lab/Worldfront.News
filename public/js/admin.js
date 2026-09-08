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
      '<a class="chip" href="#/admin/social">Social Media</a>' +
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

// =====================================================================
// SOCIAL MEDIA AUTOMATION — KCO Global Online Marketplace
// Automatic posting (primary) + manual posting (secondary)
// =====================================================================

// ----- Social Media Overview -----
WF.views.adminSocial = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin'); return; }
  setMeta('Social Media', 'Social media automation overview');
  app.innerHTML = '<div class="page-title">📱 Social Media Automation</div><a class="see-all" href="#/admin">← Dashboard</a>' +
    '<div class="chip-row">' +
      '<a class="chip" href="#/admin/social/accounts">Connected Accounts</a>' +
      '<a class="chip" href="#/admin/social/auto">Automatic Posting</a>' +
      '<a class="chip" href="#/admin/social/compose">Manual Posting</a>' +
      '<a class="chip" href="#/admin/social/queue">Content Queue</a>' +
      '<a class="chip" href="#/admin/social/logs">Post Logs</a>' +
    '</div>' +
    '<div class="grid grid-4" id="soc_cards"></div>' +
    '<div class="card" style="margin-top:14px"><h3>Automation Control</h3>' +
    '<div id="soc_autopause" style="margin-bottom:10px">Checking…</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="soc_runScheduler" style="background:#0a7d3c">Run scheduler now</button>' +
    '<button class="btn btn-outline" id="soc_pause">Pause all automation</button>' +
    '<button class="btn btn-outline" id="soc_resume">Resume automation</button>' +
    '</div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Upcoming Scheduled Posts</h3><div id="soc_upcoming" class="muted">Loading…</div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Recent Posts</h3><div id="soc_recent" class="muted">Loading…</div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Recent Post Log</h3><div id="soc_log" class="muted">Loading…</div></div>';

  loadSocialOverview();
  loadSocialRecent();
  loadSocialLog();
  loadSocialControls();

  document.getElementById('soc_pause').addEventListener('click', async () => {
    await WF.api('/social/scheduler/pause', { method: 'POST' });
    WF.toast('Automation paused'); loadSocialControls();
  });
  document.getElementById('soc_resume').addEventListener('click', async () => {
    await WF.api('/social/scheduler/resume', { method: 'POST' });
    WF.toast('Automation resumed'); loadSocialControls();
  });
  document.getElementById('soc_runScheduler').addEventListener('click', async () => {
    const b = document.getElementById('soc_runScheduler');
    b.disabled = true; b.textContent = 'Running…';
    try {
      const d = await WF.api('/social/scheduler/run', { method: 'POST' });
      const r = d.result || {};
      WF.toast('Scheduler done: published=' + r.posts_published + ' created=' + r.posts_created + ' failed=' + r.posts_failed + ' retries=' + r.retries);
      loadSocialOverview(); loadSocialRecent(); loadSocialLog();
    } catch (e) { WF.toast(e.message); }
    b.disabled = false; b.textContent = 'Run scheduler now';
  });

  async function loadSocialOverview() {
    try {
      const s = await WF.api('/social/stats');
      const el = document.getElementById('soc_cards');
      if (!el) return;
      el.innerHTML =
        '<div class="card"><h3>Accounts</h3><div class="page-title" style="font-size:1.5rem;margin:4px 0">' + s.accounts.connected + ' connected</div><div class="muted" style="font-size:.8rem">' + s.accounts.total + ' total · ' + s.accounts.enabled + ' enabled</div></div>' +
        '<div class="card"><h3>Posts</h3><div class="page-title" style="font-size:1.5rem;margin:4px 0">' + s.posts.published + ' published</div><div class="muted" style="font-size:.8rem">' + s.posts.queued + ' queued · ' + s.posts.failed + ' failed</div></div>' +
        '<div class="card"><h3>Today</h3><div class="page-title" style="font-size:1.5rem;margin:4px 0">' + s.posts.today_published + ' posted</div><div class="muted" style="font-size:.8rem">' + s.posts.today_failed + ' failed today</div></div>' +
        '<div class="card"><h3>Rules</h3><div class="page-title" style="font-size:1.5rem;margin:4px 0">' + s.rules.enabled + ' active</div><div class="muted" style="font-size:.8rem">' + s.rules.total + ' total rules</div></div>';
    } catch (e) {
      document.getElementById('soc_cards').innerHTML = '<p class="muted">Could not load overview.</p>';
    }
  }

  async function loadSocialControls() {
    try {
      const s = await WF.api('/social/stats');
      const el = document.getElementById('soc_autopause');
      const paused = s.automation_paused;
      const lastRun = s.last_run && s.last_run.value ? new Date(+s.last_run.value * 1000).toLocaleString() : 'never';
      el.innerHTML = paused
        ? '<span class="pill" style="background:#d40000">PAUSED</span> — Automatic posting is paused. Click "Resume automation" to continue.'
        : '<span class="pill" style="background:#1a7f37">ACTIVE</span> — Automatic posting is running. Last scheduler run: ' + lastRun;
    } catch (e) {}
  }

  async function loadSocialRecent() {
    const el = document.getElementById('soc_recent');
    try {
      const d = await WF.api('/social/posts?limit=10');
      const posts = (d.posts || []).slice(0, 10);
      el.innerHTML = posts.length
        ? posts.map(p => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(p.content_title || p.content_url || 'Post ' + p.id) + '</strong>' +
          '<div class="muted" style="font-size:.75rem">' + WF.esc(p.platform || '') + ' · ' + WF.esc(p.content_type || '') + ' · ' + WF.esc(p.post_type || '') + '</div></div>' +
          '<span class="pill" style="background:' + (p.status === 'published' ? '#1a7f37' : p.status === 'failed' ? '#d40000' : p.status === 'queued' || p.status === 'scheduled' ? '#1f6feb' : '#c77700') + '">' + WF.esc(p.status) + '</span></div>').join('')
        : '<p class="muted">No posts yet.</p>';
    } catch (e) { el.innerHTML = '<p class="muted">Could not load posts.</p>'; }
  }

  async function loadSocialLog() {
    const el = document.getElementById('soc_log');
    try {
      const d = await WF.api('/social/logs?limit=15');
      const logs = (d.logs || []).slice(0, 15);
      el.innerHTML = logs.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Platform</th><th>Action</th><th>Status</th><th>Message</th></tr></thead><tbody>' +
          logs.map(l => '<tr><td class="muted" style="font-size:.72rem">' + new Date(l.attempted_at * 1000).toISOString().slice(0, 16) + '</td>' +
            '<td>' + WF.esc(l.platform || '') + '</td>' +
            '<td class="muted">' + WF.esc(l.action || '') + '</td>' +
            '<td><span class="pill" style="background:' + (l.status === 'ok' ? '#1a7f37' : '#d40000') + '">' + WF.esc(l.status) + '</span></td>' +
            '<td class="muted" style="font-size:.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + WF.esc(l.message || '') + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="muted">No activity logged yet.</p>';
    } catch (e) { el.innerHTML = '<p class="muted">Could not load log.</p>'; }
  }

  async function loadUpcoming() {
    const el = document.getElementById('soc_upcoming');
    try {
      const d = await WF.api('/social/scheduler/next');
      if (d.next) {
        const n = d.next;
        el.innerHTML = '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(n.content_title || n.content_url || '') + '</strong>' +
          '<div class="muted">' + WF.esc(n.platform || '') + ' · scheduled ' + new Date(n.scheduled_at * 1000).toLocaleString() + '</div></div>' +
          '<span class="pill" style="background:#1f6feb">' + WF.esc(n.status) + '</span></div>';
      } else {
        el.innerHTML = '<p class="muted">No upcoming scheduled posts.</p>';
      }
    } catch (e) { el.innerHTML = '<p class="muted">Could not load.</p>'; }
  }
  loadUpcoming();
};

// ----- Connected Accounts -----
WF.views.adminSocialAccounts = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin/social'); return; }
  setMeta('Connected Accounts', 'Manage social media connections');
  app.innerHTML = '<div class="page-title">🔌 Connected Accounts</div><a class="see-all" href="#/admin/social">← Social</a>' +
    '<div class="card" style="margin-top:12px"><h3>Connect a new platform</h3>' +
    '<p class="muted" style="font-size:.9rem">Connect your official accounts through each platform\'s approved API. No passwords are ever requested.</p>' +
    '<div id="soc_platformList"></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Your Connected Accounts</h3><div id="soc_accounts"></div></div>';

  loadPlatforms();
  loadAccounts();

  async function loadPlatforms() {
    const el = document.getElementById('soc_platformList');
    try {
      const d = await WF.api('/social/platforms');
      el.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Platform</th><th>Content</th><th>Requirements</th><th>Action</th></tr></thead><tbody>' +
        d.platforms.map(p => {
          const reqBadges = [];
          if (p.requires_app_review) reqBadges.push('<span class="pill" style="background:#c77700">app review</span>');
          if (p.requires_paid) reqBadges.push('<span class="pill" style="background:#d40000">paid plan</span>');
          if (p.max_caption) reqBadges.push('<span class="pill">' + p.max_caption + ' chars</span>');
          return '<tr><td><strong>' + WF.esc(p.name) + '</strong></td>' +
            '<td class="muted" style="font-size:.75rem">' + (p.content_types || []).join(', ') + '</td>' +
            '<td>' + reqBadges.join(' ') + '</td>' +
            '<td><button class="btn btn-sm btn-primary" data-conn="' + p.slug + '">Connect</button></td></tr>';
        }).join('') +
        '</tbody></table></div>';

      el.querySelectorAll('[data-conn]').forEach(b => b.addEventListener('click', () => connectModal(b.dataset.conn, d.platforms.find(x => x.slug === b.dataset.conn))));
    } catch (e) {
      el.innerHTML = '<p class="muted">Could not load platforms.</p>';
    }
  }

  async function loadAccounts() {
    const el = document.getElementById('soc_accounts');
    try {
      const d = await WF.api('/social/accounts');
      const accounts = d.accounts || [];
      el.innerHTML = accounts.length
        ? accounts.map(a => {
            const statusBadge = !a.connected ? '<span class="pill" style="background:#555">disconnected</span>'
              : a.enabled ? '<span class="pill" style="background:#1a7f37">connected</span>'
              : '<span class="pill" style="background:#c77700">disabled</span>';
            const tokenBadge = a.token_valid ? '' : '<span class="pill" style="background:#d40000">token expired</span>';
            return '<div class="list-item"><div style="flex:1">' +
              '<strong>' + WF.esc(a.account_label || a.account_name || a.platform) + '</strong> ' +
              '<span class="muted">(' + WF.esc(a.platform_info || a.platform) + ')</span>' + statusBadge + tokenBadge +
              '<div class="muted" style="font-size:.75rem">' + a.total_posts + ' posts · ' + a.queued_posts + ' queued · ' + a.posting_rules_count + ' rules' +
              (a.last_error ? ' · <span style="color:#d40000">' + WF.esc(a.last_error) + '</span>' : '') + '</div></div>' +
              (a.connected ? '<button class="btn btn-sm btn-outline" data-tog="' + a.id + '" data-en="' + a.enabled + '">' + (a.enabled ? 'Disable' : 'Enable') + '</button>' : '') +
              '<button class="btn btn-sm btn-danger" data-disc="' + a.id + '" data-conn="' + (a.connected ? '1' : '0') + '">' + (a.connected ? 'Disconnect' : 'Remove') + '</button></div>';
          }).join('')
        : '<p class="muted">No accounts connected yet. Use the table above to connect.</p>';

      el.querySelectorAll('[data-tog]').forEach(b => b.addEventListener('click', async () => {
        await WF.api('/social/accounts/' + b.dataset.tog + '/toggle', { method: 'POST' });
        loadAccounts();
      }));
      el.querySelectorAll('[data-disc]').forEach(b => b.addEventListener('click', async () => {
        const connected = b.dataset.conn === '1';
        if (!confirm(connected ? 'Disconnect this account?' : 'Remove this account record?')) return;
        if (connected) {
          await WF.api('/social/accounts/disconnect', { method: 'POST', body: JSON.stringify({ account_id: +b.dataset.disc }) });
        } else {
          await WF.api('/social/accounts/' + b.dataset.disc, { method: 'DELETE' });
        }
        WF.toast(connected ? 'Disconnected' : 'Removed');
        loadAccounts();
      }));
    } catch (e) {
      el.innerHTML = '<p class="muted">Could not load accounts.</p>';
    }
  }

  function connectModal(slug, p) {
    if (!p) return;
    const isOAuth = !p.no_oauth;
    let body;
    if (isOAuth) {
      body = '<div class="card"><h3>Connect — ' + WF.esc(p.name) + '</h3>' +
        '<p class="muted">You will be redirected to ' + WF.esc(p.name) + '\'s official authorization page. ' +
        'The connection uses the platform\'s official OAuth flow — your password is never requested or stored.</p>' +
        (p.requires_app_review ? '<div class="muted" style="margin:10px 0;padding:10px;background:rgba(199,119,0,.1);border-radius:8px;color:#c77700">⚠️ ' + WF.esc(p.review_note) + '</div>' : '') +
        (p.requires_paid ? '<div class="muted" style="margin:10px 0;padding:10px;background:rgba(212,0,0,.1);border-radius:8px;color:#d40000">⚠️ ' + WF.esc(p.paid_note) + '</div>' : '') +
        '<button class="btn btn-primary" id="sm_connect">Authorize on ' + WF.esc(p.name) + '</button> ' +
        '<button class="btn btn-outline" id="sm_close">Close</button></div>';
    } else {
      const fields = slug === 'telegram'
        ? '<div class="form-row"><label>Bot token</label><input id="sm_token" placeholder="from @BotFather"></div>' +
          '<div class="form-row"><label>Channel ID</label><input id="sm_channel" placeholder="@mychannel or -100123456789"></div>'
        : '<div class="form-row"><label>Webhook URL / Token</label><input id="sm_token" placeholder="' + (slug === 'discord' ? 'https://discord.com/api/webhooks/...' : 'paste token') + '"></div>';
      body = '<div class="card"><h3>Connect — ' + WF.esc(p.name) + '</h3>' +
        '<p class="muted" style="font-size:.85rem">' + (p.setup_steps || []).join('<br>') + '</p>' +
        fields +
        '<input class="form-row" id="sm_label" placeholder="Label (e.g. Marketing Channel)">' +
        '<button class="btn btn-primary" id="sm_save">Save connection</button> ' +
        '<button class="btn btn-outline" id="sm_close">Close</button></div>';
    }

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(8,8,14,.7);z-index:99;display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px;overflow:auto';
    modal.innerHTML = '<div style="max-width:560px;width:100%;background:#11101a;border:1px solid #2a2a3d;border-radius:12px;padding:22px">' + body + '</div>';
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('#sm_close').addEventListener('click', close);

    if (isOAuth) {
      modal.querySelector('#sm_connect').addEventListener('click', async () => {
        const b = modal.querySelector('#sm_connect');
        b.disabled = true; b.textContent = 'Opening authorization…';
        try {
          const d = await WF.api('/social/accounts/connect', { method: 'POST', body: JSON.stringify({ platform: slug }) });
          if (d.auth_url) {
            window.open(d.auth_url, '_blank', 'width=700,height=650');
            WF.toast('Authorization window opened. Complete it there, then click "Done" here.');
            b.textContent = 'Done — connection complete';
            b.disabled = false;
          } else {
            WF.toast(d.error || 'Could not start connection');
            WF.router.go('/admin/social/accounts');
            close();
          }
        } catch (e) {
          WF.toast(e.message);
          close();
        }
      });
    } else {
      modal.querySelector('#sm_save').addEventListener('click', async () => {
        try {
          const token = (document.getElementById('sm_token') || {}).value || '';
          const channel = (document.getElementById('sm_channel') || {}).value || '';
          const label = (document.getElementById('sm_label') || {}).value || '';
          const bodyData = { platform: slug, token, channel_id: channel, label };
          if (slug === 'discord') bodyData.webhook_url = token;
          const d = await WF.api('/social/accounts/connect', { method: 'POST', body: JSON.stringify(bodyData) });
          WF.toast('Connected!');
          close();
          loadAccounts(); loadPlatforms();
        } catch (e) { WF.toast(e.message); }
      });
    }
  }
};

// ----- Automatic Posting -----
WF.views.adminSocialAuto = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin/social'); return; }
  setMeta('Automatic Posting', 'Automatic social media posting controls');
  app.innerHTML = '<div class="page-title">⚡ Automatic Posting</div><a class="see-all" href="#/admin/social">← Social</a>' +
    '<p class="muted">Set up rules that automatically publish your newest articles, products, and news to your connected social accounts — even while you are offline. The scheduler runs on the server via cron.</p>' +
    '<div class="card" style="margin-top:14px"><h3>New Posting Rule</h3>' +
    '<div class="form-row"><label>Account</label><select id="rule_account"><option value="">Loading accounts…</option></select></div>' +
    '<div class="form-row"><label>Content types</label><div style="display:flex;gap:12px;flex-wrap:wrap" id="rule_types">' +
    '<label><input type="checkbox" value="articles" checked> News Articles</label>' +
    '<label><input type="checkbox" value="site_articles"> Site Articles</label>' +
    '<label><input type="checkbox" value="products"> Products</label>' +
    '<label><input type="checkbox" value="breaking"> Breaking News</label>' +
    '</div></div>' +
    '<div class="form-row" style="display:flex;gap:12px;flex-wrap:wrap">' +
    '<div style="flex:1"><label>Frequency</label><select id="rule_freq"><option value="hourly">Hourly</option><option value="daily" selected>Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>' +
    '<div style="flex:1"><label>Time of day (24h)</label><input type="time" id="rule_time" value="09:00"></div>' +
    '<div style="display:none;flex:1" id="rule_dowWrapper"><label>Day of week</label><select id="rule_dow"><option value="*">Every day</option><option value="mon">Monday</option><option value="tue">Tuesday</option><option value="wed">Wednesday</option><option value="thu">Thursday</option><option value="fri">Friday</option><option value="sat">Saturday</option><option value="sun">Sunday</option></select></div>' +
    '<div style="display:none;flex:1" id="rule_domWrapper"><label>Day of month (1-31)</label><input type="number" id="rule_dom" min="1" max="31" value="1"></div>' +
    '<div style="flex:1"><label>Max posts per day</label><input type="number" id="rule_max" value="3" min="1" max="50"></div>' +
    '</div>' +
    '<div class="form-row" style="display:flex;gap:12px;flex-wrap:wrap">' +
    '<label><input type="checkbox" id="rule_approval"> Require approval before publishing</label>' +
    '<label><input type="checkbox" id="rule_link" checked> Include link</label>' +
    '<label><input type="checkbox" id="rule_image" checked> Include image</label>' +
    '</div>' +
    '<div class="form-row"><label>Hashtag template (comma separated)</label><input id="rule_tags" placeholder="worldfront, news, tech, #kco"></div>' +
    '<div class="form-row"><label>Caption template (use {title} {url} {summary})</label><textarea id="rule_caption" rows="3" placeholder="Check out {title} at {url}"></textarea></div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="rule_add">Create Rule</button>' +
    '</div></div>' +
    '<div id="rule_list" class="card" style="margin-top:16px"><h3>Active Rules</h3><p class="muted">Loading…</p></div>';

  loadAccounts();
  loadRules();

  const freq = document.getElementById('rule_freq');
  freq.addEventListener('change', () => {
    document.getElementById('rule_dowWrapper').style.display = freq.value === 'weekly' ? 'block' : 'none';
    document.getElementById('rule_domWrapper').style.display = freq.value === 'monthly' ? 'block' : 'none';
  });

  async function loadAccounts() {
    try {
      const d = await WF.api('/social/accounts');
      const accounts = (d.accounts || []).filter(a => a.connected && a.enabled);
      document.getElementById('rule_account').innerHTML = accounts.length
        ? accounts.map(a => '<option value="' + a.id + '">' + WF.esc(a.account_label || a.account_name || a.platform) + ' (' + WF.esc(a.platform_info || a.platform) + ')</option>').join('')
        : '<option value="">No connected accounts — connect first</option>';
    } catch (e) {}
  }

  document.getElementById('rule_add').addEventListener('click', async () => {
    const accountId = document.getElementById('rule_account').value;
    if (!accountId) { WF.toast('Select an account first'); return; }

    const types = [];
    document.querySelectorAll('#rule_types input:checked').forEach(c => types.push(c.value));
    if (!types.length) { WF.toast('Select at least one content type'); return; }

    const body = {
      account_id: +accountId,
      content_types: types,
      frequency: document.getElementById('rule_freq').value,
      time_of_day: document.getElementById('rule_time').value,
      day_of_week: document.getElementById('rule_dow').value,
      day_of_month: document.getElementById('rule_freq').value === 'monthly' ? +document.getElementById('rule_dom').value || 1 : null,
      max_posts_per_day: +document.getElementById('rule_max').value || 3,
      require_approval: document.getElementById('rule_approval').checked,
      include_link: document.getElementById('rule_link').checked,
      include_image: document.getElementById('rule_image').checked,
      hashtag_template: document.getElementById('rule_tags').value,
      caption_template: document.getElementById('rule_caption').value
    };

    try {
      await WF.api('/social/rules', { method: 'POST', body: JSON.stringify(body) });
      WF.toast('Rule created');
      loadRules();
    } catch (e) { WF.toast(e.message); }
  });

  async function loadRules() {
    const el = document.getElementById('rule_list');
    try {
      const d = await WF.api('/social/rules');
      const rules = d.rules || [];
      el.innerHTML = '<h3>Posting Rules</h3>' + (rules.length
        ? rules.map(r => {
            let types = [];
            try { types = JSON.parse(r.content_types); } catch (e) {}
            return '<div class="list-item" style="flex-wrap:wrap"><div style="flex:1;min-width:220px">' +
              (r.enabled ? '<span class="pill" style="background:#1a7f37">on</span>' : '<span class="pill" style="background:#555">off</span>') +
              ' <strong>' + WF.esc(r.account_label || r.account_name || r.platform) + '</strong>' +
              '<div class="muted" style="font-size:.75rem">' + types.join(', ') + ' · ' + WF.esc(r.frequency) + ' at ' + WF.esc(r.time_of_day) + (r.frequency === 'monthly' && r.day_of_month ? ' on day ' + r.day_of_month : '') + ' · max ' + r.max_posts_per_day + '/day' +
              (r.require_approval ? ' · approval' : '') + '</div></div>' +
              '<button class="btn btn-sm btn-outline" data-tog="' + r.id + '" data-en="' + r.enabled + '">' + (r.enabled ? 'Pause' : 'Enable') + '</button>' +
              '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">Delete</button></div>';
          }).join('')
        : '<p class="muted">No rules yet. Create one above.</p>');

      el.querySelectorAll('[data-tog]').forEach(b => b.addEventListener('click', async () => {
        await WF.api('/social/rules/' + b.dataset.tog + '/toggle', { method: 'POST' });
        WF.toast('Rule ' + (b.dataset.en === '1' ? 'paused' : 'enabled'));
        loadRules();
      }));
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this posting rule?')) return;
        await WF.api('/social/rules/' + b.dataset.del, { method: 'DELETE' });
        loadRules();
      }));
    } catch (e) { el.innerHTML = '<p class="muted">Could not load rules.</p>'; }
  }
};

// ----- Manual Posting (Compose) -----
WF.views.adminSocialCompose = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin/social'); return; }
  setMeta('Manual Posting', 'Create and publish social media posts manually');
  app.innerHTML = '<div class="page-title">✍️ Manual Posting</div><a class="see-all" href="#/admin/social">← Social</a>' +
    '<p class="muted">Select content, write your caption, choose a platform, and publish immediately or schedule it.</p>' +
    '<div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px" id="manualGrid">' +
    '<div class="card"><h3>1. Select Content</h3>' +
    '<div class="form-row"><select id="mp_contentType"><option value="articles">News Articles</option><option value="site_articles">Site Articles</option><option value="products">Products</option><option value="breaking">Breaking News</option></select></div>' +
    '<div id="mp_contentList" class="muted" style="font-size:.85rem;max-height:320px;overflow-y:auto">Loading…</div></div>' +
    '<div class="card"><h3>2. Compose Post</h3>' +
    '<div class="form-row"><label>Account</label><select id="mp_account"><option value="">Loading…</option></select></div>' +
    '<div class="form-row"><label>Caption</label><textarea id="mp_caption" rows="4" placeholder="Write your post caption…"></textarea></div>' +
    '<div class="form-row"><label>Hashtags</label><input id="mp_tags" placeholder="e.g. news, world, #kco"></div>' +
    '<div class="form-row"><label>Image / Video URL (optional)</label><input id="mp_media" placeholder="https://…"></div>' +
    '<div class="form-row"><label>Schedule (optional — blank = publish immediately)</label><input type="datetime-local" id="mp_schedule"></div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="mp_publish">Publish Now</button>' +
    '<button class="btn btn-outline" id="mp_scheduleBtn">Schedule</button>' +
    '<button class="btn btn-outline" id="mp_draft">Save Draft</button>' +
    '</div></div></div>' +
    '<div class="card" style="margin-top:16px"><h3>Preview</h3><div id="mp_preview" class="muted">Select content to preview…</div></div>';

  loadManualAccounts();
  loadContent('articles');

  document.getElementById('mp_contentType').addEventListener('change', (e) => loadContent(e.target.value));

  async function loadContent(type) {
    const el = document.getElementById('mp_contentList');
    try {
      const d = await WF.api('/social/content/available');
      const all = d.content || [];
      const filtered = all.filter(c => c.content_type === type);
      el.innerHTML = filtered.length
        ? filtered.map(c => '<div class="list-item" data-pick="' + encodeURIComponent(JSON.stringify(c)) + '" style="cursor:pointer"><div style="flex:1"><strong>' + WF.esc(c.content_title || '') + '</strong>' +
          '<div class="muted" style="font-size:.72rem">' + WF.esc((c.content_url || '').slice(0, 80)) + '</div></div>' +
          '<span class="pill">' + WF.esc(c.type_label || type) + '</span></div>').join('')
        : '<p class="muted">No ' + type + ' content available.</p>';

      el.querySelectorAll('[data-pick]').forEach(item => item.addEventListener('click', () => {
        const c = JSON.parse(decodeURIComponent(item.dataset.pick));
        document.getElementById('mp_caption').value = c.content_title || '';
        document.getElementById('mp_tags').value = '';
        document.getElementById('mp_media').value = c.content_image || '';
        window._mpContent = c;
        document.getElementById('mp_preview').innerHTML = '<div><img src="' + WF.esc(c.content_image) + '" style="max-height:120px;border-radius:8px;margin-bottom:8px" onerror="this.style.display=\'none\'"><strong>' + WF.esc(c.content_title || '') + '</strong>' +
          '<div class="muted" style="font-size:.85rem">' + WF.esc((c.content_summary || '').slice(0, 150)) + '</div>' +
          '<a href="' + WF.esc(c.content_url) + '" target="_blank" rel="noopener" style="font-size:.85rem">' + WF.esc((c.content_url || '').slice(0, 80)) + '</a></div>';
      }));
    } catch (e) { el.innerHTML = '<p class="muted">Could not load content.</p>'; }
  }

  async function loadManualAccounts() {
    try {
      const d = await WF.api('/social/accounts');
      const accounts = (d.accounts || []).filter(a => a.connected);
      document.getElementById('mp_account').innerHTML = accounts.length
        ? accounts.map(a => '<option value="' + a.id + '">' + WF.esc(a.account_label || a.account_name || a.platform) + ' (' + WF.esc(a.platform_info || a.platform) + ')</option>').join('')
        : '<option value="">No connected accounts</option>';
    } catch (e) {}
  }

  async function publish(mode) {
    const account = document.getElementById('mp_account').value;
    if (!account) { WF.toast('Select an account'); return; }
    const c = window._mpContent || {};
    const scheduleVal = document.getElementById('mp_schedule').value;
    const scheduledAt = scheduleVal ? Math.floor(new Date(scheduleVal).getTime() / 1000) : null;

    const body = {
      account_id: +account,
      content_type: c.content_type || 'article',
      content_id: c.content_id || 0,
      content_url: c.content_url || '',
      content_title: document.getElementById('mp_caption').value || c.content_title || '',
      content_summary: c.content_summary || '',
      content_image: c.content_image || '',
      custom_caption: document.getElementById('mp_caption').value,
      custom_hashtags: document.getElementById('mp_tags').value,
      media_url: document.getElementById('mp_media').value || c.content_image || '',
      publish_now: mode === 'publish',
      scheduled_at: scheduledAt,
      // Drafts are stored as 'pending' so the scheduler never auto-publishes them.
      status: mode === 'draft' ? 'pending' : (scheduledAt ? 'scheduled' : 'queued')
    };

    try {
      const d = await WF.api('/social/posts/manual', { method: 'POST', body: JSON.stringify(body) });
      if (mode === 'publish') WF.toast('Posting initiated');
      else if (mode === 'schedule') WF.toast('Post scheduled for ' + (scheduleVal || 'now'));
      else WF.toast('Draft saved');
      WF.router.go('/admin/social/queue');
    } catch (e) { WF.toast(e.message); }
  }

  document.getElementById('mp_publish').addEventListener('click', () => publish('publish'));
  document.getElementById('mp_scheduleBtn').addEventListener('click', () => publish('schedule'));
  document.getElementById('mp_draft').addEventListener('click', () => publish('draft'));
};

// ----- Content Queue -----
WF.views.adminSocialQueue = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin/social'); return; }
  setMeta('Content Queue', 'Review and manage the posting queue');
  app.innerHTML = '<div class="page-title">🗂️ Content Queue</div><a class="see-all" href="#/admin/social">← Social</a>' +
    '<p class="muted">Posts waiting to be published or pending your approval.</p>' +
    '<div class="card" style="margin-top:14px"><h3>Queued / Retrying</h3><div id="soc_auto"></div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Scheduled</h3><div id="soc_scheduled"></div></div>' +
    '<div class="card" style="margin-top:14px"><h3>Pending Approval</h3><div id="soc_pending"></div></div>';

  loadQueue();

  async function loadQueue() {
    const autoEl = document.getElementById('soc_auto');
    const schedEl = document.getElementById('soc_scheduled');
    const pendingEl = document.getElementById('soc_pending');
    try {
      const d = await WF.api('/social/queue');
      const queue = d.queue || [];
      const retryCue = queue.filter(q => q.status === 'queued');
      const scheduled = queue.filter(q => q.status === 'scheduled');
      const pending = queue.filter(q => q.status === 'pending');

      autoEl.innerHTML = retryCue.length
        ? retryCue.map(p => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(p.content_title || p.content_url || 'Post ' + p.id) + '</strong>' +
          '<div class="muted" style="font-size:.75rem">' + WF.esc(p.platform || '') + ' · ' +
          (p.retry_count > 0 ? 'attempt ' + p.retry_count + '/' + (p.max_retries || 3) + ' · ' : '') +
          (p.failed_reason ? '<span style="color:#c77700">' + WF.esc(p.failed_reason) + '</span> · ' : '') +
          (p.next_retry_at ? 'retry ' + new Date(p.next_retry_at * 1000).toLocaleTimeString() : 'auto') + '</div></div>' +
          '<span class="pill" style="background:#c77700">queued</span>' +
          '<button class="btn btn-sm btn-outline" data-approve="' + p.id + '">Retry now</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button></div>').join('')
        : '<p class="muted">No queued or retrying posts.</p>';

      schedEl.innerHTML = scheduled.length
        ? scheduled.map(p => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(p.content_title || p.content_url || 'Post ' + p.id) + '</strong>' +
          '<div class="muted" style="font-size:.75rem">' + WF.esc(p.platform || '') + ' · scheduled ' + (p.scheduled_at ? new Date(p.scheduled_at * 1000).toLocaleString() : 'now') + '</div></div>' +
          '<span class="pill" style="background:#1f6feb">scheduled</span>' +
          '<button class="btn btn-sm btn-outline" data-approve="' + p.id + '">Publish now</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button></div>').join('')
        : '<p class="muted">No scheduled posts.</p>';

      pendingEl.innerHTML = pending.length
        ? pending.map(p => '<div class="list-item"><div style="flex:1"><strong>' + WF.esc(p.content_title || '') + '</strong>' +
          '<div class="muted" style="font-size:.75rem">' + WF.esc(p.platform || '') + ' · ' + WF.esc(p.content_type) + ' · ' + WF.esc(p.post_type === 'automatic' ? 'auto approval' : 'draft') + '</div></div>' +
          '<button class="btn btn-sm btn-primary" style="background:#0a7d3c" data-approve="' + p.id + '">Approve & Publish</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button></div>').join('')
        : '<p class="muted">No posts pending approval.</p>';

      [autoEl, schedEl].forEach(sec => sec.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
        try {
          const r = await WF.api('/social/posts/' + b.dataset.approve + '/approve', { method: 'POST' });
          WF.toast(r.message || 'Published');
          loadQueue();
        } catch (e) { WF.toast(e.message); }
      })));
      pendingEl.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
        try {
          const r = await WF.api('/social/posts/' + b.dataset.approve + '/approve', { method: 'POST' });
          WF.toast(r.message || 'Approved and published');
          loadQueue();
        } catch (e) { WF.toast(e.message); }
      }));
      document.querySelectorAll('#soc_auto [data-del], #soc_scheduled [data-del], #soc_pending [data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        await WF.api('/social/posts/' + b.dataset.del, { method: 'DELETE' });
        loadQueue();
      }));
    } catch (e) {
      autoEl.innerHTML = '<p class="muted">Could not load queue.</p>';
    }
  }
};

// ----- Post Logs -----
WF.views.adminSocialLogs = async function (app) {
  if (!adminGuard()) { WF.router.go('/admin/social'); return; }
  setMeta('Post Logs', 'Social media posting activity log');
  app.innerHTML = '<div class="page-title">📋 Post Logs</div><a class="see-all" href="#/admin/social">← Social</a>' +
    '<div class="card" style="margin-top:14px"><h3>All Post Activity</h3>' +
    '<div class="form-row" style="display:flex;gap:10px">' +
    '<select id="log_acc" style="flex:1"><option value="">All accounts</option></select>' +
    '<select id="log_status"><option value="">All statuses</option><option value="ok">Success</option><option value="failed">Failed</option></select>' +
    '</div><div id="soc_logs"></div></div>';

  loadAccounts();
  loadLogs();

  async function loadAccounts() {
    try {
      const d = await WF.api('/social/accounts');
      const accounts = d.accounts || [];
      document.getElementById('log_acc').innerHTML = '<option value="">All accounts</option>' +
        accounts.map(a => '<option value="' + a.id + '">' + WF.esc(a.account_label || a.account_name || a.platform) + '</option>').join('');
    } catch (e) {}
  }

  async function loadLogs() {
    const el = document.getElementById('soc_logs');
    const acc = document.getElementById('log_acc').value;
    const status = document.getElementById('log_status').value;
    try {
      const d = await WF.api('/social/logs?limit=100' + (acc ? '&account_id=' + acc : ''));
      const logs = (d.logs || []).filter(l => !status || l.status === status);
      el.innerHTML = logs.length
        ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Platform</th><th>Action</th><th>Status</th><th>HTTP</th><th>Message</th></tr></thead><tbody>' +
          logs.map(l => '<tr><td class="muted" style="font-size:.72rem">' + new Date(l.attempted_at * 1000).toISOString().slice(0, 16) + '</td>' +
            '<td>' + WF.esc(l.platform || '') + '</td>' +
            '<td class="muted">' + WF.esc(l.action || '') + '</td>' +
            '<td><span class="pill" style="background:' + (l.status === 'ok' ? '#1a7f37' : l.status === 'failed' ? '#d40000' : '#c77700') + '">' + WF.esc(l.status) + '</span></td>' +
            '<td class="muted">' + (l.http_status || '') + '</td>' +
            '<td class="muted" style="font-size:.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + WF.esc(l.message || '') + '</td></tr>').join('') +
          '</tbody></table></div>'
        : '<p class="muted">No log entries.</p>';
    } catch (e) { el.innerHTML = '<p class="muted">Could not load logs.</p>'; }
  }

  document.getElementById('log_acc').addEventListener('change', loadLogs);
  document.getElementById('log_status').addEventListener('change', loadLogs);
};
