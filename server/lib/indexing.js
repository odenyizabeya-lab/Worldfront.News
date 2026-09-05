// WorldFront.News — Google Indexing + Search Console integration
//
// -----------------------------------------------------------------------------
// THE CORRECT WORKFLOW FOR REAL-ESTATE (AND MOST) PAGES
// -----------------------------------------------------------------------------
// Google's Indexing API (https://developers.google.com/indexing-API/v3/quickstart)
// is officially supported ONLY for two page types: JobPosting and BroadcastEvent.
// It is NOT supported for real-estate property/review pages, and using it there
// causes errors ("Request entity must use supported schema for URL").
//
// For real estate the correct, supported discovery path is:
//
//   1. XML sitemap index (/sitemap.xml) with accurate <lastmod> dates, so Google
//      detects new/updated property pages within a normal crawl cycle.
//   2. A fast sitemap → crawl is NOT instant. Expect minutes-to-days depending on
//      Google's crawl queues. The system never promises instant indexing.
//   3. Internal links from the home page, country pages and location pages to
//      every property (implemented in the SSR pages).
//   4. One canonical URL per property (implemented on /shop/product/:id).
//   5. Correct HTTP 200 for live pages and appropriate status codes otherwise.
//   6. robots.txt allowing crawl of all public pages (implemented).
//   7. Valid RealEstateListing structured data (implemented — supported and
//      eligible for the property-rental/living place enhancement where
//      requirements are met; it never "guarantees" a rich result).
//   8. Search Console monitoring of the sitemap + URL inspection.
//
// The module below therefore:
//   * Never calls the Indexing API for property pages (it would rightly fail).
//   * Implements an optional Search Console (webmasters v3) URL-inspection
//     integration when the admin provides a Google service-account JSON path via
//     the GOOGLE_ADSERVICE / GOOGLE_SERVICE_ACCOUNT_JSON environment variable.
//     Credentials are NEVER stored in code, HTML, JS or the DB — they live only
//     in server-side environment variables on the host.
//   * Logs every submission/check into sc_log for the admin report.
// -----------------------------------------------------------------------------
//
// REQUIRED SEARCH CONSOLE SETUP (documented for the admin):
//   1. Verify the domain (or prefix) in Google Search Console. The site supports
//      google-site-verification meta via GOOGLE_SITE_VERIFICATION and serves
//      /google/{token}.html (see seo.js).
//   2. Add sitemap index: https://www.worldfront.news/sitemap.xml
//   3. Under "Sitemaps", verify the index shows 0 errors.
//   4. Optional (URL inspection / API): create a Google Cloud project, enable
//      the "Google Search Console API", create a service account, and share the
//      Search Console property with the service account email. Put the JSON key
//      path in GOOGLE_SERVICE_ACCOUNT_JSON (server-side only). The app then uses
//      the URL-inspection API to READ indexing status — it never requests
//      indexing of non-supported page types.
// -----------------------------------------------------------------------------

const db = require('../db');

// Splits a property URL into its parts to build accurate sitemap <lastmod>.
function logAction(url, action, status, message) {
  try {
    db.run('INSERT INTO sc_log (url,action,status,message,created_at) VALUES (?,?,?,?,?)',
      [String(url || '').slice(0, 300), String(action || ''), String(status || '').slice(0, 40),
       String(message || '').slice(0, 500), db.now()]);
    db.persist();
  } catch (e) { /* audit log must never break the site */ }
}

// Returns the current Search Console configuration state (never the secret).
function gscConfig() {
  return {
    site_verified: !!(process.env.GOOGLE_SITE_VERIFICATION),
    verification_token: process.env.GOOGLE_SITE_VERIFICATION || null,
    url_inspection_enabled: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    service_account_configured: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    // Real-estate pages cannot use the Indexing API; document why:
    indexing_api_supported: false,
    indexing_api_reason: 'Google only supports the Indexing API for JobPosting and BroadcastEvent pages, not real-estate listings.',
    recommended_method: 'XML sitemap + Search Console monitoring'
  };
}

// Optional: read indexing status via the Search Console URL-inspection API.
// Requires GOOGLE_SERVICE_ACCOUNT_JSON (server-side env only) and network
// access to the Google OAuth endpoints. Returns the raw inspection result, or
// a graceful error object. Never throws.
async function inspectUrl(url) {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyPath) {
    logAction(url, 'inspect', 'skipped', 'Service account not configured');
    return { skipped: true, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON not set on the server' };
  }
  const { googleapis } = tryRequireGoogle();
  if (!googleapis) {
    logAction(url, 'inspect', 'skipped', 'googleapis package not installed');
    return { skipped: true, reason: 'googleapis library not available' };
  }
  try {
    const auth = new googleapis.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
    });
    const jwt = await auth.getClient();
    const token = await jwt.getAccessToken();
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (token && token.token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: siteUrlFor(url) }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logAction(url, 'inspect', 'error', 'HTTP ' + res.status + ' ' + body.slice(0, 300));
      return { error: res.status, body };
    }
    const data = await res.json();
    const result = data.inspectionResult || data;
    logAction(url, 'inspect', 'ok', JSON.stringify(result).slice(0, 400));
    return {
      url,
      index_status: (result.indexStatusResult && result.indexStatusResult.coverageState) || null,
      sitemap_indexed: result.indexStatusResult ? !!result.indexStatusResult.robotsTxtState : null,
      last_crawled: result.indexStatusResult ? result.indexStatusResult.lastCrawlTime : null,
      raw: result
    };
  } catch (e) {
    logAction(url, 'inspect', 'error', String((e && e.message) || e));
    return { error: String((e && e.message) || e) };
  }
}

function siteUrlFor(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + u.host;
  } catch (e) {
    return 'https://www.worldfront.news';
  }
}

// Server-side only dependency (optional). googleapis is not in package.json;
// the inspect feature is dormant until it is installed — this keeps the runtime
// dependency-free by default.
function tryRequireGoogle() {
  try {
    return { googleapis: require('googleapis') };
  } catch (e) {
    return {};
  }
}

// Recent indexing-log entries for the admin report (no secrets stored).
function recentLog(limit) {
  const n = Math.min(Math.max(parseInt(limit || 30, 10), 1), 200);
  return db.all('SELECT * FROM sc_log ORDER BY id DESC LIMIT ?', [n]);
}

module.exports = { logAction, gscConfig, inspectUrl, recentLog, siteUrlFor };