import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createDuelIntro} from '../src/duel/intro.js';
function rig(){
  const window=new Window();window.document.body.innerHTML='<div id="intro"></div>';const calls=[];
  window.Element.prototype.animate=function(frames,options){let finish,cancel;const finished=new Promise((yes,no)=>{finish=yes;cancel=()=>no(new Error('Canceled'));});const call={node:this,frames,options,finished,finish,cancel};calls.push(call);return call;};
  const root=window.document.querySelector('#intro'),intro=createDuelIntro({getRoot:()=>root,timings:{spin:5,settle:15,banner:5,result:5}});
  return {window,root,intro,calls,close(){intro.cancel();window.close();}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function finish(r){for(let n=0;n<30&&r.intro.active;n++){for(const call of r.calls)call.finish();await tick();}assert.equal(r.intro.active,false);}
test('opening toss shows the supplied side, then a concise banner agreeing with the core first player',async()=>{
  for(const first of [0,1]){const r=rig();try{
    const done=r.intro.play({coin:true,first});assert.equal(r.root.querySelector('[data-stage]').dataset.stage,'coin');assert.equal(r.root.querySelectorAll('svg.duel-coin-disc').length,1);
    assert.ok(r.calls[0].frames.some(frame=>frame.transform.includes('scaleX(.07)')));assert.ok(!JSON.stringify(r.calls.map(c=>c.frames)).includes('rotateY'));
    for(const call of r.calls)call.finish();await tick();assert.equal(r.root.querySelector('svg text').textContent,first===0?'H':'T');
    await new Promise(resolve=>setTimeout(resolve,18));assert.equal(r.root.querySelector('h2').textContent,'DUEL');assert.equal(r.root.querySelector('p').textContent,first===0?'YOU START':'AI STARTS');
    await finish(r);assert.equal(await done,true);assert.equal(r.root.children.length,0);
  }finally{r.close();}}
});
test('card coin calls show the actual outcome, and victory/defeat use distinct presentation tones',async()=>{
  const r=rig();try{
    let done=r.intro.coin({results:['Tails'],called:'Heads',source:{name:'Jirai Gumo'}});for(const call of r.calls)call.finish();await Promise.resolve();await Promise.resolve();await tick();
    assert.match(r.root.textContent,/Wrong call/);assert.equal(r.root.querySelector('svg text').textContent,'T');await finish(r);await done;
    for(const winner of [0,1,'draw']){done=r.intro.result({winner});assert.equal(r.root.querySelector('h2').textContent,winner===0?'VICTORY':winner===1?'DEFEAT':'DRAW');assert.equal(r.root.firstElementChild.dataset.tone,winner===0?'victory':winner===1?'defeat':'draw');await finish(r);await done;}
  }finally{r.close();}
});
test('skip and cancellation remove the sequence and release all animation waiters',async()=>{
  const r=rig();try{
    const skipped=r.intro.play({coin:true,first:0});r.root.querySelector('button').click();assert.equal(await skipped,true);
    const canceled=r.intro.play({coin:true,first:1});r.intro.cancel();assert.equal(await canceled,false);await tick();assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
test('fixed starts omit the toss, reduced motion stays static, and disabled animation has no wait',async()=>{
  const r=rig();try{
    let done=r.intro.play({coin:false,first:1});assert.equal(r.root.querySelector('.duel-coin-disc'),null);assert.match(r.root.textContent,/AI STARTS/);await finish(r);await done;
    const count=r.calls.length;done=r.intro.play({coin:true,first:0},{reduced:true});assert.equal(r.calls.length,count);assert.equal(r.root.querySelector('.duel-coin-disc'),null);r.intro.cancel();await done;
    assert.equal(await r.intro.play({coin:true,first:0},{enabled:false}),true);assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
test('an unavailable animation implementation falls back to a bounded static presentation',async()=>{
  const r=rig();try{r.window.Element.prototype.animate=()=>{throw Error('unavailable');};assert.equal(await r.intro.play({coin:true,first:0}),true);assert.equal(r.root.children.length,0);}finally{r.close();}
});
