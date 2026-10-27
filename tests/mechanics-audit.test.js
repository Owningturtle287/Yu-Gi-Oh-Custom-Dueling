import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {automaticEffectAction} from '../src/duel/effects.js';
import {responseOffer,createResponsePolicy} from '../src/duel/responses.js';
import {command} from './battle-fixtures.js';
const cards=JSON.parse(await readFile(new URL('./mechanics-audit-fixtures.json',import.meta.url))).data.map(normalizeCard),get=name=>{const c=cards.find(c=>c.name===name);assert.ok(c,name);return c;},body=(name,props={})=>({card:get(name),...props});
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>pack});
const decks=()=>[0,1].map(()=>({name:'Mechanics audit',main:['Mystical Elf','Gemini Elf','Peten the Dark Clown','Blue-Eyes White Dragon'].flatMap(n=>Array(10).fill(get(n))),extra:[]}));
const advance=(e,s,until)=>{for(let n=0;n<120;n++){if(until(s))return s;assert.equal(s.winner,null);assert.ok(s.choice||s.window||s.reveals?.length,`Checkpoint passed: ${s.phase}`);const side=s.actions[0].length?0:1,action=s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side);assert.ok(action);s=e.applyAction(s,action,side);}assert.fail('Mechanics checkpoint did not arrive');};
const settle=(e,s)=>advance(e,s,s=>!s.choice&&!s.window&&!s.reveals?.length);
const game=async(e,fields=[{},{}],hands=[[],[]],options={})=>settle(e,await e.createMatch(decks(),{cards,seed:71,first:0,openingHands:hands.map(h=>h.map(get)),initialFields:fields,...options}));
const selectCard=(e,s,uid)=>{const side=s.choice.side,id=s.choice.promptId,action=s.actions[side].find(a=>a.target===uid);assert.ok(action,`Legal target ${uid}`);s=e.applyAction(s,action,side);const finish=s.choice?.promptId===id&&s.actions[side].find(a=>a.finish);return finish?e.applyAction(s,finish,side):s;};
const replay=async(e,s)=>{const saved=e.exportMatch(s),restored=await e.restoreMatch(JSON.parse(JSON.stringify(saved)),{cards});try{assert.equal(e.exportMatch(restored).checkpoint,saved.checkpoint);}finally{e.destroyMatch(restored);}};
for(const side of [0,1])for(const first of ['Sangan','Witch of the Black Forest'])test(`simultaneous mandatory triggers: ${first} can be chain link 1, controller ${side}`,async()=>{
 const e=backend(),fields=[{},{}],hands=[[],[]];fields[side]={monsters:[body('Sangan'),body('Witch of the Black Forest')]};hands[side]=['Dark Hole'];let s=await game(e,fields,hands,{first:side});
 try{
  s=command(e,s,'ACTIVATE',side,'Dark Hole');s=advance(e,s,s=>s.window?.forced&&s.window.priority===side);
  assert.equal(s.actions[side].length,2);assert.ok(s.actions[side].every(a=>a.type==='ACTIVATE'));assert.equal(automaticEffectAction(s,s.actions[side]),null);
  if(side===0){const offer=responseOffer(s,s.actions[side]),policy=createResponsePolicy();assert.equal(offer.required,true);assert.equal(offer.pass,undefined);assert.match(offer.context,/Choose the next required effect/);policy.passTurn(s);assert.equal(policy.action(s,s.actions[side]),null);}
  await replay(e,s);s=command(e,s,'ACTIVATE',side,first);assert.deepEqual(s.chain.map(c=>c.card.name),[first,first==='Sangan'?'Witch of the Black Forest':'Sangan']);
  s=settle(e,s);assert.equal(s.players[side].hand.filter(c=>c.card.name!=='Dark Hole').length,2);assert.deepEqual(s.log.filter(l=>/^Resolving (?:Sangan|Witch)/.test(l.message)).map(l=>l.message.match(/^Resolving (.+) ·/)[1]),s.log.filter(l=>l.kind==='activate'&&/Sangan|Witch/.test(l.message)).map(l=>l.effectNotice.card.name).reverse());await replay(e,s);
 }finally{e.destroyMatch(s);}
});
test('pre-order-choice saves replay with their original mandatory ordering',async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Sangan'),body('Witch of the Black Forest')]},{}],[['Dark Hole'],[]],{promptVersion:1}),restored;
 try{s=settle(e,command(e,s,'ACTIVATE',0,'Dark Hole'));const saved=e.exportMatch(s);delete saved.options.promptVersion;restored=await e.restoreMatch(saved,{cards});assert.equal(e.exportMatch(restored).checkpoint,saved.checkpoint);}finally{e.destroyMatch(s);e.destroyMatch(restored);}
});
for(const name of ['Peten the Dark Clown','Sangan','Night Assailant'])test(`${name}: paying an activation cost respects its actual trigger condition`,async()=>{
 const e=backend();let s;
 if(name==='Night Assailant')s=await game(e,[{grave:[body('Man-Eater Bug')],spells:[body('Magic Jammer',{faceUp:false})]},{}],[['Night Assailant'],['Pot of Greed']],{first:1});
 else s=await game(e,[{monsters:[body('Cannon Soldier'),body(name)]},{}]);
 try{
  if(name==='Night Assailant'){
   // Discard by a cost still triggers this mandatory "when sent from hand"
   // effect; it is not an optional "when ... you can" effect.
   s=command(e,s,'ACTIVATE',1,'Pot of Greed');s=command(e,s,'ACTIVATE',0,'Magic Jammer');s=selectCard(e,s,s.players[0].hand.find(c=>c.card.name===name).uid);s=advance(e,s,s=>s.choice&&s.actions[0].some(a=>a.target===s.players[0].grave.find(c=>c.card.name==='Man-Eater Bug')?.uid));s=selectCard(e,s,s.players[0].grave.find(c=>c.card.name==='Man-Eater Bug').uid);s=settle(e,s);assert.ok(s.players[0].hand.some(c=>c.card.name==='Man-Eater Bug'));
  }else{
   s=command(e,s,'ACTIVATE',0,'Cannon Soldier');s=selectCard(e,s,s.players[0].monsters.find(c=>c?.card.name===name).uid);s=settle(e,s);assert.equal(s.players[1].lp,7500);
   assert.equal(s.log.some(l=>l.kind==='activate'&&l.effectNotice?.card.name===name),name==='Sangan');assert.ok(s.players[0].grave.some(c=>c.card.name===name));if(name==='Sangan')assert.equal(s.players[0].hand.length,1);
  }
  await replay(e,s);
 }finally{e.destroyMatch(s);}
});
test('Peten can trigger when an effect sends it to the GY as the last action',async()=>{
 const e=backend();let s=await game(e,[{},{}],[['The Cheerful Coffin','Peten the Dark Clown'],[]]);
 try{s=command(e,s,'ACTIVATE',0,'The Cheerful Coffin');s=selectCard(e,s,s.players[0].hand.find(c=>c.card.name==='Peten the Dark Clown').uid);s=advance(e,s,s=>s.choice?.optionalResponse&&s.choice.source.card.name==='Peten the Dark Clown');s=e.applyAction(s,s.actions[0].find(a=>a.yes),0);s=settle(e,s);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Peten the Dark Clown'));assert.ok(s.players[0].banished.some(c=>c.card.name==='Peten the Dark Clown'));await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const negator of ['Mystical Space Typhoon','Magic Jammer'])test(`${negator}: destroying a normal Spell differs from negating its activation`,async()=>{
 const e=backend();let s=await game(e,[{}, {spells:[body(negator,{faceUp:false})]}],[['Pot of Greed'],['Mystical Elf']]);
 try{s=command(e,s,'ACTIVATE',0,'Pot of Greed');s=command(e,s,'ACTIVATE',1,negator);s=selectCard(e,s,negator==='Magic Jammer'?s.players[1].hand[0].uid:s.players[0].spells.find(c=>c?.card.name==='Pot of Greed').uid);s=settle(e,s);assert.equal(s.players[0].hand.length,negator==='Magic Jammer'?0:2);assert.equal(s.log.some(l=>l.kind==='draw'&&/Pot of Greed/.test(l.message)),negator!=='Magic Jammer');await replay(e,s);}finally{e.destroyMatch(s);}
});
test('a revival target banished higher in the chain cannot be revived or silently replaced',async()=>{
 const e=backend();let s=await game(e,[{grave:[body('Blue-Eyes White Dragon'),body('Gemini Elf')]},{spells:[body('Disappear',{faceUp:false})]}],[['Monster Reborn'],[]]);
 try{
  const target=s.players[0].grave[0].uid;s=command(e,s,'ACTIVATE',0,'Monster Reborn');s=selectCard(e,s,target);s=command(e,s,'ACTIVATE',1,'Disappear');s=selectCard(e,s,target);s=settle(e,s);assert.ok(!s.players[0].monsters.some(Boolean));assert.ok(s.players[0].banished.some(c=>c.card.name==='Blue-Eyes White Dragon'));assert.ok(s.players[0].grave.some(c=>c.card.name==='Gemini Elf'));await replay(e,s);
 }finally{e.destroyMatch(s);}
});
for(const trap of ['Trap Hole','Bottomless Trap Hole'])test(`${trap}: response eligibility distinguishes a Special Summon`,async()=>{
 const e=backend();let s=await game(e,[{}, {monsters:[body('Mystical Elf')],spells:[body(trap,{faceUp:false})]}],[['Cyber Dragon'],[]]);
 try{s=command(e,s,'SUMMON',0,'Cyber Dragon');s=advance(e,s,s=>s.players[0].monsters.some(c=>c?.card.name==='Cyber Dragon'));assert.equal(s.players[0].monsters.find(Boolean).card.name,'Cyber Dragon');assert.equal(s.actions[1].some(a=>e.findCard(s,a.uid)?.card.name===trap),trap==='Bottomless Trap Hole');if(trap==='Bottomless Trap Hole'){s=command(e,s,'ACTIVATE',1,trap);s=settle(e,s);assert.ok(s.players[0].banished.some(c=>c.card.name==='Cyber Dragon'));}await replay(e,s);}finally{e.destroyMatch(s);}
});
test('a negated Normal Summon does not satisfy Sangan’s sent-from-field condition',async()=>{
 const e=backend();let s=await game(e,[{}, {spells:[body('Solemn Judgment',{faceUp:false})]}],[['Sangan'],[]]);
 try{s=command(e,s,'SUMMON',0,'Sangan');s=command(e,s,'ACTIVATE',1,'Solemn Judgment');s=settle(e,s);assert.equal(s.players[1].lp,4000);assert.ok(s.players[0].grave.some(c=>c.card.name==='Sangan'));assert.ok(!s.log.some(l=>l.kind==='activate'&&l.effectNotice?.card.name==='Sangan'));assert.equal(s.players[0].hand.length,0);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('Jinzo summoned by Call of the Haunted negates its destruction link when Call leaves',async()=>{
 const e=backend();let s=await game(e,[{grave:[body('Jinzo')],spells:[body('Call of the Haunted',{faceUp:false})]},{}],[['Mystical Space Typhoon'],[]]);
 try{s=command(e,s,'ACTIVATE',0,'Call of the Haunted');s=selectCard(e,s,s.players[0].grave[0].uid);s=settle(e,s);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Jinzo'));s=command(e,s,'ACTIVATE',0,'Mystical Space Typhoon');s=selectCard(e,s,s.players[0].spells.find(c=>c?.card.name==='Call of the Haunted').uid);s=settle(e,s);assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Jinzo'));assert.ok(s.players[0].grave.some(c=>c.card.name==='Call of the Haunted'));await replay(e,s);}finally{e.destroyMatch(s);}
});

test('Battle Phase quick-effect commands retain their native effect labels and costs',async()=>{
 const e=backend();let s=await game(e,[{monsters:[body('Strike Ninja')],grave:[body('Sangan'),body('Night Assailant')]},{}],[[],[]],{first:1});
 try{
  s=settle(e,command(e,s,'END',1));s=settle(e,command(e,s,'NEXT',0));
  const action=s.actions[0].find(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Strike Ninja');assert.ok(action);assert.match(action.effectText,/Banish/);
  s=e.applyAction(s,action,0);const costs=s.players[0].grave.map(c=>c.uid);for(const uid of costs)s=selectCard(e,s,uid);
  // Multi-card costs remain staged until all required cards are selected.
  if(s.choice?.canFinish)s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);
  s=settle(e,s);assert.equal(s.players[0].banished.length,3);assert.ok(!s.players[0].monsters.some(Boolean));
  s=settle(e,command(e,s,'END',0));assert.ok(s.players[0].monsters.some(c=>c?.card.name==='Strike Ninja'));await replay(e,s);
 }finally{e.destroyMatch(s);}
});
