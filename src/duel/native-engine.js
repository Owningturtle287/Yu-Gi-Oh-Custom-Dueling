import {createAIMemory,observePublic,rememberCard,rememberMove,forgetShuffle,notePattern} from './ai-memory.js';
import { defaultNativeRules } from './native-loader.js';
import { findCard, PHASES, PHASE_LABELS } from './engine.js';
import { effectBrief } from './responses.js';
import { chooseAIAction } from './native-ai.js';
import { aiObservation,costValue,locate } from './ai-knowledge.js';
export { chooseAIAction } from './native-ai.js';
import {freshSeed,seededRandom,legacyRandom,shuffled,deriveSeed} from './random.js';
import { effectExplanation } from './effects.js';
import { BATTLE_STEPS, CORE_BATTLE_HINTS, battleContext } from './battle-timing.js';
import {describeNative,choiceContext,phaseEffectText} from './native-prompts.js';
export { findCard, PHASES, PHASE_LABELS };

const names=['deck','hand','monsters','spells','grave','banished','extra'];
const emptyPlayer=name=>({name,lp:8000,deck:[],hand:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),field:null,grave:[],banished:[],extra:[]});
const who=side=>side===0?'You':'AI';
export const stats=(_state,card)=>card?.currentStats||{atk:Math.max(0,card?.card.atk||0),def:Math.max(0,card?.card.def||0)};
export const legalActions=(state,side)=>state.winner===null?(state.actions?.[side]||[]):[];
const cardsIn=state=>state.players.flatMap(p=>[...names.flatMap(zone=>p[zone].filter(Boolean)),...(p.field?[p.field]:[])]);
export function nativeSeed(seed,version=2){
  let value=BigInt(version<3?(seed>>>0||1):seed>>>0);
  if(version===1)return [value,2n,3n,4n];
  // SplitMix64 expands the match seed into all four xoshiro state words.
  // Three constant small words made early core coin/dice results repeat.
  return Array.from({length:4},()=>{
    value=BigInt.asUintN(64,value+0x9e3779b97f4a7c15n);let mixed=value;
    mixed=BigInt.asUintN(64,(mixed^(mixed>>30n))*0xbf58476d1ce4e5b9n);
    mixed=BigInt.asUintN(64,(mixed^(mixed>>27n))*0x94d049bb133111ebn);
    return BigInt.asUintN(64,mixed^(mixed>>31n));
  });
}

