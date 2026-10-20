import { cardTypeLabel } from './card-view.js';

// Choice presentation only sees cards that the arena is permitted to reveal.
// Do not place an opponent's hidden name, ID, type, or image in the view model.
function locate(state, uid) {
  for (let side=0; side<2; side++) {
    for (const zone of ['hand','monsters','spells','field','grave','banished','extra','deck']) {
      const cards=zone==='field'?[state.players[side].field]:state.players[side][zone];
      const index=cards.findIndex(card=>card?.uid===uid);
      if (index>=0) return {instance:cards[index],side,zone,index};
    }
  }
  return null;
}
const zoneNames={hand:'hand',monsters:'Monster Zone',spells:'Spell / Trap Zone',field:'Field Spell',grave:'Graveyard',banished:'Banished',extra:'Extra Deck',deck:'Deck'};
export function choiceIntent(action, purpose='') {
  if(action.coinCall)return {tone:action.coinCall==='Heads'?'gold':'blue',label:'Call '+action.coinCall};
  if (action.finish) return {tone:'teal',label:'Confirm'};
  if (action.cancel || action.yes===false) return {tone:'danger',label:'Decline'};
  if (action.reset) return {tone:'gold',label:'Reset'};
  if (action.yes===true) return {tone:'violet',label:'Activate'};
  if (action.type==='ATTACK') return {tone:'danger',label:'Attack'};
  if (action.type==='SUMMON') return {tone:action.set?'blue':'gold',label:action.set?'Set':'Summon'};
  if (action.type==='SET' || action.defense===true) return {tone:'blue',label:'Defense'};
  if (action.defense===false) return {tone:'gold',label:'Attack Position'};
  if (action.type==='ACTIVATE' || action.type==='EFFECT') return {tone:'violet',label:'Effect'};
  const text=String(purpose).toLowerCase();
  if (action.discard || /discard/.test(text)) return {tone:'danger',label:'Discard'};
  if (action.tribute || action.tributes?.length || /tribute|release/.test(text)) return {tone:'gold',label:'Tribute'};
  if (/destroy/.test(text)) return {tone:'danger',label:'Destroy'};
  if (/attack/.test(text)) return {tone:'danger',label:'Target'};
  if (/remove|banish/.test(text)) return {tone:'violet',label:'Banish'};
  if (/fusion|material/.test(text)) return {tone:'gold',label:'Material'};
  if (/recover|to hand|add to hand|spsummon|special summon/.test(text)) return {tone:'teal',label:'Choose'};
  return {tone:'blue',label:action.target?'Target':'Select'};
}
export function choiceVisuals(state, action, {isHidden,archive=new Map()}={}) {
  const uids=[action.target,action.discard,action.tribute,...(action.tributes||[]),...(action.materials||[])].filter(Boolean);
  if (!uids.length && action.uid) uids.push(action.uid);
  const result=[...new Set(uids)].map(uid=>{
    const location=locate(state,uid);if(!location)return null;
    const {instance,side,zone,index}=location;
    const place=`${side===0?'Your':'AI'} ${zoneNames[zone]}${['monsters','spells'].includes(zone)?' '+(index+1):''}`;
    const remembered=state.aiMemory?.[0]?.known?.[uid];
    const revealedHand=zone==='hand'&&state.choice?.side===0&&remembered?.zone==='hand'&&remembered.card.id===instance.card.id;
    const hidden=!revealedHand&&(isHidden?isHidden(uid):side===1&&!instance.public&&!state.revealedUIDs?.includes(uid)&&(['hand','deck','extra'].includes(zone)||!instance.faceUp&&['monsters','spells','field','banished'].includes(zone)));
    if(hidden)return {uid,hidden:true,name:'Face-down card',type:'Hidden card',place};
    return {uid,hidden:false,card:instance.card,name:instance.card.name,type:cardTypeLabel(instance.card),place};
  }).filter(Boolean);
  if(!result.length&&action.cardId&&archive.has(action.cardId)){
    const card=archive.get(action.cardId);result.push({hidden:false,card,name:card.name,type:cardTypeLabel(card),place:'Declare this card'});
  }
  return result;
}
