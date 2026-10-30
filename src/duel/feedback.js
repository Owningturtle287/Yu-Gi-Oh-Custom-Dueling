import {paintLife} from './motion.js';
import {localRect} from './viewport.js';
import {chainArtwork,paintChainRack} from './chain-art.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const who=side=>side===0?'YOU':'AI';
const number=value=>Math.abs(value).toLocaleString();
// Use protocol events, never effect-text guesses or the net total of a chain.
export function duelFeedback(previous,next){
  if(!previous)return [];
  const events=[];
  for(const entry of next.log.filter(e=>e.id>previous.serial)){
    if(entry.chainNotice)events.push({type:'chain',...entry.chainNotice,eventId:entry.id});
    if(entry.lifeNotice?.delta)events.push({type:'life',...entry.lifeNotice,eventId:entry.id});
  }
  for(const side of [0,1])if(!events.some(e=>e.type==='life'&&e.side===side)){
    const before=previous.players[side].lp,after=next.players[side].lp,delta=after-before;
    if(delta)events.push({type:'life',side,before,after,delta,amount:Math.abs(delta),kind:delta>0?'gain':'damage',source:''});
  }
  return events;
}
export function chainSummary(state){
  const chain=state.chain||[];
  if(!chain.length)return state.lastChain?{...state.lastChain,completed:true}:null;
  const resolving=chain.find(c=>c.status==='resolving');
  return {total:chain.length,next:chain.length+1,resolving:resolving?.chainLink||null,
    links:chain.map((c,i)=>({link:c.chainLink||i+1,side:c.side,name:c.card.name,status:c.status||'waiting',card:c.card,effectText:c.effectText})).reverse()};
}
const at=(x,y,scale=1)=>`translate(${x}px,${y}px) translate(-50%,-50%) scale(${scale})`;
export function flightGeometry(root,target){
 const r=localRect(target,root),from={x:root.clientWidth/2,y:root.clientHeight/2};
 const to=r?{x:r.left+r.width/2,y:r.top+r.height/2}:from;
 return {from,to,mid:{x:(from.x+to.x)/2,y:(from.y+to.y)/2-22}};
}
export function createFeedbackPlayer({getRoot,getArena,hold=1000}={}){
 let current=null;
 function cancel(){
  const run=current;if(!run)return;current=null;clearTimeout(run.timer);run.release?.();
  for(const a of run.animations)try{a.cancel();}catch{/* finished */}
  for(const [side,lp] of run.finalLP)paintLife(run.arena,side,lp);
  run.root.replaceChildren();run.resolve(false);
 }
 async function play(events,{enabled=true,reduced=false,chain=[]}={}){
  cancel();const root=getRoot(),arena=getArena();if(!root||!events.length)return true;
  let resolve;const done=new Promise(yes=>resolve=yes),run={root,arena,resolve,animations:[],finalLP:new Map(),timer:null,release:null};current=run;
  const links=new Map(chain.filter(c=>!['negated','resolved'].includes(c.status)).map((c,i)=>[c.chainLink||i+1,{...c,link:c.chainLink||i+1}])),broken=new Set();
  for(const e of events)if(e.type==='life')run.finalLP.set(e.side,e.after);
  const wait=ms=>new Promise(yes=>{run.release=yes;run.timer=setTimeout(yes,ms);});
  const animate=(node,frames,options)=>{if(!enabled||reduced||typeof node?.animate!=='function')return;try{const a=node.animate(frames,options);a.finished?.catch(()=>{});run.animations.push(a);}catch{/* static fallback */}};
  const rack=()=>paintChainRack(arena,[...links.values()]);rack();
  if(!enabled){
   for(const e of events)if(e.type==='chain'){if(e.stage==='add')links.set(e.link,e);if(['resolved','negated'].includes(e.stage))links.delete(e.link);if(e.stage==='complete')links.clear();}
   rack();root.innerHTML=events.filter(e=>e.type==='life').map(e=>`<strong class="duel-life-static ${e.delta>0?'gain':'loss'}" role="status" aria-label="${who(e.side)} ${e.delta>0?'gained':'lost'} ${number(e.amount??e.delta)} Life Points">${e.delta>0?'+':'−'}${number(e.amount??e.delta)}</strong>`).join('');
   for(const [side,lp] of run.finalLP)paintLife(arena,side,lp);
   run.timer=setTimeout(cancel,1800);return true;
  }
  const sequence=async()=>{
   for(const e of events){
    if(current!==run)return false;root.replaceChildren();
    if(e.type==='life'){
     root.innerHTML=`<strong class="duel-life-flight ${e.delta>0?'gain':'loss'}" data-feedback="life" data-side="${e.side}" role="status" aria-label="${who(e.side)} ${e.delta>0?'gained':'lost'} ${number(e.amount??e.delta)} Life Points">${e.delta>0?'+':'−'}${number(e.amount??e.delta)}</strong>`;
     const node=root.firstElementChild,badge=arena.querySelector(`[data-field-lp="${e.side}"]`),g=flightGeometry(root,badge);node.style.transform=at(g.from.x,g.from.y);
     paintLife(arena,e.side,e.before);
     animate(node,[{transform:at(g.from.x,g.from.y,.85),opacity:0},{transform:at(g.from.x,g.from.y),opacity:1,offset:.12},{transform:at(g.from.x,g.from.y),opacity:1,offset:.56,easing:'cubic-bezier(.3,.05,.35,1)'},{transform:at(g.mid.x,g.mid.y,.7),opacity:1,offset:.8},{transform:at(g.to.x,g.to.y,.2),opacity:0}],{duration:hold*1.7,easing:'linear',fill:'both'});
     await wait(reduced?hold*.25:hold*1.7);if(current!==run)return false;
     animate(badge,[{filter:'brightness(1.35)'},{filter:'brightness(1)'}],{duration:300});
     for(let i=1;i<=5;i++){paintLife(arena,e.side,Math.round(e.before+(e.after-e.before)*i/5));await wait(reduced?0:hold*.06);if(current!==run)return false;}
    }else if(e.stage==='add'){
     links.set(e.link,e);rack();const token=arena.querySelector(`[data-chain-link="${e.link}"]`);if(token)token.style.opacity='0';
     root.innerHTML=`<div class="duel-chain-flight" data-feedback="chain" data-stage="add" role="status" aria-label="Chain Link ${e.link}: ${escape(e.card?.name||'effect')}">${chainArtwork(e.link)}</div>`;
     const node=root.firstElementChild,g=flightGeometry(root,token);node.style.transform=at(g.from.x,g.from.y);
     animate(node,[{transform:at(g.from.x,g.from.y,.65),opacity:0},{transform:at(g.from.x,g.from.y),opacity:1,offset:.15},{transform:at(g.from.x,g.from.y),opacity:1,offset:.6,easing:'cubic-bezier(.3,.05,.35,1)'},{transform:at(g.mid.x,g.mid.y,.6),opacity:1,offset:.82},{transform:at(g.to.x,g.to.y,.16),opacity:1}],{duration:hold*2,easing:'linear',fill:'both'});
     await wait(reduced?hold*.25:hold*2);if(current!==run)return false;if(token)token.style.opacity='';
    }else if(e.stage==='resolving'){
     if(!broken.has(e.link)){links.set(e.link,{...e,status:'resolving'});rack();}
    }else if(['resolved','negated'].includes(e.stage)){
     const token=arena.querySelector(`[data-chain-link="${e.link}"]`);
     if(token){const r=localRect(token,root);token.style.opacity='0';root.innerHTML=`<div class="duel-chain-break" data-feedback="chain" data-stage="${e.stage}" role="status" aria-label="Chain Link ${e.link} ${e.stage}">${chainArtwork(e.link,{broken:true})}</div>`;const node=root.firstElementChild;node.style.transform=at(r.left+r.width/2,r.top+r.height/2);for(const [selector,x,angle] of [['.chain-half-left',-40,-25],['.chain-half-right',40,25]])animate(node.querySelector(selector),[{transform:'translate(0) rotate(0)',opacity:1},{transform:`translate(${x}px,-12px) rotate(${angle}deg)`,opacity:0}],{duration:hold*.65,easing:'ease-out',fill:'both'});animate(node.querySelector('text'),[{opacity:1},{opacity:0}],{duration:hold*.3,fill:'both'});await wait(reduced?hold*.12:hold*.7);if(current!==run)return false;}
     links.delete(e.link);broken.add(e.link);rack();
    }else if(e.stage==='complete'){links.clear();rack();}
   }
   return true;
  };
  try{return await Promise.race([sequence(),done]);}finally{if(current===run)cancel();}
 }
 return {play,cancel,get active(){return !!current;}};
}
