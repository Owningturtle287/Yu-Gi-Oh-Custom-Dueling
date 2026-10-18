import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {localRect,landscapeSize} from '../src/duel/viewport.js';
import {arenaGeometry} from '../src/duel/arena-layout.js';
import {cardPresentations,createEffectPlayer} from '../src/duel/effects.js';
test('clockwise portrait transforms map card and target rectangles back into landscape coordinates',()=>{
  const window=new Window();try{
    const root=window.document.createElement('div'),card=window.document.createElement('div');window.document.body.append(root);root.append(card);window.document.documentElement.dataset.duelRotated='true';
    root.getBoundingClientRect=()=>({left:0,top:0,right:390,bottom:844,width:390,height:844});card.getBoundingClientRect=()=>({left:280,top:100,right:340,bottom:140,width:60,height:40});
    assert.deepEqual(localRect(card,root),{left:100,top:50,width:40,height:60});assert.deepEqual(landscapeSize({innerWidth:390,innerHeight:844}),{width:844,height:390});
  }finally{window.close();}
});
test('hand enlargement cannot change card rows, piles, phase rail or the fixed hand lane',()=>{
  for(const [w,h] of [[750,363],[844,390],[932,430]]){
    const normal=arenaGeometry(w,h),large=arenaGeometry(w,h,{expandedHand:true});assert.deepEqual(large,normal);assert.ok(large.required<=large.fieldWidth);assert.ok(Math.abs(large.topSide+large.bottomSide+large.sideGap+8-h)<.01);assert.ok(large.cardHeight>=32);
  }
});
test('standard card notices show own Sets, hide opposing Sets, and reveal an actual Flip once',()=>{
  const empty=()=>({monsters:Array(5).fill(null),spells:Array(5).fill(null),field:null}),previous={players:[empty(),empty()],log:[],serial:0},next=structuredClone(previous);
  next.players[0].monsters[0]={uid:'own',faceUp:false,card:{id:1,name:'Own Set'}};next.players[1].monsters[0]={uid:'ai',faceUp:false,card:{id:2,name:'Private monster'}};
  const notices=cardPresentations(previous,next);assert.equal(notices.find(n=>n.uid==='own').card.name,'Own Set');assert.equal(notices.find(n=>n.uid==='ai').back,true);assert.ok(!JSON.stringify(notices).includes('Private monster'));
  const flipped=structuredClone(next);flipped.players[1].monsters[0].faceUp=true;assert.equal(cardPresentations(next,flipped)[0].stage,'flip');assert.equal(cardPresentations(next,flipped)[0].card.name,'Private monster');
  const reset=cardPresentations(flipped,next);assert.equal(reset[0].stage,'flipDown');assert.equal(reset[0].card.name,'Private monster','A publicly visible monster turned down does not invent a hidden identity');
});
test('standard card inspection holds for three seconds and cancellation releases the pending timer',async()=>{
  const window=new Window();window.document.body.innerHTML='<div id="root"></div>';const original=globalThis.setTimeout,timers=[];
  const player=createEffectPlayer({getRoot:()=>window.document.querySelector('#root')});
  try{globalThis.setTimeout=(fn,ms)=>{timers.push(ms);return 1;};const done=player.play([{card:{name:'A card'},stage:'summon',text:'Played.'}]);assert.ok(timers.includes(3000));player.cancel();assert.equal(await done,false);assert.equal(window.document.querySelector('#root').children.length,0);}finally{globalThis.setTimeout=original;window.close();}
});
