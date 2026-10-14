import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadNativeRules } from '../src/duel/native-loader.js';
import { createNativeBackend } from '../src/duel/native-engine.js';
import { normalizeCard, filterCards, createDeck, addCard, exportJSON, importJSON } from '../src/core.js';
import { NATIVE_CARD_IDS } from '../src/duel/rules-manifest.js';
import { support } from '../src/duel/catalog.js';
import { generateDeck, expandDeck, defaultSide } from '../src/duel/decks.js';
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>pack}),get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;};
const body=name=>({card:get(name)});
const game=(hands=[[],[]],initialFields=null)=>engine.createMatch([0,1].map(()=>({name:'Rules test',main:Array(40).fill(get('Mystical Elf')),extra:[get('Flame Swordsman'),get('XYZ-Dragon Cannon')]})),{seed:17,cards,openingHands:hands.map(h=>h.map(get)),initialFields});
const move=(state,type,name,side=0)=>{const action=engine.legalActions(state,side).find(a=>a.type===type&&(!name||engine.findCard(state,a.uid)?.card.name===name));assert.ok(action,`Legal ${type} ${name||''}`);return engine.applyAction(state,action,side);};
function settle(state){let steps=0;while(state.choice||state.window){assert.ok(steps++<100,'Effect prompt must finish');const side=state.actions[0].length?0:1;state=engine.applyAction(state,engine.chooseAIAction(state,side,'hard'),side);}return state;}
const names=state=>state.players[0].monsters.filter(Boolean).map(c=>c.card.name);

