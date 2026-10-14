import { defaultSide, poolFor, eligibleSets, generateDeck, validateDuelDeck, expandDeck, loadSets } from './decks.js';
import { support, ERA_END, isMonster } from './catalog.js';
import { createMatch, legalActions, applyAction, findCard, stats, PHASES, PHASE_LABELS } from './engine.js';
import { chooseAIAction } from './ai.js';
import { AI_SPEEDS, decisionDelay, automaticOpeningAction } from './flow.js';
import { CARD_BACK, planMotion, captureArena, createMotionPlayer } from './motion.js';
import { groupedLog, logKindLabel } from './log.js';
import { cardRotation, makeFieldSelection, fieldCandidates, pickFieldCandidate, quickCardActions, activityCue, cardActivity } from './field.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const option=(value,label,selected)=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
const CONFIG='duel-atlas.solo-config.v1';
const cardBack=()=>`<img class="card-back-image" src="${CARD_BACK}" alt="" decoding="async">`;
const labelFor=action=>({SUMMON:action.set?'Set in Defense':'Normal Summon',FLIP:'Flip Summon',POSITION:'Change position',SET:'Set Spell / Trap',ACTIVATE:'Activate card',EFFECT:'Use effect',ATTACK:'Attack',CHOOSE:'Choose target',DISCARD:'Discard'}[action.type]||action.type);
const image=card=>{
  const url=card?.card_images?.[0]?.image_url_small;
  return /^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\/\d+\.jpg$/.test(url||'')?`<img src="${escape(url)}" alt="" loading="lazy" decoding="async">`:'<span class="duel-no-image" aria-hidden="true">◇</span>';
};

