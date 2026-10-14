export const AI_SPEEDS = {
  fast: { label: 'Fast', delay: 180 },
  normal: { label: 'Normal', delay: 700 },
  relaxed: { label: 'Relaxed', delay: 1500 },
  deliberate: { label: 'Deliberate', delay: 2500 }
};
export const decisionDelay = speed => (AI_SPEEDS[speed] || AI_SPEEDS.normal).delay;

// Draws happen once in the engine when a turn begins. The controller advances
// the two opening phases without drawing again or bypassing a real response.
export function automaticOpeningAction(state, openingTurn) {
  if (state.winner !== null || state.active !== 0 || state.turn !== openingTurn || state.choice) return null;
  if (state.window) {
    return state.window.priority === 0 && state.window.event.kind === 'phase' && !state.chain.length
      && ['standby', 'main1'].includes(state.phase) ? { type: 'PASS' } : null;
  }
  return ['draw', 'standby'].includes(state.phase) ? { type: 'NEXT' } : null;
}
