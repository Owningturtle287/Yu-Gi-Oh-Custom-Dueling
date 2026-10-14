import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { cards } from './fixtures.js';
import { STORAGE_KEY, createDeck, addCard, totals } from '../src/core.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
async function boot(suffix, saved, fail = false) {
  const window = new Window({ url: 'https://example.com/Yu-Gi-Oh-Custom-Dueling/' });
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
  if (saved) window.localStorage.setItem(STORAGE_KEY, saved);
  for (const key of ['window', 'document', 'localStorage', 'location', 'history', 'navigator', 'FormData', 'ResizeObserver', 'HTMLElement', 'URL', 'Blob']) Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.fetch = async () => { if (fail) throw new Error('Offline'); return { ok: true, json: async () => ({ data: cards }) }; };
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
    assert.match($('#main').textContent, /rules enforcement.*later phase/);
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
