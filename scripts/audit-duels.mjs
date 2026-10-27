// Reproducible offline integration audit. Synthetic card probes exercise the
// adapter; complete games separately use ordinary legal player decks and 30–60-card AI decks.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeCard,cardCopyName} from '../src/core.js';
import {supportedPool,ERA_END} from '../src/duel/catalog.js';
import {defaultSide,eligibleSets,generateDeck,expandDeck,prepareAIDeck,seededRandom,validateDuelDeck} from '../src/duel/decks.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';

assert.ok(process.env.DUEL_CARD_SNAPSHOT,'Set DUEL_CARD_SNAPSHOT to a full API snapshot; the audit makes no card API requests.');
const cards=JSON.parse(await readFile(process.env.DUEL_CARD_SNAPSHOT,'utf8')).data.map(normalizeCard);
const pool=supportedPool(cards),byName=new Map(pool.map(c=>[c.name,c])),get=name=>{assert.ok(byName.has(name),name);return byName.get(name);};
const sets=process.env.DUEL_SET_SNAPSHOT?JSON.parse(await readFile(process.env.DUEL_SET_SNAPSHOT,'utf8')).filter(s=>s.tcg_date&&s.tcg_date<=ERA_END).map(s=>({name:s.set_name,date:s.tcg_date})):[];
const output=resolve(process.env.AUDIT_OUT||'audit-output');await mkdir(output,{recursive:true});
const games=Number(process.env.AUDIT_GAMES??300),gameStart=Number(process.env.AUDIT_GAME_START||0),limit=Number(process.env.AUDIT_LIMIT||pool.length),start=Number(process.env.AUDIT_SEED||1001);
const probeSide=Number(process.env.AUDIT_SIDE||0),aiSizes=(process.env.AUDIT_AI_SIZES||'30,40,60').split(',').map(Number);
assert.ok([0,1].includes(probeSide));assert.ok(aiSizes.length&&aiSizes.every(n=>Number.isInteger(n)&&n>=30&&n<=60));
const report={eraEnd:ERA_END,archive:cards.length,eligible:pool.length,started:new Date().toISOString(),probes:0,games:0,completedGames:0,actions:0,replays:0,failures:[],timeouts:[],messages:{},prompts:{},types:{},effects:[],cards:[]};
const coverage=new Map(pool.map(c=>[c.id,{id:c.id,name:c.name,contexts:[],drawn:false,played:false,activated:false,resolved:false}])),effects=new Set();
let currentEvents=[];
const pack=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
report.configuration={games,gameStart,seed:start,limit,randomVersion:Number(process.env.AUDIT_RANDOM_VERSION||3),promptVersion:2,probeSide,aiSizes,sweep:process.env.AUDIT_SWEEP!=='0',battleFlips:process.env.AUDIT_FLIPS==='1',actionLimit:Number(process.env.AUDIT_MAX_ACTIONS||2500)};
report.rulesRevision=pack.manifest.scriptsRevision;
report.poolHash=createHash('sha256').update(JSON.stringify(pool.map(c=>[c.id,c.name,c.type,c.desc,c.level,c.atk,c.def,c.race,c.attribute,c.tcgDate]))).digest('hex');
report.cardsSnapshotHash=createHash('sha256').update(await readFile(process.env.DUEL_CARD_SNAPSHOT)).digest('hex');
if(process.env.DUEL_SET_SNAPSHOT)report.setsSnapshotHash=createHash('sha256').update(await readFile(process.env.DUEL_SET_SNAPSHOT)).digest('hex');
const lib={...pack.lib,duelGetMessage(handle){const messages=pack.lib.duelGetMessage(handle);currentEvents.push(...messages);return messages;}};
const engine=createNativeBackend({rules:()=>({...pack,lib})});
const all=s=>s.players.flatMap(p=>['deck','hand','monsters','spells','extra','grave','banished'].flatMap(z=>p[z].filter(Boolean)).concat(p.field?[p.field]:[]));
function inspect(s){
  const instances=all(s);assert.equal(new Set(instances.map(c=>c.uid)).size,instances.length,'Duplicate card instance identity');
  for(let side=0;side<2;side++){
    const p=s.players[side];assert.ok(Number.isInteger(p.lp)&&p.lp>=0,'Invalid LP');assert.equal(p.monsters.length,5);assert.equal(p.spells.length,5);
    for(const zone of ['deck','hand','monsters','spells','extra','grave','banished'])for(const c of p[zone].filter(Boolean)){
      assert.equal(c.controller,side,'Controller mismatch');assert.ok(c.owner===0||c.owner===1);assert.ok([c.currentStats.atk,c.currentStats.def].every(n=>Number.isFinite(n)&&n>=0&&n<=0x7fffffff),'Invalid signed monster stats');
      const row=coverage.get(c.card.id);if(row&&zone==='hand')row.drawn=true;
    }
  }
  for(const msg of currentEvents.splice(0)){
    const type=pack.module.ocgMessageTypeStrings.get(msg.type)||String(msg.type);report.messages[type]=(report.messages[type]||0)+1;
    if(msg.code&&[pack.module.OcgMessageType.SUMMONING,pack.module.OcgMessageType.SPSUMMONING,pack.module.OcgMessageType.FLIPSUMMONING,pack.module.OcgMessageType.CHAINING].includes(msg.type)){
      const row=coverage.get(msg.code);if(row)row.played=true;
    }
    if(msg.type===pack.module.OcgMessageType.CHAINING){const row=coverage.get(msg.code);if(row)row.activated=true;const name=pack.records.get(msg.code)?.name;if(name)effects.add(name);}
  }
  if(s.choice)report.prompts[s.choice.selectionType]=(report.prompts[s.choice.selectionType]||0)+1;
  for(const e of s.log){const name=e.effectNotice?.card?.name;if(name&&['resolve','automatic','ready'].includes(e.effectNotice.stage)){effects.add(name);const row=coverage.get(e.effectNotice.card.id);if(row)row.resolved=true;}}
  if(s.winner===null)assert.ok(s.actions[0].length||s.actions[1].length,'No legal continuation');
}
async function replay(s){const saved=engine.exportMatch(s),restored=await engine.restoreMatch(saved,{cards});try{assert.equal(engine.exportMatch(restored).checkpoint,saved.checkpoint);report.replays++;}finally{engine.destroyMatch(restored);currentEvents=[];}}
async function run(label,decks,options,{probe=null,battleProbe=false,cap=180,full=false,replayAt=0,replayEnd=false}={}){
  let s,steps=0,replayed=false,battleCommitted=false,lastPrompt='',staging=new Map();const recent=[];
  try{
    if(full)for(const [side,deck] of decks.entries())assert.deepEqual(validateDuelDeck({sections:{main:deck.main.map(card=>({card,quantity:1})),extra:deck.extra.map(card=>({card,quantity:1})),side:[]}},cards,defaultSide(),{min:side===1?30:40,max:60}),[],'Full-game decks must pass the app’s actual deck validator');
    currentEvents=[];s=await engine.createMatch(decks,{cards,randomVersion:process.env.AUDIT_RANDOM_VERSION?Number(process.env.AUDIT_RANDOM_VERSION):3,...options});inspect(s);
    while(s.winner===null&&steps<cap&&(full||s.turn<3||s.choice||s.window)){
      const side=s.actions[0].length?0:1,actions=s.actions[side];let action;
      if(battleProbe&&!battleCommitted){
        if(s.choice?.attackUid)action=actions.find(a=>a.finish)||actions.find(a=>!a.selected&&engine.findCard(s,a.target)?.card.id===probe.id);
        if(!s.choice&&!s.window&&s.active===probeSide&&s.turn===1)action=actions.find(a=>a.type==='END');
        if(!s.choice&&!s.window&&s.active!==probeSide&&s.phase==='main1')action=actions.find(a=>a.type==='NEXT');
        action??=actions.find(a=>a.type==='ATTACK');
      }
      if(probe){
        action??=actions.find(a=>a.yes===true&&(a.effectCard?.id===probe.id||engine.findCard(s,s.choice?.trigger?.uid)?.card.id===probe.id));
        action??=actions.find(a=>engine.findCard(s,a.uid)?.card.id===probe.id&&['ACTIVATE','EFFECT'].includes(a.type));
        if(!battleProbe)action??=actions.find(a=>engine.findCard(s,a.uid)?.card.id===probe.id&&['SUMMON','POSITION'].includes(a.type)&&!a.set);
      }
      action??=engine.chooseAIAction(s,side);assert.ok(action,'AI returned no continuation');
      recent.push({turn:s.turn,phase:s.phase,side,type:action.type,label:action.label,card:engine.findCard(s,action.uid)?.card.name,target:engine.findCard(s,action.target)?.card.name,choice:s.choice?.title});if(recent.length>15)recent.shift();
      if(s.choice?.stage){
        if(lastPrompt!==s.choice.promptId){lastPrompt=s.choice.promptId;staging=new Map();}
        const signature=JSON.stringify(actions.map(a=>[a.label,a.selected,a.finish]));const n=(staging.get(signature)||0)+1;staging.set(signature,n);assert.ok(n<=3,'Selection repeatedly cycles without confirming');
      }
      if(battleProbe&&s.choice?.attackUid&&action.finish&&s.choice.selected.length)battleCommitted=true;
      s=engine.applyAction(s,action,side);steps++;report.actions++;report.types[action.type]=(report.types[action.type]||0)+1;inspect(s);
      if(!replayed&&replayAt&&steps>=replayAt){await replay(s);replayed=true;}
    }
    if(full){report.games++;if(s.winner!==null)report.completedGames++;else {const timeout={label,turn:s.turn,steps,recent};report.timeouts.push(timeout);await writeFile(resolve(output,`timeout-${report.timeouts.length}.json`),JSON.stringify({timeout,replay:engine.exportMatch(s),players:s.players},null,2));console.log('LIMIT',JSON.stringify(timeout));}}
    else {assert.ok(s.winner!==null||s.turn>=3,'Card probe did not reach its next turn');if(replayEnd)await replay(s);report.probes++;if(probe)coverage.get(probe.id).contexts.push(label.split(':')[0]+':controller'+probeSide);}
  }catch(error){
    const failure={label,message:error.message,turn:s?.turn,phase:s?.phase,choice:s?.choice?.title,recent};report.failures.push(failure);
    if(s)await writeFile(resolve(output,`failure-${report.failures.length}.json`),JSON.stringify({failure,replay:engine.exportMatch(s)},null,2));
    console.log('FAIL',JSON.stringify(failure));
  }finally{engine.destroyMatch(s);}
}
const normalDeck=()=>({name:'Card probe',main:['Mystical Elf','Gemini Elf','Dark Magician','Blue-Eyes White Dragon','Summoned Skull'].flatMap(n=>Array(8).fill(get(n))),extra:['Flame Swordsman','Thousand-Eyes Restrict','XYZ-Dragon Cannon'].map(get)});
const body=name=>({card:get(name)}),own=()=>({monsters:['Mystical Elf','Summoned Skull'].map(body),spells:[{...body('Waboku'),faceUp:false}],grave:['Sangan','Mystical Space Typhoon','Blue-Eyes White Dragon'].map(body)});
if(process.env.AUDIT_SWEEP!=='0')for(const [index,card] of pool.slice(0,limit).entries()){
  for(const context of card.type==='Normal Monster'?['field']:['hand','field']){
    const fields=[own(),own()],hands=[['Dark Magician','Mystical Elf','Pot of Greed'].map(get),['Mystical Elf'].map(get)];
    if(context==='hand'&&card.type!=='Trap Card'&&!card.type.includes('Fusion'))hands[probeSide].unshift(card);
    else if(card.type.includes('Monster'))fields[probeSide].monsters[0]={card,faceUp:!/FLIP:/.test(card.desc),defense:/FLIP:/.test(card.desc)};
    else if(card.race==='Field')fields[probeSide].field=[{card,faceUp:context==='field'}];
    // Equip cards must be activated and assigned a real equip target. Normal
    // Spells/Traps likewise cannot start as an idle face-up field card.
    else fields[probeSide].spells[0]={card,faceUp:context==='field'&&card.race==='Continuous'};
    await run(`${context}:${card.name}`,[normalDeck(),normalDeck()],{seed:start+index,first:probeSide,openingHands:hands,initialFields:fields},{probe:card,replayAt:index%80===0?3:0});
  }
  if((index+1)%100===0)console.log(JSON.stringify({stage:'probes',cards:index+1,probes:report.probes,failures:report.failures.length,actions:report.actions}));
}
if(process.env.AUDIT_FLIPS==='1')for(const [index,card] of pool.filter(c=>/FLIP:/.test(c.desc)).entries()){
  const fields=[{},{}],hands=[[],[]],decks=[normalDeck(),normalDeck()];
  fields[probeSide]={monsters:[{card,faceUp:false,defense:true},body('Mystical Elf')],grave:['Giant Soldier of Stone','Dark Hole','Mirror Force'].map(body)};
  fields[1-probeSide]={monsters:[body('Blue-Eyes White Dragon')],spells:[{...body('Pot of Greed'),faceUp:false}]};
  hands[probeSide]=['Mystical Elf','Gemini Elf','Dark Magician'].map(get);decks[probeSide].main[0]=card;
  await run(`battleFlip:${card.name}`,decks,{seed:start+index,first:probeSide,openingHands:hands,initialFields:fields},{probe:card,battleProbe:true,cap:300,replayAt:3,replayEnd:true});
}
const available=eligibleSets(cards,sets,defaultSide()).filter(s=>!s.problem),sources=[defaultSide(),...available.map(s=>({...defaultSide(),source:'set',set:s.name}))];
const shuffle=(values,seed)=>{const a=[...values],random=seededRandom(seed);for(let i=a.length-1;i;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const staples=['Gemini Elf','Mechanicalchaser','Spear Dragon','D.D. Warrior Lady','Mystical Elf','Pot of Greed','Raigeki','Mystical Space Typhoon','Mirror Force','Monster Reborn','Graceful Charity','Waboku'];
function coverageDeck(index){
  const list=shuffle(pool.filter(c=>!c.type.includes('Fusion')),Math.floor(index/50)+71),main=[],counts=new Map();
  const add=c=>{const name=cardCopyName(c);if(main.length>=40||(counts.get(name)||0)>=3)return;main.push(c);counts.set(name,(counts.get(name)||0)+1);};
  for(let n=0;n<20;n++)add(list[(index*20+n)%list.length]);
  for(let n=0;main.length<40;n++)add(get(staples[n%staples.length]));
  return {name:'Coverage '+index,main,extra:pool.filter(c=>c.type.includes('Fusion')).slice(index%5,index%5+15)};
}
for(let n=gameStart;n<gameStart+games;n++){
  const seed=start+n,coverageGame=n%3===0,decks=coverageGame?[coverageDeck(n*2),coverageDeck(n*2+1)]:[0,1].map(side=>expandDeck(generateDeck(cards,sources[(n+side*7)%sources.length],sets,seed*97+side),cards));
  const aiSize=aiSizes[n%aiSizes.length],saved={sections:{main:decks[1].main.map(card=>({card,quantity:1})),extra:decks[1].extra.map(card=>({card,quantity:1})),side:[]}};decks[1]=expandDeck(prepareAIDeck(saved,cards,{...defaultSide(),size:aiSize},seed*37),cards);
  report.aiDeckSizes??={};report.aiDeckSizes[aiSize]=(report.aiDeckSizes[aiSize]||0)+1;
  await run(`game:${n}:ai${aiSize}:${coverageGame?'coverage':sources[n%sources.length].set||'random'}`,decks,{seed,first:n%2,lp:n%4===0?4000:8000},{full:true,cap:Number(process.env.AUDIT_MAX_ACTIONS||2500),replayAt:n%10===0?25:0});
  if((n+1)%20===0)console.log(JSON.stringify({stage:'games',games:report.games,finished:report.completedGames,failures:report.failures.length,timeouts:report.timeouts.length,actions:report.actions,effects:effects.size}));
}
report.finished=new Date().toISOString();report.effects=[...effects].sort();report.cards=[...coverage.values()];
report.coverage={probed:report.cards.filter(c=>c.contexts.length).length,drawn:report.cards.filter(c=>c.drawn).length,played:report.cards.filter(c=>c.played).length,activated:report.cards.filter(c=>c.activated).length,resolved:report.cards.filter(c=>c.resolved).length};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,cards:undefined,effects:report.effects.length,failures:report.failures.length,timeouts:report.timeouts.length},null,2));
process.exitCode=report.failures.length||report.timeouts.length?1:0;
