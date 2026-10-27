import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {command,advanceBattle} from './battle-fixtures.js';
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;},body=(name,props={})=>({card:get(name),...props});
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>pack});
const game=(initialFields,{hands=[[],[]],first=0,lp=8000}={})=>engine.createMatch([0,1].map(()=>({name:'Effects regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,seed:33,first,lp,openingHands:hands.map(h=>h.map(get)),initialFields});
const resolve=state=>{for(let n=0;n<120;n++){if(!state.window&&!state.choice)return state;const side=state.actions[0].length?0:1,action=state.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(state,side);assert.ok(action);state=engine.applyAction(state,action,side);}assert.fail('Effects did not settle');};

test('multiple mandatory Archfiend upkeeps allow ordering, then pay once each',async()=>{
  let state=await game([{monsters:[body('Shadowknight Archfiend'),body('Shadowknight Archfiend')],banished:[body('Perfect Machine King')]},{}]);
  try{
    assert.equal(state.phase,'standby');assert.equal(state.window.forced,true);assert.equal(state.actions[0].filter(a=>a.type==='ACTIVATE').length,2);
    state=command(engine,state,'ACTIVATE',0,'Shadowknight Archfiend');state=resolve(state);
    assert.equal(state.phase,'main1');assert.equal(state.window,null);assert.equal(state.choice,null);assert.equal(state.players[0].lp,6200);
    const paid=state.log.filter(e=>e.kind==='cost'&&/required upkeep/.test(e.message));assert.equal(paid.length,2);assert.ok(paid.every(e=>/Shadowknight Archfiend/.test(e.message)));
    assert.ok(state.log.some(e=>e.effectNotice?.card.name==='Shadowknight Archfiend'));
    assert.ok(!state.log.some(e=>e.effectNotice?.card.name==='Perfect Machine King'));
    state=command(engine,state,'END',0);state=resolve(state);assert.equal(state.players[0].lp,6200,'No upkeep on opponent’s turn');
    state=command(engine,state,'END',1);state=resolve(state);assert.equal(state.players[0].lp,4400,'Once per Archfiend on next own Standby');
  }finally{engine.destroyMatch(state);}
});
test('unpayable required upkeep destroys the Archfiend and Pandemonium replaces the payment',async()=>{
  let state=await game([{monsters:[body('Shadowknight Archfiend')]},{}],{lp:500});
  try{
    assert.equal(state.players[0].lp,500);assert.equal(state.players[0].monsters.filter(Boolean).length,0);assert.ok(state.players[0].grave.some(c=>c.card.name==='Shadowknight Archfiend'));
    assert.ok(state.log.some(e=>e.effectNotice?.text.includes('could not be paid')));
  }finally{engine.destroyMatch(state);}
  state=await game([{monsters:[body('Shadowknight Archfiend')],field:[body('Pandemonium')]},{}]);
  try{state=resolve(state);assert.equal(state.phase,'main1');assert.equal(state.players[0].lp,8000);assert.equal(state.players[0].monsters.filter(Boolean).length,1);}finally{engine.destroyMatch(state);}
});
test('Perfect Machine King only gains its continuous bonus while face-up in the Monster Zone',async()=>{
  let state=await game([{monsters:[body('Perfect Machine King')]},{monsters:[body('Jinzo')]}]);
  try{const king=state.players[0].monsters[0];assert.equal(engine.stats(state,king).atk,3200);assert.ok(!state.actions.flat().some(a=>a.type==='ACTIVATE'&&a.uid===king.uid));assert.ok(!state.log.some(e=>e.effectNotice?.card.id===king.card.id));}finally{engine.destroyMatch(state);}
  state=await game([{banished:[body('Perfect Machine King')]},{monsters:[body('Jinzo')]}]);
  try{
    for(let n=0;n<3;n++){
      const king=state.players[0].banished[0];assert.equal(engine.stats(state,king).atk,2700);assert.ok(!state.actions.flat().some(a=>a.uid===king.uid));assert.ok(!state.log.some(e=>e.effectNotice?.card.id===king.card.id));
      state=command(engine,state,'END',state.active);state=resolve(state);
    }
  }finally{engine.destroyMatch(state);}
});
test('Robbin’ Zombie arms on activation, then automatically mills after battle damage with the correct source',async()=>{
  let state=await game([{monsters:[body('Blue-Eyes White Dragon')],spells:[body("Robbin' Zombie",{faceUp:false})]},{}]);
  try{
    const deckCount=state.players[1].deck.length;
    state=resolve(command(engine,state,'ACTIVATE',0,"Robbin' Zombie"));
    assert.equal(state.players[1].deck.length,deckCount);assert.equal(state.players[1].grave.length,0);
    assert.ok(state.log.some(e=>e.effectNotice?.stage==='ready'&&/After your monster inflicts battle damage/.test(e.effectNotice.text)));
    state=resolve(command(engine,state,'END',0));state=resolve(command(engine,state,'END',1));
    const before=state.players[1].deck.length;
    state=command(engine,state,'NEXT',0);state=advanceBattle(engine,state,s=>s.actions[0].some(a=>a.type==='ATTACK'));
    state=command(engine,state,'ATTACK',0);state=advanceBattle(engine,state,s=>s.players[1].grave.length===1&&!s.choice&&!s.window);
    assert.equal(state.players[1].lp,5000);assert.equal(state.players[1].deck.length,before-1);
    assert.ok(state.players[0].spells[0].faceUp);
    assert.ok(state.log.some(e=>e.kind==='leave'&&/by Robbin' Zombie.*AI’s Graveyard/.test(e.message)));
    assert.ok(state.log.some(e=>e.effectNotice?.stage==='resolve'&&e.effectNotice.card.name==="Robbin' Zombie"&&/AI’s Graveyard/.test(e.effectNotice.text)));
  }finally{engine.destroyMatch(state);}
});
test('a negated Continuous Trap never applies its battle-damage effect',async()=>{
  let state=await game([{monsters:[body('Blue-Eyes White Dragon'),body('Jinzo')],spells:[body("Robbin' Zombie")]},{}],{first:1});
  try{
    state=resolve(command(engine,state,'END',1));state=command(engine,state,'NEXT',0);state=advanceBattle(engine,state,s=>s.actions[0].some(a=>a.type==='ATTACK'));
    state=command(engine,state,'ATTACK',0);state=advanceBattle(engine,state,s=>s.players[1].lp<8000&&!s.choice&&!s.window);
    assert.equal(state.players[1].grave.length,0);assert.ok(!state.log.some(e=>e.kind==='activate'&&/Robbin/.test(e.message)));
  }finally{engine.destroyMatch(state);}
});
test('a mandatory trigger still asks the player for its actual search target',async()=>{
  let state=await game([{monsters:[body('Sangan')]},{}],{hands:[['Dark Hole'],[]]});
  try{
    state=command(engine,state,'ACTIVATE',0,'Dark Hole');state=advanceBattle(engine,state,s=>s.choice?.side===0&&s.actions[0].some(a=>a.target&&engine.findCard(s,a.target)?.card.name==='Mystical Elf'));
    assert.equal(state.players[0].hand.filter(c=>c.card.name==='Mystical Elf').length,0,'Search is not selected on the player’s behalf');
    assert.ok(state.log.some(e=>e.kind==='activate'&&/Sangan/.test(e.message)));assert.ok(!state.window?.forced);
    state=resolve(state);assert.ok(state.players[0].hand.some(c=>c.card.name==='Mystical Elf'));
  }finally{engine.destroyMatch(state);}
});

test('Archfiend targeting protection rolls automatically and its battle damage is halved',async()=>{
  let state=await game([{}, {monsters:[body('Shadowknight Archfiend')]}],{hands:[['Tribute to the Doomed','Mystical Elf'],[]]});
  try{
    state=resolve(command(engine,state,'ACTIVATE',0,'Tribute to the Doomed'));
    assert.ok(state.log.some(e=>/Shadowknight Archfiend · Dice roll:/.test(e.message)));
    assert.ok(state.log.some(e=>e.effectNotice?.card.name==='Shadowknight Archfiend'&&/targeting protection/.test(e.message)));
    assert.equal(state.phase,'main1');assert.equal(state.window,null);assert.equal(state.choice,null);
  }finally{engine.destroyMatch(state);}
  state=await game([{monsters:[body('Shadowknight Archfiend')]},{}],{first:1});
  try{
    state=resolve(command(engine,state,'END',1));state=command(engine,state,'NEXT',0);state=advanceBattle(engine,state,s=>s.actions[0].some(a=>a.type==='ATTACK'));
    state=command(engine,state,'ATTACK',0);state=advanceBattle(engine,state,s=>s.players[1].lp<8000&&!s.choice&&!s.window);
    assert.equal(state.players[1].lp,7000);
  }finally{engine.destroyMatch(state);}
});
test('resolution receipts include actual draws rather than reporting no visible change',async()=>{
  let state=await game([{},{}],{hands:[['Pot of Greed'],[]]});
  try{
    state=resolve(command(engine,state,'ACTIVATE',0,'Pot of Greed'));
    assert.ok(state.log.some(e=>e.effectNotice?.stage==='resolve'&&/drew 2 cards from Pot of Greed/.test(e.effectNotice.text)));
  }finally{engine.destroyMatch(state);}
});

for(const first of ['Shadowknight Archfiend','Terrorking Archfiend'])test(`required upkeep order decides which Archfiend survives when only one cost can be paid: ${first}`,async()=>{
  let state=await game([{monsters:[body('Shadowknight Archfiend'),body('Terrorking Archfiend')]},{}],{lp:1000});
  try{
    assert.equal(state.window.forced,true);state=resolve(command(engine,state,'ACTIVATE',0,first));
    assert.deepEqual(state.players[0].monsters.filter(Boolean).map(c=>c.card.name),[first]);assert.equal(state.players[0].lp,first==='Shadowknight Archfiend'?100:200);
    assert.ok(state.log.some(l=>/required upkeep/.test(l.message)&&new RegExp(first).test(l.message)));
  }finally{engine.destroyMatch(state);}
});
