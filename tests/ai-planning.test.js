import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createAIMemory,observePublic,rememberMove,rememberCard,forgetShuffle,hiddenBeliefs} from '../src/duel/ai-memory.js';
import {aiObservation,costValue} from '../src/duel/ai-knowledge.js';
import {planTurn} from '../src/duel/ai-turn.js';
import {rankAIActions,chooseAIAction} from '../src/duel/native-ai.js';
import {decisionPayload,createAIClient} from '../src/duel/ai-client.js';
let serial=0;
const unit=(name,atk=1800,def=1000,extra={})=>({uid:'test-'+(++serial),owner:1,controller:1,faceUp:true,position:'attack',card:{id:serial,name,type:'Normal Monster',race:'Warrior',level:4,atk,def,desc:'',tcgDate:'2002-01-01'},currentStats:{atk,def},...extra});
const spell=name=>unit(name,0,0,{card:{id:++serial,name,type:'Spell Card',race:'Normal',desc:''}});
const empty=()=>({lp:8000,hand:[],deck:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),grave:[],banished:[],extra:[],field:null});
function state(ours=[],theirs=[]){const s={version:2,seed:9,serial:1,turn:3,phase:'main1',active:1,winner:null,players:[empty(),empty()],actions:[[],[]],normalSummons:[0,0],chain:[]};ours.forEach((c,i)=>s.players[1].monsters[i]=c);theirs.forEach((c,i)=>s.players[0].monsters[i]={...c,controller:0,owner:0});return s;}
const actions=(s,list)=>{s.actions[1]=list.map((a,i)=>({id:'action-'+i,...a}));return s;};

