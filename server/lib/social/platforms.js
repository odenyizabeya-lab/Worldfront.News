// Social Media Platform Connectors and OAuth Configuration
// All API calls use official APIs only. No scraping, no bots, no unofficial methods.
const crypto = require('crypto');
const db = require('../../db');

const UA = 'Mozilla/5.0 (compatible; WorldFrontNews/1.0; +https://www.worldfront.news)';

async function httpJson(url, options, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const opts = { ...options, signal: ctrl.signal, headers: { 'user-agent': UA, ...(options.headers || {}) } };
  try {
    const r = await fetch(url, opts);
    const text = await r.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { ok: r.ok, status: r.status, text, json, headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, text: e.message, json: null, headers: null };
  } finally {
    clearTimeout(t);
  }
}

// ---- Platform definitions ----
const PLATFORMS = {
  tiktok: {
    name: 'TikTok',
    auth_url: 'https://www.tiktok.com/v2/auth/authorize/',
    token_url: 'https://open.tiktokapis.com/v2/oauth/token/',
    api_base: 'https://open.tiktokapis.com/v2',
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    content_types: ['products', 'articles', 'site_articles', 'breaking'],
    requires_app_review: true,
    review_note: 'TikTok requires app review before video publishing is enabled. Create your app at https://developers.tiktok.com and submit for review. Video posting API is only available after approval.',
    setup_steps: [
      '1. Go to https://developers.tiktok.com and create a developer account',
      '2. Create a new app in the TikTok Developer Portal',
      '3. Set the redirect URI to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/tiktok/callback',
      '4. Note your Client Key and Client Secret',
      '5. Submit your app for TikTok review (required for video.publish and video.upload permissions)',
      '6. Enter your Client Key and Client Secret below to connect'
    ],
    has_video: true,
    max_caption: 2200,
    max_hashtags: 15
  },
  facebook: {
    name: 'Facebook Pages',
    auth_url: 'https://www.facebook.com/v19.0/dialog/oauth',
    token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
    api_base: 'https://graph.facebook.com/v19.0',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'publish_video', 'publish_to_groups'],
    content_types: ['products', 'articles', 'site_articles', 'breaking'],
    setup_steps: [
      '1. Go to https://developers.facebook.com and create an app',
      '2. Add "Facebook Login" product and set the redirect URI to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/facebook/callback',
      '3. Go to https://business.facebook.com to create or use an existing Page',
      '4. After connecting, select which Page to post to',
      '5. Enter your App ID and App Secret below'
    ],
    has_video: true,
    max_caption: 63206,
    max_hashtags: 30
  },
  instagram: {
    name: 'Instagram',
    auth_url: 'https://www.facebook.com/v19.0/dialog/oauth',
    token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
    api_base: 'https://graph.facebook.com/v19.0',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'],
    content_types: ['products', 'articles', 'site_articles'],
    setup_steps: [
      '1. Instagram posting requires a Facebook Page connected to an Instagram Business/Creator account',
      '2. Use the Facebook OAuth flow to connect your Facebook Pages',
      '3. After connecting, select which Instagram Business account to post to',
      '4. Note: Instagram only supports image posts and Reels via the API'
    ],
    has_video: true,
    max_caption: 2200,
    max_hashtags: 30,
    parent_platform: 'facebook'
  },
  youtube: {
    name: 'YouTube',
    auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_url: 'https://oauth2.googleapis.com/token',
    api_base: 'https://www.googleapis.com/youtube/v3',
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
    content_types: ['products', 'articles', 'site_articles'],
    setup_steps: [
      '1. Go to https://console.cloud.google.com and create a project',
      '2. Enable the YouTube Data API v3',
      '3. Create OAuth 2.0 credentials (Web application)',
      '4. Set the redirect URI to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/youtube/callback',
      '5. Submit your app for Google verification if publishing publicly',
      '6. Enter your Client ID and Client Secret below'
    ],
    has_video: true,
    max_caption: 5000,
    max_hashtags: 15
  },
  twitter: {
    name: 'X (Twitter)',
    auth_url: 'https://twitter.com/i/oauth2/authorize',
    token_url: 'https://api.twitter.com/2/oauth/token',
    api_base: 'https://api.twitter.com/2',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    content_types: ['articles', 'breaking', 'products', 'site_articles'],
    setup_steps: [
      '1. Go to https://developer.x.com and apply for a developer account',
      '2. Create a new Project and App in the Developer Portal',
      '3. Set the callback URL to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/twitter/callback',
      '4. Enable OAuth 2.0 with PKCE in app settings',
      '5. Note: X API write access requires a paid Basic plan ($100/month)',
      '6. Enter your Client ID and Client Secret below'
    ],
    has_video: false,
    max_caption: 280,
    max_hashtags: 10,
    requires_paid: true,
    paid_note: 'X (Twitter) API v2 write access requires a paid Basic plan ($100/month) at https://developer.x.com/en/portal/products'
  },
  linkedin: {
    name: 'LinkedIn',
    auth_url: 'https://www.linkedin.com/oauth/v2/authorization',
    token_url: 'https://www.linkedin.com/oauth/v2/accessToken',
    api_base: 'https://api.linkedin.com/v2',
    scopes: ['w_member_social', 'r_liteprofile', 'r_emailaddress'],
    content_types: ['articles', 'breaking', 'site_articles'],
    setup_steps: [
      '1. Go to https://www.linkedin.com/developers and create an app',
      '2. Request the "Share on LinkedIn" product (w_member_social scope)',
      '3. Set the redirect URI to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/linkedin/callback',
      '4. Submit for LinkedIn app review (required for w_member_social)',
      '5. Enter your Client ID and Client Secret below'
    ],
    has_video: false,
    max_caption: 3000,
    max_hashtags: 10,
    requires_app_review: true,
    review_note: 'LinkedIn requires app review before the w_member_social permission is granted.'
  },
  pinterest: {
    name: 'Pinterest',
    auth_url: 'https://www.pinterest.com/oauth/',
    token_url: 'https://api.pinterest.com/v5/oauth/token',
    api_base: 'https://api.pinterest.com/v5',
    scopes: ['pins:read', 'pins:write', 'boards:read', 'boards:write'],
    content_types: ['products', 'articles'],
    setup_steps: [
      '1. Go to https://developers.pinterest.com and create an app',
      '2. Set the redirect URI to: ' + (process.env.SITE_URL || 'https://www.worldfront.news') + '/api/social/auth/pinterest/callback',
      '3. Note your App ID and App Secret',
      '4. Submit for Pinterest app review for production access',
      '5. Enter your App ID and App Secret below'
    ],
    has_video: false,
    max_caption: 500,
    max_hashtags: 20,
    requires_app_review: true,
    review_note: 'Pinterest requires app review before production access is granted.'
  },
  telegram: {
    name: 'Telegram Channel',
    api_base: 'https://api.telegram.org',
    scopes: [],
    content_types: ['articles', 'breaking', 'products', 'site_articles'],
    setup_steps: [
      '1. Create a Telegram Bot via @BotFather on Telegram',
      '2. Copy the bot token from BotFather',
      '3. Add the bot as an admin to your Telegram channel',
      '4. Get the channel ID (forward a message from the channel to @userinfobot)',
      '5. Enter the bot token and channel ID below'
    ],
    has_video: true,
    max_caption: 4096,
    max_hashtags: 15,
    auth_type: 'bot_token',
    no_oauth: true
  },
  discord: {
    name: 'Discord Webhook',
    scopes: [],
    content_types: ['articles', 'breaking', 'products', 'site_articles'],
    setup_steps: [
      '1. Go to your Discord server settings → Integrations → Webhooks',
      '2. Create a new webhook and copy the webhook URL',
      '3. Paste the webhook URL below'
    ],
    has_video: false,
    max_caption: 2000,
    max_hashtags: 10,
    auth_type: 'webhook',
    no_oauth: true
  }
};

