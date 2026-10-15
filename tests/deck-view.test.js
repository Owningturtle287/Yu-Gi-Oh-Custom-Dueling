import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleDeckEntries} from '../src/deck-view.js';
import {dragon,fusion,spell,trap,link} from './fixtures.js';
const entries=[trap,spell,dragon,fusion,link].map(card=>({card,quantity:2}));
test('deck view groups monsters, Spells and Traps without changing saved order or quantities',()=>{
  const before=JSON.stringify(entries),shown=visibleDeckEntries(entries);
  assert.deepEqual(shown.slice(-2).map(e=>e.card.type),['Spell Card','Trap Card']);
  assert.equal(shown.reduce((n,e)=>n+e.quantity,0),10);assert.equal(JSON.stringify(entries),before);
});
test('deck view combines category and local name, type or effect searches',()=>{
  assert.deepEqual(visibleDeckEntries(entries,{category:'Spell',query:'special summon'}).map(e=>e.card.id),[spell.id]);
  assert.equal(visibleDeckEntries(entries,{category:'Monster',query:'blue-eyes'}).length,2);
  assert.equal(visibleDeckEntries(entries,{category:'Trap',query:'blue-eyes'}).length,0);
});
test('deck view sorts by name and combat stats with missing stats last',()=>{
  assert.equal(visibleDeckEntries(entries,{sort:'atk'})[0].card.id,fusion.id);
  assert.equal(visibleDeckEntries(entries,{sort:'level'})[0].card.id,fusion.id);
  assert.equal(visibleDeckEntries(entries,{sort:'def'}).at(-1).card.id,spell.id);
  const names=visibleDeckEntries(entries,{sort:'az'}).map(e=>e.card.name);assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));
});
