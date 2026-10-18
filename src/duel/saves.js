export const DUEL_SAVES_KEY='duel-atlas.saved-duels.v1';
export function readDuelSaves(storage){try{const value=JSON.parse(storage.getItem(DUEL_SAVES_KEY)||'[]');return Array.isArray(value)?value.filter(s=>s?.id&&s.replay?.version===1).slice(0,5):[];}catch{return [];}}
export function saveDuel(storage,entry){
  const previous=readDuelSaves(storage);
  if(previous.length>=5&&!previous.some(s=>s.id===entry.id))throw new Error('Five duels are already saved. Delete one in Saved duels to free a slot. The current duel is still open.');
  const list=[entry,...previous.filter(s=>s.id!==entry.id)];
  try{storage.setItem(DUEL_SAVES_KEY,JSON.stringify(list));}catch{throw new Error('Could not save this duel. Device storage may be full. The current duel is still open.');}return list;
}
export function deleteDuelSave(storage,id){const list=readDuelSaves(storage).filter(s=>s.id!==id);storage.setItem(DUEL_SAVES_KEY,JSON.stringify(list));return list;}
