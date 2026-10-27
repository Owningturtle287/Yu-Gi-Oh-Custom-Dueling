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
 const raw=[...JSON.parse(await readFile('tests/mechanics-audit-fixtures.json')).data,...JSON.parse(await readFile('tests/rules-fixtures.json')).data,...JSON.parse(await readFile('tests/audit-fixtures.json')).data,...JSON.parse(await readFile('tests/level-up-fixtures.json')).data,...JSON.parse(await readFile('tests/era2006-fixtures.json')).data.filter(c=>['Alien Grey','Clock Tower Prison','Cyber Dragon','Elemental HERO Neos'].includes(c.name))];
 const cards=[...new Map(raw.map(c=>[c.id,{...c,card_sets:[{set_name:'Layout test set'}]}])).values()];
 async function visibleControls(selector){
  const clipped=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').flatMap(node=>{
   const rect=node.getBoundingClientRect(),pad=1.5;
   if(rect.width<1||rect.height<1)return ['Zero size: '+node.outerHTML.slice(0,100)];
   if(rect.left < -pad||rect.top < -pad||rect.right>innerWidth+pad||rect.bottom>innerHeight+pad)return ['Outside viewport: '+node.textContent.trim()+' '+JSON.stringify({x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewport:[innerWidth,innerHeight]})];
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
  await page.waitForFunction(()=>{const p=document.querySelector('#archive-panel'),r=p.getBoundingClientRect();return [...p.querySelectorAll('.quick-add:not(:disabled)')].some(n=>{const b=n.getBoundingClientRect();return b.left>r.left&&b.right<r.right&&b.top>r.top&&b.bottom<r.bottom;});});
  const target=await page.locator('#archive-panel').evaluate(p=>{const r=p.getBoundingClientRect();const add=[...p.querySelectorAll('.quick-add:not(:disabled)')].find(n=>{const b=n.getBoundingClientRect();return b.left>r.left&&b.right<r.right&&b.top>r.top&&b.bottom<r.bottom;});return {id:add.dataset.quickAdd,scroll:p.scrollTop};});
  await page.locator(`.archive-screen [data-quick-add="${target.id}"]`).click();
  assert.ok(Math.abs(await page.locator('#archive-panel').evaluate(n=>n.scrollTop)-target.scroll)<2,'Archive add retains scroll');
  await page.locator(`.archive-screen [data-quick-remove="${target.id}"]`).click();
  assert.ok(Math.abs(await page.locator('#archive-panel').evaluate(n=>n.scrollTop)-target.scroll)<2,'Archive remove retains scroll');
  await page.locator('[data-category="Spell"]').click();
  assert.equal(await page.locator('.card-tile:not([data-kind="spell"])').count(),0);
  await page.locator('[data-category="All"]').click();
  await page.route('**/images.ygoprodeck.com/images/cards/*.jpg',async route=>route.fulfill({body:await readFile('assets/card-back.jpg'),contentType:'image/jpeg'}));
  await page.locator('#card-search').fill('Mystical Elf');await page.locator('.card-inspect').click();
  await visibleControls('.detail-body button,.detail-body select,.detail-body summary,.detail-body .card-battle-stats');
  assert.ok(await page.locator('.detail-top .card-art-frame').evaluate(n=>n.clientHeight/n.closest('.detail-body').clientHeight>.65),'Card art uses most of the reader height');
  assert.ok(await page.locator('.card-art-frame').evaluate(n=>{const stats=n.nextElementSibling;return !!stats?.classList.contains('card-battle-stats')&&n.parentElement.querySelectorAll('.card-battle-stats').length===1;}),'ATK and DEF sit below the art');
  assert.match(await page.locator('.card-publication').textContent(),/TCG.*\d{4}-\d{2}-\d{2}/);assert.match(await page.locator('.card-set-details').textContent(),/Layout test set/);
  await page.locator('.card-set-details summary').click();await visibleControls('.card-set-details ul');await capture(`archive-card-reader-${width}x${height}`);
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
  const taxonomyFields=['attribute','race','subtype','mechanic','spellTrapType'];
  await page.locator('[data-action="filters"]').click();
  const taxonomy=await page.locator('#filters-form').evaluate((form,fields)=>Object.fromEntries(fields.map(key=>[key,[...form.querySelector(`[name="${key}"]`).options].map(o=>({value:o.value,label:o.textContent}))])),taxonomyFields);
  assert.ok(taxonomy.subtype.some(o=>o.value==='Effect'));assert.ok(taxonomy.attribute.some(o=>o.value==='DIVINE'));
  await visibleControls('#filters-form select,#filters-form button');await capture(`builder-filters-${width}x${height}`);
  await page.locator('[data-filter-panel="year"]').click();await visibleControls('#filters-form select,#filters-form button');await capture(`builder-year-filters-${width}x${height}`);await page.locator('#release-start-year').selectOption('2006');await page.locator('#release-year').selectOption('2006');await capture(`exact-year-filters-${width}x${height}`);await page.locator('#filters-form button[type="submit"]').click();
  assert.ok(await page.evaluate(async()=>{const {state}=await import('/src/app.js');return state.filtered.length>0&&state.filtered.every(c=>c.tcgDate?.startsWith('2006'));}));
  await page.locator('[data-action="filters"]').click();await page.locator('[data-filter-panel="year"]').click();assert.equal(await page.locator('#release-start-year').inputValue(),'2006');assert.equal(await page.locator('#release-year').inputValue(),'2006');await page.locator('[data-action="reset-filters"]').click();await page.locator('[data-action="filters"]').click();
  await page.locator('#filters-form [name="subtype"]').selectOption('Effect');await page.locator('#filters-form button[type="submit"]').click();
  assert.ok(await page.locator('.builder-archive-panel .card-tile').count());
  assert.ok(await page.evaluate(async()=>{const {state}=await import('/src/app.js');const {isEffectMonster}=await import('/src/card-filters.js');return state.filtered.every(isEffectMonster);}));
  await page.locator('[data-action="filters"]').click();await page.locator('[data-action="reset-filters"]').click();
  const query=page.locator('#card-search');await query.fill('Mystical Elf');
  await page.locator('.builder-archive-panel [data-quick-add]').first().click();
  assert.equal(await query.inputValue(),'Mystical Elf');assert.ok(await page.locator('.builder-deck-panel .tray-card').count());
  await page.evaluate(async()=>{const {navigate}=await import('/src/app.js');navigate('solo');});await visibleControls('.solo-setup button,.solo-setup select');
  for(const source of ['saved','set','cards']){
   await page.locator('#solo-source').selectOption(source);
   if(source==='set'){await page.waitForFunction(()=>document.querySelector('#solo-set')?.textContent.includes('Layout test set (2003)'));assert.equal(await page.locator('#solo-set option').filter({hasText:'Layout test set (2003)'}).getAttribute('value'),'Layout test set');await page.locator('#solo-set').selectOption('Layout test set');assert.equal(await page.locator('#solo-set').inputValue(),'Layout test set');assert.equal(await page.locator('.solo-set-year').textContent(),'2003');await visibleControls('.solo-set-year');await capture(`released-set-${width}x${height}`);}
   await visibleControls('.solo-setup button,.solo-setup select');
  }
  await page.locator('[data-duel-tab="1"]').click();
  for(const source of ['saved','set','cards']){
   await page.locator('#solo-source').selectOption(source);await page.locator('#solo-size').selectOption('60');assert.equal(await page.locator('#solo-size').inputValue(),'60');await visibleControls('.solo-setup button,.solo-setup select');
   if(source==='set')await capture(`ai-deck-size-${width}x${height}`);
  }
  await page.locator('#solo-size').selectOption('30');await page.locator('[data-duel-tab="0"]').click();await page.locator('[data-duel-tab="1"]').click();assert.equal(await page.locator('#solo-size').inputValue(),'30');
  for(const tab of [1,2,3,0]){await page.locator(`[data-duel-tab="${tab}"]`).click();await visibleControls('.solo-setup button,.solo-setup select,.solo-setup input');}
  assert.match(await page.locator('.duel-era').textContent(),/2006 LAB/);
  await page.locator('[data-duel="filters"]').click();assert.equal(await page.locator('[name="cutoff"]').inputValue(),'2006-12-31');
  const duelTaxonomy=await page.locator('#duel-filters').evaluate((form,fields)=>Object.fromEntries(fields.map(key=>[key,[...form.querySelector(`[name="${key}"]`).options].map(o=>({value:o.value,label:o.textContent}))])),taxonomyFields);assert.deepEqual(duelTaxonomy,taxonomy);
  await page.locator('#duel-filters [name="attribute"]').selectOption('DIVINE');await page.locator('#duel-filters [name="subtype"]').selectOption('Effect');await page.locator('#duel-filters [name="spellTrapType"]').selectOption('Continuous');
  await visibleControls('#duel-filters select,#duel-filters button');await capture(`duel-filters-${width}x${height}`);
  await page.locator('#duel-filters button[type="submit"]').click();assert.match(await page.locator('.solo-filter-summary').textContent(),/DIVINE/);
  await page.locator('[data-duel="filters"]').click();assert.equal(await page.locator('#duel-filters [name="attribute"]').inputValue(),'DIVINE');
  for(const field of ['attribute','subtype','spellTrapType'])await page.locator(`#duel-filters [name="${field}"]`).selectOption('');
  await page.locator('[name="cutoff"]').selectOption('2005-12-31');await visibleControls('#duel-filters button,#duel-filters select');await page.locator('#duel-filters button[type="submit"]').click();
  assert.match(await page.locator('.solo-filter-summary').textContent(),/2005 & earlier/);
  await page.locator('[data-duel="filters"]').click();await page.locator('[name="cutoff"]').selectOption('2006-12-31');await page.locator('#duel-filters button[type="submit"]').click();
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
  // Required effects from the same event must wait for the player's order.
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend();
   let match=await engine.createMatch([0,1].map(()=>({name:'Trigger order',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:27,openingHands:[[get('Dark Hole')],[]],initialFields:[{monsters:['Sangan','Witch of the Black Forest'].map(name=>({card:get(name)}))},{}]});match=engine.applyAction(match,match.actions[0].find(a=>a.type==='ACTIVATE'),0);
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-response-body').waitFor();assert.match(await page.locator('.duel-response-context').textContent(),/Choose the next required effect/);assert.equal(await page.locator('[data-duel="response-pass"],[data-duel="response-turn"]').count(),0);await capture(`required-order-before-${width}x${height}`);await visibleControls('.duel-response-body button');
  await page.locator('[data-response-index][aria-label^="Witch"]').click();await capture(`required-trigger-order-${width}x${height}`);await page.locator('[data-duel="response-activate"]').click();await page.waitForFunction(()=>window.layoutRig.getMatch().choice&&document.querySelector('.duel-arena')?.dataset.moving==='false');assert.deepEqual(await page.evaluate(()=>window.layoutRig.getMatch().chain.map(c=>c.card.name)),['Witch of the Black Forest','Sangan']);await page.evaluate(()=>window.layoutRig.destroy());
  // Win a real battle, inspect the MP2 timing note, then resolve the native
  // End Phase trigger, target and battle-position choice through production UI.
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');
   const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');
   const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend();
   let match=await engine.createMatch([0,1].map(()=>({name:'Level-up check',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:17,first:1,openingHands:[[get('Armed Dragon LV7')],[]],initialFields:[{monsters:[{card:get('Armed Dragon LV5')}]},{monsters:[{card:get('Mystical Elf')}]}]});
   const apply=(type,side=match.active)=>{const action=match.actions[side].find(a=>a.type===type);if(!action)throw Error('Missing level-up setup command '+type);match=engine.applyAction(match,action,side);};
   apply('END',1);apply('NEXT',0);apply('ATTACK',0);
   match=engine.applyAction(match,match.actions[0].find(a=>a.target===match.players[1].monsters.find(Boolean).uid),0);match=engine.applyAction(match,match.actions[0].find(a=>a.finish),0);
   for(let n=0;n<120&&(match.choice||match.window||match.pending);n++){const side=match.actions[0].length?0:1;match=engine.applyAction(match,match.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(match,side),side);}
   apply('NEXT',0);if(match.phase!=='main2')throw Error('Expected Main Phase 2 after battle');
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');
   const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});
   controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-arena[data-moving="false"]').waitFor();
  const levelSource=await page.evaluate(()=>window.layoutRig.getMatch().players[0].monsters.find(c=>c?.card.name==='Armed Dragon LV5').uid);
  await page.locator(`[data-duel-card="${levelSource}"]`).click();await page.locator('.duel-summon-note').waitFor();
  assert.match(await page.locator('.duel-summon-note').textContent(),/End Phase effect/);await visibleControls('.duel-card-viewer button');await capture(`level-up-timing-${width}x${height}`);
  await page.locator('.dialog-header [data-action="close"]').click();assert.equal(await page.locator('[data-duel="end"]').textContent(),'End Phase');await page.locator('[data-duel="end"]').click();
  await page.locator('.duel-response-body').waitFor();assert.match(await page.locator('.duel-response-description').textContent(),/^During the End Phase/);await visibleControls('.duel-response-body button');await capture(`level-up-trigger-${width}x${height}`);
  await page.locator('[data-duel="response-activate"]').click();await page.locator('.duel-choice-card').filter({hasText:'Armed Dragon LV7'}).click();
  await page.locator('.duel-arena[data-moving="false"]').waitFor();await page.locator('.duel-choice-footer [data-choice-tone="teal"]:enabled').click();
  await page.locator('.duel-choice-action').filter({hasText:'Attack Position'}).waitFor();await page.locator('.duel-arena[data-moving="false"]').waitFor();await page.locator('.duel-choice-action').filter({hasText:'Attack Position'}).click();
  await page.waitForFunction(()=>window.layoutRig.getMatch().players[0].monsters.some(c=>c?.card.name==='Armed Dragon LV7')&&document.querySelector('.duel-arena')?.dataset.moving==='false');
  await page.evaluate(()=>window.layoutRig.destroy());
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');
   const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend();
   const match=await engine.createMatch([0,1].map(()=>({name:'Effect review',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:17,openingHands:[[get('Armed Dragon LV7')],[]],initialFields:[{monsters:[{card:get('Armed Dragon LV5')}]},{monsters:[{card:get('Mystical Elf')}]}]});
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-arena[data-moving="false"]').waitFor();const reviewSource=await page.evaluate(()=>window.layoutRig.getMatch().players[0].monsters[0].uid);await page.locator(`[data-duel-card="${reviewSource}"]`).click();await page.locator('[data-duel-group]').filter({hasText:'Activate · Destroy'}).click();
  await visibleControls('.duel-activation-review button');assert.match(await page.locator('[aria-label="Effect to activate"]').textContent(),/send 1 monster from your hand/);await capture(`activation-review-${width}x${height}`);
  await page.locator('[data-duel="confirm-activation"]').click();await page.locator('.duel-arena[data-moving="false"]').waitFor();await page.locator('.duel-choice-footer [data-duel="cancel-activation"]').click();await page.waitForFunction(()=>!window.layoutRig.getMatch().choice&&document.querySelector('.duel-arena')?.dataset.moving==='false');
  assert.ok(await page.evaluate(()=>window.layoutRig.getMatch().players[0].hand.some(c=>c.card.name==='Armed Dragon LV7')));await page.evaluate(()=>window.layoutRig.destroy());
  await page.route('**/images.ygoprodeck.com/images/cards_small/*.jpg',async route=>route.fulfill({body:await readFile('assets/card-back.jpg'),contentType:'image/jpeg'}));
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend();
   let match=await engine.createMatch([0,1].map(()=>({name:'Cyber Jar reveal',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:17,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Cyber Jar'),faceUp:false,defense:true}]},{}]});match=engine.applyAction(match,match.actions[0].find(a=>a.type==='POSITION'),0);
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-reveal-list').waitFor();assert.equal(await page.locator('[data-duel-reveal-card]').count(),5);await visibleControls('.duel-reveal-body button');await capture(`cyber-jar-reveal-${width}x${height}`);
  await page.locator('[data-duel="reveal-done"]').click();await page.locator('.duel-position-card').waitFor();assert.match(await page.locator('.duel-position-card').textContent(),/Mystical Elf/);await visibleControls('.duel-picker-body button,.duel-position-card>img,.duel-position-card strong,.duel-position-card small');await capture(`cyber-jar-position-${width}x${height}`);
  await page.locator('[data-duel="read-position-card"]').click();await visibleControls('.duel-selection-info button');await page.locator('[data-duel="selection-back"]').click();assert.match(await page.locator('.duel-position-card').textContent(),/Mystical Elf/);await page.locator('.dialog-header [data-action="close"]').click();await page.evaluate(()=>window.layoutRig.destroy());
  // A real Alien flip verifies the new live counter badge and inspector on
  // the same eight small/rotated screens as the rest of the arena.
  await page.evaluate(async()=>{
   const {navigate,state}=await import('/src/app.js');navigate('home');
   const {createNativeBackend}=await import('/src/duel/native-engine.js'),{createSoloController}=await import('/src/duel/ui.js');
   const catalog=state.cards,get=name=>catalog.find(c=>c.name===name),engine=createNativeBackend();
   let match=await engine.createMatch([0,1].map(()=>({name:'Counter layout',main:Array(40).fill(get('Mystical Elf')),extra:[]})),{cards:catalog,seed:67,openingHands:[[],[]],initialFields:[{monsters:[{card:get('Alien Grey'),faceUp:false,defense:true}]},{monsters:[{card:get('Blue-Eyes White Dragon')}]}]});
   match=engine.applyAction(match,match.actions[0].find(a=>a.type==='POSITION'),0);
   for(let n=0;n<120&&(match.choice||match.window||match.reveals?.length);n++){const side=match.actions[0].length?0:1;match=engine.applyAction(match,match.actions[side].find(a=>a.type==='PASS')||engine.chooseAIAction(match,side),side);}
   const main=document.querySelector('#main'),modal=document.querySelector('#modal');
   const controller=createSoloController({main,modal,getCards:()=>catalog,getDecks:()=>[],getStatus:()=>'ready',showDialog:(html,classes)=>{modal.innerHTML=`<div class="dialog-body ${classes}">${html}</div>`;if(!modal.open)modal.showModal();},closeDialog:()=>modal.close(),dialogHeader:title=>`<div class="dialog-header"><h2>${title}</h2><button data-action="close">×</button></div>`,toast:message=>{throw Error(message);},onDesign(){},engine:{...engine,createMatch:async()=>match}});
   controller.enter();main.querySelector('[data-duel="start"]').click();window.layoutRig=controller;
  });
  await page.locator('.duel-counter-badge').waitFor();await page.locator('.duel-arena[data-moving="false"]').waitFor();assert.equal(await page.locator('.duel-counter-badge').getAttribute('title'),'1 A-Counter');
  await visibleControls('.duel-counter-badge,.duel-controls button');await capture(`alien-counter-${width}x${height}`);
  await page.locator('.duel-zone:has(.duel-counter-badge)').click();assert.equal(await page.locator('.duel-counter-description').textContent(),'1 A-Counter');await visibleControls('.duel-card-viewer button');assert.ok(await page.locator('.duel-inspect-visual .card-battle-stats').count());await visibleControls('.duel-card-viewer .card-publication');await capture(`counter-inspection-${width}x${height}`);
  await page.locator('.dialog-header [data-action="close"]').click();await page.evaluate(()=>window.layoutRig.destroy());
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
   await page.route('**/images.ygoprodeck.com/images/cards/*.jpg',async route=>route.fulfill({body:await readFile('assets/card-back.jpg'),contentType:'image/jpeg'}));
   // Reopen after installing the full-art response so decode actually runs.
   await page.locator('[data-duel="selection-back"]').click();await page.locator(selector).first().click();
   await page.waitForFunction(()=>document.querySelector('.selection-info-art img.duel-inspect-full')?.complete);
   assert.equal(await page.locator('.selection-info-art img').count(),1,'Decoded art replaces the thumbnail');
   assert.ok(await page.locator('.duel-selection-info').evaluate(panel=>{const art=panel.querySelector('.selection-info-art').getBoundingClientRect(),copy=panel.querySelector('.selection-info-copy').getBoundingClientRect();return innerWidth>innerHeight?art.right<=copy.left+1:art.bottom<=copy.top+1;}),'Art and effect text occupy separate columns even on a rotated phone');
   assert.ok(await page.locator('.duel-selection-info .card-battle-stats').count());assert.ok(await page.locator('.duel-selection-info .card-publication').count());
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
  // Random opening hands can legally offer Scapegoat during Draw/Standby.
  // Resolve that real response before the final, presentation-only hand fixture.
  await page.waitForFunction(()=>{const s=window.layoutRig.getMatch();return s.phase==='main1'&&!s.choice&&!s.window&&document.querySelector('.duel-arena')?.dataset.moving==='false'||document.querySelector('#modal').open&&document.querySelector('.duel-response-body');});
  if(await page.locator('.duel-response-body').isVisible()){
   await page.locator('[data-duel="response-turn"]').click();
   await page.waitForFunction(()=>{const s=window.layoutRig.getMatch();return s.phase==='main1'&&!s.choice&&!s.window&&document.querySelector('.duel-arena')?.dataset.moving==='false';});
  }
  for(const count of [5,10]){
   // This final layout fixture needs no further core actions: expose ten real
   // card instances to the renderer, then destroy the native match afterward.
   if(count===10)await page.evaluate(()=>{const player=window.layoutRig.getMatch().players[0];player.hand.push(...player.deck.splice(-5));window.layoutRig.refresh();});
   for(const inset of [4,21]){
   await page.evaluate(inset=>{document.documentElement.style.setProperty('--duel-safe-bottom',`${inset}px`);window.layoutRig.refresh();},inset);
   await visibleControls('.duel-hand-card,.duel-hand-zoom,.duel-controls button');
   const collisions=await page.locator('.duel-hand-card').evaluateAll(cards=>{
    const controls=[...document.querySelectorAll('.duel-controls button,.player-life,.duel-hand-zoom')].filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect());
    return cards.flatMap(n=>{const r=n.getBoundingClientRect();return controls.some(c=>Math.min(r.right,c.right)-Math.max(r.left,c.left)>1&&Math.min(r.bottom,c.bottom)-Math.max(r.top,c.top)>1)?[n.getAttribute('aria-label')]:[];});
   });
   assert.deepEqual(collisions,[],'The lowered/right-shifted hand stays clear of LP, zoom and phase actions');
   await capture(`player-hand-${count}-${inset}-${width}x${height}`);
   await page.locator('[data-duel="hand-zoom"]').click();await visibleControls('.duel-hand-card,.duel-hand-zoom,.duel-controls button');
   await page.locator('[data-duel="hand-zoom"]').click();
   }
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('--duel-safe-bottom'));
  await page.evaluate(()=>window.layoutRig.destroy());
  await context.close();page=null;
  console.log(`Menu controls fit ${width} × ${height}`);
 }
} catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await browser?.close();server.kill();}
