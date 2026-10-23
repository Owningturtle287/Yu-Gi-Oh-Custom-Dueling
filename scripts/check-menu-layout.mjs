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
 async function fittedShell(){
  const fit=await page.locator('.app-shell').evaluate(shell=>{const r=shell.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,logicalWidth:shell.clientWidth,logicalHeight:shell.clientHeight,viewportWidth:innerWidth,viewportHeight:innerHeight};});
  for(const [actual,expected] of [[fit.left,0],[fit.top,0],[fit.width,fit.viewportWidth],[fit.height,fit.viewportHeight],[fit.logicalWidth,Math.max(fit.viewportWidth,fit.viewportHeight)],[fit.logicalHeight,Math.min(fit.viewportWidth,fit.viewportHeight)]])assert.ok(Math.abs(actual-expected)<2,JSON.stringify(fit));
 }
 async function capture(name){await page.screenshot({path:`${output}/${name}.png`});}
 for(const [width,height] of [[844,390],[667,375],[568,320],[740,360],[390,844],[320,568],[1280,720],[1024,768]]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});page=await context.newPage();
  await page.route('**/db.ygoprodeck.com/api/**',route=>route.fulfill({json:route.request().url().includes('cardsets.php')?[{set_name:'Layout test set',tcg_date:'2003-01-01'}]:{data:cards}}));
  await page.route('**/images.ygoprodeck.com/**',route=>route.abort());
  await page.addInitScript(()=>localStorage.setItem('duel-atlas.solo-config.v1',JSON.stringify({animations:false,aiSpeed:'deliberate',first:'you'})));
  // Delay the app module: orientation and scale must already fit on first paint.
  let release;const bootGate=new Promise(resolve=>release=resolve);
  await page.route('**/src/app.js',route=>bootGate.then(()=>route.continue()));
  await page.goto(origin,{waitUntil:'commit'});await page.waitForFunction(()=>document.querySelector('.app-shell')&&getComputedStyle(document.querySelector('.app-shell')).position==='fixed');
  await fittedShell();release();await page.waitForFunction(()=>document.querySelector('.home-status')?.textContent.includes('cards'));await fittedShell();
  await page.setViewportSize({width:height,height:width});await fittedShell();
  await page.setViewportSize({width,height});await fittedShell();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await fittedShell();
  await visibleControls('.home button,.bottom-nav button,#app-menu');await capture(`home-${width}x${height}`);
  await page.locator('.bottom-nav [data-route="archive"]').click();
  await page.locator('.archive-screen .card-tile').first().waitFor();await fittedShell();
  assert.equal(await page.locator('.topbar').isVisible(),false,'Archive removes the app header');
  await visibleControls('.archive-toolbar button,#card-search,.result-meta button');
  assert.ok(await page.locator('#archive-panel').evaluate(e=>e.clientHeight/Math.min(innerWidth,innerHeight)>.65),'Archive dedicates most of the screen height to cards');
  assert.ok(await page.locator('.archive-screen .quick-add').first().evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=24&&r.height<=24;}),'Archive quantity buttons match the builder');
  assert.ok(await page.locator('.archive-screen .card-inspect').first().evaluate(n=>n.querySelector('img,.image-fallback').getBoundingClientRect().height/n.getBoundingClientRect().height>.75),'Archive tiles prioritize card art');
  const completeArchiveCards=await page.locator('#archive-panel').evaluate(panel=>{const p=panel.getBoundingClientRect();return [...panel.querySelectorAll('.card-tile')].filter(n=>{const r=n.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom+1;}).length;});
  assert.ok(completeArchiveCards>=6,`Archive shows at least six complete cards at ${width}x${height}`);
  await capture(`archive-${width}x${height}`);
  await page.locator('.archive-menu').click();await visibleControls('.menu-body button');await page.locator('.dialog-header [data-action="close"]').click();
  await page.locator('#archive-panel').evaluate(n=>n.scrollTop=n.scrollHeight/2);
  await page.waitForFunction(()=>{const p=document.querySelector('#archive-panel'),r=p.getBoundingClientRect();return [...p.querySelectorAll('.quick-add')].some(n=>{const b=n.getBoundingClientRect();return b.top>r.top&&b.bottom<r.bottom;});});
  const target=await page.locator('#archive-panel').evaluate(p=>{const r=p.getBoundingClientRect();const add=[...p.querySelectorAll('.quick-add:not(:disabled)')].find(n=>{const b=n.getBoundingClientRect();return b.top>r.top&&b.bottom<r.bottom;});return {id:add.dataset.quickAdd,scroll:p.scrollTop};});
  await page.locator(`.archive-screen [data-quick-add="${target.id}"]`).click();
  assert.ok(Math.abs(await page.locator('#archive-panel').evaluate(n=>n.scrollTop)-target.scroll)<2,'Archive add retains scroll');
  await page.locator(`.archive-screen [data-quick-remove="${target.id}"]`).click();
  assert.ok(Math.abs(await page.locator('#archive-panel').evaluate(n=>n.scrollTop)-target.scroll)<2,'Archive remove retains scroll');
  await page.locator('[data-category="Spell"]').click();
  assert.equal(await page.locator('.card-tile:not([data-kind="spell"])').count(),0);
  await page.locator('[data-category="All"]').click();
  await page.locator('#card-search').fill('Mystical Elf');await page.locator('.card-inspect').click();
  await page.locator('.effect-text').waitFor();await page.locator('.dialog-header [data-action="close"]').click();await page.locator('[data-action="clear-search"]').click();
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js'),{createDeck,addCard}=await import('/src/core.js');
   let deck=createDeck('Workshop check','layout-deck');for(const card of state.cards.filter(c=>/Monster|Spell Card|Trap Card/.test(c.type)&&!/Fusion|Synchro|Xyz|Link/.test(c.type)).slice(0,14))deck=addCard(deck,card);
   state.draft=deck;navigate('decks');
  });
  await page.locator('.builder-panels .card-tile').first().waitFor();
  await fittedShell();assert.equal(await page.locator('.topbar').isVisible(),false,'Builder removes the app header');
  await visibleControls('.deck-switch-row button,.deck-switch-row select,.builder-panel-heading button,.deck-tabs button,#deck-query,.builder-archive-panel .search-row button,#card-search');
  assert.ok(await page.locator('.builder-deck-panel .deck-tray').evaluate(e=>e.clientHeight>140),'Deck has room for card tiles');
  assert.ok(await page.locator('#archive-panel').evaluate(e=>e.clientHeight>180),'Archive uses the recovered header space');
  assert.ok(await page.locator('.builder-deck-panel .copy-count').first().evaluate(e=>e.getBoundingClientRect().width<30),'Quantity badges stay small');
  assert.ok(await page.locator('.deck-screen .quick-add').first().evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=24&&r.height<=24;}),'Quantity buttons stay compact');
  for(const [panel,items] of [['.deck-tray','.tray-card'],['#archive-panel','.card-tile']]){
   const full=await page.locator(panel).evaluate((node,items)=>{const p=node.getBoundingClientRect();return [...node.querySelectorAll(items)].filter(c=>{const r=c.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom+1;}).length;},items);
   assert.ok(full>=3,`${panel} shows at least three complete cards at ${width}x${height}`);
  }
  assert.ok(await page.locator('.deck-inspect').first().evaluate(node=>{const art=node.querySelector('img,.image-fallback');return art.getBoundingClientRect().height/node.getBoundingClientRect().height>.75;}),'Most of each tile is card artwork');
  await capture(`builder-${width}x${height}`);
  await page.locator('[data-action="deck-options"]').click();assert.ok(await page.locator('#modal').evaluate(n=>n.clientWidth>=Math.min(480,Math.max(innerWidth,innerHeight)-24)-4),'Shared menus use the landscape width');await visibleControls('.menu-body button');await page.locator('[data-action="app-info"]').click();await visibleControls('.menu-body button');await page.locator('.dialog-header [data-action="close"]').click();
  const query=page.locator('#card-search');await query.fill('Mystical Elf');
  await page.locator('.builder-archive-panel [data-quick-add]').first().click();
  assert.equal(await query.inputValue(),'Mystical Elf');assert.ok(await page.locator('.builder-deck-panel .tray-card').count());
  await page.evaluate(async()=>{const {navigate}=await import('/src/app.js');navigate('solo');});await visibleControls('.solo-setup button,.solo-setup select');
  for(const source of ['saved','set','cards']){
   await page.locator('#solo-source').selectOption(source);
   if(source==='set')await page.waitForFunction(()=>document.querySelector('#solo-set')?.textContent.includes('Layout test set'));
   await visibleControls('.solo-setup button,.solo-setup select');
  }
  for(const tab of [1,2,3,0]){await page.locator(`[data-duel-tab="${tab}"]`).click();await visibleControls('.solo-setup button,.solo-setup select,.solo-setup input');}
  await capture(`setup-${width}x${height}`);
  if([844,390,568,320].includes(width)){
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
    await page.locator('[data-duel="duel-menu"]').click();await page.locator('.duel-menu-body').waitFor();
    await visibleControls('.duel-menu-body button,.duel-menu-body select');await capture(`pause-${width}x${height}`);
    await page.locator('.duel-menu-body .primary[data-action="close"]').click();
    await page.evaluate(()=>window.layoutRig.destroy());
   }
  }
  // A real Big Eye prompt: five visible rows, stable reads, actual native order.
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');
   const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');
   const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend(),names=['Mystical Elf','Summoned Skull','Dark Magician','Blue-Eyes White Dragon','Man-Eater Bug','Big Eye'];
   let match=await engine.createMatch([0,1].map(()=>({name:'Order check',main:Array.from({length:40},(_,i)=>get(names[i%names.length])),extra:[]})),{cards:catalog,seed:17,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Big Eye'),defense:true,faceUp:false}]},{}]});
   match=engine.applyAction(match,match.actions[0].find(a=>a.type==='FLIP'||a.type==='POSITION'),0);
   for(let n=0;n<30&&match.choice?.selectionType!=='sort_card';n++){const side=match.actions[0].length?0:1;match=engine.applyAction(match,match.actions[side].find(a=>a.number===5)||match.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(match,side),side);}
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');let launches=0;
   const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async(...args)=>launches++?engine.createMatch(...args):match}});
   controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-order-picker').waitFor();await visibleControls('.duel-order-picker button');
  assert.equal(await page.locator('[data-order-index]').count(),5);
  await page.locator('[data-order-index]').last().locator('[data-order-direction="-1"]').click();
  const order=await page.locator('[data-order-index]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.orderIndex)));
  for(const selector of ['[data-duel="read-choice-source"]','[data-order-read]']){
   await page.locator(selector).first().click();await visibleControls('.duel-selection-info button');
   assert.ok(await page.locator('.selection-info-copy .effect-text').evaluate(e=>e.clientHeight>40));
   if(selector.includes('source'))await capture(`effect-reader-${width}x${height}`);
   await page.locator('[data-duel="selection-back"]').click();
   assert.deepEqual(await page.locator('[data-order-index]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.orderIndex))),order);
  }
  await visibleControls('.duel-order-picker button');await capture(`reorder-${width}x${height}`);
  const expected=await page.evaluate(order=>order.map(i=>window.layoutRig.getMatch().choice.ordering.cards.find(c=>c.index===i).card.id),order);
  await page.locator('[data-duel="order-confirm"]').click();await page.waitForFunction(()=>!window.layoutRig.getMatch().choice);
  assert.deepEqual(await page.evaluate(()=>window.layoutRig.getMatch().players[0].deck.slice(-5).reverse().map(c=>c.card.id)),expected);
  await page.locator('[data-duel="duel-menu"]').click();await page.locator('[data-duel="surrender"]').click();await page.locator('[data-duel="confirm-surrender"]').click();
  await page.locator('.duel-arena[data-moving="false"] [data-duel="rematch"]').click();
  await page.waitForFunction(()=>window.layoutRig.getMatch()?.winner===null&&document.querySelector('.duel-arena')?.dataset.moving==='false');
  assert.equal(await page.locator('.solo-setup').count(),0);assert.equal(await page.locator('.duel-hand-card').count(),5);
  await page.evaluate(()=>window.layoutRig.destroy());
  await context.close();page=null;
  console.log(`Menu controls fit ${width} × ${height}`);
 }
} catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await browser?.close();server.kill();}
