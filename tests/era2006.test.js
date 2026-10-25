import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeCard} from '../src/core.js';
import {ERA_END,ERA_YEAR,support,supportedPool} from '../src/duel/catalog.js';
import {NATIVE_CARD_IDS,NATIVE_ERA_END} from '../src/duel/rules-manifest.js';
import {defaultSide,loadSets,poolFor,generateDeck,validateDuelDeck} from '../src/duel/decks.js';
import {beliefPool} from '../src/duel/ai-memory.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {command,advanceBattle,selectCard} from './battle-fixtures.js';
import {memoryStorage} from './fixtures.js';
import {cardCounters} from '../src/duel/card-view.js';
import {Window} from 'happy-dom';
import {createSoloController} from '../src/duel/ui.js';

const fixture=JSON.parse(await readFile(new URL('./era2006-fixtures.json',import.meta.url)));
const cards=fixture.data.map(normalizeCard),added=cards.filter(c=>c.tcgDate>='2005-01-01');
const get=name=>{const card=cards.find(c=>c.name===name);assert.ok(card,name);return card;};
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
const backend=()=>createNativeBackend({rules:()=>pack});
const body=name=>({card:get(name)});
const names=zone=>zone.filter(Boolean).map(c=>c.card.name);
async function game(e,{hands=[[],[]],fields=[{},{}],extra=[],first=0,main,lp=8000}={}){
  return settle(e,await e.createMatch([0,1].map(side=>({name:'2006 regression',main:main?.[side]||Array(40).fill(get('Mystical Elf')),extra:extra.map(get)})),{cards,seed:67,first,lp,openingHands:hands.map(h=>h.map(get)),initialFields:fields}));
}
function settle(e,s){
  for(let n=0;n<160&&(s.choice||s.window||s.reveals?.length);n++){
    const side=s.actions[0].length?0:1;
    s=e.applyAction(s,s.actions[side].find(a=>a.type==='PASS')||e.chooseAIAction(s,side),side);
  }
  assert.ok(!s.choice&&!s.window&&!s.reveals?.length,'Effect resolution completes');return s;
}
async function replay(e,s){
  const save=e.exportMatch(s),restored=await e.restoreMatch(JSON.parse(JSON.stringify(save)),{cards});
  try{assert.equal(e.exportMatch(restored).checkpoint,save.checkpoint);}finally{e.destroyMatch(restored);}
}

