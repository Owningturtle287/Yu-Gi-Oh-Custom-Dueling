import {cardArtURLs,sharpenCardArt} from './card-view.js';
import {CARD_BACK} from './motion.js';

// Explanations and visual notices only. Legality, payments and outcomes always
// come from the native core; these helpers never implement a card effect.
export function effectExplanation(card,{phase,description=0,stage='activate'}={}) {
  if(card?.id===9603356&&phase==='standby')return 'Required Standby upkeep: pay 900 LP. If the payment cannot be made, this card is destroyed.';
  if(card?.id===83258273)return !description&&stage!=='trigger'
    ?'This Continuous Trap stays face-up. After your monster inflicts battle damage, its effect sends the top card of the opponent’s Deck to the Graveyard.'
    :'Your monster inflicted battle damage. Send the top card of the opponent’s Deck to the Graveyard.';
  return String(card?.desc||'Follow the effect’s instructions.').replace(/\s+/g,' ').trim();
}
export function automaticEffectAction(state,actions){
  return state.window?.forced?actions.find(a=>a.type==='ACTIVATE'||a.type==='EFFECT')||null:null;
}
export function effectNotices(previous,next){
  const events=next.log.filter(e=>e.id>(previous?.serial||0)&&e.effectNotice).map(e=>({...e.effectNotice,eventId:e.id}));
  return events.filter((event,index)=>!events.slice(index+1).some(later=>later.uid===event.uid&&later.card.id===event.card.id&&(event.stage==='automatic'||later.chainLink===event.chainLink)));
}

export function cardPresentations(previous,next){
  const notices=effectNotices(previous,next),old=new Map((previous?.players||[]).flatMap(p=>[...p.monsters,...p.spells,p.field].filter(Boolean).map(c=>[c.uid,c])));
  const cards=next.players.flatMap((p,side)=>[...p.monsters,...p.spells,p.field].filter(Boolean).flatMap(card=>{
    const before=old.get(card.uid);if(before&&card.faceUp===before.faceUp)return [];
    if(notices.some(n=>n.uid===card.uid))return [];
    const hidden=side===1&&!card.faceUp&&!before?.faceUp;
    return [{uid:card.uid,card:hidden?{name:'Opponent’s Set card',card_images:[]}:card.card,back:hidden,stage:!card.faceUp?before?'flipDown':'set':before?'flip':'summon',text:!card.faceUp?before?'Turned face-down.':'Placed face-down.':before?'Flipped face-up.':'Placed on the field.'}];
  }));return [...cards,...notices];
}
export function createEffectPlayer({getRoot,hold=3000}){
  let running=null;
  function cancel(){const run=running;if(!run)return;running=null;clearTimeout(run.timer);run.release?.();run.cancelArt?.();for(const animation of run.animations)try{animation.cancel();}catch{/* finished */}run.root.replaceChildren();run.resolve(false);}
  async function play(events,{enabled=true,reduced=false}={}){
    cancel();const root=getRoot();if(!root||!events.length||!enabled)return true;
    let resolve;const done=new Promise(yes=>resolve=yes),run={root,resolve,timer:null,animations:[]};running=run;
    const wait=ms=>new Promise(yes=>{run.release=yes;run.timer=setTimeout(yes,ms);});
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    const sequence=async()=>{
      for(const event of events){
        if(running!==run)return false;
        run.cancelArt?.();
        const card=event.card,url=cardArtURLs(card).preview;
        const image=event.back?`<img src="${CARD_BACK}" alt="Face-down card">`:url?`<img src="${escape(url)}" alt="${escape(card.name)}">`:'<span class="duel-effect-no-art" aria-hidden="true">◇</span>';
        const title={set:'Card Set',summon:'Card played',flip:'Card flipped',flipDown:'Turned face-down',reveal:'Card revealed',activate:'Effect activating',automatic:'Required effect',resolve:'Effect resolved',negated:'Effect negated',ready:'Continuous card ready',continuous:'Continuous effect'}[event.stage]||'Card effect';
        root.innerHTML=`<div class="duel-effect-spotlight" data-effect-stage="${event.stage}" role="status" aria-live="polite"><div class="duel-effect-art">${image}</div><div class="duel-effect-caption"><small>${escape(title)}${event.chainLink?' · Chain '+event.chainLink:''}</small><strong>${escape(card.name)}</strong><p>${escape(event.text)}</p></div></div>`;
        const panel=root.firstElementChild;
        run.cancelArt=event.back?()=>{}:sharpenCardArt(panel.querySelector('.duel-effect-art'),card);
        if(!reduced&&typeof panel.animate==='function')try{const animation=panel.animate([{opacity:0,transform:'translateY(10px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:180,fill:'both',easing:'ease-out'});animation.finished?.catch(()=>{});run.animations.push(animation);}catch{/* static fallback */}
        await wait(hold);
      }
      return true;
    };
    try{return await Promise.race([sequence(),done]);}
    finally{if(running===run)cancel();}
  }
  return {play,cancel,get active(){return !!running;}};
}
