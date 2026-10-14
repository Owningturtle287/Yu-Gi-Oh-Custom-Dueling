import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('manifest uses relative GitHub Pages scope and includes installable and maskable icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './'); assert.equal(manifest.display, 'standalone');
  for (const image of manifest.icons) await access(new URL('../' + image.src, import.meta.url));
  assert.ok(manifest.icons.some(i => i.sizes === '192x192'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
});
test('service worker installs a complete shell and removes only this app’s old shell cache', async () => {
  const listeners = {}, removed = [], installed = [];
  const scope = 'https://example.com/repo/';
  const self = { registration: { scope }, addEventListener: (event, handler) => listeners[event] = handler, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const caches = { open: async () => ({ addAll: async paths => installed.push(...paths) }), keys: async () => [`duel-atlas:${scope}:shell-v0.0.0`, `duel-atlas:${scope}:images-v1`, 'another-app-cache'], delete: async key => removed.push(key) };
  runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches, URL, Map, Set, Date, Promise, Response, setTimeout });
  let pending; listeners.install({ waitUntil: promise => pending = promise }); await pending;
  for (const path of installed) if (path !== './') await access(new URL('../' + path, import.meta.url));
  assert.ok(installed.includes('./src/core.js'));
  assert.ok(installed.includes('./src/era.js'));
  assert.ok(installed.includes('./src/layout.js'));
  listeners.activate({ waitUntil: promise => pending = promise }); await pending;
  assert.deepEqual(removed, [`duel-atlas:${scope}:shell-v0.0.0`]);
});
test('mobile layout contains page overflow and limits scroll regions', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /html,body\s*\{[^}]*overflow:hidden/);
  assert.match(css, /#main\s*\{[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /\.archive-panel\s*\{[^}]*overflow:auto/);
  assert.match(css, /\.deck-list\s*\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
  assert.match(css, /\.deck-list\s*\{[^}]*grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.effect-text\s*\{[^}]*overflow:auto/);
  assert.match(css, /\.saved-list\s*\{[^}]*overflow:auto/);
  const autoScrolls = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /overflow(?:-[xy])?:auto/.test(m[2])).map(m => m[1].trim());
  assert.deepEqual([...new Set(autoScrolls)].sort(), ['.archive-panel', '.deck-list', '.effect-text', '.saved-list'].sort());
});
test('compact controls preserve tap targets and contain list focus and horizontal panning', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /height:calc\(54px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.quick-controls button\s*\{[^}]*width:30px[^}]*height:30px/);
  assert.match(css, /\.archive-panel\s*\{[^}]*overflow-x:hidden[^}]*overflow-y:auto[^}]*touch-action:pan-y/);
  assert.match(css, /\.archive-panel:focus[^}]*\{[^}]*outline:none;[^}]*box-shadow:none/);
  assert.match(css, /input, select\s*\{[^}]*font-size:16px/);
  assert.match(css, /\.detail-add select\s*\{[^}]*font-size:16px/);
  assert.match(css, /\.card-inspect:focus-visible[^}]*outline-offset:-3px/);
});
