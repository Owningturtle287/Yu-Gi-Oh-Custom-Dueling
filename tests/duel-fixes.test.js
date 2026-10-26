import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard,createDeck,addCard,cardCopyName} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend,nativeSeed} from '../src/duel/native-engine.js';
import {createSoloController} from '../src/duel/ui.js';
import {defaultSide,generateDeck,prepareAIDeck,expandDeck,validateDuelDeck,eligibleSets} from '../src/duel/decks.js';
import {seededRandom,shuffled,deriveSeed} from '../src/duel/random.js';
import {activationText,activationUnchanged} from '../src/duel/native-prompts.js';
import {createResponsePolicy} from '../src/duel/responses.js';
import {command,advanceBattle,damageDuel,selectCard} from './battle-fixtures.js';
const raw=(await Promise.all(['rules','audit','level-up','duel-fixes'].map(async name=>JSON.parse(await readFile(new URL(`./${name}-fixtures.json`,import.meta.url))).data))).flat();
const cards=[...new Map(raw.map(c=>[c.id,normalizeCard(c)])).values()],get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;};
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>pack});
const decks=()=>[0,1].map(()=>({name:'Regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
const clear=(e,s)=>advanceBattle(e,s,s=>!s.choice&&!s.window&&!s.reveals?.length);
for(const side of [0,1])test(`Slate Warrior gains 500 after a surviving battle or Flip Summon, side ${side}`,async()=>{
 const e=backend();let s=await damageDuel(e,cards,{defender:'Slate Warrior',attacker:'Kuriboh',traps:['Castle Walls'],defendingSide:side});
 try{s=advanceBattle(e,s,s=>!s.pending&&!s.choice&&!s.window);const slate=s.players[side].monsters.find(c=>c?.card.name==='Slate Warrior');assert.ok(slate);assert.deepEqual(e.stats(s,slate),{atk:2400,def:900});assert.ok(s.log.find(e=>e.kind==='battle').message.includes('400 DEF'));const flip=s.log.findIndex(e=>e.kind==='activate'&&/Slate Warrior/.test(e.message)),battle=s.log.findIndex(e=>e.kind==='battle');assert.ok(flip>battle);}
 finally{e.destroyMatch(s);}
 s=await e.createMatch(decks(),{cards,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Slate Warrior'),faceUp:false,defense:true}]},{}]});
 try{s=clear(e,command(e,s,'POSITION'));assert.deepEqual(e.stats(s,s.players[0].monsters[0]),{atk:2400,def:900});}finally{e.destroyMatch(s);}
});
test('Slate Warrior cannot prevent an already calculated battle destruction; its other effect weakens the attacker',async()=>{
 const e=backend();let s=await damageDuel(e,cards,{defender:'Slate Warrior',attacker:'Beaver Warrior',traps:['Castle Walls']});
 try{s=advanceBattle(e,s,s=>!s.pending&&!s.choice&&!s.window);assert.ok(s.players[0].grave.some(c=>c.card.name==='Slate Warrior'));assert.deepEqual(e.stats(s,s.players[1].monsters[0]),{atk:700,def:1000});assert.ok(s.log.some(e=>e.kind==='activate'&&/Slate Warrior/.test(e.message)));}finally{e.destroyMatch(s);}
});
test('Nobleman-Eater Bug cannot target its battle-destroyed self to make up a missing second target',async()=>{
 const e=backend();let s=await damageDuel(e,cards,{defender:'Nobleman-Eater Bug',attacker:'Blue-Eyes White Dragon',traps:['Castle Walls']});
 try{s=advanceBattle(e,s,s=>!s.pending&&!s.choice&&!s.window);assert.ok(s.players[0].grave.some(c=>c.card.name==='Nobleman-Eater Bug'));assert.ok(s.players[1].monsters[0]);assert.ok(s.log.some(e=>e.effectNotice?.text.includes('exactly 2 legal monsters')));}finally{e.destroyMatch(s);}
});
test('Nobleman-Eater Bug resolves after being defeated when two other legal targets exist',async()=>{
 const e=backend();let s=await e.createMatch(decks(),{cards,first:0,seed:91,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Nobleman-Eater Bug'),faceUp:false,defense:true},{card:get('Mystical Elf')}]},{monsters:[{card:get('Blue-Eyes White Dragon')}]}]});
 try{
  s=clear(e,command(e,s,'END',0));s=command(e,s,'NEXT',1);s=advanceBattle(e,s,s=>s.actions[1].some(a=>a.type==='ATTACK'));s=command(e,s,'ATTACK',1);s=selectCard(e,s,s.players[0].monsters[0].uid);
  s=advanceBattle(e,s,s=>s.choice?.source?.card.name==='Nobleman-Eater Bug'&&s.choice.stage);
  assert.equal(s.choice.min,2);const targets=s.actions[0].filter(a=>a.target);assert.equal(targets.length,2);assert.ok(targets.every(a=>e.findCard(s,a.target).card.name!=='Nobleman-Eater Bug'));
  for(const target of targets)s=e.applyAction(s,s.actions[0].find(a=>a.target===target.target),0);
  s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);s=advanceBattle(e,s,s=>!s.pending&&!s.choice&&!s.window);assert.equal(s.players.flatMap(p=>p.monsters.filter(Boolean)).length,0);
 }finally{e.destroyMatch(s);}
});
test('Cyber Jar publicly reveals each deck before any position choice, identifies each summoned monster, and replays',async()=>{
 const e=backend(),names=['Mystical Elf','Kuriboh','Pot of Greed','Dark Magician','Beaver Warrior'];let s=await e.createMatch([0,1].map(()=>({name:'Cyber Jar',main:Array.from({length:40},(_,i)=>get(names[i%5])),extra:[]})),{cards,seed:29,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Cyber Jar'),faceUp:false,defense:true}]},{}]});let restored;
 try{
  s=command(e,s,'POSITION');s=advanceBattle(e,s,s=>s.reveals?.length>0);
  assert.equal(s.actions[0][0].type,'ACK_REVEAL');assert.equal(s.reveals[0].cards.length,5);assert.equal(s.reveals[0].viewer,0);assert.equal(s.reveals[0].deckTop,true);assert.equal(s.reveals[0].source.name,'Cyber Jar');
  const snapshot=e.exportMatch(s);restored=await e.restoreMatch(JSON.parse(JSON.stringify(snapshot)),{cards});assert.equal(e.exportMatch(restored).checkpoint,snapshot.checkpoint);
  s=e.applyAction(s,s.actions[0][0],0);let positions=0,reveals=1;
  for(let n=0;n<100&&(s.choice||s.window||s.reveals?.length);n++){
   const side=s.actions[0].length?0:1;
   if(s.reveals?.length){reveals++;assert.equal(side,0);assert.equal(s.reveals[0].cards.length,5);s=e.applyAction(s,s.actions[0][0],0);continue;}
   if(s.choice?.selectionType==='select_position'){positions++;assert.ok(names.includes(s.choice.positionCard.card.name));assert.notEqual(s.choice.positionCard.card.name,'Cyber Jar');assert.match(s.choice.instructions,new RegExp(s.choice.positionCard.card.name));}
   s=e.applyAction(s,s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side),side);
  }
  assert.equal(reveals,2);assert.ok(positions>0);assert.ok(s.players.every(p=>p.monsters.some(Boolean)));
  const legacy=e.exportMatch(s);legacy.presentationRevision=2;legacy.history=legacy.history.filter(h=>h.type!=='ACK_REVEAL');const old=await e.restoreMatch(legacy,{cards});try{assert.equal(e.exportMatch(old).checkpoint,legacy.checkpoint);}finally{e.destroyMatch(old);}
 }finally{e.destroyMatch(s);e.destroyMatch(restored);}
});
test('Auto-pass stops for End and Standby Phase triggers and preserves their explicit decline',async()=>{
 const e=backend();let s=await e.createMatch(decks(),{cards,first:1,openingHands:[[get('Armed Dragon LV5')],[]],initialFields:[{monsters:[{card:get('Armed Dragon LV3')}]},{}]});
 try{const policy=createResponsePolicy();s=command(e,s,'END',1);policy.passTurn(s);assert.equal(s.choice.phaseTrigger,true);assert.equal(policy.action(s,s.actions[0]),null);assert.ok(s.actions[0].some(a=>a.yes===false));}finally{e.destroyMatch(s);}
});
test('effect preview distinguishes the Armed Dragon destruction cost from the End Phase level-up',()=>{
 const card=get('Armed Dragon LV5'),destroy=activationText(card,{effectText:'Destroy'},'main1'),summon=activationText(card,{effectText:'Special Summon'},'end');
 assert.match(destroy,/send 1 monster from your hand/);assert.doesNotMatch(destroy,/Special Summon/);assert.match(summon,/send this card/);assert.match(summon,/Armed Dragon LV7/);
});
test('AI sizes 30–60, small-set supplements, and custom-deck supplements preserve filters and copy limits',()=>{
 const normals=cards.filter(c=>c.type==='Normal Monster'&&c.level<=4),catalog=normals.map((c,i)=>({...c,setNames:i<2?['Tiny set']:[]})),sets=[{name:'Tiny set',date:'2002-01-01'}];assert.ok(normals.length>=20);
 for(const size of [30,31,40,53,60]){
  const settings={...defaultSide(),size,supplement:true,source:'set',set:'Tiny set',spells:false,traps:false};assert.equal(eligibleSets(catalog,sets,settings)[0].problem,'');
  const generated=generateDeck(catalog,settings,sets,143);assert.equal(expandDeck(generated,catalog).main.length,size);assert.ok(generated.sections.main.some(e=>e.card.setNames.includes('Tiny set')));assert.ok(generated.sections.main.some(e=>!e.card.setNames.includes('Tiny set')));assert.deepEqual(validateDuelDeck(generated,catalog,settings,{min:30}),[]);
  let custom=createDeck('Keep my cards');for(let i=0;i<5;i++)custom=addCard(custom,catalog[i]);const before=JSON.stringify(custom),filled=prepareAIDeck(custom,catalog,settings,27);assert.equal(JSON.stringify(custom),before);assert.equal(expandDeck(filled,catalog).main.length,size);assert.ok(custom.sections.main.every(old=>filled.sections.main.some(e=>e.card.id===old.card.id&&e.quantity>=old.quantity)));assert.ok(filled.sections.main.every(e=>e.quantity<=3));
 }
 let large=createDeck('Large');for(const card of catalog.slice(0,20))for(let i=0;i<3;i++)large=addCard(large,card);const original=JSON.stringify(large),small=prepareAIDeck(large,catalog,{...defaultSide(),size:30},3);assert.equal(expandDeck(small,catalog).main.length,30);assert.equal(JSON.stringify(large),original);
 assert.throws(()=>prepareAIDeck(createDeck('Empty'),catalog.slice(0,2),{...defaultSide(),size:60},2),/cannot fill/);
});
test('shuffles are permutations, reproduce saved seeds, mix nearby seeds and have balanced card positions',()=>{
 const input=Array.from({length:10},(_,i)=>i),counts=Array.from({length:10},()=>Array(10).fill(0)),orders=new Set();
 for(let seed=0;seed<5000;seed++){const order=shuffled(input,seededRandom(seed));orders.add(order.join(','));assert.deepEqual([...order].sort((a,b)=>a-b),input);order.forEach((card,i)=>counts[card][i]++);}
 assert.ok(orders.size>4900);assert.ok(counts.flat().every(n=>n>350&&n<650));assert.deepEqual(input,Array.from({length:10},(_,i)=>i));assert.deepEqual(shuffled(input,seededRandom(0)),shuffled(input,seededRandom(0)));assert.notDeepEqual(shuffled(input,seededRandom(0)),shuffled(input,seededRandom(1)));assert.notEqual(deriveSeed(9,'opening-0'),deriveSeed(9,'opening-1'));assert.notDeepEqual(nativeSeed(0,3),nativeSeed(1,3));
});
test('new native openings use separate mixed player streams; old randomness versions remain replayable',async()=>{
 const e=backend(),catalog=cards.filter(c=>c.type==='Normal Monster').slice(0,20),d=[0,1].map(()=>({name:'Independent hands',main:Array.from({length:40},(_,i)=>catalog[i%catalog.length]),extra:[]}));
 for(const randomVersion of [1,2,3]){let s=await e.createMatch(d,{cards,seed:125,randomVersion}),restored;try{assert.notDeepEqual(s.players[0].hand.map(c=>c.card.id),s.players[1].hand.map(c=>c.card.id));const save=e.exportMatch(s);restored=await e.restoreMatch(JSON.parse(JSON.stringify(save)),{cards});assert.equal(e.exportMatch(restored).checkpoint,save.checkpoint);}finally{e.destroyMatch(s);e.destroyMatch(restored);}}
});
const waitFor=async fn=>{const end=Date.now()+3000;while(!fn()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.ok(fn(),'Duel UI ready');};
async function rig(e,state){
 const window=new Window({url:'https://example.com/'});window.document.body.innerHTML='<main></main><dialog id="modal"></dialog>';
 for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
 localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,first:'you',aiSpeed:'deliberate'}));const main=document.querySelector('main'),modal=document.querySelector('dialog'),errors=[];
 const closeDialog=()=>{modal.removeAttribute('open');modal.dispatchEvent(new window.Event('close'));};document.addEventListener('click',ev=>{if(ev.target.closest('[data-action="close"]'))closeDialog();});
 const controller=createSoloController({engine:{...e,createMatch:async()=>state},main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,kind='')=>{modal.innerHTML=`<div class="dialog-body ${kind}">${html}</div>`;modal.setAttribute('open','');},closeDialog,dialogHeader:title=>`<header class="dialog-header"><h2>${title}</h2><button data-action="close">Back</button></header>`,toast:m=>errors.push(m),onDesign(){}});
 controller.enter();main.querySelector('[data-duel="start"]').click();await waitFor(()=>main.querySelector('.duel-arena')?.dataset.moving==='false');
 return {window,controller,errors,$:s=>document.querySelector(s),close(){controller.destroy();window.close();}};
}
test('a mistaken Armed Dragon effect can be reviewed and canceled after staging, before sending LV7 as its cost',async()=>{
 const e=backend();let s=await e.createMatch(decks(),{cards,seed:17,openingHands:[[get('Armed Dragon LV7')],[]],initialFields:[{monsters:[{card:get('Armed Dragon LV5')}]},{monsters:[{card:get('Mystical Elf')}]}]});const r=await rig(e,s);
 try{
  const checkpoint=e.exportMatch(r.controller.getMatch()).checkpoint,open=()=>{const low=r.controller.getMatch().players[0].monsters[0];r.$(`[data-duel-card="${low.uid}"]`).click();[...document.querySelectorAll('[data-duel-group]')].find(b=>b.textContent.includes('Activate')).click();};
  open();assert.match(r.$('.duel-activation-review').textContent,/Activate · Destroy/);assert.match(r.$('[aria-label="Effect to activate"]').textContent,/send 1 monster from your hand/);assert.equal(e.exportMatch(r.controller.getMatch()).checkpoint,checkpoint);r.$('[data-action="close"]').click();assert.equal(e.exportMatch(r.controller.getMatch()).checkpoint,checkpoint);
  open();r.$('[data-duel="confirm-activation"]').click();await waitFor(()=>r.$('.duel-picker-body')&&r.$('.duel-arena').dataset.moving==='false');assert.ok(r.$('[data-duel="cancel-activation"]'));
  r.$('.duel-choice-card').click();await waitFor(()=>r.$('.duel-choice-card[aria-pressed=true]')&&r.$('.duel-arena').dataset.moving==='false');assert.equal(r.controller.getMatch().players[0].grave.length,0);r.$('[data-duel="cancel-activation"]').click();await waitFor(()=>!r.controller.getMatch().choice&&r.$('.duel-arena').dataset.moving==='false');
  assert.equal(e.exportMatch(r.controller.getMatch()).checkpoint,checkpoint);assert.ok(r.controller.getMatch().players[0].hand.some(c=>c.card.name==='Armed Dragon LV7'));assert.deepEqual(r.errors,[]);
  open();r.$('[data-duel="confirm-activation"]').click();await waitFor(()=>r.$('.duel-picker-body')&&r.$('.duel-arena').dataset.moving==='false');r.$('.duel-choice-card').click();await waitFor(()=>r.$('.duel-choice-footer [data-choice-tone=teal]:not([disabled])')&&r.$('.duel-arena').dataset.moving==='false');r.$('.duel-choice-footer [data-choice-tone=teal]').click();await waitFor(()=>r.controller.getMatch().players[0].grave.some(c=>c.card.name==='Armed Dragon LV7')&&r.$('.duel-arena').dataset.moving==='false');assert.equal(r.$('dialog[open] [data-duel="cancel-activation"], main [data-duel="cancel-activation"]'),null,'Paid costs are committed');
 }finally{r.close();}
});
test('Cyber Jar position picker shows the summoned card separately from its resolving source and supports reading it',async()=>{
 const e=backend();let s=await e.createMatch(decks(),{cards,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Cyber Jar'),faceUp:false,defense:true}]},{}]});s=command(e,s,'POSITION');s=advanceBattle(e,s,s=>s.choice?.side===0&&s.choice.selectionType==='select_position'&&!s.reveals?.length);const r=await rig(e,s);
 try{await waitFor(()=>r.$('.duel-position-card'));assert.match(r.$('.duel-position-card').textContent,/Mystical Elf/);assert.match(r.$('.duel-choice-source').textContent,/Cyber Jar/);assert.ok(r.$('.duel-position-card img'));r.$('[data-duel="read-position-card"]').click();assert.match(r.$('.duel-selection-info').textContent,/Mystical Elf/);r.$('[data-duel="selection-back"]').click();assert.match(r.$('.duel-position-card').textContent,/Mystical Elf/);assert.deepEqual(r.errors,[]);}finally{r.close();}
});
for(const [before,after] of [[8000,5300],[5300,6500]])test(`LP stays at ${before} through the battle preview, then moves once to ${after}`,async()=>{
 const e=backend();let s=await e.createMatch(decks(),{cards,lp:before,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Dark Magician')}]},{}]});
 const adapter={...e,applyAction:(old,action)=>{const next=structuredClone(old);next.players[1].lp=after;next.serial++;next.actions=[[],[]];next.log.push({id:next.serial,kind:'battle',battleNotice:{side:0,attacker:{uid:old.players[0].monsters[0].uid,card:get('Dark Magician'),atk:2500},defender:null,targetLP:before}});return next;}};
 const r=await rig(adapter,s);
 try{
  r.window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:100,bottom:40,width:100,height:40};};
  r.window.Element.prototype.animate=function(){return {finished:Promise.resolve(),cancel(){}};};
  r.$('[data-duel="duel-menu"]').click();r.$('[data-duel="toggle-motion"]').click();r.$('[data-action="close"]').click();
  const values=[],observer=new r.window.MutationObserver(()=>values.push(Number(r.$('[data-lp-value="1"]').textContent.replaceAll(',',''))));observer.observe(r.$('[data-lp-value="1"]'),{subtree:true,childList:true,characterData:true});
  r.$('[data-duel="end"]').click();await waitFor(()=>r.$('.duel-battle-showcase'));assert.equal(r.$('[data-lp-value="1"]').textContent,before.toLocaleString(),'Do not render the future LP before the strike');assert.equal(r.$('.duel-battle-lp strong').textContent,before.toLocaleString());
  r.$('.duel-battle-skip').click();await waitFor(()=>r.$('.duel-arena').dataset.moving==='false');observer.disconnect();
  assert.equal(Number(r.$('[data-lp-value="1"]').textContent.replaceAll(',','')),after);assert.match(r.$('[data-field-lp="1"]').getAttribute('aria-label'),new RegExp('Life Points: '+after));assert.ok(values.length>5);assert.ok(values.every((n,i)=>n>=Math.min(before,after)&&n<=Math.max(before,after)&&(!i||(after<before?n<=values[i-1]:n>=values[i-1]))),values.join(','));assert.deepEqual(r.errors,[]);
 }finally{r.close();}
});
test('card names keep the literal number sign and use a dedicated readable symbol font',async()=>{
 const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/font-family:AtlasSymbols;[\s\S]*?unicode-range:U\+0023/);assert.match(css,/font-family:AtlasSymbols,Atlas/);const name='Winged Dragon, Guardian of the Fortress #1';assert.equal(normalizeCard({...get('Mystical Elf'),name}).name,name);
});