test('the dated 2005–2006 pool admits every duel card and excludes prizes, placeholders and Tokens',()=>{
  assert.equal(ERA_END,'2006-12-31');assert.equal(NATIVE_ERA_END,ERA_END);assert.equal(ERA_YEAR,2006);assert.equal(pack.manifest.eraEnd,ERA_END);
  assert.equal(added.length,619);assert.equal(supportedPool(added).length,615);
  for(const card of added){
    const excluded=['King of Destruction - Xexex','Queen of Fate - Eternia','Testament of the Arcane Lords','Sheep Token'].includes(card.name);
    assert.equal(support(card).ok,!excluded,card.name);
    if(!excluded)assert.ok(NATIVE_CARD_IDS.has(card.id),`Real rules record: ${card.name}`);
  }
  assert.equal(support({...get('Cyber Dragon'),tcgDate:'2007-01-01'}).ok,false);
  assert.equal(support({...get('Cyber Dragon'),tcgDate:null}).ok,false);
  assert.equal(poolFor(added,{...defaultSide(),cutoff:'2004-12-31'}).length,0);
  assert.ok(poolFor(added,{...defaultSide(),cutoff:'2005-12-31'}).every(c=>c.tcgDate<'2006-01-01'));
  assert.ok(poolFor(added,defaultSide()).some(c=>c.name==='Elemental HERO Neos'));
});
test('the offline pack keeps its shard hashes, overrides, provenance and upstream revision',async()=>{
  assert.equal(pack.manifest.apiSnapshotSha256,fixture.snapshotSha256);
  assert.equal(pack.manifest.scriptsRevision,'5138eb120d9f6f6caa04dbba22b64ef451302b95');
  assert.ok(JSON.parse(await readFile(new URL('../assets/rules/runtime-sources.json',import.meta.url))).submodules.length);
  for(const file of pack.manifest.files)assert.equal(createHash('sha256').update(await readFile(new URL('../assets/rules/'+file.path,import.meta.url))).digest('hex'),file.sha256,file.path);
  for(const path of pack.manifest.localOverrides)assert.equal(pack.scripts[path.split('/').at(-1)],await readFile(new URL('../assets/rules/'+path,import.meta.url),'utf8'));
});
test('the expanded set cache refreshes old-era caches and still works offline',async()=>{
  const storage=memoryStorage();storage.setItem('duel-atlas.sets.v2',JSON.stringify({time:100,sets:[{name:'Old list',date:'2002-01-01'}]}));
  let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>[{set_name:'Cybernetic Revolution',tcg_date:'2005-08-06'},{set_name:'Power of the Duelist',tcg_date:'2006-08-16'},{set_name:'Too late',tcg_date:'2007-01-01'}]};};
  const value=await loadSets({storage,fetchImpl,now:101});assert.equal(calls,1);assert.equal(value.sets.length,2);
  assert.deepEqual((await loadSets({storage,fetchImpl:()=>{throw Error('offline');},now:102,force:true})).sets,value.sets);
});
test('random decks and AI public beliefs use the new era while honoring earlier cutoffs',()=>{
  for(const cutoff of ['2004-12-31','2005-12-31',ERA_END])for(let seed=1;seed<=8;seed++){
    const settings={...defaultSide(),cutoff},deck=generateDeck(cards,settings,[],seed);
    assert.deepEqual(validateDuelDeck(deck,cards,settings),[]);assert.ok(deck.sections.main.every(e=>e.card.tcgDate<=cutoff));assert.equal(deck.releaseYear,Number(cutoff.slice(0,4)));
  }
  const early=get('Mystical Elf'),late=get('Elemental HERO Neos');
  assert.ok(beliefPool([early,late]).some(c=>c.atk===2400));assert.equal(beliefPool([early,late],{cutoff:'2004-12-31'}).length,1);
});
for(const side of [0,1])for(const [own,foe,legal] of [[false,true,true],[false,false,false],[true,true,false]])test(`Cyber Dragon only Special Summons onto an empty own field against a monster (side ${side}, ${own}/${foe})`,async()=>{
  const e=backend(),hands=[[],[]],fields=[{},{}];hands[side]=['Cyber Dragon'];if(own)fields[side].monsters=[body('Mystical Elf')];if(foe)fields[1-side].monsters=[body('Mystical Elf')];
  let s=await game(e,{hands,fields,first:side});
  try{
    const summon=s.actions[side].find(a=>a.type==='SUMMON'&&a.special&&e.findCard(s,a.uid)?.card.name==='Cyber Dragon');assert.equal(!!summon,legal);
    if(legal){s=settle(e,e.applyAction(s,summon,side));assert.ok(names(s.players[side].monsters).includes('Cyber Dragon'));await replay(e,s);}
  }finally{e.destroyMatch(s);}
});
test('Power Bond uses real Fusion materials, doubles Cyber Twin ATK and applies its delayed End Phase damage',async()=>{
  const e=backend();let s=await game(e,{hands:[['Power Bond','Cyber Dragon','Cyber Dragon'],[]],extra:['Cyber Twin Dragon']});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Power Bond'));
    const twin=s.players[0].monsters.find(Boolean);assert.equal(twin.card.name,'Cyber Twin Dragon');assert.equal(twin.currentStats.atk,5600);assert.equal(names(s.players[0].grave).filter(n=>n==='Cyber Dragon').length,2);
    await replay(e,s);s=command(e,s,'END',0);s=advanceBattle(e,s,x=>x.turn===2&&!x.choice&&!x.window);assert.equal(s.players[0].lp,5200);
  }finally{e.destroyMatch(s);}
});
test('Elemental HERO Fusion uses the shared Fusion procedure and cannot be revived illegally',async()=>{
  const e=backend();let s=await game(e,{hands:[['Polymerization','Elemental HERO Avian','Elemental HERO Burstinatrix','Monster Reborn'],[]],extra:['Elemental HERO Flame Wingman']});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Polymerization'));assert.deepEqual(names(s.players[0].monsters),['Elemental HERO Flame Wingman']);
    await replay(e,s);
  }finally{e.destroyMatch(s);}
  s=await game(e,{hands:[['Monster Reborn'],[]],fields:[{grave:[body('Elemental HERO Flame Wingman')]},{}]});
  try{assert.ok(!s.actions[0].some(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='Monster Reborn'));}finally{e.destroyMatch(s);}
});
test('Neos Contact Fusion shuffles its materials into the Deck and returns to the Extra Deck at the End Phase',async()=>{
  const e=backend();let s=await game(e,{fields:[{monsters:['Elemental HERO Neos','Neo-Spacian Aqua Dolphin'].map(body)},{}],extra:['Elemental HERO Aqua Neos']});
  try{
    s=settle(e,command(e,s,'SUMMON',0,'Elemental HERO Aqua Neos'));assert.deepEqual(names(s.players[0].monsters),['Elemental HERO Aqua Neos']);assert.equal(s.players[0].grave.length,0);assert.equal(s.players[0].deck.length,42);
    await replay(e,s);s=command(e,s,'END',0);s=advanceBattle(e,s,x=>x.turn===2&&!x.choice&&!x.window);assert.ok(names(s.players[0].extra).includes('Elemental HERO Aqua Neos'));assert.equal(s.players[0].monsters.filter(Boolean).length,0);
  }finally{e.destroyMatch(s);}
});
test('Diamond Dude resolves the excavated Spell on the next turn after leaving the field',async()=>{
  const e=backend();let s=await game(e,{hands:[[],['Raigeki']],fields:[{monsters:[body('Destiny HERO - Diamond Dude')]},{}],main:[Array(40).fill(get('Pot of Greed')),Array(40).fill(get('Mystical Elf'))]});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Destiny HERO - Diamond Dude'));assert.deepEqual(names(s.players[0].grave),['Pot of Greed']);assert.equal(s.players[0].hand.length,0);await replay(e,s);
    s=settle(e,command(e,s,'END',0));s=settle(e,command(e,s,'ACTIVATE',1,'Raigeki'));assert.ok(names(s.players[0].grave).includes('Destiny HERO - Diamond Dude'));s=settle(e,command(e,s,'END',1));
    const free=s.actions[0].find(a=>a.type==='ACTIVATE'&&s.players[0].grave.some(c=>c.uid===a.uid&&c.card.name==='Pot of Greed'));assert.ok(free,'The excavated Spell effect remains available');s=settle(e,e.applyAction(s,free,0));assert.equal(s.players[0].hand.length,3);assert.equal(s.players[0].deck.length,36);await replay(e,s);
  }finally{e.destroyMatch(s);}
});
test('Dark World triggers from effect discards, but never from a discard cost',async()=>{
  const e=backend();let s=await game(e,{hands:[['Graceful Charity','Goldd, Wu-Lord of Dark World','Broww, Huntsman of Dark World'],[]]});
  try{
    s=command(e,s,'ACTIVATE',0,'Graceful Charity');s=advanceBattle(e,s,x=>x.choice?.selectionType==='select_card');
    for(const name of ['Goldd, Wu-Lord of Dark World','Broww, Huntsman of Dark World'])s=e.applyAction(s,s.actions[0].find(a=>e.findCard(s,a.target)?.card.name===name),0);
    s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);s=settle(e,s);
    assert.ok(names(s.players[0].monsters).includes('Goldd, Wu-Lord of Dark World'));assert.equal(s.players[0].deck.length,36);await replay(e,s);
  }finally{e.destroyMatch(s);}
  s=await game(e,{hands:[['Lightning Vortex','Goldd, Wu-Lord of Dark World'],[]],fields:[{},{monsters:[body('Mystical Elf')]}]});
  try{s=settle(e,command(e,s,'ACTIVATE',0,'Lightning Vortex'));assert.ok(names(s.players[0].grave).includes('Goldd, Wu-Lord of Dark World'));assert.equal(s.players[0].monsters.filter(Boolean).length,0);assert.equal(s.players[1].monsters.filter(Boolean).length,0);}finally{e.destroyMatch(s);}
});
for(const blocking of [false,true])test(`Treeborn Frog checks the Standby Phase and Spell/Trap restriction (${blocking})`,async()=>{
  const e=backend();let s=await game(e,{first:1,fields:[{grave:[body('Treeborn Frog')],...(blocking?{spells:[{...body('Waboku'),faceUp:false}]}:{})},{}]});
  try{
    s=command(e,s,'END',1);
    if(blocking){s=advanceBattle(e,s,x=>x.active===0&&x.phase==='main1'&&!x.choice&&!x.window);assert.ok(names(s.players[0].grave).includes('Treeborn Frog'));}
    else{assert.equal(s.phase,'standby');assert.ok(s.actions[0].some(a=>a.yes===true));s=e.applyAction(s,s.actions[0].find(a=>a.yes===true),0);s=settle(e,s);assert.ok(names(s.players[0].monsters).includes('Treeborn Frog'));await replay(e,s);}
  }finally{e.destroyMatch(s);}
});
for(const [name,spellBanished] of [['Macro Cosmos',true],['Dimensional Fissure',false]])test(`${name} redirects the correct card types without interfering with the shared movement adapter`,async()=>{
  const e=backend();let s=await game(e,{hands:[['Raigeki'],[]],fields:[{spells:[body(name)]},{monsters:[body('Mystical Elf')]}]});
  try{s=settle(e,command(e,s,'ACTIVATE',0,'Raigeki'));assert.ok(names(s.players[1].banished).includes('Mystical Elf'));assert.equal(names(s.players[0].banished).includes('Raigeki'),spellBanished);assert.equal(names(s.players[0].grave).includes('Raigeki'),!spellBanished);await replay(e,s);}finally{e.destroyMatch(s);}
});
test('End of the World enforces exact Ritual Levels and Demise pays 2000 LP to destroy other cards',async()=>{
  const e=backend();let s=await game(e,{hands:[['End of the World','Demise, King of Armageddon','Blue-Eyes White Dragon'],[]],fields:[{},{monsters:[body('Mystical Elf')],spells:[{...body('Waboku'),faceUp:false}]}]});
  try{s=settle(e,command(e,s,'ACTIVATE',0,'End of the World'));assert.deepEqual(names(s.players[0].monsters),['Demise, King of Armageddon']);assert.ok(names(s.players[0].grave).includes('Blue-Eyes White Dragon'));s=settle(e,command(e,s,'ACTIVATE',0,'Demise, King of Armageddon'));assert.equal(s.players[0].lp,6000);assert.equal(s.players[1].monsters.filter(Boolean).length,0);assert.equal(s.players[1].spells.filter(Boolean).length,0);await replay(e,s);}finally{e.destroyMatch(s);}
});
for(const count of [2,3])test(`Overload Fusion banishes ${count} real materials, scales Chimeratech's ATK and clears its other cards`,async()=>{
  const e=backend();let s=await game(e,{hands:[['Overload Fusion'],[]],fields:[{monsters:[body('Summoned Skull')],grave:['Cyber Dragon',...Array(count-1).fill('Mechanicalchaser')].map(body)},{}],extra:['Chimeratech Overdragon']});
  try{
    s=settle(e,command(e,s,'ACTIVATE',0,'Overload Fusion'));const unit=s.players[0].monsters.find(Boolean);assert.equal(unit.card.name,'Chimeratech Overdragon');assert.equal(unit.currentStats.atk,count*800);assert.equal(unit.currentStats.def,count*800);assert.equal(s.players[0].banished.length,count);assert.ok(names(s.players[0].grave).includes('Summoned Skull'));await replay(e,s);
  }finally{e.destroyMatch(s);}
});
test('End of the World cannot use an excessive rather than exact Ritual Level sum',async()=>{
  const e=backend();let s=await game(e,{hands:[['End of the World','Demise, King of Armageddon','Summoned Skull','Mystical Elf'],[]]});
  try{assert.ok(!s.actions[0].some(a=>a.type==='ACTIVATE'&&e.findCard(s,a.uid)?.card.name==='End of the World'));}finally{e.destroyMatch(s);}
});
test('Alien A-Counters retain their real type/count through control changes and expire correctly',async()=>{
  const e=backend();let s=await game(e,{fields:[{monsters:[{...body('Alien Grey'),faceUp:false,defense:true}],spells:[{...body('Brainwashing Beam'),faceUp:false}]},{monsters:[body('Blue-Eyes White Dragon')]}]});
  try{
    s=settle(e,command(e,s,'POSITION',0,'Alien Grey'));let dragon=s.players[1].monsters.find(Boolean);assert.deepEqual(dragon.counters,{4110:1});assert.deepEqual(cardCounters(dragon),[{type:4110,count:1,label:'1 A-Counter'}]);
    s=settle(e,command(e,s,'ACTIVATE',0,'Brainwashing Beam'));dragon=s.players[0].monsters.find(c=>c?.card.name==='Blue-Eyes White Dragon');assert.ok(dragon);assert.equal(dragon.owner,1);assert.equal(dragon.counters[4110],1);await replay(e,s);
    s=command(e,s,'END',0);s=advanceBattle(e,s,x=>x.turn===2&&!x.choice&&!x.window);assert.ok(names(s.players[0].grave).includes('Brainwashing Beam'));dragon=s.players[1].monsters.find(Boolean);assert.equal(dragon.card.name,'Blue-Eyes White Dragon');assert.deepEqual(cardCounters(dragon),[]);await replay(e,s);
    assert.deepEqual(cardCounters({...dragon,faceUp:false,counters:{4110:4}}),[],'Hidden cards never display counters');
  }finally{e.destroyMatch(s);}
});
test('Clock Tower Prison reports typed live counters rather than treating their IDs as amounts',async()=>{
  const e=backend();let s=await game(e,{first:1,fields:[{field:[body('Clock Tower Prison')]},{}]});
  try{
    assert.deepEqual(s.players[0].field.counters,{27:1});assert.equal(cardCounters(s.players[0].field)[0].label,'1 Clock Counter');
    s=command(e,s,'END',1);s=command(e,s,'END',0);s=settle(e,s);assert.deepEqual(s.players[0].field.counters,{27:2});assert.equal(cardCounters(s.players[0].field)[0].label,'2 Clock Counters');await replay(e,s);
  }finally{e.destroyMatch(s);}
});
test('declining an optional attack cost does not trap the AI in retries or remove human legal actions',async()=>{
  const e=backend();let s=await game(e,{first:1,fields:[{monsters:['Panther Warrior','Mystical Elf'].map(body)},{}]});
  try{
    s=settle(e,command(e,s,'END',1));s=command(e,s,'NEXT',0);const panther=s.players[0].monsters.find(c=>c?.card.name==='Panther Warrior');s=command(e,s,'ATTACK',0,'Panther Warrior');assert.equal(s.choice.attackCostUid,panther.uid);assert.match(s.choice.instructions,/without a card cancels/);
    s=e.applyAction(s,s.actions[0].find(a=>a.finish),0);assert.ok(s.declinedAttacks[0].includes(panther.uid));assert.ok(s.actions[0].some(a=>a.type==='ATTACK'&&a.uid===panther.uid),'The human may still retry a legal declaration');const next=e.chooseAIAction(s,0);assert.ok(next.type!=='ATTACK'||next.uid!==panther.uid);await replay(e,s);
  }finally{e.destroyMatch(s);}
});
test('the AI pays an optional attack cost for a profitable lethal attack instead of declining for free',async()=>{
  const e=backend();let s=await game(e,{first:1,lp:1000,fields:[{monsters:['Panther Warrior','Mystical Elf'].map(body)},{}]});
  try{
    s=settle(e,command(e,s,'END',1));s=command(e,s,'NEXT',0);s=command(e,s,'ATTACK',0,'Panther Warrior');const cost=e.chooseAIAction(s,0);assert.equal(e.findCard(s,cost.target)?.card.name,'Mystical Elf');s=e.applyAction(s,cost,0);s=settle(e,s);assert.equal(s.winner,0);assert.ok(names(s.players[0].grave).includes('Mystical Elf'));
  }finally{e.destroyMatch(s);}
});
test('cancelling an attack with restricted targets moves the AI on instead of repeating the same declaration',async()=>{
  const e=backend();let s=await game(e,{first:1,fields:[{monsters:[body('Blade Skater')]},{monsters:[body('Hieracosphinx'),{...body('Exxod, Master of The Guard'),defense:true},{...body('Medusa Worm'),faceUp:false,defense:true}]}]});
  try{
    s=settle(e,command(e,s,'END',1));s=command(e,s,'NEXT',0);const attacker=s.players[0].monsters.find(Boolean);s=command(e,s,'ATTACK',0,'Blade Skater');assert.equal(s.choice.attackUid,attacker.uid);assert.ok(!s.actions[0].some(a=>e.findCard(s,a.target)?.card.name==='Medusa Worm'),'Hieracosphinx prevents the face-down target');const cancel=e.chooseAIAction(s,0);assert.ok(cancel.cancel);s=e.applyAction(s,cancel,0);assert.ok(s.declinedAttacks[0].includes(attacker.uid));assert.notEqual(e.chooseAIAction(s,0).type,'ATTACK');await replay(e,s);
  }finally{e.destroyMatch(s);}
});
test('a compulsory attacker commits to its least harmful legal target when the core blocks leaving Battle',async()=>{
  const e=backend();let s=await game(e,{first:1,fields:[{monsters:[body('Berserk Gorilla')]},{monsters:[body('Blue-Eyes White Dragon')]}]});
  try{
    s=settle(e,command(e,s,'END',1));s=command(e,s,'NEXT',0);const attack=s.actions[0].find(a=>a.type==='ATTACK');assert.ok(attack.battleExitBlocked);assert.ok(!s.actions[0].some(a=>['NEXT','END'].includes(a.type)));
    s=e.applyAction(s,attack,0);assert.ok(s.choice.attackRequired);s=e.applyAction(s,s.actions[0].find(a=>a.cancel),0);const retry=e.chooseAIAction(s,0);assert.equal(retry.type,'ATTACK');s=e.applyAction(s,retry,0);const target=e.chooseAIAction(s,0);assert.ok(target.target);assert.ok(!target.cancel);s=e.applyAction(s,target,0);s=settle(e,s);assert.ok(names(s.players[0].grave).includes('Berserk Gorilla'));assert.equal(s.players[0].lp,7000);assert.ok(s.actions[0].some(a=>a.type==='NEXT'));await replay(e,s);
  }finally{e.destroyMatch(s);}
});
for(const [name,zone,materials,atk] of [
  ['Raviel, Lord of Phantasms','monsters',['Summoned Skull','Summoned Skull','Summoned Skull'],4000],
  ['Hamon, Lord of Striking Thunder','spells',['Heart of the Underdog','Convulsion of Nature','Ground Collapse'],4000],
  ['Uria, Lord of Searing Flames','spells',['Ultimate Offering','Ultimate Offering','Ultimate Offering'],3000]
])test(`${name} uses its own three-card summon procedure and correct original ATK`,async()=>{
  const e=backend();let s=await game(e,{hands:[[name],[]],fields:[{[zone]:materials.map(body)},{}]});
  try{s=settle(e,command(e,s,'SUMMON',0,name));const unit=s.players[0].monsters.find(c=>c?.card.name===name);assert.ok(unit);assert.equal(unit.currentStats.atk,atk);assert.equal(s.players[0].grave.length,3);await replay(e,s);}finally{e.destroyMatch(s);}
});

