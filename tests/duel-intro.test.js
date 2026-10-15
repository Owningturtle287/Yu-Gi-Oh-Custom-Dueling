import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createDuelIntro} from '../src/duel/intro.js';
function rig(){
  const window=new Window();window.document.body.innerHTML='<div id="intro"></div>';const calls=[];
  window.HTMLElement.prototype.animate=function(frames,options){let finish,cancel;const finished=new Promise((yes,no)=>{finish=yes;cancel=()=>no(new Error('Canceled'));});const call={node:this,frames,options,finished,finish,cancel};calls.push(call);return call;};
  const root=window.document.querySelector('#intro'),intro=createDuelIntro({getRoot:()=>root,timings:{spin:20,settle:0,banner:20}});
  return {window,root,intro,calls,close(){intro.cancel();window.close();}};
}
test('coin landing, announcement and opening banner always agree with the actual first player',async()=>{
  for(const first of [0,1]){
    const r=rig();try{
      const done=r.intro.play({coin:true,first,lp:4000});assert.equal(r.intro.active,true);
      assert.equal(r.root.querySelector('[data-stage]').dataset.stage,'coin');assert.match(r.calls[0].frames.at(-1).transform,new RegExp(`rotateY\\(${1800+first*180}deg\\)`));
      r.calls[0].finish();await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(r.root.querySelector('[data-stage]').dataset.stage,'duel');assert.equal(r.root.querySelector('h2').textContent,'DUEL');
      assert.match(r.root.textContent,first?/TAILS.*AI GOES FIRST/:/HEADS.*YOU GO FIRST/);assert.match(r.root.querySelector('p').textContent,/4,000 LP/);
      assert.equal(r.calls.length,2);r.calls[1].finish();assert.equal(await done,true);assert.equal(r.root.children.length,0);assert.equal(r.intro.active,false);
    }finally{r.close();}
  }
});
test('skip completes once and cancel removes the sequence without leaving a waiting promise or overlay',async()=>{
  const r=rig();try{
    const skipped=r.intro.play({coin:true,first:0});r.root.querySelector('button').click();assert.equal(await skipped,true);assert.equal(r.root.children.length,0);
    const canceled=r.intro.play({coin:true,first:1});r.intro.cancel();assert.equal(await canceled,false);assert.equal(r.intro.active,false);assert.equal(r.root.children.length,0);
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
test('fixed first player omits the toss, reduced motion omits rotation, and disabled animations do not delay gameplay',async()=>{
  const r=rig();try{
    let done=r.intro.play({coin:false,first:1});assert.equal(r.calls.length,1);assert.equal(r.root.querySelector('[data-stage]').dataset.stage,'duel');assert.match(r.root.textContent,/AI goes first/);
    r.calls[0].finish();assert.equal(await done,true);
    const count=r.calls.length;done=r.intro.play({coin:true,first:0},{reduced:true});assert.equal(r.calls.length,count);assert.match(r.root.textContent,/HEADS/);r.root.querySelector('button').click();assert.equal(await done,true);
    assert.equal(await r.intro.play({coin:true,first:0},{enabled:false}),true);assert.equal(r.calls.length,count);assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
test('an unavailable animation implementation cannot leave the opening waiting forever',async()=>{
  const r=rig();try{
    r.window.HTMLElement.prototype.animate=()=>{throw new Error('Animation unavailable');};
    assert.equal(await r.intro.play({coin:true,first:0}),true);assert.equal(r.intro.active,false);assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
