import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend,nativeSeed} from '../src/duel/native-engine.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
import {choiceVisuals} from '../src/duel/choice-view.js';
import {currentCardData,cardTypeLabel,cardStatText} from '../src/duel/card-view.js';
import {command,advanceBattle,selectCard,damageDuel} from './battle-fixtures.js';
const cards=[...JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data,...JSON.parse(await readFile(new URL('./audit-fixtures.json',import.meta.url))).data].map(normalizeCard);
const get=name=>{const c=cards.findLast(c=>c.name===name);assert.ok(c,name);return c;};
const rules=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const decks=()=>[0,1].map(()=>({name:'Audit regression',main:Array(40).fill(get('Mystical Elf')),extra:[]}));
const backend=()=>createNativeBackend({rules:()=>rules});
function settle(e,s){for(let n=0;n<150&&(s.choice||s.window||s.reveals?.length);n++){const side=s.actions[0].length?0:1;s=e.applyAction(s,s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side),side);}assert.ok(!s.choice&&!s.window&&!s.reveals?.length);return s;}

for(const [name,declaration,property,expected] of [['DNA Surgery','MACHINE','currentRace','Machine'],['DNA Transplant','WATER','currentAttribute','WATER']])test(`${name} updates live card properties and AI observations, then restores them when removed`,async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:117,openingHands:[[],[get('Mystical Space Typhoon')]],initialFields:[{monsters:[{card:get('Mystical Elf')}],spells:[{card:get(name),faceUp:false}]},{}]});
  try{
    s=command(e,s,'ACTIVATE',0,name);s=e.applyAction(s,s.actions[0].find(a=>a.label===declaration),0);s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);s=settle(e,s);
    const unit=s.players[0].monsters[0],key=property==='currentRace'?'race':'attribute';assert.equal(unit[property],expected);assert.equal(aiObservation(s,0).players[0].monsters[0].card[key],expected);
    assert.equal(unit.card[key],get('Mystical Elf')[key],'Archive/printed properties stay intact');
    s=command(e,s,'END',0);s=advanceBattle(e,s,x=>x.active===1&&x.phase==='main1'&&!x.window&&!x.choice);s=command(e,s,'ACTIVATE',1,'Mystical Space Typhoon');s=selectCard(e,s,s.players[0].spells.find(Boolean).uid);s=settle(e,s);
    assert.equal(s.players[0].monsters[0][property],get('Mystical Elf')[key]);
  }finally{e.destroyMatch(s);}
});
test('Cost Down exposes reduced Levels through a Tribute Summon and restores the original Level at turn end',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:34,openingHands:[['Cost Down','Mystical Elf','Dark Magician'].map(get),[]],initialFields:[{monsters:[{card:get('Mystical Elf')}]},{}]});
  try{
    s=command(e,s,'ACTIVATE',0,'Cost Down');s=selectCard(e,s,s.players[0].hand.find(c=>c.card.name==='Mystical Elf').uid);s=settle(e,s);
    const wizard=s.players[0].hand.find(c=>c.card.name==='Dark Magician');assert.equal(wizard.currentLevel,5);assert.equal(wizard.card.level,7);
    s=command(e,s,'SUMMON',0,'Dark Magician');s=settle(e,s);assert.equal(s.players[0].monsters.find(Boolean).card.name,'Dark Magician');assert.equal(s.players[0].monsters.find(Boolean).currentLevel,5);
    s=command(e,s,'END',0);s=advanceBattle(e,s,x=>x.turn===2&&!x.window&&!x.choice);assert.equal(s.players[0].monsters.find(Boolean).currentLevel,7);
  }finally{e.destroyMatch(s);}
});
for(const name of ['Confiscation','The Forceful Sentry','Exchange'])test(`${name} keeps legally revealed hand choices visible after acknowledging the card list`,async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:48,openingHands:[[get(name),get('Mystical Elf')],['Dark Magician','Blue-Eyes White Dragon'].map(get)]});
  try{
    s=command(e,s,'ACTIVATE',0,name);s=advanceBattle(e,s,x=>x.reveals?.some(r=>r.viewer===0));
    while(s.reveals?.length){const reveal=s.reveals[0];s=e.applyAction(s,s.actions[reveal.viewer][0],reveal.viewer);}
    s=advanceBattle(e,s,x=>x.choice?.side===0&&x.actions[0].some(a=>a.target&&x.players[1].hand.some(c=>c.uid===a.target)));
    for(const action of s.actions[0].filter(a=>a.target)){
      const visual=choiceVisuals(s,action)[0];assert.ok(visual);assert.equal(visual.hidden,false);assert.ok(visual.card.card_images.length);assert.equal(visual.name,e.findCard(s,action.target).card.name);
    }
  }finally{e.destroyMatch(s);}
});
test('fresh native duels do not all produce the same first coin toss across different seeds',async()=>{
  const faces=new Set(),e=backend();
  for(let seed=1;seed<=16;seed++){
    let s=await damageDuel(e,cards,{attacker:'Jirai Gumo',defendingSide:1,traps:[],seed});
    try{s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_option');s=e.applyAction(s,s.actions[0].find(a=>a.coinCall==='Tails'),0);s=advanceBattle(e,s,x=>x.log.some(l=>l.coinNotice));faces.add(s.log.find(l=>l.coinNotice).coinNotice.results[0]);}finally{e.destroyMatch(s);}
  }
  assert.deepEqual([...faces].sort(),['Heads','Tails']);
});
test('native seed expansion is deterministic, fills all four words, and preserves the legacy seed version',()=>{
  assert.deepEqual(nativeSeed(42),nativeSeed(42));assert.notDeepEqual(nativeSeed(42),nativeSeed(43));
  assert.equal(new Set(nativeSeed(42)).size,4);assert.ok(nativeSeed(42).every(word=>word>0xffffffffn&&word<=0xffffffffffffffffn));
  assert.deepEqual(nativeSeed(42,1),[42n,2n,3n,4n]);
});
test('saved coin decisions replay identically for new matches and pre-versioned legacy randomness',async()=>{
  for(const version of [1,2]){
    const e=backend();let s=await damageDuel(e,cards,{attacker:'Jirai Gumo',defendingSide:1,traps:[],seed:9,randomVersion:version}),restored;
    try{
      s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_option');const saved=JSON.parse(JSON.stringify(e.exportMatch(s)));
      if(version===1)delete saved.options.randomVersion;
      restored=await e.restoreMatch(saved,{cards});
      s=e.applyAction(s,s.actions[0].find(a=>a.coinCall==='Tails'),0);restored=e.applyAction(restored,restored.actions[0].find(a=>a.coinCall==='Tails'),0);
      assert.deepEqual(e.exportMatch(restored).checkpoint,e.exportMatch(s).checkpoint);assert.deepEqual(restored.log.find(l=>l.coinNotice).coinNotice.results,s.log.find(l=>l.coinNotice).coinNotice.results);
    }finally{e.destroyMatch(s);e.destroyMatch(restored);}
  }
});
test('Puppet Magic resolves an exact Level sum, banishes the selected materials and revives the target',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:92,openingHands:[[get('The Puppet Magic of Dark Ruler')],[]],initialFields:[{monsters:['Mystical Elf','Man-Eater Bug'].map(name=>({card:get(name)})),grave:[{card:get('Summoned Skull')}]},{}]});
  try{
    s=command(e,s,'ACTIVATE',0,'The Puppet Magic of Dark Ruler');s=selectCard(e,s,s.players[0].grave.find(Boolean).uid);s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_sum');
    assert.equal(s.choice.canFinish,false);s=settle(e,s);
    assert.deepEqual(s.players[0].monsters.filter(Boolean).map(c=>c.card.name),['Summoned Skull']);assert.equal(s.players[0].banished.length,2);
  }finally{e.destroyMatch(s);}
});
test('remembered face-down cards do not leak subsequent hidden Level, type or attribute changes',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:3,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Mystical Elf')}]},{}]});
  try{
    const unit=s.players[0].monsters[0];unit.faceUp=false;unit.public=false;unit.currentLevel=10;unit.currentRace='Machine';unit.currentAttribute='FIRE';
    const observed=aiObservation(s,1).players[0].monsters[0];assert.equal(observed.currentLevel,4);assert.equal(observed.currentRace,'Spellcaster');assert.equal(observed.currentAttribute,'LIGHT');
  }finally{e.destroyMatch(s);}
});
test('Grave Protector shuffles battle-destroyed monsters into the Deck instead of leaving them on top',async()=>{
  const messages=[],lib={...rules.lib,duelGetMessage(handle){const next=rules.lib.duelGetMessage(handle);messages.push(...next);return next;}};
  const e=createNativeBackend({rules:()=>({...rules,lib})});let s=await e.createMatch([0,1].map(()=>({name:'Grave Protector regression',main:Array(40).fill(get('Dark Magician')),extra:[]})),{cards,seed:79,first:1,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Blue-Eyes White Dragon')}]},{monsters:[{card:get('Mystical Elf'),defense:true},{card:get('Grave Protector'),defense:true}]}]});
  try{
    s=command(e,s,'END',1);s=command(e,s,'NEXT',0);messages.length=0;s=command(e,s,'ATTACK',0);s=selectCard(e,s,s.players[1].monsters[0].uid);s=advanceBattle(e,s,x=>!x.pending&&!x.choice&&!x.window);
    assert.equal(s.players[1].grave.length,0);assert.equal(s.players[1].deck.filter(c=>c.card.name==='Mystical Elf').length,1);
    assert.ok(messages.some(m=>m.type===rules.module.OcgMessageType.SHUFFLE_DECK&&m.player===0),'The battle redirect must perform a real shuffle for the defeated monster’s owner');
  }finally{e.destroyMatch(s);}
});
test('Embodiment of Apophis exposes its actual monster type, Level, race and stats after Trap resolution',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:83,openingHands:[[],[]],initialFields:[{spells:[{card:get('Embodiment of Apophis'),faceUp:false}]},{}]});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Embodiment of Apophis'));const trap=s.players[0].monsters.find(Boolean);assert.ok(trap);
    assert.equal(trap.card.type,'Trap Card');assert.ok(trap.currentType&1);assert.equal(trap.currentLevel,4);assert.equal(trap.currentRace,'Reptile');assert.equal(trap.currentAttribute,'EARTH');
    assert.deepEqual(trap.currentStats,{atk:1600,def:1800});assert.equal(currentCardData(trap).type,'Normal Trap Monster');assert.match(cardTypeLabel(currentCardData(trap)),/Reptile.*Normal.*Trap/);assert.equal(aiObservation(s,0).players[0].monsters.find(Boolean).card.type,'Normal Trap Monster');
  }finally{e.destroyMatch(s);}
});
test('variable ATK/DEF in hand remain unknown rather than becoming unsigned billions',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:19,openingHands:[["Gradius' Option",'Gren Maju Da Eiza','Maju Garzett'].map(get),[]]});
  try{
    for(const c of s.players[0].hand){assert.deepEqual(c.currentStats,{atk:0,def:0});assert.equal(cardStatText(c,c.currentStats).atk,'?');assert.equal(cardStatText(c,c.currentStats).def,c.card.def<0?'?':0);assert.ok(aiObservation(s,0).players[0].hand.find(x=>x.uid===c.uid).currentStats.atk<10000);}
  }finally{e.destroyMatch(s);}
});
test('legacy saved unknown stats migrate without weakening checkpoint verification',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:19,randomVersion:1,openingHands:[[get('Gren Maju Da Eiza')],[]]}),restored;
  try{
    const save=JSON.parse(JSON.stringify(e.exportMatch(s)));delete save.queryRevision;delete save.options.randomVersion;
    const old=JSON.parse(save.checkpoint),unknown=old.players[0].zones[1].find(Boolean);unknown.stats={atk:0xfffffffe,def:0xfffffffe};save.checkpoint=JSON.stringify(old);
    restored=await e.restoreMatch(save,{cards});assert.deepEqual(restored.players[0].hand[0].currentStats,{atk:0,def:0});assert.equal(e.exportMatch(restored).queryRevision,2);
    old.phase='battle';await assert.rejects(()=>e.restoreMatch({...save,checkpoint:JSON.stringify(old)},{cards}),/verification failed/);
  }finally{e.destroyMatch(s);e.destroyMatch(restored);}
});
test('Gren Maju uses native calculated field stats with five banished cards',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:19,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Gren Maju Da Eiza')}],banished:Array.from({length:5},()=>({card:get('Mystical Elf')}))},{}]});
  try{const unit=s.players[0].monsters.find(Boolean);assert.deepEqual(unit.currentStats,{atk:2000,def:2000});assert.deepEqual(cardStatText(unit,unit.currentStats),{atk:2000,def:2000});assert.equal(unit.unknownStats,undefined);}finally{e.destroyMatch(s);}
});
test('AI Tribute Summons a wall breaker instead of endlessly replacing smaller attackers',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:37,openingHands:[[],['Summoned Skull','Mechanicalchaser'].map(get)],initialFields:[{monsters:[{card:get('Gemini Elf')},{card:get('Grave Protector'),defense:true},{card:get('Mystical Elf'),defense:true}]},{monsters:[{card:get('Gemini Elf')}]}]});
  try{
    s=settle(e,command(e,s,'END',0));const action=e.chooseAIAction(s,1);assert.equal(action.type,'SUMMON');assert.equal(e.findCard(s,action.uid).card.name,'Summoned Skull');assert.equal(action.set,false);
    s=settle(e,e.applyAction(s,action,1));assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Summoned Skull'&&c.faceUp));assert.ok(s.players[1].grave.some(c=>c.card.name==='Gemini Elf'));
  }finally{e.destroyMatch(s);}
});
test('Graceful Dice applies the actual die result to both stats, then expires at turn end',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:97,openingHands:[[get('Graceful Dice')],[]],initialFields:[{monsters:[{card:get('Mystical Elf')}]},{}]});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Graceful Dice'));const roll=Number(s.log.find(l=>/Graceful Dice · Dice roll:/.test(l.message)).message.match(/Dice roll: (\d)/)[1]);assert.ok(roll>=1&&roll<=6);
    assert.deepEqual(s.players[0].monsters.find(Boolean).currentStats,{atk:800+roll*100,def:2000+roll*100});s=settle(e,command(e,s,'END',0));assert.deepEqual(s.players[0].monsters.find(Boolean).currentStats,{atk:800,def:2000});
  }finally{e.destroyMatch(s);}
});
test('multiple counter holders can pay Mega Ton Magical Cannon’s ten-counter cost and finish the effect',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:98,openingHands:[[...Array(5).fill(get('Pot of Greed')),get('Mega Ton Magical Cannon')],[]],initialFields:[{monsters:Array.from({length:2},()=>({card:get('Magical Marionette')}))},{monsters:[{card:get('Blue-Eyes White Dragon')}]}]});
  try{
    for(let i=0;i<5;i++)s=settle(e,command(e,s,'ACTIVATE',0,'Pot of Greed'));
    assert.ok(s.players[0].monsters.filter(Boolean).every(c=>c.currentStats.atk===3000));
    s=command(e,s,'ACTIVATE',0,'Mega Ton Magical Cannon');assert.equal(s.choice.selectionType,'select_counter');assert.equal(s.actions[0].filter(a=>a.target).length,2);
    s=settle(e,s);assert.equal(s.players[1].monsters.filter(Boolean).length,0);assert.ok(s.players[1].grave.some(c=>c.card.name==='Blue-Eyes White Dragon'));assert.ok(s.players[0].monsters.filter(Boolean).every(c=>c.currentStats.atk===2200));
  }finally{e.destroyMatch(s);}
});
test('Amazoness Archer recognizes its current card name and pays two Tributes for lethal damage',async()=>{
  const e=backend();let s=await e.createMatch(decks(),{cards,seed:99,lp:1000,openingHands:[[],[]],initialFields:[{monsters:['Amazoness Archer','Mystical Elf','Mystical Elf'].map(name=>({card:get(name)}))},{monsters:[{card:get('Blue-Eyes White Dragon')}]}]});
  try{const action=e.chooseAIAction(s,0);assert.equal(action.type,'ACTIVATE');assert.equal(e.findCard(s,action.uid).card.name,'Amazoness Archer');s=settle(e,e.applyAction(s,action,0));assert.equal(s.winner,0);assert.equal(s.players[1].lp,0);assert.equal(s.players[0].grave.length,2);}finally{e.destroyMatch(s);}
});