// ---- Platform posting implementations ----
async function postToTikTok(account, post) {
  if (!account.access_token) return { ok: false, message: 'No access token - reconnect TikTok' };
  const username = account.account_name || account.platform_user_id || '';
  if (!username) return { ok: false, message: 'No TikTok user selected' };

  const caption = buildCaption(post, account);
  const publishInfo = post.media_url || post.content_image;

  if (!publishInfo) {
    return { ok: false, message: 'TikTok requires a video URL for posting' };
  }

  // Download the video first so the init request carries the real size.
  let videoBuffer;
  try {
    const videoResp = await fetch(publishInfo);
    if (!videoResp.ok) return { ok: false, message: 'Could not download video: HTTP ' + videoResp.status };
    videoBuffer = Buffer.from(await videoResp.arrayBuffer());
  } catch (e) {
    return { ok: false, message: 'Could not download video: ' + e.message };
  }
  if (!videoBuffer.length) return { ok: false, message: 'Downloaded video is empty' };

  // Step 1: Initialize video upload
  const initUrl = PLATFORMS.tiktok.api_base + '/post/publish/video/init/';
  const initBody = new URLSearchParams({
    post_info: JSON.stringify({
      title: caption.slice(0, 150),
      privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false
    }),
    source_info: JSON.stringify({
      source: 'FILE_UPLOAD',
      video_size: videoBuffer.length
    })
  });

  const init = await httpJson(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + account.access_token,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: initBody.toString()
  });

  if (!init.ok || !init.json) {
    return { ok: false, message: 'TikTok init failed: ' + (init.json ? JSON.stringify(init.json) : init.text).slice(0, 200) };
  }

  const data = init.json.data || {};
  const publishId = data.publish_id;
  if (!publishId) {
    return { ok: false, message: 'No publish_id returned from TikTok' };
  }

  // Step 2: Upload video content
  const uploadUrl = data.upload_url;
  if (uploadUrl) {
    const upload = await httpJson(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-' + (videoBuffer.length - 1) + '/' + videoBuffer.length
      },
      body: videoBuffer
    }, 60000);

    if (!upload.ok) {
      return { ok: false, message: 'TikTok video upload failed: ' + (upload.text || '').slice(0, 200) };
    }
  }

  // Step 3: Poll publish status for the final video URL (short bounded poll;
  // the post is still marked published-with-pending-processing if it's slow).
  let platformUrl = 'https://www.tiktok.com/@' + username + '/video/' + publishId;
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const status = await httpJson(PLATFORMS.tiktok.api_base + '/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + account.access_token,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ publish_id: publishId }).toString()
    });
    const sdata = status.json && status.json.data;
    if (sdata) {
      if (sdata.status === 'FAILED') {
        return { ok: false, message: 'TikTok processing failed: ' + ((sdata.fail_reason && sdata.fail_reason.message) || 'unknown reason').slice(0, 200) };
      }
      if (sdata.status === 'SUCCESSFUL' && sdata.video && sdata.video.video_url) {
        platformUrl = sdata.video.video_url;
        break;
      }
    }
  }

  return {
    ok: true,
    platform_post_id: publishId,
    platform_url: platformUrl,
    message: platformUrl && platformUrl.indexOf('tiktok.com/@') !== -1
      ? 'Video uploaded to TikTok (pending processing)'
      : 'Posted to TikTok'
  };
}

