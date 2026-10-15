import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createMatch, applyAction, legalActions } from '../src/duel/engine.js';
import { AI_SPEEDS, decisionDelay, automaticOpeningAction } from '../src/duel/flow.js';
import { CARD_BACK, planMotion, captureArena, createMotionPlayer } from '../src/duel/motion.js';
import { groupedLog } from '../src/duel/log.js';
import { dragon } from './fixtures.js';

const normal={...dragon,id:9001,name:'Warrior',level:4,atk:1800,def:1200};
const hidden={...normal,id:9002,name:'Secret card',card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/9002.jpg'}]};
const deck={main:Array.from({length:40},()=>normal),extra:[]};
const game=()=>createMatch([deck,deck],{seed:77});
function choose(state,type,predicate=()=>true,side=state.active){const action=legalActions(state,side).find(a=>a.type===type&&predicate(a));assert.ok(action);return {action,state:applyAction(state,action,side)};}
function pass(state){while(state.window)state=applyAction(state,{type:'PASS'},state.window.priority);return state;}
function autoToMain1(state){
  const turn=state.turn;let steps=0;
  while(!(state.phase==='main1'&&!state.window)){
    assert.ok(steps++<20,'Opening flow should settle');
    const action=automaticOpeningAction(state,turn);
    if(action)state=applyAction(state,action,0);
    else if(state.window?.priority===1)state=applyAction(state,{type:'PASS'},1);
    else assert.fail('Opening flow stalled');
  }
  return state;
}
test('automatic player opening reaches Main 1 without drawing twice, including later turns',()=>{
  let s=autoToMain1(game());assert.equal(s.players[0].hand.length,5);assert.equal(s.players[0].deck.length,35);
  assert.equal(automaticOpeningAction(s,1),null);
  s.phase='end';s=choose(s,'NEXT').state;assert.equal(s.active,1);assert.equal(s.players[1].hand.length,6);
  s.phase='end';s=choose(s,'NEXT',()=>true,1).state;assert.equal(s.active,0);assert.equal(s.players[0].hand.length,6);
  s=autoToMain1(s);assert.equal(s.turn,3);assert.equal(s.players[0].hand.length,6);assert.equal(s.players[0].deck.length,34);
});
test('automatic opening never bypasses an effect chain, target choice, terminal state, or AI turn',()=>{
  const s=game();s.phase='standby';
  s.window={event:{kind:'phase'},priority:0,passes:0};assert.deepEqual(automaticOpeningAction(s,1),{type:'PASS'});
  s.chain=[{card:{name:'Response'}}];assert.equal(automaticOpeningAction(s,1),null);
  s.chain=[];s.choice={side:0};assert.equal(automaticOpeningAction(s,1),null);
  s.choice=null;s.active=1;assert.equal(automaticOpeningAction(s,1),null);
  s.active=0;s.winner=0;assert.equal(automaticOpeningAction(s,1),null);
});
test('AI pacing is ordered, independent of animations, and has a safe default',()=>{
  assert.ok(decisionDelay('fast')<decisionDelay('normal'));
  assert.ok(decisionDelay('normal')<decisionDelay('relaxed'));
  assert.ok(decisionDelay('relaxed')<decisionDelay('deliberate'));
  assert.equal(decisionDelay('bad setting'),AI_SPEEDS.normal.delay);
});
test('opening hand animations start at each deck; opposing hidden image URLs never enter the plan',()=>{
  const s=game();s.players[1].hand.forEach(card=>card.card=hidden);
  const motions=planMotion(null,s);assert.equal(motions.length,10);
  assert.ok(motions.every(m=>m.draw&&m.from.endsWith(':deck')&&m.start.image===CARD_BACK));
  assert.ok(motions.filter(m=>m.to==='1:hand').every(m=>m.end.back&&m.end.image===CARD_BACK));
  assert.ok(!JSON.stringify(motions).includes('9002.jpg'));
  assert.ok(!JSON.stringify(motions).includes('Secret card'));
});
test('Set and face-up Defense use 90 degrees; flip/change position and summons share movement plans',()=>{
  let s=autoToMain1(game());const set=choose(s,'SUMMON',action=>action.set);
  const move=planMotion(s,set.state,set.action).find(m=>m.uid===set.action.uid);
  assert.equal(move.from,'0:hand');assert.equal(move.to,'0:monsters');assert.equal(move.end.rotation,90);assert.equal(move.end.image,CARD_BACK);
  s=pass(set.state);s.turn=3;s.phase='main1';const flip=choose(s,'FLIP');
  const rotation=planMotion(s,flip.state,flip.action).find(m=>m.uid===set.action.uid);
  assert.equal(rotation.type,'flip');assert.equal(rotation.start.rotation,90);assert.equal(rotation.end.rotation,0);assert.equal(rotation.end.back,false);
  s=pass(flip.state);s.turn=5;const defense=choose(s,'POSITION');
  const changed=planMotion(s,defense.state,defense.action).find(m=>m.uid===set.action.uid);
  assert.equal(changed.type,'rotate');assert.equal(changed.end.rotation,90);assert.equal(changed.end.back,false);
});
test('movement plans include graveyard, returns, control changes and public LP changes',()=>{
  const s=game(),next=structuredClone(s),card=next.players[0].hand.shift();
  next.players[1].monsters[0]={...card,controller:1,faceUp:true,position:'attack'};
  let motion=planMotion(s,next).find(m=>m.uid===card.uid);assert.equal(motion.from,'0:hand');assert.equal(motion.to,'1:monsters');
  const grave=structuredClone(next);grave.players[1].monsters[0]=null;grave.players[0].grave.push(card);grave.players[1].lp-=500;
  const motions=planMotion(next,grave);motion=motions.find(m=>m.uid===card.uid);assert.equal(motion.to,'0:grave');assert.equal(motion.end.back,false);
  assert.deepEqual(motions.find(m=>m.type==='life'),{type:'life',to:'1:lp',delta:-500,before:8000,after:7500});
  const returned=structuredClone(grave);returned.players[0].grave=[];returned.players[0].hand.push(card);assert.equal(planMotion(grave,returned).find(m=>m.uid===card.uid).to,'0:hand');
});
test('effect damage hits the actual recipient, including recoil, and targeting gets a source-to-target cue',()=>{
  const state=game(),source=state.players[0].hand[0],target=state.players[1].hand[0],next=structuredClone(state);
  next.log.push({id:state.serial+1,kind:'target',uids:[source.uid,target.uid],message:'Target selected.'},
    {id:state.serial+2,kind:'damage',uids:[source.uid],targetSide:0,message:'You lost 500 LP.'},
    {id:state.serial+3,kind:'damage',uids:[source.uid],targetSide:1,message:'AI lost 500 LP.'});
  const motions=planMotion(state,next);
  assert.ok(motions.some(m=>m.type==='effect'&&m.uid===source.uid&&m.target===target.uid));
  assert.deepEqual(motions.filter(m=>m.type==='impact').map(m=>m.to),['0:lp','1:lp']);
});
test('attacks point to the chosen monster or opposing Life Points',()=>{
  const s=game(),card=s.players[0].hand.shift();s.players[0].monsters[0]={...card,faceUp:true,position:'attack'};
  let motion=planMotion(s,s,{type:'ATTACK',uid:card.uid,target:null}).find(m=>m.type==='attack');assert.equal(motion.to,'1:lp');
  const target=s.players[1].hand.shift();s.players[1].monsters[0]={...target,faceUp:false,position:'defense'};
  motion=planMotion(s,s,{type:'ATTACK',uid:card.uid,target:target.uid}).find(m=>m.type==='attack');assert.equal(motion.target,target.uid);
});
test('native attack declaration and preliminary calculation do not animate an impact before responses finish',()=>{
  const s=game(),card=s.players[0].hand.shift();s.version=2;s.players[0].monsters[0]={...card,faceUp:true,position:'attack'};
  const next=structuredClone(s);next.log.push({id:s.serial+1,kind:'battle',uids:[card.uid],message:'Calculating battle.'});
  const declaration=planMotion(s,next,{type:'DECLARE_ATTACK',uid:card.uid,target:null});
  assert.ok(!declaration.some(m=>['attack','impact'].includes(m.type)));
  const strike=planMotion(s,next,{type:'ATTACK',uid:card.uid,target:null});
  assert.equal(strike.filter(m=>m.type==='attack').length,1);assert.equal(strike.filter(m=>m.type==='impact').length,1);assert.equal(strike.find(m=>m.type==='impact').to,'1:lp');
});
test('log entries retain turn/phase/actor context, battle numbers and hidden Set privacy',()=>{
  let s=autoToMain1(game());const set=choose(s,'SUMMON',a=>a.set);s=pass(set.state);
  const entry=s.log.find(e=>e.kind==='summon');assert.equal(entry.turn,1);assert.equal(entry.phase,'main1');assert.equal(entry.side,0);assert.doesNotMatch(entry.message,/Warrior/);
  s.turn=2;s.active=1;s.phase='battle';const attacker=s.players[1].hand.shift();s.players[1].monsters[0]={...attacker,controller:1,faceUp:true,position:'attack',attacks:0};
  const attack=choose(s,'ATTACK',()=>true,1);assert.match(attack.state.log.at(-1).message,/face-down Defense Position monster/);
  s=pass(attack.state);assert.match(s.log.find(e=>e.kind==='battle').message,/1800 ATK.*1200 DEF/);
  assert.ok(planMotion(attack.state,s).some(m=>m.type==='impact'&&m.target===set.action.uid));
  assert.ok(s.log.every(e=>e.turn&&e.phase&&[0,1].includes(e.side)));
});
test('expanded log groups turns chronologically and filters card/battle information',()=>{
  const entries=[{turn:1,kind:'phase',id:1},{turn:1,kind:'summon',id:2},{turn:2,kind:'battle',id:3},{turn:2,kind:'damage',id:4}];
  assert.deepEqual(groupedLog(entries).map(g=>g.turn),[1,2]);
  assert.deepEqual(groupedLog(entries,'battle').flatMap(g=>g.entries).map(e=>e.id),[3,4]);
  assert.deepEqual(groupedLog(entries,'cards').flatMap(g=>g.entries).map(e=>e.id),[2,3]);
});
function rig(){
  const window=new Window();window.document.body.innerHTML='<main><div data-motion-zone="0:hand" data-rect="0,200,200,80"></div><div data-motion-zone="0:monsters" data-rect="20,100,200,80"><button data-motion-uid="c1" data-rect="40,120,44,64"><span class="duel-card-visual"></span></button></div></main>';
  const calls=[];
  window.HTMLElement.prototype.getBoundingClientRect=function(){const element=this.dataset.rect?this:this.parentElement;const [left,top,width,height]=(element?.dataset.rect||'0,0,0,0').split(',').map(Number);return {left,top,width,height,right:left+width,bottom:top+height};};
  window.Element.prototype.animate=function(keyframes,options){let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});const value={element:this,keyframes,options,finished,finish:resolve,cancel:()=>reject(new Error('Cancelled'))};calls.push(value);return value;};
  return {window,root:window.document.querySelector('main'),calls};
}
const move={type:'move',uid:'c1',from:'0:hand',to:'0:monsters',start:{image:CARD_BACK,rotation:0,back:true},end:{image:normal.card_images[0].image_url_small,rotation:90,back:false}};
test('animation cancellation restores actual cards and removes overlays without blocking completion',async()=>{
  const {window,root,calls}=rig();try{
    const player=createMotionPlayer(root),before=captureArena(root),pending=player.play([move],before);
    assert.ok(window.document.querySelector('.duel-motion-layer'));assert.equal(root.querySelector('.duel-card-visual').style.visibility,'hidden');
    assert.ok(calls.some(c=>c.keyframes.at(-1).transform?.includes('rotate(90deg)')));
    player.cancel();await pending;assert.equal(window.document.querySelector('.duel-motion-layer'),null);assert.equal(root.querySelector('.duel-card-visual').style.visibility,'');
  }finally{window.close();}
});
test('completed animation restores the card once; disabled motion creates no overlay or waits',async()=>{
  const {window,root,calls}=rig();try{
    const player=createMotionPlayer(root),before=captureArena(root);const pending=player.play([move],before);
    calls.forEach(call=>call.finish());await pending;
    assert.equal(root.querySelector('.duel-card-visual').style.visibility,'');assert.equal(window.document.querySelector('.duel-motion-layer'),null);
    const count=calls.length;await player.play([move],before,{enabled:false});assert.equal(calls.length,count);assert.equal(window.document.querySelector('.duel-motion-layer'),null);
  }finally{window.close();}
});
test('upside-down cards retain portrait dimensions and direct attack paths follow the LP side',async()=>{
  const {window,root,calls}=rig();try{
    for(const [side,top] of [[0,400],[1,0]]){const point=window.document.createElement('div');point.dataset.motionZone=side+':lp';point.dataset.rect=`40,${top},100,32`;root.append(point);}
    const player=createMotionPlayer(root),before=captureArena(root),origin=before.cards.get('c1');
    for(const side of [0,1]){
      const previous=calls.length,pending=player.play([{type:'attack',uid:'c1',target:null,to:side+':lp',start:{image:CARD_BACK,rotation:180},end:{image:CARD_BACK,rotation:180}}],before);
      const ghost=window.document.querySelector('.duel-moving-card');assert.equal(ghost.style.width,'44px');assert.equal(ghost.style.height,'64px');
      const flight=calls.slice(previous).find(call=>call.element===ghost);
      const y=Number(flight.keyframes[2].transform.match(/translate\([^,]+,([^p]+)px\)/)[1]);assert.ok(side===0?y>origin.y:y<origin.y);
      calls.slice(previous).forEach(call=>call.finish());await pending;
    }
  }finally{window.close();}
});
test('a strike keeps its arrow and lunge aimed at a destroyed victim’s original field position',async()=>{
  const {window,root,calls}=rig();try{
    const victim=window.document.createElement('button');victim.dataset.motionUid='victim';victim.dataset.rect='180,10,44,64';root.append(victim);
    const player=createMotionPlayer(root),before=captureArena(root);victim.remove();
    const pending=player.play([{type:'attack',uid:'c1',target:'victim',side:0,start:{image:CARD_BACK,rotation:0},end:{image:CARD_BACK,rotation:0}}],before);
    const arrow=window.document.querySelector('.duel-strike-arrow');assert.ok(arrow);assert.equal(arrow.querySelector('marker').getAttribute('orient'),'auto');
    const [sx,sy,tx,ty]=arrow.querySelector('.duel-arrow-shaft').getAttribute('d').match(/-?[\d.]+/g).map(Number);assert.ok(tx>sx&&ty<sy);
    const ghost=window.document.querySelector('.duel-moving-card'),flight=calls.find(c=>c.element===ghost);
    const [x,y]=flight.keyframes[2].transform.match(/translate\(([^,]+)px,([^p]+)px\)/).slice(1).map(Number);assert.ok(x>before.cards.get('c1').x&&y<before.cards.get('c1').y);
    const reveal=calls.find(c=>c.element.classList?.contains('duel-arrow-shaft'));assert.ok(reveal.keyframes[0].strokeDashoffset>reveal.keyframes[1].strokeDashoffset);
    calls.forEach(c=>c.finish());await pending;assert.equal(window.document.querySelector('.duel-motion-layer'),null);
  }finally{window.close();}
});
test('defense rotates the complete card surface; the authentic back and motion modules are cached offline',async()=>{
  const css=await readFile(new URL('../duel.css',import.meta.url),'utf8'),worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(css,/\.duel-zone \.duel-card-visual \{[^}]*rotate\(var\(--card-rotation,0deg\)\)/);
  assert.match(css,/\.duel-zone\.defense \.duel-card-visual \{[^}]*100cqw/);
  assert.match(css,/\.duel-motion-layer \{[^}]*position:fixed[^}]*pointer-events:none[^}]*overflow:hidden/);
  assert.match(css,/\.duel-log-body \{[^}]*height:calc\(100dvh/);
  assert.match(worker,/assets\/card-back.jpg/);assert.match(worker,/src\/duel\/motion.js/);assert.match(worker,/src\/duel\/flow.js/);assert.match(worker,/src\/duel\/log.js/);
  const asset=await readFile(new URL('../assets/card-back.jpg',import.meta.url));assert.equal(asset.readUInt16BE(0),0xffd8);assert.ok(asset.length>10000);
});
