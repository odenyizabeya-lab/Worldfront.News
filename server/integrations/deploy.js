// Vercel self-redeploy helper.
//
// The project is deployed with the Vercel CLI (no Git repository is connected),
// so Vercel Deploy Hooks and Git-triggered rebuilds are not available. Instead,
// the daily cron hits /api/cron/shop-redeploy, which calls the official Vercel
// REST API to REBUILD the latest production deployment. The rebuild re-runs the
// build pipeline (npm install → postinstall → build) on the same file tree, so
// build-regenerate.js produces a fresh bundled DB with the current day's
// editions, making them durable across cold starts.
//
// Requires the env var DEPLOY_TOKEN (a Vercel access token) to be set on the
// project. Guarded by a 12h cooldown so cron retries never double-trigger.
const API = 'https://api.vercel.com';
const TEAM = 'odenyizabeya-lab';
const PROJECT_ID = 'prj_OEn517xXnH1z05Aj0sdpAcLpKqA7';
const COOLDOWN_S = 12 * 3600;

const db = require('../db');

async function vercelApi(path, options = {}) {
  const token = process.env.DEPLOY_TOKEN;
  if (!token) throw new Error('DEPLOY_TOKEN env var is not set');
  const res = await fetch(API + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(90000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : JSON.stringify(data).slice(0, 200);
    throw new Error('Vercel API ' + res.status + ': ' + msg);
  }
  return data;
}

// Trigger a rebuild of the most recent production deployment.
// Only rebuilds when there is a publication for today to bake in (otherwise the
// running bundle is already current) and never more often than the cooldown.
// Rebuilds never delete anything — the running deploy stays live for the whole
// build, and on failure the previous production deployment remains untouched.
async function redeployProduction() {
  await db.ready();
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_redeploy'");
  const lastTs = last ? parseInt(last.value, 10) || 0 : 0;
  if (lastTs && (db.now() - lastTs) < COOLDOWN_S) {
    return { skipped: true, last_redeploy: lastTs };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayEditions = db.get(
    'SELECT COUNT(*) AS n FROM shop_publication_days WHERE pub_date=?',
    [today]
  );
  if (!todayEditions || todayEditions.n === 0) {
    return { skipped: true, reason: 'no editions published for today yet', last_redeploy: lastTs };
  }

  const list = await vercelApi(`/v6/deployments?projectId=${PROJECT_ID}&target=production&state=READY&limit=1&teamId=${TEAM}`);
  const latest = list && list.deployments && list.deployments[0];
  if (!latest || !latest.uid) throw new Error('no production deployment found to redeploy');

  const dep = await vercelApi(`/v13/deployments?forceNew=1&teamId=${TEAM}`, {
    method: 'POST',
    body: {
      deploymentId: latest.uid,
      meta: { action: 'redeploy' },
      name: 'worldfront-news',
      target: 'production'
    }
  });

  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_redeploy',?)", [String(db.now())]);
  db.persist();
  return { redeployed: true, from: latest.uid, url: dep.url || '', id: dep.id || '' };
}

// Hourly rebuild trigger used by the GitHub Actions scheduler (the primary
// free hourly mechanism). Rebuilds the latest production deployment so the
// build pipeline re-syncs the shop and re-bundles today's complete editions.
// Reuses the same file tree (no uploads needed — the build itself regenerates
// the bundled DB via postinstall). Guarded by a 45-minute cooldown so a
// retried tick never double-triggers. On failure the live deployment is
// untouched.
async function rebuildNow() {
  await db.ready();
  const last = db.get("SELECT value FROM settings WHERE key='last_shop_rebuild'");
  const lastTs = last ? parseInt(last.value, 10) || 0 : 0;
  if (lastTs && (db.now() - lastTs) < 45 * 60) {
    return { skipped: true, last_rebuild: lastTs };
  }

  const list = await vercelApi(`/v6/deployments?projectId=${PROJECT_ID}&target=production&state=READY&limit=1&teamId=${TEAM}`);
  const latest = list && list.deployments && list.deployments[0];
  if (!latest || !latest.uid) throw new Error('no production deployment found to rebuild');

  const dep = await vercelApi(`/v13/deployments?forceNew=1&teamId=${TEAM}`, {
    method: 'POST',
    body: {
      deploymentId: latest.uid,
      meta: { action: 'redeploy' },
      name: 'worldfront-news',
      target: 'production'
    }
  });

  db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_rebuild',?)", [String(db.now())]);
  db.persist();
  return { rebuilt: true, from: latest.uid, url: dep.url || '', id: dep.id || '' };
}

module.exports = { redeployProduction, rebuildNow };