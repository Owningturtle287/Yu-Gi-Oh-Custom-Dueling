import {emblemArtwork} from './declaration-art.js';

const keyFor=label=>String(label).replace(/[^a-z]/gi,'').toUpperCase();
const names={WINGEDBEAST:'Winged Beast',BEASTWARRIOR:'Beast-Warrior',SEASERPENT:'Sea Serpent',DIVINE:'Divine-Beast',CREATORGOD:'Creator God',MAGICALKNIGHT:'Magical Knight',HIGHDRAGON:'High Dragon',OMEGAPSYCHIC:'Omega Psychic',CELESTIALWARRIOR:'Celestial Warrior'};
export function declarationLabel(label,kind='race'){const key=keyFor(label);return (kind==='attribute'&&key==='DIVINE'?'Divine':names[key])||String(label).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());}
export function declarationIcon(label,kind='race'){
 const key=keyFor(label).replace(/^DIVINEBEAST$/,'DIVINE');
 return emblemArtwork(key,kind)||emblemArtwork('DIVINE',kind);
}
