import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { cards } from './fixtures.js';
import { STORAGE_KEY, createDeck, addCard, totals } from '../src/core.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
async function boot(suffix, saved, fail = false, catalog = cards) {
  const window = new Window({ url: 'https://example.com/Yu-Gi-Oh-Custom-Dueling/' });
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
  if (saved) window.localStorage.setItem(STORAGE_KEY, saved);
  for (const key of ['window', 'document', 'localStorage', 'location', 'history', 'navigator', 'FormData', 'ResizeObserver', 'HTMLElement', 'URL', 'Blob']) Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.fetch = async () => { if (fail) throw new Error('Offline'); return { ok: true, json: async () => ({ data: catalog }) }; };
  if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const app = await import(`../src/app.js?${suffix}`);
  await app.requestArchive();
  return { window, app, $: selector => window.document.querySelector(selector) };
}
test('home, archive detail, named deck, save/reopen, format, and export menus work', async () => {
  const { window, app, $ } = await boot('workflow');
  try {
    assert.equal($('.launch-card.archive-launch').textContent.includes('Card Archive'), true);
    $('[data-route="archive"].archive-launch').click();
    assert.equal(app.state.route, 'archive');
    assert.equal($('.bottom-nav [data-route="archive"]').getAttribute('aria-current'), 'page');
    const search = $('#card-search'); search.value = 'blue-eyes white'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(app.state.filtered.length, 1);
    $('.card-inspect').click();
    assert.equal($('#dialog-title').textContent, 'Blue-Eyes White Dragon');
    assert.ok($('.effect-text').textContent.includes('powerful dragon'));
    $('[data-action="add-card"]').click();
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    $('[data-action="close"]').click();
    $('.bottom-nav [data-route="decks"]').click();
    $('[data-action="deck-options"]').click(); $('[data-action="rename"]').click();
    $('#deck-name').value = 'Pocket Blue-Eyes';
    $('#deck-name-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    $('[data-action="save-deck"]').click();
    assert.equal(app.state.dirty, false);
    assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).decks[0].name, 'Pocket Blue-Eyes');
    $('.deck-tray [data-quick-add]').click(); $('.deck-tray [data-quick-remove]').click();
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    $('[data-action="save-deck"]').click();
    $('[data-action="new-deck"]').click();
    $('#deck-name').value = 'Second strategy';
    $('#deck-name-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(app.state.draft.name, 'Second strategy');
    $('[data-action="deck-options"]').click(); $('[data-action="open-decks"]').click(); $('[data-open-deck]').click();
    assert.equal($('#dialog-title').textContent, 'Keep your changes?');
    $('#discard-draft').click();
    assert.equal(app.state.draft.name, 'Pocket Blue-Eyes');
    $('[data-action="deck-options"]').click(); $('[data-action="rules"]').click(); $('[data-preset="pre"]').click(); $('#apply-rules').click();
    assert.deepEqual(app.state.draft.mechanics, { Fusion: true, Synchro: false, Xyz: false, Pendulum: false, Link: false });
    $('[data-action="deck-options"]').click(); $('[data-action="backups"]').click();
    assert.ok($('[data-action="export-json"]'));
    assert.ok($('[data-action="export-ydk"]'));
    assert.ok($('[data-action="import"]'));
    $('[data-action="close"]').click();
    $('.bottom-nav [data-route="multiplayer"]').click();
    assert.equal(app.state.route, 'multiplayer');
    assert.equal($('#room-code').disabled, true);
    assert.equal($('.preview-panel button').disabled, true);
    $('.bottom-nav [data-route="home"]').click(); $('.launch-card[data-route="solo"]').click();
    assert.equal(app.state.route, 'solo');
    assert.match($('#main').textContent, /supported 2002 TCG cards/);
    assert.ok($('[data-duel="start"]'));
    $('#app-menu').click(); assert.ok($('[data-action="install"]')); assert.ok($('[data-action="settings"]'));
    $('[data-action="install"]').click(); assert.match($('#modal').textContent, /Add to Home Screen/);
    $('[data-action="close"]').click();
  } finally { window.close(); }
});
test('saved decks reopen in a new app session', async () => {
  const { window, app } = await boot('reopen', JSON.stringify({ version: 1, decks: [{ id: 'deck-1', name: 'Reopened deck', mechanics: { Fusion: true, Synchro: true, Xyz: true, Pendulum: true, Link: true }, sections: { main: [{ card: cards[0], quantity: 2 }], extra: [], side: [] } }] }));
  try { assert.equal(app.state.draft.name, 'Reopened deck'); assert.equal(app.state.draft.sections.main[0].quantity, 2); } finally { window.close(); }
});
test('API error has a visible retry action, and corrupt storage stays protected', async () => {
  const { window, app, $ } = await boot('failure', '{broken', true);
  try {
    app.navigate('archive');
    assert.equal(app.state.cardStatus, 'error'); assert.ok($('[data-action="retry"]'));
    app.navigate('decks'); $('[data-action="save-deck"]').click();
    assert.equal(window.localStorage.getItem(STORAGE_KEY), '{broken');
    assert.match($('#toast').textContent, /storage is unavailable/i);
  } finally { window.close(); }
});
test('quick add/remove keeps the search, results, and both scroll positions stable', async () => {
  const { window, app, $ } = await boot('quick-controls');
  try {
    app.navigate('decks');
    const search = $('#card-search');
    search.value = 'blue-eyes'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
    const panel = $('#archive-panel'), tray = $('.deck-tray');
    const add = $('.card-tile [data-quick-add]');
    add.click();
    tray.scrollLeft = 57; panel.scrollTop = 31;
    add.focus(); add.click();
    assert.equal(app.state.draft.sections.main[0].quantity, 2);
    assert.equal($('#card-search'), search);
    assert.equal($('#card-search').value, 'blue-eyes');
    assert.equal($('#archive-panel'), panel);
    assert.equal(panel.scrollTop, 31);
    assert.equal(tray.scrollLeft, 57);
    assert.equal(document.activeElement, add);
    assert.equal($('#modal').open, false);
    $('.card-tile [data-quick-remove]').click();
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    assert.equal($('.tray-card .copy-count').textContent, '×1');
    $('.card-inspect').click();
    assert.equal($('#modal').open, true);
    assert.equal($('#dialog-title').textContent, cards[0].name);
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    assert.equal($('.quick-controls button button'), null, 'quick controls are siblings of the inspect button');
  } finally { window.close(); }
});
test('Main, Extra, and Side switch the visible tray and available cards while retaining search', async () => {
  const { window, app, $ } = await boot('section-workspace');
  try {
    app.navigate('decks');
    $('.card-tile [data-quick-add="89631139"]').click();
    assert.equal($('[data-section-count="main"]').textContent, '1/60');
    const search = $('#card-search');
    search.value = 'Blue-Eyes'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
    $('[data-section="extra"]').click();
    assert.equal($('#card-search'), search);
    assert.equal(search.value, 'Blue-Eyes');
    assert.deepEqual(app.state.filtered.map(card => card.id), [23995346]);
    $('.card-tile [data-quick-add]').click();
    assert.equal(app.state.draft.sections.extra[0].quantity, 1);
    assert.equal($('.tray-card [data-card]').dataset.card, '23995346');
    $('[data-section="side"]').click();
    assert.equal(app.state.filtered.length, 2);
    $('.card-tile [data-quick-add="89631139"]').click();
    assert.equal($('.tray-card [data-quick-remove]').dataset.targetSection, 'side');
    assert.deepEqual(totals(app.state.draft), { main: 1, extra: 1, side: 1 });
    $('[data-section="main"]').click();
    assert.equal($('.tray-card [data-card]').dataset.card, '89631139');
    assert.equal($('.tray-card .copy-count').textContent, '×1');
  } finally { window.close(); }
});
test('quick controls enforce copy limits and disable removal at zero', async () => {
  const { window, app, $ } = await boot('quick-limit');
  try {
    app.navigate('archive');
    const add = $('[data-quick-add="89631139"]');
    for (let n = 0; n < 4; n++) add.click();
    assert.equal(app.state.draft.sections.main[0].quantity, 3);
    assert.match($('#toast').textContent, /Copy limit/);
    assert.equal($('#modal').open, false);
    const remove = $('[data-quick-remove="89631139"]');
    for (let n = 0; n < 3; n++) remove.click();
    assert.equal(app.state.draft.sections.main.length, 0);
    assert.equal(remove.disabled, true);
    assert.equal($('.card-tile[data-card-id="89631139"] .copy-count').hidden, true);
  } finally { window.close(); }
});
test('top deck switcher opens saved decks directly and protects unsaved changes', async () => {
  let first = addCard(createDeck('First saved', 'first'), cards[0]);
  const second = createDeck('Second saved', 'second');
  const { window, app, $ } = await boot('deck-switcher', JSON.stringify({ version: 1, decks: [first, second] }));
  const choose = id => { $('#deck-picker').value = id; $('#deck-picker').dispatchEvent(new window.Event('change', { bubbles: true })); };
  try {
    app.navigate('decks');
    assert.equal($('#deck-picker').options.length, 2);
    choose('second');
    assert.equal(app.state.draft.id, 'second');
    assert.equal($('#modal').open, false);
    $('[data-quick-add="89631139"]').click();
    choose('first');
    assert.equal(app.state.draft.id, 'second');
    assert.equal($('#deck-picker').value, 'second');
    assert.match($('#dialog-title').textContent, /Keep your changes/);
    $('#save-before-open').click();
    assert.equal(app.state.draft.id, 'first');
    assert.equal(app.state.decks.find(deck => deck.id === 'second').sections.main[0].quantity, 1);
    assert.equal($('.tray-card [data-card]').dataset.card, '89631139');
  } finally { window.close(); }
});
test('filter controls stay inside the deck workspace and saving preserves the result panel', async () => {
  const { window, app, $ } = await boot('builder-filters');
  try {
    app.navigate('decks');
    $('[data-action="filters"]').click();
    $('#filters-form select[name="category"]').value = 'Spell';
    $('#filters-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(app.state.route, 'decks');
    assert.ok($('#deck-picker'));
    assert.deepEqual(app.state.filtered.map(card => card.id), [83764718]);
    $('[data-quick-add="83764718"]').click();
    const results = $('#archive-panel'); results.scrollTop = 20;
    $('[data-action="save-deck"]').click();
    assert.equal($('#archive-panel'), results);
    assert.equal(results.scrollTop, 20);
    assert.equal(app.state.dirty, false);
  } finally { window.close(); }
});
test('the builder shows loading and updates its card results when an API request completes', async () => {
  const { window, app, $ } = await boot('builder-loading');
  try {
    app.navigate('decks');
    let resolveFetch;
    globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
    const request = app.requestArchive(true);
    assert.match($('#archive-panel').textContent, /Opening the archive/);
    await new Promise(resolve => setImmediate(resolve));
    resolveFetch({ ok: true, json: async () => ({ data: cards }) });
    await request;
    assert.ok($('.card-tile [data-quick-add]'));
    assert.equal(app.state.cardStatus, 'ready');
    assert.ok($('.deck-tray'));
  } finally { window.close(); }
});
test('Spirit and release-year controls filter results, update year context, and save the year', async () => {
  const spirit = { ...cards[0], id: 16889337, name: 'Aratama', type: 'Spirit Monster', race: 'Fiend', attribute: 'DARK', tcgDate: '2013-11-08' };
  const { window, app, $ } = await boot('spirit-year-filter', null, false, [...cards, spirit]);
  try {
    app.navigate('decks'); $('[data-action="filters"]').click();
    $('#filters-form select[name="subtype"]').value = 'Spirit';
    $('[data-filter-panel="year"]').click();
    assert.equal($('#year-filter-panel').hidden, false);
    $('#release-year').value = '2013'; $('#release-year').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match($('#year-context').textContent, /2013/);
    $('#filters-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(app.state.draft.releaseYear, 2013);
    assert.equal(app.state.filters.subtype, 'Spirit');
    assert.deepEqual(app.state.filtered.map(card => card.id), [16889337]);
    assert.match($('#result-meta').textContent, /TCG 2013/);
    $('[data-quick-add="16889337"]').click(); $('[data-action="save-deck"]').click();
    assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).decks[0].releaseYear, 2013);
    $('[data-action="filters"]').click();
    assert.equal($('#release-year').value, '2013');
    $('[data-action="reset-filters"]').click();
    assert.equal(app.state.draft.releaseYear, null);
    assert.equal(app.state.filters.subtype, '');
  } finally { window.close(); }
});
test('card tiles render a third phone column and do not nest compact controls inside inspection', async () => {
  const { window, app, $ } = await boot('three-column-grid');
  try {
    app.navigate('archive');
    const tiles = [...document.querySelectorAll('.card-tile')];
    assert.equal(tiles[0].style.top, tiles[1].style.top);
    assert.equal(tiles[1].style.top, tiles[2].style.top);
    assert.notEqual(tiles[2].style.left, tiles[1].style.left);
    assert.equal($('.card-inspect .quick-controls'), null);
  } finally { window.close(); }
});
const soloCatalog = Array.from({length:24},(_,index)=>({...cards[0],id:500000+index,name:`Classic warrior ${index}`,type:'Normal Monster',race:'Warrior',attribute:'EARTH',level:4,atk:1000+index*40,def:900,desc:'A classic test warrior.',setNames:['Classic test set'],card_images:[]}));
async function waitFor(predicate){const end=Date.now()+2000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),'UI did not reach its expected ready state');}
test('Solo setup saves independent eligibility, difficulty, saved-deck choices and builder return', async () => {
  const {window,app,$}=await boot('solo-setup',null,false,soloCatalog);
  const change=(selector,value)=>{const input=$(selector);input.value=value;input.dispatchEvent(new window.Event('change',{bubbles:true}));};
  try{
    $('.bottom-nav [data-route="solo"]').click();assert.ok($('.solo-setup'));
    $('[data-duel-tab="1"]').click();$('[data-duel="filters"]').click();
    change('#duel-filters [name="race"]','Warrior');change('#duel-filters [name="attribute"]','EARTH');
    $('#duel-filters [name="traps"]').checked=false;
    $('#duel-filters').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    let config=JSON.parse(window.localStorage.getItem('duel-atlas.solo-config.v1'));
    assert.equal(config.sides[1].race,'Warrior');assert.equal(config.sides[1].traps,false);assert.equal(config.sides[0].race,'');
    $('[data-duel-tab="2"]').click();change('#solo-difficulty','hard');change('#solo-ai-speed','relaxed');change('#solo-first','you');
    $('[data-duel-tab="1"]').click();change('#solo-source','saved');$('[data-duel="design"]').click();
    assert.equal(app.state.route,'decks');assert.match($('.duel-design-banner').textContent,/AI Solo deck/);
    assert.equal(app.state.draft.releaseYear,2002);assert.equal(app.state.filtered.length,24);
    $('.card-tile [data-quick-add]').click();$('[data-action="return-solo"]').click();
    assert.equal(app.state.route,'solo');assert.equal($('#solo-source').value,'saved');
    config=JSON.parse(window.localStorage.getItem('duel-atlas.solo-config.v1'));
    assert.equal(config.difficulty,'hard');assert.equal(config.sides[1].deckId,app.state.draft.id);
    assert.equal(config.aiSpeed,'relaxed');
    $('[data-duel="start"]').click();assert.match($('#modal').textContent,/AI deck: Main Deck needs 40–60/);
  }finally{app.navigate('home');window.close();}
});
test('a Solo match starts, tracks phases, offers real summon actions, pauses, resumes and surrenders', async () => {
  const {window,app,$}=await boot('solo-play',null,false,soloCatalog);
  try{
    app.navigate('solo');$('[data-duel-tab="2"]').click();
    $('#solo-first').value='you';$('#solo-first').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('#solo-ai-speed').value='fast';$('#solo-ai-speed').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('#solo-animations').checked=false;$('#solo-animations').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('[data-duel="start"]').click();assert.ok($('.duel-arena'));assert.equal(document.querySelectorAll('.duel-board .duel-zone').length,20);
    assert.ok(document.documentElement.classList.contains('duel-playing'));
    assert.equal(document.querySelectorAll('.duel-hand-card').length,5);
    assert.equal($('.duel-phases [aria-current]').textContent,'DDraw');
    await waitFor(()=>$('.duel-phases [aria-current]')?.textContent==='M1Main 1'&&Boolean($('[data-duel="next"]')&&!$('[data-duel="next"]').disabled));
    assert.equal($('.duel-phases [aria-current]').textContent,'M1Main 1');
    assert.equal(document.querySelectorAll('.duel-hand-card').length,5,'The first player does not receive an extra automatic draw');
    $('.duel-hand-card').click();assert.match($('.duel-context-controls').textContent,/Normal Summon/);assert.equal($('#modal').open,false);
    [...document.querySelectorAll('[data-duel-group]')].find(b=>b.textContent==='Normal Summon').click();
    assert.equal(document.querySelectorAll('.yours .duel-zone.occupied').length,1);
    $('.duel-exit').click();assert.equal(app.state.route,'home');assert.equal(document.documentElement.classList.contains('duel-playing'),false);
    app.navigate('archive');assert.equal($('.duel-arena'),null);app.navigate('solo');
    assert.equal(document.querySelectorAll('.yours .duel-zone.occupied').length,1);
    $('[data-duel="duel-menu"]').click();$('[data-duel="surrender"]').click();$('[data-duel="confirm-surrender"]').click();
    assert.match($('.duel-prompt').textContent,/Defeat/);assert.ok($('[data-duel="rematch"]'));
    await waitFor(()=>$('.duel-arena').dataset.moving==='false');
    $('[data-duel="duel-menu"]').click();$('[data-duel-keep="0"]').click();
    assert.ok(app.state.decks.some(deck=>deck.sections.main.reduce((n,e)=>n+e.quantity,0)===40));
    $('[data-action="close"]').click();$('[data-duel="rematch"]').click();assert.ok($('.solo-setup'));
  }finally{app.navigate('home');window.close();}
});
test('Set monsters use the authentic sideways card back; AI speed and the expanded log work in a match',async()=>{
  const {window,app,$}=await boot('solo-presentation',null,false,soloCatalog);
  const change=(selector,value)=>{const input=$(selector);input.value=value;input.dispatchEvent(new window.Event('change',{bubbles:true}));};
  try{
    app.navigate('solo');$('[data-duel-tab="2"]').click();change('#solo-first','you');change('#solo-ai-speed','fast');
    $('#solo-animations').checked=false;$('#solo-animations').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('[data-duel="start"]').click();await waitFor(()=>$('.duel-phases [aria-current]')?.textContent==='M1Main 1'&&Boolean($('[data-duel="next"]')&&!$('[data-duel="next"]').disabled));
    $('.duel-hand-card').click();[...document.querySelectorAll('[data-duel-group]')].find(button=>button.textContent==='Set in Defense').click();
    const monster=$('.yours .duel-zone.occupied');assert.ok(monster.classList.contains('defense'));assert.ok(monster.classList.contains('face-down'));
    assert.match($('.yours .duel-zone.occupied .duel-card-visual img').getAttribute('src'),/assets\/card-back.jpg$/);
    assert.match(monster.getAttribute('aria-label'),/Defense Position/);
    $('.duel-log-open').click();assert.ok($('.duel-log-body'));assert.ok($('.duel-log-turn'));
    assert.match($('#duel-log-scroll').textContent,/Turn 1/);assert.match($('#duel-log-scroll').textContent,/Set a monster/);
    assert.ok($('[data-duel="log-latest"]'));$('[data-duel-log-filter="battle"]').click();
    assert.equal($('[data-duel-log-filter="battle"]').getAttribute('aria-pressed'),'true');
    assert.doesNotMatch($('#duel-log-scroll').textContent,/Set a monster/);
    $('[data-action="close"]').click();$('[data-duel="duel-menu"]').click();change('#duel-ai-speed','deliberate');
    assert.equal(JSON.parse(window.localStorage.getItem('duel-atlas.solo-config.v1')).aiSpeed,'deliberate');
  }finally{app.navigate('home');window.close();}
});
test('set generation loads real memberships and preserves a visible retry when dates fail', async()=>{
  const {window,app,$}=await boot('solo-sets',null,false,soloCatalog);
  try{
    app.navigate('solo');globalThis.fetch=async()=>{throw new Error('Offline');};
    $('#solo-source').value='set';$('#solo-source').dispatchEvent(new window.Event('change',{bubbles:true}));
    await new Promise(resolve=>setImmediate(resolve));assert.ok($('[data-duel="sets-retry"]'));
    globalThis.fetch=async()=>({ok:true,json:async()=>[{set_name:'Classic test set',tcg_date:'2002-06-26'},{set_name:'Too late',tcg_date:'2003-01-01'}]});
    $('[data-duel="sets-retry"]').click();await new Promise(resolve=>setImmediate(resolve));
    assert.match($('#solo-set').textContent,/Classic test set · 24 cards/);assert.doesNotMatch($('#solo-set').textContent,/Too late/);
    $('[data-duel="start"]').click();assert.ok($('.duel-arena'));
  }finally{app.navigate('home');window.close();}
});
test('opening phases pause in the expanded log and resume without an extra draw',async()=>{
  const {window,app,$}=await boot('solo-opening-pause',null,false,soloCatalog);
  try{
    app.navigate('solo');$('[data-duel-tab="2"]').click();
    $('#solo-first').value='you';$('#solo-first').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('#solo-animations').checked=false;$('#solo-animations').dispatchEvent(new window.Event('change',{bubbles:true}));
    $('[data-duel="start"]').click();$('.duel-log-open').click();
    assert.ok($('.duel-log-body'));assert.equal($('#modal').open,true);
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal($('.duel-phases').dataset.phase,'draw');assert.equal(document.querySelectorAll('.duel-hand-card').length,5);
    $('[data-action="close"]').click();await waitFor(()=>$('.duel-phases').dataset.phase==='main1'&&Boolean($('[data-duel="next"]')&&!$('[data-duel="next"]').disabled));
    assert.equal(document.querySelectorAll('.duel-hand-card').length,5);
  }finally{app.navigate('home');window.close();}
});