async function postToFacebook(account, post) {
  if (!account.access_token || !account.page_id) return { ok: false, message: 'No Facebook Page connected' };

  const message = buildCaption(post, account);
  const link = post.content_url || '';
  const picture = post.media_url || post.content_image || '';

  const params = new URLSearchParams({
    message,
    access_token: account.access_token
  });

  if (link) params.append('link', link);
  if (picture) params.append('picture', picture);

  const url = PLATFORMS.facebook.api_base + '/' + account.page_id + '/feed';
  const r = await httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (r.ok && r.json && r.json.id) {
    const postId = r.json.id.split('_').pop() || r.json.id;
    return {
      ok: true,
      platform_post_id: postId,
      platform_url: 'https://www.facebook.com/' + account.page_id + '/posts/' + postId,
      message: 'Posted to Facebook Page'
    };
  }
  return { ok: false, message: 'Facebook error: ' + ((r.json && r.json.error && r.json.error.message) || r.text).slice(0, 200) };
}

async function postToInstagram(account, post) {
  if (!account.access_token || !account.page_id) return { ok: false, message: 'No Instagram account connected' };

  const imageUrl = post.media_url || post.content_image;
  if (!imageUrl) return { ok: false, message: 'Instagram requires an image' };

  const caption = buildCaption(post, account);

  // Step 1: Create media container
  const containerParams = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: account.access_token
  });

  const containerUrl = PLATFORMS.instagram.api_base + '/' + account.page_id + '/media';
  const container = await httpJson(containerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: containerParams.toString()
  });

  if (!container.ok || !container.json || !container.json.id) {
    return { ok: false, message: 'Instagram container error: ' + ((container.json && container.json.error && container.json.error.message) || container.text).slice(0, 200) };
  }

  // Step 2: Publish the container
  const publishParams = new URLSearchParams({
    creation_id: container.json.id,
    access_token: account.access_token
  });

  const publishUrl = PLATFORMS.instagram.api_base + '/' + account.page_id + '/media_publish';
  const publish = await httpJson(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: publishParams.toString()
  });

  if (publish.ok && publish.json && publish.json.id) {
    return {
      ok: true,
      platform_post_id: publish.json.id,
      platform_url: 'https://www.instagram.com/p/' + publish.json.id,
      message: 'Posted to Instagram'
    };
  }
  return { ok: false, message: 'Instagram publish error: ' + ((publish.json && publish.json.error && publish.json.error.message) || publish.text).slice(0, 200) };
}

