// WorldFront.News Multi-Platform Distribution — Platform Registry.
//
// Curated catalog of REAL, legitimate free publishing/discovery platforms.
// Every entry carries its TRUE requirement level (access) so the system never
// pretends a platform connects without what it actually needs:
//   access: none      → works with everything already on the site (e.g. IndexNow)
//   access: free_key  → requires a free API key the owner must create once
//   access: oauth     → official OAuth connection (owner approves in browser)
//   access: webhook   → official inbound webhook / bot token
//   access: manual    → human must register / verify / submit (tasks are queued)
//   access: paid      → only with a paid plan (never auto-claimed)
//
// The Discovery Engine (discover()) walks this catalog daily, health-checks the
// destination, marks new opportunities, and reports the REAL number found (it
// never invents platforms just to reach a daily target).
const db = require('../db');

// Target markets for geographic spread (never forces more than are real).
const TARGETS = ['XX', 'US', 'GB', 'DE', 'FR', 'PL', 'GR', 'AU', 'SG', 'TW', 'CN', 'KR', 'JP', 'RU', 'CA'];

function P(p) {
  p.region = p.region || 'Global';
  p.country_code = p.country_code || 'XX';
  p.content_types = p.content_types || ['articles'];
  p.api_required = p.api_required || 0;
  p.email_verification = p.email_verification === undefined ? 0 : p.email_verification;
  p.manual_approval = p.manual_approval || 0;
  p.paid = p.paid || 0;
  p.auto_create = 0;
  return p;
}