// The native engine owns all rules. This adapter translates its legal prompts,
// public events and field queries into the existing arena's presentation model.
export function createNativeBackend({rules=defaultNativeRules}={}) {
  const matches=new Map();let nextMatch=0;
  async function createMatch(decks,{seed=freshSeed(),randomVersion=3,rulesVersion=2,promptVersion=2,first=0,lp=8000,cards=[],eligibility=[],openingHands=null,initialFields=null}={}) {
    if(![1,2,3].includes(randomVersion))throw new Error('Unsupported saved duel randomness version.');
    if(![1,2].includes(rulesVersion))throw new Error('Unsupported saved duel rules version.');
    if(![1,2].includes(promptVersion))throw new Error('Unsupported saved duel prompt version.');
    const pack=await rules(),{module:m,lib,records}=pack;
    const scripts=rulesVersion===1?{...pack.scripts,'c16768387.lua':pack.scripts['c16768387.lua'].replace('Duel.SortDecktop(tp,tp,ac)','Duel.SortDecktop(tp,tp,ct)')}:pack.scripts;
    const api=new Map([...cards,...(openingHands||[]).flat(),...(initialFields||[]).flatMap(p=>Object.values(p).flat().filter(Boolean).map(c=>c.card)),...decks.flatMap(d=>[...d.main,...d.extra])].map(c=>[c.id,c]));
    const byName=new Map([...records.values()].map(r=>[r.name,r]));
    const canonical=new Map(),preferred=new Map();
    for(const card of api.values()){
      const record=records.get(card.id)||byName.get(card.name);
      canonical.set(card.id,record?.code||card.id);preferred.set(record?.code||card.id,card);
    }
    const cardReader=code=>{
      if(records.has(code))return records.get(code);
      const card=api.get(code);if(!card)return null;
      return {code,alias:0,setcodes:[],type:card.type==='Normal Monster'?17:card.type==='Spell Card'?2:card.type==='Trap Card'?4:33,level:card.level||0,attack:card.atk||0,defense:card.def||0,race:m.OcgRace[card.race?.toUpperCase().replace(/[^A-Z0-9]/g,'')]||1n,attribute:m.OcgAttribute[card.attribute]||0,lscale:0,rscale:0,link_marker:0};
    };
    const errors=[];
    const handle=lib.createDuel({flags:m.OcgDuelMode.MODE_MR5|m.OcgDuelMode.TCG_SEGOC_NONPUBLIC|m.OcgDuelMode.TCG_SEGOC_FIRSTTRIGGER,seed:nativeSeed(seed,randomVersion),team1:{startingLP:lp,startingDrawCount:openingHands?0:5,drawCountPerTurn:1},team2:{startingLP:lp,startingDrawCount:openingHands?0:5,drawCountPerTurn:1},cardReader,scriptReader:name=>scripts[name]||null,errorHandler:(_type,text)=>errors.push(text)});
    if(!handle)throw new Error('The duel rules engine could not start.');
    const id='native-'+(++nextMatch),r={id,...pack,handle,api,preferred,canonical,cardReader,first,errors,reply:new Map(),epoch:0,promptSequence:0,revealSequence:0,uid:0,prompt:null,selected:[],lastAttack:null,hint:'Choose cards',sourceUid:null};
    r.bootstrap=structuredClone({decks,options:{seed,randomVersion,rulesVersion,promptVersion,first,lp,eligibility,openingHands,initialFields}});r.history=[];
    r.life=[lp,lp];
    r.reason=Object.fromEntries([...scripts['constant.lua'].matchAll(/^REASON_(\w+)\s*=\s*(0x[\da-f]+|\d+)/gmi)].map(([,key,value])=>[key,Number(value)]));
    r.side=team=>team===0?first:1-first;r.team=side=>side===first?0:1;
    r.state={aiMemory:createAIMemory(cards,eligibility),version:2,runtimeId:id,players:decks.map(d=>({...emptyPlayer(d.name),lp})),turn:0,normalSummons:[0,0],active:first,phase:'draw',seed:seed>>>0,serial:0,log:[],lastEvent:null,winner:null,chain:[],window:null,pending:null,choice:null,actions:[[],[]],visualAction:null};
    try {
      for(const f of ['constant.lua','utility.lua'])if(!lib.loadScript(handle,f,scripts[f]))throw new Error('Could not initialize '+f);
      decks.forEach((deck,side)=>{
        // Startup does not shuffle the initial list. Shuffle a copy for each
        // player, then insert explicitly; saved/editor ordering stays intact.
        for(const [zone,location] of [['main',m.OcgLocation.DECK],['extra',m.OcgLocation.EXTRA]])for(const card of zone==='main'?shuffled(deck.main,randomVersion<3?legacyRandom((seed+side*0x9e3779b9)>>>0):seededRandom(deriveSeed(seed,'opening-'+side))):deck.extra)lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(card.id)||card.id,location,sequence:1,position:m.OcgPosition.FACEDOWN_DEFENSE});
      });
      if(openingHands)openingHands.forEach((hand,side)=>hand.forEach(card=>lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(card.id)||card.id,location:m.OcgLocation.HAND,sequence:0,position:m.OcgPosition.FACEDOWN_DEFENSE})));
      if(initialFields)initialFields.forEach((fields,side)=>Object.entries(fields).forEach(([zone,cards])=>cards.forEach((item,sequence)=>{if(item)lib.duelNewCard(handle,{team:r.team(side),controller:r.team(side),duelist:0,code:canonical.get(item.card.id)||item.card.id,location:({monsters:m.OcgLocation.MZONE,grave:m.OcgLocation.GRAVE,banished:m.OcgLocation.REMOVED,extra:m.OcgLocation.EXTRA})[zone]||m.OcgLocation.SZONE,sequence:zone==='field'?5:sequence,position:item.defense?(item.faceUp===false?8:4):item.faceUp===false?2:1});})));
      matches.set(id,r);lib.startDuel(handle);pump(r);return r.state;
    } catch(error){lib.destroyDuel(handle);matches.delete(id);throw error;}
  }
  function log(r,message,kind='action',uids=[],side=r.state.active,details={}){const s=r.state,entry={id:++s.serial,turn:s.turn||1,phase:s.phase,side,message,kind,uids,...details};s.log.push(entry);s.log=s.log.slice(-500);s.lastEvent=entry;}
  function notice(r,source,stage,text,chainLink){
    if(!source?.card)return;
    log(r,`${source.card.name}: ${text}`,'effect',[source.uid].filter(Boolean),source.side??source.controller??r.state.active,{effectNotice:{uid:source.uid,card:source.card,stage,text,chainLink}});
  }
  function sourceAt(r,location){
    const card=cardAt(r,location);
    return card&&(!location.code||card.coreCode===location.code)?card:null;
  }
  function upkeepSource(r,side,amount){
    if(r.state.phase!=='standby'||r.state.active!==side)return null;
    const paid=r.upkeepPaid||new Set(),candidates=r.state.players[side].monsters.filter(c=>c?.faceUp&&!paid.has(c.uid)&&/Archfiend/.test(c.card.name)&&new RegExp(`(?:pays|pay) ${amount} (?:Life Points|LP).*Standby|Standby.*(?:pays|pay) ${amount} (?:Life Points|LP)`,'i').test(c.card.desc));
    return candidates.length===1?candidates[0]:null;
  }
  function battleStep(r,step){
    if(r.state.battleStep===step)return;
    r.state.battleStep=step;
    if(step==='afterCalculation')commitStrike(r);
    if(step)log(r,`${BATTLE_STEPS[step].label}. ${BATTLE_STEPS[step].text}`,'timing',[],r.state.active,{battleStep:step});
  }
  function commitStrike(r){if(r.battleStrike){r.state.visualAction=r.battleStrike;r.battleStrike=null;}}
  function resolvedStats(r,source){
    const before=new Map(r.state.players.flatMap(p=>p.monsters.filter(Boolean)).map(c=>[c.uid,c]));
    sync(r);
    for(const card of r.state.players.flatMap(p=>p.monsters.filter(Boolean))){
      const old=before.get(card.uid);if(!old||!old.faceUp||!card.faceUp)continue;
      const changes=['atk','def'].filter(stat=>old.currentStats[stat]!==card.currentStats[stat]).map(stat=>`${stat.toUpperCase()} ${old.currentStats[stat]} → ${card.currentStats[stat]}`);
      if(changes.length)log(r,`${source?.card.name||'The effect'} changes ${card.card.name}: ${changes.join(', ')}.`,'stats',[source?.uid,card.uid].filter(Boolean),card.controller);
    }
  }
  function cardAt(r,loc){
    if(!loc)return null;const p=r.state.players[r.side(loc.controller)],L=r.module.OcgLocation;
    return loc.location===L.SZONE&&loc.sequence===5?p.field:(p[{[L.DECK]:'deck',[L.HAND]:'hand',[L.MZONE]:'monsters',[L.SZONE]:'spells',[L.GRAVE]:'grave',[L.REMOVED]:'banished',[L.EXTRA]:'extra'}[loc.location]]||[])[loc.sequence]||null;
  }
  function confirmCards(r,msg){
    const s=r.state,L=r.module.OcgLocation,viewer=r.side(msg.player),source=effectSource(r);
    const deck=msg.cards.length>0&&msg.cards.every(c=>c.location===L.DECK&&c.controller===msg.cards[0].controller);
    const sequences=msg.cards.map(c=>c.sequence),deckSize=deck?s.players[r.side(msg.cards[0].controller)].deck.length:0;
    const topFirst=deck&&(source?.card.id===17092736||Math.max(...sequences)===deckSize-1&&new Set(sequences).size===msg.cards.length&&Math.max(...sequences)-Math.min(...sequences)+1===msg.cards.length);
    const ordered=topFirst?[...msg.cards].sort((a,b)=>b.sequence-a.sequence):msg.cards;
    const cards=ordered.map(item=>{
      const zone=({[L.DECK]:'deck',[L.HAND]:'hand',[L.GRAVE]:'grave',[L.REMOVED]:'banished',[L.EXTRA]:'extra'})[item.location]||'field';
      const old=cardAt(r,item),card=descriptor(r,item.code||old?.coreCode),instance={uid:old?.coreCode===item.code?old.uid:null,card,controller:r.side(item.controller)};
      if(instance.uid){rememberCard(s,viewer,instance,zone==='field'?item.location===L.MZONE?'monsters':'spells':zone,{hand:item.location===L.HAND});if(viewer===0){s.revealedUIDs??=[];s.revealedUIDs.push(instance.uid);}}
      return {...instance,sequence:item.sequence,zone};
    });
    const zoneList=cards.length&&cards.every(c=>c.zone!=='field');
    if(zoneList){
      s.reveals??=[];
      const id=`${r.id}:reveal:${++r.revealSequence}`;
      const batch=s.reveals.find(reveal=>reveal.batch===r.promptSequence&&reveal.viewer===viewer&&reveal.source?.id===source?.card.id&&reveal.presentationOnly===!deck&&!reveal.ordered&&!topFirst);
      if(batch)batch.cards.push(...cards.filter(card=>!batch.cards.some(c=>c.uid&&c.uid===card.uid)));
      else s.reveals.push({id,viewer,batch:r.promptSequence,presentationOnly:!deck,deckTop:!!msg.publicReveal,ordered:topFirst,source:source?.card||null,cards});
      log(r,`${source?.card.name||'The effect'}: ${who(viewer)} ${viewer===0?'view':'views'} ${topFirst?'the top ':''}${cards.length} ${topFirst?'':'revealed '}card${cards.length===1?'':'s'} from ${cards[0].controller===0?'your':'AI’s'} ${deck?'Deck':cards[0].zone}${topFirst?', in order. The Deck order is unchanged.':'.'}`,'reveal',[],viewer);
    }else for(const c of cards){
      log(r,'Revealed '+c.card.name+'.','reveal',[c.uid].filter(Boolean),c.controller);
      if(viewer===0||c.controller===0)notice(r,{uid:c.uid,card:c.card,side:c.controller},'reveal',`${source?.card.name||'The effect'} reveals this card.${c.card.type==='Trap Card'&&[19159413,9076207].includes(source?.card.id)?' It is a Trap, so it is not destroyed and stays Set.':''}`);
    }
  }
  function descriptor(r,code){
    if(r.preferred.has(code))return r.preferred.get(code);
    const d=r.records.get(code);if(!d)return {id:code||1,name:'Unknown card',type:'Token',desc:'',card_images:[]};
    const m=r.module;
    return {id:code,name:d.name,type:d.type&m.OcgType.MONSTER?(d.type&m.OcgType.TOKEN?'Token':d.type&m.OcgType.NORMAL?'Normal Monster':'Effect Monster'):d.type&m.OcgType.TRAP?'Trap Card':'Spell Card',atk:d.attack,def:d.defense,level:d.level,race:[...Object.entries(m.OcgRace)].find(([,value])=>value===d.race)?.[0]||'',desc:'',card_images:[]};
  }
  function sync(r){
    const {lib,handle,module:m}=r,L=m.OcgLocation,Q=m.OcgQueryFlags;
    const previous=r.state.players,pool=cardsIn(r.state),used=new Set();
    const flags=Q.CODE|Q.POSITION|Q.TYPE|Q.ATTACK|Q.DEFENSE|Q.OWNER|Q.LEVEL|Q.RACE|Q.ATTRIBUTE|Q.IS_PUBLIC|Q.STATUS|Q.COUNTERS;
    const raceName=value=>({WINGEDBEAST:'Winged Beast',BEASTWARRIOR:'Beast-Warrior',SEASERPENT:'Sea Serpent',DIVINE:'Divine-Beast'})[value]||value?.toLowerCase().replace(/^./,c=>c.toUpperCase());
    const field=lib.duelQueryField(handle),players=previous.map(p=>({...emptyPlayer(p.name),lp:p.lp}));
    for(const side of [0,1]){
      // Core LP is signed int32; the wrapper reads it as uint32. Lethal
      // overkill must display zero rather than wrapping to ~4.29 billion.
      const controller=r.team(side);players[side].lp=Math.max(0,field.players[controller].lp|0);
      for(const [zone,location] of [['deck',L.DECK],['hand',L.HAND],['monsters',L.MZONE],['spells',L.SZONE],['grave',L.GRAVE],['banished',L.REMOVED],['extra',L.EXTRA]]){
        const queries=lib.duelQueryLocation(handle,{controller,location,flags});
        queries.forEach((q,index)=>{
          if(!q?.code)return;
          if(zone==='monsters'&&index>=5||zone==='spells'&&index>5)return;
          const old=zone==='spells'&&index===5?previous[side].field:previous[side][zone][index];
          const same=old?.coreCode===q.code&&!used.has(old.uid)?old:pool.find(c=>c.coreCode===q.code&&!used.has(c.uid));
          const uid=same?.uid||`${r.id}-c${++r.uid}`;used.add(uid);
          const card={uid,coreCode:q.code,card:descriptor(r,q.code),owner:r.side(q.owner??controller),controller:side,public:!!q.isPublic,disabled:!!(q.status&1),faceUp:!!(q.position&m.OcgPosition.FACEUP),position:q.position&m.OcgPosition.DEFENSE?'defense':'attack',currentStats:{atk:Math.max(0,q.attack||0),def:Math.max(0,q.defense||0)}};
          if(q.level!==undefined)card.currentLevel=q.level;
          if(q.type!==undefined)card.currentType=q.type;
          if(q.counters)card.counters=q.counters;
          if(q.attack<0||q.defense<0)card.unknownStats={atk:q.attack<0,def:q.defense<0};
          if(q.race!==undefined)card.currentRace=raceName(Object.entries(m.OcgRace).find(([,value])=>value===q.race)?.[0])||card.card.race;
          if(q.attribute!==undefined)card.currentAttribute=Object.entries(m.OcgAttribute).find(([,value])=>value===q.attribute)?.[0]||card.card.attribute;
          if(zone==='spells'&&index===5)players[side].field=card;
          else if(zone==='monsters'||zone==='spells')players[side][zone][index]=card;
          else players[side][zone].push(card);
        });
      }
    }
    r.state.players=players;observePublic(r.state);
  }
  function describe(r,value){
    return describeNative(r.records,value);
  }
  const effectSource=r=>r.subeffectSource||r.resolving||r.automaticSource||findCard(r.state,r.sourceUid);
  const effectName=r=>effectSource(r)?.card.name;
  function movementLog(r,msg){
    const L=r.module.OcgLocation,P=r.module.OcgPosition,R=r.reason,s=r.state,reason=msg.reason||0;
    const from=cardAt(r,msg.from),side=r.side(msg.to.controller),owner=side===0?'your':'AI’s';
    const zone=location=>({[L.DECK]:'deck',[L.HAND]:'hand',[L.MZONE]:'monsters',[L.SZONE]:'spells',[L.GRAVE]:'grave',[L.REMOVED]:'banished',[L.EXTRA]:'extra'})[location];
    const visible=msg.from.location===L.GRAVE||!!(msg.from.position&P.FACEUP)&&[L.MZONE,L.SZONE,L.REMOVED].includes(msg.from.location)||msg.to.location===L.GRAVE||!!(msg.to.position&P.FACEUP)&&[L.MZONE,L.SZONE,L.REMOVED].includes(msg.to.location);
    rememberMove(s,{uid:from?.uid,card:descriptor(r,msg.card),fromSide:r.side(msg.from.controller),fromZone:zone(msg.from.location),toSide:side,toZone:zone(msg.to.location),visible});
    const destination={[L.GRAVE]:'Graveyard',[L.REMOVED]:'banished cards',[L.HAND]:'hand',[L.DECK]:'Deck',[L.EXTRA]:'Extra Deck'}[msg.to.location];
    if(msg.from.location===L.HAND&&msg.to.location===L.HAND&&msg.from.controller!==msg.to.controller){
      const known=r.side(msg.from.controller)===0||side===0||from?.public||s.revealedUIDs?.includes(from?.uid);
      log(r,`${known?descriptor(r,msg.card).name:'A card'} moved from ${r.side(msg.from.controller)===0?'your':'AI’s'} hand to ${owner} hand${effectName(r)?' by '+effectName(r):''}.`,'leave',[effectSource(r)?.uid,from?.uid].filter(Boolean),side);return;
    }
    if(!destination||msg.from.location===msg.to.location)return;
    // Draw events cover Deck → hand without leaking the AI's draws. Only log
    // other returns/searches when there is an actual movement to explain.
    if(msg.from.location===L.DECK&&msg.to.location===L.HAND)return;
    const hidden=side===1&&!(msg.to.position&P.FACEUP)&&[L.REMOVED,L.HAND,L.DECK,L.EXTRA].includes(msg.to.location);
    const publicOrigin=[L.MZONE,L.SZONE,L.GRAVE].includes(msg.from.location)&&!!(msg.from.position&P.FACEUP);
    const name=hidden&&(!publicOrigin||msg.to.location===L.REMOVED)?'A face-down card':descriptor(r,msg.card).name;
    const source=effectName(r),cause=reason&R.COST?source?` to pay ${source}’s cost`:' as a cost':reason&R.BATTLE?' in battle':reason&R.EFFECT&&source?` by ${source}`:'';
    const verb=reason&R.DISCARD?'was discarded':reason&R.RELEASE?'was Tributed':reason&R.DESTROY?'was destroyed':reason&R.MATERIAL?'was used as summon material':msg.to.location===L.REMOVED?'was banished':'moved';
    const message=`${name} ${verb}${cause}; ${msg.to.location===L.REMOVED?'placed among':'sent to'} ${owner} ${destination}.`;
    if(s.phase==='standby'&&reason&R.COST&&reason&R.DESTROY&&/Archfiend/.test(descriptor(r,msg.card).name)&&!r.resolving){notice(r,{uid:from?.uid,card:descriptor(r,msg.card),side:r.side(msg.from.controller)},'automatic','Required upkeep could not be paid; this card was destroyed.');}
    log(r,message,reason&R.COST?'cost':reason&R.DISCARD?'discard':'leave',[effectSource(r)?.uid,from?.uid].filter(Boolean),side);
  }
  function event(r,msg){
    const m=r.module,T=m.OcgMessageType,s=r.state;
    const at=cardAt(r,msg.card||msg),target=cardAt(r,msg.target);
    switch(msg.type){
      case T.RETRY:throw new Error('The rules engine rejected that selection. No fallback ruling was applied.');
      case T.NEW_TURN:s.turn++;s.active=r.side(msg.player);s.normalSummons=[0,0];s.attacksUsed={};s.declinedAttacks=[[],[]];s.turnEffects=[];s.battleOptions=[];r.upkeepPaid=new Set();r.automaticSource=null;r.subeffectSource=null;s.battleStep=null;s.pending=null;r.lastAttack=null;r.battleStrike=null;r.resolving=null;log(r,`${who(s.active)} ${s.active===0?'begin':'begins'} Turn ${s.turn}.`,'phase');break;
      case T.NEW_PHASE:{const phase={[m.OcgPhase.DRAW]:'draw',[m.OcgPhase.STANDBY]:'standby',[m.OcgPhase.MAIN1]:'main1',[m.OcgPhase.BATTLE_START]:'battle',[m.OcgPhase.BATTLE_STEP]:'battle',[m.OcgPhase.DAMAGE]:'battle',[m.OcgPhase.DAMAGE_CAL]:'battle',[m.OcgPhase.BATTLE]:'battle',[m.OcgPhase.MAIN2]:'main2',[m.OcgPhase.END]:'end'}[msg.phase];if(phase&&phase!==s.phase){s.phase=phase;s.declinedAttacks=[[],[]];if(!s.chain.length){r.sourceUid=null;r.automaticSource=null;r.subeffectSource=null;}if(phase==='standby')r.upkeepPaid=new Set();if(phase!=='battle'){s.battleStep=null;s.battleOptions=[];}log(r,PHASE_LABELS[phase]+' Phase.','phase');}break;}
      case T.SET:notePattern(s,r.side(msg.controller),'sets');if(msg.location===m.OcgLocation.MZONE)s.normalSummons[r.side(msg.controller)]++;log(r,`${who(r.side(msg.controller))} Set ${msg.location===m.OcgLocation.MZONE?'a monster (Normal Summon/Set)':'a Spell / Trap'}.`,'set',[],r.side(msg.controller));break;
      case T.DRAW:log(r,`${who(r.side(msg.player))} drew ${msg.drawn.length} card${msg.drawn.length===1?'':'s'}${r.resolving?' from '+r.resolving.card.name+'’s effect':''}.`,'draw',[r.resolving?.uid].filter(Boolean),r.side(msg.player));break;
      case T.HINT:if(msg.hint_type===1&&CORE_BATTLE_HINTS[Number(msg.hint)]&&(s.battleStep||s.pending?.kind==='attack'))battleStep(r,CORE_BATTLE_HINTS[Number(msg.hint)]);if(msg.hint_type===(m.OcgHintType?.CARD||10)){
        const code=Number(msg.hint),card=cardsIn(s).find(c=>c.coreCode===code&&(c.faceUp||c.public));
        if(card?.card.id===9603356&&s.chain.length){r.subeffectSource={uid:card.uid,card:card.card,side:card.controller};notice(r,r.subeffectSource,'automatic','Required targeting protection: roll a die. A 3 negates the opponent’s targeting effect.');}
        if(code===88132637&&s.pending?.target){const wolf=[findCard(s,s.pending.uid),findCard(s,s.pending.target)].find(c=>c?.coreCode===code);if(wolf){r.battleNegation={source:{uid:wolf.uid,card:wolf.card,side:wolf.controller},target:wolf.uid===s.pending.uid?s.pending.target:s.pending.uid};notice(r,r.battleNegation.source,'automatic','Another face-up Fiend is controlled. Negate the effects of the Flip monster destroyed by this battle.');}}
      }if(msg.hint_type===3){const key=[...r.scripts['constant.lua'].matchAll(/HINTMSG_(\w+)\s*=\s*(\d+)/g)].find(x=>BigInt(x[2])===msg.hint)?.[1];r.hint=key?'Select '+key.toLowerCase().replaceAll('_',' '):'Choose cards';}break;
      case T.SUMMONING:case T.SPSUMMONING:case T.FLIPSUMMONING:{const name=descriptor(r,msg.code).name;if(msg.type===T.SUMMONING)s.normalSummons[r.side(msg.controller)]++;log(r,`${who(r.side(msg.controller))} ${msg.type===T.SPSUMMONING?'Special Summoned':msg.type===T.FLIPSUMMONING?'Flip Summoned':'Normal Summoned'} ${name}.`,'summon',[cardAt(r,msg)?.uid].filter(Boolean),r.side(msg.controller));break;}
      case T.CHAINING:{
        const source=findCard(s,r.sourceUid),card=sourceAt(r,msg)||(source?.coreCode===msg.code&&source.controller===r.side(msg.triggering_controller)?source:null);
        r.sourceUid=card?.uid||null;r.automaticSource=null;
        const entry={uid:card?.uid,card:descriptor(r,msg.code),side:r.side(msg.triggering_controller),description:Number(msg.description),effectText:describe(r,msg.description),action:{},rule:{op:'native'},chainLink:msg.chain_size,status:'waiting'};if(!s.chain.length)s.chainId=s.serial+1;s.chain.push(entry);
        if(entry.card.type==='Trap Card')notePattern(s,entry.side,'traps');
        const text=effectExplanation(entry.card,{phase:s.phase,description:entry.description});
        log(r,`${who(entry.side)} activated ${entry.card.name} · chain link ${msg.chain_size}. ${effectBrief(entry.card,entry.effectText)}`,'activate',[card?.uid].filter(Boolean),entry.side,{chainNotice:{stage:'add',chainId:s.chainId,link:msg.chain_size,total:s.chain.length,side:entry.side,card:entry.card,text},effectNotice:{uid:entry.uid,card:entry.card,stage:'activate',text,chainLink:msg.chain_size}});break;
      }
      case T.CHAIN_END:if(s.chain.length)s.lastChain={total:s.chain.length,links:s.chain.map((c,i)=>({link:c.chainLink||i+1,side:c.side,name:c.card.name,status:c.status||'resolved'})).reverse()};if(s.chain.length)log(r,'Chain complete. All links have finished.','chain',[],s.active,{chainNotice:{stage:'complete',chainId:s.chainId,total:s.chain.length}});s.chainId=null;s.declinedAttacks=[[],[]];s.chain=[];r.sourceUid=null;r.resolving=null;r.automaticSource=null;r.subeffectSource=null;break;
      case T.CHAIN_SOLVING:{const link=s.chain[msg.chain_size-1];r.resolving=link||null;r.subeffectSource=null;if(link){link.solveStart=s.serial;link.status='resolving';}log(r,`Resolving ${link?.card.name||'effect'} · chain link ${msg.chain_size}${s.chain.length>1?' (newest links resolve first)':''}.`,'effect',link?.uid?[link.uid]:[],link?.side,{chainNotice:{stage:'resolving',chainId:s.chainId,link:msg.chain_size,total:s.chain.length,side:link?.side,card:link?.card}});break;}
      case T.CHAIN_SOLVED:{
        const link=r.resolving;resolvedStats(r,link);
        if(link&&!link.negated&&link.card.name==='Waboku'){s.turnEffects??=[];s.turnEffects.push({name:link.card.name,side:link.side});}
        if(link){
          const outcomes=s.log.filter(e=>e.id>(link.solveStart||s.serial)&&(['leave','stats','damage','heal','cost','discard','draw','position','reveal'].includes(e.kind)||e.resolutionOutcome)).map(e=>e.message);
          const ready=!link.description&&['Continuous','Field','Equip'].includes(link.card.race)&&link.card.type!=='Effect Monster';
          const required=link.card.desc?.match(/FLIP:\s*(?:Target|Destroy) (\d+) monsters?/i)?.[1];
          const noTargets=required&&!outcomes.length?`No cards changed. This Flip effect needs exactly ${required} legal monsters to target. A monster already destroyed by this battle cannot be targeted.`:'';
          const text=link.negated?`This effect was negated${link.negatedBy?' by '+link.negatedBy:''}; its effect does not apply.`:outcomes.slice(-2).join(' ')||noTargets||(ready?effectExplanation(link.card,{phase:s.phase}):'Effect resolved. See the duel feed for the sequence; any ongoing effect follows this card’s conditions.');
          link.status=link.negated?'negated':'resolved';
          notice(r,link,link.negated?'negated':ready?'ready':'resolve',text,msg.chain_size);if(!link.negationNoticed)s.log.at(-1).chainNotice={stage:link.negated?'negated':'resolved',chainId:s.chainId,link:msg.chain_size,total:s.chain.length,side:link.side,card:link.card,text};
        }
        if(link?.card.name==='Exchange')log(r,'Exchange changes the cards in each hand; it does not grant an additional Normal Summon/Set.','effect',[link.uid].filter(Boolean),link.side);
        r.resolving=null;r.subeffectSource=null;r.automaticSource=null;break;
      }
      case T.CHAIN_NEGATED:case T.CHAIN_DISABLED:{const link=s.chain[msg.chain_size-1],source=msg.type===T.CHAIN_DISABLED&&r.battleNegation&&r.battleNegation.target===link?.uid?r.battleNegation.source:null;if(link){link.negated=true;link.status='negated';if(source)link.negatedBy=source.card.name;notice(r,link,'negated',`This effect was negated${source?' by '+source.card.name:''}; it will not apply.`,msg.chain_size);link.negationNoticed=true;s.log.at(-1).chainNotice={stage:'negated',chainId:s.chainId,link:msg.chain_size,total:s.chain.length,side:link.side,card:link.card,text:'This effect was negated; it does not apply.'};}log(r,`${link?.card.name||'Effect'} · chain link ${msg.chain_size} was negated${source?' by '+source.card.name+' (another face-up Fiend is controlled)':''}; its effect will not apply.`,'effect',link?.uid?[link.uid]:[],link?.side);break;}
      case T.ATTACK_DISABLED:log(r,`${findCard(s,r.lastAttack?.uid)?.card.name||'The monster'}’s attack was negated${effectName(r)?' by '+effectName(r):''}; this attack will not deal battle damage.`,'battle');s.pending=null;s.battleStep=null;r.lastAttack=null;r.battleStrike=null;break;
      case T.DAMAGE_STEP_START:battleStep(r,'start');break;
      case T.DAMAGE_STEP_END:r.battleNegation=null;commitStrike(r);s.pending=null;r.lastAttack=null;battleStep(r,null);log(r,'Damage Step complete. Return to the Battle Step.','timing');break;
      case T.CONFIRM_CARDS:confirmCards(r,msg);break;
      // ConfirmDecktop is a different public protocol event from ConfirmCards.
      // Cyber Jar and other reveal/summon effects use it before position choices.
      case T.CONFIRM_DECKTOP:case T.CONFIRM_EXTRATOP:confirmCards(r,{...msg,player:r.team(0),publicReveal:true});break;
      case T.BECOME_TARGET:{const cards=msg.cards.map(loc=>({card:cardAt(r,loc),loc}));for(const {card,loc} of cards){const name=card&&(r.side(loc.controller)===0||card.faceUp||card.public||loc.location===m.OcgLocation.GRAVE)?card.card.name:'a face-down card';log(r,`${effectName(r)||'The effect'} targets ${name}${loc.location===m.OcgLocation.MZONE?` in ${r.side(loc.controller)===0?'your':'AI’s'} Monster Zone ${loc.sequence+1}`:''}.`,'target',[effectSource(r)?.uid,card?.uid].filter(Boolean));}break;}
      case T.ATTACK:s.declinedAttacks=[[],[]];notePattern(s,s.active,'attacks');r.attackSelectionUid=null;s.attacksUsed??={};if(at)s.attacksUsed[at.uid]=(s.attacksUsed[at.uid]||0)+1;r.lastAttack={kind:'attack',uid:at?.uid,target:target?.uid||null,side:at?.controller??s.active};s.pending=r.lastAttack;s.visualAction={type:'DECLARE_ATTACK',uid:at?.uid,target:target?.uid||null};r.battleStrike=null;battleStep(r,'attack');log(r,`${at?.card.name||'A monster'} attacked ${target?target.faceUp?target.card.name:'a face-down Defense Position monster':'Life Points directly'}.`,'attack',[at?.uid,target?.uid].filter(Boolean));break;
      case T.BATTLE:{
        const attacker=findCard(s,r.lastAttack?.uid)||cardAt(r,msg.card),defender=findCard(s,r.lastAttack?.target)||cardAt(r,msg.target);
        const side=attacker?.controller??r.lastAttack?.side??s.active,defense=!!(msg.target?.position&m.OcgPosition.DEFENSE);
        r.battleStrike={type:'ATTACK',uid:attacker?.uid,target:defender?.uid||null,presentation:'paired'};
        // Snapshot the core's calculated values before destruction moves a card.
        // No presentation is emitted at declaration or for a negated attack.
        const battleNotice=attacker?{side,attacker:{uid:attacker.uid,card:attacker.card,atk:msg.card.attack},defender:defender?{uid:defender.uid,card:defender.card,atk:msg.target.attack,def:msg.target.defense,defense}:null,targetLP:s.players[1-side].lp}:null;
        log(r,`${attacker?.card.name||'Attacker'}: ${msg.card.attack} ATK${defender?` vs ${defender.card.name}: ${defense?msg.target.defense+' DEF':msg.target.attack+' ATK'}`:' · direct attack'}.`,'battle',[attacker?.uid,defender?.uid].filter(Boolean),side,battleNotice?{battleNotice}:{});break;
      }
      case T.DAMAGE:case T.PAY_LPCOST:case T.RECOVER:{
        if(msg.type===T.PAY_LPCOST&&!r.resolving&&!r.automaticSource){sync(r);const card=upkeepSource(r,r.side(msg.player),msg.amount);if(card)r.automaticSource={uid:card.uid,card:card.card,side:card.controller};}
        const automatic=r.automaticSource;
        if(msg.type===T.PAY_LPCOST&&automatic){r.upkeepPaid??=new Set();r.upkeepPaid.add(automatic.uid);notice(r,automatic,'automatic',`Required upkeep applied: ${msg.amount.toLocaleString()} LP paid.`);}
        const side=r.side(msg.player),before=r.life[side],after=Math.max(0,before+(msg.type===T.RECOVER?msg.amount:-msg.amount));r.life[side]=after;s.players[side].lp=after;
        const lifeNotice={side,before,after,delta:after-before,amount:msg.amount,kind:msg.type===T.RECOVER?'gain':msg.type===T.PAY_LPCOST?'cost':'damage',source:effectName(r)||'',chainLink:r.resolving?.chainLink||null};
        const source=effectName(r),battle=msg.type===T.DAMAGE&&!r.resolving&&r.lastAttack;const cause=msg.type===T.PAY_LPCOST?automatic?` for ${source||'the card'}’s required upkeep`:` as ${source?source+'’s':'an effect'} activation cost`:battle?` in battle with ${findCard(s,r.lastAttack.uid)?.card.name||'the attacking monster'}`:source?` from ${source}’s effect`:'';log(r,`${who(r.side(msg.player))} ${msg.type===T.RECOVER?'gained':msg.type===T.PAY_LPCOST?'paid':'lost'} ${msg.amount.toLocaleString()} LP${cause}.`,msg.type===T.RECOVER?'heal':msg.type===T.PAY_LPCOST?'cost':'damage',battle?[r.lastAttack.uid,r.lastAttack.target].filter(Boolean):[effectSource(r)?.uid].filter(Boolean),r.side(msg.player),{targetSide:r.side(msg.player),battle:!!battle,lifeNotice});if(msg.type===T.PAY_LPCOST)r.automaticSource=null;break;}
      case T.LPUPDATE:{const side=r.side(msg.player),amount=Math.max(0,msg.lp|0),before=r.life[side];r.life[side]=amount;s.players[side].lp=amount;log(r,`${who(side)} ${amount<before?'lost':'gained'} ${Math.abs(amount-before).toLocaleString()} LP${effectName(r)?' from '+effectName(r):''}; now ${amount.toLocaleString()} LP.`,amount<before?'damage':'heal',[effectSource(r)?.uid].filter(Boolean),side,{targetSide:side,lifeNotice:{side,before,after:amount,delta:amount-before,amount:Math.abs(amount-before),kind:amount<before?'damage':'gain',source:effectName(r)||'',chainLink:r.resolving?.chainLink||null}});break;}
      case T.TOSS_COIN:case T.TOSS_DICE:{
        const source=effectSource(r),coin=msg.type===T.TOSS_COIN,called=r.coinCall||null;
        // ocgcore-wasm decodes coin bytes as booleans; numeric comparison made
        // every Heads result appear as Tails while the core applied real LP.
        const results=(msg.results||[]).map(n=>coin?n?'Heads':'Tails':n);
        const outcome=coin&&called?`Called ${called}; landed ${results.join(', ')} — ${called===results[0]?'correct':'wrong'} call.`:(coin?'Coin toss: ':'Dice roll: ')+results.join(', ')+'.';
        log(r,(source?source.card.name+' · ':'')+outcome,'effect',[source?.uid].filter(Boolean),r.side(msg.player??r.team(s.active)),coin?{coinNotice:{results,called,source:source?.card||null}}:{});r.coinCall=null;break;
      }
      case T.POS_CHANGE:if(at&&msg.location===m.OcgLocation.MZONE)log(r,`${at.card.name} changed to ${msg.position&m.OcgPosition.FACEUP?'face-up':'face-down'} ${msg.position&m.OcgPosition.DEFENSE?'Defense':'Attack'} Position${r.resolving?' by '+r.resolving.card.name:''}.`,'position',[at.uid]);break;
      case T.ADD_COUNTER:case T.REMOVE_COUNTER:if(at)log(r,`${at.card.name} ${msg.type===T.ADD_COUNTER?'gained':'lost'} ${msg.count} counter${msg.count===1?'':'s'}.`,'effect',[at.uid],at.controller,{resolutionOutcome:true});break;
      case T.SHUFFLE_HAND:forgetShuffle(s,r.side(msg.player),['hand']);break;
      case T.SHUFFLE_DECK:forgetShuffle(s,r.side(msg.player),['deck']);break;
      case T.SHUFFLE_SET_CARD:for(const side of [0,1])forgetShuffle(s,side,['monsters','spells','field']);break;
      case T.MOVE:movementLog(r,msg);break;
      case T.WIN:commitStrike(r);s.winner=msg.player===2?'draw':r.side(msg.player);s.pending=null;s.battleStep=null;r.lastAttack=null;log(r,s.winner==='draw'?'The duel is a draw.':who(s.winner)+' won the duel!','victory');break;
    }
  }
  function places(r,msg){const L=r.module.OcgLocation,options=[];for(const relative of [0,1])for(const [location,start] of [[L.MZONE,0],[L.SZONE,8]])for(const sequence of [2,1,3,0,4,5,6,7])if(((msg.field_mask>>>(relative*16+start+sequence))&1)===0)options.push({player:relative?1-msg.player:msg.player,location,sequence});return options;}
  function pump(r){
    const {lib,handle,module:m}=r,T=m.OcgMessageType;
    r.state.visualAction=null;r.state.window=null;r.state.choice=null;r.state.revealedUIDs=[];r.selected=[];r.sumPlan=undefined;
    for(let step=0;step<3000;step++){
      const status=lib.duelProcess(handle),messages=lib.duelGetMessage(handle);let prompt=null;
      for(const msg of messages){event(r,msg);if(selectionTypes(m).has(msg.type))prompt=msg;}
      if(r.errors.length)throw new Error('Card script error: '+r.errors.splice(0).join(' ').slice(0,240));
      if(r.state.winner!==null||status===m.OcgProcessResult.END){sync(r);r.prompt=null;actions(r);return;}
      if(status!==m.OcgProcessResult.WAITING)continue;
      if(!prompt)throw new Error('The engine requested an unknown response.');
      // A single required trigger needs no activation click. Multiple triggers
      // of equal priority belong to their controller's chosen chain order.
      // Old saves retain their recorded automatic ordering.
      if(prompt.type===T.SELECT_CHAIN&&prompt.forced&&prompt.selects.length&&(r.bootstrap.options.promptVersion===1||prompt.selects.length===1)){
        sync(r);const selected=prompt.selects[0],card=sourceAt(r,selected),source={uid:card?.uid,card:descriptor(r,selected.code),side:r.side(prompt.player)};
        r.sourceUid=card?.uid||null;r.automaticSource=source;
        notice(r,source,'automatic',effectExplanation(source.card,{phase:r.state.phase,description:Number(selected.description)}));
        lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_CHAIN,index:0});continue;
      }
      if(prompt.type===T.SELECT_CHAIN&&!prompt.selects.length){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_CHAIN,index:null});continue;}
      if(prompt.type===T.SELECT_PLACE){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_PLACE,places:places(r,prompt).slice(0,prompt.count)});continue;}
      if(prompt.type===T.SELECT_POSITION&&[1,2,4,8].includes(prompt.positions)){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_POSITION,position:prompt.positions});continue;}
      if(prompt.type===T.SELECT_COUNTER&&prompt.cards.length===1&&prompt.cards[0].count>=prompt.count){lib.duelSetResponse(handle,{type:m.OcgResponseType.SELECT_COUNTER,counters:[prompt.count]});continue;}
      // This script asks how many top cards to inspect. The card's printed
      // instruction is five (or the remaining Deck), so do not expose the
      // implementation's numeric prompt as though it selected a card.
      if(prompt.type===T.ANNOUNCE_NUMBER&&effectSource(r)?.card.id===17092736){const max=Math.max(...prompt.options.map(Number));lib.duelSetResponse(handle,{type:m.OcgResponseType.ANNOUNCE_NUMBER,value:prompt.options.findIndex(n=>Number(n)===max)});continue;}
      r.prompt=prompt;r.promptSequence++;sync(r);actions(r);return;
    }
    throw new Error('The engine exceeded its processing limit.');
  }
  function sumValues(selected){let values=new Set([0]);for(const card of selected){const a=card.amount&65535,b=card.amount>>>16;values=new Set([...values].flatMap(n=>[n+a,...(b?[n+b]:[])]));}return values;}
  function finishable(r,p,selected=r.selected){
    const T=r.module.OcgMessageType,n=selected.length;
    if(p.type===T.SELECT_SUM){const chosen=[...p.selects_must,...selected.map(i=>p.selects[i])];if(!p.select_max&&(n<p.min||n>p.max))return false;const values=sumValues(chosen);if(!p.select_max)return values.has(p.amount);const ranges=chosen.map(c=>{const a=c.amount&65535,b=c.amount>>>16;return [b?Math.min(a,b):a,Math.max(a,b)];});return ranges.reduce((n,c)=>n+c[1],0)>=p.amount&&ranges.reduce((n,c)=>n+c[0],0)-Math.min(...ranges.map(c=>c[0]))<p.amount;}
    if(p.type===T.SELECT_TRIBUTE){const total=r.selected.reduce((n,i)=>n+p.selects[i].release_param,0);return total>=p.min&&n<=p.max;}
    if(p.type===T.SELECT_COUNTER)return n===p.count;
    if(p.type===T.SELECT_DISFIELD)return n===p.count;
    if(p.type===T.SORT_CARD||p.type===T.SORT_CHAIN)return n===p.cards.length;
    return n>=p.min&&n<=p.max;
  }
  function sumPlan(r,p){
    const view=aiObservation(r.state,r.side(p.player));
    const candidates=p.selects.map((_,i)=>i).sort((a,b)=>{const one=locate(view,cardAt(r,p.selects[a])?.uid),two=locate(view,cardAt(r,p.selects[b])?.uid);const cost=card=>card?costValue(view,r.side(p.player),card):1500;return cost(one)-cost(two);});
    let budget=60000;
    const search=(chosen,start,count)=>{
      if(--budget<0)return null;
      if(!count)return finishable(r,p,chosen)?chosen:null;
      for(let i=start;i<=candidates.length-count;i++){const result=search([...chosen,candidates[i]],i+1,count-1);if(result)return result;}
      return null;
    };
    for(let count=0;count<=Math.min(candidates.length,p.select_max?candidates.length:p.max);count++){const result=search([],0,count);if(result)return result;if(budget<0)break;}
    return null;
  }
  function actions(r){
    buildActions(r);
    const reveal=r.state.reveals?.[0];
    if(reveal&&r.state.winner===null){r.state.actions=[[],[]];r.state.actions[reveal.viewer]=[{type:'ACK_REVEAL',id:reveal.id,label:'Done viewing'}];}
  }
  function buildActions(r){
    const {module:m,prompt:p,state:s}=r,T=m.OcgMessageType,R=m.OcgResponseType;
    r.reply.clear();r.epoch++;s.actions=[[],[]];s.choice=null;s.window=null;
    if(!p||s.winner!==null)return;
    const side=r.side(p.player),out=s.actions[side];
    const add=(action,response,stage=null)=>{const id=`${r.epoch}:${out.length}`;out.push({...action,id});r.reply.set(id,{response,stage});};
    const targetName=(card,item)=>card&&(card.controller===side||card.faceUp||card.public||s.revealedUIDs?.includes(card.uid)||item.location===m.OcgLocation.GRAVE)?card.card.name:'Face-down card';
    const located=(item,type,label,response,extra={})=>{const card=sourceAt(r,item);add({type,uid:card?.uid,label,...(item.code&&['ACTIVATE','EFFECT'].includes(type)?{effectCard:descriptor(r,item.code)}:{}),...extra},response);};
    if(p.type===T.SELECT_IDLECMD){
      if(!s.chain.length)r.sourceUid=null;
      for(const [key,command,type,label] of [['summons',m.SelectIdleCMDAction.SELECT_SUMMON,'SUMMON','Normal Summon'],['special_summons',m.SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,'SUMMON','Special Summon'],['pos_changes',m.SelectIdleCMDAction.SELECT_POS_CHANGE,'POSITION','Change position'],['monster_sets',m.SelectIdleCMDAction.SELECT_MONSTER_SET,'SUMMON','Set in Defense'],['spell_sets',m.SelectIdleCMDAction.SELECT_SPELL_SET,'SET','Set Spell / Trap'],['activates',m.SelectIdleCMDAction.SELECT_ACTIVATE,'ACTIVATE','Activate effect']])p[key].forEach((item,index)=>located(item,type,label,{type:R.SELECT_IDLECMD,action:command,index},{set:key==='monster_sets',special:key==='special_summons',tributes:[],flip:key==='pos_changes'&&!sourceAt(r,item)?.faceUp,effectText:item.description?describe(r,item.description):''}));
      if(p.to_bp)add({type:'NEXT',label:'Battle'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_BP,index:null});
      else if(p.to_ep)add({type:'NEXT',label:'End'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_EP,index:null});
      if(p.to_ep)add({type:'END'},{type:R.SELECT_IDLECMD,action:m.SelectIdleCMDAction.TO_EP,index:null});return;
    }
    if(p.type===T.SELECT_BATTLECMD){
      // A declaration that returns here without an ATTACK event was cancelled
      // (target or cost declined). Remember it for AI planning only; humans
      // retain every legal core action. A real attack/chain/phase resets it.
      s.declinedAttacks??=[[],[]];
      if(r.attackSelectionUid&&!s.declinedAttacks[side].includes(r.attackSelectionUid))s.declinedAttacks[side].push(r.attackSelectionUid);
      r.attackSelectionUid=null;
      s.pending=null;s.battleStep=null;r.lastAttack=null;r.battleStrike=null;
      if(!s.chain.length)r.sourceUid=null;
      p.chains.forEach((item,index)=>located(item,'ACTIVATE','Activate effect',{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.SELECT_CHAIN,index},{effectText:describe(r,item.description)}));
      const battleExitBlocked=!p.to_m2&&!p.to_ep;
      s.battleOptions=p.attacks.map(item=>({uid:sourceAt(r,item)?.uid,canDirect:!!item.can_direct,battleExitBlocked})).filter(item=>item.uid);
      p.attacks.forEach((item,index)=>located(item,'ATTACK','Attack',{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.SELECT_BATTLE,index},{canDirect:!!item.can_direct,battleExitBlocked,...(!s.players[1-side].monsters.some(Boolean)&&item.can_direct?{target:null}:{})}));
      if(p.to_m2)add({type:'NEXT',label:'Main 2'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_M2,index:null});else if(p.to_ep)add({type:'NEXT',label:'End'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_EP,index:null});
      if(p.to_ep)add({type:'END'},{type:R.SELECT_BATTLECMD,action:m.SelectBattleCMDAction.TO_EP,index:null});return;
    }
    if(p.type===T.SELECT_CHAIN){
      const timing=p.hint_timing|p.hint_timing_other,H=m.OcgHintTiming;
      const context=timing&H.MAIN_END?`Before ${PHASE_LABELS[s.phase]} ends, you may activate a legal fast effect.`:timing&(H.SUMMON|H.SPSUMMON|H.FLIPSUMMON)?'A monster was summoned. You may respond before play continues.':timing&H.CHAIN_END?'The previous chain has finished. You may start a new response chain.':`You may activate a legal fast effect during ${PHASE_LABELS[s.phase]}.`;
      s.window={priority:side,promptId:`${r.id}:p${r.promptSequence}`,forced:p.forced,phaseTrigger:p.selects.some(item=>!!phaseEffectText(descriptor(r,item.code),s.phase)),battleStep:s.battleStep,timing:battleContext(s)||context,event:{kind:s.pending?.kind||((timing&(H.SUMMON|H.SPSUMMON|H.FLIPSUMMON))?'summon':s.chain.length?'chain':'phase'),side:s.active}};
      if(!p.forced)add({type:'PASS'},{type:R.SELECT_CHAIN,index:null});
      p.selects.forEach((item,index)=>located(item,'ACTIVATE','Activate '+descriptor(r,item.code).name,{type:R.SELECT_CHAIN,index},{effectText:describe(r,item.description)}));return;
    }
    const promptSource=p.type===T.SELECT_EFFECTYN&&(sourceAt(r,p)||(p.code?{uid:null,card:descriptor(r,p.code),side}:null));
    const source=promptSource||effectSource(r);
    const choice={selectionType:[...Object.entries(T)].find(([,value])=>value===p.type)?.[0]?.toLowerCase(),min:p.min,max:p.max,source:source?{uid:source.uid,card:source.card,controller:source.side??source.controller}:null,side,promptId:`${r.id}:p${r.promptSequence}`,purpose:r.hint,title:r.hint,trigger:{uid:r.sourceUid,rule:{op:'native'}},options:out,selected:[],stage:false,canFinish:false};s.choice=choice;
    if(p.type===T.SELECT_CARD&&r.attackSelectionUid&&/attack/.test(r.hint)){
      choice.attackUid=r.attackSelectionUid;choice.trigger.uid=r.attackSelectionUid;
    }
    if([T.SELECT_CARD,T.SELECT_UNSELECT_CARD].includes(p.type)&&r.attackSelectionUid&&/release|tribute/.test(r.hint)){
      choice.attackCostUid=r.attackSelectionUid;choice.trigger.uid=r.attackSelectionUid;
      const attacker=findCard(s,r.attackSelectionUid);if(attacker)choice.source={uid:attacker.uid,card:attacker.card,controller:side};
    }
    if(choice.attackUid||choice.attackCostUid)choice.attackRequired=!!r.battleExitBlocked;
    const option=(label,response,extra={})=>add({type:'CHOOSE',label,...extra},response);
    const context=choiceContext(source?.card,choice.selectionType,describe(r,p.description),r.hint,s.phase);if(context.instructions)choice.instructions=context.instructions;
    if(choice.attackCostUid)choice.instructions='Choose a Tribute to pay the attack cost, then confirm. Confirming without a card cancels the attack.';
    if(p.type===T.SELECT_EFFECTYN||p.type===T.SELECT_YESNO){const target=sourceAt(r,p);choice.trigger.uid=target?.uid||(p.type===T.SELECT_YESNO?r.sourceUid:null);choice.optionalResponse=p.type===T.SELECT_EFFECTYN&&!!(choice.trigger.uid||p.code);choice.phaseTrigger=!!(choice.optionalResponse&&phaseEffectText(source?.card,s.phase));choice.effectText=context.effectText||describe(r,p.description);choice.title=context.title||((target?.card.name||source?.card.name||'Effect')+' · '+choice.effectText);const responseType=p.type===T.SELECT_EFFECTYN?R.SELECT_EFFECTYN:R.SELECT_YESNO;option(context.yes||(p.type===T.SELECT_EFFECTYN?'Activate effect':'Yes · continue'),{type:responseType,yes:true},{yes:true,effectText:choice.effectText,...(p.code?{effectCard:descriptor(r,p.code)}:{})});option(context.no||(p.type===T.SELECT_EFFECTYN?'Skip effect':'No · decline'),{type:responseType,yes:false},{yes:false});return;}
    if(p.type===T.SELECT_OPTION){choice.title=context.title||(source?.card.name?source.card.name+' · Choose an option':'Choose an effect option');p.options.forEach((desc,index)=>{const label=describe(r,desc);option(label,{type:R.SELECT_OPTION,index},/^(Heads|Tails)$/.test(label)?{coinCall:label}:{});});return;}
    if(p.type===T.SELECT_POSITION){choice.positionCard=p.code?{card:descriptor(r,p.code)}:source;choice.title='Choose battle position';choice.instructions=`Choose the position for ${choice.positionCard?.card.name||'this monster'}. Attack is face-up; Set is face-down Defense.`;for(const [position,label] of [[m.OcgPosition.FACEUP_ATTACK,'Attack Position'],[m.OcgPosition.FACEUP_DEFENSE,'Defense Position'],[m.OcgPosition.FACEDOWN_DEFENSE,'Set in Defense'],[m.OcgPosition.FACEDOWN_ATTACK,'Face-down Attack']])if(p.positions&position)option(label,{type:R.SELECT_POSITION,position},{defense:!!(position&m.OcgPosition.DEFENSE)});return;}
    if(p.type===T.SELECT_UNSELECT_CARD){
      choice.title=r.hint;choice.stage=true;
      [...p.select_cards,...p.unselect_cards].forEach((item,index)=>{const card=cardAt(r,item);option((index>=p.select_cards.length?'Unselect ':'Select ')+targetName(card,item),{type:R.SELECT_UNSELECT_CARD,index},{target:card?.uid,selected:index>=p.select_cards.length});if(index>=p.select_cards.length)choice.selected.push(card?.uid);});
      if(p.can_finish||p.can_cancel){option(p.can_finish?'Confirm selection':'Cancel effect',{type:R.SELECT_UNSELECT_CARD,index:null},{finish:!!p.can_finish,cancel:!p.can_finish});choice.canFinish=!!p.can_finish;}return;
    }
    if([T.SELECT_CARD,T.SELECT_TRIBUTE,T.SELECT_SUM,T.SELECT_COUNTER,T.SELECT_DISFIELD,T.SORT_CARD,T.SORT_CHAIN].includes(p.type)){
      choice.stage=true;let candidates=p.selects||p.cards;
      if(p.type===T.SELECT_CARD&&!choice.attackCostUid)choice.instructions=p.min===p.max?`Select ${p.min} card${p.min===1?'':'s'}, then confirm.`:`Select ${p.min}–${p.max} cards, then confirm.`;
      if(choice.attackUid)choice.instructions='Choose a highlighted monster to attack, then confirm. One arrow shows your selected target.';
      if(p.type===T.SELECT_TRIBUTE)choice.instructions=`Choose Tributes worth at least ${p.min} (up to ${p.max} monster${p.max===1?'':'s'}), then confirm.`;
      if(p.type===T.SELECT_COUNTER)choice.instructions=`Allocate ${p.count} counters by tapping their cards, then confirm.`;
      if(p.type===T.SORT_CARD||p.type===T.SORT_CHAIN)choice.instructions='Tap cards in the order you want them to resolve, then confirm.';
      if(p.type===T.SELECT_DISFIELD)candidates=places(r,p);
      const sorting=p.type===T.SORT_CARD||p.type===T.SORT_CHAIN;
      if(sorting){
        const locations=candidates.map(c=>c.location),sameDeck=p.type===T.SORT_CARD&&locations.every(l=>l===m.OcgLocation.DECK)&&candidates.every(c=>c.controller===candidates[0].controller);
        const bottom=sameDeck&&Math.max(...candidates.map(c=>c.sequence))<r.state.players[r.side(candidates[0].controller)].deck.length-1&&Math.min(...candidates.map(c=>c.sequence))===0;
        choice.ordering={kind:p.type===T.SORT_CHAIN?'chain':sameDeck?bottom?'deck-bottom':'deck-top':'cards',cards:candidates.map((item,index)=>{const instance=cardAt(r,item);return {index,uid:instance?.uid,card:item.code?descriptor(r,item.code):null,sequence:item.sequence,zone:({[m.OcgLocation.DECK]:'Deck',[m.OcgLocation.HAND]:'hand',[m.OcgLocation.GRAVE]:'Graveyard'})[item.location]||'cards'};}),selected:[...r.selected]};
        choice.instructions=sameDeck?`Use ↑ ↓ to arrange the ${bottom?'bottom':'top'} cards. Position 1 ${bottom?'is the bottom':'is drawn next'}.`:p.type===T.SORT_CHAIN?'Set the chain links. Link 1 resolves last. Confirm when ready.':'Move cards into the order requested by the effect, then confirm.';
      }
      if(p.type===T.SELECT_SUM&&r.sumPlan===undefined)r.sumPlan=sumPlan(r,p);
      candidates.forEach((item,index)=>{
        const card=cardAt(r,item),selected=r.selected.includes(index),count=r.selected.filter(i=>i===index).length;
        let label=targetName(card,item);
        if(p.type===T.SELECT_DISFIELD)label=`${r.side(item.player)===side?'Your':'Opponent’s'} ${item.location===m.OcgLocation.MZONE?'Monster':'Spell / Trap'} Zone ${item.sequence+1}`;
        if(p.type===T.SELECT_COUNTER)label+=` · ${count}/${item.count} counters`;
        const canAdd=p.type===T.SELECT_COUNTER?count<item.count:!sorting||!selected;
        if(canAdd)add({type:'CHOOSE',label:(selected?'Selected · ':'')+label,target:card?.uid,selected,...(sorting?{orderIndex:index}:{}),recommended:p.type===T.SELECT_SUM&&r.sumPlan!==null&&(selected!==r.sumPlan.includes(index))},null,{kind:p.type===T.SELECT_COUNTER?'counter':sorting?'sort':'toggle',index});
        if(selected&&card)choice.selected.push(card.uid);
      });
      if(r.selected.length&&(sorting||p.type===T.SELECT_COUNTER))add({type:'CHOOSE',label:'Reset selection',reset:true},null,{kind:'reset'});
      choice.title=`${source?.card.name?source.card.name+' · ':''}${sorting?'Choose order':r.hint} · ${r.selected.length} selected`;
      if(source?.card.id===9076207)choice.instructions=context.instructions+' '+choice.instructions;
      if(finishable(r,p)){add({type:'CHOOSE',label:'Confirm selection',finish:true},selectionResponse(r,p));choice.canFinish=true;}
      if(p.can_cancel)option(p.type===T.SELECT_TRIBUTE?'Cancel summon':'Cancel selection',{type:p.type===T.SELECT_TRIBUTE?R.SELECT_TRIBUTE:R.SELECT_CARD,indicies:null},{cancel:true});
      return;
    }
    if(p.type===T.ANNOUNCE_NUMBER){choice.title=source?.card.id===16768387?'Big Eye · How many top cards?':'Declare a number';if(source?.card.id===16768387)choice.instructions='Choose how many cards from the top of your Deck to view and reorder.';p.options.forEach((number,index)=>option(source?.card.id===16768387&&r.bootstrap.options.rulesVersion!==1?`${number} card${Number(number)===1?'':'s'}`:String(number),{type:R.ANNOUNCE_NUMBER,value:index},{number:Number(number)}));return;}
    if(p.type===T.ANNOUNCE_CARD){choice.title='Declare a card name';choice.searchable=true;for(const record of r.records.values())if(m.cardMatchesOpcode(record,p.opcodes)&&!(record.type&m.OcgType.TOKEN))option(record.name,{type:R.ANNOUNCE_CARD,card:record.code},{cardId:descriptor(r,record.code).id});return;}
    if(p.type===T.ANNOUNCE_ATTRIB||p.type===T.ANNOUNCE_RACE){
      const attribute=p.type===T.ANNOUNCE_ATTRIB,values=Object.entries(attribute?m.OcgAttribute:m.OcgRace).filter(([,value])=>attribute?((p.available&value)===value):((p.available&value)===value));
      choice.title='Declare '+(attribute?'attribute':'monster type');choice.stage=true;
      choice.instructions=`Choose ${p.count} ${attribute?'attribute':'monster type'}${p.count===1?'':'s'} · ${r.selected.length} / ${p.count} selected. Tap again to deselect.`;
      values.forEach(([label],index)=>add({type:'CHOOSE',label:label.replaceAll('_',' '),selected:r.selected.includes(index),declaration:attribute?'attribute':'race'},null,{kind:'toggle',index}));
      if(r.selected.length===p.count){option('Confirm declaration',attribute?{type:R.ANNOUNCE_ATTRIB,attributes:r.selected.map(i=>values[i][1])}:{type:R.ANNOUNCE_RACE,races:r.selected.map(i=>values[i][1])},{finish:true});choice.canFinish=true;}return;
    }
    if(p.type===T.ROCK_PAPER_SCISSORS){choice.title='Rock, paper, scissors';['Rock','Paper','Scissors'].forEach((label,index)=>option(label,{type:R.ROCK_PAPER_SCISSORS,value:index+1}));return;}
    throw new Error('Unsupported native prompt: '+m.ocgMessageTypeStrings.get(p.type));
  }
  function selectionResponse(r,p){
    const m=r.module,T=m.OcgMessageType,R=m.OcgResponseType;
    if(p.type===T.SELECT_DISFIELD)return {type:R.SELECT_DISFIELD,places:r.selected.map(i=>places(r,p)[i])};
    if(p.type===T.SELECT_COUNTER)return {type:R.SELECT_COUNTER,counters:p.cards.map((_,i)=>r.selected.filter(n=>n===i).length)};
    if(p.type===T.SORT_CARD||p.type===T.SORT_CHAIN)return {type:R.SORT_CARD,order:p.cards.map((_,i)=>r.selected.indexOf(i))};
    const type=p.type===T.SELECT_SUM?R.SELECT_SUM:p.type===T.SELECT_TRIBUTE?R.SELECT_TRIBUTE:R.SELECT_CARD;
    return {type,indicies:[...r.selected]};
  }
  function applyAction(state,action,side=state.active){
    const r=matches.get(state.runtimeId);if(!r)throw new Error('This duel has ended. Start a new match.');
    r.state=structuredClone(state);r.state.visualAction=null;
    if(action.type==='ACK_REVEAL'){
      const reveal=r.state.reveals?.[0];
      if(!reveal||reveal.viewer!==side||reveal.id!==action.id)throw new Error('That reveal is no longer available.');
      r.history.push({side,index:0,type:action.type});r.state.reveals.shift();const uids=new Set(reveal.cards.map(c=>c.uid));r.state.revealedUIDs=(r.state.revealedUIDs||[]).filter(uid=>!uids.has(uid));actions(r);return r.state;
    }
    if(action.type==='SURRENDER'){r.history.push({side,index:-1,type:action.type});r.state.winner=1-side;log(r,who(side)+' surrendered.','victory');return r.state;}
    const legal=legalActions(state,side).find(a=>action.id?a.id===action.id:a.type===action.type),reply=legal&&r.reply.get(legal.id);
    if(!reply)throw new Error('That selection is no longer legal.');
    r.history.push({side,index:legalActions(state,side).indexOf(legal),type:legal.type});if(legal.coinCall)r.coinCall=legal.coinCall;
    if(reply.stage){const {kind,index}=reply.stage;if(kind==='toggle')r.selected=r.selected.includes(index)?r.selected.filter(i=>i!==index):r.prompt.type===r.module.OcgMessageType.SELECT_CARD&&r.prompt.max===1?[index]:[...r.selected,index];else if(kind==='reset')r.selected=[];else r.selected.push(index);actions(r);return r.state;}
    if(legal.uid&&['ACTIVATE','EFFECT','SUMMON'].includes(legal.type))r.sourceUid=legal.uid;
    if(r.prompt.type===r.module.OcgMessageType.SELECT_CHAIN&&r.prompt.forced&&legal.type==='ACTIVATE'){const item=r.prompt.selects[reply.response.index],card=sourceAt(r,item);r.automaticSource={uid:card?.uid,card:descriptor(r,item.code),side};}
    if(legal.type==='ATTACK'){r.attackSelectionUid=legal.uid;r.battleExitBlocked=legal.battleExitBlocked;}
    if(r.prompt.type===r.module.OcgMessageType.SELECT_EFFECTYN&&legal.yes)r.sourceUid=state.choice?.trigger?.uid||r.sourceUid;
    if(legal.type==='PASS'||r.prompt.type===r.module.OcgMessageType.SELECT_EFFECTYN&&legal.yes===false){const trigger=state.choice?.optionalResponse?findCard(state,state.choice.trigger.uid):null;const label=trigger&&(trigger.controller===0||trigger.faceUp||trigger.public||state.revealedUIDs?.includes(trigger.uid))?trigger.card.name:null;log(r,`${who(side)} ${side===0?'pass':'passes'}${label?' on '+label+'’s optional effect':state.chain.length?' on responding to '+state.chain.at(-1).card.name:' this response opportunity'}; play continues.`,'response',[],side);}
    r.lib.duelSetResponse(r.handle,reply.response);pump(r);return r.state;
  }
  function destroyMatch(state){const r=matches.get(state?.runtimeId);if(r){r.lib.destroyDuel(r.handle);matches.delete(r.id);}}
  function exportMatch(state){const r=matches.get(state?.runtimeId);if(!r)throw new Error('This duel is no longer available.');return {version:1,presentationRevision:3,queryRevision:2,revision:r.manifest.scriptsRevision,...structuredClone(r.bootstrap),history:structuredClone(r.history),checkpoint:checkpoint(state)};}
  async function restoreMatch(save,{cards=[]}={}){
    if(save?.version!==1||!Array.isArray(save.history)||save.history.length>100000)throw new Error('This saved duel is invalid.');
    const pack=await rules();if(save.revision!==pack.manifest.scriptsRevision)throw new Error('This saved duel uses a different rules pack.');
    let state=await createMatch(save.decks,{...save.options,randomVersion:save.options?.randomVersion??1,rulesVersion:save.options?.rulesVersion??1,promptVersion:save.options?.promptVersion??1,cards});
    const legacy=![2,3].includes(save.presentationRevision);
    const acknowledgeLegacyLists=()=>{
      while((legacy&&state.reveals?.[0]?.presentationOnly)||(save.presentationRevision!==3&&state.reveals?.[0]?.deckTop)){const reveal=state.reveals[0];state=applyAction(state,legalActions(state,reveal.viewer)[0],reveal.viewer);}
    };
    try{
      for(let i=0;i<save.history.length;i++){
        const entry=save.history[i];acknowledgeLegacyLists();
        const action=entry.type==='SURRENDER'?{type:'SURRENDER'}:legalActions(state,entry.side)[entry.index];
        if(!action||action.type!==entry.type)throw new Error('Saved duel replay did not match its recorded choices.');
        state=applyAction(state,action,entry.side);if(i%100===99)await new Promise(resolve=>setTimeout(resolve,0));
      }
      acknowledgeLegacyLists();
      if(checkpoint(state)!==savedCheckpoint(save,state))throw new Error('Saved duel verification failed.');return state;
    }catch(error){destroyMatch(state);throw error;}

  }
  return {createMatch,applyAction,legalActions,stats,findCard,destroyMatch,chooseAIAction,exportMatch,restoreMatch};
}
function checkpoint(s){return JSON.stringify({turn:s.turn,active:s.active,phase:s.phase,winner:s.winner,players:s.players.map(p=>({lp:p.lp,zones:[...names.map(n=>p[n]),[p.field]].map(zone=>zone.map(c=>c?{id:c.coreCode,face:c.faceUp,position:c.position,stats:c.currentStats}:null))})),actions:s.actions.map(list=>list.map(a=>[a.type,a.label,a.selected,a.finish,a.cancel]))});}
function savedCheckpoint(save,state){
  if(save.queryRevision===2)return save.checkpoint;
  // Older checkpoints serialized unknown signed stat sentinels as uint32.
  // Normalize those fields only; all remaining state/actions still match exactly.
  try{
    const value=JSON.parse(save.checkpoint);
    for(const [side,p] of value.players.entries()){
      const actual=[...names.map(zone=>state.players[side][zone]),[state.players[side].field]];
      for(const [zoneIndex,zone] of p.zones.entries())for(const [index,card] of zone.entries())if(card?.stats){
        const current=actual[zoneIndex]?.[index];
        for(const stat of ['atk','def'])if(current?.unknownStats?.[stat]&&card.stats[stat]>=0x80000000&&card.stats[stat]<=0xffffffff)card.stats[stat]=Math.max(0,card.stats[stat]|0);
      }
    }
    return JSON.stringify(value);
  }catch{return save.checkpoint;}
}
function selectionTypes(m){const T=m.OcgMessageType;return new Set(['SELECT_BATTLECMD','SELECT_IDLECMD','SELECT_EFFECTYN','SELECT_YESNO','SELECT_OPTION','SELECT_CARD','SELECT_CHAIN','SELECT_PLACE','SELECT_POSITION','SELECT_TRIBUTE','SORT_CHAIN','SELECT_COUNTER','SELECT_SUM','SELECT_DISFIELD','SORT_CARD','SELECT_UNSELECT_CARD','ANNOUNCE_RACE','ANNOUNCE_ATTRIB','ANNOUNCE_CARD','ANNOUNCE_NUMBER','ROCK_PAPER_SCISSORS'].map(key=>T[key]));}

const backend=createNativeBackend();
export const createMatch=(...args)=>backend.createMatch(...args);
export const applyAction=(...args)=>backend.applyAction(...args);
export const destroyMatch=(...args)=>backend.destroyMatch(...args);
export const exportMatch=(...args)=>backend.exportMatch(...args);
export const restoreMatch=(...args)=>backend.restoreMatch(...args);
