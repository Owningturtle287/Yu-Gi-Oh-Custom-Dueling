import { defaultSide, poolFor, eligibleSets, generateDeck, validateDuelDeck, expandDeck, loadSets } from './decks.js';
import { support, ERA_END, isMonster } from './catalog.js';
import { createMatch, legalActions, applyAction, findCard, stats, PHASES, PHASE_LABELS } from './engine.js';
import { chooseAIAction } from './ai.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const option=(value,label,selected)=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
const CONFIG='duel-atlas.solo-config.v1';
const labelFor=action=>({SUMMON:action.set?'Set in Defense':'Normal Summon',FLIP:'Flip Summon',POSITION:'Change position',SET:'Set Spell / Trap',ACTIVATE:'Activate card',EFFECT:'Use effect',ATTACK:'Attack',CHOOSE:'Choose target',DISCARD:'Discard'}[action.type]||action.type);
const image=card=>{
  const url=card?.card_images?.[0]?.image_url_small;
  return /^https:\/\/images\.ygoprodeck\.com\/images\/cards_small\/\d+\.jpg$/.test(url||'')?`<img src="${escape(url)}" alt="" loading="lazy" decoding="async">`:'<span class="duel-no-image" aria-hidden="true">◇</span>';
};

export function createSoloController({main,modal,getCards,getDecks,getStatus,showDialog,dialogHeader,closeDialog,toast,onDesign,onKeepDeck}) {
  let config={sides:[defaultSide(),defaultSide()],difficulty:'normal',first:'coin',lp:8000,animations:true},tab=0,match=null,active=false,timer=null,sets=[],setsStatus='idle',setsError='',selection=[],lastPaint=0,fieldLayer='monsters';
  try {
    const saved=JSON.parse(localStorage.getItem(CONFIG)||'null');
    if(saved?.sides?.length===2){config={...config,...saved,sides:saved.sides.map(side=>({...defaultSide(),...side}))};}
  }catch{/* corrupt settings never replace saved decks */}
  // In-memory match survives navigation. Deck/config storage failures are visible.
  const persist=()=>{try{localStorage.setItem(CONFIG,JSON.stringify(config));}catch{toast('Solo settings apply for this session; browser storage is unavailable.',true);}};
  const saveSide=(side,deckId)=>{config.sides[side].deckId=deckId;config.sides[side].source='saved';persist();};
  const selectedDeck=side=>getDecks().find(deck=>deck.id===config.sides[side].deckId);
  const candidateSets=side=>eligibleSets(getCards(),sets,config.sides[side]);
  const header=title=>dialogHeader(escape(title));
  function render(){if(!active)return;if(match)renderArena();else renderSetup();}
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
         <label>AI difficulty<select id="solo-difficulty">${[['easy','Easy · more risks'],['normal','Normal · balanced decisions'],['hard','Hard · cautious, stronger priorities']].map(([v,l])=>option(v,l,config.difficulty)).join('')}</select></label><p class="solo-note">All difficulties use the same rules and draw fairly. Hard improves decisions; it does not see your hidden cards.</p>
         <div class="solo-settings-grid"><label>Goes first<select id="solo-first">${[['coin','Coin toss'],['you','You'],['ai','AI']].map(([v,l])=>option(v,l,config.first)).join('')}</select></label><label>Life Points<select id="solo-lp">${[8000,4000].map(n=>option(n,String(n),config.lp)).join('')}</select></label></div>
         <label class="solo-checkbox"><input id="solo-animations" type="checkbox" ${config.animations?'checked':''}> Duel animations</label><p class="solo-note">The first player skips their first draw and Battle Phase. Draw → Standby → Main 1 → Battle → Main 2 → End. The hand limit is six.</p>`}
      </div>
      <div class="solo-launch"><p role="status">${ready?'Early engine · supported 2002 TCG cards · no banlist':getStatus()==='error'?'The archive needs a connection. Open Archive to retry.':'Preparing card data…'}</p><button class="primary" data-duel="start" ${!ready?'disabled':''}>Start duel <span aria-hidden="true">→</span></button></div>
    </section>`;
    // Assign values explicitly as well as option attributes, including after a
    // saved deck is created while this screen is unmounted.
    if(tab<2)for(const [id,value] of [['solo-source',side.source],['solo-deck',side.deckId],['solo-set',side.set]]){const select=main.querySelector('#'+id);if(select)select.value=value;}
    else for(const [id,value] of [['solo-difficulty',config.difficulty],['solo-first',config.first],['solo-lp',String(config.lp)]])main.querySelector('#'+id).value=value;
    main.querySelector('#solo-source')?.addEventListener('change',event=>{side.source=event.target.value;persist();if(side.source==='set'&&setsStatus==='idle')requestSets();else render();});
    main.querySelector('#solo-deck')?.addEventListener('change',event=>{side.deckId=event.target.value;persist();render();});
    main.querySelector('#solo-set')?.addEventListener('change',event=>{side.set=event.target.value;persist();});
    for(const [id,key] of [['solo-difficulty','difficulty'],['solo-first','first'],['solo-lp','lp'],['solo-animations','animations']])main.querySelector('#'+id)?.addEventListener('change',event=>{config[key]=key==='lp'?Number(event.target.value):key==='animations'?event.target.checked:event.target.value;persist();});
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
  function start(){
    try{
      const seed=globalThis.crypto?.getRandomValues?crypto.getRandomValues(new Uint32Array(1))[0]:Date.now();
      const decks=config.sides.map((settings,side)=>settings.source==='saved'?selectedDeck(side):generateDeck(getCards(),settings,sets,seed+side*76543));
      const issues=decks.flatMap((deck,side)=>validateDuelDeck(deck,getCards(),config.sides[side]).map(message=>`${side===0?'Your deck':'AI deck'}: ${message}`));
      if(issues.length){showDialog(`${header('Decks need a quick review')}<div class="duel-choice-list" aria-label="Deck issues">${issues.map(issue=>`<p class="support-row">${escape(issue)}</p>`).join('')}</div><button data-action="close">Back to setup</button>`,'duel-list-body');return;}
      const first=config.first==='you'?0:config.first==='ai'?1:seed%2;
      match=createMatch(decks.map(deck=>({...expandDeck(deck,getCards()),name:deck.name})),{seed,first,lp:config.lp});
      match.deckBackups=decks;lastPaint=0;closeDialog();render();
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
  function choose(actions,title){
    selection=actions;
    showDialog(`${header(title)}<p class="solo-note">Choose one option. Face-down opponent cards stay hidden.</p><div class="duel-choice-list" aria-label="Legal card actions">${actions.map((action,index)=>`<button data-duel-choice="${index}"><strong>${escape(actionDetail(action))}</strong></button>`).join('')}</div><button data-action="close">Cancel</button>`,'duel-list-body');
  }
  function inspect(uid){
    const card=findCard(match,uid);if(!card)return;
    if(visibleName(uid)==='face-down card'){toast('Your opponent’s Set card is hidden. Choose it through an attack or effect.');return;}
    const actions=legalActions(match,0).filter(action=>action.uid===uid||action.type==='CHOOSE'&&action.target===uid),groups=[];
    for(const action of actions){const key=action.type+':'+!!action.set;let group=groups.find(g=>g.key===key);if(!group){group={key,label:labelFor(action),actions:[]};groups.push(group);}group.actions.push(action);}
    selection=groups;
    showDialog(`${header(card.card.name)}<div class="duel-inspect-top">${image(card.card)}<div><strong>${escape(card.card.type)}</strong><p>${isMonster(card.card)?`Level ${card.card.level} · ${escape(card.card.attribute)}<br>ATK ${stats(match,card).atk} / DEF ${stats(match,card).def}`:escape(card.card.race)}</p><small>${escape(card.card.race)}</small></div></div><div class="effect-text">${escape(card.card.desc).replace(/\n/g,'<br>')}</div><div class="duel-card-actions">${groups.map((group,index)=>`<button class="${group.actions[0].type==='ATTACK'?'danger':'primary'}" data-duel-group="${index}">${escape(group.label)}${group.actions.length>1?'…':''}</button>`).join('')||'<span class="solo-note">No legal action for this card right now.</span>'}</div><button data-action="close">Close</button>`,'duel-inspect-body');
  }
  function renderZone(card,side,zone,index){
    const hidden=side===1&&card&&!card.faceUp,available=card&&legalActions(match,0).some(action=>action.uid===card.uid),event=match.lastEvent?.id!==lastPaint&&match.lastEvent?.uids?.includes(card?.uid)?match.lastEvent.kind:'';
    const label=card?(hidden?'Opponent’s face-down card':card.card.name):`${zone==='monsters'?'Monster':'Spell / Trap'} Zone ${index+1}`;
    return `<button class="duel-zone ${card?'occupied':''} ${hidden||card&&!card.faceUp?'face-down':''} ${card?.position==='defense'?'defense':''} ${available?'actionable':''}" ${card?`data-duel-card="${card.uid}"`:''} data-event="${escape(event)}" aria-label="${escape(label)}${card?.faceUp&&zone==='monsters'?` · ${card.position} · ATK ${stats(match,card).atk} DEF ${stats(match,card).def}`:''}">${card?hidden||!card.faceUp?'<span class="card-back" aria-hidden="true">◇</span>':image(card.card):'<span aria-hidden="true">＋</span>'}${card?.faceUp&&zone==='monsters'?`<small>${card.position==='defense'?'D':'A'} ${stats(match,card)[card.position==='defense'?'def':'atk']}</small>`:''}</button>`;
  }
  function renderArena(){
    const handScroll=main.querySelector('.duel-hand')?.scrollLeft||0;
    clearTimeout(timer);const player=match.players[0],foe=match.players[1],actions=legalActions(match,0),aiActions=legalActions(match,1),needsChoice=match.choice?.side===0,respond=match.window?.priority===0,canPass=actions.some(a=>a.type==='PASS'),canNext=actions.some(a=>a.type==='NEXT'),canEnd=actions.some(a=>a.type==='END'),discard=actions.some(a=>a.type==='DISCARD'),won=match.winner!==null;
    const busy=aiActions.length>0;
    const prompt=won?match.winner==='draw'?'A hard-fought draw.':match.winner===0?'Victory. Your strategy paid off.':'Defeat. A new strategy awaits.':needsChoice?match.choice.title:discard?'Hand limit: choose a card to discard until six remain.':respond?match.chain.length?`Respond to ${match.chain.at(-1).card.name}, or pass.`:match.pending?.kind==='attack'?'An attack is incoming. Respond or pass.':'Response window · play a fast effect or pass.':busy?'AI is considering its next move…':mainPhaseLabel(match);
    main.innerHTML=`<section class="screen duel-arena ${config.animations?'animated':''}" data-field-layer="${fieldLayer}" aria-label="Solo Duel arena">
      <div class="duel-score"><div><small>YOU · ${escape(config.difficulty.toUpperCase())}</small><strong class="${match.lastEvent?.kind==='damage'?'lp-hit':''}">${Math.max(0,player.lp).toLocaleString()} <span>LP</span></strong></div><button data-duel="duel-menu" aria-label="Duel settings, log, and surrender">Turn ${match.turn}<span>${match.active===0?'YOUR TURN':'AI TURN'} · ⋯</span></button><div><small>AI · HAND ${foe.hand.length}</small><strong>${Math.max(0,foe.lp).toLocaleString()} <span>LP</span></strong></div></div>
      <ol class="duel-phases" aria-label="Phase tracker">${PHASES.map((phase,index)=>`<li ${match.phase===phase?'aria-current="step"':''} class="${index<PHASES.indexOf(match.phase)?'complete':''}"><span>${['D','S','M1','B','M2','E'][index]}</span><small>${PHASE_LABELS[phase]}</small></li>`).join('')}</ol>
      <div class="duel-table" aria-label="Duel field">
        <div class="duel-board opponent" aria-label="Opponent field"><div class="duel-zone-row backrow-zones">${foe.spells.map((c,i)=>renderZone(c,1,'spells',i)).join('')}</div><div class="duel-zone-row monster-zones">${foe.monsters.map((c,i)=>renderZone(c,1,'monsters',i)).join('')}</div></div>
        <div class="duel-midline"><button data-duel-pile="0">Your piles <span>${player.deck.length} deck · ${player.grave.length} GY</span>${player.field?`<small>Field: ${escape(player.field.card.name)}</small>`:''}</button><span class="duel-table-mark" aria-hidden="true">◇</span><button class="duel-layer-switch" data-duel="layer" aria-label="${fieldLayer==='monsters'?'Show Spell and Trap zones':'Show Monster zones'}">${fieldLayer==='monsters'?'Show S / T':'Show monsters'}<span>${fieldLayer==='monsters'?`You ${player.spells.filter(Boolean).length} · AI ${foe.spells.filter(Boolean).length}`:'Monster zones'}</span></button><button data-duel-pile="1">AI piles <span>${foe.deck.length} deck · ${foe.grave.length} GY</span>${foe.field?`<small>Field: ${escape(foe.field.faceUp?foe.field.card.name:'Set card')}</small>`:''}</button></div>
        <div class="duel-board yours" aria-label="Your field"><div class="duel-zone-row monster-zones">${player.monsters.map((c,i)=>renderZone(c,0,'monsters',i)).join('')}</div><div class="duel-zone-row backrow-zones">${player.spells.map((c,i)=>renderZone(c,0,'spells',i)).join('')}</div></div>
      </div>
      <div class="duel-hand-label"><span>YOUR HAND · ${player.hand.length}</span><span>${match.chain.length?`CHAIN ${match.chain.length}`:'Tap a card for actions'}</span></div>
      <div class="duel-hand" aria-label="Your hand · horizontally scrollable cards" tabindex="0">${player.hand.map(card=>`<button class="duel-hand-card ${actions.some(a=>a.uid===card.uid)?'actionable':''}" data-duel-card="${card.uid}" aria-label="${escape(card.card.name)}${actions.some(a=>a.uid===card.uid)?' · actions available':''}">${image(card.card)}<strong>${escape(card.card.name)}</strong></button>`).join('')||'<p class="solo-note">Your hand is empty.</p>'}</div>
      <p class="duel-prompt" role="status" aria-live="polite">${escape(prompt)}</p>
      <div class="duel-controls">${won?'<button class="primary" data-duel="rematch">New duel</button><button data-duel="duel-menu">Match details</button>':needsChoice||discard?`<button class="primary" data-duel="resolve-choice">${discard?'Choose discard':'Choose target'}</button><button data-duel="log">Duel log</button>`:respond?`<button class="primary" data-duel="respond" ${actions.length<2?'disabled':''}>Respond (${Math.max(0,new Set(actions.filter(a=>a.uid).map(a=>a.uid)).size)})</button><button data-duel="pass" ${!canPass?'disabled':''}>Pass</button>`:`<button class="primary" data-duel="next" ${!canNext?'disabled':''}>${busy?'AI turn…':match.phase==='end'?'Next turn':`Next: ${nextLabel(match)}`}</button><button data-duel="end" ${!canEnd?'disabled':''}>End turn</button>`}</div>
    </section>`;
    main.querySelector('.duel-hand').scrollLeft=handScroll;
    lastPaint=match.lastEvent?.id||0;
    schedule();
  }
  function step(action,side=0){
    try{match=applyAction(match,action,side);closeDialog();render();}
    catch(error){toast(error.message,true);render();}
  }
  function schedule(){
    if(!active||!match||match.winner!==null)return;
    if(modal.open){timer=setTimeout(schedule,100);return;}
    if(legalActions(match,1).length){timer=setTimeout(()=>{if(!active)return;if(modal.open){schedule();return;}const action=chooseAIAction(match,1,config.difficulty);if(action)step(action,1);},config.animations?550:60);return;}
    const actions=legalActions(match,0);
    if(actions.length===1&&actions[0].type==='PASS')timer=setTimeout(()=>{if(modal.open)schedule();else step(actions[0]);},config.animations?140:20);
  }
  function showPiles(side){
    const player=match.players[side];
    showDialog(`${header(`${side===0?'Your':'AI'} piles & Field Spell`)}<p class="solo-note">Deck: ${player.deck.length} cards (order hidden) · Extra: ${player.extra.length}. Graveyard and banished cards are public.</p>${player.field?`<button class="duel-public-card" data-duel-card="${player.field.uid}">${side===1&&!player.field.faceUp?'<span class="card-back" aria-hidden="true">◇</span>':image(player.field.card)}<span>Field: ${escape(side===1&&!player.field.faceUp?'Set card':player.field.card.name)}</span></button>`:'<p class="solo-note">No active Field Spell.</p>'}<div class="duel-choice-list" aria-label="Public card piles">${[['Graveyard',player.grave],['Banished',player.banished],...(side===0?[['Extra Deck',player.extra]]:[])].map(([name,cards])=>`<strong class="pile-title">${name} · ${cards.length}</strong>${cards.map(card=>`<button class="duel-public-card" data-duel-card="${card.uid}">${image(card.card)}<span>${escape(card.card.name)}</span></button>`).join('')}`).join('')}</div><button data-action="close">Done</button>`,'duel-list-body');
  }
  function showLog(){showDialog(`${header('Duel log')}<div class="duel-choice-list duel-log" aria-label="Duel events">${[...match.log].reverse().map(entry=>`<p data-kind="${entry.kind}">${escape(entry.message)}</p>`).join('')}</div><button data-action="close">Done</button>`,'duel-list-body');}
  function duelMenu(){
    showDialog(`${header('At the duel table')}<p class="solo-note">${escape(match.players[0].name)} vs ${escape(match.players[1].name)} · ${escape(config.difficulty)} AI. Leaving Solo pauses the match; it resumes when you return. Reloading ends this test match.</p><div class="duel-menu-grid"><button data-duel="log">Duel log</button><button data-duel="coverage">Rules & cards</button><button data-duel-keep="0">Save your deck</button><button data-duel-keep="1">Save AI deck</button><button data-duel="toggle-motion">Animations: ${config.animations?'on':'off'}</button><button class="danger" data-duel="surrender" ${match.winner!==null?'disabled':''}>Surrender</button></div><button data-action="close">Return to arena</button>`,'duel-menu-body');
  }
  function handleClick(event){
    if(!active)return;const target=event.target.closest('button');if(!target)return;
    if(target.dataset.duelTab!==undefined){tab=Number(target.dataset.duelTab);render();if(tab<2&&config.sides[tab].source==='set'&&setsStatus==='idle')requestSets();return;}
    if(target.dataset.duelCard){inspect(target.dataset.duelCard);return;}
    if(target.dataset.duelPile!==undefined){showPiles(Number(target.dataset.duelPile));return;}
    if(target.dataset.duelKeep!==undefined){onKeepDeck(match.deckBackups[Number(target.dataset.duelKeep)]);return;}
    if(target.dataset.duelChoice!==undefined){const action=selection[Number(target.dataset.duelChoice)];if(action)step(action);return;}
    if(target.dataset.duelGroup!==undefined){const group=selection[Number(target.dataset.duelGroup)];if(group.actions.length===1)step(group.actions[0]);else choose(group.actions,group.label);return;}
    const action=target.dataset.duel;
    if(action==='filters')filters();if(action==='coverage')coverage();if(action==='support-list')coverage(true);if(action==='start')start();if(action==='sets-retry')requestSets(true);
    if(action==='design')onDesign(tab,selectedDeck(tab));
    if(action==='duel-menu')duelMenu();if(action==='log')showLog();
    if(action==='layer'){fieldLayer=fieldLayer==='monsters'?'backrow':'monsters';render();}
    if(action==='toggle-motion'){config.animations=!config.animations;persist();duelMenu();}
    if(action==='rematch'){match=null;closeDialog();render();}
    if(action==='surrender'){
      showDialog(`${header('Surrender this duel?')}<p>The current match will end. Your saved decks stay on this device.</p><div class="dialog-actions"><button data-action="close">Keep playing</button><button class="danger" data-duel="confirm-surrender">Surrender</button></div>`);
    }
    if(action==='confirm-surrender')step({type:'SURRENDER'});
    if(action==='next')step({type:'NEXT'});if(action==='end')step({type:'END'});if(action==='pass')step({type:'PASS'});
    if(action==='respond'){
      const cards=[...new Set(legalActions(match,0).filter(a=>a.uid).map(a=>a.uid))];
      showDialog(`${header('Choose a response')}<div class="duel-choice-list">${cards.map(uid=>`<button class="duel-public-card" data-duel-card="${uid}">${image(findCard(match,uid).card)}<span>${escape(visibleName(uid))}</span></button>`).join('')}</div><button data-duel="pass">Pass</button>`,'duel-list-body');
    }
    if(action==='resolve-choice')choose(legalActions(match,0).filter(a=>['CHOOSE','DISCARD'].includes(a.type)),match.choice?.title||'Discard to six cards');
  }
  document.addEventListener('click',handleClick);
  return {
    enter(){active=true;render();if(!match&&config.sides.some(s=>s.source==='set')&&setsStatus==='idle')requestSets();},
    leave(){active=false;clearTimeout(timer);},
    refresh:render,
    setDesignedDeck:saveSide,
    getMatch:()=>match,
    getConfig:()=>structuredClone(config),
    destroy(){active=false;clearTimeout(timer);document.removeEventListener('click',handleClick);}
  };
}
function mainPhaseLabel(state){return ['main1','main2'].includes(state.phase)?'Summon, Set, or activate a card. Tap your hand to begin.':state.phase==='battle'?'Tap your Attack Position monster to choose an attack.':state.phase==='end'?'End Phase. Continue to your opponent’s turn.':`${PHASE_LABELS[state.phase]} Phase · continue when ready.`;}
function nextLabel(state){let index=PHASES.indexOf(state.phase)+1;if(state.turn===1&&PHASES[index]==='battle')index++;return PHASE_LABELS[PHASES[index]]||'next turn';}