// Every URL below is the platform's real official page.
const CATALOG = [
  // ---- Zero-key / automatic (works with the site as-is) ----
  P({ slug: 'indexnow', name: 'IndexNow', country_code: 'XX', url: 'https://www.indexnow.org', signup_url: 'https://www.indexnow.org', access: 'none', method: 'api', manual_approval: 0, email_verification: 0, score: 100,
      notes: 'Free real-time notification pings to Bing, Yandex, Seznam and Naver. Key is auto-generated and served at /<key>.txt — no account needed.' }),
  P({ slug: 'rss-feed', name: 'WorldFront RSS Feed', country_code: 'XX', url: 'https://www.worldfront.news/rss.xml', signup_url: 'https://www.worldfront.news/rss.xml', access: 'none', method: 'rss_discovery', email_verification: 0, score: 90,
      notes: 'The site\'s own standard RSS 2.0 feed. Aggregators and feed readers can subscribe; distribution is recorded as "discoverable" because the platform pulls, never gets pushed.' }),

  // ---- Search engines / webmaster tools (free key or manual submit) ----
  P({ slug: 'google-scm', name: 'Google Search Console', country_code: 'XX', url: 'https://search.google.com/search-console', signup_url: 'https://search.google.com/search-console', access: 'oauth', method: 'oauth', manual_approval: 1, score: 88,
      notes: 'Domain is already verified (GSC meta is served). Submit sitemap once; optional URL Inspection API needs a GOOGLE_SERVICE_ACCOUNT_JSON key.' }),
  P({ slug: 'bing-webmaster', name: 'Bing Webmaster Tools', country_code: 'XX', url: 'https://www.bing.com/webmasters', signup_url: 'https://www.bing.com/webmasters', access: 'free_key', method: 'submission', manual_approval: 1, score: 80,
      notes: 'Free. Submit the sitemap after adding the site. IndexNow already covers Bing URL discovery.' }),
  P({ slug: 'yandex-webmaster', name: 'Yandex Webmaster', country_code: 'RU', url: 'https://webmaster.yandex.com', signup_url: 'https://webmaster.yandex.com', access: 'free_key', method: 'submission', manual_approval: 1, score: 72,
      notes: 'Free for RU/RU-targeted indexation; also covered by IndexNow pings.' }),
  P({ slug: 'baidu-search', name: 'Baidu Search Resource (Ziyuan)', country_code: 'CN', url: 'https://ziyuan.baidu.com', signup_url: 'https://ziyuan.baidu.com', access: 'free_key', method: 'submission', manual_approval: 1, score: 70,
      notes: 'Baidu webmaster platform. Requires a Baidu account; CN phone verification applies to new accounts — handled as a manual task (never bypassed).' }),
  P({ slug: 'naver-search', name: 'Naver Search Advisor', country_code: 'KR', url: 'https://searchadvisor.naver.com', signup_url: 'https://searchadvisor.naver.com', access: 'free_key', method: 'submission', manual_approval: 1, score: 66,
      notes: 'Free webmaster tool for Naver search (Korea).' }),

  // ---- News aggregator / publisher portals (manual approval - honoured) ----
  P({ slug: 'google-news', name: 'Google News Publisher Center', country_code: 'XX', url: 'https://publishercenter.google.com', signup_url: 'https://publishercenter.google.com', access: 'manual', method: 'submission', manual_approval: 1, score: 82,
      notes: 'Official route into Google News/Discover. Human review applies; we queue a task and never claim approval.' }),
  P({ slug: 'bing-news', name: 'Bing News Distribution', country_code: 'XX', url: 'https://www.bing.com/webmasters/news', signup_url: 'https://www.bing.com/webmasters/news', access: 'manual', method: 'submission', manual_approval: 1, score: 74,
      notes: 'Bing News Source registration — manually reviewed.' }),
  P({ slug: 'yahoo-news', name: 'Yahoo News Publisher', country_code: 'XX', url: 'https://publishers.yahoo.com', signup_url: 'https://publishers.yahoo.com', access: 'paid', method: 'submission', manual_approval: 1, paid: 1, score: 55,
      notes: 'Yahoo News Distribution is paid/partner-based. Kept on the ledger honestly as paid.' }),
  P({ slug: 'apple-news', name: 'Apple News Publisher', country_code: 'US', url: 'https://developer.apple.com/news-publisher', signup_url: 'https://developer.apple.com/news-publisher/', access: 'paid', method: 'submission', manual_approval: 1, paid: 1, score: 50,
      notes: 'Apple News requires approved publisher partnership.' }),

  // ---- Social publishing (free API/webhook that shares the link automatically) ----
  P({ slug: 'mastodon', name: 'Mastodon', country_code: 'XX', url: 'https://joinmastodon.org', signup_url: 'https://joinmastodon.org/servers', access: 'free_key', method: 'api', email_verification: 1, score: 76,
      content_types: ['articles', 'breaking', 'products'], notes: 'Free federated microblogging. One account on any instance; connect with an access token from the instance\'s official API.' }),
  P({ slug: 'mastodon-au', name: 'Mastodon (Australia — aus.social)', country_code: 'AU', url: 'https://aus.social', signup_url: 'https://aus.social/invite', access: 'free_key', method: 'api', email_verification: 1, score: 68,
      content_types: ['articles', 'breaking', 'products'], notes: 'Australian Mastodon instance (real AU community).' }),
  P({ slug: 'mastodon-jp', name: 'Mastodon (Japan — mstdn.jp)', country_code: 'JP', url: 'https://mstdn.jp', signup_url: 'https://mstdn.jp/about/more', access: 'free_key', method: 'api', email_verification: 1, score: 64,
      content_types: ['articles', 'breaking', 'products'], notes: 'Japanese Mastodon instance.' }),
  P({ slug: 'mastodon-de', name: 'Mastodon (Germany — chaos.social)', country_code: 'DE', url: 'https://chaos.social', signup_url: 'https://chaos.social/about', access: 'free_key', method: 'api', email_verification: 1, score: 62,
      content_types: ['articles', 'breaking', 'products'], notes: 'German Mastodon instance.' }),
  P({ slug: 'telegram', name: 'Telegram Channel', country_code: 'XX', url: 'https://telegram.org', signup_url: 'https://t.me/', access: 'webhook', method: 'webhook', email_verification: 1, score: 70,
      content_types: ['articles', 'breaking', 'products'], notes: 'Official Bot API — create a channel + bot with @BotFather, store the bot token and channel username.' }),
  P({ slug: 'discord', name: 'Discord Webhook', country_code: 'XX', url: 'https://support.discord.com', signup_url: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks', access: 'webhook', method: 'webhook', email_verification: 1, score: 52,
      content_types: ['articles', 'breaking', 'products'], notes: 'Post to a server channel via an official webhook URL.' }),
  P({ slug: 'devto', name: 'DEV Community (dev.to)', country_code: 'XX', url: 'https://dev.to', signup_url: 'https://dev.to/settings/account', access: 'free_key', method: 'api', email_verification: 1, score: 60,
      content_types: ['articles'], notes: 'Tech community with an official Forem REST API — create a personal API key in the dashboard.' }),
  P({ slug: 'tumblr', name: 'Tumblr', country_code: 'US', url: 'https://www.tumblr.com', signup_url: 'https://www.tumblr.com/developers', access: 'oauth', method: 'oauth', email_verification: 1, score: 58,
      content_types: ['articles', 'products'], notes: 'Official API v2. Register an app for OAuth tokens.' }),
  P({ slug: 'blogger', name: 'Blogger (Google)', country_code: 'XX', url: 'https://www.blogger.com', signup_url: 'https://developers.google.com/blogger/docs/3.0/using', access: 'free_key', method: 'api', email_verification: 1, score: 56,
      content_types: ['articles'], notes: 'Official Blogger Data API v3 works with a free Google API key + a public blog id. Auto-posts the article to the mirror blog.' }),
  P({ slug: 'wordpress-com', name: 'WordPress.com', country_code: 'XX', url: 'https://wordpress.com', signup_url: 'https://developer.wordpress.com/apps/', access: 'oauth', method: 'oauth', email_verification: 1, score: 54,
      content_types: ['articles'], notes: 'REST API v2 needs an OAuth2 app + token from your account.' }),
  P({ slug: 'pinterest', name: 'Pinterest', country_code: 'US', url: 'https://www.pinterest.com', signup_url: 'https://developers.pinterest.com', access: 'oauth', method: 'oauth', email_verification: 1, score: 48,
      content_types: ['products', 'articles'], notes: 'Official Pins API — pin product/listing images back to the site.' }),

  // ---- Manual communities (link submission; honest manual tasks) ----
  P({ slug: 'hacker-news', name: 'Hacker News', country_code: 'US', url: 'https://news.ycombinator.com', signup_url: 'https://news.ycombinator.com/login', access: 'manual', method: 'manual', manual_approval: 1, score: 44,
      content_types: ['articles'], notes: 'Community link submission. One title per story; submit manually.' }),
  P({ slug: 'reddit', name: 'Reddit', country_code: 'US', url: 'https://www.reddit.com', signup_url: 'https://www.reddit.com/register/', access: 'oauth', method: 'oauth', manual_approval: 1, score: 42,
      content_types: ['articles', 'breaking', 'products'], notes: 'Official API requires an approved app. Strict 1:9 self-promotion rule — we respect it.' }),
  P({ slug: 'linkedin', name: 'LinkedIn', country_code: 'US', url: 'https://www.linkedin.com', signup_url: 'https://www.linkedin.com/developers', access: 'oauth', method: 'oauth', manual_approval: 1, score: 40,
      content_types: ['articles', 'breaking'], notes: 'Share char/POST via LinkedIn API (approved app required).' }),
  P({ slug: 'x-twitter', name: 'X (Twitter)', country_code: 'US', url: 'https://developer.x.com', signup_url: 'https://developer.x.com/en/portal/apps', access: 'oauth', method: 'oauth', paid: 1, manual_approval: 1, score: 0,
      content_types: ['articles', 'breaking', 'products'], notes: 'write access is effectively paid/approved now — kept honest as paid.' }),
  P({ slug: 'meta-facebook', name: 'Facebook / Instagram', country_code: 'XX', url: 'https://developers.facebook.com', signup_url: 'https://developers.facebook.com/apps/', access: 'oauth', method: 'oauth', manual_approval: 1, score: 38,
      content_types: ['articles', 'breaking', 'products'], notes: 'Meta Graph API requires an app + page linking; post once confirmed.' }),
  P({ slug: 'plurk', name: 'Plurk', country_code: 'TW', url: 'https://www.plurk.com', signup_url: 'https://www.plurk.com/OAuth', access: 'oauth', method: 'oauth', email_verification: 1, score: 46,
      content_types: ['articles', 'breaking'], notes: 'Taiwanese microblog with an official public OAuth API.' }),
  P({ slug: 'weibo', name: 'Weibo', country_code: 'CN', url: 'https://weibo.com', signup_url: 'https://weibo.com/signup', access: 'manual', method: 'manual', manual_approval: 1, email_verification: 1, score: 32,
      content_types: ['articles', 'breaking', 'products'], notes: 'CN phone + identity verification on signup. Manual task — we never fake CN identity.' }),
  P({ slug: 'zhihu', name: 'Zhihu', country_code: 'CN', url: 'https://www.zhihu.com', signup_url: 'https://www.zhihu.com/signup', access: 'manual', method: 'manual', manual_approval: 1, email_verification: 1, score: 30,
      content_types: ['articles'], notes: 'Chinese Q&A/community; real account + moderation. Manual.' }),
  P({ slug: 'vk', name: 'VK (VKontakte)', country_code: 'RU', url: 'https://vk.com', signup_url: 'https://vk.com/dev', access: 'manual', method: 'manual', manual_approval: 1, score: 28,
      content_types: ['articles', 'breaking', 'products'], notes: 'RU social. API exists but community gates apply; treat as manual.' }),

  // ---- Link directories / bookmarking / regional discovery ----
  P({ slug: 'feedspot', name: 'Feedspot Directory', country_code: 'US', url: 'https://www.feedspot.com', signup_url: 'https://www.feedspot.com/submit-your-blog-news', access: 'manual', method: 'submission', manual_approval: 1, score: 34,
      notes: 'Free / paid listing in the news directory. Manual submit of the site, feed and sitemap.' }),
  P({ slug: 'blogarama', name: 'Blogarama', country_code: 'US', url: 'https://www.blogarama.com', signup_url: 'https://www.blogarama.com/add-blog/', access: 'manual', method: 'submission', manual_approval: 1, score: 33,
      notes: 'Blog directory with a free news category. Manual submit.' }),
  P({ slug: 'folkd', name: 'folkd', country_code: 'DE', url: 'https://www.folkd.com', signup_url: 'https://www.folkd.com/start/register', access: 'manual', method: 'manual', manual_approval: 1, score: 36,
      content_types: ['articles', 'products'], notes: 'German social bookmarking — community submit of links.' }),
  P({ slug: 'mister-wong', name: 'Mister Wong', country_code: 'DE', url: 'https://www.mister-wong.com', signup_url: 'https://www.mister-wong.com', access: 'manual', method: 'manual', manual_approval: 1, score: 31,
      content_types: ['articles'], notes: 'Link bookmarking directory (DE/EU audience).' }),
  P({ slug: 'wykop', name: 'Wykop', country_code: 'PL', url: 'https://www.wykop.pl', signup_url: 'https://www.wykop.pl/rejestracja/', access: 'manual', method: 'manual', manual_approval: 1, email_verification: 1, score: 35,
      content_types: ['articles', 'breaking'], notes: 'Polish link-aggregator community. Manual submit; tolerance for self-posts is low.' }),
  P({ slug: 'peertube', name: 'PeerTube (EU video)', country_code: 'FR', url: 'https://joinpeertube.org', signup_url: 'https://joinpeertube.org/instances', access: 'manual', method: 'manual', manual_approval: 1, score: 26,
      content_types: ['articles', 'products'], notes: 'Federated video — useful later for listing videos; instance signup required.' }),

  P({ slug: 'medium', name: 'Medium', country_code: 'XX', url: 'https://medium.com', signup_url: 'https://medium.com/me/settings', access: 'manual', method: 'manual', manual_approval: 1, score: 22,
      content_types: ['articles'], notes: 'No official public posting API for individuals — cross-post manually (clearly stated, not auto-claimed).' }),
  P({ slug: 'substack', name: 'Substack', country_code: 'XX', url: 'https://substack.com', signup_url: 'https://substack.com/signup', access: 'manual', method: 'manual', manual_approval: 1, score: 20,
      content_types: ['articles'], notes: 'Newsletter platform; manual publication.' }),
  P({ slug: 'hashnode', name: 'Hashnode', country_code: 'XX', url: 'https://hashnode.com', signup_url: 'https://hashnode.com', access: 'manual', method: 'manual', manual_approval: 1, score: 18,
      content_types: ['articles'], notes: 'Developer blog platform; manual publication.' })
];

