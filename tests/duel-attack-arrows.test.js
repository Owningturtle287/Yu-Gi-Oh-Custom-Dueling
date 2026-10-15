import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {attackGeometry,attackLinks,createAttackArrows} from '../src/duel/attack-arrows.js';

test('arrow geometry points upward for player attacks and downward for AI attacks, ending at the victim edge',()=>{
  const you={x:320,y:280,width:44,height:64},ai={x:90,y:50,width:44,height:64};
  const up=attackGeometry(you,ai),down=attackGeometry(ai,you);
  assert.ok(up.start.y<you.y&&up.end.y>ai.y&&up.end.y<up.start.y&&up.angle<0);
  assert.ok(down.start.y>ai.y&&down.end.y<you.y&&down.end.y>down.start.y&&down.angle>0);
  assert.ok(up.end.x>ai.x&&down.end.x<you.x);assert.equal(attackGeometry(you,you),null);
});
function rig(){
  const window=new Window();window.document.body.innerHTML='<main><div class="duel-table" data-rect="20,20,700,300"><button data-motion-uid="attacker" data-duel-card="attacker" data-rect="320,230,44,64"><span class="duel-card-visual"></span></button><button data-motion-uid="one" data-duel-card="one" data-rect="100,40,44,64"></button><button data-motion-uid="two" data-duel-card="two" data-rect="420,40,44,64"></button><div data-field-lp="1" data-rect="570,20,90,30"></div><svg class="duel-target-arrows" data-rect="22,22,696,296"></svg></div></main>';
  window.Element.prototype.getBoundingClientRect=function(){const node=this.dataset.rect?this:this.parentElement,[left,top,width,height]=(node?.dataset.rect||'0,0,0,0').split(',').map(Number);return {left,top,width,height};};
  const root=window.document.querySelector('main'),arrows=createAttackArrows(root);
  return {window,root,arrows,close(){arrows.destroy();window.close();}};
}
test('one arrow follows the selected legal target; hovering, canceling and ending a duel cannot leave extra arrows',()=>{
  const r=rig(),{root,arrows}=r,state={pending:null,winner:null};
  const selection={kind:'attack',sourceUid:'attacker',side:0,selected:[],actions:[{type:'CHOOSE',target:'one'},{type:'CHOOSE',target:'two'}]};
  const paths=()=>[...root.querySelectorAll('.duel-arrow-shaft')];
  try{
    arrows.sync(state,selection);assert.equal(paths().length,0,'Eligible targets do not each get an arrow');
    root.querySelector('[data-duel-card="two"]').focus();root.querySelector('[data-duel-card="one"]').dispatchEvent(new r.window.Event('pointerover',{bubbles:true}));
    assert.equal(paths().length,0,'Focus and hover do not select a target');
    for(const target of ['one','two','one']){
      selection.selected=[target];arrows.sync(state,selection);
      assert.equal(paths().length,1);assert.equal(paths()[0].dataset.target,target);assert.equal(paths()[0].dataset.source,'attacker');
      assert.equal(root.querySelectorAll('marker').length,1);assert.equal(root.querySelector('marker').getAttribute('orient'),'auto');
      assert.match(paths()[0].getAttribute('stroke'),/^url\(#attack-head-/);assert.equal(paths()[0].dataset.selected,'true');
    }
    selection.selected=['not-legal'];arrows.sync(state,selection);assert.equal(paths().length,0);
    selection.selected=['one'];arrows.sync(state,selection,{hidden:true});assert.equal(paths().length,0);
    arrows.sync(state,null);assert.equal(paths().length,0);
    state.pending={kind:'attack',uid:'attacker',target:null,side:0};arrows.sync(state,null);
    assert.equal(paths().length,1);assert.equal(paths()[0].dataset.target,'lp:1');
    assert.doesNotMatch(JSON.stringify(attackLinks(state,selection)),/card_images|"name"|"atk"|"def"/);
    state.pending=null;state.choice={attackUid:'one',side:1,selected:[],options:[{type:'CHOOSE',target:'attacker'}]};arrows.sync(state,null);
    assert.equal(paths().length,0);state.choice.selected=['attacker'];arrows.sync(state,null);
    const [,startY,,endY]=paths()[0].getAttribute('d').match(/-?[\d.]+/g).map(Number);
    assert.ok(endY>startY,'AI targeting points down toward the player');assert.equal(paths()[0].dataset.side,'1');
    assert.equal(root.querySelector('linearGradient stop:last-child').getAttribute('stop-color'),'#ffd0e0');
    state.winner=0;arrows.sync(state,null);assert.equal(paths().length,0);
  }finally{r.close();}
});
test('arrow coordinates use the SVG viewport despite safe-area offsets, field borders and scaled phone layouts',async()=>{
  const r=rig(),{root,arrows}=r;
  try{
    const style=r.window.document.createElement('style');style.textContent=await readFile(new URL('../duel.css',import.meta.url),'utf8');r.window.document.head.append(style);
    assert.equal(r.window.getComputedStyle(root.querySelector('.duel-table')).position,'relative','Absolute SVG must be anchored to the field rather than the console');
    for(const [left,top,scale] of [[47,5,.8],[12,19,1],[30,8,1.2]]){
      const svg=root.querySelector('svg');svg.dataset.rect=`${left},${top},${600*scale},${300*scale}`;
      const source={x:320*scale,y:240*scale,width:44*scale,height:64*scale},target={x:100*scale,y:60*scale,width:44*scale,height:64*scale};
      for(const [uid,rect] of [['attacker',source],['one',target]])root.querySelector(`[data-motion-uid="${uid}"]`).dataset.rect=`${left+rect.x-rect.width/2},${top+rect.y-rect.height/2},${rect.width},${rect.height}`;
      arrows.sync({pending:{kind:'attack',uid:'attacker',target:'one',side:0}},null);
      const actual=root.querySelector('.duel-arrow-shaft').getAttribute('d').match(/-?[\d.]+/g).map(Number),expected=attackGeometry(source,target);
      [expected.start.x,expected.start.y,expected.end.x,expected.end.y].forEach((value,index)=>assert.ok(Math.abs(actual[index]-value)<.0001));
      assert.equal(svg.getAttribute('viewBox'),`0 0 ${600*scale} ${300*scale}`);
      arrows.refresh();assert.equal(root.querySelectorAll('.duel-arrow-shaft').length,1,'Refresh replaces the previous path');
    }
  }finally{r.close();}
});
