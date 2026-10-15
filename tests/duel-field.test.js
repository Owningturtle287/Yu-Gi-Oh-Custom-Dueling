import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createDeck } from '../src/core.js';
import * as legacyEngine from '../src/duel/engine.js';
const { createMatch }=legacyEngine;
import { ruleFor } from '../src/duel/catalog.js';
import { defaultSide } from '../src/duel/decks.js';
import { createSoloController } from '../src/duel/ui.js';
import { cardRotation, fieldLocation, makeFieldSelection, fieldCandidates, pickFieldCandidate, quickCardActions, activityCue, cardActivity } from '../src/duel/field.js';
import { planMotion, captureArena } from '../src/duel/motion.js';

const normals=Array.from({length:14},(_,index)=>({id:80000+index,name:`Warrior ${index}`,type:'Normal Monster',tcgDate:'2002-03-08',race:'Warrior',attribute:'EARTH',atk:1800,def:1200,level:4,desc:'A classic warrior.',card_images:[]}));
const monster=normals[0],mst={id:5318639,name:'Mystical Space Typhoon',type:'Spell Card',race:'Quick-Play',tcgDate:'2002-09-16',desc:'Target 1 Spell/Trap on the field; destroy that target.',card_images:[]};
const trap={...mst,id:44095762,name:'Mirror Force',type:'Trap Card',race:'Normal'};
const bug={...monster,id:54652250,name:'Man-Eater Bug',type:'Flip Effect Monster',race:'Insect',atk:450,def:600,desc:'FLIP: Target 1 monster on the field; destroy it.'};
const field={...mst,id:22702055,name:'Umi',race:'Field'};
const high={...monster,id:80099,name:'Tribute champion',level:7,atk:2600};
const game=()=>createMatch([{main:Array(40).fill(monster)},{main:Array(40).fill(monster)}],{seed:41});
let serial=0;
function put(state,side,card,zone='monsters',extra={}){
  const instance={uid:`field-test-${++serial}`,owner:side,controller:side,card,faceUp:true,position:'attack',summonedTurn:0,changedTurn:0,attacks:0,...extra};
  if(zone==='field')state.players[side].field=instance;
  else if(['monsters','spells'].includes(zone))state.players[side][zone][state.players[side][zone].indexOf(null)]=instance;
  else state.players[side][zone].push(instance);
  return instance;
}
test('opponent card orientation and all movement plans use the owner’s perspective',()=>{
  assert.equal(cardRotation(0,'attack'),0);assert.equal(cardRotation(0,'defense'),90);
  assert.equal(cardRotation(1,'attack'),180);assert.equal(cardRotation(1,'defense'),270);
  assert.equal(cardRotation(1,null,'hand'),180);
  const s=game(),next=structuredClone(s),card=next.players[1].hand.shift();next.players[1].monsters[0]={...card,faceUp:false,position:'defense'};
  const motion=planMotion(s,next).find(item=>item.uid===card.uid);assert.equal(motion.start.rotation,180);assert.equal(motion.end.rotation,270);
});
test('field target sessions expose exact legal IDs, keep face-down identities private, and choose LP directly',()=>{
  const s=game(),one=put(s,1,{...monster,name:'Hidden defender'},'monsters',{faceUp:false,position:'defense'}),two=put(s,1,monster);
  const actions=[{type:'ATTACK',uid:'attacker',target:one.uid},{type:'ATTACK',uid:'attacker',target:two.uid},{type:'ATTACK',uid:'attacker',target:null}];
  const session=makeFieldSelection(s,actions);assert.equal(fieldCandidates(session).uids.size,2);assert.equal(fieldCandidates(session).directSide,1);
  assert.equal(pickFieldCandidate(session,one.uid).actions[0].target,one.uid);
  assert.equal(pickFieldCandidate(session,null).actions[0].target,null);
  assert.equal(pickFieldCandidate(session,'not-legal'),null);assert.ok(!JSON.stringify(session).includes('Hidden defender'));
  assert.equal(fieldLocation(s,undefined),null);
});
test('Tribute selection supports compatible combinations and deselecting without committing',()=>{
  const s=game(),ids=Array.from({length:3},()=>put(s,0,monster).uid),actions=[[ids[0],ids[1]],[ids[0],ids[2]],[ids[1],ids[2]]].map(tributes=>({type:'SUMMON',uid:'boss',tributes,set:false}));
  const session=makeFieldSelection(s,actions),first=pickFieldCandidate(session,ids[0]);
  assert.equal(first.actions,null);assert.equal(fieldCandidates(first.session).remaining,1);assert.ok(fieldCandidates(first.session).selected.has(ids[0]));
  const reset=pickFieldCandidate(first.session,ids[0]);assert.equal(reset.session.selected.length,0);
  const chosen=pickFieldCandidate(first.session,ids[2]);assert.deepEqual(chosen.actions,[actions[1]]);
});
test('field targets stay selectable while off-field targets retain their picker',()=>{
  const s=game(),spell=put(s,1,trap,'spells',{faceUp:false}),card=put(s,1,monster),grave=put(s,0,monster,'grave');
  assert.ok(fieldCandidates(makeFieldSelection(s,[{type:'ACTIVATE',uid:'source',target:spell.uid}])).uids.has(spell.uid));
  assert.ok(fieldCandidates(makeFieldSelection(s,[{type:'CHOOSE',target:card.uid}])).uids.has(card.uid));
  assert.equal(makeFieldSelection(s,[{type:'ACTIVATE',uid:'reborn',target:grave.uid}]),null);
});
test('on-card shortcuts only reflect supplied legal actions and activity identifies sources and targets',()=>{
  const s=game(),source=put(s,0,monster),target=put(s,1,monster),actions=[{type:'ATTACK',uid:source.uid,target:target.uid},{type:'NEXT'}];
  assert.equal(quickCardActions(actions,source.uid)[0].label,'Attack');assert.deepEqual(quickCardActions(actions,target.uid),[]);
  s.pending={kind:'attack',uid:source.uid,target:target.uid,side:0};
  assert.equal(cardActivity(s,source.uid,null,null).role,'source');assert.equal(cardActivity(s,target.uid,null,null).role,'target');
  const cue=activityCue(s,s,actions[0]);assert.equal(cue.source,source.uid);
  const session=makeFieldSelection(s,actions.slice(0,1));assert.equal(cardActivity(s,target.uid,cue,session).role,'eligible');
});