test('plans summon → remove blocker → lethal, while preserving the existing attacker',()=>{
  const attacker=unit('Attacker',2500),wall=unit('Wall',3000,3000),exiled=unit('Exiled Force',1000,1000,{card:{id:74131780,name:'Exiled Force',type:'Effect Monster',level:4,atk:1000,def:1000}}),s=state([attacker],[wall]);
  s.players[1].hand=[exiled];s.players[0].lp=2500;actions(s,[{type:'SUMMON',uid:exiled.uid},{type:'NEXT',label:'Battle'}]);
  const ranked=rankAIActions(s,1),result=ranked.find(r=>r.action.type==='SUMMON');assert.ok(result.projection.lethal);assert.equal(result.projection.steps,2);assert.equal(chooseAIAction(s,1).type,'SUMMON');
});
test('finds the Cyber-Stein + Megamorph line and refuses an unaffordable LP cost',()=>{
  const stein=unit('Cyber-Stein',700,500,{card:{id:69015963,name:'Cyber-Stein',type:'Effect Monster',level:2,atk:700,def:500}}),mega=spell('Megamorph'),fusion=unit('Blue-Eyes Ultimate Dragon',4500,3800,{card:{id:23995346,name:'Blue-Eyes Ultimate Dragon',type:'Fusion Monster',level:12,atk:4500,def:3800}}),s=state([stein]);
  s.players[1].hand=[mega];s.players[1].extra=[fusion];s.normalSummons[1]=1;actions(s,[{type:'EFFECT',uid:stein.uid},{type:'NEXT',label:'Battle'}]);
  assert.ok(rankAIActions(s,1)[0].projection.lethal);assert.equal(chooseAIAction(s,1).type,'EFFECT');s.players[1].lp=5000;assert.equal(chooseAIAction(s,1).type,'NEXT');
});
test('turn search stays bounded and leaves its input untouched',()=>{
  const s=state(Array.from({length:4},(_,i)=>unit('Ours '+i,1500+i*300)),Array.from({length:5},(_,i)=>unit('Foe '+i,1300+i*200)));s.players[1].hand=['Dark Hole','Raigeki','Monster Reborn','Rush Recklessly','Megamorph'].map(spell);actions(s,s.players[1].hand.map(c=>({type:'ACTIVATE',uid:c.uid})));
  const view=aiObservation(s,1),before=structuredClone(view),ranked=rankAIActions(s,1,{planning:false}),plan=planTurn(view,1,ranked,{maxNodes:24});assert.ok(plan.nodes<=24);assert.deepEqual(view,before);
});
test('does not project battle in Main 2 or assume another Normal Summon',()=>{
  const a=unit('Attacker',2500),wall=unit('Wall',3000),exiled=unit('Exiled Force',1000),s=state([a],[wall]);s.players[1].hand=[exiled];s.players[0].lp=2500;s.phase='main2';actions(s,[{type:'SUMMON',uid:exiled.uid},{type:'NEXT',label:'End'}]);assert.ok(!rankAIActions(s,1).some(r=>r.projection?.lethal));s.normalSummons[1]=1;assert.equal(rankAIActions(s,1).find(r=>r.action.type==='SUMMON').projection,undefined);
});
test('combo retention preserves an available fusion material ahead of a spare body',()=>{
  const a=unit('Material A',1200),b=unit('Material B',1200),spare=unit('Spare',1200),s=state();s.players[1].hand=[a,b,spare,spell('Polymerization')];s.players[1].extra=[unit('Fusion',3000,2500,{card:{name:'Fusion',type:'Fusion Monster',desc:'"Material A" + "Material B"',atk:3000}})];assert.ok(costValue(s,1,a)>costValue(s,1,spare));
});
test('public memory tracks a revealed card set face-down, but never reads a different hidden card',()=>{
  const c=unit('Public boss',2600),secret=unit('Private monster',9000,9000,{faceUp:false}),s=state([],[c,secret]);s.aiMemory=createAIMemory([]);observePublic(s);s.players[0].monsters[0].faceUp=false;const v=aiObservation(s,1);assert.equal(v.players[0].monsters[0].card.name,c.card.name);assert.equal(v.players[0].monsters[1].card.name,'Unknown card');
});
test('a private hand reveal is available only to its recipient and is forgotten after shuffling',()=>{
  const c=unit('Revealed hand',1900),s=state();s.players[0].hand=[{...c,controller:0,owner:0}];s.aiMemory=createAIMemory([]);rememberCard(s,1,s.players[0].hand[0],'hand',{hand:true});assert.equal(aiObservation(s,1).players[0].hand[0].card.name,c.card.name);assert.ok(!s.aiMemory[0].known[c.uid]);forgetShuffle(s,0,['hand']);assert.ok(aiObservation(s,1).players[0].hand[0].hidden);assert.equal(s.aiMemory[1].handKnown[0][c.card.id],1);
});
test('returning a known card to the Deck forgets its identity-to-slot association',()=>{
  const c=unit('Returned card',1800),s=state([],[c]);s.aiMemory=createAIMemory([]);observePublic(s);rememberMove(s,{uid:c.uid,card:c.card,fromSide:0,fromZone:'monsters',toSide:0,toZone:'deck',visible:true});assert.ok(!s.aiMemory[1].known[c.uid]);assert.equal(s.aiMemory[1].seen[c.uid].id,c.card.id);
});
test('hidden-card priors use eligibility and public evidence, never the actual opposing deck',()=>{
  const a=unit('Warrior',1800,1200).card,b={...a,id:2,race:'Machine',atk:2400,def:2400},late={...a,id:3,tcgDate:'2005-01-01',atk:9000},s=state();s.aiMemory=createAIMemory([a,b,late],[{cutoff:'2004-12-31'},{}]);const rows=hiddenBeliefs(s,1);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.atk<9000));s.players[0].deck=[unit('Secret',99999)];assert.deepEqual(hiddenBeliefs(s,1),rows);s.aiMemory[1].seen.public={side:0,race:'Machine',type:'Effect Monster'};assert.ok(hiddenBeliefs(s,1).find(r=>r.race==='Machine').probability>rows.find(r=>r.race==='Machine').probability);
});
test('safe variety varies equal moves across seeds, remains replayable and never replaces lethal',()=>{
  const s=state();s.players[1].hand=[unit('A',1800),unit('B',1800)];actions(s,s.players[1].hand.map(c=>({type:'SUMMON',uid:c.uid})));const picks=new Set();for(let seed=1;seed<=20;seed++){s.seed=seed;const choice=chooseAIAction(s,1);assert.deepEqual(choice,chooseAIAction(s,1));picks.add(choice.id);}assert.equal(picks.size,2);
  const burn=spell('Ookazi'),lethal=state();lethal.players[1].hand=[burn];lethal.players[0].lp=100;actions(lethal,[{type:'ACTIVATE',uid:burn.uid},{type:'END'}]);for(let seed=1;seed<10;seed++){lethal.seed=seed;assert.equal(chooseAIAction(lethal,1).type,'ACTIVATE');}
});
test('worker payload contains no private opposing identities, logs, backups or Deck ordering',()=>{
  const secret=unit('SECRET CARD',9999),s=state([],[{...secret,faceUp:false}]);s.players[0].hand=[secret];s.players[0].deck=[secret];s.log=[{message:'SECRET LOG'}];s.deckBackups=['SECRET BACKUP'];s.players[1].deck=[unit('B'),unit('A')];actions(s,[{type:'CHOOSE',target:secret.uid,label:'SECRET CARD'}]);s.choice={options:s.actions[1]};const payload=decisionPayload(s,1),encoded=JSON.stringify(payload);assert.ok(!encoded.includes('SECRET'));assert.deepEqual(decisionPayload({...s,players:[s.players[0],{...s.players[1],deck:[...s.players[1].deck].reverse()}]},1),payload);
});
class FakeWorker{static instances=[];constructor(){FakeWorker.instances.push(this);}postMessage(data){this.data=data;}terminate(){this.stopped=true;}reply(data){this.onmessage({data});}}
test('worker client validates replies, ignores stale requests and cancels work on leaving',async()=>{
  FakeWorker.instances=[];const s=actions(state(),[{type:'END'}]),client=createAIClient({WorkerClass:FakeWorker,timeout:1000}),first=client.decide(s,1),old=FakeWorker.instances[0],second=client.decide(s,1),current=FakeWorker.instances[1];assert.equal(await first,null);old.reply({request:old.data.request,id:s.actions[1][0].id});current.reply({request:current.data.request,id:s.actions[1][0].id});assert.equal((await second).id,s.actions[1][0].id);const third=client.decide(s,1);client.cancel();assert.equal(await third,null);assert.ok(current.stopped);client.destroy();
});
test('worker failure, unsupported Worker and timeout use a bounded legal fallback',async()=>{
  const s=actions(state(),[{type:'END'}]);let calls=0;const choose=(view,side,options)=>{calls++;assert.equal(options.planning,false);return view.actions[side][0];};
  for(const mode of ['unsupported','timeout','error','invalid']){const client=createAIClient({WorkerClass:mode==='unsupported'?undefined:FakeWorker,timeout:5,choose}),pending=client.decide(s,1),worker=FakeWorker.instances.at(-1);if(mode==='error')worker.onerror();if(mode==='invalid')worker.reply({request:worker.data.request,id:'not-legal'});assert.equal((await pending).id,s.actions[1][0].id);client.destroy();}assert.equal(calls,4);
});
test('the real module worker computes the same legal decision from the redacted payload',async()=>{
  const s=actions(state(),[{type:'END'}]),moduleURL=new URL('../src/duel/ai-worker.js',import.meta.url).href;
  const source=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:data=>parentPort.postMessage(data)};await import(${JSON.stringify(moduleURL)});parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});`;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));try{const reply=await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',data=>data.ready?worker.postMessage({request:1,state:decisionPayload(s,1),side:1}):resolve(data));});assert.equal(reply.id,s.actions[1][0].id);assert.equal(reply.request,1);}finally{await worker.terminate();}
});