// Location lookup for region labels (only cosmetic, uses real countries table).
function countryLabel(code) {
  const c = db.get('SELECT name FROM countries WHERE code=?', [String(code).toUpperCase()]);
  return c ? c.name : (code === 'XX' ? 'Global' : code);
}

// Insert the catalog into dist_platforms (idempotent). Never overwrites live
// connection data; only refreshes the metadata fields.
function seedRegistry() {
  let inserted = 0, updated = 0;
  const now = db.now();
  for (const p of CATALOG) {
    const ex = db.get('SELECT slug FROM dist_platforms WHERE slug=?', [p.slug]);
    if (!ex) {
      db.run(
        `INSERT INTO dist_platforms (slug,name,country_code,region,url,signup_url,content_types,access,method,
           api_required,email_verification,manual_approval,paid,notes,status,auto_create,discovered_at,last_checked,last_success,last_failure,failure_message,score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',0,?,NULL,NULL,NULL,NULL,?)`,
        [p.slug, p.name, p.country_code, p.region, p.url, p.signup_url, JSON.stringify(p.content_types),
         p.access, p.method, p.api_required, p.email_verification, p.manual_approval, p.paid, p.notes, now, p.score]);
      inserted++;
    } else {
      db.run(
        `UPDATE dist_platforms SET name=?, country_code=?, region=?, url=?, signup_url=?, content_types=?,
           access=?, method=?, api_required=?, email_verification=?, manual_approval=?, paid=?, notes=?, score=? WHERE slug=?`,
        [p.name, p.country_code, p.region, p.url, p.signup_url, JSON.stringify(p.content_types),
         p.access, p.method, p.api_required, p.email_verification, p.manual_approval, p.paid, p.notes, p.score, p.slug]);
      updated++;
    }
  }
  if (inserted || updated) db.persist();
  return { catalog: CATALOG.length, inserted, updated };
}

