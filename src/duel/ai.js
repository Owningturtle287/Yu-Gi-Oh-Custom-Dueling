import { legalActions, observation, findCard, stats } from './engine.js';
import { ruleFor, isMonster, isTrap } from './catalog.js';
import { seededRandom } from './decks.js';

// Difficulty changes risk and action scoring, never starting cards or hidden access.
export function chooseAIAction(state, side=1, difficulty='normal') {
  const actions=legalActions(state,side);if(!actions.length)return null;
  const view=observation(state,side),player=view.players[side],foe=view.players[1-side];
  const random=seededRandom(state.seed+state.serial*7919+side*13);
  const strength=card=>card?(card.faceUp===false?1500:stats(view,card)[card.position==='defense'?'def':'atk']):0;
  const score=action=>{
    const card=findCard(view,action.uid),target=findCard(view,action.target),rule=ruleFor(card?.card),ownTarget=target&&(target.controller??target.owner)===side;
    switch(action.type){
      case 'PASS':return 0;
      case 'NEXT':return 1;
      case 'END':return -25;
      case 'DISCARD':return 3000-(card?.card.atk||0)-(isMonster(card?.card)?200:400);
      case 'CHOOSE':{
        const op=view.choice.trigger.rule.op;
        if(op==='recover')return (target?.card.atk||0)/100+10;
        if(op==='turnPosition')return ownTarget?0:strength(target)/100;
        return (ownTarget?-60:20)+strength(target)/100;
      }
      case 'SUMMON':{
        const tributeCost=action.tributes.reduce((n,uid)=>n+strength(findCard(view,uid)),0);
        const atk=card.card.atk||0,def=card.card.def||0,flip=rule.flip;
        const set=action.set;
        if(action.tributes.length&&atk<tributeCost-400)return -5;
        const threat=Math.max(0,...foe.monsters.filter(Boolean).map(strength));
        return 12+(set?def:atk)/220-tributeCost/350+(set&&flip?9:0)+(set&&def>atk+400?3:0)+(!set&&atk>threat?5:0)-(set&&!flip&&atk>def?8:0);
      }
      case 'SET':return isTrap(card.card)?8:player.spells.filter(Boolean).length<3?1.5:-5;
      case 'FLIP':return 9+(rule.flip?12:0);
      case 'POSITION':{
        const threat=Math.max(0,...foe.monsters.filter(Boolean).map(strength));
        if(card.position==='defense')return stats(view,card).atk>=threat?10:card.card.atk>card.card.def+500?3:-3;
        return stats(view,card).atk<threat&&stats(view,card).def>stats(view,card).atk?5:-4;
      }
      case 'ATTACK':{
        const atk=stats(view,card).atk;
        if(!target)return 12+atk/150;
        const value=strength(target),difference=atk-value;
        return difference>0?15+difference/150+value/600:difference===0?(target.position==='attack'?3:-4):difficulty==='easy'?2:-15+difference/100;
      }
      case 'EFFECT':
        if(rule.op==='thunderSearch')return 10+action.count;
        if(rule.op==='coinDestroy')return 16+strength(target)/300;
        if(rule.op==='tributeBurn')return foe.lp<=(rule.amount||strength(findCard(view,action.tribute))/2)?100:-(strength(findCard(view,action.tribute))/200)+2;
        if(rule.op==='tributeBoost')return -4;
        return 5;
      case 'ACTIVATE':{
        const enemyCount=foe.monsters.filter(Boolean).length,ownCount=player.monsters.filter(Boolean).length;
        switch(rule.op){
          case 'draw':case 'upstart':return 28;
          case 'burn':return foe.lp<=rule.amount?150:12;
          case 'heal':return player.lp<3000?15:4;
          case 'destroyMonsters':return rule.scope==='foe'?enemyCount*14-1:(enemyCount-ownCount)*16-2;
          case 'fissure':return 15+strength(target)/250;
          case 'storm':return (foe.spells.filter(Boolean).length-player.spells.filter(c=>c?.faceUp).length)*8-3;
          case 'destroy':return target?(ownTarget?-40:target.faceUp?12:4):-3;
          case 'control':return 18+strength(target)/150;
          case 'revive':return 10+strength(target)/150;
          case 'equip':return ownTarget?5+(target?.card.atk||0)/350:-15;
          case 'field':{
            const cards=player.monsters.filter(c=>c?.faceUp),matches=c=>rule.races?.includes(c.card.race)||rule.attribute===c.card.attribute||rule.defenseOnly;
            return cards.some(matches)?6:player.field?-5:1.2;
          }
          case 'fusion':return 25;
          case 'position':return !ownTarget?5:-10;
          case 'mirror':return enemyCount?40: -5;
          case 'trapHole':return 32;
          case 'negateAttack':return view.pending?.target&&strength(findCard(view,view.pending.target))>=strength(findCard(view,view.pending.uid))?-4:25;
          case 'waboku':return view.pending?.kind==='attack'&&view.pending.side!==side?18:-5;
          case 'boost':{
            const attack=view.pending?.kind==='attack'?view.pending:null;
            if(!attack||!ownTarget)return -4;
            const relevant=[attack.uid,attack.target].includes(action.target);return relevant?14:-4;
          }
          case 'negate':{
            const last=view.chain.at(-1);if(!last)return 22;
            const impact=['destroyMonsters','control','revive','fusion','mirror','negate'].includes(last.rule.op)?25:8;
            return impact-(rule.half&&player.lp<2000?10:0);
          }
          case 'desserts':return enemyCount*3-1;
          case 'gift':return (enemyCount+ownCount)*2-1;
          case 'continuous':return Math.max(0,...foe.monsters.filter(Boolean).map(strength))>Math.max(0,...player.monsters.filter(Boolean).map(strength))?8:-3;
          default:return 3;
        }
      }
      default:return -10;
    }
  };
  const variance=difficulty==='easy'?22:difficulty==='hard'?0:3;
  return actions.map((action,index)=>({action,index,value:score(action)+random()*variance})).sort((a,b)=>b.value-a.value||a.index-b.index)[0].action;
}
