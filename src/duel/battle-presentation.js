import {cardArtURLs,sharpenCardArt} from './card-view.js';
import {localRect} from './viewport.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// Only a confirmed damage calculation supplies a battle receipt. In particular,
// declaration, response windows and negated attacks never reveal a hidden card.
export function battlePresentations(previous,next){
  return next.log.filter(e=>e.id>(previous?.serial||0)&&e.battleNotice).map(e=>({...e.battleNotice,eventId:e.id}));
}
export function battleGeometry(left,right,side){
  const center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
  const human=center(left),ai=center(right),from=side===0?human:ai,to=side===0?ai:human;
  return {from,to,direction:side===0?1:-1};
}
const sword=`<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M28 70 73 15 88 8 84 26 39 79Z" fill="#f7ffff" stroke="#8aa3ab" stroke-width="1.5"/><path d="M35 74 82 17 40 79Z" fill="#b5ced6"/><path d="m22 66 24 21 5-6-24-21Z" fill="#d9b96e" stroke="#94712e" stroke-width="2"/><path d="m29 78-12 14-6-5 12-14" fill="#315e60" stroke="#173e47" stroke-width="2"/><path d="m9 86 10 9-5 4-10-9Z" fill="#e8cc83"/></svg>`;
const shield=`<svg viewBox="0 0 120 140" aria-hidden="true"><path d="M60 6 109 24 104 82Q97 112 60 132 23 112 16 82L11 24Z" fill="#e1f5f4ed" stroke="#639d9c" stroke-width="3"/><path d="M60 16 99 31 95 80Q89 103 60 121 31 103 25 80L21 31Z" fill="#72b2b888" stroke="#f7ffff" stroke-width="2"/><path d="M60 23V111M30 57H90" stroke="#eaffff" stroke-width="6" stroke-linecap="round"/></svg>`;

