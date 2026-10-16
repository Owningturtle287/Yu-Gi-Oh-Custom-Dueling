// Selective projections for planning. These never authorize a move or resolve
// a real effect. Every executed action still comes from the native core.
const guides=new Map();
const add=(names,model,extra={})=>names.split('|').forEach(n=>guides.set(n,{model,...extra}));
add('Raigeki','wipe',{scope:'foe'});add('Dark Hole','wipe',{scope:'all'});
add('Fissure','remove',{automatic:'lowestATK'});add('Smashing Ground','remove',{automatic:'highestDEF'});add('Hammer Shot','remove',{automatic:'highestATK'});
add('Tribute to the Doomed','remove',{discard:1});add('Dark Core','remove',{discard:1,banish:true,faceUp:true});add('Nobleman of Crossout','remove',{faceDown:true,banish:true});
add('Exiled Force','remove',{releaseSelf:true});add('Black Luster Soldier - Envoy of the Beginning|Chaos Sorcerer','remove',{banish:true,faceUp:true,attackLock:true,once:true});
add('Mystical Space Typhoon|Dust Tornado','backrow');add('Breaker the Magical Warrior','backrow',{counterATK:300,once:true});
add('Heavy Storm','backrowWipe',{scope:'all'});add("Harpie's Feather Duster",'backrowWipe',{scope:'foe'});
add('Monster Reborn','revive');add('Premature Burial','revive',{ownGrave:true,pay:800,persistent:true});add('Call of the Haunted','revive',{ownGrave:true,persistent:true});
add('Change of Heart','control',{borrowed:true});add('Snatch Steal','control',{persistent:true});
add('Rush Recklessly','boost',{atk:700,temporary:true});add('Reinforcements','boost',{atk:500,temporary:true});add('Castle Walls','boost',{def:500,temporary:true});add('The Reliable Guardian','boost',{def:700,temporary:true});
add('Axe of Despair','boost',{atk:1000,persistent:true});add('Black Pendant','boost',{atk:500,persistent:true});
add('United We Stand','boost',{atk:800,dynamic:'monsters',persistent:true});add('Mage Power','boost',{atk:500,dynamic:'backrow',persistent:true});
add('Megamorph','multiply',{persistent:true});add('Book of Moon|Tsukuyomi','faceDown');
add('Cyber-Stein','fusionCheat',{pay:5000,intent:'fusionCheat',once:true});
add('Enemy Controller','controller',{intent:'position'});
add('Mask of Weakness','debuff',{atk:-700,temporary:true,intent:'debuff'});add('Shrink','halve',{intent:'debuff'});
add('Tribe-Infecting Virus','tribe',{discard:1,intent:'tribe'});
add('Pot of Greed','draw',{amount:2});add('Graceful Charity','draw',{amount:3,discardAfter:2});
add('Cannon Soldier','burn',{amount:500,tribute:1});add('Amazon Archer','burn',{amount:1200,tribute:2});add('Catapult Turtle','burn',{halfTributeATK:true,tribute:1,once:true});
add('Zaborg the Thunder Monarch','body',{summonRemove:true,mandatory:true});add('Mobius the Frost Monarch','body',{summonBackrow:2});
add('Goblin Attack Force|Spear Dragon|Giant Orc','body',{afterAttack:'defense'});
export function decisionGuidance(card,detail=''){
  const guide=guides.get(card?.name)||{};
  if(guide.attackLock&&/attack again|second attack/i.test(detail))return {};
  if(guide.model==='controller')return /control/i.test(detail)?{model:'control',tribute:1,borrowed:true}:{model:'position',intent:'position'};
  return guide;
}
export function retentionBonus(state,side,instance){
  if(!instance?.card||instance.hidden)return 0;
  const p=state.players[side],name=instance.card.name,available=[...p.hand,...p.monsters.filter(Boolean)];
  const fusionReady=available.some(c=>c.card.name==='Polymerization')||p.field?.card.name==='Fusion Gate';
  if(fusionReady)for(const fusion of p.extra){
    const parts=[...(fusion.card.desc||'').split(/\r?\n/)[0].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
    if(parts.includes(name)&&parts.every(n=>available.some(c=>c.card.name===n)))return 280;
  }
  if(name==='Megamorph'&&available.some(c=>c.card.name==='Cyber-Stein')&&p.lp>5000&&p.extra.some(c=>(c.card.atk||0)>=4000))return 350;
  if(name==='Cyber-Stein'&&p.lp>5000&&available.some(c=>c.card.name==='Megamorph')&&p.extra.some(c=>(c.card.atk||0)>=4000))return 350;
  return 0;
}
export const PLANNING_WEIGHTS=Object.freeze({material:1,hand:.52,damage:.32,reply:.65,risk:.2});
