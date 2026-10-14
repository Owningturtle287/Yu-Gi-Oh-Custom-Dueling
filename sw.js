/* App shell updates with each release; card images persist independently. */
const PREFIX = 'duel-atlas:' + self.registration.scope;
const SHELL_CACHE = PREFIX + ':shell-v0.1.0';
const IMAGE_CACHE = PREFIX + ':images-v1';
const SHELL = ['./', './index.html', './styles.css', './duel.css', './src/app.js', './src/core.js', './src/cards.js', './src/era.js', './src/layout.js', './src/icons.js', './src/duel/catalog.js', './src/duel/decks.js', './src/duel/engine.js', './src/duel/ai.js', './src/duel/ui.js', './manifest.webmanifest', './assets/emblem.svg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png'];
const shellURLs = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX + ':shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
let nextImageFetch = 0;
const imageRequests = new Map();
// A single device pulls at most 8 uncached images per second. Never prefetch the archive.
function imageResponse(request) {
  if (imageRequests.has(request.url)) return imageRequests.get(request.url).then(response => response.clone());
  const pending = (async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const now = Date.now(), slot = Math.max(now, nextImageFetch);
    nextImageFetch = slot + 125;
    if (slot > now) await new Promise(resolve => setTimeout(resolve, slot - now));
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        try { await cache.put(request, response.clone()); } catch { /* quota failures must not stop browsing */ }
      }
      return response;
    } catch { return Response.error(); }
  })();
  imageRequests.set(request.url, pending);
  pending.finally(() => imageRequests.delete(request.url));
  return pending.then(response => response.clone());
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname === 'images.ygoprodeck.com' && /^\/images\/cards(?:_small)?\/\d+\.jpg$/.test(url.pathname)) {
    event.respondWith(imageResponse(event.request)); return;
  }
  if (event.request.mode === 'navigate' && event.request.url.startsWith(self.registration.scope)) {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(SHELL_CACHE)).match(new URL('./index.html', self.registration.scope).href))); return;
  }
  if (shellURLs.has(event.request.url)) {
    // Cached release assets stay together; a new worker installs the next complete shell.
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request))); 
  }
});
