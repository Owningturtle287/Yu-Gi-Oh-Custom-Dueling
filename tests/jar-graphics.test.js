import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {chainArtwork,chainRackHTML} from '../src/duel/chain-art.js';
import {declarationIcon} from '../src/duel/declaration-icons.js';
import {flightGeometry,createFeedbackPlayer} from '../src/duel/feedback.js';
const cards=JSON.parse(await readFile(new URL('./jar-graphics-fixtures.json',import.meta.url))).data.map(normalizeCard),get=n=>{const c=cards.find(c=>c.name===n);assert.ok(c,n);return c;};
const pack=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))}),engine=createNativeBackend({rules:()=>pack});
async function jar(side=0,revealVersion=2,modifier=null){const fields=[{},{}];fields[side]={monsters:[{card:get('Morphing Jar #2'),faceUp:false,defense:true},{card:get('Mystical Elf')}]};fields[1-side]={monsters:[{card:get('Mystical Elf')}]};if(modifier)fields[0].spells=[{card:get(modifier),faceUp:true}];let s=await engine.createMatch([0,1].map(()=>({name:'Jar UX',main:['Dark Hole','Pot of Greed','Dark Magician','Mystical Elf','Dark Hole','Pot of Greed'].map(get),extra:[]})),{cards,seed:3,first:side,openingHands:[[],[]],initialFields:fields,revealVersion});s=engine.applyAction(s,s.actions[side].find(a=>a.type==='POSITION'&&a.flip),side);return s;}
function finish(s){for(let i=0;i<100&&(s.choice||s.window||s.reveals?.length);i++){const side=s.actions[0].length?0:1,a=s.actions[side].find(a=>a.type==='ACK_REVEAL'||a.type==='PASS')||engine.chooseAIAction(s,side);assert.ok(a);s=engine.applyAction(s,a,side);}return s;}
for(const side of [0,1])test(`Morphing Jar #2 separates both excavations and records real destinations, controller ${side}`,async()=>{
 let s=await jar(side);try{
  assert.equal(s.reveals.length,2);assert.ok(s.reveals.every(r=>r.viewer===0&&r.excavation&&r.ordered));assert.deepEqual(new Set(s.reveals.map(r=>r.cards[0].controller)),new Set([0,1]));
  for(const group of s.excavationReport.groups){assert.ok(group.cards.every(c=>c.result==='Set in Defense'||c.result==='Sent to GY'));const owner=group.cards[0].controller;assert.equal(group.remaining,s.players[owner].deck.length);assert.ok(group.cards.filter(c=>c.card.type.includes('Monster')).length===(owner===side?2:1));for(const c of group.cards)if(!c.card.type.includes('Monster')||c.card.level>4)assert.equal(c.result,'Sent to GY');}
  const snapshot=structuredClone(s.excavationReport);s=finish(s);assert.deepEqual(s.excavationReport,snapshot);assert.equal(s.reveals.length,0);
  const saved=engine.exportMatch(s),copy=await engine.restoreMatch(saved,{cards});assert.equal(engine.exportMatch(copy).checkpoint,saved.checkpoint);const view=r=>r.groups.map(g=>({owner:g.cards[0].controller,remaining:g.remaining,cards:g.cards.map(c=>[c.card.id,c.result])}));assert.deepEqual(view(copy.excavationReport),view(s.excavationReport));engine.destroyMatch(copy);
 }finally{engine.destroyMatch(s);}
});
test('original v0.5.6 Morphing Jar save replays with its original merged reveal protocol',async()=>{
 const save=JSON.parse(await readFile(new URL('./jar-v056-save.json',import.meta.url)));assert.equal(save.presentationRevision,3);assert.equal(save.options.revealVersion,undefined);const s=await engine.restoreMatch(save,{cards});try{assert.equal(engine.exportMatch(s).checkpoint,save.checkpoint);assert.equal(engine.exportMatch(s).options.revealVersion,1);}finally{engine.destroyMatch(s);}
});
test('LP flights use the correct local destination in landscape and rotated portrait',()=>{
 const doc={documentElement:{dataset:{}}},root={ownerDocument:doc,clientWidth:800,clientHeight:360,getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:360,width:800,height:360})},target={getBoundingClientRect:()=>({left:20,top:300,right:100,bottom:340,width:80,height:40})};assert.deepEqual(flightGeometry(root,target).to,{x:60,y:320});doc.documentElement.dataset.duelRotated='true';root.getBoundingClientRect=()=>({left:0,top:0,right:360,bottom:800,width:360,height:800});target.getBoundingClientRect=()=>({left:20,top:20,right:60,bottom:100,width:40,height:80});assert.deepEqual(flightGeometry(root,target).to,{x:60,y:320});
});
test('chain artwork has isolated paint IDs, separate break halves and accessible individual links',()=>{
 const a=chainArtwork(2),b=chainArtwork(3,{broken:true});assert.notEqual(a.match(/id="([^"]+)/)[1],b.match(/id="([^"]+)/)[1]);assert.match(b,/chain-half-left/);assert.match(b,/chain-half-right/);assert.match(b,/chain-sparks/);const html=chainRackHTML([{chainLink:1,card:get('Dark Hole')},{chainLink:2,card:get('Pot of Greed'),status:'resolved'}]);assert.match(html,/Chain Link 1: Dark Hole/);assert.doesNotMatch(html,/Chain Link 2/);
});
test('type and attribute emblems use distinct coloured artwork, including sword, staff, wings and divine variants',()=>{
 const labels=['Warrior','Spellcaster','Fairy','Fiend','Zombie','Machine','Aqua','Pyro','Rock','Winged Beast','Plant','Insect','Thunder','Dragon','Beast','Beast-Warrior','Dinosaur','Fish','Sea Serpent','Reptile','Psychic','Divine-Beast','Creator God','Wyrm','Cyberse','Illusion'];const svg=labels.map(n=>declarationIcon(n));assert.equal(new Set(svg).size,labels.length);for(const icon of svg){assert.match(icon,/viewBox="0 0 32 32"/);assert.match(icon,/fill="#/);}assert.notEqual(declarationIcon('DIVINE','attribute'),declarationIcon('DIVINE','race'));
});
test('two-second add flight docks a clickable link; resolution breaks and removes it, without an old text panel',async()=>{
 const window=new Window(),d=window.document;d.body.innerHTML='<main><div class="duel-arena" data-moving="false"></div><nav class="duel-chain-rack"></nav><div id="flight"></div></main>';const arena=d.querySelector('main'),root=d.querySelector('#flight'),frames=[];
 const animate=function(keyframes,options){frames.push({node:this,options,keyframes});return{finished:Promise.resolve(),cancel(){}};};window.HTMLElement.prototype.animate=animate;window.SVGElement.prototype.animate=animate;
 const player=createFeedbackPlayer({getRoot:()=>root,getArena:()=>arena,hold:10});try{
  await player.play([{type:'chain',stage:'add',link:1,card:get('Dark Hole'),side:0}]);assert.equal(frames[0].options.duration,20);assert.equal(arena.querySelectorAll('[data-chain-link]').length,1);assert.doesNotMatch(root.innerHTML,/duel-feedback-panel/);
  await player.play([{type:'chain',stage:'resolved',link:1,side:0}],{chain:[{chainLink:1,card:get('Dark Hole')}]});assert.equal(arena.querySelectorAll('[data-chain-link]').length,0);assert.ok(frames.some(f=>f.node.classList.contains('chain-half-left')));
 }finally{player.cancel();window.close();}
});
test('excavation UI keeps both owners, destinations and card inspection accessible after acknowledging the reveal',async()=>{
 const {createSoloController}=await import('../src/duel/ui.js'),catalog=[...new Map([...cards,...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard)].map(c=>[c.id,c])).values()];let state=await jar();const window=new Window({url:'https://example.com/'});window.happyDOM.setWindowSize({width:844,height:390});window.document.body.innerHTML='<main></main><dialog></dialog>';for(const k of ['window','document','localStorage'])Object.defineProperty(globalThis,k,{value:window[k],writable:true,configurable:true});localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'fast'}));const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[],$=s=>document.querySelector(s);
 const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,cls)=>{modal.innerHTML=`<div class="dialog-body ${cls}">${html}</div>`;modal.setAttribute('open','');},closeDialog:()=>modal.removeAttribute('open'),dialogHeader:t=>`<div class="dialog-header"><h2>${t}</h2><button data-action="close">×</button></div>`,toast:e=>errors.push(e),onDesign(){},engine:{...engine,createMatch:async()=>state}});
 const until=async p=>{const end=Date.now()+5000;while(!p()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.ok(p(),JSON.stringify(errors));};
 try{controller.enter();$('[data-duel="start"]').click();await until(()=>$('.duel-reveal-body'));assert.match($('.duel-reveal-caption').textContent,/Your excavation/);assert.ok($('.excavation-result'));$('[data-duel="reveal-done"]').click();await until(()=>controller.getMatch().reveals.length===1&&$('.duel-arena').dataset.moving==='false');await until(()=>$('.duel-reveal-caption')?.textContent.includes('AI'));$('[data-duel="reveal-done"]').click();await until(()=>!controller.getMatch().reveals.length&&$('.duel-arena').dataset.moving==='false');$('[data-duel="excavation"]').click();assert.equal(modal.querySelectorAll('[data-excavation-side]').length,2);assert.match(modal.textContent,/Set.*to GY.*left in Deck/);const names=[...modal.querySelectorAll('.duel-excavation-cards b')].map(n=>n.textContent);$('[data-excavation-read="0"]').click();assert.ok($('.selection-info-art'));$('[data-duel="selection-back"]').click();assert.deepEqual([...modal.querySelectorAll('.duel-excavation-cards b')].map(n=>n.textContent),names);$('[data-excavation-side="1"]').click();assert.ok(modal.querySelectorAll('.duel-excavation-cards li').length);assert.deepEqual(errors,[]);}finally{controller.destroy();window.close();}
});