test('the pinned pack initializes every early card script, including aliased printings, without script errors',()=>{
  const {lib,module:m,scripts,records}=pack,errors=[];
  const handle=lib.createDuel({flags:m.OcgDuelMode.MODE_MR5,seed:[1n,2n,3n,4n],team1:{startingLP:8000,startingDrawCount:0,drawCountPerTurn:1},team2:{startingLP:8000,startingDrawCount:0,drawCountPerTurn:1},cardReader:code=>records.get(code),scriptReader:name=>scripts[name]||null,errorHandler:(_type,text)=>errors.push(text)});
  try{
    lib.loadScript(handle,'constant.lua',scripts['constant.lua']);lib.loadScript(handle,'utility.lua',scripts['utility.lua']);
    let count=0;for(const id of NATIVE_CARD_IDS){const code=id===81480461?81480460:id;if(!records.has(code))continue;lib.duelNewCard(handle,{team:0,controller:0,duelist:0,code,location:m.OcgLocation.DECK,sequence:1,position:m.OcgPosition.FACEDOWN_DEFENSE});count++;}
    assert.ok(count>2000);assert.deepEqual(errors,[]);
  }finally{lib.destroyDuel(handle);}
});
test('native opening automatically reaches Main 1, retains full card queries and rejects stale responses',async()=>{
  let state=await game([['Mystical Elf'],[]]);
  try{assert.equal(state.phase,'main1');assert.equal(state.players[0].hand[0].card.name,'Mystical Elf');const stale=state.actions[0].find(a=>a.type==='SUMMON'&&!a.set);state=engine.applyAction(state,stale,0);assert.deepEqual(names(state),['Mystical Elf']);assert.throws(()=>engine.applyAction(state,stale,0),/no longer legal/);}finally{engine.destroyMatch(state);}
});
test('Ritual Summoning pays level requirements and puts both the ritual Spell and tribute in the Graveyard',async()=>{
  let state=await game([['Black Luster Soldier','Black Luster Ritual','Blue-Eyes White Dragon'],[]]);
  try{state=settle(move(state,'ACTIVATE','Black Luster Ritual'));assert.deepEqual(names(state),['Black Luster Soldier']);assert.deepEqual(new Set(state.players[0].grave.map(c=>c.card.name)),new Set(['Black Luster Ritual','Blue-Eyes White Dragon']));}finally{engine.destroyMatch(state);}
});
test('Fusion procedures use actual materials and XYZ contact Fusion banishes all three components',async()=>{
  let state=await game([['Polymerization','Flame Manipulator','Masaki the Legendary Swordsman'],[]]);
  try{state=settle(move(state,'ACTIVATE','Polymerization'));assert.deepEqual(names(state),['Flame Swordsman']);assert.equal(state.players[0].grave.length,3);}finally{engine.destroyMatch(state);}
  state=await game([[],[]],[{monsters:['X-Head Cannon','Y-Dragon Head','Z-Metal Tank'].map(body)},{}]);
  try{state=settle(move(state,'SUMMON','XYZ-Dragon Cannon'));assert.deepEqual(names(state),['XYZ-Dragon Cannon']);assert.equal(state.players[0].banished.length,3);}finally{engine.destroyMatch(state);}
});
test('Spirit monsters return during the End Phase; Chaos summons banish LIGHT and DARK materials',async()=>{
  let state=await game([['Asura Priest'],[]]);
  try{state=move(state,'SUMMON','Asura Priest');state=settle(move(state,'END'));assert.ok(state.players[0].hand.some(c=>c.card.name==='Asura Priest'));assert.equal(names(state).length,0);}finally{engine.destroyMatch(state);}
  state=await game([['Black Luster Soldier - Envoy of the Beginning'],[]],[{grave:['Mystical Elf','Summoned Skull'].map(body)},{}]);
  try{state=settle(move(state,'SUMMON','Black Luster Soldier - Envoy of the Beginning'));assert.deepEqual(names(state),['Black Luster Soldier - Envoy of the Beginning']);assert.equal(state.players[0].banished.length,2);}finally{engine.destroyMatch(state);}
});
test('Union equipment, Toon costs, spell counters, and scapegoat tokens use native effects',async()=>{
  let state=await game([[],[]],[{monsters:['X-Head Cannon','Y-Dragon Head'].map(body)},{}]);
  try{state=settle(move(state,'ACTIVATE','Y-Dragon Head'));assert.equal(state.players[0].spells.filter(Boolean).length,1);assert.equal(engine.stats(state,state.players[0].monsters.find(Boolean)).atk,2200);}finally{engine.destroyMatch(state);}
  state=await game([['Toon World','Toon Mermaid'],[]]);
  try{state=settle(move(state,'ACTIVATE','Toon World'));assert.equal(state.players[0].lp,7000);state=settle(move(state,'SUMMON','Toon Mermaid'));assert.deepEqual(names(state),['Toon Mermaid']);}finally{engine.destroyMatch(state);}
  state=await game([['Breaker the Magical Warrior'],[]],[{}, {spells:[{...body('Mirror Force'),faceUp:false}]}]);
  try{state=settle(move(state,'SUMMON','Breaker the Magical Warrior'));assert.equal(engine.stats(state,state.players[0].monsters.find(Boolean)).atk,1900);state=settle(move(state,'ACTIVATE','Breaker the Magical Warrior'));assert.equal(state.players[1].grave.length,1);assert.equal(engine.stats(state,state.players[0].monsters.find(Boolean)).atk,1600);}finally{engine.destroyMatch(state);}
  state=await game([['Scapegoat'],[]]);
  try{state=settle(move(state,'ACTIVATE','Scapegoat'));assert.equal(state.players[0].monsters.filter(Boolean).length,4);assert.ok(state.players[0].monsters.filter(Boolean).every(c=>c.position==='defense'));}finally{engine.destroyMatch(state);}
});
test('all three God Cards remain searchable today and are excluded from the 2002 playable pool without fabricated dates',()=>{
  for(const name of ['Obelisk the Tormentor','Slifer the Sky Dragon','The Winged Dragon of Ra']){assert.equal(filterCards(cards,{query:name}).length,1);assert.equal(filterCards(cards,{query:name,year:2002}).length,0);assert.equal(support(get(name)).ok,false);}
  const undated={...get('Mystical Elf'),id:123456,tcgDate:null,ocgDate:null};assert.equal(filterCards([undated]).length,1);assert.equal(filterCards([undated],{year:2004}).length,0);
  const regional={...undated,misc_info:[{tcg_date:'2005-02-31',ocg_date:'2004-12-31'},{tcg_date:'2005-01-01'}]};const normalized=normalizeCard(regional);assert.equal(normalized.tcgDate,'2005-01-01');assert.equal(filterCards([normalized],{year:2004,releaseBasis:'tcg'}).length,0);assert.equal(filterCards([normalized],{year:2004,releaseBasis:'ocg'}).length,1);assert.equal(filterCards([normalized],{year:2004,releaseBasis:'earliest'}).length,1);
  let deck={...createDeck('OCG'),releaseYear:2004,releaseBasis:'ocg'};deck=addCard(deck,normalized);assert.equal(importJSON(exportJSON(deck)).releaseBasis,'ocg');
});
test('seeded full-rule AI matches finish with unique field identities and no illegal responses',async()=>{
  const pool=cards.filter(c=>support(c).ok);
  for(let seed=1;seed<=8;seed++){
    const decks=[0,1].map(i=>({...expandDeck(generateDeck(pool,defaultSide(),[],seed*91+i),pool),name:'AI test'}));
    let state=await engine.createMatch(decks,{seed,cards:pool});
    try{let steps=0;while(state.winner===null&&steps++<2500){const side=state.actions[0].length?0:1,action=engine.chooseAIAction(state,side,seed%2?'normal':'hard');assert.ok(action);state=engine.applyAction(state,action,side);const all=state.players.flatMap(p=>['deck','hand','monsters','spells','extra','grave','banished'].flatMap(z=>p[z].filter(Boolean)).concat(p.field?[p.field]:[]));assert.equal(new Set(all.map(c=>c.uid)).size,all.length);}assert.notEqual(state.winner,null,`Seed ${seed} stalled`);}finally{engine.destroyMatch(state);}
  }
});
test('attribute and type declarations finish after the required selection, and reorder prompts preserve legal permutations',async()=>{
  for(const name of ['DNA Surgery','DNA Transplant']){
    let state=await game([[],[]],[{monsters:[body('Mystical Elf')],spells:[{...body(name),faceUp:false}]},{}]);
    try{state=move(state,'ACTIVATE',name);assert.match(state.choice.title,/Declare/);state=settle(state);assert.equal(state.choice,null);assert.ok(state.players[0].spells.find(Boolean).faceUp);}finally{engine.destroyMatch(state);}
  }
  let state=await game([[],[]],[{monsters:[{...body('Big Eye'),defense:true,faceUp:false}]},{}]);
  try{state=settle(move(state,'POSITION','Big Eye'));assert.equal(state.choice,null);assert.ok(state.players[0].deck.length>=35);}finally{engine.destroyMatch(state);}
});
test('a full-rule Exodia opening ends the duel and public hand effects are queried without exposing hidden stats to AI',async()=>{
  let state=await engine.createMatch([{name:'Exodia',main:['Exodia the Forbidden One','Left Arm of the Forbidden One','Right Arm of the Forbidden One','Left Leg of the Forbidden One','Right Leg of the Forbidden One'].map(get),extra:[]},{name:'Other',main:Array(40).fill(get('Mystical Elf')),extra:[]}],{seed:2,cards});
  try{assert.equal(state.winner,0);assert.equal(engine.legalActions(state,1).length,0);}finally{engine.destroyMatch(state);}
  state=await game([[],['Blue-Eyes White Dragon']],[{spells:[{...body('The Eye of Truth'),faceUp:false}]},{}]);
  try{state=settle(move(state,'ACTIVATE','The Eye of Truth'));assert.equal(state.players[1].hand[0].public,true);}finally{engine.destroyMatch(state);}
});

