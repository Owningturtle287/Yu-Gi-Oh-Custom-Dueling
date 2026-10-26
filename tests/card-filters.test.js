import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTRIBUTES,MONSTER_TYPES,SUBTYPES,MECHANICS,SPELL_TRAP_TYPES,matchesSubtype,isEffectMonster} from '../src/card-filters.js';
import {normalizeCard,filterCards,createDeck,addCard,exportJSON,importJSON} from '../src/core.js';
import {defaultSide,poolFor,setLabel} from '../src/duel/decks.js';
import {beliefPool} from '../src/duel/ai-memory.js';
import {readFile} from 'node:fs/promises';
const raw=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.concat(JSON.parse(await readFile(new URL('./era2006-fixtures.json',import.meta.url))).data);
const get=name=>{const card=raw.find(c=>c.name===name);assert.ok(card,name);return normalizeCard(card);};
test('shared menus contain all attributes, printed monster kinds and separate Spell/Trap types',()=>{
  assert.ok(ATTRIBUTES.includes('DIVINE'));assert.ok(MONSTER_TYPES.includes('Divine-Beast'));assert.ok(MONSTER_TYPES.includes('Illusion'));
  for(const value of ['Normal','Effect','Fusion','Ritual','Spirit','Toon','Gemini','Tuner','Union','Flip','Xyz'])assert.ok(SUBTYPES.includes(value));
  assert.ok(!MONSTER_TYPES.includes('Normal'));assert.ok(!MONSTER_TYPES.includes('Quick-Play'));assert.ok(SPELL_TRAP_TYPES.includes('Quick-Play'));
  for(const list of [ATTRIBUTES,MONSTER_TYPES,SUBTYPES,MECHANICS,SPELL_TRAP_TYPES])assert.equal(new Set(list).size,list.length);
});
test('Effect matches printed effects including implicit kinds and effect Fusions, without reclassifying Normal cards',()=>{
  for(const name of ['Man-Eater Bug','Asura Priest','Cyber Dragon','Elemental HERO Flame Wingman'])assert.ok(isEffectMonster(get(name)),name);
  for(const type of ['Gemini Monster','Tuner Monster','Union Effect Monster','Toon Monster'])assert.ok(matchesSubtype({...get('Cyber Dragon'),type},'Effect'),type);
  for(const name of ['Mystical Elf','Flame Swordsman','Black Luster Soldier'])assert.ok(!isEffectMonster(get(name)),name);
  for(const type of ['Normal Monster','Pendulum Normal Monster','Normal Tuner Monster'])assert.ok(!isEffectMonster({...get('Mystical Elf'),type,hasEffect:true}),type);
  const plainFusion={...get('Flame Swordsman'),hasEffect:false};assert.equal(matchesSubtype(plainFusion,'Normal'),false);assert.equal(matchesSubtype(plainFusion,'Fusion'),true);
  assert.equal(matchesSubtype({...get('Cyber Dragon'),name:'Normal Spirit Effect in a name',type:'Effect Monster'},'Spirit'),false);
  assert.equal(matchesSubtype({...get('Cyber Dragon'),type:'XYZ Monster',hasEffect:true},'Xyz'),true);
  assert.equal(matchesSubtype(get('Pot of Greed'),'Normal'),false);
});
test('effect metadata survives normalization, local decks and JSON backups; missing flags remain unknown',()=>{
  const card=normalizeCard({...get('Flame Swordsman'),misc_info:[{has_effect:0}]});assert.equal(card.hasEffect,false);assert.equal(normalizeCard(card).hasEffect,false);
  let deck=createDeck('Metadata');deck=addCard(deck,card,'extra');assert.equal(importJSON(exportJSON(deck)).sections.extra[0].card.hasEffect,false);
  assert.equal(normalizeCard({...get('Mystical Elf'),hasEffect:undefined,misc_info:undefined}).hasEffect,undefined);
});
test('archive and duel use identical monster predicates while duel Spell/Trap switches remain independent',()=>{
  const cards=['Mystical Elf','Cyber Dragon','Asura Priest','Man-Eater Bug','Flame Swordsman','Elemental HERO Flame Wingman','Pot of Greed','Waboku','Mystical Space Typhoon'].map(get);
  for(const filters of [{subtype:'Effect'},{subtype:'Normal'},{subtype:'Effect',mechanic:'Fusion'},{attribute:'LIGHT'},{race:'Spellcaster'},{subtype:'Spirit'},{mechanic:'Fusion'},{subtype:'Xyz'},{attribute:'DIVINE'}]){
    const browse=filterCards(cards,{...filters,category:'Monster',year:2006}).map(c=>c.id).sort();
    const duel=poolFor(cards,{...defaultSide(),...filters,spells:false,traps:false}).map(c=>c.id).sort();assert.deepEqual(browse,duel,JSON.stringify(filters));
  }
  const settings={...defaultSide(),subtype:'Effect',spellTrapType:'Quick-Play'};
  assert.ok(poolFor(cards,settings).some(c=>c.name==='Mystical Space Typhoon'));assert.ok(!poolFor(cards,settings).some(c=>c.name==='Pot of Greed'));
  assert.deepEqual(filterCards(cards,{spellTrapType:'Quick-Play'}).map(c=>c.name),['Mystical Space Typhoon']);
  const spirit=get('Asura Priest'),normal=get('Mystical Elf');assert.equal(beliefPool([spirit,normal],{subtype:'Effect'}).length,1);
});
test('set captions use the set release year and leave stored names intact',()=>{
  const set={name:'Cybernetic Revolution',date:'2005-08-06'};assert.equal(setLabel(set),'Cybernetic Revolution (2005)');assert.equal(set.name,'Cybernetic Revolution');
  assert.equal(setLabel({name:'Unknown date',date:'2005-02-31'}),'Unknown date');
});