export function createSoloController({main,modal,getCards,getDecks,getStatus,showDialog,dialogHeader,closeDialog,toast,onDesign,onKeepDeck}) {
  let config={sides:[defaultSide(),defaultSide()],difficulty:'normal',aiSpeed:'normal',first:'coin',lp:8000,animations:true},tab=0,match=null,active=false,timer=null,sets=[],setsStatus='idle',setsError='',selection=[],moving=false,presentation=0,openingTurn=null,logFilter='all',fieldSelection=null,cue=null,arenaActions=[];
  const motion=createMotionPlayer(main), reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const isPortrait=()=>window.innerHeight>window.innerWidth;
  let portrait=isPortrait();
  const cancelMotion=()=>motion.cancel();
  const resize=()=>{
    motion.cancel();
    const changed=portrait!==isPortrait();portrait=isPortrait();
    if(active&&match&&changed){clearTimeout(timer);if(portrait)closeDialog();render();}
  };
  window.addEventListener('resize',resize);
  reducedMotion.addEventListener?.('change',cancelMotion);
  try {
    const saved=JSON.parse(localStorage.getItem(CONFIG)||'null');
    if(saved?.sides?.length===2){config={...config,...saved,sides:saved.sides.map(side=>({...defaultSide(),...side}))};}
  }catch{/* corrupt settings never replace saved decks */}
  if(!AI_SPEEDS[config.aiSpeed])config.aiSpeed='normal';
  // In-memory match survives navigation. Deck/config storage failures are visible.
  const persist=()=>{try{localStorage.setItem(CONFIG,JSON.stringify(config));}catch{toast('Solo settings apply for this session; browser storage is unavailable.',true);}};
  const saveSide=(side,deckId)=>{config.sides[side].deckId=deckId;config.sides[side].source='saved';persist();};
  const selectedDeck=side=>getDecks().find(deck=>deck.id===config.sides[side].deckId);
  const candidateSets=side=>eligibleSets(getCards(),sets,config.sides[side]);
  const header=title=>dialogHeader(escape(title));
  function render(){if(!active)return;document.documentElement.classList.toggle('duel-playing',!!match);if(match)renderArena();else renderSetup();}
  async function requestSets(force=false){
    if(setsStatus==='loading')return;
    setsStatus='loading';render();
    try{const result=await loadSets({force});sets=result.sets;setsStatus=result.offline?'offline':'ready';}
    catch(error){setsStatus='error';setsError=error.message;}
    render();
  }
  function renderSetup(){
    const cards=getCards(),ready=getStatus()==='ready',side=config.sides[tab],saved=tab<2?selectedDeck(tab):null,pool=tab<2?poolFor(cards,side):[];
    main.innerHTML=`<section class="screen solo-setup" aria-label="Solo Duel setup">
      <div class="duel-heading"><div><div class="eyebrow">THE FIRST CHAPTER</div><h1>Solo Duel</h1></div><button class="duel-era" data-duel="coverage" aria-haspopup="dialog">2002 LAB <span>Rules & cards ↗</span></button></div>
      <div class="solo-tabs" role="tablist" aria-label="Duel setup">${['Your deck','AI deck','Match'].map((name,index)=>`<button id="solo-tab-${index}" role="tab" aria-controls="solo-panel" aria-selected="${tab===index}" data-duel-tab="${index}">${name}</button>`).join('')}</div>
      <div class="solo-panel" id="solo-panel" role="tabpanel" aria-labelledby="solo-tab-${tab}">
      ${tab<2?`<div class="solo-deck-hero"><div class="solo-sigil" aria-hidden="true">${tab===0?'◇':'✦'}</div><div><h2>${tab===0?'Your strategy.':'Meet your rival.'}</h2><p>${tab===0?'Bring a deck or discover a new one.':'Give the AI a deck, or let it improvise.'}</p></div></div>
        <label>Deck source<select id="solo-source">${[['cards','Random cards'],['set','Random cards from a set'],['saved','Saved / custom deck']].map(([v,l])=>option(v,l,side.source)).join('')}</select></label>
        ${side.source==='saved'?`<div class="solo-saved-row"><label>Saved deck<select id="solo-deck">${option('','Choose a saved deck',side.deckId)}${getDecks().map(deck=>option(deck.id,deck.name,side.deckId)).join('')}</select></label><button data-duel="design">${saved?'Edit':'Design'} deck</button></div>`:''}
        ${side.source==='set'?`<label>Released set<select id="solo-set">${option('','Random eligible set',side.set)}${candidateSets(tab).map(set=>`<option value="${escape(set.name)}" ${set.name===side.set?'selected':''} ${set.problem?'disabled':''}>${escape(set.name)} · ${set.remaining.length} cards${set.problem?' · too few':''}</option>`).join('')}</select></label><div class="solo-set-status" role="status">${setsStatus==='loading'?'Loading real set release dates…':setsStatus==='error'?escape(setsError):`${candidateSets(tab).filter(s=>!s.problem).length} sets can produce a deck · ${setsStatus==='offline'?'cached dates':'2002 release dates'}`} ${setsStatus==='error'?'<button data-duel="sets-retry">Retry</button>':''}</div>`:''}
        <button class="solo-filter-summary" data-duel="filters" aria-haspopup="dialog"><span><strong>Card eligibility</strong><small>Through ${escape(side.cutoff)} · ${escape([side.race||'All types',side.attribute,side.subtype,side.spells?'Spells':'No spells',side.traps?'Traps':'No traps'].filter(Boolean).join(' · '))}</small></span><span aria-hidden="true">⚙</span></button>
        <div class="solo-pool-note"><span class="status-dot"></span><p>${ready?`<strong>${pool.length} supported cards</strong> fit these filters. ${side.source==='saved'?'Your deck will be checked before starting.':'Generated decks have 40 cards, max. 3 copies, and enough low-level monsters.'}`:'Load the card archive to prepare your duel.'}</p></div>
        ${side.source==='saved'?'<p class="solo-note">Design opens the deck builder with playable cards only. Save and return here when ready.</p>':'<p class="solo-note">Set pools may be incomplete after filtering. Cards with unfinished effects are excluded.</p>'}`:
        `<div class="solo-deck-hero"><div class="solo-sigil" aria-hidden="true">⚔</div><div><h2>Set the challenge.</h2><p>Local AI. Your pace. No account needed.</p></div></div>
         <div class="solo-settings-grid"><label>AI difficulty<select id="solo-difficulty">${[['easy','Easy'],['normal','Normal'],['hard','Hard']].map(([v,l])=>option(v,l,config.difficulty)).join('')}</select></label><label>AI decision speed<select id="solo-ai-speed">${Object.entries(AI_SPEEDS).map(([key,speed])=>option(key,speed.label,config.aiSpeed)).join('')}</select></label></div><p class="solo-note">Difficulty changes decisions; speed changes the pause between them. AI never sees hidden cards. Animations finish before the next move.</p>
         <div class="solo-settings-grid"><label>Goes first<select id="solo-first">${[['coin','Coin toss'],['you','You'],['ai','AI']].map(([v,l])=>option(v,l,config.first)).join('')}</select></label><label>Life Points<select id="solo-lp">${[8000,4000].map(n=>option(n,String(n),config.lp)).join('')}</select></label></div>
         <label class="solo-checkbox"><input id="solo-animations" type="checkbox" ${config.animations?'checked':''}> Duel animations</label><p class="solo-note">Your Draw and Standby Phases advance automatically to Main 1. The first player still skips the first draw and Battle Phase. Hand limit: six.</p>`}
      </div>
      <div class="solo-launch"><p role="status">${ready?'Duel in landscape · supported 2002 TCG cards · no banlist':getStatus()==='error'?'The archive needs a connection. Open Archive to retry.':'Preparing card data…'}</p><button class="primary" data-duel="start" ${!ready?'disabled':''}>Start duel <span aria-hidden="true">→</span></button></div>
    </section>`;
    // Assign values explicitly as well as option attributes, including after a
    // saved deck is created while this screen is unmounted.
    if(tab<2)for(const [id,value] of [['solo-source',side.source],['solo-deck',side.deckId],['solo-set',side.set]]){const select=main.querySelector('#'+id);if(select)select.value=value;}
    else for(const [id,value] of [['solo-difficulty',config.difficulty],['solo-ai-speed',config.aiSpeed],['solo-first',config.first],['solo-lp',String(config.lp)]])main.querySelector('#'+id).value=value;
    main.querySelector('#solo-source')?.addEventListener('change',event=>{side.source=event.target.value;persist();if(side.source==='set'&&setsStatus==='idle')requestSets();else render();});
    main.querySelector('#solo-deck')?.addEventListener('change',event=>{side.deckId=event.target.value;persist();render();});
    main.querySelector('#solo-set')?.addEventListener('change',event=>{side.set=event.target.value;persist();});
    for(const [id,key] of [['solo-difficulty','difficulty'],['solo-ai-speed','aiSpeed'],['solo-first','first'],['solo-lp','lp'],['solo-animations','animations']])main.querySelector('#'+id)?.addEventListener('change',event=>{config[key]=key==='lp'?Number(event.target.value):key==='animations'?event.target.checked:event.target.value;persist();});
  }
  function filters(){
    const side=config.sides[tab],pool=getCards().filter(c=>c.tcgDate&&c.tcgDate<=ERA_END),races=[...new Set(pool.filter(isMonster).map(c=>c.race))].sort();
    showDialog(`${header(`${tab===0?'Your':'AI'} card eligibility`)}<p class="solo-note">Cards must pass these filters and the engine’s effect support check. Type, attribute, and subtype affect monsters.</p><form id="duel-filters"><div class="solo-settings-grid"><label>Release year<select name="cutoff">${Array.from({length:7},(_,i)=>2002-i).map(year=>option(year+'-12-31',year+' & earlier',side.cutoff)).join('')}</select></label><label>Monster subtype<select name="subtype">${option('','All subtypes',side.subtype)}${['Normal','Effect','Flip','Fusion'].map(s=>option(s,s,side.subtype)).join('')}</select></label><label>Monster type<select name="race">${option('','All types',side.race)}${races.map(r=>option(r,r,side.race)).join('')}</select></label><label>Attribute<select name="attribute">${option('','All attributes',side.attribute)}${['DARK','LIGHT','EARTH','FIRE','WATER','WIND'].map(a=>option(a,a,side.attribute)).join('')}</select></label></div><div class="solo-settings-grid">${['spells','traps'].map(key=>`<label class="solo-checkbox"><input name="${key}" type="checkbox" ${side[key]?'checked':''}> Allow ${key}</label>`).join('')}</div><p class="solo-note">Later years unlock as the engine grows. Early cutoffs or narrow filters may leave too few cards to generate a deck.</p><div class="dialog-actions"><button type="button" data-action="close">Cancel</button><button type="submit" class="primary">Apply filters</button></div></form>`,'duel-filter-body');
    for(const key of ['cutoff','race','attribute','subtype'])modal.querySelector(`[name="${key}"]`).value=side[key];
    modal.querySelector('#duel-filters').onsubmit=event=>{
      event.preventDefault();const form=event.target;
      for(const key of ['cutoff','race','attribute','subtype'])side[key]=form.elements.namedItem(key).value;
      for(const key of ['spells','traps'])side[key]=form.elements.namedItem(key).checked;
      if(side.cutoff>ERA_END||side.cutoff<'1996-01-01'){toast('Choose a date from 1996 through 2002.',true);return;}
      side.set='';persist();closeDialog();render();
    };
  }
  function coverage(list=false){
    const era=getCards().filter(c=>c.tcgDate&&c.tcgDate<=ERA_END),supported=era.filter(c=>support(c).ok);
    if(!list){
      showDialog(`${header('2002 engine · test scope')}<p><strong>${supported.length} of ${era.length} dated cards supported.</strong> Normal Monsters, Fusions, and registered effects. Unfinished effects, Rituals, and complex summoning procedures are blocked.</p><p>Uses current card text, modern core turn rules, and a three-copy limit without a banlist. Simultaneous triggers, damage-step chains, and attack replays have simplified timing.</p><p>Set pools use API memberships and first TCG dates; eligible older reprints may be grouped with an original set. Multiplayer is still planned.</p><button class="primary" data-duel="support-list">Browse card support</button><button data-action="close">Done</button>`,'duel-scope-body');
      return;
    }
    showDialog(`${header('Card support · 2002 & earlier')}<label>Find support status<input id="support-search" type="search" placeholder="Card name…" autocomplete="off"></label><div class="duel-choice-list" id="support-list" aria-label="Card support results"></div><button data-duel="coverage">Back to rules</button>`,'duel-list-body');
    const update=()=>{const query=modal.querySelector('#support-search').value.toLowerCase();modal.querySelector('#support-list').innerHTML=era.filter(c=>c.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)).map(card=>`<div class="support-row"><strong>${escape(card.name)}</strong><small class="${support(card).ok?'supported':'unsupported'}">${support(card).ok?'Playable':escape(support(card).reason)}</small></div>`).join('');};
    modal.querySelector('#support-search').oninput=update;update();
  }
  async function start(){
    if(moving||match)return;
    try{
      const seed=globalThis.crypto?.getRandomValues?crypto.getRandomValues(new Uint32Array(1))[0]:Date.now();
      const decks=config.sides.map((settings,side)=>settings.source==='saved'?selectedDeck(side):generateDeck(getCards(),settings,sets,seed+side*76543));
      const issues=decks.flatMap((deck,side)=>validateDuelDeck(deck,getCards(),config.sides[side]).map(message=>`${side===0?'Your deck':'AI deck'}: ${message}`));
      if(issues.length){showDialog(`${header('Decks need a quick review')}<div class="duel-choice-list" aria-label="Deck issues">${issues.map(issue=>`<p class="support-row">${escape(issue)}</p>`).join('')}</div><button data-action="close">Back to setup</button>`,'duel-list-body');return;}
      const first=config.first==='you'?0:config.first==='ai'?1:seed%2;
      const next=createMatch(decks.map(deck=>({...expandDeck(deck,getCards()),name:deck.name})),{seed,first,lp:config.lp});
      next.deckBackups=decks;
      await present(null,next);
    }catch(error){toast(error.message,true);}
  }
  function visibleName(uid){
    const card=findCard(match,uid);if(!card)return 'card';
    const hidden=match.players[1].monsters.some(c=>c?.uid===uid&&!c.faceUp)||match.players[1].spells.some(c=>c?.uid===uid&&!c.faceUp)||(match.players[1].field?.uid===uid&&!match.players[1].field.faceUp);
    return hidden?'face-down card':card.card.name;
  }
  function actionDetail(action){
    const parts=[];
    if(action.target)parts.push(`Target: ${visibleName(action.target)}`);
    if(action.type==='ATTACK'&&!action.target)parts.push('Direct attack');
    if(action.tributes?.length)parts.push(`Tribute ${action.tributes.map(visibleName).join(' + ')}`);
    if(action.tribute)parts.push(`Tribute ${visibleName(action.tribute)}`);
    if(action.discard)parts.push(`Discard ${visibleName(action.discard)}`);
    if(action.fusion)parts.push(`${visibleName(action.fusion)} · Materials: ${action.materials.map(visibleName).join(' + ')}`);
    if(action.count)parts.push(`Add ${action.count} Thunder Dragon${action.count===1?'':'s'}`);
    return parts.join(' · ')||labelFor(action);
  }
  function choose(actions,title,skipField=false){
    if(!actions.length){toast('That action is no longer available.');render();return;}
    motion.cancel();
    const session=!skipField&&makeFieldSelection(match,actions,{title,sourceUid:actions[0]?.uid,mandatory:!!match.choice});
    if(session){clearTimeout(timer);fieldSelection=session;closeDialog();render();focusFieldTarget();return;}
    if(actions.length===1){step(actions[0]);return;}
    selection=actions;
    showDialog(`${header(title)}<p class="solo-note">Choose a card from the relevant pile. Field targets are selected directly on the board.</p><div class="duel-choice-list" aria-label="Card choices">${actions.map((action,index)=>`<button data-duel-choice="${index}"><strong>${escape(actionDetail(action))}</strong></button>`).join('')}</div><button data-action="close">Cancel</button>`,'duel-list-body');
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
  function inspect(uid){
    const card=findCard(match,uid);if(!card)return;
    if(visibleName(uid)==='face-down card'){toast('Your opponent’s Set card is hidden. Choose it through an attack or effect.');return;}
    motion.cancel();
    const actions=fieldSelection?[]:legalActions(match,0).filter(action=>action.uid===uid||action.type==='CHOOSE'&&action.target===uid),groups=[];
    for(const action of actions){const key=action.type+':'+!!action.set;let group=groups.find(g=>g.key===key);if(!group){group={key,label:labelFor(action),actions:[]};groups.push(group);}group.actions.push(action);}
    selection=groups;
    showDialog(`${header(card.card.name)}<div class="duel-inspect-top">${image(card.card)}<div><strong>${escape(card.card.type)}</strong><p>${isMonster(card.card)?`Level ${card.card.level} · ${escape(card.card.attribute)}<br>ATK ${stats(match,card).atk} / DEF ${stats(match,card).def}`:escape(card.card.race)}</p><small>${escape(card.card.race)}</small></div></div><div class="effect-text">${escape(card.card.desc).replace(/\n/g,'<br>')}</div><div class="duel-card-actions">${groups.map((group,index)=>`<button class="${group.actions[0].type==='ATTACK'?'danger':'primary'}" data-duel-group="${index}">${escape(group.label)}${group.actions.length>1?'…':''}</button>`).join('')||'<span class="solo-note">No legal action for this card right now.</span>'}</div><button data-action="close">Close</button>`,'duel-inspect-body');
  }
  function quickButtons(uid){
    if(fieldSelection)return '';
    return quickCardActions(arenaActions,uid).map(group=>`<button class="duel-quick-action ${group.tone}" data-duel-quick="${uid}" data-duel-quick-type="${group.type}" aria-label="${escape(group.label)} with ${escape(visibleName(uid))}">${group.label}</button>`).join('');
  }
  function activityHTML(uid){
    const activity=cardActivity(match,uid,cue,fieldSelection);
    return activity.label?`<span class="duel-activity-tag" data-role="${activity.role}">${escape(activity.label)}</span>`:'';
  }
  function renderZone(card,side,zone,index){
    const hidden=side===1&&card&&!card.faceUp,available=card&&arenaActions.some(action=>action.uid===card.uid),activity=card?cardActivity(match,card.uid,cue,fieldSelection):{role:'',label:''};
    const label=card?(hidden?`Opponent’s face-down card, zone ${index+1}`:card.card.name):`${zone==='monsters'?'Monster':'Spell / Trap'} Zone ${index+1}`;
    const values=card&&zone==='monsters'?(hidden?{atk:'?',def:'?'}:card.faceUp?stats(match,card):{atk:card.card.atk,def:card.card.def}):null;
    return `<article class="duel-zone-shell ${zone==='monsters'?'monster-slot':'spell-slot'}" data-role="${activity.role}"><div class="duel-zone-surface"><button class="duel-zone ${card?'occupied':''} ${card&&!card.faceUp?'face-down':''} ${card?.position==='defense'?'defense':''} ${available?'actionable':''}" ${card?`data-duel-card="${card.uid}" data-motion-uid="${card.uid}"`:''} data-role="${activity.role}" data-motion-zone="${side}:${zone}:${index}" aria-label="${activity.role==='eligible'?'Legal target: ':''}${escape(label)}${card?.position==='defense'?' · Defense Position':''}${values?` · ATK ${values.atk} DEF ${values.def}`:''}">${card?`<span class="duel-card-visual" style="--card-rotation:${cardRotation(side,card.position,zone)}deg">${hidden||!card.faceUp?cardBack():image(card.card)}</span>${activityHTML(card.uid)}`:'<span class="duel-empty-mark" aria-hidden="true">◇</span>'}</button>${card?`<div class="duel-inline-actions">${quickButtons(card.uid)}</div>`:''}</div>${values?`<div class="duel-card-stats" aria-hidden="true"><span>A <b>${values.atk}</b></span><span>D <b>${values.def}</b></span></div>`:'<span class="duel-slot-label" aria-hidden="true">SPELL / TRAP</span>'}</article>`;
  }
  function renderLife(side){
    const player=match.players[side],direct=fieldCandidates(fieldSelection).directSide===side;
    const hit=match.pending?.kind==='attack'&&!match.pending.target&&match.pending.side!==side||cue?.directSide===side;
    const percent=Math.max(0,Math.min(100,player.lp/config.lp*100));
    return `<button class="duel-life ${side?'opponent-life':'player-life'}" data-duelist="${side}" data-field-lp="${side}" tabindex="${direct?0:-1}" aria-disabled="${!direct}" data-motion-zone="${side}:lp" data-role="${direct?'eligible':hit?'target':''}" aria-label="${direct?'Legal direct attack target: ':''}${side?'AI':'Your'} Life Points: ${Math.max(0,player.lp)}"><span>${side?'AI':'YOU'} <small>LP</small></span><strong data-lp-value="${side}">${Math.max(0,player.lp).toLocaleString()}</strong><i class="duel-life-meter" aria-hidden="true"><i style="width:${percent}%"></i></i>${direct?'<em>Tap to attack</em>':''}</button>`;
  }
  function renderSideMeta(side){
    const player=match.players[side];
    const pileActivity=[...player.grave,...player.banished].map(card=>cardActivity(match,card.uid,cue,fieldSelection)).find(activity=>['source','target'].includes(activity.role));
    const field=player.field,hidden=side===1&&field&&!field.faceUp,activity=field?cardActivity(match,field.uid,cue,fieldSelection):{role:''};
    return `<div class="duel-board-heading"><h2>${side?'AI':'YOU'}</h2>${side?`<div class="duel-opponent-hand" data-motion-zone="1:hand" aria-label="AI hand: ${player.hand.length} hidden cards"><div aria-hidden="true">${Array.from({length:Math.min(player.hand.length,10)},()=>cardBack()).join('')}</div><span>${player.hand.length}</span></div>`:'<span class="duel-board-note">YOUR FIELD</span>'}<button class="duel-pile-button" data-role="${pileActivity?.role||''}" data-duel-pile="${side}" data-motion-zone="${side}:piles" aria-label="${side?'AI':'Your'} deck and Graveyard"><span class="duel-deck-stack" data-motion-zone="${side}:deck" aria-hidden="true">${cardBack()}</span><span><b>${player.deck.length} deck</b><small data-motion-zone="${side}:grave">${player.grave.length} GY</small></span></button><div class="duel-field-slot" data-role="${activity.role}"><button class="duel-field-zone ${field?'occupied':''}" ${field?`data-duel-card="${field.uid}" data-motion-uid="${field.uid}"`:''} data-motion-zone="${side}:field" data-role="${activity.role}" aria-label="${activity.role==='eligible'?'Legal target: ':''}${field?hidden?'Opponent’s Set Field Spell':escape(field.card.name):'Empty Field Spell zone'}">${field?`<span class="duel-card-visual" style="--card-rotation:${cardRotation(side,null,'field')}deg">${hidden||!field.faceUp?cardBack():image(field.card)}</span>`:'<span>Field</span>'}</button>${field?`<div class="duel-inline-actions">${quickButtons(field.uid)}</div>`:''}</div></div>`;
  }
  function renderArena(){
    const handScroll=main.querySelector('.duel-hand')?.scrollLeft||0, previousPhase=main.querySelector('.duel-phases')?.dataset.phase;
    clearTimeout(timer);
    if(match.choice?.side===0&&!fieldSelection)fieldSelection=makeFieldSelection(match,match.choice.options,{title:match.choice.title,sourceUid:match.choice.trigger?.uid,mandatory:true});
    const player=match.players[0],foe=match.players[1],actions=legalActions(match,0),aiActions=legalActions(match,1),needsChoice=match.choice?.side===0,respond=match.window?.priority===0,canPass=actions.some(a=>a.type==='PASS'),canNext=actions.some(a=>a.type==='NEXT'),canEnd=actions.some(a=>a.type==='END'),discard=actions.some(a=>a.type==='DISCARD'),won=match.winner!==null,blocked=isPortrait();
    arenaActions=actions;
    const busy=aiActions.length>0,candidates=fieldCandidates(fieldSelection);
    const prompt=won?match.winner==='draw'?'A hard-fought draw.':match.winner===0?'Victory. Your strategy paid off.':'Defeat. A new strategy awaits.':fieldSelection?`${fieldSelection.title} · ${fieldSelection.key==='tributes'?`choose ${candidates.remaining} more tribute${candidates.remaining===1?'':'s'}`:'tap a highlighted card'+(candidates.directSide!==null?' or the AI’s LP':'')}.`:needsChoice?match.choice.title:discard?'Hand limit: choose a card to discard until six remain.':respond?match.chain.length?`Respond to ${match.chain.at(-1).card.name}, or pass.`:match.pending?.kind==='attack'?'An attack is incoming. Respond or pass.':'Response window · play a fast effect or pass.':busy?'AI is considering its next move…':mainPhaseLabel(match);
    const summary=cue?.source?`${cue.label}: ${visibleName(cue.source)}`:match.lastEvent?.message||'';
    const phases=`<ol class="duel-phases" data-phase="${match.phase}" data-changed="${previousPhase!==match.phase}" aria-label="Phase tracker">${PHASES.map((phase,index)=>`<li ${match.phase===phase?'aria-current="step"':''} class="${index<PHASES.indexOf(match.phase)?'complete':''}"><span>${['D','S','M1','B','M2','E'][index]}</span><small>${PHASE_LABELS[phase]}</small></li>`).join('')}</ol>`;
    main.innerHTML=`<div class="duel-session">
      <section class="duel-orientation" ${blocked?'':'hidden'} aria-label="Landscape required" role="status"><div class="duel-rotate-icon" aria-hidden="true">↻<i></i></div><div class="eyebrow">A SEAT AT THE TABLE</div><h1>Turn your phone sideways</h1><p>Dueling uses landscape so every zone has room.<br>Your match is paused. Rotate to continue.</p><button data-route="home">Back to Home</button></section>
      <section class="screen duel-arena ${config.animations&&!reducedMotion.matches?'animated':''}" ${blocked?'hidden inert':''} data-orientation-paused="${blocked}" data-selecting="${!!fieldSelection}" aria-label="Solo Duel arena">
      <header class="duel-hud"><button class="duel-exit" data-route="home" aria-label="Back to Home; pause this duel">←</button>${renderLife(1)}<div class="duel-toolbar"><div class="duel-turn">TURN ${match.turn} <span>${match.active===0?'YOUR TURN':'AI TURN'}</span></div>${phases}</div>${renderLife(0)}<button class="duel-menu-button" data-duel="duel-menu" aria-label="Duel settings, log, and surrender">•••</button></header>
      <div class="duel-table" aria-label="Duel field · all Monster and Spell/Trap zones visible">
        <section class="duel-side opponent-side" data-field-side="1" aria-label="AI side of the field">${renderSideMeta(1)}<div class="duel-board opponent" aria-label="Opponent field"><div class="duel-zone-row backrow-zones" data-motion-zone="1:spells">${foe.spells.map((c,i)=>renderZone(c,1,'spells',i)).join('')}</div><div class="duel-zone-row monster-zones" data-motion-zone="1:monsters">${foe.monsters.map((c,i)=>renderZone(c,1,'monsters',i)).join('')}</div></div></section>
        <div class="duel-center-line" aria-hidden="true"><span>◇</span></div>
        <section class="duel-side player-side" data-field-side="0" aria-label="Your side of the field">${renderSideMeta(0)}<div class="duel-board yours" aria-label="Your field"><div class="duel-zone-row monster-zones" data-motion-zone="0:monsters">${player.monsters.map((c,i)=>renderZone(c,0,'monsters',i)).join('')}</div><div class="duel-zone-row backrow-zones" data-motion-zone="0:spells">${player.spells.map((c,i)=>renderZone(c,0,'spells',i)).join('')}</div></div></section>
      </div>
      <footer class="duel-dock"><div class="duel-hand-area"><div class="duel-hand-label"><span>YOUR HAND · ${player.hand.length}</span><span>${match.chain.length?`CHAIN ${match.chain.length}`:'Tap a card to inspect / play'}</span></div>
      <div class="duel-hand" data-motion-zone="0:hand" aria-label="Your hand · horizontally scrollable cards" tabindex="0">${player.hand.map(card=>{const activity=cardActivity(match,card.uid,cue,fieldSelection);return `<article class="duel-hand-shell" data-role="${activity.role}"><button class="duel-hand-card ${actions.some(a=>a.uid===card.uid)?'actionable':''}" data-duel-card="${card.uid}" data-motion-uid="${card.uid}" data-role="${activity.role}" aria-label="${escape(card.card.name)}${activity.label?' · '+activity.label:''}">${image(card.card)}<strong>${escape(card.card.name)}</strong></button>${activityHTML(card.uid)}<div class="duel-inline-actions">${quickButtons(card.uid)}</div></article>`;}).join('')||'<p class="solo-note">Your hand is empty.</p>'}</div></div>
      <div class="duel-action-area"><div class="duel-status-row"><div class="duel-state-copy"><p class="duel-prompt" role="status" aria-live="polite">${escape(prompt)}</p><p class="duel-event-line">${escape(summary)}</p></div></div><div class="duel-command-row">
      <div class="duel-controls">${won?'<button class="primary" data-duel="rematch">New duel</button><button data-duel="duel-menu">Match details</button>':fieldSelection?`<button class="primary" data-duel="inspect-source" ${!fieldSelection.sourceUid?'disabled':''}>View effect / card</button>${fieldSelection.mandatory?'<button data-duel="log">Duel log</button>':'<button data-duel="cancel-target">Cancel selection</button>'}`:needsChoice||discard?`<button class="primary" data-duel="resolve-choice">${discard?'Choose discard':'Choose from pile'}</button><button data-duel="log">Duel log</button>`:respond?`<button class="primary" data-duel="respond" ${actions.length<2?'disabled':''}>Responses (${Math.max(0,new Set(actions.filter(a=>a.uid).map(a=>a.uid)).size)})</button><button data-duel="pass" ${!canPass?'disabled':''}>Pass</button>`:`<button class="primary" data-duel="next" ${!canNext?'disabled':''}>${busy?'AI turn…':match.phase==='end'?'Next turn':`Next: ${nextLabel(match)}`}</button><button data-duel="end" ${!canEnd?'disabled':''}>End turn</button>`}</div><button data-duel="log" class="duel-log-open" aria-label="Open expanded duel log">Log</button></div></div></footer>
      </section></div>`;
    main.querySelector('.duel-hand').scrollLeft=handScroll;
    setMoving(moving);schedule();
  }
  function setMoving(value){
    const arena=main.querySelector('.duel-arena');if(!arena)return;
    arena.dataset.moving=String(value);arena.setAttribute('aria-busy',String(value));
    if(value)for(const button of arena.querySelectorAll('.duel-controls button:not([disabled]), .duel-quick-action:not([disabled])')){button.disabled=true;button.dataset.motionDisabled='true';}
    else for(const button of arena.querySelectorAll('[data-motion-disabled]')){button.disabled=false;delete button.dataset.motionDisabled;}
  }
  async function present(previous,next,action=null){
    clearTimeout(timer);const before=captureArena(main), motions=planMotion(previous,next,action), token=++presentation;
    const nextCue=activityCue(previous,next,action);
    cue=nextCue||(previous?.phase===next.phase?cue:null);
    fieldSelection=null;match=next;
    if(match.active===0&&match.phase==='draw')openingTurn=match.turn;
    moving=true;closeDialog();render();
    if(motions.some(item=>item.draw&&item.to==='0:hand')){const hand=main.querySelector('.duel-hand');if(hand)hand.scrollLeft=Math.max(0,hand.scrollWidth-hand.clientWidth);}
    try{await motion.play(motions,before,{enabled:config.animations&&!reducedMotion.matches});}
    catch{motion.cancel();} // An unavailable animation API must never block a legal move.
    finally{if(token===presentation){moving=false;setMoving(false);if(active)schedule();}}
  }
  async function step(action,side=0){
    if(moving||isPortrait())return;
    try{await present(match,applyAction(match,action,side),action);}
    catch(error){toast(error.message,true);render();}
  }
  function schedule(){
    clearTimeout(timer);
    if(!active||moving||!match||match.winner!==null||fieldSelection||isPortrait())return;
    if(modal.open){timer=setTimeout(schedule,100);return;}
    if(match.active===0&&match.phase==='draw')openingTurn=match.turn;
    if(match.phase==='main1'&&!match.window&&!match.choice)openingTurn=null;
    const automatic=automaticOpeningAction(match,openingTurn);
    if(automatic){timer=setTimeout(()=>{if(!active)return;if(modal.open){schedule();return;}step(automatic);},config.animations&&!reducedMotion.matches?220:20);return;}
    const aiActions=legalActions(match,1);
    if(aiActions.length){const delay=aiActions.length===1&&aiActions[0].type==='PASS'?(config.animations?90:20):decisionDelay(config.aiSpeed);timer=setTimeout(()=>{if(!active)return;if(modal.open){schedule();return;}const action=chooseAIAction(match,1,config.difficulty);if(action)step(action,1);},delay);return;}
    const actions=legalActions(match,0);
    if(actions.length===1&&actions[0].type==='PASS')timer=setTimeout(()=>{if(modal.open)schedule();else step(actions[0]);},config.animations?100:20);
  }
  function showPiles(side){
    const player=match.players[side];
    showDialog(`${header(`${side===0?'Your':'AI'} piles & Field Spell`)}<p class="solo-note">Deck: ${player.deck.length} cards (order hidden) · Extra: ${player.extra.length}. Graveyard and banished cards are public.</p>${player.field?`<button class="duel-public-card" data-duel-card="${player.field.uid}">${side===1&&!player.field.faceUp?cardBack():image(player.field.card)}<span>Field: ${escape(side===1&&!player.field.faceUp?'Set card':player.field.card.name)}</span></button>`:'<p class="solo-note">No active Field Spell.</p>'}<div class="duel-choice-list" aria-label="Public card piles">${[['Graveyard',player.grave],['Banished',player.banished],...(side===0?[['Extra Deck',player.extra]]:[])].map(([name,cards])=>`<strong class="pile-title">${name} · ${cards.length}</strong>${cards.map(card=>`<button class="duel-public-card" data-duel-card="${card.uid}">${image(card.card)}<span>${escape(card.card.name)}</span></button>`).join('')}`).join('')}</div><button data-action="close">Done</button>`,'duel-list-body');
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
    showDialog(`${header('At the duel table')}<p class="solo-note">${escape(match.players[0].name)} vs ${escape(match.players[1].name)} · ${escape(config.difficulty)} AI. Leaving Solo pauses the match; it resumes when you return. Reloading ends this test match.</p>${speedControl()}<div class="duel-menu-grid"><button data-duel="log">Expanded duel log</button><button data-duel="coverage">Rules & cards</button><button data-duel-keep="0">Save your deck</button><button data-duel-keep="1">Save AI deck</button><button data-duel="toggle-motion">Animations: ${config.animations?'on':'off'}</button><button class="danger" data-duel="surrender" ${match.winner!==null?'disabled':''}>Surrender</button></div><button data-action="close">Return to arena</button>`,'duel-menu-body');
    const select=modal.querySelector('#duel-ai-speed');select.value=config.aiSpeed;
    select.onchange=event=>{config.aiSpeed=event.target.value;persist();schedule();};
  }
  function handleClick(event){
    if(!active||match&&isPortrait())return;const target=event.target.closest('button');if(!target)return;
    if(target.dataset.duelTab!==undefined){tab=Number(target.dataset.duelTab);render();if(tab<2&&config.sides[tab].source==='set'&&setsStatus==='idle')requestSets();return;}
    if(target.dataset.duelQuick){if(moving)return;const actions=legalActions(match,0).filter(action=>action.uid===target.dataset.duelQuick&&action.type===target.dataset.duelQuickType);choose(actions,`${labelFor(actions[0]||{})}: ${visibleName(target.dataset.duelQuick)}`);return;}
    if(target.dataset.fieldLp!==undefined){if(fieldSelection&&fieldCandidates(fieldSelection).directSide===Number(target.dataset.fieldLp))pickTarget(null);return;}
    if(target.dataset.duelCard){if(fieldSelection)pickTarget(target.dataset.duelCard);else inspect(target.dataset.duelCard);return;}
    if(target.dataset.duelPile!==undefined){showPiles(Number(target.dataset.duelPile));return;}
    if(target.dataset.duelLogFilter){logFilter=target.dataset.duelLogFilter;showLog();return;}
    if(target.dataset.duelKeep!==undefined){onKeepDeck(match.deckBackups[Number(target.dataset.duelKeep)]);return;}
    if(target.dataset.duelChoice!==undefined){const action=selection[Number(target.dataset.duelChoice)];if(action)step(action);return;}
    if(target.dataset.duelGroup!==undefined){const group=selection[Number(target.dataset.duelGroup)];choose(group.actions,group.label);return;}
    const action=target.dataset.duel;
    if(action==='filters')filters();if(action==='coverage')coverage();if(action==='support-list')coverage(true);if(action==='start')start();if(action==='sets-retry')requestSets(true);
    if(action==='design')onDesign(tab,selectedDeck(tab));
    if(action==='cancel-target'){if(!fieldSelection?.mandatory){fieldSelection=null;render();}return;}
    if(action==='inspect-source'){if(fieldSelection?.sourceUid)inspect(fieldSelection.sourceUid);return;}
    if(action==='duel-menu')duelMenu();if(action==='log')showLog();if(action==='log-latest')jumpToLatest();
    if(action==='toggle-motion'){config.animations=!config.animations;persist();duelMenu();}
    if(action==='rematch'){match=null;closeDialog();render();}
    if(action==='surrender'){
      showDialog(`${header('Surrender this duel?')}<p>The current match will end. Your saved decks stay on this device.</p><div class="dialog-actions"><button data-action="close">Keep playing</button><button class="danger" data-duel="confirm-surrender">Surrender</button></div>`);
    }
    if(action==='confirm-surrender')step({type:'SURRENDER'});
    if(action==='next')step({type:'NEXT'});if(action==='end')step({type:'END'});if(action==='pass')step({type:'PASS'});
    if(action==='respond'){render();toast('Tap Effect on a highlighted card to respond.');}
    if(action==='resolve-choice')choose(legalActions(match,0).filter(a=>['CHOOSE','DISCARD'].includes(a.type)),match.choice?.title||'Discard to six cards');
  }
  document.addEventListener('click',handleClick);
  return {
    enter(){active=true;render();if(!match&&config.sides.some(s=>s.source==='set')&&setsStatus==='idle')requestSets();},
    leave(){active=false;presentation++;moving=false;motion.cancel();clearTimeout(timer);document.documentElement.classList.remove('duel-playing');},
    refresh:render,
    setDesignedDeck:saveSide,
    getMatch:()=>match,
    getConfig:()=>structuredClone(config),
    destroy(){active=false;presentation++;moving=false;motion.cancel();clearTimeout(timer);document.documentElement.classList.remove('duel-playing');document.removeEventListener('click',handleClick);window.removeEventListener('resize',resize);reducedMotion.removeEventListener?.('change',cancelMotion);}
  };
}
function mainPhaseLabel(state){return ['main1','main2'].includes(state.phase)?'Summon, Set, or activate a card. Tap your hand to begin.':state.phase==='battle'?'Tap your Attack Position monster to choose an attack.':state.phase==='end'?'End Phase. Continue to your opponent’s turn.':`${PHASE_LABELS[state.phase]} Phase · continue when ready.`;}
function nextLabel(state){let index=PHASES.indexOf(state.phase)+1;if(state.turn===1&&PHASES[index]==='battle')index++;return PHASE_LABELS[PHASES[index]]||'next turn';}
