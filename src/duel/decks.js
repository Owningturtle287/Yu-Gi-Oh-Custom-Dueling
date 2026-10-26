import { createDeck, addCard, normalizeCard, cardCopyName } from '../core.js';
import { ERA_END, support, supportedPool, isMonster } from './catalog.js';
import {matchesMonsterFilters,matchesSpellTrapType} from '../card-filters.js';
import {validReleaseDate} from '../era.js';
import {freshSeed,seededRandom,shuffled} from './random.js';
export {seededRandom} from './random.js';
export const deckSize=value=>Number.isInteger(Number(value))&&Number(value)>=30&&Number(value)<=60?Number(value):40;

export const defaultSide = () => ({ source: 'cards', deckId: '', cutoff: ERA_END, race: '', attribute: '', subtype: '', mechanic:'', spellTrapType:'', spells: true, traps: true, set: '', size:40, supplement:false });
export function poolFor(cards, settings) {
  const cutoff = /^\d{4}-\d\d-\d\d$/.test(settings.cutoff || '') && settings.cutoff <= ERA_END ? settings.cutoff : ERA_END;
  return supportedPool(cards).filter(card => card.tcgDate <= cutoff && (isMonster(card)?matchesMonsterFilters(card,settings):matchesSpellTrapType(card,settings.spellTrapType)) && (settings.spells || card.type !== 'Spell Card') && (settings.traps || card.type !== 'Trap Card'));
}
export const setLabel=set=>`${set.name}${validReleaseDate(set.date)?' ('+set.date.slice(0,4)+')':''}`;
export function validateDuelDeck(deck, cards, settings = defaultSide(), {min=40,max=60}={}) {
  if (!deck?.sections) return ['Choose a saved deck or create one.'];
  const issues = [], index = new Map(cards.map(c => [c.id, c])), allowed = new Set(poolFor(cards, settings).map(c => c.id));
  const total = deck.sections.main.reduce((n, e) => n + e.quantity, 0);
  if (total < min || total > max) issues.push(`Main Deck needs ${min}–${max} cards (currently ${total}).`);
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
export function generationProblem(pool,size=40) {
  const main = pool.filter(c => !c.type.includes('Fusion'));
  const low = main.filter(c => isMonster(c) && c.level <= 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||''));
  if (new Set(main.map(cardCopyName)).size * 3 < size) return `These filters leave fewer than ${size} available card copies. Broaden them or choose another set.`;
  if (new Set(low.map(cardCopyName)).size * 3 < Math.ceil(size*.4)) return `These filters need at least ${Math.ceil(size*.4)} copies of Level 4 or lower monsters for a playable random deck.`;
  return '';
}
export function eligibleSets(cards, sets, settings) {
  const pool = poolFor(cards, settings);
  return sets.filter(set => set.date && set.date <= (settings.cutoff || ERA_END)).map(set => {
    const remaining = pool.filter(card => card.setNames?.includes(set.name));
    return { ...set, remaining, problem: generationProblem(settings.supplement?pool:remaining,deckSize(settings.size)) };
  }).filter(set => set.remaining.length).sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
export function generateDeck(cards, settings = defaultSide(), sets = [], seed = freshSeed()) {
  const random = seededRandom(seed);
  let pool = poolFor(cards, settings), preferred=null,label = 'Random cards';
  const fallback=pool,size=deckSize(settings.size);
  if (settings.source === 'set') {
    const available = eligibleSets(cards, sets, settings).filter(set => !set.problem && (!settings.set || settings.set === set.name));
    if (!available.length) throw new Error('No released set has enough supported cards under these filters. Choose another set or broaden the filters.');
    const set = available[Math.floor(random() * available.length)];
    pool = settings.supplement?fallback:set.remaining;preferred=set.remaining;label = set.name;
  }
  const problem = generationProblem(pool,size);
  if (problem) throw new Error(problem);
  let deck = createDeck(label.slice(0,60)); deck.releaseYear = Number(settings.cutoff.slice(0,4));
  const low = pool.filter(c => isMonster(c) && c.level <= 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||'') && !c.type.includes('Fusion'));
  const high = pool.filter(c => isMonster(c) && c.level > 4 && !/Ritual/.test(c.type) && !/Must (?:first )?be Special Summoned|Cannot be Normal Summoned\/Set/i.test(c.desc||'') && !c.type.includes('Fusion'));
  // Weighted sampling with a strict copy cap; no rejected filter is relaxed.
  const choose = list => {
    const copies = new Map();
    for (const entry of deck.sections.main) { const name=cardCopyName(entry.card); copies.set(name,(copies.get(name)||0)+entry.quantity); }
    let candidates = list.filter(card => (copies.get(cardCopyName(card)) || 0) < 3);
    const fromSet=preferred&&candidates.filter(card=>preferred.some(c=>c.id===card.id));if(fromSet?.length)candidates=fromSet;
    if (!candidates.length) return false;
    const ranked = candidates.map(card => ({ card, weight: isMonster(card) ? 1 + Math.max(card.atk,card.def)/1800 : 2 }));
    let pick = random() * ranked.reduce((n,e) => n+e.weight,0);
    const card = (ranked.find(e => (pick -= e.weight) <= 0) || ranked.at(-1)).card;
    deck = addCard(deck, card); return true;
  };
  for (let n=0;n<Math.round(size*.5);n++) if (!choose(low)) break;
  for (let n=0;n<Math.round(size*.1);n++) if (!choose(high)) break;
  const main = pool.filter(c => !c.type.includes('Fusion') && c.name !== 'Polymerization');
  while (deck.sections.main.reduce((n,e) => n+e.quantity,0)<size) {
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
export function prepareAIDeck(saved,cards,settings,seed=freshSeed()) {
  const issues=validateDuelDeck(saved,cards,settings,{min:0,max:60});
  if(issues.length)throw new Error(issues.join(' '));
  const random=seededRandom(seed),size=deckSize(settings.size),deck=structuredClone(saved);
  const main=shuffled(deck.sections.main.flatMap(e=>Array(e.quantity).fill(e.card)),random).slice(0,size);
  deck.sections.main=[];
  for(const card of main){const entry=deck.sections.main.find(e=>e.card.id===card.id);if(entry)entry.quantity++;else deck.sections.main.push({card,quantity:1});}
  const pool=poolFor(cards,settings).filter(c=>!c.type.includes('Fusion'));
  while(deck.sections.main.reduce((n,e)=>n+e.quantity,0)<size){
    const counts=new Map();for(const e of Object.values(deck.sections).flat())counts.set(cardCopyName(e.card),(counts.get(cardCopyName(e.card))||0)+e.quantity);
    const candidates=pool.filter(c=>(counts.get(cardCopyName(c))||0)<3);
    if(!candidates.length)throw new Error(`These filters cannot fill an AI deck of ${size} cards within the three-copy limit.`);
    const card=candidates[random.int(candidates.length)],entry=deck.sections.main.find(e=>e.card.id===card.id);
    if(entry)entry.quantity++;else deck.sections.main.push({card:normalizeCard(card),quantity:1});
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
  const valid = value => Array.isArray(value) && value.every(set => typeof set.name === 'string' && validReleaseDate(set.date));
  if (!force && cached && valid(cached.sets) && now-cached.time<86400000) return {sets:cached.sets,offline:false};
  try {
    const response = await fetchImpl('https://db.ygoprodeck.com/api/v7/cardsets.php', {signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('Set request failed.');
    const raw = await response.json(); if (!Array.isArray(raw)) throw new Error('Invalid set list.');
    const sets = raw.filter(set => validReleaseDate(set.tcg_date) && set.tcg_date<=ERA_END).map(set => ({name:set.set_name,date:set.tcg_date}));
    if (!valid(sets) || !sets.length) throw new Error('No dated sets returned.');
    try { storage?.setItem(key,JSON.stringify({sets,time:now})); } catch { /* session still works */ }
    return {sets,offline:false};
  } catch (error) {
    if (cached && valid(cached.sets) && cached.sets.length) return {sets:cached.sets,offline:true};
    throw new Error('Set dates could not load. Retry, or use Random cards / Saved deck.', {cause:error});
  }
}
