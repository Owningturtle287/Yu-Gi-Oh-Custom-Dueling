// Presentation helpers never change rules or read hidden card identities.
export function fieldLocation(state, uid) {
  if(!uid)return null;
  for (let side=0;side<2;side++) {
    const player=state.players[side];
    for (const zone of ['monsters','spells','field']) {
      const cards=zone==='field'?[player.field]:player[zone];
      const index=cards.findIndex(card=>card?.uid===uid);
      if(index>=0)return {side,zone,index,instance:cards[index]};
    }
  }
  return null;
}
export const cardRotation = (side, position, zone='monsters') => (side===1?180:0)+(zone==='monsters'&&position==='defense'?90:0);

export function makeFieldSelection(state, actions, {title='Choose a target',sourceUid,mandatory=false,side=0}={}) {
  if(!actions.length)return null;
  if(state.choice?.stage && actions.some(action=>fieldLocation(state,action.target)))return {actions:actions.filter(action=>fieldLocation(state,action.target)),title,sourceUid:sourceUid||state.choice.trigger?.uid,key:'target',selected:state.choice.selected||[],mandatory,side,native:true,kind:state.choice.attackUid?'attack':/release|tribute/i.test(state.choice.purpose)?'tribute':'effect'};
  let key;
  if(actions.every(action=>Object.hasOwn(action,'target')) && actions.every(action=>action.target===null&&action.type==='ATTACK'||fieldLocation(state,action.target)))key='target';
  else if(actions.every(action=>action.tribute&&fieldLocation(state,action.tribute)))key='tribute';
  else if(actions.every(action=>action.tributes?.length&&action.tributes.every(uid=>fieldLocation(state,uid))))key='tributes';
  if(!key)return null;
  return {actions,title,sourceUid:sourceUid||actions[0].uid||state.choice?.trigger?.uid,key,selected:[],mandatory,side,kind:actions.every(a=>a.type==='ATTACK')?'attack':key==='tribute'||key==='tributes'?'tribute':'effect'};
}
const remainingActions = session => session.key==='tributes'?session.actions.filter(action=>session.selected.every(uid=>action.tributes.includes(uid))):session.actions;
export function fieldCandidates(session) {
  if(!session)return {uids:new Set(),selected:new Set(),directSide:null,remaining:0};
  const actions=remainingActions(session),uids=new Set(actions.flatMap(action=>session.key==='tributes'?action.tributes:[action[session.key]]).filter(Boolean));
  return {uids,selected:new Set(session.selected),directSide:session.key==='target'&&actions.some(action=>action.type==='ATTACK'&&action.target===null)?1-session.side:null,
    remaining:session.key==='tributes'?(actions[0]?.tributes.length||0)-session.selected.length:1};
}
export function pickFieldCandidate(session, uid) {
  const candidates=fieldCandidates(session);
  if(uid===null){
    if(candidates.directSide===null)return null;
    return {session:null,actions:session.actions.filter(action=>action.type==='ATTACK'&&action.target===null)};
  }
  if(!candidates.uids.has(uid)&&!candidates.selected.has(uid))return null;
  if(session.key!=='tributes')return {session:null,actions:session.actions.filter(action=>action[session.key]===uid)};
  const selected=session.selected.includes(uid)?session.selected.filter(value=>value!==uid):[...session.selected,uid];
  const next={...session,selected},actions=remainingActions(next);
  return selected.length===(actions[0]?.tributes.length||0)?{session:null,actions}:{session:next,actions:null};
}
export function quickCardActions(actions, uid) {
  const own=actions.filter(action=>action.uid===uid),groups=[];
  for(const [types,label,tone] of [[['ATTACK'],'Attack','attack'],[['ACTIVATE','EFFECT'],'Effect','effect'],[['FLIP'],'Flip','flip']]){
    const available=own.filter(action=>types.includes(action.type));
    if(available.length)groups.push({type:available[0].type,label,tone,actions:available});
  }
  return groups;
}

export function activityCue(previous, next, action) {
  if(!previous)return {source:null,targets:[],label:'Opening hand'};
  const labels={ATTACK:'Attacking',ACTIVATE:'Activating',EFFECT:'Using effect',SUMMON:action?.set?'Setting':'Summoning',SET:'Setting',FLIP:'Flipping',POSITION:'Changing position',DISCARD:'Discarding'};
  if(action?.uid&&labels[action.type])return {source:action.uid,targets:[action.target,...(action.tributes||[]),action.tribute].filter(Boolean),label:labels[action.type],directSide:action.type==='ATTACK'&&action.target===null?1-next.active:null};
  if(action?.type==='CHOOSE')return {source:previous.choice?.trigger?.uid,targets:[action.target].filter(Boolean),label:'Resolving effect'};
  const event=[...next.log].reverse().find(entry=>entry.id>previous.serial&&entry.uids?.length&&['effect','battle','summon','activate','position','leave'].includes(entry.kind));
  return event?{source:event.uids[0],targets:event.uids.slice(1),label:{effect:'Resolving effect',battle:'Battle result',summon:'Summoning',activate:'Activating',position:'Changing position',leave:'Moving'}[event.kind]}:null;
}
export function cardActivity(state, uid, cue, selection) {
  const candidates=fieldCandidates(selection);
  if(candidates.selected.has(uid))return {role:'selected',label:'Selected'};
  if(candidates.uids.has(uid))return {role:'eligible',label:selection.sourceUid===uid?'Source / target':selection.kind==='tribute'?'Choose tribute':'Choose target'};
  if(selection?.sourceUid===uid)return {role:'source',label:'Choosing target'};
  if(state.choice?.trigger?.uid===uid)return {role:'source',label:'Effect'};
  const link=state.chain.find(link=>link.uid===uid);
  if(link)return {role:'source',label:link===state.chain.at(-1)?'Resolving next':`Chain ${state.chain.indexOf(link)+1}`};
  if(state.pending?.kind==='attack'){
    if(state.pending.uid===uid)return {role:'source',label:'Attacking'};
    if(state.pending.target===uid)return {role:'target',label:'Under attack'};
  }
  if(state.chain.some(link=>link.action?.target===uid))return {role:'target',label:'Effect target'};
  if(cue?.source===uid)return {role:'source',label:cue.label};
  if(cue?.targets.includes(uid))return {role:'target',label:'Target'};
  return {role:'',label:''};
}
