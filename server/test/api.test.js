const { test } = require('node:test');
const assert = require('node:assert');
const { buildArticleQuery } = require('../routes/api');
const { guessCategory, slugify } = require('../ingest/rss');

test('buildArticleQuery filters by country', () => {
  const q = buildArticleQuery({ country: 'us' });
  assert.ok(q.where.includes('country_code=?'));
  assert.deepEqual(q.params, ['US']);
});

test('buildArticleQuery filters by category', () => {
  const q = buildArticleQuery({ category: 'technology' });
  assert.ok(q.where.includes('category=?'));
  assert.deepEqual(q.params, ['technology']);
});

test('buildArticleQuery adds search LIKE across fields', () => {
  const q = buildArticleQuery({ q: 'climate' });
  assert.ok(q.where.includes('title LIKE ?'));
  assert.strictEqual(q.params.length, 4);
});

test('guessCategory detects technology', () => {
  assert.strictEqual(guessCategory('New AI chip for smartphones announced'), 'technology');
});

test('guessCategory detects politics', () => {
  assert.strictEqual(guessCategory('Prime minister calls snap election'), 'politics');
});

test('slugify produces clean slugs', () => {
  assert.strictEqual(slugify('Hello, World! & Friends'), 'hello-world-and-friends');
  assert.ok(slugify('').length <= 120);
});
