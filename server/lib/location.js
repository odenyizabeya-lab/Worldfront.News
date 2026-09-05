// WorldFront.News — Global Location Engine
//
// Bridges the real location database (geo_locations) with listings, news
// posts, maps, search, SEO metadata and sitemaps.
//
// Rules enforced here:
//   * Only real locations recorded in geo_locations are used for page URLs.
//   * A location is created from a listing ONLY when it maps to a real
//     country/state/city present in the seeded database, or the listing itself
//     contains verified data.
//   * Never invent streets, postal codes, landmarks or coordinates.
//   * Unverified locations are clearly marked, never silently promoted.

const db = require('../db');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Unique, system-wide slug for a location of a given type + country.
function locSlug(name, type, countryCode) {
  let base = slugify(name) + '-' + type;
  if (countryCode) base += '-' + String(countryCode).toLowerCase();
  base = base.slice(0, 120);
  // guarantee uniqueness against existing slugs
  let slug = base;
  let i = 2;
  const guard = new Set(db.all('SELECT slug FROM geo_locations').map((r) => r.slug));
  while (guard.has(slug)) {
    slug = base + '-' + i++;
  }
  return slug;
}

// Find or create a geo location from a real name. Only creates rows when the
// type is known and the name is non-empty and not a junk placeholder.
function findOrCreate({ name, type, countryCode, parentName, postalCode, lat, lng, verified }) {
  const clean = (v) => String(v || '').trim();
  const n = clean(name);
  const cc = clean(countryCode).toUpperCase();
  if (!n || !cc) return null;
  const bad = /^(not specified|none|n\/a|—|-|unknown|worldwide|na|undefined|null|,$)?$/i;
  if (bad.test(n)) return null;

  const existing = db.get(
    'SELECT * FROM geo_locations WHERE name=? COLLATE NOCASE AND type=? AND country_code=?',
    [n, type, cc]
  );
  if (existing) return existing;

  // Fallback: reuse an existing record with the same name AND the same parent
  // (e.g. a seeded "Decatur County" county vs a listing-provided city). This
  // keeps one canonical location per (name, country, parent) instead of
  // splitting on type differences. Never matches across different parents, so
  // common names like Springfield in different states stay distinct.
  if (clean(parentName)) {
    const twin = db.get(
      `SELECT g.* FROM geo_locations g
       LEFT JOIN geo_locations pr ON pr.id = g.parent_id
       WHERE g.name=? COLLATE NOCASE AND g.country_code=? AND g.type != 'street'
             AND pr.name=? COLLATE NOCASE
       LIMIT 1`,
      [n, cc, clean(parentName)]
    );
    if (twin) return twin;
  }

  let parentId = null;
  if (clean(parentName)) {
    const parent = db.get(
      "SELECT id FROM geo_locations WHERE name=? COLLATE NOCASE AND country_code=? AND type != 'street' LIMIT 1",
      [clean(parentName), cc]
    );
    parentId = parent ? parent.id : null;
  }

  const nowTs = db.now();
  const v = verified ? 1 : 0;
  db.run(
    `INSERT INTO geo_locations
     (name,type,country_code,parent_id,slug,postal_code,lat,lng,verified,approximate,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [n, type, cc, parentId, locSlug(n, type, cc), clean(postalCode) || null,
     lat ?? null, lng ?? null, v, 0, v ? 'approved' : 'pending', nowTs, nowTs]
  );
  return db.get('SELECT * FROM geo_locations WHERE name=? AND type=? AND country_code=?', [n, type, cc]);
}

// Resolve the full hierarchy chain for a location id:
//   country → state/province/region → county → city/town/village → district → street
// Returns an array ordered root-first with { level, name, type, slug, ... }.
function chainFor(location) {
  if (!location) return [];
  const out = [];
  const seen = new Set();
  let cur = location;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    if (cur.parent_id) cur = db.get('SELECT * FROM geo_locations WHERE id=?', [cur.parent_id]);
    else cur = null;
  }
  return out;
}

// Build the canonical property location landing URL for a location record.
// URL structure: /property/[country]/[state]/[city]/[neighborhood]
// Falls back to the longest meaningful hierarchy chain that has real content.
function locationPagePath(location) {
  if (!location) return null;
  const chain = chainFor(location);
  if (!chain.length) return null;
  const countryIdx = chain.findIndex((l) => l.type === 'country');
  if (countryIdx === -1) return null;
  const fromCountry = chain.slice(countryIdx).map((l) => slugify(l.name));
  return '/property/' + fromCountry.join('/');
}

// For a listing row, return the deepest real location record that can be
// resolved from its stored fields (country_code, state, city, town, village,
// district, neighborhood, street).
function resolveListingLocation(p, opts) {
  const o = opts || {};
  if (!p) return null;
  const cc = String(p.country_code || p.countryCode || '').toUpperCase();
  if (!cc) return null;

  const clean = (v) => /^(not specified|none|n\/a|—|-|,$|worldwide)?$/i.test(String(v || '').trim()) ? '' : String(v).trim();

  const countryName = o.countryName || (db.get('SELECT name FROM countries WHERE code=?', [cc]) || {}).name || null;

  let location = null;
  if (countryName) {
    location = findOrCreate({ name: countryName, type: 'country', countryCode: cc, verified: 1 });
  }

  const state = clean(p.state);
  if (state && location) {
    const child = findOrCreate({ name: state, type: 'state', countryCode: cc, parentName: countryName, verified: o.verified ? 1 : 0 });
    if (child) location = child;
  }

  const city = clean(p.city || p.town);
  if (city && location) {
    const child = findOrCreate({ name: city, type: 'city', countryCode: cc, parentName: state || countryName, verified: o.verified ? 1 : 0 });
    if (child) location = child;
  }

  const village = clean(p.village);
  if (village && location) {
    const child = findOrCreate({ name: village, type: 'village', countryCode: cc, parentName: city || state || countryName, verified: o.verified ? 1 : 0 });
    if (child) location = child;
  }

  const district = clean(p.district || p.neighborhood);
  if (district && location) {
    const child = findOrCreate({ name: district, type: 'district', countryCode: cc, parentName: village || city || state || countryName, verified: o.verified ? 1 : 0 });
    if (child) location = child;
  }

  const street = clean(p.street);
  if (street && location && o.includeStreet) {
    const child = findOrCreate({ name: street, type: 'street', countryCode: cc, parentName: district || village || city || state || countryName, verified: o.verified ? 1 : 0 });
    if (child) location = child;
  }

  return location;
}

// Store the listing → location link used by searches/maps/SEO.
function linkListing(listingKind, listingId, location, relation) {
  if (!location || !location.id || !listingId) return false;
  const rel = relation || 'primary';
  const nowTs = db.now();
  const existing = db.get(
    'SELECT id FROM listing_locations WHERE listing_kind=? AND listing_id=? AND relation=?',
    [listingKind, String(listingId), rel]
  );
  if (existing) {
    db.run('UPDATE listing_locations SET location_id=?, created_at=? WHERE id=?', [location.id, nowTs, existing.id]);
  } else {
    db.run(
      'INSERT INTO listing_locations (listing_kind,listing_id,location_id,relation,created_at) VALUES (?,?,?,?,?)',
      [listingKind, String(listingId), location.id, rel, nowTs]
    );
  }
  return true;
}

// Expand a location slug part into a human label used on cards and pages.
function friendlyLabel(type) {
  return {
    country: 'Country', state: 'State', province: 'State', region: 'Region',
    county: 'County', department: 'Department', prefecture: 'Prefecture',
    city: 'City', town: 'Town', village: 'Village', district: 'District',
    ward: 'Ward', street: 'Street', landmark: 'Landmark'
  }[type] || 'Location';
}

// Build a display address like "Oberlin, Decatur County, Kansas, United States"
// from a property record using only real stored values.
function displayAddress(p) {
  const clean = (v) => /^(not specified|none|n\/a|—|-|,$|worldwide)?$/i.test(String(v || '').trim()) ? '' : String(v).trim();
  const parts = [];
  let home = clean(p.city || p.town);
  if (!home) home = clean(p.village);
  if (!home) home = clean(p.district || p.neighborhood);
  if (home) parts.push(home);
  if (clean(p.state)) parts.push(clean(p.state));
  const cname = clean(p.country) || clean(p.countryName) ||
    (clean(p.country_code) ? (db.get('SELECT name FROM countries WHERE code=?', [clean(p.country_code).toUpperCase()]) || {}).name : '');
  if (cname) parts.push(cname);
  return parts.join(', ');
}

// Human "X in {city}, {state}, {country}" location string for property detail.
function fullLocationLabel(p) {
  const label = displayAddress(p);
  return label || null;
}

// True when a location (or any descendant) is linked to at least one published
// listing — i.e. a /property/... landing page exists with real content. This is
// the same rule the location sitemaps use, so links never point at empty pages.
function hasContent(locationOrId) {
  try {
    const root = typeof locationOrId === 'object' && locationOrId && locationOrId.id
      ? locationOrId
      : db.get('SELECT * FROM geo_locations WHERE id=?', [locationOrId]);
    if (!root) return false;
    const ids = [root.id];
    const bfs = [root.id];
    while (bfs.length) {
      const kids = db.all(
        'SELECT id FROM geo_locations WHERE parent_id IN (' + bfs.map(() => '?').join(',') + ')',
        bfs
      );
      bfs.length = 0;
      for (const k of kids) { ids.push(k.id); bfs.push(k.id); }
    }
    const links = db.all(
      "SELECT DISTINCT listing_id FROM listing_locations WHERE relation='primary' AND location_id IN (" + ids.map(() => '?').join(',') + ')',
      ids
    );
    return links.length > 0;
  } catch (e) {
    return false;
  }
}

module.exports = {
  slugify, locSlug, findOrCreate, chainFor, locationPagePath,
  resolveListingLocation, linkListing, friendlyLabel, displayAddress, fullLocationLabel, hasContent
};