// ---- Download media into a Buffer (shared by video platforms) ----
async function downloadMedia(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, message: 'Could not download: HTTP ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return { ok: false, message: 'Downloaded media is empty' };
    return { ok: true, buffer: buf };
  } catch (e) {
    return { ok: false, message: 'Could not download: ' + e.message };
  }
}

async function postToYouTube(account, post) {
  if (!account.access_token) return { ok: false, message: 'No YouTube access token' };

  const videoUrl = post.media_url || post.content_image;
  if (!videoUrl) return { ok: false, message: 'YouTube requires a video URL' };

  const dl = await downloadMedia(videoUrl);
  if (!dl.ok) return dl;
  const videoBuffer = dl.buffer;

  const title = (post.content_title || 'New Post').slice(0, 100);
  const description = buildCaption(post, account);

  // Initialize a resumable upload and get the upload URL from the Location
  // header. The endpoint is the upload host (not api_base).
  const initUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
  const metadata = {
    snippet: {
      title,
      description,
      tags: extractHashtags(post, account),
      categoryId: '22' // People & Blogs
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false
    }
  };

  const init = await httpJson(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + account.access_token,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(videoBuffer.length)
    },
    body: JSON.stringify(metadata)
  });

  if (!init.ok) {
    return { ok: false, message: 'YouTube init failed: ' + (init.text || '').slice(0, 200) };
  }

  const location = init.headers && typeof init.headers.get === 'function' ? init.headers.get('location') : null;
  if (!location) {
    return { ok: false, message: 'YouTube: no upload URL returned' };
  }

  // Upload the actual video bytes to the resumable URL.
  let upload;
  try {
    const upResp = await fetch(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: videoBuffer
    });
    const upText = await upResp.text().catch(() => '');
    let upJson = null;
    try { upJson = JSON.parse(upText); } catch (e) {}
    upload = { ok: upResp.ok, status: upResp.status, text: upText, json: upJson };
  } catch (e) {
    return { ok: false, message: 'YouTube upload error: ' + e.message };
  }

  if (!upload.ok) {
    return { ok: false, message: 'YouTube upload failed: ' + (upload.text || '').slice(0, 200) };
  }

  const videoId = upload.json && upload.json.id;
  if (!videoId) {
    return { ok: false, message: 'YouTube upload completed but no video id was returned' };
  }

  return {
    ok: true,
    platform_post_id: videoId,
    platform_url: 'https://youtube.com/watch?v=' + videoId,
    message: 'Video uploaded to YouTube'
  };
}

