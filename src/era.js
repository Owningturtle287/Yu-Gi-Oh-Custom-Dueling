export const MIN_RELEASE_YEAR = 2002;
export const SUBTYPES = ['Spirit', 'Flip', 'Gemini', 'Ritual', 'Toon', 'Tuner', 'Union'];
export const currentYear = (now = new Date()) => now.getFullYear();
export function normalizeReleaseYear(value, now = new Date()) {
  if (value === null || value === undefined || value === '' || value === 'current') return null;
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < MIN_RELEASE_YEAR || year > currentYear(now)) throw new Error(`Choose a release year from ${MIN_RELEASE_YEAR} to ${currentYear(now)}.`);
  return year;
}
export function releaseCutoff(year = null, now = new Date()) {
  const selected = normalizeReleaseYear(year, now) ?? currentYear(now);
  // The current card pool includes releases to date, rather than scheduled future cards.
  return selected === currentYear(now) ? `${selected}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` : `${selected}-12-31`;
}
export function validReleaseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
export function cardReleaseDate(card) {
  const misc = Array.isArray(card.misc_info) ? card.misc_info.find(info => info && info.tcg_date) : null;
  return validReleaseDate(card.tcgDate) || validReleaseDate(misc?.tcg_date);
}
export function availableBy(card, cutoff) {
  const date = card.tcgDate;
  return typeof date === 'string' && date <= cutoff;
}
export function hydrateDeckDates(deck, index) {
  return { ...deck, sections: Object.fromEntries(Object.entries(deck.sections).map(([section, entries]) => [section, entries.map(entry => {
    const current = index.get(entry.card.id);
    return current ? { ...entry, card: { ...entry.card, tcgDate: current.tcgDate } } : entry;
  })])) };
}
// Context comes from the same dated archive as the filter, not a speculative timeline.
export function buildYearHighlights(cards) {
  const groups = new Map(), archetypes = new Map(), counts = new Map();
  const today = releaseCutoff();
  const features = ['Fusion', 'Synchro', 'Xyz', 'Pendulum', 'Link', ...SUBTYPES];
  for (const card of cards) {
    if (!card.tcgDate || card.tcgDate > today || card.name === '???' || /Token|Skill Card/.test(card.type)) continue;
    const year = Math.max(MIN_RELEASE_YEAR, Number(card.tcgDate.slice(0, 4)));
    counts.set(year, (counts.get(year) || 0) + 1);
    if (card.type.includes('Monster')) {
      const labels = features.filter(feature => card.type.toLowerCase().includes(feature.toLowerCase())).map(feature => `${feature} monsters`);
      if (card.race) labels.push(`${card.race} type`);
      for (const label of labels) groups.set(label, Math.min(groups.get(label) ?? Infinity, year));
    }
    if (card.archetype) {
      const group = archetypes.get(card.archetype) || { first: year, byYear: new Map() };
      group.first = Math.min(group.first, year);
      group.byYear.set(year, (group.byYear.get(year) || 0) + 1);
      archetypes.set(card.archetype, group);
    }
  }
  const result = new Map();
  for (let year = MIN_RELEASE_YEAR; year <= currentYear(); year++) {
    const introduced = [...groups].filter(([, first]) => first === year).map(([label]) => label);
    const newArchetypes = [...archetypes].filter(([, value]) => value.first === year).sort((a, b) => (b[1].byYear.get(year) || 0) - (a[1].byYear.get(year) || 0) || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name);
    result.set(year, { introduced: introduced.slice(0, 3), archetypes: newArchetypes, newCards: counts.get(year) || 0 });
  }
  return result;
}
