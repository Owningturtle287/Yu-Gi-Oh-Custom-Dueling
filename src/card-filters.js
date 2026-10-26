// One taxonomy for archive/deck searches, duel eligibility and AI beliefs.
// Choices describe printed cards; they do not expand the duel's supported era.
export const ATTRIBUTES = ['DARK','LIGHT','EARTH','FIRE','WATER','WIND','DIVINE'];
export const MONSTER_TYPES = ['Aqua','Beast','Beast-Warrior','Creator God','Cyberse','Dinosaur','Divine-Beast','Dragon','Fairy','Fiend','Fish','Illusion','Insect','Machine','Plant','Psychic','Pyro','Reptile','Rock','Sea Serpent','Spellcaster','Thunder','Warrior','Winged Beast','Wyrm','Zombie'];
export const SUBTYPES = ['Normal','Effect','Flip','Fusion','Gemini','Link','Pendulum','Ritual','Spirit','Synchro','Toon','Tuner','Union','Xyz'];
export const MECHANICS = ['Fusion','Synchro','Xyz','Pendulum','Link'];
export const SPELL_TRAP_TYPES = ['Normal','Continuous','Counter','Equip','Field','Quick-Play','Ritual'];
export const isMonsterCard = card => /\bMonster\b/i.test(card?.type||'');
export function effectFlag(card){
  const value=[card.hasEffect,...(Array.isArray(card.misc_info)?card.misc_info:[]).map(info=>info?.has_effect)].find(value=>[true,false,0,1].includes(value));
  return value===undefined?undefined:!!value;
}
export function isEffectMonster(card){
  if(!isMonsterCard(card)||/\bNormal\b/i.test(card.type))return false;
  if(/\b(?:Effect|Spirit|Toon|Gemini|Union|Tuner)\b/i.test(card.type))return true;
  const flag=effectFlag(card);if(flag!==undefined)return flag;
  // Older offline caches lack the API flag. Bare Extra Deck types put their
  // materials on the first line and any effect/procedure text after it.
  return /\b(?:Fusion|Synchro|XYZ|Link)\b/i.test(card.type)&&!!card.desc?.split(/\r?\n/).slice(1).join('').trim();
}
export function matchesSubtype(card,subtype=''){
  if(!subtype)return true;
  if(!isMonsterCard(card))return false;
  return subtype.toLowerCase()==='effect'?isEffectMonster(card):card.type.toLowerCase().split(/\s+/).includes(subtype.toLowerCase());
}
export function matchesMonsterFilters(card,filters={}){
  return isMonsterCard(card)&&(!filters.race||card.race===filters.race)&&(!filters.attribute||card.attribute===filters.attribute)&&matchesSubtype(card,filters.subtype)&&(!filters.mechanic||matchesSubtype(card,filters.mechanic));
}
export function matchesSpellTrapType(card,value=''){
  return !value||['Spell Card','Trap Card'].includes(card.type)&&card.race===value;
}