// Health-check a platform's official URL (real HEAD/GET, short timeout).
async function checkReachable(platform) {
  const url = platform.signup_url || platform.url;
  if (!url || !/^https?:\/\//i.test(url)) return { ok: true, status: 200, msg: 'no external endpoint (self-hosted feed)' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 WorldFront.News distribution-check' } });
    clearTimeout(t);
    return { ok: r.ok, status: r.status, msg: 'HTTP ' + r.status };
  } catch (e) {
    return { ok: false, status: 0, msg: String(e.message || 'unreachable').slice(0, 160) };
  }
}

// Daily Discovery Engine. Picks platforms that were never checked or were
// checked >24h ago (capped per run), confirms they are reachable, and marks
// them with the discovery date. The REAL number found is returned — never an
// inflated target. For manual/approval platforms it queues onboarding tasks.
async function discover(limit = 6) {
  const day = 24 * 3600;
  const cutoff = db.now() - day;
  let rows = db.all(
    'SELECT * FROM dist_platforms WHERE last_checked IS NULL OR last_checked < ? ORDER BY (last_checked IS NULL) DESC, score DESC LIMIT ?',
    [cutoff, limit]
  );
  const checked = [], newlyDiscovered = [];
  for (const p of rows) {
    const reach = await checkReachable(p);
    const isNew = !p.last_checked;
    db.run('UPDATE dist_platforms SET last_checked=?, discovered_at=COALESCE(discovered_at,?), last_failure=?, failure_message=? WHERE slug=?',
      [db.now(), isNew ? db.now() : p.discovered_at, reach.ok ? null : db.now(), reach.ok ? null : reach.msg, p.slug]);
    checked.push({ slug: p.slug, name: p.name, reachable: reach.ok, status: reach.status, msg: reach.msg });
    if (isNew && (p.access === 'manual' || p.manual_approval)) {
      let action = 'register';
      let guidance = 'Sign up for the official account and complete verification/approval on the platform.';
      if (p.access === 'free_key') action = 'provide_api_key';
      if (p.access === 'oauth' || p.method === 'oauth') action = 'connect_oauth';
      if (p.access === 'webhook') action = 'provide_webhook';
      const sub = 'Create an official account on ' + p.name + ' (' + p.url + '). ' +
        (p.email_verification ? 'Complete the email verification on signup. ' : '') +
        (p.manual_approval ? 'Await/manage any platform approval. ' : '') +
        (p.paid ? 'This platform requires a paid plan — enroll only if you choose to pay. ' : '') + guidance;
      const open = db.get('SELECT id FROM dist_tasks WHERE platform_slug=? AND status="open"', [p.slug]);
      if (!open) {
        db.run('INSERT INTO dist_tasks (platform_slug,action,status,guidance,submit_url,created_at) VALUES (?,?,?,?,?,?)',
          [p.slug, action, 'open', sub, p.signup_url || p.url, db.now()]);
      }
    }
    if (isNew) newlyDiscovered.push(p.slug);
  }
  db.persist();
  return {
    checked: checked.length,
    reachable: checked.filter((c) => c.reachable).length,
    newly_discovered: newlyDiscovered.length,
    fully_auto_no_action: rows.filter((p) => p.access === 'none' || (p.access === 'free_key' && p.method === 'api')).map((p) => p.slug),
    next_due: db.get('SELECT COUNT(*) AS c FROM dist_platforms WHERE last_checked IS NULL OR last_checked < ?', [cutoff]).c,
    checked_rows: checked
  };
}

