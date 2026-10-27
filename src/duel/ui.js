import {publicationHTML,cardFactsHTML,battleStatsHTML} from '../card-details.js';
import { defaultSide, poolFor, eligibleSets, generateDeck, validateDuelDeck, expandDeck, loadSets, setLabel, deckSize, prepareAIDeck } from './decks.js';
import {ATTRIBUTES,MONSTER_TYPES,SUBTYPES,MECHANICS,SPELL_TRAP_TYPES} from '../card-filters.js';
import { support, ERA_END, ERA_YEAR, isMonster } from './catalog.js';
import * as nativeEngine from './native-engine.js';
import { PHASES, PHASE_LABELS } from './engine.js';
import { chooseAIAction as legacyAI } from './ai.js';
import { createAIClient } from './ai-client.js';
import { AI_SPEEDS, decisionDelay, automaticOpeningAction } from './flow.js';
import { CARD_BACK, planMotion, captureArena, createMotionPlayer, paintLife } from './motion.js';
import { groupedLog, logKindLabel } from './log.js';
import { patchArena } from './dom.js';
import { icon } from '../icons.js';
import { declarationIcon, declarationLabel } from './declaration-icons.js';
import { applyArenaGeometry, handGeometry } from './arena-layout.js';
import {landscapeSize,isRotated} from './viewport.js';
import {readDuelSaves,saveDuel,deleteDuelSave} from './saves.js';
import {phaseEffectText,activationText,activationLabel,activationUnchanged} from './native-prompts.js';
import {freshSeed,deriveSeed} from './random.js';
import { choiceIntent, choiceVisuals } from './choice-view.js';
import { responseOffer, createResponsePolicy } from './responses.js';
import { automaticEffectAction, effectExplanation, effectNotices, cardPresentations, createEffectPlayer } from './effects.js';
import { createDuelIntro,coinMarkup } from './intro.js';
import {battlePresentations,createBattlePlayer} from './battle-presentation.js';
import { createAttackArrows } from './attack-arrows.js';
import { BATTLE_STEPS, responseAdvice } from './battle-timing.js';
import { cardArtURLs, cardTypeLabel, sharpenCardArt, currentCardData, cardStatText, cardCounters } from './card-view.js';
import { cardRotation, makeFieldSelection, fieldCandidates, pickFieldCandidate, quickCardActions, activityCue, cardActivity } from './field.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const option=(value,label,selected)=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
const CONFIG='duel-atlas.solo-config.v1';
const cardBack=()=>`<img class="card-back-image" src="${CARD_BACK}" alt="" decoding="async">`;
const labelFor=action=>['ACTIVATE','EFFECT'].includes(action.type)&&action.effectText?activationLabel(action):action.label||({SUMMON:action.set?'Set in Defense':'Normal Summon',FLIP:'Flip Summon',POSITION:'Change position',SET:'Set Spell / Trap',ACTIVATE:'Activate card',EFFECT:'Use effect',ATTACK:'Attack',CHOOSE:'Choose target',DISCARD:'Discard'}[action.type]||action.type);
const image=card=>{
  const {preview}=cardArtURLs(card);
  return preview?`<img src="${escape(preview)}" alt="" loading="eager" decoding="async">`:'<span class="duel-no-image" aria-hidden="true">◇</span>';
};

