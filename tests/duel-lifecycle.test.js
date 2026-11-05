import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {createSoloController} from '../src/duel/ui.js';
import {DUEL_SAVES_KEY} from '../src/duel/saves.js';
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const waitFor=async predicate=>{const end=Date.now()+2000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Pending launch reaches expected state');};
for(const operation of ['start','resume'])test(`leaving Solo invalidates a pending ${operation}, even after returning and launching another duel`,async()=>{
 const window=new Window({url:'https://example.com/'});
 window.document.body.innerHTML='<main></main><dialog></dialog>';
 for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
 window.localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'deliberate'}));
 window.localStorage.setItem(DUEL_SAVES_KEY,JSON.stringify([{id:'saved',name:'Saved match',turn:1,lp:[8000,8000],replay:{version:1}}]));
 const backend=createNativeBackend({rules:()=>pack}),elf=cards.find(c=>c.name==='Mystical Elf');
 const states=await Promise.all([1,2].map(seed=>backend.createMatch([0,1].map(()=>({name:'Pending '+seed,main:Array(40).fill(elf),extra:[]})),{seed,cards,openingHands:[[],[]]})));
 const pending=[],destroyed=[],messages=[],main=window.document.querySelector('main'),modal=window.document.querySelector('dialog');
 const delay=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 const controller=createSoloController({main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="${classes}">${html}</div>`;modal.setAttribute('open','');},closeDialog:()=>modal.removeAttribute('open'),dialogHeader:title=>`<h2>${title}</h2>`,toast:message=>messages.push(message),onDesign(){},engine:{...backend,createMatch:delay,restoreMatch:delay,destroyMatch:state=>{if(state)destroyed.push(state.runtimeId);backend.destroyMatch(state);}}});
 try{
  controller.enter();
  if(operation==='resume'){main.querySelector('[data-duel-tab="3"]').click();main.querySelector('[data-resume-duel]').click();}
  else main.querySelector('[data-duel="start"]').click();
  assert.equal(pending.length,1);
  controller.leave();controller.enter();
  main.querySelector('[data-duel="start"]').click();
  assert.equal(pending.length,2,'Returning to Solo permits a fresh launch');
  pending[0].resolve(states[0]);await waitFor(()=>destroyed.includes(states[0].runtimeId));
  assert.equal(controller.getMatch(),null,'The old result cannot replace the new pending launch');
  assert.equal(main.querySelector('[data-duel="start"]').disabled,true,'An old completion cannot unlock the current launch');
  pending[1].resolve(states[1]);await waitFor(()=>controller.getMatch()?.runtimeId===states[1].runtimeId);
  assert.deepEqual(messages,[]);
 }finally{controller.destroy();for(const state of states)backend.destroyMatch(state);window.close();}
});

async function session({engine,storage=[],config={}}){
 const window=new Window({url:'https://example.com/'});window.document.body.innerHTML='<main></main><dialog></dialog>';
 for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
 for(const [key,value] of storage)window.localStorage.setItem(key,value);
 window.localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'fast',...config}));
 const main=window.document.querySelector('main'),modal=window.document.querySelector('dialog'),messages=[];
 const controller=createSoloController({main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="${classes}">${html}</div>`;modal.setAttribute('open','');},closeDialog:()=>modal.removeAttribute('open'),dialogHeader:title=>`<h2>${title}</h2>`,toast:m=>messages.push(m),onDesign(){},engine});
 controller.enter();return {window,main,modal,controller,messages,$:s=>window.document.querySelector(s),close(){controller.destroy();window.close();}};
}
const deckFixture=()=>[0,1].map(()=>({name:'Recovery fixture',main:Array(40).fill(cards.find(c=>c.name==='Mystical Elf')),extra:[]}));
test('an interrupted native choice recovers after a full controller reload with no manual save',async()=>{
 const engine=createNativeBackend({rules:()=>pack}),elf=cards.find(c=>c.name==='Mystical Elf'),gaia=cards.find(c=>c.name==='Gaia The Fierce Knight');
 let state=await engine.createMatch(deckFixture(),{cards,seed:27,openingHands:[[gaia],[]],initialFields:[{monsters:[{card:elf},{card:elf}]},{}]});
 const summon=state.actions[0].find(a=>a.type==='SUMMON'&&!a.set);state=engine.applyAction(state,summon,0);state=engine.applyAction(state,state.actions[0].find(a=>a.target),0);
 let r=await session({engine:{...engine,createMatch:async()=>state}}),storage,runtime;
 try{r.$('[data-duel="start"]').click();await waitFor(()=>r.controller.getMatch()?.choice?.selected.length===1);runtime=r.controller.getMatch().runtimeId;assert.equal(r.controller.persistRecovery(),true);storage=Array.from({length:r.window.localStorage.length},(_,i)=>{const key=r.window.localStorage.key(i);return [key,r.window.localStorage.getItem(key)];});assert.equal(r.window.localStorage.getItem(DUEL_SAVES_KEY),null);}finally{r.close();}
 r=await session({engine,storage});try{assert.ok(r.$('[data-resume-recovery]'));r.$('[data-resume-recovery]').click();await waitFor(()=>r.controller.getMatch()?.choice?.selected.length===1);assert.notEqual(r.controller.getMatch().runtimeId,runtime);assert.equal(r.controller.getMatch().players[0].monsters.filter(Boolean).length,2);assert.deepEqual(r.messages,[]);}finally{r.close();}
});
test('repeated AI failures pause with a visible retry instead of looping indefinitely',async()=>{
 const backend=createNativeBackend({rules:()=>pack}),state=await backend.createMatch(deckFixture(),{cards,seed:27,first:1,openingHands:[[],[]]});let choices=0;
 const r=await session({engine:{...backend,createMatch:async()=>state,chooseAIAction(){choices++;throw Error('AI failure');}},config:{first:'ai'}});
 try{r.$('[data-duel="start"]').click();await waitFor(()=>r.$('[data-duel="retry-play"]'));assert.equal(choices,2);assert.match(r.$('.duel-prompt').textContent,/AI could not choose/);await new Promise(resolve=>setTimeout(resolve,250));assert.equal(choices,2);r.$('[data-duel="retry-play"]').click();await waitFor(()=>choices===4);assert.ok(r.$('[data-duel="save-exit"]'));}finally{r.close();}
});
test('a response error restores the pre-action state and pauses until retry',async()=>{
 let fail=false;const lib={...pack.lib,duelSetResponse(...args){pack.lib.duelSetResponse(...args);if(fail)throw Error('Injected native error');}},backend=createNativeBackend({rules:()=>({...pack,lib})}),state=await backend.createMatch(deckFixture(),{cards,seed:27,openingHands:[[],[]]});
 const r=await session({engine:{...backend,createMatch:async()=>state}});
 try{r.$('[data-duel="start"]').click();await waitFor(()=>r.$('.duel-arena')?.dataset.moving==='false');const before=backend.exportMatch(r.controller.getMatch());fail=true;r.$('[data-duel="end"]').click();await waitFor(()=>r.$('[data-duel="retry-play"]'));fail=false;assert.notEqual(r.controller.getMatch().runtimeId,state.runtimeId);assert.equal(backend.exportMatch(r.controller.getMatch()).checkpoint,before.checkpoint);assert.match(r.$('.duel-prompt').textContent,/restored/);assert.deepEqual(r.messages,[]);}finally{r.close();}
});
