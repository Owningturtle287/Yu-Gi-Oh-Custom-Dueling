import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard,createDeck,addCard,filterCards,isExtra} from '../src/core.js';
import {ERA_END,ERA_YEAR,supportedPool,support} from '../src/duel/catalog.js';
import {defaultSide,poolFor,generateDeck,validateDuelDeck,expandDeck,eligibleSets,loadSets} from '../src/duel/decks.js';
import {normalizeSoloConfig} from '../src/duel/config.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {command,selectCard} from './battle-fixtures.js';
const fixture=JSON.parse(await readFile(new URL('./era2010-fixtures.json',import.meta.url))),cards=fixture.data.map(normalizeCard),get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;};
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>pack}),body=(name,extra={})=>({card:get(name),...extra});
const settle=(e,state)=>{for(let n=0;n<180&&(state.choice||state.window||state.reveals?.length);n++){const side=state.actions[0].length?0:1;state=e.applyAction(state,state.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(state,side,{variety:false}),side);}assert.ok(!state.choice&&!state.window&&!state.reveals?.length,'Native selection resolves');return state;};
async function game(e,{fields=[{},{}],hands=[[],[]],extra=[],first=0,main}={}){return settle(e,await e.createMatch([0,1].map(()=>({name:'2010 test',main:main||Array(40).fill(get('Mystical Elf')),extra:extra.map(get)})),{cards,seed:131,first,openingHands:hands.map(h=>h.map(get)),initialFields:fields}));}
const offered=(e,s,side,name)=>s.actions[side].find(a=>a.type==='SUMMON'&&a.special&&e.findCard(s,a.uid)?.card.name===name);
async function replay(e,s){const saved=e.exportMatch(s),restored=await e.restoreMatch(saved,{cards});try{assert.equal(e.exportMatch(restored).checkpoint,saved.checkpoint);}finally{e.destroyMatch(restored);}}
test('2010 coverage includes every playable added card while excluding prizes, Tokens and event-only cards',()=>{
 assert.equal(ERA_END,'2010-12-31');assert.equal(ERA_YEAR,2010);assert.equal(pack.manifest.apiSnapshotSha256,fixture.snapshotSha256);
 const added=cards.filter(c=>c.tcgDate>'2006-12-31'&&c.tcgDate<=ERA_END),excluded=new Set(['Chimaera, the Master of Beasts','Emperor of Lightning','Get Your Game On!','Ceremonial Token','Laval Token']);
 assert.equal(added.length,1971);assert.equal(supportedPool(added).length,1966);for(const card of added)assert.equal(support(card).ok,!excluded.has(card.name),card.name);
 for(const name of ['Stardust Dragon','Black Rose Dragon','Formula Synchron','Shooting Star Dragon','Red Nova Dragon','Red-Eyes Darkness Metal Dragon','Pot of Duality','Effect Veiler','Battle Fader','Gorz the Emissary of Darkness'])assert.ok(support(get(name)).ok,name);
 assert.ok(cards.filter(c=>c.tcgDate>'2010-12-31').every(c=>!support(c).ok));
});
test('all four added years and single-year archive ranges obey inclusive December 31 cutoffs',()=>{
 for(const year of [2007,2008,2009,2010]){
  const cutoff=year+'-12-31',pool=poolFor(cards,{...defaultSide(),cutoff});assert.ok(pool.length);assert.ok(pool.every(c=>c.tcgDate<=cutoff));
  const only=filterCards(cards,{startYear:year,year});assert.ok(only.length);assert.ok(only.every(c=>c.tcgDate>=year+'-01-01'&&c.tcgDate<=cutoff));
 }
 const fake={...get('Mystical Elf'),tcgDate:'2010-12-31'};assert.equal(poolFor([fake],defaultSide()).length,1);assert.equal(poolFor([{...fake,tcgDate:'2011-01-01'}],defaultSide()).length,0);
 assert.equal(filterCards([fake,{...fake,tcgDate:'2011-01-01'}],{year:2010}).length,1);
 const migrated=normalizeSoloConfig({eraEnd:'2006-12-31',sides:[{cutoff:'2006-12-31'},{cutoff:'2003-12-31'}]});assert.equal(migrated.sides[0].cutoff,ERA_END);assert.equal(migrated.sides[1].cutoff,'2003-12-31');
 assert.equal(normalizeSoloConfig({eraEnd:ERA_END,sides:[{cutoff:'2006-12-31'}]}).sides[0].cutoff,'2006-12-31');
});
test('saved Synchros belong in Extra and generated decks never put any Extra Deck monster in Main',()=>{
 let deck=createDeck('Synchro deck');for(const name of ['Stardust Dragon','Formula Synchron','Shooting Star Dragon'])deck=addCard(deck,get(name));assert.equal(deck.sections.extra.length,3);
 const normals=cards.filter(c=>!isExtra(c)&&c.type==='Normal Monster'&&support(c).ok).slice(0,14);for(let i=0;i<40;i++)deck=addCard(deck,normals[Math.floor(i/3)]);assert.deepEqual(validateDuelDeck(deck,cards),[]);const bad=structuredClone(deck);bad.sections.main.push(bad.sections.extra.pop());assert.ok(validateDuelDeck(bad,cards).some(issue=>issue.includes('wrong deck section')));
});
test('random generation and set eligibility include later years and keep Synchros in Extra',()=>{
 let synchros=0;for(const year of [2007,2008,2009,2010])for(let seed=1;seed<=12;seed++){
  const settings={...defaultSide(),cutoff:year+'-12-31'},deck=generateDeck(cards,settings,[],seed);assert.deepEqual(validateDuelDeck(deck,cards,settings),[]);assert.ok(deck.sections.main.every(e=>!isExtra(e.card)));assert.ok(deck.sections.extra.every(e=>isExtra(e.card)));synchros+=deck.sections.extra.filter(e=>/Synchro/.test(e.card.type)).length;
 }assert.ok(synchros>0);
 const sets=[{name:'2010 release',date:'2010-12-31'},{name:'2011 release',date:'2011-01-01'}],sample=cards.map(c=>({...c,setNames:['2010 release','2011 release']}));assert.deepEqual(eligibleSets(sample,sets,defaultSide()).map(s=>s.name),['2010 release']);
});
for(const side of [0,1])test(`Synchro Summon uses exact Levels and sends real Tuner/non-Tuner materials, side ${side}`,async()=>{
 const e=backend(),fields=[{},{}];fields[side]={monsters:[body('Flamvell Magician'),body('Mystical Elf')]};let s=await game(e,{fields,first:side,extra:['Stardust Dragon']});
 try{const action=offered(e,s,side,'Stardust Dragon');assert.ok(action);s=settle(e,e.applyAction(s,action,side));assert.equal(s.players[side].monsters.filter(Boolean).length,1);assert.equal(s.players[side].monsters.find(Boolean).card.name,'Stardust Dragon');assert.equal(s.players[side].grave.length,2);await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const material of ['no Tuner','wrong Level','face-down Tuner','named Tuner'])test(`native Synchro legality blocks ${material}`,async()=>{
 const e=backend(),monsters=material==='no Tuner'?[body('Mystical Elf'),body('Mystical Elf')]:material==='wrong Level'?[body('Junk Synchron'),body('Mystical Elf')]:material==='face-down Tuner'?[body('Flamvell Magician',{faceUp:false,defense:true}),body('Mystical Elf')]:[body('Flamvell Magician'),body('Mystical Elf')];
 let s=await game(e,{fields:[{monsters},{}],extra:[material==='named Tuner'?'Junk Warrior':'Stardust Dragon']});try{assert.equal(offered(e,s,0,material==='named Tuner'?'Junk Warrior':'Stardust Dragon'),undefined);}finally{e.destroyMatch(s);}
});
test('the AI completes legal Synchro material choices on a full five-monster field',async()=>{
 const e=backend();let s=await game(e,{first:1,fields:[{monsters:[body('Blue-Eyes White Dragon')]},{monsters:['Flamvell Magician','Mystical Elf','Mystical Elf','Mystical Elf','Mystical Elf'].map(n=>body(n))}],extra:['Stardust Dragon']});
 try{const action=offered(e,s,1,'Stardust Dragon');assert.ok(action);s=settle(e,e.applyAction(s,action,1));assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Stardust Dragon'));assert.equal(s.players[1].grave.length,2);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Black Rose Dragon offers its Synchro trigger and destroys both fields',async()=>{
 const e=backend();let s=await game(e,{fields:[{monsters:['Junk Synchron','Mystical Elf'].map(n=>body(n))},{monsters:[body('Blue-Eyes White Dragon')]}],extra:['Black Rose Dragon']});
 try{s=e.applyAction(s,offered(e,s,0,'Black Rose Dragon'),0);let triggered=false;for(let n=0;n<80&&(s.choice||s.window);n++){const side=s.actions[0].length?0:1,yes=s.actions[side].find(a=>a.yes===true);if(yes)triggered=true;s=e.applyAction(s,yes||s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side),side);}assert.ok(triggered);assert.equal(s.players.flatMap(p=>p.monsters).filter(Boolean).length,0);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Red-Eyes Darkness Metal Dragon banishes a face-up Dragon and enforces its once-per-turn revival',async()=>{
 const e=backend();let s=await game(e,{hands:[['Red-Eyes Darkness Metal Dragon'],[]],fields:[{monsters:[body('Blue-Eyes White Dragon')],grave:[body('Blue-Eyes White Dragon')]},{}]});
 try{s=settle(e,e.applyAction(s,offered(e,s,0,'Red-Eyes Darkness Metal Dragon'),0));assert.equal(s.players[0].banished.length,1);s=settle(e,command(e,s,'ACTIVATE',0,'Red-Eyes Darkness Metal Dragon'));assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Blue-Eyes White Dragon'));assert.ok(!s.actions[0].some(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Red-Eyes Darkness Metal Dragon'));await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Pot of Duality adds one excavated card and prevents a subsequent Synchro Summon',async()=>{
 const e=backend();let s=await game(e,{hands:[['Pot of Duality'],[]],fields:[{monsters:['Flamvell Magician','Mystical Elf'].map(n=>body(n))},{}],extra:['Stardust Dragon']});
 try{assert.ok(offered(e,s,0,'Stardust Dragon'));const count=s.players[0].deck.length;s=settle(e,command(e,s,'ACTIVATE',0,'Pot of Duality'));assert.equal(s.players[0].hand.length,1);assert.equal(s.players[0].deck.length,count-1);assert.equal(offered(e,s,0,'Stardust Dragon'),undefined);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('2006 saved duels restore under the additive 2010 pack with the exact original checkpoint',async()=>{
 const saved=JSON.parse(await readFile(new URL('./era2006-replay.json',import.meta.url))),e=backend();assert.ok(pack.compatibleFingerprints.includes(saved.rulesFingerprint));const s=await e.restoreMatch(saved,{cards});try{assert.equal(e.exportMatch(s).checkpoint,saved.checkpoint);}finally{e.destroyMatch(s);}
});
for(const [name,materials] of [['Shooting Star Dragon',['Formula Synchron','Stardust Dragon']],['Red Nova Dragon',['Krebons','Krebons','Red Dragon Archfiend']]])test(`${name} enforces and resolves its advanced Synchro procedure`,async()=>{
 const e=backend();let s=await game(e,{fields:[{monsters:materials.map(n=>body(n))},{}],extra:[name]});try{const action=offered(e,s,0,name);assert.ok(action);s=settle(e,e.applyAction(s,action,0));assert.equal(s.players[0].monsters.find(Boolean).card.name,name);assert.equal(s.players[0].grave.length,materials.length);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Effect Veiler is offered from the hand only during the opponent Main Phase and negates the target',async()=>{
 const e=backend();let s=await game(e,{hands:[[],['Effect Veiler']],fields:[{monsters:[body('Red-Eyes Darkness Metal Dragon')]},{}]});
 try{s=command(e,s,'END',0);const action=s.actions[1].find(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Effect Veiler');assert.ok(action);s=settle(e,e.applyAction(s,action,1));assert.ok(s.players[1].grave.some(c=>c.card.name==='Effect Veiler'));assert.equal(s.players[0].monsters[0].disabled,true);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Stardust Dragon can Tribute itself to negate Dark Hole and returns in the End Phase',async()=>{
 const e=backend();let s=await game(e,{hands:[['Dark Hole'],[]],first:1,fields:[{monsters:[body('Mystical Elf')]},{monsters:['Flamvell Magician','Mystical Elf'].map(n=>body(n))}],extra:['Stardust Dragon']});
 try{s=settle(e,e.applyAction(s,offered(e,s,1,'Stardust Dragon'),1));s=settle(e,command(e,s,'END',1));s=command(e,s,'ACTIVATE',0,'Dark Hole');const negate=s.actions[1].find(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Stardust Dragon');assert.ok(negate);s=settle(e,e.applyAction(s,negate,1));assert.equal(s.players[0].monsters.filter(Boolean).length,1);assert.ok(s.players[1].grave.some(c=>c.card.name==='Stardust Dragon'));s=command(e,s,'END',0);
 for(let n=0;n<100&&(s.choice||s.window);n++){const side=s.actions[0].length?0:1;s=e.applyAction(s,s.actions[side].find(a=>a.yes===true)||s.actions[side].find(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Stardust Dragon')||s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side),side);}
 assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Stardust Dragon'));await replay(e,s);
 }finally{e.destroyMatch(s);}
});

test('a full five-zone field blocks Extra Deck summons instead of creating invisible monsters',async()=>{
 const e=backend();let s=await game(e,{hands:[['Instant Fusion'],[]],fields:[{monsters:Array.from({length:5},()=>body('Mystical Elf'))},{}],extra:['Thousand-Eyes Restrict']});
 try{assert.ok(!s.actions[0].some(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Instant Fusion'));assert.equal(s.players[0].extra.length,1);assert.equal(e.exportMatch(s).options.rulesVersion,3);}finally{e.destroyMatch(s);}
 s=await game(e,{hands:[['Instant Fusion'],[]],fields:[{monsters:Array.from({length:4},()=>body('Mystical Elf'))},{}],extra:['Thousand-Eyes Restrict']});
 try{s=settle(e,command(e,s,'ACTIVATE',0,'Instant Fusion'));assert.equal(s.players[0].monsters.filter(Boolean).length,5);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Thousand-Eyes Restrict'));await replay(e,s);}finally{e.destroyMatch(s);}
});