async function resolvedTributeToDoomed(){
  let state=await engine.createMatch([0,1].map(()=>({name:'Regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{seed:23,first:1,cards,openingHands:[['Tribute to the Doomed','Summoned Skull'].map(get),[]],initialFields:[{}, {monsters:[body('Mystical Elf')]}]});
  // The AI goes first, so the human can legally use Battle Phase on turn 2.
  state=engine.applyAction(state,state.actions[1].find(a=>a.type==='END'),1);
  state=settle(move(state,'ACTIVATE','Tribute to the Doomed'));
  assert.equal(state.phase,'main1');assert.equal(state.active,0);assert.equal(state.choice,null);
  assert.equal(state.players[1].monsters.filter(Boolean).length,0);
  assert.ok(state.players[0].grave.some(c=>c.card.name==='Tribute to the Doomed'));
  assert.ok(state.players[0].grave.some(c=>c.card.name==='Summoned Skull'));
  return state;
}
test('phase toolbar commands resolve current legal response IDs after Tribute to the Doomed',async()=>{
  let state=await resolvedTributeToDoomed();
  try{
    assert.ok(engine.legalActions(state,0).some(a=>a.type==='NEXT'&&a.label==='Battle'));
    state=engine.applyAction(state,{type:'NEXT'},0);assert.equal(state.phase,'battle');
    state=engine.applyAction(state,{type:'NEXT'},0);assert.equal(state.phase,'main2');
    state=engine.applyAction(state,{type:'END'},0);assert.equal(state.active,1);
  }finally{engine.destroyMatch(state);}
  state=await resolvedTributeToDoomed();
  try{state=engine.applyAction(state,{type:'END'},0);assert.equal(state.active,1);}finally{engine.destroyMatch(state);}
});
test('generic Pass uses the active chain response without bypassing a choice or accepting a stale ID',async()=>{
  let state=await game([['Pot of Greed'],[]],[{}, {spells:[{...body('Solemn Judgment'),faceUp:false}]}]);
  try{
    const stale=state.actions[0].find(a=>a.type==='END');
    state=move(state,'ACTIVATE','Pot of Greed');assert.equal(state.window?.priority,1);
    assert.throws(()=>engine.applyAction(state,{type:'NEXT'},0),/no longer legal/);
    assert.throws(()=>engine.applyAction(state,stale,0),/no longer legal/);
    state=engine.applyAction(state,{type:'PASS'},1);assert.equal(state.window,null);assert.equal(state.phase,'main1');
    state=engine.applyAction(state,{type:'END'},0);assert.equal(state.active,1);
  }finally{engine.destroyMatch(state);}
});
