import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCards, validateCardResponse, API_URL, CACHE_MAX_AGE, CARD_CACHE_SCHEMA } from '../src/cards.js';
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
  const loaded = await loadCards({ now: 1001, cache: { read: async () => ({ schema: CARD_CACHE_SCHEMA, cards, fetchedAt: 1000 }) }, fetchImpl: () => { throw new Error('Should not fetch'); } });
  assert.equal(loaded.source, 'cache');
  assert.equal(loaded.cards.length, cards.length);
});
test('expired cache and explicit refresh fetch again, with offline fallback', async () => {
  const cache = { read: async () => ({ schema: CARD_CACHE_SCHEMA, cards, fetchedAt: 0 }), write: async () => {} };
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
test('old caches refresh once to acquire release dates even while their timestamp is fresh', async () => {
  let calls = 0, written;
  const oldCards = cards.map(card => ({ ...card, tcgDate: undefined }));
  const result = await loadCards({ now: 1001, cache: { read: async () => ({ cards: oldCards, fetchedAt: 1000 }), write: async value => written = value }, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: cards }) }; } });
  assert.equal(calls, 1); assert.equal(result.source, 'api');
  assert.equal(written.schema, CARD_CACHE_SCHEMA);
  assert.ok(result.cards[0].tcgDate);
});
test('offline cache migration retains old metadata and never fabricates release dates', async () => {
  const oldCards = cards.map(card => ({ ...card, tcgDate: undefined }));
  const result = await loadCards({ cache: { read: async () => ({ cards: oldCards, fetchedAt: 1 }) }, fetchImpl: async () => { throw new Error('Offline'); } });
  assert.equal(result.source, 'offline');
  assert.equal(result.cards.length, cards.length);
  assert.ok(result.cards.every(card => card.tcgDate === null));
});
test('schema-4 caches refresh for effect metadata and the next cache load retains it',async()=>{
  let stored={schema:4,cards,fetchedAt:1000},calls=0;const source={...cards[1],misc_info:[{has_effect:1}]};
  const options={now:1001,cache:{read:async()=>stored,write:async value=>stored=value},fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({data:[source]})};}};
  assert.equal((await loadCards(options)).cards[0].hasEffect,true);assert.equal((await loadCards(options)).cards[0].hasEffect,true);assert.equal(calls,1);
});
