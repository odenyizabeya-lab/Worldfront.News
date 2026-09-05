// Vercel self-redeploy helper.
//
// Two ways to rebuild production:
//   1. DEPLOY_HOOK_URL — a Vercel Deploy Hook (public URL, no token). POSTing to
//      it rebuilds the latest production deployment on the same file tree, so
//      the build pipeline re-generates the bundled DB (build-regenerate.js) with
//      that day's complete editions. Preferred: works even if access tokens are
//      revoked or missing.
//   2. DEPLOY_TOKEN fallback — the official Vercel REST API path, kept as a
//      fallback for when no hook is configured.
//
// Rebuilds are guarded by a cooldown (12h for redeployProduction, 45min for the
// hourly rebuildNow) so retried crons never double-trigger. Rebuilds never
// delete anything — the running deploy stays live, and on failure the previous
// production deployment remains untouched.
const API = 'https://api.vercel.com';
const TEAM = process.env.DEPLOY_TEAM || 'odenyizabeya-lab';
const PROJECT_ID = process.env.DEPLOY_PROJECT_ID || 'prj_OEn517xXnH1z05Aj0sdpAcLpKqA7';
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
    throw new Error(
      'Vercel API ' + res.status + ': ' + msg +
      ' — the DEPLOY_TOKEN env var on the Vercel project is missing or was revoked/expired. ' +
      'Fix: set a valid token as DEPLOY_TOKEN, or (preferred) set DEPLOY_HOOK_URL to a Vercel Deploy Hook URL so some rebuilds need no token at all.'
    );
  }
  return data;
}

// Trigger a production rebuild via a Vercel Deploy Hook (public URL, no token
// needed). Deploy Hooks re-deploy the latest production deployment on the same
// file tree, which is exactly what the API-based rebuild does — minus any
// credential dependency. Returns null when DEPLOY_HOOK_URL is not configured so
// callers can fall back to the API path.
async function triggerHook() {
  const hook = process.env.DEPLOY_HOOK_URL;
  if (!hook) return null;
  const res = await fetch(hook, {
    method: 'POST',
    signal: AbortSignal.timeout(90000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error ? data.error.message : JSON.stringify(data).slice(0, 200);
    throw new Error('Deploy Hook HTTP ' + res.status + ': ' + msg);
  }
  return { id: data.id || data.deploymentId || '', job: data.job || '', url: data.url || '' };
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

  const hook = await triggerHook();
  if (hook) {
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_redeploy',?)", [String(db.now())]);
    db.persist();
    return { redeployed: true, via: 'deploy-hook', id: hook.id, job: hook.job, url: hook.url || '' };
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

  const hook = await triggerHook();
  if (hook) {
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_shop_rebuild',?)", [String(db.now())]);
    db.persist();
    return { rebuilt: true, via: 'deploy-hook', id: hook.id, job: hook.job, url: hook.url || '' };
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