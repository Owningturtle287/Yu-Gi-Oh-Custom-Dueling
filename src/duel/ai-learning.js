import {aiObservation,locate,effectProfile,monsters,backrow,zoneOf} from './ai-knowledge.js';

export const LEARNING_KEY='duel-atlas.ai-learning.v1';
const MAX_CONTEXTS=512,MAX_WEIGHTS=256,MAX_TRACE=256,MAX_FINISHED=512;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9:_.|/-]{1,240}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k);
const id=()=>globalThis.crypto?.randomUUID?.()||`experience-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const emptyLearningModel=()=>({version:1,generation:id(),games:0,wins:0,losses:0,draws:0,weights:{},contexts:{},finished:[]});
export function sanitizeLearningModel(value){
  if(value?.version!==1)return emptyLearningModel();
  const model=emptyLearningModel();model.generation=safeKey(value.generation)?value.generation:model.generation;
  for(const k of ['games','wins','losses','draws'])model[k]=Math.floor(clamp(value[k],0,1e7));
  model.weights=Object.fromEntries(Object.entries(value.weights||{}).filter(([k,v])=>safeKey(k)&&Number.isFinite(v)).slice(-MAX_WEIGHTS).map(([k,v])=>[k,clamp(v,-2,2)]));
  model.contexts=Object.fromEntries(Object.entries(value.contexts||{}).filter(([k,v])=>safeKey(k)&&Number.isFinite(v?.mean)&&Number.isFinite(v?.n)).slice(-MAX_CONTEXTS).map(([k,v])=>[k,{n:Math.floor(clamp(v.n,1,1e6)),mean:clamp(v.mean,-1,1),last:Math.floor(clamp(v.last,0,1e7))}]));
  model.finished=Array.isArray(value.finished)?value.finished.filter(safeKey).slice(-MAX_FINISHED):[];
  return model;
}
// Count-based potential is invariant to hidden identities and to a reveal by
// itself. LP/material changes give feedback without retrospective peeking.
export function learningPotential(state,side=1){
  const material=p=>monsters(p).length+backrow(p).length*.6+p.hand.length*.5;
  return Math.tanh((material(state.players[side])-material(state.players[1-side]))/6+(state.players[side].lp-state.players[1-side].lp)/10000);
}
export function decisionSignature(state,side,action){
  const s=aiObservation(state,side),p=s.players[side],foe=s.players[1-side],source=locate(s,action.uid||s.choice?.trigger?.uid)||s.choice?.source;
  const target=locate(s,action.target),intent=effectProfile(source?.card,action.effectText||s.choice?.effectText).intent;
  const role=action.type==='CHOOSE'?(action.yes===false?'decline':action.yes===true?'accept':action.target?'target':action.number!==undefined?'number'+action.number:action.defense!==undefined?'position'+Number(action.defense):'option'):action.type.toLowerCase();
  const kind=`${role}:${intent}`,lead=Math.sign(monsters(p).length-monsters(foe).length),danger=p.lp<=2000?'low':'normal';
  const targetKind=target?(target.hidden?'unknown':zoneOf(s,target.uid)?.side===side?'own':'foe'):'none';
  const features={[`action:${kind}`]:1,[`lead:${lead}:${kind}`]:1,[`life:${danger}:${kind}`]:1,[`target:${targetKind}:${kind}`]:1};
  if(source?.card?.id)features[`card:${source.card.id}:${role}`]=1;
  if(target&&!target.hidden&&target.card.id)features[`targetcard:${target.card.id}:${intent}`]=1;
  features[`backrow:${kind}`]=Math.min(1,backrow(foe).length/3);
  features[`crowding:${kind}`]=monsters(p).length/5;
  const publicThreats=monsters(foe).concat(backrow(foe)).filter(c=>c.faceUp&&!c.hidden).map(c=>c.card.id||0).sort((a,b)=>a-b).slice(0,6).join('_');
  const context=[s.phase,kind,source?.card?.id||0,lead,danger,targetKind,target&&!target.hidden?target.card.id||0:0,publicThreats].join('|');
  return {features,context};
}
export function learningAdjustment(model,state,side,action){
  if(!model||model.version!==1||model.games<2)return 0;
  const {features,context}=decisionSignature(state,side,action),entry=model.contexts?.[context];
  let dot=0;for(const [key,v] of Object.entries(features))dot+=clamp(model.weights?.[key],-2,2)*v;
  const general=70*Math.tanh(dot/3),specific=entry?120*clamp(entry.mean,-1,1)*clamp(entry.n/(entry.n+8),0,1):0;
  return clamp(general+specific,-180,180);
}
const sanitizeRecord=r=>r&&safeKey(r.context)&&Number.isFinite(r.reward)&&Number.isInteger(r.turn)?{
  context:r.context,turn:Math.floor(clamp(r.turn,0,10000)),reward:clamp(r.reward,-1,1),
  features:Object.fromEntries(Object.entries(r.features||{}).filter(([k,v])=>safeKey(k)&&Number.isFinite(v)).slice(0,16).map(([k,v])=>[k,clamp(v,-1,1)]))
}:null;
export function trainLearningModel(value,episode,{winner,side=1,forfeit=false}={}){
  const model=sanitizeLearningModel(value),records=Array.isArray(episode?.records)?episode.records.map(sanitizeRecord).filter(Boolean).slice(-MAX_TRACE):[];
  if(forfeit||![0,1,'draw'].includes(winner)||!safeKey(episode?.id)||model.finished.includes(episode.id)||episode.generation!==model.generation||!records.length)return {model,trained:false};
  const outcome=winner==='draw'?0:winner===side?1:-1,lastTurn=records.at(-1).turn;
  // Local resolution feedback plus discounted final outcome. Repeated prompts
  // with the same context count once per duel, preventing click/loop farming.
  const groups=new Map();
  for(const r of records){
    const target=clamp(r.reward*.55+outcome*.45*Math.pow(.97,Math.max(0,lastTurn-r.turn)),-1,1),g=groups.get(r.context)||{sum:0,n:0,features:r.features};
    g.sum+=target;g.n++;groups.set(r.context,g);
  }
  model.games++;model[winner==='draw'?'draws':winner===side?'wins':'losses']++;
  for(const [key,g] of groups){
    const target=g.sum/g.n,old=model.contexts[key]||{n:0,mean:0,last:0},rate=1/Math.min(40,old.n+1);
    model.contexts[key]={n:Math.min(1e6,old.n+1),mean:clamp(old.mean+(target-old.mean)*rate,-1,1),last:model.games};
    const entries=Object.entries(g.features),norm=Math.max(1,entries.reduce((n,[,v])=>n+v*v,0));
    const predicted=Math.tanh(entries.reduce((n,[k,v])=>n+(model.weights[k]||0)*v,0)/3);
    for(const [k,v] of entries)model.weights[k]=clamp((model.weights[k]||0)*.999+.12*(target-predicted)*v/norm,-2,2);
  }
  model.contexts=Object.fromEntries(Object.entries(model.contexts).sort((a,b)=>b[1].last-a[1].last).slice(0,MAX_CONTEXTS));
  model.weights=Object.fromEntries(Object.entries(model.weights).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,MAX_WEIGHTS));
  model.finished=[...model.finished,episode.id].slice(-MAX_FINISHED);
  return {model,trained:true};
}
export function createLearningSession({storage,locks=globalThis.navigator?.locks,side=1}={}){
  const read=()=>{try{const raw=storage?.getItem(LEARNING_KEY);return raw?sanitizeLearningModel(JSON.parse(raw)):null;}catch{return null;}};
  let model=read()||emptyLearningModel(),episode=null,pending=[],startPotential=0,lastPotential=0,persisted=!!storage,epoch=0;
  const write=()=>{try{storage?.setItem(LEARNING_KEY,JSON.stringify(model));persisted=!!storage;}catch{persisted=false;}};
  const gap=potential=>{if(episode?.records.length)episode.records.at(-1).reward=clamp(episode.records.at(-1).reward+(potential-lastPotential)*2,-1,1);lastPotential=potential;};
  const flush=state=>{if(!episode||!pending.length)return;const potential=learningPotential(state,side),reward=clamp((potential-startPotential)*2,-1,1);for(const r of pending)episode.records.push({...r,reward});episode.records=episode.records.slice(-MAX_TRACE);pending=[];lastPotential=potential;};
  const begin=(state,saved)=>{
    const latest=read();if(latest&&(latest.generation!==model.generation||latest.games>=model.games))model=latest;
    const records=Array.isArray(saved?.records)?saved.records.map(sanitizeRecord).filter(Boolean).slice(-MAX_TRACE):[];
    episode={version:1,id:safeKey(saved?.id)?saved.id:id(),generation:model.generation,records:saved?.generation===model.generation?records:[]};
    pending=saved?.generation===model.generation&&Array.isArray(saved.pending)?saved.pending.map(sanitizeRecord).filter(Boolean).slice(-64):[];
    lastPotential=saved?.generation===model.generation&&Number.isFinite(saved.lastPotential)?clamp(saved.lastPotential,-1,1):learningPotential(state,side);
    startPotential=pending.length?clamp(saved.startPotential,-1,1):lastPotential;
    if(!latest)write();return episode.id;
  };
  return {
    begin,
    get model(){return model;},
    get persisted(){return persisted;},
    snapshot(){return episode?structuredClone({...episode,pending:pending.map(r=>({...r,reward:0})),startPotential,lastPotential}):null;},
    restore(state,saved){begin(state,saved);},
    observe(before,action,actor,after){
      if(!episode)return;
      const meaningful=actor===side&&(before.actions?.[side]?.length||0)>1&&!action.finish&&!action.reset&&!action.selected&&!action.recommended&&action.type!=='ACK_REVEAL';
      if(meaningful){
        if(!pending.length){gap(learningPotential(before,side));startPotential=lastPotential;}
        pending.push({...decisionSignature(before,side,action),turn:before.turn});
      }
      if(!after.choice&&!after.window&&!after.reveals?.length||after.winner!==null)flush(after);
    },
    finish(state,{forfeit=false}={}){
      if(!episode||state.winner===null)return Promise.resolve(false);
      flush(state);gap(learningPotential(state,side));const completed=episode,winner=state.winner;episode=null;const token=epoch;
      const commit=()=>{
        if(token!==epoch)return false;
        const latest=read();if(latest&&latest.generation!==completed.generation){model=latest;return false;}
        if(latest&&latest.games>=model.games)model=latest;
        const result=trainLearningModel(model,completed,{winner,side,forfeit});model=result.model;if(result.trained)write();return result.trained;
      };
      // Cross-tab updates rebase inside a Web Lock where supported. No training
      // runs in the UI decision worker or accesses the native/private match.
      if(locks?.request){try{return Promise.resolve(locks.request(LEARNING_KEY,commit)).catch(()=>commit());}catch{/* Storage lock unavailable: keep the session usable. */}}
      return Promise.resolve(commit());
    },
    discard(){episode=null;pending=[];},
    reset(){epoch++;model=emptyLearningModel();episode=null;pending=[];write();return model;}
  };
}
