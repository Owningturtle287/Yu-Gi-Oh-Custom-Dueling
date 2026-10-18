let coinSerial=0;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function coinMarkup(side='Heads'){
  const id=`atlas-coin-${++coinSerial}`;
  return `<svg class="duel-coin-disc" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="${id}"><stop stop-color="#fff4c4"/><stop offset=".6" stop-color="#e8bf63"/><stop offset="1" stop-color="#9b6324"/></radialGradient><linearGradient id="${id}-rim" x2="1" y2="1"><stop stop-color="#fff6d5"/><stop offset=".5" stop-color="#b37730"/><stop offset="1" stop-color="#ffe7a5"/></linearGradient></defs><circle cx="60" cy="60" r="56" fill="url(#${id}-rim)" stroke="#8f632a" stroke-width="2"/><circle cx="60" cy="60" r="50" fill="url(#${id})" stroke="#fff0b3" stroke-width="2"/><circle cx="60" cy="60" r="43" fill="none" stroke="#9e702d" stroke-dasharray="1 4" stroke-width="2"/><path d="M60 24 87 60 60 96 33 60Z" fill="#fff1bc33" stroke="#9e702d" stroke-width="2"/><text x="60" y="71" text-anchor="middle" font-size="31" font-weight="750" fill="#78501d">${side==='Heads'?'H':'T'}</text><path d="M23 41A42 42 0 0 1 82 23" fill="none" stroke="#fff8de" stroke-linecap="round" stroke-width="4" opacity=".7"/></svg>`;
}
// A single SVG face avoids Safari's flickering back-face/3D compositing.
// Outcomes come from the core; presentation never rolls another random value.
export function createDuelIntro({getRoot,timings={spin:1350,settle:650,banner:950,result:3000}}){
  let running=null;
  function stop(completed=false){
    const run=running;if(!run)return;running=null;run.stopped=true;
    for(const animation of run.animations)try{animation.cancel();}catch{}
    for(const done of [...run.waiters])done(false);
    run.root.replaceChildren();run.resolve(completed);
  }
  async function playSequence(kind,data,{enabled=true,reduced=false}={}){
    stop();const root=getRoot();if(!root||!enabled)return true;
    let resolve;const interrupted=new Promise(done=>resolve=done),run={root,resolve,stopped:false,animations:new Set(),waiters:new Set()};running=run;
    const wait=ms=>new Promise(done=>{const finish=value=>{clearTimeout(timer);run.waiters.delete(finish);done(value);};const timer=setTimeout(()=>finish(true),ms);run.waiters.add(finish);});
    const animate=async(node,frames,duration,extra={})=>{
      if(run.stopped)return false;if(reduced||typeof node?.animate!=='function')return wait(reduced?Math.min(duration,150):duration*(extra.iterations||1));
      let animation;try{animation=node.animate(frames,{duration,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both',...extra});}catch{return wait(duration);}
      run.animations.add(animation);try{await animation.finished;return !run.stopped;}catch{return false;}finally{run.animations.delete(animation);}
    };
    root.innerHTML='<div class="duel-intro duel-showcase" role="status" aria-live="polite"><button class="duel-intro-skip" aria-label="Skip presentation">Skip</button><div class="duel-intro-stage"></div></div>';
    root.firstElementChild.dataset.motion=reduced?'off':'on';
    root.querySelector('button').onclick=()=>stop(true);
    const stage=root.querySelector('.duel-intro-stage');
    const toss=async(results,called,label)=>{
      stage.dataset.stage='coin';stage.innerHTML=`<small>${escape(label||'FIRST TURN')}</small><div class="duel-coin-row">${results.map(()=>`<div class="duel-coin-shell">${coinMarkup()}<i class="duel-coin-shadow"></i></div>`).join('')}</div><h2></h2><p>${called?'Called '+escape(called):'Heads · You / Tails · AI'}</p>`;
      const shells=[...stage.querySelectorAll('.duel-coin-shell')];
      await Promise.all(shells.map(async(shell,index)=>{
        const disc=shell.querySelector('svg');
        const flipping=animate(disc,[{transform:'scaleX(1)'},{transform:'scaleX(.07)',offset:.5},{transform:'scaleX(1)'}],(timings.spin||1350)/8,{iterations:8,easing:'linear',fill:'none'});
        await animate(shell,[{transform:'translateY(10px) rotate(-20deg) scale(.8)',opacity:0},{transform:'translateY(-28px) rotate(12deg) scale(1.08)',opacity:1,offset:.32},{transform:'translateY(0) rotate(0) scale(1)',opacity:1}],timings.spin||1350);
        await flipping;if(!run.stopped)shell.innerHTML=coinMarkup(results[index]);
      }));
      if(run.stopped)return false;
      stage.querySelector('h2').textContent=results.join(' · ');
      stage.querySelector('p').textContent=called?(results[0]===called?'Correct call':'Wrong call'):results[0]==='Heads'?'You start':'AI starts';
      return wait(reduced?150:timings.settle??650);
    };
    const banner=async(title,copy,tone='start',hold=timings.banner||950)=>{
      root.firstElementChild.dataset.tone=tone;stage.dataset.stage='banner';stage.innerHTML=`<div class="duel-banner-rule"></div><h2>${escape(title)}</h2><p>${escape(copy)}</p><div class="duel-banner-rule"></div>`;
      await animate(stage,[{opacity:0,transform:'translateY(15px) scale(.87)'},{opacity:1,transform:'translateY(0) scale(1)'}],Math.min(300,timings.banner??950));
      if(run.stopped)return false;await wait(reduced?Math.min(hold,kind==='result'?800:150):hold);if(run.stopped)return false;
      return animate(stage,[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-8px)'}],Math.min(220,timings.banner??950));
    };
    const sequence=async()=>{
      if(kind==='coin')return toss(data.results,data.called,data.source?.name||'COIN TOSS');
      if(kind==='result')return banner(data.winner==='draw'?'DRAW':data.winner===0?'VICTORY':'DEFEAT',data.winner==='draw'?'A hard-fought duel':data.winner===0?'Your strategy prevailed':'A new strategy awaits',data.winner===0?'victory':data.winner==='draw'?'draw':'defeat',timings.result||3000);
      if(reduced)return banner('DUEL',data.first===0?'YOU START':'AI STARTS','start',150);
      if(data.coin&&!await toss([data.first===0?'Heads':'Tails'],null,null))return false;
      if(run.stopped)return false;return banner('DUEL',data.first===0?'YOU START':'AI STARTS');
    };
    try{return await Promise.race([sequence(),interrupted]);}finally{if(running===run)stop(true);}
  }
  return {play:(data,options)=>playSequence('intro',data,options),coin:(data,options)=>playSequence('coin',data,options),result:(data,options)=>playSequence('result',data,options),cancel:()=>stop(false),get active(){return !!running;}};
}
