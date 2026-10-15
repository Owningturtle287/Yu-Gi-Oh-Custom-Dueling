import { dateForBasis, cardReleaseDate, normalizeReleaseYear, releaseCutoff, availableBy } from './era.js';
export const VERSION = '0.2.3';
export const MECHANICS = ['Fusion', 'Synchro', 'Xyz', 'Pendulum', 'Link'];
export const SECTIONS = ['main', 'extra', 'side'];
export const LIMITS = { main: 60, extra: 15, side: 15 };
export const STORAGE_KEY = 'duel-atlas.decks.v1';
export const allMechanics = () => Object.fromEntries(MECHANICS.map(m => [m, true]));
export const cardMechanics = card => MECHANICS.filter(m => card.type.toLowerCase().includes(m.toLowerCase()));
export const isExtra = card => /Fusion|Synchro|XYZ|Xyz|Link/.test(card.type);
export function normalizeCard(card) {
  if (!card || !Number.isSafeInteger(card.id) || card.id <= 0 || typeof card.name !== 'string' || typeof card.type !== 'string') throw new Error('Invalid card data.');
  const fields = ['id', 'name', 'type', 'humanReadableCardType', 'frameType', 'desc', 'race', 'attribute', 'archetype', 'atk', 'def', 'level', 'linkval', 'linkmarkers', 'scale'];
  const normalized = Object.fromEntries(fields.filter(k => card[k] !== undefined).map(k => [k, card[k]]));
  normalized.tcgDate = cardReleaseDate(card);
  normalized.ocgDate = cardReleaseDate(card, 'ocg');
  normalized.setNames = [...new Set(card.setNames || (card.card_sets || []).map(set => set.set_name))].filter(name => typeof name === 'string');
  normalized.card_images = (card.card_images || []).slice(0, 1).map(img => Object.fromEntries(['id', 'image_url', 'image_url_small'].filter(k => img[k] !== undefined).map(k => [k, img[k]])));
  return normalized;
}
export function filterCards(cards, filters = {}) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  const cutoff = releaseCutoff(filters.year);
  const result = cards.filter(card => {
    if (!availableBy(card, cutoff, {basis:filters.releaseBasis||'tcg',allowUnknown:filters.year==null||filters.year==='current'})) return false;
    if (query && ![card.name, card.archetype, card.desc].some(v => String(v || '').toLocaleLowerCase().includes(query))) return false;
    if (filters.category === 'Monster' && !card.type.includes('Monster')) return false;
    if (filters.category === 'Spell' && card.type !== 'Spell Card') return false;
    if (filters.category === 'Trap' && card.type !== 'Trap Card') return false;
    if (filters.category === 'Extra' && !isExtra(card)) return false;
    if (filters.attribute && card.attribute !== filters.attribute) return false;
    if (filters.race && card.race !== filters.race) return false;
    if (filters.subtype && !card.type.toLowerCase().includes(filters.subtype.toLowerCase())) return false;
    if (filters.mechanic && !cardMechanics(card).includes(filters.mechanic)) return false;
    return true;
  });
  return result.sort((a, b) => {
    if (filters.sort === 'atk') return (b.atk ?? -2) - (a.atk ?? -2) || a.name.localeCompare(b.name);
    if (filters.sort === 'level') return (b.level ?? b.linkval ?? -1) - (a.level ?? a.linkval ?? -1) || a.name.localeCompare(b.name);
    const compare = a.name.localeCompare(b.name);
    return filters.sort === 'za' ? -compare : compare;
  });
}
export function createDeck(name = 'Untitled deck', id = globalThis.crypto.randomUUID()) {
  return { id, name: validName(name), releaseYear: null, releaseBasis: 'tcg', mechanics: allMechanics(), sections: { main: [], extra: [], side: [] }, updatedAt: new Date().toISOString() };
}
export function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new Error('Use a deck name between 1 and 60 characters.');
  return name.trim();
}
export const totals = deck => Object.fromEntries(SECTIONS.map(s => [s, deck.sections[s].reduce((sum, entry) => sum + entry.quantity, 0)]));
export function addCard(deck, card, section = isExtra(card) ? 'extra' : 'main', { preserveExisting = false } = {}) {
  if (!SECTIONS.includes(section)) throw new Error('Choose Main, Extra, or Side Deck.');
  if (/Token|Skill Card/.test(card.type)) throw new Error('Tokens and Skill Cards are not supported in this deck builder.');
  const normalized = normalizeCard(card);
  const basis=deck.releaseBasis||'tcg',date=dateForBasis(normalized,basis),region=basis==='earliest'?'TCG / OCG':basis.toUpperCase();
  if (!preserveExisting && !availableBy(normalized, releaseCutoff(deck.releaseYear), {basis,allowUnknown:deck.releaseYear==null})) throw new Error(date ? `This card was first released in the ${region} on ${date}, after this deck’s cutoff of ${releaseCutoff(deck.releaseYear)}.` : `This card has no verified ${region} release date for this historical cutoff. Refresh the archive before adding it.`);
  const blocked = cardMechanics(card).filter(m => !deck.mechanics[m]);
  if (blocked.length) throw new Error(`${blocked.join(' / ')} is disabled in this deck’s Rules / Format.`);
  if (section === 'main' && isExtra(card)) throw new Error('This card belongs in the Extra Deck or Side Deck.');
  if (section === 'extra' && !isExtra(card)) throw new Error('Only Fusion, Synchro, Xyz, and Link monsters belong in the Extra Deck.');
  const copies = SECTIONS.reduce((n, s) => n + (deck.sections[s].find(e => e.card.id === card.id)?.quantity || 0), 0);
  if (copies >= 3) throw new Error('Copy limit reached: 3 copies across Main, Extra, and Side Deck.');
  if (totals(deck)[section] >= LIMITS[section]) throw new Error(`${section === 'main' ? 'Main' : section === 'extra' ? 'Extra' : 'Side'} Deck is full (${LIMITS[section]} cards).`);
  const next = structuredClone(deck);
  const entry = next.sections[section].find(e => e.card.id === card.id);
  if (entry) entry.quantity++;
  else next.sections[section].push({ card: normalized, quantity: 1 });
  return next;
}
export function removeCard(deck, cardId, section) {
  const next = structuredClone(deck);
  const entry = next.sections[section].find(e => e.card.id === cardId);
  if (entry && --entry.quantity === 0) next.sections[section] = next.sections[section].filter(e => e !== entry);
  return next;
}
export function deckWarnings(deck) {
  const warnings = [];
  if (totals(deck).main < 40) warnings.push('Main Deck has fewer than 40 cards. You can still save while building.');
  const restricted = SECTIONS.flatMap(s => deck.sections[s]).filter(e => cardMechanics(e.card).some(m => !deck.mechanics[m]));
  if (restricted.length) warnings.push(`${restricted.length} card type${restricted.length > 1 ? 's use' : ' uses'} a disabled mechanic. Remove them or update Rules / Format.`);
  const outsideYear = SECTIONS.flatMap(section => deck.sections[section]).filter(entry => !availableBy(entry.card, releaseCutoff(deck.releaseYear), {basis:deck.releaseBasis||'tcg'}));
  if (outsideYear.length) warnings.push(`${outsideYear.length} card type${outsideYear.length === 1 ? '' : 's'} outside the release-year cutoff or missing a TCG date. Review Release year in Filters.`);
  return warnings;
}
// Backups and browser storage use the same strictly validated format.
export function validateDeck(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 100) throw new Error('Invalid deck ID.');
  const deck = createDeck(validName(value.name), value.id);
  if (!value.mechanics || MECHANICS.some(m => typeof value.mechanics[m] !== 'boolean')) throw new Error('Invalid mechanic settings.');
  const desiredMechanics = Object.fromEntries(MECHANICS.map(m => [m, value.mechanics[m]]));
  const desiredYear = normalizeReleaseYear(value.releaseYear);
  if (!value.sections || SECTIONS.some(s => !Array.isArray(value.sections[s]))) throw new Error('Invalid deck sections.');
  let next = deck;
  for (const section of SECTIONS) {
    if (value.sections[section].length > LIMITS[section]) throw new Error('Too many deck entries.');
    for (const entry of value.sections[section]) {
      if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 3) throw new Error('Invalid card quantity.');
      const card = normalizeCard(entry.card);
      for (let n = 0; n < entry.quantity; n++) next = addCard(next, card, section, { preserveExisting: true });
    }
  }
  next.mechanics = desiredMechanics; // Preserve warnings on decks saved before a mechanic was disabled.
  next.releaseYear = desiredYear;
  if(value.releaseBasis && !['tcg','ocg','earliest'].includes(value.releaseBasis))throw new Error('Invalid release region.');
  next.releaseBasis = value.releaseBasis || 'tcg';
  next.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : deck.updatedAt;
  return next;
}
export function readDecks(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.decks)) throw new Error('Saved deck data is unreadable. Export a backup before changing browser storage.');
  return data.decks.map(validateDeck);
}
export function saveDeck(storage, decks, deck) {
  const valid = validateDeck({ ...deck, updatedAt: new Date().toISOString() });
  const next = [...decks.filter(d => d.id !== valid.id), valid].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, decks: next }));
  return next;
}
export function exportJSON(deck) { return JSON.stringify({ version: 1, deck }, null, 2); }
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (parsed.version !== 1 || !parsed.deck) throw new Error('Choose a Duel Atlas v1 JSON deck backup.');
  return validateDeck(parsed.deck);
}
export function exportYDK(deck) {
  const lines = ['#created by Duel Atlas v' + VERSION];
  for (const section of SECTIONS) {
    lines.push(section === 'side' ? '!side' : '#' + section);
    for (const entry of deck.sections[section]) for (let n = 0; n < entry.quantity; n++) lines.push(String(entry.card.id));
  }
  return lines.join('\n') + '\n';
}
export function importYDK(text, cards, name) {
  const index = new Map(cards.map(card => [card.id, card]));
  for (const card of cards) {
    for (const image of card.card_images || []) if (image.id && !index.has(image.id)) index.set(image.id, card);
  }
  let deck = createDeck(name), section = null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 1000) throw new Error('This YDK file is too large.');
  for (const original of lines) {
    const line = original.trim();
    if (line === '#main' || line === '#extra' || line === '!side') { section = line.slice(1); continue; }
    if (!line || line.startsWith('#')) continue;
    if (!section || !/^\d+$/.test(line)) throw new Error(`Invalid YDK line: ${line.slice(0, 30)}`);
    const card = index.get(Number(line));
    if (!card) throw new Error(`Card ID ${line} is not in the loaded archive. Nothing was imported.`);
    deck = addCard(deck, card, section);
  }
  if (!section) throw new Error('No deck sections found in this YDK file.');
  return deck;
}
