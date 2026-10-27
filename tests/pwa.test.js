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
  const listeners = {}, removed = [], installed = [], requests = [];
  const scope = 'https://example.com/repo/';
  const self = { registration: { scope }, addEventListener: (event, handler) => listeners[event] = handler, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const caches = { open: async () => ({ addAll: async paths => {requests.push(...paths);installed.push(...paths.map(request=>'./'+new URL(request.url).pathname.slice(new URL(scope).pathname.length)));} }), keys: async () => [`duel-atlas:${scope}:shell-v0.0.0`, `duel-atlas:${scope}:images-v1`, 'another-app-cache'], delete: async key => removed.push(key) };
  runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches, URL, Map, Set, Date, Promise, Request, Response, setTimeout });
  let pending; listeners.install({ waitUntil: promise => pending = promise }); await pending;
  for (const path of installed) if (path !== './') await access(new URL('../' + path, import.meta.url));
  assert.equal(new Set(requests.map(request=>request.url)).size,requests.length,'Cache.addAll must receive each shell URL once');
  assert.ok(requests.every(request=>request.cache==='reload'),'Installing a release must bypass stale HTTP-cached scripts and styles');
  assert.ok(installed.includes('./src/core.js'));
  assert.ok(installed.includes('./src/era.js'));
  assert.ok(installed.includes('./src/layout.js'));
  const shellFiles = new Set(installed.map(path => new URL('../' + path, import.meta.url).href));
  for (const path of installed.filter(path => path.endsWith('.js'))) {
    const file = new URL('../' + path, import.meta.url);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/import\s[^;]*?from\s*['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) assert.ok(shellFiles.has(new URL(match[1], file).href), `${path} imports an uncached module: ${match[1]}`);
    }
  }
  assert.ok(installed.includes('./duel.css'));
  listeners.activate({ waitUntil: promise => pending = promise }); await pending;
  assert.deepEqual(removed, [`duel-atlas:${scope}:shell-v0.0.0`]);
});
test('navigation keeps the installed HTML together with the same cached script and style release',async()=>{
  const listeners={},scope='https://example.com/repo/';let networkCalls=0;
  const cached=new Response('<html>installed release</html>'),self={registration:{scope},addEventListener:(name,handler)=>listeners[name]=handler};
  const caches={open:async()=>({match:async url=>url===scope+'index.html'?cached:undefined})};
  runInNewContext(await readFile(new URL('../sw.js',import.meta.url),'utf8'),{self,caches,URL,Request,Map,Set,Date,Promise,Response,setTimeout,fetch:async()=>{networkCalls++;return new Response('different release');}});
  let response;listeners.fetch({request:{method:'GET',mode:'navigate',url:scope},respondWith:promise=>response=promise});
  assert.equal(await (await response).text(),'<html>installed release</html>');assert.equal(networkCalls,0);
  caches.open=async()=>{throw Error('storage unavailable');};listeners.fetch({request:{method:'GET',mode:'navigate',url:scope},respondWith:promise=>response=promise});assert.equal(await (await response).text(),'different release');assert.equal(networkCalls,1);
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
  const workshop=await readFile(new URL('../workshop.css',import.meta.url),'utf8');
  assert.match(workshop,/\.deck-tray\s*\{[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
  assert.doesNotMatch(css,/deck-workspace-tabs|workspace-caption|two-row/);
  assert.match(css, /\.effect-text\s*\{[^}]*overflow:auto/);
  assert.match(css, /\.saved-list\s*\{[^}]*overflow:auto/);
  const autoScrolls = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /overflow(?:-[xy])?:auto/.test(m[2])).map(m => m[1].trim());
  assert.deepEqual([...new Set(autoScrolls)].sort(), ['.archive-panel', '.effect-text', '.saved-list', '.year-context'].sort());
  assert.match(css,/\.year-context\s*\{[^}]*max-height:60px[^}]*overflow:auto/);
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

test('unavailable Cache Storage does not break online app assets or card artwork, and duplicate image requests share one fetch',async()=>{
 const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
 for(const failure of ['open','match']){
  const listeners={},scope='https://example.com/repo/',calls=[];
  const self={registration:{scope},addEventListener:(name,handler)=>listeners[name]=handler};
  const caches={open:async()=>{if(failure==='open')throw Error('Cache blocked');return {match:async()=>{throw Error('Cache evicted');},put:async()=>{throw Error('Quota');}};}};
  runInNewContext(source,{self,caches,URL,Request,Map,Set,Date,Promise,Response,setTimeout,fetch:async request=>{calls.push(request.url);return new Response('Live bytes');}});
  const request=url=>{let response;listeners.fetch({request:new Request(url),respondWith:promise=>response=promise});return response;};
  assert.equal(await (await request(scope+'src/app.js')).text(),'Live bytes');
  const url='https://images.ygoprodeck.com/images/cards_small/89631139.jpg';
  const [one,two]=await Promise.all([request(url),request(url)]);
  assert.equal(await one.text(),'Live bytes');assert.equal(await two.text(),'Live bytes');
  assert.equal(calls.filter(call=>call===url).length,1);
 }
});
