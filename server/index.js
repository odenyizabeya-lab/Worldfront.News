require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./db');
const apiRoutes = require('./routes/api');
const userRoutes = require('./routes/user');
const locationRoutes = require('./routes/location');
const adminRoutes = require('./routes/admin');
const seoRoutes = require('./routes/seo');
const ssr = require('./lib/ssr');
const analytics = require('./lib/analytics');
const { fetchEnabled } = require('./ingest/rss');
const { runApiProviders } = require('./ingest/api');
const { maybeSync: syncShop, autoPublish: autoPublishShopProducts } = require('./integrations/weverse-shop');
const { redeployProduction, rebuildNow } = require('./integrations/deploy');
const distribution = require('./distrib/engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const app = express();

async function start() {
  await db.initialize();
  console.log('Database ready.');

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json({ limit: '2mb' }));

  // Canonical host: consolidate apex domain onto the canonical www host so
  // search engines index a single variant. The host pair is derived from
  // SITE_URL (normalized to www) so the site keeps working if the domain or
  // hosting provider changes (just update SITE_URL). Preview/other hosts are
  // untouched.
  app.use((req, res, next) => {
    const canonicalHost = ssr.canonicalBase()
      .replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    const apexHost = canonicalHost.startsWith('www.') ? canonicalHost.slice(4) : '';
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (apexHost && host === apexHost && host !== canonicalHost) {
      const target = 'https://' + canonicalHost + req.originalUrl;
      return res.redirect(301, target);
    }
    next();
  });

  // First-party pageview tracking (real reach numbers, no third-party scripts).
  app.use(analytics.middleware);

  // ---- API ----
  app.use('/api', apiRoutes);
  app.use('/api/auth', userRoutes);
  app.use('/api/location', locationRoutes);
  app.use('/api/admin', adminRoutes);

  // Vercel cron: hourly auto-publish of Weverse Shop products (new day /
  // missing-today / catalog-count-change all trigger a fresh complete
  // publication set; otherwise this is a cheap no-op).
  app.post('/api/cron/shop-publish', async (req, res) => {
    if (req.headers['x-vercel-cron'] !== '1') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const r = await autoPublishShopProducts();
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GitHub Actions hourly scheduler (primary free mechanism): publishes today's
  // editions when due (new day / missing / count change) and triggers a rebuild
  // so the fresh bundled DB is baked into production. Guarded by a shared
  // secret (HOURLY_CRON_TOKEN env) sent as a bearer token by the workflow.
  app.post('/api/cron/shop-tick', async (req, res) => {
    const expected = process.env.HOURLY_CRON_TOKEN;
    const auth = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (!expected || auth !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const pub = await autoPublishShopProducts();
      const rb = await rebuildNow();
      res.json({
        published: !pub.skipped,
        publish: pub.skipped ? { skipped: true, mode: pub.mode, reason: pub.reason } : pub.result,
        rebuild: rb
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vercel cron: every hour, rebuild the production deployment so today's
  // editions are baked into the bundled DB and survive cold starts (durable on
  // Vercel). Bounded by a cooldown + a "has editions for today" check, and a
  // rebuild never affects the live deployment while it builds.
  app.post('/api/cron/shop-redeploy', async (req, res) => {
    if (req.headers['x-vercel-cron'] !== '1') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const r = await redeployProduction();
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vercel cron (daily): run the multi-platform distribution pass — discovers
  // new legitimate platforms, shares published articles/products/editions to
  // every connected connector, retries failures, refreshes the RSS feed.
  app.post('/api/cron/shop-distribute', async (req, res) => {
    if (req.headers['x-vercel-cron'] !== '1') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const r = await distribution.tick();
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- SEO: server-rendered indexable pages, robots.txt, sitemaps ----
  app.use(seoRoutes);

  // ---- Static frontend ----
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

  // SPA fallback for app-only routes (map, latest, world, admin, account…).
  // Deep content (articles, products, daily editions, countries, categories,
  // shop) is served by seoRoutes above with real HTML + meta + JSON-LD.
  // Everything else 404s cleanly (no soft-404 SPA shells for crawlers).
  const SPA_ONLY = new Set(['/latest', '/world', '/breaking', '/map', '/about', '/privacy', '/terms', '/account', '/saved', '/role', '/register', '/admin']);
  app.get('*', (req, res) => {
    const p = req.path;
    if (SPA_ONLY.has(p) || p.indexOf('/admin/') === 0 || p.indexOf('/region/') === 0 || p.indexOf('/search/') === 0 || p.indexOf('/p/') === 0) {
      return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    }
    return require('./lib/ssr').notFoundPage(res, 'This page does not exist.');
  });

  // ---- Error handler ----
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  app.listen(PORT, () => {
    console.log(`WorldFront.News running at http://localhost:${PORT}`);
  });

  // ---- Scheduled ingestion ----
  if (process.env.DISABLE_CRON !== '1') {
    cron.schedule('*/15 * * * *', async () => {
      console.log('Cron: running news ingestion...');
      try {
        const results = await fetchEnabled();
        const api = await runApiProviders();
        db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_full_fetch',?)", [String(db.now())]);
        db.persist();
        console.log(`Cron done: ${results.filter(r => !r.error).length} feeds, api=${api.total}`);
      } catch (e) {
        console.error('Cron error:', e.message);
      }
      // Weverse Shop Updates: auto-publish product changes from the shop catalog
      // (read-only sync, runs at most once per cooldown period).
      try {
        const shop = await syncShop();
        if (!shop.skipped) {
          console.log(`Shop sync: ${shop.total} products (${shop.inserted} new, ${shop.updated} updated)`);
        }
      } catch (e) {
        console.error('Shop sync error:', e.message);
      }
      // Weverse Shop Updates: hourly-proof fresh per-country editions
      // ("every day, for all countries"). Only runs when mode is 'daily'.
      try {
        const pub = await autoPublishShopProducts();
        if (!pub.skipped) {
          const r = pub.result || {};
          console.log(`Shop publish daily (${pub.reason}): ${r.date} ${r.countries} countries × ${r.products_per_country} products (${r.items} items, ${r.created} new articles)`);
        }
      } catch (e) {
        console.error('Shop publish error:', e.message);
      }
    });

    cron.schedule('0 3 * * *', () => {
      try {
        const cutoff = db.now() - 14 * 24 * 3600;
        const before = db.get('SELECT COUNT(*) AS c FROM sessions').c;
        db.run('DELETE FROM sessions WHERE created_at < ?', [cutoff]);
        const after = db.get('SELECT COUNT(*) AS c FROM sessions').c;
        db.persist();
        console.log(`Session cleanup: removed ${before - after} expired sessions (${after} remaining).`);
      } catch (e) {
        console.error('Session cleanup error:', e.message);
      }
    });

    // Multi-platform distribution: every day, discover new legitimate
    // opportunities + share the newest articles/products/editions to every
    // connected connector (real HTTP) and queue honest manual tasks.
    cron.schedule('0 6 * * *', async () => {
      console.log('Cron: running multi-platform distribution...');
      try {
        const r = await distribution.tick();
        console.log(`Distribution done: discovered=${r.discovered ? r.discovered.checked : 0}, shared=${r.distributed.ok}, discoverable=${r.distributed.discoverable}, pending=${r.distributed.pending}, failed=${r.distributed.failed}`);
      } catch (e) {
        console.error('Distribution error:', e.message);
      }
    });

    console.log('Cron scheduled every 15 minutes. Session cleanup daily at 3 AM. Distribution daily at 6 AM.');
  }
}

start().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

module.exports = app;
