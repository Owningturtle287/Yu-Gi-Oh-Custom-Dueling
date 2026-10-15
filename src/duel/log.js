const battleKinds = new Set(['attack', 'battle', 'damage', 'heal', 'victory']);
export function groupedLog(entries, filter = 'all') {
  const groups = [];
  for (const entry of entries) {
    if (filter === 'battle' && !battleKinds.has(entry.kind)) continue;
    if (filter === 'cards' && ['phase', 'damage', 'heal'].includes(entry.kind)) continue;
    const turn = entry.turn || 1;
    let group = groups.at(-1);
    if (!group || group.turn !== turn) { group = { turn, entries: [] }; groups.push(group); }
    group.entries.push(entry);
  }
  return groups;
}
export const logKindLabel = kind => ({phase:'Phase',draw:'Draw',summon:'Summon / Set',set:'Set',activate:'Activation',effect:'Effect',cost:'Cost paid',target:'Target chosen',response:'Response',attack:'Attack',battle:'Battle result',damage:'LP loss',heal:'LP gain',leave:'Card moved',position:'Position',discard:'Discard',reveal:'Reveal',victory:'Result'}[kind] || 'Action');
