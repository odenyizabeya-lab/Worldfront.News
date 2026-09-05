/* WorldFront.News router (hash-based) */
window.WF = window.WF || {};
WF.router = (function () {
  const routes = {
    '/': 'home',
    '/latest': 'latest',
    '/world': 'world',
    '/breaking': 'breaking',
    '/map': 'map',
    '/shop': 'shop',
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
    '/about': 'about',
    '/privacy': 'privacy',
    '/terms': 'terms'
  };

  function parse(hash) {
    const h = hash.replace(/^#/, '') || '/';
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
    const { name, params } = parse(location.hash);
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