// Daily opportunity report — the honest "new places today" feed.
function opportunities(limit = 10) {
  const rows = db.all(
    'SELECT slug,name,country_code,region,url,signup_url,access,method,paid,manual_approval,email_verification,discovered_at,last_checked,last_success,last_failure,failure_message,status,score FROM dist_platforms ORDER BY score DESC, name LIMIT ?',
    [limit]
  );
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const nowDay = Math.floor(todayStart.getTime() / 1000);
  const status = {
    total: db.get('SELECT COUNT(*) AS c FROM dist_platforms').c,
    connected: db.get('SELECT COUNT(*) AS c FROM dist_platforms WHERE status="connected"').c,
    pending: db.get('SELECT COUNT(*) AS c FROM dist_platforms WHERE status="pending"').c,
    today: db.get('SELECT COUNT(*) AS c FROM dist_platforms WHERE discovered_at>=?', [nowDay]).c,
    by_access: db.all('SELECT access, COUNT(*) AS c FROM dist_platforms GROUP BY access')
  };
  return { status, platforms: rows.map((r) => ({ ...r, country_name: countryLabel(r.country_code) })) };
}

// Spread of discovery target markets and how many real opportunities each has.
function coverage() {
  const map = {};
  for (const code of TARGETS) {
    map[code] = { code, country: countryLabel(code), platforms: db.get('SELECT COUNT(*) AS c FROM dist_platforms WHERE country_code=?', [code]).c };
  }
  return map;
}

module.exports = { CATALOG, seedRegistry, discover, opportunities, coverage, countryLabel };