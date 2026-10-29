import {aiObservation,locate,attack,defense,monsters,backrow,monster,text,zoneOf,effectProfile,combatTraits,resourceValue,costValue,drawValue,handRemovalOptions} from './ai-knowledge.js';
import {battleOutcome,battlePlan,incomingDamage} from './ai-combat.js';
import {planTurn} from './ai-turn.js';
import {attackAllowed,effectDamage} from './ai-physics.js';
import {decisionGuidance,levelUpgrade,fusionOptions} from './ai-guidance.js';
import {learningAdjustment} from './ai-learning.js';

const harmful=new Set(['removal','backrowRemoval','bounce','harmfulEquip','graveRemoval']);
const valuable=new Set(['draw','search','recover','revive','control','wipe','mirror','negate']);
const body=c=>Math.max(attack(c),defense(c)*.8);
const canBattle=s=>s.active===s.perspective&&s.turn>1&&s.phase!=='main2'&&s.phase!=='end';
const aliveCards=p=>monsters(p).concat(backrow(p));
function withPlayers(s,side,patch){const copy={...s,players:[...s.players]};copy.players[side]={...s.players[side],...patch};return copy;}
function sourceFor(s){return locate(s,s.choice?.trigger?.uid)||s.choice?.source||null;}
function valueOf(ctx,c){return resourceValue(ctx.s,ctx.side,c);}
function harmfulValue(ctx,c){
  if(!c)return 0;const where=zoneOf(ctx.s,c.uid),own=where?.side===ctx.side;
  let value=valueOf(ctx,c);
  if(['grave','banished','deck','hand'].includes(where?.zone))value*=.5;
  if(c.faceUp&&c.disabled)value*=.7;
  if(!own&&c.card.name==='Jinzo'&&!c.disabled)value+=backrow(ctx.p).filter(c=>c.card.type==='Trap Card').reduce((n,t)=>n+valueOf(ctx,t)*.7,0);
  if(own&&['Sangan','Witch of the Black Forest'].includes(c.card.name))value*=.4;
  // Sending a spent continuous effect or borrowed monster away is less costly.
  return own?-value:value;
}
function bestTarget(ctx,intent,source){
  const targets=intent==='backrowRemoval'?backrow(ctx.foe):intent==='revive'?ctx.s.players.flatMap(p=>p.grave):monsters(ctx.foe);
  return Math.max(-1000,...targets.map(c=>targetScore(ctx,{target:c.uid},intent,source)));
}
function boostTargetScore(ctx,c,profile){
  if(!c||c.controller!==ctx.side||!c.faceUp)return -3000;
  const {s,side}=ctx,addAtk=profile.dynamic==='monsters'?monsters(ctx.p).length*profile.atk:profile.dynamic==='backrow'?(backrow(ctx.p).length+1)*profile.atk:profile.atk||0;
  const improved={...c,currentStats:{atk:attack(c)+addAtk,def:defense(c)+(profile.def||0)}};
  if(s.pending?.kind==='attack'){
    if(c.uid!==s.pending.uid&&c.uid!==s.pending.target)return -500;
    const attacker=locate(s,s.pending.uid),defender=locate(s,s.pending.target);if(!attacker)return -500;
    if(profile.def&&(!defender||defender.uid!==c.uid||c.position!=='defense'))return -500;
    if(profile.atk&&c.position==='defense')return -500;
    const attacking=attacker.controller===side;
    const before=battleOutcome(s,attacker.controller,attacker,defender),after=battleOutcome(s,attacker.controller,attacker.uid===c.uid?improved:attacker,defender?.uid===c.uid?improved:defender);
    let gain=(after.value-before.value)*(attacking?1:-1);
    if(attacking&&ctx.foe.lp<=after.enemyDamage&&ctx.foe.lp>before.enemyDamage)gain+=100000;
    if(!attacking&&ctx.p.lp<=before.enemyDamage&&ctx.p.lp>after.enemyDamage)gain+=100000;
    return gain-400;
  }
  if(!canBattle(s)&&profile.temporary)return -600;
  if(!monsters(ctx.foe).length)return canBattle(s)&&ctx.foe.lp<=attack(c)+addAtk?5000:profile.temporary?-160:200+addAtk*.18;
  const foes=monsters(ctx.foe);
  const gain=Math.max(...foes.map(target=>battleOutcome(s,side,improved,target).value-battleOutcome(s,side,c,target).value));
  return gain+(profile.temporary?-400:150);
}
function targetScore(ctx,a,intent,source){
  const c=locate(ctx.s,a.target);if(!c)return -1000;
  const where=zoneOf(ctx.s,c.uid),own=where?.side===ctx.side;
  if(intent==='cost'||intent==='material'){
    if(decisionGuidance(source?.card).sendMonster&&where?.zone==='hand'&&ctx.s.choice?.selectionType!=='select_tribute'){
      return handRemovalOptions(ctx.s,ctx.side,source).find(row=>row.cost.uid===c.uid)?.score??-100000;
    }
    if(source?.card.name==='Catapult Turtle'&&attack(c)/2>=ctx.foe.lp)return 10000-costValue(ctx.s,ctx.side,c);
    return -costValue(ctx.s,ctx.side,c);
  }
  if(intent==='swap')return own?-valueOf(ctx,c):valueOf(ctx,c);
  if(['search','recover','revive'].includes(intent)){
    let value=valueOf(ctx,c);
    if(intent==='revive'){
      value=monster(c)?550+attack(c)*.4+defense(c)*.08:-1000;
      if(attack(c)>Math.max(0,...monsters(ctx.foe).map(body)))value+=350;
      if(!monsters(ctx.p).length)value+=200;
    }
    if(intent!=='revive'&&!own)value=-value;
    if(['search','recover'].includes(intent)&&monster(c)){
      const required=c.card.level>6?2:c.card.level>4?1:0;
      if(required>monsters(ctx.p).length)value-=850;
      if(/Ritual/.test(c.card.type))value-=500;
      if(c.card.level<=4&&!monsters(ctx.p).length)value+=500;
      if(/FLIP:/.test(text(c)))value+=200;
    }
    return value;
  }
  if(intent==='control')return own?-2000:800+valueOf(ctx,c);
  if(intent==='debuff')return own?-2000:300+attack(c)*.3;
  if(intent==='boost'||intent==='equip')return boostTargetScore(ctx,c,effectProfile(source?.card||source));
  if(intent==='megamorph'){
    const beneficial=ctx.p.lp<ctx.foe.lp;
    if(own!==beneficial)return -2000;
    const changed={...c,currentStats:{atk:Math.max(0,c.card.atk??attack(c))*(beneficial?2:.5),def:defense(c)}};
    const gain=own?attack(changed)-attack(c):attack(c)-attack(changed);
    return valueOf(ctx,c)+gain*.5+(own&&c.position==='attack'&&canBattle(ctx.s)&&attack(changed)>=ctx.foe.lp?100000:0);
  }
  if(intent==='pierce')return own&&c.position==='attack'?attack(c)*.4:-1500;
  if(intent==='position'){
    if(c.hidden)return own?-100:100;
    if(source?.card.name==='Book of Moon'||source?.card.name==='Tsukuyomi'){
      if(own)return ctx.s.pending?.target===c.uid&&c.position==='attack'&&defense(c)>attack(c)?500:-700;
      return c.position==='attack'?300+Math.max(0,attack(c)-defense(c))*.7:valueOf(ctx,c)*.2;
    }
    return own?(defense(c)>attack(c)?100:-300):Math.abs(attack(c)-defense(c))*.5+150;
  }
  if(intent==='backrowRemoval'){
    let score=harmfulValue(ctx,c);
    // Destroying a resolving Normal Spell/Trap does not negate its effect.
    const link=ctx.s.chain.at(-1);
    if(link?.uid===c.uid&&!['Continuous','Equip','Field'].includes(c.card.race))score=own?-1000:-300;
    if(!own&&c.faceUp&&['Continuous','Field','Equip'].includes(c.card.race))score+=350;
    return score;
  }
  if(harmful.has(intent)||intent==='chaos'){
    let value=harmfulValue(ctx,c);
    if(!own&&where?.zone==='monsters'&&canBattle(ctx.s)){
      const next=withPlayers(ctx.s,1-ctx.side,{monsters:ctx.foe.monsters.map(x=>x?.uid===c.uid?null:x)});
      const gain=battlePlan(next,ctx.side).score-ctx.plan.score;value+=Math.max(-1500,Math.min(12000,gain*.6));
    }
    return value;
  }
  // For an unclassified target, ownership beats a small ATK difference. Never
  // mistake an own monster for a desirable destructive target.
  return own?-valueOf(ctx,c):valueOf(ctx,c)*.7;
}
function choiceIntent(ctx){
  const c=ctx.s.choice,hint=(c?.purpose||c?.title||'').toLowerCase(),source=sourceFor(ctx.s),profile=effectProfile(source?.card,c?.effectText);
  if(c?.selectionType==='select_tribute'||/discard|release|tribute|fusion material|ritual|remove counter|cost/.test(hint)||decisionGuidance(source?.card).sendMonster&&/tograve|to grave/.test(hint))return {intent:'cost',source,profile};
  if(c?.selectionType==='select_sum')return {intent:'material',source,profile};
  if(/spsummon|special summon/.test(hint))return {intent:'revive',source,profile};
  if(/atohand|add to hand/.test(hint))return {intent:'search',source,profile};
  if(/destroy/.test(hint))return {intent:profile.intent==='backrowRemoval'?'backrowRemoval':'removal',source,profile};
  if(/equip/.test(hint))return {intent:['control','megamorph','pierce','harmfulEquip'].includes(profile.intent)?profile.intent:'equip',source,profile};
  if(/remove|banish/.test(hint)&&profile.intent==='graveBoost')return {intent:'cost',source,profile};
  return {intent:profile.intent,source,profile};
}
function fusionUtility(ctx,sourceCard){
  const guide=decisionGuidance(sourceCard);
  const scores=fusionOptions(ctx.s,ctx.side,sourceCard).map(({fusion,materials})=>{
    const used=new Set(materials.map(c=>c.uid)),remaining=ctx.p.monsters.map(c=>used.has(c?.uid)?null:c),slot=remaining.indexOf(null);if(slot<0)return -10000;
    const placed={...fusion,faceUp:true,position:'attack',controller:ctx.side,currentStats:{atk:attack(fusion)*(guide.doubleATK?2:1),def:defense(fusion)}};remaining[slot]=placed;
    const next=withPlayers(ctx.s,ctx.side,{monsters:remaining}),battle=canBattle(ctx.s)?battlePlan(next,ctx.side):{score:0};
    const debt=guide.endDamage?effectDamage(next,ctx.side,Math.max(0,fusion.card.atk||0)):0,winning=battle.score>=100000&&!backrow(ctx.foe).some(c=>c.hidden);
    if(debt>=ctx.p.lp&&!winning)return -100000;
    return valueOf(ctx,placed)+Math.min(16000,battle.score-ctx.plan.score)*.6-materials.reduce((n,c)=>n+costValue(ctx.s,ctx.side,c)*.8,0)-debt*.35-350;
  });
  return scores.length?Math.max(...scores):-1000;
}

