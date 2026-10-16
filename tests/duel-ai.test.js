import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseAIAction,rankAIActions} from '../src/duel/native-ai.js';
import {aiObservation} from '../src/duel/ai-knowledge.js';
import {battlePlan} from '../src/duel/ai-combat.js';
// Use the production WASM/core prompts for the end-to-end decision assertions.
import {readFile} from 'node:fs/promises';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
const nativeCards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
let rules;
async function nativeRig(){rules??=await loadNativeRules({fetchImpl:async url=>new Response(await readFile(url)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});const engine=createNativeBackend({rules:()=>rules});return {engine,get:name=>nativeCards.find(c=>c.name===name),close:s=>engine.destroyMatch(s)};}

let serial=0;
const unit=(name,atk=1800,def=1000,props={})=>({uid:'u'+(++serial),controller:1,owner:1,faceUp:true,position:'attack',card:{id:serial,name,type:'Normal Monster',level:4,atk,def,race:'Warrior',desc:''},currentStats:{atk,def},...props});
const spell=(name,props={})=>unit(name,0,0,{card:{id:++serial,name,type:'Spell Card',race:'Normal',desc:''},...props});
const empty=()=>({lp:8000,hand:[],deck:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),grave:[],banished:[],extra:[],field:null});
function state(ours=[],foes=[]){const s={version:2,seed:9,serial:1,turn:2,phase:'battle',active:1,winner:null,players:[empty(),empty()],chain:[],actions:[[],[]],log:[]};ours.forEach((c,i)=>s.players[1].monsters[i]=c);foes.forEach((c,i)=>s.players[0].monsters[i]={...c,controller:0,owner:0});return s;}
const actions=(s,values)=>{s.actions[1]=values.map((a,i)=>({id:'1:'+i,...a}));return s;};
const attackActions=s=>actions(s,[...s.players[1].monsters.filter(Boolean).map(c=>({type:'ATTACK',uid:c.uid})),{type:'NEXT',label:'Main 2'},{type:'END'}]);
function effectChoice(s,source,targets,purpose='Select target'){s.choice={side:1,stage:true,purpose,title:purpose,trigger:{uid:source.uid},source,selected:[],min:1,max:1,selectionType:'select_card'};return actions(s,targets.map(c=>({type:'CHOOSE',target:c.uid})));}

