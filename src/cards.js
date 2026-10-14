import { normalizeCard } from './core.js';
export const API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
export function validateCardResponse(payload) {
  if (!payload || !Array.isArray(payload.data) || !payload.data.length) throw new Error('The card API returned an empty or invalid archive.');
  const seen = new Set();
  return payload.data.map(card => {
    // Retain alternate IDs for YDK import; decks only store the primary image.
    const value = normalizeCard(card);
    value.card_images = card.card_images || [];
    if (seen.has(value.id)) throw new Error('The card API returned duplicate card IDs.');
    seen.add(value.id);
    return value;
  });
}
export async function loadCards({ fetchImpl = fetch, cache, force = false, now = Date.now() } = {}) {
  let cached;
  try { cached = await cache?.read(); } catch { /* Browsing still works in private/quota-limited storage. */ }
  if (cached && !force && now - cached.fetchedAt < CACHE_MAX_AGE) {
    try { return { cards: validateCardResponse({ data: cached.cards }), source: 'cache', fetchedAt: cached.fetchedAt }; } catch { cached = null; }
  }
  try {
    const response = await fetchImpl(API_URL, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Card API request failed (${response.status}).`);
    const cards = validateCardResponse(await response.json());
    let cacheWarning = false;
    try { await cache?.write({ cards, fetchedAt: now }); } catch { cacheWarning = true; }
    return { cards, source: 'api', fetchedAt: now, cacheWarning };
  } catch (error) {
    if (cached) {
      try { return { cards: validateCardResponse({ data: cached.cards }), source: 'offline', fetchedAt: cached.fetchedAt, warning: error.message }; } catch { /* invalid cache is never served */ }
    }
    throw new Error('The card archive could not load. Check your connection and tap Retry.', { cause: error });
  }
}
export function browserCardCache() {
  let database;
  const open = () => database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('duel-atlas', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('archive');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Archive cache is busy.'));
  });
  return {
    async read() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction('archive', 'readonly').objectStore('archive').get('cards');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async write(value) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('archive', 'readwrite');
        tx.objectStore('archive').put(value, 'cards');
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
  };
}
