import test from 'node:test';
import assert from 'node:assert/strict';
import {arenaGeometry,applyArenaGeometry} from '../src/duel/arena-layout.js';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';

test('four card rows, both hands and the phase rail fit landscape phones including safe-area reductions',()=>{
  for(const [w,h] of [[750,363],[844,390],[474,293],[568,320],[579,348],[667,375],[838,403],[932,430],[1024,768],[1366,768]]){
    const g=arenaGeometry(w,h);
    assert.ok(g.required<=g.fieldWidth,`${w}×${h}: piles, five columns and outer banished zones fit`);
    assert.ok(Math.abs(g.topSide+g.bottomSide+g.sideGap+8-h)<.01,`${w}×${h}: no vertical overflow or unused band`);
    assert.equal(g.board,g.slot*5+g.cellGap*4);assert.ok(g.pileGap>g.cellGap*3);
    assert.ok(g.cardWidth<g.bay);assert.ok(g.slot>=g.bay);assert.ok(g.cardHeight>=32);
    assert.ok(g.topHand>=16&&g.bottomHand>=52);assert.equal(g.sideGap,14,'The center divider has its own visible track');
    if(!g.compact){assert.equal(g.action,24);assert.ok(g.cardHeight>=56,'Stats and a 24px action fit beside the art');}
    else assert.equal(g.footer,16,'Compact stats have their own row, with actions in the card inspector');
  }
});
test('iPhone 14 field uses larger card surfaces and a tighter central rack than the stretched layout',()=>{
  const g=arenaGeometry(750,363);
  const oldPitch=((750-8-12)*5/7.5+6)/5;
  assert.equal(g.compact,false);assert.ok(g.cardHeight>60);assert.ok(g.slot+g.cellGap<oldPitch*.85);
  assert.ok(g.bay-(g.cardWidth)>4,'A rotated defender has clearance before the action gutter');
  assert.ok(g.phase<=44);
  assert.ok(g.cardHeight>63,'The clipped AI hand returns vertical room to the card art');assert.equal(g.rowGap,3);assert.ok(g.phase<=28);
});
test('the phase rail extends into the right safe area while preserving a camera-safe label column',()=>{
  for(const inset of [0,24,47,59]){
    const normal=arenaGeometry(750,363),edge=arenaGeometry(750+inset,363,{rightInset:inset});
    assert.equal(edge.phase,normal.phase+inset);assert.equal(edge.fieldWidth,normal.fieldWidth);assert.equal(edge.cardHeight,normal.cardHeight);
    assert.equal(edge.values['--phase-safe'],inset);assert.ok(edge.required<=edge.fieldWidth);
  }
});
test('phase rail, aligned piles, side gutters and compact metadata have explicit independent tracks',async()=>{
  const window=new Window();try{
    const source=await readFile(new URL('../duel.css',import.meta.url),'utf8');window.document.head.innerHTML=`<style>${source}</style>`;
    window.document.body.innerHTML='<div class="duel-table"><section class="duel-side player-side"><div class="duel-mat"><div class="duel-pile-zones"><div class="duel-grave-group"><article class="duel-zone-shell" data-pile-zone="grave"><div class="duel-zone-surface"></div></article><article class="duel-zone-shell" data-pile-zone="banished"><div class="duel-zone-surface"></div></article></div><article class="duel-zone-shell" data-pile-zone="deck"><div class="duel-zone-surface"></div></article></div><div class="duel-board"><div class="duel-zone-row"><article class="duel-zone-shell monster-slot"><div class="duel-zone-surface"><button class="duel-zone"><span class="duel-card-visual"></span></button></div><div class="duel-card-rail"><div class="duel-card-stats"><span><small>ATK</small><b>99999</b></span><span><small>DEF</small><b>99999</b></span></div><div class="duel-inline-actions"><button class="duel-quick-action">Effect</button></div></div></article></div></div></div></section><nav class="duel-phase-rail"><ol class="duel-phases"><li>M1</li></ol></nav></div>';
    const $=s=>window.document.querySelector(s),css=s=>window.getComputedStyle($(s)),table=$('.duel-table');applyArenaGeometry(table,750,363);
    assert.equal(css('.duel-phase-rail').gridColumn,'2');assert.equal(css('.duel-phases').gridTemplateColumns,'minmax(0,1fr)');assert.equal(css('.duel-phases').gridTemplateRows,'repeat(6,minmax(0,1fr))');
    assert.equal(css('.duel-grave-group').gridTemplateColumns,'minmax(0,1fr)');assert.equal(css('[data-pile-zone=grave]').gridColumn,'1');assert.equal(css('[data-pile-zone=banished]').position,'absolute');
    assert.equal(css('[data-pile-zone=grave] .duel-zone-surface').width,css('[data-pile-zone=deck] .duel-zone-surface').width);
    assert.equal(css('.duel-card-rail').gridColumn,'2');assert.equal(css('.duel-card-stats').position,'static');assert.equal(css('.duel-inline-actions').position,'static');assert.equal(css('.duel-quick-action').minHeight,'24px');
    assert.equal($('.duel-zone').querySelector('.duel-card-stats,.duel-inline-actions'),null);
    applyArenaGeometry(table,474,293);assert.equal(table.dataset.compactField,'true');
    // Happy DOM caches ancestor attribute selectors; recreate the styled
    // subtree to read the compact rules after changing the table's data flag.
    window.document.body.innerHTML=window.document.body.innerHTML;
    assert.equal(css('.duel-card-stats').gridRow,'2');assert.equal(css('.duel-inline-actions').display,'none');assert.equal(css('.duel-card-stats').height,'16px');
  }finally{window.close();}
});
