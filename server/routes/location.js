const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Save the user's manual location (country/region/state/city). Never stores exact GPS publicly.
router.post('/save', auth.requireAuth, (req, res) => {
  const { country_code, region, state, city } = req.body || {};
  if (!country_code) return res.status(400).json({ error: 'country_code required' });
  db.run(
    `INSERT OR REPLACE INTO user_location
     (user_id,country_code,region,state,city,allow_gps,updated_at)
     VALUES (?,?,?,?,?, (SELECT allow_gps FROM user_location WHERE user_id=?), ?)`,
    [req.user.id, String(country_code).toUpperCase(), region || '', state || '', city || '',
     req.user.id, db.now()]
  );
  db.persist();
  res.json({ ok: true, location: { country_code, region, state, city } });
});

// Toggle GPS permission (opt-in only, explained in UI)
router.post('/gps', auth.requireAuth, (req, res) => {
  const allow = req.body.allow ? 1 : 0;
  const { lat, lng } = req.body || {};
  // Only update stored coords when GPS explicitly granted
  if (allow && typeof lat === 'number' && typeof lng === 'number') {
    const existing = db.get('SELECT * FROM user_location WHERE user_id=?', [req.user.id]);
    if (existing) {
      // Round to ~2 decimals (~1.1 km) so we never expose exact position
      db.run('UPDATE user_location SET allow_gps=?, lat=?, lng=?, updated_at=? WHERE user_id=?',
        [1, Math.round(lat * 100) / 100, Math.round(lng * 100) / 100, db.now(), req.user.id]);
    }
  } else {
    db.run('UPDATE user_location SET allow_gps=? WHERE user_id=?', [allow, req.user.id]);
  }
  db.persist();
  res.json({ ok: true, gps_enabled: !!allow });
});

// Get the current user's saved location
router.get('/me', auth.requireAuth, (req, res) => {
  const loc = db.get('SELECT * FROM user_location WHERE user_id=?', [req.user.id]);
  res.json({ location: loc || null });
});

// News near a location. country-based for safety; GPS used to refine if granted.
router.get('/near', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  let country = req.query.country ? String(req.query.country).toUpperCase() : null;
  let rows;

  // If no country but GPS given, find the nearest country whose centroid is within range
  if (!country && !isNaN(lat) && !isNaN(lng)) {
    const countries = db.all('SELECT code,lat,lng FROM countries WHERE lat IS NOT NULL LIMIT 1000');
    let best = null, bestDist = Infinity;
    for (const c of countries) {
      const d = Math.hypot(c.lat - lat, c.lng - lng);
      if (d < bestDist) { bestDist = d; best = c.code; }
    }
    if (best) country = best;
  }

  if (country) {
    rows = db.all(
      `SELECT id,title,slug,summary,image,source_name,country_code,category,published_at,link
       FROM articles WHERE status='published' AND country_code=? ORDER BY published_at DESC LIMIT 50`,
      [country]
    );
  } else {
    rows = db.all(
      `SELECT id,title,slug,summary,image,source_name,country_code,category,published_at,link
       FROM articles WHERE status='published' ORDER BY published_at DESC LIMIT 50`
    );
  }
  res.json({ location: { country, used_gps: !country && !isNaN(lat) }, articles: rows });
});

// Location search
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const like = '%' + q + '%';
  const countries = db.all("SELECT code,name,region,subregion FROM countries WHERE name LIKE ? OR region LIKE ? LIMIT 20", [like, like]);
  const locations = db.all("SELECT name,type,country_code,lat,lng FROM locations WHERE name LIKE ? LIMIT 20", [like]);
  res.json({ countries, locations });
});

module.exports = router;