async function postToTwitter(account, post) {
  if (!account.access_token) return { ok: false, message: 'No X/Twitter access token' };

  // buildCaption() already appends content_url to the text, so the link is
  // auto-shortened by X (t.co). Sending a hand-built 'urls' field is rejected
  // by API v2 as an unknown/read-only parameter.
  let text = buildCaption(post, account);

  // Keep the link intact inside the 280-char limit (trim the prose, never the URL).
  const url = post.content_url || '';
  if (url && text.indexOf(url) !== -1) {
    const idx = text.indexOf(url);
    const tail = text.slice(idx);
    const head = text.slice(0, idx);
    const budget = 280 - tail.length;
    text = (head.length > budget ? head.slice(0, Math.max(0, budget)) : head) + tail;
  }

  const body = { text: text.slice(0, 280) };

  const r = await httpJson(PLATFORMS.twitter.api_base + '/tweets', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + account.access_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (r.ok && r.json && r.json.data && r.json.data.id) {
    const tweetId = r.json.data.id;
    return {
      ok: true,
      platform_post_id: tweetId,
      platform_url: 'https://x.com/i/status/' + tweetId,
      message: 'Posted to X (Twitter)'
    };
  }
  return { ok: false, message: 'X/Twitter error: ' + ((r.json && r.json.detail) || r.text).slice(0, 200) };
}

async function postToLinkedIn(account, post) {
  if (!account.access_token) return { ok: false, message: 'No LinkedIn access token' };

  const author = 'urn:li:person:' + (account.platform_user_id || '');
  const text = buildCaption(post, account);
  const shareUrl = post.content_url || '';

  const payload = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: shareUrl ? 'ARTICLE' : 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  if (shareUrl) {
    payload.specificContent['com.linkedin.ugc.ShareContent'].media = [{
      status: 'READY',
      originalUrl: shareUrl,
      title: { text: (post.content_title || '').slice(0, 200) }
    }];
  }

  const r = await httpJson(PLATFORMS.linkedin.api_base + '/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + account.access_token,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify(payload)
  });

  if (r.ok && r.json && r.json.id) {
    return {
      ok: true,
      platform_post_id: r.json.id,
      platform_url: 'https://www.linkedin.com/feed/update/' + r.json.id,
      message: 'Posted to LinkedIn'
    };
  }
  return { ok: false, message: 'LinkedIn error: ' + ((r.json && r.json.message) || r.text).slice(0, 200) };
}

