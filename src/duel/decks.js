import { createDeck, addCard, normalizeCard, cardCopyName } from '../core.js';
import { ERA_END, support, supportedPool, isMonster } from './catalog.js';

export const defaultSide = () => ({ source: 'cards', deckId: '', cutoff: ERA_END, race: '', attribute: '', subtype: '', spells: true, traps: true, set: '' });
export function poolFor(cards, settings) {
  const cutoff = /^\d{4}-\d\d-\d\d$/.test(settings.cutoff || '') && settings.cutoff <= ERA_END ? settings.cutoff : ERA_END;
  return supportedPool(cards).filter(card => card.tcgDate <= cutoff && (!isMonster(card) || ((!settings.race || card.race === settings.race) && (!settings.attribute || card.attribute === settings.attribute) && (!settings.subtype || card.type.includes(settings.subtype)))) && (settings.spells || card.type !== 'Spell Card') && (settings.traps || card.type !== 'Trap Card'));
}
export function validateDuelDeck(deck, cards, settings = defaultSide()) {
  if (!deck?.sections) return ['Choose a saved deck or create one.'];
  const issues = [], index = new Map(cards.map(c => [c.id, c])), allowed = new Set(poolFor(cards, settings).map(c => c.id));
  const total = deck.sections.main.reduce((n, e) => n + e.quantity, 0);
  if (total < 40 || total > 60) issues.push(`Main Deck needs 40–60 cards (currently ${total}).`);
  const copies = new Map();
  for (const [section, entries] of Object.entries(deck.sections)) {
    for (const entry of entries) {
      const name = cardCopyName(index.get(entry.card.id) || entry.card), quantity = entry.quantity;
      copies.set(name, (copies.get(name) || 0) + quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || copies.get(name) > 3) issues.push(`${name}: maximum 3 copies across Main, Extra and Side, including same-name variants.`);
    }
    if (section === 'side') continue; // Side Deck is never loaded into a single game.
    if (section === 'extra' && entries.reduce((n,e) => n+e.quantity,0)>15) issues.push('Extra Deck exceeds 15 cards.');
    for (const entry of entries) {
      const card = index.get(entry.card.id);
      if (!card || !support(card).ok) issues.push(`${entry.card.name}: ${card ? support(card).reason : 'not in the loaded archive'}.`);
      else if (!allowed.has(card.id)) issues.push(`${card.name}: excluded by this duelist’s filters.`);
      if (card && (card.type.includes('Fusion') !== (section === 'extra'))) issues.push(`${card.name}: wrong deck section.`);
    }
  }
  return [...new Set(issues)];
}
export function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
export function generationProblem(pool) {
  const main = pool.filter(c => !c.type.includes('Fusion'));
  const low = main.filter(c => isMonster(c) && c.level <= 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||''));
  if (new Set(main.map(cardCopyName)).size * 3 < 40) return 'These filters leave fewer than 40 available card copies. Broaden them or choose another set.';
  if (new Set(low.map(cardCopyName)).size * 3 < 16) return 'These filters need at least 16 copies of Level 4 or lower monsters for a playable random deck.';
  return '';
}
export function eligibleSets(cards, sets, settings) {
  const pool = poolFor(cards, settings);
  return sets.filter(set => set.date && set.date <= (settings.cutoff || ERA_END)).map(set => {
    const remaining = pool.filter(card => card.setNames?.includes(set.name));
    return { ...set, remaining, problem: generationProblem(remaining) };
  }).filter(set => set.remaining.length).sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
export function generateDeck(cards, settings = defaultSide(), sets = [], seed = Date.now()) {
  const random = seededRandom(seed);
  let pool = poolFor(cards, settings), label = 'Random cards';
  if (settings.source === 'set') {
    const available = eligibleSets(cards, sets, settings).filter(set => !set.problem && (!settings.set || settings.set === set.name));
    if (!available.length) throw new Error('No released set has enough supported cards under these filters. Choose another set or broaden the filters.');
    const set = available[Math.floor(random() * available.length)];
    pool = set.remaining; label = set.name;
  }
  const problem = generationProblem(pool);
  if (problem) throw new Error(problem);
  let deck = createDeck(label.slice(0,60)); deck.releaseYear = Number(settings.cutoff.slice(0,4));
  const low = pool.filter(c => isMonster(c) && c.level <= 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||'') && !c.type.includes('Fusion'));
  const high = pool.filter(c => isMonster(c) && c.level > 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||'') && !c.type.includes('Fusion'));
  // Weighted sampling with a strict copy cap; no rejected filter is relaxed.
  const choose = list => {
    const copies = new Map();
    for (const entry of deck.sections.main) { const name=cardCopyName(entry.card); copies.set(name,(copies.get(name)||0)+entry.quantity); }
    const candidates = list.filter(card => (copies.get(cardCopyName(card)) || 0) < 3);
    if (!candidates.length) return false;
    const ranked = candidates.map(card => ({ card, weight: isMonster(card) ? 1 + Math.max(card.atk,card.def)/1800 : 2 }));
    let pick = random() * ranked.reduce((n,e) => n+e.weight,0);
    const card = (ranked.find(e => (pick -= e.weight) <= 0) || ranked.at(-1)).card;
    deck = addCard(deck, card); return true;
  };
  for (let n=0;n<20;n++) if (!choose(low)) break;
  for (let n=0;n<4;n++) if (!choose(high)) break;
  const main = pool.filter(c => !c.type.includes('Fusion') && c.name !== 'Polymerization');
  while (deck.sections.main.reduce((n,e) => n+e.quantity,0)<40) {
    if (!choose(main) && !choose(pool.filter(c => !c.type.includes('Fusion')))) throw new Error('Not enough card copies.');
  }
  // Add only Fusions whose exact materials actually exist in this deck.
  const names = new Set(deck.sections.main.map(e => e.card.name));
  const fusions = pool.filter(c => c.type === 'Fusion Monster' && support(c).rule.materials?.length && support(c).rule.materials.every(name => names.has(name))).slice(0,15);
  for (const card of fusions) deck = addCard(deck,card,'extra');
  const polymer = pool.find(c => c.name === 'Polymerization');
  if (fusions.length && polymer) {
    const replace = deck.sections.main.find(e => !isMonster(e.card)) || deck.sections.main.at(-1);
    if (--replace.quantity === 0) deck.sections.main = deck.sections.main.filter(e => e !== replace);
    deck = addCard(deck,polymer);
  }
  return deck;
}
export function expandDeck(deck, cards) {
  const index = new Map(cards.map(c => [c.id,c]));
  return Object.fromEntries(['main','extra'].map(section => [section, deck.sections[section].flatMap(entry => Array.from({length:entry.quantity},()=> normalizeCard(index.get(entry.card.id) || entry.card)))]));
}

