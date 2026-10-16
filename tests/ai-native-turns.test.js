import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
const cards=JSON.parse(await readFile(new URL('./ai-native-fixtures.json',import.meta.url))),get=name=>cards.find(c=>c.name===name);
const rules=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>rules});
const decks=()=>[0,1].map(()=>({name:'AI sequence regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
function play(s){for(let n=0;n<150&&s.winner===null&&s.active===1;n++){const side=s.actions[0].length?0:1,action=side===0?s.actions[0].find(a=>a.type==='PASS')||engine.chooseAIAction(s,0):engine.chooseAIAction(s,1);assert.ok(action);s=engine.applyAction(s,action,side);}return s;}
test('native AI summons Exiled Force, pays its tribute, destroys a stronger blocker and wins with the existing attacker',async()=>{
  let s=await engine.createMatch(decks(),{cards,seed:27,first:0,lp:2500,openingHands:[[get('Mystical Elf')],[get('Exiled Force')]],initialFields:[{monsters:[{card:get('Blue-Eyes White Dragon')}]},{monsters:[{card:get('Summoned Skull')}]}]});
  try{assert.ok(aiObservation(s,1).players[0].hand.every(c=>c.hidden));assert.ok(s.aiMemory[1].known[s.players[0].monsters[0].uid]);s=engine.applyAction(s,{type:'END'},0);assert.equal(engine.findCard(s,engine.chooseAIAction(s,1).uid)?.card.name,'Exiled Force');s=play(s);assert.equal(s.winner,1);assert.ok(s.players[1].grave.some(c=>c.card.name==='Exiled Force'));assert.ok(s.players[0].grave.some(c=>c.card.name==='Blue-Eyes White Dragon'));assert.ok(s.log.some(e=>e.kind==='attack'&&e.message.includes('Summoned Skull')));}finally{engine.destroyMatch(s);}
});
test('native AI pays Cyber-Stein, selects a Fusion, equips Megamorph and executes the lethal attack',async()=>{
  const d=decks();d[1].extra=[get('Blue-Eyes Ultimate Dragon')];let s=await engine.createMatch(d,{cards,seed:27,first:0,openingHands:[[],[get('Megamorph')]],initialFields:[{},{monsters:[{card:get('Cyber-Stein')}]}]});
  try{s=engine.applyAction(s,{type:'END'},0);s=play(s);assert.equal(s.winner,1,JSON.stringify(s.log.slice(-12).map(e=>e.message)));assert.equal(s.players[1].lp,3000);assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Blue-Eyes Ultimate Dragon'));assert.ok(s.log.some(e=>e.kind==='activate'&&e.message.includes('Megamorph')));}finally{engine.destroyMatch(s);}
});
