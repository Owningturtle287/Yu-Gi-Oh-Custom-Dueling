// A presentation-only sequence. Its coin face always reflects the same first
// player used to initialize the rules core; animation never rerolls the result.
export function createDuelIntro({getRoot,timings={spin:1550,settle:650,banner:850}}) {
  let running=null;
  function stop(completed=false) {
    const run=running;if(!run)return;
    run.stopped=true;
    for(const animation of run.animations)try{animation.cancel();}catch{/* finished */}
    for(const release of [...run.waiters])release(false);
    const restoreFocus=run.root.contains(run.root.ownerDocument.activeElement);
    run.root.replaceChildren();if(restoreFocus)run.root.closest('main')?.focus({preventScroll:true});
    run.resolve(completed);running=null;
  }
  async function play({coin=false,first=0,lp=8000},{enabled=true,reduced=false}={}) {
    stop();
    const root=getRoot();if(!root||!enabled)return true;
    let resolve;const interrupted=new Promise(done=>resolve=done);
    const run={root,resolve,stopped:false,animations:new Set(),waiters:new Set()};running=run;
    const wait=duration=>new Promise(done=>{
      const release=value=>{clearTimeout(timer);run.waiters.delete(release);done(value);};
      const timer=setTimeout(()=>release(true),duration);run.waiters.add(release);
    });
    const animate=async(node,frames,duration)=>{
      if(run.stopped)return false;
      if(typeof node.animate!=='function')return wait(duration);
      let animation;
      try{animation=node.animate(frames,{duration,easing:'cubic-bezier(.18,.72,.2,1)',fill:'both'});}catch{return wait(duration);}
      run.animations.add(animation);
      try{await animation.finished;return !run.stopped;}catch{return !run.stopped;}finally{run.animations.delete(animation);}
    };
    const result=first===0?'You go first':'AI goes first',side=first===0?'Heads':'Tails';
    root.innerHTML=`<div class="duel-intro" role="status" aria-live="polite"><button class="duel-intro-skip" aria-label="Skip duel opening animation">Skip intro</button><div class="duel-intro-stage"><div class="duel-intro-kicker"></div><div class="duel-intro-coin" aria-hidden="true"><div class="coin-face coin-heads"><i>◇</i><span>ATLAS</span></div><div class="coin-face coin-tails"><i>✦</i><span>RIVAL</span></div></div><h2></h2><p></p></div></div>`;
    root.querySelector('button').onclick=()=>stop(true);
    root.querySelector('button').focus({preventScroll:true});
    const stage=root.querySelector('.duel-intro-stage'),kicker=root.querySelector('.duel-intro-kicker'),title=root.querySelector('h2'),copy=root.querySelector('p'),token=root.querySelector('.duel-intro-coin');
    const sequence=async()=>{
      if(coin&&!reduced){
        stage.dataset.stage='coin';kicker.textContent='THE OPENING TOSS';title.textContent='Who takes the first turn?';copy.textContent='Heads · You   /   Tails · AI';
        const end=1800+first*180;
        if(!await animate(token,[{transform:'translateY(12px) rotateX(18deg) rotateY(0deg) scale(.8)',opacity:0},{transform:'translateY(-24px) rotateX(12deg) rotateY(720deg) scale(1.1)',opacity:1,offset:.35},{transform:`translateY(0) rotateX(0deg) rotateY(${end}deg) scale(1)`,opacity:1}],timings.spin))return false;
        stage.dataset.stage='result';title.textContent=result;copy.textContent=`${side} · Opening turn decided`;if(!await wait(timings.settle))return false;
      }
      stage.dataset.stage='duel';token.hidden=true;kicker.textContent=coin?`${side.toUpperCase()} · ${result.toUpperCase()}`:'THE TABLE IS SET';
      title.textContent='DUEL';copy.textContent=`${result} · ${lp.toLocaleString()} LP`;
      if(reduced)return wait(200);
      return animate(stage,[{transform:'translateX(-36px) scale(.94)',opacity:0},{transform:'translateX(0) scale(1)',opacity:1,offset:.25},{transform:'translateX(0) scale(1)',opacity:1,offset:.78},{transform:'translateX(24px) scale(1.02)',opacity:0}],timings.banner);
    };
    try{return await Promise.race([sequence(),interrupted]);}
    finally{if(running===run)stop(true);}
  }
  return {play,cancel:()=>stop(false),get active(){return !!running;}};
}
