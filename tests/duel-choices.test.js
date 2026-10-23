import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {createSoloController} from '../src/duel/ui.js';
import {defaultSide} from '../src/duel/decks.js';
import {choiceIntent,choiceVisuals} from '../src/duel/choice-view.js';
const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const get=name=>cards.find(card=>card.name===name);
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const waitFor=async predicate=>{const end=Date.now()+2000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Duel UI ready');};
async function rig({search=false,exchange=false,alreadySummoned=false,declaration=null}={}){
  const engine=createNativeBackend({rules:()=>pack});
  const discardCards=search?Array.from({length:55},(_,i)=>({...get('Summoned Skull'),id:700000+i,name:`Backup card ${String(i).padStart(2,'0')}`})):['Summoned Skull','Blue-Eyes White Dragon'].map(get);
  const catalog=[...cards,...discardCards];
  let state=await engine.createMatch([0,1].map(()=>({name:'Prompt test',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{seed:27,first:1,cards:catalog,openingHands:exchange?[['Exchange','Mystical Elf','Blue-Eyes White Dragon'].map(get),[get('Gaia The Fierce Knight')]]:[[get('Tribute to the Doomed'),...discardCards],[]],initialFields:exchange?[{monsters:Array(alreadySummoned?1:2).fill(null).map(()=>({card:get('Mystical Elf')}))},{}]:[{}, {monsters:[{card:get('Mystical Elf')}]}]});
  state=engine.applyAction(state,{type:'END'},1);
  if(exchange){
    if(alreadySummoned)state=engine.applyAction(state,state.actions[0].find(a=>a.type==='SUMMON'&&!a.set),0);
    state=engine.applyAction(state,state.actions[0].find(a=>a.type==='ACTIVATE'&&engine.findCard(state,a.uid)?.card.name==='Exchange'),0);
    while(state.choice||state.window){const side=state.actions[0].length?0:1;state=engine.applyAction(state,engine.chooseAIAction(state,side),side);}
  }
  if(declaration){engine.destroyMatch(state);state=await engine.createMatch([0,1].map(()=>({name:'Declaration test',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{seed:27,cards:catalog,openingHands:[[],[]],initialFields:[{spells:[{card:get(declaration),faceUp:false}]},{}]});state=engine.applyAction(state,state.actions[0].find(a=>a.type==='ACTIVATE'),0);}
  const window=new Window({url:'https://example.com/repo/'});window.happyDOM.setWindowSize({width:844,height:390});
  window.document.body.innerHTML='<main id="main"></main><dialog id="modal"></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  const main=window.document.querySelector('main'),modal=window.document.querySelector('dialog'),messages=[];
  const closeDialog=()=>modal.removeAttribute('open');
  const showDialog=(content,className='')=>{modal.innerHTML=`<div class="dialog-body ${className}">${content}</div>`;modal.setAttribute('open','');};
  window.document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]'))closeDialog();});
  window.localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,aiSpeed:'deliberate'}));
  const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog,closeDialog,dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close" aria-label="Close">×</button></header>`,toast:message=>messages.push(message),onDesign(){},onKeepDeck(){},engine:{...engine,createMatch:async()=>state}});
  controller.enter();main.querySelector('[data-duel="start"]').click();
  await waitFor(()=>main.querySelector('.duel-arena')?.dataset.moving==='false');
  return {window,controller,main,modal,messages,$:selector=>window.document.querySelector(selector),get state(){return controller.getMatch();},close(){controller.destroy();window.close();}};
}
async function activateDoomed(r){
  const card=r.state.players[0].hand.find(c=>c.card.name==='Tribute to the Doomed');
  r.$(`[data-duel-card="${card.uid}"]`).click();[...r.modal.querySelectorAll('[data-duel-group]')].find(button=>button.textContent.includes('Activate')).click();
  await waitFor(()=>r.$('.duel-picker-body')&&r.$('.duel-arena').dataset.moving==='false');
}
test('discard and targeting menus display real card art, action colors, selected state, and fixed confirmation',async()=>{
  const r=await rig();try{
    await activateDoomed(r);
    assert.match(r.$('.duel-choice-source').textContent,/Tribute to the Doomed/);
    const choices=[...r.modal.querySelectorAll('.duel-choice-card')];assert.equal(choices.length,3);
    assert.ok(choices.every(button=>button.dataset.choiceTone==='danger'&&button.querySelector('img')?.getAttribute('src').includes('images.ygoprodeck.com')));
    assert.ok(choices.every(button=>button.textContent.includes('Discard')));
    const retainedImage=choices[0].querySelector('img');
    choices[0].click();await waitFor(()=>r.$('.duel-choice-card[aria-pressed="true"]'));
    assert.strictEqual(r.$('.duel-choice-card[aria-pressed="true"] img'),retainedImage,'Staging keeps the displayed art node');
    const confirm=r.$('.duel-choice-footer [data-choice-tone="teal"]');assert.equal(confirm.disabled,false);assert.match(confirm.textContent,/Confirm/);
    assert.equal(r.$('#duel-options-list [data-choice-tone="teal"]'),null,'Confirmation stays outside the scrolling list');
    confirm.click();await waitFor(()=>r.$('.duel-arena').dataset.selecting==='true'&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.modal.hasAttribute('open'),false,'A new field target returns to direct board selection');
    r.$('[data-duel="resolve-choice"]').click();assert.ok(r.$('.duel-choice-card img'));
    assert.match(r.$('.duel-choice-card').textContent,/Mystical Elf/);assert.equal(r.$('.duel-choice-card').dataset.choiceTone,'danger');
    r.$('.duel-choice-footer [data-action="close"]').click();
    r.$('.opponent .duel-zone[data-role="eligible"]').click();await waitFor(()=>r.$('.opponent .duel-zone[data-role="selected"]')&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.modal.hasAttribute('open'),false,'Returning to board selection keeps the picker closed');
    r.$('[data-duel="confirm-choice"]').click();await waitFor(()=>!r.state.choice&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.state.players[1].monsters.filter(Boolean).length,0);assert.equal(r.modal.hasAttribute('open'),false);
    r.$('[data-duel="next"]').click();await waitFor(()=>r.state.phase==='battle'&&r.$('.duel-arena').dataset.moving==='false');
    r.$('[data-duel="next"]').click();await waitFor(()=>r.state.phase==='main2'&&r.$('.duel-arena').dataset.moving==='false');
    r.$('[data-duel="end"]').click();await waitFor(()=>r.state.active===1);assert.deepEqual(r.messages,[]);
  }finally{r.close();}
});
test('staged card searches and scroll remain in place while selecting and deselecting',async()=>{
  const r=await rig({search:true});try{
    await activateDoomed(r);const search=r.$('#duel-choice-search');search.value='Backup card 3';search.dispatchEvent(new r.window.Event('input'));
    const list=r.$('#duel-options-list');list.scrollTop=80;r.$('.duel-choice-card').click();
    await waitFor(()=>r.$('.duel-choice-card[aria-pressed="true"]'));
    assert.equal(r.$('#duel-choice-search').value,'Backup card 3');assert.equal(r.$('#duel-options-list').scrollTop,80);
    assert.equal(r.modal.querySelectorAll('.duel-choice-card').length,10);
    const selectedUID=r.state.choice.selected[0];r.$('.duel-choice-card[aria-pressed="false"]').click();
    await waitFor(()=>r.state.choice.selected[0]!==selectedUID&&r.$('.duel-arena').dataset.moving==='false');assert.equal(r.state.choice.selected.length,1,'A one-card cost replaces its prior selection');
    assert.equal(r.modal.querySelectorAll('.duel-choice-card[aria-pressed="true"]').length,1);
    r.$('.duel-choice-card[aria-pressed="true"]').click();await waitFor(()=>!r.$('.duel-choice-card[aria-pressed="true"]'));
    assert.equal(r.$('.duel-choice-footer [data-choice-tone="teal"]').disabled,true);
    assert.equal(r.$('#duel-choice-search').value,'Backup card 3');
  }finally{r.close();}
});
test('hidden opposing choices use only a card back and safe metadata; declaration and multi-tribute choices use available art',()=>{
  const blank=()=>({hand:[],deck:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),field:null,grave:[],banished:[],extra:[]});
  const state={players:[blank(),blank()]};state.players[1].monsters[0]={uid:'secret',card:get('Blue-Eyes White Dragon'),faceUp:false,controller:1};
  const secret=choiceVisuals(state,{target:'secret'});assert.equal(secret[0].hidden,true);assert.doesNotMatch(JSON.stringify(secret),/Blue-Eyes|89631139|image_url|Dragon/);
  state.players[0].monsters[0]={uid:'one',card:get('Mystical Elf'),faceUp:true,controller:0};state.players[0].monsters[1]={uid:'two',card:get('Summoned Skull'),faceUp:true,controller:0};
  assert.equal(choiceVisuals(state,{tributes:['one','two']}).length,2);
  const archive=new Map(cards.map(c=>[c.id,c]));assert.equal(choiceVisuals(state,{cardId:get('Mystical Elf').id},{archive})[0].card.card_images.length,1);
  assert.equal(choiceIntent({type:'CHOOSE'},'Select discard').tone,'danger');assert.equal(choiceIntent({type:'CHOOSE'},'Select release').tone,'gold');assert.equal(choiceIntent({finish:true}).tone,'teal');assert.equal(choiceIntent({cancel:true}).tone,'danger');
});
test('Gaia obtained by Exchange can be Tribute Summoned through the arena’s two-card selection',async()=>{
  const r=await rig({exchange:true});try{
    const gaia=r.state.players[0].hand.find(c=>c.card.name==='Gaia The Fierce Knight');
    r.$(`[data-duel-card="${gaia.uid}"]`).click();assert.ok(r.$('.duel-inspect-description'));assert.equal(r.$('.duel-summon-note'),null);
    [...r.modal.querySelectorAll('[data-duel-group]')].find(b=>b.textContent==='Tribute Summon').click();
    await waitFor(()=>r.$('.duel-arena').dataset.selecting==='true'&&r.$('.duel-arena').dataset.moving==='false');
    assert.match(r.$('.duel-prompt').textContent,/at least 2/);
    const tributes=r.state.players[0].monsters.filter(Boolean).map(c=>c.uid);
    for(const uid of tributes){r.$(`[data-duel-card="${uid}"]`).click();await waitFor(()=>r.state.choice.selected.includes(uid)&&r.$('.duel-arena').dataset.moving==='false');}
    assert.equal(r.$('[data-duel="confirm-choice"]').disabled,false);r.$('[data-duel="confirm-choice"]').click();
    await waitFor(()=>r.state.players[0].monsters.filter(Boolean).some(c=>c.card.name==='Gaia The Fierce Knight')&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.state.players[0].grave.filter(c=>c.card.name==='Mystical Elf').length,2);
    r.$('[data-duel="next"]').click();await waitFor(()=>r.state.phase==='battle');assert.deepEqual(r.messages,[]);
  }finally{r.close();}
});
test('an exchanged monster explains the Normal Summon limit when the allowance was already used',async()=>{
  const r=await rig({exchange:true,alreadySummoned:true});try{
    const gaia=r.state.players[0].hand.find(c=>c.card.name==='Gaia The Fierce Knight');r.$(`[data-duel-card="${gaia.uid}"]`).click();
    assert.match(r.$('.duel-summon-note').textContent,/already Normal Summoned\/Set this turn/);
    assert.equal(r.modal.querySelectorAll('[data-duel-group]').length,0);assert.match(r.$('.duel-inspect-description').textContent,/horse/);
  }finally{r.close();}
});

for(const [card,kind] of [['DNA Surgery','race'],['DNA Transplant','attribute']])test(`${card} shares the icon declaration picker and commits a real native selection`,async()=>{
 const r=await rig({declaration:card});try{
  await waitFor(()=>r.$('.duel-declaration-picker'));
  const options=r.state.actions[0].filter(a=>a.declaration),buttons=[...r.modal.querySelectorAll('.duel-declaration')];
  assert.equal(buttons.length,options.length);assert.ok(buttons.length>5);
  assert.ok(buttons.every(b=>b.querySelector(`[data-declaration-icon="${kind}"]`)&&b.getAttribute('aria-pressed')==='false'));
  assert.ok(r.$('.duel-choice-footer button:disabled'));
  const selected=options.find(a=>a.label===(kind==='race'?'MACHINE':'WATER')),index=r.state.actions[0].indexOf(selected);
  r.$(`[data-duel-choice="${index}"]`).click();await waitFor(()=>r.$('.duel-declaration[aria-pressed="true"]'));
  assert.ok(r.$('.duel-declaration-picker'));assert.match(r.$('.duel-choice-help').textContent,/1 \/ 1 selected/);
  const confirm=r.$('.duel-choice-footer [data-choice-tone="teal"]');assert.ok(!confirm.disabled);assert.equal(r.$('#duel-options-list .duel-choice-footer'),null);
  confirm.click();await waitFor(()=>!r.state.choice&&r.$('.duel-arena').dataset.moving==='false');
  assert.ok(r.state.players[0].spells.some(c=>c?.card.name===card&&c.faceUp));assert.deepEqual(r.messages,[]);
 }finally{r.close();}
});
