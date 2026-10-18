import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {normalizeCard} from '../src/core.js';
import {loadNativeRules} from '../src/duel/native-loader.js';
import {createNativeBackend} from '../src/duel/native-engine.js';
import {battlePresentations,battleGeometry,createBattlePlayer} from '../src/duel/battle-presentation.js';
import {damageDuel,advanceBattle,command} from './battle-fixtures.js';

const cards=JSON.parse(await readFile(new URL('./rules-fixtures.json',import.meta.url))).data.map(normalizeCard);
const rules=await loadNativeRules({fetchImpl:async u=>new Response(await readFile(u)),wasmBinary:await readFile(new URL('../vendor/ocgcore/lib/ocgcore.sync.wasm',import.meta.url))});
test('battle receipts come from calculated combat, retain destroyed card art, and never reveal at declaration',async()=>{
  for(const side of [0,1]){
    const engine=createNativeBackend({rules:()=>rules});let s=await damageDuel(engine,cards,{defendingSide:1-side,traps:['Castle Walls']});try{
      assert.equal(battlePresentations(null,s).length,0);
      const before=s;s=advanceBattle(engine,s,x=>x.log.some(l=>l.battleNotice));
      const events=battlePresentations(before,s);assert.equal(events.length,1);
      const event=events[0];assert.equal(event.side,side);assert.equal(event.attacker.card.name,'Dark Magician');assert.equal(event.attacker.atk,2500);assert.equal(event.defender.card.name,'Mystical Elf');assert.equal(event.defender.defense,true);assert.equal(event.defender.def,2000);assert.ok(event.defender.card.card_images.length);
      s=advanceBattle(engine,s,x=>!x.pending);assert.ok(s.players[1-side].grave.some(c=>c.uid===event.defender.uid));assert.equal(event.defender.card.name,'Mystical Elf');assert.equal(battlePresentations(s,s).length,0);
    }finally{engine.destroyMatch(s);}
  }
});
test('an attack stopped by Mirror Force never receives a battle presentation',async()=>{
  const engine=createNativeBackend({rules:()=>rules});let s=await damageDuel(engine,cards,{traps:['Mirror Force']});try{
    s=command(engine,s,'ACTIVATE',0,'Mirror Force');s=advanceBattle(engine,s,x=>!x.pending&&!x.chain.length);
    assert.equal(battlePresentations(null,s).length,0);assert.ok(s.players[1].grave.some(c=>c.card.name==='Dark Magician'));
  }finally{engine.destroyMatch(s);}
});
test('native direct attacks carry an LP target rather than inventing a defender',async()=>{
  const engine=createNativeBackend({rules:()=>rules}),get=name=>cards.find(c=>c.name===name);let s=await engine.createMatch([0,1].map(()=>({name:'Direct attack',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards,first:1,seed:7,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Dark Magician')}]},{}]});try{
    s=command(engine,s,'END',1);s=command(engine,s,'NEXT',0);s=command(engine,s,'ATTACK',0);
    s=advanceBattle(engine,s,x=>x.log.some(l=>l.battleNotice));const event=battlePresentations(null,s)[0];assert.equal(event.defender,null);assert.equal(event.targetLP,8000);assert.equal(event.side,0);
  }finally{engine.destroyMatch(s);}
});
const card=(id,name)=>({id,name,card_images:[{image_url_small:`https://images.ygoprodeck.com/images/cards_small/${id}.jpg`}]});
const event=(side=0,defense=true,def=2000)=>({side,attacker:{uid:'attacker',card:card(1,'Attacker'),atk:1800},defender:{uid:'victim',card:card(2,'Victim'),atk:1200,def,defense},targetLP:8000});
function rig(){
  const window=new Window();window.document.body.innerHTML='<div id="root"></div>';const root=window.document.querySelector('#root'),calls=[];
  window.Element.prototype.animate=function(frames,options){let finish,reject;const finished=new Promise((yes,no)=>{finish=yes;reject=no;});const animation={node:this,frames,options,finish,finished,cancel:()=>reject(Error('Cancelled'))};calls.push(animation);return animation;};
  window.Element.prototype.getBoundingClientRect=function(){const side=this.closest('[data-side]')?.dataset.side;return {left:side==='1'?300:50,top:30,right:side==='1'?400:150,bottom:180,width:100,height:150};};
  const player=createBattlePlayer({getRoot:()=>root,timings:{enter:2,anticipate:2,strike:2,hold:5,exit:2}});
  return {window,root,calls,player,close(){player.cancel();window.close();}};
}
const tick=()=>new Promise(yes=>setTimeout(yes,5));
async function settle(r,predicate=()=>!r.player.active){for(let n=0;n<50&&!predicate();n++){for(const call of r.calls)call.finish();await tick();}assert.ok(predicate());}
test('combat always places human left and AI right; one sword travels from the actual attacker to its victim',async()=>{
  for(const side of [0,1]){const r=rig();try{
    const done=r.player.play([event(side)]),combatants=[...r.root.querySelectorAll('.duel-battle-combatant')];assert.deepEqual(combatants.map(c=>c.dataset.side),['0','1']);assert.equal(combatants[side].dataset.combatRole,'attacker');assert.equal(combatants[1-side].dataset.combatRole,'defender');
    assert.equal(combatants[side].querySelector('img').alt,'Attacker');assert.equal(combatants[1-side].querySelector('img').alt,'Victim');assert.equal(r.root.querySelectorAll('.duel-battle-sword').length,1);
    await settle(r,()=>r.calls.some(c=>c.node.className==='duel-battle-sword'));
    const strike=r.calls.find(c=>c.node.className==='duel-battle-sword'),x=frame=>Number(frame.transform.match(/translate\(([-\d.]+)px/)[1]);
    assert.ok(side===0?x(strike.frames[0])<x(strike.frames[2]):x(strike.frames[0])>x(strike.frames[2]));assert.ok(strike.frames.every(f=>f.transform.includes(`scaleX(${side===0?1:-1})`)));
    await settle(r);assert.equal(await done,true);assert.equal(r.root.children.length,0);
  }finally{r.close();}}
});
test('shield appears only for a Defense Position victim whose DEF exceeds the calculated ATK',async()=>{
  const r=rig();try{
    for(const [defense,def,expected] of [[true,2000,true],[true,1800,false],[true,1700,false],[false,3000,false]]){
      const done=r.player.play([event(0,defense,def)],{reduced:true});assert.equal(!!r.root.querySelector('.duel-battle-shield'),expected);assert.equal(r.root.firstElementChild.dataset.blocked,String(expected));await done;
    }
    const direct={...event(1),defender:null};const done=r.player.play([direct],{reduced:true});assert.equal(r.root.querySelector('[data-side="0"] .duel-battle-lp strong').textContent,'8,000');assert.equal(r.root.querySelector('.duel-battle-shield'),null);await done;
    const geometry=battleGeometry({left:0,top:0,width:80,height:120},{left:200,top:0,width:80,height:120},1);assert.equal(geometry.direction,-1);assert.deepEqual(geometry.from,{x:240,y:60});assert.deepEqual(geometry.to,{x:40,y:60});
  }finally{r.close();}
});
test('battle skip, resize cancellation, motion-off and missing animation support never block play',async()=>{
  const r=rig();try{
    let done=r.player.play([event()]);r.root.querySelector('button').click();assert.equal(await done,true);assert.equal(r.root.children.length,0);
    done=r.player.play([event()]);r.player.cancel();assert.equal(await done,false);assert.equal(r.root.children.length,0);
    assert.equal(await r.player.play([event()],{enabled:false}),true);assert.equal(r.calls.length,4);
    r.window.Element.prototype.animate=()=>{throw Error('Unsupported');};assert.equal(await r.player.play([event()]),true);assert.equal(r.root.children.length,0);
  }finally{r.close();}
});
