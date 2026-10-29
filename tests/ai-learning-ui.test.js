import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {createSoloController} from '../src/duel/ui.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {LEARNING_KEY} from '../src/duel/ai-learning.js';
const cards=JSON.parse(await readFile(new URL('./ai-improvements-fixtures.json',import.meta.url))).data.map(normalizeCard),get=n=>cards.find(c=>c.name===n);
const pack=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const waitFor=async predicate=>{const end=Date.now()+12000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'Learning UI ready');};
function rig(engine){
 const window=new Window({url:'https://example.com/game/'});window.happyDOM.setWindowSize({width:844,height:390});window.document.body.innerHTML='<main></main><dialog></dialog>';
 for(const k of ['window','document','localStorage'])Object.defineProperty(globalThis,k,{value:window[k],writable:true,configurable:true});
 localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,aiSpeed:'fast',first:'you'}));
 const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[];
 const closeDialog=()=>modal.removeAttribute('open'),showDialog=(html,kind='')=>{modal.innerHTML=`<div class="dialog-body ${kind}">${html}</div>`;modal.setAttribute('open','');};
 document.addEventListener('click',e=>{if(e.target.closest('[data-action="close"]'))closeDialog();});
 const controller=createSoloController({main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog,closeDialog,dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></header>`,toast:m=>errors.push(m),onDesign(){},engine});controller.enter();
 return {controller,main,modal,errors,$:q=>document.querySelector(q),close(){controller.destroy();window.close();}};
}
test('learning settings are enabled by default, persistent, and reset only after confirmation',()=>{
 const r=rig(createNativeBackend({rules:()=>pack}));try{
  r.$('[data-duel-tab="2"]').click();r.$('[data-duel="learning"]').click();assert.match(r.modal.textContent,/AI learning/);assert.equal(r.controller.getConfig().learning,true);
  r.$('[data-duel="learning-toggle"]').click();assert.equal(r.controller.getConfig().learning,false);assert.equal(JSON.parse(localStorage.getItem('duel-atlas.solo-config.v1')).learning,false);assert.match(r.main.querySelector('.solo-ai-badge').textContent,/Fixed/);
  r.$('[data-duel="learning-toggle"]').click();assert.equal(r.controller.getConfig().learning,true);
  r.$('[data-duel="learning-reset-confirm"]').click();assert.match(r.modal.textContent,/Reset AI learning\?/);assert.ok(r.$('[data-duel="learning-reset"]'));r.$('[data-duel="learning-reset"]').click();assert.equal(JSON.parse(localStorage.getItem(LEARNING_KEY)).games,0);assert.deepEqual(r.errors,[]);
 }finally{r.close();}
});
test('production controller records and learns from a finished native duel',async()=>{
 const engine=createNativeBackend({rules:()=>pack});let match=await engine.createMatch([0,1].map(()=>({name:'Learning UI check',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,seed:71,lp:1000,first:0,openingHands:[[],[]],initialFields:[{}, {monsters:[{card:get('Cannon Soldier')},{card:get('Mystical Elf')}]}]});match=engine.applyAction(match,match.actions[0].find(a=>a.type==='END'),0);
 const r=rig({...engine,createMatch:async()=>match});try{
  r.$('[data-duel="start"]').click();await waitFor(()=>r.controller.getMatch()?.winner===1);await waitFor(()=>JSON.parse(localStorage.getItem(LEARNING_KEY)||'null')?.games===1);
  const model=JSON.parse(localStorage.getItem(LEARNING_KEY));assert.equal(model.wins,1);assert.ok(Object.values(model.weights).some(v=>v!==0));assert.deepEqual(r.errors,[]);
 }finally{r.close();}
});
