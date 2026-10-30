// Original miniature emblems: distinct silhouettes, enamel colour and metal
// edges replace the old single-line symbols. No external fonts or image fetches.
const art={
 WARRIOR:['#a9c9dc','#f4d27e','<path d="M4 4 9 6l17 19-3 3L6 10ZM28 4l-5 2L6 25l3 3 17-18Z"/><path fill="#f1c35e" d="m5 19 8 8-2 2-8-8Zm14-14 8 8 2-2-8-8Z"/><path fill="#f4f8fb" d="m7 6 15 17-2-1L6 8Zm18 0L11 21l1-3Z"/>'],
 SPELLCASTER:['#6954a3','#d0b8ff','<path d="M5 26 22 6l3 3L9 29Z"/><path fill="#d1b6ff" d="m18 6 4-5 6 3 2 6-6 4-6-3Z"/><path fill="#eed9a0" d="m3 17 9-1 4 4 9-1v10l-9 1-5-3-8 1Z"/><path fill="none" d="m11 17 1 9m4-6v10M6 21h3m10 2h4"/>'],
 FAIRY:['#d6b7df','#fff1bb','<path d="M14 15C9 2 2 2 3 12c0 4 5 8 10 9C5 19 5 27 13 25Zm4 0C23 2 30 2 29 12c0 4-5 8-10 9 8-2 8 6 0 4Z"/><ellipse fill="none" stroke="#cf9c42" cx="16" cy="4" rx="5" ry="2"/><path fill="#fff0ba" d="m16 10 5 9-5 10-5-10Z"/><path fill="none" d="m6 9 6 8m14-8-6 8M7 22h4m14 0h-4"/>'],
 FIEND:['#a54b62','#f7bd83','<path d="M8 12C1 10 2 3 4 2c1 5 5 4 8 7h8c3-3 7-2 8-7 3 6 0 10-4 11l1 9-9 8-9-8Z"/><path fill="#382a42" d="m8 15 6 2-2 4-4-2Zm16 0-6 2 2 4 4-2Z"/><path fill="#fff0ce" d="m11 24 2-3 3 2 3-2 2 3-5 3Z"/>'],
 ZOMBIE:['#bfceac','#eef1d6','<path d="M6 16C0 3 29-2 28 13l-4 8-1 8H9l-1-8Z"/><path fill="#3a4b4a" d="m8 14 6-1-1 6H9Zm17 0-6-1 1 6h4Zm-9 5-2 4h4Z"/><path fill="none" d="M13 25v4m5-4v4m-2-21-3 3 3 2"/>'],
 MACHINE:['#849fab','#f8cf68','<path d="m11 2 9 0 1 4 5 2 4 7-3 4v6l-8 5-4-3-5 1-7-7 1-5-2-4 6-7Z"/><circle fill="#334f61" cx="16" cy="16" r="9"/><circle fill="#edc260" cx="16" cy="16" r="5"/><path fill="none" stroke="#f7f0c9" d="M16 8v3m5 5h3m-8 5v3M8 16h3"/>'],
 AQUA:['#57b8ce','#c7f6ef','<path d="M16 2C12 9 4 12 4 20c0 12 24 13 24 0 0-8-8-11-12-18Z"/><path fill="#b8f3ef" d="M8 19c6-9 16-5 15 3-1 6-11 7-11 1 0-4 6-4 6 0 6-5-7-12-10-4Z"/>'],
 PYRO:['#e57b3e','#ffe29b','<path d="M17 1c9 9 2 12 7 12l3-6c11 23-20 31-24 13C1 15 6 9 9 6c-2 14 8 9 8-5Z"/><path fill="#ffe294" d="M17 14c-1 7-9 8-5 13 4 4 13-1 9-7 0 5-5 2-4-6Z"/>'],
 ROCK:['#929e9d','#d4dfd4','<path d="m3 21 2-13 8-5 8 3 8 16-6 7H7Z"/><path fill="#d4dfd4" d="m5 8 9 4 7-6-2 16-12 7-4-8Z"/><path fill="none" d="m14 12 5 10 10 0M7 29l5-9-9 1m2-13 7 12"/>'],
 WINGEDBEAST:['#ab9a72','#f5e7ba','<path d="M15 11 3 3l-1 9 6 9 7 5h3l7-5 5-9-1-9-12 8Z"/><path fill="#f5e7ba" d="m12 11 4-5 6 2-1 5-4 4-5-2Z"/><path fill="#d5a74b" d="m19 10 6 3-6 2Z"/><path fill="none" d="m4 10 7 9M3 15l7 7m18-12-6 9m7-4-7 7"/>'],
 PLANT:['#65a16b','#c9e39b','<path d="M15 27C1 29 0 15 3 10c10-1 15 7 12 14C13 9 23 4 29 5c4 12-5 22-12 19Z"/><path fill="none" d="M16 30V15M6 15l10 10L26 9"/><circle fill="#f2c97c" cx="14" cy="7" r="5"/>'],
 INSECT:['#55a28f','#a3dfaf','<path fill="none" d="M11 11 5 6M9 16H2m8 6-6 6m17-17 6-5m-4 10h7m-8 6 6 6M12 6 9 2m11 4 3-4"/><ellipse cx="16" cy="18" rx="8" ry="11"/><path fill="#addf91" d="M16 8v21c-9-1-10-16 0-21Z"/><path fill="none" d="M9 14h14M16 8v21"/><circle fill="#f4d17d" cx="16" cy="7" r="4"/>'],
 THUNDER:['#e4b642','#fff3b5','<path d="m20 1-17 18h10l-2 12L30 11H19Z"/><path fill="#fff2b4" stroke="none" d="m18 7-9 9h8l-2 8 10-10h-8Z"/>'],
 DRAGON:['#b76858','#efb76d','<path d="m5 29 2-14 7-7 1-7 5 6 8 1 2 7-10 5-1 9Z"/><path fill="#e3ad69" d="m7 15 6 5 6 0 1 9H5Z"/><path fill="#292f40" d="m21 12 4-1-1 3Z"/><path fill="#fff1ce" d="m21 18 3-2 1 3Zm-7 3 2 3-3-1Z"/><path fill="none" d="m8 20 6 4m-7 1 6 3M11 10 6 6l1 9"/>'],
 BEAST:['#aa8565','#efcc95','<path d="M3 2 13 8h6l10-6-2 21-11 8L5 23Z"/><path fill="#edd4a1" d="m7 15 9 2 9-2-3 11-6 5-6-5Z"/><path fill="#31404a" d="m6 11 7 3-3 3Zm20 0-7 3 3 3Zm-14 9h8l-4 5Z"/>'],
 BEASTWARRIOR:['#ae9153','#d2e3ec','<path d="m16 1 8 5 6 10-5 13-9 2-9-2-5-13 6-10Z"/><path fill="#cbdce7" d="m7 9 9-4 9 4-2 12-7 8-7-8Z"/><path fill="#c69648" d="m10 11 6 2 6-2 1 8-7 7-7-7Z"/><path fill="#253d4d" d="m10 13 4 2-3 3Zm12 0-4 2 3 3Zm-9 6h6l-3 4Z"/>'],
 DINOSAUR:['#6c9a71','#dfd59d','<path d="m6 29 1-13 5-4 1-7 9-3 8 6v10l-13 1 5 10Z"/><path fill="#303c40" d="M18 11h12v5H16Z"/><path fill="#fff0c5" d="m19 11 2 4 2-4m2 0 2 4 2-4"/><circle fill="#e7b74f" cx="23" cy="7" r="1.8"/><path fill="none" d="m8 21 9 4M12 12l4 7"/>'],
 FISH:['#5eafbd','#d4ecad','<path d="M3 16C8 3 20 4 25 13l6-7v20l-6-7C18 29 8 29 3 16Z"/><path fill="#cce3a7" d="m12 8 5-6 5 6-7 1Zm0 16 5 6 6-7Z"/><path fill="none" d="M19 10c-5 4-5 9 0 13m-8-9 3 3-3 3"/><circle fill="#283f4a" cx="9" cy="14" r="1.6"/>'],
 SEASERPENT:['#548faf','#b4e3dd','<path d="M5 29c-9-11 14-10 11-16-1-2-6 1-8-2L6 5l9-4 9 5-3 8c9 11-8 13-13 11-3-1-3 2-3 4Z"/><path fill="#b6dfc8" d="M12 14c13 8-9 10-7 15-7-8 9-8 7-15Z"/><path fill="none" d="m21 16 6-2-3 6M10 4l5 4m-6 2h8"/><circle fill="#ead995" cx="17" cy="5" r="1.2"/>'],
 REPTILE:['#88a66b','#d8d99b','<path d="M2 29c7-1 7-8 9-11l-4-5 4-2 4 3 3-5-1-5 8-3 5 5-3 9-7 3-2 6 7 1 1 4-11-1-1-5c-3 6-8 8-12 6Z"/><path fill="none" d="m11 18-6 3m14-11 7 1m-3 7-1 4"/><circle fill="#263d3e" cx="25" cy="6" r="1.5"/>'],
 PSYCHIC:['#8a70b7','#e1c6ee','<path d="M2 17C9 4 22 4 30 17c-7 11-21 11-28 0Z"/><circle fill="#e1c6ee" cx="16" cy="17" r="7"/><circle fill="#384a6c" cx="16" cy="17" r="3"/><path fill="none" d="M16 1v4M5 5l3 4m19-4-3 4M2 25l5-2m23 2-5-2"/>'],
 DIVINE:['#bf9c50','#f9e6a0','<path d="M14 12 2 4l1 13 10 9h6l10-9 1-13-12 8Z"/><path fill="#f6e5ab" d="m4 10 9 9m-8-3 8 8m15-14-9 9m8-3-8 8"/><circle fill="#f8eaaa" cx="16" cy="7" r="5"/><path fill="#518f96" d="m16 13 6 6-6 10-6-10Z"/>'],
 CREATORGOD:['#d1a951','#ded9f2','<path d="m3 8 7 5 6-10 6 10 7-5-4 19H7Z"/><path fill="#ddd9f2" d="m16 10 5 9-5 6-5-6Z"/><path fill="none" d="M8 28h16M2 3l4 4m24-4-4 4M16 1v2"/>'],
 WYRM:['#559a98','#d3dea1','<path d="M3 28c-8-12 21-7 17-17-1-2-3-1-4 0 9 7-12 9-12 3 0-4 6-6 9-5l-1-6 8-2 9 7-6 7c11 11-16 10-20 13Z"/><path fill="none" d="m17 3-2 5m11 0 5-2m-7 4 7 3M9 21l-2 5m9-6 3 5"/><circle fill="#f3d98d" cx="22" cy="6" r="1.3"/>'],
 CYBERSE:['#5ba9ad','#d0eced','<path d="m16 2 12 7v14l-12 7-12-7V9Z"/><path fill="#c6e8e7" d="m16 9 6 4v7l-6 4-6-4v-7Z"/><path fill="none" d="m4 9 6 4m12 0 6-4M16 2v7m0 15v6M4 23l6-3m12 0 6 3"/><circle fill="#e8c975" cx="16" cy="16" r="3"/>'],
 ILLUSION:['#8f81b1','#e2cbd9','<path d="M3 7c5-6 10-3 13 0 3-3 8-6 13 0l-3 16-10 7-10-7Z"/><path fill="#f0d9bd" d="M16 7v23l-10-7-3-16c5-6 10-3 13 0Z"/><path fill="#3e3b5a" d="m6 11 7 2-3 4Zm20 0-7 2 3 4ZM12 23h8l-4 3Z"/><path fill="none" d="m14 10 2 7 2-2"/>']
};
// The core also exposes extended Type declarations; keep those illustrated.
for(const [name,base,detail] of [
 ['CYBORG','MACHINE','<path fill="#eff0d5" d="M12 10h8v9h-8Z"/><path fill="none" d="m13 14 1 1m4-1-1 1"/>'],
 ['MAGICALKNIGHT','WARRIOR','<path fill="#a989cf" d="m16 6 4 6-4 6-4-6Z"/>'],
 ['HIGHDRAGON','DRAGON','<path fill="#b5cfaa" d="m5 14-3-10 12 6Z"/>'],
 ['OMEGAPSYCHIC','PSYCHIC','<path fill="none" d="M7 29h5v-4a11 11 0 1 1 8 0v4h5"/>'],
 ['CELESTIALWARRIOR','WARRIOR','<ellipse fill="none" stroke="#bc923b" cx="16" cy="5" rx="10" ry="3"/>'],
 ['GALAXY','CYBERSE','<ellipse fill="none" stroke="#bd8fce" cx="16" cy="16" rx="16" ry="5" transform="rotate(-30 16 16)"/>']
]){const source=art[base];art[name]=[source[0],source[1],source[2]+detail];}
const attrs={
 EARTH:['#a48456','#d6d59c','<path d="m2 24 9-18 6 10 5-7 8 15-6 6H7Z"/><path fill="#e6e4c2" d="m7 14 4-8 6 10-5-2-2 3Zm11 2 4-7 4 8-4-2Z"/><path fill="none" d="M5 25h23M8 28h16"/>'],
 WATER:['#4b9ec7','#bfedf0','<path d="M2 24C14 24 7 7 20 3c8-2 12 9 6 13-6-8-10 3-8 6h12v7H2Z"/><path fill="#c5f2f0" d="M2 24c9 4 17-1 16-8-1-6 5-8 8-5-5-9-14 0-12 8-3 5-8 5-12 5Z"/>'],
 FIRE:null,
 WIND:['#6daa92','#d4ede0','<path d="M3 10c10-9 25-5 26 5-6-6-14 3-24 3l3-4Z"/><path fill="#d6efdd" d="M3 22c10 4 25-8 26-1-2 10-18 9-24 5Z"/><path fill="none" d="M9 4c9-4 18-1 21 5M4 29h10"/>'],
 LIGHT:['#dfbd56','#fff5c3','<path d="m16 1 3 9 8-5-5 9 9 2-9 3 5 8-9-5-2 9-3-9-8 5 5-9-9-2 9-3-5-8 9 5Z"/><path fill="#fff7d5" d="m16 8 6 8-6 8-6-8Z"/>'],
 DARK:['#786197','#d4c6e5','<path d="M22 2C5-3-5 22 13 29c7 3 15-1 17-7C16 28 8 11 22 2Z"/><path fill="#d4c6e5" d="m21 8 2 5 6 2-6 2-2 5-2-5-5-2 5-2Z"/>'],
 DIVINE:['#d2ab51','#fff0b3','<circle cx="16" cy="16" r="10"/><path fill="none" stroke="#bd9340" d="M16 1v4m0 22v4M1 16h4m22 0h4M5 5l4 4m14 14 4 4M5 27l4-4M23 9l4-4"/><path fill="#fff1ba" d="m16 8 6 8-6 8-6-8Z"/>']
};attrs.FIRE=art.PYRO;
export function emblemArtwork(key,kind){const value=(kind==='attribute'?attrs:art)[key];if(!value)return null;const [main,light,path]=value;return `<svg class="declaration-emblem" viewBox="0 0 32 32" aria-hidden="true" data-declaration-icon="${kind==='attribute'?'attribute':'race'}"><g fill="${main}" stroke="#304851" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;}
