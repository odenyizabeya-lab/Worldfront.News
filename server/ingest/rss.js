const Parser = require('rss-parser');
const db = require('../db');
const { fetchOGImage } = require('./og');

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'WorldFront.News/1.0 (+https://worldfront.news) RSS reader'
  }
});

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function uniqueSlug(text) {
  const base = slugify(text);
  const check = db.get('SELECT id FROM articles WHERE slug=?', [base]);
  if (!check) return base;
  const suffix = '-' + Math.random().toString(36).slice(2, 8);
  return (base + suffix).slice(0, 120);
}

function firstImgInContent(content) {
  if (!content) return null;
  // Prefer the first real photo-style <img> (skip tracking pixels/svgs)
  const imgs = content.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (let raw of imgs) {
    const m = raw.match(/src=["']([^"']+)["']/i);
    let src = m && m[1];
    if (!src) continue;
    // Grab best src from srcset (largest) if present
    const set = raw.match(/srcset=["']([^"']+)["']/i);
    if (set && set[1]) {
      const parts = set[1].split(',').map(p => p.trim().split(/\s+/)[0]);
      src = parts[parts.length - 1] || src;
    }
    if (src && /^https?:\/\//.test(src) && !/\.(?:svg|gif)/i.test(src) && !/sprite|logo|icon|avatar|pixel|blank/i.test(src)) return src;
  }
  // Sniff og:image embedded in content HTML
  const og = content.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og && og[1] && /^https?:\/\//.test(og[1])) return og[1];
  return null;
}

function firstMedia(items) {
  if (!Array.isArray(items)) return null;
  const first = items[0];
  if (!first) return null;
  const url = first.url || first.src || (first['media:content'] && first['media:content'].url);
  if (url && /^https?:\/\//.test(url)) return url;
  return null;
}

function extractImage(item) {
  // Multiple media namespaces rss-parser may expose (case variants)
  const mediaBlocks = ['media:content', 'media:thumbnail', 'media:group', 'media_content', 'media_thumbnail'];
  const candidates = [
    item.enclosure && (item.enclosure.url || item.enclosure.link),
    item.image && item.image.url,
    item['media:content'] && (item['media:content'].url || (Array.isArray(item['media:content']) && item['media:content'][0] && item['media:content'][0].url)),
    item['media:thumbnail'] && item['media:thumbnail'].url,
    firstMedia(item['media:group'] && item['media:group']['media:content'])
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && /^https?:\/\//.test(c) && !/\.(?:svg|gif)/i.test(c)) return c;
  }
  for (const key of Object.keys(item)) {
    const low = key.toLowerCase();
    if (mediaBlocks.includes(low) || /media/.test(low)) {
      const v = item[key];
      if (Array.isArray(v)) {
        for (const el of v) {
          const u = el && (el.url || el.src);
          if (u && /^https?:\/\//.test(u) && !/\.(?:svg|gif)/i.test(u)) return u;
        }
      } else if (v && v.url && /^https?:\/\//.test(v.url)) return v.url;
    }
  }
  // Find in content HTML
  const content = item['content:encoded'] || item.content || item.summary || '';
  const fromContent = firstImgInContent(content);
  if (fromContent) return fromContent;
  return null;
}

function cleanSummary(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

function categoryKeywords() {
  const map = {
    politics: ['election', 'government', 'president', 'parliament', 'minister', 'senate', 'congress', 'vote', 'politic', 'democracy', 'campaign', 'policy'],
    business: ['business', 'company', 'corporate', 'ceo', 'startup', 'industry', 'enterprise'],
    economy: ['economy', 'economic', 'gdp', 'recession', 'inflation', 'unemployment', 'econom'],
    finance: ['finance', 'stock', 'market', 'bank', 'invest', 'fund', 'currency', 'shares', 'wall street', 'interest rate'],
    technology: ['tech', 'technology', 'software', 'ai', 'artificial intelligence', 'computer', 'app', 'startup', 'cyber', 'digital', 'smartphone', 'internet', 'chip'],
    science: ['science', 'scientist', 'research', 'study', 'discovery', 'space', 'nasa', 'astronom', 'physic', 'quantum'],
    health: ['health', 'medical', 'doctor', 'hospital', 'vaccine', 'patient', 'disease', 'drug', 'wellness', 'cancer', 'virus', 'pandemic', 'covid'],
    entertainment: ['movie', 'film', 'music', 'celebrity', 'hollywood', 'tv', 'television', 'concert', 'actor', 'album', 'entertainment'],
    sports: ['sport', 'football', 'soccer', 'basketball', 'tennis', 'olympic', 'match', 'score', 'nba', 'nfl', 'fifa', 'cricket', 'rugby', 'championship', 'medal'],
    lifestyle: ['lifestyle', 'fashion', 'food', 'recipe', 'home', 'beauty', 'wellness', 'gadget'],
    travel: ['travel', 'tourism', 'tourist', 'airline', 'flight', 'destination', 'holiday', 'vacation'],
    environment: ['environment', 'climate', 'climate change', 'global warming', 'carbon', 'emission', 'pollution', 'weather', 'storm', 'renewable', 'wildfire', 'flood', 'earthquake'],
    education: ['education', 'school', 'university', 'student', 'teacher', 'college', 'academic'],
    crime: ['crime', 'police', 'arrest', 'court', 'trial', 'criminal', 'murder', 'theft', 'justice', 'investigation'],
    culture: ['culture', 'art', 'heritage', 'museum', 'theatre', 'literature', 'history'],
    world: ['world', 'global', 'international', 'foreign', 'diplomacy', 'united nations', 'war', 'conflict', 'border', 'refugee', 'sanction']
  };
  return map;
}

function guessCategory(title) {
  const t = (title || '').toLowerCase();
  const map = categoryKeywords();
  let best = 'world';
  let bestScore = 0;
  for (const [cat, words] of Object.entries(map)) {
    let score = 0;
    for (const w of words) if (t.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

// Convert a parsed feed item into a DB row
function mapItem(item, source) {
  const guid = item.guid || item.link || item.id;
  if (!guid) return null;
  const title = (item.title || '').trim();
  if (!title) return null;

  const publishedAt = parseDate(item.isoDate || item.pubDate) || db.now();
  const image = extractImage(item);
  const category = (source.category && source.category !== 'world')
    ? source.category
    : guessCategory(title);

  return {
    guid: String(guid).slice(0, 500),
    title,
    slug: uniqueSlug(title),
    summary: cleanSummary(item.contentSnippet || item.summary || item.content),
    content: item['content:encoded'] || item.content || item.summary || '',
    image,
    source_name: source.name,
    source_url: source.url,
    source_id: source.id,
    author: item.creator || item.author || '',
    country_code: source.country_code || 'US',
    category,
    published_at: publishedAt,
    fetched_at: db.now(),
    link: item.link || '',
    breaking: category === 'breaking' ? 1 : 0
  };
}

async function fetchOne(source, opts = {}) {
  try {
    const feed = await parser.parseURL(source.feed_url);
    let inserted = 0;
    let ogFetches = 0;
    // Skip per-article page crawling when requested (e.g. build-time ingest
    // where the whole feed set must fit inside the deployment build window).
    const ogBudget = opts.skipOg ? 0 : 8;
    for (const item of feed.items.slice(0, 25)) {
      const row = mapItem(item, source);
      if (!row) continue;
      // If the feed gave no image, fetch the real story image from its page
      if (!row.image && ogFetches < ogBudget) {
        try {
          const og = await fetchOGImage(row.link);
          if (og) row.image = og;
        } catch (e) { /* keep no image */ }
        ogFetches++;
      }
      try {
        db.run(
          `INSERT OR IGNORE INTO articles
           (guid,title,slug,summary,content,image,source_name,source_url,source_id,author,country_code,category,published_at,fetched_at,link,breaking,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'published')`,
          [row.guid, row.title, row.slug, row.summary, row.content, row.image,
           row.source_name, row.source_url, row.source_id, row.author,
           row.country_code, row.category, row.published_at, row.fetched_at,
           row.link, row.breaking]
        );
        inserted++;
      } catch (e) {
        // duplicate guid or constraint -> ignore
      }
    }
    db.run('UPDATE news_sources SET last_fetch=?, last_status=? WHERE id=?',
      [db.now(), 'ok', source.id]);
    return { source: source.name, count: inserted };
  } catch (e) {
    db.run('UPDATE news_sources SET last_fetch=?, last_status=? WHERE id=?',
      [db.now(), 'error: ' + String(e.message).slice(0, 100), source.id]);
    return { source: source.name, error: e.message };
  }
}

async function fetchEnabled(limit = null, opts = {}) {
  await db.ready();
  let sql = 'SELECT * FROM news_sources WHERE enabled=1';
  const params = [];
  if (limit) {
    sql += ' ORDER BY priority DESC, id ASC LIMIT ?';
    params.push(limit);
  }
  const sources = db.all(sql, params);
  const results = [];
  const concurrency = 10;
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(s => fetchOne(s, opts)));
    results.push(...batchResults);
    if (i + concurrency < sources.length) await sleep(500);
  }
  db.persist();
  return results;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

module.exports = { fetchEnabled, fetchOne, mapItem, guessCategory, slugify, uniqueSlug };
