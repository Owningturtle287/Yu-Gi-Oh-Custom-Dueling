import {locate,attack,defense,monsters,backrow,monster,resourceValue,costValue,handRemovalOptions} from './ai-knowledge.js';
import {battlePlan} from './ai-combat.js';
import {decisionGuidance,PLANNING_WEIGHTS,fusionOptions} from './ai-guidance.js';
import {memoryFor} from './ai-memory.js';
import {effectDamage} from './ai-physics.js';

// Selective, public-information projections, not a replacement rules engine.
// Only the current root is executable. The native core must authorize every
// later move, and we rebuild the plan after every choice/response/stat change.
const battleAllowed=s=>s.turn>1&&s.phase==='main1';
const copy=s=>({...s,players:s.players.map(p=>({...p,hand:[...p.hand],monsters:[...p.monsters],spells:[...p.spells],grave:[...p.grave]})),battleOptions:[],projectedUsed:new Set(s.projectedUsed||[])});
const replace=(s,side,c,next)=>{s.players[side].monsters=s.players[side].monsters.map(x=>x?.uid===c.uid?next:x);};
function remove(s,c,banish=false){
  for(const p of s.players){p.hand=p.hand.filter(x=>x.uid!==c.uid);p.monsters=p.monsters.map(x=>x?.uid===c.uid?null:x);p.spells=p.spells.map(x=>x?.uid===c.uid?null:x);if(p.field?.uid===c.uid)p.field=null;}
  if(!banish)s.players[c.owner??c.controller].grave.push(c);
}
function payDiscard(s,side,source,count){
  const pool=s.players[side].hand.filter(c=>c.uid!==source.uid).sort((a,b)=>costValue(s,side,a)-costValue(s,side,b));
  if(pool.length<count)return false;for(const c of pool.slice(0,count))remove(s,c);return true;
}
function place(s,side,c,position='attack',faceUp=true){const p=s.players[side],slot=p.monsters.indexOf(null);if(slot<0)return false;p.hand=p.hand.filter(x=>x.uid!==c.uid);p.monsters[slot]={...c,controller:side,faceUp,position};return true;}
function best(s,side,cards){return [...cards].sort((a,b)=>resourceValue(s,side,b)-resourceValue(s,side,a))[0];}
function variants(s,side,action){
  const source=locate(s,action.uid),p=s.players[side],foe=s.players[1-side];if(!source)return [];
  const guide=decisionGuidance(source.card,action.effectText),model=guide.model;
  if(action.type==='SUMMON')return [null];
  if(model==='fusion')return fusionOptions(s,side,source.card).slice(0,3);
  if(!['ACTIVATE','EFFECT'].includes(action.type)||!model||['body','draw','burn','controller'].includes(model))return [];
  if(model==='remove'){
    let targets=monsters(foe).filter(c=>(!guide.faceUp||c.faceUp)&&(!guide.faceDown||!c.faceUp));
    if(guide.automatic){if(guide.automatic==='highestATK')targets=[...monsters(p),...targets].filter(c=>c.faceUp&&c.position==='attack');else targets=targets.filter(c=>c.faceUp);targets.sort((a,b)=>guide.automatic==='lowestATK'?attack(a)-attack(b):guide.automatic==='highestDEF'?defense(b)-defense(a):attack(b)-attack(a));targets=targets.slice(0,1);}
    if(guide.sendMonster)targets=targets.filter(c=>p.hand.some(cost=>monster(cost)&&attack(cost)>=attack(c)));
    return targets.sort((a,b)=>resourceValue(s,side,b)-resourceValue(s,side,a)).slice(0,2);
  }
  if(model==='backrow')return backrow(foe).sort((a,b)=>resourceValue(s,side,b)-resourceValue(s,side,a)).slice(0,2);
  if(['boost','multiply'].includes(model))return monsters(p).filter(c=>c.faceUp).sort((a,b)=>attack(b)-attack(a)).slice(0,2);
  if(model==='faceDown'||model==='debuff'||model==='halve'||model==='control')return monsters(foe).filter(c=>c.faceUp).sort((a,b)=>attack(b)-attack(a)).slice(0,2);
  if(model==='revive')return [...p.grave,...(guide.ownGrave?[]:foe.grave)].filter(c=>monster(c)&&!c.hidden&&!/Fusion|Ritual/.test(c.card.type)&&!/Cannot be (?:Normal|Special) Summoned/i.test(c.card.desc||'')).sort((a,b)=>attack(b)-attack(a)).slice(0,2);
  if(model==='fusionCheat')return p.extra.filter(c=>/Fusion/.test(c.card.type)&&!/Must (?:first )?be Fusion Summoned|cannot be Special Summoned/i.test(c.card.desc||'')).sort((a,b)=>attack(b)-attack(a)).slice(0,2);
  if(model==='tribe')return [...new Set(monsters(foe).filter(c=>c.faceUp&&!c.hidden).map(c=>c.card.race))];
  if(model==='wipe'||model==='backrowWipe'||model==='armedWipe')return [null];
  return [];
}
function project(s,side,action,target){
  const next=copy(s),p=next.players[side],foe=next.players[1-side],source=locate(next,action.uid);if(!source)return null;
  if(action.type==='SUMMON'){
    if(!action.special&&next.projectedNormal)return null;
    const required=action.special?0:(source.currentLevel||source.card.level||4)>6?2:(source.currentLevel||source.card.level||4)>4?1:0;
    const tributes=monsters(p).filter(c=>!c.card.name.endsWith('Token')).sort((a,b)=>costValue(next,side,a)-costValue(next,side,b)).slice(0,required);
    if(tributes.length!==required)return null;for(const c of tributes)remove(next,c);
    if(!place(next,side,source,action.set?'defense':'attack',!action.set))return null;
    if(!action.special)next.projectedNormal=true;
    const guide=decisionGuidance(source.card);
    if(!action.set&&guide.summonRemove){const c=best(next,side,monsters(foe));if(c)remove(next,c);else remove(next,locate(next,source.uid));}
    if(!action.set&&guide.summonBackrow)for(const c of [...backrow(foe)].sort((a,b)=>resourceValue(next,side,b)-resourceValue(next,side,a)).slice(0,guide.summonBackrow))remove(next,c);
    return next;
  }
  const guide=decisionGuidance(source.card,action.effectText);if(!guide.model||next.projectedUsed.has(source.uid)||guide.pay>=p.lp)return null;
  const original=locate(s,source.uid);if(original.disabled||original.faceUp===false&&!p.hand.some(c=>c.uid===source.uid))return null;
  if(guide.discard&&!payDiscard(next,side,source,guide.discard))return null;
  let sent=null;
  if(guide.sendMonster){
    const options=handRemovalOptions(next,side,source).filter(row=>row.victims.length&&(!target||row.victims.some(c=>c.uid===target.uid)));
    sent=options[0]?.cost;if(!sent)return null;remove(next,sent);
  }
  p.lp-=guide.pay||0;next.projectedUsed.add(source.uid);
  const c=target?.uid?locate(next,target.uid):target;
  switch(guide.model){
    case 'fusion':{
      if(!target?.fusion||!target.materials)return null;
      for(const material of target.materials){const current=locate(next,material.uid);if(!current)return null;remove(next,current);}
      const fusion=target.fusion;p.extra=p.extra.filter(x=>x.uid!==fusion.uid);
      if(!place(next,side,{...fusion,currentStats:{atk:attack(fusion)*(guide.doubleATK?2:1),def:defense(fusion)}}))return null;
      if(guide.endDamage)next.projectedEndDamage=(next.projectedEndDamage||0)+Math.max(0,fusion.card.atk||0);
      break;
    }
    case 'remove':case 'backrow':if(!c)return null;remove(next,c,guide.banish);break;
    case 'wipe':for(const c of [...monsters(foe),...(guide.scope==='all'?monsters(p):[])])remove(next,c);break;
    case 'armedWipe':for(const c of monsters(foe).filter(c=>c.faceUp&&attack(c)<=attack(sent)))remove(next,c);break;
    case 'backrowWipe':for(const c of [...backrow(foe),...(guide.scope==='all'?backrow(p):[])].filter(c=>c.uid!==source.uid))remove(next,c);break;
    case 'tribe':for(const c of [...monsters(p),...monsters(foe)].filter(c=>c.faceUp&&c.card.race===target))remove(next,c);break;
    case 'control':if(!c||p.monsters.every(Boolean))return null;replace(next,1-side,c,null);place(next,side,{...c,borrowed:guide.borrowed});break;
    case 'revive':if(!c||p.monsters.every(Boolean))return null;for(const q of next.players)q.grave=q.grave.filter(x=>x.uid!==c.uid);place(next,side,c);break;
    case 'fusionCheat':if(!c||p.monsters.every(Boolean))return null;p.extra=p.extra.filter(x=>x.uid!==c.uid);place(next,side,c);break;
    case 'boost':case 'multiply':{
      if(!c)return null;const amount=guide.dynamic==='monsters'?monsters(p).length*(guide.atk||0):guide.dynamic==='backrow'?(backrow(p).length+1)*(guide.atk||0):guide.atk||0;
      const atk=guide.model==='multiply'?Math.floor(attack(c)*(p.lp<foe.lp?2:.5)):attack(c)+amount;
      replace(next,side,c,{...c,currentStats:{atk,def:defense(c)+(guide.def||0)},expires:guide.temporary?c.currentStats||{atk:attack(c),def:defense(c)}:c.expires});break;
    }
    case 'faceDown':if(!c)return null;replace(next,1-side,c,{...c,faceUp:false,position:'defense'});break;
    case 'debuff':case 'halve':if(!c)return null;replace(next,1-side,c,{...c,currentStats:{atk:guide.model==='halve'?Math.floor(attack(c)/2):Math.max(0,attack(c)+(guide.atk||0)),def:defense(c)},expires:c.currentStats});break;
    default:return null;
  }
  if(guide.attackLock){const current=locate(next,source.uid);if(current)replace(next,side,current,{...current,projectedNoAttack:true});}
  if(guide.counterATK){const current=locate(next,source.uid);if(current)replace(next,side,current,{...current,currentStats:{atk:Math.max(0,attack(current)-guide.counterATK),def:defense(current)}});}
  if(guide.releaseSelf)remove(next,source);
  if(source.card.type==='Spell Card'||source.card.type==='Trap Card'){
    if(guide.persistent){p.hand=p.hand.filter(c=>c.uid!==source.uid);if(!p.spells.some(c=>c?.uid===source.uid)){const slot=p.spells.indexOf(null);if(slot<0)return null;p.spells[slot]={...source,faceUp:true};}}
    else remove(next,source);
  }
  return next;
}
function followups(s,side){
  const p=s.players[side],actions=[];
  for(const c of p.hand){
    if(monster(c)&&!s.projectedNormal&&!/Fusion|Ritual/.test(c.card.type)&&!/Cannot be Normal Summoned|Must.*(?:Special|Normal) Summoned/i.test(c.card.desc||'')&&(c.card.level||4)<=4){actions.push({type:'SUMMON',uid:c.uid});if(defense(c)>attack(c)+400||/FLIP:/.test(c.card.desc||''))actions.push({type:'SUMMON',uid:c.uid,set:true});}
    if(c.card.type==='Spell Card')actions.push({type:'ACTIVATE',uid:c.uid});
  }
  for(const c of monsters(p).filter(c=>c.faceUp&&!c.disabled&&!s.projectedUsed.has(c.uid)))actions.push({type:'EFFECT',uid:c.uid});
  return actions;
}
function evaluate(s,side,weights){
  const p=s.players[side],foe=s.players[1-side];
  const available=monsters(p).filter(c=>c.faceUp&&c.position==='attack'&&!c.projectedNoAttack).map(c=>({uid:c.uid}));
  const plan=battleAllowed(s)?battlePlan(s,side,{available,width:8,maxNodes:240}):{score:0,moves:[]};
  const after=copy(s);let uncertain=false;
  for(const move of plan.moves){const attacker=locate(after,move.uid),victim=locate(after,move.target);if(!attacker)continue;const o=move.outcome;uncertain ||= !!victim?.hidden;after.players[side].lp=Math.max(0,after.players[side].lp-o.ownDamage);after.players[1-side].lp=Math.max(0,after.players[1-side].lp-o.enemyDamage);if(o.ownLost)remove(after,attacker);if(o.enemyLost&&victim)remove(after,victim);const guide=decisionGuidance(attacker.card);if(guide.afterAttack&&locate(after,attacker.uid))replace(after,side,attacker,{...attacker,position:guide.afterAttack});}
  for(const [who,q] of after.players.entries())for(const c of monsters(q)){
    if(c.borrowed&&who===side){replace(after,side,c,null);place(after,1-side,c);}
    else if(c.expires)replace(after,who,c,{...c,currentStats:c.expires});
  }
  const material=who=>monsters(after.players[who]).reduce((n,c)=>n+resourceValue(after,side,c),0)+backrow(after.players[who]).reduce((n,c)=>n+resourceValue(after,side,c)*.65,0);
  const hand=who=>after.players[who].hand.reduce((n,c)=>n+resourceValue(after,side,c),0);
  uncertain ||= backrow(foe).some(c=>c.hidden);
  const lethal=after.players[1-side].lp<=0&&!uncertain;
  if(!lethal&&s.projectedEndDamage)after.players[side].lp=Math.max(0,after.players[side].lp-effectDamage(after,side,s.projectedEndDamage));
  const response={...after,active:1-side,phase:'battle',turnEffects:[],attacksUsed:{},battleOptions:[]};
  // Public face-up defenders can change position before their next Battle.
  response.players=after.players.map((q,who)=>who===side?q:{...q,monsters:q.monsters.map(c=>c?.faceUp&&attack(c)>defense(c)?{...c,position:'attack'}:c)});
  const reply=battlePlan(response,1-side,{width:6,maxNodes:160});
  let value=(material(side)-material(1-side))*weights.material+(hand(side)-hand(1-side))*weights.hand+(after.players[side].lp-after.players[1-side].lp)*weights.damage-Math.min(12000,reply.score)*weights.reply;
  if(after.players[side].lp<=0)value-=200000;else if(lethal)value+=200000;else if(reply.score>=100000)value-=90000;
  // Set backrow creates risk, not knowledge of any specific hidden trap.
  const unseen=backrow(foe).filter(c=>c.hidden).length,memory=memoryFor(s,side),pattern=memory?.patterns?.[1-side];
  const caution=1+Math.min(1,(pattern?.traps||0)/Math.max(1,pattern?.sets||0));
  value-=unseen*plan.moves.length*70*weights.risk*caution;
  // Remembering a revealed board wipe is a reason to avoid overextension,
  // even after the opposing hand has been shuffled. It is never certainty
  // that the opponent can/will activate it in the next response window.
  const handNames=new Set(foe.hand.filter(c=>!c.hidden).map(c=>c.card.name));
  for(const seen of Object.values(memory?.seen||{}))if(memory?.handKnown?.[1-side]?.[seen.id])handNames.add(seen.name);
  if(handNames.has('Raigeki'))value-=material(side)*.25;
  else if(handNames.has('Dark Hole'))value-=Math.max(0,material(side)-material(1-side))*.2;
  return {value,lethal};
}
function boardKey(s){return s.players.map(p=>[p.lp,p.hand.map(c=>c.uid).sort().join(','),p.monsters.map(c=>c?[c.uid,c.position,attack(c),defense(c),c.projectedNoAttack].join(':'):'-').join(','),p.spells.map(c=>c?.uid||'-').join(',')].join('|')).join('/')+'|'+s.projectedNormal+'|'+[...s.projectedUsed].sort().join(',')+'|'+(s.projectedEndDamage||0);}
export function planTurn(state,side,ranked,{width=4,depth=3,maxNodes=96,weights=PLANNING_WEIGHTS}={}){
  const roots=new Map();if(state.choice||state.window||state.active!==side||!['main1','main2'].includes(state.phase))return {roots,nodes:0};
  const start=copy(state);start.projectedNormal=!!(state.normalSummons?.[side]);
  const cache=new Map();let nodes=0;
  const assess=s=>{const key=boardKey(s);if(!cache.has(key)){cache.set(key,evaluate(s,side,weights));nodes++;}return cache.get(key);};
  const baseline=assess(start);
  // Limit real roots, but retain low-scoring summon/effect setups for combos.
  const eligible=ranked.filter(r=>['SUMMON','ACTIVATE','EFFECT'].includes(r.action.type)&&r.score>-5000).slice(0,10);
  let frontier=[];
  for(const row of eligible)for(const target of variants(start,side,row.action)){
    if(nodes>=maxNodes)break;const s=project(start,side,row.action,target);if(!s)continue;const result=assess(s),node={s,root:row.action.id,result,steps:1};
    if(!roots.has(node.root)||roots.get(node.root).value<result.value)roots.set(node.root,{...result,value:result.value,delta:result.value-baseline.value,steps:1});frontier.push(node);
  }
  for(let d=1;d<depth&&frontier.length&&nodes<maxNodes;d++){
    const candidates=[];for(const node of frontier.sort((a,b)=>b.result.value-a.result.value).slice(0,width))for(const action of followups(node.s,side))for(const target of variants(node.s,side,action)){
      if(nodes>=maxNodes)break;const s=project(node.s,side,action,target);if(!s)continue;const result=assess(s),value=result.value-d*35,next={s,root:node.root,result:{...result,value},steps:d+1};
      if(!roots.has(node.root)||roots.get(node.root).value<value)roots.set(node.root,{...result,value,delta:value-baseline.value,steps:d+1});candidates.push(next);
    }frontier=candidates;
  }
  return {roots,nodes,baseline:baseline.value};
}
