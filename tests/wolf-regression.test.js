import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {command,advanceBattle} from './battle-fixtures.js';
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
// Use the actual pinned database and Lua scripts, with small archive descriptors.
const cards=['Mystical Elf','Twin-Headed Wolf','Hade-Hane','Summoned Skull'].map(name=>{
 const r=[...pack.records.values()].find(r=>r.name===name);
 return normalizeCard({id:r.code,name,type:r.type&0x200000?'Flip Effect Monster':r.type&0x20?'Effect Monster':'Normal Monster',race:name==='Summoned Skull'||name==='Twin-Headed Wolf'?'Fiend':name==='Hade-Hane'?'Beast':'Spellcaster',attribute:'DARK',level:r.level,atk:r.attack,def:r.defense,desc:name==='Hade-Hane'?'FLIP: You can target up to 3 monsters on the field; return those targets to the hand.':''});
});
const get=name=>cards.find(c=>c.name===name),body=(name,props={})=>({card:get(name),...props});
const decks=[0,1].map(()=>({name:'Wolf regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
for(const attackingSide of [0,1])for(const support of ['none','non-Fiend','face-down Fiend','opposing Fiend','Fiend in grave','face-up Fiend'])test(`Wolf vs Hade-Hane: ${support}, controller ${attackingSide}`,async()=>{
 const e=createNativeBackend({rules:()=>pack}),defendingSide=1-attackingSide,fields=[{},{}];
 fields[attackingSide]={monsters:[body('Twin-Headed Wolf'),...(support==='non-Fiend'?[body('Mystical Elf')]:support==='face-down Fiend'?[body('Summoned Skull',{faceUp:false,defense:true})]:support==='face-up Fiend'?[body('Summoned Skull')]:[])],grave:support==='Fiend in grave'?[body('Summoned Skull')]:[]};
 fields[defendingSide]={monsters:[body('Hade-Hane',{faceUp:false,defense:true}),...(support==='opposing Fiend'?[body('Summoned Skull')]:[])]};
 let s=await e.createMatch(decks,{cards,first:defendingSide,seed:93,openingHands:[[],[]],initialFields:fields});
 try{
  s=advanceBattle(e,s,x=>x.active===attackingSide&&x.phase==='main1'&&!x.window&&!x.choice);
  s=command(e,s,'NEXT',attackingSide);s=command(e,s,'ATTACK',attackingSide,'Twin-Headed Wolf');
  const wolf=s.players[attackingSide].monsters[0].uid,hade=s.players[defendingSide].monsters[0].uid;
  s=e.applyAction(s,s.actions[attackingSide].find(a=>a.target===hade),attackingSide);
  s=advanceBattle(e,s,x=>x.choice?.source?.card.name==='Hade-Hane'&&x.choice.selectionType==='select_card');
  s=e.applyAction(s,s.actions[defendingSide].find(a=>a.target===wolf),defendingSide);s=e.applyAction(s,s.actions[defendingSide].find(a=>a.finish),defendingSide);
  s=advanceBattle(e,s,x=>!x.pending&&!x.choice&&!x.window);
  const negated=support==='face-up Fiend';
  assert.equal(s.players[attackingSide].monsters.some(c=>c?.uid===wolf),negated);
  assert.equal(s.players[attackingSide].hand.some(c=>c.uid===wolf),!negated);
  assert.ok(s.players[defendingSide].grave.some(c=>c.uid===hade));
  assert.equal(s.log.some(l=>/Hade-Hane.*negated by Twin-Headed Wolf/.test(l.message)),negated);
  assert.equal(s.log.some(l=>l.effectNotice?.card.name==='Twin-Headed Wolf'),negated,'Only real conditional negation receives a Wolf notice');
 }finally{e.destroyMatch(s);}
});
test('Hade-Hane returns three selected monsters when Wolf has no other Fiend',async()=>{
 const e=createNativeBackend({rules:()=>pack});let s=await e.createMatch(decks,{cards,first:0,seed:93,openingHands:[[],[]],initialFields:[{monsters:[body('Hade-Hane',{faceUp:false,defense:true}),body('Mystical Elf')]},{monsters:[body('Twin-Headed Wolf'),body('Mystical Elf')]}]});
 try{
  s=advanceBattle(e,s,x=>x.active===1&&x.phase==='main1'&&!x.window&&!x.choice);s=command(e,s,'NEXT',1);s=command(e,s,'ATTACK',1,'Twin-Headed Wolf');
  const hade=s.players[0].monsters[0].uid,targets=[s.players[0].monsters[1].uid,...s.players[1].monsters.filter(Boolean).map(c=>c.uid)];
  s=e.applyAction(s,s.actions[1].find(a=>a.target===hade),1);s=advanceBattle(e,s,x=>x.choice?.source?.card.name==='Hade-Hane'&&x.choice.selectionType==='select_card');
  for(const uid of targets)s=e.applyAction(s,s.actions[0].find(a=>a.target===uid),0);
  s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);s=advanceBattle(e,s,x=>!x.pending&&!x.choice&&!x.window);
  assert.equal(s.players.flatMap(p=>p.hand).filter(c=>targets.includes(c.uid)).length,3);
  assert.ok(!s.log.some(l=>/Hade-Hane.*negated/.test(l.message)));
 }finally{e.destroyMatch(s);}
});