test('declines attacks into visibly stronger ATK or DEF instead of throwing cards/LP away',()=>{
  for(const position of ['attack','defense']){
    const weak=unit('Attacker',1500),strong=unit('Defender',2600,2700,{position}),s=attackActions(state([weak],[strong]));
    assert.equal(chooseAIAction(s,1).type,'NEXT');
  }
});
test('uses current modified stats rather than printed card ATK',()=>{
  const a=unit('Modified',3000),b=unit('Opponent',1800);a.currentStats.atk=1000;const s=attackActions(state([a],[b]));assert.equal(chooseAIAction(s,1).type,'NEXT');
});
test('searches attack sequences: use the smaller sufficient attacker, saving the strongest for lethal direct damage',()=>{
  const small=unit('Small',1800),big=unit('Big',3000),wall=unit('Wall',1000,1000,{position:'defense'}),s=attackActions(state([big,small],[wall]));s.players[0].lp=3000;
  const plan=battlePlan(aiObservation(s,1),1);assert.equal(plan.first.uid,small.uid);assert.ok(plan.score>100000);assert.equal(chooseAIAction(s,1).uid,small.uid);
});
test('attack target choices prefer a winning target to the largest enemy',()=>{
  const a=unit('Attacker',2000),big=unit('Big',3000),small=unit('Small',1600),s=state([a],[big,small]);s.battleOptions=[{uid:a.uid}];s.choice={side:1,attackUid:a.uid,trigger:{uid:a.uid},selected:[],stage:true};actions(s,[{type:'CHOOSE',target:big.uid},{type:'CHOOSE',target:small.uid}]);assert.equal(chooseAIAction(s,1).target,small.uid);
});
test('does not destroy its own stronger monster with a destructive effect target',()=>{
  const own=unit('Own boss',3000),foe=unit('Enemy',1200),source=spell('Tribute to the Doomed'),s=state([own],[foe]);s.players[1].hand.push(source);effectChoice(s,source,[own,foe]);assert.equal(chooseAIAction(s,1).target,foe.uid);
});
test('revival selects the best monster from either graveyard and control selects the enemy',()=>{
  const s=state(),reborn=spell('Monster Reborn'),weak=unit('Weak',800),boss=unit('Boss',3000,2500);s.players[1].grave=[weak];s.players[0].grave=[{...boss,controller:0,owner:0}];s.players[1].hand=[reborn];effectChoice(s,reborn,[weak,boss],'Select spsummon');assert.equal(chooseAIAction(s,1).target,boss.uid);
  const own=unit('Own',3000),enemy=unit('Enemy',1400),steal=spell('Change of Heart'),next=state([own],[enemy]);next.players[1].hand=[steal];effectChoice(next,steal,[own,enemy]);assert.equal(chooseAIAction(next,1).target,enemy.uid);
});
test('preserves premium cards when discarding and uses inexpensive Tribute material',()=>{
  const own=unit('Weak',500),boss=unit('Boss',2600),s=state([own,boss]),source=spell('Tribute to the Doomed'),pot=spell('Pot of Greed'),brick=unit('Brick',3000,2500,{card:{name:'Blue-Eyes White Dragon',type:'Normal Monster',level:8,atk:3000,def:2500}});s.players[1].hand=[source,pot,brick];effectChoice(s,source,[pot,brick],'Select discard');assert.equal(chooseAIAction(s,1).target,brick.uid);
  effectChoice(s,source,[own,boss],'Select release');assert.equal(chooseAIAction(s,1).target,own.uid);
});
test('conserves board wipes when ahead and uses them to recover a losing board',()=>{
  const source=spell('Dark Hole'),own=unit('Own',2800),foe=unit('Foe',1000),s=state([own],[foe]);s.phase='main1';s.players[1].hand=[source];actions(s,[{type:'ACTIVATE',uid:source.uid},{type:'NEXT',label:'Battle'}]);assert.equal(chooseAIAction(s,1).type,'NEXT');
  const losing=state([],[foe,unit('Foe 2',2000)]);losing.phase='main1';losing.players[1].hand=[source];actions(losing,s.actions[1]);assert.equal(chooseAIAction(losing,1).type,'ACTIVATE');
});
test('does not counter its own chain or fire protection when no attack is threatening it',()=>{
  const source=spell('Solemn Judgment'),s=state([unit('Own',2500)],[]);s.players[1].spells=[source];s.window={priority:1};s.chain=[{side:1,card:{name:'Pot of Greed'}}];actions(s,[{type:'ACTIVATE',uid:source.uid},{type:'PASS'}]);assert.equal(chooseAIAction(s,1).type,'PASS');
  source.card.name='Waboku';s.chain=[];assert.equal(chooseAIAction(s,1).type,'PASS');
});
test('holds a boost that changes nothing, but uses it to turn a losing battle into a win',()=>{
  const a=unit('AI',1800),b=unit('Enemy',2400),rush=spell('Rush Recklessly'),s=state([a],[b]);s.players[1].hand=[rush];s.pending={kind:'attack',uid:a.uid,target:b.uid,side:1};s.window={priority:1};actions(s,[{type:'ACTIVATE',uid:rush.uid},{type:'PASS'}]);assert.equal(chooseAIAction(s,1).type,'ACTIVATE');
  s.players[0].monsters[0].currentStats.atk=600;assert.equal(chooseAIAction(s,1).type,'PASS');
});
test('declines pointless damage into battle-indestructible defense and respects known Waboku protection',()=>{
  const a=unit('AI',2200),reaper=unit('Spirit Reaper',300,200,{position:'defense'}),s=attackActions(state([a],[reaper]));assert.equal(chooseAIAction(s,1).type,'NEXT');
  const other=attackActions(state([a],[unit('Enemy',1000)]));other.turnEffects=[{name:'Waboku',side:0}];assert.equal(chooseAIAction(other,1).type,'NEXT');
});
test('hidden opposing identities, stats, hand and Deck order cannot change a decision',()=>{
  const a=unit('AI',2100),secret=unit('Secret',4000,5000,{faceUp:false,position:'defense'}),s=attackActions(state([a],[secret]));s.players[0].hand=[spell('Secret spell')];s.players[0].deck=[unit('Next draw',3000)];
  const changed=structuredClone(s);changed.players[0].monsters[0].card={name:'Fake',atk:0,def:0,desc:'Cannot be destroyed by battle.'};changed.players[0].monsters[0].currentStats={atk:0,def:0};changed.players[0].hand[0].card.name='Another';changed.players[0].deck.reverse();
  assert.deepEqual(rankAIActions(s,1).map(a=>[a.action.id,a.score]),rankAIActions(changed,1).map(a=>[a.action.id,a.score]));
});
test('a full five-against-five combat search remains bounded for mobile use',()=>{
  const s=attackActions(state(Array.from({length:5},(_,i)=>unit('AI '+i,1500+i*300)),Array.from({length:5},(_,i)=>unit('Enemy '+i,1000+i*250))));const plan=battlePlan(aiObservation(s,1),1);assert.ok(plan.nodes<20000);assert.ok(plan.first);assert.deepEqual(chooseAIAction(s,1),chooseAIAction(s,1));
});

