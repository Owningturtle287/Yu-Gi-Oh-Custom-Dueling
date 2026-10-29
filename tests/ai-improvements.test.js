import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {chooseAIAction,rankAIActions} from '../src/duel/native-ai.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
import {battleOutcome} from '../src/duel/ai-combat.js';
import {createLearningSession,LEARNING_KEY} from '../src/duel/ai-learning.js';
const cards=JSON.parse(await readFile(new URL('./ai-improvements-fixtures.json',import.meta.url))).data.map(normalizeCard),get=n=>{const c=cards.find(c=>c.name===n);assert.ok(c,n);return c;},body=(n,p={})=>({card:get(n),...p});
const pack=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>pack}),decks=()=>[0,1].map(()=>({name:'AI decision regression',main:Array(40).fill(get('Charcoal Inpachi')),extra:[]}));
const game=(e,fields,hands=[[],[]],options={})=>e.createMatch(decks(),{cards,seed:71,first:0,openingHands:hands.map(h=>h.map(get)),initialFields:fields,...options});
const find=(e,s,a)=>e.findCard(s,a.uid)?.card.name||a.effectCard?.name;
const command=(e,s,type,side=s.active,name)=>{const a=s.actions[side].find(a=>a.type===type&&(!name||find(e,s,a)===name));assert.ok(a,`Missing ${type} ${name}`);return e.applyAction(s,a,side);};
const advance=(e,s,until)=>{for(let n=0;n<160;n++){if(until(s))return s;assert.equal(s.winner,null);assert.ok(s.choice||s.window||s.reveals?.length,'Checkpoint passed');const side=s.actions[0].length?0:1;s=e.applyAction(s,s.actions[side].find(a=>a.type==='PASS')||chooseAIAction(s,side),side);}assert.fail('Checkpoint limit');};
const settle=(e,s)=>advance(e,s,s=>!s.choice&&!s.window&&!s.reveals?.length);
const select=(e,s,uid)=>{const side=s.choice.side,id=s.choice.promptId,a=s.actions[side].find(a=>a.target===uid);assert.ok(a,'Legal target');s=e.applyAction(s,a,side);const finish=s.choice?.promptId===id&&s.actions[side].find(a=>a.finish);return finish?e.applyAction(s,finish,side):s;};
function play(e,s,{side=1,observe=()=>{}}={}){for(let n=0;n<180&&s.winner===null&&(s.active===side||s.choice||s.window||s.reveals?.length);n++){const actor=s.actions[0].length?0:1,a=actor===side?chooseAIAction(s,side):s.actions[actor].find(a=>a.type==='PASS')||chooseAIAction(s,actor),next=e.applyAction(s,a,actor);observe(s,a,actor,next);s=next;}return s;}
const replay=async(e,s)=>{const save=e.exportMatch(s),restored=await e.restoreMatch(save,{cards});try{assert.equal(e.exportMatch(restored).checkpoint,save.checkpoint);}finally{e.destroyMatch(restored);}};
for(const side of [0,1])test(`avoids a fatal public Amazoness Swords Woman reflection, controller ${side}`,async()=>{
 const e=backend(),fields=[{},{}];fields[side]={monsters:[body('Blue-Eyes White Dragon')]};fields[1-side]={monsters:[body('Amazoness Swords Woman')]};let s=await game(e,fields,[[],[]],{first:1-side,lp:1000});
 try{s=settle(e,command(e,settle(e,s),'END',1-side));const view=aiObservation(s,side),prediction=battleOutcome(view,side,view.players[side].monsters[0],view.players[1-side].monsters[0]);assert.equal(prediction.ownDamage,1500);assert.equal(prediction.enemyDamage,0);s=play(e,s,{side});assert.notEqual(s.winner,1-side);assert.equal(s.players[side].lp,1000);assert.ok(!s.log.some(l=>l.kind==='attack'&&l.side===side));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const side of [0,1])test(`does not sacrifice a defender for Cannon Soldier damage prevented by Des Wombat, controller ${side}`,async()=>{
 const e=backend(),fields=[{},{}];fields[side]={monsters:[body('Cannon Soldier'),body('Mystical Elf',{defense:true})]};fields[1-side]={monsters:[body('Des Wombat')]};let s=await game(e,fields,[[],[]],{first:1-side,lp:1000});
 try{s=settle(e,command(e,settle(e,s),'END',1-side));s=play(e,s,{side});assert.ok(!s.log.some(l=>l.kind==='activate'&&l.effectNotice?.card.name==='Cannon Soldier'));assert.ok(s.players[side].monsters.some(c=>c?.card.name==='Mystical Elf'));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const barrier of ['Gravity Bind','Messenger of Peace','Swords of Revealing Light'])test(`no phantom Cyber-Stein/Megamorph lethal through ${barrier}`,async()=>{
 const e=backend(),d=decks();d[1].extra=[get('Blue-Eyes Ultimate Dragon')];let s=await e.createMatch(d,{cards,seed:71,first:0,openingHands:[[],[get('Megamorph')]],initialFields:[{spells:[body(barrier)]},{monsters:[body('Cyber-Stein')]}]});
 try{s=settle(e,command(e,settle(e,s),'END',0));assert.ok(!rankAIActions(s,1).some(r=>r.projection?.lethal));s=play(e,s);assert.equal(s.players[1].lp,8000);assert.ok(!s.log.some(l=>l.kind==='cost'&&/5,000/.test(l.message)));await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Sets Quick-Play defenses on the opening turn',async()=>{
 const e=backend();let s=await game(e,[{},{}],[[],['Mystical Elf','Book of Moon','Mystical Space Typhoon']],{first:1});
 try{s=play(e,settle(e,s));assert.equal(s.turn,2);assert.ok(s.players[1].spells.some(c=>c?.card.name==='Book of Moon'));assert.ok(s.players[1].spells.some(c=>c?.card.name==='Mystical Space Typhoon'));await replay(e,s);}finally{e.destroyMatch(s);}
});
test('keeps LV7, wins the available battle with LV5, and performs the End Phase upgrade',async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Gemini Elf')]},{monsters:[body('Armed Dragon LV5')]}],[[],['Armed Dragon LV7']]);
 try{s=play(e,settle(e,command(e,settle(e,s),'END',0)));assert.ok(!s.log.some(l=>l.kind==='cost'&&/Armed Dragon LV7/.test(l.message)));assert.ok(s.log.some(l=>/Gemini Elf was destroyed.*battle/.test(l.message)));assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Armed Dragon LV7'));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const [lower,higher] of [['Armed Dragon LV5','Armed Dragon LV7'],['Horus the Black Flame Dragon LV4','Horus the Black Flame Dragon LV6']])test(`${lower} accepts a legal replacement upgrade on a four-monster field`,async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Charcoal Inpachi')]},{monsters:[body(lower),...Array.from({length:3},()=>body('Mystical Elf',{defense:true}))]}],[[],[higher]]);
 try{s=settle(e,command(e,settle(e,s),'END',0));s=settle(e,command(e,s,'NEXT',1));const victim=s.players[0].monsters.find(Boolean).uid;s=command(e,s,'ATTACK',1,lower);if(s.choice?.attackUid)s=select(e,s,victim);s=settle(e,s);s=advance(e,command(e,s,'END',1),s=>s.choice?.optionalResponse&&s.choice.source?.card.name===lower);assert.equal(s.players[1].monsters.filter(Boolean).length,4);assert.equal(chooseAIAction(s,1).yes,true);s=settle(e,e.applyAction(s,chooseAIAction(s,1),1));assert.ok(s.players[1].monsters.some(c=>c?.card.name===higher));await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Big Eye inspects all five available cards and puts Pot of Greed ahead of Sparks',async()=>{
 const e=backend(),d=[0,1].map(()=>({name:'Ordering regression',main:['Sparks','Pot of Greed','Raigeki','Mystical Elf','Summoned Skull'].flatMap(n=>Array(8).fill(get(n))),extra:[]}));let s=await e.createMatch(d,{cards,seed:1,first:0,openingHands:[[],[]],initialFields:[{}, {monsters:[body('Big Eye',{faceUp:false,defense:true})]}]});
 try{s=settle(e,command(e,settle(e,s),'END',0));s=command(e,s,'POSITION',1,'Big Eye');s=advance(e,s,s=>s.choice?.selectionType==='announce_number');assert.equal(chooseAIAction(s,1).number,5);s=e.applyAction(s,chooseAIAction(s,1),1);s=advance(e,s,s=>s.choice?.selectionType==='sort_card');assert.equal(e.findCard(s,chooseAIAction(s,1).target).card.name,'Pot of Greed');s=settle(e,s);assert.equal(s.players[1].deck.at(-1).card.name,'Pot of Greed');await replay(e,s);}finally{e.destroyMatch(s);}
});
test('actual completed native duels update persistent learning once; restoring the same episode cannot train twice',async()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},learner=createLearningSession({storage,locks:null}),e=backend();let s=await game(e,[{}, {monsters:[body('Cannon Soldier'),body('Mystical Elf')]}],[[],[]],{lp:1000});
 try{s=settle(e,command(e,settle(e,s),'END',0));learner.begin(s);s=play(e,s,{observe:(...args)=>learner.observe(...args)});assert.equal(s.winner,1);const experience=learner.snapshot();assert.equal(learner.model.games,0);assert.equal(await learner.finish(s),true);assert.equal(learner.model.games,1);assert.equal(learner.model.wins,1);assert.ok(Object.values(learner.model.weights).some(v=>v!==0));const restored=createLearningSession({storage,locks:null});restored.restore(s,experience);assert.equal(await restored.finish(s),false);assert.equal(JSON.parse(storage.getItem(LEARNING_KEY)).games,1);}finally{e.destroyMatch(s);}
});
test('Power Bond plans an actual Machine Fusion lethal using both materials',async()=>{
 const e=backend(),d=decks();d[1].extra=[get('Cyber Twin Dragon')];let s=await e.createMatch(d,{cards,seed:71,first:0,lp:4000,openingHands:[[],[get('Power Bond'),get('Cyber Dragon'),get('Cyber Dragon')]],initialFields:[{},{}]});
 try{s=settle(e,command(e,settle(e,s),'END',0));assert.ok(rankAIActions(s,1).some(r=>r.action.type==='ACTIVATE'&&find(e,s,r.action)==='Power Bond'&&r.projection?.lethal));s=play(e,s);assert.equal(s.winner,1);assert.equal(s.players[1].grave.filter(c=>c.card.name==='Cyber Dragon').length,2);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Power Bond is declined when its blocked attack and End Phase damage would lose the duel',async()=>{
 const e=backend(),d=decks();d[1].extra=[get('Cyber Twin Dragon')];let s=await e.createMatch(d,{cards,seed:71,first:0,lp:2000,openingHands:[[],[get('Power Bond'),get('Cyber Dragon'),get('Cyber Dragon')]],initialFields:[{spells:[body('Gravity Bind')]},{}]});
 try{s=play(e,settle(e,command(e,settle(e,s),'END',0)));assert.ok(!s.log.some(l=>l.kind==='activate'&&l.effectNotice?.card.name==='Power Bond'));assert.equal(s.players[1].lp,2000);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('LV5 normal Tribute selection is not confused with its hand-monster removal cost',async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Gemini Elf')]},{monsters:[body('Mystical Elf')]}],[[],['Armed Dragon LV5']]);
 try{s=settle(e,command(e,settle(e,s),'END',0));s=command(e,s,'SUMMON',1,'Armed Dragon LV5');assert.equal(s.choice.selectionType,'select_tribute');assert.ok(chooseAIAction(s,1).target);s=settle(e,e.applyAction(s,chooseAIAction(s,1),1));assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Armed Dragon LV5'));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const [attacker,barrier] of [['Horus the Black Flame Dragon LV6','Swords of Revealing Light'],['Silent Swordsman LV5','Messenger of Peace'],['Elemental HERO Wildheart','Gravity Bind']])test(`${attacker} retains its legal attack through ${barrier}`,async()=>{
 const e=backend();let s=await game(e,[{spells:[body(barrier)]},{monsters:[body(attacker)]}]);
 try{s=settle(e,command(e,settle(e,s),'END',0));s=play(e,s);assert.ok(s.log.some(l=>l.kind==='attack'&&l.side===1&&l.message.includes(attacker)));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const protectedEnemy of [false,true])test(`Magic Cylinder distinguishes a real lethal from Des Wombat prevention: ${protectedEnemy}`,async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Blue-Eyes White Dragon'),...(protectedEnemy?[body('Des Wombat')]:[])]},{monsters:[body('Blue-Eyes Ultimate Dragon',{defense:true})],spells:[body('Magic Cylinder',{faceUp:false})]}],[[],[]],{first:1,lp:1000});
 try{s=settle(e,command(e,settle(e,s),'END',1));s=settle(e,command(e,s,'NEXT',0));const victim=s.players[1].monsters[0].uid;s=command(e,s,'ATTACK',0,'Blue-Eyes White Dragon');if(s.choice?.attackUid)s=select(e,s,victim);s=advance(e,s,s=>s.window?.priority===1&&s.actions[1].some(a=>a.type==='ACTIVATE'));assert.equal(chooseAIAction(s,1).type,protectedEnemy?'PASS':'ACTIVATE');await replay(e,s);}finally{e.destroyMatch(s);}
});
