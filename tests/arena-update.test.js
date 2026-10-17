import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {createSoloController} from '../src/duel/ui.js';
import {createResponsePolicy,responseOffer} from '../src/duel/responses.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
import {damageDuel,advanceBattle,command} from './battle-fixtures.js';
const cards=[...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard),...JSON.parse(await readFile(new URL('./arena-fixtures.json',import.meta.url)))];
const get=name=>cards.find(c=>c.name===name),rules=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>rules});
const decks=(size=40)=>[0,1].map(()=>({name:'Arena regression',main:Array.from({length:size},(_,i)=>get(['Mystical Elf','Summoned Skull','Gaia The Fierce Knight','Dark Magician','Blue-Eyes White Dragon'][i%5])),extra:[]}));
async function telescope(engine,{viewer=0,size=40}={}){
  const hand=[[],[]];hand[viewer]=[get('Ancient Telescope')];let s=await engine.createMatch(decks(size),{cards,seed:27,first:viewer,openingHands:hand});
  const expected=s.players[1-viewer].deck.slice(-5).reverse().map(c=>c.card.id),order=s.players[1-viewer].deck.map(c=>c.card.id);
  s=command(engine,s,'ACTIVATE',viewer,'Ancient Telescope');
  for(let n=0;n<25&&!s.reveals?.length;n++){const side=s.actions[0].length?0:1;s=engine.applyAction(s,s.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(s,side),side);}
  assert.ok(s.reveals?.length,'The reveal pauses for viewing');return {s,expected,order};
}
const waitFor=async fn=>{const until=Date.now()+2500;while(!fn()&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.ok(fn(),'Arena interaction ready');};
async function ui(engine,state){
  const window=new Window({url:'https://example.com/repo/'});window.happyDOM.setWindowSize({width:844,height:390});window.document.body.innerHTML='<main id="main"></main><dialog id="modal"></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  const main=window.document.querySelector('main'),modal=window.document.querySelector('dialog'),errors=[];
  const closeDialog=()=>modal.removeAttribute('open');
  window.document.addEventListener('click',e=>{if(e.target.closest('[data-action="close"]'))closeDialog();});
  localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'deliberate'}));
  const controller=createSoloController({engine:{...engine,createMatch:async()=>state},main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',closeDialog,showDialog:(html,kind='')=>{modal.innerHTML=`<div class="dialog-body ${kind}">${html}</div>`;modal.setAttribute('open','');},dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close" aria-label="Close">×</button></header>`,toast:m=>errors.push(m),onDesign(){},onKeepDeck(){}});
  controller.enter();main.querySelector('[data-duel="start"]').click();await waitFor(()=>main.querySelector('.duel-arena')?.dataset.moving==='false');
  return {window,main,modal,controller,errors,$:s=>window.document.querySelector(s),get s(){return controller.getMatch();},close(){controller.destroy();window.close();}};
}
test('Enchanted Javelin is offered at attack declaration and heals before battle continues',async()=>{
  const e=backend();let s=await damageDuel(e,cards,{traps:['Enchanted Javelin']});try{
    const offer=responseOffer(s,s.actions[0]);assert.equal(offer.phase,'Attack declaration');assert.equal(offer.cards[0].card.card.name,'Enchanted Javelin');
    const policy=createResponsePolicy();policy.passTurn(s);assert.equal(policy.action(s,s.actions[0]),null,'Routine auto-pass must not suppress an attack response');
    s=command(e,s,'ACTIVATE',0,'Enchanted Javelin');s=advanceBattle(e,s,x=>!x.pending&&x.players[0].grave.some(c=>c.card.name==='Enchanted Javelin'));
    assert.equal(s.players[0].lp,10500);const heal=s.log.find(x=>x.kind==='heal'&&x.message.includes('Enchanted Javelin')),battle=s.log.find(x=>x.kind==='battle'&&/2500 ATK/.test(x.message));assert.ok(heal&&battle&&heal.id<battle.id);
  }finally{e.destroyMatch(s);}
});
test('routine auto-pass still asks about summon, chain, damage and optional trigger opportunities',()=>{
  const p=createResponsePolicy(),c={uid:'trap',card:get('Enchanted Javelin')},s={runtimeId:'x',turn:2,phase:'main1',players:[{...decks()[0],hand:[c],deck:[],monsters:[],spells:[],grave:[],extra:[],banished:[]},{hand:[],deck:[],monsters:[],spells:[],grave:[],extra:[],banished:[]}],chain:[],window:{priority:0,event:{kind:'phase'}}},a=[{id:'a',type:'ACTIVATE',uid:c.uid},{id:'p',type:'PASS'}];p.passTurn(s);assert.equal(p.action(s,a),a[1]);
  for(const kind of ['attack','summon','chain']){s.window.event.kind=kind;assert.equal(p.action(s,a),null);}
  s.window.event.kind='phase';s.battleStep='beforeCalculation';assert.equal(p.action(s,a),null);s.battleStep=null;s.choice={side:0,optionalResponse:true,trigger:{uid:c.uid}};assert.equal(p.action(s,[{type:'CHOOSE',yes:true},{type:'CHOOSE',yes:false}]),null);
});
test('Ancient Telescope automatically reveals five cards in exact top-first order, with an explicit viewing pause',async()=>{
  const e=backend();let {s,expected,order}=await telescope(e);try{
    const reveal=s.reveals[0];assert.equal(reveal.viewer,0);assert.equal(reveal.source.name,'Ancient Telescope');assert.deepEqual(reveal.cards.map(c=>c.card.id),expected);assert.equal(s.choice,null);assert.deepEqual(s.actions[0].map(a=>a.type),['ACK_REVEAL']);
    assert.throws(()=>e.applyAction(s,{type:'NEXT'},0),/no longer legal/);s=e.applyAction(s,s.actions[0][0],0);assert.deepEqual(s.players[1].deck.map(c=>c.card.id),order);assert.equal(s.reveals.length,0);assert.ok(s.actions[0].some(a=>a.type==='NEXT'));assert.throws(()=>e.applyAction(s,{type:'ACK_REVEAL',id:reveal.id},0),/no longer available/);
  }finally{e.destroyMatch(s);}
});
test('a short Deck reveals only its remaining cards and AI private peeks do not disclose draw order',async()=>{
  for(const viewer of [0,1]){const e=backend();let {s,expected}=await telescope(e,{viewer,size:3});try{assert.equal(s.reveals[0].cards.length,3);assert.deepEqual(s.reveals[0].cards.map(c=>c.card.id),expected);if(viewer===1){assert.deepEqual(s.revealedUIDs,[]);assert.equal(aiObservation(s,0).reveals,undefined);assert.ok(!s.log.some(x=>x.kind==='reveal'&&/Mystical Elf|Dark Magician|Summoned Skull/.test(x.message)));}}finally{e.destroyMatch(s);}}
});
test('a two-Tribute Summon can be cancelled before confirmation, including after selecting a material',async()=>{
  for(const selected of [false,true]){const e=backend();let s=await e.createMatch(decks(),{cards,seed:27,openingHands:[[get('Gaia The Fierce Knight')],[]],initialFields:[{monsters:[{card:get('Mystical Elf')},{card:get('Summoned Skull')}]},{}]});try{
    const before=s.players[0].monsters.filter(Boolean).map(c=>c.uid);s=command(e,s,'SUMMON',0,'Gaia The Fierce Knight');if(selected)s=e.applyAction(s,s.actions[0].find(a=>a.target),0);
    const cancel=s.actions[0].find(a=>a.cancel);assert.ok(cancel);assert.equal(cancel.label,'Cancel summon');s=e.applyAction(s,cancel,0);assert.equal(s.choice,null);assert.equal(s.normalSummons[0],0);assert.deepEqual(s.players[0].monsters.filter(Boolean).map(c=>c.uid),before);assert.ok(s.players[0].hand.some(c=>c.card.name==='Gaia The Fierce Knight'));assert.equal(s.players[0].grave.length,0);assert.ok(s.actions[0].some(a=>a.type==='SUMMON'));
  }finally{e.destroyMatch(s);}}
});
test('a paid activation cannot be cancelled after committing its discard cost',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:27,openingHands:[[get('Tribute to the Doomed'),get('Blue-Eyes White Dragon')],[]],initialFields:[{},{monsters:[{card:get('Summoned Skull')}]}]});try{
    s=command(e,s,'ACTIVATE',0,'Tribute to the Doomed');assert.ok(!s.actions[0].some(a=>a.cancel));const cost=s.actions[0].find(a=>a.target&&e.findCard(s,a.target)?.card.name==='Blue-Eyes White Dragon');s=e.applyAction(s,cost,0);s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);assert.ok(s.players[0].grave.some(c=>c.card.name==='Blue-Eyes White Dragon'));assert.ok(!s.actions[0].some(a=>a.cancel));
  }finally{e.destroyMatch(s);}
});
test('attack target selection can be cancelled before declaring the attack or spending it',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:27,first:1,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Dark Magician')}]},{monsters:[{card:get('Mystical Elf')},{card:get('Summoned Skull')}]}]});try{
    s=e.applyAction(s,{type:'END'},1);s=e.applyAction(s,{type:'NEXT'},0);const attacker=s.players[0].monsters.find(Boolean).uid;s=e.applyAction(s,s.actions[0].find(a=>a.type==='ATTACK'),0);s=e.applyAction(s,s.actions[0].find(a=>a.target),0);assert.ok(s.actions[0].some(a=>a.cancel));s=e.applyAction(s,s.actions[0].find(a=>a.cancel),0);assert.equal(s.choice,null);assert.equal(s.pending,null);assert.equal(s.attacksUsed?.[attacker]||0,0);assert.ok(s.actions[0].some(a=>a.type==='ATTACK'&&a.uid===attacker));assert.ok(!s.log.some(x=>x.kind==='attack'));
  }finally{e.destroyMatch(s);}
});
test('Telescope UI displays numbered real card art, supports inspection, and pauses/resumes through rotation',async()=>{
  const e=backend(),{s,expected,order}=await telescope(e),r=await ui(e,s);try{
    await waitFor(()=>r.$('.duel-reveal-body'));const list=[...r.modal.querySelectorAll('[data-duel-reveal-card]')];assert.equal(list.length,5);assert.deepEqual(list.map(b=>Number(b.dataset.duelRevealCard)),[0,1,2,3,4]);assert.ok(list.every(b=>b.querySelector('img')?.src.includes('images.ygoprodeck.com')));assert.equal(r.$('.duel-choice-symbol'),null);
    assert.equal(r.$('.duel-reveal-inspector,.duel-reveal-layout'),null);
    for(let i=0;i<5;i++){
      r.$(`[data-duel-reveal-card="${i}"]`).click();assert.ok(r.$('.duel-reveal-zoom'));assert.match(r.$('.duel-reveal-art').getAttribute('aria-label'),new RegExp(cards.find(c=>c.id===expected[i]).name));
      assert.equal(r.$('.duel-reveal-zoom').querySelectorAll('button').length,1);assert.equal(r.$('.duel-reveal-zoom .effect-text'),null);assert.equal(r.$('.duel-reveal-list'),null);
      r.$('[data-duel="reveal-list"]').click();assert.ok(r.$('.duel-reveal-list'));assert.equal(r.window.document.activeElement,r.$(`[data-duel-reveal-card="${i}"]`));
      assert.equal(r.s.reveals.length,1);assert.deepEqual(r.s.players[1].deck.map(c=>c.card.id),order);
    }
    r.$('[data-duel-reveal-card="3"]').click();
    r.window.happyDOM.setWindowSize({width:390,height:844});r.window.dispatchEvent(new r.window.Event('resize'));assert.equal(r.modal.hasAttribute('open'),false);assert.equal(r.s.reveals.length,1);
    r.window.happyDOM.setWindowSize({width:844,height:390});r.window.dispatchEvent(new r.window.Event('resize'));await waitFor(()=>r.modal.hasAttribute('open')&&r.$('.duel-reveal-body'));r.$('[data-duel="reveal-done"]').click();await waitFor(()=>r.s.reveals.length===0&&!r.modal.hasAttribute('open'));assert.deepEqual(r.s.players[1].deck.map(c=>c.card.id),order);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('field tribute controls expose Cancel after staging a card and preserve the hand and board',async()=>{
  const e=backend(),s=await e.createMatch(decks(),{cards,seed:27,openingHands:[[get('Gaia The Fierce Knight')],[]],initialFields:[{monsters:[{card:get('Mystical Elf')},{card:get('Summoned Skull')}]},{}]}),r=await ui(e,s);try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    const gaia=r.s.players[0].hand.find(c=>c.card.name==='Gaia The Fierce Knight');r.$(`[data-duel-card="${gaia.uid}"]`).click();[...r.modal.querySelectorAll('[data-duel-group]')].find(b=>b.textContent.includes('Tribute Summon')).click();await waitFor(()=>r.$('[data-duel="cancel-choice"]')&&r.$('.duel-arena').dataset.moving==='false');
    const controls=r.$('.duel-controls');assert.equal(controls.dataset.actionLayout,'selection');assert.deepEqual([...controls.children].map(b=>b.textContent),['Confirm','Cards','Cancel']);
    assert.equal(controls.firstElementChild.disabled,true);assert.ok(controls.firstElementChild.classList.contains('primary'));
    for(const b of controls.children)assert.equal(r.window.getComputedStyle(b).minHeight,'40px');
    r.$('.duel-zone[data-role="eligible"]').click();await waitFor(()=>r.s.choice.selected.length===1&&r.$('.duel-arena').dataset.moving==='false');assert.ok(r.$('[data-duel="cancel-choice"]'));r.$('[data-duel="cancel-choice"]').click();await waitFor(()=>!r.s.choice&&r.$('.duel-arena').dataset.moving==='false');assert.equal(r.s.players[0].monsters.filter(Boolean).length,2);assert.equal(r.s.normalSummons[0],0);assert.ok(r.s.players[0].hand.some(c=>c.uid===gaia.uid));assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('card-only reveal zoom overlays sharp art in one frame and backs out without acknowledging the reveal',async()=>{
  const e=backend(),{s,order}=await telescope(e),r=await ui(e,s);try{
    await waitFor(()=>r.$('.duel-reveal-body'));r.$('[data-duel-reveal-card="1"]').click();
    const style=r.window.document.createElement('style');style.textContent=(await Promise.all(['styles.css','duel.css','light.css'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')))).join('\n');r.window.document.head.append(style);
    const art=r.$('.duel-reveal-art'),full=r.window.document.createElement('img');full.className='duel-inspect-full';art.append(full);
    const css=n=>r.window.getComputedStyle(n);assert.equal(css(art).position,'relative');
    for(const img of art.querySelectorAll('img')){assert.equal(css(img).position,'absolute');assert.equal(css(img).height,'100%');assert.equal(css(img).objectFit,'contain');}
    assert.equal(css(r.$('.duel-reveal-zoom')).display,'grid');assert.equal(css(r.$('.duel-reveal-zoom')).backgroundColor,'transparent');
    const cancel=new r.window.Event('cancel',{cancelable:true});r.modal.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.ok(r.$('.duel-reveal-list'));assert.equal(r.s.reveals.length,1);
    r.$('[data-duel-reveal-card="2"]').click();r.modal.removeAttribute('open');r.modal.dispatchEvent(new r.window.Event('close'));assert.ok(r.modal.hasAttribute('open'));assert.ok(r.$('.duel-reveal-list'));assert.equal(r.s.reveals.length,1);
    r.$('[data-duel="reveal-done"]').click();await waitFor(()=>!r.s.reveals.length);assert.deepEqual(r.s.players[1].deck.map(c=>c.card.id),order);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('closing the reveal with X acknowledges it once and returns to the same unshuffled duel',async()=>{
  const e=backend(),{s,order}=await telescope(e),r=await ui(e,s);try{
    await waitFor(()=>r.$('.duel-reveal-body'));r.$('.duel-reveal-body [data-action="close"]').click();await waitFor(()=>!r.s.reveals.length&&r.$('.duel-arena').dataset.moving==='false');r.modal.dispatchEvent(new r.window.Event('close'));await new Promise(resolve=>setTimeout(resolve,130));assert.equal(r.modal.hasAttribute('open'),false);assert.deepEqual(r.s.players[1].deck.map(c=>c.card.id),order);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('the light arena fills one bounded column, has no console, and keeps tools out of card rows',async()=>{
  const e=backend(),s=await e.createMatch(decks(),{cards,seed:27,openingHands:[[],[]]}),r=await ui(e,s);try{
    const style=r.window.document.createElement('style');style.textContent=(await Promise.all(['styles.css','duel.css','light.css'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')))).join('\n');r.window.document.head.append(style);const css=n=>r.window.getComputedStyle(n);
    for(const [width,height] of [[568,320],[667,375],[844,390],[932,430],[1024,768]]){r.window.happyDOM.setWindowSize({width,height});r.window.dispatchEvent(new r.window.Event('resize'));assert.equal(css(r.$('.duel-arena')).gridTemplateColumns,'minmax(0,1fr)');assert.equal(css(r.$('.duel-session')).colorScheme,'light');assert.equal(css(r.$('.duel-session')).overflow,'hidden');assert.equal(r.$('.duel-console'),null);assert.equal(r.$('[data-live-terminal]'),null);assert.equal(r.main.querySelectorAll('.duel-board .duel-zone').length,20);assert.equal(css(r.$('.duel-action-area')).position,'absolute');assert.ok(!r.$('.duel-board').contains(r.$('.duel-controls')));assert.equal(css(r.$('.duel-controls button')).minHeight,'40px');assert.ok(r.$('.duel-midline .duel-prompt'));assert.equal(r.$('.duel-action-area .duel-prompt'),null);}
    r.$('[data-duel="log"]').click();assert.ok(r.$('.duel-log'));assert.equal(css(r.$('.duel-log')).overflowY,'auto');assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
