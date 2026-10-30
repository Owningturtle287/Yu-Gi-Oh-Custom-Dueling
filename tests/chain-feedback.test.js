import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {duelFeedback,chainSummary,createFeedbackPlayer} from '../src/duel/feedback.js';
import {Window} from 'happy-dom';
const cards=JSON.parse(await readFile(new URL('./chain-feedback-fixtures.json',import.meta.url))).data.map(normalizeCard),get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;};
const pack=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const engine=createNativeBackend({rules:()=>pack});
const fields=names=>({spells:names.map(n=>({card:get(n),faceUp:false}))});
async function game({side=0,hands=[['Dian Keto the Cure Master','Chain Strike','Accumulated Fortune'],[]],spells=[['Chain Healing','Waboku'],['Jar of Greed','Chain Detonation']],lp=8000,graves=[[],[]]}={}){
 const s=await engine.createMatch([0,1].map(()=>({name:'Chain regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,seed:93,first:side,lp,openingHands:hands.map(h=>h.map(get)),initialFields:spells.map((names,i)=>({...fields(names),grave:graves[i].map(n=>({card:get(n)}))}))});return settle(s);
}
function settle(s){for(let i=0;i<100&&(s.window||s.choice);i++){const side=s.actions[0].length?0:1,a=s.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(s,side);assert.ok(a);s=engine.applyAction(s,a,side);}assert.ok(!s.window&&!s.choice);return s;}
const available=(s,name,side)=>s.actions[side].find(a=>['ACTIVATE','EFFECT'].includes(a.type)&&engine.findCard(s,a.uid)?.card.name===name);
function activate(s,name,side){for(let i=0;i<8;i++){const a=available(s,name,side);if(a)return engine.applyAction(s,a,side);const actor=s.actions[0].length?0:1,pass=s.actions[actor].find(a=>a.type==='PASS');assert.ok(pass,`Waiting for ${name}: ${JSON.stringify(s.actions)}`);s=engine.applyAction(s,pass,actor);}assert.fail(name);}
async function replay(s){const saved=engine.exportMatch(s),restored=await engine.restoreMatch(saved,{cards});assert.equal(engine.exportMatch(restored).checkpoint,saved.checkpoint);engine.destroyMatch(restored);}

for(const side of [0,1])test(`four-link chain resolves 4→1, and Chain Strike keeps its own link multiplier: side ${side}`,async()=>{
 const other=1-side,hands=[[],[]],spells=[[],[]];hands[side]=['Dian Keto the Cure Master','Chain Strike'];spells[side]=['Accumulated Fortune'];spells[other]=['Jar of Greed'];
 let s=await game({side,hands,spells});const before=s;
 try{
  assert.equal(available(s,'Chain Strike',side),undefined);s=activate(s,'Dian Keto the Cure Master',side);s=activate(s,'Chain Strike',side);s=activate(s,'Jar of Greed',other);
  assert.equal(chainSummary(s).next,4);s=activate(s,'Accumulated Fortune',side);assert.equal(chainSummary(s).total,4);s=settle(s);
  assert.equal(s.players[side].lp,9000);assert.equal(s.players[other].lp,7200);
  const events=duelFeedback(before,s);assert.deepEqual(events.filter(e=>e.stage==='add').map(e=>e.link),[1,2,3,4]);assert.deepEqual(events.filter(e=>e.stage==='resolving').map(e=>e.link),[4,3,2,1]);
  assert.deepEqual(events.filter(e=>e.type==='life').map(e=>[e.side,e.before,e.after,e.chainLink]),[[other,8000,7200,2],[side,8000,9000,1]]);
  assert.equal(events.at(-1).stage,'complete');assert.equal(chainSummary(s).completed,true);await replay(s);
 }finally{engine.destroyMatch(s);}
});

test('duplicate existing card names block Chain Strike and Accumulated Fortune; a fresh chain resets numbering',async()=>{
 let s=await game({hands:[['Chain Strike','Accumulated Fortune'],[]],spells:[['Jar of Greed','Chain Healing','Accumulated Fortune'],['Jar of Greed']]});
 try{
  s=activate(s,'Jar of Greed',0);s=activate(s,'Jar of Greed',1);
  assert.equal(s.chain.length,2);assert.equal(available(s,'Chain Strike',0),undefined);
  s=activate(s,'Chain Healing',0);assert.ok(s.log.some(e=>e.chainNotice?.stage==='add'&&e.chainNotice.link===3));
  const actor=s.actions[0].length?0:1;if(actor===1&&s.actions[1].some(a=>a.type==='PASS'))s=engine.applyAction(s,s.actions[1].find(a=>a.type==='PASS'),1);
  assert.equal(available(s,'Accumulated Fortune',0),undefined);assert.equal(available(s,'Chain Strike',0),undefined);s=settle(s);
  assert.equal(s.chain.length,0);assert.equal(available(s,'Chain Strike',0),undefined);await replay(s);
 }finally{engine.destroyMatch(s);}
});

for(const name of ['Chain Healing','Chain Detonation'])for(const link of [1,2,3,4])test(`${name} uses its activation link ${link} for its return destination`,async()=>{
 const side=link===4?1:0,other=1-side,spells=[['Waboku'],['Jar of Greed']];spells[side].push(name);
 let s=await game({spells});
 try{
  if(link>1)s=activate(s,'Dian Keto the Cure Master',0);
  if(link>2)s=activate(s,'Jar of Greed',1);
  if(link>3)s=activate(s,'Waboku',0);
  s=activate(s,name,side);assert.equal(s.chain.length,link);const before=s;s=settle(s);
  const life=duelFeedback(before,s).find(e=>e.source===name);assert.ok(life);assert.equal(life.amount,500);assert.equal(life.chainLink,link);assert.equal(life.side,name==='Chain Healing'?side:other);
  const zone=link===1?'grave':link===4?'hand':'deck';assert.ok(s.players[side][zone].some(c=>c.card.name===name));await replay(s);
 }finally{engine.destroyMatch(s);}
});

test('LP event feedback preserves a loss and gain even when the final total is unchanged',()=>{
 const previous={serial:0,players:[{lp:8000},{lp:8000}]},next={players:[{lp:8000},{lp:8000}],log:[{id:1,lifeNotice:{side:0,before:8000,after:7000,delta:-1000,amount:1000,kind:'cost'}},{id:2,lifeNotice:{side:0,before:7000,after:8000,delta:1000,amount:1000,kind:'gain'}}]};
 assert.deepEqual(duelFeedback(previous,next).map(e=>e.delta),[-1000,1000]);
});

test('centred feedback animates each amount monotonically and cancellation releases the sequence',async()=>{
 const window=new Window(),d=window.document;d.body.innerHTML='<main><div data-field-lp="0"><b data-lp-value="0">8,000</b></div><div id="feedback"></div></main>';const root=d.querySelector('#feedback'),arena=d.querySelector('main'),player=createFeedbackPlayer({getRoot:()=>root,getArena:()=>arena,hold:20});
 try{
  const values=[],observer=new window.MutationObserver(()=>values.push(Number(d.querySelector('[data-lp-value]').textContent.replaceAll(',',''))));observer.observe(d.querySelector('[data-lp-value]'),{childList:true,subtree:true});
  const promise=player.play([{type:'life',side:0,before:8000,after:6000,delta:-2000,amount:2000,kind:'damage'}],{reduced:true});assert.match(root.textContent,/−2,000/);assert.equal(root.textContent,'−2,000');assert.match(root.firstElementChild.getAttribute('aria-label'),/YOU/);await promise;assert.equal(d.querySelector('[data-lp-value]').textContent,'6,000');assert.equal(root.childElementCount,0);assert.ok(values.every((n,i)=>n>=6000&&n<=8000&&(!i||n<=values[i-1])));observer.disconnect();
  const pending=player.play([{type:'chain',stage:'add',link:2,total:2,card:get('Chain Strike'),side:0}]);assert.ok(root.querySelector('.duel-chain-art'));assert.match(root.firstElementChild.getAttribute('aria-label'),/Chain Link 2/);player.cancel();assert.equal(await pending,false);assert.equal(root.childElementCount,0);
  await player.play([{type:'life',side:0,before:6000,after:6500,delta:500,amount:500,kind:'gain'}],{enabled:false});assert.match(root.textContent,/\+500/);assert.equal(d.querySelector('[data-lp-value]').textContent,'6,500');player.cancel();
 }finally{player.cancel();window.close();}
});

test('two Chain Strikes may join one chain, then a third is blocked; each keeps its own multiplier',async()=>{
 let s=await game({hands:[['Dian Keto the Cure Master','Chain Strike','Chain Strike','Chain Strike'],[]],spells:[[],[]]});const before=s;
 try{
  s=activate(s,'Dian Keto the Cure Master',0);s=activate(s,'Chain Strike',0);s=activate(s,'Chain Strike',0);s=settle(s);
  assert.equal(s.players[1].lp,6000);assert.equal(s.players[0].hand.filter(c=>c.card.name==='Chain Strike').length,1);
  assert.deepEqual(duelFeedback(before,s).filter(e=>e.type==='life'&&e.source==='Chain Strike').map(e=>[e.amount,e.chainLink]),[[1200,3],[800,2]]);await replay(s);
 }finally{engine.destroyMatch(s);}
});
test('native recovery and damage in the same chain remain two visible events even at zero net change',async()=>{
 let s=await game({hands:[[],[]],spells:[['Chain Healing'],['Chain Detonation']]});const before=s;
 try{s=activate(s,'Chain Healing',0);s=activate(s,'Chain Detonation',1);s=settle(s);assert.equal(s.players[0].lp,8000);assert.deepEqual(duelFeedback(before,s).filter(e=>e.type==='life').map(e=>[e.before,e.after]),[[8000,7500],[7500,8000]]);await replay(s);}finally{engine.destroyMatch(s);}
});
test('negated activation has an explicit chain cue and no phantom recovery; LP costs remain separate',async()=>{
 let s=await game({hands:[[],[]],spells:[['Chain Healing'],['Seven Tools of the Bandit']]});const before=s;
 try{
  s=activate(s,'Chain Healing',0);s=activate(s,'Seven Tools of the Bandit',1);s=settle(s);
  assert.equal(s.players[0].lp,8000);assert.equal(s.players[1].lp,7000);const events=duelFeedback(before,s);
  assert.deepEqual(events.filter(e=>e.stage==='negated').map(e=>e.link),[1]);assert.equal(events.filter(e=>e.type==='life').length,1);assert.equal(events.find(e=>e.type==='life').kind,'cost');assert.equal(chainSummary(s).links.find(e=>e.link===1).status,'negated');await replay(s);
 }finally{engine.destroyMatch(s);}
});

test('Mystical Wind Typhoon is offered from Link 3, selects a real target, and resolves',async()=>{
 let s=await game({hands:[['Dian Keto the Cure Master','Mystical Wind Typhoon'],[]],spells:[[],['Jar of Greed']]});const before=s;
 try{s=activate(s,'Dian Keto the Cure Master',0);assert.equal(available(s,'Mystical Wind Typhoon',0),undefined);s=activate(s,'Jar of Greed',1);assert.ok(available(s,'Mystical Wind Typhoon',0));s=activate(s,'Mystical Wind Typhoon',0);s=settle(s);assert.ok(duelFeedback(before,s).some(e=>e.stage==='resolved'&&e.link===3&&e.card.name==='Mystical Wind Typhoon'));await replay(s);}finally{engine.destroyMatch(s);}
});
test('Miraculous Rebirth waits for Link 4 and summons its chosen graveyard target',async()=>{
 let s=await game({hands:[['Dian Keto the Cure Master','Miraculous Rebirth'],[]],spells:[['Waboku'],['Jar of Greed']],graves:[['Mystical Elf'],[]]});const before=s;
 try{s=activate(s,'Dian Keto the Cure Master',0);assert.equal(available(s,'Miraculous Rebirth',0),undefined);s=activate(s,'Jar of Greed',1);assert.equal(available(s,'Miraculous Rebirth',0),undefined);s=activate(s,'Waboku',0);s=activate(s,'Miraculous Rebirth',0);s=settle(s);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Mystical Elf'));assert.ok(duelFeedback(before,s).some(e=>e.stage==='resolved'&&e.link===4&&e.card.name==='Miraculous Rebirth'));await replay(s);}finally{engine.destroyMatch(s);}
});
test("Vanity's Call pays half LP and visibly negates all three earlier links",async()=>{
 let s=await game({spells:[['Waboku'],['Jar of Greed',"Vanity's Call"]]});const before=s;
 try{s=activate(s,'Dian Keto the Cure Master',0);s=activate(s,'Jar of Greed',1);s=activate(s,'Waboku',0);s=activate(s,"Vanity's Call",1);s=settle(s);assert.equal(s.players[0].lp,8000);assert.equal(s.players[1].lp,4000);const events=duelFeedback(before,s);assert.deepEqual(events.filter(e=>e.stage==='negated').map(e=>e.link).sort(),[1,2,3]);assert.deepEqual(events.filter(e=>e.type==='life').map(e=>[e.kind,e.amount]),[['cost',4000]]);await replay(s);}finally{engine.destroyMatch(s);}
});

test('production response UI exposes the exact next link, returns from chain inspection, and keeps the completed chain',async()=>{
 const {createSoloController}=await import('../src/duel/ui.js');
 const catalog=[...new Map([...cards,...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard)].map(c=>[c.id,c])).values()];
 let s=await game({hands:[['Dian Keto the Cure Master','Chain Strike'],[]],spells:[[],[]]});s=activate(s,'Dian Keto the Cure Master',0);
 const window=new Window({url:'https://example.com/duel/'});window.happyDOM.setWindowSize({width:844,height:390});window.document.body.innerHTML='<main></main><dialog></dialog>';
 for(const k of ['window','document','localStorage'])Object.defineProperty(globalThis,k,{value:window[k],writable:true,configurable:true});
 localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,aiSpeed:'fast',first:'you'}));
 const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[],$=q=>document.querySelector(q);
 const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;modal.setAttribute('open','');},closeDialog:()=>modal.removeAttribute('open'),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:e=>errors.push(e),onDesign(){},engine:{...engine,createMatch:async()=>s}});
 const until=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),JSON.stringify({errors,text:main.textContent,state:controller.getMatch()?.phase}));};
 try{
  controller.enter();$('[data-duel="start"]').click();await until(()=>$('[data-duel="response-activate"]'));
  assert.match($('[data-duel="response-activate"]').textContent,/Link 2/);const checkpoint=engine.exportMatch(controller.getMatch()).checkpoint;
  $('.duel-response-chain').click();assert.match(modal.textContent,/Dian Keto/);assert.match(modal.textContent,/Link 2/);$('[data-duel="chain-back"]').click();assert.ok($('.duel-response-body'));assert.equal(engine.exportMatch(controller.getMatch()).checkpoint,checkpoint);
  $('[data-duel="response-activate"]').click();await until(()=>controller.getMatch().players[1].lp===7200&&$('.duel-arena').dataset.moving==='false');
  assert.equal($('.duel-feedback-host').textContent,'−800+1,000');assert.match($('.duel-chain-open').textContent,/Last chain 2/);$('.duel-chain-open').click();assert.deepEqual([...modal.querySelectorAll('.duel-chain-list [data-chain-link]')].map(e=>e.dataset.chainLink),['2','1']);$('[data-duel="chain-back"]').click();assert.equal(modal.open,false,'Completed history returns to the field rather than a stale response');assert.equal(controller.getMatch().players[1].lp,7200);assert.deepEqual(errors,[]);
 }finally{controller.destroy();window.close();}
});
