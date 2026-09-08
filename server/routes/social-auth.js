// Social Media OAuth Callback Routes
// Handles OAuth authorization callbacks for all connected platforms.
// These are public endpoints (no auth required) that receive the OAuth callback
// from each platform and exchange the code for tokens.
const express = require('express');
const db = require('../db');
const { exchangeCode, PLATFORMS } = require('../lib/social/platforms');

const router = express.Router();

// ---- TikTok OAuth Callback ----
router.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return sendResult(res, false, 'TikTok denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from TikTok');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const result = await exchangeCode('tiktok', code, base + '/api/social/auth/tiktok/callback');
    if (!result.ok) return sendResult(res, false, result.message);

    // Fetch the user's display name so the account record and post URLs are usable.
    let displayName = result.open_id || 'tiktok_user';
    try {
      const userResp = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username',
        { headers: { 'Authorization': 'Bearer ' + result.access_token } }
      );
      const userData = await userResp.json().catch(() => ({}));
      const ud = userData.data && userData.data.user;
      if (ud && (ud.display_name || ud.username)) displayName = ud.display_name || ud.username;
    } catch (e) { /* non-fatal: fall back to open_id */ }

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='tiktok' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         platform_user_id=?, account_name=?, account_label=?, scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 86400),
         result.open_id || '', displayName, displayName, result.scope || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, account_name, account_label, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['tiktok', result.open_id || '', result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 86400),
         displayName, displayName, result.scope || '', 1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'TikTok connected! User: ' + displayName + '. Close this window.');
  } catch (e) {
    sendResult(res, false, 'TikTok connection error: ' + e.message);
  }
});

// ---- Facebook OAuth Callback ----
router.get('/auth/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return sendResult(res, false, 'Facebook denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from Facebook');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const result = await exchangeCode('facebook', code, base + '/api/social/auth/facebook/callback');
    if (!result.ok) return sendResult(res, false, result.message);

    // Fetch pages the user manages
    const pagesResp = await fetch('https://graph.facebook.com/v19.0/me/accounts?access_token=' + encodeURIComponent(result.access_token));
    const pagesData = await pagesResp.json().catch(() => ({}));
    const pages = pagesData.data || [];
    const page = pages[0] || {};

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='facebook' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         platform_user_id=?, page_id=?, page_name=?, account_name=?, scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [page.access_token || result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         page.id || '', page.id || '', page.name || '', page.name || '',
         result.scope || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, page_id, page_name, account_name, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, ?, ?)`,
        ['facebook', page.id || '', page.access_token || result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         page.id || '', page.name || '', page.name || '', result.scope || '',
         1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'Facebook connected! Page: ' + (page.name || 'unknown') + '. Close this window.');
  } catch (e) {
    sendResult(res, false, 'Facebook connection error: ' + e.message);
  }
});

// ---- YouTube OAuth Callback ----
router.get('/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return sendResult(res, false, 'YouTube denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from YouTube');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const result = await exchangeCode('youtube', code, base + '/api/social/auth/youtube/callback');
    if (!result.ok) return sendResult(res, false, result.message);

    // Fetch channel info
    const channelResp = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&access_token=' + encodeURIComponent(result.access_token));
    const channelData = await channelResp.json().catch(() => ({}));
    const channel = (channelData.items && channelData.items[0]) || {};

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='youtube' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         platform_user_id=?, account_name=?, account_label=?, scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         channel.id || '', channel.snippet && channel.snippet.title || '',
         channel.snippet && channel.snippet.title || '', result.scope || '',
         db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, account_name, account_label, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, ?)`,
        ['youtube', channel.id || '', result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         channel.snippet && channel.snippet.title || '',
         channel.snippet && channel.snippet.title || '', result.scope || '',
         1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'YouTube connected! Channel: ' + ((channel.snippet && channel.snippet.title) || 'unknown') + '. Close this window.');
  } catch (e) {
    sendResult(res, false, 'YouTube connection error: ' + e.message);
  }
});

