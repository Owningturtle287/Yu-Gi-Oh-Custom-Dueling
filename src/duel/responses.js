import { PHASE_LABELS, findCard } from './engine.js';
import { BATTLE_STEPS } from './battle-timing.js';

// Quote the card's current text rather than inventing a ruling or promising an
// outcome. The native engine remains the authority on timing and resolution.
export function effectBrief(card, detail = '', limit = 220) {
  const text = (detail && !/Choose an effect option|Activate this effect\?|Continue\?/i.test(detail) ? detail : card?.desc || '')
    .replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const boundary = text.lastIndexOf(' ', limit - 1);
  return text.slice(0, boundary > limit / 2 ? boundary : limit - 1) + '…';
}

export function responseOffer(state, actions) {
  const optionalTrigger = state.choice?.side === 0 && state.choice.optionalResponse;
  if (state.window?.priority !== 0 && !optionalTrigger) return null;
  const options = optionalTrigger ? actions.filter(a => a.yes === true) : actions.filter(a => ['ACTIVATE', 'EFFECT'].includes(a.type));
  const cards = options.map(action => {
    const found=findCard(state,action.uid||state.choice?.trigger?.uid),official=action.effectCard;
    // A core source descriptor takes precedence over a stale/mismatched UID.
    const card=official&&found?.card.name!==official.name?{uid:null,controller:0,card:official,public:true}:found;
    return {action,card};
  }).filter(item => item.card);
  if (!cards.length) return null;
  const pass = actions.find(a => a.type === 'PASS' || optionalTrigger && a.yes === false);
  const link = state.chain.at(-1), attacker = state.pending?.kind === 'attack' ? findCard(state, state.pending.uid) : null;
  const context = state.window?.forced&&cards.length>1 ? 'Choose the next required effect to process. Required effects cannot be skipped. Effects that form a chain resolve from the last link to the first.'
    : optionalTrigger ? 'This card has an optional triggered effect. You can activate it now or decline.'
    : link ? `${link.card.name} was activated. Your response is added to the chain and resolves before earlier links.`
    : state.window?.timing || (attacker ? `${attacker.card.name} declared an attack. You can respond before the attack continues.`
    : `You have a legal response during ${PHASE_LABELS[state.phase] || state.phase}.`);
  return {id: state.choice?.promptId || state.window?.promptId || `${state.turn}:${state.phase}:${actions.map(a => a.id).join(',')}`,
    cards, pass, context, required: !pass, phase: BATTLE_STEPS[state.window?.battleStep||state.battleStep]?.label || PHASE_LABELS[state.phase] || state.phase};
}

// Repeating Pass is safe; repeating activations could pay a new cost or choose
// a different target. Never apply this preference to mandatory/procedural choices.
export function createResponsePolicy() {
  let key = null, passing = false;
  const sync = state => { const next = `${state.runtimeId || state.seed}:${state.turn}`; if (key !== next) {key = next; passing = false;} };
  return {
    isPassing(state) {sync(state); return passing;},
    passTurn(state) {sync(state); passing = true;},
    askAgain() {passing = false;},
    action(state, actions) {
      sync(state);
      // Only the core's legal decline action is repeated. This includes optional
      // attack/chain/trigger windows, never committed costs, targets or options.
      return passing&&!state.choice?.phaseTrigger&&!state.window?.phaseTrigger?responseOffer(state, actions)?.pass||null:null;
    }
  };
}