async function postToPinterest(account, post) {
  if (!account.access_token || !account.page_id) return { ok: false, message: 'No Pinterest board connected' };

  const imageUrl = post.media_url || post.content_image;
  if (!imageUrl) return { ok: false, message: 'Pinterest requires an image' };

  const boardId = account.page_id;
  const title = (post.content_title || 'New Pin').slice(0, 100);
  const description = buildCaption(post, account).slice(0, 500);
  const link = post.content_url || '';

  const params = new URLSearchParams({
    board_id: boardId,
    title,
    description,
    link,
    image_source_url: imageUrl
  });

  const r = await httpJson(PLATFORMS.pinterest.api_base + '/pins', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + account.access_token,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (r.ok && r.json && r.json.id) {
    return {
      ok: true,
      platform_post_id: r.json.id,
      platform_url: 'https://www.pinterest.com/pin/' + r.json.id,
      message: 'Pinned to Pinterest'
    };
  }
  return { ok: false, message: 'Pinterest error: ' + (r.text || '').slice(0, 200) };
}

// ---- Build a public t.me post link from a channel id and message id ----
function telegramPostUrl(channel, messageId) {
  const c = String(channel || '');
  if (/^-\d+$/.test(c)) return 'https://t.me/c/' + c.replace(/^-/, '') + '/' + messageId;
  return 'https://t.me/' + c.replace(/^@/, '') + '/' + messageId;
}

async function postToTelegram(account, post) {
  if (!account.webhook_url) return { ok: false, message: 'No Telegram bot token' };

  const token = account.webhook_url;
  const channel = account.page_id || account.account_name;
  if (!channel) return { ok: false, message: 'No Telegram channel ID' };

  const text = buildCaption(post, account);
  const imageUrl = post.media_url || post.content_image;

  if (imageUrl && text) {
    // Send photo with caption
    const r = await httpJson('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel, photo: imageUrl, caption: text, parse_mode: 'HTML' })
    });
    if (r.ok && r.json && r.json.ok) {
      return { ok: true, platform_post_id: String(r.json.result && r.json.result.message_id), platform_url: telegramPostUrl(channel, r.json.result && r.json.result.message_id), message: 'Sent to Telegram' };
    }
    return { ok: false, message: 'Telegram error: ' + (r.json && r.json.description || r.text || '').slice(0, 200) };
  }

  const r = await httpJson('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: false })
  });
  if (r.ok && r.json && r.json.ok) {
    return { ok: true, platform_post_id: String(r.json.result && r.json.result.message_id), platform_url: telegramPostUrl(channel, r.json.result && r.json.result.message_id), message: 'Sent to Telegram' };
  }
  return { ok: false, message: 'Telegram error: ' + (r.json && r.json.description || r.text || '').slice(0, 200) };
}

async function postToDiscord(account, post) {
  const webhookUrl = account.webhook_url;
  if (!webhookUrl) return { ok: false, message: 'No Discord webhook URL' };

  const content = buildCaption(post, account).slice(0, 2000);
  const embeds = [];

  if (post.content_title || post.media_url) {
    const embed = {};
    if (post.content_title) embed.title = post.content_title.slice(0, 256);
    if (post.content_url) embed.url = post.content_url;
    if (post.content_image || post.media_url) embed.image = { url: post.media_url || post.content_image };
    if (post.content_summary) embed.description = post.content_summary.slice(0, 4096);
    embeds.push(embed);
  }

  const body = { content };
  if (embeds.length) body.embeds = embeds;

  const r = await httpJson(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (r.ok) {
    return { ok: true, platform_post_id: 'webhook', platform_url: '', message: 'Sent to Discord' };
  }
  return { ok: false, message: 'Discord webhook error: ' + r.text.slice(0, 200) };
}

// ---- Token refresh for platforms that support it ----
async function refreshToken(account) {
  if (!account.refresh_token || !account.platform) return { ok: false, message: 'No refresh token' };

  const plat = PLATFORMS[account.platform];
  if (!plat || !plat.token_url) return { ok: false, message: 'Platform does not support token refresh' };

  const secrets = getPlatformSecrets(account.platform);
  if (!secrets.client_id || !secrets.client_secret) return { ok: false, message: 'Platform secrets not configured on server' };

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    client_id: secrets.client_id,
    client_secret: secrets.client_secret
  });

  if (plat.scopes && plat.scopes.length) {
    params.append('scope', plat.scopes.join(' '));
  }

  const r = await httpJson(plat.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (r.ok && r.json && r.json.access_token) {
    const newToken = r.json.access_token;
    const newRefresh = r.json.refresh_token || account.refresh_token;
    const expiresIn = r.json.expires_in || 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    db.run(
      'UPDATE social_accounts SET access_token=?, refresh_token=?, token_expires_at=?, updated_at=? WHERE id=?',
      [newToken, newRefresh, expiresAt, db.now(), account.id]
    );
    db.persist();

    return { ok: true, access_token: newToken, expires_at: expiresAt };
  }
  return { ok: false, message: 'Token refresh failed: ' + (r.text || '').slice(0, 200) };
}

