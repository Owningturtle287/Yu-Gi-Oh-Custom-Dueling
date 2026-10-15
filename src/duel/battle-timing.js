import { findCard } from './engine.js';

// Presentation of the pinned core's HINT_EVENT 40–44 checkpoints. These labels
// never create response windows or decide which effects are legal.
export const CORE_BATTLE_HINTS={40:'start',41:'beforeCalculation',42:'calculation',43:'afterCalculation',44:'end'};
export const BATTLE_STEPS={
  attack:{label:'Attack declaration',short:'Attack',text:'The attack is declared. Responses here happen before the Damage Step.'},
  start:{label:'Start of Damage Step',short:'Damage start',text:'The Damage Step begins. A face-down defender has not been revealed yet.'},
  beforeCalculation:{label:'Before damage calculation',short:'Before calc',text:'Eligible ATK/DEF-changing effects can resolve now, before damage is calculated.'},
  calculation:{label:'Damage calculation',short:'Calculate',text:'Only effects specifically legal during damage calculation can activate now.'},
  afterCalculation:{label:'After damage calculation',short:'After calc',text:'Battle damage has been calculated. Flip effects and other eligible battle triggers resolve now.'},
  end:{label:'End of Damage Step',short:'Damage end',text:'Battle-destroyed monsters go to the Graveyard, then eligible destruction and end-of-Damage-Step effects resolve.'}
};

export function battleContext(state){
  const step=BATTLE_STEPS[state.battleStep];if(!step)return '';
  const defender=findCard(state,state.pending?.target);
  if(state.battleStep==='beforeCalculation'&&defender?.faceUp)return `${defender.card.name} is face-up. ${step.text}`;
  if(state.battleStep==='attack'&&defender&&!defender.faceUp)return `${step.text} The face-down defender is still hidden.`;
  return step.text;
}

// Small AI/advice hints, not an effect implementation. Legal targets and all
// stat changes still come from the core and its card scripts.
export const COMBAT_BOOSTS={
  'Castle Walls':{def:500},'The Reliable Guardian':{def:700},
  'Reinforcements':{atk:500},'Rush Recklessly':{atk:700}
};
export function combatBoostTarget(state,side,boost){
  const attack=state.pending;if(attack?.kind!=='attack')return null;
  const attacker=findCard(state,attack.uid),defender=findCard(state,attack.target);
  const candidate=boost.atk?(attacker?.controller===side?attacker:defender):defender;
  return candidate?.controller===side&&candidate.faceUp&&(boost.atk?candidate.position==='attack':candidate.position==='defense')?candidate:null;
}
export function responseAdvice(state,card){
  const defender=findCard(state,state.pending?.target);
  return COMBAT_BOOSTS[card.name]?.def&&['attack','start'].includes(state.battleStep)&&defender?.controller===0&&!defender.faceUp
    ?'To boost the face-down defender, pass once and wait for it to be revealed before damage calculation.' : '';
}
