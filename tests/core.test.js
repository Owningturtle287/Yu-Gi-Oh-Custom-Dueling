import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCards, createDeck, addCard, removeCard, totals, saveDeck, readDecks, deleteSavedDeck, exportJSON, importJSON, exportYDK, importYDK, validateDeck, deckWarnings, STORAGE_KEY } from '../src/core.js';
import { dragon, fusion, xyz, link, spell, cards, memoryStorage } from './fixtures.js';

test('search covers names, archetypes, and card text without changing the archive', () => {
  assert.equal(filterCards(cards, { query: ' blue-eyes ' }).length, 2);
  assert.equal(filterCards(cards, { query: 'Special Summon' })[0].name, spell.name);
  assert.equal(filterCards(cards, { query: 'utopia' })[0].id, xyz.id);
  assert.equal(filterCards(cards, { query: 'missing' }).length, 0);
  assert.equal(cards.length, 6);
});
test('category, attribute, race, mechanic, and sorting filters combine', () => {
  assert.equal(filterCards(cards, { category: 'Spell' }).length, 1);
  assert.equal(filterCards(cards, { category: 'Trap' }).length, 1);
  assert.equal(filterCards(cards, { category: 'Extra' }).length, 3);
  assert.equal(filterCards(cards, { mechanic: 'Xyz' })[0].id, xyz.id);
  assert.equal(filterCards(cards, { mechanic: 'Link' })[0].id, link.id);
  assert.equal(filterCards(cards, { category: 'Monster', attribute: 'LIGHT', race: 'Dragon', mechanic: 'Fusion' })[0].id, fusion.id);
  assert.equal(filterCards(cards, { sort: 'atk' })[0].id, fusion.id);
  assert.equal(filterCards(cards, { sort: 'level' })[0].id, fusion.id);
  assert.deepEqual(filterCards(cards, { sort: 'za' }).map(c => c.id), filterCards(cards).reverse().map(c => c.id));
});
test('quantities and 3-copy limit span main, extra, and side with immutable edits', () => {
  const original = createDeck('Blue-Eyes');
  let deck = addCard(original, dragon);
  deck = addCard(deck, dragon, 'side');
  deck = addCard(deck, dragon, 'main');
  assert.deepEqual(totals(original), { main: 0, extra: 0, side: 0 });
  assert.deepEqual(totals(deck), { main: 2, extra: 0, side: 1 });
  assert.throws(() => addCard(deck, dragon, 'side'), /Copy limit/);
  deck = removeCard(deck, dragon.id, 'side');
  assert.equal(deck.sections.side.length, 0);
  deck = addCard(deck, dragon, 'main');
  assert.equal(deck.sections.main[0].quantity, 3);
});
test('extra placement, capacities, and tokens have clear validation', () => {
  const deck = createDeck('Placement');
  assert.equal(totals(addCard(deck, fusion)).extra, 1);
  assert.throws(() => addCard(deck, fusion, 'main'), /Extra Deck/);
  assert.throws(() => addCard(deck, dragon, 'extra'), /Only Fusion/);
  assert.throws(() => addCard(deck, { ...dragon, type: 'Token' }), /Tokens/);
  for (const section of ['main', 'extra', 'side']) {
    let full = createDeck(section);
    const limit = section === 'main' ? 60 : 15;
    const model = section === 'extra' ? fusion : dragon;
    for (let n = 0; n < limit; n++) full = addCard(full, { ...model, id: 1000 + n, name: model.name + ' ' + n }, section);
    assert.throws(() => addCard(full, { ...model, id: 2000 }, section), /full/);
  }
});
test('mechanic restrictions recognize uppercase XYZ and hybrid Pendulum monsters', () => {
  let deck = createDeck('Fusion era');
  deck.mechanics = { Fusion: true, Synchro: false, Xyz: false, Pendulum: false, Link: false };
  assert.throws(() => addCard(deck, xyz), /Xyz is disabled/);
  assert.throws(() => addCard(deck, link), /Link is disabled/);
  assert.throws(() => addCard(deck, { ...fusion, type: 'Pendulum Effect Fusion Monster' }), /Pendulum is disabled/);
  assert.equal(totals(addCard(deck, fusion)).extra, 1);
  deck = addCard(createDeck('Review'), xyz);
  deck.mechanics.Xyz = false;
  assert.ok(deckWarnings(deck).some(w => /disabled/.test(w)));
  assert.equal(validateDeck(deck).mechanics.Xyz, false);
});
test('saved decks reopen, rename, and replace by identity with complete card snapshots', () => {
  const storage = memoryStorage();
  let deck = addCard(createDeck('First'), dragon);
  let saved = saveDeck(storage, deck);
  assert.equal(readDecks(storage)[0].sections.main[0].card.desc, dragon.desc);
  deck = { ...deck, name: 'Renamed' };
  saved = saveDeck(storage, deck);
  assert.equal(saved.length, 1);
  assert.equal(readDecks(storage)[0].name, 'Renamed');
  saved = saveDeck(storage, createDeck('Second'));
  assert.equal(readDecks(storage).length, 2);
});
test('storage errors and corrupt payloads never silently overwrite existing decks', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{broken');
  assert.throws(() => readDecks(storage));
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
  const fail = { getItem() { return null; }, setItem() { throw new Error('Quota exceeded'); } };
  assert.throws(() => saveDeck(fail, createDeck('Unsaved')), /Quota exceeded/);
});
test('deletion reads the latest saved list, removes only its ID, and preserves the old state on storage failure',()=>{
  const storage=memoryStorage(),first=createDeck('First','first'),second=createDeck('Second','second');
  saveDeck(storage,first);saveDeck(storage,second);
  assert.deepEqual(deleteSavedDeck(storage,'first').map(d=>d.id),['second']);
  const before=storage.getItem(STORAGE_KEY),fail={getItem:storage.getItem,setItem(){throw new Error('Storage full');}};
  assert.throws(()=>deleteSavedDeck(fail,'second'),/Storage full/);assert.equal(storage.getItem(STORAGE_KEY),before);
  assert.deepEqual(deleteSavedDeck(storage,'second'),[]);assert.deepEqual(readDecks(storage),[]);
  storage.setItem(STORAGE_KEY,'{broken');assert.throws(()=>deleteSavedDeck(storage,'first'));assert.equal(storage.getItem(STORAGE_KEY),'{broken');
});
test('JSON preserves restrictions and snapshots; YDK preserves IDs, sections, and copies', () => {
  let deck = addCard(addCard(addCard(createDeck('Backup'), dragon), fusion), spell, 'side');
  deck = addCard(deck, dragon);
  deck.mechanics.Link = false;
  assert.deepEqual(importJSON(exportJSON(deck)), deck);
  const restored = importYDK(exportYDK(deck), cards, 'Restored');
  assert.deepEqual(totals(restored), totals(deck));
  assert.equal(restored.sections.main[0].card.id, dragon.id);
  assert.equal(restored.sections.extra[0].card.id, fusion.id);
  assert.equal(restored.sections.side[0].card.id, spell.id);
  assert.equal(restored.mechanics.Link, true);
  assert.equal(importYDK('#main\n89631140\n#extra\n!side\n', cards, 'Alternate art').sections.main[0].card.id, dragon.id);
});
test('imports reject malformed, oversized, unknown-card, and copy-limit data atomically', () => {
  assert.throws(() => importJSON('{bad'));
  assert.throws(() => importJSON('{"version":99}'), /v1/);
  const bad = createDeck('Invalid');
  bad.sections.main.push({ card: dragon, quantity: 4 });
  assert.throws(() => validateDeck(bad), /quantity/);
  assert.throws(() => importYDK('#main\n999999999\n', cards, 'Unknown'), /Nothing was imported/);
  assert.throws(() => importYDK('#main\n89631139\n89631139\n89631139\n!side\n89631139', cards, 'Copies'), /Copy limit/);
  assert.throws(() => importYDK('not a YDK', cards, 'Bad'), /Invalid YDK/);
});
