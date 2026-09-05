// WorldFront.News — Property SEO Engine
//
// Generates dynamic Real Estate JSON-LD schema and automatic image SEO
// (filenames, alt text, captions) from the real property record only.
// Nothing is hardcoded; unavailable fields are omitted, never invented.

const db = require('../db');
const { CANONICAL_BASE, SITE_NAME } = require('./ssr');

function clean(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return /^(not specified|none|n\/a|—|-|,$|worldwide|null|undefined)?$/i.test(s) ? '' : s;
}

function isVideo(u) {
  return /\.(mp4|webm|ogv|mov|m4v|mpg|mpeg)(\?|$)/i.test(String(u || ''));
}

function absUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

// Map a listing's category/subcategory to a supported Schema.org type.
// Returns { main: RealEstateListing type, accommodation } plus a residence type.
function schemaTypes(p) {
  const cat = clean(p.category || p.listing_type).toLowerCase();
  const sub = clean(p.subcategory).toLowerCase();
  let accommodation = 'SingleFamilyResidence';
  if (cat.indexOf('apartment') !== -1 || sub.indexOf('apartment') !== -1) accommodation = 'Apartment';
  else if (cat.indexOf('condo') !== -1 || sub.indexOf('condo') !== -1) accommodation = 'Apartment';
  else if (sub.indexOf('villa') !== -1 || sub.indexOf('tiny home') !== -1) accommodation = 'SingleFamilyResidence';
  return { main: 'RealEstateListing', accommodation };
}

function isHousing(p) {
  const cat = String(p.category || p.listing_type || '').trim().toLowerCase();
  const sub = String(p.subcategory || '').trim().toLowerCase();
  return cat === 'townhouse' || cat === 'houses' || cat === 'property' ||
    ['residential properties', 'tiny home', 'villa', 'apartment', 'condominium', 'townhouse'].includes(sub);
}

