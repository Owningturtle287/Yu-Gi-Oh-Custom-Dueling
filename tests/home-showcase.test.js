import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createShowcase} from '../src/home-showcase.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(reduced=false){
 const window=new Window(),images=[],timers=new Map();let serial=0;
 const root=window.document.createElement('div');window.document.body.append(root);root.innerHTML='<img class="showcase-image"><img class="showcase-image"><span class="showcase-name"></span><span class="showcase-type"></span><button data-showcase-pause></button><button data-showcase-next></button>';
 const clock={setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}};
 class ImageClass{constructor(){images.push(this);}decode(){return this.ready??Promise.resolve();}}
 const media={matches:reduced,addEventListener(){},removeEventListener(){}};
 const controller=createShowcase(root,{ImageClass,clock,media});
 return {window,root,images,timers,controller};
}
test('gallery keeps current art until the next image decodes, skips missing art, and cleans up after navigation',async()=>{
 const t=setup();try{
  const {root,images,controller,timers}=t;images[0].onload();await tick();assert.equal(root.dataset.card,'blue-eyes');assert.equal(timers.size,1);
  const advancing=controller.next();images[1].onerror();await tick();assert.equal(root.dataset.card,'blue-eyes');assert.equal(images.length,3);
  let decode;images[2].ready=new Promise(resolve=>decode=resolve);images[2].onload();await tick();assert.equal(root.dataset.card,'blue-eyes');decode();await advancing;assert.equal(root.dataset.card,'stardust');assert.equal(root.querySelectorAll('.is-visible').length,1);
  const pending=controller.next();controller.destroy();images[3].onload();await pending;assert.equal(root.dataset.card,'stardust');assert.equal(timers.size,0);
 }finally{t.controller.destroy();t.window.close();}
});
test('reduced motion starts paused but manual artwork changes remain available',async()=>{
 const t=setup(true);try{t.images[0].onload();await tick();assert.equal(t.root.dataset.paused,'true');assert.equal(t.timers.size,0);const p=t.controller.next();t.images[1].onload();await p;assert.equal(t.root.dataset.card,'dark-magician');assert.equal(t.timers.size,0);}finally{t.controller.destroy();t.window.close();}
});
test('an unavailable gallery retains its fallback without repeated requests',async()=>{
 const t=setup();try{for(let i=0;i<6;i++){t.images[i].onerror();await tick();}assert.equal(t.root.classList.contains('has-art'),false);assert.equal(t.root.querySelector('[data-showcase-next]').disabled,true);assert.equal(t.timers.size,0);}finally{t.controller.destroy();t.window.close();}
});
