import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { cards } from './fixtures.js';
import { STORAGE_KEY } from '../src/core.js';

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
    $('.card-tile').click();
    assert.equal($('#dialog-title').textContent, 'Blue-Eyes White Dragon');
    assert.ok($('.effect-text').textContent.includes('powerful dragon'));
    $('[data-action="add-card"]').click();
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    $('[data-action="close"]').click();
    $('.bottom-nav [data-route="decks"]').click();
    $('[data-action="rename"]').click();
    $('#deck-name').value = 'Pocket Blue-Eyes';
    $('#deck-name-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    $('[data-action="save-deck"]').click();
    assert.equal(app.state.dirty, false);
    assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).decks[0].name, 'Pocket Blue-Eyes');
    $('[data-increment]').click(); $('[data-remove]').click();
    assert.equal(app.state.draft.sections.main[0].quantity, 1);
    $('[data-action="save-deck"]').click();
    $('[data-action="new-deck"]').click();
    $('#deck-name').value = 'Second strategy';
    $('#deck-name-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(app.state.draft.name, 'Second strategy');
    $('[data-action="open-decks"]').click(); $('[data-open-deck]').click();
    assert.equal($('#dialog-title').textContent, 'Keep your changes?');
    $('#discard-draft').click();
    assert.equal(app.state.draft.name, 'Pocket Blue-Eyes');
    $('[data-action="rules"]').click(); $('[data-preset="pre"]').click(); $('#apply-rules').click();
    assert.deepEqual(app.state.draft.mechanics, { Fusion: true, Synchro: false, Xyz: false, Pendulum: false, Link: false });
    $('[data-action="backups"]').click();
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