// Parse images column (JSON string or array) into absolute, real URLs.
function imageList(p) {
  const out = [];
  const urls = [];
  if (typeof p.images === 'string' && p.images) {
    try { const j = JSON.parse(p.images); urls.push(...(Array.isArray(j) ? j : [j])); } catch (e) { urls.push(p.images); }
  } else if (Array.isArray(p.images)) {
    urls.push(...p.images);
  }
  if (p.video && typeof p.video === 'string' && p.video) urls.push(p.video);
  if (p.video_url && typeof p.video_url === 'string' && p.video_url) urls.push(p.video_url);
  if (p.thumbnail && typeof p.thumbnail === 'string' && p.thumbnail) urls.push(p.thumbnail);
  for (const u of urls) {
    const a = absUrl(u);
    if (a) out.push(a);
  }
  return Array.from(new Set(out));
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

// ---- RealEstateListing JSON-LD ----
// Built strictly from the actual property record: title, description, price,
// currency, full address, coordinates, bedrooms/bathrooms, sizes, media.
function realEstateJson(p, url) {
  const cats = schemaTypes(p);
  const images = imageList(p);
  const primaryImage = images.find((u) => !isVideo(u)) || p.thumbnail && absUrl(p.thumbnail) || '';
  const primaryVideo = images.find(isVideo) || '';

  const address = { '@type': 'PostalAddress' };
  if (clean(p.street) || clean(p.house_number)) {
    address.streetAddress = [clean(p.house_number), clean(p.street)].filter(Boolean).join(' ') || undefined;
  }
  if (clean(p.city || p.town)) address.addressLocality = clean(p.city || p.town);
  if (clean(p.state)) address.addressRegion = clean(p.state);
  if (clean(p.country_code)) address.addressCountry = clean(p.country_code).toUpperCase();
  if (clean(p.postal_code)) address.postalCode = clean(p.postal_code);

  const hasAddress = Object.keys(address).length > 1;

  const offers = {
    '@type': 'Offer',
    url,
    priceCurrency: clean(p.currency) || 'USD',
    price: numberOrNull(p.price != null ? p.price : p.price_value),
    availability: String(p.listing_status || '').toLowerCase().indexOf('sold') !== -1
      ? 'https://schema.org/SoldOut'
      : 'https://schema.org/InStock'
  };
  if (clean(p.listing_status)) offers.itemCondition = 'https://schema.org/UsedCondition';
  const dateListed = p.created_at || p.fetched_at || p.updated_at;
  const dateModified = p.updated_at || p.fetched_at;

  const schema = {
    '@context': 'https://schema.org',
    '@type': cats.main,
    name: clean(p.title),
    description: clean(p.description) ? clean(p.description).slice(0, 3000) : undefined,
    url,
    '@id': url,
    image: primaryImage ? [primaryImage] : undefined,
    offers,
    address: hasAddress ? address : undefined
  };

  // Only add the property details block when this really is a real-estate item.
  if (isHousing(p)) {
    schema.propertyType = cats.accommodation;
    const geoOk = numberOrNull(p.lat) != null && numberOrNull(p.lng) != null;
    const residence = {
      '@type': cats.accommodation,
      name: clean(p.title),
      url,
      numberOfRooms: numberOrNull(p.rooms),
      numberOfBedrooms: numberOrNull(p.bedrooms),
      numberOfBathrooms: numberOrNull(p.bathrooms),
      floorSize: numberOrNull(p.building_size)
        ? { '@type': 'QuantitativeValue', value: numberOrNull(p.building_size), unitCode: 'MTK' }
        : undefined,
      ...(geoOk ? { geo: { '@type': 'GeoCoordinates', latitude: numberOrNull(p.lat), longitude: numberOrNull(p.lng) } } : {})
    };
    if (Object.keys(residence).length > 2) schema.residence = residence;
    if (geoOk) schema.geo = residence.geo;
  }

  if (clean(p.bedrooms) && numberOrNull(p.bedrooms) != null) schema.numberOfBedrooms = numberOrNull(p.bedrooms);
  if (clean(p.bathrooms) && numberOrNull(p.bathrooms) != null) schema.numberOfBathrooms = numberOrNull(p.bathrooms);
  if (primaryVideo) schema.video = { '@type': 'VideoObject', contentUrl: primaryVideo, name: clean(p.title), description: clean(p.description) ? clean(p.description).slice(0, 500) : undefined };

  // Remove keys with undefined values.
  for (const k of Object.keys(schema)) if (schema[k] === undefined) delete schema[k];

  return schema;
}

// Human address label for schema + display (real values only).
function postalAddressLabel(p) {
  const parts = [
    [clean(p.house_number), clean(p.street)].filter(Boolean).join(' '),
    clean(p.district || p.neighborhood),
    clean(p.city || p.town),
    clean(p.state),
    clean(p.country) || clean(p.country_name)
  ].filter(Boolean);
  if (clean(p.postal_code)) parts.push(clean(p.postal_code));
  return parts.join(', ');
}

// ---- Image SEO ----
// filename example : beautiful-4-bedroom-house-for-sale-in-ikeja-lagos.webp
// alt text example: Four-bedroom house for sale in Ikeja, Lagos
function propertyTypeLabel(p) {
  const t = clean(p.subcategory || p.category || 'property');
  if (t.toLowerCase().indexOf('apartment') !== -1) return 'apartment';
  if (t.toLowerCase().indexOf('villa') !== -1) return 'villa';
  if (t.toLowerCase().indexOf('condo') !== -1) return 'condominium';
  if (t.toLowerCase().indexOf('townhouse') !== -1) return 'townhouse';
  if (t.toLowerCase().indexOf('land') !== -1) return 'plot of land';
  return 'house';
}

function roomsLabel(p) {
  if (clean(p.bedrooms) && numberOrNull(p.bedrooms) != null) {
    const n = numberOrNull(p.bedrooms);
    return n === 1 ? '1-bedroom' : n + '-bedroom';
  }
  return '';
}

function cityStateLabel(p) {
  const parts = [clean(p.city || p.town), clean(p.state)].filter(Boolean);
  return parts.join(', ');
}

function saleLabel(p) {
  const status = clean(p.listing_status || '').toLowerCase();
  if (status.indexOf('rent') !== -1 || status.indexOf('lease') !== -1) return 'rent';
  return 'sale';
}

function generatedAltText(p, opts) {
  const o = opts || {};
  const bedroom = roomsLabel(p) || o.bedroom || '';
  if (bedroom) {
    return [bedroom, propertyTypeLabel(p), 'for', saleLabel(p), 'in', cityStateLabel(p)]
      .filter(Boolean).join(' ').trim() || clean(p.title);
  }
  return clean(p.title) || clean(p.description || '').slice(0, 100) || 'Property image';
}

function generatedFilename(p, ext, opts) {
  const o = opts || {};
  const base = slugifyFilename([
    o.bedroom || roomsLabel(p) || 'property',
    o.kind || propertyTypeLabel(p),
    'for', saleLabel(p), 'in',
    slugifyFilename([clean(p.city || p.town), clean(p.state), clean(p.country)].filter(Boolean))
  ].filter(Boolean).join('-'));
  const e = String(ext || 'webp').replace(/^\./, '').toLowerCase() || 'webp';
  return (base || 'property') + '-in-' + (o.location && slugifyFilename(o.location) || '') + '.' + e;
}

function slugifyFilename(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

// Caption: short real factual line derived from the listing.
function generatedCaption(p) {
  const parts = [];
  if (roomsLabel(p)) parts.push((numberOrNull(p.bedrooms) === 1 ? 'one-bedroom' : numberOrNull(p.bedrooms) + '-bedroom') + ' ' + propertyTypeLabel(p));
  else parts.push(propertyTypeLabel(p));
  parts.push('for ' + saleLabel(p));
  const loc = cityStateLabel(p);
  if (loc) parts.push('in ' + loc);
  const price = (clean(p.currency) ? clean(p.currency) + ' ' : '') + (p.price != null ? Number(p.price).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '');
  if (price && price.trim() !== '' && p.price != null) parts.push('(' + price + ')');
  return parts.join(' ') + '.';
}

module.exports = {
  clean, isVideo, absUrl, schemaTypes, isHousing, imageList, numberOrNull,
  realEstateJson, postalAddressLabel, propertyTypeLabel, roomsLabel,
  cityStateLabel, saleLabel, generatedAltText, generatedFilename, generatedCaption,
  slugifyFilename
};