// ---- Twitter/X OAuth Callback ----
router.get('/auth/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return sendResult(res, false, 'X (Twitter) denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from X (Twitter)');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const pkceRow = state ? db.get('SELECT value FROM settings WHERE key=?', ['oauth_pkce_' + state]) : null;
    const result = await exchangeCode('twitter', code, base + '/api/social/auth/twitter/callback', { code_verifier: (pkceRow && pkceRow.value) || '' });
    if (!result.ok) return sendResult(res, false, result.message);

    // Fetch user info
    const userResp = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': 'Bearer ' + result.access_token }
    });
    const userData = await userResp.json().catch(() => ({}));
    const user = userData.data || {};

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='twitter' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         platform_user_id=?, account_name=?, account_label=?, scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 7200),
         user.id || '', user.username || '', user.name || user.username || '',
         result.scope || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, account_name, account_label, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, ?)`,
        ['twitter', user.id || '', result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 7200),
         user.username || '', user.name || user.username || '', result.scope || '',
         1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'X (Twitter) connected! @' + (user.username || 'unknown') + '. Close this window.');
  } catch (e) {
    sendResult(res, false, 'X (Twitter) connection error: ' + e.message);
  }
});

// ---- LinkedIn OAuth Callback ----
router.get('/auth/linkedin/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return sendResult(res, false, 'LinkedIn denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from LinkedIn');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const result = await exchangeCode('linkedin', code, base + '/api/social/auth/linkedin/callback');
    if (!result.ok) return sendResult(res, false, result.message);

    // Fetch user profile
    const profileResp = await fetch('https://api.linkedin.com/v2/me', {
      headers: { 'Authorization': 'Bearer ' + result.access_token }
    });
    const profileData = await profileResp.json().catch(() => ({}));
    const person = profileData || {};
    const firstName = person.firstName || '';
    const lastName = person.lastName || '';
    const linkedinId = person.id || '';

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='linkedin' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         platform_user_id=?, account_name=?, account_label=?, scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         linkedinId, (firstName + ' ' + lastName).trim(), (firstName + ' ' + lastName).trim(),
         result.scope || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, platform_user_id, access_token, refresh_token, token_expires_at, account_name, account_label, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, ?)`,
        ['linkedin', linkedinId, result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         (firstName + ' ' + lastName).trim(), (firstName + ' ' + lastName).trim(),
         result.scope || '', 1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'LinkedIn connected! (' + ((firstName + ' ' + lastName).trim() || 'unknown') + '). Close this window.');
  } catch (e) {
    sendResult(res, false, 'LinkedIn connection error: ' + e.message);
  }
});

// ---- Pinterest OAuth Callback ----
router.get('/auth/pinterest/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return sendResult(res, false, 'Pinterest denied access: ' + error);
  if (!code) return sendResult(res, false, 'No authorization code received from Pinterest');

  try {
    const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
    const result = await exchangeCode('pinterest', code, base + '/api/social/auth/pinterest/callback');
    if (!result.ok) return sendResult(res, false, result.message);

    const existing = db.get("SELECT id FROM social_accounts WHERE platform='pinterest' LIMIT 1");
    if (existing) {
      db.run(
        `UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?,
         scope=?, connected=1, enabled=1, updated_at=? WHERE id=?`,
        [result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         result.scope || '', db.now(), existing.id]
      );
    } else {
      db.run(
        `INSERT INTO social_accounts (platform, access_token, refresh_token, token_expires_at, scope, connected, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, ?, ?)`,
        ['pinterest', result.access_token, result.refresh_token || '',
         Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
         result.scope || '', 1, 1, db.now(), db.now()]
      );
    }
    db.persist();
    sendResult(res, true, 'Pinterest connected! Close this window.');
  } catch (e) {
    sendResult(res, false, 'Pinterest connection error: ' + e.message);
  }
});

// Instagram uses the same Facebook OAuth (handled in facebook callback above)
router.get('/auth/instagram/callback', (req, res) => {
  // Redirect to the Facebook callback handler
  res.redirect('/api/social/auth/facebook/callback?' + new URLSearchParams(req.query).toString());
});

// ---- Render a result page for OAuth callbacks ----
function sendResult(res, ok, message) {
  const color = ok ? '#1a7f37' : '#d40000';
  const icon = ok ? '&#10003;' : '&#10007;';
  const safe = String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Social Media Connection</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d0b14; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #1a1824; border: 1px solid #2a2a3d; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; }
  .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
  .msg { font-size: 16px; line-height: 1.6; margin: 16px 0; }
  .btn { display: inline-block; padding: 10px 24px; background: #1f6feb; color: #fff; text-decoration: none; border-radius: 8px; margin-top: 16px; font-size: 14px; }
  .btn:hover { background: #1553b0; }
</style></head><body>
<div class="box">
  <div class="icon">${icon}</div>
  <div class="msg">${safe}</div>
  <a class="btn" onclick="window.close()">Close Window</a>
  <a class="btn" href="/#/admin/social" style="background:#555">Go to Admin</a>
</div>
<script>setTimeout(function(){ window.close(); }, 5000);</script>
</body></html>`);
}

module.exports = router;