async function waitFor(predicate){const end=Date.now()+3000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),'Duel did not reach the expected state');}
async function rig({width=1024,height=768}={}){
  const window=new Window({url:'https://example.com/repo/'});window.document.body.innerHTML='<main id="main"></main><dialog id="modal"></dialog>';
  window.happyDOM.setWindowSize({width,height});
  for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],configurable:true,writable:true});
  const deck=createDeck('Classic','classic');deck.sections.main=normals.map((card,index)=>({card,quantity:index===13?1:3}));
  window.localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({sides:[{...defaultSide(),source:'saved',deckId:'classic'},{...defaultSide(),source:'saved',deckId:'classic'}],first:'you',animations:false,aiSpeed:'fast'}));
  const main=window.document.querySelector('main'),modal=window.document.querySelector('dialog'),messages=[];
  const closeDialog=()=>modal.removeAttribute('open');
  const showDialog=(content,className='')=>{modal.innerHTML=`<div class="dialog-body ${className}">${content}</div>`;modal.setAttribute('open','');};
  const closeEvent=event=>{if(event.target.closest('[data-action="close"]'))closeDialog();};window.document.addEventListener('click',closeEvent);
  const controller=createSoloController({engine:legacyEngine,main,modal,getCards:()=>[...normals,mst,trap,bug,field,high],getDecks:()=>[deck],getStatus:()=>'ready',showDialog,dialogHeader:title=>`<h2>${title}</h2><button data-action="close">Close</button>`,closeDialog,toast:message=>messages.push(message),onDesign:()=>{},onKeepDeck:()=>{}});
  controller.enter();main.querySelector('[data-duel="start"]').click();
  await waitFor(()=>main.querySelector('.duel-arena')?.dataset.moving==='false'&&(height>width||controller.getMatch()?.phase==='main1'&&!controller.getMatch().window));
  return {window,main,modal,controller,messages,$:selector=>window.document.querySelector(selector),close(){controller.destroy();window.close();}};
}
test('Attack shortcut selects a highlighted Set monster on the board without a target list',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();s.turn=2;s.phase='battle';const attacker=put(s,0,monster),target=put(s,1,{...monster,name:'Secret defender'},'monsters',{faceUp:false,position:'defense'});put(s,1,monster);r.controller.refresh();
    r.$(`[data-duel-quick="${attacker.uid}"]`).click();assert.equal(r.modal.hasAttribute('open'),false);assert.equal(r.$('.duel-arena').dataset.selecting,'true');
    assert.equal(r.window.document.querySelectorAll('.opponent .duel-zone[data-role="eligible"]').length,2);
    assert.doesNotMatch(r.main.textContent,/Secret defender/);assert.match(r.$(`[data-duel-card="${target.uid}"]`).getAttribute('aria-label'),/Legal target.*face-down.*ATK \? DEF \?/);
    r.$(`[data-duel-card="${target.uid}"]`).click();assert.equal(r.controller.getMatch().pending.target,target.uid);
    assert.equal(r.$(`[data-duel-card="${attacker.uid}"]`).dataset.role,'source');assert.equal(r.$(`[data-duel-card="${target.uid}"]`).dataset.role,'target');
  }finally{r.close();}
});
test('direct attacks target the AI’s own bottom-left LP corner; card faces and stats are oriented separately',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();s.turn=2;s.phase='battle';const attacker=put(s,0,monster);r.controller.refresh();
    r.$(`[data-duel-quick="${attacker.uid}"]`).click();const lp=r.$('[data-field-lp="1"]');assert.equal(lp.dataset.role,'eligible');assert.ok(lp.closest('.opponent-side'));assert.ok(lp.closest('.duel-table'));
    assert.ok(r.$('[data-field-lp="0"]').closest('.player-side'));
    lp.click();assert.equal(r.controller.getMatch().pending.target,null);
    r.controller.getMatch().window=null;r.controller.getMatch().pending=null;const enemy=put(r.controller.getMatch(),1,monster,'monsters',{position:'defense'});r.controller.refresh();
    assert.equal(r.$(`[data-duel-card="${enemy.uid}"] .duel-card-visual`).style.getPropertyValue('--card-rotation'),'270deg');
    assert.match(r.$(`[data-duel-card="${enemy.uid}"]`).closest('.duel-zone-shell').querySelector('.duel-card-stats').textContent,/ATK1800DEF1200/);
  }finally{r.close();}
});
test('Effect shortcut highlights Spell/Trap and Field targets while both rows remain available',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),spell=put(s,0,mst,'hand'),target=put(s,1,trap,'spells',{faceUp:false,setTurn:0}),fieldCard=put(s,1,field,'field'),invalid=put(s,1,monster);
    r.controller.refresh();r.$(`[data-duel-quick="${spell.uid}"]`).click();
    assert.equal(r.$('[data-duel-layer]'),null);assert.equal(r.$(`[data-duel-card="${target.uid}"]`).dataset.role,'eligible');assert.equal(r.$(`[data-duel-card="${fieldCard.uid}"]`).dataset.role,'eligible');
    r.$(`[data-duel-card="${invalid.uid}"]`).click();assert.equal(r.$('.duel-arena').dataset.selecting,'true');assert.equal(r.controller.getMatch().chain.length,0);
    r.$(`[data-duel-card="${target.uid}"]`).click();assert.equal(r.controller.getMatch().chain[0].action.target,target.uid);assert.equal(r.modal.hasAttribute('open'),false);
  }finally{r.close();}
});
test('a Tribute Summon chooses compatible monsters directly and pays the selected costs once',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),boss=put(s,0,high,'hand'),one=put(s,0,monster),two=put(s,0,monster),three=put(s,0,monster);r.controller.refresh();
    r.$(`[data-duel-card="${boss.uid}"]`).click();[...r.modal.querySelectorAll('[data-duel-group]')].find(button=>button.textContent==='Tribute Summon…').click();
    assert.equal(r.modal.hasAttribute('open'),false);r.$(`[data-duel-card="${one.uid}"]`).click();assert.equal(r.$(`[data-duel-card="${one.uid}"]`).dataset.role,'selected');
    r.$(`[data-duel-card="${three.uid}"]`).click();const next=r.controller.getMatch();assert.ok(next.players[0].grave.some(c=>c.uid===one.uid));assert.ok(next.players[0].grave.some(c=>c.uid===three.uid));
    assert.ok(next.players[0].monsters.some(c=>c?.uid===two.uid));assert.ok(next.players[0].monsters.some(c=>c?.uid===boss.uid));
  }finally{r.close();}
});
test('on-card shortcuts enable again after actions and AI response movement settle',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),first=put(s,0,mst,'hand'),second=put(s,0,mst,'hand'),target=put(s,1,trap,'spells',{faceUp:false,setTurn:0});
    r.controller.refresh();r.$(`[data-duel-quick="${first.uid}"]`).click();r.$(`[data-duel-card="${target.uid}"]`).click();
    await waitFor(()=>r.controller.getMatch().window?.priority===0&&r.$('.duel-arena').dataset.moving==='false');
    const shortcut=r.$(`[data-duel-quick="${second.uid}"]`);assert.ok(shortcut);assert.equal(shortcut.disabled,false);
    shortcut.click();assert.equal(r.$('.duel-arena').dataset.selecting,'true');assert.equal(r.$(`[data-duel-card="${target.uid}"]`).dataset.role,'eligible');
  }finally{r.close();}
});
test('mandatory effect targets appear on the board automatically and cannot be cancelled away',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),source=put(s,0,bug),target=put(s,1,monster);
    s.choice={side:0,title:'Man-Eater Bug: choose a target',trigger:{side:0,uid:source.uid,card:bug,rule:ruleFor(bug)},options:[{type:'CHOOSE',target:source.uid},{type:'CHOOSE',target:target.uid}]};r.controller.refresh();
    assert.equal(r.$('.duel-arena').dataset.selecting,'true');assert.equal(r.$('[data-duel="cancel-target"]'),null);
    r.$(`[data-duel-card="${target.uid}"]`).click();assert.equal(r.controller.getMatch().choice,null);assert.ok(r.controller.getMatch().players[1].grave.some(c=>c.uid===target.uid));
  }finally{r.close();}
});
test('the landscape arena reserves portrait card surfaces and keeps both rows visible without a layer switch',async()=>{
  const css=await readFile(new URL('../duel.css',import.meta.url),'utf8');
  assert.match(css,/\.duel-hand-shell:first-child, \.duel-opponent-card:first-child \{[^}]*margin-inline-start:auto/);
  assert.match(css,/\.duel-zone-surface \{[^}]*aspect-ratio:59\/78/);
  assert.match(css,/100cqh - var\(--slot-footer\)\) \* \.756/);
  assert.match(css,/\.duel-status-row \.duel-prompt \{[^}]*font-size:12px/);
  assert.match(css,/data-role=eligible/);assert.match(css,/\.duel-hud/);
  assert.doesNotMatch(css,/data-field-layer|duel-layer-switch|duel-field-tabs/);
});
function rotate(r,width,height){
  r.window.happyDOM.setWindowSize({width,height});
  r.window.dispatchEvent(new r.window.Event('resize'));
}
test('starting in portrait pauses opening phases and rotation resumes the same match without an extra draw',async()=>{
  const r=await rig({width:390,height:844});try{
    const initial=r.controller.getMatch(),frozen=JSON.stringify(initial);
    assert.equal(r.$('.duel-orientation').hidden,false);assert.equal(r.$('.duel-arena').hidden,true);
    assert.equal(r.$('.duel-arena').hasAttribute('inert'),true);assert.ok(r.window.document.documentElement.classList.contains('duel-playing'));
    r.$('[data-duel="next"]').click();await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(JSON.stringify(r.controller.getMatch()),frozen,'Portrait must not execute a hidden action or opening timer');
    rotate(r,844,390);
    await waitFor(()=>r.controller.getMatch().phase==='main1'&&!r.controller.getMatch().window&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.$('.duel-orientation').hidden,true);assert.equal(r.$('.duel-arena').hidden,false);
    assert.equal(r.controller.getMatch().players[0].hand.length,5);assert.equal(r.controller.getMatch().players[0].deck.length,35);
    rotate(r,390,844);rotate(r,844,390);
    assert.equal(r.controller.getMatch().players[0].hand.length,5,'Repeated rotation cannot replay a draw');
    r.controller.leave();assert.equal(r.window.document.documentElement.classList.contains('duel-playing'),false);
    r.controller.enter();assert.ok(r.window.document.documentElement.classList.contains('duel-playing'));assert.equal(r.controller.getMatch().turn,1);
  }finally{r.close();}
});
test('rotation cancels a pending AI decision and resumes it only after landscape returns',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();s.active=1;s.turn=2;s.phase='main1';r.controller.refresh();
    rotate(r,390,844);const frozen=JSON.stringify(r.controller.getMatch());
    await new Promise(resolve=>setTimeout(resolve,260));assert.equal(JSON.stringify(r.controller.getMatch()),frozen);
    rotate(r,844,390);await waitFor(()=>JSON.stringify(r.controller.getMatch())!==frozen);
    assert.equal(r.$('.duel-arena').hidden,false);
  }finally{r.close();}
});
test('rotation closes card inspection and keeps an unfinished field choice without losing legal targets',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();s.turn=2;s.phase='battle';const attacker=put(s,0,monster),target=put(s,1,monster);r.controller.refresh();
    r.$(`[data-duel-quick="${attacker.uid}"]`).click();r.$('[data-duel="inspect-source"]').click();assert.ok(r.$('.duel-card-viewer'));assert.equal(r.modal.hasAttribute('open'),true);
    rotate(r,390,844);assert.equal(r.modal.hasAttribute('open'),false);assert.equal(r.$('.duel-arena').dataset.selecting,'true');
    rotate(r,844,390);assert.equal(r.$(`[data-duel-card="${target.uid}"]`).dataset.role,'eligible');
    r.$(`[data-duel-card="${target.uid}"]`).click();assert.equal(r.controller.getMatch().pending.target,target.uid);
  }finally{r.close();}
});
test('all twenty zones and both rows keep their grid display across landscape phone sizes',async()=>{
  const r=await rig();try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    for(const [width,height] of [[568,320],[667,375],[844,390],[932,430],[1024,768]]){
      rotate(r,width,height);
      assert.equal(r.$('.duel-arena').hidden,false,`${width}×${height}`);
      assert.equal(r.main.querySelectorAll('.duel-board .duel-zone').length,20);
      assert.equal(r.main.querySelectorAll('[data-pile-zone]').length,10);
      for(const board of r.main.querySelectorAll('.duel-board')){
        const computed=r.window.getComputedStyle(board);assert.equal(computed.display,'grid',`${width}×${height}: both board containers must use grid`);
        assert.equal(computed.gridTemplateRows,'repeat(2,minmax(0,1fr))');assert.equal(computed.gridColumn,'2');assert.equal(computed.gridRow,'1');
      }
      for(const row of r.main.querySelectorAll('.monster-zones, .backrow-zones'))assert.equal(r.window.getComputedStyle(row).display,'grid',`${width}×${height}: each row is present`);
      assert.equal(r.main.querySelectorAll('.duel-table .duel-life').length,2);
      assert.equal(r.main.querySelectorAll('.duel-hud .duel-life').length,0);
      assert.equal(r.main.querySelector('[data-duel-layer]'),null);
    }
  }finally{r.close();}
});
test('the game mats oppose vertically and mirror auxiliary and pile positions for each duelist',async()=>{
  const r=await rig();try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    const computed=selector=>r.window.getComputedStyle(r.$(selector));
    assert.equal(computed('.opponent-side').gridRow,'1');assert.equal(computed('.player-side').gridRow,'3');
    for(const [prefix,leftColumn,rightColumn,auxAreas,pileAreas] of [['.player-side','1','3','"field" "extra"','"grave" "deck"'],['.opponent-side','3','1','"extra" "field"','"deck" "grave"']]){
      assert.equal(computed(prefix+' .duel-auxiliary-zones').gridColumn,leftColumn);
      assert.equal(computed(prefix+' .duel-pile-zones').gridColumn,rightColumn);
      assert.equal(computed(prefix+' .duel-auxiliary-zones').gridTemplateAreas,auxAreas);
      assert.equal(computed(prefix+' .duel-pile-zones').gridTemplateAreas,pileAreas);
      assert.equal(r.main.querySelectorAll(prefix+' [data-pile-zone]').length,5);
    }
    assert.deepEqual([...r.main.querySelectorAll('.opponent .monster-zones .duel-zone')].map(node=>node.dataset.motionZone),[4,3,2,1,0].map(index=>'1:monsters:'+index));
    assert.deepEqual([...r.main.querySelectorAll('.yours .monster-zones .duel-zone')].map(node=>node.dataset.motionZone),[0,1,2,3,4].map(index=>'0:monsters:'+index));
    assert.equal(r.$('.duel-console').contains(r.$('.duel-hand')),false);
    assert.equal(r.$('.duel-table').contains(r.$('.duel-hand')),true);
    assert.ok(r.$('.duel-hand').closest('.player-side'));assert.ok(r.$('.duel-opponent-hand').closest('.opponent-side'));
    assert.equal(computed('.duel-hand-area').gridRow,'2');assert.equal(computed('.duel-opponent-hand').gridRow,'1');
    assert.equal(computed('.opponent-side .duel-mat').gridRow,'2');
    assert.equal(computed('.opponent-side').gridTemplateRows,'clamp(44px,11dvh,60px) minmax(0,1fr)');
    assert.equal(r.$('.duel-center-line').contains(r.$('.duel-phases')),true);
    assert.equal(r.$('.duel-console').contains(r.$('.duel-phases')),false);
  }finally{r.close();}
});
test('separate Deck, Graveyard and Extra Deck zones open the correct pile and preserve private contents',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),old=put(s,0,{...monster,name:'First fallen'},'grave'),recent=put(s,0,{...monster,name:'Latest fallen'},'grave');
    put(s,0,{...monster,name:'Known Fusion',type:'Fusion Monster'},'extra');
    const secret=put(s,1,{...monster,name:'Private AI Fusion',type:'Fusion Monster',card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/12345678.jpg'}]},'extra');
    r.controller.refresh();
    assert.doesNotMatch(r.main.innerHTML,/Private AI Fusion|12345678.jpg/);
    const grave=r.$('[data-motion-zone="0:grave"]');assert.equal(grave.dataset.motionUid,recent.uid);assert.equal(grave.querySelector('.duel-pile-count').textContent,'2');grave.click();
    assert.match(r.modal.querySelector('h2').textContent,/Your Graveyard/);
    assert.deepEqual([...r.modal.querySelectorAll('.duel-public-card')].map(node=>node.dataset.duelCard),[old.uid,recent.uid]);
    assert.equal(r.modal.querySelector('.duel-pile-tabs'),null);assert.equal(r.modal.querySelector('[data-duel-pile]'),null);
    r.$('[data-motion-zone="0:extra"]').click();assert.match(r.modal.textContent,/Known Fusion/);assert.doesNotMatch(r.modal.textContent,/First fallen/);
    r.$('[data-motion-zone="1:extra"]').click();assert.match(r.modal.textContent,/AI’s Extra Deck stays face-down/);
    assert.doesNotMatch(r.modal.innerHTML,new RegExp(secret.card.name+'|12345678.jpg'));assert.equal(r.modal.querySelectorAll('.duel-public-card').length,0);
    r.$('[data-motion-zone="0:deck"]').click();assert.match(r.modal.querySelector('h2').textContent,/Your Deck/);assert.equal(r.modal.querySelectorAll('.duel-public-card').length,0);
  }finally{r.close();}
});
test('draw, Graveyard, Extra Deck and Field Spell movement anchors are the on-mat zones',async()=>{
  const r=await rig();try{
    const anchors=['deck','grave','extra','field','banished'];
    for(const side of [0,1])for(const [index,zone] of anchors.entries()){
      const node=r.$(`[data-motion-zone="${side}:${zone}"]`);assert.ok(node.closest(`[data-field-side="${side}"]`));
      node.getBoundingClientRect=()=>({left:40+index*60,top:side?30:210,width:40,height:60});
    }
    const snapshot=captureArena(r.main);
    for(const side of [0,1])for(const [index,zone] of anchors.entries())assert.deepEqual(snapshot.zones.get(`${side}:${zone}`),{x:60+index*60,y:side?60:240,width:40,height:60});
  }finally{r.close();}
});
test('resolved card movement updates the actual Graveyard stack and its public pile view',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),source=put(s,0,mst,'hand'),target=put(s,1,trap,'spells',{faceUp:false,setTurn:0});
    r.controller.refresh();r.$(`[data-duel-quick="${source.uid}"]`).click();r.$(`[data-duel-card="${target.uid}"]`).click();
    await waitFor(()=>r.controller.getMatch().players[0].grave.some(card=>card.uid===source.uid)&&r.$('.duel-arena').dataset.moving==='false');
    const grave=r.$('[data-motion-zone="0:grave"]');assert.equal(grave.dataset.motionUid,source.uid);assert.equal(grave.querySelector('.duel-pile-count').textContent,'1');
    assert.equal(r.$('[data-motion-zone="1:grave"]').dataset.motionUid,target.uid);
    grave.click();assert.match(r.modal.textContent,/Mystical Space Typhoon/);
  }finally{r.close();}
});
test('zone captions are absent while accessible names and occupied monster stats remain',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),card=put(s,0,monster);r.controller.refresh();
    assert.equal(r.main.querySelector('.duel-slot-label'),null);assert.doesNotMatch(r.$('.duel-table').textContent,/SPELL \/ TRAP|Field Spell|Extra Deck|Graveyard/);
    assert.match(r.$('[data-motion-zone="0:monsters:1"]').getAttribute('aria-label'),/Monster Zone/);
    assert.match(r.$('[data-motion-zone="0:spells:0"]').getAttribute('aria-label'),/Spell \/ Trap Zone/);
    assert.match(r.$('[data-motion-zone="0:banished"]').getAttribute('aria-label'),/Your Banished/);
    const slot=r.$(`[data-duel-card="${card.uid}"]`).closest('.duel-zone-shell');assert.ok(slot.classList.contains('has-stats'));
    assert.match(slot.querySelector('.duel-card-stats').textContent,/ATK1800DEF1200/);
    assert.equal(r.$('[data-motion-zone="0:spells:0"]').closest('.duel-zone-shell').classList.contains('has-stats'),false);
  }finally{r.close();}
});
test('Banished zones flank each Graveyard and update after an actual banishing effect',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();put(s,0,{...monster,name:'Banisher of the Light',type:'Effect Monster'});
    const source=put(s,0,mst,'hand'),target=put(s,1,trap,'spells',{faceUp:false,setTurn:0});
    r.controller.refresh();
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    for(const side of [0,1]){
      const grave=r.$(`[data-motion-zone="${side}:grave"]`).closest('.duel-grave-group'),banished=r.$(`[data-motion-zone="${side}:banished"]`);
      assert.equal(banished.closest('.duel-grave-group'),grave);
      assert.equal(r.window.getComputedStyle(banished.closest('[data-pile-zone]')).gridColumn,side?'1':'2');
      for(const pile of grave.children)assert.equal(r.window.getComputedStyle(pile).gridRow,'1','Mirrored columns must share a row instead of auto-placing the second pile below');
    }
    r.$(`[data-duel-quick="${source.uid}"]`).click();r.$(`[data-duel-card="${target.uid}"]`).click();
    await waitFor(()=>r.controller.getMatch().players[0].banished.some(card=>card.uid===source.uid)&&r.$('.duel-arena').dataset.moving==='false');
    for(const [side,uid] of [[0,source.uid],[1,target.uid]]){
      const tile=r.$(`[data-motion-zone="${side}:banished"]`);assert.equal(tile.dataset.motionUid,uid);assert.equal(tile.querySelector('.duel-pile-count').textContent,'1');
      assert.equal(r.controller.getMatch().players[side].grave.length,0);
    }
    r.$('[data-motion-zone="0:banished"]').click();assert.match(r.modal.querySelector('h2').textContent,/Your Banished/);assert.match(r.modal.textContent,/Mystical Space Typhoon/);
  }finally{r.close();}
});
test('hand inspection shows art and readable description together above actions, and plays a Summon',async()=>{
  const r=await rig();try{
    const uid=r.controller.getMatch().players[0].hand[0].uid,name=r.controller.getMatch().players[0].hand[0].card.name;
    r.$(`[data-duel-card="${uid}"]`).click();assert.equal(r.modal.hasAttribute('open'),true);
    assert.equal(r.modal.querySelector('h2').textContent,name);assert.equal(r.$('.duel-card-reader'),null);
    assert.equal(r.main.querySelector('.duel-selected-card'),null);assert.ok(r.$('.duel-terminal'));
    const art=r.$('.duel-inspect-art').firstChild;
    assert.match(r.$('.duel-inspect-description').textContent,/classic warrior/);
    assert.equal(r.$('.duel-inspect-description').getAttribute('tabindex'),'0');
    assert.ok(r.$('.duel-inspect-description').compareDocumentPosition(r.$('.duel-card-actions'))&4);
    assert.equal(r.$('[data-duel="read-card"]'),null);assert.equal(r.$('[data-duel="close-card"]'),null);
    assert.equal(r.$('.duel-inspect-art').firstChild,art);
    [...r.modal.querySelectorAll('[data-duel-group]')].find(button=>button.textContent==='Normal Summon').click();
    assert.ok(r.controller.getMatch().players[0].monsters.some(card=>card?.uid===uid));assert.equal(r.modal.hasAttribute('open'),false);
  }finally{r.close();}
});
test('reading a centered card pauses AI and closing it resumes the pending decision',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch();s.active=1;s.turn=2;s.phase='main1';r.controller.refresh();
    r.$('.duel-hand-card').click();const frozen=JSON.stringify(r.controller.getMatch());
    await new Promise(resolve=>setTimeout(resolve,260));assert.equal(JSON.stringify(r.controller.getMatch()),frozen);
    r.$('[data-action="close"]').click();await waitFor(()=>JSON.stringify(r.controller.getMatch())!==frozen);
  }finally{r.close();}
});
test('card inspection clears when a public AI card moves to its hidden hand',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),secret=put(s,1,{...monster,name:'Formerly public rival',card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/12345678.jpg'}]});
    r.controller.refresh();r.$(`[data-duel-card="${secret.uid}"]`).click();assert.match(r.modal.textContent,/Formerly public rival/);
    s.players[1].monsters[0]=null;s.players[1].hand.push(secret);r.controller.refresh();
    assert.equal(r.modal.hasAttribute('open'),false);assert.doesNotMatch(r.main.innerHTML,/Formerly public rival|12345678.jpg/);
    assert.ok(r.$(`.duel-opponent-hand [data-motion-uid="${secret.uid}"] .card-back-image`));
  }finally{r.close();}
});
test('off-field choices retain exact actions when the arena refreshes behind the picker',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),source=put(s,0,{...mst,name:'Monster Reborn',race:'Normal'},'hand'),first=put(s,0,monster,'grave'),second=put(s,0,normals[1],'grave');
    r.controller.refresh();r.$(`[data-duel-card="${source.uid}"]`).click();
    [...r.modal.querySelectorAll('[data-duel-group]')].find(button=>button.textContent==='Activate card…').click();
    assert.equal(r.modal.querySelectorAll('[data-duel-choice]').length,2);r.controller.refresh();
    r.modal.querySelector('[data-duel-choice="1"]').click();
    await waitFor(()=>r.controller.getMatch().players[0].monsters.some(card=>card?.uid===second.uid)&&r.$('.duel-arena').dataset.moving==='false');
    assert.ok(r.controller.getMatch().players[0].grave.some(card=>card.uid===first.uid));
  }finally{r.close();}
});