test('confirms a selected lethal target once instead of cycling through targets forever',()=>{
  const a=unit('AI',3000),b=unit('Enemy',1000),c=unit('Other',800),s=state([a],[b,c]);s.players[0].lp=1;s.battleOptions=[{uid:a.uid}];s.choice={side:1,attackUid:a.uid,selected:[b.uid],trigger:{uid:a.uid}};actions(s,[{type:'CHOOSE',target:b.uid,selected:true},{type:'CHOOSE',target:c.uid},{type:'CHOOSE',finish:true}]);assert.equal(chooseAIAction(s,1).finish,true);
});
test('position selection evaluates the summoned monster, not the Spell that summoned it',()=>{
  const spellSource=spell('Monster Reborn'),summoned=unit('Revived',2300,0),s=state([],[unit('Enemy',1900)]);s.players[1].hand=[spellSource];s.choice={side:1,trigger:{uid:spellSource.uid},positionCard:{card:summoned.card},title:'Choose battle position'};actions(s,[{type:'CHOOSE',defense:true},{type:'CHOOSE',defense:false}]);assert.equal(chooseAIAction(s,1).defense,false);
});
test('searches for a playable monster instead of a two-Tribute brick when the field is empty',()=>{
  const source=spell('Sangan'),small=unit('Playable',1400),brick=unit('Tribute',3000,2500);brick.card.level=8;const s=state();s.players[1].grave=[source];s.players[1].deck=[brick,small];effectChoice(s,source,[brick,small],'Select atohand');assert.equal(chooseAIAction(s,1).target,small.uid);
});
test('removal plans the resulting board and clears the blocker that enables lethal damage',()=>{
  const a=unit('Big',2300),b=unit('Small',1000),easy=unit('High ATK low DEF',3000,1000,{position:'defense'}),wall=unit('Low ATK high DEF',1000,3000,{position:'defense'}),source=spell('Tribute to the Doomed'),s=state([a,b],[easy,wall]);s.phase='main1';s.players[0].lp=1000;s.players[1].hand=[source];effectChoice(s,source,[easy,wall]);assert.equal(chooseAIAction(s,1).target,wall.uid);
});
test('does not spend a temporary combat boost during the opponent’s idle Main Phase',()=>{
  const a=unit('AI',1800),b=unit('Enemy',2200),rush=spell('Rush Recklessly'),s=state([a],[b]);s.active=0;s.phase='main1';s.players[1].spells=[rush];s.window={priority:1};actions(s,[{type:'ACTIVATE',uid:rush.uid},{type:'PASS'}]);assert.equal(chooseAIAction(s,1).type,'PASS');
});
test('switches an outmatched attacker to defense to avoid unnecessary LP loss',()=>{
  const a=unit('AI',2000,1200),s=state([a],[unit('Enemy',3000)]);s.phase='main2';actions(s,[{type:'POSITION',uid:a.uid},{type:'NEXT',label:'End'}]);assert.equal(chooseAIAction(s,1).type,'POSITION');
});
test('preserves Exodia pieces rather than summoning or discarding its win condition',()=>{
  const limb=unit('Left Arm of the Forbidden One',200,300),ordinary=unit('Ordinary',1000),source=spell('Graceful Charity'),s=state();s.players[1].hand=[limb,ordinary,source];effectChoice(s,source,[limb,ordinary],'Select discard');assert.equal(chooseAIAction(s,1).target,ordinary.uid);
});

