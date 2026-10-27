import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createEffectPlayer,effectNotices,automaticEffectAction} from '../src/duel/effects.js';
import {responseOffer} from '../src/duel/responses.js';
const card={id:9603356,name:'Shadowknight Archfiend',card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/9603356.jpg'}]};
const event={uid:'arch',card,stage:'automatic',text:'Required upkeep applied: 900 LP paid.'};
function rig(hold=15){const window=new Window();window.document.body.innerHTML='<div id="effects"></div>';const root=window.document.querySelector('#effects'),player=createEffectPlayer({getRoot:()=>root,hold});return {root,player,close(){player.cancel();window.close();}};}
test('required effects display card art and the confirmed outcome without an activation button',async()=>{
  const r=rig();try{
    const done=r.player.play([event]);assert.equal(r.player.active,true);assert.match(r.root.querySelector('img').src,/9603356/);assert.match(r.root.textContent,/Required effect.*Shadowknight.*900 LP paid/);
    assert.equal(r.root.querySelector('button'),null);assert.equal(r.root.querySelector('dialog'),null);
    assert.equal(await done,true);assert.equal(r.root.children.length,0);assert.equal(r.player.active,false);
  }finally{r.close();}
});
test('cancelling a display releases the pending presentation and does not restore a stale card',async()=>{
  const r=rig(1000);try{
    const done=r.player.play([event,event]);r.player.cancel();assert.equal(await done,false);assert.equal(r.root.children.length,0);
    await new Promise(yes=>setTimeout(yes,20));assert.equal(r.root.children.length,0);assert.equal(r.player.active,false);
  }finally{r.close();}
});
test('disabled card motion adds no delay; reduced motion uses a static card notice',async()=>{
  const r=rig();try{
    assert.equal(await r.player.play([event],{enabled:false}),true);assert.equal(r.root.children.length,0);
    const done=r.player.play([event],{reduced:true});assert.ok(r.root.querySelector('img'));assert.equal(await done,true);
  }finally{r.close();}
});
test('a confirmed result replaces its activation receipt and is not replayed on later phase renders',()=>{
  const previous={serial:3},next={serial:6,log:[{id:3,effectNotice:event},{id:4,effectNotice:{...event,stage:'activate',chainLink:1}},{id:5,effectNotice:{...event,stage:'resolve',chainLink:1}},{id:6,message:'Main 2'}]};
  assert.deepEqual(effectNotices(previous,next).map(e=>e.stage),['resolve']);assert.deepEqual(effectNotices(next,next),[]);
});
test('only required activations are automatic; optional, targeting and cost choices remain interactive',()=>{
  const activate={type:'ACTIVATE'},target={type:'CHOOSE',target:'card'};
  assert.equal(automaticEffectAction({window:{forced:true}},[activate]),activate);
  assert.equal(automaticEffectAction({window:{forced:false}},[activate,{type:'PASS'}]),null);
  assert.equal(automaticEffectAction({choice:{side:0}},[target]),null);
});
test('a response uses the native source descriptor rather than a mismatched banished-card UID',()=>{
  const wrong={uid:'wrong',card:{id:18891691,name:'Perfect Machine King'},controller:0};
  const player={deck:[],hand:[],monsters:[],spells:[],extra:[],grave:[],banished:[wrong]};
  const state={players:[player,player],turn:1,phase:'standby',chain:[],window:{priority:0,promptId:'p'}};
  const offer=responseOffer(state,[{type:'ACTIVATE',uid:'wrong',effectCard:card}]);assert.equal(offer.cards[0].card.card.name,'Shadowknight Archfiend');assert.equal(offer.cards[0].card.uid,null);
});
test('effect prompts use a single bounded caption, with no layered text reader',async()=>{
  const css=await readFile(new URL('../effects.css',import.meta.url),'utf8');
  assert.match(css,/duel-response-description\s*\{[^}]*overflow:auto/);
  assert.match(css,/duel-effect-host\s*\{[^}]*pointer-events:none[^}]*overflow:hidden/);
  assert.match(css,/duel-response-options\s*\{[^}]*position:static/);
  assert.match(css,/safe-area-inset-left/);
});

test('the arena shows mandatory effects without a modal and holds AI decisions until presentation ends',async()=>{
  const [{createSoloController},{createMatch}, {dragon}]=await Promise.all([import('../src/duel/ui.js'),import('../src/duel/engine.js'),import('./fixtures.js')]);
  const window=new Window({url:'https://example.com/repo/'});window.happyDOM.setWindowSize({width:844,height:390});
  window.document.body.innerHTML='<main></main><dialog id="modal"></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  window.HTMLElement.prototype.animate=()=>({finished:Promise.resolve(),cancel(){}});
  localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({sides:[{},{}],animations:true,first:1,aiSpeed:'fast'}));
  const {normalizeCard}=await import('../src/core.js');const catalog=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
  const normal={...dragon,level:4,type:'Normal Monster',tcgDate:'2002-03-08',race:'Dragon'},deck={name:'Test',main:Array(40).fill(normal),extra:[]};
  const state=createMatch([deck,deck],{first:1,seed:9});state.phase='main1';state.serial++;state.log.push({id:state.serial,turn:1,phase:'standby',side:1,kind:'effect',message:'900 LP paid',uids:[],effectNotice:event});
  const main=document.querySelector('main'),modal=document.querySelector('dialog');let aiDecisions=0;const errors=[];
  const legacy=await import('../src/duel/engine.js');
  const engine={...legacy,createMatch:async()=>state,legalActions:(_s,side)=>side===1?[{type:'END'}]:[],chooseAIAction(){aiDecisions++;return {type:'END'};},applyAction(){throw new Error('AI advanced during receipt');}};
  const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,kind)=>{modal.innerHTML=`<div class="dialog-body ${kind}">${html}</div>`;modal.setAttribute('open','');},closeDialog:()=>modal.removeAttribute('open'),dialogHeader:title=>`<h2>${title}</h2>`,toast:message=>errors.push(message),onDesign(){},onKeepDeck(){},engine});
  const waitFor=async predicate=>{for(let n=0;n<100&&!predicate();n++)await new Promise(yes=>setTimeout(yes,10));assert.ok(predicate(),JSON.stringify({errors,match:!!controller.getMatch(),text:main.textContent.slice(-150)}));};
  try{
    controller.enter();main.querySelector('[data-duel="start"]').click();await waitFor(()=>main.querySelector('.duel-intro-skip'));main.querySelector('.duel-intro-skip').click();await waitFor(()=>main.querySelector('.duel-effect-spotlight'));
    assert.equal(modal.open,false);assert.match(main.querySelector('.duel-effect-caption').textContent,/Shadowknight.*900 LP paid/);
    assert.equal(main.querySelector('.duel-arena').dataset.moving,'true');await new Promise(yes=>setTimeout(yes,60));assert.equal(aiDecisions,0);
    controller.leave();await new Promise(yes=>setTimeout(yes,30));assert.equal(main.querySelector('.duel-effect-spotlight'),null);assert.equal(aiDecisions,0);
  }finally{controller.destroy();window.close();}
});
