const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function cleanupRateLimit() {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.start > RATE_LIMIT_WINDOW) loginAttempts.delete(ip);
  }
}
setInterval(cleanupRateLimit, 5 * 60 * 1000);

router.post('/register', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { email, username, password } = req.body || {};
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, username and password are required' });
  }
  const existing = db.get('SELECT id FROM users WHERE email=? OR username=?', [email, username]);
  if (existing) return res.status(409).json({ error: 'Account already exists' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run('INSERT INTO users (email,username,password_hash,role,created_at) VALUES (?,?,?,?,?)',
      [email, username, hash, 'reader', db.now()]);
    const user = db.get('SELECT id,email,username,role FROM users WHERE email=?', [email]);
    const token = auth.createSession(user.id);
    res.status(201).json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (e) {
    res.status(409).json({ error: 'Could not create account' });
  }
});

router.post('/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.get('SELECT * FROM users WHERE email=?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = auth.createSession(user.id);
  res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
});

router.post('/logout', auth.requireAuth, (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  auth.deleteSession(token);
  res.json({ success: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- Change email / password (requiring the current password) ----
router.post('/me/change-email', auth.requireAuth, (req, res) => {
  const { current_password, new_email } = req.body || {};
  if (!current_password) return res.status(400).json({ error: 'Current password is required' });
  const email = String(new_email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const user = db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const taken = db.get('SELECT id FROM users WHERE email=? AND id!=?', [email, user.id]);
  if (taken) return res.status(409).json({ error: 'That email is already in use' });
  db.run('UPDATE users SET email=? WHERE id=?', [email, user.id]);
  db.persist();
  res.json({ success: true, user: { id: user.id, email, username: user.username, role: user.role } });
});

router.post('/me/change-password', auth.requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password) return res.status(400).json({ error: 'Current password is required' });
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(String(new_password), 10);
  db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, user.id]);
  // Invalidate every other active session so only the current one stays signed in.
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) db.run('DELETE FROM sessions WHERE user_id=? AND token!=?', [user.id, token]);
  db.persist();
  res.json({ success: true, message: 'Password updated' });
});

// Saved articles
router.get('/saved', auth.requireAuth, (req, res) => {
  const rows = db.all(
    `SELECT a.id,a.title,a.slug,a.summary,a.image,a.source_name,a.category,a.country_code,a.published_at
     FROM saved_articles s JOIN articles a ON a.id=s.article_id
     WHERE s.user_id=? ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json({ saved: rows });
});

router.post('/saved/:articleId', auth.requireAuth, (req, res) => {
  const aid = parseInt(req.params.articleId, 10);
  const art = db.get('SELECT id FROM articles WHERE id=?', [aid]);
  if (!art) return res.status(404).json({ error: 'Article not found' });
  db.run('INSERT OR IGNORE INTO saved_articles (user_id,article_id,created_at) VALUES (?,?,?)',
    [req.user.id, aid, db.now()]);
  db.persist();
  res.json({ saved: true });
});

router.delete('/saved/:articleId', auth.requireAuth, (req, res) => {
  db.run('DELETE FROM saved_articles WHERE user_id=? AND article_id=?',
    [req.user.id, parseInt(req.params.articleId, 10)]);
  db.persist();
  res.json({ saved: false });
});

// Followed countries/categories
router.get('/follows', auth.requireAuth, (req, res) => {
  const countries = db.all('SELECT country_code FROM followed_countries WHERE user_id=?', [req.user.id]).map(r => r.country_code);
  const categories = db.all('SELECT category FROM followed_categories WHERE user_id=?', [req.user.id]).map(r => r.category);
  res.json({ countries, categories });
});

router.post('/follows/country', auth.requireAuth, (req, res) => {
  const code = String(req.body.country_code || '').toUpperCase();
  if (!code) return res.status(400).json({ error: 'country_code required' });
  db.run('INSERT OR IGNORE INTO followed_countries (user_id,country_code) VALUES (?,?)', [req.user.id, code]);
  db.persist();
  res.json({ ok: true });
});

router.delete('/follows/country', auth.requireAuth, (req, res) => {
  db.run('DELETE FROM followed_countries WHERE user_id=? AND country_code=?',
    [req.user.id, String(req.body.country_code || '').toUpperCase()]);
  db.persist();
  res.json({ ok: true });
});

router.post('/follows/category', auth.requireAuth, (req, res) => {
  const cat = req.body.category;
  if (!cat) return res.status(400).json({ error: 'category required' });
  db.run('INSERT OR IGNORE INTO followed_categories (user_id,category) VALUES (?,?)', [req.user.id, cat]);
  db.persist();
  res.json({ ok: true });
});

router.delete('/follows/category', auth.requireAuth, (req, res) => {
  db.run('DELETE FROM followed_categories WHERE user_id=? AND category=?', [req.user.id, req.body.category]);
  db.persist();
  res.json({ ok: true });
});

module.exports = router;