export function createSoloController({main,modal,getCards,getDecks,getStatus,showDialog,dialogHeader,closeDialog,toast,onDesign,onExit=()=>{},engine=nativeEngine}) {
  const {createMatch,legalActions,applyAction,findCard,stats}=engine;
  const chooseAIAction=engine.chooseAIAction||legacyAI;
  const aiClient=createAIClient({choose:chooseAIAction});
  let thinking=0,launchSequence=0;
  const cancelThinking=()=>{thinking=0;aiClient.cancel();};
  let config={sides:[defaultSide(),defaultSide()],aiSpeed:'normal',first:'coin',lp:8000,animations:true},tab=0,match=null,active=false,timer=null,sets=[],setsStatus='idle',starting=false,selection=[],moving=false,presentation=0,openingTurn=null,logFilter='all',fieldSelection=null,cue=null,arenaActions=[],inspectedUid=null,cardGroups=[],cancelArt=()=>{};
  const motion=createMotionPlayer(main), reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const attackArrows=createAttackArrows(main);
  const effects=createEffectPlayer({getRoot:()=>main.querySelector('.duel-effect-host')});
  const battle=createBattlePlayer({getRoot:()=>main.querySelector('.duel-battle-host')});
  const intro=createDuelIntro({getRoot:()=>main.querySelector('.duel-intro-host')});
  let introPending=null,displayLP=null,activationDraft=null,activationReview=null;
  let revealSeen=null;
  const responsePolicy=createResponsePolicy();
  let responseSeen=null,responseIndex=0;
  let saveId=null,handExpanded=false,resultShown=false,orderDraft=null,selectionRead=null;
  let observedTable=null;
  const tableObserver=typeof window.ResizeObserver==='function'?new window.ResizeObserver(()=>{fitArena();attackArrows.refresh();}):null;
  function fitArena(){
    if(!active)return;const table=main.querySelector('.duel-table');if(!table)return;
    if(table!==observedTable){tableObserver?.disconnect();tableObserver?.observe(table);observedTable=table;}
    const rect=table.getBoundingClientRect(),size=landscapeSize(window),rotated=isRotated(table),width=table.clientWidth||(rotated?rect.height:rect.width)||size.width,height=table.clientHeight||(rotated?rect.width:rect.height)||size.height;
    const area=table.querySelector('.duel-hand-area'),bottomInset=parseFloat(window.getComputedStyle(area).paddingBottom)||4;
    const layout=applyArenaGeometry(table,width,height,{bottomInset});table.dataset.fitSize=`${width}:${height}:${bottomInset}`;
    const hand=handGeometry(layout.fieldWidth,height,{count:match.players[0].hand.length,expanded:handExpanded,baseSize:layout.values['--hand-card-size'],bottomInset,dockWidth:table.querySelector('.duel-action-area')?.clientWidth}),rack=table.querySelector('.duel-hand-rack');
    for(const [name,value] of Object.entries(hand.values))area?.style.setProperty(name,`${Math.round(value*100)/100}px`);
    if(rack)rack.dataset.compactHand=String(hand.cardWidth<32);
  }
  const cancelMotion=()=>{motion.cancel();intro.cancel();effects.cancel();battle.cancel();};
  const resize=()=>{
    if(!active||!match)return;
    motion.cancel();intro.cancel();effects.cancel();battle.cancel();cancelThinking();
    presentation++;displayLP=null;moving=false;render();schedule();
  };
  function suspendPresentation(){
    if(!active||!match)return;clearTimeout(timer);cancelThinking();cancelMotion();presentation++;displayLP=null;moving=false;
  }
  function resumePresentation(){
    if(!active||!match||document.visibilityState==='hidden')return;suspendPresentation();render();schedule();
  }
  const visibility=()=>document.visibilityState==='hidden'?suspendPresentation():resumePresentation();
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',suspendPresentation);
  window.addEventListener('pageshow',resumePresentation);
  window.addEventListener('resize',resize);
  reducedMotion.addEventListener?.('change',cancelMotion);
  try {
    const saved=JSON.parse(localStorage.getItem(CONFIG)||'null');
    if(saved&&typeof saved==='object'){
      const previousEnd=saved.eraEnd||'2004-12-31';
      config={...config,...saved,sides:saved.sides?.length===2?saved.sides.map(side=>({...defaultSide(),...side,cutoff:side.cutoff===previousEnd?ERA_END:side.cutoff||ERA_END})):config.sides};
    }
  }catch{/* corrupt settings never replace saved decks */}
  if(!AI_SPEEDS[config.aiSpeed])config.aiSpeed='normal';
  if(!['coin','you','ai'].includes(config.first))config.first='coin';
  delete config.difficulty; // Migrate older settings to the single full-strength policy.
  if(![4000,8000].includes(config.lp))config.lp=8000;
  config.animations=typeof config.animations==='boolean'?config.animations:true;
  config.eraEnd=ERA_END;
  config.sides[0].size=40;config.sides[0].supplement=false;config.sides[1].size=deckSize(config.sides[1].size);config.sides[1].supplement=true;
  // Deck/config storage failures are visible; leaving a live match is explicit.
  const persist=()=>{try{localStorage.setItem(CONFIG,JSON.stringify(config));}catch{toast('Solo settings apply for this session; browser storage is unavailable.',true);}};
  const saveSide=(side,deckId)=>{config.sides[side].deckId=deckId;config.sides[side].source='saved';persist();};
  const selectedDeck=side=>getDecks().find(deck=>deck.id===config.sides[side].deckId);
  const candidateSets=side=>eligibleSets(getCards(),sets,config.sides[side]);
  const header=title=>dialogHeader(escape(title));
  function render(){if(!active)return;document.querySelector('meta[name=theme-color]')?.setAttribute('content',match?'#e5eeeb':'#eef3f5');document.documentElement.classList.toggle('duel-playing',!!match);document.documentElement.dataset.duelRotated=String(!!match&&window.innerHeight>window.innerWidth);if(match)renderArena();else renderSetup();}
  async function requestSets(force=false){
    if(setsStatus==='loading')return;
    setsStatus='loading';render();
    try{const result=await loadSets({force});sets=result.sets;setsStatus=result.offline?'offline':'ready';}
    catch{setsStatus='error';}
    render();
  }
  function renderSetup(){
    const cards=getCards(),ready=getStatus()==='ready',side=config.sides[tab],saved=tab<2?selectedDeck(tab):null,pool=tab<2?poolFor(cards,side):[];
    const deckSummary=index=>{const settings=config.sides[index],deck=selectedDeck(index);return settings.source==='saved'?(deck?.name||'Choose a deck'):settings.source==='set'?(settings.set||'Random set'):'Random cards';};
    const selectedSet=tab<2?sets.find(set=>set.name===side.set):null;
    const deckFields=tab<2?`<div class="solo-panel-title"><span class="solo-sigil" aria-hidden="true">${icon(tab===0?'deck':'solo')}</span><div><small>${tab===0?'PLAYER 01':'YOUR OPPONENT'}</small><h2>${tab===0?'Your deck':'AI deck'}</h2></div><span class="solo-pool-count">${ready?pool.length.toLocaleString():'…'}<small>cards</small></span></div>
      <div class="solo-deck-fields"><label>Deck source<select id="solo-source">${[['cards','Random cards'],['set','Random set'],['saved','Saved / custom deck']].map(([v,l])=>option(v,l,side.source)).join('')}</select></label>
      ${tab===1?`<label title="Small sets and custom decks are filled with random eligible cards; larger custom decks are sampled without editing the saved deck.">AI Main Deck size<select id="solo-size">${Array.from({length:31},(_,i)=>i+30).map(n=>option(n,n+' cards',side.size)).join('')}</select></label>`:''}
      ${side.source==='saved'?`<div class="solo-saved-row"><label>Saved deck<select id="solo-deck">${option('','Choose a deck',side.deckId)}${getDecks().map(deck=>option(deck.id,deck.name,side.deckId)).join('')}</select></label><button data-duel="design">${icon('deck')}<span>${saved?'Edit':'Design'}</span></button></div>`:side.source==='set'?`<label><span class="solo-set-label">Released set${selectedSet?`<small class="solo-set-year">${escape(selectedSet.date.slice(0,4))}</small>`:''}</span><select id="solo-set">${option('','Random eligible set',side.set)}${candidateSets(tab).map(set=>`<option value="${escape(set.name)}" ${set.name===side.set?'selected':''} ${set.problem?'disabled':''}>${escape(setLabel(set))} · ${set.remaining.length} cards${set.problem?' · too few':''}</option>`).join('')}</select></label>`:tab===1?'':'<div class="solo-format"><b>40</b><span>cards per deck<small>Up to 3 copies each</small></span></div>'}
      <button class="solo-filter-summary" data-duel="filters" aria-haspopup="dialog">${icon('filter')}<span><strong>Card eligibility</strong><small>${escape([side.cutoff.slice(0,4)+' & earlier',side.race||'All types',side.attribute,side.subtype,side.mechanic,side.spellTrapType,!side.spells?'No spells':'',!side.traps?'No traps':''].filter(Boolean).join(' · '))}</small></span><span aria-hidden="true">↗</span></button>
      ${side.source==='set'?`<div class="solo-set-status" role="status">${setsStatus==='loading'?'Loading sets…':setsStatus==='error'?'Set data unavailable':`${candidateSets(tab).filter(s=>!s.problem).length} eligible sets`}${setsStatus==='error'?'<button data-duel="sets-retry">Retry</button>':''}</div>`:''}</div>`:'';
    main.innerHTML=`<section class="screen solo-setup" aria-label="Solo Duel setup">
      <div class="duel-heading"><div><div class="eyebrow">THE ARENA</div><h1>Solo Duel</h1></div><button class="duel-era" data-duel="coverage" aria-haspopup="dialog">${ERA_YEAR} LAB <span>Rules & cards ↗</span></button></div>
      <div class="solo-tabs" role="tablist" aria-label="Duel setup">${[['Your deck','deck'],['AI deck','solo'],['Match','filter'],['Saved duels','save']].map(([name,glyph],index)=>`<button id="solo-tab-${index}" role="tab" aria-controls="solo-panel" aria-selected="${tab===index}" data-duel-tab="${index}">${icon(glyph)}<span>${name}</span></button>`).join('')}</div>
      <div class="solo-panel" id="solo-panel" role="tabpanel" aria-labelledby="solo-tab-${tab}" tabindex="0">
      ${tab===3?`<div class="solo-panel-title"><span class="solo-sigil" aria-hidden="true">${icon('save')}</span><div><small>PICK UP WHERE YOU LEFT OFF</small><h2>Saved duels</h2></div></div><div class="duel-saved-list">${readDuelSaves(localStorage).map(save=>`<article><div><strong>${escape(save.name)}</strong><small>Turn ${save.turn} · ${save.lp.join(' / ')} LP</small></div><button class="primary" data-resume-duel="${escape(save.id)}" ${ready?'':'disabled'}>Resume</button><button data-delete-duel="${escape(save.id)}" aria-label="Delete saved duel">×</button></article>`).join('')||`<div class="solo-empty">${icon('save')}<strong>Your next move, saved.</strong><p>Save a duel from the arena menu to resume it here.</p></div>`}</div>`:tab<2?deckFields:
      `<div class="solo-panel-title"><span class="solo-sigil" aria-hidden="true">${icon('solo')}</span><div><small>YOUR DUEL, YOUR PACE</small><h2>Match settings</h2></div><span class="solo-ai-badge" title="Always full strength">Strategic AI</span></div><div class="solo-match-fields"><label>AI decision speed<select id="solo-ai-speed">${Object.entries(AI_SPEEDS).map(([key,speed])=>option(key,speed.label,config.aiSpeed)).join('')}</select></label><label>Goes first<select id="solo-first">${[['coin','Coin toss'],['you','You'],['ai','AI']].map(([v,l])=>option(v,l,config.first)).join('')}</select></label><label>Life Points<select id="solo-lp">${[8000,4000].map(n=>option(n,n.toLocaleString(),config.lp)).join('')}</select></label><label class="solo-checkbox"><input id="solo-animations" type="checkbox" ${config.animations?'checked':''}> Duel animations</label></div>`}
      </div>
      <aside class="solo-launch"><div class="solo-versus"><div><small>YOU</small><strong>${escape(deckSummary(0))}</strong></div><span aria-hidden="true">VS</span><div><small>AI</small><strong>${escape(deckSummary(1))}</strong></div></div><p role="status">${ready?`Supported ${ERA_YEAR} TCG cards · no banlist`:getStatus()==='error'?'Open Archive to retry loading cards.':'Preparing card data…'}</p><button class="primary" data-duel="start" ${!ready?'disabled':''}>Start duel <span aria-hidden="true">→</span></button></aside>
    </section>`;
    const tabs=[...main.querySelectorAll('[data-duel-tab]')];
    tabs.forEach((button,index)=>{button.tabIndex=index===tab?0:-1;button.onkeydown=event=>{const next=event.key==='ArrowDown'||event.key==='ArrowRight'?(index+1)%4:event.key==='ArrowUp'||event.key==='ArrowLeft'?(index+3)%4:event.key==='Home'?0:event.key==='End'?3:null;if(next===null)return;event.preventDefault();main.querySelector(`[data-duel-tab="${next}"]`).click();main.querySelector(`[data-duel-tab="${next}"]`).focus();};});
    // Assign values explicitly as well as option attributes, including after a
    // saved deck is created while this screen is unmounted.
    if(tab<2)for(const [id,value] of [['solo-source',side.source],['solo-deck',side.deckId],['solo-set',side.set]]){const select=main.querySelector('#'+id);if(select)select.value=value;}
    else if(tab===2)for(const [id,value] of [['solo-ai-speed',config.aiSpeed],['solo-first',config.first],['solo-lp',String(config.lp)]])main.querySelector('#'+id).value=value;
    main.querySelector('#solo-source')?.addEventListener('change',event=>{side.source=event.target.value;persist();if(side.source==='set'&&setsStatus==='idle')requestSets();else render();});
    main.querySelector('#solo-deck')?.addEventListener('change',event=>{side.deckId=event.target.value;persist();render();});
    main.querySelector('#solo-size')?.addEventListener('change',event=>{side.size=deckSize(event.target.value);persist();render();});
    main.querySelector('#solo-set')?.addEventListener('change',event=>{side.set=event.target.value;persist();render();});
    for(const [id,key] of [['solo-ai-speed','aiSpeed'],['solo-first','first'],['solo-lp','lp'],['solo-animations','animations']])main.querySelector('#'+id)?.addEventListener('change',event=>{config[key]=key==='lp'?Number(event.target.value):key==='animations'?event.target.checked:event.target.value;persist();});
  }
  function filters(){
    const side=config.sides[tab],races=MONSTER_TYPES;
    showDialog(`${header(`${tab===0?'Your':'AI'} card eligibility`)}<form id="duel-filters"><div class="solo-settings-grid"><label>Release year<select name="cutoff">${Array.from({length:ERA_YEAR-1996+1},(_,i)=>ERA_YEAR-i).map(year=>option(year+'-12-31',year+' & earlier',side.cutoff)).join('')}</select></label><label>Monster subtype<select name="subtype">${option('','All',side.subtype)}${SUBTYPES.map(s=>option(s,s,side.subtype)).join('')}</select></label><label>Monster type<select name="race">${option('','All',side.race)}${races.map(r=>option(r,r,side.race)).join('')}</select></label><label>Monster attribute<select name="attribute">${option('','All',side.attribute)}${ATTRIBUTES.map(a=>option(a,a,side.attribute)).join('')}</select></label><label>Mechanic<select name="mechanic">${option('','All',side.mechanic)}${MECHANICS.map(m=>option(m,m,side.mechanic)).join('')}</select></label><label>Spell / Trap type<select name="spellTrapType">${option('','All',side.spellTrapType)}${SPELL_TRAP_TYPES.map(t=>option(t,t,side.spellTrapType)).join('')}</select></label></div><div class="solo-settings-grid" title="Spell/Trap eligibility is independent of monster filters">${['spells','traps'].map(key=>`<label class="solo-checkbox"><input name="${key}" type="checkbox" ${side[key]?'checked':''}> Allow ${key}</label>`).join('')}</div><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit" class="primary">Apply filters</button></div></form>`,'duel-filter-body');
    for(const key of ['cutoff','race','attribute','subtype','mechanic','spellTrapType'])modal.querySelector(`[name="${key}"]`).value=side[key];
    modal.querySelector('#duel-filters').onsubmit=event=>{
      event.preventDefault();const form=event.target;
      for(const key of ['cutoff','race','attribute','subtype','mechanic','spellTrapType'])side[key]=form.elements.namedItem(key).value;
      for(const key of ['spells','traps'])side[key]=form.elements.namedItem(key).checked;
      if(side.cutoff>ERA_END||side.cutoff<'1996-01-01'){toast(`Choose a date from 1996 through ${ERA_YEAR}.`,true);return;}
      side.set='';persist();closeDialog();render();
    };
  }
  function coverage(list=false){
    const era=getCards().filter(c=>c.tcgDate&&c.tcgDate<=ERA_END),supported=era.filter(c=>support(c).ok);
    if(!list){
      showDialog(`${header(`${ERA_YEAR} engine · test scope`)}<p><strong>${supported.length} of ${era.length} dated cards supported.</strong> The offline EDOPro rules core handles Ritual and Fusion Summons, Tribute procedures, Spirit / Union / Toon effects, counters, chains, costs, targeting and special victory conditions. Collector-only prize cards and deck-list placeholders are excluded; Tokens are created by effects.</p><p>Uses current card text, modern core turn rules, and a three-copy limit without a banlist. Core timing handles simultaneous triggers, damage-step chains, and attack replays. This is a functionality-testing release; report any prompt or AI issue.</p><p>Set pools use API memberships and first TCG dates; eligible older reprints may be grouped with an original set. Multiplayer is still planned.</p><button class="primary" data-duel="support-list">Browse card support</button><button data-action="close">Done</button>`,'duel-scope-body');
      return;
    }
    showDialog(`${header(`Card support · ${ERA_YEAR} & earlier`)}<label>Find support status<input id="support-search" type="search" placeholder="Card name…" autocomplete="off"></label><div class="duel-choice-list" id="support-list" aria-label="Card support results"></div><button data-duel="coverage">Back to rules</button>`,'duel-list-body');
    const update=()=>{const query=modal.querySelector('#support-search').value.toLowerCase();modal.querySelector('#support-list').innerHTML=era.filter(c=>c.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)).map(card=>`<div class="support-row"><strong>${escape(card.name)}</strong><small class="${support(card).ok?'supported':'unsupported'}">${support(card).ok?'Playable':escape(support(card).reason)}</small></div>`).join('');};
    modal.querySelector('#support-search').oninput=update;update();
  }
  async function start(){
    if(moving||match||starting)return;
    const launchToken=++launchSequence;starting=true; const launch=main.querySelector('[data-duel="start"]');if(launch){launch.disabled=true;launch.textContent='Preparing duel…';}
    try{
      const seed=freshSeed();
      const decks=config.sides.map((settings,side)=>settings.source==='saved'?(side===1?prepareAIDeck(selectedDeck(side),getCards(),settings,deriveSeed(seed,'custom-ai')):selectedDeck(side)):generateDeck(getCards(),settings,sets,deriveSeed(seed,'generate-'+side)));
      const issues=decks.flatMap((deck,side)=>validateDuelDeck(deck,getCards(),config.sides[side],{min:side===1?30:40,max:60}).map(message=>`${side===0?'Your deck':'AI deck'}: ${message}`));
      if(issues.length){showDialog(`${header('Decks need a quick review')}<div class="duel-choice-list" aria-label="Deck issues">${issues.map(issue=>`<p class="support-row">${escape(issue)}</p>`).join('')}</div><button data-action="close">Back to setup</button>`,'duel-list-body');return;}
      const first=config.first==='you'?0:config.first==='ai'?1:deriveSeed(seed,'first-player')%2;
      const next=await createMatch(decks.map(deck=>({...expandDeck(deck,getCards()),name:deck.name})),{seed,first,lp:config.lp,cards:getCards(),eligibility:config.sides});
      if(!active||launchToken!==launchSequence){engine.destroyMatch?.(next);return;}
      saveId=null;handExpanded=false;resultShown=false;next.deckBackups=decks;introPending={coin:config.first==='coin',first,lp:config.lp};
      const entry={id:++next.serial,turn:next.turn||1,phase:next.phase,side:first,kind:'phase',uids:[],message:(config.first==='coin'?`Opening coin toss: ${first===0?'Heads':'Tails'}. `:'')+(first===0?'You go first.':'AI goes first.')};next.log.push(entry);next.lastEvent=entry;
      await present(null,next);
    }catch(error){if(active&&launchToken===launchSequence)toast(error.message,true);}
    finally{if(launchToken===launchSequence){starting=false;if(!match)render();}}
  }
  function saveCurrent(){
    if(!match||match.winner!==null)return false;
    try{
      if(!engine.exportMatch)throw new Error('Saving is unavailable for this rules runtime.');
      const id=saveId||globalThis.crypto?.randomUUID?.()||`duel-${Date.now()}`;
      saveDuel(localStorage,{id,name:match.players.map(p=>p.name).join(' vs '),savedAt:Date.now(),turn:match.turn,lp:match.players.map(p=>p.lp),replay:engine.exportMatch(match),decks:match.deckBackups,config});saveId=id;toast('Duel saved on this device.');return true;
    }catch(error){toast(error.message,true);return false;}
  }
  async function resumeSaved(id){
    if(starting||match||getStatus()!=='ready')return;const save=readDuelSaves(localStorage).find(s=>s.id===id);if(!save)return;
    const launchToken=++launchSequence;starting=true;const button=[...main.querySelectorAll('[data-resume-duel]')].find(b=>b.dataset.resumeDuel===id);if(button){button.disabled=true;button.textContent='Resuming…';}try{const next=await engine.restoreMatch(save.replay,{cards:getCards()});if(!active||launchToken!==launchSequence){engine.destroyMatch?.(next);return;}config={...config,...save.config,sides:(save.config?.sides||config.sides).map(s=>({...defaultSide(),...s}))};config.sides[0].size=40;config.sides[0].supplement=false;config.sides[1].size=deckSize(config.sides[1].size);config.sides[1].supplement=true;saveId=id;resultShown=false;introPending=null;next.deckBackups=save.decks;match=next;render();schedule();}catch(error){if(active&&launchToken===launchSequence)toast(error.message,true);}finally{if(launchToken===launchSequence){starting=false;if(!match)render();}}
  }
  function exitCurrent(){
    cancelThinking();cancelMotion();clearTimeout(timer);presentation++;moving=false;engine.destroyMatch?.(match);match=null;activationDraft=null;activationReview=null;displayLP=null;introPending=null;handExpanded=false;inspectedUid=null;fieldSelection=null;closeDialog();render();onExit();
  }
  function isHidden(uid){
    if(!uid)return false;
    const selected=findCard(match,uid);if(selected?.public||match.revealedUIDs?.includes(uid))return false;
    const foe=match.players[1];
    return foe.banished.some(card=>card.uid===uid&&!card.faceUp)||['hand','deck','extra'].some(zone=>foe[zone].some(card=>card.uid===uid))||foe.monsters.some(card=>card?.uid===uid&&!card.faceUp)||foe.spells.some(card=>card?.uid===uid&&!card.faceUp)||(foe.field?.uid===uid&&!foe.field.faceUp);
  }
  function visibleName(uid){
    const card=findCard(match,uid);return !card?'card':isHidden(uid)?'face-down card':card.card.name;
  }
  function actionDetail(action){
    if(action.coinCall||action.yes!==undefined)return action.label||labelFor(action);
    const parts=[];
    if(action.effectText&&action.effectText!=='Choose an effect option')parts.push(action.effectText);
    if(action.target)parts.push(`Target: ${visibleName(action.target)}`);
    if(action.type==='ATTACK'&&!action.target)parts.push('Direct attack');
    if(action.tributes?.length)parts.push(`Tribute ${action.tributes.map(visibleName).join(' + ')}`);
    if(action.tribute)parts.push(`Tribute ${visibleName(action.tribute)}`);
    if(action.discard)parts.push(`Discard ${visibleName(action.discard)}`);
    if(action.fusion)parts.push(`${visibleName(action.fusion)} · Materials: ${action.materials.map(visibleName).join(' + ')}`);
    if(action.count)parts.push(`Add ${action.count} Thunder Dragon${action.count===1?'':'s'}`);
    return parts.join(' · ')||labelFor(action);
  }
  function choose(actions,title,skipField=false,reuse=false){
    if(!actions.length){toast('That action is no longer available.');render();return;}
    motion.cancel();cancelArt();inspectedUid=null;
    const session=!skipField&&makeFieldSelection(match,actions,{title,sourceUid:actions[0]?.uid,mandatory:!!match.choice});
    if(session){clearTimeout(timer);fieldSelection=session;closeDialog();render();focusFieldTarget();return;}
    if(actions.length===1&&!match.choice){step(actions[0]);return;}
    selection=actions;
    if(match.choice?.ordering){showOrderPicker();return;}
    const coinChoice=actions.some(action=>action.coinCall),declaration=actions.find(action=>action.declaration)?.declaration;
    const staged=!!match.choice?.stage,purpose=match.choice?.purpose||title,archive=new Map(getCards().map(card=>[card.id,card]));
    const source=selectionSource();
    const context=source?`<button class="duel-choice-source" ${source.hidden?'disabled':'data-duel="read-choice-source"'} aria-label="Read ${escape(source.name)} effect"><span class="duel-choice-source-art">${source.hidden?cardBack():image(source.card)}</span><span><small>${source.hidden?'Resolving effect':'Tap to read effect'}</small><strong>${escape(source.name)}</strong></span></button>`:'';
    const utilities=actions.map((action,index)=>({action,index})).filter(({action})=>action.finish||action.cancel||action.reset);
    const footer=(activationDraft?'<button data-duel="cancel-activation" data-choice-tone="danger">Cancel activation</button>':'')+utilities.map(({action,index})=>`<button data-duel-choice="${index}" data-choice-tone="${choiceIntent(action,purpose).tone}">${escape(action.label||actionDetail(action))}</button>`).join('');
    const markup=`${header(declaration&&source?source.name+' · '+title:title)}${context}${match.choice?.positionCard?.card?`<button class="duel-position-card" data-duel="read-position-card" aria-label="Read ${escape(match.choice.positionCard.card.name)} effect">${image(match.choice.positionCard.card)}<span><small>SUMMONING</small><strong>${escape(match.choice.positionCard.card.name)}</strong><small>ATK ${escape(match.choice.positionCard.card.atk??'?')} / DEF ${escape(match.choice.positionCard.card.def??'?')}</small></span></button>`:''}${actions.length>50?'<label class="duel-choice-search-label">Find a card<input id="duel-choice-search" type="search" autocomplete="off" placeholder="Card name…"></label>':''}<p class="duel-choice-help">${escape((match.choice?.instructions||(staged?'Tap cards to select or deselect. Confirm when ready.':'Choose a card or action.'))+(activationDraft?' Nothing paid yet; Cancel activation returns to your previous choice.':''))}</p><div class="duel-choice-list duel-choice-grid" id="duel-options-list" data-owned-content aria-label="${declaration==='race'?'Monster types':declaration?'Attributes':'Card choices'}"></div><div class="duel-choice-footer">${footer}${staged&&!match.choice.canFinish?'<button data-choice-tone="teal" disabled>Confirm selection</button>':''}<button data-action="close">Return to field</button></div>`;
    const pickerClass='duel-picker-body'+(match.choice?.positionCard?' duel-position-picker':'')+(coinChoice?' duel-coin-picker':'')+(declaration?' duel-declaration-picker':'');
    if(reuse&&modal.open&&modal.querySelector('.duel-picker-body'))patchArena(modal,`<div class="dialog-body ${pickerClass}">${markup}</div>`);else showDialog(markup,pickerClass);
    const update=()=>{
      const query=modal.querySelector('#duel-choice-search')?.value.toLowerCase()||'';
      const options=actions.map((action,index)=>({action,index})).filter(({action})=>!action.finish&&!action.cancel&&!action.reset).map(({action,index})=>({action,index,visuals:choiceVisuals(match,action,{isHidden,archive})})).filter(({action,visuals})=>!query||[actionDetail(action),...visuals.map(v=>v.name)].some(text=>text.toLowerCase().includes(query))).slice(0,100);
      const list=modal.querySelector('#duel-options-list');
      const content=options.map(({action,index,visuals})=>{
        const intent=choiceIntent(action,purpose),primary=visuals[0],selected=!!action.selected;
        if(action.declaration)return `<button class="duel-declaration" data-render-key="declaration:${index}" data-duel-choice="${index}" aria-pressed="${selected}" aria-label="${escape(declarationLabel(action.label,action.declaration))}"><span class="declaration-icon" aria-hidden="true">${declarationIcon(action.label,action.declaration)}</span><strong>${escape(declarationLabel(action.label,action.declaration))}</strong><span class="declaration-check" aria-hidden="true">${selected?'✓':''}</span></button>`;
        if(action.coinCall)return `<button class="duel-coin-choice" data-duel-choice="${index}" aria-label="Call ${action.coinCall}"><span class="duel-coin-choice-art">${coinMarkup(action.coinCall)}</span><span><small>CALL</small><strong>${action.coinCall}</strong></span><span class="duel-coin-choice-check" aria-hidden="true">→</span></button>`;
        const art=visuals.map(visual=>`<span class="duel-choice-thumb">${visual.hidden?cardBack():image(visual.card)}</span>`).join('');
        const detail=primary?[primary.place,primary.type].filter(Boolean).join(' · '):action.effectText||'';
        return `${primary?`<article class="duel-choice-entry" data-render-key="entry:${primary.uid||action.cardId||index}:${index}">`:''}<button class="${primary?'duel-choice-card':'duel-choice-action'}" data-render-key="choice:${primary?.uid||action.cardId||'option'}:${index}" data-duel-choice="${index}" data-choice-tone="${intent.tone}" ${staged?`aria-pressed="${selected}"`:''} aria-label="${escape((selected?'Selected: ':'')+(primary?.name||actionDetail(action))+' · '+intent.label)}">${primary?`<span class="duel-choice-art">${art}</span>`:`<span class="duel-choice-symbol" aria-hidden="true">${action.coinCall?coinMarkup(action.coinCall):action.yes===false?'×':action.yes===true?'✦':action.defense!==undefined?'↻':'◇'}</span>`}<span class="duel-choice-copy"><strong>${escape(primary?.name||actionDetail(action))}</strong>${detail?`<small>${escape(detail)}</small>`:''}<span class="duel-choice-badge">${selected?'✓ Selected':escape(intent.label)}</span></span></button>${primary?`${!primary.hidden?`<button class="duel-choice-read" data-choice-read="${index}" aria-label="Read ${escape(primary.name)} effect"><span>Read</span></button>`:''}</article>`:''}`;
      }).join('')||'<p class="duel-choice-empty">No matching cards. Try another name.</p>';
      patchArena(list,content);
      list.dataset.hasCards=String(options.some(option=>option.visuals.length));
    };
    const search=modal.querySelector('#duel-choice-search');if(search)search.oninput=update;update();
  }
  function selectionSource(){
    const native=match?.choice?.source,uid=match?.choice?.trigger?.uid;
    return (uid?choiceVisuals(match,{uid},{isHidden,archive:new Map(getCards().map(c=>[c.id,c]))})[0]:null)||(native?{card:native.card,name:native.card.name,hidden:false}:null);
  }
  function publicationCard(card){const archived=getCards().find(c=>c.id===card.id);return archived?{...card,tcgDate:archived.tcgDate||card.tcgDate,ocgDate:archived.ocgDate||card.ocgDate,setNames:archived.setNames?.length?archived.setNames:card.setNames}:card;}
  function readSelection(card,returnTo='choice'){
    if(!card)return;selectionRead={card,returnTo,query:modal.querySelector('#duel-choice-search')?.value,scroll:modal.querySelector('#duel-options-list')?.scrollTop};cancelArt();
    showDialog(`<div class="dialog-header"><h2 id="dialog-title">${escape(card.name)}</h2><button data-duel="selection-back" aria-label="Back to ${returnTo==='reveal'?'revealed cards':'selection'}">← Back</button></div><div class="card-reader-visual"><div class="selection-info-art">${image(card)}</div>${battleStatsHTML(card)}</div><div class="selection-info-copy">${cardFactsHTML(card)}${publicationHTML(publicationCard(card))}<div class="effect-text" tabindex="0" aria-label="Card effect">${escape(card.desc||'No effect text available for this card.')}</div></div>`,'duel-selection-info');
    cancelArt=sharpenCardArt(modal.querySelector('.selection-info-art'),card);
  }
  function selectionBack(){
    const saved=selectionRead,back=saved?.returnTo;selectionRead=null;cancelArt();
    if(back==='reveal'){showReveal();return;}
    if(match?.choice?.ordering)showOrderPicker();else if(match?.choice)choose(legalActions(match,0),match.choice.title,true);else closeDialog();
    const search=modal.querySelector('#duel-choice-search');if(search&&saved?.query!==undefined){search.value=saved.query;search.oninput?.();}const list=modal.querySelector('#duel-options-list');if(list&&saved?.scroll!==undefined)list.scrollTop=saved.scroll;
  }
  function showOrderPicker(){
    const ordering=match.choice?.ordering;if(!ordering)return;
    const original=[...ordering.cards].sort((a,b)=>ordering.kind.startsWith('deck')?(ordering.kind==='deck-bottom'?a.sequence-b.sequence:b.sequence-a.sequence):a.index-b.index).map(c=>c.index);
    if(orderDraft?.promptId!==match.choice.promptId)orderDraft={promptId:match.choice.promptId,original,indices:[...ordering.selected,...original.filter(i=>!ordering.selected.includes(i))]};
    const source=match.choice.source?.card,kind=ordering.kind,label=kind==='deck-top'?'Top of Deck':kind==='deck-bottom'?'Bottom of Deck':kind==='chain'?'Chain links':'Card order';
    const position=i=>kind==='deck-top'?(i===0?'TOP · draw next':`${i+1} · from top`):kind==='deck-bottom'?(i===0?'BOTTOM':`${i+1} · above bottom`):kind==='chain'?`Link ${i+1}${i===0?' · resolves last':''}`:`Position ${i+1}`;
    const rows=orderDraft.indices.map((index,i)=>{const entry=ordering.cards.find(c=>c.index===index),name=entry.card?.name||'Face-down card';return `<li data-order-index="${index}"><span class="order-position"><b>${i+1}</b><small>${escape(position(i))}</small></span><button class="order-card-read" data-order-read="${index}" ${entry.card?'':'disabled'} aria-label="Read ${escape(name)} effect">${entry.card?image(entry.card):cardBack()}</button><strong>${escape(name)}</strong><div class="order-moves"><button data-order-move="${index}" data-order-direction="-1" ${i===0?'disabled':''} aria-label="Move ${escape(name)} up">↑</button><button data-order-move="${index}" data-order-direction="1" ${i===orderDraft.indices.length-1?'disabled':''} aria-label="Move ${escape(name)} down">↓</button></div></li>`;}).join('');
    showDialog(`<aside class="order-sidebar"><div class="dialog-header"><h2 id="dialog-title">${escape(label)}</h2></div>${source?`<button class="order-source" data-duel="read-choice-source">${image(source)}<span><strong>${escape(source.name)}</strong><small>Read effect ↗</small></span></button>`:''}<p>${escape(match.choice.instructions)}</p><small class="order-rest">${kind.startsWith('deck')?`Only these ${ordering.cards.length} cards move. The rest of the Deck stays in order.`:kind==='chain'?'Last link resolves first.':'Review each position before confirming.'}</small><footer><button data-duel="order-reset" aria-label="Reset order">Reset</button><button class="primary" data-duel="order-confirm">Confirm order</button><button data-action="close" aria-label="Return to field">Field</button></footer></aside><ol class="duel-order-list" id="duel-options-list" aria-label="${escape(label)} · position 1 first">${rows}</ol>`,'duel-order-picker');
  }
  function commitOrder(){
    if(moving||!match?.choice?.ordering||orderDraft?.promptId!==match.choice.promptId)return;
    const previous=match,indices=[...orderDraft.indices];
    try{
      let next=match;const reset=legalActions(next,0).find(a=>a.reset);if(reset)next=applyAction(next,reset,0);
      for(const index of indices){const action=legalActions(next,0).find(a=>a.orderIndex===index);if(!action)throw new Error('That order is no longer available.');next=applyAction(next,action,0);}
      const finish=legalActions(next,0).find(a=>a.finish);if(!finish)throw new Error('Choose an order for every card.');
      next=applyAction(next,finish,0);orderDraft=null;selectionRead=null;present(previous,next);
    }catch(error){toast(error.message,true);}
  }
  function showReveal(index=null){
    const reveal=match?.reveals?.[0];if(!reveal||reveal.viewer!==0)return;
    revealSeen=reveal.id;clearTimeout(timer);cancelArt();inspectedUid=null;
    if(Number.isInteger(index)&&index>=0&&index<reveal.cards.length){
      const card=reveal.cards[index].card,source=modal.querySelector(`[data-duel-reveal-card="${index}"] img`);
      showDialog(`<h2 id="dialog-title" class="sr-only">${escape(card.name)}</h2><button class="duel-reveal-back" data-duel="reveal-list" data-reveal-return="${index}" aria-label="Back to revealed cards">${icon('close')}</button><div class="card-reader-visual"><div class="duel-reveal-art" role="img" aria-label="${escape(card.name)} · card ${index+1} of ${reveal.cards.length}">${image(card)}</div>${battleStatsHTML(card)}</div><aside class="reveal-effect-copy"><h3>${escape(card.name)}</h3>${cardFactsHTML(card)}${publicationHTML(publicationCard(card))}<div class="effect-text" tabindex="0" aria-label="Revealed card effect">${escape(card.desc||'No effect text available.')}</div></aside>`,`duel-reveal-body duel-reveal-zoom${config.animations&&!reducedMotion.matches?' reveal-motion':''}`);
      cancelArt=sharpenCardArt(modal.querySelector('.duel-reveal-art'),card,{source});
      modal.querySelector('[data-duel="reveal-list"]').focus({preventScroll:true});return;
    }
    showDialog(`${header(reveal.source?.name||'Revealed cards')}${reveal.source?'<button class="reveal-source-read" data-duel="read-reveal-source">Read resolving card effect ↗</button>':''}<p class="duel-reveal-caption">${reveal.ordered?'Top of Deck → bottom':[...new Set(reveal.cards.map(c=>(c.controller===0?'Your ':'AI’s ')+({deck:'Deck',hand:'hand',grave:'Graveyard',banished:'banished cards',extra:'Extra Deck'}[c.zone]||'cards')))].join(' · ')} · Tap to inspect</p><ol class="duel-reveal-list" aria-label="Revealed cards${reveal.ordered?', top first':''}">${reveal.cards.map((entry,i)=>`<li><button data-duel-reveal-card="${i}" aria-label="Card ${i+1}${i===0&&reveal.ordered?', top of Deck':''}: ${escape(entry.card.name)}; enlarge"><span class="duel-reveal-number">${i+1}</span>${image(entry.card)}</button></li>`).join('')}</ol><footer class="duel-reveal-footer"><button class="primary" data-duel="reveal-done">Done</button></footer>`,'duel-reveal-body');
  }
  function revealList(index){showReveal();modal.querySelector(`[data-duel-reveal-card="${index}"]`)?.focus({preventScroll:true});}
  function acknowledgeReveal(){const action=legalActions(match,0).find(a=>a.type==='ACK_REVEAL');if(action)step(action);}
  function showResponse(index=0){
    const offer=responseOffer(match,legalActions(match,0));if(!offer)return;
    clearTimeout(timer);motion.cancel();cancelArt();inspectedUid=null;
    responseSeen=offer.id;responseIndex=Math.min(index,offer.cards.length-1);
    const {card,action}=offer.cards[responseIndex],hidden=isHidden(card.uid);
    const name=hidden?'Face-down card':card.card.name,place=card.uid&&choiceVisuals(match,{uid:card.uid},{isHidden})[0]?.place;
    const text=hidden?'Hidden card':action.effectText&&!/Choose an effect option|Activate this effect|Continue\?/i.test(action.effectText)?action.effectText:effectExplanation(card.card,{phase:match.phase});
    const context=!hidden&&responseAdvice(match,card.card)||offer.context;
    showDialog(`${header(offer.phase)}<div class="duel-response-art">${hidden?cardBack():image(card.card)}</div><section class="duel-response-caption"><div class="duel-response-copy"><h3>${escape(name)}</h3><small>${hidden?'Hidden card':escape(cardTypeLabel(card.card)+(place?' · '+place:''))}</small></div>${hidden?'':publicationHTML(publicationCard(card.card))}<div id="duel-response-description" class="effect-text duel-response-description" tabindex="0" aria-label="Effect explanation">${escape(text)}</div><p class="duel-response-context">${escape(context)}</p>${offer.cards.length>1?`<nav class="duel-response-options" aria-label="Available card effects">${offer.cards.map(({card},i)=>`<button data-response-index="${i}" aria-pressed="${i===responseIndex}" aria-label="${escape(isHidden(card.uid)?'Hidden effect':card.card.name)} · option ${i+1}">${isHidden(card.uid)?cardBack():image(card.card)}<span>${i+1}</span></button>`).join('')}</nav>`:''}<div class="duel-response-actions"><button data-duel="response-activate" data-choice-tone="violet">${match.window?.forced&&offer.cards.length>1?'Choose next':'Activate'}</button>${offer.pass?'<button data-duel="response-pass" data-choice-tone="blue">Pass once</button><button data-duel="response-turn" data-choice-tone="gold" aria-label="Pass all optional responses for the rest of this turn">Auto-pass</button>':''}</div><p class="duel-response-note">Auto-pass declines optional effects for this turn, including attacks and chains. Phase effects and required choices still ask.</p></section>`,'duel-response-body duel-effect-choice-body');
    const rect=main.querySelector('.duel-table')?.getBoundingClientRect();
    modal.style.setProperty('--effect-center-x',rect?.width?`${rect.left+rect.width/2}px`:'50%');
    modal.style.setProperty('--effect-choice-width',rect?.width?`${Math.min(340,rect.width-12)}px`:'340px');
    if(!hidden)cancelArt=sharpenCardArt(modal.querySelector('.duel-response-art'),card.card,{source:main.querySelector(`[data-motion-uid="${card.uid}"] img:not(.card-back-image)`)});
  }
  function responseAction(kind){
    const offer=responseOffer(match,legalActions(match,0));if(!offer)return;
    const action=kind==='activate'?offer.cards[responseIndex]?.action:offer.pass;
    if(!action)return;
    if(kind==='turn')responsePolicy.passTurn(match);
    cancelArt();closeDialog();step(action,0,true);
  }
  function pickTarget(uid){
    if(moving||!fieldSelection)return;
    const picked=pickFieldCandidate(fieldSelection,uid);
    if(!picked){toast('Choose one of the highlighted cards.');return;}
    const title=fieldSelection.title;
    fieldSelection=picked.session;
    if(picked.actions){if(picked.actions.length===1)step(picked.actions[0]);else choose(picked.actions,title,true);}
    else {render();focusFieldTarget();}
  }
  function focusFieldTarget(){main.querySelector('[data-duel-card][data-role=eligible], [data-field-lp][data-role=eligible]')?.focus({preventScroll:true});}
  function inspection(){
    if(!inspectedUid)return null;
    const card=findCard(match,inspectedUid);
    if(!card||isHidden(inspectedUid)){inspectedUid=null;return null;}
    const actions=fieldSelection?[]:legalActions(match,0).filter(action=>action.uid===inspectedUid||action.type==='CHOOSE'&&action.target===inspectedUid),groups=[];
    for(const action of actions){const key=action.type+':'+!!action.set+':'+!!action.special+':'+(action.effectText||'');let group=groups.find(group=>group.key===key);if(!group){group={key,label:action.type==='SUMMON'&&!action.special&&(card.currentLevel??card.card.level)>=5?(action.set?'Tribute Set':'Tribute Summon'):labelFor(action),actions:[]};groups.push(group);}group.actions.push(action);}
    return {card,groups};
  }
  function inspect(uid){
    if(!findCard(match,uid))return;
    if(isHidden(uid)){toast('Your opponent’s face-down cards are hidden.');return;}
    motion.cancel();clearTimeout(timer);inspectedUid=uid;openInspection();render();
  }
  function openInspection(){
    const selected=inspection();if(!selected)return;const {card,groups}=selected;cardGroups=groups;
    const details=currentCardData(card),values=isMonster(details)?cardStatText(card,stats(match,card)):null,counters=cardCounters(card).map(c=>c.label).join(' · ');
    const ownHand=match.players[0].hand.some(c=>c.uid===card.uid);
    const usedNormal=match.normalSummons?.[0]||match.normalUsed;
    const summonNote=ownHand&&values&&match.active===0&&['main1','main2'].includes(match.phase)&&!match.window&&!match.choice&&!groups.some(g=>g.actions.some(a=>a.type==='SUMMON'))&&usedNormal?'You already Normal Summoned/Set this turn. Tribute Summons normally share that limit; another summon needs a card effect.':'';
    const flipNote=/\bFlip\b/i.test(card.card.type)?'When attacked face-down, Flip effects resolve after damage calculation. Battle destruction is already determined; a destroyed monster cannot be chosen as a target.':'';
    const timingNote=match.phase==='main2'&&card.controller===0&&card.faceUp&&match.players[0].monsters.some(c=>c?.uid===card.uid)&&phaseEffectText(card.card,'end')?'End Phase effect: choose End Phase to reach its activation window. The effect is offered when its conditions are met.':'';
    cancelArt();
    const source=main.querySelector(`[data-motion-uid="${card.uid}"] img:not(.card-back-image)`)||modal.querySelector(`[data-duel-card="${card.uid}"] img`);
    showDialog(`${header(card.card.name)}<div class="duel-inspect-visual card-reader-visual"><div class="duel-inspect-art">${image(card.card)}</div>${values?battleStatsHTML(details,values):''}</div><aside class="duel-inspect-options"><div class="duel-inspect-meta">${cardFactsHTML(details)}${counters?`<span class="duel-counter-description">${escape(counters)}</span>`:''}</div>${publicationHTML(publicationCard(card.card))}<div class="effect-text duel-inspect-description" id="duel-card-description" tabindex="0" aria-label="Card description">${escape(card.card.desc)}</div>${summonNote?`<p class="duel-summon-note">${escape(summonNote)}</p>`:''}${timingNote?`<p class="duel-summon-note">${escape(timingNote)}</p>`:''}${flipNote?`<p class="duel-summon-note">${escape(flipNote)}</p>`:''}<div class="duel-card-actions">${groups.map((group,index)=>`<button class="primary" data-duel-group="${index}" data-choice-tone="${choiceIntent(group.actions[0]).tone}">${escape(group.label)}${group.actions.length>1?'…':''}</button>`).join('')}</div></aside>`,'duel-card-viewer');
    cancelArt=sharpenCardArt(modal.querySelector('.duel-inspect-art'),card.card,{source});
  }
  function dismissInspection(){
    if(!inspectedUid)return;
    const uid=inspectedUid;cancelArt();inspectedUid=null;render();
    if(fieldSelection)focusFieldTarget();else main.querySelector(`[data-duel-card="${uid}"]`)?.focus({preventScroll:true});
  }
  const dialogClosed=()=>{if(!modal.open&&active){if(!moving&&selectionRead){selectionBack();return;}if(!moving&&modal.querySelector('.duel-reveal-body')&&match?.reveals?.[0]?.id===revealSeen){if(modal.querySelector('.duel-reveal-zoom'))revealList(Number(modal.querySelector('[data-reveal-return]')?.dataset.revealReturn));else acknowledgeReveal();}else if(inspectedUid)dismissInspection();else schedule();}};
  const revealCancel=event=>{if(active&&selectionRead){event.preventDefault();event.stopImmediatePropagation();selectionBack();return;}if(active&&modal.querySelector('.duel-reveal-zoom')){event.preventDefault();event.stopImmediatePropagation();revealList(Number(modal.querySelector('[data-reveal-return]')?.dataset.revealReturn));}};
  modal.addEventListener('close',dialogClosed);
  modal.addEventListener('cancel',revealCancel,true);
  function quickButtons(uid,field=false){
    if(fieldSelection)return '';
    const groups=quickCardActions(arenaActions,uid);
    if(field&&groups.length>1)return `<button class="duel-quick-action effect" data-duel-card="${uid}" title="${escape(groups.map(g=>g.label).join(' / '))}" aria-label="Choose an action for ${escape(visibleName(uid))}: ${escape(groups.map(g=>g.label).join(', '))}"><span aria-hidden="true">•••</span></button>`;
    return groups.map(group=>`<button class="duel-quick-action ${group.tone}" data-duel-quick="${uid}" data-duel-quick-type="${group.type}" title="${escape(group.label)}" aria-label="${escape(group.label)} with ${escape(visibleName(uid))}">${field?(group.tone==='attack'?icon('solo'):group.tone==='effect'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h6l-1 8 9-13h-6Z"/></svg>':'<span aria-hidden="true">↻</span>'):group.label}</button>`).join('');
  }
  function activityHTML(uid){
    const activity=cardActivity(match,uid,cue,fieldSelection);
    return activity.label?`<span class="duel-activity-tag" data-role="${activity.role}">${escape(activity.label)}</span>`:'';
  }
  function counterBadge(card){
    const counters=cardCounters(card);if(!counters.length)return '';
    return `<span class="duel-counter-badge" title="${escape(counters.map(c=>c.label).join('; '))}" aria-hidden="true">● ${counters.reduce((sum,c)=>sum+c.count,0)}</span>`;
  }
  function renderZone(card,side,zone,index){
    const hidden=side===1&&card&&!card.faceUp,available=card&&arenaActions.some(action=>action.uid===card.uid),activity=card?cardActivity(match,card.uid,cue,fieldSelection):{role:'',label:''};
    const label=card?(hidden?`Opponent’s face-down card, zone ${index+1}`:card.card.name):`${zone==='monsters'?'Monster':'Spell / Trap'} Zone ${index+1}`;
    const values=card&&zone==='monsters'?(hidden?{atk:'?',def:'?'}:card.faceUp?cardStatText(card,stats(match,card)):{atk:card.card.atk<0?'?':card.card.atk,def:card.card.def<0?'?':card.card.def}):null;
    return `<article class="duel-zone-shell ${zone==='monsters'?'monster-slot':'spell-slot'} ${values?'has-stats':''}" data-role="${activity.role}"><div class="duel-zone-surface"><button class="duel-zone ${card?'occupied':''} ${card&&!card.faceUp?'face-down':''} ${card?.position==='defense'?'defense':''} ${available?'actionable':''}" ${card?`data-duel-card="${card.uid}" data-motion-uid="${card.uid}"`:''} data-role="${activity.role}" data-motion-zone="${side}:${zone}:${index}" aria-label="${activity.role==='eligible'?'Legal target: ':''}${escape(label)}${card?.position==='defense'?' · Defense Position':''}${values?` · ATK ${values.atk} DEF ${values.def}`:''}${cardCounters(card).length?' · '+escape(cardCounters(card).map(c=>c.label).join('; ')):''}${activity.label?' · '+escape(activity.label):''}">${card?`<span class="duel-card-visual" style="--card-rotation:${cardRotation(side,card.position,zone)}deg">${hidden||!card.faceUp?cardBack():image(card.card)}</span>${counterBadge(card)}`:'<span class="duel-empty-mark" aria-hidden="true">◇</span>'}</button></div><div class="duel-card-rail">${values?`<div class="duel-card-stats" aria-hidden="true"><span><small>ATK</small><b>${values.atk}</b></span><span><small>DEF</small><b>${values.def}</b></span></div>`:''}${card?`<div class="duel-inline-actions">${quickButtons(card.uid,true)}</div>`:''}</div></article>`;
  }
  function renderLife(side){
    const player=match.players[side],direct=fieldCandidates(fieldSelection).directSide===side;
    const hit=match.pending?.kind==='attack'&&!match.pending.target&&match.pending.side!==side||cue?.directSide===side;
    const shown=displayLP?.[side]??player.lp,percent=Math.max(0,Math.min(100,shown/config.lp*100));
    return `<button class="duel-life ${side?'opponent-life':'player-life'}" data-duelist="${side}" data-field-lp="${side}" data-lp-max="${config.lp}" tabindex="${direct?0:-1}" aria-disabled="${!direct}" data-motion-zone="${side}:lp" data-role="${direct?'eligible':hit?'target':''}" aria-label="${direct?'Legal direct attack target: ':''}${side?'AI':'Your'} Life Points: ${Math.max(0,shown)}"><span>${side?'AI':'YOU'} <small>LP</small></span><strong data-lp-value="${side}">${Math.max(0,shown).toLocaleString()}</strong><i class="duel-life-meter" aria-hidden="true"><i style="width:${percent}%"></i></i>${direct?'<em>Tap to attack</em>':''}</button>`;
  }
  function renderPileZone(side,zone){
    const player=match.players[side],cards=player[zone],top=['grave','banished'].includes(zone)?cards.at(-1):null,name={deck:'Deck',grave:'Graveyard',extra:'Extra Deck',banished:'Banished'}[zone];
    const activity=cards.map(card=>cardActivity(match,card.uid,cue,fieldSelection)).find(value=>['source','target'].includes(value.role))||{role:''};
    return `<article class="duel-zone-shell duel-pile-slot" data-pile-zone="${zone}" title="${name}" ${zone==='grave'?`data-motion-zone="${side}:piles"`:''}><div class="duel-zone-surface"><button class="duel-zone duel-pile-zone ${cards.length?'occupied':''}" data-duel-pile="${side}" data-duel-pile-zone="${zone}" data-motion-zone="${side}:${zone}" ${top?`data-motion-uid="${top.uid}"`:''} data-role="${activity.role}" aria-label="${side?'AI':'Your'} ${name}: ${cards.length} cards; ${side&&zone==='extra'?'contents hidden':'open pile'}">${cards.length?`<span class="duel-card-visual" style="--card-rotation:${cardRotation(side,null,zone)}deg">${top&&!isHidden(top.uid)?image(top.card):cardBack()}</span>`:'<span class="duel-empty-mark" aria-hidden="true">◇</span>'}</button></div><b class="duel-pile-count" aria-hidden="true">${cards.length}</b></article>`;
  }
  function renderFieldZone(side){
    const field=match.players[side].field,hidden=side===1&&field&&!field.faceUp,activity=field?cardActivity(match,field.uid,cue,fieldSelection):{role:'',label:''};
    return `<article class="duel-zone-shell duel-field-slot" data-pile-zone="field"><div class="duel-zone-surface"><button class="duel-zone duel-field-zone ${field?'occupied':''}" ${field?`data-duel-card="${field.uid}" data-motion-uid="${field.uid}"`:'disabled'} data-motion-zone="${side}:field" data-role="${activity.role}" aria-label="${activity.role==='eligible'?'Legal target: ':''}${field?hidden?'Opponent’s Set Field Spell':escape(field.card.name):'Empty Field Spell zone'}${cardCounters(field).length?' · '+escape(cardCounters(field).map(c=>c.label).join('; ')):''}">${field?`<span class="duel-card-visual" style="--card-rotation:${cardRotation(side,null,'field')}deg">${hidden||!field.faceUp?cardBack():image(field.card)}</span>${counterBadge(field)}`:'<span class="duel-empty-mark" aria-hidden="true">◇</span>'}</button></div>${field?`<div class="duel-inline-actions">${quickButtons(field.uid,true)}</div>`:''}</article>`;
  }
  function renderHand(side){
    const player=match.players[side];
    if(side===1)return `<div class="duel-opponent-hand" data-motion-zone="1:hand" role="group" aria-label="AI hand: ${player.hand.length} hidden cards">${player.hand.map(card=>isHidden(card.uid)?`<span class="duel-opponent-card" data-render-key="${card.uid}" data-motion-uid="${card.uid}" aria-hidden="true">${cardBack()}</span>`:`<button class="duel-opponent-card duel-revealed-hand" data-render-key="${card.uid}" data-motion-uid="${card.uid}" data-duel-card="${card.uid}" aria-label="Revealed: ${escape(card.card.name)}">${image(card.card)}</button>`).join('')}</div>`;
    return `<div class="duel-hand-area" data-expanded="${handExpanded}"><button class="duel-hand-zoom" data-duel="hand-zoom" aria-pressed="${handExpanded}" aria-label="${handExpanded?'Reduce hand size':'Enlarge hand to fit all cards'}">${handExpanded?'1×':'2×'}</button><div class="duel-hand-rack"><div class="duel-hand" data-motion-zone="0:hand" role="group" aria-label="Your hand: ${player.hand.length} cards; all cards visible">${player.hand.map(card=>{const activity=cardActivity(match,card.uid,cue,fieldSelection);return `<article class="duel-hand-shell" data-render-key="${card.uid}" data-role="${activity.role}"><button class="duel-hand-card ${arenaActions.some(action=>action.uid===card.uid)?'actionable':''}" data-duel-card="${card.uid}" data-motion-uid="${card.uid}" data-role="${activity.role}" aria-label="${escape(card.card.name)}${activity.label?' · '+activity.label:''}">${image(card.card)}</button>${activityHTML(card.uid)}<div class="duel-inline-actions">${quickButtons(card.uid)}</div></article>`;}).join('')||'<span class="duel-empty-hand">Your hand is empty</span>'}</div></div></div>`;
  }
  function renderSide(side){
    const player=match.players[side],row=zone=>{
      const cells=player[zone].map((card,index)=>renderZone(card,side,zone,index));
      return `<div class="duel-zone-row ${zone==='monsters'?'monster-zones':'backrow-zones'}" data-motion-zone="${side}:${zone}">${cells.join('')}</div>`;
    };
    return `<section ${introPending?'inert':''} class="duel-side ${side?'opponent-side':'player-side'}" data-field-side="${side}" aria-label="${side?'AI · top':'You · bottom'} side of the field"><div class="duel-mat"><div class="duel-auxiliary-zones" data-relative-side="left" aria-label="${side?'AI':'Your'} left: Field Spell and Extra Deck">${renderFieldZone(side)}${renderPileZone(side,'extra')}</div><div class="duel-board ${side?'opponent':'yours'}" aria-label="${side?'Opponent':'Your'} field">${side?row('spells')+row('monsters'):row('monsters')+row('spells')}</div><div class="duel-pile-zones" data-relative-side="right" aria-label="${side?'AI':'Your'} right: Graveyard and Deck"><div class="duel-grave-group">${renderPileZone(side,'grave')}${renderPileZone(side,'banished')}</div>${renderPileZone(side,'deck')}</div></div>${renderHand(side)}${side===0?renderLife(side):''}</section>`;
  }
  function renderArena(){
    const previousPhase=main.querySelector('.duel-phases')?.dataset.phase;
    clearTimeout(timer);
    if(match.choice?.side===0&&!match.reveals?.length&&!fieldSelection)fieldSelection=makeFieldSelection(match,match.choice.options,{title:match.choice.title,sourceUid:match.choice.trigger?.uid,mandatory:true});
    const actions=legalActions(match,0),aiActions=legalActions(match,1),needsChoice=match.choice?.side===0,respond=match.window?.priority===0,canPass=actions.some(a=>a.type==='PASS'),canNext=actions.some(a=>a.type==='NEXT'),canEnd=actions.some(a=>a.type==='END'),discard=actions.some(a=>a.type==='DISCARD'),won=match.winner!==null;
    arenaActions=actions;
    const busy=aiActions.length>0,candidates=fieldCandidates(fieldSelection),selected=inspection();
    if(!selected&&modal.querySelector('.duel-card-viewer')&&modal.open){cancelArt();closeDialog();}
    const prompt=won?match.winner==='draw'?'A hard-fought draw.':match.winner===0?'Victory. Your strategy paid off.':'Defeat. A new strategy awaits.':fieldSelection?fieldSelection.native&&fieldSelection.kind==='tribute'?match.choice.instructions:`${fieldSelection.title} · ${fieldSelection.key==='tributes'?`choose ${candidates.remaining} more tribute${candidates.remaining===1?'':'s'}`:'tap a highlighted card'+(candidates.directSide!==null?' or the AI’s LP':'')}.`:inspectedUid?cardGroups.length?'Choose an action on the card. Close it to return.':'Duel paused · close card details to continue.':needsChoice?match.choice.title:discard?'Hand limit: choose a card to discard until six remain.':respond?match.window.timing?match.window.timing:match.chain.length?`Respond to ${match.chain.at(-1).card.name}, or pass.`:match.pending?.kind==='attack'?'An attack is incoming. Respond or pass.':'Response window · play a fast effect or pass.':busy?'AI is considering its next move…':mainPhaseLabel(match);
    const passing=responsePolicy.isPassing(match);
    const cancelChoice=actions.find(a=>a.cancel);
    let controls;
    if(match.reveals?.[0]?.viewer===0)controls='<button class="primary" data-duel="view-reveal">View cards</button>';
    else if(won)controls='<button class="primary" data-duel="rematch">New duel</button><button data-duel="duel-menu">Details</button>';
    else if(fieldSelection?.native)controls=`<button class="primary" data-duel="confirm-choice" ${!match.choice?.canFinish?'disabled':''}>Confirm</button><button data-duel="resolve-choice" aria-label="View selectable cards">Cards</button>${cancelChoice?`<button data-duel="cancel-choice" class="duel-cancel-choice" aria-label="${escape(cancelChoice.label)}">Cancel</button>`:''}`;
    else if(fieldSelection)controls=`${fieldSelection.mandatory?'':'<button data-duel="cancel-target" class="duel-cancel-choice">Cancel</button>'}<button data-duel="inspect-source" ${!fieldSelection.sourceUid?'disabled':''}>Card info</button>`;
    else if(needsChoice&&match.choice.optionalResponse)controls='<button class="primary" data-duel="respond">Review effect</button><button data-duel="response-pass">Pass once</button>';
    else if(needsChoice||discard)controls=`<button class="primary" data-duel="resolve-choice">${discard?'Discard':'Choose cards'}</button>${cancelChoice?'<button data-duel="cancel-choice" class="duel-cancel-choice">Cancel</button>':''}`;
    else if(respond)controls=`<button class="primary" data-duel="respond" ${actions.length<2?'disabled':''}>Review card</button><button data-duel="pass" ${!canPass?'disabled':''}>Pass</button>`;
    else controls=`<button class="primary" data-duel="next" ${!canNext?'disabled':''}>${busy?'AI turn…':match.phase==='end'?'Next turn':`Next: ${actions.find(a=>a.type==='NEXT')?.label||nextLabel(match)}`}</button><button data-duel="end" title="Enter the End Phase and resolve eligible effects before the next turn" ${!canEnd?'disabled':''}>End Phase</button>`;
    if(activationDraft&&needsChoice)controls+='<button data-duel="cancel-activation" class="duel-cancel-choice">Cancel activation</button>';
    const phases=`<ol class="duel-phases" data-phase="${match.phase}" data-battle-step="${match.battleStep||''}" data-changed="${previousPhase!==match.phase}" aria-label="Phase tracker">${PHASES.map((phase,index)=>`<li ${match.phase===phase?'aria-current="step"':''} class="${index<PHASES.indexOf(match.phase)?'complete':''}" aria-label="${escape(PHASE_LABELS[phase])}" title="${escape(PHASE_LABELS[phase])}"><span>${['D','S','M1','B','M2','E'][index]}</span><small>${phase==='battle'&&BATTLE_STEPS[match.battleStep]?BATTLE_STEPS[match.battleStep].short:PHASE_LABELS[phase]}</small></li>`).join('')}</ol>`;
    patchArena(main,`<div class="duel-session">
      <section class="screen duel-arena ${config.animations&&!reducedMotion.matches?'animated':''}" data-selecting="${!!fieldSelection}" data-intro="${!!introPending}" aria-label="Solo Duel arena">
      <div class="duel-table" aria-label="Duel field · AI at top, you at bottom; all Monster and Spell/Trap zones visible">
        ${renderSide(1)}<div class="duel-midline"><p class="duel-prompt" id="duel-decision" role="status" aria-live="polite" title="${escape(prompt)}">${escape(match.reveals?.[0]?.viewer===0?'Inspect the revealed cards, then return to play.':prompt)}</p></div><nav class="duel-phase-rail" ${introPending?'inert':''} aria-label="Duel phases">${phases}</nav>${renderSide(0)}<svg class="duel-target-arrows" data-owned-content aria-hidden="true"></svg><div class="duel-intro-host" data-owned-content></div><div class="duel-effect-host" data-owned-content></div><div class="duel-battle-host" data-owned-content></div>
      ${renderLife(1)}
      <nav class="duel-utility-actions" aria-label="Duel tools">${passing?'<button class="duel-response-policy" data-duel="ask-again" aria-label="Auto-pass is on for this turn; ask again">Auto-pass <b>Undo</b></button>':''}<button class="duel-log-open" data-duel="log" aria-label="Open duel log">${icon('archive')}</button><button class="duel-menu-button" data-duel="duel-menu" aria-label="Duel settings and surrender">•••</button></nav>
      <section class="duel-action-area" aria-label="Current decision" aria-describedby="duel-decision"><div class="duel-controls" data-action-layout="${fieldSelection?.native?'selection':'standard'}">
      ${controls}</div></section>
      </div>
      </section></div>`);
    fitArena();
    setMoving(moving);schedule();
  }
  function setMoving(value){
    const arena=main.querySelector('.duel-arena');if(!arena)return;
    attackArrows.sync(match,fieldSelection,{hidden:value});
    arena.dataset.moving=String(value);arena.setAttribute('aria-busy',String(value));
    if(value)for(const button of arena.querySelectorAll('.duel-controls button:not([disabled]), .duel-quick-action:not([disabled]), .duel-hand-zoom:not([disabled])'+(introPending?', .duel-menu-button:not([disabled])':''))){button.disabled=true;button.dataset.motionDisabled='true';}
    else for(const button of arena.querySelectorAll('[data-motion-disabled]')){button.disabled=false;delete button.dataset.motionDisabled;}
  }
  async function present(previous,next,action=null){
    clearTimeout(timer);
    const previousList=modal.open?modal.querySelector('#duel-options-list'):null;
    const keepPicker=!!(previousList&&previous?.choice?.promptId&&previous.choice.promptId===next.choice?.promptId);
    const choiceScroll=previousList?.scrollTop||0,choiceQuery=modal.querySelector('#duel-choice-search')?.value||'';
    const battles=battlePresentations(previous,next);
    const combatCards=new Set([previous?.pending,next.pending].filter(p=>p?.kind==='attack').flatMap(p=>[p.uid,p.target]).concat(battles.flatMap(b=>[b.attacker.uid,b.defender?.uid])));
    const notices=(previous?cardPresentations(previous,next):effectNotices(null,next)).filter(n=>!combatCards.has(n.uid)||!['flip','summon'].includes(n.stage));
    const coins=next.log.filter(e=>e.id>(previous?.serial||0)&&e.coinNotice).map(e=>e.coinNotice);
    const before=captureArena(main),motions=planMotion(previous,next,next.version===2?((next.visualAction?.presentation==='paired'?null:next.visualAction)||(action?.type==='ATTACK'?null:action)):action),token=++presentation;
    const nextCue=activityCue(previous,next,next.visualAction||action);
    cue=action?.cancel?null:nextCue||(previous?.phase===next.phase?cue:null);
    fieldSelection=null;cancelArt();inspectedUid=null;selectionRead=null;displayLP=previous&&config.animations&&!reducedMotion.matches?previous.players.map(p=>p.lp):null;match=next;
    if(match.active===0&&match.phase==='draw')openingTurn=match.turn;
    moving=true;if(!keepPicker)closeDialog();render();

    try{
      if(introPending&&active){
        const completed=await intro.play(introPending,{enabled:config.animations,reduced:reducedMotion.matches});
        if(token!==presentation||!active)return;
        if(!completed)return;
        finishOpening();
      }
      for(const coin of coins){if(token!==presentation||!active)return;await intro.coin(coin,{enabled:config.animations,reduced:reducedMotion.matches});}
      if(active&&battles.length)await battle.play(battles,{enabled:config.animations,reduced:reducedMotion.matches});
      if(token!==presentation||!active)return;
      if(active)await motion.play(battles.length?motions.filter(m=>!['attack','impact'].includes(m.type)):motions,before,{enabled:config.animations&&!reducedMotion.matches});
      if(token!==presentation||!active)return;
      await effects.play(notices,{enabled:config.animations,reduced:reducedMotion.matches});
      if(token===presentation&&active&&match.winner!==null&&!resultShown){resultShown=true;await intro.result({winner:match.winner},{enabled:true,reduced:reducedMotion.matches||!config.animations});}
    }
    catch{motion.cancel();effects.cancel();battle.cancel();if(introPending&&token===presentation&&active){intro.cancel();finishOpening();}} // Motion failures must never block a legal move.
    finally{
      if(token===presentation){
        displayLP=null;for(const [side,p] of match.players.entries())paintLife(main,side,p.lp);
        moving=false;setMoving(false);
        if(active&&!match.reveals?.length&&match.choice?.side===0&&!match.choice.optionalResponse&&(keepPicker||!fieldSelection)){
          choose(legalActions(match,0),match.choice.title,true,keepPicker);
          if(keepPicker){
            const search=modal.querySelector('#duel-choice-search');
            if(search){search.value=choiceQuery;search.dispatchEvent(new window.Event('input'));}
            const list=modal.querySelector('#duel-options-list');if(list)list.scrollTop=choiceScroll;
          }
        }
        if(active)schedule();
      }
    }
  }

  function reviewActivation(action){
    const source=findCard(match,action.uid),card=action.effectCard||source?.card;
    if(!card)return false;
    activationReview=action;clearTimeout(timer);cancelArt();inspectedUid=null;
    const text=activationText(card,action,match.phase),phaseNote=phaseEffectText(card,'end'),upgrade=phaseNote.match(/Special Summon (?:1 )?"([^"]+)"/i),timing=upgrade?`Level-up: ${upgrade[1]} · End Phase${/destroyed.*by battle/i.test(phaseNote)?' after destroying a monster by battle':''}.`:'Separate End Phase effect: enter End Phase to check its conditions.';
    showDialog(`${header(card.name)}<div class="duel-response-art">${image(card)}</div><section class="duel-response-caption"><div class="duel-response-copy"><h3>${escape(activationLabel(action))}</h3><small>${escape(PHASE_LABELS[match.phase])}</small></div>${publicationHTML(publicationCard(card))}<div class="effect-text duel-response-description" tabindex="0" aria-label="Effect to activate">${escape(text)}</div>${phaseNote&&!text.includes(phaseNote)?`<p class="duel-response-context">${escape(timing)}</p>`:''}<p class="duel-response-note">Continue commits immediate costs. For card costs, select and confirm to pay. Paid costs cannot be undone.</p><div class="duel-response-actions"><button data-duel="confirm-activation" data-choice-tone="violet">Continue with this effect</button><button data-action="close">Back</button></div></section>`,'duel-response-body duel-activation-review');
    cancelArt=sharpenCardArt(modal.querySelector('.duel-response-art'),card);return true;
  }
  async function cancelActivation(){
    const draft=activationDraft;if(!draft||moving)return;
    clearTimeout(timer);cancelThinking();cancelArt();moving=true;setMoving(true);const token=++presentation;
    try{
      const restored=await engine.restoreMatch(draft.save,{cards:getCards()});
      if(!active||token!==presentation){engine.destroyMatch?.(restored);return;}
      const old=match;restored.deckBackups=old.deckBackups;engine.destroyMatch?.(old);match=restored;
      activationDraft=null;activationReview=null;fieldSelection=null;inspectedUid=null;responseSeen=null;cue=null;closeDialog();moving=false;render();schedule();
    }catch(error){if(active&&token===presentation){moving=false;toast(error.message,true);render();}}
  }
  async function step(action,side=0,reviewed=false){
    if(moving)return;
    if(side===0&&!reviewed&&['ACTIVATE','EFFECT'].includes(action.type)&&match.version===2&&!match.window?.forced&&reviewActivation(action))return;
    try{
      const starts=side===0&&(['ACTIVATE','EFFECT'].includes(action.type)||action.yes===true&&match.choice?.optionalResponse)&&!match.window?.forced;
      if(starts&&engine.exportMatch&&engine.restoreMatch)activationDraft={save:engine.exportMatch(match),before:match};
      const next=applyAction(match,action,side);
      if(activationDraft&&!activationUnchanged(activationDraft.before,next))activationDraft=null;
      await present(match,next,action);
    }catch(error){activationDraft=null;toast(error.message,true);render();}
  }
  function finishOpening(){introPending=null;main.querySelector('.duel-arena').dataset.intro='false';for(const node of main.querySelectorAll('.duel-side[inert], .duel-phase-rail[inert]'))node.removeAttribute('inert');}
  async function resumeOpening(){
    const token=++presentation;moving=true;setMoving(true);
    try{
      const completed=await intro.play(introPending,{enabled:config.animations,reduced:reducedMotion.matches});
      if(!completed||token!==presentation||!active)return;
      finishOpening();
      const before=captureArena(main);before.cards.clear();
      await motion.play(planMotion(null,match),before,{enabled:config.animations&&!reducedMotion.matches});
    }catch{motion.cancel();if(introPending&&token===presentation&&active){intro.cancel();finishOpening();}
    }finally{if(token===presentation){moving=false;setMoving(false);schedule();}}
  }
  function schedule(){
    clearTimeout(timer);
    if(!active||moving||thinking||!match||match.winner!==null||document.visibilityState==='hidden')return;
    if(introPending){resumeOpening();return;}
    if(match.reveals?.[0]?.viewer===0){if(!modal.open)showReveal();return;}
    if(inspectedUid&&!modal.open){dismissInspection();return;}
    if(modal.open){timer=setTimeout(schedule,100);return;}
    if(fieldSelection)return;
    const humanActions=legalActions(match,0),required=automaticEffectAction(match,humanActions);
    if(required){timer=setTimeout(()=>step(required),0);return;}
    const repeatPass=responsePolicy.action(match,humanActions);
    if(repeatPass){timer=setTimeout(()=>{if(modal.open)schedule();else step(repeatPass);},config.animations?100:20);return;}
    const offer=responseOffer(match,humanActions);
    if(offer){if(responseSeen!==offer.id){showResponse();timer=setTimeout(schedule,100);}return;}
    if(match.active===0&&match.phase==='draw')openingTurn=match.turn;
    if(match.phase==='main1'&&!match.window&&!match.choice)openingTurn=null;
    const automatic=automaticOpeningAction(match,openingTurn);
    if(automatic){timer=setTimeout(()=>{if(!active)return;if(modal.open){schedule();return;}step(automatic);},config.animations&&!reducedMotion.matches?220:20);return;}
    const aiActions=legalActions(match,1);
    if(aiActions.length){
      const delay=aiActions.length===1&&aiActions[0].type==='PASS'?(config.animations?90:20):decisionDelay(config.aiSpeed);
      timer=setTimeout(async()=>{
        if(!active)return;if(modal.open){schedule();return;}
        const current=match,prompt=aiActions.map(a=>a.id).join('|'),token=++presentation;thinking=token;
        const action=aiActions.length===1?aiActions[0]:match.version===2?await aiClient.decide(match,1):chooseAIAction(match,1);
        if(thinking!==token)return;thinking=0;
        if(!active||moving||match!==current||token!==presentation||document.visibilityState==='hidden')return;
        if(modal.open||prompt!==legalActions(match,1).map(a=>a.id).join('|')){schedule();return;}
        const legal=legalActions(match,1).find(a=>a.id===action?.id);if(legal)step(legal,1);else schedule();
      },delay);return;
    }
    const actions=legalActions(match,0);
    if(actions.length===1&&actions[0].type==='PASS')timer=setTimeout(()=>{if(modal.open)schedule();else step(actions[0]);},config.animations?100:20);
  }
  function showPiles(side,zone='grave'){
    const player=match.players[side],names={deck:'Deck',grave:'Graveyard',extra:'Extra Deck',banished:'Banished'};
    if(!Object.hasOwn(names,zone))zone='grave';
    const hidden=zone==='deck'||side===1&&zone==='extra',cards=hidden?[]:['grave','banished'].includes(zone)?[...player[zone]].reverse():player[zone];
    motion.cancel();cancelArt();inspectedUid=null;
    showDialog(`${header(`${side===0?'Your':'AI'} ${names[zone]} · ${player[zone].length}`)}<div class="duel-choice-list" aria-label="${names[zone]} contents">${hidden?`<p class="solo-note">${zone==='deck'?'The Deck stays face-down; drawing is automatic.':'The AI’s Extra Deck stays face-down.'}</p>`:cards.length?cards.map(card=>`<button class="duel-public-card" data-duel-card="${card.uid}">${isHidden(card.uid)?cardBack():image(card.card)}<span><strong>${isHidden(card.uid)?'Face-down card':escape(card.card.name)}</strong><small>${isHidden(card.uid)?'Hidden':escape(cardTypeLabel(card.card))}</small></span></button>`).join(''):`<p class="solo-note">${names[zone]} is empty.</p>`}</div>`,'duel-pile-body');
  }
  function showLog(){
    motion.cancel();
    const player=match.players[0],foe=match.players[1],groups=groupedLog(match.log,logFilter);
    showDialog(`${header('Duel log')}<div class="duel-log-summary"><span>You <strong>${Math.max(0,player.lp).toLocaleString()} LP</strong></span><span>Turn ${match.turn} · ${escape(PHASE_LABELS[match.phase])}</span><span>AI <strong>${Math.max(0,foe.lp).toLocaleString()} LP</strong></span></div><div class="duel-log-filters" aria-label="Log events">${[['all','All events'],['battle','Battle & LP'],['cards','Card actions']].map(([value,label])=>`<button data-duel-log-filter="${value}" aria-pressed="${logFilter===value}">${label}</button>`).join('')}</div><div class="duel-choice-list duel-log" id="duel-log-scroll" aria-label="Chronological duel events">${groups.map(group=>`<section class="duel-log-turn"><h3>Turn ${group.turn}</h3>${group.entries.map(entry=>`<article class="duel-log-entry" data-kind="${entry.kind}"><div class="duel-log-meta"><span>${escape(logKindLabel(entry.kind))}</span><span>${entry.side===0?'YOU':'AI'} · ${escape(PHASE_LABELS[entry.phase]||entry.phase||'')}</span></div><p>${escape(entry.message)}</p></article>`).join('')}</section>`).join('')||'<p>No events match this filter.</p>'}<div id="duel-log-latest"></div></div><div class="dialog-actions"><button data-duel="log-latest">Jump to latest ↓</button><button class="primary" data-action="close">Return to duel</button></div>`,'duel-log-body');
    jumpToLatest(false);
  }
  function jumpToLatest(smooth=true){
    const list=modal.querySelector('#duel-log-scroll');if(!list)return;
    if(typeof list.scrollTo==='function')list.scrollTo({top:list.scrollHeight,behavior:smooth&&!reducedMotion.matches?'smooth':'instant'});else list.scrollTop=list.scrollHeight;
  }
  function speedControl(){return `<label class="duel-speed-label">AI decision speed<select id="duel-ai-speed">${Object.entries(AI_SPEEDS).map(([key,speed])=>option(key,speed.label,config.aiSpeed)).join('')}</select></label>`;}
  function duelMenu(){
    motion.cancel();
    showDialog(`${header('Duel settings')}
      <div class="duel-menu-preferences">${speedControl()}<button class="duel-motion-toggle" data-duel="toggle-motion" aria-pressed="${config.animations}"><span>Card motion</span><b>${config.animations?'On':'Off'}</b></button></div>
      ${responsePolicy.isPassing(match)?'<button class="duel-response-policy" data-duel="ask-again">Auto-pass is on <b>Ask again</b></button>':''}
      <p class="duel-menu-note">Save to resume later. Exit ends the current unsaved duel.</p>
      <div class="duel-menu-footer"><button class="primary" data-action="close">${icon('play')}<span>Resume duel</span></button><button data-duel="save-exit" ${match.winner!==null?'disabled':''}>${icon('save')}<span>Save & exit</span></button><button data-duel="exit-duel">${icon('exit')}<span>Exit duel</span></button><button class="danger" data-duel="surrender" ${match.winner!==null?'disabled':''}>${icon('flag')}<span>Surrender</span></button></div>`,'duel-menu-body');
    const select=modal.querySelector('#duel-ai-speed');select.value=config.aiSpeed;
    select.onchange=event=>{config.aiSpeed=event.target.value;persist();schedule();};
  }
  function handleClick(event){
    if(!active)return;const target=event.target.closest('button');if(!target)return;
    if(target.dataset.resumeDuel){resumeSaved(target.dataset.resumeDuel);return;}
    if(target.dataset.deleteDuel){try{deleteDuelSave(localStorage,target.dataset.deleteDuel);render();}catch{toast('Could not delete the saved duel.',true);}return;}
    if(target.dataset.duelTab!==undefined){tab=Number(target.dataset.duelTab);render();if(tab<2&&config.sides[tab].source==='set'&&setsStatus==='idle')requestSets();return;}
    if(target.dataset.duelQuick){if(moving)return;const actions=legalActions(match,0).filter(action=>action.uid===target.dataset.duelQuick&&action.type===target.dataset.duelQuickType);choose(actions,`${labelFor(actions[0]||{})}: ${visibleName(target.dataset.duelQuick)}`);return;}
    if(target.dataset.fieldLp!==undefined){if(fieldSelection&&fieldCandidates(fieldSelection).directSide===Number(target.dataset.fieldLp))pickTarget(null);return;}
    if(target.dataset.duelCard){if(fieldSelection)pickTarget(target.dataset.duelCard);else inspect(target.dataset.duelCard);return;}
    if(target.dataset.duelPile!==undefined){showPiles(Number(target.dataset.duelPile),target.dataset.duelPileZone);return;}
    if(target.dataset.duelLogFilter){logFilter=target.dataset.duelLogFilter;showLog();return;}
    if(target.dataset.responseIndex!==undefined){showResponse(Number(target.dataset.responseIndex));return;}
    if(target.dataset.duelRevealCard!==undefined){showReveal(Number(target.dataset.duelRevealCard));return;}
    if(target.dataset.action==='close'&&target.closest('.duel-reveal-body')){acknowledgeReveal();return;}
    if(target.dataset.duelChoice!==undefined){const action=selection[Number(target.dataset.duelChoice)];if(action)step(action);return;}
    if(target.dataset.duelGroup!==undefined){const group=cardGroups[Number(target.dataset.duelGroup)];if(group)choose(group.actions,group.label);return;}
    if(target.dataset.choiceRead!==undefined){const action=selection[Number(target.dataset.choiceRead)],visual=action&&choiceVisuals(match,action,{isHidden,archive:new Map(getCards().map(c=>[c.id,c]))})[0];if(visual&&!visual.hidden)readSelection(visual.card);return;}
    if(target.dataset.orderRead!==undefined){const card=match.choice?.ordering?.cards.find(c=>c.index===Number(target.dataset.orderRead))?.card;readSelection(card);return;}
    if(target.dataset.orderMove!==undefined){if(!orderDraft)return;const from=orderDraft.indices.indexOf(Number(target.dataset.orderMove)),to=from+Number(target.dataset.orderDirection);if(from>=0&&to>=0&&to<orderDraft.indices.length){[orderDraft.indices[from],orderDraft.indices[to]]=[orderDraft.indices[to],orderDraft.indices[from]];showOrderPicker();modal.querySelector(`[data-order-move="${target.dataset.orderMove}"][data-order-direction="${target.dataset.orderDirection}"]:not([disabled])`)?.focus({preventScroll:true});}return;}
    const action=target.dataset.duel;
    if(action==='confirm-activation'){const pending=activationReview;activationReview=null;if(pending){cancelArt();closeDialog();step(pending,0,true);}return;}
    if(action==='cancel-activation'){cancelActivation();return;}
    if(action==='read-position-card'){readSelection(match.choice?.positionCard?.card);return;}
    if(action==='read-choice-source'){const source=selectionSource();if(source&&!source.hidden)readSelection(source.card);return;}
    if(action==='read-reveal-source'){readSelection(match?.reveals?.[0]?.source,'reveal');return;}
    if(action==='selection-back'){selectionBack();return;}
    if(action==='order-reset'){if(orderDraft){orderDraft.indices=[...orderDraft.original];showOrderPicker();}return;}
    if(action==='order-confirm'){commitOrder();return;}
    if(action==='response-activate'){responseAction('activate');return;}
    if(action==='response-pass'){responseAction('pass');return;}
    if(action==='response-turn'){responseAction('turn');return;}
    if(action==='ask-again'){responsePolicy.askAgain();responseSeen=null;closeDialog();render();return;}
    if(action==='save-exit'){if(saveCurrent())exitCurrent();return;}
    if(action==='exit-duel'){exitCurrent();return;}
    if(action==='hand-zoom'){handExpanded=!handExpanded;render();return;}
    if(action==='view-reveal'){showReveal();return;}
    if(action==='reveal-list'){revealList(Number(target.dataset.revealReturn));return;}
    if(action==='reveal-done'){acknowledgeReveal();return;}
    if(action==='cancel-choice'){const cancel=legalActions(match,0).find(a=>a.cancel);if(cancel)step(cancel);return;}
    if(action==='filters')filters();if(action==='coverage')coverage();if(action==='support-list')coverage(true);if(action==='start')start();if(action==='sets-retry')requestSets(true);
    if(action==='design')onDesign(tab,selectedDeck(tab),config.sides[tab]);
    if(action==='cancel-target'){if(!fieldSelection?.mandatory){fieldSelection=null;render();}return;}
    if(action==='inspect-source'){if(fieldSelection?.sourceUid)inspect(fieldSelection.sourceUid);return;}
    if(action==='duel-menu')duelMenu();if(action==='log')showLog();if(action==='log-latest')jumpToLatest();
    if(action==='toggle-motion'){config.animations=!config.animations;persist();duelMenu();}
    if(action==='rematch'){if(moving||starting||match?.winner===null)return;target.disabled=true;target.textContent='Dealing…';cancelThinking();cancelMotion();clearTimeout(timer);presentation++;engine.destroyMatch?.(match);match=null;moving=false;fieldSelection=null;inspectedUid=null;orderDraft=null;selectionRead=null;cue=null;openingTurn=null;responseSeen=null;revealSeen=null;closeDialog();start();return;}
    if(action==='surrender'){
      showDialog(`${header('Surrender this duel?')}<p>The current match will end. Your saved decks stay on this device.</p><div class="dialog-actions"><button data-action="close">Keep playing</button><button class="danger" data-duel="confirm-surrender">Surrender</button></div>`);
    }
    if(action==='confirm-surrender')step({type:'SURRENDER'});
    if(action==='next')step({type:'NEXT'});if(action==='end')step({type:'END'});if(action==='pass')step({type:'PASS'});
    if(action==='respond')showResponse(responseIndex);
    if(action==='confirm-choice'){const finish=legalActions(match,0).find(a=>a.finish);if(finish)step(finish);return;}
    if(action==='resolve-choice')choose(legalActions(match,0).filter(a=>['CHOOSE','DISCARD'].includes(a.type)),match.choice?.title||'Discard to six cards',true);
  }
  document.addEventListener('click',handleClick);
  return {
    enter(){active=true;render();if(!match&&config.sides.some(s=>s.source==='set')&&setsStatus==='idle')requestSets();},
    leave(){launchSequence++;starting=false;engine.destroyMatch?.(match);match=null;activationDraft=null;activationReview=null;displayLP=null;introPending=null;handExpanded=false;document.documentElement.dataset.duelRotated='false';cancelThinking();cancelArt();attackArrows.sync(null,null,{hidden:true});responseSeen=null;active=false;inspectedUid=null;presentation++;moving=false;motion.cancel();intro.cancel();effects.cancel();battle.cancel();clearTimeout(timer);document.documentElement.classList.remove('duel-playing');document.documentElement.dataset.duelRotated='false';document.querySelector('meta[name=theme-color]')?.setAttribute('content','#eef3f5');},
    refresh:render,
    setDesignedDeck:saveSide,
    getMatch:()=>match,
    getConfig:()=>structuredClone(config),
    destroy(){launchSequence++;starting=false;tableObserver?.disconnect();cancelThinking();aiClient.destroy();engine.destroyMatch?.(match);cancelArt();attackArrows.destroy();modal.removeEventListener('close',dialogClosed);modal.removeEventListener('cancel',revealCancel,true);active=false;presentation++;moving=false;motion.cancel();intro.cancel();effects.cancel();battle.cancel();clearTimeout(timer);document.documentElement.classList.remove('duel-playing');document.documentElement.dataset.duelRotated='false';document.querySelector('meta[name=theme-color]')?.setAttribute('content','#eef3f5');document.removeEventListener('click',handleClick);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',suspendPresentation);window.removeEventListener('pageshow',resumePresentation);reducedMotion.removeEventListener?.('change',cancelMotion);}
  };
}
function mainPhaseLabel(state){return ['main1','main2'].includes(state.phase)?state.turn===1?'Opening turn · Battle is skipped. Summon, Set, or activate a card.':'Summon, Set, or activate a card. Tap your hand to begin.':state.phase==='battle'?'Tap your Attack Position monster to choose an attack.':state.phase==='end'?'End Phase. Continue to your opponent’s turn.':`${PHASE_LABELS[state.phase]} Phase · continue when ready.`;}
function nextLabel(state){let index=PHASES.indexOf(state.phase)+1;if(state.turn===1&&PHASES[index]==='battle')index++;return PHASE_LABELS[PHASES[index]]||'next turn';}
