export const DUEL_SAVES_KEY='duel-atlas.saved-duels.v1';
export const validDuelEntry=s=>s&&typeof s.id==='string'&&!!s.id&&s.replay?.version===1&&(s.name===undefined||typeof s.name==='string')&&(s.turn===undefined||Number.isFinite(s.turn))&&(s.savedAt===undefined||Number.isFinite(s.savedAt))&&(s.lp===undefined||Array.isArray(s.lp)&&s.lp.every(Number.isFinite));
export function inspectDuelSaves(storage){
  try{const value=JSON.parse(storage?.getItem(DUEL_SAVES_KEY)||'[]');if(!Array.isArray(value))throw Error('Invalid saved-duel list.');return {saves:value.filter(validDuelEntry),rejected:value.filter(s=>!validDuelEntry(s)),error:null};}
  catch{return {saves:[],rejected:[],error:'Saved duels could not be read. Existing data was preserved; export a recovery backup before clearing storage.'};}
}
export const readDuelSaves=storage=>inspectDuelSaves(storage).saves;
export function saveDuel(storage,entry){
  const status=inspectDuelSaves(storage);if(status.error)throw Error(status.error);const previous=status.saves;
  if(previous.length>=5&&!previous.some(s=>s.id===entry.id))throw new Error('Five duels are already saved. Delete one in Saved duels to free a slot. The current duel is still open.');
  const list=[entry,...previous.filter(s=>s.id!==entry.id)];
  try{storage.setItem(DUEL_SAVES_KEY,JSON.stringify([...list,...status.rejected]));}catch{throw new Error('Could not save this duel. Device storage may be full. The current duel is still open.');}return list;
}
export function deleteDuelSave(storage,id){const status=inspectDuelSaves(storage);if(status.error)throw Error(status.error);const list=status.saves.filter(s=>s.id!==id);storage.setItem(DUEL_SAVES_KEY,JSON.stringify([...list,...status.rejected]));return list;}
