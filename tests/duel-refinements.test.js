import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {handGeometry} from '../src/duel/arena-layout.js';
import {createSoloController} from '../src/duel/ui.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {advanceBattle,command} from './battle-fixtures.js';

const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;};
const rules=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>rules});
const decks=()=>[0,1].map(()=>({name:'Duel refinement',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
const waitFor=async predicate=>{const deadline=Date.now()+3000;while(!predicate()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'Expected duel checkpoint');};
async function rig(engine,state){
  const window=new Window({url:'https://example.com/repo/'});window.happyDOM.setWindowSize({width:844,height:390});window.document.body.innerHTML='<main id="main"></main><dialog id="modal"></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[],closeDialog=()=>modal.removeAttribute('open');
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]')){closeDialog();modal.dispatchEvent(new window.Event('close'));}});
  localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'fast'}));
  const controller=createSoloController({engine:{...engine,createMatch:async()=>state},main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,kind='')=>{modal.innerHTML=`<div class="dialog-body ${kind}">${html}</div>`;modal.setAttribute('open','');},closeDialog,dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close">Close</button></header>`,toast:message=>errors.push(message),onDesign(){},onKeepDeck(){}});
  controller.enter();main.querySelector('[data-duel="start"]').click();await waitFor(()=>main.querySelector('.duel-arena')?.dataset.moving==='false');
  return {window,main,modal,controller,errors,$:s=>document.querySelector(s),get state(){return controller.getMatch();},close(){controller.destroy();window.close();}};
}
test('the whole hand fits without scrolling as its count and enlargement change',()=>{
  for(const [width,height] of [[320,293],[438,293],[714,363],[808,390],[988,740]])for(const count of [0,1,5,6,10,20,40])for(const expanded of [false,true]){
    const hand=handGeometry(width,height,{count,expanded,baseSize:52});
    assert.ok(hand.left>=0);assert.ok(hand.left+hand.rackWidth<=width+.01,`${count} cards at ${width}px`);
    assert.ok(hand.cardWidth*count+Math.max(0,count-1)*hand.values['--hand-card-gap']<=hand.rackWidth+.01);
    assert.ok(hand.cardHeight<=height*.48);if(expanded)assert.equal(hand.bottom,52);
    const normal=handGeometry(width,height,{count,baseSize:52});
    assert.equal(hand.toggleLeft,normal.toggleLeft);assert.equal(hand.toggleBottom,normal.toggleBottom);
  }
  assert.equal(handGeometry(808,390,{count:6,expanded:true,baseSize:52}).cardHeight,104);
});
test('default hand uses spare bottom/right space while enlarged cards and the toggle retain their positions',()=>{
  for(const inset of [4,21,34])for(const count of [1,5,6,10]){
    const normal=handGeometry(714,363,{count,baseSize:64,bottomInset:inset}),large=handGeometry(714,363,{count,baseSize:64,bottomInset:inset,expanded:true});
    assert.equal(normal.bottom,Math.max(-4,inset-16));assert.equal(large.bottom,inset+48);
    assert.equal(normal.toggleBottom,inset+Math.max(0,(normal.cardHeight-32)/2-10));
    assert.equal(large.toggleBottom,normal.toggleBottom);assert.equal(large.toggleLeft,normal.toggleLeft);
    assert.ok(normal.left+normal.rackWidth<=714-192,'The hand stays clear of the action dock');assert.ok(large.left+large.rackWidth<=714);
  }
});
test('the hand overlay cannot intercept empty-area phase taps, and the full-screen frame has no outer safe-area gutters',async()=>{
  const engine=backend(),state=await engine.createMatch(decks(),{cards,first:0,seed:17}),r=await rig(engine,state);
  try{
    const css=(await Promise.all(['styles.css','duel.css','light.css'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')))).join('\n');
    r.window.document.head.innerHTML=`<style>${css}</style>`;
    const computed=s=>r.window.getComputedStyle(r.$(s));
    assert.equal(computed('#main').padding,'0px');assert.equal(computed('.duel-arena').maxWidth,'none');
    assert.equal(computed('.duel-phase-rail').paddingRight,'8px');
    assert.equal(computed('.duel-hand-area').pointerEvents,'none');assert.equal(computed('.duel-hand-rack').pointerEvents,'none');
    for(const selector of ['.duel-hand-card','.duel-hand-zoom'])assert.equal(computed(selector).pointerEvents,'auto',selector);
    assert.notEqual(computed('.duel-controls button').pointerEvents,'none');
    assert.equal(r.$('.duel-hand-zoom').parentElement,r.$('.duel-hand-area'));
  }finally{r.close();}
});
test('duel settings keep only match controls and suppress double-tap zoom without disabling pinch zoom',async()=>{
  const engine=backend(),state=await engine.createMatch(decks(),{cards,first:0,seed:19}),r=await rig(engine,state);
  try{
    const styles=(await Promise.all(['styles.css','duel.css','light.css'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')))).join('\n');
    r.window.document.head.innerHTML=`<style>${styles}</style>`;
    r.$('[data-duel="duel-menu"]').click();
    assert.equal(r.modal.querySelector('[data-duel-keep], [data-duel="save-duel"], [data-duel="coverage"], [data-duel="log"]'),null);
    assert.equal(r.modal.querySelectorAll('.duel-menu-footer button').length,4);
    assert.ok(r.$('[data-duel="save-exit"]'));assert.ok(r.$('[data-duel="surrender"]'));
    const speed=r.$('#duel-ai-speed');speed.value='relaxed';speed.dispatchEvent(new r.window.Event('change',{bubbles:true}));assert.equal(r.controller.getConfig().aiSpeed,'relaxed');
    r.$('[data-duel="toggle-motion"]').click();assert.equal(r.controller.getConfig().animations,true);
    const css=n=>r.window.getComputedStyle(n);assert.equal(css(r.window.document.documentElement).touchAction,'manipulation');assert.equal(css(r.$('.duel-menu-body')).touchAction,'manipulation');
    const markup=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.doesNotMatch(markup,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
    r.$('[data-action="close"]').click();assert.equal(r.modal.hasAttribute('open'),false);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('the opening-turn phase button advances normally while correctly skipping the first Battle Phase',async()=>{
  const engine=backend(),state=await engine.createMatch(decks(),{cards,first:0,seed:18}),r=await rig(engine,state);
  try{
    await waitFor(()=>r.state.phase==='main1'&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.$('[data-duel="next"]').disabled,false);assert.equal(r.$('[data-duel="end"]').disabled,false);
    assert.equal(r.state.actions[0].find(a=>a.type==='NEXT').label,'End');assert.match(r.$('#duel-decision').textContent,/Battle is skipped/);
    r.$('[data-duel="next"]').click();await waitFor(()=>r.state.turn>1);
    assert.equal(r.state.log.some(e=>e.turn===1&&e.message==='Battle Phase.'),false);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
async function exchangeState(engine){
  let state=await engine.createMatch(decks(),{cards,first:1,seed:42,openingHands:[[get('Exchange'),get('Dark Magician'),get('Mystical Elf')],[get('Summoned Skull'),get('Blue-Eyes White Dragon'),get('Gaia The Fierce Knight')]]});
  state=command(engine,state,'END',1);state=command(engine,state,'ACTIVATE',0,'Exchange');
  for(let i=0;i<30&&!state.reveals?.length;i++){const side=state.actions[0].length?0:1;state=engine.applyAction(state,state.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(state,side),side);}
  assert.ok(state.reveals?.length);return state;
}
test('Exchange opens hand lists, avoids per-card spotlights, and leaves Battle and End legal after its selections',async()=>{
  const engine=backend();let state=await exchangeState(engine);try{
    assert.ok(state.reveals.every(r=>r.cards.every(c=>c.zone==='hand')));assert.equal(state.log.filter(l=>l.effectNotice?.stage==='reveal').length,0);
    for(let i=0;i<40&&(state.reveals?.length||state.choice||state.window);i++){
      const side=state.actions[0].length?0:1,list=state.actions[side];state=engine.applyAction(state,list.find(a=>a.type==='ACK_REVEAL'||a.type==='PASS')||engine.chooseAIAction(state,side),side);
    }
    assert.ok(state.actions[0].some(a=>a.type==='NEXT'&&a.label==='Battle'));assert.ok(state.actions[0].some(a=>a.type==='END'));
    state=command(engine,state,'NEXT',0);assert.equal(state.phase,'battle');state=command(engine,state,'END',0);assert.equal(state.active,1);
  }finally{engine.destroyMatch(state);}
});
test('new hand-list checkpoints resume and old saves replay without losing their phase controls',async()=>{
  const engine=backend();let state=await exchangeState(engine),restored;
  try{
    const saved=engine.exportMatch(state);restored=await engine.restoreMatch(saved,{cards});assert.equal(restored.reveals[0].cards.length,state.reveals[0].cards.length);engine.destroyMatch(restored);
    while(state.reveals?.length){const reveal=state.reveals[0];state=engine.applyAction(state,state.actions[reveal.viewer][0],reveal.viewer);}
    const legacy=engine.exportMatch(state);delete legacy.presentationRevision;legacy.history=legacy.history.filter(a=>a.type!=='ACK_REVEAL');
    restored=await engine.restoreMatch(legacy,{cards});assert.equal(restored.reveals.length,0);assert.deepEqual(engine.exportMatch(restored).checkpoint,engine.exportMatch(state).checkpoint);
  }finally{engine.destroyMatch(state);engine.destroyMatch(restored);}
});
test('hand reveals show one inspectable menu, and HUD controls use the freed corners',async()=>{
  const engine=backend(),state=await exchangeState(engine),r=await rig(engine,state);try{
    await waitFor(()=>r.$('.duel-reveal-list'));assert.equal(r.$('.duel-effect-spotlight'),null);assert.equal(r.$('.duel-turn,.duel-hud,.duel-orientation'),null);
    const first=r.$('[data-duel-reveal-card]');assert.ok(first.querySelector('img'));first.click();assert.ok(r.$('.duel-reveal-zoom'));r.$('[data-duel="reveal-list"]').click();r.$('[data-duel="reveal-done"]').click();
    await waitFor(()=>!r.state.reveals.length);assert.equal(r.$('.duel-table>.opponent-life').dataset.fieldLp,'1');assert.ok(r.$('.duel-utility-actions [data-duel="log"]'));assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('movement finishes before a spotlight; returning from suspension releases phase controls without replaying the summon',async()=>{
  const engine=backend();let state=await engine.createMatch(decks(),{cards,first:1,seed:22,openingHands:[[get('Mystical Elf')],[]]});state=command(engine,state,'END',1);
  const r=await rig(engine,state),animations=[];
  try{
    r.window.Element.prototype.getBoundingClientRect=function(){return {left:20,top:20,right:60,bottom:80,width:40,height:60};};
    r.window.Element.prototype.animate=function(){let finish,reject;const finished=new Promise((yes,no)=>{finish=yes;reject=no;});const a={finish,finished,cancel:()=>reject(Error('Cancelled'))};animations.push(a);return a;};
    r.$('[data-duel="duel-menu"]').click();r.$('[data-duel="toggle-motion"]').click();r.$('[data-action="close"]').click();r.$('.duel-hand-card').click();[...r.modal.querySelectorAll('[data-duel-group]')].find(b=>b.textContent==='Normal Summon').click();
    await waitFor(()=>r.$('.duel-motion-layer'));assert.equal(r.$('.duel-effect-spotlight'),null,'Spotlight waits until landing');
    for(const animation of animations)animation.finish();await waitFor(()=>r.$('.duel-effect-spotlight'));assert.equal(r.$('.duel-motion-layer'),null);
    const summoned=r.state.players[0].monsters.filter(Boolean).map(c=>c.uid),handCount=r.state.players[0].hand.length;
    Object.defineProperty(r.window.document,'visibilityState',{value:'hidden',configurable:true});r.window.document.dispatchEvent(new r.window.Event('visibilitychange'));
    Object.defineProperty(r.window.document,'visibilityState',{value:'visible',configurable:true});r.window.dispatchEvent(new r.window.Event('pageshow'));
    assert.equal(r.$('.duel-arena').dataset.moving,'false');assert.equal(r.$('.duel-effect-spotlight'),null);assert.equal(r.$('[data-duel="next"]').disabled,false);assert.equal(r.$('[data-duel="end"]').disabled,false);
    assert.deepEqual(r.state.players[0].monsters.filter(Boolean).map(c=>c.uid),summoned);assert.equal(r.state.players[0].hand.length,handCount);
    r.$('[data-duel="next"]').click();await waitFor(()=>r.state.phase==='battle'&&r.$('.duel-arena').dataset.moving==='false');r.$('[data-duel="end"]').click();await waitFor(()=>r.state.active===1);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('obsolete rotation prompt and terminal renderer are absent from the production sources',async()=>{
  const files=await Promise.all(['src/duel/ui.js','duel.css','light.css','sw.js'].map(f=>readFile(new URL('../'+f,import.meta.url),'utf8')));
  assert.doesNotMatch(files.join('\n'),/duel-orientation|duel-rotate-icon|isPortrait|turn your phone sideways|duel-terminal|terminal\.js/);
});
