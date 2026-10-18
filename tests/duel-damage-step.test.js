import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {responseOffer} from '../src/duel/responses.js';
import {planMotion} from '../src/duel/motion.js';
import {damageDuel,advanceBattle,command,selectCard} from './battle-fixtures.js';
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>pack});
const activate=(s,name='Castle Walls',side=0)=>command(engine,s,'ACTIVATE',side,name);
const names=(s,side=0)=>s.actions[side].filter(a=>a.type==='ACTIVATE').map(a=>engine.findCard(s,a.uid)?.card.name);
const revealed=s=>s.battleStep==='beforeCalculation'&&s.window?.priority===0;
const completed=s=>!s.pending&&s.battleStep===null;

test('Castle Walls cannot target the still face-down defender at attack declaration',async()=>{
  let s=await damageDuel(engine,cards);try{
    const defender=s.pending.target;assert.equal(s.battleStep,'attack');assert.equal(engine.findCard(s,defender).faceUp,false);
    assert.equal(s.visualAction.type,'DECLARE_ATTACK');assert.ok(names(s).includes('Mirror Force'));
    s=activate(s);assert.ok(!s.choice.options.some(a=>a.target===defender),'A face-down monster is not a legal Castle Walls target');
  }finally{engine.destroyMatch(s);}
});
test('the revealed defender gains 500 DEF before calculation, survives the tie, and resets at turn end',async()=>{
  let s=await damageDuel(engine,cards);try{
    const declared=s,defender=s.pending.target,attacker=s.pending.uid;
    assert.equal(planMotion(s,s,s.visualAction).some(m=>m.type==='attack'),false,'Declaration is not the resolved strike');
    s=advanceBattle(engine,s,x=>x.battleStep==='start'&&x.window?.priority===0);
    assert.equal(engine.findCard(s,defender).faceUp,false);assert.ok(names(s).includes('Castle Walls'));assert.ok(!names(s).includes('Mirror Force'));assert.ok(!names(s).includes('Mystical Space Typhoon'));
    s=advanceBattle(engine,s,revealed);assert.equal(engine.findCard(s,defender).faceUp,true);
    const offer=responseOffer(s,s.actions[0]);assert.equal(offer.phase,'Before damage calculation');assert.match(offer.context,/Mystical Elf is face-up/);assert.doesNotMatch(offer.context,/declared an attack/);
    s=selectCard(engine,activate(s),defender);s=advanceBattle(engine,s,completed);
    assert.equal(engine.findCard(s,defender).currentStats.def,2500);assert.equal(s.players[0].grave.some(c=>c.uid===defender),false);
    assert.equal(s.visualAction.type,'ATTACK');assert.equal(s.visualAction.uid,attacker);
    const motions=planMotion(declared,s,s.visualAction);assert.equal(motions.filter(m=>m.type==='attack').length,1);
    const stat=s.log.find(e=>e.kind==='stats'&&/Castle Walls changes Mystical Elf: DEF 2000 → 2500/.test(e.message)),battle=s.log.find(e=>e.kind==='battle'&&/2500 ATK.*2500 DEF/.test(e.message));
    assert.ok(stat&&battle&&stat.id<battle.id);assert.equal(battle.battleNotice.defender.def,2500,'The paired presentation uses the post-Castle Walls calculation');assert.ok(s.log.find(e=>e.battleStep==='beforeCalculation').id<stat.id);
    s=advanceBattle(engine,s,x=>x.turn===3);assert.equal(engine.findCard(s,defender).currentStats.def,2000);
  }finally{engine.destroyMatch(s);}
});
test('two Castle Walls chained before calculation resolve newest first and both bonuses count',async()=>{
  let s=await damageDuel(engine,cards,{traps:['Castle Walls','Castle Walls']});try{
    s=advanceBattle(engine,s,revealed);const defender=s.pending.target;
    s=selectCard(engine,activate(s),defender);assert.equal(s.chain.length,1);
    s=selectCard(engine,activate(s),defender);s=advanceBattle(engine,s,completed);
    assert.equal(engine.findCard(s,defender).currentStats.def,3000);assert.equal(s.players[1].lp,7500);
    assert.deepEqual(s.log.filter(e=>e.kind==='effect'&&/Resolving Castle Walls/.test(e.message)).map(e=>e.message.match(/link (\d)/)[1]),['2','1']);
    assert.equal(s.log.filter(e=>e.kind==='stats').length,2);assert.ok(s.log.some(e=>/2500 ATK.*3000 DEF/.test(e.message)));
  }finally{engine.destroyMatch(s);}
});
test('Flip effects wait until after calculation and a battle-destroyed Flip monster is not sent away early',async()=>{
  for(const boost of [false,true]){
    let s=await damageDuel(engine,cards,{defender:'Man-Eater Bug',attacker:'Mystical Elf',traps:['Castle Walls']});try{
      s=advanceBattle(engine,s,revealed);const defender=s.pending.target,attacker=s.pending.uid;
      if(boost)s=selectCard(engine,activate(s),defender);
      s=advanceBattle(engine,s,x=>x.choice?.trigger?.uid===defender);
      assert.equal(s.battleStep,'afterCalculation');assert.ok(s.players[0].monsters.some(c=>c?.uid===defender),'Destroyed-by-battle status does not send it away before Flip resolution');
      const battle=s.log.find(e=>e.kind==='battle'),flip=s.log.find(e=>e.kind==='activate'&&/Man-Eater Bug/.test(e.message));assert.ok(battle.id<flip.id);
      assert.equal(s.players[1].lp,boost?7700:8000);s=selectCard(engine,s,attacker);s=advanceBattle(engine,s,completed);
      assert.ok(s.players[1].grave.some(c=>c.uid===attacker));assert.equal(s.players[0].grave.some(c=>c.uid===defender),!boost);
    }finally{engine.destroyMatch(s);}
  }
});
test('Kuriboh can respond during calculation while Castle Walls cannot, and prevention resolves before the strike',async()=>{
  let s=await damageDuel(engine,cards,{defense:false,faceDown:false,traps:['Castle Walls'],hand:['Kuriboh']});try{
    s=advanceBattle(engine,s,x=>x.battleStep==='calculation'&&names(x).includes('Kuriboh'));
    assert.ok(!names(s).includes('Castle Walls'));assert.notEqual(s.visualAction?.type,'ATTACK');
    s=activate(s,'Kuriboh');s=advanceBattle(engine,s,completed);
    assert.equal(s.players[0].lp,8000);assert.equal(s.visualAction.type,'ATTACK');assert.ok(s.players[0].grave.some(c=>c.card.name==='Kuriboh'));
  }finally{engine.destroyMatch(s);}
});
test('a Counter Trap can negate Castle Walls in the Damage Step before its DEF bonus applies',async()=>{
  let s=await damageDuel(engine,cards,{traps:['Castle Walls'],opponentTraps:['Solemn Judgment']});try{
    s=advanceBattle(engine,s,revealed);const defender=s.pending.target;s=selectCard(engine,activate(s),defender);
    assert.equal(s.window.priority,1);assert.ok(names(s,1).includes('Solemn Judgment'));
    s=activate(s,'Solemn Judgment',1);s=advanceBattle(engine,s,completed);
    assert.equal(s.players[1].lp,4000);assert.ok(s.players[0].grave.some(c=>c.uid===defender));assert.ok(!s.log.some(e=>e.kind==='stats'&&/2500/.test(e.message)));
    assert.ok(s.log.some(e=>/Castle Walls.*was negated/.test(e.message)));assert.ok(s.log.some(e=>e.kind==='battle'&&/2000 DEF/.test(e.message)));
  }finally{engine.destroyMatch(s);}
});
test('AI waits for its defender to be revealed and targets its own defender with Castle Walls',async()=>{
  let s=await damageDuel(engine,cards,{defendingSide:1,traps:['Castle Walls']});try{
    assert.equal(engine.chooseAIAction(s,1,'hard').type,'PASS');
    s=advanceBattle(engine,s,x=>x.battleStep==='beforeCalculation'&&x.window?.priority===1);
    const defender=s.pending.target,activateAction=engine.chooseAIAction(s,1,'hard');assert.equal(activateAction.type,'ACTIVATE');
    s=engine.applyAction(s,activateAction,1);const targetAction=engine.chooseAIAction(s,1,'hard');assert.equal(targetAction.target,defender);
    s=engine.applyAction(s,targetAction,1);s=engine.applyAction(s,s.actions[1].find(a=>a.finish),1);s=advanceBattle(engine,s,completed);
    assert.equal(engine.findCard(s,defender).currentStats.def,2500);assert.equal(s.players[1].grave.some(c=>c.uid===defender),false);
  }finally{engine.destroyMatch(s);}
});
