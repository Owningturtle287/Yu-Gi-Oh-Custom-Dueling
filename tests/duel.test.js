import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDeck, addCard, normalizeCard } from '../src/core.js';
import { support, supportedPool } from '../src/duel/catalog.js';
import { defaultSide, poolFor, generateDeck, validateDuelDeck, eligibleSets, loadSets, expandDeck } from '../src/duel/decks.js';
import { createMatch, applyAction, legalActions, findCard, stats, observation } from '../src/duel/engine.js';
import { chooseAIAction } from '../src/duel/ai.js';
import { memoryStorage } from './fixtures.js';

let nextId=100;
const card=(name,props={})=>({id:nextId++,name,type:'Normal Monster',race:'Warrior',attribute:'EARTH',level:4,atk:1600,def:1000,tcgDate:'2002-03-08',desc:'A test monster.',setNames:['Test set'],card_images:[],...props});
const spell=(name,props={})=>card(name,{type:'Spell Card',race:'Normal',atk:undefined,def:undefined,level:undefined,...props});
const trap=(name,props={})=>spell(name,{type:'Trap Card',...props});
const normal=card('Test warrior'),strong=card('Test dragon',{race:'Dragon',atk:2000,def:1500});
const baseDeck={main:Array.from({length:40},()=>normal),extra:[]};
function game(){const state=createMatch([baseDeck,baseDeck],{seed:123});state.phase='main1';return state;}
function instance(state,side,value,zone='hand',props={}){
  const c={uid:`test-${++state.serial}`,card:value,owner:side,controller:side,faceUp:true,position:'attack',summonedTurn:0,changedTurn:0,attacks:0,...props};
  if(['monsters','spells'].includes(zone))state.players[side][zone][state.players[side][zone].indexOf(null)]=c;
  else if(zone==='field')state.players[side].field=c;
  else state.players[side][zone].push(c);return c;
}
function action(state,type,predicate=()=>true,side=state.active){const a=legalActions(state,side).find(a=>a.type===type&&predicate(a));assert.ok(a,`Missing legal ${type} at ${state.phase}`);return applyAction(state,a,side);}
function pass(state){let n=0;while(state.window){assert.ok(n++<20);state=applyAction(state,{type:'PASS'},state.window.priority);}return state;}
function invariant(state,total){
  const values=state.players.flatMap(p=>[...p.deck,...p.hand,...p.monsters.filter(Boolean),...p.spells.filter(Boolean),...p.grave,...p.banished,...p.extra,...(p.field?[p.field]:[])]);
  assert.equal(values.length,total);assert.equal(new Set(values.map(c=>c.uid)).size,total);
  for(const p of state.players){assert.equal(p.monsters.length,5);assert.equal(p.spells.length,5);}
}
test('the capability boundary admits dated Normal Monsters and explicit effects, never silent vanilla effects',()=>{
  assert.equal(support(normal).ok,true);
  assert.equal(support(card('Unknown effect',{type:'Effect Monster'})).ok,false);
  assert.equal(support({...normal,tcgDate:'2007-01-01'}).ok,false);
  assert.equal(support({...normal,tcgDate:null}).ok,false);
  assert.equal(support(spell('Pot of Greed')).ok,true);
  const fusion=card('Test fusion',{type:'Fusion Monster',desc:'"Test warrior" + "Test dragon"'});
  assert.deepEqual(support(fusion).rule.materials,['Test warrior','Test dragon']);
  assert.equal(support({...fusion,desc:fusion.desc+'\nAn unimplemented effect.'}).ok,false);
});
test('side-specific filters combine dates, types, attributes, subtypes, and spell/trap switches',()=>{
  const cards=[normal,strong,spell('Pot of Greed'),trap('Mirror Force'),card('Man-Eater Bug',{type:'Flip Effect Monster',race:'Insect',attribute:'EARTH',tcgDate:'2002-06-26'})];
  assert.deepEqual(poolFor(cards,{...defaultSide(),race:'Dragon',spells:false,traps:false}),[strong]);
  assert.deepEqual(poolFor(cards,{...defaultSide(),subtype:'Flip',cutoff:'2002-03-31',spells:false,traps:false}),[]);
  assert.deepEqual(poolFor(cards,{...defaultSide(),subtype:'Flip',spells:false,traps:false}).map(c=>c.name),['Man-Eater Bug']);
});
test('random card/set decks honor exact pools, copy limits, cutoff dates, and insufficient-pool errors',()=>{
  const cards=Array.from({length:24},(_,i)=>card(`Candidate ${i}`,{atk:1000+i*50,setNames:i<20?['Early set']:['Late set']}));
  const sets=[{name:'Early set',date:'2002-03-08'},{name:'Late set',date:'2007-01-01'}];
  for(let seed=1;seed<=20;seed++){
    const settings={...defaultSide(),source:'set'};const deck=generateDeck(cards,settings,sets,seed);
    assert.equal(deck.sections.main.reduce((n,e)=>n+e.quantity,0),40);
    assert.ok(deck.sections.main.every(e=>e.quantity<=3&&e.card.setNames.includes('Early set')));
    assert.deepEqual(validateDuelDeck(deck,cards,settings),[]);
  }
  assert.equal(eligibleSets(cards,sets,defaultSide()).length,1);
  assert.throws(()=>generateDeck(cards.slice(0,5),defaultSide()),/fewer than 40/);
  assert.throws(()=>generateDeck(cards,{...defaultSide(),source:'set',set:'Late set'},sets),/No released set/);
  assert.throws(()=>generateDeck(cards,{...defaultSide(),attribute:'DARK'}),/fewer than 40/);
});
test('saved decks validate all playable sections against canonical API cards',()=>{
  let deck=createDeck('Classic');const cards=Array.from({length:14},(_,i)=>card('Saved '+i));
  for(let i=0;i<40;i++)deck=addCard(deck,cards[Math.floor(i/3)]);
  assert.deepEqual(validateDuelDeck(deck,cards),[]);
  assert.ok(validateDuelDeck(deck,cards,{...defaultSide(),race:'Dragon'}).some(s=>s.includes('filters')));
  const forged=structuredClone(deck);forged.sections.main[0].card.name='Pretend card';
  assert.deepEqual(expandDeck(forged,cards).main[0],normalizeCard(cards[0]));
  assert.ok(validateDuelDeck({...deck,sections:{...deck.sections,main:[]}},cards)[0].includes('40–60'));
  assert.ok(validateDuelDeck(deck,cards.slice(1)).some(s=>s.includes('not in the loaded archive')));
});
test('set metadata is fetched once, cached, and reused offline; failures are retryable',async()=>{
  const storage=memoryStorage();let calls=0;
  const fetchImpl=async()=>{calls++;return{ok:true,json:async()=>[{set_name:'Early set',tcg_date:'2002-03-08'},{set_name:'Later',tcg_date:'2007-01-01'}]};};
  assert.equal((await loadSets({storage,fetchImpl,now:100})).sets.length,1);
  await loadSets({storage,fetchImpl,now:101});assert.equal(calls,1);
  const fail=async()=>{throw new Error('Offline');};
  assert.equal((await loadSets({storage,fetchImpl:fail,force:true})).offline,true);
  await assert.rejects(loadSets({storage:memoryStorage(),fetchImpl:fail}),/Retry/);
});
test('opening hands, first-turn restrictions, second-player draw, phase sequence and hand limit',()=>{
  let s=createMatch([baseDeck,baseDeck],{seed:123});assert.deepEqual(s.players.map(p=>p.hand.length),[5,5]);
  assert.equal(s.phase,'draw');s=pass(action(s,'NEXT'));assert.equal(s.phase,'standby');
  s=pass(action(s,'NEXT'));assert.equal(s.phase,'main1');
  s=pass(action(s,'NEXT'));assert.equal(s.phase,'main2');
  s=pass(action(s,'NEXT'));assert.equal(s.phase,'end');
  s=action(s,'NEXT');assert.equal(s.turn,2);assert.equal(s.active,1);assert.equal(s.players[1].hand.length,6);
  s.phase='end';s.players[1].hand.push(s.players[1].deck.shift());
  assert.ok(legalActions(s,1).every(a=>a.type==='DISCARD'));
  s=action(s,'DISCARD');s=action(s,'NEXT');assert.equal(s.active,0);
});
test('summon, Set, Tribute and position permissions consume the correct turn resources immutably',()=>{
  let s=game();const original=structuredClone(s);s=pass(action(s,'SUMMON',a=>!a.set));
  assert.deepEqual(original.players[0].monsters,Array(5).fill(null));assert.equal(s.normalUsed,true);
  assert.equal(legalActions(s,0).some(a=>a.type==='SUMMON'||a.type==='POSITION'),false);
  s.turn=3;s.normalUsed=false;const high=instance(s,0,card('Tribute monster',{level:7,atk:2600}));
  assert.equal(legalActions(s,0).some(a=>a.type==='SUMMON'&&a.uid===high.uid),false);
  instance(s,0,normal,'monsters');s=pass(action(s,'SUMMON',a=>a.uid===high.uid&&!a.set));
  assert.equal(s.players[0].monsters.filter(Boolean).length,1);assert.equal(s.players[0].grave.length,2);
  assert.equal(s.players[0].monsters.find(Boolean).card.name,'Tribute monster');
});
test('battle handles attack/defense damage, equal attacks, direct attacks, and one attack per monster',()=>{
  let s=game();s.turn=2;s.phase='battle';const a=instance(s,0,strong,'monsters'),d=instance(s,1,normal,'monsters');
  s=pass(action(s,'ATTACK',x=>x.uid===a.uid&&x.target===d.uid));assert.equal(s.players[1].lp,7600);assert.equal(s.players[1].grave.length,1);
  assert.equal(legalActions(s,0).some(x=>x.type==='ATTACK'),false);
  s=game();s.turn=2;s.phase='battle';instance(s,0,normal,'monsters');instance(s,1,strong,'monsters',{position:'defense',card:{...strong,def:2100}});
  s=pass(action(s,'ATTACK'));assert.equal(s.players[0].lp,7500);assert.equal(s.players[0].monsters.filter(Boolean).length,1);
  s=game();s.turn=2;s.phase='battle';instance(s,0,normal,'monsters');instance(s,1,normal,'monsters');s=pass(action(s,'ATTACK'));assert.equal(s.players[0].grave.length,1);assert.equal(s.players[1].grave.length,1);
  s=game();s.turn=2;s.phase='battle';instance(s,0,strong,'monsters');s=pass(action(s,'ATTACK'));assert.equal(s.players[1].lp,6000);
});
test('face-down FLIP effects resolve after damage calculation and before battle cleanup',()=>{
  let s=game();s.turn=2;s.phase='battle';const attacker=instance(s,0,strong,'monsters');
  instance(s,1,card('Man-Eater Bug',{type:'Flip Effect Monster',atk:450,def:600}),'monsters',{faceUp:false,position:'defense'});
  s=pass(action(s,'ATTACK'));assert.equal(s.choice.side,1);assert.equal(s.players[1].grave.length,0);
  s=action(s,'CHOOSE',a=>a.target===attacker.uid,1);
  assert.equal(s.players[0].grave.length,1);assert.equal(s.players[1].grave.length,1);assert.equal(s.pending,null);
});
test('set traps wait a turn; Mirror Force destroys Attack Position only before attack damage',()=>{
  let s=game();s.turn=2;s.phase='battle';const attacker=instance(s,0,strong,'monsters');instance(s,0,normal,'monsters',{position:'defense'});
  const mirror=instance(s,1,trap('Mirror Force'),'spells',{faceUp:false,setTurn:1});
  s=action(s,'ATTACK',a=>a.uid===attacker.uid);
  assert.ok(legalActions(s,1).some(a=>a.uid===mirror.uid));
  s=action(s,'ACTIVATE',a=>a.uid===mirror.uid,1);s=pass(s);
  assert.equal(s.players[0].monsters.filter(Boolean).length,1);assert.equal(s.players[1].lp,8000);
  s=game();const set=instance(s,0,trap('Waboku'));s=action(s,'SET',a=>a.uid===set.uid);
  assert.equal(legalActions(s,0).some(a=>a.type==='ACTIVATE'&&a.uid===set.uid),false);
});
test('response chain resolves last-in-first-out with costs, negation, and speed restrictions',()=>{
  let s=game();const pot=instance(s,0,spell('Pot of Greed')),jammer=instance(s,1,trap('Magic Jammer'),'spells',{faceUp:false,setTurn:0});
  const bandit=instance(s,0,trap('Seven Tools of the Bandit'),'spells',{faceUp:false,setTurn:0});
  const before=s.players[0].hand.length;
  s=action(s,'ACTIVATE',a=>a.uid===pot.uid);s=action(s,'ACTIVATE',a=>a.uid===jammer.uid,1);
  assert.equal(s.players[1].hand.length,4,'discard cost is paid immediately');
  assert.ok(legalActions(s,0).filter(a=>a.type==='ACTIVATE').every(a=>a.uid===bandit.uid));
  s=action(s,'ACTIVATE',a=>a.uid===bandit.uid,0);s=pass(s);
  assert.equal(s.players[0].lp,7000);assert.equal(s.players[0].hand.length,before+1,'Pot resolves after Jammer is negated');
  assert.equal(s.chain.length,0);assert.equal(s.window,null);
});
test('destroying a Normal Spell does not negate it; destroying an Equip stops its bonus',()=>{
  let s=game();const pot=instance(s,0,spell('Pot of Greed')),mst=instance(s,1,spell('Mystical Space Typhoon',{race:'Quick-Play'}),'spells',{faceUp:false,setTurn:0});const before=s.players[0].hand.length;
  s=action(s,'ACTIVATE',a=>a.uid===pot.uid);s=action(s,'ACTIVATE',a=>a.uid===mst.uid&&a.target===pot.uid,1);s=pass(s);assert.equal(s.players[0].hand.length,before+1);
  s=game();const m=instance(s,0,normal,'monsters'),equip=instance(s,0,spell('Legendary Sword'));
  s=pass(action(s,'ACTIVATE',a=>a.uid===equip.uid&&a.target===m.uid));assert.equal(stats(s,findCard(s,m.uid)).atk,1900);
  const destroy=instance(s,0,spell('Mystical Space Typhoon',{race:'Quick-Play'}));s=pass(action(s,'ACTIVATE',a=>a.uid===destroy.uid&&a.target===equip.uid));assert.equal(stats(s,findCard(s,m.uid)).atk,1600);
});
test('Trap Hole, Solemn summon negation, Jinzo, Waboku and Gravity Bind enforce their windows',()=>{
  let s=game();const hole=instance(s,1,trap('Trap Hole'),'spells',{faceUp:false,setTurn:0});s=action(s,'SUMMON',a=>!a.set);s=pass(action(s,'ACTIVATE',a=>a.uid===hole.uid,1));assert.equal(s.players[0].monsters.filter(Boolean).length,0);
  s=game();const solemn=instance(s,1,trap('Solemn Judgment'),'spells',{faceUp:false,setTurn:0});s=action(s,'SUMMON',a=>!a.set);s=pass(action(s,'ACTIVATE',a=>a.uid===solemn.uid,1));assert.equal(s.players[1].lp,4000);assert.equal(s.players[0].monsters.filter(Boolean).length,0);
  s=game();instance(s,0,card('Jinzo',{type:'Effect Monster',level:6}),'monsters');const waboku=instance(s,0,trap('Waboku'),'spells',{faceUp:false,setTurn:0});assert.equal(legalActions(s,0).some(a=>a.uid===waboku.uid),false);
  s=game();s.phase='battle';s.turn=2;instance(s,0,strong,'monsters');instance(s,1,normal,'monsters');const w=instance(s,1,trap('Waboku'),'spells',{faceUp:false,setTurn:0});s=action(s,'ATTACK');s=pass(action(s,'ACTIVATE',a=>a.uid===w.uid,1));assert.equal(s.players[1].lp,8000);assert.equal(s.players[1].grave.length,1);assert.equal(s.players[1].monsters.filter(Boolean).length,1);
  s=game();s.phase='battle';s.turn=2;instance(s,0,strong,'monsters');instance(s,1,trap('Gravity Bind'),'spells');assert.equal(legalActions(s,0).some(a=>a.type==='ATTACK'),false);
});
test('revival, temporary control return, Fusion materials, and correct owner graveyards',()=>{
  let s=game();const monster=instance(s,1,strong,'grave'),reborn=instance(s,0,spell('Monster Reborn'));
  s=pass(action(s,'ACTIVATE',a=>a.uid===reborn.uid&&a.target===monster.uid));assert.equal(s.players[0].monsters.find(Boolean).owner,1);
  const hole=instance(s,0,spell('Dark Hole'));s=pass(action(s,'ACTIVATE',a=>a.uid===hole.uid));assert.ok(s.players[1].grave.some(c=>c.uid===monster.uid));
  s=game();const target=instance(s,1,strong,'monsters'),change=instance(s,0,spell('Change of Heart'));
  s=pass(action(s,'ACTIVATE',a=>a.uid===change.uid&&a.target===target.uid));assert.ok(s.players[0].monsters.some(c=>c?.uid===target.uid));s.phase='end';s.players[0].hand=s.players[0].hand.slice(0,6);s=action(s,'NEXT');assert.ok(s.players[1].monsters.some(c=>c?.uid===target.uid));
  s=game();instance(s,0,strong);const fusion=instance(s,0,card('Test fusion',{type:'Fusion Monster',desc:'"Test warrior" + "Test dragon"',atk:3000}),'extra');const poly=instance(s,0,spell('Polymerization'));
  s=pass(action(s,'ACTIVATE',a=>a.uid===poly.uid&&a.fusion===fusion.uid));assert.ok(s.players[0].monsters.some(c=>c?.uid===fusion.uid&&c.proper));assert.equal(s.players[0].grave.filter(c=>isFinite(c.card.atk)).length,2);
});
test('deck-out, damage victory, Exodia and surrender stop further actions',()=>{
  let s=game();s.phase='end';s.players[1].deck=[];s=action(s,'NEXT');assert.equal(s.winner,0);assert.deepEqual(legalActions(s,0),[]);
  s=game();s.players[1].lp=200;const sparks=instance(s,0,spell('Sparks'));s=pass(action(s,'ACTIVATE',a=>a.uid===sparks.uid));assert.equal(s.winner,0);
  s=game();for(const name of ['Exodia the Forbidden One','Right Arm of the Forbidden One','Left Arm of the Forbidden One','Right Leg of the Forbidden One','Left Leg of the Forbidden One'])instance(s,0,card(name,{type:name==='Exodia the Forbidden One'?'Effect Monster':'Normal Monster'}));s=action(s,'NEXT');assert.equal(s.winner,0);
  s=applyAction(game(),{type:'SURRENDER'},0);assert.equal(s.winner,1);
});
test('AI scoring is invariant to opposing hand, set stats and deck order on all difficulties',()=>{
  const s=game();s.active=1;instance(s,1,strong,'monsters');instance(s,0,normal,'monsters',{faceUp:false,position:'defense'});
  const changed=structuredClone(s);changed.players[0].hand.forEach(c=>c.card=strong);changed.players[0].monsters.find(Boolean).card={...strong,atk:9999,def:9999};changed.players[0].deck.reverse();changed.players[1].deck.reverse();
  assert.deepEqual(observation(s,1),observation(changed,1));
  for(const difficulty of ['easy','normal','hard'])assert.deepEqual(chooseAIAction(s,1,difficulty),chooseAIAction(changed,1,difficulty));
});
test('Field Spells Set into the separate Field zone, stay hidden, and activate without a backrow slot',()=>{
  let s=game();const field=instance(s,0,spell('Sogen',{race:'Field'})),warrior=instance(s,0,normal,'monsters');
  for(let n=0;n<5;n++)instance(s,0,trap('Waboku'),'spells',{faceUp:false,setTurn:0});
  s=action(s,'SET',a=>a.uid===field.uid);assert.equal(s.players[0].field.uid,field.uid);assert.equal(s.players[0].spells.filter(Boolean).length,5);
  assert.equal(observation(s,1).players[0].field.card.name,'Set card');
  s=pass(action(s,'ACTIVATE',a=>a.uid===field.uid));assert.equal(stats(s,findCard(s,warrior.uid)).atk,1800);
  const other=instance(s,0,spell('Mountain',{race:'Field'}));s=pass(action(s,'ACTIVATE',a=>a.uid===other.uid));
  assert.equal(s.players[0].field.uid,other.uid);assert.ok(s.players[0].grave.some(c=>c.uid===field.uid));
});
test('Fissure rechecks the lowest current ATK after a responding boost',()=>{
  let s=game();const weak=instance(s,1,normal,'monsters'),other=instance(s,1,{...strong,atk:1800},'monsters'),fissure=instance(s,0,spell('Fissure'));
  const reinforcements=instance(s,1,trap('Reinforcements'),'spells',{faceUp:false,setTurn:0});
  s=action(s,'ACTIVATE',a=>a.uid===fissure.uid);s=action(s,'ACTIVATE',a=>a.uid===reinforcements.uid&&a.target===weak.uid,1);s=pass(s);
  assert.ok(s.players[1].grave.some(c=>c.uid===other.uid));assert.ok(s.players[1].monsters.some(c=>c?.uid===weak.uid));
});
test('seeded full AI matches finish, conserve all cards and never select an illegal action',()=>{
  const cards=Array.from({length:22},(_,i)=>card('Simulation '+i,{atk:900+i*60,def:600+i*70,level:i<18?4:6}));
  cards.push(...['Raigeki','Pot of Greed','Monster Reborn','Dark Hole','Sparks','Change of Heart','Mystical Space Typhoon','Legendary Sword'].map(name=>spell(name,{race:name==='Mystical Space Typhoon'?'Quick-Play':name==='Legendary Sword'?'Equip':'Normal'})),trap('Mirror Force'),trap('Waboku'),trap('Trap Hole'));
  for(let seed=1;seed<=12;seed++){
    const decks=[seed,seed+100].map(n=>generateDeck(cards,defaultSide(),[],n));
    let state=createMatch(decks.map(deck=>expandDeck(deck,cards)),{seed,first:seed%2,lp:4000}),steps=0;
    while(state.winner===null&&steps++<1800){const side=legalActions(state,0).length?0:1;const a=chooseAIAction(state,side,['easy','normal','hard'][seed%3]);assert.ok(a,`Seed ${seed} stalled`);state=applyAction(state,a,side);invariant(state,80);}
    assert.notEqual(state.winner,null,`Seed ${seed} did not finish in ${steps} actions`);
  }
});
test('Solo landscape layout keeps the complete arena bounded and reserves space for both field rows',async()=>{
  const css=await readFile(new URL('../duel.css',import.meta.url),'utf8');
  assert.match(css,/\.duel-playing \.duel-arena\.screen \{[^}]*height:100%[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(css,/\.duel-table \{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*grid-template-rows:minmax\(0,1fr\) 18px minmax\(0,1.12fr\)[^}]*min-height:0/);
  assert.match(css,/\.duel-hand \{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
  assert.match(css,/\.duel-board \{[^}]*grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.duel-playing \.topbar, \.duel-playing \.bottom-nav \{ display:none/);
  assert.match(css,/orientation:landscape/);assert.match(css,/min-height:44px/);
});
