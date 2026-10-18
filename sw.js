/* App shell updates with each release; card images persist independently. */
const PREFIX = 'duel-atlas:' + self.registration.scope;
const SHELL_CACHE = PREFIX + ':shell-v0.4.0';
const IMAGE_CACHE = PREFIX + ':images-v1';
const SHELL = ['./', './index.html', './styles.css', './duel.css', './light.css', './effects.css', './src/app.js', './src/core.js', './src/cards.js', './src/era.js', './src/layout.js', './src/deck-view.js', './src/icons.js', './src/duel/catalog.js', './src/duel/decks.js', './src/duel/engine.js', './src/duel/ai.js', './src/duel/native-ai.js', './src/duel/ai-knowledge.js', './src/duel/ai-combat.js', './src/duel/ai-turn.js', './src/duel/ai-memory.js', './src/duel/ai-guidance.js', './src/duel/ai-client.js', './src/duel/ai-worker.js', './src/duel/ui.js', './src/duel/intro.js', './src/duel/motion.js', './src/duel/flow.js', './src/duel/log.js', './src/duel/field.js', './src/duel/arena-layout.js', './src/duel/viewport.js', './src/duel/saves.js', './src/duel/native-prompts.js', './src/duel/dom.js', './src/duel/terminal.js', './src/duel/card-view.js', './src/duel/choice-view.js', './src/duel/responses.js', './src/duel/effects.js', './src/duel/attack-arrows.js', './src/duel/battle-timing.js', './manifest.webmanifest', './assets/emblem.svg', './assets/card-back.jpg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png'];

const RULES = ["./src/duel/native-loader.js","./src/duel/native-engine.js","./src/duel/rules-manifest.js","./assets/rules/manifest.json","./assets/rules/AGPL-3.0.txt","./assets/rules/CardScripts-README.md","./assets/rules/THIRD_PARTY_NOTICES.md","./assets/rules/CORE-LICENSE.txt","./assets/rules/LUA-COPYRIGHT.txt","./assets/rules/runtime-sources.json","./assets/rules/scripts-00.json","./assets/rules/scripts-01.json","./assets/rules/scripts-02.json","./assets/rules/scripts-03.json","./assets/rules/scripts-04.json","./assets/rules/scripts-05.json","./assets/rules/scripts-06.json","./assets/rules/scripts-07.json","./assets/rules/scripts-08.json","./assets/rules/scripts-09.json","./assets/rules/scripts-10.json","./assets/rules/scripts-11.json","./assets/rules/scripts-12.json","./assets/rules/scripts-13.json","./assets/rules/cards-00.json","./assets/rules/cards-01.json","./assets/rules/cards-02.json","./assets/rules/cards-03.json","./assets/rules/cards-04.json","./assets/rules/cards-05.json","./assets/rules/cards-06.json","./assets/rules/cards-07.json","./vendor/ocgcore/dist/chunk-6GYI7QPM.js","./vendor/ocgcore/dist/chunk-L5TW24SS.js","./vendor/ocgcore/dist/index.js","./vendor/ocgcore/dist/ocgcore.jspi-ROQIC75H.js","./vendor/ocgcore/dist/ocgcore.jspi-W7UMOWZG.js","./vendor/ocgcore/dist/ocgcore.sync-MMMSWPBB.js","./vendor/ocgcore/dist/ocgcore.sync-ORIXRHXI.js","./vendor/ocgcore/lib/ocgcore.sync.mjs","./vendor/ocgcore/lib/ocgcore.sync.wasm"];
SHELL.push(...RULES);
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
