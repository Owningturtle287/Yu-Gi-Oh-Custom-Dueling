import {aiObservation} from './ai-knowledge.js';
import {chooseAIAction} from './native-ai.js';

export function decisionPayload(state,side){
  const view=aiObservation(state,side);
  const visible=new Map(view.players.flatMap(p=>['hand','deck','monsters','spells','grave','banished','extra'].flatMap(z=>p[z].filter(Boolean)).concat(p.field?[p.field]:[])).map(c=>[c.uid,c]));
  const redact=action=>action.target&&visible.get(action.target)?.hidden?{...action,label:'Face-down card'}:action;
  if(view.choice)view.choice={...view.choice,options:view.choice.options?.map(redact)};
  // No raw match, private logs, deck backups or other viewer's memory crosses
  // into the worker. Own Deck is an unordered multiset, never the next draw.
  return {...view,actions:[side===0?state.actions[0].map(redact):[],side===1?state.actions[1].map(redact):[]]};
}
export function createAIClient({WorkerClass=globalThis.Worker,timeout=1400,choose=chooseAIAction}={}){
  let worker=null,pending=null,serial=0;
  const stop=()=>{worker?.terminate();worker=null;};
  const finish=(action)=>{if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);p.resolve(action);};
  const fallback=()=>{if(!pending)return;const {state,side,learning}=pending;stop();let action=null;try{action=choose(state,side,{planning:false,learning});}catch{/* The caller can retry the current legal prompt. */}finish(action);};
  const start=()=>{
    if(!WorkerClass)return false;
    try{worker=new WorkerClass(new URL('./ai-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=({data})=>{if(!pending||data.request!==pending.request)return;if(data.error){fallback();return;}const action=pending.state.actions[pending.side].find(a=>a.id===data.id);if(action)finish(action);else fallback();};
      worker.onerror=fallback;return true;
    }catch{stop();return false;}
  };
  const cancel=()=>{if(pending){stop();finish(null);}};
  return {
    decide(state,side=1,{learning=null}={}){
      cancel();const view=decisionPayload(state,side);
      if(learning)learning={version:learning.version,games:learning.games,weights:learning.weights,contexts:learning.contexts};
      return new Promise(resolve=>{
        pending={request:++serial,state:view,side,learning,resolve,timer:null};
        if(!worker&&!start()){fallback();return;}
        pending.timer=setTimeout(fallback,timeout);
        try{worker.postMessage({request:pending.request,state:view,side,learning});}catch{fallback();}
      });
    },
    cancel,
    destroy(){cancel();stop();}
  };
}