function scoreEffect(ctx,a){
  const {s,side,p,foe}=ctx,source=locate(s,a.uid)||{uid:a.uid,card:a.effectCard},card=source.card;if(!card)return -200;
  const profile=effectProfile(card,a.effectText),intent=profile.intent,opp=monsters(foe),ours=monsters(p);
  const upgrade=levelUpgrade(card,s.phase);
  if(upgrade&&(s.choice?.phaseTrigger||s.window?.phaseTrigger)&&/Special Summon/i.test(a.effectText||s.choice?.effectText||''))return 900;
  if(decisionGuidance(card,a.effectText).sendMonster)return (handRemovalOptions(s,side,source)[0]?.score??-100000)-180;
  const cost=Number(text(card).match(/pay (\d+) (?:LP|Life Points)/i)?.[1]||0);
  if(cost>=p.lp&&cost||profile.self>=p.lp)return -100000;
  let utility;
  if(harmful.has(intent))utility=bestTarget(ctx,intent,source)-140;
  else switch(intent){
    case 'winCondition':utility=p.lp>2000?2000:-1000;break;
    case 'battleBanish':{
      const pending=s.pending,attacker=locate(s,pending?.uid),defender=locate(s,pending?.target),enemy=attacker?.controller===side?defender:attacker;
      if(!attacker||!defender||!enemy){utility=-500;break;}
      const outcome=battleOutcome(s,attacker.controller,{...attacker,disabled:true},{...defender,disabled:true}),enemyDying=attacker.controller===side?outcome.enemyLost:outcome.ownLost;
      utility=enemyDying?-500:valueOf(ctx,enemy)-valueOf(ctx,source)*.7;break;
    }
    case 'archfiendSupport':utility=monsters(p).some(c=>/Archfiend/.test(c.card.name))?900:-100;break;
    case 'draw':utility=p.deck.length>2?1500:-2000;break;
    case 'fusionCheat':utility=p.lp>5000&&p.extra.some(c=>attackAllowed(s,side,c))&&canBattle(s)?150:-2500;break;
    case 'fusion':utility=fusionUtility(ctx,card);break;
    case 'tribe':{
      const races=[...new Set(opp.filter(c=>c.faceUp&&!c.hidden).map(c=>c.card.race))];
      utility=Math.max(-1000,...races.map(r=>opp.filter(c=>c.faceUp&&c.card.race===r).reduce((n,c)=>n+valueOf(ctx,c),0)-ours.filter(c=>c.faceUp&&c.card.race===r).reduce((n,c)=>n+valueOf(ctx,c),0)))-150;break;
    }
    case 'debuff':{
      const attacker=locate(s,s.pending?.uid),defender=locate(s,s.pending?.target);
      if(!attacker||!defender){utility=-300;break;}
      const target=attacker.controller===side?defender:attacker;
      const changed={...target,currentStats:{atk:card.name==='Shrink'?Math.floor(attack(target)/2):Math.max(0,attack(target)+(profile.atk||0)),def:defense(target)}};
      const before=battleOutcome(s,attacker.controller,attacker,defender),after=battleOutcome(s,attacker.controller,attacker.uid===target.uid?changed:attacker,defender.uid===target.uid?changed:defender);
      utility=(after.value-before.value)*(attacker.controller===side?1:-1)-200;
      if(attacker.controller!==side&&before.enemyDamage>=p.lp&&after.enemyDamage<p.lp)utility+=100000;
      break;
    }
    case 'search':case 'recover':utility=1000;break;
    case 'revive':utility=s.active!==side&&s.phase!=='end'&&!s.pending?-100:bestTarget(ctx,'revive',source)-250;break;
    case 'control':utility=bestTarget(ctx,'control',source)-100;break;
    case 'swap':utility=opp.length&&ours.length?Math.max(...opp.map(c=>valueOf(ctx,c)))-Math.min(...ours.map(c=>valueOf(ctx,c)))-120:-1000;break;
    case 'exchange':utility=p.hand.length&&foe.hand.length?Math.max(0,...p.hand.filter(c=>c.uid!==a.uid).map(c=>valueOf(ctx,c)))*-.6+180:-500;break;
    case 'wipe':case 'mirror':{
      const victims=intent==='mirror'?opp.filter(c=>c.position==='attack'):opp;
      const gain=victims.reduce((n,c)=>n+valueOf(ctx,c),0),loss=profile.scope==='all'?ours.filter(c=>c.uid!==source.uid).reduce((n,c)=>n+valueOf(ctx,c),0):0;
      utility=gain-loss-200;
      // Clearing the last blockers can be worth a one-for-one to win now.
      if(canBattle(s)&&victims.length&&ours.reduce((n,c)=>n+attack(c),0)>=foe.lp&&loss===0)utility+=5000;
      break;
    }
    case 'hammer':{
      const targets=[...ours,...opp].filter(c=>c.faceUp&&c.position==='attack').sort((a,b)=>attack(b)-attack(a));utility=targets[0]?harmfulValue(ctx,targets[0])-150:-1000;break;
    }
    case 'backrowWipe':case 'backrowBounce':{
      const gain=backrow(foe).reduce((n,c)=>n+valueOf(ctx,c),0),loss=profile.scope==='foe'?0:backrow(p).filter(c=>c.uid!==a.uid).reduce((n,c)=>n+valueOf(ctx,c)*(c.faceUp?1:.8),0);
      utility=gain-loss-200;break;
    }
    case 'boost':case 'equip':utility=Math.max(-1000,...ours.map(c=>boostTargetScore(ctx,c,profile)));break;
    case 'harmfulEquip':utility=bestTarget(ctx,'removal',source)-150;break;
    case 'pierce':utility=canBattle(s)&&opp.some(c=>c.position==='defense')&&ours.some(c=>attack(c)>Math.max(0,...opp.map(defense)))?500:-200;break;
    case 'megamorph':utility=p.lp<foe.lp&&ours.length?650:opp.length&&p.lp>foe.lp?500:-400;break;
    case 'machineBoost':utility=canBattle(s)&&ours.some(c=>c.faceUp&&c.card.race==='Machine')&&opp.length?600:-500;break;
    case 'lily':{
      if(!s.pending||p.lp<=2000){utility=-1000;break;}
      utility=boostTargetScore(ctx,source,{atk:3000})-650;break;
    }
    case 'chaos':{
      if(/attack again|second attack/i.test(a.effectText||'')){utility=canBattle(s)?1200:-300;break;}
      const target=Math.max(0,...opp.map(c=>valueOf(ctx,c))),battle=canBattle(s)?ctx.plan.score:0;
      utility=target-200-(battle>0?Math.min(battle,attack(source)*.38):0);break;
    }
    case 'chaosWipe':utility=aliveCards(foe).length+foe.hand.length>aliveCards(p).length+p.hand.length?1000:-1000;break;
    case 'tributeBurn':{
      const catapult=card.name==='Catapult Turtle',amazon=['Amazon Archer','Amazoness Archer'].includes(card.name),amount=catapult?Math.max(0,...ours.map(attack))/2:amazon?1200:profile.amount||500,weak=Math.min(Infinity,...ours.map(c=>costValue(s,side,c)));
      if(!effectDamage(s,1-side,amount)){utility=-100000;break;}
      const total=catapult?amount:Math.floor(ours.length/(amazon?2:1))*amount;
      utility=foe.lp<=total&&ours.length?100000:amount*.35-weak-100;break;
    }
    case 'tributeBoost':utility=-500;break;
    case 'graveBoost':utility=canBattle(s)&&opp.length&&attack(source)<Math.max(...opp.map(body))?450:-300;break;
    case 'burn':{
      const amount=effectDamage(s,1-side,profile.amount||(card.name==='Just Desserts'?opp.length*500:500));
      if(!amount){utility=-100000;break;}
      utility=foe.lp<=amount?100000:amount*.35-80;break;
    }
    case 'heal':utility=p.lp<2000?600:p.lp<4000?180:-120;break;
    case 'disruptHand':utility=foe.hand.length?850:-500;break;
    case 'handReset':{
      const oursValue=p.hand.filter(c=>c.uid!==a.uid).reduce((n,c)=>n+valueOf(ctx,c),0),newCards=p.hand.length-1;
      utility=newCards*800-oursValue+(foe.hand.length>p.hand.length?200:0)-150;break;
    }
    case 'negate':{
      const link=s.chain.at(-1);if(link?.side===side){utility=-10000;break;}
      if(!link){utility=s.window?.event?.kind==='summon'?800:-400;break;}
      const impact=effectProfile(link.card,link.effectText),costEstimate=card.name==='Solemn Judgment'?p.lp*.5:cost;
      utility=(valuable.has(impact.intent)?1350:600)-costEstimate*.32-valueOf(ctx,source)*.7;
      if(impact.intent==='wipe'||impact.intent==='mirror')utility+=ours.reduce((n,c)=>n+valueOf(ctx,c),0)*.7;
      else if(harmful.has(impact.intent))utility+=Math.max(0,...ours.map(c=>valueOf(ctx,c)))*.5;
      if(p.lp<1500&&impact.intent==='burn')utility+=5000;
      break;
    }
    case 'protect':case 'cylinder':case 'battleHeal':case 'mirrorWall':{
      const attackEvent=s.pending,attacker=locate(s,attackEvent?.uid),defender=locate(s,attackEvent?.target);
      if(attackEvent?.kind!=='attack'||attacker?.controller===side){utility=-1000;break;}
      const o=battleOutcome(s,1-side,attacker,defender),damage=o.enemyDamage;
      const reflected=intent==='cylinder'?effectDamage(s,1-side,attack(attacker)):0;
      utility=intent==='cylinder'?reflected*.5+damage*.6+(o.enemyLost?valueOf(ctx,defender):0)-180:intent==='battleHeal'?attack(attacker)*.25-50:damage*.6+(o.enemyLost?valueOf(ctx,defender):0)-180;
      if(damage>=p.lp)utility+=100000;
      if(intent==='cylinder'&&reflected>=foe.lp)utility+=100000;
      break;
    }
    case 'tokens':utility=incomingDamage(s,side)>=p.lp?100000:!ours.length&&s.active!==side?700:canBattle(s)?-400:!ours.length?100:-400;break;
    case 'stall':{
      const ownStrong=Math.max(0,...ours.map(attack)),enemyStrong=Math.max(0,...opp.map(attack));
      utility=enemyStrong>ownStrong?650:incomingDamage(s,side)>=p.lp?5000:-300;
      if(card.name==='Swords of Revealing Light')utility=opp.length?650:-200;
      if(card.name==='Wall of Revealing Light'&&enemyStrong>Math.floor((p.lp-1)/1000)*1000)utility=-500;break;
    }
    case 'position':utility=Math.max(-1000,...[...ours,...opp].map(c=>targetScore(ctx,{target:c.uid},intent,source)))-180;break;
    case 'field':{
      const match=c=>profile.races?.includes(c.card.race)||profile.attribute===c.card.attribute||profile.defenseOnly;
      utility=(ours.filter(match).length-opp.filter(match).length)*260-(p.field?300:0)-80;break;
    }
    case 'summon':utility=['Polymerization','Fusion Gate'].includes(card.name)?fusionUtility(ctx,card):ours.length>=4?-200:monsters(foe).length||ours.length<2?650:100;break;
    case 'graveRemoval':utility=foe.grave.some(monster)?300:-400;break;
    case 'continuous':utility=zoneOf(s,source.uid)?.zone==='spells'&&source.faceUp?-100:300;break;
    default:{
      // Optional unknown effects are not automatically fired at every phase.
      // Known beneficial triggers still get an opportunity; harmful text uses
      // target ownership and costs rather than indiscriminate activation.
      utility=s.choice?.optionalResponse?100:card.type==='Effect Monster'?-50:card.race==='Continuous'?150:-100;
    }
  }
  if(/discard \d+ card/i.test(text(card))){const costs=p.hand.filter(c=>c.uid!==a.uid);utility-=Math.min(Infinity,...costs.map(c=>costValue(s,side,c)))*.75;}
  if(intent==='backrowRemoval'&&s.active!==side&&s.phase!=='end'&&!backrow(foe).some(c=>c.faceUp))utility=-100;
  if(cost)utility-=cost*.3;
  return utility;
}
function summonScore(ctx,a){
  const c=locate(ctx.s,a.uid);if(!c)return -500;const {s,side,p,foe}=ctx,profile=effectProfile(c.card),level=c.currentLevel||c.card.level||4;
  if(/the Forbidden One|Arm of the Forbidden One|Leg of the Forbidden One/.test(c.card.name))return -10000;
  const required=a.special?0:level>6?2:level>4?1:0;
  const tributes=monsters(p).filter(c=>c.card.name!=='Sheep Token').sort((x,y)=>costValue(s,side,x)-costValue(s,side,y)).slice(0,required);
  const remaining=p.monsters.map(c=>tributes.some(t=>t.uid===c?.uid)?null:c),slot=remaining.indexOf(null);if(slot<0)return -1000;
  const placed={...c,faceUp:!a.set,position:a.set?'defense':'attack',controller:side};remaining[slot]=placed;
  const next=withPlayers(s,side,{monsters:remaining}),costs=tributes.reduce((n,t)=>n+costValue(s,side,t),0);
  const enemyPower=Math.max(1700,...monsters(foe).filter(c=>!c.hidden).map(attack));
  let score=350+(a.set?defense(c):attack(c))*.18-costs*.85;
  if(a.set){
    if(/FLIP:|flipped face-up/i.test(text(c)))score+=500;
    if(defense(c)>=enemyPower)score+=250;else if(defense(c)<attack(c))score-=200;
  }else{
    if(attack(c)>=enemyPower)score+=220;
    if(attack(c)<enemyPower&&defense(c)>attack(c)+400)score-=300;
    if(canBattle(s))score+=(battlePlan(next,side,{available:null}).score-ctx.plan.score)*.6;
    if(['search','removal','backrowRemoval','draw'].includes(profile.intent))score+=200;
    // A modest Tribute upgrade can be the only way through persistent public
    // defenders. Value opening that wall beyond this turn's immediate damage,
    // rather than endlessly replacing small attackers in a recycling matchup.
    if(required&&canBattle(s)){
      const current=Math.max(0,...monsters(p).map(attack));
      const walls=monsters(foe).filter(target=>target.faceUp&&!target.hidden&&!combatTraits(target).indestructible&&(target.position==='defense'?defense(target):attack(target))>=current&&(target.position==='defense'?defense(target):attack(target))<attack(c));
      if(attack(c)>current&&walls.length)score+=Math.min(1500,400+walls.reduce((n,target)=>n+valueOf(ctx,target)*.5,0));
    }
  }
  if(!monsters(p).length)score+=400;
  if(tributes.length&&monsters(p).reduce((n,c)=>n+attack(c),0)>attack(c)&&!monsters(foe).length)score-=800;
  return score;
}
function positionScore(ctx,a){
  const c=locate(ctx.s,a.uid);if(!c)return -200;
  const foeThreat=Math.max(0,...monsters(ctx.foe).filter(c=>!c.hidden).map(attack));
  if(!c.faceUp){
    const profile=effectProfile(c.card);return valuable.has(profile.intent)||harmful.has(profile.intent)?650:canBattle(ctx.s)&&attack(c)>Math.max(0,...monsters(ctx.foe).map(body))?350:-250;
  }
  if(c.position==='attack')return attack(c)<foeThreat&&(!canBattle(ctx.s)||ctx.plan.score<=0)?180+Math.max(0,foeThreat-attack(c))*.3+(defense(c)>=foeThreat?500:0):-300;
  if(!canBattle(ctx.s))return -250;
  const changed={...c,position:'attack'},next=withPlayers(ctx.s,ctx.side,{monsters:ctx.p.monsters.map(x=>x?.uid===c.uid?changed:x)});
  return battlePlan(next,ctx.side).score-ctx.plan.score-100;
}
function makeContext(state,side,actions){
  const s=aiObservation(state,side),p=s.players[side],foe=s.players[1-side];
  s.battleOptions=s.battleOptions.filter(a=>a.battleExitBlocked||!s.declinedAttacks[side].includes(a.uid));
  const available=s.battleOptions.length?s.battleOptions:actions.filter(a=>a.type==='ATTACK'&&(a.battleExitBlocked||!s.declinedAttacks[side].includes(a.uid))).map(a=>({uid:a.uid,canDirect:a.canDirect||a.target===null}));
  const plan=battlePlan(s,side,{available:available.length||s.phase==='battle'&&!s.choice&&!s.window?available:null});
  return {s,side,p,foe,actions,plan,choicePlan:null};
}
function scoreChoice(ctx,a){
  const c=ctx.s.choice||{};const {source,intent}=ctx.selection??=choiceIntent(ctx);
  if(a.reset)return -100000;
  if(c.ordering&&a.target){
    let target=locate(ctx.s,a.target);const revealed=c.ordering.cards?.find(x=>x.uid===a.target)?.card;
    if(target?.hidden&&revealed)target={...target,hidden:false,card:revealed};
    const own=target?.controller===ctx.side,top=c.ordering.kind==='deck-top',bottom=c.ordering.kind==='deck-bottom';
    if(top||bottom)return drawValue(ctx.s,ctx.side,target)*(top===own?1:-1);
  }
  if(c.attackUid){
    if(a.cancel)return c.attackRequired?-Infinity:0;
    if(a.finish)return Infinity;
    if(a.selected)return -100000;
    ctx.choicePlan??=battlePlan(ctx.s,ctx.side,{first:c.attackUid,targets:new Set(ctx.actions.filter(a=>a.target!==undefined).map(a=>a.target))});
    return ctx.choicePlan.roots.get(c.attackUid+':'+(a.target||'direct'))?.score??-10000;
  }
  if(a.finish){
    if(c.attackCostUid&&!(c.selected?.length)){
      const costs=ctx.actions.filter(a=>a.target&&!a.selected).map(a=>costValue(ctx.s,ctx.side,locate(ctx.s,a.target)));
      const gain=Math.max(0,...[...ctx.plan.roots.values()].filter(n=>n.moves[0].uid===c.attackCostUid).map(n=>n.score));
      if(costs.length&&(c.attackRequired||gain>Math.min(...costs)*.9))return -Infinity;
    }
    if(['removal','backrowRemoval','bounce','search','recover','revive','control','graveRemoval'].includes(intent)){
      const useful=ctx.actions.some(x=>x.target&&!x.selected&&targetScore(ctx,x,intent,source)>0);
      if(useful&&(c.selected?.length||0)<(c.max??Infinity))return 0;
    }
    return Infinity;
  }
  if(a.recommended)return 100000;
  if(a.selected)return -100000;
  if(a.cancel)return -3000;
  if(a.yes!==undefined){
    if(c.optionalResponse)return a.yes?scoreEffect(ctx,{...a,uid:c.trigger?.uid,effectCard:source?.card}):0;
    if(/Attack directly/i.test(c.effectText||c.title||'')){
      const attacker=locate(ctx.s,c.trigger?.uid),direct=attacker?battleOutcome(ctx.s,ctx.side,attacker,null):null;
      return a.yes?(direct?.value||0)+100:0;
    }
    if(/Replay this attack/i.test(c.effectText||c.title||''))return a.yes?ctx.plan.score-10:0;
    return a.yes?20:0;
  }
  if(a.defense!==undefined){
    const summoned=c.positionCard||source,threat=Math.max(1700,...monsters(ctx.foe).map(attack));
    const canWin=summoned&&canBattle(ctx.s)&&(!monsters(ctx.foe).length||monsters(ctx.foe).some(enemy=>battleOutcome(ctx.s,ctx.side,summoned,enemy).value>0));
    if(canWin)return a.defense?0:700;
    return a.defense?(summoned&&defense(summoned)>=threat||summoned&&defense(summoned)>attack(summoned)?500:100):(summoned&&attack(summoned)>=threat?600:0);
  }
  if(a.target)return targetScore(ctx,a,intent,source);
  if(a.cardId){
    const known=ctx.foe.hand.find(c=>!c.hidden&&c.card.id===a.cardId);if(known)return 2000+valueOf(ctx,known);
    return ['Monster Reborn','Pot of Greed','Raigeki','Mirror Force'].includes(a.label)?50:0;
  }
  // Typed declaration metadata avoids accidentally treating a number/type as
  // a card target. Legal choices only; no inspection of the opposing Deck.
  if(a.declaration==='race'||a.declaration==='attribute'){
    const key=a.declaration==='race'?'race':'attribute';
    return monsters(ctx.foe).filter(c=>!c.hidden&&String(c.card[key]).replaceAll(/[ -]/g,'_').toUpperCase()===a.label).reduce((n,c)=>n+valueOf(ctx,c),0)-monsters(ctx.p).filter(c=>String(c.card[key]).replaceAll(/[ -]/g,'_').toUpperCase()===a.label).reduce((n,c)=>n+valueOf(ctx,c),0)*.8;
  }
  if(a.number!==undefined){
    const number=Number(a.number);
    if(source?.card.name==='Big Eye')return number;
    if(/Reasoning/.test(source?.card.name||''))return number===4?100:0;
    if(/Wall of Revealing Light/.test(source?.card.name||'')){const threat=Math.max(0,...monsters(ctx.foe).map(attack)),amount=number;return amount>=threat&&amount<ctx.p.lp?500-amount*.01:-amount;}
    return -number*.001;
  }
  if(/Choose an effect option/i.test(c.title||'')){
    const t=a.label||'';if(/destroy|banish|take control/i.test(t))return bestTarget(ctx,'removal',source);if(/draw|add.*hand|Special Summon/i.test(t))return 600;if(/attack again/i.test(t))return ctx.plan.score;
  }
  return 0;
}
export function rankAIActions(state,side=1,{planning=true,weights,learning}={}){
  const actions=state.actions?.[side]||[];if(!actions.length)return [];
  const ctx=makeContext(state,side,actions);
  const score=a=>{
    if(a.type==='PASS')return 0;
    if(a.type==='END')return -10;
    if(a.type==='NEXT')return a.label==='Battle'&&ctx.plan.score>0?80:5;
    if(a.type==='CHOOSE')return scoreChoice(ctx,a);
    if(a.type==='ATTACK'){
      if(!a.battleExitBlocked&&ctx.s.declinedAttacks[side].includes(a.uid))return -100000;
      const entries=[...ctx.plan.roots.values()].filter(n=>n.moves[0].uid===a.uid);
      return entries.length?Math.max(...entries.map(n=>n.score)):-1000;
    }
    if(a.type==='SUMMON')return summonScore(ctx,a);
    if(a.type==='ACTIVATE'||a.type==='EFFECT')return scoreEffect(ctx,a);
    if(a.type==='SET'){
      const c=locate(ctx.s,a.uid);if(!c)return -100;
      // Keep normal Spells in hand; preserve backrow room and don't set a
      // second copy of a persistent card for no reason.
      if(backrow(ctx.p).length>=4)return -40;
      if(c.card.type==='Trap Card')return 170+(valuable.has(effectProfile(c.card).intent)?60:0);
      return c.card.race==='Quick-Play'&&(ctx.s.phase!=='main1'||ctx.s.turn===1)?90:-30;
    }
    if(a.type==='POSITION'||a.type==='FLIP')return positionScore(ctx,a);
    if(a.type==='DISCARD')return -costValue(ctx.s,side,locate(ctx.s,a.uid));
    return -20;
  };
  const ranked=actions.map((action,index)=>({action,index,score:score(action)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  if(planning){
    const plan=planTurn(ctx.s,side,ranked,{weights});
    for(const row of ranked){const projection=plan.roots.get(row.action.id);if(!projection)continue;
      row.projection=projection;row.score=projection.lethal?200000+Math.min(5000,row.score)-projection.steps*20:row.score+Math.max(-1800,Math.min(5000,projection.delta))*.45;
    }
    ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
  }
  // Learned preferences resolve comparable choices. They cannot revive a hard
  // rejection, override a forced completion, or replace an emergency/lethal.
  const top=ranked[0]?.score;
  if(Number.isFinite(top)&&top<10000&&learning?.games>=2){
    for(const row of ranked)if(Number.isFinite(row.score)&&row.score>-5000&&top-row.score<=180){row.baseScore=row.score;row.learnedAdjustment=learningAdjustment(learning,ctx.s,side,row.action);row.score+=row.learnedAdjustment;}
    ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
  }
  return ranked;
}
export function chooseAIAction(state,side=1,options={}){
  const ranked=rankAIActions(state,side,options),top=ranked[0];if(!top)return null;
  // Variety is confined to close, positive, ordinary plays. Required choices,
  // lethal lines, emergency defenses and target/cost selection stay exact.
  if(options.variety===false||state.choice||state.window||top.score>=10000||top.score<=0||!['SUMMON','SET','ACTIVATE','EFFECT','ATTACK'].includes(top.action.type))return top.action;
  const band=Math.min(45,top.score*.035),candidates=ranked.filter(r=>r.score>0&&top.score-r.score<=band&&r.action.type===top.action.type);
  let hash=2166136261;for(const ch of `${state.seed}|${side}|${state.turn}|${state.phase}|${state.serial}`)hash=Math.imul(hash^ch.charCodeAt(0),16777619);
  return candidates[(hash>>>0)%candidates.length].action;
}
