import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createSoloController} from '../src/duel/ui.js';
import {phaseEffectText} from '../src/duel/native-prompts.js';
import {command,advanceBattle,selectCard} from './battle-fixtures.js';
const records=[...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data,...JSON.parse(await readFile(new URL('./level-up-fixtures.json',import.meta.url))).data];
const cards=[...new Map(records.map(c=>[c.id,normalizeCard(c)])).values()],get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;};
const rules=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const pairs=[['Armed Dragon LV5','Armed Dragon LV7'],['Horus the Black Flame Dragon LV4','Horus the Black Flame Dragon LV6'],['Horus the Black Flame Dragon LV6','Horus the Black Flame Dragon LV8'],['Mystic Swordsman LV2','Mystic Swordsman LV4'],['Mystic Swordsman LV4','Mystic Swordsman LV6']];
const backend=()=>createNativeBackend({rules:()=>rules});
async function main2(e,low,high,{side=0,source='hand',battle=true}={}){
 const decks=[0,1].map(i=>({name:'Level-up check',main:[...(i===side&&source==='deck'?[get(high)]:[]),...Array(i===side&&source==='deck'?39:40).fill(get('Mystical Elf'))],extra:[]}));
 const openingHands=[[],[]];if(source==='hand')openingHands[side]=[get(high)];
 const initialFields=[{},{}];initialFields[side]={monsters:[{card:get(low)}]};initialFields[1-side]={monsters:[{card:get('Mystical Elf')} ]};
 if(source==='grave')initialFields[side].grave=[{card:get(high)}];
 let s=await e.createMatch(decks,{cards,first:1-side,seed:17,openingHands,initialFields});
 s=command(e,s,'END',1-side);s=command(e,s,'NEXT',side);
 if(battle){s=command(e,s,'ATTACK',side,low);s=selectCard(e,s,s.players[1-side].monsters.find(Boolean).uid);s=advanceBattle(e,s,x=>!x.pending&&!x.choice&&!x.window);}
 s=command(e,s,'NEXT',side);assert.equal(s.phase,'main2');return s;
}
for(const [low,high] of pairs)for(const side of [0,1])for(const source of ['hand','deck'])test(`${low} levels into ${high} in End Phase from ${source}, controller ${side}`,async()=>{
 const e=backend();let s=await main2(e,low,high,{side,source}),restored;
 try{
  assert.ok(!s.choice);assert.ok(!s.actions[side].some(a=>a.yes===true),'Level-up is not an MP2 ignition effect');
  assert.ok(s.players[side][source].some(c=>c.card.name===high),`Target is in ${source}`);
  s=command(e,s,'END',side);
  assert.equal(s.phase,'end');assert.equal(s.choice.optionalResponse,true);assert.equal(s.choice.source.card.name,low);
  assert.match(s.choice.effectText,/During the End Phase/);assert.ok(s.choice.effectText.includes(high));
  assert.doesNotMatch(s.choice.instructions,/attacktarget/);assert.equal(s.actions[side][0].label,'Activate effect','Raw labels remain compatible with existing saved replays');
  const save=e.exportMatch(s);restored=await e.restoreMatch(JSON.parse(JSON.stringify(save)),{cards});assert.equal(e.exportMatch(restored).checkpoint,save.checkpoint);
  s=e.applyAction(s,s.actions[side].find(a=>a.yes===true),side);
  s=advanceBattle(e,s,x=>x.choice?.side===side&&x.actions[side].some(a=>e.findCard(x,a.target)?.card.name===high));
  s=selectCard(e,s,s.players[side][source].find(c=>c.card.name===high).uid);
  s=advanceBattle(e,s,x=>x.players[side].monsters.some(c=>c?.card.name===high)&&!x.choice&&!x.window);
  assert.ok(s.players[side].grave.some(c=>c.card.name===low));assert.ok(s.players[side].monsters.some(c=>c?.card.name===high));
 }finally{e.destroyMatch(s);e.destroyMatch(restored);}
});
for(const [low,high] of pairs)test(`${low} cannot level up without destroying a monster by battle`,async()=>{
 const e=backend();let s=await main2(e,low,high,{battle:false});
 try{s=command(e,s,'END',0);assert.ok(!s.actions[0].some(a=>a.yes===true&&a.effectCard?.name===low));assert.ok(s.players[0].monsters.some(c=>c?.card.name===low));}finally{e.destroyMatch(s);}
});
test('Armed Dragon LV5 does not offer its level-up if LV7 is absent or only in the Graveyard',async()=>{
 for(const grave of [false,true]){
  const e=backend();let s=await main2(e,'Armed Dragon LV5','Armed Dragon LV7',{source:grave?'grave':'absent'});
  try{s=command(e,s,'END',0);assert.ok(!s.actions[0].some(a=>a.yes===true&&a.effectCard?.id===46384672));}finally{e.destroyMatch(s);}
 }
});
test('destroying a monster with Armed Dragon LV5’s discard effect does not qualify as a battle kill',async()=>{
 const e=backend();let s=await e.createMatch([0,1].map(()=>({name:'Effect destruction',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,seed:17,openingHands:[[get('Armed Dragon LV7'),get('Mystical Elf')],[]],initialFields:[{monsters:[{card:get('Armed Dragon LV5')}]},{monsters:[{card:get('Mystical Elf')}]}]});
 try{
  s=command(e,s,'ACTIVATE',0,'Armed Dragon LV5');s=selectCard(e,s,s.players[0].hand.find(c=>c.card.name==='Mystical Elf').uid);s=selectCard(e,s,s.players[1].monsters.find(Boolean).uid);
  s=advanceBattle(e,s,x=>!x.choice&&!x.window);assert.ok(s.players[1].grave.some(c=>c.card.name==='Mystical Elf'));
  s=command(e,s,'END',0);assert.ok(!s.actions[0].some(a=>a.yes===true&&a.effectCard?.id===46384672));assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Armed Dragon LV5'));
 }finally{e.destroyMatch(s);}
});
test('the legal End Phase level-up remains optional and can be declined without paying its cost',async()=>{
 const e=backend();let s=await main2(e,'Armed Dragon LV5','Armed Dragon LV7');
 try{s=command(e,s,'END',0);s=e.applyAction(s,s.actions[0].find(a=>a.yes===false),0);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Armed Dragon LV5'));assert.ok(s.players[0].hand.some(c=>c.card.name==='Armed Dragon LV7'));}finally{e.destroyMatch(s);}
});
for(const [low,high] of [['Armed Dragon LV3','Armed Dragon LV5'],['Ultimate Insect LV1','Ultimate Insect LV3']])test(`${low} offers its separate Standby Phase level-up`,async()=>{
 const e=backend();let s=await e.createMatch([0,1].map(()=>({name:'Standby level-up',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,seed:17,first:1,openingHands:[[get(high)],[]],initialFields:[{monsters:[{card:get(low)}]},{}]});
 try{s=command(e,s,'END',1);assert.equal(s.phase,'standby');assert.ok(s.actions[0].some(a=>a.yes===true));assert.match(s.choice.effectText,/Standby Phase/);assert.ok(s.choice.effectText.includes(high));}finally{e.destroyMatch(s);}
});
const waitFor=async predicate=>{const end=Date.now()+2500;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Duel UI ready');};
for(const [low,high] of pairs)test(`UI enters End Phase, prompts for ${low}, and completes the level-up`,async()=>{
 const e=backend();let s=await main2(e,low,high);
 const window=new Window({url:'https://example.com/'});window.document.body.innerHTML='<main></main><dialog></dialog>';
 for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
 localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'deliberate'}));
 const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[],closeDialog=()=>{modal.removeAttribute('open');modal.dispatchEvent(new window.Event('close'));};
 document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]'))closeDialog();});
 const controller=createSoloController({engine:{...e,createMatch:async()=>s},main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,kind='')=>{modal.innerHTML=`<div class="${kind}">${html}</div>`;modal.setAttribute('open','');},closeDialog,dialogHeader:title=>`<header><h2>${title}</h2><button data-action="close">Close</button></header>`,toast:message=>errors.push(message),onDesign(){}});
 const $=selector=>document.querySelector(selector);
 try{
  controller.enter();$('[data-duel="start"]').click();await waitFor(()=>$('.duel-arena')?.dataset.moving==='false');
  const unit=controller.getMatch().players[0].monsters.find(c=>c?.card.name===low);
  $(`[data-duel-card="${unit.uid}"]`).click();assert.match($('.duel-summon-note').textContent,/End Phase effect/);assert.equal($('.duel-card-actions').textContent.trim(),'');
  $('[data-action="close"]').click();assert.equal($('[data-duel="end"]').textContent,'End Phase');$('[data-duel="end"]').click();
  await waitFor(()=>$('.duel-response-body'));assert.equal(controller.getMatch().phase,'end');assert.equal($('.duel-response-copy h3').textContent,low);assert.ok($('.duel-response-description').textContent.includes(high));
  assert.match($('.duel-response-description').textContent,/^During the End Phase/);
  $('[data-duel="response-activate"]').click();await waitFor(()=>$('.duel-choice-card')&&$('.duel-arena').dataset.moving==='false');
  const option=[...modal.querySelectorAll('.duel-choice-card')].find(c=>c.textContent.includes(high));assert.ok(option);option.click();await waitFor(()=>$('.duel-choice-footer [data-choice-tone="teal"]:not([disabled])')&&$('.duel-arena').dataset.moving==='false');
  $('.duel-choice-footer [data-choice-tone="teal"]').click();await waitFor(()=>controller.getMatch().choice?.selectionType==='select_position'&&$('.duel-arena').dataset.moving==='false');
  [...modal.querySelectorAll('[data-duel-choice]')].find(button=>button.textContent.includes('Attack Position')).click();
  await waitFor(()=>controller.getMatch().players[0].monsters.some(c=>c?.card.name===high)&&$('.duel-arena').dataset.moving==='false');assert.deepEqual(errors,[]);
 }finally{controller.destroy();e.destroyMatch(s);window.close();}
});
