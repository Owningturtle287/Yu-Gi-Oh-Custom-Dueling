import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {attackGeometry,attackLinks,createAttackArrows} from '../src/duel/attack-arrows.js';

test('arrow geometry points upward for player attacks and downward for AI attacks, ending at the victim edge',()=>{
  const you={x:320,y:280,width:44,height:64},ai={x:90,y:50,width:44,height:64};
  const up=attackGeometry(you,ai),down=attackGeometry(ai,you);
  assert.ok(up.start.y<you.y&&up.end.y>ai.y&&up.end.y<up.start.y&&up.angle<0);
  assert.ok(down.start.y>ai.y&&down.end.y<you.y&&down.end.y>down.start.y&&down.angle>0);
  assert.ok(up.end.x>ai.x&&down.end.x<you.x);assert.equal(attackGeometry(you,you),null);
});
test('target arrows use only legal IDs, stay on the field, highlight focused targets, and clear on pause or cancel',()=>{
  const window=new Window();window.document.body.innerHTML='<main><div class="duel-table" data-rect="20,20,700,300"><button data-motion-uid="attacker" data-duel-card="attacker" data-rect="320,230,44,64"><span class="duel-card-visual"></span></button><button data-motion-uid="one" data-duel-card="one" data-rect="100,40,44,64"></button><button data-motion-uid="two" data-duel-card="two" data-rect="420,40,44,64"></button><div data-field-lp="1" data-rect="570,20,90,30"></div><svg class="duel-target-arrows"></svg></div></main>';
  window.Element.prototype.getBoundingClientRect=function(){const node=this.dataset.rect?this:this.parentElement,[left,top,width,height]=(node?.dataset.rect||'0,0,0,0').split(',').map(Number);return {left,top,width,height};};
  const root=window.document.querySelector('main'),arrows=createAttackArrows(root),state={pending:null};
  const selection={kind:'attack',sourceUid:'attacker',side:0,selected:[],actions:[{type:'CHOOSE',target:'one'},{type:'CHOOSE',target:'two'}]};
  try{
    arrows.sync(state,selection);let paths=[...root.querySelectorAll('.duel-arrow-shaft')];assert.equal(paths.length,2);assert.ok(paths.every(p=>p.dataset.source==='attacker'));assert.equal(root.querySelector('marker').getAttribute('orient'),'auto');
    for(const path of paths){const [x,y,tx,ty]=path.getAttribute('d').match(/-?[\d.]+/g).map(Number);assert.ok(ty<y);assert.ok(x!==tx);}
    root.querySelector('[data-duel-card="two"]').focus();assert.equal(root.querySelector('[data-target="two"]').dataset.selected,'true');
    assert.equal(root.querySelector('[data-target="one"]').dataset.selected,'false');
    arrows.sync(state,selection,{hidden:true});assert.equal(root.querySelectorAll('.duel-arrow-shaft').length,0);
    arrows.sync(state,null);assert.equal(root.querySelectorAll('.duel-arrow-shaft').length,0);
    state.pending={kind:'attack',uid:'attacker',target:null,side:0};arrows.sync(state,null);
    assert.equal(root.querySelector('.duel-arrow-shaft').dataset.target,'lp:1');
    assert.doesNotMatch(JSON.stringify(attackLinks(state,selection)),/card_images|"name"|"atk"|"def"/);
    state.pending=null;state.choice={attackUid:'one',side:1,selected:[],options:[{type:'CHOOSE',target:'attacker'}]};arrows.sync(state,null);
    const aiPath=root.querySelector('.duel-arrow-shaft'),[,startY,,endY]=aiPath.getAttribute('d').match(/-?[\d.]+/g).map(Number);
    assert.ok(endY>startY,'AI targeting previews point down toward the player');assert.equal(aiPath.getAttribute('stroke'),'#ffafc5');
  }finally{arrows.destroy();window.close();}
});
