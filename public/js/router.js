/* WorldFront.News router: real-path URLs (server-rendered) with hash fallback */
window.WF = window.WF || {};
WF.router = (function () {
  const routes = {
    '/': 'home',
    '/latest': 'latest',
    '/world': 'world',
    '/breaking': 'breaking',
    '/map': 'map',
    '/shop': 'shop',
    '/shop/daily/:country/:date': 'shopDaily',
    '/shop/daily/:country': 'shopDaily',
    '/shop/product/:id': 'product',
    '/country/:code': 'country',
    '/category/:slug': 'category',
    '/region/:name': 'region',
    '/article/:slug': 'article',
    '/p/:slug': 'sitearticle',
    '/search/:q': 'search',
    '/account': 'account',
    '/saved': 'saved',
    '/admin': 'admin',
    '/admin/sources': 'adminSources',
    '/admin/publish': 'adminPublish',
    '/admin/shop': 'adminShop',
    '/admin/seo': 'adminSeo',
    '/admin/locations': 'adminLocations',
    '/admin/distribution': 'adminDistribution',
    '/admin/account': 'adminAccount',
    '/about': 'about',
    '/privacy': 'privacy',
    '/terms': 'terms'
  };

  function parse(input) {
    const h = String(input || '').replace(/^#/, '') || '/';
    const parts = h.split('/').filter(Boolean);
    for (const pattern of Object.keys(routes)) {
      const pp = pattern.split('/').filter(Boolean);
      if (pp.length !== parts.length) continue;
      let match = true;
      const params = {};
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (pp[i] !== parts[i]) { match = false; break; }
      }
      if (match) return { name: routes[pattern], params };
    }
    return { name: 'home', params: {} };
  }

  // Prefer an explicit hash route; otherwise resolve the real path
  // (e.g. /article/slug after an SSR navigation) on load.
  function current() {
    const h = location.hash;
    if (h && h.length > 1) return parse(h);
    return parse(location.pathname);
  }

  function go(hash) {
    const h = (hash.startsWith('#/') ? hash.slice(2) : hash.startsWith('/') ? hash : '/' + hash);
    if (location.hash === '#' + h) {
      // Same hash: hashchange won't fire, so render directly
      render();
      return;
    }
    location.hash = '#' + h;
  }

  async function render() {
    const explicitHash = location.hash && location.hash.length > 1;
    if (!explicitHash && location.pathname !== '/') {
      // Real-path SSR pages without an SPA route (e.g. /property/...) are fully
      // server-rendered. Keep that document instead of painting home over it.
      const resolved = parse(location.pathname);
      if (resolved.name === 'home') {
        const appEl = document.getElementById('app');
        if (appEl && appEl.childElementCount > 0) return;
      }
    }
    const { name, params } = current();
    const app = document.getElementById('app');
    // close overlays
    document.getElementById('searchPanel').classList.remove('open');
    document.getElementById('locationPanel').classList.remove('open');

    // Highlight active nav
    document.querySelectorAll('.main-nav a, .bottom-nav a').forEach(a => {
      a.classList.remove('active');
    });

    const fn = WF.views[name] || WF.views.home;
    try {
      await fn(app, params);
    } catch (e) {
      app.innerHTML = '<div class="center" style="padding:40px"><h3>Something went wrong</h3><p class="muted">' + WF.esc(e.message) + '</p></div>';
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  return { parse, go, render, routes };
})();

// Auto-render on load after shell init
window.addEventListener('DOMContentLoaded', () => {
  WF.initShell().then(() => WF.router.render());
});
