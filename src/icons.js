const paths = {
 home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
 archive: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>',
 deck: '<rect x="7" y="3" width="13" height="17" rx="2"/><path d="M4 6v14a2 2 0 0 0 2 2h11"/><path d="m13.5 7 3 4-3 4-3-4Z"/>',
 people: '<circle cx="8" cy="7" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 5 5v1"/>',
 solo: '<path d="m4 3 14 14M3 3l1 5 4-4-5-1Zm18 0L7 17m14-14-1 5-4-4 5-1ZM2 17l5 5m-3-2 4-4m9 6 5-5m-2 3-4-4"/>',
 search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
 filter: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="var(--panel)"/><circle cx="16" cy="12" r="2" fill="var(--panel)"/><circle cx="9" cy="18" r="2" fill="var(--panel)"/>',
 close: '<path d="m6 6 12 12M18 6 6 18"/>',
 edit: '<path d="m15 4 5 5-11 11H4v-5Z"/><path d="m13 6 5 5"/>',
 save: '<path d="M4 3h13l3 3v15H4Z"/><path d="M8 3v6h8V3M8 21v-8h8v8"/>',
 rules: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 backup: '<path d="M4 17v4h16v-4M12 3v12m-5-5 5 5 5-5"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 wifi: '<path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0m-3 4v.1"/>',
 trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
 plus: '<path d="M12 4v16M4 12h16"/>',
 check: '<path d="m4 12 5 5L20 6"/>'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.deck}</svg>`;