test('native AI ends its Battle Phase safely when every opposing monster is stronger',async()=>{
  const {engine,get,close}=await nativeRig();let s;
  try{
    s=await engine.createMatch([0,1].map(()=>({name:'AI regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:nativeCards,seed:27,first:0,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Blue-Eyes White Dragon')}]},{monsters:[{card:get('Summoned Skull')}]}]});
    s=engine.applyAction(s,{type:'END'},0);
    for(let n=0;n<80&&s.active===1&&s.phase!=='main2';n++){const side=s.actions[0].length?0:1;s=engine.applyAction(s,side===1?engine.chooseAIAction(s,1):s.actions[0].find(a=>a.type==='PASS')||engine.chooseAIAction(s,0),side);}
    assert.equal(s.phase,'main2');assert.equal(s.players[1].lp,8000);assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Summoned Skull'));assert.ok(!s.log.some(e=>e.kind==='attack'&&e.side===1));
  }finally{close(s);}
});
test('native AI revives a stronger opposing Graveyard monster in Attack Position',async()=>{
  const {engine,get,close}=await nativeRig();let s;
  try{
    s=await engine.createMatch([0,1].map(()=>({name:'AI regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:nativeCards,seed:27,first:0,openingHands:[[],[get('Monster Reborn')]],initialFields:[{monsters:[{card:get('Summoned Skull')}],grave:[{card:get('Blue-Eyes White Dragon')}]},{grave:[{card:get('Mystical Elf')}]}]});
    s=engine.applyAction(s,{type:'END'},0);const activate=engine.chooseAIAction(s,1);assert.equal(activate.type,'ACTIVATE');s=engine.applyAction(s,activate,1);
    for(let n=0;n<50&&(s.choice||s.window);n++){const side=s.actions[0].length?0:1;s=engine.applyAction(s,engine.chooseAIAction(s,side),side);}
    const dragon=s.players[1].monsters.find(c=>c?.card.name==='Blue-Eyes White Dragon');assert.ok(dragon);assert.equal(dragon.owner,0);assert.equal(dragon.position,'attack');assert.equal(s.phase,'main1');
  }finally{close(s);}
});
test('native AI pays a discard with a cheaper card and destroys an opposing monster, preserving its own boss',async()=>{
  const {engine,get,close}=await nativeRig();let s;
  try{
    s=await engine.createMatch([0,1].map(()=>({name:'AI regression',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:nativeCards,seed:27,first:0,openingHands:[[],['Tribute to the Doomed','Mystical Elf','Pot of Greed'].map(get)],initialFields:[{monsters:[{card:get('Summoned Skull')}]},{monsters:[{card:get('Blue-Eyes White Dragon')}]}]});
    s=engine.applyAction(s,{type:'END'},0);s=engine.applyAction(s,s.actions[1].find(a=>a.type==='ACTIVATE'&&engine.findCard(s,a.uid)?.card.name==='Tribute to the Doomed'),1);
    for(let n=0;n<50&&(s.choice||s.window);n++){const side=s.actions[0].length?0:1;s=engine.applyAction(s,engine.chooseAIAction(s,side),side);}
    assert.ok(s.players[0].grave.some(c=>c.card.name==='Summoned Skull'));assert.ok(s.players[1].monsters.some(c=>c?.card.name==='Blue-Eyes White Dragon'));assert.ok(s.players[1].hand.some(c=>c.card.name==='Pot of Greed'));assert.equal(s.choice,null);
  }finally{close(s);}
});


test('plans a lethal sequence of tribute-burn effects, rather than only considering one activation',()=>{
  const cannon=unit('Cannon Soldier',1400),token=unit('Token',0,0,{card:{name:'Token',type:'Token',atk:0,def:0}}),s=state([cannon,token],[]);s.players[0].lp=1000;s.phase='main1';actions(s,[{type:'ACTIVATE',uid:cannon.uid},{type:'NEXT',label:'Battle'}]);assert.equal(chooseAIAction(s,1).type,'ACTIVATE');
});
test('Catapult Turtle chooses a lethal tribute instead of sacrificing the weakest monster pointlessly',()=>{
  const source=unit('Catapult Turtle',1000),small=unit('Small',500),big=unit('Big',3000),s=state([source,small,big]);s.players[0].lp=1500;effectChoice(s,source,[small,big],'Select release');assert.equal(chooseAIAction(s,1).target,big.uid);
});
test('numeric LP-cost choices pay the smallest sufficient amount and retain LP above zero',()=>{
  const source=spell('Wall of Revealing Light'),s=state([],[unit('Enemy',2500)]);s.players[1].spells=[source];s.choice={side:1,trigger:{uid:source.uid},title:'Declare a number'};actions(s,[1000,2000,3000,4000,8000].map(number=>({type:'CHOOSE',number})));assert.equal(chooseAIAction(s,1).number,3000);
});