for(const side of [0,1])test(`a battle-destroyed Morphing Jar #2 stays in the GY and does not count toward excavation, side ${side}`,async()=>{
 const {damageDuel,advanceBattle}=await import('./battle-fixtures.js');let s=await damageDuel(engine,cards,{defender:'Morphing Jar #2',attacker:'Blue-Eyes White Dragon',defendingSide:side,traps:['Waboku']});
 try{s=advanceBattle(engine,s,s=>!!s.excavationReport);assert.ok(s.players[side].grave.some(c=>c.card.name==='Morphing Jar #2'));assert.ok(s.excavationReport.groups.every(g=>g.cards[0].controller===1-side));assert.ok(s.excavationReport.groups.flatMap(g=>g.cards).every(c=>c.result));}finally{engine.destroyMatch(s);}
});

for(const modifier of ['Macro Cosmos','Light of Intervention'])test(`excavation results reflect actual ${modifier} replacements`,async()=>{
 let s=await jar(0,2,modifier);try{const entries=s.excavationReport.groups.flatMap(g=>g.cards);assert.ok(entries.length);assert.ok(entries.every(c=>c.result));if(modifier==='Macro Cosmos'){assert.ok(entries.some(c=>c.result==='Banished'));assert.ok(!entries.some(c=>c.result==='Sent to GY'));}else{assert.ok(entries.some(c=>c.result==='Summoned in Defense'));assert.ok(!entries.some(c=>c.result==='Set in Defense'));}}finally{engine.destroyMatch(s);}
});
