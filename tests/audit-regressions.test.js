import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeck,STORAGE_KEY,readDecks,readDeckStore,saveDeck,deleteSavedDeck,mergeSavedDecks,normalizeCard} from '../src/core.js';
import {browserCardCache} from '../src/cards.js';
import {normalizeSoloConfig} from '../src/duel/config.js';
import {ERA_END} from '../src/duel/catalog.js';
import {DUEL_SAVES_KEY,inspectDuelSaves,saveDuel,deleteDuelSave} from '../src/duel/saves.js';
import {readRecoveries,writeRecovery,removeRecovery,exportDuelRecovery,RECOVERY_PREFIX} from '../src/duel/recovery.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {battlePlan} from '../src/duel/ai-combat.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
const memory=()=>{const values=new Map();return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('bulk deck import rebases on current storage and preserves rejected records through writes',()=>{
 const storage=memory(),one=createDeck('First','one'),two=createDeck('Other tab','two'),bad={...createDeck('Damaged','bad'),mechanics:null};
 storage.setItem(STORAGE_KEY,JSON.stringify({version:1,decks:[one,bad]}));assert.deepEqual(readDecks(storage).map(d=>d.id),['one']);
 saveDeck(storage,two);mergeSavedDecks(storage,[createDeck('Imported','three')]);assert.deepEqual(new Set(readDecks(storage).map(d=>d.id)),new Set(['one','two','three']));
 deleteSavedDeck(storage,'one');assert.deepEqual(readDeckStore(storage).rejectedDecks,[bad]);
 storage.setItem(STORAGE_KEY,'{damaged');assert.throws(()=>mergeSavedDecks(storage,[one]));assert.equal(storage.getItem(STORAGE_KEY),'{damaged');
});
test('malformed nested Solo preferences recover to usable defaults',()=>{
 for(const sides of [null,{},[null,null],['bad',12],[{cutoff:2006},{cutoff:{}}]]){const config=normalizeSoloConfig({sides,aiSpeed:{},first:[],lp:-1});assert.equal(config.sides.length,2);assert.ok(config.sides.every(side=>side.cutoff===ERA_END));assert.equal(config.lp,8000);assert.equal(config.aiSpeed,'normal');}
 const config=normalizeSoloConfig({eraEnd:ERA_END,sides:[{cutoff:'2003-05-01'},{cutoff:ERA_END}],animations:false,learning:false});assert.equal(config.sides[0].cutoff,'2003-05-01');assert.equal(config.animations,false);assert.equal(config.learning,false);
});
test('damaged manual saves are preserved and valid siblings remain usable',()=>{
 const storage=memory(),entry={id:'new',replay:{version:1}},bad={id:'bad',replay:null};
 storage.setItem(DUEL_SAVES_KEY,'{damaged');assert.ok(inspectDuelSaves(storage).error);assert.throws(()=>saveDuel(storage,entry));assert.throws(()=>deleteDuelSave(storage,'x'));assert.equal(storage.getItem(DUEL_SAVES_KEY),'{damaged');
 storage.setItem(DUEL_SAVES_KEY,JSON.stringify([bad]));saveDuel(storage,entry);assert.deepEqual(inspectDuelSaves(storage).saves,[entry]);deleteDuelSave(storage,'new');assert.deepEqual(JSON.parse(storage.getItem(DUEL_SAVES_KEY)),[bad]);
});
test('automatic checkpoints coexist across tabs without consuming manual slots or discarding corrupt bytes',()=>{
 const storage=memory(),one={id:'tab-one',savedAt:1,replay:{version:1}},two={id:'tab-two',savedAt:2,replay:{version:1}};
 writeRecovery(storage,one);writeRecovery(storage,two);assert.deepEqual(readRecoveries(storage).entries,[two,one]);assert.equal(storage.getItem(DUEL_SAVES_KEY),null);
 storage.setItem(RECOVERY_PREFIX+'damaged','{bad');assert.throws(()=>writeRecovery(storage,{id:'damaged',replay:{version:1}}));assert.equal(readRecoveries(storage).rejected,1);assert.equal(JSON.parse(exportDuelRecovery(storage)).interruptedDuels[RECOVERY_PREFIX+'damaged'],'{bad');
 removeRecovery(storage,one.id);assert.deepEqual(readRecoveries(storage).entries,[two]);
});
test('archive cache retries a failed IndexedDB open and resets after a version change',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');let opens=0,closed=0,db;
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const request={error:Error('Transient failure')};queueMicrotask(()=>{if(++opens===1)request.onerror();else{db={close(){closed++;},transaction:()=>({objectStore:()=>({get(){const result={result:'cached'};queueMicrotask(()=>result.onsuccess());return result;}})})};request.result=db;request.onsuccess();}});return request;}}});
 try{const cache=browserCardCache();await assert.rejects(()=>cache.read(),/Transient/);assert.equal(await cache.read(),'cached');assert.equal(opens,2);db.onversionchange();assert.equal(closed,1);assert.equal(await cache.read(),'cached');assert.equal(opens,3);}finally{if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else delete globalThis.indexedDB;}
});
const raw=(await Promise.all(['rules-fixtures.json','era2006-fixtures.json','mechanics-audit-fixtures.json','audit-regressions-fixtures.json'].map(async file=>JSON.parse(await readFile(new URL(file,import.meta.url))).data))).flat();
const cards=[...new Map(raw.map(card=>[card.id,normalizeCard(card)])).values()],get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;};
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const decks=()=>[0,1].map(()=>({name:'Audit regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
const body=(name,extra={})=>({card:get(name),...extra});
const settle=(e,state)=>{for(let n=0;n<180&&(state.choice||state.window||state.reveals?.length);n++){const side=state.actions[0].length?0:1;state=e.applyAction(state,state.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(state,side,{variety:false}),side);}assert.ok(!state.choice&&!state.window);return state;};
const move=(e,s,type,name,side=0)=>{const a=s.actions[side].find(a=>a.type===type&&!a.set&&(!name||e.findCard(s,a.uid)?.card.name===name));assert.ok(a,type+' '+name);return e.applyAction(s,a,side);};
test('same-code cards retain physical identity through summoning, drawing, and a control change',async()=>{
 const e=createNativeBackend({rules:()=>pack});let s=await e.createMatch(decks(),{cards,seed:313,openingHands:[[get('Mystical Elf'),get('Mystical Elf'),get('Change of Heart'),get('Pot of Greed')],[]],initialFields:[{},{monsters:[body('Mystical Elf')]}]});
 try{s=settle(e,s);const selected=s.players[0].hand.find(c=>c.card.name==='Mystical Elf').uid,other=s.players[0].hand.filter(c=>c.card.name==='Mystical Elf')[1].uid,foe=s.players[1].monsters[0].uid;
 s=settle(e,move(e,s,'SUMMON','Mystical Elf'));assert.equal(s.players[0].monsters.find(Boolean).uid,selected);assert.ok(s.players[0].hand.some(c=>c.uid===other));
 const drawn=s.players[0].deck.slice(-2).map(c=>c.uid);s=settle(e,move(e,s,'ACTIVATE','Pot of Greed'));assert.ok(drawn.every(uid=>s.players[0].hand.some(c=>c.uid===uid)));
 s=settle(e,move(e,s,'ACTIVATE','Change of Heart'));assert.ok(s.players[0].monsters.some(c=>c?.uid===foe));assert.equal(s.players[1].monsters.filter(Boolean).length,0);
 const restored=await e.restoreMatch(e.exportMatch(s),{cards});e.destroyMatch(restored);
 }finally{e.destroyMatch(s);}
});
test('Spirit Barrier combat search removes the cleared blocker before forecasting direct damage',async()=>{
 const e=createNativeBackend({rules:()=>pack});let s=await e.createMatch(decks(),{cards,seed:313,first:1,lp:2800,openingHands:[[],[]],initialFields:[{monsters:[body('Blue-Eyes White Dragon'),body('Summoned Skull')]},{monsters:[body('Mystical Elf',{defense:true})],spells:[body('Spirit Barrier')]}]});
 try{s=settle(e,s);s=settle(e,move(e,s,'END',null,1));s=settle(e,move(e,s,'NEXT'));const before=structuredClone(s),plan=battlePlan(aiObservation(s,0),0);assert.equal(e.findCard(s,plan.first.uid).card.name,'Summoned Skull');assert.equal(plan.moves.reduce((n,m)=>n+m.outcome.enemyDamage,0),3000);assert.deepEqual(s,before);
 for(let n=0;n<2;n++){const a=e.chooseAIAction(s,0,{variety:false});assert.equal(a.type,'ATTACK');s=settle(e,e.applyAction(s,a,0));}assert.equal(s.winner,0);
 }finally{e.destroyMatch(s);}
});
test('Ultimate Offering labels Normal Summon/Set and allows several separately paid summons',async()=>{
 const e=createNativeBackend({rules:()=>pack});let s=await e.createMatch(decks(),{cards,seed:73,lp:2700,openingHands:[[get('Mystical Elf'),get('Mystical Elf'),get('Mystical Elf')],[]],initialFields:[{spells:[body('Ultimate Offering')]},{}]});
 try{s=settle(e,s);s=settle(e,move(e,s,'SUMMON','Mystical Elf'));for(let n=0;n<2;n++){const a=s.actions[0].find(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Ultimate Offering');assert.match(a.effectText,/Normal Summon/);assert.doesNotMatch(a.effectText,/Special Summon/);s=settle(e,e.applyAction(s,a,0));}assert.equal(s.players[0].lp,1700);assert.equal(s.players[0].monsters.filter(Boolean).length,3);
 }finally{e.destroyMatch(s);}
});
test('new replays reject mismatched database/runtime while legacy replays remain compatible',async()=>{
 const e=createNativeBackend({rules:()=>pack});let s=await e.createMatch(decks(),{cards,seed:17,identityVersion:1,openingHands:[[],[]]});
 try{const saved=e.exportMatch(s);assert.ok(saved.rulesFingerprint);await assert.rejects(()=>e.restoreMatch({...saved,rulesFingerprint:'different'},{cards}),/database or rules runtime/);delete saved.rulesFingerprint;delete saved.options.identityVersion;const old=await e.restoreMatch(saved,{cards});assert.equal(e.exportMatch(old).checkpoint,saved.checkpoint);e.destroyMatch(old);}finally{e.destroyMatch(s);}
});
test('a core failure after accepting a response cannot export or continue inconsistent state',async()=>{
 let fail=false;const lib={...pack.lib,duelSetResponse(...args){pack.lib.duelSetResponse(...args);if(fail)throw Error('Injected failure after acceptance');}};
 const e=createNativeBackend({rules:()=>({...pack,lib})});let s=await e.createMatch(decks(),{cards,seed:17,openingHands:[[],[]]});
 try{const checkpoint=e.exportMatch(s),action=s.actions[0].find(a=>a.type==='END');fail=true;assert.throws(()=>e.applyAction(s,action,0),error=>error.duelAdvanced&&/Injected/.test(error.message));assert.throws(()=>e.exportMatch(s),/Restore/);assert.throws(()=>e.applyAction(s,action,0),/checkpoint/);fail=false;const restored=await e.restoreMatch(checkpoint,{cards});assert.equal(e.exportMatch(restored).checkpoint,checkpoint.checkpoint);e.destroyMatch(restored);}finally{e.destroyMatch(s);}
});
test('JSON objects with invalid primitive conversion cannot break preferences or save rendering',()=>{
 const hostile=JSON.parse('{"toString":null,"valueOf":null}');const config=normalizeSoloConfig({aiSpeed:hostile,sides:[{size:hostile},{size:hostile}]});assert.equal(config.aiSpeed,'normal');assert.equal(config.sides[1].size,40);
 const storage=memory();storage.setItem(DUEL_SAVES_KEY,JSON.stringify([{id:'bad',name:hostile,replay:{version:1}},{id:'ok',replay:{version:1}}]));const status=inspectDuelSaves(storage);assert.equal(status.saves.length,1);assert.equal(status.rejected.length,1);
});