function ui(saved,{engine=backend(),state,onDesign=()=>{}}={}){
  const window=new Window({url:'https://example.com/'});window.document.body.innerHTML='<main></main><dialog></dialog>';
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
  if(saved)localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify(saved));
  const main=document.querySelector('main'),modal=document.querySelector('dialog'),closeDialog=()=>modal.removeAttribute('open');
  const controller=createSoloController({main,modal,getCards:()=>cards,getDecks:()=>[],getStatus:()=>'ready',engine:state?{...engine,createMatch:async()=>state}:engine,showDialog:(html,kind='')=>{modal.innerHTML=`<div class="${kind}">${html}</div>`;modal.setAttribute('open','');},closeDialog,dialogHeader:title=>`<h2>${title}</h2>`,toast:message=>assert.fail(message),onDesign});controller.enter();
  return {window,controller,main,modal,$:selector=>document.querySelector(selector),close(){controller.destroy();window.close();}};
}
test('legacy default Solo cutoffs expand once while narrower filters and match preferences survive',()=>{
  const r=ui({sides:[{...defaultSide(),cutoff:'2004-12-31',race:'Dragon'},{...defaultSide(),cutoff:'2002-12-31'}],lp:4000,first:'ai',animations:false});
  try{
    const config=r.controller.getConfig();assert.equal(config.eraEnd,ERA_END);assert.equal(config.sides[0].cutoff,ERA_END);assert.equal(config.sides[0].race,'Dragon');assert.equal(config.sides[1].cutoff,'2002-12-31');assert.equal(config.lp,4000);assert.equal(config.first,'ai');
    r.$('[data-duel="filters"]').click();const select=r.$('[name="cutoff"]');assert.equal(select.value,ERA_END);assert.equal(select.options.length,11);assert.equal(select.options[0].textContent,'2006 & earlier');
    select.value='2004-12-31';r.$('#duel-filters').dispatchEvent(new r.window.Event('submit',{bubbles:true,cancelable:true}));const saved=JSON.parse(localStorage.getItem('duel-atlas.solo-config.v1'));assert.equal(saved.eraEnd,ERA_END);assert.equal(saved.sides[0].cutoff,'2004-12-31');
  }finally{r.close();}
});
test('a user-selected older cutoff in the new era stays selected and reaches the deck designer',()=>{
  let eligibility;const r=ui({eraEnd:ERA_END,sides:[{...defaultSide(),source:'saved',cutoff:'2004-12-31'},defaultSide()]},{onDesign:(_side,_deck,settings)=>eligibility=settings});
  try{assert.equal(r.controller.getConfig().sides[0].cutoff,'2004-12-31');r.$('[data-duel="design"]').click();assert.equal(eligibility.cutoff,'2004-12-31');r.$('[data-duel="coverage"]').click();assert.match(r.modal.textContent,/2006 engine/);}finally{r.close();}
});
test('the arena and card inspector display real A-Counter totals without covering card actions',async()=>{
  const e=backend();let s=await game(e,{fields:[{monsters:[{...body('Alien Grey'),faceUp:false,defense:true}]},{monsters:[body('Blue-Eyes White Dragon')]}]});s=settle(e,command(e,s,'POSITION',0,'Alien Grey'));
  const r=ui({animations:false,first:'you'},{engine:e,state:s});
  try{
    r.$('[data-duel="start"]').click();const deadline=Date.now()+2500;while(!r.$('.duel-counter-badge')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    const badge=r.$('.duel-counter-badge');assert.ok(badge);assert.equal(badge.textContent,'● 1');assert.equal(badge.title,'1 A-Counter');const button=badge.closest('button');assert.match(button.getAttribute('aria-label'),/1 A-Counter/);button.click();assert.equal(r.$('.duel-counter-description').textContent,'1 A-Counter');
  }finally{r.close();}
});