export async function loadSets({ fetchImpl = fetch, storage = globalThis.localStorage, now = Date.now(), force = false } = {}) {
  // A previous era's otherwise-fresh cache must not hide newly unlocked sets.
  const key = `duel-atlas.sets.v3.${ERA_END}`; let cached;
  try { cached = JSON.parse(storage?.getItem(key) || 'null'); } catch { /* optional cache */ }
  const valid = value => Array.isArray(value) && value.every(set => typeof set.name === 'string' && /^\d{4}-\d\d-\d\d$/.test(set.date));
  if (!force && cached && valid(cached.sets) && now-cached.time<86400000) return {sets:cached.sets,offline:false};
  try {
    const response = await fetchImpl('https://db.ygoprodeck.com/api/v7/cardsets.php', {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('Set request failed.');
    const raw = await response.json(); if (!Array.isArray(raw)) throw new Error('Invalid set list.');
    const sets = raw.filter(set => /^\d{4}-\d\d-\d\d$/.test(set.tcg_date || '') && set.tcg_date<=ERA_END).map(set => ({name:set.set_name,date:set.tcg_date}));
    if (!valid(sets) || !sets.length) throw new Error('No dated sets returned.');
    try { storage?.setItem(key,JSON.stringify({sets,time:now})); } catch { /* session still works */ }
    return {sets,offline:false};
  } catch (error) {
    if (cached && valid(cached.sets) && cached.sets.length) return {sets:cached.sets,offline:true};
    throw new Error('Set dates could not load. Retry, or use Random cards / Saved deck.', {cause:error});
  }
}
