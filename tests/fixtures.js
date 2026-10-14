// API-shaped fixtures are used only by tests. The application always loads the full API archive.
export const dragon = { id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', tcgDate: '2002-03-08', humanReadableCardType: 'Normal Monster', desc: 'A powerful dragon.', race: 'Dragon', attribute: 'LIGHT', atk: 3000, def: 2500, level: 8, archetype: 'Blue-Eyes', card_images: [{ id: 89631139, image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/89631139.jpg' }, { id: 89631140, image_url: 'https://images.ygoprodeck.com/images/cards/89631140.jpg' }] };
export const fusion = { ...dragon, id: 23995346, name: 'Blue-Eyes Ultimate Dragon', type: 'Fusion Monster', atk: 4500, level: 12 };
export const xyz = { ...dragon, id: 84013237, name: 'Number 39: Utopia', tcgDate: '2011-07-12', type: 'XYZ Monster', race: 'Warrior', archetype: 'Utopia', level: 4 };
export const link = { ...dragon, id: 1861629, name: 'Decode Talker', tcgDate: '2017-07-20', type: 'Link Monster', race: 'Cyberse', archetype: undefined, level: undefined, def: undefined, linkval: 3, linkmarkers: ['Top', 'Bottom-Left', 'Bottom-Right'] };
export const spell = { id: 83764718, name: 'Monster Reborn', type: 'Spell Card', tcgDate: '2002-03-08', desc: 'Target 1 monster in either Graveyard; Special Summon it.', race: 'Normal', card_images: [] };
export const trap = { id: 44095762, name: 'Mirror Force', type: 'Trap Card', tcgDate: '2002-06-26', desc: 'When an opponent’s monster declares an attack.', race: 'Normal', card_images: [] };
export const cards = [dragon, fusion, xyz, link, spell, trap];
export function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
