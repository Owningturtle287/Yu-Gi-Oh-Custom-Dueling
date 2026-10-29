import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLearningModel,sanitizeLearningModel,decisionSignature,learningAdjustment,learningPotential,trainLearningModel,createLearningSession,LEARNING_KEY} from '../src/duel/ai-learning.js';
import {chooseAIAction,rankAIActions} from '../src/duel/native-ai.js';
import {createAIClient,decisionPayload} from '../src/duel/ai-client.js';
const empty=()=>({lp:8000,hand:[],deck:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),grave:[],banished:[],extra:[],field:null});
const card=(id,name,props={})=>({uid:'card-'+id,owner:1,controller:1,faceUp:true,position:'attack',card:{id,name,type:'Normal Monster',race:'Warrior',attribute:'EARTH',level:4,atk:1800,def:1000,desc:'',...props},currentStats:{atk:props.atk??1800,def:props.def??1000}});
function position(){const s={version:2,seed:9,serial:1,turn:3,phase:'main1',active:1,winner:null,players:[empty(),empty()],chain:[],normalSummons:[0,0],actions:[[],[]]};s.players[1].hand=[card(101,'A'),card(102,'B')];s.actions[1]=s.players[1].hand.map((c,i)=>({id:'choice-'+i,type:'SUMMON',uid:c.uid}));return s;}
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
const experience=(m,s,a,n,reward)=>({id:'episode-'+n,generation:m.generation,records:[{...decisionSignature(s,1,a),turn:s.turn,reward}]});
test('wins/losses and local decision outcomes change preferences on held-out seeds',()=>{
 const s=position(),before=chooseAIAction(s,1,{variety:false});assert.equal(before.uid,'card-101');let model=emptyLearningModel();
 for(let n=0;n<24;n++)model=trainLearningModel(model,experience(model,s,s.actions[1][0],'bad'+n,-1),{winner:0}).model;
 for(let n=0;n<24;n++)model=trainLearningModel(model,experience(model,s,s.actions[1][1],'good'+n,1),{winner:1}).model;
 assert.equal(model.games,48);assert.equal(model.wins,24);assert.equal(model.losses,24);
 for(const seed of [101,102,98765]){s.seed=seed;assert.equal(chooseAIAction(s,1,{learning:model,variety:false}).uid,'card-102');}
 assert.ok(learningAdjustment(model,s,1,s.actions[1][1])>learningAdjustment(model,s,1,s.actions[1][0]));
});
test('a useful local outcome is credited even in a lost duel; a harmful move is penalized despite a win',()=>{
 const s=position(),initial=emptyLearningModel();let m=initial;
 for(let n=0;n<20;n++){m=trainLearningModel(m,experience(m,s,s.actions[1][0],'useful'+n,1),{winner:0}).model;m=trainLearningModel(m,experience(m,s,s.actions[1][1],'harmful'+n,-1),{winner:1}).model;}
 assert.ok(learningAdjustment(m,s,1,s.actions[1][0])>0);assert.ok(learningAdjustment(m,s,1,s.actions[1][1])<0);
});
test('only completed, played duels train; repeated outcomes are idempotent',async()=>{
 const storage=store(),s=position(),learner=createLearningSession({storage,locks:null});learner.begin(s);
 const after=structuredClone(s);after.players[1].hand.shift();after.players[1].monsters[0]=card(101,'A');learner.observe(s,s.actions[1][0],1,after);const saved=learner.snapshot();
 assert.equal(await learner.finish(after),false);assert.equal(learner.model.games,0);after.winner=1;
 assert.equal(await learner.finish(after),true);assert.equal(learner.model.games,1);assert.equal(await learner.finish(after),false);
 const resumed=createLearningSession({storage,locks:null});resumed.restore(after,saved);assert.equal(await resumed.finish(after),false);
 const forfeit=createLearningSession({storage,locks:null});forfeit.begin(s);forfeit.observe(s,s.actions[1][0],1,after);assert.equal(await forfeit.finish(after,{forfeit:true}),false);
 const exited=createLearningSession({storage,locks:null});exited.begin(s);exited.observe(s,s.actions[1][0],1,after);exited.discard();assert.equal(await exited.finish(after),false);
 assert.equal(JSON.parse(storage.getItem(LEARNING_KEY)).games,1);
});
test('save/resume retains unresolved decision credit and persists across fresh controllers',async()=>{
 const storage=store(),s=position(),learner=createLearningSession({storage,locks:null});learner.begin(s);const pending=structuredClone(s);pending.choice={side:0};learner.observe(s,s.actions[1][0],1,pending);const saved=learner.snapshot();assert.equal(saved.pending.length,1);
 const resumed=createLearningSession({storage,locks:null});resumed.restore(pending,JSON.parse(JSON.stringify(saved)));const finished=structuredClone(s);finished.winner=1;finished.players[0].lp=0;assert.equal(await resumed.finish(finished),true);
 const loaded=createLearningSession({storage,locks:null});assert.equal(loaded.model.games,1);assert.ok(Object.values(loaded.model.weights).some(v=>v!==0));
});
test('hidden identities, Deck order and private logs cannot affect features, rewards or stored experience',async()=>{
 const a=position();a.players[0].hand=[{...card(999,'SECRET HAND'),owner:0,controller:0}];a.players[0].monsters[0]={...card(998,'SECRET FIELD'),owner:0,controller:0,faceUp:false};a.players[0].deck=[{...card(997,'SECRET DECK'),owner:0,controller:0}];a.log=[{message:'SECRET LOG'}];
 const b=structuredClone(a);for(const c of [b.players[0].hand[0],b.players[0].monsters[0],b.players[0].deck[0]]){c.card.id+=1000;c.card.name='OTHER SECRET';c.card.atk=99999;c.currentStats.atk=99999;}
 assert.deepEqual(decisionSignature(a,1,a.actions[1][0]),decisionSignature(b,1,b.actions[1][0]));assert.equal(learningPotential(a),learningPotential(b));
 const storage=store(),learner=createLearningSession({storage,locks:null});learner.begin(a);const next=structuredClone(a);next.winner=1;next.players[0].lp=0;learner.observe(a,a.actions[1][0],1,next);assert.ok(!JSON.stringify(learner.snapshot()).includes('SECRET'));await learner.finish(next);const encoded=storage.getItem(LEARNING_KEY);assert.ok(!encoded.includes('SECRET'));const model=JSON.parse(encoded);
 for(const key of Object.keys(model.weights))assert.doesNotMatch(key,/(?:card|targetcard):(997|998|999):/);
 for(const key of Object.keys(model.contexts))assert.ok(!key.split('|').some(part=>part.split('_').some(id=>['997','998','999'].includes(id))));
 const revealed=structuredClone(a);revealed.players[0].monsters[0].faceUp=true;assert.equal(learningPotential(revealed),learningPotential(a),'A reveal alone is not a material loss');
});
test('learned adjustments are bounded and cannot replace lethal or hard rejected moves',()=>{
 const s=position(),model=emptyLearningModel();model.games=100;const sig=decisionSignature(s,1,s.actions[1][0]);for(const k of Object.keys(sig.features))model.weights[k]=1e20;model.contexts[sig.context]={mean:1e20,n:1e20};assert.ok(Math.abs(learningAdjustment(model,s,1,s.actions[1][0]))<=180);
 const burn=card(201,'Ookazi',{type:'Spell Card',race:'Normal',desc:'Inflict 800 damage to your opponent.'});s.players[1].hand=[burn];s.players[0].lp=100;s.actions[1]=[{id:'win',type:'ACTIVATE',uid:burn.uid},{id:'end',type:'END'}];assert.equal(chooseAIAction(s,1,{learning:model}).id,'win');
 const exodia=card(202,'Left Arm of the Forbidden One',{atk:200,def:300});s.players[1].hand=[exodia];s.actions[1]=[{id:'bad',type:'SUMMON',uid:exodia.uid},{id:'end',type:'END'}];assert.equal(chooseAIAction(s,1,{learning:model}).id,'end');
});
test('corrupt/oversized models are sanitized and unavailable storage preserves session learning',async()=>{
 const bad=sanitizeLearningModel({version:1,games:Infinity,weights:JSON.parse('{"__proto__":2,"ok":9999,"nan":null}'),contexts:{ok:{n:Infinity,mean:0}},finished:[null,'valid']});assert.equal(bad.games,0);assert.equal(Object.hasOwn(bad.weights,'__proto__'),false);assert.equal(bad.weights.ok,2);assert.deepEqual(bad.finished,['valid']);assert.doesNotThrow(()=>trainLearningModel(bad,{records:{}},{winner:1}));
 const learner=createLearningSession({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},locks:{request(){throw Error('blocked');}}}),s=position();learner.begin(s);const end={...s,winner:1};learner.observe(s,s.actions[1][0],1,end);assert.equal(await learner.finish(end),true);assert.equal(learner.model.games,1);assert.equal(learner.persisted,false);
});
test('cross-tab commits rebase and a reset invalidates old queued episodes',async()=>{
 const storage=store(),s=position(),a=createLearningSession({storage,locks:null}),b=createLearningSession({storage,locks:null});a.begin(s);b.begin(s);const end={...s,winner:1};a.observe(s,s.actions[1][0],1,end);b.observe(s,s.actions[1][1],1,end);await a.finish(end);await b.finish(end);assert.equal(JSON.parse(storage.getItem(LEARNING_KEY)).games,2);
 let commit;const queued=createLearningSession({storage,locks:{request(_name,fn){return new Promise(resolve=>{commit=()=>resolve(fn());});}}});queued.begin(s);queued.observe(s,s.actions[1][0],1,end);const work=queued.finish(end);queued.reset();commit();assert.equal(await work,false);assert.equal(queued.model.games,0);assert.deepEqual(queued.model.weights,{});
 a.begin(s);assert.equal(a.model.generation,queued.model.generation,'A new duel honors a reset from another tab even when its game count is lower');assert.equal(a.model.games,0);assert.deepEqual(a.model.weights,{});
});
test('contexts and experience stay bounded across long runs',()=>{
 const s=position();let m=emptyLearningModel();for(let n=0;n<600;n++){const r=experience(m,s,s.actions[1][0],n,.5);r.records[0].context='unique-'+n;m=trainLearningModel(m,r,{winner:n%2}).model;}assert.ok(Object.keys(m.contexts).length<=512);assert.ok(Object.keys(m.weights).length<=256);assert.ok(m.finished.length<=512);
});
test('worker and fallback receive inference parameters without persisted outcome IDs or raw experience',async()=>{
 class Worker{constructor(){Worker.last=this;}postMessage(v){this.message=v;}terminate(){}}
 const s=position(),learning={...emptyLearningModel(),games:4,finished:['private-outcome']},client=createAIClient({WorkerClass:Worker,timeout:1000});const task=client.decide(s,1,{learning});assert.equal(Worker.last.message.learning.games,4);assert.equal(Worker.last.message.learning.finished,undefined);assert.deepEqual(Worker.last.message.state,decisionPayload(s,1));Worker.last.onmessage({data:{request:Worker.last.message.request,id:s.actions[1][0].id}});assert.equal((await task).id,s.actions[1][0].id);client.destroy();
 let passed;const fallback=createAIClient({WorkerClass:undefined,choose:(view,side,options)=>{passed=options.learning;return view.actions[side][0];}});await fallback.decide(s,1,{learning});assert.equal(passed.games,4);fallback.destroy();
});
