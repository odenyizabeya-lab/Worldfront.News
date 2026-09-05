const crypto = require('crypto');
const db = require('../db');

const TOKEN_LEN = 48;
const TOKEN_TTL = 60 * 60 * 24 * 14; // 14 days

function genToken() {
  return crypto.randomBytes(TOKEN_LEN).toString('hex');
}

function createSession(userId) {
  const token = genToken();
  db.run('INSERT OR REPLACE INTO sessions (token,user_id,created_at) VALUES (?,?,?)',
    [token, userId, db.now()]);
  db.persist();
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.get(
    `SELECT s.token, s.user_id, s.created_at, u.id, u.email, u.username, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.created_at > ?`,
    [token, db.now() - TOKEN_TTL]
  );
  if (!row) return null;
  return {
    id: row.user_id, email: row.email, username: row.username, role: row.role
  };
}

function deleteSession(token) {
  db.run('DELETE FROM sessions WHERE token=?', [token]);
  db.persist();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Public middleware that optionally attaches user
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.user = getUserByToken(token);
  next();
}

module.exports = { createSession, getUserByToken, deleteSession, requireAuth, requireAdmin, optionalAuth };
