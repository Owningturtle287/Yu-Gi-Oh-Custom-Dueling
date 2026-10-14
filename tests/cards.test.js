import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCards, validateCardResponse, API_URL, CACHE_MAX_AGE } from '../src/cards.js';
import { cards } from './fixtures.js';

test('card loader downloads the full response in one request and persists cache', async () => {
  let calls = 0, stored;
  const loaded = await loadCards({ now: 1000, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, API_URL); assert.ok(options.signal);
    return { ok: true, json: async () => ({ data: cards }) };
  }, cache: { read: async () => null, write: async value => stored = value } });
  assert.equal(calls, 1);
  assert.equal(loaded.cards.length, cards.length);
  assert.equal(loaded.source, 'api');
  assert.equal(stored.fetchedAt, 1000);
});
test('fresh cached cards avoid network requests', async () => {
  const loaded = await loadCards({ now: 1001, cache: { read: async () => ({ cards, fetchedAt: 1000 }) }, fetchImpl: () => { throw new Error('Should not fetch'); } });
  assert.equal(loaded.source, 'cache');
  assert.equal(loaded.cards.length, cards.length);
});
test('expired cache and explicit refresh fetch again, with offline fallback', async () => {
  const cache = { read: async () => ({ cards, fetchedAt: 0 }), write: async () => {} };
  const offline = await loadCards({ now: CACHE_MAX_AGE + 1, cache, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.equal(offline.source, 'offline');
  const refreshed = await loadCards({ now: 2, force: true, cache, fetchImpl: async () => ({ ok: true, json: async () => ({ data: cards }) }) });
  assert.equal(refreshed.source, 'api');
});
test('first-load failures and malformed/duplicate data yield retryable errors', async () => {
  await assert.rejects(() => loadCards({ fetchImpl: async () => ({ ok: false, status: 429 }) }), /tap Retry/);
  await assert.rejects(() => loadCards({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: [] }) }) }), /tap Retry/);
  assert.throws(() => validateCardResponse({ data: [cards[0], cards[0]] }), /duplicate/);
  assert.throws(() => validateCardResponse({ data: [{ name: 'No ID' }] }), /Invalid card/);
});
test('cache quota or private-mode failures leave live browsing usable', async () => {
  const loaded = await loadCards({ cache: { read: async () => { throw new Error('Private mode'); }, write: async () => { throw new Error('Quota'); } }, fetchImpl: async () => ({ ok: true, json: async () => ({ data: cards }) }) });
  assert.equal(loaded.source, 'api');
  assert.equal(loaded.cacheWarning, true);
});
