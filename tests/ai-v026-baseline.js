// Frozen v0.2.6 hard policy, used only for paired strength benchmarks.
import {legalActions,findCard,stats} from '../src/duel/native-engine.js';
import {COMBAT_BOOSTS,combatBoostTarget} from '../src/duel/battle-timing.js';
// Scoring only uses the AI's cards, public field information, and choices the
// rules engine explicitly reveals. Hidden opposing stats never affect it.
export function baselineAI(state,side=1){
  const actions=legalActions(state,side);if(!actions.length)return null;
  const strength=card=>!card?0:card.controller!==side&&!card.faceUp?1500:stats(state,card)[card.position==='defense'?'def':'atk'];
  const p=state.players[side],foe=state.players[1-side];
  const score=a=>{
    const card=findCard(state,a.uid),target=findCard(state,a.target),own=target?.controller===side;
    if(a.reset)return -500;if(a.finish)return 1000;if(a.recommended)return 800;if(a.cancel)return -100;
    if(a.selected)return -50;
    if(a.type==='PASS')return -5;
    if(a.type==='NEXT')return 0;if(a.type==='END')return -2;
    if(a.type==='SUMMON')return 20+(a.set?card?.card.def||0:card?.card.atk||0)/200+(a.special?8:0);
    if(a.type==='ATTACK'){const atk=stats(state,card).atk;return a.target===null?30+atk/100:10;}
    if(a.type==='ACTIVATE'||a.type==='EFFECT'){
      const boost=COMBAT_BOOSTS[card?.card.name];
      if(boost)return combatBoostTarget(state,side,boost)?30:-30;
      return 12;
    }
    if(a.type==='SET')return card?.card.type==='Trap Card'?10:2;
    if(a.type==='POSITION')return card?.position==='defense'&&stats(state,card).atk>=Math.max(0,...foe.monsters.filter(Boolean).map(strength))?10:-10;
    if(a.yes!==undefined)return a.yes?10:0;
    if(a.defense!==undefined)return a.defense&&Math.max(0,...foe.monsters.filter(Boolean).map(strength))>Math.max(0,...p.monsters.filter(Boolean).map(strength))?10:5;
    if(a.type==='CHOOSE'){
      if(!target)return 1;
      const name=state.choice?.title?.toLowerCase()||'';
      if(/discard|tribute|release|ritual|fusion|cost/.test(name))return 20-strength(target)/200;
      const source=findCard(state,state.choice?.trigger?.uid),boost=COMBAT_BOOSTS[source?.card.name];
      if(boost){const beneficiary=combatBoostTarget(state,side,boost);return target.uid===beneficiary?.uid?100:own?10:-100;}
      if(/special|grave|recover|add to hand/.test(name))return 10+strength(target)/200;
      return (own?-10:10)+strength(target)/200;
    }
    return 1;
  };
  let seed=(state.seed+Number.parseInt(actions[0].id)*17+state.serial*7919+(state.actions?.[side]?.[0]?.id?.length||0)*13)>>>0;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const variation=0;
  return actions.map((action,index)=>({action,index,score:score(action)+noise()*variation})).sort((a,b)=>b.score-a.score||a.index-b.index)[0].action;
}
