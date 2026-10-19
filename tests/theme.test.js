import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
const styles=(await Promise.all(['styles.css','duel.css','light.css'].map(name=>readFile(new URL('../'+name,import.meta.url),'utf8')))).join('\n');
const luminance=hex=>{const rgb=hex.match(/[a-f0-9]{2}/gi).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('light menus and colored action buttons remain readable and the full-screen field share a light palette',()=>{
  const window=new Window();try{
    window.document.head.innerHTML='<style>'+styles+'</style>';
    window.document.body.innerHTML='<div class="duel-session"><div class="duel-table"></div></div><dialog id="modal"><div class="dialog-body duel-menu-body"><header class="dialog-header"><h2>Duel settings</h2></header><div class="duel-menu-footer"><button data-duel="exit-duel">Exit duel</button></div></div></dialog>';
    const css=node=>window.getComputedStyle(node),$=selector=>window.document.querySelector(selector);
    assert.equal(css(window.document.documentElement).colorScheme,'light');assert.equal(css($('.duel-session')).colorScheme,'light');
    assert.equal(css($('.duel-session')).getPropertyValue('--text'),'#284b3f');assert.equal(css($('.dialog-body')).color,'#1d394c');
    assert.match(css($('.duel-menu-footer button')).backgroundImage,/linear-gradient/);
    assert.ok(contrast('#ffffff','#267c6e')>=4.5);assert.ok(contrast('#ffffff','#145b53')>=4.5);
    for(const tone of ['blue','teal','gold','danger','violet']){
      const button=window.document.createElement('button');button.dataset.choiceTone=tone;$('.dialog-body').append(button);
      const style=css(button),foreground=style.getPropertyValue('--choice-accent'),background=style.getPropertyValue('--choice-bg');
      assert.ok(contrast(foreground,background)>=4.5,`${tone} must meet normal-text contrast`);
    }
    for(const [width,height] of [[320,568],[390,844],[568,320],[844,390],[1024,768]]){
      window.happyDOM.setWindowSize({width,height});
      assert.equal(css($('.duel-table')).position,'relative');assert.equal(css($('.duel-session')).overflow,'hidden');
    }
  }finally{window.close();}
});
