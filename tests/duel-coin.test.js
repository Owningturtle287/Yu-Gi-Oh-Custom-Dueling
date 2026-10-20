import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {createResponsePolicy} from '../src/duel/responses.js';
import {damageDuel,advanceBattle} from './battle-fixtures.js';

const rules=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const record=rules.records.get(94773007),jirai={id:94773007,name:record.name,type:'Effect Monster',level:4,atk:2200,def:100,race:'Insect',attribute:'EARTH',desc:'When this card declares an attack, call a coin. A wrong call halves your LP.',card_images:[]};
const cards=[...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard),jirai];

for(const side of [0,1])for(const called of ['Heads','Tails'])test(`Jirai Gumo: side ${side} calling ${called} shows the actual core face and only halves LP on a wrong call`,async()=>{
  const seen=new Set();
  for(let seed=1;seed<=16&&seen.size<2;seed++){
    // Cover both faces with full-width deterministic native RNG states. Small
    // initial words can share the same first toss before other random effects.
    const raw=[],lib={...rules.lib,
      createDuel(options){return rules.lib.createDuel({...options,seed:[0,1,2,3].map(i=>BigInt.asUintN(64,BigInt(seed*4+i)*0x9e3779b97f4a7c15n))});},
      duelGetMessage(handle){const messages=rules.lib.duelGetMessage(handle);raw.push(...messages.filter(m=>m.type===rules.module.OcgMessageType.TOSS_COIN));return messages;}};
    const engine=createNativeBackend({rules:()=>({...rules,lib})});let state;
    try{
      state=await damageDuel(engine,cards,{defendingSide:1-side,attacker:'Jirai Gumo',traps:[],faceDown:false,seed});
      state=advanceBattle(engine,state,s=>s.choice?.selectionType==='select_option');
      const policy=createResponsePolicy();policy.passTurn(state);assert.equal(policy.action(state,state.actions[side]),null,'A mandatory coin call is never auto-passed');
      const before=state.players[side].lp,action=state.actions[side].find(a=>a.coinCall===called);assert.ok(action);
      state=engine.applyAction(state,action,side);
      state=advanceBattle(engine,state,s=>s.log.some(e=>e.coinNotice));
      assert.equal(raw.length,1);assert.equal(typeof raw[0].results[0],'boolean');
      const face=raw[0].results[0]?'Heads':'Tails',receipt=state.log.find(e=>e.coinNotice);seen.add(face);
      assert.deepEqual(receipt.coinNotice.results,[face]);assert.equal(receipt.coinNotice.called,called);
      assert.equal(receipt.coinNotice.source.name,'Jirai Gumo');
      assert.equal(state.players[side].lp,called===face?before:Math.ceil(before/2));
      assert.match(receipt.message,new RegExp(`called ${called}.*${face}.*${called===face?'correct':'wrong'} call`,'i'));
      const saved=engine.exportMatch(state),restored=await engine.restoreMatch(saved,{cards});
      try{assert.equal(restored.players[side].lp,state.players[side].lp);assert.deepEqual(restored.log.find(e=>e.coinNotice)?.coinNotice,receipt.coinNotice);}finally{engine.destroyMatch(restored);}
    }finally{engine.destroyMatch(state);}
  }
  assert.deepEqual([...seen].sort(),['Heads','Tails'],'Both correct and wrong calls are exercised against actual native tosses');
});
