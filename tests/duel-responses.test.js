import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {createSoloController} from '../src/duel/ui.js';
import {responseOffer,createResponsePolicy,effectBrief} from '../src/duel/responses.js';
import {damageDuel,advanceBattle} from './battle-fixtures.js';
const cards=[...new Map([...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data,...JSON.parse(await readFile(new URL('./mechanics-audit-fixtures.json',import.meta.url))).data].map(c=>[c.id,normalizeCard(c)])).values()],get=name=>cards.find(c=>c.name===name);
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const waitFor=async predicate=>{const end=Date.now()+2500;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Response UI ready');};
async function rig({multiple=false,trigger=false,damage=false,required=false}={}){
  const engine=createNativeBackend({rules:()=>pack});
  let state;
  if(required){
    state=await engine.createMatch([0,1].map(()=>({name:'Trigger ordering',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{seed:27,cards,openingHands:[required==='upkeep'?[]:[get('Dark Hole')],[]],initialFields:[{monsters:(required==='upkeep'?['Shadowknight Archfiend','Shadowknight Archfiend']:['Sangan','Witch of the Black Forest']).map(name=>({card:get(name)}))},{}]});
    if(required!=='upkeep')state=engine.applyAction(state,state.actions[0].find(a=>a.type==='ACTIVATE'),0);
  }else if(damage){
    state=await damageDuel(engine,cards,{traps:['Castle Walls']});
    state=advanceBattle(engine,state,s=>s.battleStep==='beforeCalculation'&&s.actions[0].some(a=>a.type==='ACTIVATE'));
  }else state=await engine.createMatch([0,1].map(()=>({name:'Response test',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{seed:27,cards,openingHands:[[],[]],initialFields:[trigger?{grave:[{card:get('Sinister Serpent')}]}:{spells:[{card:get('Scapegoat'),faceUp:false},...(multiple?[{card:get('Mystical Space Typhoon'),faceUp:false}]:[])],...(multiple?{monsters:[{card:get('Summoned Skull')}]}:{})},{}]});
  const window=new Window({url:'https://example.com/repo/'});window.happyDOM.setWindowSize({width:844,height:390});
  window.document.body.innerHTML='<main></main><dialog></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  const main=window.document.querySelector('main'),modal=window.document.querySelector('dialog'),errors=[];
  const closeDialog=()=>modal.removeAttribute('open'),showDialog=(content,kind='')=>{modal.innerHTML=`<div class="dialog-body ${kind}">${content}</div>`;modal.setAttribute('open','');};
  window.document.addEventListener('click',event=>{if(event.target.closest('[data-action="close"]'))closeDialog();});
  localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({sides:[{},{}],animations:false,aiSpeed:'deliberate'}));
  const controller=createSoloController({main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog,closeDialog,dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close" aria-label="Return to field">×</button></header>`,toast:m=>errors.push(m),onDesign(){},onKeepDeck(){},engine:{...engine,createMatch:async()=>state}});
  controller.enter();main.querySelector('[data-duel="start"]').click();await waitFor(()=>modal.querySelector('.duel-response-body'));
  return {window,main,modal,controller,errors,$:selector=>window.document.querySelector(selector),get state(){return controller.getMatch();},close(){controller.destroy();window.close();}};
}
test('a legal response opens its card, timing and effect text automatically; Pass once asks at the next timing',async()=>{
  const r=await rig();try{
    assert.match(r.modal.textContent,/Scapegoat/);assert.match(r.modal.textContent,/Draw/);assert.match(r.modal.textContent,/Special Summon/);
    assert.match(r.$('.duel-response-art img').src,/images.ygoprodeck.com/);
    assert.equal(r.$('[data-duel="respond"]').textContent,'Review card');
    assert.equal(r.$('[data-duel="response-read"]'),null);assert.equal(r.$('#duel-response-description').hidden,false);assert.match(r.$('#duel-response-description').textContent,/4 "Sheep Tokens"/);
    r.$('[data-duel="response-pass"]').click();await waitFor(()=>r.state.phase==='standby'&&r.modal.hasAttribute('open'));
    assert.match(r.$('.duel-response-context').textContent,/Standby/);assert.equal(r.$('.duel-response-policy'),null);
    assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('Damage Step preview names the revealed defender and updates its field DEF after Castle Walls resolves',async()=>{
  const r=await rig({damage:true});try{
    assert.match(r.$('.duel-response-context').textContent,/Mystical Elf is face-up/);
    assert.doesNotMatch(r.$('.duel-response-context').textContent,/attack is declared/);
    assert.match(r.modal.textContent,/Castle Walls/);assert.match(r.$('.duel-response-note').textContent,/declines optional effects.*required choices still ask/);
    assert.equal(r.$('.duel-phases').dataset.battleStep,'beforeCalculation');
    r.$('[data-duel="response-activate"]').click();
    await waitFor(()=>r.state.choice&&r.$('.duel-arena').dataset.moving==='false');
    const elf=r.state.players[0].monsters.find(Boolean);
    assert.equal(r.$(`[data-duel-card="${elf.uid}"]`).dataset.role,'eligible');
    r.$(`[data-duel-card="${elf.uid}"]`).click();await waitFor(()=>!r.$('[data-duel="confirm-choice"]')?.disabled&&r.$('.duel-arena').dataset.moving==='false');r.$('[data-duel="confirm-choice"]').click();
    await waitFor(()=>r.state.log.some(e=>e.kind==='stats'&&/DEF 2000 → 2500/.test(e.message)));
    assert.match(r.$(`[data-duel-card="${elf.uid}"]`).getAttribute('aria-label'),/DEF 2500/);
    assert.ok(r.state.log.some(e=>e.kind==='timing'&&e.battleStep==='beforeCalculation'));
    assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('Pass turn skips later optional windows, resets next turn and can be undone with Ask again',async()=>{
  const r=await rig();try{
    r.$('[data-duel="response-turn"]').click();await waitFor(()=>r.state.phase==='main1'&&!r.state.window);
    assert.equal(r.modal.hasAttribute('open'),false);assert.ok(r.$('[data-duel="ask-again"]'));
    assert.equal(r.state.players[0].spells.filter(Boolean).length,1,'Passing does not activate the Trap / Quick-Play Spell');
    r.$('[data-duel="end"]').click();await waitFor(()=>r.state.turn===2&&r.$('.duel-response-body')&&r.modal.hasAttribute('open'));
    assert.equal(r.$('.duel-response-policy'),null,'The next turn asks again');
    r.$('[data-duel="response-turn"]').click();await waitFor(()=>r.$('[data-duel="ask-again"]')&&!r.modal.hasAttribute('open'));
    r.$('[data-duel="ask-again"]').click();assert.equal(r.$('.duel-response-policy'),null);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('the response can be activated from the preview; the full native effect resolves and play resumes',async()=>{
  const r=await rig();try{
    r.$('[data-duel="response-activate"]').click();await waitFor(()=>r.state.players[0].monsters.filter(Boolean).length===4&&!r.state.choice&&!r.state.window);
    assert.ok(r.state.players[0].monsters.filter(Boolean).every(c=>c.position==='defense'));
    assert.equal(r.modal.hasAttribute('open'),false);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('multiple eligible effects use their own art and text; returning to the board does not reopen the same prompt',async()=>{
  const r=await rig({multiple:true});try{
    const options=r.modal.querySelectorAll('[data-response-index]');assert.equal(options.length,2);
    options[1].click();assert.match(r.$('.duel-response-copy').textContent,/Mystical Space Typhoon/);assert.match(r.$('.duel-response-art img').src,new RegExp(get('Mystical Space Typhoon').id));
    r.$('[data-action="close"]').click();await new Promise(resolve=>setTimeout(resolve,130));assert.equal(r.modal.hasAttribute('open'),false);
    r.$('[data-duel="respond"]').click();assert.equal(r.modal.hasAttribute('open'),true);assert.match(r.modal.textContent,/Mystical Space Typhoon/);
  }finally{r.close();}
});
test('turn preference never declines required chains, costs, targets or procedural yes/no choices',()=>{
  const card={uid:'c1',card:get('Scapegoat'),controller:0},state={runtimeId:'test',seed:1,turn:1,phase:'end',players:[{hand:[card],deck:[],monsters:[],spells:[],grave:[],banished:[],extra:[]},{hand:[],deck:[],monsters:[],spells:[],grave:[],banished:[],extra:[]}],chain:[],window:{priority:0,promptId:'p1'}};
  const activate={type:'ACTIVATE',uid:'c1'},pass={type:'PASS'},policy=createResponsePolicy();policy.passTurn(state);
  assert.equal(policy.action(state,[activate,pass]),pass);assert.equal(policy.action(state,[activate]),null);
  state.window=null;state.choice={side:0,trigger:{uid:'c1'},optionalResponse:false};const yes={type:'CHOOSE',yes:true},no={type:'CHOOSE',yes:false};assert.equal(policy.action(state,[yes,no]),null);
  state.choice.optionalResponse=true;assert.equal(policy.action(state,[yes,no]),no);
  state.turn++;assert.equal(policy.action(state,[yes,no]),null);assert.equal(policy.isPassing(state),false);
  assert.match(effectBrief(get('Tribute to the Doomed')),/Discard 1 card/);assert.equal(effectBrief({desc:'x'.repeat(500)}).length,220);
  state.choice=null;state.window={priority:1};assert.equal(responseOffer(state,[activate,pass]),null);
});

test('native optional triggered effects use the same explanatory response card and decline without moving the card',async()=>{
  const r=await rig({trigger:true});try{
    assert.equal(r.state.choice.optionalResponse,true);assert.match(r.modal.textContent,/Sinister Serpent/);
    assert.match(r.$('.duel-response-context').textContent,/optional triggered effect/);
    r.$('[data-duel="response-pass"]').click();await waitFor(()=>r.state.phase==='main1'&&!r.state.choice);
    assert.ok(r.state.players[0].grave.some(c=>c.card.name==='Sinister Serpent'));
    assert.ok(r.state.log.some(e=>/pass on Sinister Serpent/.test(e.message)));assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('Auto-pass declines native optional triggers without reopening their card preview',async()=>{
  const r=await rig({trigger:true});try{
    r.$('[data-duel="response-turn"]').click();await waitFor(()=>r.state.phase==='main1'&&!r.state.choice&&!r.state.window);
    assert.equal(r.modal.hasAttribute('open'),false);assert.ok(r.$('[data-duel="ask-again"]'));
    assert.ok(r.state.players[0].grave.some(c=>c.card.name==='Sinister Serpent'));
    assert.ok(r.state.log.some(e=>/pass on Sinister Serpent/.test(e.message)));assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
test('Auto-pass declines an optional Damage Step response and lets the native battle finish',async()=>{
  const r=await rig({damage:true});try{
    r.$('[data-duel="response-turn"]').click();await waitFor(()=>r.state.players[0].grave.some(c=>c.card.name==='Mystical Elf')&&!r.state.pending);
    assert.equal(r.modal.hasAttribute('open'),false);assert.ok(r.state.players[0].spells.some(c=>c?.card.name==='Castle Walls'&&!c.faceUp));
    assert.ok(r.state.log.some(e=>e.kind==='battle'&&/2500 ATK/.test(e.message)));assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});

test('the required trigger UI waits for the chosen order and never offers Pass or Auto-pass',async()=>{
  const r=await rig({required:true});try{
    assert.equal(r.state.window.forced,true);assert.equal(r.$('[data-duel="response-pass"]'),null);assert.equal(r.$('[data-duel="response-turn"]'),null);
    assert.match(r.$('.duel-response-context').textContent,/Choose the next required effect/);
    r.$('[data-response-index][aria-label^="Witch"]').click();assert.match(r.$('.duel-response-copy').textContent,/Witch of the Black Forest/);
    r.$('[data-duel="response-activate"]').click();await waitFor(()=>r.state.choice&&r.$('.duel-arena').dataset.moving==='false');
    assert.deepEqual(r.state.chain.map(c=>c.card.name),['Witch of the Black Forest','Sangan']);
    assert.equal(r.state.players[0].hand.length,0,'Search targets remain the player’s choice');assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});

test('identical required sources can be distinguished by their field zone',async()=>{
  const r=await rig({required:'upkeep'});try{
    assert.match(r.$('.duel-response-copy small').textContent,/Your Monster Zone 1/);r.$('[data-response-index="1"]').click();
    assert.match(r.$('.duel-response-copy small').textContent,/Your Monster Zone 2/);assert.deepEqual(r.errors,[]);
  }finally{r.close();}
});