// ---- OAuth URL generation ----
function getOAuthUrl(platform, state) {
  const plat = PLATFORMS[platform];
  if (!plat || plat.no_oauth) return null;

  const secrets = getPlatformSecrets(platform);
  if (!secrets.client_id) return null;

  const base = (process.env.SITE_URL || 'https://www.worldfront.news').replace(/\/$/, '');
  const redirectUri = base + '/api/social/auth/' + platform + '/callback';

  if (platform === 'tiktok') {
    const params = new URLSearchParams({
      client_key: secrets.client_id,
      scope: plat.scopes.join(','),
      response_type: 'code',
      redirect_uri: redirectUri,
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  if (platform === 'facebook' || platform === 'instagram') {
    const params = new URLSearchParams({
      client_id: secrets.client_id,
      redirect_uri: redirectUri,
      scope: plat.scopes.join(','),
      response_type: 'code',
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  if (platform === 'youtube') {
    const params = new URLSearchParams({
      client_id: secrets.client_id,
      redirect_uri: redirectUri,
      scope: plat.scopes.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  if (platform === 'twitter') {
    // Twitter/X requires OAuth 2.0 PKCE. Generate a real code_verifier and its
    // S256 challenge, and keep the verifier server-side (keyed by state) so the
    // callback can prove possession of the code.
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", ['oauth_pkce_' + state, verifier]);
    db.persist();

    const params = new URLSearchParams({
      client_id: secrets.client_id,
      redirect_uri: redirectUri,
      scope: plat.scopes.join(' '),
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  if (platform === 'linkedin') {
    const params = new URLSearchParams({
      client_id: secrets.client_id,
      redirect_uri: redirectUri,
      scope: plat.scopes.join(' '),
      response_type: 'code',
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  if (platform === 'pinterest') {
    const params = new URLSearchParams({
      client_id: secrets.client_id,
      redirect_uri: redirectUri,
      scope: plat.scopes.join(','),
      response_type: 'code',
      state: state || ''
    });
    return plat.auth_url + '?' + params.toString();
  }

  return null;
}

// ---- Exchange authorization code for tokens ----
async function exchangeCode(platform, code, redirectUri, extra) {
  const plat = PLATFORMS[platform];
  if (!plat) return { ok: false, message: 'Unknown platform' };

  const secrets = getPlatformSecrets(platform);
  if (!secrets.client_id || !secrets.client_secret) return { ok: false, message: 'Platform secrets not configured' };

  if (platform === 'tiktok') {
    const params = new URLSearchParams({
      client_key: secrets.client_id,
      client_secret: secrets.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const r = await httpJson(plat.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (r.ok && r.json && r.json.data) {
      const d = r.json.data;
      return {
        ok: true,
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_in: d.expires_in || 86400,
        open_id: d.open_id,
        scope: d.scope
      };
    }
    return { ok: false, message: (r.json && r.json.error && r.json.error.message) || r.text || 'Token exchange failed' };
  }

  if (platform === 'twitter') {
    const codeVerifier = (extra && extra.code_verifier) || '';
    if (!codeVerifier) return { ok: false, message: 'Missing PKCE verifier for X/Twitter' };

    const params = new URLSearchParams({
      client_id: secrets.client_id,
      code_verifier: codeVerifier,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });

    const r = await httpJson(plat.token_url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secrets.client_id + ':' + secrets.client_secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (r.ok && r.json && r.json.access_token) {
      return {
        ok: true,
        access_token: r.json.access_token,
        refresh_token: r.json.refresh_token,
        expires_in: r.json.expires_in || 7200,
        token_type: r.json.token_type,
        scope: r.json.scope
      };
    }
    return { ok: false, message: (r.json && r.json.error_description) || r.text || 'Token exchange failed' };
  }

  // Standard OAuth2 exchange for Facebook, YouTube, LinkedIn, Pinterest
  const params = new URLSearchParams({
    client_id: secrets.client_id,
    client_secret: secrets.client_secret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const r = await httpJson(plat.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (r.ok && r.json) {
    const d = r.json;
    return {
      ok: true,
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_in: d.expires_in || 3600,
      token_type: d.token_type,
      scope: d.scope || ''
    };
  }
  return { ok: false, message: (r.json && r.json.error && r.json.error.message) || r.text || 'Token exchange failed' };
}

// ---- Get platform secrets from environment ----
function getPlatformSecrets(platform) {
  const prefix = platform.toUpperCase();
  return {
    client_id: process.env[prefix + '_CLIENT_ID'] || process.env[prefix + '_APP_ID'] || '',
    client_secret: process.env[prefix + '_CLIENT_SECRET'] || process.env[prefix + '_APP_SECRET'] || '',
    api_key: process.env[prefix + '_API_KEY'] || ''
  };
}

// ---- Build post caption from template ----
function buildCaption(post, account) {
  const rule = db.get('SELECT * FROM posting_rules WHERE account_id=?', [account.id]);
  let caption = post.custom_caption || '';

  if (!caption && rule && rule.caption_template) {
    caption = rule.caption_template;
  }

  if (!caption) {
    caption = post.content_title || '';
    if (post.content_summary) {
      caption += '\n\n' + post.content_summary.slice(0, 200);
    }
  }

  if (post.content_url) {
    caption += '\n\n' + post.content_url;
  }

  const hashtags = extractHashtags(post, account);
  if (hashtags.length) {
    caption += '\n\n' + hashtags.map(h => '#' + h.replace(/^#/, '')).join(' ');
  }

  const maxLen = PLATFORMS[account.platform] ? PLATFORMS[account.platform].max_caption : 2000;
  return caption.slice(0, maxLen);
}

function extractHashtags(post, account) {
  let tags = [];
  const rule = db.get('SELECT hashtag_template FROM posting_rules WHERE account_id=?', [account.id]);
  if (rule && rule.hashtag_template) {
    tags = rule.hashtag_template.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  }
  if (post.custom_hashtags) {
    const extra = post.custom_hashtags.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
    tags = tags.concat(extra);
  }
  if (!tags.length) {
    tags = ['WorldFrontNews', 'KCO', 'GlobalMarketplace'];
  }
  const maxTags = PLATFORMS[account.platform] ? PLATFORMS[account.platform].max_hashtags : 10;
  return tags.slice(0, maxTags);
}

// ---- Check if token needs refresh ----
async function ensureValidToken(account) {
  if (!account.token_expires_at) return account.access_token;
  const now = Math.floor(Date.now() / 1000);
  if (account.token_expires_at > now + 300) return account.access_token;
  const refreshed = await refreshToken(account);
  if (refreshed.ok) {
    account.access_token = refreshed.access_token;
    account.token_expires_at = refreshed.expires_at;
  }
  return account.access_token;
}

// ---- Main post dispatch ----
async function publishToPlatform(account, post) {
  const token = await ensureValidToken(account);
  if (!token && !account.webhook_url) {
    return { ok: false, message: 'No valid credentials for ' + account.platform };
  }

  let result;
  switch (account.platform) {
    case 'tiktok': result = await postToTikTok(account, post); break;
    case 'facebook': result = await postToFacebook(account, post); break;
    case 'instagram': result = await postToInstagram(account, post); break;
    case 'youtube': result = await postToYouTube(account, post); break;
    case 'twitter': result = await postToTwitter(account, post); break;
    case 'linkedin': result = await postToLinkedIn(account, post); break;
    case 'pinterest': result = await postToPinterest(account, post); break;
    case 'telegram': result = await postToTelegram(account, post); break;
    case 'discord': result = await postToDiscord(account, post); break;
    default: result = { ok: false, message: 'Unknown platform: ' + account.platform };
  }

  return result;
}

module.exports = {
  PLATFORMS,
  getOAuthUrl,
  exchangeCode,
  getPlatformSecrets,
  ensureValidToken,
  refreshToken,
  publishToPlatform,
  buildCaption,
  extractHashtags,
  httpJson
};