test('phase changes preserve every unchanged field, hand, pile image and the terminal scroll node',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),shown=put(s,0,{...monster,card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/123.jpg'}]}),set=put(s,1,monster,'monsters',{faceUp:false,position:'defense'});
    r.controller.refresh();
    const image=r.$(`[data-duel-card="${shown.uid}"] img`),back=r.$(`[data-duel-card="${set.uid}"] img`),hand=r.$('.duel-hand-card'),pile=r.$('[data-motion-zone="0:deck"] img'),terminal=r.$('[data-live-terminal]');
    let sourceWrites=0;const observer=new r.window.MutationObserver(records=>{sourceWrites+=records.filter(record=>record.attributeName==='src').length;});observer.observe(image,{attributes:true});
    r.$('[data-duel="next"]').click();
    await waitFor(()=>r.controller.getMatch().phase==='main2'&&!r.controller.getMatch().window&&r.$('.duel-arena').dataset.moving==='false');
    assert.equal(r.$(`[data-duel-card="${shown.uid}"] img`),image);assert.equal(r.$(`[data-duel-card="${set.uid}"] img`),back);
    assert.equal(r.$('.duel-hand-card'),hand);assert.equal(r.$('[data-motion-zone="0:deck"] img'),pile);assert.equal(r.$('[data-live-terminal]'),terminal);
    assert.equal(sourceWrites,0);assert.equal(image.getAttribute('loading'),'eager');observer.disconnect();
    assert.equal(r.$('.duel-phases [aria-current]').textContent,'M2Main 2');
  }finally{r.close();}
});
test('inspection immediately uses the field thumbnail; closing by the dialog close event resumes AI',async()=>{
  const r=await rig();try{
    const s=r.controller.getMatch(),card=put(s,0,{...monster,card_images:[{image_url:'https://images.ygoprodeck.com/images/cards/123.jpg',image_url_small:'https://images.ygoprodeck.com/images/cards_small/123.jpg'}]},'hand');
    s.active=1;s.turn=2;s.phase='main1';r.controller.refresh();r.$(`[data-duel-card="${card.uid}"]`).click();
    assert.equal(r.$('.duel-inspect-art img').getAttribute('src'),card.card.card_images[0].image_url_small);
    assert.equal(r.$('.duel-card-typing').textContent,'Warrior / Normal');
    const frozen=JSON.stringify(r.controller.getMatch());r.modal.removeAttribute('open');r.modal.dispatchEvent(new r.window.Event('close'));
    await waitFor(()=>JSON.stringify(r.controller.getMatch())!==frozen);
  }finally{r.close();}
});
test('terminal presentation is scrollable with a large effect reader and smaller noninteractive LP',async()=>{
  const r=await rig();try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    const computed=selector=>r.window.getComputedStyle(r.$(selector));
    assert.equal(computed('.duel-terminal-scroll').overflowY,'auto');assert.equal(computed('.duel-terminal-scroll').overflowX,'hidden');
    assert.equal(r.$('[data-live-terminal]').getAttribute('aria-live'),'off');assert.equal(r.$('[data-terminal-announcement]').getAttribute('aria-live'),'polite');
    assert.equal(computed('.duel-life').minHeight,'32px');
    r.$('.duel-hand-card').click();
    assert.equal(computed('.duel-inspect-description').fontSize,'14px');assert.equal(computed('.duel-inspect-description').overflowY,'auto');
    assert.ok(r.$('.duel-inspect-description').closest('.duel-card-viewer'));
  }finally{r.close();}
});

