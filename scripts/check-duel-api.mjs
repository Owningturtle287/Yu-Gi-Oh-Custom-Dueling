import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCard } from '../src/core.js';
import { loadCards } from '../src/cards.js';
import { supportedPool, ERA_END } from '../src/duel/catalog.js';
import { defaultSide, eligibleSets, generateDeck, validateDuelDeck, expandDeck, loadSets } from '../src/duel/decks.js';
import { createNativeBackend } from '../src/duel/native-engine.js';
import { loadNativeRules } from '../src/duel/native-loader.js';
const rules=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const {createMatch,legalActions,applyAction,chooseAIAction,destroyMatch}=createNativeBackend({rules:()=>rules});

// Optional local snapshots make engine debugging repeatable without API traffic.
const cards=process.env.DUEL_CARD_SNAPSHOT?JSON.parse(await readFile(process.env.DUEL_CARD_SNAPSHOT,'utf8')).data.map(normalizeCard):(await loadCards()).cards;
const sets=process.env.DUEL_SET_SNAPSHOT?JSON.parse(await readFile(process.env.DUEL_SET_SNAPSHOT,'utf8')).filter(s=>s.tcg_date&&s.tcg_date<=ERA_END).map(s=>({name:s.set_name,date:s.tcg_date})):(await loadSets()).sets;
assert.ok(cards.length>10000);
const era=cards.filter(c=>c.tcgDate&&c.tcgDate<=ERA_END),pool=supportedPool(cards),available=eligibleSets(cards,sets,defaultSide()).filter(s=>!s.problem);
assert.ok(era.length>500&&pool.length>300&&available.length>=5);
const sources=[{...defaultSide(),source:'cards'},...available.map(set=>({...defaultSide(),source:'set',set:set.name}))];
const monsterTypes=[...new Set(pool.filter(c=>c.type.includes('Monster')).map(c=>c.race))];
let generated=0;
for(const settings of [...sources,...monsterTypes.map(race=>({...defaultSide(),race}))]){
  try{
    const deck=generateDeck(cards,settings,sets,++generated);
    assert.deepEqual(validateDuelDeck(deck,cards,settings),[]);
    if(settings.source==='set')assert.ok(deck.sections.main.every(e=>e.card.setNames.includes(settings.set)));
  }catch(error){if(!/fewer than 40|at least 16/.test(error.message))throw error;}
}
let completed=0,stepsTotal=0;const recent=[];
const exercised=new Set();
for(let seed=1;seed<=40;seed++){
  const settings=sources[seed%sources.length];
  const decks=[generateDeck(cards,settings,sets,seed),generateDeck(cards,sources[(seed+3)%sources.length],sets,seed+100)];
  let state=await createMatch(decks.map(deck=>expandDeck(deck,cards)),{seed,first:seed%2,lp:seed%2?4000:8000,cards}),steps=0;
  const total=decks.reduce((sum,d)=>sum+d.sections.main.reduce((n,e)=>n+e.quantity,0)+d.sections.extra.reduce((n,e)=>n+e.quantity,0),0);
  while(state.winner===null&&steps++<2500){
    const side=legalActions(state,0).length?0:1,action=chooseAIAction(state,side,['easy','normal','hard'][seed%3]);
    assert.ok(action,`Match ${seed} stalled at ${state.phase}`);
    recent.push({turn:state.turn,phase:state.phase,side,type:action.type,label:action.label,name:state.players.flatMap(p=>[...p.hand,...p.monsters,...p.spells,...p.extra,...p.grave]).find(c=>c?.uid===action.uid)?.card.name});if(recent.length>12)recent.shift();
    state=applyAction(state,action,side);
    if(action.uid&&['ACTIVATE','EFFECT'].includes(action.type)){
      const values=state.players.flatMap(p=>[...p.hand,...p.deck,...p.monsters,...p.spells,...p.grave,...p.banished,...p.extra,p.field]);
      const card=values.find(c=>c?.uid===action.uid);if(card)exercised.add(card.card.name);
    }
    const instances=state.players.flatMap(p=>[...p.hand,...p.deck,...p.monsters.filter(Boolean),...p.spells.filter(Boolean),...p.grave,...p.banished,...p.extra,...(p.field?[p.field]:[])]);
    // Tokens and effects such as Metamorphosis change card-instance counts.

    assert.equal(new Set(instances.map(c=>c.uid)).size,instances.length);
  }
  assert.notEqual(state.winner,null,`Match ${seed} did not finish in ${steps} actions: ${JSON.stringify({choice:state.choice?.title,recent})}`);
  destroyMatch(state);completed++;stepsTotal+=steps;
}
console.log(JSON.stringify({archive:cards.length,through2004:era.length,supported:pool.length,playableSets:available.map(s=>({name:s.name,cards:s.remaining.length})),generationChecks:generated,completedMatches:completed,actions:stepsTotal,effectsExercised:[...exercised].sort()},null,2));
