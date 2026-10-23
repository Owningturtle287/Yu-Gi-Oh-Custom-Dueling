// Original line-art emblems shared by every native Type / Attribute declaration.
const paths={
 WARRIOR:'<path d="m7 3 10 0-1 9-4 6-4-6ZM9 9h6M12 18v3M8 21h8"/>',
 SPELLCASTER:'<path d="m4 18 9-15 4 15ZM3 21h18M14 6l4 3M19 3v4M17 5h4"/>',
 FAIRY:'<path d="M12 12C4 1 0 13 9 15c-7 4 1 9 3 2 2 7 10 2 3-2 9-2 5-14-3-3ZM12 10v10"/>',
 FIEND:'<path d="m4 3 5 5h6l5-5-1 11-7 7-7-7ZM8 12l2 2m6-2-2 2m-4 3h4"/>',
 ZOMBIE:'<path d="M5 12a7 7 0 1 1 14 0l-3 4v4H8v-4ZM9 12h1m4 0h1m-3 4v4"/>',
 MACHINE:'<path d="m9 3-1 3-3 1-2 4 2 2v4l4 2 3-1 3 1 4-2v-4l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="4"/>',
 AQUA:'<path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12ZM8 16c0 2 2 3 4 3"/>',
 PYRO:'<path d="M13 2c3 8-2 7 2 11 2-1 3-3 3-3 6 10-10 16-13 6-1-4 3-8 3-8 0 7 4 3 5-6Z"/>',
 ROCK:'<path d="m3 14 4-9 9-2 5 9-4 8H7ZM7 5l4 9 10-2M3 14h8l6 6"/>',
 WINGEDBEAST:'<path d="m12 14-9-9 1 9 7 5h2l7-5 1-9-9 9Zm-6-3 5 5m7-5-5 5M11 19l1 3 1-3"/>',
 PLANT:'<path d="M12 21v-9C3 13 3 6 3 4c8 0 10 4 9 8 0-8 7-9 9-9 1 8-3 12-9 11"/>',
 INSECT:'<ellipse cx="12" cy="13" rx="5" ry="7"/><path d="M9 7 7 3m8 4 2-4M7 11l-4-2m4 6-4 1m5 3-3 3m12-11 4-2m-4 6 4 1m-5 3 3 3M12 7v13"/>',
 THUNDER:'<path d="m14 2-10 12h7l-1 8L21 9h-8Z"/>',
 DRAGON:'<path d="m4 20 1-9 6-5V2l4 3 5-1-1 7-5 1-2 8Zm1-9 6 3m4-7h.1m-8 9 4 1M4 20h12"/>',
 BEAST:'<path d="M8 14c-2 1-4 4-2 6 2 2 4-1 6-1s4 3 6 1c2-2 0-5-2-6s-6-1-8 0Z"/><ellipse cx="5" cy="10" rx="2" ry="3"/><ellipse cx="10" cy="6" rx="2" ry="3"/><ellipse cx="15" cy="6" rx="2" ry="3"/><ellipse cx="20" cy="10" rx="2" ry="3"/>',
 BEASTWARRIOR:'<path d="m5 4 4 3h6l4-3-2 12-5 6-5-6ZM8 11l3 2m5-2-3 2M9 17h6M12 7v3"/>',
 DINOSAUR:'<path d="m3 18 5-5V6l4-3 8 3v4h-7v5l3 5h-5l-2-4-3 5H3Zm9-11h.1M13 10l4 2"/>',
 FISH:'<path d="M18 12C10 2 5 5 2 12c3 7 8 10 16 0l4 6V6l-4 6ZM7 11h.1M10 6l2-3 3 5m-5 10 2 3 3-5"/>',
 SEASERPENT:'<path d="M4 20c-3-9 12-3 10-9-1-3-5-1-5-4l4-4 7 2-2 5h-4M9 14l-2-4-3 5m5 3 2 4 3-5"/>',
 REPTILE:'<path d="M3 20c9 1 7-8 11-9l5 1 2-5-5-3-4 5-5 4-4 7Zm9-11-3-4m0 0H6m5 10 4 4m0 0h4m-2-11h.1"/>',
 PSYCHIC:'<path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7ZM12 2v3m0 14v3"/><circle cx="12" cy="12" r="3"/>',
 DIVINE:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3ZM4 4l2 2m12 12 2 2m0-16-2 2M6 18l-2 2"/>',
 CREATORGOD:'<path d="m3 7 4 3 5-7 5 7 4-3-3 13H6ZM7 16h10M12 9v4"/>',
 WYRM:'<path d="M4 21c-4-10 15-5 13-12-2-5-8 0-5 2 2 1 4-1 2-4m-2-2 1-3 3 2 4 1-2 4M6 16l-3-3m6 0 2 4"/>',
 CYBERSE:'<path d="m12 3 8 5v8l-8 5-8-5V8Zm0 5 4 4-4 4-4-4ZM4 8l4 4m8 0 4-4M12 3v5m0 8v5"/>',
 ILLUSION:'<path d="M3 6c3-3 6-3 9 0 3-3 6-3 9 0v8l-4 6-5-3-5 3-4-6ZM6 10l3 2m9-2-3 2m-5 3h4"/>',
 CYBORG:'<path d="M6 20V8l6-5 6 5v12ZM6 12h12M12 3v17M9 8v1m6-1v1m-6 7h6"/>',
 MAGICALKNIGHT:'<path d="m12 3 7 4-2 10-5 4-5-4L5 7Zm0 3v12m-3-8h6M3 3v4m-2-2h4"/>',
 HIGHDRAGON:'<path d="m3 19 4-9 5-4 1-4 4 4 4 1-2 6h-5l-1 7ZM5 10 2 5l7 3m6 0h.1M3 19h14"/>',
 OMEGAPSYCHIC:'<path d="M6 20h4v-4a7 7 0 1 1 4 0v4h4M3 11h4m10 0h4M12 3v4"/>',
 CELESTIALWARRIOR:'<path d="m12 3 5 5-1 9-4 4-4-4-1-9Zm0 3v12M4 5l-2 8 5-3m13-5 2 8-5-3"/>',
 GALAXY:'<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)"/><circle cx="12" cy="12" r="2"/>',
 EARTH:'<path d="m2 20 7-13 4 7 3-5 6 11ZM7 11l2 3 2-3"/>',
 WATER:'<path d="M2 9c4-6 6 6 10 0s6 6 10 0M2 15c4-6 6 6 10 0s6 6 10 0"/>',
 FIRE:'<path d="M13 2c3 8-2 7 2 11 2-1 3-3 3-3 6 10-10 16-13 6-1-4 3-8 3-8 0 7 4 3 5-6Z"/>',
 WIND:'<path d="M2 8h14c6 0 4-8 0-5M2 12h18M2 16h12c6 0 4 8 0 5"/>',
 LIGHT:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
 DARK:'<path d="M17 3a9 9 0 1 0 4 14A10 10 0 0 1 17 3Z"/>'
};
const keyFor=label=>String(label).replace(/[^a-z]/gi,'').toUpperCase();
const names={WINGEDBEAST:'Winged Beast',BEASTWARRIOR:'Beast-Warrior',SEASERPENT:'Sea Serpent',DIVINE:'Divine-Beast',CREATORGOD:'Creator God',MAGICALKNIGHT:'Magical Knight',HIGHDRAGON:'High Dragon',OMEGAPSYCHIC:'Omega Psychic',CELESTIALWARRIOR:'Celestial Warrior'};
export function declarationLabel(label,kind='race'){const key=keyFor(label);return (kind==='attribute'&&key==='DIVINE'?'Divine':names[key])||String(label).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());}
export function declarationIcon(label,kind='race'){
 const key=keyFor(label),path=paths[key]||paths.DIVINE;
 return `<svg viewBox="0 0 24 24" aria-hidden="true" data-declaration-icon="${kind==='attribute'?'attribute':'race'}">${path}</svg>`;
}
