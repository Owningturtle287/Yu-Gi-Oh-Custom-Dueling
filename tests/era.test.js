import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard, createDeck, addCard, filterCards, deckWarnings, readDecks, saveDeck, exportJSON, importJSON, STORAGE_KEY } from '../src/core.js';
import { releaseCutoff, currentYear, normalizeReleaseYear, buildYearHighlights, hydrateDeckDates } from '../src/era.js';
import { cardGridLayout } from '../src/layout.js';
import { dragon, link, memoryStorage } from './fixtures.js';

test('past-year cutoffs include December 31 and exclude January 1 of the next year and undated cards', () => {
  const cards = [
    { ...dragon, id: 1, tcgDate: '2013-12-31' },
    { ...dragon, id: 2, tcgDate: '2014-01-01' },
    { ...dragon, id: 3, tcgDate: null },
    { ...dragon, id: 4, tcgDate: '2002-03-08' }
  ];
  assert.deepEqual(filterCards(cards, { year: 2013 }).map(card => card.id), [1, 4]);
  assert.equal(releaseCutoff(2013), '2013-12-31');
});
test('current-year defaults follow the device date and reject future years', () => {
  const december = new Date(2026, 11, 31), january = new Date(2027, 0, 1);
  assert.equal(currentYear(december), 2026);
  assert.equal(currentYear(january), 2027);
  assert.equal(releaseCutoff(null, december), '2026-12-31');
  assert.equal(releaseCutoff(null, january), '2027-01-01');
  assert.equal(normalizeReleaseYear('current', january), null);
  assert.throws(() => normalizeReleaseYear(2028, january), /Choose a release year/);
  const future = { ...dragon, tcgDate: `${currentYear() + 1}-01-01` };
  assert.equal(filterCards([future]).length, 0);
});
test('misc metadata normalizes first TCG dates and rejects invalid calendar dates', () => {
  assert.equal(normalizeCard({ ...dragon, tcgDate: undefined, misc_info: [{ tcg_date: '2013-11-08', ocg_date: '2013-07-20' }] }).tcgDate, '2013-11-08');
  assert.equal(normalizeCard({ ...dragon, tcgDate: undefined, misc_info: [{ tcg_date: '2013-02-30' }] }).tcgDate, null);
  assert.equal(normalizeCard({ ...dragon, tcgDate: undefined }).tcgDate, null);
});
test('Spirit subtype combines with race, attribute, and release year rather than matching card names', () => {
  const spirit = { ...dragon, id: 16889337, name: 'Aratama', type: 'Spirit Monster', tcgDate: '2013-11-08', race: 'Fiend', attribute: 'DARK' };
  const namedSpirit = { ...dragon, id: 99, name: 'Spirit in the name', type: 'Effect Monster' };
  assert.deepEqual(filterCards([spirit, namedSpirit], { subtype: 'Spirit', race: 'Fiend', attribute: 'DARK', year: 2013 }).map(card => card.id), [spirit.id]);
  assert.equal(filterCards([spirit], { subtype: 'Spirit', year: 2012 }).length, 0);
});
test('release years survive storage and JSON backups, and additions respect their cutoff', () => {
  let deck = { ...createDeck('2013 pool'), releaseYear: 2013 };
  deck = addCard(deck, dragon);
  assert.throws(() => addCard(deck, link), /after this deck’s cutoff/);
  assert.throws(() => addCard(deck, { ...dragon, tcgDate: null }), /no verified TCG release date/);
  const storage = memoryStorage(); saveDeck(storage, [], deck);
  assert.equal(readDecks(storage)[0].releaseYear, 2013);
  assert.equal(importJSON(exportJSON(deck)).releaseYear, 2013);
});
test('legacy snapshots and newly restricted decks are retained and flagged, then enriched from the archive', () => {
  const storage = memoryStorage();
  const deck = addCard(createDeck('Legacy deck'), dragon);
  delete deck.releaseYear; delete deck.sections.main[0].card.tcgDate;
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, decks: [deck] }));
  const [reopened] = readDecks(storage);
  assert.equal(reopened.releaseYear, null);
  assert.equal(reopened.sections.main.length, 1);
  assert.ok(deckWarnings(reopened).some(warning => /missing a TCG date/.test(warning)));
  const hydrated = hydrateDeckDates(reopened, new Map([[dragon.id, normalizeCard(dragon)]]));
  assert.equal(hydrated.sections.main[0].card.tcgDate, '2002-03-08');
  let newer = addCard(hydrated, link); newer.releaseYear = 2013;
  saveDeck(storage, [hydrated], newer);
  assert.equal(readDecks(storage)[0].sections.extra.length, 1);
  assert.ok(deckWarnings(newer).some(warning => /release-year cutoff/.test(warning)));
});
test('year context derives real introductions and new archetypes from first-release dates', () => {
  const cards = [
    { ...dragon, tcgDate: '2002-03-08' },
    { ...dragon, type: 'Spirit Monster', tcgDate: '2003-06-01' },
    { ...dragon, archetype: 'Bujin', tcgDate: '2013-08-08' },
    { ...dragon, archetype: 'Bujin', tcgDate: '2013-11-08' },
    link
  ];
  const context = buildYearHighlights(cards);
  assert.deepEqual(context.get(2013).archetypes, ['Bujin']);
  assert.equal(context.get(2013).introduced.includes('Spirit monsters'), false);
  assert.ok(context.get(2017).introduced.includes('Link monsters'));
  assert.ok(context.get(2017).introduced.includes('Cyberse type'));
});
test('phone grids fit at least three columns without overflow while narrower panels adapt', () => {
  for (const width of [280, 296, 320, 350, 366, 390]) {
    const layout = cardGridLayout(width, 250, false);
    assert.equal(layout.columns, 3, `three columns at ${width}px`);
    assert.ok(layout.tileWidth >= 88);
    assert.ok(Math.abs(layout.columns * layout.tileWidth + (layout.columns - 1) * layout.gap - width) < 0.001);
  }
  assert.equal(cardGridLayout(230).columns, 2);
  assert.ok(cardGridLayout(750).columns > 3);
});

test('builder grids devote tile height to card art and fit more columns',()=>{
  for(const width of [230,280,350,500]){
    const compact=cardGridLayout(width,500,true),archive=cardGridLayout(width,500,false);
    assert.ok(compact.columns>=3);assert.ok(compact.columns>=archive.columns);
    assert.equal(compact.tileHeight,Math.round((compact.tileWidth-4)*614/421)+18);
    assert.ok(Math.abs(compact.columns*compact.tileWidth+(compact.columns-1)*compact.gap-width)<.001);
  }
});