export function createBattlePlayer({getRoot,timings={enter:260,anticipate:220,strike:440,hold:850,exit:220}}){
  let running=null;
  function cancel(completed=false){
    const run=running;if(!run)return;running=null;run.stopped=true;
    for(const animation of run.animations)try{animation.cancel();}catch{}
    for(const release of [...run.waiters])release(false);
    for(const cleanup of run.art)cleanup();run.root.replaceChildren();run.resolve(completed);
  }
  async function play(events,{enabled=true,reduced=false}={}){
    cancel();const root=getRoot();if(!root||!events.length||!enabled)return true;
    let resolve;const done=new Promise(yes=>resolve=yes),run={root,resolve,stopped:false,animations:new Set(),waiters:new Set(),art:[]};running=run;
    const wait=ms=>new Promise(yes=>{const release=value=>{clearTimeout(timer);run.waiters.delete(release);yes(value);};const timer=setTimeout(()=>release(true),ms);run.waiters.add(release);});
    const animate=async(node,frames,duration)=>{
      if(run.stopped)return false;if(!node||reduced||typeof node.animate!=='function')return true;
      let animation;try{animation=node.animate(frames,{duration,easing:'cubic-bezier(.2,.75,.25,1)',fill:'both'});}catch{return true;}
      run.animations.add(animation);try{await animation.finished;return !run.stopped;}catch{return false;}finally{run.animations.delete(animation);}
    };
    const sequence=async()=>{
      for(const event of events){
        if(run.stopped)return false;
        for(const cleanup of run.art)cleanup();run.art=[];
        const blocked=!!event.defender?.defense&&event.defender.def>event.attacker.atk;
        const combatant=side=>{
          const attacking=side===event.side,card=attacking?event.attacker:event.defender;
          const url=cardArtURLs(card?.card).preview;
          return `<section class="duel-battle-combatant" data-side="${side}" data-combat-role="${attacking?'attacker':'defender'}"><small>${side===0?'YOU':'AI'} · ${attacking?'ATTACK':card?card.defense?'DEFENSE':'ATTACK POSITION':'DIRECT ATTACK'}</small><div class="duel-battle-card">${card?url?`<img src="${escape(url)}" alt="${escape(card.card.name)}">`:`<span class="duel-battle-no-art">${escape(card.card.name)}</span>`:`<div class="duel-battle-lp"><small>LIFE POINTS</small><strong>${Math.max(0,event.targetLP).toLocaleString()}</strong></div>`}<div class="duel-battle-impact"></div>${!attacking&&blocked?`<div class="duel-battle-shield">${shield}</div>`:''}</div><strong class="duel-battle-name">${escape(card?.card.name||'Life Points')}</strong><span class="duel-battle-value">${card?attacking?'ATK '+card.atk:card.defense?'DEF '+card.def:'ATK '+card.atk:'DIRECT'}</span></section>`;
        };
        root.innerHTML=`<div class="duel-battle-showcase" data-attacker-side="${event.side}" data-blocked="${blocked}" data-motion="${reduced?'off':'on'}" role="status" aria-live="polite" aria-label="${escape(event.attacker.card.name)} attacks ${escape(event.defender?.card.name||'Life Points directly')}${blocked?'; defended by higher DEF':''}"><button class="duel-battle-skip" aria-label="Skip battle presentation">Skip</button><div class="duel-battle-pair">${combatant(0)}<div class="duel-battle-versus" aria-hidden="true">VS</div>${combatant(1)}<div class="duel-battle-sword">${sword}</div><svg class="duel-battle-slash" viewBox="0 0 160 160" aria-hidden="true"><path d="M12 142Q45 44 147 14Q78 69 12 142Z" fill="#fffdf1"/><path d="M17 146Q56 58 143 19" fill="none" stroke="#e5bd6c" stroke-width="3"/></svg></div><p class="duel-battle-verdict">${blocked?'DEFENSE HOLDS':event.defender?'BATTLE':'DIRECT STRIKE'}</p></div>`;
        root.querySelector('button').onclick=()=>cancel(true);
        const panel=root.firstElementChild,pair=root.querySelector('.duel-battle-pair'),combatants=[...root.querySelectorAll('.duel-battle-combatant')],arts=combatants.map(c=>c.querySelector('.duel-battle-card'));
        for(const [side,container] of arts.entries()){
          const card=side===event.side?event.attacker:event.defender;if(card)run.art.push(sharpenCardArt(container,card.card));
        }
        if(reduced){panel.dataset.stage='settled';if(!await wait(Math.min(1200,timings.hold)))return false;continue;}
        await Promise.all(combatants.map((node,i)=>animate(node,[{opacity:0,transform:`translateX(${i===0?-35:35}px) scale(.94)`},{opacity:1,transform:'translateX(0) scale(1)'}],timings.enter)));
        if(run.stopped||!await wait(timings.anticipate))return false;
        const geometry=battleGeometry(localRect(arts[0],pair),localRect(arts[1],pair),event.side),{from,to,direction}=geometry;
        const blade=root.querySelector('.duel-battle-sword'),slash=root.querySelector('.duel-battle-slash'),defender=combatants[1-event.side],target=arts[1-event.side],barrier=root.querySelector('.duel-battle-shield');
        const pose=(x,y,angle,scale)=>`translate(${x}px,${y}px) translate(-50%,-50%) scaleX(${direction}) rotate(${angle}deg) scale(${scale})`;
        panel.dataset.stage='strike';
        slash.style.left=`${to.x}px`;slash.style.top=`${to.y}px`;
        await Promise.all([
          animate(blade,[{opacity:0,transform:pose(from.x,from.y+20,-35,.65)},{opacity:1,transform:pose(from.x+direction*18,from.y-10,-15,1),offset:.22},{opacity:1,transform:pose(to.x,to.y,35,1.15),offset:.76},{opacity:0,transform:pose(to.x+direction*20,to.y+20,65,.9)}],timings.strike),
          animate(combatants[event.side],[{transform:'translateX(0)'},{transform:`translateX(${direction*14}px)`,offset:.65},{transform:'translateX(0)'}],timings.strike),
          animate(slash,[{opacity:0,transform:`translate(-50%,-50%) scaleX(${direction}) scale(.4)`},{opacity:0,offset:.55},{opacity:1,transform:`translate(-50%,-50%) scaleX(${direction}) scale(1)`,offset:.78},{opacity:0,transform:`translate(-50%,-50%) scaleX(${direction}) scale(1.2)`}],timings.strike),
          animate(barrier,[{opacity:0,transform:'scale(.65)'},{opacity:0,offset:.45},{opacity:1,transform:'scale(1.08)',offset:.75},{opacity:1,transform:'scale(1)'}],timings.strike),
          animate(target.querySelector('.duel-battle-impact'),[{opacity:0},{opacity:0,offset:.6},{opacity:blocked ? .45 : .8,offset:.76},{opacity:0}],timings.strike),
          animate(defender,[{transform:'translateX(0)'},{transform:'translateX(0)',offset:.65},{transform:`translateX(${direction*(blocked?3:9)}px)`,offset:.8},{transform:'translateX(0)'}],timings.strike)
        ]);
        if(run.stopped)return false;panel.dataset.stage='settled';if(!await wait(timings.hold))return false;
        await animate(panel,[{opacity:1},{opacity:0}],timings.exit);
      }return true;
    };
    try{return await Promise.race([sequence(),done]);}finally{if(running===run)cancel(true);}
  }
  return {play,cancel:()=>cancel(false),get active(){return !!running;}};
}
