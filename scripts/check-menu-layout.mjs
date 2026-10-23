// Real Chromium checks for controls clipped by the viewport or a menu panel.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:4175',output='ui-checks';
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'4175'},stdio:'pipe'});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Preview server exited: '+code)));});
await mkdir(output,{recursive:true});
let browser,page;
try{
 browser=await chromium.launch({headless:true});
 const raw=[...JSON.parse(await readFile('tests/rules-fixtures.json')).data,...JSON.parse(await readFile('tests/audit-fixtures.json')).data];
 const cards=[...new Map(raw.map(c=>[c.id,{...c,card_sets:[{set_name:'Layout test set'}]}])).values()];
 async function visibleControls(selector){
  const clipped=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').flatMap(node=>{
   const rect=node.getBoundingClientRect(),pad=1.5;
   if(rect.width<1||rect.height<1)return ['Zero size: '+node.outerHTML.slice(0,100)];
   if(rect.left < -pad||rect.top < -pad||rect.right>innerWidth+pad||rect.bottom>innerHeight+pad)return ['Outside viewport: '+node.textContent.trim()];
   for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const css=getComputedStyle(parent);if(!/(hidden|clip|auto|scroll)/.test(css.overflowX+' '+css.overflowY))continue;
    const bounds=parent.getBoundingClientRect();
    if(rect.left<bounds.left-pad||rect.right>bounds.right+pad||rect.top<bounds.top-pad||rect.bottom>bounds.bottom+pad)return ['Clipped in '+parent.className+': '+node.textContent.trim()];
   }
   return [];
  }));
  assert.deepEqual(clipped,[],`All ${selector} controls must be visible`);
 }
 async function capture(name){await page.screenshot({path:`${output}/${name}.png`});}
 for(const [width,height] of [[844,390],[667,375],[568,320],[740,360],[390,844],[320,568],[1280,720],[1024,768]]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});page=await context.newPage();
  await page.route('**/db.ygoprodeck.com/api/**',route=>route.fulfill({json:route.request().url().includes('cardsets.php')?[{set_name:'Layout test set',tcg_date:'2003-01-01'}]:{data:cards}}));
  await page.route('**/images.ygoprodeck.com/**',route=>route.abort());
  await page.addInitScript(()=>localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,aiSpeed:'deliberate',first:'you'})));
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('.home-status')?.textContent.includes('cards'));
  assert.equal(await page.locator('html').getAttribute('data-app-rotated'),String(height>width));
  await visibleControls('.home button,.bottom-nav button,#app-menu');await capture(`home-${width}x${height}`);
  await page.locator('.solo-launch-card').click();await visibleControls('.solo-setup button,.solo-setup select');
  for(const source of ['saved','set','cards']){
   await page.locator('#solo-source').selectOption(source);
   if(source==='set')await page.waitForFunction(()=>document.querySelector('#solo-set')?.textContent.includes('Layout test set'));
   await visibleControls('.solo-setup button,.solo-setup select');
  }
  for(const tab of [1,2,3,0]){await page.locator(`[data-duel-tab="${tab}"]`).click();await visibleControls('.solo-setup button,.solo-setup select,.solo-setup input');}
  await capture(`setup-${width}x${height}`);
  if(width===844||width===390){
   // Mount the production controller at a genuine native Type/Attribute prompt.
   for(const card of ['DNA Surgery','DNA Transplant']){
    await page.evaluate(async card=>{
     const {navigate,state}=await import('/src/app.js');navigate('home');
     const e=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');
     const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=e.createNativeBackend();
     let match=await engine.createMatch([0,1].map(()=>({name:'Layout test',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:27,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Mystical Elf')}],spells:[{card:get(card),faceUp:false}]},{}]});
     match=engine.applyAction(match,match.actions[0].find(a=>a.type==='ACTIVATE'),0);
     const main=document.querySelector('#main'),modal=document.querySelector('#modal');
     const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});
     controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
    },card);
    await page.locator('.duel-declaration-picker').waitFor();
    const count=await page.locator('.duel-declaration').count();assert.ok(count>=6);
    assert.equal(await page.locator('.duel-declaration svg').count(),count);
    await visibleControls('.duel-choice-footer button');
    const list=page.locator('#duel-options-list');
    if(card==='DNA Surgery')assert.ok(await list.evaluate(e=>e.scrollHeight>e.clientHeight),'Types must have a real scroll range');
    await page.locator('.duel-declaration').last().scrollIntoViewIfNeeded();await page.locator('.duel-declaration').last().click();
    await page.locator('.duel-choice-footer button[data-choice-tone="teal"]:enabled').waitFor();
    await visibleControls('.duel-choice-footer button');await capture(`${card.replaceAll(' ','-')}-${width}x${height}`);
    await page.locator('.duel-choice-footer button[data-choice-tone="teal"]').click();await page.waitForFunction(()=>!window.layoutRig.getMatch().choice);
    await page.evaluate(()=>window.layoutRig.destroy());
   }
  }
  await context.close();page=null;
  console.log(`Menu controls fit ${width} × ${height}`);
 }
} catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await browser?.close();server.kill();}