test('expanded mats, bounded stats, and POV life corners hold at phone and tablet sizes',async()=>{
  const r=await rig();try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    const s=r.controller.getMatch();put(s,0,{...monster,atk:99999,def:99999});put(s,0,monster);put(s,1,monster);put(s,1,monster);r.controller.refresh();
    for(const [width,height] of [[568,320],[667,375],[844,390],[932,430],[1024,768]]){
      rotate(r,width,height);
      for(const side of r.main.querySelectorAll('.duel-side')){
        assert.equal(r.window.getComputedStyle(side).position,'relative');
        assert.equal(r.window.getComputedStyle(side.querySelector('.duel-mat')).width,'100%','Mats must use the full available field width');
      }
      for(const bar of r.main.querySelectorAll('.duel-card-stats')){
        const css=r.window.getComputedStyle(bar);assert.equal(css.gridTemplateColumns,'repeat(2,minmax(0,1fr))');assert.equal(css.width,'100%');assert.equal(css.overflow,'hidden');assert.equal(css.contain,'paint');
        assert.equal(bar.querySelectorAll('small').length,2);assert.equal(parseFloat(r.window.getComputedStyle(bar.querySelector('span')).minWidth),0);
      }
      const yours=r.window.getComputedStyle(r.$('.player-life')),foe=r.window.getComputedStyle(r.$('.opponent-life'));
      assert.equal(yours.left,'4px');assert.equal(yours.bottom,'2px');assert.equal(foe.right,'4px');assert.equal(foe.top,'2px');
      assert.equal(r.main.querySelectorAll('.duel-board .duel-zone').length,20);
    }
    assert.match(r.$('.yours .duel-card-stats').textContent,/99999/);
  }finally{r.close();}
});
test('compact card and pile sheets retain visible full typing, small buttons and safe-area margins',async()=>{
  const r=await rig({width:844,height:390});try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    const s=r.controller.getMatch(),beast=put(s,0,{...monster,name:'Mystic Horseman',race:'Beast'},'hand');r.controller.refresh();
    r.$(`[data-duel-card="${beast.uid}"]`).click();
    assert.equal(r.$('.duel-card-typing').textContent,'Beast / Normal');
    assert.equal(r.window.getComputedStyle(r.modal).width,'580px');
    assert.equal(r.$('[data-duel="read-card"]'),null);assert.equal(r.$('[data-duel="close-card"]'),null);
    rotate(r,568,320);r.$(`[data-duel-card="${beast.uid}"]`).click();
    assert.notEqual(r.window.getComputedStyle(r.$('.duel-inspect-meta')).display,'none','Typing must remain visible on short phones');
    r.$('[data-action="close"]').click();r.$('[data-motion-zone="0:grave"]').click();
    assert.equal(r.window.getComputedStyle(r.modal).width,'340px');assert.equal(r.modal.querySelectorAll('.duel-pile-tabs, [data-duel-pile]').length,0);assert.match(r.modal.textContent,/Graveyard is empty/);
    const css=style.textContent;assert.match(css,/max-width:calc\(100vw - env\(safe-area-inset-left\) - env\(safe-area-inset-right\) - 36px\)/);
    assert.match(css,/backdrop-filter:blur\(1px\)/);
  }finally{r.close();}
});
