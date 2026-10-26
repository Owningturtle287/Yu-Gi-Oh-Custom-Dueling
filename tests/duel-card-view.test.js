import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { cardTypeLabel, cardArtURLs, sharpenCardArt } from '../src/duel/card-view.js';

const card = { type:'Normal Monster', race:'Beast', card_images:[{image_url_small:'https://images.ygoprodeck.com/images/cards_small/123.jpg',image_url:'https://images.ygoprodeck.com/images/cards/123.jpg'}] };
function rig() {
  const window = new Window({url:'https://example.com/'}), document = window.document;
  document.body.innerHTML = `<div class="duel-inspect-art"><img src="${card.card_images[0].image_url_small}"></div>`;
  const container = document.querySelector('div');
  let upgrade, resolveDecode;
  const ready = new Promise(resolve => { resolveDecode = resolve; });
  return {window,document,container,resolveDecode,
    start(options = {}) { return sharpenCardArt(container,card,{...options,createImage:()=>{upgrade=document.createElement('img');upgrade.decode=()=>ready;return upgrade;}}); },
    get upgrade() { return upgrade; }, close() { window.close(); }};
}
test('card typing includes monster race, all subtypes, and Spell/Trap classification',()=>{
  assert.equal(cardTypeLabel(card),'Beast / Normal');
  assert.equal(cardTypeLabel({...card,race:'Insect',type:'Flip Effect Monster'}),'Insect / Flip / Effect');
  assert.equal(cardTypeLabel({...card,race:'Dragon',type:'Fusion Effect Monster'}),'Dragon / Fusion / Effect');
  assert.equal(cardTypeLabel({type:'Spell Card',race:'Quick-Play'}),'Spell / Quick-Play');
  assert.equal(cardTypeLabel({type:'Trap Card',race:'Counter'}),'Trap / Counter');
});
test('inspection keeps the thumbnail visible through a delayed full-art load and decode',async()=>{
  const r=rig();try{
    const preview=r.container.firstChild;r.start();
    assert.equal(preview.getAttribute('src'),card.card_images[0].image_url_small);assert.equal(preview.decoding,'sync');
    assert.equal(r.container.children.length,1);assert.equal(r.upgrade.src,card.card_images[0].image_url);
    const loading=r.upgrade.onload();await Promise.resolve();
    assert.equal(r.container.children.length,1,'Full art must decode before it can cover the preview');
    r.resolveDecode();await loading;
    assert.equal(r.container.children.length,1);assert.equal(r.container.firstChild,r.upgrade);assert.equal(preview.isConnected,false,'A decoded upgrade replaces the preview, including in flex readers');
  }finally{r.close();}
});
test('failed art upgrades and closing during decode preserve the preview and never mutate another popup',async()=>{
  const r=rig();try{
    const preview=r.container.firstChild;const cancel=r.start();r.upgrade.onerror();assert.equal(r.container.firstChild,preview);
    const loading=r.upgrade.onload();cancel();r.resolveDecode();await loading;
    assert.equal(r.container.children.length,1);assert.equal(r.container.firstChild,preview);
    assert.equal(r.upgrade.onload,null);assert.equal(r.upgrade.onerror,null);
  }finally{r.close();}
});
test('already decoded field art is reused and malformed or missing API URLs never trigger an upgrade',()=>{
  const r=rig();try{
    const source=r.document.createElement('img');source.src=card.card_images[0].image_url_small;
    Object.defineProperty(source,'complete',{value:true});Object.defineProperty(source,'naturalWidth',{value:168});
    r.start({source});assert.notEqual(r.container.firstChild,source);assert.equal(r.container.firstChild.getAttribute('src'),source.getAttribute('src'));
    assert.deepEqual(cardArtURLs({card_images:[{image_url_small:'javascript:alert(1)',image_url:'https://other.example/card.jpg'}]}),{preview:'',full:''});
    let created=false;sharpenCardArt(r.container,{}, {createImage:()=>{created=true;}});assert.equal(created,false);
  }finally{r.close();}
});
