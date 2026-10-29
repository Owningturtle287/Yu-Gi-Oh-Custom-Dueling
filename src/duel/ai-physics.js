// Public-information forecasts only. The native core remains the rules authority.
const stat=(c,key)=>Math.max(0,c?.currentStats?.[key]??c?.card?.[key]??0);
const active=c=>!!(c?.faceUp&&!c.hidden&&!c.disabled);
const field=(s,side)=>[...s.players[side].monsters,...s.players[side].spells,s.players[side].field].filter(active);
const has=(s,side,name)=>field(s,side).some(c=>c.card.name===name);
function affected(c,effect,sourceSide,side){
  if(!active(c))return true;
  const t=c.card.desc||'',type=effect.card.type;
  if(type==='Trap Card'&&/unaffected by (?:the effects of )?Trap (?:effects|Cards)/i.test(t))return false;
  if(type==='Spell Card'&&(/unaffected by (?:the effects of )?Spell (?:effects|Cards)/i.test(t)||sourceSide!==side&&/unaffected by your opponent['’]s Spell (?:effects|Cards)/i.test(t)))return false;
  return true;
}
export function attackAllowed(s,side,c){
  if(!c||c.projectedNoAttack)return false;
  const level=c.currentLevel??c.card.level??4,atk=stat(c,'atk');
  for(const p of [0,1])for(const effect of field(s,p)){
    if(!affected(c,effect,p,side))continue;
    if(p!==side&&effect.card.name==='Swords of Revealing Light')return false;
    if(['Gravity Bind','Level Limit - Area B'].includes(effect.card.name)&&level>=4)return false;
    if(effect.card.name==='Messenger of Peace'&&atk>=1500)return false;
  }
  return true;
}
export const attackLimit=s=>[0,1].some(p=>has(s,p,'The Dark Door'))?1:Infinity;
export function effectDamage(s,target,amount){
  return s.players[target].monsters.some(c=>active(c)&&c.card.name==='Des Wombat')?0:Math.max(0,amount);
}
export function battleDamage(s,attackingSide,attacker,defender,own,enemy){
  const enabled=(c,name)=>active(c)&&c.card.name===name;
  if(enabled(attacker,'Amazoness Swords Woman')){enemy+=own;own=0;}
  if(enabled(defender,'Amazoness Swords Woman')){own+=enemy;enemy=0;}
  const prevent=(side,c)=>(s.turnEffects||[]).some(e=>e.side===side&&e.name==='Waboku')||enabled(c,'Amazoness Fighter')||has(s,side,'Spirit Barrier')&&s.players[side].monsters.some(Boolean);
  return {own:prevent(attackingSide,attacker)?0:own,enemy:prevent(1-attackingSide,defender)?0:enemy};
}
