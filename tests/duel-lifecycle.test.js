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
