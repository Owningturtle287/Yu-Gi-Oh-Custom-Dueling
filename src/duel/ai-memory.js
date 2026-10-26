// Knowledge is recorded only from public events or a reveal addressed to that
// player. Querying the core's hidden identities must never populate memory.
import {ERA_END} from './catalog.js';
import {matchesMonsterFilters} from '../card-filters.js';
const zones=['monsters','spells','grave','banished','hand','extra'];
const cardData=c=>Object.fromEntries(['id','name','type','race','attribute','level','atk','def','desc','archetype'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
export const DEFAULT_BELIEF=[{atk:1200,def:800,weight:1},{atk:1600,def:1400,weight:2},{atk:1800,def:1900,weight:3},{atk:1400,def:2200,weight:2},{atk:2400,def:2600,weight:1}];
export function beliefPool(cards,filters={}){
  const bins=new Map();
  for(const c of cards){
    if(!matchesMonsterFilters(c,filters)||/Fusion|Ritual|Token/.test(c.type)||!c.tcgDate||c.tcgDate>(filters.cutoff||ERA_END))continue;
    if(/Cannot be Normal Summoned|Must (?:first )?be Special Summoned/i.test(c.desc||''))continue;
    const atk=Math.round(Math.max(0,c.atk||0)/400)*400,def=Math.round(Math.max(0,c.def||0)/400)*400,key=atk+':'+def+':'+c.race;
    const row=bins.get(key)||{atk,def,race:c.race,weight:0};row.weight+=(c.level<=4?3:1)*(c.def>=c.atk?1.4:1);bins.set(key,row);
  }
  return bins.size?[...bins.values()]:DEFAULT_BELIEF.map(r=>({...r}));
}
export function createAIMemory(cards,filters=[]){const pools=[0,1].map(side=>beliefPool(cards,filters[side]));return [0,1].map(viewer=>({known:{},seen:{},handKnown:[{},{}],pool:pools[1-viewer],patterns:[{sets:0,traps:0,attacks:0},{sets:0,traps:0,attacks:0}]}));}
export function rememberCard(state,viewer,instance,zone,{hand=false}={}){
  if(!instance?.uid||!instance.card||!state.aiMemory)return;
  const m=state.aiMemory[viewer],old=m.known[instance.uid],entry={card:cardData(instance.card),side:instance.controller,zone};
  if(zone!=='deck')m.known[instance.uid]=entry;
  if(!m.seen[instance.uid])m.seen[instance.uid]={id:entry.card.id,name:entry.card.name,race:entry.card.race,type:entry.card.type,side:entry.side};
  if(hand&&zone==='hand'&&!(old?.zone==='hand'&&old.card.id===entry.card.id))m.handKnown[entry.side][entry.card.id]=Math.max(1,m.handKnown[entry.side][entry.card.id]||0);
}
export function observePublic(state){
  if(!state.aiMemory)return;
  state.players.forEach((p,side)=>{
    for(const zone of zones.concat('field'))for(const c of zone==='field'?[p.field]:p[zone]){
      if(!c)continue;
      const visible=zone==='grave'||c.public||c.faceUp&&['monsters','spells','field','banished','extra'].includes(zone);
      if(visible)for(const viewer of [0,1])rememberCard(state,viewer,c,zone,{hand:zone==='hand'});
    }
  });
}
export function forgetShuffle(state,side,shuffledZones){
  for(const m of state.aiMemory||[])for(const [uid,entry] of Object.entries(m.known))if(entry.side===side&&shuffledZones.includes(entry.zone))delete m.known[uid];
}
export function rememberMove(state,{uid,card,fromSide,fromZone,toSide,toZone,visible}){
  if(!uid||!state.aiMemory)return;
  for(const viewer of [0,1]){
    const m=state.aiMemory[viewer],known=m.known[uid];
    const canTrack=visible||viewer===fromSide&&fromZone==='hand'||!!known;
    if(fromZone==='hand'&&toZone!=='hand'){
      if(canTrack){const count=m.handKnown[fromSide][card.id]||0;if(count<=1)delete m.handKnown[fromSide][card.id];else m.handKnown[fromSide][card.id]--;}else m.handKnown[fromSide]={};
    }
    if(toZone==='deck'){delete m.known[uid];continue;}
    if(canTrack)rememberCard(state,viewer,{uid,controller:toSide,card},toZone,{hand:toZone==='hand'});
  }
}
export function notePattern(state,side,key){for(const m of state.aiMemory||[])m.patterns[side][key]++;}
export function memoryFor(state,side){return state.aiMemory?.[side]||state.memory||null;}
export function knownCard(state,side,uid){return memoryFor(state,side)?.known?.[uid]?.card||null;}
const beliefCache=new WeakMap();
const defaultProbabilities=DEFAULT_BELIEF.map(r=>({...r,probability:r.weight/9}));
export function hiddenBeliefs(state,side=state.perspective){
  const m=memoryFor(state,side),races=new Map();
  if(!m)return defaultProbabilities;
  const count=Object.keys(m.seen||{}).length,cached=beliefCache.get(m);if(cached?.count===count)return cached.rows;
  for(const seen of Object.values(m?.seen||{}))if(seen.side===1-side&&seen.type?.includes('Monster'))races.set(seen.race,(races.get(seen.race)||0)+1);
  const rows=(m?.pool||DEFAULT_BELIEF).map(r=>({...r,weight:r.weight*(1+Math.min(2,races.get(r.race)||0)*.2)})),total=rows.reduce((n,r)=>n+r.weight,0);
  const result=rows.map(r=>({...r,probability:r.weight/total}));beliefCache.set(m,{count,rows:result});return result;
}
