import {defaultSide,deckSize} from './decks.js';
import {ERA_END} from './catalog.js';
import {validReleaseDate} from '../era.js';
import {AI_SPEEDS} from './flow.js';
import {ATTRIBUTES,MONSTER_TYPES,SUBTYPES,MECHANICS,SPELL_TRAP_TYPES} from '../card-filters.js';
export const SOLO_CONFIG_KEY='duel-atlas.solo-config.v1';
const text=(value,max=100)=>typeof value==='string'?value.slice(0,max):'';
export function normalizeSoloConfig(value){
  const saved=value&&typeof value==='object'&&!Array.isArray(value)?value:{},previousEnd=typeof saved.eraEnd==='string'?saved.eraEnd:'2004-12-31';
  const sides=[0,1].map(index=>{
    const raw=Array.isArray(saved.sides)&&saved.sides[index]&&typeof saved.sides[index]==='object'?saved.sides[index]:{},side=defaultSide();
    side.source=['cards','set','saved'].includes(raw.source)?raw.source:side.source;
    side.deckId=text(raw.deckId);side.set=text(raw.set,250);
    side.cutoff=validReleaseDate(raw.cutoff)&&raw.cutoff<=ERA_END&&raw.cutoff!==previousEnd?raw.cutoff:ERA_END;
    for(const [key,choices] of [['attribute',ATTRIBUTES],['race',MONSTER_TYPES],['subtype',SUBTYPES],['mechanic',MECHANICS],['spellTrapType',SPELL_TRAP_TYPES]])side[key]=choices.includes(raw[key])?raw[key]:'';
    for(const key of ['spells','traps'])side[key]=typeof raw[key]==='boolean'?raw[key]:true;
    side.size=index&&['number','string'].includes(typeof raw.size)?deckSize(raw.size):40;side.supplement=!!index;return side;
  });
  return {sides,eraEnd:ERA_END,aiSpeed:typeof saved.aiSpeed==='string'&&Object.hasOwn(AI_SPEEDS,saved.aiSpeed)?saved.aiSpeed:'normal',first:['coin','you','ai'].includes(saved.first)?saved.first:'coin',lp:[4000,8000].includes(saved.lp)?saved.lp:8000,animations:typeof saved.animations==='boolean'?saved.animations:true,learning:typeof saved.learning==='boolean'?saved.learning:true};
}
