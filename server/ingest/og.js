// Open Graph image extraction: fetch an article's page and find its
// authoritative story image (og:image / twitter:image / first article <img>).
const https = require('https');
const http = require('http');

const UA = 'WorldFront.News/1.0 (+https://worldfront.news) image finder';
const MAX_BYTES = 2 * 1024 * 1024; // don't download the whole page
const TIMEOUT = 15000;

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    let mod;
    try { mod = url.startsWith('https') ? https : http; } catch (e) { return reject(e); }
    const req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).href; } catch (e) { return reject(e); }
        return resolve(get(next, redirects + 1));
      }
      if (code !== 200) { res.resume(); return reject(new Error('HTTP ' + code)); }
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (ct && !ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('application/xhtml')) {
        res.resume();
        return reject(new Error('not HTML: ' + ct));
      }
      let data = '';
      let size = 0;
      res.setEncoding('utf8');
      res.on('data', (d) => {
        size += d.length;
        if (size > MAX_BYTES) { req.destroy(new Error('page too large')); return; }
        data += d;
      });
      res.on('end', () => resolve(data));
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Extract the first <img> src that looks like a real photo URL
function firstContentImage(html) {
  const m = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp|avif)[^"']*)["']/i);
  return m && /^https?:\/\//.test(m[1]) ? m[1] : null;
}

function ogImage(html) {
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og && og[1] && /^https?:\/\//.test(og[1])) return og[1];

  const tw =
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (tw && tw[1] && /^https?:\/\//.test(tw[1])) return tw[1];

  return null;
}

// Full pipeline to find a real story image from an article URL.
// Returns the image URL or null. Optionally validates the URL responds as an image.
async function fetchOGImage(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  let html;
  try {
    html = await get(url);
  } catch (e) {
    return null;
  }
  if (!html || typeof html !== 'string') return null;

  let img = ogImage(html);
  if (!img) img = firstContentImage(html);
  if (!img) return null;

  // Reject known placeholder/tracking images
  if (/\.(?:svg|gif)/i.test(img)) return null;
  if (/sprite|logo|icon|avatar|placeholder|blank|pixel\.gif/i.test(img)) return null;
  return img;
}

module.exports = { fetchOGImage, get };
