import {paintLife} from './motion.js';
import {cardArtURLs} from './card-view.js';

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
    links:chain.map((c,i)=>({link:c.chainLink||i+1,side:c.side,name:c.card.name,status:c.status||'waiting'})).reverse()};
}
function eventHTML(event){
  if(event.type==='life'){
    const label=event.kind==='gain'?'LP RECOVERED':event.kind==='cost'?'LP COST PAID':'LP DAMAGE';
    return `<section class="duel-feedback-panel life ${event.delta>0?'gain':'loss'}" data-feedback="life" data-side="${event.side}"><small>${who(event.side)} · ${label}${event.chainLink?` · LINK ${event.chainLink}`:''}</small><strong class="duel-feedback-amount">${event.delta>0?'+':'−'}${number(event.amount??event.delta)}</strong><div class="duel-feedback-totals">${number(event.before)} <span>→</span> <b>${number(event.after)} LP</b></div>${event.source?`<p>${escape(event.source)}</p>`:''}</section>`;
  }
  const labels={add:'CHAIN LINK',resolving:'RESOLVING LINK',resolved:'LINK RESOLVED',negated:'LINK NEGATED',complete:'CHAIN COMPLETE'};
  const url=event.card&&cardArtURLs(event.card).preview;
  return `<section class="duel-feedback-panel chain" data-feedback="chain" data-stage="${event.stage}"><small>${labels[event.stage]||'CHAIN'}${event.stage==='complete'?` · ${event.total} LINK${event.total===1?'':'S'}`:` · ${who(event.side)}`}</small>${event.link?`<strong class="duel-feedback-link">${event.link}<span>${event.stage==='add'?'ADDED':`/ ${event.total}`}</span></strong>`:'<strong class="duel-feedback-complete">✓</strong>'}${event.card?`<div class="duel-feedback-card">${url?`<img src="${escape(url)}" alt="">`:''}<b>${escape(event.card.name)}</b></div>`:''}<p>${escape(event.stage==='add'?'Newest link resolves first.':event.stage==='resolving'?'Applying this link now.':event.stage==='complete'?'All links have finished.':event.text||'')}</p></section>`;
}
export function createFeedbackPlayer({getRoot,getArena,hold=1000}={}){
  let current=null;
  function cancel(){
    const run=current;if(!run)return;current=null;clearTimeout(run.timer);run.release?.();
    for(const animation of run.animations)try{animation.cancel();}catch{/* already finished */}
    for(const [side,lp] of run.finalLP)paintLife(run.arena,side,lp);
    run.root.replaceChildren();run.resolve(false);
  }
  async function play(events,{enabled=true,reduced=false}={}){
    cancel();const root=getRoot(),arena=getArena();if(!root||!events.length)return true;
    let resolve;const done=new Promise(yes=>resolve=yes),run={root,arena,resolve,timer:null,release:null,animations:[],finalLP:new Map()};current=run;
    for(const event of events)if(event.type==='life')run.finalLP.set(event.side,event.after);
    const wait=ms=>new Promise(yes=>{run.release=yes;run.timer=setTimeout(yes,ms);});
    const animate=(node,frames,options)=>{if(!enabled||reduced||typeof node?.animate!=='function')return;try{const a=node.animate(frames,options);a.finished?.catch(()=>{});run.animations.push(a);}catch{/* static presentation */}};
    if(!enabled){
      // Card motion can be disabled without hiding the accounting. Show a short,
      // nonblocking receipt, keeping every LP event even when their net is zero.
      const life=events.filter(e=>e.type==='life');
      const text=life.map(e=>`${who(e.side)} ${e.delta>0?'+':'−'}${number(e.amount??e.delta)} LP${e.chainLink?` · Link ${e.chainLink}`:''}`);
      const chains=events.filter(e=>e.type==='chain');
      if(chains.length){const last=chains.at(-1);text.push(last.stage==='complete'?`Chain complete · ${last.total} links`:`Chain Link ${last.link} · ${last.card?.name||last.stage}`);}
      root.innerHTML=`<div class="duel-feedback-receipt" role="status">${text.map(t=>`<span>${escape(t)}</span>`).join('')}</div>`;
      for(const [side,lp] of run.finalLP)paintLife(arena,side,lp);
      run.timer=setTimeout(cancel,1800);return true;
    }
    const sequence=async()=>{
      for(const event of events){
        if(current!==run)return false;
        root.innerHTML=eventHTML(event);const panel=root.firstElementChild;panel.setAttribute('role','status');
        animate(panel,[{opacity:0,transform:'translate(-50%,-50%) scale(.86)'},{opacity:1,transform:'translate(-50%,-50%) scale(1.03)',offset:.7},{opacity:1,transform:'translate(-50%,-50%) scale(1)'}],{duration:240,easing:'ease-out',fill:'both'});
        if(event.type==='life'){
          const badge=arena.querySelector(`[data-field-lp="${event.side}"]`);
          animate(badge,[{filter:'brightness(1.8)',transform:'scale(1.07)'},{filter:'brightness(1)',transform:'scale(1)'}],{duration:650,easing:'ease-out'});
          paintLife(arena,event.side,event.before);
          // Short monotonic counter steps; no preview of the final total.
          for(let step=1;step<=5;step++){await wait(hold*.08);if(current!==run)return false;paintLife(arena,event.side,Math.round(event.before+(event.after-event.before)*step/5));}
          await wait(hold*.6);
        }else await wait(hold*(event.stage==='resolving'?.55:event.stage==='add'?.7:.5));
      }
      return true;
    };
    try{return await Promise.race([sequence(),done]);}finally{if(current===run)cancel();}
  }
  return {play,cancel,get active(){return !!current;}};
}
