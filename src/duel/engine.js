import { ruleFor, isMonster, isSpell, isTrap } from './catalog.js';

export const PHASES = ['draw','standby','main1','battle','main2','end'];
export const PHASE_LABELS = {draw:'Draw',standby:'Standby',main1:'Main 1',battle:'Battle',main2:'Main 2',end:'End'};
const mainPhase = state => ['main1','main2'].includes(state.phase);
const allMonsters = state => state.players.flatMap(p => p.monsters.filter(Boolean));
const backrow = state => state.players.flatMap(p => [...p.spells.filter(Boolean), ...(p.field ? [p.field] : [])]);
const faceup = state => allMonsters(state).filter(c => c.faceUp);
const locate = (state, uid) => {
  for (let side=0;side<2;side++) {
    const player=state.players[side];
    for (const zone of ['hand','monsters','spells','grave','banished','deck','extra']) {
      const index=player[zone].findIndex(c=>c?.uid===uid);
      if (index>=0) return {instance:player[zone][index],player,side,zone,index};
    }
    if (player.field?.uid===uid) return {instance:player.field,player,side,zone:'field',index:0};
  }
  return null;
};
export const findCard = (state,uid) => locate(state,uid)?.instance;
const log = (state,message,kind='action',uids=[],details={}) => {
  const entry={id:++state.serial,turn:state.turn,phase:state.phase,side:state.active,message,kind,uids,...details}; state.log.push(entry); state.log=state.log.slice(-500); state.lastEvent=entry;
};
const rng = state => {state.seed=(Math.imul(state.seed,1664525)+1013904223)>>>0;return state.seed/4294967296;};
function shuffle(state,list) { for(let n=list.length-1;n>0;n--){const i=Math.floor(rng(state)*(n+1));[list[n],list[i]]=[list[i],list[n]];} }
const who = side => side===0?'You':'AI';
const take = (state,uid) => {
  const found=locate(state,uid); if(!found)return null;
  if(found.zone==='field') found.player.field=null;
  else if(['monsters','spells'].includes(found.zone)) found.player[found.zone][found.index]=null;
  else found.player[found.zone].splice(found.index,1);
  return found.instance;
};
const liveTrap = state => !faceup(state).some(c=>ruleFor(c.card).noTraps);
const isBanishing = state => faceup(state).some(c=>ruleFor(c.card).banish);
function send(state,uid,{bounce=false,tribute=false}={}) {
  const found=locate(state,uid);if(!found)return;
  const card=found.instance,rule=ruleFor(card.card), onField=['monsters','spells','field'].includes(found.zone);
  const banish=isBanishing(state), value=take(state,uid), owner=state.players[value.owner];
  if(bounce) {owner[value.card.type.includes('Fusion')?'extra':'hand'].push(reset(value));}
  else if(banish) owner.banished.push(reset(value));
  else if(rule.returnTop) owner.deck.unshift(reset(value));
  else owner.grave.push(reset(value));
  if(!bounce&&!banish) {
    if(onField&&rule.graveBurn) state.players[1-value.owner].lp-=rule.graveBurn;
    if(onField&&rule.op==='immortal') state.players[value.owner].lp-=5000;
  }
  if(onField) {
    // Equip cards lose their target immediately, including when it is Tributed.
    for(const equip of backrow(state).filter(c=>c.equipTarget===uid)) send(state,equip.uid);
    log(state,`${value.card.name} ${bounce?(value.card.type.includes('Fusion')?'returned to the Extra Deck':'returned to hand'):banish?'was banished':rule.returnTop?'returned to the top of the Deck':tribute?'was Tributed':'went to the Graveyard'}.`,'leave',[uid],{side:found.side});
  }
}
function reset(instance) {return {uid:instance.uid,card:instance.card,owner:instance.owner,proper:instance.proper||false};}
function checkWinner(state) {
  if(state.winner!==null)return;
  if(state.players.every(p=>p.lp<=0))state.winner='draw';
  else if(state.players[0].lp<=0)state.winner=1;
  else if(state.players[1].lp<=0)state.winner=0;
  else for(let side=0;side<2;side++) if(['Exodia the Forbidden One','Right Arm of the Forbidden One','Left Arm of the Forbidden One','Right Leg of the Forbidden One','Left Leg of the Forbidden One'].every(name=>state.players[side].hand.some(c=>c.card.name===name)))state.winner=side;
  if(state.winner!==null)log(state,state.winner==='draw'?'The duel is a draw.':`${who(state.winner)} won the duel!`,'victory');
}
function draw(state,side,count=1) {
  for(let n=0;n<count;n++) {
    if(!state.players[side].deck.length){state.winner=1-side;log(state,`${who(side)} could not draw. ${who(1-side)} won!`,'victory');return;}
    state.players[side].hand.push(state.players[side].deck.shift());
  }
  log(state,`${who(side)} drew ${count} card${count===1?'':'s'}.`,'draw',[],{side});checkWinner(state);
}
function placeMonster(state,side,uid,{faceUp=true,position='attack',proper=false}={}) {
  const player=state.players[side],index=player.monsters.indexOf(null);
  if(index<0)return;
  const instance=take(state,uid);if(!instance)return;
  player.monsters[index]={...reset(instance),controller:side,faceUp,position,summonedTurn:state.turn,changedTurn:state.turn,attacks:0,boostAtk:0,boostDef:0,proper:proper||instance.proper};
}
export function createMatch(decks,{seed=Date.now(),first=0,lp=8000}={}) {
  const state={version:1,players:[],turn:1,active:first,phase:'draw',seed:seed>>>0||1,serial:0,log:[],lastEvent:null,winner:null,chain:[],window:null,pending:null,queue:[],choice:null,normalUsed:false,chainSerial:0};
  let id=0;
  state.players=decks.map((deck,side)=>({name:deck.name||who(side),lp,deck:deck.main.map(card=>({uid:`c${++id}`,card,owner:side})),extra:(deck.extra||[]).map(card=>({uid:`c${++id}`,card,owner:side})),hand:[],monsters:Array(5).fill(null),spells:Array(5).fill(null),field:null,grave:[],banished:[],waboku:false}));
  for(let side=0;side<2;side++){shuffle(state,state.players[side].deck);draw(state,side,5);}
  log(state,`${first===0?'You go':'AI goes'} first. No first-turn draw or Battle Phase.`,'phase');
  return state;
}
export function stats(state,instance) {
  let atk=instance.card.atk||0,def=instance.card.def||0;const rule=ruleFor(instance.card), side=instance.controller??instance.owner,player=state.players[side],foe=state.players[1-side];
  const monsters=faceup(state),equips=backrow(state).filter(c=>c.faceUp&&c.equipTarget===instance.uid);
  if(rule.handBonus){atk+=rule.handBonus*player.hand.length;def+=rule.handBonus*player.hand.length;}
  if(rule.dragons)atk+=rule.dragons*(foe.monsters.filter(c=>c?.faceUp&&c.card.race==='Dragon').length+foe.grave.filter(c=>c.card.race==='Dragon').length);
  if(rule.graveBonus)atk+=rule.graveBonus*player.grave.filter(c=>isMonster(c.card)).length;
  if(rule.plants)atk+=rule.plants*monsters.filter(c=>c.card.race==='Plant').length;
  if(rule.partner)atk+=500*player.monsters.filter(c=>c?.faceUp&&c.card.name===rule.partner).length;
  if(rule.equipBonus)atk+=rule.equipBonus*equips.length;
  for(const card of monsters){const r=ruleFor(card.card);if(r.buff===instance.card.attribute)atk+=500;if(r.debuff===instance.card.attribute)atk-=400;}
  for(const equip of equips){const r=ruleFor(equip.card);atk+=r.atk||0;def+=r.def||0;}
  for(const p of state.players) if(p.field?.faceUp){
    const r=ruleFor(p.field.card);
    if(r.attribute===instance.card.attribute||r.races?.includes(instance.card.race)||(r.defenseOnly&&instance.position==='defense')){atk+=r.atk;def+=r.def;}
    if(r.penalties?.includes(instance.card.race)){atk-=200;def-=200;}
  }
  return {atk:Math.max(0,atk+(instance.boostAtk||0)),def:Math.max(0,def+(instance.boostDef||0))};
}
function targets(state,side,rule) {
  const monsters=allMonsters(state),foe=state.players[1-side];
  switch(rule.target){
    case 'monster':return monsters;
    case 'faceupMonster':return monsters.filter(c=>c.faceUp);
    case 'enemyMonster':return foe.monsters.filter(Boolean);
    case 'enemyAttack':return foe.monsters.filter(c=>c?.faceUp&&c.position==='attack');
    case 'enemyDefense':return foe.monsters.filter(c=>c?.position==='defense');
    case 'lowest':{const list=foe.monsters.filter(c=>c?.faceUp),min=Math.min(...list.map(c=>stats(state,c).atk));return list.filter(c=>stats(state,c).atk===min);}
    case 'backrow':return backrow(state);
    case 'equip':return monsters.filter(c=>c.faceUp&&(!rule.race||c.card.race===rule.race)&&(!rule.attribute||c.card.attribute===rule.attribute));
    case 'grave':return state.players.flatMap(p=>p.grave).filter(c=>isMonster(c.card)&&(!c.card.type.includes('Fusion')||c.proper));
    case 'ownGraveSpell':return state.players[side].grave.filter(c=>isSpell(c.card));
    case 'ownGraveTrap':return state.players[side].grave.filter(c=>isTrap(c.card));
    default:return [];
  }
}
function combinations(list,size) {if(!size)return [[]];return list.flatMap((item,index)=>combinations(list.slice(index+1),size-1).map(rest=>[item,...rest]));}
function fusionOptions(state,side) {
  const player=state.players[side],materials=[...player.hand,...player.monsters.filter(Boolean)];
  return player.extra.flatMap(fusion=>{
    const names=ruleFor(fusion.card).materials;if(!names)return [];
    let groups=[[]];for(const name of names)groups=groups.flatMap(group=>materials.filter(c=>c.card.name===name&&!group.includes(c.uid)).map(c=>[...group,c.uid]));
    return groups.filter(group=>player.monsters.includes(null)||group.some(uid=>player.monsters.some(c=>c?.uid===uid))).map(group=>({fusion:fusion.uid,materials:group}));
  });
}
function spellOptions(state,side,instance,respond=false) {
  const rule=ruleFor(instance.card),player=state.players[side],isResponse=!!state.window;
  if(isTrap(instance.card)&&!liveTrap(state))return [];
  const location=locate(state,instance.uid);
  if(['spells','field'].includes(location.zone)&&instance.faceUp)return [];
  if((isTrap(instance.card)||instance.card.race==='Quick-Play')&&location.zone==='spells'&&instance.setTurn===state.turn)return [];
  if(location.zone==='hand'&&(isTrap(instance.card)||side!==state.active))return [];
  if(location.zone==='hand'&&rule.op!=='field'&&!player.spells.includes(null))return [];
  const speed=rule.speed||(isTrap(instance.card)?2:1),last=state.chain.at(-1);
  if(respond&&(speed<2||(last?.speed===3&&speed!==3)))return [];
  if(isResponse&&state.window.event.kind==='damage'&&speed!==3&&rule.op!=='boost')return [];
  const event=state.window?.event;
  if(rule.event==='attack'&&!(event?.kind==='attack'&&event.side!==side))return [];
  if(rule.event==='summon'&&!(event?.kind==='summon'&&event.side!==side&&event.faceUp&&stats(state,findCard(state,event.uid)||{card:{}}).atk>=1000))return [];
  if(rule.op==='negate'){
    const counterSummon=!last&&event?.kind==='summon'&&event.faceUp&&event.side!==side&&rule.counter==='any';
    if(!counterSummon&&(!last||last.side===side||last.negated||!((rule.counter==='any'&&(isSpell(last.card)||isTrap(last.card)))||(rule.counter==='spell'&&isSpell(last.card))||(rule.counter==='trap'&&isTrap(last.card)))))return [];
  }
  if(rule.cost&&player.lp<=rule.cost)return [];
  if(rule.op==='revive'&&!player.monsters.includes(null))return [];
  if(rule.op==='control'&&!player.monsters.includes(null))return [];
  if(rule.op==='fusion')return fusionOptions(state,side).map(option=>({type:'ACTIVATE',uid:instance.uid,...option}));
  let options=rule.target?targets(state,side,rule).map(c=>({type:'ACTIVATE',uid:instance.uid,target:c.uid})):[{type:'ACTIVATE',uid:instance.uid}];
  if(rule.discard)options=options.flatMap(option=>player.hand.filter(c=>c.uid!==instance.uid).map(c=>({...option,discard:c.uid})));
  return options;
}
export function legalActions(state,side) {
  if(state.winner!==null)return [];
  if(state.choice)return state.choice.side===side?state.choice.options:[];
  if(state.window){
    if(state.window.priority!==side)return [];
    return [{type:'PASS'},...state.players[side].hand.filter(c=>isSpell(c.card)&&c.card.race==='Quick-Play').flatMap(c=>spellOptions(state,side,c,true)),...state.players[side].spells.filter(c=>c&&!c.faceUp).flatMap(c=>spellOptions(state,side,c,true))];
  }
  if(state.active!==side)return [];
  const player=state.players[side],foe=state.players[1-side],actions=[{type:'NEXT'}];
  if(state.phase==='end'&&player.hand.length>6)return player.hand.map(c=>({type:'DISCARD',uid:c.uid}));
  if(mainPhase(state)){
    actions.push({type:'END'});
    if(!state.normalUsed)for(const card of player.hand.filter(c=>isMonster(c.card)&&!c.card.type.includes('Fusion'))){
      const count=card.card.level>=7?2:card.card.level>=5?1:0;
      for(const tributes of combinations(player.monsters.filter(Boolean).map(c=>c.uid),count))if(player.monsters.includes(null)||tributes.length){
        actions.push({type:'SUMMON',uid:card.uid,tributes,set:false},{type:'SUMMON',uid:card.uid,tributes,set:true});
      }
    }
    for(const card of player.monsters.filter(Boolean)){
      if(card.summonedTurn!==state.turn&&card.changedTurn!==state.turn&&!card.attacks)actions.push({type:card.faceUp?'POSITION':'FLIP',uid:card.uid});
      const rule=ruleFor(card.card);
      if(!card.faceUp||(rule.once&&card.usedTurn===state.turn))continue;
      if(['tributeBurn','tributeBoost'].includes(rule.op))for(const tribute of player.monsters.filter(Boolean))actions.push({type:'EFFECT',uid:card.uid,tribute:tribute.uid});
      if(rule.op==='coinDestroy')for(const target of foe.monsters.filter(Boolean))actions.push({type:'EFFECT',uid:card.uid,target:target.uid});
    }
    for(const card of player.hand){
      if(isSpell(card.card))actions.push(...spellOptions(state,side,card));
      if((isSpell(card.card)||isTrap(card.card))&&(player.spells.includes(null)||ruleFor(card.card).op==='field'))actions.push({type:'SET',uid:card.uid});
      if(ruleFor(card.card).op==='thunderSearch'&&player.deck.some(c=>c.card.name==='Thunder Dragon'))for(const count of [1,2])if(player.deck.filter(c=>c.card.name==='Thunder Dragon').length>=count)actions.push({type:'EFFECT',uid:card.uid,count});
    }
    for(const card of player.spells.filter(c=>c&&!c.faceUp))actions.push(...spellOptions(state,side,card));
    if(player.field&&!player.field.faceUp)actions.push(...spellOptions(state,side,player.field));
  }
  if(state.phase==='battle'){
    for(const card of player.monsters.filter(c=>c?.faceUp&&c.position==='attack')){
      const rule=ruleFor(card.card),binding=liveTrap(state)&&backrow(state).some(c=>c.faceUp&&ruleFor(c.card).binding);
      if((card.attacks||0)>=(rule.attacks||1)||(binding&&card.card.level>=4)||(rule.attackCost&&player.lp<=rule.attackCost))continue;
      if(!foe.monsters.some(Boolean)||rule.direct)actions.push({type:'ATTACK',uid:card.uid,target:null});
      for(const target of foe.monsters.filter(Boolean))actions.push({type:'ATTACK',uid:card.uid,target:target.uid});
    }
    actions.push({type:'END'});
  }
  return actions;
}
function openWindow(state,event,priority) {state.window={event,priority,passes:0};}
function activate(state,side,action) {
  const location=locate(state,action.uid),card=location.instance,rule=ruleFor(card.card),player=state.players[side];
  if(rule.cost)player.lp-=rule.cost;
  if(rule.half)player.lp-=Math.floor(player.lp/2);
  if(action.discard)send(state,action.discard);
  if(location.zone==='hand'){
    take(state,card.uid);
    if(rule.op==='field'){if(player.field)send(state,player.field.uid);player.field={...card,faceUp:true};}
    else player.spells[player.spells.indexOf(null)]={...card,faceUp:true};
  }else card.faceUp=true;
  const negate=rule.op==='negate'?state.chain.at(-1)?.id:null;
  state.chain.push({id:++state.chainSerial,uid:card.uid,card:card.card,side,rule,speed:rule.speed||(isTrap(card.card)?2:1),action,negate});
  log(state,`${who(side)} activated ${card.card.name}.`,'activate',[card.uid,action.target].filter(Boolean),{side});
  if(state.window){state.window.priority=1-side;state.window.passes=0;}
  else openWindow(state,{kind:'effect',side},1-side);
}
function queueFlip(state,side,card) {const rule=ruleFor(card.card);if(rule.flip)state.queue.push({side,card:card.card,uid:card.uid,rule});}
function applyEffect(state,link) {
  const {side,rule,action={}}=link,player=state.players[side],foe=state.players[1-side],target=findCard(state,action.target),source=findCard(state,link.uid);
  // Continuous / Equip / Field effects require their own face-up source at resolution.
  if(['equip','field','continuous'].includes(rule.op)&&(!source||!['spells','field'].includes(locate(state,link.uid)?.zone)||!source.faceUp))return;
  switch(rule.op){
    case 'draw':draw(state,side,rule.amount);break;
    case 'upstart':draw(state,side);foe.lp+=1000;break;
    case 'burn':foe.lp-=rule.amount;player.lp-=rule.self||0;break;
    case 'heal':player.lp+=rule.amount;break;
    case 'destroyMonsters':for(const card of [...(rule.scope==='all'?allMonsters(state):foe.monsters.filter(Boolean))])send(state,card.uid);break;
    case 'storm':for(const card of [...backrow(state)])send(state,card.uid);break;
    case 'fissure':{const current=targets(state,side,rule),lowest=current.find(c=>c.uid===action.target)||current[0];if(lowest)send(state,lowest.uid);}break;
    case 'destroy':case 'flipDestroy':if(target&&['monsters','spells','field'].includes(locate(state,target.uid)?.zone))send(state,target.uid);break;
    case 'revealDestroy':if(target){if(target.card.type===rule.kind)send(state,target.uid);else log(state,`Revealed ${target.card.name}; it stays Set.`,'reveal');}break;
    case 'revive':if(target&&locate(state,target.uid)?.zone==='grave'&&player.monsters.includes(null))placeMonster(state,side,target.uid);break;
    case 'recover':if(target&&locate(state,target.uid)?.zone==='grave'){take(state,target.uid);player.hand.push(reset(target));}break;
    case 'bounce':if(target&&locate(state,target.uid)?.zone==='monsters')send(state,target.uid,{bounce:true});break;
    case 'control':if(target&&locate(state,target.uid)?.zone==='monsters'&&player.monsters.includes(null)){
      const old=locate(state,target.uid).side;take(state,target.uid);target.controller=side;target.returnSide=old;target.controlTurn=state.turn;player.monsters[player.monsters.indexOf(null)]=target;
    }break;
    case 'position':case 'turnPosition':if(target&&locate(state,target.uid)?.zone==='monsters'){
      const wasFaceUp=target.faceUp;target.position=rule.position||(target.position==='attack'?'defense':'attack');target.faceUp=true;if(!wasFaceUp)queueFlip(state,locate(state,target.uid).side,target);
    }break;
    case 'fusion':{
      const fusion=findCard(state,action.fusion);
      if(fusion&&action.materials.every(uid=>{const loc=locate(state,uid);return loc?.side===side&&['hand','monsters'].includes(loc.zone);})){for(const uid of action.materials)send(state,uid);placeMonster(state,side,fusion.uid,{proper:true});log(state,`${who(side)} Fusion Summoned ${fusion.card.name}!`,'summon',[fusion.uid]);}
    }break;
    case 'equip':if(target?.faceUp&&locate(state,target.uid)?.zone==='monsters')source.equipTarget=target.uid;else if(source)send(state,source.uid);break;
    case 'field':case 'continuous':break;
    case 'mirror':for(const card of [...foe.monsters.filter(c=>c?.position==='attack')])send(state,card.uid);break;
    case 'negateAttack':if(state.pending?.kind==='attack'){state.pending.cancelled=true;state.pending.endBattle=true;}break;
    case 'trapHole':{const uid=state.pending?.uid;if(uid&&findCard(state,uid))send(state,uid);}break;
    case 'waboku':player.waboku=true;break;
    case 'boost':if(target?.faceUp&&locate(state,target.uid)?.zone==='monsters'){target.boostAtk=(target.boostAtk||0)+(rule.atk||0);target.boostDef=(target.boostDef||0)+(rule.def||0);}break;
    case 'desserts':foe.lp-=foe.monsters.filter(Boolean).length*500;break;
    case 'gift':player.lp+=allMonsters(state).length*300;break;
    case 'negate':{
      const previous=state.chain.find(c=>c.id===link.negate);
      if(previous){previous.negated=true;if(findCard(state,previous.uid))send(state,previous.uid);}
      else if(state.pending?.kind==='summon'){state.pending.negated=true;send(state,state.pending.uid);}
    }break;
    case 'ladybug':for(const card of [...foe.monsters.filter(c=>c?.faceUp&&c.card.level===4)])send(state,card.uid);break;
    case 'princess':foe.lp-=(foe.spells.filter(Boolean).length+(foe.field?1:0))*500;break;
    case 'jar':{
      for(const p of state.players)for(const card of [...p.hand])send(state,card.uid);
      if(state.players.every(p=>p.deck.length<5)){state.winner='draw';log(state,'Both players could not draw five cards. The duel is a draw.','victory');}
      else for(let s=0;s<2;s++){draw(state,s,5);if(state.winner!==null)break;}
    }break;
    case 'immortal':player.lp+=3000;break;
    case 'tributeBurn':{const tribute=findCard(state,action.tribute);if(tribute){const damage=rule.halfAttack?Math.floor(stats(state,tribute).atk/2):rule.amount;send(state,tribute.uid,{tribute:true});foe.lp-=damage;}}break;
    case 'tributeBoost':if(findCard(state,action.tribute)){send(state,action.tribute,{tribute:true});if(findCard(state,link.uid))source.boostAtk=(source.boostAtk||0)+rule.amount;}break;
    case 'coinDestroy':{
      const heads=[rng(state),rng(state),rng(state)].filter(v=>v<.5).length;log(state,`Barrel Dragon: ${heads} heads.`,'effect');if(heads>=2&&target)send(state,target.uid);
    }break;
    case 'thunderSearch':for(let n=0;n<action.count;n++){const card=player.deck.find(c=>c.card.name==='Thunder Dragon');if(card){take(state,card.uid);player.hand.push(card);}}shuffle(state,player.deck);break;
  }
  log(state,`${link.card.name} resolved.`,'effect',[link.uid,action.target].filter(Boolean),{side});
}
function resolveChain(state) {
  while(state.chain.length&&state.winner===null){
    const link=state.chain.pop();
    if(!link.negated&&!(isTrap(link.card)&&!liveTrap(state)))applyEffect(state,link);
    else log(state,`${link.card.name} was negated.`,'effect',[],{side:link.side});
    if(isSpell(link.card)||isTrap(link.card)){
      if(!['field','continuous','equip'].includes(link.rule.op)&&findCard(state,link.uid))send(state,link.uid);
    }
    checkWinner(state);
  }
  state.chain=[];state.window=null;
  finishPending(state);drain(state);checkWinner(state);
}
function battle(state,event) {
  const attacker=findCard(state,event.uid),target=findCard(state,event.target),side=event.side,player=state.players[side],foe=state.players[1-side];
  if(!attacker||locate(state,attacker.uid)?.zone!=='monsters'||locate(state,attacker.uid)?.side!==side||attacker.position!=='attack')return;
  // A changed target field causes a replay choice instead of a free direct attack.
  if(event.target&&(!target||locate(state,target.uid)?.zone!=='monsters'||locate(state,target.uid)?.side===side))return;
  if(!event.target&&foe.monsters.some(Boolean)&&!ruleFor(attacker.card).direct)return;
  const attack=stats(state,attacker).atk;
  if(!target){const damage=foe.waboku?0:attack;foe.lp-=damage;onDamage(state,attacker,1-side,damage);log(state,`${who(side)} attacked directly for ${damage}.`,'damage',[attacker.uid]);return;}
  const flipped=!target.faceUp;target.faceUp=true;
  const defense=stats(state,target), destroyed=[],rule=ruleFor(attacker.card);
  if(target.position==='attack'){
    const delta=attack-defense.atk;
    if(delta>0){if(!foe.waboku)destroyed.push(target.uid);foe.lp-=foe.waboku?0:delta;onDamage(state,attacker,1-side,foe.waboku?0:delta);}
    else if(delta<0){if(!player.waboku)destroyed.push(attacker.uid);player.lp-=player.waboku?0:-delta;onDamage(state,target,side,player.waboku?0:-delta);}
    else if(attack!==0){if(!player.waboku)destroyed.push(attacker.uid);if(!foe.waboku)destroyed.push(target.uid);}
  }else{
    const delta=attack-defense.def;
    if(delta>0){if(!foe.waboku)destroyed.push(target.uid);const pierce=rule.pierce||backrow(state).some(c=>c.faceUp&&c.equipTarget===attacker.uid&&ruleFor(c.card).pierce);if(pierce&&!foe.waboku){foe.lp-=delta;onDamage(state,attacker,1-side,delta);}}
    else if(delta<0)player.lp-=player.waboku?0:-delta;
  }
  log(state,`${attacker.card.name} (${attack} ATK) attacked ${target.card.name} (${target.position==='defense'?defense.def+' DEF':defense.atk+' ATK'}). ${destroyed.length?destroyed.map(uid=>findCard(state,uid)?.card.name||'Monster').join(' and ')+' destroyed.':'No monster was destroyed.'}`,'battle',[attacker.uid,target.uid],{side});
  if(flipped)queueFlip(state,1-side,target);
  if(ruleFor(target.card).battleBounce)state.queue.push({side:1-side,card:target.card,uid:target.uid,rule:{op:'bounce',target:'monster'},fixedTarget:attacker.uid});
  state.pending={kind:'cleanupBattle',destroyed};
  drain(state);
}
function onDamage(state,instance,damagedSide,amount) {
  if(amount<=0)return;
  const rule=ruleFor(instance.card),side=1-damagedSide;
  if(rule.battleDraw)draw(state,side,rule.battleDraw);
  if(rule.opponentDraw)draw(state,damagedSide,rule.opponentDraw);
  if(rule.randomDiscard&&state.players[damagedSide].hand.length){const hand=state.players[damagedSide].hand;send(state,hand[Math.floor(rng(state)*hand.length)].uid);}
}
function finishPending(state) {
  if(!state.pending||state.queue.length||state.choice)return;
  const event=state.pending;state.pending=null;
  if(event.kind==='attack'){
    if(event.endBattle)state.phase='main2';
    else if(!event.cancelled)battle(state,event);
  }else if(event.kind==='summon'&&!event.negated&&event.flip){const card=findCard(state,event.uid);if(card)queueFlip(state,event.side,card);}
  else if(event.kind==='cleanupBattle')for(const uid of event.destroyed){const card=findCard(state,uid);if(card&&locate(state,uid)?.zone==='monsters'){const end=ruleFor(card.card).endBattle;send(state,uid);if(end&&locate(state,uid)?.zone==='grave')state.phase='main2';}}
}
function drain(state) {
  if(state.window||state.choice||state.winner!==null)return;
  const trigger=state.queue.shift();
  if(!trigger){finishPending(state);return;}
  if(trigger.rule.target&&!trigger.fixedTarget){
    const choices=targets(state,trigger.side,trigger.rule).map(c=>({type:'CHOOSE',target:c.uid}));
    if(choices.length){state.choice={side:trigger.side,title:`${trigger.card.name}: choose a target`,trigger,options:choices};return;}
    log(state,`${trigger.card.name}: no legal target.`,'effect',[],{side:trigger.side});drain(state);return;
  }
  applyEffect(state,{...trigger,action:{target:trigger.fixedTarget}});checkWinner(state);drain(state);
}
function endTurn(state) {
  for(const card of [...allMonsters(state)]){
    if(card.returnSide!==undefined&&card.controlTurn===state.turn){
      const side=card.returnSide;take(state,card.uid);delete card.returnSide;delete card.controlTurn;
      if(state.players[side].monsters.includes(null)){card.controller=side;state.players[side].monsters[state.players[side].monsters.indexOf(null)]=card;}else{state.players[card.owner].grave.push(reset(card));for(const equip of backrow(state).filter(c=>c.equipTarget===card.uid))send(state,equip.uid);}
    }
    if(card.faceUp&&ruleFor(card.card).endReturn&&(card.controller??card.owner)===state.active)send(state,card.uid,{bounce:true});
  }
  for(const card of allMonsters(state)){card.boostAtk=0;card.boostDef=0;card.attacks=0;}
  state.players.forEach(p=>p.waboku=false);checkWinner(state);
  state.active=1-state.active;state.turn++;state.phase='draw';state.normalUsed=false;
  log(state,`Turn ${state.turn} · ${who(state.active)}.`,'phase');draw(state,state.active);
}
function advancePhase(state) {
  if(state.phase==='end'){endTurn(state);return;}
  let index=PHASES.indexOf(state.phase)+1;
  if(state.turn===1&&PHASES[index]==='battle')index++;
  state.phase=PHASES[index];log(state,`${PHASE_LABELS[state.phase]} Phase.`,'phase');
  // Offer each player a fast-effect window between phases, even with an empty chain.
  openWindow(state,{kind:'phase',side:state.active},1-state.active);
}
export function applyAction(previous,action,side=previous.active) {
  if(action.type==='SURRENDER'){
    if(previous.winner!==null)return previous;
    const next=structuredClone(previous);next.winner=1-side;log(next,`${who(side)} surrendered.`,'victory',[],{side});return next;
  }
  const key=JSON.stringify(action);
  if(!legalActions(previous,side).some(a=>JSON.stringify(a)===key))throw new Error('That action is not legal in this phase.');
  const state=structuredClone(previous),player=state.players[side],card=findCard(state,action.uid);
  switch(action.type){
    case 'NEXT':advancePhase(state);break;
    case 'END':state.phase='end';log(state,'End Phase.','phase');openWindow(state,{kind:'phase',side},1-side);break;
    case 'DISCARD':send(state,action.uid);log(state,`${who(side)} discarded to the six-card hand limit.`,'discard');break;
    case 'PASS':state.window.passes++;if(state.window.passes>=2)resolveChain(state);else state.window.priority=1-side;break;
    case 'SUMMON':{
      for(const uid of action.tributes)send(state,uid,{tribute:true});
      placeMonster(state,side,action.uid,{faceUp:!action.set,position:action.set?'defense':'attack'});state.normalUsed=true;
      log(state,action.set?`${who(side)} Set a monster.`:`${who(side)} summoned ${card.card.name}.`,'summon',[action.uid]);
      state.pending={kind:'summon',side,uid:action.uid,faceUp:!action.set};openWindow(state,{...state.pending},1-side);
    }break;
    case 'POSITION':card.position=card.position==='attack'?'defense':'attack';card.changedTurn=state.turn;log(state,`${card.card.name} changed to ${card.position==='defense'?'Defense':'Attack'} Position.`,'position',[card.uid]);openWindow(state,{kind:'phase',side},1-side);break;
    case 'FLIP':card.faceUp=true;card.position='attack';card.changedTurn=state.turn;state.pending={kind:'summon',side,uid:card.uid,faceUp:true,flip:true};log(state,`${who(side)} Flip Summoned ${card.card.name}.`,'summon',[card.uid]);openWindow(state,{...state.pending},1-side);break;
    case 'SET':{
      take(state,card.uid);
      if(ruleFor(card.card).op==='field'){if(player.field)send(state,player.field.uid);player.field={...card,faceUp:false,setTurn:state.turn};}
      else player.spells[player.spells.indexOf(null)]={...card,faceUp:false,setTurn:state.turn};
      log(state,`${who(side)} Set a Spell / Trap.`,'set',[card.uid]);
    }break;
    case 'ACTIVATE':activate(state,side,action);break;
    case 'EFFECT':{
      const rule=ruleFor(card.card);card.usedTurn=state.turn;
      if(rule.op==='thunderSearch')send(state,card.uid);
      // Tributes are costs, paid before the opponent can respond.
      let effectRule=rule;
      if(rule.op==='tributeBurn'){const tribute=findCard(state,action.tribute);const amount=rule.halfAttack?Math.floor(stats(state,tribute).atk/2):rule.amount;send(state,action.tribute,{tribute:true});effectRule={op:'burn',amount};}
      if(rule.op==='tributeBoost'){send(state,action.tribute,{tribute:true});effectRule={op:'boost',atk:rule.amount,def:0};action={...action,target:card.uid};}
      state.chain.push({id:++state.chainSerial,uid:card.uid,card:card.card,side,rule:effectRule,speed:1,action});openWindow(state,{kind:'effect',side},1-side);log(state,`${who(side)} used ${card.card.name}.`,'activate',[card.uid]);
    }break;
    case 'ATTACK':{
      card.attacks=(card.attacks||0)+1;player.lp-=ruleFor(card.card).attackCost||0;state.pending={kind:'attack',side,uid:card.uid,target:action.target};openWindow(state,{...state.pending},1-side);
      const target=findCard(state,action.target),name=target?(target.faceUp?target.card.name:'a face-down Defense Position monster'):`${side===0?'AI’s':'your'} Life Points`;
      log(state,`${who(side)} declared an attack with ${card.card.name} against ${name}.`,'attack',[card.uid,action.target].filter(Boolean),{side});
    }break;
    case 'CHOOSE':{
      const trigger=state.choice.trigger;state.choice=null;applyEffect(state,{...trigger,action});drain(state);
    }break;
  }
  state.players.forEach((p,index)=>{
    const delta=p.lp-previous.players[index].lp;
    if(delta)log(state,`${index===0?'Your':'AI’s'} LP ${delta<0?'−':'+'}${Math.abs(delta).toLocaleString()}: ${Math.max(0,p.lp).toLocaleString()} remaining.`,delta<0?'damage':'heal',[],{side:index,lpDelta:delta});
  });
  checkWinner(state);return state;
}

// AI receives counts for hidden zones and opaque facedown cards. No hidden card IDs,
// stats, hand contents, or draw order enter its scoring function.
export function observation(state,side) {
  const copy=structuredClone(state);
  delete copy.deckBackups;
  copy.players.forEach((player,index)=>{
    player.deck=player.deck.map(()=>({hidden:true}));
    if(index!==side){
      player.hand=player.hand.map(()=>({hidden:true}));
      player.extra=player.extra.map(()=>({hidden:true}));
      if(player.field&&!player.field.faceUp)player.field={uid:player.field.uid,owner:index,faceUp:false,card:{name:'Set card',type:'Set'}};
      for(const zone of ['monsters','spells'])player[zone]=player[zone].map(c=>!c||c.faceUp?c:{uid:c.uid,owner:c.owner,controller:index,position:c.position,faceUp:false,card:{name:'Set card',type:zone==='monsters'?'Normal Monster':'Set',atk:1500,def:1500,level:4}});
    }
  });
  return copy;
}
