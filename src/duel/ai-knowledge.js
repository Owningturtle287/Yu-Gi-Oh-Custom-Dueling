// Decision hints, never rulings. The native core alone supplies legal actions
// and resolves effects. Unknown text receives a conservative, typed fallback.
import {memoryFor,knownCard} from './ai-memory.js';
import {decisionGuidance,retentionBonus} from './ai-guidance.js';
import {effects} from './catalog.js';
import {currentCardData} from './card-view.js';
export const AI_NAME='Strategic AI';
export const allCards=s=>s.players.flatMap(p=>['hand','deck','monsters','spells','grave','banished','extra'].flatMap(z=>p[z].filter(Boolean)).concat(p.field?[p.field]:[]));
export const locate=(s,uid)=>uid?allCards(s).find(c=>c.uid===uid)||null:null;
export const attack=c=>Math.max(0,c?.currentStats?.atk??c?.card?.atk??0);
export const defense=c=>Math.max(0,c?.currentStats?.def??c?.card?.def??0);
export const monsters=p=>p.monsters.filter(Boolean);
export const backrow=p=>p.spells.filter(Boolean).concat(p.field?[p.field]:[]);
export const text=c=>String(c?.card?.desc??c?.desc??'').replace(/\s+/g,' ');
export const monster=c=>/Monster/.test(c?.card?.type??c?.type??'');
export function zoneOf(s,uid){for(let side=0;side<2;side++)for(const zone of ['hand','deck','monsters','spells','grave','banished','extra','field'])if((zone==='field'?[s.players[side].field]:s.players[side][zone]).some(c=>c?.uid===uid))return {side,zone};return null;}
export function aiObservation(state,side){
  // In particular, query results for a face-down monster must not leak DEF,
  // effects, ID, race, or disabled status into planning. Deck order is unused.
  const known=new Set(state.version===2?[]:state.revealedUIDs||[]);
  const hidden=c=>{const remembered=c&&knownCard(state,side,c.uid);if(remembered)return {...c,card:remembered,known:true,hidden:false,disabled:false,counters:undefined,currentType:undefined,currentLevel:remembered.level,currentRace:remembered.race,currentAttribute:remembered.attribute,currentStats:{atk:Math.max(0,remembered.atk||0),def:Math.max(0,remembered.def||0)}};return c?{uid:c.uid,owner:c.owner,controller:c.controller,faceUp:false,position:c.position,hidden:true,card:{name:'Unknown card',type:'Unknown',atk:0,def:0}}:null;};
  const visible=c=>c?{...c,card:currentCardData(c)}:c;
  const players=state.players.map((p,index)=>({...p,
    deck:index===side?[...p.deck].sort((a,b)=>String(a.card.id).localeCompare(String(b.card.id))):p.deck.map(hidden),
    hand:p.hand.map(c=>index===side||c.public||known.has(c.uid)?visible(c):hidden(c)),
    extra:index===side?p.extra:p.extra.map(c=>c.faceUp?c:hidden(c)),
    monsters:p.monsters.map(c=>!c||index===side||c.faceUp||c.public||known.has(c.uid)?visible(c):hidden(c)),
    spells:p.spells.map(c=>!c||index===side||c.faceUp||c.public||known.has(c.uid)?c:hidden(c)),
    field:!p.field||index===side||p.field.faceUp?p.field:hidden(p.field),
    banished:p.banished.map(c=>index===side||c.faceUp?c:hidden(c))}));
  // Do not retain backups, hidden logs, or the raw state alongside this view.
  return {memory:memoryFor(state,side),perspective:side,version:state.version,seed:state.seed,serial:state.serial,turn:state.turn,phase:state.phase,active:state.active,winner:state.winner,players,chain:state.chain||[],pending:state.pending,choice:state.choice,window:state.window,battleStep:state.battleStep,battleOptions:state.battleOptions||[],normalSummons:state.normalSummons,turnEffects:state.turnEffects||[],attacksUsed:state.attacksUsed||{},declinedAttacks:[0,1].map(index=>index===side?state.declinedAttacks?.[side]||[]:[])};
}
const profiles=new Map();
function define(names,intent,extra={}){for(const name of names.split('|'))profiles.set(name,{intent,...extra});}
define('D.D. Warrior Lady','battleBanish');
define('Final Countdown','winCondition');
define('Pandemonium','archfiendSupport');
define('Raigeki','wipe',{scope:'foe'});define('Dark Hole|Torrential Tribute|Cyber Jar','wipe',{scope:'all'});
define('Mirror Force','mirror');define('Heavy Storm','backrowWipe',{scope:'all'});define("Harpie’s Feather Duster|Harpie's Feather Duster",'backrowWipe',{scope:'foe'});
define('Giant Trunade','backrowBounce');define('Fissure|Smashing Ground','removal',{automatic:true});define('Hammer Shot','hammer');
define('Tribute to the Doomed|Exiled Force|Man-Eater Bug|Newdoria|Sakuretsu Armor|Trap Hole|Bottomless Trap Hole|Nobleman of Crossout|Dark Core|Tribe-Infecting Virus','removal');
define('Mystical Space Typhoon|Dust Tornado|Breaker the Magical Warrior|Armed Ninja|Trap Master|Reaper of the Cards','backrowRemoval');
define('Compulsory Evacuation Device|Hane-Hane|Penguin Soldier','bounce');
define('Snatch Steal|Change of Heart|Relinquished|Thousand-Eyes Restrict','control');define('Creature Swap|Mystic Box','swap');
define('Monster Reborn|Call of the Haunted|Premature Burial|The Shallow Grave','revive');
define('Pot of Greed|Graceful Charity|Upstart Goblin|Jar of Greed','draw');define('Card Destruction|Morphing Jar|Fiber Jar','handReset');
define('Reinforcement of the Army|Sangan|Witch of the Black Forest|Thunder Dragon|Senju of the Thousand Hands|Sonic Bird|Manju of the Ten Thousand Hands','search');
define('Magician of Faith|Mask of Darkness|Sinister Serpent|Night Assailant|Dark Factory of Mass Production','recover');
define('Confiscation|The Forceful Sentry|Delinquent Duo','disruptHand');define('Exchange','exchange');
define('Book of Moon|Tsukuyomi|Enemy Controller|Block Attack|Stop Defense|Book of Taiyou|Bite Shoes','position');
define('Solemn Judgment|Magic Jammer|Seven Tools of the Bandit|Divine Wrath|Magic Drain|Magic Reflector','negate');
define('Negate Attack|Waboku|Kuriboh','protect');define('Magic Cylinder','cylinder');define('Enchanted Javelin','battleHeal');
define('Scapegoat','tokens');define('Rush Recklessly','boost',{atk:700,temporary:true});define('Reinforcements','boost',{atk:500,temporary:true});
define('Castle Walls','boost',{def:500,temporary:true});define('The Reliable Guardian','boost',{def:700,temporary:true});
define('Limiter Removal','machineBoost');define('Mirror Wall','mirrorWall');
define('Axe of Despair','equip',{atk:1000});define('Black Pendant','equip',{atk:500});define('United We Stand','equip',{atk:800,dynamic:'monsters'});define('Mage Power','equip',{atk:500,dynamic:'backrow'});
define('Megamorph','megamorph');define('Fairy Meteor Crush','pierce');
define('Gravity Bind|Level Limit - Area B|Swords of Revealing Light|Wall of Revealing Light|Messenger of Peace','stall');
define('Cannon Soldier|Catapult Turtle|Amazon Archer|Amazoness Archer','tributeBurn',{amount:500});define('Injection Fairy Lily','lily');
define('Polymerization|Fusion Gate|Metamorphosis|Black Luster Ritual|Contract with the Abyss|Advanced Ritual Art|Monster Gate|Reasoning','summon');
define('Soul Release|Kycoo the Ghost Destroyer','graveRemoval');define('Bazoo the Soul-Eater','graveBoost');
define('Black Luster Soldier - Envoy of the Beginning|Chaos Sorcerer','chaos');define('Chaos Emperor Dragon - Envoy of the End','chaosWipe');
define("Robbin' Zombie|Robbin' Goblin|Skull Invitation|Coffin Seller|Wave-Motion Cannon|Solar Flare Dragon|Burning Land|Dark Room of Nightmare",'continuous');
const ops={draw:'draw',upstart:'draw',destroyMonsters:'wipe',storm:'backrowWipe',fissure:'removal',destroy:'backrowRemoval',revive:'revive',control:'control',equip:'equip',field:'field',mirror:'mirror',trapHole:'removal',negateAttack:'protect',waboku:'protect',boost:'boost',negate:'negate',desserts:'burn',gift:'heal',burn:'burn',heal:'heal',continuous:'stall',fusion:'summon',flipDestroy:'removal',bounce:'bounce',recover:'recover',revealDestroy:'backrowRemoval',turnPosition:'position',thunderSearch:'search',tributeBurn:'tributeBurn',tributeBoost:'tributeBoost',coinDestroy:'removal'};
export function effectProfile(card,detail=''){
  card=card?.card||card||{};const guided=decisionGuidance(card,detail);if(guided.intent&&guided.intent!=='position')return {...guided};
  const named=profiles.get(card.name);if(named)return {...named};
  const rule=effects[card.name];if(rule&&ops[rule.op])return {...rule,intent:ops[rule.op]};
  const t=(detail&&!/Choose an effect|Activate this effect|Continue\?/i.test(detail)?detail:card.desc||'').replace(/\s+/g,' ');
  // Prefer the activation's described operation over incidental words in a cost.
  const resolution=t.split(';').at(-1);
  if(/negate (?:the activation|that effect|the effect|it)/i.test(resolution))return {intent:'negate'};
  if(/take control|equip (?:it|that target) to this card/i.test(resolution))return {intent:'control'};
  if(/destroy all monsters/i.test(resolution))return {intent:'wipe',scope:/opponent controls/.test(resolution)?'foe':'all'};
  if(/Special Summon/i.test(resolution))return {intent:/from (?:your|either|the).*?(?:GY|Graveyard)/i.test(resolution)?'revive':'summon'};
  if(/return.*(?:to the hand|to their owners?['’]?s? hands?)/i.test(resolution))return {intent:'bounce'};
  if(/\bdestroy\b|\bbanish\b.*(?:target|monster|card)/i.test(resolution))return {intent:card.race==='Equip'?'harmfulEquip':'removal'};
  if(/draw \d+ cards?/i.test(resolution))return {intent:'draw'};
  if(/add.*(?:hand|Deck)|return.*(?:GY|Graveyard).*hand/i.test(resolution))return {intent:'search'};
  const damage=resolution.match(/(?:inflict|take|gains?) (\d+) (?:damage|LP|Life Points)/i);
  if(damage)return {intent:/inflict/.test(damage[0])?'burn':'heal',amount:Number(damage[1])};
  if(card.race==='Equip')return {intent:/loses|decrease/i.test(resolution)?'harmfulEquip':'equip',atk:Number(resolution.match(/(?:gains?|increase\S*) (\d+) ATK/i)?.[1]||300)};
  if(card.race==='Field')return {intent:'field'};
  if(/gains? (\d+) ATK/i.test(resolution))return {intent:'boost',atk:Number(resolution.match(/gains? (\d+) ATK/i)[1])};
  if(/gains? (\d+) DEF/i.test(resolution))return {intent:'boost',def:Number(resolution.match(/gains? (\d+) DEF/i)[1])};
  return {intent:'unknown'};
}
export function combatTraits(card){
  if(!card||card.disabled||card.hidden)return {};
  const name=card.card.name,t=text(card);
  return {indestructible:['Spirit Reaper','Marshmallon'].includes(name)||/cannot be destroyed by battle[.!]/i.test(t),
    revenge:['Yomi Ship','Newdoria','D.D. Warrior Lady','D.D. Warrior'].includes(name),
    reflect:name==='Reflect Bounder'&&card.position==='attack',bounce:name==='Wall of Illusion',
    pierce:/piercing battle damage|difference as Battle Damage/.test(t),
    halfDamage:name==='Shadowknight Archfiend',direct:!!effects[name]?.direct,
    attacks:effects[name]?.attacks||1};
}
export function resourceValue(state,side,card){
  if(!card)return 0;if(card.hidden)return 800;
  const zone=zoneOf(state,card.uid)?.zone,p=state.players[side],foe=state.players[1-side],profile=effectProfile(card.card);
  let value=monster(card)?450+Math.max(attack(card),defense(card)*.85)*.34:650;
  if(monster(card)&&card.card.type!=='Normal Monster')value+=170;
  if(/(?:the Forbidden One|Arm of the Forbidden One|Leg of the Forbidden One)/.test(card.card.name))value+=4500;
  if(/Sangan|Witch of the Black Forest/.test(card.card.name))value+=120;
  if(combatTraits(card).indestructible)value+=280;
  if(profile.intent==='draw')value+=600;
  if(['wipe','mirror','negate','revive','control'].includes(profile.intent))value+=320;
  if(profile.intent==='removal'||profile.intent==='backrowRemoval')value+=100;
  if(zone==='hand'&&monster(card)&&card.card.level>4){value-=250;if(!monsters(p).length)value-=180;}
  if(zone==='hand'&&/Ritual|Fusion/.test(card.card.type))value-=300;
  if(zone==='hand'&&monster(card)&&card.card.level<=4&&!monsters(p).length)value+=220;
  if(profile.intent==='heal'&&p.lp>5000)value-=300;
  if(profile.intent==='burn'&&foe.lp<=(profile.amount||500))value+=2000;
  if(card.card.type==='Token')value*=.25;
  if(card.owner!==side&&card.controller===side)value*=.7; // borrowed monsters make good costs
  return Math.max(80,value);
}
export function costValue(state,side,card){
  const zone=zoneOf(state,card.uid)?.zone;
  let value=resourceValue(state,side,card);
  if(card.controller!==side&&['monsters','spells','field'].includes(zone))return -value;
  if(['grave','banished','deck'].includes(zone))value*=.28;
  const graveEnabled=!state.players.some(p=>p.monsters.some(c=>c?.faceUp&&!c.disabled&&c.card.name==='Banisher of the Light'));
  if(['Sangan','Witch of the Black Forest','Night Assailant','Sinister Serpent'].includes(card.card.name)&&!card.disabled&&graveEnabled)value*=.35;
  value+=retentionBonus(state,side,card);
  const copies=state.players[side].hand.filter(c=>c.card.id===card.card.id).length;if(copies>1)value*=.8;
  return value;
}
